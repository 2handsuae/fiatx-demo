# Withdrawal Address Registration — Crypto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow customers to self-register external crypto withdrawal destination addresses with 24h safety cooling period, TR-based VASP auto-detection, and admin force-suspend capability.

**Architecture:** New `withdrawal-addresses` submodule under `asset-treasury` with three-layer architecture (Domain Service + Workflow + Sweep). TR adapter interface (mock for MVP) auto-detects VASP ownership. Client self-service registration with no approval gate. Admin read + force-suspend.

**Tech Stack:** NestJS, Prisma, `@nestjs/schedule` (Cron), React (admin-web + client-web)

**Spec:** `doc-final/superpowers/specs/2026-05-13-withdrawal-address-crypto-design.md`

---

### Task 1: Prisma schema — add WithdrawalAddress model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add WithdrawalAddress model to schema**

Add after the `Wallet` model block in `prisma/schema.prisma`:

```prisma
model WithdrawalAddress {
  id                   String       @id @default(uuid())
  addressNo            String       @unique
  customerId           String
  customerNo           String
  assetId              String
  network              String
  address              String
  addressType          String
  label                String?

  counterpartyVaspName String?
  counterpartyVaspDid  String?

  ownershipDeclaredAt  DateTime?
  ownershipProofType   String?

  status               String       @default("PENDING_ACTIVATION")
  activatesAt          DateTime
  activatedAt          DateTime?
  suspendedAt          DateTime?
  suspendedBy          String?
  suspendReason        String?
  cancelledAt          DateTime?

  traceId              String

  createdAt            DateTime     @default(now()) @map("created_at")
  updatedAt            DateTime     @updatedAt @map("updated_at")

  customer             CustomerMain @relation(fields: [customerId], references: [id])
  asset                Asset        @relation(fields: [assetId], references: [id])

  @@unique([customerId, assetId, address])
  @@index([customerId, assetId, status])
  @@index([status, activatesAt])
  @@map("withdrawal_addresses")
}
```

- [ ] **Step 2: Add reverse relations on Asset and CustomerMain**

In the `Asset` model, add at the end of the relations block:

```prisma
  withdrawalAddresses  WithdrawalAddress[]
```

In the `CustomerMain` model, add at the end of the relations block:

```prisma
  withdrawalAddresses  WithdrawalAddress[]
```

- [ ] **Step 3: Generate and apply migration**

Run: `cd Exchange_js && npx prisma migrate dev --name add_withdrawal_addresses 2>&1 | tail -10`
Expected: Migration applied successfully.

- [ ] **Step 4: Verify Prisma Client generation**

Run: `cd Exchange_js && npx prisma generate 2>&1 | tail -5`
Expected: `✔ Generated Prisma Client`

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add WithdrawalAddress model to Prisma schema"
```

---

### Task 2: Audit constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add workflow type, entity type, and governance actions**

In `AuditBusinessWorkflowTypes`, add after `CUSTODIAN_WALLET_CREATE`:

```typescript
  WITHDRAWAL_ADDRESS_REGISTRATION: 'WITHDRAWAL_ADDRESS_REGISTRATION',
```

In `AuditEntityTypes`, add after `WALLET`:

```typescript
  WITHDRAWAL_ADDRESS: 'WITHDRAWAL_ADDRESS',
```

In `AuditGovernanceActions`, add after the `CUSTODIAN_WALLET_CREATE` block:

```typescript
  WITHDRAWAL_ADDRESS_REGISTRATION: {
    ADDRESS_REGISTERED:   'ADDRESS_REGISTERED',
    ADDRESS_ACTIVATED:    'ADDRESS_ACTIVATED',
    ADDRESS_CANCELLED:    'ADDRESS_CANCELLED',
    ADDRESS_SUSPENDED:    'ADDRESS_SUSPENDED',
    MANUAL_COOLING_SKIP:  'MANUAL_COOLING_SKIP',
  },
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat: add withdrawal address audit constants"
```

---

### Task 3: Travel Rule adapter interface + mock

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/travel-rule-adapter.interface.ts`
- Create: `src/modules/asset-treasury/withdrawal-addresses/mock-travel-rule.adapter.ts`

- [ ] **Step 1: Create the adapter interface**

```typescript
export const TRAVEL_RULE_ADAPTER = Symbol('TRAVEL_RULE_ADAPTER');

export interface AddressAttributionResult {
  attributed: boolean;
  vaspName?: string;
  vaspDid?: string;
}

export interface TravelRuleAdapter {
  attributeAddress(address: string, network: string): Promise<AddressAttributionResult>;
}
```

- [ ] **Step 2: Create the mock adapter**

```typescript
import { Injectable } from '@nestjs/common';
import { TravelRuleAdapter, AddressAttributionResult } from './travel-rule-adapter.interface';

@Injectable()
export class MockTravelRuleAdapter implements TravelRuleAdapter {
  async attributeAddress(_address: string, _network: string): Promise<AddressAttributionResult> {
    return { attributed: false };
  }
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/
git commit -m "feat: add TravelRuleAdapter interface and mock"
```

---

### Task 4: Address validator utility

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/address-validator.util.ts`
- Create: `src/modules/asset-treasury/withdrawal-addresses/address-validator.util.spec.ts`

- [ ] **Step 1: Write tests for address validator**

```typescript
import { validateCryptoAddress } from './address-validator.util';

