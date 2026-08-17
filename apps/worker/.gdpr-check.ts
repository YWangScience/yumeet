/* 临时验收脚本(用完即删):GDPR 权利端到端 */
import { eq } from 'drizzle-orm';
import { db, sql as pgSql, events, organizations, registrationForms } from '@yumeet/db';
import {
  submitRegistration, exportRegistrationData, correctRegistrationAnswers,
  setProcessingRestriction, requestErasure, confirmErasure, loadDataSubject, verifyChain,
} from '@yumeet/core';

const DAY = 86_400_000;

async function setup(): Promise<void> {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, 'icranet')).limit(1);
  if (!org) throw new Error('org 不存在');
  const now = new Date();

  const [ev] = await db.insert(events).values({
    organizationId: org.id,
    slug: `gdpr-probe-${Date.now()}`,
    title: 'GDPR probe (test)',
    startsAt: new Date(now.getTime() + 60 * DAY),
    endsAt: new Date(now.getTime() + 63 * DAY),
    timezone: 'UTC',
    status: 'published',
    visibility: 'private',
    modules: { registration: true },
  }).returning();

  const fields = [
    { kind: 'short_text', key: 'full_name', label: { en: 'Full name', zh: '姓名' }, pii: true, required: true },
    { kind: 'long_text', key: 'accessibility', label: { en: 'Accessibility requirements', zh: '无障碍需求' }, pii: true },
    { kind: 'select', key: 'dietary', label: { en: 'Dietary requirements', zh: '饮食要求' },
      options: [{ value: 'vegetarian', label: { en: 'Vegetarian', zh: '素食' } },
                { value: 'none', label: { en: 'None', zh: '无' } }] },
    { kind: 'select', key: 'career_stage', label: { en: 'Career stage', zh: '职业阶段' }, required: true,
      options: [{ value: 'phd', label: { en: 'PhD student', zh: '博士生' } },
                { value: 'faculty', label: { en: 'Faculty', zh: '教职' } }] },
  ];

  const [form] = await db.insert(registrationForms).values({
    eventId: ev!.id, name: 'GDPR probe form', fields: fields as never, version: 1,
    approvalRequired: true, // → pending_review,便于验证「确认前可更正」
  }).returning();

  const res = await submitRegistration({
    eventId: ev!.id,
    formId: form!.id,
    email: `gdpr-probe-${Date.now()}@example.org`,
    answers: {
      full_name: 'Ada Lovelace',
      accessibility: 'Step-free access to the lecture hall',
      dietary: 'vegetarian',
      career_stage: 'faculty',
    },
  });

  console.log(JSON.stringify({
    eventSlug: ev!.slug, registrationId: res.registrationId,
    status: res.status, token: res.accessToken, trackingPath: res.trackingPath,
  }, null, 2));
}

async function rights(token: string): Promise<void> {
  console.log('--- Art.16 更正:把 career_stage 改成 phd,并补一句无障碍需求 ---');
  const corrected = await correctRegistrationAnswers(token, {
    career_stage: 'phd',
    accessibility: 'Step-free access and a reserved front-row seat',
  }, { actor: { type: 'user', ip: '203.0.113.7' } });
  console.log(JSON.stringify(corrected, null, 2));

  console.log('--- Art.18/21 限制处理:退出公开名单 ---');
  console.log(JSON.stringify(
    await setProcessingRestriction(token, { listOptOut: true }, { actor: { type: 'user' } }), null, 2));

  console.log('--- Art.17 删除:第 1 步 requestErasure ---');
  const req = await requestErasure(token, { actor: { type: 'user' } });
  console.log(JSON.stringify({ ...req, confirmationToken: `${req.confirmationToken.slice(0, 6)}…` }, null, 2));

  console.log('--- Art.17 删除:错误令牌应被拒绝 ---');
  try {
    await confirmErasure(token, 'not-the-right-token', { actor: { type: 'user' } });
    console.log('!! 未被拒绝,异常');
  } catch (e) {
    console.log('拒绝:', (e as Error).message);
  }

  console.log('--- Art.17 删除:第 2 步 confirmErasure ---');
  const done = await confirmErasure(token, req.confirmationToken, { actor: { type: 'user' } });
  console.log(JSON.stringify(done, null, 2));

  const after = await loadDataSubject(token);
  console.log('--- 删除后的记录 ---');
  console.log(JSON.stringify({
    email: after?.registration.email, answers: after?.registration.answers,
    erased: after?.erased, correctable: after?.correctable,
  }, null, 2));

  console.log('--- 审计哈希链校验 ---');
  console.log(JSON.stringify(await verifyChain(db)));
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'setup';
  if (mode === 'setup') await setup();
  else if (mode === 'export') {
    const data = await exportRegistrationData(process.argv[3]!, { actor: { type: 'user' } });
    console.log(JSON.stringify(data, null, 2));
  } else if (mode === 'rights') await rights(process.argv[3]!);
  await pgSql.end({ timeout: 5 });
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
