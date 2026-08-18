/**
 * 隐私声明页 /{org}/{event}/privacy(ch12 §12.3「默认即合规」的可见落点)
 *
 * 字段清单不是手写文案:它由 registration_forms.fields 动态生成,并标出哪些是 pii、
 * 哪些是特殊类别 —— 表单改了这一页跟着改,不可能出现「说明与实际收集不一致」。
 * 保留期表读 @yumeet/core 的 RETENTION_RULES(ch12 §12.3 的唯一实现)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildPrivacyNotice, fieldLabel } from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { translator, INTL_LOCALE, type Locale, type TKey } from '@/lib/i18n';
import styles from './privacy.module.css';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const notice = await buildPrivacyNotice(org, event);
  return {
    title: notice ? `隐私声明 · ${notice.event.title}` : '隐私声明',
    description: '本活动收集哪些数据、保留多久、以及如何行使 GDPR 权利。',
  };
}

/** ch12 §12.4 的权利表:每一行都对应一个可自助触达的产品功能 */
const RIGHTS: { right: TKey; how: TKey }[] = [
  { right: 'pvRightInform', how: 'pvRightInformHow' },
  { right: 'pvRightAccess', how: 'pvRightAccessHow' },
  { right: 'pvRightRectify', how: 'pvRightRectifyHow' },
  { right: 'pvRightErase', how: 'pvRightEraseHow' },
  { right: 'pvRightRestrict', how: 'pvRightRestrictHow' },
  { right: 'pvRightPortable', how: 'pvRightPortableHow' },
  { right: 'pvRightObject', how: 'pvRightObjectHow' },
  { right: 'pvRightAuto', how: 'pvRightAutoHow' },
];

