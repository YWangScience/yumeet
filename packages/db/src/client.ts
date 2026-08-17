import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

const url = process.env.DATABASE_URL
  ?? 'postgresql://yumeet:yumeet_dev@localhost:5433/yumeet';

declare global {
  // eslint-disable-next-line no-var
  var __yumeet_sql: ReturnType<typeof postgres> | undefined;
}

// Next.js dev 热重载下复用连接,避免连接数爆炸
export const sql = globalThis.__yumeet_sql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== 'production') globalThis.__yumeet_sql = sql;

export const db = drizzle(sql, { schema });
export type Db = typeof db;
