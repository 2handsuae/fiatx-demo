# Asset Creation & Activation Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign asset lifecycle — remove listing approval, direct create+provision, batch customer TB accounts, add activation approval with readiness checks.

**Architecture:** Refactor `AssetListingWorkflowService` to skip approval and directly create+provision assets. Add `TbAccountBatchService` for async customer TB account creation with backlog. Add `AssetActivationWorkflowService` + `AssetActivationApprovalService` for the activation approval gate with readiness checks.

**Tech Stack:** NestJS, Prisma, TigerBeetle, EventEmitter2

---

### Task 1: Add TbAccountBacklog Prisma model

**Files:**
- Modify: `prisma/schema.prisma` (after TbAccountRegistry model, around line 2734)

- [ ] **Step 1: Add the TbAccountBacklog model to schema.prisma**

Insert immediately after the closing `}` of the `TbAccountRegistry` model (line 2734, before the `TbTransferEvidence` model):

```prisma
model TbAccountBacklog {
  id          String   @id @default(uuid())
  assetCode   String
  ledger      Int
  customerId  String
  customerNo  String
  code        Int      // 100 (CLIENT_CREDIT) or 101 (CLIENT_AUDIT)
  status      String   @default("FAILED") // FAILED, COMPLETED
  attempts    Int      @default(0)
  lastError   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([ledger, customerId, code])
  @@index([status])
  @@index([assetCode])
  @@map("tb_account_backlog")
}
```

- [ ] **Step 2: Generate migration**

Run: `npx prisma migrate dev --name add_tb_account_backlog`
Expected: Migration created successfully

- [ ] **Step 3: Verify Prisma client**

Run: `npx prisma generate`
Expected: ✔ Generated Prisma Client

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add TbAccountBacklog model for batch TB account creation"
```

---

### Task 2: Update audit and approval constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/asset-treasury/assets/dto/asset.dto.ts`

- [ ] **Step 1: Add ASSET_CREATION and ASSET_ACTIVATION to AuditBusinessWorkflowTypes**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, find:

```typescript
  // Asset Listing (2026-05-11)
  ASSET_LISTING: 'ASSET_LISTING',
```

Add after the `ASSET_REACTIVATION` line (line 167):

```typescript
  // Asset Creation & Activation (2026-05-14)
  ASSET_CREATION: 'ASSET_CREATION',
  ASSET_ACTIVATION: 'ASSET_ACTIVATION',
```

- [ ] **Step 2: Add ASSET_CREATION governance actions**

In `AuditGovernanceActions`, add after the `ASSET_REACTIVATION` block (after line 629):

```typescript
  // Asset Creation (2026-05-14) — no approval, direct create+provision
  ASSET_CREATION: {
    ASSET_CREATED_AND_PROVISIONED: 'ASSET_CREATED_AND_PROVISIONED',
    ASSET_CREATION_FAILED:         'ASSET_CREATION_FAILED',
  },

  // Asset Activation (2026-05-14) — replaces ASSET_LISTING activation
  ASSET_ACTIVATION: {
    ACTIVATION_REQUESTED:  'ACTIVATION_REQUESTED',
    APPROVAL_GRANTED:      'APPROVAL_GRANTED',
    APPROVAL_DECLINED:     'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:    'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:      'APPROVAL_EXPIRED',
    ASSET_ACTIVATED:       'ASSET_ACTIVATED',
    ACTIVATION_FAILED:     'ACTIVATION_FAILED',
  },
```

- [ ] **Step 3: Add ASSET_ACTIVATION to ApprovalActionTypes**

In `src/modules/governance/approvals/constants/approval.constants.ts`, add after the `ASSET_REACTIVATION` line (line 63):

```typescript
  // ─── Asset Activation (2026-05-14) ────
  ASSET_ACTIVATION: 'ASSET_ACTIVATION',
```

- [ ] **Step 4: Add ASSET_ACTIVATION to DEFAULT_APPROVAL_POLICIES**

Add after the `ASSET_REACTIVATION` policy block (after line 388):

```typescript
  [ApprovalActionTypes.ASSET_ACTIVATION]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 12,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 5: Replace ASSET_LISTING with ASSET_ACTIVATION in V1_APPROVAL_ACTION_TYPES**

In the `V1_APPROVAL_ACTION_TYPES` array, replace:

```typescript
  ApprovalActionTypes.ASSET_LISTING,
