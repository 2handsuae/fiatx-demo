# V7 Phase 3 — B 类记账 + EOD 兑换结算实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** V7 成为唯一的 EOD 兑换结算引擎：按资产轧差 OPEN Outstanding → 经通用内部转账工作流 spawn INTERNAL_OUT/IN（B 类，drain TRADE_CLEARING↔CUSTODY 的真实 TB 记账）→ 消费 Outstanding 标 SETTLED → 退休 Wave-8 的 PoolSettlementBatch + OutstandingSettlements 两套旧引擎。

**Architecture:** 复用 Phase 1 `InternalTransferWorkflowService.initiate`（B 类路径触发 `FundsAccountingService` 的 drain 记账）。新建 funds-layer 的 settlement domain（轧差）+ eod-settlement-workflow + @Cron。B 类 drain 调 `AccountingService.executeTransfer`。**crypto-only**（FIAT Outstanding 留法币轮次）。

**Tech Stack:** NestJS · Prisma · SQLite · TigerBeetle · Jest · React

**依据 spec：** `doc-final/superpowers/specs/2026-06-03-v7-internal-transfer-crypto-mvp-design.md` §5 Phase 3 + §7 不变量。

**关键命令：** `npx jest <path>` · `npm run build` · `npm run dev:rebuild`

**⚠️ 并发 + git 纪律（用户并行 session 在改 admin-web/cleanup）：每个 subagent 只用显式精确路径 `git add`，禁止 `git add -A`/`.`/`<dir>`，禁止暂存 admin-web/schema/未自己改的文件；commit 前 `git status --short` 核对。本分支有 ~34 后端 + ~11 admin-web pre-existing 失败，验收 = 不新增失败。**

---

## 已锁定设计决策

1. **退休旧两套引擎（用户拍板"V7 重建，退休旧的两套"）**：禁用 `PoolSettlementBatchSchedulerService` 的 `@Cron`；停止使用 `OutstandingSettlementsService`（不再被任何 cron/调用触发）。两套旧引擎代码本轮**标记 retired（不再触发）**；完整删除作为 Phase 3 末尾的清理 task（含 schema 表 + 链接字段评估）——删除前确认无其它活跃依赖。PoolSettlementBatch 顺带做的 **ReimbursementObligation 结算**随其停用而停止；那些义务留 OPEN，由 Phase 5 偿付义务工作流处理。
2. **B 类 drain TB 记账**：`TRADE_CLEARING(SYSTEM, asset) ↔ CUSTODY(SYSTEM, asset)`，drain 金额 = `|TRADE_CLEARING[asset] 净额|`，方向取"使 TRADE_CLEARING 归零"。**验收硬门：EOD 后 `lookupBalance(TRADE_CLEARING[asset])` 净额 = 0**（TDD 用余额断言锁定方向，防借贷写反）。
3. **netting crypto-only**：只处理 CRYPTO 资产的 Outstanding（`asset.type='CRYPTO'`），net 方向 C_MAIN↔F_LIQ；FIAT Outstanding 跳过（留法币轮次）。
4. **Outstanding 消费**：lock（OPEN→LOCKED，挂 settlementId）→ funds-flow CLEAR 时标 `status='SETTLED'` + `closedByInternalFundId`；幂等重跑（已 SETTLED 跳过；net=0 直接 SETTLED 无 transfer）。
5. **结算编排实体**：复用现有 `OutstandingSettlement`(+`Item`) 表（settlementType='EOD'），但由**新的 funds-layer SettlementBatchService** 写（不走旧 OutstandingSettlementsService）。

---

## 文件结构总览

```
src/modules/funds-layer/
├── accounting/funds-accounting.service.ts          # 改：实现 B 类 drain（替换 NotImplemented）
├── accounting/tb-amount.util.ts                    # 新：decimalToBigint 共享工具（从 swap 提取）
├── domain/settlement-batch.service.ts              # 新(port netting)：groupByAsset→净额→方向
├── domain/outstanding-consumer.service.ts          # 新：lock / settle Outstanding（funds-layer 侧）
├── workflow/eod-settlement-workflow.service.ts     # 新(L3)：轧差→spawn INTERNAL_OUT/IN→消费 Outstanding
├── sweep/eod-settlement-sweep.service.ts           # 新：@Cron 日终
├── controllers/settlement-admin.controller.ts      # 新：结算批次 list/detail + 手动触发(DEV)
├── dto/settlement-query.dto.ts                     # 新
└── funds-layer.module.ts                           # 改：wiring
src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-scheduler.service.ts  # 改：禁用 @Cron
admin-web/src/pages/funds-layer/SettlementListPage.tsx + SettlementDetailPage.tsx               # 新
```

