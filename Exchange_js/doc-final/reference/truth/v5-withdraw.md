# V5 提现流程 — 当前实现真相

Last Verified: 2026-08-20（核对方式：⑤ 第一批「合规裁决落地」落地后逐条回代码核——`applyKytVerdict()` 改判定先于任何写库动作，新增私有 `decideVerdictLanding(status, verdict)` 返回三档 `'IGNORE' | 'EVIDENCE_ONLY' | 'DISPATCH'`（`PAYOUT_PENDING` 落 `EVIDENCE_ONLY`，是既有 Review Fix 2 行为的显式化，非新行为）；`FROZEN` 一律判 `IGNORE`，新增私有 `recordVerdictIgnored()` 补齐两个此前完全无审计的忽略点（终态忽略、`FROZEN`+`approved` 忽略）；`FROZEN` 态收到 `awaitUser` 裁决不再进入 `applyKytAwaitUser()`——此前该分支会先同步补料清单到子表再 no-op 状态，本轮后子表同步不再发生，业主 2026-08-20 拍板**接受**此信息丢失（详见 §4.6）；§2/§4/§6/§4.6 四处同步改写。本次实跑硬闸：`npx tsc --noEmit -p tsconfig.json` 0 错；`npx jest` 3 suites failed/4 tests failed/1833 passed/1839 total（与本批改动前基线 3 suites failed/4 tests failed/1820 passed 持平，净新失败 0，多出 13 passed 是 Task 1-4 新增单测）；`npx jest --config test/jest-e2e.json kyt-verdict-landing` 4/4 全绿（`test/kyt-verdict-landing.e2e-spec.ts`，Task 5 新建，专用 e2e 库 + 破坏性护栏，零生产代码改动）。前序核对方式见下）

<details><summary>前序 Last Verified 记录</summary>

Last Verified: 2026-08-13（核对方式：④ A1-A6 收口实施后逐符号复核——§2 状态机 20→21 边（新增 `PENDING_APPROVAL --freeze--> FROZEN`）；A4 客户级合规闸补齐：新增 `ABNORMAL_COMPLIANCE` + `assertCustomerComplianceOrFreeze()`，三处接入 `handleWithdrawalCreated` / `onLargeValueApprovalDecided` / `initiatePayoutPhase`（第三处必须早于 `WITHDRAW_COMPLIANCE_PASSED` 审计）——此前 `getOwnerComplianceStatus()` 是零调用方的孤儿方法，提现只在下单那一刻查一次资格；实测订正：`onLargeValueApprovalDecided` 本就有 `status !== PENDING_APPROVAL` 早退，故原设想的"审批通过撞 FROZEN 抛错"连锁并不存在。A6 终态活单两处：`onBounce` 把费腿 `advance(FAIL)` 推迟到 `updateStatus(RETURN)` 之后（否则 `onFeeLegFailed` 的 `PAYOUT_PENDING` 守卫放行、走三级梯重建出一条活费腿）；`onPayoutLegFailed` 补 `advance(FAIL)` 终结费腿。验证：tsc 0 错、jest 1556 pass（新增 2 条 A6 用例含顺序不变量断言）、e2e 43/43、demo:all 8/8；前序核对方式见下）

Last Verified: 2026-08-13（核对方式：COA v2 科目表重构关联体检——第 3 节 TB 记账两处贷方科目描述订正：「公司侧 `FIRM_ASSET→FIRM_FEE`」改「`FIRM_ASSET→INCOME_WITHDRAW_FEE`」，`WITHDRAW_FEE_FIRM`(=16) 结算腿的 `DR FIRM_ASSET/CR FIRM_FEE` 改 `CR INCOME_WITHDRAW_FEE`（转账类型码常量名不变，只切贷方科目），均回代码 `withdraw-workflow.service.ts`/`accounting-coa.md` §1 核实属实。前序核对方式：③ withdraw-action-embed 分支 Task 1-6 落地（补料子表 `withdraw_applicant_actions` + 集合同步 `hasOutstanding` guard、`verification-session` 接口 + `actions` 白名单开口、详情/认证独立页、fixtures 补 ⑩ 多条 action 按钮、e2e 四条收官）——新增第 4.6 节（逐字段 mirror 充值 `v4-deposit.md` §4.6，含一处反向发现：提现 `applyKytAwaitUser()` 有 `FROZEN` no-op 守卫而充值没有，已登记进充值域 BACKLOG）、第 9 节补两条两域并列缺口（admin 子表视图未渲染/snsWebSdk script 未加载）、第 10 节补 Client 详情/认证独立页段落 + 按钮计数 9→10；核对方式：逐符号核对新增子表 service/controller 路由/前端页面与文档描述一致，`test/withdraw-sumsub-scenarios.e2e-spec.ts` 新增四条（补料完整弧/接口不可区分/多条 action 时序/逐条不可区分）实跑 13/13 全绿。② 合并后业主问「truth 是否最新」逐词扫描——查出两处合并尾段 commit 未回同步的漂移并已修正：㊀ 第 10 节 Frozen Disposition 按钮仍写 `Initiate Refund`，实已随业主验收改为 `Reject & Freeze Customer`（b4dc498d，五处文案）；㊁ `needsReview` SUCCESS 结算自动清旗（d1e5251d 终审修复）truth 零提及，已补进第 10 节横幅语义段；其余逐词扫描（已废枚举/preKyt*/mock 端点/admin reject 侧门）均确认为规范历史留痕或已正确记述，状态机 10/13/20 与 `transitions` 逐边核对一致。① 提现域全流转升级 12-task 施工序列（A 状态机重写/B 引擎+七列迁移/C 费腿硬化+RETURNED+L3/D FROZEN 双审批弧/E 前端双端/F e2e 收官）落地后逐符号复核——本文整篇重写，取代 2026-07-16 的旧 12 态版本（`CREATED`/`PENDING_COMPLIANCE`/`UNDER_REVIEW`/`APPROVED`/`HELD`/`CANCELLED` 等旧枚举已随 Task 1 状态机重写整体删除，本文不再提及；新状态机 10 状态/13 动作/20 边逐边核对代码 `withdraw-transactions.service.ts → transitions`；Sumsub 集成从"仅模拟端点"升级为真实单笔提交引擎，逐符号核对 `submitSumsubTxn()`/`applyKytVerdict()`；e2e 收官阶段跑通 `test/withdraw-money-arcs.e2e-spec.ts`(7/7) + `test/withdraw-sumsub-scenarios.e2e-spec.ts`(9/9) 时发现并修复一处真 bug——`onLegCleared()` 的"全部资金单已 CLEARED"判定原样对 `findByParent()` 的全部历史行取 `every()`，费腿重试后老的 FAILED attempt 行永久卡在结果集里，导致任何经历过一次费腿失败重试的提现即使后续成功结算也永远到不了 SUCCESS——已修复为按 legSeq 只取最新 attempt 判定，详见第 5 节）。

</details>

> 本文只描述"现在是什么样"。改代码必须同步本文。计划看 roadmap，欠账看 BACKLOG.md。

---

## 0. 一句话定位

客户提现（crypto + fiat 共用一条工作流 `WithdrawWorkflowService`）：出生即着陆 `COMPLIANCE_PENDING`（大额直接落 `PENDING_APPROVAL`）→ Sumsub KYT 单笔裁决驱动 10 态状态机 → `PAYOUT_PENDING` 两腿（本金+费）并行结算 → `SUCCESS`。制裁/MLRO 冻结（`FROZEN`）只能经双审批弧（解冻/退款）离场。**不**管：内部转账、Cold→Hot 归集（V7）、真实链上广播/银行出金通道（本域只管状态机+记账，不管出账渠道本身）。

## 1. 提现资金单（funds_orders 提现切片）

> 📖 资金单状态机 / 共享执行引擎 → [funds-orders.md](funds-orders.md)。本节只写提现切片。

提现资金单 = `withdrawTransactionId` 非空的 `funds_order`（Payout/InternalFund 已并入）。**一笔提现最多挂两类 funds_order**：`legSeq=1` 是本金 payout 腿（`netAmount`，出生态 `CREATED`，`initiatePayoutPhase()` 在 `PAYOUT_PENDING` 阶段创建，仅此一份，永不重建）；`legSeq=2` 是费腿（仅 `feeAmount>0` 时创建，出生态 `CREATED`），**费腿允许多次重建**——`onFeeLegFailed()` 的三级梯：FAILED 时若 `attempt<3` 就以新 `attempt` 重建同 `legSeq=2` 的新单（`WITHDRAW_FEE_LEG_REBUILT` 审计），`attempt===3` 仍 FAILED 则耗尽停手（`markNeedsReview()` + `WITHDRAW_FEE_SETTLE_STUCK` 审计，withdraw 状态留 `PAYOUT_PENDING`，**不建第 4 次**）。`funds-order.service.ts → directionOf()` 对 `withdrawTransactionId` 非空恒判 `OUT`（两腿共享，不按 legSeq 分叉）。`handleFundsOrderChanged()` 按 `legSeq` 分流：`legSeq===1` 走 `onPayoutLegConfirmed`/`onPayoutLegFailed`；`legSeq===2` 走 `onFeeLegConfirmed`/`onFeeLegFailed`；`CLEARED` 状态（任一 legSeq）统一走 `onLegCleared()` 判断"是否两腿都已 CLEARED"。

