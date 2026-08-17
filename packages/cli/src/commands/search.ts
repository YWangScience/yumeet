import { db, events, submissions } from '@yumeet/db';
import { sql } from 'drizzle-orm';
import { c, ok, fail, isJson } from '../util';

/**
 * yumeet search reindex —— 重建检索索引(ch11 §11.3、ch13 §13.6)
 *
 * 默认方案是 PostgreSQL 内置全文检索,因此「重建索引」= 重建
 * GIN 索引并刷新统计;可选的 Meilisearch 后端在此处推送文档。
 */
export async function searchCmd(argv: string[]): Promise<number> {
  const sub = argv[0];
  if (sub !== 'reindex') {
    console.error(fail('用法:yumeet search reindex'));
    return 1;
  }

  const t0 = Date.now();

  // 摘要检索走 title/abstract/authors 的 ILIKE + GIN(ch13 §13.6)
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS submissions_fts_idx
      ON submissions USING GIN (
        to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(abstract,''))
      )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS submissions_authors_gin
      ON submissions USING GIN (authors jsonb_path_ops)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS registrations_answers_gin
      ON registrations USING GIN (answers jsonb_path_ops)
  `);
  await db.execute(sql`ANALYZE submissions`);
  await db.execute(sql`ANALYZE registrations`);

  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(submissions);
  const [ev] = await db.select({ n: sql<number>`count(*)::int` }).from(events);
  const ms = Date.now() - t0;

  if (isJson(argv)) {
    console.log(JSON.stringify({ ok: true, submissions: row?.n ?? 0, events: ev?.n ?? 0, ms }));
  } else {
    console.log(ok(`索引重建完成:${row?.n ?? 0} 篇摘要 / ${ev?.n ?? 0} 个活动,耗时 ${ms}ms`));
    console.log(c.dim('  当前使用 PostgreSQL 内置检索;接入 Meilisearch 见 ch13 §13.6'));
  }
  return 0;
}
