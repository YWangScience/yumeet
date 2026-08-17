import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getRegistrationByToken, getOrderForRegistration, METHOD_LABELS,
  type PaymentMethod,
} from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator, pick, type Locale } from '@/lib/i18n';
import { formatMoney } from '@/lib/format';
import { MethodSwitcher } from '@/components/method-switcher';
import { switchMethodAction } from './actions';
import styles from './pay.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '付款说明 · yuMeet',
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string; new?: string }>;
}

/**
 * 付款说明页(线下支付的落地页)。
 *
 * 凭 /r/{token} 的同一枚凭证访问,不需要账户 —— 与追踪页一致的「无摩擦身份」。
 * 页面的唯一任务是把「往哪付、付多少、附言写什么」讲清楚,
 * 参考号必须最醒目:它是把一笔到账对应回订单的唯一线索。
 */
export default async function PayPage({ params, searchParams }: Props) {
  const { token } = await params;
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);

  const data = await getRegistrationByToken(token);
  if (!data || !data.event) notFound();

  const { registration: reg, event, ticket } = data;
  const payment = await getOrderForRegistration(reg.id);
  if (!payment) notFound();

  const { order, paymentConfig: cfg } = payment;
  const method = order.method as PaymentMethod;
  const paid = order.status === 'paid';

  return (
    <main className={styles.page}>
      <p className={styles.eyebrow}>{tt('paymentInstructions')}</p>
      <h1 className={styles.title}>{event!.title}</h1>

      {sp.new && !paid && (
        <section className={styles.receivedCard} role="status">
          <p className={styles.receivedTitle}>{tt('registrationReceived')}</p>
          <p className={styles.receivedBody}>
            {tt('registrationReceivedBody', { code: reg.confirmationCode })}
          </p>
        </section>
      )}

      {paid ? (
        <section className={styles.paidCard} role="status">
          <p className={styles.paidTitle}>{tt('paymentReceived')}</p>
          <p className={styles.paidBody}>{tt('paymentReceivedBody')}</p>
          <p className={styles.actions}>
            <Link className={styles.button} href={`/r/${token}`}>{tt('viewStatus')}</Link>
          </p>
        </section>
      ) : (
        <>
          <section className={styles.amountCard}>
            <div className={styles.amountRow}>
              <span className={styles.amountLabel}>{tt('amountDue')}</span>
              <span className={styles.amount}>
                {formatMoney(order.totalCents, order.currency)}
              </span>
            </div>
            <div className={styles.metaRow}>
              <span>{ticket?.name}</span>
              <span className={styles.methodChip}>{METHOD_LABELS[method][locale]}</span>
            </div>
            {order.expiresAt && (
              <p className={styles.deadline}>
                {tt('payBefore', {
                  date: order.expiresAt.toLocaleDateString(locale === 'zh' ? 'zh-Hans' : 'en-GB'),
                })}
              </p>
            )}
          </section>

          {order.paymentReference && (
            <section className={styles.refCard}>
              <p className={styles.refLabel}>{tt('paymentReference')}</p>
              <p className={styles.refCode}>{order.paymentReference}</p>
              <p className={styles.refHint}>{tt('paymentReferenceHint')}</p>
            </section>
          )}

          <MethodDetails method={method} cfg={cfg} locale={locale} tt={tt} />

          <MethodSwitcher
            current={method}
            options={(cfg?.enabled ?? []).filter((m) => m !== 'stripe').map((m) => ({
              value: m, label: METHOD_LABELS[m][locale],
            }))}
            action={switchMethodAction.bind(null, token)}
            label={tt('choosePaymentMethod')}
          />

          <section className={styles.nextCard}>
            <h2 className={styles.nextTitle}>{tt('afterPaying')}</h2>
            <p className={styles.nextBody}>{tt('afterPayingBody')}</p>
            <p className={styles.actions}>
              <Link className={styles.buttonGhost} href={`/r/${token}`}>{tt('viewStatus')}</Link>
            </p>
          </section>
        </>
      )}
    </main>
  );
}

type PayCfg = NonNullable<Awaited<ReturnType<typeof getOrderForRegistration>>>['paymentConfig'];

function MethodDetails({ method, cfg, locale, tt }: {
  method: PaymentMethod;
  cfg: PayCfg;
  locale: Locale;
  tt: ReturnType<typeof translator>;
}) {
  if (method === 'bank_transfer' && cfg?.bankTransfer) {
    const b = cfg.bankTransfer;
    return (
      <section className={styles.detailCard}>
        <h2 className={styles.detailTitle}>{tt('bankDetails')}</h2>
        <dl className={styles.bankList}>
          <Row label={tt('accountName')} value={b.accountName} />
          <Row label={tt('accountNumber')} value={b.accountNumber} mono />
          <Row label={tt('bankName')} value={b.bankName} />
          {b.swift && <Row label="SWIFT/BIC" value={b.swift} mono />}
          {b.iban && <Row label="IBAN" value={b.iban} mono />}
        </dl>
        {b.memoHint && <p className={styles.detailHint}>{pick(b.memoHint, locale)}</p>}
        {b.instructions && <p className={styles.detailBody}>{pick(b.instructions, locale)}</p>}
      </section>
    );
  }

  if ((method === 'alipay' || method === 'wechat')) {
    const q = method === 'alipay' ? cfg?.alipay : cfg?.wechat;
    return (
      <section className={styles.detailCard}>
        <h2 className={styles.detailTitle}>
          {method === 'alipay' ? tt('alipayScan') : tt('wechatScan')}
        </h2>
        {q?.qrUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className={styles.qr} src={q.qrUrl} alt={tt('paymentQr')} width={220} height={220} />
        ) : (
          <p className={styles.detailBody}>{tt('qrPending')}</p>
        )}
        {q?.payee && <p className={styles.payee}>{tt('payee')}: {q.payee}</p>}
        {q?.instructions && <p className={styles.detailBody}>{pick(q.instructions, locale)}</p>}
        <p className={styles.detailHint}>{tt('qrMemoHint')}</p>
      </section>
    );
  }

  if (method === 'onsite') {
    return (
      <section className={styles.detailCard}>
        <h2 className={styles.detailTitle}>{tt('onsitePayment')}</h2>
        <p className={styles.detailBody}>{tt('onsitePaymentBody')}</p>
        {cfg?.onsite?.accepts && (
          <p className={styles.detailHint}>{pick(cfg.onsite.accepts, locale)}</p>
        )}
      </section>
    );
  }

  // 配置缺失时不能什么都不显示 —— 参会者会以为页面坏了。
  // 明说「主办方还没公布账户」,并把人导向联系方式。
  return (
    <section className={styles.detailCard}>
      <h2 className={styles.detailTitle}>{METHOD_LABELS[method][locale]}</h2>
      <p className={styles.detailBody}>{tt('paymentNotSetUp')}</p>
    </section>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className={styles.bankRow}>
      <dt className={styles.bankLabel}>{label}</dt>
      <dd className={mono ? styles.bankValueMono : styles.bankValue}>{value}</dd>
    </div>
  );
}
