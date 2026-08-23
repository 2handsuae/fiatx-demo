# 第五批设计稿 · admin 三域列表页/详情页模块级一致性收敛

日期：2026-08-23 ｜ 业主逐条拍板 ｜ 承接第四批（分支 `feat/l1-gate`，未合 main）

---

## 0. 业主的原话与目标

> 「我要他们**模块级的相同**，展示逻辑都相同。比如模拟面板，你要么就一直展示，要么就可用时候展示，但是你不能提现和充值是前者，兑换是后者。」

业主的验收方式是**并排打开三个页面对比**。

六个页面：
```
admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionList.tsx
admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx
```

穷举审查（六维并扫 + 逐条核实）共存活 **61 条差异**，其中 **DRIFT 57 条 / DELIBERATE 4 条**，**肉眼可见 53 条**。

⚠️ **覆盖度声明**：六维中「呈现层（状态·金额·时间·颜色）」与「详情页字段级」两维的扫描 agent 中途掉线，未产出。这两维的差异由其余四维顺带覆盖了一部分（例如时间线颜色、金额对齐、空值占位符），但**不能声称穷尽**。实施时若发现清单外的同类差异，按本文的判定规则就地处理，不必回来改 spec。

---

## 0.5 基线与合并顺序（⚠️ 先读这条）

**本 spec 的全部行号与“现状”描述，基线是 `feat/l1-gate @ 7467b20c`，不是 `main`。**

第四批的分支**尚未合 main**（领先 main 27 个 commit），而它正好重写了这六个页面里的大半 —— 在 main 上读到的是收敛前的旧样子。

所以：

- 本批**从 `feat/l1-gate` 开分支**，不从 main 开
- 合并顺序：第四批 → main → 第五批 → main
- 若业主决定第四批先合 main，则本批基线自动等价，行号不变

工作树：`.claude/worktrees/l1gate`（已在线，管理台 `http://127.0.0.1:3101`，⚠️ 用 `127.0.0.1` 不用 `localhost`）。

已核实**后端三个 `fixtures/verdict-buttons.ts` 与 `src/main.ts` 在两个分支上逐字相同**，故 §3 与 §5 引的后端行号两边通用。

---

## 1. 收敛方式（业主裁定：甲）

**逐条对齐，不抽共享骨架。**

我给的两条路是 **甲＝逐条对齐** / **乙＝把详情页外壳·时间线·处置卡·空态·列表外壳抽成三域共用组件**，业主选甲。

选甲的论证（我方给出，业主未逐条讨论）：乙会把一个刚验收过的分支重写一遍，且与仓库 33 处成文的「三域故意分叉」声明正面冲突 —— 那条铁律的边界一旦松动，后面每次都要重新吵。

**本批不新建任何跨域共享组件。** 已有的共享件（`LinkedRelationCard` / `copyToClipboard` / `AdminBadge` / `Pagination` / `MaterialRequestPanel` / `getComplianceLayerStyle`）**该用而没用的要接上**，这不算新建。

---

## 2. 判定规则

### 2.1 主规则 · 少数服从多数

三域里**两个一样、一个不同** → 那个不同的改过来。约 50 条据此自动定案。

### 2.2 例外 · 少数更好，多数改过来（4 条）

| 概念 | 多数（充值/提现） | 少数（兑换） | 采纳少数的理由 |
|---|---|---|---|
| 列表加载态 | 每次刷新**清空整表**换成一行 Loading | 仅首屏空表时显示，之后保留旧行 | 翻页/刷新整表闪一下，运营失去位置感 |
| 合规闸未裁决 | 灰 `N/A`（与「这层不存在」视觉无区分） | 琥珀 `PENDING` | 未决恰是最该注意的态，灰掉等于藏起来 |
| `Terminal` 提示 | 充值**没有**、提现有 | 有且措辞完整 | 充值同样有 5 个终态，没理由不提示 |
| 日期框 hover 提示 | 无 | 有 `title` | 白给的可用性 |

### 2.3 三域三答案 · 单独裁定（3 条）

