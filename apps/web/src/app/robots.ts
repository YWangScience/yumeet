import type { MetadataRoute } from 'next';

/**
 * 个人页与后台一律禁止索引(ch12 §12.3 隐私默认)。
 * 公共活动页与日程页开放,保留 SEO 价值(ch10 §10.4 JSON-LD 配合)。
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: '*',
      allow: '/',
      disallow: ['/r/', '/s/', '/manage/', '/api/', '/embed/'],
    }],
  };
}
