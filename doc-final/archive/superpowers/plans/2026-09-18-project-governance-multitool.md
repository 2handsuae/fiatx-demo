# project-governance 多工具扩展 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按定稿设计 `specs/2026-09-18-project-governance-multitool-design.md` 扩展 `~/.claude/skills/project-governance/`，支持 Claude Code 与 Codex 串行接力同一个项目。

**Architecture:** 三处模板改动（charter 三节、checklist 拆两表、methodology 补一节）＋ SKILL.md 访谈与生成分路；随后双答卷演练（多工具／单工具各一次）验证分路正确；最后在本仓做 `AGENTS.md` 软链实证。

**Tech Stack:** 纯 Markdown；交付物仓 `~/.claude/skills/project-governance/`（自带 git，当前 HEAD `940c586`）。

## Global Constraints

- 全中文；只装骨架不装肉——模板正文不得出现 Exchange_js 特有内容（审计/权限/记账/演示等字样），肉只在 `references/methodology.md` 且带"样例非内容"标注
- 模板内 `<!-- -->` 注释是安装时说明（生成时删除）；"（空表起步）"类留白是设计内容——两者都不算占位符
- **通用表 7 行逐字如设计稿 §4.1**，一字不改；项目表保持空表起步
- 入口文件：`CLAUDE.md` 是真身，`AGENTS.md` 是指向它的**软链**（不是 @import、不是拷贝）
- **明确不装**：并发隔离机制、轮内（半途）交接面、"频繁提交即交接协议"——业主裁定串行接力、一轮做完才换工具
- SKILL.md 保持 <150 行（当前 100 行）
- 派发模型：Task 1–4 内容已写死，用 `haiku`；Task 5–6 演练与判读用 `sonnet`；评审 `sonnet`；终审留主会话
- 提交规约：skill 仓每任务一 commit；Exchange_js 仓只在 Task 7 收尾时 add 具名文件

---

### Task 1: charter 模板 §6——产物契约两层 ＋ 派发分层按工具分行

**Files:**
- Modify: `~/.claude/skills/project-governance/templates/claude-charter.md`（§6 流程尺寸，第 37–41 行）

**Interfaces:**
- Produces: §6 内出现字符串 `docs/superpowers/specs/`、`圈定本任务触发哪几行`、`按工具分行`——Task 5 演练验收按这些串查

- [ ] **Step 1: 替换 §6 第一条 bullet（加产物契约上层）**

把这一整行：

```
- 任务开场必须列「本任务做 / 不做」，"不做"项对照 §2；任务收尾对照 docs/rules/delivery-checklist.md——plan 引用它、圈定触发行并写死收尾核对表
```

替换为下面三行：

```
- 任务开场必须列「本任务做 / 不做」，"不做"项对照 §2
- **产物契约**（与用什么工具无关，任何工具照做）：每个任务要有一份 spec 落 docs/superpowers/specs/、一份 plan 落 docs/superpowers/plans/；**plan 必须引用 docs/rules/delivery-checklist.md 并圈定本任务触发哪几行**，收尾核对表由 plan 写死；多波战役的每波 spec 必须带「承接上一波」节
- **怎么产出**：装了 superpowers 的工具走 `brainstorming` → `writing-plans`。契约在上、工具在下——上面三条 superpowers 并不知道（它不知道本项目要求 plan 圈行、波 spec 带承接节），所以只能写在这里；工具换了、版本漂了，契约不动
```

- [ ] **Step 2: 替换 §6 第二条 bullet（去掉"由 superpowers 产出"的绑定）**

把这一整行：

```
- spec / plan 由 superpowers 产出，写入 docs/superpowers/{specs,plans}/；任务合并后由收尾会话移入 docs/archive/ 对应子目录（checkups 随其战役同生命周期归档）；archive 入了不读，翻旧账走 git 历史或业主明示
```

替换为：

```
- 归档：任务合并后由收尾会话把 spec / plan 移入 docs/archive/ 对应子目录（checkups 随其战役同生命周期归档）；archive 入了不读，翻旧账走 git 历史或业主明示
```

- [ ] **Step 3: 替换 §6 派发分层那条（改成按工具分行的表）**

把这一整行：

