/**
 * GDPR 权利的产品化实现(ch12 §12.4)
 *
 * 每一项数据主体权利都是一个参会者可自助触达的功能,而不是「发邮件给 DPO 等 30 天」:
 *   知情 Art. 13/14 → buildPrivacyNotice():字段清单由 registration_forms.fields 自动生成
 *   访问 Art. 15    → exportRegistrationData():/r/{token} 免登录导出全部个人数据
 *   更正 Art. 16    → correctRegistrationAnswers():报名确认前可自行修改答案
 *   删除 Art. 17    → requestErasure() → confirmErasure():两步、不可逆,立即匿名化
 *   限制处理 Art. 18 → setProcessingRestriction():退出名单展示 / 冻结处理
 *   可携 Art. 20    → 与 Art. 15 同一份机器可读 JSON
 *   反对 Art. 21    → setProcessingRestriction() 的 listOptOut
 *
 * 所有请求写审计日志(ch12 §12.5);匿名化调用 ./retention.ts 的同一套字段级清除引擎,
 * 保证「到期清理」与「按请求删除」行为一致(ch12 §12.3)。
 */
import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  db as defaultDb, registrations, registrationForms, events, organizations, orders, tickets,
  type Db,
} from '@yumeet/db';
import {
  validateAnswers, piiKeys, localize, type FormField, type I18nString,
} from '../forms/types';
import { audit, hashToken, safeCompare, timelineFor } from '../audit/index';
import { encodeId } from '../ids/index';
import type { RegStatus } from '../state/index';
import type { Actor } from './registration';
import {
  RETENTION_RULES, anonymizeRegistrationRow, isSpecialCategoryField, retentionRule,
  maskEmail, isAnonymizedEmail,
} from './retention';

export class GdprError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'GdprError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** answers 里的保留键:隐私偏好与删除请求,不属于表单字段,校验前会被剥离 */
export const PRIVACY_KEY = '__privacy';

export interface PrivacyPreferences {
  /** Art. 21 反对 / ch12 §12.3 展示默认关闭:退出公开参会者名单 */
  listOptOut: boolean;
  /** Art. 18 限制处理:记录冻结,排除于导出、邮件与统计 */
  restricted: boolean;
  updatedAt?: string;
}

interface ErasureRequestState {
  requestedAt: string;
  expiresAt: string;
  tokenHash: string;
}

interface PrivacyBlock extends PrivacyPreferences {
  erasure?: ErasureRequestState;
  erasedAt?: string;
}

export const DEFAULT_PRIVACY: PrivacyPreferences = { listOptOut: false, restricted: false };

/** 删除确认令牌有效期:够用户读完二次确认页,又不至于长期悬挂 */
export const ERASURE_CONFIRM_TTL_MS = 30 * 60 * 1000;

function readPrivacy(answers: Record<string, unknown>): PrivacyBlock {
  const raw = answers[PRIVACY_KEY];
  if (raw == null || typeof raw !== 'object') return { ...DEFAULT_PRIVACY };
  const o = raw as Record<string, unknown>;
  return {
    listOptOut: o['listOptOut'] === true,
    restricted: o['restricted'] === true,
    updatedAt: typeof o['updatedAt'] === 'string' ? o['updatedAt'] : undefined,
    erasedAt: typeof o['erasedAt'] === 'string' ? o['erasedAt'] : undefined,
    erasure: isErasureState(o['erasure']) ? o['erasure'] : undefined,
  };
}

