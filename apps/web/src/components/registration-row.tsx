'use client';

import { useState, useTransition } from 'react';
import { REGISTRATION_LABELS, REGISTRATION_FLOW, type RegStatus } from '@yumeet/core/client';
import { transitionRegistrationAction } from '@/app/manage/[org]/[event]/actions';
import styles from './registration-row.module.css';

interface Props {
  registration: {
    id: string;
    publicId: string;
    email: string;
    answers: Record<string, unknown>;
    confirmationCode: string;
    status: RegStatus;
    ticketName: string;
  };
  orgSlug: string;
  eventSlug: string;
}

/** 组织者可主动触发的迁移(排除仅由系统/支付回调驱动的) */
const ACTIONABLE: Partial<Record<RegStatus, RegStatus[]>> = {
  pending_review: ['confirmed', 'rejected'],
  awaiting_payment: ['confirmed', 'cancelled'],
  waitlisted: ['confirmed', 'cancelled'],
  confirmed: ['checked_in', 'cancelled'],
};

const ACTION_LABEL: Record<string, string> = {
  confirmed: '确认',
  rejected: '拒绝',
  cancelled: '取消',
  checked_in: '签到',
};

function displayName(answers: Record<string, unknown>): string {
  const n = answers['full_name'];
  return typeof n === 'string' && n ? n : '—';
}

function affiliation(answers: Record<string, unknown>): string {
  const a = answers['affiliation'];
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object' && 'name' in a) return String((a as { name: unknown }).name);
  return '—';
}

export function RegistrationRow({ registration: r, orgSlug, eventSlug }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const actions = ACTIONABLE[r.status] ?? [];

  const run = (to: RegStatus) => {
    setError(null);
    startTransition(async () => {
      const res = await transitionRegistrationAction({
        registrationId: r.id, to, orgSlug, eventSlug,
      });
      if (!res.ok) setError(res.error ?? '操作失败');
    });
  };

  return (
    <tr className={pending ? styles.rowPending : undefined}>
      <td>
        <span className={styles.name}>{displayName(r.answers)}</span>
        <span className={styles.email}>{r.email}</span>
        {error && <span className={styles.error} role="alert">{error}</span>}
      </td>
      <td className={styles.muted}>{affiliation(r.answers)}</td>
      <td className={styles.muted}>{r.ticketName}</td>
      <td className={styles.code}>{r.confirmationCode}</td>
      <td>
        <span className={`${styles.badge} ${styles[`badge_${r.status}`] ?? ''}`}>
          {REGISTRATION_LABELS[r.status].zh}
        </span>
      </td>
      <td>
        <div className={styles.actions}>
          {actions.map((to) => (
            <button
              key={to}
              type="button"
              className={`${styles.action} ${to === 'rejected' || to === 'cancelled' ? styles.actionDanger : ''}`}
              onClick={() => run(to)}
              disabled={pending}
            >
              {ACTION_LABEL[to] ?? to}
            </button>
          ))}
          {actions.length === 0 && <span className={styles.terminal}>终态</span>}
        </div>
      </td>
    </tr>
  );
}
