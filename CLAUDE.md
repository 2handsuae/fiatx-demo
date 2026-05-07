# Exchange_js — Claude Code Quick Reference

NestJS + Prisma + SQLite 后端 | React 管理台 | React 客户端
API: 3500 | Admin: 3501 | Client: 3502 | DB: `/tmp/exchange_js_branch/dev.db`

Worktree 路径: `branch/Exchange_js/`

## 关键命令（在 Exchange_js/ 内执行）

```bash
npm run dev:start     # 启动完整 stack
npm run dev:stop      # 停止
npm run dev:reset     # 重置业务数据
npm run dev:rebuild   # 完整重建 DB
npm run runtime:diagnose  # 诊断迁移漂移
```

---

## 任务路由表 — 变更前读对应文档

| 任务类型 | 必读文件 |
|---|---|
| 后端通用规则 | `doc-final/rules/backend-platform.md` |
| 审计日志写法 | `doc-final/rules/audit-logging.md` |
| 前端管理台 | `doc-final/rules/frontend-admin.md` |
| 前端客户端 | `doc-final/rules/frontend-client.md` |

需要了解架构决策 → `doc-final/reference/decisions.md`

---

## 5 条不可违反规则

1. 有持久状态、operator 可见操作 → **必须** 写 `AuditLogsService`（DI 注入，禁止 `new`）
2. 多表状态变更 → **必须** 用 DB transaction（`prisma.$transaction`）
3. 有稳定业务键（`customerNo`、`templateCode` 等）→ **禁止** 以 `id` 作主查询合同
4. **禁止** 绕过 onboarding / compliance 状态门语义
5. Workflow **禁止**直接写任何 domain 实体的 Prisma 表 → 必须通过该 domain 的 service 方法（绕过即破坏不变量保护）

---

## Thread 完成规则

每轮结束前必须写：
`Documentation updated: <变更内容>` 或
`Documentation update not needed: <原因>`
