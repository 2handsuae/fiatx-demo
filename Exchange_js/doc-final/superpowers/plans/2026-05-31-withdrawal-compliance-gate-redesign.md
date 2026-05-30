# Withdrawal Compliance Gate Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Gate 0/1/2 compliance model in the withdrawal workflow with a three-layer framework (Eligibility Guard / Transaction Screen / Post-Tx Archive) that has clear, distinct responsibilities.

**Architecture:** All changes are in one file: `withdraw-workflow.service.ts`. Remove `runGate0()` (Layer 1 already handled pre-creation by `assertTradingEligibility`). Rename methods to match the new conceptual framework. Change fiat initialization from auto-pass to PENDING (require simulation callback like crypto). Add `archivePostKyt()` stub for future post-tx txHash archival.

**Tech Stack:** NestJS, TypeScript, EventEmitter2

---

### Task 1: Remove `runGate0()` and `ABNORMAL_COMPLIANCE`

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:23-25` (ABNORMAL_COMPLIANCE)
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:54-59` (handleWithdrawalCreated)
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:98-125` (runGate0 method)

- [ ] **Step 1: Remove the `ABNORMAL_COMPLIANCE` set**

In `withdraw-workflow.service.ts`, delete lines 23–25:

```typescript
  private static readonly ABNORMAL_COMPLIANCE = new Set([
    'FROZEN', 'SUSPENDED', 'BLOCKED', 'REJECTED',
  ]);
```

- [ ] **Step 2: Remove `runGate0()` call from `handleWithdrawalCreated()`**

Replace lines 54–59:

```typescript
    this.logger.log(`Orchestrating new withdrawal ${event.withdrawId}`);

    const gate0Pass = await this.runGate0(event.withdrawId);
    if (!gate0Pass) return;

    await this.initializeComplianceGates(event.withdrawId);
```

With:

```typescript
    this.logger.log(`Orchestrating new withdrawal ${event.withdrawId}`);
    await this.initializeComplianceGates(event.withdrawId);
```

- [ ] **Step 3: Delete the entire `runGate0()` method**

Delete lines 98–125 (the entire method including the section comment above it):

```typescript
  // ── Gate 0: Customer Compliance Status ──

  private async runGate0(withdrawId: string): Promise<boolean> {
    ...
  }
```

- [ ] **Step 4: Remove unused `WITHDRAW_GATE0_PASSED` audit constant**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, delete line 277:

```typescript
  WITHDRAW_GATE0_PASSED: 'WITHDRAW_GATE0_PASSED',
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors. If `WITHDRAW_GATE0_PASSED` is referenced elsewhere, the build will tell you — but it's only used in the deleted `runGate0()`.

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "refactor: remove runGate0 and ABNORMAL_COMPLIANCE from WithdrawWorkflowService"
```

---

### Task 2: Rename Methods to Three-Layer Framework

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`

This task renames two methods and updates all section comments to match the new conceptual framework. No functional changes.

- [ ] **Step 1: Rename `initializeComplianceGates` → `initializeTransactionScreen`**

Find:
```typescript
  // ── Gate 1 + Gate 2: Initialize Compliance Gates ──

  private async initializeComplianceGates(withdrawId: string) {
```

Replace with:
```typescript
  // ── L2: Transaction Screen — Initialize ──

  private async initializeTransactionScreen(withdrawId: string) {
```

- [ ] **Step 2: Update the call site in `handleWithdrawalCreated()`**

Find:
```typescript
    await this.initializeComplianceGates(event.withdrawId);
```

Replace with:
```typescript
    await this.initializeTransactionScreen(event.withdrawId);
```

- [ ] **Step 3: Rename `checkAllGatesPass` → `checkScreenPass`**

Find:
```typescript
  // ── Gate Convergence Check ──

  private async checkAllGatesPass(withdrawId: string) {
```

Replace with:
```typescript
  // ── L2: Transaction Screen — Convergence Check ──

  private async checkScreenPass(withdrawId: string) {
```

- [ ] **Step 4: Update all call sites of `checkAllGatesPass` → `checkScreenPass`**

There are three call sites. Replace each `this.checkAllGatesPass(` with `this.checkScreenPass(`:

1. In `initializeTransactionScreen()` (end of method):
```typescript
    await this.checkScreenPass(withdrawId);
```

2. In `handleKytUpdated()` (line ~72):
```typescript
      await this.checkScreenPass(event.withdrawId);
```

3. In `handleTravelRuleUpdated()` (line ~85):
```typescript
    await this.checkScreenPass(event.withdrawId);
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "refactor: rename compliance gate methods to three-layer framework naming"
```

---

### Task 3: Change Fiat Initialization from Auto-Pass to PENDING

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` (initializeTransactionScreen method)

After this change, fiat withdrawals will start with `preKytStatus='PENDING'` and require a simulation call (`POST /withdraw-transactions/:id/simulate/kyt-phase1`) to advance, just like crypto. The `travelRuleStatus` remains `NOT_REQUIRED` for fiat.

- [ ] **Step 1: Update `initializeTransactionScreen()` method body**

Find the current if/else block inside `initializeTransactionScreen`:

```typescript
    if (isFiat) {
      // Fiat withdrawals skip KYT and Travel Rule — auto-pass both gates
      await this.withdrawService.updateKytStatus(withdrawId, 'PASSED', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'NOT_REQUIRED', null);
      this.logger.log(`Compliance gates auto-passed for fiat withdrawal ${withdrawId}`);
    } else {
      await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'PENDING', null);
      this.logger.log(`Compliance gates initialized for withdrawal ${withdrawId} — awaiting KYT Phase 1 + Travel Rule`);
    }

    // Re-check gates — for fiat this will immediately pass and move to payout phase
    await this.checkScreenPass(withdrawId);
