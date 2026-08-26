# V7 Phase 4 — 手续费归集（FEE_RECEIVABLE drain）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** Cron 定期把累积的收入型手续费（FEE_RECEIVABLE：swap 费 + 点差 + 提现费）从 pool 归集到 Ops——经通用内部转账工作流 spawn FEE_COLLECT transfer（C_MAIN→F_OPS，B 类，drain FEE_RECEIVABLE↔CUSTODY 真实 TB 记账）。V7 crypto MVP 收口。

**Architecture:** 复用 Phase 3 全部基础设施——FEE_COLLECT 白名单路径（C_MAIN→F_OPS, class B, drain FEE_RECEIVABLE）已存在；`InternalTransferWorkflowService.initiate` 触发 B 类 drain；`SettlementBatch` 表 settlementType='FEE_COLLECT'。crypto-only。

**Tech Stack:** NestJS · Prisma · SQLite · TigerBeetle · Jest

**依据 spec：** `2026-06-03-v7-internal-transfer-crypto-mvp-design.md` §5 Phase 4。

**⚠️ git 纪律：** 用户有 4 个 dirty admin-web 文件（DashboardLayout/PageTitleBar/AccountStatementPage/CustomerDetail）——勿动。每 subagent 只用显式精确路径 `git add`，禁 `git add -A`，commit 前 `git status --short` 核对。验收 = 不新增失败。

**前置：** Phase 3（B 类 drain 框架 + SettlementBatch 引擎 + EOD workflow 模式）。

---

## 已锁定设计决策
1. **B 类 drain 通用化**：Phase 3.1 的 drain 逻辑（lookupBalance→net→方向自校正→executeTransfer↔CUSTODY）对 FEE_RECEIVABLE 同构。FEE_RECEIVABLE 只累积 credit → 恒为 `debit FEE_RECEIVABLE → credit CUSTODY`。4.1 只需让 applyAccounting 用 `policy.drain` 选账户码（FEE_RECEIVABLE=120），放开 NotImplemented，用 FEE_DRAIN code。
2. **候选发现**：迭代 status=ACTIVE 的 crypto Asset → resolve `FEE_RECEIVABLE(SYSTEM, ledger=TB_LEDGERS[currency])` → lookupBalance → net credit > 0 的资产入选。
3. **transfer amount**：= FEE_RECEIVABLE 余额（bigint）→ 转 decimal（asset.decimals）。需 `bigintToDecimal` 工具（这次会被消费）。drain 仍按 applyAccounting 内 lookupBalance 实际余额，两者一致。
4. **无 Outstanding 消费**：费用归集不碰 Outstanding。SettlementBatch(settlementType='FEE_COLLECT') 仅作编排/幂等/admin 可见落点；item 记 asset+amount+transfer，无 lock/settle。
5. **幂等**：归集后 FEE_RECEIVABLE 余额归零 → 下次 sweep 找不到候选（balance-based 幂等）；per-(batch,asset) transfer 经 sourceId findFirst 兜底。
6. **Admin**：复用 Phase 3 settlement 页（settlementType 已展示），本轮无新页。

---

## Task 4.1: 放开 FEE_RECEIVABLE drain + bigintToDecimal 工具

**Files:** `funds-layer/accounting/funds-accounting.service.ts`(+spec)、新 `funds-layer/accounting/tb-amount.util.ts`(+spec)、`tb-transfer-codes.constant.ts`。

- [ ] **Step 1: bigintToDecimal 工具**（`tb-amount.util.ts`，将被 4.2 消费）
```typescript
import { Prisma } from '@prisma/client';
export function bigintToDecimal(value: bigint, decimals: number): Prisma.Decimal {
  const neg = value < 0n; const abs = neg ? -value : value;
  const s = abs.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, s.length - decimals) || '0';
  const frac = decimals > 0 ? '.' + s.slice(s.length - decimals) : '';
  return new Prisma.Decimal((neg ? '-' : '') + whole + frac);
}
```
加单元 spec（含 0 decimals、padding、负数）。

- [ ] **Step 2: 失败测试** — funds-accounting.service.spec.ts 加 FEE_RECEIVABLE 用例：transfer pathLabel=FEE_COLLECT（policy.drain='FEE_RECEIVABLE'）、FEE_RECEIVABLE 净 credit（creditsPosted=500,debitsPosted=0）→ applyAccounting 调 `executeTransfer({debit: FEE_RECEIVABLE_id, credit: CUSTODY_id, amount: 500n, code: FEE_DRAIN})`。（resolveTbAccountId 对 code=FEE_RECEIVABLE 返回 FEE_RECEIVABLE id。）现有 TRADE_CLEARING 用例不变。

