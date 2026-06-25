# Exchange_js — Claude Code Quick Reference

NestJS + Prisma + SQLite 后端 | React 管理台 | React 客户端
API: 3000 | Admin: 3001 | Client: 3002 | DB: `/tmp/exchange_js_main/dev.db`

工作目录: 仓库根目录下的 `Exchange_js/`（main 分支直接 checkout，无独立 worktree）

## 服务启动规则

**必须使用 main 栈端口，禁止混用其他栈端口：**

| 服务 | 端口 | 说明 |
|------|------|------|
| Backend API | **3000** | `.env` 中 `API_PORT=3000` |
| Admin Web | **3001** | Vite `--port 3001` |
| Client Web | **3002** | Vite `--port 3002` |
| TigerBeetle | **3003** | main 栈 |

- `.env` 必须设置 `API_PORT=3000`、`ADMIN_URL=http://localhost:3001`、`CLIENT_URL=http://localhost:3002`、`DATABASE_URL=file:/tmp/exchange_js_main/dev.db`（`bash scripts/stack.sh up main` 会自动生成）
- **端口隔离规则（不可违反）**：每个栈的所有进程严格限定在自己的端口段内，禁止跨栈访问任何服务或数据库：

  | 栈 | Backend | Admin | Client | TigerBeetle |
  |-----|---------|-------|--------|-------------|
  | main | 3000 | 3001 | 3002 | **3003** |
  | codex | 3100 | 3101 | 3102 | **3103** |
  | claude | 3200 | 3201 | 3202 | **3203** |
  | trae | 3300 | 3301 | 3302 | **3303** |

- `admin-web/.env` 和 `client-web/.env` 中 `VITE_API_URL=http://localhost:3000`
- **禁止**用 3100/3200/3300 等其他栈端口启动服务，所有前后端必须统一指向 main 栈端口
- 启动前先确认端口无残留进程：`lsof -ti:3000,3001,3002`

## 关键命令（在 Exchange_js/ 内执行）

```bash
bash scripts/stack.sh up main      # 启动 main 栈完整 stack（推荐）
bash scripts/stack.sh down main    # 停止 main 栈
bash scripts/stack.sh status       # 查看各栈运行状态
bash scripts/stack.sh reset-main   # 重置 main 栈业务数据 / DB
npm run runtime:diagnose           # 诊断迁移漂移
```

> ⚠️ `recon:demo` / `demo:*` / `verify:manual-settle` 等 npm 脚本在 package.json 中硬编码了 branch DB 路径（`/tmp/exchange_js_branch`），branch 已删除，**直接 `npm run` 会指向不存在的库**。在 main 栈下必须经包装器运行：`bash scripts/on-stack.sh main <script>`（例：`bash scripts/on-stack.sh main recon:demo`）。

---

## 任务路由表 — 变更前读对应文档

| 任务类型 | 必读文件 |
|---|---|
| 后端通用规则 | `doc-final/rules/backend-platform.md` |
| 审计日志写法 | `doc-final/rules/audit-logging.md` |
| 前端管理台 | `doc-final/rules/frontend-admin.md` |
| 前端客户端 | `doc-final/rules/frontend-client.md` |

需要了解版本路线图与架构决策 → `doc-final/reference/roadmap.md`、`doc-final/reference/v7-funds-layer-baseline.md`

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
