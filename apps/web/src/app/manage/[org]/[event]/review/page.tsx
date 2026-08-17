import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getCfpConfig, listEventReviewers, listReviewerTasks,
  encodeId, localize, trackLabel, typeLabel,
} from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import styles from './review.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `我的评审 · ${found.event.title}` : '我的评审', robots: { index: false } };
}

const REVIEW_STATUS_KEY = {
  assigned: 'reviewStatusAssigned',
  draft: 'reviewStatusDraft',
  submitted: 'reviewStatusSubmitted',
} as const;

/**
 * 审稿人:我的评审任务(ch04 §4.3)。
 * 双盲 —— 列表数据来自 core 的 listReviewerTasks(),authors 列在服务端即被裁剪。
 * M1 尚未接入登录,取活动的第一位 reviewer 成员作为当前身份。
 */
export default async function ReviewTasksPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();
  const { event } = found;
  const config = getCfpConfig(event);

  const reviewers = await listEventReviewers(event.id);
  const me = reviewers[0];
  const tasks = me ? await listReviewerTasks(event.id, me.id) : [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{tt('mgSubEyebrow')}</p>
          <h1 className={styles.title}>{tt('myReviews')}</h1>
          <p className={styles.meta}>{event.title}</p>
        </div>
        <Link
          className={styles.headerLink}
          href={`/manage/${orgSlug}/${eventSlug}/submissions?lang=${locale}`}
        >
          {tt('mgSubmissions')}
        </Link>
      </header>

      <p className={styles.lede}>{tt('myReviewsLede')}</p>
      {me && (
        <p className={styles.actingAs} role="status">
          {tt('actingAs', { name: me.name ?? me.email })}
        </p>
      )}

      {tasks.length === 0 ? (
        <p className={styles.empty}>{tt('reviewTasksEmpty')}</p>
      ) : (
        <ul className={styles.taskList}>
          {tasks.map(({ submission, review }) => {
            const track = trackLabel(submission.track);
            const type = typeLabel(submission.type);
            return (
              <li key={submission.publicId} className={styles.task}>
                <div className={styles.taskHead}>
                  <h2 className={styles.taskTitle}>{submission.title}</h2>
                  <span className={`${styles.badge} ${styles[`badge_${review.status}`] ?? ''}`}>
                    {tt(REVIEW_STATUS_KEY[review.status])}
                  </span>
                </div>
                <p className={styles.taskMeta}>
                  {type ? localize(type, locale) : submission.type}
                  {' · '}
                  {track ? localize(track, locale) : (submission.track ?? '—')}
                  {' · '}
                  <span className={styles.mono}>{submission.publicId}</span>
                </p>
                <p className={styles.taskAbstract}>{submission.abstract.slice(0, 220)}…</p>
                <Link
                  className={styles.taskCta}
                  href={`/manage/${orgSlug}/${eventSlug}/review/${submission.publicId}?lang=${locale}`}
                >
                  {review.status === 'assigned' ? tt('openReview') : tt('continueReview')}
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <p className={styles.footnote}>
        {tt('blindNotice')}
        {' '}
        {tt('decisionHint', { n: config.minReviews })}
      </p>
    </div>
  );
}
