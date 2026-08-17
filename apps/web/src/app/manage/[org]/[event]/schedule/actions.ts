'use server';

import { revalidatePath } from 'next/cache';
import {
  getEventBySlug, saveScheduleDraft, publishSchedule, ScheduleError,
  type SessionDraft, type SnapshotSession, type ScheduleDiff, type Conflict,
} from '@yumeet/core';

export interface SaveScheduleResult {
  ok: boolean;
  error?: string;
  /** 服务端复核出的冲突,前端据此高亮 —— 前端的实时提示不是许可 */
  conflicts?: Conflict[];
  sessions?: SnapshotSession[];
  diff?: ScheduleDiff;
  idMap?: Record<string, string>;
}

export interface PublishScheduleResult {
  ok: boolean;
  error?: string;
  conflicts?: Conflict[];
  version?: number;
  publishedAt?: string;
  sessions?: SnapshotSession[];
}

import { actorWithCapability, UnauthenticatedError } from '@/lib/authz';
import { ForbiddenError } from '@yumeet/core';

/**
 * 授权失败 → 用户能看懂的一句话。
 *
 * 编排器这个界面本身就是「整场会议占哪个时段、放哪个会场」,
 * 按用户定的规则归大会层:分会主席只在自己分会内部排报告的具体时刻,
 * 那是另一个界面,走 schedule.edit_own_track。
 */
function authzError(e: unknown): { ok: false; error: string } | null {
  if (e instanceof UnauthenticatedError) return { ok: false, error: '请先登录' };
  if (e instanceof ForbiddenError) {
    return { ok: false, error: '没有编排日程的权限 —— 整场时段编排由大会层负责' };
  }
  return null;
}

/**
 * 保存草稿(ch05 §5.1.3:编辑直接落 sessions 表)。
 * core 会在写库前独立复核结构校验与冲突检测,不依赖前端。
 */
export async function saveScheduleAction(input: {
  orgSlug: string;
  eventSlug: string;
  drafts: SessionDraft[];
}): Promise<SaveScheduleResult> {
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  try {
    const actor = await actorWithCapability(found.event.id, 'schedule.edit');
    const res = await saveScheduleDraft({
      eventId: found.event.id,
      drafts: input.drafts,
      actor,
    });
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/schedule`);
    return { ok: true, sessions: res.sessions, diff: res.diff, idMap: res.idMap };
  } catch (e) {
    const denied = authzError(e);
    if (denied) return denied;
    if (e instanceof ScheduleError) {
      return { ok: false, error: e.message, conflicts: e.conflicts };
    }
    console.error('保存日程草稿失败', e);
    return { ok: false, error: '保存失败,请重试' };
  }
}

/**
 * 发布(ch05 §5.1.3):服务端复核冲突 → 物化 scheduleSnapshots(version 自增)
 * → revalidate 公共日程页。
 */
export async function publishScheduleAction(input: {
  orgSlug: string;
  eventSlug: string;
}): Promise<PublishScheduleResult> {
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  try {
    // 发布是对外可见的动作,比保存草稿更高一档
    const actor = await actorWithCapability(found.event.id, 'schedule.publish');
    const res = await publishSchedule({ eventId: found.event.id, actor });
    revalidatePath(`/${input.orgSlug}/${input.eventSlug}/schedule`);
    revalidatePath(`/${input.orgSlug}/${input.eventSlug}`);
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/schedule`);
    return {
      ok: true,
      version: res.version,
      publishedAt: res.publishedAt,
      sessions: res.sessions,
    };
  } catch (e) {
    const denied = authzError(e);
    if (denied) return denied;
    if (e instanceof ScheduleError) {
      return { ok: false, error: e.message, conflicts: e.conflicts };
    }
    console.error('发布日程失败', e);
    return { ok: false, error: '发布失败,请重试' };
  }
}
