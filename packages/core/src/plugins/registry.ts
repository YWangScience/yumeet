/**
 * 插件 hook 注册表(ch13 §13.4)
 *
 * 四类扩展机制:
 *   filter   —— 可修改数据或否决操作,串行执行,前一个的输出是后一个的输入
 *   action   —— 只做副作用,失败不阻塞主流程
 *   provider —— 注册一种能力的实现(如一种支付方式),同名后注册者覆盖前者
 *   uiSlot   —— 在指定界面位置注入入口
 *
 * 关键约束:**核心功能自己也走这套 API**。Stripe 支付与企业 SSO 是一等插件,
 * 不给核心团队留后门 —— 这是接口不腐化的唯一保证(ch13 §13.4)。
 */

/** hook 总表(ch13 §13.4)。新增 hook 必须同时在此登记,便于插件市场展示。 */
export const HOOKS = {
  'registration.beforeCreate': 'filter',
  'registration.afterCreate': 'action',
  'registration.beforeTransition': 'filter',
  'registration.afterTransition': 'action',
  'submission.beforeCreate': 'filter',
  'submission.afterDecision': 'action',
  'schedule.afterPublish': 'action',
  'payment.beforeCreateOrder': 'filter',
  'payment.afterPaid': 'action',
  'webhook.beforeDispatch': 'filter',
  'email.beforeSend': 'filter',
  'badge.beforeRender': 'filter',
} as const;

export type HookName = keyof typeof HOOKS;
export type HookKind = (typeof HOOKS)[HookName];

export const isHookName = (n: string): n is HookName => n in HOOKS;

export interface HookContext {
  organizationId: string;
  eventId?: string | null;
  /** 注册这个 hook 的插件名,用于日志与失败归因 */
  plugin: string;
}

type FilterFn = (value: unknown, ctx: HookContext) => unknown | Promise<unknown>;
type ActionFn = (value: unknown, ctx: HookContext) => void | Promise<void>;

interface Registration {
  plugin: string;
  priority: number;
  fn: FilterFn | ActionFn;
}

/** 插件否决一次操作时抛它 —— 只有 filter hook 有权否决 */
export class HookVetoError extends Error {
  readonly plugin: string;
  readonly hook: string;
  constructor(plugin: string, hook: string, message: string) {
    super(message);
    this.name = 'HookVetoError';
    this.plugin = plugin;
    this.hook = hook;
  }
}

const hooks = new Map<HookName, Registration[]>();
const providers = new Map<string, { plugin: string; impl: unknown }>();
const uiSlots = new Map<string, { plugin: string; entry: unknown }[]>();

/**
 * 注册一个 hook。priority 小的先跑;
 * 同优先级按注册顺序 —— 顺序必须是确定的,否则同一份数据两次运行结果可能不同。
 */
export function registerHook(
  name: HookName, plugin: string, fn: FilterFn | ActionFn, priority = 10,
): void {
  if (!isHookName(name)) throw new Error(`未知 hook:${name}`);
  const list = hooks.get(name) ?? [];
  list.push({ plugin, priority, fn });
  list.sort((a, b) => a.priority - b.priority);
  hooks.set(name, list);
}

/** 禁用插件时把它的 hook 立即摘除(ch13 §13.4 生命周期第 5 步) */
export function unregisterPlugin(plugin: string): void {
  for (const [name, list] of hooks) {
    hooks.set(name, list.filter((r) => r.plugin !== plugin));
  }
  for (const [key, p] of providers) {
    if (p.plugin === plugin) providers.delete(key);
  }
  for (const [slot, list] of uiSlots) {
    uiSlots.set(slot, list.filter((e) => e.plugin !== plugin));
  }
}

/** 测试与热重载用:清空全部注册 */
export function resetRegistry(): void {
  hooks.clear();
  providers.clear();
  uiSlots.clear();
}

/**
 * 跑 filter 链:前一个的返回值是后一个的入参。
 * 插件返回 undefined 视为「不修改」—— 忘记 return 是最常见的插件 bug,
 * 把它当成「清空数据」会造成难以追查的数据丢失。
 */
export async function applyFilters<T>(
  name: HookName, value: T, ctx: Omit<HookContext, 'plugin'>,
): Promise<T> {
  if (HOOKS[name] !== 'filter') throw new Error(`${name} 不是 filter hook`);
  let cur = value;
  for (const r of hooks.get(name) ?? []) {
    const out = await (r.fn as FilterFn)(cur, { ...ctx, plugin: r.plugin });
    if (out !== undefined) cur = out as T;
  }
  return cur;
}

/**
 * 跑 action 链:**单个插件失败不影响主流程,也不影响其他插件**。
 * action hook 的语义就是「通知」,一个 Slack 通知发不出去
 * 不该让参会者的报名失败。
 */
export async function runActions(
  name: HookName, value: unknown, ctx: Omit<HookContext, 'plugin'>,
): Promise<{ plugin: string; error: string }[]> {
  if (HOOKS[name] !== 'action') throw new Error(`${name} 不是 action hook`);
  const failures: { plugin: string; error: string }[] = [];
  for (const r of hooks.get(name) ?? []) {
    try {
      await (r.fn as ActionFn)(value, { ...ctx, plugin: r.plugin });
    } catch (e) {
      failures.push({ plugin: r.plugin, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return failures;
}

/** provider slot:一种能力一个实现 */
export function registerProvider(key: string, plugin: string, impl: unknown): void {
  providers.set(key, { plugin, impl });
}

export function getProvider<T>(key: string): T | null {
  return (providers.get(key)?.impl as T) ?? null;
}

export function listProviders(): { key: string; plugin: string }[] {
  return [...providers.entries()].map(([key, v]) => ({ key, plugin: v.plugin }));
}

/** UI slot:界面位置注入 */
export function registerUiSlot(slot: string, plugin: string, entry: unknown): void {
  const list = uiSlots.get(slot) ?? [];
  list.push({ plugin, entry });
  uiSlots.set(slot, list);
}

export function getUiSlot(slot: string): { plugin: string; entry: unknown }[] {
  return uiSlots.get(slot) ?? [];
}

/** 后台「已注册的扩展点」一览 */
export function describeRegistry(): {
  hooks: { name: string; kind: HookKind; plugins: string[] }[];
  providers: { key: string; plugin: string }[];
  uiSlots: { slot: string; plugins: string[] }[];
} {
  return {
    hooks: (Object.keys(HOOKS) as HookName[]).map((name) => ({
      name,
      kind: HOOKS[name],
      plugins: (hooks.get(name) ?? []).map((r) => r.plugin),
    })),
    providers: listProviders(),
    uiSlots: [...uiSlots.entries()].map(([slot, list]) => ({
      slot, plugins: list.map((e) => e.plugin),
    })),
  };
}
