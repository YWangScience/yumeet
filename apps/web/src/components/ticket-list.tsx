import { formatMoney } from '@/lib/format';
import styles from './ticket-list.module.css';

interface Ticket {
  id: string; name: string; description: string | null;
  priceCents: number; currency: string;
  quantityTotal: number | null; quantitySold: number;
  salesOpenAt: Date | null; salesCloseAt: Date | null;
}

export function TicketList({ tickets }: { tickets: Ticket[] }) {
  const now = new Date();
  return (
    <ul className={styles.list}>
      {tickets.map((t) => {
        const remaining = t.quantityTotal == null ? null : t.quantityTotal - t.quantitySold;
        const soldOut = remaining != null && remaining <= 0;
        const notYet = t.salesOpenAt != null && now < t.salesOpenAt;
        const closed = t.salesCloseAt != null && now > t.salesCloseAt;
        const unavailable = soldOut || notYet || closed;
        return (
          <li key={t.id} className={`${styles.item} ${unavailable ? styles.itemOff : ''}`}>
            <div className={styles.head}>
              <span className={styles.name}>{t.name}</span>
              <span className={styles.price}>{formatMoney(t.priceCents, t.currency)}</span>
            </div>
            {t.description && <p className={styles.desc}>{t.description}</p>}
            <p className={styles.status}>
              {soldOut && <span className={styles.badgeDanger}>已售罄</span>}
              {notYet && <span className={styles.badgeWarn}>尚未开售</span>}
              {closed && !soldOut && <span className={styles.badgeMuted}>已停售</span>}
              {!unavailable && remaining != null && remaining <= 30 && (
                <span className={styles.badgeWarn}>仅剩 {remaining} 席</span>
              )}
              {!unavailable && (remaining == null || remaining > 30) && (
                <span className={styles.badgeOk}>可注册</span>
              )}
            </p>
          </li>
        );
      })}
    </ul>
  );
}
