import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, getEventForms, getEventTickets,
  listRegistrations, registrationStats, displayStatus, encodeId,
  REGISTRATION_LABELS, type RegStatus,
} from '@yumeet/core';
import { formatDateRange, formatMoney } from '@/lib/format';
import { RegistrationRow } from '@/components/registration-row';
import styles from './manage.module.css';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ status?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  return { title: found ? `管理 · ${found.event.title}` : '管理', robots: { index: false } };
}

const STAT_ORDER: RegStatus[] = [
  'confirmed', 'awaiting_payment', 'pending_review', 'waitlisted',
  'checked_in', 'cancelled', 'rejected', 'expired',
];

export default async function ManagePage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const { status } = await searchParams;
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  const { event } = found;
  const filter = STAT_ORDER.includes(status as RegStatus) ? (status as RegStatus) : undefined;

  const [stats, list, tickets, forms] = await Promise.all([
    registrationStats(event.id),
    listRegistrations(event.id, { status: filter, limit: 50 }),
    getEventTickets(event.id),
    getEventForms(event.id),
  ]);

  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const active = (stats['confirmed'] ?? 0) + (stats['checked_in'] ?? 0);
  const revenue = tickets.reduce((sum, t) => sum + t.priceCents * t.quantitySold, 0);
  const currency = tickets[0]?.currency ?? 'HKD';
  const capacity = forms[0]?.capacity ?? null;

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>组织者后台</p>
          <h1 className={styles.title}>{event.title}</h1>
          <p className={styles.meta}>
            {formatDateRange(event.startsAt, event.endsAt, event.timezone)}
            {' · '}
            <span className={styles.statusChip}>{displayStatus(event) === 'published' ? '已发布' : displayStatus(event)}</span>
          </p>
        </div>
        <Link className={styles.viewSite} href={`/${orgSlug}/${eventSlug}`}>
          查看公共页 ↗
        </Link>
      </header>

      <section className={styles.kpis} aria-label="概览">
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>有效报名</span>
          <span className={styles.kpiValue}>{active}</span>
          {capacity && <span className={styles.kpiSub}>容量 {capacity}</span>}
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>待处理</span>
          <span className={styles.kpiValue}>
            {(stats['pending_review'] ?? 0) + (stats['awaiting_payment'] ?? 0)}
          </span>
          <span className={styles.kpiSub}>审核 + 待支付</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>候补</span>
          <span className={styles.kpiValue}>{stats['waitlisted'] ?? 0}</span>
        </div>
        <div className={styles.kpi}>
          <span className={styles.kpiLabel}>票款(已占位)</span>
          <span className={styles.kpiValue}>{formatMoney(revenue, currency)}</span>
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>报名名单</h2>
          <div className={styles.exportActions}>
            <a
              className={styles.buttonSecondary}
              href={`/manage/${orgSlug}/${eventSlug}/export.csv`}
            >
              导出 CSV
            </a>
          </div>
        </div>

        <nav className={styles.filters} aria-label="按状态筛选">
          <Link
            className={`${styles.filter} ${!filter ? styles.filterActive : ''}`}
            href={`/manage/${orgSlug}/${eventSlug}`}
          >
            全部 <span className={styles.filterCount}>{total}</span>
          </Link>
          {STAT_ORDER.filter((s) => (stats[s] ?? 0) > 0).map((s) => (
            <Link
              key={s}
              className={`${styles.filter} ${filter === s ? styles.filterActive : ''}`}
              href={`/manage/${orgSlug}/${eventSlug}?status=${s}`}
            >
              {REGISTRATION_LABELS[s].zh} <span className={styles.filterCount}>{stats[s]}</span>
            </Link>
          ))}
        </nav>

        {list.rows.length === 0 ? (
          <p className={styles.empty}>暂无符合条件的报名记录。</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">参会人</th>
                  <th scope="col">机构</th>
                  <th scope="col">票种</th>
                  <th scope="col">确认码</th>
                  <th scope="col">状态</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <RegistrationRow
                    key={r.id}
                    registration={{
                      publicId: encodeId('registration', r.id),
                      id: r.id,
                      email: r.email,
                      answers: r.answers as Record<string, unknown>,
                      confirmationCode: r.confirmationCode,
                      status: r.status as RegStatus,
                      ticketName: tickets.find((t) => t.id === r.ticketId)?.name ?? '—',
                    }}
                    orgSlug={orgSlug}
                    eventSlug={eventSlug}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
        {list.total > list.rows.length && (
          <p className={styles.pageHint}>
            显示 {list.rows.length} / {list.total} 条(分页上限 100,见 API 规范)
          </p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>票种库存</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">票种</th>
                <th scope="col">价格</th>
                <th scope="col">已售 / 总量</th>
                <th scope="col">余量</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const remaining = t.quantityTotal == null ? null : t.quantityTotal - t.quantitySold;
                return (
                  <tr key={t.id}>
                    <td>{t.name}</td>
                    <td className={styles.num}>{formatMoney(t.priceCents, t.currency)}</td>
                    <td className={styles.num}>
                      {t.quantitySold} / {t.quantityTotal ?? '不限'}
                    </td>
                    <td className={styles.num}>
                      {remaining == null ? '—' : (
                        <span className={remaining <= 30 ? styles.low : ''}>{remaining}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
