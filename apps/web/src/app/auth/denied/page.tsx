import Link from 'next/link';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import styles from '../login/login.module.css';

export const metadata = { title: '无权限 · yuMeet', robots: { index: false } };

export default async function DeniedPage({ searchParams }: {
  searchParams: Promise<{ cap?: string; lang?: string }>;
}) {
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);
  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <h1 className={styles.title}>{tt('noPermission')}</h1>
        <p className={styles.lede}>{tt('noPermissionBody')}</p>
        {sp.cap && <p className={styles.footnote}><code>{sp.cap}</code></p>}
        <p className={styles.footnote}><Link href="/">← {tt('backHome')}</Link></p>
      </div>
    </main>
  );
}
