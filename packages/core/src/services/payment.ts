/**
 * 支付与核销(ch04 §4.2 支付 + ch09 §9.4 状态机)
 *
 * yuMeet 支持两类支付:
 *   在线即时 —— Stripe Checkout,webhook 回调自动确认(ch10 §10.5)
 *   线下异步 —— 银行转账 / 支付宝 / 微信 / 现场支付,由人工核销后确认
 *
 * 关键设计:两类支付**共用同一条状态机**。
 * 线下支付不是特例分支,它只是把「谁来触发 awaiting_payment → confirmed」
 * 从 webhook 换成了组织者或签到台;订单与报名的状态语义完全一致。
 *
 * 这样做的好处是:退款、候补递补、库存释放、审计与 webhook 全部自动适用于线下订单,
 * 不需要为线下支付再写一套并行逻辑。
 */
import { randomBytes } from 'node:crypto';
import { and, eq, sql, desc, count, inArray } from 'drizzle-orm';
import {
  db as defaultDb, orders, registrations, tickets, events, users, outbox,
  type Db, type PaymentConfig,
} from '@yumeet/db';
import { audit } from '../audit/index';
import { transitionRegistration, type Actor } from './registration';

export type PaymentMethod =
  | 'stripe' | 'bank_transfer' | 'alipay' | 'wechat' | 'onsite' | 'free';

/** 线下方式:下单后停在 pending,等人工核销 */
export const OFFLINE_METHODS: PaymentMethod[] = [
  'bank_transfer', 'alipay', 'wechat', 'onsite',
];

export const isOffline = (m: PaymentMethod): boolean => OFFLINE_METHODS.includes(m);

export class PaymentError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'PaymentError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** 付款参考号:去掉易混字符,便于手写在汇款附言里 */
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export function generatePaymentReference(): string {
  const b = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i++) out += REF_ALPHABET[b[i]! % REF_ALPHABET.length];
  // 分两段更好抄写:AB3D-8KM2
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

/** 线下付款的订单有效期比在线长得多:转账与对公流程需要时间 */
const OFFLINE_ORDER_TTL_DAYS = 14;
const ONLINE_ORDER_TTL_MINUTES = 30;

export interface CreateOrderInput {
  eventId: string;
  registrationId: string;
  method: PaymentMethod;
  email: string;
  userId?: string | null;
  actor?: Actor;
  /** 幂等键:高并发下防重复下单(ch13 §13.3) */
  idempotencyKey?: string;
}

export interface OrderCreated {
  orderId: string;
  method: PaymentMethod;
  totalCents: number;
  currency: string;
  /** 线下支付才有:要求填在附言里的参考号 */
  paymentReference: string | null;
  expiresAt: Date | null;
  /** 在线支付才有:跳转地址 */
  checkoutUrl: string | null;
}

/**
 * 为一条待支付报名创建订单。
 * 线下方式生成参考号并给出较长有效期;在线方式留出 checkout 跳转位。
 */
