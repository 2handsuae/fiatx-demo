# 第四批设计稿 · 资金腿失败对齐 + L1 闸门收口 + 前端统一化

日期：2026-08-22 ｜ 业主逐条拍板 ｜ 承接第三批「三域 SLA 收口」（merge `1e88b24d`）

---

## 0. 本批要回答的问题

业主的六把尺子里，本批只碰四把：**订单状态流转**、**订单如何驱动客户状态**、**三域大框架一致性**、**前端一致性**。

审计日志与权限安全**各自单独一轮**，本批一个字不碰。

---

## 1. 明确不做（业主裁定，勿在实现时"顺手补上"）

| 项 | 裁定理由（业主原话） |
|---|---|
| 审计日志 | 单独一轮捋 |
| 权限 / 安全 | 单独任务 |
| TR 类型判定进 L1 | 判断照做，但不算 L1 内容、不进 L1 卡片 |
| 资产状态闸 | 「我们也不下架资产」 |
| 充值累计额度 | 「拦不住」 |
| 充值大额审批 | 「我拒绝有能怎么样？你说一句，我能如何？」——钱已到账，拒绝是空动作 |
| needsReview 的任何修复按钮 | 「暂时都不要」 |

---

## 2. A · 资金腿失败处理三域对齐 + 充值红标

### 2.1 统一规则

业主口径：**重试三次不是 TB 账本抖动，是资金单本身有问题。**

| 域 | 腿 | 性质 | 失败处理 | 现状 |
|---|---|---|---|---|
| 充值 | 退回 legSeq3 / 上缴 legSeq4 / 没收 legSeq2 | INTERNAL | 重试 3× → 原地不动 + 红标 | 退回·上缴已是；**没收零重试** |
| 提现 | 出款腿 legSeq1 | OUT | 直接 `FAILED` + `releaseLock` 解锁余额 | 已是 |
| 提现 | 费腿 legSeq2 | 内部划账 | 重试 3× → 原地不动 + 红标 | 已是 |
| 兑换 | 四条腿 | INTERNAL | 重试 3× → 原地不动 + 红标 | 已是 |

**出款腿为什么不重试**：钱要出门到链/银行。`SUBMITTED`/`CONFIRMING` 之后的 `FAIL`/`TIMEOUT` 都不代表外部那笔真的失败了（可能只是链拥堵/银行慢），重发即双花。所以直接 `FAILED` + 解锁余额把钱还给客户，由客户自己重新发起。`onPayoutLegFailed` 的 JSDoc 已标 `THE P6 FIX (do not weaken)`。

### 2.2 充值要改什么

**加 `needsReview` 列**。提现（`schema.prisma:1210`）、兑换（`:1300`）都有，只有充值没有 —— 这是充值域「没有标红这个能力」的根因。

**`CONFISCATING` 改成重试 3 次**。它现在零重试直接退 `OPERATION_PENDING`，代码注释写明了原因：

> 没收腿的 `deterministicTransferId` 第 4 参**写死常量 1**（非 attempt），重建的新腿会算出同一个 pending id 撞车。

所以改动是把 `attempt` 穿透到 `startConfiscation` 的两处 `legIndex: 1` 和 `onConfiscationLegFailed` 的两处 `deterministicTransferId(..., 1)`，与退回/上缴弧逐字同构。

**删 `CONFISCATING --confiscate_failed--> OPERATION_PENDING` 边与 `CONFISCATE_FAILED` 动作**。重试耗尽后原地不动，与另外两个处置态一致。

**三态耗尽后置红标**。`DEPOSIT_RETURN_STUCK` / `DEPOSIT_SEIZE_STUCK` 落点现成，没收的 STUCK 落点本批新建。

---

## 3. B · L1 闸门收口 + 回显

### 3.1 定义

**L1 = 我方系统内部就能算出答案的判定。**（业主原话：「所有我系统内能算出来的东西，都是 L1 内容」）

反面即 L2：必须问外部（Sumsub）才知道的。