```

with:

```typescript
  ApprovalActionTypes.ASSET_ACTIVATION,
```

- [ ] **Step 6: Remove PENDING_APPROVAL from AssetStatus enum**

In `src/modules/asset-treasury/assets/dto/asset.dto.ts`, change:

```typescript
export enum AssetStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}
```

to:

```typescript
export enum AssetStatus {
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
}
```

- [ ] **Step 7: Verify build**

Run: `npx nest build`
Expected: Build succeeds (no other code references `AssetStatus.PENDING_APPROVAL` — verify with grep first: `grep -rn "PENDING_APPROVAL" src/ --include="*.ts"` and fix any references)

- [ ] **Step 8: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/governance/approvals/constants/approval.constants.ts src/modules/asset-treasury/assets/dto/asset.dto.ts
git commit -m "feat(constants): add ASSET_CREATION and ASSET_ACTIVATION workflow constants, remove PENDING_APPROVAL"
```

---

### Task 3: Create TbAccountBatchService

**Files:**
- Create: `src/modules/accounting/tigerbeetle/tb-account-batch.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`

- [ ] **Step 1: Create TbAccountBatchService**

Create `src/modules/accounting/tigerbeetle/tb-account-batch.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { CreateTbAccountParams } from './types/accounting.types';

interface AssetProvisionedEvent {
  assetId: string;
  assetCode: string;
  tbLedgerId: number;
}

@Injectable()
export class TbAccountBatchService {
  private readonly logger = new Logger(TbAccountBatchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
    private readonly registryService: TbAccountRegistryService,
  ) {}

  @OnEvent('asset.provisioned', { async: true })
  async onAssetProvisioned(event: AssetProvisionedEvent): Promise<void> {
    this.logger.log(
      `Batch creating customer TB accounts for asset ${event.assetCode} (ledger=${event.tbLedgerId})`,
    );
    await this.batchCreateForAsset(event.assetCode, event.tbLedgerId);
  }

  async batchCreateForAsset(assetCode: string, ledger: number): Promise<{ total: number; succeeded: number; failed: number }> {
    const customers = await (this.prisma as any).customerMain.findMany({
      where: {
        onboardingStatus: 'APPROVED',
        adminStatus: 'ACTIVE',
      },
      select: { id: true, customerNo: true },
    });

    let succeeded = 0;
    let failed = 0;

    for (const customer of customers) {
      for (const code of [TB_ACCOUNT_CODES.CLIENT_CREDIT, TB_ACCOUNT_CODES.CLIENT_AUDIT]) {
        try {
          // Check if already exists
          const existing = await this.registryService.resolve({
            code,
            ledger,
            ownerType: 'CUSTOMER',
            ownerUuid: customer.id,
          });
          if (existing) {
            succeeded++;
            continue;
          }

          const codeName = code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 'CLIENT_CREDIT' : 'CLIENT_AUDIT';
          const flags = code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 0x02 : 0; // debits_must_not_exceed_credits

          const params: CreateTbAccountParams = {
            code,
            ledger,
            ownerType: 'CUSTOMER',
            ownerUuid: customer.id,
            ownerNo: customer.customerNo,
            assetCode,
            description: `${codeName} for ${customer.customerNo} / ${assetCode}`,
            flags,
          };

          await this.accountingService.createAccounts([params]);
          succeeded++;

          // If there was a previous backlog entry, mark it completed
          await (this.prisma as any).tbAccountBacklog.updateMany({
            where: { ledger, customerId: customer.id, code, status: 'FAILED' },
            data: { status: 'COMPLETED' },
          });
        } catch (error) {
          failed++;
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Failed to create TB account code=${code} for customer=${customer.customerNo} asset=${assetCode}: ${errorMsg}`,
          );

          // Upsert backlog entry
          await (this.prisma as any).tbAccountBacklog.upsert({
            where: {
              ledger_customerId_code: { ledger, customerId: customer.id, code },
            },
            create: {
              assetCode,
              ledger,
              customerId: customer.id,
              customerNo: customer.customerNo,
              code,
              status: 'FAILED',
              attempts: 1,
              lastError: errorMsg,
            },
            update: {
              attempts: { increment: 1 },
              lastError: errorMsg,
              status: 'FAILED',
            },
          });
        }
      }
    }

    this.logger.log(
      `Batch TB account creation for ${assetCode}: total=${customers.length * 2}, succeeded=${succeeded}, failed=${failed}`,
    );
    return { total: customers.length * 2, succeeded, failed };
  }

  async retryFailed(assetCode?: string): Promise<{ total: number; succeeded: number; failed: number }> {
    const where: any = { status: 'FAILED' };
    if (assetCode) where.assetCode = assetCode;

    const entries = await (this.prisma as any).tbAccountBacklog.findMany({ where });
    let succeeded = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        const existing = await this.registryService.resolve({
          code: entry.code,
          ledger: entry.ledger,
          ownerType: 'CUSTOMER',
          ownerUuid: entry.customerId,
        });

        if (existing) {
          await (this.prisma as any).tbAccountBacklog.update({
            where: { id: entry.id },
            data: { status: 'COMPLETED' },
          });
          succeeded++;
          continue;
        }

        const codeName = entry.code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 'CLIENT_CREDIT' : 'CLIENT_AUDIT';
        const flags = entry.code === TB_ACCOUNT_CODES.CLIENT_CREDIT ? 0x02 : 0;

        const params: CreateTbAccountParams = {
          code: entry.code,
          ledger: entry.ledger,
          ownerType: 'CUSTOMER',
          ownerUuid: entry.customerId,
          ownerNo: entry.customerNo,
          assetCode: entry.assetCode,
          description: `${codeName} for ${entry.customerNo} / ${entry.assetCode}`,
          flags,
        };

        await this.accountingService.createAccounts([params]);

        await (this.prisma as any).tbAccountBacklog.update({
          where: { id: entry.id },
          data: { status: 'COMPLETED' },
        });
        succeeded++;
      } catch (error) {
        failed++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await (this.prisma as any).tbAccountBacklog.update({
          where: { id: entry.id },
          data: {
            attempts: { increment: 1 },
            lastError: errorMsg,
          },
        });
      }
    }

    return { total: entries.length, succeeded, failed };
  }
}
```

- [ ] **Step 2: Wire TbAccountBatchService into TigerBeetleModule**

In `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`, add import:

```typescript
import { TbAccountBatchService } from './tb-account-batch.service';
```

Add `TbAccountBatchService` to both `providers` and `exports` arrays.

- [ ] **Step 3: Verify build**

Run: `npx nest build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-account-batch.service.ts src/modules/accounting/tigerbeetle/tigerbeetle.module.ts
git commit -m "feat(tb): add TbAccountBatchService for batch customer TB account creation with backlog"
```

---

### Task 4: Refactor AssetListingWorkflowService

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts`

