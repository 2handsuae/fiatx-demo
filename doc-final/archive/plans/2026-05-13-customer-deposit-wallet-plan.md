# Customer Deposit Wallet Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow customers to self-create crypto deposit addresses (C_DEP) and fiat VIBANs (C_VIBAN) by calling the custodian adapter synchronously, without admin approval.

**Architecture:** New `POST /client/deposit-wallets` endpoint with a dedicated controller + service. Reuses the existing `CustodianAdapter` DI token (mock adapter). Frontend Deposit.tsx switches to the new endpoint.

**Tech Stack:** NestJS, Prisma, existing CustodianAdapter interface, React (Deposit.tsx)

---

### Task 1: Add audit action constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add DEPOSIT_WALLET_CREATED and DEPOSIT_WALLET_CREATE_FAILED to AuditActions**

In `audit-actions.constant.ts`, add two new entries to the `AuditActions` object, after the existing `WALLET_STATUS_UPDATED` entry:

```typescript
DEPOSIT_WALLET_CREATED: 'DEPOSIT_WALLET_CREATED',
DEPOSIT_WALLET_CREATE_FAILED: 'DEPOSIT_WALLET_CREATE_FAILED',
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to audit actions.

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat: add DEPOSIT_WALLET audit action constants"
```

---

### Task 2: Create DTO

**Files:**
- Create: `src/modules/asset-treasury/wallets/dto/create-deposit-wallet.dto.ts`

- [ ] **Step 1: Create the DTO file**

```typescript
import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateDepositWalletDto {
  @ApiProperty({ description: 'Asset UUID to create a deposit wallet for' })
  @IsUUID()
  assetId!: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/create-deposit-wallet.dto.ts
git commit -m "feat: add CreateDepositWalletDto"
```

---

### Task 3: Create CustomerDepositWalletService

**Files:**
- Create: `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts`

- [ ] **Step 1: Create the service file**

```typescript
import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { CUSTODIAN_ADAPTER, CustodianAdapter } from './custodian-adapter.interface';
import { WalletRole, WalletStatus } from './dto/wallet.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class CustomerDepositWalletService {
  private readonly logger = new Logger(CustomerDepositWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(CUSTODIAN_ADAPTER)
    private readonly custodianAdapter: CustodianAdapter,
  ) {}

  async createOrReturn(customerId: string, assetId: string) {
    // 1. Eligibility check
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, onboardingStatus: true, adminStatus: true },
    });
    if (!customer) {
      throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    }
    if (customer.onboardingStatus !== 'APPROVED') {
      throw new ForbiddenException({ code: 'ONBOARDING_NOT_APPROVED', message: 'Onboarding not approved' });
    }
    if (customer.adminStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }

    // 2. Asset check
    const asset = await this.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'ASSET_NOT_ACTIVE', message: `Asset is in ${asset.status} status` });
    }

    // 3. Derive role and type
    const walletRole = asset.type === 'FIAT' ? WalletRole.C_VIBAN : WalletRole.C_DEP;
    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';

    // 4. Idempotency: return existing ACTIVE wallet
    const existing = await this.prisma.wallet.findFirst({
      where: {
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        walletRole,
        status: WalletStatus.ACTIVE,
      },
      include: { asset: { select: { code: true, type: true, decimals: true } } },
    });
    if (existing) {
      return existing;
    }

    // 5. Create CREATING record
    const walletNo = generateReferenceNo('WA');
    const wallet = await this.prisma.wallet.create({
      data: {
        walletNo,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        type: walletType,
        direction: 'INBOUND',
        walletRole,
        assetId,
        status: WalletStatus.CREATING,
      },
    });

    // 6. Call custodian adapter
    try {
      const result = await this.custodianAdapter.createVault({
        assetCode: asset.code,
        network: asset.network ?? undefined,
        role: walletRole,
      });

      // 7. Success: update to ACTIVE
      const updated = await this.prisma.wallet.update({
        where: { id: wallet.id },
        data: {
          status: WalletStatus.ACTIVE,
          vaultId: result.vaultId,
          address: result.address ?? null,
          iban: result.iban ?? null,
        },
        include: { asset: { select: { code: true, type: true, decimals: true } } },
      });

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_WALLET_CREATED,
        entityType: AuditEntityTypes.WALLET,
        entityId: wallet.id,
        entityNo: walletNo,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: customerId,
        result: AuditResult.SUCCESS,
        metadata: {
          assetCode: asset.code,
          assetType: asset.type,
          walletRole,
          vaultId: result.vaultId,
          address: result.address,
          iban: result.iban,
        },
        sourcePlatform: 'CLIENT_API',
      });

      this.logger.log(`Deposit wallet ${walletNo} created for customer ${customer.customerNo}, asset ${asset.code}`);
      return updated;
    } catch (err: any) {
      // 8. Failure: delete CREATING record, throw
      await this.prisma.wallet.delete({ where: { id: wallet.id } });

      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_WALLET_CREATE_FAILED,
        entityType: AuditEntityTypes.WALLET,
        entityId: wallet.id,
        entityNo: walletNo,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: customerId,
        result: AuditResult.FAILED,
        metadata: {
          assetCode: asset.code,
          assetType: asset.type,
          walletRole,
          error: err.message,
        },
        sourcePlatform: 'CLIENT_API',
      });

      this.logger.error(`Deposit wallet creation failed for customer ${customer.customerNo}: ${err.message}`, err.stack);
      throw new BadGatewayException({ code: 'CUSTODIAN_CREATE_FAILED', message: 'Failed to create deposit wallet' });
    }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts
git commit -m "feat: add CustomerDepositWalletService with custodian adapter integration"
```