- **锚点**：`funds-order-transitions.constant.ts → FIAT_OUT_TRANSITIONS/CRYPTO_OUT_TRANSITIONS`（`directionOf()` 对 withdraw 恒 `OUT`）｜ `withdraw-workflow.service.ts → initiatePayoutPhase()`（两腿创建）/`handleFundsOrderChanged()`（legSeq 分流）/`onFeeLegFailed()`（三级梯）

## 2. 提现订单（WithdrawTransaction）状态机

**10 状态 / 13 动作 / 21 边**（20 边定稿于 `.superpowers/sdd/task-1-brief.md` 2026-08-03；2026-08-13 补 `PENDING_APPROVAL --freeze--> FROZEN` 一条 → 21）。

**10 个状态**：`PENDING_APPROVAL`/`COMPLIANCE_PENDING`/`ACTION_PENDING`/`MANUAL_CHECKING`/`FROZEN`/`PAYOUT_PENDING`/`SUCCESS`/`REJECTED`/`FAILED`/`RETURNED`。**4 个终态**（零出边）：`SUCCESS`/`REJECTED`/`FAILED`/`RETURNED`。

**13 个动作**：`gate_approve`/`reject`/`approve`/`success`/`fail`/`return`/`action_pending`/`kyt_rejected`/`sla_breach`/`freeze`/`reject_refund`/`resume` 共 12 个在转移表里有出边；`require_approval` 是**死枚举**（历史遗留，转移表零引用，代码零调用点，见第 9 节 BACKLOG）。

**21 条边**（`withdraw-transactions.service.ts → transitions`，逐条穷举；同表有一条守则性单测逐边断言防再次漂移）：

> **2026-08-13 新增**：`PENDING_APPROVAL --freeze--> FROZEN` —— 大额审批可挂数天，期间客户被冻（材料到期是定时任务自动触发，无人干预即可发生），此刻客户的钱已在 TB pending 锁里，冻得住也该冻。
> `PAYOUT_PENDING` **刻意不给**：钱已广播上链/发了银行指令，冻不回来——那里保持既有的「只记 `WITHDRAW_POST_BROADCAST_VERDICT` 审计 + `markNeedsReview()`」。

```
PENDING_APPROVAL                              ← 大额闸出生落点（非转移表内的"出生路由"写，见下）
  gate_approve     → COMPLIANCE_PENDING
  reject           → REJECTED

COMPLIANCE_PENDING                             ← 出生态（"出生即着陆"，见下）
  approve          → PAYOUT_PENDING
  action_pending   → ACTION_PENDING
  kyt_rejected     → MANUAL_CHECKING
  sla_breach       → MANUAL_CHECKING
  freeze           → FROZEN

ACTION_PENDING
  approve          → PAYOUT_PENDING
  kyt_rejected     → MANUAL_CHECKING
  freeze           → FROZEN
  sla_breach       → MANUAL_CHECKING

MANUAL_CHECKING
  approve          → PAYOUT_PENDING
  action_pending   → ACTION_PENDING
  freeze           → FROZEN
  reject_refund    → REJECTED

FROZEN                                         ← 双审批弧，唯二合法出口（见第 6 节）
  resume           → COMPLIANCE_PENDING
  reject_refund    → REJECTED

PAYOUT_PENDING
  success          → SUCCESS
  fail             → FAILED
  return           → RETURNED
```

**出生即着陆（Task 2）**：每笔提现在 `createWithdrawal()` 的 `$transaction` 内直接落 `COMPLIANCE_PENDING`（同时建 TB 两笔 pending 锁），不再有独立"CREATED"枚举态。`handleWithdrawalCreated()`（`WITHDRAWAL_CREATED` 事件，fire-and-forget `emit()`）随后估值 AED、判断是否需大额审批：**不需要** → 原地留 `COMPLIANCE_PENDING` 直接 `submitSumsubTxn()`；**需要** → `openApprovalGate()` 开 `WITHDRAW_LARGE_VALUE_APPROVAL`（`SENIOR_MANAGEMENT_OFFICER` 单步 48h）审批案后，`landOnPendingApproval()` **绕过 `updateStatus`/转移表**直写 `PENDING_APPROVAL`（这是唯一的"出生路由"写，转移表故意没有这条边——它不是业务转移，是大额单出生后落点）；批准后 `gate_approve → COMPLIANCE_PENDING` 走正规转移表边，再 `submitSumsubTxn()`。

