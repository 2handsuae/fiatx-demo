# V3 Batch 2 — Workflow Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate 26 Rule 5 violations across 5 workflow files by replacing direct Prisma writes with L1 domain service method calls.

**Architecture:** Three prerequisite tasks add missing L1 methods/expand whitelist, then 5 workflow refactoring tasks run in parallel (each touches a single file), followed by a final verification task.

**Tech Stack:** NestJS, Prisma, TypeScript

---

## Task Dependency Graph

```
Tasks 1-3 (prerequisites): all independent, run in parallel
Tasks 4-8 (workflow refactors): all independent, run in parallel AFTER 1-3
Task 9 (verification): depends on ALL above
```

---

## Task 1: Add `createAsset` L1 Method

**Files:**
- Modify: `src/modules/asset-treasury/assets/assets.service.ts`

- [ ] **Step 1: Add the `createAsset` method**

Add at the end of the class (before the closing brace):

```typescript
async createAsset(
  dto: {
    code: string;
    name?: string;
    type: string;
    network?: string;
    decimals?: number;
    description?: string;
    contractAddress?: string;
    minDepositAmount?: number;
    maxDepositAmount?: number;
    minWithdrawAmount?: number;
    maxWithdrawAmount?: number;
    depositEnabled?: boolean;
    withdrawalEnabled?: boolean;
  },
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? this.prisma;

  // Uniqueness check
  const existing = await db.asset.findFirst({
    where: { type: dto.type, code: dto.code, network: dto.network ?? null },
  });
  if (existing) {
    throw new ConflictException(
      `Asset already exists: type=${dto.type} code=${dto.code} network=${dto.network || 'N/A'}`,
    );
  }

  // P2002 retry for assetNo generation
  for (let attempt = 0; attempt < 3; attempt++) {
    const assetNo = generateReferenceNo('AS');
    try {
      return await db.asset.create({
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
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        if (attempt === 2) throw new ConflictException('Failed to generate unique assetNo after 3 attempts');
        continue;
      }
      throw e;
    }
  }
}
```

