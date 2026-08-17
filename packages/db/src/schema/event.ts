// packages/db/src/schema/event.ts — 活动域(ch09 §9.2)
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  pgTable, pgEnum, uuid, text, boolean, integer, jsonb, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import { organizations, ts } from './identity';
import type { EventContent, EventModules, FormField, TokenOverrides, Venue } from './types';

export const eventStatus = pgEnum('event_status', ['draft', 'published', 'archived']);
// live / ended 是按 starts_at / ends_at 派生的展示态,不入库(见 ch05 §5.4)
export const eventVisibility = pgEnum('event_visibility', ['public', 'unlisted', 'private']);

export const events = pgTable('events', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  slug: text('slug').notNull(),
  title: text('title').notNull(),
  subtitle: text('subtitle'),
  description: text('description'),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  timezone: text('timezone').notNull(),
  venue: jsonb('venue').$type<Venue>(),
  visibility: eventVisibility('visibility').notNull().default('public'),
  status: eventStatus('status').notNull().default('draft'),
  modules: jsonb('modules').$type<EventModules>().notNull().default({}),
  /** 内容多语言:{ en: { title, subtitle, description }, zh: {...} }(ch09 §9.3 I18nString) */
  contentI18n: jsonb('content_i18n').$type<Record<string, EventContent>>(),
  themeId: text('theme_id').notNull().default('cupertino'),
  themeOverrides: jsonb('theme_overrides').$type<TokenOverrides>(),
  publishedAt: ts('published_at'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
}, (t) => [
  uniqueIndex('events_org_slug_uq').on(t.organizationId, t.slug)
    .where(sql`${t.deletedAt} IS NULL`),
  index('events_status_starts_idx').on(t.status, t.startsAt),
]);

export const registrationForms = pgTable('registration_forms', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  name: text('name').notNull(),
  fields: jsonb('fields').$type<FormField[]>().notNull(),
  version: integer('version').notNull().default(1),
  opensAt: ts('opens_at'),
  closesAt: ts('closes_at'),
  capacity: integer('capacity'),
  waitlistEnabled: boolean('waitlist_enabled').notNull().default(false),
  approvalRequired: boolean('approval_required').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('registration_forms_event_idx').on(t.eventId)]);

/** 表单历史版本(ch09 §9.3:版本固定,旧数据永远可解释) */
export const registrationFormRevisions = pgTable('registration_form_revisions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  formId: uuid('form_id').notNull().references(() => registrationForms.id),
  version: integer('version').notNull(),
  fields: jsonb('fields').$type<FormField[]>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('form_revisions_uq').on(t.formId, t.version)]);

export const tickets = pgTable('tickets', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  name: text('name').notNull(),
  description: text('description'),
  priceCents: integer('price_cents').notNull().default(0),
  currency: text('currency').notNull().default('EUR'),
  quantityTotal: integer('quantity_total'),
  quantitySold: integer('quantity_sold').notNull().default(0), // 扣减时序见 ch13 §13.3
  maxPerOrder: integer('max_per_order').notNull().default(10),
  salesOpenAt: ts('sales_open_at'),
  salesCloseAt: ts('sales_close_at'),
  hidden: boolean('hidden').notNull().default(false),
  position: integer('position').notNull().default(0),
}, (t) => [index('tickets_event_idx').on(t.eventId)]);
