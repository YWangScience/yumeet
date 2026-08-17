import { db, users, organizations, organizationMembers } from '@yumeet/db';
import { issueMagicLink, normalizeEmail } from '@yumeet/core';
import { and, eq, isNull } from 'drizzle-orm';
import { c, ok, fail, flag, isJson } from '../util';

/**
 * yumeet admin —— 管理员账户兜底操作(ch11 §11.3)
 *
 * 存在的意义:邮件服务挂了、或首次部署还没有任何管理员时,
 * 运维必须有一条不依赖邮件的通道拿到登录链接。
 */
export async function adminCmd(argv: string[]): Promise<number> {
  const sub = argv[0];
  const email = flag(argv, 'email');
  const orgSlug = flag(argv, 'org') ?? 'icranet';

  if (!sub || !['create', 'link', 'list'].includes(sub)) {
    console.error(fail('用法:yumeet admin <create|link|list> --email <邮箱> [--org <slug>]'));
    return 1;
  }

  if (sub === 'list') {
    const rows = await db.select({
      email: users.email, name: users.name, role: organizationMembers.role,
      org: organizations.slug,
    }).from(organizationMembers)
      .innerJoin(users, eq(organizationMembers.userId, users.id))
      .innerJoin(organizations, eq(organizationMembers.organizationId, organizations.id));
    if (isJson(argv)) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log(`\n${c.bold('组织成员')}\n`);
      for (const r of rows) {
        console.log(`  ${r.email.padEnd(32)} ${c.dim(r.org)}  ${r.role}`);
      }
      console.log();
    }
    return 0;
  }

  if (!email) {
    console.error(fail('缺少 --email'));
    return 1;
  }
  const normalized = normalizeEmail(email);

  if (sub === 'create') {
    const [org] = await db.select().from(organizations)
      .where(eq(organizations.slug, orgSlug)).limit(1);
    if (!org) {
      console.error(fail(`组织 ${orgSlug} 不存在`));
      return 1;
    }

    let [user] = await db.select().from(users)
      .where(and(eq(users.email, normalized), isNull(users.deletedAt))).limit(1);
    if (!user) {
      [user] = await db.insert(users)
        .values({ email: normalized, isGuest: false }).returning();
      console.log(ok(`已创建账户 ${normalized}`));
    } else {
      console.log(c.dim(`账户已存在:${normalized}`));
    }

    const [member] = await db.select().from(organizationMembers)
      .where(and(
        eq(organizationMembers.organizationId, org.id),
        eq(organizationMembers.userId, user!.id),
      )).limit(1);
    if (!member) {
      await db.insert(organizationMembers).values({
        organizationId: org.id, userId: user!.id, role: 'owner',
      });
      console.log(ok(`已授予 ${orgSlug} 的 owner 角色`));
    } else {
      console.log(c.dim(`已是 ${orgSlug} 的 ${member.role}`));
    }
  }

  const issued = await issueMagicLink(normalized, 'login');
  const base = process.env['YUMEET_PUBLIC_URL'] ?? 'https://yumeet.ywang.science';
  const link = `${base}/auth/verify?token=${issued.token}`;

  if (isJson(argv)) {
    console.log(JSON.stringify({ email: normalized, link, expiresAt: issued.expiresAt }));
  } else {
    console.log(`\n${c.bold('登录链接')}(${Math.round(
      (issued.expiresAt.getTime() - Date.now()) / 60000,
    )} 分钟内有效、只能用一次):\n`);
    console.log(`  ${c.cyan(link)}\n`);
  }
  return 0;
}
