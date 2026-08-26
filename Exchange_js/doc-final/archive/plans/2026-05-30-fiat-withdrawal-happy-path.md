# Fiat Withdrawal Happy Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unblock fiat withdrawals by patching two gaps: auto-pass KYT/TravelRule gates for fiat assets, and use BANK instead of CUSTODY as the TB target account code.

**Architecture:** Minimal surgical changes to the existing withdrawal pipeline. No new files, no new modules — only modify existing constants and two service files. The entire crypto withdrawal flow is reused; we just fix two branching points where fiat was not accounted for.

**Tech Stack:** NestJS, Prisma, TigerBeetle, TypeScript

---

### Task 1: Add Fiat TB Transfer Codes

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

- [ ] **Step 1: Add the three fiat withdrawal transfer codes**

Open `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`. Add fiat withdrawal codes after the existing void codes (line 17). The file currently ends at code 15; use 20–22 for the fiat block:

```typescript
export const TB_TRANSFER_CODES = {
  // Deposit (1–9)
  DEPOSIT_CUSTODY_TO_AUDIT: 1,
  DEPOSIT_AUDIT_TO_CREDIT: 2,

  // Withdrawal: pending lock (10–11)
  WITHDRAW_CREDIT_TO_CUSTODY_PENDING: 10,
  WITHDRAW_CREDIT_TO_FEE_PENDING: 11,

  // Withdrawal: post — chain confirmed (12–13)
  WITHDRAW_CREDIT_TO_CUSTODY_POST: 12,
  WITHDRAW_CREDIT_TO_FEE_POST: 13,

  // Withdrawal: void — cancel/fail (14–15)
  WITHDRAW_CREDIT_TO_CUSTODY_VOID: 14,
  WITHDRAW_CREDIT_TO_FEE_VOID: 15,

  // Fiat withdrawal: pending lock (20)
  WITHDRAW_CREDIT_TO_BANK_PENDING: 20,
  // Fiat withdrawal: post — bank confirmed (21)
  WITHDRAW_CREDIT_TO_BANK_POST: 21,
  // Fiat withdrawal: void — cancel/fail (22)
  WITHDRAW_CREDIT_TO_BANK_VOID: 22,
} as const;
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors related to tb-transfer-codes.

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts
git commit -m "feat: add fiat withdrawal TB transfer codes (20–22)"
```

---

### Task 2: Fix Compliance Gate Deadlock for Fiat

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:129-134`

- [ ] **Step 1: Read the asset type in initializeComplianceGates**

The method currently (lines 129–134) unconditionally sets both gates to PENDING:

```typescript
private async initializeComplianceGates(withdrawId: string) {
  await this.withdrawService.updateKytStatus(withdrawId, 'PENDING', null, null, 1);
  await this.withdrawService.updateTravelRuleStatus(withdrawId, 'PENDING', null);
  this.logger.log(`Compliance gates initialized for withdrawal ${withdrawId} — awaiting KYT Phase 1 + Travel Rule`);
}
```

Replace with asset-type-aware logic. Need to fetch the withdrawal to check asset type:

```typescript
private async initializeComplianceGates(withdrawId: string) {
  const w = await this.withdrawService.findOneInternal(withdrawId);
  const isFiat = w.asset?.type === 'FIAT';

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
  await this.checkAllGatesPass(withdrawId);
}
```

Note: the `checkAllGatesPass` call at the end ensures fiat withdrawals flow through to `initiatePayoutPhase` immediately after gate initialization, without waiting for an external KYT/TR event that will never come.

- [ ] **Step 2: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat: auto-pass KYT and TravelRule gates for fiat withdrawals"
```

---

