# 虚拟币结算/桥清 与 FX 重估解耦 + 手动结算按钮 — 设计

> 状态：设计 / 待实现
> 日期：2026-06-21
> 范围：产品侧（funds-layer EOD 记账编排 + admin 端点 + Settlement Batches 页）。非 demo 脚本。
> 关联：demo 交易数据层（`2026-06-21-demo-transaction-data-layer-design.md`）落地后将改用本按钮替代「跳过 EOD」。

---

## 0. 一句话

把「**虚拟币结算 + 桥清**」（成本入账，可随时手动触发）与「**FX 重估**」（按官方 fixing 盯市，**仅 EOD**）解耦：手动按钮做前者，EOD 做前者 + 后者。

---

## 1. 现状（为什么要改）

- `FxEodService`（`src/modules/funds-layer/accounting/fx-eod.service.ts`）里 **桥清与重估已是两个独立方法、语义正交**：
  - `sweepBridges()`（:75）：`sweep = bridgeNet − openBridgeContributions`，只扫 **已 SETTLED** 的 swap，`TRADE_CLEARING → FX_POSITION`，**不取汇率 = 按成本入账**。
  - `revalueFxPositions()`（:162）：唯一调 `rateProvider.fetchRate`，按 fixing 盯市 → `FX_UNREALIZED_PNL`。
  - `checkInvariants()`（:389）：I1（客户池=Σ债权）+ I2（桥残余=open 贡献），均与重估无关。
- 但 `runEodAccounting()`（:56）把 sweep + reval + invariants **捆在一起**，且被两处调用：
  - `EodSettlementWorkflowService.runEodSettlement()`（:137）——EOD 入口（此刻新腿未 CLEAR，扫不到新单，仅 mark 既有头寸）；
  - `onFundsFlowStatusChanged()` CLEAR 处理器（:218）——**每条 EOD 腿 CLEAR 都触发 sweep+reval**（增量盯市）。
- 结果：**重估随每次结算 CLEAR 触发**，无法满足「重估只在 EOD」。

---

## 2. 目标设计

1. **EOD 时刻**（cron / EOD 按钮）：把当日所有 open 虚拟币 `Outstanding` + `FeeAccrual` 打包结算 → 桥清 → **FX 重估**。
2. **Settlement Batches 页新增按钮「结算 + 桥清（不重估）」**：把当日 0:00 → 点击时刻的 open 虚拟币 `Outstanding` + `FeeAccrual` 打包结算 → 桥清。**不重估**。
3. **总结**：虚拟币结算 + 桥清可随时手动触发；FX 重估只在 EOD。

---

## 3. 关键改动 — 解耦

### 3.1 CLEAR 处理器只扫桥（核心）
`onFundsFlowStatusChanged`（:218）的 `runEodAccounting(batchNo)` → 改为 **`sweepBridges()` + `checkInvariants()`**（去掉 reval）。这样无论手动批次还是 EOD 批次，结算腿一 CLEAR 就按成本扫桥，**永不重估**。

### 3.2 重估提升为 EOD 专属、按批次完成触发
- **重估门控键为 `transfer.triggerSource === 'EOD'`（不是 `batch.settlementType`）。**
  - 原因：`settlementType` 已收口为「rail × kind」标签（见 §11），EOD 与手动结算的本金批次**共用 `CRYPTO_PRINCIPAL`**，无法再区分触发来源。唯一可靠区分是结算腿（internalTransaction）的 `triggerSource`：EOD 路径写 `'EOD'`，手动路径写 `'MANUAL_SETTLE'`，CLEAR 处理器里 `transfer` 已在作用域内。
  - `batchNo` 仍从 `settlementBatch.findUnique` 取（供 `runReval`/`runSweepOnly` 调用），其 `select` 去掉 `settlementType`。
- CLEAR 处理器在「该批次最后一条腿 CLEAR、批次进入全 SETTLED」且 `transfer.triggerSource === 'EOD'` 时，**额外调一次 `revalueFxPositions()`**（整仓重标，幂等覆盖）。`triggerSource==='MANUAL_SETTLE'` 永不触发。
- 这样 EOD 的重估发生在「当日已结算头寸全部扫进 FX_POSITION 之后」，是真正的日终一次性盯市；手动批次只留成本头寸。
- `runEodSettlement()`（:137）的 `runEodAccounting` → 改为 `sweepBridges()`（兜底扫既有已结算头寸）；reval 不在此处（移到批次完成）。

