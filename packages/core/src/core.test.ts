import { describe, expect, it } from 'vitest';
import { encodeId, decodeId, InvalidIdError, isEncodedId } from './ids/index';
import {
  REGISTRATION_FLOW, SUBMISSION_FLOW, canTransitionRegistration,
  assertRegistrationTransition, InvalidTransitionError, isTerminalRegistration,
} from './state/index';
import { fieldsToZod, validateAnswers, isFieldVisible, type FormField } from './forms/types';
import { canonical, computeHash, GENESIS_HASH, generateConfirmationCode } from './audit/index';
import { detectConflicts, groupByDay } from './services/schedule';
import { buildIcs } from './ics';

const UUID = '0193b8c4-1a2b-7c3d-8e4f-5a6b7c8d9e0f';

describe('对外 ID 编码(ch09 §9.1)', () => {
  it('编码后带类型前缀,且可无损解码', () => {
    const enc = encodeId('event', UUID);
    expect(enc.startsWith('evt_')).toBe(true);
    expect(decodeId('event', enc)).toBe(UUID);
  });

  it('裸 UUID 不出现在对外 ID 中', () => {
    expect(encodeId('registration', UUID)).not.toContain(UUID);
  });

  it('跨类型引用被拒绝', () => {
    const enc = encodeId('event', UUID);
    expect(() => decodeId('registration', enc)).toThrow(InvalidIdError);
  });

  it('各类型前缀符合规格', () => {
    expect(encodeId('event', UUID).slice(0, 4)).toBe('evt_');
    expect(encodeId('registration', UUID).slice(0, 4)).toBe('reg_');
    expect(encodeId('submission', UUID).slice(0, 4)).toBe('sub_');
    expect(encodeId('order', UUID).slice(0, 4)).toBe('ord_');
    expect(encodeId('ticket', UUID).slice(0, 4)).toBe('tkt_');
    expect(encodeId('session', UUID).slice(0, 4)).toBe('ses_');
    expect(encodeId('file', UUID).slice(0, 4)).toBe('fil_');
  });

  it('非法输入被拒绝', () => {
    expect(() => encodeId('event', 'not-a-uuid')).toThrow(InvalidIdError);
    expect(isEncodedId('event', 'evt_!!!')).toBe(false);
  });
});

describe('注册状态机(ch09 §9.4)', () => {
  it('合法迁移被接受', () => {
    expect(canTransitionRegistration('pending_review', 'confirmed')).toBe(true);
    expect(canTransitionRegistration('awaiting_payment', 'confirmed')).toBe(true);
    expect(canTransitionRegistration('confirmed', 'checked_in')).toBe(true);
    expect(canTransitionRegistration('waitlisted', 'awaiting_payment')).toBe(true);
  });

  it('非法迁移抛 InvalidTransitionError(API 层映射 409)', () => {
    expect(() => assertRegistrationTransition('confirmed', 'pending_review'))
      .toThrow(InvalidTransitionError);
    try {
      assertRegistrationTransition('checked_in', 'confirmed');
    } catch (e) {
      expect((e as InvalidTransitionError).httpStatus).toBe(409);
    }
  });

  it('终态不可再变更', () => {
    for (const s of ['checked_in', 'rejected', 'cancelled', 'expired'] as const) {
      expect(isTerminalRegistration(s)).toBe(true);
      expect(REGISTRATION_FLOW[s]).toHaveLength(0);
    }
  });

  it('不存在规格外的状态(无 draft/submitted/approved/pending_payment)', () => {
    const states = Object.keys(REGISTRATION_FLOW);
    expect(states).toHaveLength(8);
    expect(states).not.toContain('draft');
    expect(states).not.toContain('approved');
    expect(states).not.toContain('pending_payment');
    expect(states).toContain('awaiting_payment');
  });
});

describe('投稿状态机(ch09 §9.4)', () => {
  it('9 个状态,discussion 不是独立状态', () => {
    const states = Object.keys(SUBMISSION_FLOW);
    expect(states).toHaveLength(9);
    expect(states).not.toContain('discussion');
    expect(states).not.toContain('waitlisted');
  });

  it('录用链条 accepted → confirmed → scheduled', () => {
    expect(SUBMISSION_FLOW.accepted).toContain('confirmed');
    expect(SUBMISSION_FLOW.confirmed).toContain('scheduled');
  });

  it('withdrawn 可从任意非终态触发', () => {
    for (const s of ['draft', 'submitted', 'under_review', 'changes_requested', 'accepted', 'confirmed', 'scheduled'] as const) {
      expect(SUBMISSION_FLOW[s]).toContain('withdrawn');
    }
  });
});

