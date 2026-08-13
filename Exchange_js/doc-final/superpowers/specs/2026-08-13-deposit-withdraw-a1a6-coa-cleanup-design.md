# 充值/提现 A1-A6 修复 + COA v2 收口 — 设计稿

Date: 2026-08-13 ｜ Status: 业主已确认，待实施

---

## 0. 背景

2026-08-12 对充值/提现全流程做了一轮对抗式代码审查（9 维并行 → 去重 → 双视角对抗核验，20 条存活）。
业主按 **demo 系统** 标准重新分拣，判定：

- **安全类问题不处理**（权限守卫 fail-open、越权读、tipping-off 泄露、后端零余额校验）——本轮明确 park
- **功能类硬伤处理**——即 A1-A6 六条 + freeze 边缺口

同期业主重构了科目表（COA v2，2026-08-13，`d675db05`→`a1091f5f` 八个 commit）：
`202 FIRM_FEE` / `203 FIRM_LIQ` / `204 FIRM_SEIZED` 退役，新增收入三户
`210 INCOME_SWAP_FEE` / `211 INCOME_WITHDRAW_FEE` / `212 INCOME_OTHER`。

本设计把两件事合成一轮收口。

## 1. 判据（本轮所有取舍的底层逻辑）

**判据一 · demo 标准**：这是给开发看"系统怎么跑"的示意系统，不是生产资产。
→ **改代码 ✅，建机制 ❌**。为"防止未来漂移"投入的工程收益接近零（真上生产时开发会重写）。
→ 明确否决：状态机三态返回 + 忽略表、全局动作机制（`GLOBAL_ACTIONS`）、完备性守则测试（210 组合断言）、扫源码的元测试。

**判据二 · 钱在哪，决定能不能冻**（否决"每个非终态都能进 FROZEN"）：

| 钱的位置 | 状态 | 处理 |
|---|---|---|
| 还没进来 | 充值 `PAYIN_PENDING` | **不给 freeze 边** — 冻了 `DEPOSIT_SUSPENSE` 是空的，下游 `seize` 反冲空账户走不通 |
| 躺在暂扣/pending 锁里 | 充值 `OPERATION_PENDING`、提现 `PENDING_APPROVAL` | **补 freeze 边** — 真缺口 |
| 正在被处置腿搬运 | 充值 `CONFISCATING/RETURNING/SEIZING` | **不给边，改忽略** — 要冻得先 void 锁；业主已定"处置与冻结不互相打断" |
| 已经出门 | 提现 `PAYOUT_PENDING` | **不给边** — 冻不回来；现状（审计 + `markNeedsReview`）已正确 |

**判据三 · demo 数据随时 reset**：不做历史数据兼容、不写 backfill、删除所有过渡兼容层。

## 2. 范围

### ① COA v2 收口 — 仅剩命名债

科目切换**已完成**（本轮核实）：四处注册清单（`asset-provisioning.service.ts:37-39` / `asset-activation-workflow.service.ts:141-143` / `tb-manual-account.service.ts:29-31`）、对账恒等式（`wallet-recon-run.service.ts:531-533`）、三域记账（充值 `INCOME_OTHER`、提现 `INCOME_WITHDRAW_FEE`、兑换 `INCOME_SWAP_FEE`）全部到位。

剩余为命名债：

| 位置 | 现状 | 目标 |
|---|---|---|
| `TB_TRANSFER_CODES.DEPOSIT_CONFISCATE_FIRM_FEE`(4) | 名字带 FIRM_FEE | `DEPOSIT_CONFISCATE_INCOME_OTHER` |
| eventCode `'CONFISCATE_FIRM_FEE'` | 同上 | `'CONFISCATE_INCOME_OTHER'` |
| 转移码 16 / 36 注释 | `CR FIRM_FEE` | `CR INCOME_WITHDRAW_FEE` / `CR INCOME_SWAP_FEE` |

> ⚠️ **成对约束**：eventCode 进 `deterministicTransferId('DEPOSIT', depositNo, <eventCode>, 1)` 参与 pending ID 哈希。
> `startConfiscation()`（下锁）与 `settleConfiscation()`（结算，`pend2`）**必须同时改**，改一处则 post 找不到 pending。

