Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/withdraw-payout-canonical-workflow.md`, `docs/specs/entities/audit-evidence-package-entity.md`
Source of Truth Level: acceptance

# Wave 7 Withdraw Evidence Export Runbook

## Purpose
- Describe the approval-backed operator walkthrough for exporting a Wave 7 withdraw evidence package.

## Environment
- Audit Center and evidence export approval workflow enabled
- one completed withdraw root with linked payout and compliance history
- optional one withdraw root with reconciliation break for Phase 4 validation

## Validation Steps
1. Open `Audit Center` and choose evidence export.
2. Select audit events that belong to one withdraw root.
3. Set workflow type to `WITHDRAW`.
4. Submit the approval-backed export request and complete the normal approval flow.
5. Open the generated evidence package detail.
6. Verify `workflowSummary` prefers the `withdrawNo`.
7. Verify the package contains these snapshot sections:
   - `withdrawTransactions`
   - `payouts`
   - `preKytCases`
   - `mainKytCases`
   - `travelRuleCases`
   - `riskDecisionRecords`
   - `alerts`
   - `cases`
   - `journals`
   - `clearings`
   - `reconciliationBreaks`
   - `withdrawEvidenceChain`
8. Open `withdrawEvidenceChain` and confirm the selected root resolves:
   - `withdrawId -> payoutId`
   - `withdrawId -> decisionRecordIds`
   - `withdrawId -> alertIds / caseIds`
   - `withdrawId -> journalIds`
   - `withdrawId -> clearingIds`
   - `withdrawId -> reconciliationBreakIds`
9. Repeat the export for a root without reconciliation breaks and verify the section still exists but is empty.

## Expected Operator Questions
- was dispatch blocked or allowed
- which decision record authorized release
- which payout receipt closed the flow
- whether fail / return generated compensation
- whether a reconciliation break was raised and how it was handled

## Expected Results
- no second export API is required for withdraw evidence
- `WITHDRAW` packages include payout, risk, accounting, and reconciliation snapshots in one manifest
- evidence package detail renders withdraw-specific sections instead of falling back to generic raw-only output