> **B 类 drain 记账方向（设计推导，最终以余额测试为准）：**
> swap 把 FROM 资产 credit 进 TRADE_CLEARING、TO 资产 debit 出 TRADE_CLEARING。故每资产 `TRADE_CLEARING[X]` 净额 = Σfrom(X) − Σto(X) = Outstanding OUT − Outstanding IN = `-(net)`（net=IN−OUT）。
> - **net>0（客户净买入 X，INTERNAL_IN：F_LIQ→C_MAIN）**：TRADE_CLEARING[X] 为净 debit 余额 → 需 **credit TRADE_CLEARING** 归零 → `CUSTODY[X] debit → TRADE_CLEARING[X] credit`，amount=|net 对应的 clearing 余额|。
> - **net<0（客户净卖出 X，INTERNAL_OUT：C_MAIN→F_LIQ）**：TRADE_CLEARING[X] 为净 credit 余额 → 需 **debit TRADE_CLEARING** 归零 → `TRADE_CLEARING[X] debit → CUSTODY[X] credit`。
> drain amount 以**实际 `lookupBalance(TRADE_CLEARING[X])` 净额绝对值**为准（而非重算 net），确保归零。实现 Step 用余额查询取 drain 量。

---

# Task 3.1: TB amount 工具 + B 类 drain 记账（核心，TDD 余额验证）

**Files:**
- Create: `src/modules/funds-layer/accounting/tb-amount.util.ts`
- Modify: `src/modules/funds-layer/accounting/funds-accounting.service.ts` (+ spec)

- [ ] **Step 1: 提取共享 decimalToBigint 工具**

`tb-amount.util.ts`（从 `swap-workflow.service.ts:41-46` 搬，纯函数）：
```typescript
import { Prisma } from '@prisma/client';
export function decimalToBigint(decimalValue: Prisma.Decimal | string | number, decimals: number): bigint {
  const str = String(decimalValue);
  const neg = str.startsWith('-');
  const body = neg ? str.slice(1) : str;
  const [whole, frac = ''] = body.split('.');
  const paddedFrac = frac.padEnd(decimals, '0').slice(0, decimals);
  const v = BigInt((whole || '0') + paddedFrac);
  return neg ? -v : v;
}
```

- [ ] **Step 2: 写 B 类 drain 的失败测试（余额断言锁定方向）**

`funds-accounting.service.spec.ts`：mock `AccountingService`（`resolveTbAccountId` 返回固定 bigint、`lookupBalance` 返回构造的余额、`executeTransfer` jest.fn）。`applyAccounting` 入参扩展为携带 drain 所需上下文（assetId、assetCurrency、ledger、decimals、drainAccount、direction、amount/或由 lookupBalance 决定）。用例：
- **INTERNAL_OUT (net<0, TRADE_CLEARING 净 credit)**：lookupBalance 返回 credit>debit → applyAccounting 调 `executeTransfer({ debitAccountId: TRADE_CLEARING, creditAccountId: CUSTODY, amount: |balance|, ledger, code: EOD_DRAIN_OUT, evidence })`。断言 debit=TRADE_CLEARING、credit=CUSTODY。
- **INTERNAL_IN (net>0, TRADE_CLEARING 净 debit)**：断言 `executeTransfer({ debitAccountId: CUSTODY, creditAccountId: TRADE_CLEARING, ... code: EOD_DRAIN_IN })`。
- **A 类**：仍返回 `{tbApplied:false}`，不调 executeTransfer。
- **B 类 FEE_COLLECT（drain=FEE_RECEIVABLE）**：Phase 4 才用；本 task 可留 `FEE_RECEIVABLE` 分支为 NotImplemented 或 TODO（不在 Phase 3 验收）。

> 注意：`applyAccounting` 现签名 `{ accountingClass, internalTransferId }` 太薄。扩展为接收 transfer 的完整上下文（assetId/currency/decimals/path/drainAccount/fromRole/toRole/amount）。由 workflow（Task 3.3）在调用前组装，或 applyAccounting 内部用 internalTransferId 读 transfer 行拿上下文——**优先后者**（applyAccounting 自己读 internalTransaction 行 + asset），保持 workflow 薄。实现时确定一种并在 spec 固定。

