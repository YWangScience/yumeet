/**
 * Token 合并与 CSS 序列化(ch07 §7.2 / §7.5)
 *
 * 活动页渲染时:主题包的 token(含 extends 链回落)+ events.theme_overrides 合并,
 * 序列化成一段 CSS 自定义属性,由服务端组件以 <style> 直出——
 * 不用客户端 JS 改样式,首屏不闪烁,也不需要 CSP 的 'unsafe-inline' 脚本豁免。
 *
 * 纯函数,无 node: 依赖,可从 '@yumeet/core/client' 引入。
 */
import {
  isValidTokenName, isSafeTokenValue, type TokenMap,
} from './manifest';
import {
  checkContrast, contrastRatio, deriveAccentScale, isHexColor, roundRatio,
  type ContrastReport,
} from './color';
import { resolveThemeOrDefault, type ResolvedTheme } from './registry';

/* ------------------------------------------------------------------ *
 * 1. L1 编辑器暴露的关键 token
 * ------------------------------------------------------------------ */

export const TOKEN_ACCENT = '--yu-color-accent';
export const TOKEN_ACCENT_HOVER = '--yu-color-accent-hover';
export const TOKEN_ACCENT_TEXT = '--yu-color-accent-text';
export const TOKEN_FOCUS_RING = '--yu-color-focus-ring';
export const TOKEN_RADIUS_CONTROL = '--yu-radius-control';
export const TOKEN_RADIUS_CARD = '--yu-radius-card';
export const TOKEN_FONT_BASE = '--yu-font-family-base';
export const TOKEN_BG_PAGE = '--yu-color-bg-page';
export const TOKEN_BG_SECTION = '--yu-color-bg-section';

export type EditableTokenKind = 'color' | 'length' | 'fontStack';

export interface EditableToken {
  token: string;
  kind: EditableTokenKind;
  /** length 类:允许区间(px) */
  min?: number;
  max?: number;
}

/** 设置页可微调的 token —— L1 的最小可用子集(强调色 / 圆角 / 字体栈) */
export const EDITABLE_TOKENS: EditableToken[] = [
  { token: TOKEN_ACCENT, kind: 'color' },
  { token: TOKEN_RADIUS_CONTROL, kind: 'length', min: 0, max: 24 },
  { token: TOKEN_RADIUS_CARD, kind: 'length', min: 0, max: 32 },
  { token: TOKEN_FONT_BASE, kind: 'fontStack' },
];

/** 字体栈预设;label 由 apps/web 的 i18n 按 id 取词,core 只持有值 */
export const FONT_STACK_PRESETS = [
  {
    id: 'system',
    value: 'system-ui, -apple-system, "SF Pro Text", "Segoe UI", "Helvetica Neue", '
      + '"PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: 'serif',
    value: '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Songti SC", '
      + '"Noto Serif CJK SC", serif',
  },
  {
    id: 'grotesk',
    value: 'Inter, "Helvetica Neue", Helvetica, Arial, "PingFang SC", "Microsoft YaHei", '
      + 'sans-serif',
  },
  {
    id: 'mono',
    value: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace',
  },
] as const;

export type FontPresetId = (typeof FONT_STACK_PRESETS)[number]['id'];

const LENGTH_RE = /^\d{1,4}px$/;

/* ------------------------------------------------------------------ *
 * 2. 覆盖值净化 —— 用户输入进入 <style> 前的唯一闸门
 * ------------------------------------------------------------------ */

export interface SanitizeResult {
  tokens: TokenMap;
  /** 被丢弃的键及原因,写审计 diff 用 */
  rejected: { token: string; reason: string }[];
}

/**
 * 只放行:名字合规(--yu-{类别}-…)、值在字符白名单内、且按 token 类型二次校验的条目。
 * 任何 ; { } < > @ : \ / * 都进不来,因此拼进 <style> 不可能逃逸出当前规则块。
 */
