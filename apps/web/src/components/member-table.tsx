'use client';

import { useTransition, useState } from 'react';
import { ROLE_LABELS, type EventRole } from '@yumeet/core/client';
import { revokeRoleAction } from '@/app/manage/[org]/[event]/members/actions';
import { translator, type Locale } from '@/lib/i18n';
import styles from './member-table.module.css';

export interface MemberView {
  userId: string; email: string; name: string | null;
  roles: EventRole[]; tracks: string[];
}

export function MemberTable({ members, orgSlug, eventSlug, locale, selfId }: {
  members: MemberView[]; orgSlug: string; eventSlug: string;
  locale: Locale; selfId: string;
}) {
  const tt = translator(locale);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const revoke = (userId: string, role: EventRole) => {
    setError(null);
    start(async () => {
      const r = await revokeRoleAction({ orgSlug, eventSlug, userId, role });
      if (!r.ok) setError(r.error ?? '操作失败');
    });
  };

  if (members.length === 0) {
    return <p className={styles.empty}>{tt('noMembers')}</p>;
  }

  return (
    <>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{tt('email')}</th>
              <th scope="col">{tt('role')}</th>
              <th scope="col">{tt('assignedTracks')}</th>
              <th scope="col">{tt('actions')}</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.userId} className={pending ? styles.pending : undefined}>
                <td>
                  <span className={styles.email}>{m.email}</span>
                  {m.userId === selfId && <span className={styles.self}>{tt('you')}</span>}
                </td>
                <td>
                  <div className={styles.roles}>
                    {m.roles.map((r) => (
                      <span key={r} className={`${styles.roleChip} ${styles[`role_${r}`] ?? ''}`}>
                        {ROLE_LABELS[r][locale]}
                      </span>
                    ))}
                  </div>
                </td>
                <td className={styles.tracks}>
                  {m.tracks.length > 0
                    ? m.tracks.map((t) => <code key={t} className={styles.track}>{t}</code>)
                    : <span className={styles.dash}>—</span>}
                </td>
                <td>
                  <div className={styles.actions}>
                    {m.roles.map((r) => (
                      <button
                        key={r} type="button" className={styles.revoke}
                        onClick={() => revoke(m.userId, r)} disabled={pending}
                      >
                        {tt('revoke')} {ROLE_LABELS[r][locale]}
                      </button>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