**`reject_refund` 的两个起点是刻意的**：`MANUAL_CHECKING`（officer 在 Sumsub 侧对一笔已进人工复核的单打 `REJECT_REFUND` 处置 tag，`applyKytRejected()` 直接落地，无需审批——officer 已经在人工复核阶段，判断权已下放）与 `FROZEN`（制裁/MLRO 冻结单只能经 `WITHDRAW_SANCTION_REFUND` 双审批弧的 `onRefundApproved()` 才能走这条边，**同一 tag 若在 FROZEN 态到达会被忽略**（`WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 审计，见第 6 节）——两个起点共享同一目标边，但 `FROZEN` 分支被结构性收紧，绝不允许系统自动打的 tag 单方面解除制裁冻结。

**`applyKytVerdict()` 裁决落地 = 解析 → 判定 → 落地三段（第一批 · 2026-08-19，与充值域镜像、不共享代码）**：私有 `decideVerdictLanding(status, verdict)` 判定必须先于任何写库动作；落地档位**三档**（比充值多一档）：`IGNORE`（终态 `SUCCESS`/`REJECTED`/`FAILED`/`RETURNED` 与 `FROZEN`）｜`EVIDENCE_ONLY`（`PAYOUT_PENDING`）｜`DISPATCH`（其余状态，落进下方四个 verdict 分支）。`IGNORE` 档跳过 `saveSumsubVerdict()`（不写证据）、不推状态，改调私有 `recordVerdictIgnored()` 强制写 `WITHDRAW_KYT_VERDICT_IGNORED` 审计（`requestId` 拼 `randomUUID()`——业主 2026-08-19 拍板：N 次写 N 行，来了几次本身是证据；`.catch` 记 `logger.error` 不再哑吞）——补齐此前**完全无审计**的两个忽略点：终态忽略（改动前只有 `logger.debug`）、`FROZEN`+`approved` 忽略（改动前同样只有 `logger.debug`）。`EVIDENCE_ONLY`/`DISPATCH` 两档都先 `saveSumsubVerdict()` 写证据，前者随后只审计 `WITHDRAW_POST_BROADCAST_VERDICT` + （`rejected` 时）`markNeedsReview()` 即 `return`（钱已广播，四个 verdict 分支都没有合法边），后者才落进 switch。**`FROZEN` 一律判 `IGNORE`**：该状态下没有任何 verdict 能合法推动状态机，出口只走第 6 节双审批弧。**改动前**只有 `approved` 被 `approvedWillNoOpFrozen` 挡住（跳过写回）；`onHold`/`awaitUser`/`rejected` 三种迟到裁决会先执行 `saveSumsubVerdict()` 覆盖既有制裁报文，才被各自私有 handler（`applyKytOnHold`/`applyKytAwaitUser`/`applyKytRejected`）内部早已存在的 FROZEN 分支无声拦下——提现的状态机本身不会像充值那样报错（各 handler 早有防御性判断），但证据已经被覆盖过一次；这正是本轮修复的动因。**`FROZEN` 同样不加进任何“忽略状态集合”**——判定靠 `decideVerdictLanding()` 内独立的 `status===FROZEN` 分支，`KYT_VERDICT_TERMINAL_STATUSES` 集合语义不变（仅 4 个终态）。

- **锚点**：`dto/withdraw-transaction.dto.ts → WithdrawTransactionStatus/WithdrawTransactionAction`（10/13）｜ `withdraw-transactions.service.ts → transitions`（21 边；`assertStatusUpdateSourceAllowed()` 挡 ADMIN_API 直推 `PAYOUT_PENDING`/终态三个）｜ `withdraw-workflow.service.ts → createWithdrawal()`（出生态写 + TB 两笔 pending）/`handleWithdrawalCreated()`/`openApprovalGate()`/`landOnPendingApproval()`（出生路由）｜ `withdraw-transactions.service.spec.ts`（21 边逐条守则性单测）

## 3. Happy Path（crypto/fiat 共用一条工作流，均 ✅ 验证）

`createWithdrawal()`（客户端 `POST /client/withdraw-transactions`，需先 `POST /withdraw-transactions/quotes` 拿报价）→ 地址注册硬校验（见下）→ L1 资格门 + 金额限额门 → TB 两笔 pending 锁（`CLIENT_PAYABLE→CLIENT_ASSET`，net + fee）→ 出生落 `COMPLIANCE_PENDING` → 大额判定（通常不需要）→ `submitSumsubTxn()` 报单笔 Sumsub 交易 → webhook `approved` 裁决 → `initiatePayoutPhase()`（绑源钱包 + 建两腿）→ `PAYOUT_PENDING` → 两腿各自 `CONFIRMED`（外部确认，crypto txHash / fiat 银行到账同一入口）→ POST 记账 + `CLEAR` → 两腿全 `CLEARED` → `assertWithdrawSettled()` 断言完整（fail-closed）→ `SUCCESS`。

- **地址注册硬校验（Task 3）**：`createWithdrawal()` 在建单前查 `withdrawalAddress` 表——crypto 按 `toAddress` 精确匹配 `status='ACTIVE'`（`counterpartyIsVasp` 由命中行的 `addressType==='VASP'` 派生）；fiat 按 `toIban` 精确匹配 `status='ACTIVE' AND addressType='BANK'`。未命中 → 400 `WITHDRAWAL_ADDRESS_NOT_REGISTERED`，**订单不生、quote 不耗**（与 L1/D1 闸门同一原则）。
- **源钱包绑定（R4 不变量，`ensureSourceWalletBound()`）**：`initiatePayoutPhase()` 时才绑定（不在建单时），FIAT 必须是客户自己的 `C_VIBAN` 钱包，CRYPTO 必须是 `C_DEP` 钱包——均 `ownerType=CUSTOMER`；找不到活跃钱包抛 `IllegalSourceWalletError`（400），绝不静默落到平台池钱包（修复历史回归：FIAT 曾误绑 `C_CMA`+`PLATFORM`）。
- **TB 记账**（客户侧统一 `CLIENT_PAYABLE↔CLIENT_ASSET` real-time 1:1，公司侧 `FIRM_ASSET→INCOME_WITHDRAW_FEE`，2026-08-13 COA v2 起取代退役的 `FIRM_FEE`）：
  - 锁定（建单时）：`executePendingTransfer()`，`WITHDRAW_NET_PENDING`(10)/`WITHDRAW_FEE_PENDING`(13)
  - 结算（各腿 CONFIRMED 时）：`postPendingTransfer()`（`WITHDRAW_NET_POST`=11/`WITHDRAW_FEE_POST`=14）+ 费腿另收 `executeTransfer()`（`WITHDRAW_FEE_FIRM`=16，`DR FIRM_ASSET/CR INCOME_WITHDRAW_FEE`）
  - 解锁（拒绝/失败/退款批准）：`releaseLock() → voidPendingTransferBestEffort()`（净额+费两笔一起 void）
- **顺序守卫（Task 6，见第 5 节）**：费腿绝不能先于本金腿结算——若费腿先 `CONFIRMED`，`onFeeLegConfirmed()` 直接 defer（log + return），等本金腿 `CLEARED` 时 `onPayoutLegConfirmed()` 的"回捞"逻辑主动补跑。
- **锚点**：`customer-withdraw.controller.ts → create()`（L1 前置）｜ `withdraw-workflow.service.ts → createWithdrawal()`（地址校验+限额门+TB 锁）/`ensureSourceWalletBound()`（R4）/`initiatePayoutPhase()`（两腿创建）/`onPayoutLegConfirmed()`（回捞）/`onLegCleared()`（终局判定，Task 12 e2e 修复见第 5 节）/`assertWithdrawSettled()`

## 4. Sumsub 单笔提交 + webhook 驱动（Task 3-5，2026-08-03）

一笔提现 → 一笔 Sumsub KYT 交易（direction=`out`），复用充值域已有的 `SUMSUB_TXN_CLIENT` provider + `resolveKytTxnType()` 判定器（**跨域直接复用同一份，不是 fork**——`withdraw-workflow.service.ts` 直接 `import { resolveKytTxnType } from '../../deposit-sumsub/kyt-txn-type.resolver'`）。VARA TR 阈值判定同 §4.5（USDT≥1000/AED≥3500 且 `counterpartyIsVasp===true` → `travelRule`，否则 `finance`）；`SUMSUB_SINGLE_TXN_SUBMIT==='true' || SUMSUB_MOCK_MODE==='true'` 时才用判定结果，否则恒交 `finance`（同一硬前提：合规须先确认 Sumsub 规则 `types` 已挂 `travelRule`）。

- **数据模型（七列，2026-08-03 迁移 `20260804010000_withdraw_sumsub_single_txn`）**：`sumsubTxnId`/`sumsubTxnType`(`finance|travelRule`)/`sumsubVerdict`(`approved|rejected|awaitUser|onHold`)/`sumsubScore`/`sumsubScoredAt`/`sumsubTxnDetailJson`/`counterpartyIsVasp`——与充值 §4.5 收敛后的七列命名逐字一致（**不是**充值早期已废的 `preKyt*`/`kyt*` 双列模型）。
- **提交（`submitSumsubTxn()`，COMPLIANCE_PENDING 入口触发，幂等 on `sumsubTxnId`）**：客户无 `sumsubApplicantId` → warn 后原地留 `COMPLIANCE_PENDING`（不抛、待人工）；整个调用 try/catch 包裹（外部 HTTP 失败绝不能 strand 提现，充值 I2 教训直接应用）；成功后 `WITHDRAW_SUMSUB_SUBMITTED` 审计带 `sumsubTxnId`/`txnType`/判定 `reason`。
- **`WithdrawKytVerdictHandler`（提现专用 fork，与充值 `DepositKytVerdictHandler` 逐字同构但不共用代码）**：webhook type 归一 `KytVerdict`（`applicantKytTxnApproved/Rejected/AwaitingUser` + `applicantKytOnHold`）；`rejected`/`awaitUser` 才读 `typedTags`——场景 tag `SANCTION`/`PEP`（`SCENE_TAGS`），处置 tag `FROZEN_BY_MLRO`/`REJECT_REFUND`（`DISPO_TAGS`，**与充值的 `RETURN_TO_SENDER` 不同**——提现没有"退回发件人"语义，官方处置统一叫"退款"）；按 `sumsubTxnId`（即 webhook 的 `kytTxnId`）反查 withdraw，找不到 → warn "orphan"，不崩。
- **`applyKytVerdict()` 四分支转移表**（详见第 2 节状态机）：

| verdict | 场景/处置 tag | 目标动作 | 备注 |
|---|---|---|---|
| `approved` | — | `approve` | `MANUAL_CHECKING` 额外记 `WITHDRAW_MANUAL_APPROVED`（翻案）；`FROZEN` 收到直接 no-op（跳过写回/存证） |
| `awaitUser` | 无 tag | `action_pending`，`manualReason='CLIENT_ACTION'` | 幂等 on 已 `ACTION_PENDING`；`FROZEN` no-op |
| `awaitUser` | `PEP` | `action_pending`，`manualReason='EDD_PEP'` | 同上 |
| `onHold` | — | 非转移边，只刷 `slaDeadline`（+7d）+ 审计 `WITHDRAW_ONHOLD` | 仅 `COMPLIANCE_PENDING` 时生效，其余状态 no-op |
| `rejected` | `SANCTION` 或 `FROZEN_BY_MLRO` | `freeze` | 免审批，收紧方向；已 `FROZEN` 幂等 no-op |
| `rejected` | `REJECT_REFUND` | `reject_refund`（仅 `MANUAL_CHECKING`）| `FROZEN` 收到**忽略**（`WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED`，见第 2/6 节）；其余状态落地为 `kyt_rejected`（"退款 tag 早到，先进人工复核待重打"） |
| `rejected` | 无 tag | `kyt_rejected` | → `MANUAL_CHECKING`；已在此态幂等 no-op；`FROZEN` no-op |

  > 上表各行标的 `FROZEN` no-op/忽略，是这四个 verdict 分支各自原有的防御性判断（改动前就存在，见各私有 handler）。**第一批 · 2026-08-19 起，`FROZEN` 态的所有裁决在 `decideVerdictLanding()` 这一步就已判 `IGNORE`，根本不会落进本表这四个分支**——分支内部原有的 FROZEN 专属处理（除写 `WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 那支外）在 webhook 路径上已成死码，未删，登记 BACKLOG。上表按分支列出的最终行为（"FROZEN 下这条裁决不生效"）仍然成立，只是判定时机提前到了入口处，且统一落地为一条 `WITHDRAW_KYT_VERDICT_IGNORED` 审计，不再是分支各自的审计/无审计。

