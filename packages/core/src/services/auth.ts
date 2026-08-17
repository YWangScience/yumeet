/**
 * 身份认证(ch06 §6.2 认证方式 + §6.3 会话与凭证安全)
 *
 * yuMeet 不实现密码。本模块提供 magic link 与会话两条核心链路;
 * passkey / OAuth / 企业 SSO 在此基础上扩展(见文件末尾的扩展点)。
 *
 * 三条硬规则:
 *  1. 库中只存 token 的哈希,泄库不可用
 *  2. purpose 硬隔离 —— 访客的报名管理凭证永远换不出登录会话
 *  3. 会话是服务端不透明 id,不用可离线验证的 JWT(撤销必须即时生效)
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, gt, isNull, lt, sql, desc, count } from 'drizzle-orm';
import {
  db as defaultDb, users, loginTokens, sessionsAuth,
  organizationMembers, eventMembers, organizations, events,
  type Db,
} from '@yumeet/db';
import { audit } from '../audit/index';

/* ---------- 参数(ch06 §6.2、§6.3 的表) ---------- */

export const MAGIC_LINK_TTL_MS = 15 * 60 * 1000;        // 15 分钟
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 滑动 30 天
export const SESSION_ABSOLUTE_MAX_MS = 90 * 24 * 60 * 60 * 1000; // 绝对上限 90 天
export const STEP_UP_WINDOW_MS = 10 * 60 * 1000;        // 敏感操作重验证窗口
const RATE_LIMIT_MAX = 5;                                // 同邮箱 15 分钟内 5 次
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

export const SESSION_COOKIE = '__Host-yumeet_s';
export const REFRESH_COOKIE = '__Host-yumeet_r';

/** token 用途硬隔离:报名追踪凭证不能换登录会话 */
export type TokenPurpose = 'login' | 'registration_access' | 'step_up';

export class AuthError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** 邮箱归一化:小写 + 去空白(IDN 归一化留给上层) */
export const normalizeEmail = (e: string) => e.trim().toLowerCase();

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/* ---------- Magic link ---------- */

export interface MagicLinkIssued {
  /** 明文 token,只在此刻存在一次,用于拼登录链接 */
  token: string;
  email: string;
  expiresAt: Date;
}

/**
 * 签发 magic link。库中只存哈希;同邮箱短时间内超过 5 次直接拒绝。
 * 注意:无论邮箱是否已注册都返回成功,避免成为账号存在性预言机(ch12 §12.1)。
 */
export async function issueMagicLink(
  emailRaw: string,
  purpose: TokenPurpose = 'login',
  db: Db = defaultDb,
): Promise<MagicLinkIssued> {
  const email = normalizeEmail(emailRaw);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new AuthError('invalid_email', '邮箱格式不正确', 422);
  }

  const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
  const [{ n = 0 } = { n: 0 }] = await db
    .select({ n: count() })
    .from(loginTokens)
    .where(and(eq(loginTokens.email, email), gt(loginTokens.createdAt, since)));
  if (n >= RATE_LIMIT_MAX) {
    throw new AuthError('rate_limited', '请求过于频繁,请 15 分钟后再试', 429);
  }

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + MAGIC_LINK_TTL_MS);
  await db.insert(loginTokens).values({
    email,
    tokenHash: sha256(token),
    purpose,
    expiresAt,
  });

  return { token, email, expiresAt };
}

export interface SessionIssued {
  sessionToken: string;
  refreshToken: string;
  userId: string;
  expiresAt: Date;
}

/**
 * 校验 magic link 并换取会话。
 * purpose 不匹配即拒绝 —— 这是访客凭证与登录会话之间的硬隔离。
 */
