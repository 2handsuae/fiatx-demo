# Spec #4 — INTERNAL_FUND audit rename + INTERNAL_TRANSFER 去双写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 INTERNAL_FUND 状态机 audit 的 15 种长名 `FROM_TO_TO` 折叠成 10 种短动词过去式 + metadata.from；删除 INTERNAL_TRANSFER 的双写源（service 层老入口 + state-machine 端 PENDING_TO_*），只留 workflow 端单条 audit。

**Architecture:**
新增 INTERNAL_FUND 专用 helper `buildInternalFundStateAction(nextStatus)`（在 `audit-actions.constant.ts`），把 4 个 `buildStateTransitionAction('INTERNAL_FUND', ...)` 调用点换成新 helper、metadata 携带 `from: <currentStatus>`。`AuditActions.INTERNAL_FUND_CREATED` 等长名常量被 `CREATED` 等已存短名取代（OUTSTANDING/FEE_ACCRUAL 已用同名）。`internal-transactions.service.ts` line 294 与 723 的 audit 调用整段删除（V7 后老入口 + 状态机端双写）。`internal-transfer-workflow.service.ts` 的 3 处 audit 改用 `REQUESTED/SUCCEEDED/FAILED`，公共 `buildStateTransitionAction()` 函数不动（其他 entity 共用、下轮拉通）。

**Tech Stack:** NestJS + Prisma + jest + TypeScript

**Source spec:** `doc-final/superpowers/specs/2026-06-16-internal-fund-transfer-rename-dedup-design.md`

---

## File Map

**Modify (生产代码 5 文件)：**
- `src/modules/audit-logging/constants/audit-actions.constant.ts` — 扩短名 + 新 helper（T1）、清理废常量（T6）
- `src/modules/funds-layer/domain/funds-flow.service.ts:275/383/463/637` — 改 helper + 短名 + metadata.from（T2）
- `src/modules/asset-treasury/internal-funds/internal-funds.service.ts:246/355/499` — 改 helper + 短名 + metadata.from（T3）
- `src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts:115/159/168` — 改短名（T4）
- `src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts:294/723` — 删两处 audit（T5）

**Modify (测试 4 文件)：**
- `src/modules/funds-layer/domain/funds-flow.service.spec.ts`（T2）
- `src/modules/asset-treasury/internal-funds/internal-funds.service.spec.ts`（T3）
- `src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts`（T4）
- `src/modules/asset-treasury/internal-transactions/internal-transactions.service.spec.ts`（T5）

**依赖关系：**
- T1 必须先（其他任务依赖新常量/helper）
- T2/T3/T4/T5 可并行（不同文件、互无依赖）
- T6 必须在 T2-T5 全完成后（清理常量需先确认 0 引用）
- T7 终验在最后

---

## Task 1 — 扩 audit-actions.constant.ts 短名 + buildInternalFundStateAction helper

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Test: `src/modules/audit-logging/constants/audit-actions.constant.spec.ts`

### Pre-read

`audit-actions.constant.ts` 现有结构：line 285-288 集中 4 个 INTERNAL_*/INTERNAL_TX_* 常量；line 403-406 集中 4 个 INTERNAL_TRANSFER_/TRANSFER_ 常量；line 657 起是 `buildStateTransitionAction()` 公共函数。

OUTSTANDING/FEE_ACCRUAL 已用过的短名常量（Spec #3 引入）：`CREATED`、`LOCKED`、`SETTLED`、`REORGED` —— 新增的 INTERNAL_FUND 短名复用 `CREATED`，其他全新增。

### Steps

- [ ] **Step 1: Write the failing test** —— 在 `audit-actions.constant.spec.ts` 末尾追加：

```ts
import {
  AuditActions,
  buildInternalFundStateAction,
} from './audit-actions.constant';

describe('INTERNAL_FUND short-name actions', () => {
  it('exposes new short-name constants', () => {
    expect(AuditActions.SIGNING).toBe('SIGNING');
    expect(AuditActions.BROADCASTED).toBe('BROADCASTED');
    expect(AuditActions.CONFIRMING).toBe('CONFIRMING');
    expect(AuditActions.CONFIRMED).toBe('CONFIRMED');
    expect(AuditActions.CLEARED).toBe('CLEARED');
    expect(AuditActions.TIMED_OUT).toBe('TIMED_OUT');
    expect(AuditActions.REQUESTED).toBe('REQUESTED');
    expect(AuditActions.SUCCEEDED).toBe('SUCCEEDED');
    // Reused from OUTSTANDING/FEE_ACCRUAL (Spec #3):
    expect(AuditActions.CREATED).toBe('CREATED');
    expect(AuditActions.FAILED).toBe('FAILED');
    expect(AuditActions.CANCELLED).toBe('CANCELLED');
    expect(AuditActions.REORGED).toBe('REORGED');
  });
});

describe('buildInternalFundStateAction', () => {
  it.each([
    ['CREATED', 'CREATED'],
    ['SIGNING', 'SIGNING'],
    ['BROADCASTED', 'BROADCASTED'],
    ['CONFIRMING', 'CONFIRMING'],
    ['CONFIRMED', 'CONFIRMED'],
    ['CLEAR', 'CLEARED'],
    ['FAILED', 'FAILED'],
    ['TIMEOUT', 'TIMED_OUT'],
    ['CANCELLED', 'CANCELLED'],
    ['RETURNED', 'REORGED'],
  ])('maps %s → %s', (status, expected) => {
    expect(buildInternalFundStateAction(status)).toBe(expected);
  });

  it('falls back to lowercased status for unknown values', () => {
    expect(buildInternalFundStateAction('UNKNOWN_STATE')).toBe('unknown_state');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/modules/audit-logging/constants/audit-actions.constant.spec.ts -t "INTERNAL_FUND short-name|buildInternalFundStateAction" --no-coverage`

