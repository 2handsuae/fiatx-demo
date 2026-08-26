# Transaction Limit Configuration Workflow Design

> **Status:** Draft | **Author:** Claude | **Date:** 2026-05-16
> **Scope:** V3 MVP | **Domain:** Compliance / Transaction Controls

---

## 1. Goal

Provide an admin-managed matrix of daily transaction limits keyed by **Trading Tier x Operation Type**, with changes gated by MLRO -> SMO two-step approval. This is a standalone Prisma model (not config-release versioning) because limits are a runtime gate-check (pass/fail), not a regulatory artifact requiring point-in-time traceability. Audit logs provide sufficient change history.

---

## 2. Key Concepts

### 2.1 Three Customer Dimensions

| Dimension | Values | Owner | Purpose |
|-----------|--------|-------|---------|
| **Trading Tier** | `BASIC`, `PREMIUM` | Customer-applied (upgrade request) | Determines which limit group applies |
| **Risk Level** | `LOW`, `MEDIUM`, `HIGH` | Platform-assigned (CDD process) | Monitoring intensity; can **veto** Trading Tier |
| **Sumsub Verification Level** | `1`, `2` | Sumsub callback | Records verification completion; auxiliary only |

**Relationships:**
- Risk Level can veto Trading Tier: `HIGH` risk -> cannot hold `PREMIUM` tier.
- Trading Tier determines applicable limit row.
- Sumsub Level is recorded but does not directly participate in limit checks.

### 2.2 Why Not Config-Release

Config-release versioning (used by PRICING_POLICY) exists for regulatory artifacts that require point-in-time snapshots for auditors. Transaction limits are an operational gate-check: the system only needs the *current* active value at transaction time. Change history is fully captured by audit logs (before/after values on every change). A standalone model is simpler and sufficient.

### 2.3 Why No Deposit Limits

Deposits cannot be enforced at the platform boundary:
- Fiat arrives at the VIBAN — the platform cannot reject an incoming bank transfer.
- Crypto arrives on-chain — the platform cannot prevent an incoming transaction.

Only **WITHDRAWAL** and **SWAP** are enforceable operations.

### 2.4 Why No Monthly Limits (Current Scope)

Starting with daily limits only. The `period` field is retained in the model for future extensibility — adding monthly limits requires only seeding new rows, no code changes.

### 2.5 Independent Limits Per Operation Type

Withdrawal and swap limits are independent and do not consume each other's quota. Rationale: swap (funds stay on platform) carries lower risk than withdrawal (funds leave platform), so operators need independent control over each.

---

## 3. Data Model

### 3.1 TransactionLimitPolicy (New Model)

```prisma
model TransactionLimitPolicy {
  id              String   @id @default(uuid())
  policyNo        String   @unique              // TLP-001, TLP-002, ...
  tradingTier     String                         // BASIC | PREMIUM
  operationType   String                         // WITHDRAWAL | SWAP
  period          String                         // DAILY (extensible)
  limitAmount     Decimal                        // AED-denominated
  status          String   @default("ACTIVE")    // ACTIVE | PENDING_APPROVAL
  approvalCaseId  String?                        // -> ApprovalCase
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([tradingTier, operationType, period])
}
```

### 3.2 Customer Model Additions

```prisma
// Add to existing Customer model:
tradingTier              String  @default("BASIC")    // BASIC | PREMIUM
riskLevel                String  @default("LOW")      // LOW | MEDIUM | HIGH
sumsubVerificationLevel  Int     @default(1)           // 1 | 2
```

### 3.3 Seed Data (4 Rows)

| policyNo | tradingTier | operationType | period | limitAmount (AED) |
|----------|-------------|---------------|--------|-------------------|
| TLP-001  | BASIC       | WITHDRAWAL    | DAILY  | 30,000            |
| TLP-002  | BASIC       | SWAP          | DAILY  | 100,000           |
| TLP-003  | PREMIUM     | WITHDRAWAL    | DAILY  | 150,000           |
| TLP-004  | PREMIUM     | SWAP          | DAILY  | 500,000           |

---

## 4. Workflow: Limit Policy Change

### 4.1 Flow

```
Admin proposes limitAmount change on a policy row
       |
       v
 Create ApprovalCase
 +-------------------------------+
 | type: TRANSACTION_LIMIT_CHANGE |
 | checkerRoles: MLRO -> SMO      |
 | timeoutHours: 48               |
 +-------------------------------+
       |
       +-- MLRO approves -> SMO approves -> new limitAmount written, status -> ACTIVE
       +-- Either rejects -> change cancelled, status -> ACTIVE (original value unchanged)
       +-- Timeout -> change cancelled, status -> ACTIVE (original value unchanged)
```

### 4.2 Change Semantics