- **SLA 定时器（`WithdrawSlaService`，mirror of `DepositSlaService`）**：`@Cron('*/5 * * * *', {timeZone:'Asia/Dubai'})` 扫 `COMPLIANCE_PENDING`/`ACTION_PENDING` 且 `slaDeadline<now && slaBreached=false` 的行，驱动 `sla_breach → MANUAL_CHECKING` + 落 `slaBreached=true`。`onHold`/`awaitUser` 的 SLA 窗口均 7 天（`ONHOLD_SLA_DAYS`/`ACTION_SLA_DAYS` 常量）。
- **L3 归档（`archivePostKyt()`，crypto-only，fire-and-forget）**：`SUCCESS` 落地后把链上 `txHash` PATCH 回 Sumsub KYT 交易（`sumsubTxnClient.archiveTxHash()`），供未来交易追溯；无 `sumsubTxnId`/`txHash` 则跳过 + warn。
- **锚点**：`withdraw-workflow.service.ts → submitSumsubTxn()`/`applyKytVerdict()`/`applyKytApproved()`/`applyKytAwaitUser()`/`applyKytOnHold()`/`applyKytRejected()`/`archivePostKyt()` ｜ `withdraw-kyt-verdict.handler.ts`（`VERDICT_BY_TYPE`/`SCENE_TAGS`/`DISPO_TAGS`）｜ `withdraw-sla.service.ts` ｜ `withdraw-webhook.router.ts`（前置分流，命中即返回 `true`，两域路由不重叠）｜ `deposit-sumsub/kyt-txn-type.resolver.ts → resolveKytTxnType()`（跨域共享，非 fork）

### 4.6 补料 Embed（多条 applicant action，独立页提交材料，2026-08-07 落地，spec `2026-08-07-withdraw-action-embed-design.md` + 实施计划 `.superpowers/sdd/task-{1..6}-brief.md`，逐字段 mirror of §4.6 充值版 `truth/v4-deposit.md`——差异只在下面点名的几处；⚠️ **本节描述的存储层已废，见下方订正段**）

> **2026-08-18 订正**：与充值域同一次迁移（`20260817020000_drop_legacy_action_stores`）——子表 `withdraw_applicant_actions` 与提现单顶层 `actionSubmittedAt` 缓存已物理删除，applicant action 统一收进 `material_requests`（`orderDomain='WITHDRAW'`/`orderRef=withdrawNo`），行为与充值域订正段完全一致（挂限制的行终态时只解绑、未挂的直接 `CANCELLED`；`REVIEW_RED` 拆 `RETRY`/`FINAL`）。详见 `truth/v4-deposit.md` §4.6 订正段与设计稿 `doc-final/superpowers/specs/2026-08-17-material-request-ledger-design.md`。

**一笔提现单可以同时挂多条** Sumsub applicant action——子表 `withdraw_applicant_actions`（Prisma model `WithdrawApplicantAction`，与充值 `deposit_applicant_actions` 逐列同构）每条一行，各自带独立的 `submittedAt`；提现单上的 `actionSubmittedAt` 字段语义与充值同款——**「全部交齐的时刻」缓存**，不是"这条交了没"。**状态机不因客户提交而改变**——`ACTION_PENDING` 仍是 `ACTION_PENDING`，直到裁决（自动重评或人工翻案）才流转；提交动作只影响子表行 + 顶层缓存 + SLA 表。**客户端从头到尾拿不到 action id**（`applicantActionId`/`externalActionId` 均不下发）——对外一律用 `seq` 定位一条 action，服务端自己按 `withdrawId+seq` 查表换真 id 去铸 token，与充值同一条防线（充值上一轮的 Critical：demo fixture 的 id `aa-edd-0002` 里 `edd` 三个字母直接暴露 PEP 判定）。

- **子表同步（`WithdrawApplicantActionsService.syncApplicantActions()`，`withdraw-workflow.service.ts → applyKytAwaitUser()` 调用）**：逐字段与充值 `DepositApplicantActionsService` 同构——报文 `applicantActions[]` **全量列表**（非增量）与本地子表集合比对（新增追加/完全一致 no-op/库内有报文无则删未提交行），`seq` 一旦分配不再变（进 URL），空 `externalActionId` 入库前丢弃，整体包 `$transaction` + `P2002` 竞态重读兜底。若单子已在 `ACTION_PENDING`：集合有变化清「全部交齐」缓存 + 重置 SLA 表（`clearWithdrawCache()`）+ 记 `WITHDRAW_ACTION_REISSUED` 审计；集合不变则真 no-op；同步后零未提交行（报文缺 `applicantActions`、全部缺 `externalActionId`、或撤回撤成空集）→ 不清缓存/不推进，只记 `WITHDRAW_AWAITUSER_EMPTY_ACTIONS` 警告审计（`hasOutstanding()` guard，与充值 `DepositApplicantActionsService.hasOutstanding()` 同一判据、同一组 I1/I2 注释）。跨状态弧（如 `MANUAL_CHECKING → ACTION_PENDING`）同样清这两个字段。
  - **`FROZEN` 态曾有的语义差异，第一批 · 2026-08-19 起两域收敛（提现侧信息丢失，业主已拍板接受）**：**改动前**提现 `applyKytAwaitUser()` 在 FROZEN 分支会先把补料清单同步进子表、再 no-op 状态转移（"无论状态动不动都同步"）；充值同一位置则无此守卫，会直接撞上转移表抛 `Invalid action 'action_pending'`（充值 `FROZEN` 只有 `resume`/`seize` 两条出边）——两域行为不同构，此前本节记为"与充值域唯一的语义差异（提现侧更严）"。**改动后**：`decideVerdictLanding()`（充值/提现各自私有实现，不共享代码）在两域都对 `FROZEN` 一律判 `IGNORE`，**任何 verdict（含 `awaitUser`）都不再进入 `applyKytAwaitUser()`**——提现原有的"FROZEN 时仍同步子表"这一步随之**不再发生**（`applyKytAwaitUser()` 内那段 FROZEN 分支连同其子表同步调用已成 webhook 路径死码，代码未删，登记 BACKLOG）；充值一侧则是从"会抛错"变成"安全忽略"，是纯粹的修复，没有行为丢失。**提现这一侧因此产生一处业主已拍板接受的信息丢失**：已被制裁冻结的提现若事后收到带补料要求的 `awaitUser` 裁决，系统无法再留下"Sumsub 当时要求了哪些材料"的记录（子表无新行，落地的只有通用 `WITHDRAW_KYT_VERDICT_IGNORED` 审计，`metadata` 仅含 `{withdrawNo,verdict,status,riskScore}`，不含补料清单）。业主 2026-08-20 拍板接受：客户已冻结，出路是走解冻审批而非补料；反之保留同步会给被调查客户开出一个可见的补料入口，构成 tipping-off 风险——**已决策项，后续重构不得"修复"回去**。两域现已收敛为**同一行为**（FROZEN 一律忽略），不再有"提现侧更严"这个差异。已登记 BACKLOG「技术债 — V5 提现」节。

- **客户面详情页（`WithdrawDetail.tsx`，独立页 `/withdraw/:withdrawNo`，与列表同级、不是弹窗，Task 4 落地）**：`Outstanding verification` 卡片**仅当** `status.toUpperCase()==='ACTION_PENDING'` **且** `actions.length > 0` 时渲染（状态就是状态，按钮归按钮，无"是否有未提交项"的二次短路，逐字 mirror 充值 2026-08-06 二次定稿）。卡片内逐条列出 `actions` 数组（`{seq, submittedAt}`），文案统一 `Document request {seq}`；每张卡的「Provide documents」按钮恒渲染，只按这一条自己的 `submittedAt` 决定是否 `disabled`。未禁用时 `navigate` 到 `/withdraw/${withdrawNo}/verification/${seq}`——每条 action 是独立页面/独立 URL。

- **客户面认证独立页（`WithdrawVerification.tsx`，路由 `/withdraw/:withdrawNo/verification/:seq`，Task 5 落地）**：四态互斥渲染（`submitted` 静态文案 / `state==='error'` 重试按钮 / `state==='loading'&&simulation` 加载态 / 其余渲染 demo `MockUploader` 或真接 `#sumsub-container`），提交/token 刷新/`idCheck.onApplicantSubmitted` 事件监听均与充值 `DepositVerification.tsx` 逐字段同构。demo/真接分流判据同为 `useSimulationMode()`。

