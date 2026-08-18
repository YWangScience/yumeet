import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, searchAbstracts, listTracks, encodeId } from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { translator, eventContent, type TKey } from '@/lib/i18n';
import styles from './abstracts.module.css';

/** 投稿类型的枚举值直出会在中文界面里露出一串英文,统一走词条 */
const TYPE_LABEL: Record<string, TKey> = {
  talk: 'typeTalk',
  plenary: 'typePlenary',
  poster: 'typePoster',
  keynote: 'typePlenary',
};

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string; q?: string; track?: string; page?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `Abstracts · ${found.event.title}` : 'Abstracts' };
}

const PER_PAGE = 25;

export default async function AbstractsPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const q = (sp.q ?? '').trim();
  const track = sp.track ?? '';
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1);

  const [result, tracks] = await Promise.all([
    searchAbstracts(found.event.id, {
      q, track: track || undefined,
      limit: PER_PAGE, offset: (page - 1) * PER_PAGE,
    }),
    listTracks(found.event.id),
  ]);

  const content = eventContent(found.event, locale);
  const totalPages = Math.max(1, Math.ceil(result.total / PER_PAGE));
  const hrefFor = (patch: Record<string, string | number>) => {
    const p = new URLSearchParams();
    if (locale !== 'zh') p.set('lang', locale);
    if (q) p.set('q', q);
    if (track) p.set('track', track);
    for (const [k, v] of Object.entries(patch)) {
      if (v === '' || v === 0) p.delete(k); else p.set(k, String(v));
    }
    const s = p.toString();
    return `${base}/abstracts${s ? `?${s}` : ''}`;
  };

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="breadcrumb">
        <Link href={base || "/"}>{content.title}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{tt('abstracts')}</span>
      </nav>

      <h1 className={styles.title}>{tt('abstracts')}</h1>
      <p className={styles.lede}>
        {tt('abstractsLede', { n: result.totalAll, tracks: tracks.length })}
      </p>

      <form className={styles.filters} method="get" role="search">
        {locale !== 'zh' && <input type="hidden" name="lang" value={locale} />}
        <div className={styles.searchRow}>
          <label className={styles.srOnly} htmlFor="q">{tt('searchAbstracts')}</label>
          <input
            id="q" name="q" type="search" defaultValue={q}
            placeholder={tt('searchPlaceholder')}
            className={styles.search}
          />
          <button type="submit" className={styles.searchBtn}>{tt('search')}</button>
        </div>
        <div className={styles.trackRow}>
          <label className={styles.trackLabel} htmlFor="track">{tt('track')}</label>
          <select id="track" name="track" defaultValue={track} className={styles.trackSelect}>
            <option value="">{tt('allTracks')}</option>
            {tracks.map((t) => (
              <option key={t.track} value={t.track}>{t.track} ({t.n})</option>
            ))}
          </select>
          <noscript><button type="submit" className={styles.searchBtn}>{tt('apply')}</button></noscript>
        </div>
      </form>

      <p className={styles.count} role="status">
        {tt('resultCount', { n: result.total })}
        {(q || track) && (
          <Link className={styles.clear} href={hrefFor({ q: '', track: '', page: 1 })}>
            {tt('clearFilters')}
          </Link>
        )}
      </p>

      {result.rows.length === 0 ? (
        <p className={styles.empty}>{tt('noAbstracts')}</p>
      ) : (
        <ol className={styles.list}>
          {result.rows.map((s) => (
            <li key={s.id} className={styles.item}>
              <article>
                <h2 className={styles.itemTitle}>
                  <Link href={`${base}/abstracts/${encodeId('submission', s.id)}`}>
                    {s.title}
                  </Link>
                </h2>
                <p className={styles.authors}>
                  {(s.authors ?? []).slice(0, 6).map((a) => a.name).join(' · ')}
                  {(s.authors ?? []).length > 6 && ' …'}
                </p>
                {s.excerpt && (
                  <p className={styles.excerpt}>{s.excerpt.trim()}…</p>
                )}
                <p className={styles.meta}>
                  {s.track && <span className={styles.trackChip}>{s.track}</span>}
                  <span className={styles.type}>{tt(TYPE_LABEL[s.type] ?? 'typeTalk')}</span>
                </p>
              </article>
            </li>
          ))}
        </ol>
      )}

      {totalPages > 1 && (
        <nav className={styles.pager} aria-label={tt('pagination')}>
          {page > 1 && (
            <Link className={styles.pagerLink} href={hrefFor({ page: page - 1 })} rel="prev">
              ← {tt('prev')}
            </Link>
          )}
          <span className={styles.pagerInfo}>{tt('pageOf', { a: page, b: totalPages })}</span>
          {page < totalPages && (
            <Link className={styles.pagerLink} href={hrefFor({ page: page + 1 })} rel="next">
              {tt('next')} →
            </Link>
          )}
        </nav>
      )}
    </main>
  );
}