```
- 派发分层：<!-- 【种子】本项目任务类型→模型档位的映射表；钉版本的写法（含 harness 坑位）；降档的兜底条件（有没有终审接着）。原则在全局配置（判断密度高且一次性的不降档），本节只放本项目的映射。 -->
```

替换为：

```
- 派发分层（**多工具项目按工具分行**，各工具只看自己那行）：

| 工具 | 主会话 | 执行降档 | 评审 / 终审 |
|---|---|---|---|
| <!-- 【种子】工具名 --> | | | |

<!-- 【种子】本项目任务类型→模型档位的映射；钉版本的写法（含 harness 坑位）；降档的兜底条件（有没有终审接着）。原则在各工具的全局配置里（判断密度高且一次性的不降档），本表只放本项目的映射。单工具项目照样用这张表，只是一行。 -->
```

- [ ] **Step 4: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '产物契约\|怎么产出\|按工具分行' templates/claude-charter.md   # 期望 3
grep -c 'spec / plan 由 superpowers 产出' templates/claude-charter.md  # 期望 0（旧绑定已去）
grep -c 'brainstorming` → `writing-plans' templates/claude-charter.md  # 期望 1
grep -c '^## ' templates/claude-charter.md                              # 期望 11（节数不变）
```

- [ ] **Step 5: Commit**

```bash
git add templates/claude-charter.md && git commit -m "feat(charter): §6 产物契约两层——契约中立在上、superpowers 点名在下；派发分层改按工具分行"
```

---

### Task 2: charter 模板 §8 路由表 ＋ §10 串行路标

**Files:**
- Modify: `~/.claude/skills/project-governance/templates/claude-charter.md`（§8 第 57–67 行、§10 第 82 行）

**Interfaces:**
- Consumes: Task 1 已改完同一文件的 §6（本任务不碰 §6）
- Produces: §8 表内出现 `接手新一轮`；§8 注释内出现 `入口文件`；§10 出现 `串行接力`

- [ ] **Step 1: 路由表加「接手新一轮」行**

在这一行之后：

```
| 会话开始 | modules/overview.md |
```

插入一行：

```
| 接手新一轮（换工具 / 换会话） | modules/overview.md → decisions.md → CHANGELOG.md 最近几条 → BACKLOG.md 选题；有在途战役则读战役总纲＋承接记录 |
```

- [ ] **Step 2: 路由表下的种子注释补入口文件登记要求**

把这一整行：

```
<!-- 【种子】把访谈盘点出的现有文档收编进表，不许留表外文档。 -->
```

替换为：

```
<!-- 【种子】把访谈盘点出的现有文档收编进表，不许留表外文档。**入口文件自己也要登记**：单工具项目登记 CLAUDE.md；多工具项目登记 CLAUDE.md（真身）与 AGENTS.md（软链，Codex 读它）——不登记就违反下面这条封闭性。 -->
```

- [ ] **Step 3: §10 加串行路标**

把这一整行：

```
<!-- 【可空】端口 / 命令 / 环境坑集中在此，一处看全。 -->
```

替换为：

```
<!-- 【可空】端口 / 命令 / 环境坑集中在此，一处看全。 -->

本项目按**串行接力**使用：同一时间只有一个工具 / 一个会话在动，一轮做完才换手。要并行请先定隔离约定（分支 / worktree / 端口 / 数据各怎么分），没定之前不要并行——并行撞车是静默的，不报错、只是结果错。
```

- [ ] **Step 4: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '接手新一轮' templates/claude-charter.md        # 期望 1
grep -c '入口文件自己也要登记' templates/claude-charter.md  # 期望 1
grep -c '串行接力' templates/claude-charter.md           # 期望 1
grep -c '并发\|worktree' templates/claude-charter.md     # 期望 1（只有 §10 路标那句提到 worktree，无并发机制）
```

- [ ] **Step 5: Commit**

```bash
git add templates/claude-charter.md && git commit -m "feat(charter): §8 路由表加接手行+入口文件登记要求；§10 串行接力路标（并发只给路标不给机制）"
```

---

### Task 3: delivery-checklist 模板拆两表

**Files:**
- Modify: `~/.claude/skills/project-governance/templates/delivery-checklist.md`（整文件重写，逐字如下）

