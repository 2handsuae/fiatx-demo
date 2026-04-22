# Approval Workflow
Wave: 1 | Source verified: approvals.service.ts, approval-policy.service.ts, approvals.controller.ts, constants/approval.constants.ts
Last Updated: 2026-04-21

## Purpose
Generic maker-checker gate: any governed action (change ticket, delete request, evidence export, risk rating, etc.) must pass through a PENDING→APPROVED case before the downstream executor may proceed.

## Actors
| Actor | Role |
|---|---|
| Maker (Admin) | Creates and submits the approval case; cannot be the checker |
| Checker (Admin) | Holds one of the configured `checkerRoles`; decides APPROVED or REJECTED |
| SUPER_ADMIN | Bypasses SoD restriction; can both create and decide (logged with `superAdminBypass: true`) |
| SYSTEM | Auto-expires cases that exceed `timeoutAt` |

## State Machine

### Case status (`ApprovalCase.status`)
| Status | Description | Valid Next States |
|---|---|---|
| DRAFT | Created but not yet submitted | PENDING, CANCELLED |
| PENDING | Awaiting checker decision; `timeoutAt` active | APPROVED, REJECTED, CANCELLED, EXPIRED |
| APPROVED | All steps approved; downstream may execute | — (terminal, except `executionStatus` changes) |
| REJECTED | Any step rejected; all remaining steps auto-CANCELLED | — (terminal) |
| EXPIRED | SLA timer swept past `timeoutAt` with no decision | — (terminal) |
| CANCELLED | Maker (or SUPER_ADMIN) withdrew before decision | — (terminal) |

### Case execution status (`ApprovalCase.executionStatus`)
| Status | Description |
|---|---|
| NOT_EXECUTED | Default; set when case first created |
| EXECUTED | Downstream reported success via `markExecutionResult` |
| EXECUTION_FAILED | Downstream reported failure via `markExecutionResult` |

### Step status (`ApprovalStep.status`)
| Status | Description |
|---|---|
| PENDING | Awaiting this step's checker |
| APPROVED | Step signed off; if last step, case → APPROVED |
| REJECTED | Step rejected; case immediately → REJECTED; remaining steps → CANCELLED |
| CANCELLED | Skipped because an earlier step was rejected, or maker cancelled |
| EXPIRED | SLA sweep expired the case while this step was PENDING |

## Flow
1. **Create (DRAFT)** — Maker calls `POST /admin/control-gates/approvals`. Service resolves `actionType` policy (checker roles, timeout, risk level). If an identical PENDING case already exists for `(actionType, entityRef)`, returns it as idempotent result instead of creating a duplicate. New case starts at DRAFT with `executionStatus = NOT_EXECUTED`.
2. **Submit (DRAFT → PENDING)** — Maker calls `POST /admin/control-gates/approvals/:id/submit`. Only the original maker (`createdByUserId`) may submit. Sets `submittedAt` and `timeoutAt = now + policy.timeoutHours * 3600 s`. Emits `governance.approval.submitted`.
3. **createAndSubmit shortcut** — Internal callers (change-ticket submit, delete-request submit) call `createAndSubmit()` which atomically creates + submits in a single DB transaction and emits side effects after commit.
4. **Approve (PENDING → PENDING or APPROVED)** — Checker calls `POST /admin/control-gates/approvals/:id/approve`. Service finds the first PENDING step the actor's roles can sign. If more steps remain, case stays PENDING. If last step, case moves to APPROVED. Fires `governance.approval.approved` and calls `projectGovernanceApprovalDecision` only on full APPROVED.
5. **Reject (PENDING → REJECTED)** — Checker calls `POST /admin/control-gates/approvals/:id/reject`. Current step → REJECTED; all remaining PENDING steps → CANCELLED; case → REJECTED immediately. Fires `governance.approval.rejected`.
6. **Cancel (DRAFT|PENDING → CANCELLED)** — Maker (or SUPER_ADMIN) calls `POST /admin/control-gates/approvals/:id/cancel`. Requires `policy.allowCancel = true`. Fires `governance.approval.cancelled`.
7. **Expire (PENDING → EXPIRED)** — SLA timer sweep calls `expirePendingApprovals()`. Sweeps up to 200 cases per run where `status = PENDING AND timeoutAt < now`. Fires `governance.approval.expired`.
8. **Mark execution result** — Downstream service calls `markExecutionResult(id, success, actor)` after consuming an APPROVED case. Sets `executionStatus` to EXECUTED or EXECUTION_FAILED. Only allowed on APPROVED cases.

