/**
 * Art. 15 访问权 / Art. 20 可携带权:凭 /r/{token} 导出全部个人数据为 JSON。
 * 不需要账户 —— token 本身就是凭证(ch05 §5.5 的 128-bit 不可枚举令牌)。
 * 每次导出写审计日志(在 core 的 exportRegistrationData 里完成)。
 */
import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { exportRegistrationData, GdprError } from '@yumeet/core';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ token: string }>;
}

export async function GET(_req: Request, ctx: Ctx): Promise<Response> {
  const { token } = await ctx.params;
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    const data = await exportRegistrationData(token, { actor: { type: 'user', ip } });
    const filename = `yumeet-data-${data.subject.registrationId}.json`;
    return new NextResponse(JSON.stringify(data, null, 2), {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        // 个人数据:不缓存、不索引
        'cache-control': 'no-store',
        'x-robots-tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    if (err instanceof GdprError) {
      return NextResponse.json(
        { error: err.code, message: err.message },
        { status: err.httpStatus, headers: { 'cache-control': 'no-store' } },
      );
    }
    console.error('数据导出失败', err);
    return NextResponse.json({ error: 'internal_error' }, { status: 500 });
  }
}
