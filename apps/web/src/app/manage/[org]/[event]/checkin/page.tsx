import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, registrationStats } from '@yumeet/core';
import { CheckinConsole } from '@/components/checkin-console';
import styles from './checkin.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: '签到台 · yuMeet',
  robots: { index: false },
};

interface Props {
  params: Promise<{ org: string; event: string }>;
}

export default async function CheckinPage({ params }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  const stats = await registrationStats(found.event.id);
  const confirmed = stats['confirmed'] ?? 0;
  const checkedIn = stats['checked_in'] ?? 0;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>现场签到台</p>
          <h1 className={styles.title}>{found.event.title}</h1>
        </div>
        <Link className={styles.back} href={`/manage/${orgSlug}/${eventSlug}`}>
          返回后台
        </Link>
      </header>

      <div className={styles.counters}>
        <div className={styles.counter}>
          <span className={styles.counterValue}>{checkedIn}</span>
          <span className={styles.counterLabel}>已签到</span>
        </div>
        <div className={styles.counterDivider} aria-hidden="true" />
        <div className={styles.counter}>
          <span className={styles.counterValueMuted}>{confirmed}</span>
          <span className={styles.counterLabel}>待签到</span>
        </div>
      </div>

      <CheckinConsole orgSlug={orgSlug} eventSlug={eventSlug} />

      <p className={styles.hint}>
        输入参会人确认码(8 位)后回车即可签到。网络中断时输入会暂存在本机,
        恢复后自动补交(ch05 §5.2 离线容错)。
      </p>
    </main>
  );
}
