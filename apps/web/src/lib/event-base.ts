import { headers } from 'next/headers';

/**
 * 白标域名映射(ch07 §7.6)——必须与 middleware.ts 的 DOMAIN_MAP 保持一致。
 *
 * 绑定域名下 middleware 会把 `/x` 改写为 `/{org}/{event}/x`,
 * 因此页面内的站内链接必须是根相对的 `/x`;若写成 `/{org}/{event}/x`,
 * 会被二次改写成 `/{org}/{event}/{org}/{event}/x` 而 404。
 */
const BOUND_HOSTS = new Set(['mg18.ywang.science', 'mg17.ywang.science']);

/**
 * 取当前请求下该活动的链接前缀。
 * 绑定域名返回空串(链接写 `${base}/speakers` 即 `/speakers`);
 * 平台域名返回 `/{org}/{event}`。
 */
export async function eventBase(orgSlug: string, eventSlug: string): Promise<string> {
  const host = (await headers()).get('host')?.toLowerCase() ?? '';
  return BOUND_HOSTS.has(host) ? '' : `/${orgSlug}/${eventSlug}`;
}

/**
 * 活动首页的链接。绑定域名下 base 是空串,直接用它会拼出 href="",
 * 浏览器会把空 href 当作「当前页」,且 axe 判定为无可辨识文本的链接。
 * 故首页链接单独取:绑定域名下为 '/',平台域名下为 '/{org}/{event}'。
 */
export async function eventHome(orgSlug: string, eventSlug: string): Promise<string> {
  return (await eventBase(orgSlug, eventSlug)) || '/';
}

export async function isBoundHost(): Promise<boolean> {
  const host = (await headers()).get('host')?.toLowerCase() ?? '';
  return BOUND_HOSTS.has(host);
}
