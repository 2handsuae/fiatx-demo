# 第五批设计稿 · admin 三域交易页面「模块级」前端统一

日期：2026-08-23 ｜ 业主逐条拍板 ｜ 承接第四批（merge `6236d9b9`）

---

## 0. 业主定的规则

> 「我并不是要一对一一致，我要的是**基于流程把信息组成尽量通用的模块，然后同一模块就用同一个组件**。像 transaction detail 到了兑换拆成了三个，没问题的。但是既然都是 L1 和 L2 两个 gate，那么这两个就要一样。侧边栏是操作和次要信息载体，那么结构应该一样。」

拆开就是三条判据：

1. **同一职责的模块 → 同一个组件。** 内容可多可少，承载物必须是同一个。
2. **内容差异允许。** 兑换的交易信息拆成三张卡是对的，因为它有买卖两侧资产和汇率。
3. **侧栏是「操作 + 次要信息」的载体，结构必须一样。** 某域没有操作，就是操作段为空，不是换个顺序。

本稿的一切判定都从这三条推出，不引入第四条标准。

---

## 0.1 范围（业主明确划的线）

**本轮严格只做前端页面统一。**

| 明确不做 | 理由 |
|---|---|
| 兑换建单锁额 / 记账 | 业主：暂时不要 |
| Sumsub 模拟的**后端**（fixture / webhook / 按钮增删） | 业主：暂时不动 |
| 客户端 `client-web` | 本轮是 admin 专项（闸门仍要跑，防误伤） |
| Owner 搜索那个坏功能 | 修它要改后端三个 QueryDto + service，不属「严格前端」。**已实证是坏的，登记 BACKLOG** |
| 关联资金单模块统一 | 业主裁定「乙」，见 §4 |
| 审计日志 / 权限安全 | 业主此前已定，各自单独一轮 |

**边界判据**：一处改动只要碰到 `src/`（后端），就不属于本轮。

---

## 1. 现状：三个模拟入口不是问题（业主裁定）

审查时曾把「Sumsub 模拟散在三处」当作不一致。**业主否决了这个判断**：

> 「sumsub 模拟三入口没问题。因为第一个模拟交易，第二个是模拟材料，最后一个是我的系统计时。不同的逻辑。」

| 入口 | 位置 | 模拟什么 | 三域现状 |
|---|---|---|---|
| `⚡ Simulation` | 主列末尾 | Sumsub **交易裁决** webhook | 三域都有 |
| `MaterialRequestPanel` | 主列 `Verification Requests` 内 | Sumsub **材料复核** 结果 | 三域都有（共享组件） |
| `Simulate SLA Timeout` | 侧栏 `SLA` 组内 | **我方系统**的计时器 | 三域都有 |

三件不同的事，位置不同是合理的。**本轮不动这三处的位置与数量。**

⚠️ 唯一相关的一条：`⚡ Simulation` 的**渲染条件**三域不一致（充值/提现常显，兑换仅 `COMPLIANCE_PENDING`）。这属于「同一模块的显示逻辑」，见 §9。

---

## 2. 违规清单：同一模块 ≠ 同一组件（共 5 条）

审计方法：列出六个页面本地定义的组件与各自 import 的共享件，找出「同一职责却不是同一个东西」。

| # | 模块 | 现状 | 处置 |
|---|---|---|---|
| 1 | **L1 / L2 闸门格子** | 三域各写内联 JSX，L2 有三种排版 | **抽 `GateTile`**，一页用两次，共六次 |
| 2 | **`SumsubDetailSection`** | 三份本地副本；**渲染体逐字节相同，唯一实质差异是 props 的类型名** | 合成一个共享件（几乎零风险） |
| 3 | **`StatusTimeline`** | 三份本地副本，44 / 44 / 56 行，**哈希全不同** | 合成一个共享件 |
| 4 | **关联资金单** | 充值/提现用共享 `LinkedRelationCard`；兑换自己写 `LegAttemptRow` | **本轮不动**（业主裁定乙，见 §4） |
| 5 | **`AdminBadge`** | 充值 detail 2 处 / list 3 处；兑换 4 / 2；**提现 0 / 0** | 只补 **list 的 Review 列**；detail **不补**，见 §2.1 |

