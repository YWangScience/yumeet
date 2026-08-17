/**
 * apps/worker —— BullMQ 消费者(ch11 §11.2 七容器之一)。
 *
 * 职责:消费 outbox、投递 webhook(ch10 §10.3)、发通知邮件、后续接数据保留期清理
 * 与 PDF 生成。业务逻辑一行都不写在这里 —— 全部 import 自 @yumeet/core 与 @yumeet/db。
 *
 * 优雅退出:收到 SIGTERM 后
 *   1) 停止 outbox 轮询(当前这一轮跑完);
 *   2) worker.close() —— BullMQ 不再领新作业,并等在途作业跑完;
 *   3) 关 Redis 与 Postgres 连接。
 * 超过 shutdownGraceMs 仍未结束则强制退出,避免容器被 SIGKILL 时状态不确定。
 */
import { Worker, type Job } from 'bullmq';
import { sql as pgSql } from '@yumeet/db';
import { config } from './config';
import { log, errFields } from './logger';
import { createRedis, RedisFailureWindowStore } from './redis';
import { createQueues, QUEUE_EMAIL, QUEUE_WEBHOOK, type EmailJob, type WebhookJob } from './queues';
import { startOutboxPoller } from './outbox';
import { createWebhookProcessor } from './handlers/webhook';
import { processEmailJob } from './handlers/email';
import { nextRetryDelayMs } from '@yumeet/core';

async function main(): Promise<void> {
  const connection = createRedis();
  const queues = createQueues(connection);
  const store = new RedisFailureWindowStore(connection);

  const webhookWorker = new Worker<WebhookJob>(
    QUEUE_WEBHOOK,
    createWebhookProcessor({ store, queues }),
    {
      connection,
      prefix: config.queuePrefix,
      concurrency: config.webhookConcurrency,
      settings: {
        // ch10 §10.3 的退避表:立即 / 30s / 2m / 10m / 30m / 2h / 6h / 12h
        backoffStrategy: (attemptsMade: number) => nextRetryDelayMs(attemptsMade) ?? 0,
      },
    },
  );

  const emailWorker = new Worker<EmailJob>(QUEUE_EMAIL, processEmailJob, {
    connection,
    prefix: config.queuePrefix,
    concurrency: config.emailConcurrency,
  });

  webhookWorker.on('failed', (job: Job<WebhookJob> | undefined, err: Error) => {
    const exhausted = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : false;
    log[exhausted ? 'error' : 'warn'](
      exhausted ? 'webhook 投递进入死信队列' : 'webhook 投递失败,将重试',
      {
        jobId: job?.id, deliveryId: job?.data.deliveryId, topic: job?.data.topic,
        attempt: job?.attemptsMade, err: err.message,
      },
    );
  });
  emailWorker.on('failed', (job: Job<EmailJob> | undefined, err: Error) => {
    log.warn('邮件作业失败', { jobId: job?.id, template: job?.data.template, err: err.message });
  });
  for (const w of [webhookWorker, emailWorker]) {
    w.on('error', (err) => log.error('BullMQ worker 错误', errFields(err)));
  }

  const poller = startOutboxPoller(queues);

  log.info('yuMeet worker 已就绪', {
    redis: config.redisUrl.replace(/\/\/.*@/, '//***@'),
    mailDriver: config.mailDriver,
    webhookConcurrency: config.webhookConcurrency,
    allowPrivateWebhookTargets: config.allowPrivateWebhookTargets,
  });
  if (config.allowPrivateWebhookTargets) {
    log.warn('YUMEET_NET_ALLOW_PRIVATE=1:webhook 可投递到私有地址,仅限本地联调(ch12 §12.1)');
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('收到退出信号,开始优雅停机', { signal, graceMs: config.shutdownGraceMs });

    const forceTimer = setTimeout(() => {
      log.error('优雅停机超时,强制退出');
      process.exit(1);
    }, config.shutdownGraceMs);
    forceTimer.unref();

    try {
      await poller.stop();                                   // 1) 停止认领新的 outbox
      await Promise.all([                                    // 2) 等在途作业跑完
        webhookWorker.close(), emailWorker.close(),
      ]);
      await Promise.all([queues.webhook.close(), queues.email.close()]);
      await connection.quit();                               // 3) 关连接
      await pgSql.end({ timeout: 5 });
      clearTimeout(forceTimer);
      log.info('worker 已干净退出');
      process.exit(0);
    } catch (err) {
      log.error('停机过程中出错', errFields(err));
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => log.error('未处理的 Promise 拒绝', errFields(reason)));
}

main().catch((err: unknown) => {
  log.error('worker 启动失败', errFields(err));
  process.exit(1);
});
