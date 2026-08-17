'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  submitRegistration, RegistrationError, getEventBySlug, decodeId,
  type FormField,
} from '@yumeet/core';

export interface ActionState {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

/**
 * 提交报名 —— Server Action 进程内调用 packages/core(无 RPC 层,见 PLAN.md §0.3)
 */
export async function submitRegistrationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const orgSlug = String(formData.get('__org') ?? '');
  const eventSlug = String(formData.get('__event') ?? '');
  const formId = String(formData.get('__formId') ?? '');
  const ticketPublicId = String(formData.get('__ticketId') ?? '');
  const email = String(formData.get('email') ?? '').trim();

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  if (!email) return { ok: false, error: '请填写邮箱', fieldErrors: { email: '必填' } };

  // 表单字段 → answers(按字段定义解析类型)
  const forms = found.event;
  const answers: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith('__') || key === 'email') continue;
    const raw = String(value);
    if (raw === '') continue;
    // checkbox_group 多值
    const all = formData.getAll(key).map(String).filter((v) => v !== '');
    if (all.length > 1) { answers[key] = all; continue; }
    if (raw === 'on') { answers[key] = true; continue; }
    answers[key] = raw;
  }

  // affiliation 是对象 { name, rorId? }
  if (typeof answers['affiliation'] === 'string') {
    answers['affiliation'] = { name: answers['affiliation'] };
  }
  // checkbox_group 单选时也应是数组
  if (typeof answers['sessions_interest'] === 'string') {
    answers['sessions_interest'] = [answers['sessions_interest']];
  }
  answers['email'] = email;

  let ticketId: string | null = null;
  if (ticketPublicId) {
    try { ticketId = decodeId('ticket', ticketPublicId); }
    catch { return { ok: false, error: '票种无效' }; }
  }

  const hdrs = await headers();
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;

  let trackingPath: string;
  try {
    const result = await submitRegistration({
      eventId: found.event.id,
      formId,
      email,
      answers,
      ticketId,
      actor: { type: 'user', ip },
    });
    trackingPath = result.trackingPath;
  } catch (e) {
    if (e instanceof RegistrationError) {
      return { ok: false, error: e.message };
    }
    console.error('报名失败', e);
    return { ok: false, error: '提交失败,请稍后重试' };
  }

  revalidatePath(`/${orgSlug}/${eventSlug}`);
  // 报名成功 → 直接进追踪页(状态透明原则)
  redirect(trackingPath);
}
