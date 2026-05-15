# TB Manual Account Creation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual TB account creation endpoint and admin UI so operators can create TigerBeetle accounts as a fallback/repair mechanism, with audit logging.

**Architecture:** New `POST /admin/tb/accounts` endpoint on `TbAdminController` validates asset/customer/duplicate, calls `AccountingService.createAccounts()`, writes audit log. Admin frontend adds a "Create Account" button + modal on the TB Account List page.

**Tech Stack:** NestJS, Prisma, TigerBeetle (tigerbeetle-node), React, Tailwind (adm-* tokens)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/modules/accounting/tigerbeetle/dto/create-tb-account.dto.ts` | Request DTO with class-validator |
| Create | `src/modules/accounting/tigerbeetle/tb-manual-account.service.ts` | Manual create logic: validate, create, audit |
| Modify | `src/modules/accounting/tigerbeetle/tb-admin.controller.ts` | Add `POST /admin/tb/accounts` endpoint |
| Modify | `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts` | Register new service as provider |
| Modify | `src/modules/audit-logging/constants/audit-actions.constant.ts` | Add new audit constants |
| Modify | `admin-web/src/pages/TbAccountList.tsx` | Add "Create Account" button + modal |

---

### Task 1: Audit Constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Add the three new audit constants**

Open `src/modules/audit-logging/constants/audit-actions.constant.ts` and add:

1. In `AuditEntityTypes` (after the last entry, currently `APPROVAL_POLICY`):

```typescript
  TB_ACCOUNT: 'TB_ACCOUNT',
```

2. In `AuditBusinessWorkflowTypes` (after `WITHDRAWAL_ADDRESS_REGISTRATION`):

```typescript
  TB_ACCOUNT_MANUAL_CREATE: 'TB_ACCOUNT_MANUAL_CREATE',
