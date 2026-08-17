/**
 * JsonLogic 子集求值(ch13 §13.5 的 if 段)
 *
 * 只实现规格写明的这几个算子:== != > < >= <= in and or not var。
 * 刻意不引入完整的 JsonLogic 库,也不支持自定义算子 ——
 * 规则来自组织者在后台输入的 JSON,求值器的攻击面必须小到能一眼看完。
 * 任何未知算子一律求值失败,不静默当作 false:
 * 规则写错了要让人看见,而不是悄悄不触发。
 */

export class RuleEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleEvalError';
  }
}

/** 支持的算子。新增算子必须同时更新后台的规则构建器。 */
export const OPERATORS = [
  '==', '!=', '>', '<', '>=', '<=', 'in', 'and', 'or', 'not', 'var',
] as const;

export type Operator = (typeof OPERATORS)[number];

const isOperator = (k: string): k is Operator =>
  (OPERATORS as readonly string[]).includes(k);

/**
 * 按路径取事件负载里的字段,支持 `ticket.code` 这样的点号路径。
 * 取不到返回 null —— 与 JsonLogic 的语义一致,便于写 `{"==":[{"var":"x"},null]}`。
 */
export function getPath(data: unknown, path: string): unknown {
  if (path === '') return data;
  let cur: unknown = data;
  for (const seg of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur ?? null;
}

/** 宽松相等:JSON 里数字常以字符串出现,`"5" == 5` 应为真 */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function compare(op: Operator, a: unknown, b: unknown): boolean {
  const x = typeof a === 'string' ? Number(a) : a;
  const y = typeof b === 'string' ? Number(b) : b;
  if (typeof x !== 'number' || typeof y !== 'number'
      || Number.isNaN(x) || Number.isNaN(y)) {
    throw new RuleEvalError(`${op} 只能比较数字,收到 ${JSON.stringify(a)} 与 ${JSON.stringify(b)}`);
  }
  switch (op) {
    case '>': return x > y;
    case '<': return x < y;
    case '>=': return x >= y;
    case '<=': return x <= y;
    default: return false;
  }
}

/**
 * 求值一条条件表达式。
 *
 * 注意 null 的处理:这里返回 null 而**不是** true。
 * 「整条条件为空 = 无条件」是 matches() 的语义,不是求值器的 ——
 * 混在一起会让 `{"==":[{"var":"x"}, null]}`(判断某字段是否为空)
 * 里的字面量 null 被当成 true,这类条件于是永远不成立。
 */
export function evaluate(rule: unknown, data: unknown, depth = 0): unknown {
  if (depth > 20) throw new RuleEvalError('条件嵌套过深');
  if (rule == null) return null;

  // 字面量
  if (typeof rule !== 'object' || Array.isArray(rule)) return rule;

  const keys = Object.keys(rule as Record<string, unknown>);
  if (keys.length !== 1) {
    throw new RuleEvalError(`每个条件节点只能有一个算子,收到 ${keys.length} 个`);
  }
  const op = keys[0]!;
  if (!isOperator(op)) {
    throw new RuleEvalError(`不支持的算子「${op}」,可用:${OPERATORS.join(' ')}`);
  }

  const rawArgs = (rule as Record<string, unknown>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];

  if (op === 'var') {
    const path = args[0];
    if (typeof path !== 'string') throw new RuleEvalError('var 的参数必须是字段路径字符串');
    return getPath(data, path);
  }

  // and / or 短路:条件里可能有取值失败的分支,短路能避免无谓的报错
  if (op === 'and') {
    for (const a of args) if (!truthy(evaluate(a, data, depth + 1))) return false;
    return true;
  }
  if (op === 'or') {
    for (const a of args) if (truthy(evaluate(a, data, depth + 1))) return true;
    return false;
  }
  if (op === 'not') return !truthy(evaluate(args[0], data, depth + 1));

  const left = evaluate(args[0], data, depth + 1);
  const right = evaluate(args[1], data, depth + 1);

  switch (op) {
    case '==': return looseEq(left, right);
    case '!=': return !looseEq(left, right);
    case 'in': {
      if (Array.isArray(right)) return right.some((v) => looseEq(v, left));
      if (typeof right === 'string') return right.includes(String(left));
      return false;
    }
    default: return compare(op, left, right);
  }
}

/** JS 的真值规则在这里不够用:空数组应当为假,否则「已选分会为空」写不出来 */
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return Boolean(v);
}

/** 条件是否成立。整条条件为空 = 无条件,恒为真。 */
export function matches(condition: unknown, data: unknown): boolean {
  if (condition == null) return true;
  return truthy(evaluate(condition, data));
}

/**
 * 静态校验:在保存规则时就把写错的条件挡下来,
 * 而不是等到真事件来了才在 worker 里失败。
 */
export function validateCondition(rule: unknown, depth = 0): string[] {
  const errs: string[] = [];
  if (rule == null) return errs;
  if (typeof rule !== 'object' || Array.isArray(rule)) return errs;
  if (depth > 20) return ['条件嵌套过深'];

  const keys = Object.keys(rule as Record<string, unknown>);
  if (keys.length !== 1) {
    errs.push(`每个条件节点只能有一个算子,收到 ${keys.length} 个`);
    return errs;
  }
  const op = keys[0]!;
  if (!isOperator(op)) {
    errs.push(`不支持的算子「${op}」`);
    return errs;
  }
  const rawArgs = (rule as Record<string, unknown>)[op];
  const args = Array.isArray(rawArgs) ? rawArgs : [rawArgs];
  if (op === 'var') {
    if (typeof args[0] !== 'string') errs.push('var 的参数必须是字段路径字符串');
    return errs;
  }
  if (op !== 'and' && op !== 'or' && op !== 'not' && args.length !== 2) {
    errs.push(`${op} 需要两个参数,收到 ${args.length} 个`);
  }
  for (const a of args) errs.push(...validateCondition(a, depth + 1));
  return errs;
}
