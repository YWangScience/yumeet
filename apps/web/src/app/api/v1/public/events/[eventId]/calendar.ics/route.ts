/**
 * GET /api/v1/public/events/{evt_id}/calendar.ics —— ICS 订阅(ch10 §10.4)
 *
 * PRODID 固定 -//yuMeet//EN,UID 为 {sessionId}@{host}(sessionId 是 ses_ 编码 ID)。
 * 查询参数:
 *   track / room   只导出某个轨道(会场)的场次
 *   day            只导出活动时区下的某一天
 *   scope=event    忽略日程,只导出一条覆盖整场会议的 VEVENT
 * 活动没有日程模块或日程为空时,自动退化为单条会议级 VEVENT。
 * ETag 支持 If-None-Match → 304,日历客户端轮询成本趋零。
 */
import { buildIcs, encodeId, getEventSchedule, type IcsEvent } from '@yumeet/core';
import {
  baseUrlOf, eventUrls, eventUuidFromParam, hostOf, loadPublicEvent, notFound,
  preflight, publicResponse, trackKey,
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
  const host = hostOf(req);

  const uuid = eventUuidFromParam(eventId);
  if (!uuid) return notFound(`Event ${eventId} does not exist or is not public.`);

  const event = await loadPublicEvent(uuid);
  if (!event) return notFound(`Event ${eventId} does not exist or is not public.`);

  const urls = eventUrls(event, base);
  const scope = url.searchParams.get('scope');
  const wantSchedule = scope !== 'event' && Boolean(event.modules?.schedule);

  const { rooms, sessions }: { rooms: ScheduleRoom[]; sessions: ScheduleSession[] } = wantSchedule
    ? await getEventSchedule(uuid)
    : { rooms: [], sessions: [] };

  const roomsById = new Map<string, ScheduleRoom>(rooms.map((r) => [r.id, r]));
  const trackFilter = (url.searchParams.get('track') ?? url.searchParams.get('room'))?.trim() || null;
  const dayFilter = url.searchParams.get('day')?.trim() || null;
  const dayOf = new Intl.DateTimeFormat('sv-SE', {
    timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  });

  const picked = sessions
    .filter((s) => {
      if (!trackFilter) return true;
      const room = s.roomId ? roomsById.get(s.roomId) : undefined;
      if (!room) return false;
      const key = trackKey(trackFilter);
      return trackKey(room.name) === key
        || encodeId('room', room.id) === trackFilter
        || trackKey(room.name).includes(key);
    })
    .filter((s) => !dayFilter || dayOf.format(s.startsAt) === dayFilter)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

  const venueLine = [event.venue?.name, event.venue?.address, event.venue?.city]
    .filter(Boolean).join(', ');

  const icsEvents: IcsEvent[] = picked.length > 0
    ? picked.map((s) => {
        const room = s.roomId ? roomsById.get(s.roomId) : undefined;
        const speakers = (s.speakers ?? []).map((sp) => sp.name).filter(Boolean);
        return {
          // UID = {sessionId}@{host};sessionId 是对外编码 ID,裸 UUID 不出网
          id: encodeId('session', s.id),
          title: s.title,
          description: [
            speakers.length > 0 ? speakers.join(', ') : null,
            event.title,
            urls.public,
          ].filter(Boolean).join('\n'),
          location: [room?.name, room?.location ?? null, event.venue?.name]
            .filter(Boolean).join(', ') || venueLine || null,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          url: urls.public,
        } satisfies IcsEvent;
      })
    : [{
        id: encodeId('event', event.id),
        title: event.title,
        description: [event.subtitle, urls.public].filter(Boolean).join('\n'),
        location: venueLine || null,
        startsAt: event.startsAt,
        endsAt: event.endsAt,
        url: urls.public,
      }];

  const body = buildIcs(icsEvents, {
    host,
    calendarName: event.title,
    timezone: event.timezone,
  });

  return publicResponse(req, body, 'text/calendar; charset=utf-8', {
    'Content-Disposition': `attachment; filename="${event.slug}.ics"`,
  });
}