export async function createOrder(
  input: CreateOrderInput,
  db: Db = defaultDb,
): Promise<OrderCreated> {
  const [reg] = await db.select().from(registrations)
    .where(eq(registrations.id, input.registrationId)).limit(1);
  if (!reg) throw new PaymentError('registration_not_found', '报名记录不存在', 404);
  if (reg.orderId) throw new PaymentError('order_exists', '该报名已有订单', 409);

  const ticket = reg.ticketId
    ? (await db.select().from(tickets).where(eq(tickets.id, reg.ticketId)).limit(1))[0]
    : undefined;
  const totalCents = ticket?.priceCents ?? 0;
  const currency = ticket?.currency ?? 'CNY';

  if (totalCents === 0) {
    throw new PaymentError('no_payment_needed', '免费票无需创建订单', 400);
  }

  const offline = isOffline(input.method);
  const expiresAt = offline
    ? new Date(Date.now() + OFFLINE_ORDER_TTL_DAYS * 86400_000)
    : new Date(Date.now() + ONLINE_ORDER_TTL_MINUTES * 60_000);
  const paymentReference = offline ? generatePaymentReference() : null;

  const [ev] = await db.select({ organizationId: events.organizationId })
    .from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!ev) throw new PaymentError('event_not_found', '活动不存在', 404);

  const orderId = await db.transaction(async (tx) => {
    const [row] = await tx.insert(orders).values({
      eventId: input.eventId,
      userId: input.userId ?? null,
      email: input.email.trim().toLowerCase(),
      status: 'pending',
      totalCents,
      currency,
      method: input.method,
      provider: input.method === 'stripe' ? 'stripe' : null,
      paymentReference,
      expiresAt,
      idempotencyKey: input.idempotencyKey ?? null,
    }).returning({ id: orders.id });

    await tx.update(registrations)
      .set({ orderId: row!.id, updatedAt: new Date() })
      .where(eq(registrations.id, input.registrationId));

    await audit(tx as unknown as Db, {
      organizationId: ev.organizationId,
      eventId: input.eventId,
      actorType: input.actor?.type ?? 'user',
      actorId: input.actor?.id ?? null,
      action: 'order.created',
      targetType: 'order',
      targetId: row!.id,
      diff: { method: input.method, totalCents, currency, offline },
      ip: input.actor?.ip ?? null,
    });

    return row!.id;
  });

  return {
    orderId,
    method: input.method,
    totalCents,
    currency,
    paymentReference,
    expiresAt,
    checkoutUrl: null, // Stripe 插件在此填入 Checkout Session URL
  };
}

/**
 * 核销一笔线下到账 —— 线下支付链路的核心动作。
 *
 * 它做三件事,且必须在同一事务内:
 *   1. 订单 pending → paid,记录核销人、时间与备注(可追溯到具体经办人)
 *   2. 驱动报名状态机 awaiting_payment → confirmed(与 Stripe webhook 走同一入口)
 *   3. 写审计 + 投 outbox,使确认邮件与 webhook 自动发出
 */
export async function reconcileOfflinePayment(
  orderId: string,
  actor: Actor & { id: string },
  opts: { note?: string; amountCents?: number } = {},
  db: Db = defaultDb,
): Promise<{ registrationIds: string[] }> {
  const [order] = await db.select().from(orders)
    .where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new PaymentError('order_not_found', '订单不存在', 404);
  if (order.status === 'paid') {
    throw new PaymentError('already_paid', '该订单已核销过', 409);
  }
  if (order.status !== 'pending') {
    throw new PaymentError('bad_status', `订单状态为 ${order.status},不能核销`, 409);
  }
  if (!isOffline(order.method as PaymentMethod)) {
    throw new PaymentError('not_offline', '在线支付订单由支付回调确认,不能人工核销', 400);
  }
  // 金额不符时要求显式确认,避免少收多收被静默接受
  if (opts.amountCents != null && opts.amountCents !== order.totalCents) {
    throw new PaymentError(
      'amount_mismatch',
      `到账金额 ${opts.amountCents} 与订单 ${order.totalCents} 不符`,
      409,
    );
  }

  const [ev] = await db.select({ organizationId: events.organizationId })
    .from(events).where(eq(events.id, order.eventId)).limit(1);

  const regRows = await db.select({ id: registrations.id, status: registrations.status })
    .from(registrations).where(eq(registrations.orderId, orderId));

  await db.transaction(async (tx) => {
    await tx.update(orders).set({
      status: 'paid',
      paidAt: new Date(),
      reconciledBy: actor.id,
      reconciledAt: new Date(),
      reconcileNote: opts.note ?? null,
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId));

    await audit(tx as unknown as Db, {
      organizationId: ev!.organizationId,
      eventId: order.eventId,
      actorType: 'user',
      actorId: actor.id,
      action: 'order.reconciled',
      targetType: 'order',
      targetId: orderId,
      diff: {
        method: order.method,
        reference: order.paymentReference,
        totalCents: order.totalCents,
        note: opts.note ?? null,
      },
      ip: actor.ip ?? null,
    });

    await tx.insert(outbox).values({
      organizationId: ev!.organizationId,
      eventId: order.eventId,
      topic: 'order.paid',
      payload: { orderId, method: order.method, offline: true },
    });
  });

  // 推进报名状态机 —— 与 Stripe webhook 完全同一入口
  const advanced: string[] = [];
  for (const r of regRows) {
    if (r.status === 'awaiting_payment') {
      await transitionRegistration(r.id, 'confirmed', actor, db);
      advanced.push(r.id);
    }
  }
  return { registrationIds: advanced };
}

