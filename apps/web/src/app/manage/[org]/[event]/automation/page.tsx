import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import {
  getEventBySlug, listRules, listRuleRuns, describeRegistry,
  TRIGGERS, ACTIONS,
} from '@yumeet/core';
import { requirePageCapability } from '@/lib/session';
import { resolveLocale } from '@/lib/locale-server';
import { RuleEditor, type RuleView } from '@/components/rule-editor';
import { saveRuleAction, deleteRuleAction, dryRunRuleAction } from './actions';
import styles from './automation.module.css';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: '自动化 · yuMeet', robots: { index: false } };

interface Props {
  params: Promise<{ org: string; event: string }>;
  searchParams: Promise<{ lang?: string; rule?: string }>;
}

/**
 * 自动化规则(ch13 §13.5)与已注册扩展点(ch13 §13.4)。
 *
 * 页面的排序刻意把「现有规则」放在最前:自动化最大的风险是
 * 忘了自己开过什么规则,所以先让人看见全貌,再谈新建。
 */
export default async function AutomationPage({ params, searchParams }: Props) {
  const { org: orgSlug, event: eventSlug } = await params;
  const sp = await searchParams;
  await resolveLocale(sp);

  const found = await getEventBySlug(orgSlug, eventSlug);
  if (!found) notFound();

  await requirePageCapability(
    found.event.id, 'event.edit', `/manage/${orgSlug}/${eventSlug}/automation`,
  );

  const rules = await listRules(found.event.id);
  const selected = sp.rule ? rules.find((r) => r.id === sp.rule) ?? null : null;
  const runs = selected ? await listRuleRuns(selected.id, 20) : [];
  const registry = describeRegistry();
  const base = `/manage/${orgSlug}/${eventSlug}/automation`;

  const view: RuleView | null = selected ? {
    id: selected.id,
    name: selected.name,
    trigger: selected.trigger,
    condition: selected.condition,
    then: selected.then,
    enabled: selected.enabled,
    failures: selected.failures,
    lastRun: selected.lastRun?.toISOString() ?? null,
  } : null;

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>自动化</h1>
      <p className={styles.lede}>
        「当 X 发生、若满足 Y、则执行 Z」。规则由后台 worker 执行,
        同一事件对同一条规则只执行一次;规则动作再触发的事件最多再传播三层。
      </p>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>现有规则</h2>
        {rules.length === 0 ? (
          <p className={styles.empty}>还没有任何规则。</p>
        ) : (
          <ul className={styles.ruleList}>
            {rules.map((r) => (
              <li key={r.id} className={r.id === sp.rule ? styles.ruleRowActive : styles.ruleRow}>
                <Link className={styles.ruleLink} href={`${base}?rule=${r.id}`}>
                  <span className={styles.ruleName}>{r.name}</span>
                  <span className={styles.ruleTrigger}>{r.trigger}</span>
                </Link>
                <span className={r.enabled ? styles.badgeOn : styles.badgeOff}>
                  {r.enabled ? '已启用' : '未启用'}
                </span>
                {r.failures > 0 && (
                  <span className={styles.badgeFail}>连续失败 {r.failures} 次</span>
                )}
                <span className={styles.ruleMeta}>
                  {r.lastRun ? `最近执行 ${r.lastRun.toISOString().slice(0, 16).replace('T', ' ')}` : '尚未执行'}
                </span>
              </li>
            ))}
          </ul>
        )}
        {sp.rule && (
          <p className={styles.newLink}><Link href={base}>+ 新建规则</Link></p>
        )}
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>{view ? `编辑「${view.name}」` : '新建规则'}</h2>
        <RuleEditor
          rule={view}
          triggers={TRIGGERS}
          actions={ACTIONS}
          saveAction={saveRuleAction.bind(null, orgSlug, eventSlug)}
          deleteAction={deleteRuleAction.bind(null, orgSlug, eventSlug)}
          dryRunAction={dryRunRuleAction.bind(null, orgSlug, eventSlug)}
        />
      </section>

      {selected && runs.length > 0 && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>执行日志</h2>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">时间</th>
                  <th scope="col">结果</th>
                  <th scope="col">层级</th>
                  <th scope="col">动作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{r.createdAt.toISOString().slice(0, 19).replace('T', ' ')}</td>
                    <td className={r.status === 'failed' ? styles.cellFail : undefined}>
                      {r.status}
                    </td>
                    <td>{r.depth}</td>
                    <td className={styles.cellActions}>
                      {r.error ?? (r.actions as { type: string }[]).map((a) => a.type).join('、')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>扩展点</h2>
        <p className={styles.lede}>
          插件在这些位置接入。核心功能自己也走同一套 API —— 不给核心留后门,
          是接口不腐化的唯一保证。
        </p>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">hook</th>
                <th scope="col">类型</th>
                <th scope="col">已注册插件</th>
              </tr>
            </thead>
            <tbody>
              {registry.hooks.map((h) => (
                <tr key={h.name}>
                  <td className={styles.mono}>{h.name}</td>
                  <td>{h.kind === 'filter' ? 'filter(可改数据/可否决)' : 'action(只做副作用)'}</td>
                  <td>{h.plugins.length ? h.plugins.join('、') : <span className={styles.dim}>—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
