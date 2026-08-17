import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getEventBySlug } from '@yumeet/core';
import { requirePageCapability, capabilitiesFor } from '@/lib/session';
import { resolveLocale } from '@/lib/locale-server';
import { translator } from '@/lib/i18n';
import { SignOutButton } from '@/components/sign-out-button';
import styles from './manage-layout.module.css';

interface Props {
  children: ReactNode;
  params: Promise<{ org: string; event: string }>;
}

/**
 * 后台统一鉴权入口(ch12 §12.1 防御一:对象级授权集中强制)。
 *
 * 所有 /manage/{org}/{event}/* 页面都被这一层覆盖:
 * 未登录 → 跳登录页并带回跳;已登录但无 event.view 能力 → 403 页。
 * 各子页面若需更高能力(如导出、发布),在自己的 Server Action 内再次校验 ——
 * 布局只是第一道闸,不是唯一一道。
 */
export default async function ManageLayout({ children, params }: Props) {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) notFound();

  const base = `/manage/${org}/${event}`;
  const user = await requirePageCapability(found.event.id, 'event.view', base);
  const caps = await capabilitiesFor(found.event.id);

  const locale = await resolveLocale();
  const tt = translator(locale);

  const nav: { href: string; label: string; show: boolean }[] = [
    { href: base, label: tt('overview'), show: true },
    { href: `${base}/submissions`, label: tt('submissions'), show: caps.has('submission.view') },
    { href: `${base}/review`, label: tt('myReviews'), show: caps.has('review.submit') },
    { href: `${base}/schedule`, label: tt('scheduleEditor'), show: caps.has('schedule.edit') },
    { href: `${base}/design`, label: tt('design'), show: caps.has('design.edit') },
    { href: `${base}/checkin`, label: tt('checkin'), show: caps.has('onsite.checkin') },
    { href: `${base}/payments`, label: tt('reconciliation'), show: caps.has('payment.reconcile') },
    { href: `${base}/members`, label: tt('membersTitle'), show: caps.has('member.manage') },
  ];

  return (
    <div className={styles.shell}>
      <header className={styles.bar}>
        <div className={styles.barInner}>
          <Link className={styles.brand} href={`/${org}/${event}`}>
            {found.event.title.replace(/^The\s+/i, '')}
          </Link>
          <nav className={styles.nav} aria-label={tt('manageNav')}>
            {nav.filter((n) => n.show).map((n) => (
              <Link key={n.href} className={styles.navLink} href={n.href}>{n.label}</Link>
            ))}
          </nav>
          <div className={styles.account}>
            <span className={styles.email} title={user.email}>{user.email}</span>
            <SignOutButton label={tt('signOut')} />
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}
