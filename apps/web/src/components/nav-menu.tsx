'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { NavLink } from './site-nav';
import styles from './nav-menu.module.css';

/**
 * 导航下拉菜单(ch08 §8.5)
 * 键盘可达:Enter/Space 展开,Esc 关闭并归还焦点,方向键在项间移动。
 */
export function NavMenu({ label, links }: { label: string; links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); }
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const onItemKeyDown = (e: React.KeyboardEvent<HTMLAnchorElement>, i: number) => {
    const items = wrapRef.current?.querySelectorAll<HTMLAnchorElement>('[data-menu-item]');
    if (!items) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); items[Math.min(i + 1, items.length - 1)]?.focus(); }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (i === 0) btnRef.current?.focus(); else items[i - 1]?.focus();
    }
  };

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            wrapRef.current?.querySelector<HTMLAnchorElement>('[data-menu-item]')?.focus();
          }
        }}
      >
        {label}
        <span className={styles.caret} aria-hidden="true" />
      </button>
      {open && (
        <ul className={styles.menu} id={listId}>
          {links.map((l, i) => (
            <li key={l.href}>
              <Link
                className={styles.item}
                href={l.href}
                data-menu-item=""
                onKeyDown={(e) => onItemKeyDown(e, i)}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