/** 组织者的核销队列:待确认的线下订单 */
export async function listPendingOfflineOrders(
  eventId: string,
  opts: { method?: PaymentMethod; limit?: number; offset?: number } = {},
  db: Db = defaultDb,
) {
  const limit = Math.min(opts.limit ?? 50, 100);
  const conds = [
    eq(orders.eventId, eventId),
    eq(orders.status, 'pending'),
    inArray(orders.method, OFFLINE_METHODS),
  ];
  if (opts.method) conds.push(eq(orders.method, opts.method));
  const where = and(...conds);

  const rows = await db.select().from(orders)
    .where(where)
    .orderBy(desc(orders.createdAt))
    .limit(limit)
    .offset(opts.offset ?? 0);

  const [{ total = 0 } = { total: 0 }] = await db
    .select({ total: count() }).from(orders).where(where);

  return { rows, total, limit, offset: opts.offset ?? 0 };
}

/** 按参考号查订单 —— 财务对账时从银行流水附言反查 */
export async function findOrderByReference(
  eventId: string, reference: string, db: Db = defaultDb,
) {
  const norm = reference.trim().toUpperCase().replace(/\s+/g, '');
  const [row] = await db.select().from(orders)
    .where(and(
      eq(orders.eventId, eventId),
      sql`upper(replace(${orders.paymentReference}, ' ', '')) = ${norm}`,
    )).limit(1);
  return row ?? null;
}

/** 现场结算:签到台收款后直接核销并签到 */
export async function settleOnsiteAndCheckIn(
  registrationId: string,
  actor: Actor & { id: string },
  opts: { note?: string } = {},
  db: Db = defaultDb,
): Promise<{ settled: boolean; checkedIn: boolean }> {
  const [reg] = await db.select().from(registrations)
    .where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) throw new PaymentError('registration_not_found', '报名记录不存在', 404);

  let settled = false;
  if (reg.orderId) {
    const [order] = await db.select().from(orders)
      .where(eq(orders.id, reg.orderId)).limit(1);
    if (order && order.status === 'pending' && isOffline(order.method as PaymentMethod)) {
      await reconcileOfflinePayment(order.id, actor, { note: opts.note ?? '现场结算' }, db);
      settled = true;
    }
  }

  // 核销后报名已是 confirmed,可继续签到
  const [fresh] = await db.select({ status: registrations.status })
    .from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  let checkedIn = false;
  if (fresh?.status === 'confirmed') {
    await transitionRegistration(registrationId, 'checked_in', actor, db);
    checkedIn = true;
  }
  return { settled, checkedIn };
}

/** 支付方式的展示名 */
export const METHOD_LABELS: Record<PaymentMethod, { zh: string; en: string }> = {
  stripe: { zh: '在线卡支付', en: 'Card online' },
  bank_transfer: { zh: '银行转账', en: 'Bank transfer' },
  alipay: { zh: '支付宝', en: 'Alipay' },
  wechat: { zh: '微信支付', en: 'WeChat Pay' },
  onsite: { zh: '现场支付', en: 'Pay on site' },
  free: { zh: '免费', en: 'Free' },
};

/** 读取活动的收款配置(后台设置表单用) */
export async function getPaymentConfig(
  eventId: string,
  db: Db = defaultDb,
): Promise<PaymentConfig | null> {
  const [ev] = await db.select({ paymentConfig: events.paymentConfig })
    .from(events).where(eq(events.id, eventId)).limit(1);
  return ev?.paymentConfig ?? null;
}

