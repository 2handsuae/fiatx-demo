# TB Account Detail Page — Design Spec

## Goal

Add a detail page for TB Account Registry entries in the Admin web. The page shows registry metadata in a sidebar and TigerBeetle real-time balance in the main area. No transfer history — that belongs to the TB Transfers list page.

## Architecture

One new backend endpoint + one new frontend page. Follows the existing Pattern B sidebar detail layout used by WalletDetail and AssetDetail.

## Backend

### New Endpoint

`GET /admin/tb/accounts/:tbAccountId`

Added to `TbAdminController`. Calls:
1. `TbAccountRegistryService.findByTbAccountId(tbAccountId)` → registry row. 404 if not found.
2. `AccountingService.lookupBalance(hexToBigint(tbAccountId))` → real-time TB balance. On failure, balance fields return `null`.

### Response DTO

```ts
{
  // Registry metadata
  tbAccountId: string;       // hex
  code: number;              // TB account type code (u16)
  ledger: number;            // TB ledger ID (u32)
  ownerType: string;         // SYSTEM | CUSTOMER | LP
  ownerUuid: string | null;
  ownerNo: string | null;
  assetCode: string;
  status: string;
  description: string | null;
  flags: number;
  createdAt: string;

  // Balance (string-encoded bigint, null if TB unavailable)
  debitsPosted: string | null;
  creditsPosted: string | null;
  debitsPending: string | null;
  creditsPending: string | null;
  netBalance: string | null;   // creditsPosted - debitsPosted
}
```

`netBalance` is computed server-side as `creditsPosted - debitsPosted`.

All bigint values are serialized as decimal strings (not hex) for frontend display.

## Frontend

### Route

`/ledger/tb-accounts/:tbAccountId` — nested under the existing `/ledger` route group in App.tsx.

Static route segments registered before dynamic segments per frontend-admin rules.

### Permission

Reuses `TB_ACCOUNTS_READ`. No new permission constant.

### TbAccountList Changes

Table rows become clickable. `useNavigate` to `/ledger/tb-accounts/{tbAccountId}` on row click.

### TbAccountDetail.tsx — Sidebar Layout

**Header:** `DetailPageHeader` with:
- Back button → `/ledger/tb-accounts`
- Title: `"TB Account · {CODE_LABEL} · {assetCode}"` (e.g., "TB Account · CUSTODY · USDT")
- Refresh button

**Left Main Area — Balance Cards:**

Grid of 5 cards (2-column or 3-column responsive):

| Card | Value | Color |
|------|-------|-------|
| Debits Posted | `debitsPosted` | `adm-amber` accent |
| Credits Posted | `creditsPosted` | `adm-blue` accent |
| Debits Pending | `debitsPending` | `adm-amber` muted |
| Credits Pending | `creditsPending` | `adm-blue` muted |
| Net Balance | `netBalance` | `adm-green` if ≥ 0, `adm-red` if < 0 |

When balance is `null` (TB unavailable), all 5 cards show "TB unavailable" in `adm-t3` color.

**Right Sidebar (w-[272px]):**

Two `SidebarGroup` sections:

**Account Identity:**
- TB Account ID — truncated display with copy-to-clipboard
- Code — `{number} · {CODE_LABEL}` (e.g., "10 · CUSTODY")
- Ledger — number
- Asset Code — string

**Ownership & Status:**
- Owner Type — `AdminBadge`
- Owner No — string (hidden if null per SidebarKV rules)
- Status — `AdminBadge`
- Flags — number (hex display: `0x04`)
- Description — string (hidden if null)
- Created At — formatted date

### Data Fetching

Single `adminFetch` call to `GET /admin/tb/accounts/:tbAccountId`. Standard `AdminSessionError` handling. Loading state shows skeleton. Error state shows error banner with back-navigation affordance.

### Design Tokens

All `adm-*` tokens only. No raw Tailwind color classes.

### CODE_LABELS Constant

Shared between TbAccountList and TbAccountDetail:

```ts
const CODE_LABELS: Record<number, string> = {
  1: 'BANK',
  10: 'CUSTODY',
  100: 'CLIENT_CREDIT',
  101: 'CLIENT_AUDIT',
  110: 'TRADE_CLEARING',
  120: 'FEE_RECEIVABLE',
};
```

Extract to a shared location (e.g., inline in both files or a tiny shared constant file) — follow the simplest approach that avoids duplication without over-engineering.

## Out of Scope

- Transfer history on the detail page (stays on TB Transfers list)
- New RBAC permissions
- TB account editing/mutation
