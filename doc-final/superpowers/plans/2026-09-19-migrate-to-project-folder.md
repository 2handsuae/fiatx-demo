# 迁入项目总文件夹并更名 fiatx.com Implementation Plan

> **For agentic workers:** 本计划**不派子代理**，全程主会话执行——见 Global Constraints 第一条。步骤用 checkbox 追踪。

**Goal:** 把仓库从 `/Users/songshengwei/Documents/codex/projects/重做版` 迁到 `/Users/songshengwei/Documents/Project/fiatx.com`，并同步搬迁 5 个会话历史与 agent 记忆（2.3 GB / 203 条目），三类闸门与云端部署全绿。

**Architecture:** 先改不生效也无害的外部状态（Codex 授信），再把仓库与会话目录两个 `mv` 紧挨着做完（中间窗口越短越好），然后在新位置修剩余的绝对路径，最后逐层验收。全程可逆：两条 `mv` 反向执行即回到原状。

**Tech Stack:** `mv`（原子、可逆）｜git tag（内容回滚点）｜python3（安全读写 JSON）。

## Global Constraints

- **不派子代理，全程主会话**：本轮动作是破坏性的目录移动，且执行者自身的工作目录会被移走——子代理会遇到同样问题且更难诊断
- **旧路径**：`/Users/songshengwei/Documents/codex/projects/重做版`；**新路径**：`/Users/songshengwei/Documents/Project/fiatx.com`
- **旧会话目录**：`~/.claude/projects/-Users-songshengwei-Documents-codex-projects----`；**新会话目录**：`~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com`（编码规则已实测：`/`、空格、`.`、每个非 ASCII 字符都变 `-`）
- **Task 3 之后所有命令必须显式 `cd` 到新绝对路径**——shell 的继承工作目录届时已不存在
- **执行期间不得开新会话**（会在新路径抢建空目录，与 Task 3 的 `mv` 撞名）
- **绝对不碰** `重做版_副本`（另一个独立目录）与 `~/.claude.json` 里 10 个失效 worktree 残留键
- 每条需要 Node 的命令前置：`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`
- 仓库内部结构与内容**一个字不改**（上一轮压平已完成）

---

### Task 1: 前置核查 ＋ 回滚点 ＋ 备份

**Files:**
- Create: `~/.claude.json.bak-20260919`
- Create: git tag `pre-migrate-2026-09-19`

**Interfaces:**
- Produces: tag `pre-migrate-2026-09-19`（内容回滚点）；`~/.claude.json.bak-20260919`（配置回滚点）

- [ ] **Step 1: 四项前置全部核实**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
echo "--- 工作树干净？（期望空）---"; git status --short
echo "--- 活 worktree？（期望仅主树一行）---"; git worktree list
echo "--- 目标总文件夹存在且空？---"; ls -A /Users/songshengwei/Documents/Project/ | wc -l
echo "--- 新会话目录名未被占用？---"; ls -d ~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com 2>/dev/null && echo "⚠️占用" || echo "✅未占用"
```
Expected: 工作树空；worktree 仅一行；目标空（`0`）；输出 `✅未占用`
任一项不符 → **停下报告**，不要继续。

- [ ] **Step 2: 确认除本会话外无会话在跑**

用 `mcp__ccd_session_mgmt__list_sessions` 查，筛 `cwd` 指向旧路径且 `isRunning: true` 的行。
Expected: 零行（本会话被工具自动排除）
若有 → 停下，请业主先关掉。

- [ ] **Step 3: 打 tag 并备份配置**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
git tag pre-migrate-2026-09-19
git tag -l 'pre-migrate*'
cp ~/.claude.json ~/.claude.json.bak-20260919
ls -l ~/.claude.json.bak-20260919
```
Expected: 输出 tag 名；备份文件存在且非空

