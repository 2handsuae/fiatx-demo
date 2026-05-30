# Transfer Evidence Detail Page Design

Date: 2026-05-30 | Scope: Admin Web + Backend API

## Context

`TbTransferEvidence` stores evidence records for every TigerBeetle ledger transfer. A list page (`TransferEvidenceList.tsx`) already exists at `/ledger/transfers`. This spec adds a detail page for viewing a single record.

## Requirements

- Pure read-only detail view of a single `TbTransferEvidence` record.
- `sourceNo` is a clickable link that navigates to the corresponding source transaction detail page.
- No action buttons. No audit logging needed (read-only query).

## Backend

### New Endpoint

```
GET /admin/tb/transfers/:tbTransferId
```

- **Controller:** `TbAdminController` (existing file)
- **Service:** `TbEvidenceService.findOne(tbTransferId)` (existing method)
- **Guard:** `AuthGuard('jwt')`, `AdminPermissionGuard`
- **Permission:** `ACCOUNTING_CONFIG_READ`
- **404:** Throws `NotFoundException` when record not found
- **Response:** Single `TbTransferEvidence` object

### RBAC Registration

Add `route('GET', '/admin/tb/transfers/:tbTransferId', 'ACCOUNTING_CONFIG_READ')` to `rbac.catalog.ts`. The list endpoint `GET /admin/tb/transfers` is already registered, but parameterized routes derive separate permission codes and need explicit registration.

No new service methods or Prisma models required.

## Frontend

### Route

```
/ledger/transfers/:tbTransferId
```

- Page component: `TransferEvidenceDetail.tsx`
- Permission: `PERMISSIONS.TB_TRANSFERS_READ`
- Lazy-loaded, wrapped with `withPermission()`

### Layout: Standard Two-Column

Follows the project's established detail page pattern (same as DepositTransactionDetail, etc.):
- Left: scrollable main content with hero + DetailCards
- Right: fixed 272px sidebar with identity/lifecycle info

### Hero Section

- **Amount** + **Asset Code** displayed prominently
- **Transfer Type** badge with color mapping:
  - `POSTED` → green
  - `PENDING` → amber
  - `POST_PENDING` → blue
  - `VOID_PENDING` → red
  - `CORRECTING` → gray

### Card 1 — Source Info

| Field | Display |
|-------|---------|
| Source Type | Text badge: DEPOSIT / WITHDRAWAL / SWAP / INTERNAL / FEE |
| Source No | Clickable link → source transaction detail page |
| Event Code | Mono text, e.g. `EVT_DEPOSIT_SUCCESS` |

### Card 2 — Accounting Entry

| Field | Display |
|-------|---------|
| Debit | Mono text, e.g. `L.CLIENT_CREDIT` |
| Credit | Mono text, e.g. `A.CUSTODY` |
| Amount | Formatted number |
| Asset | Asset code |

### Card 3 — Actor & Trace

| Field | Display |
|-------|---------|
| Actor Type | ADMIN / CUSTOMER / SYSTEM |
| Actor ID | adminNo / customerNo / `SYSTEM` |
| Trace ID | UUID with copy button |
| Memo | Text or `—` if null |

### Right Sidebar

| Section | Content |
|---------|---------|
| Identity | Transfer ID (hex, with copy button) |
| | Transfer Type (badge) |
| | Pending ID (hex or `—` if null) |
| Lifecycle | Created At (formatted timestamp) |

### sourceNo Link Routing

| sourceType | Target Route |
|------------|-------------|
| DEPOSIT | `/exchange/deposit-transactions/{sourceNo}` |
| WITHDRAWAL | `/exchange/withdraw-transactions/{sourceNo}` |
| SWAP | `/exchange/swap-transactions/{sourceNo}` |
| INTERNAL | `/exchange/internal-transactions/{sourceNo}` |
| FEE | No link (plain text) |

### List Page Update

`TransferEvidenceList.tsx` needs a row click handler or link column to navigate to the detail page. The `tbTransferId` or source info column becomes a `<Link>` to `/ledger/transfers/{tbTransferId}`.

## Not In Scope

- No audit log writes (read-only page)
- No new Prisma models
- No new permission codes (reuses `ACCOUNTING_CONFIG_READ`)
- No actions/mutations on this page
- No related-transfer-chain view (traceId lookup)
- No export functionality
