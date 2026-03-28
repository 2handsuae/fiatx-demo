Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
Source of Truth Level: acceptance

# Wave 7 Minimum Daily Reconciliation Runbook

## Purpose
- Describe the Phase 4 manual validation sequence for break-based daily reconciliation.

## Environment
- local or demo runtime with Wave 7 Phase 4 schema and backend enabled
- at least one withdraw root in each category:
  - reconciled success path
  - success closeout mismatch
  - failed / returned compensation mismatch

## Validation Steps
1. Open `Reconciliation Center -> Safeguarding Breaks`.
2. Run `Run Daily Diff` with a business date that already contains terminal withdraw roots.
3. Verify reconciled success roots do not create a break row.
4. Prepare or locate a mismatched success closeout:
   - withdraw `SUCCESS`
   - payout / clearing evidence still inconsistent
5. Run the same daily diff again and verify one `OPEN` break is created.
6. Open the break detail and verify:
   - `withdrawNo`
   - `payoutNo`
   - `expectedNetDelta`
   - `observedNetDelta`
   - `deltaAmount`
   - `reasonCode`
   - linked alert reference
7. Move the break to `UNDER_REVIEW`.
8. Complete the underlying business fix or use a known corrected fixture.
9. Run the daily diff again:
   - if mismatch is gone, verify the old break remains visible and is not auto-closed
   - manually move the break to `RESOLVED`
10. Reproduce the same mismatch again and rerun daily diff.
11. Verify the same break is reopened instead of creating a second break row.
12. From the linked alert, escalate to case when needed and verify `linkedCaseId` becomes visible on break detail.

## Expected Results
- reconciliation output is break-based
- break handling is traceable and audit-visible
- no break handling mutates withdraw or payout status directly
- each business date + withdraw root has at most one break row
- repeated generation reopens the same break when mismatch reappears
- linked reconciliation alert uses:
  - `stage = REVIEW_WITHDRAW_RECONCILIATION`
  - `ruleCode = TX_RECONCILIATION_BREAK_DETECTED`

## Known Caveats
- Wave 7 does not auto-close breaks when a later rerun becomes clean.
- Wave 7 does not auto-create cases from reconciliation alerts.
- Threshold escalation, treasury coverage, and full safeguarding inventory remain Wave 8 scope.
