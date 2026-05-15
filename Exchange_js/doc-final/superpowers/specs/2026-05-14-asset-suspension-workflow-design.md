# Asset Suspension Workflow — Design Spec

## Goal

Allow CISO-approved suspension and reactivation of assets, halting all business activity (deposit, withdrawal, swap) for a suspended asset. Follows the same dual-workflow + approval pattern as admin user account suspension.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Approval required | Yes, both suspend and reactivate | VARA compliance — asset lifecycle changes are high-risk |
| Approval role | CISO | Consistent with asset listing workflow |
| Approval timeout | 12 hours | Suspension may be time-sensitive (security incidents, regulatory orders) |
| Suspension scope | Full — deposit, withdrawal, swap all halted | VARA requires complete business halt for suspended assets |
| In-flight transactions | Allow completion | Avoid funds stuck in intermediate states; only new operations blocked |
| Architecture | Two separate workflow services | Matches admin-suspension / admin-reactivation pattern; single responsibility |
| Status during approval | Unchanged | Asset stays ACTIVE during suspension approval, SUSPENDED during reactivation approval |

---

## 1. Status Machine

Remove `DISABLED` from `AssetStatus`. New enum:

```
PENDING_APPROVAL → PROVISIONING → ACTIVE ⇄ SUSPENDED
```

Transitions:
- `ACTIVE → SUSPENDED`: executed after suspension approval granted
- `SUSPENDED → ACTIVE`: executed after reactivation approval granted

No status change during approval period — the ApprovalCase tracks the pending workflow.

---

## 2. Schema Changes

Add two nullable fields to the `Asset` model in Prisma:

```
suspendedAt                  DateTime?   // When suspension was executed
suspendReason                String?     // Reason provided by requesting admin
preSuspendDepositEnabled     Boolean?    // depositEnabled value before suspension
preSuspendWithdrawalEnabled  Boolean?    // withdrawalEnabled value before suspension
```

On suspension: set both fields, set `depositEnabled = false`, `withdrawalEnabled = false`. Save the pre-suspension values of `depositEnabled` and `withdrawalEnabled` into two new fields: `preSuspendDepositEnabled` (Boolean?) and `preSuspendWithdrawalEnabled` (Boolean?).
On reactivation: clear `suspendedAt`, `suspendReason`, restore `depositEnabled` and `withdrawalEnabled` from the saved pre-suspension values, then clear the `preSuspend*` fields.

Remove `DISABLED` from the `AssetStatus` enum in `dto/asset.dto.ts`.

---

## 3. Approval Configuration

### 3.1 Action Types

Add to `ApprovalActionTypes`:

```
ASSET_SUSPENSION: 'ASSET_SUSPENSION'
ASSET_REACTIVATION: 'ASSET_REACTIVATION'
```

### 3.2 Policies

Add to `DEFAULT_APPROVAL_POLICIES`:

```typescript
[ApprovalActionTypes.ASSET_SUSPENSION]: {
  riskLevel: ApprovalRiskLevels.HIGH,
  steps: [{ stepNo: 1, roles: ['CISO'] }],
  timeoutHours: 12,
  allowCancel: true,
  allowRetry: false,
},
[ApprovalActionTypes.ASSET_REACTIVATION]: {
  riskLevel: ApprovalRiskLevels.HIGH,
  steps: [{ stepNo: 1, roles: ['CISO'] }],
  timeoutHours: 12,
  allowCancel: true,
  allowRetry: false,
},
```

Add both to `V1_APPROVAL_ACTION_TYPES` for UI visibility.

---

## 4. Audit Actions

Add two new action groups to `AuditGovernanceActions`:

```typescript
ASSET_SUSPENSION: {
  SUSPENSION_REQUESTED:  'SUSPENSION_REQUESTED',
  APPROVAL_GRANTED:      'APPROVAL_GRANTED',
  APPROVAL_DECLINED:     'APPROVAL_DECLINED',
  APPROVAL_CANCELLED:    'APPROVAL_CANCELLED',
  APPROVAL_EXPIRED:      'APPROVAL_EXPIRED',
  ASSET_SUSPENDED:       'ASSET_SUSPENDED',
},
ASSET_REACTIVATION: {
  REACTIVATION_REQUESTED: 'REACTIVATION_REQUESTED',
  APPROVAL_GRANTED:       'APPROVAL_GRANTED',
  APPROVAL_DECLINED:      'APPROVAL_DECLINED',
  APPROVAL_CANCELLED:     'APPROVAL_CANCELLED',
  APPROVAL_EXPIRED:       'APPROVAL_EXPIRED',
  ASSET_REACTIVATED:      'ASSET_REACTIVATED',
},
```

---

## 5. Backend Changes

### 5.1 Domain Service: `AssetsService`

Add two methods to the existing service:

**`suspendAsset(id, reason, tx?)`**:
- Validate status is `ACTIVE`
- Save current `depositEnabled` → `preSuspendDepositEnabled`, `withdrawalEnabled` → `preSuspendWithdrawalEnabled`
- Update: `status = SUSPENDED`, `suspendedAt = now()`, `suspendReason = reason`, `depositEnabled = false`, `withdrawalEnabled = false`

