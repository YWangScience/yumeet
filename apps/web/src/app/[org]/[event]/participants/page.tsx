import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getEventBySlug, listParticipants } from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import styles from './participants.module.css';

export const revalidate = 300;

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `Participants · ${found.event.title}` : 'Participants' };
}

export default async function ParticipantsPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const people = await listParticipants(found.event.id);
  if (people.length === 0) notFound();

  const countries = new Set(people.map((p) => p.country).filter(Boolean));

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{tt('participants')}</h1>
      <p className={styles.lede}>
        {tt('participantsLede', { n: people.length, c: countries.size })}
      </p>

      {/*
        * 六百多人用三栏名录铺开。不做分页、不做检索框:
        * 这一页的用途是「找找看某某来了没有」,浏览器自带的页内查找
        * 比任何自建的检索都快 —— 前提是全部人都在同一页上。
        */}
      <ul className={styles.list}>
        {people.map((p) => (
          <li key={p.id} className={styles.item}>
            <span className={styles.name}>{p.name}</span>
            {p.affiliation && <span className={styles.aff}>{p.affiliation}</span>}
          </li>
        ))}
      </ul>
    </main>
  );
}
