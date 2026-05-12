# Admin Wallet V3 Frontend Adaptation — Design Spec

## Goal

Rewrite the admin wallet list and detail pages to V3 standards: new `mockBalance` single-balance field, V3 wallet role taxonomy with tooltip full names, Pattern B sidebar layout for detail pages, and a "Provision System Wallets" action on the asset detail page.

## Scope

| File | Action |
|------|--------|
| `admin-web/src/utils/walletRole.util.ts` | **Create** — role label/color mapping |
| `admin-web/src/pages/WalletList.tsx` | **Rewrite** — ChangeTicketsPage standard |
| `admin-web/src/pages/WalletDetail.tsx` | **Rewrite** — Pattern B sidebar layout |
| `admin-web/src/pages/AssetDetail.tsx` | **Modify** — Pattern B + provision button |

---

## 1. Shared Utility: walletRole.util.ts

New file at `admin-web/src/utils/walletRole.util.ts`.

### 1.1 Role Label Mapping

```typescript
export const WALLET_ROLE_LABEL: Record<string, string> = {
  C_DEP: 'Client Deposit',
  C_VIBAN: 'Client vIBAN',
  C_MAIN: 'Client Omnibus',
  C_OUT: 'Client Outbound',
  C_CMA: 'Client Money Account',
  F_LIQ: 'Company Liquidity',
  F_OPS: 'Company Operations',
};
```

### 1.2 Role Badge Color Mapping

AdminBadge is status-oriented (ACTIVE/FAILED/PENDING). Wallet roles need their own badge treatment. Define a color mapping and a `WalletRoleBadge` React component in the same file:

```typescript
const ROLE_CLS: Record<string, string> = {
  C_DEP:   'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  C_VIBAN: 'bg-adm-blue/10  text-adm-blue  border-adm-blue/25',
  C_MAIN:  'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  C_OUT:   'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  C_CMA:   'bg-adm-amber/10 text-adm-amber border-adm-amber/25',
  F_LIQ:   'bg-adm-green/10 text-adm-green border-adm-green/25',
  F_OPS:   'bg-adm-green/10 text-adm-green border-adm-green/25',
};

export const WalletRoleBadge = ({ role }: { role: string }) => {
  const cls = ROLE_CLS[role] ?? 'bg-adm-t3/10 text-adm-t2 border-adm-t3/25';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[10px] font-semibold ${cls}`}
      title={WALLET_ROLE_LABEL[role] || role}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
      {role}
    </span>
  );
};
```

Color semantics: blue = customer wallet, amber = platform system wallet, green = company wallet. Tooltip (`title`) shows full name.

Visual style matches AdminBadge (same classes, dot, font-mono 10px) for consistency across the admin UI.

### 1.3 AdminBadge STATUS_MAP Extension

`AdminBadge.tsx` needs two new entries so wallet statuses render correctly:

```typescript
DISABLED: 'failed',   // red
FROZEN:   'rejected', // amber
```

Without this, DISABLED and FROZEN fall to 'info' (grey) which is misleading.

### 1.4 Role Options for Filters

```typescript
export const WALLET_ROLE_OPTIONS = Object.keys(WALLET_ROLE_LABEL);
```

---

## 2. WalletList.tsx — Full Rewrite

Rewrite to match ChangeTicketsPage standard (352 lines, the current gold-standard list page).

### 2.1 Layout Structure (4 zones)

```
<div className="flex h-full flex-col overflow-hidden">
  1. PageTitleBar — "Wallets"
  2. Filter bar — shrink-0, border-b
  3. Table — flex-1, overflow-y-auto
  4. Footer — shrink-0, border-t, count + Pagination
