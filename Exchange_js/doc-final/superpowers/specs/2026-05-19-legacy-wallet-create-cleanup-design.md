# Legacy Wallet Creation Code Cleanup

**Date:** 2026-05-19
**Scope:** 5 files — pure deletion, no new code
**Principle:** Remove the old `POST /wallets` route that bypasses approval workflow (security risk)

---

## Background

The Custodian Wallets module now has two proper creation paths:
1. **Admin workflow** — `POST /admin/custodian-wallets` → approval → adapter provisioning
2. **Customer self-service** — `POST /customer/deposit-wallets` → direct creation via `CustomerDepositWalletService`

The old `POST /wallets` route in `WalletsController` predates both. It bypasses approval, generates mock addresses inline, and references the `LIQUIDITY_PROVIDER` owner type that no longer exists in the workflow. It must be removed.

---

## Deletion Inventory

### 1. DTO: `dto/wallet.dto.ts`

**Delete:** `CreateWalletDto` class (lines 47-123)

**Delete orphaned imports:** `IsString`, `IsOptional`, `IsUUID`, `IsNumber`, `Min`

**Keep:** All enums (`OwnerType`, `WalletType`, `WalletDirection`, `WalletRole`, `WalletStatus`), `UpdateWalletStatusDto`, `IsEnum`, `ApiProperty`

### 2. Controller: `wallets.controller.ts`

**Delete:** `@Post() create()` method (lines 56-101)

**Delete orphaned imports:**
- `Post` from `@nestjs/common`
- `CreateWalletDto`, `WalletDirection`, `WalletType`, `WalletRole` from `./dto/wallet.dto`

**Keep:** `GET /`, `GET /:id`, `GET /:id/balance`, `PATCH /:id/status`, and their imports (`Body`, `OwnerType`, `UpdateWalletStatusDto`, `WalletStatus`)

### 3. Service: `wallets.service.ts`

**Delete methods:**
- `async create()` (lines 115-266)
- `private resolveCreateWalletRole()` (lines 66-82)
- `private assertManualCreateAllowed()` (lines 84-113)
- `private isUniqueConstraintError()` (lines 45-52)
- `private isWalletNoUniqueConstraintError()` (lines 54-64)

**Delete field:** `private static readonly MAX_WALLET_NO_RETRIES = 5` (line 32)

**Delete orphaned imports:**
- `InternalServerErrorException` from `@nestjs/common`
- `CreateWalletDto`, `OwnerType`, `WalletDirection`, `WalletType`, `WalletRole` from `./dto/wallet.dto`
- `import * as crypto from 'crypto'`

**Keep:** `changeStatus()`, `createWalletRecord()`, `transitionStatus()`, `deleteWallet()`, `linkApprovalCase()`, `findByWalletNo()`, and their imports (`WalletStatus`, `Prisma`, `PrismaService`, `generateReferenceNo`, `AuditLogsService`, `AuditActions`, `AuditEntityTypes`, `AuditResult`, `isProtectedSystemWalletRole`)

### 4. Controller tests: `wallets.controller.spec.ts`

**Delete 6 tests:**
- "should reject CUSTOMER creating PLATFORM wallet"
- "should reject CUSTOMER creating wallet for another ownerId"
- "should reject CUSTOMER creating BIDIRECTIONAL wallet"
- "should normalize CUSTOMER inbound create to undefined role"
- "should normalize CUSTOMER outbound create to C_OUT role"
- "should allow ADMIN creating PLATFORM and LIQUIDITY_PROVIDER wallets"

**Delete orphaned fixtures/imports:**
- `createDto` fixture
- `create: jest.fn()` from `serviceMock`
- `CreateWalletDto`, `WalletDirection`, `WalletType`, `WalletRole` from imports

**Keep 5 tests:** findAll scoping (2), findOne scoping (1), changeStatus auth (1), findOne ownership (1)

### 5. Service tests: `wallets.service.spec.ts`

**Delete:** Entire `describe('create()')` block (lines 82-252)

**Delete orphaned fixtures/imports:**
- `customerInboundDto`, `cryptoAsset`, `fiatAsset` fixtures
- `BadRequestException` from imports
- `CreateWalletDto`, `WalletDirection`, `WalletType` from imports
- `customerMain`, `liquidityProvider` from `prismaMock`
- `asset.findUnique`, `customerMain.findUnique`, `liquidityProvider.findUnique`, `wallet.findFirst`, `wallet.create` mock setup lines from `beforeEach`

**Keep:** Entire `describe('changeStatus()')` block + its supporting mocks (`wallet.findUnique`, `wallet.update`)

---

## Safety Checklist

| Check | Result |
|---|---|
| `WalletsService.create()` callers | Only `wallets.controller.ts:100` — being deleted |
| `CreateWalletDto` importers (non-test) | Only controller + service — both cleaned |
| Enums in `wallet.dto.ts` | 9+ external files import `WalletRole` etc. — untouched |
| L1 methods (`createWalletRecord`, `transitionStatus`, etc.) | Used by workflow + customer-deposit — untouched |
| `changeStatus()` | Used by `PATCH /:id/status` — untouched |

---

## Success Criteria

1. `POST /wallets` route no longer exists — `curl -X POST /wallets` returns 404
2. `CreateWalletDto` class no longer exported from `wallet.dto.ts`
3. `WalletsService` has no `create()` method
4. All enums still exported and importable
5. TypeScript compiles clean (`npx tsc --noEmit`)
6. Remaining tests pass (`npx jest --testPathPattern='wallets\.(service|controller)\.spec'`)
