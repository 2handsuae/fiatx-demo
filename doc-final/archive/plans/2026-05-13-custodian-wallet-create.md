# Custodian Wallet Create Workflow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Custodian Wallet Create workflow — Admin submits a request to create a custodian wallet for a specific asset + role, Checker approves, then the system calls a custodian adapter to create the vault/address.

**Architecture:** 3-Layer (Domain Service + Approval Sub-Workflow + Workflow). Wallet role policies are hardcoded constants that enforce ownerType/assetType/uniqueness rules. Custodian API integration uses an adapter interface with a mock implementation for MVP.

**Tech Stack:** NestJS, Prisma, class-validator, EventEmitter2, ApprovalHandlerBase

**Spec:** `doc-final/superpowers/specs/2026-05-13-system-wallet-create-workflow-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/asset-treasury/wallets/wallet-role-policies.constant.ts` | Role policy definitions (ownerType, assetType, maxPerOwnerPerAsset) |
| Create | `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts` | CustodianAdapter interface + DI token |
| Create | `src/modules/asset-treasury/wallets/mock-custodian.adapter.ts` | Mock implementation returning fake addresses/IBANs |
| Create | `src/modules/asset-treasury/wallets/custodian-wallet-create-approval.service.ts` | L2 approval handler extending ApprovalHandlerBase |
| Create | `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts` | L3 workflow orchestrating submit → approve → create |
| Create | `src/modules/asset-treasury/wallets/custodian-wallet-create.controller.ts` | Admin controller for POST endpoints |
| Create | `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts` | Request DTO with class-validator |
| Modify | `src/modules/asset-treasury/wallets/wallets.module.ts` | Register new providers + controller |
| Modify | `src/modules/asset-treasury/wallets/dto/wallet.dto.ts` | Add PENDING_APPROVAL / CREATING / FAILED to WalletStatus |
| Modify | `src/modules/governance/approvals/constants/approval.constants.ts` | Add CUSTODIAN_WALLET_CREATE to ApprovalActionTypes + DEFAULT_APPROVAL_POLICIES |
| Modify | `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add CUSTODIAN_WALLET_CREATE to AuditBusinessWorkflowTypes + AuditGovernanceActions |
| Modify | `prisma/schema.prisma` | Add approvalCaseId, approvalCaseNo, vaultId to Wallet |
| Modify | `src/modules/asset-treasury/assets/asset-listing.controller.ts` | Remove provision-wallets endpoint |
| Delete | `src/modules/asset-treasury/wallets/system-wallet-provisioning.service.ts` | Replaced by workflow service |
| Modify | `src/app.module.ts` | Import GovernanceModule in WalletsModule if not already available |
| Modify | `admin-web/src/rbac/permissions.ts` | Add custodian-wallet permissions |

---

### Task 1: Prisma schema — add wallet fields

**Files:**
- Modify: `prisma/schema.prisma:1475-1525` (Wallet model)

- [ ] **Step 1: Add three new fields to Wallet model**

In `prisma/schema.prisma`, inside the `Wallet` model, add after the `iban` field (line ~1499):

```prisma
  approvalCaseId                           String?
  approvalCaseNo                           String?
  vaultId                                  String?
```

- [ ] **Step 2: Generate Prisma migration**

Run:
```bash
cd Exchange_js && npx prisma migrate dev --name add-wallet-approval-and-vault-fields
```

Expected: Migration created successfully, no errors.

- [ ] **Step 3: Verify migration applied**

Run:
```bash
cd Exchange_js && npx prisma migrate status
```

Expected: All migrations applied.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(schema): add approvalCaseId, approvalCaseNo, vaultId to Wallet

Support for custodian wallet create workflow — wallets now track their
approval case and the custodian-provided vault identifier.
EOF
)"
```

---

### Task 2: Extend WalletStatus enum + wallet role policies constant

**Files:**
- Modify: `src/modules/asset-treasury/wallets/dto/wallet.dto.ts`
- Create: `src/modules/asset-treasury/wallets/wallet-role-policies.constant.ts`

- [ ] **Step 1: Add new WalletStatus values**

