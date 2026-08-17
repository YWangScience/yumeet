'use client';

import {
  useEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent,
} from 'react';
import { formatDayLabel, formatTime, viewerTimeZone } from '@/lib/format';
import styles from './schedule-grid.module.css';
import { translator, INTL_LOCALE, type Locale } from '@/lib/i18n';

export interface ScheduleRoom {
  id: string;
  name: string;
  location: string | null;
}

export interface ScheduleSpeaker {
  name: string;
  affiliation: string | null;
}

export interface ScheduleSession {
  id: string;
  title: string;
  kind: string;
  roomId: string | null;
  /** ISO 8601 UTC;客户端按当前生效时区渲染 */
  start: string;
  end: string;
  /** 同会场时间重叠时的并排轨道(服务端算好) */
  lane: number;
  lanes: number;
  speakers: ScheduleSpeaker[];
}

export interface ScheduleDay {
  day: string;
  sessions: ScheduleSession[];
}

interface Props {
  days: ScheduleDay[];
  rooms: ScheduleRoom[];
  eventTimezone: string;
  locale: Locale;
}

/** 网格纵轴精度:5 分钟一格 */
const SLOT_MS = 5 * 60_000;
/** 网格上下边界对齐到半小时 */
const SNAP_MS = 30 * 60_000;
/** 卡片最小高度(格),防止极短议程压成一条线 */
const MIN_SLOTS = 4;
/** 低于该高度的卡片隐藏所属机构,避免溢出 */
const DENSE_SLOTS = 9;

const KICKER: Record<string, Record<Locale, string>> = {
  keynote: { zh: '全体大会', en: 'Plenary' },
  poster: { zh: '海报', en: 'Poster' },
  social: { zh: '社交活动', en: 'Social' },
};

const cssVars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;

/** 浏览者时区把某项推到了相邻日历日时的偏移标记 */
function DayShift({ shift, locale }: { shift: number; locale: Locale }) {
  if (shift === 0) return null;
  return (
    <span className={styles.dayShift}>
      {shift > 0 ? `+${shift}` : shift}
      <span className={styles.srOnly}>{shift > 0
                ? (locale === 'zh' ? ' 天(次日)' : ' (next day)')
                : (locale === 'zh' ? ' 天(前一日)' : ' (previous day)')}</span>
    </span>
  );
}

