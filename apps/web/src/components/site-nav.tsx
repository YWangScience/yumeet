import Link from 'next/link';
import { Suspense } from 'react';
import { LangSwitch } from './lang-switch';
import { NavMenu } from './nav-menu';
import type { Locale } from '@/lib/i18n';
import styles from './site-nav.module.css';

export interface NavLink { href: string; label: string }

interface Props {
  /** 绑定域名时隐藏 org/event 前缀,链接直接用根路径 */
  base: string;
  title: string;
  items: NavLink[];
  /** 自定义页面按分组(programme / practical / about)进入下拉菜单 */
  groups?: Record<string, NavLink[]>;
  cta?: NavLink | null;
  locale: Locale;
}

const GROUP_LABEL: Record<string, Record<Locale, string>> = {
  programme: { zh: '会议信息', en: 'Programme' },
  practical: { zh: '实用信息', en: 'Practical' },
  about: { zh: '关于', en: 'About' },
};

/**
 * 活动站顶部导航(ch08 §8.3:毛玻璃材质 + 发丝线,高 48px)
 */
export function SiteNav({ base, title, items, groups, cta, locale }: Props) {
  const groupEntries = Object.entries(groups ?? {})
    .filter(([, links]) => links.length > 0)
    .sort(([a], [b]) => {
      const order = ['programme', 'practical', 'about'];
      return order.indexOf(a) - order.indexOf(b);
    });

  return (
    <nav className={styles.nav} aria-label={locale === 'zh' ? '活动导航' : 'Event navigation'}>
      <div className={styles.inner}>
        <Link className={styles.brand} href={base || '/'}>
          {title}
        </Link>
        <div className={styles.links}>
          {items.map((i) => (
            <Link key={i.href} className={styles.link} href={i.href}>
              {i.label}
            </Link>
          ))}
          {groupEntries.map(([group, links]) => (
            <NavMenu
              key={group}
              label={GROUP_LABEL[group]?.[locale] ?? group}
              links={links}
            />
          ))}
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