```

3. In `AuditActions` (after `SYSTEM_WITHDRAW_APPROVED_ORCHESTRATED`):

```typescript
  MANUAL_TB_ACCOUNT_CREATED: 'MANUAL_TB_ACCOUNT_CREATED',
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd src && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors related to audit constants.

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(tb): add audit constants for manual TB account creation"
```

---

### Task 2: Request DTO

**Files:**
- Create: `src/modules/accounting/tigerbeetle/dto/create-tb-account.dto.ts`

- [ ] **Step 1: Create the DTO file**

Create `src/modules/accounting/tigerbeetle/dto/create-tb-account.dto.ts`:

```typescript
import { IsString, IsInt, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTbAccountDto {
  @ApiProperty({ description: 'Account category', enum: ['SYSTEM', 'CUSTOMER'] })
  @IsString()
  @IsIn(['SYSTEM', 'CUSTOMER'])
  accountCategory!: 'SYSTEM' | 'CUSTOMER';

  @ApiProperty({ description: 'Asset code (must be a provisioned asset with tbLedgerId)' })
  @IsString()
  assetCode!: string;

  @ApiProperty({ description: 'TB account type code (e.g. 1=BANK, 100=CLIENT_CREDIT)' })
  @IsInt()
  code!: number;

  @ApiPropertyOptional({ description: 'Customer No (required when accountCategory=CUSTOMER)' })
  @IsOptional()
  @IsString()
  customerNo?: string;

  @ApiPropertyOptional({ description: 'Optional description/note' })
  @IsOptional()
  @IsString()
  description?: string;
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd src && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounting/tigerbeetle/dto/create-tb-account.dto.ts
git commit -m "feat(tb): add CreateTbAccountDto for manual account creation"
```

---

### Task 3: Manual Account Service

**Files:**
- Create: `src/modules/accounting/tigerbeetle/tb-manual-account.service.ts`

- [ ] **Step 1: Create the service file**

Create `src/modules/accounting/tigerbeetle/tb-manual-account.service.ts`:

```typescript
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { TB_CODE_TO_COA } from './constants/tb-account-codes.constant';
import { CreateTbAccountParams } from './types/accounting.types';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { isCustomerApprovedAndActive } from '../../identity/customer-status.util';
import { AccountFlags } from 'tigerbeetle-node';

const SYSTEM_CODES = new Set([
  TB_ACCOUNT_CODES.BANK,
  TB_ACCOUNT_CODES.CUSTODY,
  TB_ACCOUNT_CODES.TRADE_CLEARING,
  TB_ACCOUNT_CODES.FEE_RECEIVABLE,
]);

const CUSTOMER_CODES = new Set([
  TB_ACCOUNT_CODES.CLIENT_CREDIT,
  TB_ACCOUNT_CODES.CLIENT_AUDIT,
]);

interface ManualCreateInput {
  accountCategory: 'SYSTEM' | 'CUSTOMER';
  assetCode: string;
  code: number;
  customerNo?: string;
  description?: string;
}

interface ActorContext {
  actorId: string;
  actorNo: string;
  actorRole: string;
}

@Injectable()
export class TbManualAccountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accountingService: AccountingService,
    private readonly registryService: TbAccountRegistryService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async manualCreate(input: ManualCreateInput, actor: ActorContext) {
    // 1. Validate code matches category
    const allowedCodes = input.accountCategory === 'SYSTEM' ? SYSTEM_CODES : CUSTOMER_CODES;
    if (!allowedCodes.has(input.code)) {
      throw new BadRequestException({
        code: 'INVALID_CODE_FOR_CATEGORY',
        message: `Account code ${input.code} is not valid for ${input.accountCategory} accounts`,
      });
    }

    // 2. Load and validate asset
    const asset = await this.prisma.asset.findFirst({
      where: { code: input.assetCode },
    });
    if (!asset || asset.tbLedgerId == null) {
      throw new BadRequestException({
        code: 'ASSET_NOT_PROVISIONED',
        message: `Asset '${input.assetCode}' is not provisioned for TigerBeetle`,
      });
    }

    // 3. If CUSTOMER, load and validate customer
    let customer: { id: string; customerNo: string; onboardingStatus: string; adminStatus: string } | null = null;
    if (input.accountCategory === 'CUSTOMER') {
      if (!input.customerNo) {
        throw new BadRequestException({
          code: 'CUSTOMER_NO_REQUIRED',
          message: 'customerNo is required for CUSTOMER accounts',
        });
      }
      customer = await this.prisma.customerMain.findUnique({
        where: { customerNo: input.customerNo },
        select: { id: true, customerNo: true, onboardingStatus: true, adminStatus: true },
      });
      if (!customer) {
        throw new NotFoundException({
          code: 'CUSTOMER_NOT_FOUND',
          message: `Customer '${input.customerNo}' not found`,
        });
      }
      if (!isCustomerApprovedAndActive(customer)) {
        throw new BadRequestException({
          code: 'CUSTOMER_NOT_APPROVED',
          message: `Customer '${input.customerNo}' is not in APPROVED status`,
        });
      }
    }

    // 4. Check for duplicate
    const ownerType = input.accountCategory === 'SYSTEM' ? 'SYSTEM' : 'CUSTOMER';
    const ownerUuid = customer?.id ?? undefined;
    const existing = await this.registryService.resolve({
      code: input.code,
      ledger: asset.tbLedgerId,
      ownerType,
      ownerUuid,
    });
    if (existing) {
      throw new ConflictException({
        code: 'TB_ACCOUNT_DUPLICATE',
        message: 'TB account already exists for this combination',
      });
    }

    // 5. Derive flags
    let flags = 0;
    if (input.code === TB_ACCOUNT_CODES.CLIENT_CREDIT) {
      flags = AccountFlags.debits_must_not_exceed_credits;
    } else if (input.code === TB_ACCOUNT_CODES.FEE_RECEIVABLE) {
      flags = AccountFlags.credits_must_not_exceed_debits;
    }

    // 6. Build params and create
    const codeName = TB_CODE_TO_COA[input.code] || String(input.code);
    const params: CreateTbAccountParams = {
      code: input.code,
      ledger: asset.tbLedgerId,
      ownerType,
      ownerUuid,
      ownerNo: customer?.customerNo,
      assetCode: input.assetCode,
      description: input.description || `Manual: ${codeName} for ${input.assetCode}`,
      flags,
    };

    await this.accountingService.createAccounts([params]);

    // 7. Find the created registry entry (just registered by createAccounts)
    const created = await this.registryService.resolve({
      code: input.code,
      ledger: asset.tbLedgerId,
      ownerType,
      ownerUuid,
    });

    // 8. Audit log
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.MANUAL_TB_ACCOUNT_CREATED,
        entityType: AuditEntityTypes.TB_ACCOUNT,
        entityId: created?.tbAccountId,
        workflowType: AuditBusinessWorkflowTypes.TB_ACCOUNT_MANUAL_CREATE,
        result: AuditResult.SUCCESS,
        metadata: {
          accountCategory: input.accountCategory,
          assetCode: input.assetCode,
          code: input.code,
          codeName,
          customerNo: customer?.customerNo || null,
          tbAccountId: created?.tbAccountId || null,
        },
      },
      {
        actorType: 'ADMIN',
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole,
      },
    );

    return created;
  }
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd src && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No errors (the service isn't registered yet, but the file itself should compile).

- [ ] **Step 3: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tb-manual-account.service.ts
git commit -m "feat(tb): add TbManualAccountService for manual account creation with audit"
```

---

### Task 4: Register Service & Add Controller Endpoint

**Files:**
- Modify: `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`
- Modify: `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`

- [ ] **Step 1: Register `TbManualAccountService` in the module**

In `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`, add the import and register as provider:

Add to imports at top:
```typescript
import { TbManualAccountService } from './tb-manual-account.service';
```

Add `TbManualAccountService` to the `providers` array (after `TbAccountRegistryService`):
```typescript
  providers: [
    TigerBeetleService,
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
  ],
```

Also add to `exports` array:
```typescript
  exports: [
    AccountingService,
    TbEvidenceService,
    TbAccountRegistryService,
    TbManualAccountService,
  ],
```

- [ ] **Step 2: Add `POST /admin/tb/accounts` endpoint**

In `src/modules/accounting/tigerbeetle/tb-admin.controller.ts`:

Add imports at top:
```typescript
import { Controller, Get, Post, Body, Request, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { TbManualAccountService } from './tb-manual-account.service';
import { CreateTbAccountDto } from './dto/create-tb-account.dto';
```

Update the existing import from `@nestjs/common` — replace the single `import { Controller, Get, NotFoundException, Param, Query, UseGuards }` line with the expanded version above.

Add `TbManualAccountService` to the constructor:
```typescript
  constructor(
    private readonly tbAccountRegistryService: TbAccountRegistryService,
    private readonly tbEvidenceService: TbEvidenceService,
    private readonly accountingService: AccountingService,
    private readonly tbManualAccountService: TbManualAccountService,
  ) {}
```

Add the POST endpoint **before** the first `@Get('accounts')` method (so POST comes before GET):
```typescript
  @Post('accounts')
  @ApiOperation({ summary: 'Manually create a TB account (system or customer)' })
  async createAccount(@Request() req: any, @Body() dto: CreateTbAccountDto) {
    return this.tbManualAccountService.manualCreate(
      {
        accountCategory: dto.accountCategory,
        assetCode: dto.assetCode,
        code: dto.code,
        customerNo: dto.customerNo,
        description: dto.description,
      },
      {
        actorId: req.user.userId,
        actorNo: req.user.userNo,
        actorRole: req.user.role || 'ADMIN',
      },
    );
  }
```

- [ ] **Step 3: Build and verify**

Run: `npm run build 2>&1 | tail -5`
Expected: Successful build with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/accounting/tigerbeetle/tigerbeetle.module.ts src/modules/accounting/tigerbeetle/tb-admin.controller.ts
git commit -m "feat(tb): wire POST /admin/tb/accounts endpoint for manual account creation"
```

---

### Task 5: Backend Integration Test

**Files:**
- None (manual API testing via curl)

- [ ] **Step 1: Start the backend**

```bash
npm run dev:start
```

Wait for startup. If port 3500 is occupied, run `lsof -ti:3500 | xargs kill -9` first.

- [ ] **Step 2: Get an admin JWT token**

```bash
curl -s -X POST http://localhost:3500/admin/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin@exchange.local","password":"admin123"}' | jq -r '.access_token'
```

Store the returned token in a variable:
```bash
TOKEN="<paste token here>"
```

- [ ] **Step 3: Test validation — invalid code for category**

```bash
curl -s -X POST http://localhost:3500/admin/tb/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"accountCategory":"SYSTEM","assetCode":"AED","code":100}' | jq
```

Expected: 400 with `INVALID_CODE_FOR_CATEGORY`.

- [ ] **Step 4: Test validation — asset not provisioned**

```bash
curl -s -X POST http://localhost:3500/admin/tb/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"accountCategory":"SYSTEM","assetCode":"NONEXISTENT","code":1}' | jq
```

Expected: 400 with `ASSET_NOT_PROVISIONED`.

- [ ] **Step 5: Test validation — customer not found**

```bash
curl -s -X POST http://localhost:3500/admin/tb/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"accountCategory":"CUSTOMER","assetCode":"AED","code":100,"customerNo":"CU_FAKE"}' | jq
```

Expected: 404 with `CUSTOMER_NOT_FOUND`.

- [ ] **Step 6: Test success — create a system account**

Pick an asset code and account type that doesn't already exist. Check existing accounts first:

```bash
curl -s "http://localhost:3500/admin/tb/accounts?assetCode=AED&ownerType=SYSTEM" \
  -H "Authorization: Bearer $TOKEN" | jq '.items[].code'
```

If code `101` (CLIENT_AUDIT for SYSTEM doesn't make sense), skip. Instead verify the duplicate check:

```bash
curl -s -X POST http://localhost:3500/admin/tb/accounts \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"accountCategory":"SYSTEM","assetCode":"AED","code":1}' | jq
```

Expected: 409 with `TB_ACCOUNT_DUPLICATE` (BANK for AED already exists from provisioning).

- [ ] **Step 7: Commit (no code changes — test pass confirmation)**

No commit needed for this task. Proceed to frontend.

---

### Task 6: Admin Frontend — Create Account Modal

**Files:**
- Modify: `admin-web/src/pages/TbAccountList.tsx`

- [ ] **Step 1: Add the Create Account button and modal to TbAccountList**

Open `admin-web/src/pages/TbAccountList.tsx` and make the following changes:

**a) Add imports at top** — add `Plus` to lucide-react import, and add `adminButtonClass` and `getApiErrorMessage`:

Replace the existing import line:
```typescript
import { RefreshCw } from 'lucide-react';
```
with:
```typescript
import { Plus, RefreshCw, X } from 'lucide-react';
```

Add to the adminButtonStyles import:
```typescript
import {
  adminButtonClass,
  adminIconButtonClass,
} from '../components/common/adminButtonStyles';
```

**b) Add code-to-label constants and category-filtered options** — insert these constants after the existing imports and before `const DEFAULT_FILTERS`:

```typescript
const SYSTEM_CODE_OPTIONS = [
  { value: 1, label: '1 · BANK' },
  { value: 10, label: '10 · CUSTODY' },
  { value: 110, label: '110 · TRADE_CLEARING' },
  { value: 120, label: '120 · FEE_RECEIVABLE' },
];

const CUSTOMER_CODE_OPTIONS = [
  { value: 100, label: '100 · CLIENT_CREDIT' },
  { value: 101, label: '101 · CLIENT_AUDIT' },
];

interface CreateForm {
  accountCategory: 'SYSTEM' | 'CUSTOMER';
  assetCode: string;
  code: number | '';
  customerNo: string;
  description: string;
}

const EMPTY_FORM: CreateForm = {
  accountCategory: 'SYSTEM',
  assetCode: '',
  code: '',
  customerNo: '',
  description: '',
};

interface AssetOption {
  code: string;
  type: string;
}
```

**c) Add state hooks inside the component** — insert after `const navigate = useNavigate();`:

