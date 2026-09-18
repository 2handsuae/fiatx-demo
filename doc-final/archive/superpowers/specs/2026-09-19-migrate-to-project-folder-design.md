# 设计：迁入项目总文件夹并更名 fiatx.com

2026-09-19 ｜ 状态：设计稿，待业主批准 ｜ 前一轮：压平（`archive/superpowers/specs/2026-09-18-flatten-exchange-js-layer-design.md`）

## 0. 目标

把仓库从 `/Users/songshengwei/Documents/codex/projects/重做版` 迁到 `/Users/songshengwei/Documents/Project/fiatx.com`，**同时保住 5 个历史会话与 agent 记忆**。这是"批量搬迁"的第一个项目，本轮同时确立后续项目照搬的流程。

本轮是**纯外壳变更**：仓库内部结构一个字不动（上一轮压平已完成），只改仓库在磁盘上的位置与名字，以及所有按该路径记账的外部状态。

## 1. 已实测的事实

### 1.1 会话与记忆按路径编码存储

Claude Code 把项目相关的一切存在 `~/.claude/projects/<编码后的路径>/`。编码规则实测确认：**`/`、空格、`.`、每个非 ASCII 字符都变成 `-`**（证据：`daily english` → `daily-english`；`重做版` → `---`；一次性实验 `/private/tmp/enc.test/sub` → `-private-tmp-enc-test-sub`，证明点号也变横线）。

- 现目录：`-Users-songshengwei-Documents-codex-projects----`，**2.3 GB / 203 个条目**
- 内含：5 个会话的完整记录（第6幕内容优化 / 第四期产品文档规划 / 项目同步与进度检查 / Admin 审计日志页面设计 / 第七幕第三波优化）**以及 agent 的 `memory/` 目录**
- 迁后目录名：`-Users-songshengwei-Documents-Project-fiatx-com`（已确认未被占用）

**不搬这个目录 = 历史与记忆全部"消失"**（数据还在盘上，但 Claude Code 按新路径去算名字，看到的是空目录）。

### 1.2 另外三处按路径记账

| 位置 | 内容 | 处置 |
|---|---|---|
| `~/.claude.json` | 12 个 `projects` 键含旧路径 | **只改 1 个真身键**；其余 10 个是早已删除的 worktree 残留（`.wt/*`、`.claude/worktrees/*`），迁后照样不存在，不值得重映射；**`重做版_副本` 是另一个独立目录，绝对不碰** |
| `~/.codex/config.toml` | `[projects."…/重做版"] trust_level = "trusted"` | 改为新路径，否则 Codex 每次都要重新授信 |
| `.claude/launch.json` | 4 处绝对路径（上一轮刚修过） | 再改一次，去掉旧前缀换新前缀 |

### 1.3 不受影响的（已核实）

- `.cloud.env`：零本机绝对路径（只有远端 host/key 信息）
- 云端部署链路：`cloud-env.sh` 用 `dirname/..` 相对计算，`cloud-deploy.sh` 用 `git rev-parse` 动态取根
- 栈脚本与 DB：`/tmp/exchange_js_main/` 等路径由栈名派生，与仓库位置无关
- 仓库内部一切相对路径：整树同步移动，层数不变

### 1.4 前置条件（本设计成立的前提）

- 目标总文件夹 `/Users/songshengwei/Documents/Project/` 已存在且为空
- 指向本仓库的会话**除本会话外全部已停**（第6幕已于 2026-09-18 20:54 落档收工，产物 `c14cc1b7` 已入库）
- 工作树干净、无活 worktree（`git worktree list` 仅主树）

## 2. 本轮最大的技术难点：本会话自己站在要搬的地板上

执行迁移的这个会话，工作目录就是 `/Users/songshengwei/Documents/codex/projects/重做版`。`mv` 之后该路径不复存在，**后续每一条 Bash 命令的起始目录都会失效**。

