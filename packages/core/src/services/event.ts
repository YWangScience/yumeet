/** 活动服务(ch05 §5.4 生命周期;ch03 §3.4 URL) */
import { and, asc, count, eq, sql } from 'drizzle-orm';
import {
  db as defaultDb, events, organizations, registrationForms, tickets,
  rooms, sessions, eventPages, submissions, type Db,
} from '@yumeet/db';

/** live/ended 是派生展示态,不入库(ch05 §5.4) */
export type DisplayStatus = 'draft' | 'published' | 'live' | 'ended' | 'archived';

export function displayStatus(e: {
  status: string; startsAt: Date; endsAt: Date;
}, now = new Date()): DisplayStatus {
  if (e.status === 'draft') return 'draft';
  if (e.status === 'archived') return 'archived';
  if (now >= e.startsAt && now <= e.endsAt) return 'live';
  if (now > e.endsAt) return 'ended';
  return 'published';
}

export async function getEventBySlug(orgSlug: string, eventSlug: string, db: Db = defaultDb) {
  const [row] = await db.select({ event: events, org: organizations })
    .from(events)
    .innerJoin(organizations, eq(events.organizationId, organizations.id))
    .where(and(
      eq(organizations.slug, orgSlug),
      eq(events.slug, eventSlug),
      sql`${events.deletedAt} IS NULL`,
    ))
    .limit(1);
  return row ?? null;
}

export async function getEventForms(eventId: string, db: Db = defaultDb) {
  return db.select().from(registrationForms)
    .where(eq(registrationForms.eventId, eventId))
    .orderBy(asc(registrationForms.createdAt));
}

export async function getEventTickets(eventId: string, db: Db = defaultDb) {
  return db.select().from(tickets)
    .where(and(eq(tickets.eventId, eventId), eq(tickets.hidden, false)))
    .orderBy(asc(tickets.position));
}

export async function getEventSchedule(eventId: string, db: Db = defaultDb) {
  const roomRows = await db.select().from(rooms)
    .where(eq(rooms.eventId, eventId)).orderBy(asc(rooms.position));
  const sessionRows = await db.select().from(sessions)
    .where(and(eq(sessions.eventId, eventId), sql`${sessions.deletedAt} IS NULL`))
    .orderBy(asc(sessions.startsAt));
  return { rooms: roomRows, sessions: sessionRows };
}

export async function listPublishedEvents(orgSlug: string, db: Db = defaultDb) {
  return db.select({ event: events, org: organizations })
    .from(events)
    .innerJoin(organizations, eq(events.organizationId, organizations.id))
    .where(and(
      eq(organizations.slug, orgSlug),
      eq(events.status, 'published'),
      eq(events.visibility, 'public'),
      sql`${events.deletedAt} IS NULL`,
    ))
    .orderBy(asc(events.startsAt));
}

/* ---------- 自定义页面(承载科学目标/委员会/住宿等任意内容页) ---------- */

export async function listEventPages(eventId: string, db: Db = defaultDb) {
  return db.select().from(eventPages)
    .where(and(
      eq(eventPages.eventId, eventId),
      sql`${eventPages.deletedAt} IS NULL`,
    ))
    .orderBy(asc(eventPages.position), asc(eventPages.title));
}

/** 导航栏用:只取标记为 showInNav 的页面 */
export async function listNavPages(eventId: string, db: Db = defaultDb) {
  return db.select().from(eventPages)
    .where(and(
      eq(eventPages.eventId, eventId),
      eq(eventPages.showInNav, true),
      sql`${eventPages.deletedAt} IS NULL`,
    ))
    .orderBy(asc(eventPages.position), asc(eventPages.title));
}

export async function getEventPage(eventId: string, slug: string, db: Db = defaultDb) {
  const [row] = await db.select().from(eventPages)
    .where(and(
      eq(eventPages.eventId, eventId),
      eq(eventPages.slug, slug),
      sql`${eventPages.deletedAt} IS NULL`,
    ))
    .limit(1);
  return row ?? null;
}

/* ---------- 摘要检索(归档会议的核心入口,ch05 §5.4 + ch13 §13.6) ---------- */

export interface AbstractSearchOpts {
  q?: string;
  track?: string;
  limit?: number;
  offset?: number;
}

/**
 * 全文检索用 PostgreSQL 内置 FTS(ch13 §13.6 的默认方案,可选升级 Meilisearch)。
 * 匹配标题、摘要正文与作者名。
 */
export async function searchAbstracts(
  eventId: string,
  opts: AbstractSearchOpts = {},
  db: Db = defaultDb,
) {
  const limit = Math.min(opts.limit ?? 25, 100);
  const offset = opts.offset ?? 0;
  const q = (opts.q ?? '').trim();

  const conds = [
    eq(submissions.eventId, eventId),
    sql`${submissions.deletedAt} IS NULL`,
  ];
  if (opts.track) conds.push(eq(submissions.track, opts.track));
  if (q) {
    const pattern = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conds.push(sql`(
      ${submissions.title} ILIKE ${pattern}
      OR ${submissions.abstract} ILIKE ${pattern}
      OR ${submissions.authors}::text ILIKE ${pattern}
    )`);
  }
  const where = and(...conds);

  const rows = await db.select({
    id: submissions.id,
    title: submissions.title,
    track: submissions.track,
    type: submissions.type,
    authors: submissions.authors,
  }).from(submissions)
    .where(where)
    .orderBy(asc(submissions.title))
    .limit(limit)
    .offset(offset);

  const [{ total = 0 } = { total: 0 }] = await db
    .select({ total: count() }).from(submissions).where(where);

  const [{ totalAll = 0 } = { totalAll: 0 }] = await db
    .select({ totalAll: count() }).from(submissions)
    .where(and(eq(submissions.eventId, eventId), sql`${submissions.deletedAt} IS NULL`));

  return { rows, total, totalAll, limit, offset };
}

export async function listTracks(eventId: string, db: Db = defaultDb) {
  const rows = await db
    .select({ track: submissions.track, n: count() })
    .from(submissions)
    .where(and(
      eq(submissions.eventId, eventId),
      sql`${submissions.track} IS NOT NULL`,
      sql`${submissions.deletedAt} IS NULL`,
    ))
    .groupBy(submissions.track)
    .orderBy(asc(submissions.track));
  return rows.filter((r): r is { track: string; n: number } => r.track !== null);
}

export async function getAbstract(eventId: string, id: string, db: Db = defaultDb) {
  const [row] = await db.select().from(submissions)
    .where(and(
      eq(submissions.eventId, eventId),
      eq(submissions.id, id),
      sql`${submissions.deletedAt} IS NULL`,
    ))
    .limit(1);
  return row ?? null;
}
