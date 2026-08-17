/**
 * 中英双语(ch08 §8.8 多语言排版)
 * 语言从 URL 查询参数 ?lang= 或 Cookie 决定,服务端渲染即定,不闪烁。
 * 内容侧的多语言字段沿用字段引擎的 I18nString(ch09 §9.3),UI 文案用下表。
 */

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';
export const LOCALE_COOKIE = 'yumeet_lang';

export function normalizeLocale(v: string | undefined | null): Locale {
  if (!v) return DEFAULT_LOCALE;
  const s = v.toLowerCase();
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

/** HTML lang 属性值 */
export const HTML_LANG: Record<Locale, string> = { zh: 'zh-Hans', en: 'en' };

/** Intl 格式化用的 locale 标签 */
export const INTL_LOCALE: Record<Locale, string> = { zh: 'zh-Hans', en: 'en-GB' };

type Dict = Record<Locale, string>;

const T = {
  // 通用
  register: { zh: '注册', en: 'Register' },
  registerCta: { zh: '注册参会', en: 'Register now' },
  schedule: { zh: '日程', en: 'Programme' },
  cfp: { zh: '征稿', en: 'Call for papers' },
  viewSchedule: { zh: '查看日程', en: 'View programme' },
  fullSchedule: { zh: '查看完整日程', en: 'Full programme' },
  backToEvent: { zh: '返回活动页', en: 'Back to event' },

  // 活动页
  about: { zh: '关于会议', en: 'About' },
  venue: { zh: '会场', en: 'Venue' },
  registration: { zh: '注册', en: 'Registration' },
  startRegistration: { zh: '开始注册', en: 'Start registration' },
  addToCalendar: { zh: '加入日历', en: 'Add to calendar' },
  calendarHint: {
    zh: '订阅日程后,任何变动都会自动同步到你的日历应用。',
    en: 'Subscribe once and any change syncs to your calendar automatically.',
  },
  downloadIcs: { zh: '下载 .ics', en: 'Download .ics' },
  publicJson: { zh: '公共 JSON', en: 'Public JSON' },
  timezoneNote: {
    zh: '会议时区 {tz} · 所有时间按您的本地时区显示',
    en: 'Event timezone {tz} · times shown in your local timezone',
  },
  seats: { zh: '座', en: 'seats' },
  moreCount: { zh: '另有 {n} 场', en: '{n} more' },

  // 状态
  date: { zh: '日期', en: 'Dates' },
  location: { zh: '地点', en: 'Location' },
  status: { zh: '状态', en: 'Status' },
  statusPublished: { zh: '报名开放', en: 'Registration open' },
  statusLive: { zh: '进行中', en: 'In progress' },
  statusEnded: { zh: '已结束', en: 'Ended' },
  statusArchived: { zh: '已归档', en: 'Archived' },
  statusDraft: { zh: '草稿', en: 'Draft' },

  // 注册页
  registerTitle: { zh: '注册参会', en: 'Register for the meeting' },
  registerLede: {
    zh: '填写下方信息即可完成注册,无需创建账户。提交后你会立即获得一个可随时查看进度的链接。',
    en: 'Fill in the form below — no account required. You will get a link to track your status right away.',
  },
  selectTicket: { zh: '选择票种', en: 'Select a ticket' },
  attendeeInfo: { zh: '参会人信息', en: 'Attendee details' },
  email: { zh: '邮箱', en: 'Email' },
  emailHelp: {
    zh: '确认函与进度链接将发送到此邮箱,无需设置密码。',
    en: 'Your confirmation and tracking link go here. No password needed.',
  },
  submit: { zh: '完成注册', en: 'Complete registration' },
  submitting: { zh: '提交中…', en: 'Submitting…' },
  submitHint: {
    zh: '提交即表示你同意我们按隐私声明处理上述信息。',
    en: 'By submitting you agree to our processing of the above per the privacy notice.',
  },
  pleaseSelect: { zh: '请选择', en: 'Please select' },
  onlyLeft: { zh: '仅剩 {n} 席', en: 'Only {n} left' },
  free: { zh: '免费', en: 'Free' },
  soldOut: { zh: '已售罄', en: 'Sold out' },
  notYetOnSale: { zh: '尚未开售', en: 'Not yet on sale' },
  salesClosed: { zh: '已停售', en: 'Closed' },
  available: { zh: '可注册', en: 'Available' },
  registrationClosed: { zh: '注册已截止', en: 'Registration closed' },
  registrationNotOpen: { zh: '注册尚未开放', en: 'Registration not yet open' },
  registrationClosedBody: {
    zh: '本次会议的在线注册已于截止日期关闭,如有特殊情况请联系组织者。',
    en: 'Online registration has closed. Please contact the organisers if you need assistance.',
  },
  registrationOpensAt: { zh: '注册将于 {date} 开放。', en: 'Registration opens on {date}.' },
  capacityLimit: { zh: '限 {n} 位', en: '{n} places' },

  // 追踪页
  trackingEyebrow: { zh: '报名进度', en: 'Registration status' },
  stepSubmitted: { zh: '已提交', en: 'Submitted' },
  stepProcessed: { zh: '已受理', en: 'Processed' },
  stepConfirmed: { zh: '已确认', en: 'Confirmed' },
  stepCheckedIn: { zh: '已签到', en: 'Checked in' },
  regDetails: { zh: '报名详情', en: 'Registration details' },
  confirmationCode: { zh: '确认码', en: 'Confirmation code' },
  ticketType: { zh: '票种', en: 'Ticket' },
  regNumber: { zh: '报名编号', en: 'Registration ID' },
  statusHistory: { zh: '状态记录', en: 'History' },
  waitlistPos: { zh: '当前候补位次 第 {n} 位', en: 'Waitlist position: {n}' },
  trackingFootnote: {
    zh: '此页面链接是你的专属凭证,请勿分享给他人。收藏它即可随时查看最新状态,无需登录。',
    en: 'This link is your personal credential — do not share it. Bookmark it to check your status any time, no login needed.',
  },

  // 日程页
  fullScheduleTitle: { zh: '完整日程', en: 'Full programme' },
  scheduleEmpty: {
    zh: '日程尚未发布,请稍后再来查看。',
    en: 'The programme has not been published yet. Please check back later.',
  },
  scheduleMetaDesc: {
    zh: '完整多轨日程,时间按你的本地时区显示。',
    en: 'Full multi-track programme, times shown in your local timezone.',
  },

  // 语言切换
  language: { zh: '语言', en: 'Language' },
  switchToEn: { zh: 'English', en: 'English' },
  switchToZh: { zh: '中文', en: '中文' },
} satisfies Record<string, Dict>;

export type TKey = keyof typeof T;

/** 取文案;支持 {name} 占位符插值 */
export function t(locale: Locale, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = T[key][locale];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** 绑定 locale 的取词器,页面里写 tt('register') 即可 */
export function translator(locale: Locale) {
  return (key: TKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}

/** 内容字段的多语言取值(与字段引擎 I18nString 兼容) */
export function pick(
  value: string | Record<string, string> | null | undefined,
  locale: Locale,
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[locale] ?? value['en'] ?? value['zh'] ?? Object.values(value)[0] ?? '';
}

/** 在当前 URL 上切换语言,保留路径与其他查询参数 */
export function localeHref(pathname: string, search: string, next: Locale): string {
  const params = new URLSearchParams(search);
  params.set('lang', next);
  return `${pathname}?${params.toString()}`;
}

/** 活动内容按语言取值:优先该语言的覆盖,回落到基础字段 */
export function eventContent(
  event: {
    title: string;
    subtitle: string | null;
    description: string | null;
    contentI18n?: Record<string, { title?: string; subtitle?: string; description?: string }> | null;
  },
  locale: Locale,
): { title: string; subtitle: string | null; description: string | null } {
  const o = event.contentI18n?.[locale];
  return {
    title: o?.title ?? event.title,
    subtitle: o?.subtitle ?? event.subtitle,
    description: o?.description ?? event.description,
  };
}
