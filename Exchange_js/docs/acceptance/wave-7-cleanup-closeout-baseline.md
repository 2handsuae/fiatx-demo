Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`, `docs/acceptance/wave-5-deposit-evidence-export-runbook.md`, `docs/acceptance/wave-7-withdraw-payout-final-acceptance-checklist.md`, `docs/acceptance/wave-7-withdraw-evidence-export-runbook.md`, `docs/specs/workflows/payin-deposit-canonical-workflow.md`, `docs/specs/workflows/withdraw-payout-canonical-workflow.md`, `docs/cleanup/wave-7-cleanup-master-plan.md`
Source of Truth Level: acceptance

# Wave 7 Cleanup Closeout Baseline

## Purpose
- Consolidate the Stage 5 cleanup baseline after Stage 1-4 convergence.
- Record the current branch-acceptance, evidence, and canonical-audit expectations without redesigning the main runtime path.
- Freeze what belongs to `Wave 7 cleanup` versus what is explicitly handed to `Wave 8`.

## Stage 5 Execution Order
1. `5A Current UX / Read-model Defects`
   - fix current admin display mismatches first
   - example: `PayinList` must not branch on lowercase `fiat` after Stage 4 payload normalization to `FIAT`
2. `5B Workflow Truth And Doc Truth Re-sync`
   - update entity / workflow / constraints / acceptance docs that still described pre-cleanup truth
3. `5C Withdraw PRECHECK Deep Retirement`
   - historical `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` remain readable
   - they no longer own active evaluation, simulation, recommendation, or workflow transition logic
4. `5D Response Adapter Semantic Convergence`
   - response lifecycle stays `CREATED / RECEIVED / FINAL`
   - legacy `PASS / ACCEPTED / NOT_REQUIRED / REVIEW / FAIL` remain historical compatibility input only
5. `5E Branch Acceptance / Evidence / Closeout`
   - expand acceptance baseline to high-frequency branches
   - freeze evidence / canonical audit symmetry

## Closeout Verification Snapshot
- Verified on `2026-03-30`.
- Admin operator surfaces:
  - `npm --prefix /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web run build`
- Wave 7 closeout specs:
  - `npm --prefix /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js test -- --runInBand src/modules/risk-engine/compliance-alerts/compliance-alerts.service.spec.ts src/modules/risk-engine/risk-decision-records.service.spec.ts src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.spec.ts`
  - `npm --prefix /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js test -- --runInBand src/modules/asset-treasury/payins/payins.service.spec.ts src/modules/asset-treasury/payouts/payouts.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.spec.ts`
- Operator-facing cleanup confirmed by current branch review:
  - active alert stage filter no longer advertises `REVIEW_WITHDRAW_PRECHECK`
  - alert detail treats canonical `riskBand / riskReason` as primary truth
  - payin/payout list pages now use `adminFetch` and `ownerNo-first` display

## Current Runtime Truth
- `deposit` and `withdraw` are the transaction roots.
- `payin` and `payout` are the rail roots.
- Active rail contract truth is:
  - `type = CRYPTO / FIAT`
  - terminal payout/payin status = `CLEARED`
- Old stored/raw values may still be read and normalized, but they are no longer valid active operator-facing contract values.
- Response containers are evidence only:
  - `fiat payin` / `fiat withdraw` do not auto-create response containers
  - `crypto payin`: `KYT + Travel Rule` on `payin CONFIRM`
  - `crypto withdraw`: `Pre-KYT + Travel Rule` on withdraw create, `KYT` on payout `CONFIRM`
- Response lifecycle truth is:
  - `CREATED`
  - `RECEIVED`
  - `FINAL`
- Risk truth is:
  - `decision record`
  - `alert`
  - `case`
  - canonical workflow callback
- `TX_WITHDRAW_FINAL` is the only active withdraw risk context.
- `TX_WITHDRAW_PRECHECK` remains historical compatibility only.

## Branch Acceptance Matrix

### Deposit
- `LOW`
  - `TX_DEPOSIT_FINAL` simulated `LOW`
  - no workflow-bound alert/case
  - deposit can continue only through canonical `success`
- `MEDIUM`
  - alert created
  - deposit moves to `UNDER_REVIEW`
  - `FALSE_POSITIVE` or clear callback returns to canonical success path
- `HIGH`
  - alert + case
  - `CLEAR` callback returns to canonical success path
  - `REJECT` terminates as `REJECTED`
- `FREEZE`
  - remains under compliance control and must not fake terminal accounting
- `FAIL`
  - accounting-block / orchestration fail path stays diagnosable through canonical audit

### Withdraw
- `LOW`
  - `TX_WITHDRAW_FINAL` simulated `LOW`
  - withdraw reaches `PAYOUT_PENDING`
  - payout is the only execution surface
- `MEDIUM`
  - alert created
  - withdraw moves to `UNDER_REVIEW`
  - `FALSE_POSITIVE` or clear callback resumes to `PAYOUT_PENDING`
- `HIGH`
  - alert + case
  - `CLEAR` callback resumes to `PAYOUT_PENDING`
  - `REJECT` terminates as `REJECTED`
- `PAYOUT_FAIL / TIMEOUT / RETURNED`
  - handled through payout terminal callbacks plus canonical compensation semantics
- `re-closeout / re-compensate`
  - remain payout-only repair surfaces

### Payin
- `fiat confirm`
  - no response containers
  - canonical audit trail must still show payin + deposit linkage
- `crypto confirm`
  - `KYT + Travel Rule` containers exist and are `FINAL`
  - payin remains an inbound monitoring rail, not an approval surface
- `fail / cleared`
  - rail evidence and audit trail must stay replayable

### Payout
- `fiat confirm`
  - `referenceNo` exists by confirm time
  - if not provided explicitly, system-generated confirm-time value is acceptable
- `crypto confirm`
  - payout receipt closes the withdraw path
- `fail / timeout / returned`
  - compensation remains canonical and replay-safe
- `repair`
  - `re-closeout / re-compensate` remain outbound-only

## Evidence And Canonical Audit Baseline
- Transaction root detail pages must expose canonical audit trail:
  - `DepositTransaction`
  - `WithdrawTransaction`
- Rail detail pages must expose canonical audit trail:
  - `Payin`
  - `Payout`
- Audit Center remains the canonical operator replay surface.
- Evidence export remains approval-backed and operator-triggered:
  - no auto-generated package rows
  - no second export API

## Required Evidence Samples
- At least one manually reproducible sample per state family:
  - `SUCCESS`
  - `UNDER_REVIEW`
  - `REJECTED`
  - `FAILED`
  - `RETURNED`
- Export validation must be able to replay:
  - root transaction
  - rail
  - decision record
  - alert / case
  - journal / clearing / downstream treasury records when applicable

## Residual Compatibility Shell
- Still tolerated in historical reads only:
  - `TX_WITHDRAW_PRECHECK`
  - `REVIEW_WITHDRAW_PRECHECK`
  - legacy response status payloads such as `PASS / ACCEPTED / NOT_REQUIRED / REVIEW / FAIL`
- Still tolerated as frozen historical-input compatibility only, not as active operator wording:
  - historical simulation metadata such as `simulationRiskLevel / simulationRiskReason`
- Still tolerated as frozen historical-input compatibility only:
  - old stored/raw payin type values that normalize to `CRYPTO / FIAT`
  - old stored/raw payout status `CLEAR` that normalizes to `CLEARED`
  - `WithdrawTransactionStatus.CREATED / APPROVED / HELD` as historical compatibility values
- Not tolerated as active truth:
  - live PRECHECK simulation
  - live PRECHECK alert recommendation surface
  - response status used as current risk disposition

## Post-Wave 7 Handoff
- `Wave 8` finance handoff owns:
  - full safeguarding reconciliation
  - threshold / escalation
  - broader funding / treasury coverage
  - heavier treasury / safeguarding operator tooling
- `Wave 9` governance handoff owns:
  - governance registries
  - filing receipt effectiveness
  - governance registry 运营化联动
- `Wave 7 cleanup` does not reopen those scopes.
