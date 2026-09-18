# V7 Phase 3 — B 类记账 + EOD 兑换结算实现计划（全删旧引擎版）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkbox (`- [ ]`) steps.

**Goal:** V7 成为唯一的 EOD 兑换结算引擎：按资产轧差 OPEN Outstanding → 经通用内部转账工作流 spawn INTERNAL_OUT/IN（B 类，drain TRADE_CLEARING↔CUSTODY 真实 TB 记账）→ 消费 Outstanding 标 SETTLED → **彻底删除** Wave-8 的 PoolSettlementBatch + OutstandingSettlements 两套旧引擎（代码 + 表 + Outstanding/InternalTransaction/ReimbursementObligation 上的链接字段）。

**Architecture:** 复用 Phase 1 `InternalTransferWorkflowService.initiate`（B 类路径触发 `FundsAccountingService` drain 记账）。新建 funds-layer：`SettlementBatch`(+`Item`) 表（编排层，替代被删的 OutstandingSettlement）、settlement netting domain、eod-settlement-workflow、@Cron。crypto-only（FIAT Outstanding 留法币轮次）。

**Tech Stack:** NestJS · Prisma · SQLite · TigerBeetle · Jest · React

**依据 spec：** `doc-final/superpowers/specs/2026-06-03-v7-internal-transfer-crypto-mvp-design.md` §5 Phase 3 + §7 不变量。

**关键命令：** `npx jest <path>` · `npm run build` · `npm run dev:rebuild`

**⚠️ 并发 + git 纪律：** 用户已确认并行 session 已完全停、schema 干净。仍然：每个 subagent **只用显式精确路径 `git add`**，禁止 `git add -A`/`.`/`<dir>`；commit 前 `git status --short` 核对（用户仍有 4 个 admin-web 文件 dirty —— 勿动）。本分支有 ~34 后端 + ~11 admin-web pre-existing 失败，验收 = 不新增失败。

---

## 已锁定设计决策

1. **彻底删除旧两套引擎**（用户拍板"连代码/表一起删干净"）：删 `PoolSettlementBatch`/`PoolSettlementBatchItem`/`OutstandingSettlement`/`OutstandingSettlementItem` 四张表 + 对应模块代码；清理 `Outstanding`/`InternalTransaction`/`ReimbursementObligation` 上指向它们的链接字段与关系。**全部 schema 变更集中在 Task 3.0 一次做完**（趁 schema 干净，最小化撞车窗口）。
2. **V7 编排层新表**：`SettlementBatch`(+`SettlementBatchItem`)，funds-layer 拥有，替代被删的 OutstandingSettlement。字段最小：batchNo（'OSB' 自增）、settlementType='EOD'、cutoffAt、status、requestId（幂等键）、计数；Item 按资产记 net/方向/关联 transfer。
3. **Outstanding 改造**：移除 `settlementId`/`settlementItemId`/`lockedByPoolSettlementBatchId` + 其关系；新增 `settlementBatchId`/`settlementBatchItemId`（→ 新表）；状态加 `SETTLED`；保留 `closedByInternalFundId`。
4. **ReimbursementObligation**：移除 `lockedByPoolSettlementBatchId` + 关系（PoolSettlementBatch 删除后悬挂）；保留其余（Phase 5 用）。其原由 PoolSettlementBatch 顺带结算的逻辑随删除消失 → 义务留 OPEN，Phase 5 处理。
5. **B 类 drain TB 记账**：`TRADE_CLEARING(SYSTEM, asset) ↔ CUSTODY(SYSTEM, asset)`，drain 量 = `|lookupBalance(TRADE_CLEARING[asset]) 净额|`，方向取使 TRADE_CLEARING 归零。**验收硬门：EOD 后 `lookupBalance(TRADE_CLEARING[asset])` 净额 = 0**（TDD 余额断言锁方向）。
6. **netting crypto-only**；net 方向 C_MAIN↔F_LIQ；FIAT Outstanding 跳过。
7. **Outstanding 消费**：lock(OPEN→LOCKED+settlementBatchId) → funds-flow CLEAR 时 `status='SETTLED'`+`closedByInternalFundId`；幂等（已 SETTLED 跳过；net=0 直接 SETTLED 无 transfer）。

---

## 文件结构