```typescript
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>(EMPTY_FORM);
  const [assets, setAssets] = useState<AssetOption[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
```

**d) Add asset fetcher** — insert after the `fetchData` function:

```typescript
  const fetchAssets = async () => {
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/assets?take=100`,
      );
      if (!res.ok) return;
      const data = await res.json();
      const provisioned = (data.items ?? data ?? []).filter(
        (a: any) => a.tbLedgerId != null,
      );
      setAssets(provisioned.map((a: any) => ({ code: a.code, type: a.type })));
    } catch {
      /* ignore */
    }
  };
```

**e) Add open/close/submit handlers** — insert after `fetchAssets`:

```typescript
  const openCreate = () => {
    setForm(EMPTY_FORM);
    setCreateError(null);
    void fetchAssets();
    setShowCreate(true);
  };

  const closeCreate = () => {
    setShowCreate(false);
    setCreateError(null);
  };

  const handleCategoryChange = (cat: 'SYSTEM' | 'CUSTOMER') => {
    setForm((prev) => ({ ...prev, accountCategory: cat, code: '', customerNo: '' }));
  };

  const canSubmit =
    form.assetCode !== '' &&
    form.code !== '' &&
    (form.accountCategory === 'SYSTEM' || form.customerNo.trim() !== '');

  const handleCreate = async () => {
    if (!canSubmit) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/tb/accounts`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accountCategory: form.accountCategory,
            assetCode: form.assetCode,
            code: Number(form.code),
            customerNo: form.accountCategory === 'CUSTOMER' ? form.customerNo.trim() : undefined,
            description: form.description.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const msg = await getApiErrorMessage(res, 'Failed to create TB account.');
        setCreateError(msg);
        return;
      }
      closeCreate();
      void fetchData();
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setCreateError(err instanceof Error ? err.message : 'Failed to create TB account.');
    } finally {
      setCreating(false);
    }
  };
```

**f) Add the "Create Account" button** — in the `PageTitleBar` children, add a button **before** the Refresh button:

