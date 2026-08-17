'use client';

import { useActionState, useState } from 'react';
import type { FormField } from '@yumeet/core/client';
import { translator, type Locale } from '@/lib/i18n';
import { saveOrSubmitAction } from '@/app/[org]/[event]/cfp/actions';
import type { ActionFeedback } from '@/app/[org]/[event]/cfp/errors';
import styles from './submission-form.module.css';

export interface AuthorDraft {
  name: string;
  email: string;
  affiliation: string;
  isPresenter: boolean;
}

interface Option { id: string; label: string }

interface Props {
  orgSlug: string;
  eventSlug: string;
  locale: Locale;
  /** 已本地化的 track / 类型选项(服务端按当前语言取好,客户端不再处理 I18nString) */
  tracks: Option[];
  types: Option[];
  questions: FormField[];
  abstractMaxLength: number;
  /** 续写草稿时的追踪 token 与初值 */
  token: string | null;
  initial: {
    title: string;
    abstract: string;
    type: string;
    track: string;
    authors: AuthorDraft[];
    answers: Record<string, unknown>;
  };
}

const l10n = (v: FormField['label'], locale: Locale): string =>
  typeof v === 'string' ? v : (v[locale] ?? v['en'] ?? v['zh'] ?? Object.values(v)[0] ?? '');

const emptyAuthor = (): AuthorDraft => ({
  name: '', email: '', affiliation: '', isPresenter: false,
});

/**
 * 投稿表单(ch04 §4.3):标题、摘要、类型、track、作者列表(标注报告人)
 * + CFP 自定义问题(复用 ch09 §9.3 字段引擎)。草稿与提交共用一个 Server Action。
 */