Expected: FAIL — `AuditActions.SIGNING` undefined（或 `buildInternalFundStateAction` 不存在）

- [ ] **Step 3: 加新短名常量** —— 在 `audit-actions.constant.ts` 的 `AuditActions` 对象内，line 406（`TRANSFER_WHITELIST_REJECTED` 之后）追加：

```ts
  // ───── Spec #4: INTERNAL_FUND/INTERNAL_TRANSFER 短名（CREATED/FAILED/CANCELLED/REORGED 已存于 OUTSTANDING/FEE_ACCRUAL）
  SIGNING: 'SIGNING',
  BROADCASTED: 'BROADCASTED',
  CONFIRMING: 'CONFIRMING',
  CONFIRMED: 'CONFIRMED',
  CLEARED: 'CLEARED',
  TIMED_OUT: 'TIMED_OUT',
  REQUESTED: 'REQUESTED',
  SUCCEEDED: 'SUCCEEDED',
```

> 注：CREATED / FAILED / CANCELLED / REORGED 已经在 Spec #3 (Outstanding/FeeAccrual) 引入，复用即可，不要再加。先 grep 验证：
> `grep -nE "^\s+(CREATED|FAILED|CANCELLED|REORGED):" src/modules/audit-logging/constants/audit-actions.constant.ts`
> 应至少各匹配 1 条。

- [ ] **Step 4: 加 buildInternalFundStateAction helper** —— 在文件末尾（`mapRawAuditActionToUserAction` 函数之后）追加：

```ts
// ───── Spec #4: INTERNAL_FUND 状态→短名映射
const INTERNAL_FUND_STATE_TO_ACTION: Record<string, string> = {
  CREATED: 'CREATED',
  SIGNING: 'SIGNING',
  BROADCASTED: 'BROADCASTED',
  CONFIRMING: 'CONFIRMING',
  CONFIRMED: 'CONFIRMED',
  CLEAR: 'CLEARED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMED_OUT',
  CANCELLED: 'CANCELLED',
  RETURNED: 'REORGED',
};

/**
 * Map INTERNAL_FUND state-machine target status to a short verb-past audit action.
 * Falls back to lowercased status string for any unmapped value (forward-compat).
 */
export function buildInternalFundStateAction(nextStatus: string): string {
  return (
    INTERNAL_FUND_STATE_TO_ACTION[nextStatus] ?? nextStatus.toLowerCase()
  );
}
```

- [ ] **Step 5: Run tests to verify it passes**

Run: `npx jest src/modules/audit-logging/constants/audit-actions.constant.spec.ts --no-coverage`

Expected: PASS（新增 12 个测试用例全过 + 既有测试不影响）

- [ ] **Step 6: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: 无 TS 错误（新常量/helper 不破坏既有签名）

- [ ] **Step 7: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/audit-logging/constants/audit-actions.constant.spec.ts
git commit -m "feat(spec#4): add INTERNAL_FUND short-name constants + buildInternalFundStateAction helper

