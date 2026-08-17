'use server';

import { revalidatePath } from 'next/cache';
import {
  getEventBySlug, getRegistrationByCode, transitionRegistration,
  InvalidTransitionError, RegistrationError, REGISTRATION_LABELS,
  ForbiddenError, type RegStatus,
} from '@yumeet/core';
import { actorWithCapability, UnauthenticatedError } from '@/lib/authz';

export interface CheckinResult {
  ok: boolean;
  name?: string;
  error?: string;
  /** 网络/临时故障:客户端应暂存重试(ch05 §5.2 离线容错) */
  retriable?: boolean;
}

export async function checkinByCodeAction(input: {
  code: string; orgSlug: string; eventSlug: string;
}): Promise<CheckinResult> {
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  try {
    // 签到台是志愿者也能用的岗位,但必须是被授予的人 ——
    // 确认码在胸牌上是明文,不设门槛等于谁都能替别人签到
    const actor = await actorWithCapability(found.event.id, 'onsite.checkin');

    const reg = await getRegistrationByCode(found.event.id, input.code);
    if (!reg) return { ok: false, error: '确认码无效' };

    const status = reg.status as RegStatus;
    if (status === 'checked_in') {
      return { ok: false, error: '该参会人已签到' };
    }

    const answers = reg.answers as Record<string, unknown>;
    const name = typeof answers['full_name'] === 'string' ? answers['full_name'] : reg.email;

    await transitionRegistration(reg.id, 'checked_in', actor);
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/checkin`);
    return { ok: true, name };
  } catch (e) {
    if (e instanceof UnauthenticatedError) return { ok: false, error: '请先登录' };
    if (e instanceof ForbiddenError) return { ok: false, error: '没有签到权限' };
    if (e instanceof InvalidTransitionError) {
      return {
        ok: false,
        error: `当前状态「${REGISTRATION_LABELS[e.from as RegStatus]?.zh ?? e.from}」不能签到`,
      };
    }
    if (e instanceof RegistrationError) return { ok: false, error: e.message };
    console.error('签到失败', e);
    // 未知错误按可重试处理,交给客户端离线队列
    return { ok: false, error: '服务暂时不可用', retriable: true };
  }
}
