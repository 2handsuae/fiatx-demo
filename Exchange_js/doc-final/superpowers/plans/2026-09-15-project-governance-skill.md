# project-governance Skill 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按定稿设计 `doc-final/superpowers/specs/2026-09-15-methodology-skill-design.md` 产出个人 skill `~/.claude/skills/project-governance/`——多轮项目治理框架的一次性安装器。

**Architecture:** skill 本体 = 薄 SKILL.md（入口判定＋种子访谈＋生成步骤＋自检）＋ 7 份 templates/（生成物的骨架）＋ references/methodology.md（构件为什么＋Exchange_js 肉样例）。测试走 writing-skills 的 RED→GREEN：先跑无 skill 基线，写完跑带 skill 开荒演练对照。

**Tech Stack:** 纯 Markdown 文档；`~/.claude/skills/project-governance/` 自身 `git init` 做版本控制（`~/.claude` 不是 git 仓，已核实）。

## Global Constraints

- 模板与生成物一律中文；skill 名 `project-governance`
- **只装骨架不装肉**：铁律条文/禁做条目/清单行不出现在模板正文；样例只进 references/ 且逐段标注"样例非内容（来自 Exchange_js）"
- description 规则（两规范冲突的裁定）：一句定性＋丰富触发条件，**不概括工作流程步骤**（writing-skills SDO：描述含流程会让 agent 抄描述不读正文；skill-creator：触发词要够"推销"防触发不足）
- SKILL.md 薄（<500 行，目标 <150 行）；大件沉 templates/ 与 references/；目录名按设计稿用 `templates/`（skill-creator 的 `assets/` 惯例让位于设计稿，语义更直白）
- 每份模板开头三行头（形状｜谁写谁读｜生长规则）自身也要齐——模板要示范它规定的东西
- 模板内 `<!-- -->` 注释是安装时说明（生成时删除），不算占位符；"（空）"/"（空表起步）"是有意留空，不算占位符
- 派发模型：各任务执行可 `sonnet`（内容已在本计划写死，判断密度低）；RED/GREEN 演练子代理用 `sonnet`（代表典型执行者）；终审与验收判读留主会话
- 本任务不动 Exchange_js 代码；Exchange_js 侧 delivery-checklist 只触发「每轮收尾」行（CHANGELOG 一行＋§9 报告＋spec/plan 归档）
- 提交规约：skill 仓每任务一 commit；Exchange_js 仓只在 Task 9 收尾时 add 具名文件

---

### Task 1: RED 基线——无 skill 的开荒行为取证

**Files:**
- Create: `~/.claude/skills/project-governance/dev/baseline-red.md`（dev/ 是开发取证目录，SKILL.md 永不引用它）

**Interfaces:**
- Produces: `dev/baseline-red.md`——基线缺失清单，Task 8 的 GREEN 对照面

- [ ] **Step 1: 建目录并派无 skill 基线子代理**

```bash
mkdir -p ~/.claude/skills/project-governance/dev
```

用 Agent 工具派 `subagent_type: general-purpose`、`model: sonnet`，prompt 全文如下（**不得提及任何 skill 或本计划**）：

```
你要帮业主给一个新项目建立文档与治理体系。项目情况：
- 名称 NoteApp，一个开源笔记应用的多轮重构项目，预计几十个开发会话接力完成，会话之间没有共享记忆
- 业主希望：文档不要越写越乱、以前讨论定过的事别被后来的会话翻案重新论证、每轮该做的检查别漏
请在 /tmp/pg-baseline-red/ 目录下建立你认为该有的全部文档框架（真实建文件），并在最后输出一份说明：你建了什么、为什么。
```

- [ ] **Step 2: 取证并写基线报告**

子代理完成后，主会话读 `/tmp/pg-baseline-red/` 全部产物，按下列检查点逐项记录"有/无"到 `dev/baseline-red.md`：

```markdown
# RED 基线取证（无 skill）
日期：<执行日> ｜ 场景：NoteApp 开荒 ｜ 模型：sonnet

| 检查点 | 基线有无 | 备注 |
|---|---|---|
| 路由表（什么时机读什么） | | |
| 封闭性规则（表外文档不该存在） | | |
| 债务出口分桶＋读写权限差异（尤其 append-only 禁读桶） | | |
| 只追加判例库＋不翻案规则 | | |
| 触发式清单（左列触发＋事故列＋裁剪权归 plan） | | |
| 每文件生长规则（三行头） | | |
| 回写时机（收尾/评审/拍板/事故） | | |
| 种子来自业主访谈（还是 agent 自己编内容？） | | |
| 归档协议 | | |
| 战役/多波协议 | | |
预期基线普遍缺失以上机制、且会替业主编造判断标准——逐条记实际表现，作为 Task 8 的对照面。
```

- [ ] **Step 3: 清理场景目录并提交**

```bash
rm -rf /tmp/pg-baseline-red
cd ~/.claude/skills/project-governance && git init && git add dev/baseline-red.md && git commit -m "test: RED 基线取证——无 skill 开荒行为"
```

---

### Task 2: SKILL.md

**Files:**
- Create: `~/.claude/skills/project-governance/SKILL.md`

