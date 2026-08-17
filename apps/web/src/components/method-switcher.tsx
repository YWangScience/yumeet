'use client';

import { useState, useTransition } from 'react';
import styles from './method-switcher.module.css';

interface Props {
  current: string;
  options: { value: string; label: string }[];
  action: (method: string) => Promise<{ ok: boolean; error?: string }>;
  label: string;
}

/**
 * 付款方式切换。
 *
 * 用单选按钮而非下拉:候选通常只有两三个,摊开比藏起来更快,
 * 也让人一眼看到「原来还能微信付」—— 下拉会把这个信息藏掉。
 */
export function MethodSwitcher({ current, options, action, label }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (options.length < 2) return null;

  const pick = (value: string) => {
    if (value === current || pending) return;
    setError(null);
    start(async () => {
      const r = await action(value);
      if (!r.ok) setError(r.error ?? '切换失败');
    });
  };

  return (
    <section className={styles.card}>
      <h2 className={styles.title} id="method-switch-label">{label}</h2>
      <div className={styles.options} role="radiogroup" aria-labelledby="method-switch-label">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === current}
            className={o.value === current ? styles.optionActive : styles.option}
            onClick={() => pick(o.value)}
            disabled={pending}
          >
            {o.label}
          </button>
        ))}
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </section>
  );
}