/**
 * 保存收款配置。
 *
 * 这些字段直接决定参会者「往哪付钱」,写错一位账号就是一笔汇丢的款,
 * 所以整份配置进审计链 —— 改过什么、谁改的,事后查得到。
 */
export async function savePaymentConfig(
  eventId: string,
  cfg: PaymentConfig,
  actor: Actor,
  db: Db = defaultDb,
): Promise<void> {
  const [ev] = await db.select({
    organizationId: events.organizationId, paymentConfig: events.paymentConfig,
  }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev) throw new PaymentError('event_not_found', '活动不存在', 404);

  await db.transaction(async (tx) => {
    await tx.update(events).set({ paymentConfig: cfg, updatedAt: new Date() })
      .where(eq(events.id, eventId));
    await audit(tx as unknown as Db, {
      organizationId: ev.organizationId,
      eventId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'payment.config_updated',
      targetType: 'event',
      targetId: eventId,
      diff: { before: ev.paymentConfig, after: cfg },
      ip: actor.ip ?? null,
    });
  });
}

/**
 * 参会者自助切换付款方式。
 *
 * 报名时不问「你打算怎么付」—— 多问一步就多一次流失,建单先落一个默认方式,
 * 到付款页再让人挑。参考号沿用同一枚:一次报名对应一个参考号,
 * 换方式不该让人手上的号作废,财务对账也只认这一个。
 */
export async function switchOrderMethod(
  orderId: string,
  method: PaymentMethod,
  actor: Actor,
  db: Db = defaultDb,
): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) throw new PaymentError('order_not_found', '订单不存在', 404);
  if (order.status !== 'pending') {
    throw new PaymentError('order_not_pending', '订单已结清或已作废,不能改付款方式', 409);
  }
  if (order.method === method) return;

  const [ev] = await db.select({
    organizationId: events.organizationId, paymentConfig: events.paymentConfig,
  }).from(events).where(eq(events.id, order.eventId)).limit(1);
  if (!ev) throw new PaymentError('event_not_found', '活动不存在', 404);

  // 'free' 不是可选的付款方式,它是免费票的记账结果
  if (method === 'free') {
    throw new PaymentError('method_not_selectable', '不能改为免费', 400);
  }
  const enabled = ev.paymentConfig?.enabled ?? [];
  if (enabled.length > 0 && !enabled.includes(method)) {
    throw new PaymentError('method_not_enabled', '该活动未开放这种付款方式', 400);
  }

  // 线上/线下的时效差一个量级,换方式必须跟着换期限,
  // 否则对公转账只剩 30 分钟,或在线支付挂着 14 天占位。
  const offline = isOffline(method);
  const expiresAt = offline
    ? new Date(Date.now() + OFFLINE_ORDER_TTL_DAYS * 86400_000)
    : new Date(Date.now() + ONLINE_ORDER_TTL_MINUTES * 60_000);

  await db.transaction(async (tx) => {
    await tx.update(orders).set({
      method,
      provider: method === 'stripe' ? 'stripe' : null,
      paymentReference: order.paymentReference ?? (offline ? generatePaymentReference() : null),
      expiresAt,
      updatedAt: new Date(),
    }).where(eq(orders.id, orderId));

    await audit(tx as unknown as Db, {
      organizationId: ev.organizationId,
      eventId: order.eventId,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'order.method_changed',
      targetType: 'order',
      targetId: orderId,
      diff: { from: order.method, to: method },
      ip: actor.ip ?? null,
    });
  });
}

/** 付款说明页用:凭报名 token 取订单与活动的支付配置 */
export async function getOrderForRegistration(
  registrationId: string,
  db: Db = defaultDb,
) {
  const [reg] = await db.select({ orderId: registrations.orderId, eventId: registrations.eventId })
    .from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (!reg?.orderId) return null;

  const [order] = await db.select().from(orders).where(eq(orders.id, reg.orderId)).limit(1);
  if (!order) return null;

  const [ev] = await db.select({ paymentConfig: events.paymentConfig })
    .from(events).where(eq(events.id, reg.eventId)).limit(1);

  return { order, paymentConfig: ev?.paymentConfig ?? null };
}
