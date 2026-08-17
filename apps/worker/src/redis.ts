/** Redis 连接与「连续失败窗口」持久化(ch10 §10.3 的 5 天自动暂停判据) */
import { Redis } from 'ioredis';
import type { FailureWindowStore } from '@yumeet/core';
import { config } from './config';

/**
 * BullMQ 要求 maxRetriesPerRequest: null(阻塞式 BRPOPLPUSH 不能被 ioredis 提前放弃)。
 * 所有队列共用一条连接;订阅类连接由 BullMQ 自行 duplicate。
 */
export function createRedis(): Redis {
  return new Redis(config.redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  });
}

/**
 * 「距上次成功投递多久」的窗口起点存在 Redis:
 *   yumeet:wh:failing-since:<webhookId> = ISO 时间戳,TTL 30 天。
 * 首次失败写入(NX 保证不被后续失败覆盖),任意一次成功即删除 ——
 * 于是「key 存在且已过 5 天」精确等价于「连续 5 天所有投递均失败」。
 *
 * 之所以不落 webhooks 表:该表 schema 归 packages/db 所有,且这是纯运行期状态,
 * Redis 已经是 worker 的强依赖(BullMQ),不额外引入组件。
 */
export class RedisFailureWindowStore implements FailureWindowStore {
  private readonly ttlSeconds = 30 * 24 * 60 * 60;

  constructor(private readonly redis: Redis) {}

  private key(webhookId: string): string {
    return `${config.queuePrefix}:wh:failing-since:${webhookId}`;
  }

  async markFailure(webhookId: string, at: Date): Promise<Date> {
    const key = this.key(webhookId);
    const iso = at.toISOString();
    // NX:只有窗口尚未开始时才写,已存在则保留原起点
    await this.redis.set(key, iso, 'EX', this.ttlSeconds, 'NX');
    const stored = await this.redis.get(key);
    return stored ? new Date(stored) : at;
  }

  async clear(webhookId: string): Promise<void> {
    await this.redis.del(this.key(webhookId));
  }

  async firstFailureAt(webhookId: string): Promise<Date | null> {
    const raw = await this.redis.get(this.key(webhookId));
    return raw ? new Date(raw) : null;
  }
}
