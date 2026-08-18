'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { NavEntry, NavLink } from './site-nav';
import styles from './mobile-nav.module.css';

interface Props {
  label: string;
  /** 与桌面端同一份有序板块,保证两端的顺序一致 */
  entries: NavEntry[];
  cta?: NavLink | null;
}

/**
 * 手机端导航(ch08 §8.8 响应式)。
 *
 * 窄屏下顶栏放不下 7 个入口,原先直接 display:none 把导航整体藏掉,
 * 手机用户因此完全无法在站内跳转 —— 这里用抽屉把全部入口还给他们。
 * 打开时锁定背景滚动、Esc 关闭并归还焦点、焦点限制在抽屉内。
 */
export function MobileNav({ label, entries, cta }: Props) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); return; }
      if (e.key !== 'Tab' || !panelRef.current) return;
      // 焦点圈在抽屉内,避免 Tab 跑到被遮挡的页面上
      const f = panelRef.current.querySelectorAll<HTMLElement>('a[href],button');
      if (f.length === 0) return;
      const first = f[0]!;
      const last = f[f.length - 1]!;
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    panelRef.current?.querySelector<HTMLElement>('a[href]')?.focus();
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={open ? styles.barsOpen : styles.bars} aria-hidden="true" />
      </button>

      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} aria-hidden="true" />
          <div className={styles.panel} id={panelId} ref={panelRef} role="dialog" aria-modal="true" aria-label={label}>
            <nav className={styles.panelNav}>
              {/* 抽屉里按同一顺序铺开:单页板块是一条直达链接,
                  多页板块列出小标题与其下各页 —— 手机上不做二级折叠,
                  展开一次就把全部去处看完,比层层点开快得多。 */}
              {entries.map((e) => (
                e.kind === 'link' ? (
                  <ul key={e.href} className={styles.list}>
                    <li>
                      <Link className={styles.primary} href={e.href} onClick={() => setOpen(false)}>
                        {e.label}
                      </Link>
                    </li>
                  </ul>
                ) : (
                  <section key={e.label} className={styles.group}>
                    <p className={styles.groupLabel}>{e.label}</p>
                    <ul className={styles.list}>
                      {e.links.map((l) => (
                        <li key={l.href}>
                          <Link className={styles.item} href={l.href} onClick={() => setOpen(false)}>
                            {l.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              ))}

              {cta && (
                <Link className={styles.cta} href={cta.href} onClick={() => setOpen(false)}>
                  {cta.label}
                </Link>
              )}
            </nav>
          </div>
        </>
      )}
    </>
  );
}
