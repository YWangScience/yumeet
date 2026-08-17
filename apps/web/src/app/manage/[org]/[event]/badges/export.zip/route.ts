/**
 * GET /manage/{org}/{event}/badges/export.zip?status=…&layout=a7|a6
 *
 * 会前批量(ch05 §5.2.2):按筛选条件把全部胸牌渲染成 PNG,按姓名排序打成一个 zip。
 * 打包器是 core 里的 store-only 实现 —— PNG 已是 deflate 压缩,再压一遍收益近零,
 * 因此不引入 jszip/archiver(PLAN.md §4)。
 */
import { getEventBySlug, renderBadgeBatchZip, isBadgeLayout } from '@yumeet/core';
import { REGISTRATION_LABELS, type RegStatus } from '@yumeet/core';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
/** 上千张胸牌的渲染是 CPU 密集任务,给足时间(单位:秒) */
export const maxDuration = 600;

function isRegStatus(v: string | null): v is RegStatus {
  return v !== null && v in REGISTRATION_LABELS;
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ org: string; event: string }> },
): Promise<Response> {
  const { org, event } = await ctx.params;
  const url = new URL(req.url);
  const statusParam = url.searchParams.get('status');
  const layoutParam = url.searchParams.get('layout');
  const layout = isBadgeLayout(layoutParam) ? layoutParam : 'a7';

  const found = await getEventBySlug(org, event);
  if (!found) return new Response('not found', { status: 404 });

  const { zip, count } = await renderBadgeBatchZip(found.event.id, {
    statuses: isRegStatus(statusParam) ? [statusParam] : undefined,
    layout,
    limit: 2000,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(zip as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="badges-${found.event.slug}-${stamp}.zip"`,
      // 名单数据,不得进任何共享缓存
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
      'X-Badge-Count': String(count),
      'Content-Length': String(zip.byteLength),
    },
  });
}