**Interfaces:**
- Produces: 文件内出现 `## 通用清单`、`## 本项目清单`、`出厂即封闭`、`无事故不进表`——Task 5/6 演练按这些串查

- [ ] **Step 1: 整文件覆盖为下面内容（逐字落盘）**

````markdown
<!-- project-governance 模板：触发式交付清单，生成为 docs/rules/delivery-checklist.md。两张表两套纪律：通用表出厂自带且封闭，本项目表空表起步、无事故不进表。 -->

# 交付清单（delivery-checklist）

> 形状：两张触发式对照表——左列"动了什么"、中列"连带必做"、右列"漏了会怎样"
> 谁写谁读：plan 阶段读它圈行；收尾 / 事故归因时经业主确认后往**本项目表**追加行
> 生长规则：通用表出厂即封闭、不许在项目里加行；本项目表一行 = 一次真实事故（日期＋现象＋代价）

## 怎么用

**按左列扫，不按右列读。** 两张表都要扫。一个任务通常只命中少数几行——没命中的不是"跳过了"，是根本没触发。

plan 的 Global Constraints 从此写两行，不要重抄本表（每个事实只有一个家）：

```
- 通用交付清单见 rules/delivery-checklist.md，全部适用
- 本轮特有：<只写这一轮独有的约束>
```

**判定"这是小任务、可以省"的不是执行者，是 plan。** 执行时"省一条"永远是省事的那个选项，而且越累越想省；plan 是在还有全局视野、还没被这个任务烦到的时候写的。任务开场列「做 / 不做」；对称地，任务收尾列「本任务过哪几条」，由 plan 写死。

## 通用清单（出厂自带）

这几行不是"连带遗漏"（动了 A 忘了 B，那种必须靠事故喂出来），而是**流程本身**，第一天就成立、不需要事故背书。触发条件不成立的行（没有界面、没有持久结构）永远扫不到，不必删。

| 触发 | 必须做 | 漏了会怎样 |
|---|---|---|
| 新增用户可见能力 | 必须有可达入口 | 点不到＝这个功能不存在 |
| 退役能力 | 同步删入口 | 幽灵按钮：点得到、点了没反应 |
| 改了平行结构中的一个 | 问其余的一不一样 | 平行模块漂移是最大的缺口来源 |
| 改了肉眼可见的东西 | 渲染出来用眼睛看 | 类型检查与单测对渲染结果一无所知 |
| 改了持久数据结构 | 确认从零能建起来 | 别人拉了代码跑不动 |
| 本任务是多波中的一波 | 承接记录写进下一波 spec 开头 | 下一波会把走过的路重新论证一遍 |
| 每轮收尾 | CHANGELOG 一行＋销账＋过收尾协议的回写三问 | 骨架不生长，放三个月还是空的 |

**纪律：出厂即封闭——项目里不许往这张表加行。** 不封住的话，"这条也挺通用的，加吧"就是个新口子，通用表照样膨胀成愿望清单。真发现了第八条通用行，回去改 project-governance skill 本身，让所有新项目一起受益。

## 本项目清单

| 触发 | 必须做 | 漏了会怎样（都发生过） |
|---|---|---|
| （空表起步——第一行等第一次事故） | | |

**纪律：无事故不进表。** 一行 = 一次真实事故，右列必须写清日期＋现象＋代价。右列是准入门槛的反向表述：没有事故背书的行不配进表。

## 永不豁免

<!-- 【可空】随事故沉淀：即使 plan 判定"小任务"也不许省的行。进这里的门槛比进两张表都高——要有"历史上真逮到过东西"的战绩。 -->
````

- [ ] **Step 2: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '^## ' templates/delivery-checklist.md              # 期望 5（怎么用/通用清单/本项目清单/永不豁免 + 标题外的 4 个二级标题，实际计数以 5 为准）
grep -c '出厂即封闭' templates/delivery-checklist.md         # 期望 1
grep -c '无事故不进表' templates/delivery-checklist.md       # 期望 1
grep -c '空表起步' templates/delivery-checklist.md           # 期望 1
grep -c '^| 新增用户可见能力\|^| 退役能力\|^| 改了平行结构中的一个\|^| 改了肉眼可见的东西\|^| 改了持久数据结构\|^| 本任务是多波中的一波\|^| 每轮收尾' templates/delivery-checklist.md  # 期望 7
```

若第一条 `^## ` 计数与 5 不符，以实际二级标题数为准记入报告，不要为凑数改文件结构。

