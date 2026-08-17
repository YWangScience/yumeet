// packages/db/src/schema/registration.ts — 交易域(ch09 §9.2)
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  pgTable, pgEnum, uuid, text, integer, jsonb, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import { users, ts } from './identity';
import { events, registrationForms, tickets } from './event';

export const registrationStatus = pgEnum('registration_status', [
  'pending_review', 'waitlisted', 'awaiting_payment',
  'confirmed', 'checked_in', 'rejected', 'cancelled', 'expired',
]);
export const orderStatus = pgEnum('order_status', [
  'pending', 'paid', 'partially_refunded', 'refunded', 'cancelled', 'expired',
]);

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  userId: uuid('user_id').references(() => users.id),
  email: text('email').notNull(),
  status: orderStatus('status').notNull().default('pending'),
  totalCents: integer('total_cents').notNull(),
  currency: text('currency').notNull(),
  provider: text('provider'),
  providerRef: text('provider_ref'), // Checkout Session id(ch13 §13.3)
  couponCode: text('coupon_code'),
  expiresAt: ts('expires_at'),
  paidAt: ts('paid_at'),
  refundedAt: ts('refunded_at'),
  idempotencyKey: text('idempotency_key'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('orders_idem_uq').on(t.idempotencyKey),
  index('orders_event_status_idx').on(t.eventId, t.status),
]);

export const registrations = pgTable('registrations', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull().references(() => events.id),
  formId: uuid('form_id').notNull().references(() => registrationForms.id),
  formVersion: integer('form_version').notNull(),
  ticketId: uuid('ticket_id').references(() => tickets.id),
  orderId: uuid('order_id').references(() => orders.id),
  userId: uuid('user_id').references(() => users.id),
  email: text('email').notNull(),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull(),
  status: registrationStatus('status').notNull(),
  waitlistPosition: integer('waitlist_position'),
  confirmationCode: text('confirmation_code').notNull(),
  accessTokenHash: text('access_token_hash').notNull(), // /r/{token} 追踪页凭证(ch05 §5.5)
  confirmedAt: ts('confirmed_at'),
  checkedInAt: ts('checked_in_at'),
  cancelledAt: ts('cancelled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  // 同一表单同一邮箱仅一条「活跃」报名,取消/过期后可重报
  uniqueIndex('registrations_form_email_uq').on(t.formId, t.email)
    .where(sql`${t.status} NOT IN ('cancelled', 'expired', 'rejected')`),
  index('registrations_event_status_idx').on(t.eventId, t.status),
  uniqueIndex('registrations_token_uq').on(t.accessTokenHash),
]);
