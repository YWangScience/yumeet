import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  getEventBySlug, listEventMembers, listEventTracks,
  ROLE_LABELS, EVENT_ROLES, type EventRole,
} from '@yumeet/core';
import { requirePageCapability } from '@/lib/session';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import { MemberTable } from '@/components/member-table';
import { GrantRoleForm } from '@/components/grant-role-form';
import styles from './members.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '成员与权限 · yuMeet', robots: { index: false } };

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export default async function MembersPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  // 改动他人权限是高危操作,要求 member.manage
  const me = await requirePageCapability(
    found.event.id, 'member.manage',
    `/manage/${orgSlug}/${eventSlug}/members`,
  );

  const [members, tracks] = await Promise.all([
    listEventMembers(found.event.id),
    listEventTracks(found.event.id),
  ]);

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>{tt('membersTitle')}</h1>
      <p className={styles.lede}>{tt('membersLede')}</p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{tt('grantRole')}</h2>
        <GrantRoleForm
          orgSlug={orgSlug}
          eventSlug={eventSlug}
          tracks={tracks}
          locale={locale}
        />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{tt('currentMembers')}</h2>
          <span className={styles.count}>{members.length}</span>
        </div>
        <MemberTable
          members={members}
          orgSlug={orgSlug}
          eventSlug={eventSlug}
          locale={locale}
          selfId={me.id}
        />
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{tt('roleReference')}</h2>
        <div className={styles.tableWrap}>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th scope="col">{tt('role')}</th>
                <th scope="col">{tt('roleScope')}</th>
              </tr>
            </thead>
            <tbody>
              {EVENT_ROLES.map((r: EventRole) => (
                <tr key={r}>
                  <td className={styles.roleName}>{ROLE_LABELS[r][locale]}</td>
                  <td className={styles.roleDesc}>{ROLE_LABELS[r].desc[locale]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={styles.note}>{tt('roleNote')}</p>
      </section>
    </main>
  );
}