- [ ] **Step 3: 实现 B 类 drain**

`applyAccounting`：
- A 类：`return { tbApplied: false }`。
- B 类 + drain='TRADE_CLEARING'：读 transfer 行（assetId、pathLabel）+ asset（currency/decimals）→ resolve TB ledger（`TB_LEDGERS[currency]`）→ resolve `TRADE_CLEARING(SYSTEM)` + `CUSTODY(SYSTEM)` 账户 → `lookupBalance(TRADE_CLEARING)` 取净额（creditsPosted−debitsPosted）→ drain amount = |净额|（若为 0 直接 return tbApplied:false，无需 drain）→ 按符号决定方向（credit 余额→debit TRADE_CLEARING；debit 余额→credit TRADE_CLEARING）→ `executeTransfer(...)` with evidence（sourceType 'EOD_SETTLEMENT'、eventCode EOD_DRAIN_IN/OUT、debit/credit code、traceId from transfer、actorType SYSTEM）→ `return { tbApplied: true, tbTransferId }`。
- B 类 + drain='FEE_RECEIVABLE'：`throw NotImplementedException('FEE_COLLECT drain is Phase 4')`（保留）。
- 新增 TB transfer code 常量 `EOD_DRAIN_IN` / `EOD_DRAIN_OUT`（在 tb-transfer-codes 常量文件加；若该文件被用户 WIP 改动则改用本地常量并报告）。

- [ ] **Step 4: 运行 → PASS。** `npm run build` 0 错误。

- [ ] **Step 5: Commit**（显式路径）
```bash
git add src/modules/funds-layer/accounting/tb-amount.util.ts src/modules/funds-layer/accounting/funds-accounting.service.ts src/modules/funds-layer/accounting/funds-accounting.service.spec.ts
# 若改了 tb-transfer-codes 常量，显式 add 该文件
git commit -m "feat(v7-phase3): B-class TRADE_CLEARING drain accounting + shared tb-amount util"
```

---

# Task 3.2: Outstanding consumer + settlement batch 轧差（domain）

**Files:**
- Create: `src/modules/funds-layer/domain/outstanding-consumer.service.ts` (+ spec)
- Create: `src/modules/funds-layer/domain/settlement-batch.service.ts` (+ spec)

- [ ] **Step 1: OutstandingConsumerService（读 + lock + settle，操作 Outstanding/OutstandingSettlement 表）**

方法（参考旧 `OutstandingsService`/`OutstandingSettlementsService` 的查询，但 crypto-only + 走 V7 状态）：
- `findOpenCryptoOutstandingByAsset()`: 查 `status='OPEN'`、`asset.type='CRYPTO'`、未锁 的 Outstanding，按 assetId 分组返回 `{ assetId, assetCurrency, decimals, inAmount, outAmount, net, outstandingIds[] }`（net=ΣIN−ΣOUT）。
- `createSettlementBatch(cutoffAt, tx?)`: 创建 `OutstandingSettlement`（settlementType='EOD'、settlementNo 自增 'OSB'、requestId 幂等键）。
- `lockOutstanding(outstandingIds, settlementId, tx?)`: updateMany OPEN→LOCKED + settlementId。
- `settleOutstanding(settlementId, assetId, internalFundId, tx?)`: 该资产 LOCKED 的 Outstanding → `status='SETTLED'` + `closedByInternalFundId` + `closedAt`。
- `markNettedZero(...)`: net=0 资产的 Outstanding 直接 SETTLED（无 transfer）。

测试：分组净额计算、lock guard（只锁 OPEN）、settle guard（只结 LOCKED）。

- [ ] **Step 2: SettlementBatchService（轧差方向，port `resolveExecutionDirection` 的 CRYPTO 分支）**

```typescript
resolveCryptoDirection(net: Prisma.Decimal): { path: 'INTERNAL_IN'|'INTERNAL_OUT'; fromRole: string; toRole: string; amount: Prisma.Decimal } | null {
  if (net.eq(0)) return null;
  if (net.gt(0)) return { path: 'INTERNAL_IN',  fromRole: 'F_LIQ',  toRole: 'C_MAIN', amount: net };          // 客户净买入→补货
  return                 { path: 'INTERNAL_OUT', fromRole: 'C_MAIN', toRole: 'F_LIQ', amount: net.abs() };      // 客户净卖出→出货
}
```
测试三分支（net>0/net<0/net=0）。

