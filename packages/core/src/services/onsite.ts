/**
 * 现场模式服务(ch05 §5.2)—— 胸牌生成、会场屏、实时公告
 *
 * 本文件覆盖 §5.2.2 与 §5.2.3 两节;§5.2.1 的签到与离线容错已由签到台实现。
 * 三块能力都写在 core:apps/web 经 Server Actions / Route Handler 进程内调用,
 * apps/worker 的会前批量渲染与 apps/api 的现场即时渲染 import 同一份实现。
 *
 * ── 公告存哪里:Postgres 的 outbox,而不是 Redis ────────────────────────────
 * ch05 §5.2.3 把 Redis 写成公告的 24 小时保留介质。这里改用 Postgres 的
 * `outbox` 表作为**事实源**,Redis 留给 ch11 §11.4 阶段 2 的多实例 pub/sub 扇出,
 * 理由三条:
 *   1. 公告本质是一条领域事件 —— §5.2.3 明确要求它可以「同时发邮件,走 5.5 的通知管道」,
 *      而 ch09 §9.4 已经裁定领域事件的唯一出口就是 outbox,worker 从这里取件。
 *      把公告写进 Redis 等于给同一件事造第二条投递路径。
 *   2. 会场屏断线重连要按 Last-Event-ID 补发。outbox 行按 created_at 单调有序、
 *      且随数据库一起备份,重启不丢;Redis 无 AOF 时重启即失忆,恰好在最需要它的场合失效。
 *   3. 不新增表就不触碰 packages/db 的 schema 所有权,也不会被 drizzle push 漂移掉。
 * 24 小时保留期由查询条件实现(见 ANNOUNCEMENT_RETENTION_HOURS),对外行为与规格一致;
 * 将来加 Redis pub/sub 只是把「轮询 outbox」换成「订阅频道」,本文件的函数签名不变。
 */
import { and, asc, desc, eq, gt, gte, inArray, sql } from 'drizzle-orm';
import {
  db as defaultDb, events, organizations, outbox, registrations, rooms, sessions,
  tickets, scheduleSnapshots, type Db,
} from '@yumeet/db';
import type { SessionSpeaker } from '@yumeet/db';
import { audit } from '../audit/index';
import { encodeId } from '../ids/index';
import type { Actor } from './registration';

/* ==========================================================================
   1. 实时公告(ch05 §5.2.3)
   ========================================================================== */

/** outbox 里公告事件的 topic;不在 ch10 §10.3 的 webhook 事件表内,不外发 webhook */
export const ANNOUNCEMENT_TOPIC = 'onsite.announcement';

/** 公告保留 24 小时(ch05 §5.2.3),超期的不再补发也不再展示 */
export const ANNOUNCEMENT_RETENTION_HOURS = 24;

/** 公告默认在会场屏上停留 60 分钟,过后自动收起,避免陈旧信息长期占屏 */
export const ANNOUNCEMENT_DEFAULT_TTL_MINUTES = 60;

export const ANNOUNCEMENT_MAX_LENGTH = 280;

export type AnnouncementLevel = 'info' | 'urgent';

export interface Announcement {
  /**
   * SSE 的 `id:` 字段,同时是 Last-Event-ID 的游标 —— 取发布时刻的 RFC 3339 时间戳。
   * 刻意不用主键:裸 UUID 不出网(ch09 §9.1),而时间戳本身就是单调游标。
   */
  cursor: string;
  level: AnnouncementLevel;
  /** 主语言正文(组织者输入) */
  text: string;
  /** 英文对照,可空 */
  textEn: string | null;
  /** 限定房间的公告(留空 = 全场) */
  roomId: string | null;
  publishedAt: string;
  /** 展示截止时刻;超过即从会场屏收起 */
  expiresAt: string;
}

export class OnsiteError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message);
    this.name = 'OnsiteError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

interface AnnouncementPayload {
  kind: 'announcement';
  text: string;
  textEn: string | null;
  level: AnnouncementLevel;
  roomId: string | null;
  ttlMinutes: number;
}

function toAnnouncement(row: {
  createdAt: Date; payload: Record<string, unknown>;
}): Announcement | null {
  const p = row.payload;
  if (p['kind'] !== 'announcement') return null;
  const text = typeof p['text'] === 'string' ? p['text'] : '';
  if (!text) return null;
  const ttl = typeof p['ttlMinutes'] === 'number' && p['ttlMinutes'] > 0
    ? p['ttlMinutes']
    : ANNOUNCEMENT_DEFAULT_TTL_MINUTES;
  const at = row.createdAt;
  return {
    cursor: at.toISOString(),
    level: p['level'] === 'urgent' ? 'urgent' : 'info',
    text,
    textEn: typeof p['textEn'] === 'string' && p['textEn'] ? p['textEn'] : null,
    roomId: typeof p['roomId'] === 'string' ? p['roomId'] : null,
    publishedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + ttl * 60_000).toISOString(),
  };
}