**对策**：迁移动作放在最后；`mv` 之后所有命令一律显式 `cd` 到新绝对路径再执行，不依赖 shell 的继承工作目录。若 shell 因起始目录消失而完全无法启动，则由业主在新路径重开会话继续验收——记忆与历史届时已在新位置，续得上。

## 3. 执行顺序（顺序本身是设计的一部分）

1. **先改外部状态**（此时仓库还在原地，改完不生效但无害）：`~/.codex/config.toml`
2. **搬仓库**：`mv 旧路径 /Users/songshengwei/Documents/Project/fiatx.com`
3. **搬会话目录**：`mv ~/.claude/projects/<旧编码> ~/.claude/projects/-Users-songshengwei-Documents-Project-fiatx-com`
4. **改 `~/.claude.json`** 的 1 个真身键（此步须在 Claude Code 未写入该文件时做，故放在仓库已搬之后、验收之前）
5. **改 `.claude/launch.json`** 的 4 处绝对路径（在新位置改）
6. **验收**

**为什么 2、3 必须紧挨着**：两者之间存在一个窗口，若此时有任何会话启动，Claude Code 会在新路径下创建一个空的会话目录，与第 3 步的 `mv` 撞名。窗口越短越好，且执行期间不得开新会话。

## 4. 验收（三类闸门 + 两项迁移专属）

| # | 项目 | 判据 |
|---|---|---|
| 1 | git 完整性 | 新路径下 `git log` 与 `git status` 正常，HEAD 与迁前一致，工作树干净 |
| 2 | 会话目录 | 新编码目录存在、条目数 203、含 `memory/`；旧编码目录已不存在 |
| 3 | 随手闸 | `tsc ×3` 三绿 |
| 4 | 从零重建 | `stack.sh reset main` 成功 |
| 5 | 主线端到端 | `demo:all` 走通、花名册与断言全过 |
| 6 | 领域不变量 | `verify:coa` 恒等式 + 负余额全绿 |
| 7 | preview | `launch.json` 起管理台真渲染（唯一能逮住绝对路径写错的闸） |
| 8 | 云端部署 | `cloud:deploy` 真跑通 |
| 9 | Codex 读取 | 在新路径用 `codex exec` 确认仍自动加载 `AGENTS.md` 软链并识别 skill |

关于 #8：理论上云端链路与本机路径无关（§1.3 已核实），但这是本轮唯一本地闸门覆盖不到的一段，71 秒的代价换确定性，照上一轮口径真跑。

关于 #9：上一轮刚建立的双工具能力，路径变了要复验一次，成本是一条命令。

## 5. 安全网

- **动手前打 tag** `pre-migrate-2026-09-19`（内容回滚点）
- **位置回滚**：`mv` 是原子操作且可逆——两条 `mv` 反向执行即回到原状
- **会话目录不删只移**：若验收发现编码名推断有误，把目录移回旧名即可，数据零损失
- **`.claude.json` 改前备份**：`cp ~/.claude.json ~/.claude.json.bak-20260919`

## 6. 明确不做

- 不动仓库内部任何结构与内容（上一轮已完成）
- 不清理 `~/.claude.json` 里 10 个失效的 worktree 残留键（既有债，与本轮无关；清理它们要单独判断）
- 不碰 `重做版_副本`（另一个独立目录）
- 不搬其它项目（本轮只搬这一个，流程验证通过后其余照搬）

## 7. 已知风险与兜底

| 风险 | 兜底 |
|---|---|
| 本会话 Bash 工作目录失效 | §2 对策：迁后全用绝对路径；最坏情况业主在新路径重开会话 |
| 会话目录编码名推断有误 | 实测已确认规则（含点号）；且目录只移不删，可反向移回 |
| 迁移窗口内新会话抢建空目录 | 执行期间不开新会话；第 3 步前先检查目标名未被占用 |
| `~/.claude.json` 被并发写坏 | 改前备份；改动只涉 1 个键，用 python json 读写保证格式合法 |
| 云端链路意外依赖本机路径 | 验收 #8 真部署兜底 |
