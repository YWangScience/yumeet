import { InvalidTransitionError, SubmissionError, ForbiddenError } from '@yumeet/core';
import { UnauthenticatedError } from '@/lib/authz';
import type { TKey } from '@/lib/i18n';

/**
 * Server Action 的统一返回形状。
 * 文案不在服务端拼:服务端只给「词条键」,由客户端按当前语言渲染(双语要求,ch08 §8.8)。
 */
export interface ActionFeedback {
  ok: boolean;
  errorKey?: TKey;
  noticeKey?: TKey;
  /** 非法迁移的状态对,客户端按当前语言取 SUBMISSION_LABELS 渲染 */
  transition?: { from: string; to: string };
  /** 计数类提示的插值变量(如已分配 n 篇、跳过 n 人次) */
  vars?: Record<string, number>;
  /** 因利益冲突被跳过的审稿人数 */
  skipped?: number;
}

const CODE_TO_KEY: Record<string, TKey> = {
  cfp_closed: 'errCfpClosed',
  not_editable: 'errNotEditable',
  not_found: 'errSubmissionNotFound',
  event_not_found: 'errSubmissionNotFound',
  validation_failed: 'errValidation',
  title_required: 'errValidation',
  abstract_required: 'errValidation',
  abstract_too_long: 'errValidation',
  authors_required: 'errValidation',
  presenter_required: 'errValidation',
  author_email_required: 'errValidation',
  track_unknown: 'errValidation',
  type_unknown: 'errValidation',
  all_conflicted: 'errAllConflicted',
  not_enough_reviews: 'errNotEnoughReviews',
  no_reviewer: 'errNoReviewer',
  not_assigned: 'errNotAssigned',
  score_required: 'errScoreInput',
  score_out_of_range: 'errScoreInput',
  confidence_required: 'errScoreInput',
  confidence_out_of_range: 'errScoreInput',
  not_under_review: 'errNotUnderReview',
  terminal: 'errTerminal',
};

/** core 抛出的错误 → 面向用户的词条键(ch09 §9.4:非法迁移映射为友好提示) */
export function toFeedback(e: unknown): ActionFeedback {
  // 授权失败要与业务失败区分开:让分会主席明白「不是操作不合法,
  // 是这篇稿子不归你管」,而不是笼统的「操作失败」。
  if (e instanceof UnauthenticatedError) {
    return { ok: false, errorKey: 'errSignInRequired' };
  }
  if (e instanceof ForbiddenError) {
    return { ok: false, errorKey: 'errNoPermission' };
  }
  if (e instanceof InvalidTransitionError) {
    return { ok: false, errorKey: 'invalidTransition', transition: { from: e.from, to: e.to } };
  }
  if (e instanceof SubmissionError) {
    return { ok: false, errorKey: CODE_TO_KEY[e.code] ?? 'actionFailed' };
  }
  console.error('征稿与评审操作失败', e);
  return { ok: false, errorKey: 'actionFailed' };
}