export interface PublishAnnouncementInput {
  eventId: string;
  text: string;
  textEn?: string | null;
  level?: AnnouncementLevel;
  /** 只推给某个房间的会场屏;留空为全场 */
  roomId?: string | null;
  ttlMinutes?: number;
  actor?: Actor;
}

/**
 * 发布一条公告。写 outbox(领域事件出口)+ 写审计链,一个事务内完成 ——
 * 于是 `yumeet doctor --audit-verify` 也覆盖「谁在什么时候广播了什么」。
 */
export async function publishAnnouncement(
  input: PublishAnnouncementInput,
  db: Db = defaultDb,
): Promise<Announcement> {
  const text = input.text.trim();
  if (!text) throw new OnsiteError('empty_announcement', '公告内容不能为空', 422);
  if (text.length > ANNOUNCEMENT_MAX_LENGTH) {
    throw new OnsiteError(
      'announcement_too_long',
      `公告不能超过 ${ANNOUNCEMENT_MAX_LENGTH} 字`,
      422,
    );
  }
  const textEn = (input.textEn ?? '').trim() || null;
  if (textEn && textEn.length > ANNOUNCEMENT_MAX_LENGTH) {
    throw new OnsiteError('announcement_too_long', `公告不能超过 ${ANNOUNCEMENT_MAX_LENGTH} 字`, 422);
  }

  const [ev] = await db
    .select({ id: events.id, organizationId: events.organizationId })
    .from(events)
    .where(eq(events.id, input.eventId))
    .limit(1);
  if (!ev) throw new OnsiteError('event_not_found', '活动不存在', 404);

  if (input.roomId) {
    const [room] = await db.select({ id: rooms.id }).from(rooms)
      .where(and(eq(rooms.id, input.roomId), eq(rooms.eventId, input.eventId)))
      .limit(1);
    if (!room) throw new OnsiteError('room_not_found', '会场不存在', 404);
  }

  const payload: AnnouncementPayload = {
    kind: 'announcement',
    text,
    textEn,
    level: input.level === 'urgent' ? 'urgent' : 'info',
    roomId: input.roomId ?? null,
    ttlMinutes: input.ttlMinutes && input.ttlMinutes > 0
      ? Math.min(input.ttlMinutes, ANNOUNCEMENT_RETENTION_HOURS * 60)
      : ANNOUNCEMENT_DEFAULT_TTL_MINUTES,
  };
  const actor: Actor = input.actor ?? { type: 'user' };

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx.insert(outbox).values({
      organizationId: ev.organizationId,
      eventId: ev.id,
      topic: ANNOUNCEMENT_TOPIC,
      payload: payload as unknown as Record<string, unknown>,
    }).returning({ createdAt: outbox.createdAt });

    await audit(tx as unknown as Db, {
      organizationId: ev.organizationId,
      eventId: ev.id,
      actorType: actor.type,
      actorId: actor.id ?? null,
      action: 'onsite.announcement.published',
      targetType: 'event',
      targetId: ev.id,
      // 公告正文本身不是个人数据,全文入审计以便事后复核「当时到底播了什么」
      diff: { level: payload.level, text: payload.text, roomId: payload.roomId },
      ip: actor.ip ?? null,
    });

    return inserted!;
  });

  const built = toAnnouncement({ createdAt: row.createdAt, payload: payload as unknown as Record<string, unknown> });
  // payload 是刚构造的,toAnnouncement 不可能返回 null;兜底只为满足类型收窄
  if (!built) throw new OnsiteError('announcement_failed', '公告写入失败', 500);
  return built;
}

export interface ListAnnouncementsOptions {
  /** Last-Event-ID:只返回严格晚于此时刻的公告 */
  since?: string | null;
  /** 只要仍在展示期内的(会场屏用);false 时返回保留期内全部(后台列表用) */
  activeOnly?: boolean;
  roomId?: string | null;
  limit?: number;
  now?: Date;
}

/** 取保留期(24h)内的公告,按时间升序 —— SSE 补发与会场屏首屏共用 */
export async function listAnnouncements(
  eventId: string,
  opts: ListAnnouncementsOptions = {},
  db: Db = defaultDb,
): Promise<Announcement[]> {
  const now = opts.now ?? new Date();
  const cutoff = new Date(now.getTime() - ANNOUNCEMENT_RETENTION_HOURS * 3_600_000);

  const conds = [
    eq(outbox.eventId, eventId),
    eq(outbox.topic, ANNOUNCEMENT_TOPIC),
    gte(outbox.createdAt, cutoff),
  ];
  const since = opts.since ? new Date(opts.since) : null;
  if (since && !Number.isNaN(since.getTime())) conds.push(gt(outbox.createdAt, since));

  const rows = await db
    .select({ createdAt: outbox.createdAt, payload: outbox.payload })
    .from(outbox)
    .where(and(...conds))
    .orderBy(asc(outbox.createdAt))
    .limit(Math.min(opts.limit ?? 50, 200));

  const out: Announcement[] = [];
  for (const row of rows) {
    const a = toAnnouncement(row);
    if (!a) continue;
    if (opts.activeOnly !== false && new Date(a.expiresAt) <= now) continue;
    if (opts.roomId && a.roomId && a.roomId !== opts.roomId) continue;
    out.push(a);
  }
  return out;
}