**Interfaces:**
- Produces: SKILL.md 中引用的文件名——`templates/claude-charter.md`、`templates/delivery-checklist.md`、`templates/review-rubric.md`、`templates/decisions.md`、`templates/debt-buckets.md`、`templates/campaign-charter.md`、`templates/wave-spec-skeleton.md`、`references/methodology.md`。Task 3–7 的文件名必须与此逐字一致。

- [ ] **Step 1: 写 SKILL.md（全文如下，逐字落盘）**

````markdown
---
name: project-governance
description: 多轮项目治理框架安装器——为将被多个互相失忆的会话接力的项目一次性安装文档路由表、触发式交付清单、债务三桶、判例库与回写机制。当用户要为新项目立框架/装治理/建文档体系/项目开荒，要给已运行的项目补装治理、整顿散乱文档，或抱怨"每个新会话都在重新论证定过的事"时使用。单轮任务怎么跑（脑暴/spec/plan/执行/评审）不归本 skill，归 superpowers。
---

# project-governance：多轮项目治理框架安装器

## 概览

给"会被许多互相失忆的会话接力"的项目装上：治理总纲＋文档目录骨架＋每个文件的生长规则＋回写泵。本 skill 是**一次性安装器**——装完后日常运转由生成的项目文件自驱（收尾协议、清单用法都写在生成物里），本 skill 退场，不参与日常。

核心分界：**只装容器与生长规则（骨架），不装内容（肉）。** 判断标准、铁律、清单行这些内容，由项目此后用自己的拍板和事故长出来；第一天必须有的内容（种子）只能从业主访谈问出，agent 不得代拍——宁要业主两句糙的，不要 agent 一版像样的。

## 入口判定

- 项目文档还没成体系 → 走【开荒流程】
- 项目已运行、文档散落各处 → 走【补装流程】
- 判据是"是否多会话接力"，不是项目大小。单会话一次性任务不装，装了是负担。

## 开荒流程

### 第 1 步：种子访谈

逐题问业主，答一题填一处。答不上的：需种子件不许编造（追问或留待业主补），可空件空着——空着合法，生长规则会让它长。

| 问题 | 喂哪里 |
|---|---|
| 这项目给谁用/看？什么算成功？ | 总纲 §0 / §1 判断标准 |
| 什么类别的工作在这个项目里理直气壮不做？ | 总纲 §2 禁做清单 |
| 哪些外部依赖或场景假装可靠/不存在？ | 总纲 §3 允许的假设 |
| 有没有第一天就知道的红线？ | 总纲 §5 铁律（答不上就空着） |
| 现在有哪些检查/测试命令？ | 总纲 §7 随手闸 |
| 怎么算验收——给谁演示一遍，还是跑什么看什么？ | acceptance/ 形态 ＋ 总纲 §7 收尾闸 |
| 这个项目大概分几大块？ | modules/ 初拆 ＋ 总纲 §8 路由表 |
| 主会话用什么模型？额度上怎么打算？ | 总纲 §6 派发分层 |
| 现在已有哪些文档？ | 总纲 §8 路由表初版 |

### 第 2 步：生成总纲

按 `templates/claude-charter.md` 生成项目根的 CLAUDE.md（项目已有 CLAUDE.md 则把各节并入，不另立文件）。填入访谈种子；标【可空】的节保持空；生成时删除模板注释。

### 第 3 步：生成文档目录

在 `docs/`（根名可按项目改，以路由表登记为准）下按模板生成：

- `rules/delivery-checklist.md` ← `templates/delivery-checklist.md`
- `rules/review-rubric.md` ← `templates/review-rubric.md`
- `decisions.md` ← `templates/decisions.md`
- `BACKLOG.md`、`PARKED.md`、`TOOLING-DEBT.md` ← `templates/debt-buckets.md`（一拆三；桶名可按项目边界改，语义与读写权限不可改）
- `superpowers/specs/`、`superpowers/plans/`、`superpowers/checkups/`、`archive/` 空目录

轻量件直接建，三行头如下：

| 文件 | 形状 | 谁写谁读 | 生长规则 |
|---|---|---|---|
| `modules/overview.md` | 分块索引，一块一行 | 任何会话开始先读；改某块的会话维护该块篇 | 访谈初拆起步；新块随任务立篇并回写本索引 |
| `acceptance/README.md` | 验收口径：走查剧本或判据基线（形态按访谈） | 验收/走查会话读；改了行为的任务同步 | 与 modules/ 不一致 = 待办进 BACKLOG |
| `CHANGELOG.md` | 一合并一行 | 收尾会话追加；回顾"这版比上版多了什么"时读 | 回写泵时机① |

### 第 4 步：自检

- [ ] 需种子的节非空且出自业主原话；可空的节确实空着（没编造）
- [ ] 每个生成文件开头有三行头（形状｜谁写谁读｜生长规则）
- [ ] 路由表含封闭性条款；三桶各带准入判据
- [ ] 总纲含：回写泵四时机、归档协议、战役协议、派发分层、证据交接合同、闸门两档
- [ ] 告知业主：此后每轮收尾按总纲收尾协议走，本 skill 退场

## 补装流程

已运行项目补装，顺序与开荒不同：

