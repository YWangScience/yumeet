'use client';

import { useState, useTransition } from 'react';
import { EVENT_ROLES, ROLE_LABELS, type EventRole } from '@yumeet/core/client';
import { grantRoleAction } from '@/app/manage/[org]/[event]/members/actions';
import { translator, type Locale } from '@/lib/i18n';
import styles from './grant-role-form.module.css';

export function GrantRoleForm({ orgSlug, eventSlug, tracks, locale }: {
  orgSlug: string; eventSlug: string; tracks: string[]; locale: Locale;
}) {
  const tt = translator(locale);
  const [pending, start] = useTransition();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<EventRole>('session_chair');
  const [picked, setPicked] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const needsTracks = role === 'session_chair';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const r = await grantRoleAction({
        orgSlug, eventSlug, email: email.trim(), role,
        tracks: needsTracks ? picked : undefined,
      });
      if (r.ok) {
        setMsg({ ok: true, text: r.created ? tt('memberCreated') : tt('roleGranted') });
        setEmail(''); setPicked([]);
      } else {
        setMsg({ ok: false, text: r.error ?? '操作失败' });
      }
    });
  };

  return (
    <form className={styles.form} onSubmit={submit}>
      {msg && (
        <p className={msg.ok ? styles.ok : styles.err} role="status">{msg.text}</p>
      )}

      <div className={styles.row}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="m-email">{tt('email')}</label>
          <input
            id="m-email" type="email" required value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={styles.input} placeholder="person@example.org"
            autoComplete="off"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="m-role">{tt('role')}</label>
          <select
            id="m-role" value={role} className={styles.select}
            onChange={(e) => setRole(e.target.value as EventRole)}
          >
            {EVENT_ROLES.map((r: EventRole) => (
              <option key={r} value={r}>{ROLE_LABELS[r][locale]}</option>
            ))}
          </select>
        </div>
      </div>

      <p className={styles.roleHint}>{ROLE_LABELS[role].desc[locale]}</p>

      {needsTracks && (
        <fieldset className={styles.tracks}>
          <legend className={styles.legend}>{tt('assignTracks')}</legend>
          {tracks.length === 0 ? (
            <p className={styles.noTracks}>{tt('noTracks')}</p>
          ) : (
            <div className={styles.trackGrid}>
              {tracks.map((t) => (
                <label key={t} className={styles.trackChip}>
                  <input
                    type="checkbox" checked={picked.includes(t)}
                    onChange={(e) => setPicked((p) =>
                      e.target.checked ? [...p, t] : p.filter((x) => x !== t))}
                  />
                  <span>{t}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}

      <button
        type="submit" className={styles.submit}
        disabled={pending || !email.trim() || (needsTracks && picked.length === 0)}
      >
        {pending ? tt('sending') : tt('grantRole')}
      </button>
    </form>
  );
}
