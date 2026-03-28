Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/customer-transaction-flow-constraints.md`, `docs/constraints/internal-transaction-flow-constraints.md`, `docs/specs/workflows/payin-deposit-canonical-workflow.md`, `docs/specs/entities/inbound-transfer-signal-entity.md`, `docs/specs/entities/payin-entity.md`, `docs/specs/entities/deposit-transaction-entity.md`, `docs/specs/entities/audit-evidence-package-entity.md`, `docs/specs/modules/risk-engine-module.md`, `docs/specs/modules/compliance-center-module.md`, `docs/specs/modules/accounting-ledger-module.md`, `docs/acceptance/wave-5-deposit-accounting-blocked-runbook.md`, `docs/acceptance/wave-5-deposit-evidence-export-runbook.md`
Source of Truth Level: acceptance

# Wave 5 PayIn / Deposit Final Acceptance Checklist

## Purpose
- This document is the final Wave 5 operator acceptance and demo checklist for the implemented deposit chain.
- It teaches QA, operators, and demo owners how to validate the current finished runtime without relying on roadmap-only or cleanup-only context.

## Audience
- QA / UAT operator
- product demo owner
- engineering smoke-check owner

## Environment Baseline
- Backend, admin web, and client web are up and healthy.
- Customer test user can access:
  - `/deposit`
  - `my deposit history`
- Admin operator can access:
  - deposit transaction list/detail
  - payin list/detail
  - `KYT Cases`
  - `Travel Rule Cases`
  - `Alerts`
  - `Cases`
  - `Audit Center`
- Local baseline should start from:
  1. `npm run db:base:sync`
  2. `npm run dev:reset`
  3. `npm run dev:start`

## Required Companion Docs
- Workflow truth:
  - `docs/specs/workflows/payin-deposit-canonical-workflow.md`
- Entity truth:
  - `docs/specs/entities/inbound-transfer-signal-entity.md`
  - `docs/specs/entities/payin-entity.md`
  - `docs/specs/entities/deposit-transaction-entity.md`
  - `docs/specs/entities/audit-evidence-package-entity.md`
- Constraint truth:
  - `docs/constraints/customer-transaction-flow-constraints.md`
  - `docs/constraints/internal-transaction-flow-constraints.md`
- Operator runbooks:
  - `docs/acceptance/wave-5-deposit-accounting-blocked-runbook.md`
  - `docs/acceptance/wave-5-deposit-evidence-export-runbook.md`

## Core Chains
1. `happy path`
   - `signal -> payin -> deposit -> COMPLIANCE_PENDING -> pending TX_DEPOSIT_FINAL -> LOW simulation -> canonical deposit success -> evidence export`
   - crypto branch adds `KYT / Travel Rule` containers in `FINAL` plus downstream `DEP_TO_MASTER`
   - fiat branch creates no response container and has no downstream crypto collection leg
2. `review-clear path`
   - `TX_DEPOSIT_FINAL MEDIUM -> alert -> FALSE_POSITIVE`
   - or `TX_DEPOSIT_FINAL HIGH -> case -> MLRO CLEAR`
3. `reject path`
   - `TX_DEPOSIT_FINAL HIGH -> case -> MLRO REJECT`
4. `accounting-block path`
   - `payin.confirmed` or `deposit.success` accounting point emits `DEPOSIT_ACCOUNTING_BLOCKED`

## Validation Steps

### 1. Happy Path
- Customer opens `/deposit`.
- Customer submits one inbound transfer signal through `POST /deposit-transactions/my/inbound-signals`.
- Customer runs `POST /deposit-transactions/my/inbound-signals/scan`.
- Confirm:
  - one `InboundTransferSignal` exists
  - one `PayIn` is created or reused
  - one `Deposit` is created or reused
  - deposit reaches `COMPLIANCE_PENDING`
  - crypto deposit has `KYT` and `TRAVEL_RULE` evidence containers and both are already `FINAL`
  - fiat deposit creates no response container at this step
  - exactly one `TX_DEPOSIT_FINAL` decision record exists
- Simulate `LOW` risk on `TX_DEPOSIT_FINAL`.
- Confirm:
  - no workflow-bound alert/case is required for the no-hit path
  - deposit can be released only through canonical deposit success action
- Execute canonical deposit success action.
- Confirm:
  - deposit reaches `SUCCESS`
  - `EVT_DEPOSIT_SUCCESS__*` accounting is posted
  - crypto deposit triggers one downstream `DEP_TO_MASTER`
  - fiat deposit completes without crypto-only downstream collection artifacts
  - audit replay can reach payin, deposit, journal, internal transaction, and internal fund

### 2. Review-Clear Path
- Start from a crypto deposit in `COMPLIANCE_PENDING`.
- Simulate one of these final-review paths:
  - `MEDIUM`
  - `HIGH`
- Confirm:
  - deposit is moved to `UNDER_REVIEW` through canonical deposit action
  - transaction decision record exists
  - alert exists
  - case exists when `HIGH` or manual escalation is required
- For alert-only clear path:
  - resolve the workflow-bound alert with `FALSE_POSITIVE`
- For case clear path:
  - finalize report
  - submit to MLRO
  - approve final disposition with `CLEAR`
- Confirm:
  - deposit reaches `SUCCESS`
  - release still passes customer gate and transaction gate
  - accounting is posted only once
  - crypto internal collection is still replay-safe

### 3. Reject Path
- Start from a crypto deposit in `COMPLIANCE_PENDING`.
- Simulate `HIGH` on `TX_DEPOSIT_FINAL`.
- Confirm:
  - alert exists
  - case exists
  - deposit is flagged to `UNDER_REVIEW`
- Finalize report and submit case to MLRO.
- Approve final disposition with `REJECT`.
- Confirm:
  - deposit reaches `REJECTED`
  - payin/deposit compliance trace remains complete
  - reject path does not mint a fake deposit reject accounting posting or reversal
  - evidence package can replay the reject decision chain

### 4. Accounting-Blocked Path
- Validate the accounting-block scenario through the runbook and automated verification, not through destructive shared-environment mutation.
- Confirm both semantic branches:
  - `payin.confirmed -> COMPLIANCE_PENDING` accounting block
  - `deposit.success -> SUCCESS` accounting block
- Confirm:
  - `DEPOSIT_ACCOUNTING_BLOCKED` audit exists
  - `payin.confirmed` block does not clear payin to `CLEARED`
  - `deposit.success` block does not fabricate a `journalId`
  - operator diagnosis path is `Audit Center + workflowType=DEPOSIT + workflowNo/traceId`

## Recommended Automated Verification
1. `npx jest src/modules/asset-treasury/payins/payins.service.spec.ts src/modules/trading/deposit-transactions/deposit-transactions.controller.spec.ts src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts src/modules/trading/deposit-transactions/transaction-deposit-workflow.service.spec.ts src/orchestrators/deposit-workflow.service.spec.ts src/modules/risk-engine/transaction-compliance/transaction-compliance.service.spec.ts src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.spec.ts src/modules/risk-engine/risk-engine.service.spec.ts src/modules/risk-engine/risk-decision-records.service.spec.ts src/modules/risk-engine/compliance-alerts/compliance-alerts.service.spec.ts src/modules/risk-engine/compliance-incidents/compliance-incidents.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts src/modules/asset-treasury/internal-transactions/internal-transactions.service.spec.ts src/modules/asset-treasury/internal-funds/internal-funds.service.spec.ts --runInBand`
2. `npm run build`
3. `cd admin-web && npm run build`
4. `cd client-web && npm run build`

## Recorded Verification Refresh (2026-03-24)
- The acceptance baseline for this document is refreshed against:
  - the Wave 5 focused + regression Jest suites listed above
  - backend `npm run build`
  - `admin-web` build
  - `client-web` build

## Expected Results
- `InboundTransferSignal`, `PayIn`, and `Deposit` each keep their own lifecycle role.
- Provider response containers remain evidence containers, not platform cases.
- Transaction hits enter `Alert / Case` only through risk-driven bridge semantics.
- Workflow callback authority stays in canonical deposit state actions.
- Evidence export can replay:
  - payin
  - deposit
  - transaction decision
  - alert / case
  - journal
  - internal collection
- Internal collection remains downstream of `Deposit.SUCCESS`, not a customer-visible main-state root.

## Pass Criteria
- A new engineer or operator can validate Wave 5 by reading:
  1. this acceptance document
  2. the linked workflow/entity/module docs
  3. the two Wave 5 runbooks
- They do not need the phase-plan gap inventory or archived cleanup history to understand current runtime truth.
