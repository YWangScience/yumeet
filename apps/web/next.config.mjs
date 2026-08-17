/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@yumeet/db', '@yumeet/core'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  async headers() {
    return [
      {
        // 嵌入套件按设计是被第三方网站跨源加载的(ch10 §10.6):
        // type="module" 的跨源脚本必须带 CORS 头,否则宿主页面直接加载失败。
        source: '/embed.js',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Cross-Origin-Resource-Policy', value: 'cross-origin' },
          { key: 'Cache-Control', value: 'public, max-age=300, stale-while-revalidate=86400' },
          { key: 'Content-Type', value: 'text/javascript; charset=utf-8' },
        ],
      },
      {
        // /embed/* 是给 iframe 用的无壳页面,允许被跨域嵌框;
        // 站点其余部分保持默认的禁嵌框策略。
        source: '/embed/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: 'frame-ancestors *' },
          { key: 'X-Frame-Options', value: 'ALLOWALL' },
        ],
      },
    ];
  },
};

export default nextConfig;
