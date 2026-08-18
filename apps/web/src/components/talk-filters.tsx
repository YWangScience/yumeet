'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import styles from './talk-filters.module.css';

interface Props {
  q: string;
  track: string;
  tracks: { track: string; n: number }[];
  labels: {
    search: string; placeholder: string; track: string; allTracks: string; clear: string;
  };
  lang: string | null;
}

/**
 * 报告检索的筛选条。
 *
 * 原来是一个普通表单:选完分会还得再点一次「检索」。可分会是个封闭的选项,
 * 选中的那一刻意图就已经完整了 —— 再要一次确认只是在收过路费。
 * 所以下拉一变就直接生效;关键词输入有防抖(400ms),打字停下来就自己出结果。
 *
 * 仍然用 URL 承载筛选状态而不是组件内部 state:这样结果页可分享、
 * 可后退、可刷新,和原来的表单行为一致。
 */
export function TalkFilters({ q, track, tracks, labels, lang }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const [text, setText] = useState(q);
  const first = useRef(true);

  const push = (nextQ: string, nextTrack: string) => {
    const p = new URLSearchParams();
    if (nextQ.trim()) p.set('q', nextQ.trim());
    if (nextTrack) p.set('track', nextTrack);
    if (lang) p.set('lang', lang);
    const s = p.toString();
    start(() => router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false }));
  };

  // 关键词:停止输入 400ms 后再查,避免每敲一个字母打一次请求
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => push(text, track), 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const active = Boolean(q || track);

  return (
    <div className={styles.bar} role="search">
      <div className={styles.searchRow}>
        <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="9" cy="9" r="6" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M13.5 13.5 18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
        <label className={styles.srOnly} htmlFor="q">{labels.search}</label>
        <input
          id="q"
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={labels.placeholder}
          className={styles.search}
          autoComplete="off"
        />
        {pending && <span className={styles.spinner} aria-hidden="true" />}
      </div>

      <label className={styles.srOnly} htmlFor="track">{labels.track}</label>
      <select
        id="track"
        value={track}
        onChange={(e) => push(text, e.target.value)}
        className={styles.select}
      >
        <option value="">{labels.allTracks}</option>
        {tracks.map((t) => (
          <option key={t.track} value={t.track}>{t.track} · {t.n}</option>
        ))}
      </select>

      {active && (
        <button
          type="button"
          className={styles.clear}
          onClick={() => { setText(''); push('', ''); }}
        >
          {labels.clear}
        </button>
      )}
    </div>
  );
}