</div>
```

### 2.2 Filter Bar

Inputs use shared `fi` constant (same as ChangeTicketsPage):

```typescript
const fi = 'h-[30px] rounded border border-adm-border bg-adm-bg px-2.5 font-mono text-[11px] text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber transition-colors';
```

Filters:
- **Owner ID / No** — text input with Enter-to-search
- **Owner Type** — select: All / PLATFORM / CUSTOMER
- **Role** — select: All + V3 roles (C_DEP, C_VIBAN, C_MAIN, C_OUT, C_CMA, F_LIQ, F_OPS)
- **Type** — select: All / CRYPTO_ADDRESS / FIAT_BANK
- **Status** — select: All / ACTIVE / DISABLED / FROZEN
- **Search** button — `adminButtonClass('listPrimary')`
- **Reset** button — `adminButtonClass('listSecondary')`
- **Refresh** icon — `adminIconButtonClass()`

### 2.3 Table Columns (8 columns)

| Column | Width | Content | Style |
|--------|-------|---------|-------|
| Wallet No | 160px | walletNo, type below | adm-amber semibold (rowKeyLink), type in adm-t3 |
| Role | 100px | short code badge + tooltip full name | WalletRoleBadge (from walletRole.util.ts) |
| Owner | 140px | ownerName/ownerNo, ownerType below | adm-t1 + adm-t2 |
| Asset | 100px | asset.code, network below | adm-t1 + adm-t3 |
| Balance | 120px | mockBalance formatted | mono, right-aligned, asset code suffix in adm-t3 |
| Status | 80px | ACTIVE/DISABLED/FROZEN | AdminBadge green/red/yellow |
| Updated | 140px | updatedAt formatted | adm-t2 |
| Action | 100px | Enable/Disable + View | rowSecondaryUtility + rowLink |

Key changes from old:
- **3 balance columns → 1**: `balance` field (backend returns mockBalance as `balance`)
- **Role badge**: V3 codes with adm-* colors, not raw Tailwind
- **balanceUpdatedAt column removed**: no longer relevant with mockBalance

### 2.4 Data Interface

```typescript
interface WalletItem {
  id: string;
  walletNo: string | null;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  balance: string;                // NEW: mockBalance from backend
  asset: { code: string; type: string; network?: string | null; decimals?: number };
  status: string;
  updatedAt: string;
}
```

Removed fields: `availableBalance`, `restrictedBalance`, `totalBalance`, `balanceUpdatedAt`.

### 2.5 Technical Requirements

- All colors via `adm-*` tokens — zero raw Tailwind colors
- Table header: `font-mono text-[9px] uppercase tracking-[0.12em] text-adm-t3`, sticky with `bg-adm-panel`
- Row: `border-b border-adm-border hover:bg-adm-hover`
- `requestSeqRef` for race condition guard
- Status toggle via `PATCH /wallets/:id/status` with `window.confirm`
- `AdminSessionError` silently caught

### 2.6 Pagination

Import `Pagination` from shared components. Backend already returns `{ items, total, page, limit }`. Display in footer bar.

---

## 3. WalletDetail.tsx — Full Rewrite (Pattern B)

Rewrite from Pattern A (DetailCard grid) to Pattern B (left main + right sidebar), matching PlatformMemberDetailPage.

### 3.1 Layout Structure

```
<div className="flex h-full flex-col overflow-hidden">
  <DetailPageHeader title="WALLET" subtitle={walletNo} onBack onRefresh>
    {/* status badge in children */}
  </DetailPageHeader>

  {/* error/notice banners */}

  <div className="flex min-h-0 flex-1 overflow-hidden">
    {/* LEFT MAIN */}
    <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
      <section> Identity </section>
      <section> Balance </section>
      <section> Address / Bank </section>
      <section> Deposit Collection (conditional) </section>
    </div>

    {/* RIGHT SIDEBAR */}
    <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
      <SidebarGroup title="Actions"> ... </SidebarGroup>
      <SidebarGroup title="Quick Reference"> ... </SidebarGroup>
    </div>
  </div>
</div>
```

### 3.2 Local Components (same as PlatformMemberDetailPage)

```typescript
const Cap = ({ children }: { children: string }) => (
  <p className="font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-adm-t3">
    {children}
  </p>
);