Ensure `Prisma` is imported from `@prisma/client` (it already is) and `generateReferenceNo` is imported (it already is).

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/assets/assets.service.ts
git commit -m "feat(assets): add createAsset L1 method with P2002 retry"
```

---

## Task 2: Add `markRequestExecutionFailed` L1 Method

**Files:**
- Modify: `src/modules/governance/transaction-limits/transaction-limits.service.ts`

- [ ] **Step 1: Add the method**

Add at the end of the class:

```typescript
async markRequestExecutionFailed(requestNo: string, reason: string, tx?: Prisma.TransactionClient): Promise<void> {
  const db = tx ?? this.prisma;
  const request = await db.transactionLimitChangeRequest.findUnique({ where: { requestNo } });
  if (!request) throw new NotFoundException(`Change request ${requestNo} not found`);
  if (!['PENDING_APPROVAL', 'APPROVED'].includes(request.status)) {
    throw new ConflictException(`Request ${requestNo} is ${request.status}, cannot mark as failed`);
  }
  await db.transactionLimitChangeRequest.update({
    where: { requestNo },
    data: { status: 'EXECUTION_FAILED', failureReason: reason },
  });
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limits.service.ts
git commit -m "feat(transaction-limits): add markRequestExecutionFailed L1 method"
```

---

## Task 3: Extend Wallet Status Transition Whitelist

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`

- [ ] **Step 1: Update the whitelist**

Find the `WALLET_STATUS_TRANSITIONS` static field and change:

```typescript
PENDING_APPROVAL: ['CREATING'],
```

to:

```typescript
PENDING_APPROVAL: ['CREATING', 'ACTIVE'],
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/wallets.service.ts
git commit -m "feat(wallets): extend status whitelist to allow PENDING_APPROVAL → ACTIVE for fiat shortcut"
```

---

## Task 4: Refactor asset-activation-workflow

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts`

- [ ] **Step 1: Add AssetsService import and injection**

Add to imports:
```typescript
import { AssetsService } from './assets.service';
```

Add to constructor:
```typescript
private readonly assetsService: AssetsService,
```

- [ ] **Step 2: Replace the direct Prisma write in executeActivation**

In `executeActivation`, replace these lines (around line 171-178):

```typescript
      const asset = await this.prisma.asset.findUnique({ where: { id: event.entityRef } });
      if (!asset || asset.status !== 'PROVISIONING') {
        throw new ConflictException(
          `Asset ${event.entityRef} is not in PROVISIONING status (current: ${asset?.status ?? 'NOT_FOUND'})`,
        );
      }

      const updated = await this.prisma.asset.update({
        where: { id: event.entityRef },
        data: { status: 'ACTIVE' },
      });
```

With:

```typescript
      // Find asset to get assetNo (entityRef is the asset id)
      const asset = await this.assetsService.findByAssetNo(
        (await this.prisma.asset.findUnique({ where: { id: event.entityRef }, select: { assetNo: true } }))?.assetNo ?? '',
      );
      if (!asset) {
        throw new ConflictException(`Asset ${event.entityRef} not found`);
      }

      const updated = await this.assetsService.activateAsset(asset.assetNo);
```

**Alternative simpler approach** — since `assetsService.activateAsset` does its own status check, and we need assetNo:

```typescript
      const assetRecord = await this.prisma.asset.findUnique({ where: { id: event.entityRef } });
      if (!assetRecord) {
        throw new ConflictException(`Asset ${event.entityRef} not found`);
      }

      const updated = await this.assetsService.activateAsset(assetRecord.assetNo);
```

Use this simpler approach. The `activateAsset` L1 method already validates PROVISIONING status internally.

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-activation-workflow.service.ts
git commit -m "refactor(activation-workflow): replace direct prisma write with assetsService.activateAsset"
```

---

## Task 5: Refactor asset-listing-workflow

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts`

- [ ] **Step 1: Add AssetsService import and injection**

Add to imports:
```typescript
import { AssetsService } from './assets.service';
```

Add to constructor:
```typescript
private readonly assetsService: AssetsService,
```

- [ ] **Step 2: Replace tx.asset.create in submitListing**

In `submitListing`, replace the `$transaction` block (around lines 51-74). The current code:

```typescript
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
```

Replace with:

```typescript
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await this.assetsService.createAsset({
          code: dto.code,
          type: dto.type,
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
        }, tx);

        const provisioned = await this.provisioningService.provision(created.id, tx);

        return { asset: { ...created, tbLedgerId: provisioned.tbLedgerId }, tbLedgerId: provisioned.tbLedgerId };
      });
```

Also remove the `assetNo` variable declaration (line ~49: `const assetNo = generateReferenceNo('AS');`) and the `generateReferenceNo` import if no longer used elsewhere in the file. The `assetNo` is now generated inside `createAsset`. Update subsequent references to use `result.asset.assetNo` instead of the local `assetNo` variable.

- [ ] **Step 3: Replace prisma.asset.update in updateProvisioning**

In `updateProvisioning` (around line 170), replace:

```typescript
    const updated = await this.prisma.asset.update({
      where: { id: asset.id },
      data,
    });
```

With:

```typescript
    const updated = await this.assetsService.updateProvisioningFields(assetNo, dto);
```

Also remove the manual field-building code (lines 156-168) since `updateProvisioningFields` handles partial updates internally. The method already validates PROVISIONING status, so the earlier status check (lines 148-153) is redundant but harmless (keep for clear error messages at the workflow level).

Simplified `updateProvisioning`:

```typescript
  async updateProvisioning(assetNo: string, dto: UpdateAssetDto, actor: AssetCreationActor): Promise<any> {
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new BadRequestException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetNo} not found` });
    }
    if (asset.status !== 'PROVISIONING') {
      throw new BadRequestException({
        code: 'ASSET_NOT_PROVISIONING',
        message: `Asset ${assetNo} is ${asset.status}, only PROVISIONING assets can be edited`,
      });
    }

    const updated = await this.assetsService.updateProvisioningFields(assetNo, dto);
    if (!updated || updated.id === asset.id && JSON.stringify(updated) === JSON.stringify(asset)) {
      return { asset };
    }

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_CREATION.ASSET_PROVISIONING_UPDATED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_CREATION,
        result: AuditResult.SUCCESS,
        reason: 'Asset updated during provisioning',
        metadata: { updatedFields: Object.keys(dto).filter(k => (dto as any)[k] !== undefined) },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || 'ADMIN',
      },
    );

    return { asset: updated };
  }
```

