# Fiat Withdrawal Happy Path Design

## Goal

Enable fiat (bank transfer) withdrawals end-to-end by unblocking two specific gaps in the existing withdrawal flow. The crypto withdrawal pipeline already handles fiat assets with minor exceptions — this design patches those exceptions so fiat withdrawals run through the same pipeline successfully.

## Context

- **Crypto withdrawal flow** (reference): Customer initiation -> COMPLIANCE_PENDING -> Gate 0 (CDD/EDD) + Gate 1 (KYT) + Gate 2 (Travel Rule) -> PAYOUT_PENDING -> Payout on-chain -> SUCCESS
- **Fiat deposit flow** (mirror): Payin detected -> DepositTransaction -> Payin confirmed -> TB BANK->CLIENT_CREDIT -> compliance -> completed
- **Existing fiat support**: Client UI (Withdraw.tsx) already has Crypto/Fiat/History tabs, quote preview + confirm flow, bank account selector, and IBAN input. Backend WithdrawTransaction.create() already handles fiat assets. WithdrawalAddress supports IBAN (addressType='BANK', network='FIAT').

## Two Blocking Gaps

### Gap 1: Compliance Gate Deadlock

`WithdrawWorkflowService.initializeComplianceGates()` unconditionally sets `preKytStatus='PENDING'` and `travelRuleStatus='PENDING'` for all withdrawals. `checkAllGatesPass()` requires `preKytStatus === 'PASSED'` to proceed. For fiat, no process ever moves `preKytStatus` from PENDING to PASSED (KYT is crypto-only, explicitly excluded via `isCryptoAssetType()` check). Result: fiat withdrawals permanently stuck at COMPLIANCE_PENDING.

### Gap 2: TB Account Code

`WithdrawTransactionsService.create()` creates pending TB transfers as `CLIENT_CREDIT -> CUSTODY` for all withdrawals. Fiat withdrawals should use `CLIENT_CREDIT -> BANK` since funds leave via bank transfer, not blockchain custody.

## Design

### 1. Compliance Gate Fix

**File:** `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`

In `initializeComplianceGates()`, detect fiat asset type and auto-pass:

```
if (asset.type === 'FIAT') {
  preKytStatus = 'PASSED'
  travelRuleStatus = 'NOT_REQUIRED'
} else {
  preKytStatus = 'PENDING'
  travelRuleStatus = 'PENDING'
}
```

`checkAllGatesPass()` is unchanged. It already accepts `travelRuleStatus === 'NOT_REQUIRED'` as a pass condition.

**Rationale:** Matches fiat deposit behavior where `kytStatus='FINAL'` and `travelRuleRequired=false` are set to skip KYT/TR. The KYT system (`TransactionComplianceService.ensureWithdrawPreKytCaseOnCreate()`) already returns null for non-crypto assets — no KYT case is created for fiat.

### 2. TB Ledger Path Fix

Three touch-points must branch on asset type:

#### 2a. `create()` — pending transfers

**File:** `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`

In `create()`, resolve target account and transfer code based on asset type:

```
targetAccountCode = isFiat ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY
pendingCode      = isFiat ? TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_BANK_PENDING
                          : TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY_PENDING
```

Fee transfer (`CLIENT_CREDIT -> FEE_RECEIVABLE`) is asset-type-agnostic, unchanged.

#### 2b. `finalizeWithdrawal()` — POST pending transfers

Same file. When posting the pending transfers on payout confirmation, use the correct POST code:

```
postCode = isFiat ? TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_BANK_POST
                  : TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY_POST
```

#### 2c. Cancel/void path

When voiding pending transfers on cancellation:

```
voidCode = isFiat ? TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_BANK_VOID
                  : TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY_VOID
```

#### New constants

**File:** `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`

Add three new codes (next available: 20–22):

```
// Fiat withdrawal: pending lock (20)
WITHDRAW_CREDIT_TO_BANK_PENDING: 20,
// Fiat withdrawal: post — bank confirmed (21)
WITHDRAW_CREDIT_TO_BANK_POST: 21,
// Fiat withdrawal: void — cancel/fail (22)
WITHDRAW_CREDIT_TO_BANK_VOID: 22,
```

### 3. TB Transfer Summary