- [ ] **Step 4: 记录迁前基线（供迁后逐项比对）**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
echo "HEAD=$(git rev-parse HEAD)"
echo "会话目录条目数=$(ls ~/.claude/projects/-Users-songshengwei-Documents-codex-projects---- | wc -l)"
echo "memory 文件数=$(ls ~/.claude/projects/-Users-songshengwei-Documents-codex-projects----/memory/ | wc -l)"
```
把三个数字记进报告——Task 5 逐项核对。

---

### Task 2: 改 Codex 授信路径（仓库尚在原地，改完暂不生效但无害）

**Files:**
- Modify: `~/.codex/config.toml`（`[projects."…/重做版"]` 一节的键名）

- [ ] **Step 1: 看清现状**

```bash
grep -n '重做版' ~/.codex/config.toml
```
Expected: 恰一行，形如 `[projects."/Users/songshengwei/Documents/codex/projects/重做版"]`
若出现多行（例如还有 `重做版_副本`），**只改精确等于旧路径的那一行**。

- [ ] **Step 2: 精确替换**

```bash
python3 - <<'PY'
p='/Users/songshengwei/.codex/config.toml'
s=open(p).read()
old='[projects."/Users/songshengwei/Documents/codex/projects/重做版"]'
new='[projects."/Users/songshengwei/Documents/Project/fiatx.com"]'
assert s.count(old)==1, f'期望恰 1 处，实际 {s.count(old)} 处——停下检查'
open(p,'w').write(s.replace(old,new))
print('替换完成')
PY
grep -n 'fiatx.com\|重做版' ~/.codex/config.toml
```
Expected: 打印"替换完成"；grep 显示新路径行，且不再有纯 `重做版` 那行（`重做版_副本` 若存在应原样保留）

---

### Task 3: 原子迁移（两个 mv 紧挨着做）

**Files:**
- Move: 仓库目录 → `/Users/songshengwei/Documents/Project/fiatx.com`
- Move: `~/.claude/projects/-Users-songshengwei-Documents-codex-projects----` → `~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com`

**Interfaces:**
- Consumes: Task 1 的核查结论与回滚点
- Produces: 仓库与会话目录均已就位于新路径；**此后所有命令必须用新绝对路径**

- [ ] **Step 1: 一条命令内完成两次 mv（缩短撞名窗口）**

```bash
cd /Users/songshengwei/Documents
mv "/Users/songshengwei/Documents/codex/projects/重做版" "/Users/songshengwei/Documents/Project/fiatx.com" \
  && mv ~/.claude/projects/-Users-songshengwei-Documents-codex-projects---- \
        ~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com \
  && echo "✅ 两处迁移完成"
```
Expected: 输出 `✅ 两处迁移完成`
若第一条成功、第二条失败 → 立即反向执行第一条 `mv` 回滚，报告原因。

- [ ] **Step 2: 立即确认两处都在新位置、旧位置已空**

```bash
ls -d /Users/songshengwei/Documents/Project/fiatx.com && echo "仓库 ✓"
test ! -e "/Users/songshengwei/Documents/codex/projects/重做版" && echo "旧仓库路径已不存在 ✓"
ls -d ~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com && echo "会话目录 ✓"
test ! -e ~/.claude/projects/-Users-songshengwei-Documents-codex-projects---- && echo "旧会话目录已不存在 ✓"
```
Expected: 四行 ✓ 齐全

- [ ] **Step 3: 确认 shell 还能在新位置工作**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com && pwd && git rev-parse --show-toplevel
```
Expected: 两行都是新路径
若 shell 完全无法启动（起始目录消失导致）→ 这是 spec §2 预见的情形，**请业主在新路径重开会话继续 Task 4**，记忆与历史此时已在新位置、接得上。

---

### Task 4: 修剩余两处绝对路径

**Files:**
- Modify: `~/.claude.json`（仅 1 个 `projects` 键）
- Modify: `/Users/songshengwei/Documents/Project/fiatx.com/.claude/launch.json`（4 处）

