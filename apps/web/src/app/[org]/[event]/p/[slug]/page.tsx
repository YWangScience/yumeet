import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getEventBySlug, getEventPage, listSpeakers, listCommittee } from '@yumeet/core';
import { Markdown } from '@/components/markdown';
import { Awards, type AwardEntry } from '@/components/awards';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { eventContent, pick } from '@/lib/i18n';
import styles from './page-view.module.css';

export const revalidate = 300;

interface Props {
  params: Promise<{ org: string; event: string; slug: string }>;
  searchParams: Promise<{ lang?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { org, event, slug } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) return { title: 'Not found' };
  const page = await getEventPage(found.event.id, slug);
  return { title: page ? `${page.title} · ${found.event.title}` : 'Not found' };
}

/**
 * 从奖项页正文里解析出结构。
 *
 * Indico 上这页是「类别 / Goes to / **姓名** / *授奖词*」的固定写法,
 * 机构奖则把授奖词写在姓名之前。两种顺序都要认,所以按「粗体姓名」定位,
 * 再向两侧就近找那段斜体授奖词。解析不出来就退回普通正文渲染 ——
 * 版式是锦上添花,不能因为格式变了就把内容弄丢。
 */
function parseAwards(
  body: string,
  portraits: Map<string, string>,
): AwardEntry[] | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  const entries: AwardEntry[] = [];
  let category = '';

  const isCategory = (l: string) => /^(Individual|Institutional)\s+Awards?$/i.test(l);
  const bold = (l: string) => /^\*\*(.+?)\*\*$/.exec(l)?.[1]?.trim() ?? null;
  const italic = (l: string) => /^\*(?!\*)(.+?)\*$/.exec(l)?.[1]?.trim() ?? null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (isCategory(line)) { category = line; continue; }
    if (!category) continue;

    const name = bold(line);
    // 全大写或含 Team 的粗体行才是获奖者,避开开头那两行会议名与日期
    if (!name || !/^[A-Z0-9 .\/'-]+$|Team/.test(name)) continue;

    /*
     * 授奖词的位置随奖项类别而变:个人奖写在姓名之后,
     * 机构奖写在姓名之前(中间还隔着一行「Goes to:」)。
     * 所以两个方向都找,并允许跳过一行非斜体的引导语。
     */
    const collect = (dir: 1 | -1): string[] => {
      const out: string[] = [];
      let j = i + dir;
      let skipped = 0;
      while (j >= 0 && j < lines.length && out.length < 5) {
        const it = italic(lines[j]!);
        if (it) {
          if (dir === 1) out.push(it); else out.unshift(it);
        } else if (out.length > 0 || skipped++ >= 1) {
          break;
        }
        j += dir;
      }
      return out;
    };
    const cite = collect(1).length > 0 ? collect(1) : collect(-1);
    if (cite.length === 0) continue;

    // 紧随其后的「- 说明」行(机构奖的代领人)
    const next = lines[i + cite.length + 1];
    const note = next && /^-\s+/.test(next) ? next.replace(/^-\s+/, '') : null;

    entries.push({
      category,
      recipient: name,
      citation: cite.join(' ').replace(/^[“"]|[”".]$/g, '').trim(),
      note,
      photoUrl: portraits.get(name.toLowerCase().replace(/\s+/g, ' ')) ?? null,
    });
  }

  return entries.length > 0 ? entries : null;
}

export default async function EventCustomPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug, slug } = await params;
  const base = await eventBase(orgSlug, eventSlug);
  const locale = await resolveLocale(await searchParams);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found || found.event.status === 'draft') notFound();

  const page = await getEventPage(found.event.id, slug);
  if (!page) notFound();

  const content = eventContent(found.event, locale);
  const i18n = page.contentI18n?.[locale];
  const title = i18n?.title ?? page.title;
  const body = i18n?.body ?? page.body;
  // 获奖者的肖像复用讲者与委员名录里已有的照片,不再单独维护一份
  const portraits = new Map<string, string>();
  if (page.slug === 'mg-awards') {
    for (const p of await listSpeakers(found.event.id)) {
      if (!p.photoUrl) continue;
      const key = p.name.toLowerCase().replace(/\s+/g, ' ');
      portraits.set(key, p.photoUrl);
      // 名单里写的是「Christopher Lee Fryer」,照片记的是「Christopher Fryer」——
      // 补一个「名 + 姓」的键,让中间名不影响匹配
      const parts = key.split(' ');
      if (parts.length >= 2) portraits.set(`${parts[0]} ${parts[parts.length - 1]}`, p.photoUrl);
    }
  }
  const awards = page.slug === 'mg-awards' ? parseAwards(body, portraits) : null;

  return (
    <main className={styles.page}>

      <div className={styles.layout}>
        <article className={styles.article}>
          <h1 className={styles.title}>{title}</h1>
          {/* 奖项页有稳定的结构(类别 → 获奖者 → 授奖词),
              用专门的荣誉版式呈现,而不是当普通正文渲染 */}
          {awards ? <Awards entries={awards} locale={locale} /> : <Markdown source={body} />}
        </article>

      </div>
    </main>
  );
}
