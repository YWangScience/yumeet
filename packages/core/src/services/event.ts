/** 活动服务(ch05 §5.4 生命周期;ch03 §3.4 URL) */
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  db as defaultDb, events, organizations, registrationForms, tickets,
  rooms, sessions, type Db,
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
