import type { ReactNode } from 'react';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { getEventBySlug, getEventForms } from '@yumeet/core';
import { SiteNav } from '@/components/site-nav';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';

interface Props {
  children: ReactNode;
  params: Promise<{ org: string; event: string }>;
}

/** 绑定了自定义域名时,导航链接省去 /org/event 前缀(ch07 §7.6) */
const BOUND_HOSTS = new Set(['mg18.ywang.science']);

export default async function EventLayout({ children, params }: Props) {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) notFound();

  const host = (await headers()).get('host')?.toLowerCase() ?? '';
  const bound = BOUND_HOSTS.has(host);
  const base = bound ? '' : `/${org}/${event}`;

  const locale = await resolveLocale();
  const tt = translator(locale);

  const forms = await getEventForms(found.event.id);
  const modules = found.event.modules ?? {};

  const items: { href: string; label: string }[] = [];
  if (modules.schedule) items.push({ href: `${base}/schedule`, label: tt('schedule') });
  if (modules.cfp) items.push({ href: `${base}/cfp`, label: tt('cfp') });

  const short = found.event.title.replace(/^The\s+/i, '');

  return (
    <>
      <SiteNav
        base={base || '/'}
        title={short}
        items={items}
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
