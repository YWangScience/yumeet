import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getEventBySlug, getEventForms, listNavPages, speakerHighlights } from '@yumeet/core';
import { SiteNav, type NavEntry } from '@/components/site-nav';
import { ThemeStyle } from '@/components/theme-style';
import { resolveLocale } from '@/lib/locale-server';
import { eventBase } from '@/lib/event-base';
import { translator, eventContent } from '@/lib/i18n';

interface Props {
  children: ReactNode;
  params: Promise<{ org: string; event: string }>;
}

export default async function EventLayout({ children, params }: Props) {
  const { org, event } = await params;
  const found = await getEventBySlug(org, event);
  if (!found) notFound();

  const base = await eventBase(org, event);

  const locale = await resolveLocale();
  const tt = translator(locale);

  const [forms, navPages, people] = await Promise.all([
    getEventForms(found.event.id),
    listNavPages(found.event.id),
    speakerHighlights(found.event.id, 1),
  ]);
  const modules = found.event.modules ?? {};

  /*
   * 导航按会议本身的结构分板块,而不是按「系统内建页 / 用户自建页」这条
   * 实现上的界线 —— 后者是我们的分法,读者不关心某一页是哪来的。
   *
   *   Program           日程与会议安排
   *   Talks             全部报告与摘要检索
   *   Invited speakers  特邀讲者(单独成项:它是注册转化的关键)
   *   Committee         各级委员会
   *   Award             MG 奖项
   *   Events            公众讲座、社交活动、合影等
   *   About             会议介绍、会务、场地、交通、住宿等
   *
   * 自定义页面按 slug 归到这七类;没列进来的落到 About,
   * 不会因为漏配一个 slug 就在导航上消失。
   */
  type NavSection =
    | 'schedule' | 'program' | 'talks' | 'speakers' | 'committee' | 'award' | 'events' | 'about'
    /** 内容已被别处完整覆盖的页面:保留可访问,但不占导航位 */
    | 'hidden';

  const SECTION_OF_SLUG: Record<string, NavSection> = {
    'important-dates': 'program',
    // 分会主席须知是给少数人看的操作说明,不是会议安排,归到「关于会议」
    'chairperson-instructions': 'about',
    'plenary-speakers': 'speakers',
    'mg-awards': 'award',
    'public-lectures': 'events',
    'social-events': 'events',
    'group-photo': 'events',
    'exhibitions': 'events',
    // 这四页是 Indico 上按委员会拆开的名单;/committees 一页已经把
    // 三级委员会连同人数完整列出,再在菜单里重复四条只是让人多挑一次。
    // 从导航移除(页面本身仍在,旧链接不断)。
    'organizing-committees': 'hidden',
    'ioc': 'hidden',
    'icc': 'hidden',
    'loc': 'hidden',
    'scientific-objectives': 'about',
    'general-information': 'about',
    'location': 'about',
    'accommodation': 'about',
    'transportation': 'about',
    'wireless': 'about',
    'sponsors': 'about',
    'proceedings': 'about',
  };

  const SECTION_LABEL: Record<NavSection, string> = {
    hidden: '',
    schedule: tt('schedule'),
    program: tt('navDates'),
    talks: tt('navTalks'),
    speakers: tt('speakers'),
    committee: tt('committees'),
    award: tt('navAward'),
    events: tt('navEvents'),
    about: tt('navAbout'),
  };

  const sections: Record<NavSection, { href: string; label: string }[]> = {
    schedule: [], program: [], talks: [], speakers: [], committee: [], award: [],
    events: [], about: [], hidden: [],
  };

  // 内建页面先落位,它们是每个板块里最主要的那一项
  // 日程单独占一个顶级位:它是全站被点得最多的一页,
  // 藏进下拉等于给最高频的去处多加一次点击。
  if (modules.schedule) sections.schedule.push({ href: `${base}/schedule`, label: tt('schedule') });
  if (modules.archive) sections.talks.push({ href: `${base}/abstracts`, label: tt('abstracts') });
  if (modules.cfp) sections.talks.push({ href: `${base}/cfp`, label: tt('cfp') });
  if (people.total > 0) sections.speakers.push({ href: `${base}/speakers`, label: tt('speakers') });
  if (people.committee > 0) {
    sections.committee.push({ href: `${base}/committees`, label: tt('committees') });
  }
  // 参会者名单与委员会同属「谁来了」,放在同一板块
  if (people.participants > 0) {
    sections.committee.push({ href: `${base}/participants`, label: tt('participants') });
  }

  for (const p of navPages) {
    const label = p.contentI18n?.[locale]?.title ?? p.title;
    const sec = SECTION_OF_SLUG[p.slug] ?? 'about';
    sections[sec].push({ href: `${base}/p/${p.slug}`, label });
  }

  /*
   * 只有一项的板块直接平铺成顶级链接,不做只含一条的下拉 ——
   * 让人点开一个菜单只为看到里面孤零零一项,是纯粹的浪费。
   */
  const ORDER: NavSection[] = [
    'program', 'schedule', 'talks', 'speakers', 'committee', 'award', 'events', 'about',
  ];
  const navEntries: NavEntry[] = [];

  for (const key of ORDER) {
    const list = sections[key];
    if (list.length === 0) continue;
    navEntries.push(list.length === 1
      ? { kind: 'link', href: list[0]!.href, label: SECTION_LABEL[key] }
      : { kind: 'menu', label: SECTION_LABEL[key], links: list });
  }

  /*
   * 顶栏的会议简称。
   *
   * 全名两种语言都太长(「第十七届 Marcel Grossmann 会议」/「The Seventeenth
   * Marcel Grossmann Meeting」),挤在品牌位上会把导航推到换行。
   * 缩成学界惯用的写法:序数 + 人名,如 17ᵗʰ Marcel Grossmann。
   * 人名不译、不缩写 —— 它就是这个会议的身份。
   */
  const ORDINAL_WORDS: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
    eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
    fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17, eighteenth: 18,
    nineteenth: 19, twentieth: 20,
  };

  function shortEventName(fullEn: string): string | null {
    const m = /^(?:The\s+)?([A-Za-z]+)\s+(.+?)\s+Meeting$/i.exec(fullEn.trim());
    if (!m) return null;
    const words = m[1]!.toLowerCase();
    // 「Twenty-first」这类连字符序数按前后两段查表
    const n = ORDINAL_WORDS[words]
      ?? words.split('-').reduce((acc, w) => acc + (ORDINAL_WORDS[w] ?? 0), 0);
    if (!n) return null;
    const suffix = n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
    return `${n}${suffix} ${m[2]}`;
  }

  const short = shortEventName(found.event.title)
    ?? eventContent(found.event, locale).title.replace(/^The\s+/i, '');

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
        entries={navEntries}
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