### 3.3 手动结算工作流
新增 `EodSettlementWorkflowService.runManualCryptoSettlement(operatorId, cutoff = now)`：
- 与 `runEodSettlement` 同骨架：`createBatch({ kind: 'MANUAL_SETTLE' })` → net open 虚拟币 outstandings（`createdAt < cutoff`）spawn `INTERNAL_OUT/IN` → `runFeePass(cutoff)` 结算虚拟币 fee accruals。
- **不调用任何 reval**。腿 CLEAR 经 §3.1 自动扫桥。
- 复用 `consumer.findOpenCryptoByAsset` / `runFeePass`（均已支持 `cutoff`）。

> 净效果：把 reval 移出结算 CLEAR 路径后，「手动结算 = settle + 扫桥、不重估」几乎是自然结果；EOD 仅多一步「批次完成后 reval」。

---

## 4. 端点 + 前端

| 端点 | 语义 |
|---|---|
| `POST /admin/funds-layer/settlements/run`（已存在 → `runEodSettlement('ADMIN')`） | **全量 EOD**：settle + 扫桥 + reval。语义明确为 EOD。 |
| `POST /admin/funds-layer/settlements/settle`（**新增** → `runManualCryptoSettlement('ADMIN')`） | **手动结算**：settle + 扫桥，**不 reval**。 |

- `admin-web/src/pages/funds-layer/SettlementListPage.tsx`：
  - 保留/明确「Run EOD」按钮 → `/run`。
  - 新增「结算 + 桥清（不重估）」按钮 → `/settle`，二次确认 + 完成后刷新列表/吐 batchNo。
- **RBAC**：新端点登记 `rbac.catalog.ts` → `db:base:sync` → **重启后端**（SUPER_ADMIN 走内存 RBAC，只 seed 不重启=白费）。

---

## 5. 已定细节（用户拍板）

1. **手动路径跑 invariants** = 是（I1/I2 与 reval 无关，手动结算后顺手校验桥残余=open 贡献）。
2. **FX 未实现盈亏 = EOD 日终快照口径**（非日内实时）。手动结算到 EOD 之间，FX 头寸停在成本、`FX_UNREALIZED` 为上一 EOD 值。产品/报表须按此口径解释。
3. **手动 cutoff = 点击时刻**：取 `status=OPEN/LOCKED 且 createdAt < cutoff` 的虚拟币 outstanding/accrual；点击后、EOD 前新产生的留到 EOD 收。

---

## 6. 不变量 / 对账影响

- **式1 试算平衡 = 0**：扫桥（`TRADE_CLEARING↔FX_POSITION`）与重估（`FX_POSITION↔FX_UNREALIZED`）都是平衡分录，恒成立。
- **式3 桥 tie-out**：扫桥后 `TRADE_CLEARING = open swap 贡献`（I2），与是否重估无关，恒成立。
- 手动扫桥后 FX 头寸记成本、`FX_UNREALIZED=0`，不影响任何 recon 不变量（FX 科目无外部对手，不进式4/式5）。

---

## 7. 时序考量

- EOD 结算腿在生产是异步链上交易；reval 由「EOD 批次全 SETTLED」触发（§3.2），保证当日已结算头寸先扫桥再盯市。
- reval 幂等（从 live FX_POSITION 重算 delta，覆盖昨日 mark）；万一有腿在 reval 后才 CLEAR，其头寸下一 EOD 周期被标，符合日终快照口径。
- LP 平盘 `realizeFxPosition()`（手动/demo，:245）不变——它把 `FX_UNREALIZED→FX_REALIZED`、与本次解耦正交。

---

## 8. 文件清单

**改动**
- `src/modules/funds-layer/accounting/fx-eod.service.ts`：无需改方法本体（sweep/reval 已分开）；仅被调用方式变。
- `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`：① CLEAR 处理器(:218) 改 `sweepBridges`+`checkInvariants`+（EOD 批次完成时）`revalueFxPositions`；② :137 改 `sweepBridges`；③ 新增 `runManualCryptoSettlement`。
- `src/modules/funds-layer/controllers/settlement-admin.controller.ts`：新增 `POST /settle`。
- `prisma/schema.prisma`：`SettlementBatch` 加 `kind`（或复用 `settlementType`）+ 迁移。
- `admin-web/src/pages/funds-layer/SettlementListPage.tsx`：新增手动结算按钮。
- `rbac.catalog.ts`：登记新端点权限。

