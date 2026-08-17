'use server';

import { revalidatePath } from 'next/cache';
import {
  getEventBySlug, transitionRegistration, InvalidTransitionError,
  RegistrationError, ForbiddenError, type RegStatus,
} from '@yumeet/core';
import { actorWithCapability, UnauthenticatedError } from '@/lib/authz';

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
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  try {
    const actor = await actorWithCapability(found.event.id, 'registration.manage');
    await transitionRegistration(input.registrationId, input.to, actor);
  } catch (e) {
    if (e instanceof UnauthenticatedError) return { ok: false, error: '请先登录' };
    if (e instanceof ForbiddenError) return { ok: false, error: '没有管理报名的权限' };
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