In `src/modules/asset-treasury/wallets/dto/wallet.dto.ts`, update the `WalletStatus` enum:

```typescript
export enum WalletStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  CREATING = 'CREATING',
  ACTIVE = 'ACTIVE',
  FROZEN = 'FROZEN',
  DISABLED = 'DISABLED',
  FAILED = 'FAILED',
}
```

- [ ] **Step 2: Create wallet role policies constant file**

Create `src/modules/asset-treasury/wallets/wallet-role-policies.constant.ts`:

```typescript
import { WalletRole } from './dto/wallet.dto';

export interface WalletRolePolicy {
  maxPerOwnerPerAsset: number;
  allowedOwnerTypes: readonly string[];
  allowedAssetTypes: readonly string[];
  requiresCustodian: boolean;
}

export const WALLET_ROLE_POLICIES: Record<string, WalletRolePolicy> = {
  [WalletRole.C_DEP]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['CUSTOMER'],
    allowedAssetTypes: ['CRYPTO'],
    requiresCustodian: true,
  },
  [WalletRole.C_VIBAN]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['CUSTOMER'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.C_MAIN]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO'],
    requiresCustodian: true,
  },
  [WalletRole.C_OUT]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO'],
    requiresCustodian: true,
  },
  [WalletRole.C_CMA]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.F_LIQ]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO', 'FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.F_OPS]: {
    maxPerOwnerPerAsset: 1,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['CRYPTO', 'FIAT'],
    requiresCustodian: true,
  },
};

export function getWalletRolePolicy(role: string): WalletRolePolicy | undefined {
  return WALLET_ROLE_POLICIES[role];
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/wallet.dto.ts src/modules/asset-treasury/wallets/wallet-role-policies.constant.ts
git commit -m "$(cat <<'EOF'
feat(wallets): add new WalletStatus values and role policy constants

PENDING_APPROVAL, CREATING, FAILED statuses for the custodian wallet
create workflow. Role policies define ownerType/assetType/uniqueness
constraints per WalletRole.
EOF
)"
```

---

### Task 3: Custodian adapter interface + mock implementation

**Files:**
- Create: `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts`
- Create: `src/modules/asset-treasury/wallets/mock-custodian.adapter.ts`

- [ ] **Step 1: Create adapter interface**

Create `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts`:

```typescript
import { WalletRole } from './dto/wallet.dto';

export const CUSTODIAN_ADAPTER = Symbol('CUSTODIAN_ADAPTER');

export interface CreateVaultParams {
  assetCode: string;
  network?: string;
  role: WalletRole;
}

export interface CreateVaultResult {
  vaultId: string;
  address?: string;
  iban?: string;
}

export interface CustodianAdapter {
  createVault(params: CreateVaultParams): Promise<CreateVaultResult>;
}
```

- [ ] **Step 2: Create mock adapter**

Create `src/modules/asset-treasury/wallets/mock-custodian.adapter.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { CustodianAdapter, CreateVaultParams, CreateVaultResult } from './custodian-adapter.interface';

@Injectable()
export class MockCustodianAdapter implements CustodianAdapter {
  private readonly logger = new Logger(MockCustodianAdapter.name);

  async createVault(params: CreateVaultParams): Promise<CreateVaultResult> {
    this.logger.log(`[MOCK] Creating vault: asset=${params.assetCode}, role=${params.role}`);

    const vaultId = `mock-vault-${crypto.randomUUID().slice(0, 8)}`;

    if (params.network) {
      const address = '0x' + crypto.randomBytes(20).toString('hex');
      this.logger.log(`[MOCK] Generated crypto address: ${address}`);
      return { vaultId, address };
    }

    const iban = 'AE' + crypto.randomInt(10, 99) + 'MOCK' + crypto.randomBytes(8).toString('hex').toUpperCase();
    this.logger.log(`[MOCK] Generated IBAN: ${iban}`);
    return { vaultId, iban };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/custodian-adapter.interface.ts src/modules/asset-treasury/wallets/mock-custodian.adapter.ts
git commit -m "$(cat <<'EOF'
feat(wallets): add CustodianAdapter interface and mock implementation

DI token CUSTODIAN_ADAPTER with MockCustodianAdapter for MVP.
Generates fake crypto addresses and IBANs.
EOF
)"
```

