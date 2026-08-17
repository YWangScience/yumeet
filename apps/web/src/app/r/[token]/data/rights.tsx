'use client';

/**
 * 数据权利的交互部分:更正(Art. 16)、限制处理与名单退出(Art. 18/21)、删除(Art. 17)。
 * 删除是不可逆操作,因此走 core 的两步 API:先 requestErasure 取确认令牌,
 * 再在本页输入 DELETE 二次确认后 confirmErasure —— 单击不可能删掉任何东西。
 */
import { useActionState, useId, useState } from 'react';
import { translator, type Locale } from '@/lib/i18n';
// 只取类型:Server Actions 由服务端页面以 props 传入,客户端包因此不必打包 core
import type { CorrectionState, PrefsState, ErasureState } from './actions';
import styles from './data.module.css';

export interface EditableField {
  key: string;
  label: string;
  help: string | null;
  kind: string;
  required: boolean;
  pii: boolean;
  specialCategory: boolean;
  options: { value: string; label: string }[];
  value: string | string[];
}

type Action<S> = (prev: S, formData: FormData) => Promise<S>;

interface Props {
  token: string;
  locale: Locale;
  fields: EditableField[];
  correctable: boolean;
  erased: boolean;
  listOptOut: boolean;
  restricted: boolean;
  /** Server Actions(在服务端页面绑定后传入) */
  onCorrect: Action<CorrectionState>;
  onSavePrefs: Action<PrefsState>;
  onRequestErasure: Action<ErasureState>;
  onConfirmErasure: Action<ErasureState>;
}

function inputType(kind: string): string {
  switch (kind) {
    case 'email': return 'email';
    case 'phone': return 'tel';
    case 'url': return 'url';
    case 'number': return 'number';
    case 'date': return 'date';
    default: return 'text';
  }
}