### 2.1 提现 detail 的 `AdminBadge` 为 0 是对的，不要硬加

逐处核实后，充值/兑换用 `AdminBadge` 的位置，提现要么**没有那个信息**、要么**已用同一职责的共享组件**：

| 充值/兑换用 AdminBadge 的位置 | 提现的情况 |
|---|---|
| 充值 list 的 `limitHoldReason` 徽章 | `limitHoldReason` 是**充值独有字段**（Prisma 里只有 `DepositTransaction` 有），提现没有「金额下限挂起」这个概念 |
| 兑换 detail 的 `Hard Line → SANCTION_HELD` | 判据 `customer.hardLineDispositionedAt` **只有兑换域会写**，提现语境下恒为 `Not set`，硬加是造假格子 |
| 兑换 detail 关联腿的状态徽章 | 提现**已有等价展示** —— 走 `LinkedRelationCard`，那个共享组件内部就渲染 `AdminBadge` |

→ **提现 detail 直接 grep 到 0 处并不等于缺失。** 本轮只补 list 的 Review 列（见 §10）。

**已经是同一个组件、不用动的**：`DetailCard`、`InfoField`、`JsonBlock`、`ActionSection`（均来自 `components/compliance/DetailPageComponents.tsx`）、`SidebarGroup`、`SidebarKV`（`components/ui/SidebarPrimitives.tsx`）、`MaterialRequestPanel`、`L1GateCard`、`Pagination`、`PageTitleBar`、`adminButtonStyles`。

第 2、3 条是本轮最值钱的：两个模块各被抄三份**且已各自漂移**。合并后改一处三页一起变，不会再漂。

---

## 3. `GateTile` —— L1 / L2 收敛（业主点名必须一样）

### 3.1 现状

**L1 格子**三域结构一致（小标题 → 大字 → 小字），只有副行措辞不同。

**L2 格子三域三个样，而且两域的 L2 比自己的 L1 还轻一档：**

| | 排版 | 字号 |
|---|---|---|
| 充值 | `Finance:` ＋ verdict ＋ `Score: N`，一行三段横排 | `text-[11px] font-semibold` —— 比 L1 的 `text-sm font-bold` 轻 |
| 提现 | `finance: approved · Score 40` 挤成一行，且 `finance` 是**原始字面量**没转人话 | 同样轻一档 |
| 兑换 | `KYT: approved` 大字 ＋ 小字 `Score 62` | 与 L1 同级 |

**容器也不一致**：充值/提现是 `<DetailCard title="Compliance">`，兑换是手写 `<div className="px-6 py-5">` + `<h3>`。

底下那张 L1 九格明细（`L1GateCard`）三域已经是同一个组件、同一个位置 —— **说明这事本来就该这么做，只是上面两个格子没做。**

### 3.2 目标

抽一个组件，只认四样东西：

| 入参 | 含义 |
|---|---|
| `title` | `L1 · Eligibility` / `L2 · Transaction Screen` |
| `value` | 主值，**大字**（与 L1 同级） |
| `caption` | 副行，小字 |
| `style` | 颜色，来自 `getComplianceLayerStyle`（已是三域共用函数） |

L1 与 L2 用同一个组件 → 视觉自动等重；三域用同一个组件 → 自动一致。**域差异全部退到「传什么内容」。**

### 3.3 各域传什么（业主逐条拍板）

| | L1 副行 | L2 主值 | L2 副行 |
|---|---|---|---|
| 充值 | `Post-arrival check` | `Finance:` / `Travel Rule:` ＋ verdict（按 `sumsubTxnType` 判） | `Score N` |
| 提现 | `Pre-creation check` | **与充值同款**（会有 Travel Rule，要转人话，不能再裸显 `finance`） | `Score N` |
| 兑换 | **`Pre-creation check`**（原 `Pre-execution gate`） | **锁死 `Finance:`** ＋ verdict（原 `KYT:`） | `Score N` |

