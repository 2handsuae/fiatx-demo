# funds_orders 三合一 + V7/V8 结算残留清除 — 设计规格 (Round 2)

**Date**: 2026-07-01
**Author**: brainstorming with owner
**Status**: Design approved, ready for planning
**Base branch**: `main` at `1072697`
**Target branch**: `refactor/funds-orders-round2`
**Supersedes**: `2026-06-28-funds-orders-merger-design.md`(Round 1,已 reset,起点错)

---

## 上一轮教训(Round 1)

Round 1 的核心错误是**新建 funds_orders 表并 backfill**,而不是**扩展 internal_funds 表接纳 payin/payout**。24 commits 走完后表数量从 3 张变 4 张,对账层完全没锚定,3 张目标表(payin/payout/internal_funds)一张没删。上一轮设计在 spec 阶段就没提出"复用现有表"这条路,直奔"造新表",导致后续所有工作建立在错误起点。

Round 2 的核心矫正:
- 表 rename(`internal_funds` → `funds_orders`),不新建
- 一次切干净 event 驱动,不搞 dormant handler 双路径
- 对账 repo 抽象**先做**再删死码,顺序正确
- Scope 扩到清除整个 V7/V8 延迟结算体系(EOD/settlement_batches/outstandings/fee_accruals + 5 workflow)

---

## §1 Overview

### 目标(One-liner)

把 payin / payout / internal_funds 三张表合并到 funds_orders 一张(rename + 加字段),workflow 走 event 驱动,顺便清除 V7/V8 延迟结算残留(3 张表 + 5 workflow + 相关 service/controller/event/DTO)。

### 核心决策

| # | 决策 |
|---|---|
| 表 | `internal_funds` rename → `funds_orders`,model `InternalFund` → `FundsOrder` |
| 状态机 | CREATED → SUBMITTED → CONFIRMING → CONFIRMED → CLEARED(+ FAILED / TIMEOUT),**无 NEEDS_REVIEW** |
| 父 FK | 3 个可空 FK 并列(`depositTransactionId` / `withdrawTransactionId` / `swapTransactionId`),一行只挂一个非空 |
| Service | `FundsOrderService`(纯数据 API,不写 audit),4 方法(create / advance / findById / findByParent) |
| Event 契约 | `funds_order.status.changed` 由 service emit,3 workflow 监听 |
| Audit 归属 | **workflow 层写**(不在 domain 层写),audit 只记业务事件不记技术操作 |
| 对账 repo | `FundsOrderSourceRepo` 5 方法覆盖 payin/payout/internal/outstanding/feeAccrual 视角,recon 五公式不动 |
| Admin UI | 前端 4 页 → 2 页(FundsOrderList + FundsOrderDetail + 顶部 tab) |
| 结算残留 | 5 workflow + 3 表(settlement_batches / outstandings / fee_accruals)+ InternalTransaction 全套 + 相关事件 全部删 |

### 范围

**In**:后端 funds-layer / trading / asset-treasury 全部;DB migration;Admin UI 前端;对账数据源

**Out(禁区)**:reconciliation 核对语义(credit-net 五公式、run/case scoreboard、CoA snapshot、breakout);V4/V5 三层收敛 + P6 余额锁漏洞;RETURNED 状态

### 硬 gate

**业务不断 = 刚性**:每个 commit 结束前,`demo:all` 10/10 + `verify:coa` PASS + `tsc` 0 errors。不到不 commit。

---

## §2 数据模型

### funds_orders 表结构

**从 internal_funds 继承的 32 列不动**(以下有变化的):
- `internalFundNo` → `fundsOrderNo`(rename)

**新加 1 列**:
- `depositTransactionId TEXT NULL REFERENCES deposit_transactions(id) ON DELETE SET NULL`

**删掉 1 列**:
- `internalTransactionId`(随 InternalTransaction model 一起废弃)

### Prisma model

