'use client';

import {
  useCallback, useEffect, useId, useMemo, useRef, useState, useTransition,
  type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent,
} from 'react';
import {
  detectConflictsIso, diffSchedule, alignToGrid,
  SCHEDULE_GRID_MS, SESSION_KINDS,
  type SnapshotSession, type Conflict,
} from '@yumeet/core/client';
import {
  saveScheduleAction, publishScheduleAction,
} from '@/app/manage/[org]/[event]/schedule/actions';
import { formatTime, formatDayLabel } from '@/lib/format';
import { translator, INTL_LOCALE, type Locale, type TKey } from '@/lib/i18n';
import styles from './schedule-editor.module.css';

/* --------------------------------------------------------------------------
   TODO(ch05 §5.1.4 Yjs 协作):本组件的挂载点即为共享文档的绑定处 ——
   把下面的 `items` state 换成 Y.Map<ScheduleBlock> 的受控视图,
   在 useEffect 里建立 WebSocket(apps/api 的网关,凭一次性 ticket 鉴权),
   observe 远端 update → setItems,本地 mutate → ydoc.transact。
   awareness 的协作者光标画在 .gridLayerCursors 层。冲突检测与保存/发布链路
   不需要改动:它们只依赖当前 blocks 快照,不关心它从哪来。
   -------------------------------------------------------------------------- */

export interface EditorRoom {
  id: string;
  name: string;
  location: string | null;
  position: number;
}

export interface EditorSnapshot {
  version: number;
  publishedAt: string;
  sessions: SnapshotSession[];
}

interface Props {
  orgSlug: string;
  eventSlug: string;
  eventTimezone: string;
  locale: Locale;
  /** 活动区间内的全部日历日(会场时区,YYYY-MM-DD) */
  days: string[];
  rooms: EditorRoom[];
  sessions: SnapshotSession[];
  snapshot: EditorSnapshot | null;
}

interface Draft extends SnapshotSession {
  deleted?: boolean;
}

const MIN_SLOTS = 4;          // 卡片最小高度(格),防止 20 分钟的场次压成一条线
const DEFAULT_WIN_START = 480;  // 默认可视窗口 08:00
const DEFAULT_WIN_END = 1260;   // 默认可视窗口 21:00
const NEW_PREFIX = 'new:';

const KIND_KEY: Record<string, TKey> = {
  talk: 'schedKindTalk',
  keynote: 'schedKindKeynote',
  break: 'schedKindBreak',
  poster: 'schedKindPoster',
  social: 'schedKindSocial',
};

const cssVars = (v: Record<string, string | number>): CSSProperties => v as CSSProperties;

/* ------------------------------------------------------------------ 时区工具 */
/* 时间一律 UTC 存储,按活动时区(event.timezone)渲染与编辑。 */

interface ZParts { y: number; m: number; d: number; h: number; mi: number; s: number }

function zonedParts(ms: number, timeZone: string): ZParts {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return {
    y: get('year'), m: get('month'), d: get('day'),
    h: get('hour'), mi: get('minute'), s: get('second'),
  };
}

function tzOffsetMs(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - ms;
}

/** 会场时区下的「某天 + 当日第几分钟」→ UTC 毫秒(两轮迭代跨过 DST 边界) */
function zonedToUtc(day: string, minutes: number, timeZone: string): number {
  const [y, m, d] = day.split('-').map(Number);
  const naive = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 0, minutes);
  const first = naive - tzOffsetMs(naive, timeZone);
  return naive - tzOffsetMs(first, timeZone);
}

