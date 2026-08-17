/**
 * 测试数据:第 18 届 Marcel Grossmann Meeting(MG18)
 * 2027 年 7 月 5–9 日 · 香港大学
 *
 * 按 Marcel Grossmann 系列惯例构造:ICRANet 主办,上午全体大会 + 下午平行分会,
 * 经典议题轨道(黑洞、引力波、宇宙学、中子星、量子引力…)。
 * 运行:pnpm --filter @yumeet/db seed
 */
import { sql } from 'drizzle-orm';
import { db } from './client';
import {
  organizations, users, organizationMembers, eventMembers,
  events, registrationForms, registrationFormRevisions, tickets,
  rooms, sessions, submissions,
} from './schema/index';
import type { FormField } from './schema/types';

const HK = 'Asia/Hong_Kong';

/** 香港时间 → UTC(2027 年 7 月香港为 UTC+8,无夏令时) */
const hk = (day: number, hour: number, minute = 0): Date =>
  new Date(Date.UTC(2027, 6, day, hour - 8, minute));

async function main() {
  console.log('清空旧数据…');
  await db.execute(sql`
    TRUNCATE TABLE
      audit_logs, outbox, email_logs, reviews, submissions, sessions, rooms,
      schedule_snapshots, registrations, orders, registration_form_revisions,
      registration_forms, tickets, event_members, events,
      organization_members, auth_sessions, login_tokens, webhooks, files,
      organizations, users
    RESTART IDENTITY CASCADE
  `);

  /* ---------- 组织与人员 ---------- */
  console.log('创建组织 ICRANet…');
  const [org] = await db.insert(organizations).values({
    slug: 'icranet',
    name: 'ICRANet — International Center for Relativistic Astrophysics Network',
    settings: {
      contactEmail: 'mg18@icranet.org',
      locale: 'en',
      embedAllowlist: ['galileoxu.org', 'www.galileoxu.org'],
    },
  }).returning();

  const [organizer] = await db.insert(users).values({
    email: 'chair@icranet.org',
    name: 'MG18 Local Organizing Committee',
    isGuest: false,
    locale: 'en',
    timezone: HK,
  }).returning();

  const [reviewer] = await db.insert(users).values({
    email: 'reviewer@icranet.org',
    name: 'Scientific Committee Member',
    isGuest: false,
    locale: 'en',
    timezone: HK,
  }).returning();

  await db.insert(organizationMembers).values([
    { organizationId: org!.id, userId: organizer!.id, role: 'owner' },
    { organizationId: org!.id, userId: reviewer!.id, role: 'member' },
  ]);

  /* ---------- 活动 ---------- */
  console.log('创建活动 MG18…');
  const [event] = await db.insert(events).values({
    organizationId: org!.id,
    slug: 'mg18',
    title: 'The Eighteenth Marcel Grossmann Meeting',
    subtitle:
      'On Recent Developments in Theoretical and Experimental General Relativity, ' +
      'Astrophysics and Relativistic Field Theories',
    description: `第 18 届 Marcel Grossmann 会议(MG18)将于 2027 年 7 月 5 日至 9 日在**香港大学**举行。

自 1975 年首届会议以来,Marcel Grossmann 系列会议每三年举办一次,为广义相对论、引力理论、
相对论天体物理与相对论场论的最新进展提供交流平台。MG18 是该系列首次在香港举办。

会议延续传统形式:**上午为全体大会**(Plenary Sessions),邀请领域内的综述报告;
**下午为平行分会**(Parallel Sessions),涵盖从数学相对论到多信使天文学的各个专题。
会议期间将颁发 **Marcel Grossmann 奖**,表彰在相对论天体物理领域作出杰出贡献的个人与机构。

## 重要日期

- 摘要提交截止:2027 年 3 月 15 日
- 录用通知:2027 年 4 月 15 日
- 早鸟注册截止:2027 年 5 月 1 日
- 会议召开:2027 年 7 月 5–9 日

## 主办与承办

由 ICRANet(International Center for Relativistic Astrophysics Network)主办,
香港大学物理系承办。`,
    contentI18n: {
      zh: {
        title: '第十八届 Marcel Grossmann 会议',
        subtitle: '广义相对论、天体物理与相对论场论的最新进展',
      },
      en: {
        title: 'The Eighteenth Marcel Grossmann Meeting',
        subtitle:
          'On Recent Developments in Theoretical and Experimental General Relativity, ' +
          'Astrophysics and Relativistic Field Theories',
        description: `The Eighteenth Marcel Grossmann Meeting (MG18) will be held at **The University of Hong Kong** from 5 to 9 July 2027.

Since the first meeting in 1975, the Marcel Grossmann Meetings have been held every three years to review recent developments in general relativity, gravitation, relativistic astrophysics and relativistic field theories. MG18 is the first in the series to be hosted in Hong Kong.

The meeting follows its traditional format: **plenary sessions in the mornings** with invited review talks, and **parallel sessions in the afternoons** covering topics from mathematical relativity to multi-messenger astronomy. The **Marcel Grossmann Awards** will be presented during the meeting to individuals and institutions for outstanding contributions to relativistic astrophysics.

## Key dates

- Abstract submission deadline: 15 March 2027
- Notification of acceptance: 15 April 2027
- Early bird registration deadline: 1 May 2027
- Meeting: 5–9 July 2027

## Organisers

Organised by ICRANet (International Center for Relativistic Astrophysics Network), hosted by the Department of Physics, The University of Hong Kong.`,
      },
    },
    startsAt: hk(5, 9, 0),
    endsAt: hk(9, 18, 0),
    timezone: HK,
    venue: {
      name: 'The University of Hong Kong',
      address: 'Pokfulam Road',
      city: 'Hong Kong',
      country: 'HK',
      geo: { lat: 22.2830, lng: 114.1371 },
    },
    visibility: 'public',
    status: 'published',
    modules: { registration: true, cfp: true, schedule: true, onsite: true, archive: true },
    themeId: 'cupertino',
    publishedAt: new Date('2026-09-01T00:00:00Z'),
  }).returning();

  await db.insert(eventMembers).values([
    { eventId: event!.id, userId: organizer!.id, role: 'organizer' },
    { eventId: event!.id, userId: reviewer!.id, role: 'reviewer' },
  ]);

  /* ---------- 注册表单(字段引擎:多种 kind) ---------- */
  console.log('创建注册表单…');
  const fields: FormField[] = [
    { kind: 'short_text', key: 'full_name', label: { en: 'Full name', zh: '姓名' }, required: true, pii: true, maxLength: 120 },
    { kind: 'affiliation', key: 'affiliation', label: { en: 'Affiliation', zh: '所属机构' }, required: true, pii: true },
    { kind: 'country', key: 'country', label: { en: 'Country / Region', zh: '国家/地区' }, required: true, pii: true },
    {
      kind: 'select', key: 'career_stage',
      label: { en: 'Career stage', zh: '职业阶段' }, required: true,
      options: [
        { value: 'student', label: { en: 'PhD student', zh: '博士研究生' } },
        { value: 'postdoc', label: { en: 'Postdoc', zh: '博士后' } },
        { value: 'faculty', label: { en: 'Faculty / Senior researcher', zh: '教职/资深研究员' } },
        { value: 'other', label: { en: 'Other', zh: '其他' } },
      ],
    },
    {
      kind: 'checkbox_group', key: 'sessions_interest',
      label: { en: 'Parallel sessions of interest', zh: '感兴趣的平行分会' },
      options: [
        { value: 'bh', label: { en: 'Black holes', zh: '黑洞' } },
        { value: 'gw', label: { en: 'Gravitational waves', zh: '引力波' } },
        { value: 'cosmo', label: { en: 'Cosmology', zh: '宇宙学' } },
        { value: 'ns', label: { en: 'Neutron stars & GRBs', zh: '中子星与伽马暴' } },
        { value: 'qg', label: { en: 'Quantum gravity', zh: '量子引力' } },
        { value: 'math', label: { en: 'Mathematical relativity', zh: '数学相对论' } },
      ],
    },
    {
      kind: 'capacity_option', key: 'banquet',
      label: { en: 'Conference banquet (8 July)', zh: '会议晚宴(7 月 8 日)' },
      help: { en: 'Limited seats — first come, first served', zh: '席位有限,先到先得' },
      options: [
        { value: 'yes', label: { en: 'Yes, I will attend', zh: '参加' }, capacity: 220, waitlist: true },
        { value: 'no', label: { en: 'No, thank you', zh: '不参加' }, capacity: null },
      ],
    },
    {
      kind: 'select', key: 'dietary',
      label: { en: 'Dietary requirements', zh: '饮食要求' },
      visibleWhen: { field: 'banquet', op: 'eq', value: 'yes' },
      options: [
        { value: 'none', label: { en: 'No restrictions', zh: '无特殊要求' } },
        { value: 'vegetarian', label: { en: 'Vegetarian', zh: '素食' } },
        { value: 'halal', label: { en: 'Halal', zh: '清真' } },
        { value: 'gluten_free', label: { en: 'Gluten free', zh: '无麸质' } },
      ],
    },
    {
      kind: 'long_text', key: 'accessibility',
      label: { en: 'Accessibility requirements', zh: '无障碍需求' },
      help: { en: 'Wheelchair access, sign language, etc.', zh: '轮椅通道、手语翻译等' },
      pii: true, maxLength: 500,
    },
    {
      kind: 'boolean', key: 'visa_letter',
      label: { en: 'I need a visa invitation letter', zh: '我需要签证邀请函' },
    },
    {
      kind: 'boolean', key: 'consent_privacy',
      label: {
        en: 'I have read and accept the privacy notice',
        zh: '我已阅读并接受隐私声明',
      },
      required: true,
      consent: { legalTextId: 'privacy-2027', version: 1 },
    },
  ];

  const [form] = await db.insert(registrationForms).values({
    eventId: event!.id,
    name: 'MG18 Registration',
    fields,
    version: 1,
    opensAt: new Date('2026-06-01T00:00:00Z'),
    closesAt: hk(1, 23, 59),
    capacity: 900,
    waitlistEnabled: true,
    approvalRequired: false,
  }).returning();

  await db.insert(registrationFormRevisions).values({
    formId: form!.id, version: 1, fields,
  });

  /* ---------- 票种 ---------- */
  console.log('创建票种…');
  await db.insert(tickets).values([
    {
      eventId: event!.id, name: 'Early Bird — Regular',
      description: 'Full access to plenary and parallel sessions. Until 1 May 2027.',
      priceCents: 45000, currency: 'HKD', quantityTotal: 400, position: 1,
      salesCloseAt: new Date('2027-05-01T15:59:59Z'),
    },
    {
      eventId: event!.id, name: 'Early Bird — Student',
      description: 'Requires proof of student status at check-in.',
      priceCents: 22000, currency: 'HKD', quantityTotal: 250, position: 2,
      salesCloseAt: new Date('2027-05-01T15:59:59Z'),
    },
    {
      eventId: event!.id, name: 'Regular',
      description: 'Standard registration after the early bird deadline.',
      priceCents: 58000, currency: 'HKD', quantityTotal: 300, position: 3,
      salesOpenAt: new Date('2027-05-01T16:00:00Z'),
    },
    {
      eventId: event!.id, name: 'Student',
      description: 'Standard student registration.',
      priceCents: 30000, currency: 'HKD', quantityTotal: 200, position: 4,
      salesOpenAt: new Date('2027-05-01T16:00:00Z'),
    },
    {
      eventId: event!.id, name: 'Accompanying person',
      description: 'Social programme and banquet access only.',
      priceCents: 12000, currency: 'HKD', quantityTotal: 120, position: 5,
    },
    {
      eventId: event!.id, name: 'Invited speaker',
      description: 'Complimentary registration for invited plenary speakers.',
      priceCents: 0, currency: 'HKD', quantityTotal: 60, hidden: true, position: 6,
    },
  ]);

  /* ---------- 会场 ---------- */
  console.log('创建会场…');
  const roomRows = await db.insert(rooms).values([
    { eventId: event!.id, name: 'Grand Hall', capacity: 900, location: 'Loke Yew Hall, Main Building', equipment: ['projector', 'live-stream', 'hearing-loop'], position: 0 },
    { eventId: event!.id, name: 'Room A — Black Holes', capacity: 180, location: 'Chong Yuet Ming Physics Building, 2/F', equipment: ['projector'], position: 1 },
    { eventId: event!.id, name: 'Room B — Gravitational Waves', capacity: 180, location: 'Chong Yuet Ming Physics Building, 3/F', equipment: ['projector'], position: 2 },
    { eventId: event!.id, name: 'Room C — Cosmology', capacity: 150, location: 'Run Run Shaw Building, 4/F', equipment: ['projector'], position: 3 },
    { eventId: event!.id, name: 'Room D — Neutron Stars & GRBs', capacity: 150, location: 'Run Run Shaw Building, 5/F', equipment: ['projector'], position: 4 },
    { eventId: event!.id, name: 'Poster Gallery', capacity: 300, location: 'Main Building Concourse', equipment: [], position: 5 },
  ]).returning();

  const [hall, roomA, roomB, roomC, roomD, poster] = roomRows;

  /* ---------- 日程:5 天 ---------- */
  console.log('创建日程…');
  const plenary = (day: number, h: number, m: number, dur: number, title: string, speaker: string, aff: string) => ({
    eventId: event!.id, roomId: hall!.id, title, kind: 'keynote',
    startsAt: hk(day, h, m), endsAt: hk(day, h, m + dur),
    speakers: [{ name: speaker, affiliation: aff }],
  });
  const parallel = (day: number, h: number, m: number, dur: number, roomId: string, title: string, speaker: string, aff: string) => ({
    eventId: event!.id, roomId, title, kind: 'talk',
    startsAt: hk(day, h, m), endsAt: hk(day, h, m + dur),
    speakers: [{ name: speaker, affiliation: aff }],
  });
  const brk = (day: number, h: number, m: number, dur: number, title: string, roomId?: string) => ({
    eventId: event!.id, roomId: roomId ?? null, title, kind: 'break',
    startsAt: hk(day, h, m), endsAt: hk(day, h, m + dur), speakers: [],
  });

  await db.insert(sessions).values([
    /* ===== Day 1 — 7 月 5 日(周一) ===== */
    { eventId: event!.id, roomId: hall!.id, title: 'Registration & Welcome Coffee', kind: 'break', startsAt: hk(5, 8, 0), endsAt: hk(5, 9, 0), speakers: [] },
    plenary(5, 9, 0, 30, 'Opening Ceremony — Welcome to MG18 Hong Kong', 'Local Organizing Committee', 'The University of Hong Kong'),
    plenary(5, 9, 30, 45, 'Fifty Years of Marcel Grossmann Meetings: A Retrospective', 'R. Ruffini', 'ICRANet'),
    plenary(5, 10, 15, 45, 'Black Hole Imaging: From First Light to Movies', 'EHT Collaboration', 'Event Horizon Telescope'),
    brk(5, 11, 0, 30, 'Coffee Break', hall!.id),
    plenary(5, 11, 30, 45, 'The Gravitational-Wave Sky after Five Observing Runs', 'LVK Collaboration', 'LIGO–Virgo–KAGRA'),
    brk(5, 12, 15, 105, 'Lunch'),
    parallel(5, 14, 0, 30, roomA!.id, 'Kerr Black Hole Perturbations: Recent Analytic Advances', 'A. Chen', 'Chinese University of Hong Kong'),
    parallel(5, 14, 30, 30, roomA!.id, 'Quasinormal Modes and Black Hole Spectroscopy', 'M. Tanaka', 'Kyoto University'),
    parallel(5, 14, 0, 30, roomB!.id, 'Pulsar Timing Arrays: The Nanohertz Background', 'S. Verbiest', 'University of Manchester'),
    parallel(5, 14, 30, 30, roomB!.id, 'Space-Based Detectors: LISA, TianQin and Taiji', 'L. Wang', 'Sun Yat-sen University'),
    parallel(5, 14, 0, 30, roomC!.id, 'The Hubble Tension in 2027: Where Do We Stand?', 'P. Nakamura', 'University of Tokyo'),
    parallel(5, 14, 30, 30, roomC!.id, 'Early Dark Energy and the CMB', 'J. Okafor', 'University of Cape Town'),
    brk(5, 15, 0, 30, 'Coffee Break'),
    parallel(5, 15, 30, 30, roomA!.id, 'Superradiance and Ultralight Boson Clouds', 'F. Rossi', 'Sapienza University of Rome'),
    parallel(5, 15, 30, 30, roomB!.id, 'Numerical Relativity for Extreme Mass-Ratio Inspirals', 'K. Müller', 'Max Planck Institute for Gravitational Physics'),
    parallel(5, 15, 30, 30, roomC!.id, 'Large-Scale Structure as a Cosmological Probe', 'H. Zhang', 'Peking University'),
    { eventId: event!.id, roomId: hall!.id, title: 'Welcome Reception', kind: 'social', startsAt: hk(5, 18, 0), endsAt: hk(5, 20, 0), speakers: [] },

    /* ===== Day 2 — 7 月 6 日(周二) ===== */
    plenary(6, 9, 0, 45, 'Neutron Star Equation of State: Multi-Messenger Constraints', 'A. Watts', 'University of Amsterdam'),
    plenary(6, 9, 45, 45, 'Gamma-Ray Bursts as Cosmological Probes', 'C. L. Bianco', 'ICRANet'),
    brk(6, 10, 30, 30, 'Coffee Break', hall!.id),
    plenary(6, 11, 0, 45, 'Quantum Gravity Phenomenology: Testable Predictions', 'S. Hossenfelder', 'Munich Center for Mathematical Philosophy'),
    brk(6, 11, 45, 135, 'Lunch'),
    parallel(6, 14, 0, 30, roomA!.id, 'Primordial Black Holes as Dark Matter Candidates', 'T. Suyama', 'Tokyo Institute of Technology'),
    parallel(6, 14, 30, 30, roomA!.id, 'Black Hole Thermodynamics and the Information Paradox', 'D. Marolf', 'UC Santa Barbara'),
    parallel(6, 14, 0, 30, roomD!.id, 'Magnetar Giant Flares and Fast Radio Bursts', 'B. Zhang', 'University of Nevada, Las Vegas'),
    parallel(6, 14, 30, 30, roomD!.id, 'Kilonova Observations from GW170817 to the Present', 'E. Pian', 'INAF Bologna'),
    parallel(6, 14, 0, 30, roomC!.id, 'Inflation after Planck and CMB-S4', 'R. Kallosh', 'Stanford University'),
    brk(6, 15, 0, 30, 'Coffee Break'),
    { eventId: event!.id, roomId: poster!.id, title: 'Poster Session I', kind: 'poster', startsAt: hk(6, 15, 30), endsAt: hk(6, 17, 30), speakers: [] },

    /* ===== Day 3 — 7 月 7 日(周三) ===== */
    plenary(7, 9, 0, 45, 'Tests of General Relativity in the Strong-Field Regime', 'C. Will', 'University of Florida'),
    plenary(7, 9, 45, 45, 'Marcel Grossmann Award Ceremony', 'Awards Committee', 'ICRANet'),
    brk(7, 10, 30, 30, 'Coffee Break', hall!.id),
    plenary(7, 11, 0, 45, 'The Sagittarius A* Environment: Stars, Gas and Spacetime', 'R. Genzel', 'Max Planck Institute for Extraterrestrial Physics'),
    brk(7, 11, 45, 135, 'Lunch'),
    { eventId: event!.id, roomId: null, title: 'Excursion — Hong Kong Science Park & Harbour Tour', kind: 'social', startsAt: hk(7, 14, 0), endsAt: hk(7, 19, 0), speakers: [] },

    /* ===== Day 4 — 7 月 8 日(周四) ===== */
    plenary(8, 9, 0, 45, 'Mathematical Relativity: Recent Progress on Cosmic Censorship', 'M. Dafermos', 'Princeton University'),
    plenary(8, 9, 45, 45, 'Dark Matter: Astrophysical and Laboratory Searches', 'K. Freese', 'University of Texas at Austin'),
    brk(8, 10, 30, 30, 'Coffee Break', hall!.id),
    plenary(8, 11, 0, 45, 'Relativistic Jets from Black Holes: Simulations Meet Observations', 'A. Tchekhovskoy', 'Northwestern University'),
    brk(8, 11, 45, 135, 'Lunch'),
    parallel(8, 14, 0, 30, roomA!.id, 'Rotating Black Holes in Modified Gravity', 'Y. Liu', 'Fudan University'),
    parallel(8, 14, 30, 30, roomA!.id, 'Shadow Observables and Parametrized Metrics', 'Z. Stuchlík', 'Silesian University in Opava'),
    parallel(8, 14, 0, 30, roomB!.id, 'Stochastic Gravitational-Wave Backgrounds', 'V. Mandic', 'University of Minnesota'),
    parallel(8, 14, 30, 30, roomB!.id, 'Machine Learning in Gravitational-Wave Data Analysis', 'S. Park', 'Seoul National University'),
    parallel(8, 14, 0, 30, roomD!.id, 'Binary Neutron Star Mergers: Post-Merger Remnants', 'M. Shibata', 'Max Planck Institute for Gravitational Physics'),
    brk(8, 15, 0, 30, 'Coffee Break'),
    { eventId: event!.id, roomId: poster!.id, title: 'Poster Session II', kind: 'poster', startsAt: hk(8, 15, 30), endsAt: hk(8, 17, 30), speakers: [] },
    { eventId: event!.id, roomId: null, title: 'Conference Banquet', kind: 'social', startsAt: hk(8, 19, 0), endsAt: hk(8, 22, 0), speakers: [] },

    /* ===== Day 5 — 7 月 9 日(周五) ===== */
    plenary(9, 9, 0, 45, 'Cosmological Constant and the Nature of Dark Energy', 'E. Linder', 'UC Berkeley'),
    plenary(9, 9, 45, 45, 'Multi-Messenger Astronomy: The Next Decade', 'M. Branchesi', 'Gran Sasso Science Institute'),
    brk(9, 10, 30, 30, 'Coffee Break', hall!.id),
    plenary(9, 11, 0, 45, 'Summary and Outlook: Where Is Relativistic Astrophysics Heading?', 'R. Jantzen', 'Villanova University'),
    plenary(9, 11, 45, 30, 'Closing Ceremony — Announcement of MG19', 'Organizing Committee', 'ICRANet'),
  ]);

  /* ---------- 投稿样例 ---------- */
  console.log('创建投稿样例…');
  await db.insert(submissions).values([
    {
      eventId: event!.id, track: 'bh', type: 'talk',
      title: 'Constraints on Kerr Deviations from EHT Polarimetric Data',
      abstract: 'We derive new constraints on parametrized deviations from the Kerr metric using polarimetric observations of M87* and Sgr A*, showing that the deviation parameter is bounded at the few-percent level.',
      authors: [
        { name: 'Wei Chen', email: 'w.chen@example.edu', affiliation: 'HKU', isPresenter: true },
        { name: 'A. Kumar', affiliation: 'IUCAA' },
      ],
      answers: {}, status: 'accepted', decisionWaitlisted: false,
      submittedAt: new Date('2027-03-10T00:00:00Z'),
      decidedAt: new Date('2027-04-12T00:00:00Z'),
    },
    {
      eventId: event!.id, track: 'gw', type: 'poster',
      title: 'A Bayesian Search for Eccentric Binary Black Hole Mergers in O5 Data',
      abstract: 'We present a Bayesian pipeline targeting eccentric compact binary coalescences and apply it to the fifth observing run, reporting upper limits on the eccentric merger rate.',
      authors: [{ name: 'Maria Rossi', email: 'm.rossi@example.it', affiliation: 'Sapienza', isPresenter: true }],
      answers: {}, status: 'under_review',
      submittedAt: new Date('2027-03-14T00:00:00Z'),
    },
    {
      eventId: event!.id, track: 'cosmo', type: 'talk',
      title: 'Late-Time Dark Energy Transitions and the Hubble Tension',
      abstract: 'We investigate whether a rapid transition in the dark energy equation of state at low redshift can reconcile local and CMB determinations of H0 without spoiling BAO constraints.',
      authors: [{ name: 'Hiroshi Tanaka', email: 'h.tanaka@example.jp', affiliation: 'University of Tokyo', isPresenter: true }],
      answers: {}, status: 'submitted',
      submittedAt: new Date('2027-03-15T00:00:00Z'),
    },
  ]);

  console.log('\n✓ 种子数据写入完成');
  console.log(`  组织  /${org!.slug}`);
  console.log(`  活动  /${org!.slug}/${event!.slug}`);
  console.log(`  日程  5 天,${roomRows.length} 个会场`);
  process.exit(0);
}

main().catch((err) => {
  console.error('seed 失败:', err);
  process.exit(1);
});
