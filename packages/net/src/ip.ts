/**
 * IP 分类:判定一个字面量地址是否落在私有 / 环回 / 链路本地 / 保留网段。
 * ch12 §12.1 防御二的判定内核 —— safeFetch 在解析 DNS 之后、建立连接之前调用。
 *
 * 覆盖 IPv4 与 IPv6 两族;IPv6 的 IPv4 映射(::ffff:a.b.c.d)、6to4(2002::/16)、
 * NAT64(64:ff9b::/96)、Teredo(2001::/32)会取出内嵌的 v4 地址再判一次,
 * 避免「换一种写法就绕过」。
 */

export type IpFamily = 4 | 6;

/** 命中的网段名,用于错误信息与日志(不暴露给外部调用方以外的地方) */
export type BlockedRange =
  | 'unspecified' | 'loopback' | 'private' | 'cgnat' | 'link-local'
  | 'shared-infra' | 'documentation' | 'benchmark' | '6to4-relay'
  | 'multicast' | 'reserved' | 'unique-local' | 'discard' | 'nat64' | 'teredo';

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

/** 点分十进制 → 4 字节;非法返回 null(不接受前导零 / 八进制 / 十进制整数写法) */
export function parseIPv4(input: string): Uint8Array | null {
  const parts = input.split('.');
  if (parts.length !== 4) return null;
  const out = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    const p = parts[i]!;
    if (!/^\d{1,3}$/.test(p)) return null;
    if (p.length > 1 && p.startsWith('0')) return null; // 023 会被某些解析器当八进制
    const n = Number(p);
    if (n > 255) return null;
    out[i] = n;
  }
  return out;
}

