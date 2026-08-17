/**
 * JSONB 列绑定的 TypeScript 类型(ch09 §9.2:JSONB 列必须通过 .$type() 绑定类型)。
 * 字段引擎的可辨识联合定义在 @yumeet/core(ch09 §9.3),此处只声明 db 层需要的形状。
 */

export type I18nString = string | Record<string, string>;

export interface Condition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'truthy';
  value?: unknown;
}

/** 15 种 kind 与 ch04 §4.2 字段类型表一一对应 */
export type FormFieldKind =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'date'
  | 'select'
  | 'radio'
  | 'checkbox_group'
  | 'boolean'
  | 'country'
  | 'url'
  | 'file'
  | 'affiliation'
  | 'capacity_option';

export interface FormFieldBase {
  kind: FormFieldKind;
  key: string;
  label: I18nString;
  help?: I18nString;
  required?: boolean;
  pii?: boolean;
  visibleWhen?: Condition;
}

export interface FormFieldOption {
  value: string;
  label: I18nString;
  capacity?: number | null;
  waitlist?: boolean;
}

export interface FormField extends FormFieldBase {
  maxLength?: number;
  min?: number;
  max?: number;
  options?: FormFieldOption[];
  accept?: string[];
  maxSizeMb?: number;
  consent?: { legalTextId: string; version: number };
}

/** 活动内容的单语言版本(ch09 §9.3:内容多语言用 I18nString 约定) */
export interface EventContent {
  title?: string;
  subtitle?: string;
  description?: string;
}

export interface Venue {
  name: string;
  address?: string;
  city?: string;
  country?: string;
  geo?: { lat: number; lng: number };
  online?: { platform?: string; url?: string };
}

/** 渐进披露开关(ch04 §4.1):模块按需开启 */
export interface EventModules {
  registration?: boolean;
  cfp?: boolean;
  schedule?: boolean;
  onsite?: boolean;
  archive?: boolean;
}

export type TokenOverrides = Record<string, string>;

/**
 * 活动的支付方式配置(存 events.settings 或独立配置)。
 * 线下方式需要把「怎么付」讲清楚:账户信息、收款码、以及附言要求。
 */
export interface PaymentConfig {
  /** 启用的方式,按显示顺序 */
  enabled: ('stripe' | 'bank_transfer' | 'alipay' | 'wechat' | 'onsite')[];
  bankTransfer?: {
    accountName: string;
    accountNumber: string;
    bankName: string;
    swift?: string;
    iban?: string;
    /** 附言要求,如「请务必备注参考号」 */
    memoHint?: I18nString;
    instructions?: I18nString;
  };
  alipay?: { qrFileId?: string; qrUrl?: string; payee?: string; instructions?: I18nString };
  wechat?: { qrFileId?: string; qrUrl?: string; payee?: string; instructions?: I18nString };
  onsite?: {
    /** 现场可用的结算方式说明 */
    accepts?: I18nString;
    instructions?: I18nString;
  };
  /** 线下付款的截止说明 */
  offlineDeadlineHint?: I18nString;
}

export interface OrgSettings {
  contactEmail?: string;
  supportUrl?: string;
  embedAllowlist?: string[];
  locale?: string;
}

export interface Author {
  name: string;
  email?: string;
  affiliation?: string;
  isPresenter?: boolean;
  userId?: string;
  orcid?: string;
}

export interface SessionSpeaker {
  name: string;
  affiliation?: string;
  userId?: string;
}

/* ── 插件与自动化(ch13 §13.4–13.5)────────────────────────────── */

/** 插件清单。安装前把它整份展示给管理员:声明了什么权限、要连哪些域名。 */
export interface PluginManifest {
  name: string;
  version: string;
  description?: I18nString;
  /** 注册的 hook 名,与 HOOKS 总表对应 */
  hooks?: string[];
  /** 注册的能力实现,如 payment provider */
  provides?: string[];
  /** 注入的界面位置 */
  uiSlots?: string[];
  /** 裁剪 Plugin API 的权限,与能力表同源 */
  permissions?: string[];
  network?: { allowlist?: string[] };
  /** 配置项的 JSON Schema,后台据此生成表单 */
  configSchema?: Record<string, unknown>;
}

/** JsonLogic 子集:==、!=、>、<、>=、<=、in、and、or、var */
export type RuleCondition = Record<string, unknown>;

/** then 段的一个动作 */
export interface RuleAction {
  type:
    | 'email.send' | 'tag.add' | 'tag.remove' | 'registration.approve'
    | 'waitlist.promote' | 'field.set' | 'webhook.call'
    /** 插件经 rule.action provider 注册的动作 */
    | string;
  /** 动作参数,形状由动作类型决定 */
  params?: Record<string, unknown>;
}