```prisma
model FundsOrder {
  id                    String @id @default(cuid())
  fundsOrderNo          String @unique

  // 3 nullable parent FKs — exactly one non-null
  depositTransactionId  String?
  deposit               DepositTransaction?  @relation(fields: [depositTransactionId], references: [id], onDelete: SetNull)

  withdrawTransactionId String?
  withdraw              WithdrawTransaction? @relation(fields: [withdrawTransactionId], references: [id], onDelete: SetNull)

  swapTransactionId     String?
  swap                  SwapTransaction?     @relation(fields: [swapTransactionId], references: [id], onDelete: SetNull)

  status                String @default("CREATED")
  legSeq                Int    @default(1)
  attempt               Int    @default(1)

  // 其余 27 列(assetId, amount, feeAmount, netAmount, fromWalletId/Address/Iban,
  // toWalletId/Address/Iban, txHash, confirmations, blockNo, nonce, gasUsed,
  // effectiveGasPrice, referenceNo, providerTxnId, sentAt, confirmedAt,
  // completedAt, statusHistory, createdAt, updatedAt, ...)

  @@index([depositTransactionId])
  @@index([withdrawTransactionId])
  @@index([swapTransactionId, legSeq])
  @@index([status])
  @@index([txHash])
  @@index([referenceNo])
  @@unique([swapTransactionId, legSeq, attempt])
}
```

### legSeq / attempt 语义(通用)

| 父类型 | legSeq | attempt |
|---|---|---|
| DEPOSIT(payin) | 恒 1 | crypto reorg 后重发观察 = 2, 3... 默认 1 |
| WITHDRAW(payout 主腿 + fee 腿) | 1 = payout 主腿, 2 = fee 腿 | payout 广播失败 re-closeout 后 +1 |
| SWAP(4 legs) | 1..4 | self-heal 重建 +1(≤3 次) |

`(父FK, legSeq, attempt)` 唯一,支持 self-heal 时不删旧行(旧行保留 FAILED/TIMEOUT 终态给审计)。

### 数据不变量守护

**"exactly one parent FK non-null"** 由 **service 层守**(`FundsOrderService.create()` 检查),**不加 DB CHECK constraint**。理由:Prisma migrate 不直接支持 CHECK,手写 SQL 后续维护复杂;service 单一 owner 已经足够。测试覆盖 3 FK 各种组合(0 非空 / 2 非空 / 3 非空)必须 throw。

### 未来扩展预留

3 FK 目前够。扩到 5-6 FK(加 reimbursement / firm-transfer / adjustment)仍是 acceptable pattern。超过 8-10 FK 时再重构成 `sourceType / sourceId` 抽象。service 层暴露 `getSourceRef(fundsOrder)` 统一返回 `{type, id, entity}`,业务代码不直接读 FK 列,便于未来重构。

### Migration SQL 骨架

```sql
-- 1. rename 表
ALTER TABLE internal_funds RENAME TO funds_orders;
ALTER TABLE funds_orders RENAME COLUMN internalFundNo TO fundsOrderNo;

-- 2. 加 depositTransactionId FK
ALTER TABLE funds_orders ADD COLUMN depositTransactionId TEXT NULL
  REFERENCES deposit_transactions(id) ON DELETE SET NULL;
CREATE INDEX funds_orders_depositTransactionId_idx ON funds_orders(depositTransactionId);

-- 3. drop 老的 internalTransactionId 列(SQLite 3.35+ 直接支持 DROP COLUMN,项目已在此版本以上)
ALTER TABLE funds_orders DROP COLUMN internalTransactionId;

-- 4. drop 死表(顺序:先 dependent 后 parent)
DROP TABLE payin;
DROP TABLE payout;
DROP TABLE outstandings;
DROP TABLE fee_accruals;
DROP TABLE settlement_batches;
DROP TABLE internal_transaction_audit_logs;
DROP TABLE internal_transactions;

-- 5. drop legacy FK 列
ALTER TABLE deposit_transactions DROP COLUMN payinId;
ALTER TABLE withdraw_transactions DROP COLUMN payoutId;
ALTER TABLE withdraw_transactions DROP COLUMN payoutNo;
ALTER TABLE withdraw_transactions DROP COLUMN payoutRequestedAt;
```

---

## §3 状态机

### 7 状态 + 6 action

