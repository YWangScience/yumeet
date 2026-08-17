/**
 * 征稿与评审服务(ch04 §4.3 + ch09 §9.4 投稿状态机)
 * 业务逻辑唯一实现处 —— apps/web 经 Server Actions 进程内调用,apps/api 与 worker 同样 import 之。
 *
 * 写法与 services/registration.ts 一致:所有状态变更走 transitionSubmission(),
 * 同一事务内「校验迁移 → 更新行 → 写 audit_logs → 投 outbox」,副作用由 worker 在事务提交后投递。
 */
import { and, asc, desc, eq, inArray, sql, count } from 'drizzle-orm';
import {
  db as defaultDb, events, organizations, submissions, reviews, users, eventMembers, outbox,
  type Db, type Author,
} from '@yumeet/db';
import { assertSubmissionTransition, type SubStatus } from '../state/index';
import { validateAnswers, type FormField, type I18nString } from '../forms/types';
import { audit, generateAccessToken, hashToken, timelineFor } from '../audit/index';
import { encodeId } from '../ids/index';
import type { Actor } from './registration';

/** 作者结构(ch09 §9.2 submissions.authors),从 db 层透出,web/api 不必直连 @yumeet/db */
export type { Author } from '@yumeet/db';

/* ------------------------------------------------------------------ *
 * 错误类型
 * ------------------------------------------------------------------ */

export class SubmissionError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'SubmissionError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/* ------------------------------------------------------------------ *
 * CFP 配置(ch04 §4.3)
 * 尚无 cfp_configs 表(见 PLAN.md 模块 7 的后续迭代),此处给出规格中的默认配置:
 * track × 投稿类型 × 自定义问题(复用 ch09 §9.3 字段引擎)× 四档截止时间 × 评分维度。
 * ------------------------------------------------------------------ */

export interface CfpTrack {
  id: string;
  label: I18nString;
  /** track 级双盲开关(ch04 §4.3):开启后评审视图裁剪 authors 列 */
  doubleBlind: boolean;
}

export interface CfpType {
  id: string;
  label: I18nString;
}

export interface ScoreDimension {
  key: string;
  label: I18nString;
  min: number;
  max: number;
  /** 权重;总分为归一化后的加权平均(ch04 §4.3) */
  weight: number;
}

export interface CfpDeadlines {
  /** 提交 / 修改 / 评审 / 通知 四档(ch04 §4.3),均存 UTC */
  submission: Date;
  revision: Date;
  review: Date;
  notification: Date;
}

export interface CfpConfig {
  tracks: CfpTrack[];
  types: CfpType[];
  questions: FormField[];
  dimensions: ScoreDimension[];
  deadlines: CfpDeadlines;
  abstractMaxLength: number;
  /** 录用决议要求的最少评审数(ch09 §9.4 under_review → accepted 的 guard) */
  minReviews: number;
  /** 方差超过此值标记「意见分歧」,供 chair 优先讨论(ch04 §4.3) */
  disputeVariance: number;
}

export const CFP_TRACKS: CfpTrack[] = [
  { id: 'bh', label: { zh: '黑洞', en: 'Black Holes' }, doubleBlind: true },
  { id: 'gw', label: { zh: '引力波', en: 'Gravitational Waves' }, doubleBlind: true },
  { id: 'cosmo', label: { zh: '宇宙学', en: 'Cosmology' }, doubleBlind: true },
  { id: 'ns', label: { zh: '中子星', en: 'Neutron Stars' }, doubleBlind: true },
  { id: 'qg', label: { zh: '量子引力', en: 'Quantum Gravity' }, doubleBlind: true },
];

export const CFP_TYPES: CfpType[] = [
  { id: 'talk', label: { zh: '口头报告', en: 'Talk' } },
  { id: 'poster', label: { zh: '墙报', en: 'Poster' } },
];

/** 默认四维 + confidence(ch04 §4.3 评分维度表) */
export const SCORE_DIMENSIONS: ScoreDimension[] = [
  { key: 'novelty', label: { zh: '新颖性', en: 'Novelty' }, min: 1, max: 5, weight: 0.3 },
  { key: 'relevance', label: { zh: '相关性', en: 'Relevance' }, min: 1, max: 5, weight: 0.3 },
  { key: 'clarity', label: { zh: '清晰度', en: 'Clarity' }, min: 1, max: 5, weight: 0.2 },
  {
    key: 'recommendation',
    label: { zh: '总评', en: 'Recommendation' },
    min: -3, max: 3, weight: 0.2,
  },
];