- [ ] **Step 4: Remove unused import**

Remove `generateReferenceNo` import if no longer used in this file.

- [ ] **Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing-workflow.service.ts
git commit -m "refactor(listing-workflow): replace direct prisma writes with assetsService L1 methods"
```

---

## Task 6: Refactor custodian-wallet-create-workflow

**Files:**
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`

This is the largest refactor (11 violations). The pattern is consistent: replace `this.prisma.wallet.*` with `this.walletsService.*`.

- [ ] **Step 1: Add WalletsService import and injection**

Add to imports:
```typescript
import { WalletsService } from './wallets.service';
```

Add to constructor:
```typescript
private readonly walletsService: WalletsService,
```

- [ ] **Step 2: Replace wallet.create in initiateCreate (line 111)**

Replace:
```typescript
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
        vaultId: dto.vaultId ?? null,
        iban: dto.iban ?? null,
        status: 'PENDING_APPROVAL',
      },
    });
```

With:
```typescript
    const wallet = await this.walletsService.createWalletRecord({
      assetId: asset.id,
      ownerType,
      ownerId: ownerType === 'PLATFORM' ? undefined : dto.ownerId,
      walletRole: dto.role,
      status: 'PENDING_APPROVAL',
      type: walletType,
      direction,
    });
    const walletNo = wallet.walletNo;
```

- [ ] **Step 3: Replace wallet.delete rollback (line 148)**

Replace:
```typescript
      await this.prisma.wallet.delete({ where: { id: wallet.id } });
```

With:
```typescript
      await this.walletsService.deleteWallet(wallet.walletNo);
```

- [ ] **Step 4: Replace wallet.update for approvalCase linking (line 152)**

Replace:
```typescript
    await this.prisma.wallet.update({
      where: { id: wallet.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });
```

With:
```typescript
    await this.walletsService.linkApprovalCase(wallet.walletNo, approvalCase.id, approvalCase.approvalNo);
```

- [ ] **Step 5: Replace fiat shortcut activation (line 227)**

Replace:
```typescript
      await this.prisma.wallet.update({ where: { id: walletId }, data: { status: 'ACTIVE' } });
```

With:
```typescript
      await this.walletsService.transitionStatus(wallet.walletNo, 'PENDING_APPROVAL', 'ACTIVE', { iban: wallet.iban });
```

- [ ] **Step 6: Replace CREATING transition (line 246)**

Replace:
```typescript
    await this.prisma.wallet.update({ where: { id: walletId }, data: { status: 'CREATING' } });
```

With:
```typescript
    await this.walletsService.transitionStatus(wallet.walletNo, 'PENDING_APPROVAL', 'CREATING');
```

- [ ] **Step 7: Replace ACTIVE + vault details (line 256)**

Replace:
```typescript
      await this.prisma.wallet.update({
        where: { id: walletId },
        data: {
          status: 'ACTIVE',
          vaultId: result.vaultId,
          address: result.address ?? wallet.address,
          iban: result.iban ?? wallet.iban,
        },
      });
```

With:
```typescript
      await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'ACTIVE', {
        vaultId: result.vaultId,
        address: result.address ?? wallet.address,
        iban: result.iban ?? wallet.iban,
      });
```

- [ ] **Step 8: Replace FAILED transition (line 284)**

Replace:
```typescript
      await this.prisma.wallet.update({ where: { id: walletId }, data: { status: 'FAILED' } });
```

With:
```typescript
      await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'FAILED');
```

- [ ] **Step 9: Replace cancellation delete (line 305)**

Replace:
```typescript
    await this.prisma.wallet.delete({ where: { id: walletId } });
```

With:
```typescript
    await this.walletsService.deleteWallet(wallet.walletNo);
```

- [ ] **Step 10: Replace retry CREATING (line 338)**

Replace:
```typescript
    await this.prisma.wallet.update({ where: { id: wallet.id }, data: { status: 'CREATING' } });
```

With:
```typescript
    await this.walletsService.transitionStatus(wallet.walletNo, 'FAILED', 'CREATING');
```

- [ ] **Step 11: Replace retry ACTIVE (line 348)**

