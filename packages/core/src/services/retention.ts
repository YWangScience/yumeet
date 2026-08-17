/**
 * 保留期清理(ch12 §12.3 权威表 + ch09 §9.5 匿名化定义)
 *
 * 单一事实源:各类数据的保留期与到期动作只在本文件的 RETENTION_RULES 里写一遍,
 * worker 的每日任务、隐私声明页、后台说明都读同一张表 —— 不存在「第二张保留期表」。
 *
 * 「匿名化」的确定性定义(ch09 §9.5):
 *   1. email 替换为 `anon-{id}@invalid`
 *   2. name 置占位符
 *   3. answers 中所有 `pii: true` 字段清空
 *   4. 保留计数与非 PII 统计维度(参会类型、分会兴趣、票种、状态…… 一律不动)
 * 到期清理与按请求删除(GDPR Art. 17,见 ./gdpr.ts)共用下面的 anonymizeRegistrationRow,
 * 保证两条路径行为完全一致。
 */
import { and, eq, isNotNull, inArray, lt, sql, count } from 'drizzle-orm';
import {
  db as defaultDb, registrations, registrationForms, events, organizations, users,
  orders, emailLogs, sessionsAuth, auditLogs,
  type Db,
} from '@yumeet/db';
import { piiKeys, localize, type FormField } from '../forms/types';
import { audit } from '../audit/index';
import { encodeId } from '../ids/index';
import type { Actor } from './registration';

/* ------------------------------------------------------------------ *
 * ch12 §12.3 权威保留期表
 * ------------------------------------------------------------------ */

export type RetentionRuleKey =
  | 'registration_pii'
  | 'special_category'
  | 'email_logs'
  | 'access_logs'
  | 'incomplete_drafts'
  | 'audit_logs';

export type RetentionAction = 'anonymize' | 'hard_delete' | 'pseudonymize';

/** 保留期从哪个时刻起算 */
export type RetentionBasis = 'event_end' | 'record_age';

export interface RetentionRule {
  key: RetentionRuleKey;
  /** 默认保留天数(ch12 §12.3) */
  days: number;
  basis: RetentionBasis;
  action: RetentionAction;
  /** 组织是否可调(只能调短,或按法务要求调长并留痕) */
  configurable: boolean;
  label: { zh: string; en: string };
  /** 到期动作的人话说明,隐私声明页直接展示 */
  effect: { zh: string; en: string };
}

/** 组织未配置时的报名 PII 保留期(organizations.retention_days 默认值,ch09 §9.2) */
export const DEFAULT_RETENTION_DAYS = 730;

export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    key: 'registration_pii',
    days: DEFAULT_RETENTION_DAYS,
    basis: 'event_end',
    action: 'anonymize',
    configurable: true,
    label: {
      zh: '报名 PII(姓名邮箱之外的表单答案)',
      en: 'Registration PII (form answers beyond name and email)',
    },
    effect: {
      zh: '字段级清除,保留匿名统计',
      en: 'Field-level erasure, anonymous statistics retained',
    },
  },
  {
    key: 'special_category',
    days: 30,
    basis: 'event_end',
    action: 'hard_delete',
    configurable: false,
    label: {
      zh: '特殊类别字段(饮食、无障碍)',
      en: 'Special-category fields (dietary, accessibility)',
    },
    effect: { zh: '硬删除', en: 'Hard delete' },
  },
  {
    key: 'email_logs',
    days: 90,
    basis: 'record_age',
    action: 'hard_delete',
    configurable: false,
    label: { zh: '邮件送达元数据', en: 'Email delivery metadata' },
    effect: { zh: '硬删除', en: 'Hard delete' },
  },
  {
    key: 'access_logs',
    days: 90,
    basis: 'record_age',
    action: 'hard_delete',
    configurable: false,
    label: { zh: '访问日志(IP、UA)', en: 'Access logs (IP, user agent)' },
    effect: { zh: '硬删除', en: 'Hard delete' },
  },
  {
    key: 'incomplete_drafts',
    days: 30,
    basis: 'record_age',
    action: 'hard_delete',
    configurable: false,
    label: { zh: '未完成的报名草稿', en: 'Abandoned registration drafts' },
    effect: { zh: '硬删除', en: 'Hard delete' },
  },
  {
    key: 'audit_logs',
    days: 730,
    basis: 'record_age',
    action: 'pseudonymize',
    configurable: true,
    label: { zh: '审计日志', en: 'Audit log' },
    effect: { zh: '主体假名化后归档', en: 'Subject pseudonymised, then archived' },
  },
] as const;

