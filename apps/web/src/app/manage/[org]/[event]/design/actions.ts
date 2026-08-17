'use server';

import { revalidatePath } from 'next/cache';
import {
  getEventBySlug, updateEventTheme, UnknownThemeError, ThemeUpdateError,
  ForbiddenError,
} from '@yumeet/core';
import { actorWithCapability, UnauthenticatedError } from '@/lib/authz';

export interface DesignActionState {
  ok: boolean;
  /** 失败原因(已本地化的键由页面负责取词,这里只给稳定的错误码) */
  error?: 'not_found' | 'unknown_theme' | 'failed' | 'forbidden';
  /** 成功保存的时间戳,用于让客户端区分「同一结果的再次提交」 */
  savedAt?: number;
  /** 被净化流程丢弃的覆盖项数量 */
  rejected?: number;
}

/**
 * 保存活动的主题与 token 覆盖(ch07 §7.5)
 * 业务逻辑在 core:事务内写活动 + 写审计链;这里只做入参解析、能力边界与缓存失效。
 */
export async function saveEventThemeAction(
  _prev: DesignActionState,
  formData: FormData,
): Promise<DesignActionState> {
  const orgSlug = String(formData.get('__org') ?? '');
  const eventSlug = String(formData.get('__event') ?? '');
  const themeId = String(formData.get('themeId') ?? '');
  const raw = String(formData.get('overrides') ?? '{}');

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return { ok: false, error: 'not_found' };

  let overrides: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      overrides = parsed as Record<string, unknown>;
    }
  } catch {
    // 非法 JSON 视为「无覆盖」——core 的净化层同样会兜底,这里只是少一次往返
  }

  try {
    const actor = await actorWithCapability(found.event.id, 'design.edit');
    const result = await updateEventTheme({
      eventId: found.event.id, themeId, overrides, actor,
    });

    revalidatePath(`/manage/${orgSlug}/${eventSlug}/design`);
    revalidatePath(`/${orgSlug}/${eventSlug}`);
    revalidatePath(`/${orgSlug}/${eventSlug}/schedule`);
    revalidatePath(`/${orgSlug}/${eventSlug}/register`);

    return { ok: true, savedAt: Date.now(), rejected: result.rejected.length };
  } catch (e) {
    if (e instanceof UnauthenticatedError || e instanceof ForbiddenError) {
      return { ok: false, error: 'forbidden' };
    }
    if (e instanceof UnknownThemeError) return { ok: false, error: 'unknown_theme' };
    if (e instanceof ThemeUpdateError) return { ok: false, error: 'not_found' };
    console.error('保存主题失败', e);
    return { ok: false, error: 'failed' };
  }
}
