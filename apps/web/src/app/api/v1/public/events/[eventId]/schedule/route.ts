/**
 * GET /api/v1/public/events/{evt_id}/schedule —— 已发布日程(ch10 §10.6 L1)
 *
 * 查询参数:
 *   day    活动时区下的日期键,形如 2027-07-05(与响应里的 days[].day 一致)
 *   track  轨道键,由会场名派生(见 api-helpers.trackKey),也接受 rom_ 编码 ID
 *   room   同 track,语义更直白的别名
 *   limit  默认 20、上限 100(ch10 §10.2);cursor 逐页取
 *
 * 只返回未软删的 session,讲者只出姓名与单位 —— submissions.authors 的邮箱等
 * 个人数据不经过这里(ch12 §12.1)。
 */
import { displayStatus, encodeId, getEventSchedule, groupByDay } from '@yumeet/core';
import {
  baseUrlOf, decodeCursor, encodeCursor, eventUrls, eventUuidFromParam, loadPublicEvent,
  notFound, parseLimit, preflight, publicJson, roomDto, sessionDto, trackKey,
  type ScheduleRoom, type ScheduleSession,
} from '@/lib/api-helpers';

export const revalidate = 60;

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ eventId: string }> },
): Promise<Response> {
  const { eventId } = await ctx.params;
  const url = new URL(req.url);
  const base = baseUrlOf(req);

  const uuid = eventUuidFromParam(eventId);
  if (!uuid) return notFound(`Event ${eventId} does not exist or is not public.`);

  const event = await loadPublicEvent(uuid);
  if (!event) return notFound(`Event ${eventId} does not exist or is not public.`);

  const { rooms, sessions }: { rooms: ScheduleRoom[]; sessions: ScheduleSession[] } =
    event.modules?.schedule
      ? await getEventSchedule(uuid)
      : { rooms: [], sessions: [] };

  const roomsById = new Map<string, ScheduleRoom>(rooms.map((r) => [r.id, r]));

  // ---- 过滤 ----
  const dayFilter = url.searchParams.get('day')?.trim() || null;
  const trackFilter = (url.searchParams.get('track') ?? url.searchParams.get('room'))?.trim() || null;

  const matchesTrack = (s: ScheduleSession): boolean => {
    if (!trackFilter) return true;
    if (!s.roomId) return false;
    const room = roomsById.get(s.roomId);
    if (!room) return false;
    const key = trackKey(trackFilter);
    return trackKey(room.name) === key
      || encodeId('room', room.id) === trackFilter
      || trackKey(room.name).includes(key);
  };

  const dayOf = new Intl.DateTimeFormat('sv-SE', {
    timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });

  let filtered: ScheduleSession[] = sessions
    .filter(matchesTrack)
    .filter((s) => !dayFilter || dayOf.format(s.startsAt) === dayFilter)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));

  const total = filtered.length;

  // ---- 分页 ----
  const limit = parseLimit(url.searchParams.get('limit'));
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (cursor) {
    const at = filtered.findIndex((s) => encodeId('session', s.id) === cursor.i);
    filtered = at >= 0 ? filtered.slice(at + 1) : [];
  }
  const page = filtered.slice(0, limit);
  const hasMore = filtered.length > page.length;
  const last = page[page.length - 1];

  // ---- 分组:按活动时区分天(浏览端可自行换算到浏览者时区) ----
  const days = groupByDay(page, event.timezone).map(({ day, items }) => ({
    day,
    sessions: items.map((s) => sessionDto(s, roomsById)),
  }));

  const usedRoomIds = new Set(page.map((s) => s.roomId).filter((id): id is string => Boolean(id)));

  return publicJson(req, {
    event: {
      id: encodeId('event', event.id),
      slug: event.slug,
      title: event.title,
      status: displayStatus(event),
      timezone: event.timezone,
      starts_at: event.startsAt.toISOString(),
      ends_at: event.endsAt.toISOString(),
      organization: { slug: event.orgSlug, name: event.orgName },
      urls: eventUrls(event, base),
    },
    rooms: rooms.filter((r) => !trackFilter || usedRoomIds.has(r.id)).map(roomDto),
    days,
    sessions: page.map((s) => sessionDto(s, roomsById)),
    counts: { sessions: total, rooms: rooms.length },
    pagination: {
      next_cursor: hasMore && last
        ? encodeCursor({ t: last.startsAt.toISOString(), i: encodeId('session', last.id) })
        : null,
      has_more: hasMore,
    },
  });
}
