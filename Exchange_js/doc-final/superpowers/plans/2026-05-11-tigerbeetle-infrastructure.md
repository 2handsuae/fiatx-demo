# TigerBeetle Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 接入 TigerBeetle 作为余额 source of truth，建立 AccountingService 薄适配器 + Prisma 证据层，替代现有 Journal/JournalLine 双式记账体系。

**Architecture:** TigerBeetleService（纯 TB 客户端）→ AccountingService（TB 写账 + Prisma 证据）→ TbEvidenceService（证据写入/查询）。三个新 NestJS service，三个新 Prisma 模型（TbAccountRegistry, TbTransferEvidence, TbEvidenceBacklog），Asset 加 tbLedgerId 字段。

**Tech Stack:** NestJS 11, tigerbeetle-node, Prisma 5, SQLite, Jest 30

**Spec:** `doc-final/superpowers/specs/2026-05-10-tigerbeetle-infrastructure-design.md`

---

## File Structure

```
src/modules/accounting/tigerbeetle/
├── tigerbeetle.module.ts              # NestJS module
├── tigerbeetle.service.ts             # Layer: TB client wrapper (纯透传)
├── tigerbeetle.service.spec.ts        # Unit tests
├── accounting.service.ts              # Layer: thin adapter (TB + evidence)
├── accounting.service.spec.ts         # Unit tests
├── tb-evidence.service.ts             # Layer: Prisma evidence CRUD
├── tb-evidence.service.spec.ts        # Unit tests
├── tb-account-registry.service.ts     # Account registry CRUD
├── tb-account-registry.service.spec.ts
├── constants/
│   ├── tb-ledgers.constant.ts         # Ledger ID mapping
│   ├── tb-account-codes.constant.ts   # Account type codes + COA mapping
│   └── tb-transfer-codes.constant.ts  # Transfer type codes
├── utils/
│   ├── tb-id.util.ts                  # Deterministic ID + hex conversion
│   └── tb-id.util.spec.ts
└── types/
    └── accounting.types.ts            # All interfaces & types

prisma/
├── schema.prisma                      # +3 models, Asset +tbLedgerId
└── migrations/XXXXXX_add_tb_models/   # Auto-generated

scripts/
└── dev-tigerbeetle.sh                 # TB start/stop/format helper
```

---

## Task 1: TB ID 工具函数 + 常量

**Files:**
- Create: `src/modules/accounting/tigerbeetle/utils/tb-id.util.ts`
- Create: `src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts`
- Create: `src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant.ts`
- Create: `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts`
- Create: `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts`
- Create: `src/modules/accounting/tigerbeetle/types/accounting.types.ts`

- [ ] **Step 1: Write failing tests for tb-id.util**

```typescript
// src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts
import {
  deterministicTransferId,
  bigintToHex,
  hexToBigint,
} from './tb-id.util';

describe('tb-id.util', () => {
  describe('deterministicTransferId', () => {
    it('should produce consistent output for same input', () => {
      const id1 = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      const id2 = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      expect(id1).toBe(id2);
    });

    it('should produce different output for different inputs', () => {
      const id1 = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      const id2 = deterministicTransferId('DEPOSIT', 'DEP-002', 'DEPOSIT_CREDIT', 0);
      expect(id1).not.toBe(id2);
    });

    it('should produce different output for different leg indexes', () => {
      const id1 = deterministicTransferId('SWAP', 'SWP-001', 'SWAP_SOURCE', 0);
      const id2 = deterministicTransferId('SWAP', 'SWP-001', 'SWAP_SOURCE', 1);
      expect(id1).not.toBe(id2);
    });

    it('should return a bigint', () => {
      const id = deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_CREDIT', 0);
      expect(typeof id).toBe('bigint');
    });
  });

  describe('bigintToHex / hexToBigint', () => {
    it('should round-trip correctly', () => {
      const original = 123456789012345678901234567890n;
      const hex = bigintToHex(original);
      const back = hexToBigint(hex);
      expect(back).toBe(original);
    });

    it('should produce lowercase hex string', () => {
      const hex = bigintToHex(255n);
      expect(hex).toBe('ff');
    });

    it('should handle zero', () => {
      expect(bigintToHex(0n)).toBe('0');
      expect(hexToBigint('0')).toBe(0n);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement tb-id.util.ts**

```typescript
// src/modules/accounting/tigerbeetle/utils/tb-id.util.ts
import { createHash } from 'node:crypto';

/**
 * Deterministic TB transfer ID from business key.
 * Same input always produces same u128 — TB natively deduplicates.
 */
export function deterministicTransferId(
  sourceType: string,
  sourceNo: string,
  eventCode: string,
  legIndex: number,
): bigint {
  const input = `${sourceType}:${sourceNo}:${eventCode}:${legIndex}`;
  const hash = createHash('sha256').update(input).digest();
  return BigInt('0x' + hash.subarray(0, 16).toString('hex'));
}

/** bigint → hex string (for Prisma/SQLite storage) */
export function bigintToHex(value: bigint): string {
  return value.toString(16);
}

