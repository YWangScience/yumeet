'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  transitionRegistration, InvalidTransitionError, RegistrationError,
  type RegStatus,
} from '@yumeet/core';

export interface TransitionResult {
  ok: boolean;
  error?: string;
}

/**
 * 组织者触发状态迁移 —— Server Action 进程内调用 core 的唯一入口(ch09 §9.4)。
 * 非法迁移由 core 抛 InvalidTransitionError,此处映射为用户可读提示。
 */
export async function transitionRegistrationAction(input: {
  registrationId: string;
  to: RegStatus;
  orgSlug: string;
  eventSlug: string;
}): Promise<TransitionResult> {
  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await transitionRegistration(input.registrationId, input.to, {
      type: 'user',
      id: null, // M1:后台尚未接入登录,审计记录为匿名组织者
      ip,
    });
  } catch (e) {
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: `不能从「${e.from}」变更为「${e.to}」` };
    }
    if (e instanceof RegistrationError) return { ok: false, error: e.message };
    console.error('状态迁移失败', e);
    return { ok: false, error: '操作失败,请重试' };
  }

  revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}`);
  revalidatePath(`/${input.orgSlug}/${input.eventSlug}`);
  return { ok: true };
}
