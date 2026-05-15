# Asset Suspension Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow CISO-approved suspension and reactivation of assets, halting all business activity (deposit, withdrawal, swap) for a suspended asset, following the dual-workflow + approval pattern already used for admin user account suspension.

**Architecture:** Two separate workflow services (`AssetSuspensionWorkflowService`, `AssetReactivationWorkflowService`) each paired with an `ApprovalHandlerBase` subclass that bridges generic approval events to workflow-specific secondary events. Both delegate state changes to domain methods on `AssetsService`. Controller endpoints on `AssetListingController` accept `assetNo` path params.

**Tech Stack:** NestJS, Prisma, EventEmitter2, class-validator, class-transformer

**Spec:** `doc-final/superpowers/specs/2026-05-14-asset-suspension-workflow-design.md`

---

### Task 1: Prisma Schema — Add Suspension Fields to Asset Model

**Files:**
- Modify: `prisma/schema.prisma` (Asset model, around line 1260)

- [ ] **Step 1: Add four new fields to the Asset model**

Open `prisma/schema.prisma` and locate the Asset model (line ~1244). After the `withdrawalEnabled` field (line 1260), add the four new suspension fields:

```prisma
  suspendedAt                    DateTime?
  suspendReason                  String?
  preSuspendDepositEnabled       Boolean?
  preSuspendWithdrawalEnabled    Boolean?
```

The full field block around lines 1258–1264 should read:

```prisma
  depositEnabled                 Boolean                         @default(true)
  withdrawalEnabled              Boolean                         @default(true)
  suspendedAt                    DateTime?
  suspendReason                  String?
  preSuspendDepositEnabled       Boolean?
  preSuspendWithdrawalEnabled    Boolean?
  approvalCaseId                 String?
```

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add_asset_suspension_fields
```

Expected: Migration created and applied. No errors.

- [ ] **Step 3: Verify Prisma client regeneration**

Run:
```bash
cd Exchange_js && npx prisma generate
```

Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add suspension fields to Asset model (suspendedAt, suspendReason, preSuspend*)"
```

---

### Task 2: DTO Changes — Remove DISABLED, Add SUSPENDED, Create SuspendAssetDto

**Files:**
- Modify: `src/modules/asset-treasury/assets/dto/asset.dto.ts`
- Create: `src/modules/asset-treasury/assets/dto/suspend-asset.dto.ts`

- [ ] **Step 1: Update AssetStatus enum**

In `src/modules/asset-treasury/assets/dto/asset.dto.ts`, replace the `AssetStatus` enum:

**Before:**
```typescript
export enum AssetStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}
```

**After:**
```typescript
export enum AssetStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}
```

- [ ] **Step 2: Create SuspendAssetDto**

Create `src/modules/asset-treasury/assets/dto/suspend-asset.dto.ts`:

```typescript
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString } from 'class-validator';

export class SuspendAssetDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsNotEmpty()
  @IsString()
  reason!: string;
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -30
```

Expected: No type errors (or only pre-existing ones unrelated to these changes). If there are references to `AssetStatus.DISABLED` elsewhere, fix them by removing them or replacing with `AssetStatus.SUSPENDED` as contextually appropriate.

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/dto/asset.dto.ts src/modules/asset-treasury/assets/dto/suspend-asset.dto.ts
git commit -m "feat: replace DISABLED with SUSPENDED in AssetStatus, add SuspendAssetDto"
```

---

### Task 3: Approval Constants — Register Action Types and Policies

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add action types**

In `src/modules/governance/approvals/constants/approval.constants.ts`, after the `CUSTODIAN_WALLET_CREATE` entry in the `ApprovalActionTypes` object (line 60), add:

```typescript
  // ─── Asset Suspension (2026-05-14) ────
  ASSET_SUSPENSION: 'ASSET_SUSPENSION',
  ASSET_REACTIVATION: 'ASSET_REACTIVATION',
```

- [ ] **Step 2: Add approval policies**

After the `CUSTODIAN_WALLET_CREATE` policy entry (around line 370), add:

```typescript
  // ─── Asset Suspension (2026-05-14) ────
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

- [ ] **Step 3: Add to V1_APPROVAL_ACTION_TYPES**

In the `V1_APPROVAL_ACTION_TYPES` array (around line 389), add the two new types before the closing `]`:

