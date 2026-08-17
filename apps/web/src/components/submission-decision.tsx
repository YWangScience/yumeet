'use client';

import { useState, useTransition } from 'react';
import { SUBMISSION_FLOW, SUBMISSION_LABELS, type SubStatus } from '@yumeet/core/client';
import { translator, type Locale } from '@/lib/i18n';
import {
  decideSubmissionAction, transitionSubmissionAction,
} from '@/app/manage/[org]/[event]/submissions/actions';
import type { ActionFeedback } from '@/app/[org]/[event]/cfp/errors';
import styles from './submission-decision.module.css';

interface Props {
  submissionId: string; // 对外 ID(sub_…)
  status: SubStatus;
  waitlisted: boolean;
  orgSlug: string;
  eventSlug: string;
  locale: Locale;
  minReviews: number;
}

/** 录用决议面板(ch04 §4.3):accepted / accepted+waitlist / rejected / changes_requested */
export function SubmissionDecision({
  submissionId, status, waitlisted, orgSlug, eventSlug, locale, minReviews,
}: Props) {
  const tt = translator(locale);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const label = (s: string) => SUBMISSION_LABELS[s as SubStatus]?.[locale] ?? s;
  const allowed = SUBMISSION_FLOW[status];
  const isTerminal = allowed.length === 0;

  const message = (f: ActionFeedback): string => {
    if (!f.errorKey) return tt('saved');
    return f.transition
      ? tt('invalidTransition', { from: label(f.transition.from), to: label(f.transition.to) })
      : tt(f.errorKey);
  };

  const decide = (decision: 'accepted' | 'rejected', wl = false) => {
    setFeedback(null);
    startTransition(async () => {
      setFeedback(await decideSubmissionAction({
        submissionId, decision, waitlisted: wl, orgSlug, eventSlug,
      }));
    });
  };

  const move = (to: 'changes_requested' | 'under_review' | 'withdrawn') => {
    setFeedback(null);
    startTransition(async () => {
      setFeedback(await transitionSubmissionAction({ submissionId, to, orgSlug, eventSlug }));
    });
  };

  return (
    <section className={styles.panel} aria-labelledby="decision-title">
      <h2 className={styles.title} id="decision-title">{tt('decisionTitle')}</h2>

      <p className={styles.currentStatus}>
        {tt('status')}
        {': '}
        <span className={styles.statusValue}>{label(status)}</span>
        {waitlisted && <span className={styles.waitlist}>{tt('subWaitlistBadge')}</span>}
      </p>

      {isTerminal ? (
        <p className={styles.hint}>{tt('terminalState')}</p>
      ) : (
        <div className={styles.actions}>
          {allowed.includes('accepted') && (
            <>
              <button
                type="button" className={styles.primary} disabled={pending}
                onClick={() => decide('accepted')}
              >
                {tt('decisionAccept')}
              </button>
              <button
                type="button" className={styles.button} disabled={pending}
                onClick={() => decide('accepted', true)}
              >
                {tt('decisionWaitlist')}
              </button>
            </>
          )}
          {allowed.includes('changes_requested') && (
            <button
              type="button" className={styles.button} disabled={pending}
              onClick={() => move('changes_requested')}
            >
              {tt('decisionRequestChanges')}
            </button>
          )}
          {allowed.includes('under_review') && (
            <button
              type="button" className={styles.button} disabled={pending}
              onClick={() => move('under_review')}
            >
              {label('under_review')}
            </button>
          )}
          {allowed.includes('rejected') && (
            <button
              type="button" className={styles.danger} disabled={pending}
              onClick={() => decide('rejected')}
            >
              {tt('decisionReject')}
            </button>
          )}
        </div>
      )}

      <p className={styles.hint}>{tt('decisionHint', { n: minReviews })}</p>
      <p className={styles.feedback} role="status">{feedback ? message(feedback) : ''}</p>
    </section>
  );
}
