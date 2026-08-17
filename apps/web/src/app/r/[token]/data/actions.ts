'use server';

/**
 * 参会者数据权利的 Server Actions(ch12 §12.4)。
 * 业务逻辑全在 @yumeet/core 的 gdpr 服务里,这里只做 FormData ↔ 类型的搬运与错误映射
 * (PLAN.md §0.3:Server Actions 进程内调用 core,不引入 RPC 层)。
 */
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  loadDataSubject, correctRegistrationAnswers, setProcessingRestriction,
  requestErasure, confirmErasure, GdprError, type FormField,
} from '@yumeet/core';
import { t, normalizeLocale, type Locale, type TKey } from '@/lib/i18n';

export interface CorrectionState {
  ok: boolean;
  message?: string;
  error?: string;
  changed?: number;
}

export interface PrefsState {
  ok: boolean;
  message?: string;
  error?: string;
}

export type ErasureStage = 'idle' | 'confirm' | 'done';

export interface ErasureState {
  stage: ErasureStage;
  error?: string;
  confirmationToken?: string;
  expiresAt?: string;
  willClear?: string[];
  willRetainMasked?: string[];
  erasedAt?: string;
}

const ERROR_KEYS: Record<string, TKey> = {
  not_correctable: 'drErrNotCorrectable',
  erased: 'drErrErased',
  already_erased: 'drErrErased',
  validation_failed: 'errValidation',
  request_expired: 'drErrExpiredRequest',
  no_pending_request: 'drErrBadConfirmation',
  bad_confirmation: 'drErrBadConfirmation',
};

function messageFor(err: unknown, locale: Locale): string {
  if (err instanceof GdprError) {
    const key = ERROR_KEYS[err.code];
    if (key) return t(locale, key);
    return err.message;
  }
  console.error('数据权利操作失败', err);
  return t(locale, 'drErrGeneric');
}

async function actorIp(): Promise<string | null> {
  const hdrs = await headers();
  return hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
}

function localeOf(formData: FormData): Locale {
  return normalizeLocale(String(formData.get('__lang') ?? ''));
}

/** 表单值 → 字段定义声明的类型(与 register 的解析口径一致) */
function coerce(field: FormField, formData: FormData): unknown {
  const raw = formData.getAll(`f_${field.key}`).map(String).filter((v) => v !== '');
  const first = raw[0];
  switch (field.kind) {
    case 'checkbox_group':
      return raw;
    case 'boolean':
      return first === 'on' || first === 'true';
    case 'number':
      return first == null ? undefined : Number(first);
    case 'affiliation':
      return first == null ? undefined : { name: first };
    default:
      return first;
  }
}

/** Art. 16 更正权:修改自己报名表单的答案(报名未确认前) */
export async function correctAnswersAction(
  _prev: CorrectionState,
  formData: FormData,
): Promise<CorrectionState> {
  const locale = localeOf(formData);
  const token = String(formData.get('__token') ?? '');
  const subject = await loadDataSubject(token);
  if (!subject) return { ok: false, error: t(locale, 'drErrGeneric') };

  const patch: Record<string, unknown> = {};
  for (const field of subject.fields) {
    if (field.kind === 'file' || field.kind === 'capacity_option') continue; // 库存与文件不走自助更正
    if (!formData.has(`f_${field.key}`) && field.kind !== 'boolean' && field.kind !== 'checkbox_group') continue;
    patch[field.key] = coerce(field, formData);
  }

  try {
    const result = await correctRegistrationAnswers(token, patch, {
      actor: { type: 'user', ip: await actorIp() },
    });
    revalidatePath(`/r/${token}/data`);
    revalidatePath(`/r/${token}`);
    return {
      ok: true,
      changed: result.changedKeys.length,
      message: result.changedKeys.length === 0
        ? t(locale, 'drNoChanges')
        : t(locale, 'drCorrected', { n: result.changedKeys.length }),
    };
  } catch (err) {
    return { ok: false, error: messageFor(err, locale) };
  }
}

/** Art. 18 限制处理 / Art. 21 反对:名单展示与处理冻结 */
export async function savePrefsAction(
  _prev: PrefsState,
  formData: FormData,
): Promise<PrefsState> {
  const locale = localeOf(formData);
  const token = String(formData.get('__token') ?? '');
  try {
    await setProcessingRestriction(token, {
      listOptOut: formData.get('listOptOut') === 'on',
      restricted: formData.get('restricted') === 'on',
    }, { actor: { type: 'user', ip: await actorIp() } });
    revalidatePath(`/r/${token}/data`);
    return { ok: true, message: t(locale, 'drPrefsSaved') };
  } catch (err) {
    return { ok: false, error: messageFor(err, locale) };
  }
}

/**
 * Art. 17 删除权 —— 第 1 步:提交请求,取得二次确认令牌。
 * 本步不删除任何数据(core 层的两步 API:requestErasure → confirmErasure)。
 */
export async function requestErasureAction(
  _prev: ErasureState,
  formData: FormData,
): Promise<ErasureState> {
  const locale = localeOf(formData);
  const token = String(formData.get('__token') ?? '');
  try {
    const req = await requestErasure(token, { actor: { type: 'user', ip: await actorIp() } });
    return {
      stage: 'confirm',
      confirmationToken: req.confirmationToken,
      expiresAt: req.expiresAt,
      willClear: req.willClear,
      willRetainMasked: req.willRetainMasked,
    };
  } catch (err) {
    return { stage: 'idle', error: messageFor(err, locale) };
  }
}

/** Art. 17 删除权 —— 第 2 步:二次确认,立即匿名化(不可逆) */
export async function confirmErasureAction(
  prev: ErasureState,
  formData: FormData,
): Promise<ErasureState> {
  const locale = localeOf(formData);
  const token = String(formData.get('__token') ?? '');
  const confirmationToken = String(formData.get('__confirm') ?? '');
  const typed = String(formData.get('confirmPhrase') ?? '').trim().toUpperCase();

  if (typed !== 'DELETE') {
    return { ...prev, error: t(locale, 'drErrTypeDelete') };
  }

  try {
    const result = await confirmErasure(token, confirmationToken, {
      actor: { type: 'user', ip: await actorIp() },
    });
    revalidatePath(`/r/${token}/data`);
    revalidatePath(`/r/${token}`);
    return { stage: 'done', erasedAt: result.erasedAt };
  } catch (err) {
    return { ...prev, error: messageFor(err, locale) };
  }
}