export async function consumeMagicLink(
  token: string,
  opts: { purpose?: TokenPurpose; userAgent?: string | null; ip?: string | null } = {},
  db: Db = defaultDb,
): Promise<SessionIssued> {
  const purpose = opts.purpose ?? 'login';
  const hash = sha256(token);

  const [row] = await db.select().from(loginTokens)
    .where(eq(loginTokens.tokenHash, hash))
    .limit(1);

  if (!row) throw new AuthError('invalid_token', '链接无效或已被使用', 401);
  if (!safeEqual(row.tokenHash, hash)) throw new AuthError('invalid_token', '链接无效', 401);
  if (row.consumedAt) throw new AuthError('token_used', '该链接已被使用过', 401);
  if (row.expiresAt.getTime() < Date.now()) throw new AuthError('token_expired', '链接已过期', 401);
  if (row.purpose !== purpose) {
    // 报名管理链接永远换不出登录会话
    throw new AuthError('purpose_mismatch', '该链接不能用于登录', 403);
  }

  return db.transaction(async (tx) => {
    // 单次使用:先标记再发会话,并发下只有一方成功
    const marked = await tx.update(loginTokens)
      .set({ consumedAt: new Date() })
      .where(and(eq(loginTokens.id, row.id), isNull(loginTokens.consumedAt)))
      .returning({ id: loginTokens.id });
    if (marked.length === 0) throw new AuthError('token_used', '该链接已被使用过', 401);

    // 首次登录即建账户(访客优先:报名不建账户,登录才建)
    let [user] = await tx.select().from(users)
      .where(and(eq(users.email, row.email), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      [user] = await tx.insert(users).values({
        email: row.email, isGuest: false,
      }).returning();
    } else if (user.isGuest) {
      await tx.update(users).set({ isGuest: false, updatedAt: new Date() })
        .where(eq(users.id, user.id));
    }

    const sessionToken = randomBytes(16).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await tx.insert(sessionsAuth).values({
      userId: user!.id,
      tokenHash: sha256(sessionToken),
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
      expiresAt,
    });

    return { sessionToken, refreshToken, userId: user!.id, expiresAt };
  });
}

/* ---------- 会话 ---------- */

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  locale: string;
  timezone: string;
  sessionId: string;
  createdAt: Date;
}

/** 校验会话 cookie;顺带滑动续期 */
export async function resolveSession(
  sessionToken: string | undefined | null,
  db: Db = defaultDb,
): Promise<SessionUser | null> {
  if (!sessionToken) return null;
  const hash = sha256(sessionToken);

  const [row] = await db.select({
    s: sessionsAuth, u: users,
  }).from(sessionsAuth)
    .innerJoin(users, eq(sessionsAuth.userId, users.id))
    .where(and(
      eq(sessionsAuth.tokenHash, hash),
      isNull(sessionsAuth.revokedAt),
      gt(sessionsAuth.expiresAt, new Date()),
      isNull(users.deletedAt),
    ))
    .limit(1);

  if (!row) return null;
  if (row.u.status !== 'active') return null;

  // 绝对上限:超过 90 天强制重新认证
  if (Date.now() - row.s.createdAt.getTime() > SESSION_ABSOLUTE_MAX_MS) {
    await db.update(sessionsAuth).set({ revokedAt: new Date() })
      .where(eq(sessionsAuth.id, row.s.id));
    return null;
  }

  // 滑动续期(过半才写,避免每请求写库)
  const remaining = row.s.expiresAt.getTime() - Date.now();
  if (remaining < SESSION_TTL_MS / 2) {
    await db.update(sessionsAuth)
      .set({ expiresAt: new Date(Date.now() + SESSION_TTL_MS) })
      .where(eq(sessionsAuth.id, row.s.id));
  }

  return {
    id: row.u.id,
    email: row.u.email,
    name: row.u.name,
    locale: row.u.locale,
    timezone: row.u.timezone,
    sessionId: row.s.id,
    createdAt: row.s.createdAt,
  };
}

export async function revokeSession(sessionId: string, db: Db = defaultDb): Promise<void> {
  await db.update(sessionsAuth).set({ revokedAt: new Date() })
    .where(eq(sessionsAuth.id, sessionId));
}