- [ ] **Step 3: 运行 → PASS；build 0 错误。Commit**（显式路径，4 文件）
```bash
git commit -m "feat(v7-phase3): outstanding consumer + settlement netting (crypto)"
```

---

# Task 3.3: EOD 结算 workflow（L3 编排）

**Files:**
- Create: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts` (+ spec)
- Modify: `funds-layer.module.ts`（providers + imports clearing-settle 的 Outstanding 模块所需依赖）

- [ ] **Step 1: 写失败测试**

mock OutstandingConsumerService、SettlementBatchService、InternalTransferWorkflowService、SystemWalletResolver。`runEodSettlement(operatorId='SYSTEM')`：
- 取候选分组 → 创建 settlement batch → 每资产：net=0 → markNettedZero；net≠0 → resolveCryptoDirection → resolve C_MAIN+F_LIQ wallet → lockOutstanding → `initiate({ path 由 from/to role 推出, fromRole, toRole, sourceType:'EOD_SETTLEMENT', sourceId:`${settlementId}:${assetId}`, ownerType:'PLATFORM', assetId, amount, fromWalletId, toWalletId, triggerSource:'EOD' })` → 记录 settlement item 关联 transfer。
- **幂等**：已存在该 sourceId 的 transfer → 跳过创建。已 SETTLED 的 Outstanding 不重复纳入（findOpen 只取 OPEN）。
- 用例：单资产 net>0 → INTERNAL_IN initiate；单资产 net=0 → 无 initiate、直接 settle；幂等重跑不重复。

- [ ] **Step 2: 实现**；**Outstanding 结算时机**：transfer 的 funds-flow 在 simulate 走到 CLEAR 时发 `fundsflow.status.changed`；eod-settlement-workflow `@OnEvent('fundsflow.status.changed')`（newStatus CLEAR 且 transfer.sourceType='EOD_SETTLEMENT'）→ 调 `settleOutstanding(settlementId, assetId, fundsFlowId)` 标 SETTLED。（参考旧引擎的 @OnEvent 关闭逻辑，但走 V7。）

> 注意（来自 Phase 1 评审）：`FundsFlowService.updateStatus` 仅在**非 tx** 路径 emit 事件；simulate 端点是非 tx，故 EOD transfer 的执行 leg 经 simulate 推进时事件会触发本 @OnEvent。

- [ ] **Step 3: 运行 → PASS；build 0 错误。Commit**（显式路径）
```bash
git commit -m "feat(v7-phase3): EOD settlement workflow (netting→INTERNAL_OUT/IN→consume Outstanding)"
```

---

# Task 3.4: EOD @Cron sweep + 退休旧引擎 cron

**Files:**
- Create: `src/modules/funds-layer/sweep/eod-settlement-sweep.service.ts`
- Modify: `funds-layer.module.ts`（provider）
- Modify: `src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batch-scheduler.service.ts`（禁用 @Cron）

- [ ] **Step 1: EOD sweep（@Cron 日终，参考 pool-settlement-batch-scheduler 的 cron 表达式 `'0 59 23 * * *'` Dubai）**
```typescript
@Cron('0 59 23 * * *', { timeZone: 'Asia/Dubai' })
async handle() {
  const res = await this.workflow.runEodSettlement('CRON');
  this.logger.log(`EOD settlement: batch=${res.settlementNo} assets=${res.assetCount} ...`);
}
```

- [ ] **Step 2: 禁用 PoolSettlementBatch 的 cron**：在 `pool-settlement-batch-scheduler.service.ts` 把 `@Cron(...)` 装饰器**移除/注释**，并在方法体加 `this.logger.warn('PoolSettlementBatch EOD cron retired — superseded by V7 EodSettlementSweepService')` 或直接清空方法。**保留类**（避免删 provider 引发连锁），仅停用 cron。若该文件被用户 WIP 改动（`git status` 检查）则报告并协调。

- [ ] **Step 3: build 0 错误；funds-layer 测试全过。Commit**（显式路径，3 文件）
```bash
git commit -m "feat(v7-phase3): EOD settlement @Cron + retire PoolSettlementBatch cron"
```

---

# Task 3.5: Settlement Admin 页面（前端）+ controller

**Files:**
- Create: `src/modules/funds-layer/controllers/settlement-admin.controller.ts` + `dto/settlement-query.dto.ts`
- Modify: `funds-layer.module.ts` + `rbac.catalog.ts`
- Create: `admin-web/src/pages/funds-layer/SettlementListPage.tsx` + `SettlementDetailPage.tsx` + 路由

- [ ] **Step 1: controller**（mirror Phase 1 funds-layer controller 的 guard）：`GET /admin/funds-layer/settlements`（list）+ `GET :settlementNo`（detail，含 items + 关联 transfer + Outstanding 消费快照）+ `POST /admin/funds-layer/settlements/run`（DEV 手动触发 runEodSettlement）。OutstandingConsumerService 加只读查询方法。rbac 加路由（权限组复用或新增 `SETTLEMENT_READ/WRITE`——参考 Phase 0 的 INTERNAL_TRANSFER 权限做法；若 rbac.catalog 被用户 WIP 改动则报告）。
- [ ] **Step 2: 前端**（遵循 frontend-admin.md：mirror Phase 1 InternalTransfer 列表/详情；adminFetch、adm-* token、两栏布局、Manual Simulation 区放手动触发 + simulate 各资产 transfer 的执行 leg）。登记 sidebar 字段到 frontend-admin.md。
- [ ] **Step 3: `npm run build` + `cd admin-web && npx tsc -b`（只确认无新增 funds-layer 错误）。Commit**（显式路径，含 frontend-admin.md）
```bash
git commit -m "feat(v7-phase3): settlement admin list/detail + run endpoint"
```

---

# Task 3.6: 退休 OutstandingSettlements + 完整删除评估

**Files:** 视评估而定

- [ ] **Step 1: 确认 OutstandingSettlementsService 已无活跃触发**：grep 其 `createManual`/controller 的调用点。若仅剩 admin controller 手动入口，移除该 controller 路由（或整 controller）+ rbac，使其不可触发。
- [ ] **Step 2: PoolSettlementBatch 评估**：cron 已停（3.4）。其 service/controller 是否还有其它调用？grep。若无，标 retired。
- [ ] **Step 3: 完整删除 vs 保留 dormant**：两套引擎涉及 `OutstandingSettlement`/`Item`/`PoolSettlementBatch`/`Item` 表 + Outstanding 的 `lockedByPoolSettlementBatchId` 等链接字段。**本 task 只做"停用 + 移除触发入口"，不删表**（删表牵涉 schema migration + 用户并发 schema cleanup，风险高）→ 完整代码/表删除记为独立后续 task，删前与用户确认。报告里列出"已停用但未删"的清单。
- [ ] **Step 4: build + 测试。Commit**（显式路径）
```bash
git commit -m "feat(v7-phase3): retire OutstandingSettlements + PoolSettlementBatch trigger surfaces"
```

---

## Phase 3 验收清单

- [ ] `npm run dev:rebuild && npm run build` 通过；无新增失败
- [ ] **TB 余额硬门**：构造若干 swap（产生 Outstanding + TRADE_CLEARING 余额）→ 跑 `runEodSettlement` → simulate 各 INTERNAL_OUT/IN transfer 的执行 leg 到 CLEAR → 断言每资产 `lookupBalance(TRADE_CLEARING[asset])` 净额 = 0；CUSTODY 相应变动；Outstanding 全 SETTLED
- [ ] net=0 资产直接 SETTLED 无 transfer
- [ ] EOD 重跑幂等（已 SETTLED 跳过，无重复 transfer/drain）
- [ ] PoolSettlementBatch cron 已停用；OutstandingSettlements 无触发入口；无两引擎抢单
- [ ] FIAT Outstanding 被跳过（留法币轮次）
- [ ] Admin settlement 页可观测批次 + 轧差明细 + Outstanding 消费

## 明确排除
- FEE_COLLECT 的 FEE_RECEIVABLE drain（Phase 4）
- FIAT EOD 结算（法币轮次）
- 两套旧引擎的**代码/表完整删除**（独立后续 task，删前确认）
- ReimbursementObligation 结算（PoolSettlementBatch 停用后留 OPEN，Phase 5 处理）