- [ ] **Step 3: Commit**

```bash
git add templates/delivery-checklist.md && git commit -m "feat(checklist): 拆通用/本项目两张表——通用 7 行出厂封闭，项目表空表起步无事故不进表"
```

---

### Task 4: SKILL.md 访谈加一问 ＋ 生成分路 ＋ 边界补一条

**Files:**
- Modify: `~/.claude/skills/project-governance/SKILL.md`（访谈表、第 2 步、第 3 步、第 4 步自检、边界节）

**Interfaces:**
- Consumes: Task 1–3 的模板改动（本任务只改 SKILL.md）
- Produces: SKILL.md 内出现 `哪些工具干活`、`AGENTS.md`、`软链`——Task 5/6 演练据此分路

- [ ] **Step 1: 访谈表加一问**

在这一行之后：

```
| 现在已有哪些文档？ | 总纲 §8 路由表初版 |
```

插入一行：

```
| 这项目打算让哪些工具干活（只有 Claude Code？还要 Codex？） | 入口文件形态（见第 2 步）＋ 总纲 §6 派发分层表的行数 |
```

- [ ] **Step 2: 第 2 步改成分路**

把这一整段（"### 第 2 步：生成总纲" 下面那一段）：

```
按 `templates/claude-charter.md` 生成项目根的 CLAUDE.md（项目已有 CLAUDE.md 则把各节并入，不另立文件）。填入访谈种子；标【可空】的节保持空；生成时删除模板注释。
```

替换为：

```
按 `templates/claude-charter.md` 生成项目根的 `CLAUDE.md`（项目已有 CLAUDE.md 则把各节并入，不另立文件）。填入访谈种子；标【可空】的节保持空；生成时删除模板注释。

**入口文件按访谈第 10 问分路**：

- 只有 Claude Code 干活 → 到此为止，**不要生成 AGENTS.md**（单工具项目多一个文件是负担）
- 还有 Codex（或别的读 `AGENTS.md` 的工具）→ `CLAUDE.md` 保持真身，另建指向它的**软链**：

```bash
ln -s CLAUDE.md AGENTS.md
```

真身叫 `CLAUDE.md`、软链叫 `AGENTS.md`：两个工具各读各的名字、读到同一份字节，不依赖任何一方的导入语法。**两个名字都要登记进 §8 路由表**，否则违反总纲自己宣布的封闭性。
```

- [ ] **Step 3: 第 4 步自检加一条**

在这一行之后：

```
- [ ] 路由表含封闭性条款；三桶各带准入判据
```

插入一行：

```
- [ ] 入口文件与访谈答案一致：单工具只有 CLAUDE.md；多工具 CLAUDE.md 真身＋AGENTS.md 软链（`ls -l` 看得到箭头），且两个名字都在路由表里
```

- [ ] **Step 4: 边界节补一条**

在这一行之后：

```
- 不管单轮任务怎么跑——superpowers 的地盘
```

插入一行：

```
- 不装并发隔离机制（分支 / 端口 / 数据怎么分），也不装轮内半途交接——默认串行接力：一轮做完才换工具。真要并行时再按项目情况定，总纲 §10 只留一句路标。装了却用不上的闸门是纯成本
```

- [ ] **Step 5: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '哪些工具干活' SKILL.md      # 期望 1
grep -c 'ln -s CLAUDE.md AGENTS.md' SKILL.md   # 期望 1
grep -c '不要生成 AGENTS.md' SKILL.md           # 期望 1
grep -c '不装并发隔离机制' SKILL.md             # 期望 1
wc -l SKILL.md                                  # 期望 <150
```

- [ ] **Step 6: Commit**

```bash
git add SKILL.md && git commit -m "feat(SKILL): 访谈加'哪些工具干活'+入口文件分路(单工具不生成 AGENTS.md/多工具软链)+自检与边界各一条"
```

---

### Task 5: methodology 补一节——两类清单行的分界

**Files:**
- Modify: `~/.claude/skills/project-governance/references/methodology.md`（§5 触发式清单那节之后补内容，不新增 `## ` 节）

