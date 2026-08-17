import Link from 'next/link';
import type { Locale } from '@/lib/i18n';
import { translator } from '@/lib/i18n';
import styles from './speaker-grid.module.css';

export interface SpeakerCard {
  id: string;
  name: string;
  affiliation: string | null;
  talkTitle: string | null;
  photoUrl: string | null;
  bio: string | null;
}

/** 姓名首字母,无照片时作占位 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * 特邀讲者卡片墙。
 * 讲者阵容是参会者决定是否注册的首要依据(ch01 原则 2:为每个角色做减法,
 * 但决定性信息必须前置),因此用照片 + 姓名 + 报告题目的高信息密度卡片,
 * 而不是把人名埋进正文段落。
 */
export function SpeakerGrid({
  speakers, locale, moreHref, total,
}: {
  speakers: SpeakerCard[];
  locale: Locale;
  moreHref?: string;
  total?: number;
}) {
  const tt = translator(locale);
  if (speakers.length === 0) return null;

  return (
    <>
      <ul className={styles.grid}>
        {speakers.map((s) => (
          <li key={s.id} className={styles.card}>
            {s.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className={styles.photo}
                src={s.photoUrl}
                alt=""
                loading="lazy"
                width={72}
                height={72}
              />
            ) : (
              <span className={styles.avatar} aria-hidden="true">{initials(s.name)}</span>
            )}
            <div className={styles.body}>
              <p className={styles.name}>{s.name}</p>
              {s.affiliation && <p className={styles.aff}>{s.affiliation}</p>}
              {s.talkTitle && <p className={styles.talk}>{s.talkTitle}</p>}
            </div>
          </li>
        ))}
      </ul>
      {moreHref && total != null && total > speakers.length && (
        <p className={styles.more}>
          <Link href={moreHref}>
            {tt('seeAllSpeakers', { n: total })} →
          </Link>
        </p>
      )}
    </>
  );
}
