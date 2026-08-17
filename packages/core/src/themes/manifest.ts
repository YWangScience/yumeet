/**
 * 模板包 manifest(ch07 §7.3 theme.json)与 design token 命名规范(ch07 §7.2)
 *
 * 一个模板包是以 theme.json 为清单的目录。两种 kind:
 *  - "tokens":只含 tokens、字体与图片,不含可执行代码,组织管理员可直接上传;
 *  - "code":含 React 组件(slots / components),服务端执行,只能由平台管理员安装。
 *
 * 本文件是纯 Zod 校验 + 类型,可从 '@yumeet/core/client' 引入。
 */
import { z } from 'zod';

/* ------------------------------------------------------------------ *
 * Token 命名规范:--yu-{类别}-{角色}-{变体},全小写、连字符分隔
 * 类别取值固定为八类;语义层禁止出现具体颜色名(如 --yu-color-blue)
 * ------------------------------------------------------------------ */

export const TOKEN_CATEGORIES = [
  'color', 'font', 'text', 'space', 'radius', 'shadow', 'motion', 'z',
] as const;
export type TokenCategory = (typeof TOKEN_CATEGORIES)[number];

export const TOKEN_NAME_RE = new RegExp(
  `^--yu-(${TOKEN_CATEGORIES.join('|')})-[a-z0-9]+(-[a-z0-9]+)*$`,
);

/** 语义层禁用的具体颜色名(原始层可用,但原始层不进 manifest) */
const LITERAL_COLOR_NAMES = [
  'red', 'orange', 'yellow', 'green', 'teal', 'cyan', 'blue', 'indigo',
  'purple', 'pink', 'brown', 'grey', 'gray', 'black', 'white',
];

export function isValidTokenName(name: string): boolean {
  if (!TOKEN_NAME_RE.test(name)) return false;
  if (name.startsWith('--yu-color-')) {
    const role = name.slice('--yu-color-'.length).split('-')[0] ?? '';
    if (LITERAL_COLOR_NAMES.includes(role)) return false;
  }
  return true;
}

export const tokenNameSchema = z.string().refine(isValidTokenName, {
  message: '不符合 token 命名规范 --yu-{color|font|text|space|radius|shadow|motion|z}-{角色}-{变体}',
});

/**
 * Token 值白名单。token 值最终会被拼进 <style>,必须能安全序列化:
 * 禁止 ; { } < > @ : \ / * 与反引号,从而排除规则逃逸、url()、@import 与注释注入。
 */
export const TOKEN_VALUE_RE = /^[a-zA-Z0-9#(),.%\-_\s"']{1,200}$/;

export function isSafeTokenValue(value: string): boolean {
  return TOKEN_VALUE_RE.test(value);
}

export const tokenValueSchema = z.string().refine(isSafeTokenValue, {
  message: 'token 值含不允许的字符(禁止 ; { } < > @ : \\ / *)',
});

export const tokenMapSchema = z.record(tokenNameSchema, tokenValueSchema);
export type TokenMap = Record<string, string>;

/* ------------------------------------------------------------------ *
 * manifest 各字段
 * ------------------------------------------------------------------ */

/**
 * 可本地化字符串:纯字符串或 { zh, en, … }。
 * 取值一律用字段引擎已有的 localize()(ch09 §9.3),不另造一份多语言解析。
 */
export const i18nStringSchema = z.union([z.string(), z.record(z.string(), z.string())]);

export const themeFontSchema = z.object({
  family: z.string(),
  src: z.string(),
  weight: z.string().optional(),
  style: z.string().optional(),
  display: z.enum(['auto', 'block', 'swap', 'fallback', 'optional']).default('swap'),
});

export const themeSettingSchema = z.object({
  key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
  type: z.enum(['select', 'boolean', 'color', 'text', 'number']),
  label: i18nStringSchema,
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.boolean(), z.number()]).optional(),
});
export type ThemeSetting = z.infer<typeof themeSettingSchema>;

/** 核心 slot 名(ch07 §7.3 表);未列出的 slot 名一律拒绝,避免主题包挂到非公开挂点 */
export const CORE_SLOTS = [
  'site.header', 'site.footer',
  'event.hero', 'event.about', 'event.speakers', 'event.venue',
  'schedule.timeline', 'schedule.session-card',
  'registration.intro', 'registration.confirmation',
] as const;
export type CoreSlot = (typeof CORE_SLOTS)[number];

/**
 * tokens 字段的两种写法:
 *  - 字符串:相对路径的 tokens.css(L2 代码包按 §7.3 的原样写法);
 *  - 对象:内联 token map,分浅深两套。内置包与 L1 上传包用这种,
 *    因为服务端要把它与 events.theme_overrides 合并后注入,必须能读到值本身。
 */
export const inlineTokensSchema = z.object({
  light: tokenMapSchema,
  dark: tokenMapSchema.optional(),
});

export const themeManifestSchema = z.object({
  $schema: z.string().optional(),
  /** npm 包名 */
  name: z.string().min(1),
  /** 短 id,写入 events.theme_id */
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  displayName: i18nStringSchema,
  description: i18nStringSchema.optional(),
  version: z.string().regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/),
  license: z.string().optional(),
  kind: z.enum(['tokens', 'code']),
  engines: z.object({ yumeet: z.string() }),
  /** 继承链:未覆盖的 token 与 slot 自动回落到父主题 */
  extends: z.string().optional(),
  darkMode: z.enum(['auto', 'light', 'dark', 'none']).default('auto'),
  tokens: z.union([z.string(), inlineTokensSchema]),
  assets: z.string().optional(),
  preview: z.string().optional(),
  fonts: z.array(themeFontSchema).optional(),
  slots: z.record(z.string(), z.string())
    .refine(
      (m) => Object.keys(m).every((k) => (CORE_SLOTS as readonly string[]).includes(k)),
      { message: `slot 名必须取自核心 slot 表:${CORE_SLOTS.join(', ')}` },
    )
    .optional(),
  components: z.record(z.string(), z.string()).optional(),
  settings: z.array(themeSettingSchema).optional(),
});

export type ThemeManifest = z.infer<typeof themeManifestSchema>;

export class ThemeManifestError extends Error {
  constructor(public readonly issues: string[], source?: string) {
    super(`theme.json 校验失败${source ? `(${source})` : ''}:\n- ${issues.join('\n- ')}`);
    this.name = 'ThemeManifestError';
  }
}

/** 校验一份 theme.json;失败抛 ThemeManifestError,附全部问题 */
export function parseThemeManifest(input: unknown, source?: string): ThemeManifest {
  const result = themeManifestSchema.safeParse(input);
  if (!result.success) {
    throw new ThemeManifestError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
      source,
    );
  }
  const manifest = result.data;
  // kind: "tokens" 不得携带可执行代码——这是「组织管理员可直接上传」的安全前提
  if (manifest.kind === 'tokens' && (manifest.slots || manifest.components)) {
    throw new ThemeManifestError(
      ['kind 为 "tokens" 的主题包不得声明 slots 或 components(不含可执行代码是其上传前提)'],
      source,
    );
  }
  return manifest;
}

/** 非抛出版本,给上传流程做表单校验 */
export function safeParseThemeManifest(
  input: unknown,
): { ok: true; manifest: ThemeManifest } | { ok: false; issues: string[] } {
  try {
    return { ok: true, manifest: parseThemeManifest(input) };
  } catch (e) {
    if (e instanceof ThemeManifestError) return { ok: false, issues: e.issues };
    throw e;
  }
}
