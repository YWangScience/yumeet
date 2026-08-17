'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { SUBMISSION_LABELS, type SubStatus } from '@yumeet/core/client';
import { translator, type Locale } from '@/lib/i18n';
import {
  assignReviewersAction, decideSubmissionAction, transitionSubmissionAction,
} from '@/app/manage/[org]/[event]/submissions/actions';
import type { ActionFeedback } from '@/app/[org]/[event]/cfp/errors';
import styles from './submission-table.module.css';

export interface SubmissionRow {
  publicId: string;
  title: string;
  typeLabel: string;
  trackLabel: string;
  authorCount: number;
  status: SubStatus;
  reviews: {
    completed: number;
    assigned: number;
    mean: number | null;
    variance: number | null;
    disputed: boolean;
  };
}

interface Props {
  rows: SubmissionRow[];
  reviewers: { publicId: string; name: string }[];
  orgSlug: string;
  eventSlug: string;
  locale: Locale;
  minReviews: number;
}

/**
 * 组织者投稿列表(ch04 §4.3):勾选 → 批量分配审稿人(自动跳过利益冲突)→ 录用决议。
 * 所有状态变更都经 Server Action 调用 core 的 transitionSubmission()(ch09 §9.4)。
 */
export function SubmissionTable({
  rows, reviewers, orgSlug, eventSlug, locale, minReviews,
}: Props) {
  const tt = translator(locale);
  const [selected, setSelected] = useState<string[]>([]);
  const [chosenReviewers, setChosenReviewers] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const allSelected = rows.length > 0 && selected.length === rows.length;

  const label = (s: string) => SUBMISSION_LABELS[s as SubStatus]?.[locale] ?? s;

  const message = (f: ActionFeedback): string => {
    if (f.errorKey) {
      return f.transition
        ? tt('invalidTransition', {
            from: label(f.transition.from), to: label(f.transition.to),
          })
        : tt(f.errorKey);
    }
    if (f.noticeKey) {
      const base = tt(f.noticeKey, { n: f.vars?.['n'] ?? 0 });
      return f.skipped ? `${base} ${tt('assignSkipped', { n: f.skipped })}` : base;
    }
    return tt('saved');
  };

  const assign = () => {
    setFeedback(null);
    startTransition(async () => {
      setFeedback(await assignReviewersAction({
        submissionIds: selected,
        reviewerIds: chosenReviewers,
        orgSlug,
        eventSlug,
      }));
      setSelected([]);
    });
  };

  const decide = (publicId: string, decision: 'accepted' | 'rejected', waitlisted = false) => {
    setFeedback(null);
    startTransition(async () => {
      setFeedback(await decideSubmissionAction({
        submissionId: publicId, decision, waitlisted, orgSlug, eventSlug,
      }));
    });
  };

  const requestChanges = (publicId: string) => {
    setFeedback(null);
    startTransition(async () => {
      setFeedback(await transitionSubmissionAction({
        submissionId: publicId, to: 'changes_requested', orgSlug, eventSlug,
      }));
    });
  };

  return (
    <div>
      <section className={styles.assignPanel} aria-labelledby="assign-panel-title">
        <h3 className={styles.panelTitle} id="assign-panel-title">{tt('bulkAssignTitle')}</h3>
        <p className={styles.panelHint}>{tt('bulkAssignHint')}</p>

        <fieldset className={styles.reviewerSet}>
          <legend className={styles.reviewerLegend}>{tt('reviewerField')}</legend>
          {reviewers.map((r) => (
            <label key={r.publicId} className={styles.checkLabel}>
              <input
                type="checkbox"
                checked={chosenReviewers.includes(r.publicId)}
                onChange={() => setChosenReviewers((prev) => toggle(prev, r.publicId))}
              />
              <span>{r.name}</span>
            </label>
          ))}
        </fieldset>

        <button
          type="button"
          className={styles.assignButton}
          onClick={assign}
          disabled={pending}
        >
          {tt('assignAction', { n: selected.length })}
        </button>

        <p className={styles.feedback} role="status">
          {feedback ? message(feedback) : ''}
        </p>
      </section>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col" className={styles.checkCol}>
                <input
                  type="checkbox"
                  aria-label={tt('selectAllSubmissions')}
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? [] : rows.map((r) => r.publicId))}
                />
              </th>
              <th scope="col">{tt('colTitle')}</th>
              <th scope="col">{tt('colType')}</th>
              <th scope="col">{tt('colTrack')}</th>
              <th scope="col">{tt('colAuthors')}</th>
              <th scope="col">{tt('colReviews')}</th>
              <th scope="col">{tt('status')}</th>
              <th scope="col">{tt('colActions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.publicId}>
                <td className={styles.checkCol}>
                  <input
                    type="checkbox"
                    aria-label={tt('selectSubmission', { title: r.title })}
                    checked={selected.includes(r.publicId)}
                    onChange={() => setSelected((prev) => toggle(prev, r.publicId))}
                  />
                </td>
                <td>
                  <Link
                    className={styles.titleLink}
                    href={`/manage/${orgSlug}/${eventSlug}/submissions/${r.publicId}?lang=${locale}`}
                  >
                    {r.title}
                  </Link>
                </td>
                <td className={styles.muted}>{r.typeLabel}</td>
                <td className={styles.muted}>{r.trackLabel}</td>
                <td className={styles.num}>{r.authorCount}</td>
                <td>
                  <span className={styles.num}>
                    {tt('reviewsProgress', {
                      done: r.reviews.completed, total: Math.max(r.reviews.assigned, r.reviews.completed),
                    })}
                  </span>
                  {r.reviews.mean != null && (
                    <span className={styles.score}>
                      {tt('reviewMean')} {r.reviews.mean.toFixed(1)}
                    </span>
                  )}
                  {r.reviews.disputed && (
                    <span className={styles.disputed}>{tt('reviewDisputed')}</span>
                  )}
                </td>
                <td>
                  <span className={`${styles.badge} ${styles[`badge_${r.status}`] ?? ''}`}>
                    {label(r.status)}
                  </span>
                </td>
                <td>
                  <div className={styles.actions}>
                    {r.status === 'under_review' && (
                      <>
                        <button
                          type="button" className={styles.action} disabled={pending}
                          onClick={() => decide(r.publicId, 'accepted')}
                        >
                          {tt('decisionAccept')}
                        </button>
                        <button
                          type="button" className={styles.action} disabled={pending}
                          onClick={() => decide(r.publicId, 'accepted', true)}
                        >
                          {tt('decisionWaitlist')}
                        </button>
                        <button
                          type="button" className={styles.action} disabled={pending}
                          onClick={() => requestChanges(r.publicId)}
                        >
                          {tt('decisionRequestChanges')}
                        </button>
                        <button
                          type="button" className={`${styles.action} ${styles.actionDanger}`}
                          disabled={pending}
                          onClick={() => decide(r.publicId, 'rejected')}
                        >
                          {tt('decisionReject')}
                        </button>
                      </>
                    )}
                    <Link
                      className={styles.action}
                      href={`/manage/${orgSlug}/${eventSlug}/submissions/${r.publicId}?lang=${locale}`}
                    >
                      {tt('viewDetail')}
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.tableHint}>{tt('decisionHint', { n: minReviews })}</p>
    </div>
  );
}