/** 日程版本(发布一次 +1);SSE 用它判断是否要推 schedule_changed */
export async function scheduleRevision(
  eventId: string,
  db: Db = defaultDb,
): Promise<{ version: number; publishedAt: string } | null> {
  const [row] = await db
    .select({ version: scheduleSnapshots.version, publishedAt: scheduleSnapshots.publishedAt })
    .from(scheduleSnapshots)
    .where(eq(scheduleSnapshots.eventId, eventId))
    .orderBy(desc(scheduleSnapshots.version))
    .limit(1);
  return row ? { version: row.version, publishedAt: row.publishedAt.toISOString() } : null;
}

/* ==========================================================================
   2. 会场屏(ch05 §5.2.3)—— Now / Next 计算
   ========================================================================== */

export interface ScreenSession {
  /** 对外编码 ID(ses_…),裸 UUID 不出网 */
  id: string;
  title: string;
  kind: string;
  roomName: string | null;
  roomLocation: string | null;
  startsAt: string;
  endsAt: string;
  speakers: { name: string; affiliation: string | null }[];
}

export interface ScreenState {
  /** 服务端时刻,客户端据此校正本地时钟漂移 */
  now: string;
  event: {
    id: string;
    title: string;
    timezone: string;
    venueName: string | null;
  };
  room: { id: string; name: string; location: string | null } | null;
  /** 此刻正在进行的场次(多轨时可能多条) */
  current: ScreenSession[];
  /** 紧接着的一批(同一开始时刻的都算) */
  next: ScreenSession[];
  /** 再往后的若干场,给「今日余下」列表 */
  later: ScreenSession[];
  announcements: Announcement[];
  scheduleVersion: number | null;
}

function toScreenSession(
  s: {
    id: string; title: string; kind: string; roomId: string | null;
    startsAt: Date; endsAt: Date; speakers: SessionSpeaker[] | null;
  },
  roomById: Map<string, { name: string; location: string | null }>,
): ScreenSession {
  const room = s.roomId ? roomById.get(s.roomId) ?? null : null;
  return {
    id: encodeId('session', s.id),
    title: s.title,
    kind: s.kind,
    roomName: room?.name ?? null,
    roomLocation: room?.location ?? null,
    startsAt: s.startsAt.toISOString(),
    endsAt: s.endsAt.toISOString(),
    speakers: (s.speakers ?? []).map((sp) => ({
      name: sp.name,
      affiliation: sp.affiliation ?? null,
    })),
  };
}

export interface ScreenOptions {
  /** 只显示某个房间的日程(门口平板);留空则全场 */
  roomId?: string | null;
  now?: Date;
  laterLimit?: number;
}

/**
 * 会场屏一屏所需的全部数据。
 * 会期之外(还没开幕 / 已闭幕)也要给出可读结果:current 为空时 next 取最近一场,
 * 让门口的屏幕永远不会是一片空白。
 */
export async function getScreenState(
  eventId: string,
  opts: ScreenOptions = {},
  db: Db = defaultDb,
): Promise<ScreenState> {
  const now = opts.now ?? new Date();

  const [ev] = await db.select({
    id: events.id,
    title: events.title,
    timezone: events.timezone,
    venue: events.venue,
  }).from(events).where(eq(events.id, eventId)).limit(1);
  if (!ev) throw new OnsiteError('event_not_found', '活动不存在', 404);

  const roomRows = await db.select({
    id: rooms.id, name: rooms.name, location: rooms.location,
  }).from(rooms).where(eq(rooms.eventId, eventId)).orderBy(asc(rooms.position));
  const roomById = new Map(roomRows.map((r) => [r.id, { name: r.name, location: r.location }]));

  const sessionConds = [
    eq(sessions.eventId, eventId),
    sql`${sessions.deletedAt} IS NULL`,
  ];
  if (opts.roomId) sessionConds.push(eq(sessions.roomId, opts.roomId));

  const sessionRows = await db.select({
    id: sessions.id, title: sessions.title, kind: sessions.kind,
    roomId: sessions.roomId, startsAt: sessions.startsAt, endsAt: sessions.endsAt,
    speakers: sessions.speakers,
  }).from(sessions).where(and(...sessionConds)).orderBy(asc(sessions.startsAt));

  const current = sessionRows.filter((s) => s.startsAt <= now && s.endsAt > now);
  const future = sessionRows.filter((s) => s.startsAt > now);
  const nextStart = future[0]?.startsAt ?? null;
  const next = nextStart ? future.filter((s) => s.startsAt.getTime() === nextStart.getTime()) : [];
  const later = nextStart
    ? future.filter((s) => s.startsAt.getTime() > nextStart.getTime())
      .slice(0, opts.laterLimit ?? 6)
    : [];

  const announcements = await listAnnouncements(
    eventId,
    { activeOnly: true, roomId: opts.roomId ?? null, now },
    db,
  );
  const revision = await scheduleRevision(eventId, db);

  const venue = ev.venue as { name?: string } | null;
  const selectedRoom = opts.roomId ? roomById.get(opts.roomId) ?? null : null;

  return {
    now: now.toISOString(),
    event: {
      id: encodeId('event', ev.id),
      title: ev.title,
      timezone: ev.timezone,
      venueName: venue?.name ?? null,
    },
    room: opts.roomId && selectedRoom
      ? { id: encodeId('room', opts.roomId), name: selectedRoom.name, location: selectedRoom.location }
      : null,
    current: current.map((s) => toScreenSession(s, roomById)),
    next: next.map((s) => toScreenSession(s, roomById)),
    later: later.map((s) => toScreenSession(s, roomById)),
    announcements,
    scheduleVersion: revision?.version ?? null,
  };
}

