'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { SUBMISSION_LABELS, type SubStatus } from '@yumeet/core/client';
import { translator, type Locale } from '@/lib/i18n';
import { authorTransitionAction } from '@/app/s/[token]/actions';
import type { ActionFeedback } from '@/app/[org]/[event]/cfp/errors';
import styles from './submission-actions.module.css';

interface Props {
  token: string;
  status: SubStatus;
  locale: Locale;
  /** 草稿续写链接(仅 draft / changes_requested 状态提供) */
  editHref: string | null;
}

/** 作者侧操作:继续编辑草稿、确认出席(accepted → confirmed)、撤回(→ withdrawn) */
export function SubmissionActions({ token, status, locale, editHref }: Props) {
  const tt = translator(locale);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const canWithdraw = status !== 'withdrawn' && status !== 'rejected';
  const canConfirm = status === 'accepted';

  const run = (to: 'withdrawn' | 'confirmed') => {
    setFeedback(null);
    startTransition(async () => {
      const res = await authorTransitionAction({ token, to });
      if (!res.ok) setFeedback(res);
    });
  };

  const label = (s: string) =>
    SUBMISSION_LABELS[s as SubStatus]?.[locale] ?? s;

  return (
    <div className={styles.wrap}>
      {feedback?.errorKey && (
        <p className={styles.error} role="alert">
          {feedback.transition
            ? tt('invalidTransition', {
                from: label(feedback.transition.from),
                to: label(feedback.transition.to),
              })
            : tt(feedback.errorKey)}
        </p>
      )}

      <div className={styles.actions}>
        {editHref && (
          <Link className={styles.primary} href={editHref}>{tt('subEditDraft')}</Link>
        )}
        {canConfirm && (
          <button
            type="button" className={styles.primary} disabled={pending}
            onClick={() => run('confirmed')}
          >
            {pending ? tt('subWithdrawing') : tt('subConfirmAttendance')}
          </button>
        )}
        {canWithdraw && (
          <button
            type="button" className={styles.danger} disabled={pending}
            onClick={() => run('withdrawn')}
          >
            {pending ? tt('subWithdrawing') : tt('subWithdraw')}
          </button>
        )}
      </div>
    </div>
  );
}
