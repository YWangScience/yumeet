# yuMeet 建设执行计划(PLAN.md)

> 本文件是本项目的执行入口,供编码智能体(AI coding agent)或开发者按序实施。yuMeet 是一套用于替代 CERN Indico 的新一代开源会议/活动管理系统。
> 完整设计规格在 `docs/ch01.md` 到 `docs/ch14.md`(共 14 章),本文件定义**怎么读、按什么顺序建、每步验收什么**。

## 0. 执行者须知

1. **先读后建**:实现某个模块前,必须先读对应章节(见 §2 的映射表)。章节内容具体到字段、接口与参数,按规格实现,不要自行发挥重新设计。
2. **单一事实源**:规格中若出现交叉引用,以被指向的章节为准。已裁决的事实源:状态机 → ch09 §9.4;数据保留期 → ch12 §12.3;视觉基准(字阶/色板/token) → ch07 §7.4;webhook 事件名 → ch10 §10.3;audit_logs schema → ch09 §9.5。
3. **架构不可变更项**(除非用户明确改变主意):
   - 业务逻辑只写一遍,放在 `packages/core`(纯 TypeScript 服务层)+ `packages/db`(Drizzle schema)。
   - `apps/web` = Next.js 15(App Router,React 19):公共活动站(ISR/SSG)+ 管理后台 `/manage/{org}/{event}/…`;页面数据操作用 **Server Actions 进程内调用 core**(不引入 tRPC)。
   - `apps/api` = Fastify 5,只做三件事:① 对外 REST API(`/api/v1`,OpenAPI 3.1、API key、限流)② 长连接(SSE 公告、Yjs 协作 WebSocket)③ 插件 HTTP 挂载点。
   - `apps/worker` = BullMQ 消费者(邮件、PDF、webhook 投递、数据清理),import core。
   - PostgreSQL 17 + Drizzle;Redis 7;S3 兼容存储(默认 MinIO);认证 magic link + passkey + OAuth,企业 SSO 走插件;部署 docker compose 七容器一条命令。
   - 主键 UUIDv7;对外 ID 用类型前缀 + Crockford base32(`evt_…`/`reg_…`)。
4. **默认主题 Cupertino**(apple.com 视觉):所有视觉数值以 ch07 §7.4 的 token 表为准,token 一律 `--yu-` 前缀;Mac 原生感要求见 ch08 §8.6(⌘K 命令面板、快捷键、聚焦环、PWA)。
5. **质量门槛**(每个里程碑收尾时检查):TypeScript strict 无错误;核心服务层有单元测试;关键用户旅程(ch03 §3.3 的 A–E)有端到端测试;WCAG 2.2 AA(ch08 §8.7);性能预算(ch13 §13.1)。

## 1. 仓库初始化(里程碑 M0)

```text
yumeet/
├── apps/
│   ├── web/        # Next.js 15:公共站 + /manage 后台
│   ├── api/        # Fastify 5:/api/v1 + SSE/WS + 插件挂载
│   └── worker/     # BullMQ 消费者
├── packages/
│   ├── core/       # 业务服务层(唯一的业务逻辑实现)
│   ├── db/         # Drizzle schema + 迁移
│   ├── ui/         # Cupertino UI 组件库(Radix 封装)+ tokens.css
│   ├── auth/       # 会话、passkey、magic link、能力(capability)检查
│   ├── schedule-core/  # 日程冲突检测等纯算法
│   ├── net/        # safe-fetch(SSRF 防护出站请求)
│   ├── sdk/        # 对外 TypeScript SDK(由 OpenAPI 生成)
│   └── config/     # 配置分层解析(默认值→UI→env→文件)
├── plugins/        # 官方插件(stripe、saml、…)
└── deploy/         # docker-compose.yml、Caddyfile、CLI
```

- pnpm + Turborepo;TypeScript 5 strict;ESLint + Prettier;Vitest;Playwright。
- 参照 ch02 §2.4(目录树)与 ch11(compose 与配置分层)。
- **验收**:`pnpm install && pnpm dev` 起得来三个 app 的空壳;`docker compose up` 七容器全绿。

