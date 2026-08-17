/** CLI 的输出工具:无依赖的 ANSI 着色与表格 */
const ESC = String.fromCharCode(27);
const useColor = Boolean(process.stdout.isTTY) && !process.env['NO_COLOR'];
const wrap = (code: string) => (s: string) =>
  (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : s);

export const c = {
  bold: wrap('1'),
  dim: wrap('2'),
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  cyan: wrap('36'),
};

export const ok = (s: string) => `${c.green('✓')} ${s}`;
export const fail = (s: string) => `${c.red('✗')} ${s}`;
export const warn = (s: string) => `${c.yellow('!')} ${s}`;

export function table(rows: string[][], head?: string[]): string {
  const all = head ? [head, ...rows] : rows;
  const cols = all[0]?.length ?? 0;
  const w: number[] = [];
  for (let i = 0; i < cols; i++) {
    w[i] = Math.max(...all.map((r) => (r[i] ?? '').length));
  }
  const line = (r: string[]) =>
    r.map((cell, i) => cell.padEnd(w[i] ?? 0)).join('  ').trimEnd();
  return (head ? [c.dim(line(head)), ...rows.map(line)] : rows.map(line)).join('\n');
}

export const isJson = (argv: string[]) => argv.includes('--json');

export function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  const next = argv[i + 1];
  if (i >= 0 && next && !next.startsWith('--')) return next;
  const inline = argv.find((a) => a.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
}

export const has = (argv: string[], name: string) => argv.includes(`--${name}`);