/** 远程注销该用户全部会话(ch06 §6.3:权限变更时会话立即失效) */
export async function revokeAllSessions(userId: string, db: Db = defaultDb): Promise<number> {
  const rows = await db.update(sessionsAuth).set({ revokedAt: new Date() })
    .where(and(eq(sessionsAuth.userId, userId), isNull(sessionsAuth.revokedAt)))
    .returning({ id: sessionsAuth.id });
  return rows.length;
}

export async function listSessions(userId: string, db: Db = defaultDb) {
  return db.select().from(sessionsAuth)
    .where(and(eq(sessionsAuth.userId, userId), isNull(sessionsAuth.revokedAt)))
    .orderBy(desc(sessionsAuth.createdAt));
}

/** step-up:敏感操作要求 10 分钟内完成过一次重验证 */
export function isStepUpFresh(session: SessionUser, now = Date.now()): boolean {
  return now - session.createdAt.getTime() < STEP_UP_WINDOW_MS;
}

/* ---------- 授权:两级角色 → 能力(ch06 §6.4) ---------- */

export type Capability =
  | 'event.view' | 'event.edit' | 'event.publish' | 'event.delete'
  | 'registration.view' | 'registration.manage' | 'registration.export'
  | 'submission.view' | 'submission.manage' | 'submission.decide'
  | 'review.submit'
  | 'schedule.edit' | 'schedule.publish'
  | 'design.edit'
  | 'onsite.checkin'
  | 'member.manage'
  | 'webhook.manage'
  | 'privacy.manage';

const ORG_ROLE_CAPS: Record<string, Capability[]> = {
  owner: ['event.view', 'event.edit', 'event.publish', 'event.delete',
    'registration.view', 'registration.manage', 'registration.export',
    'submission.view', 'submission.manage', 'submission.decide',
    'schedule.edit', 'schedule.publish', 'design.edit', 'onsite.checkin',
    'member.manage', 'webhook.manage', 'privacy.manage'],
  admin: ['event.view', 'event.edit', 'event.publish',
    'registration.view', 'registration.manage', 'registration.export',
    'submission.view', 'submission.manage', 'submission.decide',
    'schedule.edit', 'schedule.publish', 'design.edit', 'onsite.checkin',
    'member.manage', 'webhook.manage'],
  member: ['event.view'],
};

const EVENT_ROLE_CAPS: Record<string, Capability[]> = {
  organizer: ['event.view', 'event.edit', 'event.publish',
    'registration.view', 'registration.manage', 'registration.export',
    'submission.view', 'submission.manage', 'submission.decide',
    'schedule.edit', 'schedule.publish', 'design.edit', 'onsite.checkin'],
  collaborator: ['event.view', 'event.edit',
    'registration.view', 'submission.view', 'schedule.edit', 'design.edit'],
  reviewer: ['event.view', 'submission.view', 'review.submit'],
  volunteer: ['event.view', 'onsite.checkin'],
};

export interface Grant {
  capabilities: Set<Capability>;
  orgRole: string | null;
  eventRoles: string[];
}

/** 解析某用户在某活动上的全部能力(组织级 ∪ 活动级) */
export async function grantsFor(
  userId: string,
  eventId: string,
  db: Db = defaultDb,
): Promise<Grant> {
  const [ev] = await db.select({ organizationId: events.organizationId })
    .from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev) return { capabilities: new Set(), orgRole: null, eventRoles: [] };

  const [orgRow] = await db.select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, ev.organizationId),
      eq(organizationMembers.userId, userId),
    )).limit(1);

  const evRows = await db.select({ role: eventMembers.role })
    .from(eventMembers)
    .where(and(eq(eventMembers.eventId, eventId), eq(eventMembers.userId, userId)));

  const caps = new Set<Capability>();
  if (orgRow) for (const c of ORG_ROLE_CAPS[orgRow.role] ?? []) caps.add(c);
  for (const r of evRows) for (const c of EVENT_ROLE_CAPS[r.role] ?? []) caps.add(c);

  return {
    capabilities: caps,
    orgRole: orgRow?.role ?? null,
    eventRoles: evRows.map((r) => r.role),
  };
}

