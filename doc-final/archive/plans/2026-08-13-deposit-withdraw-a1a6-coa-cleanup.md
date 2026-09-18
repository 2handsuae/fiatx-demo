# 充值/提现 A1-A6 + COA v2 收口 — 实施计划

Date: 2026-08-13 ｜ 设计稿：[`specs/2026-08-13-deposit-withdraw-a1a6-coa-cleanup-design.md`](../specs/2026-08-13-deposit-withdraw-a1a6-coa-cleanup-design.md)

---

## 0. 执行前提

**工作树**：`.claude/worktrees/a1a6-coa/`，分支 `fix/a1a6-coa-cleanup`，栈用 `bash scripts/stack.sh up`（self，自动分端口）。
主工作树 `main` 不动。

**串行执行，禁止并行 subagent** — 文件重叠严重：

| 文件 | 被几个任务修改 |
|---|---|
| `deposit-workflow.service.ts` | T2 / T5 / T6 / T7 |
| `withdraw-workflow.service.ts` | T8 / T9 |
| `deposit-transactions.service.ts`（transitions） | T4 |
| `tb-transfer-codes.constant.ts` | T1 / T2 |
| `scripts/verify-realtime-coa.ts` | T1 / T3 |

**每个任务的完成定义**：改动 + 单测更新 + `npx tsc --noEmit` 0 错 + 相关 jest 绿 + 一句话记录改了什么。
**不逐任务提交**，按批次提交（批次内改动语义相关）。

---

## 批次 A · 常量与脚本层（不碰业务逻辑）

### T1 · 删兼容层

**改**
- `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts` — 删 `RETIRED_TB_CODES`、`RETIRED_TB_CODE_TO_COA`
- `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` — 删 `COA_V2_INCOME_RECLASS`(71)
- `src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts` — `FIRM_CODES` 去掉裸数字 `202, 203`
- `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts` — `OWNED_CODES` 去掉裸数字 `202, 203`
- `scripts/verify-realtime-coa.ts` — 删三条 retired 断言
- 删 `scripts/migrate-coa-v2.ts`；`package.json` 去掉 `migrate:coa-v2`

**保留**：`tb-account-codes.constant.spec.ts` 的死名单断言（防 202/203/204 回归主表）。若该 spec 引用了被删的 `RETIRED_TB_CODES`，改成本地字面量数组，断言语义不变。

**验**
```
grep -rn "RETIRED_TB_CODE\|COA_V2_INCOME_RECLASS\|migrate-coa-v2\|migrate:coa-v2" src/ scripts/ package.json   # 期望仅 spec 死名单命中或全空
npx tsc --noEmit && npx jest src/modules/accounting src/modules/clearing-settle
```

### T2 · COA 命名债

**改**
- `tb-transfer-codes.constant.ts`：`DEPOSIT_CONFISCATE_FIRM_FEE`(4) → `DEPOSIT_CONFISCATE_INCOME_OTHER`；码 16 / 36 注释 `CR FIRM_FEE` → `CR INCOME_WITHDRAW_FEE` / `CR INCOME_SWAP_FEE`
- `deposit-workflow.service.ts`：eventCode `'CONFISCATE_FIRM_FEE'` → `'CONFISCATE_INCOME_OTHER'`

> ⚠️ **成对约束（改错必炸）**：该 eventCode 进 `deterministicTransferId('DEPOSIT', depositNo, <eventCode>, 1)` 参与 pending ID 哈希。
> **`startConfiscation()`（下锁，约 L1273）与 `settleConfiscation()`（结算 `pend2`，约 L1320/L1337）必须同时改**，只改一处则 post 找不到 pending。
> 改完 grep 确认 `'CONFISCATE_FIRM_FEE'` 全仓归零（含 spec）。

**验**
```
grep -rn "CONFISCATE_FIRM_FEE\|DEPOSIT_CONFISCATE_FIRM_FEE" src/ ; grep -rn "FIRM_FEE" src/modules/accounting/tigerbeetle/constants/
npx tsc --noEmit && npx jest src/modules/trading/deposit-transactions
```

### T3 · verify:coa 负余额断言

**改** `scripts/verify-realtime-coa.ts` — 新增一条：遍历全部 registry 账户，按 class-aware 口径算余额，**任何科目余额 < 0 即 FAIL**（打印 code / ledger / ownerType / ownerNo / 余额）。

**验** `bash scripts/on-stack.sh self verify:coa` → `ALL INVARIANTS PASS`；临时改一条断言方向验证它确实会红，再改回。

**提交**：`chore(coa-v2): 删兼容层 + 命名债收口 + verify:coa 负余额断言`

---

## 批次 B · 状态机层

### T4 · 补三条转移边 + 边数断言

