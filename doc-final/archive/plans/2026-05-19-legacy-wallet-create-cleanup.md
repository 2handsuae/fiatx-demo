# Legacy Wallet Creation Code Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy `POST /wallets` route and all code exclusively supporting it — security risk (bypasses approval workflow).

**Architecture:** Pure deletion across 5 files. Remove dead code, clean orphaned imports, verify nothing breaks. Order: DTO first (breaks compile for dependents) → service (removes methods) → controller (removes route) → tests (removes dead tests). Single commit at end since all changes are interdependent.

**Tech Stack:** NestJS + TypeScript (backend only)

---

### Task 1: Remove CreateWalletDto and clean DTO imports

**Files:**
- Modify: `src/modules/asset-treasury/wallets/dto/wallet.dto.ts`

- [ ] **Step 1: Replace the imports to keep only what UpdateWalletStatusDto needs**

```ts
// BEFORE (lines 1-8):
import {
  IsString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsUUID,
  Min,
} from 'class-validator';

// AFTER:
import { IsEnum } from 'class-validator';
```

- [ ] **Step 2: Delete the entire CreateWalletDto class (lines 47-123)**

Delete from `export class CreateWalletDto {` through its closing `}`. Keep all enums above it and `UpdateWalletStatusDto` below it.

The file should end up as: imports → 5 enums → `UpdateWalletStatusDto`.

### Task 2: Remove legacy create() and helper methods from WalletsService

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`

- [ ] **Step 1: Clean up imports**

```ts
// BEFORE (lines 1-8):
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';

// AFTER:
import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
```

```ts
// BEFORE (lines 11-18):
import {
  CreateWalletDto,
  WalletStatus,
  OwnerType,
  WalletDirection,
  WalletType,
  WalletRole,
} from './dto/wallet.dto';

// AFTER:
import { WalletStatus } from './dto/wallet.dto';
```

```ts
// DELETE (line 19):
import * as crypto from 'crypto';
```

- [ ] **Step 2: Delete `MAX_WALLET_NO_RETRIES` static field (line 32)**

```ts
// DELETE:
  private static readonly MAX_WALLET_NO_RETRIES = 5;
```

- [ ] **Step 3: Delete all 5 private/public methods that only serve create()**

Delete these methods in order (lines 45-266):

1. `private isUniqueConstraintError()` (lines 45-52)
2. `private isWalletNoUniqueConstraintError()` (lines 54-64)
3. `private resolveCreateWalletRole()` (lines 66-82)
4. `private assertManualCreateAllowed()` (lines 84-113)
5. `async create()` (lines 115-266)

After deletion, the class body should go directly from the constructor closing `}` to `async changeStatus()`.

### Task 3: Remove POST route from WalletsController

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.controller.ts`

- [ ] **Step 1: Clean up NestJS imports — remove `Post`**

```ts
// BEFORE (lines 1-12):
import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  Request,
} from '@nestjs/common';

// AFTER:
import {
  Controller,
  Get,
  Body,
  Patch,
  Param,
  Query,
  UseGuards,
  ForbiddenException,
  Request,
} from '@nestjs/common';
```

- [ ] **Step 2: Clean up wallet.dto imports**

```ts
// BEFORE (lines 15-23):
import {
  CreateWalletDto,
  UpdateWalletStatusDto,
  WalletStatus,
  OwnerType,
  WalletType,
  WalletDirection,
  WalletRole,
} from './dto/wallet.dto';

// AFTER:
import {
  UpdateWalletStatusDto,
  WalletStatus,
  OwnerType,
} from './dto/wallet.dto';
```

- [ ] **Step 3: Delete the `@Post() create()` method (lines 56-101)**

Delete from `@Post()` through the closing `}` of the `create` method. The class body should go from `ensureAdmin()` directly to `@Get() findAll()`.

- [ ] **Step 4: Remove unused Swagger imports**

After removing the POST route, check if `ApiOperation` is still used. It IS used on `findAll`, `findOne`, `findBalance`, `changeStatus`. Keep it.

### Task 4: Clean up controller tests

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.controller.spec.ts`

- [ ] **Step 1: Clean up imports**

```ts
// BEFORE (lines 6-13):
import {
  CreateWalletDto,
  OwnerType,
  WalletDirection,
  WalletRole,
  WalletStatus,
  WalletType,
} from './dto/wallet.dto';

// AFTER:
import {
  OwnerType,
  WalletStatus,
} from './dto/wallet.dto';
```

- [ ] **Step 2: Remove `create` from serviceMock**

```ts
// BEFORE (lines 17-20):
  const serviceMock = {
    create: jest.fn(),
    changeStatus: jest.fn(),
  };

// AFTER:
  const serviceMock = {
    changeStatus: jest.fn(),
  };
```

- [ ] **Step 3: Delete `createDto` fixture (lines 30-36)**

```ts
// DELETE:
  const createDto: CreateWalletDto = {
    ownerType: OwnerType.CUSTOMER,
    ownerId: 'cust-1',
    type: WalletType.CRYPTO_ADDRESS,
    direction: WalletDirection.INBOUND,
    assetId: 'asset-1',
  };
