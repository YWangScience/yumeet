'use client';

import { useActionState, useState } from 'react';
import type { PaymentConfig, I18nString } from '@yumeet/core/client';
import styles from './payment-config-form.module.css';

type Method = PaymentConfig['enabled'][number];

const METHODS: { value: Method; label: string; hint: string }[] = [
  { value: 'bank_transfer', label: '银行转账', hint: '对公汇款,需填写完整账户信息' },
  { value: 'alipay', label: '支付宝', hint: '展示收款码,参会者扫码后填参考号' },
  { value: 'wechat', label: '微信支付', hint: '展示收款码,参会者扫码后填参考号' },
  { value: 'onsite', label: '现场支付', hint: '到会场再结算,签到台可一并收款' },
  { value: 'stripe', label: 'Stripe(在线卡支付)', hint: '需先配置 Stripe 插件' },
];

interface Props {
  config: PaymentConfig | null;
  action: (prev: { ok: boolean; error?: string }, fd: FormData)
    => Promise<{ ok: boolean; error?: string }>;
}

/**
 * 收款配置表单。
 *
 * 勾选决定字段的显隐 —— 没启用支付宝就不该让人对着一个空的收款码输入框发呆。
 * 这与报名表的条件字段是同一条规则:只问当下真正需要的东西。
 */
export function PaymentConfigForm({ config, action }: Props) {
  const [state, formAction, pending] = useActionState(action, { ok: false });
  const [enabled, setEnabled] = useState<Set<Method>>(
    new Set(config?.enabled ?? ['bank_transfer']),
  );

  const toggle = (m: Method) => setEnabled((prev) => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  const b = config?.bankTransfer;

  return (
    <form action={formAction} className={styles.form}>
      <fieldset className={styles.methods}>
        <legend className={styles.legend}>启用的付款方式</legend>
        {METHODS.map((m) => (
          <label key={m.value} className={styles.methodRow}>
            <input
              type="checkbox" name="enabled" value={m.value}
              checked={enabled.has(m.value)} onChange={() => toggle(m.value)}
            />
            <span>
              <span className={styles.methodName}>{m.label}</span>
              <span className={styles.methodHint}>{m.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {enabled.has('bank_transfer') && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>银行账户</legend>
          <Field name="bank_accountName" label="户名" defaultValue={b?.accountName} required />
          <Field name="bank_accountNumber" label="账号" defaultValue={b?.accountNumber} required mono />
          <Field name="bank_bankName" label="开户行" defaultValue={b?.bankName} required />
          <Field name="bank_swift" label="SWIFT / BIC" defaultValue={b?.swift} mono />
          <Field name="bank_iban" label="IBAN" defaultValue={b?.iban} mono />
          <I18nField name="bank_memoHint" label="附言提示" value={b?.memoHint}
            placeholder="请在汇款附言中填写参考号" />
          <I18nField name="bank_instructions" label="补充说明" value={b?.instructions} textarea />
        </fieldset>
      )}

      {(['alipay', 'wechat'] as const).map((m) => enabled.has(m) && (
        <fieldset key={m} className={styles.group}>
          <legend className={styles.legend}>{m === 'alipay' ? '支付宝' : '微信支付'}</legend>
          <Field name={`${m}_qrUrl`} label="收款码图片地址" defaultValue={config?.[m]?.qrUrl}
            required placeholder="https://…/qr.png" />
          <Field name={`${m}_payee`} label="收款方名称" defaultValue={config?.[m]?.payee} />
          <I18nField name={`${m}_instructions`} label="说明" value={config?.[m]?.instructions} textarea />
        </fieldset>
      ))}

      {enabled.has('onsite') && (
        <fieldset className={styles.group}>
          <legend className={styles.legend}>现场支付</legend>
          <I18nField name="onsite_accepts" label="现场可用方式" value={config?.onsite?.accepts}
            placeholder="现金、刷卡、支付宝、微信" />
          <I18nField name="onsite_instructions" label="说明" value={config?.onsite?.instructions} textarea />
        </fieldset>
      )}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>通用</legend>
        <I18nField name="offlineDeadlineHint" label="付款期限提示"
          value={config?.offlineDeadlineHint} placeholder="请在会议开始前两周完成付款" />
      </fieldset>

      <div className={styles.footer}>
        <button type="submit" className={styles.save} disabled={pending}>
          {pending ? '保存中…' : '保存收款配置'}
        </button>
        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        {state.ok && !state.error && <p className={styles.ok} role="status">已保存</p>}
      </div>
    </form>
  );
}

function Field({ name, label, defaultValue, required, mono, placeholder }: {
  name: string; label: string; defaultValue?: string;
  required?: boolean; mono?: boolean; placeholder?: string;
}) {
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={name}>
        {label}{required && <span className={styles.req} aria-label="必填"> *</span>}
      </label>
      <input
        id={name} name={name} defaultValue={defaultValue ?? ''} placeholder={placeholder}
        className={mono ? styles.inputMono : styles.input}
        spellCheck={false} autoComplete="off"
      />
    </div>
  );
}

/** I18nString 允许是裸字符串(单语活动的简写),渲染前统一摊成双语两格 */
const pair = (v?: I18nString): { zh: string; en: string } =>
  typeof v === 'string' ? { zh: v, en: v } : { zh: v?.zh ?? '', en: v?.en ?? '' };

function I18nField({ name, label, value, textarea, placeholder }: {
  name: string; label: string;
  value?: I18nString; textarea?: boolean; placeholder?: string;
}) {
  const C = textarea ? 'textarea' : 'input';
  const v = pair(value);
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <div className={styles.i18nRow}>
        {(['zh', 'en'] as const).map((lang) => (
          <span key={lang} className={styles.i18nCell}>
            <label className={styles.langTag} htmlFor={`${name}_${lang}`}>
              {lang === 'zh' ? '中' : 'EN'}
            </label>
            <C
              id={`${name}_${lang}`} name={`${name}_${lang}`}
              defaultValue={v[lang]}
              placeholder={lang === 'zh' ? placeholder : undefined}
              className={styles.input} rows={textarea ? 2 : undefined}
            />
          </span>
        ))}
      </div>
    </div>
  );
}
