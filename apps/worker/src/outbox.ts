/**
 * outbox 消费者(ch09 §9.4 设计要点:副作用在事务提交后才投递)。
 *
 * 业务写操作只往 outbox 落一条记录,不因订阅方宕机而变慢(ch10 §10.3)。
 * 本轮询器把 outbox 扇出成两类作业:webhook 投递、通知邮件。
 *
 * 可靠性语义:
 *  - 认领用 `FOR UPDATE SKIP LOCKED`,多副本 worker 不会抢到同一行;
 *  - attempts 在认领时 +1,便于发现「反复认领但从未成功」的毒丸记录;
 *  - **processed_at 只在全部扇出作业成功入队后才写**;中途崩溃则该行仍是未处理,
 *    下一轮重新认领 —— 至少一次;
 *  - 重新入队用确定性 jobId(outboxId × webhookId),BullMQ 直接忽略重复,
 *    所以「至少一次的认领」不会变成「多次投递」。
 */
import {
  buildEventObject, claimOutboxBatch, listWebhooksForTopic, markOutboxProcessed,
  newDeliveryId, isWebhookEvent, type OutboxRow,
} from '@yumeet/core';
import { db, events } from '@yumeet/db';
import { eq } from 'drizzle-orm';
import { config } from './config';
import { log, errFields } from './logger';
import {
  emailJobId, emailJobOptions, webhookJobId, webhookJobOptions,
  type EmailJob, type Queues, type WebhookJob,
} from './queues';

/** 报名状态 → 通知模板(ch04 §4.4);没有映射的状态不发信 */
const REGISTRATION_MAIL: Record<string, string | undefined> = {
  confirmed: 'registration.confirmed',
  pending_review: 'registration.pending_review',
  waitlisted: 'registration.waitlisted',
  cancelled: 'registration.cancelled',
};

interface EventInfo {
  title: string; startsAt: Date; timezone: string; venueText: string | null;
}

const eventCache = new Map<string, EventInfo>();

async function loadEvent(eventId: string): Promise<EventInfo | null> {
  const cached = eventCache.get(eventId);
  if (cached) return cached;
  const [row] = await db.select({
    title: events.title, startsAt: events.startsAt,
    timezone: events.timezone, venue: events.venue,
  }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!row) return null;
  const venue = row.venue as { name?: string; address?: string } | null;
  const info: EventInfo = {
    title: row.title, startsAt: row.startsAt, timezone: row.timezone,
    venueText: venue ? [venue.name, venue.address].filter(Boolean).join(', ') || null : null,
  };
  eventCache.set(eventId, info);
  return info;
}

/** 扇出一条 outbox 记录;抛异常即表示本行未处理完,不写 processed_at */
async function fanOut(row: OutboxRow, queues: Queues): Promise<void> {
  const object = await buildEventObject(row.topic, row.payload, db);

  // ---- 1. webhook 订阅 ----
  if (isWebhookEvent(row.topic)) {
    const subscribers = await listWebhooksForTopic(row.organizationId, row.topic, db);
    for (const wh of subscribers) {
      const job: WebhookJob = {
        outboxId: row.id,
        webhookId: wh.id,
        organizationId: row.organizationId,
        eventId: row.eventId,
        topic: row.topic,
        // 投递 ID 在这里生成一次,重试之间不变(ch10 §10.3 幂等去重)
        deliveryId: newDeliveryId(),
        object,
        createdAt: row.createdAt.toISOString(),
      };
      await queues.webhook.add(row.topic, job, {
        ...webhookJobOptions,
        jobId: webhookJobId(row.id, wh.id),
      });
    }
    if (subscribers.length > 0) {
      log.info('webhook 已扇出', {
        outboxId: row.id, topic: row.topic, subscribers: subscribers.length,
      });
    }
  } else {
    log.debug('topic 不在 ch10 §10.3 事件表中,不做 webhook 扇出', { topic: row.topic });
  }

  // ---- 2. 通知邮件 ----
  const mail = await buildRegistrationMail(row, object);
  if (mail) {
    await queues.email.add(mail.template, mail, {
      ...emailJobOptions, jobId: emailJobId(row.id, mail.to),
    });
  }
}

