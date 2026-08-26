# Withdrawal Compliance Gate Redesign

## Goal

Replace the current Gate 0/1/2 compliance model in the withdrawal flow with a three-layer framework (Eligibility Guard / Transaction Screen / Post-Tx Archive) that has clear, distinct responsibilities. Apply the same conceptual framework to deposits for documentation alignment, but only change withdrawal code.

## Problem

The current gate model conflates three fundamentally different operations:

| Current | Problem |
|---------|---------|
| Gate 0 (customer status) | For withdrawals, duplicates pre-creation `assertTradingEligibility`. Not a real "gate" — it either passes instantly or rejects instantly. |
| Gate 1 (KYT) | Mixes two different things: blocking pre-transaction screening (address/IBAN check) and non-blocking post-transaction archival (txHash patch). Fiat was deadlocked (now fixed with auto-pass hack). |
| Gate 2 (Travel Rule) | Only applies to crypto. Fine conceptually, but lumped into the same "gate convergence" as KYT. |

## Three-Layer Framework

### Layer 1: Eligibility Guard

**Question:** Is this customer allowed to transact right now?

**Data source:** Customer compliance status (CDD/EDD outcome, sanctions flags, account freezes)

| Flow | Timing | On Failure |
|------|--------|------------|
| Withdrawal | **Pre-creation** — `assertTradingEligibility()` blocks before `WithdrawTransaction` is created | Reject order creation |
| Deposit | **Post-arrival** — checked after payin confirmed, before crediting to CLIENT_CREDIT | Freeze funds in CLIENT_AUDIT |

This layer is NOT a workflow gate. For withdrawals it is a synchronous pre-condition; the workflow never sees ineligible customers. For deposits the existing behavior is correct and unchanged.

### Layer 2: Transaction Screen

**Question:** Is this specific transaction safe to execute?

**Data source:** Counterparty risk data — wallet address (crypto), IBAN + BIC + beneficiary (fiat), transaction amount, Travel Rule data.

| Asset Type | Withdrawal Screen Items | Deposit Screen Items |
|------------|------------------------|---------------------|
| Crypto | Pre-KYT (wallet address screening) + Travel Rule | KYT (txHash available immediately) + Travel Rule |
| Fiat | Pre-KYT (IBAN + BIC + beneficiary screening) | Skipped (direct final review) |

This is the **only blocking gate** in the withdrawal workflow. The workflow enters `PENDING_COMPLIANCE`, initializes the screen items, and waits for all to resolve before proceeding to `PAYOUT_PENDING`.

**Crypto withdrawal screen items:**
- `preKytStatus`: wallet address risk screening. Statuses: PENDING → PASSED / FAILED
- `travelRuleStatus`: VASP beneficiary data exchange. Statuses: PENDING → PASSED / NOT_REQUIRED / FAILED

**Fiat withdrawal screen items:**
- `preKytStatus`: IBAN + BIC + beneficiary screening. Statuses: PENDING → PASSED / FAILED
- `travelRuleStatus`: set to NOT_REQUIRED at initialization (fiat does not require Travel Rule)

Both crypto and fiat use the same convergence check: `preKytStatus === 'PASSED' AND (travelRuleStatus === 'PASSED' || 'NOT_REQUIRED')`.

### Layer 3: Post-Tx Archive

**Question:** N/A — this is not a gate. It is a fire-and-forget audit archival step.

**When:** After payout is confirmed and txHash is available.

| Asset Type | Withdrawal | Deposit |
|------------|-----------|---------|
| Crypto | Patch txHash to Sumsub for on-chain tracing record | N/A (txHash available at L2) |
| Fiat | N/A (no txHash concept) | N/A |

This layer does NOT block `finalizeWithdrawal()`. It runs as a side-effect after payout confirmation.

## Withdrawal Flow (After Redesign)

### Crypto Withdrawal

```
Customer initiates
  → [L1] assertTradingEligibility() — reject if ineligible
  → Create WithdrawTransaction (PENDING_COMPLIANCE)
  → WITHDRAWAL_CREATED event
  → [L2] initializeTransactionScreen()
  │    ├─ preKytStatus = 'PENDING' (wallet address screen)
  │    └─ travelRuleStatus = 'PENDING' (Travel Rule)
  → Wait for simulation callbacks
  → checkScreenPass() — both PASSED → proceed
  → initiatePayoutPhase() → PAYOUT_PENDING
  → Create Payout (type=CRYPTO) → broadcast on-chain
  → Payout confirmed (txHash)
  → [L3] archivePostKyt(txHash) — fire-and-forget
  → finalizeWithdrawal() → TB POST → SUCCESS
```

### Fiat Withdrawal

```
Customer initiates
  → [L1] assertTradingEligibility() — reject if ineligible
  → Create WithdrawTransaction (PENDING_COMPLIANCE)
  → WITHDRAWAL_CREATED event
  → [L2] initializeTransactionScreen()
  │    ├─ preKytStatus = 'PENDING' (IBAN + beneficiary screen)
  │    └─ travelRuleStatus = 'NOT_REQUIRED'
  → Wait for simulation callback (Pre-KYT only)
  → checkScreenPass() — preKytStatus PASSED + TR NOT_REQUIRED → proceed
  → initiatePayoutPhase() → PAYOUT_PENDING
  → Create Payout (type=FIAT) → bank transfer
  → Payout confirmed
  → [L3] N/A
  → finalizeWithdrawal() → TB POST → SUCCESS
```