## 2. 模块 → 章节映射(实现顺序)

| 顺序 | 模块 | 主要章节 | 关键交付 |
| --- | --- | --- | --- |
| 1 | 数据模型 + core 骨架 | ch09 | Drizzle schema 全部表、状态机、ID 编码、自定义字段引擎 |
| 2 | 身份与权限 | ch06 | magic link、passkey、OAuth、会话、两级角色 × 能力矩阵 |
| 3 | 公共活动站 | ch03、ch07、ch08 | 活动页(ISR)、日程页、URL 方案、Cupertino 主题、深浅色 |
| 4 | 注册与票务 | ch04 §4.2、ch13 §13.3 | 表单引擎(15 种字段)、审批链、候补、Redis 预扣抢票路径 |
| 5 | 状态追踪与通知 | ch05 §5.5、ch04 §4.4 | /r /s 追踪页、通知事件表、react-email 模板、ICS |
| 6 | 管理后台骨架 | ch03 §3.2、ch04 §4.1 | 三步建会向导、模块渐进披露、⌘K 命令面板 |
| 7 | 征稿与评审 | ch04 §4.3 | CFP、双盲、利益冲突、评分、录用流水线 |
| 8 | 日程编排 | ch05 §5.1、ch09 | 拖拽多轨时间表、冲突检测、Yjs 协作、草稿/发布 |
| 9 | 对外 API + Webhooks | ch10 | /api/v1 全资源、OpenAPI 3.1、HMAC webhook、开放数据(ICS/JSON-LD)、嵌入套件(embed.js Web Components / 公共只读 JSON / oEmbed / @yumeet/react,§10.6) |
| 10 | 现场模式 | ch05 §5.2 | 签到(离线容错)、胸牌(satori)、会场屏、SSE 公告 |
| 11 | 主题与模板系统 | ch07 | 四层自定义、theme.json 模板包、实时预览、白标 |
| 12 | 插件与自动化 | ch13 §13.4–13.5 | hook 总表、沙箱、when/if/then 规则引擎 |
| 13 | 归档与迁移 | ch05 §5.4、ch14 | 永久链接、导出、Indico 迁移器 |
| 14 | 安全加固与合规 | ch12 | 对象级授权中间件、CSP、保留期清理任务、审计链、GDPR 权利 |

安全(ch12)不是最后才做:第 1 步起就按 ch12 §12.2 的基线写(对象级授权、输入校验),第 14 步是集中验证与补齐。

## 3. 里程碑与验收

### M0 仓库与部署骨架

范围与验收见 §1。

### M1 MVP —— 能办一场小型研讨会

范围:模块 1–6(评审、编排、现场可缺)。
**验收(对应 ch03 §3.3 旅程 A/B)**:组织者 5 分钟建会发布;参会者 60 秒完成报名并收到确认邮件与 ICS;追踪页可查状态;后台能审批/导出名单;Lighthouse 性能 ≥ 90、无障碍 ≥ 95。

### M2 学术会议完整链路

范围:模块 7–10。
**验收(旅程 C/D/E)**:投稿→双盲评审→录用→排期→现场签到全链路;对外 API 有 OpenAPI 文档与 SDK;webhook 可靠投递(重试+死信);外部网站粘贴两行 HTML 即可显示活动列表与报名按钮(ch10 §10.6 嵌入套件,验收场景:一个静态官网嵌入 yuMeet 活动信息)。

### M3 平台化

范围:模块 11–14。
**验收**:整体换模板不动内容;插件能注册路由与 hook;`yumeet migrate indico` 跑通样例数据;ch12 威胁模型逐条有防御实现;ch13 性能预算全部达标。

## 4. 不要做的事

- 不引入规格外的重量依赖(没有 LaTeX/TeXLive——PDF 用 satori/resvg 与容器化 Typst;没有 tRPC;没有额外的 CSS 框架)。
- 不把业务逻辑写进 apps/*(那是 core 的职责);web 不直连第三方支付(经 core 的 Stripe 插件接口)。
- 不发明第二套状态机、第二张保留期表、第二份色板——见 §0.2 的事实源清单。
