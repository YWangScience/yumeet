import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { c, ok, fail, flag } from '../util';

const OUT_DIR = process.env['YUMEET_BACKUP_DIR'] ?? join(process.cwd(), 'backups');

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    p.on('error', reject);
    p.on('close', (code) => resolve(code ?? 1));
  });
}

/** 从 DATABASE_URL 拆出 pg_dump 需要的连接参数 */
function parseDbUrl(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: u.port || '5432',
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
  };
}

/** yumeet backup —— 全量备份(ch11 §11.3、§11.5) */
export async function backupCmd(argv: string[]): Promise<number> {
  const url = process.env['DATABASE_URL'];
  if (!url) { console.error(fail('缺少 DATABASE_URL')); return 1; }

  const db = parseDbUrl(url);
  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const file = join(OUT_DIR, `yumeet-${stamp}.sql`);

  console.log(c.dim(`导出 ${db.database} → ${file}`));
  const code = await run('pg_dump', [
    '-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database,
    '--no-owner', '--no-acl', '-f', file,
  ], { PGPASSWORD: db.password });

  if (code !== 0) {
    console.error(fail('pg_dump 失败;确认已安装 postgresql-client 且连接参数正确'));
    return code;
  }

  const size = (await stat(file)).size;
  console.log(ok(`备份完成:${file}(${(size / 1e6).toFixed(1)} MB)`));

  const to = flag(argv, 'to');
  if (to) {
    console.log(c.yellow(`  远程推送(${to})尚未实现,归档已留在本地`));
  }
  console.log(c.dim('  提示:对象存储与 .env 需另行备份(ch11 §11.5)'));
  return 0;
}

/** yumeet restore —— 从归档恢复 */
export async function restoreCmd(argv: string[]): Promise<number> {
  const file = argv[0];
  if (!file) { console.error(fail('用法:yumeet restore <归档文件>')); return 1; }

  const url = process.env['DATABASE_URL'];
  if (!url) { console.error(fail('缺少 DATABASE_URL')); return 1; }
  const db = parseDbUrl(url);

  // 恢复会覆盖现有数据,必须显式确认
  if (!argv.includes('--yes')) {
    console.error(c.yellow(
      `\n即将把 ${file} 恢复到数据库 ${db.database},现有数据会被覆盖。\n`
      + `确认请重跑并加 --yes\n`,
    ));
    return 1;
  }

  const code = await run('psql', [
    '-h', db.host, '-p', db.port, '-U', db.user, '-d', db.database, '-f', file,
  ], { PGPASSWORD: db.password });

  if (code !== 0) { console.error(fail('恢复失败')); return code; }
  console.log(ok('恢复完成;建议随后运行 yumeet doctor --audit-verify'));
  return 0;
}
