# Asset Creation & Activation Workflow

## Goal

Redesign the asset lifecycle: remove the listing approval gate, make creation + TB provisioning a single direct step, batch-create customer TB accounts asynchronously, and add an activation approval workflow with readiness checks as the sole gate before an asset goes live.

## Context

The current flow has two gates: listing approval (PENDING_APPROVAL → approved → PROVISIONING) and manual activation (PROVISIONING → ACTIVE, no approval). This is backwards — the first gate is unnecessary (creating an asset is a configuration step with no risk), while the second gate lacks the approval that a go-live decision warrants.

**New flow: one gate, in the right place.**

Related workflows (already implemented, unchanged by this spec):
- **Asset Suspension** — ACTIVE → SUSPENDED (CISO approval)
- **Asset Reactivation** — SUSPENDED → ACTIVE (CISO approval)
- **Manual TB Account Creation** — admin fallback for missing TB accounts

## Scope

- Backend: refactor asset creation to skip approval, provision TB accounts directly
- Backend: batch customer TB account creation with backlog tracking
- Backend: new `ASSET_ACTIVATION` approval workflow with readiness checks
- Audit logging for creation and activation events
- Remove `PENDING_APPROVAL` status and `ASSET_LISTING` approval type

**Not in scope:** frontend changes (admin UI for new flow), customer notification, automatic swap pair management.

---

## 1. Asset Lifecycle (Simplified)

```
Admin creates asset
  → PROVISIONING (direct, no approval)
  → Admin configures wallets, bank accounts, fees
  → Admin submits activation request
  → CISO approves
  → ACTIVE
```

**States:**

| Status | Meaning |
|--------|---------|
| `PROVISIONING` | Asset created, TB accounts provisioned, awaiting operational setup and activation |
| `ACTIVE` | Asset is live, all business operations enabled |
| `SUSPENDED` | Temporarily halted (existing workflow, unchanged) |

**Removed:** `PENDING_APPROVAL` — no longer used.

---

## 2. Step 1: Create Asset + Provision

### 2.1 Endpoint

`POST /admin/assets/listing` (reuse existing path for backward compatibility).

Guarded by `AuthGuard('jwt')` + `AdminPermissionGuard`.

### 2.2 Request DTO

Reuse existing `SubmitAssetListingDto` unchanged:
- `code`, `type` (FIAT/CRYPTO), `network`, `decimals`, `contractAddress`
- `minDepositAmount`, `maxDepositAmount`, `minWithdrawAmount`, `maxWithdrawAmount`
- `depositEnabled`, `withdrawalEnabled`, `description`

### 2.3 Service Logic

Refactor `AssetListingWorkflowService.submitListing()`:

```
Input: SubmitAssetListingDto + actor context

Steps:
1. Validate uniqueness (type + code + network combination)
2. Create Asset record:
   - status = 'PROVISIONING'
   - Generate assetNo via generateReferenceNo('AS')
   - All DTO fields mapped
3. Provision TB system accounts (synchronous, within same transaction):
   a. Allocate tbLedgerId (MAX + 1, protected by unique constraint)
   b. Create BANK(1) or CUSTODY(10) — based on asset type FIAT/CRYPTO
   c. Create TRADE_CLEARING(110) — flags: 0
   d. Create FEE_RECEIVABLE(120) — flags: 0x04
4. Record audit: ASSET_CREATED_AND_PROVISIONED
5. Trigger async customer TB account batch creation (fire-and-forget event)
6. Return created asset with tbLedgerId
```

**Key change from current code:** Steps 1-4 happen in a single operation. No approval case is created. `AssetProvisioningService.provision()` is refactored to remove its internal status validation (the workflow service validates instead), then called from the workflow service for the TB account creation logic.

### 2.4 Audit Log

| Field | Value |
|-------|-------|
| action | `ASSET_CREATED_AND_PROVISIONED` |
| entityType | `ASSET` |
| workflowType | `ASSET_CREATION` |
| result | `SUCCESS` or `FAILED` |
| metadata | `{ assetCode, assetType, network, tbLedgerId, systemAccountsCreated: 3 }` |

---

