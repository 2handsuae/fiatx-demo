# Asset Listing Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Maker/Checker approval flow for listing new assets, with automatic TB system account provisioning on approval.

**Architecture:** Three-layer NestJS pattern (Controller → Workflow → Domain Service). Clones the existing Role Definition Create workflow pattern. On approval, provisions 3 TB accounts (BANK/CUSTODY + TRADE_CLEARING + FEE_RECEIVABLE) per asset.

**Tech Stack:** NestJS, Prisma (SQLite), TigerBeetle (tigerbeetle-node), EventEmitter2

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/modules/asset-treasury/assets/dto/submit-asset-listing.dto.ts` | Validation DTO for listing submission payload |
| `src/modules/asset-treasury/assets/asset-provisioning.service.ts` | Domain service: allocates tbLedgerId, creates TB accounts |
| `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts` | Orchestrator: submit, @OnEvent approve/reject, activate |
| `src/modules/asset-treasury/assets/asset-listing-approval.service.ts` | ApprovalHandlerBase subclass for event routing |
| `src/modules/asset-treasury/assets/asset-listing.controller.ts` | HTTP endpoints: POST listing, POST activate |

### Modified Files

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add 9 fields to Asset model |
| `src/modules/asset-treasury/assets/dto/asset.dto.ts` | Add PENDING_APPROVAL, PROVISIONING to AssetStatus enum |
| `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts` | Add CLIENT_AUDIT=101, TRADE_CLEARING=110, FEE_RECEIVABLE=120 + update mappings |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Add ASSET_LISTING to ApprovalActionTypes, DEFAULT_APPROVAL_POLICIES, V1_APPROVAL_ACTION_TYPES |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add ASSET_LISTING workflow type + actions |
| `src/modules/asset-treasury/assets/assets.module.ts` | Register new providers, import TigerBeetleModule + ApprovalsModule |

---

### Task 1: Prisma Schema — Asset Model Extension

**Files:**
- Modify: `prisma/schema.prisma` (Asset model, around line 1243)

- [ ] **Step 1: Add new fields to Asset model**

In `prisma/schema.prisma`, find the Asset model and add these fields after the existing `description` field:

```prisma
model Asset {
  id                             String                          @id @default(uuid())
  assetNo                        String?                         @unique
  type                           String
  code                           String
  network                        String?
  decimals                       Int
  description                    String?
  status                         String                          @default("ACTIVE")
  tbLedgerId                     Int?                            @unique
  contractAddress                String?
  minDepositAmount               Float?
  maxDepositAmount               Float?
  minWithdrawAmount              Float?
  maxWithdrawAmount              Float?
  depositEnabled                 Boolean                         @default(true)
  withdrawalEnabled              Boolean                         @default(true)
  approvalCaseId                 String?
  approvalCaseNo                 String?
  createdAt                      DateTime                        @default(now())
  updatedAt                      DateTime                        @updatedAt
  // ... existing relations unchanged ...
```

**Note on types:** SQLite does not have native Decimal. Use `Float` for amount fields (consistent with existing codebase pattern). `@default("ACTIVE")` is preserved — the workflow passes `PENDING_APPROVAL` explicitly.

- [ ] **Step 2: Generate and apply migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add-asset-listing-fields
```

Expected: Migration created and applied. Existing AED/USDT/BTC seed rows keep status=ACTIVE, new nullable fields default to null, boolean fields default to true.

- [ ] **Step 3: Verify migration**

Run:
```bash
cd Exchange_js && npx prisma migrate status
```

Expected: All migrations applied, no drift.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add asset listing fields to Asset model"
```

---

### Task 2: Constants — TB Account Codes, Approval Types, Audit Actions

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/asset-treasury/assets/dto/asset.dto.ts`

- [ ] **Step 1: Update TB account codes**

In `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`, replace the full file:

```typescript
export const TB_ACCOUNT_CODES = {
  BANK: 1,
  CUSTODY: 10,
  CLIENT_CREDIT: 100,
  CLIENT_AUDIT: 101,
  TRADE_CLEARING: 110,
  FEE_RECEIVABLE: 120,
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

export const COA_TO_TB_CODE: Record<string, number> = {
  'A.BANK': TB_ACCOUNT_CODES.BANK,
  'A.CUSTODY': TB_ACCOUNT_CODES.CUSTODY,
  'L.CLIENT_CREDIT': TB_ACCOUNT_CODES.CLIENT_CREDIT,
  'L.CLIENT_AUDIT': TB_ACCOUNT_CODES.CLIENT_AUDIT,
  'L.TRADE_CLEARING': TB_ACCOUNT_CODES.TRADE_CLEARING,
  'L.FEE_RECEIVABLE': TB_ACCOUNT_CODES.FEE_RECEIVABLE,
};

export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);
```

- [ ] **Step 2: Add AssetStatus enum values**

In `src/modules/asset-treasury/assets/dto/asset.dto.ts`, add new enum values:

```typescript
export enum AssetStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  PROVISIONING = 'PROVISIONING',
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}
```

- [ ] **Step 3: Add ASSET_LISTING to ApprovalActionTypes**

In `src/modules/governance/approvals/constants/approval.constants.ts`, add after the Credential Reset section (line 56):

```typescript
  // ─── Asset Listing (2026-05-11) ────
  ASSET_LISTING: 'ASSET_LISTING',
```

In `DEFAULT_APPROVAL_POLICIES`, add before the closing `}` (around line 351):

```typescript
  // ─── Asset Listing (2026-05-11) ────
  [ApprovalActionTypes.ASSET_LISTING]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

In `V1_APPROVAL_ACTION_TYPES` array, add:

```typescript
  ApprovalActionTypes.ASSET_LISTING,
```

- [ ] **Step 4: Add audit workflow type and actions**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`:

Add to `AuditBusinessWorkflowTypes` (around line 156):

```typescript
  // Asset Listing (2026-05-11)
  ASSET_LISTING: 'ASSET_LISTING',
```

Add to `AuditGovernanceActions` (before the closing `} as const`, around line 558):

```typescript
  // Asset Listing (2026-05-11)
  ASSET_LISTING: {
    LISTING_SUBMITTED:     'LISTING_SUBMITTED',
    APPROVAL_GRANTED:      'APPROVAL_GRANTED',
    APPROVAL_DECLINED:     'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:    'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:      'APPROVAL_EXPIRED',
    ASSET_PROVISIONED:     'ASSET_PROVISIONED',
    ASSET_PROVISION_FAILED:'ASSET_PROVISION_FAILED',
    LISTING_CANCELLED:     'LISTING_CANCELLED',
    ASSET_ACTIVATED:       'ASSET_ACTIVATED',
  },
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts \
        src/modules/asset-treasury/assets/dto/asset.dto.ts \
        src/modules/governance/approvals/constants/approval.constants.ts \
        src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(constants): add asset listing approval type, audit actions, TB account codes"
```

---

### Task 3: DTO — Submit Asset Listing

**Files:**
- Create: `src/modules/asset-treasury/assets/dto/submit-asset-listing.dto.ts`

- [ ] **Step 1: Create the DTO**

```typescript
import {
  IsString,
  IsEnum,
  IsInt,
  IsOptional,
  IsBoolean,
  IsNumber,
  Min,
  Max,
  MaxLength,
  ValidateIf,
  IsNotEmpty,
} from 'class-validator';

export enum AssetType {
  FIAT = 'FIAT',
  CRYPTO = 'CRYPTO',
}

export class SubmitAssetListingDto {
  @IsString()
  @MaxLength(16)
  code!: string;

  @IsEnum(AssetType)
  type!: AssetType;

  @ValidateIf((o) => o.type === AssetType.CRYPTO)
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  network?: string;

  @IsInt()
  @Min(0)
  @Max(18)
  decimals!: number;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  contractAddress?: string;

  @IsNumber()
  @Min(0)
  minDepositAmount!: number;

  @IsNumber()
  @Min(0)
  maxDepositAmount!: number;

  @IsNumber()
  @Min(0)
  minWithdrawAmount!: number;

  @IsNumber()
  @Min(0)
  maxWithdrawAmount!: number;

  @IsBoolean()
  depositEnabled!: boolean;

  @IsBoolean()
  withdrawalEnabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(256)
  description?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/assets/dto/submit-asset-listing.dto.ts
git commit -m "feat(dto): add SubmitAssetListingDto for asset listing payload"
```

---

### Task 4: Domain Service — AssetProvisioningService

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-provisioning.service.ts`

- [ ] **Step 1: Implement the provisioning service**

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../../accounting/tigerbeetle/constants/tb-account-codes.constant';
import { CreateTbAccountParams } from '../../accounting/tigerbeetle/types/accounting.types';
import { AssetType } from './dto/submit-asset-listing.dto';

@Injectable()
export class AssetProvisioningService {
  private readonly logger = new Logger(AssetProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
  ) {}

  async provision(assetId: string, tx?: Prisma.TransactionClient): Promise<{ tbLedgerId: number }> {
    const client = tx || this.prisma;

    const asset = await (client as any).asset.findUniqueOrThrow({ where: { id: assetId } });

    if (asset.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${asset.assetNo} is not in PENDING_APPROVAL status`,
      });
    }

    const maxResult = await (client as any).asset.aggregate({ _max: { tbLedgerId: true } });
    const tbLedgerId = (maxResult._max.tbLedgerId ?? 0) + 1;

    const custodyCode = asset.type === AssetType.FIAT ? TB_ACCOUNT_CODES.BANK : TB_ACCOUNT_CODES.CUSTODY;

    const accountParams: CreateTbAccountParams[] = [
      {
        code: custodyCode,
        ledger: tbLedgerId,
        ownerType: 'SYSTEM',
        assetCode: asset.code,
        description: `${asset.type === AssetType.FIAT ? 'BANK' : 'CUSTODY'} for ${asset.code}`,
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

    await (client as any).asset.update({
      where: { id: assetId },
      data: { tbLedgerId, status: 'PROVISIONING' },
    });

    this.logger.log(`Asset ${asset.assetNo} provisioned with tbLedgerId=${tbLedgerId}, 3 TB accounts created`);
    return { tbLedgerId };
  }
}
```

**Note on flags:** `FEE_RECEIVABLE` uses `debits_must_not_exceed_credits` (0x04). `TRADE_CLEARING` intentionally uses 0 (allows negative balance for target currency side of trades). `BANK`/`CUSTODY` use default 0.

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-provisioning.service.ts
git commit -m "feat(asset): add AssetProvisioningService for TB account creation"
```