```tsx
        <button
          onClick={openCreate}
          className={adminButtonClass('listPrimary')}
        >
          <Plus size={13} />
          Create Account
        </button>
```

**g) Add the modal JSX** — insert right before the closing `</div>` of the root container (before the very last `</div>`):

```tsx
      {/* ── Create Account Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[480px] rounded-lg border border-adm-border bg-adm-bg shadow-xl">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border px-5 py-3">
              <h3 className="font-mono text-sm font-semibold text-adm-t1">Create TB Account</h3>
              <button onClick={closeCreate} className="text-adm-t3 hover:text-adm-t1 transition-colors">
                <X size={16} />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-4 px-5 py-4">
              {/* Account Category */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Account Category
                </label>
                <div className="flex gap-3">
                  {(['SYSTEM', 'CUSTOMER'] as const).map((cat) => (
                    <label key={cat} className="flex cursor-pointer items-center gap-1.5 font-mono text-[11px] text-adm-t1">
                      <input
                        type="radio"
                        name="accountCategory"
                        checked={form.accountCategory === cat}
                        onChange={() => handleCategoryChange(cat)}
                        className="accent-adm-amber"
                      />
                      {cat === 'SYSTEM' ? 'System Account' : 'Customer Account'}
                    </label>
                  ))}
                </div>
              </div>

              {/* Asset */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Asset
                </label>
                <select
                  value={form.assetCode}
                  onChange={(e) => setForm((p) => ({ ...p, assetCode: e.target.value }))}
                  className={`${fi} w-full`}
                >
                  <option value="">Select asset…</option>
                  {assets.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} ({a.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Account Type */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Account Type
                </label>
                <select
                  value={form.code}
                  onChange={(e) => setForm((p) => ({ ...p, code: e.target.value ? Number(e.target.value) : '' }))}
                  className={`${fi} w-full`}
                >
                  <option value="">Select type…</option>
                  {(form.accountCategory === 'SYSTEM' ? SYSTEM_CODE_OPTIONS : CUSTOMER_CODE_OPTIONS).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>

              {/* Customer No (only for CUSTOMER) */}
              {form.accountCategory === 'CUSTOMER' && (
                <div>
                  <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                    Customer No
                  </label>
                  <input
                    value={form.customerNo}
                    onChange={(e) => setForm((p) => ({ ...p, customerNo: e.target.value }))}
                    placeholder="e.g. CU2605140001"
                    className={`${fi} w-full`}
                  />
                </div>
              )}

              {/* Description */}
              <div>
                <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-wider text-adm-t3">
                  Description <span className="font-normal text-adm-t3">(optional)</span>
                </label>
                <input
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="Optional note…"
                  className={`${fi} w-full`}
                />
              </div>

              {/* Error */}
              {createError && (
                <div className="rounded border border-adm-red/20 bg-adm-red/6 px-3 py-2 font-mono text-[11px] text-adm-red">
                  {createError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 border-t border-adm-border px-5 py-3">
              <button onClick={closeCreate} className={adminButtonClass('listSecondary')}>
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!canSubmit || creating}
                className={adminButtonClass('listPrimary')}
              >
                {creating ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 2: Verify frontend builds**

Run: `cd admin-web && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: No TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/TbAccountList.tsx
git commit -m "feat(admin): add Create Account button and modal to TB Account List page"
```

---

### Task 7: Visual Verification

**Files:**
- None (manual UI testing)

- [ ] **Step 1: Start the admin frontend**

```bash
cd admin-web && npm run dev -- --port 3501
```

- [ ] **Step 2: Navigate to TB Accounts page**

Open `http://localhost:3501` in browser, login as admin, navigate to TB Accounts (under Ledger section). The path should be `/ledger/tb-accounts`.

