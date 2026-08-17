/**
 * 报名服务(ch09 §9.4 状态机 + ch04 §4.2 注册票务 + ch13 §13.3 库存时序)
 * 业务逻辑唯一实现处 —— apps/web 经 Server Actions 进程内调用,apps/api 与 worker 同样 import 之。
 */
import { and, eq, sql, desc, count } from 'drizzle-orm';
import {
  db as defaultDb, events, registrationForms, registrations, tickets, orders, outbox,
  type Db,
} from '@yumeet/db';
import {
  assertRegistrationTransition, type RegStatus, InvalidTransitionError,
} from '../state/index';
import { validateAnswers, type FormField } from '../forms/types';
import {
  audit, generateAccessToken, generateConfirmationCode, hashToken, timelineFor,
} from '../audit/index';
import { encodeId } from '../ids/index';

export interface Actor {
  type: 'user' | 'api_key' | 'system';
  id?: string | null;
  ip?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: 'system' };

export class RegistrationError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'RegistrationError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface SubmitInput {
  eventId: string;
  formId: string;
  email: string;
  answers: Record<string, unknown>;
  ticketId?: string | null;
  userId?: string | null;
  actor?: Actor;
}

export interface SubmitResult {
  registrationId: string;
  publicId: string;
  status: RegStatus;
  accessToken: string;
  confirmationCode: string;
  trackingPath: string;
  waitlistPosition?: number | null;
}

/**
 * 提交报名(ch09 §9.4 的四条创建迁移):
 *   免费 + 免审批 + 有名额 → confirmed
 *   付费 + 免审批 + 有名额 → awaiting_payment
 *   approvalRequired      → pending_review
 *   名额满 + 候补开启      → waitlisted
 */
export async function submitRegistration(
  input: SubmitInput,
  db: Db = defaultDb,
): Promise<SubmitResult> {
  const actor: Actor = input.actor ?? { type: 'user', id: input.userId ?? null };

  const [form] = await db.select().from(registrationForms)
    .where(eq(registrationForms.id, input.formId)).limit(1);
  if (!form) throw new RegistrationError('form_not_found', '报名表单不存在', 404);
  if (form.eventId !== input.eventId) {
    throw new RegistrationError('form_event_mismatch', '表单与活动不匹配', 400);
  }

  const now = new Date();
  if (form.opensAt && now < form.opensAt) {
    throw new RegistrationError('registration_not_open', '报名尚未开放', 409);
  }
  if (form.closesAt && now > form.closesAt) {
    throw new RegistrationError('registration_closed', '报名已截止', 409);
  }

  // 字段引擎校验:隐藏字段不参与必填判断(ch09 §9.3)
  const parsed = validateAnswers(form.fields as FormField[], input.answers);
  if (!parsed.success) {
    throw new RegistrationError(
      'validation_failed',
      `表单校验失败: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`,
      422,
    );
  }

  const email = input.email.trim().toLowerCase();

  // 同一表单同一邮箱仅一条活跃报名(与 DB 部分唯一索引一致,提前给出友好报错)
  const [dup] = await db.select({ id: registrations.id, status: registrations.status })
    .from(registrations)
    .where(and(
      eq(registrations.formId, input.formId),
      eq(registrations.email, email),
      sql`${registrations.status} NOT IN ('cancelled', 'expired', 'rejected')`,
    )).limit(1);
  if (dup) throw new RegistrationError('already_registered', '该邮箱已报名此活动', 409);

  let ticket: typeof tickets.$inferSelect | undefined;
  if (input.ticketId) {
    [ticket] = await db.select().from(tickets).where(eq(tickets.id, input.ticketId)).limit(1);
    if (!ticket) throw new RegistrationError('ticket_not_found', '票种不存在', 404);
    if (ticket.eventId !== input.eventId) {
      throw new RegistrationError('ticket_event_mismatch', '票种与活动不匹配', 400);
    }
  }

  // 名额判定:表单 capacity 与票种库存(ch13 §13.3 的简化同步路径)
  const [{ used = 0 } = { used: 0 }] = await db
    .select({ used: count() })
    .from(registrations)
    .where(and(
      eq(registrations.formId, input.formId),
      sql`${registrations.status} IN ('pending_review','awaiting_payment','confirmed','checked_in')`,
    ));

  const formFull = form.capacity != null && used >= form.capacity;
  const ticketFull = ticket?.quantityTotal != null && ticket.quantitySold >= ticket.quantityTotal;
  const isFull = formFull || ticketFull;
  const isPaid = (ticket?.priceCents ?? 0) > 0;

  let status: RegStatus;
  let waitlistPosition: number | null = null;

  if (isFull) {
    if (!form.waitlistEnabled) {
      throw new RegistrationError('sold_out', '名额已满', 409);
    }
    status = 'waitlisted';
    const [{ wl = 0 } = { wl: 0 }] = await db
      .select({ wl: count() })
      .from(registrations)
      .where(and(
        eq(registrations.formId, input.formId),
        eq(registrations.status, 'waitlisted'),
      ));
    waitlistPosition = wl + 1;
  } else if (form.approvalRequired) {
    status = 'pending_review';
  } else if (isPaid) {
    status = 'awaiting_payment';
  } else {
    status = 'confirmed';
  }

  const accessToken = generateAccessToken();
  const confirmationCode = generateConfirmationCode();

  const registrationId = await db.transaction(async (tx) => {
    const [row] = await tx.insert(registrations).values({
      eventId: input.eventId,
      formId: input.formId,
      formVersion: form.version,
      ticketId: input.ticketId ?? null,
      userId: input.userId ?? null,
      email,
      answers: parsed.data as Record<string, unknown>,
      status,
      waitlistPosition,
      confirmationCode,
      accessTokenHash: hashToken(accessToken),
      confirmedAt: status === 'confirmed' ? new Date() : null,
    }).returning({ id: registrations.id });

    const id = row!.id;

    // 占用库存:确认与待支付都算占用(ch13 §13.3)
    if (ticket && (status === 'confirmed' || status === 'awaiting_payment')) {
      await tx.update(tickets)
        .set({ quantitySold: sql`${tickets.quantitySold} + 1` })
        .where(eq(tickets.id, ticket.id));
    }

    const [ev] = await tx.select({ organizationId: events.organizationId })
      .from(events).where(eq(events.id, input.eventId)).limit(1);

    await audit(tx as unknown as Db, {
      organizationId: ev!.organizationId,
      eventId: input.eventId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: `registration.${status === 'confirmed' ? 'confirmed' : 'created'}`,
      targetType: 'registration',
      targetId: id,
      diff: { status, ticketId: input.ticketId ?? null },
      ip: actor.ip ?? null,
    });

    // 副作用经 outbox,事务提交后由 worker 投递(ch09 §9.4 设计要点)
    await tx.insert(outbox).values({
      organizationId: ev!.organizationId,
      eventId: input.eventId,
      topic: 'registration.created',
      payload: { registrationId: id, status, email },
    });

    return id;
  });

  return {
    registrationId,
    publicId: encodeId('registration', registrationId),
    status,
    accessToken,
    confirmationCode,
    trackingPath: `/r/${accessToken}`,
    waitlistPosition,
  };
}

