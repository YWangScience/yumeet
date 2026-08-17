/**
 * SSRF 防护单测(ch12 §12.1 防御二)。
 * 全部用例默认不触网:字面量 IP 由 node:dns 直接回显,域名用例注入假解析器。
 */
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  safeFetch, safePostJson, assertSafeUrl, SsrfError,
  isPrivateOrReserved, classifyAddress, parseIPv4, parseIPv6,
} from './index';

/** 允许 http: 与非标端口,以便把用例逼到「IP 判定」这一层而不是先被协议拦下 */
const HTTP_OK = { allowedProtocols: ['http:', 'https:'], allowedPorts: [80, 443, 3210, 8080] };

async function expectSsrf(p: Promise<unknown>, reason: string) {
  await expect(p).rejects.toBeInstanceOf(SsrfError);
  await p.catch((e: SsrfError) => expect(e.reason).toBe(reason));
}

describe('IP 网段判定', () => {
  it('IPv4 环回 / 私有 / 链路本地 / CGNAT 全部命中', () => {
    expect(classifyAddress('127.0.0.1')).toBe('loopback');
    expect(classifyAddress('127.255.255.254')).toBe('loopback');
    expect(classifyAddress('10.0.0.1')).toBe('private');
    expect(classifyAddress('172.16.0.1')).toBe('private');
    expect(classifyAddress('172.31.255.255')).toBe('private');
    expect(classifyAddress('192.168.1.1')).toBe('private');
    expect(classifyAddress('169.254.169.254')).toBe('link-local'); // 云元数据端点
    expect(classifyAddress('100.64.0.1')).toBe('cgnat');
    expect(classifyAddress('0.0.0.0')).toBe('unspecified');
    expect(classifyAddress('255.255.255.255')).toBe('reserved');
    expect(classifyAddress('224.0.0.1')).toBe('multicast');
  });

  it('IPv4 公网地址放行', () => {
    expect(classifyAddress('93.184.216.34')).toBeNull();
    expect(classifyAddress('1.1.1.1')).toBeNull();
    expect(classifyAddress('172.32.0.1')).toBeNull();  // 刚好在 172.16/12 之外
    expect(classifyAddress('172.15.255.255')).toBeNull();
    expect(classifyAddress('100.63.255.255')).toBeNull();
  });

  it('IPv6 环回 / ULA / 链路本地命中', () => {
    expect(classifyAddress('::1')).toBe('loopback');
    expect(classifyAddress('[::1]')).toBe('loopback');
    expect(classifyAddress('::')).toBe('unspecified');
    expect(classifyAddress('fc00::1')).toBe('unique-local');
    expect(classifyAddress('fd12:3456::1')).toBe('unique-local');
    expect(classifyAddress('fe80::1')).toBe('link-local');
    expect(classifyAddress('fe80::1%eth0')).toBe('link-local');
    expect(classifyAddress('ff02::1')).toBe('multicast');
    expect(classifyAddress('2001:db8::1')).toBe('documentation');
  });

  it('IPv6 里内嵌的 v4 不能成为绕过通道', () => {
    expect(classifyAddress('::ffff:127.0.0.1')).toBe('loopback');
    expect(classifyAddress('::ffff:169.254.169.254')).toBe('link-local');
    expect(classifyAddress('::ffff:10.0.0.1')).toBe('private');
    expect(classifyAddress('64:ff9b::169.254.169.254')).toBe('link-local'); // NAT64
    expect(classifyAddress('2002:a00:1::1')).toBe('private');               // 6to4 → 10.0.0.1
    expect(classifyAddress('::ffff:93.184.216.34')).toBeNull();             // 公网映射放行
  });

  it('IPv6 公网地址放行', () => {
    expect(classifyAddress('2606:4700:4700::1111')).toBeNull();
    expect(classifyAddress('2400:cb00::1')).toBeNull();
  });

  it('解析器拒绝八进制 / 越界写法', () => {
    expect(parseIPv4('010.0.0.1')).toBeNull();
    expect(parseIPv4('256.0.0.1')).toBeNull();
    expect(parseIPv4('1.2.3')).toBeNull();
    expect(parseIPv6('gggg::1')).toBeNull();
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(isPrivateOrReserved('not-an-ip')).toBe(true); // 解析不出来一律当受限
  });
});

