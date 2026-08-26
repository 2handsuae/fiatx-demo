# Payin Sim 完备性(中间版)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 spec `doc-final/superpowers/specs/2026-06-11-payin-sim-completeness-design.md` 补 crypto payin 两条真实转换(DETECTED→FAILED、CONFIRMING→DETECTED 浅重组)+ sim 面板瞬态/终态文案。

**Architecture:** 后端 enum+状态机+mock 映射三处小改(TDD);前端动作表两行 + 面板分支文案。无记账/schema 变更。

**Tech Stack:** NestJS+Prisma、React+Vite。`npx jest <file>`;`cd admin-web && npx tsc --noEmit`。分支 `branch`,只 commit 不 push。

**已钉事实:** 状态机 switch 在 payins.service.ts:396-432(fiat 在前、crypto 在 else 分支);mock 事件 switch 在 :517-540;enums 在 dto/payin.dto.ts:10-31;前端动作表 depositActionMap.ts:117-128;面板渲染 PayinDetail.tsx:309-330(`simActions.length > 0` 条件);`getPayinSimActionsForStatus` 返回 enabled 标志。

---

### Task 1: 后端 — 两条新转换 + REORG 事件(TDD)

**Files:**
- Modify: `src/modules/asset-treasury/payins/dto/payin.dto.ts`
- Modify: `src/modules/asset-treasury/payins/payins.service.ts`
- Test: `src/modules/asset-treasury/payins/payins.service.spec.ts`(先 Read 现 mock 结构)

- [x] **Step 1: 失败测试**(按现 spec 风格,断言语义)

```typescript
    it('crypto DETECTED + fail → FAILED(mempool 丢弃/RBF)', async () => {
      // mock findOne 返回 { status: 'DETECTED', type: 'CRYPTO', statusHistory: null }
      // updateStatus(id, PayinAction.FAIL) → prisma.payin.update data.status === 'FAILED'
    });
    it('crypto CONFIRMING + reorg → DETECTED(浅重组退回 mempool)', async () => {
      // status CONFIRMING + PayinAction.REORG → update data.status === 'DETECTED'
    });
    it('fiat 不支持 REORG mock 事件 → BadRequest', async () => {
      // simulateMockEvent(id, PayinMockEvent.REORG) with type FIAT → rejects
    });
```

(以现 spec 的 service 构造/mock prisma 模式落地;mock 事件入口方法名以实际为准——:548 行附近 `updateStatus(id, action, { simulationMode })` 的外层方法。)

- [x] **Step 2: 跑红** `npx jest src/modules/asset-treasury/payins/payins.service.spec.ts` → FAIL
- [x] **Step 3: 实现**

dto:`PayinAction` 加 `REORG = 'reorg',`;`PayinMockEvent` 加 `REORG = 'REORG',`。

payins.service.ts crypto 分支(else 段)改:
```typescript
      switch (currentStatus) {
        case PayinStatus.DETECTED:
          if (action === PayinAction.BLOCK) nextStatus = PayinStatus.CONFIRMING;
          if (action === PayinAction.FAIL) nextStatus = PayinStatus.FAILED; // mempool dropped / RBF replaced
          break;
        case PayinStatus.CONFIRMING:
          if (action === PayinAction.CONFIRM) nextStatus = PayinStatus.CONFIRMED;
          if (action === PayinAction.FAIL) nextStatus = PayinStatus.FAILED;
          if (action === PayinAction.REORG) nextStatus = PayinStatus.DETECTED; // shallow reorg → back to mempool
          break;
        case PayinStatus.CONFIRMED:
          if (action === PayinAction.CLEAR) nextStatus = PayinStatus.CLEARED;
          break;
      }
```
(状态机注释块同步更新两行。)

mock 事件 crypto switch 加:
```typescript
        case PayinMockEvent.REORG:
          action = PayinAction.REORG;
          break;
```
(fiat switch 不加 → REORG 落入既有 not-supported 异常。)

- [x] **Step 4: 跑绿** 同文件 + `npx jest src/modules/asset-treasury` + `npm run build` 零错
- [x] **Step 5: Commit** `git add -A && git commit -m "feat(payins): mempool-stage failure + shallow-reorg transitions (sim completeness, middle tier)"`

---

### Task 2: 前端 — 动作表 + 面板文案

**Files:**
- Modify: `admin-web/src/utils/depositActionMap.ts:117-121`
- Modify: `admin-web/src/pages/PayinDetail.tsx:309-330`(先 Read 现段)

- [x] **Step 1: 动作表**

```typescript
const CRYPTO_SIM_ACTIONS: PayinSimAction[] = [
  { event: 'MEMPOOL_SEEN',    label: '⚡ Mempool Seen',            enabledStatuses: new Set(['DETECTED']) },
  { event: 'CHAIN_CONFIRMED', label: '⚡ Chain Confirmed',         enabledStatuses: new Set(['CONFIRMING']) },
  { event: 'DROPPED',         label: '⚡ Dropped / RBF Replaced',  enabledStatuses: new Set(['DETECTED', 'CONFIRMING']) },
  { event: 'REORG',           label: '⚡ Reorg — back to mempool', enabledStatuses: new Set(['CONFIRMING']) },
];
```

- [x] **Step 2: 面板文案**(PayinDetail Simulation Controls 区,保持外框样式)

`simulationModeEnabled` 时恒渲染该 group;内部:
```tsx
{(() => {
  const hasEnabled = simActions.some((a) => a.enabled);
  if (!hasEnabled) {
    const isTerminal = ['CLEARED', 'FAILED'].includes(normalizedStatus.toUpperCase());
    return (
      <div className="px-2 py-1.5 font-mono text-[10px] text-amber-400/80">
        {isTerminal
          ? 'Terminal state — no simulatable events'
          : 'Auto-progressing — ledger credit in flight…'}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">…现有按钮 map 原样…</div>
  );
})()}
```
(外层条件 `simActions.length > 0` 改为 `simulationModeEnabled`;按钮 map 体不动。)

- [x] **Step 3: 验证** `cd admin-web && npx tsc --noEmit` 0 错;`curl …/PayinDetail.tsx` 200
- [x] **Step 4: Commit** `git add -A && git commit -m "feat(admin): payin sim panel — dropped/reorg actions + transient/terminal copy"`

---

### Task 3: 终验

- [x] `npx jest`(0 failed)+ `npm run build` + admin tsc 全绿
- [x] 重启栈;手验:DETECTED 直接 Drop→FAILED;CONFIRMING 点 Reorg→回 DETECTED 重走;CLEARED 显终态文案;CONFIRMED 瞬间文案(可遇不可求,逻辑核对即可)
- [x] plan checkbox 全勾 + commit

## Self-Review 记录

- Spec §1→T1、§2→T2、§3→T3;§0/§4 文档定案无代码。
- 类型一致:`REORG` 同名贯穿 enum/mock 映射/前端 event 串;`normalizedStatus` 为 PayinDetail 既有变量。
- 联动安全:CONFIRMING 阶段 deposit 停在 PAYIN_PENDING(spec §1 已核),退回 DETECTED 无副作用。
