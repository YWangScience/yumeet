import Link from 'next/link';
import { formatTime, formatDayLabel } from '@/lib/format';
import { translator, type Locale } from '@/lib/i18n';
import styles from './schedule.module.css';

interface Session {
  id: string; title: string; kind: string; roomId: string | null;
  startsAt: Date; endsAt: Date;
  speakers: { name: string; affiliation?: string }[];
}
interface Props {
  days: { day: string; items: Session[] }[];
  timezone: string;
  limit?: number;
  /** 完整日程页地址;「另有 N 场」直接落到对应日期的锚点 */
  scheduleHref: string;
  locale: Locale;
}

export function ScheduleGlance({ days, timezone, limit, scheduleHref, locale }: Props) {
  const tt = translator(locale);
  return (
    <div className={styles.glance}>
      {days.map(({ day, items }) => {
        const shown = limit ? items.slice(0, limit) : items;
        return (
          <section key={day} className={styles.dayCard}>
            <h3 className={styles.dayTitle}>{formatDayLabel(day)}</h3>
            <ol className={styles.sessionList}>
              {shown.map((s) => (
                <li key={s.id} className={`${styles.session} ${styles[`kind_${s.kind}`] ?? ''}`}>
                  <time className={styles.sessionTime} dateTime={s.startsAt.toISOString()}>
                    {formatTime(s.startsAt, timezone)}
                  </time>
                  <div className={styles.sessionBody}>
                    <p className={styles.sessionTitle}>{s.title}</p>
                    <p className={styles.sessionMeta}>
                      {s.speakers.length > 0 && (
                        <span className={styles.speaker}>
                          {s.speakers.map((sp) => sp.name).join('、')}
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {limit && items.length > limit && (
              // 直接落到完整日程里的这一天,而不是让人到了日程页再自己找日期
              <Link className={styles.moreCount} href={`${scheduleHref}#day-${day}`}>
                {tt('moreSessions', { n: items.length - limit })} →
              </Link>
            )}
          </section>
        );
      })}
    </div>
  );
}
