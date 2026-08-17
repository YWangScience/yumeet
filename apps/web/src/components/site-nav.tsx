import Link from 'next/link';
import { Suspense } from 'react';
import { LangSwitch } from './lang-switch';
import type { Locale } from '@/lib/i18n';
import styles from './site-nav.module.css';

interface Props {
  /** 绑定域名时隐藏 org/event 前缀,链接直接用根路径 */
  base: string;
  title: string;
  items: { href: string; label: string }[];
  cta?: { href: string; label: string } | null;
  locale: Locale;
}

/**
 * 活动站顶部导航(ch08 §8.3:毛玻璃材质 + 发丝线,高 48px)
 */
export function SiteNav({ base, title, items, cta, locale }: Props) {
  return (
    <nav className={styles.nav} aria-label="活动导航">
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