业主原话：
> 「L1 副行，兑换变成提现字样。L2 主值，提现应该与充值一致，会有 travel rule 的。兑换锁死是 Finance。」

兑换锁死 `Finance` 的依据：兑换无第三方对手方，不存在 Travel Rule 送检（`swap-sumsub` 域已成文）。

### 3.4 顺带

兑换的 `Compliance` 手写 `<div>` 换成 `<DetailCard>`，容器随之一致。

---

## 4. 关联资金单 —— 本轮不动（业主裁定乙）

兑换的 `LegAttemptRow` 比 `LinkedRelationCard` 多一维：**每条腿的重试次数**（读 `row.attempt`）。

第四批给三个域都做了「资金腿失败重试 3 次」，但**只有兑换的前端把重试历史显示出来**（充值/提现详情页里 `attempt` 一词出现 0 次）。

两条路：
- **甲**：扩展 `LinkedRelationCard` 支持 attempt，三域都用，充值/提现顺带也能看到重试历史
- **乙**：本轮不动，兑换保留自己那份

**业主选乙。** 理由：甲需要先确认后端给充值/提现的详情响应里带不带 `attempt` 字段；若不带就要改后端，与「严格只做前端」冲突。

→ **登记 BACKLOG**：「充值/提现详情页看不到资金腿重试次数（后端有、前端没显示）；统一关联资金单模块前需先确认详情响应是否带 `attempt`」。

---

## 5. 侧栏定稿

### 5.1 结构（两段，三域恒定）

```
【操作段】 处置组 —— 按订单状态条件出现
【信息段】 SLA → Identity → Lifecycle —— 三域恒定，顺序固定
```

| | 操作段 | 信息段 |
|---|---|---|
| 充值 | `Ops Disposition` + `Frozen Disposition` | SLA → Identity → Lifecycle |
| 提现 | `Payout Disposition` + `Frozen Disposition` | SLA → Identity → Lifecycle |
| 兑换 | **整段为空** | SLA → Identity → Lifecycle |

兑换操作段为空**不算不一致** —— 业主：「兑换没有任何 disposition 按钮，因为兑换不需要运营去推进状态。」同一个骨架，该域零个模块。

兑换现在的顺序是 `SLA → Identity → Frozen → Ops → Lifecycle`，要翻正成信息段三件套。

### 5.2 现有 disposition 按钮全清单（本轮不增不减，只调结构）

| 域 | 组 | 出现条件 | 按钮 |
|---|---|---|---|
| 充值 | `Ops Disposition` | `isHoldPending` | ① `PASS (Waive Min-Limit)` —— 挂起原因是金额太小时<br>　同一按钮在行政级挂起时文案变 `Release Hold (does not resume compliance)`<br>② `Confiscate as Fee` —— 仅 `isBelowMinPending`<br>③ `Initiate Return to Sender` —— 组内恒显（走 MLRO 审批） |
| 充值 | `Frozen Disposition` | `status === 'FROZEN'` | ① `Initiate Seize`　② `Initiate Unfreeze` |
| 提现 | `Payout Disposition` | `status === 'PAYOUT_PENDING'` | ① `Bounce Payout` |
| 提现 | `Frozen Disposition` | `status === 'FROZEN'` | ① `Initiate Unfreeze`　② `Reject & Freeze Customer` |
| 兑换 | — | — | **无** |

合计：充值 5、提现 3、兑换 0。**本轮一个按钮都不增删**，只调所在结构。

### 5.3 兑换要删的两块

**① `Ops Disposition`（恒显、无按钮）—— 整块删。**

它装的是 `Restrictions` / `Verification Requests` / `Hard Line` / `Customer`，代码注释自己写着此块回答「这个客户现在被限制了什么、凭什么解锁」。

