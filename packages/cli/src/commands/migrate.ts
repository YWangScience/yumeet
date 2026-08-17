import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { c, ok, fail, warn, flag, has, table } from '../util';

/**
 * yumeet migrate —— 从 Indico 导入(ch11 §11.3、ch14 §14.1)
 *
 * 目前实现「盘点 + 映射预演」:读取 Indico 导出目录,识别可迁移的实体
 * 并按 ch14 §14.1 的映射表报告将写入哪些表。真正写库走 --apply。
 *
 * 之所以先做预演:迁移是一次性且难回滚的操作,先让运维看清将发生什么,
 * 比直接写库再补救更安全。MG17 的实际导入见 docs-data/ 下的脚本。
 */

/** ch14 §14.1 实体映射表 */
const MAPPING: [string, string, string][] = [
  ['Event', 'events', '标题/副标题/起止/时区/场地;custom pages 另入 event_pages'],
  ['Category', 'organizations', 'Indico 的分类树扁平化为组织'],
  ['Contribution', 'submissions', '含作者与单位;status 一律置 scheduled'],
  ['Session / Timetable', 'sessions + rooms', '按会场与时间落位,冲突由 detectConflicts 复核'],
  ['Registration form', 'registration_forms', '字段映射到 15 种 kind(ch09 §9.3)'],
  ['Registrant', 'registrations', '仅在 --with-pii 时导入,默认跳过个人数据'],
  ['Custom page', 'event_pages', 'HTML → Markdown'],
  ['Attachment', 'files', '按 sha256 去重'],
];

interface Found { kind: string; count: number; source: string }

async function scanDir(dir: string): Promise<Found[]> {
  const out: Found[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new Error(`无法读取目录:${dir}`);
  }

  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    try {
      const raw = await readFile(join(dir, name), 'utf8');
      const data: unknown = JSON.parse(raw);
      const arr = Array.isArray(data)
        ? data
        : (data as { results?: unknown[] }).results ?? [];
      const guess = /contribution|abstract/i.test(name) ? 'Contribution'
        : /session|timetable/i.test(name) ? 'Session / Timetable'
        : /page/i.test(name) ? 'Custom page'
        : /registrant|participant/i.test(name) ? 'Registrant'
        : 'Event';
      out.push({ kind: guess, count: Array.isArray(arr) ? arr.length : 1, source: name });
    } catch {
      out.push({ kind: '(无法解析)', count: 0, source: name });
    }
  }
  return out;
}

export async function migrateCmd(argv: string[]): Promise<number> {
  const from = flag(argv, 'from') ?? 'indico';
  const src = argv.find((a) => !a.startsWith('--') && a !== from);

  if (from !== 'indico') {
    console.error(fail(`暂只支持 --from indico(收到 ${from})`));
    return 1;
  }
  if (!src) {
    console.error(fail('用法:yumeet migrate --from indico <导出目录> [--apply] [--with-pii]'));
    return 1;
  }

  console.log(`\n${c.bold('Indico → yuMeet 迁移')}\n`);
  console.log(c.dim(`来源:${src}\n`));

  console.log(c.bold('实体映射(ch14 §14.1)'));
  console.log(table(MAPPING.map(([a, b, note]) => [a, '→', b, c.dim(note)])));

  let found: Found[];
  try {
    found = await scanDir(src);
  } catch (e) {
    console.error(`\n${fail(e instanceof Error ? e.message : String(e))}`);
    return 1;
  }

  console.log(`\n${c.bold('扫描到的文件')}`);
  if (found.length === 0) {
    console.log(c.dim('  目录下没有 .json 导出文件'));
  } else {
    console.log(table(found.map((f) => [f.source, f.kind, String(f.count)]),
      ['文件', '识别为', '条目']));
  }

  if (!has(argv, 'with-pii')) {
    console.log(`\n${warn('默认跳过参会者个人数据(邮箱等);确需导入请加 --with-pii')}`);
    console.log(c.dim('  公开站点复现不需要 PII —— ch12 §12.3 数据最小化'));
  }

  if (!has(argv, 'apply')) {
    console.log(`\n${c.yellow('这是预演,未写入数据库。确认无误后加 --apply 执行。')}\n`);
    return 0;
  }

  console.log(`\n${fail('--apply 尚未实现通用写入路径')}`);
  console.log(c.dim('  MG17 的实际导入见 docs-data/ 下的 parse_boa.py 与 scrape_pages.py,'));
  console.log(c.dim('  它们已跑通 601 篇摘要 + 20 个页面 + 398 位人物的完整导入。\n'));
  return 1;
}