```typescript
enum FundsOrderStatus {
  CREATED, SUBMITTED, CONFIRMING, CONFIRMED, CLEARED,
  FAILED, TIMEOUT,
}

enum FundsOrderAction {
  SUBMIT, OBSERVE_CONFIRMING, CONFIRM, CLEAR,
  FAIL, TIMEOUT,
}
```

### 4 转移图

**crypto OUT / INTERNAL**(withdraw payout crypto / swap 4 legs):
```
CREATED —SUBMIT→ SUBMITTED —OBSERVE_CONFIRMING→ CONFIRMING —CONFIRM→ CONFIRMED —CLEAR→ CLEARED
```

**fiat OUT**(withdraw payout fiat,银行只通知一次):
```
CREATED —SUBMIT→ SUBMITTED —CONFIRM→ CONFIRMED —CLEAR→ CLEARED
```

**crypto IN**(deposit crypto,入口就在链上):
```
SUBMITTED —OBSERVE_CONFIRMING→ CONFIRMING —CONFIRM→ CONFIRMED —CLEAR→ CLEARED
```

**fiat IN**(deposit fiat,银行 webhook 已 settled):
```
CONFIRMED —CLEAR→ CLEARED
```

**分支**(任意非终态 → 终态):`FAIL` → FAILED / `TIMEOUT` → TIMEOUT / CLEARED/FAILED/TIMEOUT 是终态不可转出。

### 各资金单初始状态

| 父类型 + asset | 初始 status |
|---|---|
| DEPOSIT (payin) crypto | SUBMITTED |
| DEPOSIT (payin) fiat | CONFIRMED |
| WITHDRAW (payout 主腿) crypto/fiat | CREATED |
| WITHDRAW (fee 腿) | CREATED |
| SWAP (leg 1..4) | CREATED |

### Self-heal(swap 专属)

**不进 NEEDS_REVIEW**(状态机干净):

```
swap leg attempt=1 → FAILED/TIMEOUT (event fired)
  ↓ SwapWorkflow @OnEvent 监听
判断 attempt < MAX_LEG_ATTEMPTS(3)?
  ├── 是 → 新建 (legSeq, attempt+1) funds_order(初始 CREATED),旧行留 FAILED/TIMEOUT 终态
  └── 否 → 打 swap.needsReview = true,swap 状态维持 PROCESSING,不再自动推进
```

**需要人工介入的 signal 打在父实体**(swap.needsReview),资金单本身保持终态,状态机语义纯净。

### 双语 UI 标签

| status | crypto 中/英 | fiat 中/英 |
|---|---|---|
| CREATED | 已建单 / Created | 已建单 / Created |
| SUBMITTED | **已广播 / Broadcasted** | **处理中 / Processing** |
| CONFIRMING | 链上确认中 / Confirming | — |
| CONFIRMED | 已确认 / Confirmed | 已到账 / Settled |
| CLEARED | 已完成 / Cleared | 已完成 / Cleared |
| FAILED | 失败 / Failed | 失败 / Failed |
| TIMEOUT | 超时 / Timeout | 超时 / Timeout |

判断 crypto vs fiat 靠 `funds_order.asset.type`。

---

## §4 FundsOrderService + Event 契约

### 架构理念

- **funds_order = 表(数据层)+ 单一 owner service(纯数据 API)**
- **workflow = 业务决策层,owns audit**
- **audit 只记业务事件,不记技术操作**

### 4 个公开方法

```typescript
class FundsOrderService {
  async create(input: CreateFundsOrderInput, tx?): Promise<FundsOrder>
  async advance(id: string, action: FundsOrderAction, operatorId: string, tx?): Promise<FundsOrder>
  async findById(id: string, tx?): Promise<FundsOrder | null>
  async findByParent(
    parent: {depositTransactionId?} | {withdrawTransactionId?} | {swapTransactionId?},
    filter?: {legSeq?, attempt?, status?}
  ): Promise<FundsOrder[]>
}
```

### advance() 原子步骤

```
BEGIN TRANSACTION
  1. SELECT funds_order FOR UPDATE
  2. 查转移表 → nextStatus(非法 throw InvalidTransitionException)
  3. UPDATE status + statusHistory JSON append({fromStatus, toStatus, action, at})
COMMIT
4. eventEmitter.emit('funds_order.status.changed', payload)   ← commit 之后 emit
5. return updated
```