### ② 删兼容层（判据三）

| 文件 | 删什么 |
|---|---|
| `tb-account-codes.constant.ts` | `RETIRED_TB_CODES`、`RETIRED_TB_CODE_TO_COA` |
| `tb-transfer-codes.constant.ts` | `COA_V2_INCOME_RECLASS`(71) — 仅迁移脚本使用 |
| `wallet-balance-checker.service.ts` | `FIRM_CODES` 里的裸数字 `202, 203` |
| `wallet-flow-matcher.service.ts` | `OWNED_CODES` 里的裸数字 `202, 203` |
| `scripts/verify-realtime-coa.ts` | 三条 retired 断言 |
| `scripts/migrate-coa-v2.ts` + `package.json` | 整个脚本 + `migrate:coa-v2` 条目 |

**保留**：`tb-account-codes.constant.spec.ts` 的"死名单"断言（`FIRM_FEE/FIRM_LIQ/FIRM_SEIZED` 不得回到主表）——防回归闸，与历史数据无关。

### ③ A1-A6

**A1 · 没收腿失败无分支**
`onConfiscationLegChanged()` 现为 `if (newStatus !== CONFIRMED) return`，失败/超时信号掉地上 → deposit 永停 `CONFISCATING`，两笔 pending 锁永不释放，四条恢复路径全堵。
- 改成 switch（结构照抄 `onReturnLegChanged`）
- 新增 `onConfiscationLegFailed()`：**void 两腿 pending → deposit 退回 `OPERATION_PENDING` → 落审计**
- **不做重建重试**（没收腿 `deterministicTransferId` 第 4 参写死常量 `1`，非 `attempt`，抄不了退回的三级梯；且 demo 口径下"回到待处置、运营重点一次"更好演）
- 需补转移边：`CONFISCATING --confiscate_failed--> OPERATION_PENDING`
- **前端红按钮保留**（决策点 2）：后端修好后，`⚡失败`/`⚡超时` 变成可演示的异常弧素材，不过滤

**A2 · 退回指令被吞**
`applyKytRejected()` 的 `RETURN_TO_SENDER` 分支直接调 `initiateReturn()`，而退回只能从 `MANUAL_CHECKING` 发起 → 单子在 `COMPLIANCE_PENDING`（最自然的状态）时抛错进死信，界面无反应。
- 加着陆垫，逐字抄 `withdraw-workflow.service.ts:2586-2600`：状态不在 `MANUAL_CHECKING` → 先 `KYT_REJECTED` 落到 `MANUAL_CHECKING`，tag 写进 reason 供合规官重驱。

**A3 · 推单抢跑**
`push-order.service.ts` 的 `HAPPY_ACTIONS` 含 `CLEAR`，推单一口气推到 `CLEARED`，跳过 `onFeeLegConfirmed` 的结算（其防重入判据是"状态不是 CONFIRMED = 别人结算过了"）。
- 删掉 `FundsOrderAction.CLEAR`（一行）。`CLEAR` 是记账后的产物，归 workflow。

**A4 · 提现不复查客户合规**
`withdraw-transactions.service.ts:1001 getOwnerComplianceStatus()` 是孤儿方法，零调用方。
- 三处调用 + 命中 `ABNORMAL_COMPLIANCE = {FROZEN, SUSPENDED, BLOCKED, REJECTED}`（抄 `deposit-workflow.service.ts:64`）即 freeze：

| 调用点 | 当时状态 | freeze 边 |
|---|---|---|
| `handleWithdrawalCreated` | COMPLIANCE_PENDING | 已有 |
| `onLargeValueApprovalDecided` | `PENDING_APPROVAL` | **依赖 ④** |
| `initiatePayoutPhase` | COMPLIANCE_PENDING / ACTION_PENDING / MANUAL_CHECKING | 已有 |

