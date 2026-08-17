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

/**
 * 支付方式。除 stripe 外均为**线下异步核销**:
 * 下单后订单停在 pending,由组织者(或签到台)确认到账后才推进状态机。
 * 这三类在国内会议中是主力:对公转账要发票、支付宝/微信是个人主流、现场付适合临时参会。
 */
export const paymentMethod = pgEnum('payment_method', [
  'stripe',         // 在线卡支付,webhook 自动确认
  'bank_transfer',  // 银行/对公转账,凭汇款附言的参考号核销
  'alipay',         // 支付宝(收款码 + 人工核销)
  'wechat',         // 微信支付(收款码 + 人工核销)
  'onsite',         // 现场支付,签到时结算
  'free',           // 免费票或全额优惠
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
  /** 支付方式;线下方式需人工核销 */
  method: paymentMethod('method').notNull().default('stripe'),
  /**
   * 付款参考号:8 位短码,要求付款人填在转账附言/备注里。
   * 这是把一笔到账对应回订单的唯一线索,因此必须短、易抄写、无易混字符。
   */
  paymentReference: text('payment_reference'),
  /** 付款凭证截图(files.id),支付宝/微信/转账场景由付款人上传 */
  proofFileId: uuid('proof_file_id'),
  /** 核销人与核销时间:谁确认了这笔线下到账 */
  reconciledBy: uuid('reconciled_by').references(() => users.id),
  reconciledAt: ts('reconciled_at'),
  /** 核销备注,如流水号后四位 */
  reconcileNote: text('reconcile_note'),
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
  index('orders_reference_idx').on(t.paymentReference),
  index('orders_reconcile_idx').on(t.eventId, t.method, t.status),
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
  /** 组织者与自动化规则打的标签(ch13 §13.5 的 tag.add/remove) */
  tags: text('tags').array().notNull().default(sql`ARRAY[]::text[]`),
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
