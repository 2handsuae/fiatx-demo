# V7 Fiat Swap Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settle the FIAT leg of every V6 swap immediately and per-customer (Zand client-asset segregation forbids EOD pool netting), moving cash two hops `C_VIBAN ↔ F_SET ↔ F_LIQ` as one `InternalTransaction` with two sequential `InternalFund`s, draining `TRADE_CLEARING↔BANK` once on completion.

**Architecture:** Event-driven. `SwapWorkflowService` emits `SWAP_SUCCEEDED` after commit; a new `FiatSettlementWorkflowService` (L3) reacts, builds the batch/transfer/2-funds via existing L1 domain services, sequences the two bank legs off `fundsflow.status.changed`, and on completion drains TB + settles the outstanding. Crypto EOD (`type=CRYPTO`) is untouched; fiat (`type=FIAT`) is a parallel engine sharing the same batch/outstanding/funds-flow primitives.

**Tech Stack:** NestJS, Prisma (SQLite), TigerBeetle, Jest (unit tests with mocked deps, NestJS `Test.createTestingModule`).

**Spec:** `doc-final/superpowers/specs/2026-06-08-v7-fiat-swap-settlement-design.md`

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `src/modules/asset-treasury/wallets/dto/wallet.dto.ts` | `WalletRole` enum | add `F_SET`, `F_FEE` |
| `src/modules/asset-treasury/wallets/wallet-role-policies.constant.ts` | per-role policy | add `F_SET`, `F_FEE` policies |
| `src/modules/asset-treasury/wallets/system-wallet.util.ts` | role sets | add to `FIAT_SYSTEM_WALLET_ROLES`, `PLATFORM_POOL_ROLES` |
| `prisma/seed.business.ts` | seed system wallets | fiat assets → `[C_CMA, F_SET, F_FEE, F_OPS, F_LIQ]` |
| `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts` | path whitelist | add `TransferMedium.BANK` + 2 route paths |
| `src/modules/funds-layer/guards/whitelist.guard.ts` | whitelist gate | add `assertRoute()` |
| `src/modules/funds-layer/domain/funds-flow.service.ts` | fund state machine + leg creation | add `FIAT_TRANSITIONS`, `assetType` branch, `createLeg()` |
| `src/modules/funds-layer/domain/system-wallet-resolver.service.ts` | wallet resolution | add `resolveCustomer()` |
| `src/modules/funds-layer/accounting/funds-accounting.service.ts` | TB drain | `FIAT → BANK` counterparty branch |
| `src/modules/funds-layer/domain/outstanding-consumer.service.ts` | outstanding ops | add fiat methods |
| `src/common/events/domain-events.constants.ts` | event registry | add `SWAP_SUCCEEDED` |
| `src/modules/trading/swap-transactions/swap-workflow.service.ts` | emit event | emit `SWAP_SUCCEEDED` post-commit |
| `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts` | **new** L3 orchestration | event handler + sequencing + completion |
| `src/modules/funds-layer/funds-layer.module.ts` | DI wiring | register new service |
| `scripts/seed-fiat-settle-demo.ts` | **new** demo seed | live-demo ledger state |

Run all tests with: `npm test -- <path>` (jest). Full suite: `npm test`.

---

## Phase 0 — Wallet roles & seed foundation

### Task 1: Add `F_SET` / `F_FEE` wallet roles

**Files:**
- Modify: `src/modules/asset-treasury/wallets/dto/wallet.dto.ts`
- Modify: `src/modules/asset-treasury/wallets/wallet-role-policies.constant.ts`
- Modify: `src/modules/asset-treasury/wallets/system-wallet.util.ts`
- Test: `src/modules/asset-treasury/wallets/wallet-role-policies.constant.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/modules/asset-treasury/wallets/wallet-role-policies.constant.spec.ts`:

```typescript
import { WALLET_ROLE_POLICIES } from './wallet-role-policies.constant';
import { FIAT_SYSTEM_WALLET_ROLES, PLATFORM_POOL_ROLES } from './system-wallet.util';
import { WalletRole } from './dto/wallet.dto';

describe('fiat settlement wallet roles', () => {
  it('F_SET and F_FEE are PLATFORM/FIAT pool roles', () => {
    for (const role of [WalletRole.F_SET, WalletRole.F_FEE]) {
      const policy = WALLET_ROLE_POLICIES[role];
      expect(policy).toBeDefined();
      expect(policy.allowedOwnerTypes).toContain('PLATFORM');
      expect(policy.allowedAssetTypes).toContain('FIAT');
    }
  });

  it('fiat system wallet role set includes C_CMA, F_SET, F_FEE, F_OPS, F_LIQ', () => {
    expect(FIAT_SYSTEM_WALLET_ROLES).toEqual(
      expect.arrayContaining([
        WalletRole.C_CMA, WalletRole.F_SET, WalletRole.F_FEE,
        WalletRole.F_OPS, WalletRole.F_LIQ,
      ]),
    );
  });

  it('F_SET and F_FEE are platform pool roles', () => {
    expect(PLATFORM_POOL_ROLES.has(WalletRole.F_SET)).toBe(true);
    expect(PLATFORM_POOL_ROLES.has(WalletRole.F_FEE)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- wallet-role-policies.constant.spec.ts`
Expected: FAIL — `WalletRole.F_SET` is `undefined`.

- [ ] **Step 3: Add the enum members**

In `wallet.dto.ts`, extend `enum WalletRole` (after `F_OPS`):

```typescript
  F_OPS = 'F_OPS',
  F_SET = 'F_SET',
  F_FEE = 'F_FEE',
}
```

- [ ] **Step 4: Add role policies**

In `wallet-role-policies.constant.ts`, add inside `WALLET_ROLE_POLICIES` (after the `F_OPS` entry):

```typescript
  [WalletRole.F_SET]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
  [WalletRole.F_FEE]: {
    maxPerOwnerPerAsset: Infinity,
    allowedOwnerTypes: ['PLATFORM'],
    allowedAssetTypes: ['FIAT'],
    requiresCustodian: true,
  },
```

- [ ] **Step 5: Add to role sets**

In `system-wallet.util.ts`, update both arrays/sets:

```typescript
export const FIAT_SYSTEM_WALLET_ROLES: WalletRole[] = [
  WalletRole.C_CMA, WalletRole.F_SET, WalletRole.F_FEE, WalletRole.F_OPS, WalletRole.F_LIQ,
];
```
```typescript
export const PLATFORM_POOL_ROLES: ReadonlySet<string> = new Set([
  WalletRole.F_LIQ, WalletRole.F_OPS, WalletRole.F_SET, WalletRole.F_FEE,
]);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- wallet-role-policies.constant.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/wallets/dto/wallet.dto.ts src/modules/asset-treasury/wallets/wallet-role-policies.constant.ts src/modules/asset-treasury/wallets/system-wallet.util.ts src/modules/asset-treasury/wallets/wallet-role-policies.constant.spec.ts
git commit -m "feat(v7): add F_SET/F_FEE fiat wallet roles"
```

---

### Task 2: Fix fiat system-wallet seed

**Files:**
- Modify: `prisma/seed.business.ts:51-63` (the `SYSTEM_WALLET_ROLES` constant and owner map)