/** 会场列表(会场屏的房间选择器) */
export async function listRooms(eventId: string, db: Db = defaultDb) {
  const rows = await db.select({
    id: rooms.id, name: rooms.name, location: rooms.location, capacity: rooms.capacity,
  }).from(rooms).where(eq(rooms.eventId, eventId)).orderBy(asc(rooms.position));
  return rows.map((r) => ({
    id: encodeId('room', r.id),
    uuid: r.id,
    name: r.name,
    location: r.location,
    capacity: r.capacity,
  }));
}

/* ==========================================================================
   3. 胸牌(ch05 §5.2.2)—— satori → SVG → resvg → PNG
   ========================================================================== */

/**
 * 版式。ch05 §5.2.2 要求 A6/A7;这里以 300 dpi 的像素宽度作为输出目标,
 * satori 的排版仍在「逻辑 px」上进行,resvg 再等比放大到印刷分辨率。
 */
export const BADGE_LAYOUTS = {
  /** A7 横向 105 × 74 mm —— 挂绳胸牌的常用尺寸,默认 */
  a7: { logical: { w: 620, h: 437 }, printWidth: 1240 },
  /** A6 纵向 105 × 148 mm —— 带日程背面的大胸牌 */
  a6: { logical: { w: 620, h: 874 }, printWidth: 1240 },
} as const;

export type BadgeLayout = keyof typeof BADGE_LAYOUTS;

export function isBadgeLayout(v: string | null | undefined): v is BadgeLayout {
  return v === 'a7' || v === 'a6';
}

/**
 * 票种色条的可选色。全部与白字对比度 ≥ 4.5:1(ch08 §8.7),
 * 因此色条上的票种名可以直接用白色。
 */
const TICKET_COLORS = [
  '#0062cc', '#1a6b2e', '#8a3ffc', '#a32b00', '#0f6f78', '#9b1c5b',
] as const;

function ticketColor(name: string | null): string {
  if (!name) return '#3a3a3c';
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TICKET_COLORS[h % TICKET_COLORS.length]!;
}

export interface BadgeModel {
  /** 姓名(必填) */
  name: string;
  /** 拼音 / 罗马音辅助行(ch05 §5.2.2 模板变量) */
  latinName: string | null;
  affiliation: string | null;
  country: string | null;
  confirmationCode: string;
  ticketName: string | null;
  eventTitle: string;
  eventDates: string;
  venueName: string | null;
  /**
   * 二维码内容。默认就是 8 位确认码 —— 与已上线的签到台(输入确认码核销)直接互通,
   * 且只含不透明 ID、不含任何个人信息(ch05 §5.2.1 设计要点)。
   * 活动密钥对落地后可替换为 `PDM1.<payload>.<sig>` 的离线可验签名令牌。
   */
  qrPayload: string;
}

/* ---------- 字体:必须内嵌,且必须是可再分发的字体(ch05 §5.2.2) ---------- */

/**
 * SF Pro / PingFang 不可再分发,规格因此要求默认打包 Inter + Noto Sans SC。
 * 本实例以系统内已有的同类自由字体替代(DejaVu Sans = 拉丁,
 * Droid Sans Fallback = 中日韩,均为自由许可),路径可用 ENV 覆盖以便
 * 组织者换成自有授权字体。
 */
