// packages/db/src/schema/infra.ts — 基础设施域 + 审计(ch09 §9.2、§9.5)
import { uuidv7 } from 'uuidv7';
import {
  pgTable, pgEnum, uuid, text, boolean, integer, bigint, bigserial, jsonb, index,
} from 'drizzle-orm/pg-core';
import { organizations, users, ts } from './identity';
import { events } from './event';

export const fileScanStatus = pgEnum('file_scan_status', ['pending', 'clean', 'infected']);

export const files = pgTable('files', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  eventId: uuid('event_id').references(() => events.id),
  uploaderId: uuid('uploader_id').references(() => users.id),
  bucket: text('bucket').notNull().default('yumeet'),
  key: text('key').notNull(),
  filename: text('filename').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  sha256: text('sha256').notNull(),
  scanStatus: fileScanStatus('scan_status').notNull().default('pending'), // ch12 §12.2
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
}, (t) => [index('files_org_idx').on(t.organizationId)]);

export const webhooks = pgTable('webhooks', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  url: text('url').notNull(), // 出站前经 SSRF 防护校验(ch12 §12.1)
  secretEncrypted: text('secret_encrypted').notNull(),
  events: text('events').array().notNull(),
  active: boolean('active').notNull().default(true),
  failureCount: integer('failure_count').notNull().default(0),
  // 连续 5 天所有投递均失败时自动暂停并邮件告知(ch10 §10.3)
  disabledAt: ts('disabled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/**
 * 审计日志:追加型 + 哈希链(ch09 §9.5)。
 * 迁移中执行 REVOKE UPDATE, DELETE ON audit_logs FROM yumeet_app。
 */
export const auditLogs = pgTable('audit_logs', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  organizationId: uuid('organization_id').notNull(),
  eventId: uuid('event_id'),
  actorType: text('actor_type').notNull(), // 'user' | 'api_key' | 'system'
  actorId: uuid('actor_id'),
  action: text('action').notNull(),        // 与 ch10 §10.3 webhook 事件同命名空间
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  diff: jsonb('diff'),
  ip: text('ip'),
  prevHash: text('prev_hash').notNull(),
  hash: text('hash').notNull(),            // SHA-256(prevHash + canonical(payload))
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('audit_target_idx').on(t.targetType, t.targetId, t.createdAt)]);

/** 出站事件 outbox:事务提交后才投递副作用(ch09 §9.4 设计要点) */
export const outbox = pgTable('outbox', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull(),
  eventId: uuid('event_id'),
  topic: text('topic').notNull(),          // 'registration.created' 等
  payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  processedAt: ts('processed_at'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('outbox_pending_idx').on(t.processedAt, t.createdAt)]);

/** 邮件送达日志(保留 90 天,ch12 §12.3) */
export const emailLogs = pgTable('email_logs', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull(),
  eventId: uuid('event_id'),
  to: text('to').notNull(),
  template: text('template').notNull(),
  subject: text('subject').notNull(),
  status: text('status').notNull().default('queued'), // queued/sent/failed
  error: text('error'),
  sentAt: ts('sent_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('email_logs_to_idx').on(t.to, t.createdAt)]);
