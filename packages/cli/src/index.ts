#!/usr/bin/env node
/**
 * yumeet CLI(ch11 §11.3)
 *
 * 用 node:util 的 parseArgs 解析参数,不引入 commander/yargs
 * —— ch11「不引入规格外的重量依赖」。
 */
import { parseArgs } from 'node:util';
import { doctor } from './commands/doctor';
import { adminCmd } from './commands/admin';
import { themeCmd } from './commands/theme';
import { migrateCmd } from './commands/migrate';
import { searchCmd } from './commands/search';
import { backupCmd, restoreCmd } from './commands/backup';
import { statusCmd } from './commands/status';
import { configCmd } from './commands/config';
import { c } from './util';

const USAGE = `
${c.bold('yumeet')} — 会议系统命令行工具

${c.dim('用法:')} yumeet <命令> [参数]

${c.bold('运维')}
  status              各容器健康状态、版本、队列积压概览
  doctor              体检:数据库、磁盘、证书、迁移一致性
                      --audit-verify  全链重算审计哈希链(ch12 §12.5)
  config <get|set|list>  读写配置并打印每个键的生效来源
  backup              全量备份(pg_dump + 对象存储 + 配置)
  restore <归档>      从备份恢复

${c.bold('数据')}
  migrate --from indico <目录|URL>   从 Indico 导入(ch14 §14.1)
  search reindex                     全量重建检索索引
  admin create --email <邮箱>        创建管理员并给出登录链接
  admin link --email <邮箱>          重发登录链接

${c.bold('主题')}
  theme list          列出已安装的模板包
  theme add <包名>    安装 L2 模板包
  theme remove <id>   卸载

${c.dim('全局参数:')} --json  以 JSON 输出   --help  显示帮助
`;

const COMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  doctor,
  status: statusCmd,
  config: configCmd,
  backup: backupCmd,
  restore: restoreCmd,
  migrate: migrateCmd,
  search: searchCmd,
  admin: adminCmd,
  theme: themeCmd,
};

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    console.log(USAGE);
    process.exit(cmd ? 0 : 1);
  }

  const handler = COMMANDS[cmd];
  if (!handler) {
    console.error(c.red(`未知命令:${cmd}`));
    console.log(USAGE);
    process.exit(1);
  }

  try {
    const code = await handler(argv.slice(1));
    process.exit(code);
  } catch (e) {
    console.error(c.red(`执行失败:${e instanceof Error ? e.message : String(e)}`));
    process.exit(1);
  }
}

export { parseArgs };
void main();
