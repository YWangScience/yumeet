import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getEventSchedule, displayStatus, encodeId, groupByDay, detectConflicts,
} from '@yumeet/core';
import {
  ScheduleGrid,
  type ScheduleDay, type ScheduleRoom, type ScheduleSession,
} from '@/components/schedule-grid';
import { formatDateRange } from '@/lib/format';
import styles from './schedule-page.module.css';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { translator, eventContent } from '@/lib/i18n';

// ISR:公共页静态化,发布后由 revalidate 更新(ch13 §13.2)
export const revalidate = 60;

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  published: '即将举行',
  live: '进行中',
  ended: '已结束',
  archived: '已归档',
};

/** 同会场时间重叠时的并排轨道分配。仅在 detectConflicts 报告冲突时才计算。 */
interface LaneItem { id: string; roomId: string | null; startsAt: Date; endsAt: Date }
interface Lane { lane: number; lanes: number }

function computeLanes(items: LaneItem[]): Map<string, Lane> {
  const out = new Map<string, Lane>();
  const byRoom = new Map<string, LaneItem[]>();
  for (const it of items) {
    if (!it.roomId) continue;
    const list = byRoom.get(it.roomId) ?? [];
    list.push(it);
    byRoom.set(it.roomId, list);
  }
  for (const list of byRoom.values()) {
    const sorted = [...list].sort(
      (a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.endsAt.getTime() - b.endsAt.getTime(),
    );
    // 把互相连锁重叠的项聚成簇,簇内统一分配轨道数,避免整列被最坏情况压窄
    let cluster: LaneItem[] = [];
    let clusterEnd = Number.NEGATIVE_INFINITY;
    const flush = () => {
      if (cluster.length === 0) return;
      const laneEnds: number[] = [];
      const assigned: [string, number][] = [];
      for (const it of cluster) {
        let lane = laneEnds.findIndex((end) => end <= it.startsAt.getTime());
        if (lane === -1) {
          laneEnds.push(it.endsAt.getTime());
          lane = laneEnds.length - 1;
        } else {
          laneEnds[lane] = it.endsAt.getTime();
        }
        assigned.push([it.id, lane]);
      }
      for (const [id, lane] of assigned) out.set(id, { lane, lanes: laneEnds.length });
      cluster = [];
      clusterEnd = Number.NEGATIVE_INFINITY;
    };
    for (const it of sorted) {
      if (cluster.length > 0 && it.startsAt.getTime() >= clusterEnd) flush();
      cluster.push(it);
      clusterEnd = Math.max(clusterEnd, it.endsAt.getTime());
    }
    flush();
  }
  return out;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) return { title: 'Not found · yuMeet' };
  return {
    title: `日程 · ${found.event.title}`,
    description: `${found.event.title} 的完整多轨日程,时间按你的本地时区显示。`,
  };
}

export default async function SchedulePage({ params, searchParams }: Props) {
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const { org: orgSlug, event: eventSlug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const { event } = found;
  const schedule = await getEventSchedule(event.id);

  // 分天必须用活动时区,否则浏览者时区一变「第几天」就漂移(ch07 原则 6)
  const grouped = groupByDay(schedule.sessions, event.timezone);

  const slots: LaneItem[] = schedule.sessions.map((s) => ({
    id: s.id, roomId: s.roomId, startsAt: s.startsAt, endsAt: s.endsAt,
  }));
  const lanes = detectConflicts(slots).length > 0
    ? computeLanes(slots)
    : new Map<string, Lane>();

  const rooms: ScheduleRoom[] = schedule.rooms.map((r) => ({
    id: r.id, name: r.name, location: r.location,
  }));

  const days: ScheduleDay[] = grouped.map(({ day, items }) => ({
    day,
    sessions: items.map((s): ScheduleSession => {
      const placement = lanes.get(s.id);
      return {
        id: s.id,
        title: s.title,
        kind: s.kind,
        roomId: s.roomId,
        start: s.startsAt.toISOString(),
        end: s.endsAt.toISOString(),
        lane: placement?.lane ?? 0,
        lanes: placement?.lanes ?? 1,
        speakers: (s.speakers ?? []).map((sp) => ({
          name: sp.name,
          affiliation: sp.affiliation ?? null,
        })),
        // 有摘要的场次点进详情页读全文;茶歇午餐没有摘要,自然也不可点
        href: s.submissionId
          ? `${base}/abstracts/${encodeId('submission', s.submissionId)}`
          : null,
      };
    }),
  }));

  const status = displayStatus(event);
  const icsHref = `/api/v1/public/events/${encodeId('event', event.id)}/calendar.ics`;

  return (
    <main className={styles.page}>

      <header className={styles.header}>
        <div className={styles.headerMain}>
          <h1 className={styles.title}>{tt('fullScheduleTitle')}</h1>
          <p className={styles.meta}>
            <span>{formatDateRange(event.startsAt, event.endsAt, event.timezone)}</span>
            {event.venue?.name && (
              <>
                <span className={styles.dot} aria-hidden="true">·</span>
                <span>{event.venue.name}</span>
              </>
            )}
            <span className={styles.dot} aria-hidden="true">·</span>
            <span>{schedule.sessions.length} 场议程</span>
            <span className={`${styles.status} ${styles[`status_${status}`] ?? ''}`}>
              {STATUS_LABEL[status] ?? status}
            </span>
          </p>
        </div>
        <a className={styles.icsButton} href={icsHref}>下载 .ics</a>
      </header>

      {days.length === 0 ? (
        <p className={styles.empty} role="status">{tt('scheduleEmpty')}</p>
      ) : (
        <ScheduleGrid days={days} rooms={rooms} eventTimezone={event.timezone} locale={locale} />
      )}
    </main>
  );
}
