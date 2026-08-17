'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  grantRole, revokeRole, MemberError, getEventBySlug,
  requireCapability, ForbiddenError, type EventRole,
} from '@yumeet/core';
import { requireUser } from '@/lib/session';

export interface MemberResult { ok: boolean; error?: string; created?: boolean }

/** 授予角色。涉及权限变更,每次都重新校验 member.manage,不依赖布局层单点防御。 */
export async function grantRoleAction(input: {
  orgSlug: string; eventSlug: string; email: string;
  role: EventRole; tracks?: string[];
}): Promise<MemberResult> {
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  const user = await requireUser();
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await requireCapability(user.id, found.event.id, 'member.manage');
    const r = await grantRole({
      eventId: found.event.id,
      email: input.email,
      role: input.role,
      tracks: input.tracks,
      actor: { type: 'user', id: user.id, ip },
    });
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/members`);
    return { ok: true, created: r.created };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: '没有成员管理权限' };
    if (e instanceof MemberError) return { ok: false, error: e.message };
    console.error('授予角色失败', e);
    return { ok: false, error: '操作失败,请重试' };
  }
}

export async function revokeRoleAction(input: {
  orgSlug: string; eventSlug: string; userId: string; role: EventRole;
}): Promise<MemberResult> {
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  const user = await requireUser();
  const ip = (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await requireCapability(user.id, found.event.id, 'member.manage');
    await revokeRole({
      eventId: found.event.id,
      userId: input.userId,
      role: input.role,
      actor: { type: 'user', id: user.id, ip },
    });
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/members`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: '没有成员管理权限' };
    if (e instanceof MemberError) return { ok: false, error: e.message };
    console.error('回收角色失败', e);
    return { ok: false, error: '操作失败,请重试' };
  }
}
