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
