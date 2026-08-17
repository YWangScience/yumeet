/**
 * 参会者数据权利页 /r/{token}/data(ch12 §12.4)
 *
 * 凭 /r/{token} 这一个不可枚举令牌即可行使全部权利,不需要账户:
 * 查看(Art. 15)、导出(Art. 20)、更正(Art. 16)、限制处理(Art. 18)、
 * 反对公开展示(Art. 21)、删除(Art. 17,两步确认)。
 */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  loadDataSubject, describeCollectedFields, formAnswers, fieldLabel, encodeId,
  REGISTRATION_LABELS, retentionRule, type RegStatus,
} from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator, INTL_LOCALE, type Locale } from '@/lib/i18n';
import { DataRightsPanel, type EditableField } from './rights';
import {
  correctAnswersAction, savePrefsAction, requestErasureAction, confirmErasureAction,
} from './actions';
import styles from './data.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '我的数据与隐私 · yuMeet',
  robots: { index: false, follow: false }, // 个人页不被索引
};

interface Props {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ lang?: string }>;
}

function formatDay(d: Date, locale: Locale): string {
  return d.toLocaleDateString(INTL_LOCALE[locale], {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** 答案 → 可读文本(展示用;数值与数组不做本地化改写,导出 JSON 才是权威副本) */
function renderValue(value: unknown, locale: Locale): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? (locale === 'zh' ? '是' : 'Yes') : (locale === 'zh' ? '否' : 'No');
  if (Array.isArray(value)) return value.map(String).join(', ');
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return typeof o['name'] === 'string' ? o['name'] : JSON.stringify(value);
  }
  return String(value);
}

export default async function DataRightsPage({ params, searchParams }: Props) {
  const { token } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);
  const subject = await loadDataSubject(token);
  if (!subject) notFound();

  const { registration: reg, event, organization } = subject;
  const answers = formAnswers(reg.answers);
  const described = describeCollectedFields(subject.fields);
  const status = reg.status as RegStatus;
  const statusLabel = REGISTRATION_LABELS[status];

  const day = 86_400_000;
  const piiClearedOn = new Date(event.endsAt.getTime() + organization.retentionDays * day);
  const specialClearedOn = new Date(
    event.endsAt.getTime() + retentionRule('special_category').days * day,
  );

  // 自助更正的字段:排除库存型与文件型(它们牵动名额与存储,须走组织者)
  const editable: EditableField[] = described
    .filter((f) => f.kind !== 'file' && f.kind !== 'capacity_option' && f.key !== 'email')
    .map((f) => {
      const def = subject.fields.find((x) => x.key === f.key);
      const options = def && 'options' in def && Array.isArray(def.options)
        ? def.options.map((o) => ({ value: o.value, label: fieldLabel(o.label, locale) }))
        : [];
      const raw = answers[f.key];
      return {
        key: f.key,
        label: fieldLabel(f.label, locale),
        help: f.help ? fieldLabel(f.help, locale) : null,
        kind: f.kind,
        required: f.required,
        pii: f.pii,
        specialCategory: f.specialCategory,
        options,
        value: raw === undefined || raw === null ? '' : (Array.isArray(raw) ? raw.map(String) : renderValue(raw, locale) ?? ''),
      };
    });

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label={locale === 'zh' ? '面包屑' : 'Breadcrumb'}>
        <Link href={`/r/${token}`}>{tt('drBackToStatus')}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{tt('drNav')}</span>
      </nav>

      <p className={styles.eyebrow}>{tt('drEyebrow')}</p>
      <h1 className={styles.title}>{tt('drTitle')}</h1>
      <p className={styles.lede}>{tt('drLede')}</p>

      {subject.erased && (
        <section className={styles.erasedCard} role="status">
          <h2 className={styles.sectionTitle}>{tt('drErasedTitle')}</h2>
          <p className={styles.body}>
            {tt('drErasedBody', {
              date: subject.privacy.updatedAt
                ? formatDay(new Date(subject.privacy.updatedAt), locale)
                : formatDay(reg.updatedAt, locale),
            })}
          </p>
        </section>
      )}

      {/* Art. 15:我们保存的数据 */}
      <section className={styles.card} aria-labelledby="dr-data">
        <h2 className={styles.sectionTitle} id="dr-data">{tt('drDataTitle')}</h2>
        <dl className={styles.defs}>
          <div className={styles.defRow}>
            <dt>{tt('email')}</dt>
            <dd className={styles.mono}>{reg.email}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>{tt('status')}</dt>
            <dd>{locale === 'zh' ? statusLabel.zh : statusLabel.en}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>{tt('confirmationCode')}</dt>
            <dd className={styles.mono}>{reg.confirmationCode}</dd>
          </div>
          <div className={styles.defRow}>
            <dt>{tt('regNumber')}</dt>
            <dd className={styles.mono}>{encodeId('registration', reg.id)}</dd>
          </div>
        </dl>

        <h3 className={styles.subTitle}>{tt('drAnswersTitle')}</h3>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.srOnly}>{tt('drAnswersTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{tt('pvColField')}</th>
                <th scope="col">{tt('pvColCategory')}</th>
                <th scope="col">{tt('answersTitle')}</th>
              </tr>
            </thead>
            <tbody>
              {described.map((f) => {
                const shown = renderValue(answers[f.key], locale);
                const cleared = subject.erased && f.pii;
                return (
                  <tr key={f.key}>
                    <th scope="row" className={styles.fieldCell}>
                      <span>{fieldLabel(f.label, locale)}</span>
                      <span className={styles.fieldKey}>{f.key}</span>
                    </th>
                    <td>
                      {f.specialCategory ? (
                        <span className={`${styles.tag} ${styles.tagSpecial}`}>{tt('pvCatSpecial')}</span>
                      ) : f.pii ? (
                        <span className={`${styles.tag} ${styles.tagPii}`}>{tt('pvCatPii')}</span>
                      ) : (
                        <span className={`${styles.tag} ${styles.tagPlain}`}>{tt('pvCatOrdinary')}</span>
                      )}
                    </td>
                    <td>
                      {shown ?? (
                        <span className={styles.muted}>
                          {cleared ? tt('drClearedAnswer') : tt('drEmptyAnswer')}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Art. 20:导出 */}
      <section className={styles.card} aria-labelledby="dr-export">
        <h2 className={styles.sectionTitle} id="dr-export">{tt('drExportTitle')}</h2>
        <p className={styles.body}>{tt('drExportBody')}</p>
        <p className={styles.actions}>
          <a className={styles.buttonPrimary} href={`/r/${token}/data/export`} download>
            {tt('drExportAction')}
          </a>
        </p>
      </section>

      {/* Art. 16 / 18 / 21 / 17 —— 交互部分 */}
      <DataRightsPanel
        token={token}
        locale={locale}
        fields={editable}
        correctable={subject.correctable}
        erased={subject.erased}
        listOptOut={subject.privacy.listOptOut}
        restricted={subject.privacy.restricted}
        onCorrect={correctAnswersAction}
        onSavePrefs={savePrefsAction}
        onRequestErasure={requestErasureAction}
        onConfirmErasure={confirmErasureAction}
      />

      {/* 什么都不做会发生什么 */}
      <section className={styles.card} aria-labelledby="dr-retention">
        <h2 className={styles.sectionTitle} id="dr-retention">{tt('drRetentionTitle')}</h2>
        <p className={styles.body}>
          {tt('drRetentionBody', {
            date: formatDay(piiClearedOn, locale),
            special: formatDay(specialClearedOn, locale),
          })}
        </p>
        <p className={styles.body}>
          <Link href={`/${organization.slug}/${event.slug}/privacy`}>
            {tt('drPrivacyNoticeLink')}
          </Link>
        </p>
      </section>

      <p className={styles.footnote}>{tt('drFootnote')}</p>
    </main>
  );
}
