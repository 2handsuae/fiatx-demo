# Client Withdrawal Page Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix client-side withdrawal page (Withdraw.tsx) to use correct backend endpoints and split the backend controller to enforce admin-only security on sensitive routes.

**Architecture:** Backend-first — create the new customer controller and lock down the admin controller, then fix the client to call the new endpoints. This order ensures the client never calls a non-existent route during development.

**Tech Stack:** NestJS (controller, guards, DTOs), React (Withdraw.tsx page)

---

## File Map

| # | File | Op | Responsibility |
|---|---|---|---|
| 1 | `src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts` | Create | Customer-facing POST/GET for withdrawals |
| 2 | `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts` | Modify | Admin-only: remove customer routes, add type checks |
| 3 | `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts` | Modify | Register new controller |
| 4 | `client-web/src/pages/Withdraw.tsx` | Modify | Fix all API URLs, interfaces, field refs, UI |

---

### Task 1: Create CustomerWithdrawController

**Files:**
- Create: `src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts`

- [ ] **Step 1: Create the customer controller file**

Create `src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts` with this content:

```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  UsePipes,
  ValidationPipe,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { WithdrawTransactionsService } from './withdraw-transactions.service';
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
import {
  WithdrawTransactionQueryDto,
  CreateWithdrawTransactionDto,
} from './dto/withdraw-transaction.dto';

@ApiTags('Client Withdraw Transactions')
@ApiBearerAuth()
@Controller('client/withdraw-transactions')
@UseGuards(AuthGuard('jwt'))
export class CustomerWithdrawController {
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly onboardingService: OnboardingService,
  ) {}

  private assertCustomer(req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId;
  }

  @Post()
  @ApiOperation({ summary: 'Create a withdrawal request (customer)' })
  async create(@Req() req: any, @Body() dto: CreateWithdrawTransactionDto) {
    const userId = this.assertCustomer(req);
    await this.onboardingService.assertTradingEligibility(userId, 'WITHDRAW');
    return this.service.create(dto, userId);
  }

  @Get()
  @ApiOperation({ summary: 'List my withdraw transactions (customer)' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    const userId = this.assertCustomer(req);
    return this.service.findAll({ ...query, ownerId: userId });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get my withdraw transaction detail (customer)' })
  async findOne(@Req() req: any, @Param('id') id: string) {
    const userId = this.assertCustomer(req);
    const item = await this.service.findOneInternal(id);
    if (item.ownerId !== userId) {
      throw new ForbiddenException('Not your withdrawal');
    }
    return item;
  }
}
```

- [ ] **Step 2: Verify file compiles**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors related to `customer-withdraw.controller.ts` (module not yet wired, so the file just needs to be syntactically valid and import paths correct).

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts
git commit -m "feat(withdraw): add CustomerWithdrawController at /client/withdraw-transactions"
```

---

### Task 2: Lock Down Admin Controller + Wire Module

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts`
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`

- [ ] **Step 1: Remove customer routes from admin controller and add admin type checks**

In `src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts`:

**1a.** Add `ForbiddenException` to the `@nestjs/common` import:

Replace:
```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
} from '@nestjs/common';
```
With:
```typescript
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Patch,
  UsePipes,
  ValidationPipe,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
