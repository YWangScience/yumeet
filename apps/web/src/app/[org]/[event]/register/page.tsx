import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, getEventForms, getEventTickets, encodeId, type FormField } from '@yumeet/core';
import { RegisterForm } from '@/components/register-form';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { translator, eventContent, INTL_LOCALE } from '@/lib/i18n';
import styles from './register.module.css';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `注册 · ${found.event.title}` : '注册' };
}

export default async function RegisterPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const { event } = found;
  const content = eventContent(event, locale);
  const [forms, tickets] = await Promise.all([
    getEventForms(event.id),
    getEventTickets(event.id),
  ]);
  const form = forms[0];
  if (!form) notFound();

  const now = new Date();
  const closed = form.closesAt != null && now > form.closesAt;
  const notOpen = form.opensAt != null && now < form.opensAt;

  const availableTickets = tickets
    .filter((t) => !(t.salesOpenAt && now < t.salesOpenAt))
    .filter((t) => !(t.salesCloseAt && now > t.salesCloseAt))
    .filter((t) => t.quantityTotal == null || t.quantitySold < t.quantityTotal)
    .map((t) => ({
      publicId: encodeId('ticket', t.id),
      name: t.name,
      description: t.description,
      priceCents: t.priceCents,
      currency: t.currency,
      remaining: t.quantityTotal == null ? null : t.quantityTotal - t.quantitySold,
    }));

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="面包屑">
        <Link href={base || "/"}>{content.title}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{tt('registration')}</span>
      </nav>

      <h1 className={styles.title}>{tt('registerTitle')}</h1>
      <p className={styles.lede}>{tt('registerLede')}</p>

      {(closed || notOpen) ? (
        <div className={styles.notice} role="status">
          <p className={styles.noticeTitle}>
            {closed ? tt('registrationClosed') : tt('registrationNotOpen')}
          </p>
          <p className={styles.noticeBody}>
            {closed
              ? tt('registrationClosedBody')
              : tt('registrationOpensAt', {
                  date: form.opensAt?.toLocaleDateString(INTL_LOCALE[locale]) ?? '',
                })}
          </p>
        </div>
      ) : (
        <RegisterForm
          orgSlug={orgSlug}
          eventSlug={eventSlug}
          formId={form.id}
          fields={form.fields as FormField[]}
          tickets={availableTickets}
          locale={locale}
        />
      )}
    </main>
  );
}
