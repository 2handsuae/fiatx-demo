# Fiat Bank Account Registration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow customers to register IBAN-based bank accounts as fiat withdrawal addresses, reusing the existing `WithdrawalAddress` model.

**Architecture:** Extend the `WithdrawalAddress` Prisma model with three nullable bank fields (`iban`, `swiftBic`, `bankName`). Add a new DTO, validator util, and `POST /client/withdrawal-addresses/bank-accounts` endpoint. The frontend replaces the "Coming Soon" bank tab placeholder with full list/add/detail views.

**Tech Stack:** NestJS, Prisma, SQLite, React, Tailwind CSS (FIATX tokens), class-validator

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `prisma/migrations/20260514_add_bank_account_fields/migration.sql` | Add `iban`, `swiftBic`, `bankName` columns |
| Create | `src/modules/asset-treasury/withdrawal-addresses/bank-validator.util.ts` | IBAN and SWIFT/BIC format validation |
| Create | `src/modules/asset-treasury/withdrawal-addresses/dto/create-bank-account.dto.ts` | Request DTO for bank account registration |
| Modify | `prisma/schema.prisma` | Add 3 nullable fields to `WithdrawalAddress` model |
| Modify | `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts` | Add `createBankAccount()` method |
| Modify | `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts` | Add `registerBankAccount()` method |
| Modify | `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.controller.ts` | Add `POST bank-accounts` endpoint |
| Modify | `client-web/src/pages/WithdrawalAddresses.tsx` | Implement bank tab list, add modal, detail modal |

---

### Task 1: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma` (WithdrawalAddress model, around line 1532)
- Create: `prisma/migrations/20260514_add_bank_account_fields/migration.sql`

- [ ] **Step 1: Add three nullable fields to `WithdrawalAddress` in schema.prisma**

Open `prisma/schema.prisma` and find the `WithdrawalAddress` model. After the `memo` field (around line 1543), add:

```prisma
  iban                 String?
  swiftBic             String?
  bankName             String?
```

The full model should now have these fields between `memo` and `counterpartyVaspName`:

```prisma
  memo                 String?

  iban                 String?
  swiftBic             String?
  bankName             String?

  counterpartyVaspName String?
```

- [ ] **Step 2: Create the migration SQL file**

Create directory and file `prisma/migrations/20260514_add_bank_account_fields/migration.sql`:

```sql
-- AlterTable
ALTER TABLE "withdrawal_addresses" ADD COLUMN "iban" TEXT;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "swiftBic" TEXT;
ALTER TABLE "withdrawal_addresses" ADD COLUMN "bankName" TEXT;
```

- [ ] **Step 3: Apply the migration**

Run:
```bash
cd /path/to/Exchange_js
npx prisma migrate resolve --applied 20260514_add_bank_account_fields
npx prisma generate
```

Expected: Prisma client regenerated with new fields.

- [ ] **Step 4: Verify by checking generated types**

Run:
```bash
grep -A3 'iban' node_modules/.prisma/client/index.d.ts | head -10
```

Expected: `iban`, `swiftBic`, `bankName` fields appear as `string | null`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20260514_add_bank_account_fields/migration.sql
git commit -m "feat: add iban, swiftBic, bankName fields to WithdrawalAddress schema"
```

---

### Task 2: Bank Validator Utility

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/bank-validator.util.ts`

- [ ] **Step 1: Create `bank-validator.util.ts` with IBAN and SWIFT validation**

Create `src/modules/asset-treasury/withdrawal-addresses/bank-validator.util.ts`:

```typescript
/**
 * IBAN validation — ISO 13616 format + mod-97 checksum.
 */
export function validateIban(iban: string): { valid: boolean; reason?: string } {
  const clean = iban.replace(/\s/g, '').toUpperCase();

  if (clean.length < 15 || clean.length > 34) {
    return { valid: false, reason: 'IBAN must be 15-34 characters' };
  }

  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(clean)) {
    return { valid: false, reason: 'IBAN must start with 2-letter country code + 2 check digits, followed by alphanumeric characters' };
  }

  // ISO 13616 mod-97 checksum: move first 4 chars to end, convert letters to digits, mod 97 must equal 1
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, ch => String(ch.charCodeAt(0) - 55));

  // Process in chunks to avoid BigInt for portability
  let remainder = '';
  for (const char of numeric) {
    remainder += char;
    remainder = String(Number(remainder) % 97);
  }

  if (Number(remainder) !== 1) {
    return { valid: false, reason: 'IBAN checksum is invalid' };
  }

  return { valid: true };
}

/**
 * SWIFT/BIC validation — 8 or 11 alphanumeric characters.
 * Pattern: 4 letters (bank) + 2 letters (country) + 2 alphanum (location) + optional 3 alphanum (branch)
 */
export function validateSwiftBic(code: string): { valid: boolean; reason?: string } {
  const clean = code.replace(/\s/g, '').toUpperCase();

  if (clean.length !== 8 && clean.length !== 11) {
    return { valid: false, reason: 'SWIFT/BIC must be exactly 8 or 11 characters' };
  }

  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(clean)) {
    return { valid: false, reason: 'SWIFT/BIC format invalid. Expected: 4 letters (bank) + 2 letters (country) + 2 alphanum (location) + optional 3 alphanum (branch)' };
  }

  return { valid: true };
}
```