const SidebarGroup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="border-b border-adm-border py-4 last:border-b-0">
    <Cap>{title}</Cap>
    <div className="mt-2.5 flex flex-col gap-1.5">{children}</div>
  </div>
);

const SidebarKV = ({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) => {
  if (!value) return null;
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="font-mono text-[9px] text-adm-t3">{label}</span>
      <span className={mono ? 'font-mono text-[10px] text-adm-t2' : 'text-[11px] text-adm-t2'}>{value}</span>
    </div>
  );
};
```

### 3.3 Left Main Sections

**Section 1: Identity** (`bg-adm-card`)
- walletNo in large amber text (same as PlatformMemberDetailPage's userNo treatment)
- Status badge (AdminBadge)
- Role badge with tooltip full name
- Surface category label

**Section 2: Details** (grid-cols-2)
- InfoField: Owner, Owner Type, Owner No, Direction, Asset, Network

**Section 3: Balance**
- Single InfoField: label="Balance", value=`formatAssetAmount(wallet.balance, decimals) + ' ' + assetCode`, highlight=true
- No available/restricted/total split
- No AED equivalent

**Section 4: Address / Bank** (conditional, grid-cols-2)
- Crypto: Address (copyable), Memo, Beneficiary Name, Counterparty VASP
- Fiat: Bank Name, Account Holder, Account Number, IBAN, SWIFT/BIC
- Neither: omit section entirely

**Section 5: Deposit Collection** (conditional: `walletRole === 'C_DEP'`)
- Collection Amount (from balance), Execution Rule description
- Collection result banner (same logic as current)
- "Create Collection" button — permission-gated, `adminButtonClass('workflowPrimary')`

### 3.4 Right Sidebar

**Actions group** (conditional buttons):
- Enable / Disable — `adminButtonClass('detailUtility')`, gated on `status !== 'FROZEN'`
- Create Collection — `adminButtonClass('workflowPrimary')`, gated on `walletRole === 'C_DEP'` + permission
- View Regulatory Gate — `adminButtonClass('detailUtility')`, gated on `regulatoryGateSummary` exists + permission
- Create Regulatory Gate — `adminButtonClass('workflowPrimary')`, gated on no gate + `walletRole === 'C_CMA'` + permission

**Quick Reference group** (SidebarKV):
- Wallet No
- Status (AdminBadge)
- Role (short code)
- Asset Code
- Wallet ID (mono)

### 3.5 Data Interface

```typescript
interface WalletDetailData {
  id: string;
  walletNo: string;
  walletRole: string;
  surfaceCategory?: string;
  ownerType: string;
  ownerId: string | null;
  ownerNo: string | null;
  ownerName?: string | null;
  type: string;
  direction: string;
  assetId: string;
  balance: string;               // NEW: mockBalance from backend

  address: string | null;
  memo: string | null;
  beneficiaryName: string | null;
  counterpartyVasp: string | null;

  bankName: string | null;
  bankAccount: string | null;
  bankCode: string | null;
  accountName: string | null;
  iban: string | null;

  status: string;
  regulatoryGateSummary?: {
    gateId: string;
    gateNo: string;
    gateType: string;
    gateResult: string;
  } | null;

  createdAt: string;
  updatedAt: string;

