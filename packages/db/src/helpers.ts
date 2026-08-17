import { isNull } from 'drizzle-orm';
import type { Column } from 'drizzle-orm';

/** 软删除过滤条件(ch09 §9.5) */
export const notDeleted = (col: Column) => isNull(col);