- **接口契约（`customer-withdraw.controller.ts:61-91` → `WithdrawVerificationSessionService`，客户面，`client/withdraw-transactions/my/:withdrawNo/verification-session/:seq` 前缀，走既有 JWT 客户鉴权，Task 3 落地）**：路由声明顺序同款讲究——带 `:seq` 的两条必须写在更短的 `my/:withdrawNo` 之前。
  - `GET my/:withdrawNo/verification-session/:seq` → `getSession(customerId, withdrawNo, seq)`：`mustFindOwn()`（`where:{withdrawNo, ownerId}`——**无 `limitHoldReason` 过滤**，提现没有 below-min 隐藏单，这是与充值 `mustFindOwn` 唯一的判据差异，见 `withdraw-verification-session.service.ts` 文件头注释）→ `applicantActions.findBySeq(withdrawId, seq)` 换真行（查不到 → 与"单子不存在"相同的 404）。**响应体只由这一条 action 自己的 `submittedAt` 决定，绝不查提现单 `status`**：已提交 → `{submitted:true, sdkToken:null}`；未提交但客户尚无 `sumsubApplicantId` → `{submitted:false, sdkToken:null}`；未提交且有 applicant → `sumsubClient.createActionSdkToken({applicantId, levelName:SUMSUB_ACTION_LEVEL, externalActionId})` 铸一次性 token。响应体只有 `submitted`/`sdkToken` 两个键。
  - `POST my/:withdrawNo/verification-session/:seq/submit` → `submit(customerId, withdrawNo, seq)`：幂等、恒 `{ok:true}`，**不碰状态机**。`submitBySeq()` 用 `updateMany({where:{withdrawTransactionId, seq, submittedAt:null}})` 幂等盖 `submittedAt`，再数 `count({submittedAt:null})`：仍有未提交 → 缓存不动；`outstanding===0` → 才盖 `actionSubmittedAt=now()`（唯一发生点）。`resetSla = status==='ACTION_PENDING' && !slaBreached` 时才重置 `slaDeadline`（`PROVIDER_REVIEW_SLA_DAYS=7`，与充值同数字）。审计 `WITHDRAW_ACTION_SUBMITTED` 只在真正落库那次记，metadata 带真 `actionId`（operator 面）+`allSubmitted`。
  - **接口不可区分**（`test/withdraw-sumsub-scenarios.e2e-spec.ts` 覆盖两条：单条 action「接口不可区分：已提交的单，ACTION_PENDING 与 FROZEN 的会话响应体全等」+ 多条 action「逐条不可区分：同一条 action 在 ACTION_PENDING 与 FROZEN 下会话响应体全等」，本轮 Task 6 新增，用 `V4_REJECTED_SANCTION` 裁决把提现单打成 `FROZEN` 而非独立的 `adminFreeze()` 端点——提现没有充值那种 `PATCH :id/status {action:'freeze'}` 侧门，`FREEZE` 只经 KYT 裁决弧到达，`ACTION_PENDING --freeze--> FROZEN` 边见第 2 节转移表）：任一 seq 的 `GET verification-session/:seq`，在 `ACTION_PENDING` 与被冻成 `FROZEN` 之后返回逐字段全等的响应体。

- **客户面白名单开一个口子：`actions`**（`toCustomerWithdrawView()`，`withdraw-transactions.service.ts`）：`(item.applicantActions ?? []).map(a => ({seq:a.seq, submittedAt:a.submittedAt}))`——只有 `seq`/`submittedAt` 两个键。**提现白名单从未开过顶层 `actionSubmittedAt` 口子**（与充值不同——充值曾经开过又在 2026-08-06 定稿减法删除，提现的 Embed 从 Task 1 就是"状态就是状态"的终态设计，没有充值那段"开了又收"的历史，见本节代码注释"只有这两个键"）。
  - ⚠️ **本条白名单成立的前提在提现域未满足**——充值域 `toCustomerDepositView()` 的 `status`/`completedAt` 已收敛为 `CUSTOMER_STATUS_PASSTHROUGH` 白名单（第 10 节详述），提现域 `toCustomerWithdrawView()` 仍原样下发真实 `status`（含 `FROZEN`），`findAllForCustomer()` 的 `status` 查询参数也未做 customerScope 忽略——这是第 10 节已登记的规则 A 缺口，`actions` 白名单本身干净，但同一响应体里的 `status` 字段仍会泄露执法态，两者共同决定"客户能否从这条单子的响应体推断自己被冻结"。

- **demo 假上传（`WithdrawVerification.tsx` 内 `MockUploader`，`useSimulationMode()` 门控）**：不真收文件，点 Submit 直接调 submit 端点，成功后 `goBack()`（mirrors 充值最终态，均已是独立页设计，从未走过 `postMessage`/`/mock-verification` 那条已废的桥接协议——提现的补料 Embed 从 Task 4/5 落地起就是独立页 + 直接调用同一份服务，没有充值那段"先弹窗+postMessage、后改独立页"的历史包袱）。

- **admin 详情页（`WithdrawTransactionDetail.tsx`）**：Sumsub Transaction Detail 卡展示 `sumsubDetail.applicantActionIds`（复数，原始报文解析出的 id 列表）。**提现从未有过充值那种"死字段"历史**——子表模型是 Task 1（全流转升级）就直接落地的地基，`WithdrawTransaction` 上从未存在过 `sumsubActionId`/`sumsubExternalActionId` 这类会被子表淘汰的单值列，故没有"死字段待删"这一项缺口。但**与充值同款的缺口仍在**：admin 尚未渲染子表本身——没有逐条 `seq`/`submittedAt` 的视图，运营看不到"客户交了第几条、还差第几条"，已登记 BACKLOG（与充值那条并列同一处）。

- **已知缺口（未修，详见 BACKLOG.md「技术债 — V5 提现」节，逐条列出处、原因、来源标注）**：`WithdrawApplicantAction` 的 `@@index`/`@@unique` 同列冗余（与充值 `DepositApplicantAction` 同款问题，逐字复制而来）｜ 真接 Sumsub 分支不可执行（`WithdrawVerification.tsx` 同样读 `window.snsWebSdk`，全仓无该 CDN 脚本加载，与充值域同一处缺口，两域一并补）｜ action 人话标签只有序号（同充值口径，业主定稿不按前缀猜类型）｜ admin 详情页未渲染子表逐条视图（见上一条，与充值并列）｜ `sumsub-txn-client.mock.ts`/`sumsub-txn-client.http.ts` 的 `applicantActions` 数组映射逻辑两处手写重复（域无关，两域共享同一对 client 实现，充值 BACKLOG 已登记的条目同样覆盖提现调用路径）。**充值域独有、提现域不适用的缺口**：充值 `applyKytAwaitUser()` 缺 `FROZEN` 态 no-op 守卫（提现有，见上方"与充值域唯一的语义差异"条，已反向登记进充值 BACKLOG）。
- **锚点**：`withdraw-applicant-actions.service.ts`（`syncApplicantActions()`/`findBySeq()`/`submitBySeq()`/`hasOutstanding()`/`clearWithdrawCache()`）｜ `withdraw-verification-session.service.ts`（`VerificationSessionView`/`getSession()`/`submit()`）｜ `customer-withdraw.controller.ts:61-91`（`my/:withdrawNo/verification-session/:seq` 两条 + `my/:withdrawNo` 一条）｜ `withdraw-workflow.service.ts → applyKytAwaitUser()`（集合同步 + FROZEN 守卫 + 同状态重入清缓存）｜ `client-web/src/pages/WithdrawDetail.tsx`（`Outstanding verification` 显隐 + 逐条渲染）｜ `client-web/src/pages/WithdrawVerification.tsx`（四态渲染、`MockUploader`、真接 `snsWebSdk` 接线）｜ `client-web/src/utils/withdrawStatusView.ts`（纯 `status` 查表）｜ `withdraw-transactions.service.ts`（`toCustomerWithdrawView()` 的 `actions` 白名单开口、`findOneForCustomerByWithdrawNo()`）｜ `admin-web/src/pages/WithdrawTransactionDetail.tsx`（`applicantActionIds` 展示，未渲染子表）｜ `test/withdraw-sumsub-scenarios.e2e-spec.ts`（单条 action 的补料完整弧 + 接口不可区分两条，多条 action 的全部交齐时序 + 逐条不可区分两条，共四条覆盖本节，Task 6 新增）｜ `prisma/schema.prisma`（`WithdrawApplicantAction` model、`WithdrawTransaction.applicantActions` 关系）

## 5. 资金腿记账（顺序守卫 + 三级梯 + bounce，Task 6-7）

**顺序守卫**：本金腿（legSeq=1）必须先于费腿（legSeq=2）结算——`onFeeLegConfirmed()` 开头查本金腿状态，非 `CONFIRMED`/`CLEARED` 就 defer（log + return，不 throw，费腿留 `CONFIRMED` 原地等）；本金腿的 `onPayoutLegConfirmed()` 在自己 POST+CLEAR 之后主动"回捞"——若费腿已经 `CONFIRMED`（先到但被 defer），立即代为调用 `onFeeLegConfirmed()`，避免深埋的费腿永远等不到重新触发。并发再入守卫：`onFeeLegConfirmed()` 结算体内二次读费腿当前状态，非 `CONFIRMED`（已被并发赢家结算/已终态）直接幂等跳过。

**费腿失败三级梯**（`onFeeLegFailed()`，`MAX_FEE_LEG_ATTEMPTS=3`）：
```
attempt 1 FAILED → 重建 attempt 2（WITHDRAW_FEE_LEG_REBUILT），withdraw 留 PAYOUT_PENDING
attempt 2 FAILED → 重建 attempt 3（WITHDRAW_FEE_LEG_REBUILT），withdraw 留 PAYOUT_PENDING
attempt 3 FAILED → 耗尽：markNeedsReview() + WITHDRAW_FEE_SETTLE_STUCK 审计，withdraw 留 PAYOUT_PENDING（不建 attempt 4，无自动重触发出口——见第 9 节 BACKLOG）
```
本金腿从不重建——`onPayoutLegFailed()` 一失败直接 withdraw `FAIL`（终态）+ `releaseLock()`（P6 修复：净额+费两笔 TB pending 一起 void，客户余额完整恢复）。