  asset: {
    code: string;
    type: string;
    network: string | null;
    decimals?: number;
  };
}
```

Removed fields: `availableBalance`, `restrictedBalance`, `totalBalance`, `totalAedEquivalent`, `balanceUpdatedAt`, `regulatoryEnablementStatus`, `regulatoryEnabledAt`.

### 3.6 Removed Features

- **Regulatory Gate card** — removed as standalone card. Gate actions moved to sidebar. The gate check condition changes from `isCustBank` (old CUST_BANK role) to `walletRole === 'C_CMA'`.
- **AED Equivalent display** — removed (no real exchange rate in simulation)
- **Balance Updated At** — removed (mockBalance has no separate timestamp)

---

## 4. AssetDetail.tsx — Pattern B + Provision Button

Convert from single-column `max-w-5xl` to Pattern B sidebar layout, and add the provision action.

### 4.1 Layout Structure

Same Pattern B as WalletDetail:

```
<div className="flex h-full flex-col overflow-hidden">
  <DetailPageHeader title="ASSET" subtitle={assetNo} onBack onRefresh>
    {/* status badge */}
  </DetailPageHeader>

  <div className="flex min-h-0 flex-1 overflow-hidden">
    {/* LEFT MAIN */}
    <div className="flex min-w-0 flex-1 flex-col divide-y divide-adm-border overflow-y-auto">
      <section> Identity </section>
      <section> Details </section>
    </div>

    {/* RIGHT SIDEBAR */}
    <div className="w-[272px] min-w-[272px] overflow-y-auto border-l border-adm-border bg-adm-panel px-4 py-1">
      <SidebarGroup title="Actions"> ... </SidebarGroup>
      <SidebarGroup title="Quick Reference"> ... </SidebarGroup>
    </div>
  </div>
</div>
```

### 4.2 Left Main Sections

**Section 1: Identity** (`bg-adm-card`)
- assetNo in large amber text
- Status badge (AdminBadge)
- Code and Type

**Section 2: Details** (grid-cols-2)
- InfoField: Network, Decimals, Contract Address, Description, Created At, Updated At
- Deposit/Withdrawal amounts and enabled flags

### 4.3 Right Sidebar

**Actions group:**
- **Provision System Wallets** — `adminButtonClass('workflowPrimary')`
  - Visible only when `status === 'PROVISIONING' || status === 'ACTIVE'`
  - RBAC: `hasAnyPermission([PERMISSIONS.ASSET_PROVISION_WALLETS])` (new permission constant)
  - Click → `window.confirm('Provision system wallets for {code}?')`
  - POST `/admin/assets/${assetNo}/provision-wallets`
  - Success → green notice: "Provisioned N wallets: C_MAIN, C_OUT, F_LIQ, F_OPS" (from response)
  - Already exists → "All system wallets already exist"
  - Error → `getApiErrorMessage`

**Quick Reference group** (SidebarKV):
- Asset No
- Status (AdminBadge)
- Type
- Asset ID (mono)

### 4.4 RBAC Permission

Add to `admin-web/src/rbac/permissions.ts`:

```typescript
ASSET_PROVISION_WALLETS: 'api.post.admin_assets_assetno_provision_wallets'
```

This matches `buildPermissionCode('POST', '/admin/assets/:assetNo/provision-wallets')` from the backend.

---

## 5. Backend Compatibility Notes

### 5.1 Wallet API Response Field

The wallet query endpoint (`GET /wallets` and `GET /wallets/:id`) currently returns `mockBalance` via `WalletQueryService.findAll` / `findOne`. The frontend expects the field name `balance` in the response.

Confirm that the backend serializes `mockBalance` as `balance` in the response DTO. If not, either:
- (A) Add a `@Expose({ name: 'balance' })` transform in the response DTO
- (B) Frontend reads `mockBalance` directly

Verify during implementation which field name the backend actually returns.

### 5.2 WalletRole Filter

The `GET /wallets` endpoint supports `?walletRole=C_MAIN` filter via existing query params. Verify during implementation.

---

## 6. Out of Scope

- **Wallet Create page** — separate workflow, not part of this adaptation
- **Customer deposit wallet workflow** (C_DEP / C_VIBAN) — separate workflow
- **Real balance integration** — future chain RPC / bank API integration
- **Frontend date formatting utility extraction** — pages use local formatDate; extracting to shared util is separate cleanup
- **AdminBadge full redesign** — only add DISABLED/FROZEN to STATUS_MAP; no structural changes