- 8 new short-name action constants (SIGNING/BROADCASTED/CONFIRMING/CONFIRMED/CLEARED/TIMED_OUT/REQUESTED/SUCCEEDED)
- INTERNAL_FUND_STATE_TO_ACTION mapping + buildInternalFundStateAction(nextStatus) helper
- CREATED/FAILED/CANCELLED/REORGED reused from Spec #3 (OUTSTANDING/FEE_ACCRUAL)
- Old long-name constants kept for T6 cleanup after callsites migrate"
```

---

## Task 2 — funds-flow.service 状态机推进改 helper + metadata.from

**Files:**
- Modify: `src/modules/funds-layer/domain/funds-flow.service.ts` (lines 273-279, 383, 463, 637-641)
- Modify: `src/modules/funds-layer/domain/funds-flow.service.spec.ts`

**Depends on:** Task 1

### Pre-read

`funds-flow.service.ts` 4 处需改：

| 行号 | 现状 | 目标 |
|---|---|---|
| 273-279 | `action: buildStateTransitionAction('INTERNAL_FUND', InternalFundStatus.CONFIRMED, InternalFundStatus.CLEAR),` | `action: buildInternalFundStateAction(InternalFundStatus.CLEAR),` + metadata.from='CONFIRMED' |
| 383 | `action: AuditActions.INTERNAL_FUND_CREATED,` | `action: AuditActions.CREATED,` |
| 463 | `action: AuditActions.INTERNAL_FUND_CREATED,` | `action: AuditActions.CREATED,` |
| 637-641 | `action: buildStateTransitionAction('INTERNAL_FUND', currentStatus, nextStatus),` | `action: buildInternalFundStateAction(nextStatus),` + metadata.from=currentStatus |

注意：line 273-279 与 637-641 处现有调用没有 `metadata` 字段——需要新增。其他字段（entityType/entityId/reason 等）保持不变。

### Steps

- [ ] **Step 1: Write the failing tests** —— 在 `funds-flow.service.spec.ts` 找一个既有 audit 断言（如 `recordByActor` mock）的 describe block，追加 3 个测试：

```ts
describe('Spec #4: INTERNAL_FUND short-name audit actions', () => {
  it('emits CREATED short name when fund leg is created', async () => {
    // 借用既有"creates fund leg"测试场景的 setup（reuse pattern from existing tests in this file）。
    // The key assertion: recordByActor should be called with action: 'CREATED'.
    // ... (use existing test scaffolding; only assertion changes)
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATED' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits CLEARED short name + metadata.from=CONFIRMED on auto-clear', async () => {
    // 借用既有 auto-clear 测试场景。
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEARED',
        metadata: expect.stringContaining('"from":"CONFIRMED"'),
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits short name + metadata.from for state machine transitions', async () => {
    // 借用既有"transitions"测试场景，触发 CONFIRMING → CONFIRMED。
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CONFIRMED',
        metadata: expect.stringContaining('"from":"CONFIRMING"'),
      }),
      expect.anything(),
      expect.anything(),
    );
  });
});
```

> 实施时：先 `Read` 现有 funds-flow.service.spec.ts 找到 audit mock 的 setup pattern（很可能是 `const auditLogsService = { recordByActor: jest.fn(), recordSystem: jest.fn() };`），复用同一 mock；测试主体复用既有"creates fund leg" / "auto-clear" / "state transition" 的 arrange-act，断言改成上述短名。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/funds-layer/domain/funds-flow.service.spec.ts -t "Spec #4" --no-coverage`

Expected: FAIL（断言 `action: 'CREATED'` 但实际仍是 `'INTERNAL_FUND_CREATED'`，等等）

- [ ] **Step 3: Update funds-flow.service.ts line 383**

旧（line 382-385）：
```ts
          await this.auditLogsService.recordByActor(
            {
              action: AuditActions.INTERNAL_FUND_CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
```

新：
```ts
          await this.auditLogsService.recordByActor(
            {
              action: AuditActions.CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
```

- [ ] **Step 4: Update funds-flow.service.ts line 463**

同样改 `AuditActions.INTERNAL_FUND_CREATED` → `AuditActions.CREATED`。

- [ ] **Step 5: Update funds-flow.service.ts line 273-279（auto-clear path）**

确保 import 已有 `buildInternalFundStateAction`（顶部 imports 添加：`import { buildInternalFundStateAction } from '../../audit-logging/constants/audit-actions.constant';` —— 实际相对路径根据本文件路径推算，参考既有 `buildStateTransitionAction` 的 import）。

旧（line 273-281）：
```ts
      await this.auditLogsService.recordByActor(
        {
          action: buildStateTransitionAction(
            'INTERNAL_FUND',
            InternalFundStatus.CONFIRMED,
            InternalFundStatus.CLEAR,
          ),
          entityType: AuditEntityTypes.INTERNAL_FUND,
          entityId: fund.id,
```

新：
```ts
      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(InternalFundStatus.CLEAR),
          metadata: JSON.stringify({ from: InternalFundStatus.CONFIRMED }),
          entityType: AuditEntityTypes.INTERNAL_FUND,
          entityId: fund.id,
```

- [ ] **Step 6: Update funds-flow.service.ts line 637-641（state transition path）**

旧：
```ts
      await this.auditLogsService.recordByActor(
        {
          action: buildStateTransitionAction(
            'INTERNAL_FUND',
            currentStatus,
            nextStatus,
          ),
          entityType: AuditEntityTypes.INTERNAL_FUND,
```

