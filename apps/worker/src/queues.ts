/** BullMQ 队列定义与作业载荷类型(ch11 §11.2 的 worker 容器职责) */
import { Queue, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import { WEBHOOK_MAX_ATTEMPTS } from '@yumeet/core';
import { config } from './config';

export const QUEUE_WEBHOOK = 'webhook-delivery';
export const QUEUE_EMAIL = 'email';

/** 一次 webhook 投递作业;deliveryId 在重试之间保持不变(ch10 §10.3 幂等去重) */
export interface WebhookJob {
  outboxId: string;
  webhookId: string;
  organizationId: string;
  eventId: string | null;
  topic: string;
  deliveryId: string;
  /** 已经组装好的 data.object,重试时不再回数据库取,保证投递体稳定 */
  object: Record<string, unknown>;
  createdAt: string;
}

export interface EmailJob {
  kind: 'registration' | 'webhook-disabled';
  organizationId: string;
  eventId: string | null;
  template: string;
  to: string;
  /** 模板上下文,已在入队时序列化好 */
  context: Record<string, unknown>;
}

/** 自定义退避策略名 —— 与 index.ts 里注册的 backoffStrategy 对应 */
export const BACKOFF_WEBHOOK = 'yumeet-webhook';

export const webhookJobOptions: JobsOptions = {
  attempts: WEBHOOK_MAX_ATTEMPTS,             // 共 8 次(ch10 §10.3)
  backoff: { type: BACKOFF_WEBHOOK },
  // 失败的作业保留 30 天 —— 这就是「死信队列」:后台 webhook 详情页从这里读
  // 完整请求/响应记录,并支持单条或按时间范围手动重投。
  removeOnFail: { age: 30 * 24 * 3600 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
};

export const emailJobOptions: JobsOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
  removeOnComplete: { age: 7 * 24 * 3600, count: 5_000 },
};

export function createQueues(connection: Redis) {
  const opts = { connection, prefix: config.queuePrefix };
  return {
    webhook: new Queue<WebhookJob>(QUEUE_WEBHOOK, opts),
    email: new Queue<EmailJob>(QUEUE_EMAIL, opts),
  };
}

export type Queues = ReturnType<typeof createQueues>;

/**
 * 确定性 jobId:同一条 outbox × 同一个 endpoint 只会产生一个作业。
 * outbox 行在「作业已入队」之后才写 processed_at,中途崩溃会被重新认领并
 * 重新入队 —— 靠这个 id,BullMQ 会直接忽略重复入队,不会重复投递。
 *
 * BullMQ 对自定义 jobId 里的冒号有历史包袱(只容忍恰好三段,用于旧版
 * repeatable job),因此这里一律不用冒号,并把邮箱等自由文本里的非安全字符
 * 归一化掉 —— 归一化是确定性的,不影响去重语义。
 */
function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._@-]/g, '_');
}

export function webhookJobId(outboxId: string, webhookId: string): string {
  return `wh.${safeSegment(outboxId)}.${safeSegment(webhookId)}`;
}

export function emailJobId(outboxId: string, to: string): string {
  return `mail.${safeSegment(outboxId)}.${safeSegment(to)}`;
}

/** endpoint 自动暂停的告警邮件:同一个 endpoint 只发一次(去重靠 jobId) */
export function webhookDisabledJobId(webhookId: string, to: string): string {
  return `mail.whoff.${safeSegment(webhookId)}.${safeSegment(to)}`;
}