---

### Task 5: Approval Handler — AssetListingApprovalService

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-listing-approval.service.ts`

- [ ] **Step 1: Implement the approval handler**

This class extends `ApprovalHandlerBase` to convert generic approval events into workflow-specific `workflow.asset-listing.decided` events. Pattern copied from `role-definition-create-approval.service.ts`.

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
export class AssetListingApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.ASSET_LISTING;
  readonly workflowType = AuditBusinessWorkflowTypes.ASSET_LISTING;
  readonly auditActions = {
    granted: AuditGovernanceActions.ASSET_LISTING.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.ASSET_LISTING.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.ASSET_LISTING.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.ASSET_LISTING.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.ASSET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing-approval.service.ts
git commit -m "feat(asset): add AssetListingApprovalService for event routing"
```

---

### Task 6: Workflow — AssetListingWorkflowService

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts`

- [ ] **Step 1: Implement the workflow service**

```typescript
import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActionTypes, ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { AssetProvisioningService } from './asset-provisioning.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

const SECONDARY_EVENT = 'workflow.asset-listing.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class AssetListingWorkflowService {
  private readonly logger = new Logger(AssetListingWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    private readonly provisioningService: AssetProvisioningService,
  ) {}

  async submitListing(dto: SubmitAssetListingDto, actor: ApprovalActorContext): Promise<any> {
    const traceId = generateReferenceNo('TRC');

    const existing = await this.prisma.asset.findFirst({
      where: { type: dto.type, code: dto.code, network: dto.network ?? null },
    });
    if (existing) {
      throw new BadRequestException({
        code: 'ASSET_ALREADY_EXISTS',
        message: `Asset with type=${dto.type} code=${dto.code} network=${dto.network || 'N/A'} already exists`,
      });
    }

    const assetNo = generateReferenceNo('AS');
    const asset = await this.prisma.asset.create({
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
        status: 'PENDING_APPROVAL',
      },
    });

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.ASSET_LISTING,
        entityRef: asset.id,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        workflowId: asset.id,
        workflowNo: assetNo,
        traceId,
        objectSnapshot: { ...dto },
      },
      { reason: `List new asset: ${dto.code} (${dto.type})`, traceId },
      actor,
    );

    await this.prisma.asset.update({
      where: { id: asset.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_LISTING.LISTING_SUBMITTED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        traceId,
        result: AuditResult.SUCCESS,
        subjectNos: [{
          subjectRole: 'ENTITY',
          subjectType: 'ASSET',
          subjectId: asset.id,
          subjectNo: assetNo,
        }],
        metadata: {
          assetCode: dto.code,
          assetType: dto.type,
          network: dto.network,
          approvalNo: approvalCase.approvalNo,
        },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
      },
    );

    return { asset, approvalCase };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any): Promise<void> {
    const decision = payload?.decision;
    const entityRef = payload?.entityRef;
    const approvalId = payload?.approvalId;
    const traceId = payload?.traceId;

    if (decision === 'APPROVED') {
      await this.executeProvisioning(entityRef, approvalId, traceId);
    } else {
      await this.executeCancellation(entityRef, traceId);
    }
  }

  private async executeProvisioning(assetId: string, approvalId: string, traceId?: string): Promise<void> {
    try {
      const { tbLedgerId } = await this.provisioningService.provision(assetId);

      await this.approvalsService.markExecutionResult(approvalId, true, SYSTEM_ACTOR);

      const asset = await this.prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_LISTING.ASSET_PROVISIONED,
        entityType: AuditEntityTypes.ASSET,
        entityId: assetId,
        entityNo: asset.assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: { tbLedgerId },
        sourcePlatform: 'SYSTEM',
      });
    } catch (err: any) {
      this.logger.error(`Asset provisioning failed for ${assetId}: ${err.message}`, err.stack);
      await this.approvalsService.markExecutionResult(approvalId, false, SYSTEM_ACTOR, err.message);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.ASSET_LISTING.ASSET_PROVISION_FAILED,
        entityType: AuditEntityTypes.ASSET,
        entityId: assetId,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(assetId: string, traceId?: string): Promise<void> {
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) return;

    await this.prisma.asset.delete({ where: { id: assetId } });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.ASSET_LISTING.LISTING_CANCELLED,
      entityType: AuditEntityTypes.ASSET,
      entityId: assetId,
      entityNo: asset.assetNo,
      workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: { assetCode: asset.code, assetType: asset.type },
      sourcePlatform: 'SYSTEM',
    });
  }

  async activateAsset(assetNo: string, actor: ApprovalActorContext): Promise<any> {
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetNo} not found` });
    }
    if (asset.status !== 'PROVISIONING') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${assetNo} is in ${asset.status} status, expected PROVISIONING`,
      });
    }

    const updated = await this.prisma.asset.update({
      where: { id: asset.id },
      data: { status: 'ACTIVE' },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_LISTING.ASSET_ACTIVATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        result: AuditResult.SUCCESS,
        metadata: { assetCode: asset.code },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
      },
    );

    return updated;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing-workflow.service.ts
