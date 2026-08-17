/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * 构建期跳过类型检查与 lint:本机内存有限(8G),
   * next build 内联跑 tsc 会 OOM。类型正确性由独立的
   * `pnpm --filter @yumeet/web typecheck` 保证,不是放弃检查。
   */
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  transpilePackages: ['@yumeet/db', '@yumeet/core'],
  /**
   * 胸牌渲染链(ch05 §5.2.2)不能进 webpack 包:
   * @resvg/resvg-js 是原生插件(.node),satori/qrcode 依赖它们自己的运行时资源。
   * 交给 Node 在运行期 require,webpack 只留一个外部引用。
   */
  serverExternalPackages: [
    '@resvg/resvg-js', 'satori', 'qrcode',
    // pnpm 会把原生二进制拆成平台子包,必须一并外部化,
    // 否则 webpack 仍会尝试打包 .node 文件并使整个应用编译失败
    '@resvg/resvg-js-linux-x64-gnu',
    '@resvg/resvg-js-linux-arm64-gnu',
    '@resvg/resvg-js-darwin-x64',
    '@resvg/resvg-js-darwin-arm64',
    '@resvg/resvg-js-win32-x64-msvc',
  ],
  webpack: (config, { isServer }) => {
    // 兜底:任何 .node 原生插件都交给 Node 在运行期 require
    config.externals = config.externals ?? [];
    if (isServer) {
      config.externals.push(({ request }, cb) => {
        if (request && /\.node$|@resvg\/resvg-js/.test(request)) {
          return cb(null, `commonjs ${request}`);
        }
        return cb();
      });
    }
    return config;
  },
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
