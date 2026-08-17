'use client';

import { useActionState, useState } from 'react';
import type { FormField } from '@yumeet/core/client';
import { translator, type Locale } from '@/lib/i18n';
import { submitRegistrationAction, type ActionState } from
  '@/app/[org]/[event]/register/actions';
import { formatMoney } from '@/lib/format';
import styles from './register-form.module.css';

interface TicketOption {
  publicId: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  remaining: number | null;
}

interface Props {
  orgSlug: string;
  eventSlug: string;
  formId: string;
  fields: FormField[];
  tickets: TicketOption[];
  locale: Locale;
}

const l10n = (v: FormField['label'], locale: Locale): string =>
  typeof v === 'string' ? v : (v[locale] ?? v['en'] ?? v['zh'] ?? Object.values(v)[0] ?? '');

/** 条件逻辑求值(与服务端 isFieldVisible 同一份定义,ch09 §9.3) */
function visible(f: FormField, answers: Record<string, unknown>): boolean {
  const c = f.visibleWhen;
  if (!c) return true;
  const actual = answers[c.field];
  switch (c.op) {
    case 'eq': return actual === c.value;
    case 'neq': return actual !== c.value;
    case 'in': return Array.isArray(c.value) && c.value.includes(actual);
    case 'truthy': return Boolean(actual);
    default: return true;
  }
}

export function RegisterForm({ orgSlug, eventSlug, formId, fields, tickets, locale }: Props) {
  const tt = translator(locale);
  const [state, action, pending] = useActionState<ActionState, FormData>(
    submitRegistrationAction,
    { ok: false },
  );
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [ticketId, setTicketId] = useState<string>(tickets[0]?.publicId ?? '');

  const set = (key: string, value: unknown) =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="__org" value={orgSlug} />
      <input type="hidden" name="__event" value={eventSlug} />
      <input type="hidden" name="__formId" value={formId} />
      <input type="hidden" name="__ticketId" value={ticketId} />

      {state.error && (
        <p className={styles.formError} role="alert">{state.error}</p>
      )}

      {tickets.length > 0 && (
        <fieldset className={styles.fieldset}>
          <legend className={styles.legend}>{tt('selectTicket')}</legend>
          <div className={styles.ticketGrid}>
            {tickets.map((t) => (
              <label
                key={t.publicId}
                className={`${styles.ticketOption} ${ticketId === t.publicId ? styles.ticketActive : ''}`}
              >
                <input
                  type="radio"
                  name="__ticketRadio"
                  value={t.publicId}
                  checked={ticketId === t.publicId}
                  onChange={() => setTicketId(t.publicId)}
                  className={styles.srOnly}
                />
                <span className={styles.ticketHead}>
                  <span className={styles.ticketName}>{t.name}</span>
                  <span className={styles.ticketPrice}>
                    {formatMoney(t.priceCents, t.currency)}
                  </span>
                </span>
                {t.description && <span className={styles.ticketDesc}>{t.description}</span>}
                {t.remaining != null && t.remaining <= 30 && (
                  <span className={styles.ticketLow}>{tt('onlyLeft', { n: t.remaining })}</span>
                )}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>{tt('attendeeInfo')}</legend>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="email">
            {tt('email')} <span className={styles.required} aria-hidden="true">*</span>
          </label>
          <input
            id="email" name="email" type="email" required autoComplete="email"
            className={styles.input}
            aria-describedby="email-help"
          />
          <p id="email-help" className={styles.help}>
            {tt('emailHelp')}
          </p>
        </div>

        {fields.filter((f) => f.key !== 'email').map((f) => {
          if (!visible(f, answers)) return null;
          const id = `f_${f.key}`;
          const label = l10n(f.label, locale);
          const help = f.help ? l10n(f.help, locale) : null;

          return (
            <div key={f.key} className={styles.field}>
              {f.kind !== 'boolean' && (
                <label className={styles.label} htmlFor={id}>
                  {label}
                  {f.required && <span className={styles.required} aria-hidden="true"> *</span>}
                </label>
              )}

              {(f.kind === 'short_text' || f.kind === 'affiliation') && (
                <input id={id} name={f.key} type="text" required={f.required}
                  className={styles.input}
                  onChange={(e) => set(f.key, e.target.value)} />
              )}

              {f.kind === 'long_text' && (
                <textarea id={id} name={f.key} rows={3} required={f.required}
                  className={styles.textarea}
                  onChange={(e) => set(f.key, e.target.value)} />
              )}

              {f.kind === 'phone' && (
                <input id={id} name={f.key} type="tel" required={f.required}
                  placeholder="+852 …" className={styles.input}
                  onChange={(e) => set(f.key, e.target.value)} />
              )}

              {f.kind === 'url' && (
                <input id={id} name={f.key} type="url" required={f.required}
                  className={styles.input} onChange={(e) => set(f.key, e.target.value)} />
              )}

              {f.kind === 'number' && (
                <input id={id} name={f.key} type="number" required={f.required}
                  className={styles.input} onChange={(e) => set(f.key, e.target.value)} />
              )}

              {f.kind === 'date' && (
                <input id={id} name={f.key} type="date" required={f.required}
                  className={styles.input} onChange={(e) => set(f.key, e.target.value)} />
              )}

              {f.kind === 'country' && (
                <select id={id} name={f.key} required={f.required} className={styles.select}
                  defaultValue="" onChange={(e) => set(f.key, e.target.value)}>
                  <option value="" disabled>{tt('pleaseSelect')}</option>
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>{locale === 'zh' ? c.name : c.nameEn}</option>
                  ))}
                </select>
              )}

              {(f.kind === 'select' || f.kind === 'capacity_option') && (
                <select id={id} name={f.key} required={f.required} className={styles.select}
                  defaultValue="" onChange={(e) => set(f.key, e.target.value)}>
                  <option value="" disabled>{tt('pleaseSelect')}</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {l10n(o.label, locale)}
                      {'capacity' in o && o.capacity != null
                        ? ` (${tt('capacityLimit', { n: o.capacity })})` : ''}
                    </option>
                  ))}
                </select>
              )}

              {f.kind === 'radio' && (
                <div className={styles.radioGroup} role="radiogroup" aria-labelledby={id}>
                  {f.options.map((o) => (
                    <label key={o.value} className={styles.checkLabel}>
                      <input type="radio" name={f.key} value={o.value} required={f.required}
                        onChange={(e) => set(f.key, e.target.value)} />
                      <span>{l10n(o.label, locale)}</span>
                    </label>
                  ))}
                </div>
              )}

              {f.kind === 'checkbox_group' && (
                <div className={styles.checkGroup}>
                  {f.options.map((o) => (
                    <label key={o.value} className={styles.checkLabel}>
                      <input type="checkbox" name={f.key} value={o.value} />
                      <span>{l10n(o.label, locale)}</span>
                    </label>
                  ))}
                </div>
              )}

              {f.kind === 'boolean' && (
                <label className={styles.consentLabel} htmlFor={id}>
                  <input id={id} name={f.key} type="checkbox" required={f.required}
                    onChange={(e) => set(f.key, e.target.checked)} />
                  <span>
                    {label}
                    {f.required && <span className={styles.required} aria-hidden="true"> *</span>}
                  </span>
                </label>
              )}

              {help && <p className={styles.help}>{help}</p>}
            </div>
          );
        })}
      </fieldset>

      <div className={styles.submitRow}>
        <button type="submit" className={styles.submit} disabled={pending}>
          {pending ? tt('submitting') : tt('submit')}
        </button>
        <p className={styles.submitHint}>
          {tt('submitHint')}
        </p>
      </div>
    </form>
  );
}

