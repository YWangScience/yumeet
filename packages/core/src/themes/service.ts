/**
 * 主题设置的写路径(ch07 §7.5)
 *
 * 业务逻辑只写一遍:apps/web 的 Server Action 与 apps/api 的 REST 都调这里。
 * 本文件访问数据库与审计链,只能从 '@yumeet/core' 引入,不进 client 入口。
 */
import { eq } from 'drizzle-orm';
import { db as defaultDb, events, type Db } from '@yumeet/db';
import { audit } from '../audit/index';
import { sanitizeOverrides, mergeThemeTokens } from './css';
import { getThemeManifest, UnknownThemeError } from './registry';
import type { TokenMap } from './manifest';

export class ThemeUpdateError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ThemeUpdateError';
  }
}

export interface UpdateEventThemeInput {
  eventId: string;
  themeId: string;
  overrides: Record<string, unknown>;
  actor: { type: 'user' | 'api_key' | 'system'; id?: string | null; ip?: string | null };
}

export interface UpdateEventThemeResult {
  themeId: string;
  overrides: TokenMap;
  /** 被净化流程丢弃的条目(名字或值不合规),便于回显给组织者 */
  rejected: { token: string; reason: string }[];
}

/**
 * 保存活动的主题选择与 token 覆盖。
 * 事务内完成「写活动 + 写审计」,审计 diff 记录前后值,回滚可依此重放(ch12 §12.5)。
 */
export async function updateEventTheme(
  input: UpdateEventThemeInput,
  database: Db = defaultDb,
): Promise<UpdateEventThemeResult> {
  if (!getThemeManifest(input.themeId)) throw new UnknownThemeError(input.themeId);

  const { tokens, rejected } = sanitizeOverrides(input.overrides);
  // 合并一次:manifest 或覆盖值有问题在写库前就暴露,而不是等公共页渲染
  mergeThemeTokens(input.themeId, tokens);

  await database.transaction(async (tx) => {
    const [before] = await tx
      .select({
        id: events.id,
        organizationId: events.organizationId,
        themeId: events.themeId,
        themeOverrides: events.themeOverrides,
      })
      .from(events)
      .where(eq(events.id, input.eventId))
      .for('update')
      .limit(1);
    if (!before) throw new ThemeUpdateError('not_found', '活动不存在');

    await tx.update(events)
      .set({ themeId: input.themeId, themeOverrides: tokens, updatedAt: new Date() })
      .where(eq(events.id, input.eventId));

    await audit(tx as unknown as Db, {
      organizationId: before.organizationId,
      eventId: before.id,
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      action: 'event.theme.updated',
      targetType: 'event',
      targetId: before.id,
      diff: {
        before: { themeId: before.themeId, themeOverrides: before.themeOverrides ?? {} },
        after: { themeId: input.themeId, themeOverrides: tokens },
        rejected,
      },
      ip: input.actor.ip ?? null,
    });
  });

  return { themeId: input.themeId, overrides: tokens, rejected };
}

/** 读活动的主题设置(设置页与公共页共用) */
export async function getEventTheme(eventId: string, database: Db = defaultDb) {
  const [row] = await database
    .select({ themeId: events.themeId, themeOverrides: events.themeOverrides })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);
  return row ?? null;
}
