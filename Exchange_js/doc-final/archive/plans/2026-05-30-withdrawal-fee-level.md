# Withdrawal Fee Level — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement WithdrawalFeeLevel CRUD with maker-checker approval, change-request pattern, customer binding, and extract WithdrawQuoteService from PricingCenterService with multi-level best-price resolution.

**Architecture:** Three-layer (L1 Domain / L2 Approval / L3 Workflow) mirroring TransactionLimits module. Five workflows: Level Creation (L2+L3), Level Change (L2+L3), Level Binding (L3 only, no approval), plus extracted WithdrawQuoteService for quote lifecycle.

**Tech Stack:** NestJS + Prisma + SQLite, existing ApprovalHandlerBase, AuditLogsService, PricingEngineService

**Spec:** `doc-final/superpowers/specs/2026-05-30-withdrawal-fee-level-design.md`

**Reference Implementation:** `src/modules/governance/transaction-limits/` — mirror structure exactly.

---

## File Structure

| Action | Path | Responsibility |
|--------|------|---------------|
| Modify | `prisma/schema.prisma` | Add 3 new models + 2 fields on WithdrawPricingQuote |
| Modify | `src/modules/audit-logging/constants/audit-actions.constant.ts` | Register entity types, workflow types, governance actions |
| Modify | `src/modules/governance/approvals/constants/approval.constants.ts` | Register 2 approval action types + default policies |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.service.ts` | L1 — Level + ChangeRequest CRUD |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding.service.ts` | L1 — Binding CRUD |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-approval.service.ts` | L2 — Creation approval handler |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-change-approval.service.ts` | L2 — Change approval handler |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-workflow.service.ts` | L3 — Creation orchestration + audit |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-change-workflow.service.ts` | L3 — Change orchestration + audit |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding-workflow.service.ts` | L3 — Binding orchestration + audit |
| Create | `src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts` | L3 — Multi-level quote resolution + lifecycle |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.controller.ts` | Admin controller for levels + bindings |
| Create | `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.module.ts` | Module registration |
| Create | `src/modules/trading/withdrawal-fee-level/types/fee-level.types.ts` | Shared types |
| Modify | `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` | Replace PricingCenterService → WithdrawQuoteService |
| Modify | `src/modules/trading/pricing-center/pricing-center-customer.controller.ts` | Redirect customer quote endpoint to WithdrawQuoteService |
| Modify | `doc-final/reference/roadmap.md` | Add fee level workflows to V5 MVP |

---

### Task 1: Audit + Approval Constants Registration

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add entity types and workflow types to audit-actions.constant.ts**

In `AuditEntityTypes`, add after `TRANSACTION_LIMIT_POLICY`:

```typescript
  WITHDRAWAL_FEE_LEVEL: 'WITHDRAWAL_FEE_LEVEL',
  WITHDRAWAL_FEE_LEVEL_CHANGE_REQUEST: 'WITHDRAWAL_FEE_LEVEL_CHANGE_REQUEST',
  WITHDRAWAL_FEE_LEVEL_BINDING: 'WITHDRAWAL_FEE_LEVEL_BINDING',
```

In `AuditBusinessWorkflowTypes`, add after `TRANSACTION_LIMIT_CREATION`:

```typescript
  // Withdrawal Fee Level (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_CREATION',
  WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_CHANGE',
  WITHDRAWAL_FEE_LEVEL_BINDING: 'WITHDRAWAL_FEE_LEVEL_BINDING',
```

In `AuditGovernanceActions`, add after `TRANSACTION_LIMIT_CREATION` block:

```typescript
  // Withdrawal Fee Level Creation (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_CREATION: {
    CREATION_REQUESTED:    'CREATION_REQUESTED',
    CREATION_APPLIED:      'CREATION_APPLIED',
    CREATION_APPLY_FAILED: 'CREATION_APPLY_FAILED',
    CREATION_CANCELLED:    'CREATION_CANCELLED',
  },

  // Withdrawal Fee Level Change (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_CHANGE: {
    CHANGE_REQUESTED:    'CHANGE_REQUESTED',
    CHANGE_APPLIED:      'CHANGE_APPLIED',
    CHANGE_APPLY_FAILED: 'CHANGE_APPLY_FAILED',
    CHANGE_CANCELLED:    'CHANGE_CANCELLED',
  },

  // Withdrawal Fee Level Binding (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_BINDING: {
    LEVEL_BOUND:   'LEVEL_BOUND',
    LEVEL_UNBOUND: 'LEVEL_UNBOUND',
  },
```

- [ ] **Step 2: Add approval action types and default policies to approval.constants.ts**

In `ApprovalActionTypes`, add after `TRANSACTION_LIMIT_CREATION`:

```typescript
  // Withdrawal Fee Level (2026-05-30)
  WITHDRAWAL_FEE_LEVEL_CREATION: 'WITHDRAWAL_FEE_LEVEL_CREATION',
  WITHDRAWAL_FEE_LEVEL_CHANGE: 'WITHDRAWAL_FEE_LEVEL_CHANGE',
```

In `DEFAULT_APPROVAL_POLICIES`, add after `TRANSACTION_LIMIT_CREATION` block:

```typescript
  // ─── Withdrawal Fee Level (2026-05-30) ────
  [ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION]: {
    steps: [
      { stepNo: 1, roles: ['MLRO'] },
      { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] },
    ],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE]: {
    steps: [
      { stepNo: 1, roles: ['MLRO'] },
      { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] },
    ],
    timeoutHours: 48,
    allowCancel: true,
  },
```

In `V1_APPROVAL_ACTION_TYPES`, add at end:

```typescript
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION,
  ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE,
```

- [ ] **Step 3: Update audit-logs.service.spec.ts if needed**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts \
        src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(governance): register withdrawal fee level audit + approval constants"
