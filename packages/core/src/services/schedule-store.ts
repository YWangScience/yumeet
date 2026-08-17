/**
 * 日程编排器的持久化层(ch05 §5.1)
 *   - 编辑直接写 sessions 表 = 草稿态
 *   - 「发布」把当前 sessions 集合物化为一条不可变的 scheduleSnapshots 记录,version 自增
 *
 * 本文件 import @yumeet/db,只能在服务端使用;纯逻辑(冲突检测、diff、校验)
 * 在 ./schedule.ts,由服务端与浏览器共享,保证「不允许出现两套判定逻辑」。
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import {
  db as defaultDb, events, rooms, sessions, scheduleSnapshots, type Db,
} from '@yumeet/db';
import { audit } from '../audit/index';
import {
  detectConflictsIso, validateSchedule, buildSchedulePayload, parseSchedulePayload,
  diffSchedule, isSessionKind, alignToGrid,
  type SchedulePayload, type SnapshotSession, type ScheduleDiff, type Conflict,
} from './schedule';
import type { Actor } from './registration';

export class ScheduleError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  /** 冲突 / 校验失败时回传给 UI,便于高亮对应场次 */
  readonly conflicts: Conflict[];
  constructor(code: string, message: string, httpStatus = 400, conflicts: Conflict[] = []) {
    super(message);
    this.name = 'ScheduleError';
    this.code = code;
    this.httpStatus = httpStatus;
    this.conflicts = conflicts;
  }
}

/** 编排器提交上来的一条草稿。id 以 `new:` 开头表示新建。 */
export interface SessionDraft {
  id: string;
  title: string;
  kind: string;
  roomId: string | null;
  start: string;
  end: string;
  speakers: { name: string; affiliation: string | null }[];
  deleted?: boolean;
}

export const NEW_SESSION_PREFIX = 'new:';

export interface ScheduleDraftView {
  rooms: { id: string; name: string; location: string | null; position: number }[];
  sessions: SnapshotSession[];
  snapshot: { version: number; publishedAt: string; sessions: SnapshotSession[] } | null;
  diff: ScheduleDiff;
}

/** 最近一版已发布快照 */
export async function latestScheduleSnapshot(eventId: string, db: Db = defaultDb) {
  const [row] = await db.select().from(scheduleSnapshots)
    .where(eq(scheduleSnapshots.eventId, eventId))
    .orderBy(desc(scheduleSnapshots.version))
    .limit(1);
  if (!row) return null;
  const payload = parseSchedulePayload(row.payload);
  if (!payload) return null;
  return { version: row.version, publishedAt: row.publishedAt, payload };
}

/** 编排器初始数据:草稿态 sessions + 会场 + 最近快照 + 二者的差异 */
export async function getScheduleDraft(
  eventId: string, db: Db = defaultDb,
): Promise<ScheduleDraftView> {
  const [roomRows, sessionRows, snap] = await Promise.all([
    db.select().from(rooms).where(eq(rooms.eventId, eventId)).orderBy(asc(rooms.position)),
    db.select().from(sessions)
      .where(and(eq(sessions.eventId, eventId), sql`${sessions.deletedAt} IS NULL`))
      .orderBy(asc(sessions.startsAt)),
    latestScheduleSnapshot(eventId, db),
  ]);

  const payload = buildSchedulePayload({ timezone: 'UTC', rooms: roomRows, sessions: sessionRows });

  return {
    rooms: roomRows.map((r) => ({
      id: r.id, name: r.name, location: r.location, position: r.position,
    })),
    sessions: payload.sessions,
    snapshot: snap
      ? {
          version: snap.version,
          publishedAt: snap.publishedAt.toISOString(),
          sessions: snap.payload.sessions,
        }
      : null,
    diff: diffSchedule(payload.sessions, snap?.payload.sessions ?? null),
  };
}

