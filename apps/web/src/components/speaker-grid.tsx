'use client';

import { useState } from 'react';
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
 * 摘要则收在卡片里,点击才展开 —— 三十多位讲者的摘要平铺在页面下方时,
 * 页面会长到没人滚得到底,而且「谁讲什么」与「讲的是什么」被拆到两处,
 * 想看某人的摘要得先记住名字再去下面找。就地展开把这两件事合回一处。
 *
 * 网格用 align-items: start,于是展开的卡片只把自己撑高,不会顶动同排的其他人。
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
  const [openId, setOpenId] = useState<string | null>(null);
  if (speakers.length === 0) return null;

  return (
    <>
      <ul className={styles.grid}>
        {speakers.map((s) => {
          const open = openId === s.id;
          const hasBio = Boolean(s.bio);
          return (
            <li key={s.id} className={open ? styles.cardOpen : styles.card} id={`s-${s.id}`}>
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

                  {hasBio && (
                    <button
                      type="button"
                      className={styles.toggle}
                      aria-expanded={open}
                      aria-controls={`bio-${s.id}`}
                      onClick={() => setOpenId(open ? null : s.id)}
                    >
                      <span>{open ? tt('hideAbstract') : tt('readAbstract')}</span>
                      <span className={open ? styles.chevronUp : styles.chevron} aria-hidden="true">
                        ⌄
                      </span>
                    </button>
                  )}
                </div>
              </div>

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
