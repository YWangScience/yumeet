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

      <h1 className={styles.title}>{tt('committees')}</h1>
      <p className={styles.lede}>{tt('committeesLede', { n: all.length })}</p>

      {/* 三个委员会加起来三百多人,页面长到七千像素。
          先给一排锚点,让人一眼看到有哪几个委员会、各多少人,
          再决定往哪跳 —— 否则只能靠滚动去撞。 */}
      <nav className={styles.jump} aria-label={tt('committees')}>
        {GROUPS.map(({ key, label }) => {
          const n = all.filter((m) => m.groupKey === key).length;
          if (n === 0) return null;
          return (
            <a key={key} className={styles.jumpLink} href={`#g-${key}`}>
              {tt(label)}
              <span className={styles.jumpCount}>{n}</span>
            </a>
          );
        })}
      </nav>

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