/** 某绝对时刻在指定时区下的日历日(YYYY-MM-DD) */
function dayKeyIn(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

function toUtcNoon(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** a 比 b 晚几个日历日 */
function dayDiff(a: string, b: string): number {
  return Math.round((toUtcNoon(a) - toUtcNoon(b)) / 86_400_000);
}

function dayTabParts(day: string): { weekday: string; date: string } {
  const at = new Date(toUtcNoon(day));
  return {
    weekday: new Intl.DateTimeFormat('zh-Hans', { timeZone: 'UTC', weekday: 'short' }).format(at),
    date: new Intl.DateTimeFormat('zh-Hans', { timeZone: 'UTC', month: 'numeric', day: 'numeric' }).format(at),
  };
}

interface Placed {
  session: ScheduleSession;
  room: ScheduleRoom | null;
  startMs: number;
  endMs: number;
  rowStart: number;
  rowEnd: number;
  /** -1 表示跨会场,横跨整行 */
  colIndex: number;
}

interface Layout {
  dayRooms: ScheduleRoom[];
  rows: number;
  ticks: { key: string; row: number; label: string }[];
  placed: Placed[];
  firstMs: number;
  lastMs: number;
}

function layoutDay(day: ScheduleDay, rooms: ScheduleRoom[], timeZone: string): Layout {
  const byId = new Map(rooms.map((r) => [r.id, r] as const));
  const used = new Set<string>();
  for (const s of day.sessions) {
    if (s.roomId && byId.has(s.roomId)) used.add(s.roomId);
  }
  const dayRooms = rooms.filter((r) => used.has(r.id));
  const colOf = new Map(dayRooms.map((r, i) => [r.id, i] as const));

  let firstMs = Number.POSITIVE_INFINITY;
  let lastMs = Number.NEGATIVE_INFINITY;
  for (const s of day.sessions) {
    firstMs = Math.min(firstMs, Date.parse(s.start));
    lastMs = Math.max(lastMs, Date.parse(s.end));
  }
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) {
    return { dayRooms, rows: 1, ticks: [], placed: [], firstMs: 0, lastMs: 0 };
  }

  const gridStart = Math.floor(firstMs / SNAP_MS) * SNAP_MS;
  const gridEnd = Math.max(gridStart + SNAP_MS, Math.ceil(lastMs / SNAP_MS) * SNAP_MS);
  const rows = Math.round((gridEnd - gridStart) / SLOT_MS);
  const rowOf = (ms: number) => Math.round((ms - gridStart) / SLOT_MS) + 1;

  // 整点刻度:偏移量并非都是整小时(如 +05:45),所以按 15 分钟步进筛出整点
  const ticks: Layout['ticks'] = [];
  for (let t = gridStart; t < gridEnd; t += 15 * 60_000) {
    const label = formatTime(new Date(t), timeZone);
    if (!label.endsWith(':00')) continue;
    ticks.push({ key: String(t), row: rowOf(t), label });
  }

  const placed = day.sessions.map((session): Placed => {
    const startMs = Date.parse(session.start);
    const endMs = Date.parse(session.end);
    const rowStart = rowOf(startMs);
    const rowEnd = Math.min(rows + 1, Math.max(rowStart + MIN_SLOTS, rowOf(endMs)));
    const room = session.roomId ? byId.get(session.roomId) ?? null : null;
    return {
      session,
      room,
      startMs,
      endMs,
      rowStart,
      rowEnd,
      colIndex: room ? colOf.get(room.id) ?? -1 : -1,
    };
  });

  return { dayRooms, rows, ticks, placed, firstMs, lastMs };
}

export function ScheduleGrid({ days, rooms, eventTimezone, locale }: Props) {
  const [selected, setSelected] = useState(0);
  // SSR 与首帧一律用会场时区渲染,水合后再切到浏览者时区,避免 hydration mismatch
  const [viewerTz, setViewerTz] = useState<string | null>(null);
  const [showVenueTime, setShowVenueTime] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tz = viewerTimeZone();
    if (tz && tz !== eventTimezone) setViewerTz(tz);
  }, [eventTimezone]);

  // 站点导航条(SiteNav)也是粘性的,且高度由别的组件决定。实测一次写进 CSS 变量,
  // 让日期 tab 与会场表头叠在它下面而不是被它盖住。CSS 里有 48px 的兜底值。
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let offset = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('nav, header'))) {
      if (root.contains(el)) continue;
      const cs = window.getComputedStyle(el);
      if (cs.position !== 'sticky' && cs.position !== 'fixed') continue;
      if (Math.abs(Number.parseFloat(cs.top) || 0) > 1) continue;
      offset = Math.max(offset, el.getBoundingClientRect().height);
    }
    if (offset > 0) root.style.setProperty('--sched-nav-h', `${offset}px`);
  }, []);

  const usingViewerTz = viewerTz !== null && !showVenueTime;
  const timeZone = usingViewerTz && viewerTz ? viewerTz : eventTimezone;

  const day = days[selected] ?? days[0];
  const layout = useMemo(
    () => (day ? layoutDay(day, rooms, timeZone) : null),
    [day, rooms, timeZone],
  );

  if (!day || !layout) return null;

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = days.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    setSelected(next);
    tabRefs.current[next]?.focus();
  };

  const cols = Math.max(1, layout.dayRooms.length);
  const template = `var(--sched-gutter) repeat(${cols}, minmax(0, 1fr))`;
  const panelId = `schedule-panel-${day.day}`;
  const tabId = (d: string) => `schedule-tab-${d}`;

  // 前缀已由 tzLabel + tzZone 显示,此处只补充差异说明,避免重复
  const tzMessage = viewerTz === null
    ? (locale === 'zh' ? '与你的时区一致。' : 'Same as your timezone.')
    : usingViewerTz
      ? (locale === 'zh'
          ? `你当前时区为 ${viewerTz},以下时间已按你的时区显示。`
          : `Your timezone is ${viewerTz}; times below are shown in it.`)
      : (locale === 'zh'
          ? '以下时间按会场时区显示。'
          : 'Times below are shown in the venue timezone.');

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.tzBar}>
        <p className={styles.tzText}>
          <span className={styles.tzLabel}>{locale === 'zh' ? '会议时区' : 'Event timezone'}</span>
          <span className={styles.tzZone}>{eventTimezone}</span>
          <span className={styles.tzNote} role="status">{tzMessage}</span>
        </p>
        {viewerTz !== null && (
          <div className={styles.tzToggle} role="group" aria-label="时间显示时区">
            <button
              type="button"
              className={styles.tzOption}
              aria-pressed={usingViewerTz}
              onClick={() => setShowVenueTime(false)}
            >
              你的时区
            </button>
            <button
              type="button"
              className={styles.tzOption}
              aria-pressed={!usingViewerTz}
              onClick={() => setShowVenueTime(true)}
            >
              会场时间
            </button>
          </div>
        )}
      </div>

      <div className={styles.tabsBar}>
        <div className={styles.tabs} role="tablist" aria-label="按日期查看日程">
          {days.map((d, i) => {
            const parts = dayTabParts(d.day);
            const isSelected = i === selected;
            return (
              <button
                key={d.day}
                type="button"
                role="tab"
                id={tabId(d.day)}
                className={styles.tab}
                aria-selected={isSelected}
                aria-controls={isSelected ? panelId : undefined}
                tabIndex={isSelected ? 0 : -1}
                ref={(el) => { tabRefs.current[i] = el; }}
                onClick={() => setSelected(i)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
              >
                <span className={styles.tabIndex}>第 {i + 1} 天</span>
                <span className={styles.tabDate}>{parts.date}</span>
                <span className={styles.tabWeekday}>{parts.weekday}</span>
              </button>
            );
          })}
        </div>
      </div>

      <section
        className={styles.panel}
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(day.day)}
        tabIndex={0}
      >
        <h2 className={styles.dayTitle}>
          {formatDayLabel(day.day)}
          <span className={styles.dayCount}>{day.sessions.length} 场</span>
          {layout.placed.length > 0 && (
            <span className={styles.dayRange}>
              {formatTime(new Date(layout.firstMs), timeZone)}
              <DayShift locale={locale} shift={dayDiff(dayKeyIn(layout.firstMs, timeZone), day.day)} />
              <span aria-hidden="true"> – </span>
              <span className={styles.srOnly}>至</span>
              {formatTime(new Date(layout.lastMs), timeZone)}
              <DayShift locale={locale} shift={dayDiff(dayKeyIn(layout.lastMs, timeZone), day.day)} />
            </span>
          )}
        </h2>

        {/* 桌面:多轨时间网格 */}
        <div className={styles.gridView}>
          <div
            className={styles.roomHead}
            style={cssVars({ gridTemplateColumns: template })}
            aria-hidden="true"
          >
            <span className={styles.roomHeadGutter} />
            {layout.dayRooms.map((r) => (
              <span key={r.id} className={styles.roomHeadCell}>
                <span className={styles.roomHeadName}>{r.name}</span>
                {r.location && <span className={styles.roomHeadLoc}>{r.location}</span>}
              </span>
            ))}
          </div>

          <div
            className={styles.grid}
            role="list"
            style={cssVars({ gridTemplateColumns: template })}
          >
            <div
              className={styles.gridSpacer}
              aria-hidden="true"
              style={{ gridColumn: '1 / -1', gridRow: `1 / span ${layout.rows}` }}
            />
            {layout.dayRooms.map((r, i) => (
              <div
                key={`line-${r.id}`}
                className={styles.colLine}
                aria-hidden="true"
                style={{ gridColumn: i + 2, gridRow: `1 / span ${layout.rows}` }}
              />
            ))}
            {layout.ticks.map((t) => (
              <div
                key={t.key}
                className={styles.tick}
                aria-hidden="true"
                style={{ gridColumn: '1 / -1', gridRow: `${t.row} / span 12` }}
              >
                <span className={styles.tickLabel}>{t.label}</span>
              </div>
            ))}

            {layout.placed.map(({ session, room, rowStart, rowEnd, colIndex }) => {
              const wide = colIndex < 0;
              const span = rowEnd - rowStart;
              const shift = dayDiff(dayKeyIn(Date.parse(session.start), timeZone), day.day);
              const style: CSSProperties = {
                gridRow: `${rowStart} / ${rowEnd}`,
                gridColumn: wide ? '2 / -1' : String(colIndex + 2),
              };
              if (!wide && session.lanes > 1) {
                style.marginLeft = `${(session.lane / session.lanes) * 100}%`;
                style.width = `${100 / session.lanes}%`;
              }
              const kicker = KICKER[session.kind]?.[locale];
              const className = [
                styles.card,
                styles[`kind_${session.kind}`] ?? styles['kind_talk'] ?? '',
                wide ? styles.cardWide : '',
                span < DENSE_SLOTS ? styles.cardDense : '',
              ].filter(Boolean).join(' ');

              return (
                <div
                  key={session.id}
                  role="listitem"
                  className={className}
                  style={style}
                  title={session.title}
                >
                  <p className={styles.cardTime}>
                    <time dateTime={session.start}>{formatTime(new Date(session.start), timeZone)}</time>
                    <span className={styles.timeSep} aria-hidden="true">–</span>
                    <span className={styles.srOnly}>至</span>
                    <time dateTime={session.end}>{formatTime(new Date(session.end), timeZone)}</time>
                    <DayShift locale={locale} shift={shift} />
                  </p>
                  <div className={styles.cardBody}>
                    {kicker && <span className={styles.kicker}>{kicker}</span>}
                    <h3 className={styles.cardTitle}>{session.title}</h3>
                    {session.speakers.length > 0 && (
                      <p className={styles.speakers}>
                        {session.speakers.map((sp, i) => (
                          <span key={`${sp.name}-${i}`} className={styles.speaker}>
                            <span className={styles.speakerName}>{sp.name}</span>
                            {sp.affiliation && (
                              <span className={styles.speakerAff}>{sp.affiliation}</span>
                            )}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <span className={styles.srOnly}>
                    {room ? (locale === 'zh' ? `会场:${room.name}` : `Room: ${room.name}`)
                      : (locale === 'zh' ? '全体活动,不限会场' : 'All-venue session')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 移动端:单列时间轴。display:none 会同时移出无障碍树,不会与网格重复朗读 */}
        <ol className={styles.timeline}>
          {layout.placed.map(({ session, room }) => {
            const shift = dayDiff(dayKeyIn(Date.parse(session.start), timeZone), day.day);
            const kicker = KICKER[session.kind]?.[locale];
            const className = [
              styles.tlItem,
              styles[`kind_${session.kind}`] ?? styles['kind_talk'] ?? '',
            ].filter(Boolean).join(' ');
            return (
              <li key={session.id} className={className}>
                <p className={styles.tlTime}>
                  <time dateTime={session.start}>{formatTime(new Date(session.start), timeZone)}</time>
                  <span className={styles.srOnly}>至</span>
                  <time className={styles.tlEnd} dateTime={session.end}>
                    {formatTime(new Date(session.end), timeZone)}
                  </time>
                  <DayShift locale={locale} shift={shift} />
                </p>
                <div className={styles.tlBody}>
                  {kicker && <span className={styles.kicker}>{kicker}</span>}
                  <h3 className={styles.tlTitle}>{session.title}</h3>
                  {session.speakers.length > 0 && (
                    <p className={styles.speakers}>
                      {session.speakers.map((sp, i) => (
                        <span key={`${sp.name}-${i}`} className={styles.speaker}>
                          <span className={styles.speakerName}>{sp.name}</span>
                          {sp.affiliation && (
                            <span className={styles.speakerAff}>{sp.affiliation}</span>
                          )}
                        </span>
                      ))}
                    </p>
                  )}
                  <p className={styles.tlRoom}>{room ? room.name : (locale === 'zh' ? '全体活动,不限会场' : 'All-venue session')}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