/** 规范化一条草稿:时间对齐 5 分钟网格、去掉空讲者行 */
function normalize(d: SessionDraft): SnapshotSession {
  const start = alignToGrid(Date.parse(d.start));
  const end = alignToGrid(Date.parse(d.end));
  return {
    id: d.id,
    title: d.title.trim().slice(0, 300),
    kind: isSessionKind(d.kind) ? d.kind : 'talk',
    roomId: d.roomId,
    start: Number.isFinite(start) ? new Date(start).toISOString() : d.start,
    end: Number.isFinite(end) ? new Date(end).toISOString() : d.end,
    speakers: d.speakers
      .filter((s) => s.name.trim().length > 0)
      .map((s) => ({
        name: s.name.trim().slice(0, 200),
        affiliation: s.affiliation && s.affiliation.trim().length > 0
          ? s.affiliation.trim().slice(0, 200)
          : null,
      })),
  };
}

export interface SaveResult {
  sessions: SnapshotSession[];
  diff: ScheduleDiff;
  /** 新建场次的临时 id → 落库后的真实 id */
  idMap: Record<string, string>;
}

/**
 * 保存草稿。服务端在写库前独立复核结构校验与冲突检测 —— 前端的实时提示只是
 * 反馈,不是许可(ch05 §5.1.2 双端同一份判定逻辑)。
 */
export async function saveScheduleDraft(
  input: { eventId: string; drafts: SessionDraft[]; actor: Actor },
  db: Db = defaultDb,
): Promise<SaveResult> {
  const [event] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!event) throw new ScheduleError('event_not_found', '活动不存在', 404);

  const roomRows = await db.select().from(rooms).where(eq(rooms.eventId, input.eventId));
  const roomIds = roomRows.map((r) => r.id);

  const kept = input.drafts.filter((d) => !d.deleted).map(normalize);
  const removedIds = input.drafts
    .filter((d) => d.deleted && !d.id.startsWith(NEW_SESSION_PREFIX))
    .map((d) => d.id);

  const issues = validateSchedule(kept, roomIds);
  if (issues.length > 0) {
    throw new ScheduleError(
      'invalid_schedule',
      `有 ${issues.length} 处字段不合法(标题为空 / 时间不合法 / 会场不存在)`,
    );
  }

  const conflicts = detectConflictsIso(kept);
  if (conflicts.length > 0) {
    throw new ScheduleError(
      'schedule_conflict',
      `有 ${conflicts.length} 处同会场时间冲突,请先解决后再保存`,
      409,
      conflicts,
    );
  }

  // 现存行:用于区分「更新」与「已被他人删除」,并计算审计 diff
  const existingRows = await db.select().from(sessions)
    .where(and(eq(sessions.eventId, input.eventId), sql`${sessions.deletedAt} IS NULL`));
  const existing = new Map(existingRows.map((r) => [r.id, r] as const));

  const idMap: Record<string, string> = {};
  const now = new Date();

  await db.transaction(async (tx) => {
    for (const s of kept) {
      const speakers = s.speakers.map((sp) => (
        sp.affiliation === null ? { name: sp.name } : { name: sp.name, affiliation: sp.affiliation }
      ));
      if (s.id.startsWith(NEW_SESSION_PREFIX)) {
        const id = uuidv7();
        idMap[s.id] = id;
        await tx.insert(sessions).values({
          id,
          eventId: input.eventId,
          roomId: s.roomId,
          title: s.title,
          kind: s.kind,
          startsAt: new Date(s.start),
          endsAt: new Date(s.end),
          speakers,
          createdAt: now,
          updatedAt: now,
        });
        continue;
      }
      const before = existing.get(s.id);
      if (!before) continue; // 已被并发删除:不复活
      const unchanged = before.title === s.title
        && before.kind === s.kind
        && before.roomId === s.roomId
        && before.startsAt.toISOString() === s.start
        && before.endsAt.toISOString() === s.end
        && JSON.stringify(before.speakers ?? []) === JSON.stringify(speakers);
      if (unchanged) continue;
      await tx.update(sessions).set({
        roomId: s.roomId,
        title: s.title,
        kind: s.kind,
        startsAt: new Date(s.start),
        endsAt: new Date(s.end),
        speakers,
        updatedAt: now,
      }).where(eq(sessions.id, s.id));
    }

    // 软删除(ch09:deletedAt,永不物理删除)
    if (removedIds.length > 0) {
      await tx.update(sessions)
        .set({ deletedAt: now, updatedAt: now })
        .where(and(eq(sessions.eventId, input.eventId), inArray(sessions.id, removedIds)));
    }

    await audit(tx as unknown as Db, {
      organizationId: event.organizationId,
      eventId: event.id,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: 'schedule.draft_saved',
      targetType: 'event',
      targetId: event.id,
      diff: {
        sessions: kept.length,
        created: Object.keys(idMap).length,
        deleted: removedIds.length,
      },
      ip: input.actor.ip ?? null,
    });
  });

  const view = await getScheduleDraft(input.eventId, db);
  return { sessions: view.sessions, diff: view.diff, idMap };
}

