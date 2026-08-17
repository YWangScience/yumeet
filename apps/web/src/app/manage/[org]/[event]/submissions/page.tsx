import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getCfpConfig, listSubmissions, submissionStats, reviewProgress,
  listEventReviewers, encodeId, localize, trackLabel, typeLabel,
  SUBMISSION_LABELS, type SubStatus, type Author,
} from '@yumeet/core';
import { SubmissionTable, type SubmissionRow } from '@/components/submission-table';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import styles from './submissions.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ status?: string; lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `投稿管理 · ${found.event.title}` : '投稿管理', robots: { index: false } };
}

const STAT_ORDER: SubStatus[] = [
  'draft', 'submitted', 'under_review', 'changes_requested',
  'accepted', 'confirmed', 'scheduled', 'rejected', 'withdrawn',
];

/** 组织者:投稿列表 + 批量分配审稿人 + 录用决议(ch04 §4.3) */
export default async function ManageSubmissionsPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();
  const { event } = found;
  const config = getCfpConfig(event);

  const filter = STAT_ORDER.includes(sp.status as SubStatus)
    ? (sp.status as SubStatus)
    : undefined;

  const [stats, list, reviewers] = await Promise.all([
    submissionStats(event.id),
    listSubmissions(event.id, { status: filter, limit: 50 }),
    listEventReviewers(event.id),
  ]);
  const progress = await reviewProgress(list.rows.map((r) => r.id), config);

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const langQuery = `lang=${locale}`;

  const rows: SubmissionRow[] = list.rows.map((r) => {
    const track = trackLabel(r.track);
    const type = typeLabel(r.type);
    return {
      publicId: encodeId('submission', r.id),
      title: r.title,
      typeLabel: type ? localize(type, locale) : r.type,
      trackLabel: track ? localize(track, locale) : (r.track ?? '—'),
      authorCount: ((r.authors ?? []) as Author[]).length,
      status: r.status as SubStatus,
      reviews: progress[r.id] ?? {
        completed: 0, assigned: 0, mean: null, variance: null, disputed: false,
      },
    };
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{tt('mgSubEyebrow')}</p>
          <h1 className={styles.title}>{tt('mgSubmissions')}</h1>
          <p className={styles.meta}>{event.title}</p>
        </div>
        <div className={styles.headerLinks}>
          <Link className={styles.headerLink} href={`/manage/${orgSlug}/${eventSlug}/review?${langQuery}`}>
            {tt('myReviews')}
          </Link>
          <Link className={styles.headerLink} href={`/${orgSlug}/${eventSlug}/cfp?${langQuery}`}>
            {tt('cfpTitle')}
          </Link>
        </div>
      </header>

      <section className={styles.kpis} aria-label={tt('mgSubmissions')}>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{tt('mgSubTotal')}</span>
          <span className={styles.kpiValue}>{total}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{tt('mgSubToAssign')}</span>
          <span className={styles.kpiValue}>{stats['submitted'] ?? 0}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{tt('mgSubInReview')}</span>
          <span className={styles.kpiValue}>{stats['under_review'] ?? 0}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>{tt('mgSubAccepted')}</span>
          <span className={styles.kpiValue}>
            {(stats['accepted'] ?? 0) + (stats['confirmed'] ?? 0) + (stats['scheduled'] ?? 0)}
          </span>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{tt('mgSubList')}</h2>

        <nav className={styles.filters} aria-label={tt('status')}>
          <Link
            className={`${styles.filter} ${!filter ? styles.filterActive : ''}`}
            href={`/manage/${orgSlug}/${eventSlug}/submissions?${langQuery}`}
          >
            {tt('filterAll')} <span className={styles.filterCount}>{total}</span>
          </Link>
          {STAT_ORDER.filter((s) => (stats[s] ?? 0) > 0).map((s) => (
            <Link
              key={s}
              className={`${styles.filter} ${filter === s ? styles.filterActive : ''}`}
              href={`/manage/${orgSlug}/${eventSlug}/submissions?status=${s}&${langQuery}`}
            >
              {SUBMISSION_LABELS[s][locale]} <span className={styles.filterCount}>{stats[s]}</span>
            </Link>
          ))}
        </nav>

        {rows.length === 0 ? (
          <p className={styles.empty}>{tt('noSubmissions')}</p>
        ) : (
          <SubmissionTable
            rows={rows}
            reviewers={reviewers.map((r) => ({
              publicId: encodeId('user', r.id),
              name: r.name ?? r.email,
            }))}
            orgSlug={orgSlug}
            eventSlug={eventSlug}
            locale={locale}
            minReviews={config.minReviews}
          />
        )}
      </section>
    </div>
  );
}