export function retentionRule(key: RetentionRuleKey): RetentionRule {
  const rule = RETENTION_RULES.find((r) => r.key === key);
  /* RETENTION_RULES 覆盖 RetentionRuleKey 的全部成员,此分支不可达 */
  if (!rule) throw new Error(`未知的保留期规则: ${key}`);
  return rule;
}

/** ch09 §9.5:worker 任务 data-retention 每日 04:00 UTC 执行 */
export const RETENTION_CRON = '0 4 * * *';
export const RETENTION_JOB_NAME = 'data-retention';

/* ------------------------------------------------------------------ *
 * 匿名化引擎(ch09 §9.5 的逐字段确定性操作)
 * ------------------------------------------------------------------ */

/** 匿名化后的姓名占位符 —— 固定字符串,不含任何原值派生信息 */
export const ANONYMIZED_NAME = '[anonymised]';

/** 匿名化邮箱:`anon-{id}@invalid`(.invalid 是 RFC 2606 保留域,永不可投递) */
export function anonymizedEmail(id: string): string {
  return `anon-${id}@invalid`;
}

export function isAnonymizedEmail(email: string): boolean {
  return /^anon-[0-9a-f-]+@invalid$/i.test(email);
}

/**
 * 特殊类别数据(GDPR Art. 9):健康相关的饮食与无障碍需求。
 * 表单设计器会给这类字段打标(ch12 §12.3);对历史表单则按字段键与标签识别,
 * 保证旧数据同样落入 30 天硬删除规则。
 */
const SPECIAL_CATEGORY_PATTERN =
  /(diet|allerg|accessib|disab|wheelchair|medical|health|饮食|过敏|无障碍|残|轮椅|医疗|健康)/i;

export function isSpecialCategoryField(field: FormField): boolean {
  const marked = (field as { specialCategory?: boolean }).specialCategory;
  if (marked === true) return true;
  const haystack = [
    field.key,
    localize(field.label, 'zh'),
    localize(field.label, 'en'),
  ].join(' ');
  return SPECIAL_CATEGORY_PATTERN.test(haystack);
}

export function specialCategoryKeys(fields: FormField[]): string[] {
  return fields.filter(isSpecialCategoryField).map((f) => f.key);
}

/**
 * answers 的逐字段清除:给定要清空的键,返回新对象与实际清除的键。
 * 未列出的键原样保留 —— 这就是「保留非 PII 统计维度」的实现。
 */
export function clearAnswerKeys(
  answers: Record<string, unknown>,
  keys: readonly string[],
): { answers: Record<string, unknown>; cleared: string[] } {
  const next: Record<string, unknown> = {};
  const cleared: string[] = [];
  const drop = new Set(keys);
  for (const [k, v] of Object.entries(answers)) {
    if (drop.has(k)) { cleared.push(k); continue; }
    next[k] = v;
  }
  return { answers: next, cleared };
}

export interface AnonymizeResult {
  registrationId: string;
  email: string;
  clearedKeys: string[];
  anonymizedUserId: string | null;
  maskedOrderId: string | null;
}

/**
 * 匿名化一条报名(到期清理与 GDPR 删除权共用的唯一实现)。
 * 必须在调用方的事务里执行 —— 传入 tx 即可。
 */
