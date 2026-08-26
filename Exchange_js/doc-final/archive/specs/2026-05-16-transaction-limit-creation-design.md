# Transaction Limit Policy Creation Workflow Design

> **Status:** Draft | **Author:** Claude | **Date:** 2026-05-16
> **Scope:** V3 MVP | **Domain:** Compliance / Transaction Controls

---

## 1. Goal

Allow admins to create new `TransactionLimitPolicy` rows (expanding the limit matrix beyond the initial 4-row seed) with MLRO → SMO two-step approval. Follows the same creation pattern as `RoleDefinitionCreateWorkflowService`: insert the entity in `PENDING_APPROVAL` status, activate on approval, physically delete on rejection.

---

## 2. Lifecycle

```
Admin submits creation request (tradingTier + operationType + period + limitAmount + reason)
       |
       v
 Validate: fields against enum whitelists
 Validate: no existing row for [tradingTier, operationType, period] combo
       |
       v
 INSERT TransactionLimitPolicy (status = PENDING_APPROVAL, auto-generate policyNo)
 Create ApprovalCase (MLRO → SMO, 48h timeout)
 Write audit: CREATION_REQUESTED
       |
       +-- Approved → status = ACTIVE → audit CREATION_APPLIED → policy active
       +-- Rejected/Expired → physically DELETE row → audit CREATION_CANCELLED
```

**Comparison with Change workflow:**

| Aspect | Creation | Change (current) |
|--------|----------|-----------------|
| On submit | INSERT new row `PENDING_APPROVAL` | Existing row → `PENDING_APPROVAL` |
| On approval | → `ACTIVE` | Update `limitAmount` → `ACTIVE` |
| On rejection | **Physical delete** | Restore `ACTIVE` (original value) |
| Runtime | `PENDING_APPROVAL` rows excluded from limit checks | Uses original `limitAmount` during approval |

---

## 3. Field Validation

All three dimension fields are validated against code-level whitelists (constants). Adding new values requires a code change and deployment.

```typescript
// src/modules/governance/transaction-limits/constants/limit-policy.constants.ts

export const TRADING_TIERS = ['BASIC', 'PREMIUM'] as const;
export const OPERATION_TYPES = ['WITHDRAWAL', 'SWAP'] as const;
export const LIMIT_PERIODS = ['DAILY', 'MONTHLY'] as const;
```

| Field | Validation | Values |
|-------|-----------|--------|
| `tradingTier` | Enum whitelist | `BASIC`, `PREMIUM` |
| `operationType` | Enum whitelist | `WITHDRAWAL`, `SWAP` |
| `period` | Enum whitelist | `DAILY`, `MONTHLY` |
| `limitAmount` | > 0, Decimal | AED-denominated |
| `reason` | Non-empty string | Free text |

**Unique constraint:** The composite `@@unique([tradingTier, operationType, period])` on the Prisma model guarantees no duplicates. The workflow also pre-checks before INSERT to provide a clear error message.

---

## 4. policyNo Generation

Auto-increment format: `TLP-NNN` (zero-padded 3 digits).

Algorithm: query `MAX(policyNo)` from `TransactionLimitPolicy` table, parse numeric suffix, increment by 1. If table is empty, start at `TLP-001`.

---

## 5. Backend Architecture

### 5.1 New Files

| File | Responsibility |
|------|---------------|
| `constants/limit-policy.constants.ts` | Enum whitelists for tradingTier, operationType, period |
| `dto/create-limit-policy.dto.ts` | `CreateLimitPolicyDto` with validators |
| `transaction-limit-creation-workflow.service.ts` | Orchestration: validate → INSERT → approval → audit |
| `transaction-limit-creation-approval.service.ts` | Extends `ApprovalHandlerBase`, routes decided events |

### 5.2 Modified Files

| File | Change |
|------|--------|
| `transaction-limits.service.ts` | Add `create()`, `deleteById()`, `generateNextPolicyNo()` methods |
| `transaction-limits.controller.ts` | Add `POST /admin/transaction-limit-policies` endpoint |
| `transaction-limits.module.ts` | Register new services |
| `audit-actions.constant.ts` | Add `TRANSACTION_LIMIT_CREATION` workflow type + actions |
| `approval.constants.ts` | Add `TRANSACTION_LIMIT_CREATION` action type + policy entry |

### 5.3 Workflow Service Pattern

Follows `RoleDefinitionCreateWorkflowService` exactly:

```typescript
async initiateCreate(dto, actor) {
  // 1. Validate enum fields
  // 2. Check no existing row for combo
  // 3. Generate policyNo
  // 4. INSERT row with status = PENDING_APPROVAL
  // 5. createAndSubmit ApprovalCase
  //    - on failure: delete the inserted row (rollback)
  // 6. Update row with approvalCaseId
  // 7. Write audit CREATION_REQUESTED
  // 8. Return { policyNo, approvalNo, status }
}

@OnEvent(SECONDARY_EVENT)
async onDecided(event) {
  if (event.decision === 'APPROVED') → executeActivation()
  else → executeCancellation()
}

async executeActivation(approvalId, entityRef, event) {
  // 1. Find policy by id (entityRef), verify status = PENDING_APPROVAL
  // 2. Update status → ACTIVE, clear approvalCaseId
  // 3. markExecutionResult(true)
  // 4. Audit CREATION_APPLIED
}

async executeCancellation(approvalId, entityRef, decision, event) {
  // 1. Find policy by id (entityRef)
  // 2. Physical DELETE
  // 3. Audit CREATION_CANCELLED
}
```