**Interfaces:**
- Consumes: Task 3 的两表结构
- Produces: methodology §5 内出现 `通用` 与 `回流` 二字

- [ ] **Step 1: 扩写 §5 正文**

把 §5（`## 5. 触发式清单`）下面这一整段：

```
传统清单失效不是条目错，是每条都要过一遍导致疲劳。触发式=按左列扫，一个任务只命中少数行；右列真实事故是每行的准入门槛与说服力来源；裁剪权归 plan，因为执行末期永远想省。
```

替换为：

```
传统清单失效不是条目错，是每条都要过一遍导致疲劳。触发式=按左列扫，一个任务只命中少数行；右列真实事故是每行的准入门槛与说服力来源；裁剪权归 plan，因为执行末期永远想省。

行分两类，纪律不同，所以分两张表：**通用行**（换任何项目都成立，如"新增能力必须有可达入口""改了肉眼可见的东西必须用眼睛看"）是流程本身，出厂自带、不需要事故背书，但**出厂即封闭**——项目里不许加，想加第八条就回流改 skill 本身，所有新项目一起受益；**项目行**（依赖本项目有什么体系，如审计、账本、权限目录）必须**无事故不进表**。不分开写，两套纪律早晚混成一套，然后表就膨胀成愿望清单。
```

- [ ] **Step 2: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '出厂即封闭' references/methodology.md   # 期望 1
grep -c '回流改 skill' references/methodology.md  # 期望 1
grep -c '^## ' references/methodology.md          # 期望 11（节数不变）
grep -c '样例非内容' references/methodology.md    # 期望 11（标注不变）
```

- [ ] **Step 3: Commit**

```bash
git add references/methodology.md && git commit -m "feat(methodology): §5 补两类清单行的分界与回流生长通道"
```

---

### Task 6: 双答卷演练（多工具 ＋ 单工具）

**Files:**
- Create: `~/.claude/skills/project-governance/dev/multitool-drill.md`

**Interfaces:**
- Consumes: Task 1–5 全部改动

- [ ] **Step 1: 派多工具答卷演练子代理**

Agent 工具，`subagent_type: general-purpose`、`model: sonnet`，prompt 全文：

```
请先完整阅读 ~/.claude/skills/project-governance/SKILL.md 及其引用的全部模板，然后严格按它执行。
任务：为项目 NoteApp 开荒安装治理框架，落在 /tmp/pg-drill-multi/（真实建文件）。
业主九问＋工具问的答案如下，视为业主原话逐题采用，除此之外不许自行补充内容：
1. 给谁/成功：开源社区用户用的笔记应用；重构成功=老功能全保留、代码量减半
2. 理直气壮不做：多用户协作、插件系统、性能优化
3. 假装可靠：本地文件系统总是可用；第三方同步服务（模拟）总是成功
4. 红线：（业主答不上，暂无）
5. 检查命令：npm test；npx tsc --noEmit
6. 怎么算验收：跑通 npm test 全绿＋按走查清单手动过一遍主流程截图
7. 分几大块：编辑器、存储、同步、搜索
8. 模型/额度：Claude Code 主会话 opus、执行降 sonnet、评审不降档；Codex 主会话 gpt-5.6-terra、执行不降档
9. 已有文档：只有 README.md
10. 哪些工具干活：Claude Code 和 Codex 都要，串行接力
完成后输出：建了哪些文件、入口文件是什么形态（贴 `ls -l` 结果）、两张 checklist 表各几行、路由表内容、SKILL.md 第 4 步自检逐条勾验结果。
```

- [ ] **Step 2: 派单工具答卷演练子代理（分路对照）**

同上，但目标目录 `/tmp/pg-drill-single/`，第 10 问答案改为：

```
10. 哪些工具干活：只有 Claude Code
```

其余九问答案完全相同。要求同样输出入口文件形态的 `ls -l` 结果。

- [ ] **Step 3: 主会话直查两份产物，写验收记录**

```bash
echo '--多工具：入口文件（期望 CLAUDE.md 真身 + AGENTS.md 软链带箭头）--'
ls -l /tmp/pg-drill-multi/CLAUDE.md /tmp/pg-drill-multi/AGENTS.md
echo '--多工具：软链内容是否等同真身--'
diff <(cat /tmp/pg-drill-multi/CLAUDE.md) <(cat /tmp/pg-drill-multi/AGENTS.md) && echo SAME
echo '--单工具：不应有 AGENTS.md--'
ls /tmp/pg-drill-single/AGENTS.md 2>&1 | head -1
echo '--两份的通用表行数（各期望 7）--'
grep -c '^| 新增用户可见能力\|^| 退役能力\|^| 改了平行结构中的一个\|^| 改了肉眼可见的东西\|^| 改了持久数据结构\|^| 本任务是多波中的一波\|^| 每轮收尾' /tmp/pg-drill-multi/docs/rules/delivery-checklist.md /tmp/pg-drill-single/docs/rules/delivery-checklist.md
echo '--两份的项目表是否空表起步--'
grep -c '空表起步' /tmp/pg-drill-multi/docs/rules/delivery-checklist.md /tmp/pg-drill-single/docs/rules/delivery-checklist.md
echo '--多工具：路由表是否登记两个入口文件 + 接手行--'
grep -c 'AGENTS.md\|CLAUDE.md' /tmp/pg-drill-multi/CLAUDE.md
grep -c '接手新一轮' /tmp/pg-drill-multi/CLAUDE.md
echo '--多工具：派发分层是否两行（Claude Code / Codex）--'
grep -c 'Codex' /tmp/pg-drill-multi/CLAUDE.md
echo '--两份都不应有并发隔离机制（期望只有 §10 那句路标）--'
grep -c 'worktree\|端口隔离' /tmp/pg-drill-multi/CLAUDE.md
echo '--模板注释残留（期望 0）--'
grep -rc 'project-governance 模板\|【种子】\|【可空】' /tmp/pg-drill-multi/ /tmp/pg-drill-single/ 2>/dev/null | grep -v ':0' | grep -v template.md || echo 无残留
```

逐项结果记入 `dev/multitool-drill.md`，格式：`| 检查项 | 期望 | 实际 | 判定 |`。

- [ ] **Step 4: 任一项不符则修 skill 后复跑**

修的是 **skill 文件**（哪里没教清修哪里），不是演练产物。修完 `rm -rf /tmp/pg-drill-multi /tmp/pg-drill-single` 重跑 Step 1–3，直到全过。每轮修复单独 commit，缺陷与修法记入 `dev/multitool-drill.md`。

- [ ] **Step 5: 清理并提交**

```bash
rm -rf /tmp/pg-drill-multi /tmp/pg-drill-single
cd ~/.claude/skills/project-governance && git add dev/multitool-drill.md && git commit -m "test: 双答卷演练通过——多工具软链分路/单工具无 AGENTS.md/通用表 7 行/项目表空"
```

---

### Task 7: 本仓实证（AGENTS.md 软链）＋ 收尾

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/AGENTS.md`（软链 → `CLAUDE.md`）
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/CLAUDE.md`（§8 路由表登记入口文件）
- Modify: `Exchange_js/doc-final/CHANGELOG.md`

**Interfaces:**
- Consumes: Task 1–6 全部；本任务是本设计唯一未验证假设的实证

- [ ] **Step 1: 建软链并登记路由表**

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
ln -s CLAUDE.md AGENTS.md
ls -l AGENTS.md    # 期望看到 AGENTS.md -> CLAUDE.md
```