Replace:
```typescript
      const updated = await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: 'ACTIVE',
          vaultId: result.vaultId,
          address: result.address ?? wallet.address,
          iban: result.iban ?? wallet.iban,
        },
      });
```

With:
```typescript
      const updated = await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'ACTIVE', {
        vaultId: result.vaultId,
        address: result.address ?? wallet.address,
        iban: result.iban ?? wallet.iban,
      });
```

- [ ] **Step 12: Replace retry FAILED (line 380)**

Replace:
```typescript
      await this.prisma.wallet.update({ where: { id: wallet.id }, data: { status: 'FAILED' } });
```

With:
```typescript
      await this.walletsService.transitionStatus(wallet.walletNo, 'CREATING', 'FAILED');
```

- [ ] **Step 13: Update read calls to use service where possible**

Replace `this.prisma.wallet.findUnique({ where: { id: walletId }, include: { asset: true } })` with:
- Keep as-is where `include: { asset: true }` is needed (L1 `findByWalletNo` doesn't include relations)
- OR add the asset include to the prisma read (acceptable for reads in workflows)

**Decision: keep Prisma reads that need `include` — only writes are Rule 5 violations.**

- [ ] **Step 14: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 15: Commit**

```bash
git add src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts
git commit -m "refactor(custodian-wallet-workflow): replace 11 direct prisma writes with walletsService L1 methods"
```

---

## Task 7: Refactor transaction-limit-creation-workflow

**Files:**
- Modify: `src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts`

- [ ] **Step 1: Replace linkApprovalCase (line 131)**

Replace:
```typescript
    await this.prisma.transactionLimitPolicy.update({
      where: { id: policy.id },
      data: { approvalCaseId: approvalCase.id },
    });
```

With:
```typescript
    await this.limitsService.linkApprovalCaseToPolicy(policy.policyNo, approvalCase.id);
```

- [ ] **Step 2: Replace activatePolicy in executeActivation (line 207)**

Replace:
```typescript
      await this.prisma.transactionLimitPolicy.update({
        where: { id: policy.id },
        data: { status: 'ACTIVE', approvalCaseId: null },
      });
```

With:
```typescript
      await this.limitsService.activatePolicy(policy.policyNo);
```

- [ ] **Step 3: Replace delete in executeCancellation (line 277)**

Replace:
```typescript
      await this.prisma.transactionLimitPolicy.delete({ where: { id: policy.id } });
```

With:
```typescript
      await this.limitsService.deleteRejectedPolicy(policy.policyNo);
```

- [ ] **Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts
git commit -m "refactor(limit-creation-workflow): replace 3 direct prisma writes with limitsService L1 methods"
```

---

## Task 8: Refactor transaction-limit-change-workflow

**Files:**
- Modify: `src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts`

- [ ] **Step 1: Replace request create (line 97)**

Replace:
```typescript
    const request = await this.prisma.transactionLimitChangeRequest.create({
      data: {
        requestNo,
        policyId: policy.id,
        policyNo: policy.policyNo,
        currentAmount: policy.limitAmount,
        proposedAmount: new Prisma.Decimal(limitAmount),
        changeReason: changeReason.trim(),
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });
```

With:
```typescript
    const request = await this.limitsService.createChangeRequest({
      policyId: policy.id,
      policyNo: policy.policyNo,
      proposedAmount: new Prisma.Decimal(limitAmount),
      changeReason: changeReason.trim(),
      requestedByUserId: actor.userId,
    });
```

Also remove the `requestNo` generation line above it (`const requestNo = await this.limitsService.generateNextRequestNo();`) since `createChangeRequest` handles No generation internally. Update subsequent uses of `requestNo` to use `request.requestNo`.

- [ ] **Step 2: Replace rollback delete (line 143)**

Replace:
```typescript
      await this.prisma.transactionLimitChangeRequest.delete({ where: { id: request.id } });
```

With:
```typescript
      await this.limitsService.cancelChangeRequest(request.requestNo);
```

- [ ] **Step 3: Replace link approval case (line 148)**

Replace:
```typescript
    await this.prisma.transactionLimitChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });
```

With:
```typescript
    await this.limitsService.linkApprovalCaseToRequest(request.requestNo, approvalCase.id, approvalCase.approvalNo);
