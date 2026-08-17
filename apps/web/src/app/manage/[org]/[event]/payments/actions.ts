'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  reconcileOfflinePayment, PaymentError, InvalidTransitionError,
  getEventBySlug, requireCapability, ForbiddenError,
} from '@yumeet/core';
import { requireUser } from '@/lib/session';

export interface ReconcileResult { ok: boolean; error?: string; confirmed?: number }

/**
 * 确认一笔线下到账。
 * 布局层已挡住未登录者,这里再校验一次能力 —— 涉及资金的操作不依赖单点防御。
 */
export async function reconcileAction(input: {
  orderId: string; orgSlug: string; eventSlug: string; note?: string;
}): Promise<ReconcileResult> {
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  const user = await requireUser();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await requireCapability(user.id, found.event.id, 'registration.manage');
    const r = await reconcileOfflinePayment(
      input.orderId,
      { type: 'user', id: user.id, ip },
      { note: input.note },
    );
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/payments`);
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}`);
    return { ok: true, confirmed: r.registrationIds.length };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: '没有核销权限' };
    if (e instanceof PaymentError) return { ok: false, error: e.message };
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: `报名状态不允许该操作(${e.from} → ${e.to})` };
    }
    console.error('核销失败', e);
    return { ok: false, error: '操作失败,请重试' };
  }
}
