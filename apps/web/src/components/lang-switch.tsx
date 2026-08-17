'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { LOCALE_COOKIE, type Locale } from '@/lib/i18n';
import styles from './lang-switch.module.css';

/**
 * 中英切换(ch08 §8.8)
 * 写 Cookie 记住选择,同时把 ?lang= 落到 URL —— 分享出去的链接保留语言。
 */
export function LangSwitch({ locale }: { locale: Locale }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function switchTo(next: Locale) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    const sp = new URLSearchParams(params.toString());
    sp.set('lang', next);
    router.push(`${pathname}?${sp.toString()}`);
    router.refresh();
  }

  return (
    <div className={styles.wrap} role="group" aria-label="Language / 语言">
      <button
        type="button"
        className={`${styles.btn} ${locale === 'zh' ? styles.active : ''}`}
        onClick={() => switchTo('zh')}
        aria-pressed={locale === 'zh'}
        lang="zh-Hans"
      >
        中文
      </button>
      <span className={styles.sep} aria-hidden="true" />
      <button
        type="button"
        className={`${styles.btn} ${locale === 'en' ? styles.active : ''}`}
        onClick={() => switchTo('en')}
        aria-pressed={locale === 'en'}
        lang="en"
      >
        EN
      </button>
    </div>
  );
}