describe('validateCryptoAddress', () => {
  describe('ETH', () => {
    it('accepts valid ETH address', () => {
      expect(validateCryptoAddress('ETH', '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18')).toEqual({ valid: true });
    });
    it('rejects ETH address without 0x prefix', () => {
      const result = validateCryptoAddress('ETH', '742d35Cc6634C0532925a3b844Bc9e7595f2bD18');
      expect(result.valid).toBe(false);
    });
    it('rejects ETH address with wrong length', () => {
      const result = validateCryptoAddress('ETH', '0x742d35Cc6634C0532925a3b844Bc');
      expect(result.valid).toBe(false);
    });
  });

  describe('TRX', () => {
    it('accepts valid TRX address', () => {
      expect(validateCryptoAddress('TRX', 'TJYs2qsBiZWpSJFoRBi8GveHHUBFcYNJaN')).toEqual({ valid: true });
    });
    it('rejects TRX address without T prefix', () => {
      const result = validateCryptoAddress('TRX', 'AJYs2qsBiZWpSJFoRBi8GveHHUBFcYNJaN');
      expect(result.valid).toBe(false);
    });
  });

  describe('BTC', () => {
    it('accepts valid BTC legacy address', () => {
      expect(validateCryptoAddress('BTC', '1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2')).toEqual({ valid: true });
    });
    it('accepts valid BTC bech32 address', () => {
      expect(validateCryptoAddress('BTC', 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4')).toEqual({ valid: true });
    });
  });

  describe('unknown network', () => {
    it('passes through unknown network', () => {
      expect(validateCryptoAddress('UNKNOWN_NET', 'anyaddress')).toEqual({ valid: true });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Exchange_js && npx jest --testPathPattern=withdrawal-addresses/address-validator --no-coverage 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement address validator**

```typescript
const VALIDATORS: Record<string, { pattern: RegExp; label: string }> = {
  ETH: { pattern: /^0x[0-9a-fA-F]{40}$/, label: 'Ethereum address (0x + 40 hex chars)' },
  TRX: { pattern: /^T[1-9A-HJ-NP-Za-km-z]{33}$/, label: 'Tron address (T + 33 Base58 chars)' },
  BTC: {
    pattern: /^(1[1-9A-HJ-NP-Za-km-z]{25,34}|3[1-9A-HJ-NP-Za-km-z]{25,34}|bc1[0-9a-z]{39,59})$/,
    label: 'Bitcoin address (Legacy, SegWit, or Bech32)',
  },
  SOL: { pattern: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, label: 'Solana address (Base58)' },
};

export function validateCryptoAddress(network: string, address: string): { valid: boolean; reason?: string } {
  const validator = VALIDATORS[network];
  if (!validator) return { valid: true };
  if (!validator.pattern.test(address)) {
    return { valid: false, reason: `Invalid format for ${network}. Expected: ${validator.label}` };
  }
  return { valid: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest --testPathPattern=withdrawal-addresses/address-validator --no-coverage 2>&1 | tail -10`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/address-validator*
git commit -m "feat: add crypto address format validator with tests"
```

---

### Task 5: DTOs

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/dto/create-withdrawal-address.dto.ts`
- Create: `src/modules/asset-treasury/withdrawal-addresses/dto/list-withdrawal-address-query.dto.ts`
- Create: `src/modules/asset-treasury/withdrawal-addresses/dto/suspend-withdrawal-address.dto.ts`

- [ ] **Step 1: Create CreateWithdrawalAddressDto**

```typescript
import { IsUUID, IsString, IsBoolean, IsOptional, Equals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateWithdrawalAddressDto {
  @ApiProperty({ description: 'Asset UUID' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'Blockchain address' })
  @IsString()
  address!: string;

  @ApiProperty({ description: 'Must be true — ownership declaration' })
  @IsBoolean()
  @Equals(true, { message: 'Ownership declaration must be accepted' })
  ownershipDeclaration!: boolean;

  @ApiProperty({ required: false, description: 'Optional label, e.g. "My Ledger"' })
  @IsString()
  @IsOptional()
  label?: string;
}
```

- [ ] **Step 2: Create ListWithdrawalAddressQueryDto**

```typescript
import { IsOptional, IsString, IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ListWithdrawalAddressQueryDto {
  @ApiProperty({ required: false })
  @IsUUID()
  @IsOptional()
  assetId?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  status?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  addressType?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  customerId?: string;

  @ApiProperty({ required: false, default: 50 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  take?: number;

  @ApiProperty({ required: false, default: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @IsOptional()
  skip?: number;
}
```

- [ ] **Step 3: Create SuspendWithdrawalAddressDto**

```typescript
import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SuspendWithdrawalAddressDto {
  @ApiProperty({ description: 'Reason for suspension' })
  @IsString()
  @MinLength(1)
  reason!: string;
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/dto/
git commit -m "feat: add withdrawal address DTOs"
```

---

### Task 6: Domain Service

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts`
- Create: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.spec.ts`

- [ ] **Step 1: Write domain service tests**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

describe('WithdrawalAddressService', () => {
  let service: WithdrawalAddressService;
  let prisma: any;

  const prismaMock = {
    withdrawalAddress: {
      create: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockAsset = { id: 'asset-1', code: 'ETH', type: 'CRYPTO', network: 'ETH', status: 'ACTIVE', decimals: 18 };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WithdrawalAddressService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(WithdrawalAddressService);
    prisma = module.get(PrismaService);
  });

  describe('create', () => {
    it('creates a withdrawal address with PENDING_ACTIVATION status', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      prismaMock.withdrawalAddress.create.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD2605130001', status: 'PENDING_ACTIVATION',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
      });

      const result = await service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        assetId: 'asset-1', network: 'ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      });

      expect(result.status).toBe('PENDING_ACTIVATION');
      expect(prismaMock.withdrawalAddress.create).toHaveBeenCalledTimes(1);
    });

    it('rejects when address limit reached', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(3);
      await expect(service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        assetId: 'asset-1', network: 'ETH',
        address: '0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      })).rejects.toThrow(BadRequestException);
    });

    it('rejects invalid address format', async () => {
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);
      await expect(service.create({
        customerId: 'cust-1', customerNo: 'CUS001',
        assetId: 'asset-1', network: 'ETH',
        address: 'not-a-valid-address',
        addressType: 'SELF_CUSTODY', traceId: 'trace-1',
        ownershipDeclaredAt: new Date(), ownershipProofType: 'DECLARATION',
      })).rejects.toThrow(BadRequestException);
    });
  });

  describe('activate', () => {
    it('activates an expired PENDING_ACTIVATION address', async () => {
      const pastDate = new Date(Date.now() - 86400001);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', activatesAt: pastDate,
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({
        id: 'wa-1', status: 'ACTIVE', activatedAt: expect.any(Date),
      });
      const result = await service.activate('WAD001');
      expect(result.status).toBe('ACTIVE');
    });

    it('returns existing ACTIVE address idempotently', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE',
      });
      const result = await service.activate('WAD001');
      expect(result.status).toBe('ACTIVE');
      expect(prismaMock.withdrawalAddress.update).not.toHaveBeenCalled();
    });

    it('rejects activation before cooling period expires', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', activatesAt: futureDate,
      });
      await expect(service.activate('WAD001')).rejects.toThrow(BadRequestException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING_ACTIVATION address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', customerId: 'cust-1',
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ id: 'wa-1', status: 'CANCELLED' });
      const result = await service.cancel('WAD001', 'cust-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('rejects cancel from wrong customer', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION', customerId: 'cust-1',
      });
      await expect(service.cancel('WAD001', 'cust-OTHER')).rejects.toThrow(ForbiddenException);
    });

    it('rejects cancel of non-PENDING address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE', customerId: 'cust-1',
      });
      await expect(service.cancel('WAD001', 'cust-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('suspend', () => {
    it('suspends an ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'ACTIVE',
      });
      prismaMock.withdrawalAddress.update.mockResolvedValue({ id: 'wa-1', status: 'SUSPENDED' });
      const result = await service.suspend('WAD001', 'ADM001', 'Sanctioned address');
      expect(result.status).toBe('SUSPENDED');
    });

    it('rejects suspend of non-ACTIVE address', async () => {
      prismaMock.withdrawalAddress.findUnique.mockResolvedValue({
        id: 'wa-1', addressNo: 'WAD001', status: 'PENDING_ACTIVATION',
      });
      await expect(service.suspend('WAD001', 'ADM001', 'reason')).rejects.toThrow(BadRequestException);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd Exchange_js && npx jest --testPathPattern=withdrawal-address.service.spec --no-coverage 2>&1 | tail -10`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement domain service**

```typescript
import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { validateCryptoAddress } from './address-validator.util';

const MAX_ADDRESSES_PER_ASSET = 3;
const COOLING_PERIOD_HOURS = 24;

interface CreateAddressData {
  customerId: string;
  customerNo: string;
  assetId: string;
  network: string;
  address: string;
  addressType: string;
  label?: string;
  counterpartyVaspName?: string;
  counterpartyVaspDid?: string;
  ownershipDeclaredAt: Date;
  ownershipProofType: string;
  traceId: string;
}

@Injectable()
export class WithdrawalAddressService {
  private readonly logger = new Logger(WithdrawalAddressService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(data: CreateAddressData, tx?: any) {
    const db = tx ?? this.prisma;

    const validation = validateCryptoAddress(data.network, data.address);
    if (!validation.valid) {
      throw new BadRequestException({ code: 'INVALID_ADDRESS_FORMAT', message: validation.reason });
    }

    const activeCount = await db.withdrawalAddress.count({
      where: {
        customerId: data.customerId,
        assetId: data.assetId,
        status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] },
      },
    });
    if (activeCount >= MAX_ADDRESSES_PER_ASSET) {
      throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: `Maximum ${MAX_ADDRESSES_PER_ASSET} addresses per asset` });
    }

    const addressNo = generateReferenceNo('WAD');
    const activatesAt = new Date(Date.now() + COOLING_PERIOD_HOURS * 60 * 60 * 1000);

    try {
      return await db.withdrawalAddress.create({
        data: {
          addressNo,
          customerId: data.customerId,
          customerNo: data.customerNo,
          assetId: data.assetId,
          network: data.network,
          address: data.address,
          addressType: data.addressType,
          label: data.label,
          counterpartyVaspName: data.counterpartyVaspName,
          counterpartyVaspDid: data.counterpartyVaspDid,
          ownershipDeclaredAt: data.ownershipDeclaredAt,
          ownershipProofType: data.ownershipProofType,
          activatesAt,
          traceId: data.traceId,
        },
        include: { asset: true },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException({ code: 'ADDRESS_ALREADY_REGISTERED', message: 'This address is already registered for this asset' });
      }
      throw error;
    }
  }

  async activate(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.status === 'ACTIVE') return addr;

    if (addr.status !== 'PENDING_ACTIVATION') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot activate address in ${addr.status} status` });
    }
    if (addr.activatesAt > new Date()) {
      throw new BadRequestException({ code: 'COOLING_PERIOD_NOT_EXPIRED', message: 'Cooling period has not expired yet' });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'ACTIVE', activatedAt: new Date() },
      include: { asset: true },
    });
  }

  async cancel(addressNo: string, customerId: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.customerId !== customerId) {
      throw new ForbiddenException({ code: 'NOT_OWNER', message: 'You can only cancel your own addresses' });
    }
    if (addr.status !== 'PENDING_ACTIVATION') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot cancel address in ${addr.status} status` });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: { asset: true },
    });
  }

  async suspend(addressNo: string, adminNo: string, reason: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot suspend address in ${addr.status} status` });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'SUSPENDED', suspendedAt: new Date(), suspendedBy: adminNo, suspendReason: reason },
      include: { asset: true },
    });
  }

  async skipCooling(addressNo: string, tx?: any) {
    const db = tx ?? this.prisma;
    const addr = await this.findByNoOrThrow(addressNo, db);

    if (addr.status !== 'PENDING_ACTIVATION') {
      throw new BadRequestException({ code: 'INVALID_STATUS', message: `Cannot skip cooling for address in ${addr.status} status` });
    }

    return db.withdrawalAddress.update({
      where: { addressNo },
      data: { status: 'ACTIVE', activatedAt: new Date() },
      include: { asset: true },
    });
  }

  async findByNo(addressNo: string) {
    return this.prisma.withdrawalAddress.findUnique({
      where: { addressNo },
      include: { asset: true, customer: true },
    });
  }

  async listByCustomer(customerId: string, filters: { assetId?: string; status?: string; addressType?: string; take?: number; skip?: number }) {
    const where: any = { customerId };
    if (filters.assetId) where.assetId = filters.assetId;
    if (filters.status) where.status = filters.status;
    if (filters.addressType) where.addressType = filters.addressType;

    const [items, total] = await Promise.all([
      this.prisma.withdrawalAddress.findMany({
        where, include: { asset: true },
        take: filters.take ?? 50, skip: filters.skip ?? 0,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalAddress.count({ where }),
    ]);
    return { items, total };
  }

  async listAll(filters: { customerId?: string; assetId?: string; status?: string; addressType?: string; take?: number; skip?: number }) {
    const where: any = {};
    if (filters.customerId) where.customerId = filters.customerId;
    if (filters.assetId) where.assetId = filters.assetId;
    if (filters.status) where.status = filters.status;
    if (filters.addressType) where.addressType = filters.addressType;

    const [items, total] = await Promise.all([
      this.prisma.withdrawalAddress.findMany({
        where, include: { asset: true, customer: true },
        take: filters.take ?? 50, skip: filters.skip ?? 0,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.withdrawalAddress.count({ where }),
    ]);
    return { items, total };
  }

  async findPendingExpired() {
    return this.prisma.withdrawalAddress.findMany({
      where: { status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } },
    });
  }

  async lazyActivateForCustomer(customerId: string, assetId?: string) {
    const where: any = { customerId, status: 'PENDING_ACTIVATION', activatesAt: { lte: new Date() } };
    if (assetId) where.assetId = assetId;
    const expired = await this.prisma.withdrawalAddress.findMany({ where });
    for (const addr of expired) {
      try { await this.activate(addr.addressNo); } catch { /* individual failures logged in activate */ }
    }
  }

  private async findByNoOrThrow(addressNo: string, db: any) {
    const addr = await db.withdrawalAddress.findUnique({ where: { addressNo } });
    if (!addr) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Withdrawal address ${addressNo} not found` });
    return addr;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd Exchange_js && npx jest --testPathPattern=withdrawal-address.service.spec --no-coverage 2>&1 | tail -15`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service*
git commit -m "feat: add WithdrawalAddressService domain layer with tests"
```