export function DataRightsPanel(props: Props) {
  const { token, locale, fields, correctable, erased } = props;
  const tt = translator(locale);
  const uid = useId();

  const [correction, correctAction, correcting] = useActionState<CorrectionState, FormData>(
    props.onCorrect, { ok: false },
  );
  const [prefs, prefsAction, savingPrefs] = useActionState<PrefsState, FormData>(
    props.onSavePrefs, { ok: false },
  );
  const [erasureRequest, requestAction, requesting] = useActionState<ErasureState, FormData>(
    props.onRequestErasure, { stage: 'idle' },
  );
  const [erasureConfirm, confirmAction, confirming] = useActionState<ErasureState, FormData>(
    props.onConfirmErasure, { stage: 'idle' },
  );

  const [listOptOut, setListOptOut] = useState(props.listOptOut);
  const [restricted, setRestricted] = useState(props.restricted);

  const erasureDone = erasureConfirm.stage === 'done' || erased;
  const inConfirmStep = erasureRequest.stage === 'confirm' && !erasureDone;

  return (
    <>
      {/* Art. 16 更正权 */}
      <section className={styles.card} aria-labelledby={`${uid}-correct`}>
        <h2 className={styles.sectionTitle} id={`${uid}-correct`}>{tt('drCorrectTitle')}</h2>
        <p className={styles.body}>{tt('drCorrectBody')}</p>

        {!correctable || erasureDone ? (
          <p className={styles.notice} role="status">{tt('drCorrectLocked')}</p>
        ) : (
          <form action={correctAction} className={styles.form}>
            <input type="hidden" name="__token" value={token} />
            <input type="hidden" name="__lang" value={locale} />

            {correction.error && (
              <p className={styles.formError} role="alert">{correction.error}</p>
            )}
            {correction.ok && correction.message && (
              <p className={styles.formOk} role="status">{correction.message}</p>
            )}

            {fields.map((f) => {
              const id = `${uid}-f-${f.key}`;
              const helpId = f.help ? `${id}-help` : undefined;
              const value = f.value;

              return (
                <div key={f.key} className={styles.field}>
                  {f.kind === 'boolean' ? (
                    <label className={styles.checkRow} htmlFor={id}>
                      <input
                        id={id} type="checkbox" name={`f_${f.key}`}
                        defaultChecked={value === 'true' || value === (locale === 'zh' ? '是' : 'Yes')}
                        aria-describedby={helpId}
                      />
                      <span>{f.label}</span>
                    </label>
                  ) : (
                    <label className={styles.label} htmlFor={id}>
                      {f.label}
                      {f.required && <span className={styles.required}> *</span>}
                      {f.specialCategory && (
                        <span className={`${styles.tag} ${styles.tagSpecial}`}>{tt('pvCatSpecial')}</span>
                      )}
                      {!f.specialCategory && f.pii && (
                        <span className={`${styles.tag} ${styles.tagPii}`}>{tt('pvCatPii')}</span>
                      )}
                    </label>
                  )}

                  {(f.kind === 'select' || f.kind === 'radio' || f.kind === 'country') && f.options.length > 0 && (
                    <select
                      id={id} name={`f_${f.key}`} className={styles.input}
                      defaultValue={typeof value === 'string' ? value : ''}
                      aria-describedby={helpId}
                    >
                      <option value="">—</option>
                      {f.options.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  )}

                  {f.kind === 'checkbox_group' && (
                    <fieldset className={styles.checkGroup}>
                      <legend className={styles.srOnly}>{f.label}</legend>
                      {f.options.map((o) => (
                        <label key={o.value} className={styles.checkRow} htmlFor={`${id}-${o.value}`}>
                          <input
                            id={`${id}-${o.value}`} type="checkbox"
                            name={`f_${f.key}`} value={o.value}
                            defaultChecked={Array.isArray(value) && value.includes(o.value)}
                          />
                          <span>{o.label}</span>
                        </label>
                      ))}
                    </fieldset>
                  )}

                  {f.kind === 'long_text' && (
                    <textarea
                      id={id} name={`f_${f.key}`} className={styles.textarea} rows={3}
                      defaultValue={typeof value === 'string' ? value : ''}
                      aria-describedby={helpId}
                    />
                  )}

                  {!['select', 'radio', 'country', 'checkbox_group', 'long_text', 'boolean'].includes(f.kind) && (
                    <input
                      id={id} type={inputType(f.kind)} name={`f_${f.key}`} className={styles.input}
                      defaultValue={typeof value === 'string' ? value : ''}
                      aria-describedby={helpId}
                    />
                  )}

                  {f.help && <p id={helpId} className={styles.help}>{f.help}</p>}
                </div>
              );
            })}

            <button type="submit" className={styles.buttonPrimary} disabled={correcting}>
              {correcting ? tt('drSavingAnswers') : tt('drSaveAnswers')}
            </button>
          </form>
        )}
      </section>

      {/* Art. 18 / 21 限制处理与公开展示 */}
      <section className={styles.card} aria-labelledby={`${uid}-prefs`}>
        <h2 className={styles.sectionTitle} id={`${uid}-prefs`}>{tt('drRestrictTitle')}</h2>
        <p className={styles.body}>{tt('drRestrictBody')}</p>

        <form action={prefsAction} className={styles.form}>
          <input type="hidden" name="__token" value={token} />
          <input type="hidden" name="__lang" value={locale} />

          {prefs.error && <p className={styles.formError} role="alert">{prefs.error}</p>}
          {prefs.ok && prefs.message && (
            <p className={styles.formOk} role="status">{prefs.message}</p>
          )}

          <label className={styles.checkRow} htmlFor={`${uid}-list`}>
            <input
              id={`${uid}-list`} type="checkbox" name="listOptOut"
              checked={listOptOut} onChange={(e) => setListOptOut(e.target.checked)}
            />
            <span>{tt('drListOptOut')}</span>
          </label>

          <label className={styles.checkRow} htmlFor={`${uid}-restricted`}>
            <input
              id={`${uid}-restricted`} type="checkbox" name="restricted"
              checked={restricted} onChange={(e) => setRestricted(e.target.checked)}
            />
            <span>{tt('drRestricted')}</span>
          </label>

          <button type="submit" className={styles.buttonSecondary} disabled={savingPrefs}>
            {savingPrefs ? tt('drSavingAnswers') : tt('drSavePrefs')}
          </button>
        </form>
      </section>

      {/* Art. 17 删除权:两步确认 */}
      <section className={styles.dangerCard} aria-labelledby={`${uid}-erase`}>
        <h2 className={styles.sectionTitle} id={`${uid}-erase`}>{tt('drEraseTitle')}</h2>
        <p className={styles.body}>{tt('drEraseBody')}</p>

        {erasureDone ? (
          <p className={styles.notice} role="status">{tt('drErasedTitle')}</p>
        ) : !inConfirmStep ? (
          <form action={requestAction} className={styles.form}>
            <input type="hidden" name="__token" value={token} />
            <input type="hidden" name="__lang" value={locale} />
            {erasureRequest.error && (
              <p className={styles.formError} role="alert">{erasureRequest.error}</p>
            )}
            <p className={styles.stepLabel}>{tt('drEraseStep1')}</p>
            <button type="submit" className={styles.buttonDanger} disabled={requesting}>
              {tt('drEraseRequest')}
            </button>
          </form>
        ) : (
          <form action={confirmAction} className={styles.form}>
            <input type="hidden" name="__token" value={token} />
            <input type="hidden" name="__lang" value={locale} />
            <input type="hidden" name="__confirm" value={erasureRequest.confirmationToken ?? ''} />

            <p className={styles.stepLabel}>{tt('drEraseStep2')}</p>
            <h3 className={styles.subTitle}>{tt('drEraseConfirmTitle')}</h3>

            {erasureConfirm.error && (
              <p className={styles.formError} role="alert">{erasureConfirm.error}</p>
            )}

            {erasureRequest.willClear && erasureRequest.willClear.length > 0 && (
              <p className={styles.body}>
                <strong>{tt('drEraseWillClear')}:</strong>{' '}
                <span className={styles.mono}>{erasureRequest.willClear.join(', ')}</span>
              </p>
            )}
            {erasureRequest.willRetainMasked && erasureRequest.willRetainMasked.length > 0 && (
              <p className={styles.body}>
                <strong>{tt('drEraseWillRetain')}:</strong>{' '}
                <span className={styles.mono}>{erasureRequest.willRetainMasked.join(', ')}</span>
              </p>
            )}
            {erasureRequest.expiresAt && (
              <p className={styles.help}>
                {tt('drEraseExpiresAt', {
                  time: new Date(erasureRequest.expiresAt).toLocaleTimeString(
                    locale === 'zh' ? 'zh-Hans' : 'en-GB',
                    { hour: '2-digit', minute: '2-digit' },
                  ),
                })}
              </p>
            )}

            <div className={styles.field}>
              <label className={styles.label} htmlFor={`${uid}-phrase`}>
                {tt('drEraseTypeLabel')}
              </label>
              <input
                id={`${uid}-phrase`} name="confirmPhrase" className={styles.input}
                autoComplete="off" required pattern="[Dd][Ee][Ll][Ee][Tt][Ee]"
              />
            </div>

            <div className={styles.buttonRow}>
              <button type="submit" className={styles.buttonDanger} disabled={confirming}>
                {tt('drEraseConfirmAction')}
              </button>
              <a className={styles.buttonSecondary} href={`/r/${token}/data`}>
                {tt('drEraseCancel')}
              </a>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
