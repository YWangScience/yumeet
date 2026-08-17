/**
 * 会场屏(ch05 §5.2.3)—— 门口平板 / 投影用的全屏展示页
 *
 * 服务端渲染首屏(无 JS 也能看到日程),客户端接管后经 SSE 收公告与日程变更。
 * 版式按「三米外看得清」设计:大字号、高对比、无装饰。
 */
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, getScreenState, listRooms, decodeId } from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import { ScreenLive } from './screen-live';
import styles from './screen.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string; room?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return {
    title: found ? `会场屏 · ${found.event.title}` : '会场屏',
    robots: { index: false },
  };
}

export default async function ScreenPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const sp = await searchParams;
  const locale = await resolveLocale(sp);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  let roomUuid: string | null = null;
  if (sp.room) {
    try {
      roomUuid = decodeId('room', sp.room);
    } catch {
      roomUuid = null;
    }
  }

  const [state, rooms] = await Promise.all([
    getScreenState(found.event.id, { roomId: roomUuid }),
    listRooms(found.event.id),
  ]);

  const base = `/manage/${orgSlug}/${eventSlug}/screen`;

  return (
    <main className={styles.screen}>
      {/* 屏幕本身不需要导航,但值班同事要能切房间与语言,做成低调的一行 */}
      <nav className={styles.chrome} aria-label={tt('screenRoom')}>
        <Link className={styles.chromeLink} href={`${base}/console?lang=${locale}`}>
          ← {tt('screenBackToConsole')}
        </Link>
        <div className={styles.chromeRooms}>
          <Link
            className={`${styles.chromeChip} ${!roomUuid ? styles.chromeChipActive : ''}`}
            href={`${base}?lang=${locale}`}
          >
            {tt('screenAllRooms')}
          </Link>
          {rooms.map((r) => (
            <Link
              key={r.id}
              className={`${styles.chromeChip} ${roomUuid === r.uuid ? styles.chromeChipActive : ''}`}
              href={`${base}?lang=${locale}&room=${r.id}`}
            >
              {r.name}
            </Link>
          ))}
        </div>
        <div className={styles.chromeRooms}>
          <Link className={styles.chromeChip} href={`${base}?lang=zh${sp.room ? `&room=${sp.room}` : ''}`} lang="zh-Hans">中文</Link>
          <Link className={styles.chromeChip} href={`${base}?lang=en${sp.room ? `&room=${sp.room}` : ''}`} lang="en">EN</Link>
        </div>
      </nav>

      <ScreenLive initial={state} locale={locale} streamPath={`/api/v1/events/${state.event.id}/stream`} roomParam={sp.room ?? null} />
    </main>
  );
}
