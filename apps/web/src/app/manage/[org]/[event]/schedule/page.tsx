import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, getScheduleDraft } from '@yumeet/core';
import { ScheduleEditor } from '@/components/schedule-editor';
import { LangSwitch } from '@/components/lang-switch';
import { formatDateRange } from '@/lib/format';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent } from '@/lib/i18n';
import styles from './schedule-manage.module.css';

// 草稿态必须每次实时读库,不能吃缓存
export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return {
    title: found ? `日程编排 · ${found.event.title}` : '日程编排',
    robots: { index: false },
  };
}

/** 活动起止之间的全部日历日(会场时区),让空白日也能新建场次 */
function eventDays(startsAt: Date, endsAt: Date, timeZone: string): string[] {
  const fmt = new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const days: string[] = [];
  const last = fmt.format(endsAt);
  // 按 UTC 日步进,再折算到会场时区;跨度以活动天数为上限,不会失控
  for (let t = startsAt.getTime(); days.length < 400; t += 86_400_000) {
    const day = fmt.format(new Date(t));
    if (days[days.length - 1] !== day) days.push(day);
    if (day >= last) break;
  }
  return days;
}

export default async function ScheduleManagePage({ params, searchParams }: Props) {
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const { org: orgSlug, event: eventSlug } = await params;
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  const { event } = found;
  const draft = await getScheduleDraft(event.id);
  const content = eventContent(event, locale);

  // 活动区间的日 + 已排期落在区间外的日,合并去重
  const days = [...new Set([
    ...eventDays(event.startsAt, event.endsAt, event.timezone),
    ...draft.sessions.map((s) => new Intl.DateTimeFormat('sv-SE', {
      timeZone: event.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(s.start))),
  ])].sort((a, b) => a.localeCompare(b));

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <p className={styles.eyebrow}>{tt('schedEditorEyebrow')}</p>
          <h1 className={styles.title}>{tt('schedEditorTitle')}</h1>
          <p className={styles.meta}>
            <span>{content.title}</span>
            <span className={styles.dot} aria-hidden="true">·</span>
            <span>{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</span>
            <span className={styles.dot} aria-hidden="true">·</span>
            <span className={styles.tz}>{event.timezone}</span>
          </p>
          <p className={styles.lede}>{tt('schedEditorLede')}</p>
        </div>
        <div className={styles.headerSide}>
          <LangSwitch locale={locale} />
          <nav className={styles.links} aria-label={tt('schedEditorTitle')}>
            <Link className={styles.link} href={`/manage/${orgSlug}/${eventSlug}`}>
              {tt('schedBackToConsole')}
            </Link>
            <Link className={styles.link} href={`/${orgSlug}/${eventSlug}/schedule`}>
              {tt('schedViewPublic')}
              <span aria-hidden="true"> ↗</span>
            </Link>
          </nav>
        </div>
      </header>

      <ScheduleEditor
        orgSlug={orgSlug}
        eventSlug={eventSlug}
        eventTimezone={event.timezone}
        locale={locale}
        days={days}
        rooms={draft.rooms}
        sessions={draft.sessions}
        snapshot={draft.snapshot}
      />
    </main>
  );
}