| Timing | Transfer | Amount | Type | Code |
|--------|----------|--------|------|------|
| Creation | CLIENT_CREDIT -> BANK | Principal | pending | WITHDRAW_CREDIT_TO_BANK_PENDING |
| Creation | CLIENT_CREDIT -> FEE_RECEIVABLE | Fee | pending | WITHDRAW_CREDIT_TO_FEE_PENDING |
| Payout confirmed | POST net pending | — | post | WITHDRAW_CREDIT_TO_BANK_POST |
| Payout confirmed | POST fee pending | — | post | WITHDRAW_CREDIT_TO_FEE_POST |
| Cancellation | VOID net pending | — | void | WITHDRAW_CREDIT_TO_BANK_VOID |
| Cancellation | VOID fee pending | — | void | WITHDRAW_CREDIT_TO_FEE_VOID |

Symmetric with crypto withdrawal, substituting CUSTODY with BANK. Fee codes are shared (asset-type-agnostic).

### 4. Payout Simulation

The FIAT payout state machine already exists: `CREATED -> SUBMIT -> CONFIRMING -> CONFIRM -> CONFIRMED -> CLEAR -> CLEARED`.

For happy path testing, add a simulate endpoint on the withdraw simulation controller that walks the fiat payout through its full state machine in one call. This mirrors the existing `simulate/payout-confirmed` endpoint for crypto.

**File:** admin simulation controller for withdrawals

### 5. Client UI

**No changes needed.** `client-web/src/pages/Withdraw.tsx` already supports:
- Fiat tab with bank account selector (loads from WithdrawalAddress API)
- Quote preview via `POST /withdraw-transactions/quotes`
- Confirmation modal showing fee breakdown
- Transaction creation with `quoteId` and `toIban`
- History tab with status tracking

### 6. Admin UI

**Minimal adjustment.** Existing WithdrawTransaction detail page and Payout detail page already display fiat withdrawals. Verify that `toIban` field renders correctly on the admin withdraw detail page; add it if missing.

## Flow Diagram

```
Customer (Client Web)
  |
  |-- Select fiat asset + bank account (WithdrawalAddress BANK)
  |-- Enter amount
  |-- POST /withdraw-transactions/quotes
  |       -> Returns quote with fees, totals, matched tier
  |-- Review fees in confirm modal
  |-- POST /client/withdraw-transactions { quoteId, toIban, ... }
  |
Backend (WithdrawTransactionsService.create)
  |-- Consume quote
  |-- TB pending: CLIENT_CREDIT -> BANK (principal)
  |-- TB pending: CLIENT_CREDIT -> FEE_RECEIVABLE (fee)
  |-- status = PENDING_COMPLIANCE
  |
WithdrawWorkflowService
  |-- Gate 0: CDD/EDD check (existing)
  |-- initializeComplianceGates()
  |     -> fiat: preKytStatus='PASSED', travelRuleStatus='NOT_REQUIRED'
  |-- checkAllGatesPass() -> PASS
  |-- initiatePayoutPhase()
  |     -> status = PAYOUT_PENDING
  |     -> Create Payout(type=FIAT)
  |
Payout State Machine (simulated)
  |-- CREATED -> SUBMIT -> CONFIRMING -> CONFIRM -> CONFIRMED -> CLEARED
  |
WithdrawWorkflowService.finalizeWithdrawal()
  |-- TB POST both pending transfers
  |-- status = SUCCESS
```

## Out of Scope

- Real PSP/bank API integration (future)
- IBAN sanctions/blacklist screening (future)
- Fiat payout RETURN flow (non-happy-path)
- WithdrawalAddress bank account registration (already exists)
- New Sumsub KYT integration for fiat (future; callback hooks ready)

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `withdraw-workflow.service.ts` | `initializeComplianceGates()` fiat branch | ~10 |
| `withdraw-transactions.service.ts` | `create()` + `finalizeWithdrawal()` + cancel TB account code for fiat | ~20 |
| `tb-transfer-codes.constant.ts` | Add 3 fiat codes (PENDING/POST/VOID) | ~6 |
| Withdraw simulation controller | Add fiat payout simulate endpoint | ~15 |
| Admin withdraw detail (optional) | Display `toIban` field | ~5 |
| **Total** | | **~40 lines** |
