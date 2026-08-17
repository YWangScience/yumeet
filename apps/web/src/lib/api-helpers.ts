/**
 * 公共只读 API 工具箱(ch10 §10.2 资源设计、§10.4 开放数据、§10.6 L1)
 *
 * 所有 /api/v1/public/* 端点共用四条不变量:
 *  1. 只暴露 `status='published' AND visibility='public' AND deleted_at IS NULL` 的活动;
 *     草稿、unlisted/private、软删除、以及一切个人数据(registrations / users /
 *     submissions.authors)都不可达 —— ch12 §12.1 对象级授权,越权与不存在一律 404。
 *  2. 响应里的每个 id 都是带类型前缀的编码 ID(evt_/ses_/rom_/tkt_),裸 UUID 永不出网(ch09 §9.1)。
 *  3. CORS 全开 + ETag(响应体 sha256 前 16 位)+ `public, s-maxage=60, stale-while-revalidate=600`。
 *  4. 列表端点 cursor 分页,limit 默认 20、上限 100。
 */
import { createHash, randomBytes } from 'node:crypto';
import { sql } from '@yumeet/db';
import type { EventModules, SessionSpeaker, Venue } from '@yumeet/db';
import { decodeId, encodeId } from '@yumeet/core';

/* ==========================================================================
   1. 缓存 / CORS / ETag
   ========================================================================== */

/** ch10 §10.6 L1:公共端点统一缓存策略,CDN 60s 新鲜 + 10min 陈旧可用 */
export const PUBLIC_CACHE_CONTROL = 'public, s-maxage=60, stale-while-revalidate=600';

/** 公开数据 —— 任何站点都可以在浏览器端直接 fetch(不带凭证) */
export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, If-None-Match, Accept',
  'Access-Control-Expose-Headers': 'ETag, Content-Length, Content-Type',
  'Access-Control-Max-Age': '86400',
};

/** ETag = 响应体 sha256 的前 16 个十六进制字符(弱比较用不到,直接强 ETag) */
export function etagOf(body: string): string {
  return `"${createHash('sha256').update(body, 'utf8').digest('hex').slice(0, 16)}"`;
}

function etagMatches(header: string | null, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .includes(etag);
}

/** 统一出口:CORS + Cache-Control + ETag,命中 If-None-Match 则 304 */
export function publicResponse(
  req: Request,
  body: string,
  contentType: string,
  extra: Record<string, string> = {},
): Response {
  const etag = etagOf(body);
  const headers = new Headers({
    ...CORS_HEADERS,
    ...extra,
    'Content-Type': contentType,
    'Cache-Control': PUBLIC_CACHE_CONTROL,
    ETag: etag,
  });
  if (etagMatches(req.headers.get('if-none-match'), etag)) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}

export function publicJson(req: Request, data: unknown, extra: Record<string, string> = {}): Response {
  return publicResponse(req, JSON.stringify(data), 'application/json; charset=utf-8', extra);
}

/** OPTIONS 预检 */
export function preflight(): Response {
  return new Response(null, {
    status: 204,
    headers: { ...CORS_HEADERS, 'Cache-Control': PUBLIC_CACHE_CONTROL },
  });
}

/* ==========================================================================
   2. 错误(RFC 9457 application/problem+json,ch10 §10.2 规则 6)
   ========================================================================== */

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 排障用请求 ID;刻意不含裸 UUID(带连字符的形态)以免污染公共响应体 */
export function newRequestId(): string {
  const bytes = randomBytes(10);
  let out = '';
  for (const b of bytes) out += CROCKFORD[b % 32];
  return `req_${out}`;
}

export function problem(
  status: number,
  opts: { type: string; title: string; detail: string },
): Response {
  const body = JSON.stringify({
    type: `https://yumeet.dev/errors/${opts.type}`,
    title: opts.title,
    status,
    detail: opts.detail,
    request_id: newRequestId(),
  });
  return new Response(body, {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/problem+json; charset=utf-8',
      'Cache-Control': PUBLIC_CACHE_CONTROL,
    },
  });
}

/** 不存在与不可见返回完全一致的 404(ch12 §12.1:不当资源存在性预言机) */
export function notFound(detail: string): Response {
  return problem(404, { type: 'not-found', title: 'Not Found', detail });
}

export function badRequest(detail: string): Response {
  return problem(400, { type: 'bad-request', title: 'Bad Request', detail });
}

/* ==========================================================================
   3. 参数解析
   ========================================================================== */

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