```

**1b.** Remove `OnboardingService` import and constructor injection (no longer needed — customer create moved to new controller):

Remove this import line:
```typescript
import { OnboardingService } from '../../identity/onboarding/onboarding.service';
```

Remove `OnboardingService` from constructor:
```typescript
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly onboardingService: OnboardingService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
```
Replace with:
```typescript
  constructor(
    private readonly service: WithdrawTransactionsService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
```

**1c.** Remove `CreateWithdrawTransactionDto` from the DTO import:

Replace:
```typescript
import { 
  WithdrawTransactionQueryDto,
  AdminUpdateWithdrawTransactionStatusDto,
  WithdrawTransactionAction,
  CreateWithdrawTransactionDto 
} from './dto/withdraw-transaction.dto';
```
With:
```typescript
import { 
  WithdrawTransactionQueryDto,
  AdminUpdateWithdrawTransactionStatusDto,
  WithdrawTransactionAction,
} from './dto/withdraw-transaction.dto';
```

**1d.** Delete the entire `findMy` method (lines 45-51):
```typescript
  @Get('my')
  @ApiOperation({ summary: 'List my withdraw transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findMy(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    const userId = req.user.userId;
    return this.service.findAll({ ...query, ownerId: userId });
  }
```

**1e.** Delete the entire `create` method (lines 60-66):
```typescript
  @Post()
  @ApiOperation({ summary: 'Create a withdrawal request' })
  async create(@Req() req: any, @Body() dto: CreateWithdrawTransactionDto) {
    const userId = req.user.userId;
    await this.onboardingService.assertTradingEligibility(userId, 'WITHDRAW');
    return this.service.create(dto, userId);
  }
```

**1f.** Add admin type guard helper and apply to remaining handlers. Add this private method to the class:

```typescript
  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin only');
    }
  }
```

Add `this.assertAdmin(req)` as the first line in each of these methods:
- `findAll` — add `@Req() req: any` parameter, then `this.assertAdmin(req);`
- `findOne` — add `@Req() req: any` parameter, then `this.assertAdmin(req);`
- `createMock` — add `@Req() req: any` parameter, then `this.assertAdmin(req);`
- `updateStatus` — already has `@Req() req: any`, just add `this.assertAdmin(req);`
- `simulateKytPhase1` — add `@Req() req: any` parameter, then `this.assertAdmin(req);`
- `simulateTravelRule` — add `@Req() req: any` parameter, then `this.assertAdmin(req);`
- `simulatePayoutConfirmed` — add `@Req() req: any` parameter, then `this.assertAdmin(req);`

The resulting `findAll` should look like:
```typescript
  @Get()
  @ApiOperation({ summary: 'List withdraw transactions' })
  @UsePipes(new ValidationPipe({ transform: true }))
  findAll(@Req() req: any, @Query() query: WithdrawTransactionQueryDto) {
    this.assertAdmin(req);
    return this.service.findAll(query);
  }
```

The resulting `findOne` should look like:
```typescript
  @Get(':id')
  @ApiOperation({ summary: 'Get withdraw transaction details' })
  findOne(@Req() req: any, @Param('id') id: string) {
    this.assertAdmin(req);
    return this.service.findOne(id);
  }
```

The resulting `createMock` should look like:
```typescript
  @Post('mock')
  @ApiOperation({ summary: 'Create 10 mock withdraw transactions' })
  createMock(@Req() req: any) {
    this.assertAdmin(req);
    return this.service.createMockData();
  }
```

- [ ] **Step 2: Register new controller in module**

In `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`:

Add import:
```typescript
import { CustomerWithdrawController } from './customer-withdraw.controller';
```

Update controllers array:
```typescript
  controllers: [WithdrawTransactionsController, CustomerWithdrawController],
```

Also add `OnboardingModule` is already imported (verify it's there — it is at line 5). No change needed.

- [ ] **Step 3: Verify compilation**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`

Expected: No errors.

- [ ] **Step 4: Verify backend starts**

Run: `cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run dev:start`

Wait for startup, then test:

```bash
# Customer can call new endpoints
TOKEN=$(curl -s http://localhost:3500/auth/login -H 'Content-Type: application/json' -d '{"email":"shawn@fiatx.com","password":"Pass1234!"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# New customer list endpoint
curl -s http://localhost:3500/client/withdraw-transactions -H "Authorization: Bearer $TOKEN" | head -c 200

# Admin endpoints reject customer token
curl -s -o /dev/null -w '%{http_code}' http://localhost:3500/withdraw-transactions -H "Authorization: Bearer $TOKEN"
# Expected: 403

curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3500/withdraw-transactions/mock -H "Authorization: Bearer $TOKEN"
# Expected: 403
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/trading/withdraw-transactions/withdraw-transactions.controller.ts src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts
git commit -m "refactor(withdraw): lock admin controller, wire CustomerWithdrawController in module"
```

