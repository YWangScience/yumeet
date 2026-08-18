import { formatMoney } from '@/lib/format';
import { translator, ticketContent, type Locale } from '@/lib/i18n';
import styles from './ticket-list.module.css';

interface Ticket {
  id: string; name: string; description: string | null;
  contentI18n?: Record<string, { name?: string; description?: string }> | null;
  priceCents: number; currency: string;
  quantityTotal: number | null; quantitySold: number;
  salesOpenAt: Date | null; salesCloseAt: Date | null;
}

export function TicketList({ tickets, locale }: { tickets: Ticket[]; locale: Locale }) {
  const now = new Date();
  const tt = translator(locale);
  return (
    <ul className={styles.list}>
      {tickets.map((t) => {
        const remaining = t.quantityTotal == null ? null : t.quantityTotal - t.quantitySold;
        const soldOut = remaining != null && remaining <= 0;
        const notYet = t.salesOpenAt != null && now < t.salesOpenAt;
        const closed = t.salesCloseAt != null && now > t.salesCloseAt;
        const unavailable = soldOut || notYet || closed;
        const c = ticketContent(t, locale);
        return (
          <li key={t.id} className={`${styles.item} ${unavailable ? styles.itemOff : ''}`}>
            <div className={styles.head}>
              <span className={styles.name}>{c.name}</span>
              <span className={styles.price}>{formatMoney(t.priceCents, t.currency)}</span>
            </div>
            {c.description && <p className={styles.desc}>{c.description}</p>}
            <p className={styles.status}>
              {soldOut && <span className={styles.badgeDanger}>{tt('soldOut')}</span>}
              {notYet && <span className={styles.badgeWarn}>{tt('notOnSale')}</span>}
              {closed && !soldOut && <span className={styles.badgeMuted}>{tt('salesClosed')}</span>}
              {!unavailable && remaining != null && remaining <= 30 && (
                <span className={styles.badgeWarn}>{tt('seatsLeft', { n: remaining })}</span>
              )}
              {!unavailable && (remaining == null || remaining > 30) && (
                <span className={styles.badgeOk}>{tt('openForRegistration')}</span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
