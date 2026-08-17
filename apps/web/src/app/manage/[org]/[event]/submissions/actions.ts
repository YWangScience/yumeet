'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  assignReviewers, decideSubmission, transitionSubmission, decodeId,
} from '@yumeet/core';
import { toFeedback, type ActionFeedback } from '@/app/[org]/[event]/cfp/errors';

async function actorIp(): Promise<string | null> {
  const hdrs = await headers();
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
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

  const ip = await actorIp();
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
      const res = await assignReviewers(id, reviewerUuids, { type: 'user', id: null, ip });
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
  const ip = await actorIp();
  try {
    await decideSubmission(
      decodeId('submission', input.submissionId),
      input.decision,
      { type: 'user', id: null, ip },
      { waitlisted: input.waitlisted },
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
  const ip = await actorIp();
  try {
    await transitionSubmission(
      decodeId('submission', input.submissionId),
      input.to,
      { type: 'user', id: null, ip },
    );
  } catch (e) {
    return toFeedback(e);
  }
  revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/submissions`);
  return { ok: true };
}
