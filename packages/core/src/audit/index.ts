/**
 * 审计日志哈希链(ch09 §9.5、ch12 §12.5)
 * 每条记录的 hash 由前一条 hash 与本条规范化内容共同计算,
 * 任何中间改写都会使后续链条校验失败。
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { auditLogs, type Db } from '@yumeet/db';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditEntry {
  organizationId: string;
  eventId?: string | null;
  actorType: 'user' | 'api_key' | 'system';
  actorId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  diff?: Record<string, unknown> | null;
  ip?: string | null;
}

/** 规范化 JSON:键排序,保证哈希可重算 */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(',')}}`;
}

export function computeHash(prevHash: string, entry: AuditEntry): string {
  return createHash('sha256')
    .update(prevHash)
    .update(canonical({
      organizationId: entry.organizationId,
      eventId: entry.eventId ?? null,
      actorType: entry.actorType,
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId,
      diff: entry.diff ?? null,
    }))
    .digest('hex');
}

/** 写入一条审计记录(应在业务事务内调用) */
export async function audit(db: Db, entry: AuditEntry): Promise<void> {
  const [last] = await db
    .select({ hash: auditLogs.hash })
    .from(auditLogs)
    .orderBy(desc(auditLogs.id))
    .limit(1);
  const prevHash = last?.hash ?? GENESIS_HASH;
  const hash = computeHash(prevHash, entry);
  await db.insert(auditLogs).values({
    organizationId: entry.organizationId,
    eventId: entry.eventId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    diff: entry.diff ?? null,
    ip: entry.ip ?? null,
    prevHash,
    hash,
  });
}

/** 全链重算校验(yumeet doctor --audit-verify,ch11 §11.3) */
export async function verifyChain(db: Db): Promise<{ ok: boolean; brokenAtId?: number }> {
  const rows = await db.select().from(auditLogs).orderBy(auditLogs.id);
  let prev = GENESIS_HASH;
  for (const row of rows) {
    const expected = computeHash(prev, {
      organizationId: row.organizationId,
      eventId: row.eventId,
      actorType: row.actorType as AuditEntry['actorType'],
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      diff: row.diff as Record<string, unknown> | null,
    });
    if (row.prevHash !== prev || row.hash !== expected) {
      return { ok: false, brokenAtId: row.id };
    }
    prev = row.hash;
  }
  return { ok: true };
}

/** 按 target 回放状态变更序列 —— 追踪页的数据来源(ch05 §5.5) */
export async function timelineFor(db: Db, targetType: string, targetId: string) {
  return db
    .select({
      action: auditLogs.action,
      createdAt: auditLogs.createdAt,
      diff: auditLogs.diff,
    })
    .from(auditLogs)
    .where(eq(auditLogs.targetId, targetId))
    .orderBy(auditLogs.id);
}

/* ---------- 令牌工具(ch05 §5.5:128-bit 不可枚举 token) ---------- */

const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉 0/1/I/O

/** 追踪页 token:128 bit,base64url,不可枚举 */
export function generateAccessToken(): string {
  return randomBytes(16).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** 8 位确认码:签到与人工查询(ch09 §9.2 registrations.confirmationCode) */
export function generateConfirmationCode(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  return out;
}