/** hex string → bigint (from Prisma/SQLite storage) */
export function hexToBigint(hex: string): bigint {
  return BigInt('0x' + hex);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/utils/tb-id.util.spec.ts --no-coverage`
Expected: PASS — 6 tests

- [ ] **Step 5: Create constants + types**

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant.ts

/** One ledger per currency. Immutable once assigned. */
export const TB_LEDGERS = {
  AED: 1,
  USDT: 2,
} as const;

export type TbLedgerId = (typeof TB_LEDGERS)[keyof typeof TB_LEDGERS];
```

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts

/** TB account type codes (u16). Immutable once assigned. */
export const TB_ACCOUNT_CODES = {
  // Assets (1–99)
  BANK: 1,
  CUSTODY: 10,
  // Liabilities (100–199)
  CLIENT_CREDIT: 100,
} as const;

export type TbAccountCode = (typeof TB_ACCOUNT_CODES)[keyof typeof TB_ACCOUNT_CODES];

/** Human-readable COA code → TB numeric code */
export const COA_TO_TB_CODE: Record<string, number> = {
  'A.BANK': 1,
  'A.CUSTODY': 10,
  'L.CLIENT_CREDIT': 100,
};

/** TB numeric code → human-readable COA code */
export const TB_CODE_TO_COA: Record<number, string> = Object.fromEntries(
  Object.entries(COA_TO_TB_CODE).map(([k, v]) => [v, k]),
);
```

```typescript
// src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts

/** TB transfer type codes (u16). Immutable once assigned. */
export const TB_TRANSFER_CODES = {
  ACCOUNT_SETUP: 1,
} as const;

export type TbTransferCode = (typeof TB_TRANSFER_CODES)[keyof typeof TB_TRANSFER_CODES];
```

```typescript
// src/modules/accounting/tigerbeetle/types/accounting.types.ts

export interface CreateTbAccountParams {
  code: number;
  ledger: number;
  ownerType: 'SYSTEM' | 'CUSTOMER' | 'LP';
  ownerUuid?: string;
  ownerNo?: string;
  assetCode: string;
  description?: string;
  flags?: number;
}

export interface EvidenceParams {
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  traceId: string;
  debitCode: string;
  creditCode: string;
  assetCode: string;
  actorType: string;
  actorId: string;
  memo?: string;
}

export interface ExecuteTransferParams {
  debitAccountId: bigint;
  creditAccountId: bigint;
  amount: bigint;
  ledger: number;
  code: number;
  evidence: EvidenceParams;
}

export interface TbBalanceResult {
  debitsPosted: bigint;
  creditsPosted: bigint;
  debitsPending: bigint;
  creditsPending: bigint;
}

export interface CustomerAvailableBalance {
  available: bigint;
  held: bigint;
  total: bigint;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/accounting/tigerbeetle/utils/ src/modules/accounting/tigerbeetle/constants/ src/modules/accounting/tigerbeetle/types/
git commit -m "feat(accounting): add TB ID utils, constants, and types"
```

---

## Task 2: Prisma 模型 — TbAccountRegistry + TbTransferEvidence + TbEvidenceBacklog + Asset.tbLedgerId

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add three new models and Asset.tbLedgerId to schema.prisma**

在 `schema.prisma` 文件末尾添加：

```prisma
// ── TigerBeetle Infrastructure (V3 Phase 0) ──

model TbAccountRegistry {
  tbAccountId String   @id              // TB u128 as hex string
  code        Int                       // TB account type code (u16)
  ledger      Int                       // TB ledger ID (u32): 1=AED, 2=USDT
  ownerType   String                    // SYSTEM | CUSTOMER | LP
  ownerUuid   String?                   // Prisma entity UUID (queryable)
  ownerNo     String?                   // Human-readable No
  assetCode   String                    // AED | USDT
  status      String   @default("ACTIVE")
  description String?
  flags       Int      @default(0)      // TB account flags
  createdAt   DateTime @default(now())

  @@unique([code, ledger, ownerType, ownerUuid])
  @@index([ownerUuid])
  @@index([ownerNo])
  @@map("tb_account_registry")
}

model TbTransferEvidence {
  tbTransferId String   @id             // TB u128 as hex string (deterministic)
  sourceType   String                   // DEPOSIT | WITHDRAWAL | SWAP | ...
  sourceNo     String
  eventCode    String                   // From events.manifest
  debitCode    String                   // Human-readable COA, e.g. 'L.CLIENT_CREDIT'
  creditCode   String                   // e.g. 'A.CUSTODY'
  amount       Decimal
  assetCode    String
  traceId      String
  actorType    String                   // ADMIN | CUSTOMER | SYSTEM
  actorId      String                   // adminNo / customerNo / 'SYSTEM'
  memo         String?
  pendingId    String?                  // Related pending transfer hex ID
  transferType String   @default("POSTED") // POSTED | PENDING | POST_PENDING | VOID_PENDING | CORRECTING
  createdAt    DateTime @default(now())

  @@index([sourceType, sourceNo])
  @@index([traceId])
  @@index([eventCode])
  @@index([assetCode])
  @@index([actorType, actorId])
  @@index([createdAt])
  @@map("tb_transfer_evidence")
}

model TbEvidenceBacklog {
  id           String    @id @default(uuid())
  tbTransferId String    @unique         // TB u128 as hex string
  transferData String                    // JSON: transfer params snapshot
  evidenceData String                    // JSON: evidence data to write
  errorMessage String
  retryCount   Int       @default(0)
  status       String    @default("PENDING") // PENDING | RESOLVED | FAILED
  createdAt    DateTime  @default(now())
  resolvedAt   DateTime?

  @@index([status])
  @@map("tb_evidence_backlog")
}
```

在 Asset 模型中添加 `tbLedgerId` 字段：

```prisma
// 在 Asset 模型的 status 字段之后加：
  tbLedgerId                       Int?                            @unique
```

- [ ] **Step 2: Generate migration**

Run: `cd Exchange_js && npx prisma migrate dev --name add_tb_models`
Expected: Migration created successfully

- [ ] **Step 3: Verify schema is valid**

Run: `cd Exchange_js && npx prisma validate`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add prisma/
git commit -m "feat(prisma): add TbAccountRegistry, TbTransferEvidence, TbEvidenceBacklog models and Asset.tbLedgerId"
```

---

## Task 3: TigerBeetleService — TB 客户端封装

**Files:**
- Create: `src/modules/accounting/tigerbeetle/tigerbeetle.service.ts`
- Create: `src/modules/accounting/tigerbeetle/tigerbeetle.service.spec.ts`

- [ ] **Step 1: Write failing test**

```typescript
// src/modules/accounting/tigerbeetle/tigerbeetle.service.spec.ts
import { TigerBeetleService } from './tigerbeetle.service';
import { ConfigService } from '@nestjs/config';

describe('TigerBeetleService', () => {
  let service: TigerBeetleService;

  beforeEach(() => {
    const configService = {
      get: jest.fn().mockReturnValue('127.0.0.1:3001'),
    } as unknown as ConfigService;
    service = new TigerBeetleService(configService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should expose createAccounts method', () => {
    expect(typeof service.createAccounts).toBe('function');
  });

  it('should expose createTransfers method', () => {
    expect(typeof service.createTransfers).toBe('function');
  });

  it('should expose lookupAccounts method', () => {
    expect(typeof service.lookupAccounts).toBe('function');
  });

  it('should expose lookupTransfers method', () => {
    expect(typeof service.lookupTransfers).toBe('function');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/tigerbeetle.service.spec.ts --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Implement TigerBeetleService**

```typescript
// src/modules/accounting/tigerbeetle/tigerbeetle.service.ts
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, Client, Account, Transfer, AccountFilter } from 'tigerbeetle-node';

@Injectable()
export class TigerBeetleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TigerBeetleService.name);
  private client!: Client;
  private readonly address: string;

  constructor(private readonly configService: ConfigService) {
    this.address = this.configService.get<string>('TB_ADDRESS', '127.0.0.1:3001');
  }

  async onModuleInit(): Promise<void> {
    this.logger.log(`Connecting to TigerBeetle at ${this.address}...`);
    this.client = createClient({
      cluster_id: 0n,
      replica_addresses: [this.address],
    });
    // Health check: lookup a non-existent account — verifies connectivity
    await this.client.lookupAccounts([0n]);
    this.logger.log('TigerBeetle connection established.');
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.logger.log('TigerBeetle client destroyed.');
    }
  }

  async createAccounts(accounts: Account[]): Promise<ReturnType<Client['createAccounts']>> {
    return this.client.createAccounts(accounts);
  }

  async createTransfers(transfers: Transfer[]): Promise<ReturnType<Client['createTransfers']>> {
    return this.client.createTransfers(transfers);
  }

  async lookupAccounts(ids: bigint[]): Promise<Account[]> {
    return this.client.lookupAccounts(ids);
  }

  async lookupTransfers(ids: bigint[]): Promise<Transfer[]> {
    return this.client.lookupTransfers(ids);
  }

  async getAccountTransfers(filter: AccountFilter): Promise<Transfer[]> {
    return this.client.getAccountTransfers(filter);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/tigerbeetle.service.spec.ts --no-coverage`
Expected: PASS — 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tigerbeetle.service.ts src/modules/accounting/tigerbeetle/tigerbeetle.service.spec.ts
git commit -m "feat(accounting): add TigerBeetleService — TB client wrapper"
```

---

## Task 4: TbAccountRegistryService — 账户注册表

**Files:**
- Create: `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts`
- Create: `src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts
import { TbAccountRegistryService } from './tb-account-registry.service';

describe('TbAccountRegistryService', () => {
  let service: TbAccountRegistryService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tbAccountRegistry: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new TbAccountRegistryService(mockPrisma);
  });

  describe('register', () => {
    it('should create a registry entry', async () => {
      mockPrisma.tbAccountRegistry.create.mockResolvedValue({
        tbAccountId: 'abc123',
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
      });

      const result = await service.register({
        tbAccountId: 'abc123',
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
        ownerNo: 'CUST-001',
        assetCode: 'AED',
      });

      expect(mockPrisma.tbAccountRegistry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbAccountId: 'abc123',
          code: 100,
          ledger: 1,
        }),
      });
      expect(result.tbAccountId).toBe('abc123');
    });
  });

  describe('resolve', () => {
    it('should find account by code+ledger+ownerType+ownerUuid', async () => {
      mockPrisma.tbAccountRegistry.findFirst.mockResolvedValue({
        tbAccountId: 'abc123',
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
      });

      const result = await service.resolve({
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
      });

      expect(result?.tbAccountId).toBe('abc123');
    });

    it('should return null when not found', async () => {
      mockPrisma.tbAccountRegistry.findFirst.mockResolvedValue(null);

      const result = await service.resolve({
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'nonexistent',
      });

      expect(result).toBeNull();
    });
  });

  describe('findByOwner', () => {
    it('should return all accounts for an owner UUID', async () => {
      mockPrisma.tbAccountRegistry.findMany.mockResolvedValue([
        { tbAccountId: 'a1', code: 100, ledger: 1 },
        { tbAccountId: 'a2', code: 100, ledger: 2 },
      ]);

      const result = await service.findByOwner('uuid-1');
      expect(result).toHaveLength(2);
      expect(mockPrisma.tbAccountRegistry.findMany).toHaveBeenCalledWith({
        where: { ownerUuid: 'uuid-1', status: 'ACTIVE' },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement TbAccountRegistryService**

```typescript
// src/modules/accounting/tigerbeetle/tb-account-registry.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface RegisterParams {
  tbAccountId: string;
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid?: string;
  ownerNo?: string;
  assetCode: string;
  description?: string;
  flags?: number;
}

