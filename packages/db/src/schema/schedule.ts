// packages/db/src/schema/schedule.ts — 日程域(ch09 §9.2)
import { uuidv7 } from 'uuidv7';
import {
  pgTable, uuid, text, integer, jsonb, index,
} from 'drizzle-orm/pg-core';
import { ts } from './identity';
import { events } from './event';
import { submissions } from './cfp';
import type { SessionSpeaker } from './types';

export const rooms = pgTable('rooms', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  name: text('name').notNull(),
  capacity: integer('capacity'),
  location: text('location'),
  equipment: jsonb('equipment').$type<string[]>().notNull().default([]),
  position: integer('position').notNull().default(0), // 多轨时间表列序(ch05 §5.1)
}, (t) => [index('rooms_event_idx').on(t.eventId)]);

export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  roomId: uuid('room_id').references(() => rooms.id),
  submissionId: uuid('submission_id').references(() => submissions.id),
  parentId: uuid('parent_id'),
  title: text('title').notNull(),
  kind: text('kind').notNull().default('talk'), // talk/keynote/break/poster/social
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  speakers: jsonb('speakers').$type<SessionSpeaker[]>().notNull().default([]),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
}, (t) => [index('sessions_event_time_idx').on(t.eventId, t.startsAt)]);

/** 「发布」把当前 sessions 快照为一条 JSONB 记录,公共页只读最近快照(ch05 §5.1) */
export const scheduleSnapshots = pgTable('schedule_snapshots', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  version: integer('version').notNull().default(1),
  payload: jsonb('payload').$type<unknown>().notNull(),
  publishedAt: ts('published_at').notNull().defaultNow(),
}, (t) => [index('schedule_snapshots_event_idx').on(t.eventId, t.publishedAt)]);
