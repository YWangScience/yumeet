import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getEventTickets, getEventForms, getEventSchedule,
  displayStatus, encodeId, eventJsonLd, groupByDay, speakerHighlights,
} from '@yumeet/core';
import { EventHero } from '@/components/event-hero';
import { SpeakerGrid } from '@/components/speaker-grid';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent } from '@/lib/i18n';
import { ScheduleGlance } from '@/components/schedule-glance';
import { TicketList } from '@/components/ticket-list';
import { Markdown } from '@/components/markdown';
import styles from './event.module.css';

// ISR:公共页静态化,发布后由 revalidate 更新(ch13 §13.2)
export const revalidate = 60;

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) return { title: 'Not found · yuMeet' };
  return {
    title: `${found.event.title} · yuMeet`,
    description: found.event.subtitle ?? undefined,
    openGraph: {
      title: found.event.title,
      description: found.event.subtitle ?? undefined,
      type: 'website',
    },
  };
}

export default async function EventPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const { event, org } = found;
  const [tickets, forms, schedule, speakers] = await Promise.all([
    getEventTickets(event.id),
    getEventForms(event.id),
    getEventSchedule(event.id),
    speakerHighlights(event.id, 8),
  ]);

  const status = displayStatus(event);
  const content = eventContent(event, locale);
  const form = forms[0];
  const days = groupByDay(schedule.sessions, event.timezone);

  const jsonLd = eventJsonLd({
    title: content.title,
    description: content.subtitle,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    url: `/${orgSlug}/${eventSlug}`,
    venue: event.venue,
    organizer: org.name,
  });

  return (
    <>
      {/* schema.org 结构化数据(ch10 §10.4) */}
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <EventHero
        event={{ ...event, title: content.title, subtitle: content.subtitle }}
        orgName={org.name}
        status={status}
        locale={locale}
        registerHref={form ? `/${orgSlug}/${eventSlug}/register` : null}
      />

      <main className={styles.main}>
        {content.description && (
          <section className={styles.section} aria-labelledby="about">
            <h2 id="about" className={styles.sectionTitle}>{tt('about')}</h2>
            <Markdown source={content.description ?? ''} />
          </section>
        )}

        {speakers.rows.length > 0 && (
          <section className={styles.section} aria-labelledby="speakers">
            <div className={styles.sectionHead}>
              <h2 id="speakers" className={styles.sectionTitle}>{tt('speakers')}</h2>
              <Link className={styles.moreLink} href={`/${orgSlug}/${eventSlug}/speakers`}>
                {tt('seeAllSpeakers', { n: speakers.total })}
              </Link>
            </div>
            <SpeakerGrid
              locale={locale}
              speakers={speakers.rows.map((s) => ({
                id: s.id, name: s.name, affiliation: s.affiliation,
                talkTitle: s.talkTitle, photoUrl: s.photoUrl, bio: s.bio,
              }))}
            />
          </section>
        )}

        {speakers.committee > 0 && (
          <section className={styles.section} aria-labelledby="committees">
            <div className={styles.sectionHead}>
              <h2 id="committees" className={styles.sectionTitle}>{tt('committees')}</h2>
              <Link className={styles.moreLink} href={`/${orgSlug}/${eventSlug}/committees`}>
                {tt('peopleCount', { n: speakers.committee })}
              </Link>
            </div>
            <p className={styles.calendarHint}>{tt('committeesLede', { n: speakers.committee })}</p>
          </section>
        )}

        {event.modules?.schedule && days.length > 0 && (
          <section className={styles.section} aria-labelledby="schedule">
            <div className={styles.sectionHead}>
              <h2 id="schedule" className={styles.sectionTitle}>{tt('schedule')}</h2>
              <Link className={styles.moreLink} href={`/${orgSlug}/${eventSlug}/schedule`}>
                {tt('fullSchedule')}
              </Link>
            </div>
            <ScheduleGlance
              days={days}
              rooms={schedule.rooms}
              timezone={event.timezone}
              limit={4}
            />
          </section>
        )}

        {event.modules?.registration && tickets.length > 0 && (
          <section className={styles.section} aria-labelledby="tickets">
            <div className={styles.sectionHead}>
              <h2 id="tickets" className={styles.sectionTitle}>{tt('registration')}</h2>
              {form && (
                <Link className={styles.moreLink} href={`/${orgSlug}/${eventSlug}/register`}>
                  {tt('startRegistration')}
                </Link>
              )}
            </div>
            <TicketList tickets={tickets} />
          </section>
        )}

        <section className={styles.section} aria-labelledby="venue">
          <h2 id="venue" className={styles.sectionTitle}>{tt('venue')}</h2>
          <div className={styles.venueCard}>
            <p className={styles.venueName}>{event.venue?.name}</p>
            {event.venue?.address && (
              <p className={styles.venueAddr}>
                {event.venue.address}
                {event.venue.city ? `, ${event.venue.city}` : ''}
              </p>
            )}
            <p className={styles.venueMeta}>
              {tt('timezoneNote', { tz: event.timezone })}
            </p>
          </div>
          {schedule.rooms.length > 0 && (
            <ul className={styles.roomList}>
              {schedule.rooms.map((r) => (
                <li key={r.id} className={styles.roomItem}>
                  <span className={styles.roomName}>{r.name}</span>
                  {r.location && <span className={styles.roomLoc}>{r.location}</span>}
                  {r.capacity && <span className={styles.roomCap}>{r.capacity} {tt('seats')}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={styles.section} aria-labelledby="calendar">
          <h2 id="calendar" className={styles.sectionTitle}>{tt('addToCalendar')}</h2>
          <p className={styles.calendarHint}>{tt('calendarHint')}</p>
          <div className={styles.calendarActions}>
            <a
              className={styles.buttonSecondary}
              href={`/api/v1/public/events/${encodeId('event', event.id)}/calendar.ics`}
            >
              {tt('downloadIcs')}
            </a>
            <a
              className={styles.buttonSecondary}
              href={`/api/v1/public/events/${encodeId('event', event.id)}/schedule`}
            >
              {tt('publicJson')}
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
