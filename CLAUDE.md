# Exchange_js — Claude Code Quick Reference

NestJS + Prisma + SQLite 后端 | React 管理台 | React 客户端
API: 3000 | Admin: 3001 | Client: 3002 | DB: `/tmp/exchange_js_main/dev.db`

工作目录：主工作树在仓库根（`重做版/`，分支 `main`）下的 `Exchange_js/`。并行任务各自在 `.claude/worktrees/<名字>/` 独立工作树里跑（见下方「并行工作 · Worktree 规范」）。

## 服务启动规则

**两种栈：`main`（固定端口，主工作树用）+ `self`（每个 worktree 自动分端口）。**

| 栈 | 何时用 | Backend | Admin | Client | TigerBeetle | DB |
|----|--------|---------|-------|--------|-------------|-----|
| **main** | 主工作树（仓库根）里 | 3000 | 3001 | 3002 | 3003 | `/tmp/exchange_js_main/dev.db` |
| **self** | 任意 `.claude/worktrees/*` 会话里 | 自动分配 base | base+1 | base+2 | base+3 | `/tmp/exchange_js_wt_<worktree名>/dev.db` |

- **main 栈**：仓库根里 `bash scripts/stack.sh up main`，端口固定 3000-3003，`.env` 自动生成（`API_PORT=3000`、`DATABASE_URL=file:/tmp/exchange_js_main/dev.db` 等）。
- **self 栈**：在某个 worktree 会话里 `bash scripts/stack.sh up`（不带参数即 `self`）。首次自动探测一段空闲 4 端口，写进该 worktree 的 `.stackports`（已 gitignore，之后**固定不变、可收藏书签**）；DB/TB 落 `/tmp/exchange_js_wt_<名>/`；前后端 `.env` 自动按分到的端口生成。
- **端口隔离铁律（不可违反）**：每个栈的所有进程严格限定在自己分到的端口段 + 自己的 DB 内，**禁止跨栈 / 跨 worktree 访问任何服务或数据库**。查每个 worktree 分到哪几号：`bash scripts/stack.sh status`。
- 启动前确认自己的端口段无残留进程：`lsof -ti:<你的端口段>`。

## 关键命令（在 Exchange_js/ 内执行）

```bash
# 主工作树（仓库根）内
bash scripts/stack.sh up main      # 启动 main 栈（3000-3003）
bash scripts/stack.sh down main    # 停止 main 栈
bash scripts/stack.sh reset-main   # 重置 main 栈业务数据 / DB

# 任意 worktree 会话内
bash scripts/stack.sh up           # = up self，自动分栈启动当前 worktree
bash scripts/stack.sh down         # = down self，停当前 worktree 的栈

bash scripts/stack.sh status       # 查看 main + 各 worktree 栈的端口/状态
npm run runtime:diagnose           # 诊断迁移漂移
```

> ⚠️ `recon:demo` / `demo:*` / `verify:manual-settle` 等 npm 脚本在 package.json 里硬编码了旧 branch DB 路径（`/tmp/exchange_js_branch`，已废弃），**直接 `npm run` 会指向不存在的库**。必须经包装器指到目标栈：主工作树用 `bash scripts/on-stack.sh main <script>`，worktree 会话内用 `bash scripts/on-stack.sh self <script>`（例：`bash scripts/on-stack.sh main recon:demo`）。

---

## 并行工作 · Worktree 规范

**并行任务一律用工作树隔离，不在同一个文件夹里切分支。** 一句话：一会话 = 一 worktree = 一分支 = 一套自动分配的栈。

- **建**：并行任务开独立工作树，**统一放 `.claude/worktrees/<名字>/`**（Claude Code 新会话默认就建在这，无需手动）。禁止再往 `.wt/` 之类其它位置建工作树。
- **切**：会话切到那个 worktree，改它自己的文件——物理隔离，不碰别的 worktree。
- **跑**：在该 worktree 里 `bash scripts/stack.sh up` 自动分一套端口 + 独立 DB，多个 worktree 可同时在线互不撞车。
- **合**：任务干完，把该 worktree 的分支合回 `main`。
- **清**：合并后清掉工作树 + 分支（`git worktree remove <路径>` 再 `git branch -D <分支>`）；`.stackports` 随工作树删除自动回收。别攒已合并的僵尸工作树。

> 主工作树（仓库根 `重做版/`，`main` 分支）是主干，不当临时任务工作树用。`.git` 只有一份、所有工作树共享；每个 worktree 只是把某个分支的文件摊到独立文件夹，便于并行。

---

## 任务路由表 — 变更前读对应文档

| 任务类型 | 必读文件 |
|---|---|
| 后端通用规则 | `doc-final/rules/backend-platform.md` |
| 审计日志写法 | `doc-final/rules/audit-logging.md` |
| 前端管理台 | `doc-final/rules/frontend-admin.md` |
| 前端客户端 | `doc-final/rules/frontend-client.md` |
| **某功能代码现状** | `doc-final/reference/truth/`（真相文档；改代码必须同步）|
| **技术债/死码/待决策** | `doc-final/BACKLOG.md`（唯一登记处；说"以后做"必须记一行）|

需要了解版本路线图与架构决策 → `doc-final/reference/roadmap.md`、`doc-final/reference/v7-funds-layer-baseline.md`

> **四类文档分工**：`rules/`=怎么写（约束）｜ `truth/`=现在什么样（现状，跟代码走）｜ `roadmap`=接下来做什么（计划）｜ `BACKLOG.md`=欠的账（技术债）。改代码同步 truth/，别写进 roadmap。

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