---

### Task 3: Fix Withdraw.tsx — Interfaces and State

**Files:**
- Modify: `client-web/src/pages/Withdraw.tsx`

This task updates the TypeScript interfaces and state variables. No API calls change yet.

- [ ] **Step 1: Replace AssetBalance interface**

In `client-web/src/pages/Withdraw.tsx`, replace lines 21-27:

```typescript
interface AssetBalance {
  assetId: string;
  assetCode: string;
  clientCredit: number;
  lockedBalance: number;
  assetDecimals?: number;
}
```

With:

```typescript
interface AssetBalance {
  assetId: string;
  assetCode: string;
  assetType: string;
  currency: string;
  available: string;
  locked: string;
  decimals: number;
}
```

- [ ] **Step 2: Replace WalletItem interface**

Replace lines 29-41:

```typescript
interface WalletItem {
  id: string;
  type: string;
  direction: string;
  asset: { id: string; code: string; type: string; decimals?: number };
  address?: string;
  memo?: string;
  bankName?: string;
  bankAccount?: string;
  iban?: string;
  accountName?: string;
  beneficiaryName?: string;
}
```

With:

```typescript
interface WithdrawalAddressItem {
  id: string;
  addressNo: string;
  assetId: string;
  address: string;
  addressType: string;
  label?: string;
  beneficiaryName?: string;
  memo?: string;
  iban?: string;
  bankName?: string;
  status: string;
  asset: { id: string; code: string; type: string; decimals?: number };
}
```

- [ ] **Step 3: Update state variables**

Replace line 83:
```typescript
  const [wallets, setWallets] = useState<WalletItem[]>([]);
```
With:
```typescript
  const [addresses, setAddresses] = useState<WithdrawalAddressItem[]>([]);
```

Replace line 86:
```typescript
  const [selectedWalletId, setSelectedWalletId] = useState('');
```
With:
```typescript
  const [selectedAddressNo, setSelectedAddressNo] = useState('');
```

Add after line 94 (after `quoteError` state):
```typescript
  const [balanceError, setBalanceError] = useState<string | null>(null);
```

- [ ] **Step 4: Commit**

```bash
git add client-web/src/pages/Withdraw.tsx
git commit -m "refactor(withdraw-ui): update interfaces and state for WithdrawalAddress model"
```

---

### Task 4: Fix Withdraw.tsx — API Calls and Data Flow

**Files:**
- Modify: `client-web/src/pages/Withdraw.tsx`

- [ ] **Step 1: Fix balance fetch (initial load)**

Replace the balance fetch block (around line 122-129):

```typescript
        // Fetch Balances
        const balancesResponse = await customerFetch(
          `${import.meta.env.VITE_API_URL}/treasury/customer/${user.id}/assets`,
        );
        if (balancesResponse.ok) {
          const data = await balancesResponse.json();
          setBalances(data);
        }
```

With:

```typescript
        // Fetch Balances
        const balancesResponse = await customerFetch(
          `${import.meta.env.VITE_API_URL}/client/portfolio/balances`,
        );
        if (balancesResponse.ok) {
          const data = await balancesResponse.json();
          setBalances(data);
          setBalanceError(null);
        } else {
          setBalanceError('Failed to load balances');
        }
```

Also update the catch block (around line 130-134) to add `setBalanceError`:

Replace:
```typescript
      } catch (error: unknown) {
        if (error instanceof CustomerSessionError) {
          return;
        }
        console.error('Failed to fetch data', error);
      } finally {
```
With:
```typescript
      } catch (error: unknown) {
        if (error instanceof CustomerSessionError) {
          return;
        }
        console.error('Failed to fetch data', error);
        setBalanceError('Failed to load balances');
      } finally {
```