```
prisma/schema.prisma                                  # 改：删4表 + 改 Outstanding/InternalTransaction/ReimbursementObligation + 加 SettlementBatch(+Item)
prisma/migrations/<ts>_v7_phase3_eod_settlement/      # 新
src/modules/clearing-settle/outstanding-settlements/  # 删整目录
src/modules/clearing-settle/pool-settlement-batches/  # 删整目录
src/modules/funds-layer/
├── accounting/tb-amount.util.ts                      # 新
├── accounting/funds-accounting.service.ts            # 改：B 类 drain
├── domain/settlement-batch.service.ts                # 新：批次 CRUD + netting 方向
├── domain/outstanding-consumer.service.ts            # 新：lock/settle Outstanding
├── workflow/eod-settlement-workflow.service.ts       # 新 L3
├── sweep/eod-settlement-sweep.service.ts             # 新 @Cron
├── controllers/settlement-admin.controller.ts + dto/ # 新
└── funds-layer.module.ts                             # 改
admin-web/src/pages/funds-layer/SettlementListPage.tsx + SettlementDetailPage.tsx  # 新
```

> **B 类 drain 方向（设计推导，余额测试为准）：** swap 把 FROM 资产 credit 进 TRADE_CLEARING、TO 资产 debit 出。故 `TRADE_CLEARING[X]` 净额 = `-(net)`（net=IN−OUT）。net>0（INTERNAL_IN）→ TRADE_CLEARING 净 debit → `CUSTODY debit → TRADE_CLEARING credit`；net<0（INTERNAL_OUT）→ 净 credit → `TRADE_CLEARING debit → CUSTODY credit`。drain 量取 `lookupBalance` 实际净额绝对值。

---

# Task 3.0: schema 手术 + 删除旧两套引擎（前置，一次性）

**Files:** schema.prisma、新 migration、删两个旧模块目录、清理引用点、app.module。

- [ ] **Step 1: 摸清旧引擎全部引用**
```bash
grep -rln "OutstandingSettlement\|outstanding-settlement\|PoolSettlementBatch\|pool-settlement-batch" src | grep -v node_modules
grep -rn "settlementId\|settlementItemId\|lockedByPoolSettlementBatchId\|poolSettlementBatchItemId\|outstandingSettlementItems" src prisma/schema.prisma | grep -v node_modules
```
列出全部引用（模块、controller、scheduler、Outstanding/InternalTransaction/ReimbursementObligation service 中对这些字段的读写、app.module 注册、rbac 路由、seed/reset 脚本）。

- [ ] **Step 2: 删两个旧模块目录**
```bash
git rm -r src/modules/clearing-settle/outstanding-settlements src/modules/clearing-settle/pool-settlement-batches
```
移除 app.module（及任何聚合 module）对 `OutstandingSettlementsModule` / `PoolSettlementBatchesModule` / scheduler 的 import + 注册。移除 rbac.catalog 中这两套的路由。

- [ ] **Step 3: schema.prisma 改造**
  - 删 model `OutstandingSettlement`、`OutstandingSettlementItem`、`PoolSettlementBatch`、`PoolSettlementBatchItem`。
  - `Outstanding`：删 `settlementId`/`settlementItemId`/`lockedByPoolSettlementBatchId` 字段 + 对应 `@relation` + 反向关系；删相关 `@@index`。新增 `settlementBatchId String?`、`settlementBatchItemId String?`（关系到新表）；保留 `closedByInternalFundId`、`status`（值域文档化加 `SETTLED`）。
  - `InternalTransaction`：删 `poolSettlementBatchItemId` + 关系 + `outstandingSettlementItems` 反向关系。
  - `ReimbursementObligation`：删 `lockedByPoolSettlementBatchId` + 关系。
  - 新增 model `SettlementBatch`（id、batchNo @unique、settlementType @default("EOD")、cutoffAt、status、requestId @unique、totalAssetCount/settledAssetCount/totalOutstandingCount/settledOutstandingCount、createdAt/updatedAt/completedAt、items 关系）+ `SettlementBatchItem`（id、settlementBatchId、assetId、assetCode、inAmount/outAmount/netAmount、direction、status、internalTransactionId?（关联 spawn 的 transfer）、outstandingCount/settledOutstandingCount、createdAt/closedAt）。加必要 `@@index`/`@@map`。
  - 给 Outstanding 加到新表的反向关系；给新表加 outstanding 反向关系。

- [ ] **Step 4: 清理 service 代码中对被删字段的读写**
  Step 1 grep 出的 Outstanding/InternalTransaction/ReimbursementObligation 等 service 里凡读写被删字段（settlementId 等）的地方，移除或改为新字段。`OutstandingsService.createForSwapSuccess`（V6 swap 建 Outstanding）——确认它不写被删字段（若写了 settlementId:null 之类，删那几行）。**不可破坏 V6 swap 建 Outstanding 的能力**。seed.base / reset 脚本若引用被删表则清理（显式 add）。

