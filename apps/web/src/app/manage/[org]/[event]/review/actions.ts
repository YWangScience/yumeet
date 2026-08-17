'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { saveReview, decodeId, SCORE_DIMENSIONS } from '@yumeet/core';
import { toFeedback, type ActionFeedback } from '@/app/[org]/[event]/cfp/errors';

/**
 * 保存 / 提交评审(ch04 §4.3)。
 * 评分维度、量表范围与自报利益冲突的处理全部在 core 内校验,这里只做 FormData → 入参。
 */
export async function saveReviewAction(
  _prev: ActionFeedback,
  fd: FormData,
): Promise<ActionFeedback> {
  const orgSlug = String(fd.get('__org') ?? '');
  const eventSlug = String(fd.get('__event') ?? '');
  const submissionPublicId = String(fd.get('__submission') ?? '');
  const reviewerPublicId = String(fd.get('__reviewer') ?? '');
  const submit = String(fd.get('__intent') ?? 'draft') === 'submit';
  const isConflict = fd.get('conflict') != null;

  let submissionId: string;
  let reviewerId: string;
  try {
    submissionId = decodeId('submission', submissionPublicId);
    reviewerId = decodeId('user', reviewerPublicId);
  } catch {
    return { ok: false, errorKey: 'errSubmissionNotFound' };
  }

  const scores: Record<string, number> = {};
  for (const dim of SCORE_DIMENSIONS) {
    const raw = fd.get(`score_${dim.key}`);
    if (raw == null || raw === '') continue;
    scores[dim.key] = Number(raw);
  }
  const confidenceRaw = fd.get('confidence');
  const confidence = confidenceRaw == null || confidenceRaw === ''
    ? null
    : Number(confidenceRaw);

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await saveReview({
      submissionId,
      reviewerId,
      scores,
      confidence,
      commentForCommittee: String(fd.get('comment_committee') ?? ''),
      commentForAuthors: String(fd.get('comment_authors') ?? ''),
      isConflict,
      submit,
      actor: { type: 'user', id: reviewerId, ip },
    });
  } catch (e) {
    return toFeedback(e);
  }

  revalidatePath(`/manage/${orgSlug}/${eventSlug}/review`);
  revalidatePath(`/manage/${orgSlug}/${eventSlug}/submissions`);
  return {
    ok: true,
    noticeKey: submit ? 'reviewSubmittedNotice' : 'reviewSavedNotice',
  };
}
