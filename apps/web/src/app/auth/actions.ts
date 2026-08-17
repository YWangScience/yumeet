'use server';

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  issueMagicLink, consumeMagicLink, revokeSession, AuthError,
  SESSION_COOKIE, resolveSession,
} from '@yumeet/core';
import { db, emailLogs } from '@yumeet/db';

export interface LoginState { ok: boolean; sent?: boolean; error?: string; devLink?: string }

/**
 * 发送登录链接。无论邮箱是否已注册都返回「已发送」,
 * 避免接口成为账号存在性预言机(ch12 §12.1)。
 */
export async function requestMagicLinkAction(
  _prev: LoginState, formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get('email') ?? '');
  const next = String(formData.get('next') ?? '/');

  try {
    const issued = await issueMagicLink(email, 'login');
    const h = await headers();
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const host = h.get('host') ?? 'localhost:3210';
    const link = `${proto}://${host}/auth/verify?token=${issued.token}`
      + `&next=${encodeURIComponent(next)}`;

    // 邮件发送由 worker 负责;此处记入 email_logs 作为投递源
    await db.insert(emailLogs).values({
      organizationId: '00000000-0000-0000-0000-000000000000',
      to: issued.email,
      template: 'auth.magic_link',
      subject: 'yuMeet 登录链接 / Your sign-in link',
      status: 'queued',
    });

    // 开发环境直接把链接回显,避免本地无邮件服务时无法登录
    const devLink = process.env.NODE_ENV !== 'production' ? link : undefined;
    return { ok: true, sent: true, devLink };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, error: e.message };
    console.error('magic link 签发失败', e);
    return { ok: false, error: '发送失败,请稍后重试' };
  }
}

export async function signOutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const s = await resolveSession(token);
    if (s) await revokeSession(s.sessionId);
  }
  jar.delete(SESSION_COOKIE);
  redirect('/');
}
