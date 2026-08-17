/**
 * 状态机(ch09 §9.4 —— 全文档唯一事实源)
 * 数据库不使用触发器;所有状态变更必须经过 transition():
 * 先查迁移表校验合法性,再在同一事务内更新行 + 写审计,最后经 outbox 投递副作用。
 */

export type RegStatus =
  | 'pending_review'
  | 'waitlisted'
  | 'awaiting_payment'
  | 'confirmed'
  | 'checked_in'
  | 'rejected'
  | 'cancelled'
  | 'expired';

export type SubStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'changes_requested'
  | 'accepted'
  | 'confirmed'
  | 'scheduled'
  | 'rejected'
  | 'withdrawn';

export type OrderStatus =
  | 'pending'
  | 'paid'
  | 'partially_refunded'
  | 'refunded'
  | 'cancelled'
  | 'expired';

/** 注册状态机迁移表(ch09 §9.4)。目标为空数组者为终态。 */
export const REGISTRATION_FLOW: Record<RegStatus, readonly RegStatus[]> = {
  pending_review: ['awaiting_payment', 'confirmed', 'rejected', 'cancelled'],
  waitlisted: ['awaiting_payment', 'confirmed', 'cancelled', 'expired'],
  awaiting_payment: ['confirmed', 'expired', 'cancelled'],
  confirmed: ['checked_in', 'cancelled'],
  checked_in: [],
  rejected: [],
  cancelled: [],
  expired: [],
};

/** 投稿状态机迁移表(ch09 §9.4)。withdrawn 可从任意非终态触发。 */
export const SUBMISSION_FLOW: Record<SubStatus, readonly SubStatus[]> = {
  draft: ['submitted', 'withdrawn'],
  submitted: ['draft', 'under_review', 'withdrawn'],
  under_review: ['changes_requested', 'accepted', 'rejected', 'withdrawn'],
  changes_requested: ['under_review', 'withdrawn'],
  accepted: ['confirmed', 'withdrawn'],
  confirmed: ['scheduled', 'withdrawn'],
  scheduled: ['withdrawn'],
  rejected: [],
  withdrawn: [],
};

export const ORDER_FLOW: Record<OrderStatus, readonly OrderStatus[]> = {
  pending: ['paid', 'cancelled', 'expired'],
  paid: ['partially_refunded', 'refunded'],
  partially_refunded: ['refunded'],
  refunded: [],
  cancelled: [],
  expired: [],
};

export class InvalidTransitionError extends Error {
  readonly from: string;
  readonly to: string;
  /** API 层映射为 HTTP 409(ch09 §9.4) */
  readonly httpStatus = 409;

  constructor(from: string, to: string) {
    super(`非法状态迁移:${from} → ${to}`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.to = to;
  }
}

export function canTransitionRegistration(from: RegStatus, to: RegStatus): boolean {
  return REGISTRATION_FLOW[from].includes(to);
}

export function canTransitionSubmission(from: SubStatus, to: SubStatus): boolean {
  return SUBMISSION_FLOW[from].includes(to);
}

export function assertRegistrationTransition(from: RegStatus, to: RegStatus): void {
  if (!canTransitionRegistration(from, to)) throw new InvalidTransitionError(from, to);
}

export function assertSubmissionTransition(from: SubStatus, to: SubStatus): void {
  if (!canTransitionSubmission(from, to)) throw new InvalidTransitionError(from, to);
}

export const isTerminalRegistration = (s: RegStatus) => REGISTRATION_FLOW[s].length === 0;
export const isTerminalSubmission = (s: SubStatus) => SUBMISSION_FLOW[s].length === 0;

/** 面向参会者的状态文案(状态透明原则:追踪页「像查快递」) */
export const REGISTRATION_LABELS: Record<RegStatus, { zh: string; en: string }> = {
  pending_review: { zh: '审核中', en: 'Under review' },
  waitlisted: { zh: '候补中', en: 'Waitlisted' },
  awaiting_payment: { zh: '待支付', en: 'Awaiting payment' },
  confirmed: { zh: '已确认', en: 'Confirmed' },
  checked_in: { zh: '已签到', en: 'Checked in' },
  rejected: { zh: '未通过', en: 'Not accepted' },
  cancelled: { zh: '已取消', en: 'Cancelled' },
  expired: { zh: '已过期', en: 'Expired' },
};

export const SUBMISSION_LABELS: Record<SubStatus, { zh: string; en: string }> = {
  draft: { zh: '草稿', en: 'Draft' },
  submitted: { zh: '已提交', en: 'Submitted' },
  under_review: { zh: '评审中', en: 'Under review' },
  changes_requested: { zh: '待修改', en: 'Changes requested' },
  accepted: { zh: '已录用', en: 'Accepted' },
  confirmed: { zh: '已确认出席', en: 'Attendance confirmed' },
  scheduled: { zh: '已排期', en: 'Scheduled' },
  rejected: { zh: '未录用', en: 'Not accepted' },
  withdrawn: { zh: '已撤回', en: 'Withdrawn' },
};
