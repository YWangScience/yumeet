'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { Announcement, ScreenSession, ScreenState } from '@yumeet/core/client';
import { translator, INTL_LOCALE, type Locale } from '@/lib/i18n';
import styles from './screen.module.css';

interface Props {
  initial: ScreenState;
  locale: Locale;
  streamPath: string;
  roomParam: string | null;
}

/**
 * 会场屏的客户端接管层(ch05 §5.2.3)。
 *
 * 首屏由服务端渲染,这里只做三件事:
 *   1. 每秒推进本地时钟(用服务端 now 校正漂移,避免平板时间不准)
 *   2. 经 SSE 接收公告与日程变更;断线由浏览器自动重连,并用 Last-Event-ID 续传
 *   3. 到点自动把「下一场」提为「当前场」,不必等服务端推送
 */
export function ScreenLive({ initial, locale, streamPath, roomParam }: Props) {
  const tt = translator(locale);
  const intl = INTL_LOCALE[locale];

  const [state, setState] = useState<ScreenState>(initial);
  const [connected, setConnected] = useState(false);
  // 服务端时刻与本地时刻的差,用于校正平板上不准的系统时间
  const skewRef = useRef(Date.parse(initial.now) - Date.now());
  const [now, setNow] = useState(() => Date.parse(initial.now));

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() + skewRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const url = roomParam ? `${streamPath}?room=${encodeURIComponent(roomParam)}` : streamPath;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.addEventListener('announcement', (e) => {
      try {
        const a = JSON.parse((e as MessageEvent).data) as Announcement;
        setState((prev) => ({
          ...prev,
          announcements: [a, ...prev.announcements.filter((x) => x.cursor !== a.cursor)],
        }));
      } catch { /* 坏帧忽略,下一帧自会覆盖 */ }
    });

    es.addEventListener('schedule_changed', (e) => {
      try {
        const next = JSON.parse((e as MessageEvent).data) as ScreenState;
        skewRef.current = Date.parse(next.now) - Date.now();
        setState(next);
      } catch { /* 同上 */ }
    });

    return () => es.close();
  }, [streamPath, roomParam]);

  /** 到点自动换场:不依赖服务端推送,屏幕自己按时间推进 */
  const { current, next, later } = useMemo(() => {
    const all = [...state.current, ...state.next, ...state.later]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    const cur = all.filter((s) => Date.parse(s.startsAt) <= now && Date.parse(s.endsAt) > now);
    const upcoming = all.filter((s) => Date.parse(s.startsAt) > now);
    const firstStart = upcoming[0] ? Date.parse(upcoming[0].startsAt) : null;
    return {
      current: cur,
      next: firstStart == null ? [] : upcoming.filter((s) => Date.parse(s.startsAt) === firstStart),
      later: firstStart == null ? [] : upcoming.filter((s) => Date.parse(s.startsAt) > firstStart).slice(0, 5),
    };
  }, [state, now]);

  const live = state.announcements.filter((a) => Date.parse(a.expiresAt) > now);
  const tz = state.event.timezone;

  const time = (iso: string) => new Intl.DateTimeFormat(intl, {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));

  /** 剩余时间:进行中显示还剩多久,未开始显示多久后开始 */
  const countdown = (iso: string) => {
    const diff = Math.max(0, Date.parse(iso) - now);
    const m = Math.floor(diff / 60000);
    const h = Math.floor(m / 60);
    return h > 0 ? `${h} h ${m % 60} min` : `${m} min`;
  };

  return (
    <div className={styles.stage}>
      <header className={styles.head}>
        <div>
          <p className={styles.venue}>
            {state.room?.name ?? state.event.venueName ?? state.event.title}
          </p>
          {state.room?.location && <p className={styles.location}>{state.room.location}</p>}
        </div>
        <div className={styles.clockBox}>
          <p className={styles.clock}>
            {new Intl.DateTimeFormat(intl, {
              timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
            }).format(new Date(now))}
          </p>
          <p className={styles.clockTz}>
            {tz}
            <span className={connected ? styles.dotLive : styles.dotOffline} aria-hidden="true" />
            <span className={styles.srOnly}>
              {connected ? tt('screenLive') : tt('screenOffline')}
            </span>
          </p>
        </div>
      </header>

      {live.length > 0 && (
        <section className={styles.alerts} aria-live="polite" aria-label={tt('screenAnnouncements')}>
          {live.slice(0, 2).map((a) => (
            <p key={a.cursor} className={`${styles.alert} ${styles[`alert_${a.level}`] ?? ''}`}>
              {locale === 'en' && a.textEn ? a.textEn : a.text}
            </p>
          ))}
        </section>
      )}

      <section className={styles.nowBox} aria-label={tt('screenNow')}>
        <p className={styles.blockLabel}>{tt('screenNow')}</p>
        {current.length === 0 ? (
          <p className={styles.idle}>{tt('screenNoCurrent')}</p>
        ) : (
          current.map((s) => (
            <article key={s.id} className={styles.nowItem}>
              <h1 className={styles.nowTitle}>{s.title}</h1>
              <p className={styles.nowMeta}>
                <span className={styles.nowTime}>{time(s.startsAt)}–{time(s.endsAt)}</span>
                {s.roomName && <span className={styles.nowRoom}>{s.roomName}</span>}
                <span className={styles.nowRemain}>
                  {tt('screenRemaining', { t: countdown(s.endsAt) })}
                </span>
              </p>
              {s.speakers.length > 0 && (
                <p className={styles.nowSpeakers}>
                  {s.speakers.map((sp) => sp.name).join(' · ')}
                </p>
              )}
            </article>
          ))
        )}
      </section>

      {next.length > 0 && (
        <section className={styles.nextBox} aria-label={tt('screenNext')}>
          <p className={styles.blockLabel}>
            {tt('screenNext')}
            <span className={styles.nextIn}>
              {tt('screenStartsIn', { t: countdown(next[0]!.startsAt) })}
            </span>
          </p>
          {next.map((s) => (
            <article key={s.id} className={styles.nextItem}>
              <h2 className={styles.nextTitle}>{s.title}</h2>
              <p className={styles.nextMeta}>
                <span>{time(s.startsAt)}</span>
                {s.roomName && <span>{s.roomName}</span>}
                {s.speakers[0] && <span>{s.speakers[0].name}</span>}
              </p>
            </article>
          ))}
        </section>
      )}

      {later.length > 0 && (
        <section className={styles.laterBox} aria-label={tt('screenLater')}>
          <p className={styles.blockLabel}>{tt('screenLater')}</p>
          <ul className={styles.laterList}>
            {later.map((s) => (
              <li key={s.id} className={styles.laterItem}>
                <time className={styles.laterTime} dateTime={s.startsAt}>{time(s.startsAt)}</time>
                <span className={styles.laterTitle}>{s.title}</span>
                {s.roomName && <span className={styles.laterRoom}>{s.roomName}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
