'use client';

import { useState, useTransition } from 'react';
import { reconcileAction } from '@/app/manage/[org]/[event]/payments/actions';
import { translator, type Locale } from '@/lib/i18n';
import styles from './reconcile-row.module.css';

interface Props {
  order: {
    id: string; publicId: string; reference: string | null;
    email: string; amount: string; method: string; createdAt: string;
  };
  orgSlug: string;
  eventSlug: string;
  locale: Locale;
}

export function ReconcileRow({ order, orgSlug, eventSlug, locale }: Props) {
  const tt = translator(locale);
  const [pending, start] = useTransition();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const confirm = () => {
    setError(null);
    start(async () => {
      const r = await reconcileAction({
        orderId: order.id, orgSlug, eventSlug, note: note.trim() || undefined,
      });
      if (r.ok) setDone(true);
      else setError(r.error ?? '操作失败');
    });
  };

  if (done) {
    return (
      <tr className={styles.doneRow}>
        <td colSpan={5} className={styles.doneCell}>
          ✓ {order.reference} — {tt('paymentReceived')}
        </td>
      </tr>
    );
  }

  return (
    <tr className={pending ? styles.pendingRow : undefined}>
      <td>
        <span className={styles.ref}>{order.reference ?? '—'}</span>
        <span className={styles.date}>{order.createdAt}</span>
      </td>
      <td className={styles.email}>{order.email}</td>
      <td className={styles.amount}>{order.amount}</td>
      <td><span className={styles.method}>{order.method}</span></td>
      <td>
        <div className={styles.actionCell}>
          <label className={styles.srOnly} htmlFor={`note-${order.id}`}>
            {tt('reconcileNote')}
          </label>
          <input
            id={`note-${order.id}`}
            className={styles.note}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={tt('reconcileNote')}
            disabled={pending}
          />
          <button
            type="button" className={styles.confirm}
            onClick={confirm} disabled={pending}
          >
            {pending ? '…' : tt('markAsPaid')}
          </button>
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </td>
    </tr>
  );
}
