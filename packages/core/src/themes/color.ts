/**
 * 主题色彩数学(ch07 §7.2 设计要点)
 *
 * L0 的「主色」是单值配置,系统在服务端派生完整色阶:hover(OKLCH 明度 +4%)、
 * 深色模式变体(提高明度与色度以保证黑底可读)、以及与前景/背景的对比度校验。
 * 对比度不足 4.5:1 时后台直接给出警告与建议值——「默认即合规」在主题层的落点。
 *
 * 本文件是纯函数,无 node: 依赖,可从 '@yumeet/core/client' 引入。
 */

export interface Rgb { r: number; g: number; b: number }   // 0–255
export interface Oklch { l: number; c: number; h: number } // l 0–1,c 0–0.4,h 0–360

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------ *
 * 1. 十六进制 <-> RGB
 * ------------------------------------------------------------------ */

/** 解析 #rgb / #rrggbb(大小写不限)。非法输入返回 null,调用方负责兜底 */
export function parseHex(input: string): Rgb | null {
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const r = s[0]!, g = s[1]!, b = s[2]!;
    return {
      r: parseInt(r + r, 16),
      g: parseInt(g + g, 16),
      b: parseInt(b + b, 16),
    };
  }
  if (/^[0-9a-fA-F]{6}$/.test(s)) {
    return {
      r: parseInt(s.slice(0, 2), 16),
      g: parseInt(s.slice(2, 4), 16),
      b: parseInt(s.slice(4, 6), 16),
    };
  }
  return null;
}

const hex2 = (n: number): string =>
  clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

export function toHex({ r, g, b }: Rgb): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** 判断一个字符串是否为可用于 token 的十六进制色 */
export function isHexColor(v: string): boolean {
  return parseHex(v) !== null;
}

/* ------------------------------------------------------------------ *
 * 2. sRGB <-> OKLab / OKLCH(Björn Ottosson 的系数)
 * ------------------------------------------------------------------ */

const toLinear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const fromLinear = (v: number): number => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
  return clamp(c * 255, 0, 255);
};

export function rgbToOklch(rgb: Rgb): Oklch {
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  const c = Math.sqrt(A * A + B * B);
  const h = c < 1e-6 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
  return { l: L, c, h };
}

export function oklchToRgb({ l, c, h }: Oklch): Rgb {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);

  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s_ = (l - 0.0894841775 * A - 1.2914855480 * B) ** 3;

  return {
    r: fromLinear(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    g: fromLinear(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    b: fromLinear(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_),
  };
}

/** 在 OKLCH 空间调整明度与色度后回到十六进制;超出 sRGB 色域的部分由 clamp 收敛 */
export function adjustOklch(
  hex: string,
  delta: { l?: number; c?: number; h?: number },
): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const lch = rgbToOklch(rgb);
  return toHex(oklchToRgb({
    l: clamp(lch.l + (delta.l ?? 0), 0, 1),
    c: clamp(lch.c * (1 + (delta.c ?? 0)), 0, 0.4),
    h: (lch.h + (delta.h ?? 0) + 360) % 360,
  }));
}

/* ------------------------------------------------------------------ *
 * 3. WCAG 对比度(1.4.3 正文 4.5:1 / 1.4.11 非文字 3:1)
 * ------------------------------------------------------------------ */

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

