import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { resolveLocale } from '@/lib/locale-server';
import { HTML_LANG } from '@/lib/i18n';

import './globals.css';

export const metadata: Metadata = {
  title: 'yuMeet',
  description: 'yuMeet — Your Universe MEETs',
};

/**
 * lang 属性跟随当前语言(ch08 §8.8):
 * 中英文的断行、标点、字体回退规则不同,lang 错了排版就错。
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await resolveLocale();
  return (
    <html lang={HTML_LANG[locale]}>
      <body>{children}</body>
    </html>
  );
}
