/**
 * 自定义字段引擎(ch09 §9.3)
 * 15 种 kind 的完整可辨识联合,与 ch04 §4.2 字段类型表一一对应。
 * 前端渲染器与服务端校验器消费同一份定义,不存在两套字段描述漂移的可能。
 */
import { z } from 'zod';

export type I18nString = string | Record<string, string>;

export interface Condition {
  field: string;
  op: 'eq' | 'neq' | 'in' | 'gt' | 'lt' | 'truthy';
  value?: unknown;
}

interface Base {
  key: string;
  label: I18nString;
  help?: I18nString;
  required?: boolean;
  /** pii: true 的字段参与 ch09 §9.5 的匿名化清除 */
  pii?: boolean;
  /** 条件逻辑(ch04 §4.2) */
  visibleWhen?: Condition;
}

export interface SelectOption {
  value: string;
  label: I18nString;
}

export interface CapacityOption extends SelectOption {
  capacity: number | null;
  waitlist?: boolean;
}

export type FormField =
  | (Base & { kind: 'short_text'; maxLength?: number })
  | (Base & { kind: 'long_text'; maxLength?: number })
  | (Base & { kind: 'email'; pii: true })
  | (Base & { kind: 'phone'; pii: true })
  | (Base & { kind: 'number'; min?: number; max?: number })
  | (Base & { kind: 'date' })
  | (Base & { kind: 'select'; options: SelectOption[] })
  | (Base & { kind: 'radio'; options: SelectOption[] })
  | (Base & { kind: 'checkbox_group'; options: SelectOption[]; minChecked?: number })
  | (Base & { kind: 'boolean'; consent?: { legalTextId: string; version: number } })
  | (Base & { kind: 'country' })
  | (Base & { kind: 'url' })
  | (Base & { kind: 'file'; accept?: string[]; maxSizeMb?: number })
  | (Base & { kind: 'affiliation' })
  | (Base & { kind: 'capacity_option'; options: CapacityOption[] });

export type FormFieldKind = FormField['kind'];

export const ALL_FIELD_KINDS: readonly FormFieldKind[] = [
  'short_text', 'long_text', 'email', 'phone', 'number', 'date',
  'select', 'radio', 'checkbox_group', 'boolean', 'country', 'url',
  'file', 'affiliation', 'capacity_option',
] as const;

/** 运行时把字段定义编译为 Zod schema,服务端提交校验的唯一入口(ch09 §9.3) */
export function fieldsToZod(fields: FormField[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.kind) {
      case 'short_text':
        s = z.string().trim().max(f.maxLength ?? 500);
        break;
      case 'long_text':
        s = z.string().trim().max(f.maxLength ?? 5000);
        break;
      case 'email':
        s = z.string().email();
        break;
      case 'phone':
        // E.164;深校验用 libphonenumber refine
        s = z.string().regex(/^\+[1-9]\d{1,14}$/);
        break;
      case 'number':
        s = z.number().min(f.min ?? -1e9).max(f.max ?? 1e9);
        break;
      case 'date':
        s = z.string().date();
        break;
      case 'select':
      case 'radio': {
        const values = f.options.map((o) => o.value) as [string, ...string[]];
        s = z.enum(values);
        break;
      }
      case 'checkbox_group': {
        const values = f.options.map((o) => o.value) as [string, ...string[]];
        s = z.array(z.enum(values)).min(f.minChecked ?? 0);
        break;
      }
      case 'boolean':
        // consent 变体且必填时必须勾选为 true,不同意即无法提交
        s = f.consent && f.required ? z.literal(true) : z.boolean();
        break;
      case 'country':
        s = z.string().length(2); // ISO 3166-1 alpha-2
        break;
      case 'url':
        s = z.string().url();
        break;
      case 'affiliation':
        s = z.object({
          name: z.string().trim().min(1),
          rorId: z.string().optional(),
        });
        break;
      case 'capacity_option': {
        const values = f.options.map((o) => o.value) as [string, ...string[]];
        // 余量校验不在 schema 层,在事务内随库存扣减完成(ch13 §13.3)
        s = z.enum(values);
        break;
      }
      case 'file':
        s = z.string().uuid(); // 引用 files.id
        break;
    }
    shape[f.key] = f.required ? s : s.optional();
  }
  return z.object(shape).strict(); // strict:拒绝任何未声明的键
}

/** 条件逻辑求值(ch04 §4.2):字段在当前答案下是否可见 */
export function isFieldVisible(field: FormField, answers: Record<string, unknown>): boolean {
  const c = field.visibleWhen;
  if (!c) return true;
  const actual = answers[c.field];
  switch (c.op) {
    case 'eq': return actual === c.value;
    case 'neq': return actual !== c.value;
    case 'in': return Array.isArray(c.value) && c.value.includes(actual);
    case 'gt': return typeof actual === 'number' && typeof c.value === 'number' && actual > c.value;
    case 'lt': return typeof actual === 'number' && typeof c.value === 'number' && actual < c.value;
    case 'truthy': return Boolean(actual);
  }
}

/** 校验提交:隐藏字段不参与必填判断 */
export function validateAnswers(fields: FormField[], answers: Record<string, unknown>) {
  const visible = fields.filter((f) => isFieldVisible(f, answers));
  const pruned: Record<string, unknown> = {};
  for (const f of visible) {
    if (answers[f.key] !== undefined && answers[f.key] !== '') pruned[f.key] = answers[f.key];
  }
  return fieldsToZod(visible).safeParse(pruned);
}

export function localize(value: I18nString, locale = 'zh'): string {
  if (typeof value === 'string') return value;
  return value[locale] ?? value['en'] ?? Object.values(value)[0] ?? '';
}

/** 匿名化时需清空的字段键(ch09 §9.5) */
export function piiKeys(fields: FormField[]): string[] {
  return fields.filter((f) => f.pii).map((f) => f.key);
}
