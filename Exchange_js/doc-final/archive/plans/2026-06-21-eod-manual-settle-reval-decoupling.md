# EOD / 手动结算 — FX 重估解耦 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把虚拟币「结算+桥清」（按成本，可手动随时触发）与「FX 重估」（按 fixing 盯市，仅 EOD）解耦，并在 Settlement Batches 页加「手动结算」按钮。

**Architecture:** `FxEodService` 的 `sweepBridges()` / `revalueFxPositions()` 本已是独立方法。把结算 CLEAR 路径改为只 `sweepBridges`；reval 仅在 **EOD 类批次**触发。新增 `runManualCryptoSettlement`（settle+sweep，不 reval）+ admin 端点 + 前端按钮。**复用现有 `SettlementBatch.settlementType`**（默认 `EOD`；手动批次置 `MANUAL_SETTLE`）区分两类——**无需迁移**（字段与 `createBatch` 入参均已存在；reval 门控在 `EOD_SOURCE_TYPE` 分支内，fee 批次 sourceType 不同、不会命中）。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle + Jest（单测）+ ts-node 集成验收脚本 + React(admin-web)。

参考 spec：`doc-final/superpowers/specs/2026-06-21-eod-manual-settle-reval-decoupling-design.md`

> **变更记录（2026-06-21 执行前修正）**：原 Task1「SettlementBatch.kind 迁移」**删除**——经核查 `settlementType`（`@default("EOD")`）已存在且 `createBatch` 已接受，直接复用，零迁移。任务由 6 → 5。执行 Task1 前须确认无代码对 `settlementType` 做严格枚举校验会拒绝新值 `MANUAL_SETTLE`（多为自由字符串）。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts` | EOD/手动结算编排 + CLEAR 处理器解耦 | 改（核心） |
| `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts` | 单测：reval 门控 + 手动不 reval | 改/建 |
| `src/modules/funds-layer/controllers/settlement-admin.controller.ts` | `POST /settle` 端点 | 改 |
| `src/<rbac catalog>` | 端点权限登记 | 改 |
| `admin-web/src/pages/funds-layer/SettlementListPage.tsx` | 「手动结算」按钮 | 改 |
| `scripts/verify-manual-settle.ts` | 集成验收（手动 settle 不 reval；EOD reval） | 建 |
| `package.json` | `verify:manual-settle` 脚本 | 改 |

> 环境（branch 栈）：working dir `…/.wt/branch/Exchange_js`；`DATABASE_URL=file:/tmp/exchange_js_branch/dev.db`；`TB_ADDRESS=127.0.0.1:3503`；API 在 3500（可能运行中）。集成脚本/重启后端时如遇 DB 写竞争，停**仅** 3500（`lsof -ti:3500 | xargs kill`），保 TB 3503。**禁用** `dev:reset`/`dev:rebuild`（main-scoped）。git 分支 `branch`，提交于此。

---

## Task 1: runManualCryptoSettlement（settle + 桥清，不 reval）

**Files:**
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`
- Test: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`

- [ ] **Step 1: 写失败单测——手动结算建 MANUAL_SETTLE 批次且不调 reval**

用 Nest TestingModule，mock `FxEodService`/`OutstandingConsumerService`/`SettlementBatchService`/`FeeAccrualService`/`TransferWorkflow`(实际注入名以服务构造函数为准)/`SystemWalletsService`/`PrismaService`（参照同文件既有 spec 的 provider mock 写法）：
```typescript
it('runManualCryptoSettlement: creates MANUAL_SETTLE batch and never revalues', async () => {
  consumer.findOpenCryptoByAsset.mockResolvedValue([
    { assetId: 'usdt', net: 100n, inAmount: '100', outAmount: '0', outstandingIds: ['o1'] } as any,
  ]);
  batchService.createBatch.mockResolvedValue({ id: 'b1', batchNo: 'SB-1' } as any);
  batchService.resolveCryptoDirection.mockReturnValue({ fromRole: 'C_MAIN', toRole: 'F_OPS', amount: { toString: () => '100' } } as any);
  transferWorkflow.initiate.mockResolvedValue({ id: 't1' } as any);

  await service.runManualCryptoSettlement('ADMIN');

  expect(batchService.createBatch).toHaveBeenCalledWith(expect.objectContaining({ settlementType: 'MANUAL_SETTLE' }));
  expect(fxEod.revalueFxPositions).not.toHaveBeenCalled();
  expect(fxEod.runEodAccounting).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts -t "runManualCryptoSettlement"`
Expected: FAIL（`runManualCryptoSettlement is not a function`）。

- [ ] **Step 3: 实现 runManualCryptoSettlement**

复制 `runEodSettlement`(:61) 骨架，去掉 reval，建批次带 `settlementType: 'MANUAL_SETTLE'`：
```typescript
/** 手动结算：当日 0:00→cutoff 的 open 虚拟币 Outstanding+FeeAccrual 打包结算 + 桥清(成本)，不 reval。 */
async runManualCryptoSettlement(operatorId = 'ADMIN', cutoff?: Date): Promise<RunEodSettlementResult> {
  const cut = cutoff ?? new Date();
  const groups = await this.consumer.findOpenCryptoByAsset(cut);
  if (groups.length === 0) {
    await this.runFeePass(cut);
    return { batchNo: null, assetCount: 0, settledZero: 0, spawned: 0 };
  }
  const batch = await this.batchService.createBatch({ cutoffAt: cut, settlementType: 'MANUAL_SETTLE' });
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
> 与 `runEodSettlement` 的唯一差异：批次 `settlementType='MANUAL_SETTLE'`、`triggerSource='MANUAL_SETTLE'`、**末尾无 reval**。`runFeePass` 已带 cutoff、结算虚拟币 fee accruals，直接复用。若实例字段名（`consumer`/`batchService`/`transferWorkflow`/`systemWallets`）与既有 `runEodSettlement` 不一致，以文件实际为准。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts -t "runManualCryptoSettlement"`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts
git commit -m "feat(funds-layer): runManualCryptoSettlement (settle+sweep, no reval)"
```

---

## Task 2: CLEAR 处理器解耦——sweep-only + reval 仅 EOD 批次

**Files:**
- Modify: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts`（:137 与 :201-225）
- Test: `src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`

> ⚠️ **latch 风险（执行前必读）**：`FxEodService.runEodAccounting` 经进程级 `runChain` 串行 latch（fx-eod.service.ts:47-63）防并发双记账。本任务改为直接调 `sweepBridges`/`revalueFxPositions` 会**绕过该 latch**。必须保持串行保护：在 `FxEodService` 暴露走同一 `runChain` 的入口（如 `runSweepOnly(batchNo)` 和 `runReval(batchNo)`，各自 `this.runChain = this.runChain.then(() => doSweep/doReval)`），workflow 调这两个入口；**不要**在 workflow 侧直接调裸 `sweepBridges`/`revalueFxPositions`。单测相应断言调用 `runSweepOnly`/`runReval`。

- [ ] **Step 1: FxEonService 暴露 latch 化入口（先于 workflow 改动）**

在 `fx-eod.service.ts` 加（复用现有 `runChain`）：
```typescript
/** sweep-only（结算触发路径用）：成本扫桥 + 不变量，不 reval。走 runChain 串行。 */
async runSweepOnly(batchNo: string): Promise<EodAccountingReport> {
  const run = this.runChain.then(() => this.doSweepOnly(batchNo), () => this.doSweepOnly(batchNo));
  this.runChain = run.catch(() => {});
  return run;
}
private async doSweepOnly(batchNo: string): Promise<EodAccountingReport> {
  const report: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
  await this.sweepBridges(batchNo, report);
  await this.checkInvariants(report);
  return report;
}
/** reval（仅 EOD 触发）：盯市 + 不变量。走 runChain 串行。 */
async runReval(batchNo: string): Promise<EodAccountingReport> {
  const run = this.runChain.then(() => this.doReval(batchNo), () => this.doReval(batchNo));
  this.runChain = run.catch(() => {});
  return run;
}
private async doReval(batchNo: string): Promise<EodAccountingReport> {
  const report: EodAccountingReport = { sweeps: [], revals: [], violations: [] };
  await this.sweepBridges(batchNo, report); // EOD 兜底扫尾再盯市
  await this.revalueFxPositions(batchNo, report);
  await this.checkInvariants(report);
  return report;
}
```
> `runEodAccounting` 保留（其它调用方/回归不破）；新入口与其共享 `runChain`。

- [ ] **Step 2: 写失败单测——CLEAR 对 EOD 批次 reval、对 MANUAL_SETTLE 不 reval**

```typescript
it('CLEAR of EOD principal leg: sweep-only, and reval when batch fully settled', async () => {
  (prisma as any).internalTransaction.findUnique.mockResolvedValue({ id: 't1', sourceType: 'EOD_SETTLEMENT', settlementBatchId: 'b1' });
  (prisma as any).settlementBatch.findUnique.mockResolvedValue({ batchNo: 'SB-1', settlementType: 'EOD' });
  (prisma as any).outstanding.count.mockResolvedValue(0); // 全 SETTLED
  await service.onFundsFlowStatusChanged({ internalTransferId: 't1', fundsFlowId: 'f1', newStatus: 'CLEAR' } as any);
  expect(fxEod.runSweepOnly).toHaveBeenCalledWith('SB-1');
  expect(fxEod.runReval).toHaveBeenCalledWith('SB-1');
});

it('CLEAR of MANUAL_SETTLE principal leg: sweep-only, never reval', async () => {
  (prisma as any).internalTransaction.findUnique.mockResolvedValue({ id: 't2', sourceType: 'EOD_SETTLEMENT', settlementBatchId: 'b2' });
  (prisma as any).settlementBatch.findUnique.mockResolvedValue({ batchNo: 'SB-2', settlementType: 'MANUAL_SETTLE' });
  (prisma as any).outstanding.count.mockResolvedValue(0);
  await service.onFundsFlowStatusChanged({ internalTransferId: 't2', fundsFlowId: 'f2', newStatus: 'CLEAR' } as any);
  expect(fxEod.runSweepOnly).toHaveBeenCalledWith('SB-2');
  expect(fxEod.runReval).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: 跑测试确认失败**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts -t "CLEAR of"`
Expected: FAIL（当前调 `runEodAccounting`，无门控）。

- [ ] **Step 4: 改 CLEAR 处理器（EOD_SOURCE_TYPE 分支，:212-225）**

```typescript
try {
  const batch = await (this.prisma as any).settlementBatch.findUnique({
    where: { id: transfer.settlementBatchId },
    select: { batchNo: true, settlementType: true },
  });
  if (batch?.batchNo) {
    if (batch.settlementType === 'EOD' && (await this.isBatchFullySettled(transfer.settlementBatchId))) {
      await this.fxEod.runReval(batch.batchNo);          // 仅 EOD 批次完成：扫桥+盯市
    } else {
      await this.fxEod.runSweepOnly(batch.batchNo);       // 其余（含手动）：仅成本扫桥
    }
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

- [ ] **Step 5: 改 runEodSettlement(:137)**

`await this.fxEod.runEodAccounting(batch.batchNo);` → `await this.fxEod.runReval(batch.batchNo);`
> EOD 入口此处 reval = 当日 mark；新结算腿 CLEAR 后经 Step 4 在批次完成时再 reval 一次（runReval 内含 sweep + 幂等盯市），保证当日已结算头寸最终被正确盯市。`createBatch({ cutoffAt: cut })` 的 settlementType 默认即 `EOD`，无需显式传。

- [ ] **Step 6: 跑测试确认通过**

Run: `npx jest src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts`
Expected: 新增用例 PASS，既有用例不回归。

- [ ] **Step 7: Commit**

```bash
git add src/modules/funds-layer/accounting/fx-eod.service.ts src/modules/funds-layer/workflow/eod-settlement-workflow.service.ts src/modules/funds-layer/workflow/eod-settlement-workflow.service.spec.ts
git commit -m "refactor(funds-layer): CLEAR path sweeps only (latched); reval gated to EOD batch completion"
```

---

## Task 3: Admin 端点 POST /settle + RBAC

**Files:**
- Modify: `src/modules/funds-layer/controllers/settlement-admin.controller.ts`（`@Controller('admin/funds-layer/settlements')`）
- Modify: RBAC catalog（`grep -rl "rbac.catalog\|RBAC_PERMISSION_DEFINITIONS" src` 定位；与现有 `POST .../settlements/run` 同权限族登记新 route）

- [ ] **Step 1: 加端点**

照搬 `@Post('run')`(:40-46) 的守卫注解，新增：
```typescript
@Post('settle')
async manualSettle() {
  return this.eodWorkflow.runManualCryptoSettlement('ADMIN');
}
```

- [ ] **Step 2: RBAC 登记**

用与 `POST .../settlements/run` 相同的权限定义登记 `POST .../settlements/settle`（catalog `route(...)`）。

- [ ] **Step 3: 同步权限 + 重启后端**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npm run db:base:sync
# 重启 branch 后端(3500)：内存 RBAC_PERMISSION_DEFINITIONS 须重载，只 sync 不重启=白费
```
Expected: sync 成功；重启后新端点可达（非 403）。

- [ ] **Step 4: 冒烟**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3500/admin/funds-layer/settlements/settle -H "Authorization: Bearer <admin-jwt>"`
Expected: 200（无 open 虚拟币时返回 batchNo=null 也算正常 200）。
> 取 admin JWT：照项目既有冒烟方式（如 seed 的 SUPER_ADMIN 登录），无现成则向控制者要。

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/controllers/settlement-admin.controller.ts src/<rbac-catalog-file>
git commit -m "feat(funds-layer): POST /settlements/settle (manual crypto settlement) + RBAC"
```

---

## Task 4: Settlement Batches 页「手动结算」按钮

**Files:**
- Modify: `admin-web/src/pages/funds-layer/SettlementListPage.tsx`

- [ ] **Step 1: 加按钮 + 调用**

照现有「Run EOD」按钮（调 `POST .../settlements/run`）旁加「结算 + 桥清（不重估）」按钮，调 `POST .../settlements/settle`，二次确认 + 成功后刷新列表 + 显示返回 batchNo。复用页面既有 api client/按钮组件，匹配暗色主题。

- [ ] **Step 2: 渲染验收（截图比对）**

启动 admin（3501，VITE_API_URL=3500），preview 打开 Settlement Batches 页：
- 截图确认两个按钮并存、样式对齐既有原子。
- 点「结算+桥清」→ 确认弹窗 → 执行 → 列表刷新出现新 `MANUAL_SETTLE` 批次（settlementType 列）。
> 用户偏好：前端「完成」必须 preview 渲染+截图验证，不能只 curl 200/tsc。

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/funds-layer/SettlementListPage.tsx
git commit -m "feat(admin): manual settle button on Settlement Batches page"
```

---

## Task 5: 集成验收 + 回归

**Files:**
- Create: `scripts/verify-manual-settle.ts`
- Modify: `package.json`（加 `verify:manual-settle`）

- [ ] **Step 1: 写集成验收脚本**

仿 `scripts/verify-two-book.ts`：建 1 客户 → 充值 USDT → swap USDT→AED（产生虚拟币 outstanding + 桥）→ 驱动法币腿结算。然后：
```
A) 记录 reval 前 FX_UNREALIZED_PNL(AED) 余额 U0。
B) runManualCryptoSettlement('VERIFY') → 驱动 EOD 腿(driveCryptoLeg) 到 CLEAR。
   断言：① 该 swap 虚拟币 Outstanding = SETTLED；② TRADE_CLEARING(USDT) 扫到 = open 贡献(唯一 swap 已结算→0)；
        ③ FX_POSITION(USDT) 贷方 = fromAmount（成本入账）；④ FX_UNREALIZED_PNL(AED) == U0（**未重估**）。
C) runEodSettlement('VERIFY') → 驱动其腿(若有) → 批次完成。
   断言：⑤ FX_UNREALIZED_PNL(AED) 按 fixing 更新（≠U0，= FX_POSITION(AED) − 成本）；⑥ checkInvariants violations 空。
全部用关系式/符号断言（对价漂移免疫，照 verify-two-book）。
```

- [ ] **Step 2: 加 npm 脚本**

`"verify:manual-settle": "DATABASE_URL=\"file:/tmp/exchange_js_branch/dev.db\" TB_ADDRESS=127.0.0.1:3503 ts-node -r tsconfig-paths/register scripts/verify-manual-settle.ts"`

- [ ] **Step 3: 跑集成验收（停 3500 避免写竞争，保 TB 3503）**

Run: `npm run verify:manual-settle`
Expected: 全部断言 PASS（关键：手动结算后 ④ FX_UNREALIZED 不变；EOD 后 ⑤ 变）。

- [ ] **Step 4: 回归 verify-two-book**

Run: `DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" TB_ADDRESS=127.0.0.1:3503 npx ts-node -r tsconfig-paths/register scripts/verify-two-book.ts`
Expected: `verify-two-book: ALL PASS ✅`（EOD reval 路径未破）。

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

- **Spec 覆盖**：§3.1 CLEAR sweep-only→Task2 Step4；§3.2 reval 仅 EOD→复用 settlementType（Task1 置 MANUAL_SETTLE）+ Task2 门控；§3.3 手动结算→Task1；§4 端点+前端→Task3/4；§5 三细节（invariants 在手动路径=runSweepOnly 内 checkInvariants；cutoff=now→Task1；快照口径=Task5 ④/⑤）；§6 不变量→Task5 ⑥+回归；§9 验收→Task5。✅
- **占位符**：无 TBD；代码块齐全。RBAC catalog 文件 + admin JWT 取法用 `grep`/项目既有方式定位（执行时具体命令），非占位。
- **类型一致**：`settlementType`('EOD'|'MANUAL_SETTLE'…)、`runManualCryptoSettlement`、`runSweepOnly`/`runReval`、`isBatchFullySettled`、`RunEodSettlementResult` 全程一致。
- **关键风险**：① latch（Task2 Step1 已用 `runChain` 化入口解决）；② `settlementType` 新值 `MANUAL_SETTLE` 须确认无严格枚举校验拒绝（执行前 grep 校验点）；③ 集成脚本/重启与运行中 API 的 DB 写竞争（停 3500、保 TB 3503）。
