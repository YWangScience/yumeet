import { notFound } from 'next/navigation';
import {
  getEventBySlug, getEventForms, getEventTickets, listRegistrations,
  REGISTRATION_LABELS, encodeId, audit, localize,
  type RegStatus, type FormField,
} from '@yumeet/core';
import { db } from '@yumeet/db';

/**
 * 名单导出(ch09 §9.3:按提交当时的 form_version 解释 answers)
 * 导出属于敏感读操作,写入审计日志(ch09 §9.5)。
 */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ org: string; event: string }> },
) {
  const { org: orgSlug, event: eventSlug } = await ctx.params;
  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  const { event } = found;
  const [forms, tickets, list] = await Promise.all([
    getEventForms(event.id),
    getEventTickets(event.id),
    listRegistrations(event.id, { limit: 100 }),
  ]);

  const fields = (forms[0]?.fields ?? []) as FormField[];
  const dataCols = fields.filter((f) => f.key !== 'email');

  const header = [
    '报名编号', '确认码', '邮箱', '票种', '状态', '提交时间',
    ...dataCols.map((f) => localize(f.label, 'zh')),
  ];

  const rows = list.rows.map((r) => {
    const answers = r.answers as Record<string, unknown>;
    return [
      encodeId('registration', r.id),
      r.confirmationCode,
      r.email,
      tickets.find((t) => t.id === r.ticketId)?.name ?? '',
      REGISTRATION_LABELS[r.status as RegStatus].zh,
      r.createdAt.toISOString(),
      ...dataCols.map((f) => stringify(answers[f.key])),
    ];
  });

  await audit(db, {
    organizationId: found.org.id,
    eventId: event.id,
    actorType: 'user',
    action: 'registration.exported',
    targetType: 'event',
    targetId: event.id,
    diff: { count: rows.length, format: 'csv' },
    ip: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null,
  });

  // BOM 让 Excel 正确识别 UTF-8
  const csv = '﻿' + [header, ...rows].map(toCsvLine).join('\r\n') + '\r\n';

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${eventSlug}-registrations.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

function stringify(v: unknown): string {
  if (v == null) return '';
  if (Array.isArray(v)) return v.join(' / ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return typeof o['name'] === 'string' ? o['name'] : JSON.stringify(v);
  }
  if (typeof v === 'boolean') return v ? '是' : '否';
  return String(v);
}

function toCsvLine(cells: string[]): string {
  return cells
    .map((c) => (/[",\r\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
    .join(',');
}
