# 设计：压掉 Exchange_js 夹心层

2026-09-18 ｜ 状态：设计稿，业主已批准方向，待写 plan ｜ 本轮只做压平，**不改目录名、不搬家**（那是后续"总文件夹批量搬迁"轮的事）

## 0. 目标与判据

把 `重做版/Exchange_js/**` 提升一级到仓库根，夹心层消失。仓库路径本身不变（仍是 `.../projects/重做版`），故 Codex 的 `[projects."…"] trust_level` 与一切仓库级绝对路径引用不受影响。

成功判据＝三类闸门全绿 ＋ 云端部署真跑通（详见 §5）。

## 1. 现状事实（本设计的证据地基，全部实测）

**两层内容**：根层仅 `.claude/`、`.superpowers/`、`AGENTS.md`、`CLAUDE.md`、两个 `.command`、`.env`、`.gitignore`、`.DS_Store`；其余全在 `Exchange_js/` 内。

**四处同名撞车**：`.DS_Store`（无关紧要）｜`.claude/`｜`.env`｜`.gitignore`。

**无活 worktree**：`git worktree list` 仅主树，压平不牵连分支工作树。

**路径引用总量**：全仓 1122 行命中 `Exchange_js`，**其中绝大多数在 `doc-final/archive/`**；排除 archive 后仅 17 个文件。

## 2. 关键发现：真会炸的只有 6 处，且有 3 处 grep 抓不到

### 2.1 必改（改错即运行时静默失败）

| 位置 | 现状 | 改法 | grep `Exchange_js` 能否抓到 |
|---|---|---|---|
| `.claude/launch.json` 4 处 | 绝对路径含 `/重做版/Exchange_js/…` | 去掉 `Exchange_js/` 一段 | 能 |
| `scripts/stack-common.sh:104` | `APP_DIR="${ROOT_DIR}/Exchange_js"` | `APP_DIR="${ROOT_DIR}"` | 能 |
| `scripts/stack-common.sh:125` | `APP_DIR="${WT_DIR}/Exchange_js"` | `APP_DIR="${WT_DIR}"` | 能 |
| `部署.command:3`、`重铺数据.command:3` | `cd "$(dirname "$0")/Exchange_js"` | `cd "$(dirname "$0")"` | 能 |
| `scripts/stack-common.sh:9` | `CURRENT_WT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"` | `"${SCRIPT_DIR}/.."` | **不能** |
| `scripts/demo-lib.ts:193` | `path.resolve(__dirname, '../../.stackports')` | `'../.stackports'` | **不能** |
| `scripts/verify-rbac.ts:48` | 同上 | 同上 | **不能** |

后三处是本轮最大的陷阱：它们够到仓库根的 `.stackports`，靠"向上两级"这个层数假设工作，压平后会**逃出仓库**。只搜 `Exchange_js` 字面量必然漏掉。

### 2.2 实测确认自愈（不改）

- **`scripts/cloud-deploy.sh`**：`REL="$(git rev-parse --show-prefix)"` 压平后变空串，第 34 行成为 `git archive "HEAD:" src prisma …`。**实测 `HEAD:` 是合法 tree-ish**（`git rev-parse "HEAD:"` 返回根树 SHA，`git archive "HEAD:" CLAUDE.md` 成功解包），打包内容正好正确。
- `scripts/cloud-env.sh:6` 的 `CLOUD_APP_DIR`：`dirname/..` 相对计算，自动跟随。
- `scripts/demo-data-md.ts:10` 的 `'../doc-final/demo/data.md'`：`doc-final` 与 `scripts` 同级同步移动，相对关系不变。
- `src/core/scripts/migration-runner.spec.ts:7` 的 `path.resolve(__dirname,'../../..')`：现指向 `Exchange_js/`，压平后指向仓库根——仍是 APP_DIR。
- 全树 290 处 `../..` 中其余全部为包内相对 import（`src/**`、`admin-web/src/**`、`client-web/src/**`），整子树同步移动，零影响。

### 2.3 仅注释过时（可顺手改，不改也不炸）

`.env.example:1` 抬头、`scripts/backfill-account-flow.ts:9` 用法注释、`cloud-deploy.sh:14` 的 `# = Exchange_js`、`cloud-env.sh:3,6` 注释。

## 3. 四处撞车的处置

