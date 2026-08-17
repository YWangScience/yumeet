/**
 * 内置模板包注册表与继承链解析(ch07 §7.3)
 *
 * 解析顺序(编号即优先级):1. 当前主题自身;2. extends 链逐级向上;3. Cupertino 内置默认。
 * token 与 slot 都按这条链回落——主题作者只写差异,yuMeet 升级基线时继承者自动跟上。
 */
import cupertinoJson from '../../../../themes/cupertino/theme.json';
import classicJson from '../../../../themes/classic/theme.json';
import { localize } from '../forms/types';
import {
  parseThemeManifest,
  type ThemeManifest, type ThemeSetting, type TokenMap,
} from './manifest';

/** 内置主题的 id —— events.theme_id 的默认值 */
export const DEFAULT_THEME_ID = 'cupertino';

const BUILTIN_SOURCES: { source: string; raw: unknown }[] = [
  { source: 'themes/cupertino/theme.json', raw: cupertinoJson },
  { source: 'themes/classic/theme.json', raw: classicJson },
];

/** id → manifest。模块加载即校验,manifest 写错在启动时就炸,而不是等用户访问 */
const REGISTRY: Map<string, ThemeManifest> = new Map(
  BUILTIN_SOURCES.map(({ source, raw }) => {
    const m = parseThemeManifest(raw, source);
    return [m.id, m] as const;
  }),
);

/** npm 包名 → id,供 extends 解析 */
const BY_PACKAGE_NAME: Map<string, string> = new Map(
  [...REGISTRY.values()].map((m) => [m.name, m.id] as const),
);

export function getThemeManifest(id: string): ThemeManifest | null {
  return REGISTRY.get(id) ?? null;
}

export function listThemeIds(): string[] {
  return [...REGISTRY.keys()];
}

export class UnknownThemeError extends Error {
  constructor(public readonly themeId: string) {
    super(`未安装的主题:${themeId}`);
    this.name = 'UnknownThemeError';
  }
}

export interface ResolvedTheme {
  id: string;
  manifest: ThemeManifest;
  /** 继承链自身在前(如 ['classic', 'cupertino']) */
  chain: string[];
  light: TokenMap;
  dark: TokenMap;
  darkMode: ThemeManifest['darkMode'];
  settings: ThemeSetting[];
  slots: Record<string, string>;
}

function inlineTokens(m: ThemeManifest): { light: TokenMap; dark: TokenMap } {
  // tokens 为字符串时是 L2 代码包的 tokens.css 相对路径:样式由包自带的 CSS 提供,
  // 服务端合并注入拿不到值,这里按空 map 处理(继承链上的内联值仍然生效)。
  if (typeof m.tokens === 'string') return { light: {}, dark: {} };
  return { light: m.tokens.light, dark: m.tokens.dark ?? {} };
}

/** 沿 extends 链自顶向下合并,子主题覆盖父主题 */
export function resolveTheme(themeId: string): ResolvedTheme {
  const manifest = REGISTRY.get(themeId);
  if (!manifest) throw new UnknownThemeError(themeId);

  // 从自身向上收集,避免环
  const chain: ThemeManifest[] = [];
  const seen = new Set<string>();
  let cursor: ThemeManifest | undefined = manifest;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.push(cursor);
    const parentId: string | undefined = cursor.extends
      ? BY_PACKAGE_NAME.get(cursor.extends) ?? cursor.extends
      : undefined;
    cursor = parentId ? REGISTRY.get(parentId) : undefined;
  }

  // 自顶(最远的祖先)向下合并
  const light: TokenMap = {};
  const dark: TokenMap = {};
  const settings = new Map<string, ThemeSetting>();
  const slots: Record<string, string> = {};

  for (let i = chain.length - 1; i >= 0; i--) {
    const m = chain[i];
    if (!m) continue;
    const t = inlineTokens(m);
    Object.assign(light, t.light);
    Object.assign(dark, t.dark);
    for (const s of m.settings ?? []) settings.set(s.key, s);
    Object.assign(slots, m.slots ?? {});
  }

  return {
    id: manifest.id,
    manifest,
    chain: chain.map((m) => m.id),
    light,
    dark,
    darkMode: manifest.darkMode,
    settings: [...settings.values()],
    slots,
  };
}

/** 未知 id 时回落到默认主题,公共页永远渲染得出来 */
export function resolveThemeOrDefault(themeId: string | null | undefined): ResolvedTheme {
  if (themeId) {
    try {
      return resolveTheme(themeId);
    } catch {
      /* 主题被卸载:回落默认,不让活动页 500 */
    }
  }
  return resolveTheme(DEFAULT_THEME_ID);
}

export interface ThemeSummary {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  kind: ThemeManifest['kind'];
  darkMode: ThemeManifest['darkMode'];
  extends: string | null;
  /** 选择器上的预览色板:页面底 / 分区底 / 强调 / 正文 */
  swatches: { token: string; value: string }[];
  fontFamily: string;
  radiusCard: string;
}

const SWATCH_TOKENS = [
  '--yu-color-bg-page',
  '--yu-color-bg-section',
  '--yu-color-accent',
  '--yu-color-text-primary',
] as const;

export function summarizeTheme(themeId: string, locale = 'zh'): ThemeSummary {
  const r = resolveTheme(themeId);
  return {
    id: r.id,
    name: r.manifest.name,
    displayName: localize(r.manifest.displayName, locale),
    description: r.manifest.description ? localize(r.manifest.description, locale) : '',
    version: r.manifest.version,
    kind: r.manifest.kind,
    darkMode: r.darkMode,
    extends: r.manifest.extends ?? null,
    swatches: SWATCH_TOKENS.map((token) => ({ token, value: r.light[token] ?? '#ffffff' })),
    fontFamily: r.light['--yu-font-family-base'] ?? 'system-ui, sans-serif',
    radiusCard: r.light['--yu-radius-card'] ?? '0px',
  };
}

/** 设置页主题选择器的数据源 */
export function listThemes(locale = 'zh'): ThemeSummary[] {
  return listThemeIds().map((id) => summarizeTheme(id, locale));
}
