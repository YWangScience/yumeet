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
 * 摘要收在卡片里就地展开 —— 三十多份摘要平铺在页面下方时,页面长到没人滚得到底,
 * 而且「谁讲什么」与「讲的是什么」被拆到两处。
 *
 * **整张卡片就是那个开关**,不在卡片里再放一枚小按钮:
 * 卡片本身已经是一个视觉上的可操作单元,再嵌一个按钮等于把命中区
 * 从两百多平方像素缩到几十,还让人先找按钮在哪。右下角的箭头只是状态提示,
 * 不是唯一的下手处。语义上用 <button> 包住整块,键盘与读屏因此照常可用。
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

                  {hasBio && (
                    <span className={styles.hint}>
                      <span className={styles.hintText}>
                        {open ? tt('hideAbstract') : tt('readAbstract')}
                      </span>
                      <span className={open ? styles.chevronUp : styles.chevron} aria-hidden="true">
                        ⌄
                      </span>
                    </span>
                  )}
                </div>
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
