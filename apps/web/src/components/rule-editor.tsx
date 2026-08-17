'use client';

import { useActionState, useState, useTransition } from 'react';
import type { RuleFormState, DryRunResult } from
  '@/app/manage/[org]/[event]/automation/actions';
import styles from './rule-editor.module.css';

export interface RuleView {
  id: string;
  name: string;
  trigger: string;
  condition: unknown;
  then: unknown;
  enabled: boolean;
  failures: number;
  lastRun: string | null;
}

interface Props {
  rule: RuleView | null;
  triggers: readonly string[];
  actions: readonly string[];
  saveAction: (prev: RuleFormState, fd: FormData) => Promise<RuleFormState>;
  deleteAction: (ruleId: string) => Promise<{ ok: boolean; error?: string }>;
  dryRunAction: (ruleId: string) => Promise<DryRunResult>;
}

const pretty = (v: unknown) => (v == null ? '' : JSON.stringify(v, null, 2));

/**
 * 规则编辑器 —— 渐进披露:触发器与开关是点选的,
 * if / then 两段用 JSON 直接编辑。规格要求「简单场景点选、高级场景编 JSON」,
 * 这里先把高级路径做扎实:JSON 是规则的事实形态,点选构建器是它的一层皮,
 * 反过来做会让两者语义漂移。
 */
export function RuleEditor({
  rule, triggers, actions, saveAction, deleteAction, dryRunAction,
}: Props) {
  const [state, formAction, pending] = useActionState(saveAction, { ok: false });
  const [dry, setDry] = useState<DryRunResult | null>(null);
  const [busy, start] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className={styles.editor}>
      <form action={formAction} className={styles.form}>
        {rule && <input type="hidden" name="id" value={rule.id} />}

        <div className={styles.row}>
          <label className={styles.label} htmlFor="name">规则名</label>
          <input
            id="name" name="name" className={styles.input} required
            defaultValue={rule?.name ?? ''} placeholder="学生票自动打标签"
          />
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="trigger">当(when)</label>
          <select id="trigger" name="trigger" className={styles.input} defaultValue={rule?.trigger ?? triggers[0]}>
            {triggers.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="condition">若(if)</label>
          <textarea
            id="condition" name="condition" className={styles.code} rows={5}
            defaultValue={pretty(rule?.condition)}
            placeholder={'{ "==": [ { "var": "ticket.code" }, "student" ] }'}
            spellCheck={false}
          />
          <p className={styles.help}>
            留空表示无条件。可用算子:== != &gt; &lt; &gt;= &lt;= in and or not var
          </p>
        </div>

        <div className={styles.row}>
          <label className={styles.label} htmlFor="then">则(then)</label>
          <textarea
            id="then" name="then" className={styles.code} rows={7}
            defaultValue={pretty(rule?.then) || '[\n  { "type": "tag.add", "params": { "tag": "student" } }\n]'}
            spellCheck={false}
          />
          <p className={styles.help}>可用动作:{actions.join('、')}</p>
        </div>

        <label className={styles.checkRow}>
          <input type="checkbox" name="enabled" defaultChecked={rule?.enabled ?? false} />
          <span>启用这条规则</span>
        </label>

        <div className={styles.actionsRow}>
          <button type="submit" className={styles.save} disabled={pending}>
            {pending ? '保存中…' : rule ? '保存修改' : '新建规则'}
          </button>

          {rule && (
            <>
              <button
                type="button" className={styles.ghost} disabled={busy}
                onClick={() => start(async () => setDry(await dryRunAction(rule.id)))}
              >
                {busy ? '回放中…' : '试运行'}
              </button>
              <button
                type="button"
                className={confirmDelete ? styles.dangerArmed : styles.danger}
                onClick={() => {
                  if (!confirmDelete) { setConfirmDelete(true); return; }
                  start(async () => { await deleteAction(rule.id); });
                }}
              >
                {confirmDelete ? '确认删除?' : '删除'}
              </button>
            </>
          )}
        </div>

        {state.error && <p className={styles.error} role="alert">{state.error}</p>}
        {state.ok && <p className={styles.ok} role="status">已保存</p>}
      </form>

      {dry && (
        <section className={styles.dryRun} aria-live="polite">
          <h3 className={styles.dryTitle}>试运行结果</h3>
          {dry.error ? (
            <p className={styles.error}>{dry.error}</p>
          ) : (
            <>
              <p className={styles.drySummary}>
                回放最近 {dry.replayed} 条历史事件,其中 <strong>{dry.wouldMatch}</strong> 条会触发。
                以下只是「本会执行什么」,并未真正执行。
              </p>
              {dry.samples && dry.samples.length > 0 ? (
                <ul className={styles.dryList}>
                  {dry.samples.map((s, i) => (
                    <li key={i} className={styles.drySample}>
                      {s.actions.map((a, j) => (
                        <span key={j} className={a.ok ? styles.actionOk : styles.actionBad}>
                          {a.preview ?? a.type}{a.error ? ` —— ${a.error}` : ''}
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.help}>没有历史事件会触发这条规则。</p>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
