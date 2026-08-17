import { cookies } from 'next/headers';
import { normalizeLocale, LOCALE_COOKIE, type Locale } from './i18n';

/**
 * 服务端解析当前语言:?lang= 优先,其次 Cookie,再次 Accept-Language,最后默认。
 * 服务端渲染即定,页面不会先中文再闪成英文。
 */
export async function resolveLocale(
  searchParams?: { lang?: string | string[] },
): Promise<Locale> {
  const raw = Array.isArray(searchParams?.lang) ? searchParams?.lang[0] : searchParams?.lang;
  if (raw) return normalizeLocale(raw);

  const jar = await cookies();
  const fromCookie = jar.get(LOCALE_COOKIE)?.value;
  if (fromCookie) return normalizeLocale(fromCookie);

  return normalizeLocale(undefined);
}