## 3. Step 2: Customer TB Account Batch Creation

### 3.1 Trigger

After asset creation succeeds, emit an internal event:
```
Event: 'asset.provisioned'
Payload: { assetId, assetCode, tbLedgerId }
```

### 3.2 Batch Logic

`TbAccountBatchService` listens to the event:

```
Steps:
1. Query all customers where isCustomerApprovedAndActive() is true
   (onboardingStatus = 'APPROVED' AND adminStatus = 'ACTIVE')
2. For each customer:
   a. Check if CLIENT_CREDIT(100) already exists in TbAccountRegistry
      (code=100, ledger=tbLedgerId, ownerType='CUSTOMER', ownerUuid=customer.id)
   b. If not exists: create via AccountingService.createAccounts()
   c. Repeat for CLIENT_AUDIT(101)
   d. On failure: write to TbAccountBacklog with status=FAILED
3. Log summary: { total, succeeded, failed }
```

### 3.3 No Audit Log

Per previous design decision: automatic TB account creation does not write audit logs. The manual creation workflow (already implemented) handles audit for manual creates.

### 3.4 Backlog Model

New Prisma model `TbAccountBacklog`:

```prisma
model TbAccountBacklog {
  id          String   @id @default(uuid())
  assetCode   String
  ledger      Int
  customerId  String
  customerNo  String
  code        Int      // 100 or 101
  status      String   @default("FAILED") // FAILED, COMPLETED
  attempts    Int      @default(0)
  lastError   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([ledger, customerId, code])
  @@index([status])
  @@index([assetCode])
}
```

### 3.5 Retry

`TbAccountBatchService.retryFailed(assetCode?: string)`:

```
Steps:
1. Query TbAccountBacklog where status = 'FAILED' (optionally filtered by assetCode)
2. For each entry:
   a. Attempt to create TB account
   b. On success: update status = 'COMPLETED'
   c. On failure: increment attempts, update lastError, keep status = 'FAILED'
```

No admin endpoint for retry in this spec — the service method exists for future use (admin UI or cron job). Admins can use the manual TB account creation workflow as a fallback.

---

## 4. Step 3: Activation Approval Workflow

### 4.1 Endpoint

`POST /admin/assets/:assetNo/activate` (reuse existing path).

### 4.2 Readiness Checks

Before submitting the activation request, the system verifies:

| Check | Query | Error if fails |
|-------|-------|----------------|
| TB system accounts exist | `TbAccountRegistry` has entries for this asset's ledger with ownerType='SYSTEM' and codes 1 or 10, 110, 120 | "Asset has not been provisioned for TigerBeetle" |
| At least one active wallet | `Wallet` has at least one record with this `assetId` and `status='ACTIVE'` | "No active wallet configured for this asset" |

If any check fails, return `400 Bad Request` with the error message. No approval case is created.

### 4.3 Approval Type

New constant `ASSET_ACTIVATION` in `ApprovalActionTypes`.

**Policy:**

| Setting | Value |
|---------|-------|
| riskLevel | HIGH |
| steps | `[{ stepNo: 1, roles: ['CISO'] }]` |
| timeoutHours | 12 |
| allowCancel | true |
| allowRetry | false |

### 4.4 Workflow Service

New `AssetActivationWorkflowService`:

```
requestActivation(assetNo: string, actor: ApprovalActorContext):
  1. Find asset by assetNo, verify status = 'PROVISIONING'
  2. Check no pending ASSET_ACTIVATION approval exists for this asset
  3. Run readiness checks (Section 4.2)
  4. Create approval case via approvalsService.createAndSubmit()
     - actionType: ASSET_ACTIVATION
     - entityRef: assetId
     - objectSnapshot: { assetId, assetNo, code, type, network, tbLedgerId }
  5. Record audit: ACTIVATION_REQUESTED
  6. Return { approvalNo, assetNo, status: 'PENDING' }

@OnEvent('workflow.asset-activation.decided')
onDecided(event):
  if event.decision === 'APPROVED':
    executeActivation(event)

executeActivation(event):
  1. Update asset status: PROVISIONING → ACTIVE
  2. Mark execution result: success
  3. Record audit: ASSET_ACTIVATED
  On error:
    Mark execution result: failed
    Record audit: ACTIVATION_FAILED
```