```typescript
  ApprovalActionTypes.ASSET_SUSPENSION,
  ApprovalActionTypes.ASSET_REACTIVATION,
```

- [ ] **Step 4: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat: register ASSET_SUSPENSION and ASSET_REACTIVATION approval types with CISO/12h policy"
```

---

### Task 4: Audit Constants — Add Workflow Types and Governance Actions

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add to AuditBusinessWorkflowTypes**

In `AuditBusinessWorkflowTypes` (around line 164, after `TB_ACCOUNT_MANUAL_CREATE`), add:

```typescript
  // Asset Suspension (2026-05-14)
  ASSET_SUSPENSION: 'ASSET_SUSPENSION',
  ASSET_REACTIVATION: 'ASSET_REACTIVATION',
```

- [ ] **Step 2: Add governance action groups**

In `AuditGovernanceActions` (after the `WITHDRAWAL_ADDRESS_REGISTRATION` group, around line 606), add:

```typescript
  // Asset Suspension (2026-05-14)
  ASSET_SUSPENSION: {
    SUSPENSION_REQUESTED:  'SUSPENSION_REQUESTED',
    APPROVAL_GRANTED:      'APPROVAL_GRANTED',
    APPROVAL_DECLINED:     'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:    'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:      'APPROVAL_EXPIRED',
    ASSET_SUSPENDED:       'ASSET_SUSPENDED',
  },

  // Asset Reactivation (2026-05-14)
  ASSET_REACTIVATION: {
    REACTIVATION_REQUESTED: 'REACTIVATION_REQUESTED',
    APPROVAL_GRANTED:       'APPROVAL_GRANTED',
    APPROVAL_DECLINED:      'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:     'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:       'APPROVAL_EXPIRED',
    ASSET_REACTIVATED:      'ASSET_REACTIVATED',
  },
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat: add ASSET_SUSPENSION and ASSET_REACTIVATION audit workflow types and governance actions"
```

---

### Task 5: Domain Service — Add suspendAsset() and reactivateAsset()

**Files:**
- Modify: `src/modules/asset-treasury/assets/assets.service.ts`

- [ ] **Step 1: Add the Prisma import**

At the top of `assets.service.ts`, ensure the `Prisma` import includes transaction client support. The existing import already has `import { Prisma } from '@prisma/client';` — no change needed.

- [ ] **Step 2: Add suspendAsset method**

After the `changeStatus()` method (line ~133), add:

```typescript
  async suspendAsset(
    assetId: string,
    reason: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; assetNo: string | null; status: string }> {
    const client = tx || this.prisma;
    const asset = await (client as any).asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        assetNo: true,
        status: true,
        depositEnabled: true,
        withdrawalEnabled: true,
      },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.status === 'SUSPENDED') {
      return { id: asset.id, assetNo: asset.assetNo, status: asset.status };
    }

    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot suspend asset in status: ${asset.status}`,
      );
    }

    const updated = await (client as any).asset.update({
      where: { id: assetId },
      data: {
        status: 'SUSPENDED',
        suspendedAt: new Date(),
        suspendReason: reason,
        preSuspendDepositEnabled: asset.depositEnabled,
        preSuspendWithdrawalEnabled: asset.withdrawalEnabled,
        depositEnabled: false,
        withdrawalEnabled: false,
      },
      select: { id: true, assetNo: true, status: true },
    });

    return updated;
  }
```

- [ ] **Step 3: Add reactivateAsset method**

Immediately after `suspendAsset()`, add:

```typescript
  async reactivateAsset(
    assetId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; assetNo: string | null; status: string }> {
    const client = tx || this.prisma;
    const asset = await (client as any).asset.findUnique({
      where: { id: assetId },
      select: {
        id: true,
        assetNo: true,
        status: true,
        preSuspendDepositEnabled: true,
        preSuspendWithdrawalEnabled: true,
      },
    });
    if (!asset) throw new NotFoundException('Asset not found');

    if (asset.status !== 'SUSPENDED') {
      throw new BadRequestException(
        `Cannot reactivate asset in status: ${asset.status}`,
      );
    }

    const updated = await (client as any).asset.update({
      where: { id: assetId },
      data: {
        status: 'ACTIVE',
        suspendedAt: null,
        suspendReason: null,
        depositEnabled: asset.preSuspendDepositEnabled ?? true,
        withdrawalEnabled: asset.preSuspendWithdrawalEnabled ?? true,
        preSuspendDepositEnabled: null,
        preSuspendWithdrawalEnabled: null,
      },
      select: { id: true, assetNo: true, status: true },
    });

    return updated;
  }
```

