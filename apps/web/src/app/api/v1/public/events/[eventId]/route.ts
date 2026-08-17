/**
 * GET /api/v1/public/events/{evt_id}  —— 单场已发布公开活动(ch10 §10.6 L1)
 *
 * 路径参数是对外编码 ID(evt_…);解码失败、活动不存在、未发布、非 public、已软删,
 * 一律返回同一个 404(ch12 §12.1:不当资源存在性预言机)。
 * 响应包含票种与报名窗口的公开面,但绝不包含任何 registrations / users 数据。
 */
import { displayStatus, encodeId, eventJsonLd, getEventSchedule, getEventTickets } from '@yumeet/core';
import {
  baseUrlOf, eventSummaryDto, eventUuidFromParam, loadPublicEvent, loadPublicForm,
  notFound, preflight, publicJson, ticketDto,
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
  const base = baseUrlOf(req);

  const uuid = eventUuidFromParam(eventId);
  if (!uuid) return notFound(`Event ${eventId} does not exist or is not public.`);

  const event = await loadPublicEvent(uuid);
  if (!event) return notFound(`Event ${eventId} does not exist or is not public.`);

  const now = new Date();
  const [tickets, form, schedule] = await Promise.all([
    event.modules?.registration ? getEventTickets(uuid) : Promise.resolve([]),
    event.modules?.registration ? loadPublicForm(uuid) : Promise.resolve(null),
    event.modules?.schedule ? getEventSchedule(uuid) : Promise.resolve({ rooms: [], sessions: [] }),
  ]);

  const summary = eventSummaryDto(event, base, displayStatus(event, now));
  const registrationOpen = Boolean(
    form
    && (!form.opensAt || form.opensAt <= now)
    && (!form.closesAt || form.closesAt > now),
  );

  return publicJson(req, {
    ...summary,
    description: event.description,
    published_at: event.publishedAt?.toISOString() ?? null,
    registration: form
      ? {
          open: registrationOpen,
          opens_at: form.opensAt?.toISOString() ?? null,
          closes_at: form.closesAt?.toISOString() ?? null,
          waitlist_enabled: form.waitlistEnabled,
          url: summary.urls.register,
        }
      : null,
    tickets: tickets.map((t) => ticketDto(t, now)),
    counts: {
      sessions: schedule.sessions.length,
      rooms: schedule.rooms.length,
    },
    // ch10 §10.4:宿主页面可以直接把这段塞进 <script type="application/ld+json">
    jsonld: eventJsonLd({
      title: event.title,
      description: event.subtitle,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      url: summary.urls.public,
      venue: event.venue,
      organizer: event.orgName,
    }),
    // 同一活动的其它表示,方便自渲染方一次拿全入口
    links: {
      self: `${base}/api/v1/public/events/${encodeId('event', event.id)}`,
      schedule: summary.urls.schedule,
      ics: summary.urls.ics,
      embed: summary.urls.embed,
      oembed: `${base}/api/v1/public/oembed?url=${encodeURIComponent(summary.urls.public)}`,
    },
  });
}
