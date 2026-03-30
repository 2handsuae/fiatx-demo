Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/specs/workflows/swap-canonical-workflow.md`, `docs/acceptance/local-main-runtime-runbook.md`
Source of Truth Level: acceptance

# Wave 6 Swap Final Acceptance Checklist

## Operator
- Product owner, QA, or demo operator with:
1. customer session
2. admin session
3. access to Risk Policy Executions, Compliance Center, and Audit Center

## Pre-Run
- Reset to the agreed local baseline:
1. `npm run db:base:sync`
2. `npm run dev:reset`
- Confirm the stack is up and customer has funded sell-side balance.

## Checklist
- Quote lifecycle:
1. customer fetches executable rate
2. customer creates firm quote
3. quote shows TTL
4. expired quote cannot be consumed
5. cancelled quote cannot be consumed
6. used quote cannot be consumed twice
- Product restriction:
1. blocked pair or tier refuses quote
2. blocked investor classification refuses quote
3. refusal returns machine-readable restriction code
4. refusal writes audit log
- Manual low-risk clear path:
1. create swap from valid quote
2. swap enters `PENDING_COMPLIANCE`
3. pending `TX_SWAP_FINAL` decision record is visible in `Risk Policy Executions`
4. operator simulates `LOW`
5. swap moves to `SUCCESS`
6. created + success journals exist
7. dual outstandings exist
8. no held balance remains after success
- Review path:
1. operator simulates `MEDIUM` or `HIGH` from `Risk Policy Executions`
2. medium or high-risk swap enters `UNDER_REVIEW`
3. alert is visible in Compliance Center
4. high-risk path escalates case
5. false positive / clear resolves swap to `SUCCESS`
6. reject resolves swap to `REJECTED`
- Failure path:
1. simulate post-create compliance failure
2. swap moves to `FAILED`
3. hold accounting is reversed
4. no orphan outstanding remains
- Fee path:
1. no-fee config still produces valid swap
2. fee-enabled config freezes gross / fee / net in quote
3. success path posts fee line
4. UI shows gross / fee / net
- Evidence export:
1. export by `swapId`
2. package manifest and workflow summary resolve to `swapNo`
3. package contains linked quote, risk, alert/case, journal, outstanding chain

## Acceptance Result
- Wave 6 is acceptable only when all checklist items pass without manual DB repair.
