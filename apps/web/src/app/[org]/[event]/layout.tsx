import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getEventBySlug, getEventForms, listNavPages } from '@yumeet/core';
import { SiteNav } from '@/components/site-nav';
import { ThemeStyle } from '@/components/theme-style';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';

interface Props {
  children: ReactNode;
  params: Promise<{ org: string; event: string }>;
}

/** 绑定了自定义域名时,导航链接省去 /org/event 前缀(ch07 §7.6) */
const BOUND_HOSTS = new Set(['mg18.ywang.science', 'mg17.ywang.science']);

export default async function EventLayout({ children, params }: Props) {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) notFound();

  const host = (await headers()).get('host')?.toLowerCase() ?? '';
  const bound = BOUND_HOSTS.has(host);
  const base = bound ? '' : `/${org}/${event}`;

  const locale = await resolveLocale();
  const tt = translator(locale);

  const [forms, navPages] = await Promise.all([
    getEventForms(found.event.id),
    listNavPages(found.event.id),
  ]);
  const modules = found.event.modules ?? {};

  const items: { href: string; label: string }[] = [];
  if (modules.schedule) items.push({ href: `${base}/schedule`, label: tt('schedule') });
  if (modules.cfp) items.push({ href: `${base}/cfp`, label: tt('cfp') });
  // 归档会议以摘要检索为主入口(ch05 §5.4:归档是一等公民)
  if (modules.archive) items.push({ href: `${base}/abstracts`, label: tt('abstracts') });

  // 自定义页面按分组进导航,超出 3 组的收进「更多」下拉
  const groups = navPages.reduce<Record<string, { href: string; label: string }[]>>(
    (acc, p) => {
      const g = p.group ?? 'about';
      const label = p.contentI18n?.[locale]?.title ?? p.title;
      (acc[g] ??= []).push({ href: `${base}/p/${p.slug}`, label });
      return acc;
    }, {});

  const short = found.event.title.replace(/^The\s+/i, '');

  return (
    <>
      {/* 活动主题:token 服务端直出,先于任何组件渲染(ch07 §7.2) */}
      <ThemeStyle
        themeId={found.event.themeId}
        overrides={found.event.themeOverrides}
      />
      <SiteNav
        base={base || '/'}
        title={short}
        items={items}
        groups={groups}
        locale={locale}
        cta={
          modules.registration && forms.length > 0
            ? { href: `${base}/register`, label: tt('register') }
            : null
        }
      />
      {children}
    </>
  );
}
