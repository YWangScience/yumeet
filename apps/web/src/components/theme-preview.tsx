'use client';

import type { CSSProperties } from 'react';
import type { TokenMap } from '@yumeet/core/client';
import { translator, type Locale } from '@/lib/i18n';
import styles from './theme-preview.module.css';

export type PreviewMode = 'light' | 'dark';

/** 断点 → 缩放比:让 768/1280 的版式能在编辑器右栏里整屏看到 */
const ZOOM: Record<number, number> = { 375: 1, 768: 0.72, 1280: 0.44 };

interface Props {
  /** 已合并好的 token(浅色或深色的那一套) */
  tokens: TokenMap;
  mode: PreviewMode;
  /** 预览视口宽度(px),对应 375 / 768 / 1280 三个断点 */
  width: number;
  locale: Locale;
  event: { kicker: string; title: string; subtitle: string | null; meta: string };
}

/**
 * 主题实时预览(ch07 §7.5)
 *
 * 把合并后的 token 作为内联自定义属性挂在预览框上,内部所有样式一律 var(--yu-…) 读取——
 * 与公共活动页读的是同一组变量,因此这里看到的就是发布后的样子。
 * 改动只更新这一组变量,不重建、不发请求,肉眼无延迟。
 */
export function ThemePreview({ tokens, mode, width, locale, event }: Props) {
  const tt = translator(locale);
  const frameStyle = {
    ...(tokens as Record<string, string>),
    colorScheme: mode,
    width: `${width}px`,
    zoom: ZOOM[width] ?? 1,
  } as unknown as CSSProperties;

  return (
    // 缩放后仍可能超出栏宽(窄屏),滚动容器必须可聚焦才符合 WCAG 2.1.1
    <div
      className={styles.viewport}
      tabIndex={0}
      role="group"
      aria-label={tt('livePreview')}
    >
      <div className={styles.frame} style={frameStyle} data-mode={mode}>
        <div className={styles.nav}>
          <span className={styles.navTitle}>{event.kicker}</span>
          <span className={styles.navCta}>{tt('register')}</span>
        </div>

        <div className={styles.hero}>
          <p className={styles.kicker}>{event.kicker}</p>
          <p className={styles.heroTitle}>{event.title}</p>
          {event.subtitle && <p className={styles.heroSub}>{event.subtitle}</p>}
          <p className={styles.ctaRow}>
            <span className={styles.buttonPrimary}>{tt('registerCta')}</span>
            <span className={styles.textLink}>{tt('viewSchedule')} ›</span>
          </p>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionTitle}>{tt('schedule')}</p>
          <div className={styles.card}>
            <p className={styles.cardTitle}>{tt('previewSampleSession')}</p>
            <p className={styles.cardMeta}>{event.meta}</p>
            <p className={styles.cardMeta}>{tt('previewSampleMeta')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