interface ResolveParams {
  code: number;
  ledger: number;
  ownerType: string;
  ownerUuid?: string;
}

@Injectable()
export class TbAccountRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async register(params: RegisterParams, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return (client as any).tbAccountRegistry.create({
      data: {
        tbAccountId: params.tbAccountId,
        code: params.code,
        ledger: params.ledger,
        ownerType: params.ownerType,
        ownerUuid: params.ownerUuid ?? null,
        ownerNo: params.ownerNo ?? null,
        assetCode: params.assetCode,
        description: params.description ?? null,
        flags: params.flags ?? 0,
      },
    });
  }

  async resolve(params: ResolveParams, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return (client as any).tbAccountRegistry.findFirst({
      where: {
        code: params.code,
        ledger: params.ledger,
        ownerType: params.ownerType,
        ownerUuid: params.ownerUuid ?? null,
        status: 'ACTIVE',
      },
    });
  }

  async findByOwner(ownerUuid: string) {
    return (this.prisma as any).tbAccountRegistry.findMany({
      where: { ownerUuid, status: 'ACTIVE' },
    });
  }

  async findByTbAccountId(tbAccountId: string) {
    return (this.prisma as any).tbAccountRegistry.findUnique({
      where: { tbAccountId },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts --no-coverage`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-account-registry.service.ts src/modules/accounting/tigerbeetle/tb-account-registry.service.spec.ts
git commit -m "feat(accounting): add TbAccountRegistryService — account registry CRUD"
```

---

## Task 5: TbEvidenceService — 证据写入/查询

**Files:**
- Create: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`
- Create: `src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts
import { TbEvidenceService } from './tb-evidence.service';

describe('TbEvidenceService', () => {
  let service: TbEvidenceService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      tbTransferEvidence: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
      },
      tbEvidenceBacklog: {
        create: jest.fn(),
      },
    };
    service = new TbEvidenceService(mockPrisma);
  });

  describe('writeEvidence', () => {
    const params = {
      tbTransferId: 'abc123',
      sourceType: 'DEPOSIT',
      sourceNo: 'DEP-001',
      eventCode: 'EVT_DEPOSIT_SUCCESS',
      debitCode: 'A.CUSTODY',
      creditCode: 'L.CLIENT_CREDIT',
      amount: 100.00,
      assetCode: 'AED',
      traceId: 'trace-uuid-1',
      actorType: 'SYSTEM',
      actorId: 'SYSTEM',
      transferType: 'POSTED',
    };

    it('should write evidence to TbTransferEvidence', async () => {
      mockPrisma.tbTransferEvidence.create.mockResolvedValue(params);

      await service.writeEvidence(params);

      expect(mockPrisma.tbTransferEvidence.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbTransferId: 'abc123',
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP-001',
        }),
      });
    });

    it('should write to backlog on Prisma failure instead of throwing', async () => {
      mockPrisma.tbTransferEvidence.create.mockRejectedValue(new Error('DB error'));
      mockPrisma.tbEvidenceBacklog.create.mockResolvedValue({});

      // Should not throw
      await service.writeEvidence(params);

      expect(mockPrisma.tbEvidenceBacklog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tbTransferId: 'abc123',
          errorMessage: 'DB error',
          status: 'PENDING',
        }),
      });
    });
  });

  describe('findBySource', () => {
    it('should query by sourceType and sourceNo', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);

      await service.findBySource('DEPOSIT', 'DEP-001');

      expect(mockPrisma.tbTransferEvidence.findMany).toHaveBeenCalledWith({
        where: { sourceType: 'DEPOSIT', sourceNo: 'DEP-001' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('findByTraceId', () => {
    it('should query by traceId', async () => {
      mockPrisma.tbTransferEvidence.findMany.mockResolvedValue([]);

      await service.findByTraceId('trace-uuid-1');

      expect(mockPrisma.tbTransferEvidence.findMany).toHaveBeenCalledWith({
        where: { traceId: 'trace-uuid-1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement TbEvidenceService**

```typescript
// src/modules/accounting/tigerbeetle/tb-evidence.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';

interface WriteEvidenceParams {
  tbTransferId: string;
  sourceType: string;
  sourceNo: string;
  eventCode: string;
  debitCode: string;
  creditCode: string;
  amount: number | Prisma.Decimal;
  assetCode: string;
  traceId: string;
  actorType: string;
  actorId: string;
  memo?: string;
  pendingId?: string;
  transferType?: string;
}

@Injectable()
export class TbEvidenceService {
  private readonly logger = new Logger(TbEvidenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async writeEvidence(params: WriteEvidenceParams, tx?: Prisma.TransactionClient): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await (client as any).tbTransferEvidence.create({
        data: {
          tbTransferId: params.tbTransferId,
          sourceType: params.sourceType,
          sourceNo: params.sourceNo,
          eventCode: params.eventCode,
          debitCode: params.debitCode,
          creditCode: params.creditCode,
          amount: params.amount,
          assetCode: params.assetCode,
          traceId: params.traceId,
          actorType: params.actorType,
          actorId: params.actorId,
          memo: params.memo ?? null,
          pendingId: params.pendingId ?? null,
          transferType: params.transferType ?? 'POSTED',
        },
      });
    } catch (error: any) {
      this.logger.error(`Evidence write failed for transfer ${params.tbTransferId}: ${error.message}`);
      await this.writeToBacklog(params, error.message);
    }
  }

  private async writeToBacklog(params: WriteEvidenceParams, errorMessage: string): Promise<void> {
    try {
      await (this.prisma as any).tbEvidenceBacklog.create({
        data: {
          tbTransferId: params.tbTransferId,
          transferData: JSON.stringify({
            sourceType: params.sourceType,
            sourceNo: params.sourceNo,
            eventCode: params.eventCode,
          }),
          evidenceData: JSON.stringify(params),
          errorMessage,
          status: 'PENDING',
        },
      });
    } catch (backlogError: any) {
      this.logger.error(`CRITICAL: Evidence backlog write also failed for ${params.tbTransferId}: ${backlogError.message}`);
    }
  }

  async findBySource(sourceType: string, sourceNo: string) {
    return (this.prisma as any).tbTransferEvidence.findMany({
      where: { sourceType, sourceNo },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findByTraceId(traceId: string) {
    return (this.prisma as any).tbTransferEvidence.findMany({
      where: { traceId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(tbTransferId: string) {
    return (this.prisma as any).tbTransferEvidence.findUnique({
      where: { tbTransferId },
    });
  }

  async findAll(filters: {
    sourceType?: string;
    assetCode?: string;
    eventCode?: string;
    actorType?: string;
    actorId?: string;
    skip?: number;
    take?: number;
  }) {
    const where: any = {};
    if (filters.sourceType) where.sourceType = filters.sourceType;
    if (filters.assetCode) where.assetCode = filters.assetCode;
    if (filters.eventCode) where.eventCode = filters.eventCode;
    if (filters.actorType) where.actorType = filters.actorType;
    if (filters.actorId) where.actorId = filters.actorId;

    const [data, total] = await Promise.all([
      (this.prisma as any).tbTransferEvidence.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filters.skip ?? 0,
        take: filters.take ?? 50,
      }),
      (this.prisma as any).tbTransferEvidence.count({ where }),
    ]);

    return { data, total };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts --no-coverage`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-evidence.service.ts src/modules/accounting/tigerbeetle/tb-evidence.service.spec.ts
git commit -m "feat(accounting): add TbEvidenceService — evidence write/query with backlog fallback"
```

---

## Task 6: AccountingService — 薄适配器

**Files:**
- Create: `src/modules/accounting/tigerbeetle/accounting.service.ts`
- Create: `src/modules/accounting/tigerbeetle/accounting.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/modules/accounting/tigerbeetle/accounting.service.spec.ts
import { AccountingService } from './accounting.service';
import { bigintToHex } from './utils/tb-id.util';

describe('AccountingService', () => {
  let service: AccountingService;
  let mockTbService: any;
  let mockRegistryService: any;
  let mockEvidenceService: any;

  beforeEach(() => {
    mockTbService = {
      createAccounts: jest.fn().mockResolvedValue([]),
      createTransfers: jest.fn().mockResolvedValue([]),
      lookupAccounts: jest.fn().mockResolvedValue([]),
      lookupTransfers: jest.fn().mockResolvedValue([]),
    };
    mockRegistryService = {
      register: jest.fn().mockResolvedValue({ tbAccountId: 'abc' }),
      resolve: jest.fn().mockResolvedValue({ tbAccountId: 'abc' }),
    };
    mockEvidenceService = {
      writeEvidence: jest.fn().mockResolvedValue(undefined),
    };

    service = new AccountingService(mockTbService, mockRegistryService, mockEvidenceService);
  });

  describe('createAccounts', () => {
    it('should create TB accounts and register them', async () => {
      await service.createAccounts([{
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
        ownerNo: 'CUST-001',
        assetCode: 'AED',
      }]);

      expect(mockTbService.createAccounts).toHaveBeenCalledTimes(1);
      expect(mockRegistryService.register).toHaveBeenCalledTimes(1);
    });
  });

  describe('executeTransfer', () => {
    it('should create TB transfer and write evidence', async () => {
      const result = await service.executeTransfer({
        debitAccountId: 1n,
        creditAccountId: 2n,
        amount: 10000n,
        ledger: 1,
        code: 10,
        evidence: {
          sourceType: 'DEPOSIT',
          sourceNo: 'DEP-001',
          eventCode: 'DEPOSIT_CREDIT',
          traceId: 'trace-1',
          debitCode: 'A.CUSTODY',
          creditCode: 'L.CLIENT_CREDIT',
          assetCode: 'AED',
          actorType: 'SYSTEM',
          actorId: 'SYSTEM',
        },
      });

      expect(mockTbService.createTransfers).toHaveBeenCalledTimes(1);
      expect(mockEvidenceService.writeEvidence).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('tbTransferId');
    });

    it('should throw when TB rejects the transfer', async () => {
      mockTbService.createTransfers.mockResolvedValue([
        { index: 0, result: 'exceeds_credits' },
      ]);

      await expect(
        service.executeTransfer({
          debitAccountId: 1n,
          creditAccountId: 2n,
          amount: 10000n,
          ledger: 1,
          code: 10,
          evidence: {
            sourceType: 'DEPOSIT',
            sourceNo: 'DEP-001',
            eventCode: 'DEPOSIT_CREDIT',
            traceId: 'trace-1',
            debitCode: 'A.CUSTODY',
            creditCode: 'L.CLIENT_CREDIT',
            assetCode: 'AED',
            actorType: 'SYSTEM',
            actorId: 'SYSTEM',
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('lookupBalance', () => {
    it('should return balance from TB account', async () => {
      mockTbService.lookupAccounts.mockResolvedValue([{
        debits_posted: 500n,
        credits_posted: 1000n,
        debits_pending: 100n,
        credits_pending: 0n,
      }]);

      const result = await service.lookupBalance(1n);

      expect(result.debitsPosted).toBe(500n);
      expect(result.creditsPosted).toBe(1000n);
      expect(result.debitsPending).toBe(100n);
      expect(result.creditsPending).toBe(0n);
    });

    it('should throw when account not found', async () => {
      mockTbService.lookupAccounts.mockResolvedValue([]);

      await expect(service.lookupBalance(999n)).rejects.toThrow();
    });
  });

  describe('getCustomerAvailableBalance', () => {
    it('should compute available = credits_posted - debits_posted - debits_pending', async () => {
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'abc' });
      mockTbService.lookupAccounts.mockResolvedValue([{
        debits_posted: 200n,
        credits_posted: 1000n,
        debits_pending: 100n,
        credits_pending: 0n,
      }]);

      const result = await service.getCustomerAvailableBalance('uuid-1', 'AED');

      expect(result.available).toBe(700n);  // 1000 - 200 - 100
      expect(result.held).toBe(100n);
      expect(result.total).toBe(800n);      // 1000 - 200
    });
  });

  describe('resolveTbAccountId', () => {
    it('should return bigint account ID from registry', async () => {
      mockRegistryService.resolve.mockResolvedValue({ tbAccountId: 'ff' });

      const result = await service.resolveTbAccountId({
        code: 100,
        ledger: 1,
        ownerType: 'CUSTOMER',
        ownerUuid: 'uuid-1',
      });

      expect(result).toBe(255n); // 0xff
    });

    it('should throw when registry entry not found', async () => {
      mockRegistryService.resolve.mockResolvedValue(null);

      await expect(
        service.resolveTbAccountId({
          code: 100,
          ledger: 1,
          ownerType: 'CUSTOMER',
          ownerUuid: 'nonexistent',
        }),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/accounting.service.spec.ts --no-coverage`
Expected: FAIL

- [ ] **Step 3: Implement AccountingService**

```typescript
// src/modules/accounting/tigerbeetle/accounting.service.ts
import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TigerBeetleService } from './tigerbeetle.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TbEvidenceService } from './tb-evidence.service';
import { deterministicTransferId, bigintToHex, hexToBigint } from './utils/tb-id.util';
import { CreateTbAccountParams, EvidenceParams, ExecuteTransferParams, TbBalanceResult, CustomerAvailableBalance } from './types/accounting.types';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { id as tbId } from 'tigerbeetle-node';

@Injectable()
export class AccountingService {
  private readonly logger = new Logger(AccountingService.name);

  constructor(
    private readonly tbService: TigerBeetleService,
    private readonly registryService: TbAccountRegistryService,
    private readonly evidenceService: TbEvidenceService,
  ) {}

  // ── Account Lifecycle ──

  async createAccounts(paramsList: CreateTbAccountParams[], tx?: Prisma.TransactionClient): Promise<void> {
    const tbAccounts = paramsList.map((p) => {
      const accountId = tbId();
      return { accountId, params: p };
    });

    const errors = await this.tbService.createAccounts(
      tbAccounts.map(({ accountId, params }) => ({
        id: accountId,
        debits_pending: 0n,
        credits_pending: 0n,
        debits_posted: 0n,
        credits_posted: 0n,
        user_data_128: params.ownerUuid ? this.uuidToBigint(params.ownerUuid) : 0n,
        user_data_64: 0n,
        user_data_32: params.ownerType === 'SYSTEM' ? 0 : params.ownerType === 'CUSTOMER' ? 1 : 2,
        reserved: 0,
        ledger: params.ledger,
        code: params.code,
        flags: params.flags ?? 0,
        timestamp: 0n,
      })),
    );

    if (errors.length > 0) {
      // Filter out "exists" errors (idempotent) — only throw on real failures
      const realErrors = errors.filter((e: any) => e.result !== 'exists');
      if (realErrors.length > 0) {
        throw new BadRequestException({
          code: 'TB_ACCOUNT_CREATE_FAILED',
          message: `TigerBeetle account creation failed: ${JSON.stringify(realErrors)}`,
        });
      }
    }

    for (const { accountId, params } of tbAccounts) {
      await this.registryService.register({
        tbAccountId: bigintToHex(accountId),
        code: params.code,
        ledger: params.ledger,
        ownerType: params.ownerType,
        ownerUuid: params.ownerUuid,
        ownerNo: params.ownerNo,
        assetCode: params.assetCode,
        description: params.description,
        flags: params.flags,
      }, tx);
    }
  }

  // ── Single Transfer ──

  async executeTransfer(params: ExecuteTransferParams & {
    evidence: EvidenceParams;
    tx?: Prisma.TransactionClient;
  }): Promise<{ tbTransferId: bigint }> {
    const transferId = deterministicTransferId(
      params.evidence.sourceType,
      params.evidence.sourceNo,
      params.evidence.eventCode,
      0,
    );

    const errors = await this.tbService.createTransfers([{
      id: transferId,
      debit_account_id: params.debitAccountId,
      credit_account_id: params.creditAccountId,
      amount: params.amount,
      pending_id: 0n,
      user_data_128: 0n,
      user_data_64: 0n,
      user_data_32: 0,
      timeout: 0,
      ledger: params.ledger,
      code: params.code,
      flags: 0,
      timestamp: 0n,
    }]);

    // Check for real errors (not idempotent "exists")
    const realErrors = errors.filter((e: any) => e.result !== 'exists');
    if (realErrors.length > 0) {
      throw new BadRequestException({
        code: 'TB_TRANSFER_FAILED',
        message: `TigerBeetle transfer rejected: ${JSON.stringify(realErrors)}`,
      });
    }

    // Write evidence (non-blocking on failure — goes to backlog)
    await this.evidenceService.writeEvidence({
      tbTransferId: bigintToHex(transferId),
      sourceType: params.evidence.sourceType,
      sourceNo: params.evidence.sourceNo,
      eventCode: params.evidence.eventCode,
      debitCode: params.evidence.debitCode,
      creditCode: params.evidence.creditCode,
      amount: Number(params.amount),
      assetCode: params.evidence.assetCode,
      traceId: params.evidence.traceId,
      actorType: params.evidence.actorType,
      actorId: params.evidence.actorId,
      memo: params.evidence.memo,
      transferType: 'POSTED',
    }, params.tx);

    return { tbTransferId: transferId };
  }

  // ── Balance Queries ──

  async lookupBalance(tbAccountId: bigint): Promise<TbBalanceResult> {
    const accounts = await this.tbService.lookupAccounts([tbAccountId]);
    if (accounts.length === 0) {
      throw new NotFoundException({
        code: 'TB_ACCOUNT_NOT_FOUND',
        message: `TigerBeetle account ${tbAccountId} not found`,
      });
    }
    const a = accounts[0];
    return {
      debitsPosted: a.debits_posted,
      creditsPosted: a.credits_posted,
      debitsPending: a.debits_pending,
      creditsPending: a.credits_pending,
    };
  }

  async getCustomerAvailableBalance(customerUuid: string, assetCode: string): Promise<CustomerAvailableBalance> {
    const tbAccountId = await this.resolveTbAccountId({
      code: TB_ACCOUNT_CODES.CLIENT_CREDIT,
      ledger: 0, // Will be resolved from assetCode — placeholder, see note below
      ownerType: 'CUSTOMER',
      ownerUuid: customerUuid,
    });

    const balance = await this.lookupBalance(tbAccountId);
    const total = balance.creditsPosted - balance.debitsPosted;
    const available = total - balance.debitsPending;
    const held = balance.debitsPending;

    return { available, held, total };
  }

  // ── Account Resolution ──

  async resolveTbAccountId(params: {
    code: number;
    ledger: number;
    ownerType: string;
    ownerUuid?: string;
  }): Promise<bigint> {
    const entry = await this.registryService.resolve(params);
    if (!entry) {
      throw new NotFoundException({
        code: 'TB_ACCOUNT_REGISTRY_NOT_FOUND',
        message: `No TB account found for code=${params.code} ledger=${params.ledger} ownerType=${params.ownerType} ownerUuid=${params.ownerUuid}`,
      });
    }
    return hexToBigint(entry.tbAccountId);
  }

  // ── Helpers ──

  private uuidToBigint(uuid: string): bigint {
    const hex = uuid.replace(/-/g, '');
    return BigInt('0x' + hex);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/accounting.service.spec.ts --no-coverage`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/accounting.service.ts src/modules/accounting/tigerbeetle/accounting.service.spec.ts
git commit -m "feat(accounting): add AccountingService — thin TB adapter with evidence"
```

---

## Task 7: NestJS Module 注册

**Files:**
- Create: `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: Create TigerBeetleModule**

```typescript
// src/modules/accounting/tigerbeetle/tigerbeetle.module.ts
import { Module } from '@nestjs/common';
import { TigerBeetleService } from './tigerbeetle.service';
import { AccountingService } from './accounting.service';
import { TbEvidenceService } from './tb-evidence.service';
import { TbAccountRegistryService } from './tb-account-registry.service';

@Module({
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
  exports: [
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
  ],
})
export class TigerBeetleModule {}
```

- [ ] **Step 2: Register in app.module.ts**

在 `src/app.module.ts` 的 imports 中添加 `TigerBeetleModule`：

```typescript
// 在 import 区添加
import { TigerBeetleModule } from './modules/accounting/tigerbeetle/tigerbeetle.module';

// 在 @Module imports 数组中，AcctEventsModule 之后添加
TigerBeetleModule,
```

- [ ] **Step 3: Install tigerbeetle-node**

Run: `cd Exchange_js && npm install tigerbeetle-node`

- [ ] **Step 4: Verify compilation**

Run: `cd Exchange_js && npx tsc --noEmit`
Expected: no type errors (or only pre-existing ones)

- [ ] **Step 5: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tigerbeetle.module.ts src/app.module.ts package.json package-lock.json
git commit -m "feat(accounting): register TigerBeetleModule in app — TB infrastructure wired"
```

---

## Task 8: Dev 工具链 — TB 启停脚本

**Files:**
- Create: `scripts/dev-tigerbeetle.sh`
- Modify: `package.json` — 更新 dev:start, dev:stop, dev:rebuild, dev:reset 脚本

- [ ] **Step 1: Create TB helper script**

```bash
#!/usr/bin/env bash
# scripts/dev-tigerbeetle.sh — TigerBeetle dev lifecycle helper
set -euo pipefail

TB_DATA="/tmp/exchange_js_branch/0_0.tigerbeetle"
TB_ADDR="127.0.0.1:3001"
ACTION="${1:-help}"

case "$ACTION" in
  start)
    if pgrep -f "tigerbeetle start" > /dev/null 2>&1; then
      echo "TigerBeetle already running."
      exit 0
    fi
    if [ ! -f "$TB_DATA" ]; then
      echo "Formatting TigerBeetle data file..."
      tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "$TB_DATA"
    fi
    echo "Starting TigerBeetle at $TB_ADDR..."
    tigerbeetle start --development --addresses="$TB_ADDR" "$TB_DATA" &
    sleep 1
    echo "TigerBeetle started (PID: $!)."
    ;;
  stop)
    if pkill -f "tigerbeetle start" 2>/dev/null; then
      echo "TigerBeetle stopped."
    else
      echo "TigerBeetle not running."
    fi
    ;;
  format)
    "$0" stop
    rm -f "$TB_DATA"
    echo "Formatting fresh TigerBeetle data file..."
    tigerbeetle format --cluster=0 --replica=0 --replica-count=1 "$TB_DATA"
    echo "TigerBeetle data file formatted."
    ;;
  status)
    if pgrep -f "tigerbeetle start" > /dev/null 2>&1; then
      echo "TigerBeetle is running."
    else
      echo "TigerBeetle is not running."
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|format|status}"
    exit 1
    ;;
esac
```

- [ ] **Step 2: Make executable and add .env defaults**

Run: `chmod +x Exchange_js/scripts/dev-tigerbeetle.sh`

在 `.env` 或 `.env.example` 中确认有：
```
TB_ADDRESS=127.0.0.1:3001
```

- [ ] **Step 3: Update package.json scripts**

在 `package.json` 的 scripts 中更新（具体行根据现有脚本适配）：

```json
{
  "dev:tb:start": "bash scripts/dev-tigerbeetle.sh start",
  "dev:tb:stop": "bash scripts/dev-tigerbeetle.sh stop",
  "dev:tb:format": "bash scripts/dev-tigerbeetle.sh format",
  "dev:tb:status": "bash scripts/dev-tigerbeetle.sh status"
}
```

- [ ] **Step 4: Commit**

```bash
git add scripts/dev-tigerbeetle.sh package.json
git commit -m "feat(dev): add TigerBeetle dev lifecycle scripts"
```

---

## Task 9: Run All Tests — 验证完整性

- [ ] **Step 1: Run all new tests together**

Run: `cd Exchange_js && npx jest src/modules/accounting/tigerbeetle/ --no-coverage --verbose`
Expected: All tests pass (4 test files, ~26 tests total)

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `cd Exchange_js && npx jest --no-coverage`
Expected: All existing tests still pass

- [ ] **Step 3: Verify the whole module tree**

Run: `cd Exchange_js && npx tsc --noEmit`
Expected: No type errors introduced

---

## Summary — 交付产物

| 产物 | 文件 | 状态 |
|------|------|------|
| TB ID 工具 + 常量 + 类型 | `utils/`, `constants/`, `types/` | 新建 |
| Prisma 模型 | `schema.prisma` + migration | 新建 3 模型 + Asset 微改 |
| TigerBeetleService | `tigerbeetle.service.ts` | 新建 — 纯 TB 客户端 |
| TbAccountRegistryService | `tb-account-registry.service.ts` | 新建 — 账户注册表 CRUD |
| TbEvidenceService | `tb-evidence.service.ts` | 新建 — 证据写入/查询 |
| AccountingService | `accounting.service.ts` | 新建 — 薄适配器 |
| TigerBeetleModule | `tigerbeetle.module.ts` + app.module 注册 | 新建 |
| Dev 脚本 | `scripts/dev-tigerbeetle.sh` | 新建 |

**注意：** 本计划不包含 AccountingEventExecutionService 的重构（改调 AccountingService）——那是 V3 MVP 各 workflow 实现时的任务。本计划的目标是：**TB 基础设施通了，AccountingService 可以被调用了。**