### 3.2 九项判定 + 一项附加

| # | 判定 | 充值 | 提现 | 兑换 |
|---|---|---|---|---|
| 1 | 客户资格（lifecycle === ACTIVE） | 挂起 | 拒 | 拒 |
| 2 | 客户限制（便签卡住本能力） | 挂起 | 拒 | 拒 |
| 3 | 单笔上下限 | 挂起（仅 min） | 拒 | 拒 |
| 4 | 累计额度 | — | 拒 | 拒 |
| 5 | 大额转审批 | — | 转审批 | — |
| 6 | 收付账户就绪 | 钱包存在 | 地址已注册 | 双边收款账户 |
| 7 | 余额充足 | — | 已有（建单即 TB pending 锁额） | **要补** |
| 8 | 报价有效性 | — | 已有 | 已有 |
| 9 | 交易起始就绪 | 已有 | 已有 | 已有 |
| + | 客户档位快照 | 存 | 存 | 存（附加信息，非判定） |

**第 2 项对充值只有 2/7 种因由会触发**：`RESTRICTION_CAUSE_POLICY` 里只有 `SANCTION` 与 `ADMIN_SUSPENSION` 的 `defaultScopes` 是 `['ALL']`（展开含 DEPOSIT）；其余五种（`MATERIAL_EXPIRED`/`TIER_UPGRADE_PENDING`/`KYT_REJECTED_SOFT`/`KYT_REJECTED_HARD`/`PENDING_DOCUMENT`）只卡 `WITHDRAW`+`SWAP`。**这是既有设计，不改** —— 材料过期不该挡住别人给你打钱。

### 3.3 存储

**一个 JSON 字段**存全部判定。业主原话：「这个东西不用筛查，我就是点击后有个代码行能看就行。」

→ 不提列、不做筛选、不建索引。

### 3.4 充值的 L1 不拒单，只决定落地姿势

钱已经在链上到账了，「拒绝」在物理上不存在。

```
L1 全过        → 正常流转
L1 执法级不过（SANCTION）      → 已有的 FROZEN
L1 非执法级不过（金额太小 / 账户暂停） → 已有的 OPERATION_PENDING + 挂起原因
```

**零新状态。L1 是「入账那一刻的守卫」，不是一个状态。**

守卫挂 `approveDeposit()`（`deposit-workflow.service.ts:1050`）—— 它是资金入账唯一出口，四条 `approve→SUCCESS` 边（来自 `COMPLIANCE_PENDING`/`ACTION_PENDING`/`MANUAL_CHECKING`/`OPERATION_PENDING`）全汇于此，且已有 `FROZEN` 拦截与 `BELOW_MIN` 拦截两个先例。L1 守卫与 `holdBelowMinIfNeeded` 并列。

**客户面藏不藏按因由 visibility 决定**：`SANCTION` 是 SILENT → 藏；`ADMIN_SUSPENSION` 是 DISCLOSED（`customerLabel: 'Account suspended'`）→ 给客户看。现有 `BELOW_MIN` 是无条件藏，泛化时改成查表。

### 3.5 要修的真洞

**充值域对新到的单从不查 L1。**

`assertCapability()` 全仓只有一个调用方（`withdraw-workflow.service.ts:269`）。充值注入了 `CustomerAccessService` 但只用于订阅冻结广播；兑换根本没注入。

后果：制裁广播只冻「制裁时已存在的在途单」。制裁**之后**新到的钱建单于广播之后，广播冻不到它，充值域自己也不查限制账 —— 一路正常走到 `COMPLIANCE_PENDING`、跑 KYT、KYT 一过直接 `SUCCESS` 入账。

**被冻的是旧单，制裁后新来的钱照收不误。**

### 3.6 回显

三个详情页现有的 `L1 · Eligibility` 格子读的是 `customer.complianceStatus`（客户级资格），不是限额闸判定 —— 名字被占了。改成显示真实的 L1 判定 JSON。

---

