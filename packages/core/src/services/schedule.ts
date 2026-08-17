/** 日程冲突检测(ch05 §5.1) */
export interface Slot { id: string; roomId: string | null; startsAt: Date; endsAt: Date }

export interface Conflict { a: string; b: string; roomId: string }

/** 同一会场时间区间重叠即冲突 */
export function detectConflicts(slots: Slot[]): Conflict[] {
  const byRoom = new Map<string, Slot[]>();
  for (const s of slots) {
    if (!s.roomId) continue;
    const list = byRoom.get(s.roomId) ?? [];
    list.push(s);
    byRoom.set(s.roomId, list);
  }
  const out: Conflict[] = [];
  for (const [roomId, list] of byRoom) {
    const sorted = [...list].sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]!;
      const cur = sorted[i]!;
      if (cur.startsAt < prev.endsAt) out.push({ a: prev.id, b: cur.id, roomId });
    }
  }
  return out;
}

/** 按天分组(公共日程页) */
export function groupByDay<T extends { startsAt: Date }>(
  items: T[], timeZone: string,
): { day: string; items: T[] }[] {
  const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const map = new Map<string, T[]>();
  for (const it of items) {
    const day = fmt.format(it.startsAt);
    const list = map.get(day) ?? [];
    list.push(it);
    map.set(day, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([day, list]) => ({ day, items: list }));
}

/* ==========================================================================
   编排器共享逻辑(ch05 §5.1)
   本模块必须保持「纯」—— 不 import @yumeet/db、不 import node: 内置模块。
   编排器是客户端组件,冲突判定要在拖拽结束时同端同步执行,发布前服务端用
   同一份代码复核(§5.1.2「不允许出现两套判定逻辑」),因此双端共享此文件。
   数据库读写在 ./schedule-store.ts,只在服务端 import。
   ========================================================================== */

/** 纵轴时间粒度:5 分钟,禁止自由像素定位(ch05 §5.1) */
export const SCHEDULE_GRID_MIN = 5;
export const SCHEDULE_GRID_MS = SCHEDULE_GRID_MIN * 60_000;

/** 场次类型(与 db schema sessions.kind 的取值域一致) */
export const SESSION_KINDS = ['talk', 'keynote', 'break', 'poster', 'social'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export function isSessionKind(v: string): v is SessionKind {
  return (SESSION_KINDS as readonly string[]).includes(v);
}

/** 对齐到 5 分钟网格 */
export function alignToGrid(ms: number): number {
  return Math.round(ms / SCHEDULE_GRID_MS) * SCHEDULE_GRID_MS;
}

/** 快照 / 编排器传输用的场次形状:时间一律 UTC ISO 8601 字符串,可直接 JSON 化 */
export interface SnapshotSpeaker { name: string; affiliation: string | null }

export interface SnapshotSession {
  id: string;
  title: string;
  kind: string;
  roomId: string | null;
  start: string;
  end: string;
  speakers: SnapshotSpeaker[];
}

export interface SnapshotRoom {
  id: string;
  name: string;
  location: string | null;
  position: number;
}

/** scheduleSnapshots.payload 的形状(ch05 §5.1.3:不可变 JSONB 快照) */
export interface SchedulePayload {
  timezone: string;
  rooms: SnapshotRoom[];
  sessions: SnapshotSession[];
}

/** 从数据库行构造快照 payload(键顺序固定,便于人工比对与 diff) */
export function buildSchedulePayload(input: {
  timezone: string;
  rooms: { id: string; name: string; location: string | null; position: number }[];
  sessions: {
    id: string; title: string; kind: string; roomId: string | null;
    startsAt: Date; endsAt: Date;
    speakers: { name: string; affiliation?: string | undefined }[];
  }[];
}): SchedulePayload {
  return {
    timezone: input.timezone,
    rooms: input.rooms
      .map((r) => ({ id: r.id, name: r.name, location: r.location, position: r.position }))
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)),
    sessions: input.sessions
      .map((s): SnapshotSession => ({
        id: s.id,
        title: s.title,
        kind: s.kind,
        roomId: s.roomId,
        start: s.startsAt.toISOString(),
        end: s.endsAt.toISOString(),
        speakers: (s.speakers ?? []).map((sp) => ({
          name: sp.name,
          affiliation: sp.affiliation ?? null,
        })),
      }))
      .sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id)),
  };
}

