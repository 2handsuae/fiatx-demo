# V3 Wallet Model Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove old Prisma-based balance layer, adopt V3 wallet role taxonomy, add mockBalance, split wallets.service.ts, implement System Wallet Provisioning endpoint.

**Architecture:** Two-layer separation — TB handles accounting (who owes whom), Wallet handles physical custody (where funds sit). Old JournalLine/WalletBalanceSnapshot/WalletBalanceEntry layer is fully removed; balance reads use mockBalance during simulation. System wallets are manually provisioned per asset via a new admin endpoint.

**Tech Stack:** NestJS, Prisma + SQLite, class-validator, TigerBeetle (existing), existing approval/audit infrastructure.

---

### Task 1: Prisma Schema — Drop Old Balance Models + Add mockBalance

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Remove JournalLine model**

Delete the entire `model JournalLine { ... }` block (schema.prisma lines 1889–1924).

- [ ] **Step 2: Remove WalletBalanceSnapshot model**

Delete the entire `model WalletBalanceSnapshot { ... }` block (schema.prisma lines 1926–1944).

- [ ] **Step 3: Remove WalletBalanceEntry model**

Delete the entire `model WalletBalanceEntry { ... }` block (schema.prisma lines 1946–1965).

- [ ] **Step 4: Remove relation fields from Wallet model**

In the `model Wallet { ... }` block, delete these three lines:

```
journalLines                             JournalLine[]                   @relation("JournalLineWallet")
balanceSnapshots                         WalletBalanceSnapshot[]
balanceEntries                           WalletBalanceEntry[]
```

- [ ] **Step 5: Remove reverse-relation fields from Journal model**

In `model Journal { ... }`, delete:

```
lines                   JournalLine[]
```

- [ ] **Step 6: Remove reverse-relation fields from JournalLineTemplate model**

In `model JournalLineTemplate { ... }`, find and delete the reverse relation to JournalLine (if it has a `journalLines JournalLine[]` or similar field).

- [ ] **Step 7: Remove reverse-relation fields from Asset model**

In `model Asset { ... }`, find and delete:
- The `JournalLine[]` relation field
- The `WalletBalanceSnapshot[]` relation field
- The `WalletBalanceEntry[]` relation field

- [ ] **Step 8: Remove reverse-relation field from Coa model**

In `model Coa { ... }`, find and delete the `JournalLine[]` relation field.

- [ ] **Step 9: Add mockBalance to Wallet model**

In `model Wallet { ... }`, after the `status` field, add:

```prisma
mockBalance                              Decimal                         @default(0)
```

- [ ] **Step 10: Generate and run Prisma migration**

```bash
cd Exchange_js && npx prisma migrate dev --name drop-old-balance-layer-add-mock-balance
```

Expected: migration creates SQL to drop 3 tables, remove FKs, add `mockBalance` column.

- [ ] **Step 11: Verify Prisma client generates without errors**

```bash
cd Exchange_js && npx prisma generate
```

Expected: success, no errors.

- [ ] **Step 12: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "refactor(schema): drop JournalLine/WalletBalanceSnapshot/WalletBalanceEntry, add Wallet.mockBalance"
```

---

### Task 2: Update WalletRole Enum + DTO

**Files:**
- Modify: `src/modules/asset-treasury/wallets/dto/wallet.dto.ts`

- [ ] **Step 1: Replace WalletRole enum**

Replace the existing `WalletRole` enum:

```typescript
export enum WalletRole {
  C_DEP = 'C_DEP',
  C_VIBAN = 'C_VIBAN',
  C_MAIN = 'C_MAIN',
  C_OUT = 'C_OUT',
  C_CMA = 'C_CMA',
  F_LIQ = 'F_LIQ',
  F_OPS = 'F_OPS',
}
```

- [ ] **Step 2: Verify DTO compiles**

```bash
cd Exchange_js && npx tsc --noEmit src/modules/asset-treasury/wallets/dto/wallet.dto.ts 2>&1 | head -20
```

Expected: may show errors from downstream consumers — that's fine, we fix those in later tasks.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/wallet.dto.ts
git commit -m "refactor(wallet): replace WalletRole enum with V3 role taxonomy"
```

---

### Task 3: Rewrite system-wallet.util.ts

**Files:**
- Modify: `src/modules/asset-treasury/wallets/system-wallet.util.ts`
- Modify: `src/modules/asset-treasury/wallets/system-wallet.util.spec.ts`

- [ ] **Step 1: Write failing tests for new util functions**

Rewrite `system-wallet.util.spec.ts`:

```typescript
import {
  CRYPTO_SYSTEM_WALLET_ROLES,
  FIAT_SYSTEM_WALLET_ROLES,
  PROTECTED_SYSTEM_WALLET_ROLES,
  isProtectedSystemWalletRole,
  classifyWalletSurface,
  WalletSurfaceCategory,
} from './system-wallet.util';
import { WalletRole } from './dto/wallet.dto';

describe('system-wallet.util', () => {
  describe('role constants', () => {
    it('CRYPTO_SYSTEM_WALLET_ROLES contains correct roles', () => {
      expect(CRYPTO_SYSTEM_WALLET_ROLES).toEqual([
        WalletRole.C_MAIN,
        WalletRole.C_OUT,
        WalletRole.F_LIQ,
        WalletRole.F_OPS,
      ]);
    });

    it('FIAT_SYSTEM_WALLET_ROLES contains correct roles', () => {
      expect(FIAT_SYSTEM_WALLET_ROLES).toEqual([
        WalletRole.C_CMA,
        WalletRole.F_LIQ,
        WalletRole.F_OPS,
      ]);
    });

    it('PROTECTED_SYSTEM_WALLET_ROLES is union of both', () => {
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.C_MAIN);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.C_OUT);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.C_CMA);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_LIQ);
      expect(PROTECTED_SYSTEM_WALLET_ROLES).toContain(WalletRole.F_OPS);
    });
  });

  describe('isProtectedSystemWalletRole', () => {
    it('returns true for system roles', () => {
      expect(isProtectedSystemWalletRole(WalletRole.C_MAIN)).toBe(true);
      expect(isProtectedSystemWalletRole(WalletRole.F_LIQ)).toBe(true);
    });

    it('returns false for customer roles', () => {
      expect(isProtectedSystemWalletRole(WalletRole.C_DEP)).toBe(false);
      expect(isProtectedSystemWalletRole(WalletRole.C_VIBAN)).toBe(false);
    });
  });

  describe('classifyWalletSurface', () => {
    it('C_MAIN → CUSTOMER_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_MAIN, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_POOL);
    });

    it('C_OUT → CUSTOMER_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_OUT, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_POOL);
    });

    it('C_CMA → CUSTOMER_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_CMA, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_POOL);
    });

    it('F_LIQ → PLATFORM_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.F_LIQ, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.PLATFORM_POOL);
    });

    it('F_OPS → PLATFORM_POOL', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.F_OPS, ownerType: 'PLATFORM' }))
        .toBe(WalletSurfaceCategory.PLATFORM_POOL);
    });

    it('C_DEP customer → CUSTOMER_DEPOSIT', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_DEP, ownerType: 'CUSTOMER' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_DEPOSIT);
    });

    it('C_VIBAN customer → CUSTOMER_DEPOSIT', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.C_VIBAN, ownerType: 'CUSTOMER' }))
        .toBe(WalletSurfaceCategory.CUSTOMER_DEPOSIT);
    });

    it('LIQUIDITY_PROVIDER → LIQUIDITY_PROVIDER_ACCOUNT', () => {
      expect(classifyWalletSurface({ walletRole: WalletRole.F_LIQ, ownerType: 'LIQUIDITY_PROVIDER' }))
        .toBe(WalletSurfaceCategory.LIQUIDITY_PROVIDER_ACCOUNT);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/system-wallet.util.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — old exports don't exist.

- [ ] **Step 3: Rewrite system-wallet.util.ts**

```typescript
import { WalletRole } from './dto/wallet.dto';

export const CRYPTO_SYSTEM_WALLET_ROLES: WalletRole[] = [
  WalletRole.C_MAIN,
  WalletRole.C_OUT,
  WalletRole.F_LIQ,
  WalletRole.F_OPS,
];

export const FIAT_SYSTEM_WALLET_ROLES: WalletRole[] = [
  WalletRole.C_CMA,
  WalletRole.F_LIQ,
  WalletRole.F_OPS,
];

export const PROTECTED_SYSTEM_WALLET_ROLES: ReadonlySet<string> = new Set([
  ...CRYPTO_SYSTEM_WALLET_ROLES,
  ...FIAT_SYSTEM_WALLET_ROLES,
]);

export const CUSTOMER_POOL_ROLES: ReadonlySet<string> = new Set([
  WalletRole.C_MAIN,
  WalletRole.C_OUT,
  WalletRole.C_CMA,
]);

export const PLATFORM_POOL_ROLES: ReadonlySet<string> = new Set([
  WalletRole.F_LIQ,
  WalletRole.F_OPS,
]);

export enum WalletSurfaceCategory {
  CUSTOMER_POOL = 'CUSTOMER_POOL',
  PLATFORM_POOL = 'PLATFORM_POOL',
  CUSTOMER_DEPOSIT = 'CUSTOMER_DEPOSIT',
  CUSTOMER_PAYOUT_TARGET = 'CUSTOMER_PAYOUT_TARGET',
  LIQUIDITY_PROVIDER_ACCOUNT = 'LIQUIDITY_PROVIDER_ACCOUNT',
  OTHER = 'OTHER',
}