export function sanitizeOverrides(input: unknown): SanitizeResult {
  const tokens: TokenMap = {};
  const rejected: { token: string; reason: string }[] = [];
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    return { tokens, rejected };
  }

  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    const key = rawKey.trim();
    if (typeof rawValue !== 'string') {
      rejected.push({ token: key, reason: 'not-a-string' });
      continue;
    }
    const value = rawValue.trim();
    if (!isValidTokenName(key)) {
      rejected.push({ token: key, reason: 'invalid-token-name' });
      continue;
    }
    if (!isSafeTokenValue(value)) {
      rejected.push({ token: key, reason: 'unsafe-value' });
      continue;
    }
    if (key.startsWith('--yu-radius-') && !LENGTH_RE.test(value)) {
      rejected.push({ token: key, reason: 'expected-px-length' });
      continue;
    }
    if (key === TOKEN_ACCENT && !isHexColor(value)) {
      rejected.push({ token: key, reason: 'expected-hex-color' });
      continue;
    }
    tokens[key] = value;
  }
  return { tokens, rejected };
}

/* ------------------------------------------------------------------ *
 * 3. 合并:主题包 token + 组织者覆盖
 * ------------------------------------------------------------------ */

export interface MergedTheme {
  themeId: string;
  theme: ResolvedTheme;
  light: TokenMap;
  dark: TokenMap;
  /** 只包含覆盖项(含派生项),用于展示「相对主题改了什么」 */
  applied: TokenMap;
}

/**
 * 合并规则:
 *  - 非颜色 token(圆角、字体、间距…)同时作用于浅深两套;
 *  - 颜色 token 默认只作用于浅色(深色底另有一套值,盲目套用会毁可读性);
 *  - 唯一例外是强调色:按 §7.2 在 OKLCH 空间派生 hover / 文字档 / 深色变体,
 *    保证组织者只填一个色值就得到一整套合规的强调色阶。
 */
export function mergeThemeTokens(
  themeId: string | null | undefined,
  overrides: unknown,
): MergedTheme {
  const theme = resolveThemeOrDefault(themeId);
  const { tokens: clean } = sanitizeOverrides(overrides);

  const light: TokenMap = { ...theme.light };
  const dark: TokenMap = { ...theme.dark };
  const applied: TokenMap = {};

  for (const [token, value] of Object.entries(clean)) {
    if (token === TOKEN_ACCENT) continue; // 单独派生,见下
    light[token] = value;
    applied[token] = value;
    if (!token.startsWith('--yu-color-')) dark[token] = value;
  }

  const accent = clean[TOKEN_ACCENT];
  if (accent) {
    const scale = deriveAccentScale(accent, {
      bgPage: light[TOKEN_BG_PAGE] ?? '#ffffff',
      bgSection: light[TOKEN_BG_SECTION] ?? '#f5f5f7',
      bgPageDark: dark[TOKEN_BG_PAGE] ?? theme.light[TOKEN_BG_PAGE] ?? '#000000',
    });
    light[TOKEN_ACCENT] = scale.accent;
    light[TOKEN_ACCENT_HOVER] = clean[TOKEN_ACCENT_HOVER] ?? scale.accentHover;
    light[TOKEN_ACCENT_TEXT] = clean[TOKEN_ACCENT_TEXT] ?? scale.accentText;
    light[TOKEN_FOCUS_RING] = scale.accent;
    dark[TOKEN_ACCENT] = scale.accentDark;
    dark[TOKEN_ACCENT_HOVER] = scale.accentDarkHover;
    dark[TOKEN_ACCENT_TEXT] = scale.accentDarkText;
    dark[TOKEN_FOCUS_RING] = scale.accentDark;

    applied[TOKEN_ACCENT] = scale.accent;
    applied[TOKEN_ACCENT_HOVER] = light[TOKEN_ACCENT_HOVER];
    applied[TOKEN_ACCENT_TEXT] = light[TOKEN_ACCENT_TEXT];
  }

  return { themeId: theme.id, theme, light, dark, applied };
}

/* ------------------------------------------------------------------ *
 * 4. 序列化为 CSS
 * ------------------------------------------------------------------ */

