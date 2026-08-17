import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, getEventPage, listEventPages } from '@yumeet/core';
import { Markdown } from '@/components/markdown';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { eventContent, pick } from '@/lib/i18n';
import styles from './page-view.module.css';

export const revalidate = 300;

interface Props {
  params: Promise<{ org: string; event: string; slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event, slug } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) return { title: 'Not found' };
  const page = await getEventPage(found.event.id, slug);
  return { title: page ? `${page.title} · ${found.event.title}` : 'Not found' };
}

export default async function EventCustomPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug, slug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const locale = await resolveLocale(await searchParams);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const page = await getEventPage(found.event.id, slug);
  if (!page) notFound();

  const siblings = await listEventPages(found.event.id);
  const content = eventContent(found.event, locale);
  const i18n = page.contentI18n?.[locale];
  const title = i18n?.title ?? page.title;
  const body = i18n?.body ?? page.body;

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="breadcrumb">
        <Link href={`${base}`}>{content.title}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{title}</span>
      </nav>

      <div className={styles.layout}>
        <article className={styles.article}>
          <h1 className={styles.title}>{title}</h1>
          <Markdown source={body} />
        </article>

        {siblings.length > 1 && (
          <aside className={styles.sidebar} aria-label={locale === 'zh' ? '其他页面' : 'Other pages'}>
            <p className={styles.sidebarLabel}>
              {locale === 'zh' ? '本次会议' : 'This meeting'}
            </p>
            <ul className={styles.sidebarList}>
              {siblings.map((s) => {
                const t = pick(s.contentI18n?.[locale]?.title ?? s.title, locale);
                return (
                  <li key={s.id}>
                    <Link
                      className={s.slug === slug ? styles.sidebarActive : styles.sidebarLink}
                      href={`${base}/p/${s.slug}`}
                      aria-current={s.slug === slug ? 'page' : undefined}
                    >
                      {t}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </aside>
        )}
      </div>
    </main>
  );
}
