# 压掉 Exchange_js 夹心层 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `重做版/Exchange_js/**` 提升一级到仓库根，夹心层消失，三类闸门与云端部署全绿。

**Architecture:** 先预清理降低搬运面（归档 20 份 spec/plan、删可重建的 `node_modules`/`dist`、挪走无关的根 `.env`），再一次性物理压平并合并四处撞车，然后修 6 处必改路径与若干过时注释，最后逐层验收（本地闸门 → preview → 云端真部署）。动手前打 tag，任何一步炸了一条命令回滚。

**Tech Stack:** git（`git mv` 保留 rename 历史）｜bash 脚本｜NestJS + Prisma + SQLite ｜Node 20。

## Global Constraints

- 仓库路径本身**不变**（仍是 `/Users/songshengwei/Documents/codex/projects/重做版`）；**不改目录名**（属后续搬家轮）
- **`doc-final/archive/**` 的任何路径引用一律不碰**——它们是当时的事实记录，改了反而失真
- 每条命令前置 Node 20：`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`（本机 shell 默认 v18）
- jest 必须在项目根下跑；需要 `DATABASE_URL` 时显式 export
- 12 个 demo/recon 脚本**必须经包装器**：`bash scripts/on-stack.sh main <script>`
- 派发分层（风险定档）：**Task 1、2、5–8 主会话执行**（破坏性/结构性/需诊断）；**Task 3、4 派 `haiku`＋`sonnet` 评审**（精确串替换，内容已写死）
- 提交规约：每个 Task 一个 commit；Task 8 前不碰 CHANGELOG

---

### Task 1: 预清理（tag ＋ 归档 20 份 ＋ 挪走根 .env ＋ 删可重建物）

**Files:**
- Move: `Exchange_js/doc-final/superpowers/specs/*.md`（14 份）→ `Exchange_js/doc-final/archive/superpowers/specs/`
- Move: `Exchange_js/doc-final/superpowers/plans/*.md`（6 份）→ `Exchange_js/doc-final/archive/superpowers/plans/`
- Move: `.env` → `~/.env.minimax-key.bak`
- Delete: `Exchange_js/node_modules/`、`Exchange_js/dist/`

**Interfaces:**
- Produces: tag `pre-flatten-2026-09-18`（Task 1–8 任一步失败的回滚点）；归档后 `superpowers/specs/` 与 `plans/` 应为空（仅余 `plans/artifacts/`）

- [ ] **Step 1: 打回滚 tag**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
git tag pre-flatten-2026-09-18
git tag -l 'pre-flatten*'
```
Expected: 输出 `pre-flatten-2026-09-18`

- [ ] **Step 2: 查证 tx-leak-fix 是否真已完成**

```bash
grep -n 'connection_limit' CLAUDE.md | head -3
git log --oneline --all -- Exchange_js/doc-final/superpowers/plans/2026-09-11-tx-leak-fix.md | tail -3
```
判据：`CLAUDE.md` §10 已写入 `?connection_limit=1`（说明该修复已落地生产配置）→ 判为已完成，可归档。若判据不成立，**该两份（spec + plan）留在活区**，并在 Task 4 追加它们的路径修订。把判定结论写进报告。

- [ ] **Step 3: 归档 20 份**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
git mv Exchange_js/doc-final/superpowers/specs/*.md Exchange_js/doc-final/archive/superpowers/specs/
git mv Exchange_js/doc-final/superpowers/plans/*.md Exchange_js/doc-final/archive/superpowers/plans/
ls Exchange_js/doc-final/superpowers/specs/ Exchange_js/doc-final/superpowers/plans/
```
Expected: specs 目录空；plans 目录仅余 `artifacts`
注意：本计划自身与其 spec 尚未生成到该目录（它们在 Task 8 才归档），若 `ls` 显示本轮 spec/plan 仍在，属正常——它们是活件，**不要**在本步归档。