- **`needsReview` 摆哪** → **顶部横幅 + 侧栏 KV 都要**（兑换那份）。横幅保证一眼看见，侧栏 KV 保证它是可查的结构化字段。
- **状态筛选下拉粒度** → **统一按 `group` 派生**。现状是三种粒度：充值 12 项（其中 11 项是 1:1 逐状态列举）、提现 9 项、兑换 4 项。
  好消息是**骨架已经在数据里了** —— 三个 `*StatusMap.ts` 都有 `group` 字段，共用同一套词表 `IN_PROGRESS / WAITING / NEEDS_OFFICER / COMPLETED / EXCEPTION`，只有 `*_STATUS_FILTERS` 三个数组各写各的。
  **收敛为**：下拉的前 5 项固定是这 5 个组，**名称与顺序三域逐字相同**；某域没有对应状态的组不显示（兑换无 `ACTION_PENDING`，故无 `WAITING`）。
  **域专属终态另起一段接在后面**（充值的 `Returned` / `Seized` / `Confiscated` 是运营真要单独筛的三种不同结局，塞进 `EXCEPTION` 会丢掉筛选力）。前 5 项负责"模块级相同"，尾段负责"域真的不一样"，两者视觉上分段隔开。
- **列表列顺序** → 共同骨架 `单号 | Status | Owner | SLA | Review | Created`，域专属列插在 `Owner` 之后。

### 2.4 DELIBERATE · 保持不同（4 条，不要"顺手统一"）

| 概念 | 保持不同的成文理由 |
|---|---|
| 兑换 `Frozen Disposition` 卡无按钮 | 兑换 FROZEN 是零出边终态，回不来；这张卡的作用是免得运营去找不存在的解冻入口（`swap-transactions.service.ts:467` + 卡内注释） |
| 兑换 `Internal Approvals` 恒空态 | 兑换域无审批流（无大额门、无对手方） |
| 兑换无 `MANUAL_CHECKING` 提示 | 兑换状态机无此态 |
| 兑换保留 `Conversion`/`Pricing`/`Technical` 三块而非单块 `Transaction Details` | 兑换有买卖两侧资产与汇率，硬塞一卡更难读 |

---

## 3. 🔴 优先修：三个列表页的 Owner 搜索框全都是坏的（而且坏法还不一样）

这不是视觉问题，是功能坏的。三个页面的输入框 placeholder 都写着 **`Owner No`**（`DepositTransactionList.tsx:205` / `WithdrawTransactionList.tsx:194` / `SwapTransactionList.tsx:217`），运营输进去的是客户号。但：

| 域 | 前端实际发的参数 | 后端 QueryDto 有没有这个字段 | 结果 |
|---|---|---|---|
| 充值 | `ownerNo`（`DepositTransactionList.tsx:102`） | ❌ 只有 `ownerId`（`deposit-transaction.dto.ts:44`） | 被 `whitelist` 静默丢弃 → **输什么都返回全量** |
| 提现 | `ownerNo`（`WithdrawTransactionList.tsx:96`） | ❌ 只有 `ownerId`（`withdraw-transaction.dto.ts:155`） | 同上 → **输什么都返回全量** |
| 兑换 | **`ownerId`**（`SwapTransactionList.tsx:115`，把 `f.ownerNo` 塞进了 `ownerId`） | ✅ 有 `ownerId`（`swap-transaction.dto.ts:97`） | 参数生效，但拿客户号去比 UUID → **输什么都返回 0 行** |

丢弃的机制：`src/main.ts:38`
```ts
app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
```
`whitelist: true` 把 DTO 上没声明的字段直接剔掉，**不报错**。

**实测**（真 admin token 打 `feat/l1-gate` 的在线栈 `:3100`，编一个不存在的客户号）：
```
deposit-transactions       不筛=30   ownerNo=30   ownerId=0
withdraw-transactions      不筛=83   ownerNo=83   ownerId=0
admin/swap-transactions    不筛=59   ownerNo=59   ownerId=0
```

两种坏法都不报错：充值/提现让运营以为"这个客户下面全是单"，兑换让运营以为"这个客户一单没有"。**后者更危险** —— 演示时按客户号查制裁客户的兑换单，会得到一张空表。

**修法**：后端三个 QueryDto 加 `ownerNo?: string`，service 层按关联的 `customerNo` 过滤；前端三处统一发 `ownerNo`（兑换那处顺带改掉 `ownerNo→ownerId` 的错位赋值）。

选这个方向而不是"前端改发 ownerId、输入框改叫 Owner ID"，因为业主定过：**Admin 页面禁止暴露原始 UUID，实体间关联必须用业务键**。输入框收 `customerNo` 是对的，该改的是后端。

