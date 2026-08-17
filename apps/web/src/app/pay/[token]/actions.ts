'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  getRegistrationByToken, getOrderForRegistration, switchOrderMethod,
  PaymentError, type PaymentMethod,
} from '@yumeet/core';

/**
 * 参会者自助换付款方式。
 *
 * 授权凭的是 URL 里那枚报名 token —— 与追踪页同一套「无摩擦身份」:
 * 拿得到链接就是本人。但 token 只能操作它自己那张订单,
 * 所以这里从 token 反查订单,绝不接受前端传来的 orderId。
 */
export async function switchMethodAction(
  token: string, method: string,
): Promise<{ ok: boolean; error?: string }> {
  const data = await getRegistrationByToken(token);
  if (!data) return { ok: false, error: '链接无效或已过期' };

  const payment = await getOrderForRegistration(data.registration.id);
  if (!payment) return { ok: false, error: '找不到订单' };

  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await switchOrderMethod(
      payment.order.id, method as PaymentMethod, { type: 'user', ip },
    );
    revalidatePath(`/pay/${token}`);
    return { ok: true };
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, error: e.message };
    console.error('切换付款方式失败', e);
    return { ok: false, error: '切换失败,请重试' };
  }
}
