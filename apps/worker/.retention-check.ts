/* 临时验收脚本(用完即删):setup → dry → run,配合 SQL 做前后对比 */
import { eq } from 'drizzle-orm';
import {
  db, sql as pgSql, events, organizations, registrationForms, registrations, users,
} from '@yumeet/db';
import {
  runRetention, formatRetentionReport, generateAccessToken, hashToken, generateConfirmationCode,
} from '@yumeet/core';

const DAY = 86_400_000;

async function setup(): Promise<void> {
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, 'icranet')).limit(1);
  if (!org) throw new Error('org 不存在');

  const now = new Date();
  const endsAt = new Date(now.getTime() - 800 * DAY); // 结束 800 天,已超过 retentionDays=730

  const [ev] = await db.insert(events).values({
    organizationId: org.id,
    slug: `retention-probe-${Date.now()}`,
    title: 'Retention probe (test)',
    startsAt: new Date(endsAt.getTime() - 3 * DAY),
    endsAt,
    timezone: 'UTC',
    status: 'draft',
    visibility: 'private',
  }).returning();

  const fields = [
    { kind: 'email', key: 'email', label: { en: 'Email', zh: '邮箱' }, pii: true, required: true },
    { kind: 'short_text', key: 'full_name', label: { en: 'Full name', zh: '姓名' }, pii: true },
    { kind: 'long_text', key: 'accessibility', label: { en: 'Accessibility requirements', zh: '无障碍需求' }, pii: true },
    { kind: 'select', key: 'dietary', label: { en: 'Dietary requirements', zh: '饮食要求' },
      options: [{ value: 'vegetarian', label: { en: 'Vegetarian', zh: '素食' } }] },
    { kind: 'select', key: 'participant_type', label: { en: 'Participant type', zh: '参会类型' },
      options: [{ value: 'faculty', label: { en: 'Faculty', zh: '教职' } }] },
  ];

  const [form] = await db.insert(registrationForms).values({
    eventId: ev!.id, name: 'Retention probe form', fields: fields as never, version: 1,
  }).returning();

  const [user] = await db.insert(users).values({
    email: `probe-${Date.now()}@example.org`, name: 'Probe Person', isGuest: true,
  }).returning();

  const token = generateAccessToken();
  const [reg] = await db.insert(registrations).values({
    eventId: ev!.id, formId: form!.id, formVersion: 1, userId: user!.id,
    email: 'probe.person@example.org',
    answers: {
      email: 'probe.person@example.org',
      full_name: 'Probe Person',
      accessibility: 'Wheelchair access required',
      dietary: 'vegetarian',
      participant_type: 'faculty',
    },
    status: 'confirmed',
    confirmationCode: generateConfirmationCode(),
    accessTokenHash: hashToken(token),
    confirmedAt: new Date(endsAt.getTime() - 10 * DAY),
    createdAt: new Date(now.getTime() - 800 * DAY),
    updatedAt: new Date(now.getTime() - 800 * DAY),
  }).returning();

  console.log(JSON.stringify({
    orgId: org.id, eventId: ev!.id, formId: form!.id,
    registrationId: reg!.id, userId: user!.id, trackingToken: token,
  }, null, 2));
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'setup';
  if (mode === 'setup') {
    await setup();
  } else {
    const [org] = await db.select().from(organizations).where(eq(organizations.slug, 'icranet')).limit(1);
    const report = await runRetention({ dryRun: mode === 'dry', organizationId: org?.id });
    for (const l of formatRetentionReport(report)) console.log(l);
  }
  await pgSql.end({ timeout: 5 });
}

main().catch((e: unknown) => { console.error(e); process.exit(1); });