const FONT_SOURCES: Record<'regular' | 'bold' | 'cjk', string[]> = {
  regular: [
    process.env['YUMEET_BADGE_FONT_REGULAR'] ?? '',
    '/usr/share/fonts/truetype/inter/Inter-Regular.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
  ],
  bold: [
    process.env['YUMEET_BADGE_FONT_BOLD'] ?? '',
    '/usr/share/fonts/truetype/inter/Inter-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ],
  cjk: [
    process.env['YUMEET_BADGE_FONT_CJK'] ?? '',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Regular.ttf',
    '/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf',
    '/usr/share/fonts/truetype/arphic-gbsn00lp/gbsn00lp.ttf',
  ],
};

let fontCache: { name: string; data: Buffer; weight: 400 | 700 }[] | null = null;

async function loadFonts() {
  if (fontCache) return fontCache;
  const { readFile } = await import('node:fs/promises');
  const pick = async (candidates: string[]): Promise<Buffer | null> => {
    for (const p of candidates) {
      if (!p) continue;
      try {
        return await readFile(p);
      } catch {
        /* 下一个候选 */
      }
    }
    return null;
  };

  const [regular, bold, cjk] = await Promise.all([
    pick(FONT_SOURCES.regular), pick(FONT_SOURCES.bold), pick(FONT_SOURCES.cjk),
  ]);
  if (!regular) {
    throw new OnsiteError(
      'badge_font_missing',
      '找不到可用的胸牌字体,请设置 YUMEET_BADGE_FONT_REGULAR 指向一个 TTF/OTF 文件',
      500,
    );
  }
  const fonts: { name: string; data: Buffer; weight: 400 | 700 }[] = [
    { name: 'YuSans', data: regular, weight: 400 },
    { name: 'YuSans', data: bold ?? regular, weight: 700 },
  ];
  if (cjk) fonts.push({ name: 'YuCJK', data: cjk, weight: 400 });
  fontCache = fonts;
  return fonts;
}

/**
 * resvg 是原生插件(.node),打包器无法把它塞进 bundle ——
 * webpack 一旦静态看见这个 import,整个 @yumeet/core 就编译失败。
 * 因此走运行期 createRequire:打包器看不见字符串,Node 照常解析。
 * 解析基点先用本模块所在位置,再退到进程工作目录(打包后前者指向产物目录)。
 */
interface ResvgRendered { asPng(): Buffer }
interface ResvgOptions {
  fitTo?: { mode: 'width' | 'height' | 'zoom' | 'original'; value?: number };
  background?: string;
}
interface ResvgModule {
  Resvg: new (svg: string, options?: ResvgOptions) => { render(): ResvgRendered };
}
/** 包名拆成片段:任何打包器的静态分析都拼不回来,于是不会尝试打包 .node */
const RESVG_SPECIFIER = ['@resvg', 'resvg-js'].join('/');
let resvgCache: ResvgModule | null = null;

async function loadResvg(): Promise<ResvgModule> {
  if (resvgCache) return resvgCache;
  let lastError: unknown = null;

  /**
   * 三条加载路径,按可靠性排序:
   *  1. 动态 import(被 next.config 的 serverExternalPackages 标记为外部,
   *     不会进包;这是生产构建下唯一稳定的方式)
   *  2. createRequire(import.meta.url) —— 仅在真正的 ESM 运行时可用;
   *     Next 的 CJS 产物里 import.meta.url 会被改写,故不能作为首选
   *  3. createRequire(cwd) —— 从进程工作目录解析,兜底
   */
  try {
    const mod = (await import(/* webpackIgnore: true */ RESVG_SPECIFIER)) as
      ResvgModule & { default?: ResvgModule };
    const resolved = mod.Resvg ? mod : mod.default;
    if (resolved?.Resvg) {
      resvgCache = resolved;
      return resvgCache;
    }
  } catch (e) {
    lastError = e;
  }

  try {
    const { createRequire } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    const bases: string[] = [];
    try {
      if (typeof import.meta?.url === 'string') bases.push(import.meta.url);
    } catch { /* CJS 产物里访问 import.meta 会抛,忽略 */ }
    bases.push(pathToFileURL(`${process.cwd()}/index.js`).href);

    for (const base of bases) {
      try {
        const req = createRequire(base);
        resvgCache = req(RESVG_SPECIFIER) as ResvgModule;
        if (resvgCache?.Resvg) return resvgCache;
      } catch (e) {
        lastError = e;
      }
    }
  } catch (e) {
    lastError = e;
  }
  throw new OnsiteError(
    'resvg_unavailable',
    `无法加载 @resvg/resvg-js:${lastError instanceof Error ? lastError.message : String(lastError)}`,
    500,
  );
}

/** 二维码 data URI(PNG),直接嵌进 satori 的 <img> */
export async function qrDataUri(payload: string, size = 320): Promise<string> {
  const QRCode = (await import('qrcode')).default;
  return QRCode.toDataURL(payload, {
    margin: 0,
    width: size,
    errorCorrectionLevel: 'M',
    color: { dark: '#000000ff', light: '#ffffffff' },
  });
}

/* satori 接受「React 元素」或其对象表示;core 不依赖 react,这里用对象表示。 */
interface VNode {
  type: string;
  props: Record<string, unknown>;
}
const h = (
  type: string,
  style: Record<string, unknown>,
  children?: unknown,
  extra: Record<string, unknown> = {},
): VNode => ({ type, props: { style, ...extra, ...(children === undefined ? {} : { children }) } });

/** 胸牌模板:一个纯数据的元素树,与站点主题解耦(ch05 §5.2.2) */
function badgeTree(m: BadgeModel, layout: BadgeLayout, qr: string): VNode {
  const { w, h: H } = BADGE_LAYOUTS[layout].logical;
  const accent = ticketColor(m.ticketName);
  const tall = layout === 'a6';
  const nameSize = m.name.length > 18 ? 40 : m.name.length > 12 ? 50 : 62;
  const qrSize = tall ? 190 : 150;

  return h('div', {
    display: 'flex', flexDirection: 'column', width: w, height: H,
    backgroundColor: '#ffffff', color: '#1d1d1f',
    fontFamily: 'YuSans, YuCJK', border: '2px solid #d2d2d7',
  }, [
    /* 页眉:会议名与日期 */
    h('div', {
      display: 'flex', flexDirection: 'column', padding: '20px 28px 12px 28px',
      borderBottom: '1px solid #d2d2d7',
    }, [
      h('div', { display: 'flex', fontSize: 20, fontWeight: 700, color: '#1d1d1f' }, m.eventTitle),
      h('div', { display: 'flex', fontSize: 15, color: '#4a4a4f', marginTop: 4 },
        [m.eventDates, m.venueName].filter(Boolean).join(' · ')),
    ]),

    /* 主体:姓名/单位 + 二维码 */
    h('div', {
      display: 'flex', flexDirection: tall ? 'column' : 'row',
      flexGrow: 1, padding: '22px 28px', alignItems: 'center',
    }, [
      h('div', {
        display: 'flex', flexDirection: 'column', flexGrow: 1,
        justifyContent: 'center', paddingRight: tall ? 0 : 20,
        alignItems: tall ? 'center' : 'flex-start',
        textAlign: tall ? 'center' : 'left',
      }, [
        h('div', {
          display: 'flex', fontSize: nameSize, fontWeight: 700, lineHeight: 1.1,
          letterSpacing: '-0.01em',
        }, m.name),
        ...(m.latinName
          ? [h('div', { display: 'flex', fontSize: 22, color: '#4a4a4f', marginTop: 6 }, m.latinName)]
          : []),
        ...(m.affiliation
          ? [h('div', {
              display: 'flex', fontSize: 24, color: '#1d1d1f', marginTop: 12, lineHeight: 1.25,
            }, m.affiliation)]
          : []),
        ...(m.country
          ? [h('div', { display: 'flex', fontSize: 18, color: '#4a4a4f', marginTop: 6 }, m.country)]
          : []),
      ]),
      h('div', {
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        marginTop: tall ? 20 : 0,
      }, [
        h('img', { borderRadius: 4 }, undefined, { src: qr, width: qrSize, height: qrSize }),
        h('div', {
          display: 'flex', fontSize: 24, fontWeight: 700, marginTop: 8,
          letterSpacing: '0.14em', fontVariantNumeric: 'tabular-nums',
        }, m.confirmationCode),
      ]),
    ]),

    /* 票种色条:有色底上用白字,对比度 ≥ 4.5:1 */
    h('div', {
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: accent, color: '#ffffff', padding: '14px 28px',
    }, [
      h('div', { display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: '0.02em' },
        m.ticketName ?? '参会者 Attendee'),
      h('div', { display: 'flex', fontSize: 16, color: '#ffffff' }, 'yuMeet'),
    ]),
  ]);
}

export interface RenderBadgeOptions {
  layout?: BadgeLayout;
  /** 输出像素宽度;默认按 300 dpi */
  printWidth?: number;
}

/** 渲染胸牌 SVG(satori)。预览与 PDF 合版都从这里出 */
export async function renderBadgeSvg(
  model: BadgeModel,
  opts: RenderBadgeOptions = {},
): Promise<string> {
  const layout = opts.layout ?? 'a7';
  const satori = (await import('satori')).default;
  const [fonts, qr] = await Promise.all([
    loadFonts(),
    qrDataUri(model.qrPayload, layout === 'a6' ? 380 : 300),
  ]);
  const { w, h: H } = BADGE_LAYOUTS[layout].logical;
  return satori(badgeTree(model, layout, qr) as unknown as Parameters<typeof satori>[0], {
    width: w,
    height: H,
    fonts: fonts.map((f) => ({
      name: f.name,
      data: f.data,
      weight: f.weight,
      style: 'normal' as const,
    })),
  });
}

/** 渲染胸牌 PNG(resvg)。现场即时打印与批量导出共用 */
export async function renderBadgePng(
  model: BadgeModel,
  opts: RenderBadgeOptions = {},
): Promise<Uint8Array> {
  const layout = opts.layout ?? 'a7';
  const svg = await renderBadgeSvg(model, opts);
  const { Resvg } = await loadResvg();
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: opts.printWidth ?? BADGE_LAYOUTS[layout].printWidth },
    background: 'white',
  }).render().asPng();
  return new Uint8Array(png);
}