- [ ] **Step 2: Fix address fetch**

Replace the wallet fetch useEffect body (around lines 149-178). Replace the params and URL:

```typescript
        const params = new URLSearchParams({
            ownerType: 'CUSTOMER',
            ownerId: user.id,
            direction: 'OUTBOUND',
            walletRole: 'GENERAL',
            assetId: selectedAssetId
        });
        const response = await customerFetch(
          `${import.meta.env.VITE_API_URL}/wallets?${params.toString()}`,
        );

        if (response.ok) {
            const data = await response.json();
            setWallets(data.items || []);
        }
```

With:

```typescript
        const params = new URLSearchParams({
            assetId: selectedAssetId,
            status: 'ACTIVE',
        });
        const response = await customerFetch(
          `${import.meta.env.VITE_API_URL}/client/withdrawal-addresses?${params.toString()}`,
        );

        if (response.ok) {
            const data = await response.json();
            setAddresses(data.items || []);
        }
```

Also update the early return that clears state in the same useEffect (around line 145):
```typescript
        setWallets([]);
```
With:
```typescript
        setAddresses([]);
```

And the catch block:
```typescript
        console.error('Failed to fetch wallets', error);
```
With:
```typescript
        console.error('Failed to fetch addresses', error);
```

And the useEffect dependency array (around line 179):
```typescript
  }, [user, activeTab, selectedAssetId]);
```
(No change needed — deps are the same.)

- [ ] **Step 3: Fix balance field reference**

Replace line 218:
```typescript
  const availableBalance = selectedBalance ? selectedBalance.clientCredit : 0;
```
With:
```typescript
  const availableBalance = selectedBalance ? parseFloat(selectedBalance.available) : 0;
```

- [ ] **Step 4: Fix create withdrawal payload and URL**

Replace lines 320-336:

```typescript
      const wallet = wallets.find(w => w.id === selectedWalletId);
      const asset = selectedAsset;

      const payload = {
          assetId: selectedAssetId,
          amount: withdrawAmount,
          toWalletId: isManualInput ? undefined : selectedWalletId,
          toAddress: isManualInput ? (asset?.type === 'CRYPTO' ? manualAddress : undefined) : wallet?.address,
          toIban: isManualInput ? (asset?.type === 'FIAT' ? manualAddress : undefined) : wallet?.iban,
          quoteId: quote.quoteId,
      };

        const response = await customerFetch(`${import.meta.env.VITE_API_URL}/withdraw-transactions`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
```

With:

```typescript
      const selectedAddr = addresses.find(a => a.addressNo === selectedAddressNo);
      const asset = selectedAsset;

      const payload = {
          assetId: selectedAssetId,
          amount: withdrawAmount,
          toAddress: isManualInput ? (asset?.type === 'CRYPTO' ? manualAddress : undefined) : selectedAddr?.address,
          toIban: isManualInput ? (asset?.type === 'FIAT' ? manualAddress : undefined) : selectedAddr?.iban,
          quoteId: quote.quoteId,
      };

        const response = await customerFetch(`${import.meta.env.VITE_API_URL}/client/withdraw-transactions`, {
            method: 'POST',
            body: JSON.stringify(payload)
        });
```

- [ ] **Step 5: Fix post-create state reset and balance refresh**

Replace the success block (around lines 339-352):

```typescript
            setSelectedWalletId('');
```
With:
```typescript
            setSelectedAddressNo('');
```

And the balance refresh URL:
```typescript
            const balancesResponse = await customerFetch(
              `${import.meta.env.VITE_API_URL}/treasury/customer/${user?.id}/assets`,
            );
```
With:
```typescript
            const balancesResponse = await customerFetch(
              `${import.meta.env.VITE_API_URL}/client/portfolio/balances`,
            );
```

- [ ] **Step 6: Fix history fetch URL**

