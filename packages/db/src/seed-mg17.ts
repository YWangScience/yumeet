/**
 * 第 17 届 Marcel Grossmann 会议(MG17)—— 已结束会议的归档复现
 * 2024 年 7 月 7–12 日 · Aurum,佩斯卡拉「Gabriele d'Annunzio」大学与 ICRANet
 *
 * 数据来源(均为公开资料):
 *   - https://indico.icranet.org/event/8/ 的 20 个自定义页面(抓取为 Markdown)
 *   - Book of Abstracts PDF:601 篇摘要、标题、作者与单位
 *   - mg17-sessions-rev01.xlsx:65 个平行分会及其代码
 *
 * 隐私说明:xlsx 中的 1136 位参会者与 116 位主席均含真实邮箱。
 * 这些邮箱从未出现在 MG17 的公开网站上,因此本 seed **不导入任何邮箱**,
 * 只导入公开程序册中的姓名与单位(ch12 §12.3 数据最小化)。
 *
 * 运行:pnpm --filter @yumeet/db seed:mg17
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { db } from './client';
import {
  organizations, users, organizationMembers, eventMembers,
  events, eventPages, registrationForms, tickets,
  rooms, sessions, submissions, eventPeople,
} from './schema/index';

const DATA = process.env.MG17_DATA ?? '/home/yumeet.ywang.science/mg17';
const TZ = 'Europe/Rome';

/** 罗马时间 → UTC(2024 年 7 月为 CEST = UTC+2) */
const rome = (day: number, hour: number, minute = 0): Date =>
  new Date(Date.UTC(2024, 6, day, hour - 2, minute));

interface RawPage {
  slug: string; title: string; source: string; body: string;
  images: string[]; localImages?: string[];
}
interface RawAuthor { name: string; affiliation: string | null }
interface RawAbstract {
  contributionId: number; sessionHint: string; title: string;
  authors: RawAuthor[]; abstract: string;
  sessionCode: string | null; sessionTitle: string; kind: string;
}
interface RawSession { title: string; code: string | null; indicoId: number | null }
interface RawPerson { name: string; affiliation: string | null; roles: string | null }
interface StructuredPerson {
  kind: string; groupKey?: string; name: string;
  affiliation?: string | null; country?: string | null;
  talkTitle?: string | null; bio?: string | null;
  photoUrl?: string | null; role?: string | null; position: number;
}

/** 抓取下来的图片在站点里的落地目录 */
const PUBLIC_ASSETS = join(import.meta.dirname, '../../../apps/web/public/mg17');

/**
 * 姓名归一。
 *
 * Indico 的名单里少数人写成「姓, 名」(如 Damour, Thibault),其余是「姓 名」。
 * 同一份名单两种写法,按姓氏排序时会乱,读起来也扎眼 —— 统一去掉逗号。
 * 只处理「一个逗号 + 两段」的情形,不去猜复杂的复姓与后缀。
 */
const tidyName = (n: string): string =>
  n.replace(/^([^,]+),\s*([^,]+)$/, '$1 $2').replace(/\s+/g, ' ').trim();

/** 校验不通过的图片,汇总后在末尾提示 */
const brokenImages: string[] = [];

const read = <T>(f: string): T =>
  JSON.parse(readFileSync(join(DATA, f), 'utf8')) as T;

/**
 * 判断一张图是「照片」还是「标志」。
 *
 * 两者要的排版正好相反:照片该填满格子(cover),圆角才裁得到照片本身,
 * 否则 contain 之下四角留白、圆角只裁到透明区域,看起来还是方角;
 * 标志则绝不能裁(contain),裁掉一角的 logo 是事故。
 *
 * 判据用文件本身而不是猜:JPEG 一定是照片(格式不支持透明);
 * PNG 带 alpha 通道的基本都是去背的标志。判不出来时按标志处理 ——
 * 宁可四角留白,也不能把 logo 裁了。
 */