- [ ] **Step 4: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/assets/assets.service.ts
git commit -m "feat: add suspendAsset() and reactivateAsset() domain methods to AssetsService"
```

---

### Task 6: Approval Handlers — Create ApprovalHandlerBase Subclasses

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-suspension-approval.service.ts`
- Create: `src/modules/asset-treasury/assets/asset-reactivation-approval.service.ts`

Each handler bridges the generic `governance.approval.*` events to the workflow-specific `workflow.asset-suspension.decided` / `workflow.asset-reactivation.decided` secondary events, and records audit logs for each approval lifecycle event (granted, declined, cancelled, expired).

- [ ] **Step 1: Create AssetSuspensionApprovalService**

Create `src/modules/asset-treasury/assets/asset-suspension-approval.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class AssetSuspensionApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ASSET_SUSPENSION;
  readonly workflowType = AuditBusinessWorkflowTypes.ASSET_SUSPENSION;
  readonly auditActions = {
    granted: AuditGovernanceActions.ASSET_SUSPENSION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ASSET_SUSPENSION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ASSET_SUSPENSION.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ASSET_SUSPENSION.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ASSET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Create AssetReactivationApprovalService**

Create `src/modules/asset-treasury/assets/asset-reactivation-approval.service.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class AssetReactivationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ASSET_REACTIVATION;
  readonly workflowType = AuditBusinessWorkflowTypes.ASSET_REACTIVATION;
  readonly auditActions = {
    granted: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ASSET_REACTIVATION.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ASSET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 3: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-suspension-approval.service.ts src/modules/asset-treasury/assets/asset-reactivation-approval.service.ts
git commit -m "feat: add approval handler bridges for asset suspension and reactivation"
```

---

### Task 7: Suspension Workflow Service

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts`

Mirrors `src/modules/identity/users/admin-suspension-workflow.service.ts`. The workflow:
1. Validates asset is ACTIVE with no pending suspension approval
2. Creates an approval case
3. On APPROVED event, calls `assetsService.suspendAsset()`
4. Records audit logs at each step

- [ ] **Step 1: Create the workflow service**

Create `src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts`:

```typescript
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AssetsService } from './assets.service';

const SECONDARY_EVENT = 'workflow.asset-suspension.decided';

@Injectable()
export class AssetSuspensionWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async requestSuspension(assetNo: string, reason: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }

    if (asset.status !== 'ACTIVE') {
      throw new ConflictException(
        `Asset ${assetNo} is not in ACTIVE status (current: ${asset.status})`,
      );
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_SUSPENSION,
        entityRef: asset.id,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending suspension approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ASSET_SUSPENSION,
        entityRef: asset.id,
        workflowType: AuditBusinessWorkflowTypes.ASSET_SUSPENSION,
        workflowId: asset.id,
        workflowNo: assetNo,
        traceId,
        objectSnapshot: {
          assetId: asset.id,
          assetNo,
          assetCode: asset.code,
          assetType: asset.type,
          network: asset.network,
          currentStatus: asset.status,
          depositEnabled: asset.depositEnabled,
          withdrawalEnabled: asset.withdrawalEnabled,
          reason,
        },
      },
      {
        reason,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_SUSPENSION.SUSPENSION_REQUESTED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_SUSPENSION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCode: asset.code,
          reason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_SUSPENSION_REQUESTED_${assetNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      assetNo,
      status: 'PENDING',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeSuspension(event);
    }
  }

  private async executeSuspension(event: ApprovalDecidedEvent) {
    try {
      const result = await this.assetsService.suspendAsset(
        event.entityRef,
        event.metadata?.reason || 'Approved suspension',
      );

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_SUSPENSION.ASSET_SUSPENDED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        entityNo: result.assetNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.ASSET_SUSPENSION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          suspendedByUserId: event.decisionByUserId,
          suspendedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_SUSPENSION_EXECUTED_${result.assetNo}`,
        sourcePlatform: 'ADMIN_API',
      });

      await this.approvalsService.markExecutionResult(
        event.approvalId,
        true,
        {
          actorType: 'ADMIN',
          userId: event.decisionByUserId || 'SYSTEM',
          userNo: event.decisionByUserNo || undefined,
          role: event.decisionByRole || 'SYSTEM',
          roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
        },
        'Asset suspended successfully',
      );
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_SUSPENSION.ASSET_SUSPENDED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ASSET_SUSPENSION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Suspension execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_SUSPENSION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      await this.approvalsService
        .markExecutionResult(
          event.approvalId,
          false,
          {
            actorType: 'ADMIN',
            userId: event.decisionByUserId || 'SYSTEM',
            userNo: event.decisionByUserNo || undefined,
            role: event.decisionByRole || 'SYSTEM',
            roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
          },
          error instanceof Error ? error.message : 'Suspension execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts
git commit -m "feat: add AssetSuspensionWorkflowService with approval-driven suspension execution"
```

---

### Task 8: Reactivation Workflow Service

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-reactivation-workflow.service.ts`

Mirrors `src/modules/identity/users/admin-reactivation-workflow.service.ts`. Validates asset is SUSPENDED, creates approval case, and on APPROVED calls `assetsService.reactivateAsset()`.

- [ ] **Step 1: Create the workflow service**

Create `src/modules/asset-treasury/assets/asset-reactivation-workflow.service.ts`:

```typescript
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ApprovalDecidedEvent } from '../../governance/approvals/approval-handler.base';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import { AssetsService } from './assets.service';

const SECONDARY_EVENT = 'workflow.asset-reactivation.decided';

@Injectable()
export class AssetReactivationWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetsService: AssetsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async requestReactivation(assetNo: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }

    if (asset.status !== 'SUSPENDED') {
      throw new ConflictException(
        `Asset ${assetNo} is not suspended (current: ${asset.status})`,
      );
    }

    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_REACTIVATION,
        entityRef: asset.id,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `A pending reactivation approval already exists: ${existingPending.approvalNo}`,
      );
    }

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ASSET_REACTIVATION,
        entityRef: asset.id,
        workflowType: AuditBusinessWorkflowTypes.ASSET_REACTIVATION,
        workflowId: asset.id,
        workflowNo: assetNo,
        traceId,
        objectSnapshot: {
          assetId: asset.id,
          assetNo,
          assetCode: asset.code,
          assetType: asset.type,
          network: asset.network,
          currentStatus: asset.status,
          suspendedAt: asset.suspendedAt,
          suspendReason: asset.suspendReason,
        },
      },
      {
        reason: `Reactivate suspended asset: ${asset.code}`,
        traceId,
      },
      actor,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_REACTIVATION.REACTIVATION_REQUESTED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_REACTIVATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCode: asset.code,
          suspendReason: asset.suspendReason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_REACTIVATION_REQUESTED_${assetNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      approvalNo: approvalCase.approvalNo,
      traceId,
      assetNo,
      status: 'PENDING',
    };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeReactivation(event);
    }
  }

  private async executeReactivation(event: ApprovalDecidedEvent) {
    try {
      const result = await this.assetsService.reactivateAsset(event.entityRef);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_REACTIVATION.ASSET_REACTIVATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        entityNo: result.assetNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.ASSET_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          reactivatedByUserId: event.decisionByUserId,
          reactivatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_REACTIVATION_EXECUTED_${result.assetNo}`,
        sourcePlatform: 'ADMIN_API',
      });

      await this.approvalsService.markExecutionResult(
        event.approvalId,
        true,
        {
          actorType: 'ADMIN',
          userId: event.decisionByUserId || 'SYSTEM',
          userNo: event.decisionByUserNo || undefined,
          role: event.decisionByRole || 'SYSTEM',
          roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
        },
        'Asset reactivated successfully',
      );
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_REACTIVATION.ASSET_REACTIVATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ASSET_REACTIVATION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Reactivation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_REACTIVATION_EXEC_FAILED_${event.entityRef}`,
        sourcePlatform: 'ADMIN_API',
      });

      await this.approvalsService
        .markExecutionResult(
          event.approvalId,
          false,
          {
            actorType: 'ADMIN',
            userId: event.decisionByUserId || 'SYSTEM',
            userNo: event.decisionByUserNo || undefined,
            role: event.decisionByRole || 'SYSTEM',
            roleCodes: event.decisionByRole ? [event.decisionByRole] : [],
          },
          error instanceof Error ? error.message : 'Reactivation execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-reactivation-workflow.service.ts
git commit -m "feat: add AssetReactivationWorkflowService with approval-driven reactivation execution"
```