新：
```ts
      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(nextStatus),
          metadata: JSON.stringify({ from: currentStatus }),
          entityType: AuditEntityTypes.INTERNAL_FUND,
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest src/modules/funds-layer/domain/funds-flow.service.spec.ts --no-coverage`

Expected: PASS（新 3 个 + 既有测试全过）

> 如果既有测试断言旧 action 名失败，需要把它们的断言一并升级为新短名（spec 已明确不留 alias）。

- [ ] **Step 8: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: 无 TS 错误

- [ ] **Step 9: Commit**

```bash
git add src/modules/funds-layer/domain/funds-flow.service.ts src/modules/funds-layer/domain/funds-flow.service.spec.ts
git commit -m "feat(spec#4): funds-flow.service INTERNAL_FUND audit uses short names + metadata.from

- line 383, 463: INTERNAL_FUND_CREATED → CREATED
- line 273-279: buildStateTransitionAction → buildInternalFundStateAction (auto-clear)
- line 637-641: buildStateTransitionAction → buildInternalFundStateAction (state transitions)
- metadata.from carries source state for traceability"
```

---

## Task 3 — internal-funds.service 改 helper + 短名 + metadata.from

**Files:**
- Modify: `src/modules/asset-treasury/internal-funds/internal-funds.service.ts` (lines 246-250, 355, 499)
- Modify: `src/modules/asset-treasury/internal-funds/internal-funds.service.spec.ts`

**Depends on:** Task 1

### Pre-read

3 处改动：

| 行号 | 现状 | 目标 |
|---|---|---|
| 246-250 | `action: buildStateTransitionAction('INTERNAL_FUND', InternalFundStatus.CONFIRMED, InternalFundStatus.CLEAR),` | `action: buildInternalFundStateAction(InternalFundStatus.CLEAR),` + metadata.from='CONFIRMED' |
| 355 | `action: AuditActions.INTERNAL_FUND_CREATED,` | `action: AuditActions.CREATED,` |
| 499 | `action: buildStateTransitionAction('INTERNAL_FUND', currentStatus, nextStatus),` | `action: buildInternalFundStateAction(nextStatus),` + metadata.from=currentStatus |

### Steps

- [ ] **Step 1: Write the failing tests** —— 在 `internal-funds.service.spec.ts` 追加：

```ts
describe('Spec #4: INTERNAL_FUND short-name audit actions', () => {
  it('emits CREATED short name on createFund', async () => {
    // reuse existing "creates fund" test pattern
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CREATED' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits CLEARED + metadata.from=CONFIRMED on auto-clear', async () => {
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLEARED',
        metadata: expect.stringContaining('"from":"CONFIRMED"'),
      }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits short name + metadata.from for state transitions', async () => {
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.stringMatching(/^(SIGNING|BROADCASTED|CONFIRMING|CONFIRMED|CLEARED|FAILED|TIMED_OUT|CANCELLED|REORGED)$/),
        metadata: expect.stringContaining('"from":'),
      }),
      expect.anything(),
      expect.anything(),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/asset-treasury/internal-funds/internal-funds.service.spec.ts -t "Spec #4" --no-coverage`

Expected: FAIL

- [ ] **Step 3: Update internal-funds.service.ts line 355** —— `AuditActions.INTERNAL_FUND_CREATED` → `AuditActions.CREATED`

- [ ] **Step 4: Update internal-funds.service.ts line 246-250**

确保 import: 顶部加 `buildInternalFundStateAction`（已 import `buildStateTransitionAction`、追加新名即可）。

旧（line 244-252）：
```ts
      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction(
            'INTERNAL_FUND',
            InternalFundStatus.CONFIRMED,
            InternalFundStatus.CLEAR,
          ),
          entityType: AuditEntityTypes.INTERNAL_FUND,
```

新：
```ts
      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(InternalFundStatus.CLEAR),
          metadata: JSON.stringify({ from: InternalFundStatus.CONFIRMED }),
          entityType: AuditEntityTypes.INTERNAL_FUND,
```

- [ ] **Step 5: Update internal-funds.service.ts line 499**

旧：
```ts
      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction('INTERNAL_FUND', currentStatus, nextStatus),
          entityType: AuditEntityTypes.INTERNAL_FUND,
```

新：
```ts
      await this.auditLogsService.recordByActor(
        {
          action: buildInternalFundStateAction(nextStatus),
          metadata: JSON.stringify({ from: currentStatus }),
          entityType: AuditEntityTypes.INTERNAL_FUND,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest src/modules/asset-treasury/internal-funds/internal-funds.service.spec.ts --no-coverage`

Expected: PASS

- [ ] **Step 7: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: 无 TS 错误

- [ ] **Step 8: Commit**

