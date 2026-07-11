# Worktree 起栈防呆(免 .env / node 反复出错) — 设计

> Date: 2026-07-11 ｜ Status: 设计定稿(待评审)
> 定调:业主用法 = 「Claude 起分支服务 → 业主验收 → Claude 合 main」;对外演示走 main 成熟脚本。目标 = 让 worktree 的 `stack.sh up self` **永远一次成**,不再因 .env / node 反复出问题。范围 = 最小切口(甲)。

---

## 0. 背景与根因(本次踩坑复盘)

本轮为 feature 起服务验收时反复卡壳,根因三条:

1. **姿势错(最大)**:功能做在**主工作树的 feature 分支**(`git checkout -b`),而非 `.claude/worktrees/<名>/` worktree → `stack.sh up main` 撞 `main` 分支守卫(`stack-common.sh → assert_branch_rule`)→ 被迫**手工起服务**,绕过了 `stack-up.sh` 自带的兜底(注入 env / 重建 / 切 node20),把 stale dist、stale .env、node18 全踩一遍。违反 CLAUDE.md「并行任务一律用 worktree 隔离」。
2. **`.env` 生成"只建不更"**:`stack-common.sh → ensure_env_files()` 用 `if [[ ! -f ... ]]` 仅在文件**缺失**时创建、**存在则跳过绝不更新**;且 `.env.example` 写死 main 端口(`API_PORT=3000/3001/3002`、`DATABASE_URL=./dev.db`、`TB_ADDRESS=3003`)。任何东西抢先造出 .env(`db-setup.sh` 的 `cp .env.example .env`、残留副本),`up` 就将错就错。**并且现有生成块本身漏写 `TB_ADDRESS`**(主树 .env 停在 `3503` 无人纠)。
3. **node 只有 stack 内部兜**:`stack-up.sh:11-20` 在 current<20 时从 nvm 加载 node20/22 给 vite——但**仅 stack 路径**;`npm run`/裸 `node`/手工启动仍用默认 node18 → vite 7.3.1 报 `TypeError: crypto.hash is not a function`。仓库无 `.nvmrc` 兜底。

> 关键事实(佐证工具本身是好的):`stack-up.sh` 给**每个进程注入正确 env**(后端 `API_PORT/ADMIN_URL/CLIENT_URL/DATABASE_URL/TB_ADDRESS`;admin/client `VITE_API_URL=${BACKEND_URL}`)**且每次 up `npm run build` 重建后端**。所以在 worktree 里正确用 `stack.sh up self`,本就该一次成;缝只在「.env 只建不更 + .env.example 错默认 + 无 .nvmrc」。

---

## 1. 目标 / 非目标

**目标**:worktree 起栈防呆——`cd 到任意 worktree` → `bash scripts/stack.sh up`(self),不管 .env / node 处于什么脏状态,**一次拉起且指向本 worktree 自己的端口/DB**;验收后合 main。

**非目标**:不做一键 create-worktree 命令(甲不含乙)、不做自动合并门(合并业主拍板,甲不含丙)、**不动业务代码**、**不改 main 演示脚本的行为语义**(main 路径只享受 .env 自愈这一改进,不得回归)。

---

## 2. 设计(三动作)

### ① 姿势矫正(0 代码 · 流程)
业主让"起分支服务",Claude **一律**:`.claude/worktrees/<名>/` 建/进 worktree → `bash scripts/stack.sh up`(self,自动分端口+独立 DB)。**禁止**在主工作树 `git checkout -b` 起临时分支跑服务。此条消除守卫冲突与手搓,是最大杠杆。写入 CLAUDE.md「并行工作」节一句强化。

### ② `ensure_env_files` 改「权威重写」(治 .env 根)
`stack-common.sh → ensure_env_files()`:由"只建不更"改为**每次 up 都把 stack 管的键按分到的端口权威写入**,其余键原样保留。

