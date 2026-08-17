/**
 * 胸牌预览与批量生成(ch05 §5.2.2)
 *
 * 单张预览走 `badges/preview.png`,批量走 `badges/export.zip` —— 两条路径共用
 * core 的同一份模板与同一份筛选条件,后台看到的就是打印店拿到的。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, listBadgeSubjects, isBadgeLayout,
  REGISTRATION_LABELS, type RegStatus, type BadgeLayout,
} from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import { LangSwitch } from '@/components/lang-switch';
import styles from './badges.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string; status?: string; code?: string; layout?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return {
    title: found ? `胸牌 Badges · ${found.event.title}` : '胸牌 Badges',
    robots: { index: false },
  };
}

/** 可印胸牌的状态:只有会到场的人才需要胸牌 */
const STATUS_CHOICES: RegStatus[] = ['confirmed', 'checked_in'];

export default async function BadgesPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  const statusFilter = STATUS_CHOICES.includes(sp.status as RegStatus)
    ? (sp.status as RegStatus)
    : null;
  const layout: BadgeLayout = isBadgeLayout(sp.layout) ? sp.layout : 'a7';

  const { rows, total } = await listBadgeSubjects(found.event.id, {
    statuses: statusFilter ? [statusFilter] : undefined,
    limit: 200,
  });

  const selected = rows.find((r) => r.confirmationCode === sp.code) ?? rows[0] ?? null;

  const base = `/manage/${orgSlug}/${eventSlug}/badges`;
  const qs = (over: Record<string, string | null>) => {
    const p = new URLSearchParams();
    p.set('lang', locale);
    if (statusFilter) p.set('status', statusFilter);
    p.set('layout', layout);
    if (selected) p.set('code', selected.confirmationCode);
    for (const [k, v] of Object.entries(over)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    return `?${p.toString()}`;
  };

  const exportQs = new URLSearchParams({ layout });
  if (statusFilter) exportQs.set('status', statusFilter);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{tt('badgesEyebrow')}</p>
          <h1 className={styles.title}>{tt('badgesTitle')}</h1>
          <p className={styles.meta}>{found.event.title}</p>
        </div>
        <div className={styles.headerActions}>
          <LangSwitch locale={locale} />
          <Link className={styles.back} href={`/manage/${orgSlug}/${eventSlug}?lang=${locale}`}>
            {tt('backToEvent')}
          </Link>
        </div>
      </header>

      <p className={styles.lede}>{tt('badgesLede')}</p>

      <div className={styles.controls}>
        <nav className={styles.filters} aria-label={tt('badgeStatusFilter')}>
          <Link
            className={`${styles.filter} ${!statusFilter ? styles.filterActive : ''}`}
            href={`${base}${qs({ status: null })}`}
          >
            {tt('badgeStatusAll')}
            <span className={styles.filterCount}>{total}</span>
          </Link>
          {STATUS_CHOICES.map((s) => (
            <Link
              key={s}
              className={`${styles.filter} ${statusFilter === s ? styles.filterActive : ''}`}
              href={`${base}${qs({ status: s })}`}
            >
              {REGISTRATION_LABELS[s][locale]}
            </Link>
          ))}
        </nav>

        <nav className={styles.filters} aria-label={tt('badgeLayout')}>
          <Link
            className={`${styles.filter} ${layout === 'a7' ? styles.filterActive : ''}`}
            href={`${base}${qs({ layout: 'a7' })}`}
          >
            {tt('badgeLayoutA7')}
          </Link>
          <Link
            className={`${styles.filter} ${layout === 'a6' ? styles.filterActive : ''}`}
            href={`${base}${qs({ layout: 'a6' })}`}
          >
            {tt('badgeLayoutA6')}
          </Link>
        </nav>
      </div>

      {rows.length === 0 ? (
        <p className={styles.empty}>{tt('badgeNoSubjects')}</p>
      ) : (
        <div className={styles.split}>
          <section className={styles.previewPane} aria-label={tt('badgePreview')}>
            {selected && (
              <>
                {/* 预览是服务端实时渲染的真实产物,不是另做一套 HTML 仿真 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className={layout === 'a6' ? styles.previewTall : styles.previewWide}
                  src={`${base}/preview.png?code=${encodeURIComponent(selected.confirmationCode)}&layout=${layout}`}
                  alt={tt('badgePreviewAlt', { name: selected.name })}
                  width={layout === 'a6' ? 620 : 620}
                  height={layout === 'a6' ? 874 : 437}
                />
                <dl className={styles.previewMeta}>
                  <div>
                    <dt>{tt('badgeCode')}</dt>
                    <dd className={styles.mono}>{selected.confirmationCode}</dd>
                  </div>
                  <div>
                    <dt>{tt('badgeAffiliation')}</dt>
                    <dd>{selected.affiliation ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>{tt('badgeTicket')}</dt>
                    <dd>{selected.ticketName ?? '—'}</dd>
                  </div>
                </dl>
                <div className={styles.actions}>
                  <a
                    className={styles.buttonPrimary}
                    href={`${base}/preview.png?code=${encodeURIComponent(selected.confirmationCode)}&layout=${layout}&download=1`}
                    download
                  >
                    {tt('badgeDownloadOne')}
                  </a>
                  <a
                    className={styles.buttonSecondary}
                    href={`${base}/export.zip?${exportQs.toString()}`}
                  >
                    {tt('badgeDownloadAll')}
                  </a>
                </div>
                <p className={styles.hint}>{tt('badgeBatchHint', { n: rows.length })}</p>
                <p className={styles.hint}>{tt('badgeFontNote')}</p>
              </>
            )}
          </section>

          <section className={styles.listPane}>
            <h2 className={styles.sectionTitle}>{tt('badgeSubjectsTitle')}</h2>
            <ul className={styles.list}>
              {rows.map((r) => {
                const active = selected?.confirmationCode === r.confirmationCode;
                return (
                  <li key={r.publicId}>
                    <Link
                      className={`${styles.listItem} ${active ? styles.listItemActive : ''}`}
                      href={`${base}${qs({ code: r.confirmationCode })}`}
                      aria-current={active ? 'true' : undefined}
                    >
                      <span className={styles.listName}>{r.name}</span>
                      <span className={styles.listSub}>{r.affiliation ?? '—'}</span>
                      <span className={`${styles.listCode} ${styles.mono}`}>{r.confirmationCode}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}
    </main>
  );
}
