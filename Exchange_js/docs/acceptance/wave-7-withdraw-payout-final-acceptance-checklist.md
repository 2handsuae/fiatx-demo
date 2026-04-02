Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-28
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
Source of Truth Level: acceptance

# Wave 7 Withdraw / Payout Final Acceptance Checklist

## Environment
- local main runtime with Wave 7 withdraw / payout code enabled
- seeded customer, asset, wallet, and payout routes

## Validation Steps
### Happy Path
- submit crypto withdraw request once and verify only a quote is created
- review the second-confirmation modal and confirm the quote
- verify withdraw is created in `PENDING_COMPLIANCE`
- verify `Pre-KYT response` and `Travel Rule response` both exist and are already `FINAL`
- verify exactly one `TX_WITHDRAW_FINAL` decision record exists
- simulate `LOW` risk on the final decision record
- verify withdraw moves into `PAYOUT_PENDING`
- start payout dispatch through `PATCH /payouts/:id/status`
- confirm payout receipt
- verify withdraw `SUCCESS` and payout `CLEARED`
- verify no admin action writes withdraw `PAYOUT_PENDING` directly
- verify no admin action writes withdraw `SUCCESS` directly
- verify no admin action writes payout `CLEARED` directly
- repeat one fiat happy path and verify:
  - quote-confirm path is the same
  - withdraw creates no response container at create time
  - exactly one `TX_WITHDRAW_FINAL` decision record exists
  - payout `CONFIRM` writes `referenceNo` and final closeout still ends at `withdraw SUCCESS / payout CLEARED`

### Risk Review
- simulate `MEDIUM` risk on `TX_WITHDRAW_FINAL`
- verify an alert is created and withdraw moves to `UNDER_REVIEW`
- resolve the alert through existing alert operations
- verify only `CLEAR / REJECT / FREEZE_TRANSACTION` callbacks can drive withdraw workflow outcome
- verify `FALSE_POSITIVE` or clear callback continues to `PAYOUT_PENDING`
- simulate `HIGH` risk on `TX_WITHDRAW_FINAL`
- verify alert is created and automatically escalated to case
- verify reject / risk-confirmed callback moves withdraw to `REJECTED`
- verify `REPORT / STR` follow-up leaves case / filing trace only and does not directly mutate withdraw terminal state

### Extreme Volatility
- enable `WITHDRAWAL_PRICING.restrictions.extremeVolatilityBlocked`
- create customer withdraw quote
- expect quote create to be blocked with machine-readable restriction payload and audit
- create customer withdraw request with a valid quote
- expect withdraw create to be blocked with the same restriction code
- start payout dispatch through `PATCH /payouts/:id/status`
- expect dispatch start to be blocked with the same restriction code
- run admin withdrawal simulator
- verify simulator remains available while the restriction is enabled
- verify already `CONFIRMED` payouts are not auto-rolled back

### Fail / Return
- drive payout `FAILED`
- verify withdraw `FAILED`
- drive payout `RETURNED`
- verify withdraw `RETURNED`
- verify no repeated reversal on repeated callbacks
- verify linked withdraw clearings converge to `CANCELLED`

### Repair / Re-closeout
- move payout to `CONFIRMED` while linked withdraw remains `PAYOUT_PENDING`
- call `POST /payouts/:id/re-closeout`
- verify the same canonical success closeout runs:
  - withdraw becomes `SUCCESS`
  - payout becomes `CLEARED`
  - response reports `repairApplied = true`
- repeat the same call after success closeout
- verify response is a no-op and does not create duplicate postings

### Repair / Re-compensate
- move payout to `FAILED` or `TIMEOUT` while linked withdraw remains `PAYOUT_PENDING`
- call `POST /payouts/:id/re-compensate`
- verify the same canonical compensation path runs:
  - withdraw becomes `FAILED`
  - reversal journals are present without duplication
  - linked withdraw clearings become `CANCELLED`
  - response reports `repairApplied = true`
- move payout to `RETURNED` while linked withdraw remains `SUCCESS`
- call `POST /payouts/:id/re-compensate`
- verify withdraw becomes `RETURNED` and terminal compensation closes cleanly
- repeat the same call after compensation is fully settled
- verify response is a no-op and does not create duplicate reversals or duplicate clearing close side effects

### Minimum Daily Reconciliation
- open `Reconciliation Center -> Safeguarding Breaks`
- run `Run Daily Diff` for a business date with terminal withdraw roots
- verify reconciled success paths do not create a break
- verify mismatched success closeout creates one `OPEN` break with linked alert
- move break to `UNDER_REVIEW`, then `RESOLVED` or `ACCEPTED_DIFFERENCE`
- rerun the same mismatch after resolution and verify the same break reopens instead of creating a second row
- verify reconciliation alert / case handling never mutates withdraw or payout status directly

### Withdraw Evidence Export
- export an approval-backed evidence package with `workflowType = WITHDRAW`
- verify `workflowSummary.workflowNos` prefers `withdrawNo`
- verify package includes withdraw, payout, risk, alerts, cases, journals, clearings, and reconciliation breaks
- verify `withdrawEvidenceChain` can replay one root end-to-end

## Expected Results
- no happy path uses direct withdraw approve or direct withdraw success action
- no admin path uses direct payout terminal state mutation
- active response lifecycle semantics stay limited to `CREATED / RECEIVED / FINAL`
- payout confirmation does not create missing compliance cases
- withdraw / payout linkage is visible in detail pages
- response containers are evidence-only and do not provide a risk simulation surface
- fiat branches may legitimately have no response containers while still using the same final-review truth
- extreme-volatility gate blocks quote create / withdraw create / payout dispatch start and always writes canonical audit
- withdraw case `REPORT / STR` remains evidence/governance trace only
- fail / return replay does not leave orphan journal or non-cancelled withdraw clearing
- daily reconciliation is break-based, operator-driven, and non-invasive to transaction state
- withdraw evidence export can replay one root including reconciliation snapshots when present

## Known Caveats
- Wave 8 remains responsible for full safeguarding threshold / escalation and broader treasury coverage
- Governance registries and filing / receipt / effectiveness operations are now Wave 9 scope