---

### Task 7: Workflow Service

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`

- [ ] **Step 1: Implement workflow service**

```typescript
import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
  AuditGovernanceActions,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult, AuditSubjectRole } from '../../audit-logging/dto/audit-log.dto';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { TRAVEL_RULE_ADAPTER, TravelRuleAdapter } from './travel-rule-adapter.interface';
import { CreateWithdrawalAddressDto } from './dto/create-withdrawal-address.dto';
import * as crypto from 'crypto';

@Injectable()
export class WithdrawalAddressWorkflowService {
  private readonly logger = new Logger(WithdrawalAddressWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly addressService: WithdrawalAddressService,
    private readonly auditLogsService: AuditLogsService,
    @Inject(TRAVEL_RULE_ADAPTER)
    private readonly trAdapter: TravelRuleAdapter,
  ) {}

  async registerAddress(dto: CreateWithdrawalAddressDto, customerId: string, customerNo: string) {
    const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    if (customer.onboardingStatus !== 'APPROVED') {
      throw new ForbiddenException({ code: 'ONBOARDING_NOT_APPROVED', message: 'Customer onboarding not approved' });
    }
    if (customer.adminStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Customer account is not active' });
    }

    const asset = await (this.prisma as any).asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'ASSET_NOT_ACTIVE', message: `Asset is in ${asset.status} status` });
    }
    if (asset.type !== 'CRYPTO') {
      throw new BadRequestException({ code: 'ASSET_NOT_CRYPTO', message: 'Only crypto assets are supported' });
    }

    const traceId = crypto.randomUUID();

    const attribution = await this.trAdapter.attributeAddress(dto.address, asset.network ?? '');
    const addressType = attribution.attributed ? 'VASP' : 'SELF_CUSTODY';

    const address = await this.addressService.create({
      customerId,
      customerNo,
      assetId: dto.assetId,
      network: asset.network ?? '',
      address: dto.address,
      addressType,
      label: dto.label,
      counterpartyVaspName: attribution.vaspName,
      counterpartyVaspDid: attribution.vaspDid,
      ownershipDeclaredAt: new Date(),
      ownershipProofType: 'DECLARATION',
      traceId,
    });

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_REGISTERED,
      entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      entityId: address.id,
      entityNo: address.addressNo,
      workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
      traceId,
      result: AuditResult.SUCCESS,
      subjectNos: [{ subjectRole: AuditSubjectRole.ENTITY, subjectType: 'WITHDRAWAL_ADDRESS', subjectId: address.id, subjectNo: address.addressNo }],
      metadata: { addressType, address: dto.address, network: asset.network, assetCode: asset.code, counterpartyVaspName: attribution.vaspName, label: dto.label },
      sourcePlatform: 'CLIENT_API',
      entityOwnerId: customerId,
      entityOwnerNo: customerNo,
    });

    this.logger.log(`Withdrawal address ${address.addressNo} registered by customer ${customerNo}`);
    return address;
  }

  async cancelAddress(addressNo: string, customerId: string, customerNo: string) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.cancel(addressNo, customerId);

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_CANCELLED,
      entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      entityId: existing.id,
      entityNo: addressNo,
      workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
      traceId: existing.traceId,
      result: AuditResult.SUCCESS,
      subjectNos: [{ subjectRole: AuditSubjectRole.ENTITY, subjectType: 'WITHDRAWAL_ADDRESS', subjectId: existing.id, subjectNo: addressNo }],
      metadata: { cancelledByCustomerNo: customerNo },
      sourcePlatform: 'CLIENT_API',
      entityOwnerId: customerId,
      entityOwnerNo: customerNo,
    });

    return result;
  }

  async activateAddress(addressNo: string, activatedBy: 'CRON' | 'LAZY' = 'CRON') {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.activate(addressNo);

    if (result.status === 'ACTIVE' && existing.status === 'PENDING_ACTIVATION') {
      await this.auditLogsService.recordSystem({
        action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_ACTIVATED,
        entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        entityId: existing.id,
        entityNo: addressNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
        traceId: existing.traceId,
        result: AuditResult.SUCCESS,
        subjectNos: [{ subjectRole: AuditSubjectRole.ENTITY, subjectType: 'WITHDRAWAL_ADDRESS', subjectId: existing.id, subjectNo: addressNo }],
        metadata: { activatedBy },
        sourcePlatform: 'SYSTEM',
        entityOwnerId: existing.customerId,
        entityOwnerNo: existing.customerNo,
      });
    }

    return result;
  }

  async suspendAddress(addressNo: string, actor: { userId: string; userNo: string; role: string }, reason: string) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.suspend(addressNo, actor.userNo, reason);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_SUSPENDED,
        entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        entityId: existing.id,
        entityNo: addressNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
        traceId: existing.traceId,
        result: AuditResult.SUCCESS,
        subjectNos: [{ subjectRole: AuditSubjectRole.ENTITY, subjectType: 'WITHDRAWAL_ADDRESS', subjectId: existing.id, subjectNo: addressNo }],
        metadata: { reason, suspendedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        entityOwnerId: existing.customerId,
        entityOwnerNo: existing.customerNo,
      },
      { actorType: 'ADMIN', actorId: actor.userId, actorNo: actor.userNo, actorRole: actor.role },
    );

    return result;
  }

  async skipCoolingPeriod(addressNo: string, actor: { userId: string; userNo: string; role: string }) {
    const existing = await this.addressService.findByNo(addressNo);
    if (!existing) throw new NotFoundException({ code: 'ADDRESS_NOT_FOUND', message: `Address ${addressNo} not found` });

    const result = await this.addressService.skipCooling(addressNo);

    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.MANUAL_COOLING_SKIP,
        entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
        entityId: existing.id,
        entityNo: addressNo,
        workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
        traceId: existing.traceId,
        result: AuditResult.SUCCESS,
        subjectNos: [{ subjectRole: AuditSubjectRole.ENTITY, subjectType: 'WITHDRAWAL_ADDRESS', subjectId: existing.id, subjectNo: addressNo }],
        metadata: { skippedBy: actor.userNo },
        sourcePlatform: 'ADMIN_API',
        entityOwnerId: existing.customerId,
        entityOwnerNo: existing.customerNo,
      },
      { actorType: 'ADMIN', actorId: actor.userId, actorNo: actor.userNo, actorRole: actor.role },
    );

    return result;
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts
git commit -m "feat: add WithdrawalAddressWorkflowService with audit logging"
```

---

### Task 8: Sweep Service

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-sweep.service.ts`

