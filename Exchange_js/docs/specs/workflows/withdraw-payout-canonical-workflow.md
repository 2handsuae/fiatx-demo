Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/customer-transaction-flow-constraints.md`, `docs/constraints/internal-transaction-flow-constraints.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: specs-workflow

# Withdraw / Payout Canonical Workflow

## Purpose
- Define the canonical Wave 7 outbound-funds workflow.
- Separate withdraw business state, payout execution state, and risk-decision ownership.

## Actors
- `Customer`
- `Compliance Operator`
- `MLRO`
- `Treasury Operator`
- `System`

## Workflow Roots
- `WithdrawTransaction`
  - customer-visible outbound transaction root
- `Payout`
  - execution / receipt / failure root for money leaving the platform

## Canonical State Model
### WithdrawTransaction
- New customer-created withdraws start at `PENDING_COMPLIANCE`.
- `CREATED` is retained for historical compatibility records only.
- `CREATED`
- `PENDING_COMPLIANCE`
- `UNDER_REVIEW`
- `PAYOUT_PENDING`
- `SUCCESS`
- `FAILED`
- `REJECTED`
- `CANCELLED`
- `RETURNED`

### Payout
- Crypto:
  - `CREATED`
  - `SIGNING`
  - `BROADCASTED`
  - `CONFIRMING`
  - `CONFIRMED`
  - `CLEAR`
  - `FAILED`
  - `TIMEOUT`
- Fiat:
  - `CREATED`
  - `CONFIRMING`
  - `CONFIRMED`
  - `CLEAR`
  - `FAILED`
  - `TIMEOUT`
  - `RETURNED`

## Canonical Entry Paths
- Customer quote + confirm path:
  - first submit generates quote and opens the fee-confirmation modal
  - second confirmation consumes the quote through `POST /withdraw-transactions`
- Customer request:
  - `POST /withdraw-transactions`
- Withdraw workflow action:
  - `PATCH /withdraw-transactions/:id/status`
  - admin route only allows:
    - `check`
    - `flag`
    - `reject`
    - `cancel`
  - `check` remains a compatibility/manual surface and is not part of the canonical new-withdraw happy path
  - direct admin `approve` is non-canonical for new withdraws and must not be used as the happy-path progression surface
  - terminal `success / fail / return` remain internal workflow/system actions only
- Payout execution path:
  - `PATCH /payouts/:id/status`
  - admin route allows execution actions only
  - `CLEAR` is reserved for system closeout
- Repair path:
  - `POST /payouts/:id/re-closeout`
  - only retries the canonical `CONFIRMED -> withdraw SUCCESS posting -> payout CLEAR` closeout
  - `POST /payouts/:id/re-compensate`
  - only retries the canonical terminal compensation path for `FAILED / TIMEOUT / RETURNED`

## Main Paths
### 1. Customer Submit -> Quote Confirmation
- Customer fills asset, amount, and destination.
- First submit generates a withdraw quote and opens a second-confirmation modal.
- The quote modal is the only normal fee review surface.
- Withdraw is not created until the customer confirms the quote.

### 2. Quote Consume -> Compliance Pending
- Second confirmation consumes the quote.
- Withdraw is created directly in `PENDING_COMPLIANCE`.
- Fiat withdraw creates no response container at this step.
- Crypto withdraw auto-creates:
  - `Pre-KYT response`
  - `Travel Rule response`
- Response containers are evidence holders only.
- Canonical response lifecycle is:
  - `CREATED`
  - `RECEIVED`
  - `FINAL`
- System-generated containers in the canonical withdraw flow are auto-filled directly to `FINAL`.
- Historical response values such as `PASS / ACCEPTED / NOT_REQUIRED / REVIEW / FAIL` are compatibility-only and should be normalized to lifecycle display, not treated as current truth.

### 3. Single-Stage Risk Review
- New withdraws create exactly one active risk execution root:
  - `TX_WITHDRAW_FINAL`
- `TX_WITHDRAW_PRECHECK` remains legacy/historical compatibility only and is not the canonical new-withdraw path.
- Historical `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` records are read-only evidence:
  - they may still appear in audit, evidence, and historical detail views
  - they are no longer valid manual simulation or workflow resolution targets
- Manual simulation of the final risk execution drives the business outcome:
  - `LOW`
    - no alert / case
    - withdraw auto-clears to `PAYOUT_PENDING`
  - `MEDIUM`
    - alert created
    - withdraw moves to `UNDER_REVIEW`
  - `HIGH`
    - alert created
    - case auto-escalated
    - withdraw moves to `UNDER_REVIEW`
- Response container status does not decide risk outcome.
- Alert / case callback remains the only workflow-bound way to move a reviewed withdraw:
  - `CLEAR / FALSE_POSITIVE / MLRO_CLEAR` continue to `PAYOUT_PENDING`
  - `REJECT / RISK_CONFIRMED / MLRO_REJECT` move withdraw to `REJECTED`

