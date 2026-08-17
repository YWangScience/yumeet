import { headers } from 'next/headers';
import {
  getSubmissionDetail, requireCapability, requireScopedCapability,
  ForbiddenError, type Capability, type Actor,
} from '@yumeet/core';
import { currentUser } from './session';

/**
 * Server Action 的授权入口。
 *
 * Server Action 的端点对任何能构造请求的人都是可达的 —— 页面上没有按钮
 * 不等于动作调不到。所以每个改数据的 action 必须自己校验,
 * 不能依赖「用户看不到入口」。
 *
 * 顺带解决审计的问题:以前这些 action 传的是 `{ id: null }`,
 * 审计链只记下「有人改了」,记不下是谁。这里统一把登录者带进 actor。
 */
export class UnauthenticatedError extends Error {
  constructor() { super('未登录'); this.name = 'UnauthenticatedError'; }
}

async function ip(): Promise<string | null> {
  return (await headers()).get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

/** 校验能力并返回可直接下传给 core 的 actor */
export async function actorWithCapability(
  eventId: string, capability: Capability,
): Promise<Actor> {
  const user = await currentUser();
  if (!user) throw new UnauthenticatedError();
  await requireCapability(user.id, eventId, capability);
  return { type: 'user', id: user.id, ip: await ip() };
}

/**
 * 分会范围内的校验:大会层有全局能力就直接放行,
 * 分会主席只在自己管辖的 track 上放行(packages/core requireScopedCapability)。
 */
export async function actorForSubmission(
  eventId: string, submissionId: string,
  action: 'submission.decide',
): Promise<Actor> {
  const user = await currentUser();
  if (!user) throw new UnauthenticatedError();
  const detail = await getSubmissionDetail(submissionId);
  if (!detail) throw new ForbiddenError(action);
  await requireScopedCapability(user.id, eventId, action, {
    track: detail.submission.track,
  });
  return { type: 'user', id: user.id, ip: await ip() };
}

export async function actorForSchedule(
  eventId: string, track: string | null,
): Promise<Actor> {
  const user = await currentUser();
  if (!user) throw new UnauthenticatedError();
  await requireScopedCapability(user.id, eventId, 'schedule.edit', { track });
  return { type: 'user', id: user.id, ip: await ip() };
}