### 4.5 Approval Handler

New `AssetActivationApprovalService` extending `ApprovalHandlerBase`:

| Property | Value |
|----------|-------|
| actionType | `ApprovalActionTypes.ASSET_ACTIVATION` |
| workflowType | `AuditBusinessWorkflowTypes.ASSET_ACTIVATION` |
| entityType | `AuditEntityTypes.ASSET` |
| auditActions.granted | `AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_GRANTED` |
| auditActions.declined | `AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_DECLINED` |
| auditActions.cancelled | `AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_CANCELLED` |
| auditActions.expired | `AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_EXPIRED` |

### 4.6 Audit Log

| Event | Action | workflowType |
|-------|--------|-------------|
| Activation requested | `ACTIVATION_REQUESTED` | `ASSET_ACTIVATION` |
| Approval granted/declined/cancelled/expired | (handled by ApprovalHandlerBase) | `ASSET_ACTIVATION` |
| Activation executed | `ASSET_ACTIVATED` | `ASSET_ACTIVATION` |
| Activation failed | `ACTIVATION_FAILED` | `ASSET_ACTIVATION` |

---

## 5. Changes to Existing Code

### 5.1 Files to Modify

| File | Change |
|------|--------|
| `asset-listing-workflow.service.ts` | Refactor `submitListing()`: remove approval creation, directly create asset + provision. Remove `executeCancellation()`. Remove `activateAsset()` (moved to new service). Remove `@OnEvent` handler for listing decision. |
| `asset-provisioning.service.ts` | Remove status validation (caller handles it). Or inline into workflow service. |
| `asset-listing.controller.ts` | `POST /listing` calls refactored `submitListing()`. `POST /:assetNo/activate` calls new `AssetActivationWorkflowService.requestActivation()`. |
| `dto/asset.dto.ts` | Remove `PENDING_APPROVAL` from `AssetStatus` enum. |
| `approval.constants.ts` | Remove `ASSET_LISTING` from `ApprovalActionTypes` and `DEFAULT_APPROVAL_POLICIES`. Add `ASSET_ACTIVATION`. |
| `audit-actions.constant.ts` | Remove/refactor `ASSET_LISTING` governance actions. Add `ASSET_CREATION` and `ASSET_ACTIVATION` governance actions. |
| `assets.module.ts` | Remove `AssetListingApprovalService`. Add `AssetActivationWorkflowService`, `AssetActivationApprovalService`, `TbAccountBatchService`. |
| `prisma/schema.prisma` | Add `TbAccountBacklog` model. |

### 5.2 Files to Delete

| File | Reason |
|------|--------|
| `asset-listing-approval.service.ts` | No longer needed — listing has no approval |

### 5.3 Files to Create

| File | Purpose |
|------|---------|
| `asset-activation-workflow.service.ts` | Readiness checks + activation approval flow |
| `asset-activation-approval.service.ts` | Approval handler for ASSET_ACTIVATION |
| `tb-account-batch.service.ts` (in `accounting/tigerbeetle/`) | Batch customer TB creation + backlog management |

---

## 6. Error Handling

| Error | HTTP | Message |
|-------|------|---------|
| Duplicate asset (type+code+network) | 409 | "Asset '{code}' on '{network}' already exists" |
| TB service unavailable during provision | 503 | "TigerBeetle service is currently unavailable" |
| Asset not in PROVISIONING for activation | 400 | "Asset must be in PROVISIONING status to activate" |
| Pending activation approval exists | 409 | "An activation request is already pending for this asset" |
| TB accounts not provisioned | 400 | "Asset has not been provisioned for TigerBeetle" |
| No active wallet | 400 | "No active wallet configured for this asset" |

---

## 7. Non-Goals

- Frontend UI changes (admin pages for new flow) — separate spec
- Customer notification on asset activation
- Automatic swap pair enablement on activation
- Backlog retry admin endpoint or cron job (service method exists, UI/trigger deferred)
- Approval workflow for asset creation (explicitly removed by design)