export async function anonymizeRegistrationRow(
  tx: Db,
  registrationId: string,
  opts: { now?: Date } = {},
): Promise<AnonymizeResult | null> {
  const now = opts.now ?? new Date();

  const [reg] = await tx.select().from(registrations)
    .where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) return null;

  const [form] = await tx.select({ fields: registrationForms.fields })
    .from(registrationForms).where(eq(registrationForms.id, reg.formId)).limit(1);
  const fields = (form?.fields ?? []) as FormField[];

  // 1) answers 中所有 pii: true 字段清空 —— 键由字段定义决定,确定性
  const { answers, cleared } = clearAnswerKeys(reg.answers, piiKeys(fields));
  // 报名主体邮箱在 answers 里同样出现时一并清除
  const withoutEmail = clearAnswerKeys(answers, ['email']);
  const nextAnswers = withoutEmail.answers;
  const clearedKeys = [...cleared, ...withoutEmail.cleared];

  // 2) email 替换为 anon-{id}@invalid
  const email = anonymizedEmail(reg.id);

  await tx.update(registrations).set({
    email,
    answers: nextAnswers,
    updatedAt: now,
  }).where(eq(registrations.id, reg.id));

  // 3) 关联账户:name 置占位符、email 假名化,并写 users.anonymized_at
  let anonymizedUserId: string | null = null;
  if (reg.userId) {
    await tx.update(users).set({
      email: anonymizedEmail(reg.userId),
      name: ANONYMIZED_NAME,
      status: 'anonymized',
      anonymizedAt: now,
      updatedAt: now,
    }).where(and(eq(users.id, reg.userId), sql`${users.anonymizedAt} IS NULL`));
    anonymizedUserId = reg.userId;
  }

  // 4) 交易记录按法定义务保留(会计留存),但邮箱脱敏(ch12 §12.4 删除权)
  let maskedOrderId: string | null = null;
  if (reg.orderId) {
    await tx.update(orders).set({
      email: anonymizedEmail(reg.orderId),
      updatedAt: now,
    }).where(eq(orders.id, reg.orderId));
    maskedOrderId = reg.orderId;
  }

  return { registrationId: reg.id, email, clearedKeys, anonymizedUserId, maskedOrderId };
}

/* ------------------------------------------------------------------ *
 * 每日保留期任务
 * ------------------------------------------------------------------ */

export interface RetentionOptions {
  /** 参照时刻,测试与补跑用 */
  now?: Date;
  /** dry-run:只统计将被处理的条数,不做任何写入 */
  dryRun?: boolean;
  /** 只跑某个组织(补跑与排障用) */
  organizationId?: string;
  /** dry-run 每条规则打印多少条样例 */
  sampleLimit?: number;
  actor?: Actor;
}

export interface RetentionSample {
  /** 对外 ID(reg_… / 表名+主键),日志里不出现裸 UUID 与明文 PII */
  ref: string;
  detail?: string;
}

export interface RetentionRuleReport {
  rule: RetentionRuleKey;
  days: number;
  action: RetentionAction;
  /** dry-run 时是「将被处理」的条数,真跑时是「已处理」的条数 */
  count: number;
  /** 字段级规则额外统计被清除的字段数 */
  fieldsCleared?: number;
  samples: RetentionSample[];
}

export interface RetentionOrgReport {
  organizationId: string;
  organizationSlug: string;
  retentionDays: number;
  counts: Record<RetentionRuleKey, number>;
}

export interface RetentionReport {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totals: Record<RetentionRuleKey, number>;
  rules: RetentionRuleReport[];
  organizations: RetentionOrgReport[];
}

/** 系统范围审计条目的组织位(auth_sessions 等不归属单一组织) */
export const SYSTEM_SCOPE_ORG = '00000000-0000-0000-0000-000000000000';

function emptyCounts(): Record<RetentionRuleKey, number> {
  return {
    registration_pii: 0,
    special_category: 0,
    email_logs: 0,
    access_logs: 0,
    incomplete_drafts: 0,
    audit_logs: 0,
  };
}

/** 掩码邮箱:日志与 dry-run 输出里不出现完整地址 */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  return `${head}${'*'.repeat(Math.max(local.length - 1, 1))}@${domain}`;
}

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 86_400_000);
}

/**
 * 每日保留期任务(ch09 §9.5:BullMQ repeatable,每日 04:00 UTC)。
 * dryRun: true 时一行都不写,只返回将被处理的条数与样例。
 */
