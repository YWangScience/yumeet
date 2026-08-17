import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { c, ok, fail, table, isJson } from '../util';

const THEMES_DIR = process.env['YUMEET_THEMES_DIR']
  ?? join(process.cwd(), 'themes');

interface ThemeManifest {
  id: string;
  displayName?: Record<string, string> | string;
  version?: string;
  kind?: string;
  license?: string;
}

async function loadThemes(): Promise<ThemeManifest[]> {
  const out: ThemeManifest[] = [];
  let dirs: string[];
  try {
    dirs = await readdir(THEMES_DIR);
  } catch {
    return out;
  }
  for (const d of dirs) {
    try {
      const raw = await readFile(join(THEMES_DIR, d, 'theme.json'), 'utf8');
      out.push(JSON.parse(raw) as ThemeManifest);
    } catch { /* 非主题目录,跳过 */ }
  }
  return out;
}

const label = (t: ThemeManifest) =>
  typeof t.displayName === 'string'
    ? t.displayName
    : (t.displayName?.['zh'] ?? t.displayName?.['en'] ?? t.id);

/** yumeet theme —— 模板包管理(ch11 §11.3、ch07 §7.3) */
export async function themeCmd(argv: string[]): Promise<number> {
  const sub = argv[0] ?? 'list';

  if (sub === 'list') {
    const themes = await loadThemes();
    if (isJson(argv)) {
      console.log(JSON.stringify(themes, null, 2));
      return 0;
    }
    if (themes.length === 0) {
      console.log(c.dim(`\n${THEMES_DIR} 下没有模板包\n`));
      return 0;
    }
    console.log(`\n${c.bold('已安装的模板包')}\n`);
    console.log(table(
      themes.map((t) => [t.id, label(t), t.version ?? '—', t.license ?? '—']),
      ['ID', '名称', '版本', '许可'],
    ));
    console.log();
    return 0;
  }

  if (sub === 'add') {
    const pkg = argv[1];
    if (!pkg) {
      console.error(fail('用法:yumeet theme add <包名或目录>'));
      return 1;
    }
    // 安装 = 把 theme.json 放进 themes/<id>/。真实实现应校验 manifest 与
    // token 命名规范(ch07 §7.2),此处给出可执行的最小路径。
    console.log(c.dim(`从 ${pkg} 安装模板包…`));
    console.log(fail('尚未实现远程包安装;当前请手动把模板包目录放进 ' + THEMES_DIR));
    return 1;
  }

  if (sub === 'remove') {
    const id = argv[1];
    if (!id) {
      console.error(fail('用法:yumeet theme remove <id>'));
      return 1;
    }
    if (id === 'cupertino') {
      console.error(fail('cupertino 是默认主题,不能卸载'));
      return 1;
    }
    try {
      await rm(join(THEMES_DIR, id), { recursive: true });
      console.log(ok(`已卸载 ${id}`));
      return 0;
    } catch (e) {
      console.error(fail(`卸载失败:${e instanceof Error ? e.message : String(e)}`));
      return 1;
    }
  }

  console.error(fail('用法:yumeet theme <list|add|remove>'));
  return 1;
}