**费腿"结算失败"（TB 侧瞬时故障，与上面的"FAILED 状态"三级梯是两回事）**：`onFeeLegConfirmed()` 结算体（POST + 公司侧收费 + CLEAR）整体 try/catch——TB 瞬时故障 → `incrementFeeSettleAttempts()`，<3 次静默 return（费腿留 `CONFIRMED`，等下次重投/人工 re-advance 重试）；第 3 次同样 `markNeedsReview()` + `WITHDRAW_FEE_SETTLE_STUCK`，**费腿的 `funds_order.status` 永久停在 `CONFIRMED`**（不同于上面的"FAILED 三级梯"会重建新 attempt——这条路径从未真正 FAIL 过，只是反复来 TB 报错，视图上会显得"费腿一直在 CONFIRMED 从未推进"，见第 9 节 BACKLOG）。

**Task 12 e2e 修复：`onLegCleared()` 的"全部已 CLEARED"判定** ——原判定对 `findByParent({withdrawTransactionId},{})` 返回的**全部历史行**取 `every(status===CLEARED)`；费腿一旦经历过失败重建（FAILED 的老 attempt 行永久留存作历史），这些老 FAILED 行会被永远算进这次 `every()` 里，导致哪怕后续新 attempt 真的结算成功，判定也永远 `false`——**任何经历过一次费腿失败重试的提现，即使本金和最新费腿都已 CLEARED，也永远到不了 SUCCESS**。修复：按 `legSeq` 分组只取每组最新 `attempt` 判定（mirror `onPayoutLegConfirmed()` 回捞逻辑已有的 `feeLegs[feeLegs.length-1]` 取最新写法）。`test/withdraw-money-arcs.e2e-spec.ts` 场景 3（费腿 FAILED×3→STUCK→修复重跑→SUCCESS）实测踩中并验证修复。

**Bounce（退汇，Task 7，`onBounce()`，仅 admin，`POST :id/bounce`）**：本金腿已 POST（真实钱已出）但银行/链上事后退汇——仅 `PAYOUT_PENDING` 状态 + 已存在 `WITHDRAW_NET_POST` evidence 才可调用（否则 400，未广播的失败走 `FAIL` 而非 bounce）。反向分录 `DR CLIENT_ASSET/CR CLIENT_PAYABLE`（`WITHDRAW_BOUNCE_REENTRY`=17）先落账，再 `RETURN → RETURNED`（**先账后状态**，中途崩溃留 `PAYOUT_PENDING` 可重试而非丢分录）。**费腿处置分两支**（Fix Round 1 review 发现：本金 POST 不代表费腿也 POST——Task 6 顺序守卫下"本金 POST、费腿仍 pending"是常态窗口而非罕见竞态）：费腿已 POST（`WITHDRAW_FEE_POST` evidence 存在）→ `feeDisposition='fee retained (collected)'`，不退（bounce 手续费归公司）；费腿未 POST → 该笔 pending 锁 void（费退回客户可用余额）+ 费 `funds_order` 尽力标 `FAILED`（视图一致性，吞掉状态机报错——TB void 才是真money-path，视图落后不该回滚已完成的钱）。**Fee 恒不退是设计如此**（无论哪个分支，一旦费已 POST 就归公司）。

- **锚点**：`withdraw-workflow.service.ts → onPayoutLegConfirmed()`（回捞）/`onFeeLegConfirmed()`（顺序守卫+并发再入+settle-failure 三级梯）/`onFeeLegFailed()`（FAILED 三级梯）/`onPayoutLegFailed()`（P6 releaseLock）/`onLegCleared()`（Task 12 修复，按 legSeq 取最新 attempt）/`onBounce()`（先账后状态+费腿双支）｜ `withdraw-transactions.controller.ts → bounce()`

## 6. FROZEN 双审批弧（Task 8-9，2026-08-03）

`FROZEN` 只有两条合法出边（第 2 节），均需 V1 maker-checker 单步 `MLRO` 审批（`ApprovalActionTypes.WITHDRAW_UNFREEZE`/`WITHDRAW_SANCTION_REFUND`，48h 超时，`allowCancel:true`）——**发起侧只读+开案，不写 withdraw 表**（Rule 5）；**执行侧**由各自的 `workflow.withdraw-{unfreeze|sanction-refund}.decided` 监听器在 APPROVED 时驱动。

**解冻（`initiateUnfreeze()`/`onUnfreezeApproved()`）**：`orderRef`（解冻令文书号）+ `reason` 必填；防重复开案（同类 PENDING 审批只能有一个）。批准后：**零记账**（钱在 FROZEN 期间从未离开客户的 TB pending 锁，无反向分录）→ `resume → COMPLIANCE_PENDING` → 审计 `WITHDRAW_UNFROZEN`（reason 带 orderRef）→ `triggerUnfreezeRescore()` 触发 Sumsub `rescore(sumsubTxnId)`（try/catch 包裹，外部 HTTP 失败只 warn 不回滚——状态已提交，靠人工/下次 webhook 兜底；`sumsubTxnId` 为空则跳过）。

**退款（`initiateRefund()`/`onRefundApproved()`）**：仅 `reason` 必填（无 orderRef——这是退款处置，不是解除冻结）。批准后：`reject_refund → REJECTED` → `releaseLock()`（P6 原语，净额+费两笔 TB pending 一起 void，客户可用余额完整恢复）→ 审计 `WITHDRAW_SANCTION_REFUNDED`（reason 注明"客户账户层面的升级处置是人工——V2 冻结账户 API 尚未建成，见 BACKLOG"，见第 9 节）。