- [ ] **Step 5: 生成 migration（diff 法，避免 drift）**
```bash
npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script > /tmp/v7p3.sql
```
检查 `/tmp/v7p3.sql`：含 DROP 四表 + Outstanding/InternalTransaction/ReimbursementObligation 的表重建（去字段）+ CREATE 两新表。确认**不含**用户 WIP drift（无 admin-web 相关、无意外表）。放入 `prisma/migrations/<ts>_v7_phase3_eod_settlement/migration.sql`（ts 晚于现有最新）。

- [ ] **Step 6: 验证**
```bash
npx prisma validate
npm run dev:rebuild   # 注意：可能重建 main 栈 DB；同时直接重建 branch：DATABASE_URL=file:/tmp/exchange_js_branch/dev.db bash scripts/apply-local-migrations.sh "$(pwd)" branch
sqlite3 /tmp/exchange_js_branch/dev.db ".tables" | grep -iE "settlement_batch|outstanding_settlement|pool_settlement"  # 应只剩 settlement_batch*；旧表消失
npm run build  # 0 错误
grep -rn "OutstandingSettlement\|PoolSettlementBatch\|lockedByPoolSettlementBatchId\|poolSettlementBatchItemId" src | grep -v node_modules  # 应空
```
全部测试不新增失败（删旧引擎的 spec 随目录删除；若别处 spec 引用被删符号，调整）。

- [ ] **Step 7: Commit**（显式路径）
```bash
git add prisma/schema.prisma prisma/migrations/<dir> <每个删除/编辑的 src 路径> 
git commit -m "feat(v7-phase3): delete Wave-8 settlement engines + add SettlementBatch tables (schema surgery)"
```

---

# Task 3.1: TB amount 工具 + B 类 drain 记账（TDD 余额验证）

**Files:** `funds-layer/accounting/tb-amount.util.ts`（新）、`funds-accounting.service.ts`(+spec)。

- [ ] **Step 1: decimalToBigint 工具**（从 `swap-workflow.service.ts:41-46` 提取，处理负数）。
- [ ] **Step 2: 失败测试**：mock AccountingService（resolveTbAccountId/lookupBalance/executeTransfer）。`applyAccounting` 内部用 internalTransferId 读 transfer 行 + asset 拿上下文。用例：INTERNAL_OUT（TRADE_CLEARING 净 credit）→ executeTransfer{debit:TRADE_CLEARING, credit:CUSTODY, code:EOD_DRAIN_OUT}；INTERNAL_IN（净 debit）→ {debit:CUSTODY, credit:TRADE_CLEARING, code:EOD_DRAIN_IN}；net=0/余额=0 → 不调；A 类 → {tbApplied:false}；FEE_RECEIVABLE drain → NotImplemented（Phase 4）。
- [ ] **Step 3: 实现 B 类 drain**（读 transfer+asset → resolve TB ledger/账户 → lookupBalance 取净额 → drain=|净额|（0 则 skip）→ 按符号定方向 → executeTransfer + evidence(sourceType 'EOD_SETTLEMENT', eventCode EOD_DRAIN_IN/OUT, traceId)）。加 TB transfer code 常量 EOD_DRAIN_IN/OUT。
- [ ] **Step 4: PASS + build。Commit**（显式路径）`feat(v7-phase3): B-class TRADE_CLEARING drain accounting + tb-amount util`。

---

# Task 3.2: SettlementBatch domain + Outstanding consumer + netting

**Files:** `domain/settlement-batch.service.ts`、`domain/outstanding-consumer.service.ts`(+specs)。

- [ ] **Step 1: SettlementBatchService**：createBatch(cutoffAt, requestId, tx?)、createItem(...)、updateItemTransfer(...)、recompute counts/status、findForAdmin。netting 方向 `resolveCryptoDirection(net)`：net>0→{INTERNAL_IN, F_LIQ→C_MAIN}；net<0→{INTERNAL_OUT, C_MAIN→F_LIQ, |net|}；net=0→null。
- [ ] **Step 2: OutstandingConsumerService**：`findOpenCryptoByAsset()`（OPEN+crypto，按 asset 分组 net=ΣIN−ΣOUT + outstandingIds + decimals/currency）；`lock(ids, batchId, tx?)`（OPEN→LOCKED+settlementBatchId）；`settle(batchId, assetId, fundId, tx?)`（LOCKED→SETTLED+closedByInternalFundId）；`markNettedZero(...)`。
- [ ] **Step 3: TDD 各方法 + 三向 netting；PASS + build。Commit**（显式路径，4 文件）`feat(v7-phase3): settlement batch domain + outstanding consumer + netting`。