- [ ] **Step 1: 改 `~/.claude.json` 的真身键**

```bash
python3 - <<'PY'
import json
p='/Users/songshengwei/.claude.json'
d=json.load(open(p))
old='/Users/songshengwei/Documents/codex/projects/重做版'
new='/Users/songshengwei/Documents/Project/fiatx.com'
pr=d.get('projects',{})
assert old in pr, '未找到真身键——停下检查'
assert new not in pr, '新键已存在——停下检查'
pr[new]=pr.pop(old)
json.dump(d,open(p,'w'),ensure_ascii=False,indent=2)
print('真身键已改名；其余键未动，剩余含旧路径的键数 =',
      sum(1 for k in pr if '重做版' in k))
PY
```
Expected: 打印成功，且"剩余含旧路径的键数" = 11（10 个失效 worktree 残留 + 1 个 `重做版_副本`，按 Global Constraints 有意保留）

- [ ] **Step 2: 验证 JSON 仍合法**

```bash
python3 -c "import json;d=json.load(open('/Users/songshengwei/.claude.json'));print('✅ JSON 合法, projects 键数=',len(d.get('projects',{})))"
```
Expected: 输出合法与键数（应与迁前一致，只是其中一个改了名）

- [ ] **Step 3: 改 `launch.json` 的 4 处绝对路径**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
python3 - <<'PY'
p='.claude/launch.json'
s=open(p).read()
old='/Users/songshengwei/Documents/codex/projects/重做版'
new='/Users/songshengwei/Documents/Project/fiatx.com'
n=s.count(old)
assert n==4, f'期望 4 处，实际 {n} 处——停下检查'
open(p,'w').write(s.replace(old,new))
print('已替换 4 处')
PY
grep -c '重做版' .claude/launch.json
python3 -c "import json;json.load(open('.claude/launch.json'));print('✅ JSON 合法')"
```
Expected: 打印"已替换 4 处"；`grep -c` 为 `0`；JSON 合法

- [ ] **Step 4: 提交 launch.json（`~/.claude.json` 与 Codex 配置在仓库外，不入库）**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
git add .claude/launch.json
git commit -m "chore(迁移): launch.json 四处绝对路径改指新位置 Documents/Project/fiatx.com"
git log --oneline -1
```

---

### Task 5: 验收第一层——git 完整性 ＋ 会话目录 ＋ 本地闸门

**Files:** 无改动（纯验收）

- [ ] **Step 1: git 完整性与基线比对**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
git status --short
git log --oneline -3
git rev-parse HEAD
```
Expected: 工作树干净；日志正常；HEAD 应为 Task 4 Step 4 的新 commit，其父提交应等于 Task 1 Step 4 记录的 HEAD

- [ ] **Step 2: 会话目录与记忆完好**

```bash
D=~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com
echo "条目数=$(ls "$D" | wc -l)"
echo "memory 文件数=$(ls "$D"/memory/ | wc -l)"
ls "$D"/memory/MEMORY.md && echo "MEMORY.md ✓"
```
Expected: 条目数与 memory 文件数**与 Task 1 Step 4 记录的完全一致**；`MEMORY.md ✓`

- [ ] **Step 3: 依赖与随手闸**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npx prisma generate 2>&1 | tail -2
npx tsc --noEmit -p tsconfig.json && echo '① 后端绿'
(cd admin-web && npx tsc -b --noEmit) && echo '② 管理台绿'
(cd client-web && npx tsc -b --noEmit) && echo '③ 客户端绿'
```
Expected: 三绿
注：`node_modules` 随目录整体移动，无需重装；若 `npx` 报找不到模块，再跑 `npm i`。