const COUNTRIES = [
  { code: 'HK', name: '中国香港', nameEn: 'Hong Kong SAR' }, { code: 'CN', name: '中国内地', nameEn: 'Chinese mainland' },
  { code: 'TW', name: '中国台湾', nameEn: 'Taiwan' }, { code: 'MO', name: '中国澳门', nameEn: 'Macao SAR' },
  { code: 'JP', name: '日本', nameEn: 'Japan' }, { code: 'KR', name: '韩国', nameEn: 'Korea' },
  { code: 'SG', name: '新加坡', nameEn: 'Singapore' }, { code: 'IN', name: '印度', nameEn: 'India' },
  { code: 'AU', name: '澳大利亚', nameEn: 'Australia' }, { code: 'US', name: '美国', nameEn: 'United States' },
  { code: 'CA', name: '加拿大', nameEn: 'Canada' }, { code: 'GB', name: '英国', nameEn: 'United Kingdom' },
  { code: 'DE', name: '德国', nameEn: 'Germany' }, { code: 'FR', name: '法国', nameEn: 'France' },
  { code: 'IT', name: '意大利', nameEn: 'Italy' }, { code: 'ES', name: '西班牙', nameEn: 'Spain' },
  { code: 'NL', name: '荷兰', nameEn: 'Netherlands' }, { code: 'CH', name: '瑞士', nameEn: 'Switzerland' },
  { code: 'RU', name: '俄罗斯', nameEn: 'Russia' }, { code: 'BR', name: '巴西', nameEn: 'Brazil' },
  { code: 'ZA', name: '南非', nameEn: 'South Africa' }, { code: 'OT', name: '其他', nameEn: 'Other' },
];