**`reactivateAsset(id, tx?)`**:
- Validate status is `SUSPENDED`
- Restore `depositEnabled` from `preSuspendDepositEnabled`, `withdrawalEnabled` from `preSuspendWithdrawalEnabled`
- Clear: `suspendedAt = null`, `suspendReason = null`, `preSuspendDepositEnabled = null`, `preSuspendWithdrawalEnabled = null`
- Update: `status = ACTIVE`

### 5.2 Suspension Workflow: `AssetSuspensionWorkflowService`

Mirrors `admin-suspension-workflow.service.ts`.

**`requestSuspension(assetNo, reason, actor)`**:
1. Find asset by `assetNo`, verify status is `ACTIVE`
2. Check no pending `ASSET_SUSPENSION` approval exists for this asset
3. Create approval case: `actionType = ASSET_SUSPENSION`, `entityRef = asset.id`
4. Audit log: `ASSET_SUSPENSION.SUSPENSION_REQUESTED`
5. Return `{ approvalNo, status: 'PENDING' }`

**`@OnEvent('workflow.asset-suspension.decided')`**:
- `APPROVED` → call `executeSuspension()`
- `REJECTED` → audit log `APPROVAL_DECLINED`, no state change

**`executeSuspension(event)`**:
1. Call `assetsService.suspendAsset(asset.id, reason)`
2. Call `approvalsService.markExecutionResult()`
3. Audit log: `ASSET_SUSPENSION.ASSET_SUSPENDED`

### 5.3 Reactivation Workflow: `AssetReactivationWorkflowService`

Mirrors `admin-reactivation-workflow.service.ts`.

**`requestReactivation(assetNo, actor)`**:
1. Find asset by `assetNo`, verify status is `SUSPENDED`
2. Check no pending `ASSET_REACTIVATION` approval exists for this asset
3. Create approval case: `actionType = ASSET_REACTIVATION`, `entityRef = asset.id`
4. Audit log: `ASSET_REACTIVATION.REACTIVATION_REQUESTED`
5. Return `{ approvalNo, status: 'PENDING' }`

**`@OnEvent('workflow.asset-reactivation.decided')`**:
- `APPROVED` → call `executeReactivation()`
- `REJECTED` → audit log `APPROVAL_DECLINED`, no state change

**`executeReactivation(event)`**:
1. Call `assetsService.reactivateAsset(asset.id)`
2. Call `approvalsService.markExecutionResult()`
3. Audit log: `ASSET_REACTIVATION.ASSET_REACTIVATED`

### 5.4 DTO: `SuspendAssetDto`

```typescript
export class SuspendAssetDto {
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
```

Reactivation does not require a reason (no DTO needed, or empty DTO).

### 5.5 Controller Endpoints

Add to existing `AssetListingController`:

```
POST /admin/assets/:assetNo/suspend    → Body: SuspendAssetDto
POST /admin/assets/:assetNo/reactivate → No body
```

Both require permission guards and build `ApprovalActorContext` from request.

---

## 6. Business Interception

When an asset is `SUSPENDED` (`depositEnabled = false`, `withdrawalEnabled = false`):

- **Deposits**: existing `depositEnabled` check blocks new deposits
- **Withdrawals**: existing `withdrawalEnabled` check blocks new withdrawals
- **Swaps**: quote/execution logic must check asset status is not `SUSPENDED` for both source and target assets

In-flight transactions (already in processing pipeline) are allowed to complete.

---

## 7. Files to Create / Modify

| Action | File |
|--------|------|
| Create | `src/.../assets/asset-suspension-workflow.service.ts` |
| Create | `src/.../assets/asset-reactivation-workflow.service.ts` |
| Create | `src/.../assets/dto/suspend-asset.dto.ts` |
| Create | `prisma/migrations/YYYYMMDD_add_asset_suspension_fields/migration.sql` |
| Modify | `prisma/schema.prisma` — add `suspendedAt`, `suspendReason` to Asset |
| Modify | `src/.../assets/assets.service.ts` — add `suspendAsset()`, `reactivateAsset()` |
| Modify | `src/.../assets/asset-listing.controller.ts` — add suspend/reactivate endpoints |
| Modify | `src/.../assets/dto/asset.dto.ts` — remove `DISABLED`, add `SUSPENDED` |
| Modify | `src/.../approvals/constants/approval.constants.ts` — add action types + policies |
| Modify | `src/.../audit-logging/constants/audit-actions.constant.ts` — add audit action groups |
| Modify | `src/.../assets/assets.module.ts` — register new workflow services |

---

## 8. Out of Scope

- Admin frontend UI changes for suspend/reactivate buttons (separate task)
- Customer notification when asset is suspended
- Automatic swap pair management (disabling trading pairs)
- Emergency bypass channel (skip approval for urgent suspension)