export interface PublishResult {
  version: number;
  publishedAt: string;
  sessions: SnapshotSession[];
  diff: ScheduleDiff;
}

/**
 * 发布:服务端复核冲突 → 把当前 sessions 物化为一条不可变快照,version 自增。
 * 回滚不是改历史,而是把旧快照重新发布为新版本(ch05 §5.1.3)。
 */
export async function publishSchedule(
  input: { eventId: string; actor: Actor },
  db: Db = defaultDb,
): Promise<PublishResult> {
  const [event] = await db.select().from(events).where(eq(events.id, input.eventId)).limit(1);
  if (!event) throw new ScheduleError('event_not_found', '活动不存在', 404);

  const [roomRows, sessionRows] = await Promise.all([
    db.select().from(rooms).where(eq(rooms.eventId, input.eventId)).orderBy(asc(rooms.position)),
    db.select().from(sessions)
      .where(and(eq(sessions.eventId, input.eventId), sql`${sessions.deletedAt} IS NULL`))
      .orderBy(asc(sessions.startsAt)),
  ]);

  const payload: SchedulePayload = buildSchedulePayload({
    timezone: event.timezone,
    rooms: roomRows,
    sessions: sessionRows,
  });

  const issues = validateSchedule(payload.sessions, roomRows.map((r) => r.id));
  if (issues.length > 0) {
    throw new ScheduleError('invalid_schedule', `有 ${issues.length} 处字段不合法,无法发布`);
  }
  const conflicts = detectConflictsIso(payload.sessions);
  if (conflicts.length > 0) {
    throw new ScheduleError(
      'schedule_conflict',
      `有 ${conflicts.length} 处同会场时间冲突,无法发布`,
      409,
      conflicts,
    );
  }
  if (payload.sessions.length === 0) {
    throw new ScheduleError('empty_schedule', '日程为空,无可发布内容');
  }

  const publishedAt = new Date();

  const version = await db.transaction(async (tx) => {
    const [last] = await tx.select({ version: scheduleSnapshots.version })
      .from(scheduleSnapshots)
      .where(eq(scheduleSnapshots.eventId, input.eventId))
      .orderBy(desc(scheduleSnapshots.version))
      .limit(1);
    const next = (last?.version ?? 0) + 1;

    await tx.insert(scheduleSnapshots).values({
      eventId: input.eventId,
      version: next,
      payload,
      publishedAt,
    });

    await audit(tx as unknown as Db, {
      organizationId: event.organizationId,
      eventId: event.id,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: 'schedule.published',
      targetType: 'event',
      targetId: event.id,
      diff: { version: next, sessions: payload.sessions.length },
      ip: input.actor.ip ?? null,
    });

    return next;
  });

  // TODO(ch05 §5.5.2):在此投递 schedule.published 通知到 outbox,由 worker 群发变更邮件。
  return {
    version,
    publishedAt: publishedAt.toISOString(),
    sessions: payload.sessions,
    diff: diffSchedule(payload.sessions, payload.sessions),
  };
}