然后在 `CLAUDE.md` §8 路由表的这一行之后：

```
| 会话开始 | `modules/overview.md` |
```

插入一行：

```
| 本文件在哪 | 仓库根 `CLAUDE.md`（真身）＝ `AGENTS.md`（软链，Codex 读它）——两个名字同一份内容 |
```

- [ ] **Step 2: 实证 Codex 读不读项目级 AGENTS.md**

这是**本设计唯一未经验证的假设**，必须真验。在仓库根起一个 Codex 会话，问它一个只有读到总纲才答得出的问题，例如：

```
本项目的 §2 禁做清单里，第一项是什么？
```

期望：答出「幂等」。答对＝Codex 读到了项目级 `AGENTS.md` 软链，假设成立。

若答不出或说没看到总纲，则假设**证伪**，回退方案：把真身改名为 `AGENTS.md`，`CLAUDE.md` 改为一行 `@AGENTS.md`（Claude 官方导入语法），并把 spec §2 与 skill 第 2 步一并改为该方案后重跑 Task 6 演练。

实证结果（问题原文＋Codex 回答＋判定）记入 `~/.claude/skills/project-governance/dev/multitool-drill.md` 末尾。

- [ ] **Step 3: 占位符与一致性扫描**

```bash
cd ~/.claude/skills/project-governance
grep -rn 'TBD\|待补\|FIXME\|XXX' --include='*.md' . | grep -v '^./dev/' | grep -v '.superpowers' || echo CLEAN
grep -rL '样例非内容' references/ || echo ALL_LABELED
wc -l SKILL.md   # 期望 <150
```

