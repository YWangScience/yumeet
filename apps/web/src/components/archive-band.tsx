import Link from 'next/link';
import { translator, type Locale } from '@/lib/i18n';
import styles from './archive-band.module.css';

export interface ArchiveStat {
  value: number;
  labelKey: 'archiveContributions' | 'archiveSessions' | 'archiveSpeakers' | 'archiveDays';
  href?: string;
}

/**
 * 归档会议的数字概览(ch05 §5.4「归档是一等公民」)。
 *
 * 会议结束后,页面的主要读者从「要不要来」变成「那次讲了什么」。
 * 因此把规模数字与摘要入口提到首屏之下第一屏,而不是让人先读一段介绍
 * 再去下拉菜单里找摘要 —— 会议活两周,归档活二十年。
 */
export function ArchiveBand({ stats, locale }: { stats: ArchiveStat[]; locale: Locale }) {
  const tt = translator(locale);
  const visible = stats.filter((s) => s.value > 0);
  if (visible.length === 0) return null;

  return (
    <section className={styles.band} aria-label={tt('archiveOverview')}>
      <ul className={styles.list}>
        {visible.map((s) => {
          const inner = (
            <>
              <span className={styles.value}>{s.value.toLocaleString()}</span>
              <span className={styles.label}>{tt(s.labelKey)}</span>
            </>
          );
          return (
            <li key={s.labelKey} className={styles.item}>
              {s.href
                ? <Link className={styles.link} href={s.href}>{inner}</Link>
                : <span className={styles.static}>{inner}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
