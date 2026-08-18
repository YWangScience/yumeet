'use client';

import { useEffect, useState } from 'react';
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
 *
 * 讲者阵容是参会者决定是否注册的首要依据(ch01 原则 2:为每个角色做减法,
 * 但决定性信息必须前置),所以照片 + 姓名 + 单位 + 报告题目一律直出。
 *
 * 摘要收在卡片里就地展开 —— 三十多份摘要平铺在页面下方时,页面长到没人滚得到底,
 * 而且「谁讲什么」与「讲的是什么」被拆到两处。
 *
 * **整张卡片就是那个开关**,不在卡片里再放一枚小按钮:
 * 卡片本身已经是一个视觉上的可操作单元,再嵌一个按钮等于把命中区
 * 从两百多平方像素缩到几十,还让人先找按钮在哪。
 *
 * 也不写「展开摘要 / 收起」这类字。可点这件事该由样子说清楚 ——
 * 光标变手、悬停时卡片浮起并透出角标、展开后角标翻转,
 * 这些是人人都认得的信号。用文字讲解操作,等于承认视觉没做到位,
 * 而且三十多张卡片各挂一句同样的话,页面上就多了三十多处噪声。
 * 读屏用户不看这些视觉信号,他们拿到的是 <button> 的语义与 aria-expanded,
 * 信息量比那行字更准确。
 *
 * 网格用 align-items: start,于是展开的卡片只把自己撑高,不会顶动同排的其他人。
 */
export function SpeakerGrid({
  speakers, locale, moreHref, total, compact,
}: {
  speakers: SpeakerCard[];
  locale: Locale;
  moreHref?: string;
  total?: number;
  /**
   * 紧凑名录模式(首页用)。
   *
   * 首页要回答的是「都有谁来」——三十多个人名与面孔一次看完,
   * 这件事本身就是最强的注册理由。所以不展开摘要、不留大段留白,
   * 只铺头像与姓名;想读摘要的人点一下,落到讲者页对应的人并直接展开。
   * 同一份数据在两处各司其职:首页看阵容,讲者页读内容。
   */
  compact?: boolean;
}) {
  const tt = translator(locale);
  const [openId, setOpenId] = useState<string | null>(null);

  /*
   * 从首页名录点过来时带着 #s-<id>。
   * 只滚到位置还不够 —— 人点的是「我想看这个人讲什么」,
   * 所以落地即展开那一张,省掉到了之后还要再点一次。
   */
  useEffect(() => {
    if (compact) return;
    const apply = () => {
      const m = /^#s-(.+)$/.exec(decodeURIComponent(window.location.hash));
      if (!m) return;
      const id = m[1]!;
      if (!speakers.some((s) => s.id === id)) return;
      setOpenId(id);
      requestAnimationFrame(() => {
        document.getElementById(`s-${id}`)?.scrollIntoView({ block: 'center' });
      });
    };
    apply();
    window.addEventListener('hashchange', apply);
    return () => window.removeEventListener('hashchange', apply);
  }, [speakers, compact]);

  if (speakers.length === 0) return null;

  if (compact) {
    return (
      <>
        <ul className={styles.roster}>
          {speakers.map((s) => (
            <li key={s.id} className={styles.rosterItem}>
              <Link className={styles.rosterLink} href={`${moreHref ?? ''}#s-${s.id}`}>
                {s.photoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    className={styles.rosterPhoto}
                    src={s.photoUrl}
                    alt=""
                    loading="lazy"
                    width={64}
                    height={64}
                  />
                ) : (
                  <span className={styles.rosterAvatar} aria-hidden="true">{initials(s.name)}</span>
                )}
                <span className={styles.rosterName}>{s.name}</span>
                {s.affiliation && (
                  <span className={styles.rosterAff}>{s.affiliation}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
        {moreHref && total != null && total > speakers.length && (
          <p className={styles.more}>
            <Link href={moreHref}>{tt('seeAllSpeakers', { n: total })} →</Link>
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <ul className={styles.grid}>
        {speakers.map((s) => {
          const open = openId === s.id;
          const hasBio = Boolean(s.bio);
          return (
            <li key={s.id} className={open ? styles.cardOpen : styles.card} id={`s-${s.id}`}>
              <button
                type="button"
                className={styles.hit}
                aria-expanded={hasBio ? open : undefined}
                aria-controls={hasBio ? `bio-${s.id}` : undefined}
                disabled={!hasBio}
                onClick={() => hasBio && setOpenId(open ? null : s.id)}
              >
                <div className={styles.head}>
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
                {hasBio && (
                  <span className={open ? styles.chevronUp : styles.chevron} aria-hidden="true" />
                )}
              </div>
              </button>

              {hasBio && (
                <div id={`bio-${s.id}`} className={styles.bio} hidden={!open}>
                  <p className={styles.bioText}>{s.bio}</p>
                </div>
              )}
            </li>
          );
        })}
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
