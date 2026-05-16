# Transaction Limit Change Workflow Refactoring Design

> **Status:** Draft | **Author:** Claude | **Date:** 2026-05-16
> **Scope:** V3 MVP | **Domain:** Compliance / Transaction Controls

---

## 1. Goal

Refactor the existing Transaction Limit Change workflow from the entity-mutation pattern (where `TransactionLimitPolicy.status` is set to `PENDING_APPROVAL` during approval) to the request-record pattern (where a dedicated `TransactionLimitChangeRequest` row tracks the change lifecycle while the policy stays `ACTIVE`). This follows the `RoleDefinitionModifyWorkflowService` pattern exactly.

---

## 2. Current vs Target Pattern

| Dimension | Current (entity-mutation) | Target (request-record) |
|-----------|--------------------------|------------------------|
| Where proposed data lives | JSON in `ApprovalCase.objectSnapshot` | Typed columns in `TransactionLimitChangeRequest` |
| Main entity during approval | `status → PENDING_APPROVAL` | Unchanged (`ACTIVE`) |
| `entityRef` in ApprovalCase | `TransactionLimitPolicy.id` | `TransactionLimitChangeRequest.id` |
| Conflict detection on execute | None | Yes (snapshot vs current) |
| Rejection side-effect | Reset policy `status → ACTIVE` | Only update request `status → REJECTED` |
| History of changes | Only in audit logs | Request records preserve full history |

---

## 3. New Prisma Model

```prisma
model TransactionLimitChangeRequest {
  id                String    @id @default(cuid())
  requestNo         String    @unique
  policyId          String
  policyNo          String
  currentAmount     Decimal
  proposedAmount    Decimal
  changeReason      String
  status            String    @default("PENDING_APPROVAL")
  requestedByUserId String
  approvalCaseId    String?
  approvalCaseNo    String?
  executedAt        DateTime?
  failureReason     String?
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@index([policyId, status])
}
```

**requestNo format:** `TLC-NNN` (zero-padded 3 digits, auto-increment like `TLP-NNN`).

**Status values:** `PENDING_APPROVAL` → `APPROVED` / `REJECTED` / `CANCELLED`

---

## 4. Lifecycle

```
Admin submits POST /admin/transaction-limit-policies/:policyNo/change
       |
       v
 Validate: policy exists and is ACTIVE
 Validate: no existing PENDING_APPROVAL request for same policyId
 Snapshot: currentAmount = policy.limitAmount
       |
       v
 INSERT TransactionLimitChangeRequest (status = PENDING_APPROVAL)
 Create ApprovalCase (entityRef = request.id, MLRO → SMO, 48h)
   - on failure: delete request row (rollback)
 Link approvalCaseId/No back to request
 Audit: CHANGE_REQUESTED
       |
       +-- Approved → executeChange():
       |     1. Load request, verify status = PENDING_APPROVAL
       |     2. Conflict check: request.currentAmount == policy.limitAmount?
       |        - NO → mark request APPROVED + failureReason, audit CHANGE_APPLY_FAILED
       |        - YES → update policy.limitAmount = proposedAmount
       |                 mark request APPROVED + executedAt
       |                 audit CHANGE_APPLIED
       |     3. markExecutionResult()
       |
       +-- Rejected/Expired → cancelChange():
       |     1. Update request.status = REJECTED or CANCELLED
       |     2. Audit CHANGE_CANCELLED
```

**Key behaviors:**
- `TransactionLimitPolicy.status` is **never modified** by the Change workflow
- The policy stays `ACTIVE` throughout the approval process
- Conflict detection prevents silent overwrites when another change was applied between submission and approval
- Request records are never physically deleted — they form an auditable history

---

## 5. API Design

### 5.1 New Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/transaction-limit-policies/:policyNo/change` | Submit a limit change request |

**Request body:**
```json
{
  "limitAmount": 200000,
  "changeReason": "Increase monthly withdrawal cap for premium tier"
}
```

**Response (201):**
```json
{
  "requestNo": "TLC-001",
  "policyNo": "TLP-003",
  "approvalNo": "APR2605161234",
  "status": "PENDING_APPROVAL"
}
```

**Error cases:**
- 404: Policy not found
- 400: limitAmount <= 0 or same as current
- 409: A pending change request already exists for this policy

### 5.2 Removed Endpoint

| Method | Path | Note |
|--------|------|------|
| ~~PATCH~~ | ~~`/admin/transaction-limit-policies/:policyNo`~~ | Removed (replaced by POST .../change) |

---

## 6. Approval Configuration

Reuse existing `ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE` and its MLRO → SMO policy. No new action type needed.

---

## 7. Audit Logging

Reuse existing `AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE` actions:
- `CHANGE_REQUESTED` — admin submits
- `CHANGE_APPLIED` — approval callback activates change
- `CHANGE_APPLY_FAILED` — conflict detection fails or DB error
- `CHANGE_CANCELLED` — rejected or expired

