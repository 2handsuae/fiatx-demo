# Asset Currency Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename Asset `code` → `currency`, add compound `code` = `${currency}-${network}` field across the entire stack.

**Architecture:** Three-phase approach: (1) DB schema + migration, (2) backend service/DTO/controller rename, (3) frontend rename + format simplification. Each phase builds on the previous, but within a phase tasks are independent per-module.

**Tech Stack:** Prisma, SQLite, NestJS, React, TypeScript

---

## File Map

| Layer | Files | Change Type |
|-------|-------|-------------|
| Prisma schema | `prisma/schema.prisma` | rename field + add field + update constraint |
| DB migration | `prisma/migrations/<timestamp>_asset_currency_rename/migration.sql` | new migration |
| Seed data | `src/config/manifests/assets.manifest.ts` | `code:` → `currency:`, add `code:` |
| Asset DTOs | `src/modules/asset-treasury/assets/dto/asset.dto.ts` | `code` → `currency` |
| | `src/modules/asset-treasury/assets/dto/submit-asset-listing.dto.ts` | `code` → `currency` |
| | `src/modules/asset-treasury/assets/dto/update-asset.dto.ts` | comment update |
| Asset services | `src/modules/asset-treasury/assets/assets.service.ts` | `code` → `currency` + generate `code` |
| | `src/modules/asset-treasury/assets/assets.controller.ts` | query param `code` → `currency` |
| | `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts` | `code` → `currency` in DTO + audit |
| | `src/modules/asset-treasury/assets/asset-provisioning.service.ts` | rename refs |
| | `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts` | `assetCode` → `assetCurrency` in audit |
| | `src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts` | same |
| | `src/modules/asset-treasury/assets/asset-reactivation-workflow.service.ts` | same |
| Wallet services | `src/modules/asset-treasury/wallets/*.ts` (4 files) | `asset.code` → `asset.currency` |
| Withdrawal | `src/modules/asset-treasury/withdrawal-addresses/*.ts` (2 files) | same |
| Accounting | `src/modules/accounting/tigerbeetle/*.ts` (7 files) | `assetCode` → `assetCurrency` |
| Trading | `src/modules/trading/pricing-center/pricing-center.service.ts` | rename + delete `formatAssetLabel` |
| | `src/modules/trading/pricing-center/types/pricing.types.ts` | `assetCode` → `assetCurrency` |
| | `src/config/manifests/pricing-policies.manifest.ts` | rename + delete `formatAssetLabel` |
| | `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | rename refs |
| | `src/modules/trading/swap-transactions/swap-transactions.service.ts` | rename refs |
| | `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` | rename refs |
| Clearing | `src/modules/clearing-settle/**/*.ts` (5 files) | rename refs |
| Orchestrators | `src/orchestrators/*.ts` (2 files) | rename refs |
| Other backend | `src/modules/audit-logging/audit-logs.service.ts` | rename refs |
| | `src/common/events/domain-events.constants.ts` | rename refs |
| Admin frontend | `admin-web/src/pages/Asset*.tsx` (7 files) | `code` → `currency` + use new `code` |
| | `admin-web/src/pages/*.tsx` (~39 other files) | `asset.code` → `asset.currency` or `asset.code` |
| Client frontend | `client-web/src/pages/*.tsx` (7 files) | same pattern |

---

### Task 1: Prisma schema + DB migration + seed data

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_asset_currency_rename/migration.sql`
- Modify: `src/config/manifests/assets.manifest.ts`

- [ ] **Step 1: Update Prisma schema**

In `prisma/schema.prisma`, find the Asset model (line 1140–1197). Replace these lines:

```prisma
  code                           String
```

with:

```prisma
  currency                       String
  code                           String                          @unique
```

And replace the unique constraint:

```prisma
  @@unique([type, code, network])
```

with:

```prisma
  @@unique([type, currency, network])
```

- [ ] **Step 2: Create manual migration**

Create directory and SQL file:

```bash
mkdir -p prisma/migrations/20260518200000_asset_currency_rename
```

Write `prisma/migrations/20260518200000_asset_currency_rename/migration.sql`:

```sql
-- Step 1: Add currency column
ALTER TABLE "assets" ADD COLUMN "currency" TEXT;

-- Step 2: Copy current code values to currency
UPDATE "assets" SET "currency" = "code";

-- Step 3: Rewrite code as compound: currency-network or just currency
UPDATE "assets" SET "code" = CASE
  WHEN "network" IS NOT NULL AND "network" != '' THEN "currency" || '-' || "network"
  ELSE "currency"
END;

-- Step 4: Make currency non-nullable (SQLite requires table rebuild)
-- Prisma will handle this via its migration engine since we declared it as String (non-optional)

-- Step 5: Create unique index on code
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

-- Step 6: Drop old composite unique index and create new one
DROP INDEX IF EXISTS "assets_type_code_network_key";
CREATE UNIQUE INDEX "assets_type_currency_network_key" ON "assets"("type", "currency", "network");
```

- [ ] **Step 3: Update seed manifest**

In `src/config/manifests/assets.manifest.ts`, replace the entire file:

```typescript
import { buildDeterministicNo } from '../../common/utils/no-generator.util';

export const DEFAULT_ASSETS = [
  // 1. Fiat
  {
    assetNo: buildDeterministicNo('AS', 'FIAT', 'AED', ''),
    type: 'FIAT',
    currency: 'AED',
    code: 'AED',
    network: '',
    description: 'United Arab Emirates Dirham',
    decimals: 2,
    status: 'ACTIVE',
  },
  // 2. Crypto
  {
    assetNo: buildDeterministicNo('AS', 'CRYPTO', 'USDT', 'TRON'),
    type: 'CRYPTO',
    currency: 'USDT',
    code: 'USDT-TRON',
    network: 'TRON',
    description: 'Tether (TRC20)',
    decimals: 6,
    status: 'ACTIVE',
  },
];
```

- [ ] **Step 4: Run migration and verify**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx prisma migrate deploy
npx prisma generate
```

Verify data:
```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT code, currency, network FROM assets;"
```

Expected output:
```
AED|AED|
USDT-TRON|USDT|TRON
```

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260518200000_asset_currency_rename/ src/config/manifests/assets.manifest.ts
git commit -m "feat(schema): rename asset code→currency, add compound code field"
```

---

### Task 2: Asset DTOs + core service

**Files:**
- Modify: `src/modules/asset-treasury/assets/dto/asset.dto.ts`
- Modify: `src/modules/asset-treasury/assets/dto/submit-asset-listing.dto.ts`
- Modify: `src/modules/asset-treasury/assets/dto/update-asset.dto.ts`
- Modify: `src/modules/asset-treasury/assets/assets.service.ts`
- Modify: `src/modules/asset-treasury/assets/assets.controller.ts`

- [ ] **Step 1: Update CreateAssetDto**

In `src/modules/asset-treasury/assets/dto/asset.dto.ts`, find:

```typescript
  @ApiProperty()
  @IsString()
  @MaxLength(16)
  code!: string;
```

Replace with:

```typescript
  @ApiProperty()
  @IsString()
  @MaxLength(16)
  currency!: string;
```

- [ ] **Step 2: Update SubmitAssetListingDto**

In `src/modules/asset-treasury/assets/dto/submit-asset-listing.dto.ts`, find:

```typescript
  @IsString()
  @MaxLength(16)
  code!: string;
```

Replace with:

```typescript
  @IsString()
  @MaxLength(16)
  currency!: string;
```

- [ ] **Step 3: Update update-asset.dto.ts comment**

In `src/modules/asset-treasury/assets/dto/update-asset.dto.ts`, find:

```typescript
 * Identity fields (type, code, network, decimals) are NOT editable
```

Replace with:

```typescript
 * Identity fields (type, currency, network, decimals) are NOT editable
```

- [ ] **Step 4: Update assets.service.ts**

In `src/modules/asset-treasury/assets/assets.service.ts`:

**4a.** In the `create` method (line 29–80), replace all `data.code` with `data.currency` and add compound code generation:

Find:
```typescript
  async create(data: CreateAssetDto) {
    this.logger.log(
      `Creating asset: ${data.type} ${data.code} ${data.network || ''}`,
    );

    const existing = await this.prisma.asset.findFirst({
      where: {
        type: data.type,
        code: data.code,
        network: data.network || null,
      },
    });

    if (existing) {
      this.logger.warn(
        `Failed to create asset: Asset combination already exists`,
      );
      throw new BadRequestException(
        'Asset with this type, code and network combination already exists',
      );
    }

    if (data.type === AssetType.CRYPTO && !data.network) {
      throw new BadRequestException('Network is required for CRYPTO assets');
    }

    const result = await this.prisma.asset.create({
      data: {
        assetNo: generateReferenceNo('AS'),
        type: data.type,
        code: data.code,
        network: data.network,
        decimals: data.decimals,
        description: data.description,
        status: AssetStatus.ACTIVE,
      },
    });
```

Replace with:
```typescript
  async create(data: CreateAssetDto) {
    this.logger.log(
      `Creating asset: ${data.type} ${data.currency} ${data.network || ''}`,
    );

    const existing = await this.prisma.asset.findFirst({
      where: {
        type: data.type,
        currency: data.currency,
        network: data.network || null,
      },
    });

    if (existing) {
      this.logger.warn(
        `Failed to create asset: Asset combination already exists`,
      );
      throw new BadRequestException(
        'Asset with this type, currency and network combination already exists',
      );
    }

    if (data.type === AssetType.CRYPTO && !data.network) {
      throw new BadRequestException('Network is required for CRYPTO assets');
    }

    const code = data.network ? `${data.currency}-${data.network}` : data.currency;

    const result = await this.prisma.asset.create({
      data: {
        assetNo: generateReferenceNo('AS'),
        type: data.type,
        currency: data.currency,
        code,
        network: data.network,
        decimals: data.decimals,
        description: data.description,
        status: AssetStatus.ACTIVE,
      },
    });
```

**4b.** In the `createAsset` L1 method (line 286–345), apply the same rename pattern:

Find:
```typescript
  async createAsset(
    dto: {
      code: string;
      name?: string;
```

Replace with:
```typescript
  async createAsset(
    dto: {
      currency: string;
      name?: string;
```

Find:
```typescript
    const existing = await db.asset.findFirst({
      where: { type: dto.type, code: dto.code, network: dto.network ?? null },
    });
    if (existing) {
      throw new ConflictException(
        `Asset already exists: type=${dto.type} code=${dto.code} network=${dto.network || 'N/A'}`,
      );
    }
```

Replace with:
```typescript
    const existing = await db.asset.findFirst({
      where: { type: dto.type, currency: dto.currency, network: dto.network ?? null },
    });
    if (existing) {
      throw new ConflictException(
        `Asset already exists: type=${dto.type} currency=${dto.currency} network=${dto.network || 'N/A'}`,
      );
    }
```

Find:
```typescript
        const data: any = {
          assetNo,
          type: dto.type,
          code: dto.code,
          network: dto.network,
```

Replace with:
```typescript
        const code = dto.network ? `${dto.currency}-${dto.network}` : dto.currency;
        const data: any = {
          assetNo,
          type: dto.type,
          currency: dto.currency,
          code,
          network: dto.network,
```

- [ ] **Step 5: Update assets.controller.ts**

In `src/modules/asset-treasury/assets/assets.controller.ts`, find the `findAll` method query params:

```typescript
  @ApiQuery({ name: 'code', required: false, type: String })
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('type') type?: AssetType,
    @Query('status') status?: AssetStatus,
    @Query('code') code?: string,
  ) {
    const where: Prisma.AssetWhereInput = {};

    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }
    if (code) {
      where.code = { contains: code };
    }
```

Replace with:

```typescript
  @ApiQuery({ name: 'currency', required: false, type: String })
  findAll(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('type') type?: AssetType,
    @Query('status') status?: AssetStatus,
    @Query('currency') currency?: string,
  ) {
    const where: Prisma.AssetWhereInput = {};

    if (type) {
      where.type = type;
    }
    if (status) {
      where.status = status;
    }
    if (currency) {
      where.currency = { contains: currency };
    }
```

- [ ] **Step 6: Verify build**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit 2>&1 | head -40
```

Note: This will show errors from downstream files that still reference `asset.code` as currency — that is expected and will be fixed in subsequent tasks.

- [ ] **Step 7: Commit**

```bash
git add src/modules/asset-treasury/assets/dto/ src/modules/asset-treasury/assets/assets.service.ts src/modules/asset-treasury/assets/assets.controller.ts
git commit -m "refactor(assets): rename code→currency in DTOs, service, controller"
```

---

### Task 3: Asset workflow services rename

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-listing-workflow.service.ts`
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts`
- Modify: `src/modules/asset-treasury/assets/asset-activation-workflow.service.ts`
- Modify: `src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts`
- Modify: `src/modules/asset-treasury/assets/asset-reactivation-workflow.service.ts`

- [ ] **Step 1: Update asset-listing-workflow.service.ts**

In this file, apply these replacements using `replace_all`:

| Find | Replace |
|------|---------|
| `code: dto.code` | `currency: dto.currency` |
| `assetCode: dto.code` | `assetCurrency: dto.currency` |

Specifically, in `submitListing` method:

Find:
```typescript
        const created = (await this.assetsService.createAsset({
          code: dto.code,
          type: dto.type,
```

Replace with:
```typescript
        const created = (await this.assetsService.createAsset({
          currency: dto.currency,
          type: dto.type,
```

Find (two occurrences in audit metadata):
```typescript
          metadata: { assetCode: dto.code, assetType: dto.type, network: dto.network },
```

Replace with:
```typescript
          metadata: { assetCurrency: dto.currency, assetType: dto.type, network: dto.network },
```

Find:
```typescript
          metadata: {
          assetCode: dto.code,
          assetType: dto.type,
```

Replace with:
```typescript
          metadata: {
          assetCurrency: dto.currency,
          assetType: dto.type,
```

Find:
```typescript
      assetCode: dto.code,
      tbLedgerId,
```

Replace with:
```typescript
      assetCurrency: dto.currency,
      tbLedgerId,
```

Also update the JSDoc comment at line 126:

Find:
```typescript
   * Identity fields (type, code, network, decimals) cannot be changed
```

Replace with:
```typescript
   * Identity fields (type, currency, network, decimals) cannot be changed
```

- [ ] **Step 2: Update remaining 4 workflow files**

For each of the files below, search-and-replace `assetCode:` → `assetCurrency:` and `asset.code` → `asset.currency` in audit metadata and log messages. Read each file first to identify exact strings.

Files:
- `asset-provisioning.service.ts`
- `asset-activation-workflow.service.ts`
- `asset-suspension-workflow.service.ts`
- `asset-reactivation-workflow.service.ts`

The pattern is the same in all workflow files: audit metadata objects contain `assetCode: asset.code` — change to `assetCurrency: asset.currency`. Log messages containing `asset.code` → `asset.currency`.

- [ ] **Step 3: Verify build**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit 2>&1 | grep -c 'error TS'
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/assets/asset-listing-workflow.service.ts src/modules/asset-treasury/assets/asset-provisioning.service.ts src/modules/asset-treasury/assets/asset-activation-workflow.service.ts src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts src/modules/asset-treasury/assets/asset-reactivation-workflow.service.ts
git commit -m "refactor(assets): rename code→currency in asset workflow services"
```

---

### Task 4: Wallet + withdrawal services rename

**Files:**
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`
- Modify: `src/modules/asset-treasury/wallets/customer-deposit-wallet.service.ts`
- Modify: `src/modules/asset-treasury/wallets/wallets.service.ts`
- Modify: `src/modules/asset-treasury/wallets/custodian-adapter.interface.ts`
- Modify: `src/modules/asset-treasury/wallets/mock-custodian.adapter.ts`
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts`

- [ ] **Step 1: Rename in all wallet + withdrawal files**

In every file listed above, apply these replacements:
- `asset.code` → `asset.currency` (when referring to the ticker symbol)
- `assetCode` → `assetCurrency` (in variable names, parameters, metadata)

Read each file, identify exact occurrences, and apply the edits. These are all audit metadata and log message references.

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit 2>&1 | grep 'asset-treasury' | head -10
```

Expected: zero errors in `asset-treasury` module.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/wallets/ src/modules/asset-treasury/withdrawal-addresses/
git commit -m "refactor(wallets): rename assetCode→assetCurrency in wallet and withdrawal services"
```

---

### Task 5: Accounting (TigerBeetle) module rename

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/accounting.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/dto/create-tb-account.dto.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-account-batch.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-account-registry.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-evidence.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-manual-account.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/types/accounting.types.ts`

- [ ] **Step 1: Rename in all TigerBeetle files**

In every file listed above, apply these replacements:
- `assetCode` → `assetCurrency` (in types, interfaces, parameters, variable names)
- `asset.code` → `asset.currency` (in property access)

Read each file first to identify the exact occurrences. Key patterns:
- `accounting.types.ts` defines types with `assetCode: string` → change to `assetCurrency: string`
- `create-tb-account.dto.ts` has `assetCode` field → rename
- Service files reference `assetCode` as parameters and in log messages

- [ ] **Step 2: Verify build**

```bash
npx tsc --noEmit 2>&1 | grep 'tigerbeetle' | head -10
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounting/tigerbeetle/
git commit -m "refactor(accounting): rename assetCode→assetCurrency in TigerBeetle module"
```

---

### Task 6: Trading module + pricing manifests rename

**Files:**
- Modify: `src/modules/trading/pricing-center/pricing-center.service.ts`
- Modify: `src/modules/trading/pricing-center/types/pricing.types.ts`
- Modify: `src/config/manifests/pricing-policies.manifest.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts`

- [ ] **Step 1: Update pricing types**

In `src/modules/trading/pricing-center/types/pricing.types.ts`, rename all `assetCode` fields to `assetCurrency`.

- [ ] **Step 2: Delete formatAssetLabel and replace usages in pricing-center.service.ts**

In `src/modules/trading/pricing-center/pricing-center.service.ts`:

Find the `formatAssetLabel` private method (around line 584):
```typescript
  private formatAssetLabel(asset: {
    code: string;
    network?: string | null;
  }): string {
    return asset.network ? `${asset.code}-${asset.network}` : asset.code;
  }
```

Delete this entire method.

Replace all `this.formatAssetLabel(...)` calls with `asset.code` (the new compound code field). Also replace all `assetCode: asset.code` with `assetCurrency: asset.currency` and `currency: asset.code` with `currency: asset.currency`.

- [ ] **Step 3: Delete formatAssetLabel in pricing-policies.manifest.ts**

In `src/config/manifests/pricing-policies.manifest.ts`:

Find the `formatAssetLabel` function (around line 44):
```typescript
function formatAssetLabel(asset: PricingPolicyManifestAsset): string {
  const network = String(asset.network || '').trim();
  return network ? `${asset.code}-${network}` : asset.code;
}
```

Delete this function. Replace all `formatAssetLabel(...)` calls with direct `asset.code` references (since seed data now includes pre-computed `code`).

Also rename `assetCode: asset.code` → `assetCurrency: asset.currency` and `currency: asset.code` → `currency: asset.currency`.

- [ ] **Step 4: Update deposit, swap, and withdraw workflow services**

In each of these files, rename `asset.code` → `asset.currency` where it refers to the ticker, and `assetCode` → `assetCurrency` in variable names and metadata.

- [ ] **Step 5: Verify build**

```bash
npx tsc --noEmit 2>&1 | grep 'trading\|pricing\|manifests' | head -10
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/ src/config/manifests/pricing-policies.manifest.ts
git commit -m "refactor(trading): rename assetCode→assetCurrency, delete formatAssetLabel"
```

---

### Task 7: Clearing-settle + orchestrators + other backend rename

**Files:**
- Modify: `src/modules/clearing-settle/outstanding-settlements/outstanding-settlements.service.ts`
- Modify: `src/modules/clearing-settle/outstandings/outstandings.service.ts`
- Modify: `src/modules/clearing-settle/pool-settlement-batches/pool-settlement-batches.service.ts`
- Modify: `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts`
- Modify: `src/modules/clearing-settle/safeguarding-reconciliation/dto/safeguarding-reconciliation.dto.ts`
- Modify: `src/modules/clearing-settle/safeguarding-reconciliation/demo/wave8-safeguarding-demo.util.ts`
- Modify: `src/orchestrators/internal-collection-workflow.orchestrator.ts`
- Modify: `src/orchestrators/withdraw-workflow.orchestrator.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Modify: `src/common/events/domain-events.constants.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`

- [ ] **Step 1: Rename in all clearing-settle files**

In every clearing-settle file, apply: `assetCode` → `assetCurrency`, `asset.code` → `asset.currency`.

- [ ] **Step 2: Rename in orchestrators**

In both orchestrator files, apply: `assetCode` → `assetCurrency`, `asset.code` → `asset.currency`.

- [ ] **Step 3: Rename in audit-logging, events, risk-engine, sumsub**

Apply the same pattern to these files.

- [ ] **Step 4: Full backend build verification**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit 2>&1 | grep -v 'admin-web\|client-web' | head -20
```

Expected: zero backend TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/clearing-settle/ src/orchestrators/ src/modules/audit-logging/ src/common/events/ src/modules/risk-engine/ src/modules/sumsub-ingestion/
git commit -m "refactor(backend): rename assetCode→assetCurrency in remaining backend modules"
```

---

### Task 8: Admin frontend — Asset pages (AssetList, AssetDetail, AssetCreate, AssetEdit)

**Files:**
- Modify: `admin-web/src/pages/AssetList.tsx`
- Modify: `admin-web/src/pages/AssetDetail.tsx`
- Modify: `admin-web/src/pages/AssetCreate.tsx`
- Modify: `admin-web/src/pages/AssetEdit.tsx`

- [ ] **Step 1: Update AssetList.tsx**

The list page interface and columns need updating.

In the `AssetItem` interface, find:
```typescript
  code: string;
```

Add `currency` field:
```typescript
  currency: string;
  code: string;
```

In the header row, replace the "Asset No" and "Code" columns:

Find:
```tsx
              <th className={th} style={{ width: 120 }}>Asset No</th>
              <th className={th} style={{ width: 80 }}>Code</th>
```

Replace with:
```tsx
              <th className={th} style={{ width: 140 }}>Code</th>
              <th className={th} style={{ width: 80 }}>Currency</th>
```

In the data row, replace the Asset No and Code cells:

Find:
```tsx
                  <td className="px-3 py-2 font-mono text-[11px] text-adm-amber">
                    {a.assetNo || '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-t1">
                    {a.code}
                  </td>
```

Replace with:
```tsx
                  <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-amber">
                    {a.code}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-adm-t1">
                    {a.currency}
                  </td>
```

Also update the search filter — find the query parameter `code=` in the fetch URL and change to `currency=`:

Find any URL construction like:
```typescript
&code=${encodeURIComponent(searchText)}
```

Replace with:
```typescript
&currency=${encodeURIComponent(searchText)}
```

- [ ] **Step 2: Update AssetDetail.tsx**

In the `AssetDetailData` interface, add `currency`:
```typescript
  currency: string;
  code: string;
```

In the Hero section, the big title should show `code` (compound):

Find:
```tsx
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {asset.assetNo || asset.code}
            </p>
```

Replace with:
```tsx
            <p className="font-mono text-[19px] font-bold leading-snug text-adm-amber">
              {asset.code}
            </p>
```

In the hero subtitle, update to use `currency`:

Find:
```tsx
                {asset.code} · {asset.type}{asset.network ? ` · ${asset.network}` : ''}
```

Replace with:
```tsx
                {asset.currency} · {asset.type}{asset.network ? ` · ${asset.network}` : ''}
```

In the Asset Details section, update Code InfoField to show compound code, add Currency:

Find:
```tsx
              <InfoField label="Code" value={asset.code} mono />
              <InfoField label="Type" value={asset.type} />
```

Replace with:
```tsx
              <InfoField label="Code" value={asset.code} mono />
              <InfoField label="Currency" value={asset.currency} mono />
              <InfoField label="Type" value={asset.type} />
```

In sidebar Identity, update Code to show currency:

Find:
```tsx
            <SidebarKV label="Code" value={asset.code} mono />
```

Replace with:
```tsx
            <SidebarKV label="Currency" value={asset.currency} mono />
```

- [ ] **Step 3: Update AssetCreate.tsx**

In form state, rename `code` → `currency`:

Find:
```tsx
    code: '',
```
Replace with:
```tsx
    currency: '',
```

In handleSubmit payload:
Find:
```tsx
      code: formData.code,
```
Replace with:
```tsx
      currency: formData.currency,
```

In the form input field:
Find:
```tsx
                <input name="code" value={formData.code} onChange={handleChange} placeholder="e.g. USDT, BTC" className={`${fi} uppercase`} required maxLength={16} />
```
Replace with:
```tsx
                <input name="currency" value={formData.currency} onChange={handleChange} placeholder="e.g. USDT, BTC" className={`${fi} uppercase`} required maxLength={16} />
```

Also update the `<Label>` text from "Code" to "Currency" if it exists above the input.

- [ ] **Step 4: Update AssetEdit.tsx**

In the `AssetData` interface:
Find:
```tsx
  code: string;
```
Replace with:
```tsx
  currency: string;
  code: string;
```

In the readonly identity display:
Find:
```tsx
          code: data.code,
```
Replace with:
```tsx
          currency: data.currency,
          code: data.code,
```

Find:
```tsx
            {identity.code} · {identity.type} · Only operational fields are editable
```
Replace with:
```tsx
            {identity.code} · {identity.type} · Only operational fields are editable
```
(This line can stay as-is since `code` is now the compound identifier which is more useful in headers.)

Find readonly input:
```tsx
                <input value={identity.code} readOnly className={`${fiReadonly} uppercase`} />
```
Replace with:
```tsx
                <input value={identity.code} readOnly className={`${fiReadonly} uppercase`} />
```
(Keep showing compound `code` in readonly. Update the `<Label>` text to "Code" if it currently says something else.)

- [ ] **Step 5: Verify build**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web
npx tsc --noEmit 2>&1 | grep 'Asset' | head -10
```

- [ ] **Step 6: Commit**

```bash
git add admin-web/src/pages/AssetList.tsx admin-web/src/pages/AssetDetail.tsx admin-web/src/pages/AssetCreate.tsx admin-web/src/pages/AssetEdit.tsx
git commit -m "refactor(admin): rename code→currency in asset pages, use compound code as primary ID"
```

---

### Task 9: Admin frontend — Asset config pages

**Files:**
- Modify: `admin-web/src/pages/AssetConfigDetail.tsx`
- Modify: `admin-web/src/pages/AssetConfigList.tsx`
- Modify: `admin-web/src/pages/AssetConfigSnapshot.tsx`

- [ ] **Step 1: Update all 3 AssetConfig pages**

In each file, read to identify `asset.code` or `.code` references in interfaces, display, and logic. Apply:
- Add `currency: string` to interfaces alongside existing `code: string`
- Where `code` was used as ticker display (e.g., "USDT"), change to `currency`
- Where code + network were concatenated, use `code` directly

- [ ] **Step 2: Verify build + Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -5
git add admin-web/src/pages/AssetConfig*.tsx
git commit -m "refactor(admin): rename code→currency in asset config pages"
```

---

### Task 10: Admin frontend — Wallet + withdrawal pages

**Files:**
- Modify: `admin-web/src/pages/CustodianWalletCreateModal.tsx`
- Modify: `admin-web/src/pages/CustodianWalletDetail.tsx`
- Modify: `admin-web/src/pages/CustodianWalletList.tsx`
- Modify: `admin-web/src/pages/WithdrawalAddressDetail.tsx`
- Modify: `admin-web/src/pages/WithdrawalAddressList.tsx`

- [ ] **Step 1: Update all 5 wallet/withdrawal pages**

In each file, read to identify `asset.code` or `.code` references. The pattern will be:
- In interfaces: add `currency` field, keep `code` as compound
- In display: where showing ticker symbol, use `asset.currency`; where showing compound label like "USDT-TRON", use `asset.code`
- In dropdowns: `{a.code} ({a.type})` for compound code, or `{a.currency}` for ticker

- [ ] **Step 2: Verify build + Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -5
git add admin-web/src/pages/CustodianWallet*.tsx admin-web/src/pages/WithdrawalAddress*.tsx
git commit -m "refactor(admin): rename code→currency in wallet and withdrawal pages"
```

---

### Task 11: Admin frontend — Transaction pages (Deposit, Withdraw, Swap, Payin, Payout)

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`
- Modify: `admin-web/src/pages/DepositTransactionList.tsx`
- Modify: `admin-web/src/pages/WithdrawTransactionDetail.tsx`
- Modify: `admin-web/src/pages/WithdrawTransactionList.tsx`
- Modify: `admin-web/src/pages/SwapTransactionDetail.tsx`
- Modify: `admin-web/src/pages/SwapTransactionList.tsx`
- Modify: `admin-web/src/pages/PayinDetail.tsx`
- Modify: `admin-web/src/pages/PayinList.tsx`
- Modify: `admin-web/src/pages/PayoutDetail.tsx`
- Modify: `admin-web/src/pages/PayoutList.tsx`

- [ ] **Step 1: Update all 10 transaction pages**

The pattern in transaction pages is typically:
- `asset.code` displayed next to amounts (e.g., "100 USDT") — change to `asset.currency`
- `${asset.code}-${asset.network}` concatenation — change to `asset.code`
- `${asset.code} (${asset.network})` format — change to `asset.code`
- Interfaces with `code: string` in asset sub-objects — add `currency`, keep `code`

Read each file, identify exact occurrences, and apply.

- [ ] **Step 2: Verify build + Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit 2>&1 | head -5
git add admin-web/src/pages/DepositTransaction*.tsx admin-web/src/pages/WithdrawTransaction*.tsx admin-web/src/pages/SwapTransaction*.tsx admin-web/src/pages/Payin*.tsx admin-web/src/pages/Payout*.tsx
git commit -m "refactor(admin): rename code→currency in transaction pages"
```

---

### Task 12: Admin frontend — Remaining pages (Internal, Liquidity, Pricing, Clearing, Ops)

**Files:**
- Modify: `admin-web/src/pages/InternalTransactionDetail.tsx`
- Modify: `admin-web/src/pages/InternalTransactionList.tsx`
- Modify: `admin-web/src/pages/InternalFundDetail.tsx`
- Modify: `admin-web/src/pages/InternalFundList.tsx`
- Modify: `admin-web/src/pages/LiquidityConfigCreate.tsx`
- Modify: `admin-web/src/pages/LiquidityConfigEdit.tsx`
- Modify: `admin-web/src/pages/LiquidityConfigList.tsx`
- Modify: `admin-web/src/pages/PricingSwapConfigPage.tsx`
- Modify: `admin-web/src/pages/PricingWithdrawalConfigPage.tsx`
- Modify: `admin-web/src/pages/LedgerAccountDetail.tsx`
- Modify: `admin-web/src/pages/LedgerAccountList.tsx`
- Modify: `admin-web/src/pages/OutstandingSettlementDetail.tsx`
- Modify: `admin-web/src/pages/SwapOutstandingDetail.tsx`
- Modify: `admin-web/src/pages/SwapOutstandingList.tsx`
- Modify: `admin-web/src/pages/ReconciliationResourceDetailPage.tsx`
- Modify: `admin-web/src/pages/ReconciliationResourcePage.tsx`
- Modify: `admin-web/src/pages/TreasuryResourceDetailPage.tsx`
- Modify: `admin-web/src/pages/TreasuryResourcePage.tsx`
- Modify: `admin-web/src/pages/PoolSettlementBatchDetailPage.tsx`
- Modify: `admin-web/src/pages/Wave8OpsDashboardPage.tsx`
- Modify: `admin-web/src/pages/RegulatoryGateCreatePage.tsx`
- Modify: `admin-web/src/pages/InternalCollectionsPage.tsx`
- Modify: `admin-web/src/pages/SafeguardingBreakDetail.tsx`
- Modify: `admin-web/src/pages/SafeguardingBreakList.tsx`
- Modify: `admin-web/src/pages/SwapQuoteDetail.tsx`
- Modify: `admin-web/src/pages/TransferEvidenceList.tsx`

- [ ] **Step 1: Batch-rename in all remaining admin pages**

Apply the same pattern as previous tasks:
- `asset.code` as ticker → `asset.currency`
- `asset.code` + network concatenation → `asset.code` (compound, already computed)
- `assetCode` in interfaces/props → `assetCurrency`
- Add `currency` to interfaces where only `code` existed

Key simplifications:
- `InternalTransactionList.tsx` line 168: `${asset.code}${asset.network ? `-${asset.network}` : ''}` → `asset.code`
- `InternalTransactionDetail.tsx` line 277: `${data.asset?.code || '-'} ${data.asset?.network ? `(${data.asset.network})` : ''}` → `data.asset?.code || '—'`
- `InternalFundDetail.tsx`: similar compound pattern → `asset.code`
- `LiquidityConfigCreate.tsx` line 159: `{a.code} ({a.type}) {a.network ? `- ${a.network}` : ''}` → `{a.code} ({a.type})`
- `PricingSwapConfigPage.tsx` line 112: `asset.network ? `${asset.code}-${asset.network}` : asset.code` → `asset.code`

- [ ] **Step 2: Full admin-web build verification**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/
git commit -m "refactor(admin): rename code→currency in remaining admin pages"
```

---

### Task 13: Client frontend rename

**Files:**
- Modify: `client-web/src/pages/DashboardOverview.tsx`
- Modify: `client-web/src/pages/Deposit.tsx`
- Modify: `client-web/src/pages/Swap.tsx`
- Modify: `client-web/src/pages/TransactionHistory.tsx`
- Modify: `client-web/src/pages/WalletManagement.tsx`
- Modify: `client-web/src/pages/Withdraw.tsx`
- Modify: `client-web/src/pages/WithdrawalAddresses.tsx`
- Modify: `client-web/src/utils/customerFetch.ts`

- [ ] **Step 1: Update all client-web files**

Same pattern as admin-web:
- `asset.code` as ticker → `asset.currency`
- `assetCode` → `assetCurrency`
- Compound concatenations → `asset.code`
- Add `currency` to interfaces

- [ ] **Step 2: Full client-web build verification**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/client-web && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add client-web/src/
git commit -m "refactor(client): rename code→currency in client-web pages"
```

---

### Task 14: Final full-stack verification

- [ ] **Step 1: Full tsc check across all packages**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
npx tsc --noEmit
cd admin-web && npx tsc --noEmit
cd ../client-web && npx tsc --noEmit
```

Expected: zero errors in all three.

- [ ] **Step 2: Grep for any remaining old-pattern references**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
# Check for any remaining assetCode (should be assetCurrency now)
grep -rn 'assetCode' src/ admin-web/src/ client-web/src/ --include='*.ts' --include='*.tsx' | grep -v node_modules | grep -v '.spec.ts'

# Check for formatAssetLabel (should be deleted)
grep -rn 'formatAssetLabel' src/ --include='*.ts' | grep -v node_modules | grep -v '.spec.ts'
```

Expected: zero matches for both.

- [ ] **Step 3: Verify DB data integrity**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db "SELECT code, currency, network, type FROM assets;"
```

Expected:
```
AED|AED||FIAT
USDT-TRON|USDT|TRON|CRYPTO
```

- [ ] **Step 4: Commit any remaining fixes**

If any issues found in steps 1-3, fix and commit.