**不写 audit**(audit 归 workflow)。`statusHistory` 是数据层技术日志,不是 audit。

### Event 契约

```typescript
FUNDS_ORDER_STATUS_CHANGED: {
  name: 'funds_order.status.changed',
  emitter: 'FundsOrderService',
  subscribers: ['DepositWorkflow', 'WithdrawWorkflow', 'SwapWorkflow'],
  payload: {
    fundsOrderId: string,
    fundsOrderNo: string,
    parent: {
      depositTransactionId?: string,   // 三者其一非空
      withdrawTransactionId?: string,
      swapTransactionId?: string,
    },
    legSeq: number,
    attempt: number,
    oldStatus: FundsOrderStatus | null,   // null = 新建
    newStatus: FundsOrderStatus,
    traceId?: string,
  }
}
```

Workflow filter 用 `event.parent.xxxTransactionId` 非空判断,一句话。

### Workflow handler 模板

```typescript
@OnEvent(DomainEventNames.FUNDS_ORDER_STATUS_CHANGED)
async handleFundsOrderChanged(event) {
  if (!event.parent.depositTransactionId) return;  // filter
  
  switch (event.newStatus) {
    case FundsOrderStatus.CONFIRMED:
      await this.onPayinConfirmed(event);
      // 内部:
      // 1. 判业务场景 → auditLogsService.recordSystem({action:'DEPOSIT_PAYIN_CONFIRMED', ...})
      // 2. TB posting
      // 3. fundsOrderService.advance(fo.id, CLEAR, 'SYSTEM')  ← sync method call
      // 4. depositService.updateStatus(dep.id, PAYIN_CONFIRMED)
      break;
  }
}
```

**规则**:handler 内部**不再 emit 业务 event**;跨主体 event 目前为 0(SWAP_SUCCEEDED / INTERNALTRANSFER_COMPLETED 都在清除清单)。

---

## §5 3 Workflow 改造

### 5.1 DepositWorkflow

**入口**:webhook / inbound-transfer-signals / demo → `depositService.detected(input)`

**detected() 内部原子**:
```
1. INSERT deposit_transactions(status=PAYIN_PENDING, traceId=new)
2. fundsOrderService.create({depositTransactionId, ..., initialStatus: crypto ? SUBMITTED : CONFIRMED})
3. auditLogsService.recordSystem({action:'DEPOSIT_CREATED', entityType:'DEPOSIT_TRANSACTION', ...})
```

**事件监听**(filter `event.parent.depositTransactionId`):

| newStatus | 动作 |
|---|---|
| SUBMITTED / CONFIRMING | no-op |
| CONFIRMED | onPayinConfirmed:audit → TB posting CLIENT_ASSET→DEPOSIT_SUSPENSE → advance(CLEAR) → deposit 推 COMPLIANCE_PENDING |
| CLEARED | no-op(deposit 后续走 compliance) |
| FAILED / TIMEOUT | depositService.updateStatus(FAILED) + audit DEPOSIT_PAYIN_FAILED |

### 5.2 WithdrawWorkflow

**入口**:客户 API → `withdrawWorkflowService.createWithdrawal(input)`

**createWithdrawal() 内部原子**:
```
1. INSERT withdraw_transactions + 锁 TB 余额(净额 + fee pending)
2. audit WITHDRAW_CREATED
```

**KYT+TravelRule PASSED 后 initiatePayoutPhase**:
```
1. fundsOrderService.create({withdrawTransactionId, legSeq:1, initialStatus:CREATED})   ← payout 主腿
2. 若有 fee: fundsOrderService.create({withdrawTransactionId, legSeq:2, initialStatus:CREATED})   ← fee 腿
3. audit WITHDRAW_PAYOUT_INITIATED
4. withdrawService.updateStatus(wd, PAYOUT_PENDING)
```

**Controller admin repair 端点**:直接调 `fundsOrderService.advance(fo.id, ACTION)`。

**事件监听**(filter `event.parent.withdrawTransactionId`):