```

- [ ] **Step 4: Delete 6 create-related tests**

Delete these test blocks:
1. `it('should reject CUSTOMER creating PLATFORM wallet', ...)` (lines 51-58)
2. `it('should reject CUSTOMER creating wallet for another ownerId', ...)` (lines 61-67)
3. `it('should reject CUSTOMER creating BIDIRECTIONAL wallet', ...)` (lines 70-77)
4. `it('should normalize CUSTOMER inbound create to undefined role', ...)` (lines 79-89)
5. `it('should normalize CUSTOMER outbound create to C_OUT role', ...)` (lines 91-104)
6. `it('should allow ADMIN creating PLATFORM and LIQUIDITY_PROVIDER wallets', ...)` (lines 168-183)

Keep these 5 tests:
- "should force CUSTOMER list query to self owner"
- "should reject CUSTOMER querying other ownerId"
- "should reject CUSTOMER querying non-CUSTOMER ownerType"
- "should reject CUSTOMER changing wallet status"
- "should reject CUSTOMER reading wallet not owned by self"

### Task 5: Clean up service tests

**Files:**
- Modify: `src/modules/asset-treasury/wallets/wallets.service.spec.ts`

- [ ] **Step 1: Clean up imports**

```ts
// BEFORE (lines 1, 6-13):
import { BadRequestException, NotFoundException } from '@nestjs/common';
...
import {
  CreateWalletDto,
  OwnerType,
  WalletDirection,
  WalletRole,
  WalletStatus,
  WalletType,
} from './dto/wallet.dto';

// AFTER:
import { NotFoundException } from '@nestjs/common';
...
import {
  OwnerType,
  WalletRole,
  WalletStatus,
} from './dto/wallet.dto';
```

- [ ] **Step 2: Clean up prismaMock — remove create-only mocks**

```ts
// BEFORE (lines 19-29):
  const prismaMock = {
    asset: { findUnique: jest.fn() },
    customerMain: { findUnique: jest.fn() },
    liquidityProvider: { findUnique: jest.fn() },
    wallet: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

// AFTER:
  const prismaMock = {
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
```

- [ ] **Step 3: Delete create-only fixtures (lines 35-44)**

```ts
// DELETE:
  const cryptoAsset = { id: 'asset-1', type: 'CRYPTO', code: 'USDT' };
  const fiatAsset = { id: 'asset-fiat', type: 'FIAT', code: 'AED' };

  const customerInboundDto: CreateWalletDto = {
    ownerType: OwnerType.CUSTOMER,
    ownerId: 'cust-1',
    type: WalletType.CRYPTO_ADDRESS,
    direction: WalletDirection.INBOUND,
    assetId: 'asset-1',
  };
```

- [ ] **Step 4: Simplify beforeEach — remove create-only mock setup**

```ts
// BEFORE (lines 58-79):
    jest.clearAllMocks();
    (prisma as any).asset.findUnique.mockResolvedValue(cryptoAsset);
    (prisma as any).customerMain.findUnique.mockResolvedValue({ id: 'cust-1' });
    (prisma as any).liquidityProvider.findUnique.mockResolvedValue({
      id: 'lp-1',
    });
    (prisma as any).wallet.findFirst.mockResolvedValue(null);
    (prisma as any).wallet.create.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2605120001',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-1',
      ownerNo: null,
    });
    (prisma as any).wallet.findUnique.mockResolvedValue(null);
    (prisma as any).wallet.update.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2605120001',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-1',
      ownerNo: null,
    });

// AFTER:
    jest.clearAllMocks();
    (prisma as any).wallet.findUnique.mockResolvedValue(null);
    (prisma as any).wallet.update.mockResolvedValue({
      id: 'wallet-1',
      walletNo: 'WA2605120001',
      ownerType: OwnerType.CUSTOMER,
      ownerId: 'cust-1',
      ownerNo: null,
    });
```

- [ ] **Step 5: Delete entire `describe('create()')` block (lines 82-252)**

Delete from `// ── create() ──` comment through the closing `});` of the `describe('create()')` block. Keep `// ── changeStatus() ──` and everything after it.

### Task 6: Verify and commit

- [ ] **Step 1: TypeScript compile check**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No errors.

- [ ] **Step 2: Run remaining tests**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx jest --passWithNoTests --testPathPattern='wallets\.(service|controller)\.spec' 2>&1 | tail -20`

Expected: All tests pass (5 controller tests + 4 service changeStatus tests).

- [ ] **Step 3: Commit all 5 files**

```bash
git add \
  src/modules/asset-treasury/wallets/dto/wallet.dto.ts \
  src/modules/asset-treasury/wallets/wallets.service.ts \
  src/modules/asset-treasury/wallets/wallets.controller.ts \
  src/modules/asset-treasury/wallets/wallets.controller.spec.ts \
  src/modules/asset-treasury/wallets/wallets.service.spec.ts
git commit -m "refactor(wallets): remove legacy POST /wallets route, create() method, and CreateWalletDto"
```