export class ForbiddenError extends Error {
  readonly httpStatus = 403;
  constructor(public readonly capability: Capability) {
    super(`缺少权限:${capability}`);
    this.name = 'ForbiddenError';
  }
}

/**
 * 对象级授权的统一入口(ch12 §12.1 防御一)。
 * 每个受保护操作都必须过这里,而不是各页面自行判断。
 */
export async function requireCapability(
  userId: string,
  eventId: string,
  capability: Capability,
  db: Db = defaultDb,
): Promise<Grant> {
  const grant = await grantsFor(userId, eventId, db);
  if (!grant.capabilities.has(capability)) throw new ForbiddenError(capability);
  return grant;
}

/** 组织级检查(尚未进入具体活动时用,如组织设置页) */
export async function requireOrgRole(
  userId: string,
  organizationId: string,
  roles: string[] = ['owner', 'admin'],
  db: Db = defaultDb,
): Promise<string> {
  const [row] = await db.select({ role: organizationMembers.role })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, organizationId),
      eq(organizationMembers.userId, userId),
    )).limit(1);
  if (!row || !roles.includes(row.role)) throw new ForbiddenError('member.manage');
  return row.role;
}

/* ---------- 维护 ---------- */

/** 清理过期的登录 token 与会话(由 worker 定时调用) */
export async function pruneExpiredAuth(db: Db = defaultDb): Promise<{
  tokens: number; sessions: number;
}> {
  const now = new Date();
  const tokens = await db.delete(loginTokens)
    .where(lt(loginTokens.expiresAt, now))
    .returning({ id: loginTokens.id });
  const sessions = await db.delete(sessionsAuth)
    .where(lt(sessionsAuth.expiresAt, now))
    .returning({ id: sessionsAuth.id });
  return { tokens: tokens.length, sessions: sessions.length };
}

/** 记录一次认证事件到审计链 */
export async function auditAuth(
  db: Db,
  entry: {
    organizationId: string; userId: string; action: string;
    ip?: string | null; diff?: Record<string, unknown>;
  },
): Promise<void> {
  await audit(db, {
    organizationId: entry.organizationId,
    actorType: 'user',
    actorId: entry.userId,
    action: entry.action,
    targetType: 'user',
    targetId: entry.userId,
    diff: entry.diff ?? null,
    ip: entry.ip ?? null,
  });
}

/**
 * 扩展点:passkey(SimpleWebAuthn)、OAuth(PKCE)、企业 SSO(OIDC)
 * 按 ch06 §6.2 挂在同一套 session 之上 —— 它们只负责证明「这个邮箱属于此人」,
 * 证明完成后一律调用本模块的 issueSessionForVerifiedEmail() 落到同一条会话链路。
 */
export async function issueSessionForVerifiedEmail(
  emailRaw: string,
  opts: { userAgent?: string | null; ip?: string | null } = {},
  db: Db = defaultDb,
): Promise<SessionIssued> {
  const email = normalizeEmail(emailRaw);
  return db.transaction(async (tx) => {
    let [user] = await tx.select().from(users)
      .where(and(eq(users.email, email), isNull(users.deletedAt))).limit(1);
    if (!user) {
      [user] = await tx.insert(users).values({ email, isGuest: false }).returning();
    }
    const sessionToken = randomBytes(16).toString('base64url');
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await tx.insert(sessionsAuth).values({
      userId: user!.id,
      tokenHash: sha256(sessionToken),
      userAgent: opts.userAgent ?? null,
      ip: opts.ip ?? null,
      expiresAt,
    });
    return { sessionToken, refreshToken, userId: user!.id, expiresAt };
  });
}
