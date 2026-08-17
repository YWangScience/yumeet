'use client';

import { useTransition } from 'react';
import { signOutAction } from '@/app/auth/actions';
import styles from './sign-out-button.module.css';

export function SignOutButton({ label }: { label: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={styles.btn}
      disabled={pending}
      onClick={() => start(() => { void signOutAction(); })}
    >
      {label}
    </button>
  );
}
