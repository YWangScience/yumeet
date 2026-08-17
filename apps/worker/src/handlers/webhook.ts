/**
 * webhook 投递作业处理器(ch10 §10.3)。
 *
 * 分工:签名 / 信封 / 成功判据 / 失败计账全在 @yumeet/core 的 webhook 服务里,
 * 这里只负责「从队列取出 → 调 core → 把结果翻译成 BullMQ 的重试或死信」。
 */
import type { Job } from 'bullmq';
import { eq } from 'drizzle-orm';
import {
  buildEnvelope, deliverWebhook, recordDeliveryOutcome, nextRetryDelayMs,
  WEBHOOK_MAX_ATTEMPTS, type FailureWindowStore,
} from '@yumeet/core';
import { db, webhooks, organizations, organizationMembers, users } from '@yumeet/db';
import { and, inArray } from 'drizzle-orm';
import { log, errFields } from '../logger';
import { safeFetchTransport } from '../transport';
import type { EmailJob, Queues, WebhookJob } from '../queues';
import { emailJobOptions, webhookDisabledJobId } from '../queues';

/** 投递失败时抛出:BullMQ 据此重试;信息进死信记录 */
export class WebhookDeliveryError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'WebhookDeliveryError';
  }
}

export function createWebhookProcessor(deps: {
  store: FailureWindowStore;
  queues: Queues;
}) {
  return async function processWebhookJob(job: Job<WebhookJob>): Promise<{
    status: number | undefined; durationMs: number;
  }> {
    const data = job.data;

    // 每次投递前重新读 endpoint:期间可能被停用、被改 URL、被轮换密钥
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, data.webhookId)).limit(1);
    if (!row) {
      log.warn('endpoint 已删除,跳过投递', { webhookId: data.webhookId, deliveryId: data.deliveryId });
      return { status: undefined, durationMs: 0 };
    }
    if (!row.active || row.disabledAt) {
      log.warn('endpoint 已暂停,跳过投递', { webhookId: row.id, deliveryId: data.deliveryId });
      return { status: undefined, durationMs: 0 };
    }

    const envelope = buildEnvelope(data.topic, data.object, {
      deliveryId: data.deliveryId,          // 重试沿用同一个投递 ID
      createdAt: new Date(data.createdAt),  // created_at 是事件时间,不是重试时间
    });

    // transport 内部走 safeFetch:每次投递都重新解析 DNS + 判网段 + 钉 IP(ch12 §12.1)
    const attempt = await deliverWebhook({
      webhook: row, envelope, transport: safeFetchTransport,
    });

    if (attempt.ok) {
      await recordDeliveryOutcome({ webhookId: row.id, ok: true, store: deps.store, db });
      log.info('webhook 投递成功', {
        deliveryId: attempt.deliveryId, webhookId: row.id, topic: attempt.topic,
        status: attempt.status, durationMs: attempt.durationMs, attempt: job.attemptsMade + 1,
      });
      return { status: attempt.status, durationMs: attempt.durationMs };
    }

    const attemptsMade = job.attemptsMade + 1;
    const nextDelay = nextRetryDelayMs(attemptsMade);
    const exhausted = nextDelay === null || attemptsMade >= WEBHOOK_MAX_ATTEMPTS;

    log.warn('webhook 投递失败', {
      deliveryId: attempt.deliveryId, webhookId: row.id, topic: attempt.topic,
      url: row.url, status: attempt.status, err: attempt.error,
      attempt: attemptsMade, of: WEBHOOK_MAX_ATTEMPTS,
      nextRetryInMs: exhausted ? null : nextDelay,
    });

    if (exhausted) {
      // 8 次用尽 → 进死信(BullMQ failed 集合)+ 记一次连续失败,可能触发自动暂停
      await onDeliveryExhausted({ ...deps, webhookId: row.id, url: row.url, organizationId: row.organizationId });
    }

    throw new WebhookDeliveryError(attempt.error ?? '投递失败', attempt.status);
  };
}

/**
 * 重试用尽的收尾:计一次连续失败;若窗口已满 5 天则 core 会写 disabled_at,
 * 此时再发一封邮件告知组织管理员(ch10 §10.3)。
 */
export async function onDeliveryExhausted(args: {
  store: FailureWindowStore;
  queues: Queues;
  webhookId: string;
  url: string;
  organizationId: string;
}): Promise<void> {
  const outcome = await recordDeliveryOutcome({
    webhookId: args.webhookId, ok: false, store: args.store, db,
  });

  if (!outcome.disabled) return;

  log.error('endpoint 连续 5 天全失败,已自动暂停', {
    webhookId: args.webhookId, url: args.url,
    failureCount: outcome.failureCount,
    failingSince: outcome.failingSince?.toISOString(),
  });

  const [org] = await db.select({ slug: organizations.slug })
    .from(organizations).where(eq(organizations.id, args.organizationId)).limit(1);

  const admins = await db.select({ email: users.email })
    .from(organizationMembers)
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(
      eq(organizationMembers.organizationId, args.organizationId),
      inArray(organizationMembers.role, ['owner', 'admin']),
    ));

  for (const admin of admins) {
    const payload: EmailJob = {
      kind: 'webhook-disabled',
      organizationId: args.organizationId,
      eventId: null,
      template: 'webhook.auto_disabled',
      to: admin.email,
      context: {
        url: args.url,
        failureCount: outcome.failureCount,
        failingSince: (outcome.failingSince ?? new Date()).toISOString(),
        orgSlug: org?.slug ?? null,
      },
    };
    await args.queues.email.add('webhook-disabled', payload, {
      ...emailJobOptions,
      jobId: webhookDisabledJobId(args.webhookId, admin.email),
    }).catch((err: unknown) => log.error('暂停通知邮件入队失败', errFields(err)));
  }
}
