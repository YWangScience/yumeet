import Link from 'next/link';
import type { DisplayStatus } from '@yumeet/core';
import { formatDateRange } from '@/lib/format';
import { translator, INTL_LOCALE, type Locale } from '@/lib/i18n';
import styles from './event-hero.module.css';

interface Props {
  event: {
    title: string;
    subtitle: string | null;
    startsAt: Date;
    endsAt: Date;
    timezone: string;
    venue: { name: string; city?: string; country?: string } | null;
  };
  orgName: string;
  status: DisplayStatus;
  registerHref: string | null;
  locale: Locale;
}

const STATUS_KEY = {
  draft: 'statusDraft', published: 'statusPublished', live: 'statusLive',
  ended: 'statusEnded', archived: 'statusArchived',
} as const;

export function EventHero({ event, orgName, status, registerHref, locale }: Props) {
  const tt = translator(locale);
  const intl = INTL_LOCALE[locale];
  return (
    <header className={styles.hero}>
      <div className={styles.inner}>
        <p className={styles.org}>{orgName}</p>

        <h1 className={styles.title}>{event.title}</h1>

        {event.subtitle && <p className={styles.subtitle}>{event.subtitle}</p>}

        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{tt('date')}</dt>
            <dd className={styles.factValue}>
              {formatDateRange(event.startsAt, event.endsAt, event.timezone, intl)}
            </dd>
          </div>
          {event.venue && (
            <div className={styles.fact}>
              <dt className={styles.factLabel}>{tt('location')}</dt>
              <dd className={styles.factValue}>
                {event.venue.name}
                {event.venue.city ? (locale === 'zh' ? `,${event.venue.city}` : `, ${event.venue.city}`) : ''}
              </dd>
            </div>
          )}
          <div className={styles.fact}>
            <dt className={styles.factLabel}>{tt('status')}</dt>
            <dd className={styles.factValue}>
              <span className={`${styles.badge} ${styles[`badge_${status}`]}`}>
                {tt(STATUS_KEY[status])}
              </span>
            </dd>
          </div>
        </dl>

        {registerHref && status !== 'ended' && status !== 'archived' && (
          <div className={styles.actions}>
            <Link className={styles.buttonPrimary} href={registerHref}>
              {tt('registerCta')}
            </Link>
            <a className={styles.buttonGhost} href="#schedule">
              {tt('viewSchedule')}
            </a>
          </div>
        )}
      </div>
    </header>
  );
}