1. 盘点现有文档（含散落的 TODO / 待办 / 笔记）
2. 建路由表，把还活着的文档收编进表
3. 宣布封闭性：表外文档当场删或入 `archive/`
4. 散落的"以后再说"按准入判据迁进三桶
5. 种子访谈补齐总纲缺节——已运行项目的种子多半已隐含在实践里，访谈变成"把你们已经在做的说出来"
6. 从下一轮任务起挂 plan 引用与回写泵（见生成总纲 §6 / §9）

## 边界（本 skill 不做）

- 不提供任何肉：铁律条文、禁做条目、清单行——`references/methodology.md` 里的样例只为看懂格式，一个字都不许抄进生成物
- 不管单轮任务怎么跑——superpowers 的地盘
- 不装个人层工作纪律（模型分层原则、证据纪律"怎么想"那半）——全局 CLAUDE.md 已有；进生成总纲的只有协议层（映射表槽位、证据交接合同）

## 深入

各构件为什么这么设计、在真实项目里长成什么样：`references/methodology.md`
````

- [ ] **Step 2: 验证**

```bash
cd ~/.claude/skills/project-governance
head -4 SKILL.md | grep -c 'name: project-governance'        # 期望 1
awk '/^description:/' SKILL.md | wc -c                        # 期望 <1024
grep -c '开荒流程\|补装流程\|种子访谈\|入口判定' SKILL.md      # 期望 ≥4
wc -l SKILL.md                                                # 期望 <150
```

- [ ] **Step 3: Commit**

```bash
git add SKILL.md && git commit -m "feat: SKILL.md——入口判定/九问访谈/生成步骤/自检/补装/边界"
```

---

### Task 3: templates/claude-charter.md（总纲模板）

**Files:**
- Create: `~/.claude/skills/project-governance/templates/claude-charter.md`

**Interfaces:**
- Consumes: SKILL.md 第 2 步引用本文件名
- Produces: 总纲十节结构；§4 出口表引用 `docs/BACKLOG.md`、`docs/PARKED.md`、`docs/TOOLING-DEBT.md`（与 Task 5 桶名一致）

- [ ] **Step 1: 写模板（全文如下，逐字落盘）**

````markdown
<!-- project-governance 模板：项目总纲，生成为项目根 CLAUDE.md。生成时删除所有 <!-- --> 注释；【种子】节由访谈填入、不许编造；【可空】节保持空。docs/ 为文档根名占位，按实际根名替换。 -->

# <项目名> — 项目总纲

## 0. 这是什么

<!-- 【种子】一句定位＋给谁＋目的。 -->

## 1. 判断标准（收到任何任务先过这两句）

<!-- 【种子】两句话过滤器，从"什么算成功"推出，写成判别式，如"最终用户看不到、讲不到的东西，不做"。 -->

## 2. 禁做清单（一律不做、不修、不测、不进 plan）

<!-- 【种子】点名列举、能 grep 的类别，两三条起步。"避免过度工程"这类空话不算数。 -->

## 3. 允许的假设

<!-- 【种子】理直气壮不防御的简化前提，逐条列。多数项目只写"要做什么"；"可以不做什么"才是稀缺品。 -->

## 4. 出口（债往哪放）

| 发现什么 | 放哪 | 规矩 |
|---|---|---|
| 业务/功能缺口 | docs/BACKLOG.md | 正常待办：要读要做，收尾销账 |
| 范围外的正当债 | docs/PARKED.md | **追加一行，然后放下**：不修、不讨论、不进 plan；只许追加，不许读它找活干 |
| 工具/环境/闸门问题 | docs/TOOLING-DEBT.md | 要读要清：写清怎么复现，修好划掉 |

<!-- 各桶准入判据在桶文件头。光禁止不给出口，冲动会溢进代码里——出口表是 §2 禁做清单能被执行的前提。 -->

## 5. 铁律（≤6 条，宗旨级）

<!-- 【可空】每条一句话＋为什么它对本项目是"看得见的东西"；落地写法外链 docs/rules/。上限 6 条写死：少而硬才执行得动，多了就都软了。 -->

## 6. 流程尺寸

- 任务开场必须列「本任务做 / 不做」，"不做"项对照 §2；任务收尾对照 docs/rules/delivery-checklist.md——plan 引用它、圈定触发行并写死收尾核对表
- spec / plan 由 superpowers 产出，写入 docs/superpowers/{specs,plans}/；任务合并后由收尾会话移入 docs/archive/ 对应子目录；archive 入了不读，翻旧账走 git 历史或业主明示
- 一个模块一波做不完 → 战役协议：先体检（扫描取数与判读分离）→ 立战役总纲（单独一份，活到最后一波才归档）→ 每波 spec 只写细当前波，下一波当场立骨架（空承接节）→ 每波收尾只写承接记录进下一波 spec 开头，**不代写下一波 spec**——干完一轮的会话是给下一轮做设计的最差人选；下一波的展开是下一波新会话跟业主脑暴的活
- 证据交接合同：扫描子代理只交「数字＋复现命令」、不交裸结论；否定性结论（零引用/没有/不存在）必附能复现它的搜索命令；主会话抽查复现后才采信
- 派发分层：<!-- 【种子】本项目任务类型→模型档位的映射表；钉版本的写法（含 harness 坑位）；降档的兜底条件（有没有终审接着）。原则在全局配置（判断密度高且一次性的不降档），本节只放本项目的映射。 -->