This is the core refactor: remove the approval flow and make `submitListing()` directly create + provision + emit event.

- [ ] **Step 1: Rewrite AssetListingWorkflowService**

Replace the entire contents of `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts` with:

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { AssetProvisioningService } from './asset-provisioning.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

interface AssetCreationActor {
  userId: string;
  userNo?: string;
  role?: string;
}

@Injectable()
export class AssetListingWorkflowService {
  private readonly logger = new Logger(AssetListingWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly provisioningService: AssetProvisioningService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async submitListing(dto: SubmitAssetListingDto, actor: AssetCreationActor): Promise<any> {
    // 1. Validate uniqueness
    const existing = await this.prisma.asset.findFirst({
      where: { type: dto.type, code: dto.code, network: dto.network ?? null },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'ASSET_ALREADY_EXISTS',
        message: `Asset with type=${dto.type} code=${dto.code} network=${dto.network || 'N/A'} already exists`,
      });
    }

    // 2. Create asset + provision TB accounts in one transaction
    const assetNo = generateReferenceNo('AS');
    let asset: any;
    let tbLedgerId: number;

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.asset.create({
          data: {
            assetNo,
            type: dto.type,
            code: dto.code,
            network: dto.network,
            decimals: dto.decimals,
            description: dto.description,
            contractAddress: dto.contractAddress,
            minDepositAmount: dto.minDepositAmount,
            maxDepositAmount: dto.maxDepositAmount,
            minWithdrawAmount: dto.minWithdrawAmount,
            maxWithdrawAmount: dto.maxWithdrawAmount,
            depositEnabled: dto.depositEnabled,
            withdrawalEnabled: dto.withdrawalEnabled,
            status: 'PROVISIONING',
          },
        });

        const provisioned = await this.provisioningService.provision(created.id, tx);

        return { asset: { ...created, tbLedgerId: provisioned.tbLedgerId }, tbLedgerId: provisioned.tbLedgerId };
      });

      asset = result.asset;
      tbLedgerId = result.tbLedgerId;
    } catch (error) {
      this.logger.error(`Asset creation + provisioning failed: ${error instanceof Error ? error.message : error}`);

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.ASSET_CREATION.ASSET_CREATION_FAILED,
          entityType: AuditEntityTypes.ASSET,
          workflowType: AuditBusinessWorkflowTypes.ASSET_CREATION,
          result: AuditResult.FAILED,
          reason: error instanceof Error ? error.message : 'Asset creation failed',
          metadata: { assetCode: dto.code, assetType: dto.type, network: dto.network },
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: actor.userId,
          actorNo: actor.userNo,
          actorRole: actor.role || 'ADMIN',
        },
      );

      throw error;
    }

    // 3. Record audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_CREATION.ASSET_CREATED_AND_PROVISIONED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_CREATION,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCode: dto.code,
          assetType: dto.type,
          network: dto.network,
          tbLedgerId,
          systemAccountsCreated: 3,
        },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || 'ADMIN',
      },
    );

    // 4. Fire-and-forget: trigger async customer TB account batch creation
    this.eventEmitter.emit('asset.provisioned', {
      assetId: asset.id,
      assetCode: dto.code,
      tbLedgerId,
    });

    return { asset };
  }
}
```

- [ ] **Step 2: Refactor AssetProvisioningService to accept transaction client**

In `src/modules/asset-treasury/assets/asset-provisioning.service.ts`, replace the entire `provision()` method so it accepts an optional transaction client and no longer wraps in its own `$transaction` or validates status:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { CreateTbAccountParams } from '../../accounting/tigerbeetle/types/accounting.types';
import { Prisma } from '@prisma/client';

@Injectable()
export class AssetProvisioningService {
  private readonly logger = new Logger(AssetProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
  ) {}

  async provision(assetId: string, tx?: Prisma.TransactionClient): Promise<{ tbLedgerId: number }> {
    const client = tx ?? this.prisma;

    const asset = await (client as any).asset.findUniqueOrThrow({ where: { id: assetId } });

    const maxResult = await (client as any).asset.aggregate({ _max: { tbLedgerId: true } });
    const tbLedgerId = (maxResult._max.tbLedgerId ?? 0) + 1;

    // Reserve the ledger ID in DB — the unique constraint prevents duplicates
    await (client as any).asset.update({
      where: { id: assetId },
      data: { tbLedgerId },
    });

    const custodyCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY;

    const accountParams: CreateTbAccountParams[] = [
      {
        code: custodyCode,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCode: asset.code,
        description: `${asset.type === 'FIAT' ? 'BANK' : 'CUSTODY'} for ${asset.code}`,
      },
      {
        code: TB_ACCOUNT_CODES.TRADE_CLEARING,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCode: asset.code,
        description: `TRADE_CLEARING for ${asset.code}`,
      },
      {
        code: TB_ACCOUNT_CODES.FEE_RECEIVABLE,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCode: asset.code,
        description: `FEE_RECEIVABLE for ${asset.code}`,
        flags: 0x04,
      },
    ];

    await this.accountingService.createAccounts(accountParams, tx);

    this.logger.log(`Asset ${asset.assetNo} provisioned with tbLedgerId=${tbLedgerId}, 3 TB accounts created`);
    return { tbLedgerId };
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npx nest build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing-workflow.service.ts src/modules/asset-treasury/assets/asset-provisioning.service.ts
git commit -m "refactor(assets): remove listing approval, direct create+provision with async customer TB batch"
```