Replace the history fetch URL (around line 200):
```typescript
          const response = await customerFetch(
              `${import.meta.env.VITE_API_URL}/withdraw-transactions/my?${params.toString()}`,
          );
```
With:
```typescript
          const response = await customerFetch(
              `${import.meta.env.VITE_API_URL}/client/withdraw-transactions?${params.toString()}`,
          );
```

- [ ] **Step 7: Fix derived variables and useEffect deps**

Replace line 380:
```typescript
  const filteredWallets = wallets; // Now filtered by API
  const destinationReady = isManualInput ? Boolean(manualAddress) : Boolean(selectedWalletId);
```
With:
```typescript
  const filteredAddresses = addresses;
  const destinationReady = isManualInput ? Boolean(manualAddress) : Boolean(selectedAddressNo);
```

Replace useEffect deps at line 386:
```typescript
  }, [selectedAssetId, amount, selectedWalletId, manualAddress, isManualInput]);
```
With:
```typescript
  }, [selectedAssetId, amount, selectedAddressNo, manualAddress, isManualInput]);
```

- [ ] **Step 8: Commit**

```bash
git add client-web/src/pages/Withdraw.tsx
git commit -m "fix(withdraw-ui): switch to correct API endpoints and field mappings"
```

---

### Task 5: Fix Withdraw.tsx — UI Rendering

**Files:**
- Modify: `client-web/src/pages/Withdraw.tsx`

- [ ] **Step 1: Fix tab switch resets**

Replace all `setSelectedWalletId('')` with `setSelectedAddressNo('')` in the tab switch handlers.

At line 460 (crypto tab onClick):
```typescript
                setSelectedWalletId('');
```
→
```typescript
                setSelectedAddressNo('');
```

At line 479 (fiat tab onClick):
```typescript
                setSelectedWalletId('');
```
→
```typescript
                setSelectedAddressNo('');
```

At line 648 (asset select onChange):
```typescript
                onChange={(e) => { setSelectedAssetId(e.target.value); setSelectedWalletId(''); }}
```
→
```typescript
                onChange={(e) => { setSelectedAssetId(e.target.value); setSelectedAddressNo(''); }}
```

At line 682 (manual/saved toggle):
```typescript
                        onClick={() => { setIsManualInput(!isManualInput); setSelectedWalletId(''); setManualAddress(''); }}
```
→
```typescript
                        onClick={() => { setIsManualInput(!isManualInput); setSelectedAddressNo(''); setManualAddress(''); }}
```

- [ ] **Step 2: Fix address dropdown**

Replace the saved-address dropdown block (around lines 698-711):

```typescript
                                ) : filteredWallets.length > 0 ? (
                                    <select
                                        required
                                        value={selectedWalletId}
                                        onChange={(e) => setSelectedWalletId(e.target.value)}
                                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                                    >
                                        <option value="">Select an address...</option>
                                        {filteredWallets.map(w => (
                                            <option key={w.id} value={w.id}>
                                                {activeTab === 'crypto' ? w.address : `${w.bankName} - ${w.iban || w.bankAccount}`}
                                            </option>
                                        ))}
                                    </select>
```

With:

```typescript
                                ) : filteredAddresses.length > 0 ? (
                                    <select
                                        required
                                        value={selectedAddressNo}
                                        onChange={(e) => setSelectedAddressNo(e.target.value)}
                                        className="w-full px-4 py-3 border border-slate-200 dark:border-slate-600 rounded-xl focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 bg-white dark:bg-slate-700 text-gray-900 dark:text-white"
                                    >
                                        <option value="">Select an address...</option>
                                        {filteredAddresses.map(a => (
                                            <option key={a.addressNo} value={a.addressNo}>
                                                {activeTab === 'crypto'
                                                  ? (a.label ? `${a.label} (${a.address})` : a.address)
                                                  : `${a.bankName} - ${a.iban}`}
                                            </option>
                                        ))}
                                    </select>
```

