/**
 * 容器健康检查(ch11 §11.2 compose 里的 `node dist/healthcheck.js`)。
 * 检查 Redis 可达 + 队列可读 + Postgres 可查;任一不通则退出码 1。
 */
import { createQueues } from './queues';
import { createRedis } from './redis';
import { outboxBacklog } from '@yumeet/core';
import { db, sql as pgSql } from '@yumeet/db';

async function main(): Promise<void> {
  const connection = createRedis();
  const queues = createQueues(connection);
  try {
    const pong = await connection.ping();
    if (pong !== 'PONG') throw new Error(`redis ping 返回 ${pong}`);
    const counts = await queues.webhook.getJobCounts('waiting', 'active', 'failed', 'delayed');
    const backlog = await outboxBacklog(db);
    console.log(JSON.stringify({ ok: true, queue: counts, outboxBacklog: backlog }));
    process.exitCode = 0;
  } catch (err) {
    console.error(JSON.stringify({ ok: false, err: err instanceof Error ? err.message : String(err) }));
    process.exitCode = 1;
  } finally {
    await queues.webhook.close().catch(() => {});
    await queues.email.close().catch(() => {});
    await connection.quit().catch(() => {});
    await pgSql.end({ timeout: 2 }).catch(() => {});
  }
}

void main();