- [ ] **Step 3: Verify the "Create Account" button appears**

The button should appear in the title bar next to the Refresh icon.

- [ ] **Step 4: Click "Create Account" and verify modal**

Verify:
- Modal opens with Account Category radio (System/Customer)
- Asset dropdown loads provisioned assets (AED, USDT, etc.)
- Account Type dropdown shows SYSTEM codes (BANK, CUSTODY, TRADE_CLEARING, FEE_RECEIVABLE) by default
- Switching to "Customer Account" shows CUSTOMER codes (CLIENT_CREDIT, CLIENT_AUDIT) and reveals Customer No input
- Cancel closes modal

- [ ] **Step 5: Test duplicate error**

Select "System Account", asset "AED", type "BANK" (code 1) → Submit.
Expected: Red error "TB account already exists for this combination" (BANK for AED already exists).

- [ ] **Step 6: Test customer not found**

Select "Customer Account", asset "AED", type "CLIENT_CREDIT", Customer No = "CU_FAKE" → Submit.
Expected: Red error "Customer 'CU_FAKE' not found".

- [ ] **Step 7: No commit needed — visual verification only**

---

### Task 8: Final Build & Commit

- [ ] **Step 1: Run full backend build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Successful build.

- [ ] **Step 2: Run frontend build**

```bash
cd admin-web && npm run build 2>&1 | tail -5
```

Expected: Successful build.

- [ ] **Step 3: Final commit if any remaining changes**

If there are uncommitted fixes from testing:
```bash
git add -A
git commit -m "fix(tb): address review feedback from manual account creation"
```

Documentation updated: TB Manual Account Creation implementation plan written.