- [ ] **Step 3: Fix empty-state navigation link**

Replace line 719:
```typescript
                                                onClick={() => navigate('/wallet')}
```
With:
```typescript
                                                onClick={() => navigate('/withdrawal-addresses')}
```

- [ ] **Step 4: Add balance error banner**

Before the Amount input section (around line 730, before `<label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Amount</label>`), add the error banner:

```tsx
                        {balanceError && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
                                <AlertTriangle size={16} />
                                {balanceError}
                            </div>
                        )}
```

- [ ] **Step 5: Fix confirmation modal destination display**

Replace lines 1004-1005:
```typescript
                              <span className="max-w-[240px] truncate text-right font-medium text-gray-900 dark:text-white" title={manualAddress || selectedWalletId}>
                                  {isManualInput ? manualAddress : wallets.find((wallet) => wallet.id === selectedWalletId)?.address || wallets.find((wallet) => wallet.id === selectedWalletId)?.iban || 'Saved destination'}
```
With:
```typescript
                              <span className="max-w-[240px] truncate text-right font-medium text-gray-900 dark:text-white" title={manualAddress || selectedAddressNo}>
                                  {isManualInput ? manualAddress : addresses.find(a => a.addressNo === selectedAddressNo)?.address || addresses.find(a => a.addressNo === selectedAddressNo)?.iban || 'Saved destination'}
```

- [ ] **Step 6: Commit**

```bash
git add client-web/src/pages/Withdraw.tsx
git commit -m "fix(withdraw-ui): update all UI references to use WithdrawalAddress model"
```

---

### Task 6: End-to-End Verification

**Files:**
- None (testing only)

- [ ] **Step 1: Ensure backend is running**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
# Kill any lingering processes
lsof -ti:3500,3501,3502 | xargs kill -9 2>/dev/null
npm run dev:start
```

Wait for all services to start on ports 3500, 3501, 3502.

- [ ] **Step 2: Test customer API endpoints**

```bash
# Get customer token
TOKEN=$(curl -s http://localhost:3500/auth/login -H 'Content-Type: application/json' -d '{"email":"shawn@fiatx.com","password":"Pass1234!"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# 1. Balance endpoint (should return array with available/locked fields)
curl -s http://localhost:3500/client/portfolio/balances -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20

# 2. Withdrawal addresses (should return {items:[], total:N})
curl -s "http://localhost:3500/client/withdrawal-addresses?status=ACTIVE" -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20

# 3. Customer withdraw list (should return {items:[], total:N})
curl -s http://localhost:3500/client/withdraw-transactions -H "Authorization: Bearer $TOKEN" | python3 -m json.tool | head -20
```

Expected: All three return 200 with proper JSON.

- [ ] **Step 3: Test admin endpoint security**

```bash
# Customer token should be REJECTED on admin endpoints
curl -s -o /dev/null -w '%{http_code}' http://localhost:3500/withdraw-transactions -H "Authorization: Bearer $TOKEN"
# Expected: 403

curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3500/withdraw-transactions/mock -H "Authorization: Bearer $TOKEN"
# Expected: 403

curl -s -o /dev/null -w '%{http_code}' -X PATCH http://localhost:3500/withdraw-transactions/fake-id/status -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"action":"check"}'
# Expected: 403

curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3500/withdraw-transactions/fake-id/simulate/kyt-phase1 -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
# Expected: 403
```

- [ ] **Step 4: Verify client page loads in browser**

Open http://localhost:3502 in browser. Login as shawn@fiatx.com. Navigate to /withdraw.

Verify:
- Balance section shows real balance (not $0) or shows error banner if no TB accounts exist
- Selecting an asset shows withdrawal address dropdown (if ACTIVE addresses exist) or empty-state with link to /withdrawal-addresses
- History tab loads transaction list
- No console errors related to API calls

- [ ] **Step 5: Record verification result**

No commit needed. Document pass/fail in terminal output.