The current seed uses one `SYSTEM_WALLET_ROLES = ['C_MAIN','C_OUT','F_LIQ','F_OPS']` for both crypto and fiat. Split by asset type so fiat assets get the correct pool set.

- [ ] **Step 1: Replace the single role constant with per-type sets**

In `seed.business.ts`, replace the `SYSTEM_WALLET_ROLES` constant (around line 52) and its owner map. Import the canonical sets instead of redefining:

```typescript
import {
  CRYPTO_SYSTEM_WALLET_ROLES,
  FIAT_SYSTEM_WALLET_ROLES,
} from '../src/modules/asset-treasury/wallets/system-wallet.util';
import { WalletRole } from '../src/modules/asset-treasury/wallets/dto/wallet.dto';

type SystemWalletRole = WalletRole;
```

Delete the local `SYSTEM_WALLET_ROLES` array and `SYSTEM_WALLET_OWNER` map; all system pool wallets are `ownerType: 'PLATFORM', ownerNo: 'PLATFORM', ownerId: null`.

- [ ] **Step 2: Select the role set by asset type in `seedAssets`**

In `seedAssets`, where it loops `for (const role of SYSTEM_WALLET_ROLES)`, change to:

```typescript
    const systemRoles = isFiat ? FIAT_SYSTEM_WALLET_ROLES : CRYPTO_SYSTEM_WALLET_ROLES;
    for (const role of systemRoles) {
```

Replace any `SYSTEM_WALLET_OWNER[role]` usage with the literal platform owner:

```typescript
      const owner = { ownerType: 'PLATFORM' as const, ownerNo: 'PLATFORM' };
```

(The existing `isFiat` branch already builds `FIAT_BANK` wallets with `buildSystemPoolIban(role, asset.code)` — it now runs for `C_CMA/F_SET/F_FEE/F_OPS/F_LIQ`.)

- [ ] **Step 3: Re-run the seed and verify fiat pool wallets**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx ts-node -r tsconfig-paths/register prisma/seed.business.ts 2>&1 | tail -5
```
Expected: `Seeded N assets + system TB accounts + system wallets.`

Verify (AED is the seeded fiat asset):
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx prisma db execute --stdin <<'SQL'
SELECT walletRole, type FROM Wallet w JOIN Asset a ON w.assetId=a.id
WHERE a.type='FIAT' AND w.ownerType='PLATFORM' ORDER BY walletRole;
SQL
```
Expected rows: `C_CMA, F_FEE, F_LIQ, F_OPS, F_SET` all `FIAT_BANK`.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.business.ts
git commit -m "fix(v7): seed fiat system wallets as C_CMA/F_SET/F_FEE/F_OPS/F_LIQ"
```

---

## Phase 1 — Path whitelist (BANK medium + routes)

### Task 3: Add fiat settlement routes + route whitelist

**Files:**
- Modify: `src/modules/funds-layer/constants/internal-transfer-paths.constant.ts`
- Modify: `src/modules/funds-layer/guards/whitelist.guard.ts`
- Test: `src/modules/funds-layer/guards/whitelist.guard.spec.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `src/modules/funds-layer/guards/whitelist.guard.spec.ts`:

```typescript
import { WhitelistGuard } from './whitelist.guard';

describe('WhitelistGuard.assertRoute (fiat)', () => {
  const guard = new WhitelistGuard();

  it('accepts the FIAT_SETTLE_OUT route and returns its policy', () => {
    const policy = guard.assertRoute(['C_VIBAN', 'F_SET', 'F_LIQ']);
    expect(policy.path).toBe('FIAT_SETTLE_OUT');
    expect(policy.class).toBe('B');
    expect(policy.medium).toBe('BANK');
    expect(policy.drain).toBe('TRADE_CLEARING');
  });

  it('accepts the FIAT_SETTLE_IN route', () => {
    const policy = guard.assertRoute(['F_LIQ', 'F_SET', 'C_VIBAN']);
    expect(policy.path).toBe('FIAT_SETTLE_IN');
  });

  it('rejects an unknown route', () => {
    expect(() => guard.assertRoute(['C_VIBAN', 'F_LIQ'])).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- whitelist.guard.spec.ts`
Expected: FAIL — `guard.assertRoute is not a function`.

- [ ] **Step 3: Add the BANK medium, route type, and two route paths**

In `internal-transfer-paths.constant.ts`:

Add to `enum TransferMedium`:
```typescript
export enum TransferMedium {
  CHAIN = 'CHAIN',
  BANK = 'BANK',
}
```

Add the two new paths to `enum TransferPath`:
```typescript
  FEE_COLLECT  = 'FEE_COLLECT',
  FIAT_SETTLE_OUT = 'FIAT_SETTLE_OUT',
  FIAT_SETTLE_IN  = 'FIAT_SETTLE_IN',
}
```

Add an optional `route` to the policy interface:
```typescript
export interface TransferPathPolicy {
  path: TransferPath;
  from: string;
  to: string;
  class: AccountingClass;
  medium: TransferMedium;
  trigger: string[];
  drain?: DrainAccount;
  route?: string[];          // multi-hop ordered roles (fiat 2-hop)
}
```

Add the two entries to `TRANSFER_PATH_WHITELIST` (`from`/`to` are the end-to-end endpoints; `route` is the ordered hop list):
```typescript
  [TransferPath.FIAT_SETTLE_OUT]: {
    path: TransferPath.FIAT_SETTLE_OUT,
    from: 'C_VIBAN',
    to: 'F_LIQ',
    route: ['C_VIBAN', 'F_SET', 'F_LIQ'],
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    drain: 'TRADE_CLEARING',
  },
  [TransferPath.FIAT_SETTLE_IN]: {
    path: TransferPath.FIAT_SETTLE_IN,
    from: 'F_LIQ',
    to: 'C_VIBAN',
    route: ['F_LIQ', 'F_SET', 'C_VIBAN'],
    class: AccountingClass.B,
    medium: TransferMedium.BANK,
    trigger: ['SWAP'],
    drain: 'TRADE_CLEARING',
  },
```

Add a route resolver at the bottom (after `resolvePathPolicy`):
```typescript
export function resolveRoutePolicy(route: string[]): TransferPathPolicy | null {
  for (const policy of Object.values(TRANSFER_PATH_WHITELIST)) {
    if (
      policy.route &&
      policy.route.length === route.length &&
      policy.route.every((r, i) => r === route[i])
    ) {
      return policy;
    }
  }
  return null;
}
```

- [ ] **Step 4: Add `assertRoute` to the guard**

In `whitelist.guard.ts`:
```typescript
import {
  TransferPathPolicy,
  resolvePathPolicy,
  resolveRoutePolicy,
} from '../constants/internal-transfer-paths.constant';
```
Add the method to `WhitelistGuard`:
```typescript
  assertRoute(route: string[]): TransferPathPolicy {
    const policy = resolveRoutePolicy(route);
    if (!policy) {
      throw new BadRequestException({
        code: 'TRANSFER_ROUTE_NOT_WHITELISTED',
        message: `route=[${route.join('->')}] is not a whitelisted internal transfer route`,
      });
    }
    return policy;
  }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- whitelist.guard.spec.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
git add src/modules/funds-layer/constants/internal-transfer-paths.constant.ts src/modules/funds-layer/guards/whitelist.guard.ts src/modules/funds-layer/guards/whitelist.guard.spec.ts
git commit -m "feat(v7): fiat settlement routes + route whitelist (BANK medium)"
```