- [ ] **Step 1: Implement sweep service**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';

@Injectable()
export class WithdrawalAddressSweepService {
  private readonly logger = new Logger(WithdrawalAddressSweepService.name);

  constructor(
    private readonly addressService: WithdrawalAddressService,
    private readonly workflowService: WithdrawalAddressWorkflowService,
  ) {}

  @Cron('*/5 * * * *')
  async handleCoolingExpiry() {
    const expired = await this.addressService.findPendingExpired();
    if (expired.length === 0) return;

    this.logger.log(`Found ${expired.length} withdrawal addresses with expired cooling period`);
    let activated = 0;

    for (const addr of expired) {
      try {
        await this.workflowService.activateAddress(addr.addressNo, 'CRON');
        activated++;
      } catch (error) {
        this.logger.error(`Failed to activate withdrawal address ${addr.addressNo}`, error);
      }
    }

    this.logger.log(`Activated ${activated}/${expired.length} withdrawal addresses`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-sweep.service.ts
git commit -m "feat: add withdrawal address cooling period sweep service"
```

---

### Task 9: Client Controller

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.controller.ts`

- [ ] **Step 1: Implement client controller**

```typescript
import { Controller, Post, Get, Delete, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { CreateWithdrawalAddressDto } from './dto/create-withdrawal-address.dto';
import { ListWithdrawalAddressQueryDto } from './dto/list-withdrawal-address-query.dto';

@ApiTags('client/withdrawal-addresses')
@ApiBearerAuth()
@Controller('client/withdrawal-addresses')
@UseGuards(AuthGuard('jwt'))
export class WithdrawalAddressController {
  constructor(
    private readonly workflowService: WithdrawalAddressWorkflowService,
    private readonly addressService: WithdrawalAddressService,
  ) {}

  private extractCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return { customerId: req.user.userId, customerNo: req.user.userNo ?? req.user.userId };
  }

  @Post()
  @ApiOperation({ summary: 'Register a new withdrawal address' })
  async create(@Request() req: any, @Body() dto: CreateWithdrawalAddressDto) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.registerAddress(dto, customerId, customerNo);
  }

  @Get()
  @ApiOperation({ summary: 'List my withdrawal addresses' })
  async list(@Request() req: any, @Query() query: ListWithdrawalAddressQueryDto) {
    const { customerId } = this.extractCustomer(req);
    await this.addressService.lazyActivateForCustomer(customerId, query.assetId);
    return this.addressService.listByCustomer(customerId, query);
  }

  @Get(':addressNo')
  @ApiOperation({ summary: 'Get withdrawal address detail' })
  async findOne(@Request() req: any, @Param('addressNo') addressNo: string) {
    const { customerId } = this.extractCustomer(req);
    await this.addressService.lazyActivateForCustomer(customerId);
    const address = await this.addressService.findByNo(addressNo);
    if (!address || address.customerId !== customerId) {
      throw new ForbiddenException('Address not found or not owned by you');
    }
    return address;
  }

  @Delete(':addressNo')
  @ApiOperation({ summary: 'Cancel a withdrawal address during cooling period' })
  async cancel(@Request() req: any, @Param('addressNo') addressNo: string) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.cancelAddress(addressNo, customerId, customerNo);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.controller.ts
git commit -m "feat: add client WithdrawalAddress controller"
```

---

### Task 10: Admin Controller

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-admin.controller.ts`

- [ ] **Step 1: Implement admin controller**

```typescript
import { Controller, Get, Post, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { ListWithdrawalAddressQueryDto } from './dto/list-withdrawal-address-query.dto';
import { SuspendWithdrawalAddressDto } from './dto/suspend-withdrawal-address.dto';
import { AdminPermissionGuard } from '../../identity/access-control/guards/admin-permission.guard';

@ApiTags('admin/withdrawal-addresses')
@ApiBearerAuth()
@Controller('admin/withdrawal-addresses')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
export class WithdrawalAddressAdminController {
  constructor(
    private readonly workflowService: WithdrawalAddressWorkflowService,
    private readonly addressService: WithdrawalAddressService,
  ) {}

  private extractAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return {
      userId: req.user.userId,
      userNo: req.user.userNo ?? req.user.userId,
      role: req.user.role ?? req.user.roleCodes?.[0] ?? 'UNKNOWN',
    };
  }

  @Get()
  @ApiOperation({ summary: 'List all withdrawal addresses' })
  async list(@Query() query: ListWithdrawalAddressQueryDto) {
    return this.addressService.listAll(query);
  }

  @Get(':addressNo')
  @ApiOperation({ summary: 'Get withdrawal address detail' })
  async findOne(@Param('addressNo') addressNo: string) {
    return this.addressService.findByNo(addressNo);
  }

  @Post(':addressNo/suspend')
  @ApiOperation({ summary: 'Force suspend a withdrawal address' })
  async suspend(@Request() req: any, @Param('addressNo') addressNo: string, @Body() dto: SuspendWithdrawalAddressDto) {
    const actor = this.extractAdmin(req);
    return this.workflowService.suspendAddress(addressNo, actor, dto.reason);
  }

  @Post(':addressNo/skip-cooling')
  @ApiOperation({ summary: 'Skip cooling period (simulation)' })
  async skipCooling(@Request() req: any, @Param('addressNo') addressNo: string) {
    const actor = this.extractAdmin(req);
    return this.workflowService.skipCoolingPeriod(addressNo, actor);
  }
}
```

- [ ] **Step 2: Verify import path for AdminPermissionGuard is correct**

Run: `cd Exchange_js && find src -name 'admin-permission.guard.ts' -o -name 'AdminPermissionGuard*' 2>/dev/null | head -5`

If the path differs from `../../identity/access-control/guards/admin-permission.guard`, update the import accordingly.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-admin.controller.ts
git commit -m "feat: add admin WithdrawalAddress controller"
```

---

### Task 11: Module Registration

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-addresses.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create the module**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLogsModule } from '../../audit-logging/audit-logs.module';
import { WithdrawalAddressService } from './withdrawal-address.service';
import { WithdrawalAddressWorkflowService } from './withdrawal-address-workflow.service';
import { WithdrawalAddressSweepService } from './withdrawal-address-sweep.service';
import { WithdrawalAddressController } from './withdrawal-address.controller';
import { WithdrawalAddressAdminController } from './withdrawal-address-admin.controller';
import { TRAVEL_RULE_ADAPTER } from './travel-rule-adapter.interface';
import { MockTravelRuleAdapter } from './mock-travel-rule.adapter';

@Module({
  imports: [PrismaModule, AuditLogsModule],
  controllers: [WithdrawalAddressController, WithdrawalAddressAdminController],
  providers: [
    WithdrawalAddressService,
    WithdrawalAddressWorkflowService,
    WithdrawalAddressSweepService,
    { provide: TRAVEL_RULE_ADAPTER, useClass: MockTravelRuleAdapter },
  ],
  exports: [WithdrawalAddressService],
})
export class WithdrawalAddressesModule {}
```

- [ ] **Step 2: Register module in app.module.ts**

In `src/app.module.ts`, add import:

```typescript
import { WithdrawalAddressesModule } from './modules/asset-treasury/withdrawal-addresses/withdrawal-addresses.module';
```

Add `WithdrawalAddressesModule` to the `imports` array, after `WalletsModule`.

- [ ] **Step 3: Verify the application compiles and starts**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-addresses.module.ts src/app.module.ts
git commit -m "feat: register WithdrawalAddressesModule"
```

---

### Task 12: Backend integration test

**Files:** (no new files)

- [ ] **Step 1: Start the server and test the API**

Run: `cd Exchange_js && npm run dev:start 2>&1 | tail -5`

Wait for startup, then test Swagger is available:

Run: `curl -s http://localhost:3500/api-json | grep -c "withdrawal-addresses"`
Expected: Number greater than 0 (endpoints visible in Swagger).

- [ ] **Step 2: Commit (if any adjustments needed)**

If any fixes were required, commit them:
```bash
git add -A
git commit -m "fix: resolve withdrawal address module startup issues"
```

---

### Task 13: Admin Frontend — List Page

**Files:**
- Create: `admin-web/src/pages/WithdrawalAddressList.tsx`

- [ ] **Step 1: Create the list page**

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { adminFetch } from '../utils/adminFetch';
import Pagination from '../components/common/Pagination';

const STATUS_OPTIONS = ['ALL', 'PENDING_ACTIVATION', 'ACTIVE', 'CANCELLED', 'SUSPENDED'];
const TYPE_OPTIONS = ['ALL', 'VASP', 'SELF_CUSTODY'];

const STATUS_COLORS: Record<string, string> = {
  PENDING_ACTIVATION: 'bg-amber-500/10 text-amber-400',
  ACTIVE: 'bg-emerald-500/10 text-emerald-400',
  CANCELLED: 'bg-slate-500/10 text-slate-400',
  SUSPENDED: 'bg-red-500/10 text-red-400',
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  VASP: { label: 'VASP', color: 'bg-blue-500/10 text-blue-400' },
  SELF_CUSTODY: { label: 'Self-Custody', color: 'bg-purple-500/10 text-purple-400' },
};

interface WithdrawalAddr {
  id: string;
  addressNo: string;
  customerId: string;
  customerNo: string;
  address: string;
  addressType: string;
  network: string;
  status: string;
  createdAt: string;
  asset: { code: string };
}

export default function WithdrawalAddressList() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WithdrawalAddr[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const take = 20;

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ take: String(take), skip: String(page * take) });
        if (statusFilter !== 'ALL') params.set('status', statusFilter);
        if (typeFilter !== 'ALL') params.set('addressType', typeFilter);
        const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses?${params}`);
        if (res.ok) {
          const data = await res.json();
          setItems(data.items ?? []);
          setTotal(data.total ?? 0);
        }
      } catch { /* session error handled globally */ }
      setLoading(false);
    };
    void fetchData();
  }, [statusFilter, typeFilter, page]);

  const truncateAddr = (a: string) => a.length > 14 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-adm-t1">Withdrawal Addresses</h1>
      </div>

      <div className="mb-4 flex gap-3">
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          className="rounded border border-adm-border bg-adm-bg px-2 py-1 text-xs text-adm-t1">
          {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s === 'ALL' ? 'All Statuses' : s}</option>)}
        </select>
        <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(0); }}
          className="rounded border border-adm-border bg-adm-bg px-2 py-1 text-xs text-adm-t1">
          {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t === 'ALL' ? 'All Types' : t}</option>)}
        </select>
      </div>

      <div className="overflow-hidden rounded-lg border border-adm-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-adm-panel text-adm-t3">
            <tr>
              <th className="px-3 py-2">Address No</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Asset</th>
              <th className="px-3 py-2">Network</th>
              <th className="px-3 py-2">Address</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Registered</th>
              <th className="px-3 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-adm-border">
            {loading ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-adm-t3">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-adm-t3">No withdrawal addresses found.</td></tr>
            ) : items.map((item) => (
              <tr key={item.id} onClick={() => navigate(`/withdrawal-addresses/${item.addressNo}`)}
                className="cursor-pointer hover:bg-adm-hover transition-colors">
                <td className="px-3 py-2 font-mono text-adm-amber">{item.addressNo}</td>
                <td className="px-3 py-2 text-adm-blue">{item.customerNo}</td>
                <td className="px-3 py-2 text-adm-t1">{item.asset?.code}</td>
                <td className="px-3 py-2 text-adm-t2">{item.network}</td>
                <td className="px-3 py-2 font-mono text-adm-t2">{truncateAddr(item.address)}</td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${TYPE_LABELS[item.addressType]?.color ?? 'text-adm-t3'}`}>
                    {TYPE_LABELS[item.addressType]?.label ?? item.addressType}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[item.status] ?? 'text-adm-t3'}`}>
                    {item.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-adm-t3">{new Date(item.createdAt).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-adm-t3"><ChevronRight size={14} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {total > take && <Pagination total={total} take={take} page={page} onPageChange={setPage} />}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/WithdrawalAddressList.tsx
git commit -m "feat: add admin WithdrawalAddressList page"
```