业主裁定：**「客户合规信息不放在订单里。兑换是错的。」** 这是客户档案的内容，不是订单页的内容。

⚠️ 这块与充值/提现的同名组**同名不同物**（那两个装按钮，这个装只读信息）—— 是本轮最违反规则一的一处。

**② `Frozen Disposition` —— 整块删（含那段中文说明）。**

它没有按钮，只有一段中文解释「制裁冻结（零出边终态），本单不可解冻、不可继续」。业主裁定：兑换不要 `Frozen Disposition`。

### 5.4 `Identity` —— 三域统一为纯身份 4 行

| | 4 行 |
|---|---|
| 充值 | Deposit No · Owner · Owner Type · **Asset** |
| 提现 | Withdraw No · Owner · Owner Type · **Asset** |
| 兑换 | Swap No · Owner · Owner Type · **Pair** |

业主原话：「identity 只放纯身份 4 行。asset 在兑换里是 pair。」

兑换现在是 7 行，混进了 `Status` / `Current Stage` / `Needs Review`（状态类）与 `Pair` / `Net Received`（金额类），且 Status 与 Stage 在 Hero 已显示过一遍。
→ 删 `Status`、`Current Stage`、`Net Received`；`Needs Review` 挪走（§6）；**补 `Owner Type`**（兑换全页零出现）。

---

## 6. `needsReview` —— 三域统一为顶部横幅

### 6.1 现状（三域三样，且两种形态并存）

| | 顶部横幅 | 侧栏 KV |
|---|---|---|
| 充值 | ❌ | ✅ 在 `Lifecycle` |
| 提现 | ✅ | ❌ |
| 兑换 | ✅ | ✅ 在 `Identity` |

### 6.2 目标

业主：「need review 放 hero 里面。」

**取顶部横幅形态**，三域一致；删掉充值与兑换的两处侧栏 KV。

判定依据：兑换那份的代码注释写着「从 Hero 徽标**提为**顶部横幅」—— 说明这个演进方向是既有共识；且横幅比 Hero 里的小徽标显眼，符合业主此前定的「卡住了是一面旗」。

⚠️ **若业主要的是 Hero 内的徽标而非顶部横幅**，那是把兑换那次改动退回去，本条改判、其余不变。

### 6.3 顺带发现的 Hero 差异

**2026-08-23 实证订正**：本稿初版写「兑换 Hero 缺 Owner No」是**错的** —— 兑换那处用的是局部变量 `ownerNo` + `ownerLink`（`{ownerNo && (...)}`），不是 `data.ownerNo`，初版 grep 漏了。

| | 单号 | 状态 | Owner | Stage |
|---|---|---|---|---|
| 充值 | ✅ | ✅ | ✅ | — |
| 提现 | ✅ | ✅ | ✅ | — |
| 兑换 | ✅ | ✅ | ✅ | ✅ 多 |

→ **Hero 本轮无需改动。** `Stage` 是兑换独有的流转阶段，属内容差异，保留。

### 6.4 三域横幅 markup 不一致 → 抽共享件

现状（提现无图标、兑换有）：
```
提现  shrink-0 border-b border-adm-border bg-adm-red/5  px-6 py-2.5 …          无图标
兑换  flex items-center gap-2 border-b border-adm-border bg-adm-red/10 px-6 py-2 …  + AlertTriangle
```

按规则①，这是同一职责的模块 → **抽 `NeedsReviewBanner` 共享件**，三域各传自己的文案。

⚠️ **文案必须按域给，不能照抄**：充值的 `needsReview` 语义是「处置资金腿重试三级梯耗尽、单子卡在原地」，提现/兑换那句写的是「放款/成交后迟到的 KYT 裁决」—— 两回事，照抄会说错话。

---

## 7. `SumsubDetailSection` 合并（违规 #2）

**2026-08-23 实证订正**：本稿初版写「三份哈希全不同」是错的 —— 那是我 awk 取范围越界到 `StatusTimeline` 造成的假象。

去掉注释与空白后逐字节比对，真相是：

