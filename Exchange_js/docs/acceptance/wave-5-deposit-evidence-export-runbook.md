Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-24
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/entities/audit-evidence-package-entity.md`, `docs/specs/workflows/payin-deposit-canonical-workflow.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: acceptance

# Wave 5 Deposit Evidence Export Runbook

## Purpose
- This runbook explains how to export and interpret a Wave 5 deposit evidence package.
- It keeps `Audit Center` as the only formal export surface.

## Entry Surface
- Query events in `Audit Center` through:
  - `GET /admin/audit-logs`
- Create export request through:
  - `POST /admin/audit-logs/export/evidence-package`
- Review generated package through:
  - `GET /admin/audit-logs/evidence-packages`
  - `GET /admin/audit-logs/evidence-packages/:id`
  - `GET /admin/audit-logs/evidence-packages/:id/download`

## Recommended Filter Strategy
1. Filter by:
   - `workflowType = DEPOSIT`
   - `workflowNo = depositNo`
   - or `traceId`
2. Confirm selected records cover:
   - signal / payin / deposit actions
   - tx compliance updates
   - transaction risk bridge
   - alert / case actions
   - accounting outcome
   - internal collection for crypto success path
3. Export through the approval-backed evidence package flow.

## Snapshot Fields
- `packageBody.snapshots.deposits`
  - root deposit rows with linked payin, customer, and asset snapshot
- `packageBody.snapshots.kytCases`
  - deposit-bound `MAIN-KYT` evidence containers
- `packageBody.snapshots.travelRuleCases`
  - deposit-bound `TRAVEL_RULE` evidence containers
- `packageBody.snapshots.riskDecisionRecords`
  - deposit-bound decision records keyed by `subjectId = depositId`
- `packageBody.snapshots.alerts`
  - workflow-bound transaction alerts keyed by `sourceType=DEPOSIT, sourceId=depositId`
- `packageBody.snapshots.cases`
  - workflow-bound transaction cases keyed by `sourceType=DEPOSIT, sourceId=depositId`
- `packageBody.snapshots.journals`
  - deposit journals keyed by `sourceType=DEPOSIT, sourceId=depositId`
- `packageBody.snapshots.internalTransactions`
  - downstream `DEP_TO_MASTER` internal transactions for crypto-success path
- `packageBody.snapshots.internalFunds`
  - downstream funds linked from the exported internal transactions
- `packageBody.snapshots.depositEvidenceChain`
  - replay summary per deposit:
    - `payinId / payinNo`
    - `decisionRecordIds`
    - `kytCaseIds`
    - `travelRuleCaseIds`
    - `alertIds`
    - `caseIds`
    - `journalIds`
    - `internalTransactionIds`
    - `internalFundIds`

## How To Replay The Four Wave 5 Paths

### 1. Happy Path
- Expect:
  - one signal / payin / deposit chain
  - no workflow-bound reject path
  - confirmed and success journal evidence
  - crypto path also includes `DEP_TO_MASTER` internal transaction and fund

### 2. Review-Clear Path
- Expect:
  - one decision record that recommends review or reject handling
  - alert and optional case chain
  - final release to `SUCCESS`
  - no duplicate accounting posting

### 3. Reject Path
- Expect:
  - decision record + alert + case
  - final deposit status `REJECTED`
  - confirmed accounting journal may exist
  - reject accounting journal must not be fabricated

### 4. Accounting-Blocked Path
- Expect:
  - `DEPOSIT_ACCOUNTING_BLOCKED` audit event in selected records
  - blocked metadata explains the failed accounting point
  - no fake `journalId` in the blocked branch
  - `depositEvidenceChain` stays replayable even when accounting is incomplete

## Pass Criteria
- Operator can export a deposit package without custom tooling or direct DB reads.
- Operator can explain every object in `depositEvidenceChain`.
- Operator can distinguish:
  - provider evidence containers
  - transaction decision records
  - workflow-bound alerts/cases
  - accounting output
  - downstream treasury collection