- [ ] **Step 4: 从零重建 ＋ 主线端到端 ＋ 领域不变量**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
bash scripts/stack.sh down main 2>&1 | tail -3
bash scripts/stack.sh reset main 2>&1 | tail -8
bash scripts/stack.sh up main 2>&1 | tail -3
sleep 15
bash scripts/on-stack.sh main demo:all 2>&1 | tail -12
bash scripts/on-stack.sh main verify:coa 2>&1 | tail -8
```
Expected: reset 成功；`demo:all` 花名册与断言全过；`verify:coa` 全绿
注：起栈前必须先 `down`——迁移前的进程跑在已消失的旧路径上（压平那轮的判例："对未重启旧进程做栈验＝污染"）。

---

### Task 6: 验收第二层——preview 渲染 ＋ Codex 双工具复验

**Files:** 无改动（纯验收）

- [ ] **Step 1: preview 起管理台并截图**

用 preview 工具按 `admin-web-main` 配置（端口 3103）起服务，打开页面，**全分辨率**截图。
Expected: 管理台登录页完整渲染（背景插画 + 表单 + AUTHENTICATE 按钮）
注：**不要用缩放截图判读**——压平那轮判例：0.5/0.55 缩放会把深色主题渲染成近乎空白。
截图落 `.superpowers-shots/migrate/`，路径写进报告。

- [ ] **Step 2: 停掉 preview**

用 preview_stop 停掉刚起的服务（serverId 从 Step 1 的返回取）。

- [ ] **Step 3: Codex 在新路径仍认总纲与 skill**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
codex exec --sandbox read-only "不要读取任何文件，也不要搜索。就按你现在上下文里已有的内容直接回答两个问题：1）这个会话自动加载了哪些项目指令文件？请列出文件名。2）你可用的技能列表里有没有 project-governance？" 2>&1 | tail -12
```
Expected: 答出 `AGENTS.md`（说明软链总纲在新路径仍被自动加载）且技能列表含 `project-governance`
注：提示词里"不要读取任何文件、不要搜索"不可省——否则它 grep 到 CLAUDE.md 就是假阳性（上一轮判例）。

---

### Task 7: 验收第三层——云端真部署

**Files:** 无改动（纯验收）

- [ ] **Step 1: 部署前置检查**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
git status --porcelain -- src prisma scripts config admin-web client-web deploy package.json package-lock.json .npmrc tsconfig.json tsconfig.build.json
```
Expected: 空输出

- [ ] **Step 2: 真部署**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
npm run cloud:deploy 2>&1 | tail -20
```
Expected: 五步全过、打印部署成功；耗时约 71–74 秒（既有基线）

- [ ] **Step 3: 线上验活**

```bash
curl -sk -o /dev/null -w 'admin  %{http_code}\n' https://admin-fiatx-demo.duckdns.org
curl -sk -o /dev/null -w 'client %{http_code}\n' https://fiatx-demo.duckdns.org
```
Expected: 两个 `200`

---

### Task 8: 收尾

**Files:**
- Modify: `~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com/memory/repo-path-flattened.md`（补迁移后的新路径事实）
- Modify: 同目录 `memory/MEMORY.md`（指针行更新）
- Modify: `/Users/songshengwei/Documents/Project/fiatx.com/doc-final/CHANGELOG.md`
- Move: 本轮 spec 与 plan → `doc-final/archive/superpowers/{specs,plans}/`

- [ ] **Step 1: 更新路径记忆**

把 `memory/repo-path-flattened.md` 扩写为覆盖两次变更：① 2026-09-18 压平（`Exchange_js/` 夹心层消失）② 2026-09-19 迁址更名（`/Users/songshengwei/Documents/codex/projects/重做版` → `/Users/songshengwei/Documents/Project/fiatx.com`）。写清：旧记忆与 archive 文档里的路径一律按"去掉 `Exchange_js/` 一段 + 换新前缀"两步换算；会话目录编码规则（含点号变横线的实测）；两个回滚 tag。

- [ ] **Step 2: MEMORY.md 指针行更新**

