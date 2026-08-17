/**
 * 中英双语(ch08 §8.8 多语言排版)
 * 语言从 URL 查询参数 ?lang= 或 Cookie 决定,服务端渲染即定,不闪烁。
 * 内容侧的多语言字段沿用字段引擎的 I18nString(ch09 §9.3),UI 文案用下表。
 */

export const LOCALES = ['zh', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'zh';
export const LOCALE_COOKIE = 'yumeet_lang';

export function normalizeLocale(v: string | undefined | null): Locale {
  if (!v) return DEFAULT_LOCALE;
  const s = v.toLowerCase();
  if (s.startsWith('zh')) return 'zh';
  if (s.startsWith('en')) return 'en';
  return DEFAULT_LOCALE;
}

/** HTML lang 属性值 */
export const HTML_LANG: Record<Locale, string> = { zh: 'zh-Hans', en: 'en' };

/** Intl 格式化用的 locale 标签 */
export const INTL_LOCALE: Record<Locale, string> = { zh: 'zh-Hans', en: 'en-GB' };

type Dict = Record<Locale, string>;

const T = {
  // 通用
  register: { zh: '注册', en: 'Register' },
  registerCta: { zh: '注册参会', en: 'Register now' },
  schedule: { zh: '日程', en: 'Programme' },
  cfp: { zh: '征稿', en: 'Call for papers' },
  viewSchedule: { zh: '查看日程', en: 'View programme' },
  fullSchedule: { zh: '查看完整日程', en: 'Full programme' },
  backToEvent: { zh: '返回活动页', en: 'Back to event' },

  // 活动页
  about: { zh: '关于会议', en: 'About' },
  venue: { zh: '会场', en: 'Venue' },
  registration: { zh: '注册', en: 'Registration' },
  startRegistration: { zh: '开始注册', en: 'Start registration' },
  addToCalendar: { zh: '加入日历', en: 'Add to calendar' },
  calendarHint: {
    zh: '订阅日程后,任何变动都会自动同步到你的日历应用。',
    en: 'Subscribe once and any change syncs to your calendar automatically.',
  },
  downloadIcs: { zh: '下载 .ics', en: 'Download .ics' },
  publicJson: { zh: '公共 JSON', en: 'Public JSON' },
  timezoneNote: {
    zh: '会议时区 {tz} · 所有时间按您的本地时区显示',
    en: 'Event timezone {tz} · times shown in your local timezone',
  },
  seats: { zh: '座', en: 'seats' },
  moreCount: { zh: '另有 {n} 场', en: '{n} more' },

  // 状态
  date: { zh: '日期', en: 'Dates' },
  location: { zh: '地点', en: 'Location' },
  status: { zh: '状态', en: 'Status' },
  statusPublished: { zh: '报名开放', en: 'Registration open' },
  statusLive: { zh: '进行中', en: 'In progress' },
  statusEnded: { zh: '已结束', en: 'Ended' },
  statusArchived: { zh: '已归档', en: 'Archived' },
  statusDraft: { zh: '草稿', en: 'Draft' },

  // 注册页
  registerTitle: { zh: '注册参会', en: 'Register for the meeting' },
  registerLede: {
    zh: '填写下方信息即可完成注册,无需创建账户。提交后你会立即获得一个可随时查看进度的链接。',
    en: 'Fill in the form below — no account required. You will get a link to track your status right away.',
  },
  selectTicket: { zh: '选择票种', en: 'Select a ticket' },
  attendeeInfo: { zh: '参会人信息', en: 'Attendee details' },
  email: { zh: '邮箱', en: 'Email' },
  emailHelp: {
    zh: '确认函与进度链接将发送到此邮箱,无需设置密码。',
    en: 'Your confirmation and tracking link go here. No password needed.',
  },
  submit: { zh: '完成注册', en: 'Complete registration' },
  submitting: { zh: '提交中…', en: 'Submitting…' },
  submitHint: {
    zh: '提交即表示你同意我们按隐私声明处理上述信息。',
    en: 'By submitting you agree to our processing of the above per the privacy notice.',
  },
  pleaseSelect: { zh: '请选择', en: 'Please select' },
  onlyLeft: { zh: '仅剩 {n} 席', en: 'Only {n} left' },
  free: { zh: '免费', en: 'Free' },
  soldOut: { zh: '已售罄', en: 'Sold out' },
  notYetOnSale: { zh: '尚未开售', en: 'Not yet on sale' },
  salesClosed: { zh: '已停售', en: 'Closed' },
  available: { zh: '可注册', en: 'Available' },
  registrationClosed: { zh: '注册已截止', en: 'Registration closed' },
  registrationNotOpen: { zh: '注册尚未开放', en: 'Registration not yet open' },
  registrationClosedBody: {
    zh: '本次会议的在线注册已于截止日期关闭,如有特殊情况请联系组织者。',
    en: 'Online registration has closed. Please contact the organisers if you need assistance.',
  },
  registrationOpensAt: { zh: '注册将于 {date} 开放。', en: 'Registration opens on {date}.' },
  capacityLimit: { zh: '限 {n} 位', en: '{n} places' },

  // 追踪页
  trackingEyebrow: { zh: '报名进度', en: 'Registration status' },
  stepSubmitted: { zh: '已提交', en: 'Submitted' },
  stepProcessed: { zh: '已受理', en: 'Processed' },
  stepConfirmed: { zh: '已确认', en: 'Confirmed' },
  stepCheckedIn: { zh: '已签到', en: 'Checked in' },
  regDetails: { zh: '报名详情', en: 'Registration details' },
  confirmationCode: { zh: '确认码', en: 'Confirmation code' },
  ticketType: { zh: '票种', en: 'Ticket' },
  regNumber: { zh: '报名编号', en: 'Registration ID' },
  statusHistory: { zh: '状态记录', en: 'History' },
  waitlistPos: { zh: '当前候补位次 第 {n} 位', en: 'Waitlist position: {n}' },
  trackingFootnote: {
    zh: '此页面链接是你的专属凭证,请勿分享给他人。收藏它即可随时查看最新状态,无需登录。',
    en: 'This link is your personal credential — do not share it. Bookmark it to check your status any time, no login needed.',
  },

  // 日程页
  fullScheduleTitle: { zh: '完整日程', en: 'Full programme' },
  scheduleEmpty: {
    zh: '日程尚未发布,请稍后再来查看。',
    en: 'The programme has not been published yet. Please check back later.',
  },
  scheduleMetaDesc: {
    zh: '完整多轨日程,时间按你的本地时区显示。',
    en: 'Full multi-track programme, times shown in your local timezone.',
  },

  // 日程编排器(ch05 §5.1)
  schedEditorEyebrow: { zh: '组织者后台', en: 'Organiser console' },
  schedEditorTitle: { zh: '日程编排器', en: 'Schedule editor' },
  schedEditorLede: {
    zh: '横轴会场、纵轴时间。拖动卡片改时间或换会场,拖下边缘调时长;选中卡片后方向键移动、Shift+方向键调整时长。',
    en: 'Rooms across, time down. Drag a card to move it, drag its bottom edge to resize; with a card focused use arrow keys to move and Shift+arrows to resize.',
  },
  schedBackToConsole: { zh: '返回后台', en: 'Back to console' },
  schedViewPublic: { zh: '查看公共日程页', en: 'View public programme' },
  schedGridLabel: { zh: '多轨时间表', en: 'Multi-track timetable' },
  schedDayTabsLabel: { zh: '按日期编排', en: 'Edit by day' },
  schedDayNth: { zh: '第 {n} 天', en: 'Day {n}' },
  schedSessionCount: { zh: '{n} 场', en: '{n} sessions' },
  schedUnassignedRoom: { zh: '不限会场', en: 'All-venue' },
  schedRoomColumn: { zh: '会场 {name}', en: 'Room {name}' },

  schedSave: { zh: '保存草稿', en: 'Save draft' },
  schedSaving: { zh: '保存中…', en: 'Saving…' },
  schedSaved: { zh: '草稿已保存', en: 'Draft saved' },
  schedPublish: { zh: '发布', en: 'Publish' },
  schedPublishing: { zh: '发布中…', en: 'Publishing…' },
  schedPublished: { zh: '已发布第 {v} 版', en: 'Published version {v}' },
  schedUnsaved: { zh: '有 {n} 处改动未保存', en: '{n} unsaved change(s)' },
  schedAllSaved: { zh: '改动已全部保存', en: 'All changes saved' },
  schedUnpublished: { zh: '有 {n} 处改动未发布', en: '{n} change(s) not published yet' },
  schedAllPublished: { zh: '当前草稿与已发布版本一致', en: 'Draft matches the published version' },
  schedNeverPublished: { zh: '尚未发布过任何版本', en: 'No version published yet' },
  schedCurrentVersion: { zh: '已发布第 {v} 版 · {at}', en: 'Published v{v} · {at}' },
  schedSaveFirst: { zh: '请先保存草稿,再发布', en: 'Save the draft before publishing' },

  schedConflictHeading: { zh: '{n} 处会场时间冲突', en: '{n} room clashes' },
  schedConflictNone: { zh: '当前没有冲突', en: 'No clashes' },
  schedConflictBadge: { zh: '冲突', en: 'Clash' },
  schedConflictItem: {
    zh: '{room}:「{a}」与「{b}」时间重叠',
    en: '{room}: “{a}” overlaps “{b}”',
  },
  schedConflictBlocked: { zh: '存在冲突,已拒绝保存', en: 'Clashes present — save rejected' },
  schedConflictGoto: { zh: '定位到该场次', en: 'Go to this session' },

  schedNewSession: { zh: '新建场次', en: 'New session' },
  schedNewSessionTitle: { zh: '未命名场次', en: 'Untitled session' },
  schedDeleteSession: { zh: '删除场次', en: 'Delete session' },
  schedEditPanel: { zh: '编辑场次', en: 'Edit session' },
  schedClosePanel: { zh: '关闭编辑面板', en: 'Close editor' },
  schedFieldTitle: { zh: '标题', en: 'Title' },
  schedFieldKind: { zh: '类型', en: 'Type' },
  schedFieldRoom: { zh: '会场', en: 'Room' },
  schedFieldDay: { zh: '日期', en: 'Date' },
  schedFieldStart: { zh: '开始时间', en: 'Start' },
  schedFieldEnd: { zh: '结束时间', en: 'End' },
  schedFieldSpeakers: { zh: '讲者', en: 'Speakers' },
  schedFieldSpeakerName: { zh: '姓名', en: 'Name' },
  schedFieldAffiliation: { zh: '所属机构', en: 'Affiliation' },
  schedAddSpeaker: { zh: '添加讲者', en: 'Add speaker' },
  schedRemoveSpeaker: { zh: '移除讲者 {n}', en: 'Remove speaker {n}' },
  schedTimeInEventTz: { zh: '时间按会场时区 {tz} 填写与显示', en: 'Times are in the venue timezone {tz}' },

  schedKindTalk: { zh: '报告', en: 'Talk' },
  schedKindKeynote: { zh: '全体大会', en: 'Plenary' },
  schedKindBreak: { zh: '休息', en: 'Break' },
  schedKindPoster: { zh: '海报', en: 'Poster' },
  schedKindSocial: { zh: '社交活动', en: 'Social' },

  schedKeyboardHint: {
    zh: '选中一张卡片后:↑↓ 前后移动 5 分钟,←→ 换会场,Shift+↑↓ 调整时长,回车或空格打开编辑面板。',
    en: 'With a card focused: ↑↓ move by 5 minutes, ←→ change room, Shift+↑↓ resize, Enter or Space opens the editor.',
  },
  schedMoveAnnounce: { zh: '{title}:{room} {start} 至 {end}', en: '{title}: {room} {start} to {end}' },
  schedDeletedAnnounce: { zh: '已删除「{title}」,保存后生效', en: '“{title}” removed — takes effect on save' },
  schedCreatedAnnounce: { zh: '已新建场次,保存后生效', en: 'New session added — takes effect on save' },
  schedEmptyDay: { zh: '这一天还没有安排场次。', en: 'Nothing scheduled on this day yet.' },
  schedCollabNote: {
    zh: '多人同时编排(Yjs CRDT)尚未接入,当前为单人草稿模式。',
    en: 'Real-time co-editing (Yjs CRDT) is not wired up yet; this is single-editor draft mode.',
  },

  // 主题与外观设置页(ch07 §7.5)
  designEyebrow: { zh: '组织者后台', en: 'Organiser console' },
  designTitle: { zh: '主题与外观', en: 'Theme & appearance' },
  designLede: {
    zh: '选择一个模板包,再微调品牌色与形状。改动即时反映在右侧预览里,保存后公共活动页随之更新。',
    en: 'Pick a template pack, then fine-tune the brand colour and shapes. Changes show up in the preview at once; saving updates the public event pages.',
  },
  themePackage: { zh: '模板包', en: 'Template pack' },
  themePackageHelp: {
    zh: '模板包决定字体、色板与形状的整体基调。切换模板不会动内容,你的微调也会保留。',
    en: 'A pack sets the overall type, palette and shape language. Switching packs never touches your content, and your tweaks are kept.',
  },
  themeInherits: { zh: '继承自 {name}', en: 'Extends {name}' },
  themeVersion: { zh: '版本 {v}', en: 'Version {v}' },
  brandTuning: { zh: '品牌微调', en: 'Brand tuning' },
  accentColor: { zh: '强调色', en: 'Accent colour' },
  accentColorHelp: {
    zh: '用于链接、主按钮与选中态。hover、文字档与深色模式变体由系统自动派生。',
    en: 'Used for links, primary buttons and selected states. Hover, text and dark-mode variants are derived automatically.',
  },
  accentHex: { zh: '色值(十六进制)', en: 'Hex value' },
  radiusControl: { zh: '控件圆角', en: 'Control radius' },
  radiusCard: { zh: '卡片圆角', en: 'Card radius' },
  fontStack: { zh: '字体栈', en: 'Font stack' },
  fontSystem: { zh: '系统无衬线(Cupertino 默认)', en: 'System sans (Cupertino default)' },
  fontSerif: { zh: '衬线(学术经典)', en: 'Serif (academic classic)' },
  fontGrotesk: { zh: '几何无衬线', en: 'Grotesque sans' },
  fontMono: { zh: '等宽', en: 'Monospace' },
  livePreview: { zh: '实时预览', en: 'Live preview' },
  previewNote: {
    zh: '预览用当前活动的真实内容渲染,随左侧调整即时变化;保存前线上页面不受影响。',
    en: 'The preview uses this event’s real content and follows your edits instantly. Live pages stay untouched until you save.',
  },
  previewAppearance: { zh: '预览外观', en: 'Preview appearance' },
  previewLight: { zh: '浅色', en: 'Light' },
  previewDark: { zh: '深色', en: 'Dark' },
  previewWidth: { zh: '预览宽度', en: 'Preview width' },
  previewWidthPhone: { zh: '手机 375', en: 'Phone 375' },
  previewWidthTablet: { zh: '平板 768', en: 'Tablet 768' },
  previewWidthDesktop: { zh: '桌面 1280', en: 'Desktop 1280' },
  previewSampleSession: {
    zh: '示例场次 · 引力波探测的新进展',
    en: 'Sample session · New results in gravitational-wave detection',
  },
  previewSampleMeta: { zh: '09:00–10:30 · 主会场', en: '09:00–10:30 · Main hall' },
  contrastGuard: { zh: '对比度守卫', en: 'Contrast guard' },
  contrastPass: {
    zh: '强调色作为文字时对比度 {ratio}:1,达到 WCAG AA 的 4.5:1。',
    en: 'As text, the accent reaches {ratio}:1 — above the WCAG AA threshold of 4.5:1.',
  },
  contrastFail: {
    zh: '强调色在{bg}上的对比度只有 {ratio}:1,低于 WCAG 1.4.3 要求的 4.5:1,链接与小字会看不清。',
    en: 'On the {bg} the accent only reaches {ratio}:1, below the 4.5:1 required by WCAG 1.4.3 — links and small text will be hard to read.',
  },
  contrastSuggestion: {
    zh: '建议改用同色相的加深值 {color}(对比度 {ratio}:1)。',
    en: 'Try the same hue darkened to {color} ({ratio}:1).',
  },
  contrastApply: { zh: '采用建议色', en: 'Use suggested colour' },
  contrastNoSuggestion: {
    zh: '该色相无法在保持识别度的前提下达标,请换一个更深的品牌色。',
    en: 'No accessible value exists for this hue — please pick a darker brand colour.',
  },
  contrastBgPage: { zh: '页面底色', en: 'page background' },
  contrastBgSection: { zh: '分区底色', en: 'section background' },
  contrastTextTier: {
    zh: '链接与小字使用自动派生的文字档 {color},在页面底与分区底上分别为 {page}:1 与 {section}:1。',
    en: 'Links and small text use the derived text tier {color} — {page}:1 on the page background and {section}:1 on section backgrounds.',
  },
  contrastDarkNote: {
    zh: '深色模式下的强调色由系统派生为 {color},对比度 {ratio}:1。',
    en: 'In dark mode the accent is derived as {color}, at {ratio}:1.',
  },
  designSave: { zh: '保存主题', en: 'Save theme' },
  designSaving: { zh: '保存中…', en: 'Saving…' },
  designSaved: {
    zh: '已保存。公共活动页会在下一次请求时应用新主题。',
    en: 'Saved. Public event pages pick up the new theme on their next request.',
  },
  designFailed: { zh: '保存失败,请重试。', en: 'Could not save — please try again.' },
  designReset: { zh: '还原为模板默认', en: 'Reset to pack defaults' },
  designOverrideCount: { zh: '已覆盖 {n} 项 token', en: '{n} tokens overridden' },
  designRejected: {
    zh: '{n} 项覆盖因取值不合规被忽略。',
    en: '{n} override(s) ignored because their values were not allowed.',
  },

  // 摘要检索(归档)
  abstracts: { zh: '摘要', en: 'Abstracts' },
  abstractsLede: {
    zh: '本次会议共收录 {n} 篇报告,分布于 {tracks} 个分会。可按标题、作者或正文关键词检索。',
    en: '{n} contributions across {tracks} sessions. Search by title, author or full text.',
  },
  searchAbstracts: { zh: '检索摘要', en: 'Search abstracts' },
  searchPlaceholder: { zh: '标题、作者或关键词…', en: 'Title, author or keyword…' },
  search: { zh: '检索', en: 'Search' },
  apply: { zh: '应用', en: 'Apply' },
  track: { zh: '分会', en: 'Session' },
  allTracks: { zh: '全部分会', en: 'All sessions' },
  resultCount: { zh: '共 {n} 条结果', en: '{n} results' },
  clearFilters: { zh: '清除筛选', en: 'Clear filters' },
  noAbstracts: { zh: '没有符合条件的摘要。', en: 'No abstracts match these filters.' },
  pagination: { zh: '分页', en: 'Pagination' },
  prev: { zh: '上一页', en: 'Previous' },
  next: { zh: '下一页', en: 'Next' },
  pageOf: { zh: '第 {a} / {b} 页', en: 'Page {a} of {b}' },
  authors: { zh: '作者', en: 'Authors' },
  backToAbstracts: { zh: '返回摘要列表', en: 'Back to abstracts' },

  // 讲者与委员会(注册转化的关键内容)
  speakers: { zh: '特邀讲者', en: 'Invited speakers' },
  speakersLede: {
    zh: '{n} 位特邀讲者将带来全体大会报告,涵盖引力波、黑洞、宇宙学与多信使天文学。',
    en: '{n} invited speakers will give plenary talks spanning gravitational waves, black holes, cosmology and multi-messenger astronomy.',
  },
  seeAllSpeakers: { zh: '查看全部 {n} 位讲者', en: 'See all {n} speakers' },
  committees: { zh: '组织委员会', en: 'Committees' },
  committeesLede: {
    zh: '本次会议由 {n} 位来自世界各地的学者组成的委员会筹办。',
    en: 'The meeting is organised by committees of {n} scholars from around the world.',
  },
  committeeIcc: { zh: '国际协调委员会', en: 'International Coordinating Committee' },
  committeeIoc: { zh: '国际组织委员会', en: 'International Organizing Committee' },
  committeeLoc: { zh: '本地组织委员会', en: 'Local Organizing Committee' },
  peopleCount: { zh: '{n} 人', en: '{n} members' },

  // 登录与权限
  signIn: { zh: '登录', en: 'Sign in' },
  signOut: { zh: '退出', en: 'Sign out' },
  signInLede: {
    zh: '输入邮箱,我们会发送一个一次性登录链接。yuMeet 不使用密码。',
    en: 'Enter your email and we will send a one-time sign-in link. yuMeet has no passwords.',
  },
  signInNoPassword: {
    zh: '链接 15 分钟内有效、只能使用一次。也可在登录后绑定 passkey,下次用 Touch ID 直接进入。',
    en: 'The link is valid for 15 minutes and works once. After signing in you can add a passkey for one-touch access.',
  },
  sendLink: { zh: '发送登录链接', en: 'Send sign-in link' },
  sending: { zh: '发送中…', en: 'Sending…' },
  linkSent: { zh: '链接已发送', en: 'Link sent' },
  linkSentBody: {
    zh: '请查收邮箱并点击链接完成登录。若几分钟内没收到,请检查垃圾邮件。',
    en: 'Check your inbox and click the link to finish signing in. Check spam if it does not arrive.',
  },
  devOnly: { zh: '开发环境', en: 'Dev only' },
  openLinkNow: { zh: '直接打开登录链接', en: 'Open the sign-in link' },
  noPermission: { zh: '没有访问权限', en: 'No access' },
  noPermissionBody: {
    zh: '你的账户没有执行该操作所需的权限。如需访问请联系活动组织者。',
    en: 'Your account lacks the capability required for this action. Ask the event organiser for access.',
  },
  backHome: { zh: '返回首页', en: 'Back to home' },
  signedInAs: { zh: '已登录', en: 'Signed in' },

  // 后台导航
  overview: { zh: '概览', en: 'Overview' },
  submissions: { zh: '投稿', en: 'Submissions' },
  scheduleEditor: { zh: '日程编排', en: 'Schedule' },
  design: { zh: '主题', en: 'Design' },
  checkin: { zh: '签到台', en: 'Check-in' },
  manageNav: { zh: '后台导航', en: 'Admin navigation' },

  // 支付
  paymentInstructions: { zh: '付款说明', en: 'Payment instructions' },
  amountDue: { zh: '应付金额', en: 'Amount due' },
  payBefore: { zh: '请于 {date} 前完成付款', en: 'Please pay before {date}' },
  paymentReference: { zh: '付款参考号', en: 'Payment reference' },
  paymentReferenceHint: {
    zh: '请务必将此参考号填写在转账附言/备注中,否则我们无法把您的付款与报名对应。',
    en: 'You must include this reference in the transfer memo, otherwise we cannot match your payment to your registration.',
  },
  bankDetails: { zh: '收款账户信息', en: 'Bank account details' },
  accountName: { zh: '账户名称', en: 'Account name' },
  accountNumber: { zh: '账号', en: 'Account number' },
  bankName: { zh: '开户银行', en: 'Bank' },
  alipayScan: { zh: '支付宝扫码付款', en: 'Pay with Alipay' },
  wechatScan: { zh: '微信扫码付款', en: 'Pay with WeChat Pay' },
  paymentQr: { zh: '收款二维码', en: 'Payment QR code' },
  qrPending: { zh: '收款码尚未配置,请联系组织者。', en: 'The payment code is not configured yet. Please contact the organisers.' },
  payee: { zh: '收款方', en: 'Payee' },
  qrMemoHint: {
    zh: '付款时请在备注中填写上方参考号,并保留付款截图以备核对。',
    en: 'Include the reference above in the payment note, and keep a screenshot for reconciliation.',
  },
  onsitePayment: { zh: '现场支付', en: 'Pay on site' },
  onsitePaymentBody: {
    zh: '您已选择现场支付。请在会议注册台出示确认码完成付款,付款后即可直接签到。',
    en: 'You chose to pay on site. Show your confirmation code at the registration desk; you can check in immediately after paying.',
  },
  afterPaying: { zh: '付款之后', en: 'After paying' },
  afterPayingBody: {
    zh: '我们收到款项后会人工核对并确认您的报名,通常在 1–3 个工作日内完成。确认后您会收到邮件通知,也可随时回到进度页查看。',
    en: 'We reconcile incoming payments manually and confirm your registration, usually within 1–3 working days. You will be notified by email and can check the status page any time.',
  },
  paymentReceived: { zh: '款项已收到', en: 'Payment received' },
  paymentReceivedBody: {
    zh: '您的付款已核对确认,报名已生效。',
    en: 'Your payment has been reconciled and your registration is confirmed.',
  },
  viewStatus: { zh: '查看报名进度', en: 'View registration status' },
  // 核销后台
  reconciliation: { zh: '收款核销', en: 'Reconciliation' },
  reconciliationLede: {
    zh: '线下付款需人工核对到账后确认。按参考号比对银行流水或收款记录,确认后报名会自动转为已确认并发出通知。',
    en: 'Offline payments are reconciled manually. Match the reference against your bank statement, then confirm — the registration advances automatically and notifies the attendee.',
  },
  pendingPayments: { zh: '待核销', en: 'Pending' },
  markAsPaid: { zh: '确认到账', en: 'Mark as paid' },
  reconcileNote: { zh: '核销备注(如流水号)', en: 'Note (e.g. transaction ref)' },
  noPendingPayments: { zh: '没有待核销的线下付款。', en: 'No offline payments awaiting reconciliation.' },
  searchByReference: { zh: '按参考号查找', en: 'Find by reference' },

  // 归档概览
  archiveOverview: { zh: '会议规模', en: 'By the numbers' },
  archiveContributions: { zh: '篇报告', en: 'contributions' },
  archiveSessions: { zh: '个分会', en: 'sessions' },
  archiveSpeakers: { zh: '位特邀讲者', en: 'invited speakers' },
  archiveDays: { zh: '天会期', en: 'days' },
  browseArchive: { zh: '浏览全部摘要', en: 'Browse all abstracts' },

  // 成员与权限
  membersTitle: { zh: '成员与权限', en: 'Members & roles' },
  membersLede: {
    zh: '会议的权力结构在此设定。学术决议(IOC)与事务执行(LOC)分权;分会主席只能管辖指定的分会。授予或回收角色会立即使该用户的会话失效,新权限即时生效。',
    en: 'Set the event\u2019s authority structure here. Academic decisions (IOC) and operations (LOC) are separated; session chairs are scoped to their own sessions. Granting or revoking a role signs the user out so the change takes effect immediately.',
  },
  grantRole: { zh: '授予角色', en: 'Grant role' },
  currentMembers: { zh: '现有成员', en: 'Current members' },
  roleReference: { zh: '角色权限说明', en: 'Role reference' },
  roleScope: { zh: '职责范围', en: 'Scope' },
  role: { zh: '角色', en: 'Role' },
  assignTracks: { zh: '管辖的分会', en: 'Sessions in scope' },
  assignedTracks: { zh: '管辖分会', en: 'Scope' },
  noTracks: { zh: '本活动尚无分会,请先导入投稿或创建分会。', en: 'No sessions yet — import submissions or create sessions first.' },
  noMembers: { zh: '暂无成员。', en: 'No members yet.' },
  revoke: { zh: '移除', en: 'Revoke' },
  actions: { zh: '操作', en: 'Actions' },
  you: { zh: '(你)', en: '(you)' },
  roleGranted: { zh: '已授予角色', en: 'Role granted' },
  memberCreated: { zh: '已创建账户并授予角色,对方首次登录即生效', en: 'Account created and role granted; effective on their first sign-in' },
  roleNote: {
    zh: '整个分会占用哪个时段、放在哪个会场由大会管理员统一安排;分会主席只在已分配的时段内排定本分会各报告的顺序与时刻。',
    en: 'Which slot and room a session occupies is set by organisers; session chairs only order and time the talks within their allocated slot.',
  },

  // 语言切换
  language: { zh: '语言', en: 'Language' },
  switchToEn: { zh: 'English', en: 'English' },
  switchToZh: { zh: '中文', en: '中文' },

  // 征稿页(ch04 §4.3)
  cfpTitle: { zh: '征稿', en: 'Call for papers' },
  cfpLede: {
    zh: '欢迎提交口头报告与墙报摘要。摘要经程序委员会双盲评审,录用结果按下方时间表通知。',
    en: 'We welcome abstracts for talks and posters. All abstracts are reviewed double-blind by the programme committee; decisions follow the timetable below.',
  },
  cfpTracksTitle: { zh: '征稿方向', en: 'Tracks' },
  cfpTypesTitle: { zh: '投稿类型', en: 'Submission types' },
  cfpDatesTitle: { zh: '关键时间', en: 'Key dates' },
  cfpDeadlineSubmission: { zh: '投稿截止', en: 'Submission deadline' },
  cfpDeadlineRevision: { zh: '修改截止', en: 'Revision deadline' },
  cfpDeadlineReview: { zh: '评审截止', en: 'Review deadline' },
  cfpDeadlineNotification: { zh: '录用通知', en: 'Notification' },
  cfpDatesNote: {
    zh: '所有截止时间以服务器时钟为准,按你的本地时区显示,无宽限期。',
    en: 'Deadlines are enforced by the server clock, shown in your local timezone, with no grace period.',
  },
  cfpBlindTitle: { zh: '双盲评审', en: 'Double-blind review' },
  cfpBlindBody: {
    zh: '审稿人看不到作者与机构信息(由服务端裁剪),请自查摘要正文中不要出现可识别身份的表述。',
    en: 'Reviewers never receive author or affiliation data — it is stripped on the server. Please make sure your abstract text does not identify you.',
  },
  cfpStart: { zh: '开始投稿', en: 'Start a submission' },
  cfpClosedTitle: { zh: '投稿已截止', en: 'Submissions are closed' },
  cfpClosedBody: {
    zh: '本次会议的摘要投稿已关闭。如有特殊情况请联系程序委员会。',
    en: 'Abstract submission has closed. Please contact the programme committee if you need assistance.',
  },
  cfpResumeHint: {
    zh: '已有草稿?打开你收到的投稿链接即可继续编辑。',
    en: 'Already started? Open the submission link you received to keep editing.',
  },

  // 投稿表单
  subFormTitle: { zh: '提交摘要', en: 'Submit an abstract' },
  subFormLede: {
    zh: '填写下方信息即可投稿,无需创建账户。草稿可反复保存,提交后你会获得一个随时查看进度的链接。',
    en: 'No account needed. Save as many drafts as you like; once submitted you get a link to track progress any time.',
  },
  subWork: { zh: '稿件信息', en: 'Your abstract' },
  subTitleField: { zh: '标题', en: 'Title' },
  subAbstractField: { zh: '摘要', en: 'Abstract' },
  subAbstractHelp: { zh: '最多 {n} 字符。', en: 'Up to {n} characters.' },
  subTypeField: { zh: '投稿类型', en: 'Submission type' },
  subTrackField: { zh: '征稿方向', en: 'Track' },
  subAuthorsField: { zh: '作者', en: 'Authors' },
  subAuthorsHelp: {
    zh: '请按署名顺序填写,并勾选现场报告人。通讯邮箱用于发送投稿回执与录用通知。',
    en: 'List authors in byline order and tick the presenting author. The email is used for the receipt and the decision notice.',
  },
  authorNameField: { zh: '姓名', en: 'Name' },
  authorEmailField: { zh: '邮箱', en: 'Email' },
  authorAffiliationField: { zh: '机构', en: 'Affiliation' },
  authorPresenterField: { zh: '现场报告人', en: 'Presenting author' },
  authorIndex: { zh: '作者 {n}', en: 'Author {n}' },
  addAuthor: { zh: '添加作者', en: 'Add author' },
  removeAuthor: { zh: '移除作者 {n}', en: 'Remove author {n}' },
  subExtra: { zh: '补充信息', en: 'Additional information' },
  saveDraft: { zh: '保存草稿', en: 'Save draft' },
  savingDraft: { zh: '保存中…', en: 'Saving…' },
  submitAbstract: { zh: '提交投稿', en: 'Submit abstract' },
  subDraftHint: {
    zh: '草稿只有你可见,提交后才会进入评审流程。',
    en: 'Drafts are visible only to you; nothing enters review until you submit.',
  },
  subEditingDraft: {
    zh: '你正在继续编辑一份已保存的草稿。',
    en: 'You are continuing a previously saved draft.',
  },

  // 投稿追踪页 /s/{token}
  subTrackingEyebrow: { zh: '投稿进度', en: 'Submission status' },
  stepSubSubmitted: { zh: '已提交', en: 'Submitted' },
  stepSubReview: { zh: '评审中', en: 'In review' },
  stepSubDecision: { zh: '已决议', en: 'Decision' },
  stepSubConfirmed: { zh: '已确认', en: 'Confirmed' },
  stepSubScheduled: { zh: '已排期', en: 'Scheduled' },
  subDetails: { zh: '投稿详情', en: 'Submission details' },
  subNumber: { zh: '投稿编号', en: 'Submission ID' },
  subWaitlistBadge: { zh: '候补录用', en: 'Waitlisted' },
  subWaitlistBody: {
    zh: '你的稿件被列入候补:若有报告取消,我们会按顺序通知你。',
    en: 'Your abstract is on the waitlist: if a slot opens we will contact you in order.',
  },
  subFeedbackTitle: { zh: '评审意见', en: 'Reviewer comments' },
  subFeedbackHint: {
    zh: '以下是决议后向作者公开的匿名意见,委员会内部讨论不在此列。',
    en: 'These are the anonymised comments released to authors after the decision. Internal committee discussion is never shown.',
  },
  subEditDraft: { zh: '继续编辑草稿', en: 'Continue editing' },
  subWithdraw: { zh: '撤回投稿', en: 'Withdraw submission' },
  subWithdrawing: { zh: '处理中…', en: 'Working…' },
  subConfirmAttendance: { zh: '确认出席', en: 'Confirm attendance' },
  subTrackingFootnote: {
    zh: '此链接是你的投稿凭证,请勿分享给他人。收藏它即可随时查看状态、继续编辑或撤回,无需登录。',
    en: 'This link is your submission credential — do not share it. Bookmark it to check status, keep editing or withdraw, no login needed.',
  },
  subNextDraft: {
    zh: '这份稿件还是草稿,尚未进入评审。继续编辑并提交后,程序委员会才能看到它。',
    en: 'This is still a draft and has not entered review. Finish editing and submit so the committee can see it.',
  },
  subNextSubmitted: {
    zh: '稿件已收到。程序委员会将分配审稿人,分配完成后状态会变为「评审中」。',
    en: 'We have your abstract. The committee will assign reviewers, after which the status becomes “Under review”.',
  },
  subNextUnderReview: {
    zh: '稿件正在双盲评审中。评审完成并作出决议后,你会收到邮件通知,本页也会同步更新。',
    en: 'Your abstract is in double-blind review. You will be emailed when a decision is made, and this page updates at the same time.',
  },
  subNextChangesRequested: {
    zh: '程序委员会要求修订。请在修改截止前更新稿件并重新提交。',
    en: 'The committee has requested changes. Please revise and resubmit before the revision deadline.',
  },
  subNextAccepted: {
    zh: '恭喜,稿件已被录用。请点击「确认出席」以保留你的报告位次,确认后我们会将其投入日程编排。',
    en: 'Congratulations — your abstract was accepted. Confirm attendance to keep your slot; we then move it into the programme.',
  },
  subNextConfirmed: {
    zh: '出席已确认,稿件已进入日程编排池。排期确定后本页会显示具体时间与会场。',
    en: 'Attendance confirmed and your talk is in the scheduling pool. Time and room will appear here once scheduled.',
  },
  subNextScheduled: {
    zh: '你的报告已排入日程,具体时间与会场请见公共日程页。',
    en: 'Your presentation is scheduled. See the public programme for time and room.',
  },
  subNextRejected: {
    zh: '很抱歉,本次稿件未获录用。评审意见见下方,欢迎在未来的会议再次投稿。',
    en: 'Unfortunately this abstract was not accepted. Reviewer comments are below; we hope to see a submission from you in future.',
  },
  subNextWithdrawn: {
    zh: '此稿件已撤回,不再参与评审。如需重新投稿,请回到征稿页新建一份。',
    en: 'This abstract has been withdrawn and is no longer in review. Start a new submission from the call for papers page if you wish.',
  },

  // 组织者:投稿管理
  mgSubmissions: { zh: '投稿管理', en: 'Submissions' },
  mgSubEyebrow: { zh: '征稿与评审', en: 'Call for papers' },
  mgSubTotal: { zh: '投稿总数', en: 'Submissions' },
  mgSubToAssign: { zh: '待分配审稿人', en: 'Awaiting assignment' },
  mgSubInReview: { zh: '评审中', en: 'In review' },
  mgSubAccepted: { zh: '已录用', en: 'Accepted' },
  mgSubList: { zh: '投稿列表', en: 'Submission list' },
  filterAll: { zh: '全部', en: 'All' },
  colTitle: { zh: '标题', en: 'Title' },
  colType: { zh: '类型', en: 'Type' },
  colTrack: { zh: '方向', en: 'Track' },
  colAuthors: { zh: '作者', en: 'Authors' },
  colReviews: { zh: '评审', en: 'Reviews' },
  colActions: { zh: '操作', en: 'Actions' },
  colSelect: { zh: '选择', en: 'Select' },
  selectSubmission: { zh: '选择《{title}》', en: 'Select “{title}”' },
  selectAllSubmissions: { zh: '全选本页投稿', en: 'Select all on this page' },
  bulkAssignTitle: { zh: '批量分配审稿人', en: 'Assign reviewers in bulk' },
  bulkAssignHint: {
    zh: '勾选投稿并选择审稿人;与作者邮箱相同或同域的审稿人会被自动跳过(利益冲突)。',
    en: 'Tick submissions and pick reviewers. Reviewers sharing an author’s email address or domain are skipped automatically (conflict of interest).',
  },
  reviewerField: { zh: '审稿人', en: 'Reviewers' },
  assignAction: { zh: '分配给选中的 {n} 篇', en: 'Assign to {n} selected' },
  assignDone: { zh: '已完成 {n} 篇投稿的分配。', en: 'Assigned reviewers on {n} submission(s).' },
  assignSkipped: {
    zh: '因利益冲突跳过 {n} 人次。',
    en: '{n} reviewer assignment(s) skipped for conflict of interest.',
  },
  noSelection: { zh: '请先勾选至少一篇投稿。', en: 'Select at least one submission first.' },
  noReviewerSelected: { zh: '请先选择审稿人。', en: 'Select at least one reviewer.' },
  noSubmissions: { zh: '暂无符合条件的投稿。', en: 'No submissions match this filter.' },
  reviewMean: { zh: '均分', en: 'Mean' },
  reviewVariance: { zh: '方差', en: 'Variance' },
  reviewDisputed: { zh: '意见分歧', en: 'Disputed' },
  reviewsProgress: { zh: '{done}/{total} 份', en: '{done}/{total}' },
  terminalState: { zh: '终态', en: 'Final' },
  viewDetail: { zh: '详情', en: 'Details' },
  backToSubmissions: { zh: '返回投稿列表', en: 'Back to submissions' },
  decisionTitle: { zh: '录用决议', en: 'Decision' },
  decisionAccept: { zh: '录用', en: 'Accept' },
  decisionReject: { zh: '拒绝', en: 'Reject' },
  decisionWaitlist: { zh: '标记为候补', en: 'Mark as waitlist' },
  decisionRequestChanges: { zh: '要求修改', en: 'Request changes' },
  decisionHint: {
    zh: 'waitlist 是录用决定上的标记,不是独立状态;决议需至少 {n} 份已提交评审。',
    en: 'Waitlist is a flag on the decision, not a status. A decision needs at least {n} submitted review(s).',
  },
  reviewsTitle: { zh: '评审记录', en: 'Reviews' },
  committeeComment: { zh: '给委员会的意见', en: 'For the committee' },
  authorComment: { zh: '给作者的意见', en: 'For the authors' },
  confidenceField: { zh: '置信度', en: 'Confidence' },
  totalScore: { zh: '总分', en: 'Total' },
  conflictDeclared: { zh: '已声明利益冲突', en: 'Conflict of interest declared' },
  reviewNotSubmitted: { zh: '尚未提交', en: 'Not submitted yet' },
  noReviewsYet: { zh: '尚未分配审稿人。', en: 'No reviewers assigned yet.' },
  submissionDetail: { zh: '投稿详情', en: 'Submission detail' },
  answersTitle: { zh: '补充信息', en: 'Additional information' },

  // 审稿人
  myReviews: { zh: '我的评审', en: 'My reviews' },
  myReviewsLede: {
    zh: '以下是分配给你的稿件。双盲评审:作者与机构信息在服务端即被裁剪,你看到的只有稿件本身。',
    en: 'Abstracts assigned to you. Review is double-blind: author and affiliation data is stripped on the server, so you only ever see the work itself.',
  },
  reviewTasksEmpty: { zh: '目前没有分配给你的评审任务。', en: 'No review tasks are assigned to you right now.' },
  actingAs: {
    zh: '当前以「{name}」身份查看(后台登录尚未接入)。',
    en: 'Viewing as “{name}” (sign-in is not wired up yet).',
  },
  openReview: { zh: '开始评审', en: 'Review' },
  continueReview: { zh: '继续评审', en: 'Continue' },
  reviewFormTitle: { zh: '评分表', en: 'Review form' },
  scoresLegend: { zh: '评分', en: 'Scores' },
  confidenceHelp: {
    zh: '1 = 不熟悉此方向,5 = 该方向的专家。置信度不计入总分,仅作聚合时的二次权重。',
    en: '1 = outside my field, 5 = expert in this area. Confidence does not affect the score; it is only a secondary weight when aggregating.',
  },
  committeeCommentHelp: {
    zh: '只有程序委员会可见,作者永远看不到。',
    en: 'Visible to the programme committee only — never shown to authors.',
  },
  authorCommentHelp: {
    zh: '决议发出后向作者匿名公开,请写得具体、可执行。',
    en: 'Released anonymously to the authors after the decision — be specific and actionable.',
  },
  declareConflict: { zh: '我与这篇投稿存在利益冲突', en: 'I have a conflict of interest with this submission' },
  conflictHelp: {
    zh: '勾选并保存后,系统会立即撤销你对该稿件的访问,已填评分将被清除。',
    en: 'Once saved, your access to this abstract is revoked immediately and any scores you entered are cleared.',
  },
  submitReview: { zh: '提交评审', en: 'Submit review' },
  reviewStatusAssigned: { zh: '待评审', en: 'To review' },
  reviewStatusDraft: { zh: '草稿', en: 'Draft' },
  reviewStatusSubmitted: { zh: '已提交', en: 'Submitted' },
  reviewSavedNotice: { zh: '评审草稿已保存。', en: 'Review draft saved.' },
  reviewSubmittedNotice: { zh: '评审已提交,感谢你的时间。', en: 'Review submitted — thank you for your time.' },
  blindNotice: {
    zh: '双盲评审:此页不包含作者与机构信息。',
    en: 'Double-blind review: this page contains no author or affiliation data.',
  },

  // 通用操作反馈
  invalidTransition: {
    zh: '不能把状态从「{from}」变更为「{to}」。',
    en: 'Cannot change the status from “{from}” to “{to}”.',
  },
  actionFailed: { zh: '操作失败,请重试。', en: 'Something went wrong. Please try again.' },
  saved: { zh: '已保存', en: 'Saved' },
  errCfpClosed: { zh: '投稿已截止,无法再提交。', en: 'The submission deadline has passed.' },
  errNotEditable: { zh: '当前状态下这份稿件不可编辑。', en: 'This submission cannot be edited in its current state.' },
  errSubmissionNotFound: { zh: '找不到这份投稿,链接可能已失效。', en: 'This submission could not be found — the link may have expired.' },
  errValidation: { zh: '还有必填项没有填写或格式不正确,请检查后再提交。', en: 'Some required fields are missing or invalid. Please check and try again.' },
  errAllConflicted: { zh: '所选审稿人全部与作者存在利益冲突,未做任何分配。', en: 'Every selected reviewer has a conflict of interest with the authors — nothing was assigned.' },
  errNotEnoughReviews: { zh: '已提交的评审份数不足,还不能作出决议。', en: 'Not enough submitted reviews to make a decision yet.' },
  errNoReviewer: { zh: '请至少选择一位审稿人。', en: 'Select at least one reviewer.' },
  errNotAssigned: { zh: '你未被分配这篇投稿。', en: 'This submission is not assigned to you.' },
  errScoreInput: { zh: '请完整填写各维度评分与置信度,并确保在量表范围内。', en: 'Please score every dimension and set a confidence, within the given scales.' },
  errNotUnderReview: { zh: '这篇投稿当前不在评审阶段。', en: 'This submission is not in the review stage.' },
  errTerminal: { zh: '终态投稿不能再变更。', en: 'This submission has reached a final state and cannot change.' },
  answerYes: { zh: '是', en: 'Yes' },
  answerNo: { zh: '否', en: 'No' },
  timelineDraftCreated: { zh: '创建投稿草稿', en: 'Draft created' },
  timelineReviewersAssigned: { zh: '已分配审稿人', en: 'Reviewers assigned' },

  // 隐私声明页 /{org}/{event}/privacy(ch12 §12.3「默认即合规」的可见落点)
  privacyNav: { zh: '隐私声明', en: 'Privacy notice' },
  pvEyebrow: { zh: '数据保护', en: 'Data protection' },
  pvTitle: { zh: '隐私声明', en: 'Privacy notice' },
  pvLede: {
    zh: '本页说明这场会议收集哪些数据、为什么收集、保留多久,以及你可以随时行使哪些权利。字段清单由报名表单的定义自动生成 —— 表单改了,这一页跟着改,不存在两份说法。',
    en: 'What this meeting collects, why, how long it is kept, and the rights you can exercise at any time. The field list is generated from the registration form itself, so it can never drift from what is actually collected.',
  },
  pvController: { zh: '数据控制者', en: 'Data controller' },
  pvControllerName: { zh: '控制者', en: 'Controller' },
  pvControllerRole: { zh: '角色', en: 'Role' },
  pvContact: { zh: '联系方式', en: 'Contact' },
  pvContactMissing: { zh: '请通过活动页公布的邮箱联系组织者', en: 'Use the contact address published on the event page' },
  pvEventScope: { zh: '适用范围', en: 'Scope' },
  pvCollected: { zh: '我们收集哪些数据', en: 'What we collect' },
  pvCollectedLede: {
    zh: '以下字段来自本活动的报名表单定义。标记为「个人数据」的字段参与到期匿名化;标记为「特殊类别」的健康相关字段(饮食、无障碍)会在会后 30 天硬删除,并默认排除在一切导出模板之外。',
    en: 'These fields come from this event’s registration form. Fields marked “personal data” are anonymised when the retention period ends; health-related “special category” fields (dietary, accessibility) are hard-deleted 30 days after the event and are excluded from every export template by default.',
  },
  pvNoFields: {
    zh: '本活动尚未开放报名表单,因此还没有收集任何参会者数据。',
    en: 'Registration is not open for this event, so no attendee data has been collected.',
  },
  pvColField: { zh: '字段', en: 'Field' },
  pvColKind: { zh: '类型', en: 'Type' },
  pvColCategory: { zh: '数据类别', en: 'Category' },
  pvColRetention: { zh: '保留期', en: 'Retention' },
  pvCatPii: { zh: '个人数据', en: 'Personal data' },
  pvCatSpecial: { zh: '特殊类别', en: 'Special category' },
  pvCatOrdinary: { zh: '非识别性', en: 'Non-identifying' },
  pvRequiredMark: { zh: '必填', en: 'Required' },
  pvOptionalMark: { zh: '选填', en: 'Optional' },
  pvRetentionTitle: { zh: '保留期与到期动作', en: 'Retention periods' },
  pvRetentionLede: {
    zh: '保留期清理是每日自动任务,不是「记得去清」的人工流程:worker 每日 04:00 UTC 按下表执行,每次运行都写入审计日志。',
    en: 'Clean-up is an automatic daily job, not a reminder someone has to act on: the worker runs at 04:00 UTC every day against the table below, and every run is written to the audit log.',
  },
  pvColData: { zh: '数据', en: 'Data' },
  pvColPeriod: { zh: '保留期', en: 'Retention period' },
  pvColAction: { zh: '到期动作', en: 'On expiry' },
  pvDays: { zh: '{n} 天', en: '{n} days' },
  pvFromEventEnd: { zh: '活动结束后', en: 'after the event ends' },
  pvFromRecord: { zh: '记录创建后', en: 'after the record is created' },
  pvPiiClearedOn: {
    zh: '本活动的报名 PII 将于 {date} 自动匿名化(活动结束后 {n} 天)。',
    en: 'Registration PII for this event is anonymised automatically on {date} ({n} days after the event ends).',
  },
  pvSpecialClearedOn: {
    zh: '饮食与无障碍等特殊类别字段将于 {date} 硬删除。',
    en: 'Special-category fields such as dietary and accessibility needs are hard-deleted on {date}.',
  },
  pvAnonMeaning: {
    zh: '「匿名化」是逐字段的确定性操作:邮箱替换为 anon-…@invalid、姓名置为占位符、所有个人数据字段清空,同时保留计数与非个人统计维度 —— 历史页面与归档不受影响。',
    en: '“Anonymisation” is a deterministic, field-by-field operation: the email becomes anon-…@invalid, the name becomes a placeholder, every personal-data field is cleared — while counts and non-identifying statistics are kept, so archives stay intact.',
  },
  pvRightsTitle: { zh: '你的权利', en: 'Your rights' },
  pvRightsLede: {
    zh: '每一项权利都有自助入口,不需要发邮件等 30 天。打开报名确认邮件里的进度链接(/r/…),点「数据与隐私」即可。',
    en: 'Every right has a self-service entry point — no email, no 30-day wait. Open the tracking link from your confirmation email (/r/…) and choose “My data & privacy”.',
  },
  pvColRight: { zh: '权利', en: 'Right' },
  pvColHow: { zh: '产品实现', en: 'How it works here' },
  pvRightInform: { zh: '知情(Art. 13/14)', en: 'Information (Art. 13/14)' },
  pvRightInformHow: {
    zh: '本页与报名表单内联说明:为什么收集、保留多久,由字段定义自动生成。',
    en: 'This page and the inline notes beside each form field, generated from the field definitions.',
  },
  pvRightAccess: { zh: '访问(Art. 15)', en: 'Access (Art. 15)' },
  pvRightAccessHow: {
    zh: '在数据与隐私页查看全部数据,或一键导出机器可读 JSON。',
    en: 'View everything on the data & privacy page, or export machine-readable JSON in one click.',
  },
  pvRightRectify: { zh: '更正(Art. 16)', en: 'Rectification (Art. 16)' },
  pvRightRectifyHow: {
    zh: '报名确认前可自行修改答案;确认后请联系组织者。',
    en: 'Edit your answers yourself before the registration is confirmed; afterwards, contact the organisers.',
  },
  pvRightErase: { zh: '删除(Art. 17)', en: 'Erasure (Art. 17)' },
  pvRightEraseHow: {
    zh: '两步确认后立即匿名化个人数据;交易记录按法定义务保留,但已脱敏。',
    en: 'A two-step confirmation anonymises your personal data immediately. Financial records are kept as the law requires, but masked.',
  },
  pvRightRestrict: { zh: '限制处理(Art. 18)', en: 'Restriction (Art. 18)' },
  pvRightRestrictHow: {
    zh: '可将记录标记为限制处理:排除于导出、邮件与统计。',
    en: 'Flag your record as restricted: excluded from exports, mailings and statistics.',
  },
  pvRightPortable: { zh: '可携(Art. 20)', en: 'Portability (Art. 20)' },
  pvRightPortableHow: {
    zh: '与访问权同一份 JSON,结构随 OpenAPI schema 发布。',
    en: 'The same JSON as the access right; its structure is published with the OpenAPI schema.',
  },
  pvRightObject: { zh: '反对(Art. 21)', en: 'Objection (Art. 21)' },
  pvRightObjectHow: {
    zh: '随时退出公开参会者名单;营销邮件每封页脚均可一键退订。',
    en: 'Withdraw from the public attendee list at any time; marketing emails carry a one-click unsubscribe.',
  },
  pvRightAuto: { zh: '免受自动化决策(Art. 22)', en: 'Automated decisions (Art. 22)' },
  pvRightAutoHow: {
    zh: '产品约束:报名审批不提供「自动拒绝」规则,自动化只能自动通过或转人工。',
    en: 'A product constraint: there is no “auto-reject” rule. Automation may approve or escalate to a human — never reject.',
  },
  pvDefaultsTitle: { zh: '默认值', en: 'Defaults' },
  pvDefaultMinimal: {
    zh: '数据最小化:新建报名表默认只有邮箱与姓名,每多收一个字段都是组织者的显式选择。',
    en: 'Data minimisation: a new registration form starts with email and name only. Every extra field is a deliberate choice by the organisers.',
  },
  pvDefaultHidden: {
    zh: '展示默认关闭:参会者名单对公众默认不可见,需要每位参会者单独勾选才会出现。',
    en: 'Display off by default: the attendee list is not public unless each attendee opts in individually.',
  },
  pvDefaultCookies: {
    zh: 'Cookie:只使用严格必要的第一方会话 cookie,没有任何第三方跟踪,因此公共活动站不需要 cookie 横幅。',
    en: 'Cookies: strictly necessary first-party session cookies only, with no third-party tracking — which is why this site has no cookie banner.',
  },
  pvAuditNote: {
    zh: '所有导出、删除与保留期清理都写入追加型审计日志(哈希链保证事后可验证未被篡改)。',
    en: 'Every export, erasure and retention run is written to an append-only audit log whose hash chain makes later tampering detectable.',
  },
  pvEntryTitle: { zh: '行使你的权利', en: 'Exercise your rights' },
  pvEntryBody: {
    zh: '打开你收到的报名进度链接(形如 /r/xxxxx),点击页面底部的「数据与隐私」。该链接本身就是凭证,无需注册账户。',
    en: 'Open the tracking link you received (it looks like /r/xxxxx) and choose “My data & privacy” at the bottom. The link is the credential — no account needed.',
  },

  // 参会者数据权利页 /r/{token}/data
  drNav: { zh: '数据与隐私', en: 'My data & privacy' },
  drEyebrow: { zh: '数据权利', en: 'Data rights' },
  drTitle: { zh: '我的数据与隐私', en: 'My data & privacy' },
  drLede: {
    zh: '这里是关于你这次报名我们所保存的全部数据。你可以随时查看、导出、更正、限制处理或要求删除 —— 无需账户,这个链接就是凭证。',
    en: 'Everything we hold about this registration. View it, export it, correct it, restrict its processing or have it erased — no account needed; this link is the credential.',
  },
  drBackToStatus: { zh: '返回报名进度', en: 'Back to my registration' },
  drDataTitle: { zh: '我们保存的数据', en: 'What we hold' },
  drAnswersTitle: { zh: '报名表单答案', en: 'Your form answers' },
  drEmptyAnswer: { zh: '未填写', en: 'Not provided' },
  drClearedAnswer: { zh: '已按你的请求清除', en: 'Erased at your request' },
  drExportTitle: { zh: '导出全部数据', en: 'Export everything' },
  drExportBody: {
    zh: '一份机器可读的 JSON,包含报名信息、全部答案、状态历史与保留期说明 —— 这既是访问权(Art. 15),也是可携带权(Art. 20)。',
    en: 'A machine-readable JSON file with your registration, every answer, the status history and the retention terms — this covers both access (Art. 15) and portability (Art. 20).',
  },
  drExportAction: { zh: '下载 JSON', en: 'Download JSON' },
  drCorrectTitle: { zh: '更正我的答案', en: 'Correct my answers' },
  drCorrectBody: {
    zh: '报名确认前你可以自行修改答案。修改会写入审计日志,但日志里只记录「哪个字段变了」,不记录个人数据的值。',
    en: 'Until the registration is confirmed you can edit your answers yourself. Changes are audited by field name only — never by value for personal data.',
  },
  drCorrectLocked: {
    zh: '报名已确认或已进入终态,自助修改已关闭。需要更正请联系组织者,他们的操作同样会入审计。',
    en: 'This registration is confirmed or final, so self-service editing is closed. Ask the organisers to correct it — their change is audited too.',
  },
  drSaveAnswers: { zh: '保存修改', en: 'Save changes' },
  drSavingAnswers: { zh: '保存中…', en: 'Saving…' },
  drCorrected: { zh: '已更新 {n} 个字段。', en: 'Updated {n} field(s).' },
  drNoChanges: { zh: '没有检测到修改。', en: 'Nothing changed.' },
  drRestrictTitle: { zh: '限制处理与公开展示', en: 'Restriction and visibility' },
  drRestrictBody: {
    zh: '参会者名单对公众默认不可见;如果本活动开启了名单,你可以随时撤回展示。限制处理会把这条记录冻结:排除于导出、群发邮件与统计。',
    en: 'The attendee list is private by default; if this event publishes one, you can withdraw at any time. Restricting processing freezes this record: it is excluded from exports, mailings and statistics.',
  },
  drListOptOut: { zh: '不要在公开参会者名单中显示我', en: 'Do not show me on the public attendee list' },
  drRestricted: { zh: '限制处理我的数据(Art. 18)', en: 'Restrict processing of my data (Art. 18)' },
  drSavePrefs: { zh: '保存偏好', en: 'Save preferences' },
  drPrefsSaved: { zh: '隐私偏好已保存。', en: 'Privacy preferences saved.' },
  drEraseTitle: { zh: '删除我的数据', en: 'Erase my data' },
  drEraseBody: {
    zh: '删除是不可逆的。确认后我们立即匿名化你的个人数据:邮箱替换为 anon-…@invalid、姓名置为占位符、所有个人数据字段清空;计数等非识别统计会保留。已产生的交易记录按法定义务保留,但同样脱敏。',
    en: 'Erasure is irreversible. On confirmation we anonymise your personal data immediately: the email becomes anon-…@invalid, the name becomes a placeholder and every personal-data field is cleared. Non-identifying counts remain. Financial records are kept as the law requires — masked.',
  },
  drEraseRequest: { zh: '请求删除我的数据', en: 'Request erasure' },
  drEraseStep1: { zh: '第 1 步 · 提交请求', en: 'Step 1 · Request' },
  drEraseStep2: { zh: '第 2 步 · 二次确认', en: 'Step 2 · Confirm' },
  drEraseConfirmTitle: { zh: '确认删除:此操作不可撤销', en: 'Confirm erasure: this cannot be undone' },
  drEraseWillClear: { zh: '将被清除的字段', en: 'Fields to be cleared' },
  drEraseWillRetain: { zh: '按法定义务保留(已脱敏)', en: 'Kept as legally required (masked)' },
  drEraseTypeLabel: { zh: '请输入 DELETE 以确认', en: 'Type DELETE to confirm' },
  drEraseConfirmAction: { zh: '确认删除', en: 'Erase my data' },
  drEraseCancel: { zh: '取消', en: 'Cancel' },
  drEraseExpiresAt: { zh: '此确认将在 {time} 失效。', en: 'This confirmation expires at {time}.' },
  drErasedTitle: { zh: '你的数据已被清除', en: 'Your data has been erased' },
  drErasedBody: {
    zh: '这条报名的个人数据已于 {date} 匿名化,本页不再提供更正与再次删除。',
    en: 'The personal data on this registration was anonymised on {date}. Correction and further erasure are no longer offered here.',
  },
  drRetentionTitle: { zh: '不做任何事会发生什么', en: 'If you do nothing' },
  drRetentionBody: {
    zh: '本活动的报名个人数据将于 {date} 自动匿名化,饮食与无障碍等特殊类别字段更早,于 {special} 硬删除 —— 保留期清理是每日自动任务。',
    en: 'Personal data on this registration is anonymised automatically on {date}. Special-category fields (dietary, accessibility) go earlier — hard-deleted on {special}. Clean-up runs daily, automatically.',
  },
  drPrivacyNoticeLink: { zh: '阅读本活动的完整隐私声明', en: 'Read the full privacy notice' },
  drFootnote: {
    zh: '这个链接是你的凭证,请勿分享给他人。每一次导出、更正与删除都会写入审计日志。',
    en: 'This link is your credential — do not share it. Every export, correction and erasure is written to the audit log.',
  },
  drErrNotCorrectable: {
    zh: '当前状态下不能自助修改答案。',
    en: 'Answers can no longer be edited from here.',
  },
  drErrErased: { zh: '数据已被清除,无法再执行此操作。', en: 'The data is already erased.' },
  drErrExpiredRequest: { zh: '删除请求已过期,请重新发起。', en: 'The erasure request expired — please start again.' },
  drErrBadConfirmation: { zh: '确认失败,请重新发起删除请求。', en: 'Confirmation failed — please request erasure again.' },
  drErrTypeDelete: { zh: '请准确输入 DELETE 以确认删除。', en: 'Type DELETE exactly to confirm.' },
  drErrGeneric: { zh: '操作失败,请稍后重试。', en: 'Something went wrong. Please try again.' },

  // 现场模式 · 胸牌(ch05 §5.2.2)
  badgesTitle: { zh: '胸牌', en: 'Badges' },
  badgesEyebrow: { zh: '现场模式', en: 'Onsite mode' },
  badgesLede: {
    zh: '胸牌由 satori 排版后转成 PNG,字体已内嵌,拿到打印店直接可印。二维码内容就是确认码,签到台扫码或手输皆可。',
    en: 'Badges are laid out with satori — embedded fonts and all — then rasterised to PNG, ready for the print shop. The QR code carries the confirmation code the check-in desk already understands.',
  },
  badgePreview: { zh: '预览', en: 'Preview' },
  badgeLayout: { zh: '版式', en: 'Layout' },
  badgeLayoutA7: { zh: 'A7 横向 · 105 × 74 mm', en: 'A7 landscape · 105 × 74 mm' },
  badgeLayoutA6: { zh: 'A6 纵向 · 105 × 148 mm', en: 'A6 portrait · 105 × 148 mm' },
  badgeDownloadOne: { zh: '下载这一张 PNG', en: 'Download this PNG' },
  badgeDownloadAll: { zh: '批量导出 ZIP', en: 'Export all as ZIP' },
  badgeBatchHint: {
    zh: '批量导出按姓名排序,文件名为「确认码-姓名.png」,本次共 {n} 张。',
    en: 'The archive is sorted by name; each file is named “code-name.png”. {n} badges in this batch.',
  },
  badgeStatusFilter: { zh: '按状态筛选', en: 'Filter by status' },
  badgeStatusAll: { zh: '全部', en: 'All' },
  badgeNoSubjects: {
    zh: '当前筛选下没有可印胸牌的参会人。',
    en: 'No attendees match this filter yet.',
  },
  badgeSubjectsTitle: { zh: '可印名单', en: 'Ready to print' },
  badgePreviewAlt: { zh: '{name} 的胸牌预览', en: 'Badge preview for {name}' },
  badgeCode: { zh: '确认码', en: 'Code' },
  badgeAffiliation: { zh: '单位', en: 'Affiliation' },
  badgeTicket: { zh: '票种', en: 'Ticket' },
  badgeFontNote: {
    zh: '字体已内嵌进渲染结果(自由许可字体),不依赖打印机端字体。',
    en: 'Fonts are embedded in the rendered output (freely licensed), so nothing depends on the printer’s font set.',
  },

  // 现场模式 · 会场屏与实时公告(ch05 §5.2.3)
  screenTitle: { zh: '会场屏', en: 'Venue screen' },
  screenConsoleTitle: { zh: '公告台', en: 'Announcements' },
  screenConsoleLede: {
    zh: '公告经 SSE 秒级推到所有会场屏与公共页,并在 24 小时内对断线重连的屏幕补发。',
    en: 'Announcements reach every venue screen over SSE within seconds, and are replayed for 24 hours to any screen that reconnects.',
  },
  screenOpen: { zh: '打开会场屏', en: 'Open venue screen' },
  screenBackToConsole: { zh: '返回公告台', en: 'Back to announcements' },
  screenNow: { zh: '正在进行', en: 'Now' },
  screenNext: { zh: '下一场', en: 'Next' },
  screenLater: { zh: '稍后', en: 'Later' },
  screenRemaining: { zh: '剩余 {n} 分钟', en: '{n} min left' },
  screenStartsIn: { zh: '{n} 分钟后开始', en: 'starts in {n} min' },
  screenNoCurrent: { zh: '当前没有进行中的场次', en: 'Nothing running right now' },
  screenNoSchedule: { zh: '日程尚未发布', en: 'The programme is not published yet' },
  screenAllRooms: { zh: '全部会场', en: 'All rooms' },
  screenRoom: { zh: '会场', en: 'Room' },
  screenLive: { zh: '实时连接', en: 'Live' },
  screenReconnecting: { zh: '正在重连', en: 'Reconnecting' },
  screenAnnouncements: { zh: '现场公告', en: 'Announcements' },
  screenOffline: { zh: '连接中断', en: 'Disconnected' },
  announcementNew: { zh: '发布公告', en: 'Publish an announcement' },
  announcementText: { zh: '公告正文(中文)', en: 'Announcement (Chinese)' },
  announcementTextEn: { zh: '英文对照(可选)', en: 'English version (optional)' },
  announcementLevel: { zh: '级别', en: 'Level' },
  announcementLevelInfo: { zh: '普通', en: 'Notice' },
  announcementLevelUrgent: { zh: '紧急', en: 'Urgent' },
  announcementRoom: { zh: '限定会场', en: 'Limit to a room' },
  announcementTtl: { zh: '展示时长(分钟)', en: 'Show for (minutes)' },
  announcementPublish: { zh: '立即广播', en: 'Broadcast now' },
  announcementPublished: { zh: '公告已广播,会场屏会在数秒内更新。', en: 'Broadcast sent — screens update within seconds.' },
  announcementActive: { zh: '展示中的公告', en: 'Currently showing' },
  announcementNone: { zh: '暂无公告,会场屏正在显示日程。', en: 'No announcements — screens are showing the programme.' },
  announcementExpiresAt: { zh: '展示至 {t}', en: 'until {t}' },
  announcementTooLong: { zh: '公告不能超过 280 字。', en: 'An announcement cannot exceed 280 characters.' },
  announcementEmpty: { zh: '公告内容不能为空。', en: 'An announcement cannot be empty.' },
} satisfies Record<string, Dict>;

export type TKey = keyof typeof T;

/** 取文案;支持 {name} 占位符插值 */
export function t(locale: Locale, key: TKey, vars?: Record<string, string | number>): string {
  let s: string = T[key][locale];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/** 绑定 locale 的取词器,页面里写 tt('register') 即可 */
export function translator(locale: Locale) {
  return (key: TKey, vars?: Record<string, string | number>) => t(locale, key, vars);
}

/** 内容字段的多语言取值(与字段引擎 I18nString 兼容) */
export function pick(
  value: string | Record<string, string> | null | undefined,
  locale: Locale,
): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return value[locale] ?? value['en'] ?? value['zh'] ?? Object.values(value)[0] ?? '';
}

/** 在当前 URL 上切换语言,保留路径与其他查询参数 */
export function localeHref(pathname: string, search: string, next: Locale): string {
  const params = new URLSearchParams(search);
  params.set('lang', next);
  return `${pathname}?${params.toString()}`;
}

/** 活动内容按语言取值:优先该语言的覆盖,回落到基础字段 */
export function eventContent(
  event: {
    title: string;
    subtitle: string | null;
    description: string | null;
    contentI18n?: Record<string, { title?: string; subtitle?: string; description?: string }> | null;
  },
  locale: Locale,
): { title: string; subtitle: string | null; description: string | null } {
  const o = event.contentI18n?.[locale];
  return {
    title: o?.title ?? event.title,
    subtitle: o?.subtitle ?? event.subtitle,
    description: o?.description ?? event.description,
  };
}
