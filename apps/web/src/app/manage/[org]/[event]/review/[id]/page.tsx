import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getCfpConfig, listEventReviewers, getReviewerTask,
  decodeId, encodeId, localize, trackLabel, typeLabel,
} from '@yumeet/core';
import { SubmissionReviewForm } from '@/components/submission-review-form';
import { resolveLocale } from '@/lib/locale-server';
import { translator, type TKey } from '@/lib/i18n';
import styles from '../review.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string; id: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const metadata: Metadata = { robots: { index: false } };

/**
 * 审稿人:评分表(ch04 §4.3)。
 * 双盲 —— 页面数据只来自 getReviewerTask(),其返回的视图里根本没有 authors 字段。
 */
export default async function ReviewFormPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug, id } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();
  const { event } = found;
  const config = getCfpConfig(event);

  const reviewers = await listEventReviewers(event.id);
  const me = reviewers[0];
  if (!me) notFound();

  let uuid: string;
  try { uuid = decodeId('submission', id); } catch { notFound(); }

  const task = await getReviewerTask(uuid, me.id);
  if (!task || task.submission.eventId !== event.id) notFound();

  const { submission, review } = task;
  const track = trackLabel(submission.track);
  const type = typeLabel(submission.type);

  return (
    <div className={styles.page}>
      <Link
        className={styles.backLink}
        href={`/manage/${orgSlug}/${eventSlug}/review?lang=${locale}`}
      >
        ← {tt('myReviews')}
      </Link>

      <h1 className={styles.title}>{tt('reviewFormTitle')}</h1>
      <p className={styles.meta}>{tt('actingAs', { name: me.name ?? me.email })}</p>

      <p className={styles.blindBanner} role="note">{tt('blindNotice')}</p>

      <article className={styles.paperCard}>
        <h2 className={styles.paperTitle}>{submission.title}</h2>
        <p className={styles.paperMeta}>
          {type ? localize(type, locale) : submission.type}
          {' · '}
          {track ? localize(track, locale) : (submission.track ?? '—')}
          {' · '}
          <span className={styles.mono}>{submission.publicId}</span>
        </p>
        <p className={styles.paperAbstract}>{submission.abstract}</p>

        <dl className={styles.answerList}>
          {config.questions
            .filter((q) => q.key !== 'blind_ready')
            .map((q) => (
              <div key={q.key} className={styles.answerRow}>
                <dt>{localize(q.label, locale)}</dt>
                <dd>{formatAnswer(submission.answers[q.key], tt)}</dd>
              </div>
            ))}
        </dl>
      </article>

      <SubmissionReviewForm
        orgSlug={orgSlug}
        eventSlug={eventSlug}
        submissionId={submission.publicId}
        locale={locale}
        dimensions={config.dimensions.map((d) => ({
          key: d.key,
          label: localize(d.label, locale),
          min: d.min,
          max: d.max,
          weight: d.weight,
        }))}
        initial={{
          scores: review.scores,
          confidence: review.confidence,
          commentForCommittee: review.commentForCommittee ?? '',
          commentForAuthors: review.commentForAuthors ?? '',
          isConflict: review.isConflict,
        }}
      />
    </div>
  );
}

function formatAnswer(value: unknown, tt: (key: TKey) => string): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? tt('answerYes') : tt('answerNo');
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}
