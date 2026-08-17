// packages/db/src/schema/identity.ts — 身份域(ch09 §9.2)
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  pgTable, pgEnum, uuid, text, boolean, integer, jsonb,
  timestamp, uniqueIndex, index,
} from 'drizzle-orm/pg-core';
import type { OrgSettings } from './types';

export const ts = (name: string) => timestamp(name, { withTimezone: true });
// 主键统一在应用层以 $defaultFn(uuidv7) 生成 UUIDv7(时间有序,见 9.1),
// 不使用数据库端 gen_random_uuid() / defaultRandom() 的 UUID v4

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'anonymized']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  email: text('email').notNull(),
  name: text('name'),
  avatarFileId: uuid('avatar_file_id'),
  locale: text('locale').notNull().default('en'),
  timezone: text('timezone').notNull().default('UTC'),
  isGuest: boolean('is_guest').notNull().default(true), // 访客优先(ch06 §6.1)
  status: userStatus('status').notNull().default('active'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
  anonymizedAt: ts('anonymized_at'),
}, (t) => [
  uniqueIndex('users_email_uq').on(t.email).where(sql`${t.deletedAt} IS NULL`),
]);

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  customDomain: text('custom_domain'),
  settings: jsonb('settings').$type<OrgSettings>().notNull().default({}),
  retentionDays: integer('retention_days').notNull().default(730), // 与 ch12 §12.3 权威表一致
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  deletedAt: ts('deleted_at'),
}, (t) => [uniqueIndex('organizations_slug_uq').on(t.slug)]);

/** 组织级角色(ch06 §6.4:两级角色 × 能力矩阵) */
export const orgRole = pgEnum('org_role', ['owner', 'admin', 'member']);

export const organizationMembers = pgTable('organization_members', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull().references(() => organizations.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: orgRole('role').notNull().default('member'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('org_members_uq').on(t.organizationId, t.userId),
]);

/**
 * 活动级角色(ch06 §6.4,按会议组织的真实职责扩展)
 *
 * 会议的权力结构不是扁平的:
 *   organizer      —— 大会总负责,可改一切(相当于活动内的管理员)
 *   ioc_chair      —— 国际组织委员会主席:定学术方向,可管全部投稿与分会编排
 *   ioc_member     —— IOC 委员:可看全部投稿、参与决议,不改日程
 *   loc_chair      —— 本地组织委员会主席:管注册、场地、现场与财务,不碰学术决议
 *   loc_member     —— LOC 成员:执行层,签到与名单
 *   session_chair  —— 分会主席:只管自己那个分会(见 event_session_chairs)
 *   collaborator   —— 协作者:能编辑内容但不做决议
 *   reviewer       —— 审稿人
 *   volunteer      —— 志愿者:仅现场签到
 *
 * 学术权力(IOC)与事务权力(LOC)分离是学术会议的通例:
 * 谁能决定录用,与谁能决定退款,本就不该是同一批人。
 */
export const eventRole = pgEnum('event_role', [
  'organizer',
  'ioc_chair', 'ioc_member',
  'loc_chair', 'loc_member',
  'session_chair',
  'collaborator', 'reviewer', 'volunteer',
]);

export const eventMembers = pgTable('event_members', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  role: eventRole('role').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('event_members_uq').on(t.eventId, t.userId, t.role),
  index('event_members_user_idx').on(t.userId),
]);

/** 会话(ch06 §6.3):httpOnly cookie 会话 + 旋转刷新令牌 */
export const sessionsAuth = pgTable('auth_sessions', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  userId: uuid('user_id').notNull().references(() => users.id),
  tokenHash: text('token_hash').notNull(),
  userAgent: text('user_agent'),
  ip: text('ip'),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('auth_sessions_token_uq').on(t.tokenHash),
  index('auth_sessions_user_idx').on(t.userId),
]);

/** magic link / 一次性登录令牌(ch06 §6.2) */
export const loginTokens = pgTable('login_tokens', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  email: text('email').notNull(),
  tokenHash: text('token_hash').notNull(),
  purpose: text('purpose').notNull().default('login'),
  consumedAt: ts('consumed_at'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('login_tokens_hash_uq').on(t.tokenHash)]);

/**
 * 分会主席的管辖范围(ch06 §6.4 的对象级授权落点)
 *
 * 一个平行分会可以有多位主席;他们只对**自己分会内**的投稿有决定权:
 * 批准/退回报告、在本分会已分配的时段内排定每个报告的具体时刻。
 * 整个分会占用哪个时间段、放在哪个会场,由大会管理员统一安排 ——
 * 这条边界是会议能开起来的前提,否则各分会会互相抢时段与会场。
 */
export const sessionChairs = pgTable('event_session_chairs', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull().references(() => users.id),
  /** 管辖的分会:对应 submissions.track 与 sessions 的分组键(如 BH2、GW4) */
  track: text('track').notNull(),
  /** 是否为该分会的召集人(多位主席时的首要联系人) */
  isConvener: boolean('is_convener').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('session_chairs_uq').on(t.eventId, t.userId, t.track),
  index('session_chairs_track_idx').on(t.eventId, t.track),
]);