**复用（不改）**
- `FxEodService.sweepBridges / revalueFxPositions / checkInvariants`、`OutstandingConsumerService.findOpenCryptoByAsset/settle`、`runFeePass`、`SettlementBatchService`。

---

## 9. 验收标准

1. 手动结算后：当日 open 虚拟币 `Outstanding`/`FeeAccrual` → SETTLED；`TRADE_CLEARING(币)` 扫到 = open 贡献；`FX_POSITION` 按成本增加；**`FX_UNREALIZED` 不变**（无 reval）。
2. EOD 后：同上 + `FX_UNREALIZED` 按 fixing 盯市更新；I1/I2 violations 空。
3. 重复点手动结算：无新单时 0 spawn、扫桥 0（幂等）。
4. 式1/式3 在手动结算后与 EOD 后均成立。
5. 既有 `verify-two-book.ts` 全链（含 EOD reval）仍 ALL PASS（回归）。

---

## 10. 与 demo 的关系

demo 交易数据层当前用「不跑 EOD」让虚拟币挂起。本功能落地后，demo 改为：跑到挂起态 → 需要展示虚拟币已结算时点「结算+桥清」按钮（成本、不重估）；FX 重估留给真正的 EOD 演示。比脚本里硬跳过 EOD 更贴近真实操作。

---

## 11. settlementType 收口为 6 值枚举（防呆）+ FEE_COLLECT 退役（2026-06-21 落地）

### 11.1 6 值枚举
`SettlementBatch.settlementType` 原为 free-form string（曾有 `'EOD'`/`'MANUAL_SETTLE'`/`'FEE_COLLECT'`/`'FIAT_SWAP'` 等混用，导致过一次 mislabel bug）。现收口为恰好 6 值的 TS 字面量联合：

| 值 | 含义 |
|---|---|
| `FIAT_SWAP` | 法币 swap 费批次 |
| `FIAT_WITHDRAW` | 法币提现费批次 |
| `FIAT_PRINCIPAL` | 法币本金结算批次（原 `'FIAT_SWAP'` 误用，实为本金） |
| `CRYPTO_SWAP` | 虚拟币 swap 费批次 |
| `CRYPTO_WITHDRAW` | 虚拟币提现费批次 |
| `CRYPTO_PRINCIPAL` | 虚拟币本金结算批次（原 EOD=`'EOD'` / 手动=`'MANUAL_SETTLE'` 统一为此值） |

- scheme = `{RAIL}_{KIND}`，RAIL ∈ FIAT/CRYPTO，KIND ∈ swap-fee / withdraw-fee / principal（本金）。
- 定义于 `src/modules/funds-layer/constants/settlement-type.constant.ts`（`type SettlementType` + `SETTLEMENT_TYPES` 常量）。
- `CreateBatchInput.settlementType?` 与 `FeeAccrualService.settle(...)` 的 `settlementType` 参数均改为 `SettlementType` 类型——任何 stray 字面量在 `tsc` 即报错（防呆）。`createBatch` 默认值 `'EOD'` → `'CRYPTO_PRINCIPAL'`。
- **关键后果**：EOD 与手动虚拟币本金批次共用 `CRYPTO_PRINCIPAL`，故 `settlementType` 不再编码触发来源；重估区分改由 `transfer.triggerSource` 承担（见 §3.2）。

### 11.2 FEE_COLLECT 工作流退役
旧 `FeeCollectionWorkflowService`（建 `settlementType:'FEE_COLLECT'` 批次）已被 EOD fee pass 取代，且其唯一注入方 `FeeCollectionSweepService` 早已去 `@Cron`、无任何 live 调用方（无端点/无 cron/无其他 service 调用）。本轮整簇退役：删除 `workflow/fee-collection-workflow.service.ts`、`sweep/fee-collection-sweep.service.ts` 及两者 spec；移除 module 注册与 `domain-events.constants.ts` 订阅者文档项。虚拟币 fee 归集完全走 EOD fee pass（`runFeePass` → `CRYPTO_SWAP`/`CRYPTO_WITHDRAW`）。
