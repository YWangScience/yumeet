import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getRegistrationByToken, REGISTRATION_LABELS, encodeId,
  type RegStatus,
} from '@yumeet/core';
import { formatDateRange, formatMoney } from '@/lib/format';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent, INTL_LOCALE, type Locale, type TKey } from '@/lib/i18n';
import styles from './tracking.module.css';

export const dynamic = 'force-dynamic'; // 个人页不缓存

export const metadata: Metadata = {
  title: '报名进度 · yuMeet',
  robots: { index: false, follow: false }, // 个人页不被索引
};

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

/** 进度条节点(ch05 §5.5:像查快递一样看进度) */
const STEPS: { key: TKey; matches: RegStatus[] }[] = [
  { key: 'stepSubmitted', matches: ['pending_review', 'waitlisted', 'awaiting_payment', 'confirmed', 'checked_in'] },
  { key: 'stepProcessed', matches: ['awaiting_payment', 'confirmed', 'checked_in'] },
  { key: 'stepConfirmed', matches: ['confirmed', 'checked_in'] },
  { key: 'stepCheckedIn', matches: ['checked_in'] },
];

const NEXT_ACTION: Partial<Record<RegStatus, Record<Locale, string>>> = {
  pending_review: {
    zh: '组织者正在审核你的申请,通常在 5 个工作日内完成。审核结果会发送到你的邮箱,你也可以随时回到本页查看。',
    en: 'The organisers are reviewing your application, usually within five working days. You will be notified by email, and can return to this page any time.',
  },
  waitlisted: {
    zh: '当前名额已满,你已进入候补队列。一旦有人取消,我们会按位次依次通知,你将有 24 小时确认时间。',
    en: 'The event is full and you are on the waitlist. If a place opens we will notify you in order, and you will have 24 hours to confirm.',
  },
  awaiting_payment: {
    zh: '请在订单有效期内完成支付,支付成功后报名将自动确认。',
    en: 'Please complete payment before the order expires. Your registration is confirmed automatically once payment succeeds.',
  },
  confirmed: {
    zh: '报名已确认。请在会议现场出示下方确认码完成签到。',
    en: 'Your registration is confirmed. Show the confirmation code below at the on-site desk to check in.',
  },
  checked_in: { zh: '你已完成现场签到,祝你会议愉快。', en: 'You are checked in. Enjoy the meeting.' },
  rejected: {
    zh: '很抱歉,本次申请未通过。如有疑问请联系组织者。',
    en: 'Unfortunately this application was not accepted. Please contact the organisers with any questions.',
  },
  cancelled: {
    zh: '此报名已取消。如需重新参会,请回到活动页重新注册。',
    en: 'This registration was cancelled. To attend, please register again from the event page.',
  },
  expired: {
    zh: '此报名已过期。如仍希望参会,请回到活动页重新注册。',
    en: 'This registration has expired. To attend, please register again from the event page.',
  },
};