- [ ] **Step 3: 实现** — applyAccounting 把硬编码的 TRADE_CLEARING 账户码改为从 `policy.drain` 映射（'TRADE_CLEARING'→TB_ACCOUNT_CODES.TRADE_CLEARING；'FEE_RECEIVABLE'→TB_ACCOUNT_CODES.FEE_RECEIVABLE）；移除对 FEE_RECEIVABLE 的 NotImplemented；drain code 用 `EOD_DRAIN_*`（TRADE_CLEARING）/ `FEE_DRAIN`（FEE_RECEIVABLE）按 drain 账户选。加 `FEE_DRAIN` 到 tb-transfer-codes.constant.ts。方向逻辑（余额符号自校正）不变。evidence sourceType 对 FEE_COLLECT 用 'FEE_COLLECTION'。

- [ ] **Step 4: PASS + build 0 错误。Commit**（显式路径）`feat(v7-phase4): generalize B-class drain to FEE_RECEIVABLE + bigintToDecimal util`。

---

## Task 4.2: fee-collection-workflow + @Cron sweep + wiring

**Files:** `funds-layer/workflow/fee-collection-workflow.service.ts`(+spec)、`funds-layer/sweep/fee-collection-sweep.service.ts`、`funds-layer.module.ts`。

- [ ] **Step 1: 失败测试** — mock PrismaService（asset.findMany 返回 active crypto assets）、AccountingService（resolveTbAccountId + lookupBalance）、SettlementBatchService、InternalTransferWorkflowService、SystemWalletResolver。`runFeeCollection(operatorId='SYSTEM')`：
  - 查 active crypto assets → 每资产 resolve FEE_RECEIVABLE + lookupBalance → net credit>0 入选；无候选 → return 早退（不建空 batch）。
  - createBatch(settlementType='FEE_COLLECT')；每候选资产：amount=bigintToDecimal(net, decimals)；resolve C_MAIN(from)+F_OPS(to)；createItem(direction='FEE_COLLECT', netAmount=amount)；idempotency findFirst(sourceType='FEE_COLLECTION', sourceId=`${batchId}:${assetId}`)；none → `initiate({fromRole:'C_MAIN', toRole:'F_OPS', sourceType:'FEE_COLLECTION', sourceId, sourceNo:batchNo, ownerType:'PLATFORM', ownerId:'PLATFORM', assetId, amount: amount.toString(), fromWalletId:main.id, toWalletId:ops.id, triggerSource:'CRON'})`；linkItemTransfer；recomputeBatch。
  - 用例：单资产 FEE_RECEIVABLE 余额>0 → initiate FEE_COLLECT（fromRole C_MAIN toRole F_OPS amount 正确）；余额=0 资产被跳过；无候选 → 不建 batch；幂等（existing transfer → 不重复 initiate）。
  - （验证 InitiateTransferInput 字段名；whitelist C_MAIN→F_OPS 解析为 FEE_COLLECT。）
  - **item 状态**：FEE_COLLECT item 无 Outstanding，创建后直接置 NETTED 或在 transfer CLEAR 时 closeItem——选简单：spawn 后 item 留 PROCESSING，复用 Phase 3 的 `@OnEvent('fundsflow.status.changed')`？注意 Phase 3 的 EOD @OnEvent 只认 sourceType='EOD_SETTLEMENT'。FEE_COLLECT 的 transfer sourceType='FEE_COLLECTION'，不会被 EOD @OnEvent 处理。**本 workflow 自己加 `@OnEvent('fundsflow.status.changed')`**：newStatus CLEAR 且 transfer.sourceType='FEE_COLLECTION' → 找 item → closeItem → recomputeBatch（try/catch + logger）。

- [ ] **Step 2: 实现 workflow + @OnEvent**（参考 Phase 3 eod-settlement-workflow 结构）。

- [ ] **Step 3: fee-collection-sweep**（`@Cron`，参考 eod-settlement-sweep；定期，如 `@Cron('0 0 * * *')` 每日 0 点，或与 EOD 错开）→ `workflow.runFeeCollection('CRON')` + log。

- [ ] **Step 4: wiring** — funds-layer.module providers 加 FeeCollectionWorkflowService + FeeCollectionSweepService。build 0 错误；`npx jest src/modules/funds-layer/` 全过。

- [ ] **Step 5: Commit**（显式路径）`feat(v7-phase4): fee collection workflow + @Cron sweep (drain FEE_RECEIVABLE→Ops)`。

---

## Phase 4 验收清单
- [ ] `npm run build` + funds-layer 测试全过；无新增失败
- [ ] **TB 余额门**：构造 swap（产生 FEE_RECEIVABLE 余额）→ `runFeeCollection` → simulate FEE_COLLECT transfer 到 CLEAR → `lookupBalance(FEE_RECEIVABLE[asset])` 净额=0；CUSTODY 相应变动
- [ ] 余额=0 资产跳过；无候选不建空 batch；重跑幂等（已归集后余额 0）
- [ ] FEE_COLLECT transfer 走 C_MAIN→F_OPS，可在 Phase 3 settlement 页按 settlementType=FEE_COLLECT 查到
- [ ] 不碰 Outstanding（EOD 结算不受影响）

## 明确排除
- FIAT 手续费归集（drain ↔ BANK，法币轮次）
- 费率配置（已在 V5/V6 治理）