/** ch10 §10.2 规则 3:limit 默认 20、上限 100 */
export function parseLimit(raw: string | null): number {
  if (raw === null || raw.trim() === '') return DEFAULT_LIMIT;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export interface Cursor {
  /** 游标锚点的 RFC 3339 时间 */
  t: string;
  /** 游标锚点的编码 ID(不含裸 UUID) */
  i: string;
}

export function encodeCursor(c: Cursor): string {
  return `cur_${Buffer.from(JSON.stringify(c), 'utf8').toString('base64url')}`;
}

export function decodeCursor(raw: string | null): Cursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw.replace(/^cur_/, ''), 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { t, i } = parsed as Record<string, unknown>;
    if (typeof t !== 'string' || typeof i !== 'string') return null;
    return { t, i };
  } catch {
    return null;
  }
}

/** 路径参数里的 evt_ ID → 内部 UUID;解码失败返回 null(调用方 404,不 500) */
export function eventUuidFromParam(raw: string): string | null {
  try {
    return decodeId('event', decodeURIComponent(raw));
  } catch {
    return null;
  }
}

/** 布尔查询参数:?upcoming / ?upcoming=1 / ?upcoming=true 均为真 */
export function parseFlag(raw: string | null): boolean {
  if (raw === null) return false;
  const v = raw.trim().toLowerCase();
  return v === '' || v === '1' || v === 'true' || v === 'yes';
}

/* ==========================================================================
   4. 请求上下文(白标域名下 base URL 取请求头,ch07 §7.6)
   ========================================================================== */

export function hostOf(req: Request): string {
  const h = req.headers;
  return (
    h.get('x-forwarded-host')
    ?? h.get('host')
    ?? (() => {
      try {
        return new URL(req.url).host;
      } catch {
        return 'localhost';
      }
    })()
  );
}

export function baseUrlOf(req: Request): string {
  const host = hostOf(req);
  const proto = req.headers.get('x-forwarded-proto')
    ?? (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

/* ==========================================================================
   5. 只读数据加载器 —— 唯一的公共数据入口,过滤条件写死在 SQL 里
   ========================================================================== */

export type PublicEventRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  venue: Venue | null;
  modules: EventModules | null;
  status: string;
  publishedAt: Date | null;
  orgSlug: string;
  orgName: string;
};

export type PublicOrgRow = {
  slug: string;
  name: string;
  customDomain: string | null;
};

/** 组织存在性(软删除的组织视为不存在) */
/**
 * postgres.js 的原始查询把 timestamptz 返回为字符串(Drizzle 查询则返回 Date)。
 * 所有原始 SQL loader 在边界处统一转成 Date,DTO 层才能安全调用 toISOString()。
 */
function coerceDates<T extends Record<string, unknown>>(row: T, keys: (keyof T)[]): T {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string') (row as Record<string, unknown>)[k as string] = new Date(v);
  }
  return row;
}

export async function loadPublicOrg(slug: string): Promise<PublicOrgRow | null> {
  const rows = await sql<PublicOrgRow[]>`
    select o.slug, o.name, o.custom_domain as "customDomain"
      from organizations o
     where o.slug = ${slug}
       and o.deleted_at is null
     limit 1
  `;
  return rows[0] ?? null;
}

/** 按内部 UUID 取已发布的公开活动;任何一条不满足即返回 null */
export async function loadPublicEvent(eventUuid: string): Promise<PublicEventRow | null> {
  const rows = await sql<PublicEventRow[]>`
    select e.id, e.slug, e.title, e.subtitle, e.description,
           e.starts_at as "startsAt", e.ends_at as "endsAt", e.timezone,
           e.venue, e.modules, e.status, e.published_at as "publishedAt",
           o.slug as "orgSlug", o.name as "orgName"
      from events e
      join organizations o on o.id = e.organization_id
     where e.id = ${eventUuid}
       and e.status = 'published'
       and e.visibility = 'public'
       and e.deleted_at is null
       and o.deleted_at is null
     limit 1
  `;
  const row = rows[0];
  return row ? coerceDates(row, ['startsAt', 'endsAt', 'publishedAt']) : null;
}

/** 报名窗口(公开面只读表单的开关与容量,绝不触碰 registrations) */
export type PublicFormRow = {
  opensAt: Date | null;
  closesAt: Date | null;
  capacity: number | null;
  waitlistEnabled: boolean;
};

export async function loadPublicForm(eventUuid: string): Promise<PublicFormRow | null> {
  const rows = await sql<PublicFormRow[]>`
    select f.opens_at as "opensAt", f.closes_at as "closesAt",
           f.capacity, f.waitlist_enabled as "waitlistEnabled"
      from registration_forms f
     where f.event_id = ${eventUuid}
     order by f.created_at asc
     limit 1
  `;
  const row = rows[0];
  return row ? coerceDates(row, ['opensAt', 'closesAt']) : null;
}