---

### Task 4: Create CustomerDepositWalletController

**Files:**
- Create: `src/modules/asset-treasury/wallets/customer-deposit-wallet.controller.ts`

- [ ] **Step 1: Create the controller file**

```typescript
import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
import { CreateDepositWalletDto } from './dto/create-deposit-wallet.dto';

@ApiTags('client/deposit-wallets')
@ApiBearerAuth()
@Controller('client/deposit-wallets')
@UseGuards(AuthGuard('jwt'))
export class CustomerDepositWalletController {
  constructor(private readonly service: CustomerDepositWalletService) {}

  @Post()
  @ApiOperation({ summary: 'Create or return existing deposit wallet for current customer' })
  async create(@Request() req: any, @Body() dto: CreateDepositWalletDto) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return this.service.createOrReturn(req.user.userId, dto.assetId);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/customer-deposit-wallet.controller.ts
git commit -m "feat: add POST /client/deposit-wallets controller"
```

---

### Task 5: Register in WalletsModule

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.module.ts`

- [ ] **Step 1: Add imports and register controller + service**

Add to imports at top of file:
```typescript
import { CustomerDepositWalletController } from './customer-deposit-wallet.controller';
import { CustomerDepositWalletService } from './customer-deposit-wallet.service';
```

Add `CustomerDepositWalletController` to the `controllers` array (after `CustodianWalletCreateController`).

Add `CustomerDepositWalletService` to the `providers` array.

The module also needs `OnboardingModule` import since the service queries `customerMain` directly via Prisma (no OnboardingService dependency needed — we query Prisma directly).

Actually, no extra module import is needed. The service only uses `PrismaService`, `AuditLogsService`, and `CustodianAdapter` — all already available in the module.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/wallets.module.ts
git commit -m "feat: register CustomerDepositWallet controller and service"
```

---