function isPhoto(buf: Buffer): boolean {
  const hex = buf.subarray(0, 4).toString('hex');
  // JPEG 没有透明通道,几乎总是照片
  if (hex.startsWith('ffd8ff')) return true;
  /*
   * PNG 一律按标志处理。
   *
   * 先前的判据是「不含 alpha 通道的 PNG 视为照片」,结果 ICRANet 与
   * 市政府的徽标(白底、无透明通道的 PNG)被当成照片,塞进 200px 的
   * 照片格子里,一排 logo 高矮不齐。
   *
   * 现实里的分布很清楚:照片来自相机,存成 JPEG;徽标来自矢量导出,
   * 存成 PNG —— 有没有 alpha 只取决于导出时是否勾了透明背景,
   * 与它是不是照片无关。误判的代价也不对称:照片当 logo 只是小一点,
   * logo 当照片会被 cover 裁掉边角。
   */
  return false;
}

/** PNG / JPEG / GIF / WebP / SVG 的文件头 */
function sniffImage(buf: Buffer): boolean {
  if (buf.length < 12) return false;
  const hex = buf.subarray(0, 12).toString('hex');
  const ascii = buf.subarray(0, 64).toString('latin1').trimStart().toLowerCase();
  return hex.startsWith('89504e47')                       // PNG
    || hex.startsWith('ffd8ff')                            // JPEG
    || hex.startsWith('47494638')                          // GIF
    || (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP')
    || ascii.startsWith('<svg') || ascii.startsWith('<?xml');
}

/**
 * 页面正文里的 Indico 图片链接改写为本站资源路径。
 *
 * 抓取时如果对方返回的是登录页或错误页,内容会被原样存成 .png ——
 * 站上就出现一张永远加载不出来的图,而扩展名看着完全正常。
 * (MG17 的 wireless 页就中过一次:GARR 把 eduroam 的 logo 挪走后
 * 返回 302 到一张 HTML,于是 104KB 的「PNG」其实是一整页 HTML。)
 * 这里按文件头判断真实类型,不是图的直接把引用去掉 ——
 * 页面少一张装饰图,好过留一个破图标。
 */
function rewriteImages(page: RawPage): string {
  let body = page.body;
  page.images.forEach((url, i) => {
    const local = page.localImages?.[i];
    if (!local) return;
    const file = join(PUBLIC_ASSETS, local);
    let ok = false;
    try {
      ok = sniffImage(readFileSync(file));
    } catch {
      ok = false;   // 文件根本不存在
    }
    if (ok) {
      // 在 Markdown 的 title 位上标出类型,渲染层据此选 cover / contain
      const kind = isPhoto(readFileSync(file)) ? 'photo' : 'logo';
      body = body
        .split(`](${url})`).join(`](/mg17/${local} "${kind}")`)
        .split(url).join(`/mg17/${local}`);
    } else {
      brokenImages.push(`${page.slug}: ${local} ← ${url}`);
      // 连同它所在的 Markdown 图片语法一起删掉,不留空的 ![]()
      body = body
        .split(new RegExp(`!\\[[^\\]]*\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`))
        .join('')
        .split(url).join('');
    }
  });
  return body;
}

const NAV_GROUP: Record<string, { group: string; pos: number }> = {
  'scientific-objectives': { group: 'programme', pos: 1 },
  'important-dates': { group: 'programme', pos: 2 },
  'plenary-speakers': { group: 'programme', pos: 3 },
  'public-lectures': { group: 'programme', pos: 4 },
  'mg-awards': { group: 'programme', pos: 5 },
  'chairperson-instructions': { group: 'programme', pos: 6 },
  'general-information': { group: 'practical', pos: 10 },
  'location': { group: 'practical', pos: 11 },
  'accommodation': { group: 'practical', pos: 12 },
  'transportation': { group: 'practical', pos: 13 },
  'wireless': { group: 'practical', pos: 14 },
  'social-events': { group: 'practical', pos: 15 },
  'group-photo': { group: 'practical', pos: 16 },
  'organizing-committees': { group: 'about', pos: 20 },
  'ioc': { group: 'about', pos: 21 },
  'icc': { group: 'about', pos: 22 },
  'loc': { group: 'about', pos: 23 },
  'sponsors': { group: 'about', pos: 24 },
  'exhibitions': { group: 'about', pos: 25 },
  'proceedings': { group: 'about', pos: 26 },
};

/**
 * 页面标题的中文名。
 *
 * 页面正文是 Indico 上的英文原文,属于会议的历史记录,不做机器翻译 ——
 * 但导航与页首标题是界面的一部分,中文版里挂着一排英文条目,
 * 语言开关就只切了一半。专有名词照旧保留:MG awards 里的 MG、
 * ICRANet、Marcel Grossmann 都是名字,不译。
 */
const PAGE_TITLE_ZH: Record<string, string> = {
  'scientific-objectives': '科学目标',
  'important-dates': '重要日期',
  'mg-awards': 'MG 奖项',
  'plenary-speakers': '特邀报告人',
  'public-lectures': '公众讲座',
  'chairperson-instructions': '分会主席须知',
  'general-information': '会务须知',
  'location': '会场位置',
  'accommodation': '住宿',
  'transportation': '交通',
  'wireless': '无线网络',
  'organizing-committees': '组织委员会',
  'ioc': '国际组织委员会',
  'icc': '国际协调委员会',
  'loc': '本地组织委员会',
  'exhibitions': '展览',
  'sponsors': '赞助',
  'social-events': '社交活动',
  'group-photo': '合影',
  'proceedings': '会议论文集',
};

/** 「关于会议」各页的中文正文(见 mg17/page_zh.py) */
const PAGE_BODY_ZH: Record<string, string> = read<Record<string, string>>('mg17-pages-zh.json');

const DESCRIPTION_EN = `The Seventeenth Marcel Grossmann Meeting (MG17) was held at **Aurum**, the 'Gabriele d'Annunzio' University and ICRANet, in **Pescara, Italy**, from 7 to 12 July 2024.

Since 1975, the Marcel Grossmann Meetings on Recent Developments in Theoretical and Experimental General Relativity, Gravitation, and Relativistic Field Theories have been organized in order to provide opportunities for discussing recent advances in gravitation, general relativity and relativistic field theories, emphasizing mathematical foundations, physical predictions and experimental tests. The objective of these meetings is to elicit exchange among scientists that may deepen our understanding of spacetime structures as well as to review the status of ongoing experiments aimed at testing Einstein's theory of gravitation either from the ground or from space.

MG17 gathered **601 contributions** across **65 parallel sessions** and daily plenary sessions, with participants from more than 60 countries.

## Previous meetings

Trieste (MG1: 1975, MG2: 1979), Shanghai (MG3: 1982), Rome (MG4: 1985, MG9: 2000, MG14: 2015, MG15: 2018), Perth (MG5: 1988), Kyoto (MG6: 1991), Stanford (MG7: 1994), Jerusalem (MG8: 1997), Rio de Janeiro (MG10: 2003), Berlin (MG11: 2006), Paris (MG12: 2009), Stockholm (MG13: 2012), and online (MG16: 2021).

## Organisers

Organised by **ICRANet** together with the 'Gabriele d'Annunzio' University. Contact: mg17@icranet.org`;

const DESCRIPTION_ZH = `第 17 届 Marcel Grossmann 会议(MG17)于 2024 年 7 月 7 日至 12 日在**意大利佩斯卡拉**举行,会场为「Gabriele d'Annunzio」大学的 Aurum 中心与 ICRANet。

自 1975 年起,Marcel Grossmann 系列会议持续为广义相对论、引力理论与相对论场论的最新进展提供交流平台,议题涵盖数学基础、物理预言与实验检验。会议的宗旨是促进不同背景科学家之间的交流,加深对时空结构的理解,并回顾从地面与空间检验爱因斯坦引力理论的各项实验进展。

MG17 共收录 **601 篇报告**,分布于 **65 个平行分会**与每日的全体大会,参会者来自 60 多个国家与地区。

## 历届会议

的里雅斯特(MG1:1975、MG2:1979)、上海(MG3:1982)、罗马(MG4:1985、MG9:2000、MG14:2015、MG15:2018)、珀斯(MG5:1988)、京都(MG6:1991)、斯坦福(MG7:1994)、耶路撒冷(MG8:1997)、里约热内卢(MG10:2003)、柏林(MG11:2006)、巴黎(MG12:2009)、斯德哥尔摩(MG13:2012),以及线上举办的 MG16(2021)。

## 主办

由 **ICRANet** 与「Gabriele d'Annunzio」大学共同主办。联系邮箱:mg17@icranet.org`;

async function main() {
  const pages = read<RawPage[]>('mg17-pages.json');
  const abstracts = read<RawAbstract[]>('mg17-abstracts.json');
  const people = read<{ sessions: RawSession[]; chairs: RawPerson[]; participants: RawPerson[] }>(
    'mg17-people.json');

  console.log(`读入:${pages.length} 页 / ${abstracts.length} 摘要 / `
    + `${people.sessions.length} 分会 / ${people.chairs.length} 主席`);

  // 只清 MG17 自身的数据,不动 MG18
  const [existing] = await db.select({ id: events.id }).from(events)
    .where(sql`${events.slug} = 'mg17'`).limit(1);
  if (existing) {
    console.log('清除既有 MG17 数据…');
    // postgres.js 的预处理语句不支持一次执行多条,逐条执行(顺序即依赖顺序)
    const id = existing.id;
    // sessions 现在外键引用 submissions(日程 → 摘要详情),必须先删 sessions
    await db.execute(sql`DELETE FROM sessions WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM submissions WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM rooms WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM event_pages WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM event_people WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM registrations WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM registration_form_revisions WHERE form_id IN
      (SELECT id FROM registration_forms WHERE event_id = ${id})`);
    await db.execute(sql`DELETE FROM registration_forms WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM tickets WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM event_members WHERE event_id = ${id}`);
    await db.execute(sql`DELETE FROM events WHERE id = ${id}`);
  }

  /* ---------- 组织(复用 ICRANet) ---------- */
  let [org] = await db.select().from(organizations)
    .where(sql`${organizations.slug} = 'icranet'`).limit(1);
  if (!org) {
    [org] = await db.insert(organizations).values({
      slug: 'icranet',
      name: 'ICRANet — International Center for Relativistic Astrophysics Network',
      settings: { contactEmail: 'mg17@icranet.org', locale: 'en' },
    }).returning();
  }

  let [chair] = await db.select().from(users)
    .where(sql`${users.email} = 'chair@icranet.org'`).limit(1);
  if (!chair) {
    [chair] = await db.insert(users).values({
      email: 'chair@icranet.org', name: 'MG Organizing Committee',
      isGuest: false, locale: 'en', timezone: TZ,
    }).returning();
    await db.insert(organizationMembers).values({
      organizationId: org!.id, userId: chair!.id, role: 'owner',
    });
  }

  /* ---------- 活动 ---------- */
  console.log('创建活动 MG17…');
  const [event] = await db.insert(events).values({
    organizationId: org!.id,
    slug: 'mg17',
    title: 'The Seventeenth Marcel Grossmann Meeting',
    subtitle: 'On Recent Developments in Theoretical and Experimental General Relativity, '
      + 'Astrophysics and Relativistic Field Theories',
    description: DESCRIPTION_EN,
    contentI18n: {
      en: {
        title: 'The Seventeenth Marcel Grossmann Meeting',
        subtitle: 'On Recent Developments in Theoretical and Experimental General Relativity, '
          + 'Astrophysics and Relativistic Field Theories',
        description: DESCRIPTION_EN,
      },
      zh: {
        title: '第十七届 Marcel Grossmann 会议',
        subtitle: '广义相对论、天体物理与相对论场论的最新进展',
        description: DESCRIPTION_ZH,
      },
    },
    startsAt: rome(7, 9, 0),
    endsAt: rome(12, 18, 0),
    timezone: TZ,
    venue: {
      name: "Aurum — the 'Gabriele d'Annunzio' University and ICRANet",
      address: 'Largo Gardone Riviera',
      city: 'Pescara',
      country: 'IT',
      geo: { lat: 42.4584, lng: 14.2245 },
    },
    visibility: 'public',
    status: 'published',
    // 已结束的会议:归档价值最高,报名与征稿关闭
    modules: { registration: false, cfp: false, schedule: true, onsite: false, archive: true },
    themeId: 'cupertino',
    publishedAt: new Date('2024-03-01T00:00:00Z'),
  }).returning();

  await db.insert(eventMembers).values({
    eventId: event!.id, userId: chair!.id, role: 'organizer',
  });

  /* ---------- 自定义页面 ---------- */
  console.log('导入自定义页面…');
  await db.insert(eventPages).values(pages.map((p) => {
    const nav = NAV_GROUP[p.slug] ?? { group: 'about', pos: 90 };
    const zh = PAGE_TITLE_ZH[p.slug];
    /*
     * 中文正文也要过一遍图片改写。
     *
     * 译文里写的是 Indico 的原始地址;不改写就有两处后果:
     * 一是仍然外链到原站,二是拿不到「照片 / 标志」的类型标注 ——
     * 会场照片于是被当成 logo 塞进 96px 的小格子里。
     */
    const zhBody = PAGE_BODY_ZH[p.slug]
      ? rewriteImages({ ...p, body: PAGE_BODY_ZH[p.slug]! })
      : undefined;
    // 「Confirmed plenary speakers」与 /speakers 是同一批人,
    // 但这份是 Indico 的原始导出:姓名、报告题目、摘要连成一段斜体,
    // 一万六千像素长。结构化的那份已经在讲者页,这份不进导航(仍可直达,
    // 因为旧链接可能还在流传)。
    const hideFromNav = p.slug === 'plenary-speakers';
    return {
      eventId: event!.id,
      slug: p.slug,
      title: p.title,
      body: rewriteImages(p),
      /*
       * 中文版覆盖标题与正文。
       *
       * 「关于会议」下的各页是给参会者读的实用信息(怎么去、住哪儿、怎么连网),
       * 中文版挂着英文原文等于没翻译。人名、地名、机构名与专业术语保持原文 ——
       * 把 Pescara、Aurum、eduroam 译出来,读者反而对不上门牌和网络名。
       * 没有中文正文的页面继续沿用英文原文,不做机器翻译。
       */
      contentI18n: (zh || zhBody)
        ? { zh: { ...(zh ? { title: zh } : {}), ...(zhBody ? { body: zhBody } : {}) } }
        : null,
      position: nav.pos,
      group: nav.group,
      showInNav: !hideFromNav,
      sourceUrl: p.source,
    };
  }));

  /* ---------- 人物:特邀讲者与各级委员会 ---------- */
  console.log('导入讲者与委员会…');
  const structured = read<StructuredPerson[]>('mg17-people-structured.json');
  // 讲者照片沿用页面里已下载的本地副本
  const photoMap = new Map<string, string>();
  for (const pg of pages) {
    pg.images.forEach((url, i) => {
      const local = pg.localImages?.[i];
      if (local) photoMap.set(url, `/mg17/${local}`);
    });
  }

  /**
   * 姓名的合理性校验。
   *
   * 解析程序册与网页时,姓名字段最容易被相邻的标题或摘要污染 ——
   * 曾经就有一条变成「Abhay Ashtekar *On the Quantum Nature…*** *The interface…」。
   * 这类值一旦进库,会同时出现在日程、讲者页和首页速览上。
   * 所以在写库前拦一道:带 Markdown 星号、或长得根本不像人名的,一律丢弃。
   * 宁可某场报告缺讲者,也不能挂一段糊掉的文字冒充人名。
   */
  const looksLikeName = (n: string): boolean =>
    n.length > 1 && n.length <= 45 && !/[*_#|]/.test(n) && n.split(/\s+/).length <= 6;

  /*
   * 主席的姓名顺序与名单主体统一。
   *
   * 名单主体一律写「姓 名」(Hafizi Mimoza),而各委员会主席抓自另一处,
   * 写成了「名 姓」(Gregory Vereshchagin)—— 同一个人在同一页出现两种写法,
   * 读者会以为是两个人。
   *
   * 匹配用「与词序无关的键」(把字母排序后比较),两种写法因此落到同一个键;
   * 写法取名单主体的那一种。主体里没有的取其他条目里已有的写法;
   * 两处都没有的保持原样 —— 不去猜哪个词是姓。
   */
  const orderless = (n: string): string =>
    [...tidyName(n).toLowerCase().replace(/[^a-z]/g, '')].sort().join('');

  const canonicalName = new Map<string, string>();
  for (const p of structured) {
    if (p.kind === 'committee' && !p.role) {
      const k = orderless(p.name);
      if (!canonicalName.has(k)) canonicalName.set(k, tidyName(p.name));
    }
  }
  for (const p of structured) {
    if (p.kind === 'committee' && p.role) {
      const k = orderless(p.name);
      if (!canonicalName.has(k)) canonicalName.set(k, tidyName(p.name));
    }
  }

  await db.insert(eventPeople).values(structured.map((p) => ({
    eventId: event!.id,
    kind: p.kind,
    groupKey: p.groupKey ?? null,
    name: p.kind === 'committee'
      ? (canonicalName.get(orderless(p.name)) ?? tidyName(p.name))
      : tidyName(p.name),
    affiliation: p.affiliation ?? null,
    country: p.country ?? null,
    talkTitle: p.talkTitle ?? null,
    bio: p.bio ?? null,
    photoUrl: p.photoUrl ? (photoMap.get(p.photoUrl) ?? p.photoUrl) : null,
    role: p.role ?? null,
    position: p.position,
  })));

  /* ---------- 会场(MG17 的平行分会分布在 Aurum 各厅) ---------- */
  const roomRows = await db.insert(rooms).values([
    { eventId: event!.id, name: 'Sala Auditorium (Plenary)', capacity: 500, location: 'Aurum, Pescara', position: 0 },
    /*
     * 会场数按报告量倒推。
     *
     * 539 篇平行报告,只能排在下午(上午是全体大会)。
     * 下午 14:30–19:00 约四个半小时,24 分钟一场,每厅每天约 11 场;
     * 六天合计每厅约 66 场 —— 539 ÷ 66 ≈ 8,再留出分会之间的换场余量,
     * 取 10 个平行会场。这也接近真实 MG17 的规模(同时开十来个分会厅)。
     */
    { eventId: event!.id, name: 'Sala 1', capacity: 120, location: 'Aurum, Pescara', position: 1 },
    { eventId: event!.id, name: 'Sala 2', capacity: 120, location: 'Aurum, Pescara', position: 2 },
    { eventId: event!.id, name: 'Sala 3', capacity: 100, location: 'Aurum, Pescara', position: 3 },
    { eventId: event!.id, name: 'Sala 4', capacity: 100, location: 'Aurum, Pescara', position: 4 },
    { eventId: event!.id, name: 'Sala 5', capacity: 100, location: 'Aurum, Pescara', position: 5 },
    { eventId: event!.id, name: 'Sala 6', capacity: 100, location: 'Aurum, Pescara', position: 6 },
    { eventId: event!.id, name: 'Sala 7', capacity: 80, location: 'Aurum, Pescara', position: 7 },
    { eventId: event!.id, name: 'Sala 8', capacity: 80, location: 'Aurum, Pescara', position: 8 },
    { eventId: event!.id, name: 'Sala 9', capacity: 80, location: 'Aurum, Pescara', position: 9 },
    { eventId: event!.id, name: 'ICRANet Seminar Room', capacity: 80, location: 'ICRANet, Pescara', position: 10 },
  ]).returning();
  const [hall, ...parallelRooms] = roomRows;

  /* ---------- 参会者名单 ---------- */
  /*
   * MG17 的参会者名单在原站是公开页面(registrations/participants),
   * 所以照原样收录。只取姓名、单位、国家三列 —— 邮箱等联系方式原站
   * 从未公开,不导入(与本文件其余部分同一条准则)。
   */
  const participants = read<{ name: string; affiliation: string | null; country: string | null }[]>(
    'mg17-participants.json',
  );
  await db.insert(eventPeople).values(participants.map((p, i) => ({
    eventId: event!.id,
    kind: 'participant',
    groupKey: null,
    name: tidyName(p.name),
    affiliation: p.affiliation,
    country: p.country,
    position: i,
  })));

  /* ---------- 摘要 → submissions(已排期的历史投稿) ---------- */
  console.log('导入摘要…');
  const CHUNK = 200;
  // contributionId → submissionId:日程上的每一场报告都要能点进它的摘要页,
  // 这个映射就是把日程与摘要连起来的那根线。
  const submissionByContribution = new Map<number, string>();
  for (let i = 0; i < abstracts.length; i += CHUNK) {
    const slice = abstracts.slice(i, i + CHUNK);
    const inserted = await db.insert(submissions).values(slice.map((a) => ({
      eventId: event!.id,
      track: a.sessionCode,
      type: a.kind === 'keynote' ? 'plenary' : 'talk',
      title: a.title,
      abstract: a.abstract || '(摘要正文未收录于程序册)',
      authors: a.authors.map((au, idx) => ({
        name: au.name,
        affiliation: au.affiliation ?? undefined,
        isPresenter: idx === 0,
      })),
      answers: { contributionId: a.contributionId, sessionTitle: a.sessionTitle },
      status: 'scheduled' as const,
      submittedAt: new Date('2024-04-01T00:00:00Z'),
      decidedAt: new Date('2024-05-15T00:00:00Z'),
    }))).returning({ id: submissions.id });
    inserted.forEach((row, k) => {
      submissionByContribution.set(slice[k]!.contributionId, row.id);
    });
  }

  /* ---------- 日程:6 天,全体大会 + 平行分会 ---------- */
  console.log('生成日程…');
  const byCode = new Map<string, RawAbstract[]>();
  for (const a of abstracts) {
    const key = a.sessionCode ?? '_none';
    (byCode.get(key) ?? byCode.set(key, []).get(key)!).push(a);
  }

  const rows: (typeof sessions.$inferInsert)[] = [];
  const days = [7, 8, 9, 10, 11, 12];

  // 每日全体大会
  const plenary = byCode.get('PLENARY') ?? [];
  let pi = 0;
  for (const d of days) {
    rows.push({
      eventId: event!.id, roomId: hall!.id, kind: 'break',
      title: 'Registration & Coffee',
      startsAt: rome(d, 8, 0), endsAt: rome(d, 9, 0), speakers: [],
    });
    /*
     * 每天的全体报告数按总数均摊,而不是写死 4 场。
     *
     * 写死 4 场时,41 篇全体报告只排得下 24 篇 —— 剩下 17 篇在日程上
     * 查不到,摘要列表里也就显示不出时间与会场。
     * 上午的窗口是 09:00–13:00 共四小时。41 篇均摊到六天是每天七场,
     * 四小时装七场,每场只能给 34 分钟(30 分钟报告 + 4 分钟换场)——
     * 这也符合实际:全体大会日程紧,报告本就短。
     */
    const perDay = Math.ceil(plenary.length / days.length);
    for (let k = 0; k < perDay && pi < plenary.length; k++, pi++) {
      const a = plenary[pi]!;
      rows.push({
        eventId: event!.id, roomId: hall!.id, kind: 'keynote',
        submissionId: submissionByContribution.get(a.contributionId) ?? null,
        title: a.title,
        // 09:00 起,每 34 分钟一场;七场排到 12:52,在 13:00 午餐前收尾
        startsAt: rome(d, 9, k * 34), endsAt: rome(d, 9, k * 34 + 30),
        speakers: a.authors
          .filter((au) => looksLikeName(tidyName(au.name)))
          .slice(0, 2)
          .map((au) => ({
            name: tidyName(au.name), affiliation: au.affiliation ?? undefined,
          })),
      });
    }
    rows.push({
      eventId: event!.id, roomId: null, kind: 'break', title: 'Lunch',
      startsAt: rome(d, 13, 0), endsAt: rome(d, 14, 30), speakers: [],
    });
  }

  /*
   * 平行分会排期。
   *
   * 分会规模差得很远:少的两三篇,多的二十几篇。原来按「每天两个固定时段」
   * 平均分,再把每个分会截到六篇 —— 于是既丢了两百多篇报告,
   * 留下的也全挤在 14:30 前后。
   *
   * 改成按篇数占用时长:一个分会从它的起始时刻开始,每 24 分钟一场往后排,
   * 排到几点就是几点。分会之间在同一会场内首尾相接,不重叠。
   */
  const codes = [...byCode.keys()].filter((c) => c !== 'PLENARY' && c !== '_none').sort();

  /*
   * 分会按「哪个坑最早空出来」来放,而不是按下标平均分。
   *
   * 六天 × 五个平行会场共三十个坑,而分会规模从两三篇到二十几篇不等。
   * 平均分的结果是有的坑三点就结束、有的排到后半夜。
   * 每次挑当前结束最早的那个坑,长短分会自然错开,整体收在下午到傍晚。
   */
  /*
   * 逐场排期,而不是「一个分会占一个坑连排到底」。
   *
   * 分会规模差得很远:最大的二十几篇,连排下来要十个小时,一个下午装不下,
   * 于是溢到夜里。真实会议的做法是同一个分会跨天续开(BH1 周一下午一节、
   * 周三下午再一节),所以这里也按场次逐个投放:每次挑当前最早空闲的坑,
   * 坑排满当天下午就换下一个坑。同一分会尽量落在同一会场,
   * 但不为此把时间拖到深夜。
   */
  const SLOT_START = 14.5;   // 下午分会自 14:30 起
  const SLOT_END = 19.0;     // 到 19:00 收尾
  const TALK = 0.4;          // 24 分钟一场

  const slots = days.flatMap((day) => parallelRooms.map((room) => (
    { day, room, free: SLOT_START }
  )));

  codes.forEach((code) => {
    const talks = byCode.get(code) ?? [];
    if (talks.length === 0) return;

    /*
     * 一个分会整段放进一个坑,放不下就换下一个坑,而不是拆散逐场投放。
     *
     * 逐场投放会让分会的尾巴散落到各处 —— 某个分会最后一两篇被挤到
     * 当天最末、独自待在一个厅里,读者看到的是「这一场怎么孤零零的」。
     * 分会是学术上的一个整体,应当连着开完。
     *
     * 超过一个下午装不下的大分会(二十几篇)才拆,并且按天拆:
     * 先在当前坑排满当天下午,余下的整段挪到下一个可用的坑,
     * 这与真实会议「BH1 分两个半天开」的做法一致。
     */
    let rest = talks;
    while (rest.length > 0) {
      // 选能装下最多的坑;都装不下就选最空的,先排一部分
      const spot = slots.reduce((best, s) => {
        const capS = Math.floor((SLOT_END - s.free) / TALK);
        const capB = Math.floor((SLOT_END - best.free) / TALK);
        if (capS !== capB) return capS > capB ? s : best;
        return s.free < best.free ? s : best;
      });
      const capacity = Math.max(1, Math.floor((SLOT_END - spot.free) / TALK));
      const chunk = rest.slice(0, capacity);
      rest = rest.slice(capacity);

      chunk.forEach((a, k) => {
        const startH = spot.free + k * TALK;
        const h = Math.floor(startH);
        const m = Math.round((startH - h) * 60);
        rows.push({
          eventId: event!.id, roomId: spot.room.id, kind: 'talk',
          submissionId: submissionByContribution.get(a.contributionId) ?? null,
          title: a.title,
          startsAt: rome(spot.day, h, m), endsAt: rome(spot.day, h, m + 22),
          speakers: a.authors
            .filter((au) => looksLikeName(tidyName(au.name)))
            .slice(0, 2)
            .map((au) => ({
              name: tidyName(au.name), affiliation: au.affiliation ?? undefined,
            })),
        });
      });

      // 分会之间留 15 分钟换场
      spot.free += chunk.length * TALK + 0.25;
    }
  });

  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.insert(sessions).values(rows.slice(i, i + CHUNK));
  }

  console.log('\n✓ MG17 归档站点数据写入完成');
  console.log(`  活动    /${org!.slug}/${event!.slug}`);
  console.log(`  页面    ${pages.length}`);
  console.log(`  摘要    ${abstracts.length}`);
  console.log(`  日程    ${rows.length} 场(6 天 × ${roomRows.length} 会场)`);
  console.log(`  分会    ${codes.length} 个平行分会 + ${plenary.length} 场全体报告`);
  console.log(`  人物    ${structured.filter((p) => p.kind === 'speaker').length} 位特邀讲者 + `
    + `${structured.filter((p) => p.kind === 'committee').length} 位委员`);
  console.log('  注:参会者与主席的邮箱未导入(公开站点从未展示,见文件头说明)');
  if (brokenImages.length) {
    console.log(`\n  ⚠ 跳过 ${brokenImages.length} 张无效图片(抓取到的不是图片文件):`);
    for (const b of brokenImages) console.log(`     ${b}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('seed 失败:', err);
  process.exit(1);
});
