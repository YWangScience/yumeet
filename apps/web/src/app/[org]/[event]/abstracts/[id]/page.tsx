import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, getAbstract, toUuid, encodeId } from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent } from '@/lib/i18n';
import styles from './abstract.module.css';

export const revalidate = 300;

interface Props {
  params: Promise<{ org: string; event: string; id: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event, id } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) return { title: 'Not found' };
  try {
    const a = await getAbstract(found.event.id, toUuid('submission', id));
    return { title: a ? `${a.title} · ${found.event.title}` : 'Not found' };
  } catch { return { title: 'Not found' }; }
}

export default async function AbstractPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug, id } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  let uuid: string;
  try { uuid = toUuid('submission', id); } catch { notFound(); }

  const a = await getAbstract(found.event.id, uuid);
  if (!a) notFound();

  const content = eventContent(found.event, locale);
  const authors = a.authors ?? [];
  const answers = (a.answers ?? {}) as { contributionId?: number; sessionTitle?: string };

  return (
    <main className={styles.page}>

      <article>
        <p className={styles.chips}>
          {a.track && <span className={styles.trackChip}>{a.track}</span>}
          <span className={styles.type}>{a.type}</span>
          {answers.contributionId != null && (
            <span className={styles.cid}>#{answers.contributionId}</span>
          )}
        </p>

        <h1 className={styles.title}>{a.title}</h1>

        {answers.sessionTitle && (
          <p className={styles.session}>{answers.sessionTitle}</p>
        )}

        {authors.length > 0 && (
          <section className={styles.authorsBlock} aria-labelledby="authors">
            <h2 id="authors" className={styles.sectionLabel}>{tt('authors')}</h2>
            <ul className={styles.authorList}>
              {authors.map((au, i) => (
                <li key={`${au.name}-${i}`} className={styles.author}>
                  <span className={styles.authorName}>{au.name}</span>
                  {au.affiliation && (
                    <span className={styles.authorAff}>{au.affiliation}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className={styles.abstract}>
          {a.abstract.split(/\n{2,}/).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </div>

        <p className={styles.permalink}>
          <span className={styles.permaLabel}>ID</span>
          <code>{encodeId('submission', a.id)}</code>
        </p>
      </article>

      <p className={styles.back}>
        <Link href={`/${orgSlug}/${eventSlug}/abstracts`}>← {tt('backToAbstracts')}</Link>
      </p>
    </main>
  );
}