---

### Task 5: Create AssetActivationApprovalService and AssetActivationWorkflowService

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-activation-approval.service.ts`
- Create: `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts`

- [ ] **Step 1: Create AssetActivationApprovalService**

Create `src/modules/asset-treasury/assets/asset-activation-approval.service.ts`:

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
export class AssetActivationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ASSET_ACTIVATION;
  readonly workflowType = AuditBusinessWorkflowTypes.ASSET_ACTIVATION;
  readonly auditActions = {
    granted: AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ASSET_ACTIVATION.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ASSET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Create AssetActivationWorkflowService**

Create `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts`:

```typescript
import {
  Injectable,
  BadRequestException,
  ConflictException,
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
import { TbAccountRegistryService } from '../../accounting/tigerbeetle/tb-account-registry.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';

const SECONDARY_EVENT = 'workflow.asset-activation.decided';

@Injectable()
export class AssetActivationWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly registryService: TbAccountRegistryService,
  ) {}

  private toAuditActor(actor: ApprovalActorContext) {
    return {
      actorType: actor.actorType,
      actorId: actor.userId,
      actorNo: actor.userNo,
      actorRole: actor.role || actor.roleCodes[0] || 'UNKNOWN',
    };
  }

  async requestActivation(assetNo: string, actor: ApprovalActorContext) {
    const traceId = randomUUID();

    // 1. Find asset, verify PROVISIONING
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException(`Asset ${assetNo} not found`);
    }
    if (asset.status !== 'PROVISIONING') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset must be in PROVISIONING status to activate (current: ${asset.status})`,
      });
    }

    // 2. Check no pending activation approval
    const existingPending = await this.prisma.approvalCase.findFirst({
      where: {
        actionType: ApprovalActionTypes.ASSET_ACTIVATION,
        entityRef: asset.id,
        status: 'PENDING',
        deletedAt: null,
      },
    });
    if (existingPending) {
      throw new ConflictException(
        `An activation request is already pending for this asset: ${existingPending.approvalNo}`,
      );
    }

    // 3. Readiness checks
    await this.checkReadiness(asset);

    // 4. Create approval case
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ASSET_ACTIVATION,
        entityRef: asset.id,
        workflowType: AuditBusinessWorkflowTypes.ASSET_ACTIVATION,
        workflowId: asset.id,
        workflowNo: assetNo,
        traceId,
        objectSnapshot: {
          assetId: asset.id,
          assetNo,
          assetCode: asset.code,
          assetType: asset.type,
          network: asset.network,
          tbLedgerId: asset.tbLedgerId,
        },
      },
      {
        reason: `Activate asset: ${asset.code} (${asset.type})`,
        traceId,
      },
      actor,
    );

    // 5. Record audit
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_ACTIVATION.ACTIVATION_REQUESTED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_ACTIVATION,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCode: asset.code,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `ASSET_ACTIVATION_REQUESTED_${assetNo}`,
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

  private async checkReadiness(asset: any): Promise<void> {
    // Check 1: TB system accounts exist
    const ledger = asset.tbLedgerId;
    if (!ledger) {
      throw new BadRequestException('Asset has not been provisioned for TigerBeetle');
    }

    const custodyCode = asset.type === 'FIAT' ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY;
    const requiredCodes = [custodyCode, TB_ACCOUNT_CODES.TRADE_CLEARING, TB_ACCOUNT_CODES.FEE_RECEIVABLE];

    for (const code of requiredCodes) {
      const account = await this.registryService.resolve({
        code,
        ledger,
        ownerType: 'SYSTEM',
      });
      if (!account) {
        throw new BadRequestException('Asset has not been provisioned for TigerBeetle');
      }
    }

    // Check 2: At least one active wallet
    const walletCount = await this.prisma.wallet.count({
      where: { assetId: asset.id, status: 'ACTIVE' },
    });
    if (walletCount === 0) {
      throw new BadRequestException('No active wallet configured for this asset');
    }
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async handleApprovalDecided(event: ApprovalDecidedEvent) {
    if (event.decision === 'APPROVED') {
      return this.executeActivation(event);
    }
  }

  private async executeActivation(event: ApprovalDecidedEvent) {
    try {
      const updated = await this.prisma.asset.update({
        where: { id: event.entityRef },
        data: { status: 'ACTIVE' },
      });

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_ACTIVATION.ASSET_ACTIVATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        entityNo: updated.assetNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.ASSET_ACTIVATION,
        traceId: event.traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          approvalId: event.approvalId,
          approvalNo: event.approvalNo,
          activatedByUserId: event.decisionByUserId,
          activatedByUserNo: event.decisionByUserNo,
        },
        requestId: `ASSET_ACTIVATION_EXECUTED_${updated.assetNo}`,
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
        'Asset activated successfully',
      );
    } catch (error) {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_ACTIVATION.ACTIVATION_FAILED,
        entityType: AuditEntityTypes.ASSET,
        entityId: event.entityRef,
        workflowType: AuditBusinessWorkflowTypes.ASSET_ACTIVATION,
        traceId: event.traceId,
        result: AuditResult.FAILED,
        reason: error instanceof Error ? error.message : 'Activation execution failed',
        metadata: { approvalId: event.approvalId },
        requestId: `ASSET_ACTIVATION_EXEC_FAILED_${event.entityRef}`,
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
          error instanceof Error ? error.message : 'Activation execution failed',
        )
        .catch(() => undefined);

      throw error;
    }
  }
}
```