/** 两色对比度,1–21;任一色不可解析时返回 0(调用方按「未知即不合格」处理) */
export function contrastRatio(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return 0;
  const la = relativeLuminance(ra);
  const lb = relativeLuminance(rb);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** 保留一位小数,用于 UI 展示(4.53 → 4.5) */
export function roundRatio(r: number): number {
  return Math.round(r * 10) / 10;
}

/**
 * 沿 OKLCH 明度轴搜索最接近原色、且对给定底色达到目标对比度的色值。
 * 底色偏亮就压暗,底色偏暗就提亮;色相与色度保持不变,品牌识别度不丢。
 * 找不到(极端色度下有可能)时返回 null,由调用方降级为纯黑/纯白建议。
 */
export function suggestAccessible(
  color: string,
  background: string,
  target = 4.5,
): string | null {
  const rgb = parseHex(color);
  const bg = parseHex(background);
  if (!rgb || !bg) return null;
  if (contrastRatio(color, background) >= target) return color;

  const base = rgbToOklch(rgb);
  const bgLum = relativeLuminance(bg);
  const darken = bgLum > 0.18; // 亮底 → 往深走
  const step = 0.005;

  for (let i = 1; i <= 200; i++) {
    const l = clamp(base.l + (darken ? -1 : 1) * step * i, 0, 1);
    const candidate = toHex(oklchToRgb({ l, c: base.c, h: base.h }));
    if (contrastRatio(candidate, background) >= target) return candidate;
    if (l === 0 || l === 1) break;
  }
  return null;
}

/** 同时满足多个底色的建议值(取最深/最浅的那个,一次改到位) */
export function suggestAccessibleFor(
  color: string,
  backgrounds: string[],
  target = 4.5,
): string | null {
  let current = color;
  for (const bg of backgrounds) {
    const next = suggestAccessible(current, bg, target);
    if (!next) return null;
    current = next;
  }
  return current;
}

/* ------------------------------------------------------------------ *
 * 4. 由单一主色派生完整强调色阶(L0 的「主色」开关)
 * ------------------------------------------------------------------ */

export interface AccentScale {
  /** 浅色模式:填充档(按钮底、选中态) */
  accent: string;
  /** 浅色模式:hover(OKLCH 明度 +4%) */
  accentHover: string;
  /** 浅色模式:文字档——保证在 bg-page 与 bg-section 上均 ≥4.5:1 */
  accentText: string;
  /** 深色模式:提高明度与色度,黑底可读 */
  accentDark: string;
  accentDarkHover: string;
  accentDarkText: string;
}

/**
 * 派生规则见 ch07 §7.2:hover 明度 +4%;深色变体提明度(+0.22)并略提色度;
 * 文字档沿明度轴压到在页面底色与分区底色上都达到 4.5:1。
 */
export function deriveAccentScale(
  accent: string,
  opts: { bgPage?: string; bgSection?: string; bgPageDark?: string } = {},
): AccentScale {
  const bgPage = opts.bgPage ?? '#ffffff';
  const bgSection = opts.bgSection ?? '#f5f5f7';
  const bgPageDark = opts.bgPageDark ?? '#000000';

  const accentHover = adjustOklch(accent, { l: 0.04 });
  const accentText = suggestAccessibleFor(accent, [bgPage, bgSection], 4.5) ?? '#1d1d1f';

  const lch = rgbToOklch(parseHex(accent) ?? { r: 0, g: 113, b: 227 });
  const dark = toHex(oklchToRgb({
    l: clamp(Math.max(lch.l, 0.62) + 0.06, 0, 0.92),
    c: clamp(lch.c * 1.08, 0, 0.4),
    h: lch.h,
  }));
  const accentDark = suggestAccessible(dark, bgPageDark, 4.5) ?? dark;

  return {
    accent,
    accentHover,
    accentText,
    accentDark,
    accentDarkHover: adjustOklch(accentDark, { l: 0.06 }),
    accentDarkText: accentDark,
  };
}

/* ------------------------------------------------------------------ *
 * 5. 对比度守卫(设置页实时校验)
 * ------------------------------------------------------------------ */

export type ContrastLevel = 'pass' | 'fail';

export interface ContrastCheck {
  /** 被检查的底色 token 名,如 --yu-color-bg-page */
  against: string;
  backgroundValue: string;
  ratio: number;
  required: number;
  level: ContrastLevel;
}

export interface ContrastReport {
  color: string;
  checks: ContrastCheck[];
  /** 全部检查通过 */
  ok: boolean;
  /** 未通过时给出的建议色值(同色相、压暗/提亮到达标);无解时为 null */
  suggestion: string | null;
}

/**
 * 校验一个用户自定义色在若干底色上的文字对比度(WCAG 1.4.3 的 4.5:1)。
 * 这是设置页「对比度守卫」的核心:不达标即警告 + 给出可一键采用的建议值。
 */
export function checkContrast(
  color: string,
  backgrounds: { token: string; value: string }[],
  required = 4.5,
): ContrastReport {
  const checks: ContrastCheck[] = backgrounds.map((bg) => {
    const ratio = contrastRatio(color, bg.value);
    return {
      against: bg.token,
      backgroundValue: bg.value,
      ratio: roundRatio(ratio),
      required,
      level: ratio >= required ? 'pass' : 'fail',
    };
  });
  const ok = checks.every((c) => c.level === 'pass');
  return {
    color,
    checks,
    ok,
    suggestion: ok
      ? null
      : suggestAccessibleFor(color, backgrounds.map((b) => b.value), required),
  };
}