| newStatus | leg | 动作 |
|---|---|---|
| SUBMITTED / CONFIRMING | 主腿 | no-op |
| CONFIRMED | 主腿 | audit WITHDRAW_PAYOUT_CONFIRMED → TB CLIENT_PAYABLE→BANK_ACCOUNT → advance(CLEAR) |
| CONFIRMED | fee 腿 | TB fee posting → advance(CLEAR) |
| CLEARED | 主 & fee 都 CLEARED | audit WITHDRAW_SUCCESS → withdrawService.updateStatus(SUCCESS) → 解 TB 锁 |
| FAILED / TIMEOUT | 主腿 | audit WITHDRAW_PAYOUT_FAILED → withdrawService.updateStatus(FAILED) + releaseLock(退回,堵 P6 漏洞) |

### 5.3 SwapWorkflow

**入口**:客户 API → `swapWorkflowService.executeSwap(customerId, quoteId)`

**executeSwap() 内部原子**:
```
1. INSERT swap_transactions(status=PROCESSING, traceId=new)
2. TB 锁客户 from 侧资产 + fee pending
3. fundsOrderService.create({swapTransactionId, legSeq:1, attempt:1, initialStatus:CREATED})   ← 只建 leg1
4. audit SWAP_CREATED
```

**Controller admin advance 端点**:`POST /admin/swaps/:id/legs/:legSeq/actions/:action` → `fundsOrderService.advance(fo.id, ACTION)`。

**事件监听**(filter `event.parent.swapTransactionId`):

| newStatus | 动作 |
|---|---|
| SUBMITTED / CONFIRMING / CONFIRMED | no-op |
| CLEARED | audit SWAP_LEG_CLEARED → 判 leg<4? 建下一 leg(初始 CREATED):swap 全完 → audit SWAP_SUCCEEDED + swapService.updateStatus(SUCCESS) + 解 TB 锁 |
| FAILED / TIMEOUT | Self-heal:attempt<3? 建 (legSeq, attempt+1) 新行 + audit SWAP_LEG_RETRIED:打 swap.needsReview=true + audit SWAP_LEG_STUCK |

### 跨主体 event(全部清除)

`SWAP_SUCCEEDED` / `INTERNALTRANSFER_COMPLETED` / `FUNDSFLOW_STATUS_CHANGED` 全删。本次 refactor 后跨主体 event = 0。

### funds-flow.service.ts 整个文件删

Swap-specific 方法在 Round 1 已删过;withdraw fee-fund / deposit internal-transfer / fee-accrual 方法本次一并删。剩下的搬到 FundsOrderService 或 workflow 内部。

---

## §6 对账 Repo + Admin UI

### 6.1 对账 Repo

**新建**:`src/modules/clearing-settle/reconciliation/data-source/funds-order-source.repo.ts`

```typescript
@Injectable()
export class FundsOrderSourceRepo {
  constructor(private prisma: PrismaService) {}
  
  findPayins(filter)         // depositTransactionId != null
  findPayouts(filter)        // withdrawTransactionId != null AND legSeq = 1
  findInternals(filter)      // swapTransactionId != null OR (withdrawTransactionId != null AND legSeq > 1)
  
  // 五公式专用(等价映射,recon 语义不动)
  findOpenOutstandings(currency, cutoff)
  //   funds_orders WHERE status IN (SUBMITTED,CONFIRMING,CONFIRMED)
  //     AND asset.currency = currency AND createdAt < cutoff
  //   按 direction 分正负 sum
  
  findFeeAccruals(currency, cutoff)
  //   funds_orders WHERE withdrawTransactionId != null AND legSeq > 1
  //     AND status IN (SUBMITTED,CONFIRMING,CONFIRMED)
  //     AND asset.currency = currency
}
```

### recon 改造 sites(10 处)