---

## 6. API Design

### 6.1 New Endpoint

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/transaction-limit-policies` | Create new policy (requires approval) |

**Request body:**
```json
{
  "tradingTier": "PREMIUM",
  "operationType": "WITHDRAWAL",
  "period": "MONTHLY",
  "limitAmount": 500000,
  "reason": "Add monthly withdrawal limit for premium tier"
}
```

**Response (201):**
```json
{
  "policyNo": "TLP-005",
  "approvalNo": "APR2605161234",
  "status": "PENDING_APPROVAL"
}
```

**Error cases:**
- 400: Invalid enum value / missing fields / limitAmount <= 0
- 409: Policy for this [tradingTier, operationType, period] combo already exists

---

## 7. Approval Configuration

```typescript
ApprovalActionTypes.TRANSACTION_LIMIT_CREATION = 'TRANSACTION_LIMIT_CREATION';

// Reuse MLRO → SMO pattern, 48h timeout
DEFAULT_APPROVAL_POLICIES[ApprovalActionTypes.TRANSACTION_LIMIT_CREATION] = {
  steps: [
    { stepNo: 1, roles: ['MLRO'] },
    { stepNo: 2, roles: ['SMO'] },
  ],
  timeoutHours: 48,
};
```

---

## 8. Audit Logging

### 8.1 Enum Registrations

- `AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION`
- `AuditGovernanceActions.TRANSACTION_LIMIT_CREATION`:
  - `CREATION_REQUESTED` — Admin submits creation
  - `CREATION_APPLIED` — Approval callback activates policy
  - `CREATION_APPLY_FAILED` — Activation failed (e.g., DB error)
  - `CREATION_CANCELLED` — Rejected or expired, row deleted

### 8.2 Audit Events

| Stage | Action | Trigger | Method | metadata |
|-------|--------|---------|--------|----------|
| Submitted | `CREATION_REQUESTED` | Admin submits | `recordByActor` | policyNo, tradingTier, operationType, period, limitAmount, reason, approvalNo |
| Activated | `CREATION_APPLIED` | Approval callback | `recordSystem` | policyNo, tradingTier, operationType, period, limitAmount |
| Failed | `CREATION_APPLY_FAILED` | Callback error | `recordSystem` | policyNo, failureReason |
| Cancelled | `CREATION_CANCELLED` | Rejection/timeout | `recordSystem` | policyNo, decision |

### 8.3 Field Conventions

| Field | Value |
|-------|-------|
| `entityType` | `AuditEntityTypes.TRANSACTION_LIMIT_POLICY` (existing) |
| `workflowType` | `AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION` (new) |
| `entityId` | Policy record `id` |
| `entityNo` | `policyNo` |
| `sourcePlatform` | `ADMIN_API` (submit) / `SYSTEM` (callbacks) |

---

## 9. Admin UI

### 9.1 List Page Changes

Add "Create Policy" button to `TransactionLimitList` page header (right side, `workflowPrimary` style). Shown conditionally based on `TRANSACTION_LIMIT_POLICIES_WRITE` permission.

### 9.2 Create Policy Modal

**Header:** "Create Limit Policy"

**Body fields:**

| Field | Component | Options |
|-------|-----------|---------|
| Trading Tier | `<select>` | BASIC, PREMIUM |
| Operation Type | `<select>` | WITHDRAWAL, SWAP |
| Period | `<select>` | DAILY, MONTHLY |
| Limit Amount (AED) | `<input type="number">` | min=0.01 |
| Reason | `<textarea>` | required |

**Footer:** Cancel (`modalCancel`) / Submit (`modalConfirm`, `workflowPrimary`)

**On submit:** POST API → success toast with approvalNo (4s auto-dismiss) → close modal → refresh list

**Validation:**
- All fields required
- limitAmount > 0

### 9.3 Detail Page Adjustments

No changes needed. `PENDING_APPROVAL` rows already display correctly with amber status badge. The existing "Edit Limit" action button is already gated on `status === 'ACTIVE'`, so it won't show for pending creation rows.

---

## 10. Implementation Scope

### In Scope

| Deliverable | Description |
|-------------|-------------|
| Constants file | `limit-policy.constants.ts` with enum whitelists |
| DTO | `CreateLimitPolicyDto` |
| Domain service methods | `create()`, `deleteById()`, `generateNextPolicyNo()` |
| Workflow service | `TransactionLimitCreationWorkflowService` |
| Approval handler | `TransactionLimitCreationApprovalService` |
| API endpoint | `POST /admin/transaction-limit-policies` |
| Audit enums | `TRANSACTION_LIMIT_CREATION` workflow type + 4 actions |
| Approval config | `TRANSACTION_LIMIT_CREATION` action type + MLRO→SMO policy |
| Frontend | Create button + modal on list page |

### Out of Scope

| Item | Reason |
|------|--------|
| Change workflow refactoring | Separate task (switch to request-record pattern) |
| Runtime limit enforcement | V4+ |
| Customer-facing UI for limits | Separate ticket |