## 7. 闸门（分两档）

**随手闸——每次改完就跑**

<!-- 【种子】具体命令逐条列，来自访谈"现在有哪些检查命令"。 -->

**收尾闸——任务收尾 / 合并前，按条件叠加**

<!-- 【种子】来自访谈"怎么算验收"。 -->

判据一律**全绿**；测试的绿必须来自行为，禁止"扫源码文本"型断言。

## 8. 路由表（按任务读文档，根在 docs/）

| 时机 | 读什么 |
|---|---|
| 会话开始 | modules/overview.md |
| 改某块 | modules/<篇> |
| 动任何设计决定前 | decisions.md——已否决的方案不再提、不翻案 |
| 验收 / 走查 | acceptance/ |
| 说"以后做" | 按 §4 出口表落桶 |
| 每轮收尾 / 回顾版本差异 | CHANGELOG.md |

<!-- 【种子】把访谈盘点出的现有文档收编进表，不许留表外文档。 -->

**封闭性**：既不在本表、也没被本表里的文档链到的文档不该存在——发现了就删或归档，不另建地图。**modules/ 是现状唯一真相；acceptance/ 是验收口径；两者不一致就是待办，登记 BACKLOG。**

## 9. 收尾协议（回写泵）

每轮结束报一行：`Documentation updated: <动了哪层> — <一句话>`，并过四个回写时机：

1. **每轮收尾**：CHANGELOG 一行＋销账（本轮解决的 BACKLOG / TOOLING-DEBT 行划掉）＋三问——这轮踩的坑要不要变成 checklist 新行？要不要落 decisions 判例？有没有该进桶的发现？
2. **评审 / 走查收尾**：判据外发现落桶（各按准入判据）；modules/ 与 acceptance/ 对不上的登记 BACKLOG
3. **业主拍板时**（含否决与翻案）：当场落 decisions 一条（日期｜决策｜为什么）——判例库的主粮是拍板不是事故，裁掉的方案不落档，下个失忆会话就会重新论证一遍
4. **事故归因后**：挑对的层落一条——判断力问题落本文、连带遗漏落 checklist 行、方案取舍落 decisions——必须带日期＋现象＋代价

## 10. 运维事实

<!-- 【可空】端口 / 命令 / 环境坑集中在此，一处看全。 -->
````

- [ ] **Step 2: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '【种子】' templates/claude-charter.md    # 期望 ≥8
grep -c '封闭性\|回写泵\|归档\|派发分层\|证据交接\|随手闸\|收尾闸' templates/claude-charter.md  # 期望 ≥7
grep -c '^## ' templates/claude-charter.md        # 期望 11（§0–§10）
```

- [ ] **Step 3: Commit**

```bash
git add templates/claude-charter.md && git commit -m "feat: 总纲模板——十节骨架含出口表/战役协议/回写泵/派发槽位"
```

---

### Task 4: templates/delivery-checklist.md ＋ templates/review-rubric.md

**Files:**
- Create: `~/.claude/skills/project-governance/templates/delivery-checklist.md`
- Create: `~/.claude/skills/project-governance/templates/review-rubric.md`

- [ ] **Step 1: 写 delivery-checklist 模板（全文）**

````markdown
<!-- project-governance 模板：触发式交付清单，生成为 docs/rules/delivery-checklist.md。空表起步——没有事故背书的行不进表。 -->

# 交付清单（delivery-checklist）

> 形状：触发式对照表——左列"动了什么"、中列"连带必做"、右列"漏了出过什么事（都发生过）"
> 谁写谁读：收尾 / 事故归因时经业主确认后追加行；plan 阶段读它圈行
> 生长规则：一条行的出生 = 一次真实事故（日期＋现象＋代价）；右列是准入门槛的反向表述——没有事故背书的行不配进表，清单因此不会膨胀成愿望清单

## 怎么用

**按左列扫，不按右列读。** 一个任务通常只命中少数几行——没命中的不是"跳过了"，是根本没触发。

plan 的 Global Constraints 从此写两行，不要重抄本表（每个事实只有一个家）：

```
- 通用交付清单见 rules/delivery-checklist.md，全部适用
- 本轮特有：<只写这一轮独有的约束>
```

**判定"这是小任务、可以省"的不是执行者，是 plan。** 执行时"省一条"永远是省事的那个选项，而且越累越想省；plan 是在还有全局视野、还没被这个任务烦到的时候写的。任务开场列「做 / 不做」；对称地，任务收尾列「本任务过哪几条」，由 plan 写死。

## 清单

| 触发 | 必须做 | 漏了会怎样（都发生过） |
|---|---|---|
| （空表起步——第一行等第一次事故） | | |

## 永不豁免

<!-- 【可空】随事故沉淀：即使 plan 判定"小任务"也不许省的行。进这里的门槛比进清单更高——要有"历史上真逮到过东西"的战绩。 -->
````

- [ ] **Step 2: 写 review-rubric 模板（全文）**

````markdown
<!-- project-governance 模板：评审规约，生成为 docs/rules/review-rubric.md。判据件数封闭；默认三条锚定框架双层（真相层/验收层），措辞按项目调整，件数不许悄悄涨。 -->

# 评审规约（review-rubric）

> 形状：封闭评审面——只判定数几件事＋例子驱动的判定表＋界外出口
> 谁写谁读：评审会话读；判据改动须业主拍板并落 decisions
> 生长规则：一次误判事故 → 判定表加一行例子；新判据 = 业主拍板＋decisions 留痕

评审只判以下几件事。之外的**一律不算缺陷**——按总纲 §4 出口表落桶，评审报告里不出现。

## 判据

| # | 缺陷类型 | 判据 |
|---|---|---|
| 1 | 与真相层不符 | modules/<篇> 说应该这样，实现不是这样 |
| 2 | 验收走不通 | acceptance/ 的口径到不了、看不见、讲不圆 |
| 3 | 读不懂 | 命名不业务、一个流程被拆散在多处 |

## 判定表（例子驱动，随误判长）

| 例子 | 判定 | 理由 |
|---|---|---|
| （空表起步——第一行等第一次界线争议） | | |

## 评审纪律

- 不以"生产环境 / 理想情况会怎样"为由立缺陷
- 界外发现落桶前先过该桶的准入判据——错桶比没桶危险，它给问题一个合法的藏身处
- 测试的绿必须来自行为：发现"扫源码文本"型断言（写条注释就能喂饱的），按第 3 条立缺陷
- 评审报告 ≤ 50 行；每条缺陷写清"到哪一步、看到什么错"——缺陷必须锚定可观察后果
````

- [ ] **Step 3: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '裁剪权\|按左列扫\|不是执行者，是 plan' templates/delivery-checklist.md  # 期望 ≥2
grep -c '空表起步' templates/delivery-checklist.md templates/review-rubric.md    # 每文件 ≥1
grep -c '一律不算缺陷\|≤ 50 行' templates/review-rubric.md                        # 期望 2
```