export function isProtectedSystemWalletRole(role: string): boolean {
  return PROTECTED_SYSTEM_WALLET_ROLES.has(role);
}

export function classifyWalletSurface(wallet: {
  walletRole: string;
  ownerType: string;
}): WalletSurfaceCategory {
  if (wallet.ownerType === 'LIQUIDITY_PROVIDER') {
    return WalletSurfaceCategory.LIQUIDITY_PROVIDER_ACCOUNT;
  }
  if (wallet.ownerType === 'CUSTOMER') {
    if (wallet.walletRole === WalletRole.C_DEP || wallet.walletRole === WalletRole.C_VIBAN) {
      return WalletSurfaceCategory.CUSTOMER_DEPOSIT;
    }
    return WalletSurfaceCategory.OTHER;
  }
  if (CUSTOMER_POOL_ROLES.has(wallet.walletRole)) {
    return WalletSurfaceCategory.CUSTOMER_POOL;
  }
  if (PLATFORM_POOL_ROLES.has(wallet.walletRole)) {
    return WalletSurfaceCategory.PLATFORM_POOL;
  }
  return WalletSurfaceCategory.OTHER;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/system-wallet.util.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/system-wallet.util.ts src/modules/asset-treasury/wallets/system-wallet.util.spec.ts
git commit -m "refactor(wallet): rewrite system-wallet.util with V3 role taxonomy"
```

---

### Task 4: Rewrite wallets.service.ts — Core CRUD (Slim Down)

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`
- Modify: `src/modules/asset-treasury/wallets/wallets.service.spec.ts`

This task removes all old balance logic from wallets.service.ts. The `findAll`, `findOne`, `findBalance` methods move to Task 5. This task keeps: `create`, `changeStatus`, and private helpers.

- [ ] **Step 1: Write failing tests for slimmed service**

Rewrite `wallets.service.spec.ts` to test only the CRUD methods that remain in `wallets.service.ts`:
- `create()` — PLATFORM without ownerId: OK. CUSTOMER without ownerId: rejected. Idempotent INBOUND. P2002 retry. WalletRole validation (protected roles blocked for manual create). walletNo generated via `generateReferenceNo('WA')`.
- `changeStatus()` — protected system wallet role blocked. Normal wallet: OK.

Remove all tests referencing `WalletBalanceSnapshot`, `buildWalletBalanceView`, `snapshotMissing`, `balanceSource`, `totalAedEquivalent`. These move to `wallet-query.service.spec.ts` in Task 5.

Update role literals: `'MASTER'` → `WalletRole.C_MAIN`, `'DEPOSIT'` → `WalletRole.C_DEP`, `'PAYOUT'` → `WalletRole.C_OUT`, etc.

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/wallets.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Rewrite wallets.service.ts**

Remove from `wallets.service.ts`:
1. Delete `walletBalanceSnapshotSelect`, `walletBalanceSnapshotDetailSelect`, `assetValuationRateSelect`, `valuationRateDetailSelect` static objects.
2. Delete `buildWalletBalanceView()` private method.
3. Delete `getWalletBalanceSnapshotMap()` private method.
4. Delete `getAedRateByAssetMap()` private method.
5. Delete `findAll()`, `findOne()`, `findBalance()` — these move to `wallet-query.service.ts`.
6. Delete `findRegulatoryGateSummary()`.

Keep:
1. `create()` — update `resolveCreateWalletRole` to use new `WalletRole` values. Customer INBOUND → `C_DEP` (crypto) or `C_VIBAN` (fiat). Replace `generateRandomWalletNo(walletRole)` with `generateReferenceNo('WA')`.
2. `changeStatus()` — replace `isProtectedPoolWalletRole` import with `isProtectedSystemWalletRole`.
3. `assertManualCreateAllowed()` — update role checks to use new enum values.
4. `resolveCreateWalletRole()` — update logic for new roles.
5. Private helpers: `isUniqueConstraintError`, `isWalletNoUniqueConstraintError`, `resolveCustomerOwnerName`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/wallets.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/wallets.service.ts src/modules/asset-treasury/wallets/wallets.service.spec.ts
git commit -m "refactor(wallet): slim wallets.service.ts to core CRUD, remove old balance logic"
```

---

### Task 5: Create wallet-query.service.ts

**Files:**
- Create: `src/modules/asset-treasury/wallets/wallet-query.service.ts`
- Create: `src/modules/asset-treasury/wallets/wallet-query.service.spec.ts`

- [ ] **Step 1: Write failing tests for wallet query service**

Test `findAll`, `findOne`, `findBalance`:
- `findAll` returns items with `mockBalance` as the balance field (no more `WalletBalanceSnapshot`).
- `findOne` returns wallet with `mockBalance`.
- `findBalance` returns `{ walletId, walletNo, mockBalance, asset, ... }`.
- Surface category enrichment via `classifyWalletSurface`.
- AED equivalent via `AssetValuationRate` (this stays — it's rate data, not balance data).
- Owner enrichment (customer name, LP name, PLATFORM label).

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/wallet-query.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — file doesn't exist yet.

- [ ] **Step 3: Implement wallet-query.service.ts**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { classifyWalletSurface } from './system-wallet.util';

@Injectable()
export class WalletQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll({ skip, take, where, orderBy }: any) {
    const [items, total] = await Promise.all([
      this.prisma.wallet.findMany({ skip, take, where, orderBy, include: { asset: true } }),
      this.prisma.wallet.count({ where }),
    ]);

    const enriched = await Promise.all(
      items.map(async (wallet) => {
        const ownerInfo = await this.resolveOwnerInfo(wallet);
        return {
          ...wallet,
          ...ownerInfo,
          surfaceCategory: classifyWalletSurface(wallet),
          balance: wallet.mockBalance,
        };
      }),
    );

    return { items: enriched, total };
  }

  async findOne(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND' });

    const ownerInfo = await this.resolveOwnerInfo(wallet);
    return {
      ...wallet,
      ...ownerInfo,
      surfaceCategory: classifyWalletSurface(wallet),
      balance: wallet.mockBalance,
    };
  }

  async findBalance(id: string) {
    const wallet = await this.prisma.wallet.findUnique({
      where: { id },
      include: { asset: { select: { id: true, code: true, type: true, decimals: true } } },
    });
    if (!wallet) throw new NotFoundException({ code: 'WALLET_NOT_FOUND' });

    return {
      walletId: wallet.id,
      walletNo: wallet.walletNo,
      ownerType: wallet.ownerType,
      ownerId: wallet.ownerId,
      asset: wallet.asset,
      balance: wallet.mockBalance,
    };
  }

  private async resolveOwnerInfo(wallet: any) {
    // Resolve owner name based on ownerType — same pattern as V1 but without balance snapshot
    if (wallet.ownerType === 'PLATFORM') return { ownerName: 'Platform' };
    if (wallet.ownerType === 'CUSTOMER' && wallet.ownerId) {
      const customer = await this.prisma.customerMain.findUnique({ where: { id: wallet.ownerId } });
      if (!customer) return { ownerName: null, ownerNo: null };
      return {
        ownerName: customer.companyName || customer.fullName || customer.email,
        ownerNo: customer.customerNo,
      };
    }
    if (wallet.ownerType === 'LIQUIDITY_PROVIDER' && wallet.ownerId) {
      const lp = await this.prisma.liquidityProvider.findUnique({ where: { id: wallet.ownerId } });
      return { ownerName: lp?.name ?? null, ownerNo: lp?.providerNo ?? null };
    }
    return { ownerName: null, ownerNo: null };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/wallet-query.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/wallet-query.service.ts src/modules/asset-treasury/wallets/wallet-query.service.spec.ts
git commit -m "feat(wallet): add WalletQueryService with mockBalance-based balance reads"
```

---

### Task 6: Create system-wallet-provisioning.service.ts

**Files:**
- Create: `src/modules/asset-treasury/wallets/system-wallet-provisioning.service.ts`
- Create: `src/modules/asset-treasury/wallets/system-wallet-provisioning.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { Test } from '@nestjs/testing';
import { SystemWalletProvisioningService } from './system-wallet-provisioning.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { WalletRole } from './dto/wallet.dto';
import { BadRequestException } from '@nestjs/common';

describe('SystemWalletProvisioningService', () => {
  let service: SystemWalletProvisioningService;
  let prisma: any;
  let auditLogs: any;

  beforeEach(async () => {
    prisma = {
      asset: { findFirst: jest.fn() },
      wallet: { findFirst: jest.fn(), create: jest.fn() },
    };
    auditLogs = { recordByActor: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SystemWalletProvisioningService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: auditLogs },
      ],
    }).compile();

    service = module.get(SystemWalletProvisioningService);
  });

  it('creates 4 wallets for CRYPTO asset', async () => {
    prisma.asset.findFirst.mockResolvedValue({
      id: 'a1', assetNo: 'AS-001', type: 'CRYPTO', code: 'USDT',
      network: 'TRON', status: 'PROVISIONING',
    });
    prisma.wallet.findFirst.mockResolvedValue(null); // no existing
    prisma.wallet.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `w-${data.walletRole}`, ...data }),
    );

    const result = await service.provisionSystemWallets('AS-001', {
      actorType: 'ADMIN', userId: 'u1', userNo: 'UN-001', role: 'ADMIN', roleCodes: ['ADMIN'],
    });

    expect(prisma.wallet.create).toHaveBeenCalledTimes(4);
    const roles = prisma.wallet.create.mock.calls.map((c: any) => c[0].data.walletRole);
    expect(roles).toEqual([WalletRole.C_MAIN, WalletRole.C_OUT, WalletRole.F_LIQ, WalletRole.F_OPS]);
    expect(result.created).toHaveLength(4);
  });

  it('creates 3 wallets for FIAT asset', async () => {
    prisma.asset.findFirst.mockResolvedValue({
      id: 'a2', assetNo: 'AS-002', type: 'FIAT', code: 'AED',
      network: null, status: 'ACTIVE',
    });
    prisma.wallet.findFirst.mockResolvedValue(null);
    prisma.wallet.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `w-${data.walletRole}`, ...data }),
    );

    const result = await service.provisionSystemWallets('AS-002', {
      actorType: 'ADMIN', userId: 'u1', userNo: 'UN-001', role: 'ADMIN', roleCodes: ['ADMIN'],
    });

    expect(prisma.wallet.create).toHaveBeenCalledTimes(3);
    const roles = prisma.wallet.create.mock.calls.map((c: any) => c[0].data.walletRole);
    expect(roles).toEqual([WalletRole.C_CMA, WalletRole.F_LIQ, WalletRole.F_OPS]);
    expect(result.created).toHaveLength(3);
  });

  it('skips existing wallets (idempotent)', async () => {
    prisma.asset.findFirst.mockResolvedValue({
      id: 'a1', assetNo: 'AS-001', type: 'CRYPTO', code: 'USDT',
      network: 'TRON', status: 'PROVISIONING',
    });
    // C_MAIN already exists, others don't
    prisma.wallet.findFirst.mockImplementation(({ where }) =>
      where.walletRole === WalletRole.C_MAIN
        ? Promise.resolve({ id: 'existing', walletRole: WalletRole.C_MAIN })
        : Promise.resolve(null),
    );
    prisma.wallet.create.mockImplementation(({ data }) =>
      Promise.resolve({ id: `w-${data.walletRole}`, ...data }),
    );

    const result = await service.provisionSystemWallets('AS-001', {
      actorType: 'ADMIN', userId: 'u1', userNo: 'UN-001', role: 'ADMIN', roleCodes: ['ADMIN'],
    });

    expect(prisma.wallet.create).toHaveBeenCalledTimes(3); // skipped C_MAIN
    expect(result.created).toHaveLength(3);
    expect(result.skipped).toHaveLength(1);
  });

  it('rejects asset not in PROVISIONING or ACTIVE', async () => {
    prisma.asset.findFirst.mockResolvedValue({
      id: 'a1', assetNo: 'AS-001', type: 'CRYPTO', code: 'USDT',
      network: 'TRON', status: 'PENDING_APPROVAL',
    });

    await expect(
      service.provisionSystemWallets('AS-001', {
        actorType: 'ADMIN', userId: 'u1', userNo: 'UN-001', role: 'ADMIN', roleCodes: ['ADMIN'],
      }),
    ).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/system-wallet-provisioning.service.spec.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL.

- [ ] **Step 3: Implement system-wallet-provisioning.service.ts**

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { WalletRole } from './dto/wallet.dto';
import { CRYPTO_SYSTEM_WALLET_ROLES, FIAT_SYSTEM_WALLET_ROLES } from './system-wallet.util';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class SystemWalletProvisioningService {
  private readonly logger = new Logger(SystemWalletProvisioningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async provisionSystemWallets(
    assetNo: string,
    actor: ApprovalActorContext,
  ): Promise<{ created: any[]; skipped: any[] }> {
    const asset = await this.prisma.asset.findFirst({ where: { assetNo } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: `Asset ${assetNo} not found` });
    }

    if (asset.status !== 'PROVISIONING' && asset.status !== 'ACTIVE') {
      throw new BadRequestException({
        code: 'INVALID_ASSET_STATUS',
        message: `Asset ${assetNo} is in ${asset.status} status, expected PROVISIONING or ACTIVE`,
      });
    }

    const roles = asset.type === 'FIAT' ? FIAT_SYSTEM_WALLET_ROLES : CRYPTO_SYSTEM_WALLET_ROLES;
    const walletType = asset.type === 'FIAT' ? 'FIAT_BANK' : 'CRYPTO_ADDRESS';

    const created: any[] = [];
    const skipped: any[] = [];

    for (const role of roles) {
      const existing = await this.prisma.wallet.findFirst({
        where: { walletRole: role, assetId: asset.id, ownerType: 'PLATFORM' },
      });

      if (existing) {
        skipped.push({ role, walletNo: existing.walletNo });
        continue;
      }

      const wallet = await this.prisma.wallet.create({
        data: {
          walletNo: generateReferenceNo('WA'),
          ownerType: 'PLATFORM',
          type: walletType,
          direction: 'BIDIRECTIONAL',
          walletRole: role,
          assetId: asset.id,
          status: 'ACTIVE',
          mockBalance: 0,
        },
      });

      created.push({ role, walletNo: wallet.walletNo, walletId: wallet.id });
    }

    this.logger.log(
      `System wallets for ${assetNo}: created=${created.length}, skipped=${skipped.length}`,
    );

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.ASSET_LISTING.SYSTEM_WALLETS_PROVISIONED,
        entityType: AuditEntityTypes.ASSET,
        entityId: asset.id,
        entityNo: assetNo,
        workflowType: AuditBusinessWorkflowTypes.ASSET_LISTING,
        result: AuditResult.SUCCESS,
        metadata: { created, skipped },
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.userId,
        actorNo: actor.userNo,
        actorRole: actor.role || actor.roleCodes?.[0] || 'UNKNOWN',
      },
    );

    return { created, skipped };
  }
}
```

**Note:** The audit action `AuditGovernanceActions.ASSET_LISTING.SYSTEM_WALLETS_PROVISIONED` must be added to `src/modules/audit-logging/constants/audit-actions.constant.ts`. Add:

```typescript
// Inside AuditGovernanceActions.ASSET_LISTING:
SYSTEM_WALLETS_PROVISIONED: 'asset_listing.system_wallets_provisioned',
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/system-wallet-provisioning.service.spec.ts --no-coverage 2>&1 | tail -10
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/system-wallet-provisioning.service.ts src/modules/asset-treasury/wallets/system-wallet-provisioning.service.spec.ts src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(wallet): add SystemWalletProvisioningService for manual system wallet creation"
```

---

### Task 7: Add provision-wallets API Endpoint

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-listing.controller.ts`

- [ ] **Step 1: Add the new endpoint**

Add to `AssetListingController`:

```typescript
@Post(':assetNo/provision-wallets')
@RequirePermissions(buildPermissionCode('POST', '/admin/assets/:assetNo/provision-wallets'))
async provisionWallets(@Param('assetNo') assetNo: string, @Req() req: any) {
  this.ensureAdmin(req);
  return this.provisioningService.provisionSystemWallets(assetNo, this.buildAdminActor(req));
}
```

Update constructor to inject `SystemWalletProvisioningService`:

```typescript
constructor(
  private readonly workflowService: AssetListingWorkflowService,
  private readonly provisioningService: SystemWalletProvisioningService,
) {}
```

Add import:

```typescript
import { SystemWalletProvisioningService } from './system-wallet-provisioning.service';
```

Wait — `SystemWalletProvisioningService` lives in the wallets module, not assets module. The controller is in the assets module. Two options:

**Option A:** Import from wallets module (cross-module dependency).
**Option B:** Put the endpoint in a new controller in the wallets module.

Since the route is `POST /admin/assets/:assetNo/provision-wallets`, it belongs with the asset listing controller. Import from wallets module:

In `asset-listing.controller.ts`:
```typescript
import { SystemWalletProvisioningService } from '../wallets/system-wallet-provisioning.service';
```

The wallets module must export `SystemWalletProvisioningService` (done in Task 8). The assets module must import `WalletsModule` — update the asset-treasury module's imports to include `WalletsModule` if not already present.

- [ ] **Step 2: Update asset module imports**

In the asset-treasury module file (e.g., `asset-treasury.module.ts` or the assets sub-module), add `WalletsModule` to `imports` so that `SystemWalletProvisioningService` is available for injection into `AssetListingController`.

- [ ] **Step 3: Verify the controller compiles**

```bash
cd Exchange_js && npx tsc --noEmit src/modules/asset-treasury/assets/asset-listing.controller.ts 2>&1 | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing.controller.ts src/modules/asset-treasury/
git commit -m "feat(wallet): add POST /admin/assets/:assetNo/provision-wallets endpoint"
```

---

### Task 8: Update wallets.module.ts and Wire Dependencies

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.module.ts`
- Modify: `src/modules/asset-treasury/wallets/wallets.controller.ts`
- Modify: `src/modules/asset-treasury/wallets/wallets.controller.spec.ts`

- [ ] **Step 1: Update wallets.module.ts**

Register new services, export `SystemWalletProvisioningService`:

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { WalletsService } from './wallets.service';
import { WalletQueryService } from './wallet-query.service';
import { SystemWalletProvisioningService } from './system-wallet-provisioning.service';
import { WalletsController } from './wallets.controller';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  providers: [WalletsService, WalletQueryService, SystemWalletProvisioningService],
  controllers: [WalletsController],
  exports: [WalletsService, WalletQueryService, SystemWalletProvisioningService],
})
export class WalletsModule {}
```

- [ ] **Step 2: Update wallets.controller.ts**

Replace `WalletsService` calls for `findAll`, `findOne`, `findBalance` with `WalletQueryService`:

```typescript
constructor(
  private readonly walletsService: WalletsService,
  private readonly walletQueryService: WalletQueryService,
) {}
```

Update method bodies:
- `findAll()` → `this.walletQueryService.findAll(...)`
- `findOne()` → `this.walletQueryService.findOne(id)`
- `findBalance()` → `this.walletQueryService.findBalance(id)`
- `create()` → stays `this.walletsService.create(...)`
- `changeStatus()` → stays `this.walletsService.changeStatus(...)`

Update role literals in customer guards: `'DEPOSIT'` → `WalletRole.C_DEP`, `'GENERAL'` → check context.

- [ ] **Step 3: Update wallets.controller.spec.ts**

Update mock to include both services. Update role literals to new enum values.

- [ ] **Step 4: Run all wallet module tests**

```bash
cd Exchange_js && npx jest src/modules/asset-treasury/wallets/ --no-coverage 2>&1 | tail -20
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/wallets/
git commit -m "refactor(wallet): wire WalletQueryService + SystemWalletProvisioningService into module"
```

---

### Task 9: Deprecate Old Balance References in Out-of-Scope Files

**Files:**
- Modify: `src/modules/accounting/journal-lines/journal-lines.service.ts`
- Modify: `src/modules/accounting/journal-lines/journal-lines.controller.ts`
- Modify: `src/modules/accounting/journal-lines/journal-lines.module.ts`
- Modify: `src/modules/accounting/journal-lines/dto/journal-line.dto.ts`
- Modify: `src/modules/accounting/journals/journals.service.ts`
- Modify: `src/modules/accounting/journal-line-templates/journal-line-templates.service.ts`
- Modify: `src/modules/accounting/journal-line-templates/journal-line-templates.controller.ts`
- Modify: `src/modules/accounting/journal-line-templates/journal-line-templates.module.ts`
- Modify: `src/modules/accounting/journal-line-templates/dto/journal-line-template.dto.ts`
- Modify: `src/modules/asset-treasury/treasury/treasury.service.ts`

- [ ] **Step 1: Deprecate journal-lines service**

In `journal-lines.service.ts`, replace the body of every public method with:

```typescript
throw new Error('DEPRECATED: migrate to TB — JournalLine CRUD');
```

Keep method signatures, class decorator, constructor. Remove Prisma imports that reference the dropped models.

- [ ] **Step 2: Deprecate journal-lines controller**

In `journal-lines.controller.ts`, replace route handler bodies with the same `throw new Error('DEPRECATED: ...')` pattern.

- [ ] **Step 3: Deprecate journal-line-templates service and controller**

Same pattern in `journal-line-templates.service.ts` and `journal-line-templates.controller.ts`.

- [ ] **Step 4: Deprecate journals.service.ts balance-related methods**

In `journals.service.ts`, find methods that create JournalLine rows. Replace those method bodies with `throw new Error('DEPRECATED: migrate to TB — Journal line creation')`. Methods that only work with Journal headers (no JournalLine interaction) can stay.

- [ ] **Step 5: Deprecate treasury.service.ts balance snapshot usage**

In `treasury.service.ts`, find the `WalletBalanceSnapshotView` type and related methods. Replace with `throw new Error('DEPRECATED: migrate to TB — Treasury balance ops')`.

- [ ] **Step 6: Remove or deprecate spec files**

For `journal-lines.service.spec.ts`: either delete the file or replace test bodies with `it.skip(...)` / `it.todo(...)`.

- [ ] **Step 7: Fix any remaining Prisma client import errors**

After dropping the 3 models, any file that imports `prisma.journalLine`, `prisma.walletBalanceSnapshot`, or `prisma.walletBalanceEntry` will have a TypeScript error. Replace those references with the `throw new Error('DEPRECATED: ...')` pattern.

- [ ] **Step 8: Verify full project compiles**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -40
```