### Field conventions (changed from current)

| Field | Current value | New value |
|-------|--------------|-----------|
| `entityId` | `policy.id` | `request.id` |
| `entityNo` | `policyNo` | `requestNo` |
| `metadata.policyNo` | — | Include `policyNo` in metadata |
| `metadata.policyId` | — | Include `policyId` in metadata |

The `entityType` stays `TRANSACTION_LIMIT_POLICY` (the business domain hasn't changed).

---

## 8. Frontend Changes

### 8.1 TransactionLimitDetail Page

The existing "Edit Limit" modal currently calls `PATCH /admin/transaction-limit-policies/:policyNo`. Change to:
- API call: `POST /admin/transaction-limit-policies/${policyNo}/change`
- Request body: `{ limitAmount, changeReason }` (same fields)
- Success response now includes `requestNo` — show in toast: "Change submitted — approval {approvalNo}"
- Remove the check that disables the button when `policy.status === 'PENDING_APPROVAL'` (policy never enters that state from Change anymore; only Creation uses it)

### 8.2 TransactionLimitList Page

No changes needed. The list shows policies (always ACTIVE after creation completes), not change requests.

---

## 9. Backend Architecture

### 9.1 New Files

| File | Responsibility |
|------|---------------|
| (none — rewrite existing) | |

### 9.2 Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `TransactionLimitChangeRequest` model |
| `transaction-limit-change-workflow.service.ts` | Full rewrite: request-record pattern |
| `transaction-limits.service.ts` | Add `generateNextRequestNo()`, remove `setStatus()` usage for change |
| `transaction-limits.controller.ts` | Replace `PATCH /:policyNo` with `POST /:policyNo/change` |
| `dto/update-limit.dto.ts` | Rename/adjust (or create new `change-limit.dto.ts`) |
| Detail page (`TransactionLimitDetail.tsx`) | Change API call from PATCH to POST .../change |

### 9.3 Workflow Service Rewrite

The `TransactionLimitChangeWorkflowService` is rewritten to follow `RoleDefinitionModifyWorkflowService`:

```typescript
async requestChange(policyNo, dto, actor) {
  // 1. Find policy, verify ACTIVE
  // 2. Check no pending request for same policyId
  // 3. Generate requestNo (TLC-NNN)
  // 4. INSERT TransactionLimitChangeRequest (status = PENDING_APPROVAL)
  // 5. createAndSubmit ApprovalCase (entityRef = request.id)
  //    - on failure: delete request row
  // 6. Update request with approvalCaseId/No
  // 7. Audit CHANGE_REQUESTED
  // 8. Return { requestNo, policyNo, approvalNo, status }
}

@OnEvent(SECONDARY_EVENT)
async onDecided(event) {
  if (event.decision === 'APPROVED') → executeChange()
  else → cancelChange()
}

async executeChange(approvalId, requestId, event) {
  // 1. Load request, verify PENDING_APPROVAL
  // 2. Load policy by policyId
  // 3. Conflict check: request.currentAmount == policy.limitAmount
  //    - If mismatch: mark request APPROVED + failureReason, audit FAILED, markExecutionResult(false)
  // 4. Update policy.limitAmount = request.proposedAmount (NO status change)
  // 5. Mark request status = APPROVED, executedAt = now()
  // 6. markExecutionResult(true)
  // 7. Audit CHANGE_APPLIED
}

async cancelChange(approvalId, requestId, decision, event) {
  // 1. Load request
  // 2. Update status = REJECTED or CANCELLED
  // 3. Audit CHANGE_CANCELLED
}
```

---

## 10. Migration Strategy

Since this is a full rewrite of the Change workflow:
1. Add new `TransactionLimitChangeRequest` table via Prisma migration
2. Remove `approvalCaseId` from `TransactionLimitPolicy` if no longer used by any workflow
   - **Note:** The Creation workflow still uses `approvalCaseId` on the policy row. Keep the column.
3. Existing pending approvals (if any) for `TRANSACTION_LIMIT_CHANGE` will need manual resolution or can be let to expire naturally (48h timeout)

---

## 11. Scope

### In Scope

| Deliverable | Description |
|-------------|-------------|
| Prisma model | `TransactionLimitChangeRequest` |
| DB migration | Add new table |
| Workflow rewrite | Full rewrite of `TransactionLimitChangeWorkflowService` |
| Controller change | Replace PATCH with POST .../change |
| DTO | New or adjusted DTO for change request |
| Frontend detail page | Update API call |
| Conflict detection | currentAmount snapshot vs actual on execute |

### Out of Scope

| Item | Reason |
|------|--------|
| Change requests list/detail API | Explicitly deferred |
| Change requests admin page | Not needed without API |
| TransactionLimitPolicy.setStatus removal | Other workflows may use it |