```

- [ ] **Step 4: Replace "policy not found" failure (line 231)**

Replace:
```typescript
        await this.prisma.transactionLimitChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', failureReason: 'Policy no longer exists' },
        });
```

With:
```typescript
        await this.limitsService.markRequestExecutionFailed(request.requestNo, 'Policy no longer exists');
```

- [ ] **Step 5: Replace "conflict" failure (line 248)**

Replace:
```typescript
        await this.prisma.transactionLimitChangeRequest.update({
          where: { id: request.id },
          data: { status: 'APPROVED', failureReason: reason },
        });
```

With:
```typescript
        await this.limitsService.markRequestExecutionFailed(request.requestNo, reason);
```

- [ ] **Step 6: Replace executeChange logic (lines 280-287)**

Replace the two Prisma calls:
```typescript
      await this.prisma.transactionLimitPolicy.update({
        where: { id: policy.id },
        data: { limitAmount: request.proposedAmount },
      });

      await this.prisma.transactionLimitChangeRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', executedAt: new Date() },
      });
```

With:
```typescript
      await this.limitsService.executeChange(request.requestNo);
```

Note: `executeChange` does its own conflict check internally, so the earlier conflict check (step 5) should be removed or the L1 method's ConflictException should be caught. **Recommended approach:** Remove the manual conflict check (lines 241-270) and let `executeChange` handle it. Catch its ConflictException and map to the failure flow:

```typescript
      try {
        await this.limitsService.executeChange(request.requestNo);
      } catch (conflictErr) {
        if (conflictErr instanceof ConflictException) {
          await this.limitsService.markRequestExecutionFailed(request.requestNo, conflictErr.message);
          await this.approvalsService.markExecutionResult(approvalId, false, SYSTEM_ACTOR, conflictErr.message);
          await this.auditLogsService.recordSystem({ /* CHANGE_APPLY_FAILED audit */ });
          return;
        }
        throw conflictErr;
      }
```

- [ ] **Step 7: Replace catch-block failure marking (line 327)**

Replace:
```typescript
        await this.prisma.transactionLimitChangeRequest.update({
          where: { id: requestId },
          data: { status: 'APPROVED', failureReason: err.message },
        });
```

With:
```typescript
        await this.limitsService.markRequestExecutionFailed(request.requestNo, err.message).catch(() => {});
```

- [ ] **Step 8: Replace cancellation status update (line 369)**

Replace:
```typescript
      const newStatus = decision === 'REJECTED' ? 'REJECTED' : 'CANCELLED';
      await this.prisma.transactionLimitChangeRequest.update({
        where: { id: request.id },
        data: { status: newStatus },
      });
```

With:
```typescript
      if (decision === 'REJECTED') {
        await this.limitsService.rejectChangeRequest(request.requestNo);
      } else {
        await this.limitsService.cancelChangeRequest(request.requestNo);
      }
```

- [ ] **Step 9: Add ConflictException import**

Add `ConflictException` to the existing `@nestjs/common` import if not already there.

- [ ] **Step 10: Verify build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 11: Commit**

```bash
git add src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts
git commit -m "refactor(limit-change-workflow): replace 9 direct prisma writes with limitsService L1 methods"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Full TypeScript build**

Run: `npx tsc --noEmit`
Expected: Zero errors

- [ ] **Step 2: Grep for remaining Rule 5 violations**

Run:
```bash
grep -n "this\.prisma\.\(asset\|wallet\|transactionLimitPolicy\|transactionLimitChangeRequest\)\.\(create\|update\|updateMany\|delete\)" \
  src/modules/asset-treasury/assets/asset-activation-workflow.service.ts \
  src/modules/asset-treasury/assets/asset-listing-workflow.service.ts \
  src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts \
  src/modules/governance/transaction-limits/transaction-limit-creation-workflow.service.ts \
  src/modules/governance/transaction-limits/transaction-limit-change-workflow.service.ts
```

Expected: Zero matches (only `$transaction` and read calls should remain)

- [ ] **Step 3: Commit final state (if any fixups needed)**

```bash
git add -A && git commit -m "fix: address any remaining Rule 5 violations found in verification"
```
