/**
 * 成员与角色管理(ch06 §6.4)
 *
 * 会议的权力结构需要能被显式管理:谁是 IOC、谁是 LOC、谁管哪个分会。
 * 所有授予/回收都写审计,并按 ch06 §6.3 撤销该用户会话使权限变更立即生效 ——
 * 否则被降权的人在会话到期前仍能操作。
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  db as defaultDb, users, events, eventMembers, organizationMembers,
  sessionChairs, submissions, type Db,
} from '@yumeet/db';
import { audit } from '../audit/index';
import { normalizeEmail, revokeAllSessions } from './auth';
import type { Actor } from './registration';

import { EVENT_ROLES, ROLE_LABELS, type EventRole } from '../roles';

export { EVENT_ROLES, ROLE_LABELS, type EventRole };

export class MemberError extends Error {
  readonly httpStatus: number;
  constructor(message: string, httpStatus = 400) {
    super(message);
    this.name = 'MemberError';
    this.httpStatus = httpStatus;
  }
}

export interface MemberRow {
  userId: string;
  email: string;
  name: string | null;
  roles: EventRole[];
  tracks: string[];
}

/** 活动成员一览(按人聚合角色与管辖分会) */
export async function listEventMembers(
  eventId: string, db: Db = defaultDb,
): Promise<MemberRow[]> {
  const rows = await db.select({
    userId: eventMembers.userId,
    role: eventMembers.role,
    email: users.email,
    name: users.name,
  }).from(eventMembers)
    .innerJoin(users, eq(eventMembers.userId, users.id))
    .where(and(eq(eventMembers.eventId, eventId), isNull(users.deletedAt)));

  const chairRows = await db.select({
    userId: sessionChairs.userId, track: sessionChairs.track,
  }).from(sessionChairs).where(eq(sessionChairs.eventId, eventId));

  const byUser = new Map<string, MemberRow>();
  for (const r of rows) {
    const cur = byUser.get(r.userId) ?? {
      userId: r.userId, email: r.email, name: r.name, roles: [], tracks: [],
    };
    cur.roles.push(r.role as EventRole);
    byUser.set(r.userId, cur);
  }
  for (const ch of chairRows) {
    const cur = byUser.get(ch.userId);
    if (cur) cur.tracks.push(ch.track);
  }
  return [...byUser.values()].sort((a, b) => a.email.localeCompare(b.email));
}

/**
 * 授予角色。用户不存在时按邮箱创建 —— 「任何账户都能提升为管理员」,
 * 也意味着可以直接用邮箱把还没登录过的人加进来,他首次登录即生效。
 */
export async function grantRole(
  input: {
    eventId: string; email: string; role: EventRole;
    tracks?: string[]; actor: Actor & { id: string };
  },
  db: Db = defaultDb,
): Promise<{ userId: string; created: boolean }> {
  const email = normalizeEmail(input.email);
  if (!EVENT_ROLES.includes(input.role)) {
    throw new MemberError(`未知角色:${input.role}`, 422);
  }
  if (input.role === 'session_chair' && (input.tracks ?? []).length === 0) {
    throw new MemberError('分会主席必须指定至少一个分会', 422);
  }

  const [ev] = await db.select({ organizationId: events.organizationId })
    .from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!ev) throw new MemberError('活动不存在', 404);

  let created = false;
  let [user] = await db.select().from(users)
    .where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
  if (!user) {
    [user] = await db.insert(users).values({ email, isGuest: false }).returning();
    created = true;
  }

  await db.transaction(async (tx) => {
    const [existing] = await tx.select().from(eventMembers)
      .where(and(
        eq(eventMembers.eventId, input.eventId),
        eq(eventMembers.userId, user!.id),
        eq(eventMembers.role, input.role),
      )).limit(1);
    if (!existing) {
      await tx.insert(eventMembers).values({
        eventId: input.eventId, userId: user!.id, role: input.role,
      });
    }

    if (input.role === 'session_chair') {
      for (const track of input.tracks ?? []) {
        const [has] = await tx.select().from(sessionChairs)
          .where(and(
            eq(sessionChairs.eventId, input.eventId),
            eq(sessionChairs.userId, user!.id),
            eq(sessionChairs.track, track),
          )).limit(1);
        if (!has) {
          await tx.insert(sessionChairs).values({
            eventId: input.eventId, userId: user!.id, track,
          });
        }
      }
    }

    await audit(tx as unknown as Db, {
      organizationId: ev.organizationId,
      eventId: input.eventId,
      actorType: 'user',
      actorId: input.actor.id,
      action: 'member.role_granted',
      targetType: 'user',
      targetId: user!.id,
      diff: { role: input.role, tracks: input.tracks ?? [], email },
      ip: input.actor.ip ?? null,
    });
  });

  // 权限变更后使该用户会话失效,新权限立即生效(ch06 §6.3)
  await revokeAllSessions(user!.id, db);
  return { userId: user!.id, created };
}

/** 回收角色 */
export async function revokeRole(
  input: { eventId: string; userId: string; role: EventRole; actor: Actor & { id: string } },
  db: Db = defaultDb,
): Promise<void> {
  const [ev] = await db.select({ organizationId: events.organizationId })
    .from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!ev) throw new MemberError('活动不存在', 404);

  // 不能移除最后一个管理员,否则活动将无人可管
  if (input.role === 'organizer') {
    const [row] = await db.select({ n: sql<number>`count(*)::int` })
      .from(eventMembers)
      .where(and(
        eq(eventMembers.eventId, input.eventId),
        eq(eventMembers.role, 'organizer'),
      ));
    if ((row?.n ?? 0) <= 1) {
      throw new MemberError('不能移除最后一位大会管理员', 409);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(eventMembers).where(and(
      eq(eventMembers.eventId, input.eventId),
      eq(eventMembers.userId, input.userId),
      eq(eventMembers.role, input.role),
    ));
    if (input.role === 'session_chair') {
      await tx.delete(sessionChairs).where(and(
        eq(sessionChairs.eventId, input.eventId),
        eq(sessionChairs.userId, input.userId),
      ));
    }
    await audit(tx as unknown as Db, {
      organizationId: ev.organizationId,
      eventId: input.eventId,
      actorType: 'user',
      actorId: input.actor.id,
      action: 'member.role_revoked',
      targetType: 'user',
      targetId: input.userId,
      diff: { role: input.role },
      ip: input.actor.ip ?? null,
    });
  });

  await revokeAllSessions(input.userId, db);
}

/** 活动内所有分会代码(用于分配分会主席) */
export async function listEventTracks(
  eventId: string, db: Db = defaultDb,
): Promise<string[]> {
  const rows = await db.selectDistinct({ track: submissions.track })
    .from(submissions)
    .where(and(
      eq(submissions.eventId, eventId),
      sql`${submissions.track} IS NOT NULL`,
    ));
  return rows.map((r) => r.track).filter((t): t is string => Boolean(t)).sort();
}

/** 某分会的主席名单(公共日程页可展示) */
export async function listTrackChairs(
  eventId: string, track: string, db: Db = defaultDb,
) {
  return db.select({
    userId: sessionChairs.userId,
    name: users.name,
    email: users.email,
    isConvener: sessionChairs.isConvener,
  }).from(sessionChairs)
    .innerJoin(users, eq(sessionChairs.userId, users.id))
    .where(and(eq(sessionChairs.eventId, eventId), eq(sessionChairs.track, track)));
}
