/**
 * 插件与自动化(ch13 §13.4–13.5)
 *
 * 两张主表:
 *   installed_plugins —— 装了哪些插件、以什么信任级别运行、配置是什么
 *   automation_rules  —— 组织者写的 when/if/then 规则
 * 加一张 rule_runs 作执行日志兼幂等表:规则动作以
 * hash(ruleId, entityId, triggerEventId) 去重,at-least-once 投递下不会重复执行。
 */
import { uuidv7 } from 'uuidv7';
import {
  pgTable, uuid, text, jsonb, boolean, integer, index, uniqueIndex,
} from 'drizzle-orm/pg-core';
import { ts } from './identity';
import type { PluginManifest, RuleAction, RuleCondition } from './types';

/** 已安装插件 */
export const installedPlugins = pgTable('installed_plugins', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull(),
  /** manifest.name,组织内唯一 */
  name: text('name').notNull(),
  version: text('version').notNull(),
  /**
   * core = 仓库内维护,进程内运行;third_party = worker_threads 隔离运行。
   * 这一列决定用哪条执行路径,不是装饰性的标签。
   */
  trust: text('trust').notNull().default('third_party'),
  manifest: jsonb('manifest').$type<PluginManifest>().notNull(),
  /** 由插件自带的 Zod schema 生成表单后写入 */
  config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
  enabled: boolean('enabled').notNull().default(false),
  installedAt: ts('installed_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('installed_plugins_uq').on(t.organizationId, t.name),
]);

/** 自动化规则 */
export const automationRules = pgTable('automation_rules', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  organizationId: uuid('organization_id').notNull(),
  eventId: uuid('event_id').notNull(),
  name: text('name').notNull(),
  /** 触发器,对应 outbox.topic */
  trigger: text('trigger').notNull(),
  /** JsonLogic 子集;null 表示无条件 */
  condition: jsonb('condition').$type<RuleCondition | null>(),
  then: jsonb('then').$type<RuleAction[]>().notNull(),
  enabled: boolean('enabled').notNull().default(false),
  /** 连续失败次数,用于在后台标红 */
  failures: integer('failures').notNull().default(0),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [
  index('automation_rules_trigger_idx').on(t.eventId, t.trigger, t.enabled),
]);

/**
 * 规则执行记录。
 *
 * idempotencyKey 上的唯一索引就是幂等机制本身 ——
 * 插入冲突即代表「这条规则对这个实体、由这个事件触发」已经跑过,直接跳过。
 * 不靠内存里的 Set,因为 worker 会重启、会有多个副本。
 */
export const ruleRuns = pgTable('rule_runs', {
  id: uuid('id').primaryKey().$defaultFn(uuidv7),
  ruleId: uuid('rule_id').notNull(),
  eventId: uuid('event_id').notNull(),
  /** hash(ruleId, entityId, triggerEventId) */
  idempotencyKey: text('idempotency_key').notNull(),
  /** 触发它的 outbox 记录 */
  triggerEventId: uuid('trigger_event_id'),
  /** matched / skipped / failed */
  status: text('status').notNull(),
  /** 每个动作的结果,试运行时只填「本会执行什么」 */
  actions: jsonb('actions').$type<Record<string, unknown>[]>().notNull().default([]),
  error: text('error'),
  /** 规则动作产生的事件带 depth,超过 3 层不再触发,杜绝循环 */
  depth: integer('depth').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('rule_runs_idem_uq').on(t.idempotencyKey),
  index('rule_runs_rule_idx').on(t.ruleId, t.createdAt),
]);
