import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getEventBySlug, listPendingOfflineOrders, findOrderByReference,
  METHOD_LABELS, encodeId, getPaymentConfig, type PaymentMethod,
} from '@yumeet/core';
import { requirePageCapability, capabilitiesFor } from '@/lib/session';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import { formatMoney } from '@/lib/format';
import { ReconcileRow } from '@/components/reconcile-row';
import { PaymentConfigForm } from '@/components/payment-config-form';
import { savePaymentConfigAction } from './actions';
import styles from './payments.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '收款核销 · yuMeet', robots: { index: false } };

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string; ref?: string }>;
}

export default async function PaymentsPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  // 收款核销涉及资金,要求 registration.manage 能力
  await requirePageCapability(
    found.event.id, 'registration.manage',
    `/manage/${orgSlug}/${eventSlug}/payments`,
  );

  const queue = await listPendingOfflineOrders(found.event.id, { limit: 100 });
  const payCfg = await getPaymentConfig(found.event.id);
  // 配置区只对能改活动设置的人显示;真正的边界在 action 内(ch12 §12.1)
  const canConfigure = (await capabilitiesFor(found.event.id)).has('event.edit');
  const searched = sp.ref?.trim()
    ? await findOrderByReference(found.event.id, sp.ref)
    : null;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{tt('reconciliation')}</h1>
      <p className={styles.lede}>{tt('reconciliationLede')}</p>

      <form className={styles.search} method="get" role="search">
        {locale !== 'zh' && <input type="hidden" name="lang" value={locale} />}
        <label className={styles.searchLabel} htmlFor="ref">{tt('searchByReference')}</label>
        <div className={styles.searchRow}>
          <input
            id="ref" name="ref" type="search" defaultValue={sp.ref ?? ''}
            placeholder="AB3D-8KM2" className={styles.searchInput}
            autoCapitalize="characters" spellCheck={false}
          />
          <button type="submit" className={styles.searchBtn}>{tt('search')}</button>
        </div>
      </form>

      {sp.ref && (
        <p className={styles.searchResult} role="status">
          {searched
            ? `${tt('paymentReference')} ${searched.paymentReference} · `
              + `${formatMoney(searched.totalCents, searched.currency)} · ${searched.status}`
            : tt('noAbstracts')}
        </p>
      )}

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{tt('pendingPayments')}</h2>
          <span className={styles.count}>{queue.total}</span>
        </div>

        {queue.rows.length === 0 ? (
          <p className={styles.empty}>{tt('noPendingPayments')}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">{tt('paymentReference')}</th>
                  <th scope="col">{tt('email')}</th>
                  <th scope="col">{tt('amountDue')}</th>
                  <th scope="col">{tt('ticketType')}</th>
                  <th scope="col">{tt('markAsPaid')}</th>
                </tr>
              </thead>
              <tbody>
                {queue.rows.map((o) => (
                  <ReconcileRow
                    key={o.id}
                    order={{
                      id: o.id,
                      publicId: encodeId('order', o.id),
                      reference: o.paymentReference,
                      email: o.email,
                      amount: formatMoney(o.totalCents, o.currency),
                      method: METHOD_LABELS[o.method as PaymentMethod][locale],
                      createdAt: o.createdAt.toISOString().slice(0, 10),
                    }}
                    orgSlug={orgSlug}
                    eventSlug={eventSlug}
                    locale={locale}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {canConfigure && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h2 className={styles.sectionTitle}>{tt('paymentSettings')}</h2>
          </div>
          <p className={styles.configLede}>{tt('paymentSettingsLede')}</p>
          {!payCfg && (
            <p className={styles.configWarn} role="alert">{tt('paymentNotConfigured')}</p>
          )}
          <PaymentConfigForm
            config={payCfg}
            action={savePaymentConfigAction.bind(null, orgSlug, eventSlug)}
          />
        </section>
      )}
    </main>
  );
}