/* ---------- 从报名记录构建胸牌数据 ---------- */

/** 报名答案里姓名/单位的常见 key —— 表单是自定义的,这里按优先级探测 */
const NAME_KEYS = ['full_name', 'name', 'fullName', 'display_name', '姓名'];
const LATIN_KEYS = ['latin_name', 'name_latin', 'pinyin', 'romanized_name'];
const AFFILIATION_KEYS = ['affiliation', 'institution', 'organisation', 'organization', 'company', '单位'];
const COUNTRY_KEYS = ['country', 'nationality', '国家'];

/**
 * 取答案里的可读文本。
 * affiliation 这类字段(ch04 §4.2 的 `affiliation` kind)存的是 `{ name, ror?, … }` 对象,
 * 不是字符串 —— 胸牌要的是其中的显示名,所以对象形态也要能取出来。
 */
function firstString(answers: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = answers[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v && typeof v === 'object') {
      const name = (v as Record<string, unknown>)['name'];
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return null;
}

export interface BadgeSubject {
  /** 对外编码 ID(reg_…) */
  publicId: string;
  /** 内部主键,仅服务端流转 */
  registrationId: string;
  name: string;
  affiliation: string | null;
  confirmationCode: string;
  ticketName: string | null;
  status: string;
}

export interface ListBadgeSubjectsOptions {
  /** 按报名状态筛选;默认 confirmed + checked_in(即「会到场的人」) */
  statuses?: string[];
  limit?: number;
  offset?: number;
}

export const BADGE_DEFAULT_STATUSES = ['confirmed', 'checked_in'] as const;

/** 可印胸牌的人(后台列表与批量导出共用同一份筛选) */
export async function listBadgeSubjects(
  eventId: string,
  opts: ListBadgeSubjectsOptions = {},
  db: Db = defaultDb,
): Promise<{ rows: BadgeSubject[]; total: number }> {
  const statuses = opts.statuses?.length ? opts.statuses : [...BADGE_DEFAULT_STATUSES];
  const where = and(
    eq(registrations.eventId, eventId),
    inArray(registrations.status, statuses as never[]),
  );

  const rows = await db.select({
    id: registrations.id,
    email: registrations.email,
    answers: registrations.answers,
    confirmationCode: registrations.confirmationCode,
    status: registrations.status,
    ticketName: tickets.name,
  }).from(registrations)
    .leftJoin(tickets, eq(registrations.ticketId, tickets.id))
    .where(where)
    .orderBy(asc(registrations.createdAt))
    .limit(Math.min(opts.limit ?? 100, 2000))
    .offset(opts.offset ?? 0);

  const [{ total = 0 } = { total: 0 }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(registrations)
    .where(where);

  return {
    rows: rows.map((r) => {
      const answers = (r.answers ?? {}) as Record<string, unknown>;
      return {
        publicId: encodeId('registration', r.id),
        registrationId: r.id,
        name: firstString(answers, NAME_KEYS) ?? r.email,
        affiliation: firstString(answers, AFFILIATION_KEYS),
        confirmationCode: r.confirmationCode,
        ticketName: r.ticketName,
        status: r.status,
      };
    }),
    total,
  };
}

/** 单张胸牌的完整数据;按确认码或内部 registrationId 取 */
export async function buildBadgeModel(
  eventId: string,
  selector: { code?: string; registrationId?: string },
  db: Db = defaultDb,
): Promise<BadgeModel | null> {
  const conds = [eq(registrations.eventId, eventId)];
  if (selector.code) {
    conds.push(eq(registrations.confirmationCode, selector.code.trim().toUpperCase()));
  } else if (selector.registrationId) {
    conds.push(eq(registrations.id, selector.registrationId));
  } else {
    return null;
  }

  const [row] = await db.select({
    id: registrations.id,
    email: registrations.email,
    answers: registrations.answers,
    confirmationCode: registrations.confirmationCode,
    ticketName: tickets.name,
    eventTitle: events.title,
    eventStartsAt: events.startsAt,
    eventEndsAt: events.endsAt,
    eventTimezone: events.timezone,
    venue: events.venue,
  }).from(registrations)
    .innerJoin(events, eq(registrations.eventId, events.id))
    .leftJoin(tickets, eq(registrations.ticketId, tickets.id))
    .where(and(...conds))
    .limit(1);
  if (!row) return null;

  const answers = (row.answers ?? {}) as Record<string, unknown>;
  const venue = row.venue as { name?: string; city?: string } | null;

  return {
    name: firstString(answers, NAME_KEYS) ?? row.email,
    latinName: firstString(answers, LATIN_KEYS),
    affiliation: firstString(answers, AFFILIATION_KEYS),
    country: firstString(answers, COUNTRY_KEYS),
    confirmationCode: row.confirmationCode,
    ticketName: row.ticketName,
    eventTitle: row.eventTitle,
    eventDates: formatBadgeDates(row.eventStartsAt, row.eventEndsAt, row.eventTimezone),
    venueName: venue?.name ?? venue?.city ?? null,
    qrPayload: row.confirmationCode,
  };
}

/** 胸牌上的日期区间;胸牌是印刷品,一律按会议时区呈现 */
export function formatBadgeDates(startsAt: Date, endsAt: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, day: '2-digit', month: 'short', year: 'numeric',
  });
  const a = fmt.format(startsAt);
  const b = fmt.format(endsAt);
  return a === b ? a : `${a} – ${b}`;
}

