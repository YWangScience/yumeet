/**
 * GET /manage/{org}/{event}/badges/preview.png?code=…&layout=a7|a6
 *
 * 单张胸牌的真实渲染产物(ch05 §5.2.2)。后台预览与「现场即时打印」拿到的是同一个
 * 字节流 —— 预览不做第二套 HTML 仿真,所见即所印。
 */
import { getEventBySlug, buildBadgeModel, renderBadgePng, isBadgeLayout } from '@yumeet/core';
import { guardRoute } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  req: Request,
  ctx: { params: Promise<{ org: string; event: string }> },
): Promise<Response> {
  const { org, event } = await ctx.params;
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const layoutParam = url.searchParams.get('layout');
  const layout = isBadgeLayout(layoutParam) ? layoutParam : 'a7';

  if (!code) return new Response('missing code', { status: 400 });

  const found = await getEventBySlug(org, event);
  if (!found) return new Response('not found', { status: 404 });

  // 胸牌上有姓名与单位:必须先确认调用者是现场工作人员
  const denied = await guardRoute(found.event.id, 'onsite.checkin');
  if (denied) return denied;

  // 确认码在活动内查找 —— 跨活动的码取不到别人的胸牌(ch12 §12.1 对象级授权)
  const model = await buildBadgeModel(found.event.id, { code });
  if (!model) return new Response('not found', { status: 404 });

  const png = await renderBadgePng(model, { layout });
  const download = url.searchParams.get('download');

  const headers: Record<string, string> = {
    'Content-Type': 'image/png',
    // 含个人姓名与单位,绝不能进任何共享缓存
    'Cache-Control': 'private, no-store',
    'X-Robots-Tag': 'noindex',
    'Content-Length': String(png.byteLength),
  };
  if (download) {
    headers['Content-Disposition'] =
      `attachment; filename="badge-${model.confirmationCode}.png"`;
  }
  return new Response(png as unknown as BodyInit, { status: 200, headers });
}
