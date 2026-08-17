/**
 * GET /api/v1/public/oembed?url={活动页链接} —— 标准 oEmbed 端点(ch10 §10.6 L2)
 *
 * 在 WordPress / Notion / Ghost 等支持 oEmbed 发现的编辑器里直接粘贴活动链接,
 * 自动展开为活动卡片(iframe 指向 /embed/{evt_id},该路径无导航壳、允许被跨域嵌框)。
 *
 * 参数:url(必填)、format(可选,只支持 json)、maxwidth / maxheight(可选)。
 * 可识别的 url 形态:
 *   https://host/{orgSlug}/{eventSlug}[/...]
 *   https://host/embed/{evt_id}
 */
import { getEventBySlug } from '@yumeet/core';
import {
  badRequest, baseUrlOf, escapeHtml, eventUrls, eventUuidFromParam, loadPublicEvent,
  notFound, preflight, problem, publicJson,
  type PublicEventRow,
} from '@/lib/api-helpers';

export const revalidate = 60;

const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 240;
const MIN_HEIGHT = 180;

export function OPTIONS(): Response {
  return preflight();
}

function clamp(raw: string | null, fallback: number, min: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(fallback, n));
}

/** 把一个活动页 URL 解析为已发布的公开活动;任何解析不出的形态都返回 null */
async function resolveEvent(target: URL): Promise<PublicEventRow | null> {
  const parts = target.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  // /embed/{evt_id}
  if (parts[0] === 'embed' && parts[1]) {
    const uuid = eventUuidFromParam(parts[1]);
    return uuid ? loadPublicEvent(uuid) : null;
  }

  // /{orgSlug}/{eventSlug}[/register|/schedule|…]
  const [orgSlug, eventSlug] = parts;
  if (!orgSlug || !eventSlug) return null;
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return null;
  // 发布态 / 可见性 / 软删除的权威判定统一走 loadPublicEvent
  return loadPublicEvent(found.event.id);
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const raw = url.searchParams.get('url');
  const format = url.searchParams.get('format');

  if (format && format.toLowerCase() !== 'json') {
    // oEmbed 规范:不支持的 format 返回 501
    return problem(501, {
      type: 'unsupported-format',
      title: 'Not Implemented',
      detail: `Format ${format} is not supported; this provider only returns JSON.`,
    });
  }
  if (!raw) return badRequest('Query parameter "url" is required.');

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return badRequest(`Query parameter "url" is not a valid absolute URL: ${raw}`);
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return badRequest('Only http(s) URLs can be embedded.');
  }

  const event = await resolveEvent(target);
  if (!event) return notFound(`No public yuMeet event found at ${raw}`);

  // 白标域名下用请求 URL 自己的 origin,嵌入卡片留在组织自己的域名上(ch07 §7.6)
  const base = `${target.protocol}//${target.host}` || baseUrlOf(req);
  const urls = eventUrls(event, base);

  const width = clamp(url.searchParams.get('maxwidth'), DEFAULT_WIDTH, MIN_WIDTH);
  const height = clamp(url.searchParams.get('maxheight'), DEFAULT_HEIGHT, MIN_HEIGHT);

  const title = `${event.title} · ${event.orgName}`;
  const html = `<iframe src="${escapeHtml(urls.embed)}" width="${width}" height="${height}" `
    + `title="${escapeHtml(title)}" frameborder="0" scrolling="no" loading="lazy" `
    + 'style="border:0;width:100%;max-width:100%" '
    + 'allow="fullscreen" referrerpolicy="no-referrer-when-downgrade"></iframe>';

  return publicJson(req, {
    version: '1.0',
    type: 'rich',
    html,
    width,
    height,
    title,
    provider_name: 'yuMeet',
    provider_url: base,
    author_name: event.orgName,
    author_url: `${base}/${event.orgSlug}`,
    cache_age: 60,
    // 非标准但常见的补充字段,方便宿主自渲染
    event: {
      url: urls.public,
      starts_at: event.startsAt.toISOString(),
      ends_at: event.endsAt.toISOString(),
      timezone: event.timezone,
    },
  });
}
