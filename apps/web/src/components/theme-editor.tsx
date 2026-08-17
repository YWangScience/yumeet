'use client';

import { useActionState, useMemo, useState } from 'react';
import {
  mergeThemeTokens, auditAccent, contrastRatio, roundRatio, isHexColor,
  FONT_STACK_PRESETS,
  TOKEN_ACCENT, TOKEN_RADIUS_CONTROL, TOKEN_RADIUS_CARD, TOKEN_FONT_BASE,
  TOKEN_BG_PAGE, TOKEN_BG_SECTION,
  type ThemeSummary,
} from '@yumeet/core/client';
import { translator, type Locale, type TKey } from '@/lib/i18n';
import {
  saveEventThemeAction, type DesignActionState,
} from '@/app/manage/[org]/[event]/design/actions';
import { ThemePreview, type PreviewMode } from './theme-preview';
import styles from './theme-editor.module.css';

interface Props {
  orgSlug: string;
  eventSlug: string;
  locale: Locale;
  themes: ThemeSummary[];
  initialThemeId: string;
  initialOverrides: Record<string, string>;
  event: { kicker: string; title: string; subtitle: string | null; meta: string };
}

const FONT_LABEL: Record<string, TKey> = {
  system: 'fontSystem',
  serif: 'fontSerif',
  grotesk: 'fontGrotesk',
  mono: 'fontMono',
};

const BG_LABEL: Record<string, TKey> = {
  [TOKEN_BG_PAGE]: 'contrastBgPage',
  [TOKEN_BG_SECTION]: 'contrastBgSection',
};

const WIDTHS: { px: number; label: TKey }[] = [
  { px: 375, label: 'previewWidthPhone' },
  { px: 768, label: 'previewWidthTablet' },
  { px: 1280, label: 'previewWidthDesktop' },
];

const px = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * L0 + L1 主题编辑器(ch07 §7.5)
 *
 * 状态就是「覆盖表」本身:未被覆盖的 token 实时回落到所选模板包的值,
 * 因此换模板不丢微调(§7.5 第 6 条),也不需要在切换时复制一份默认值进 state。
 * 预览与守卫都由 core 的同一组纯函数算出——后台看到的对比度就是公共页的对比度。
 */
