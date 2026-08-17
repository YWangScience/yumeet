import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import styles from './login.module.css';

export const metadata: Metadata = { title: '登录 · yuMeet', robots: { index: false } };

const ERRORS: Record<string, { zh: string; en: string }> = {
  missing_token: { zh: '链接缺少凭证', en: 'The link is missing its token' },
  invalid_token: { zh: '链接无效或已被使用', en: 'This link is invalid or already used' },
  token_used: { zh: '该链接已被使用过,请重新获取', en: 'This link was already used' },
  token_expired: { zh: '链接已过期,请重新获取', en: 'This link has expired' },
  purpose_mismatch: { zh: '该链接不能用于登录', en: 'This link cannot be used to sign in' },
};

export default async function LoginPage({ searchParams }: {
  searchParams: Promise<{ next?: string; error?: string; lang?: string }>;
}) {
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);
  const err = sp.error ? ERRORS[sp.error] : null;

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <p className={styles.wordmark}>yuMeet</p>
        <h1 className={styles.title}>{tt('signIn')}</h1>
        <p className={styles.lede}>{tt('signInLede')}</p>
        {err && <p className={styles.error} role="alert">{err[locale]}</p>}
        <LoginForm locale={locale} next={sp.next ?? '/'} />
        <p className={styles.footnote}>{tt('signInNoPassword')}</p>
      </div>
    </main>
  );
}
