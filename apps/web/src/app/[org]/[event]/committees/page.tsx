import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, listCommittee } from '@yumeet/core';
import { CommitteeList } from '@/components/committee-list';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { translator, eventContent, type TKey } from '@/lib/i18n';
import styles from './committees.module.css';

export const revalidate = 300;

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `Committees · ${found.event.title}` : 'Committees' };
}

const GROUPS: { key: string; label: TKey }[] = [
  { key: 'ioc', label: 'committeeIoc' },
  { key: 'icc', label: 'committeeIcc' },
  { key: 'loc', label: 'committeeLoc' },
];

export default async function CommitteesPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const all = await listCommittee(found.event.id);
  if (all.length === 0) notFound();

  const content = eventContent(found.event, locale);

  return (
    <main className={styles.page}>
      <nav className={styles.breadcrumb} aria-label="breadcrumb">
        <Link href={`${base}`}>{content.title}</Link>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{tt('committees')}</span>
      </nav>

      <h1 className={styles.title}>{tt('committees')}</h1>
      <p className={styles.lede}>{tt('committeesLede', { n: all.length })}</p>

      {GROUPS.map(({ key, label }) => {
        const members = all.filter((m) => m.groupKey === key);
        if (members.length === 0) return null;
        return (
          <section key={key} className={styles.group} aria-labelledby={`g-${key}`}>
            <div className={styles.groupHead}>
              <h2 id={`g-${key}`} className={styles.groupTitle}>{tt(label)}</h2>
              <span className={styles.groupCount}>{tt('peopleCount', { n: members.length })}</span>
            </div>
            <CommitteeList locale={locale} members={members.map((m) => ({
              id: m.id, name: m.name, affiliation: m.affiliation,
              country: m.country, role: m.role,
            }))} />
          </section>
        );
      })}
    </main>
  );
}