```bash
git add src/modules/asset-treasury/internal-funds/internal-funds.service.ts src/modules/asset-treasury/internal-funds/internal-funds.service.spec.ts
git commit -m "feat(spec#4): internal-funds.service INTERNAL_FUND audit uses short names + metadata.from

- line 355: INTERNAL_FUND_CREATED → CREATED
- line 246: auto-clear uses buildInternalFundStateAction + metadata.from=CONFIRMED
- line 499: state transitions use buildInternalFundStateAction + metadata.from=currentStatus"
```

---

## Task 4 — internal-transfer-workflow.service 3 处短名

**Files:**
- Modify: `src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts` (lines 115, 159, 168)
- Modify: `src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts`

**Depends on:** Task 1

### Pre-read

3 处改动：

| 行号 | 现状 | 目标 |
|---|---|---|
| 115 | `action: AuditActions.INTERNAL_TRANSFER_REQUESTED,` | `action: AuditActions.REQUESTED,` |
| 159 | `action: AuditActions.TRANSFER_COMPLETED,` | `action: AuditActions.SUCCEEDED,` |
| 168 | `action: AuditActions.TRANSFER_FAILED,` | `action: AuditActions.FAILED,` |

line 74 的 `AuditActions.TRANSFER_WHITELIST_REJECTED` 保留不动（不在 spec 范围）。

### Steps

- [ ] **Step 1: Write the failing tests** —— 在 `internal-transfer-workflow.service.spec.ts` 追加：

```ts
describe('Spec #4: INTERNAL_TRANSFER short-name audit actions', () => {
  it('emits REQUESTED short name on requestTransfer', async () => {
    // reuse existing "requestTransfer" test scaffold
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'REQUESTED' }),
      expect.anything(),
      expect.anything(),
    );
  });

  it('emits SUCCEEDED short name on funds-flow CLEAR event', async () => {
    // reuse existing "FUNDSFLOW_STATUS_CHANGED CLEAR" test scaffold
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SUCCEEDED' }),
    );
  });

  it('emits FAILED short name on funds-flow FAILED/TIMEOUT event', async () => {
    // reuse existing "FUNDSFLOW_STATUS_CHANGED FAILED" test scaffold
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'FAILED' }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts -t "Spec #4" --no-coverage`

Expected: FAIL

- [ ] **Step 3: Update internal-transfer-workflow.service.ts**

- line 115: `AuditActions.INTERNAL_TRANSFER_REQUESTED` → `AuditActions.REQUESTED`
- line 159: `AuditActions.TRANSFER_COMPLETED` → `AuditActions.SUCCEEDED`
- line 168: `AuditActions.TRANSFER_FAILED` → `AuditActions.FAILED`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts --no-coverage`

Expected: PASS

- [ ] **Step 5: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: 无 TS 错误

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/workflow/internal-transfer-workflow.service.ts src/modules/funds-layer/workflow/internal-transfer-workflow.service.spec.ts
git commit -m "feat(spec#4): internal-transfer-workflow audit uses short names

- line 115: INTERNAL_TRANSFER_REQUESTED → REQUESTED
- line 159: TRANSFER_COMPLETED → SUCCEEDED
- line 168: TRANSFER_FAILED → FAILED (reuses INTERNAL_FUND.FAILED constant)"
```

---

## Task 5 — internal-transactions.service 删 audit 双写

**Files:**
- Modify: `src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts` (delete lines 292-308 and 720-735)
- Modify: `src/modules/asset-treasury/internal-transactions/internal-transactions.service.spec.ts`

