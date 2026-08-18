import type { Locale } from '@/lib/i18n';
import styles from './committee-list.module.css';

export interface CommitteeMember {
  id: string;
  name: string;
  affiliation: string | null;
  country: string | null;
  role: string | null;
}

/**
 * 委员会名单:按国家/地区分组的可扫读列表。
 * 数百人的名单若作为一段正文,读者无法定位熟悉的名字;
 * 分组 + 主席前置能让「谁在背书这场会议」一眼可见。
 */
export function CommitteeList({
  members, locale,
}: { members: CommitteeMember[]; locale: Locale }) {
  if (members.length === 0) return null;

  const chairs = members.filter((m) => m.role && /chair/i.test(m.role));
  const rest = members.filter((m) => !(m.role && /chair/i.test(m.role)));

  /*
   * 按国家分组只在真有国家数据时才做。
   *
   * 早先的写法是 `m.country ?? m.affiliation`,于是本地组织委员会
   * (没有国家、只有单位)被按单位分组,小标题成了 ICRANET、UD'A ——
   * 看上去像是国家名写错了。缺国家数据时就平铺成一份名单,
   * 这也更贴合本地委员会的实际:一个城市里的几家机构,本就不需要按国家分。
   */
  const withCountry = rest.filter((m) => m.country);
  const byCountry = new Map<string, CommitteeMember[]>();
  for (const m of withCountry) {
    const list = byCountry.get(m.country!) ?? [];
    list.push(m);
    byCountry.set(m.country!, list);
  }
  const groups = [...byCountry.entries()].sort(([a], [b]) => a.localeCompare(b));
  // 至少八成的人有国家,分组才有意义;否则大半会落进「其他」
  const hasCountries = groups.length > 1 && withCountry.length >= rest.length * 0.8;

  return (
    <div className={styles.wrap}>
      {chairs.length > 0 && (
        <section className={styles.chairs}>
          <h3 className={styles.chairsLabel}>
            {locale === 'zh' ? '主席' : 'Chairpersons'}
          </h3>
          <ul className={styles.chairList}>
            {chairs.map((c) => (
              <li key={c.id} className={styles.chair}>
                <span className={styles.chairName}>{c.name}</span>
                {(c.affiliation ?? c.country) && (
                  <span className={styles.chairAff}>{c.affiliation ?? c.country}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {hasCountries ? (
        <div className={styles.countries}>
          {groups.map(([country, list]) => (
            <section key={country} className={styles.country}>
              <h3 className={styles.countryName}>{country}</h3>
              <ul className={styles.members}>
                {list.map((m) => (
                  <li key={m.id} className={styles.member}>
                    {m.name}
                    {m.role && <span className={styles.role}>{m.role}</span>}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <ul className={styles.flatList}>
          {rest.map((m) => (
            <li key={m.id} className={styles.flatMember}>
              <span className={styles.flatName}>{m.name}</span>
              {m.affiliation && <span className={styles.flatAff}>{m.affiliation}</span>}
              {m.role && <span className={styles.role}>{m.role}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