```

---

### Task 2: Prisma Schema — 3 New Models + Quote Fields

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add WithdrawalFeeLevel model**

Add after `TransactionLimitChangeRequest` model:

```prisma
model WithdrawalFeeLevel {
  id               String    @id @default(uuid())
  levelCode        String    @unique
  name             String
  assetId          String
  isDefault        Boolean   @default(false)
  enabled          Boolean   @default(true)
  tiersJson        String
  configHash       String
  status           String    @default("PENDING_APPROVAL")
  approvalCaseId   String?
  approvalCaseNo   String?
  createdByUserId  String
  updatedByUserId  String?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  asset            Asset     @relation(fields: [assetId], references: [id])
  bindings         WithdrawalFeeLevelBinding[]
  changeRequests   WithdrawalFeeLevelChangeRequest[]

  @@index([assetId, status, enabled])
  @@map("withdrawal_fee_levels")
}
```

- [ ] **Step 2: Add WithdrawalFeeLevelChangeRequest model**

```prisma
model WithdrawalFeeLevelChangeRequest {
  id                 String    @id @default(uuid())
  requestNo          String    @unique @default("TEMP")
  levelId            String
  levelCode          String
  currentTiersJson   String
  currentConfigHash  String
  proposedTiersJson  String
  changeReason       String
  status             String    @default("PENDING_APPROVAL")
  requestedByUserId  String
  approvalCaseId     String?
  approvalCaseNo     String?
  executedAt         DateTime?
  failureReason      String?
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt

  level              WithdrawalFeeLevel @relation(fields: [levelId], references: [id])

  @@index([levelId, status])
  @@map("withdrawal_fee_level_change_requests")
}
```

- [ ] **Step 3: Add WithdrawalFeeLevelBinding model**

```prisma
model WithdrawalFeeLevelBinding {
  id              String   @id @default(uuid())
  customerId      String
  levelId         String
  boundByUserId   String
  boundAt         DateTime @default(now())
  createdAt       DateTime @default(now())

  customer        Customer             @relation(fields: [customerId], references: [id])
  level           WithdrawalFeeLevel   @relation(fields: [levelId], references: [id])

  @@unique([customerId, levelId])
  @@index([customerId])
  @@index([levelId])
  @@map("withdrawal_fee_level_bindings")
}
```

- [ ] **Step 4: Add feeLevelId + feeLevelCode to WithdrawPricingQuote**

In the `WithdrawPricingQuote` model, add after `cancelledAt`:

```prisma
  feeLevelId      String?
  feeLevelCode    String?
```

- [ ] **Step 5: Add relation arrays on Asset and Customer models**

In the `Asset` model, add:

```prisma
  withdrawalFeeLevels    WithdrawalFeeLevel[]
```

In the `Customer` model, add:

```prisma
  withdrawalFeeLevelBindings  WithdrawalFeeLevelBinding[]
```

- [ ] **Step 6: Generate Prisma client and run migration**

```bash
cd Exchange_js && npx prisma generate && npx prisma db push
```

- [ ] **Step 7: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(schema): add WithdrawalFeeLevel, ChangeRequest, Binding models + quote fields"
```

---

### Task 3: Shared Types

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/types/fee-level.types.ts`

- [ ] **Step 1: Create the types file**

```typescript
// src/modules/trading/withdrawal-fee-level/types/fee-level.types.ts
import { WithdrawalTier } from '../../pricing-center/types/pricing.types';

export interface FeeLevelTiersConfig {
  tiers: WithdrawalTier[];
}

export const WITHDRAWAL_FEE_ITEM_CODES = ['WITHDRAW_SERVICE_FEE'] as const;

export type WithdrawalFeeItemCode = (typeof WITHDRAWAL_FEE_ITEM_CODES)[number];
```

- [ ] **Step 2: Verify**

Run: `ls -la src/modules/trading/withdrawal-fee-level/types/fee-level.types.ts`

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/types/fee-level.types.ts
git commit -m "feat(withdrawal-fee-level): add shared types"
```

---

### Task 4: L1 Domain Service — WithdrawalFeeLevelService

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.service.ts`

**Reference:** `src/modules/governance/transaction-limits/transaction-limits.service.ts` (352 lines)

- [ ] **Step 1: Create the L1 service**

```typescript
// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.service.ts
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FeeLevelTiersConfig, WITHDRAWAL_FEE_ITEM_CODES } from './types/fee-level.types';