export async function runRetention(
  opts: RetentionOptions = {},
  db: Db = defaultDb,
): Promise<RetentionReport> {
  const now = opts.now ?? new Date();
  const dryRun = opts.dryRun ?? false;
  const sampleLimit = opts.sampleLimit ?? 5;
  const actor: Actor = opts.actor ?? { type: 'system' };
  const startedAt = Date.now();

  const orgRows = await db.select({
    id: organizations.id,
    slug: organizations.slug,
    retentionDays: organizations.retentionDays,
  }).from(organizations).where(
    opts.organizationId ? eq(organizations.id, opts.organizationId) : sql`true`,
  );

  const perOrg = new Map<string, RetentionOrgReport>();
  for (const o of orgRows) {
    perOrg.set(o.id, {
      organizationId: o.id,
      organizationSlug: o.slug,
      retentionDays: o.retentionDays,
      counts: emptyCounts(),
    });
  }
  const orgIds = orgRows.map((o) => o.id);
  const orgFilter = opts.organizationId
    ? inArray(events.organizationId, orgIds.length ? orgIds : [SYSTEM_SCOPE_ORG])
    : sql`true`;

  const rules: RetentionRuleReport[] = [];
  const totals = emptyCounts();

  const bump = (organizationId: string, key: RetentionRuleKey, n = 1): void => {
    totals[key] += n;
    const org = perOrg.get(organizationId);
    if (org) org.counts[key] += n;
  };

  /* --- 规则 1:报名 PII，活动结束后 organizations.retention_days 天 --- */
  {
    const rule = retentionRule('registration_pii');
    const due = await db.select({
      id: registrations.id,
      email: registrations.email,
      organizationId: events.organizationId,
      eventId: registrations.eventId,
    })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .innerJoin(organizations, eq(organizations.id, events.organizationId))
      .where(and(
        orgFilter,
        sql`${events.endsAt} + (${organizations.retentionDays} * interval '1 day') < ${now.toISOString()}::timestamptz`,
        sql`${registrations.email} NOT LIKE 'anon-%@invalid'`,
      ));

    const samples: RetentionSample[] = due.slice(0, sampleLimit).map((r) => ({
      ref: encodeId('registration', r.id),
      detail: maskEmail(r.email),
    }));

    let fieldsCleared = 0;
    if (!dryRun) {
      for (const row of due) {
        const result = await db.transaction(async (tx) => {
          const r = await anonymizeRegistrationRow(tx as unknown as Db, row.id, { now });
          if (!r) return null;
          await audit(tx as unknown as Db, {
            organizationId: row.organizationId,
            eventId: row.eventId,
            actorType: actor.type,
            actorId: actor.id ?? null,
            action: 'retention.purge',
            targetType: 'registration',
            targetId: row.id,
            // diff 不含任何 pii 明文,只记录被清除的字段名(ch09 §9.5)
            diff: {
              rule: rule.key, action: rule.action,
              clearedKeys: r.clearedKeys,
              anonymizedUser: r.anonymizedUserId != null,
              maskedOrder: r.maskedOrderId != null,
            },
          });
          return r;
        });
        if (result) fieldsCleared += result.clearedKeys.length;
        bump(row.organizationId, rule.key);
      }
    } else {
      for (const row of due) bump(row.organizationId, rule.key);
    }

    rules.push({
      rule: rule.key, days: rule.days, action: rule.action,
      count: due.length, fieldsCleared: dryRun ? undefined : fieldsCleared, samples,
    });
  }

  /* --- 规则 2:特殊类别字段(饮食、无障碍),活动结束后 30 天硬删除 --- */
  {
    const rule = retentionRule('special_category');
    const cutoff = daysAgo(now, rule.days);
    const candidates = await db.select({
      id: registrations.id,
      answers: registrations.answers,
      formId: registrations.formId,
      eventId: registrations.eventId,
      organizationId: events.organizationId,
    })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(and(orgFilter, lt(events.endsAt, cutoff)));

    // 表单字段按 formId 缓存,避免逐行查表
    const fieldCache = new Map<string, string[]>();
    const targets: { id: string; organizationId: string; eventId: string; keys: string[] }[] = [];
    for (const row of candidates) {
      let keys = fieldCache.get(row.formId);
      if (!keys) {
        const [form] = await db.select({ fields: registrationForms.fields })
          .from(registrationForms).where(eq(registrationForms.id, row.formId)).limit(1);
        keys = specialCategoryKeys((form?.fields ?? []) as FormField[]);
        fieldCache.set(row.formId, keys);
      }
      const present = keys.filter((k) => k in row.answers);
      if (present.length > 0) {
        targets.push({
          id: row.id, organizationId: row.organizationId,
          eventId: row.eventId, keys: present,
        });
      }
    }

    const samples: RetentionSample[] = targets.slice(0, sampleLimit).map((t) => ({
      ref: encodeId('registration', t.id),
      detail: t.keys.join(', '),
    }));

    let fieldsCleared = 0;
    if (!dryRun) {
      for (const t of targets) {
        await db.transaction(async (tx) => {
          const [reg] = await tx.select({ answers: registrations.answers })
            .from(registrations).where(eq(registrations.id, t.id)).limit(1);
          if (!reg) return;
          const { answers, cleared } = clearAnswerKeys(reg.answers, t.keys);
          fieldsCleared += cleared.length;
          await tx.update(registrations)
            .set({ answers, updatedAt: now })
            .where(eq(registrations.id, t.id));
          await audit(tx as unknown as Db, {
            organizationId: t.organizationId,
            eventId: t.eventId,
            actorType: actor.type,
            actorId: actor.id ?? null,
            action: 'retention.purge',
            targetType: 'registration',
            targetId: t.id,
            diff: { rule: rule.key, action: rule.action, clearedKeys: cleared },
          });
        });
        bump(t.organizationId, rule.key);
      }
    } else {
      for (const t of targets) bump(t.organizationId, rule.key);
    }

    rules.push({
      rule: rule.key, days: rule.days, action: rule.action,
      count: targets.length, fieldsCleared: dryRun ? undefined : fieldsCleared, samples,
    });
  }

  /* --- 规则 3:邮件送达元数据 90 天硬删除 --- */
  {
    const rule = retentionRule('email_logs');
    const cutoff = daysAgo(now, rule.days);
    const where = opts.organizationId
      ? and(lt(emailLogs.createdAt, cutoff), eq(emailLogs.organizationId, opts.organizationId))
      : lt(emailLogs.createdAt, cutoff);
    const due = await db.select({ id: emailLogs.id, organizationId: emailLogs.organizationId })
      .from(emailLogs).where(where);
    const samples: RetentionSample[] = due.slice(0, sampleLimit)
      .map((r) => ({ ref: `email_logs/${r.id}` }));
    if (!dryRun && due.length > 0) {
      await db.delete(emailLogs).where(where);
    }
    for (const r of due) bump(r.organizationId, rule.key);
    rules.push({
      rule: rule.key, days: rule.days, action: rule.action, count: due.length, samples,
    });
  }

  /* --- 规则 4:访问日志(IP、UA)90 天硬删除 --- *
   * 会话不归属单一组织,因此只在全量运行时执行(--org 补跑不碰它)。 */
  {
    const rule = retentionRule('access_logs');
    const cutoff = daysAgo(now, rule.days);
    const [{ n = 0 } = { n: 0 }] = opts.organizationId
      ? [{ n: 0 }]
      : await db.select({ n: count() })
        .from(sessionsAuth).where(lt(sessionsAuth.createdAt, cutoff));
    if (!dryRun && n > 0) {
      await db.delete(sessionsAuth).where(lt(sessionsAuth.createdAt, cutoff));
    }
    totals.access_logs += n;
    rules.push({
      rule: rule.key, days: rule.days, action: rule.action, count: n,
      samples: n > 0 ? [{ ref: 'auth_sessions', detail: `${n} 行(IP/UA)` }] : [],
    });
  }

  /* --- 规则 5:未完成的报名草稿 30 天硬删除 --- */
  {
    const rule = retentionRule('incomplete_drafts');
    const cutoff = daysAgo(now, rule.days);
    // 「未完成」= 从未确认、从未签到,且没有已付款订单;付款过的记录属交易记录,按法定义务保留
    const due = await db.select({
      id: registrations.id,
      email: registrations.email,
      eventId: registrations.eventId,
      organizationId: events.organizationId,
    })
      .from(registrations)
      .innerJoin(events, eq(events.id, registrations.eventId))
      .where(and(
        orgFilter,
        inArray(registrations.status, ['awaiting_payment', 'expired']),
        sql`${registrations.confirmedAt} IS NULL`,
        sql`${registrations.checkedInAt} IS NULL`,
        lt(registrations.createdAt, cutoff),
        sql`(${registrations.orderId} IS NULL OR EXISTS (
          SELECT 1 FROM ${orders} o
          WHERE o.id = ${registrations.orderId}
            AND o.status NOT IN ('paid','partially_refunded','refunded')
        ))`,
      ));

    const samples: RetentionSample[] = due.slice(0, sampleLimit).map((r) => ({
      ref: encodeId('registration', r.id),
      detail: maskEmail(r.email),
    }));

    if (!dryRun) {
      for (const row of due) {
        await db.transaction(async (tx) => {
          await tx.delete(registrations).where(eq(registrations.id, row.id));
          await audit(tx as unknown as Db, {
            organizationId: row.organizationId,
            eventId: row.eventId,
            actorType: actor.type,
            actorId: actor.id ?? null,
            action: 'retention.purge',
            targetType: 'registration',
            targetId: row.id,
            diff: { rule: rule.key, action: rule.action },
          });
        });
        bump(row.organizationId, rule.key);
      }
    } else {
      for (const row of due) bump(row.organizationId, rule.key);
    }

    rules.push({
      rule: rule.key, days: rule.days, action: rule.action, count: due.length, samples,
    });
  }

  /* --- 规则 6:审计日志 2 年后主体假名化 --- *
   * 只清除 ip：actor_id 是 UUID 假名(其主体已由规则 1 匿名化),且参与哈希链计算,
   * 改写它会使 ch12 §12.5 的全链校验断裂 —— 假名化不能以毁掉完整性证明为代价。 */
  {
    const rule = retentionRule('audit_logs');
    const cutoff = daysAgo(now, rule.days);
    const where = opts.organizationId
      ? and(lt(auditLogs.createdAt, cutoff), isNotNull(auditLogs.ip),
          eq(auditLogs.organizationId, opts.organizationId))
      : and(lt(auditLogs.createdAt, cutoff), isNotNull(auditLogs.ip));
    const due = await db.select({
      id: auditLogs.id, organizationId: auditLogs.organizationId,
    }).from(auditLogs).where(where);
    const samples: RetentionSample[] = due.slice(0, sampleLimit)
      .map((r) => ({ ref: `audit_logs/${r.id}`, detail: 'ip → null' }));
    if (!dryRun && due.length > 0) {
      await db.update(auditLogs).set({ ip: null }).where(where);
    }
    for (const r of due) bump(r.organizationId, rule.key);
    rules.push({
      rule: rule.key, days: rule.days, action: rule.action, count: due.length, samples,
    });
  }

  const finished = Date.now();
  const report: RetentionReport = {
    dryRun,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - startedAt,
    totals,
    rules,
    organizations: [...perOrg.values()],
  };

  /* 每次运行写审计日志,记录各类清理的条数(dry-run 不写:它没有改变任何数据) */
  if (!dryRun) {
    for (const org of report.organizations) {
      const touched = Object.values(org.counts).some((n) => n > 0);
      if (!touched) continue;
      await audit(db, {
        organizationId: org.organizationId,
        actorType: actor.type,
        actorId: actor.id ?? null,
        action: 'retention.purge',
        targetType: 'organization',
        targetId: org.organizationId,
        diff: { scope: 'organization', retentionDays: org.retentionDays, counts: org.counts },
      });
    }
    await audit(db, {
      organizationId: SYSTEM_SCOPE_ORG,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'retention.purge',
      targetType: 'system',
      targetId: SYSTEM_SCOPE_ORG,
      diff: {
        scope: 'run', totals, durationMs: report.durationMs,
        rules: report.rules.map((r) => ({ rule: r.rule, days: r.days, count: r.count })),
      },
    });
  }

  return report;
}