/** 状态迁移唯一入口(ch09 §9.4) */
export async function transitionRegistration(
  registrationId: string,
  to: RegStatus,
  actor: Actor,
  db: Db = defaultDb,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [reg] = await tx.select().from(registrations)
      .where(eq(registrations.id, registrationId))
      .for('update')
      .limit(1);
    if (!reg) throw new RegistrationError('not_found', '报名记录不存在', 404);

    assertRegistrationTransition(reg.status as RegStatus, to);

    const patch: Partial<typeof registrations.$inferInsert> = { status: to, updatedAt: new Date() };
    if (to === 'confirmed') patch.confirmedAt = new Date();
    if (to === 'checked_in') patch.checkedInAt = new Date();
    if (to === 'cancelled') patch.cancelledAt = new Date();

    await tx.update(registrations).set(patch).where(eq(registrations.id, registrationId));

    // 释放库存:进入非占用终态时回退计数
    if (reg.ticketId && ['cancelled', 'expired', 'rejected'].includes(to)) {
      await tx.update(tickets)
        .set({ quantitySold: sql`GREATEST(${tickets.quantitySold} - 1, 0)` })
        .where(eq(tickets.id, reg.ticketId));
    }

    const [ev] = await tx.select({ organizationId: events.organizationId })
      .from(events).where(eq(events.id, reg.eventId)).limit(1);

    await audit(tx as unknown as Db, {
      organizationId: ev!.organizationId,
      eventId: reg.eventId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: `registration.${to}`,
      targetType: 'registration',
      targetId: registrationId,
      diff: { from: reg.status, to },
      ip: actor.ip ?? null,
    });

    await tx.insert(outbox).values({
      organizationId: ev!.organizationId,
      eventId: reg.eventId,
      topic: to === 'checked_in' ? 'registration.checked_in' : `registration.${to}`,
      payload: { registrationId, from: reg.status, to },
    });
  });
}

/** 追踪页数据(ch05 §5.5:/r/{token} 免登录查询) */
export async function getRegistrationByToken(token: string, db: Db = defaultDb) {
  const [reg] = await db.select().from(registrations)
    .where(eq(registrations.accessTokenHash, hashToken(token)))
    .limit(1);
  if (!reg) return null;

  const [event] = await db.select().from(events).where(eq(events.id, reg.eventId)).limit(1);
  const [form] = await db.select().from(registrationForms)
    .where(eq(registrationForms.id, reg.formId)).limit(1);
  const ticket = reg.ticketId
    ? (await db.select().from(tickets).where(eq(tickets.id, reg.ticketId)).limit(1))[0]
    : undefined;
  const timeline = await timelineFor(db, 'registration', reg.id);

  return { registration: reg, event, form, ticket, timeline };
}

/** 按确认码查询(现场签到台用,ch05 §5.2) */
export async function getRegistrationByCode(
  eventId: string,
  code: string,
  db: Db = defaultDb,
) {
  const [reg] = await db.select().from(registrations)
    .where(and(
      eq(registrations.eventId, eventId),
      eq(registrations.confirmationCode, code.trim().toUpperCase()),
    )).limit(1);
  return reg ?? null;
}

/** 组织者名单(后台列表,ch03 §3.2) */
export async function listRegistrations(
  eventId: string,
  opts: { status?: RegStatus; limit?: number; offset?: number } = {},
  db: Db = defaultDb,
) {
  const limit = Math.min(opts.limit ?? 20, 100); // 分页上限 100(ch10 §10.2)
  const where = opts.status
    ? and(eq(registrations.eventId, eventId), eq(registrations.status, opts.status))
    : eq(registrations.eventId, eventId);

  const rows = await db.select().from(registrations)
    .where(where)
    .orderBy(desc(registrations.createdAt))
    .limit(limit)
    .offset(opts.offset ?? 0);

  const [{ total = 0 } = { total: 0 }] = await db
    .select({ total: count() }).from(registrations).where(where);

  return { rows, total, limit, offset: opts.offset ?? 0 };
}

/** 各状态计数(后台概览) */
export async function registrationStats(eventId: string, db: Db = defaultDb) {
  const rows = await db
    .select({ status: registrations.status, n: count() })
    .from(registrations)
    .where(eq(registrations.eventId, eventId))
    .groupBy(registrations.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.n;
  return out;
}