## Key Rules
- **SoD (Segregation of Duties)**: By default, `createdByUserId === decidedByUserId` is forbidden (`DENY_SAME_USER_MAKER_CHECKER` SoD rule, DB-configured, defaults to `enabled = true`). SUPER_ADMIN role bypasses this check and is audit-logged with `superAdminBypass: true`.
- **Checker role resolution**: Actor's `roleCodes` must intersect `checkerRoles` from policy. SUPER_ADMIN sees all checker roles. If exactly one valid role exists it is auto-selected; if multiple, caller must explicitly pass `checkerRole`.
- **No duplicate PENDING cases**: Creating a case when one already exists for `(actionType, entityRef)` with `status = PENDING` is idempotent—the existing case is returned after trace/workflow consistency checks.
- **Multi-step support**: Policy can define multiple checker roles → one `ApprovalStep` per role in sequence; all steps must be APPROVED for the case to reach APPROVED.
- **Workflow binding**: For `CHANGE_TICKET_APPROVAL` and `DELETE_REQUEST_APPROVAL`, `workflowType/workflowId/workflowNo` are resolved from the parent entity and locked—they cannot be overridden by the API caller.
- **`requireApproved` guard**: Downstream consumers (CT consume, DR consume) call `requireApproved()` which throws `ForbiddenException` if the case is not in APPROVED status.
- **Cancellable only if policy allows**: `allowCancel` flag from `approvalActionPolicy` table (falls back to default policies). If `allowCancel = false`, cancellation throws `ForbiddenException`.

## Default Policies (from `approval.constants.ts`)
| actionType | checkerRoles | timeoutHours |
|---|---|---|
| AUDIT_EVIDENCE_EXPORT_APPROVAL | DPO, MLRO | 24 |
| CASE_EVIDENCE_EXPORT_APPROVAL | DPO, MLRO | 24 |
| CHANGE_TICKET_APPROVAL | CISO | 24 |
| DELETE_REQUEST_APPROVAL | DPO, CISO | 24 |
| ONBOARDING_FINAL_APPROVAL | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 |
| POOL_SETTLEMENT_BATCH_APPROVAL | SENIOR_MANAGEMENT_OFFICER, TECH_OFFICER | 24 |
| TREASURY_CROSS_POOL_TRANSFER_APPROVAL | SENIOR_MANAGEMENT_OFFICER, TECH_OFFICER | 24 |
| RISK_RATING_MEDIUM_APPROVAL | COMPLIANCE_OFFICER | 168 |
| RISK_RATING_HIGH_APPROVAL | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 |
| RISK_RATING_UPGRADE_PHASE1 | MLRO | 168 |
| RISK_RATING_MAINTENANCE_APPROVAL | MLRO | 168 |
| PEP_RELATIONSHIP_APPROVAL | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 |
| RISK_RATING_MLRO_REVIEW | MLRO | 168 |
| RISK_RATING_TIER_UPGRADE_APPROVAL | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 |

> Policy can be overridden per-row in `approvalActionPolicy` DB table.

## API Endpoints
| Method | Path | Actor | Description |
|---|---|---|---|
| POST | /admin/control-gates/approvals | Admin (Maker) | Create DRAFT approval case |
| POST | /admin/control-gates/approvals/:id/submit | Admin (Maker, creator only) | Submit DRAFT → PENDING |
| POST | /admin/control-gates/approvals/:id/approve | Admin (Checker) | Approve current step |
| POST | /admin/control-gates/approvals/:id/reject | Admin (Checker) | Reject current step → case REJECTED |
| POST | /admin/control-gates/approvals/:id/cancel | Admin (Maker or SUPER_ADMIN) | Cancel DRAFT or PENDING case |
| GET | /admin/control-gates/approvals/:id | Admin | Get case detail with steps |
| GET | /admin/control-gates/approvals | Admin | List cases (filter by actionType, status, approvalNo, entityRef, traceId, keyword) |
