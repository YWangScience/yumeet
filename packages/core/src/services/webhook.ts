/**
 * Webhook 服务(ch10 §10.3)—— 事件目录、信封、HMAC 签名、订阅查询、
 * 重试与死信策略、连续 5 天全失败自动暂停。
 *
 * 业务逻辑唯一实现处:apps/worker 负责「什么时候调」与「用什么传输发出去」,
 * 「发什么、怎么签、失败了算什么账」全部在这里。apps/web 的 webhook 设置页
 * 用同一份 WEBHOOK_EVENTS 渲染订阅勾选框,用同一份 encryptSecret 落库。
 *
 * 出站传输本身不在这里做:ch12 §12.1 要求所有出站 HTTP 经 packages/net 的
 * safeFetch broker,由 worker 注入 WebhookTransport —— core 因此保持零网络依赖,
 * 也便于单测用假传输跑完整投递路径。
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  db as defaultDb, webhooks, events, registrations, tickets, outbox, type Db,
} from '@yumeet/db';
import { uuidv7 } from 'uuidv7';
import { encodeId, type IdKind } from '../ids/index';

// ---------------------------------------------------------------------------
// 事件目录(ch10 §10.3 —— PLAN §0.2 指定的唯一事实源)
// ---------------------------------------------------------------------------

export const WEBHOOK_EVENTS = [
  'event.created', 'event.published', 'event.updated', 'event.archived',
  'registration.created', 'registration.pending_review', 'registration.confirmed',
  'registration.waitlisted', 'registration.promoted', 'registration.cancelled',
  'registration.checked_in',
  'order.created', 'order.paid', 'order.refunded', 'order.expired',
  'submission.created', 'submission.updated', 'submission.withdrawn',
  'submission.accepted', 'submission.rejected',
  'review.submitted',
  'schedule.published', 'schedule.updated',
  'email.bounced', 'email.complained',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const WEBHOOK_EVENT_SET: ReadonlySet<string> = new Set(WEBHOOK_EVENTS);

export function isWebhookEvent(topic: string): topic is WebhookEvent {
  return WEBHOOK_EVENT_SET.has(topic);
}

/** 投递体的 api_version;信封结构变更时才递增 */
export const WEBHOOK_API_VERSION = '2026-08-01';

/**
 * 重试节奏(ch10 §10.3 的表:立即 / 30s / 2m / 10m / 30m / 2h / 6h / 12h,共 8 次)。
 * 索引 = 第几次尝试(0 基),值 = 距上次的间隔秒数。
 */
export const WEBHOOK_RETRY_DELAYS_SECONDS: readonly number[] = [
  0, 30, 120, 600, 1800, 7200, 21600, 43200,
];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_DELAYS_SECONDS.length;

/** 响应必须在 10 秒内返回 2xx 才算成功(ch10 §10.3) */
export const WEBHOOK_TIMEOUT_MS = 10_000;

/** 连续 5 天所有投递均失败 → 自动暂停 endpoint(ch10 §10.3) */
export const WEBHOOK_AUTO_DISABLE_AFTER_MS = 5 * 24 * 60 * 60 * 1000;

/** 签名时间戳容差,防重放(ch10 §10.3) */
export const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * 下一次重试的延迟毫秒数;返回 null 表示已用尽 8 次,应进死信。
 * @param attemptsMade 已完成(且失败)的尝试次数
 */
export function nextRetryDelayMs(attemptsMade: number): number | null {
  if (attemptsMade >= WEBHOOK_MAX_ATTEMPTS) return null;
  const seconds = WEBHOOK_RETRY_DELAYS_SECONDS[attemptsMade];
  return seconds === undefined ? null : seconds * 1000;
}

// ---------------------------------------------------------------------------
// 密钥:生成、AES-256-GCM 静态加密、HMAC 签名
// ---------------------------------------------------------------------------

/**
 * 开发用固定密钥。生产必须设置 YUMEET_SECRET_KEY(ch11 §11.2 的 .env 由
 * `yumeet init` 随机生成),否则所有 webhook 密钥都用这个公开常量加密 ——
 * 等于没加密。进程启动时若落到这里会打一条 warn。
 */
