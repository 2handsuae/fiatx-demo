# Audit Trace Context Constraints

> **Scope:** governs how `audit_log_events` rows are populated, how `traceId` is generated and propagated, and how sequences are grouped.
> **Status:** binding. Every new service that writes `audit_log_events` MUST follow these rules.
> **Audience:** backend engineers adding or modifying audit writes.

---

## 1. Canonical fields for sequence grouping

`audit_log_events` has exactly two fields for linking rows into a sequence:

| Field | Role | Required? |
|---|---|---|
| `traceId` | The unique identifier for one business sequence. All rows belonging to the same sequence share this value. | Strongly recommended — include on every row unless there is no parent sequence at all |
| `workflowType` | The category label (`ONBOARDING`, `ADMIN_LOGIN_ACCESS`, `CHANGE_TICKET`, `APPROVAL`, ...). Used for dashboard category filters. | Required |

`workflowId` and `workflowNo` are **not** columns on `audit_log_events` — they were removed in `2026-04-08-audit-trace-context-and-onboarding-cleanup`. Parent-entity pointers (when needed) live in `metadata.parentEntityType`, `metadata.parentEntityId`, `metadata.parentEntityNo`.

---

## 2. Rules for generating `traceId`

**Rule 1 — Format.** `traceId` is always a raw UUID v4. No prefix, no business-field embedding. Generate via `randomUUID()` from `node:crypto`.

**Rule 2 — One trace per sequence.** Every business sequence (admin login attempt, onboarding run, change ticket workflow, evidence export request, ...) is identified by exactly one `traceId`. All audit rows in that sequence carry the same value.

**Rule 3 — Generate at the entry point.** The service that owns the primary entity of a sequence generates the `traceId` when the entity is first created (e.g. `ChangeTicketsService.createTicket` calls `randomUUID()` and assigns it to `change_tickets.traceId`). `auth.service` generates a fresh UUID at the start of every login attempt. Sub-actions never generate a new traceId; they always inherit.

**Rule 4 — Persist on the primary entity row.** Every entity type that represents a sequence has a `traceId` column and it is written at creation time:
- `change_tickets.traceId`
- `delete_requests.traceId`
- `approval_cases.traceId`
- `admin_user_invitations.traceId`
- `customer_main.onboardingTraceId` (single-purpose; only for the sumsub onboarding sequence)

**Rule 5 — Inherit to child actions.** When a child action runs as part of an existing sequence, it reads the parent entity's traceId and passes it through. The `approvals.service` reads the parent change ticket's `traceId` and stores it on the approval case. Access-control role changes read `binding.traceId` from the governance bridge. Evidence package audit rows read `approval.traceId`. `OnboardingService.handleSumsubVerificationEvent` reads `customer.onboardingTraceId`.

---

## 3. Rules for `workflowType`

**Rule 6 — Always set.** Every audit row MUST have a `workflowType` from `AuditWorkflowTypes` or `AuditBusinessWorkflowTypes`. Never null.

**Rule 7 — No derivation at write time.** Do not lazily derive workflowType from the action name. Pick the explicit constant.

**Rule 8 — Exactly one category per row.** If an action could be categorized two ways, pick the one closest to the operator's mental model. Cross-cutting actions belong to the parent workflow, not the child.

---

## 4. Rules for `metadata` (when used for parent pointers)

**Rule 9 — Parent pointer shape.** When an audit row represents a child action whose entity differs from the root sequence's primary entity (e.g. an approval case audit row whose `entityId = approval.id` but the sequence is owned by a change ticket), the row's `metadata` SHOULD include:

```ts
metadata: {
  parentEntityType: 'CHANGE_TICKET' | 'DELETE_REQUEST' | 'CUSTOMER' | ...,
  parentEntityId: '<uuid>',
  parentEntityNo: '<human-readable-no>',
  // ... other metadata ...
}
```

**Rule 10 — traceId alone is enough for sequence grouping.** Do not treat `metadata.parentEntityId` as a required join key. It's a UI convenience for "click through to parent". Sequence queries MUST use `WHERE traceId = X`.

---

## 5. Rules for `recordByActor` / `recordSystem` payloads

**Rule 11 — Always include `workflowType` and `traceId`.** A row without workflowType fails the writeside check. A row without traceId is permitted only for standalone non-sequence events (no example currently exists; this is a safety escape hatch).

**Rule 12 — Never set `workflowId` or `workflowNo`.** These fields were removed. If code is setting them, delete the lines.

**Rule 13 — Never propagate an `auditContext` object containing `workflowId` or `workflowNo`.** Service-to-service audit context propagation (e.g. the `InternalAuditContext` type in `access-control.service.ts` and `admin-invitations.service.ts`) must only carry `{ workflowType, traceId }`. Remove `workflowNo` from the type and all usages.

---

## 6. Examples — how the 8 completed wave-1 flows should look

| Flow | Who generates traceId | workflowType | entityId | Parent pointer in metadata? |
|---|---|---|---|---|
| Admin login | `auth.service.validateUser` — `randomUUID()` once per login attempt | `ADMIN_LOGIN_ACCESS` | `user.id` (or null on first failure) | No |
| Admin invitation | Inherited from the change ticket that governs the invitation | `ADMIN_MEMBER_PROVISIONING` | `user.id` | `{ parentEntityType: 'CHANGE_TICKET', parentEntityId: ticket.id, parentEntityNo: ticket.ticketNo }` |
| Admin role change | Inherited from `binding.traceId` (from change ticket) | `ADMIN_ROLE_BINDING_CHANGE` | `user.id` | Same as above |
| Change ticket create | `change-tickets.service.createTicket` — generates | Resolved from `changeType` | `ticket.id` | No |
| Delete request create | `delete-requests.service.createRequest` — generates | Resolved from `targetType` | `request.id` | No |
| Approval case create (wrapping a ticket) | Inherited from `ticket.traceId` | Resolved from `actionType` | `approval.id` | `{ parentEntityType: 'CHANGE_TICKET', parentEntityId: ticket.id, parentEntityNo: ticket.ticketNo }` |
| Evidence package export | Inherited from the approval's traceId | `AUDIT_EVIDENCE_EXPORT` | `package.id` | `{ parentEntityType: 'APPROVAL_CASE', parentEntityId: approval.id, parentEntityNo: approval.approvalNo }` |
| Customer onboarding (sumsub webhook) | `onboarding.service.startVerification` — generates, stores on `customer.onboardingTraceId` | `ONBOARDING` | `customer.id` | No |

---

## 7. Validation (enforced by `audit-logs.service`)

- `action` must match `/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/`
- `workflowType` must be non-empty (to be enforced after this cleanup; see deferred-refactors item 2)
- `traceId` must be a valid UUID v4 when set
- `MANUAL_OVERRIDE` triggerType requires non-empty `reason`
- State-transition rows require `statusFrom` and `statusTo`

---

## 8. Deferred
- Action-name prefix convention (deferred-refactors item 2) would let us drop `workflowType` entirely. Not yet.
- SWAP cross-trace joining (deferred-refactors item 1) would let us delete the historical workaround. Not yet.
