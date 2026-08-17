'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
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

async function actorIp(): Promise<string | null> {
  const hdrs = await headers();
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
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
    const res = await saveScheduleDraft({
      eventId: found.event.id,
      drafts: input.drafts,
      // M1:后台尚未接入登录,审计记录为匿名组织者(与其他 Server Action 一致)
      actor: { type: 'user', id: null, ip: await actorIp() },
    });
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/schedule`);
    return { ok: true, sessions: res.sessions, diff: res.diff, idMap: res.idMap };
  } catch (e) {
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
    const res = await publishSchedule({
      eventId: found.event.id,
      actor: { type: 'user', id: null, ip: await actorIp() },
    });
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
    if (e instanceof ScheduleError) {
      return { ok: false, error: e.message, conflicts: e.conflicts };
    }
    console.error('发布日程失败', e);
    return { ok: false, error: '发布失败,请重试' };
  }
}