/** 把报告渲染成一行行人类可读文本(worker 日志与 CLI dry-run 输出) */
export function formatRetentionReport(report: RetentionReport): string[] {
  const lines: string[] = [];
  lines.push(
    `[retention] ${report.dryRun ? 'DRY-RUN(不写库)' : '已执行'} ` +
    `${report.startedAt} → ${report.finishedAt} (${report.durationMs}ms)`,
  );
  for (const r of report.rules) {
    const rule = retentionRule(r.rule);
    const head = `  ${r.rule.padEnd(18)} ${String(r.days).padStart(4)}d ` +
      `${r.action.padEnd(12)} ${report.dryRun ? '将处理' : '已处理'} ${r.count} 条` +
      (r.fieldsCleared != null ? `,清除字段 ${r.fieldsCleared} 个` : '') +
      `  — ${rule.effect.zh}`;
    lines.push(head);
    for (const s of r.samples) {
      lines.push(`      · ${s.ref}${s.detail ? ` (${s.detail})` : ''}`);
    }
  }
  for (const org of report.organizations) {
    const touched = Object.entries(org.counts).filter(([, n]) => n > 0);
    if (touched.length === 0) continue;
    lines.push(
      `  组织 ${org.organizationSlug}(retentionDays=${org.retentionDays}): ` +
      touched.map(([k, n]) => `${k}=${n}`).join(', '),
    );
  }
  return lines;
}