/* ---------- 批量导出:store-only ZIP(不引入压缩库) ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry { name: string; data: Uint8Array }

/**
 * 最小 ZIP 打包器(method 0 = stored)。
 * PNG 本身已是 deflate 压缩,再压一遍收益近零,因此不引入 jszip/archiver ——
 * 与 PLAN.md §4「不引入规格外的重量依赖」一致。
 */
export function zipStore(entries: ZipEntry[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    const crc = crc32(e.data);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);        // version needed
    lv.setUint16(6, 0x0800, true);    // UTF-8 文件名
    lv.setUint16(8, 0, true);         // method = stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    locals.push(local, e.data);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);        // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centrals.push(central);

    offset += local.length + e.data.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const parts = [...locals, ...centrals, eocd];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** 文件名安全化:批量导出的每张 PNG 用「确认码-姓名.png」 */
export function badgeFilename(subject: { confirmationCode: string; name: string }): string {
  const safe = subject.name
    // 连字符置于字符类末尾之外时须转义,否则 |-] 被当成无效范围
    .replace(/[\\/:*?"<>|\-]/g, '')
    .trim()
    .slice(0, 48) || 'attendee';
  return `${subject.confirmationCode}-${safe}.png`;
}

export interface BadgeBatchOptions extends ListBadgeSubjectsOptions, RenderBadgeOptions {}

/**
 * 会前批量:按筛选条件渲染全部胸牌并打成一个 zip。
 * ch05 §5.2.2 的「按姓氏排序合并为 A6/A7 版式 PDF」由 worker 侧合版完成,
 * 后台这条路径给的是逐张 PNG —— 打印店与标签打印机都能直接吃。
 */
export async function renderBadgeBatchZip(
  eventId: string,
  opts: BadgeBatchOptions = {},
  db: Db = defaultDb,
): Promise<{ zip: Uint8Array; count: number }> {
  const { rows } = await listBadgeSubjects(eventId, opts, db);
  const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans'));

  const entries: ZipEntry[] = [];
  for (const s of sorted) {
    const model = await buildBadgeModel(eventId, { registrationId: s.registrationId }, db);
    if (!model) continue;
    entries.push({ name: badgeFilename(s), data: await renderBadgePng(model, opts) });
  }
  return { zip: zipStore(entries), count: entries.length };
}

/* ==========================================================================
   4. 运行期自检 —— yumeet doctor 的现场模式项
   ========================================================================== */

export interface OnsiteHealth {
  fonts: { ok: boolean; detail: string };
  renderer: { ok: boolean; detail: string };
}

/** doctor 用:确认胸牌渲染链(字体 + satori + resvg)在本机可用 */
export async function checkBadgePipeline(): Promise<OnsiteHealth> {
  const health: OnsiteHealth = {
    fonts: { ok: false, detail: '' },
    renderer: { ok: false, detail: '' },
  };
  try {
    const fonts = await loadFonts();
    health.fonts = { ok: true, detail: `已加载 ${fonts.length} 个字重` };
  } catch (e) {
    health.fonts = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    return health;
  }
  try {
    const png = await renderBadgePng({
      name: '自检 Self Test',
      latinName: null,
      affiliation: 'yuMeet',
      country: null,
      confirmationCode: 'DOCTOR00',
      ticketName: null,
      eventTitle: 'yuMeet doctor',
      eventDates: '—',
      venueName: null,
      qrPayload: 'DOCTOR00',
    }, { printWidth: 400 });
    health.renderer = { ok: png.length > 0, detail: `satori + resvg 输出 ${png.length} 字节 PNG` };
  } catch (e) {
    health.renderer = { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
  return health;
}

/** 组织者归属校验:后台页面拿到的是 slug,这里回到 organization 做一次对象级授权 */
export async function assertEventInOrg(
  eventId: string, orgSlug: string, db: Db = defaultDb,
): Promise<void> {
  const [row] = await db.select({ id: events.id })
    .from(events)
    .innerJoin(organizations, eq(events.organizationId, organizations.id))
    .where(and(eq(events.id, eventId), eq(organizations.slug, orgSlug)))
    .limit(1);
  if (!row) throw new OnsiteError('event_not_found', '活动不存在', 404);
}
