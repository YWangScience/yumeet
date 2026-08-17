/**
 * 可插拔 mailer(ch04 §4.4 通知 / ch12 §12.3 email_logs 保留 90 天)。
 *
 * 驱动契约只有一个方法 send();每次发送无论成败都落一条 email_logs ——
 * 「发了没有、发给谁、什么模板、为什么失败」是运营侧最常问的四个问题。
 *
 * 默认驱动 console:把整封邮件打到日志,适合 `docker compose up` 后立刻能看到
 * magic link 与确认码,不需要先配 SMTP。react-email 富文本模板是后续工作
 * (PLAN 模块 5),当前模板一律纯文本。
 */
import { emailLogs, db as defaultDb, type Db } from '@yumeet/db';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { log } from '../logger';

export interface OutgoingMail {
  to: string;
  subject: string;
  /** 纯文本正文 */
  text: string;
  /** 模板标识,写进 email_logs.template 便于统计送达率 */
  template: string;
  organizationId: string;
  eventId?: string | null;
  replyTo?: string;
}

export interface MailDriver {
  readonly name: string;
  /** 抛异常即视为发送失败,由 sendMail 记账并向上冒泡供 BullMQ 重试 */
  send(mail: OutgoingMail, from: string): Promise<{ providerId?: string }>;
}

// --------------------------------------------------------------------------
// 驱动实现
// --------------------------------------------------------------------------

/** 默认驱动:打印到日志。开发环境下「收件箱」就是 docker logs。 */
export const consoleDriver: MailDriver = {
  name: 'console',
  async send(mail, from) {
    const banner = '─'.repeat(72);
    console.log(
      `\n${banner}\n` +
      `[yuMeet mail:console] ${mail.template}\n` +
      `From: ${from}\nTo: ${mail.to}\nSubject: ${mail.subject}\n` +
      `${banner}\n${mail.text}\n${banner}\n`,
    );
    return {};
  },
};

/**
 * SMTP 驱动占位。落地时在此 import nodemailer 并用 SMTP_URL(ch11 §11.2 的
 * app-env)建 transport;签名与 consoleDriver 完全一致,切换只改 YUMEET_MAIL_DRIVER。
 */
export const smtpDriver: MailDriver = {
  name: 'smtp',
  async send() {
    throw new Error('smtp 驱动尚未实现:设置 YUMEET_MAIL_DRIVER=console,或补齐 nodemailer 接线');
  },
};

/** Resend 驱动占位。落地时经 packages/net 的 safeFetch 调用其 REST API。 */
export const resendDriver: MailDriver = {
  name: 'resend',
  async send() {
    throw new Error('resend 驱动尚未实现:设置 YUMEET_MAIL_DRIVER=console,或补齐 API 接线');
  },
};

const DRIVERS: Record<string, MailDriver> = {
  console: consoleDriver,
  smtp: smtpDriver,
  resend: resendDriver,
};

export function resolveDriver(name = config.mailDriver): MailDriver {
  const driver = DRIVERS[name];
  if (!driver) {
    log.warn('未知邮件驱动,回退到 console', { requested: name });
    return consoleDriver;
  }
  return driver;
}

/** 注册第三方驱动(插件系统,ch13 §13.4) */
export function registerDriver(driver: MailDriver): void {
  DRIVERS[driver.name] = driver;
}

// --------------------------------------------------------------------------
// 发送 + 记账
// --------------------------------------------------------------------------

export interface SendResult {
  logId: string;
  status: 'sent' | 'failed';
  error?: string;
}

/**
 * 发送一封邮件并落 email_logs。先写 queued 再改 sent/failed,
 * 这样进程在发送中途被杀也能看到「有过这么一封」。
 */
export async function sendMail(
  mail: OutgoingMail,
  opts: { driver?: MailDriver; from?: string; db?: Db } = {},
): Promise<SendResult> {
  const db = opts.db ?? defaultDb;
  const driver = opts.driver ?? resolveDriver();
  const from = opts.from ?? config.mailFrom;

  const [row] = await db.insert(emailLogs).values({
    organizationId: mail.organizationId,
    eventId: mail.eventId ?? null,
    to: mail.to,
    template: mail.template,
    subject: mail.subject,
    status: 'queued',
  }).returning({ id: emailLogs.id });
  const logId = row!.id;

  try {
    await driver.send(mail, from);
    await db.update(emailLogs)
      .set({ status: 'sent', sentAt: new Date() })
      .where(eq(emailLogs.id, logId));
    log.info('邮件已发送', { template: mail.template, to: mail.to, driver: driver.name, logId });
    return { logId, status: 'sent' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(emailLogs)
      .set({ status: 'failed', error: message.slice(0, 500) })
      .where(eq(emailLogs.id, logId));
    log.error('邮件发送失败', { template: mail.template, to: mail.to, driver: driver.name, logId, err: message });
    return { logId, status: 'failed', error: message };
  }
}
