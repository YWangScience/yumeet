/**
 * ICS 日历导出(ch05 §5.5.4、ch10 §10.4)
 * PRODID 统一 -//yuMeet//EN;UID 统一 {blockId}@{host}
 */

export interface IcsEvent {
  id: string;
  title: string;
  description?: string | null;
  location?: string | null;
  startsAt: Date;
  endsAt: Date;
  url?: string | null;
}

const fold = (line: string): string => {
  // RFC 5545:行长不超过 75 字节,续行以空格开头
  if (Buffer.byteLength(line, 'utf8') <= 73) return line;
  const chunks: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 73) {
      chunks.push(cur);
      cur = ' ' + ch;
    } else {
      cur += ch;
    }
  }
  if (cur) chunks.push(cur);
  return chunks.join('\r\n');
};

const esc = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const stamp = (d: Date): string =>
  d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function buildIcs(
  events: IcsEvent[],
  opts: { host: string; calendarName?: string; timezone?: string },
): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//yuMeet//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  if (opts.calendarName) {
    lines.push(`X-WR-CALNAME:${esc(opts.calendarName)}`);
  }
  if (opts.timezone) lines.push(`X-WR-TIMEZONE:${opts.timezone}`);

  const now = stamp(new Date());
  for (const e of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${e.id}@${opts.host}`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART:${stamp(e.startsAt)}`);
    lines.push(`DTEND:${stamp(e.endsAt)}`);
    lines.push(fold(`SUMMARY:${esc(e.title)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${esc(e.description)}`));
    if (e.location) lines.push(fold(`LOCATION:${esc(e.location)}`));
    if (e.url) lines.push(fold(`URL:${e.url}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

/** schema.org/Event JSON-LD(ch10 §10.4:宿主页面同时获得 SEO 结构化数据) */
export function eventJsonLd(e: {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  url: string;
  venue?: { name?: string; address?: string; city?: string; country?: string } | null;
  organizer?: string;
}): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: e.title,
    description: e.description ?? undefined,
    startDate: e.startsAt.toISOString(),
    endDate: e.endsAt.toISOString(),
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: e.url,
    location: e.venue
      ? {
          '@type': 'Place',
          name: e.venue.name,
          address: {
            '@type': 'PostalAddress',
            streetAddress: e.venue.address,
            addressLocality: e.venue.city,
            addressCountry: e.venue.country,
          },
        }
      : undefined,
    organizer: e.organizer ? { '@type': 'Organization', name: e.organizer } : undefined,
  };
}
