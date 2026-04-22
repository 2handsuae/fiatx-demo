# Approval Case
Wave: 1 | Source verified: prisma/schema.prisma, src/modules/governance/approvals/approvals.service.ts, src/modules/governance/approvals/approvals.controller.ts, src/modules/governance/approvals/constants/approval.constants.ts
Last Updated: 2026-04-21

## Prisma Model: ApprovalCase
Table: `approval_cases`
Business Key: `approvalNo` (prefix `APR-`, generated via `generateReferenceNo`)

### Fields
| Field | Type | Nullable | Notes |
|---|---|---|---|
| id | String (UUID) | No | PK |
| approvalNo | String | No | Unique business key, generated with `APR` prefix |
| actionType | String | No | See ApprovalActionTypes enum |
| entityRef | String | No | ID of the governed entity (FK by value, not DB constraint) |
| createdByUserId | String | No | Maker's user ID |
| createdByUserNo | String | Yes | Maker's human-readable user number |
| status | String | No | Default `DRAFT`; see ApprovalStatuses enum |
| executionStatus | String | No | Default `NOT_EXECUTED`; see ApprovalExecutionStatuses enum |
| riskLevel | String | No | Default `HIGH` |
| checkerRoles | String | No | CSV of eligible checker role codes |
| selectedCheckerRole | String | No | The role that ultimately signed or was pre-selected |
| allowCancel | Boolean | No | Default `true`; from policy |
| allowRetry | Boolean | No | Default `true`; from policy |
| docRef | String | Yes | Optional document reference |
| metadataJson | String | No | Default `{}`; arbitrary JSON metadata |
| traceId | String | No | UUID v4 trace identifier |
| workflowType | String | Yes | Parent workflow type (e.g. `ADMIN_MEMBER_PROVISIONING`) |
| workflowId | String | Yes | Parent entity ID |
| workflowNo | String | Yes | Parent entity business key |
| submittedAt | DateTime | Yes | When case moved DRAFT→PENDING |
| timeoutAt | DateTime | Yes | SLA deadline; computed from policy `timeoutHours` |
| decidedAt | DateTime | Yes | When final APPROVED/REJECTED/CANCELLED/EXPIRED decision recorded |
| executedAt | DateTime | Yes | When execution result was marked |
| decisionByUserId | String | Yes | Checker's user ID |
| decisionByUserNo | String | Yes | Checker's human-readable user number |
| decisionByRole | String | Yes | Role code under which the decision was made |
| decisionReason | String | Yes | Optional reason text |
| deletedAt | DateTime | Yes | Soft-delete timestamp |
| deletedBy | String | Yes | Soft-delete actor |
| deleteRequestId | String | Yes | DR that soft-deleted this record |
| deleteReason | String | Yes | Reason from the delete request |
| createdAt | DateTime | No | Auto timestamp |
| updatedAt | DateTime | No | Auto-updated timestamp |

### Related: ApprovalStep
Each `ApprovalCase` has one or more `ApprovalStep` records (table `approval_steps`).

| Field | Type | Notes |
|---|---|---|
| stepNo | Int | 1-based, unique per case |
| status | String | PENDING / APPROVED / REJECTED / EXPIRED / CANCELLED |
| checkerRoleCandidates | String | CSV of roles eligible for this step |
| decidedByUserId | String? | |
| decidedByUserNo | String? | |
| decidedByRole | String? | |
| reason | String? | |
| decidedAt | DateTime? | |

## Status Enum (ApprovalStatuses)
| Value | Meaning |
|---|---|
| DRAFT | Created but not yet submitted |
| PENDING | Submitted, awaiting checker decision; SLA timer active |
| APPROVED | All steps passed; awaiting execution |
| REJECTED | Any step rejected; all remaining steps cancelled |
| EXPIRED | SLA timeout triggered by scheduled job |
| CANCELLED | Withdrawn by maker (or SUPER_ADMIN) |

## Execution Status Enum (ApprovalExecutionStatuses)
| Value | Meaning |
|---|---|
| NOT_EXECUTED | Default; no execution attempt yet |
| EXECUTED | Downstream action completed successfully |
| EXECUTION_FAILED | Downstream action attempted but failed |