export function SubmissionForm({
  orgSlug, eventSlug, locale, tracks, types, questions, abstractMaxLength, token, initial,
}: Props) {
  const tt = translator(locale);
  const [state, action, pending] = useActionState<ActionFeedback, FormData>(
    saveOrSubmitAction,
    { ok: false },
  );
  const [authors, setAuthors] = useState<AuthorDraft[]>(
    initial.authors.length > 0 ? initial.authors : [{ ...emptyAuthor(), isPresenter: true }],
  );

  const patch = (i: number, key: keyof AuthorDraft, value: string | boolean) =>
    setAuthors((prev) => prev.map((a, j) => (j === i ? { ...a, [key]: value } : a)));

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="__org" value={orgSlug} />
      <input type="hidden" name="__event" value={eventSlug} />
      <input type="hidden" name="__lang" value={locale} />
      {token && <input type="hidden" name="__token" value={token} />}

      {state.errorKey && (
        <p className={styles.formError} role="alert">
          {state.transition
            ? tt('invalidTransition', { from: state.transition.from, to: state.transition.to })
            : tt(state.errorKey)}
        </p>
      )}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{tt('subWork')}</legend>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="sub_title">
            {tt('subTitleField')} <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <input
            id="sub_title" name="title" type="text" required maxLength={300}
            defaultValue={initial.title} className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="sub_abstract">
            {tt('subAbstractField')} <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <textarea
            id="sub_abstract" name="abstract" rows={8} required maxLength={abstractMaxLength}
            defaultValue={initial.abstract} className={styles.textarea}
            aria-describedby="sub_abstract_help"
          />
          <p id="sub_abstract_help" className={styles.help}>
            {tt('subAbstractHelp', { n: abstractMaxLength })}
          </p>
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="sub_type">
              {tt('subTypeField')} <span className={styles.required} aria-hidden="true">*</span>
            </label>
            <select
              id="sub_type" name="type" required className={styles.select}
              defaultValue={initial.type || types[0]?.id || ''}
            >
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="sub_track">
              {tt('subTrackField')} <span className={styles.required} aria-hidden="true">*</span>
            </label>
            <select
              id="sub_track" name="track" required className={styles.select}
              defaultValue={initial.track || tracks[0]?.id || ''}
            >
              {tracks.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{tt('subAuthorsField')}</legend>
        <p className={styles.help}>{tt('subAuthorsHelp')}</p>

        {authors.map((a, i) => (
          <fieldset key={i} className={styles.authorCard}>
            <legend className={styles.authorLegend}>{tt('authorIndex', { n: i + 1 })}</legend>

            <div className={styles.grid2}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`author_name_${i}`}>
                  {tt('authorNameField')} <span className={styles.required} aria-hidden="true">*</span>
                </label>
                <input
                  id={`author_name_${i}`} name={`author_name_${i}`} type="text"
                  required={i === 0} autoComplete="off"
                  className={styles.input} value={a.name}
                  onChange={(e) => patch(i, 'name', e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor={`author_email_${i}`}>
                  {tt('authorEmailField')}
                  {i === 0 && <span className={styles.required} aria-hidden="true"> *</span>}
                </label>
                <input
                  id={`author_email_${i}`} name={`author_email_${i}`} type="email"
                  required={i === 0} className={styles.input} value={a.email}
                  onChange={(e) => patch(i, 'email', e.target.value)}
                />
              </div>
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`author_affiliation_${i}`}>
                {tt('authorAffiliationField')}
              </label>
              <input
                id={`author_affiliation_${i}`} name={`author_affiliation_${i}`} type="text"
                className={styles.input} value={a.affiliation}
                onChange={(e) => patch(i, 'affiliation', e.target.value)}
              />
            </div>

            <div className={styles.authorFoot}>
              <label className={styles.checkLabel} htmlFor={`author_presenter_${i}`}>
                <input
                  id={`author_presenter_${i}`} name={`author_presenter_${i}`} type="checkbox"
                  checked={a.isPresenter}
                  onChange={(e) => patch(i, 'isPresenter', e.target.checked)}
                />
                <span>{tt('authorPresenterField')}</span>
              </label>
              {authors.length > 1 && (
                <button
                  type="button"
                  className={styles.removeAuthor}
                  onClick={() => setAuthors((prev) => prev.filter((_, j) => j !== i))}
                >
                  {tt('removeAuthor', { n: i + 1 })}
                </button>
              )}
            </div>
          </fieldset>
        ))}

        <button
          type="button"
          className={styles.addAuthor}
          onClick={() => setAuthors((prev) => [...prev, emptyAuthor()])}
        >
          {tt('addAuthor')}
        </button>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{tt('subExtra')}</legend>
        {questions.map((q) => {
          const id = `q_${q.key}`;
          const label = l10n(q.label, locale);
          const help = q.help ? l10n(q.help, locale) : null;
          const value = initial.answers[q.key];

          return (
            <div key={q.key} className={styles.field}>
              {q.kind !== 'boolean' && (
                <label className={styles.label} htmlFor={id}>
                  {label}
                  {q.required && <span className={styles.required} aria-hidden="true"> *</span>}
                </label>
              )}

              {q.kind === 'short_text' && (
                <input
                  id={id} name={q.key} type="text" required={q.required}
                  maxLength={q.maxLength} className={styles.input}
                  defaultValue={typeof value === 'string' ? value : ''}
                  aria-describedby={help ? `${id}_help` : undefined}
                />
              )}

              {q.kind === 'long_text' && (
                <textarea
                  id={id} name={q.key} rows={3} required={q.required}
                  maxLength={q.maxLength} className={styles.textarea}
                  defaultValue={typeof value === 'string' ? value : ''}
                  aria-describedby={help ? `${id}_help` : undefined}
                />
              )}

              {q.kind === 'select' && (
                <select
                  id={id} name={q.key} required={q.required} className={styles.select}
                  defaultValue={typeof value === 'string' ? value : ''}
                  aria-describedby={help ? `${id}_help` : undefined}
                >
                  <option value="">{tt('pleaseSelect')}</option>
                  {q.options.map((o) => (
                    <option key={o.value} value={o.value}>{l10n(o.label, locale)}</option>
                  ))}
                </select>
              )}

              {q.kind === 'boolean' && (
                <label className={styles.checkLabel} htmlFor={id}>
                  <input
                    id={id} name={q.key} type="checkbox" required={q.required}
                    defaultChecked={value === true}
                    aria-describedby={help ? `${id}_help` : undefined}
                  />
                  <span>
                    {label}
                    {q.required && <span className={styles.required} aria-hidden="true"> *</span>}
                  </span>
                </label>
              )}

              {help && <p id={`${id}_help`} className={styles.help}>{help}</p>}
            </div>
          );
        })}
      </fieldset>

      <div className={styles.submitRow}>
        <button
          type="submit" name="__intent" value="submit"
          className={styles.submit} disabled={pending}
        >
          {tt('submitAbstract')}
        </button>
        <button
          type="submit" name="__intent" value="draft" formNoValidate
          className={styles.secondary} disabled={pending}
        >
          {pending ? tt('savingDraft') : tt('saveDraft')}
        </button>
        <p className={styles.submitHint}>{tt('subDraftHint')}</p>
      </div>
    </form>
  );
}