export default async function TrackingPage({ params, searchParams }: Props) {
  const { token } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const intl = INTL_LOCALE[locale];
  const data = await getRegistrationByToken(token);
  if (!data || !data.event) notFound();

  const { registration: reg, event, ticket, timeline } = data;
  const content = eventContent(event, locale);
  const status = reg.status as RegStatus;
  const label = REGISTRATION_LABELS[status];
  const isNegative = ['rejected', 'cancelled', 'expired'].includes(status);
  const activeIndex = STEPS.reduce(
    (acc, s, i) => (s.matches.includes(status) ? i : acc), -1);

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>{tt('trackingEyebrow')}</p>
      <h1 className={styles.title}>{content.title}</h1>
      <p className={styles.meta}>
        {formatDateRange(event.startsAt, event.endsAt, event.timezone, intl)}
        {event.venue?.name ? ` · ${event.venue.name}` : ''}
      </p>

      <section className={`${styles.statusCard} ${isNegative ? styles.statusNegative : ''}`}>
        <div className={styles.statusHead}>
          <span className={`${styles.statusBadge} ${styles[`badge_${status}`] ?? ''}`}>
            {locale === 'zh' ? label.zh : label.en}
          </span>
          <span className={styles.statusEn}>{locale === 'zh' ? label.en : ''}</span>
        </div>

        {!isNegative && (
          <ol className={styles.progress} aria-label="办理进度">
            {STEPS.map((s, i) => {
              const done = i <= activeIndex;
              const current = i === activeIndex;
              return (
                <li
                  key={s.key}
                  className={`${styles.step} ${done ? styles.stepDone : ''} ${current ? styles.stepCurrent : ''}`}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className={styles.stepDot} aria-hidden="true" />
                  <span className={styles.stepLabel}>{tt(s.key)}</span>
                </li>
              );
            })}
          </ol>
        )}

        {NEXT_ACTION[status] && (
          <p className={styles.nextAction}>{NEXT_ACTION[status]?.[locale]}</p>
        )}

        {status === 'waitlisted' && reg.waitlistPosition != null && (
          <p className={styles.waitlistPos}>
            {tt('waitlistPos', { n: reg.waitlistPosition })}
          </p>
        )}
      </section>

      <section className={styles.detailCard}>
        <h2 className={styles.sectionTitle}>{tt('regDetails')}</h2>
        <dl className={styles.details}>
          <div className={styles.row}>
            <dt>{tt('confirmationCode')}</dt>
            <dd className={styles.code}>{reg.confirmationCode}</dd>
          </div>
          <div className={styles.row}>
            <dt>{tt('email')}</dt>
            <dd>{reg.email}</dd>
          </div>
          {ticket && (
            <div className={styles.row}>
              <dt>{tt('ticketType')}</dt>
              <dd>{ticket.name} · {formatMoney(ticket.priceCents, ticket.currency)}</dd>
            </div>
          )}
          <div className={styles.row}>
            <dt>{tt('regNumber')}</dt>
            <dd className={styles.mono}>{encodeId('registration', reg.id)}</dd>
          </div>
        </dl>
      </section>

      {timeline.length > 0 && (
        <section className={styles.detailCard}>
          <h2 className={styles.sectionTitle}>{tt('statusHistory')}</h2>
          <ol className={styles.timeline}>
            {timeline.map((t, i) => (
              <li key={i} className={styles.timelineItem}>
                <time className={styles.timelineTime} dateTime={t.createdAt.toISOString()}>
                  {t.createdAt.toLocaleString(intl, { dateStyle: 'medium', timeStyle: 'short' })}
                </time>
                <span className={styles.timelineAction}>{describeAction(t.action, locale)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className={styles.actions}>
        <a
          className={styles.buttonSecondary}
          href={`/api/v1/public/events/${encodeId('event', event.id)}/calendar.ics`}
        >
          {tt('addToCalendar')}
        </a>
        <Link className={styles.buttonSecondary} href={`/icranet/${event.slug}`}>
          {tt('backToEvent')}
        </Link>
      </div>

      <p className={styles.footnote}>
        {tt('trackingFootnote')}
      </p>
    </main>
  );
}

function describeAction(action: string, locale: Locale): string {
  const map: Record<string, Record<Locale, string>> = {
    'registration.created': { zh: '提交报名申请', en: 'Application submitted' },
    'registration.confirmed': { zh: '报名已确认', en: 'Registration confirmed' },
    'registration.pending_review': { zh: '进入审核队列', en: 'Entered review queue' },
    'registration.waitlisted': { zh: '进入候补队列', en: 'Added to waitlist' },
    'registration.awaiting_payment': { zh: '等待支付', en: 'Awaiting payment' },
    'registration.checked_in': { zh: '现场签到完成', en: 'Checked in on site' },
    'registration.rejected': { zh: '申请未通过', en: 'Application not accepted' },
    'registration.cancelled': { zh: '报名已取消', en: 'Registration cancelled' },
    'registration.expired': { zh: '报名已过期', en: 'Registration expired' },
    'registration.exported': { zh: '名单被导出', en: 'Roster exported' },
  };
  return map[action]?.[locale] ?? action;
}