- [ ] **Step 3: Verify build**

Run: `npx nest build`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-activation-approval.service.ts src/modules/asset-treasury/assets/asset-activation-workflow.service.ts
git commit -m "feat(assets): add AssetActivationWorkflowService with readiness checks and approval flow"
```

---

### Task 6: Update controller, module wiring, delete old approval service

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-listing.controller.ts`
- Modify: `src/modules/asset-treasury/assets/assets.module.ts`
- Delete: `src/modules/asset-treasury/assets/asset-listing-approval.service.ts`

- [ ] **Step 1: Update AssetListingController**

Replace the entire contents of `src/modules/asset-treasury/assets/asset-listing.controller.ts` with:

```typescript
import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { AssetActivationWorkflowService } from './asset-activation-workflow.service';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { SuspendAssetDto } from './dto/suspend-asset.dto';

@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetListingController {
  constructor(
    private readonly workflowService: AssetListingWorkflowService,
    private readonly activationWorkflow: AssetActivationWorkflowService,
    private readonly suspensionWorkflow: AssetSuspensionWorkflowService,
    private readonly reactivationWorkflow: AssetReactivationWorkflowService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    return {
      actorType: 'ADMIN',
      userId: req.user.userId,
      userNo: req.user.userNo,
      role: req.user.role || 'ADMIN',
      roleCodes: req.user.roleCodes || [req.user.role || 'ADMIN'],
    };
  }

  @Post('listing')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/listing'))
  async submitListing(@Body() dto: SubmitAssetListingDto, @Req() req: any) {
    this.ensureAdmin(req);
    const actor = this.buildAdminActor(req);
    return this.workflowService.submitListing(dto, {
      userId: actor.userId,
      userNo: actor.userNo,
      role: actor.role,
    });
  }

  @Post(':assetNo/activate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/activate'))
  async activateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.activationWorkflow.requestActivation(assetNo, this.buildAdminActor(req));
  }

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

  @Post(':assetNo/reactivate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/reactivate'))
  async reactivateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.reactivationWorkflow.requestReactivation(
      assetNo,
      this.buildAdminActor(req),
    );
  }
}
```