/** CFP 自定义问题:复用注册表单的字段引擎(ch09 §9.3),同一份定义前后端共用 */
export const CFP_QUESTIONS: FormField[] = [
  {
    kind: 'short_text',
    key: 'keywords',
    label: { zh: '关键词', en: 'Keywords' },
    help: { zh: '用逗号分隔,最多 5 个', en: 'Comma separated, up to five' },
    required: true,
    maxLength: 200,
  },
  {
    kind: 'select',
    key: 'presentation_pref',
    label: { zh: '展示形式偏好', en: 'Presentation preference' },
    help: {
      zh: '若程序委员会调整形式,我们会以此为参考。',
      en: 'Used as guidance if the committee reassigns the format.',
    },
    options: [
      { value: 'either', label: { zh: '口头或墙报均可', en: 'Talk or poster' } },
      { value: 'talk_only', label: { zh: '仅接受口头报告', en: 'Talk only' } },
      { value: 'poster_only', label: { zh: '仅接受墙报', en: 'Poster only' } },
    ],
  },
  {
    kind: 'boolean',
    key: 'blind_ready',
    label: {
      zh: '我已自查:摘要正文中不含可识别作者身份的表述(双盲评审要求)',
      en: 'I confirm the abstract text contains no author-identifying statements (double-blind review).',
    },
    required: true,
  },
];

const DAY = 24 * 60 * 60 * 1000;

/**
 * 四档截止时间:按活动开始时间回推(提交 −112 天,修改 −84,评审 −70,通知 −56)。
 * 截止瞬间由服务器时钟裁决,宽限期默认 0(ch04 §4.3)。
 */
export function getCfpConfig(event: { startsAt: Date }): CfpConfig {
  const start = event.startsAt.getTime();
  return {
    tracks: CFP_TRACKS,
    types: CFP_TYPES,
    questions: CFP_QUESTIONS,
    dimensions: SCORE_DIMENSIONS,
    deadlines: {
      submission: new Date(start - 112 * DAY),
      revision: new Date(start - 84 * DAY),
      review: new Date(start - 70 * DAY),
      notification: new Date(start - 56 * DAY),
    },
    abstractMaxLength: 2500,
    minReviews: 1,
    disputeVariance: 1,
  };
}

export function trackLabel(id: string | null | undefined): I18nString | null {
  return CFP_TRACKS.find((t) => t.id === id)?.label ?? null;
}

export function typeLabel(id: string): I18nString | null {
  return CFP_TYPES.find((t) => t.id === id)?.label ?? null;
}

export function isDoubleBlind(track: string | null): boolean {
  if (!track) return true; // 未指定 track 时按最严格处理
  return CFP_TRACKS.find((t) => t.id === track)?.doubleBlind ?? true;
}

/* ------------------------------------------------------------------ *
 * 投稿(作者侧)
 * ------------------------------------------------------------------ */

export interface SaveDraftInput {
  eventId: string;
  /** 续写既有草稿时带上追踪 token(/s/{token});为空则新建 */
  token?: string | null;
  title: string;
  abstract: string;
  type: string;
  track?: string | null;
  authors: Author[];
  answers: Record<string, unknown>;
  actor?: Actor;
}

export interface SaveDraftResult {
  submissionId: string;
  publicId: string;
  status: SubStatus;
  accessToken: string;
  trackingPath: string;
}

function normalizeAuthors(raw: Author[]): Author[] {
  const list = raw
    .map((a) => ({
      name: String(a.name ?? '').trim(),
      email: a.email ? String(a.email).trim().toLowerCase() : undefined,
      affiliation: a.affiliation ? String(a.affiliation).trim() : undefined,
      isPresenter: Boolean(a.isPresenter),
    }))
    .filter((a) => a.name !== '' || (a.email ?? '') !== '');
  if (list.length > 0 && !list.some((a) => a.isPresenter)) {
    list[0]!.isPresenter = true; // 至少一位报告人(ch04 §4.3)
  }
  return list;
}

/** 作者邮箱集合 —— 利益冲突检测与「自己的稿件对自己不可见」都用它 */
export function authorEmails(authors: Author[]): string[] {
  return authors
    .map((a) => (a.email ?? '').trim().toLowerCase())
    .filter((e) => e !== '');
}

/**
 * 保存草稿(可反复保存)。
 * 新建时即生成 128-bit 追踪 token,作者凭 /s/{token} 续写与查看进度(ch05 §5.5)。
 */