describe('字段引擎(ch09 §9.3)', () => {
  const fields: FormField[] = [
    { kind: 'short_text', key: 'name', label: 'Name', required: true },
    { kind: 'email', key: 'email', label: 'Email', required: true, pii: true },
    { kind: 'select', key: 'meal', label: 'Meal', options: [{ value: 'veg', label: 'Veg' }, { value: 'std', label: 'Std' }] },
    { kind: 'boolean', key: 'consent', label: 'Consent', required: true, consent: { legalTextId: 'p', version: 1 } },
  ];

  it('strict:拒绝未声明的键', () => {
    const r = fieldsToZod(fields).safeParse({ name: 'A', email: 'a@b.com', consent: true, evil: 1 });
    expect(r.success).toBe(false);
  });

  it('consent 必填时必须为 true', () => {
    const ok = validateAnswers(fields, { name: 'A', email: 'a@b.com', consent: true });
    expect(ok.success).toBe(true);
    const no = validateAnswers(fields, { name: 'A', email: 'a@b.com', consent: false });
    expect(no.success).toBe(false);
  });

  it('条件逻辑:隐藏字段不参与必填判断', () => {
    const conditional: FormField[] = [
      { kind: 'select', key: 'banquet', label: 'B', required: true, options: [{ value: 'yes', label: 'Y' }, { value: 'no', label: 'N' }] },
      { kind: 'select', key: 'diet', label: 'D', required: true, visibleWhen: { field: 'banquet', op: 'eq', value: 'yes' }, options: [{ value: 'veg', label: 'V' }] },
    ];
    expect(isFieldVisible(conditional[1]!, { banquet: 'no' })).toBe(false);
    expect(validateAnswers(conditional, { banquet: 'no' }).success).toBe(true);
    expect(validateAnswers(conditional, { banquet: 'yes' }).success).toBe(false);
  });

  it('E.164 电话校验', () => {
    const f: FormField[] = [{ kind: 'phone', key: 'tel', label: 'Tel', required: true, pii: true }];
    expect(validateAnswers(f, { tel: '+85212345678' }).success).toBe(true);
    expect(validateAnswers(f, { tel: '12345678' }).success).toBe(false);
  });
});

describe('审计哈希链(ch09 §9.5)', () => {
  const entry = {
    organizationId: UUID, actorType: 'user' as const, action: 'registration.confirmed',
    targetType: 'registration', targetId: UUID,
  };

  it('canonical 对键排序,保证可重算', () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });

  it('同输入同哈希,改一个字段即变', () => {
    const h1 = computeHash(GENESIS_HASH, entry);
    expect(computeHash(GENESIS_HASH, entry)).toBe(h1);
    expect(computeHash(GENESIS_HASH, { ...entry, action: 'registration.cancelled' })).not.toBe(h1);
  });

  it('链条:前序哈希改变则后续全变', () => {
    const a = computeHash(GENESIS_HASH, entry);
    expect(computeHash(a, entry)).not.toBe(computeHash('x'.repeat(64), entry));
  });

  it('确认码为 8 位无易混字符', () => {
    const code = generateConfirmationCode();
    expect(code).toHaveLength(8);
    expect(code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{8}$/);
  });
});

describe('日程冲突检测(ch05 §5.1)', () => {
  const d = (h: number) => new Date(Date.UTC(2027, 6, 5, h));

  it('同会场时间重叠即冲突', () => {
    const c = detectConflicts([
      { id: 'a', roomId: 'r1', startsAt: d(9), endsAt: d(11) },
      { id: 'b', roomId: 'r1', startsAt: d(10), endsAt: d(12) },
    ]);
    expect(c).toHaveLength(1);
  });

  it('不同会场同时间不冲突', () => {
    expect(detectConflicts([
      { id: 'a', roomId: 'r1', startsAt: d(9), endsAt: d(11) },
      { id: 'b', roomId: 'r2', startsAt: d(9), endsAt: d(11) },
    ])).toHaveLength(0);
  });

  it('首尾相接不算重叠', () => {
    expect(detectConflicts([
      { id: 'a', roomId: 'r1', startsAt: d(9), endsAt: d(10) },
      { id: 'b', roomId: 'r1', startsAt: d(10), endsAt: d(11) },
    ])).toHaveLength(0);
  });

  it('按活动时区分组,不按 UTC', () => {
    // 香港 7/5 08:00 = UTC 7/5 00:00;香港 7/6 01:00 = UTC 7/5 17:00
    const groups = groupByDay(
      [{ startsAt: new Date('2027-07-05T00:00:00Z') }, { startsAt: new Date('2027-07-05T17:00:00Z') }],
      'Asia/Hong_Kong',
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]!.day).toBe('2027-07-05');
    expect(groups[1]!.day).toBe('2027-07-06');
  });
});

describe('ICS 导出(ch10 §10.4)', () => {
  it('PRODID 为 -//yuMeet//EN,UID 用 {id}@{host}', () => {
    const ics = buildIcs(
      [{ id: 'blk_123', title: 'Opening', startsAt: new Date('2027-07-05T01:00:00Z'), endsAt: new Date('2027-07-05T01:30:00Z') }],
      { host: 'events.example.org', calendarName: 'MG18' },
    );
    expect(ics).toContain('PRODID:-//yuMeet//EN');
    expect(ics).toContain('UID:blk_123@events.example.org');
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('DTSTART:20270705T010000Z');
  });

  it('特殊字符被转义', () => {
    const ics = buildIcs(
      [{ id: 'a', title: 'A; B, C', startsAt: new Date(), endsAt: new Date() }],
      { host: 'h' },
    );
    expect(ics).toContain('SUMMARY:A\\; B\\, C');
  });
});
