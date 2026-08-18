'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import type { NavLink } from './site-nav';
import styles from './nav-menu.module.css';

/**
 * 导航下拉菜单(ch08 §8.5)
 *
 * 指针设备上**悬停即展开**:导航是浏览行为,不是提交行为,
 * 逼人先点一下才肯露出目录,等于在每次找路时多收一次费。
 *
 * 三处细节决定它是好用还是烦人:
 *   进入不延迟 —— 鼠标落到标签上,菜单立刻在;犹豫感来自延迟。
 *   离开延迟 160ms —— 指针从标签斜切到菜单项时会短暂掠过外部,
 *     立即收起会让菜单在半路消失,这是悬停菜单最常见的毛病。
 *   触屏与键盘仍走点击/Enter —— 触屏没有悬停,把它当成鼠标是行不通的。
 */
export function NavMenu({ label, links }: { label: string; links: NavLink[] }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listId = useId();

  const cancelClose = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
  };
  const openNow = () => { cancelClose(); setOpen(true); };
  const closeSoon = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 160);
  };

  useEffect(() => () => cancelClose(), []);

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
    <div
      className={styles.wrap}
      ref={wrapRef}
      onPointerEnter={(e) => { if (e.pointerType === 'mouse') openNow(); }}
      onPointerLeave={(e) => { if (e.pointerType === 'mouse') closeSoon(); }}
      // 焦点移出整个菜单才收起:Tab 在标签与菜单项之间移动时不该被打断
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={btnRef}
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-controls={listId}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        onFocus={openNow}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            wrapRef.current?.querySelector<HTMLAnchorElement>('[data-menu-item]')?.focus();
          }
        }}
      >
        {label}
        <span className={open ? styles.caretUp : styles.caret} aria-hidden="true" />
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
