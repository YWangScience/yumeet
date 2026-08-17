import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, listSpeakers } from '@yumeet/core';
import { SpeakerGrid } from '@/components/speaker-grid';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent } from '@/lib/i18n';
import styles from './speakers.module.css';

export const revalidate = 300;

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `Invited speakers · ${found.event.title}` : 'Speakers' };
}

export default async function SpeakersPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const speakers = await listSpeakers(found.event.id);
  if (speakers.length === 0) notFound();

  const content = eventContent(found.event, locale);

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="breadcrumb">
        <Link href={`/${orgSlug}/${eventSlug}`}>{content.title}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{tt('speakers')}</span>
      </nav>

      <h1 className={styles.title}>{tt('speakers')}</h1>
      <p className={styles.lede}>{tt('speakersLede', { n: speakers.length })}</p>

      <SpeakerGrid
        locale={locale}
        speakers={speakers.map((s) => ({
          id: s.id, name: s.name, affiliation: s.affiliation,
          talkTitle: s.talkTitle, photoUrl: s.photoUrl, bio: s.bio,
        }))}
      />

      <section className={styles.detail}>
        {speakers.filter((s) => s.bio).map((s) => (
          <article key={s.id} className={styles.entry} id={`s-${s.id}`}>
            <h2 className={styles.entryName}>{s.name}</h2>
            {s.talkTitle && <p className={styles.entryTalk}>{s.talkTitle}</p>}
            <p className={styles.entryBio}>{s.bio}</p>
          </article>
        ))}
      </section>
    </main>
  );
}
