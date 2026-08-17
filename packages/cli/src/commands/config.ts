import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { c, ok, fail, table, isJson } from '../util';

const ENV_FILE = process.env['YUMEET_ENV_FILE'] ?? join(process.cwd(), '.env');

/** 配置分层(ch11 §11.1):内置默认 → 管理后台 UI → 环境变量 → 配置文件 */
const KNOWN: { key: string; desc: string; default?: string }[] = [
  { key: 'DATABASE_URL', desc: 'PostgreSQL 连接串' },
  { key: 'REDIS_URL', desc: 'Redis 连接串', default: 'redis://localhost:6380' },
  { key: 'YUMEET_PUBLIC_URL', desc: '对外基址,用于拼登录链接与 webhook 回调' },
  { key: 'YUMEET_SECRET_KEY', desc: 'AES-256-GCM 主密钥(webhook 密钥加密)' },
  { key: 'YUMEET_MODE', desc: 'single | saas', default: 'single' },
  { key: 'SMTP_URL', desc: '邮件发送地址;缺省时邮件仅写入 email_logs' },
  { key: 'YUMEET_THEMES_DIR', desc: '模板包目录', default: './themes' },
];

async function readEnvFile(): Promise<Record<string, string>> {
  try {
    const raw = await readFile(ENV_FILE, 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m?.[1]) out[m[1]] = (m[2] ?? '').replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
}

/** 每个键都要说明「值从哪来」—— 配置排障最花时间的就是这个 */
function sourceOf(key: string, fileVals: Record<string, string>): [string, string] {
  if (process.env[key] !== undefined) return [process.env[key]!, '环境变量'];
  if (fileVals[key] !== undefined) return [fileVals[key]!, '.env 文件'];
  const d = KNOWN.find((k) => k.key === key)?.default;
  if (d !== undefined) return [d, '内置默认'];
  return ['', '未设置'];
}

const mask = (key: string, v: string) =>
  (/SECRET|PASSWORD|KEY|URL/.test(key) && v.length > 12
    ? `${v.slice(0, 8)}…${v.slice(-4)}`
    : v);

/** yumeet config —— 读写配置并打印生效来源(ch11 §11.3) */
export async function configCmd(argv: string[]): Promise<number> {
  const sub = argv[0] ?? 'list';
  const fileVals = await readEnvFile();

  if (sub === 'list') {
    const rows = KNOWN.map(({ key, desc }) => {
      const [v, src] = sourceOf(key, fileVals);
      return [key, v ? mask(key, v) : c.dim('—'), src, c.dim(desc)];
    });
    if (isJson(argv)) {
      console.log(JSON.stringify(KNOWN.map(({ key }) => {
        const [v, src] = sourceOf(key, fileVals);
        return { key, value: v ? mask(key, v) : null, source: src };
      }), null, 2));
      return 0;
    }
    console.log(`\n${c.bold('配置')}(${ENV_FILE})\n`);
    console.log(table(rows, ['键', '值', '来源', '说明']));
    console.log();
    return 0;
  }

  if (sub === 'get') {
    const key = argv[1];
    if (!key) { console.error(fail('用法:yumeet config get <KEY>')); return 1; }
    const [v, src] = sourceOf(key, fileVals);
    console.log(isJson(argv) ? JSON.stringify({ key, value: v, source: src }) : `${v}  ${c.dim(`(${src})`)}`);
    return v ? 0 : 1;
  }

  if (sub === 'set') {
    const pair = argv[1];
    const m = pair ? /^([A-Z0-9_]+)=(.*)$/.exec(pair) : null;
    if (!m?.[1]) { console.error(fail('用法:yumeet config set KEY=value')); return 1; }
    const [, key, value] = m;
    const next = { ...fileVals, [key]: value ?? '' };
    const body = Object.entries(next).map(([k, v]) => `${k}=${v}`).join('\n');
    await writeFile(ENV_FILE, `${body}\n`, 'utf8');
    console.log(ok(`已写入 ${ENV_FILE}:${key}`));
    if (process.env[key] !== undefined) {
      console.log(c.yellow(`  注意:环境变量 ${key} 已存在,优先级高于文件,当前不会生效`));
    }
    return 0;
  }

  console.error(fail('用法:yumeet config <list|get|set>'));
  return 1;
}