---

### Task 4: Register constants — ApprovalActionTypes + audit actions

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add CUSTODIAN_WALLET_CREATE to ApprovalActionTypes**

In `src/modules/governance/approvals/constants/approval.constants.ts`, add after the `ASSET_LISTING` entry (line ~58):

```typescript
  // ─── Custodian Wallet Create (2026-05-13) ────
  CUSTODIAN_WALLET_CREATE: 'CUSTODIAN_WALLET_CREATE',
```

- [ ] **Step 2: Add default approval policy**

In the same file, inside `DEFAULT_APPROVAL_POLICIES`, add after the `ASSET_LISTING` policy (line ~360):

```typescript
  // ─── Custodian Wallet Create (2026-05-13) ────
  [ApprovalActionTypes.CUSTODIAN_WALLET_CREATE]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
```

- [ ] **Step 3: Add to V1_APPROVAL_ACTION_TYPES**

In the same file, add `ApprovalActionTypes.CUSTODIAN_WALLET_CREATE` to the `V1_APPROVAL_ACTION_TYPES` array.

- [ ] **Step 4: Add CUSTODIAN_WALLET_CREATE to AuditBusinessWorkflowTypes**

In `src/modules/audit-logging/constants/audit-actions.constant.ts`, add inside `AuditBusinessWorkflowTypes` after `ASSET_LISTING` (line ~158):

```typescript
  // Custodian Wallet Create (2026-05-13)
  CUSTODIAN_WALLET_CREATE: 'CUSTODIAN_WALLET_CREATE',
```

- [ ] **Step 5: Add CUSTODIAN_WALLET_CREATE audit actions group**

In the same file, add inside `AuditGovernanceActions` after the `ASSET_LISTING` block (line ~574):

```typescript
  // Custodian Wallet Create (2026-05-13)
  CUSTODIAN_WALLET_CREATE: {
    CREATE_REQUESTED:      'CREATE_REQUESTED',
    APPROVAL_GRANTED:      'APPROVAL_GRANTED',
    APPROVAL_DECLINED:     'APPROVAL_DECLINED',
    APPROVAL_CANCELLED:    'APPROVAL_CANCELLED',
    APPROVAL_EXPIRED:      'APPROVAL_EXPIRED',
    WALLET_CREATED:        'WALLET_CREATED',
    WALLET_CREATE_FAILED:  'WALLET_CREATE_FAILED',
    CREATE_CANCELLED:      'CREATE_CANCELLED',
  },
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "$(cat <<'EOF'
feat(constants): register CUSTODIAN_WALLET_CREATE approval type and audit actions
EOF
)"
```

---

### Task 5: L2 Approval handler

**Files:**
- Create: `src/modules/asset-treasury/wallets/custodian-wallet-create-approval.service.ts`

- [ ] **Step 1: Create approval handler**

Create `src/modules/asset-treasury/wallets/custodian-wallet-create-approval.service.ts`:

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
export class CustodianWalletCreateApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTODIAN_WALLET_CREATE;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE;
  readonly auditActions = {
    granted: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_GRANTED,
    declined: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_DECLINED,
    cancelled: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_CANCELLED,
    expired: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.APPROVAL_EXPIRED,
  };
  readonly entityType = AuditEntityTypes.WALLET;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/wallets/custodian-wallet-create-approval.service.ts
git commit -m "$(cat <<'EOF'
feat(wallets): add L2 approval handler for custodian wallet create
EOF
)"
```

---

### Task 6: Request DTO

**Files:**
- Create: `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`

- [ ] **Step 1: Create DTO**

Create `src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts`:

```typescript
import { IsString, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WalletRole } from './wallet.dto';

export class CreateCustodianWalletDto {
  @ApiProperty({ description: 'Asset operator key (e.g. AS2605130001)' })
  @IsString()
  assetNo!: string;

  @ApiProperty({ enum: WalletRole, description: 'Wallet role to assign' })
  @IsEnum(WalletRole)
  role!: WalletRole;

