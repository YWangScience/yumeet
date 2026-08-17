/**
 * 角色常量(纯数据,客户端与服务端共用)
 *
 * 单独成文件是因为 services/members.ts 依赖数据库,
 * 而角色名与说明需要在浏览器里渲染下拉与说明表。
 */
export type EventRole =
  | 'organizer' | 'ioc_chair' | 'ioc_member' | 'loc_chair' | 'loc_member'
  | 'session_chair' | 'collaborator' | 'reviewer' | 'volunteer';

export const EVENT_ROLES: EventRole[] = [
  'organizer', 'ioc_chair', 'ioc_member', 'loc_chair', 'loc_member',
  'session_chair', 'collaborator', 'reviewer', 'volunteer',
];

export const ROLE_LABELS: Record<EventRole, { zh: string; en: string; desc: { zh: string; en: string } }> = {
  organizer: {
    zh: '大会管理员', en: 'Organiser',
    desc: { zh: '活动内一切权限,含日程编排与成员管理', en: 'Full control of the event, including scheduling and members' },
  },
  ioc_chair: {
    zh: 'IOC 主席', en: 'IOC Chair',
    desc: { zh: '学术最高权限:录用决议与全局日程编排', en: 'Academic authority: acceptance decisions and full programme' },
  },
  ioc_member: {
    zh: 'IOC 委员', en: 'IOC Member',
    desc: { zh: '参与录用决议,不改日程与注册', en: 'Takes part in decisions; cannot edit programme or registration' },
  },
  loc_chair: {
    zh: 'LOC 主席', en: 'LOC Chair',
    desc: { zh: '事务最高权限:注册、收款、场地与现场', en: 'Operations authority: registration, payments, venue, on-site' },
  },
  loc_member: {
    zh: 'LOC 成员', en: 'LOC Member',
    desc: { zh: '执行层:查看名单与现场签到', en: 'Operations staff: roster and check-in' },
  },
  session_chair: {
    zh: '分会主席', en: 'Session Chair',
    desc: { zh: '只管自己分会:批准报告、排定本分会内顺序', en: 'Own session only: approve talks and order them within the slot' },
  },
  collaborator: {
    zh: '协作者', en: 'Collaborator',
    desc: { zh: '编辑内容,不做决议', en: 'Edits content; makes no decisions' },
  },
  reviewer: {
    zh: '审稿人', en: 'Reviewer',
    desc: { zh: '评审分配给自己的稿件', en: 'Reviews assigned submissions' },
  },
  volunteer: {
    zh: '志愿者', en: 'Volunteer',
    desc: { zh: '仅现场签到', en: 'On-site check-in only' },
  },
};
