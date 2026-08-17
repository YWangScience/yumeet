import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getSubmissionByToken, SUBMISSION_LABELS, encodeId, localize,
  trackLabel, typeLabel, type SubStatus, type Author,
} from '@yumeet/core';
import { SubmissionActions } from '@/components/submission-actions';
import { formatDateRange } from '@/lib/format';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent, INTL_LOCALE, type Locale, type TKey } from '@/lib/i18n';
import styles from './submission-tracking.module.css';

export const dynamic = 'force-dynamic'; // 个人页不缓存

export const metadata: Metadata = {
  title: '投稿进度 · yuMeet',
  robots: { index: false, follow: false }, // 个人页不被索引
};

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

/** 进度条节点(ch05 §5.5:像查快递一样看进度;状态全集见 ch09 §9.4) */
const STEPS: { key: TKey; matches: SubStatus[] }[] = [
  { key: 'stepSubSubmitted', matches: ['submitted', 'under_review', 'changes_requested', 'accepted', 'confirmed', 'scheduled'] },
  { key: 'stepSubReview', matches: ['under_review', 'changes_requested', 'accepted', 'confirmed', 'scheduled'] },
  { key: 'stepSubDecision', matches: ['accepted', 'confirmed', 'scheduled'] },
  { key: 'stepSubConfirmed', matches: ['confirmed', 'scheduled'] },
  { key: 'stepSubScheduled', matches: ['scheduled'] },
];

const NEXT_ACTION: Record<SubStatus, TKey> = {
  draft: 'subNextDraft',
  submitted: 'subNextSubmitted',
  under_review: 'subNextUnderReview',
  changes_requested: 'subNextChangesRequested',
  accepted: 'subNextAccepted',
  confirmed: 'subNextConfirmed',
  scheduled: 'subNextScheduled',
  rejected: 'subNextRejected',
  withdrawn: 'subNextWithdrawn',
};

/** 投稿追踪页 /s/{token} —— 与报名追踪页 /r/{token} 同构(ch05 §5.5) */
export default async function SubmissionTrackingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const intl = INTL_LOCALE[locale];

  const data = await getSubmissionByToken(token);
  if (!data || !data.event) notFound();

  const { submission: sub, event, organization, timeline, authorFeedback } = data;
  const eventBase = `/${organization?.slug ?? ''}/${event.slug}`;
  const content = eventContent(event, locale);
  const status = sub.status as SubStatus;
  const label = SUBMISSION_LABELS[status];
  const isNegative = status === 'rejected' || status === 'withdrawn';
  const activeIndex = STEPS.reduce(
    (acc, s, i) => (s.matches.includes(status) ? i : acc), -1);

  const authors = (sub.authors ?? []) as Author[];
  const track = trackLabel(sub.track);
  const type = typeLabel(sub.type);
  const editable = status === 'draft' || status === 'changes_requested';

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>{tt('subTrackingEyebrow')}</p>
      <h1 className={styles.title}>{sub.title}</h1>
      <p className={styles.meta}>
        {content.title}
        {' · '}
        {formatDateRange(event.startsAt, event.endsAt, event.timezone, intl)}
      </p>

      <section className={`${styles.statusCard} ${isNegative ? styles.statusNegative : ''}`}>
        <div className={styles.statusHead}>
          <span className={`${styles.statusBadge} ${styles[`badge_${status}`] ?? ''}`}>
            {locale === 'zh' ? label.zh : label.en}
          </span>
          {sub.decisionWaitlisted && (
            <span className={styles.waitlistBadge}>{tt('subWaitlistBadge')}</span>
          )}
          <span className={styles.statusEn}>{locale === 'zh' ? label.en : ''}</span>
        </div>

        {!isNegative && (
          <ol className={styles.progress} aria-label={tt('subTrackingEyebrow')}>
            {STEPS.map((s, i) => {
              const done = i <= activeIndex;
              const current = i === activeIndex;
              return (
                <li
                  key={s.key}
                  className={`${styles.step} ${done ? styles.stepDone : ''} ${current ? styles.stepCurrent : ''}`}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className={styles.stepDot} aria-hidden="true" />
                  <span className={styles.stepLabel}>{tt(s.key)}</span>
                </li>
              );
            })}
          </ol>
        )}

        <p className={styles.nextAction}>{tt(NEXT_ACTION[status])}</p>

        {sub.decisionWaitlisted && (
          <p className={styles.waitlistNote}>{tt('subWaitlistBody')}</p>
        )}
      </section>

      <section className={styles.detailCard}>
        <h2 className={styles.sectionTitle}>{tt('subDetails')}</h2>
        <dl className={styles.details}>
          <div className={styles.row}>
            <dt>{tt('subTypeField')}</dt>
            <dd>{type ? localize(type, locale) : sub.type}</dd>
          </div>
          <div className={styles.row}>
            <dt>{tt('subTrackField')}</dt>
            <dd>{track ? localize(track, locale) : (sub.track ?? '—')}</dd>
          </div>
          <div className={styles.row}>
            <dt>{tt('subAuthorsField')}</dt>
            <dd>
              <ul className={styles.authorList}>
                {authors.map((a, i) => (
                  <li key={i}>
                    {a.name}
                    {a.affiliation ? ` · ${a.affiliation}` : ''}
                    {a.isPresenter && (
                      <span className={styles.presenterTag}>{tt('authorPresenterField')}</span>
                    )}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
          <div className={styles.row}>
            <dt>{tt('subNumber')}</dt>
            <dd className={styles.mono}>{encodeId('submission', sub.id)}</dd>
          </div>
        </dl>
      </section>

      {authorFeedback.length > 0 && (
        <section className={styles.detailCard}>
          <h2 className={styles.sectionTitle}>{tt('subFeedbackTitle')}</h2>
          <p className={styles.feedbackHint}>{tt('subFeedbackHint')}</p>
          <ol className={styles.feedbackList}>
            {authorFeedback.map((c, i) => (
              <li key={i} className={styles.feedbackItem}>{c}</li>
            ))}
          </ol>
        </section>
      )}

      {timeline.length > 0 && (
        <section className={styles.detailCard}>
          <h2 className={styles.sectionTitle}>{tt('statusHistory')}</h2>
          <ol className={styles.timeline}>
            {timeline.map((t, i) => (
              <li key={i} className={styles.timelineItem}>
                <time className={styles.timelineTime} dateTime={t.createdAt.toISOString()}>
                  {t.createdAt.toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
                <span className={styles.timelineAction}>{describeAction(t.action, locale)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <SubmissionActions
        token={token}
        status={status}
        locale={locale}
        editHref={editable
          ? `${eventBase}/cfp/submit?draft=${encodeURIComponent(token)}&lang=${locale}`
          : null}
      />

      <div className={styles.actions}>
        <Link className={styles.buttonSecondary} href={`${eventBase}?lang=${locale}`}>
          {tt('backToEvent')}
        </Link>
      </div>

      <p className={styles.footnote}>{tt('subTrackingFootnote')}</p>
    </main>
  );
}

/** 审计日志 action → 双语文案(投稿状态名直接复用 SUBMISSION_LABELS) */
function describeAction(action: string, locale: Locale): string {
  const tt = translator(locale);
  if (action === 'submission.draft') return tt('timelineDraftCreated');
  if (action === 'submission.reviewers_assigned') return tt('timelineReviewersAssigned');
  const status = action.startsWith('submission.') ? action.slice('submission.'.length) : '';
  const label = SUBMISSION_LABELS[status as SubStatus];
  return label ? label[locale] : action;
}