**改**
- `deposit-transactions.service.ts` → `getNextStatus()` 的 `transitions`：
  - `OPERATION_PENDING` + `FREEZE → FROZEN`
  - `CONFISCATING` + `CONFISCATE_FAILED → OPERATION_PENDING`（A1 用）
  - `DepositTransactionAction` 枚举新增 `CONFISCATE_FAILED`
  - 边数 **26 → 28**
- `withdraw-transactions.service.ts` → `transitions`：
  - `PENDING_APPROVAL` + `FREEZE → FROZEN`
  - 边数 **20 → 21**
- 两域守则性单测：逐边断言 + 总数断言同步（充值 28 / 提现 21）；充值的"穷举反向断言"组合数 `14×15` → `14×16`

**验**
```
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts \
         src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts
```
先把新边从转移表里注释掉跑一次确认单测变红（验证断言真的在守），再恢复。

**提交**：`feat(state-machine): 补 freeze 两条边 + 没收失败回退边，边数 26→28 / 20→21`

---

## 批次 C · 充值 workflow

### T5 · A1 没收腿失败分支（依赖 T4）

**改** `deposit-workflow.service.ts`
- `onConfiscationLegChanged()`：`if (newStatus !== CONFIRMED) return` → switch（结构照抄 `onReturnLegChanged` L2048-2063）
  - `CONFIRMED` → `settleConfiscation()`（不变）
  - `FAILED` / `TIMEOUT` → 新增 `onConfiscationLegFailed()`
- 新增 `onConfiscationLegFailed(deposit, fundsOrderId)`：
  1. `voidPendingTransfer` **两腿**（`deterministicTransferId('DEPOSIT', depositNo, 'CONFISCATE_REVERSE_SUSPENSE', 1)` 与 `'CONFISCATE_INCOME_OTHER'`（T2 改名后），第 4 参保持常量 `1`）
  2. `updateStatus(CONFISCATE_FAILED)` → deposit 回 `OPERATION_PENDING`
  3. 审计 `DEPOSIT_CONFISCATION_LEG_FAILED`（reason 带 fundsOrderId + 失败态）
  4. 整体 `try/catch`，失败只 warn + 落审计，不上抛（照抄 `onReturnLegFailed` L2145 的 try 包法）
- **不做重建重试**（第 4 参非 attempt 语义，抄不了三级梯）
- **前端不改**：`⚡失败`/`⚡超时` 按钮保留，作为可演示的异常弧

**验**
```
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
```
新增单测：① 没收腿 FAILED → 两腿 void 各调一次 + 状态回 `OPERATION_PENDING` + 审计已记；② TIMEOUT 同上；③ void 抛错时不上抛、落 warn 审计。

### T6 · A2 退回着陆垫

**改** `deposit-workflow.service.ts` → `applyKytRejected()` 的 `RETURN_TO_SENDER` 分支：调 `initiateReturn()` 前判状态，不在 `MANUAL_CHECKING` → `updateStatus(KYT_REJECTED)` 落 `MANUAL_CHECKING`，reason 带原 tag 与原状态（逐字抄 `withdraw-workflow.service.ts:2586-2600` 的写法与注释风格）。

**验** 新增单测：`COMPLIANCE_PENDING` + `RETURN_TO_SENDER` tag → 落 `MANUAL_CHECKING`、不抛、不开审批案、reason 含 tag。

### T7 · A5 迟到裁决忽略集合

**改** `deposit-workflow.service.ts`
- `KYT_VERDICT_TERMINAL_STATUSES` → 改名 `KYT_VERDICT_IGNORED_STATUSES`，加 `CONFISCATING` / `RETURNING` / `SEIZING`
- 命中分支：`logger.debug` 之外**补一条审计**（`DEPOSIT_KYT_VERDICT_IGNORED`，reason 记 verdict + 当时状态）
- 确认早退发生在 `writeBackGateStatus` / `saveTxnDetail` **之前**（现有 FROZEN 守卫已是这个位置，对齐即可）

**验** 新增单测：`SEIZING` 单收到 `approved` → 证据字段（`sumsubVerdict`/`sumsubScore`/`sumsubTxnDetailJson`）**未被改写** + 有忽略审计 + 不抛。

**提交**：`fix(deposit): A1 没收腿失败自愈 + A2 退回着陆垫 + A5 处置态忽略迟到裁决`

---

## 批次 D · 提现 workflow

### T8 · A4 合规复查 + 大额审批连锁（依赖 T4）

**改** `withdraw-workflow.service.ts`
- 新增 `private static readonly ABNORMAL_COMPLIANCE = new Set(['FROZEN','SUSPENDED','BLOCKED','REJECTED'])`（抄 `deposit-workflow.service.ts:64`）
- 三处调 `withdrawService.getOwnerComplianceStatus(w.id)`，命中即 `updateStatus(FREEZE)` + 审计，不继续推进：
  - `handleWithdrawalCreated()`
  - `onLargeValueApprovalDecided()`
  - `initiatePayoutPhase()`