/** payload 的运行时形状校验 —— JSONB 列读出来是 unknown,不能直接当类型用 */
export function parseSchedulePayload(value: unknown): SchedulePayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (!Array.isArray(o['sessions'])) return null;
  const sessions: SnapshotSession[] = [];
  for (const raw of o['sessions']) {
    if (typeof raw !== 'object' || raw === null) continue;
    const s = raw as Record<string, unknown>;
    if (typeof s['id'] !== 'string' || typeof s['start'] !== 'string' || typeof s['end'] !== 'string') continue;
    const speakers: SnapshotSpeaker[] = [];
    if (Array.isArray(s['speakers'])) {
      for (const rawSp of s['speakers']) {
        if (typeof rawSp !== 'object' || rawSp === null) continue;
        const sp = rawSp as Record<string, unknown>;
        if (typeof sp['name'] !== 'string') continue;
        speakers.push({
          name: sp['name'],
          affiliation: typeof sp['affiliation'] === 'string' ? sp['affiliation'] : null,
        });
      }
    }
    sessions.push({
      id: s['id'],
      title: typeof s['title'] === 'string' ? s['title'] : '',
      kind: typeof s['kind'] === 'string' ? s['kind'] : 'talk',
      roomId: typeof s['roomId'] === 'string' ? s['roomId'] : null,
      start: s['start'],
      end: s['end'],
      speakers,
    });
  }
  const rooms: SnapshotRoom[] = [];
  if (Array.isArray(o['rooms'])) {
    for (const raw of o['rooms']) {
      if (typeof raw !== 'object' || raw === null) continue;
      const r = raw as Record<string, unknown>;
      if (typeof r['id'] !== 'string') continue;
      rooms.push({
        id: r['id'],
        name: typeof r['name'] === 'string' ? r['name'] : '',
        location: typeof r['location'] === 'string' ? r['location'] : null,
        position: typeof r['position'] === 'number' ? r['position'] : 0,
      });
    }
  }
  return {
    timezone: typeof o['timezone'] === 'string' ? o['timezone'] : 'UTC',
    rooms,
    sessions,
  };
}

/** 发布确认用的四类 diff(ch05 §5.1.3:新增 / 移动 / 删除 / 时长变化) */
export interface ScheduleDiff {
  added: string[];
  removed: string[];
  moved: string[];
  resized: string[];
  edited: string[];
  total: number;
}

const EMPTY_DIFF_KEYS = ['added', 'removed', 'moved', 'resized', 'edited'] as const;

/**
 * 当前草稿与最近一版快照的差异。previous 为 null(从未发布)时,
 * 现存全部场次都算「新增」—— 顶部的「有 N 处改动未发布」即取 total。
 */
export function diffSchedule(
  current: SnapshotSession[],
  previous: SnapshotSession[] | null,
): ScheduleDiff {
  const diff: ScheduleDiff = { added: [], removed: [], moved: [], resized: [], edited: [], total: 0 };
  const prev = new Map((previous ?? []).map((s) => [s.id, s] as const));
  for (const cur of current) {
    const before = prev.get(cur.id);
    if (!before) { diff.added.push(cur.id); continue; }
    prev.delete(cur.id);
    const durBefore = Date.parse(before.end) - Date.parse(before.start);
    const durCur = Date.parse(cur.end) - Date.parse(cur.start);
    if (before.start !== cur.start || before.roomId !== cur.roomId) diff.moved.push(cur.id);
    else if (durBefore !== durCur) diff.resized.push(cur.id);
    else if (
      before.title !== cur.title
      || before.kind !== cur.kind
      || before.end !== cur.end
      || speakerKey(before.speakers) !== speakerKey(cur.speakers)
    ) diff.edited.push(cur.id);
  }
  for (const id of prev.keys()) diff.removed.push(id);
  for (const k of EMPTY_DIFF_KEYS) diff.total += diff[k].length;
  return diff;
}

function speakerKey(list: SnapshotSpeaker[]): string {
  return list.map((s) => `${s.name} ${s.affiliation ?? ''}`).join('');
}

/** 冲突检测的字符串时间入口 —— 编排器持有的是 ISO 串,避免各处手写 new Date */
export function detectConflictsIso(
  sessions: { id: string; roomId: string | null; start: string; end: string }[],
): Conflict[] {
  return detectConflicts(sessions.map((s) => ({
    id: s.id,
    roomId: s.roomId,
    startsAt: new Date(s.start),
    endsAt: new Date(s.end),
  })));
}

export interface ScheduleValidationIssue {
  sessionId: string;
  code: 'empty_title' | 'bad_kind' | 'bad_time' | 'unknown_room' | 'not_on_grid';
}

/**
 * 保存前的结构校验(前端提交前调用一次,服务端落库前必须再调用一次)。
 * 冲突单独由 detectConflicts 判定,两者都通过才允许发布。
 */
export function validateSchedule(
  sessions: SnapshotSession[],
  roomIds: readonly string[],
): ScheduleValidationIssue[] {
  const known = new Set(roomIds);
  const issues: ScheduleValidationIssue[] = [];
  for (const s of sessions) {
    if (s.title.trim().length === 0) issues.push({ sessionId: s.id, code: 'empty_title' });
    if (!isSessionKind(s.kind)) issues.push({ sessionId: s.id, code: 'bad_kind' });
    const start = Date.parse(s.start);
    const end = Date.parse(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      issues.push({ sessionId: s.id, code: 'bad_time' });
    } else if (start % SCHEDULE_GRID_MS !== 0 || end % SCHEDULE_GRID_MS !== 0) {
      issues.push({ sessionId: s.id, code: 'not_on_grid' });
    }
    if (s.roomId !== null && !known.has(s.roomId)) {
      issues.push({ sessionId: s.id, code: 'unknown_room' });
    }
  }
  return issues;
}