**制裁证据保护（第一批 · 2026-08-19 起覆盖全部 verdict 类型，非仅 `approved`）**：`applyKytVerdict()` 的私有 `decideVerdictLanding()` 对 `FROZEN` 态一律判 `IGNORE`（见第 2/4 节），不论收到的是 `approved`/`onHold`/`awaitUser`/`rejected` 中的哪一种，**统一跳过**闸门写回+存证（`saveSumsubVerdict()`），只写通用 `WITHDRAW_KYT_VERDICT_IGNORED` 审计——避免一笔已冻结的单被任何一种迟到/重评裁决静默抹去制裁证据。**改动前**只有 `approved` 被 `approvedWillNoOpFrozen` 挡住；`onHold`/`awaitUser`/`rejected` 三种会先执行 `saveSumsubVerdict()` 覆盖既有制裁报文，才被各自私有 handler 内部早已存在的 FROZEN 分支无声拦下——状态机本身不会报错，但证据已被覆盖过一次，这正是本轮修复的动因。`REJECT_REFUND` tag 若在 `FROZEN` 态到达（原本合法处置但为时已晚）**仍被忽略**，必须走这里的双审批弧而非系统自动 tag 单方面解除——但 **审计常量已变**：webhook 路径上如今根本进不了 `applyKytRejected()`（被 `decideVerdictLanding()` 更早拦下），该方法内那段专写 `WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 的 FROZEN 分支已成死码（未删，登记 BACKLOG）；实际落地的是通用 `WITHDRAW_KYT_VERDICT_IGNORED`。

- **锚点**：`withdraw-workflow.service.ts → initiateUnfreeze()/initiateRefund()/onUnfreezeDecided()/onRefundDecided()/onUnfreezeApproved()/onRefundApproved()/triggerUnfreezeRescore()/fetchApprovedOrderRef()` ｜ `withdraw-unfreeze-approval.service.ts`/`withdraw-sanction-refund-approval.service.ts`（V1 处理器）｜ `governance/approvals/constants/approval.constants.ts → ApprovalActionTypes.WITHDRAW_UNFREEZE/WITHDRAW_SANCTION_REFUND`（均单步 MLRO 48h）｜ `withdraw-transactions.controller.ts → unfreeze()/refund()`

## 7. 异常分支现状

| 分支 | 状态 | 转移路径 | 记账 | officer/MLRO 门 |
|---|---|---|---|---|
| ACTION_PENDING 补材料 | ✅ | `awaitUser` 进（`manualReason` 按 tag 区分 CLIENT_ACTION/EDD_PEP）／`approve` 出 | 无需 | — |
| onHold 挂起 | ✅ | 留 `COMPLIANCE_PENDING` 不换态，只刷 `slaDeadline`；SLA 到期转 `MANUAL_CHECKING` | 无需 | ✅ officer 在 Sumsub 侧裁决后发新 webhook |
| FROZEN 制裁/官方冻结 | ✅ | `rejected`(SANCTION tag 或 FROZEN_BY_MLRO tag) → `freeze` 进；出边仅 `resume`/`reject_refund` 两条 | **零记账（设计如此）**：钱留在 TB pending 锁，不反转不释放 | ✅ 双审批弧（第 6 节），无正门可绕 |
| MANUAL_CHECKING 人工复核 | ✅ | `kyt_rejected`(无 tag) 或 `sla_breach` 进；`approve`(翻案记 `WITHDRAW_MANUAL_APPROVED`)/`action_pending`/`freeze`/`reject_refund`(仅此态可直接执行，无需审批) 出 | 翻案批准才记账 | — |
| PAYOUT_PENDING 本金失败 | ✅ | `fail → FAILED`（终态） | ✅ `releaseLock()` 净额+费两笔 void（P6） | — |
| PAYOUT_PENDING 费腿 FAILED | ✅ | 不换 withdraw 态；三级梯重建/耗尽 STUCK（见第 5 节） | 本金腿记账不受影响；费腿耗尽后视图残留（见第 9 节） | ✅ needsReview 供 operator 人工介入 |
| PAYOUT_PENDING 费腿"结算失败"(TB瞬时故障) | ⚠️ | withdraw/费腿状态均不换（费腿卡 `CONFIRMED`），耗尽同样 STUCK | 无自动重试出口（见第 9 节） | ✅ needsReview |
| Bounce 退汇 | ✅ | `PAYOUT_PENDING --return--> RETURNED`（仅本金已 POST 才可调用） | ✅ 反向分录先账后状态；费腿按已/未 POST 分支处置（第 5 节） | ✅ admin 专用端点，非状态机自动 |
| SUCCESS 后退汇 | ❌ | 无（`onBounce()` 硬性要求 `PAYOUT_PENDING`，SUCCESS 已终态无法二次进入） | — | — |
| 热钱包余额不足 | ❌ | 无（Payout 前不查 Outbound Wallet 余额） | — | — |

- **admin 无直接拒绝能力**：`PATCH :id/status` 侧门连同其唯一动作 `AdminWithdrawTransactionAction.REJECT` 已整体删除（该动作绕过 `releaseLock()`，会把净额+费两笔 TB pending 锁永久搁置，违反「REJECTED=解锁退回」不变量；镜像充值域同期的 admin 无拒绝能力收窄）。合法的拒绝/终止路径改走各自 workflow 端点，均正确释放锁：大额审批拒绝（`onLargeValueApprovalDecided()` → `REJECT` → `releaseLock()`）、官方 `REJECT_REFUND` tag（`applyKytVerdict()`）、`WITHDRAW_SANCTION_REFUND` 双审批批准（`onRefundApproved()`）。`assertStatusUpdateSourceAllowed()` 仍在，继续挡 `ADMIN_API` 来源直推 `PAYOUT_PENDING`/三个终态。
- **锚点**：`withdraw-workflow.service.ts`（全部分支逻辑，见第 2/4/5/6 节锚点汇总）｜ `withdraw-transactions.service.ts → assertStatusUpdateSourceAllowed()`

## 8. 支撑项（均 ✅ 存活）

事件驱动编排（`funds_order.status.changed`/`WITHDRAWAL_CREATED` → `WithdrawWorkflowService`）｜ Sumsub 单笔 KYT 引擎（第 4 节）｜ Admin 提现列表/详情（9 区块 + Frozen/Payout Disposition 侧栏 + Simulation 面板，见第 10 节）｜ Client 提现页（脱敏 + 字段白名单，见第 10 节）｜ 报价引擎 `WithdrawQuoteService`（`resolveBestLevel()` 按客户标签谓词取最低费）｜ L1 金额限额门（`TransactionLimitGateService`，单笔 min/max + AED 累计窗口）｜ D1 大额审批阈值（`transaction_limit_rules` 表 `LARGE_APPROVAL` 行，种子 200000 AED）｜ SLA 定时器（`WithdrawSlaService`，第 4 节）。

## 9. 已知缺口（详见 BACKLOG.md「技术债 — V5 提现」节）

- **`require_approval` 死枚举**：动作枚举保留但转移表零引用、代码零调用点，待清理。
- **费腿 STUCK 后无自动重触发出口**：三级梯耗尽（FAILED 三级梯）/settle-failure 耗尽（TB 瞬时故障三级梯）均只 `markNeedsReview` + 落审计，无专用 repair 端点；本任务 e2e 里用"手动 `fundsOrders.create()` 建新 attempt + 驱动 CONFIRMED"验证过恢复路径可行，但生产无对应 admin 按钮。
- **费腿"结算失败"三级梯的视图残留**：耗尽后费腿 `funds_order.status` 永久停在 `CONFIRMED`，Linked Funds Orders 卡片看起来像"一直在途"，无可见 STUCK 标记（信号只在 withdraw 的 `needsReview` + 审计里）。
- **`slaBreached` 不复位**：`WithdrawSlaService` 只把它从 `false` 置 `true`，从无任何路径重置回 `false`；若一笔单解冻/翻案回 `COMPLIANCE_PENDING` 后重新进入 onHold 拿到全新 `slaDeadline`，SLA 扫描器仍会因 `slaBreached=true` 永久跳过它——两域 parity（充值 `DepositSlaService` 同一设计，同一缺口）。
- **`POST /client/withdraw-transactions` 创建响应未过白名单**：`CustomerWithdrawController.create()` 直接 `return this.workflow.createWithdrawal(...)`，返回未经 `toCustomerWithdrawView()` 裁剪的完整原始行（`sumsubTxnId`/`manualReason`/`slaDeadline`/`statusHistory`/`tbPendingNetId`/`tbPendingFeeId`/`approvalNo`/`traceId` 等悉数在内）——真机验证时实测复现（见 task-12-report.md）。列表/详情/`GET :id` 三个读端点均已正确走白名单（`findAllForCustomer`/`findOneForCustomer`），仅创建这一个响应体是漏网之鱼。
- **真实 VASP 归因服务未接**：`counterpartyIsVasp` 由客户自己注册地址时的 `addressType==='VASP'` 自报，无外部 VASP 名录/归属服务校验这个自报是否属实（与充值 §4.5 的"客户端弹窗自选 VASP"同一性质缺口，提现这边至少是从已注册地址派生，非每笔手选）。
- **SUCCESS 后退汇无处理**：`onBounce()` 硬性要求 `PAYOUT_PENDING`，一笔已 `SUCCESS` 的提现若数日后被银行/链上退汇，本域没有对应入口——应走对账（recon）子系统匹配外部退汇流水，而非 withdraw workflow 自身处理终态之后的事。
- **看门狗①「Created 回执丢单锚」未做（deposit/withdraw 两域共有）**：`funds_order` 建单后若外部回执（链上确认/银行到账信号）从未真正抵达，该腿会永久停在 `CREATED`/`SUBMITTED`，无定时巡检任务扫描"创建超过 N 分钟仍未推进"的孤儿腿并重新锚定/告警——两域将来一起补，非提现独有。
- **V2 冻户升级仅审计**：`onRefundApproved()` 的"客户账户层面升级"只落一行审计说明（"manual, V2 freeze API not yet built"），无法调用真实 freeze API 联动——关联 BACKLOG 既有条目「冻结/解冻无统一 workflow + 无 MLRO 解冻门」（V2 客户合规节），本次在提现退款弧上又踩到同一个洞。
- **demo/business seed 无 withdrawalAddress 种子**（Task 5 已登记，见 BACKLOG「demo:deposit/demo:withdraw 在全新 worktree 上必炸」条）：trading-ready 门 + 本域自己的地址硬校验双重依赖 `withdrawalAddress` 表，`demo-lib.ts` 从未播种，全新 worktree 直接跑 demo 脚本会卡门/400。
- **admin 子表视图未做（两域一起后置）**：`WithdrawTransactionDetail.tsx` 与充值 `DepositTransactionDetail.tsx` 同款缺口——都只展示聚合后的 `sumsubDetail.applicantActionIds`（原始报文解析出的 id 列表），没有逐条 `seq`/`submittedAt` 的子表视图，运营看不到"客户交了第几条、还差第几条"；详见第 4.6 节，两域待一起补一次 admin 前端改动。
- **snsWebSdk script 两域同缺**：`WithdrawVerification.tsx` 非 demo 分支与充值 `DepositVerification.tsx` 一样读 `window.snsWebSdk`，但全仓没有任何入口加载官方 `https://static.sumsub.com/idensic/static/sns-websdk-builder.js`（或同等 CDN 脚本）——真接 Sumsub 分支目前两域都不可执行，代码逻辑本身已按官方契约写对，只差脚本加载与租户侧配置；详见第 4.6 节。
- 其余既存（Sumsub KYT 真实集成本轮已完成，不再是缺口；热钱包余额校验无 / 提现成功通知未接 / repair surface 偏薄 / 在途提现守卫靠字符串匹配 / L3 命名与交易风控 L3 撞名）详见 BACKLOG.md。

## 10. 前端现状（admin + client，Task 10-11 落地，Task 12 真机 API 验证）

**两张状态映射表，单一真相源**：`admin-web/src/utils/withdrawStatusMap.ts`（`getWithdrawStatusMeta`，如实展示 **10 态**全量 + `adm-*` 令牌徽章色 + `WITHDRAW_STATUS_FILTERS` 分组筛选，`Processing` 组合并 `COMPLIANCE_PENDING`+`PENDING_APPROVAL`）与 `client-web/src/utils/withdrawStatusView.ts`（`getWithdrawStatusView`，面向客户脱敏）。