| | 渲染体 |
|---|---|
| 充值 | `a47bc04b629d` |
| 提现 | `a47bc04b629d` ← **与充值逐字节相同** |
| 兑换 | `05b8c2429786` |

而兑换那份与充值的完整 diff **只有一行实质差异**：
```diff
-  detail: SumsubTxnDetail | null | undefined;
+  detail: SwapSumsubDetail | null | undefined;
```
其余全是注释。四个字段标签（`Score` / `Verdict` / `Review Status` / `Review Answer`）与 props 名（`{ detail }`）三域完全一致。

→ 合成一个共享件，入参用**公共父类型**（字段全可选），各域自己的 DTO 靠结构化子类型直接可赋值，不必改各页的类型声明。**这是三条里风险最低的一条。**

---

## 8. `StatusTimeline` 合并（违规 #3）—— ⚠️ 不是"挑一份留下"

三份不只是抄，**健壮性不同**：

| | 非数组守卫 | 排序 | 日期兜底 | 读 note/reason | 读 operator |
|---|---|---|---|---|---|
| 充值 | ❌ 无 | 原地 `sort`（改原数组） | ❌ 无 | 只读 `item.reason` | `operatorId \|\| actorType` |
| 提现 | ❌ 无 | 原地 | ❌ 无 | `note \|\| reason` ✅ | `operator \|\| operatorId \|\| actorType` ✅ |
| 兑换 | ✅ `Array.isArray` | `[...parsed].sort` 不可变 ✅ | ✅ `\|\| 0` | `note \|\| reason` ✅ | `operator \|\| operatorId` |

**充值那份如果 `statusHistory` 存进非数组 JSON，`history.sort` 直接抛错、整页白屏。**

合并规则：**取兑换的守卫（`Array.isArray` + 不可变排序 + 日期兜底）＋ 提现的字段兜底链 ＋ 各域自己的 `get*StatusMeta`。**

后端三域实际写入形状（已实证）：

| 域 | 写入字段 |
|---|---|
| 充值 | `status, timestamp, operatorId, actorType, actorRole, reason, context` |
| 提现 | `status, timestamp, operator, note` |
| 兑换 | `status, timestamp, operator, note` |

→ `item.note \|\| item.reason` 与 `item.operator \|\| item.operatorId \|\| item.actorType` **三种形状全覆盖**，所以合并后的组件读字段可以完全统一，不需要按域分支。

`get*StatusMeta` 三域不同，作为入参传进去。

---

## 9. 主列剩余（两处）

| 项 | 现状 | 改成 |
|---|---|---|
| 兑换 `Technical` 卡位置 | 甩在 `Verification Requests` 之后，离 `Conversion`/`Pricing` 隔了 6 张卡 | 挪回与那两张相邻，成为连续三张 |
| `⚡ Simulation` 渲染条件 | 充值/提现常显；兑换仅 `COMPLIANCE_PENDING` | 见下 |

**`⚡ Simulation` 的渲染条件**：兑换那个条件有真实理由（终态后投递裁决会被后端忽略，显示面板会误导），而且**这条规则三域都成立** —— 充值/提现同样有「裁决被忽略」的状态集合，只是没写进 UI。

所以多数那个是「少做了一层」，不是另一种做法。

**目标：三域都常显；单子进终态/处置态时按钮置灰 + 一句说明。** 判据各域读自家的忽略集合（后端是 `private static`，前端拿不到，各页硬抄一份并在注释里写明同步源的**文件名 + 符号名**，不写行号）。

⚠️ 三个坑：
- 充值的集合是 `KYT_VERDICT_IGNORED_STATUSES`；**提现那份至今还叫 `KYT_VERDICT_TERMINAL_STATUSES`**（没跟着改名，grep `IGNORED` 在提现域一无所获）
- **`FROZEN` 刻意不在充值那个集合里**（后端有成文注释解释），不要顺手加
- **兑换有 `KYT_VERDICT_TERMINAL_STATUSES`**（与提现同名，内容 `SUCCESS/REJECTED/FAILED/REVERSED`）—— 本稿初版写「兑换没有同名常量」是错的，2026-08-23 实证订正