describe('safeFetch 拒绝内网目标(ch12 §12.1)', () => {
  it('http://127.0.0.1 —— 环回', async () => {
    await expectSsrf(safeFetch('http://127.0.0.1/', HTTP_OK), 'private-ip');
  });

  it('http://127.0.0.1:3210/ —— 环回 + 非标端口', async () => {
    await expectSsrf(safeFetch('http://127.0.0.1:3210/', HTTP_OK), 'private-ip');
  });

  it('http://169.254.169.254 —— 云元数据端点', async () => {
    await expectSsrf(safeFetch('http://169.254.169.254/latest/meta-data/', HTTP_OK), 'private-ip');
  });

  it('http://[::1] —— IPv6 环回', async () => {
    await expectSsrf(safeFetch('http://[::1]/', HTTP_OK), 'private-ip');
  });

  it('http://10.0.0.1 —— RFC1918', async () => {
    await expectSsrf(safeFetch('http://10.0.0.1/admin', HTTP_OK), 'private-ip');
  });

  it('localhost / *.internal 等主机名直接拒', async () => {
    await expectSsrf(safeFetch('http://localhost:3210/', HTTP_OK), 'hostname');
    await expectSsrf(safeFetch('http://foo.internal/', HTTP_OK), 'hostname');
    await expectSsrf(safeFetch('http://metadata.google.internal/', HTTP_OK), 'hostname');
  });

  it('默认只允许 https;http 与其他协议被拒', async () => {
    await expectSsrf(safeFetch('http://example.com/'), 'scheme');
    await expectSsrf(safeFetch('file:///etc/passwd'), 'scheme');
    await expectSsrf(safeFetch('gopher://example.com/'), 'scheme');
    await expectSsrf(safeFetch('ftp://example.com/'), 'scheme');
  });

  it('非白名单端口被拒(堵内网服务端口)', async () => {
    await expectSsrf(safeFetch('https://example.com:6379/', { resolver: publicDns }), 'port');
    await expectSsrf(safeFetch('https://example.com:5432/', { resolver: publicDns }), 'port');
  });

  it('URL 内嵌凭据被拒', async () => {
    await expectSsrf(safeFetch('https://user:pw@example.com/', { resolver: publicDns }), 'hostname');
  });

  it('URL 本身非法被拒', async () => {
    await expectSsrf(safeFetch('not a url'), 'invalid-url');
  });
});

/** 假解析器:公网域名解析到 example.com 的公网地址 */
const publicDns = async (host: string): Promise<string[]> =>
  host === 'example.com' ? ['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946'] : [];

describe('正常公网域名放行', () => {
  it('校验通过并返回待钉住的 IP 列表', async () => {
    const { url, addresses } = await assertSafeUrl('https://example.com/hook', {
      resolver: publicDns,
    });
    expect(url.hostname).toBe('example.com');
    expect(addresses).toContain('93.184.216.34');
  });

  it('域名同时返回公网与内网 A 记录时整体拒绝(不挑一个能用的)', async () => {
    const mixed = async () => ['93.184.216.34', '10.1.2.3'];
    await expectSsrf(
      assertSafeUrl('https://evil.example/', { resolver: mixed }),
      'private-ip',
    );
  });

  it('DNS 无结果被拒', async () => {
    await expectSsrf(assertSafeUrl('https://nowhere.example/', { resolver: publicDns }), 'dns');
  });
});