`ownerId` 参数**保留**（内部/脚本仍可用），两者可共存：都传时以 `ownerNo` 为准，或直接取交集 —— 实施时二选一并写进注释，不要留成隐式行为。

## 4. 分层清单

### 第一层 · 功能性差异（不只是视觉）

| 概念 | 充值 | 提现 | 兑换 | 收敛方向 |
|---|---|---|---|---|
| 状态筛选作用域 | 服务端全库筛 | 服务端全库筛 | **只筛当前页 20 行**（`SwapTransactionList.tsx:166-184` 有成文注释承认这点） | 兑换改服务端。后端 `swap-transaction.dto.ts:107` 的 `status?: SwapTransactionStatus`（单值 `@IsEnum`）要改成充值/提现同款：`@Transform(v => v.split(','))` + `@IsEnum(..., { each: true })`，类型放成 `Status \| Status[]`（照抄 `deposit-transaction.dto.ts:58-65`），service 层数组时走 `in`。**后端改动全批只有三处：§3 的 `ownerNo`、这里的 `status` 数组化、§5.6 的兑换 fixture + handler。别扩散。** |
| 乱序响应守卫 | 有 `requestSeqRef` | 有 | **无** | 兑换补上 |
| 翻页失败 | 页码回滚 | 回滚 | **不回滚** | 兑换改成成功后才更新页码 |
| 错误文案 | 显示后端真实 message | 同 | **整个丢掉**，403 也显示通用错误 | 兑换保留 `err.message` |
| 加载态 | 每次刷新清空整表 | 同 | 保留旧行 | **充值/提现向兑换看齐**（2.2 例外） |
| Status History 时间线状态呈现 | 走 `getDepositStatusMeta` 上色+人话 label | 同 | **硬编码绿色 + 原始枚举串** | 兑换接 `swapStatusMap`（D1 建的表列表页和 Hero 都接了，**只有时间线漏了**） |

**时间线那条最刺眼**：同一条「被冻结」事件，充值页红底 `FROZEN`、兑换页**绿底** `FROZEN`；同一条待合规事件，充值页 `COMPLIANCE PENDING`、兑换页 `COMPLIANCE_PENDING`。根因是 `StatusTimeline` 在三个文件底部各存了一份 copy-paste（`DepositTransactionDetail.tsx:1238` / `WithdrawTransactionDetail.tsx:977` / `SwapTransactionDetail.tsx:944`）。

⚠️ 附带非视觉差异：三份时间线读字段的写法不同（deposit 读 `item.reason`/`item.operatorId`；withdraw/swap 读 `item.note || item.reason` 与 `item.operator || item.operatorId`）。各自与自家后端写入形状对得上，今天不出错，但后端改写入形状时只会有一个域跟着改。**本批统一成三域各自读自家后端真实写入的字段，并在注释里点明该字段的后端写入点**，不强行统一读法。

### 第二层 · 模块级结构（并排看直接看出来）