  @ApiProperty({ required: false, description: 'Customer UUID — required for customer-level roles (C_DEP, C_VIBAN)' })
  @IsString()
  @IsOptional()
  ownerId?: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/create-custodian-wallet.dto.ts
git commit -m "$(cat <<'EOF'
feat(wallets): add CreateCustodianWalletDto
EOF
)"
```

---

### Task 7: L3 Workflow service

**Files:**
- Create: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`

- [ ] **Step 1: Create workflow service**

Create `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`:

```typescript
import { Injectable, Inject, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
} from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { WalletRole } from './dto/wallet.dto';
import { CreateCustodianWalletDto } from './dto/create-custodian-wallet.dto';
import { getWalletRolePolicy } from './wallet-role-policies.constant';
import { CUSTODIAN_ADAPTER, CustodianAdapter } from './custodian-adapter.interface';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

const SECONDARY_EVENT = 'workflow.custodian-wallet-create.decided';

const SYSTEM_ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'SYSTEM',
  userNo: 'SYSTEM',
  role: 'SYSTEM',
  roleCodes: ['SYSTEM'],
};

@Injectable()
export class CustodianWalletCreateWorkflowService {
  private readonly logger = new Logger(CustodianWalletCreateWorkflowService.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(CUSTODIAN_ADAPTER)
    private readonly custodianAdapter: CustodianAdapter,
  ) {}

  async initiateCreate(dto: CreateCustodianWalletDto, actor: ApprovalActorContext) {
    const traceId = generateReferenceNo('TRC');

    const asset = await this.prisma.asset.findFirst({ where: { assetNo: dto.assetNo } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `Asset ${dto.assetNo} not found` });
    }
    if (asset.status !== 'PROVISIONING' && asset.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${dto.assetNo} is in ${asset.status} status, expected PROVISIONING or ACTIVE`,
      });
    }

    const policy = getWalletRolePolicy(dto.role);
    if (!policy) {
      throw new BadRequestException({ code: 'INVALID_WALLET_ROLE', message: `Unknown wallet role: ${dto.role}` });
    }
    if (!policy.allowedAssetTypes.includes(asset.type)) {
      throw new BadRequestException({
        code: 'ASSET_TYPE_MISMATCH',
        message: `Role ${dto.role} does not support asset type ${asset.type}`,
      });
    }

    const ownerType = policy.allowedOwnerTypes[0];
    if (ownerType === 'CUSTOMER' && !dto.ownerId) {
      throw new BadRequestException({
        code: 'OWNER_ID_REQUIRED',
        message: `ownerId is required for role ${dto.role}`,
      });
    }
    if (ownerType === 'PLATFORM' && dto.ownerId) {
      throw new BadRequestException({
        code: 'OWNER_TYPE_MISMATCH',
        message: `Role ${dto.role} is platform-level, ownerId must not be provided`,
      });
    }

    if (ownerType === 'CUSTOMER' && dto.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({ where: { id: dto.ownerId } });
      if (!customer) {
        throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: `Customer ${dto.ownerId} not found` });
      }
    }

    const existingCount = await this.prisma.wallet.count({
      where: {
        walletRole: dto.role,
        assetId: asset.id,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : dto.ownerId,
      },
    });
    if (existingCount >= policy.maxPerOwnerPerAsset) {
      throw new BadRequestException({
        code: 'WALLET_ALREADY_EXISTS',
        message: `A ${dto.role} wallet already exists for this asset and owner`,
      });
    }

    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';
    const direction = (dto.role === WalletRole.C_DEP || dto.role === WalletRole.C_VIBAN) ? 'INBOUND' : 'BIDIRECTIONAL';

    const walletNo = generateReferenceNo('WA');
    const wallet = await this.prisma.wallet.create({
      data: {
        walletNo,
        ownerType,
        ownerId: ownerType === 'PLATFORM' ? null : dto.ownerId,
        type: walletType,
        direction,
        walletRole: dto.role,
        assetId: asset.id,
        status: 'PENDING_APPROVAL',
      },
    });

    let approvalCase: any;
    try {
      approvalCase = await this.approvalsService.createAndSubmit(
        {
          actionType: ApprovalActionTypes.CUSTODIAN_WALLET_CREATE,
          entityRef: wallet.id,
          workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
          workflowId: wallet.id,
          workflowNo: walletNo,
          traceId,
          objectSnapshot: {
            assetNo: dto.assetNo,
            assetCode: asset.code,
            role: dto.role,
            ownerType,
            ownerId: dto.ownerId || null,
          },
        },
        { reason: `Create ${dto.role} wallet for ${asset.code}`, traceId },
        actor,
      );
    } catch (err) {
      await this.prisma.wallet.delete({ where: { id: wallet.id } });
      throw err;
    }

    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.CREATE_REQUESTED,
        entityType: AuditEntityTypes.WALLET,
        entityId: wallet.id,
        entityNo: walletNo,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.SUCCESS,
        subjectNos: [{
          subjectRole: AuditSubjectRole.ENTITY,
          subjectType: 'WALLET',
          subjectId: wallet.id,
          subjectNo: walletNo,
        }],
        metadata: {
          assetNo: dto.assetNo,
          assetCode: asset.code,
          role: dto.role,
          ownerType,
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

    return { wallet: { ...wallet, approvalCaseId: approvalCase.id, approvalCaseNo: approvalCase.approvalNo }, approvalCase };
  }

  @OnEvent(SECONDARY_EVENT, { async: true })
  async onDecided(payload: any): Promise<void> {
    const decision = payload?.decision;
    const entityRef = payload?.entityRef;
    const approvalId = payload?.approvalId;
    const traceId = payload?.traceId;

    if (!approvalId || !entityRef) {
      this.logger.warn('Custodian wallet create decided event missing approvalId or entityRef');
      return;
    }

    if (decision === 'APPROVED') {
      await this.executeCreation(entityRef, approvalId, traceId);
    } else {
      await this.executeCancellation(entityRef, traceId, decision);
    }
  }

  private async executeCreation(walletId: string, approvalId: string, traceId?: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id: walletId },
      include: { asset: true },
    });
    if (!wallet || wallet.status !== 'PENDING_APPROVAL') {
      this.logger.warn(`Wallet ${walletId} not found or not in PENDING_APPROVAL status`);
      await this.approvalsService.markExecutionResult(approvalId, false, SYSTEM_ACTOR, 'Wallet not found or wrong status');
      return;
    }

    await this.prisma.wallet.update({ where: { id: walletId }, data: { status: 'CREATING' } });

    try {
      const result = await this.custodianAdapter.createVault({
        assetCode: wallet.asset.code,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
      });

      await this.prisma.wallet.update({
        where: { id: walletId },
        data: {
          status: 'ACTIVE',
          vaultId: result.vaultId,
          address: result.address ?? wallet.address,
          iban: result.iban ?? wallet.iban,
        },
      });

      await this.approvalsService.markExecutionResult(approvalId, true, SYSTEM_ACTOR);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATED,
        entityType: AuditEntityTypes.WALLET,
        entityId: walletId,
        entityNo: wallet.walletNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: { vaultId: result.vaultId, address: result.address, iban: result.iban },
        sourcePlatform: 'SYSTEM',
      });

      this.logger.log(`Wallet ${wallet.walletNo} created successfully, vaultId=${result.vaultId}`);
    } catch (err: any) {
      this.logger.error(`Custodian vault creation failed for wallet ${walletId}: ${err.message}`, err.stack);

      await this.prisma.wallet.update({ where: { id: walletId }, data: { status: 'FAILED' } });
      await this.approvalsService.markExecutionResult(approvalId, false, SYSTEM_ACTOR, err.message);

      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATE_FAILED,
        entityType: AuditEntityTypes.WALLET,
        entityId: walletId,
        entityNo: wallet.walletNo ?? undefined,
        workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
        traceId,
        result: AuditResult.FAILED,
        metadata: { error: err.message },
        sourcePlatform: 'SYSTEM',
      });
    }
  }

  private async executeCancellation(walletId: string, traceId?: string, decision?: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;

    await this.prisma.wallet.delete({ where: { id: walletId } });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.CREATE_CANCELLED,
      entityType: AuditEntityTypes.WALLET,
      entityId: walletId,
      entityNo: wallet.walletNo ?? undefined,
      workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
      traceId,
      result: AuditResult.SUCCESS,
      metadata: { decision },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.log(`Wallet ${wallet.walletNo} creation cancelled (${decision}), row deleted`);
  }

  async retryCreate(walletNo: string, actor: ApprovalActorContext): Promise<any> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { walletNo },
      include: { asset: true },
    });
    if (!wallet) {
      throw new NotFoundException({ code: 'WALLET_NOT_FOUND', message: `Wallet ${walletNo} not found` });
    }
    if (wallet.status !== 'FAILED') {
      throw new BadRequestException({
        code: 'INVALID_WALLET_STATUS',
        message: `Wallet ${walletNo} is in ${wallet.status} status, expected FAILED`,
      });
    }

    const traceId = generateReferenceNo('TRC');
    await this.prisma.wallet.update({ where: { id: wallet.id }, data: { status: 'CREATING' } });

    try {
      const result = await this.custodianAdapter.createVault({
        assetCode: wallet.asset.code,
        network: wallet.asset.network ?? undefined,
        role: wallet.walletRole as WalletRole,
      });

      const updated = await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: 'ACTIVE',
          vaultId: result.vaultId,
          address: result.address ?? wallet.address,
          iban: result.iban ?? wallet.iban,
        },
      });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATED,
          entityType: AuditEntityTypes.WALLET,
          entityId: wallet.id,
          entityNo: walletNo,
          workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
          traceId,
          result: AuditResult.SUCCESS,
          metadata: { vaultId: result.vaultId, retried: true },
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
    } catch (err: any) {
      await this.prisma.wallet.update({ where: { id: wallet.id }, data: { status: 'FAILED' } });

      await this.auditLogsService.recordByActor(
        {
          action: AuditGovernanceActions.CUSTODIAN_WALLET_CREATE.WALLET_CREATE_FAILED,
          entityType: AuditEntityTypes.WALLET,
          entityId: wallet.id,
          entityNo: walletNo,
          workflowType: AuditBusinessWorkflowTypes.CUSTODIAN_WALLET_CREATE,
          traceId,
          result: AuditResult.FAILED,
          metadata: { error: err.message, retried: true },
          sourcePlatform: 'ADMIN_API',
        },
        {
          actorType: 'ADMIN',
          actorId: actor.userId,
          actorNo: actor.userNo,
          actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
        },
      );

      throw err;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts
git commit -m "$(cat <<'EOF'
feat(wallets): add L3 workflow for custodian wallet create

Orchestrates: submit → approval → custodian API → audit.
Includes retry-create repair surface for FAILED wallets.
EOF
)"
```

---

### Task 8: Admin controller

**Files:**
- Create: `src/modules/asset-treasury/wallets/custodian-wallet-create.controller.ts`

- [ ] **Step 1: Create controller**

Create `src/modules/asset-treasury/wallets/custodian-wallet-create.controller.ts`:

```typescript
import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { CustodianWalletCreateWorkflowService } from './custodian-wallet-create-workflow.service';
import { CreateCustodianWalletDto } from './dto/create-custodian-wallet.dto';

