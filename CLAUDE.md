# CLAUDE.md — Exchange_js (branch worktree)

## 项目概述

Exchange_js 是一个金融科技交易所平台 **产品演示系统**（非生产），覆盖：
客户 onboarding/KYC、合规（alerts/cases/incidents）、治理控制门（approval/change ticket/delete request/SLA timer）、资产库/钱包、交易（deposit/swap/withdraw）、会计分类账。

> 完整 agent 行为规范在 `Exchange_js/AGENTS.md`，本文件是 Claude Code 专用快速参考。

---

## Worktree 结构

```
branch/                          ← 当前 worktree（git branch）
├── Exchange_js/                 ← 项目主目录
│   ├── src/                     ← NestJS 后端
│   ├── admin-web/               ← 管理员控制台 (React/Vite)
│   ├── client-web/              ← 客户端 App (React/Vite)
│   ├── prisma/                  ← 数据库 schema + 迁移
│   ├── docs/                    ← 活跃文档（constraints/specs/roadmap/...）
│   ├── doc-final/               ← Wave 1 最终定稿文档
│   └── AGENTS.md                ← 完整 agent 读取协议（必读）
├── .claude/
│   ├── settings.local.json      ← Claude Code 权限 + hooks
│   └── launch.json              ← 服务启动配置
└── CLAUDE.md                    ← 本文件
```

---

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | NestJS 10 + TypeScript 5 + Prisma 6 + SQLite |
| 管理台 | React 18 + TypeScript + Vite |
| 客户端 | React 18 + TypeScript + Vite + Framer Motion |
| 测试 | Jest + Prisma mock |

---

## 关键命令（在 `Exchange_js/` 内执行）

```bash
npm run dev:start          # 启动完整 stack
npm run dev:stop           # 停止 stack
npm run dev:reset          # 仅重置业务数据
npm run dev:rebuild        # 完整重建本地 DB
npm run runtime:diagnose   # 诊断迁移漂移
```

---

## 端口映射（branch worktree）

| 服务 | 端口 |
|------|------|
| API | 3000 |
| Admin Web | 3502 |
| Client Web | 3501 |
| SQLite DB | `/tmp/exchange_js_branch/dev.db` |

> main worktree 端口：API 3010 / Admin 3103 / Client 3102

---

## 代码变更前必读协议

**任何代码变更前**，按以下顺序读取：

1. `Exchange_js/AGENTS.md` — agent 完整规范（含强制读取清单）
2. `Exchange_js/docs/constraints/README.md` — 约束体系索引
3. `Exchange_js/docs/constraints/backend-platform-constraints.md` — 后端宪法（backend 任何变更）
4. 任务相关的 domain constraints（`docs/constraints/**`）
5. 任务相关的 entity/workflow specs（`docs/specs/**`）

**前端专项读取：**
- `docs/constraints/frontend-platform-constraints.md`
- `docs/constraints/frontend-admin-ui-constraints.md` 或 `frontend-client-ui-constraints.md`

---

## 文档优先级

```
docs/constraints/** > docs/specs/** > docs/adr/** > docs/acceptance/** > docs/roadmap/** > docs/cleanup/**
```

---

## 后端 Domain 模块

| 模块 | 路径 | 职责 |
|------|------|------|
| identity | src/modules/identity | 用户、RBAC、onboarding、定期审查 |
| asset-treasury | src/modules/asset-treasury | 资产、钱包、payin、内部交易 |
| trading | src/modules/trading | deposit、swap、withdraw |
| accounting | src/modules/accounting | COA、日记账、会计事件 |
| clearing-settle | src/modules/clearing-settle | 池结算、清算、对账 |
| risk-engine | src/modules/risk-engine | 交易风险桥接、合规会话 |
| audit-logging | src/modules/audit-logging | 审计日志基础设施（@Global 全局模块） |
| governance | src/modules/governance | 审批流、变更票、删除请求、SLA |
| orchestrators | src/modules/orchestrators | 跨模块工作流编排 |

---

## 不可违反规则

- 有持久状态、operator 可见操作、自动拦截的功能 **必须** 通过 `AuditLogsService` 写审计日志
- 审计日志字段：`traceId`（UUID v4）、`workflowType`、`action`、`triggerType` — **禁止** `workflowId`/`workflowNo`
- 多表状态变更 **必须** 使用 DB transaction
- 有稳定 operator key（如 `customerNo`）时，**禁止** 以 `id` 作为主要查询合同
- **禁止** 提交 secrets 或本地运行时产物
- **禁止** 绕过 onboarding/compliance 状态门语义

---

## Thread 完成规则

每个 thread 结束前 **必须** 包含：
- `Documentation updated: <变更内容>` 或
- `Documentation update not needed: <原因>`

---

## 产品优先级（Demo 系统）

1. 业务逻辑清晰、状态机语义正确
2. 控制门含义 + 证据可追溯性
3. Admin/Client 产品体验（演示就绪）

> 非明确要求时，**不优化** 生产级安全深度（session 管理、token 吊销、零信任 auth 等）。

---

## Context 管理规则（Sonnet 上下文限制应对）

### Claude Code 必须遵守：

1. **不重复已知信息** — 已确认的事实、已读的文件内容不在回复中复述
2. **仅展示变更部分** — 代码输出只显示修改的函数/段落，不复读整个文件
3. **子任务完成后立即摘要** — 每完成一个子任务，用 ≤3 行总结结果，丢弃过程细节
4. **读文件前确认必要性** — 如果已知文件内容，不重复读取
5. **独立子任务用 Task tool** — 可并行的子任务通过 Task subagent 处理，各自拥有独立的 context window
6. **会话变长时主动 compact** — 当发现本轮对话已经经历多个大型任务，在开始下一个主要任务前提示用户运行 `/compact`

### 用户快速触发压缩：

```
/compact    ← 在 Claude Code 中随时输入，压缩对话历史为摘要
```

---

## 计划文件位置

- 实施计划：`Exchange_js/docs/superpowers/plans/YYYY-MM-DD-<描述>.md`
- 设计规格：`Exchange_js/docs/superpowers/specs/YYYY-MM-DD-<描述>.md`