| 文件 | 现有 | 改成 |
|---|---|---|
| `internal-actions.service.ts:17` | `prisma.internalFund.findMany` | `repo.findInternals(...)` |
| `internal-actions.service.ts:32` | `prisma.payin.findMany` | `repo.findPayins(...)` |
| `internal-actions.service.ts:43` | `prisma.payout.findMany` | `repo.findPayouts(...)` |
| `leg-projection.service.ts:76` | `prisma.payin.findMany` | `repo.findPayins(...)` |
| `leg-projection.service.ts:91` | `prisma.payout.findMany` | `repo.findPayouts(...)` |
| `leg-projection.service.ts:102` | `prisma.internalFund.findMany` | `repo.findInternals(...)` |
| `in-transit.service.ts:20/34/51` | 混杂 | 对应 repo 方法 |
| `mock-external.adapter.ts:34` | `prisma.internalFund.findMany` | `repo.findInternals(...)` |
| `subledger-inputs.service.ts:21` | `prisma.outstanding.findMany` | `repo.findOpenOutstandings(...)` |
| `subledger-inputs.service.ts:81` | `prisma.feeAccrual.findMany` | `repo.findFeeAccruals(...)` |

Repo 内部 map funds_order 行到 outstanding/feeAccrual shape,recon 消费方零改动。

**语义不动**:credit-net 五公式、run/case scoreboard、CoA snapshot、breakout 全保持。

### 6.2 Admin UI

**后端 controller 从 4→1**:

```typescript
@Controller('admin/funds-orders')
export class FundsOrdersAdminController {
  @Get()  list(query)   // ?parent=deposit|withdraw|swap|all & status=... & limit=...
  @Get(':id')  detail(id)   // include 父实体
  @Post(':id/actions/:action')  repair(id, action)   // re-clear / re-fail 迁自 payout-closeout-repair
}
```

删旧 4 个 controller(payins.admin / payins / payouts / payout-closeout-repair)。RBAC catalog:删旧权限 + 加 `funds-orders/read` + `funds-orders/repair`。

**前端**:

删 4 页(PayinList/Detail、PayoutList/Detail),建 2 页:

- `FundsOrderList.tsx`:顶部 tab(全部 / 充值 / 提现 / 兑换)+ 表列(fundsOrderNo / status 双语 / 父业务号 / asset / amount / createdAt)+ 筛选 + 分页
- `FundsOrderDetail.tsx`:metadata 卡 + 动态字段块(crypto 显示 gas/tx hash / fiat 显示 referenceNo/providerTxnId)+ statusHistory 时间线 + 关联 audit 列表 + repair 按钮

**双语 helper**:`formatFundsOrderStatusLabel(status, assetType, lang)` 一份,不重复。

---

## §7 迁移阶段计划

7 个 commit,顺序刚性,每个 commit 独立可验证。

| # | 阶段 | 硬闸 |
|---|---|---|
| **C1** | schema + rename:migration + 全库 `InternalFund` → `FundsOrder` replace | tsc 0;demo:all 10/10;verify:coa PASS |
| **C2** | workflow event 重构:3 workflow 一次切干净到 `funds_order.status.changed`,不搞 dormant handler | 同上 |
| **C3** | 删 legacy payin/payout:service+dto+events+2 表+FK 列 | 同上 + grep 0 hit |
| **C4** | 对账 repo 抽象(5 方法,含 outstanding / feeAccrual);10 处 recon site 改造 | 同上 |
| **C5** | 清 V7/V8 结算残留:5 workflow + 3 表(settlement_batches/outstandings/fee_accruals)+ InternalTransaction + 事件常量 —— 此时 outstanding/feeAccrual 无读者才安全删 | 同上 |
| **C6** | Admin UI 合并:4 页 → 2 页 + 双语 helper + RBAC + 后端 controller 简化 | admin build ✓;preview 截图 |
| **C7** | 终检 + memory 更新 + ff-merge main | 全套 |

### 顺序关键点

- **C1 第一**:表 rename 不改功能,tsc + demo:all 应该都能过
- **C2 在 C3 前**:workflow 切新 event 之后才能删 legacy service
- **C4 在 C5 前**:recon 必须先迁到 repo,才能安全删 outstanding/feeAccrual 表
- **C5/C6 可换**:相互独立
- **C7 只验收**:不做 refactor

### 分支策略

- 分支名:`refactor/funds-orders-round2`
- 基于 `main = 1072697`
- 7 commit 独立,commit message 前缀 `C1:` .. `C7:`
- C7 完成后 ff-merge main

### 上一轮避坑清单

