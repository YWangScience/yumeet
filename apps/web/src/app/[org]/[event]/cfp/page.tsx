import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, getCfpConfig, localize } from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent, INTL_LOCALE } from '@/lib/i18n';
import styles from './cfp.module.css';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `征稿 · ${found.event.title}` : '征稿' };
}

/** 征稿入口(ch04 §4.3:track、投稿类型、四档截止时间、双盲说明) */
export default async function CfpPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const intl = INTL_LOCALE[locale];

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();
  const { event } = found;
  if (!event.modules?.cfp) notFound();

  const content = eventContent(event, locale);
  const config = getCfpConfig(event);
  const closed = new Date() > config.deadlines.submission;

  const fmt = (d: Date) =>
    new Intl.DateTimeFormat(intl, {
      timeZone: event.timezone, year: 'numeric', month: 'long', day: 'numeric',
    }).format(d);

  const dates: { key: 'cfpDeadlineSubmission' | 'cfpDeadlineRevision' | 'cfpDeadlineReview' | 'cfpDeadlineNotification'; at: Date }[] = [
    { key: 'cfpDeadlineSubmission', at: config.deadlines.submission },
    { key: 'cfpDeadlineRevision', at: config.deadlines.revision },
    { key: 'cfpDeadlineReview', at: config.deadlines.review },
    { key: 'cfpDeadlineNotification', at: config.deadlines.notification },
  ];

  return (
    <main className={styles.page}>

      <h1 className={styles.title}>{tt('cfpTitle')}</h1>
      <p className={styles.lede}>{tt('cfpLede')}</p>

      {closed ? (
        <div className={styles.notice} role="status">
          <p className={styles.noticeTitle}>{tt('cfpClosedTitle')}</p>
          <p className={styles.noticeBody}>{tt('cfpClosedBody')}</p>
        </div>
      ) : (
        <p className={styles.ctaRow}>
          <Link className={styles.cta} href={`/${orgSlug}/${eventSlug}/cfp/submit?lang=${locale}`}>
            {tt('cfpStart')}
          </Link>
          <span className={styles.ctaHint}>{tt('cfpResumeHint')}</span>
        </p>
      )}

      <section className={styles.section} aria-labelledby="cfp-dates">
        <h2 className={styles.sectionTitle} id="cfp-dates">{tt('cfpDatesTitle')}</h2>
        <dl className={styles.dates}>
          {dates.map((d) => (
            <div key={d.key} className={styles.dateRow}>
              <dt>{tt(d.key)}</dt>
              <dd>
                <time dateTime={d.at.toISOString()}>{fmt(d.at)}</time>
              </dd>
            </div>
          ))}
        </dl>
        <p className={styles.note}>{tt('cfpDatesNote')}</p>
      </section>

      <section className={styles.section} aria-labelledby="cfp-tracks">
        <h2 className={styles.sectionTitle} id="cfp-tracks">{tt('cfpTracksTitle')}</h2>
        <ul className={styles.tags}>
          {config.tracks.map((t) => (
            <li key={t.id} className={styles.tag}>{localize(t.label, locale)}</li>
          ))}
        </ul>
        <h2 className={styles.sectionTitle} id="cfp-types">{tt('cfpTypesTitle')}</h2>
        <ul className={styles.tags} aria-labelledby="cfp-types">
          {config.types.map((t) => (
            <li key={t.id} className={styles.tag}>{localize(t.label, locale)}</li>
          ))}
        </ul>
      </section>

      <section className={styles.blind} aria-labelledby="cfp-blind">
        <h2 className={styles.sectionTitle} id="cfp-blind">{tt('cfpBlindTitle')}</h2>
        <p className={styles.blindBody}>{tt('cfpBlindBody')}</p>
      </section>
    </main>
  );
}
