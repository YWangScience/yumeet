'use client';

import {
  useEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent,
} from 'react';
import Link from 'next/link';
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
  /** 有对应摘要时的详情页地址;没有则卡片不可点(如茶歇、午餐) */
  href?: string | null;
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
/*
 * 卡片的最小格数。
 *
 * 这个值曾经导致相邻两场重叠:报告时长 22 分钟(4.4 → 4 格),
 * 但间隔只有 24 分钟(约 4.8 格),把最小值抬到 5 就会伸进下一场的格子。
 * 高度不该靠「多占几格」换取 —— 那是在时间轴上撒谎。
 * 改为按真实时长占格,内容放不下时提高每格的像素高度(--sched-slot-h),
 * 时间轴与版面于是各自成立。
 */
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
  /** 因为无并行而横跨整行时,原本所属的会场(仍要显示,只是不再占一列) */
  soloRoom?: { id: string; name: string; location?: string | null } | null;
}

interface Layout {
  dayRooms: ScheduleRoom[];
  rows: number;
  ticks: { key: string; row: number; label: string }[];
  /** 逐行标记:该 5 分钟行是否位于被压缩的空档内 */
  compressed?: boolean[];
  /** 有并行会场的行区间,列线只画在这些区间上 */
  colBands?: { start: number; span: number }[];
  /** 有内容但无并行的行:用压缩格高 */
  soloRows?: boolean[];
  /** 有内容但无并行的整段区间,吸顶行在这里只写主会场 */
  soloBands?: { start: number; span: number }[];
  /** 为会场表头插入的行:固定高度,不代表任何时段 */
  headRows?: boolean[];
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
    return { dayRooms, rows: 1, ticks: [], placed: [], firstMs: 0, lastMs: 0, compressed: [], colBands: [], soloRows: [], soloBands: [], headRows: [] };
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