**Depends on:** Task 1 (logically — though it doesn't add new symbols, T1 establishes the new audit model used elsewhere)

### Pre-read

`internal-transactions.service.ts` 是 V7 之前的 legacy 入口；新业务通过 `internal-transfer-workflow.service` 进入并写 audit。本任务删除该 service 内的两处 audit 调用——这两处 audit 与 workflow 端 audit 重复（铁证：DB 中 `PENDING_TO_SUCCESS=237 ≈ TRANSFER_COMPLETED=225`）。

删除区段：

**第一处 (line 292-308)**：
```ts
        await this.auditLogsService.recordByActor(
          {

            action: AuditActions.INTERNAL_TX_CREATED,
            entityType: AuditEntityTypes.INTERNAL_TRANSACTION,
            entityId: created.id,
            entityNo: created.internalTxNo,
            entityOwnerType: created.ownerType,
            entityOwnerId: created.ownerId,
            reason: 'Initial creation',
            ...this.buildDepositWorkflowAuditContext(created),
            sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
          },
          {
            actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
            // ... actorId/actorRole
          },
          tx,
        );
```
完整删除整个 `await this.auditLogsService.recordByActor({...}, {...}, tx);` 表达式。

**第二处 (line 720-735)**：
```ts
      await this.auditLogsService.recordByActor(
        {

          action: buildStateTransitionAction('INTERNAL_TX', current, next),
          entityType: AuditEntityTypes.INTERNAL_TRANSACTION,
          // ...
        },
        // ...
      );
```
完整删除整个表达式。

### Steps

- [ ] **Step 1: Write the failing tests** —— 在 `internal-transactions.service.spec.ts` 追加：

```ts
describe('Spec #4: legacy audit double-write removed', () => {
  it('does NOT emit INTERNAL_TX_CREATED audit on create', async () => {
    // reuse existing "createInternalTx" test scaffold
    const createdActionCalls = (auditLogsService.recordByActor as jest.Mock).mock.calls.filter(
      (call) => call[0]?.action === 'INTERNAL_TX_CREATED',
    );
    expect(createdActionCalls).toHaveLength(0);
  });

  it('does NOT emit INTERNAL_TX_*_TO_* audit on state aggregate', async () => {
    // reuse existing "aggregate from internal funds" test scaffold
    const stateCalls = (auditLogsService.recordByActor as jest.Mock).mock.calls.filter(
      (call) => typeof call[0]?.action === 'string' && call[0].action.startsWith('INTERNAL_TX_'),
    );
    expect(stateCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest src/modules/asset-treasury/internal-transactions/internal-transactions.service.spec.ts -t "Spec #4" --no-coverage`

Expected: FAIL（旧 audit 仍在发）

- [ ] **Step 3: Delete first audit block (line 292-308 approx, around the INTERNAL_TX_CREATED call)**

操作：Read 当前 line 290-315、Edit 把整个 `await this.auditLogsService.recordByActor({...action: AuditActions.INTERNAL_TX_CREATED...}, {...}, tx);` 块（含尾分号）删干净。

- [ ] **Step 4: Delete second audit block (line 720-735 approx, around the buildStateTransitionAction('INTERNAL_TX',...) call)**

同上：Read line 715-740、Edit 删整个表达式。

- [ ] **Step 5: Remove unused imports (if applicable)**

删完后 grep `AuditActions.INTERNAL_TX_CREATED` 与 `buildStateTransitionAction` 在本文件的引用：

```bash
grep -nE "INTERNAL_TX_CREATED|buildStateTransitionAction" src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts
```

如果 `buildStateTransitionAction` 不再在本文件用、就从顶部 `import { ... buildStateTransitionAction ... }` 中删除。如果 `AuditActions` 还被其他 audit 调用用，保留 import；否则也删除。

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx jest src/modules/asset-treasury/internal-transactions/internal-transactions.service.spec.ts --no-coverage`

Expected: PASS（既有"audit was called" 类断言可能要松绑或更新）

- [ ] **Step 7: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: 无 TS 错误

- [ ] **Step 8: Commit**

```bash
git add src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts src/modules/asset-treasury/internal-transactions/internal-transactions.service.spec.ts
git commit -m "feat(spec#4): drop INTERNAL_TRANSFER audit double-write from legacy service

- delete line ~294 INTERNAL_TX_CREATED audit (duplicate of workflow REQUESTED)
- delete line ~723 INTERNAL_TX state-transition audit (source of PENDING_TO_SUCCESS noise)
- workflow remains single source of truth for INTERNAL_TRANSFER journey audit
- DB evidence: PENDING_TO_SUCCESS=237 ≈ TRANSFER_COMPLETED=225 (50% redundant)"
```

---

## Task 6 — audit-actions.constant.ts 清理废常量

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts` (delete lines 285-288 and 403-405)

**Depends on:** Tasks 2, 3, 4, 5 (call sites must be migrated first)

### Pre-read

删除的常量：

| 行 | 常量 | 删除原因 |
|---|---|---|
| 285 | `INTERNAL_TX_CREATED: 'INTERNAL_TX_CREATED',` | T5 已删除调用点 |
| 286 | `INTERNAL_FUND_CREATED: 'INTERNAL_FUND_CREATED',` | T2/T3 已迁移到 `CREATED` |
| 287 | `INTERNAL_FUND_CONFIRMING_TO_CONFIRMED: 'INTERNAL_FUND_CONFIRMING_TO_CONFIRMED',` | 未被生产代码引用（grep 0 命中）；状态机走 buildStateTransitionAction，常量本就死的 |
| 288 | `INTERNAL_TX_PENDING_TO_SUCCESS: 'INTERNAL_TX_PENDING_TO_SUCCESS',` | 同上、grep 0 命中 |
| 403 | `INTERNAL_TRANSFER_REQUESTED: 'INTERNAL_TRANSFER_REQUESTED',` | T4 已迁移到 `REQUESTED` |
| 404 | `TRANSFER_COMPLETED: 'TRANSFER_COMPLETED',` | T4 已迁移到 `SUCCEEDED` |
| 405 | `TRANSFER_FAILED: 'TRANSFER_FAILED',` | T4 已迁移到 `FAILED`（复用 INTERNAL_FUND.FAILED） |

line 406 `TRANSFER_WHITELIST_REJECTED` 保留（不在 spec 范围）。

### Steps

- [ ] **Step 1: Pre-flight grep verification —— 确认 0 引用**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
for sym in INTERNAL_TX_CREATED INTERNAL_FUND_CREATED INTERNAL_FUND_CONFIRMING_TO_CONFIRMED INTERNAL_TX_PENDING_TO_SUCCESS INTERNAL_TRANSFER_REQUESTED TRANSFER_COMPLETED TRANSFER_FAILED; do
  count=$(grep -rnE "AuditActions\.${sym}\b" src --include="*.ts" 2>/dev/null | grep -v "audit-actions.constant.ts" | wc -l | tr -d ' ')
  echo "${sym}: ${count} references"
done
```

Expected: 全部 0 references（如果非零，说明 T2-T5 漏改了某处，必须先修复）。

- [ ] **Step 2: Delete the 7 constants in audit-actions.constant.ts**

删 line 285-288（4 个常量）+ line 403-405（3 个常量）。注意保留 line 406 `TRANSFER_WHITELIST_REJECTED`。

> Edit 操作：分两次 Edit（一次删 285-288 段、一次删 403-405 段）。

- [ ] **Step 3: Build check**

Run: `npm run build 2>&1 | tail -5`

Expected: 无 TS 错误

- [ ] **Step 4: Full jest run**

Run: `npx jest --no-coverage 2>&1 | tail -15`

Expected: 全部 PASS（如果有 spec 引用了删除的常量，会在这里抓出来）

- [ ] **Step 5: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "chore(spec#4): drop 7 obsolete INTERNAL_*/TRANSFER_* audit constants

- INTERNAL_TX_CREATED, INTERNAL_FUND_CREATED, INTERNAL_FUND_CONFIRMING_TO_CONFIRMED,
  INTERNAL_TX_PENDING_TO_SUCCESS (4 from line 285-288)
- INTERNAL_TRANSFER_REQUESTED, TRANSFER_COMPLETED, TRANSFER_FAILED (3 from line 403-405)
- TRANSFER_WHITELIST_REJECTED preserved (out of scope)
- grep verified: 0 production references"
```

---

## Task 7 — Live recon (run sim + SQL 三连验证)

**Files:** N/A (verification only — no code changes)

**Depends on:** Tasks 1-6 all green

### Pre-read

跑一轮完整 sim → 用 SQL 验证：
1. INTERNAL_FUND 新短名出现、旧拼装名 0 条新增
2. INTERNAL_TRANSFER 单写
3. metadata.from 保留状态机字面

### Steps

- [ ] **Step 1: Reset branch DB + start services**

Run: `npm run dev:reset:branch 2>&1 | tail -10`

Expected: branch stack 启动成功（API 3500 / Admin 3501 / Client 3502 / TigerBeetle 3503）。

> 注：必须用 `dev:reset:branch`，不用 `dev:reset`（后者跨栈、损坏 main DB）；绝不用 `dev:rebuild`（硬编码 main 栈）。

- [ ] **Step 2: Note timestamp for "before sim" baseline**

Run:
```bash
date '+%Y-%m-%d %H:%M:%S'
```

Expected: 记下时间戳 T0，后续 SQL 用 `occurredAt > 'T0'` 过滤。

- [ ] **Step 3: Run end-to-end sim (deposits → swaps → settlements → withdraws → transfers)**

Run（参考既有 sim 脚本，按 codebase 习惯，例如）：

```bash
npx ts-node scripts/sim-deposits-only.ts 2>&1 | tail -5
# 或既有的端到端 seed：
npm run seed:demo 2>&1 | tail -5
```

Expected: sim 成功、产出 fund/transfer 业务数据。

> 如果 sim 脚本失败（与 SQLite write-lock 冲突等横切问题相关），降级方案：手工触发几个 internal-transfer 用 admin UI 或既有 `seed-fiat-settle-demo.ts`，只要能产 INTERNAL_FUND/INTERNAL_TRANSFER audit_log_events 即可。

- [ ] **Step 4: SQL 验证 ① —— INTERNAL_FUND 只见短名**

Run:
```bash
DB=/tmp/exchange_js_branch/dev.db
sqlite3 -header $DB "
SELECT action, COUNT(*) n FROM audit_log_events
WHERE entityType='INTERNAL_FUND' AND occurredAt > datetime('now','-30 minutes')
GROUP BY action ORDER BY n DESC;
"
```

Expected:
- 只见 `CREATED` / `SIGNING` / `BROADCASTED` / `CONFIRMING` / `CONFIRMED` / `CLEARED` / `FAILED` / `TIMED_OUT` / `CANCELLED` / `REORGED` 等短名
- **不见** `INTERNAL_FUND_*_TO_*` 或 `INTERNAL_FUND_CREATED` 长名（如果见到则 T2/T3 漏改）

- [ ] **Step 5: SQL 验证 ② —— INTERNAL_TRANSFER 单写**

Run:
```bash
sqlite3 -header $DB "
SELECT action, COUNT(*) n FROM audit_log_events
WHERE entityType='INTERNAL_TRANSFER' AND occurredAt > datetime('now','-30 minutes')
GROUP BY action ORDER BY n DESC;
"
```

Expected:
- 只见 `REQUESTED` / `SUCCEEDED` / `FAILED` / `CANCELLED` / `TRANSFER_WHITELIST_REJECTED`（保留的）
- **不见** `INTERNAL_TRANSFER_INTERNAL_FUNDS_PENDING_TO_*`（双写已删）
- **不见** `INTERNAL_TX_CREATED` 在 INTERNAL_TRANSACTION entityType 下

```bash
sqlite3 -header $DB "
SELECT action, COUNT(*) n FROM audit_log_events
WHERE entityType='INTERNAL_TRANSACTION' AND occurredAt > datetime('now','-30 minutes')
GROUP BY action ORDER BY n DESC;
"
```

Expected: `INTERNAL_TX_CREATED` 0 条；`INTERNAL_TX_*_TO_*` 0 条。

- [ ] **Step 6: SQL 验证 ③ —— metadata.from 保留状态机字面**

Run:
```bash
sqlite3 -header $DB "
SELECT json_extract(metadata, '\$.from') AS from_state, action, COUNT(*) n
FROM audit_log_events
WHERE entityType='INTERNAL_FUND' AND action IN ('CONFIRMING','CONFIRMED','CLEARED','FAILED')
  AND occurredAt > datetime('now','-30 minutes')
GROUP BY from_state, action ORDER BY action, n DESC;
"
```

Expected:
- `CONFIRMING` 行 `from_state ∈ {CREATED, BROADCASTED}`
- `CONFIRMED` 行 `from_state='CONFIRMING'`
- `CLEARED` 行 `from_state='CONFIRMED'`
- `FAILED` 行 `from_state ∈ {SIGNING, BROADCASTED, CONFIRMING}`
- 不见 `from_state IS NULL` 的行（如果见到则某些路径漏加 metadata）

- [ ] **Step 7: 全栈 jest + build + admin tsc 最终绿灯**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx jest --no-coverage 2>&1 | tail -10
npm run build 2>&1 | tail -5
cd admin-web && npx tsc --noEmit 2>&1 | tail -5
```

Expected: 所有命令 0 failed / 0 errors。

- [ ] **Step 8: Final commit（验收报告，如有补丁）**

如 Step 4-6 暴露漏改：补丁 + commit。如全绿：no-op，本任务无新 commit；只在 PR 描述（或 thread）记录"live recon ✅ 三连 SQL 验收通过"。

---

## Self-Review (post-write)

### Spec coverage check

| Spec section | Covered by |
|---|---|
| §3.1 折叠规则（10 短名） | T1 (helper mapping) + T2/T3 (调用点) |
| §3.2 TS 常量改名 | T1 (新增) + T6 (清理废) |
| §3.3 buildInternalFundStateAction | T1 |
| §4.1 删除点（line 294 + 723） | T5 |
| §4.2 workflow 端改名（3 处） | T4 |
| §4.3 删除常量 | T6 |
| §6 测试覆盖（6 项） | T1 (TX2) + T2 (TX3) + T3 (TX3) + T4 (TX3) + T5 (TX2) |
| §7 SQL 验收三连 | T7 |

无遗漏。

### Placeholder scan

无 TBD / TODO / "implement later" / 含糊文案。每个步骤含完整可执行代码或命令。

### Type consistency

- `buildInternalFundStateAction(nextStatus: string): string` —— 统一签名
- `metadata: JSON.stringify({ from: <currentStatus> })` —— 字符串类型，与 audit-logs.service 的 metadata 字段一致
- 短名常量值统一大写下划线（`'TIMED_OUT'` 等），与 OUTSTANDING/FEE_ACCRUAL 风格对齐

### Scope check

聚焦 INTERNAL_*（INTERNAL_FUND + INTERNAL_TRANSFER + INTERNAL_TRANSACTION），不动 SWAP/DEPOSIT/PAYIN/WITHDRAWAL/BATCH，不动 `buildStateTransitionAction()` 公共函数，不动表结构。范围清晰。

### Dependency consistency

- T1 必先（所有其他任务用其新增的常量/helper）
- T2/T3/T4/T5 互无依赖（不同文件，可并行）
- T6 在 T2-T5 之后（清理需先确认 0 引用）
- T7 全部之后（live recon）

DAG 清晰、无循环。