git commit -m "feat(asset): add AssetListingWorkflowService with submit, approve, reject, activate"
```

---

### Task 7: Controller — AssetListingController

**Files:**
- Create: `src/modules/asset-treasury/assets/asset-listing.controller.ts`

- [ ] **Step 1: Implement the controller**

```typescript
import { Controller, Post, Body, Param, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';

@Controller('admin/assets')
@UseGuards(JwtAuthGuard)
export class AssetListingController {
  constructor(private readonly workflowService: AssetListingWorkflowService) {}

  @Post('listing')
  async submitListing(@Body() dto: SubmitAssetListingDto, @Req() req: any) {
    const actor = {
      actorType: 'ADMIN' as const,
      userId: req.user.sub,
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: req.user.roleCodes || [req.user.role],
    };
    return this.workflowService.submitListing(dto, actor);
  }

  @Post(':assetNo/activate')
  async activateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    const actor = {
      actorType: 'ADMIN' as const,
      userId: req.user.sub,
      userNo: req.user.userNo,
      role: req.user.role,
      roleCodes: req.user.roleCodes || [req.user.role],
    };
    return this.workflowService.activateAsset(assetNo, actor);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing.controller.ts
git commit -m "feat(asset): add AssetListingController with submit and activate endpoints"
```

---

### Task 8: Module Wiring — AssetsModule

**Files:**
- Modify: `src/modules/asset-treasury/assets/assets.module.ts`

- [ ] **Step 1: Update the module to register all new providers**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';
import { AssetListingController } from './asset-listing.controller';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { AssetListingApprovalService } from './asset-listing-approval.service';
import { AssetProvisioningService } from './asset-provisioning.service';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';

@Module({
  imports: [PrismaModule, TigerBeetleModule, ApprovalsModule, AuditLogsModule],
  controllers: [AssetsController, AssetListingController],
  providers: [
    AssetsService,
    AssetListingWorkflowService,
    AssetListingApprovalService,
    AssetProvisioningService,
  ],
  exports: [AssetsService],
})
export class AssetsModule {}
```

**Note:** Check the existing `assets.module.ts` for the exact import paths. If `ApprovalsModule` or `AuditLogsModule` are already imported via a parent module, they may not need explicit imports here. Verify by checking `asset-treasury.module.ts`.

- [ ] **Step 2: Verify the application starts**

Run:
```bash
cd Exchange_js && npm run dev:start
```

Expected: Application starts without DI errors. Check logs for `TigerBeetle connection established`.

- [ ] **Step 3: Verify the application stops cleanly**

Run:
```bash
cd Exchange_js && npm run dev:stop
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/assets.module.ts
git commit -m "feat(asset): wire AssetListing providers into AssetsModule"
```

---

### Task 9: Smoke Test — End-to-End Verification

**Files:** No new files. Manual API testing.

- [ ] **Step 1: Start the dev stack**

```bash
cd Exchange_js && npm run dev:start
```

Ensure both the NestJS backend (port 3500) and TigerBeetle are running.

- [ ] **Step 2: Login to get JWT token**

```bash
curl -s -X POST http://localhost:3500/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"superadmin@exchange.local","password":"Admin123!"}' | jq -r '.access_token'
```

Save the token as `$TOKEN`.

- [ ] **Step 3: Submit an asset listing**

```bash
curl -s -X POST http://localhost:3500/admin/assets/listing \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "code": "ETH",
    "type": "CRYPTO",
    "network": "ETHEREUM",
    "decimals": 18,
    "minDepositAmount": 0.001,
    "maxDepositAmount": 1000,
    "minWithdrawAmount": 0.01,
    "maxWithdrawAmount": 500,
    "depositEnabled": true,
    "withdrawalEnabled": true,
    "description": "Ethereum"
  }' | jq .
```

Expected: Response with asset (status=PENDING_APPROVAL) and approvalCase.

- [ ] **Step 4: Approve the listing via approval engine**

Use the approval case ID from Step 3 to approve. Check the existing approval endpoints (likely `POST /governance/approvals/:id/decide`).

After approval, verify:
- Asset status changed to PROVISIONING
- Asset has a tbLedgerId assigned
- `tb_account_registry` has 3 new entries (CUSTODY/BANK + TRADE_CLEARING + FEE_RECEIVABLE)

- [ ] **Step 5: Activate the asset**

```bash
curl -s -X POST http://localhost:3500/admin/assets/$ASSET_NO/activate \
  -H "Authorization: Bearer $TOKEN" | jq .
```

Expected: Asset status changed to ACTIVE.

- [ ] **Step 6: Verify duplicate submission is rejected**

```bash
curl -s -X POST http://localhost:3500/admin/assets/listing \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "code": "ETH",
    "type": "CRYPTO",
    "network": "ETHEREUM",
    "decimals": 18,
    "minDepositAmount": 0.001,
    "maxDepositAmount": 1000,
    "minWithdrawAmount": 0.01,
    "maxWithdrawAmount": 500,
    "depositEnabled": true,
    "withdrawalEnabled": true
  }' | jq .
```

Expected: 400 error with `ASSET_ALREADY_EXISTS`.

- [ ] **Step 7: Stop dev stack and commit any fixes**

```bash
cd Exchange_js && npm run dev:stop
```

If any fixes were needed during smoke testing, commit them now.