  const placedRaw = day.sessions.map((session): Placed => {
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

  /*
   * 「无并行」的场次横跨整行。
   *
   * 这个会议(以及多数会议)的一天是「上午全体大会 + 下午平行分会」。
   * 六列网格是按下午画的,到了上午就变成一列内容配五列空白 ——
   * 屏幕上九成是空网格,而唯一那张卡片还被压在六分之一的宽度里,
   * 标题要折三行才放得下。
   *
   * 判据不是「有没有 roomId」,而是「这个时间区间里别的会场是不是真的空着」。
   * 空着就没有对齐的必要,把整行让给它:标题一行放得下,讲者与单位也回来了。
   */
  const placed = placedRaw.map((p): Placed => {
    if (p.colIndex < 0) return p;
    // 主会场那一列始终保留:上午的全体大会就在这里,
    // 若也横跨整行,读者会以为主会场整个上午都空着。
    const overlapsOther = placedRaw.some((q) => (
      q !== p && q.colIndex >= 0 && q.colIndex !== p.colIndex
      && q.rowStart < p.rowEnd && p.rowStart < q.rowEnd
    ));
    return overlapsOther ? p : { ...p, colIndex: -1, soloRoom: p.room };
  });

  /*
   * 空档压缩。
   *
   * 会议的一天常常是「上午全体大会、下午六个分会并行」,于是上午
   * 五列全空、下午挤成一团。均一行高会把这段空白照原比例画出来 ——
   * 一屏里九成是空网格,真正的内容反而要往下翻。
   *
   * 所以把连续 30 分钟以上完全没有议程的时段按比例压扁(仍保留先后与相对间隔,
   * 不是删掉),读者仍看得出「这里空了一段」,但不必为此滚过两屏。
   */
  const busy = new Array<boolean>(rows + 2).fill(false);
  for (const p of placed) {
    for (let r = p.rowStart; r < p.rowEnd; r++) busy[r] = true;
  }
  /*
   * 30 分钟以上的空档压缩。
   *
   * 阈值原本是 6 格(30 分钟),但全体大会每场之间只隔十几分钟,
   * 达不到阈值,于是那段空白按原比例画出来 —— 一屏里每两条报告之间
   * 都空出小半屏。把阈值降到 2 格(10 分钟):换场的空当没有阅读价值,
   * 留一点点示意先后即可。
   */
  const GAP_MIN_ROWS = 2;
  const compressed = new Array<boolean>(rows + 2).fill(false);
  let run = 0;
  for (let r = 1; r <= rows + 1; r++) {
    if (!busy[r]) { run++; continue; }
    if (run >= GAP_MIN_ROWS) {
      for (let k = r - run + 1; k < r; k++) compressed[k] = true;
    }
    run = 0;
  }
  if (run >= GAP_MIN_ROWS) {
    for (let k = rows + 2 - run + 1; k <= rows; k++) compressed[k] = true;
  }

  /*
   * 列线只画在真正有并行的时段。
   *
   * 上午只有一个会场在用时,六条竖线划出的五个空栏并不表达任何信息 ——
   * 它们只是把「这里什么都没有」画了五遍。把列线切成若干段,
   * 跟着并行时段出现和消失,版面就跟着会议的结构走。
   */
  const parallel = new Array<boolean>(rows + 2).fill(false);
  for (const p of placed) {
    if (p.colIndex < 0) continue;
    for (let r = p.rowStart; r < p.rowEnd; r++) parallel[r] = true;
  }
  // 有内容但没有并行的行:格高可以压,不必按时长等比
  const soloRows = new Array<boolean>(rows + 2).fill(false);
  for (const p of placed) {
    if (p.colIndex >= 0) continue;
    for (let r = p.rowStart; r < p.rowEnd; r++) soloRows[r] = true;
  }
  for (let r = 1; r <= rows + 1; r++) if (parallel[r]) soloRows[r] = false;

  /*
   * 相邻两场报告之间常有几分钟的换场空当,那几行没有任何卡片。
   * 若照此断开,一个下午会被切成十几段,每段都顶一行会场表头 ——
   * 表头于是每隔两屏就重复一次。所以短于 30 分钟的空当不算断开:
   * 它是同一场并行的内部间隙,不是并行结束。
   */
  const BAND_JOIN_ROWS = 6;
  const rawBands: { start: number; span: number }[] = [];
  let bandStart = 0;
  for (let r = 1; r <= rows + 1; r++) {
    if (parallel[r] && bandStart === 0) bandStart = r;
    if ((!parallel[r] || r === rows + 1) && bandStart !== 0) {
      rawBands.push({ start: bandStart, span: r - bandStart });
      bandStart = 0;
    }
  }
  /*
   * 无并行但有内容的区间(上午的全体大会)。
   * 吸顶行在这里也要出现,只是只写主会场 —— 读者滚到一半时同样需要
   * 知道「现在看的是哪个厅」,不能因为只有一个厅就不告诉他。
   */
  const rawSolo: { start: number; span: number }[] = [];
  let sStart = 0;
  for (let r = 1; r <= rows + 1; r++) {
    const on = soloRows[r] === true;
    if (on && sStart === 0) sStart = r;
    if ((!on || r === rows + 1) && sStart !== 0) {
      rawSolo.push({ start: sStart, span: r - sStart });
      sStart = 0;
    }
  }
  /*
   * 与并行段同理:两场全体报告之间隔着十几分钟,若照此断开,
   * 一个上午会被切成五六段,每段只有几十像素高 —— 吸顶行永远够不到
   * 「顶部已滚过、底部还没上来」的条件,于是整个上午都不出现。
   * 间隔在一小时以内的并作一段。
   */
  const SOLO_JOIN_ROWS = 12;
  const soloBands: { start: number; span: number }[] = [];
  for (const b of rawSolo) {
    const prev = soloBands[soloBands.length - 1];
    if (prev && b.start - (prev.start + prev.span) <= SOLO_JOIN_ROWS) {
      prev.span = b.start + b.span - prev.start;
    } else {
      soloBands.push({ ...b });
    }
  }

  const colBands: { start: number; span: number }[] = [];
  for (const b of rawBands) {
    const prev = colBands[colBands.length - 1];
    if (prev && b.start - (prev.start + prev.span) <= BAND_JOIN_ROWS) {
      prev.span = b.start + b.span - prev.start;
    } else {
      colBands.push({ ...b });
    }
  }

  /*
   * 给每段并行的会场表头插入一行专属的格子。
   *
   * 表头之前是直接放在区间的起始行上,而那一行同时也是第一批报告的位置 ——
   * 六个列名有五个被卡片压住,只有空着的那列露得出来。
   * 解决办法不是把表头挪走(列名就该长在表里),而是给它腾出位置:
   * 在每段并行开始前插一行,所有后续内容整体下移一行。
   * 时间轴的比例不受影响 —— 插入的这一行不代表任何时段,
   * 它只是版面上的一条,高度固定。
   */
  const HEAD_ROWS = 1;
  const starts = colBands.map((b) => b.start).sort((a, b) => a - b);
  const insertsBefore = (r: number) => starts.filter((b) => b <= r).length;
  const map = (r: number) => r + insertsBefore(r);
  const rows2 = rows + starts.length * HEAD_ROWS;

  const compressed2 = new Array<boolean>(rows2 + 2).fill(false);
  const soloRows2 = new Array<boolean>(rows2 + 2).fill(false);
  const headRows = new Array<boolean>(rows2 + 2).fill(false);
  for (let r = 1; r <= rows + 1; r++) {
    compressed2[map(r)] = compressed[r] === true;
    soloRows2[map(r)] = soloRows[r] === true;
  }
  for (const b of starts) headRows[map(b) - 1] = true;

  return {
    dayRooms,
    rows: rows2,
    ticks: ticks.map((t) => ({ ...t, row: map(t.row) })),
    placed: placed.map((p) => ({ ...p, rowStart: map(p.rowStart), rowEnd: map(p.rowEnd) })),
    firstMs,
    lastMs,
    compressed: compressed2,
    soloRows: soloRows2,
    headRows,
    colBands: colBands.map((b) => ({ start: map(b.start), span: b.span + insertsBefore(b.start + b.span) - insertsBefore(b.start) })),
    soloBands: soloBands.map((b) => ({ start: map(b.start), span: b.span + insertsBefore(b.start + b.span) - insertsBefore(b.start) })),
  };
}

export function ScheduleGrid({ days, rooms, eventTimezone, locale }: Props) {
  const [selected, setSelected] = useState(0);
  // SSR 与首帧一律用会场时区渲染,水合后再切到浏览者时区,避免 hydration mismatch
  const [viewerTz, setViewerTz] = useState<string | null>(null);
  const [showVenueTime, setShowVenueTime] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  /** 吸顶行当前该显示哪一套列名:全部会场 / 只有主会场 / 不显示 */
  const [stuck, setStuck] = useState<'none' | 'solo' | 'parallel'>('none');

  /*
   * 判断吸顶栏该不该出现:看吸顶线(顶栏下沿)是否落在某段并行区间内,
   * 且该段自己的表头已经滚过去了 —— 表头还看得见时再叠一层是多余的。
   * 用 rAF 节流,滚动时不做多余的布局读取。
   */
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      // 吸顶线 = 顶栏 + 日期条,与 CSS 里 .roomHeadStuck 的 top 保持同一个算式
      const cs = rootRef.current ? getComputedStyle(rootRef.current) : null;
      const navH = parseFloat(cs?.getPropertyValue('--sched-nav-h') || '48') || 48;
      const tabsH = parseFloat(cs?.getPropertyValue('--sched-tabs-h') || '64') || 64;
      const line = navH + tabsH;
      /*
       * 列名现在只此一处,所以不能只在「滚进某段」时才出现 ——
       * 页面刚打开、还没滚动时同样要说清楚这些报告在哪个厅。
       *
       * 规则:吸顶线落在哪一段里就显示那一段的列名;
       * 还没滚到任何一段时,显示最靠前那一段的 —— 它就是接下来要读的内容。
       */
      const ranges = [...el.querySelectorAll<HTMLElement>('[data-band-range]')]
        .map((r) => ({ el: r, box: r.getBoundingClientRect() }))
        .sort((a, b) => a.box.top - b.box.top);
      if (ranges.length === 0) { setStuck('none'); return; }

      const kindOf = (r: HTMLElement) =>
        (r.dataset['bandRange'] === 'solo' ? 'solo' : 'parallel') as 'solo' | 'parallel';

      const hit = ranges.find((r) => r.box.top < line - 24 && r.box.bottom > line + 24);
      if (hit) { setStuck(kindOf(hit.el)); return; }

      // 整张表都还在下方(或已全部滚过)时,跟着最近的一段走
      const ahead = ranges.find((r) => r.box.top >= line - 24);
      setStuck(kindOf((ahead ?? ranges[ranges.length - 1]!).el));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [days, selected]);

  /*
   * 从首页「另有 N 场」跳过来时带着 #day-YYYY-MM-DD。
   * 日程是分日签的,单纯滚动没用 —— 得把对应那一天选中,
   * 否则人落地看到的还是第一天,得自己再找一次。
   */
  useEffect(() => {
    const applyHash = () => {
      const m = /^#day-(\d{4}-\d{2}-\d{2})$/.exec(window.location.hash);
      if (!m) return;
      const i = days.findIndex((d) => d.day === m[1]);
      if (i >= 0) {
        setSelected(i);
        rootRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    };
    applyHash();
    window.addEventListener('hashchange', applyHash);
    return () => window.removeEventListener('hashchange', applyHash);
  }, [days]);

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

  // 逐行高度:普通行取 --sched-slot-h,空档内的行取压缩高度。
  // 把连续同高的行合成 repeat(n, h),避免生成上百段的超长声明。
  const rowTemplate = (() => {
    const gap = layout.compressed ?? [];
    const solo = layout.soloRows ?? [];
    // 三档行高:空档最矮、无并行时段其次、有并行的时段用完整格高
    const head = layout.headRows ?? [];
    const tierOf = (r: number) =>
      head[r] ? 'head' : (gap[r] ? 'gap' : (solo[r] ? 'solo' : 'full'));
    // 无并行的行用 minmax(…, auto):标题折成两行时这一行跟着长高,
    // 而不是把字裁掉。有并行的行必须严格等比,否则各会场对不齐。
    const size: Record<string, string> = {
      gap: 'var(--sched-slot-gap-h)',
      solo: 'minmax(var(--sched-slot-solo-h), auto)',
      full: 'var(--sched-slot-h)',
      // 表头那一行不代表时段,高度按内容给
      head: 'max-content',
    };
    const parts: string[] = [];
    let i = 1;
    while (i <= layout.rows) {
      const t = tierOf(i);
      let n = 0;
      while (i + n <= layout.rows && tierOf(i + n) === t) n++;
      parts.push(`repeat(${n}, ${size[t]})`);
      i += n;
    }
    return parts.join(' ');
  })();
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
        <div className={styles.gridView} ref={gridRef}>
          {/*
            * 吸顶的会场行。
            *
            * 只在并行时段内出现:上午单会场时六个列名没有对应的列,
            * 一直挂在顶上既没用又占地方。它是浮层,不参与网格排布,
            * 所以不会像早先那样压住某一行卡片 —— 早先的做法是把表头
            * 塞进网格首行,于是每段并行的第一排报告都被盖掉半截。
            */}
          <div
            className={stuck === 'none' ? styles.roomHeadStuckHidden : styles.roomHeadStuck}
            style={cssVars({
              // 单会场时段只有一列内容,列模板跟着换,列名才落在对的位置
              gridTemplateColumns: stuck === 'solo'
                ? `var(--sched-gutter) minmax(0, 1fr)`
                : template,
            })}
            aria-hidden="true"
          >
            <span className={styles.roomHeadGutter} />
            {(stuck === 'solo' ? layout.dayRooms.slice(0, 1) : layout.dayRooms).map((r) => (
              <span key={r.id} className={styles.roomHeadCell}>
                <span className={styles.roomHeadName}>{r.name}</span>
              </span>
            ))}
          </div>
          <div
            className={styles.grid}
            role="list"
            style={cssVars({ gridTemplateColumns: template, gridTemplateRows: rowTemplate })}
          >
            <div
              className={styles.gridSpacer}
              aria-hidden="true"
              style={{ gridColumn: '1 / -1', gridRow: `1 / span ${layout.rows}` }}
            />
            {/* 每段并行的整段范围:不可见,只用来让吸顶栏知道
                「现在滚到的位置还在不在并行时段里」 */}
            {(layout.colBands ?? []).map((band) => (
              <div
                key={`range-${band.start}`}
                data-band-range="parallel"
                aria-hidden="true"
                className={styles.bandRange}
                style={{ gridColumn: '1 / -1', gridRow: `${band.start} / span ${band.span}` }}
              />
            ))}
            {(layout.soloBands ?? []).map((band) => (
              <div
                key={`solo-range-${band.start}`}
                data-band-range="solo"
                aria-hidden="true"
                className={styles.bandRange}
                style={{ gridColumn: '1 / -1', gridRow: `${band.start} / span ${band.span}` }}
              />
            ))}

            {(layout.colBands ?? []).flatMap((band) =>
              layout.dayRooms.map((r, i) => (
                <div
                  key={`line-${r.id}-${band.start}`}
                  className={styles.colLine}
                  aria-hidden="true"
                  style={{ gridColumn: i + 2, gridRow: `${band.start} / span ${band.span}` }}
                />
              )),
            )}

            {/*
              * 会场表头长在表里,占它自己那一行(布局阶段为每段并行插入的)。
              * 不再与第一批卡片抢同一行,所以六个列名都露得出来。
              */}
            {(layout.colBands ?? []).map((band) => (
              <div
                key={`head-${band.start}`}
                className={styles.roomHead}
                style={cssVars({
                  gridColumn: '1 / -1',
                  gridRow: String(band.start - 1),
                  gridTemplateColumns: template,
                })}
              >
                <span className={styles.roomHeadGutter} />
                {layout.dayRooms.map((r) => (
                  <span key={r.id} className={styles.roomHeadCell}>
                    <span className={styles.roomHeadName}>{r.name}</span>
                    {r.location && <span className={styles.roomHeadLoc}>{r.location}</span>}
                  </span>
                ))}
              </div>
            ))}

            {/*
              * 旧注释保留说明当初为何一度移走:
              *
              * 它排在并行区间的起始行,而那一行同时也是第一批报告的位置 ——
              * 六个列名里有五个被卡片压在下面,只有下午空着的主会场那列露得出来,
              * 于是看上去像是「Lunch 下面多了一行主会场」。
              *
              * 列名改由吸顶行独家负责:它是浮层,不与任何卡片抢位置,
              * 而且会随所处时段在「只有主会场」与「全部会场」之间切换。
              * 一处说清楚,好过两处各说一半。
              */}
            {/*
              * 整点刻度只画在并行时段。
              *
              * 全体大会那段是一行行的表格,每行左端就写着 09:00–09:45,
              * 左侧再标一次整点,同一个时间在一行里出现两遍。
              * 并行时段不同:那里卡片按列铺开、时间只在卡片内部,
              * 需要左侧刻度作为跨列的共同参照。
              */}
            {layout.ticks.filter((t) => (layout.soloRows ?? [])[t.row] !== true).map((t) => (
              <div
                key={t.key}
                className={styles.tick}
                aria-hidden="true"
                style={{ gridColumn: '1 / -1', gridRow: `${t.row} / span 12` }}
              >
                <span className={styles.tickLabel}>{t.label}</span>
              </div>
            ))}

            {layout.placed.map(({ session, room, rowStart, rowEnd, colIndex, soloRoom }) => {
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

              // 表格里只放「时间 · 讲者 · 标题」三样。
              // 摘要不进格子 —— 一格几十像素高,塞进整段摘要的结果是
              // 整张表既读不了标题也读不了摘要(点进详情页才是读摘要的地方)。
              const inner = (
                <>
                  {/* 时间与讲者是同级信息,放在一行:短卡片里这样能省下整整一行,
                      让标题保住两行 —— 22 分钟的报告只有六十来像素可用。
                      横跨整行的卡片不缺空间,会把单位与会场也补上(见 .cardWide)。 */}
                  <p className={styles.cardTime}>
                    <time dateTime={session.start}>{formatTime(new Date(session.start), timeZone)}</time>
                    <span className={styles.timeSep} aria-hidden="true">–</span>
                    <span className={styles.srOnly}>至</span>
                    <time dateTime={session.end}>{formatTime(new Date(session.end), timeZone)}</time>
                    <DayShift locale={locale} shift={shift} />
                  </p>
                  {/* 格子里只出主讲人。合作者堆到第二行会把标题挤掉半行,
                      而在这个尺度上「谁来讲」比「还有谁署名」重要得多;
                      完整作者名单在详情页。 */}
                  {session.speakers[0] && (
                    <p className={styles.speakers}>
                      <span className={styles.speakerName}>
                        {session.speakers[0].name}
                        {session.speakers.length > 1 && (
                          <span className={styles.speakerMore}>
                            {locale === 'zh' ? ' 等' : ' et al.'}
                          </span>
                        )}
                      </span>
                      {wide && session.speakers[0].affiliation && (
                        <span className={styles.speakerAff}>
                          {session.speakers[0].affiliation}
                        </span>
                      )}
                    </p>
                  )}
                  <div className={styles.cardBody}>
                    {/* 横排的整行卡片不挂类型标签:它所在的时段本来就只有主会场,
                        「全体大会」四个字在每一行重复一遍并不带来新信息 */}
                    {kicker && !wide && <span className={styles.kicker}>{kicker}</span>}
                    <h3 className={styles.cardTitle}>{session.title}</h3>
                  </div>
                  {/* 行内不再重复会场名:表头那一行已经写着主会场,
                      每条报告后面再挂一遍,一屏就是八九次同样的字 */}
                  <span className={styles.srOnly}>
                    {room ? (locale === 'zh' ? `会场:${room.name}` : `Room: ${room.name}`)
                      : (locale === 'zh' ? '全体活动,不限会场' : 'All-venue session')}
                  </span>
                </>
              );

              return (
                <div
                  key={session.id}
                  role="listitem"
                  className={className}
                  style={style}
                  title={session.title}
                >
                  {session.href
                    ? <Link href={session.href} className={styles.cardLink}>{inner}</Link>
                    : inner}
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
                  <h3 className={styles.tlTitle}>
                    {session.href
                      ? <Link href={session.href} className={styles.tlTitleLink}>{session.title}</Link>
                      : session.title}
                  </h3>
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
