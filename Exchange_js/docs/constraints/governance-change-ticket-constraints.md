# Governance Change Ticket Constraints

## 1) Scope and Ownership
- MUST keep `WF-06` canonical implementation under:
1. `src/modules/governance/change-tickets`
2. `src/modules/governance/approvals`
- MUST treat `Change Ticket + Release Gate` as the only in-scope governance workflow for this phase.
- MUST NOT fold `Delete Request` or `SLA Timer` requirements into this constraint file until those phases are implemented.

## 2) Data Model and No-First Contract
- MUST persist `change_tickets` and `change_ticket_gate_runs`.
- `change_tickets` MUST expose `ticketNo` as the operator-facing primary identifier.
- `ticketNo` MUST be generated with `generateReferenceNo('CT')`.
- Internal routing and foreign-key relations MAY continue to use `id`, but admin UI and default search MUST prioritize `ticketNo`.
- `change_ticket_gate_runs` MUST NOT introduce a standalone `gateRunNo` in this phase.
- Gate run operator-facing entity No MUST be `${ticketNo}:${targetEnv}:${releaseVersion}`.

## 3) Change Ticket State Machine
- MUST keep ticket state machine:
1. `DRAFT`
2. `SUBMITTED`
3. `APPROVAL_PENDING`
4. `REJECTED`
5. `READY_FOR_DEPLOY`
6. `DEPLOYED`
7. `DEPLOY_FAILED`
8. `CLOSED`
- `APPROVED` MUST NOT be used as a stable `change_tickets.status`.
- Approval projection MUST map:
1. `APPROVED -> READY_FOR_DEPLOY`
2. `REJECTED -> REJECTED`
3. `EXPIRED -> REJECTED`
4. `CANCELLED -> REJECTED`
- `latestApprovalStatus` MUST preserve the real approval terminal status even when ticket status mirrors to `REJECTED`.

## 4) Approval Binding Rules
- Submit and resubmit MUST create and submit an approval case with:
1. `actionType = CHANGE_TICKET_APPROVAL`
2. `entityRef = changeTicket.id`
3. metadata including `ticketNo`
- Phase 2 checker roles MUST come from the approval policy baseline: `CISO,TECH_ADMIN`.
- This phase MUST NOT allow per-ticket custom checker role overrides.
- `submit` MUST be allowed only from `DRAFT`.
- `resubmit` MUST be allowed only from `REJECTED`.

## 5) Release Gate Rules
- Gate check MUST be allowed only when ticket status is `READY_FOR_DEPLOY`.
- If ticket status is `DEPLOY_FAILED`, a new gate check MAY reopen it to `READY_FOR_DEPLOY` first.
- Gate check MUST require all minimum evidence fields:
1. `changeType`
2. `scopeSummary`
3. `riskLevel=HIGH`
4. `testEvidenceRef`
5. `rollbackPlanRef`
6. `latestApprovalStatus=APPROVED`
- Deploy mark MUST require a matching passed gate run on the same `ticket + targetEnv + releaseVersion`.
- Close MUST be allowed only from `DEPLOYED` or `DEPLOY_FAILED`.

## 6) Gate Run Idempotency
- Active gate run uniqueness MUST be enforced by `activeKey = ${ticketId}|${targetEnv}|${releaseVersion}`.
- `activeKey` MUST be populated only for active statuses and cleared after terminal statuses.
- Same `ticket + env + version` MUST NOT have more than one active gate run at the same time.

## 7) Audit and Workflow Traceability
- All change ticket and gate writes MUST go through `AuditLogsService`.
- Audit records MUST include:
1. `module = GOVERNANCE_CHANGE_TICKETS`
2. `workflowType = CHANGE_TICKET`
3. `workflowId = ticket.id`
4. `workflowNo = ticket.ticketNo`
5. `traceId = ticket.traceId`
- `subjectNos` MUST include `ticketNo`.
- If an approval is linked, `subjectNos` SHOULD also include `approvalNo`.
- Phase 2 action dictionary MUST include:
1. `CHANGE_TICKET_CREATED`
2. `CHANGE_TICKET_SUBMITTED`
3. `CHANGE_TICKET_APPROVAL_LINKED`
4. `CHANGE_TICKET_APPROVED`
5. `CHANGE_TICKET_REJECTED`
6. `RELEASE_GATE_CHECKED`
7. `RELEASE_GATE_PASSED`
8. `RELEASE_GATE_FAILED`
9. `CHANGE_TICKET_DEPLOYED`
10. `CHANGE_TICKET_DEPLOY_FAILED`
11. `CHANGE_TICKET_CLOSED`

## 8) Admin UI and Route Contract
- Control Gates admin entry MUST surface:
1. `/dashboard/control-gates/change-tickets`
2. `/dashboard/control-gates/change-tickets/create`
3. `/dashboard/control-gates/change-tickets/:id`
- List page MUST remain a pure list page and MUST NOT embed a bottom detail panel.
- List page default filters MUST support:
1. `ticketNo`
2. `status`
3. `changeType`
4. `latestApprovalStatus`
5. `traceId`
6. `releaseVersion`
7. `keyword`
- Detail page MUST keep admin detail page styling and MUST expose actions according to ticket status and permission.

## 9) RBAC Baseline
- Phase 2 permission groups MUST include:
1. `GOV_CHANGE_TICKET_READ`
2. `GOV_CHANGE_TICKET_WRITE`
3. `GOV_CHANGE_TICKET_GATE`
4. `GOV_CHANGE_TICKET_CLOSE`
- Phase 2 role matrix MUST be:
1. all Java roles -> `GOV_CHANGE_TICKET_READ`
2. `TECH_ADMIN / FINANCE / OPS_TREASURY / COMPLIANCE_LEAD / CISO` -> `GOV_CHANGE_TICKET_WRITE`
3. `TECH_ADMIN / CISO` -> `GOV_CHANGE_TICKET_GATE`
4. `TECH_ADMIN` -> `GOV_CHANGE_TICKET_CLOSE`
5. `SUPER_ADMIN` -> all permissions

## 10) Delivery Checklist
- Prisma migration added for `change_tickets` and `change_ticket_gate_runs`.
- Approval submit/resubmit path verified end-to-end.
- Gate pass/fail and deploy/close transitions verified with tests.
- Audit Center can query change ticket events by `workflowType`, `workflowNo`, and `traceId`.
- RBAC sync updates new change ticket permissions into active roles.