---

## Phase 2 — Fund state machine

### Task 4: `FIAT_TRANSITIONS` selected by `asset.type`

**Files:**
- Modify: `src/modules/funds-layer/domain/funds-flow.service.ts`
- Test: `src/modules/funds-layer/domain/funds-flow.service.spec.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `funds-flow.service.spec.ts` a focused transition-map test. The map is module-private, so test it through `updateStatus` behaviour OR export it. Export it for direct testing — add to the new test file imports:

```typescript
import { FIAT_TRANSITIONS } from './funds-flow.service';
import { InternalFundStatus, InternalFundAction } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

describe('FIAT_TRANSITIONS', () => {
  it('CREATED --SUBMIT--> CONFIRMING', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CREATED][InternalFundAction.SUBMIT])
      .toBe(InternalFundStatus.CONFIRMING);
  });
  it('CONFIRMING --CONFIRM--> CONFIRMED', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CONFIRMING][InternalFundAction.CONFIRM])
      .toBe(InternalFundStatus.CONFIRMED);
  });
  it('CONFIRMED --CLEAR--> CLEAR and --RETURN--> RETURNED', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CONFIRMED][InternalFundAction.CLEAR])
      .toBe(InternalFundStatus.CLEAR);
    expect(FIAT_TRANSITIONS[InternalFundStatus.CONFIRMED][InternalFundAction.RETURN])
      .toBe(InternalFundStatus.RETURNED);
  });
  it('does NOT allow crypto SIGN/BROADCAST', () => {
    expect(FIAT_TRANSITIONS[InternalFundStatus.CREATED][InternalFundAction.SIGN])
      .toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- funds-flow.service.spec.ts`
Expected: FAIL — `FIAT_TRANSITIONS` is not exported.

- [ ] **Step 3: Add the `FIAT_TRANSITIONS` map and branch the selector**

In `funds-flow.service.ts`, after the `CRYPTO_TRANSITIONS` constant add:

```typescript
export const FIAT_TRANSITIONS: Record<
  InternalFundStatus,
  Partial<Record<InternalFundAction, InternalFundStatus>>
> = {
  [InternalFundStatus.CREATED]: {
    [InternalFundAction.SUBMIT]: InternalFundStatus.CONFIRMING,
    [InternalFundAction.CANCEL]: InternalFundStatus.CANCELLED,
  },
  [InternalFundStatus.CONFIRMING]: {
    [InternalFundAction.CONFIRM]: InternalFundStatus.CONFIRMED,
    [InternalFundAction.FAIL]: InternalFundStatus.FAILED,
    [InternalFundAction.TIMEOUT]: InternalFundStatus.TIMEOUT,
  },
  [InternalFundStatus.CONFIRMED]: {
    [InternalFundAction.CLEAR]: InternalFundStatus.CLEAR,
    [InternalFundAction.RETURN]: InternalFundStatus.RETURNED,
  },
  [InternalFundStatus.CLEAR]: {
    [InternalFundAction.RETURN]: InternalFundStatus.RETURNED,
  },
  [InternalFundStatus.SIGNING]: {},
  [InternalFundStatus.BROADCASTED]: {},
  [InternalFundStatus.FAILED]: {},
  [InternalFundStatus.TIMEOUT]: {},
  [InternalFundStatus.RETURNED]: {},
  [InternalFundStatus.CANCELLED]: {},
};
```

Change `getTransitionMap` to branch on asset type:
```typescript
  private getTransitionMap(assetType?: string) {
    return assetType === 'FIAT' ? FIAT_TRANSITIONS : CRYPTO_TRANSITIONS;
  }
```

(`updateStatus` already calls `this.getTransitionMap(item.asset?.type || 'CRYPTO')`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- funds-flow.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/domain/funds-flow.service.ts src/modules/funds-layer/domain/funds-flow.service.spec.ts
git commit -m "feat(v7): FIAT_TRANSITIONS fund state machine by asset.type"
```

---

### Task 5: `createLeg` — create a specific fund leg (no single-fund guard)

`createFromInternalTransaction` short-circuits to the first existing fund (single-fund). The fiat transfer needs **two** funds with explicit per-hop wallets, so add a sibling that always inserts.

**Files:**
- Modify: `src/modules/funds-layer/domain/funds-flow.service.ts`
- Test: `src/modules/funds-layer/domain/funds-flow.service.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `funds-flow.service.spec.ts` (use the existing module/mocks setup in that file; mock `prisma.internalFund.create` and `internalTransaction.findUnique`):

```typescript
describe('createLeg', () => {
  it('inserts a fund with explicit from/to wallets and CREATED status, no existing-fund short-circuit', async () => {
    // arrange prisma mocks: internalTransaction.findUnique -> a tx; internalFund.create -> echo
    // (follow the existing spec's mock harness in this file)
    const result = await service.createLeg(
      {
        internalTransactionId: 't-1',
        fromWalletId: 'w-viban',
        toWalletId: 'w-fset',
        amount: new (require('@prisma/client').Prisma.Decimal)(5),
      },
      'SYSTEM',
    );
    expect(result).toBeDefined();
    // assert create was called with fromWalletId 'w-viban', toWalletId 'w-fset', status CREATED
  });
});
```

> Follow the mock harness already present in `funds-flow.service.spec.ts` for wiring `prisma`, `aggregator`, `eventEmitter`, `auditLogsService`. If that file mocks `$transaction` to run the callback, `createLeg` will exercise the inner `execute`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- funds-flow.service.spec.ts -t createLeg`
Expected: FAIL — `service.createLeg is not a function`.

- [ ] **Step 3: Add `createLeg`**

In `funds-flow.service.ts` add a method modeled on `createFromInternalTransaction` but **without** the `findFirst` short-circuit and taking explicit wallets:

```typescript
  async createLeg(
    input: {
      internalTransactionId: string;
      fromWalletId: string;
      toWalletId: string;
      amount: Prisma.Decimal;
      status?: InternalFundStatus;
    },
    operatorId = 'SYSTEM',
    tx?: TxClient,
  ) {
    const execute = async (client: TxClient) => {
      const internalTx = await (client as any).internalTransaction.findUnique({
        where: { id: input.internalTransactionId },
        include: { asset: true },
      });
      if (!internalTx) throw new NotFoundException('Internal transaction not found');

      const status = input.status ?? InternalFundStatus.CREATED;
      for (
        let attempt = 1;
        attempt <= FundsFlowService.MAX_NO_GENERATION_RETRIES;
        attempt += 1
      ) {
        const internalFundNo = generateReferenceNo('IFD');
        try {
          const created = await (client as any).internalFund.create({
            data: {
              internalFundNo,
              internalTransactionId: input.internalTransactionId,
              status,
              assetId: internalTx.assetId,
              amount: input.amount,
              feeAmount: new Prisma.Decimal(0),
              netAmount: input.amount,
              fromWalletId: input.fromWalletId,
              toWalletId: input.toWalletId,
              statusHistory: this.appendStatusHistory(null, status, operatorId, 'Fund leg created'),
              completedAt: null,
            },
          });
          await this.auditLogsService.recordByActor(
            {
              action: AuditActions.INTERNAL_FUND_CREATED,
              entityType: AuditEntityTypes.INTERNAL_FUND,
              entityId: created.id,
              entityNo: created.internalFundNo,
              reason: 'Fund leg created',
              sourcePlatform: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
            },
            {
              actorType: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
              actorId: operatorId,
              actorRole: operatorId === 'SYSTEM' ? 'SYSTEM' : 'ADMIN',
            },
            client,
          );
          return created;
        } catch (error) {
          if (this.isInternalFundNoUniqueConflict(error)) continue;
          throw error;
        }
      }
      throw new InternalServerErrorException(
        `Failed to generate unique internalFundNo after ${FundsFlowService.MAX_NO_GENERATION_RETRIES} attempts`,
      );
    };
    if (tx) return execute(tx);
    return (this.prisma as any).$transaction((client: TxClient) => execute(client));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- funds-flow.service.spec.ts -t createLeg`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/domain/funds-flow.service.ts src/modules/funds-layer/domain/funds-flow.service.spec.ts
git commit -m "feat(v7): FundsFlowService.createLeg for multi-leg fiat transfers"
```

---

## Phase 3 — Resolver

### Task 6: Resolve a customer's `C_VIBAN`

**Files:**
- Modify: `src/modules/funds-layer/domain/system-wallet-resolver.service.ts`
- Test: `src/modules/funds-layer/domain/system-wallet-resolver.service.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `system-wallet-resolver.service.spec.ts`:

```typescript
import { SystemWalletResolver } from './system-wallet-resolver.service';

describe('SystemWalletResolver.resolveCustomer', () => {
  const wallet = { id: 'w-viban', walletRole: 'C_VIBAN' };
  let prisma: { wallet: { findFirst: jest.Mock } };
  let resolver: SystemWalletResolver;

  beforeEach(() => {
    prisma = { wallet: { findFirst: jest.fn().mockResolvedValue(wallet) } };
    resolver = new SystemWalletResolver(prisma as any);
  });

  it('finds an ACTIVE CUSTOMER-owned wallet by role+asset+owner', async () => {
    const w = await resolver.resolveCustomer('a-aed', 'C_VIBAN', 'cust-1');
    expect(w).toBe(wallet);
    expect(prisma.wallet.findFirst).toHaveBeenCalledWith({
      where: { walletRole: 'C_VIBAN', assetId: 'a-aed', ownerType: 'CUSTOMER', ownerId: 'cust-1', status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('throws when no customer wallet exists', async () => {
    prisma.wallet.findFirst.mockResolvedValue(null);
    await expect(resolver.resolveCustomer('a-aed', 'C_VIBAN', 'cust-1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- system-wallet-resolver.service.spec.ts`
Expected: FAIL — `resolver.resolveCustomer is not a function`.

- [ ] **Step 3: Add `resolveCustomer`**

In `system-wallet-resolver.service.ts` add:
```typescript
  /** ACTIVE CUSTOMER-owned wallet (e.g. C_VIBAN) for a given owner + asset */
  async resolveCustomer(assetId: string, walletRole: string, ownerId: string) {
    const wallet = await (this.prisma as any).wallet.findFirst({
      where: { walletRole, assetId, ownerType: 'CUSTOMER', ownerId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!wallet)
      throw new BadRequestException({
        code: 'CUSTOMER_WALLET_NOT_FOUND',
        message: `No ACTIVE ${walletRole} wallet for customer ${ownerId} asset ${assetId}`,
      });
    return wallet;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- system-wallet-resolver.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/domain/system-wallet-resolver.service.ts src/modules/funds-layer/domain/system-wallet-resolver.service.spec.ts
git commit -m "feat(v7): resolveCustomer for per-customer C_VIBAN resolution"
```

---

## Phase 4 — Accounting (BANK drain branch)

### Task 7: Drain against `BANK` for fiat assets

**Files:**
- Modify: `src/modules/funds-layer/accounting/funds-accounting.service.ts:104-109`
- Test: `src/modules/funds-layer/accounting/funds-accounting.service.spec.ts` (extend existing)

The drain counterparty is hardcoded to `CUSTODY`. Fiat assets have no `CUSTODY` TB account (only `BANK`), so `resolveTbAccountId({ code: CUSTODY })` would fail. Branch on `transfer.asset.type`.

- [ ] **Step 1: Write the failing test**

Add to `funds-accounting.service.spec.ts` (mirror the existing harness that mocks `AccountingService.resolveTbAccountId` / `lookupBalance` / `executeTransfer`). Assert that for a FIAT transfer the counterparty resolved uses `TB_ACCOUNT_CODES.BANK`:

```typescript
it('FIAT B-class drain resolves the counterparty as BANK, not CUSTODY', async () => {
  // transfer.asset.type = 'FIAT', pathLabel = 'FIAT_SETTLE_OUT', currency AED ledger present
  // TRADE_CLEARING balance net CREDIT so a drain occurs
  await service.applyAccounting({ accountingClass: 'B' as any, internalTransferId: 't-fiat' });
  const codes = accounting.resolveTbAccountId.mock.calls.map((c: any[]) => c[0].code);
  expect(codes).toContain(TB_ACCOUNT_CODES.BANK);
  expect(codes).not.toContain(TB_ACCOUNT_CODES.CUSTODY);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- funds-accounting.service.spec.ts`
Expected: FAIL — counterparty still resolves `CUSTODY`.

- [ ] **Step 3: Branch the counterparty account**

In `funds-accounting.service.ts`, the transfer is already fetched with `include: { asset: true }`. Replace the `custodyId` resolution and the `TB_ACCOUNT_CODES.CUSTODY` references in the direction block with a computed `counterpartyCode`:

```typescript
    const counterpartyCode =
      transfer.asset.type === 'FIAT'
        ? TB_ACCOUNT_CODES.BANK
        : TB_ACCOUNT_CODES.CUSTODY;

    const counterpartyId = await this.accounting.resolveTbAccountId({
      code: counterpartyCode,
      ledger,
      ownerType: 'SYSTEM',
    });
```

Then in the direction block replace `custodyId` → `counterpartyId` and the two `TB_ACCOUNT_CODES.CUSTODY` literals (`creditTbCode`/`debitTbCode`) → `counterpartyCode`. The balance-sign-driven direction logic is otherwise unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- funds-accounting.service.spec.ts`
Expected: PASS (existing crypto tests still green — crypto resolves `CUSTODY`).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/accounting/funds-accounting.service.ts src/modules/funds-layer/accounting/funds-accounting.service.spec.ts
git commit -m "fix(v7): fiat B-class drain uses BANK counterparty"
```

---

## Phase 5 — Outstanding consumer fiat methods

### Task 8: `findOpenFiatBySwap` / `lockToTransfer` reuse / `settle` reuse

`lockToTransfer` and `settle` already exist and are reusable as-is. Add a fiat finder that returns the OPEN fiat outstandings for one swap.

**Files:**
- Modify: `src/modules/funds-layer/domain/outstanding-consumer.service.ts`
- Test: `src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `outstanding-consumer.service.spec.ts`:

```typescript
describe('findOpenFiatBySwap', () => {
  it('returns OPEN, FIAT, unbatched outstandings for a swap', async () => {
    const rows = [{ id: 'o1', direction: 'IN', amount: '5', assetId: 'a-aed', ownerId: 'c1' }];
    const prisma = { outstanding: { findMany: jest.fn().mockResolvedValue(rows) } };
    const svc = new OutstandingConsumerService(prisma as any);

    const result = await svc.findOpenFiatBySwap('swap-1');

    expect(prisma.outstanding.findMany).toHaveBeenCalledWith({
      where: {
        swapTransactionId: 'swap-1',
        status: 'OPEN',
        settlementBatchId: null,
        asset: { type: 'FIAT' },
      },
      select: expect.any(Object),
    });
    expect(result).toBe(rows);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- outstanding-consumer.service.spec.ts`
Expected: FAIL — `svc.findOpenFiatBySwap is not a function`.

- [ ] **Step 3: Add `findOpenFiatBySwap`**

In `outstanding-consumer.service.ts` add:
```typescript
  /** OPEN, FIAT, not-yet-batched outstandings produced by a single swap. */
  async findOpenFiatBySwap(swapTransactionId: string) {
    return (this.prisma as any).outstanding.findMany({
      where: {
        swapTransactionId,
        status: 'OPEN',
        settlementBatchId: null,
        asset: { type: 'FIAT' },
      },
      select: {
        id: true,
        direction: true,
        amount: true,
        assetId: true,
        assetCode: true,
        ownerId: true,
        ownerType: true,
        ownerNo: true,
        sourceNo: true,
      },
    });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- outstanding-consumer.service.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/domain/outstanding-consumer.service.ts src/modules/funds-layer/domain/outstanding-consumer.service.spec.ts
git commit -m "feat(v7): findOpenFiatBySwap for per-swap fiat settlement"
```

---

## Phase 6 — Fiat settlement workflow

### Task 9: `SWAP_SUCCEEDED` event + emit from swap workflow

**Files:**
- Modify: `src/common/events/domain-events.constants.ts`
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`

- [ ] **Step 1: Register the event**

In `domain-events.constants.ts`, add inside `DOMAIN_EVENTS` (after `INTERNALTRANSFER_COMPLETED`):
```typescript
  SWAP_SUCCEEDED: {
    name: 'swap.succeeded',
    emitter: 'SwapWorkflowService',
    subscribers: ['FiatSettlementWorkflowService'],
    payload: '{ swapId: string, swapNo: string, ownerId: string }',
  },
```
And in `DomainEventNames`:
```typescript
  SWAP_SUCCEEDED: DOMAIN_EVENTS.SWAP_SUCCEEDED.name,
```

- [ ] **Step 2: Emit after commit in the swap workflow**

In `swap-workflow.service.ts`, inject `EventEmitter2` in the constructor:
```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly swapQuoteService: SwapQuoteService,
    private readonly swapTransactionsService: SwapTransactionsService,
    private readonly outstandingsService: OutstandingsService,
    private readonly accountingService: AccountingService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
```
(Add the import `import { EventEmitter2 } from '@nestjs/event-emitter';`.) In `executeSwap`, after the `$transaction` returns `result` and before `return this.swapTransactionsService.findOne(result.id)`:
```typescript
      this.eventEmitter.emit(DomainEventNames.SWAP_SUCCEEDED, {
        swapId: result.id,
        swapNo: result.swapNo,
        ownerId,
      });
```
(Add imports `import { DomainEventNames } from '../../../common/events/domain-events.constants';`.) `EventEmitterModule` is global, so no module import change.

- [ ] **Step 3: Verify it compiles**

Run: `npm test -- swap-workflow`
Expected: existing swap-workflow tests pass (the constructor change may require adding `{ provide: EventEmitter2, useValue: { emit: jest.fn() } }` to that spec's providers — add it if the suite fails on missing dependency).

- [ ] **Step 4: Commit**

```bash
git add src/common/events/domain-events.constants.ts src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "feat(v7): emit SWAP_SUCCEEDED after swap commit"
```

---

### Task 10: `FiatSettlementWorkflowService` — build batch/transfer/2-funds on swap success

**Files:**
- Create: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts`
- Test: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts` (create)

This task implements the `@OnEvent(SWAP_SUCCEEDED)` entry: for each OPEN fiat outstanding of the swap, create a batch, a transfer (`FIAT_SETTLE_IN/OUT`), two funds (hop1 executable, hop2 held in `CREATED`), and lock the outstanding to the transfer. **No TB drain here** (drain happens on completion, Task 11).

- [ ] **Step 1: Write the failing test**

Create `fiat-settlement-workflow.service.spec.ts` (mock all collaborators, mirroring `eod-settlement-workflow.service.spec.ts` style):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { FiatSettlementWorkflowService } from './fiat-settlement-workflow.service';

describe('FiatSettlementWorkflowService.onSwapSucceeded', () => {
  let service: FiatSettlementWorkflowService;
  let batch: any, consumer: any, transfers: any, fundsFlow: any, accounting: any, wallets: any, prisma: any;

  beforeEach(async () => {
    batch = { createBatch: jest.fn().mockResolvedValue({ id: 'b-1', batchNo: 'OSB-1' }), recomputeBatch: jest.fn() };
    consumer = {
      findOpenFiatBySwap: jest.fn().mockResolvedValue([
        { id: 'o-aed', direction: 'OUT', amount: '5', assetId: 'a-aed', assetCode: 'AED', ownerId: 'c1', ownerType: 'CUSTOMER', ownerNo: 'CUST-1', sourceNo: 'SWP-1' },
      ]),
      lockToTransfer: jest.fn().mockResolvedValue({ count: 1 }),
      settle: jest.fn().mockResolvedValue({ count: 1 }),
    };
    transfers = { createTransfer: jest.fn().mockResolvedValue({ id: 't-1', internalTxNo: 'ITX-1' }) };
    fundsFlow = { createLeg: jest.fn().mockResolvedValue({ id: 'f-hop' }), updateStatus: jest.fn() };
    accounting = { applyAccounting: jest.fn() };
    wallets = {
      resolve: jest.fn((assetId: string, role: string) => Promise.resolve({ id: `w-${role}` })),
      resolveCustomer: jest.fn((assetId: string, role: string, owner: string) => Promise.resolve({ id: `w-${role}-${owner}` })),
    };
    prisma = { internalTransaction: { findUnique: jest.fn() }, internalFund: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FiatSettlementWorkflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: SettlementBatchService, useValue: batch },
        { provide: OutstandingConsumerService, useValue: consumer },
        { provide: InternalTransferService, useValue: transfers },
        { provide: FundsFlowService, useValue: fundsFlow },
        { provide: FundsAccountingService, useValue: accounting },
        { provide: SystemWalletResolver, useValue: wallets },
        { provide: WhitelistGuard, useValue: new WhitelistGuard() },
      ],
    }).compile();
    service = module.get(FiatSettlementWorkflowService);
  });

  it('OUT outstanding: batch + FIAT_SETTLE_OUT transfer + 2 funds (hop2 held) + lock', async () => {
    await service.onSwapSucceeded({ swapId: 'swap-1', swapNo: 'SWP-1', ownerId: 'c1' });

    expect(batch.createBatch).toHaveBeenCalledTimes(1);
    // VIBAN resolved for the customer, F_SET + F_LIQ resolved as platform
    expect(wallets.resolveCustomer).toHaveBeenCalledWith('a-aed', 'C_VIBAN', 'c1');
    expect(wallets.resolve).toHaveBeenCalledWith('a-aed', 'F_SET');
    expect(wallets.resolve).toHaveBeenCalledWith('a-aed', 'F_LIQ');

    // transfer created with FIAT_SETTLE_OUT path, class B, BANK medium
    const tArgs = transfers.createTransfer.mock.calls[0][0];
    expect(tArgs).toMatchObject({ path: 'FIAT_SETTLE_OUT', accountingClass: 'B', medium: 'BANK', settlementBatchId: 'b-1' });

    // two legs: hop1 VIBAN->F_SET, hop2 F_SET->F_LIQ (both CREATED)
    expect(fundsFlow.createLeg).toHaveBeenCalledTimes(2);
    const hop1 = fundsFlow.createLeg.mock.calls[0][0];
    const hop2 = fundsFlow.createLeg.mock.calls[1][0];
    expect(hop1).toMatchObject({ fromWalletId: 'w-C_VIBAN-c1', toWalletId: 'w-F_SET' });
    expect(hop2).toMatchObject({ fromWalletId: 'w-F_SET', toWalletId: 'w-F_LIQ' });

    expect(consumer.lockToTransfer).toHaveBeenCalledWith(['o-aed'], 'b-1', 't-1');
    // NO drain at creation
    expect(accounting.applyAccounting).not.toHaveBeenCalled();
  });

  it('no fiat outstanding: no-op', async () => {
    consumer.findOpenFiatBySwap.mockResolvedValue([]);
    await service.onSwapSucceeded({ swapId: 'swap-1', swapNo: 'SWP-1', ownerId: 'c1' });
    expect(batch.createBatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts`
Expected: FAIL — module cannot resolve `FiatSettlementWorkflowService`.

- [ ] **Step 3: Implement the creation half of the service**

Create `fiat-settlement-workflow.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import {
  AccountingClass,
  TransferMedium,
  TransferPath,
} from '../constants/internal-transfer-paths.constant';
import { SettlementBatchService } from '../domain/settlement-batch.service';
import { OutstandingConsumerService } from '../domain/outstanding-consumer.service';
import { InternalTransferService } from '../domain/internal-transfer.service';
import { FundsFlowService } from '../domain/funds-flow.service';
import { FundsAccountingService } from '../accounting/funds-accounting.service';
import { SystemWalletResolver } from '../domain/system-wallet-resolver.service';
import { WhitelistGuard } from '../guards/whitelist.guard';
import { InternalFundAction, InternalFundStatus } from '../../asset-treasury/internal-funds/dto/internal-fund.dto';

const FIAT_SOURCE_TYPE = 'FIAT_SETTLEMENT';

interface SwapSucceededEvent { swapId: string; swapNo: string; ownerId: string }
interface FundsFlowStatusChangedEvent {
  fundsFlowId: string; internalTransferId: string; oldStatus: string; newStatus: string;
}

@Injectable()
export class FiatSettlementWorkflowService {
  private readonly logger = new Logger(FiatSettlementWorkflowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly batchService: SettlementBatchService,
    private readonly consumer: OutstandingConsumerService,
    private readonly transfers: InternalTransferService,
    private readonly fundsFlow: FundsFlowService,
    private readonly accounting: FundsAccountingService,
    private readonly systemWallets: SystemWalletResolver,
    private readonly whitelist: WhitelistGuard,
  ) {}

  @OnEvent(DomainEventNames.SWAP_SUCCEEDED)
  async onSwapSucceeded(event: SwapSucceededEvent): Promise<void> {
    const outstandings = await this.consumer.findOpenFiatBySwap(event.swapId);
    if (!outstandings.length) return;

    const batch = await this.batchService.createBatch({
      cutoffAt: new Date(),
      settlementType: 'FIAT_SWAP',
    });

    for (const o of outstandings) {
      // direction OUT  -> client sold fiat -> VIBAN -> F_SET -> F_LIQ
      // direction IN   -> client bought fiat -> F_LIQ -> F_SET -> VIBAN
      const isOut = o.direction === 'OUT';
      const path = isOut ? TransferPath.FIAT_SETTLE_OUT : TransferPath.FIAT_SETTLE_IN;
      const route = isOut ? ['C_VIBAN', 'F_SET', 'F_LIQ'] : ['F_LIQ', 'F_SET', 'C_VIBAN'];
      this.whitelist.assertRoute(route);

      const viban = await this.systemWallets.resolveCustomer(o.assetId, 'C_VIBAN', o.ownerId);
      const fset = await this.systemWallets.resolve(o.assetId, 'F_SET');
      const fliq = await this.systemWallets.resolve(o.assetId, 'F_LIQ');

      const hop1From = isOut ? viban : fliq;
      const hop2To = isOut ? fliq : viban;
      const amount = new Prisma.Decimal(o.amount);

      const transfer = await this.transfers.createTransfer({
        path,
        accountingClass: AccountingClass.B,
        medium: TransferMedium.BANK,
        triggerSource: 'SWAP',
        sourceType: FIAT_SOURCE_TYPE,
        sourceId: `${event.swapId}:${o.id}`,
        sourceNo: o.sourceNo ?? event.swapNo,
        ownerType: o.ownerType,
        ownerId: o.ownerId,
        ownerNo: o.ownerNo ?? null,
        assetId: o.assetId,
        amount,
        feeAmount: new Prisma.Decimal(0),
        netAmount: amount,
        fromWalletId: hop1From.id,
        toWalletId: hop2To.id,
        settlementBatchId: batch.id,
      });

      // hop1 executable, hop2 held in CREATED until hop1 confirms (§4 sequencing)
      await this.fundsFlow.createLeg({
        internalTransactionId: transfer.id,
        fromWalletId: hop1From.id,
        toWalletId: fset.id,
        amount,
        status: InternalFundStatus.CREATED,
      });
      await this.fundsFlow.createLeg({
        internalTransactionId: transfer.id,
        fromWalletId: fset.id,
        toWalletId: hop2To.id,
        amount,
        status: InternalFundStatus.CREATED,
      });

      await this.consumer.lockToTransfer([o.id], batch.id, transfer.id);
    }

    await this.batchService.recomputeBatch(batch.id);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts
git commit -m "feat(v7): FiatSettlementWorkflowService builds batch/transfer/2-funds on swap success"
```

---

### Task 11: Sequencing + completion (hop2 release, drain, settle)

**Files:**
- Modify: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts`
- Test: `src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts`

Add a `fundsflow.status.changed` handler that (a) on **hop1 CONFIRMED** issues `SUBMIT` to the held hop2, and (b) on **CLEAR** finalizes: settle the outstanding (latch), drain TB once, recompute the batch.

- [ ] **Step 1: Write the failing tests**

Add to the spec:

```typescript
describe('onFundsFlowStatusChanged', () => {
  const fiatTransfer = { id: 't-1', sourceType: 'FIAT_SETTLEMENT', settlementBatchId: 'b-1', assetId: 'a-aed' };

  it('hop1 CONFIRMED releases hop2 with SUBMIT', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(fiatTransfer);
    // event fund is hop1 (its id matches the fund whose toWallet is F_SET)
    prisma.internalFund.findMany.mockResolvedValue([
      { id: 'f-hop1', toWalletId: 'w-F_SET', fromWalletId: 'w-C_VIBAN-c1', status: 'CONFIRMED' },
      { id: 'f-hop2', fromWalletId: 'w-F_SET', toWalletId: 'w-F_LIQ', status: 'CREATED' },
    ]);
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop1', internalTransferId: 't-1', oldStatus: 'CONFIRMING', newStatus: 'CONFIRMED' });
    expect(fundsFlow.updateStatus).toHaveBeenCalledWith('f-hop2', { action: InternalFundAction.SUBMIT }, 'SYSTEM');
  });

  it('CLEAR finalizes once: settle + drain + recompute', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(fiatTransfer);
    consumer.settle.mockResolvedValue({ count: 1 });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop2', internalTransferId: 't-1', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(consumer.settle).toHaveBeenCalledWith('t-1', 'f-hop2');
    expect(accounting.applyAccounting).toHaveBeenCalledWith({ accountingClass: 'B', internalTransferId: 't-1' });
    expect(batch.recomputeBatch).toHaveBeenCalledWith('b-1');
  });

  it('second CLEAR is a no-op (settle latch returns count 0)', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue(fiatTransfer);
    consumer.settle.mockResolvedValue({ count: 0 });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f-hop1', internalTransferId: 't-1', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(accounting.applyAccounting).not.toHaveBeenCalled();
    expect(batch.recomputeBatch).not.toHaveBeenCalled();
  });

  it('ignores non-fiat transfers', async () => {
    prisma.internalTransaction.findUnique.mockResolvedValue({ id: 't-x', sourceType: 'EOD_SETTLEMENT' });
    await service.onFundsFlowStatusChanged({ fundsFlowId: 'f', internalTransferId: 't-x', oldStatus: 'CONFIRMED', newStatus: 'CLEAR' });
    expect(consumer.settle).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts -t onFundsFlowStatusChanged`
Expected: FAIL — `service.onFundsFlowStatusChanged is not a function`.

- [ ] **Step 3: Implement the handler**

Add to `FiatSettlementWorkflowService`:

```typescript
  @OnEvent(DomainEventNames.FUNDSFLOW_STATUS_CHANGED)
  async onFundsFlowStatusChanged(event: FundsFlowStatusChangedEvent): Promise<void> {
    if (!event?.internalTransferId) return;
    if (event.newStatus !== 'CONFIRMED' && event.newStatus !== 'CLEAR') return;

    try {
      const transfer = await (this.prisma as any).internalTransaction.findUnique({
        where: { id: event.internalTransferId },
      });
      if (!transfer || transfer.sourceType !== FIAT_SOURCE_TYPE) return;

      if (event.newStatus === 'CONFIRMED') {
        // Release hop2 only after hop1 (the leg landing in F_SET) confirms.
        const funds = await (this.prisma as any).internalFund.findMany({
          where: { internalTransactionId: transfer.id },
          select: { id: true, fromWalletId: true, toWalletId: true, status: true },
        });
        const confirmed = funds.find((f: any) => f.id === event.fundsFlowId);
        const hop2 = funds.find(
          (f: any) => f.fromWalletId === confirmed?.toWalletId && f.status === InternalFundStatus.CREATED,
        );
        if (confirmed && hop2) {
          await this.fundsFlow.updateStatus(hop2.id, { action: InternalFundAction.SUBMIT } as any, 'SYSTEM');
        }
        return;
      }

      // newStatus === 'CLEAR' — finalize once. settle() is the idempotency latch:
      // it flips LOCKED→SETTLED; the second CLEAR sees count 0 and bails.
      const settled = await this.consumer.settle(transfer.id, event.fundsFlowId);
      if (!settled || settled.count === 0) return;

      await this.accounting.applyAccounting({
        accountingClass: AccountingClass.B,
        internalTransferId: transfer.id,
      });
      if (transfer.settlementBatchId) {
        await this.batchService.recomputeBatch(transfer.settlementBatchId);
      }
    } catch (err) {
      this.logger.error(
        `Fiat settlement handler failed for transfer=${event.internalTransferId} status=${event.newStatus}`,
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
```

> Note: emitting `fundsflow.status.changed` for `CONFIRMED` — the existing `FundsFlowService.updateStatus` already pushes an event payload for every transition (it appends `{ fundsFlowId, internalTransferId, oldStatus, newStatus }` and emits after commit), so `CONFIRMED` transitions are delivered. `CLEAR` transitions arrive via `autoClearConfirmedFunds` once both legs are CONFIRMED and the transfer aggregates to SUCCESS.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- fiat-settlement-workflow.service.spec.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/workflow/fiat-settlement-workflow.service.ts src/modules/funds-layer/workflow/fiat-settlement-workflow.service.spec.ts
git commit -m "feat(v7): fiat settlement sequencing + completion drain/settle"
```

---

### Task 12: Wire the service into the module

**Files:**
- Modify: `src/modules/funds-layer/funds-layer.module.ts`
- Test: `src/modules/funds-layer/funds-layer.module.spec.ts` (extend existing)

- [ ] **Step 1: Write the failing test**

Add to `funds-layer.module.spec.ts` an assertion that the new provider resolves (follow the existing module-spec pattern that compiles the module and `.get()`s providers):

```typescript
it('provides FiatSettlementWorkflowService', () => {
  expect(moduleRef.get(FiatSettlementWorkflowService)).toBeDefined();
});
```
(Import `FiatSettlementWorkflowService` at the top.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- funds-layer.module.spec.ts`
Expected: FAIL — provider not found.

- [ ] **Step 3: Register the provider**

In `funds-layer.module.ts`, import and add `FiatSettlementWorkflowService` to `providers`. Optionally add to `exports` if other modules need it (not required for event handling). Import:
```typescript
import { FiatSettlementWorkflowService } from './workflow/fiat-settlement-workflow.service';
```
Add to `providers` array alongside `EodSettlementWorkflowService`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- funds-layer.module.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/funds-layer/funds-layer.module.ts src/modules/funds-layer/funds-layer.module.spec.ts
git commit -m "feat(v7): register FiatSettlementWorkflowService"
```

---

## Phase 7 — Demo & manual verification

### Task 13: `seed-fiat-settle-demo.ts` + live demo

**Files:**
- Create: `scripts/seed-fiat-settle-demo.ts`

Seeds the post-swap ledger state for a LIVE fiat settlement demo: an AED `C_VIBAN` for a demo customer (with balance), an OPEN OUT fiat Outstanding (AED, sourceType SWAP, the swap id), and `TRADE_CLEARING(AED)` carrying the matching credit. Then exits — the operator drives the funds in the UI / via simulate endpoints.

- [ ] **Step 1: Write the script**

Model on `scripts/seed-eod-demo.ts`. Key differences: resolve the **AED FIAT** asset, ensure a demo customer has an ACTIVE `C_VIBAN` (AED) wallet, seed `TRADE_CLEARING(AED)` credit, and create an OPEN OUT outstanding bound to a synthetic swap id:

```typescript
// scripts/seed-fiat-settle-demo.ts
import { webcrypto } from 'node:crypto';
if (!(globalThis as any).crypto) (globalThis as any).crypto = webcrypto;
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { AccountingService } from '../src/modules/accounting/tigerbeetle/accounting.service';
import { TB_ACCOUNT_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant';
import { TB_TRANSFER_CODES } from '../src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant';
import { TB_LEDGERS } from '../src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant';

const CURRENCY = 'AED';
const LEDGER = (TB_LEDGERS as Record<string, number>)[CURRENCY];
const TAG = Date.now().toString();

async function main() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  const prisma = ctx.get(PrismaService) as any;
  const accounting = ctx.get(AccountingService);

  const asset = await prisma.asset.findFirst({ where: { status: 'ACTIVE', type: 'FIAT', currency: CURRENCY } });
  if (!asset) throw new Error('Active AED fiat asset not found — run business seed first.');

  const customer = await prisma.customerMain.findFirst({ where: {} });
  if (!customer) throw new Error('No customer found — run business seed first.');

  // Ensure the customer has an ACTIVE AED C_VIBAN
  let viban = await prisma.wallet.findFirst({ where: { walletRole: 'C_VIBAN', assetId: asset.id, ownerType: 'CUSTOMER', ownerId: customer.id } });
  if (!viban) {
    viban = await prisma.wallet.create({ data: {
      walletNo: `WA-VIBAN-DEMO-${TAG}`, ownerType: 'CUSTOMER', ownerId: customer.id, ownerNo: customer.customerNo,
      type: 'FIAT_BANK', walletRole: 'C_VIBAN', assetId: asset.id, iban: `AE00DEMO${TAG.slice(-12)}`,
      bankName: 'FiatX Internal Bank', accountName: `Customer VIBAN (${CURRENCY})`, status: 'ACTIVE',
    } });
  }

  // Seed TRADE_CLEARING(AED) credit to back the settlement
  const clearingId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.TRADE_CLEARING, ledger: LEDGER, ownerType: 'SYSTEM' });
  const bankId = await accounting.resolveTbAccountId({ code: TB_ACCOUNT_CODES.BANK, ledger: LEDGER, ownerType: 'SYSTEM' });
  const bal = await accounting.lookupBalance(clearingId);
  const target = 5n * 10n ** BigInt(asset.decimals);
  const seed = target - (bal.creditsPosted - bal.debitsPosted);
  if (seed > 0n) {
    await accounting.executeTransfer({
      debitAccountId: bankId, creditAccountId: clearingId, amount: seed, ledger: LEDGER,
      code: TB_TRANSFER_CODES.SWAP_CREDIT_TO_CLEARING_POST,
      evidence: { sourceType: 'FIAT_DEMO_SEED', sourceNo: `SEED-${TAG}`, eventCode: 'FIAT_DEMO_SEED', debitCode: 'A.BANK', creditCode: 'L.TRADE_CLEARING', assetCurrency: CURRENCY, traceId: `FIATDEMO:${TAG}`, actorType: 'SYSTEM', actorId: 'SYSTEM', memo: 'seed-fiat-settle-demo' },
    });
  }

  const swapId = `FIATDEMO-SWAP-${TAG}`;
  const outstanding = await prisma.outstanding.create({ data: {
    outstandingNo: `OUT-FIATDEMO-${TAG}`, sourceType: 'SWAP', sourceId: swapId, sourceNo: swapId,
    ownerType: 'CUSTOMER', ownerId: customer.id, ownerNo: customer.customerNo, direction: 'OUT',
    assetId: asset.id, assetCode: CURRENCY, amount: '5', status: 'OPEN', swapTransactionId: swapId,
  } });

  console.log('=== seed-fiat-settle-demo done ===');
  console.log(`customer=${customer.customerNo} viban=${viban.iban}`);
  console.log(`OPEN outstanding=${outstanding.outstandingNo} (OUT, 5 ${CURRENCY}) swapId=${swapId}`);
  console.log(`\nNext: emit SWAP_SUCCEEDED({swapId:'${swapId}', ownerId:'${customer.id}'}) or call the swap flow, then drive funds via simulate.`);
  await ctx.close();
  process.exit(0);
}
main().catch((e) => { console.error('FATAL', e); process.exit(2); });
```

> Note: the demo Outstanding uses a synthetic `swapTransactionId` string. `Outstanding.swapTransactionId` is a nullable column (no FK enforced at insert in the seed path); if the schema enforces the relation, create a minimal `SwapTransaction` row first or drop the field and rely on `sourceId`.

- [ ] **Step 2: Run the script**

Run:
```bash
DATABASE_URL="file:/tmp/exchange_js_branch/dev.db" npx ts-node -r tsconfig-paths/register scripts/seed-fiat-settle-demo.ts 2>&1 | tail -10
```
Expected: prints the OPEN outstanding + viban + swapId.

- [ ] **Step 3: Drive the settlement and verify**

Trigger the workflow (emit `SWAP_SUCCEEDED` with the printed `swapId`/`ownerId`, e.g. via a temporary admin endpoint or by running a real fiat swap), then advance both funds with the fiat simulate actions (`SUBMIT`→`CONFIRM` on hop1, then hop2 auto-`SUBMIT`s, `CONFIRM` it). Verify:
- A `FIAT_SWAP` settlement batch reaches `SUCCESS` (admin Settlement Batches).
- The Outstanding is `SETTLED`.
- `TRADE_CLEARING(AED)` net returns to 0 (drained to `BANK`):
```bash
# inspect via the same lookupBalance the script uses, or an admin TB view
```

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-fiat-settle-demo.ts
git commit -m "chore(v7): seed-fiat-settle-demo for live fiat settlement demo"
```

---

## Final verification

- [ ] **Run the full funds-layer + swap test suites**

Run: `npm test -- funds-layer && npm test -- swap-workflow`
Expected: all green.

- [ ] **Typecheck / build**

Run: `npm run build`
Expected: no TS errors.

- [ ] **Documentation**

Append a one-line entry to roadmap V7 noting fiat settlement delivered, and per CLAUDE.md end the thread with `Documentation updated: ...`.

---

## Self-Review Notes (spec coverage)

| Spec section | Covered by |
|---|---|
| §1 D1 per-swap immediate | Task 9 (event) + Task 10 |
| §1 D2 event-driven | Task 9, Task 10 |
| §1 D3 two-hop route | Task 3, Task 10 |
| §1 D4 1 batch/1 outstanding/1 transfer/2 funds | Task 5, Task 10 |
| §1 D5 drain at SUCCESS, once | Task 7, Task 11 (settle-latch) |
| §1 D6 FIAT_TRANSITIONS | Task 4 |
| §2 roles (F_SET/F_FEE, C_CMA reuse) | Task 1, Task 2 |
| §5 fund state machine | Task 4 |
| §6 TB BANK branch / drain timing | Task 7, Task 11 |
| §7 whitelist route + BANK medium | Task 3 |
| §8 three-layer placement | Task 10/11 (L3) + L1 services |
| §9 seed | Task 2, Task 13 |
| §10 error/idempotency (RETURN, settle-latch, dedupe) | Task 4 (RETURN), Task 11 (latch), Task 10 (`sourceId=swapId:outstandingId`) |
| §11 out of scope (fee collection, cron) | not implemented (by design) |