### 4. Payout Pending -> Execution
- Risk clear, not admin approve, is the canonical entry into `PAYOUT_PENDING`.
- Transition into `PAYOUT_PENDING` binds or reuses a `Payout`.
- `PAYOUT_PENDING` means execution may start but has not yet received terminal payout receipt.
- `SIGN` for crypto and `SUBMIT` for fiat are the canonical payout dispatch-start actions.
- Dispatch start must block when Wave 7 extreme-volatility restriction is enabled for withdraw flows.
- There is no separate response-status dispatch gate in the canonical new-withdraw flow.
- `payout CONFIRMED` must not backfill missing risk roots or pre-create skipped response containers.

### 5. Receipt -> Success
- `payout CONFIRMED` is the receipt boundary.
- Fiat payout confirmation writes `referenceNo`; if operator does not provide one, system auto-generates it.
- Crypto payout confirmation creates one `KYT response` container and auto-fills it to `FINAL`.
- Success path is:
  - payout receipt recorded
  - withdraw success posting executed
  - payout transitions to `CLEAR`
- Withdraw success is the customer-visible final outbound completion state.
- Admin operators must not write `CLEAR` directly from payout detail or payout list.
- If receipt exists but closeout is stuck, operator fallback is `POST /payouts/:id/re-closeout`, not direct status mutation.

### 6. Fail / Return
- `payout FAILED` and `TIMEOUT` drive withdraw `FAILED`.
- `payout RETURNED` drives withdraw `RETURNED`.
- Canonical compensation order is:
  - payout terminal receipt already recorded
  - withdraw terminal business status is applied if still missing
  - withdraw terminal accounting executes on `sourceType=WITHDRAW`
  - linked payout clearings close on `sourceType=WITHDRAWAL` with `clearingStatus=CANCELLED`
- Reversal / compensation must be idempotent across repeated payout callbacks.
- If payout terminal receipt exists but withdraw compensation is incomplete, operator fallback is `POST /payouts/:id/re-compensate`, not direct withdraw status mutation.

## Transaction Compliance Binding
- Canonical decision context for new withdraws:
  - `TX_WITHDRAW_FINAL`
- Workflow-bound review stages:
  - `REVIEW_WITHDRAW_FINAL`
- Legacy compatibility only:
  - `TX_WITHDRAW_PRECHECK`
  - `REVIEW_WITHDRAW_PRECHECK`
- Alert / case callback must route through canonical withdraw workflow transitions only.
- Workflow-bound withdraw disposition remains limited to:
  - `CLEAR`
  - `REJECT`
  - `FREEZE_TRANSACTION`
- `REPORT` / `STR` follow-up may be produced by case / filing governance, but they remain evidence and governance trace only and MUST NOT directly mutate withdraw terminal state.

## Runtime Restriction Gate
- `WITHDRAWAL_PRICING.restrictions.extremeVolatilityBlocked` is the runtime control surface for Phase 3 extreme-volatility handling.
- The restriction gate runs at:
  - withdraw quote create
  - withdraw create
  - payout dispatch start
- The restriction gate does not run on admin withdrawal simulation.
- The restriction gate does not roll back already `CONFIRMED` payouts.

## Authority Boundaries
- Withdraw state is the business truth.
- Payout state is the execution truth.
- `derivedComplianceStatus` is a read-model / aggregate view and should be derived from withdraw state plus linked risk/case context, not from response container lifecycle alone.
- Receipt fields such as `txHash` and `referenceNo` belong to payout execution, not withdraw authority.
- Direct admin happy-path success / fail actions on withdraw are non-canonical and must not be used for normal payout completion.
- Direct admin approve on withdraw is non-canonical for the normal flow and must not be used for payout progression.
- Direct admin `CLEAR` on payout is non-canonical and must not be used for normal closeout completion.
- Terminal payout compensation repair stays payout-rooted; there is no withdraw-root repair entry for normal Phase 2 compensation replay.

## Audit And Evidence
- Withdraw-root trace uses `WITHDRAW:<withdrawId>`.
- Admin rail read model for `payout` uses:
  - raw `status` as rail truth
  - `displayStatus` as display-layer truth
  - uppercase `type = CRYPTO | FIAT`
  - canonical `audit_log_events` as the detail audit source
- `CLEAR` remains the runtime closeout state, while `CLEARED` is the mirrored admin display label.
- Exportable Wave 7 evidence is expected to replay:
  - quote create and quote consume
  - withdraw request
  - crypto-only response container creation and final payload snapshots
  - final transaction decision / alert / case
  - payout binding
  - payout receipt
  - journal / reversal
  - linked `WITHDRAWAL` clearings
  - reconciliation breaks when present
  - clearing close on terminal compensation when applicable

## Non-Goals
- This document does not define full safeguarding reconciliation lifecycle.
