'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  reconcileOfflinePayment, PaymentError, InvalidTransitionError,
  getEventBySlug, requireCapability, ForbiddenError,
  savePaymentConfig, type PaymentConfig,
} from '@yumeet/core';
import { requireUser } from '@/lib/session';

export interface ReconcileResult { ok: boolean; error?: string; confirmed?: number }

/**
 * 确认一笔线下到账。
 * 布局层已挡住未登录者,这里再校验一次能力 —— 涉及资金的操作不依赖单点防御。
 */
export async function reconcileAction(input: {
  orderId: string; orgSlug: string; eventSlug: string; note?: string;
}): Promise<ReconcileResult> {
  const found = await getEventBySlug(input.orgSlug, input.eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  const user = await requireUser();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  try {
    await requireCapability(user.id, found.event.id, 'registration.manage');
    const r = await reconcileOfflinePayment(
      input.orderId,
      { type: 'user', id: user.id, ip },
      { note: input.note },
    );
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}/payments`);
    revalidatePath(`/manage/${input.orgSlug}/${input.eventSlug}`);
    return { ok: true, confirmed: r.registrationIds.length };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: '没有核销权限' };
    if (e instanceof PaymentError) return { ok: false, error: e.message };
    if (e instanceof InvalidTransitionError) {
      return { ok: false, error: `报名状态不允许该操作(${e.from} → ${e.to})` };
    }
    console.error('核销失败', e);
    return { ok: false, error: '操作失败,请重试' };
  }
}

export interface ConfigResult { ok: boolean; error?: string }

/** FormData 取值:空串一律当作「没填」,避免把空字符串写进账户信息 */
const s = (fd: FormData, k: string): string | undefined => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? undefined : v;
};
const i18n = (fd: FormData, k: string) => {
  const zh = s(fd, `${k}_zh`); const en = s(fd, `${k}_en`);
  return zh || en ? { zh: zh ?? en!, en: en ?? zh! } : undefined;
};

/**
 * 保存收款配置。
 *
 * 配置项本身就是给参会者看的文案与账号,所以按「哪种方式勾了就必须填全」来校验:
 * 勾了银行转账却没有账号,付款页会变成一张只写着金额的白纸。
 */
export async function savePaymentConfigAction(
  orgSlug: string, eventSlug: string, _prev: ConfigResult, fd: FormData,
): Promise<ConfigResult> {
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  const user = await requireUser();
  const h = await headers();
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  const enabled = fd.getAll('enabled').map(String) as PaymentConfig['enabled'];
  if (enabled.length === 0) return { ok: false, error: '至少启用一种付款方式' };

  const cfg: PaymentConfig = { enabled };

  if (enabled.includes('bank_transfer')) {
    const accountName = s(fd, 'bank_accountName');
    const accountNumber = s(fd, 'bank_accountNumber');
    const bankName = s(fd, 'bank_bankName');
    if (!accountName || !accountNumber || !bankName) {
      return { ok: false, error: '启用银行转账时,户名、账号、开户行都必须填写' };
    }
    cfg.bankTransfer = {
      accountName, accountNumber, bankName,
      swift: s(fd, 'bank_swift'), iban: s(fd, 'bank_iban'),
      memoHint: i18n(fd, 'bank_memoHint'), instructions: i18n(fd, 'bank_instructions'),
    };
  }
  for (const m of ['alipay', 'wechat'] as const) {
    if (!enabled.includes(m)) continue;
    const qrUrl = s(fd, `${m}_qrUrl`);
    if (!qrUrl) return { ok: false, error: `启用${m === 'alipay' ? '支付宝' : '微信'}时需要收款码图片地址` };
    cfg[m] = { qrUrl, payee: s(fd, `${m}_payee`), instructions: i18n(fd, `${m}_instructions`) };
  }
  if (enabled.includes('onsite')) {
    cfg.onsite = { accepts: i18n(fd, 'onsite_accepts'), instructions: i18n(fd, 'onsite_instructions') };
  }
  cfg.offlineDeadlineHint = i18n(fd, 'offlineDeadlineHint');

  try {
    await requireCapability(user.id, found.event.id, 'event.edit');
    await savePaymentConfig(found.event.id, cfg, { type: 'user', id: user.id, ip });
    revalidatePath(`/manage/${orgSlug}/${eventSlug}/payments`);
    return { ok: true };
  } catch (e) {
    if (e instanceof ForbiddenError) return { ok: false, error: '没有修改活动设置的权限(需要 event.edit)' };
    if (e instanceof PaymentError) return { ok: false, error: e.message };
    console.error('保存收款配置失败', e);
    return { ok: false, error: '保存失败,请重试' };
  }
}
