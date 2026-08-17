'use server';

import { revalidatePath } from 'next/cache';
import {
  assignReviewers, decideSubmission, transitionSubmission, decodeId,
  getEventBySlug,
} from '@yumeet/core';
import { toFeedback, type ActionFeedback } from '@/app/[org]/[event]/cfp/errors';
import { actorWithCapability, actorForSubmission } from '@/lib/authz';

/** 每个 action 都要先把 slug 解析成 eventId 才能谈权限 */
async function eventIdOf(orgSlug: string, eventSlug: string): Promise<string | null> {
  const found = await getEventBySlug(orgSlug, eventSlug);
  return found?.event.id ?? null;
}

/**
 * 批量分配审稿人(ch04 §4.3):利益冲突者由 core 自动跳过,
 * submitted / changes_requested 的稿件在同一事务内迁到 under_review。
 */
export async function assignReviewersAction(input: {
  submissionIds: string[];   // 对外 ID(sub_…)
  reviewerIds: string[];     // 对外 ID(usr_…)
  orgSlug: string;
  eventSlug: string;
}): Promise<ActionFeedback> {
  if (input.submissionIds.length === 0) return { ok: false, errorKey: 'noSelection' };
  if (input.reviewerIds.length === 0) return { ok: false, errorKey: 'errNoReviewer' };

  const eventId = await eventIdOf(input.orgSlug, input.eventSlug);
  if (!eventId) return { ok: false, errorKey: 'errSubmissionNotFound' };

  let actor;
  try {
    // 分派审稿人是大会层的编排动作,不下放给分会主席
    actor = await actorWithCapability(eventId, 'submission.manage');
  } catch (e) { return toFeedback(e); }

  let reviewerUuids: string[];
  let submissionUuids: string[];
  try {
    reviewerUuids = input.reviewerIds.map((id) => decodeId('user', id));
    submissionUuids = input.submissionIds.map((id) => decodeId('submission', id));
  } catch {
    return { ok: false, errorKey: 'errSubmissionNotFound' };
  }

  let assigned = 0;
  let skipped = 0;
  let lastError: ActionFeedback | null = null;

  for (const id of submissionUuids) {
    try {
      const res = await assignReviewers(id, reviewerUuids, actor);
      assigned += 1;
      skipped += res.skipped.length;
    } catch (e) {
      lastError = toFeedback(e);
    }
  }

  revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/submissions`);
  revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/review`);

  if (assigned === 0 && lastError) return lastError;
  return { ok: true, noticeKey: 'assignDone', vars: { n: assigned }, skipped };
}

/** 录用决议:accepted(可带 waitlist 标记)或 rejected(ch04 §4.3 录用流水线) */
export async function decideSubmissionAction(input: {
  submissionId: string;
  decision: 'accepted' | 'rejected';
  waitlisted?: boolean;
  orgSlug: string;
  eventSlug: string;
}): Promise<ActionFeedback> {
  const eventId = await eventIdOf(input.orgSlug, input.eventSlug);
  if (!eventId) return { ok: false, errorKey: 'errSubmissionNotFound' };

  try {
    const submissionId = decodeId('submission', input.submissionId);
    // 大会层有全局 submission.decide 直接过;分会主席只在自己分会的稿件上过
    const actor = await actorForSubmission(eventId, submissionId, 'submission.decide');
    await decideSubmission(
      submissionId, input.decision, actor, { waitlisted: input.waitlisted },
    );
  } catch (e) {
    return toFeedback(e);
  }
  revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/submissions`);
  return { ok: true };
}

/** 其余组织者可触发的迁移(要求修改、撤回等),统一走 transitionSubmission() */
export async function transitionSubmissionAction(input: {
  submissionId: string;
  to: 'changes_requested' | 'under_review' | 'withdrawn' | 'scheduled';
  orgSlug: string;
  eventSlug: string;
}): Promise<ActionFeedback> {
  const eventId = await eventIdOf(input.orgSlug, input.eventSlug);
  if (!eventId) return { ok: false, errorKey: 'errSubmissionNotFound' };

  try {
    const submissionId = decodeId('submission', input.submissionId);
    // 「要求修改 / 撤回 / 排入日程」与录用同属对稿件的处置,按同一范围校验
    const actor = await actorForSubmission(eventId, submissionId, 'submission.decide');
    await transitionSubmission(submissionId, input.to, actor);
  } catch (e) {
    return toFeedback(e);
  }
  revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/submissions`);
  return { ok: true };
}
