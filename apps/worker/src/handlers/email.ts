/** 邮件作业处理器:把作业上下文还原成模板,交给可插拔 mailer(ch04 §4.4) */
import type { Job } from 'bullmq';
import { sendMail } from '../mailer/index';
import {
  templates, isRegistrationTemplate, webhookDisabledMail,
  type RegistrationMailContext,
} from '../mailer/templates';
import type { EmailJob } from '../queues';

function str(ctx: Record<string, unknown>, key: string, fallback = ''): string {
  const v = ctx[key];
  return typeof v === 'string' ? v : fallback;
}
function numOrNull(ctx: Record<string, unknown>, key: string): number | null {
  const v = ctx[key];
  return typeof v === 'number' ? v : null;
}

export async function processEmailJob(job: Job<EmailJob>): Promise<{ logId: string }> {
  const data = job.data;

  if (data.kind === 'webhook-disabled') {
    const mail = webhookDisabledMail({
      url: str(data.context, 'url'),
      failureCount: numOrNull(data.context, 'failureCount') ?? 0,
      failingSince: new Date(str(data.context, 'failingSince', new Date().toISOString())),
      orgSlug: str(data.context, 'orgSlug') || null,
    });
    const res = await sendMail({
      to: data.to, subject: mail.subject, text: mail.text,
      template: data.template, organizationId: data.organizationId, eventId: data.eventId,
    });
    if (res.status === 'failed') throw new Error(res.error ?? '邮件发送失败');
    return { logId: res.logId };
  }

  if (!isRegistrationTemplate(data.template)) {
    throw new Error(`未知邮件模板: ${data.template}`);
  }

  const ctx: RegistrationMailContext = {
    eventTitle: str(data.context, 'eventTitle', '(未命名活动)'),
    eventStartsAt: new Date(str(data.context, 'eventStartsAt', new Date().toISOString())),
    eventTimezone: str(data.context, 'eventTimezone', 'UTC'),
    venue: str(data.context, 'venue') || null,
    email: data.to,
    confirmationCode: str(data.context, 'confirmationCode'),
    trackingUrl: str(data.context, 'trackingUrl') || null,
    ticketName: str(data.context, 'ticketName') || null,
    waitlistPosition: numOrNull(data.context, 'waitlistPosition'),
  };

  const rendered = templates[data.template](ctx);
  const res = await sendMail({
    to: data.to, subject: rendered.subject, text: rendered.text,
    template: data.template, organizationId: data.organizationId, eventId: data.eventId,
  });
  if (res.status === 'failed') throw new Error(res.error ?? '邮件发送失败');
  return { logId: res.logId };
}