function declarations(tokens: TokenMap, indent = '  '): string {
  return Object.entries(tokens)
    .filter(([k, v]) => isValidTokenName(k) && isSafeTokenValue(v))
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n');
}

/**
 * :root:root 是刻意为之的两次同名重复——特指度 0,2,0 高于 globals.css 的 :root,
 * 无论这段 <style> 被 React 放在 head 还是 body,活动主题都稳定压过默认 Cupertino 值。
 * 深浅两个分支与 globals.css 完全同构,主题切换器的行为因此保持一致。
 */
export function themeCssText(merged: Pick<MergedTheme, 'light' | 'dark' | 'theme'>): string {
  const parts: string[] = [];
  const light = declarations(merged.light);
  if (light) parts.push(`:root:root {\n${light}\n}`);

  const mode = merged.theme.darkMode;
  const dark = declarations(merged.dark, '    ');
  if (dark && mode !== 'none' && mode !== 'light') {
    parts.push(
      `@media (prefers-color-scheme: dark) {\n`
      + `  :root:root:not([data-theme="light"]) {\n${dark}\n  }\n}`,
    );
    parts.push(`:root:root[data-theme="dark"] {\n${dark}\n}`);
  }
  return parts.join('\n');
}

/** 活动页一次调用即拿到可直出的 CSS(服务端组件用) */
export function eventThemeCss(
  themeId: string | null | undefined,
  overrides: unknown,
): { themeId: string; css: string; merged: MergedTheme } {
  const merged = mergeThemeTokens(themeId, overrides);
  return { themeId: merged.themeId, css: themeCssText(merged), merged };
}

/* ------------------------------------------------------------------ *
 * 5. 对比度守卫(设置页)
 * ------------------------------------------------------------------ */

export interface AccentAudit {
  /** 强调色本身作为文字,放在浅色页面底上(WCAG 1.4.3 的 4.5:1) */
  light: ContrastReport;
  /** 深色模式下系统派生的强调色,放在深色页面底上 */
  dark: ContrastReport;
  /**
   * 自动派生的「文字档」:小字与链接实际用的是它,按构造在页面底与分区底上都 ≥4.5:1。
   * 展示它是为了说明「即使强调色本身偏浅,正文也不会不达标」。
   */
  textTier: { color: string; ratioOnPage: number; ratioOnSection: number };
  ok: boolean;
}

/**
 * 对比度守卫(ch07 §7.2 设计要点)
 *
 * 判定基准是「强调色 vs 页面底色 ≥ 4.5:1」——组织者填的那个色值会直接出现在链接、
 * 主按钮与选中态上,达不到就是上线后按钮文字看不清。未达标时 report.suggestion 给出
 * 同色相、沿 OKLCH 明度轴压到刚好达标的建议值,后台可一键采用。
 */
export function auditAccent(
  themeId: string | null | undefined,
  accent: string,
): AccentAudit {
  const merged = mergeThemeTokens(themeId, { [TOKEN_ACCENT]: accent });
  const bgPage = merged.light[TOKEN_BG_PAGE] ?? '#ffffff';
  const bgSection = merged.light[TOKEN_BG_SECTION] ?? '#f5f5f7';

  const lightReport = checkContrast(merged.light[TOKEN_ACCENT] ?? accent, [
    { token: TOKEN_BG_PAGE, value: bgPage },
  ]);
  const darkReport = checkContrast(merged.dark[TOKEN_ACCENT] ?? accent, [
    { token: TOKEN_BG_PAGE, value: merged.dark[TOKEN_BG_PAGE] ?? '#000000' },
  ]);

  const tier = merged.light[TOKEN_ACCENT_TEXT] ?? accent;
  return {
    light: lightReport,
    dark: darkReport,
    textTier: {
      color: tier,
      ratioOnPage: roundRatio(contrastRatio(tier, bgPage)),
      ratioOnSection: roundRatio(contrastRatio(tier, bgSection)),
    },
    ok: lightReport.ok && darkReport.ok,
  };
}
