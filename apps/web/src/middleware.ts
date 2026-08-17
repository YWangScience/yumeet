import { NextResponse, type NextRequest } from 'next/server';

/**
 * 域名路由(ch07 §7.6 白标域名)
 * 一个活动可绑定自己的域名,访问根路径直达该活动,URL 中不出现 /org/event 前缀。
 * 生产环境中此映射来自 organizations.customDomain / 活动级绑定;
 * 这里用环境变量声明,避免每个请求打数据库(middleware 跑在 edge 运行时)。
 */
const DOMAIN_MAP: Record<string, { org: string; event: string }> = {
  'mg18.ywang.science': { org: 'icranet', event: 'mg18' },
};

/** 平台主域:显示产品站与组织索引,不做活动改写 */
const PLATFORM_HOSTS = new Set([
  'yumeet.ywang.science',
  'localhost:3210',
  '127.0.0.1:3210',
]);

export function middleware(req: NextRequest) {
  const host = req.headers.get('host')?.toLowerCase() ?? '';
  const bound = DOMAIN_MAP[host];
  const { pathname, search } = req.nextUrl;

  // 静态资源、API、内部路径不改写
  if (
    pathname.startsWith('/api/')
    || pathname.startsWith('/_next/')
    || pathname.startsWith('/embed')
    || pathname === '/embed.js'
    || pathname.startsWith('/r/')
    || pathname.startsWith('/s/')
    || pathname.startsWith('/manage')
    || /\.[a-z0-9]+$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (bound) {
    // 绑定域名:/ → /icranet/mg18,/schedule → /icranet/mg18/schedule
    const target = `/${bound.org}/${bound.event}${pathname === '/' ? '' : pathname}`;
    const url = req.nextUrl.clone();
    url.pathname = target;
    return NextResponse.rewrite(url);
  }

  if (PLATFORM_HOSTS.has(host)) return NextResponse.next();

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
