# V7 Funds-Layer 结构简化 — 删除 SettlementBatchItem + InternalFund 页面拆分

> 状态：设计定稿（已逐节评审通过，pre-implementation）
> 日期：2026-06-04
> 范围：funds-layer 的 B 类结算结构简化 + admin 资金单页面拆分
> 关联：[[v7-funds-layer-baseline]]、roadmap V7

---

## 0. 一句话目标

在不动「Transfer + Fund 脊柱」的前提下，删掉 B 类结算里 1:1 冗余的 `SettlementBatchItem` 层（Batch 直连 Transfer），并把资金单（InternalFund）从 Transfer 详情页里独立出来成为自己的列表/详情页（挂 Treasury 菜单组，后端仍在 funds-layer）。

## 1. 背景与动机

经过架构讨论确立的分层结论：

- **InternalTransaction（Transfer，逻辑移动）+ InternalFund（资金单，物理执行）是必须的脊柱**，A、B 类都用。Transfer 承载白名单/记账类/drain 锚/业务键/审计/路由扇出；Fund 承载 txHash/确认数/状态机/重试，且为将来「一笔逻辑移动 → N 条物理腿」（法币 per-VA、分片选源、重试换腿）预留 1:N。
- **`SettlementBatchItem` 是唯一可砍的冗余**：它和 Transfer 恒 1:1（per-VA 的 N 在 Transfer→Fund，不在这里），字段大面积重叠（asset/net/direction）。它真正独有的只有「轧差分解（gross in/out）」和「outstanding 消费链」，这两样可以并到 Transfer / Outstanding↔Transfer 关系上。
- 现阶段 crypto EOD 的轧差只是「每资产 sum(IN)−sum(OUT)」，简单到不配一个独立的清算层 → YAGNI，先并。若将来轧差变复杂（多边净额、CCP 式清算），再把清算记录作为独立实体请回。

## 2. 已锁定决策

| # | 决策 |
|---|---|
| 1 | InternalFund「在 treasury 域」= **仅 admin 菜单分组**挂到 Treasury 组；**后端代码留在 funds-layer 模块**（新增 GET 端点暴露 `FundsFlowService`）。 |
| 2 | 本轮范围 = **仅两项结构改动**（删 Item + InternalFund 页拆分）；Transfer→Fund 保持 **1:1**。法币 per-VA / 1:N / 路由选源服务 **不在本轮**。 |
| 3 | Manual Simulation（推进资金单状态机的 DEV 控件）**移到 InternalFund 详情页**；Transfer 详情页只留绑定摘要。 |
| 4 | Transfer 详情页保留的资金单信息 = **紧凑行 + 跳转**（每条绑定资金单一行：fundNo + 状态 + 金额 + View→Fund 详情）。 |
| A | InternalFund 页面 = **新建 funds-layer 页**（对齐 InternalTransferList/SettlementList），并删掉遗留前端 `InternalFundList/Detail`；不 repoint 旧页。 |
| B | 迁移 = **破坏性 migration + `dev:rebuild`**，无数据搬迁脚本（dev 数据可重建）。 |
| C | `Outstanding.settlementBatchItemId` → 改为 `settledByTransferId`；**保留 `settlementBatchId`**（net=0 腿无 transfer，只能挂 batch 标 SETTLED）；`closedByInternalFundId` 不变。 |

## 3. Schema 改动

**删除**
- `model SettlementBatchItem`（整张 `settlement_batch_items` 表）。

**`InternalTransaction`（Transfer）新增结算专用可空字段**
- `settlementBatchId String?` + relation → `SettlementBatch`（仅 EOD/FEE 的结算 transfer 有；A 类留空）
- `grossInAmount Decimal?` / `grossOutAmount Decimal?`（接管 Item 的轧差分解快照，供详情页 In/Out/Net 显示；A 类留空）
- 新增 `@@index([settlementBatchId])`
- 方向不单存：已由 `pathLabel`（INTERNAL_OUT / INTERNAL_IN / FEE_COLLECT）表达；净额已有 `netAmount`。

**`SettlementBatch`**
- 删 `items SettlementBatchItem[]`
- 加 `transfers InternalTransaction[]`（经 `InternalTransaction.settlementBatchId` 反查）
- 保留 `outstandings Outstanding[]`（net=0 / 批级）
- 滚动计数 `totalAssetCount/settledAssetCount/totalOutstandingCount/settledOutstandingCount` 保留，改为按 transfers + 关联 outstanding 统计。

**`Outstanding`**
- 删 `settlementBatchItemId`（+relation）
- 加 `settledByTransferId String?` + relation → `InternalTransaction`，新增 `@@index([settledByTransferId])`
- 保留 `settlementBatchId`、`closedByInternalFundId`、`lockedAt`、`closedAt`、`status`

