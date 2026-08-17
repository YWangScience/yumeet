/**
 * 对外 ID 编码(ch09 §9.1)
 * 内部主键 UUIDv7;对外 API 与永久链接暴露带类型前缀的编码 ID:
 *   evt_ / reg_ / sub_ / ord_ / tkt_ / ses_ / fil_ + UUIDv7 的 Crockford base32
 * 裸 UUID 不出现在 URL 与 API 响应中。
 */

export const ID_PREFIXES = {
  organization: 'org',
  event: 'evt',
  registration: 'reg',
  submission: 'sub',
  order: 'ord',
  ticket: 'tkt',
  session: 'ses',
  file: 'fil',
  user: 'usr',
  room: 'rom',
  review: 'rev',
  form: 'frm',
  block: 'blk',
} as const;

export type IdKind = keyof typeof ID_PREFIXES;
export type Prefix = (typeof ID_PREFIXES)[IdKind];

/** Crockford base32:去掉易混字符 I、L、O、U */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DECODE_MAP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) DECODE_MAP[ALPHABET[i]!] = i;
// Crockford 解码宽容规则:I/L → 1,O → 0
DECODE_MAP['I'] = 1;
DECODE_MAP['L'] = 1;
DECODE_MAP['O'] = 0;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16),
    hex.slice(16, 20), hex.slice(20, 32),
  ].join('-');
}

/** 16 字节 → 26 个 base32 字符(128 bit → 130 bit,高位补零) */
function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of str.toUpperCase()) {
    const idx = DECODE_MAP[ch];
    if (idx === undefined) throw new InvalidIdError(`非法 base32 字符: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out.slice(0, 16));
}

export class InvalidIdError extends Error {
  constructor(message = '非法的对外 ID') {
    super(message);
    this.name = 'InvalidIdError';
  }
}

/** UUIDv7 → 带前缀的对外 ID,如 evt_01JD8QZ3O9WK4R… */
export function encodeId(kind: IdKind, uuid: string): string {
  if (!UUID_RE.test(uuid)) throw new InvalidIdError(`不是合法 UUID: ${uuid}`);
  return `${ID_PREFIXES[kind]}_${base32Encode(uuidToBytes(uuid))}`;
}

/** 对外 ID → UUIDv7;kind 给定时校验前缀是否匹配(防止跨类型引用) */
export function decodeId(kind: IdKind, encoded: string): string {
  const expected = ID_PREFIXES[kind];
  const sep = encoded.indexOf('_');
  if (sep < 0) throw new InvalidIdError(`缺少类型前缀: ${encoded}`);
  const prefix = encoded.slice(0, sep);
  if (prefix !== expected) {
    throw new InvalidIdError(`ID 类型不匹配:期望 ${expected},实际 ${prefix}`);
  }
  const bytes = base32Decode(encoded.slice(sep + 1));
  if (bytes.length !== 16) throw new InvalidIdError(`ID 长度错误: ${encoded}`);
  return bytesToUuid(bytes);
}

/** 宽容解码:接受对外 ID 或裸 UUID(内部工具与 seed 用) */
export function toUuid(kind: IdKind, value: string): string {
  return UUID_RE.test(value) ? value : decodeId(kind, value);
}

export function isEncodedId(kind: IdKind, value: string): boolean {
  try {
    decodeId(kind, value);
    return true;
  } catch {
    return false;
  }
}