If compilation errors remain, fix them by applying the DEPRECATED throw pattern to each affected line.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(deprecate): replace old balance layer references with runtime DEPRECATED errors"
```

---

### Task 10: Migrate walletRole String Literals in Other Modules

**Files:**
- Modify: `src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts`
- Modify: `src/modules/clearing-settle/outstanding-settlements/outstanding-settlements.service.ts`
- Modify: `src/modules/internal-funds/internal-funds.service.ts`
- Modify: `src/modules/fee-occurrences/fee-occurrences.service.ts`
- Modify: `src/modules/internal-transaction-workflow/internal-transaction-workflow.service.ts`
- Modify: corresponding spec files for each

- [ ] **Step 1: Update clearing-settle modules**

In `pool-settlement-batches.service.ts` (line ~281) and `outstanding-settlements.service.ts` (line ~272): replace `buildCryptoSystemWalletNo(...)` calls with Prisma queries that find the system wallet by `(walletRole, assetId, ownerType='PLATFORM')`.

Import `WalletRole` from the wallet DTO instead of the old util.

- [ ] **Step 2: Update internal-funds.service.ts**

Line ~732: replace `walletRole: { in: ['MASTER', 'LIQ'] }` with `walletRole: { in: [WalletRole.C_MAIN, WalletRole.F_LIQ] }`.

- [ ] **Step 3: Update fee-occurrences.service.ts**

Lines ~221-238: replace `'MASTER'`, `'PAYOUT'`, `'CUST_BANK'` with new role values. Replace `isProtectedPoolWalletRole` import with `isProtectedSystemWalletRole`.

- [ ] **Step 4: Update internal-transaction-workflow.service.ts**

Lines ~102-263: replace `'CUST_BANK'` and other old role strings with new enum values.

- [ ] **Step 5: Update spec files**

In all corresponding spec files, replace old role string fixtures (`'MASTER'`, `'PAYOUT'`, `'LIQ'`, `'CUST_BANK'`, `'LIQ_BANK'`) with new `WalletRole.*` values.

- [ ] **Step 6: Verify compilation**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors (or only errors from modules we've already deprecated).

- [ ] **Step 7: Run affected tests**

```bash
cd Exchange_js && npx jest --no-coverage 2>&1 | tail -30
```

Fix any remaining test failures from the role migration.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(wallet): migrate walletRole string literals to V3 WalletRole enum across modules"
```

