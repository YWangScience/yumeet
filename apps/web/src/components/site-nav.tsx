import Link from 'next/link';
import { Suspense } from 'react';
import { LangSwitch } from './lang-switch';
import { NavMenu } from './nav-menu';
import { MobileNav } from './mobile-nav';
import type { Locale } from '@/lib/i18n';
import styles from './site-nav.module.css';

export interface NavLink { href: string; label: string }

/**
 * 导航的一项:要么是一条直达链接,要么是一个下拉板块。
 *
 * 用一个有序数组而不是「links + groups 两个集合」——
 * 后者会强制把所有直达链接排在所有下拉之前,
 * 于是 Program 明明是第一个板块,却因为它有子页而被挤到 Award 后面。
 */
export type NavEntry =
  | { kind: 'link'; href: string; label: string }
  | { kind: 'menu'; label: string; links: NavLink[] };

interface Props {
  /** 绑定域名时隐藏 org/event 前缀,链接直接用根路径 */
  base: string;
  title: string;
  /** 按会议结构排好序的板块 */
  entries: NavEntry[];
  cta?: NavLink | null;
  locale: Locale;
}

/**
 * 活动站顶部导航(ch08 §8.3:毛玻璃材质 + 发丝线,高 48px)
 */
export function SiteNav({ base, title, entries, cta, locale }: Props) {
  // 顺序完全由调用方决定(Program → Talks → … → About),这里不再排序。
  const shown = entries.filter((e) => e.kind === 'link' || e.links.length > 0);

  return (
    <nav className={styles.nav} aria-label={locale === 'zh' ? '活动导航' : 'Event navigation'}>
      <div className={styles.inner}>
        <Link className={styles.brand} href={base || '/'}>
          {/* 「17th」里的序数后缀排成上标,是学界写会议届数的惯例;
              标题里没有这种模式时原样输出。 */}
          {(() => {
            const m = /^(\d+)(st|nd|rd|th)\s+(.+)$/.exec(title);
            if (!m) return title;
            return (
              <>
                {m[1]}<sup className={styles.ordinal}>{m[2]}</sup> {m[3]}
              </>
            );
          })()}
        </Link>
        <div className={styles.links}>
          {shown.map((e) => (
            e.kind === 'link' ? (
              <Link key={e.href} className={styles.link} href={e.href}>
                {e.label}
              </Link>
            ) : (
              <NavMenu key={e.label} label={e.label} links={e.links} />
            )
          ))}
          <MobileNav
            label={locale === 'zh' ? '菜单' : 'Menu'}
            entries={shown}
            cta={cta}
          />
          <Suspense fallback={null}>
            <LangSwitch locale={locale} />
          </Suspense>
          {cta && (
            <Link className={styles.cta} href={cta.href}>
              {cta.label}
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