export function ThemeEditor({
  orgSlug, eventSlug, locale, themes, initialThemeId, initialOverrides, event,
}: Props) {
  const tt = translator(locale);

  const [themeId, setThemeId] = useState(initialThemeId);
  const [overrides, setOverrides] = useState<Record<string, string>>(initialOverrides);
  /** 十六进制输入框的中间态(用户敲到一半时不能提交半个色值) */
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [mode, setMode] = useState<PreviewMode>('light');
  const [width, setWidth] = useState<number>(768);

  const [state, formAction, pending] = useActionState<DesignActionState, FormData>(
    saveEventThemeAction,
    { ok: false },
  );

  /** 所选模板包的原始 token(未叠加覆盖),用作各控件的「默认值」 */
  const base = useMemo(() => mergeThemeTokens(themeId, {}).light, [themeId]);
  /** 叠加覆盖后的最终 token —— 预览与公共页用的是同一个函数 */
  const merged = useMemo(() => mergeThemeTokens(themeId, overrides), [themeId, overrides]);

  const set = (token: string, value: string) =>
    setOverrides((prev) => ({ ...prev, [token]: value }));

  const accent = overrides[TOKEN_ACCENT] ?? base[TOKEN_ACCENT] ?? '#0071e3';
  const radiusControl = px(overrides[TOKEN_RADIUS_CONTROL] ?? base[TOKEN_RADIUS_CONTROL], 10);
  const radiusCard = px(overrides[TOKEN_RADIUS_CARD] ?? base[TOKEN_RADIUS_CARD], 18);
  const font = overrides[TOKEN_FONT_BASE] ?? base[TOKEN_FONT_BASE] ?? '';
  const fontMatched = FONT_STACK_PRESETS.some((p) => p.value === font);

  /* ---- 对比度守卫:每次改色即时重算(ch07 §7.2 设计要点) ---- */
  const audit = useMemo(() => auditAccent(themeId, accent), [themeId, accent]);
  const failing = audit.light.checks.filter((c) => c.level === 'fail');
  const minRatio = audit.light.checks.reduce(
    (m, c) => Math.min(m, c.ratio), Number.POSITIVE_INFINITY,
  );
  const suggestion = audit.light.suggestion;
  const suggestionRatio = suggestion
    ? roundRatio(contrastRatio(suggestion, merged.light[TOKEN_BG_PAGE] ?? '#ffffff'))
    : 0;
  const darkAccent = merged.dark[TOKEN_ACCENT] ?? accent;
  const darkRatio = roundRatio(
    contrastRatio(darkAccent, merged.dark[TOKEN_BG_PAGE] ?? '#000000'),
  );

  const applyHex = (value: string) => {
    setHexDraft(value);
    if (isHexColor(value) && value.startsWith('#')) {
      set(TOKEN_ACCENT, value.toLowerCase());
      setHexDraft(null);
    }
  };

  const overrideCount = Object.keys(overrides).length;

  return (
    <div className={styles.layout}>
      <form className={styles.panel} action={formAction}>
        <input type="hidden" name="__org" value={orgSlug} />
        <input type="hidden" name="__event" value={eventSlug} />
        <input type="hidden" name="themeId" value={themeId} />
        <input type="hidden" name="overrides" value={JSON.stringify(overrides)} />

        {/* ---------- 模板包 ---------- */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{tt('themePackage')}</legend>
          <p className={styles.help}>{tt('themePackageHelp')}</p>
          <div className={styles.themeList}>
            {themes.map((th) => (
              <label
                key={th.id}
                className={`${styles.themeCard} ${themeId === th.id ? styles.themeCardOn : ''}`}
              >
                <input
                  type="radio"
                  name="themeChoice"
                  className={styles.radio}
                  value={th.id}
                  checked={themeId === th.id}
                  onChange={() => setThemeId(th.id)}
                />
                <span className={styles.themeBody}>
                  <span className={styles.themeName}>{th.displayName}</span>
                  <span className={styles.themeVersion}>
                    {tt('themeVersion', { v: th.version })}
                    {th.extends ? ` · ${tt('themeInherits', { name: th.extends })}` : ''}
                  </span>
                  <span className={styles.themeDesc}>{th.description}</span>
                  <span className={styles.swatches} aria-hidden="true">
                    {th.swatches.map((s) => (
                      <span
                        key={s.token}
                        className={styles.swatch}
                        style={{ background: s.value }}
                      />
                    ))}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* ---------- 品牌微调 ---------- */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{tt('brandTuning')}</legend>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="yu-accent">{tt('accentColor')}</label>
            <p className={styles.help} id="yu-accent-help">{tt('accentColorHelp')}</p>
            <div className={styles.colorRow}>
              <input
                id="yu-accent"
                type="color"
                className={styles.colorInput}
                value={accent}
                aria-describedby="yu-accent-help"
                onChange={(e) => { set(TOKEN_ACCENT, e.target.value); setHexDraft(null); }}
              />
              <span className={styles.hexField}>
                <label className={styles.labelInline} htmlFor="yu-accent-hex">
                  {tt('accentHex')}
                </label>
                <input
                  id="yu-accent-hex"
                  type="text"
                  className={styles.textInput}
                  inputMode="text"
                  spellCheck={false}
                  value={hexDraft ?? accent}
                  onChange={(e) => applyHex(e.target.value.trim())}
                />
              </span>
            </div>
          </div>

          {/* ---------- 对比度守卫 ---------- */}
          <div
            className={audit.light.ok ? styles.guardOk : styles.guardWarn}
            role="status"
            aria-live="polite"
          >
            <p className={styles.guardTitle}>
              {audit.light.ok ? '✓ ' : '⚠ '}{tt('contrastGuard')}
            </p>
            {audit.light.ok ? (
              <p className={styles.guardBody}>
                {tt('contrastPass', { ratio: minRatio.toFixed(1) })}
              </p>
            ) : (
              <>
                {failing.map((c) => (
                  <p key={c.against} className={styles.guardBody}>
                    {tt('contrastFail', {
                      bg: tt(BG_LABEL[c.against] ?? 'contrastBgPage'),
                      ratio: c.ratio.toFixed(1),
                    })}
                  </p>
                ))}
                {suggestion ? (
                  <>
                    <p className={styles.guardBody}>
                      {tt('contrastSuggestion', {
                        color: suggestion,
                        ratio: suggestionRatio.toFixed(1),
                      })}
                    </p>
                    <button
                      type="button"
                      className={styles.guardApply}
                      onClick={() => { set(TOKEN_ACCENT, suggestion); setHexDraft(null); }}
                    >
                      <span className={styles.guardChip} style={{ background: suggestion }} />
                      {tt('contrastApply')}
                    </button>
                  </>
                ) : (
                  <p className={styles.guardBody}>{tt('contrastNoSuggestion')}</p>
                )}
              </>
            )}
            <p className={styles.guardNote}>
              {tt('contrastTextTier', {
                color: audit.textTier.color,
                page: audit.textTier.ratioOnPage.toFixed(1),
                section: audit.textTier.ratioOnSection.toFixed(1),
              })}
              {' '}
              {tt('contrastDarkNote', { color: darkAccent, ratio: darkRatio.toFixed(1) })}
            </p>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="yu-radius-control">
              {tt('radiusControl')} <span className={styles.value}>{radiusControl}px</span>
            </label>
            <input
              id="yu-radius-control"
              type="range"
              className={styles.range}
              min={0}
              max={24}
              step={1}
              value={radiusControl}
              onChange={(e) => set(TOKEN_RADIUS_CONTROL, `${e.target.value}px`)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="yu-radius-card">
              {tt('radiusCard')} <span className={styles.value}>{radiusCard}px</span>
            </label>
            <input
              id="yu-radius-card"
              type="range"
              className={styles.range}
              min={0}
              max={32}
              step={1}
              value={radiusCard}
              onChange={(e) => set(TOKEN_RADIUS_CARD, `${e.target.value}px`)}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="yu-font">{tt('fontStack')}</label>
            <select
              id="yu-font"
              className={styles.select}
              value={font}
              onChange={(e) => set(TOKEN_FONT_BASE, e.target.value)}
            >
              {!fontMatched && <option value={font}>{font.split(',')[0]}</option>}
              {FONT_STACK_PRESETS.map((p) => (
                <option key={p.id} value={p.value}>
                  {tt(FONT_LABEL[p.id] ?? 'fontSystem')}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        {/* ---------- 保存 ---------- */}
        <div className={styles.actions}>
          <button type="submit" className={styles.save} disabled={pending}>
            {pending ? tt('designSaving') : tt('designSave')}
          </button>
          <button
            type="button"
            className={styles.reset}
            onClick={() => { setOverrides({}); setHexDraft(null); }}
          >
            {tt('designReset')}
          </button>
          <span className={styles.count}>{tt('designOverrideCount', { n: overrideCount })}</span>
        </div>

        <p className={styles.saveStatus} role="status" aria-live="polite">
          {state.ok ? tt('designSaved') : ''}
          {state.ok && (state.rejected ?? 0) > 0
            ? ` ${tt('designRejected', { n: state.rejected ?? 0 })}`
            : ''}
          {!state.ok && state.error ? tt('designFailed') : ''}
        </p>
      </form>

      {/* ---------- 实时预览 ---------- */}
      <aside className={styles.previewPane} aria-labelledby="yu-preview-heading">
        <h2 className={styles.previewHeading} id="yu-preview-heading">{tt('livePreview')}</h2>
        <p className={styles.help}>{tt('previewNote')}</p>

        <div className={styles.toolbar}>
          <fieldset className={styles.toolGroup}>
            <legend className={styles.toolLegend}>{tt('previewAppearance')}</legend>
            {(['light', 'dark'] as const).map((m) => (
              <label key={m} className={`${styles.chip} ${mode === m ? styles.chipOn : ''}`}>
                <input
                  type="radio"
                  name="previewMode"
                  className={styles.radio}
                  checked={mode === m}
                  onChange={() => setMode(m)}
                />
                {m === 'light' ? tt('previewLight') : tt('previewDark')}
              </label>
            ))}
          </fieldset>

          <fieldset className={styles.toolGroup}>
            <legend className={styles.toolLegend}>{tt('previewWidth')}</legend>
            {WIDTHS.map((w) => (
              <label
                key={w.px}
                className={`${styles.chip} ${width === w.px ? styles.chipOn : ''}`}
              >
                <input
                  type="radio"
                  name="previewWidth"
                  className={styles.radio}
                  checked={width === w.px}
                  onChange={() => setWidth(w.px)}
                />
                {tt(w.label)}
              </label>
            ))}
          </fieldset>
        </div>

        <ThemePreview
          tokens={mode === 'dark' ? { ...merged.light, ...merged.dark } : merged.light}
          mode={mode}
          width={width}
          locale={locale}
          event={event}
        />
      </aside>
    </div>
  );
}