- **连锁**：`onLargeValueApprovalDecided()` 开头先判 `w.status === FROZEN` → no-op + 审计（`WITHDRAW_APPROVAL_DECIDED_ON_FROZEN`），避免对 `FROZEN` 打 `gate_approve` 抛错

**验** 新增单测：① 客户 `FROZEN` 时下单 → 提现落 `FROZEN` 不进 `PAYOUT_PENDING`；② 大额审批中客户被冻 → 审批通过后 no-op 不抛、状态仍 `FROZEN`；③ 正常客户三处均不受影响（回归）。

### T9 · A6 终态活资金单

**改** `withdraw-workflow.service.ts`
- `onBounce()`：`updateStatus(RETURN)` 挪到 `advance(FAIL)` **之前**
- `onPayoutLegFailed()`（L1417）：解锁后补一句把费腿（`legSeq=2` 最新 attempt）标 `FAILED`（抄 `onBounce` 现成写法）

**验** 新增单测：① 退汇后该单下无非终态资金单、无新建费腿；② 本金腿失败后费腿为 `FAILED`。

**提交**：`fix(withdraw): A4 补客户级合规闸+大额审批冻结连锁 / A6 终态不再挂活资金单`

---

## 批次 E · 对账层

### T10 · A3 推单去 CLEAR

**改** `src/modules/clearing-settle/reconciliation/disposition/push-order.service.ts` — `HAPPY_ACTIONS` 删掉 `FundsOrderAction.CLEAR`（L18）。
`MAX_STEPS` 由 6 调整为 5（链路少一步）——**可选**，不改也不影响正确性，改则同步注释。

**验** 单测断言推单最远推到 `CONFIRMED`；实机：`bash scripts/on-stack.sh self demo:in-transit` 后对费腿推单 → 停 `CONFIRMED`，随后 workflow 结算，提现最终 `SUCCESS`。

**提交**：`fix(recon): 推单不再抢跑结算 — HAPPY_ACTIONS 去掉 CLEAR`

---

## 批次 F · 收官

### T11 · 全量验证 + 文档同步

**硬闸门**
```
npx tsc --noEmit                                  # 后端
cd admin-web && npx tsc -b --force && npm run build
cd client-web && npx tsc -b --force && npm run build && npm test
npx jest                                          # 净新增失败 0（4 个 wallets 既存失败不计）
npx jest --config test/jest-e2e.json --runInBand   # 全绿
```

**重铺后逐条功能验收**（`bash scripts/on-stack.sh self db:biz:reset` → `demo:all`）
1. 没收流程点 `⚡失败` → 回 `OPERATION_PENDING`、两笔 pending 已 void、审计有记录、可重新发起没收
2. `COMPLIANCE_PENDING` 单点"原路退回"裁决 → 落 `MANUAL_CHECKING`，tag 在 reason 里，不进死信
3. `demo:in-transit` 后推单 → 停 `CONFIRMED`，结算归 workflow，提现最终 `SUCCESS`
4. 客户冻结后其在途提现（含大额审批中）→ `FROZEN`；审批再通过不抛错
5. 对 `SEIZING` 单点任意裁决 → 证据未被覆写 + 有忽略审计
6. 提现退汇/失败后该单下无活资金单
7. `bash scripts/on-stack.sh self verify:coa` → `ALL INVARIANTS PASS`（含负余额断言）

**文档同步**
- `truth/v4-deposit.md`：状态机 26→28 边、A1 失败弧、A2 着陆垫、A5 忽略集合改名
- `truth/v5-withdraw.md`：20→21 边、A4 三处合规闸 + 大额连锁、A6 两处
- `truth/accounting-coa.md`：命名债清理、兼容层删除、负余额断言
- `truth/funds-orders.md`：没收腿失败分支（补进 §3 legSeq 分流表）
- `BACKLOG.md`：勾掉已修条目；**保留** park 的安全类问题 + `OPERATION_PENDING` 迟到 `rejected/awaitUser` 仍抛 + `onPayinFailed` 越位不落审计

**提交**：`docs: truth/BACKLOG 同步 A1-A6 + COA v2 收口`

---

## 任务依赖图

```
批次A (T1→T2→T3)  ─┐
批次B (T4)         ─┼→ 批次C (T5←T4, T6, T7)  ─┐
                    └→ 批次D (T8←T4, T9)       ─┼→ 批次F (T11)
批次E (T10) 独立    ─────────────────────────────┘
```

T5 依赖 T4 的 `CONFISCATE_FAILED` 边；T8 依赖 T4 的 `PENDING_APPROVAL --freeze-->` 边。其余批次内顺序执行即可。