- **Granularity:** One ApprovalCase per one policy row's limitAmount change.
- **During approval:** `status` = `PENDING_APPROVAL`; the **original** `limitAmount` continues to be enforced at runtime.
- **On approval:** Atomically update `limitAmount` to new value + set `status` = `ACTIVE` + write audit log.
- **On rejection/timeout:** Set `status` = `ACTIVE` (no amount change) + write audit log.

### 4.3 Approval Handler

Create `TransactionLimitChangeApprovalService` extending `ApprovalHandlerBase`, following the same pattern as `AdminRoleBindingChangeApprovalService`:
- Register handler for `TRANSACTION_LIMIT_CHANGE` approval type.
- On approval callback: update the policy row via the domain service (not direct Prisma write).
- On rejection/timeout callback: reset status via the domain service.

---

## 5. Runtime Limit Enforcement (V4+ Implementation, Design Now)

Two-layer check at transaction initiation:

```
Transaction Initiated (Withdrawal / Swap)
       |
       v
 Layer 1: Per-Transaction Amount Check (Asset model)
   Asset.minAmount <= amount <= Asset.maxAmount
       | PASS
       v
 Layer 2: Cumulative Daily Check (TransactionLimitPolicy)
   1. Look up customer.tradingTier
   2. Find TransactionLimitPolicy(tier, operationType, DAILY)
   3. SUM all completed same-type transactions today (using their lockedAedAmount)
   4. If sum + currentAmount > dailyLimit -> REJECT
       | PASS
       v
 Transaction Proceeds
```

**Exchange rate handling:** Each transaction records its AED equivalent at execution time (`lockedAedAmount`). Cumulative checks sum historical locked values; they do NOT re-convert at the current rate. This eliminates volatility risk in limit enforcement.

> Note: Layer 2 implementation is deferred to V4+. This spec defines the model and admin management; the runtime check will consume this model when built.

---

## 6. API Design

### 6.1 Admin API

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/admin/transaction-limit-policies` | List all policies. Query params: `tradingTier`, `operationType`, `skip`, `take` |
| `GET`  | `/admin/transaction-limit-policies/:policyNo` | Get single policy by business key |
| `PATCH` | `/admin/transaction-limit-policies/:policyNo` | Propose limitAmount change. Body: `{ limitAmount, changeReason }`. Creates ApprovalCase. |

**PATCH semantics:**
- Validates new `limitAmount` > 0.
- Rejects if policy is already `PENDING_APPROVAL` (one pending change at a time).
- Creates ApprovalCase, sets policy `status` = `PENDING_APPROVAL`, writes audit log.
- Returns `{ policyNo, approvalNo, message }`.

### 6.2 Customer API

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/customer/my/trading-limits` | Returns the limit rows matching the customer's current `tradingTier` |

---

## 7. Admin UI Pages

All pages follow `doc-final/rules/frontend-admin.md`.

### 7.1 List Page

**Route:** `/dashboard/system/transaction-limits`

**Layout:**
- PageTitleBar: "Transaction Limits" / "{total} policies - Daily Limits"
- Filter bar: tradingTier (All / BASIC / PREMIUM), operationType (All / WITHDRAWAL / SWAP)
- Table columns: Policy No | Trading Tier | Operation | Period | Limit (AED) | Status | Updated
- Standard Pagination footer
- Row click navigates to detail page

### 7.2 Detail Page

**Route:** `/dashboard/system/transaction-limits/:policyNo`

**Two-column layout (main + 272px sidebar):**

**Nav Header:**
- Back button: "Transaction Limits"
- Refresh button

**Main Body:**

| Section | Content |
|---------|---------|
| **Hero** (`bg-adm-card`) | policyNo in amber large mono; `AdminBadge` for tradingTier, operationType, period; status badge |
| **Core Context** | Current limitAmount (formatted AED with thousand separators); status with badge |

**Sidebar (272px):**

| Block | Content |
|-------|---------|
| **Actions** (conditional) | "Edit Limit" button (`workflowPrimary`) — shown only when `status === 'ACTIVE'` |
| **Identity Summary** | tradingTier, operationType, period |
| **Lifecycle** | createdAt, updatedAt |

**Per-entity Sidebar Fields registration:**

| Entity | Identity Summary fields | Lifecycle fields |
|--------|------------------------|------------------|
| **TransactionLimitPolicy** | `tradingTier`, `operationType`, `period` | `createdAt`, `updatedAt` |

### 7.3 Edit Limit Modal

Follows PlatformMemberDetailPage modal pattern:

- **Header:** "Edit Limit — {policyNo}"
- **Body:** Current value (read-only), new limitAmount input (number, AED), changeReason textarea
- **Footer:** Cancel (`modalCancel`) / Submit (`modalConfirm`, `workflowPrimary`)
- **On submit:** PATCH API -> success notice with approvalNo (4s auto-dismiss) -> close modal -> refresh detail
- **Validation:** New amount must be > 0, must differ from current value