**改完后关系**
```
SettlementBatch
  ├─ transfers: InternalTransaction[]   (settlementBatchId, 每币种一条)
  │     └─ funds: InternalFund[]         (当前 1:1)
  └─ outstandings: Outstanding[]         (settlementBatchId, 被消费集合)

Outstanding → settledByTransferId   → InternalTransaction  (谁结算我)
            → closedByInternalFundId → InternalFund         (哪条腿 CLEAR 关的我)
            → settlementBatchId      → SettlementBatch       (哪次 run)
```

## 4. Workflow 改动（EOD / Fee Collection）

### 4.1 新 EOD 流程（`runEodSettlement`）
```
findOpenCryptoByAsset() → 分组；空 → no-op
createBatch
for 每个币种 group:
   dir = resolveCryptoDirection(net)
   ┌ net == 0:
   │    lockToBatch(group.ids, batch.id)               → LOCKED + settlementBatchId
   │    markSettledNettedZero(batch.id, assetId)        → SETTLED（无 transfer / 无 fund）
   │    continue
   └ net ≠ 0:
        幂等 findFirst(EOD_SETTLEMENT, batch:asset)
        transfer = initiate({ …, settlementBatchId:batch.id, grossIn:group.in, grossOut:group.out })
                   └ initiate 内：建 transfer + 1 fund + B 类 drain（不变）
        lockToTransfer(group.ids, batch.id, transfer.id) → LOCKED + settlementBatchId + settledByTransferId
recomputeBatch(batch.id)
```

### 4.2 CLEAR 收尾（事件处理器，不再找 item）
```
fund → CLEAR → 找 transfer（sourceType=EOD_SETTLEMENT）
   consumer.settle(transfer.id, fundId)   → settledByTransferId=该 transfer 且 LOCKED 的 outstanding → SETTLED + closedByInternalFundId + closedAt
   recomputeBatch(transfer.settlementBatchId)
```

### 4.3 Fee Collection（同形，无 outstanding）
- `createBatch → 每币种 initiate(settlementBatchId, grossOut=费额) → recomputeBatch`；不锁/不结 outstanding。
- CLEAR 收尾：只 `recomputeBatch`。

### 4.4 服务方法增删
| 服务 | 删 | 改 / 加 |
|---|---|---|
| `SettlementBatchService` | `createItem` / `linkItemTransfer` / `closeItem` | `recomputeBatch` 改为遍历 transfers（不遍历 items）；`findOneByNoForAdmin` include `transfers` 代替 `items` |
| `OutstandingConsumerService` | `linkItem`、按 itemId 的 `settle`/`markNettedZero` | `lockToTransfer(ids,batchId,transferId)`、`lockToBatch(ids,batchId)`、`settle(transferId,fundId)`、`markSettledNettedZero(batchId,assetId)` |
| `InternalTransferWorkflowService.initiate` | — | 入参加可选 `settlementBatchId / grossInAmount / grossOutAmount`，透传给 `createTransfer` |

### 4.5 batch 完成判据（rollup，统一 EOD + Fee）
> batch = `SUCCESS` 当：**它的所有 transfer 的 fund 都 CLEAR（=transfer 终态）** 且 **它的所有 outstanding 都 SETTLED**；否则 `PROCESSING`。
> AssetCount = transfers 资产数 + net=0 资产数；OutstandingCount = `settlementBatchId` 下 outstanding 计数。
> （fee batch 无 outstanding，靠 transfer 终态判完成；EOD batch 同时看 outstanding；net=0 资产即时算结清。）

## 5. Admin 页面改动

### 5.1 新增 InternalFund 列表 + 详情页（funds-layer 风格）
- 后端新端点：
  - `GET /admin/funds-layer/funds`（列表，复用 `FundsFlowService.findAllForAdmin` + `InternalFundQueryDto`：status / txHash / internalFundNo / assetId / parent internalTxNo / 日期）
  - `GET /admin/funds-layer/funds/:internalFundNo`（详情，按业务键，新增 `findOneByNoForAdmin`）
- 列表页字段：fundNo / 状态 / 资产 / 金额 / txHash / 所属 transferNo / 时间。
- 详情页：完整执行信息（fundNo、状态、金额、txHash、确认数、gas/nonce/block、状态时间线）+ **Manual Simulation 控件（搬到此处；腿即本资金单，不用再选）** + "所属 Transfer: ITXxxx" 回跳。
- **simulate 后端端点不变**（仍 `POST /admin/funds-layer/transfers/:internalTxNo/simulate`，body 带 fundsFlowId+action）；Fund 详情页用自己的 fundId + 父 transferNo 调用。

### 5.2 InternalTransfer 详情页（瘦身）
- 删 "Execution Legs" 完整块 + Manual Simulation 控件。
- 换成紧凑 "Funds" 绑定区：每条绑定资金单一行 → `fundNo · 状态 · 金额 · View→`（跳 Fund 详情）。其余区块保留。

