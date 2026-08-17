/**
 * safeFetch —— yuMeet 唯一的出站 HTTP broker(ch12 §12.1 防御二)。
 *
 * Indico 的教训是「服务器按用户给的 URL 去抓东西」变成了内网探针。yuMeet 把所有
 * 出站请求(webhook 投递、外部日历抓取、OIDC discovery、封面图代理)收敛到这一个
 * 函数,业务模块不得直接 import undici / 调用全局 fetch。单点可以被穷尽测试,
 * 散落各处的 if 不能。
 *
 * 防御链(每一跳重定向都完整走一遍):
 *   1. 协议白名单 —— 默认仅 https:(file:/gopher:/ftp: 一律拒);
 *   2. 端口白名单 —— 默认仅 80/443,堵掉 6379/5432/9000 这类内网服务端口;
 *   3. 主机名形态检查 —— 拒绝 .local/.internal 等内部后缀与裸主机名;
 *   4. DNS 全量解析 —— A 与 AAAA 全部取出,任一落在私有 / 环回 / 链路本地 /
 *      保留网段即整体拒绝(而不是「挑一个能用的」);
 *   5. **DNS 重绑定防护** —— 校验通过后不再让 socket 自己去解析,而是把第 4 步
 *      拿到的 IP 通过 net.connect 的 lookup 钩子钉死。校验用的 IP 与连接用的 IP
 *      是同一个,中间没有第二次 DNS 查询可供攻击者掉包(TOCTOU)。TLS 的
 *      servername 与 HTTP 的 Host 头仍是原始主机名,证书校验不受影响;
 *   6. 重定向逐跳重新校验 —— 不使用 http 模块的自动跟随,Location 解析出的新 URL
 *      从第 1 步重走,次数上限 maxRedirects;
 *   7. 超时与响应体上限 —— 连接 / 首字节 / 整体三重超时,响应体超限即断流。
 *
 * 代码之外还有第二道闸:出站请求全部由 worker 容器执行,部署文档要求在防火墙层
 * 封禁 worker 到内网段与元数据地址的 egress(ch12 §12.1)。
 */
import http from 'node:http';
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { Buffer } from 'node:buffer';
import { classifyAddress, type BlockedRange } from './ip';

export type SsrfReason =
  | 'invalid-url' | 'scheme' | 'port' | 'hostname' | 'dns' | 'private-ip'
  | 'too-many-redirects' | 'redirect-target' | 'response-too-large' | 'timeout';

/** 出站被拒绝 / 失败的统一错误类型;reason 可直接进日志与 webhook 死信记录 */
export class SsrfError extends Error {
  readonly reason: SsrfReason;
  readonly detail: string | undefined;
  constructor(reason: SsrfReason, message: string, detail?: string) {
    super(message);
    this.name = 'SsrfError';
    this.reason = reason;
    this.detail = detail;
  }
}

/** 可注入的 DNS 解析器(单元测试用;生产走 node:dns 的 lookup,含 /etc/hosts) */
export type AddressResolver = (hostname: string) => Promise<string[]>;

export interface SafeFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
  /** 整体截止时间(含全部重定向),默认 10s */
  timeoutMs?: number;
  /** 等待响应头的时间,默认 5s(ch12 §12.1 headersTimeout) */
  headersTimeoutMs?: number;
  /** 最多跟随几跳重定向,默认 3;每跳重新走完整校验 */
  maxRedirects?: number;
  /** 响应体上限,默认 5 MiB;超限断流并抛 response-too-large */
  maxResponseBytes?: number;
  /** 协议白名单,默认 ['https:'] */
  allowedProtocols?: readonly string[];
  /** 端口白名单,默认 [80, 443] */
  allowedPorts?: readonly number[];
  /**
   * 仅开发环境:允许连到私有 / 环回地址。
   * 生产永远不要打开 —— 打开即等于关掉 ch12 §12.1 的防御二。
   * 由 YUMEET_NET_ALLOW_PRIVATE=1 显式开启,便于本地起 HTTP server 做端到端联调。
   */
  allowPrivateAddresses?: boolean;
  /** 注入解析器(测试);不传则用 node:dns */
  resolver?: AddressResolver;
}

export interface SafeFetchResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** 最终生效的 URL(跟随重定向后) */
  url: string;
  /** 实际连接的 IP —— 与校验通过的是同一个,便于审计 */
  remoteAddress: string;
  redirects: number;
}

const DEFAULTS = {
  timeoutMs: 10_000,
  headersTimeoutMs: 5_000,
  maxRedirects: 3,
  maxResponseBytes: 5 * 1024 * 1024,
  allowedProtocols: ['https:'] as const,
  allowedPorts: [80, 443] as const,
};