- [ ] **Step 4: Commit**

```bash
git add templates/delivery-checklist.md templates/review-rubric.md && git commit -m "feat: 清单与评审规约模板——触发式空表/封闭判据面"
```

---

### Task 5: templates/decisions.md ＋ templates/debt-buckets.md

**Files:**
- Create: `~/.claude/skills/project-governance/templates/decisions.md`
- Create: `~/.claude/skills/project-governance/templates/debt-buckets.md`

- [ ] **Step 1: 写 decisions 模板（全文）**

````markdown
<!-- project-governance 模板：判例库，生成为 docs/decisions.md。 -->

# 决策判例库（decisions）

> 形状：只追加的列表，每条 = `[日期] 决策 ｜ 为什么`；**只追加，不改不删**
> 谁写谁读：业主拍板（含否决与翻案）时当场追加；agent 动任何设计前先读——**已否决的方案不再提、不翻案**；要推翻某条，只有业主能追加一条新的覆盖它
> 生长规则：回写泵时机③——脑暴 / 评审里裁掉的方案不落档，下个失忆会话就会把它重新论证一遍；本文件是对"跨会话失忆"的结构性补丁

- （空——第一条等第一次拍板）
````

- [ ] **Step 2: 写 debt-buckets 模板（全文；生成时按 `=== 文件名 ===` 一拆三）**

````markdown
<!-- project-governance 模板：三桶文件头，生成时按分隔符一拆三，落 docs/ 根。桶名可按项目边界改，语义与读写权限不可改。 -->

=== BACKLOG.md ===
# BACKLOG——业务 / 功能缺口

> 形状：待办列表，一条一行
> 谁写谁读：谁发现谁登记；plan 选题时读；收尾销账
> 生长规则：真相层与验收层对不上的、评审界内但本轮不修的，进这里
> 准入判据：这是不是"该做而没做"的正事？是 → 进；只是"技术上更完美" → 看 PARKED

- （空）

=== PARKED.md ===
# PARKED——放下桶

> 形状：一行一条，只增不删
> 谁写谁读：**只许追加，不许读它找活干**——它的功能是接住"我注意到但不该做"的冲动，同时杜绝从债务清单里自我加戏
> 生长规则：评审界外发现、执行中手痒想顺手修的，追加一行然后放下
> 准入判据：<!-- 【种子】按项目的范围边界定一句判定问句，样式："只有 X / Y / Z 场景才会触发的，进；正常路径正常数据就会触发的，不属于这里。" 桶名也按边界起——名字要能回答"这些东西什么时候才轮到"（范围边界是"上生产"的项目就叫 PRODUCTION-NOTES，是"v1 不做"的就叫 NOT-V1）。 -->

- （空）

=== TOOLING-DEBT.md ===
# TOOLING-DEBT——工具 / 环境 / 闸门债

> 形状：一条一行，写清怎么复现
> 谁写谁读：**要读要清**——定期翻，修好划掉；与 PARKED 的分界是它跟业务范围无关、拖着会让以后每一轮更晃
> 生长规则：工具、环境、检查闸门的坑进这里
> 准入判据：修好它会让"以后每一轮"更稳吗？是 → 进这里并附复现步骤

- （空）
````