async function buildRegistrationMail(
  row: OutboxRow, object: Record<string, unknown>,
): Promise<EmailJob | null> {
  if (!row.topic.startsWith('registration.')) return null;
  const to = typeof object['email'] === 'string' ? object['email'] : null;
  const status = typeof object['status'] === 'string' ? object['status'] : null;
  if (!to || !status) return null;

  // 候补转正是一次专门的通知,与普通 confirmed 区分
  const template = row.topic === 'registration.promoted'
    ? 'registration.promoted'
    : REGISTRATION_MAIL[status];
  if (!template) return null;

  // checked_in / rejected / expired 不给参会者发信(ch04 §4.4)
  if (row.topic === 'registration.checked_in') return null;

  const eventId = row.eventId ?? (typeof row.payload['eventId'] === 'string' ? row.payload['eventId'] : null);
  const info = eventId ? await loadEvent(eventId) : null;

  return {
    kind: 'registration',
    organizationId: row.organizationId,
    eventId,
    template,
    to,
    context: {
      eventTitle: info?.title ?? '',
      eventStartsAt: (info?.startsAt ?? new Date()).toISOString(),
      eventTimezone: info?.timezone ?? 'UTC',
      venue: info?.venueText ?? '',
      confirmationCode: typeof object['confirmation_code'] === 'string' ? object['confirmation_code'] : '',
      ticketName: typeof object['ticket_name'] === 'string' ? object['ticket_name'] : '',
      waitlistPosition: typeof object['waitlist_position'] === 'number' ? object['waitlist_position'] : null,
      // 追踪链接需要明文 access token —— 只有报名提交那一刻拿得到,
      // outbox 里不存(存了就等于把免登录凭证写进事件表)。模块 5 的通知事件表
      // 落地后由那里携带,当前先留空。
      trackingUrl: '',
    },
  };
}

/** 处理一轮:返回本轮成功处理的记录数 */
export async function drainOnce(queues: Queues): Promise<number> {
  const rows = await claimOutboxBatch(config.outboxBatchSize, db);
  if (rows.length === 0) return 0;

  const done: string[] = [];
  for (const row of rows) {
    try {
      await fanOut(row, queues);
      done.push(row.id);
    } catch (err) {
      // 该行不写 processed_at,下一轮重新认领;确定性 jobId 保证不重复投递
      log.error('outbox 扇出失败,保留待重试', {
        outboxId: row.id, topic: row.topic, attempts: row.attempts, ...errFields(err),
      });
    }
  }

  await markOutboxProcessed(done, db);
  if (done.length > 0) log.info('outbox 已处理', { processed: done.length, claimed: rows.length });
  return done.length;
}

/**
 * 轮询循环。有事件时立即接着跑下一轮(不等间隔),空闲时按 outboxPollMs 休眠。
 * stop() 后当前这一轮会跑完再退出 —— 优雅退出的第一环。
 */
export function startOutboxPoller(queues: Queues): { stop: () => Promise<void> } {
  let running = true;
  let sleepTimer: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;

  const loop = (async () => {
    log.info('outbox 轮询器已启动', { intervalMs: config.outboxPollMs, batch: config.outboxBatchSize });
    while (running) {
      let processed = 0;
      try {
        processed = await drainOnce(queues);
      } catch (err) {
        log.error('outbox 轮询异常', errFields(err));
      }
      if (!running) break;
      if (processed > 0) continue; // 还有积压,立刻继续
      await new Promise<void>((resolve) => {
        wake = resolve;
        sleepTimer = setTimeout(resolve, config.outboxPollMs);
      });
      sleepTimer = null;
      wake = null;
    }
    log.info('outbox 轮询器已停止');
  })();

  return {
    async stop() {
      running = false;
      if (sleepTimer) clearTimeout(sleepTimer);
      if (wake) wake();       // 立刻唤醒,不干等一个轮询间隔
      await loop;             // 等在途的这一轮跑完
    },
  };
}