/** 内部主机名后缀:即便解析不出来也不该由服务器去访问 */
const BLOCKED_HOST_SUFFIXES = [
  '.local', '.internal', '.localdomain', '.home.arpa', '.lan',
  '.intranet', '.corp', '.private',
];

const BLOCKED_HOSTNAMES = new Set([
  'localhost', 'localhost.localdomain', 'metadata.google.internal',
  'instance-data', 'metadata',
]);

function allowPrivateFromEnv(): boolean {
  return process.env.YUMEET_NET_ALLOW_PRIVATE === '1';
}

async function defaultResolver(hostname: string): Promise<string[]> {
  // all + verbatim:同时拿到 A 与 AAAA,不让 OS 只回一个「能用的」而藏起另一个
  const addrs: LookupAddress[] = await dnsLookup(hostname, { all: true, verbatim: true });
  return addrs.map((a) => a.address);
}

/**
 * 校验一个 URL 是否允许出站,并返回可直连的 IP 列表。
 * webhook 的目标 URL 在**保存时与每次投递时**都要调用一次(防 TOCTOU:
 * 先填合法域名、审核通过后再改 DNS 指向内网)。
 */
export async function assertSafeUrl(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<{ url: URL; addresses: string[] }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfError('invalid-url', `不是合法 URL: ${rawUrl}`);
  }

  const allowedProtocols = opts.allowedProtocols ?? DEFAULTS.allowedProtocols;
  if (!allowedProtocols.includes(url.protocol)) {
    throw new SsrfError('scheme', `协议不被允许: ${url.protocol}`, url.protocol);
  }

  const port = url.port ? Number(url.port) : (url.protocol === 'https:' ? 443 : 80);
  const allowedPorts = opts.allowedPorts ?? DEFAULTS.allowedPorts;
  const allowPrivate = opts.allowPrivateAddresses ?? allowPrivateFromEnv();
  if (!allowPrivate && !allowedPorts.includes(port)) {
    throw new SsrfError('port', `端口不被允许: ${port}`, String(port));
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname) throw new SsrfError('hostname', '缺少主机名');
  if (url.username || url.password) {
    throw new SsrfError('hostname', 'URL 不得内嵌凭据');
  }
  if (!allowPrivate) {
    if (BLOCKED_HOSTNAMES.has(hostname)) {
      throw new SsrfError('hostname', `主机名被拒绝: ${hostname}`, hostname);
    }
    if (BLOCKED_HOST_SUFFIXES.some((s) => hostname.endsWith(s))) {
      throw new SsrfError('hostname', `内部域名后缀被拒绝: ${hostname}`, hostname);
    }
  }

  const resolve = opts.resolver ?? defaultResolver;
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch (err) {
    throw new SsrfError('dns', `DNS 解析失败: ${hostname}`, (err as Error).message);
  }
  if (addresses.length === 0) {
    throw new SsrfError('dns', `DNS 未返回任何地址: ${hostname}`);
  }

  if (!allowPrivate) {
    // 「任一地址落在受限网段就整体拒绝」,而不是挑一个公网的用 ——
    // 后者会被「同一域名同时返回公网与内网 A 记录」绕过。
    for (const addr of addresses) {
      const hit: BlockedRange | null = classifyAddress(addr);
      if (hit) {
        throw new SsrfError(
          'private-ip',
          `目标解析到受限网段(${hit}): ${hostname} → ${addr}`,
          `${addr}:${hit}`,
        );
      }
    }
  }

  return { url, addresses };
}

interface RawResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  remoteAddress: string;
}

