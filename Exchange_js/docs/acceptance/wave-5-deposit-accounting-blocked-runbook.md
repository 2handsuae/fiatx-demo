Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/payin-deposit-canonical-workflow.md`, `docs/specs/entities/deposit-transaction-entity.md`, `docs/specs/modules/accounting-ledger-module.md`, `docs/constraints/customer-transaction-flow-constraints.md`
Source of Truth Level: acceptance

# Wave 5 Deposit Accounting Blocked Runbook

## Purpose
- This runbook explains how to identify, diagnose, and compensate `DEPOSIT_ACCOUNTING_BLOCKED`.
- It is an operator guide, not a replacement for workflow or accounting specs.

## Trigger Conditions
- `DEPOSIT_ACCOUNTING_BLOCKED` is written when a required deposit accounting point cannot complete.
- Current required points are:
  1. `payin.confirmed -> COMPLIANCE_PENDING`
  2. `deposit.success -> SUCCESS`
- Current block classes include:
  - missing or inactive `AcctEvent`
  - missing template
  - `triggerEvent()` returns `null`
  - posting throws or cannot complete

## Symptoms
- Audit Center contains `DEPOSIT_ACCOUNTING_BLOCKED`.
- Deposit remains in a workflow state but accounting evidence is incomplete.
- `payin.confirmed` branch:
  - deposit may stay in `COMPLIANCE_PENDING`
  - payin is not cleared to `CLEARED`
- `deposit.success` branch:
  - deposit remains `SUCCESS`
  - accounting evidence is incomplete
  - `journalId` is absent in the blocked audit metadata

## Canonical Diagnosis Path
1. Open `Audit Center`.
2. Filter by:
   - `workflowType = DEPOSIT`
   - `workflowNo = depositNo`
   - or `traceId`
3. Locate:
   - `DEPOSIT_ACCOUNTING_BLOCKED`
   - nearby `PAYIN_*`, `DEPOSIT_*`, `KYT_*`, `TRAVEL_RULE_*`, `TX_*` audit events
4. Inspect blocked metadata:
   - `eventCode`
   - `fromStatus`
   - `toStatus`
   - `assetType`
   - `depositId`
   - `payinId`
   - `blockedReason`
5. Cross-check:
   - deposit detail
   - payin detail
   - journal list by `sourceType=DEPOSIT, sourceId=depositId`
   - evidence package snapshots if export already exists

## Compensation Boundary
- `payin.confirmed` accounting block:
  - recover from payin-side compensation first
  - only after accounting configuration is repaired
  - do not manually clear payin before the required accounting point succeeds
- `deposit.success` accounting block:
  - do not roll deposit back
  - repair accounting configuration first
  - use canonical deposit-side compensation only when the business state is already correct and accounting evidence is the missing piece
- `PATCH /deposit-transactions/:id/status?action=payin_confirmed` remains compensation-only.
- `PATCH /treasury/payins/:id/status?action=confirm` remains the canonical payin-side progression path.

## Do Not
- Do not fabricate a journal entry outside the accounting contract.
- Do not clear payin to `CLEARED` while the confirmed accounting point is still blocked.
- Do not mark the case or alert chain complete without checking whether the deposit accounting point actually succeeded.
- Do not treat `DEPOSIT_ACCOUNTING_BLOCKED` as a silent warning; it is a failed required accounting point.

## Evidence Export Follow-Up
- If the blocked deposit is under investigation or needs audit evidence:
  - export by `workflowType=DEPOSIT`
  - confirm the package includes the blocked audit record
  - confirm `depositEvidenceChain` does not claim a fake journal when the block happened before posting

## Exit Criteria
- Root cause is identified from audit metadata and accounting configuration.
- Compensation path is selected from the correct root:
  - payin-side first for confirmed accounting block
  - deposit-side only when business status is already final and accounting repair is the missing step
- Operator can explain why the deposit is blocked and what evidence proves it.