- [ ] **Step 2: Manually verify with known values**

Quick sanity check — run in Node REPL or a scratch test:
```bash
npx ts-node -e "
const { validateIban, validateSwiftBic } = require('./src/modules/asset-treasury/withdrawal-addresses/bank-validator.util');
console.log('GB82 WEST 1234 5698 7654 32:', validateIban('GB82 WEST 1234 5698 7654 32'));
console.log('Invalid IBAN:', validateIban('XX00INVALID'));
console.log('EBILAEAD:', validateSwiftBic('EBILAEAD'));
console.log('DEUTDEFFXXX:', validateSwiftBic('DEUTDEFFXXX'));
console.log('BAD:', validateSwiftBic('BAD'));
"
```

Expected: first IBAN valid, second invalid; first two SWIFT valid, third invalid.

- [ ] **Step 3: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/bank-validator.util.ts
git commit -m "feat: add IBAN and SWIFT/BIC validator utility"
```

---

### Task 3: CreateBankAccountDto

**Files:**
- Create: `src/modules/asset-treasury/withdrawal-addresses/dto/create-bank-account.dto.ts`

- [ ] **Step 1: Create the DTO file**

Create `src/modules/asset-treasury/withdrawal-addresses/dto/create-bank-account.dto.ts`:

```typescript
import { IsUUID, IsString, IsBoolean, IsOptional, Equals } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateBankAccountDto {
  @ApiProperty({ description: 'Asset UUID (must be a FIAT asset)' })
  @IsUUID()
  assetId!: string;

  @ApiProperty({ description: 'Full legal name of the bank account holder' })
  @IsString()
  beneficiaryName!: string;

  @ApiProperty({ description: 'Name of the bank' })
  @IsString()
  bankName!: string;

  @ApiProperty({ description: 'International Bank Account Number (IBAN)' })
  @IsString()
  iban!: string;

  @ApiProperty({ description: 'SWIFT/BIC code (8 or 11 characters)' })
  @IsString()
  swiftBic!: string;

  @ApiProperty({ required: false, description: 'Optional account label, e.g. "My Savings"' })
  @IsString()
  @IsOptional()
  label?: string;

  @ApiProperty({ description: 'Must be true — ownership declaration' })
  @IsBoolean()
  @Equals(true, { message: 'Ownership declaration must be accepted' })
  ownershipDeclaration!: boolean;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/dto/create-bank-account.dto.ts
git commit -m "feat: add CreateBankAccountDto for fiat bank account registration"
```

---

### Task 4: Service Layer — `createBankAccount()`

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts`

- [ ] **Step 1: Add import for bank validators**

At the top of `withdrawal-address.service.ts`, add the import after the existing `validateCryptoAddress` import:

```typescript
import { validateIban, validateSwiftBic } from './bank-validator.util';
```

- [ ] **Step 2: Add `CreateBankAccountData` interface**

After the existing `CreateAddressData` interface (around line 22), add:

```typescript
interface CreateBankAccountData {
  customerId: string;
  customerNo: string;
  assetId: string;
  iban: string;
  swiftBic: string;
  bankName: string;
  beneficiaryName: string;
  label?: string;
  ownershipDeclaredAt: Date;
  ownershipProofType: string;
  traceId: string;
}
```

- [ ] **Step 3: Add `createBankAccount()` method to `WithdrawalAddressService`**

Add this method after the existing `create()` method in the class:

```typescript
  async createBankAccount(data: CreateBankAccountData, tx?: any) {
    const db = tx ?? this.prisma;

    // Validate IBAN format + checksum
    const ibanResult = validateIban(data.iban);
    if (!ibanResult.valid) {
      throw new BadRequestException({ code: 'INVALID_IBAN', message: ibanResult.reason });
    }

    // Validate SWIFT/BIC format
    const swiftResult = validateSwiftBic(data.swiftBic);
    if (!swiftResult.valid) {
      throw new BadRequestException({ code: 'INVALID_SWIFT_BIC', message: swiftResult.reason });
    }

    // Normalize
    const cleanIban = data.iban.replace(/\s/g, '').toUpperCase();
    const cleanSwift = data.swiftBic.replace(/\s/g, '').toUpperCase();

    // Check 3-per-asset limit
    const activeCount = await db.withdrawalAddress.count({
      where: {
        customerId: data.customerId,
        assetId: data.assetId,
        status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] },
      },
    });
    if (activeCount >= MAX_ADDRESSES_PER_ASSET) {
      throw new BadRequestException({ code: 'ADDRESS_LIMIT_REACHED', message: `Maximum ${MAX_ADDRESSES_PER_ASSET} bank accounts per asset` });
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
          network: 'FIAT',
          address: cleanIban,       // IBAN as canonical address for uniqueness
          addressType: 'BANK',
          label: data.label,
          beneficiaryName: data.beneficiaryName,
          iban: cleanIban,
          swiftBic: cleanSwift,
          bankName: data.bankName,
          ownershipDeclaredAt: data.ownershipDeclaredAt,
          ownershipProofType: data.ownershipProofType,
          activatesAt,
          traceId: data.traceId,
        },
        include: { asset: true },
      });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        throw new ConflictException({ code: 'BANK_ACCOUNT_ALREADY_REGISTERED', message: 'This IBAN is already registered for this asset' });
      }
      throw error;
    }
  }
```

- [ ] **Step 4: Verify the build compiles**

Run:
```bash
npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors related to `createBankAccount` or bank validator.

- [ ] **Step 5: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.service.ts
git commit -m "feat: add createBankAccount() method to WithdrawalAddressService"
```

---

### Task 5: Workflow Layer — `registerBankAccount()`

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`

- [ ] **Step 1: Add import for `CreateBankAccountDto`**

At the top of `withdrawal-address-workflow.service.ts`, add after the existing `CreateWithdrawalAddressDto` import:

```typescript
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
```

- [ ] **Step 2: Add `registerBankAccount()` method**

Add this method after the existing `registerAddress()` method in the class:

```typescript
  async registerBankAccount(dto: CreateBankAccountDto, customerId: string, customerNo: string) {
    // Pre-flight: customer must be approved and active
    const customer = await (this.prisma as any).customerMain.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException({ code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found' });
    if (customer.onboardingStatus !== 'APPROVED') {
      throw new ForbiddenException({ code: 'ONBOARDING_NOT_APPROVED', message: 'Customer onboarding not approved' });
    }
    if (customer.adminStatus !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Customer account is not active' });
    }

    // Validate asset: must exist, be ACTIVE, and be FIAT type
    const asset = await (this.prisma as any).asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    if (asset.status !== 'ACTIVE') {
      throw new BadRequestException({ code: 'ASSET_NOT_ACTIVE', message: `Asset is in ${asset.status} status` });
    }
    if (asset.type !== 'FIAT') {
      throw new BadRequestException({ code: 'ASSET_NOT_FIAT', message: 'Only fiat assets are supported for bank accounts' });
    }

    const traceId = crypto.randomUUID();

    // No travel rule attribution for bank accounts
    const address = await this.addressService.createBankAccount({
      customerId,
      customerNo,
      assetId: dto.assetId,
      iban: dto.iban,
      swiftBic: dto.swiftBic,
      bankName: dto.bankName,
      beneficiaryName: dto.beneficiaryName,
      label: dto.label,
      ownershipDeclaredAt: new Date(),
      ownershipProofType: 'DECLARATION',
      traceId,
    });

    // Mask IBAN for audit log: show first 4 + last 4
    const cleanIban = dto.iban.replace(/\s/g, '').toUpperCase();
    const maskedIban = cleanIban.length > 8
      ? `${cleanIban.slice(0, 4)}****${cleanIban.slice(-4)}`
      : cleanIban;

    await this.auditLogsService.recordSystem({
      action: AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION.ADDRESS_REGISTERED,
      entityType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
      entityId: address.id,
      entityNo: address.addressNo,
      workflowType: AuditBusinessWorkflowTypes.WITHDRAWAL_ADDRESS_REGISTRATION,
      traceId,
      result: AuditResult.SUCCESS,
      subjectNos: [{ subjectRole: AuditSubjectRole.ENTITY, subjectType: 'WITHDRAWAL_ADDRESS', subjectId: address.id, subjectNo: address.addressNo }],
      metadata: { addressType: 'BANK', iban: maskedIban, bankName: dto.bankName, assetCode: asset.code },
      sourcePlatform: 'CLIENT_API',
      entityOwnerId: customerId,
      entityOwnerNo: customerNo,
    });

    this.logger.log(`Bank account ${address.addressNo} registered by customer ${customerNo}`);
    return address;
  }
```

- [ ] **Step 3: Verify build**

Run:
```bash
npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts
git commit -m "feat: add registerBankAccount() workflow method"
```

---

### Task 6: Controller — `POST /bank-accounts` Endpoint

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.controller.ts`

- [ ] **Step 1: Add import for `CreateBankAccountDto`**

At the top of `withdrawal-address.controller.ts`, add after the existing `CreateWithdrawalAddressDto` import:

```typescript
import { CreateBankAccountDto } from './dto/create-bank-account.dto';
```

- [ ] **Step 2: Add the `POST /bank-accounts` endpoint**

Add this method after the existing `create()` method in the controller class:

```typescript
  @Post('bank-accounts')
  @ApiOperation({ summary: 'Register a new bank account for fiat withdrawals' })
  async createBankAccount(@Request() req: any, @Body() dto: CreateBankAccountDto) {
    const { customerId, customerNo } = this.extractCustomer(req);
    return this.workflowService.registerBankAccount(dto, customerId, customerNo);
  }
```

**IMPORTANT:** This method MUST appear BEFORE the `@Get(':addressNo')` route. NestJS matches routes top-down. If `@Get(':addressNo')` comes first, `GET /bank-accounts` would match the `:addressNo` param route. The `@Post('bank-accounts')` should be placed right after the existing `@Post()` method.

- [ ] **Step 3: Verify build**

Run:
```bash
npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/asset-treasury/withdrawal-addresses/withdrawal-address.controller.ts
git commit -m "feat: add POST /client/withdrawal-addresses/bank-accounts endpoint"
```

---

### Task 7: Frontend — Bank Tab List View + Add Modal + Detail Modal

**Files:**
- Modify: `client-web/src/pages/WithdrawalAddresses.tsx`

This is a large task. The changes are:
1. Add bank-specific types to the `WithdrawalAddr` interface
2. Add `maskIban()` helper
3. Load all assets (not just CRYPTO), split into `cryptoAssets` / `fiatAssets`
4. Separate crypto vs bank address counts for the limit display
5. Add bank-specific form state
6. Add bank submit handler
7. Replace the "Coming Soon" bank tab content with list view
8. Add bank add modal
9. Add bank detail modal

- [ ] **Step 1: Extend the `WithdrawalAddr` interface**

In `WithdrawalAddresses.tsx`, find the `WithdrawalAddr` interface (around line 33) and add three fields after `asset`:

```typescript
interface WithdrawalAddr {
  addressNo: string;
  address: string;
  addressType: string;
  network: string;
  status: string;
  label: string | null;
  beneficiaryName: string | null;
  memo: string | null;
  activatesAt: string;
  activatedAt: string | null;
  createdAt: string;
  counterpartyVaspName: string | null;
  ownershipDeclaredAt: string | null;
  asset: { code: string; network?: string };
  // Bank-specific fields
  iban: string | null;
  swiftBic: string | null;
  bankName: string | null;
}
```

- [ ] **Step 2: Add `maskIban()` helper**

After the existing `statusColor()` helper (around line 83), add:

```typescript
function maskIban(iban: string): string {
  const clean = iban.replace(/\s/g, '');
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)} ${'\\u2022'.repeat(4)} ${'\\u2022'.repeat(4)} ${clean.slice(-4)}`;
}

function formatIban(iban: string): string {
  const clean = iban.replace(/\s/g, '');
  return clean.replace(/(.{4})/g, '$1 ').trim();
}
```

Note: Use the actual bullet character `•` (•) in the real code, not the escaped form. The mask output looks like: `AE07 •••• •••• 8901`.

- [ ] **Step 3: Split asset loading into crypto + fiat**

Replace the current `useEffect` for loading assets (around line 113-127) with:

```typescript
  const [fiatAssets, setFiatAssets] = useState<Asset[]>([]);

  /* ─── Load assets ────────────────────────────────────────── */
  useEffect(() => {
    (async () => {
      try {
        const res = await customerFetch(`${API}/assets?take=200`);
        if (res.ok) {
          const data = await res.json();
          const all = (data.items ?? data) as Asset[];
          const crypto = all.filter(a => a.type === 'CRYPTO');
          const fiat = all.filter(a => a.type === 'FIAT');
          setAssets(crypto);
          setFiatAssets(fiat);
          if (crypto.length > 0) setFormAssetId(crypto[0].id);
        }
      } catch (err) {
        if (err instanceof CustomerSessionError) return;
      }
    })();
  }, []);
```

- [ ] **Step 4: Add bank-specific form state**

After the existing form state declarations (around line 101-108), add:

```typescript
  // bank form fields
  const [showBankAddModal, setShowBankAddModal] = useState(false);
  const [bankDetailAddr, setBankDetailAddr] = useState<WithdrawalAddr | null>(null);
  const [bankFormAssetId, setBankFormAssetId] = useState('');
  const [bankFormBeneficiary, setBankFormBeneficiary] = useState('');
  const [bankFormBankName, setBankFormBankName] = useState('');
  const [bankFormIban, setBankFormIban] = useState('');
  const [bankFormSwift, setBankFormSwift] = useState('');
  const [bankFormLabel, setBankFormLabel] = useState('');
  const [bankFormDeclaration, setBankFormDeclaration] = useState(false);
  const [bankSubmitting, setBankSubmitting] = useState(false);
  const [bankFormError, setBankFormError] = useState('');
```

- [ ] **Step 5: Add derived data for bank tab**

After the existing derived data section (around line 147-149), add:

```typescript
  // Bank tab derived
  const cryptoAddresses = addresses.filter(a => a.addressType !== 'BANK' && a.status !== 'CANCELLED');
  const bankAddresses = addresses.filter(a => a.addressType === 'BANK' && a.status !== 'CANCELLED');
  const bankActiveCount = addresses.filter(a => a.addressType === 'BANK' && ['PENDING_ACTIVATION', 'ACTIVE'].includes(a.status)).length;
  const canAddBank = bankActiveCount < 3;
```

Also update the existing `visibleAddresses` and `activeCount` to be crypto-specific:

Replace:
```typescript
  const visibleAddresses = addresses.filter(a => a.status !== 'CANCELLED');
  const activeCount = addresses.filter(a => ['PENDING_ACTIVATION', 'ACTIVE'].includes(a.status)).length;
  const canAdd = activeCount < 3;
```

With:
```typescript
  const visibleAddresses = addresses.filter(a => a.addressType !== 'BANK' && a.status !== 'CANCELLED');
  const activeCount = addresses.filter(a => a.addressType !== 'BANK' && ['PENDING_ACTIVATION', 'ACTIVE'].includes(a.status)).length;
  const canAdd = activeCount < 3;
```

- [ ] **Step 6: Add bank form reset and submit handlers**

After the existing `openAddModal` function, add:

```typescript
  const resetBankForm = () => {
    setBankFormBeneficiary('');
    setBankFormBankName('');
    setBankFormIban('');
    setBankFormSwift('');
    setBankFormLabel('');
    setBankFormDeclaration(false);
    setBankFormError('');
  };

  const openBankAddModal = () => {
    resetBankForm();
    if (fiatAssets.length > 0) setBankFormAssetId(fiatAssets[0].id);
    setShowBankAddModal(true);
  };

  const handleBankSubmit = async () => {
    setBankFormError('');
    if (!bankFormAssetId) { setBankFormError('Please select an asset'); return; }
    if (!bankFormBeneficiary.trim()) { setBankFormError('Beneficiary name is required'); return; }
    if (!bankFormBankName.trim()) { setBankFormError('Bank name is required'); return; }
    if (!bankFormIban.trim()) { setBankFormError('IBAN is required'); return; }
    if (!bankFormSwift.trim()) { setBankFormError('SWIFT/BIC code is required'); return; }
    if (!bankFormDeclaration) { setBankFormError('You must accept the ownership declaration'); return; }

    setBankSubmitting(true);
    try {
      const res = await customerFetch(`${API}/client/withdrawal-addresses/bank-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetId: bankFormAssetId,
          beneficiaryName: bankFormBeneficiary.trim(),
          bankName: bankFormBankName.trim(),
          iban: bankFormIban.trim(),
          swiftBic: bankFormSwift.trim(),
          label: bankFormLabel.trim() || undefined,
          ownershipDeclaration: true,
        }),
      });

      if (!res.ok) {
        setBankFormError(await getCustomerApiErrorMessage(res, 'Failed to register bank account'));
        return;
      }

      setShowBankAddModal(false);
      resetBankForm();
      await fetchAddresses();
    } catch (err: any) {
      if (err instanceof CustomerSessionError) return;
      setBankFormError(err.message || 'Unexpected error');
    } finally {
      setBankSubmitting(false);
    }
  };
```

- [ ] **Step 7: Replace the "Coming Soon" bank tab content**

Replace the entire bank tab block:

```tsx
        {/* ── Bank Tab (placeholder) ─────────────────────── */}
        {activeTab === 'bank' && (
          <div className="p-6">
            <div className="text-center py-16 bg-fx-charcoal/30 rounded-2xl border border-dashed border-fx-rule">
              <div className="w-16 h-16 bg-fx-charcoal rounded-full flex items-center justify-center mb-4 text-fx-dust mx-auto">
                <Building2 size={32} />
              </div>
              <h3 className="text-lg font-bold text-fx-sand mb-2">Coming Soon</h3>
              <p className="text-fx-dust max-w-sm mx-auto">
                Bank account registration will be available in a future update. Stay tuned.
              </p>
            </div>
          </div>
        )}
```

With the full bank tab list view:

```tsx
        {/* ── Bank Tab ─────────────────────────────────── */}
        {activeTab === 'bank' && (
          <div className="p-6 space-y-5">
            {/* Top bar */}
            <div className="flex items-center justify-between">
              <div className="text-sm text-fx-dune">
                Registered Accounts
                <span className="ml-1.5 font-mono text-fx-dust">({bankActiveCount}/3)</span>
              </div>
              <button
                onClick={openBankAddModal}
                disabled={!canAddBank}
                className="flex items-center gap-1.5 px-4 py-2 bg-fx-brass text-fx-obsidian text-sm font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Plus size={16} />
                Add Account
              </button>
            </div>

            {!canAddBank && (
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-2.5 text-xs text-amber-400 flex items-center gap-2">
                <AlertCircle size={14} className="shrink-0" />
                Maximum 3 active bank accounts reached.
              </div>
            )}

            {/* Bank account list */}
            {loading ? (
              <div className="text-center py-16 text-fx-dust">
                <RefreshCw className="animate-spin mx-auto mb-2" size={24} />
                Loading accounts...
              </div>
            ) : bankAddresses.length === 0 ? (
              <div className="text-center py-16 bg-fx-charcoal/30 rounded-2xl border border-dashed border-fx-rule">
                <div className="w-16 h-16 bg-fx-charcoal rounded-full flex items-center justify-center mb-4 text-fx-dust mx-auto">
                  <Building2 size={32} />
                </div>
                <h3 className="text-lg font-bold text-fx-sand mb-2">No Bank Accounts Yet</h3>
                <p className="text-fx-dust mb-6 max-w-sm mx-auto">
                  Register a bank account to enable fiat withdrawals.
                </p>
                <button
                  onClick={openBankAddModal}
                  className="px-6 py-3 bg-fx-brass text-fx-obsidian rounded-xl font-bold hover:shadow-lg hover:shadow-fx-brass/30 transition-all"
                >
                  Add Your First Account
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                {bankAddresses.map(addr => (
                  <button
                    key={addr.addressNo}
                    onClick={() => setBankDetailAddr(addr)}
                    className="w-full text-left rounded-2xl border border-fx-rule bg-fx-charcoal/40 p-4 hover:border-fx-brass/40 hover:bg-fx-charcoal/60 transition-all group"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-fx-sand truncate">
                            {addr.label || (addr.iban ? maskIban(addr.iban) : addr.addressNo)}
                          </span>
                          <span className="shrink-0 text-[10px] font-bold uppercase text-fx-dust bg-fx-charcoal px-1.5 py-0.5 rounded">
                            {addr.asset.code}
                          </span>
                        </div>
                        <div className="mt-1 text-xs font-mono text-fx-dust">
                          {addr.iban ? maskIban(addr.iban) : '—'}
                        </div>
                        <div className="mt-0.5 text-[11px] text-fx-dust/60">
                          {addr.bankName || '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        {addr.status === 'PENDING_ACTIVATION' && (
                          <div className="flex items-center gap-1 text-xs font-mono text-amber-400">
                            <Clock size={12} />
                            {formatCountdown(addr.activatesAt)}
                          </div>
                        )}
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${statusColor(addr.status)}`}>
                          {statusLabel(addr.status)}
                        </span>
                        <ChevronRight size={16} className="text-fx-dust group-hover:text-fx-brass transition-colors" />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
```

- [ ] **Step 8: Add Bank Add Modal**

After the existing "Add Address Modal" closing `)}` and before the "Address Detail Modal" section, add:

```tsx
      {/* ═══════════════════════════════════════════════════════
       *  Add Bank Account Modal
       * ═══════════════════════════════════════════════════════ */}
      {showBankAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto border border-fx-rule">
            {/* header */}
            <div className="flex justify-between items-center p-5 border-b border-fx-rule">
              <div>
                <h3 className="text-lg font-bold text-fx-sand">New Bank Account</h3>
                <p className="text-sm text-fx-dust mt-1">Register a bank account for fiat withdrawals</p>
              </div>
              <button
                onClick={() => setShowBankAddModal(false)}
                className="p-2 hover:bg-fx-charcoal rounded-full transition-colors text-fx-dust"
              >
                <X size={18} />
              </button>
            </div>

            {/* body */}
            <div className="p-5 space-y-4">
              {bankFormError && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-xs text-rose-400">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  {bankFormError}
                </div>
              )}

              {/* Asset */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Asset</label>
                <select
                  value={bankFormAssetId}
                  onChange={e => setBankFormAssetId(e.target.value)}
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm focus:outline-none focus:border-fx-brass"
                >
                  {fiatAssets.map(a => (
                    <option key={a.id} value={a.id}>{a.code} (Fiat)</option>
                  ))}
                </select>
              </div>

              {/* Beneficiary Name */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Beneficiary Name</label>
                <input
                  value={bankFormBeneficiary}
                  onChange={e => setBankFormBeneficiary(e.target.value)}
                  placeholder="Full legal name of account holder"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Bank Name */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">Bank Name</label>
                <input
                  value={bankFormBankName}
                  onChange={e => setBankFormBankName(e.target.value)}
                  placeholder="e.g. Emirates NBD, HSBC"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* IBAN */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">IBAN</label>
                <input
                  value={bankFormIban}
                  onChange={e => setBankFormIban(e.target.value)}
                  placeholder="AE07 0331 0000 1234 5678 901"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm font-mono placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* SWIFT / BIC */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">SWIFT / BIC Code</label>
                <input
                  value={bankFormSwift}
                  onChange={e => setBankFormSwift(e.target.value)}
                  placeholder="EBILAEAD"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm font-mono placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Account Label */}
              <div>
                <label className="text-xs text-fx-dust font-medium block mb-1">
                  Account Label
                  <span className="ml-1 text-fx-dust/60 font-normal">(optional)</span>
                </label>
                <input
                  value={bankFormLabel}
                  onChange={e => setBankFormLabel(e.target.value)}
                  placeholder="e.g. My Savings, Business Account"
                  className="w-full px-3 py-2.5 border border-fx-rule rounded-xl bg-fx-charcoal text-fx-sand text-sm placeholder:text-fx-dust/50 focus:outline-none focus:border-fx-brass"
                />
              </div>

              {/* Ownership Declaration */}
              <div className="rounded-xl border border-fx-brass/20 bg-fx-brass/5 p-4">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bankFormDeclaration}
                    onChange={e => setBankFormDeclaration(e.target.checked)}
                    className="mt-0.5 accent-fx-brass"
                  />
                  <div>
                    <div className="text-xs font-bold text-fx-brass mb-1 flex items-center gap-1.5">
                      <ShieldCheck size={13} />
                      Ownership Declaration
                    </div>
                    <span className="text-xs text-fx-dune leading-relaxed">
                      I declare that I am the rightful owner of this bank account and the named beneficiary. I understand that providing false information may result in account suspension.
                    </span>
                  </div>
                </label>
              </div>
            </div>

            {/* footer */}
            <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 flex gap-3">
              <button
                onClick={() => setShowBankAddModal(false)}
                disabled={bankSubmitting}
                className="flex-1 py-3 bg-fx-ink border border-fx-rule text-fx-dune font-semibold rounded-xl hover:bg-fx-charcoal transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={handleBankSubmit}
                disabled={bankSubmitting || !bankFormDeclaration}
                className="flex-1 py-3 bg-fx-brass text-fx-obsidian font-bold rounded-xl hover:shadow-lg hover:shadow-fx-brass/20 transition-all disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {bankSubmitting && <RefreshCw size={16} className="animate-spin" />}
                {bankSubmitting ? 'Registering...' : 'Register Account'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 9: Add Bank Detail Modal**

After the existing "Address Detail Modal" closing `)}` and before the component's final closing `</div>`, add:

```tsx
      {/* ═══════════════════════════════════════════════════════
       *  Bank Account Detail Modal
       * ═══════════════════════════════════════════════════════ */}
      {bankDetailAddr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-fx-ink rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-fx-rule">
            {/* header */}
            <div className="flex justify-between items-center p-5 border-b border-fx-rule">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setBankDetailAddr(null)}
                  className="p-1.5 hover:bg-fx-charcoal rounded-lg transition-colors text-fx-dust"
                >
                  <ArrowLeft size={18} />
                </button>
                <div>
                  <h3 className="text-lg font-bold text-fx-sand">
                    {bankDetailAddr.label || 'Account Details'}
                  </h3>
                  <p className="text-xs font-mono text-fx-dust mt-0.5">{bankDetailAddr.addressNo}</p>
                </div>
              </div>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${statusColor(bankDetailAddr.status)}`}>
                {statusLabel(bankDetailAddr.status)}
              </span>
            </div>

            {/* body */}
            <div className="p-5 space-y-5">
              {/* Cooling Period Banner */}
              {bankDetailAddr.status === 'PENDING_ACTIVATION' && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-center">
                  <div className="text-[11px] uppercase tracking-wider text-amber-400/70 font-bold">Activates In</div>
                  <div className="mt-1 text-2xl font-bold font-mono text-amber-400">
                    {formatCountdown(bankDetailAddr.activatesAt)}
                  </div>
                  <div className="mt-1 text-xs text-fx-dust">
                    {new Date(bankDetailAddr.activatesAt).toLocaleString()}
                  </div>
                </div>
              )}

              {/* IBAN Card */}
              <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-4">
                <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">IBAN</label>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <code className="text-sm font-mono text-fx-sand break-all">
                    {bankDetailAddr.iban ? formatIban(bankDetailAddr.iban) : '—'}
                  </code>
                  {bankDetailAddr.iban && (
                    <button
                      onClick={() => copy(bankDetailAddr.iban!)}
                      className="p-2 text-fx-dust hover:text-fx-brass transition-colors shrink-0"
                    >
                      {copied ? <Check size={16} className="text-fx-sage" /> : <Copy size={16} />}
                    </button>
                  )}
                </div>
                {bankDetailAddr.swiftBic && (
                  <div className="mt-3 pt-3 border-t border-fx-rule">
                    <label className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">SWIFT / BIC</label>
                    <div className="mt-1 text-sm font-mono text-fx-sand">{bankDetailAddr.swiftBic}</div>
                  </div>
                )}
              </div>

              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Asset</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{bankDetailAddr.asset.code}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Bank</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{bankDetailAddr.bankName || '—'}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Beneficiary</div>
                  <div className="mt-1 text-sm font-semibold text-fx-sand">{bankDetailAddr.beneficiaryName || '—'}</div>
                </div>
                <div className="rounded-xl bg-fx-charcoal/50 border border-fx-rule p-3">
                  <div className="text-[11px] uppercase tracking-wider text-fx-dust font-bold">Registered</div>
                  <div className="mt-1 text-sm text-fx-sand">
                    {new Date(bankDetailAddr.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>

              {/* Ownership Declaration */}
              {bankDetailAddr.ownershipDeclaredAt && (
                <div className="rounded-xl border border-fx-sage/20 bg-fx-sage/5 p-4 flex items-start gap-3">
                  <ShieldCheck size={18} className="text-fx-sage shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-bold text-fx-sage">Ownership Declared</div>
                    <div className="text-xs text-fx-dust mt-0.5">
                      {new Date(bankDetailAddr.ownershipDeclaredAt).toLocaleString()}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* footer */}
            <div className="p-5 border-t border-fx-rule bg-fx-charcoal/50 rounded-b-2xl">
              <button
                onClick={() => setBankDetailAddr(null)}
                className="w-full py-3 bg-fx-ink border border-fx-rule text-fx-dune font-bold rounded-xl hover:bg-fx-charcoal transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 10: Verify the client builds**

Run:
```bash
cd client-web && npx tsc --noEmit --pretty 2>&1 | head -30
```

Expected: No errors.

- [ ] **Step 11: Commit**

```bash
git add client-web/src/pages/WithdrawalAddresses.tsx
git commit -m "feat: implement bank accounts tab with list, add modal, and detail modal"
```

---

### Task 8: End-to-End Verification

- [ ] **Step 1: Start the backend**

```bash
cd /path/to/Exchange_js && npm run dev:start
```

Wait for all services to start on ports 3500 (API), 3501 (admin), 3502 (client).

- [ ] **Step 2: Apply migration to dev database**

```bash
npx prisma db push
```

Or if using `dev:rebuild`:
```bash
npm run dev:rebuild
```

- [ ] **Step 3: Create a FIAT asset for testing (if none exists)**

Check for existing fiat assets:
```bash
curl -s http://localhost:3500/assets?take=200 | jq '.items[] | select(.type == "FIAT") | {id, code, type, status}'
```

If none exist, create one via admin API (use the admin token from dev seed data).

- [ ] **Step 4: Test the bank account registration endpoint**

```bash
curl -X POST http://localhost:3500/client/withdrawal-addresses/bank-accounts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <customer-jwt>" \
  -d '{
    "assetId": "<fiat-asset-id>",
    "beneficiaryName": "Alice Johnson",
    "bankName": "Emirates NBD",
    "iban": "AE07 0331 2345 6789 0123 456",
    "swiftBic": "EBILAEAD",
    "label": "My Salary Account",
    "ownershipDeclaration": true
  }'
```

Expected: 201 response with created `WithdrawalAddress` including `addressType: 'BANK'`, `status: 'PENDING_ACTIVATION'`, `iban`, `swiftBic`, `bankName` fields populated.

- [ ] **Step 5: Verify the list endpoint returns bank accounts**

```bash
curl -s http://localhost:3500/client/withdrawal-addresses?take=100 \
  -H "Authorization: Bearer <customer-jwt>" | jq '.items[] | {addressNo, addressType, iban, bankName, status}'
```

Expected: Bank account appears in the list with all bank fields.

- [ ] **Step 6: Open the client web and verify the bank tab UI**

Navigate to `http://localhost:3502` → Wallet page → Bank Accounts tab. Verify:
- The bank account card shows with masked IBAN, bank name, asset badge, status
- Clicking the card opens the detail modal with full IBAN, SWIFT/BIC, info grid
- The "+ Add Account" button opens the add modal with all form fields
- The counter shows `(1/3)`

- [ ] **Step 7: Test validation — invalid IBAN**

```bash
curl -X POST http://localhost:3500/client/withdrawal-addresses/bank-accounts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <customer-jwt>" \
  -d '{
    "assetId": "<fiat-asset-id>",
    "beneficiaryName": "Test",
    "bankName": "Test Bank",
    "iban": "XX00INVALID",
    "swiftBic": "EBILAEAD",
    "ownershipDeclaration": true
  }'
```

Expected: 400 error with `INVALID_IBAN` code.

- [ ] **Step 8: Test validation — invalid SWIFT**

```bash
curl -X POST http://localhost:3500/client/withdrawal-addresses/bank-accounts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <customer-jwt>" \
  -d '{
    "assetId": "<fiat-asset-id>",
    "beneficiaryName": "Test",
    "bankName": "Test Bank",
    "iban": "GB82 WEST 1234 5698 7654 32",
    "swiftBic": "BAD",
    "ownershipDeclaration": true
  }'
```

Expected: 400 error with `INVALID_SWIFT_BIC` code.

- [ ] **Step 9: Test validation — crypto asset rejected**

Use a CRYPTO asset ID:
```bash
curl -X POST http://localhost:3500/client/withdrawal-addresses/bank-accounts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <customer-jwt>" \
  -d '{
    "assetId": "<crypto-asset-id>",
    "beneficiaryName": "Test",
    "bankName": "Test Bank",
    "iban": "GB82 WEST 1234 5698 7654 32",
    "swiftBic": "WESTGB2L",
    "ownershipDeclaration": true
  }'
```

Expected: 400 error with `ASSET_NOT_FIAT` code.