---

### Task 9: Controller Endpoints — Suspend and Reactivate

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-listing.controller.ts`

Add two new endpoints to the existing controller. Both use the existing `ensureAdmin()` and `buildAdminActor()` helpers.

- [ ] **Step 1: Add imports and inject workflow services**

At the top of `asset-listing.controller.ts`, add:

```typescript
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { SuspendAssetDto } from './dto/suspend-asset.dto';
```

Update the constructor to inject the two new services:

**Before:**
```typescript
export class AssetListingController {
  constructor(
    private readonly workflowService: AssetListingWorkflowService,
  ) {}
```

**After:**
```typescript
export class AssetListingController {
  constructor(
    private readonly workflowService: AssetListingWorkflowService,
    private readonly suspensionWorkflow: AssetSuspensionWorkflowService,
    private readonly reactivationWorkflow: AssetReactivationWorkflowService,
  ) {}
```

- [ ] **Step 2: Add suspend endpoint**

After the `activateAsset()` method, add:

```typescript
  @Post(':assetNo/suspend')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/suspend'))
  async suspendAsset(
    @Param('assetNo') assetNo: string,
    @Body() dto: SuspendAssetDto,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.suspensionWorkflow.requestSuspension(
      assetNo,
      dto.reason,
      this.buildAdminActor(req),
    );
  }
```

- [ ] **Step 3: Add reactivate endpoint**

After the `suspendAsset()` method, add:

```typescript
  @Post(':assetNo/reactivate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/reactivate'))
  async reactivateAsset(
    @Param('assetNo') assetNo: string,
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.reactivationWorkflow.requestReactivation(
      assetNo,
      this.buildAdminActor(req),
    );
  }
```

Note: The `activateAsset` method already exists — do not confuse with `reactivateAsset`. The former transitions PROVISIONING→ACTIVE; the latter transitions SUSPENDED→ACTIVE.

- [ ] **Step 4: Verify build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing.controller.ts
git commit -m "feat: add POST :assetNo/suspend and :assetNo/reactivate endpoints to AssetListingController"
```

---

### Task 10: Module Registration — Wire Everything Up

**Files:**
- Modify: `src/modules/asset-treasury/assets/assets.module.ts`

Register the four new services (2 approval handlers + 2 workflow services) as providers.

- [ ] **Step 1: Add imports**

At the top of `assets.module.ts`, add:

```typescript
import { AssetSuspensionApprovalService } from './asset-suspension-approval.service';
import { AssetReactivationApprovalService } from './asset-reactivation-approval.service';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
```

- [ ] **Step 2: Register providers**

Update the `providers` array:

**Before:**
```typescript
  providers: [
    AssetsService,
    AssetListingWorkflowService,
    AssetListingApprovalService,
    AssetProvisioningService,
  ],
```

**After:**
```typescript
  providers: [
    AssetsService,
    AssetListingWorkflowService,
    AssetListingApprovalService,
    AssetProvisioningService,
    AssetSuspensionApprovalService,
    AssetReactivationApprovalService,
    AssetSuspensionWorkflowService,
    AssetReactivationWorkflowService,
  ],
```

- [ ] **Step 3: Verify full build**

Run:
```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -30
```

Expected: Clean build with no new errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/assets.module.ts
git commit -m "feat: register asset suspension/reactivation approval handlers and workflow services in AssetsModule"
```

---

### Task 11: Smoke Test — Start Server and Verify Endpoints

**Files:** None (verification only)

- [ ] **Step 1: Start the backend server**

Run:
```bash
cd Exchange_js && npm run dev:start
```

Expected: Server starts on port 3500 without crashes. Check logs for any DI resolution errors.

- [ ] **Step 2: Verify endpoints are registered**

Check that the two new endpoints appear in the NestJS route table. Look for log output like:
```
Mapped {/admin/assets/:assetNo/suspend, POST} route
Mapped {/admin/assets/:assetNo/reactivate, POST} route
```

- [ ] **Step 3: Stop server**

```bash
cd Exchange_js && npm run dev:stop
```

- [ ] **Step 4: Final commit with all verification passing**

If any fixups were needed during verification, commit them:
```bash
git add -A
git commit -m "fix: address any build/runtime issues from asset suspension workflow"
```
