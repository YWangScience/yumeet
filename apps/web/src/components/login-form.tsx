'use client';

import { useActionState } from 'react';
import { requestMagicLinkAction, type LoginState } from '@/app/auth/actions';
import { translator, type Locale } from '@/lib/i18n';
import styles from './login-form.module.css';

export function LoginForm({ locale, next }: { locale: Locale; next: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(
    requestMagicLinkAction, { ok: false },
  );
  const tt = translator(locale);

  if (state.sent) {
    return (
      <div className={styles.sent} role="status">
        <p className={styles.sentTitle}>{tt('linkSent')}</p>
        <p className={styles.sentBody}>{tt('linkSentBody')}</p>
        {state.devLink && (
          <p className={styles.devHint}>
            <span className={styles.devLabel}>{tt('devOnly')}</span>
            <a href={state.devLink}>{tt('openLinkNow')}</a>
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <input type="hidden" name="next" value={next} />
      {state.error && <p className={styles.error} role="alert">{state.error}</p>}
      <label className={styles.label} htmlFor="email">{tt('email')}</label>
      <input
        id="email" name="email" type="email" required autoComplete="email"
        autoFocus className={styles.input} placeholder="you@example.org"
      />
      <button type="submit" className={styles.submit} disabled={pending}>
        {pending ? tt('sending') : tt('sendLink')}
      </button>
    </form>
  );
}