- **新增幂等 upsert 助手** `upsert_env_key(file, KEY, VALUE)`:文件不存在则建;KEY 已存在→就地替换整行;不存在→追加。BSD/GNU sed 兼容(用 awk 临时文件法,不用 `sed -i`)。
- **权威写入的键(仅这些,别的键一律不碰)**:
  - 根 `.env`:`API_PORT`、`ADMIN_PORT`、`CLIENT_PORT`、`API_URL`、`ADMIN_URL`、`CLIENT_URL`、`DATABASE_URL`、**`TB_ADDRESS`(本次补齐)**。
  - `admin-web/.env`:`VITE_API_URL=${BACKEND_URL}`。
  - `client-web/.env`:`VITE_API_URL=${BACKEND_URL}`。
- 值全部取自 `load_stack_config` 已算好的变量(`BACKEND_PORT/…/TB_ADDRESS/BACKEND_URL/…` + `default_database_url`),self=base+0/1/2/3、main=3000-3003,无需新逻辑。
- **保留其它键**:`GOVERNANCE_DEMO_ENABLED`、`SUMSUB_MOCK_MODE`、`MFA_ISSUER`、任何密钥——upsert 只碰命名键,不整文件覆盖。
- 效果:哪怕 .env 是 `cp .env.example` 来的 main 端口脏值,一 up 即自愈为本 worktree 正确值;前端 `VITE_API_URL` 与注入值一致(消除 vite 读 .env vs 读注入 env 的优先级歧义);主树那份 3500/3503 也顺带修对。

### ③ `.nvmrc` + `.env.example` 中性化(治 node 根 + 断种子污染)
- 仓库根新增 **`.nvmrc`** 内容 `20`(与 stack-up.sh 首选一致)。让任何走 `nvm use`/自动切换的命令(`npm run demo:all`、裸 `node`、手工)也用 node20,不再仅靠 stack 内部。
- **`.env.example` 顶部加警示 banner**(键值全保留、不删行,避免破坏 `db-setup.sh` 对 `DATABASE_URL` 的读取):注明"端口/URL/DB 由 `stack.sh up` 按栈权威生成,此处仅裸 checkout 的占位、勿依赖"。目的纯为降低误解——`cp .env.example .env` 即便把 main 端口塞进 worktree,②也会在 `up` 时自愈(双保险,非主修)。

---

## 3. 关键约束:不得回归 main 演示路径

②改的是 self+main 共用的 `ensure_env_files`。main 走 `stack.sh up main`(3000-3003)+ 业主的 `on-stack.sh main demo:*` 成熟脚本。改后必须验证:
- `stack.sh up main` 仍正常起四端;`.env` 被自愈为正确 3000-3003 值(而非现在的脏 3500/3503),**这是改进不是回归**。
- 保留键(`GOVERNANCE_DEMO_ENABLED` 等)不丢。
- `on-stack.sh main demo:all` / `recon:demo` / `verify:coa` 照常绿。

---

## 4. 验收标准(□)

- □ **脏 .env 自愈**:worktree 里手动把 `admin-web/.env` 写成 `VITE_API_URL=http://localhost:3000`(错),`stack.sh up` 后该文件被改回本 worktree 后端 URL;根 `.env` 的 `API_PORT/TB_ADDRESS` 为本 worktree 值。
- □ **保留键不丢**:up 后 `.env` 里 `GOVERNANCE_DEMO_ENABLED`、`MFA_ISSUER`、`SUMSUB_MOCK_MODE`(若原有)仍在。
- □ **端口隔离**:两个 worktree 同时 `up`,各自前端只 call 各自后端(无一个打到 3000)。
- □ **node 兜底**:`.nvmrc` 存在=`20`;`nvm use` 后 `node -v` ≥ v20。
- □ **main 不回归**:`stack.sh up main` 四端起;`.env` 自愈为 3000-3003;`on-stack.sh main demo:all` 8/8、`recon:demo:pass`、`verify:coa` PASS。
- □ **幂等**:同一 worktree 连 `up` 两次,.env 稳定不漂、服务正常。

## 5. 影响文件(锚点)

- `scripts/stack-common.sh → ensure_env_files()`(改权威重写)+ 新增 `upsert_env_key()`
- `.nvmrc`(新建,内容 `20`)
- `.env.example`(端口中性化)
- `重做版/CLAUDE.md`「并行工作 · Worktree 规范」节(补一句:起分支服务一律 worktree + `stack.sh up`,禁主树 checkout -b 跑服务)

> 不改:`stack-up.sh` 的注入/重建/node 逻辑(已正确)、任何业务代码、main 演示脚本。