## 4. C · `OPERATION_PENDING → RETURNING`

运营在 `OPERATION_PENDING` 看到「客户账户已暂停」这个挂起原因时，现有出边只有 `approve→SUCCESS`（不该放行）、`confiscate_start`（太重）、`freeze`（太重）—— **没有退回汇款人这条路**。

加一条边，按钮放 action 栏，**走 MLRO maker-checker 审批案**（不是直推）。

两处守卫要放宽：`initiateReturn()` 与 `onReturnApproved()` 现在都写死只收 `MANUAL_CHECKING`。

---

## 5. D · 前端统一化

### 5.1 状态渲染现在是三套

```
充值   depositStatusMap  + DEPOSIT_STATUS_FILTERS  + AdminBadge
提现   withdrawStatusMap + WITHDRAW_STATUS_FILTERS （不用 AdminBadge）
兑换   StatusPill 通用兜底 —— 无映射表、无状态筛选分组
```

硬证据：`StatusPill.tsx:45` 给 `FROZEN` 上的是 `bg-cyan-100 text-cyan-800`（青），而充值/提现映射表给 `FROZEN` 的是 `RED`。**同一个状态，兑换页青色、另两域红色。**

### 5.2 详情页卡片名各叫各的

| 充值 / 提现 | 兑换 |
|---|---|
| `Linked Funds Orders` | `Settlement Legs` |
| `Sumsub Transaction Detail` | `Sumsub Detail` |
| `Ops / Payout Disposition` | `Customer Disposition` |
| `Transaction Details` | `Conversion` + `Pricing` + `Technical` |
| `Frozen Disposition` | **无** —— 全页 `FROZEN` 出现 0 次 |

第二批给兑换加了真实的 `FROZEN` 状态，前端没跟上。

### 5.3 兑换详情页三处假信息 + 一个死按钮

| 位置 | 问题 |
|---|---|
| `SwapTransactionDetail.tsx:326` | `Restrictions` 读 `data.customer.restrictions` —— `CustomerMain` 上**无此列**（限制早已搬到 `customer_restrictions` 表）→ `JSON.parse(undefined \|\| '[]')` → 恒 `None` |
| `:743` | `Pending Action` 读 `pendingActionExternalId` —— 同样无此列 → 恒 `—` |
| `:128` / `:880` | `rejectReason` 声明了类型、注释自称「裸列在 Hero/侧栏」、**全页零渲染** |
| `:847-857` | `Resume Leg` 按钮，判据 `status === 'NEEDS_REVIEW'` —— `FundsOrderStatus` 枚举无此值，永远点不出来 |

前两条最伤：演制裁场景时刚说完「这个客户已被冻结」，侧栏写着 `Restrictions: None`。

**Resume 按钮直接删**（业主：兑换单不该有 resume；所有 needsReview 一律不给修复按钮）。后端 `resumeLeg` 端点保留，只摘 UI 入口。

### 5.4 客户端缺兑换详情页

```
Deposit.tsx  1163行   DepositDetail.tsx  177行   /deposit/:depositNo    ✅
Withdraw.tsx 1071行   WithdrawDetail.tsx 166行   /withdraw/:withdrawNo  ✅
Swap.tsx     1078行   SwapDetail.tsx     ❌       /swap/:swapNo         ❌
```

客户端三个 tipping-off 收敛表（`*StatusView.ts`）都在，缺的只是页面。客户点进一笔兑换看不到任何东西 —— 汇率、报价号、成交价在下单弹窗闪一次，提交后不可回溯。

---

## 6. 遗留观察（登记 BACKLOG，不在本批）

- `directionOf()`（`funds-order.service.ts:35`）把提现两条腿都判成 `OUT`，费腿按语义应是 `INTERNAL`。功能无影响 —— `getTransitionMap()` 里 `INTERNAL` 落到的也是 OUT 那张表
- 兑换 `advance` / `resume` 端点缺 `assertAdmin`（安全类，业主单独任务）