---

### Task 14: Admin Frontend — Detail Page

**Files:**
- Create: `admin-web/src/pages/WithdrawalAddressDetail.tsx`

- [ ] **Step 1: Create the detail page**

```tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { adminFetch, getApiErrorMessage, AdminSessionError } from '../utils/adminFetch';
import { adminButtonClass } from '../components/common/adminButtonStyles';

interface WithdrawalAddr {
  id: string;
  addressNo: string;
  customerId: string;
  customerNo: string;
  address: string;
  addressType: string;
  network: string;
  label: string | null;
  counterpartyVaspName: string | null;
  counterpartyVaspDid: string | null;
  ownershipDeclaredAt: string | null;
  status: string;
  activatesAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspendedBy: string | null;
  suspendReason: string | null;
  cancelledAt: string | null;
  traceId: string;
  createdAt: string;
  asset: { code: string; type: string };
  customer: { id: string; customerNo: string } | null;
}

export default function WithdrawalAddressDetail() {
  const { addressNo } = useParams<{ addressNo: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<WithdrawalAddr | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState('');
  const [suspendReason, setSuspendReason] = useState('');
  const [showSuspendModal, setShowSuspendModal] = useState(false);

  const fetchData = async () => {
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}`);
      if (res.ok) setData(await res.json());
    } catch { /* session handled globally */ }
    setLoading(false);
  };

  useEffect(() => { void fetchData(); }, [addressNo]);

  const handleSkipCooling = async () => {
    setActionLoading(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}/skip-cooling`, { method: 'POST' });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to skip cooling')); return; }
      await fetchData();
    } catch (err) {
      if (!(err instanceof AdminSessionError)) setError('Failed to skip cooling period');
    } finally { setActionLoading(false); }
  };

  const handleSuspend = async () => {
    if (!suspendReason.trim()) return;
    setActionLoading(true);
    setError('');
    try {
      const res = await adminFetch(`${import.meta.env.VITE_API_URL}/admin/withdrawal-addresses/${addressNo}/suspend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: suspendReason }),
      });
      if (!res.ok) { setError(await getApiErrorMessage(res, 'Failed to suspend')); return; }
      setShowSuspendModal(false);
      setSuspendReason('');
      await fetchData();
    } catch (err) {
      if (!(err instanceof AdminSessionError)) setError('Failed to suspend address');
    } finally { setActionLoading(false); }
  };

  if (loading) return <div className="p-6 text-adm-t3">Loading...</div>;
  if (!data) return <div className="p-6 text-adm-t3">Address not found</div>;

  const isPending = data.status === 'PENDING_ACTIVATION';
  const isActive = data.status === 'ACTIVE';
  const remaining = isPending ? Math.max(0, new Date(data.activatesAt).getTime() - Date.now()) : 0;
  const remainingHours = Math.floor(remaining / 3600000);
  const remainingMinutes = Math.floor((remaining % 3600000) / 60000);
  const elapsed = isPending ? Math.max(0, Date.now() - new Date(data.createdAt).getTime()) : 0;
  const totalCooling = isPending ? new Date(data.activatesAt).getTime() - new Date(data.createdAt).getTime() : 1;
  const progressPct = Math.min(100, Math.round((elapsed / totalCooling) * 100));

  const labelCls = 'text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3';
  const valCls = 'text-xs text-adm-t1 mt-0.5';

  return (
    <div className="p-6">
      <button onClick={() => navigate('/withdrawal-addresses')} className="mb-3 flex items-center gap-1 text-xs text-adm-t3 hover:text-adm-t1">
        <ArrowLeft size={14} /> Withdrawal Addresses
      </button>

      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold text-adm-t1">{data.addressNo}</h1>
        <span className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
          isPending ? 'bg-amber-500/10 text-amber-400' :
          isActive ? 'bg-emerald-500/10 text-emerald-400' :
          data.status === 'SUSPENDED' ? 'bg-red-500/10 text-red-400' : 'bg-slate-500/10 text-slate-400'
        }`}>{data.status}</span>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">{error}</div>}

      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 space-y-4">
          {/* Identity */}
          <div className="rounded-lg border border-adm-border bg-adm-card p-4">
            <div className={`${labelCls} mb-3`}>Identity</div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className={labelCls}>Address No</div><div className={valCls}>{data.addressNo}</div></div>
              <div><div className={labelCls}>Type</div><div className={`${valCls} ${data.addressType === 'VASP' ? 'text-blue-400' : 'text-purple-400'}`}>{data.addressType}</div></div>
              <div className="col-span-2"><div className={labelCls}>Address</div><div className="mt-0.5 rounded border border-adm-border bg-adm-bg px-2 py-1 font-mono text-[11px] text-adm-t1 break-all">{data.address}</div></div>
            </div>
          </div>

          {/* Asset & Network */}
          <div className="rounded-lg border border-adm-border bg-adm-card p-4">
            <div className={`${labelCls} mb-3`}>Asset & Network</div>
            <div className="grid grid-cols-3 gap-3">
              <div><div className={labelCls}>Asset</div><div className={valCls}>{data.asset.code}</div></div>
              <div><div className={labelCls}>Network</div><div className={valCls}>{data.network}</div></div>
              <div><div className={labelCls}>Label</div><div className={valCls}>{data.label || '—'}</div></div>
            </div>
          </div>

          {/* Customer */}
          <div className="rounded-lg border border-adm-border bg-adm-card p-4">
            <div className={`${labelCls} mb-3`}>Customer</div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className={labelCls}>Customer No</div><div className={`${valCls} text-adm-blue cursor-pointer underline`}>{data.customerNo}</div></div>
              <div><div className={labelCls}>Ownership Declaration</div>
                <div className={valCls}>{data.ownershipDeclaredAt ? `✓ Declared ${new Date(data.ownershipDeclaredAt).toLocaleString()}` : '—'}</div>
              </div>
            </div>
          </div>

          {/* VASP Info */}
          {data.addressType === 'VASP' && (
            <div className="rounded-lg border border-blue-500/30 bg-adm-card p-4">
              <div className={`${labelCls} mb-3 text-blue-400`}>VASP Info</div>
              <div className="grid grid-cols-2 gap-3">
                <div><div className={labelCls}>Counterparty VASP</div><div className={valCls}>{data.counterpartyVaspName || '—'}</div></div>
                <div><div className={labelCls}>VASP DID</div><div className={`${valCls} font-mono text-[10px]`}>{data.counterpartyVaspDid || '—'}</div></div>
              </div>
            </div>
          )}

          {/* Cooling Period */}
          {isPending && (
            <div className="rounded-lg border border-amber-500/30 bg-adm-card p-4">
              <div className={`${labelCls} mb-3 text-amber-400`}>Cooling Period</div>
              <div className="grid grid-cols-3 gap-3">
                <div><div className={labelCls}>Registered At</div><div className={valCls}>{new Date(data.createdAt).toLocaleString()}</div></div>
                <div><div className={labelCls}>Activates At</div><div className={`${valCls} font-semibold text-amber-400`}>{new Date(data.activatesAt).toLocaleString()}</div></div>
                <div><div className={labelCls}>Remaining</div><div className="mt-0.5 text-sm font-bold text-amber-400">{remainingHours}h {remainingMinutes}m</div></div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-adm-border">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-300" style={{ width: `${progressPct}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-adm-t3">{progressPct}% elapsed</div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-[272px] space-y-5">
          {/* Actions */}
          <div>
            <div className={`${labelCls} mb-2`}>Actions</div>
            {isPending && (
              <>
                <button onClick={handleSkipCooling} disabled={actionLoading}
                  className="mb-1.5 w-full rounded-md border border-dashed border-purple-400 bg-purple-500/5 px-3 py-2 text-[11px] font-semibold text-purple-400 hover:bg-purple-500/10 transition-colors disabled:opacity-50">
                  ⚡ Skip Cooling Period
                </button>
                <div className="mb-4 px-1 text-[9px] text-adm-t3">Simulation — immediately activates this address</div>
              </>
            )}
            {isActive && (
              <>
                <button onClick={() => setShowSuspendModal(true)} disabled={actionLoading}
                  className="w-full rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[11px] font-semibold text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-50">
                  Force Suspend
                </button>
                <div className="mt-1 px-1 text-[9px] text-adm-t3">Requires reason — compliance action</div>
              </>
            )}
            {!isPending && !isActive && (
              <div className="text-[10px] text-adm-t3">No actions available</div>
            )}
          </div>

          {/* Status */}
          <div>
            <div className={`${labelCls} mb-2`}>Status</div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-adm-t3">Status</span><span className="text-adm-t1">{data.status}</span></div>
              <div className="flex justify-between"><span className="text-adm-t3">Type</span><span className="text-adm-t1">{data.addressType}</span></div>
              <div className="flex justify-between"><span className="text-adm-t3">Network</span><span className="text-adm-t1">{data.network}</span></div>
            </div>
          </div>

          {/* Audit Trace */}
          <div>
            <div className={`${labelCls} mb-2`}>Audit Trace</div>
            <div className="space-y-1.5 text-[11px]">
              <div className="flex justify-between"><span className="text-adm-t3">Trace ID</span><span className="text-adm-t1 font-mono text-[10px]">{data.traceId.slice(0, 8)}...{data.traceId.slice(-4)}</span></div>
            </div>
          </div>
        </div>
      </div>

      {/* Suspend Modal */}
      {showSuspendModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-adm-border bg-white shadow-xl">
            <div className="border-b border-adm-border px-6 py-4">
              <h2 className="text-base font-semibold text-adm-t1">Suspend Withdrawal Address</h2>
              <p className="mt-1 text-xs text-adm-t3">This will prevent the address from being used for withdrawals.</p>
            </div>
            <div className="px-6 py-4">
              <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-adm-t3 mb-1.5">Reason</label>
              <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                placeholder="e.g. Sanctioned address identified by KYT"
                className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber h-20 resize-none" />
            </div>
            <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
              <button onClick={() => { setShowSuspendModal(false); setSuspendReason(''); }} className={adminButtonClass('modalCancel')}>Cancel</button>
              <button onClick={handleSuspend} disabled={!suspendReason.trim() || actionLoading}
                className="rounded-md bg-red-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50">Suspend</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin-web/src/pages/WithdrawalAddressDetail.tsx
git commit -m "feat: add admin WithdrawalAddressDetail page with skip-cooling and suspend"
```

---

### Task 15: Client Frontend — WithdrawalAddresses Page

**Files:**
- Create: `client-web/src/pages/WithdrawalAddresses.tsx`

- [ ] **Step 1: Create the client withdrawal addresses page**

This is a single-file component with three view states (list → form → confirmation). Due to its length, implement it with these key sections:

```tsx
import { useEffect, useState } from 'react';
import { AlertCircle, Plus, X, Clock, Check } from 'lucide-react';

const VITE_API_URL = import.meta.env.VITE_API_URL;

interface Asset { id: string; code: string; type: string; network: string; }
interface WithdrawalAddr {
  addressNo: string; address: string; addressType: string; network: string;
  status: string; label: string | null; activatesAt: string; activatedAt: string | null;
  counterpartyVaspName: string | null;
  asset: { code: string };
}

type View = 'list' | 'form' | 'confirmation';

export default function WithdrawalAddresses() {
  const [view, setView] = useState<View>('list');
  const [assets, setAssets] = useState<Asset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [addresses, setAddresses] = useState<WithdrawalAddr[]>([]);
  const [loading, setLoading] = useState(true);
  const [newAddress, setNewAddress] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [declaration, setDeclaration] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [lastCreated, setLastCreated] = useState<WithdrawalAddr | null>(null);

  // Helper: customerFetch equivalent
  const apiFetch = async (url: string, opts?: RequestInit) => {
    const token = localStorage.getItem('customerToken');
    return fetch(url, { ...opts, headers: { ...opts?.headers, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
  };

  // Fetch assets on mount
  useEffect(() => {
    const load = async () => {
      try {
        const res = await apiFetch(`${VITE_API_URL}/assets?take=200`);
        if (res.ok) {
          const data = await res.json();
          const cryptoActive = ((data.items ?? data) as Asset[]).filter(a => a.type === 'CRYPTO');
          setAssets(cryptoActive);
          if (cryptoActive.length > 0) setSelectedAssetId(cryptoActive[0].id);
        }
      } catch { /* ignore */ }
    };
    void load();
  }, []);

  // Fetch addresses when asset changes
  useEffect(() => {
    if (!selectedAssetId) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await apiFetch(`${VITE_API_URL}/client/withdrawal-addresses?assetId=${selectedAssetId}`);
        if (res.ok) {
          const data = await res.json();
          setAddresses(data.items ?? []);
        }
      } catch { /* ignore */ }
      setLoading(false);
    };
    void load();
  }, [selectedAssetId, view]);

  const activeCount = addresses.filter(a => ['PENDING_ACTIVATION', 'ACTIVE'].includes(a.status)).length;
  const canAdd = activeCount < 3;

  const handleSubmit = async () => {
    setError('');
    if (!newAddress.trim()) { setError('Address is required'); return; }
    if (!declaration) { setError('You must accept the ownership declaration'); return; }
    setSubmitting(true);
    try {
      const res = await apiFetch(`${VITE_API_URL}/client/withdrawal-addresses`, {
        method: 'POST',
        body: JSON.stringify({ assetId: selectedAssetId, address: newAddress.trim(), ownershipDeclaration: true, label: newLabel.trim() || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Failed to register address');
        return;
      }
      const created = await res.json();
      setLastCreated(created);
      setView('confirmation');
      setNewAddress('');
      setNewLabel('');
      setDeclaration(false);
    } catch (err: any) {
      setError(err.message || 'Failed to register address');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (addrNo: string) => {
    try {
      const res = await apiFetch(`${VITE_API_URL}/client/withdrawal-addresses/${addrNo}`, { method: 'DELETE' });
      if (res.ok) {
        setAddresses(prev => prev.map(a => a.addressNo === addrNo ? { ...a, status: 'CANCELLED' } : a));
        if (lastCreated?.addressNo === addrNo) setView('list');
      }
    } catch { /* ignore */ }
  };

  // Countdown helper
  const formatCountdown = (activatesAt: string) => {
    const ms = Math.max(0, new Date(activatesAt).getTime() - Date.now());
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  };

  if (view === 'confirmation' && lastCreated) {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
          <Clock size={24} className="text-amber-400" />
        </div>
        <h2 className="text-lg font-semibold text-white">Cooling Period Active</h2>
        <p className="mt-2 text-sm text-gray-400">Your address has been registered and will be available for withdrawals after the safety cooling period expires.</p>
        <div className="mt-4 rounded-lg border border-amber-500/30 bg-gray-900 p-4">
          <div className="text-xs text-amber-400 uppercase">Activates In</div>
          <div className="mt-1 text-2xl font-bold font-mono text-amber-400">{formatCountdown(lastCreated.activatesAt)}</div>
          <div className="mt-1 text-xs text-gray-500">{new Date(lastCreated.activatesAt).toLocaleString()}</div>
        </div>
        <div className="mt-4 rounded-lg bg-gray-900 p-3 text-left text-xs space-y-1">
          <div className="flex justify-between"><span className="text-gray-500">Address</span><span className="text-white font-mono">{lastCreated.address.slice(0, 6)}...{lastCreated.address.slice(-4)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Type</span><span className={lastCreated.addressType === 'VASP' ? 'text-blue-400' : 'text-purple-400'}>{lastCreated.addressType}</span></div>
          {lastCreated.label && <div className="flex justify-between"><span className="text-gray-500">Label</span><span className="text-white">{lastCreated.label}</span></div>}
        </div>
        <button onClick={() => handleCancel(lastCreated.addressNo)}
          className="mt-4 w-full rounded-lg border border-red-500/30 py-2 text-xs text-red-400 hover:bg-red-500/10">Cancel Registration</button>
        <button onClick={() => setView('list')}
          className="mt-2 w-full py-2 text-xs text-gray-400 hover:text-white">Back to Addresses</button>
      </div>
    );
  }

  if (view === 'form') {
    return (
      <div className="mx-auto max-w-md p-6">
        <button onClick={() => setView('list')} className="mb-4 text-xs text-gray-400 hover:text-white">← Back</button>
        <h2 className="text-lg font-semibold text-white mb-4">New Withdrawal Address</h2>
        {error && <div className="mb-3 flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400"><AlertCircle size={14} className="mt-0.5 shrink-0" />{error}</div>}
        <div className="space-y-4">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Wallet Address</label>
            <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)}
              placeholder="0x..." className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-600 outline-none focus:border-purple-500" />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Label (optional)</label>
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. My Ledger" className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-purple-500" />
          </div>
          <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={declaration} onChange={(e) => setDeclaration(e.target.checked)} className="mt-0.5" />
              <span className="text-xs text-purple-300 leading-relaxed">I declare that I am the sole owner and controller of this wallet address. I understand that providing false information may result in account suspension and regulatory action.</span>
            </label>
          </div>
          <button onClick={handleSubmit} disabled={submitting || !declaration}
            className="w-full rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50">{submitting ? 'Registering...' : 'Register Address'}</button>
        </div>
      </div>
    );
  }

  // List view (default)
  return (
    <div className="mx-auto max-w-lg p-6">
      <h2 className="text-lg font-semibold text-white mb-4">My Withdrawal Addresses</h2>
      <div className="mb-4">
        <label className="block text-xs text-gray-400 mb-1">Asset</label>
        <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white">
          {assets.map(a => <option key={a.id} value={a.id}>{a.code} — {a.network}</option>)}
        </select>
      </div>

      <div className="mb-2 text-xs text-gray-500">Registered Addresses ({activeCount}/3)</div>
      {loading ? <div className="text-center text-xs text-gray-500 py-8">Loading...</div> : (
        <div className="space-y-2 mb-4">
          {addresses.filter(a => a.status !== 'CANCELLED').map(a => (
            <div key={a.addressNo} className="rounded-lg border border-gray-700 bg-gray-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-white">{a.label || a.address.slice(0, 10) + '...'}</div>
                  <div className="text-xs text-gray-500 font-mono">{a.address.slice(0, 6)}...{a.address.slice(-4)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] ${a.addressType === 'VASP' ? 'text-blue-400' : 'text-purple-400'}`}>{a.addressType === 'VASP' ? 'VASP' : 'Self'}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    a.status === 'ACTIVE' ? 'bg-emerald-500/10 text-emerald-400' :
                    a.status === 'PENDING_ACTIVATION' ? 'bg-amber-500/10 text-amber-400' :
                    'bg-red-500/10 text-red-400'}`}>{a.status === 'PENDING_ACTIVATION' ? formatCountdown(a.activatesAt) : a.status}</span>
                </div>
              </div>
              {a.status === 'PENDING_ACTIVATION' && (
                <button onClick={() => handleCancel(a.addressNo)} className="mt-2 text-[10px] text-red-400 hover:underline">Cancel</button>
              )}
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setView('form')} disabled={!canAdd}
        className="w-full rounded-lg border border-dashed border-purple-500/50 py-2.5 text-sm text-purple-400 hover:bg-purple-500/5 disabled:opacity-50 disabled:cursor-not-allowed">
        <Plus size={14} className="inline mr-1" /> Add Withdrawal Address
      </button>
      {!canAdd && <div className="mt-1 text-center text-[10px] text-gray-500">Maximum 3 addresses reached</div>}
    </div>
  );
}
```

Note: This page uses a local `apiFetch` helper. If the project has a canonical `customerFetch` utility (check `client-web/src/utils/`), replace `apiFetch` with it and adjust the token read accordingly.

- [ ] **Step 2: Commit**

```bash
git add client-web/src/pages/WithdrawalAddresses.tsx
git commit -m "feat: add client WithdrawalAddresses page with 3-step registration flow"
```

---

### Task 16: Route Registration

**Files:**
- Modify: `admin-web/src/App.tsx`
- Modify: `client-web/src/App.tsx`

- [ ] **Step 1: Add admin routes**

In `admin-web/src/App.tsx`, add lazy import at the top with other imports:

```typescript
const WithdrawalAddressList = lazy(() => import('./pages/WithdrawalAddressList'));
const WithdrawalAddressDetail = lazy(() => import('./pages/WithdrawalAddressDetail'));
```

Add routes inside the `<DashboardLayout>` route group, after the custodian-wallets routes:

```tsx
<Route path="/withdrawal-addresses" element={<WithdrawalAddressList />} />
<Route path="/withdrawal-addresses/:addressNo" element={<WithdrawalAddressDetail />} />
```

- [ ] **Step 2: Add client route**

In `client-web/src/App.tsx`, add lazy import:

```typescript
const WithdrawalAddresses = lazy(() => import('./pages/WithdrawalAddresses'));
```

Add route inside the dashboard layout group, after the withdraw route:

```tsx
<Route path="/withdrawal-addresses" element={<AuthGuard><WithdrawalAddresses /></AuthGuard>} />
```

- [ ] **Step 3: Verify both apps compile**

Run: `cd Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -10`
Run: `cd Exchange_js/client-web && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add admin-web/src/App.tsx client-web/src/App.tsx
git commit -m "feat: register withdrawal address routes in admin and client apps"
```

---

### Task 17: Full stack smoke test

- [ ] **Step 1: Start the full stack**

Run: `cd Exchange_js && npm run dev:start`

- [ ] **Step 2: Verify admin list page loads**

Open `http://localhost:3501/withdrawal-addresses` in browser. Should show empty list with filters.

- [ ] **Step 3: Verify client page loads**

Open `http://localhost:3502/withdrawal-addresses` in browser. Should show asset selector and empty list.

- [ ] **Step 4: Test registration flow via API**

```bash
# Get a customer token first (adjust endpoint as needed)
TOKEN="<customer-jwt>"
ASSET_ID="<active-crypto-asset-id>"

curl -s -X POST http://localhost:3500/client/withdrawal-addresses \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"assetId\":\"$ASSET_ID\",\"address\":\"0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18\",\"ownershipDeclaration\":true,\"label\":\"Test Ledger\"}" | jq .
```

Expected: 201 response with `status: "PENDING_ACTIVATION"` and `addressType: "SELF_CUSTODY"`.

- [ ] **Step 5: Test admin skip-cooling via API**

```bash
ADMIN_TOKEN="<admin-jwt>"
ADDRESS_NO="<from-step-4-response>"

curl -s -X POST http://localhost:3500/admin/withdrawal-addresses/$ADDRESS_NO/skip-cooling \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .
```

Expected: 200 response with `status: "ACTIVE"`.

- [ ] **Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve withdrawal address smoke test issues"
```
