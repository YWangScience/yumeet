'use client';

import { useActionState, useState } from 'react';
import { translator, type Locale } from '@/lib/i18n';
import { saveReviewAction } from '@/app/manage/[org]/[event]/review/actions';
import type { ActionFeedback } from '@/app/[org]/[event]/cfp/errors';
import styles from './submission-review-form.module.css';

export interface DimensionView {
  key: string;
  label: string;
  min: number;
  max: number;
  weight: number;
}

interface Props {
  orgSlug: string;
  eventSlug: string;
  submissionId: string; // sub_…
  locale: Locale;
  dimensions: DimensionView[];
  initial: {
    scores: Record<string, number>;
    confidence: number | null;
    commentForCommittee: string;
    commentForAuthors: string;
    isConflict: boolean;
  };
}

const range = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, i) => min + i);

/**
 * 评分表(ch04 §4.3):多维度量表 + confidence 1–5 + 给委员会/给作者的意见 + 自报利益冲突。
 * 量表用单选按钮而非滑块 —— 键盘可达、屏幕阅读器可读出当前值。
 */
export function SubmissionReviewForm({
  orgSlug, eventSlug, submissionId, locale, dimensions, initial,
}: Props) {
  const tt = translator(locale);
  const [state, action, pending] = useActionState<ActionFeedback, FormData>(
    saveReviewAction,
    { ok: false },
  );
  const [conflict, setConflict] = useState(initial.isConflict);

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="__org" value={orgSlug} />
      <input type="hidden" name="__event" value={eventSlug} />
      <input type="hidden" name="__submission" value={submissionId} />

      {state.errorKey && (
        <p className={styles.formError} role="alert">{tt(state.errorKey)}</p>
      )}
      {state.ok && state.noticeKey && (
        <p className={styles.formOk} role="status">{tt(state.noticeKey)}</p>
      )}

      <fieldset className={styles.fieldset} disabled={conflict}>
        <legend className={styles.legend}>{tt('scoresLegend')}</legend>

        {dimensions.map((d) => (
          <fieldset key={d.key} className={styles.scaleSet}>
            <legend className={styles.scaleLegend}>
              {d.label}
              <span className={styles.scaleRange}>{d.min} … {d.max}</span>
            </legend>
            <div className={styles.scale}>
              {range(d.min, d.max).map((v) => (
                <label key={v} className={styles.scaleOption}>
                  <input
                    type="radio"
                    name={`score_${d.key}`}
                    value={v}
                    defaultChecked={initial.scores[d.key] === v}
                  />
                  <span>{v}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}

        <fieldset className={styles.scaleSet}>
          <legend className={styles.scaleLegend}>
            {tt('confidenceField')}
            <span className={styles.scaleRange}>1 … 5</span>
          </legend>
          <div className={styles.scale}>
            {range(1, 5).map((v) => (
              <label key={v} className={styles.scaleOption}>
                <input
                  type="radio" name="confidence" value={v}
                  defaultChecked={initial.confidence === v}
                />
                <span>{v}</span>
              </label>
            ))}
          </div>
          <p className={styles.help}>{tt('confidenceHelp')}</p>
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="comment_committee">
            {tt('committeeComment')}
          </label>
          <textarea
            id="comment_committee" name="comment_committee" rows={4}
            className={styles.textarea} defaultValue={initial.commentForCommittee}
            aria-describedby="comment_committee_help"
          />
          <p id="comment_committee_help" className={styles.help}>{tt('committeeCommentHelp')}</p>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="comment_authors">
            {tt('authorComment')}
          </label>
          <textarea
            id="comment_authors" name="comment_authors" rows={4}
            className={styles.textarea} defaultValue={initial.commentForAuthors}
            aria-describedby="comment_authors_help"
          />
          <p id="comment_authors_help" className={styles.help}>{tt('authorCommentHelp')}</p>
        </div>
      </fieldset>

      <div className={styles.conflictBox}>
        <label className={styles.checkLabel} htmlFor="conflict">
          <input
            id="conflict" name="conflict" type="checkbox"
            checked={conflict}
            onChange={(e) => setConflict(e.target.checked)}
            aria-describedby="conflict_help"
          />
          <span>{tt('declareConflict')}</span>
        </label>
        <p id="conflict_help" className={styles.help}>{tt('conflictHelp')}</p>
      </div>

      <div className={styles.submitRow}>
        <button
          type="submit" name="__intent" value="submit"
          className={styles.submit} disabled={pending || conflict}
        >
          {tt('submitReview')}
        </button>
        <button
          type="submit" name="__intent" value="draft"
          className={styles.secondary} disabled={pending}
        >
          {pending ? tt('savingDraft') : tt('saveDraft')}
        </button>
      </div>
    </form>
  );
}