- [ ] **Step 3: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '只追加，不改不删\|不翻案' templates/decisions.md              # 期望 ≥2
grep -c '^=== ' templates/debt-buckets.md                              # 期望 3
grep -c '准入判据' templates/debt-buckets.md                           # 期望 3
grep -c '不许读它找活干' templates/debt-buckets.md                     # 期望 ≥1
```

- [ ] **Step 4: Commit**

```bash
git add templates/decisions.md templates/debt-buckets.md && git commit -m "feat: 判例库与三桶模板——append-only 判例/三桶准入判据与读写权限"
```

---

### Task 6: templates/campaign-charter.md ＋ templates/wave-spec-skeleton.md

**Files:**
- Create: `~/.claude/skills/project-governance/templates/campaign-charter.md`
- Create: `~/.claude/skills/project-governance/templates/wave-spec-skeleton.md`

- [ ] **Step 1: 写战役总纲模板（全文）**

````markdown
<!-- project-governance 模板：战役总纲。一个模块一波做不完时立此件，落 docs/superpowers/specs/<日期>-<战役名>-campaign-charter.md；单独一份，活到最后一波收官才归档。 -->

# 战役总纲：<战役名>

> 形状：目标＋体检结论＋拆波表＋波间协议
> 谁写谁读：开战役的会话与业主脑暴后立；每波开场必读；末波收官才随波归档
> 生长规则：波边界变动须业主拍板，回写本文＋decisions 各一条

## 目标

<!-- 战役做完后项目多了什么、最终用户/观众看得见什么。用业务语言。 -->

## 体检结论（开战役前置）

<!-- 链接 docs/superpowers/checkups/ 报告。体检纪律：扫描取数与判读分离；扫描只交「数字＋复现命令」；否定性结论已复现方可写入本节。 -->

## 拆波

| 波 | 边界（做什么 / 不做什么） | 验收口径 | spec |
|---|---|---|---|
| 1 | | | superpowers/specs/<日期>-wave1-<名>.md |
| 2 | | | （立骨架，见 wave-spec-skeleton） |

## 波间协议

- 每波 spec 只写细当前波；下一波当场立骨架（含空承接节）
- 每波收尾只写承接记录进下一波 spec 开头；**不代写下一波 spec**——下一波的展开是下一波新会话读本文＋承接后跟业主脑暴的活
````

- [ ] **Step 2: 写波 spec 骨架模板（全文）**

````markdown
<!-- project-governance 模板：波 spec 骨架。上一波收尾时立，下一波新会话跟业主脑暴后才展开成正式 spec。 -->

# 波 <N> spec（骨架）：<波名>

> 战役总纲：<链接>
> 本文状态：骨架——只收承接与事实，不含设计；设计由本波会话脑暴后展开

## 承接上一波

<!-- 上一波收尾会话写：实际偏差 / 执行中发现的新事实 / 本波前提有无变化。只写承接，不展开设计。 -->

（空）

## 已定事实

<!-- 战役总纲与已归档各波中，对本波仍然成立的结论，逐条列，附出处。 -->

## 待定岔口

<!-- 本波脑暴要跟业主裁的问题，逐条列。 -->
````

- [ ] **Step 3: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '活到最后一波\|不代写下一波' templates/campaign-charter.md   # 期望 ≥2
grep -c '承接上一波\|已定事实\|待定岔口' templates/wave-spec-skeleton.md  # 期望 3
```

- [ ] **Step 4: Commit**

```bash
git add templates/campaign-charter.md templates/wave-spec-skeleton.md && git commit -m "feat: 战役总纲与波骨架模板——体检前置/承接协议/不代写下一波"
```

---

### Task 7: references/methodology.md

**Files:**
- Create: `~/.claude/skills/project-governance/references/methodology.md`
- 样例源（只读）：`<repo>/Exchange_js/CLAUDE.md`、`<repo>/Exchange_js/doc-final/rules/delivery-checklist.md`、`<repo>/Exchange_js/doc-final/rules/review-rubric.md`、`<repo>/Exchange_js/doc-final/decisions.md`、`<repo>/Exchange_js/doc-final/superpowers/specs/2026-09-09-acts345-trading-campaign-charter.md`、`<repo>/Exchange_js/doc-final/superpowers/specs/2026-09-13-wave5-order-visibility-skeleton.md`（`<repo>` = `/Users/songshengwei/Documents/codex/projects/重做版`）

- [ ] **Step 1: 写文件——固定骨架如下，`> 样例：`块从样例源逐字摘录**

结构（11 节，每节 = 为什么 2–4 句 ＋ 一段样例摘录）。开头总注与每节"为什么"文字如下，逐字使用；样例摘录按各节指定位置取原文，每段摘录前加一行 `**样例非内容（来自 Exchange_js，一个虚拟币 broker-dealer 演示系统）**`：

````markdown
# 方法论：各构件为什么这么设计

本文供安装者理解格式，**任何样例文字都不得抄进生成物**。这套方法论最独特的不是任何一条具体规则，而是规则的生成机制：出事 → 归因 → 挑对的层落一条规则，并带上日期＋现象＋代价。可搬走的是骨架（容器与生长规则），搬不走的是肉（条文内容）——肉是那个项目用几十次事故喂出来的。

## 1. 路由表＋封闭性
文档腐化不是靠勤快清理防住的，是靠"存在即需被引用"这条不变量防住的：路由表规定什么时机读什么，封闭性规定表外文档不该存在——文档集因此是个闭包。
（样例：CLAUDE.md §8 路由表头 6 行＋"既不在本表…"句）