---

### Task 11: Data Migration for Existing Wallet Rows

**Files:**
- The Prisma migration from Task 1 already exists. Add a SQL data migration.
- Alternatively, create a new migration: `npx prisma migrate dev --name migrate-wallet-roles`

- [ ] **Step 1: Create role migration SQL**

Create a new migration with SQL UPDATE statements:

```sql
UPDATE wallets SET "walletRole" = 'C_DEP' WHERE "walletRole" = 'DEPOSIT';
UPDATE wallets SET "walletRole" = 'C_MAIN' WHERE "walletRole" = 'MASTER';
UPDATE wallets SET "walletRole" = 'C_OUT' WHERE "walletRole" = 'PAYOUT';
UPDATE wallets SET "walletRole" = 'F_LIQ' WHERE "walletRole" IN ('LIQ', 'LIQ_BANK');
UPDATE wallets SET "walletRole" = 'C_CMA' WHERE "walletRole" = 'CUST_BANK';
UPDATE wallets SET "walletRole" = 'F_OPS' WHERE "walletRole" = 'GENERAL' AND "ownerType" = 'PLATFORM';
UPDATE wallets SET "walletRole" = 'C_DEP' WHERE "walletRole" = 'GENERAL' AND "ownerType" = 'CUSTOMER';
```

