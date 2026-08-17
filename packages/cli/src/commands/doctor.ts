import { statfs } from 'node:fs/promises';
import { db, events, registrations, outbox, auditLogs } from '@yumeet/db';
import { verifyChain } from '@yumeet/core';
import { sql } from 'drizzle-orm';
import { c, ok, fail, has, isJson } from '../util';

interface Check { name: string; pass: boolean; detail: string; hint?: string }

/**
 * yumeet doctor —— 体检(ch11 §11.3)
 *
 * 每一项都必须给出「怎么修」,而不只是报告失败:
 * 运维工具的价值在于把下一步动作说清楚。
 */
export async function doctor(argv: string[]): Promise<number> {
  const checks: Check[] = [];

  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(events);
    checks.push({ name: '数据库连接', pass: true, detail: `可达,${row?.n ?? 0} 个活动` });
  } catch (e) {
    checks.push({
      name: '数据库连接', pass: false,
      detail: e instanceof Error ? e.message : String(e),
      hint: '检查 DATABASE_URL 与 postgres 容器状态',
    });
  }

  try {
    const fs = await statfs('/');
    const freeGb = (fs.bsize * fs.bfree) / 1e9;
    const pass = freeGb > 2;
    checks.push({
      name: '磁盘余量', pass, detail: `${freeGb.toFixed(1)} GB 可用`,
      hint: pass ? undefined : '低于 2GB 会影响备份与文件上传,请清理或扩容',
    });
  } catch { /* 非致命 */ }

  // outbox 积压说明 worker 没在跑:邮件与 webhook 都不会发出
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` })
      .from(outbox).where(sql`processed_at IS NULL`);
    const n = row?.n ?? 0;
    const pass = n < 100;
    checks.push({
      name: 'outbox 积压', pass, detail: `${n} 条待投递`,
      hint: pass ? undefined : 'worker 可能未运行:确认邮件与 webhook 不会发出',
    });
  } catch { /* 表可能尚未建 */ }

  // 待支付却没有订单的报名 —— 这类记录永远无法完成支付
  try {
    const [row] = await db.select({ n: sql<number>`count(*)::int` })
      .from(registrations)
      .where(sql`status = 'awaiting_payment' AND order_id IS NULL`);
    const n = row?.n ?? 0;
    checks.push({
      name: '报名/订单一致性', pass: n === 0,
      detail: n === 0 ? '无孤立的待支付报名' : `${n} 条待支付报名没有订单`,
      hint: n === 0 ? undefined : '这些报名无法完成支付,需补建订单或取消',
    });
  } catch { /* ignore */ }

  if (has(argv, 'audit-verify')) {
    try {
      const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLogs);
      const r = await verifyChain(db);
      checks.push({
        name: '审计哈希链', pass: r.ok,
        detail: r.ok ? `${row?.n ?? 0} 条记录,链条完整` : `在 id=${r.brokenAtId} 处断裂`,
        hint: r.ok ? undefined : '审计记录被改动过 —— 立即排查数据库写权限',
      });
    } catch (e) {
      checks.push({
        name: '审计哈希链', pass: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    checks.push({
      name: '审计哈希链', pass: true,
      detail: '未校验(加 --audit-verify 全链重算)',
    });
  }

  const allOk = checks.every((x) => x.pass);

  if (isJson(argv)) {
    console.log(JSON.stringify({ ok: allOk, checks }, null, 2));
  } else {
    console.log(`\n${c.bold('yumeet doctor')}\n`);
    for (const x of checks) {
      console.log(x.pass ? ok(`${x.name}:${x.detail}`) : fail(`${x.name}:${x.detail}`));
      if (x.hint) console.log(`   ${c.dim(`→ ${x.hint}`)}`);
    }
    console.log(allOk
      ? c.green('\n全部通过\n')
      : c.red(`\n${checks.filter((x) => !x.pass).length} 项未通过\n`));
  }
  return allOk ? 0 : 1;
}
