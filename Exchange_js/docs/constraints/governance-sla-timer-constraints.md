# Governance SLA Timer Constraints

## 1) Scope and Ownership
- MUST keep `WF-04` canonical implementation under:
1. `src/modules/governance/sla-timers`
2. `src/modules/governance/approvals`
3. `src/modules/governance/change-tickets`
- MUST keep SLA scope inside `Governance`; non-governance workflows MUST NOT be attached here.

## 2) Data Model and No-First Contract
- MUST persist both:
1. `sla_timers`
2. `sla_notifications`
- `sla_timers.timerNo` MUST remain the operator-facing primary identifier.
- `timerNo` MUST be generated with `generateReferenceNo('TM')`.
- Internal routing and foreign-key style relations MAY continue to use `id`, but admin UI and default search MUST prioritize `timerNo`, `workflowNo`, and `subjectNo`.
- Timer types remain limited to:
1. `APPROVAL_TIMEOUT`
2. `CHANGE_POST_APPROVAL_FOLLOWUP`

## 3) State Machine and Manual Actions
- Timer state machine MUST remain:
1. `ACTIVE`
2. `CLOSED`
3. `EXPIRED`
- MUST NOT introduce:
1. `DUE_SOON`
2. `BREACHED`
3. `CANCELLED`
4. timer `cancel`
- Active uniqueness MUST stay:
1. `activeKey = ${workflowType}|${subjectType}|${subjectId}|${timerType}`
2. activeKey populated only while `status=ACTIVE`
3. activeKey cleared after `CLOSED/EXPIRED`
- Manual actions are limited to:
1. `Close` only for active `CHANGE_POST_APPROVAL_FOLLOWUP`
2. `Recalc` for active `APPROVAL_TIMEOUT` and `CHANGE_POST_APPROVAL_FOLLOWUP`

## 4) Notification Registry
- `sla_notifications` MUST be registry-only; it MUST NOT send external email/SMS/in-app notifications.
- Notification types MUST be limited to:
1. `DUE_REMINDER`
2. `EXPIRE_MARK`
- Notification statuses MUST be limited to:
1. `SCHEDULED`
2. `TRIGGERED`
3. `SKIPPED`
- Timer creation and recalc MUST register or refresh a `DUE_REMINDER`.
- Timer expiry MUST register or update `EXPIRE_MARK`.
- Timer close before reminder trigger MUST mark pending reminders as `SKIPPED`.

## 5) Approval Timeout Binding
- Approval entering `PENDING` MUST create or reuse an `APPROVAL_TIMEOUT` timer.
- Approval timer contract MUST be:
1. `workflowType = APPROVAL`
2. `workflowId = approval.id`
3. `workflowNo = approval.approvalNo`
4. `subjectType = APPROVAL_CASE`
5. `subjectId = approval.id`
6. `subjectNo = approval.approvalNo`
7. `ownerUserId = approval.makerUserId`
8. `dueAt = approval.timeoutAt`
- Approval `APPROVED / REJECTED / CANCELLED / EXPIRED` MUST automatically close the active timeout timer.
- SLA scheduler MUST remain the only automatic approval-timeout scanner.

## 6) Change Ticket Follow-Up Binding
- Emergency change ticket deployment (`DEPLOYED / DEPLOY_FAILED`) MUST create or reuse `CHANGE_POST_APPROVAL_FOLLOWUP` when:
1. `emergency = true`
2. `postApprovalCompletedAt` is null
- Follow-up timer contract MUST be:
1. `workflowType = CHANGE_TICKET`
2. `workflowId = changeTicket.id`
3. `workflowNo = changeTicket.ticketNo`
4. `subjectType = CHANGE_TICKET`
5. `subjectId = changeTicket.id`
6. `subjectNo = changeTicket.ticketNo`
7. `ownerUserId = changeTicket.createdByUserId`
8. `dueAt = postApprovalDueAt ?? deployedAt + 48h`
- Manual close MUST also write `change_tickets.postApprovalCompletedAt`.
- Expired follow-up timer MUST NOT automatically mutate change ticket primary status.

## 7) Audit and Workflow Traceability
- All timer and notification writes MUST go through `AuditLogsService`.
- Audit records MUST include:
1. `module = GOVERNANCE_SLA_TIMERS`
2. `entityType = SLA_TIMER`
3. `entityId = timer.id`
4. `entityNo = timer.timerNo`
5. `workflowType = timer.workflowType`
6. `workflowId = timer.workflowId`
7. `workflowNo = timer.workflowNo`
8. `traceId = timer.traceId`
- `subjectNos` MUST include:
1. `timerNo`
2. `workflowNo`
3. `subjectNo`
- Action dictionary MUST include:
1. `SLA_TIMER_CREATED`
2. `SLA_TIMER_CLOSED`
3. `SLA_TIMER_EXPIRED`
4. `SLA_TIMER_RECALCULATED`
5. `SLA_NOTIFICATION_SCHEDULED`
6. `SLA_NOTIFICATION_TRIGGERED`
7. `SLA_NOTIFICATION_SKIPPED`

## 8) Admin UI and Route Contract
- Governance admin entry MUST surface:
1. `/dashboard/governance/sla-timers`
2. `/dashboard/governance/sla-timers/:id`
- List page MUST remain a pure list page and MUST NOT embed a bottom detail panel.
- List page filters MUST support:
1. `timerNo`
2. `timerType`
3. `status`
4. `workflowType`
5. `workflowNo`
6. `subjectType`
7. `subjectNo`
8. `ownerUserId`
9. `traceId`
10. `keyword`
- List page MUST show notification summary.
- Detail page MUST keep admin detail page styling and MUST expose:
1. `View Approval` for `subjectType=APPROVAL_CASE`
2. `View Change Ticket` for `subjectType=CHANGE_TICKET`
3. `Close` only for active `CHANGE_POST_APPROVAL_FOLLOWUP`
4. `Recalc` for active timers
5. `Notifications` timeline block
- This phase MUST NOT add a dedicated SLA mock UI page.

## 9) Mock and Demo Contract
- MUST provide admin-only mock APIs for:
1. creating approval-timeout demo chains
2. creating emergency change follow-up demo chains
3. fast-forwarding active timers into expire path
- Mock APIs MUST reuse normal timer creation / recalc / expire logic; they MUST NOT invent mock-only timer states.
- A repeatable smoke/demo script MUST be provided for local stack verification.

## 10) RBAC Baseline
- SLA permission groups MUST include:
1. `GOV_SLA_READ`
2. `GOV_SLA_WRITE`
- SLA role matrix MUST be:
1. `TECH_ADMIN / CISO / COMPLIANCE_LEAD / MLRO / DPO / RI / SM` -> `GOV_SLA_READ`
2. `TECH_ADMIN / CISO / COMPLIANCE_LEAD` -> `GOV_SLA_WRITE`
3. `OPS_TREASURY / FINANCE` -> no SLA timer access in this phase
4. `SUPER_ADMIN` -> all permissions

## 11) Delivery Checklist
- Prisma migration added for `sla_notifications`.
- Approval timeout creation/recalc/expire verified with tests.
- Emergency change follow-up creation/recalc/close verified with tests.
- `Governance Center -> SLA Timers` list/detail pages verified, including notification summary and timeline.
- Demo smoke script provided and repeatable against local stack.
- RBAC sync updates new SLA routes into active roles.
