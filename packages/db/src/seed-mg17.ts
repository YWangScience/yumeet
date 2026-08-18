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
  if (hex.startsWith('ffd8ff')) return true;              // JPEG:没有透明通道
  if (hex.startsWith('89504e47')) {
    // PNG 的 IHDR 固定在偏移 25 处放 colour type:4 与 6 含 alpha
    const colourType = buf[25];
    return colourType !== 4 && colourType !== 6;
  }
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
      // 只覆盖标题,正文沿用英文原文(历史记录不改写)
      contentI18n: zh ? { zh: { title: zh } } : null,
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

  await db.insert(eventPeople).values(structured.map((p) => ({
    eventId: event!.id,
    kind: p.kind,
    groupKey: p.groupKey ?? null,
    name: tidyName(p.name),
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
    { eventId: event!.id, name: 'Sala 1', capacity: 120, location: 'Aurum, Pescara', position: 1 },
    { eventId: event!.id, name: 'Sala 2', capacity: 120, location: 'Aurum, Pescara', position: 2 },
    { eventId: event!.id, name: 'Sala 3', capacity: 100, location: 'Aurum, Pescara', position: 3 },
    { eventId: event!.id, name: 'Sala 4', capacity: 100, location: 'Aurum, Pescara', position: 4 },
    { eventId: event!.id, name: 'ICRANet Seminar Room', capacity: 80, location: 'ICRANet, Pescara', position: 5 },
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
    for (let k = 0; k < 4 && pi < plenary.length; k++, pi++) {
      const a = plenary[pi]!;
      rows.push({
        eventId: event!.id, roomId: hall!.id, kind: 'keynote',
        submissionId: submissionByContribution.get(a.contributionId) ?? null,
        title: a.title,
        startsAt: rome(d, 9 + k, 0), endsAt: rome(d, 9 + k, 45),
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

  // 平行分会:按 code 分配到会场与时段
  const codes = [...byCode.keys()].filter((c) => c !== 'PLENARY' && c !== '_none').sort();
  codes.forEach((code, idx) => {
    const day = days[Math.floor(idx / 12) % days.length]!;
    const room = parallelRooms[idx % parallelRooms.length]!;
    const slot = Math.floor((idx % 12) / parallelRooms.length); // 每天两个下午时段
    const talks = (byCode.get(code) ?? []).slice(0, 6);
    talks.forEach((a, k) => {
      const startH = 14.5 + slot * 2.5 + k * 0.4;
      const h = Math.floor(startH);
      const m = Math.round((startH - h) * 60);
      rows.push({
        eventId: event!.id, roomId: room.id, kind: 'talk',
        submissionId: submissionByContribution.get(a.contributionId) ?? null,
        title: a.title,
        startsAt: rome(day, h, m), endsAt: rome(day, h, m + 22),
        speakers: a.authors
          .filter((au) => looksLikeName(tidyName(au.name)))
          .slice(0, 2)
          .map((au) => ({
            name: tidyName(au.name), affiliation: au.affiliation ?? undefined,
          })),
      });
    });
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