---

## 8. Audit Logging

### 8.1 Responsibility Split

| Layer | Writer | Records |
|-------|--------|---------|
| **Approval layer** | `ApprovalHandlerBase` | Approval case flow: GRANTED / DECLINED / EXPIRED / CANCELLED |
| **Domain layer** | Workflow Service | Business entity changes: limit submitted / applied / failed / cancelled |

### 8.2 Domain Audit Events

**Workflow type:** `TRANSACTION_LIMIT_CHANGE`

| Stage | Action | Trigger | Method | metadata |
|-------|--------|---------|--------|----------|
| Change submitted | `CHANGE_REQUESTED` | Admin submits | `recordByActor` | policyNo, oldAmount, newAmount, approvalNo |
| Change applied | `CHANGE_APPLIED` | Approval callback | `recordSystem` | policyNo, oldAmount, newAmount, approvalNo |
| Apply failed | `CHANGE_APPLY_FAILED` | Callback write error | `recordSystem` | policyNo, failureReason |
| Change cancelled | `CHANGE_CANCELLED` | Rejection or timeout | `recordSystem` | policyNo, decision |

**Seed initialization:**

| Action | Trigger | Method | metadata |
|--------|---------|--------|----------|
| `LIMIT_POLICY_CREATED` | Seed script per row | `recordSystem` | policyNo, tradingTier, operationType, period, limitAmount |

### 8.3 Audit Field Conventions

Following established codebase patterns:

| Field | Value |
|-------|-------|
| `entityType` | `AuditEntityTypes.TRANSACTION_LIMIT_POLICY` (new) |
| `workflowType` | `AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE` (new) |
| `action` | `AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.<stage>` (new) |
| `entityId` | Policy record `id` |
| `entityNo` | `policyNo` (business key) |
| `traceId` | UUID generated at submission, threaded through approval callbacks |
| `requestId` | Deterministic: `TRANSACTION_LIMIT_CHANGE_<stage>_<policyNo>` |
| `sourcePlatform` | `ADMIN_API` (human-initiated) / `SYSTEM` (approval callbacks) |
| `result` | `AuditResult.SUCCESS` / `AuditResult.FAILED` |

### 8.4 Enum Registrations

**This round (implement):**
- `AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CHANGE`
- `AuditEntityTypes.TRANSACTION_LIMIT_POLICY`
- `AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE` (CHANGE_REQUESTED / CHANGE_APPLIED / CHANGE_APPLY_FAILED / CHANGE_CANCELLED / LIMIT_POLICY_CREATED)

**This round (register only, workflow deferred to next round):**
- `AuditBusinessWorkflowTypes.TRADING_TIER_UPGRADE`
- `CUSTOMER_RISK_LEVEL_CHANGED`
- `CUSTOMER_TRADING_TIER_CHANGED`
- `CUSTOMER_SUMSUB_LEVEL_CHANGED`

---

## 9. Implementation Scope

### 9.1 In Scope (V3)

| Deliverable | Description |
|-------------|-------------|
| Prisma model | `TransactionLimitPolicy` with migration |
| Customer fields | `tradingTier`, `riskLevel`, `sumsubVerificationLevel` added to Customer model |
| Seed script | 4 initial policy rows with audit logging |
| Workflow service | `TransactionLimitChangeWorkflowService` — submit, apply, fail, cancel |
| Approval handler | `TransactionLimitChangeApprovalService` extending `ApprovalHandlerBase` |
| Admin API | 3 endpoints: list, detail, propose change |
| Customer API | 1 endpoint: view current tier limits |
| Admin list page | `/dashboard/system/transaction-limits` |
| Admin detail page | `/dashboard/system/transaction-limits/:policyNo` with edit modal |
| Audit logging | Full lifecycle domain events + seed events |
| Enum registration | All audit enums including pre-registered future enums |

### 9.2 Out of Scope

| Item | Deferred to |
|------|-------------|
| Runtime limit enforcement (Layer 2 check) | V4+ |
| Trading Tier Upgrade workflow | Next round (separate roadmap entry) |
| Client-Web limit display UI | Separate ticket |
| Risk Level auto-adjustment logic | CDD integration |
| Limit approaching warning notifications | Future enhancement |
| Monthly period limits | Future seed (model ready) |

---

## 10. Roadmap Addition

Add the following entry to the roadmap as a standalone workflow:

> **Trading Tier Upgrade (交易层级升级审批):** Customer requests upgrade from BASIC to PREMIUM. Pre-check: `riskLevel != HIGH` (auto-reject if HIGH). Approval: MLRO -> SMO, timeoutHours: 48. On approval: `customer.tradingTier` = `PREMIUM`, customer subject to PREMIUM limit group. Audit events: `TRADING_TIER_UPGRADE_REQUESTED / APPROVED / REJECTED`.