| 概念 | 现状 | 收敛方向 |
|---|---|---|
| `Ops Disposition` 同名不同物 | 充值＝条件渲染的动作面板（3 按钮）；兑换＝**恒亮的只读信息板**（0 按钮） | 兑换那块**改名**（它装的是客户级限制/材料请求/硬线，不是"处置"），并把它改成与内容相符的条件渲染。第四批 D3 只把名字硬对齐了，性质没对齐 |
| 侧栏 `Identity` 组 | 充值/提现 4 行纯身份键；兑换 **7 行且复述 Hero**（Status/Stage/Pair/Net Received 在 Hero 已有） | 兑换删掉复述项，只留 Hero 没有的身份键；补 `Owner Type`（兑换全页零出现） |
| 复制按钮 | 充值/提现各 5 个字段可复制 | 兑换 **0 个** → 接 `copyToClipboard`，至少给 `Applicant ID` / `Txn ID Out` / `Txn ID In`（这三个正是运营要粘进 Sumsub 控制台的） |
| 关联单卡片与空态 | 充值/提现用共享 `LinkedRelationCard` + `LinkedRelationEmpty` | 兑换手搓了等价物 → 改用共享组件（改共享组件时兑换才会跟着变） |
| 关联资金单行的可点区域 | 充值/提现整卡可点、hover 变色、有 🔗 图标 | 兑换只有单号那几个字可点 → 对齐 |
| `Verification Requests` 出现次数 | 充值/提现各 1 次 | 兑换 **3 次**（References 卡计数 + 主列面板 + 侧栏 KV）→ 收敛成 1 次 |
| `Sumsub References` 卡栅格 | 充值/提现双层（`col-span-2` + `sm:grid-cols-4`） | 兑换无嵌套直铺 → 对齐 |
| 空字段占位 | 充值/提现所有 `InfoField` 恒渲染，空值显 `—` | 兑换 `Pricing` 卡两个字段写成条件渲染（整格消失，格子位置会跳）→ 改恒渲染 |
| `Compliance` 卡容器 | 充值/提现用 `DetailCard` 组件 | 兑换是手写 `<div className="px-6 py-5">` + `<h3>` → 改用 `DetailCard` |
| `L2 · Transaction Screen` 内部排版 | 充值三段横排、提现一行小字（都比自家 L1 轻一档） | 兑换与自家 L1 同构（小标题+大字+小字）→ **充值/提现向兑换看齐**，L1/L2 视觉等重 |
| L1 副标题用词 | `Post-arrival check` / `Pre-creation check` / `Pre-execution gate` | 闸门时点是真实域差异，但 `check` 与 `gate` 混用无理由 → 统一用词 |
| 列表列顺序 | 三域完全不同，兑换多 4 列 | 按 2.3 的共同骨架重排 |
| 金额列对齐 | 充值/提现 Amount 右对齐 | 兑换四个数字列全左对齐 → 改右对齐 |
| 金额方向着色 | 充值/提现中性 | 兑换 Sell 红 / Buy 绿 → **保留兑换的着色**（兑换一行里同时有卖出和买入，着色是必要的区分），但充值/提现不加 |
| 资产类型筛选 | 充值/提现有 `All types` 下拉 | 兑换无 → 补 |
| 分页控件 | 充值/提现有 footer 条 + `Showing X / Y` | 兑换无 footer、无计数 → 补 |
| 错误位置 | 充值/提现独立红横幅、表格数据仍在 | 兑换占满 `colSpan` 顶掉整张表 → 改横幅 |

### 第三层 · 细节漂移（按主规则自动定案，实施时逐条对齐）

横幅浓度与内边距（兑换 `bg-*/10 + py-2` vs 另两域 `bg-*/5 + py-2.5`）、兑换横幅漏 `shrink-0`、按钮 `w-full` 用得不一致、`Frozen Disposition` 里破坏性按钮排第几（充值 Seize 在前、提现 Unfreeze 在前）、modal 必填框有无字段标签、`window.confirm` 与自建 modal 混用（充值 6 个动作里 2 个用原生 confirm）、`All` vs `All status`、Reset 禁用条件（兑换多 `|| loading`）、根容器 `overflow-hidden`（兑换缺）、加载文案（`Loading details...` vs `Loading swap detail...`）、列表页 `console.error`（只有兑换写）、解冻 modal 单号字段标签措辞、**中英文混用**（兑换 `Frozen Disposition` 整段中文，另两域全英文 → 统一英文）。

---

## 5. ⚡ Simulation 面板

### 5.1 渲染条件（业主裁定：乙）

**三域都常显；单子进终态时按钮全部置灰 + 一句说明。**

现状：
```
充值   {simEnabled && ...}                                        DepositTransactionDetail.tsx:754
提现   {simEnabled && ...}                                        WithdrawTransactionDetail.tsx:610
兑换   {simEnabled && data.status === 'COMPLIANCE_PENDING' && ...} SwapTransactionDetail.tsx:669
```

兑换那个条件**有真实理由**（终态后 `applyKytVerdict` no-op，显示面板会误导），而且**这条规则三域都成立** —— 充值/提现的 `KYT_VERDICT_IGNORED_STATUSES`（`deposit-workflow.service.ts:308`：5 个终态 `SUCCESS/FAILED/CONFISCATED/RETURNED/SEIZED` + 3 个在途处置态 `CONFISCATING/RETURNING/SEIZING`，共 8 个）同样让裁决 no-op，只是没写进 UI。

⚠️ **`FROZEN` 刻意不在这个集合里**（`:445` 有成文注释解释原因）—— 置灰判据要照抄这个集合，**不要“顺手把 FROZEN 也加上”**。

所以多数那个是"少做了一层"，不是"另一种做法"。业主选择常显 + 置灰，理由：面板忽隐忽现比按钮灰着更让人困惑，且置灰 + 说明比"面板消失"信息量更大。

置灰时的说明文案（三域统一措辞）：
> 本单已进终态/处置态，投递的裁决会被后端记录但不改状态。

