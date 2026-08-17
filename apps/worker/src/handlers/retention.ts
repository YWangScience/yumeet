/**
 * 保留期清理任务(ch12 §12.3 权威表,ch09 §9.5:BullMQ repeatable,每日 04:00 UTC)。
 *
 * 业务逻辑一行都不在这里 —— 全部在 @yumeet/core 的 runRetention();
 * 本文件只负责:队列/调度器注册、把报告写进结构化日志、以及一个 dry-run CLI。
 *
 * dry-run(先看再删,ch12 §12.3 的默认即合规不等于默认即莽撞):
 *   pnpm --filter @yumeet/worker exec tsx src/handlers/retention.ts --dry-run
 *   pnpm --filter @yumeet/worker exec tsx src/handlers/retention.ts --run
 */
import { pathToFileURL } from 'node:url';
import { Queue, type Job, type JobsOptions } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  runRetention, formatRetentionReport, RETENTION_CRON, RETENTION_JOB_NAME,
  type RetentionReport,
} from '@yumeet/core';
import { sql as pgSql } from '@yumeet/db';
import { config } from '../config';
import { log, errFields } from '../logger';

export const QUEUE_RETENTION = 'data-retention';

export interface RetentionJob {
  /** true 时只统计不写库 */
  dryRun?: boolean;
  /** 只跑某个组织(补跑与排障) */
  organizationId?: string;
}

export const retentionJobOptions: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 60_000 },
  removeOnFail: { age: 30 * 24 * 3600 },
  removeOnComplete: { age: 30 * 24 * 3600, count: 100 },
};

export function createRetentionQueue(connection: Redis): Queue<RetentionJob> {
  return new Queue<RetentionJob>(QUEUE_RETENTION, {
    connection, prefix: config.queuePrefix,
  });
}

/**
 * 注册每日 04:00 UTC 的 repeatable job(ch09 §9.5 明确了时刻)。
 * upsert 语义:重启不会堆出第二个调度器,改了 cron 会就地替换。
 */
export async function scheduleRetention(queue: Queue<RetentionJob>): Promise<void> {
  await queue.upsertJobScheduler(
    RETENTION_JOB_NAME,
    { pattern: RETENTION_CRON, tz: 'UTC' },
    { name: RETENTION_JOB_NAME, data: {}, opts: retentionJobOptions },
  );
  log.info('保留期清理任务已排程', { cron: RETENTION_CRON, tz: 'UTC', queue: QUEUE_RETENTION });
}

export async function processRetentionJob(job: Job<RetentionJob>): Promise<RetentionReport> {
  const dryRun = job.data.dryRun === true;
  const report = await runRetention({
    dryRun,
    organizationId: job.data.organizationId,
    actor: { type: 'system' },
  });
  for (const line of formatRetentionReport(report)) log.info(line);
  log.info('保留期清理完成', {
    jobId: job.id, dryRun, durationMs: report.durationMs, totals: report.totals,
  });
  return report;
}

/* ---------------- CLI:dry-run 先看,再真跑 ---------------- */

async function cli(argv: string[]): Promise<void> {
  const dryRun = !argv.includes('--run');
  if (dryRun && !argv.includes('--dry-run')) {
    console.log('用法: tsx src/handlers/retention.ts [--dry-run | --run] [--org <uuid>]');
  }
  const orgIdx = argv.indexOf('--org');
  const organizationId = orgIdx >= 0 ? argv[orgIdx + 1] : undefined;

  const report = await runRetention({ dryRun, organizationId, actor: { type: 'system' } });
  for (const line of formatRetentionReport(report)) console.log(line);
  console.log(JSON.stringify({ dryRun: report.dryRun, totals: report.totals }, null, 2));
  await pgSql.end({ timeout: 5 });
}

const invokedDirectly = process.argv[1] != null
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  cli(process.argv.slice(2)).catch((err: unknown) => {
    log.error('保留期清理失败', errFields(err));
    process.exit(1);
  });
}
