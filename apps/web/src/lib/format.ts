/** 时间与金额格式化(原则 6:所有时间按浏览者时区渲染) */

export function formatDateRange(start: Date, end: Date, timeZone: string, locale = 'zh-Hans'): string {
  const full = new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'long', day: 'numeric' });
  const iso = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone }).format(d);
  if (iso(start) === iso(end)) return full.format(start);

  const month = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone, month: '2-digit' }).format(d);
  const year = (d: Date) => new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric' }).format(d);
  const sameMonth = year(start) === year(end) && month(start) === month(end);

  if (sameMonth) {
    const dayOnly = new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric' });
    // 中文读作「2027年7月5日 – 9日」;西文读作「5–9 July 2027」——
    // Intl.formatRange 在 zh 下会退化为纯数字格式,故按语言分别拼接。
    // zh-Hans 的 day: 'numeric' 已带「日」单位,直接拼接即可
    if (locale.startsWith('zh')) return `${full.format(start)} – ${dayOnly.format(end)}`;
    const monthYear = new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'long' });
    return `${dayOnly.format(start)}–${dayOnly.format(end)} ${monthYear.format(end)}`;
  }
  return `${full.format(start)} – ${full.format(end)}`;
}

export function formatTime(d: Date, timeZone: string, locale = 'zh-Hans'): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

export function formatDayLabel(day: string, locale = 'zh-Hans'): string {
  const [y, m, dd] = day.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, dd!));
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', day: 'numeric', weekday: 'short' }).format(date);
}

export function formatMoney(cents: number, currency: string, locale = 'zh-Hans'): string {
  if (cents === 0) return '免费';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 0 }).format(cents / 100);
}

/** 浏览者时区与活动时区不同时,提示「会场时间」双标注(ch07 原则 6) */
export function viewerTimeZone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'UTC'; }
}
