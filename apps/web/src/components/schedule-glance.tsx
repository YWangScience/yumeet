import { formatTime, formatDayLabel } from '@/lib/format';
import styles from './schedule.module.css';

interface Session {
  id: string; title: string; kind: string; roomId: string | null;
  startsAt: Date; endsAt: Date;
  speakers: { name: string; affiliation?: string }[];
}
interface Room { id: string; name: string }

interface Props {
  days: { day: string; items: Session[] }[];
  rooms: Room[];
  timezone: string;
  limit?: number;
}

export function ScheduleGlance({ days, rooms, timezone, limit }: Props) {
  const roomName = (id: string | null) => rooms.find((r) => r.id === id)?.name ?? null;
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
                      {roomName(s.roomId) && <span className={styles.room}>{roomName(s.roomId)}</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {limit && items.length > limit && (
              <p className={styles.moreCount}>另有 {items.length - limit} 场</p>
            )}
          </section>
        );
      })}
    </div>
  );
}
