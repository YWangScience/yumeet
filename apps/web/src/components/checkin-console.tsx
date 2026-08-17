'use client';

import { useEffect, useRef, useState } from 'react';
import { checkinByCodeAction } from '@/app/manage/[org]/[event]/checkin/actions';
import styles from './checkin-console.module.css';

interface Entry {
  code: string;
  name: string;
  status: 'ok' | 'error' | 'queued';
  message: string;
  at: number;
}

const QUEUE_KEY = 'yumeet.checkin.queue';

export function CheckinConsole({ orgSlug, eventSlug }: {
  orgSlug: string; eventSlug: string;
}) {
  const [code, setCode] = useState('');
  const [log, setLog] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // 离线容错:断网时暂存本机,恢复后自动补交(ch05 §5.2)
  useEffect(() => {
    const on = () => { setOnline(true); void flushQueue(); };
    const off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    void flushQueue();
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const readQueue = (): string[] => {
    try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]'); }
    catch { return []; }
  };
  const writeQueue = (q: string[]) => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));

  async function flushQueue() {
    const queue = readQueue();
    if (queue.length === 0) return;
    const remaining: string[] = [];
    for (const c of queue) {
      const res = await checkinByCodeAction({ code: c, orgSlug, eventSlug });
      if (res.ok) {
        push({ code: c, name: res.name ?? '', status: 'ok', message: '补交成功' });
      } else if (res.retriable) {
        remaining.push(c);
      } else {
        push({ code: c, name: '', status: 'error', message: res.error ?? '补交失败' });
      }
    }
    writeQueue(remaining);
  }

  const push = (e: Omit<Entry, 'at'>) =>
    setLog((prev) => [{ ...e, at: Date.now() }, ...prev].slice(0, 12));

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const c = code.trim().toUpperCase();
    if (!c) return;
    setCode('');
    inputRef.current?.focus();

    if (!navigator.onLine) {
      writeQueue([...readQueue(), c]);
      push({ code: c, name: '', status: 'queued', message: '已暂存,联网后自动补交' });
      return;
    }

    setBusy(true);
    const res = await checkinByCodeAction({ code: c, orgSlug, eventSlug });
    setBusy(false);

    if (res.ok) push({ code: c, name: res.name ?? '', status: 'ok', message: '签到成功' });
    else if (res.retriable) {
      writeQueue([...readQueue(), c]);
      push({ code: c, name: '', status: 'queued', message: '网络异常,已暂存' });
    } else push({ code: c, name: '', status: 'error', message: res.error ?? '签到失败' });
  }

  return (
    <div className={styles.console}>
      {!online && (
        <p className={styles.offline} role="status">
          当前离线 — 扫码结果会暂存在本机,联网后自动补交
        </p>
      )}

      <form onSubmit={submit} className={styles.form}>
        <label className={styles.label} htmlFor="checkin-code">确认码</label>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            id="checkin-code"
            className={styles.input}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="如 5LQE54AH"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={8}
            autoFocus
          />
          <button type="submit" className={styles.submit} disabled={busy || code.length === 0}>
            {busy ? '…' : '签到'}
          </button>
        </div>
      </form>

      <ul className={styles.log} aria-live="polite" aria-label="签到记录">
        {log.length === 0 && <li className={styles.logEmpty}>等待第一次扫码…</li>}
        {log.map((e) => (
          <li key={e.at} className={`${styles.entry} ${styles[`entry_${e.status}`]}`}>
            <span className={styles.entryCode}>{e.code}</span>
            <span className={styles.entryName}>{e.name || e.message}</span>
            {e.name && <span className={styles.entryMsg}>{e.message}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