@Controller('admin/custodian-wallets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class CustodianWalletCreateController {
  constructor(
    private readonly workflowService: CustodianWalletCreateWorkflowService,
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

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/custodian-wallets'))
  async create(@Body() dto: CreateCustodianWalletDto, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.initiateCreate(dto, this.buildAdminActor(req));
  }

  @Post(':walletNo/retry')
  @RequirePermissions(buildPermissionCode('POST', '/admin/custodian-wallets/:walletNo/retry'))
  async retry(@Param('walletNo') walletNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.retryCreate(walletNo, this.buildAdminActor(req));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/wallets/custodian-wallet-create.controller.ts
git commit -m "$(cat <<'EOF'
feat(wallets): add admin controller for custodian wallet create

POST /admin/custodian-wallets — submit create request
POST /admin/custodian-wallets/:walletNo/retry — retry failed creation
EOF
)"
```

---

### Task 9: Wire module + clean up old code

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.module.ts`
- Modify: `src/modules/asset-treasury/assets/asset-listing.controller.ts`
- Delete: `src/modules/asset-treasury/wallets/system-wallet-provisioning.service.ts`
- Modify: `admin-web/src/rbac/permissions.ts`

- [ ] **Step 1: Update WalletsModule**

Replace `src/modules/asset-treasury/wallets/wallets.module.ts` contents with:

```typescript
import { Module } from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { WalletsController } from './wallets.controller';
import { CustodianWalletCreateController } from './custodian-wallet-create.controller';
import { CustodianWalletCreateWorkflowService } from './custodian-wallet-create-workflow.service';
import { CustodianWalletCreateApprovalService } from './custodian-wallet-create-approval.service';
import { MockCustodianAdapter } from './mock-custodian.adapter';
import { CUSTODIAN_ADAPTER } from './custodian-adapter.interface';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { GovernanceModule } from '../../governance/governance.module';

@Module({
  imports: [PrismaModule, AuditLogsModule, GovernanceModule],
  controllers: [WalletsController, CustodianWalletCreateController],
  providers: [
    WalletsService,
    WalletQueryService,
    CustodianWalletCreateWorkflowService,
    CustodianWalletCreateApprovalService,
    { provide: CUSTODIAN_ADAPTER, useClass: MockCustodianAdapter },
  ],
  exports: [WalletsService, WalletQueryService],
})
export class WalletsModule {}
```

- [ ] **Step 2: Remove provision-wallets endpoint from AssetListingController**

In `src/modules/asset-treasury/assets/asset-listing.controller.ts`:

Remove the import of `SystemWalletProvisioningService`, remove it from the constructor, and remove the entire `provisionWallets` method (lines ~49-54). Also remove it from the constructor DI.

The file should become:

```typescript
import { Controller, Post, Body, Param, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { AssetListingWorkflowService } from './asset-listing-workflow.service';
import { SubmitAssetListingDto } from './dto/submit-asset-listing.dto';

@Controller('admin/assets')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class AssetListingController {
  constructor(
    private readonly workflowService: AssetListingWorkflowService,
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
    return this.workflowService.submitListing(dto, this.buildAdminActor(req));
  }

  @Post(':assetNo/activate')
  @RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/activate'))
  async activateAsset(@Param('assetNo') assetNo: string, @Req() req: any) {
    this.ensureAdmin(req);
    return this.workflowService.activateAsset(assetNo, this.buildAdminActor(req));
  }
}
```

- [ ] **Step 3: Delete old provisioning service**

Run:
```bash
rm src/modules/asset-treasury/wallets/system-wallet-provisioning.service.ts
rm -f src/modules/asset-treasury/wallets/system-wallet-provisioning.service.spec.ts
```

- [ ] **Step 4: Add RBAC permissions for admin-web**

In `admin-web/src/rbac/permissions.ts`, add after `ASSET_PROVISION_WALLETS` (line ~202):

```typescript
  CUSTODIAN_WALLET_CREATE: 'api.post.admin_custodian_wallets',
  CUSTODIAN_WALLET_RETRY: 'api.post.admin_custodian_wallets_walletno_retry',
```

And remove the old line:
```typescript
  ASSET_PROVISION_WALLETS: 'api.post.admin_assets_assetno_provision_wallets',
```

- [ ] **Step 5: Verify build compiles**

Run:
```bash
cd Exchange_js && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(wallets): wire custodian wallet create workflow into module

- Register workflow, approval, adapter in WalletsModule
- Remove old provision-wallets endpoint and SystemWalletProvisioningService
- Add RBAC permission codes for new endpoints
EOF
)"
```

---

### Task 10: Verify end-to-end

- [ ] **Step 1: Start dev stack**

Run:
```bash
cd Exchange_js && npm run dev:start
```

Expected: Stack starts with no errors.

- [ ] **Step 2: Verify Swagger**

Open `http://localhost:3500/api` in browser. Confirm that:
- `POST /admin/custodian-wallets` appears
- `POST /admin/custodian-wallets/{walletNo}/retry` appears
- Old `POST /admin/assets/{assetNo}/provision-wallets` is gone

- [ ] **Step 3: Stop dev stack**

Run:
```bash
cd Exchange_js && npm run dev:stop
```