| 撞车 | 处置 | 理由 |
|---|---|---|
| `.DS_Store` | 无视（两份都被忽略） | macOS 垃圾 |
| `.gitignore` | 取并集，落在根 | 内层的 `node_modules`/`dist/`/`*.db`/`/generated/prisma` 压平后正好锚在仓库根，语义不变 |
| `.claude/` | 合并：保留根层 `launch.json`（活的）＋ `.superpowers/` ＋ `worktrees/`；把内层 `settings.json` 提上来；**删内层 `launch.json`** | 内层那份是死 stub（`runtimeExecutable: "echo"`，内容仅 "admin already running on 3001"），早被根层真配置取代 |
| `.env` | 根层那份（仅 `MINIMAX_API_KEY`）移出仓库至 `~/.env.minimax-key.bak`；项目 16 键 `.env` 占据根位 | 实测该键全仓仅两处引用、**均在 archive**（2026-07-03 Docker 交付，已随上云退役），活代码零引用 |

## 4. 顺手清的两笔债（业主已批准）

1. **归档 20 份**：`superpowers/specs/` 14 份 ＋ `plans/` 6 份，日期 8-26 至 9-11，对应任务均已合并，按总纲 §6 本就该在 archive。归档后它们的 135 处路径引用**自动脱离修改范围**（archive 不动）。**例外**：`2026-09-11-tx-leak-fix` 在 CHANGELOG 无对应条目，执行时须单独查证，查不实就留在活区并改其路径。
2. **不搬 `node_modules/` 与 `dist/`**：直接删除、压平后 `npm i` 重装 —— 既避免搬运，又顺带做一次真实的从零重建。

## 5. 验收（三类闸门全走，云端真跑）

| # | 闸门 | 命令 | 判据 |
|---|---|---|---|
| 1 | 依赖重建 | `npm i` ＋ `npx prisma generate` | 无错 |
| 2 | 随手闸 | `npx tsc --noEmit -p tsconfig.json`；`admin-web`/`client-web` 各 `npx tsc -b --noEmit` | 三绿 |
| 3 | 单测 | `jest`（含 `scripts/` 与 `src/` 相关目录） | 全绿 |
| 4 | 从零重建 | `bash scripts/stack.sh reset main` | 建库重铺成功 |
| 5 | 主线端到端 | `bash scripts/on-stack.sh main demo:all` | 走通并断言终态，对照 `doc-final/demo/baseline.md` |
| 6 | 领域不变量 | `bash scripts/on-stack.sh main verify:coa` | 恒等式 ＋ 负余额全绿 |
| 7 | **preview 起栈** | `.claude/launch.json` 四个配置各起一次 | 页面真渲染——**这是唯一能逮住绝对路径写错的闸** |
| 8 | **云端部署** | `npm run cloud:deploy` | 真部署成功、线上可访问（业主拍板本轮真跑；这是本地闸门覆盖不到的唯一一段） |

## 6. 安全网

**不开 worktree**：整树重构在 worktree 里做完再合并，会变成一个巨大的 rename 合并，比直接在主树做更危险。改为**动手前打 tag**（`pre-flatten-2026-09-18`），任何一步炸了 `git reset --hard` 一条命令回到原点；`node_modules`/`dist` 已删，回滚后 `npm i` 即可。

## 7. 收尾

- 记忆中数十条写着 `Exchange_js/doc-final/…`，**不逐条改**（其价值在判例不在路径），改为写一条新旧路径映射的记忆条目
- `CLAUDE.md` 全文路径修订（含 §10 运维事实的栈命令与 DB 路径描述）、`TOOLING-DEBT.md` 一处
- CHANGELOG 一行；本轮 spec/plan 按规矩归档

## 8. 明确不做

- 不改 `重做版` 目录名（属搬家轮）
- 不动 `doc-final/archive/**` 的任何路径引用（它们是当时的事实记录，改了反而失真）
- 不趁机整理无关内容

## 9. 已知风险与兜底

| 风险 | 兜底 |
|---|---|
| 三处"层数假设"隐患漏改 | 已逐处定位（§2.1），plan 写死行号；且闸门 4/5 会因 `.stackports` 读不到而红 |
| `launch.json` 绝对路径改错 | 闸门 7 强制真起 preview |
| 云端打包路径错 | 闸门 8 真部署；`cloud-deploy.sh` 自愈已实测，但仍以真跑为准 |
| 归档误伤未完成任务 | `tx-leak-fix` 单独查证，拿不准就不归档 |
| 整体失败 | §6 tag 回滚 |
