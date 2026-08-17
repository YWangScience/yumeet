/**
 * 纯文本邮件模板(ch04 §4.4)。
 * react-email 富文本版本是 PLAN 模块 5 的工作;此处先保证内容正确、链接可点。
 */
import { config } from '../config';

export interface RegistrationMailContext {
  eventTitle: string;
  eventStartsAt: Date;
  eventTimezone: string;
  venue?: string | null;
  email: string;
  confirmationCode: string;
  /** /r/{token} 追踪页完整 URL;无 token 时省略该段 */
  trackingUrl?: string | null;
  ticketName?: string | null;
  waitlistPosition?: number | null;
}

function formatWhen(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      dateStyle: 'full', timeStyle: 'short', timeZone: timezone,
    }).format(at) + ` (${timezone})`;
  } catch {
    return `${at.toISOString()} (${timezone})`;
  }
}

function footer(trackingUrl?: string | null): string {
  return [
    '',
    trackingUrl ? `随时查看或修改你的报名:${trackingUrl}` : null,
    '',
    '—— 本邮件由 yuMeet 自动发送,请勿直接回复。',
  ].filter((l) => l !== null).join('\n');
}

export const templates = {
  /** 报名已确认(免费票或审批通过) */
  'registration.confirmed': (c: RegistrationMailContext) => ({
    subject: `报名已确认:${c.eventTitle}`,
    text: [
      `你好,`,
      ``,
      `你报名的「${c.eventTitle}」已确认。`,
      ``,
      `时间:${formatWhen(c.eventStartsAt, c.eventTimezone)}`,
      c.venue ? `地点:${c.venue}` : null,
      c.ticketName ? `票种:${c.ticketName}` : null,
      `确认码:${c.confirmationCode}(现场签到时出示)`,
      footer(c.trackingUrl),
    ].filter((l) => l !== null).join('\n'),
  }),

  /** 报名已收到,等待人工审批 */
  'registration.pending_review': (c: RegistrationMailContext) => ({
    subject: `报名已收到,待审核:${c.eventTitle}`,
    text: [
      `你好,`,
      ``,
      `我们已收到你对「${c.eventTitle}」的报名,正在等待组织者审核。`,
      `审核结果会以邮件通知你,通常在几个工作日内。`,
      ``,
      `时间:${formatWhen(c.eventStartsAt, c.eventTimezone)}`,
      `确认码:${c.confirmationCode}`,
      footer(c.trackingUrl),
    ].join('\n'),
  }),

  /** 进入候补 */
  'registration.waitlisted': (c: RegistrationMailContext) => ({
    subject: `已进入候补名单:${c.eventTitle}`,
    text: [
      `你好,`,
      ``,
      `「${c.eventTitle}」当前名额已满,你已进入候补名单` +
        (c.waitlistPosition ? `,当前位次:第 ${c.waitlistPosition} 位` : '') + '。',
      `一旦有人取消,我们会按位次自动通知你。`,
      ``,
      `时间:${formatWhen(c.eventStartsAt, c.eventTimezone)}`,
      footer(c.trackingUrl),
    ].join('\n'),
  }),

  /** 候补转正 */
  'registration.promoted': (c: RegistrationMailContext) => ({
    subject: `候补转正,名额已为你保留:${c.eventTitle}`,
    text: [
      `你好,`,
      ``,
      `好消息 —— 「${c.eventTitle}」有名额释出,你已从候补转为正式报名。`,
      ``,
      `时间:${formatWhen(c.eventStartsAt, c.eventTimezone)}`,
      `确认码:${c.confirmationCode}`,
      footer(c.trackingUrl),
    ].join('\n'),
  }),

  /** 报名已取消 */
  'registration.cancelled': (c: RegistrationMailContext) => ({
    subject: `报名已取消:${c.eventTitle}`,
    text: [
      `你好,`,
      ``,
      `你对「${c.eventTitle}」的报名已取消。若这不是你本人的操作,请联系组织者。`,
      footer(c.trackingUrl),
    ].join('\n'),
  }),
} as const;

export type RegistrationTemplateKey = keyof typeof templates;

export function isRegistrationTemplate(key: string): key is RegistrationTemplateKey {
  return key in templates;
}

/** webhook endpoint 连续 5 天全失败被自动暂停(ch10 §10.3) */
export function webhookDisabledMail(args: {
  url: string;
  failureCount: number;
  failingSince: Date;
  orgSlug?: string | null;
}): { subject: string; text: string } {
  return {
    subject: 'yuMeet:webhook endpoint 已被自动暂停',
    text: [
      `你好,`,
      ``,
      `以下 webhook endpoint 连续 5 天所有投递均失败,已被自动暂停:`,
      ``,
      `  URL:${args.url}`,
      `  首次失败:${args.failingSince.toISOString()}`,
      `  累计失败次数:${args.failureCount}`,
      ``,
      `暂停期间事件仍会落入 outbox,修复后在管理后台重新启用即可补投最近 30 天的事件。`,
      args.orgSlug
        ? `管理入口:${config.publicOrigin}/manage/${args.orgSlug}/settings/webhooks`
        : `管理入口:${config.publicOrigin}/manage/<org>/settings/webhooks`,
      ``,
      `常见原因:endpoint 证书过期、域名解析失效、返回非 2xx、或响应超过 10 秒。`,
      ``,
      `—— 本邮件由 yuMeet 自动发送,请勿直接回复。`,
    ].join('\n'),
  };
}