@Injectable()
export class WithdrawalFeeLevelService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── Level CRUD ──────────────────────────────────────────

  async findAll(params: {
    skip?: number;
    take?: number;
    where?: Prisma.WithdrawalFeeLevelWhereInput;
    orderBy?: Prisma.WithdrawalFeeLevelOrderByWithRelationInput;
  }) {
    const { skip, take, where, orderBy } = params;
    const [items, total] = await Promise.all([
      this.prisma.withdrawalFeeLevel.findMany({
        skip,
        take,
        where,
        orderBy: orderBy ?? { levelCode: 'asc' },
        include: { asset: { select: { code: true, type: true, currency: true } } },
      }),
      this.prisma.withdrawalFeeLevel.count({ where }),
    ]);
    return { items, total };
  }

  async findById(id: string) {
    const level = await this.prisma.withdrawalFeeLevel.findUnique({
      where: { id },
      include: { asset: { select: { code: true, type: true, currency: true, network: true } } },
    });
    if (!level) throw new NotFoundException(`WithdrawalFeeLevel not found: ${id}`);
    return level;
  }

  async findByLevelCode(levelCode: string) {
    const level = await this.prisma.withdrawalFeeLevel.findUnique({
      where: { levelCode },
      include: { asset: { select: { code: true, type: true, currency: true, network: true } } },
    });
    if (!level) throw new NotFoundException(`WithdrawalFeeLevel ${levelCode} not found`);
    return level;
  }

  async findActiveByAsset(assetId: string) {
    return this.prisma.withdrawalFeeLevel.findMany({
      where: { assetId, status: 'ACTIVE', enabled: true },
      orderBy: { levelCode: 'asc' },
    });
  }

  private computeHash(tiersJson: string): string {
    return createHash('sha256').update(tiersJson).digest('hex');
  }

  validateTiersJson(tiersJson: string): FeeLevelTiersConfig {
    let parsed: FeeLevelTiersConfig;
    try {
      parsed = JSON.parse(tiersJson);
    } catch {
      throw new BadRequestException('tiersJson is not valid JSON');
    }
    if (!parsed.tiers || !Array.isArray(parsed.tiers) || parsed.tiers.length === 0) {
      throw new BadRequestException('tiersJson.tiers must be a non-empty array');
    }
    for (const tier of parsed.tiers) {
      if (!tier.id || !tier.name) {
        throw new BadRequestException('Each tier must have id and name');
      }
      if (!Array.isArray(tier.feeItems) || tier.feeItems.length === 0) {
        throw new BadRequestException(`Tier ${tier.id} must have at least one feeItem`);
      }
      for (const item of tier.feeItems) {
        if (!(WITHDRAWAL_FEE_ITEM_CODES as readonly string[]).includes(item.itemCode)) {
          throw new BadRequestException(`Invalid itemCode: ${item.itemCode}`);
        }
      }
    }
    return parsed;
  }

  async createLevel(
    dto: {
      levelCode: string;
      name: string;
      assetId: string;
      isDefault: boolean;
      tiersJson: string;
      createdByUserId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    // Validate asset exists and is ACTIVE
    const asset = await db.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException(`Asset ${dto.assetId} is not ACTIVE`);
    }

    // Validate levelCode uniqueness
    const existing = await db.withdrawalFeeLevel.findUnique({ where: { levelCode: dto.levelCode } });
    if (existing) {
      throw new ConflictException(`levelCode ${dto.levelCode} already exists`);
    }

    // Validate tiersJson
    this.validateTiersJson(dto.tiersJson);

    return db.withdrawalFeeLevel.create({
      data: {
        levelCode: dto.levelCode,
        name: dto.name,
        assetId: dto.assetId,
        isDefault: dto.isDefault,
        tiersJson: dto.tiersJson,
        configHash: this.computeHash(dto.tiersJson),
        status: 'PENDING_APPROVAL',
        createdByUserId: dto.createdByUserId,
      },
    });
  }

  async linkApprovalCase(levelCode: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.withdrawalFeeLevel.update({
      where: { levelCode },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async activateLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await db.withdrawalFeeLevel.findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    if (level.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Level ${levelCode} is ${level.status}, expected PENDING_APPROVAL`);
    }
    await db.withdrawalFeeLevel.update({
      where: { levelCode },
      data: { status: 'ACTIVE', approvalCaseId: null, approvalCaseNo: null },
    });
  }

  async deleteRejectedLevel(levelCode: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const level = await db.withdrawalFeeLevel.findUnique({ where: { levelCode } });
    if (!level) throw new NotFoundException(`Level ${levelCode} not found`);
    if (level.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Cannot delete level ${levelCode}: status is ${level.status}`);
    }
    await db.withdrawalFeeLevel.delete({ where: { levelCode } });
  }

  async deleteById(id: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.withdrawalFeeLevel.delete({ where: { id } });
  }

  // ─── Change Request CRUD ─────────────────────────────────

  async generateNextRequestNo(): Promise<string> {
    const last = await this.prisma.withdrawalFeeLevelChangeRequest.findFirst({
      orderBy: { requestNo: 'desc' },
      select: { requestNo: true },
    });
    if (!last || last.requestNo === 'TEMP') return 'WFLC-001';
    const num = parseInt(last.requestNo.replace('WFLC-', ''), 10);
    return `WFLC-${String(num + 1).padStart(3, '0')}`;
  }

  async createChangeRequest(
    dto: {
      levelId: string;
      levelCode: string;
      proposedTiersJson: string;
      changeReason: string;
      requestedByUserId: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    // Validate no pending request for same level
    const pendingRequest = await db.withdrawalFeeLevelChangeRequest.findFirst({
      where: { levelId: dto.levelId, status: 'PENDING_APPROVAL' },
    });
    if (pendingRequest) {
      throw new ConflictException(`Level ${dto.levelCode} already has a pending change request: ${pendingRequest.requestNo}`);
    }

    // Validate proposed config
    this.validateTiersJson(dto.proposedTiersJson);

    // Snapshot current
    const level = await db.withdrawalFeeLevel.findUnique({ where: { id: dto.levelId } });
    if (!level) throw new NotFoundException(`Level ${dto.levelId} not found`);

    for (let attempt = 0; attempt < 3; attempt++) {
      const requestNo = await this.generateNextRequestNo();
      try {
        return await db.withdrawalFeeLevelChangeRequest.create({
          data: {
            requestNo,
            levelId: dto.levelId,
            levelCode: dto.levelCode,
            currentTiersJson: level.tiersJson,
            currentConfigHash: level.configHash,
            proposedTiersJson: dto.proposedTiersJson,
            changeReason: dto.changeReason,
            requestedByUserId: dto.requestedByUserId,
            status: 'PENDING_APPROVAL',
          },
        });
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          if (attempt === 2) throw new ConflictException('Failed to generate unique requestNo after 3 attempts');
          continue;
        }
        throw e;
      }
    }
  }

  async linkApprovalCaseToRequest(requestNo: string, caseId: string, caseNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.withdrawalFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { approvalCaseId: caseId, approvalCaseNo: caseNo },
    });
  }

  async executeChange(requestNo: string, tx?: Prisma.TransactionClient) {
    const run = async (db: Prisma.TransactionClient | PrismaService) => {
      const request = await db.withdrawalFeeLevelChangeRequest.findUnique({ where: { requestNo } });
      if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
      if (request.status !== 'PENDING_APPROVAL') {
        throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
      }

      const level = await db.withdrawalFeeLevel.findUnique({ where: { id: request.levelId } });
      if (!level) throw new NotFoundException(`Level for request ${requestNo} not found`);
      if (level.status !== 'ACTIVE') {
        throw new ConflictException(`Level ${level.levelCode} is ${level.status}, must be ACTIVE to apply change`);
      }

      // Conflict detection: hash comparison
      if (request.currentConfigHash !== level.configHash) {
        throw new ConflictException(
          `Conflict: level config changed since request was created (snapshot hash: ${request.currentConfigHash}, actual: ${level.configHash})`,
        );
      }

      const newHash = this.computeHash(request.proposedTiersJson);

      const updatedLevel = await db.withdrawalFeeLevel.update({
        where: { id: level.id },
        data: { tiersJson: request.proposedTiersJson, configHash: newHash },
      });

      const updatedRequest = await db.withdrawalFeeLevelChangeRequest.update({
        where: { requestNo },
        data: { status: 'APPROVED', executedAt: new Date() },
      });

      return { level: updatedLevel, request: updatedRequest };
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(async (txn) => run(txn));
  }

  async rejectChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.withdrawalFeeLevelChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    if (request.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
    }
    await db.withdrawalFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { status: 'REJECTED' },
    });
  }

  async cancelChangeRequest(requestNo: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    const request = await db.withdrawalFeeLevelChangeRequest.findUnique({ where: { requestNo } });
    if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
    if (request.status !== 'PENDING_APPROVAL') {
      throw new ConflictException(`Request ${requestNo} is ${request.status}, expected PENDING_APPROVAL`);
    }
    await db.withdrawalFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { status: 'CANCELLED' },
    });
  }

  async markRequestExecutionFailed(requestNo: string, reason: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? this.prisma;
    await db.withdrawalFeeLevelChangeRequest.update({
      where: { requestNo },
      data: { status: 'FAILED', failureReason: reason },
    });
  }

  async findChangeRequestById(id: string) {
    const request = await this.prisma.withdrawalFeeLevelChangeRequest.findUnique({ where: { id } });
    if (!request) throw new NotFoundException(`Change request not found: ${id}`);
    return request;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.service.ts
git commit -m "feat(withdrawal-fee-level): add L1 domain service — level + change request CRUD"
```

---

### Task 5: L1 Domain Service — WithdrawalFeeLevelBindingService

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding.service.ts`

- [ ] **Step 1: Create the binding L1 service**

```typescript
// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding.service.ts
import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class WithdrawalFeeLevelBindingService {
  constructor(private readonly prisma: PrismaService) {}

  async findByCustomer(customerId: string) {
    return this.prisma.withdrawalFeeLevelBinding.findMany({
      where: { customerId },
      include: {
        level: {
          select: { levelCode: true, name: true, assetId: true, status: true, enabled: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByLevel(levelId: string) {
    return this.prisma.withdrawalFeeLevelBinding.findMany({
      where: { levelId },
      include: {
        customer: { select: { customerNo: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async bind(
    dto: { customerId: string; levelId: string; boundByUserId: string },
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const existing = await db.withdrawalFeeLevelBinding.findUnique({
      where: { customerId_levelId: { customerId: dto.customerId, levelId: dto.levelId } },
    });
    if (existing) {
      throw new ConflictException('Customer is already bound to this level');
    }

    return db.withdrawalFeeLevelBinding.create({
      data: {
        customerId: dto.customerId,
        levelId: dto.levelId,
        boundByUserId: dto.boundByUserId,
        boundAt: new Date(),
      },
    });
  }

  async unbind(
    customerId: string,
    levelId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;

    const existing = await db.withdrawalFeeLevelBinding.findUnique({
      where: { customerId_levelId: { customerId, levelId } },
    });
    if (!existing) {
      throw new NotFoundException('Binding not found');
    }

    return db.withdrawalFeeLevelBinding.delete({
      where: { customerId_levelId: { customerId, levelId } },
    });
  }

  async findBoundLevelIds(customerId: string, tx?: Prisma.TransactionClient): Promise<string[]> {
    const db = tx ?? this.prisma;
    const bindings = await db.withdrawalFeeLevelBinding.findMany({
      where: { customerId },
      select: { levelId: true },
    });
    return bindings.map((b) => b.levelId);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding.service.ts
git commit -m "feat(withdrawal-fee-level): add L1 binding service — bind/unbind CRUD"
```

---

### Task 6: L2 Approval Handlers

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-approval.service.ts`
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-change-approval.service.ts`

**Reference:** `src/modules/governance/transaction-limits/transaction-limit-change-approval.service.ts` (17 lines)

- [ ] **Step 1: Create creation approval handler**

```typescript
// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-approval.service.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class WithdrawalFeeLevelCreationApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION;
  readonly workflowType = AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CREATION;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

- [ ] **Step 2: Create change approval handler**

```typescript
// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-change-approval.service.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class WithdrawalFeeLevelChangeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE;
  readonly workflowType = AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CHANGE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-approval.service.ts \
        src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-change-approval.service.ts
git commit -m "feat(withdrawal-fee-level): add L2 approval handlers for creation + change"
```

---

### Task 7: L3 Workflow — Level Creation

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-workflow.service.ts`

**Reference:** `src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts` (266 lines)

- [ ] **Step 1: Create the creation workflow service**

Mirror `TransactionLimitCreationWorkflowService` exactly, substituting:

| TransactionLimit | WithdrawalFeeLevel |
|---|---|
| `transactionLimitPolicy` | `withdrawalFeeLevel` |
| `limitsService` | `feeLevelService` |
| `ApprovalActionTypes.TRANSACTION_LIMIT_CREATION` | `ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CREATION` |
| `AuditGovernanceActions.TRANSACTION_LIMIT_CREATION.*` | `AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CREATION.*` |
| `AuditEntityTypes.TRANSACTION_LIMIT_POLICY` | `AuditEntityTypes.WITHDRAWAL_FEE_LEVEL` |
| `AuditBusinessWorkflowTypes.TRANSACTION_LIMIT_CREATION` | `AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_CREATION` |
| SECONDARY_EVENT | `'workflow.withdrawal-fee-level-creation.decided'` |
| `policyNo` | `levelCode` |
| `tradingTier/operationType/period/limitAmount` | `levelCode/name/assetId/isDefault/tiersJson` |

Key method: `initiateCreate(dto, actor)`:
1. Validate input
2. Call `feeLevelService.createLevel(...)` → status PENDING_APPROVAL
3. Create approval case with `objectSnapshot` containing full config
4. Link approval case to level
5. Write `CREATION_REQUESTED` audit log

Key event handler: `@OnEvent('workflow.withdrawal-fee-level-creation.decided')`:
- APPROVED → call `feeLevelService.activateLevel(levelCode)`, write `CREATION_APPLIED`
- Other → call `feeLevelService.deleteRejectedLevel(levelCode)`, write `CREATION_CANCELLED`

Full code: follow the reference file line-by-line with the substitution table above. Constructor injects `PrismaService`, `WithdrawalFeeLevelService`, `ApprovalsService`, `AuditLogsService`.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-workflow.service.ts
git commit -m "feat(withdrawal-fee-level): add L3 creation workflow with approval + audit"
```

---

### Task 8: L3 Workflow — Level Change

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-change-workflow.service.ts`

**Reference:** `src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts` (338 lines)

- [ ] **Step 1: Create the change workflow service**

Mirror `TransactionLimitChangeWorkflowService` with substitutions:

| TransactionLimit | WithdrawalFeeLevel |
|---|---|
| `limitsService` | `feeLevelService` |
| `policyNo` → `findByPolicyNo(policyNo)` | `levelCode` → `findByLevelCode(levelCode)` |
| `ApprovalActionTypes.TRANSACTION_LIMIT_CHANGE` | `ApprovalActionTypes.WITHDRAWAL_FEE_LEVEL_CHANGE` |
| `AuditGovernanceActions.TRANSACTION_LIMIT_CHANGE.*` | `AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_CHANGE.*` |
| SECONDARY_EVENT | `'workflow.withdrawal-fee-level-change.decided'` |
| `currentAmount/proposedAmount` | `currentTiersJson/proposedTiersJson + currentConfigHash` |
| conflict: `currentAmount != policy.limitAmount` | conflict: `currentConfigHash != level.configHash` |

Key method: `requestChange(levelCode, proposedTiersJson, changeReason, actor)`:
1. Find level, verify ACTIVE
2. Validate no pending request
3. Call `feeLevelService.createChangeRequest(...)` — L1 validates + snapshots
4. Create approval case with `objectSnapshot` containing old/new configs
5. Write `CHANGE_REQUESTED` audit log

Key event handler: `@OnEvent('workflow.withdrawal-fee-level-change.decided')`:
- APPROVED → conflict detection (configHash), then `feeLevelService.executeChange(requestNo)`, write `CHANGE_APPLIED` or `CHANGE_APPLY_FAILED`
- Other → `rejectChangeRequest`/`cancelChangeRequest`, write `CHANGE_CANCELLED`

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-change-workflow.service.ts
git commit -m "feat(withdrawal-fee-level): add L3 change workflow with hash conflict detection"
```

---

### Task 9: L3 Workflow — Level Binding

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding-workflow.service.ts`

- [ ] **Step 1: Create the binding workflow service**

This is simpler — no L2 approval, just L3 orchestration + audit.

```typescript
// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding-workflow.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';

@Injectable()
export class WithdrawalFeeLevelBindingWorkflowService {
  private readonly logger = new Logger(WithdrawalFeeLevelBindingWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: WithdrawalFeeLevelService,
    private readonly bindingService: WithdrawalFeeLevelBindingService,
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

  async bindLevel(
    dto: { customerId: string; levelId: string },
    actor: ApprovalActorContext,
  ) {
    // Validate customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: { id: true, customerNo: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${dto.customerId} not found`);

    // Validate level exists and is ACTIVE
    const level = await this.feeLevelService.findById(dto.levelId);
    if (level.status !== 'ACTIVE') {
      throw new BadRequestException(`Level ${level.levelCode} is not ACTIVE`);
    }

    const traceId = crypto.randomUUID();

    const binding = await this.bindingService.bind({
      customerId: dto.customerId,
      levelId: dto.levelId,
      boundByUserId: actor.userId,
    });

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_BINDING.LEVEL_BOUND,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        entityId: binding.id,
        entityNo: `${customer.customerNo}:${level.levelCode}`,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          customerId: dto.customerId,
          customerNo: customer.customerNo,
          levelId: dto.levelId,
          levelCode: level.levelCode,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_BOUND_${binding.id}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { bindingId: binding.id, levelCode: level.levelCode, customerNo: customer.customerNo };
  }

  async unbindLevel(
    dto: { customerId: string; levelId: string },
    actor: ApprovalActorContext,
  ) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: dto.customerId },
      select: { id: true, customerNo: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${dto.customerId} not found`);

    const level = await this.feeLevelService.findById(dto.levelId);

    const traceId = crypto.randomUUID();

    const deleted = await this.bindingService.unbind(dto.customerId, dto.levelId);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_BINDING.LEVEL_UNBOUND,
        entityType: AuditEntityTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        entityId: deleted.id,
        entityNo: `${customer.customerNo}:${level.levelCode}`,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_FEE_LEVEL_BINDING,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          customerId: dto.customerId,
          customerNo: customer.customerNo,
          levelId: dto.levelId,
          levelCode: level.levelCode,
        },
        requestId: `WITHDRAWAL_FEE_LEVEL_UNBOUND_${deleted.id}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return { levelCode: level.levelCode, customerNo: customer.customerNo };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-binding-workflow.service.ts
git commit -m "feat(withdrawal-fee-level): add L3 binding workflow with audit logging"
```

---

### Task 10: WithdrawQuoteService — Extract from PricingCenterService

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts`

**Source methods to extract from** `src/modules/trading/pricing-center/pricing-center.service.ts`:
- `resolveWithdrawalQuote()` (line ~2298) → refactor for multi-level resolution
- `createWithdrawPricingQuote()` (line ~2398) → new: uses level-based resolution
- `consumeWithdrawQuoteForWithdraw()` (line ~2525) → move as-is
- `cancelWithdrawPricingQuote()` (line ~2578) → move as-is
- `getActiveWithdrawQuoteOrThrow()` (line ~2493) → move as-is
- `simulateWithdrawal()` (line ~2358) → move + adapt

- [ ] **Step 1: Read the existing methods from PricingCenterService**

Read lines 2298–2600 of `src/modules/trading/pricing-center/pricing-center.service.ts` to understand the exact implementation.

- [ ] **Step 2: Create WithdrawQuoteService**

The service must implement multi-level resolution per the spec:

```typescript
// src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts
import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions } from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { PricingEngineService } from '../pricing-center/pricing-engine.service';
import {
  WithdrawalTier,
  CalculatedFeeLine,
  WITHDRAW_QUOTE_TTL_SECONDS,
} from '../pricing-center/types/pricing.types';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';
import { FeeLevelTiersConfig } from './types/fee-level.types';

interface ResolvedQuote {
  feeLevelId: string;
  feeLevelCode: string;
  matchedTierId: string;
  matchedTierName: string;
  fees: CalculatedFeeLine[];
  totals: Record<string, string>;
  totalFee: Prisma.Decimal;
}

@Injectable()
export class WithdrawQuoteService {
  private readonly logger = new Logger(WithdrawQuoteService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly feeLevelService: WithdrawalFeeLevelService,
    private readonly bindingService: WithdrawalFeeLevelBindingService,
    private readonly engineService: PricingEngineService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async resolveBestLevel(input: {
    assetId: string;
    amount: Prisma.Decimal;
    customerId: string;
  }): Promise<ResolvedQuote | null> {
    // 1. Find all active+enabled levels for this asset
    const allLevels = await this.feeLevelService.findActiveByAsset(input.assetId);
    if (allLevels.length === 0) return null;

    // 2. Get customer bound level IDs
    const boundLevelIds = await this.bindingService.findBoundLevelIds(input.customerId);
    const boundSet = new Set(boundLevelIds);

    // 3. Filter applicable levels: isDefault=true OR customer is bound
    const applicableLevels = allLevels.filter(
      (l) => l.isDefault || boundSet.has(l.id),
    );
    if (applicableLevels.length === 0) return null;

    // 4. For each level, match tier and calculate fees
    const candidates: ResolvedQuote[] = [];

    for (const level of applicableLevels) {
      const config: FeeLevelTiersConfig = JSON.parse(level.tiersJson);
      const matchedTier = this.engineService.findMatchedWithdrawalTier({
        amount: input.amount,
        tiers: config.tiers,
      });
      if (!matchedTier) continue;

      const { lines, totals } = this.engineService.calculateFeeLines(
        input.amount,
        matchedTier.feeItems,
      );

      const totalFee = lines.reduce(
        (sum, line) => sum.add(new Prisma.Decimal(line.amount)),
        new Prisma.Decimal(0),
      );

      candidates.push({
        feeLevelId: level.id,
        feeLevelCode: level.levelCode,
        matchedTierId: matchedTier.id,
        matchedTierName: matchedTier.name,
        fees: lines,
        totals,
        totalFee,
      });
    }

    if (candidates.length === 0) return null;

    // 5. Pick lowest total fee
    candidates.sort((a, b) => a.totalFee.comparedTo(b.totalFee));
    return candidates[0];
  }

  async createQuote(input: {
    ownerType: string;
    ownerId: string;
    ownerNo?: string;
    assetId: string;
    assetCode: string;
    amount: Prisma.Decimal;
    customerId: string;
  }) {
    const resolved = await this.resolveBestLevel({
      assetId: input.assetId,
      amount: input.amount,
      customerId: input.customerId,
    });

    if (!resolved) {
      throw new BadRequestException('No applicable fee level found for this asset and amount');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + WITHDRAW_QUOTE_TTL_SECONDS * 1000);
    const quoteNo = `WQ-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const quote = await this.prisma.withdrawPricingQuote.create({
      data: {
        quoteNo,
        status: 'ACTIVE',
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        ownerNo: input.ownerNo || null,
        assetId: input.assetId,
        assetCode: input.assetCode,
        amount: input.amount,
        segment: 'DEFAULT',
        riskTier: 'STANDARD',
        matchedAssetId: input.assetId,
        matchedTierId: resolved.matchedTierId,
        matchedTierName: resolved.matchedTierName,
        feeBreakdown: JSON.stringify(resolved.fees),
        totalsJson: JSON.stringify(resolved.totals),
        policyRef: `LEVEL:${resolved.feeLevelCode}`,
        expiresAt,
        feeLevelId: resolved.feeLevelId,
        feeLevelCode: resolved.feeLevelCode,
      },
    });

    return quote;
  }

  async getActiveQuoteOrThrow(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    now: Date,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const quote = await db.withdrawPricingQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, not ACTIVE`);
    }
    if (quote.expiresAt < now) {
      await db.withdrawPricingQuote.update({
        where: { id: quoteId },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Quote has expired');
    }
    return quote;
  }

  async consumeQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    withdrawAmount: Prisma.Decimal,
    withdrawId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const now = new Date();
    const quote = await this.getActiveQuoteOrThrow(quoteId, ownerType, ownerId, now, db as any);

    if (!quote.amount.equals(withdrawAmount)) {
      throw new BadRequestException(
        `Quote amount ${quote.amount} does not match withdraw amount ${withdrawAmount}`,
      );
    }

    return db.withdrawPricingQuote.update({
      where: { id: quoteId },
      data: { status: 'USED', usedAt: now },
    });
  }

  async cancelQuote(
    quoteId: string,
    ownerType: string,
    ownerId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const db = tx ?? this.prisma;
    const quote = await db.withdrawPricingQuote.findUnique({ where: { id: quoteId } });
    if (!quote) throw new NotFoundException(`Quote ${quoteId} not found`);
    if (quote.ownerType !== ownerType || quote.ownerId !== ownerId) {
      throw new BadRequestException('Quote does not belong to this owner');
    }
    if (quote.status !== 'ACTIVE') {
      throw new BadRequestException(`Quote is ${quote.status}, cannot cancel`);
    }
    return db.withdrawPricingQuote.update({
      where: { id: quoteId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -20`

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdraw-quote.service.ts
git commit -m "feat(withdrawal-fee-level): add WithdrawQuoteService with multi-level best-price resolution"
```

---

### Task 11: Admin Controller

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.controller.ts`

**Reference:** `src/modules/governance/transaction-limits/transaction-limits.controller.ts` (127 lines)

- [ ] **Step 1: Create the admin controller**

```typescript
// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.controller.ts
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { AdminPermissionGuard } from '../../identity/access-control/admin-permission.guard';
import { RequirePermissions } from '../../identity/access-control/require-permissions.decorator';
import { buildPermissionCode } from '../../identity/access-control/permission-code.util';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelCreationWorkflowService } from './withdrawal-fee-level-creation-workflow.service';
import { WithdrawalFeeLevelChangeWorkflowService } from './withdrawal-fee-level-change-workflow.service';
import { WithdrawalFeeLevelBindingWorkflowService } from './withdrawal-fee-level-binding-workflow.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';

@Controller('admin/withdrawal-fee-levels')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawalFeeLevelController {
  constructor(
    private readonly feeLevelService: WithdrawalFeeLevelService,
    private readonly creationWorkflowService: WithdrawalFeeLevelCreationWorkflowService,
    private readonly changeWorkflowService: WithdrawalFeeLevelChangeWorkflowService,
    private readonly bindingWorkflowService: WithdrawalFeeLevelBindingWorkflowService,
    private readonly bindingService: WithdrawalFeeLevelBindingService,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin access required');
  }

  private buildAdminActor(req: any): ApprovalActorContext {
    const user = req.user;
    return {
      actorType: 'ADMIN',
      userId: user.userId || user.sub,
      userNo: user.userNo,
      role: user.role,
      roleCodes: user.roleCodes || (user.role ? [user.role] : []),
    };
  }

  // ─── Level CRUD ─────────────────────────────────────────

  @Get()
  @RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels'))
  async findAll(
    @Query('assetId') assetId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    const where: Prisma.WithdrawalFeeLevelWhereInput = {};
    if (assetId) where.assetId = assetId;
    if (status) where.status = status;
    const result = await this.feeLevelService.findAll({
      skip: skip ? parseInt(skip, 10) : undefined,
      take: take ? parseInt(take, 10) : undefined,
      where,
    });
    return { items: result.items, total: result.total };
  }

  @Get(':levelCode')
  @RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels/:levelCode'))
  async findOne(@Param('levelCode') levelCode: string) {
    return this.feeLevelService.findByLevelCode(levelCode);
  }

  @Post()
  @RequirePermissions(buildPermissionCode('POST', '/admin/withdrawal-fee-levels'))
  async create(
    @Body() dto: { levelCode: string; name: string; assetId: string; isDefault: boolean; tiersJson: string; reason: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.creationWorkflowService.initiateCreate(dto, this.buildAdminActor(req));
  }

  @Post(':levelCode/change')
  @RequirePermissions(buildPermissionCode('POST', '/admin/withdrawal-fee-levels/:levelCode/change'))
  async requestChange(
    @Param('levelCode') levelCode: string,
    @Body() dto: { proposedTiersJson: string; changeReason: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.changeWorkflowService.requestChange(
      levelCode,
      dto.proposedTiersJson,
      dto.changeReason,
      this.buildAdminActor(req),
    );
  }

  // ─── Binding ────────────────────────────────────────────

  @Get(':levelCode/bindings')
  @RequirePermissions(buildPermissionCode('GET', '/admin/withdrawal-fee-levels/:levelCode/bindings'))
  async getBindings(@Param('levelCode') levelCode: string) {
    const level = await this.feeLevelService.findByLevelCode(levelCode);
    return this.bindingService.findByLevel(level.id);
  }

  @Post('bindings/bind')
  @RequirePermissions(buildPermissionCode('POST', '/admin/withdrawal-fee-levels/bindings'))
  async bindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.bindLevel(dto, this.buildAdminActor(req));
  }

  @Delete('bindings/unbind')
  @RequirePermissions(buildPermissionCode('DELETE', '/admin/withdrawal-fee-levels/bindings'))
  async unbindLevel(
    @Body() dto: { customerId: string; levelId: string },
    @Req() req: any,
  ) {
    this.ensureAdmin(req);
    return this.bindingWorkflowService.unbindLevel(dto, this.buildAdminActor(req));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.controller.ts
git commit -m "feat(withdrawal-fee-level): add admin controller for levels + bindings"
```

---

### Task 12: Module Registration

**Files:**
- Create: `src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.module.ts`

**Reference:** `src/modules/governance/transaction-limits/transaction-limits.module.ts` (25 lines)

- [ ] **Step 1: Create the module**

```typescript
// src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.module.ts
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { PricingCenterModule } from '../pricing-center/pricing-center.module';
import { WithdrawalFeeLevelService } from './withdrawal-fee-level.service';
import { WithdrawalFeeLevelBindingService } from './withdrawal-fee-level-binding.service';
import { WithdrawalFeeLevelCreationApprovalService } from './withdrawal-fee-level-creation-approval.service';
import { WithdrawalFeeLevelChangeApprovalService } from './withdrawal-fee-level-change-approval.service';
import { WithdrawalFeeLevelCreationWorkflowService } from './withdrawal-fee-level-creation-workflow.service';
import { WithdrawalFeeLevelChangeWorkflowService } from './withdrawal-fee-level-change-workflow.service';
import { WithdrawalFeeLevelBindingWorkflowService } from './withdrawal-fee-level-binding-workflow.service';
import { WithdrawQuoteService } from './withdraw-quote.service';
import { WithdrawalFeeLevelController } from './withdrawal-fee-level.controller';

@Module({
  imports: [PrismaModule, ApprovalsModule, AuditLogsModule, PricingCenterModule],
  controllers: [WithdrawalFeeLevelController],
  providers: [
    WithdrawalFeeLevelService,
    WithdrawalFeeLevelBindingService,
    WithdrawalFeeLevelCreationApprovalService,
    WithdrawalFeeLevelChangeApprovalService,
    WithdrawalFeeLevelCreationWorkflowService,
    WithdrawalFeeLevelChangeWorkflowService,
    WithdrawalFeeLevelBindingWorkflowService,
    WithdrawQuoteService,
  ],
  exports: [WithdrawalFeeLevelService, WithdrawQuoteService],
})
export class WithdrawalFeeLevelModule {}
```

- [ ] **Step 2: Register module in AppModule**

Find `app.module.ts` and add `WithdrawalFeeLevelModule` to its imports array, alongside the existing trading modules.

```typescript
import { WithdrawalFeeLevelModule } from './modules/trading/withdrawal-fee-level/withdrawal-fee-level.module';
```

- [ ] **Step 3: Verify TypeScript compiles and app starts**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/trading/withdrawal-fee-level/withdrawal-fee-level.module.ts \
        src/app.module.ts
git commit -m "feat(withdrawal-fee-level): register module in AppModule"
```

---

### Task 13: Caller Adaptation — WithdrawTransactionsService

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`

- [ ] **Step 1: Read current usage**

Read the file to find all `pricingCenterService` calls related to withdrawal quotes. The calls to replace:
- `pricingCenterService.assertWithdrawExtremeVolatilityNotBlocked(...)` — remove (no longer needed; evaluate if needed separately)
- `pricingCenterService.getActiveWithdrawQuoteOrThrow(...)` → `withdrawQuoteService.getActiveQuoteOrThrow(...)`
- `pricingCenterService.consumeWithdrawQuoteForWithdraw(...)` → `withdrawQuoteService.consumeQuote(...)`

- [ ] **Step 2: Add WithdrawQuoteService to constructor**

Add import and inject `WithdrawQuoteService` alongside the existing `PricingCenterService`. Keep `PricingCenterService` — it still handles swap-related operations.

```typescript
import { WithdrawQuoteService } from '../withdrawal-fee-level/withdraw-quote.service';

// In constructor:
private readonly withdrawQuoteService: WithdrawQuoteService,
```

- [ ] **Step 3: Replace withdrawal quote calls**

Replace each `this.pricingCenterService.getActiveWithdrawQuoteOrThrow(...)` with `this.withdrawQuoteService.getActiveQuoteOrThrow(...)`.

Replace each `this.pricingCenterService.consumeWithdrawQuoteForWithdraw(...)` with `this.withdrawQuoteService.consumeQuote(...)`.

- [ ] **Step 4: Update withdraw-transactions module imports**

Add `WithdrawalFeeLevelModule` to the imports of the withdraw-transactions module.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/withdraw-transactions/
git commit -m "refactor(withdraw): replace PricingCenterService quote calls with WithdrawQuoteService"
```

---

### Task 14: Data Migration Seed

**Files:**
- Modify: dev seed or migration script

- [ ] **Step 1: Create migration logic in dev:reset or a seed script**

The migration reads existing `PricingPolicy` where `business = 'WITHDRAWAL'`, parses `configJson`, and creates `WithdrawalFeeLevel` rows:

```typescript
// Logic to add in the existing seed/reset script
const withdrawalPolicy = await prisma.pricingPolicy.findFirst({
  where: { policyCode: 'WITHDRAWAL_PRICING' },
});

if (withdrawalPolicy) {
  const config = JSON.parse(withdrawalPolicy.configJson);
  for (const assetEntry of config.assets) {
    const levelCode = `STD-${assetEntry.assetCurrency}-${assetEntry.network || 'FIAT'}`;
    const tiersJson = JSON.stringify({ tiers: assetEntry.tiers });
    const configHash = createHash('sha256').update(tiersJson).digest('hex');

    await prisma.withdrawalFeeLevel.upsert({
      where: { levelCode },
      update: { tiersJson, configHash },
      create: {
        levelCode,
        name: `Standard ${assetEntry.assetCurrency}`,
        assetId: assetEntry.assetId,
        isDefault: true,
        enabled: true,
        tiersJson,
        configHash,
        status: 'ACTIVE',
        createdByUserId: 'SYSTEM',
      },
    });
  }
}
```

- [ ] **Step 2: Run dev:reset to verify migration**

```bash
cd Exchange_js && npm run dev:reset
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(withdrawal-fee-level): add data migration from PricingPolicy to WithdrawalFeeLevel"
```

---

### Task 15: Customer Quote Endpoint Adaptation

**Files:**
- Modify: `src/modules/trading/pricing-center/pricing-center-customer.controller.ts`

- [ ] **Step 1: Read the current customer controller**

Find the withdrawal quote endpoint (likely `POST /pricing/withdraw-quote` or similar). This endpoint currently calls `PricingCenterService.createWithdrawPricingQuote()`.

- [ ] **Step 2: Replace with WithdrawQuoteService**

Import `WithdrawQuoteService` and inject it. Replace the withdrawal quote creation call:

```typescript
import { WithdrawQuoteService } from '../withdrawal-fee-level/withdraw-quote.service';

// Replace:
//   this.pricingCenterService.createWithdrawPricingQuote(...)
// With:
//   this.withdrawQuoteService.createQuote(...)
```

Keep all Swap-related endpoints pointing to `PricingCenterService`.

- [ ] **Step 3: Update pricing-center module to import WithdrawalFeeLevelModule**

Or alternatively, move the customer quote endpoint to a new controller under `withdrawal-fee-level/`. Choose whichever matches the codebase convention.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/pricing-center/ src/modules/trading/withdrawal-fee-level/
git commit -m "refactor(pricing): redirect customer withdrawal quote endpoint to WithdrawQuoteService"
```

---

### Task 16: Roadmap Update

**Files:**
- Modify: `doc-final/reference/roadmap.md`

- [ ] **Step 1: Add to V5 MVP section**

In the V5 Crypto Withdrawal section, add under workflows:

```markdown
- [ ] Withdrawal Fee Level Creation（费率等级创建审批）
- [ ] Withdrawal Fee Level Change（费率等级变更审批）
- [ ] Withdrawal Fee Level Binding（客户费率等级绑定/解绑）
```

Under supporting features:

```markdown
- [ ] WithdrawQuoteService 拆分重构（从 PricingCenterService 迁出）
- [ ] 数据迁移（PricingPolicy → WithdrawalFeeLevel）
```

- [ ] **Step 2: Commit**

```bash
git add doc-final/reference/roadmap.md
git commit -m "docs: add withdrawal fee level workflows to V5 roadmap"
```

---

### Task 17: End-to-End Verification

- [ ] **Step 1: Start the stack**

```bash
cd Exchange_js && npm run dev:start
```

- [ ] **Step 2: Verify level creation endpoint**

```bash
curl -s http://localhost:3500/admin/withdrawal-fee-levels | jq '.total'
```

Expected: count of migrated levels.

- [ ] **Step 3: Verify TypeScript compiles clean**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 4: Test withdrawal quote flow**

Create a withdrawal quote via `POST /withdraw-transactions/quotes` (existing customer endpoint). Verify the response includes `feeLevelId` and `feeLevelCode`.