### Task 6: Update Deposit.tsx frontend

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx`

- [ ] **Step 1: Update handleGenerate to call new endpoint**

Find the `handleGenerate` function. Replace the payload construction and fetch call:

**Before** (lines ~253–264):
```typescript
const payload = {
    ownerType: 'CUSTOMER',
    ownerId: user.id,
    direction: 'INBOUND',
    type: activeTab === 'crypto' ? 'CRYPTO_ADDRESS' : 'FIAT_BANK',
    assetId: selectedAssetId,
};

const response = await customerFetch(`${import.meta.env.VITE_API_URL}/wallets`, {
    method: 'POST',
    body: JSON.stringify(payload)
});
```

**After:**
```typescript
const response = await customerFetch(
    `${import.meta.env.VITE_API_URL}/client/deposit-wallets`,
    {
        method: 'POST',
        body: JSON.stringify({ assetId: selectedAssetId }),
    },
);
```

- [ ] **Step 2: Update fetchWallet query to use correct walletRole filter**

Find the `fetchWallet` effect (lines ~163–197). The current query uses `walletRole: 'DEPOSIT'` which is wrong — the actual roles are `C_DEP` and `C_VIBAN`.

Replace the params construction:

**Before:**
```typescript
const params = new URLSearchParams({
    ownerType: 'CUSTOMER',
    ownerId: user.id,
    direction: 'INBOUND',
    walletRole: 'DEPOSIT',
    assetId: selectedAssetId,
});
```

**After:**
```typescript
const params = new URLSearchParams({
    ownerType: 'CUSTOMER',
    ownerId: user.id,
    direction: 'INBOUND',
    walletRole: activeTab === 'crypto' ? 'C_DEP' : 'C_VIBAN',
    assetId: selectedAssetId,
});
```

Also update the `found` filter in the same block:

**Before:**
```typescript
const found = items.find(w => 
    w.assetId === selectedAssetId &&
    (w.type === 'CRYPTO_ADDRESS' || w.type === 'FIAT_BANK') &&
    w.direction === 'INBOUND' &&
    w.walletRole === 'DEPOSIT'
);
```

**After:**
```typescript
const found = items.find(w => 
    w.assetId === selectedAssetId &&
    w.direction === 'INBOUND' &&
    (w.walletRole === 'C_DEP' || w.walletRole === 'C_VIBAN')
);
```

- [ ] **Step 3: Verify the frontend compiles**

Run: `cd Exchange_js && npm run build:client 2>&1 | tail -10` (or however the client build runs)
Expected: No build errors.

- [ ] **Step 4: Commit**

```bash
git add client-web/src/pages/Deposit.tsx
git commit -m "feat: switch Deposit page to use POST /client/deposit-wallets endpoint"
```

---

### Task 7: Manual integration test

- [ ] **Step 1: Restart backend and verify endpoint exists**

Run: `cd Exchange_js && npm run dev:stop && npm run dev:start`

Then test the endpoint with curl (use a valid customer JWT):
```bash
# Login as a test customer first, then:
curl -X POST http://localhost:3500/api/client/deposit-wallets \
  -H "Authorization: Bearer <customer-jwt>" \
  -H "Content-Type: application/json" \
  -d '{"assetId":"<active-asset-id>"}'
```

Expected: 200 with wallet including `address` or `iban` field populated.

- [ ] **Step 2: Test idempotency**

Call the same endpoint again with the same assetId.
Expected: Returns the same wallet (same `id`, same `walletNo`).

- [ ] **Step 3: Test eligibility gate**

If possible, test with a customer whose `adminStatus` is not ACTIVE.
Expected: 403 with `ACCOUNT_SUSPENDED` code.

- [ ] **Step 4: Verify in browser**

Open `http://localhost:3502/deposit`, select a crypto asset, click "Generate Address".
Expected: Address appears with QR code. Select a fiat asset, click generate — VIBAN appears.

- [ ] **Step 5: Check audit logs**

Query audit logs in the admin panel for `DEPOSIT_WALLET_CREATED` action.
Expected: Log entry with correct metadata (assetCode, walletRole, vaultId, etc.)
