// packages/db/src/schema/cfp.ts — 征稿域(ch09 §9.2)
import { uuidv7 } from 'uuidv7';
import {
  pgTable, pgEnum, uuid, text, boolean, integer, jsonb, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import { users, ts } from './identity';
import { events } from './event';
import type { Author } from './types';

export const submissionStatus = pgEnum('submission_status', [
  'draft', 'submitted', 'under_review', 'changes_requested',
  'accepted', 'confirmed', 'scheduled', 'rejected', 'withdrawn',
]);
export const reviewStatus = pgEnum('review_status', ['assigned', 'draft', 'submitted']);

export const submissions = pgTable('submissions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  track: text('track'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  abstract: text('abstract').notNull(),
  authors: jsonb('authors').$type<Author[]>().notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
  status: submissionStatus('status').notNull().default('draft'),
  // waitlist 是录用决定上的标记,不是独立状态(ch04 §4.3)
  decisionWaitlisted: boolean('decision_waitlisted').notNull().default(false),
  accessTokenHash: text('access_token_hash'), // /s/{token} 追踪页凭证(ch05 §5.5)
  submittedAt: ts('submitted_at'),
  decidedAt: ts('decided_at'),
  withdrawnAt: ts('withdrawn_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
}, (t) => [index('submissions_event_status_idx').on(t.eventId, t.status)]);

export const reviews = pgTable('reviews', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id),
  scores: jsonb('scores').$type<Record<string, number>>().notNull().default({}),
  confidence: integer('confidence'),
  commentForCommittee: text('comment_for_committee'),
  commentForAuthors: text('comment_for_authors'),
  isConflict: boolean('is_conflict').notNull().default(false),
  status: reviewStatus('status').notNull().default('assigned'),
  submittedAt: ts('submitted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('reviews_sub_reviewer_uq').on(t.submissionId, t.reviewerId)]);