- [ ] **Step 2: Delete AssetListingApprovalService**

```bash
rm src/modules/asset-treasury/assets/asset-listing-approval.service.ts
```

- [ ] **Step 3: Update AssetsModule**

Replace the entire contents of `src/modules/asset-treasury/assets/assets.module.ts` with:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { AssetsController } from './assets.controller';
import { AssetListingController } from './asset-listing.controller';
import { AssetsService } from './assets.service';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { AssetProvisioningService } from './asset-provisioning.service';
import { AssetActivationApprovalService } from './asset-activation-approval.service';
import { AssetActivationWorkflowService } from './asset-activation-workflow.service';
import { AssetSuspensionApprovalService } from './asset-suspension-approval.service';
import { AssetReactivationApprovalService } from './asset-reactivation-approval.service';
import { AssetSuspensionWorkflowService } from './asset-suspension-workflow.service';
import { AssetReactivationWorkflowService } from './asset-reactivation-workflow.service';
import { WalletsModule } from '../wallets/wallets.module';

@Module({
  imports: [PrismaModule, TigerBeetleModule, ApprovalsModule, AuditLogsModule, WalletsModule],
  controllers: [AssetsController, AssetListingController],
  providers: [
    AssetsService,
    AssetListingWorkflowService,
    AssetProvisioningService,
    AssetActivationApprovalService,
    AssetActivationWorkflowService,
    AssetSuspensionApprovalService,
    AssetReactivationApprovalService,
    AssetSuspensionWorkflowService,
    AssetReactivationWorkflowService,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
```

- [ ] **Step 4: Verify build**

Run: `npx nest build`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing.controller.ts src/modules/asset-treasury/assets/assets.module.ts
git rm src/modules/asset-treasury/assets/asset-listing-approval.service.ts
git commit -m "refactor(assets): wire activation workflow, remove listing approval service"
```

---

### Task 7: Fix remaining PENDING_APPROVAL references and build verification

**Files:**
- Potentially modify: any file referencing `PENDING_APPROVAL` for assets

- [ ] **Step 1: Search for PENDING_APPROVAL references**

Run: `grep -rn "PENDING_APPROVAL" src/ --include="*.ts"`

For each reference found:
- In `assets.service.ts`: the `create()` method sets `status: 'ACTIVE'` — this is a legacy deprecated endpoint, should be fine. But if `changeStatus()` or any other method references `PENDING_APPROVAL`, remove/update it.
- In seed files: check if seed code sets assets to `PENDING_APPROVAL` — if so, change to `PROVISIONING` or `ACTIVE`.
- In test files: update accordingly.
- In `asset-provisioning.service.ts`: the old status check was already removed in Task 4.
- In `custodian-wallet-create-workflow.service.ts`: check if it validates `PROVISIONING` or `ACTIVE` — line 53 checks `asset.status !== 'PROVISIONING' && asset.status !== 'ACTIVE'` — this is correct and doesn't reference PENDING_APPROVAL.

Fix any remaining references.

- [ ] **Step 2: Full backend build**

Run: `npx nest build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Run TypeScript check on admin-web**

Run: `cd admin-web && npx tsc --noEmit`
Expected: No errors (frontend is not changed in this spec, but verify nothing is broken)

- [ ] **Step 4: Commit if any fixes were needed**

```bash
git add -A
git commit -m "fix: remove remaining PENDING_APPROVAL references"
```

---

### Task 8: Integration test — asset creation + activation flow

**Files:**
- No new files (manual API testing via curl)

- [ ] **Step 1: Start the backend**

Ensure the backend is running on port 3500. If not: `npm run dev:start`

- [ ] **Step 2: Get admin JWT token**

```bash
curl -s -X POST http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r '.access_token'
```

Save the token as `$TOKEN`.

- [ ] **Step 3: Test asset creation (should succeed with PROVISIONING status)**

```bash
curl -s -X POST http://localhost:3500/admin/assets/listing \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "CRYPTO",
    "code": "ETH",
    "network": "ETHEREUM",
    "decimals": 18,
    "minDepositAmount": 0.001,
    "maxDepositAmount": 1000,
    "minWithdrawAmount": 0.01,
    "maxWithdrawAmount": 500,
    "depositEnabled": true,
    "withdrawalEnabled": true,
    "description": "Ethereum test"
  }' | jq
```

Expected: Asset created with `status: "PROVISIONING"`, `tbLedgerId` populated.

- [ ] **Step 4: Test activation with no wallet (should fail readiness check)**

Use the `assetNo` from step 3:

```bash
curl -s -X POST http://localhost:3500/admin/assets/$ASSET_NO/activate \
  -H "Authorization: Bearer $TOKEN" | jq
```

Expected: `400` with message `"No active wallet configured for this asset"`.

- [ ] **Step 5: Test duplicate asset creation (should fail)**

```bash
curl -s -X POST http://localhost:3500/admin/assets/listing \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "CRYPTO",
    "code": "ETH",
    "network": "ETHEREUM",
    "decimals": 18,
    "minDepositAmount": 0.001,
    "maxDepositAmount": 1000,
    "minWithdrawAmount": 0.01,
    "maxWithdrawAmount": 500,
    "depositEnabled": true,
    "withdrawalEnabled": true
  }' | jq
```

Expected: `400` with `"ASSET_ALREADY_EXISTS"`.

- [ ] **Step 6: Commit test results log**

No code to commit — tests are manual verification.
