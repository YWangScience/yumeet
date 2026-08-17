/** worker 运行时配置(ch11 §11.1 的分层解析:默认值 → env;文件层后续由 packages/config 接管) */

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  redisUrl: process.env.REDIS_URL ?? 'redis://127.0.0.1:6380',
  /** BullMQ 队列前缀,多租户/多环境共用一个 Redis 时区分 */
  queuePrefix: process.env.YUMEET_QUEUE_PREFIX ?? 'yumeet',
  /** outbox 轮询间隔(ms);有事件时会立刻继续下一轮,不等这个间隔 */
  outboxPollMs: int('YUMEET_OUTBOX_POLL_MS', 1_000),
  /** 每轮认领多少条 outbox */
  outboxBatchSize: int('YUMEET_OUTBOX_BATCH', 50),
  /** 单个 worker 并发投递数 */
  webhookConcurrency: int('YUMEET_WEBHOOK_CONCURRENCY', 8),
  emailConcurrency: int('YUMEET_EMAIL_CONCURRENCY', 4),
  /** 邮件驱动:console(默认,打印 + 落 email_logs)| smtp | resend */
  mailDriver: process.env.YUMEET_MAIL_DRIVER ?? 'console',
  mailFrom: process.env.YUMEET_MAIL_FROM ?? 'yuMeet <no-reply@yumeet.local>',
  publicOrigin: process.env.YUMEET_PUBLIC_ORIGIN ?? 'http://localhost:3000',
  /** SIGTERM 后最多等在途任务多久(ms),超时强制退出 */
  shutdownGraceMs: int('YUMEET_SHUTDOWN_GRACE_MS', 30_000),
  /**
   * 仅本地联调:允许 webhook 投递到 http:// 与私有地址。
   * 生产绝不可开 —— 打开即等于关掉 ch12 §12.1 的 SSRF 防御。
   */
  allowPrivateWebhookTargets: process.env.YUMEET_NET_ALLOW_PRIVATE === '1',
} as const;

export type Config = typeof config;
