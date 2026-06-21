# EOD / 手动结算 — FX 重估解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把虚拟币「结算+桥清」（按成本，可手动随时触发）与「FX 重估」（按 fixing 盯市，仅 EOD）解耦，并在 Settlement Batches 页加「手动结算」按钮。

**Architecture:** `FxEodService` 的 `sweepBridges()` / `revalueFxPositions()` 本已是独立方法。把结算 CLEAR 路径改为只 `sweepBridges`；reval 仅在 **EOD 类批次**触发。新增 `runManualCryptoSettlement`（settle+sweep，不 reval）+ admin 端点 + 前端按钮。用 `SettlementBatch.kind`（`EOD` | `MANUAL_SETTLE`）区分两类批次。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle + Jest（单测）+ ts-node 集成验收脚本 + React(admin-web)。

参考 spec：`doc-final/superpowers/specs/2026-06-21-eod-manual-settle-reval-decoupling-design.md`

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `prisma/schema.prisma` | `SettlementBatch.kind` 列 | 改 + 迁移 |
| `src/modules/funds-layer/domain/settlement-batch.service.ts` | `createBatch` 接受 `kind` | 改 |
| `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts` | EOD/手动结算编排 + CLEAR 处理器解耦 | 改（核心） |
| `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts` | 单测：reval 门控 + 手动不 reval | 改/建 |
| `src/modules/funds-layer/controllers/settlement-admin.controller.ts` | `POST /settle` 端点 | 改 |
| `src/<rbac catalog>` | 端点权限登记 | 改 |
| `admin-web/src/pages/funds-layer/SettlementListPage.tsx` | 「手动结算」按钮 | 改 |
| `scripts/verify-manual-settle.ts` | 集成验收（手动 settle 不 reval；EOD reval） | 建 |

---

## Task 1: SettlementBatch.kind 字段 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（`model SettlementBatch`）
- Modify: `src/modules/funds-layer/domain/settlement-batch.service.ts`（`createBatch`）

- [ ] **Step 1: schema 加字段**

在 `model SettlementBatch` 加：
```prisma
  kind          String   @default("EOD") // EOD | MANUAL_SETTLE — reval 仅 EOD 触发
```
> 默认 `EOD` 保留既有 principal 批次行为；手动批次显式置 `MANUAL_SETTLE`。fee 批次走 fee 分支、不进 reval 门，kind 不影响它们。

- [ ] **Step 2: 生成迁移**

Run: `DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx prisma migrate dev --name settlement_batch_kind`
Expected: 新迁移文件生成，`prisma generate` 成功，无数据破坏。

- [ ] **Step 3: createBatch 透传 kind**

在 `settlement-batch.service.ts` 的 `createBatch(input)` 入参与 `data` 加 `kind?: string`（默认走 schema 默认值）：
```typescript
// createBatch input 类型加： kind?: string;
// prisma.settlementBatch.create 的 data 加： ...(input.kind ? { kind: input.kind } : {}),
```

