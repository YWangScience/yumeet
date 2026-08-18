import styles from './awards.module.css';

export interface AwardEntry {
  /** 个人奖 / 机构奖 */
  category: string;
  recipient: string;
  /** 授奖词 */
  citation: string;
  /** 机构奖代领人等补充说明 */
  note?: string | null;
  photoUrl?: string | null;
}

interface Props {
  entries: AwardEntry[];
  locale: 'zh' | 'en';
}

/**
 * 奖项版式。
 *
 * 这一页和会务须知不一样:它记录的是一次授奖,读者(以及获奖者本人)
 * 会把它当作一份荣誉记录来看。所以不走通用的 Markdown 正文,
 * 而是把「谁、因何获奖」立成版面的主体 —— 姓名大字、授奖词以引文的
 * 体例排在下面、肖像并列在侧。
 *
 * 刻意不加边框与色块:荣誉感来自留白、字号层级与那张脸,
 * 而不是给每个人套一个奖状样式的框。
 */
export function Awards({ entries, locale }: Props) {
  const groups = entries.reduce<Record<string, AwardEntry[]>>((acc, e) => {
    (acc[e.category] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div className={styles.wrap}>
      {Object.entries(groups).map(([category, list]) => (
        <section key={category} className={styles.group}>
          <h2 className={styles.category}>{category}</h2>
          <ol className={styles.list}>
            {list.map((e) => (
              <li key={e.recipient} className={styles.entry}>
                {e.photoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={styles.portrait} src={e.photoUrl} alt="" loading="lazy" />
                )}
                <div className={styles.body}>
                  <p className={styles.recipient}>{e.recipient}</p>
                  {e.note && <p className={styles.note}>{e.note}</p>}
                  <blockquote className={styles.citation}>{e.citation}</blockquote>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className={styles.footnote}>
        {locale === 'zh'
          ? '每位获奖者获颁艺术家 A. Pierelli 的 TEST 雕塑银铸件。首届 Marcel Grossmann 奖的原件曾赠予教宗若望·保禄二世。'
          : 'Each recipient is presented with a silver casting of the TEST sculpture by the artist A. Pierelli. The original casting was presented to His Holiness Pope John Paul II on the first occasion of the Marcel Grossmann Awards.'}
      </p>
    </div>
  );
}