**客户端执法态收敛（mirror 充值 2026-08-02 定稿）**：`FROZEN`/`MANUAL_CHECKING`/`PENDING_APPROVAL`/`ACTION_PENDING` 之外的三个（不含 `ACTION_PENDING`，它有独立的"需要补料"文案）与 `COMPLIANCE_PENDING` **逐字段完全一致**——`{label:'PROCESSING', tone:'neutral'}`，无 `note`。`PENDING_APPROVAL`（内部大额闸）也并入同一伪装集合——区分出来本身就是"这笔被加强审查"的信号。**已知边界**（本次真机验证实测确认，见下）：这层脱敏只在**前端渲染层**生效（`getWithdrawStatusView()` 把原始 status 映射成显示 label）——`GET /client/withdraw-transactions/:id` 的**原始 JSON 响应体本身仍带真实 status 值**（如 `"status":"FROZEN"`），字段白名单只保证不泄露 `sumsubTxnId`/`manualReason`/`typedTags` 等调查性字段，不掩盖 status 这一列的原始值；DevTools Network 面板检查仍能看到真实值。⚠️ **「与充值域同一设计」已过时（2026-08-07 订正）**：充值域在 2026-08-05~06 补料 Embed 终审中已把接口层 status 升级为白名单收敛（`CUSTOMER_STATUS_PASSTHROUGH`——七态放行、其余含 FROZEN/MANUAL_CHECKING 一律改写成 `COMPLIANCE_PENDING`，另有 `completedAt` 独立白名单 + bucket 补集化 + customerScope 忽略 status 查询参数，见 v4-deposit §4.6），**提现接口层未跟进**——`toCustomerWithdrawView()` 仍原样下发 status、`findAllForCustomer()` 的 `status` 查询参数未做 customerScope 忽略（冻结预言机）、前端筛选仍是裸 status 列表——两域现已不同构；已由 deposit-action-embed 分支终审登记 BACKLOG「规则 A（tipping-off 防线）只在充值域落实」条（含逐处 file:line），提现镜像收敛待业主排期。

**Client 详情/认证独立页（`WithdrawDetail.tsx`/`WithdrawVerification.tsx`，Task 4-5，2026-08-07 落地，详见第 4.6 节）**：客户点开一笔提现不再是列表内联弹窗——`/withdraw/:withdrawNo` 独立页展示 Hero/Details 字段 + `ACTION_PENDING` 且有 action 行时的 `Outstanding verification` 卡片；每条 action 的补料入口深链到 `/withdraw/:withdrawNo/verification/:seq` 独立页（四态渲染，demo 假上传 / 真接 `snsWebSdk`）。两页均"返回从哪来回哪去"（`location.key==='default'` 才兜底回列表/详情）。白名单在 `actions` 上开一个口子（第 4.6 节详述），`status`/`completedAt` 本身仍是裸值下发（第 9 节规则 A 缺口，未随本轮收敛）。

**Admin 详情页（`WithdrawTransactionDetail.tsx`）9 区块 + 2 侧栏组**：① Hero（状态徽章+金额+类型+Owner）② Transaction Details ③ Compliance（L1 资格 + L2 单笔 Sumsub 裁决一行展示）④ Sumsub References（Applicant ID + 单个 Txn ID/Type/Verdict/Received At）⑤ Sumsub Transaction Detail（score/verdict/matchedRules/applicantActionIds/原文折叠）⑥ Internal Approvals（大额/解冻/退款三种审批反查，仅单头）⑦ Linked Funds Orders（本金 Payout + 费 Internal Fund 并列）⑧ Status History ⑨ ⚡ Simulation（`simEnabled` 门控，独立于后端 `SUMSUB_MOCK_MODE`，10 个裁决按钮）。侧栏：`PAYOUT_PENDING` 态显示 **Payout Disposition**（Bounce 按钮）；`FROZEN` 态显示 **Frozen Disposition**（`Initiate Unfreeze` / `Reject & Freeze Customer` 两个 modal，均开审批案而非直接执行；后者原文案 `Initiate Refund`，2026-08-04 业主验收改定——按钮语义=拒绝本笔提现并冻结客户，但"冻结客户"执行侧现状仅审计留痕+人工 V2 冻户，见第 9 节 V2 冻户条；同名改动同步在 modal 标题/理由 placeholder/提交通知/Internal Approvals 审批类型标签共五处）。`needsReview` 横幅（顶部红条）**兼任 STUCK 信号**——费腿三级梯耗尽（第 5/9 节两种）与"裁决迟到于广播"共享同一个 `needsReview` 布尔位 + 同一条横幅文案，不区分具体成因（成因需读 Status History/审计明细）；**SUCCESS 结算时自动清旗**（`onLegCleared()` 在状态翻 SUCCESS + 审计落盘后调 `clearNeedsReview()`——费腿卡死修复重跑康复的单不再挂永久红条，e2e 场景 3 有 post-SUCCESS 断言防回退；FAILED/REJECTED 终态路径的 needsReview 残留是否同样清旗待定，见 BACKLOG）。

**⚡ Simulation 演示引擎（Task 10）**：`SUMSUB_MOCK_MODE=true` 时 `WithdrawSumsubModule` 才注册 `AdminWithdrawDemoController`（`POST /admin/withdraw-sumsub/demo/run-verdict`，body `{withdrawId, verdict}`）——生产环境该 controller 压根不存在（模块 controllers 数组条件化，非 guard 拦）。`WithdrawDemoScenarioService.runVerdict()` 按提现当前 `sumsubTxnType` 现铸官方形状报文、prime mock client、驱动真实 `SumsubIngestionService.ingest()` 走完整 ingest→router→handler→workflow 链路——**与 e2e 测试用的是同一份生产代码路径**，不是测试自己拼报文。10 个按钮定义于 `withdraw-sumsub/fixtures/verdict-buttons.ts`（mirror 充值版，⑥ 处置 tag 用 `REJECT_REFUND` 而非充值的 `RETURN_TO_SENDER`；⑩ 多条 action 按钮 `V10_AWAIT_USER_MULTI` 于 2026-08-07 Task 6 补齐，详见第 4.6 节）。

**真机 API 验证（Task 12，2026-08-04，worktree self 栈）**：`bash scripts/stack.sh up` 起栈（`SUMSUB_MOCK_MODE=true`）→ `db:base:sync` + 重启后端（拾取新 RBAC 权限码）→ 用 seed admin（`admin@fiatx.com`，SUPER_ADMIN 绕过审批角色校验）+ seed 客户（`demo_frank@example.com`）真实走 HTTP：创建报价+提现 → Simulation 端点喂 `V4_REJECTED_SANCTION` → `FROZEN` → `POST :id/unfreeze` 开审批 → `POST /admin/control-gates/approvals/:id/approve` → `COMPLIANCE_PENDING` → 喂 `V1_APPROVED` → `PAYOUT_PENDING` → `POST /admin/funds-orders/:no/advance`（SUBMIT→CONFIRM）驱动两腿 → `SUCCESS`；另一笔走 `V5_REJECTED_FROZEN_MLRO` → `FROZEN` → `POST :id/refund` → 审批批准 → `REJECTED`。两笔均分别 `GET` 了 admin 详情端点（9 区块字段齐全，`sumsubDetail`/`approvals[]`/`statusHistory` 均实测有值）与客户端点（字段白名单确认无 `sumsubTxnId`/`manualReason`/`typedTags` 等调查性字段泄露，但如上一条所述，`status` 原始值本身未被脱敏——`toCustomerWithdrawView()` 与充值同构，非本轮回归）。原始 JSON 证据见 `task-12-report.md`。

- **锚点**：`admin-web/src/utils/withdrawStatusMap.ts`（`getWithdrawStatusMeta`/`WITHDRAW_STATUS_FILTERS`/`isWithdrawTerminalStatus`）｜ `admin-web/src/pages/WithdrawTransactionDetail.tsx`（9 区块 + Frozen/Payout Disposition + ⚡ Simulation）｜ `client-web/src/utils/withdrawStatusView.ts`（`getWithdrawStatusView`）｜ `client-web/src/pages/Withdraw.tsx`（`WithdrawTransaction` 接口 = 客户端字段契约）｜ `client-web/src/pages/WithdrawDetail.tsx`/`WithdrawVerification.tsx`（独立详情页/认证页，第 4.6 节详述）｜ `withdraw-transactions.service.ts → toCustomerWithdrawView()`（列表/详情白名单，**创建响应未走此白名单**，见第 9 节）｜ `withdraw-sumsub/demo-scenario.service.ts`/`admin-withdraw-demo.controller.ts`（演示端点）｜ `withdraw-sumsub/withdraw-sumsub.module.ts`（`SUMSUB_MOCK_MODE` 条件化 controller 注册）｜ `withdraw-sumsub/fixtures/verdict-buttons.ts`（10 按钮定义）