### Task 3: Fix TB Account Code in create()

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts:601-644`

- [ ] **Step 1: Add import for TB_TRANSFER_CODES if not already imported**

Check the imports at the top of `withdraw-transactions.service.ts`. The file already imports `TB_ACCOUNT_CODES` and `TB_TRANSFER_CODES`. No new import needed.

- [ ] **Step 2: Branch the target account resolution in create()**

In `create()`, around line 610, the code resolves the custody account:

```typescript
const custodyId = await this.accountingService.resolveTbAccountId({
  code: TB_ACCOUNT_CODES.CUSTODY,
  ledger,
  ownerType: 'SYSTEM',
});
```

Replace with:

```typescript
const netTargetCode = isCryptoWithdraw ? TB_ACCOUNT_CODES.CUSTODY : TB_ACCOUNT_CODES.BANK;
const netTargetId = await this.accountingService.resolveTbAccountId({
  code: netTargetCode,
  ledger,
  ownerType: 'SYSTEM',
});
```

- [ ] **Step 3: Update pending transfer #1 to use the correct code and account**

Around line 630, the pending net transfer uses `WITHDRAW_CREDIT_TO_CUSTODY_PENDING` and `custodyId`. Update both:

Replace `creditAccountId: custodyId` with `creditAccountId: netTargetId`.

Replace `code: TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY_PENDING` with:
```typescript
code: isCryptoWithdraw
  ? TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY_PENDING
  : TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_BANK_PENDING,
```

Also update the evidence `creditCode` around line 640:
Replace `creditCode: String(TB_ACCOUNT_CODES.CUSTODY)` with:
```typescript
creditCode: String(netTargetCode),
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts
git commit -m "feat: use BANK account code for fiat withdrawal TB pending transfers"
```

---

### Task 4: Fix TB Account Code in finalizeWithdrawal()

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:264-306`

- [ ] **Step 1: Update evidence creditCode in POST net transfer**

In `finalizeWithdrawal()`, around line 276, the evidence for the net POST transfer hardcodes:

```typescript
creditCode: String(TB_ACCOUNT_CODES.CUSTODY),
```

Replace with:

```typescript
creditCode: String(w.asset?.type === 'FIAT' ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY),
```

- [ ] **Step 2: Update the memo for fiat**

Around line 281, the memo says `'Chain confirmed: POST net pending transfer'`. For fiat this is inaccurate. Update:

```typescript
memo: w.asset?.type === 'FIAT'
  ? 'Bank transfer confirmed: POST net pending transfer'
  : 'Chain confirmed: POST net pending transfer',
```

- [ ] **Step 3: Update the audit log reason for fiat**

Around line 317, the audit reason says `'TB pending transfers posted after chain confirmation'`. Update:

```typescript
reason: w.asset?.type === 'FIAT'
  ? 'TB pending transfers posted after bank confirmation'
  : 'TB pending transfers posted after chain confirmation',
```

- [ ] **Step 4: Verify build**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts
git commit -m "feat: use correct TB evidence codes in finalizeWithdrawal for fiat"
```

---

### Task 5: End-to-End Verification

**Files:**
- No code changes — testing only

- [ ] **Step 1: Ensure backend is running**

Run: `lsof -ti:3500 | head -1`
If no output, start the backend. If running, proceed.

- [ ] **Step 2: Verify the build compiles clean**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 3: Verify TB transfer codes are unique**

Run: `grep -E ':\s*\d+' src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts | sort -t: -k2 -n`
Expected: No duplicate numeric values.

- [ ] **Step 4: Verify the fiat gate logic by reading the code**

Confirm that `initializeComplianceGates()` now:
1. Fetches the withdrawal record
2. Checks `asset.type === 'FIAT'`
3. Sets `preKytStatus='PASSED'` and `travelRuleStatus='NOT_REQUIRED'` for fiat
4. Calls `checkAllGatesPass()` which will immediately pass and call `initiatePayoutPhase()`

- [ ] **Step 5: Verify the create() TB path by reading the code**

Confirm that `create()` now:
1. Resolves `TB_ACCOUNT_CODES.BANK` (not CUSTODY) for fiat
2. Uses `WITHDRAW_CREDIT_TO_BANK_PENDING` transfer code for fiat
3. Evidence `creditCode` reflects the correct target account

- [ ] **Step 6: Commit any remaining fixes**

If any issues found in verification, fix and commit.
