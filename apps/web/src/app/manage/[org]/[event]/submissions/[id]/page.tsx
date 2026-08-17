import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getSubmissionDetail, decodeId, encodeId, localize,
  trackLabel, typeLabel, weightedTotal, SUBMISSION_LABELS,
  type SubStatus, type Author,
} from '@yumeet/core';
import { SubmissionDecision } from '@/components/submission-decision';
import { resolveLocale } from '@/lib/locale-server';
import { translator, INTL_LOCALE, type TKey } from '@/lib/i18n';
import styles from '../submissions.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string; id: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const metadata: Metadata = { robots: { index: false } };

/** 组织者:单篇投稿详情 —— 作者、摘要、全部评审与聚合、录用决议(ch04 §4.3) */
export default async function SubmissionDetailPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug, id } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const intl = INTL_LOCALE[locale];

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  let uuid: string;
  try { uuid = decodeId('submission', id); } catch { notFound(); }

  const detail = await getSubmissionDetail(uuid);
  if (!detail || detail.submission.eventId !== found.event.id) notFound();

  const { submission: sub, config, reviews: reviewRows, aggregate } = detail;
  const status = sub.status as SubStatus;
  const authors = (sub.authors ?? []) as Author[];
  const answers = (sub.answers ?? {}) as Record<string, unknown>;
  const track = trackLabel(sub.track);
  const type = typeLabel(sub.type);

  return (
    <div className={styles.page}>
      <Link
        className={styles.backLink}
        href={`/manage/${orgSlug}/${eventSlug}/submissions?lang=${locale}`}
      >
        ← {tt('backToSubmissions')}
      </Link>

      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{tt('submissionDetail')}</p>
          <h1 className={styles.title}>{sub.title}</h1>
          <p className={styles.meta}>
            {type ? localize(type, locale) : sub.type}
            {' · '}
            {track ? localize(track, locale) : (sub.track ?? '—')}
            {' · '}
            {SUBMISSION_LABELS[status][locale]}
          </p>
        </div>
      </header>

      <div className={styles.detailGrid}>
        <div>
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{tt('subAbstractField')}</h2>
            <p className={styles.abstract}>{sub.abstract}</p>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{tt('reviewsTitle')}</h2>

            <ul className={styles.aggregate}>
              <li className={styles.aggItem}>
                {tt('colReviews')}
                <span className={styles.aggValue}>
                  {tt('reviewsProgress', {
                    done: aggregate.completed,
                    total: Math.max(aggregate.assigned, aggregate.completed),
                  })}
                </span>
              </li>
              <li className={styles.aggItem}>
                {tt('reviewMean')}
                <span className={styles.aggValue}>{aggregate.mean ?? '—'}</span>
              </li>
              <li className={styles.aggItem}>
                {tt('reviewVariance')}
                <span className={styles.aggValue}>{aggregate.variance ?? '—'}</span>
              </li>
            </ul>
            {aggregate.disputed && <p className={styles.disputed}>{tt('reviewDisputed')}</p>}

            {reviewRows.length === 0 ? (
              <p className={styles.pending}>{tt('noReviewsYet')}</p>
            ) : (
              reviewRows.map(({ review, reviewer }) => {
                const scores = (review.scores ?? {}) as Record<string, number>;
                const total = weightedTotal(scores, config.dimensions);
                return (
                  <article key={review.id} className={styles.reviewItem}>
                    <div className={styles.reviewHead}>
                      <span className={styles.reviewer}>{reviewer.name ?? reviewer.email}</span>
                      <span className={styles.reviewMetaLine}>
                        {review.isConflict
                          ? ''
                          : review.status === 'submitted'
                            ? `${tt('totalScore')} ${total ?? '—'} · ${tt('confidenceField')} ${review.confidence ?? '—'}`
                            : tt('reviewNotSubmitted')}
                      </span>
                    </div>

                    {review.isConflict ? (
                      <p className={styles.conflictTag}>{tt('conflictDeclared')}</p>
                    ) : (
                      <>
                        {review.status === 'submitted' && (
                          <ul className={styles.scoreList}>
                            {config.dimensions.map((d) => (
                              <li key={d.key} className={styles.scoreItem}>
                                {localize(d.label, locale)}
                                <span className={styles.scoreValue}>{scores[d.key] ?? '—'}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                        {review.commentForCommittee && (
                          <div className={styles.commentBlock}>
                            <p className={styles.commentLabel}>{tt('committeeComment')}</p>
                            <p className={styles.commentBody}>{review.commentForCommittee}</p>
                          </div>
                        )}
                        {review.commentForAuthors && (
                          <div className={styles.commentBlock}>
                            <p className={styles.commentLabel}>{tt('authorComment')}</p>
                            <p className={styles.commentBody}>{review.commentForAuthors}</p>
                          </div>
                        )}
                      </>
                    )}
                  </article>
                );
              })
            )}
          </section>
        </div>

        <aside>
          <SubmissionDecision
            submissionId={encodeId('submission', sub.id)}
            status={status}
            waitlisted={sub.decisionWaitlisted}
            orgSlug={orgSlug}
            eventSlug={eventSlug}
            locale={locale}
            minReviews={config.minReviews}
          />

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{tt('colAuthors')}</h2>
            <ul className={styles.authorList}>
              {authors.map((a, i) => (
                <li key={i}>
                  {a.name}
                  {a.affiliation ? ` · ${a.affiliation}` : ''}
                  {a.email ? ` · ${a.email}` : ''}
                  {a.isPresenter && (
                    <span className={styles.presenterTag}>{tt('authorPresenterField')}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.card}>
            <h2 className={styles.cardTitle}>{tt('answersTitle')}</h2>
            <dl className={styles.dl}>
              {config.questions.map((q) => (
                <div key={q.key} className={styles.dlRow}>
                  <dt>{localize(q.label, locale)}</dt>
                  <dd>{formatAnswer(answers[q.key], tt)}</dd>
                </div>
              ))}
              <div className={styles.dlRow}>
                <dt>{tt('subNumber')}</dt>
                <dd className={styles.mono}>{encodeId('submission', sub.id)}</dd>
              </div>
              {sub.submittedAt && (
                <div className={styles.dlRow}>
                  <dt>{tt('stepSubSubmitted')}</dt>
                  <dd>
                    <time dateTime={sub.submittedAt.toISOString()}>
                      {sub.submittedAt.toLocaleDateString(intl, { dateStyle: 'medium' })}
                    </time>
                  </dd>
                </div>
              )}
              {sub.decidedAt && (
                <div className={styles.dlRow}>
                  <dt>{tt('stepSubDecision')}</dt>
                  <dd>
                    <time dateTime={sub.decidedAt.toISOString()}>
                      {sub.decidedAt.toLocaleDateString(intl, { dateStyle: 'medium' })}
                    </time>
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
}

function formatAnswer(value: unknown, tt: (key: TKey) => string): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'boolean') return value ? tt('answerYes') : tt('answerNo');
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}