function dayKeyIn(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

/** 当日已过分钟数(会场时区) */
function minutesOfDay(ms: number, timeZone: string): number {
  const p = zonedParts(ms, timeZone);
  return p.h * 60 + p.mi;
}

function hhmm(ms: number, timeZone: string): string {
  const p = zonedParts(ms, timeZone);
  return `${String(p.h).padStart(2, '0')}:${String(p.mi).padStart(2, '0')}`;
}

/* -------------------------------------------------------------------- 布局 */

interface Placed {
  draft: Draft;
  colIndex: number;
  rowStart: number;
  rowEnd: number;
}

interface DayLayout {
  winStart: number;   // 相对当天 00:00 的分钟
  winEnd: number;
  rows: number;
  ticks: { key: string; row: number; label: string }[];
  placed: Placed[];
}

function layoutDay(
  day: string, drafts: Draft[], rooms: EditorRoom[], timeZone: string,
): DayLayout {
  const dayStart = zonedToUtc(day, 0, timeZone);
  const offMin = (iso: string) => Math.round((Date.parse(iso) - dayStart) / 60_000);

  let winStart = DEFAULT_WIN_START;
  let winEnd = DEFAULT_WIN_END;
  for (const d of drafts) {
    winStart = Math.min(winStart, Math.floor(offMin(d.start) / 30) * 30 - 30);
    winEnd = Math.max(winEnd, Math.ceil(offMin(d.end) / 30) * 30 + 30);
  }
  winStart = Math.max(0, winStart);
  const rows = Math.round((winEnd - winStart) / 5);

  const ticks: DayLayout['ticks'] = [];
  for (let m = Math.ceil(winStart / 60) * 60; m < winEnd; m += 60) {
    ticks.push({
      key: String(m),
      row: (m - winStart) / 5 + 1,
      label: hhmm(dayStart + m * 60_000, timeZone),
    });
  }

  const colOf = new Map(rooms.map((r, i) => [r.id, i + 1] as const));
  const placed = drafts.map((draft): Placed => {
    const s = offMin(draft.start);
    const e = offMin(draft.end);
    const rowStart = Math.max(1, (s - winStart) / 5 + 1);
    const rowEnd = Math.min(rows + 1, Math.max(rowStart + MIN_SLOTS, (e - winStart) / 5 + 1));
    return {
      draft,
      colIndex: draft.roomId ? colOf.get(draft.roomId) ?? 0 : 0,
      rowStart: Math.round(rowStart),
      rowEnd: Math.round(rowEnd),
    };
  });

  return { winStart, winEnd, rows, ticks, placed };
}

/* ==================================================================== 组件 */

export function ScheduleEditor({
  orgSlug, eventSlug, eventTimezone, locale, days, rooms, sessions, snapshot,
}: Props) {
  const tt = translator(locale);
  const uid = useId();

  const [items, setItems] = useState<Draft[]>(() => sessions.map((s) => ({ ...s })));
  /** 最近一次与服务端同步后的 sessions 表状态 —— 「未保存」判定的基线 */
  const [baseline, setBaseline] = useState<SnapshotSession[]>(sessions);
  const [snap, setSnap] = useState<EditorSnapshot | null>(snapshot);
  const [dayIndex, setDayIndex] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);

  const gridRef = useRef<HTMLDivElement>(null);
  const colRefs = useRef<(HTMLDivElement | null)[]>([]);
  const cardRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const suppressClick = useRef(false);
  const newCounter = useRef(0);
  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    pointerId: number;
    clientX: number;
    clientY: number;
    origStart: number;
    origEnd: number;
    slotPx: number;
    cols: { left: number; right: number }[];
    moved: boolean;
  } | null>(null);

  const live = useMemo(() => items.filter((i) => !i.deleted), [items]);

  const conflicts = useMemo(() => detectConflictsIso(live), [live]);
  const conflictIds = useMemo(() => {
    const s = new Set<string>();
    for (const c of conflicts) { s.add(c.a); s.add(c.b); }
    return s;
  }, [conflicts]);

  const unsaved = useMemo(
    () => diffSchedule(live.map(stripDraft), baseline).total,
    [live, baseline],
  );
  const unpublished = useMemo(
    () => diffSchedule(baseline, snap?.sessions ?? null).total,
    [baseline, snap],
  );

  const dayList = days.length > 0 ? days : [dayKeyIn(Date.now(), eventTimezone)];
  const day = dayList[Math.min(dayIndex, dayList.length - 1)] ?? dayList[0] ?? '';
  const dayDrafts = useMemo(
    () => live.filter((d) => dayKeyIn(Date.parse(d.start), eventTimezone) === day),
    [live, day, eventTimezone],
  );
  const layout = useMemo(
    () => layoutDay(day, dayDrafts, rooms, eventTimezone),
    [day, dayDrafts, rooms, eventTimezone],
  );

  const roomName = useCallback(
    (id: string | null) => (id ? rooms.find((r) => r.id === id)?.name ?? id : tt('schedUnassignedRoom')),
    [rooms, tt],
  );
  const titleOf = useCallback(
    (id: string) => items.find((i) => i.id === id)?.title ?? id,
    [items],
  );

  /* ------------------------------------------------------------ 变更原语 */

  const patch = useCallback((id: string, next: Partial<Draft>) => {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...next } : it)));
  }, []);

  const announce = useCallback((id: string, item?: Draft) => {
    const it = item ?? items.find((i) => i.id === id);
    if (!it) return;
    setNotice(tt('schedMoveAnnounce', {
      title: it.title,
      room: roomName(it.roomId),
      start: hhmm(Date.parse(it.start), eventTimezone),
      end: hhmm(Date.parse(it.end), eventTimezone),
    }));
  }, [items, roomName, tt, eventTimezone]);

  /** 平移(保持时长);deltaMs 已是 5 分钟的整数倍 */
  const moveBy = useCallback((id: string, deltaMs: number) => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const s = alignToGrid(Date.parse(it.start) + deltaMs);
      const e = s + (Date.parse(it.end) - Date.parse(it.start));
      const next = { ...it, start: new Date(s).toISOString(), end: new Date(e).toISOString() };
      queueMicrotask(() => announce(id, next));
      return next;
    }));
  }, [announce]);

  const resizeBy = useCallback((id: string, deltaMs: number) => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const s = Date.parse(it.start);
      const e = Math.max(s + SCHEDULE_GRID_MS, alignToGrid(Date.parse(it.end) + deltaMs));
      const next = { ...it, end: new Date(e).toISOString() };
      queueMicrotask(() => announce(id, next));
      return next;
    }));
  }, [announce]);

  const moveToColumn = useCallback((id: string, colIndex: number) => {
    const clamped = Math.max(0, Math.min(rooms.length, colIndex));
    const roomId = clamped === 0 ? null : rooms[clamped - 1]?.id ?? null;
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const next = { ...it, roomId };
      queueMicrotask(() => announce(id, next));
      return next;
    }));
  }, [rooms, announce]);

  /* -------------------------------------------------------- 指针拖拽 */

  const beginDrag = useCallback((
    e: RPointerEvent<HTMLElement>, id: string, mode: 'move' | 'resize',
  ) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const it = items.find((i) => i.id === id);
    const grid = gridRef.current;
    if (!it || !grid) return;
    const rect = grid.getBoundingClientRect();
    const slotPx = layout.rows > 0 ? rect.height / layout.rows : 13;
    const cols = colRefs.current.slice(0, rooms.length + 1).map((el) => {
      const r = el?.getBoundingClientRect();
      return { left: r?.left ?? 0, right: r?.right ?? 0 };
    });
    dragRef.current = {
      id, mode, pointerId: e.pointerId,
      clientX: e.clientX, clientY: e.clientY,
      origStart: Date.parse(it.start), origEnd: Date.parse(it.end),
      slotPx, cols, moved: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }, [items, layout.rows, rooms.length]);

  const onDragMove = useCallback((e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.clientX;
    const dy = e.clientY - d.clientY;
    if (!d.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    d.moved = true;
    e.preventDefault();

    const steps = Math.round(dy / Math.max(1, d.slotPx));
    const delta = steps * SCHEDULE_GRID_MS;

    if (d.mode === 'resize') {
      const end = Math.max(d.origStart + SCHEDULE_GRID_MS, alignToGrid(d.origEnd + delta));
      patch(d.id, { end: new Date(end).toISOString() });
      return;
    }

    const start = alignToGrid(d.origStart + delta);
    const end = start + (d.origEnd - d.origStart);
    let colIndex = -1;
    for (let i = 0; i < d.cols.length; i++) {
      const c = d.cols[i];
      if (c && e.clientX >= c.left && e.clientX <= c.right) { colIndex = i; break; }
    }
    const next: Partial<Draft> = {
      start: new Date(start).toISOString(),
      end: new Date(end).toISOString(),
    };
    if (colIndex >= 0) next.roomId = colIndex === 0 ? null : rooms[colIndex - 1]?.id ?? null;
    patch(d.id, next);
  }, [patch, rooms]);

  const endDrag = useCallback((e: RPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (d.moved) {
      suppressClick.current = true;
      announce(d.id);
    }
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }, [announce]);

  /* ---------------------------------------------------------- 键盘等价物 */
  /* WCAG 2.1 SC 2.5.7:所有拖拽操作都必须有单指针 / 键盘替代路径。 */

  const onCardKeyDown = useCallback((e: RKeyboardEvent<HTMLButtonElement>, id: string) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    const col = it.roomId ? rooms.findIndex((r) => r.id === it.roomId) + 1 : 0;
    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (e.shiftKey) resizeBy(id, -SCHEDULE_GRID_MS); else moveBy(id, -SCHEDULE_GRID_MS);
        return;
      case 'ArrowDown':
        e.preventDefault();
        if (e.shiftKey) resizeBy(id, SCHEDULE_GRID_MS); else moveBy(id, SCHEDULE_GRID_MS);
        return;
      case 'ArrowLeft':
        e.preventDefault();
        moveToColumn(id, col - 1);
        return;
      case 'ArrowRight':
        e.preventDefault();
        moveToColumn(id, col + 1);
        return;
      default:
    }
  }, [items, rooms, moveBy, resizeBy, moveToColumn]);

  /* ------------------------------------------------------------ 增删 */

  const addSession = useCallback(() => {
    const dayStart = zonedToUtc(day, 0, eventTimezone);
    const roomId = rooms[0]?.id ?? null;
    // 从 09:00 起找第一个不与同会场既有场次重叠的 30 分钟空档
    let start = dayStart + 9 * 60 * 60_000;
    const busySlots = live
      .filter((d) => d.roomId === roomId)
      .map((d) => [Date.parse(d.start), Date.parse(d.end)] as const);
    for (let i = 0; i < 48; i++) {
      const s = start + i * 30 * 60_000;
      const e = s + 30 * 60_000;
      if (!busySlots.some(([bs, be]) => s < be && e > bs)) { start = s; break; }
    }
    newCounter.current += 1;
    const draft: Draft = {
      id: `${NEW_PREFIX}${newCounter.current}`,
      title: tt('schedNewSessionTitle'),
      kind: 'talk',
      roomId,
      start: new Date(start).toISOString(),
      end: new Date(start + 30 * 60_000).toISOString(),
      speakers: [],
    };
    setItems((prev) => [...prev, draft]);
    setActiveId(draft.id);
    setNotice(tt('schedCreatedAnnounce'));
  }, [day, eventTimezone, rooms, live, tt]);

  const removeSession = useCallback((id: string) => {
    const it = items.find((i) => i.id === id);
    setItems((prev) => (id.startsWith(NEW_PREFIX)
      ? prev.filter((i) => i.id !== id)
      : prev.map((i) => (i.id === id ? { ...i, deleted: true } : i))));
    setActiveId(null);
    setNotice(tt('schedDeletedAnnounce', { title: it?.title ?? '' }));
  }, [items, tt]);

  /* ------------------------------------------------------- 保存 / 发布 */

  const doSave = useCallback(() => {
    setError('');
    setBusy('save');
    startTransition(async () => {
      const res = await saveScheduleAction({
        orgSlug,
        eventSlug,
        drafts: items.map((i) => ({
          id: i.id,
          title: i.title,
          kind: i.kind,
          roomId: i.roomId,
          start: i.start,
          end: i.end,
          speakers: i.speakers,
          deleted: i.deleted === true,
        })),
      });
      setBusy(null);
      if (!res.ok || !res.sessions) {
        setError(res.error ?? tt('schedConflictBlocked'));
        return;
      }
      const idMap = res.idMap ?? {};
      setItems(res.sessions.map((s) => ({ ...s })));
      setBaseline(res.sessions);
      setActiveId((cur) => (cur && idMap[cur] ? idMap[cur] : cur));
      setNotice(tt('schedSaved'));
    });
  }, [items, orgSlug, eventSlug, tt]);

  const doPublish = useCallback(() => {
    setError('');
    if (unsaved > 0) { setError(tt('schedSaveFirst')); return; }
    setBusy('publish');
    startTransition(async () => {
      const res = await publishScheduleAction({ orgSlug, eventSlug });
      setBusy(null);
      if (!res.ok || res.version === undefined || !res.sessions) {
        setError(res.error ?? tt('schedConflictBlocked'));
        return;
      }
      setSnap({
        version: res.version,
        publishedAt: res.publishedAt ?? new Date().toISOString(),
        sessions: res.sessions,
      });
      setBaseline(res.sessions);
      setNotice(tt('schedPublished', { v: res.version }));
    });
  }, [unsaved, orgSlug, eventSlug, tt]);

  /* ------------------------------------------------------------ 渲染 */

  const active = activeId ? items.find((i) => i.id === activeId && !i.deleted) ?? null : null;

  // 面板打开时把焦点带过去,关闭时还给卡片
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active && panelRef.current) {
      const first = panelRef.current.querySelector<HTMLInputElement>('input, select');
      first?.focus();
    }
  }, [active?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const focusCard = (id: string) => {
    const target = items.find((i) => i.id === id);
    if (target) {
      const idx = dayList.indexOf(dayKeyIn(Date.parse(target.start), eventTimezone));
      if (idx >= 0) setDayIndex(idx);
    }
    requestAnimationFrame(() => {
      const el = cardRefs.current.get(id);
      el?.focus();
      el?.scrollIntoView({ block: 'center' });
    });
  };

  const onTabKeyDown = (e: RKeyboardEvent<HTMLButtonElement>, index: number) => {
    const n = dayList.length;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % n;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + n) % n;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = n - 1;
    if (next < 0) return;
    e.preventDefault();
    setDayIndex(next);
    tabRefs.current[next]?.focus();
  };

  const cols = rooms.length + 1;
  const template = `var(--sched-gutter) repeat(${cols}, minmax(0, 1fr))`;
  const panelId = `${uid}-panel`;
  const hintId = `${uid}-hint`;
  const tabId = (d: string) => `${uid}-tab-${d}`;

  return (
    <div className={styles.root}>
      {/* ------------------------------------------------------ 工具条 */}
      <div className={styles.toolbar}>
        <div className={styles.status}>
          <p className={styles.statusLine}>
            <span className={unpublished > 0 ? styles.badgeWarn : styles.badgeOk}>
              {unpublished > 0
                ? tt('schedUnpublished', { n: unpublished })
                : (snap ? tt('schedAllPublished') : tt('schedNeverPublished'))}
            </span>
            <span className={unsaved > 0 ? styles.badgeWarn : styles.badgeMuted}>
              {unsaved > 0 ? tt('schedUnsaved', { n: unsaved }) : tt('schedAllSaved')}
            </span>
            {snap && (
              <span className={styles.versionNote}>
                {tt('schedCurrentVersion', {
                  v: snap.version,
                  at: new Intl.DateTimeFormat(INTL_LOCALE[locale], {
                    timeZone: eventTimezone, dateStyle: 'medium', timeStyle: 'short',
                  }).format(new Date(snap.publishedAt)),
                })}
              </span>
            )}
          </p>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.btnGhost} onClick={addSession}>
            {tt('schedNewSession')}
          </button>
          <button
            type="button"
            className={styles.btnSecondary}
            onClick={doSave}
            disabled={pending || unsaved === 0}
          >
            {busy === 'save' ? tt('schedSaving') : tt('schedSave')}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={doPublish}
            disabled={pending || conflicts.length > 0}
          >
            {busy === 'publish' ? tt('schedPublishing') : tt('schedPublish')}
          </button>
        </div>
      </div>

      <p className={styles.hint} id={hintId}>{tt('schedKeyboardHint')}</p>
      <p className={styles.hint}>{tt('schedCollabNote')}</p>

      {/* 状态播报:拖拽 / 键盘移动的结果、保存与发布结果 */}
      <p className={styles.srOnly} role="status">{notice}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}

      {/* -------------------------------------------------- 冲突清单 */}
      <section
        className={conflicts.length > 0 ? styles.conflictBox : styles.conflictBoxOk}
        aria-labelledby={`${uid}-conflicts`}
      >
        <h2 className={styles.conflictTitle} id={`${uid}-conflicts`}>
          {conflicts.length > 0
            ? tt('schedConflictHeading', { n: conflicts.length })
            : tt('schedConflictNone')}
        </h2>
        {conflicts.length > 0 && (
          <ul className={styles.conflictList}>
            {conflicts.map((c: Conflict) => (
              <li key={`${c.a}-${c.b}`} className={styles.conflictItem}>
                <span className={styles.conflictText}>
                  {tt('schedConflictItem', {
                    room: roomName(c.roomId),
                    a: titleOf(c.a),
                    b: titleOf(c.b),
                  })}
                </span>
                <button
                  type="button"
                  className={styles.conflictGoto}
                  onClick={() => focusCard(c.b)}
                >
                  {tt('schedConflictGoto')}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------- 日期 tab */}
      <div className={styles.tabs} role="tablist" aria-label={tt('schedDayTabsLabel')}>
        {dayList.map((d, i) => {
          const selected = d === day;
          const count = live.filter(
            (x) => dayKeyIn(Date.parse(x.start), eventTimezone) === d,
          ).length;
          return (
            <button
              key={d}
              type="button"
              role="tab"
              id={tabId(d)}
              className={styles.tab}
              aria-selected={selected}
              aria-controls={selected ? panelId : undefined}
              tabIndex={selected ? 0 : -1}
              ref={(el) => { tabRefs.current[i] = el; }}
              onClick={() => setDayIndex(i)}
              onKeyDown={(e) => onTabKeyDown(e, i)}
            >
              <span className={styles.tabIndex}>{tt('schedDayNth', { n: i + 1 })}</span>
              <span className={styles.tabDate}>{formatDayLabel(d, INTL_LOCALE[locale])}</span>
              <span className={styles.tabCount}>{tt('schedSessionCount', { n: count })}</span>
            </button>
          );
        })}
      </div>

      <div className={styles.workspace}>
        {/* ------------------------------------------------ 编辑网格 */}
        <section
          className={styles.gridPane}
          role="tabpanel"
          id={panelId}
          aria-labelledby={tabId(day)}
          tabIndex={0}
        >
          <div className={styles.gridScroll}>
            <div className={styles.roomHead} style={cssVars({ gridTemplateColumns: template })}>
              <span className={styles.roomHeadGutter} aria-hidden="true" />
              <span className={styles.roomHeadCell}>
                <span className={styles.roomHeadName}>{tt('schedUnassignedRoom')}</span>
              </span>
              {rooms.map((r) => (
                <span key={r.id} className={styles.roomHeadCell}>
                  <span className={styles.roomHeadName}>{r.name}</span>
                  {r.location && <span className={styles.roomHeadLoc}>{r.location}</span>}
                </span>
              ))}
            </div>

            <div
              className={styles.grid}
              ref={gridRef}
              role="list"
              style={cssVars({ gridTemplateColumns: template })}
            >
              {Array.from({ length: cols }, (_, i) => (
                <div
                  key={`col-${i}`}
                  className={styles.col}
                  aria-hidden="true"
                  ref={(el) => { colRefs.current[i] = el; }}
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

              {layout.placed.map(({ draft, colIndex, rowStart, rowEnd }) => {
                const clash = conflictIds.has(draft.id);
                const kindKey = KIND_KEY[draft.kind];
                const className = [
                  styles.card,
                  styles[`kind_${draft.kind}`] ?? styles['kind_talk'] ?? '',
                  clash ? styles.cardClash : '',
                  activeId === draft.id ? styles.cardActive : '',
                ].filter(Boolean).join(' ');
                return (
                  <div
                    key={draft.id}
                    role="listitem"
                    className={className}
                    style={{ gridRow: `${rowStart} / ${rowEnd}`, gridColumn: colIndex + 2 }}
                  >
                    <button
                      type="button"
                      className={styles.cardButton}
                      aria-describedby={hintId}
                      ref={(el) => {
                        if (el) cardRefs.current.set(draft.id, el);
                        else cardRefs.current.delete(draft.id);
                      }}
                      onPointerDown={(e) => beginDrag(e, draft.id, 'move')}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                      onKeyDown={(e) => onCardKeyDown(e, draft.id)}
                      onClick={() => {
                        if (suppressClick.current) { suppressClick.current = false; return; }
                        setActiveId(draft.id);
                      }}
                    >
                      <span className={styles.cardTime}>
                        {hhmm(Date.parse(draft.start), eventTimezone)}
                        <span aria-hidden="true">–</span>
                        <span className={styles.srOnly}>{locale === 'zh' ? '至' : 'to'}</span>
                        {hhmm(Date.parse(draft.end), eventTimezone)}
                      </span>
                      {clash && (
                        <span className={styles.clashBadge}>{tt('schedConflictBadge')}</span>
                      )}
                      <span className={styles.cardTitle}>{draft.title}</span>
                      {draft.speakers.length > 0 && (
                        <span className={styles.cardSpeaker}>
                          {draft.speakers.map((s) => s.name).join('、')}
                        </span>
                      )}
                      <span className={styles.srOnly}>
                        {kindKey ? tt(kindKey) : draft.kind}
                        {' · '}
                        {roomName(draft.roomId)}
                      </span>
                    </button>
                    <span
                      className={styles.resizeHandle}
                      aria-hidden="true"
                      onPointerDown={(e) => beginDrag(e, draft.id, 'resize')}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      onPointerCancel={endDrag}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          {dayDrafts.length === 0 && (
            <p className={styles.emptyDay}>{tt('schedEmptyDay')}</p>
          )}
        </section>

        {/* --------------------------------------------------- 侧栏 */}
        {active && (
          <aside
            className={styles.side}
            ref={panelRef}
            aria-labelledby={`${uid}-side-title`}
          >
            <div className={styles.sideHead}>
              <h2 className={styles.sideTitle} id={`${uid}-side-title`}>
                {tt('schedEditPanel')}
              </h2>
              <button
                type="button"
                className={styles.sideClose}
                onClick={() => { const id = active.id; setActiveId(null); focusCard(id); }}
              >
                {tt('schedClosePanel')}
              </button>
            </div>

            <p className={styles.sideNote}>
              {tt('schedTimeInEventTz', { tz: eventTimezone })}
            </p>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${uid}-f-title`}>
                {tt('schedFieldTitle')}
              </label>
              <input
                id={`${uid}-f-title`}
                className={styles.input}
                type="text"
                value={active.title}
                onChange={(e) => patch(active.id, { title: e.target.value })}
              />
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${uid}-f-kind`}>
                  {tt('schedFieldKind')}
                </label>
                <select
                  id={`${uid}-f-kind`}
                  className={styles.input}
                  value={active.kind}
                  onChange={(e) => patch(active.id, { kind: e.target.value })}
                >
                  {SESSION_KINDS.map((k) => {
                    const key = KIND_KEY[k];
                    return <option key={k} value={k}>{key ? tt(key) : k}</option>;
                  })}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${uid}-f-room`}>
                  {tt('schedFieldRoom')}
                </label>
                <select
                  id={`${uid}-f-room`}
                  className={styles.input}
                  value={active.roomId ?? ''}
                  onChange={(e) => patch(active.id, { roomId: e.target.value || null })}
                >
                  <option value="">{tt('schedUnassignedRoom')}</option>
                  {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>

            <div className={styles.fieldRow}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${uid}-f-day`}>
                  {tt('schedFieldDay')}
                </label>
                <select
                  id={`${uid}-f-day`}
                  className={styles.input}
                  value={dayKeyIn(Date.parse(active.start), eventTimezone)}
                  onChange={(e) => {
                    const dur = Date.parse(active.end) - Date.parse(active.start);
                    const mins = minutesOfDay(Date.parse(active.start), eventTimezone);
                    const s = zonedToUtc(e.target.value, mins, eventTimezone);
                    patch(active.id, {
                      start: new Date(s).toISOString(),
                      end: new Date(s + dur).toISOString(),
                    });
                  }}
                >
                  {dayList.map((d) => (
                    <option key={d} value={d}>{formatDayLabel(d, INTL_LOCALE[locale])}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${uid}-f-start`}>
                  {tt('schedFieldStart')}
                </label>
                <input
                  id={`${uid}-f-start`}
                  className={styles.input}
                  type="time"
                  step={300}
                  value={hhmm(Date.parse(active.start), eventTimezone)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    if (h === undefined || m === undefined || Number.isNaN(h)) return;
                    const dur = Date.parse(active.end) - Date.parse(active.start);
                    const d0 = dayKeyIn(Date.parse(active.start), eventTimezone);
                    const s = zonedToUtc(d0, h * 60 + m, eventTimezone);
                    patch(active.id, {
                      start: new Date(s).toISOString(),
                      end: new Date(s + dur).toISOString(),
                    });
                  }}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`${uid}-f-end`}>
                  {tt('schedFieldEnd')}
                </label>
                <input
                  id={`${uid}-f-end`}
                  className={styles.input}
                  type="time"
                  step={300}
                  value={hhmm(Date.parse(active.end), eventTimezone)}
                  onChange={(e) => {
                    const [h, m] = e.target.value.split(':').map(Number);
                    if (h === undefined || m === undefined || Number.isNaN(h)) return;
                    const d0 = dayKeyIn(Date.parse(active.start), eventTimezone);
                    let end = zonedToUtc(d0, h * 60 + m, eventTimezone);
                    const start = Date.parse(active.start);
                    if (end <= start) end += 86_400_000; // 跨零点的夜场
                    patch(active.id, { end: new Date(end).toISOString() });
                  }}
                />
              </div>
            </div>

            <fieldset className={styles.speakers}>
              <legend className={styles.label}>{tt('schedFieldSpeakers')}</legend>
              {active.speakers.map((sp, i) => (
                <div key={`sp-${i}`} className={styles.speakerRow}>
                  <label className={styles.srOnly} htmlFor={`${uid}-sp-n-${i}`}>
                    {tt('schedFieldSpeakerName')}
                  </label>
                  <input
                    id={`${uid}-sp-n-${i}`}
                    className={styles.input}
                    type="text"
                    placeholder={tt('schedFieldSpeakerName')}
                    value={sp.name}
                    onChange={(e) => patch(active.id, {
                      speakers: active.speakers.map((s, j) => (
                        j === i ? { ...s, name: e.target.value } : s
                      )),
                    })}
                  />
                  <label className={styles.srOnly} htmlFor={`${uid}-sp-a-${i}`}>
                    {tt('schedFieldAffiliation')}
                  </label>
                  <input
                    id={`${uid}-sp-a-${i}`}
                    className={styles.input}
                    type="text"
                    placeholder={tt('schedFieldAffiliation')}
                    value={sp.affiliation ?? ''}
                    onChange={(e) => patch(active.id, {
                      speakers: active.speakers.map((s, j) => (
                        j === i ? { ...s, affiliation: e.target.value || null } : s
                      )),
                    })}
                  />
                  <button
                    type="button"
                    className={styles.rowRemove}
                    onClick={() => patch(active.id, {
                      speakers: active.speakers.filter((_, j) => j !== i),
                    })}
                  >
                    {tt('schedRemoveSpeaker', { n: i + 1 })}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => patch(active.id, {
                  speakers: [...active.speakers, { name: '', affiliation: null }],
                })}
              >
                {tt('schedAddSpeaker')}
              </button>
            </fieldset>

            <button
              type="button"
              className={styles.btnDanger}
              onClick={() => removeSession(active.id)}
            >
              {tt('schedDeleteSession')}
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}

function stripDraft(d: Draft): SnapshotSession {
  return {
    id: d.id,
    title: d.title,
    kind: d.kind,
    roomId: d.roomId,
    start: d.start,
    end: d.end,
    speakers: d.speakers,
  };
}