- [ ] **Step 2: Run migration**

```bash
cd Exchange_js && npx prisma migrate dev --name migrate-wallet-roles-to-v3
```

- [ ] **Step 3: Verify existing data is migrated**

```bash
cd Exchange_js && npx prisma db execute --stdin <<< "SELECT walletRole, COUNT(*) FROM wallets GROUP BY walletRole;"
```

Expected: only V3 role values appear.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations/
git commit -m "data(wallet): migrate existing walletRole values from V1 to V3 taxonomy"
```

---

### Task 12: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Full compilation check**

```bash
cd Exchange_js && npx tsc --noEmit 2>&1
```

Expected: clean compilation (zero errors).

- [ ] **Step 2: Run full test suite**

```bash
cd Exchange_js && npx jest --no-coverage 2>&1 | tail -30
```

Expected: all wallet-related tests pass. Some other module tests may fail due to DEPRECATED throws — that is expected and intentional.

- [ ] **Step 3: Start dev server and verify**

```bash
cd Exchange_js && npm run dev:start
```

Verify:
1. Server starts without crash
2. Login works
3. Asset listing workflow still works (submit → approve → provision → activate)
4. `POST /admin/assets/:assetNo/provision-wallets` creates system wallets
5. `GET /wallets` returns wallets with `mockBalance`

- [ ] **Step 4: Stop dev server**

```bash
cd Exchange_js && npm run dev:stop
```