## 2. 三桶债务出口
干活时总会冒出"我注意到但不该做"的念头，三个桶按读写权限分流：要做的（读＋做）、放下的（只写不读）、要还的（读＋清）。"append-only 且禁读"看似反直觉，实际让 agent 有地方安放冲动、又杜绝从债务清单里自我加戏。桶必须先于第一次手痒存在，否则冲动溢进代码。
（样例：CLAUDE.md §4 出口表全表）

## 3. 只追加判例库
LLM 跨会话失忆，已裁定的问题会被每个新会话重新论证。判例库只追加、不翻案、推翻须业主新条覆盖——它的主粮是拍板不是事故。
（样例：decisions.md 的 [2026-07-14] TR 否决条与 [2026-08-13] COA 永久否决条，各一行）

## 4. 真相层 / 验收层分离
modules/ 记现状唯一真相，acceptance/ 记验收口径（演得出来才算过）；两者不一致自动生成待办。一份文档同时当真相和验收，两头都会烂。
（样例：CLAUDE.md §8 尾部"两层关系"句）

## 5. 触发式清单
传统清单失效不是条目错，是每条都要过一遍导致疲劳。触发式=按左列扫，一个任务只命中少数行；右列真实事故是每行的准入门槛与说服力来源；裁剪权归 plan，因为执行末期永远想省。
（样例：delivery-checklist.md「任何持久状态变化」行＋「两条永不豁免」节首两行）

## 6. 封闭评审面
评审通胀的解法是把评审面定死：只判 N 件事，界外一律落桶；缺陷必须锚定可观察后果；例子驱动的判定表随误判长。
（样例：review-rubric.md 三判据表＋判定表任意两行）

## 7. 闸门两档
随手闸廉价、每次改完就跑；收尾闸重、按触发条件叠加。判据全绿；绿必须来自行为——"扫源码文本"型断言写条注释就能喂饱。
（样例：CLAUDE.md §7 随手闸三行命令）

## 8. 回写泵
空框架放三个月还是空的。四个回写时机（收尾/评审走查/拍板/事故）是"做 10 轮就长出来了"的机制保证——没有泵，骨架就是一堆空目录。
（样例：delivery-checklist.md「每轮收尾」行）

## 9. 战役协议
干完一轮的会话是给下一轮做设计的最差人选：满上下文里写出来的是没人讨论过的设计。所以收尾只写承接、总纲活到末波、下一波由新会话与业主脑暴展开。
（样例：acts345 战役总纲的拆波表头 3 行；wave5 骨架的「承接上一波」节头）

## 10. 派发分层与证据交接合同
怎么想的纪律在全局，怎么交接的合同在项目：全局管原则（判断密度高不降档），项目总纲管映射表（会腐化，只能住项目层）；派发一旦发生，证据纪律就得变成对交付物的格式要求——数字＋复现命令，不收裸结论。
（样例：CLAUDE.md §6 派发分层段前 3 行）

## 11. 骨架与肉的分界（总结）
凡"内容本身有用"的搬不走，凡"容器＋生长规则有用"的搬得走。判定口诀：换个项目，这条能不能原样照抄？
````

- [ ] **Step 2: 验证**

```bash
cd ~/.claude/skills/project-governance
grep -c '样例非内容' references/methodology.md   # 期望 ≥10（每节样例一处）
grep -c '^## ' references/methodology.md          # 期望 11
```

- [ ] **Step 3: Commit**

```bash
git add references/methodology.md && git commit -m "feat: 方法论参考——11 构件的为什么与标注样例"
```

---

### Task 8: GREEN 开荒演练＋修复循环

**Files:**
- Create: `~/.claude/skills/project-governance/dev/green-drill.md`

**Interfaces:**
- Consumes: `dev/baseline-red.md`（Task 1）、skill 全部文件（Task 2–7）

- [ ] **Step 1: 派带 skill 的开荒演练子代理**

Agent 工具，`subagent_type: general-purpose`、`model: sonnet`，prompt 全文：

```
请先完整阅读 ~/.claude/skills/project-governance/SKILL.md 及其引用的模板，然后严格按它执行以下任务。
任务：为项目 NoteApp 开荒安装治理框架，落在 /tmp/pg-green-drill/ 目录（真实建文件）。
你无法真的访谈业主，业主的九问答案如下，视为业主原话逐题采用（除此之外不许自行补充内容）：
1. 给谁/成功：开源社区用户用的笔记应用；重构成功=老功能全保留、代码量减半
2. 理直气壮不做：多用户协作、插件系统、性能优化
3. 假装可靠：本地文件系统总是可用；第三方同步服务（模拟）总是成功
4. 红线：（业主答不上，暂无）
5. 检查命令：npm test；npx tsc --noEmit
6. 怎么算验收：跑通 npm test 全绿＋按走查清单手动过一遍主流程截图
7. 分几大块：编辑器、存储、同步、搜索
8. 模型/额度：主会话 opus；执行降 sonnet；评审不降档
9. 已有文档：只有 README.md
完成后输出：你建了哪些文件、每个文件的三行头、哪些节留空及为什么。
```

- [ ] **Step 2: 主会话逐项验收演练产物**

