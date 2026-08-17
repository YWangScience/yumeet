'use server';

import { revalidatePath } from 'next/cache';
import {
  getEventBySlug, saveRule, deleteRule, dryRunRule, validateRule,
  RuleError, ForbiddenError, type RuleAction, type RuleCondition,
} from '@yumeet/core';
import { actorWithCapability, UnauthenticatedError } from '@/lib/authz';

export interface RuleFormState {
  ok: boolean;
  error?: string;
  savedId?: string;
}

/** 规则里 if / then 两段以 JSON 文本输入,解析失败要指出是哪一段 */
function parseJson(raw: string, label: string): unknown {
  const t = raw.trim();
  if (t === '') return null;
  try {
    return JSON.parse(t);
  } catch (e) {
    throw new RuleError('bad_json', `${label}不是合法 JSON:${e instanceof Error ? e.message : ''}`);
  }
}

function toMessage(e: unknown): string {
  if (e instanceof UnauthenticatedError) return '请先登录';
  if (e instanceof ForbiddenError) return '没有管理自动化规则的权限';
  if (e instanceof RuleError) return e.message;
  console.error('自动化规则操作失败', e);
  return '操作失败,请重试';
}

export async function saveRuleAction(
  orgSlug: string, eventSlug: string,
  _prev: RuleFormState, fd: FormData,
): Promise<RuleFormState> {
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };

  try {
    const actor = await actorWithCapability(found.event.id, 'event.edit');
    const condition = parseJson(String(fd.get('condition') ?? ''), '条件(if)') as RuleCondition | null;
    const then = parseJson(String(fd.get('then') ?? '[]'), '动作(then)') as RuleAction[];

    const input = {
      id: String(fd.get('id') ?? '') || undefined,
      organizationId: found.org.id,
      eventId: found.event.id,
      name: String(fd.get('name') ?? '').trim(),
      trigger: String(fd.get('trigger') ?? ''),
      condition,
      then: Array.isArray(then) ? then : [then],
      enabled: fd.get('enabled') != null,
      actorId: actor.id ?? null,
    };

    // 先给出全部问题再返回,而不是让人一次改一个
    const errs = validateRule(input);
    if (errs.length) return { ok: false, error: errs.join(';') };

    const { id } = await saveRule(input);
    revalidatePath(`/manage/${orgSlug}/${eventSlug}/automation`);
    return { ok: true, savedId: id };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export async function deleteRuleAction(
  orgSlug: string, eventSlug: string, ruleId: string,
): Promise<{ ok: boolean; error?: string }> {
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };
  try {
    const actor = await actorWithCapability(found.event.id, 'event.edit');
    await deleteRule(ruleId, actor.id ?? null);
    revalidatePath(`/manage/${orgSlug}/${eventSlug}/automation`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}

export interface DryRunResult {
  ok: boolean;
  error?: string;
  replayed?: number;
  wouldMatch?: number;
  samples?: { ruleName: string; matched: boolean; actions: { type: string; ok: boolean; preview?: string; error?: string }[] }[];
}

/** 试运行:只回放,不执行 —— 启用一条规则前应当先看这个 */
export async function dryRunRuleAction(
  orgSlug: string, eventSlug: string, ruleId: string,
): Promise<DryRunResult> {
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) return { ok: false, error: '活动不存在' };
  try {
    await actorWithCapability(found.event.id, 'event.edit');
    const r = await dryRunRule(ruleId, 100);
    return { ok: true, replayed: r.replayed, wouldMatch: r.wouldMatch, samples: r.samples };
  } catch (e) {
    return { ok: false, error: toMessage(e) };
  }
}
