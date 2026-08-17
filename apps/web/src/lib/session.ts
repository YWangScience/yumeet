import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  resolveSession, requireCapability, grantsFor, ForbiddenError,
  SESSION_COOKIE, type SessionUser, type Capability,
} from '@yumeet/core';

/** 读取当前会话(未登录返回 null) */
export async function currentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return resolveSession(jar.get(SESSION_COOKIE)?.value);
}

/** 要求已登录,否则跳登录页并带上回跳地址 */
export async function requireUser(returnTo?: string): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) {
    const target = returnTo ?? (await headers()).get('x-invoke-path') ?? '/';
    redirect(`/auth/login?next=${encodeURIComponent(target)}`);
  }
  return user;
}

/**
 * 后台页面的统一守卫:未登录跳登录,已登录但无权限抛 403。
 * 所有 /manage/* 页面都必须调用它(ch12 §12.1:对象级授权集中强制)。
 */
export async function requirePageCapability(
  eventId: string,
  capability: Capability,
  returnTo: string,
): Promise<SessionUser> {
  const user = await requireUser(returnTo);
  try {
    await requireCapability(user.id, eventId, capability);
  } catch (e) {
    if (e instanceof ForbiddenError) redirect(`/auth/denied?cap=${capability}`);
    throw e;
  }
  return user;
}

/** 供 UI 判断按钮是否显示(不作为安全边界,安全边界在服务端 action 内) */
export async function capabilitiesFor(eventId: string): Promise<Set<Capability>> {
  const user = await currentUser();
  if (!user) return new Set();
  const g = await grantsFor(user.id, eventId);
  return g.capabilities;
}

/**
 * Route Handler 的能力守卫。
 *
 * 页面靠 requirePageCapability + layout 兜底,但 **layout 不覆盖 Route Handler** ——
 * /manage 下的 .csv / .zip / .png 三条导出路由曾因此完全裸奔。
 * 这里返回 Response 而不是 redirect:导出接口的调用方是 <img>/<a download>,
 * 收到 302 只会得到一张坏图,401/403 才能让人看懂发生了什么。
 */
export async function guardRoute(
  eventId: string,
  capability: Capability,
): Promise<Response | null> {
  const user = await currentUser();
  if (!user) {
    return new Response('unauthorized', {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    });
  }
  try {
    await requireCapability(user.id, eventId, capability);
    return null;
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return new Response('forbidden', {
        status: 403,
        headers: { 'cache-control': 'no-store' },
      });
    }
    throw e;
  }
}