### 5.3 Settlement 详情页（数据源换）
- 后端 `findOneByNoForAdmin` 的 include 从 `items` → `transfers`（本 batch `settlementBatchId` 下的 transfer，含其 outstanding 计数）。
- 前端 "Settlement Items" 区改遍历 transfers：每条 = 币种结算行（assetCode / In=grossIn / Out=grossOut / Net / Direction=pathLabel / Transfer: ITXxxx / Outstanding 计数）。展示几乎不变。

### 5.4 Settlement 列表页
- 基本不动（读 batch 级计数器，rollup 口径已在 §4.5 改）。

### 5.5 导航
- DashboardLayout 的 Treasury 组新增 "Internal Funds"（资金单）→ `/funds-layer/funds`，权限 `FUNDS_LAYER_FUNDS_READ`。

### 5.6 清理（本轮）
- 删遗留前端 `InternalFundList.tsx` / `InternalFundDetail.tsx` + 其路由（已不在菜单）。
- **边界**：后端遗留 `asset-treasury/internal-funds`、`internal-transactions` 整模块退役**不在本轮**（更大的一次清理，牵连 internal-transactions 等）。

## 6. 测试

funds-layer jest 必须保持全绿（当前 82/82）。

- 改写引用 Item 的 4 个 spec：`outstanding-consumer` / `settlement-batch` / `eod-settlement-workflow` / `fee-collection-workflow`（改按 transfer 键）。
- 用例：
  - EOD net≠0：建 batch+transfer、outstanding LOCKED 且 `settledByTransferId` 已设 → CLEAR → outstanding SETTLED + batch SUCCESS。
  - EOD net=0：outstanding 直接 SETTLED、无 transfer、batch SUCCESS。
  - Fee：建 transfer、无 outstanding、CLEAR → batch SUCCESS。
  - 幂等重跑：`findFirst(sourceType,sourceId)` 命中不重复建。
  - rollup 口径：全 outstanding SETTLED + 全 transfer 的 fund CLEAR → SUCCESS。

## 7. 迁移 / 权限 / 审计

- **迁移**：破坏性 Prisma migration（drop `settlement_batch_items`；`InternalTransaction` 加字段+index；`Outstanding` 加 `settledByTransferId`+index、删 `settlementBatchItemId`）→ `npm run dev:rebuild` 重铺。无数据搬迁脚本。
- **权限**：后端 RBAC 注册 `api.get.admin_funds_layer_funds` + `..._funds_id`，授予已持 funds-layer transfers/settlements 读权限的角色；前端 `permissions.ts` 加 `FUNDS_LAYER_FUNDS_READ` / `FUNDS_LAYER_FUND_DETAIL_READ`。
- **审计**：无新增 action。资金单状态机已写 `INTERNAL_FUND_*`（`FundsFlowService.updateStatus`）；transfer 的 REQUESTED/COMPLETED/FAILED 不变；删 Item 不丢任何审计（Item 无独立审计）。

## 8. 明确不在本轮范围

- 法币 per-VA 拆腿 / Transfer→Fund 的 1:N 实现 / 「全腿 CLEAR 才结清」逻辑。
- 路由选源（coin-selection / wallet-selection）服务（资金池分片）。
- asset-treasury 遗留后端模块（internal-funds / internal-transactions）退役。

## 9. 影响文件清单（预估）

**后端**
- `prisma/schema.prisma`（+ 新 migration）
- `src/modules/funds-layer/domain/settlement-batch.service.ts`(+spec)
- `src/modules/funds-layer/domain/outstanding-consumer.service.ts`(+spec)
- `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`(+spec)
- `src/modules/funds-layer/workflow/fee-collection-workflow.service.ts`(+spec)
- `src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts`（initiate 透传字段）
- `src/modules/funds-layer/domain/funds-flow.service.ts`（加 `findOneByNoForAdmin`）
- `src/modules/funds-layer/controllers/`（新增 funds list/detail controller）
- funds-layer.module（注册新 controller）+ RBAC 权限注册

**前端**
- 新增 `admin-web/src/pages/funds-layer/InternalFundListPage.tsx` / `InternalFundDetailPage.tsx`
- `admin-web/src/pages/funds-layer/InternalTransferDetailPage.tsx`（瘦身 + simulate 移除）
- `admin-web/src/pages/funds-layer/SettlementDetailPage.tsx`（items→transfers）
- `admin-web/src/components/DashboardLayout.tsx`（Treasury 加 Internal Funds 入口）
- `admin-web/src/App.tsx`（新路由 + 删遗留 InternalFund 路由）
- `admin-web/src/rbac/permissions.ts`（新权限）
- 删 `admin-web/src/pages/InternalFundList.tsx` / `InternalFundDetail.tsx`