---

# Task 3.3: EOD 结算 workflow（L3）

**Files:** `workflow/eod-settlement-workflow.service.ts`(+spec)、`funds-layer.module.ts`。

- [ ] **Step 1: 失败测试**：mock consumer/batch/InternalTransferWorkflowService/SystemWalletResolver。`runEodSettlement`：分组→createBatch→每资产 net=0→markNettedZero/item NETTED；net≠0→resolveCryptoDirection→resolve C_MAIN+F_LIQ→lock→`initiate({fromRole,toRole,sourceType:'EOD_SETTLEMENT',sourceId:`${batchId}:${assetId}`,ownerType:'PLATFORM',assetId,amount,fromWalletId,toWalletId,triggerSource:'EOD'})`→createItem 关联 transfer。幂等（已存在 sourceId transfer 跳过）。用例：net>0→INTERNAL_IN；net=0→无 initiate 直接 settle；重跑幂等。
- [ ] **Step 2: 实现 + `@OnEvent('fundsflow.status.changed')`**（newStatus CLEAR 且 transfer.sourceType='EOD_SETTLEMENT' → `consumer.settle(batchId, assetId, fundsFlowId)` 标 SETTLED；recompute batch）。
- [ ] **Step 3: PASS + build。Commit**（显式路径）`feat(v7-phase3): EOD settlement workflow`。

---

# Task 3.4: EOD @Cron sweep

**Files:** `sweep/eod-settlement-sweep.service.ts`、`funds-layer.module.ts`。

- [ ] `@Cron('0 59 23 * * *', { timeZone:'Asia/Dubai' })` → `workflow.runEodSettlement('CRON')` + log。（PoolSettlementBatch scheduler 已在 3.0 删除，无抢单。）provider 注册。build + 测试。**Commit**（显式路径）`feat(v7-phase3): EOD settlement @Cron sweep`。

---

# Task 3.5: Settlement Admin 页面 + controller

**Files:** `controllers/settlement-admin.controller.ts`+`dto/`、`funds-layer.module.ts`、`rbac.catalog.ts`、`admin-web/.../SettlementListPage.tsx`+`SettlementDetailPage.tsx`+路由。

- [ ] **Step 1: controller**（mirror Phase 1 guard）：`GET /admin/funds-layer/settlements`(list)、`GET :batchNo`(detail：items+关联 transfer+Outstanding 消费快照)、`POST .../run`(DEV 手动)。rbac 加路由（复用 INTERNAL_TRANSFER 权限或新增 SETTLEMENT_*）。
- [ ] **Step 2: 前端**（frontend-admin.md：mirror Phase 1 InternalTransfer 页；adminFetch/adm-token/两栏；Manual Simulation 区放手动 run + simulate 各资产 transfer leg）。登记 sidebar 字段。
- [ ] **Step 3: build + admin-web tsc（无新增 funds-layer 错误）。Commit**（显式路径含 frontend-admin.md）`feat(v7-phase3): settlement admin list/detail + run`。

---

## Phase 3 验收清单

- [ ] `npm run dev:rebuild && npm run build` 通过；旧 4 表消失、SettlementBatch(+Item) 就位；无悬挂引用；无新增失败
- [ ] **TB 余额硬门**：构造若干 swap → `runEodSettlement` → simulate 各 INTERNAL_OUT/IN leg 到 CLEAR → 每资产 `lookupBalance(TRADE_CLEARING[asset])` 净额=0；CUSTODY 相应变动；Outstanding 全 SETTLED
- [ ] net=0 资产直接 SETTLED 无 transfer；EOD 重跑幂等
- [ ] V6 swap 仍能建 Outstanding（createForSwapSuccess 未被破坏）
- [ ] 旧两套引擎代码 + 表彻底消失，无 PoolSettlementBatch/OutstandingSettlement 残留
- [ ] FIAT Outstanding 跳过；Admin settlement 页可观测

## 明确排除
- FEE_COLLECT 的 FEE_RECEIVABLE drain（Phase 4）
- FIAT EOD 结算（法币轮次）
- ReimbursementObligation 结算（Phase 5）