/** 单跳请求:IP 已钉死,不跟随重定向 */
function requestOnce(
  url: URL,
  pinnedIp: string,
  opts: Required<Pick<SafeFetchOptions, 'headersTimeoutMs' | 'maxResponseBytes'>> & {
    method: string;
    headers: Record<string, string>;
    body: string | Buffer | undefined;
    deadline: number;
  },
): Promise<RawResponse> {
  const isHttps = url.protocol === 'https:';
  const transport = isHttps ? https : http;
  const family = pinnedIp.includes(':') ? 6 : 4;

  return new Promise<RawResponse>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(headersTimer);
      clearTimeout(overallTimer);
      fn();
    };

    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname.replace(/^\[|\]$/g, ''),
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: opts.method,
      headers: opts.headers,
      // ★ DNS 重绑定防护:socket 不再自行解析,直接连校验过的那个 IP。
      //   Host 头与 TLS servername 仍是原主机名,证书校验照常生效。
      lookup: (_hostname, options, cb) => {
        if (typeof options === 'function') {
          (options as (e: null, a: string, f: number) => void)(null, pinnedIp, family);
          return;
        }
        if (options && (options as { all?: boolean }).all) {
          (cb as unknown as (e: null, a: LookupAddress[]) => void)(
            null, [{ address: pinnedIp, family }],
          );
          return;
        }
        cb(null, pinnedIp, family);
      },
      agent: new transport.Agent({ keepAlive: false, maxSockets: 1 }),
      ...(isHttps ? { servername: url.hostname.replace(/^\[|\]$/g, '') } : {}),
    });

    const headersTimer = setTimeout(() => {
      finish(() => {
        req.destroy();
        reject(new SsrfError('timeout', `等待响应头超时(${opts.headersTimeoutMs}ms)`));
      });
    }, opts.headersTimeoutMs);

    const overallTimer = setTimeout(() => {
      finish(() => {
        req.destroy();
        reject(new SsrfError('timeout', '出站请求超过整体截止时间'));
      });
    }, Math.max(1, opts.deadline - Date.now()));

    req.on('response', (res) => {
      clearTimeout(headersTimer);
      const remoteAddress = res.socket?.remoteAddress ?? pinnedIp;
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > opts.maxResponseBytes) {
          finish(() => {
            res.destroy();
            req.destroy();
            reject(new SsrfError(
              'response-too-large',
              `响应体超过上限 ${opts.maxResponseBytes} 字节`,
            ));
          });
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => finish(() => resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        body: Buffer.concat(chunks),
        remoteAddress,
      })));
      res.on('error', (err) => finish(() => reject(err)));
    });

    req.on('error', (err) => finish(() => reject(err)));
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

/**
 * 受控出站请求。任何业务代码要发 HTTP,只能走这里。
 *
 * @throws SsrfError 校验不通过、超时、响应体超限;其余网络错误原样抛出。
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs;
  const headersTimeoutMs = opts.headersTimeoutMs ?? DEFAULTS.headersTimeoutMs;
  const maxRedirects = opts.maxRedirects ?? DEFAULTS.maxRedirects;
  const maxResponseBytes = opts.maxResponseBytes ?? DEFAULTS.maxResponseBytes;
  const deadline = Date.now() + timeoutMs;

  let target = rawUrl;
  let method = (opts.method ?? 'GET').toUpperCase();
  let body = opts.body;
  let redirects = 0;

  for (;;) {
    // 每一跳都完整重走校验(含 DNS),重定向不是绕过 SSRF 检查的后门
    const { url, addresses } = await assertSafeUrl(target, opts);
    const pinnedIp = addresses[0]!;

    const headers: Record<string, string> = {
      host: url.host,
      accept: '*/*',
      'user-agent': 'yuMeet/0.1 (+https://yumeet.dev)',
      ...normalizeHeaders(opts.headers ?? {}),
    };
    if (body !== undefined) {
      headers['content-length'] = String(Buffer.byteLength(body));
    }

    const res = await requestOnce(url, pinnedIp, {
      method, headers, body, headersTimeoutMs, maxResponseBytes, deadline,
    });

    const location = res.headers.location;
    const isRedirect = res.status >= 300 && res.status < 400 && typeof location === 'string';
    if (!isRedirect) {
      return {
        status: res.status,
        headers: res.headers,
        body: res.body.toString('utf8'),
        url: url.toString(),
        remoteAddress: res.remoteAddress,
        redirects,
      };
    }

    if (redirects >= maxRedirects) {
      throw new SsrfError('too-many-redirects', `重定向次数超过上限 ${maxRedirects}`);
    }
    redirects += 1;
    try {
      target = new URL(location, url).toString();
    } catch {
      throw new SsrfError('redirect-target', `重定向目标非法: ${location}`);
    }
    // 303 与「POST 收到 301/302」按 RFC 9110 降级为 GET,且不再带请求体
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
      method = 'GET';
      body = undefined;
    }
  }
}

function normalizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v;
  return out;
}

/** 便捷封装:POST 一段 JSON 原始串(webhook 投递用,必须传 rawBody 保证签名一致) */
export async function safePostJson(
  rawUrl: string,
  rawBody: string,
  headers: Record<string, string> = {},
  opts: SafeFetchOptions = {},
): Promise<SafeFetchResponse> {
  return safeFetch(rawUrl, {
    ...opts,
    method: 'POST',
    body: rawBody,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    // 投递不跟随重定向:订阅方换地址应当自己改配置,而不是让我们跟着跳
    maxRedirects: opts.maxRedirects ?? 0,
  });
}