**A5 · 处置中收到迟到裁决先覆写证据再报错**
充值 `KYT_VERDICT_TERMINAL_STATUSES` = `{SUCCESS, FAILED, CONFISCATED, RETURNED, SEIZED}`，漏三个在途处置态。
- 加 `CONFISCATING` / `RETURNING` / `SEIZING`
- 集合已不全是终态 → 改名 `KYT_VERDICT_IGNORED_STATUSES`
- 忽略时**落一条审计**（决策点 3；现为 `logger.debug`）——演示时可指着说"系统收到了、判定不适用、记下来了"
- 提现域无在途处置态，**不改**

**A6 · 终态订单下永久挂活资金单**
- `onBounce()`：把 `updateStatus(RETURN)` 挪到 `advance(FAIL)` **之前**（现为先标费腿失败再翻状态，守卫读到旧状态反而**新建**一条活费腿）
- `onPayoutLegFailed()`（`withdraw-workflow.service.ts:1417`）：解锁后补一句把费腿标 `FAILED`（`onBounce` 有现成写法）

### ④ freeze 补两条边

```
充值 OPERATION_PENDING  + FREEZE → FROZEN      26 边 → 27 边（再加 A1 的 confiscate_failed = 28 边）
提现 PENDING_APPROVAL   + FREEZE → FROZEN      20 边 → 21 边
```

> ⚠️ **连锁反应（必须同批做，否则是新 bug）**：提现 `PENDING_APPROVAL` 被冻后大额审批案仍开着，审批通过会打 `gate_approve`，而 `FROZEN` 无此边 → 抛错。
> `onLargeValueApprovalDecided()` 须先查状态，`FROZEN` 时 no-op + 落审计（与 A5 同类处理）。

两域守则性单测的"总边数断言"同步更新。

### ⑤ verify:coa 负余额断言

`scripts/verify-realtime-coa.ts` 增加：**任何科目余额不得为负**（十几行）。
现有恒等式只比"总数对不对"，对"某客户账户变负"是瞎的。定位为**演示前自检工具**。

## 3. 明确不做

- 模式一（全局动作机制）/ 模式二（三态返回 + 忽略表）/ 模式三（扫源码守则性测试）——判据一否决
- 兑换域状态机（无转移表，`markStatus` 裸写；`FAILED/REVERSED` 死枚举）——另立项，本轮只涉及其科目（已完成）
- 全部安全类问题（权限守卫 fail-open / 越权读 / tipping-off / 零余额校验 / 入金信号泄露单号）——业主明确 park
- `OPERATION_PENDING` 收到迟到 `rejected`/`awaitUser` 仍抛错、`onPayinFailed` 越位不落审计——留 BACKLOG
- 历史数据兼容 / backfill / 双写——判据三否决

## 4. 验收

**硬闸门**：`npx tsc --noEmit`（后端 + admin-web + client-web）0 错 ｜ `npx jest` 净新增失败 0（4 个 wallets 既存失败不计）｜ e2e 全绿

**功能验收**（reset 重铺后逐条走）：
1. 没收流程点 `⚡失败` → deposit 回 `OPERATION_PENDING`、两笔 pending 已 void、审计有记录、可重新发起没收
2. `COMPLIANCE_PENDING` 单点"原路退回"裁决 → 落 `MANUAL_CHECKING`，tag 在 reason 里
3. `demo:in-transit` 后点推单 → 停在 `CONFIRMED`，结算由 workflow 完成，提现最终 `SUCCESS`
4. 客户冻结后，其在途提现（含大额审批中）→ `FROZEN`，审批再通过不抛错
5. 对 `SEIZING` 单点任意裁决 → 证据未被覆写，审计有一条忽略记录
6. 提现退汇/失败后 → 该单下无活资金单
7. `verify:coa` → `ALL INVARIANTS PASS` 且负余额断言生效

**文档同步**：`truth/v4-deposit.md`（状态机边数 + A1/A2/A5 行为）、`truth/v5-withdraw.md`（边数 + A4/A6）、`truth/accounting-coa.md`（命名债清理 + 兼容层删除）、`truth/funds-orders.md`（没收腿失败分支）、`BACKLOG.md`（勾掉已修、保留 park 项）
