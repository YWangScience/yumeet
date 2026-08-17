'use server';

import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import {
  getEventBySlug, getCfpConfig, saveSubmissionDraft, submitSubmission,
  type Author, type FormField,
} from '@yumeet/core';
import { normalizeLocale } from '@/lib/i18n';
import { toFeedback, type ActionFeedback } from './errors';

/** FormData → Author[](author_name_0 / author_email_0 / …,数量由客户端动态增删) */
function parseAuthors(fd: FormData): Author[] {
  const authors: Author[] = [];
  for (let i = 0; fd.has(`author_name_${i}`); i++) {
    const name = String(fd.get(`author_name_${i}`) ?? '').trim();
    const email = String(fd.get(`author_email_${i}`) ?? '').trim();
    const affiliation = String(fd.get(`author_affiliation_${i}`) ?? '').trim();
    if (!name && !email) continue;
    authors.push({
      name,
      email: email || undefined,
      affiliation: affiliation || undefined,
      isPresenter: fd.get(`author_presenter_${i}`) != null,
    });
  }
  return authors;
}

/** CFP 自定义问题 → answers(字段引擎负责校验,ch09 §9.3) */
function parseAnswers(fd: FormData, questions: FormField[]): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const q of questions) {
    const raw = fd.get(q.key);
    if (raw == null) continue;
    const value = String(raw);
    if (value === '') continue;
    if (q.kind === 'boolean') { answers[q.key] = value === 'on' || value === 'true'; continue; }
    if (q.kind === 'number') { answers[q.key] = Number(value); continue; }
    answers[q.key] = value;
  }
  return answers;
}

/**
 * 保存草稿 / 提交投稿 —— Server Action 进程内调用 packages/core(PLAN.md §0.3,无 RPC 层)。
 * 两个按钮共用一个 action,靠提交按钮的 name=__intent 区分。
 */
export async function saveOrSubmitAction(
  _prev: ActionFeedback,
  fd: FormData,
): Promise<ActionFeedback> {
  const orgSlug = String(fd.get('__org') ?? '');
  const eventSlug = String(fd.get('__event') ?? '');
  const token = String(fd.get('__token') ?? '') || null;
  const intent = String(fd.get('__intent') ?? 'draft');
  const locale = normalizeLocale(String(fd.get('__lang') ?? ''));

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return { ok: false, errorKey: 'errSubmissionNotFound' };
  const config = getCfpConfig(found.event);

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const input = {
    eventId: found.event.id,
    token,
    title: String(fd.get('title') ?? ''),
    abstract: String(fd.get('abstract') ?? ''),
    type: String(fd.get('type') ?? ''),
    track: String(fd.get('track') ?? '') || null,
    authors: parseAuthors(fd),
    answers: parseAnswers(fd, config.questions),
    actor: { type: 'user' as const, ip },
  };

  let trackingPath: string;
  try {
    const result = intent === 'submit'
      ? await submitSubmission(input)
      : await saveSubmissionDraft(input);
    trackingPath = result.trackingPath;
  } catch (e) {
    return toFeedback(e);
  }

  revalidatePath(`/manage/${orgSlug}/${eventSlug}/submissions`);
  // 保存或提交后都进追踪页(状态透明原则,ch05 §5.5)
  redirect(`${trackingPath}?lang=${locale}`);
}