判据各域读自家的 `KYT_VERDICT_IGNORED_STATUSES` 等价物，**不抽公共 helper**（§1 甲）。兑换若无此常量，本批新建一份自家的。

### 5.2 🔴 先修一个并排就露馅的问题：三域的圈码编号互相打架

三域的按钮标签都用圈码 ①②③… 打头，但**同一个圈码在三个域是不同的东西**：

| 圈码 | 充值 / 提现 | 兑换 |
|:--:|---|---|
| ② | Awaiting user | **Rejected · 硬线（无 action）** |
| ③ | Awaiting user · PEP | **Rejected · 软线（下发认证）** |
| ⑤ | Rejected · MLRO freeze | **On hold** |
| ⑥ | Rejected · MLRO return / Refund tag | **Awaiting user** |
| ⑦ | Rejected · no disposition tag | **认证通过（清限制）** |
| ⑧ | On hold | **认证不通过（升级）** |

业主并排看三个页面时，「点③」在两个页面是"要客户补料"、在第三个页面是"拒单"。**这正是"模块级不同"最刺眼的一处。**

**收敛规则：圈码按语义固定，三域共用一套编号；某域没有的号留空不补位。**
这样并排看时同一个号永远是同一件事，缺号本身也是有信息量的（"兑换没有对手方，所以没有 ④B"）。

### 5.3 最终按钮清单（业主逐条拍板）

| 编号 | 语义 | 充值 key | 提现 key | 兑换 key | 处置 |
|:--:|---|---|---|---|---|
| ① | Approved | `V1_APPROVED` | `V1_APPROVED` | `V1_APPROVED` | 保留 |
| ② | Awaiting user | `V2_AWAIT_USER` | `V2_AWAIT_USER` | `V6_AWAIT_USER` | 兑换**改圈码** |
| ③ | Awaiting user · PEP | `V3_AWAIT_USER_PEP` | `V3_AWAIT_USER_PEP` | — | 兑换**新增**（业主裁定） |
| ④ | Rejected · 制裁（客户本人） | `V4_REJECTED_SANCTION_APPLICANT` | 同 | `V4_REJECTED_SANCTION_APPLICANT` | 保留 |
| ④B | Rejected · 制裁（对手方） | `V4B_…_COUNTERPARTY` | 同 | — | 兑换**留空**（DELIBERATE：无对手方，fixture 头注已成文） |
| ⑤ | Rejected · MLRO freeze | `V5_REJECTED_FROZEN_MLRO` | 同 | — | 兑换留空 |
| ⑥ | Rejected · 退回 / 退款 | `V6_REJECTED_RETURN` | `V6_REJECTED_REFUND_TAG` | — | 兑换留空（零记账无退回弧） |
| ⑦ | Rejected · 无处置标签 | `V7_REJECTED_NO_TAG` | `V7_REJECTED_NO_TAG` | `V2_REJECTED_HARD` | 兑换**改圈码 + 改文案**对齐 |
| ⑧ | On hold | `V8_ONHOLD` | `V8_ONHOLD` | `V5_ONHOLD` | 兑换**改圈码** |
| ⑨ | ~~Rejected · SLA breach~~ | 删 | 删 | — | **三域全删**（见 5.4） |
| ⑩ | Awaiting user · 多条 | `V10_AWAIT_USER_MULTI` | `V10_AWAIT_USER_MULTI` | — | 兑换**新增**（业主裁定） |
| ⑪ | ~~Rejected · 软线（下发认证）~~ | — | — | `V3_REJECTED_ACTION` 删 | **删**（业主裁定） |
| — | ~~认证通过 / 不通过~~ | — | — | `V7_ACTION_GREEN` / `V8_ACTION_RED` 删 | **移出面板**（见 5.5） |

**收敛后**：充值 10 个、提现 10 个、兑换 7 个（①②③④⑦⑧⑩）。

⚠️ 兑换保留 `V6_AWAIT_USER` / `V2_REJECTED_HARD` / `V5_ONHOLD` 三个 **key 不改**（key 是与后端 fixture 的合同，改 key 要动 e2e），**只改圈码与 label 文案**。前端数组里 `key` 与 `label` 本就是两列，改 label 即可。

### 5.4 ⑨ 只删 UI 入口，**不删后端 fixture**