export async function saveSubmissionDraft(
  input: SaveDraftInput,
  db: Db = defaultDb,
): Promise<SaveDraftResult> {
  const actor: Actor = input.actor ?? { type: 'user' };
  const title = input.title.trim();
  if (!title) throw new SubmissionError('title_required', '请填写标题', 422);

  const [event] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!event) throw new SubmissionError('event_not_found', '活动不存在', 404);
  const config = getCfpConfig(event);

  if (input.track && !config.tracks.some((t) => t.id === input.track)) {
    throw new SubmissionError('track_unknown', '未知的 track', 400);
  }
  if (!config.types.some((t) => t.id === input.type)) {
    throw new SubmissionError('type_unknown', '未知的投稿类型', 400);
  }
  const abstract = input.abstract.trim();
  if (abstract.length > config.abstractMaxLength) {
    throw new SubmissionError(
      'abstract_too_long',
      `摘要超出 ${config.abstractMaxLength} 字上限`,
      422,
    );
  }

  const authors = normalizeAuthors(input.authors);
  const values = {
    eventId: input.eventId,
    track: input.track ?? null,
    type: input.type,
    title,
    abstract,
    authors,
    answers: input.answers,
    updatedAt: new Date(),
  };

  // 续写既有草稿
  if (input.token) {
    const existing = await findSubmissionByToken(input.token, db);
    if (!existing) throw new SubmissionError('not_found', '投稿不存在或链接已失效', 404);
    if (existing.status !== 'draft' && existing.status !== 'changes_requested') {
      throw new SubmissionError('not_editable', '当前状态不可编辑', 409);
    }
    await db.update(submissions).set(values).where(eq(submissions.id, existing.id));
    return {
      submissionId: existing.id,
      publicId: encodeId('submission', existing.id),
      status: existing.status as SubStatus,
      accessToken: input.token,
      trackingPath: `/s/${input.token}`,
    };
  }

  const accessToken = generateAccessToken();
  const submissionId = await db.transaction(async (tx) => {
    const [row] = await tx.insert(submissions).values({
      ...values,
      status: 'draft',
      accessTokenHash: hashToken(accessToken),
    }).returning({ id: submissions.id });
    const id = row!.id;

    await audit(tx as unknown as Db, {
      organizationId: event.organizationId,
      eventId: event.id,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'submission.draft',
      targetType: 'submission',
      targetId: id,
      diff: { status: 'draft', title, type: input.type, track: input.track ?? null },
      ip: actor.ip ?? null,
    });

    return id;
  });

  return {
    submissionId,
    publicId: encodeId('submission', submissionId),
    status: 'draft',
    accessToken,
    trackingPath: `/s/${accessToken}`,
  };
}