1. 不搞 dormant handler 双路径
2. 不搞 dual-write / mirror
3. 不搞 backfill(rename 表继承数据)
4. 不留 "defer 的表",本次 scope 都在
5. 每个 commit demo:all 硬闸,不到 10/10 不 commit
6. 业务不断刚性
7. **删表前必须先撬引用者**(recon 引用先迁 repo)

---

## §8 完成标准 + 验收清单

### "Refactor 完成"的硬定义

```bash
# 后端
npx tsc --noEmit -p tsconfig.json                              # 0 errors
npm run demo:all                                               # 10/10 asserts PASS
npm run verify:coa                                             # ALL INVARIANTS PASS
npx jest --silent                                              # 净新失败 = 0

# 前端
cd admin-web && npx tsc --noEmit && npm run build              # tsc 0 + build ✓
# preview 4 张截图(全部/充值/提现/兑换 tab,双语标签正确)
```

### grep 0-hit 清单

```bash
# legacy service / dto / event
grep -rn "PayinsService\|PayoutsService\|PayinStatus\|PayinAction\|PayoutStatus\|PayoutAction" src/
grep -rn "SWAP_SUCCEEDED\|INTERNALTRANSFER_COMPLETED\|FUNDSFLOW_STATUS_CHANGED" src/
grep -rn "InternalFundStatus\|InternalFundAction\|createSwapLeg\|transitionSwapLeg" src/

# legacy 结算残留
grep -rn "OutstandingsService\|FeeAccrualService\|SettlementBatchService" src/
grep -rn "EodSettlementWorkflow\|FiatSettlementWorkflow\|FiatFeeCollectionWorkflow" src/
grep -rn "DepositAggregationWorkflow\|FundTransferWorkflow\|InternalTransferWorkflow" src/
grep -rn "InternalTransactionService\|InternalTransferService" src/

# legacy prisma 表引用
grep -rn "prisma\.payin\b\|prisma\.payout\b\|prisma\.internalFund\b" src/
grep -rn "prisma\.outstanding\b\|prisma\.feeAccrual\b\|prisma\.settlementBatch\b" src/
grep -rn "prisma\.internalTransaction\b" src/
```

每条都必须 0 hit(可以有 .spec.ts 里的历史 mock,不算)。

### DB 表最终状态

**必须存在**:`funds_orders` / `deposit_transactions` / `withdraw_transactions` / `swap_transactions` / `audit_log_events` / `funds_order_audit_logs`(如有)

**必须不存在**:`payin` / `payout` / `internal_funds`(旧名)/ `outstandings` / `fee_accruals` / `settlement_batches` / `internal_transactions` / `internal_transaction_audit_logs`

```bash
sqlite3 /tmp/exchange_js_main/dev.db "
SELECT name FROM sqlite_master WHERE type='table' AND name IN (
  'payin','payout','internal_funds','outstandings','fee_accruals',
  'settlement_batches','internal_transactions'
);"
# 期望输出:空
```

### 交付物

- **代码**:main 前进到 refactor 完成的 commit(7 commit ff-merge)
- **spec**:本文件(`doc-final/superpowers/specs/2026-07-01-funds-orders-round2-design.md`)
- **preview 截图**:4 张 admin UI 截图作为 UI 完成证据
- **memory**:`funds-orders-round2-done.md` 收官 memory

### 关键守则(重申)

1. 业务不断硬 gate:每 commit demo:all 10/10 + verify:coa PASS
2. 禁区:recon 核对语义 一行不动 —— 只换数据源
3. 不搞双写 / dormant handler / backfill
4. RETURNED 状态 defer(spec 里标明)
5. audit 归 workflow,domain 不写

---

## §附录 A · 词汇表

- **funds_order** — 资金单,一笔资金流的载体(可以是充值 payin、提现 payout、swap 内部腿、withdraw fee 腿)
- **legSeq** — 资金单在同一父业务下的第几腿
- **attempt** — 同 legSeq 的第几次尝试(swap self-heal 用)
- **CLEARED** — 内部记账完成,终态
- **SUBMITTED** — 已提交(crypto=已广播 / fiat=处理中)
- **recon** — reconciliation,对账
- **CoA** — Chart of Accounts,会计科目表
- **credit-net 五公式** — V8 对账重构的核心公式(参考 [[v8-recon-redesign-done]] memory)