function isErasureState(v: unknown): v is ErasureRequestState {
  if (v == null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['requestedAt'] === 'string'
    && typeof o['expiresAt'] === 'string'
    && typeof o['tokenHash'] === 'string';
}

/** 表单答案(剥离保留键)—— 一切校验与展示都基于它 */
export function formAnswers(answers: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(answers)) {
    if (k.startsWith('__')) continue;
    out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * 主体加载:/r/{token} 凭证,不需要账户(ch05 §5.5 + ch12 §12.4)
 * ------------------------------------------------------------------ */

export interface DataSubject {
  registration: typeof registrations.$inferSelect;
  event: typeof events.$inferSelect;
  organization: typeof organizations.$inferSelect;
  form: typeof registrationForms.$inferSelect | undefined;
  ticket: typeof tickets.$inferSelect | undefined;
  order: typeof orders.$inferSelect | undefined;
  fields: FormField[];
  privacy: PrivacyBlock;
  /** 报名确认前可自助更正(Art. 16) */
  correctable: boolean;
  /** 已匿名化的记录不再提供更正与再次删除 */
  erased: boolean;
}

/** 报名确认前允许更正(ch12 §12.4 Art. 16) */
const CORRECTABLE_STATUSES: readonly RegStatus[] = ['pending_review', 'waitlisted', 'awaiting_payment'];

export async function loadDataSubject(
  token: string,
  db: Db = defaultDb,
): Promise<DataSubject | null> {
  const [reg] = await db.select().from(registrations)
    .where(eq(registrations.accessTokenHash, hashToken(token))).limit(1);
  if (!reg) return null;

  const [event] = await db.select().from(events).where(eq(events.id, reg.eventId)).limit(1);
  if (!event) return null;
  const [organization] = await db.select().from(organizations)
    .where(eq(organizations.id, event.organizationId)).limit(1);
  if (!organization) return null;

  const [form] = await db.select().from(registrationForms)
    .where(eq(registrationForms.id, reg.formId)).limit(1);
  const ticket = reg.ticketId
    ? (await db.select().from(tickets).where(eq(tickets.id, reg.ticketId)).limit(1))[0]
    : undefined;
  const order = reg.orderId
    ? (await db.select().from(orders).where(eq(orders.id, reg.orderId)).limit(1))[0]
    : undefined;

  const erased = isAnonymizedEmail(reg.email);
  return {
    registration: reg,
    event,
    organization,
    form,
    ticket,
    order,
    fields: (form?.fields ?? []) as FormField[],
    privacy: readPrivacy(reg.answers),
    correctable: !erased && CORRECTABLE_STATUSES.includes(reg.status as RegStatus),
    erased,
  };
}

async function requireSubject(token: string, db: Db): Promise<DataSubject> {
  const subject = await loadDataSubject(token, db);
  if (!subject) throw new GdprError('not_found', '凭证无效或已失效', 404);
  return subject;
}

/* ------------------------------------------------------------------ *
 * Art. 15 访问权 / Art. 20 可携带权
 * ------------------------------------------------------------------ */

export const EXPORT_FORMAT = 'yumeet.data-export/v1';

export interface ExportedAnswer {
  key: string;
  label: I18nString;
  kind: string;
  pii: boolean;
  specialCategory: boolean;
  value: unknown;
}

export interface RegistrationExport {
  format: typeof EXPORT_FORMAT;
  generatedAt: string;
  legalBasis: string;
  controller: {
    organization: string;
    slug: string;
    contactEmail: string | null;
    role: string;
  };
  event: {
    id: string; title: string; slug: string;
    startsAt: string; endsAt: string; timezone: string;
  };
  subject: {
    registrationId: string;
    email: string;
    status: RegStatus;
    confirmationCode: string;
    formVersion: number;
    createdAt: string;
    updatedAt: string;
    confirmedAt: string | null;
    checkedInAt: string | null;
    cancelledAt: string | null;
    waitlistPosition: number | null;
  };
  answers: ExportedAnswer[];
  ticket: { id: string; name: string; priceCents: number; currency: string } | null;
  order: {
    id: string; status: string; totalCents: number; currency: string;
    paidAt: string | null; refundedAt: string | null;
  } | null;
  privacyPreferences: PrivacyPreferences;
  statusHistory: { at: string; action: string; detail: Record<string, unknown> | null }[];
  retention: {
    registrationPiiDays: number;
    registrationPiiUntil: string;
    specialCategoryUntil: string;
    rules: { rule: string; days: number; action: string; effect: string }[];
  };
  yourRights: { right: string; article: string; how: string }[];
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

/**
 * 导出全部个人数据(Art. 15 访问 + Art. 20 可携带):
 * 机器可读 JSON,凭 /r/{token} 即可,不需要账户。每次导出写审计。
 */
export async function exportRegistrationData(
  token: string,
  opts: { actor?: Actor; db?: Db } = {},
): Promise<RegistrationExport> {
  const db = opts.db ?? defaultDb;
  const actor: Actor = opts.actor ?? { type: 'user' };
  const s = await requireSubject(token, db);
  const reg = s.registration;

  const answers = formAnswers(reg.answers);
  const declared = new Set(s.fields.map((f) => f.key));
  const exported: ExportedAnswer[] = s.fields.map((f) => ({
    key: f.key,
    label: f.label,
    kind: f.kind,
    pii: f.pii === true,
    specialCategory: isSpecialCategoryField(f),
    value: answers[f.key] ?? null,
  }));
  // 表单版本变更后遗留的答案同样属于「你的数据」,不能因为字段被删就不给
  for (const [k, v] of Object.entries(answers)) {
    if (declared.has(k)) continue;
    exported.push({ key: k, label: k, kind: 'unknown', pii: false, specialCategory: false, value: v });
  }

  const history = await timelineFor(db, 'registration', reg.id);
  const piiRule = retentionRule('registration_pii');
  const specialRule = retentionRule('special_category');
  const day = 86_400_000;

  const result: RegistrationExport = {
    format: EXPORT_FORMAT,
    generatedAt: new Date().toISOString(),
    legalBasis: 'GDPR Art. 15 (access) & Art. 20 (portability)',
    controller: {
      organization: s.organization.name,
      slug: s.organization.slug,
      contactEmail: s.organization.settings.contactEmail ?? null,
      role: 'controller',
    },
    event: {
      id: encodeId('event', s.event.id),
      title: s.event.title,
      slug: s.event.slug,
      startsAt: s.event.startsAt.toISOString(),
      endsAt: s.event.endsAt.toISOString(),
      timezone: s.event.timezone,
    },
    subject: {
      registrationId: encodeId('registration', reg.id),
      email: reg.email,
      status: reg.status as RegStatus,
      confirmationCode: reg.confirmationCode,
      formVersion: reg.formVersion,
      createdAt: reg.createdAt.toISOString(),
      updatedAt: reg.updatedAt.toISOString(),
      confirmedAt: iso(reg.confirmedAt),
      checkedInAt: iso(reg.checkedInAt),
      cancelledAt: iso(reg.cancelledAt),
      waitlistPosition: reg.waitlistPosition,
    },
    answers: exported,
    ticket: s.ticket
      ? {
          id: encodeId('ticket', s.ticket.id), name: s.ticket.name,
          priceCents: s.ticket.priceCents, currency: s.ticket.currency,
        }
      : null,
    order: s.order
      ? {
          id: encodeId('order', s.order.id), status: s.order.status,
          totalCents: s.order.totalCents, currency: s.order.currency,
          paidAt: iso(s.order.paidAt), refundedAt: iso(s.order.refundedAt),
        }
      : null,
    privacyPreferences: {
      listOptOut: s.privacy.listOptOut,
      restricted: s.privacy.restricted,
      updatedAt: s.privacy.updatedAt,
    },
    statusHistory: history.map((h) => ({
      at: h.createdAt.toISOString(),
      action: h.action,
      detail: (h.diff ?? null) as Record<string, unknown> | null,
    })),
    retention: {
      registrationPiiDays: s.organization.retentionDays,
      registrationPiiUntil: new Date(
        s.event.endsAt.getTime() + s.organization.retentionDays * day,
      ).toISOString(),
      specialCategoryUntil: new Date(
        s.event.endsAt.getTime() + specialRule.days * day,
      ).toISOString(),
      rules: RETENTION_RULES.map((r) => ({
        rule: r.key, days: r.key === piiRule.key ? s.organization.retentionDays : r.days,
        action: r.action, effect: r.effect.en,
      })),
    },
    yourRights: [
      { right: 'access', article: 'Art. 15', how: 'GET /r/{token}/data/export' },
      { right: 'rectification', article: 'Art. 16', how: '/r/{token}/data — edit answers before confirmation' },
      { right: 'erasure', article: 'Art. 17', how: '/r/{token}/data — request, then confirm' },
      { right: 'restriction', article: 'Art. 18', how: '/r/{token}/data — restrict processing' },
      { right: 'portability', article: 'Art. 20', how: 'this JSON document' },
      { right: 'objection', article: 'Art. 21', how: '/r/{token}/data — opt out of the public list' },
    ],
  };

  await audit(db, {
    organizationId: s.organization.id,
    eventId: s.event.id,
    actorType: actor.type,
    actorId: actor.id ?? null,
    action: 'registration.export',
    targetType: 'registration',
    targetId: reg.id,
    diff: { scope: 'self_service', right: 'art_15_20', rows: 1, fields: exported.length },
    ip: actor.ip ?? null,
  });

  return result;
}

/* ------------------------------------------------------------------ *
 * Art. 16 更正权
 * ------------------------------------------------------------------ */

export interface CorrectionResult {
  changedKeys: string[];
  answers: Record<string, unknown>;
}

/**
 * 修改自己报名表单的答案(报名确认前)。
 * 走字段引擎的同一套校验(ch09 §9.3),审计 diff 里 pii 字段只记键名不记值。
 */
export async function correctRegistrationAnswers(
  token: string,
  patch: Record<string, unknown>,
  opts: { actor?: Actor; db?: Db } = {},
): Promise<CorrectionResult> {
  const db = opts.db ?? defaultDb;
  const actor: Actor = opts.actor ?? { type: 'user' };
  const s = await requireSubject(token, db);
  if (s.erased) throw new GdprError('erased', '该报名已按删除请求匿名化,不能再修改', 409);
  if (!s.correctable) {
    throw new GdprError(
      'not_correctable',
      '报名已确认或已进入终态,自助修改已关闭,请联系组织者',
      409,
    );
  }

  const current = formAnswers(s.registration.answers);
  const merged: Record<string, unknown> = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    if (k.startsWith('__')) continue;
    if (v === undefined || v === null || v === '') { delete merged[k]; continue; }
    merged[k] = v;
  }

  const parsed = validateAnswers(s.fields, merged);
  if (!parsed.success) {
    throw new GdprError(
      'validation_failed',
      `表单校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      422,
    );
  }
  const next = parsed.data as Record<string, unknown>;

  const pii = new Set(piiKeys(s.fields));
  const changedKeys: string[] = [];
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)])) {
    if (JSON.stringify(current[key]) !== JSON.stringify(next[key])) changedKeys.push(key);
  }
  if (changedKeys.length === 0) return { changedKeys: [], answers: next };

  const privacyBlock = s.registration.answers[PRIVACY_KEY];
  const stored: Record<string, unknown> = { ...next };
  if (privacyBlock !== undefined) stored[PRIVACY_KEY] = privacyBlock;

  await db.transaction(async (tx) => {
    await tx.update(registrations)
      .set({ answers: stored, updatedAt: new Date() })
      .where(eq(registrations.id, s.registration.id));
    await audit(tx as unknown as Db, {
      organizationId: s.organization.id,
      eventId: s.event.id,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'registration.corrected',
      targetType: 'registration',
      targetId: s.registration.id,
      // pii 字段写入前脱敏(ch09 §9.5):只记录「哪个字段变了」
      diff: {
        right: 'art_16',
        changedKeys,
        values: Object.fromEntries(changedKeys.map((k) => [
          k, pii.has(k) ? '[redacted]' : (next[k] ?? null),
        ])),
      },
      ip: actor.ip ?? null,
    });
  });

  return { changedKeys, answers: next };
}

/* ------------------------------------------------------------------ *
 * Art. 18 限制处理 / Art. 21 反对
 * ------------------------------------------------------------------ */

export async function setProcessingRestriction(
  token: string,
  prefs: { listOptOut?: boolean; restricted?: boolean },
  opts: { actor?: Actor; db?: Db } = {},
): Promise<PrivacyPreferences> {
  const db = opts.db ?? defaultDb;
  const actor: Actor = opts.actor ?? { type: 'user' };
  const s = await requireSubject(token, db);

  const next: PrivacyBlock = {
    ...s.privacy,
    listOptOut: prefs.listOptOut ?? s.privacy.listOptOut,
    restricted: prefs.restricted ?? s.privacy.restricted,
    updatedAt: new Date().toISOString(),
  };

  const answers: Record<string, unknown> = { ...s.registration.answers, [PRIVACY_KEY]: next };

  await db.transaction(async (tx) => {
    await tx.update(registrations)
      .set({ answers, updatedAt: new Date() })
      .where(eq(registrations.id, s.registration.id));
    await audit(tx as unknown as Db, {
      organizationId: s.organization.id,
      eventId: s.event.id,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'registration.restricted',
      targetType: 'registration',
      targetId: s.registration.id,
      diff: {
        right: 'art_18_21',
        from: { listOptOut: s.privacy.listOptOut, restricted: s.privacy.restricted },
        to: { listOptOut: next.listOptOut, restricted: next.restricted },
      },
      ip: actor.ip ?? null,
    });
  });

  return { listOptOut: next.listOptOut, restricted: next.restricted, updatedAt: next.updatedAt };
}

/** 公开名单是否应展示这条报名(ch12 §12.3 展示默认关闭 + Art. 21 撤回) */
export function isListable(answers: Record<string, unknown>): boolean {
  const p = readPrivacy(answers);
  return !p.listOptOut && !p.restricted;
}

/* ------------------------------------------------------------------ *
 * Art. 17 删除权:显式两步 API(requestErasure → confirmErasure)
 * ------------------------------------------------------------------ */

export interface ErasureRequest {
  requestedAt: string;
  expiresAt: string;
  /** 第二步必须回传的确认令牌;只在本次响应里出现,库里只存哈希 */
  confirmationToken: string;
  /** 将被清除的字段(逐字段确定性,ch09 §9.5) */
  willClear: string[];
  /** 按法定义务保留但会脱敏的记录 */
  willRetainMasked: string[];
}

/** 第一步:提交删除请求,返回二次确认所需的令牌 —— 本步不删除任何数据 */
export async function requestErasure(
  token: string,
  opts: { actor?: Actor; db?: Db; now?: Date } = {},
): Promise<ErasureRequest> {
  const db = opts.db ?? defaultDb;
  const actor: Actor = opts.actor ?? { type: 'user' };
  const now = opts.now ?? new Date();
  const s = await requireSubject(token, db);
  if (s.erased) throw new GdprError('already_erased', '该报名的个人数据已被清除', 409);

  const confirmationToken = randomBytes(16).toString('base64url');
  const expiresAt = new Date(now.getTime() + ERASURE_CONFIRM_TTL_MS);
  const willClear = [
    'email',
    ...piiKeys(s.fields).filter((k) => k in formAnswers(s.registration.answers)),
  ];
  const willRetainMasked = [
    ...(s.order ? ['order'] : []),
    'audit_log',
  ];

  const nextPrivacy: PrivacyBlock = {
    ...s.privacy,
    erasure: {
      requestedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      tokenHash: hashToken(confirmationToken),
    },
  };
  const answers: Record<string, unknown> = {
    ...s.registration.answers, [PRIVACY_KEY]: nextPrivacy,
  };

  await db.transaction(async (tx) => {
    await tx.update(registrations)
      .set({ answers, updatedAt: now })
      .where(eq(registrations.id, s.registration.id));
    await audit(tx as unknown as Db, {
      organizationId: s.organization.id,
      eventId: s.event.id,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'registration.erasure_requested',
      targetType: 'registration',
      targetId: s.registration.id,
      diff: { right: 'art_17', step: 'request', willClear, expiresAt: expiresAt.toISOString() },
      ip: actor.ip ?? null,
    });
  });

  return {
    requestedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    confirmationToken,
    willClear,
    willRetainMasked,
  };
}

export interface ErasureResult {
  erasedAt: string;
  /** 匿名化后的邮箱:anon-{id}@invalid */
  email: string;
  clearedKeys: string[];
  anonymizedUser: boolean;
  /** 交易记录按法定义务保留,但已脱敏 */
  retainedMasked: string[];
}

/**
 * 第二步:确认删除 —— 不可逆。
 * 立即按 ch09 §9.5 的确定性定义匿名化 PII;交易记录保留但脱敏。
 */
export async function confirmErasure(
  token: string,
  confirmationToken: string,
  opts: { actor?: Actor; db?: Db; now?: Date } = {},
): Promise<ErasureResult> {
  const db = opts.db ?? defaultDb;
  const actor: Actor = opts.actor ?? { type: 'user' };
  const now = opts.now ?? new Date();
  const s = await requireSubject(token, db);
  if (s.erased) throw new GdprError('already_erased', '该报名的个人数据已被清除', 409);

  const pending = s.privacy.erasure;
  if (!pending) throw new GdprError('no_pending_request', '没有待确认的删除请求', 409);
  if (new Date(pending.expiresAt) < now) {
    throw new GdprError('request_expired', '删除请求已过期,请重新发起', 410);
  }
  if (!safeCompare(hashToken(confirmationToken), pending.tokenHash)) {
    throw new GdprError('bad_confirmation', '确认令牌不正确', 403);
  }

  const result = await db.transaction(async (tx) => {
    const r = await anonymizeRegistrationRow(tx as unknown as Db, s.registration.id, { now });
    if (!r) throw new GdprError('not_found', '报名记录不存在', 404);

    // 隐私块保留 —— 记录「已按请求删除」,但清掉确认令牌
    const [after] = await tx.select({ answers: registrations.answers })
      .from(registrations).where(eq(registrations.id, s.registration.id)).limit(1);
    const privacy: PrivacyBlock = {
      listOptOut: true,
      restricted: s.privacy.restricted,
      updatedAt: now.toISOString(),
      erasedAt: now.toISOString(),
    };
    await tx.update(registrations)
      .set({ answers: { ...(after?.answers ?? {}), [PRIVACY_KEY]: privacy }, updatedAt: now })
      .where(eq(registrations.id, s.registration.id));

    await audit(tx as unknown as Db, {
      organizationId: s.organization.id,
      eventId: s.event.id,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'account.delete',
      targetType: 'registration',
      targetId: s.registration.id,
      diff: {
        right: 'art_17', step: 'confirm',
        clearedKeys: r.clearedKeys,
        anonymizedUser: r.anonymizedUserId != null,
        maskedOrder: r.maskedOrderId != null,
        subject: maskEmail(s.registration.email),
      },
      ip: actor.ip ?? null,
    });
    return r;
  });

  return {
    erasedAt: now.toISOString(),
    email: result.email,
    clearedKeys: result.clearedKeys,
    anonymizedUser: result.anonymizedUserId != null,
    retainedMasked: result.maskedOrderId ? ['order'] : [],
  };
}

/* ------------------------------------------------------------------ *
 * Art. 13/14 知情:隐私声明由表单字段自动生成
 * ------------------------------------------------------------------ */

export interface CollectedField {
  key: string;
  label: I18nString;
  help?: I18nString;
  kind: string;
  required: boolean;
  pii: boolean;
  specialCategory: boolean;
  /** 适用的保留期规则(ch12 §12.3) */
  rule: 'registration_pii' | 'special_category';
  days: number;
}

export interface PrivacyNotice {
  controller: {
    name: string;
    slug: string;
    contactEmail: string | null;
    supportUrl: string | null;
    role: { zh: string; en: string };
  };
  event: {
    id: string; title: string; slug: string;
    startsAt: Date; endsAt: Date; timezone: string;
  };
  retentionDays: number;
  /** 报名 PII 的清除日期 = 活动结束 + retentionDays */
  piiClearedOn: Date;
  /** 特殊类别字段的硬删除日期 = 活动结束 + 30 天 */
  specialCategoryClearedOn: Date;
  fields: CollectedField[];
  rules: typeof RETENTION_RULES;
  hasSpecialCategory: boolean;
}

/** 从 registration_forms.fields 动态生成「收集了哪些字段」 */
export function describeCollectedFields(fields: FormField[]): CollectedField[] {
  return fields.map((f) => {
    const special = isSpecialCategoryField(f);
    return {
      key: f.key,
      label: f.label,
      help: f.help,
      kind: f.kind,
      required: f.required === true,
      pii: f.pii === true,
      specialCategory: special,
      rule: special ? 'special_category' : 'registration_pii',
      days: special ? retentionRule('special_category').days : retentionRule('registration_pii').days,
    };
  });
}

/** 隐私声明页 /{org}/{event}/privacy 的全部数据(ch12 §12.3「默认即合规」的可见落点) */
export async function buildPrivacyNotice(
  orgSlug: string,
  eventSlug: string,
  db: Db = defaultDb,
): Promise<PrivacyNotice | null> {
  const [org] = await db.select().from(organizations)
    .where(eq(organizations.slug, orgSlug)).limit(1);
  if (!org) return null;
  const [event] = await db.select().from(events)
    .where(eq(events.slug, eventSlug)).limit(1);
  if (!event || event.organizationId !== org.id) return null;

  const forms = await db.select().from(registrationForms)
    .where(eq(registrationForms.eventId, event.id));

  // 多份表单时合并字段清单,同名字段只列一次
  const seen = new Set<string>();
  const fields: CollectedField[] = [];
  for (const form of forms) {
    for (const f of describeCollectedFields((form.fields ?? []) as FormField[])) {
      if (seen.has(f.key)) continue;
      seen.add(f.key);
      fields.push(f);
    }
  }

  const day = 86_400_000;
  return {
    controller: {
      name: org.name,
      slug: org.slug,
      contactEmail: org.settings.contactEmail ?? null,
      supportUrl: org.settings.supportUrl ?? null,
      role: {
        zh: '数据控制者(自托管部署,同时为处理者)',
        en: 'Data controller (self-hosted deployment, also the processor)',
      },
    },
    event: {
      id: encodeId('event', event.id),
      title: event.title,
      slug: event.slug,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
    },
    retentionDays: org.retentionDays,
    piiClearedOn: new Date(event.endsAt.getTime() + org.retentionDays * day),
    specialCategoryClearedOn: new Date(
      event.endsAt.getTime() + retentionRule('special_category').days * day,
    ),
    fields,
    rules: RETENTION_RULES,
    hasSpecialCategory: fields.some((f) => f.specialCategory),
  };
}

/** 字段标签取当前语言(隐私页与数据页共用) */
export function fieldLabel(value: I18nString, locale: string): string {
  return localize(value, locale);
}