- [ ] **Step 4: 挪走与本项目无关的根 .env**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
cat .env    # 确认只有一行 MINIMAX_API_KEY
mv .env ~/.env.minimax-key.bak
ls -l ~/.env.minimax-key.bak && ls .env 2>&1 | head -1
```
Expected: 备份存在；根 `.env` 已不存在（`No such file`）
若 `cat` 显示的不止 `MINIMAX_API_KEY` 一行，**停下报告**，不要移动。

- [ ] **Step 5: 删可重建物**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
rm -rf Exchange_js/node_modules Exchange_js/dist
ls Exchange_js/ | grep -cE '^(node_modules|dist)$'
```
Expected: `0`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(预清理): 归档 20 份已完成 spec/plan + 移走无关根 .env + 删可重建的 node_modules/dist（压平前置）"
git log --oneline -1
```

---

### Task 2: 物理压平 ＋ 四处撞车合并

**Files:**
- Modify: `.gitignore`（写入并集）
- Delete: `Exchange_js/.claude/launch.json`（死 stub）、`Exchange_js/.gitignore`
- Move: `Exchange_js/.claude/settings.json` → `.claude/settings.json`
- Move: 其余全部 `Exchange_js/*` → 仓库根
- Delete: 空的 `Exchange_js/`

**Interfaces:**
- Consumes: Task 1 的 tag 与预清理结果
- Produces: 仓库根直接含 `src/ admin-web/ client-web/ doc-final/ prisma/ scripts/ config/ deploy/ test/ package.json tsconfig.json …`；`Exchange_js/` 不再存在

- [ ] **Step 1: 写入合并后的 .gitignore**

把仓库根 `.gitignore` 整文件替换为（两份并集，去重；`.superpowers/` 带斜杠只匹配目录，不会误伤已入库的 `.superpowers-shots`）：

```
.DS_Store
.codex/
.superpowers/
.stackports
.vite/
.upd.json

node_modules
dist/
.trae/

# Keep environment variables out of version control
.env
.cloud.env

*.bak
/generated/prisma
*.db
*.db.*
*.log
admin_token.txt
```

- [ ] **Step 2: 处理 .claude 撞车**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
head -8 Exchange_js/.claude/launch.json    # 确认是 echo stub 再删
git rm Exchange_js/.claude/launch.json
git mv Exchange_js/.claude/settings.json .claude/settings.json
git rm Exchange_js/.gitignore
ls .claude/
```
Expected: `.claude/` 含 `launch.json`、`settings.json`、`worktrees`（`.superpowers` 为忽略项可能不显示）
若 `head` 显示的不是 `"runtimeExecutable": "echo"` 的 stub，**停下报告**。

- [ ] **Step 3: git mv 全部入库项**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
for e in .cloud.env.example .env.example .eslintrc.js .npmrc .nvmrc .prettierrc .superpowers-shots \
         admin-web client-web config deploy doc-final jest.config.js nest-cli.json \
         package-lock.json package.json prisma scripts src test tsconfig.build.json tsconfig.json; do
  git mv "Exchange_js/$e" "$e" || echo "✖ FAILED: $e"
done
git status --short | head -5
```
Expected: 无 `FAILED` 行

- [ ] **Step 4: mv 未入库但要保留的两份**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
mv Exchange_js/.cloud.env .cloud.env
mv Exchange_js/.env .env
rm -f Exchange_js/.DS_Store
ls -a Exchange_js/ | grep -v '^\.$\|^\.\.$' || echo '✅ Exchange_js 已空'
```
Expected: `✅ Exchange_js 已空`（`.claude` 若残留空目录一并 `rmdir`）

- [ ] **Step 5: 删除空壳目录并确认结构**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
rmdir Exchange_js/.claude 2>/dev/null; rmdir Exchange_js
ls -a | grep -v '^\.$\|^\.\.$\|^\.git$'
test ! -e Exchange_js && echo '✅ 夹心层已消失'
```
Expected: 根层可见 `src`、`doc-final`、`package.json` 等；输出 `✅ 夹心层已消失`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(压平): Exchange_js/** 提升一级到仓库根，夹心层消失；合并 .gitignore/.claude，删内层死 launch.json stub"
git log --oneline -1
git show --stat HEAD | tail -3
```

---

### Task 3: 修 6 处必改路径（改错即运行时静默失败）

**Files:**
- Modify: `.claude/launch.json`（4 处绝对路径）
- Modify: `scripts/stack-common.sh`（第 9、104、125 行）
- Modify: `scripts/demo-lib.ts`（第 193 行）
- Modify: `scripts/verify-rbac.ts`（第 48 行）
- Modify: `部署.command`、`重铺数据.command`（各第 3 行）

**Interfaces:**
- Consumes: Task 2 压平后的新结构（文件已在根层，行号不变）
- Produces: 全仓再无"假设两级"的路径计算

- [ ] **Step 1: 改 `.claude/launch.json` 的 4 处绝对路径**

把文件中所有 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js` 替换为 `/Users/songshengwei/Documents/codex/projects/重做版`（即删掉 `/Exchange_js` 一段），共 4 处。

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
python3 - <<'PY'
p='.claude/launch.json'
s=open(p).read()
n=s.count('/重做版/Exchange_js')
s=s.replace('/重做版/Exchange_js','/重做版')
open(p,'w').write(s)
print('replaced:',n)
PY
grep -c 'Exchange_js' .claude/launch.json
python3 -c "import json;json.load(open('.claude/launch.json'));print('✅ JSON 合法')"
```
Expected: `replaced: 4`；`grep -c` 为 `0`；输出 `✅ JSON 合法`

- [ ] **Step 2: 改 `scripts/stack-common.sh` 三处**

第 9 行（**grep `Exchange_js` 抓不到的层数假设**）：
```
  CURRENT_WT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
```
改为：
```
  CURRENT_WT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
```

第 104 行：`      APP_DIR="${ROOT_DIR}/Exchange_js"` 改为 `      APP_DIR="${ROOT_DIR}"`

第 125 行：`      APP_DIR="${WT_DIR}/Exchange_js"` 改为 `      APP_DIR="${WT_DIR}"`

```bash
grep -n 'Exchange_js\|SCRIPT_DIR}/\.\.' scripts/stack-common.sh | head
bash -n scripts/stack-common.sh && echo '✅ 语法通过'
```
Expected: 无 `Exchange_js` 命中；第 9 行显示 `${SCRIPT_DIR}/..`；语法通过

- [ ] **Step 3: 改两处 `.stackports` 层数假设（grep 抓不到的那类）**

`scripts/demo-lib.ts` 第 193 行：
```
  const stackportsPath = path.resolve(__dirname, '../../.stackports');
```
改为：
```
  const stackportsPath = path.resolve(__dirname, '../.stackports');
```

`scripts/verify-rbac.ts` 第 48 行：
```
    const stackportsPath = path.resolve(__dirname, '../../.stackports');
```
改为：
```
    const stackportsPath = path.resolve(__dirname, '../.stackports');
```

```bash
grep -n "\.stackports" scripts/demo-lib.ts scripts/verify-rbac.ts
```
Expected: 两行都显示 `'../.stackports'`，无 `'../../.stackports'`

- [ ] **Step 4: 改两个双击脚本**

两个文件的第 3 行均为 `cd "$(dirname "$0")/Exchange_js" || exit 1`，改为 `cd "$(dirname "$0")" || exit 1`。

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
sed -i '' 's|cd "$(dirname "$0")/Exchange_js" || exit 1|cd "$(dirname "$0")" || exit 1|' 部署.command 重铺数据.command 2>/dev/null || true
grep -n 'cd "$(dirname' 部署.command 重铺数据.command
bash -n 部署.command && bash -n 重铺数据.command && echo '✅ 两个 .command 语法通过'
```
Expected: 两行都是 `cd "$(dirname "$0")" || exit 1`；语法通过
（若 `sed` 因转义未生效，直接用编辑器改这两行。）

- [ ] **Step 5: 全面复核——确认无遗漏**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
echo '--- 活区仍含 Exchange_js 字面量的（应只剩注释/文档，无路径计算）---'
git grep -n 'Exchange_js' -- . ':!doc-final/archive' ':!*.md'
echo '--- 活区仍有向上两级到仓库根的（应为空）---'
git grep -nE "resolve\(__dirname, *'\.\./\.\./|SCRIPT_DIR\}/\.\./\.\." -- scripts/ src/
```
Expected: 第一段仅剩 `.env.example` 抬头、`scripts/backfill-account-flow.ts:9`、`cloud-deploy.sh:14`、`cloud-env.sh:3,6` 这几条**注释**；第二段为空

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(压平): 修 6 处路径——launch.json 4 处绝对路径/stack-common 三处(含层数假设)/两处 .stackports 层数假设/两个 .command"
```

---

### Task 4: 修活文档与过时注释

**Files:**
- Modify: `CLAUDE.md`（第 3、127、129 行；**第 1 行不改**）
- Modify: `doc-final/TOOLING-DEBT.md`（第 139 行内的复现命令）
- Modify: `.env.example`（第 1 行注释）、`scripts/backfill-account-flow.ts`（第 9 行注释）、`scripts/cloud-deploy.sh`（第 14 行注释）、`scripts/cloud-env.sh`（第 3、6 行注释）

**Interfaces:**
- Consumes: Task 2/3 的新结构
- Produces: 活文档路径与现实一致；`doc-final/archive/**` 保持原样未动

- [ ] **Step 1: 改 CLAUDE.md 三处（注意第 1 行是项目名不是路径，不改）**

第 3 行：`NestJS + Prisma + SQLite 后端 ｜ React 管理台 ｜ React 客户端 ｜ 会话在 `Exchange_js/` 下运行`
改为：`NestJS + Prisma + SQLite 后端 ｜ React 管理台 ｜ React 客户端 ｜ 会话在仓库根下运行`

第 127 行：把 `` `Exchange_js/.cloud.env` `` 改为 `` `.cloud.env` ``

第 129 行：把 `` `Exchange_js/deploy/demo.env.template` `` 改为 `` `deploy/demo.env.template` ``

```bash
grep -n 'Exchange_js' CLAUDE.md
```
Expected: 仅剩第 1 行 `# Exchange_js — 项目总纲`（项目名，保留）

- [ ] **Step 2: 改 TOOLING-DEBT.md 的复现命令**

第 139 行那条债目的 **复现** 段内，把 `cd <worktree>/Exchange_js` 改为 `cd <worktree>`。

```bash
grep -c 'worktree>/Exchange_js' doc-final/TOOLING-DEBT.md
```
Expected: `0`

- [ ] **Step 3: 改四处过时注释**

- `.env.example` 第 1 行：`# ── Exchange_js environment template ───…` → 把 `Exchange_js` 改为 `项目`（其余装饰线保持原样）
- `scripts/backfill-account-flow.ts` 第 9 行：`//     Exchange_js/scripts/backfill-account-flow.ts` → `//     scripts/backfill-account-flow.ts`
- `scripts/cloud-deploy.sh` 第 14 行：`REL="${REL%/}"   # = Exchange_js` → `REL="${REL%/}"   # 仓库根运行时为空串；git archive "HEAD:" 即根树（已实测合法）`
- `scripts/cloud-env.sh` 第 3 行：`# 读 Exchange_js/.cloud.env（本机、未入库）：…` → 把 `Exchange_js/.cloud.env` 改为 `.cloud.env`
- `scripts/cloud-env.sh` 第 6 行：`CLOUD_APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # = Exchange_js/` → 把行尾注释改为 `# = 仓库根`

```bash
git grep -n 'Exchange_js' -- . ':!doc-final/archive' ':!CLAUDE.md'
bash -n scripts/cloud-deploy.sh && bash -n scripts/cloud-env.sh && echo '✅ 语法通过'
```
Expected: 第一条命令无输出（archive 与 CLAUDE.md 第 1 行除外）；语法通过

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs(压平): 活文档与注释路径同步——CLAUDE.md 三处/TOOLING-DEBT 复现命令/四处脚本注释；archive 一律未动"
```

---

### Task 5: 本地闸门（依赖重建 → tsc×3 → jest → 重铺 → demo:all → verify:coa）

**Files:** 无改动（纯验收；若红则回到 Task 3/4 定位）

**Interfaces:**
- Consumes: Task 1–4 全部改动

- [ ] **Step 1: 依赖重建**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm i
npx prisma generate
```
Expected: 两条均无 error 退出

- [ ] **Step 2: 随手闸三条 tsc**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx tsc --noEmit -p tsconfig.json && echo '① 后端绿'
cd admin-web  && npx tsc -b --noEmit && echo '② 管理台绿' && cd ..
cd client-web && npx tsc -b --noEmit && echo '③ 客户端绿' && cd ..
```
Expected: 三条各自输出"绿"

- [ ] **Step 3: jest（重点覆盖 scripts 与改动面）**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export DATABASE_URL="file:/tmp/exchange_js_main/dev.db"
npx jest scripts src/core --silent 2>&1 | tail -15
```
Expected: 全绿（失败数 0）。若红，**先判断是否路径问题**（`.stackports`、`doc-final` 相关），是则回 Task 3 补修。

- [ ] **Step 4: 从零重建闸**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
bash scripts/stack.sh reset main 2>&1 | tail -20
```
Expected: 建库重铺完成、无 error（含 TigerBeetle 清理重建）

- [ ] **Step 5: 主线端到端 ＋ 领域不变量**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
bash scripts/on-stack.sh main demo:all 2>&1 | tail -25
bash scripts/on-stack.sh main verify:coa 2>&1 | tail -15
```
Expected: `demo:all` 走通并断言终态（对照 `doc-final/demo/baseline.md`）；`verify:coa` 两恒等式 ＋ 负余额断言全绿

- [ ] **Step 6: 记录结果**

把六步的实际输出要点写进报告。**任一步红且非路径原因**，停下报告，不要自行改代码绕过。

---

### Task 6: preview 起栈（唯一能逮住 launch.json 绝对路径写错的闸）

**Files:** 无改动（纯验收）

- [ ] **Step 1: 起管理台并截图**

用 preview 工具按 `.claude/launch.json` 的 `admin` 配置起服务，打开管理台登录页，截图。
Expected: 页面真渲染（不是 502/空白）；若起不来，检查 `.claude/launch.json` 里的路径是否还残留 `Exchange_js`

- [ ] **Step 2: 起客户端并截图**

同上，用 `client-web-main` 配置。
Expected: 客户端页面真渲染

- [ ] **Step 3: 记录**

两张截图落 `.superpowers-shots/flatten/`，路径写进报告。

---

### Task 7: 云端部署真跑（本地闸门覆盖不到的唯一一段）

**Files:** 无改动（纯验收）

**Interfaces:**
- Consumes: Task 3 已修 `.command`；`scripts/cloud-deploy.sh` 的 `REL` 自愈已实测但以真跑为准

- [ ] **Step 1: 确认运行相关文件已全部提交**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
git status --porcelain -- src prisma scripts config admin-web client-web deploy package.json package-lock.json .npmrc tsconfig.json tsconfig.build.json
```
Expected: 空输出（`cloud-deploy.sh` 第 13–19 行会自行预检，不干净会拒绝部署）

- [ ] **Step 2: 真部署**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run cloud:deploy 2>&1 | tail -30
```
Expected: 五步全过、结束打印部署成功；耗时约 74 秒（业主 2026-09-12 实测基线）
若在 `git archive "HEAD:${REL}"` 那步失败，说明 `REL` 空串推断有误——把原始报错贴进报告，改用 `git archive "HEAD:" …` 显式写法。

- [ ] **Step 3: 线上验活**

```bash
curl -sk -o /dev/null -w '%{http_code}\n' https://admin-fiatx-demo.duckdns.org
curl -sk -o /dev/null -w '%{http_code}\n' https://fiatx-demo.duckdns.org
```
Expected: 两个都是 `200`

- [ ] **Step 4: 记录**

把部署输出要点、耗时、两个 HTTP 码写进报告。

---

### Task 8: 收尾（记忆映射 ＋ CHANGELOG ＋ 归档本轮 spec/plan）

**Files:**
- Create: `~/.claude/projects/-Users-songshengwei-Documents-codex-projects----/memory/repo-path-flattened.md`
- Modify: `~/.claude/projects/-Users-songshengwei-Documents-codex-projects----/memory/MEMORY.md`（加一行指针）
- Modify: `doc-final/CHANGELOG.md`
- Move: 本轮 spec 与 plan → `doc-final/archive/superpowers/{specs,plans}/`

- [ ] **Step 1: 写路径映射记忆**

新建记忆文件，`type: project`，正文要点：2026-09-18 起 `Exchange_js/` 夹心层消失，旧记忆与 archive 文档里的 `Exchange_js/doc-final/…` 一律读作 `doc-final/…`；旧记忆不逐条改（价值在判例不在路径）；仓库根路径未变；`tag pre-flatten-2026-09-18` 是压平前的最后状态。

- [ ] **Step 2: MEMORY.md 加指针行**

在文件最前面加一行：`- [仓库已压平·Exchange_js 夹心层消失(2026-09-18)](repo-path-flattened.md) — 旧记忆/archive 里的 Exchange_js/doc-final/… 读作 doc-final/…;仓库根路径未变;回滚点 tag pre-flatten-2026-09-18`

- [ ] **Step 3: CHANGELOG 一行**

在最新条目之前追加（格式照文件既有行）：

```
- [2026-09-18] **仓库去掉 Exchange_js 夹心层（纯结构调整，演示系统零变化）** —— 观众无感知变化，业务代码一行未改。`重做版/Exchange_js/**` 全部提升一级到仓库根，此后 `src/`、`doc-final/`、`scripts/` 等直接位于仓库根下；顺带归档 20 份早该归档的 spec/plan、删除并重装 node_modules。真正的破坏面是 6 处路径计算（`.claude/launch.json` 四处绝对路径、`stack-common.sh` 三处含一处"向上两级"层数假设、两处 `.stackports` 同款层数假设、两个双击 `.command`）——其中三处 grep `Exchange_js` 根本抓不到，只能靠搜相对路径层数找出来。`cloud-deploy.sh` 的 `REL` 由 `git rev-parse --show-prefix` 动态计算、压平后变空串，实测 `git archive "HEAD:"` 仍指向根树故自愈。`doc-final/archive/**` 的路径引用一律未动（它们是当时的事实记录）。验收：三类闸门全绿 + preview 双端渲染 + 云端真部署通过。
```

- [ ] **Step 4: 归档本轮 spec/plan 并提交**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
git mv doc-final/superpowers/specs/2026-09-18-flatten-exchange-js-layer-design.md doc-final/archive/superpowers/specs/
git mv doc-final/superpowers/plans/2026-09-18-flatten-exchange-js-layer.md doc-final/archive/superpowers/plans/
git add doc-final/CHANGELOG.md
git commit -m "docs(收尾): 压平交付——CHANGELOG 一行 + 本轮 spec/plan 归档"
git log --oneline -3
```

- [ ] **Step 5: 按总纲 §9 报告**

`Documentation updated: none（仅结构调整 + CHANGELOG + specs/plans 归档）— Exchange_js 夹心层已消失，仓库根即项目根`

---

## 自检记录（writing-plans Self-Review）

- **Spec 覆盖**：§1 现状→T2 分类清单；§2.1 六处必改→T3 逐处（含三处 grep 抓不到的）；§2.2 自愈四处→T3 Step 5 复核命令确认无残留 ＋ T7 云端真跑兜底；§2.3 注释→T4 Step 3；§3 四处撞车→T1 Step 4（.env）＋T2 Step 1/2（.gitignore/.claude/.DS_Store）；§4 两笔债→T1 Step 2/3/5；§5 八条闸门→T5（1–6）＋T6（7）＋T7（8）；§6 tag→T1 Step 1；§7 收尾→T8；§8 不做→Global Constraints；§9 风险兜底→各 Task 的 Expected 与"停下报告"指令。无遗漏。
- **占位符**：无 TBD 类；所有替换给出精确原文与新文本。
- **一致性**：tag 名 `pre-flatten-2026-09-18` 在 T1/T8 一致；`.stackports` 改法（`'../../'`→`'../'`）在 T3 Step 3 两处一致；archive 不动的约束在 Global Constraints、T3 Step 5、T4 Step 3 三处措辞一致。
- **已知不确定**：T1 Step 2 的 `tx-leak-fix` 归档判定需现场取证；T7 若 `REL` 空串推断有误，该步已内置显式写法的回退指令。