读 `/tmp/pg-green-drill/` 全部产物，对照两张表逐项记入 `dev/green-drill.md`：
① Task 1 基线表的 10 个检查点（期望全部翻正）；
② SKILL.md 第 4 步自检 5 条（期望全过）。
另加三条抽查：铁律节确实空着（答案 4 是答不上）；禁做清单只有业主给的三条（没编造）；PARKED 准入判据含种子标注的处理结果。

- [ ] **Step 3: REFACTOR——发现缺陷修 skill 后复跑**

任一检查点不过 → 修的是 **skill 文件**（SKILL.md 或模板，哪里没教清修哪里），不是演练产物；修完删 `/tmp/pg-green-drill/` 重跑 Step 1–2，直到全过。每轮修复单独 commit，缺陷与修法记入 `dev/green-drill.md`。

- [ ] **Step 4: 清理并提交**

```bash
rm -rf /tmp/pg-green-drill
cd ~/.claude/skills/project-governance && git add dev/green-drill.md && git commit -m "test: GREEN 开荒演练通过——基线 10 检查点翻正记录"
```

---

### Task 9: 反向检验＋占位符扫描＋验收报告＋Exchange_js 收尾

**Files:**
- Create: `<repo>/Exchange_js/doc-final/superpowers/checkups/2026-09-15-project-governance-skill-acceptance.md`
- Modify: `<repo>/Exchange_js/doc-final/CHANGELOG.md`（追加一行）

- [ ] **Step 1: 占位符扫描**

```bash
grep -rn 'TBD\|TODO\|待补\|FIXME\|XXX' ~/.claude/skills/project-governance/ --include='*.md' | grep -v dev/
# 期望：空输出（注意"（空）""空表起步"与 <!-- --> 安装注释为设计内留白，不在扫描词表内）
grep -rL '样例非内容' ~/.claude/skills/project-governance/references/
# 期望：空输出（methodology.md 必含标注）
```

- [ ] **Step 2: 反向检验（主会话做，不降档）**

对照 `Exchange_js/doc-final/` 现状逐件问"骨架里的槽位在哪"，做成映射表：doc-final 构件（CLAUDE.md 十节、rules 两件、decisions、三桶、modules、demo、superpowers 三目录、archive、CHANGELOG、ui-contract、lark、reference）→ 骨架槽位或 §11 排除理由。**任何一件既无槽位又无排除理由 = 不合格**，回 Task 2–7 补槽位或回 spec 补 §11，修完重扫。（预期：ui-contract 归 modules 层的项目自扩展、lark 归"单向出口目录"提法——若骨架未提，须在 methodology.md §1 补一句"路由表允许登记 agent 不读的单向出口目录"。）

- [ ] **Step 3: 写验收报告**

`2026-09-15-project-governance-skill-acceptance.md` 内容：RED 基线摘要（缺什么）→ GREEN 演练结果（10 检查点翻正表＋REFACTOR 轮数与修法）→ 占位符扫描输出 → 反向检验映射表全文 → 结论一行。

- [ ] **Step 4: 业主验收后收尾**

业主确认后执行（未确认前停在上一步）：

```bash
cd <repo>
git mv Exchange_js/doc-final/superpowers/specs/2026-09-15-methodology-skill-design.md Exchange_js/doc-final/archive/specs/
git mv Exchange_js/doc-final/superpowers/plans/2026-09-15-project-governance-skill.md Exchange_js/doc-final/archive/plans/
# CHANGELOG.md 追加：| 2026-09-15 | project-governance skill 安装器交付（个人 skill，方法论提炼自本仓） |（格式照文件既有行）
git add Exchange_js/doc-final/CHANGELOG.md Exchange_js/doc-final/archive/specs/2026-09-15-methodology-skill-design.md Exchange_js/doc-final/archive/plans/2026-09-15-project-governance-skill.md
git commit -m "docs(收尾): project-governance skill 交付——spec/plan 归档+CHANGELOG 一行"
```

并按 Exchange_js CLAUDE.md §9 报告：`Documentation updated: none（本仓仅 specs/plans/checkups/CHANGELOG）— skill 交付于 ~/.claude/skills/`。

---

## 自检记录（writing-plans Self-Review）

- Spec 覆盖：设计稿 §1→T2 概览/入口；§2→T2–T7 文件名逐字对齐；§3→T3；§4 含四硬规矩→T3（归档/封闭性入总纲）＋T4/T5（三行头、行模板、准入判据）；§5→T2 九问表；§6 四时机→T3 §9；§7→T3 §6＋T6；§8→T3 §6；§9→T3 §6；§10→T2 补装节；§11→T2 边界节；§12 三验收→T1/T8/T9。设计稿未细列的轻量件三行头（modules/overview、acceptance、CHANGELOG）由 T2 第 3 步小表补上——只补内容不改结构。
- 占位符：全计划无 TBD 类；模板内"（空）"与安装注释为设计内留白，已在 Global Constraints 声明。
- 一致性：templates/ 文件名在 T2 Interfaces 定义、T3–T7 逐字复用；桶名 BACKLOG/PARKED/TOOLING-DEBT 在 T3 出口表与 T5 模板一致；`docs/` 根名占位在 charter 注释声明。