```

Replace with:

```typescript
    if (isFiat) {
      // Fiat: Pre-KYT screens IBAN + BIC + beneficiary; Travel Rule not applicable
      await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'NOT_REQUIRED', null);
      this.logger.log(`Transaction screen initialized for fiat withdrawal ${withdrawId} — awaiting Pre-KYT`);
    } else {
      // Crypto: Pre-KYT screens wallet address; Travel Rule screens VASP beneficiary
      await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);
      await this.withdrawService.updateTravelRuleStatus(withdrawId, 'PENDING', null);
      this.logger.log(`Transaction screen initialized for crypto withdrawal ${withdrawId} — awaiting Pre-KYT + Travel Rule`);
    }

    await this.checkScreenPass(withdrawId);
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat: fiat withdrawals now start with preKytStatus=PENDING instead of auto-pass"
```

---

### Task 4: Add `archivePostKyt()` Stub

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` (handlePayoutConfirmed + new method)

Add a fire-and-forget `archivePostKyt()` call after `finalizeWithdrawal()`. For now it's a no-op stub. When Sumsub KYT is integrated later, it becomes a `PATCH /kyt/txns/{id}/data/info` call to archive the txHash.

- [ ] **Step 1: Update `handlePayoutConfirmed()` to call `archivePostKyt()`**

Find:

```typescript
  @OnEvent(DomainEventNames.PAYOUT_STATUS_CONFIRMED)
  async handlePayoutConfirmed(event: {
    payoutId: string;
    withdrawId: string;
    txHash: string;
  }) {
    this.logger.log(`Payout confirmed for withdrawal ${event.withdrawId}`);
    await this.finalizeWithdrawal(event.withdrawId);
  }
```

Replace with:

```typescript
  @OnEvent(DomainEventNames.PAYOUT_STATUS_CONFIRMED)
  async handlePayoutConfirmed(event: {
    payoutId: string;
    withdrawId: string;
    txHash: string;
  }) {
    this.logger.log(`Payout confirmed for withdrawal ${event.withdrawId}`);
    await this.finalizeWithdrawal(event.withdrawId);

    // L3: Post-Tx Archive — fire-and-forget txHash archival (crypto only)
    const w = await this.withdrawService.findOneInternal(event.withdrawId);
    if (w.asset?.type !== 'FIAT' && w.txHash) {
      this.archivePostKyt(w).catch(err =>
        this.logger.warn(`Post-KYT archive failed for ${event.withdrawId}: ${(err as Error).message}`),
      );
    }
  }
```

- [ ] **Step 2: Add the `archivePostKyt()` method**

Add the following method at the end of the class, just before the `decimalToBigint` utility:

```typescript
  // ── L3: Post-Tx Archive — fire-and-forget ──

  private async archivePostKyt(withdrawal: {
    id: string;
    withdrawNo: string;
    txHash: string | null;
  }): Promise<void> {
    // Stub: when Sumsub KYT is integrated, this becomes a PATCH /kyt/txns/{id}/data/info
    // to archive the txHash for on-chain tracing.
    this.logger.log(
      `Post-KYT archive stub: withdrawal ${withdrawal.withdrawNo} txHash=${withdrawal.txHash}`,
    );
  }
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat: add archivePostKyt stub for post-tx txHash archival (L3)"
```

---

### Task 5: End-to-End Verification

**Files:**
- No code changes — verification only

- [ ] **Step 1: Verify the build compiles clean**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 2: Verify `runGate0` is fully removed from withdraw workflow**

Run: `grep -rn "runGate0\|GATE0\|gate0\|ABNORMAL_COMPLIANCE" src/modules/trading/withdraw-transactions/ --include="*.ts"`
Expected: No matches. (The deposit workflow still has its own `runGate0` and `ABNORMAL_COMPLIANCE` — that's expected and should NOT be touched.)

- [ ] **Step 3: Verify method naming consistency**

Run: `grep -n "initializeComplianceGates\|checkAllGatesPass" src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
Expected: No matches (old names fully replaced).

Run: `grep -n "initializeTransactionScreen\|checkScreenPass" src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
Expected: Both method definitions and all call sites found.

- [ ] **Step 4: Verify fiat initialization is PENDING (not auto-pass)**

Run: `grep -A5 "isFiat" src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts | head -10`
Expected: Both the fiat and crypto branches set `preKytStatus` to `'PENDING'`. The fiat branch sets `travelRuleStatus` to `'NOT_REQUIRED'`.

- [ ] **Step 5: Verify `archivePostKyt` exists and is called**

Run: `grep -n "archivePostKyt" src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`
Expected: Method definition + call in `handlePayoutConfirmed`.

- [ ] **Step 6: Verify `WITHDRAW_GATE0_PASSED` is removed from audit constants**

Run: `grep "GATE0" src/modules/audit-logging/constants/audit-actions.constant.ts`
Expected: No matches.

- [ ] **Step 7: Verify deposit workflow is untouched**

Run: `git diff HEAD~4 -- src/modules/trading/deposit-transactions/`
Expected: No changes shown (deposit flow was not modified).