const DEV_FALLBACK_KEY = 'yumeet-dev-insecure-key-do-not-use-in-production';

let warnedAboutDevKey = false;

/** 取 32 字节主密钥:64 位十六进制直接用,其余走 scrypt 派生 */
export function secretKeyBytes(raw = process.env.YUMEET_SECRET_KEY): Buffer {
  let material = raw;
  if (!material) {
    material = DEV_FALLBACK_KEY;
    if (!warnedAboutDevKey) {
      warnedAboutDevKey = true;
      console.warn(
        '[yumeet] YUMEET_SECRET_KEY 未设置,webhook 密钥将用公开的开发密钥加密。' +
        '生产环境必须设置(ch11 §11.2)。',
      );
    }
  }
  if (/^[0-9a-fA-F]{64}$/.test(material)) return Buffer.from(material, 'hex');
  return scryptSync(material, 'yumeet.webhook.secret.v1', 32);
}

/** 新建 endpoint 时生成、且只展示一次的签名密钥(ch10 §10.3) */
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/** AES-256-GCM 加密,输出 `v1.<iv>.<tag>.<ct>`(全部 base64url) */
export function encryptSecret(plaintext: string, key = secretKeyBytes()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [
    'v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

export class WebhookSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSecretError';
  }
}

export function decryptSecret(encoded: string, key = secretKeyBytes()): string {
  const parts = encoded.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new WebhookSecretError('密文格式不是 v1.<iv>.<tag>.<ct>');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1]!, 'base64url'));
    decipher.setAuthTag(Buffer.from(parts[2]!, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(parts[3]!, 'base64url')), decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new WebhookSecretError('webhook 密钥解密失败(主密钥不匹配或密文被篡改)');
  }
}

