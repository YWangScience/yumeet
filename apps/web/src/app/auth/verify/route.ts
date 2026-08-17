import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { consumeMagicLink, AuthError, SESSION_COOKIE, SESSION_TTL_MS } from '@yumeet/core';

/**
 * magic link 落地端点:校验 token → 换会话 → 种 cookie → 回跳。
 *
 * 用 NextResponse 直接返回 302 并附 Set-Cookie:
 * Route Handler 里 cookies() 是只读的,写 cookie 必须挂在响应上;
 * 且 next/navigation 的 redirect() 靠抛异常实现,放进 try/catch 会被自己的 catch 吞掉。
 *
 * cookie 参数按 ch06 §6.3:__Host- 前缀、httpOnly、Secure、SameSite=Lax、Path=/。
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  const rawNext = url.searchParams.get('next') || '/';
  // 只允许站内回跳,防开放重定向(ch12 §12.2)
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/';

  const fail = (code: string) =>
    NextResponse.redirect(new URL(`/auth/login?error=${code}`, url.origin), 302);

  if (!token) return fail('missing_token');

  const h = await headers();
  try {
    const session = await consumeMagicLink(token, {
      purpose: 'login',
      userAgent: h.get('user-agent'),
      ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
    });

    const res = NextResponse.redirect(new URL(next, url.origin), 302);
    res.cookies.set(SESSION_COOKIE, session.sessionToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
    });
    return res;
  } catch (e) {
    return fail(e instanceof AuthError ? e.code : 'invalid_token');
  }
}