把现有那条压平指针行改写为同时涵盖迁址，标题改为「仓库已压平并迁址·现位于 Documents/Project/fiatx.com」。

- [ ] **Step 3: CHANGELOG 一行**

在最新条目之前追加（格式照文件既有行）：

```
- [2026-09-19] **仓库迁入项目总文件夹并更名 fiatx.com（纯位置调整，演示系统零变化）** —— 观众无感知变化，仓库内容一行未改。位置从 `Documents/codex/projects/重做版` 迁到 `Documents/Project/fiatx.com`（工具中立的总文件夹，后续其它项目照此汇拢；顺带摆脱中文目录名在 shell 脚本里的历史雷区）。关键点是 Claude Code 按**路径编码**存会话与 agent 记忆（`/`、空格、`.`、每个非 ASCII 字符都编码成 `-`，实测确认），2.3 GB / 203 条目（5 个会话历史 + memory 目录）必须与仓库同时搬迁，否则历史与记忆会"消失"；另同步三处按路径记账的外部状态：Codex 授信、`~/.claude.json` 真身键、`.claude/launch.json` 四处绝对路径。验收：git 完整性 + 会话目录条目数逐项比对 + 三类闸门全绿 + preview 真渲染 + Codex 双工具复验 + 云端真部署。回滚点 tag `pre-migrate-2026-09-19`。
```

- [ ] **Step 4: 归档本轮 spec/plan 并提交**

```bash
cd /Users/songshengwei/Documents/Project/fiatx.com
git mv doc-final/superpowers/specs/2026-09-19-migrate-to-project-folder-design.md doc-final/archive/superpowers/specs/
git mv doc-final/superpowers/plans/2026-09-19-migrate-to-project-folder.md doc-final/archive/superpowers/plans/
git add doc-final/CHANGELOG.md
git commit -m "docs(收尾): 迁址交付——CHANGELOG 一行 + 本轮 spec/plan 归档"
git log --oneline -3
git status --short
```
Expected: 提交成功；工作树干净

- [ ] **Step 5: 按总纲 §9 报告**

`Documentation updated: none（纯位置调整 + CHANGELOG + specs/plans 归档）— 仓库现位于 /Users/songshengwei/Documents/Project/fiatx.com`

- [ ] **Step 6: 告知业主后续事项**

提醒两点：① 以后开会话请在新路径开；② 其余项目批量搬迁时照本轮流程走（关会话 → 打 tag → 两个 mv → 改三处外部状态 → 验收），每个项目的会话目录编码名按规则现算。

---

## 自检记录（writing-plans Self-Review）

- **Spec 覆盖**：§1.1 会话目录→T3 Step 1/T5 Step 2；§1.2 三处外部状态→T2（Codex）＋T4（claude.json、launch.json）；§1.3 不受影响项→无需动作，由 T7 云端真跑兜底；§1.4 前置→T1 Step 1–2；§2 自拔地板难点→Global Constraints 第三条＋T3 Step 3 的兜底指令；§3 执行顺序→T2→T3→T4 严格对应；§4 九项验收→T5（1–6）＋T6（7、9）＋T7（8）；§5 安全网→T1 Step 3（tag＋备份）＋T3 Step 1 的回滚指令；§6 不做→Global Constraints；§7 风险→各 Task 的 Expected 与"停下报告"。无遗漏。
- **占位符**：无 TBD 类；所有替换给出精确原文、新文本与断言式校验（`assert` 数量不符即停）。
- **一致性**：新旧路径字符串在 T2/T3/T4 三处逐字一致；会话目录新旧编码名在 T3/T5 一致；tag 名 `pre-migrate-2026-09-19` 在 T1/CHANGELOG 一致。
- **已知不确定**：T3 之后 shell 能否正常启动无法预先验证（取决于 harness 如何处理消失的起始目录），故 T3 Step 3 内置了"请业主在新路径重开会话"的兜底路径。