/** 签名串是 `${t}.${rawBody}`,HMAC-SHA256,十六进制(ch10 §10.3) */
export function signWebhook(secret: string, timestampSeconds: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestampSeconds}.${rawBody}`).digest('hex');
}

/** 生成 `t=<unix>,v1=<hex>` 头值 */
export function buildSignatureHeader(
  secret: string, rawBody: string, now: Date = new Date(),
): string {
  const t = Math.floor(now.getTime() / 1000);
  return `t=${t},v1=${signWebhook(secret, t, rawBody)}`;
}

/**
 * 校验签名(ch10 §10.3 给订阅方的参考实现,同时供 yuMeet 自测与 SDK 复用)。
 * 必须用原始字节而非重新序列化的 JSON;拒绝时间戳偏差过大;常数时间比较。
 */
export function verifyWebhookSignature(opts: {
  rawBody: string;
  header: string;
  secret: string;
  toleranceSeconds?: number;
  now?: Date;
}): boolean {
  const tolerance = opts.toleranceSeconds ?? WEBHOOK_SIGNATURE_TOLERANCE_SECONDS;
  const parts: Record<string, string> = {};
  for (const kv of opts.header.split(',')) {
    const idx = kv.indexOf('=');
    if (idx < 0) continue;
    parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
  const t = Number(parts['t']);
  const v1 = parts['v1'] ?? '';
  if (!Number.isFinite(t)) return false;
  const nowSeconds = (opts.now ?? new Date()).getTime() / 1000;
  if (Math.abs(nowSeconds - t) > tolerance) return false;
  if (!/^[0-9a-f]*$/i.test(v1) || v1.length % 2 !== 0) return false;

  const expected = Buffer.from(signWebhook(opts.secret, t, opts.rawBody), 'hex');
  const actual = Buffer.from(v1, 'hex');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ---------------------------------------------------------------------------
// 投递信封
// ---------------------------------------------------------------------------

export interface WebhookEnvelope {
  /** 投递级唯一 ID,重试不变;消费方以它做幂等去重(ch10 §10.3) */
  id: string;
  type: string;
  api_version: string;
  created_at: string;
  data: { object: Record<string, unknown> };
}

/** whd_ + UUIDv7 的 Crockford base32,与 ch09 §9.1 的对外 ID 同构 */
export function newDeliveryId(): string {
  const encoded = encodeId('event', uuidv7());
  return `whd_${encoded.slice(encoded.indexOf('_') + 1)}`;
}

export function buildEnvelope(
  type: string,
  object: Record<string, unknown>,
  opts: { deliveryId?: string; createdAt?: Date } = {},
): WebhookEnvelope {
  return {
    id: opts.deliveryId ?? newDeliveryId(),
    type,
    api_version: WEBHOOK_API_VERSION,
    created_at: (opts.createdAt ?? new Date()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    data: { object },
  };
}

function enc(kind: IdKind, id: string | null | undefined): string | null {
  return id ? encodeId(kind, id) : null;
}

/**
 * 把 outbox 的内部载荷翻译成对外 `data.object`。
 * 白名单序列化(ch12 §12.1 防御一第 4 条):字段显式列出,裸 UUID 不出现,
 * 参会者 PII 只给邮箱(订阅方本就是组织自己注册的 endpoint)。
 */
export async function buildEventObject(
  topic: string,
  payload: Record<string, unknown>,
  db: Db = defaultDb,
): Promise<Record<string, unknown>> {
  if (topic.startsWith('registration.')) {
    const regId = typeof payload['registrationId'] === 'string'
      ? payload['registrationId'] : null;
    if (!regId) return { ...payload };
    const [reg] = await db.select().from(registrations)
      .where(eq(registrations.id, regId)).limit(1);
    if (!reg) return { ...payload };
    const ticket = reg.ticketId
      ? (await db.select({ id: tickets.id, name: tickets.name })
        .from(tickets).where(eq(tickets.id, reg.ticketId)).limit(1))[0]
      : undefined;
    return {
      id: encodeId('registration', reg.id),
      object: 'registration',
      event_id: encodeId('event', reg.eventId),
      form_id: encodeId('form', reg.formId),
      ticket_id: enc('ticket', reg.ticketId),
      ticket_name: ticket?.name ?? null,
      email: reg.email,
      status: reg.status,
      waitlist_position: reg.waitlistPosition,
      confirmation_code: reg.confirmationCode,
      created_at: reg.createdAt.toISOString(),
      confirmed_at: reg.confirmedAt?.toISOString() ?? null,
      checked_in_at: reg.checkedInAt?.toISOString() ?? null,
      cancelled_at: reg.cancelledAt?.toISOString() ?? null,
    };
  }

  if (topic.startsWith('event.')) {
    const eventId = typeof payload['eventId'] === 'string' ? payload['eventId'] : null;
    if (!eventId) return { ...payload };
    const [ev] = await db.select().from(events).where(eq(events.id, eventId)).limit(1);
    if (!ev) return { ...payload };
    return {
      id: encodeId('event', ev.id),
      object: 'event',
      organization_id: encodeId('organization', ev.organizationId),
      slug: ev.slug,
      title: ev.title,
      status: ev.status,
      starts_at: ev.startsAt.toISOString(),
      ends_at: ev.endsAt.toISOString(),
      timezone: ev.timezone,
    };
  }

  // 其余域(order / submission / review / schedule / email)在各自模块落地前,
  // 原样透传 outbox 载荷 —— 信封与签名语义不变。
  return { ...payload };
}

// ---------------------------------------------------------------------------
// 订阅查询
// ---------------------------------------------------------------------------

export type WebhookRow = typeof webhooks.$inferSelect;

/** 该组织下订阅了此 topic、且未停用未暂停的 endpoint */
export async function listWebhooksForTopic(
  organizationId: string, topic: string, db: Db = defaultDb,
): Promise<WebhookRow[]> {
  return db.select().from(webhooks).where(and(
    eq(webhooks.organizationId, organizationId),
    eq(webhooks.active, true),
    sql`${webhooks.disabledAt} IS NULL`,
    // events 数组包含该 topic,或订阅了 '*' 全量
    sql`(${webhooks.events} && ARRAY[${topic}, '*']::text[])`,
  ));
}

// ---------------------------------------------------------------------------
// 投递
// ---------------------------------------------------------------------------

/**
 * 出站传输由调用方注入 —— 生产是 apps/worker 传入的 packages/net safeFetch,
 * 单测传假实现。core 因此不直接持有网络能力(ch12 §12.1:业务模块无权发请求)。
 */
export interface WebhookTransport {
  post(url: string, rawBody: string, headers: Record<string, string>): Promise<{
    status: number;
    body?: string;
  }>;
}

export interface DeliveryAttempt {
  deliveryId: string;
  webhookId: string;
  url: string;
  topic: string;
  ok: boolean;
  status?: number;
  error?: string;
  durationMs: number;
  requestHeaders: Record<string, string>;
  rawBody: string;
}

/**
 * 单次投递。成功判据:2xx 且在 WEBHOOK_TIMEOUT_MS 内返回(超时由 transport 负责)。
 * 不在这里做重试 —— 重试节奏交给 worker 的 BullMQ backoff(见 nextRetryDelayMs)。
 */
export async function deliverWebhook(args: {
  webhook: Pick<WebhookRow, 'id' | 'url' | 'secretEncrypted'>;
  envelope: WebhookEnvelope;
  transport: WebhookTransport;
  now?: Date;
}): Promise<DeliveryAttempt> {
  const { webhook, envelope, transport } = args;
  // rawBody 只序列化一次,签名与实际送出的字节必须完全一致
  const rawBody = JSON.stringify(envelope);
  const secret = decryptSecret(webhook.secretEncrypted);
  const signature = buildSignatureHeader(secret, rawBody, args.now ?? new Date());

  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    // ch10 §10.3 规定的头名;X- 前缀别名同时给出,便于经过老网关的订阅方取用
    'yuMeet-Signature': signature,
    'X-yuMeet-Signature': signature,
    'X-yuMeet-Event': envelope.type,
    'X-yuMeet-Delivery': envelope.id,
    'X-yuMeet-Api-Version': envelope.api_version,
    'user-agent': 'yuMeet-Webhooks/0.1',
  };

  const startedAt = Date.now();
  try {
    const res = await transport.post(webhook.url, rawBody, headers);
    const ok = res.status >= 200 && res.status < 300;
    return {
      deliveryId: envelope.id, webhookId: webhook.id, url: webhook.url,
      topic: envelope.type, ok, status: res.status,
      error: ok ? undefined : `HTTP ${res.status}: ${(res.body ?? '').slice(0, 200)}`,
      durationMs: Date.now() - startedAt, requestHeaders: headers, rawBody,
    };
  } catch (err) {
    return {
      deliveryId: envelope.id, webhookId: webhook.id, url: webhook.url,
      topic: envelope.type, ok: false,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      durationMs: Date.now() - startedAt, requestHeaders: headers, rawBody,
    };
  }
}

// ---------------------------------------------------------------------------
// 失败计账与自动暂停(ch10 §10.3:连续 5 天所有投递均失败 → 暂停 + 邮件通知)
// ---------------------------------------------------------------------------

/**
 * 「距上一次成功投递有多久」的窗口状态。
 * webhooks 表没有 last_success_at 列(schema 归 packages/db 管),因此这一小段
 * 运行期状态放在 worker 侧的 Redis 里(重启不丢),接口在此声明以便注入与测试。
 */
export interface FailureWindowStore {
  /** 记录一次失败,返回本轮连续失败窗口的起点 */
  markFailure(webhookId: string, at: Date): Promise<Date>;
  /** 投递成功 —— 窗口清零 */
  clear(webhookId: string): Promise<void>;
  firstFailureAt(webhookId: string): Promise<Date | null>;
}

/** 进程内实现:无 Redis 时的降级(重启即丢窗口,仅用于开发) */
export class InMemoryFailureWindowStore implements FailureWindowStore {
  private readonly map = new Map<string, Date>();
  async markFailure(webhookId: string, at: Date): Promise<Date> {
    const existing = this.map.get(webhookId);
    if (existing) return existing;
    this.map.set(webhookId, at);
    return at;
  }
  async clear(webhookId: string): Promise<void> {
    this.map.delete(webhookId);
  }
  async firstFailureAt(webhookId: string): Promise<Date | null> {
    return this.map.get(webhookId) ?? null;
  }
}

export interface OutcomeResult {
  /** 本次是否触发了自动暂停 */
  disabled: boolean;
  failureCount: number;
  /** 连续失败窗口起点(成功时为 null) */
  failingSince: Date | null;
}

/**
 * 记录一次投递的最终结果(重试用尽后调用一次,或成功时立即调用)。
 *  - 成功:failure_count 归零、窗口清零;
 *  - 失败:failure_count += 1;若连续失败窗口已满 5 天则写 disabled_at 并返回
 *    disabled=true,由调用方(worker)发暂停通知邮件。
 */
export async function recordDeliveryOutcome(args: {
  webhookId: string;
  ok: boolean;
  store: FailureWindowStore;
  now?: Date;
  db?: Db;
}): Promise<OutcomeResult> {
  const db = args.db ?? defaultDb;
  const now = args.now ?? new Date();

  if (args.ok) {
    await args.store.clear(args.webhookId);
    await db.update(webhooks)
      .set({ failureCount: 0 })
      .where(eq(webhooks.id, args.webhookId));
    return { disabled: false, failureCount: 0, failingSince: null };
  }

  const failingSince = await args.store.markFailure(args.webhookId, now);
  const [row] = await db.update(webhooks)
    .set({ failureCount: sql`${webhooks.failureCount} + 1` })
    .where(eq(webhooks.id, args.webhookId))
    .returning({ failureCount: webhooks.failureCount, disabledAt: webhooks.disabledAt });

  const failureCount = row?.failureCount ?? 0;
  const windowMs = now.getTime() - failingSince.getTime();
  const shouldDisable = windowMs >= WEBHOOK_AUTO_DISABLE_AFTER_MS && !row?.disabledAt;

  if (shouldDisable) {
    // 暂停期间事件继续落 outbox,恢复后可补投最近 30 天(ch10 §10.3)
    await db.update(webhooks)
      .set({ disabledAt: now, active: false })
      .where(and(eq(webhooks.id, args.webhookId), sql`${webhooks.disabledAt} IS NULL`));
  }

  return { disabled: shouldDisable, failureCount, failingSince };
}

/** 手动恢复被自动暂停的 endpoint(后台「重新启用」按钮) */
export async function reenableWebhook(
  webhookId: string, store: FailureWindowStore, db: Db = defaultDb,
): Promise<void> {
  await store.clear(webhookId);
  await db.update(webhooks)
    .set({ disabledAt: null, active: true, failureCount: 0 })
    .where(eq(webhooks.id, webhookId));
}

// ---------------------------------------------------------------------------
// outbox 消费(worker 的取数与标记,事务语义集中在这里)
// ---------------------------------------------------------------------------

export type OutboxRow = typeof outbox.$inferSelect;

/**
 * 认领一批待处理的 outbox 记录:`FOR UPDATE SKIP LOCKED` 保证多个 worker 副本
 * 不会抢到同一行;attempts 在认领时 +1,便于观察「反复认领但没成功」的记录。
 * processed_at 只在 claimOutbox 的调用方确认处理成功后才写(markOutboxProcessed)。
 */
export async function claimOutboxBatch(
  limit = 50, db: Db = defaultDb,
): Promise<OutboxRow[]> {
  return db.transaction(async (tx) => {
    const pending = await tx.select({ id: outbox.id })
      .from(outbox)
      .where(sql`${outbox.processedAt} IS NULL`)
      .orderBy(outbox.createdAt)
      .limit(limit)
      .for('update', { skipLocked: true });
    if (pending.length === 0) return [];
    const ids = pending.map((r) => r.id);
    return tx.update(outbox)
      .set({ attempts: sql`${outbox.attempts} + 1` })
      .where(inArray(outbox.id, ids))
      .returning();
  });
}

/** 处理成功才写 processed_at —— 未写即会被下一轮重新认领(至少一次语义) */
export async function markOutboxProcessed(
  ids: readonly string[], db: Db = defaultDb, now: Date = new Date(),
): Promise<void> {
  if (ids.length === 0) return;
  await db.update(outbox)
    .set({ processedAt: now })
    .where(inArray(outbox.id, [...ids]));
}

/** 给管理后台看的积压量 */
export async function outboxBacklog(db: Db = defaultDb): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(outbox).where(sql`${outbox.processedAt} IS NULL`);
  return row?.n ?? 0;
}
