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

**File:** `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`

In `create()`, select target account code based on asset type:

```
netTargetCode = isFiat ? ACCOUNT_CODES.BANK : ACCOUNT_CODES.CUSTODY
transferCode = isFiat ? TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_BANK : TB_TRANSFER_CODES.WITHDRAW_CREDIT_TO_CUSTODY
```

**New constant needed in** `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`:

```
WITHDRAW_CREDIT_TO_BANK: <next available code>
```

### 3. TB Transfer Summary

| Timing | Transfer | Amount | Type |
|--------|----------|--------|------|
| Creation | CLIENT_CREDIT -> BANK | Principal | pending |
| Creation | CLIENT_CREDIT -> FEE_RECEIVABLE | Fee | pending |
| Payout confirmed | POST both pending transfers | — | post |
| Cancellation | VOID both pending transfers | — | void |

Symmetric with crypto withdrawal, substituting CUSTODY with BANK.

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
| `withdraw-transactions.service.ts` | `create()` TB account code for fiat | ~10 |
| `tb-transfer-codes.constant.ts` | Add `WITHDRAW_CREDIT_TO_BANK` | ~2 |
| Withdraw simulation controller | Add fiat payout simulate endpoint | ~15 |
| Admin withdraw detail (optional) | Display `toIban` field | ~5 |
| **Total** | | **~40 lines** |
