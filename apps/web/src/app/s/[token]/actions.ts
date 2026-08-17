'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { findSubmissionByToken, transitionSubmission, type SubStatus } from '@yumeet/core';
import { toFeedback, type ActionFeedback } from '@/app/[org]/[event]/cfp/errors';

/**
 * 作者在追踪页触发的迁移(撤回、确认出席)。
 * token 即凭证:先按 token 定位稿件,再走 transitionSubmission() 唯一入口(ch09 §9.4)。
 */
export async function authorTransitionAction(input: {
  token: string;
  to: Extract<SubStatus, 'withdrawn' | 'confirmed'>;
}): Promise<ActionFeedback> {
  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const row = await findSubmissionByToken(input.token);
  if (!row) return { ok: false, errorKey: 'errSubmissionNotFound' };

  try {
    await transitionSubmission(row.id, input.to, { type: 'user', ip });
  } catch (e) {
    return toFeedback(e);
  }

  revalidatePath(`/s/${input.token}`);
  return { ok: true };
}