- [ ] **Step 4: 业主确认后收尾**

业主确认实证结果后执行（未确认前停在上一步）：

```bash
cd "/Users/songshengwei/Documents/codex/projects/重做版"
git mv Exchange_js/doc-final/superpowers/specs/2026-09-18-project-governance-multitool-design.md Exchange_js/doc-final/archive/superpowers/specs/
git mv Exchange_js/doc-final/superpowers/plans/2026-09-18-project-governance-multitool.md Exchange_js/doc-final/archive/superpowers/plans/
```

CHANGELOG.md 在最新条目之前追加一行（格式照文件既有行）：

```
- [2026-09-18] **project-governance skill 支持双工具接力（仓外交付，演示系统零变化）** —— 观众无感知变化，本仓只多一个 `AGENTS.md` 软链与总纲路由表一行。skill 侧：访谈加「哪些工具干活」一问并按答案分路生成入口文件（单工具只给 CLAUDE.md，多工具给 CLAUDE.md 真身＋AGENTS.md 软链）；总纲 §6 改写为「产物契约在上、superpowers 在下」两层，派发分层改按工具分行；交付清单拆成通用表（7 行出厂自带、封闭不许加）与本项目表（空表起步、无事故不进表）；路由表加「接手新一轮」行。明确不装并发隔离与轮内交接（业主裁定串行接力）。
```

```bash
git add CLAUDE.md AGENTS.md Exchange_js/doc-final/CHANGELOG.md Exchange_js/doc-final/archive/superpowers/specs/2026-09-18-project-governance-multitool-design.md Exchange_js/doc-final/archive/superpowers/plans/2026-09-18-project-governance-multitool.md
git commit -m "docs(收尾): 双工具接力支持交付——本仓加 AGENTS.md 软链+路由表登记，spec/plan 归档+CHANGELOG 一行"
```

并按本仓 CLAUDE.md §9 报告：`Documentation updated: none（本仓仅入口软链+路由表一行+specs/plans/CHANGELOG）— skill 交付于 ~/.claude/skills/`。

---

## 自检记录（writing-plans Self-Review）

- **Spec 覆盖**：设计稿 §2 入口文件→T4 Step 2＋T7 Step 1；§3 产物契约→T1；§4.1 通用 7 行→T3（逐字）；§4.2 项目表空表→T3；§4.3 理由→T5 methodology；§5 接手路由→T2 Step 1；§6 不做并发→T2 Step 3（路标）＋T4 Step 4（边界）；§7 改动清单→T1–T5 逐行对应；§8 本仓实证→T7 Step 1–2；§9 验收四条→T6 Step 3（前三条）＋T7 Step 2（第四条）。无遗漏。
- **占位符**：全计划无 TBD 类；模板内 `<!-- -->` 与"（空表起步）"已在 Global Constraints 声明为设计内留白。
- **一致性**：入口文件命名（`CLAUDE.md` 真身 / `AGENTS.md` 软链）在 T4、T6、T7 三处一致；通用表 7 行的触发词在 T3 定义、T6 验证命令逐字复用；`docs/` 根名占位在 charter 模板注释已声明。
- **已知风险**：T7 Step 2 的实证若证伪，回退方案已写死在该步内（改名＋@import＋重跑 T6），不需要回头改计划。