/* ==========================================================================
   6. DTO 序列化 —— 显式白名单,ORM 行不直接出网(ch12 §12.1 防御四)
   ========================================================================== */

export interface EventUrls {
  public: string;
  register: string | null;
  schedule: string;
  ics: string;
  embed: string;
  api: string;
}

export function eventUrls(row: PublicEventRow, base: string): EventUrls {
  const id = encodeId('event', row.id);
  const page = `${base}/${row.orgSlug}/${row.slug}`;
  return {
    public: page,
    register: row.modules?.registration ? `${page}/register` : null,
    schedule: `${base}/api/v1/public/events/${id}/schedule`,
    ics: `${base}/api/v1/public/events/${id}/calendar.ics`,
    embed: `${base}/embed/${id}`,
    api: `${base}/api/v1/public/events/${id}`,
  };
}

/** 会场:只出公开地理信息,不出内部备注 */
export function venueDto(venue: Venue | null) {
  if (!venue) return null;
  return {
    name: venue.name,
    address: venue.address ?? null,
    city: venue.city ?? null,
    country: venue.country ?? null,
    geo: venue.geo ?? null,
    online: venue.online?.platform ? { platform: venue.online.platform } : null,
  };
}

/** 活动摘要(列表项与嵌入卡片共用) */
export function eventSummaryDto(row: PublicEventRow, base: string, status: string) {
  return {
    id: encodeId('event', row.id),
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    status,
    timezone: row.timezone,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt.toISOString(),
    venue: venueDto(row.venue),
    organization: { slug: row.orgSlug, name: row.orgName },
    modules: {
      registration: Boolean(row.modules?.registration),
      schedule: Boolean(row.modules?.schedule),
      cfp: Boolean(row.modules?.cfp),
    },
    urls: eventUrls(row, base),
  };
}

/** 讲者:只出姓名与单位。userId 是内部主键,在这里被剥掉 */
export function speakersDto(speakers: SessionSpeaker[] | null | undefined) {
  return (speakers ?? []).map((s) => ({
    name: s.name,
    affiliation: s.affiliation ?? null,
  }));
}

/** 轨道键:由会场名派生,供 ?track= 过滤与前端分组使用 */
export function trackKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export type ScheduleRoom = {
  id: string;
  name: string;
  location: string | null;
  capacity: number | null;
};

export type ScheduleSession = {
  id: string;
  title: string;
  kind: string;
  roomId: string | null;
  startsAt: Date;
  endsAt: Date;
  speakers: SessionSpeaker[];
};

export function roomDto(room: ScheduleRoom) {
  return {
    id: encodeId('room', room.id),
    name: room.name,
    location: room.location,
    capacity: room.capacity,
    track: trackKey(room.name),
  };
}

export function sessionDto(session: ScheduleSession, roomsById: Map<string, ScheduleRoom>) {
  const room = session.roomId ? roomsById.get(session.roomId) ?? null : null;
  return {
    id: encodeId('session', session.id),
    title: session.title,
    kind: session.kind,
    starts_at: session.startsAt.toISOString(),
    ends_at: session.endsAt.toISOString(),
    room: room
      ? { id: encodeId('room', room.id), name: room.name, location: room.location }
      : null,
    track: room ? trackKey(room.name) : null,
    speakers: speakersDto(session.speakers),
  };
}

export type PublicTicket = {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  quantityTotal: number | null;
  quantitySold: number;
  salesOpenAt: Date | null;
  salesCloseAt: Date | null;
};

/** 票种:出价格与售罄与否,不出销量绝对值(运营数据) */
export function ticketDto(t: PublicTicket, now = new Date()) {
  const soldOut = t.quantityTotal !== null && t.quantitySold >= t.quantityTotal;
  const opened = !t.salesOpenAt || t.salesOpenAt <= now;
  const closed = Boolean(t.salesCloseAt && t.salesCloseAt <= now);
  return {
    id: encodeId('ticket', t.id),
    name: t.name,
    description: t.description,
    price_cents: t.priceCents,
    currency: t.currency,
    sales_open_at: t.salesOpenAt?.toISOString() ?? null,
    sales_close_at: t.salesCloseAt?.toISOString() ?? null,
    sold_out: soldOut,
    on_sale: opened && !closed && !soldOut,
  };
}

/* ==========================================================================
   7. HTML 转义(oEmbed 的 html 字段是要被宿主直接插入 DOM 的)
   ========================================================================== */

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