## Action Types (ApprovalActionTypes) — known as of 2026-04-21
| Value | Wave | Default checker roles | Timeout |
|---|---|---|---|
| AUDIT_EVIDENCE_EXPORT_APPROVAL | 1 | DPO, MLRO | 24 h |
| CASE_EVIDENCE_EXPORT_APPROVAL | 1 | DPO, MLRO | 24 h |
| CHANGE_TICKET_APPROVAL | 1 | CISO | 24 h |
| DELETE_REQUEST_APPROVAL | 1 | DPO, CISO | 24 h |
| ONBOARDING_FINAL_APPROVAL | 1 (legacy) | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 h |
| POOL_SETTLEMENT_BATCH_APPROVAL | 5+ | SENIOR_MANAGEMENT_OFFICER, TECH_OFFICER | 24 h |
| TREASURY_CROSS_POOL_TRANSFER_APPROVAL | 5+ | SENIOR_MANAGEMENT_OFFICER, TECH_OFFICER | 24 h |
| RISK_RATING_MEDIUM_APPROVAL | 3 | COMPLIANCE_OFFICER | 168 h |
| RISK_RATING_HIGH_APPROVAL | 3 | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 h |
| RISK_RATING_UPGRADE_PHASE1 | 3 | MLRO | 168 h |
| RISK_RATING_MAINTENANCE_APPROVAL | 3 | MLRO | 168 h |
| PEP_RELATIONSHIP_APPROVAL | 3 | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 h |
| RISK_RATING_MLRO_REVIEW | 3 | MLRO | 168 h |
| RISK_RATING_TIER_UPGRADE_APPROVAL | 3 | MLRO, SENIOR_MANAGEMENT_OFFICER | 240 h |

## Key Business Rules
- **Maker-checker SoD**: the user who created (`createdByUserId`) cannot also be the checker who approves/rejects, unless `SUPER_ADMIN` (controlled by `ApprovalSodRule.DENY_SAME_USER_MAKER_CHECKER`)
- **SUPER_ADMIN bypass**: SUPER_ADMIN can act as checker on any case, including their own; logged with `superAdminBypass: true` metadata
- **Single active case per entity**: creating a new case when a PENDING case already exists for the same `actionType + entityRef` is idempotent — the existing PENDING case is returned
- **Workflow locking**: for `CHANGE_TICKET_APPROVAL` and `DELETE_REQUEST_APPROVAL`, `workflowType/workflowId/workflowNo` are resolved from the parent entity and locked at creation; cannot be overridden by caller
- **Multi-step flow**: approval steps are created per checker role from the policy; all must pass for the case to reach APPROVED
- **Rejection is immediate**: rejecting any step immediately cancels all remaining PENDING steps and sets case to REJECTED
- **Expiration**: scheduled job calls `expirePendingApprovals()` which sets case to EXPIRED and cancels step 1
- **Deletion tracking**: soft-deleted via `deletedAt/deletedBy/deleteRequestId/deleteReason`; `findCaseOrThrow` treats `deletedAt != null` as not found
- **Policy storage**: default policies defined in `ApprovalActionPolicy` table (seeded from `DEFAULT_APPROVAL_POLICIES`); overridable at runtime via `ApprovalPolicyService`

## Service Methods (key operations)
- `create(dto, actor)` — creates DRAFT case; idempotent on existing PENDING
- `submit(id, dto, actor)` — DRAFT→PENDING; sets `timeoutAt` from policy; only maker can submit
- `approve(id, dto, actor)` — signs current pending step; if last step, case→APPROVED; dispatches `projectGovernanceApprovalDecision`
- `reject(id, dto, actor)` — signs current pending step as REJECTED; cancels all remaining steps; case→REJECTED
- `cancel(id, dto, actor)` — DRAFT or PENDING→CANCELLED; only maker or SUPER_ADMIN
- `markExecutionResult(approvalCaseId, success, actor)` — only on APPROVED cases; sets `executionStatus` to EXECUTED or EXECUTION_FAILED
- `requireApproved(input)` — gate assertion: throws ForbiddenException if case not in APPROVED status
- `createAndSubmit(createDto, submitDto, actor, client, options)` — atomic create+submit used by child workflows (change tickets, delete requests)
- `expirePendingApprovals()` — batch SLA timeout; processes up to 200 cases per run
- `list(query, actor)` — paginated listing; supports filter by `actionType`, `status`, `approvalNo`, `entityRef`, `traceId`, keyword

## API Endpoints
| Method | Path | Description |
|---|---|---|
| POST | /admin/control-gates/approvals | Create an approval case |
| POST | /admin/control-gates/approvals/:id/submit | Submit (DRAFT→PENDING) |
| POST | /admin/control-gates/approvals/:id/approve | Approve (checker decision) |
| POST | /admin/control-gates/approvals/:id/reject | Reject (checker decision) |
| POST | /admin/control-gates/approvals/:id/cancel | Cancel (maker or SUPER_ADMIN) |
| GET | /admin/control-gates/approvals/:id | Get approval case detail |
| GET | /admin/control-gates/approvals | List approval cases (paginated) |
