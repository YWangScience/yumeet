import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, listThemes } from '@yumeet/core';
import { resolveLocale } from '@/lib/locale-server';
import { translator, eventContent, INTL_LOCALE } from '@/lib/i18n';
import { formatDateRange } from '@/lib/format';
import { LangSwitch } from '@/components/lang-switch';
import { ThemeEditor } from '@/components/theme-editor';
import styles from './design.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return {
    title: found ? `主题与外观 · ${found.event.title}` : '主题与外观',
    robots: { index: false },
  };
}

/**
 * 组织者主题设置页(ch07 §7.5)
 *
 * 同一个编辑器承载 L0(模板包 + 主色)与 L1(token 微调):左栏分组编辑,右栏用
 * 该活动的真实内容实时预览。保存写 events.theme_id / theme_overrides,
 * 公共页由 ThemeStyle 服务端注入,不经客户端脚本。
 */
export default async function DesignPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const locale = await resolveLocale(await searchParams);
  const tt = translator(locale);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  const { event, org } = found;
  const content = eventContent(event, locale);
  const themes = listThemes(locale);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerMain}>
          <p className={styles.eyebrow}>{tt('designEyebrow')}</p>
          <h1 className={styles.title}>{tt('designTitle')}</h1>
          <p className={styles.eventName}>{content.title}</p>
          <p className={styles.lede}>{tt('designLede')}</p>
        </div>
        <div className={styles.headerAside}>
          <LangSwitch locale={locale} />
          <div className={styles.links}>
            <Link className={styles.link} href={`/manage/${orgSlug}/${eventSlug}`}>
              ← {tt('designEyebrow')}
            </Link>
            <Link className={styles.link} href={`/${orgSlug}/${eventSlug}`}>
              {tt('backToEvent')} ↗
            </Link>
          </div>
        </div>
      </header>

      <ThemeEditor
        orgSlug={orgSlug}
        eventSlug={eventSlug}
        locale={locale}
        themes={themes}
        initialThemeId={event.themeId}
        initialOverrides={event.themeOverrides ?? {}}
        event={{
          kicker: org.name,
          title: content.title,
          subtitle: content.subtitle,
          meta: formatDateRange(
            event.startsAt, event.endsAt, event.timezone, INTL_LOCALE[locale],
          ),
        }}
      />
    </div>
  );
}