## Deposit Flow (Conceptual Alignment — No Code Changes)

### Crypto Deposit

```
On-chain detection
  → Create DepositTransaction
  → Payin confirmed → TB: BANK→CLIENT_AUDIT (posted)
  → [L1] Customer compliance status check → freeze if ineligible
  → [L2] KYT (txHash available) + Travel Rule → wait for callbacks
  → All passed → TB: CLIENT_AUDIT→CLIENT_CREDIT (posted) → completed
```

### Fiat Deposit

```
Bank detection
  → Create DepositTransaction
  → Payin confirmed → TB: BANK→CLIENT_AUDIT (posted)
  → [L1] Customer compliance status check
  → [L2] Skipped (handleDirectDepositFinalReview)
  → TB: CLIENT_AUDIT→CLIENT_CREDIT (posted) → completed
```

## Code Changes (Withdrawal Only)

### 1. Remove `runGate0()` from WithdrawWorkflowService

Delete the `runGate0()` method and its call in `handleWithdrawalCreated()`. Layer 1 is already handled by `assertTradingEligibility()` in the customer controller before creation.

**Before:**
```
handleWithdrawalCreated() {
  const gate0Pass = await this.runGate0(withdrawId);
  if (!gate0Pass) return;
  await this.initializeComplianceGates(withdrawId);
}
```

**After:**
```
handleWithdrawalCreated() {
  await this.initializeTransactionScreen(withdrawId);
}
```

### 2. Rename `initializeComplianceGates()` → `initializeTransactionScreen()`

Same logic as the current fiat-aware version (from the earlier happy-path fix), but with clearer naming:

- Fetches withdrawal, checks asset type
- Crypto: `preKytStatus='PENDING'`, `travelRuleStatus='PENDING'`
- Fiat: `preKytStatus='PENDING'`, `travelRuleStatus='NOT_REQUIRED'`
- Calls `checkScreenPass()` at the end

**Key change for fiat:** Instead of auto-passing `preKytStatus='PASSED'`, set it to `'PENDING'` and let the simulation callback advance it. This aligns fiat with the same flow as crypto — both go through L2 screening, just with different data inputs.

The simulation endpoint for fiat Pre-KYT (`simulate/kyt-phase1`) already works for both asset types. Calling it with `result='PASSED'` moves `preKytStatus` from PENDING to PASSED, which triggers `checkScreenPass()` convergence.

### 3. Rename `checkAllGatesPass()` → `checkScreenPass()`

Same convergence logic, new name. No functional change.

### 4. Delete `runGate0()` method and related constants

Remove the method body and the `ABNORMAL_COMPLIANCE` set from `WithdrawWorkflowService` (it is only used by `runGate0`; the deposit service has its own independent copy). Also remove any audit log entries specific to Gate 0.

### 5. Add `archivePostKyt()` to payout confirmation handler

In `handlePayoutConfirmed()`, after `finalizeWithdrawal()`, add a fire-and-forget call:

```
if (withdrawal.asset?.type !== 'FIAT' && withdrawal.txHash) {
  this.archivePostKyt(withdrawal).catch(err =>
    this.logger.warn(`Post-KYT archive failed: ${err.message}`)
  );
}
```

For now this is a no-op stub (logs "Post-KYT archive placeholder"). When Sumsub KYT is integrated, it becomes a `PATCH /kyt/txns/{id}/data/info` call.

### 6. Update simulation flow for fiat

The current fiat happy-path fix auto-passes KYT at initialization. After this redesign, fiat withdrawals will start with `preKytStatus='PENDING'` and require a simulation call (`POST /withdraw-transactions/:id/simulate/kyt-phase1`) to advance to PASSED, just like crypto.

This means the E2E test flow for fiat becomes:
1. Create withdrawal → status: PENDING_COMPLIANCE, preKytStatus: PENDING
2. Simulate KYT Phase 1 PASSED → preKytStatus: PASSED → checkScreenPass → PAYOUT_PENDING
3. Simulate payout confirmed → finalizeWithdrawal → SUCCESS

## Files Changed

| File | Change | Impact |
|------|--------|--------|
| `withdraw-workflow.service.ts` | Remove `runGate0()`, rename methods, add `archivePostKyt()` stub, update `handleWithdrawalCreated()` | Main refactor |
| `withdraw-workflow.service.ts` | Change fiat init from auto-pass to PENDING | Behavioral change |
| Simulation controller | No changes needed — existing `simulate/kyt-phase1` works for both crypto and fiat | None |
| Deposit flow | No code changes | None |
| Database schema | No changes — `preKytStatus`/`travelRuleStatus` fields remain as-is | None |

## Out of Scope

- Real Sumsub KYT API integration (future — replace simulation layer)
- Deposit flow code changes (conceptual alignment only)
- New database fields or schema changes
- Admin UI changes