---

## 10. 列表页（三处）

| 项 | 现状 | 改成 |
|---|---|---|
| 资产类型筛选 | 充值/提现有 `All types` 下拉，**兑换没有** | 兑换补。⚠️ 三域的 type 筛选**都是页内客户端过滤**（后端 DTO 无此字段），补给兑换的也只能是页内过滤，注释写明这是刻意对齐现状 |
| `Review` 列 + 「只看需复核」勾选框 | 充值/兑换都有，**提现两样都没有** | 提现补。⚠️ 是**新增一列**：`colSpan` 7→8、tbody 加一格、确认列表项类型里有 `needsReview` |
| 状态下拉「全部」文案 | 充值 `All`、兑换 `All`、提现 `All status` | 统一为 `All status` |

**列表页的组件层面已经是统一的** —— 三个页面都用共享的 `Pagination` + `PageTitleBar`，本地零自定义组件。差异只在内容与文案。

---

## 11. 验收方式

业主的验收方式是**并排打开三个页面对比**，所以本批验收必须是渲染比对，不是闸门绿。

每个动 UI 的任务收尾都要起本 worktree 的栈，三域同类页面各截一张并排图。

闸门五道：
```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest
```

**jest 基线**：`3 suites / 4 tests failed` 是既存破损（已实证 main 与第四批分支逐一相同）。**净新失败必须为 0。**

### 11.1 测试能力的硬限制（决定怎么写测试）

`jest.config.js` 实测：
```
moduleFileExtensions: ['js','json','ts']    ← 没有 tsx
testRegex: '.*\.spec\.ts$'                   ← .spec.tsx 静默不跑
testEnvironment: 'node'                      ← 无 jsdom
roots: [src, admin-web/src, client-web/src]  ← 这两处的 .spec.ts 会跑
```

**本仓库今天无法单测 React 组件。禁止写 `.spec.tsx`** —— 它不会跑，写了等于伪造绿灯（第四批栽过一次）。

⚠️ `admin-web/tsconfig.app.json` 的 `exclude` 排除了 `src/**/*.spec.ts` —— **前端 spec 不在任何 tsc 闸门内**，类型错只有 `npx jest` 跑到才暴露。

可用的验证手段：
- **纯逻辑**（`admin-web/src/utils/*.ts`）→ 真单测
- **`.tsx` 里的常量与结构**→ `.spec.ts` 用 `fs.readFileSync` 读源文本做断言（例如「三域侧栏组顺序必须一致」）
- **排版与颜色**→ 只能渲染截图

---

## 12. 本轮之后仍欠的账（登记 BACKLOG）

1. **三域 Owner 按客户号搜索全是坏的**（已实证）：充值/提现前端发 `ownerNo`、DTO 只有 `ownerId` → `main.ts` 的 `ValidationPipe({whitelist:true})` 静默丢弃 → **输什么都返回全量**；兑换把客户号塞进 `ownerId` → 比 UUID → **恒 0 行**。实测 `30/30/0`、`83/83/0`、`59/59/0`。修它要动后端，不属本轮
2. **充值/提现详情页看不到资金腿重试次数**（后端有、前端没显示）；统一关联资金单模块前需先确认详情响应是否带 `attempt`
3. 三域 SLA 徽章与 `Simulate SLA Timeout` 用裸 Tailwind 色，违反 `rules/frontend-admin.md` 的「只用 adm-* token」—— 三域 3/3 一致，要改就独立一轮三域一把改，只改一域会把既有技术债变成新漂移
4. 三域 `fetchData` 里的原生 `alert()` —— 同上，3/3 一致
5. 兑换时间线 `operator` 恒为 `'SYSTEM'` 字面量（后端 `statusHistory` 写入行为），永远看不到是谁操作的
6. `admin-web` 的 `.spec.ts` 不在任何 tsc 闸门内