- [ ] **Step 4: 编译校验**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 无新增类型错误（可能有项目既有错误；只看本次相关文件）。

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/funds-layer/domain/settlement-batch.service.ts
git commit -m "feat(funds-layer): add SettlementBatch.kind (EOD|MANUAL_SETTLE)"
```

---

## Task 2: runManualCryptoSettlement（settle + 桥清，不 reval）

**Files:**
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`
- Test: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`

- [ ] **Step 1: 写失败单测——手动结算建 MANUAL_SETTLE 批次且不调 reval**

在 spec 里（用 Nest TestingModule，mock `FxEodService`/`OutstandingConsumerService`/`SettlementBatchService`/`FeeAccrualService`/`TransferWorkflow`/`SystemWallets`/`PrismaService`）：
```typescript
it('runManualCryptoSettlement: creates MANUAL_SETTLE batch and never revalues', async () => {
  consumer.findOpenCryptoByAsset.mockResolvedValue([
    { assetId: 'usdt', net: 100n, inAmount: '100', outAmount: '0', outstandingIds: ['o1'] } as any,
  ]);
  batchService.createBatch.mockResolvedValue({ id: 'b1', batchNo: 'SB-1' } as any);
  batchService.resolveCryptoDirection.mockReturnValue({ fromRole: 'C_MAIN', toRole: 'F_OPS', amount: { toString: () => '100' } } as any);
  transferWorkflow.initiate.mockResolvedValue({ id: 't1' } as any);

  await service.runManualCryptoSettlement('ADMIN');

  expect(batchService.createBatch).toHaveBeenCalledWith(expect.objectContaining({ kind: 'MANUAL_SETTLE' }));
  expect(fxEod.revalueFxPositions).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts -t "runManualCryptoSettlement"`
Expected: FAIL（`runManualCryptoSettlement is not a function`）。

- [ ] **Step 3: 实现 runManualCryptoSettlement**

复制 `runEodSettlement` 骨架，去掉 reval，建批次带 `kind: 'MANUAL_SETTLE'`：
```typescript
/** 手动结算：当日 0:00→cutoff 的 open 虚拟币 Outstanding+FeeAccrual 打包结算 + 桥清(成本)，不 reval。 */
async runManualCryptoSettlement(operatorId = 'ADMIN', cutoff?: Date): Promise<RunEodSettlementResult> {
  const cut = cutoff ?? new Date();
  const groups = await this.consumer.findOpenCryptoByAsset(cut);
  if (groups.length === 0) {
    await this.runFeePass(cut);
    return { batchNo: null, assetCount: 0, settledZero: 0, spawned: 0 };
  }
  const batch = await this.batchService.createBatch({ cutoffAt: cut, kind: 'MANUAL_SETTLE' });
  let settledZero = 0, spawned = 0;
  for (const group of groups) {
    const dir = this.batchService.resolveCryptoDirection(group.net);
    if (dir == null) {
      await this.consumer.lockToBatch(group.outstandingIds, batch.id);
      await this.consumer.markSettledNettedZero(batch.id, group.assetId);
      settledZero += 1; continue;
    }
    const from = await this.systemWallets.resolve(group.assetId, dir.fromRole);
    const to = await this.systemWallets.resolve(group.assetId, dir.toRole);
    const sourceId = `${batch.id}:${group.assetId}`;
    const existing = await (this.prisma as any).internalTransaction.findFirst({ where: { sourceType: EOD_SOURCE_TYPE, sourceId } });
    const transfer = existing ?? await this.transferWorkflow.initiate({
      fromRole: dir.fromRole, toRole: dir.toRole, sourceType: EOD_SOURCE_TYPE, sourceId, sourceNo: batch.batchNo,
      ownerType: 'PLATFORM', ownerId: 'PLATFORM', assetId: group.assetId, amount: dir.amount.toString(),
      fromWalletId: from.id, toWalletId: to.id, triggerSource: 'MANUAL_SETTLE', settlementBatchId: batch.id,
      grossInAmount: group.inAmount.toString(), grossOutAmount: group.outAmount.toString(),
    }, operatorId);
    await this.consumer.lockToTransfer(group.outstandingIds, batch.id, transfer.id);
    spawned += 1;
  }
  await this.batchService.recomputeBatch(batch.id);
  await this.runFeePass(cut);
  // 注意：NO reval。桥清由腿 CLEAR 经 onFundsFlowStatusChanged(sweep-only) 完成。
  return { batchNo: batch.batchNo, assetCount: groups.length, settledZero, spawned };
}
```
> `runFeePass` 已带 cutoff、结算虚拟币 fee accruals；手动路径直接复用。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts -t "runManualCryptoSettlement"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts
git commit -m "feat(funds-layer): runManualCryptoSettlement (settle+sweep, no reval)"
```

---

## Task 3: CLEAR 处理器解耦——sweep-only + reval 仅 EOD 批次

**Files:**
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`（:137 与 :201-225）
- Test: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`

- [ ] **Step 1: 写失败单测——CLEAR 对 EOD 批次 reval、对 MANUAL_SETTLE 不 reval**

```typescript
it('CLEAR of EOD principal leg sweeps and (when batch fully settled) revalues', async () => {
  (prisma as any).internalTransaction.findUnique.mockResolvedValue({ id: 't1', sourceType: 'EOD_SETTLEMENT', settlementBatchId: 'b1' });
  (prisma as any).settlementBatch.findUnique.mockResolvedValue({ batchNo: 'SB-1', kind: 'EOD' });
  (prisma as any).outstanding.count.mockResolvedValue(0); // 全 SETTLED
  await service.onFundsFlowStatusChanged({ internalTransferId: 't1', fundsFlowId: 'f1', newStatus: 'CLEAR' } as any);
  expect(fxEod.sweepBridges).toHaveBeenCalled();
  expect(fxEod.revalueFxPositions).toHaveBeenCalled();
});

it('CLEAR of MANUAL_SETTLE principal leg sweeps but never revalues', async () => {
  (prisma as any).internalTransaction.findUnique.mockResolvedValue({ id: 't2', sourceType: 'EOD_SETTLEMENT', settlementBatchId: 'b2' });
  (prisma as any).settlementBatch.findUnique.mockResolvedValue({ batchNo: 'SB-2', kind: 'MANUAL_SETTLE' });
  (prisma as any).outstanding.count.mockResolvedValue(0);
  await service.onFundsFlowStatusChanged({ internalTransferId: 't2', fundsFlowId: 'f2', newStatus: 'CLEAR' } as any);
  expect(fxEod.sweepBridges).toHaveBeenCalled();
  expect(fxEod.revalueFxPositions).not.toHaveBeenCalled();
});
```
> mock 需补 `fxEod.sweepBridges`/`revalueFxPositions`/`checkInvariants`、`consumer.settle`、`batchService.recomputeBatch`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts -t "CLEAR of"`
Expected: FAIL（当前调 `runEodAccounting`、且无 kind 门控）。

- [ ] **Step 3: 改 CLEAR 处理器（:212-225 块）**

把 EOD_SOURCE_TYPE 分支里的 `runEodAccounting` 替换为 sweep-only + 按 kind 门控 reval：
```typescript
try {
  const batch = await (this.prisma as any).settlementBatch.findUnique({
    where: { id: transfer.settlementBatchId },
    select: { batchNo: true, kind: true },
  });
  if (batch?.batchNo) {
    const report = { sweeps: [], revals: [], violations: [] };
    await this.fxEod.sweepBridges(batch.batchNo, report);
    if (batch.kind === 'EOD' && (await this.isBatchFullySettled(transfer.settlementBatchId))) {
      await this.fxEod.revalueFxPositions(batch.batchNo, report);
    }
    await this.fxEod.checkInvariants(report);
  }
} catch (accountingErr) {
  this.logger.error(`EOD accounting failed after CLEAR for batch=${transfer.settlementBatchId}`, accountingErr instanceof Error ? accountingErr.stack : undefined);
}
```
加私有方法：
```typescript
/** 批次内所有 outstanding 均 SETTLED → 批次结算完成。 */
private async isBatchFullySettled(batchId: string): Promise<boolean> {
  const open = await (this.prisma as any).outstanding.count({
    where: { settlementBatchId: batchId, status: { not: 'SETTLED' } },
  });
  return open === 0;
}
```

- [ ] **Step 4: 改 runEodSettlement(:137) 与批次 kind**

- :75 `createBatch({ cutoffAt: cut })` → `createBatch({ cutoffAt: cut, kind: 'EOD' })`。
- :137 `await this.fxEod.runEodAccounting(batch.batchNo);` → 改为 sweep + 日终 reval（覆盖「当日无新腿可清但需按 fixing 重标既有头寸」场景；reval 幂等）：
```typescript
const eodReport = { sweeps: [], revals: [], violations: [] };
await this.fxEod.sweepBridges(batch.batchNo, eodReport);
await this.fxEod.revalueFxPositions(batch.batchNo, eodReport);
await this.fxEod.checkInvariants(eodReport);
```
> EOD 入口此处 reval = 当日 mark；新结算腿 CLEAR 后经 Step 3 在批次完成时再 reval 一次（幂等覆盖），保证当日已结算头寸最终被正确盯市。

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`
Expected: 新增用例 PASS，既有用例不回归。

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts
git commit -m "refactor(funds-layer): CLEAR path sweeps only; reval gated to EOD batch completion"
```

---

## Task 4: Admin 端点 POST /settle + RBAC

**Files:**
- Modify: `src/modules/funds-layer/controllers/settlement-admin.controller.ts`
- Modify: RBAC catalog（`grep -rl "rbac.catalog" src` 定位；与 `/run` 同权限族登记新 route）

- [ ] **Step 1: 加端点**

在 `@Controller('admin/funds-layer/settlements')` 加：
```typescript
@Post('settle')
async manualSettle() {
  return this.eodWorkflow.runManualCryptoSettlement('ADMIN');
}
```
> 复用现有 RBAC guard/装饰器写法（照抄 `@Post('run')` 那条的守卫注解）。

- [ ] **Step 2: RBAC 登记**

在 catalog 用与 `POST .../settlements/run` 相同的权限定义登记 `POST .../settlements/settle`（`route(...)`）。

- [ ] **Step 3: 同步权限 + 重启后端**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run db:base:sync
# 重启 branch 后端（3500）使内存 RBAC_PERMISSION_DEFINITIONS 生效
```
Expected: sync 成功；重启后 SUPER_ADMIN 可访问新端点（curl 200 / 非 403）。

- [ ] **Step 4: 冒烟**

Run: `curl -s -X POST localhost:3500/admin/funds-layer/settlements/settle -H "Authorization: Bearer <admin-jwt>" | head`
Expected: 200，返回 `{ batchNo, assetCount, settledZero, spawned }`（无 open 虚拟币时 batchNo=null 也算正常）。

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/controllers/settlement-admin.controller.ts src/<rbac-catalog-file>
git commit -m "feat(funds-layer): POST /settlements/settle (manual crypto settlement) + RBAC"
```

---

## Task 5: Settlement Batches 页「手动结算」按钮

**Files:**
- Modify: `admin-web/src/pages/funds-layer/SettlementListPage.tsx`

- [ ] **Step 1: 加按钮 + 调用**

照现有「Run EOD」按钮（调 `POST .../settlements/run`）旁加「结算 + 桥清（不重估）」按钮，调 `POST .../settlements/settle`，二次确认 + 成功后刷新列表 + toast 显示返回的 batchNo。复用页面既有 api client 与按钮组件，匹配暗色主题。

- [ ] **Step 2: 渲染验收（截图比对）**

启动 admin（3501，VITE_API_URL=3500），preview 打开 Settlement Batches 页：
- 截图确认两个按钮并存、样式对齐既有原子。
- 点「结算+桥清」→ 确认弹窗 → 执行 → 列表刷新出现新 `MANUAL_SETTLE` 批次。
> 依据用户偏好：前端「完成」必须 preview 渲染+截图验证，不能只 curl 200/tsc。

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/funds-layer/SettlementListPage.tsx
git commit -m "feat(admin): manual settle button on Settlement Batches page"
```

---

## Task 6: 集成验收 + 回归

**Files:**
- Create: `scripts/verify-manual-settle.ts`
- Modify: `package.json`（加 `verify:manual-settle` 脚本）

- [ ] **Step 1: 写集成验收脚本**

仿 `scripts/verify-two-book.ts`：建 1 客户 → 充值 USDT → swap USDT→AED（产生虚拟币 outstanding + 桥）→ 驱动法币腿结算。然后：
```
A) 记录 reval 前 FX_UNREALIZED_PNL(AED) 余额 U0。
B) runManualCryptoSettlement('VERIFY') → 驱动 EOD 腿(driveCryptoLeg) 到 CLEAR。
   断言：① 该 swap 虚拟币 Outstanding = SETTLED；② TRADE_CLEARING(USDT) 扫到 = open 贡献(应为 0 因唯一 swap 已结算)；
        ③ FX_POSITION(USDT) 贷方 = fromAmount（成本入账）；④ FX_UNREALIZED_PNL(AED) == U0（**未重估**）。
C) runEodSettlement('VERIFY') → 驱动其腿(若有) → 批次完成。
   断言：⑤ FX_UNREALIZED_PNL(AED) 按 fixing 更新（≠U0，= FX_POSITION(AED) − 成本）；⑥ checkInvariants violations 空。
全部用关系式/符号断言（对价漂移免疫，照 verify-two-book）。
```

- [ ] **Step 2: 加 npm 脚本**

`"verify:manual-settle": "DATABASE_URL=\"file:/tmp/exchange_js_branch/dev.db\" TB_ADDRESS=127.0.0.1:3503 ts-node -r tsconfig-paths/register scripts/verify-manual-settle.ts"`

- [ ] **Step 3: 跑集成验收（先 dev:rebuild 等价的干净 branch 基线，停后端避免写竞争）**

Run: `npm run verify:manual-settle`
Expected: 全部断言 PASS（关键：手动结算后 ④ FX_UNREALIZED 不变；EOD 后 ⑤ 变）。

- [ ] **Step 4: 回归 verify-two-book**

Run: `DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 npx ts-node -r tsconfig-paths/register scripts/verify-two-book.ts`
Expected: `verify-two-book: ALL PASS ✅`（EOD reval 路径未被破坏）。

- [ ] **Step 5: jest 全量回归**

Run: `npx jest src/modules/funds-layer`
Expected: 全绿。

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-manual-settle.ts package.json
git commit -m "test(funds-layer): integration verify for manual settle vs EOD reval"
```

---

## Self-Review（作者自查）

- **Spec 覆盖**：§3.1 CLEAR sweep-only→Task3；§3.2 reval 仅 EOD→Task1(kind)+Task3(门控)；§3.3 手动结算→Task2；§4 端点+前端→Task4/5；§5 三细节（invariants 在手动路径=Task3 checkInvariants 仍跑；cutoff=now→Task2；快照口径=Task6 断言④/⑤）；§6 不变量→Task6 断言⑥+回归；§9 验收→Task6。✅ 全覆盖。
- **占位符**：无 TBD；代码块均给出实体实现。RBAC catalog 文件名用 `grep` 定位（Step 注明）——非占位，是执行时一条具体命令。
- **类型一致**：`kind`('EOD'|'MANUAL_SETTLE')、`runManualCryptoSettlement`、`isBatchFullySettled`、`sweepBridges`/`revalueFxPositions`/`checkInvariants`、`RunEodSettlementResult` 全程一致。
- **风险点**：CLEAR 处理器既有 `runEodAccounting` 的进程级串行 latch（`runChain`）在改为直接调 `sweepBridges`/`revalueFxPositions` 后失效——这两个方法**不经 `runEodAccounting` 的 latch**。执行 Task3 时需保留串行保护：要么把 `sweepBridges`/`revalueFxPositions` 也纳入 `FxEodService` 的 `runChain`（在 FxEodService 暴露 `runSweepOnly(batchNo)` / `runReval(batchNo)` 两个走同一 latch 的入口），要么在 workflow 侧加锁。**执行 Task3 前先确认此点**（见 fx-eod.service.ts:47-63 latch 注释）。