`V9_REJECTED_SLA` 的 fixture 被两个 e2e 直接投递：
```
test/deposit-sumsub-verdicts.e2e-spec.ts:547    await deliver(deposit.id, 'V9_REJECTED_SLA');
test/withdraw-sumsub-scenarios.e2e-spec.ts:460  await deliver(w.id, 'V9_REJECTED_SLA');
```

业主的原话是「⑨ Rejected · SLA breach 这个**模拟按钮**直接删了」—— 删的是运营点的那个按钮，理由是 SLA 卡里已有独立的 `Simulate SLA Timeout` 按钮，两个入口做同一件事。

**所以：删两个前端数组里 `key === 'V9_REJECTED_SLA'` 那一项（`DepositTransactionDetail.tsx:52` / `WithdrawTransactionDetail.tsx:51`，行号以 `feat/l1-gate` 为准）；`src/modules/{deposit,withdraw}-sumsub/fixtures/verdict-buttons.ts` 里的 `V9_REJECTED_SLA` 原样保留**，并在两处 fixture 上补一行注释说明"UI 入口已撤，保留供 e2e 投递"。

### 5.5 兑换 ⑦⑧ 移出面板的依据

`V7_ACTION_GREEN` / `V8_ACTION_RED` 投的是 `applicantActionReviewed`，作用对象是**人**（客户补料动作的复核结果），不是这笔单 —— 与其余六个 KYT 交易裁决不是一个族（fixture 头注已写明）。

而三个详情页都挂着共享的 `MaterialRequestPanel`：
```
DepositTransactionDetail.tsx:749   <MaterialRequestPanel mode="order" orderDomain="DEPOSIT"  … />
WithdrawTransactionDetail.tsx:605  <MaterialRequestPanel mode="order" orderDomain="WITHDRAW" … />
SwapTransactionDetail.tsx:652      <MaterialRequestPanel mode="order" orderDomain="SWAP"     … />
```
它自带三个复核按钮（`MaterialRequestPanel.tsx:52` 起：`GREEN` / `RED·RETRY` / `RED·FINAL`），打的是 `POST /admin/sumsub/simulate/applicant-action-result` —— **比兑换 ⑦⑧ 那两个更全**（⑦⑧ 把 RED 的 RETRY/FINAL 合成了一个，而那两者是 Sumsub 的真实语义差异，组件注释里点明了「不能合成一个」）。

所以移除 ⑦⑧ 不是砍功能，是**去掉一个更粗糙的重复入口**。同 ⑨，**只摘 UI，后端 fixture 保留**（先 grep `V7_ACTION_GREEN|V8_ACTION_RED` 确认 e2e 引用情况；有引用则原样留，无引用也留着，本批不做 fixture 清理）。

### 5.6 ⚠️ 兑换新增 ③⑩ 是后端活，不是改个数组

这两个按钮要真能用，需要三步，**缺任何一步都只是个装饰按钮**：

1. **fixture 新增两项**（`src/modules/swap-sumsub/fixtures/verdict-buttons.ts`）
   - ③：`webhookType: 'applicantKytTxnAwaitingUser'`、`reviewAnswer: null`、`score: 62`、`typedTags: [TAG('PEP')]`、一条 applicantAction
   - ⑩：同 webhookType、三条 applicantAction
   - **applicantActions 必须用 getter 现铸 `randomUUID()`**，不能写死字面量 —— 材料请求账的 `externalActionId` 是全表 `@unique`，固定字面量会在两笔单先后点同一个按钮时 P2002（这是 2026-08-18 终审 Important #4 踩过的坑，兑换 fixture 里已有三处同款 getter 注记，照抄）

2. **兑换 handler 要把 `typedTags` 在 `awaitingUser` 上也透传**
   `swap-kyt-verdict.handler.ts:72-84` 现在只在 `rejected` 分支拉 `getTxn` 读 `typedTags`；`swap-kyt-verdict.handler.spec.ts:90` 还有一条 `expect(arg).not.toHaveProperty('typedTags')` 把这个行为钉死了。
   **不改这里，③ 的 PEP 标签会被丢掉，③ 与 ② 行为完全相同 —— 就是个假按钮。**
   对照充值：`deposit-workflow.service.ts:766` 附近 `const manualReason = sceneTag === 'PEP' ? 'EDD_PEP' : 'CLIENT_ACTION';` —— PEP 在充值/提现是**真被消费**的，落到人工复核原因上。兑换要么照做，要么明说③只是展示。**本批采用照做**（业主要的是"展示逻辑都相同"，一个行为相同的假按钮不算相同）。

