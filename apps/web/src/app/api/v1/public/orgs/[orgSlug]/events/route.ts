/**
 * GET /api/v1/public/orgs/{orgSlug}/events  —— 组织的已发布公开活动列表(ch10 §10.6 L1)
 *
 * 查询参数:
 *   limit    默认 20,上限 100(ch10 §10.2 规则 3)
 *   cursor   cur_ 开头的不透明游标,响应里的 pagination.next_cursor 原样回传
 *   upcoming 只要尚未结束的活动(按开始时间升序)
 *   past     只要已结束的活动(按开始时间降序,最近的在前)
 *
 * 只返回 status='published' && visibility='public' && deleted_at IS NULL 的活动。
 */
import { displayStatus, encodeId, listPublishedEvents } from '@yumeet/core';
import {
  baseUrlOf, decodeCursor, encodeCursor, eventSummaryDto, loadPublicOrg,
  notFound, parseFlag, parseLimit, preflight, publicJson,
  type PublicEventRow,
} from '@/lib/api-helpers';

export const revalidate = 60;

export function OPTIONS(): Response {
  return preflight();
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ orgSlug: string }> },
): Promise<Response> {
  const { orgSlug } = await ctx.params;
  const url = new URL(req.url);
  const base = baseUrlOf(req);

  const org = await loadPublicOrg(orgSlug);
  if (!org) {
    return notFound(`Organization ${orgSlug} does not exist or is not public.`);
  }

  const limit = parseLimit(url.searchParams.get('limit'));
  const upcoming = parseFlag(url.searchParams.get('upcoming'));
  const past = parseFlag(url.searchParams.get('past'));
  const now = new Date();

  // listPublishedEvents 已把 published + public + 未软删的过滤写进 SQL
  const rows = await listPublishedEvents(orgSlug);

  let items: PublicEventRow[] = rows.map(({ event, org: o }) => ({
    id: event.id,
    slug: event.slug,
    title: event.title,
    subtitle: event.subtitle,
    description: event.description,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    venue: event.venue,
    modules: event.modules,
    status: event.status,
    publishedAt: event.publishedAt,
    orgSlug: o.slug,
    orgName: o.name,
  }));

  if (upcoming && !past) items = items.filter((e) => e.endsAt >= now);
  if (past && !upcoming) items = items.filter((e) => e.endsAt < now);

  // 默认与 upcoming 按开始时间升序;past 用倒序(最近结束的排前面)
  const desc = past && !upcoming;
  items.sort((a, b) =>
    desc
      ? b.startsAt.getTime() - a.startsAt.getTime() || b.id.localeCompare(a.id)
      : a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));

  // cursor 分页:游标锚点是上一页最后一条的编码 ID,从它的下一条开始切
  const cursor = decodeCursor(url.searchParams.get('cursor'));
  if (cursor) {
    const at = items.findIndex((e) => encodeId('event', e.id) === cursor.i);
    items = at >= 0 ? items.slice(at + 1) : [];
  }

  const page = items.slice(0, limit);
  const hasMore = items.length > page.length;
  const last = page[page.length - 1];

  return publicJson(req, {
    data: page.map((e) => eventSummaryDto(e, base, displayStatus(e, now))),
    pagination: {
      next_cursor: hasMore && last
        ? encodeCursor({ t: last.startsAt.toISOString(), i: encodeId('event', last.id) })
        : null,
      has_more: hasMore,
    },
    organization: { slug: org.slug, name: org.name },
  });
}