describe('DNS 重绑定:校验用的 IP 与连接用的 IP 是同一个', () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect-to-file') {
        res.writeHead(302, { location: 'file:///etc/passwd' });
        res.end();
        return;
      }
      if (req.url === '/redirect-to-self') {
        res.writeHead(302, { location: '/ping' });
        res.end();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, host: req.headers.host, ua: req.headers['user-agent'] }));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address();
    port = typeof addr === 'object' && addr ? addr.port : 0;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('第一次解析返回公网 IP、第二次返回内网 IP —— 连接仍走第一次校验过的那个', async () => {
    // 攻击模型:攻击者控制 DNS,校验时回公网 IP,连接时回 127.0.0.1。
    // safeFetch 把校验时拿到的 IP 钉进 net.connect 的 lookup,第二次解析根本不会发生。
    let calls = 0;
    const rebinding = async () => {
      calls += 1;
      return calls === 1 ? ['93.184.216.34'] : ['127.0.0.1'];
    };
    // 校验用的是第一次结果(公网,放行),随后连接被钉在 93.184.216.34 上
    // —— 该地址在测试环境连不通,于是失败在「连接」而不是「打到本机服务」。
    const p = safeFetch('http://rebind.example/', {
      ...HTTP_OK, resolver: rebinding, timeoutMs: 1500, headersTimeoutMs: 1200,
    });
    await expect(p).rejects.toThrow();
    expect(calls).toBe(1); // 只解析了一次:没有第二次 DNS 供攻击者掉包
  });

  it('放开私网限制后可正常收发(仅供本地联调,YUMEET_NET_ALLOW_PRIVATE)', async () => {
    const res = await safeFetch(`http://127.0.0.1:${port}/ping`, {
      ...HTTP_OK, allowPrivateAddresses: true,
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, host: `127.0.0.1:${port}` });
    expect(res.remoteAddress).toBe('127.0.0.1');
  });

  it('重定向目标重新走一遍协议白名单:302 指向 file:// 被拦', async () => {
    // 首跳放行(本机测试服务),第二跳的 Location 从第 1 步重新校验 ——
    // 协议判定不受 allowPrivateAddresses 影响,因此这里能干净地证明「逐跳重校验」。
    await expectSsrf(
      safeFetch(`http://127.0.0.1:${port}/redirect-to-file`, {
        ...HTTP_OK, allowPrivateAddresses: true, maxRedirects: 2,
      }),
      'scheme',
    );
  });

  it('跟随重定向时每一跳都重新解析 DNS(计数 = 跳数)', async () => {
    let resolves = 0;
    const counting = async () => { resolves += 1; return ['127.0.0.1']; };
    const res = await safeFetch(`http://127.0.0.1:${port}/redirect-to-self`, {
      ...HTTP_OK, allowPrivateAddresses: true, resolver: counting, maxRedirects: 2,
    });
    expect(res.status).toBe(200);
    expect(res.redirects).toBe(1);
    expect(resolves).toBe(2); // 没有「已校验过就跳过」的捷径
  });

  it('超过重定向上限即拒', async () => {
    await expectSsrf(
      safeFetch(`http://127.0.0.1:${port}/redirect-to-self`, {
        ...HTTP_OK, allowPrivateAddresses: true, maxRedirects: 0,
      }),
      'too-many-redirects',
    );
  });

  it('响应体超限断流', async () => {
    await expectSsrf(
      safeFetch(`http://127.0.0.1:${port}/ping`, {
        ...HTTP_OK, allowPrivateAddresses: true, maxResponseBytes: 4,
      }),
      'response-too-large',
    );
  });

  it('safePostJson 送出原始体与自定义头', async () => {
    const raw = JSON.stringify({ hello: 'world' });
    const res = await safePostJson(
      `http://127.0.0.1:${port}/hook`, raw, { 'x-yumeet-event': 'test.ping' },
      { ...HTTP_OK, allowPrivateAddresses: true },
    );
    expect(res.status).toBe(200);
  });
});