3. **`SwapVerdictVerdict` 接口无需改** —— 它已有 `typedTags?` 与 `applicantActions?` 两个可选字段，够用。

顺带：该 fixture 的文件头注写「7 个**单步**裁决按钮」，实际是 8 个 —— 收敛后是 7 个（①②③④⑦⑧⑩），**注释要一并订正，别让它又对不上**。

### 5.7 `Simulate SLA Timeout` 不动

三域已一致，保持独立在 SLA 卡里。

## 6. 明确不做

- **不新建跨域共享组件**（业主裁定甲）
- **不动第四批已收口的后端逻辑**（L1 闸门、资金腿失败对齐、退回弧）
- **不碰 `client-web`**（本批是 admin 专项）
- **不修 `swap-sumsub-scenarios.e2e-spec.ts`**（红了两批的既存破损，已登记 BACKLOG，与本批无关）
- **不做建单锁额** —— 业主裁定拆到第六批（见 §7）

---

## 7. 第六批预告 · 兑换建单即锁额（业主已拍板，细节待其自己那轮展开）

**业主要求**：兑换提交后要记账、要锁定交易额。

**已确认的代价**：这会拿掉 `truth/v6-swap.md:21` 称为「整个重设计的卖点」的**零记账**属性 —— 被拒的兑换单以后会在账本里留下一对 pending+void 痕迹，`test/swap-money-arc.e2e-spec.ts` 的「REJECTED 零记账」弧要改写。业主明确知情并接受。

**要修的洞**（第四批终审 I2）：兑换建单不锁额 → 客户 100 USDT 可以同时提交两笔各 60 的兑换，两笔余额校验都通过（都读到 100），两笔都过 KYT 进 `PROCESSING`，第一笔抽干余额、第二笔腿失败 —— 而 `PROCESSING` 只有一条出边通向 `SUCCESS`，第二笔**永久卡死**。

**实现路径（业主裁定：乙）**：

关键结构事实 ——
```
提现建单锁额      DR CLIENT_PAYABLE / CR CLIENT_ASSET   code=WITHDRAW_NET_PENDING
                 withdraw-workflow.service.ts:528 ｜ tb-transfer-codes.constant.ts:27

兑换 leg1 第一条   DR CLIENT_PAYABLE / CR CLIENT_ASSET   code=SWAP_SELL_CLIENT   amountRef='from'
                 swap-leg-plan.constant.ts:13（CRYPTO_TO_FIAT）与 :31（FIAT_TO_CRYPTO），两个方向都是同一条
```
借贷方向、账户对、金额口径完全一样 —— 兑换的「锁额」和 leg1 扣客户钱那一笔**本来就是同一笔账**。

**乙 = 建单时压的 pending 就是 leg1 的 `SWAP_SELL_CLIENT`，批准时直接 post，不重新压。** 与提现同形状（提现建单压 net+fee，放款时 post 同一批）。

否决了甲（独立锁 + 批准时先 void 再走四腿），理由：账本会留下一对没有业务含义的 pending+void，对账的人解释不清 —— 与业主定的「快照不许盖没查过的章」是同一种洁癖。

**乙 的已知代价**：leg1 的第二条记账 `SWAP_SELL_FIRM`（DR FIRM_ASSET / CR FIRM_OPS，公司侧调拨，不是客户的钱）不该在建单时压，于是 leg1 变成"一半建单时压、一半执行时压"，per-leg two-phase 的原子性被破开，`initiateLegPending` / `postLeg` 要改。

**第六批必须覆盖的路径**（每条都要 void 掉建单时压的 pending）：
- KYT rejected → `REJECTED`
- 客户本人命中制裁 → `FROZEN`
- SLA 超时 → `REJECTED`
- 建单事务本身回滚

---

## 8. 验收方式

业主的验收方式是**并排打开三个页面对比**，所以本批的验收也必须是渲染比对，不是 tsc/jest 绿。

每个 Task 收尾都要起 worktree 自己的栈（管理台 `http://127.0.0.1:3101`，⚠️ 用 `127.0.0.1` 不用 `localhost`），三域同类页面各截一张并排比对。

闸门五道（第五道 `client-web` 是第四批新补的 —— `tsconfig.json` 的 exclude 里就有 `client-web`，前四道没有一道会编译**客户端**的 `.tsx`，第四批 D4 因此漏过一次编译错误）：
```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest
```