/** 提交前的完整性校验(ch09 §9.4:draft → submitted 的 guard) */
function assertSubmittable(
  row: typeof submissions.$inferSelect,
  config: CfpConfig,
  now = new Date(),
): void {
  if (now > config.deadlines.submission) {
    throw new SubmissionError('cfp_closed', '投稿已截止', 409);
  }
  if (!row.title.trim()) throw new SubmissionError('title_required', '请填写标题', 422);
  if (!row.abstract.trim()) throw new SubmissionError('abstract_required', '请填写摘要', 422);
  const authors = (row.authors ?? []) as Author[];
  if (authors.length === 0) throw new SubmissionError('authors_required', '请至少填写一位作者', 422);
  if (!authors.some((a) => a.isPresenter)) {
    throw new SubmissionError('presenter_required', '请指定一位报告人', 422);
  }
  if (!authors.some((a) => (a.email ?? '').includes('@'))) {
    throw new SubmissionError('author_email_required', '请填写通讯作者邮箱', 422);
  }
  const parsed = validateAnswers(config.questions, row.answers as Record<string, unknown>);
  if (!parsed.success) {
    throw new SubmissionError(
      'validation_failed',
      `表单校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      422,
    );
  }
}

export interface SubmitResultCfp extends SaveDraftResult {
  status: SubStatus;
}

/** 保存后立即提交:draft → submitted(ch09 §9.4) */
export async function submitSubmission(
  input: SaveDraftInput,
  db: Db = defaultDb,
): Promise<SubmitResultCfp> {
  const saved = await saveSubmissionDraft(input, db);

  const [event] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  const [row] = await db.select().from(submissions)
    .where(eq(submissions.id, saved.submissionId)).limit(1);
  if (!event || !row) throw new SubmissionError('not_found', '投稿不存在', 404);

  assertSubmittable(row, getCfpConfig(event));

  // changes_requested → under_review 是修订版重投;draft → submitted 是首投
  const to: SubStatus = row.status === 'changes_requested' ? 'under_review' : 'submitted';
  await transitionSubmission(saved.submissionId, to, input.actor ?? { type: 'user' }, {}, db);

  return { ...saved, status: to };
}

/* ------------------------------------------------------------------ *
 * 状态迁移唯一入口(ch09 §9.4)
 * ------------------------------------------------------------------ */

export interface TransitionOptions {
  /** 录用决定上的候补标记 —— waitlist 不是状态(ch04 §4.3) */
  waitlisted?: boolean;
  /** 附加到审计 diff 的说明(如 changes_requested 的修订意见) */
  note?: string | null;
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** 事务内迁移;assignReviewers / decideSubmission 复用之,保证「分配 + 迁移」原子 */
async function applyTransition(
  tx: Tx,
  row: typeof submissions.$inferSelect,
  to: SubStatus,
  actor: Actor,
  opts: TransitionOptions = {},
): Promise<void> {
  assertSubmissionTransition(row.status as SubStatus, to);

  const now = new Date();
  const patch: Partial<typeof submissions.$inferInsert> = { status: to, updatedAt: now };
  if (to === 'submitted' && !row.submittedAt) patch.submittedAt = now;
  if (to === 'accepted' || to === 'rejected') {
    patch.decidedAt = now;
    patch.decisionWaitlisted = to === 'accepted' ? Boolean(opts.waitlisted) : false;
  }
  if (to === 'withdrawn') patch.withdrawnAt = now;

  await tx.update(submissions).set(patch).where(eq(submissions.id, row.id));

  const [ev] = await tx.select({ organizationId: events.organizationId })
    .from(events).where(eq(events.id, row.eventId)).limit(1);

  await audit(tx as unknown as Db, {
    organizationId: ev!.organizationId,
    eventId: row.eventId,
    actorType: actor.type,
    actorId: actor.id ?? null,
    action: `submission.${to}`,
    targetType: 'submission',
    targetId: row.id,
    diff: {
      from: row.status,
      to,
      ...(to === 'accepted' ? { waitlisted: Boolean(opts.waitlisted) } : {}),
      ...(opts.note ? { note: opts.note } : {}),
    },
    ip: actor.ip ?? null,
  });

  // 副作用经 outbox,事务提交后由 worker 投递(ch09 §9.4 设计要点)
  await tx.insert(outbox).values({
    organizationId: ev!.organizationId,
    eventId: row.eventId,
    topic: `submission.${to}`,
    payload: {
      submissionId: row.id,
      publicId: encodeId('submission', row.id),
      from: row.status,
      to,
      waitlisted: to === 'accepted' ? Boolean(opts.waitlisted) : false,
    },
  });
}

/**
 * 状态迁移唯一入口(ch09 §9.4):行级锁 + 迁移表校验 + 审计 + outbox,全在一个事务内。
 * 非法迁移抛 InvalidTransitionError(API 层映射 409)。
 */
export async function transitionSubmission(
  submissionId: string,
  to: SubStatus,
  actor: Actor,
  opts: TransitionOptions = {},
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(submissions)
      .where(eq(submissions.id, submissionId))
      .for('update')
      .limit(1);
    if (!row) throw new SubmissionError('not_found', '投稿不存在', 404);
    await applyTransition(tx, row, to, actor, opts);
  });
}

/** 录用决议:accepted(可带 waitlist 标记)或 rejected —— under_review → accepted/rejected */
export async function decideSubmission(
  submissionId: string,
  decision: 'accepted' | 'rejected',
  actor: Actor,
  opts: { waitlisted?: boolean } = {},
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [row] = await tx.select().from(submissions)
      .where(eq(submissions.id, submissionId))
      .for('update')
      .limit(1);
    if (!row) throw new SubmissionError('not_found', '投稿不存在', 404);

    // guard:评审数达到 CFP 配置下限(ch09 §9.4)
    const [event] = await tx.select().from(events).where(eq(events.id, row.eventId)).limit(1);
    const config = getCfpConfig(event!);
    const [{ done = 0 } = { done: 0 }] = await tx
      .select({ done: count() })
      .from(reviews)
      .where(and(
        eq(reviews.submissionId, submissionId),
        eq(reviews.status, 'submitted'),
        eq(reviews.isConflict, false),
      ));
    if (done < config.minReviews) {
      throw new SubmissionError(
        'not_enough_reviews',
        `已提交评审 ${done} 份,少于要求的 ${config.minReviews} 份`,
        409,
      );
    }

    await applyTransition(tx, row, decision, actor, { waitlisted: opts.waitlisted });
  });
}

/* ------------------------------------------------------------------ *
 * 利益冲突与审稿人分配(ch04 §4.3)
 * ------------------------------------------------------------------ */

export type ConflictReason = 'same_email' | 'same_domain' | 'self_declared';

/**
 * 自动利益冲突检测:作者与审稿人邮箱相同,或邮箱域相同(ch04 §4.3);
 * 命中即禁止分配,chair 需逐条覆核。
 */
export function detectConflict(
  authors: Author[],
  reviewerEmail: string,
): ConflictReason | null {
  const email = reviewerEmail.trim().toLowerCase();
  if (!email) return null;
  const emails = authorEmails(authors);
  if (emails.includes(email)) return 'same_email';
  const domain = email.split('@')[1];
  if (domain && emails.some((e) => e.split('@')[1] === domain)) return 'same_domain';
  return null;
}

export interface AssignResult {
  assigned: { reviewerId: string; reviewerPublicId: string; name: string }[];
  skipped: { reviewerId: string; reviewerPublicId: string; name: string; reason: ConflictReason }[];
  movedToUnderReview: boolean;
}

/**
 * 分配审稿人:自动跳过利益冲突者,为其余人建 assigned 状态的 review 行,
 * 并在同一事务内把 submitted / changes_requested 迁到 under_review(ch09 §9.4)。
 */
export async function assignReviewers(
  submissionId: string,
  reviewerIds: string[],
  actor: Actor,
  db: Db = defaultDb,
): Promise<AssignResult> {
  if (reviewerIds.length === 0) {
    throw new SubmissionError('no_reviewer', '请至少选择一位审稿人', 422);
  }

  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(submissions)
      .where(eq(submissions.id, submissionId))
      .for('update')
      .limit(1);
    if (!row) throw new SubmissionError('not_found', '投稿不存在', 404);
    if (row.status === 'rejected' || row.status === 'withdrawn') {
      throw new SubmissionError('terminal', '终态投稿不能再分配审稿人', 409);
    }

    const reviewerRows = await tx.select({ id: users.id, email: users.email, name: users.name })
      .from(users).where(inArray(users.id, reviewerIds));

    const result: AssignResult = { assigned: [], skipped: [], movedToUnderReview: false };
    const authors = (row.authors ?? []) as Author[];

    for (const r of reviewerRows) {
      const conflict = detectConflict(authors, r.email);
      const who = {
        reviewerId: r.id,
        reviewerPublicId: encodeId('user', r.id),
        name: r.name ?? r.email,
      };
      if (conflict) {
        result.skipped.push({ ...who, reason: conflict });
        continue;
      }
      await tx.insert(reviews).values({
        submissionId,
        reviewerId: r.id,
        status: 'assigned',
      }).onConflictDoNothing({ target: [reviews.submissionId, reviews.reviewerId] });
      result.assigned.push(who);
    }

    if (result.assigned.length === 0) {
      throw new SubmissionError(
        'all_conflicted',
        '所选审稿人全部存在利益冲突,未分配任何人',
        409,
      );
    }

    const [ev] = await tx.select({ organizationId: events.organizationId })
      .from(events).where(eq(events.id, row.eventId)).limit(1);

    await audit(tx as unknown as Db, {
      organizationId: ev!.organizationId,
      eventId: row.eventId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'submission.reviewers_assigned',
      targetType: 'submission',
      targetId: submissionId,
      diff: {
        assigned: result.assigned.map((a) => a.reviewerPublicId),
        skipped: result.skipped.map((s) => ({ reviewer: s.reviewerPublicId, reason: s.reason })),
      },
      ip: actor.ip ?? null,
    });

    if (row.status === 'submitted' || row.status === 'changes_requested') {
      await applyTransition(tx, row, 'under_review', actor);
      result.movedToUnderReview = true;
    }

    return result;
  });
}

/** 活动的审稿人名册(event_members.role = 'reviewer',ch06 §6.4) */
export async function listEventReviewers(eventId: string, db: Db = defaultDb) {
  return db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(eventMembers)
    .innerJoin(users, eq(eventMembers.userId, users.id))
    .where(and(eq(eventMembers.eventId, eventId), eq(eventMembers.role, 'reviewer')))
    .orderBy(asc(users.email));
}

/* ------------------------------------------------------------------ *
 * 评审(审稿人侧)—— 双盲裁剪在服务端完成
 * ------------------------------------------------------------------ */

/** 审稿人可见的投稿视图:双盲 track 下**不含 authors 字段**(服务端裁剪,不是前端隐藏) */
export interface BlindSubmission {
  id: string;
  publicId: string;
  eventId: string;
  track: string | null;
  type: string;
  title: string;
  abstract: string;
  answers: Record<string, unknown>;
  status: SubStatus;
  submittedAt: Date | null;
  /** 非双盲 track 才会出现;双盲下该键根本不存在 */
  authors?: Author[];
}

/**
 * 审稿人查询只 SELECT 这些列 —— authors 根本不进入进程内存,
 * 「双盲」因此是查询层的属性,而不是渲染时才裁掉的一层遮罩。
 */
const REVIEWER_COLUMNS = {
  id: submissions.id,
  eventId: submissions.eventId,
  track: submissions.track,
  type: submissions.type,
  title: submissions.title,
  abstract: submissions.abstract,
  answers: submissions.answers,
  status: submissions.status,
  submittedAt: submissions.submittedAt,
} as const;

type ReviewerColumns = {
  [K in keyof typeof REVIEWER_COLUMNS]: (typeof submissions.$inferSelect)[K]
};

export function blindSubmission(row: ReviewerColumns & { authors?: Author[] }): BlindSubmission {
  const view: BlindSubmission = {
    id: row.id,
    publicId: encodeId('submission', row.id),
    eventId: row.eventId,
    track: row.track,
    type: row.type,
    title: row.title,
    abstract: row.abstract,
    answers: (row.answers ?? {}) as Record<string, unknown>,
    status: row.status as SubStatus,
    submittedAt: row.submittedAt,
  };
  // 非双盲 track 才补上作者;双盲下该键根本不存在
  if (!isDoubleBlind(row.track) && row.authors) view.authors = row.authors;
  return view;
}

/**
 * 「审稿人自己是作者」的排除条件在 SQL 里判断(ch04 §4.3:其稿件对本人完全不可见),
 * 这样连比对用的作者邮箱都不必取回应用层。
 */
function notAuthoredBy(email: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(${submissions.authors}) AS a
    WHERE lower(a->>'email') = ${email}
  )`;
}

/** 非双盲 track 的稿件补取作者(双盲 track 永不调用) */
async function authorsForOpenTracks(
  views: BlindSubmission[],
  db: Db,
): Promise<void> {
  const open = views.filter((v) => !isDoubleBlind(v.track));
  if (open.length === 0) return;
  const rows = await db
    .select({ id: submissions.id, authors: submissions.authors })
    .from(submissions)
    .where(inArray(submissions.id, open.map((v) => v.id)));
  for (const v of open) {
    v.authors = (rows.find((r) => r.id === v.id)?.authors ?? []) as Author[];
  }
}

export interface ReviewerTask {
  submission: BlindSubmission;
  review: {
    id: string;
    publicId: string;
    status: 'assigned' | 'draft' | 'submitted';
    scores: Record<string, number>;
    confidence: number | null;
    commentForCommittee: string | null;
    commentForAuthors: string | null;
    isConflict: boolean;
    submittedAt: Date | null;
  };
}

const OPEN_FOR_REVIEW: SubStatus[] = ['under_review', 'changes_requested'];

/**
 * 我的评审任务:排除自报冲突的稿件,并排除审稿人自己作为作者的稿件
 * (「同一 track 内既投稿又评审者,其稿件对本人完全不可见」,ch04 §4.3)。
 */
export async function listReviewerTasks(
  eventId: string,
  reviewerId: string,
  db: Db = defaultDb,
): Promise<ReviewerTask[]> {
  const [me] = await db.select({ email: users.email }).from(users)
    .where(eq(users.id, reviewerId)).limit(1);
  const myEmail = (me?.email ?? '').toLowerCase();

  const rows = await db
    .select({ submission: REVIEWER_COLUMNS, review: reviews })
    .from(reviews)
    .innerJoin(submissions, eq(reviews.submissionId, submissions.id))
    .where(and(
      eq(reviews.reviewerId, reviewerId),
      eq(reviews.isConflict, false),
      eq(submissions.eventId, eventId),
      sql`${submissions.deletedAt} IS NULL`,
      notAuthoredBy(myEmail),
    ))
    .orderBy(asc(reviews.createdAt));

  const tasks: ReviewerTask[] = rows.map((r) => ({
    submission: blindSubmission(r.submission),
    review: {
      id: r.review.id,
      publicId: encodeId('review', r.review.id),
      status: r.review.status as 'assigned' | 'draft' | 'submitted',
      scores: (r.review.scores ?? {}) as Record<string, number>,
      confidence: r.review.confidence,
      commentForCommittee: r.review.commentForCommittee,
      commentForAuthors: r.review.commentForAuthors,
      isConflict: r.review.isConflict,
      submittedAt: r.review.submittedAt,
    },
  }));
  await authorsForOpenTracks(tasks.map((t) => t.submission), db);
  return tasks;
}

/** 单条评审任务;未分配、已自报冲突或本人即作者时返回 null(对象级授权,ch12 §12.2) */
export async function getReviewerTask(
  submissionId: string,
  reviewerId: string,
  db: Db = defaultDb,
): Promise<ReviewerTask | null> {
  const [me] = await db.select({ email: users.email }).from(users)
    .where(eq(users.id, reviewerId)).limit(1);
  const myEmail = (me?.email ?? '').toLowerCase();

  const [row] = await db
    .select({ submission: REVIEWER_COLUMNS, review: reviews })
    .from(reviews)
    .innerJoin(submissions, eq(reviews.submissionId, submissions.id))
    .where(and(
      eq(reviews.submissionId, submissionId),
      eq(reviews.reviewerId, reviewerId),
      notAuthoredBy(myEmail),
    ))
    .limit(1);
  if (!row || row.review.isConflict) return null;

  const view = blindSubmission(row.submission);
  await authorsForOpenTracks([view], db);

  return {
    submission: view,
    review: {
      id: row.review.id,
      publicId: encodeId('review', row.review.id),
      status: row.review.status as 'assigned' | 'draft' | 'submitted',
      scores: (row.review.scores ?? {}) as Record<string, number>,
      confidence: row.review.confidence,
      commentForCommittee: row.review.commentForCommittee,
      commentForAuthors: row.review.commentForAuthors,
      isConflict: row.review.isConflict,
      submittedAt: row.review.submittedAt,
    },
  };
}

export interface SaveReviewInput {
  submissionId: string;
  reviewerId: string;
  scores: Record<string, number>;
  confidence?: number | null;
  commentForCommittee?: string | null;
  commentForAuthors?: string | null;
  /** 审稿人自报利益冲突:立即撤销其对该稿件的读权限(ch09 §9.2 注释) */
  isConflict?: boolean;
  /** true 提交评审,false 存草稿 */
  submit: boolean;
  actor?: Actor;
}

/** 保存/提交评审。评分范围按 CFP 维度定义校验,越界抛 SubmissionError(422)。 */
export async function saveReview(
  input: SaveReviewInput,
  db: Db = defaultDb,
): Promise<{ reviewId: string; publicId: string; status: 'assigned' | 'draft' | 'submitted' }> {
  const actor: Actor = input.actor ?? { type: 'user', id: input.reviewerId };

  const [row] = await db.select().from(submissions)
    .where(eq(submissions.id, input.submissionId)).limit(1);
  if (!row) throw new SubmissionError('not_found', '投稿不存在', 404);
  if (!OPEN_FOR_REVIEW.includes(row.status as SubStatus)) {
    throw new SubmissionError('not_under_review', '该投稿当前不在评审阶段', 409);
  }

  const [existing] = await db.select().from(reviews)
    .where(and(
      eq(reviews.submissionId, input.submissionId),
      eq(reviews.reviewerId, input.reviewerId),
    )).limit(1);
  if (!existing) throw new SubmissionError('not_assigned', '你未被分配此投稿', 403);

  const conflict = Boolean(input.isConflict);
  const scores: Record<string, number> = {};
  if (!conflict) {
    for (const dim of SCORE_DIMENSIONS) {
      const v = input.scores[dim.key];
      if (v == null) {
        if (input.submit) {
          throw new SubmissionError('score_required', '请为每个维度评分', 422);
        }
        continue;
      }
      if (!Number.isFinite(v) || v < dim.min || v > dim.max) {
        throw new SubmissionError('score_out_of_range', '评分超出量表范围', 422);
      }
      scores[dim.key] = v;
    }
    if (input.confidence != null && (input.confidence < 1 || input.confidence > 5)) {
      throw new SubmissionError('confidence_out_of_range', '置信度需在 1–5 之间', 422);
    }
    if (input.submit && input.confidence == null) {
      throw new SubmissionError('confidence_required', '请填写置信度', 422);
    }
  }

  const status: 'assigned' | 'draft' | 'submitted' = conflict
    ? 'assigned'
    : (input.submit ? 'submitted' : 'draft');

  const [event] = await db.select({ organizationId: events.organizationId })
    .from(events).where(eq(events.id, row.eventId)).limit(1);

  await db.transaction(async (tx) => {
    await tx.update(reviews).set({
      scores,
      confidence: conflict ? null : (input.confidence ?? null),
      commentForCommittee: conflict ? null : (input.commentForCommittee?.trim() || null),
      commentForAuthors: conflict ? null : (input.commentForAuthors?.trim() || null),
      isConflict: conflict,
      status,
      submittedAt: status === 'submitted' ? new Date() : null,
      updatedAt: new Date(),
    }).where(eq(reviews.id, existing.id));

    await audit(tx as unknown as Db, {
      organizationId: event!.organizationId,
      eventId: row.eventId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: conflict ? 'review.conflict_declared' : `review.${status}`,
      targetType: 'review',
      targetId: existing.id,
      diff: { submissionId: input.submissionId, status, isConflict: conflict },
      ip: actor.ip ?? null,
    });

    if (status === 'submitted' || conflict) {
      await tx.insert(outbox).values({
        organizationId: event!.organizationId,
        eventId: row.eventId,
        topic: conflict ? 'review.conflict_declared' : 'review.submitted',
        payload: {
          reviewId: existing.id,
          submissionId: input.submissionId,
          publicId: encodeId('submission', input.submissionId),
        },
      });
    }
  });

  return { reviewId: existing.id, publicId: encodeId('review', existing.id), status };
}

/* ------------------------------------------------------------------ *
 * 评分聚合(ch04 §4.3:均值、方差、完成度、意见分歧)
 * ------------------------------------------------------------------ */

/** 归一化加权平均 → 0–5 分;缺任一维度返回 null */
export function weightedTotal(
  scores: Record<string, number>,
  dims: ScoreDimension[] = SCORE_DIMENSIONS,
): number | null {
  let sum = 0;
  let weight = 0;
  for (const d of dims) {
    const v = scores[d.key];
    if (v == null || !Number.isFinite(v)) return null;
    sum += ((v - d.min) / (d.max - d.min)) * d.weight;
    weight += d.weight;
  }
  if (weight === 0) return null;
  return Math.round((sum / weight) * 5 * 10) / 10;
}

export interface ReviewAggregate {
  /** 已提交且未声明冲突的评审份数 */
  completed: number;
  /** 已分配份数(不含冲突) */
  assigned: number;
  mean: number | null;
  variance: number | null;
  /** 方差过高 → 意见分歧标签(ch04 §4.3) */
  disputed: boolean;
}

export function aggregateReviews(
  rows: { scores: Record<string, number>; status: string; isConflict: boolean }[],
  config: { dimensions: ScoreDimension[]; disputeVariance: number },
): ReviewAggregate {
  const usable = rows.filter((r) => !r.isConflict);
  const totals = usable
    .filter((r) => r.status === 'submitted')
    .map((r) => weightedTotal(r.scores, config.dimensions))
    .filter((v): v is number => v != null);

  if (totals.length === 0) {
    return { completed: 0, assigned: usable.length, mean: null, variance: null, disputed: false };
  }
  const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
  const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
  return {
    completed: totals.length,
    assigned: usable.length,
    mean: Math.round(mean * 10) / 10,
    variance: Math.round(variance * 100) / 100,
    disputed: variance > config.disputeVariance,
  };
}

/* ------------------------------------------------------------------ *
 * 查询(组织者与作者)
 * ------------------------------------------------------------------ */

export async function findSubmissionByToken(token: string, db: Db = defaultDb) {
  const [row] = await db.select().from(submissions)
    .where(and(
      eq(submissions.accessTokenHash, hashToken(token)),
      sql`${submissions.deletedAt} IS NULL`,
    ))
    .limit(1);
  return row ?? null;
}

/**
 * 追踪页数据(/s/{token},与 /r/{token} 同构)。
 * 评审意见只在决议后返回,且只返回 commentForAuthors —— 委员会内部意见永不外泄。
 */
export async function getSubmissionByToken(token: string, db: Db = defaultDb) {
  const submission = await findSubmissionByToken(token, db);
  if (!submission) return null;

  const [row] = await db.select({ event: events, org: organizations })
    .from(events)
    .innerJoin(organizations, eq(events.organizationId, organizations.id))
    .where(eq(events.id, submission.eventId))
    .limit(1);
  const event = row?.event;
  const organization = row?.org;
  const timeline = await timelineFor(db, 'submission', submission.id);

  const decided = submission.decidedAt != null;
  const authorFeedback = decided
    ? (await db.select({ comment: reviews.commentForAuthors })
        .from(reviews)
        .where(and(
          eq(reviews.submissionId, submission.id),
          eq(reviews.status, 'submitted'),
          eq(reviews.isConflict, false),
        ))
        .orderBy(asc(reviews.submittedAt)))
        .map((r) => r.comment)
        .filter((c): c is string => Boolean(c && c.trim()))
    : [];

  return {
    submission, event, organization, timeline, authorFeedback,
    config: event ? getCfpConfig(event) : null,
  };
}

export async function listSubmissions(
  eventId: string,
  opts: { status?: SubStatus; track?: string; limit?: number; offset?: number } = {},
  db: Db = defaultDb,
) {
  const limit = Math.min(opts.limit ?? 50, 100); // 分页上限 100(ch10 §10.2)
  const filters = [eq(submissions.eventId, eventId), sql`${submissions.deletedAt} IS NULL`];
  if (opts.status) filters.push(eq(submissions.status, opts.status));
  if (opts.track) filters.push(eq(submissions.track, opts.track));
  const where = and(...filters);

  const rows = await db.select().from(submissions)
    .where(where)
    .orderBy(desc(submissions.createdAt))
    .limit(limit)
    .offset(opts.offset ?? 0);

  const [{ total = 0 } = { total: 0 }] = await db
    .select({ total: count() }).from(submissions).where(where);

  return { rows, total, limit, offset: opts.offset ?? 0 };
}

/** 列表页所需的评审进度:submissionId → 聚合 */
export async function reviewProgress(
  submissionIds: string[],
  config: { dimensions: ScoreDimension[]; disputeVariance: number },
  db: Db = defaultDb,
): Promise<Record<string, ReviewAggregate>> {
  const out: Record<string, ReviewAggregate> = {};
  if (submissionIds.length === 0) return out;

  const rows = await db.select({
    submissionId: reviews.submissionId,
    scores: reviews.scores,
    status: reviews.status,
    isConflict: reviews.isConflict,
  }).from(reviews).where(inArray(reviews.submissionId, submissionIds));

  for (const id of submissionIds) {
    out[id] = aggregateReviews(
      rows.filter((r) => r.submissionId === id).map((r) => ({
        scores: (r.scores ?? {}) as Record<string, number>,
        status: r.status,
        isConflict: r.isConflict,
      })),
      config,
    );
  }
  return out;
}

/** 组织者的投稿详情:含全部评审与聚合(chair 视角,可见作者与委员会意见) */
export async function getSubmissionDetail(submissionId: string, db: Db = defaultDb) {
  const [submission] = await db.select().from(submissions)
    .where(eq(submissions.id, submissionId)).limit(1);
  if (!submission) return null;

  const [event] = await db.select().from(events)
    .where(eq(events.id, submission.eventId)).limit(1);
  if (!event) return null;
  const config = getCfpConfig(event);

  const reviewRows = await db
    .select({ review: reviews, reviewer: { id: users.id, email: users.email, name: users.name } })
    .from(reviews)
    .innerJoin(users, eq(reviews.reviewerId, users.id))
    .where(eq(reviews.submissionId, submissionId))
    .orderBy(asc(reviews.createdAt));

  const aggregate = aggregateReviews(
    reviewRows.map((r) => ({
      scores: (r.review.scores ?? {}) as Record<string, number>,
      status: r.review.status,
      isConflict: r.review.isConflict,
    })),
    config,
  );

  const timeline = await timelineFor(db, 'submission', submissionId);
  return { submission, event, config, reviews: reviewRows, aggregate, timeline };
}

/** 各状态计数(后台概览与筛选器) */
export async function submissionStats(eventId: string, db: Db = defaultDb) {
  const rows = await db
    .select({ status: submissions.status, n: count() })
    .from(submissions)
    .where(and(eq(submissions.eventId, eventId), sql`${submissions.deletedAt} IS NULL`))
    .groupBy(submissions.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}