/** IPv6 文本(可带 :: 压缩与末尾 IPv4)→ 16 字节;非法返回 null */
export function parseIPv6(input: string): Uint8Array | null {
  let text = input;
  if (text.startsWith('[') && text.endsWith(']')) text = text.slice(1, -1);
  const zone = text.indexOf('%');
  if (zone >= 0) text = text.slice(0, zone); // fe80::1%eth0 的 scope id
  if (!text.includes(':')) return null;

  // 末尾内嵌的点分十进制(::ffff:192.168.0.1)先转成两个 16 位组
  const lastColon = text.lastIndexOf(':');
  const tail = text.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = parseIPv4(tail);
    if (!v4) return null;
    const hi = ((v4[0]! << 8) | v4[1]!).toString(16);
    const lo = ((v4[2]! << 8) | v4[3]!).toString(16);
    text = `${text.slice(0, lastColon + 1)}${hi}:${lo}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const toGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const groups: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      groups.push(parseInt(g, 16));
    }
    return groups;
  };

  const head = toGroups(halves[0] ?? '');
  const tailGroups = halves.length === 2 ? toGroups(halves[1] ?? '') : null;
  if (!head) return null;
  if (halves.length === 2 && !tailGroups) return null;

  let groups: number[];
  if (halves.length === 2) {
    const fill = 8 - head.length - tailGroups!.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<number>(fill).fill(0), ...tailGroups!];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;

  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = (groups[i]! >> 8) & 0xff;
    out[i * 2 + 1] = groups[i]! & 0xff;
  }
  return out;
}

export interface ParsedIp {
  family: IpFamily;
  bytes: Uint8Array;
}

/** 通用解析:先试 v4 再试 v6 */
export function parseIp(input: string): ParsedIp | null {
  const v4 = parseIPv4(input);
  if (v4) return { family: 4, bytes: v4 };
  const v6 = parseIPv6(input);
  if (v6) return { family: 6, bytes: v6 };
  return null;
}

// ---------------------------------------------------------------------------
// 判定
// ---------------------------------------------------------------------------

/** IPv4 网段判定;返回命中的网段名,公网地址返回 null */
export function classifyIPv4(b: Uint8Array): BlockedRange | null {
  const o1 = b[0] ?? 0, o2 = b[1] ?? 0, o3 = b[2] ?? 0;

  if (o1 === 0) return 'unspecified';                      // 0.0.0.0/8
  if (o1 === 10) return 'private';                         // 10/8
  if (o1 === 127) return 'loopback';                       // 127/8
  if (o1 === 100 && o2 >= 64 && o2 <= 127) return 'cgnat'; // 100.64/10
  if (o1 === 169 && o2 === 254) return 'link-local';       // 169.254/16(云元数据 169.254.169.254)
  if (o1 === 172 && o2 >= 16 && o2 <= 31) return 'private'; // 172.16/12
  if (o1 === 192 && o2 === 0 && o3 === 0) return 'shared-infra';    // 192.0.0/24
  if (o1 === 192 && o2 === 0 && o3 === 2) return 'documentation';   // TEST-NET-1
  if (o1 === 192 && o2 === 88 && o3 === 99) return '6to4-relay';    // 192.88.99/24
  if (o1 === 192 && o2 === 168) return 'private';                   // 192.168/16
  if (o1 === 198 && (o2 === 18 || o2 === 19)) return 'benchmark';   // 198.18/15
  if (o1 === 198 && o2 === 51 && o3 === 100) return 'documentation'; // TEST-NET-2
  if (o1 === 203 && o2 === 0 && o3 === 113) return 'documentation';  // TEST-NET-3
  if (o1 >= 224 && o1 <= 239) return 'multicast';          // 224/4
  if (o1 >= 240) return 'reserved';                        // 240/4,含 255.255.255.255
  return null;
}

function embeddedV4(b: Uint8Array, offset: number): Uint8Array {
  return b.slice(offset, offset + 4);
}

/** IPv6 网段判定;会对内嵌 v4 的地址族递归判一次 */
export function classifyIPv6(b: Uint8Array): BlockedRange | null {
  const allZeroTo = (n: number) => b.slice(0, n).every((x) => x === 0);

  if (b.every((x) => x === 0)) return 'unspecified';                       // ::/128
  if (allZeroTo(15) && b[15] === 1) return 'loopback';                     // ::1/128

  // ::ffff:a.b.c.d —— IPv4 映射地址,按 v4 规则再判一次
  if (allZeroTo(10) && b[10] === 0xff && b[11] === 0xff) {
    return classifyIPv4(embeddedV4(b, 12)) ?? null;
  }
  // ::a.b.c.d —— 已废弃的 IPv4 兼容地址,同样按 v4 判
  if (allZeroTo(12) && !(b[12] === 0 && b[13] === 0 && b[14] === 0)) {
    return classifyIPv4(embeddedV4(b, 12)) ?? 'reserved';
  }

  const g0 = ((b[0]! << 8) | b[1]!) & 0xffff;
  const g1 = ((b[2]! << 8) | b[3]!) & 0xffff;

  // 64:ff9b::/96 与 64:ff9b:1::/48 —— NAT64,内嵌 v4 可直达内网
  if (g0 === 0x0064 && g1 === 0xff9b) {
    return classifyIPv4(embeddedV4(b, 12)) ?? 'nat64';
  }
  if (g0 === 0x0100 && g1 === 0x0000) return 'discard';                     // 100::/64
  if (g0 === 0x2001 && g1 === 0x0000) return 'teredo';                      // 2001::/32
  if (g0 === 0x2001 && g1 === 0x0db8) return 'documentation';               // 2001:db8::/32
  if (g0 === 0x2002) return classifyIPv4(embeddedV4(b, 2)) ?? '6to4-relay'; // 2002::/16
  if ((b[0]! & 0xfe) === 0xfc) return 'unique-local';                       // fc00::/7
  if (b[0] === 0xfe && (b[1]! & 0xc0) === 0x80) return 'link-local';        // fe80::/10
  if (b[0] === 0xff) return 'multicast';                                    // ff00::/8
  return null;
}

/** 统一入口:字面量地址 → 命中的受限网段名(公网返回 null,无法解析视为 reserved) */
export function classifyAddress(address: string): BlockedRange | null {
  const parsed = parseIp(address);
  if (!parsed) return 'reserved';
  return parsed.family === 4 ? classifyIPv4(parsed.bytes) : classifyIPv6(parsed.bytes);
}

/** 该地址是否属于私有 / 环回 / 保留网段(即 yuMeet 出站绝不允许连的目标) */
export function isPrivateOrReserved(address: string): boolean {
  return classifyAddress(address) !== null;
}