function formatDay(d: Date, locale: Locale): string {
  return d.toLocaleDateString(INTL_LOCALE[locale], {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

export default async function PrivacyPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const notice = await buildPrivacyNotice(orgSlug, eventSlug);
  if (!notice) notFound();

  const ruleDays = (key: string, days: number): number =>
    key === 'registration_pii' ? notice.retentionDays : days;

  return (
    <main className={styles.page}>

      <p className={styles.eyebrow}>{tt('pvEyebrow')}</p>
      <h1 className={styles.title}>{tt('pvTitle')}</h1>
      <p className={styles.lede}>{tt('pvLede')}</p>

      {/* 数据控制者 */}
      <section className={styles.card} aria-labelledby="pv-controller">
        <h2 className={styles.sectionTitle} id="pv-controller">{tt('pvController')}</h2>
        <dl className={styles.defs}>
          <div className={styles.defRow}>
            <dt>{tt('pvControllerName')}</dt>
            <dd>{notice.controller.name}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>{tt('pvControllerRole')}</dt>
            <dd>{notice.controller.role[locale]}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>{tt('pvContact')}</dt>
            <dd>
              {notice.controller.contactEmail
                ? <a href={`mailto:${notice.controller.contactEmail}`}>{notice.controller.contactEmail}</a>
                : tt('pvContactMissing')}
            </dd>
          </div>
          <div className={styles.defRow}>
            <dt>{tt('pvEventScope')}</dt>
            <dd>{notice.event.title} · {notice.event.id}</dd>
          </div>
        </dl>
      </section>

      {/* 收集了哪些字段 —— 由表单定义生成 */}
      <section className={styles.card} aria-labelledby="pv-collected">
        <h2 className={styles.sectionTitle} id="pv-collected">{tt('pvCollected')}</h2>
        <p className={styles.body}>{tt('pvCollectedLede')}</p>

        {notice.fields.length === 0 ? (
          <p className={styles.body}>{tt('pvNoFields')}</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <caption className={styles.srOnly}>{tt('pvCollected')}</caption>
              <thead>
                <tr>
                  <th scope="col">{tt('pvColField')}</th>
                  <th scope="col">{tt('pvColKind')}</th>
                  <th scope="col">{tt('pvColCategory')}</th>
                  <th scope="col">{tt('pvColRetention')}</th>
                </tr>
              </thead>
              <tbody>
                {notice.fields.map((f) => (
                  <tr key={f.key}>
                    <th scope="row" className={styles.fieldCell}>
                      <span className={styles.fieldLabel}>{fieldLabel(f.label, locale)}</span>
                      <span className={styles.fieldKey}>{f.key}</span>
                      {f.help && (
                        <span className={styles.fieldHelp}>{fieldLabel(f.help, locale)}</span>
                      )}
                    </th>
                    <td>
                      <span className={styles.kind}>{f.kind}</span>
                      <span className={styles.reqMark}>
                        {f.required ? tt('pvRequiredMark') : tt('pvOptionalMark')}
                      </span>
                    </td>
                    <td>
                      {f.specialCategory ? (
                        <span className={`${styles.tag} ${styles.tagSpecial}`}>{tt('pvCatSpecial')}</span>
                      ) : f.pii ? (
                        <span className={`${styles.tag} ${styles.tagPii}`}>{tt('pvCatPii')}</span>
                      ) : (
                        <span className={`${styles.tag} ${styles.tagPlain}`}>{tt('pvCatOrdinary')}</span>
                      )}
                    </td>
                    <td className={styles.numeric}>
                      {tt('pvDays', { n: f.specialCategory ? f.days : notice.retentionDays })}
                      <span className={styles.basis}>{tt('pvFromEventEnd')}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 保留期表 —— 读 core 的 RETENTION_RULES */}
      <section className={styles.card} aria-labelledby="pv-retention">
        <h2 className={styles.sectionTitle} id="pv-retention">{tt('pvRetentionTitle')}</h2>
        <p className={styles.body}>{tt('pvRetentionLede')}</p>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{tt('pvRetentionTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{tt('pvColData')}</th>
                <th scope="col">{tt('pvColPeriod')}</th>
                <th scope="col">{tt('pvColAction')}</th>
              </tr>
            </thead>
            <tbody>
              {notice.rules.map((r) => (
                <tr key={r.key}>
                  <th scope="row" className={styles.fieldCell}>{r.label[locale]}</th>
                  <td className={styles.numeric}>
                    {tt('pvDays', { n: ruleDays(r.key, r.days) })}
                    <span className={styles.basis}>
                      {r.basis === 'event_end' ? tt('pvFromEventEnd') : tt('pvFromRecord')}
                    </span>
                  </td>
                  <td>{r.effect[locale]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <ul className={styles.notes}>
          <li>
            {tt('pvPiiClearedOn', {
              date: formatDay(notice.piiClearedOn, locale), n: notice.retentionDays,
            })}
          </li>
          {notice.hasSpecialCategory && (
            <li>
              {tt('pvSpecialClearedOn', {
                date: formatDay(notice.specialCategoryClearedOn, locale),
              })}
            </li>
          )}
          <li>{tt('pvAnonMeaning')}</li>
          <li>{tt('pvAuditNote')}</li>
        </ul>
      </section>

      {/* GDPR 权利表 */}
      <section className={styles.card} aria-labelledby="pv-rights">
        <h2 className={styles.sectionTitle} id="pv-rights">{tt('pvRightsTitle')}</h2>
        <p className={styles.body}>{tt('pvRightsLede')}</p>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{tt('pvRightsTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{tt('pvColRight')}</th>
                <th scope="col">{tt('pvColHow')}</th>
              </tr>
            </thead>
            <tbody>
              {RIGHTS.map((r) => (
                <tr key={r.right}>
                  <th scope="row" className={styles.fieldCell}>{tt(r.right)}</th>
                  <td>{tt(r.how)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 行使入口 */}
      <section className={styles.entry} aria-labelledby="pv-entry">
        <h2 className={styles.sectionTitle} id="pv-entry">{tt('pvEntryTitle')}</h2>
        <p className={styles.body}>{tt('pvEntryBody')}</p>
      </section>

      {/* 出厂默认值 */}
      <section className={styles.card} aria-labelledby="pv-defaults">
        <h2 className={styles.sectionTitle} id="pv-defaults">{tt('pvDefaultsTitle')}</h2>
        <ul className={styles.notes}>
          <li>{tt('pvDefaultMinimal')}</li>
          <li>{tt('pvDefaultHidden')}</li>
          <li>{tt('pvDefaultCookies')}</li>
        </ul>
      </section>

      <p className={styles.footnote}>
        <Link href={base || "/"}>{tt('backToEvent')}</Link>
      </p>
    </main>
  );
}
