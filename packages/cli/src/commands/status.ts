import { db, events, registrations, submissions, outbox, emailLogs } from '@yumeet/db';
import { sql } from 'drizzle-orm';
import { c, table, isJson } from '../util';

/** yumeet status —— 运行概览(ch11 §11.3) */
export async function statusCmd(argv: string[]): Promise<number> {
  const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;

  const [evts, regs, subs, pending, queued, failedMail] = await Promise.all([
    one(db.select({ n: sql<number>`count(*)::int` }).from(events)),
    one(db.select({ n: sql<number>`count(*)::int` }).from(registrations)),
    one(db.select({ n: sql<number>`count(*)::int` }).from(submissions)),
    one(db.select({ n: sql<number>`count(*)::int` }).from(outbox)
      .where(sql`processed_at IS NULL`)),
    one(db.select({ n: sql<number>`count(*)::int` }).from(emailLogs)
      .where(sql`status = 'queued'`)),
    one(db.select({ n: sql<number>`count(*)::int` }).from(emailLogs)
      .where(sql`status = 'failed'`)),
  ]);

  const byStatus = await db
    .select({ status: registrations.status, n: sql<number>`count(*)::int` })
    .from(registrations).groupBy(registrations.status);

  const payload = {
    events: evts,
    registrations: regs,
    submissions: subs,
    outboxPending: pending,
    emailQueued: queued,
    emailFailed: failedMail,
    registrationsByStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])),
  };

  if (isJson(argv)) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  console.log(`\n${c.bold('yuMeet 运行概览')}\n`);
  console.log(table([
    ['活动', String(evts)],
    ['报名', String(regs)],
    ['投稿', String(subs)],
    ['outbox 待投递', String(pending)],
    ['邮件排队 / 失败', `${queued} / ${failedMail}`],
  ]));
  if (byStatus.length > 0) {
    console.log(`\n${c.dim('报名状态分布')}`);
    console.log(table(byStatus.map((r) => [r.status, String(r.n)])));
  }
  console.log();
  return 0;
}
