# TB Ledger Admin Pages — Design Spec

## Goal

Add 3 read-only list pages under the Accounting sidebar group to surface TigerBeetle ledger data: TB Accounts, TB Transfers, TB Evidence Backlog.

## Scope

- Backend: 3 new admin API endpoints (read-only, paginated, filtered)
- Frontend: 3 new list pages following ChangeTicketsPage standard (4-zone layout)
- Sidebar: 3 new entries under Accounting group
- No detail pages — these are flat list views with inline data

## Architecture

All 3 pages are pure read-only list pages. Backend uses existing services (`TbAccountRegistryService`, `TbEvidenceService`) — no new Prisma queries, just new controller endpoints wrapping existing service methods.

Frontend follows the established admin list pattern: `PageTitleBar` → filter bar → table → `Pagination` footer.

## Backend API

### `GET /admin/tb/accounts`

Query params: `skip`, `take`, `assetCode?`, `ownerType?`, `code?`

Response:
```json
{
  "items": [{
    "tbAccountId": "hex-string",
    "code": 10,
    "ledger": 3,
    "ownerType": "SYSTEM",
    "ownerUuid": "uuid|null",
    "ownerNo": "string|null",
    "assetCode": "BTC",
    "status": "ACTIVE",
    "description": "string|null",
    "flags": 0,
    "createdAt": "ISO-string"
  }],
  "total": 0
}
```

Implementation: New method on `TbAccountRegistryService` — `findAll({ assetCode?, ownerType?, code?, skip, take })` returning `{ items, total }`.

### `GET /admin/tb/transfers`

Query params: `skip`, `take`, `sourceType?`, `assetCode?`, `eventCode?`, `transferType?`

Response:
```json
{
  "items": [{
    "tbTransferId": "hex-string",
    "sourceType": "DEPOSIT",
    "sourceNo": "DEP2605...",
    "eventCode": "DEP_CONFIRMED",
    "debitCode": "L.CLIENT_CREDIT",
    "creditCode": "A.CUSTODY",
    "amount": "100.00",
    "assetCode": "BTC",
    "transferType": "POSTED",
    "traceId": "TRC...",
    "actorType": "SYSTEM",
    "actorId": "SYSTEM",
    "memo": "string|null",
    "pendingId": "hex|null",
    "createdAt": "ISO-string"
  }],
  "total": 0
}
```

Implementation: Existing `TbEvidenceService.findAll()` already supports these filters. Add `transferType` filter. Rename response key from `data` to `items` for consistency.

### `GET /admin/tb/backlog`

Query params: `skip`, `take`, `status?`

Response:
```json
{
  "items": [{
    "id": "uuid",
    "tbTransferId": "hex-string",
    "transferData": "json-string",
    "evidenceData": "json-string",
    "errorMessage": "string",
    "retryCount": 0,
    "status": "PENDING",
    "createdAt": "ISO-string",
    "resolvedAt": "ISO-string|null"
  }],
  "total": 0
}
```

Implementation: New method on `TbEvidenceService` — `findBacklog({ status?, skip, take })`.

### Controller

Single new controller: `TbAdminController` at path prefix `/admin/tb`. Guarded by `@UseGuards(AdminJwtAuthGuard)` + `@Permissions(ACCOUNTING_CONFIG_READ)`.

Register in `TigerBeetleModule` exports or create a thin `TbAdminModule`.

## Frontend Pages

All 3 pages follow the ChangeTicketsPage standard (4-zone layout, `adm-*` design tokens, `adminFetch`, `requestSeqRef` race guard, `Pagination` component).

### Page 1: `TbAccountList.tsx`

Route: `/dashboard/accounting/tb-accounts`

**Filter bar**: Asset Code (input), Owner Type (select: All / SYSTEM / CUSTOMER / LP), Account Code (select: All / BANK(1) / CUSTODY(10) / CLIENT_CREDIT(100) / CLIENT_AUDIT(101) / TRADE_CLEARING(110) / FEE_RECEIVABLE(120))

**Table columns**:
| Column | Width | Content |
|--------|-------|---------|
| TB Account ID | 200 | Hex string, monospace, truncated |
| Code | 80 | Numeric code + COA label badge (e.g., `10 · CUSTODY`) |
| Ledger | 60 | Numeric ledger ID |
| Owner | 140 | `ownerType` badge + `ownerNo` below in small text |
| Asset | 80 | `assetCode` |
| Status | 80 | `AdminBadge` |
| Created | 140 | Formatted date |

**Footer**: `Showing X / Y accounts` + `Pagination`

### Page 2: `TbTransferList.tsx`

Route: `/dashboard/accounting/tb-transfers`

**Filter bar**: Source Type (select: All / DEPOSIT / WITHDRAWAL / SWAP / INTERNAL / FEE), Asset Code (input), Event Code (input), Transfer Type (select: All / POSTED / PENDING / POST_PENDING / VOID_PENDING / CORRECTING)

**Table columns**:
| Column | Width | Content |
|--------|-------|---------|
| Transfer ID | 180 | Hex string, monospace, truncated |
| Source | 160 | `sourceType` badge + `sourceNo` below |
| Event | 120 | `eventCode` |
| Debit → Credit | 200 | `debitCode` → `creditCode` (arrow) |
| Amount | 120 | Right-aligned, monospace |
| Asset | 60 | `assetCode` |
| Type | 80 | `transferType` badge |
| Created | 140 | Formatted date |

**Footer**: `Showing X / Y transfers` + `Pagination`

### Page 3: `TbBacklogList.tsx`

Route: `/dashboard/accounting/tb-backlog`

**Filter bar**: Status (select: All / PENDING / RESOLVED / FAILED)

**Table columns**:
| Column | Width | Content |
|--------|-------|---------|
| Transfer ID | 200 | Hex string, monospace |
| Error | flex | `errorMessage`, truncated with title tooltip |
| Retries | 60 | `retryCount` |
| Status | 80 | `AdminBadge` |
| Created | 140 | Formatted date |
| Resolved | 140 | Formatted date or `—` |

**Footer**: `Showing X / Y entries` + `Pagination`

## Sidebar

Add 3 entries to the Accounting group in `DashboardLayout.tsx`, after existing accounting entries:

```
TB Accounts    → /dashboard/accounting/tb-accounts
TB Transfers   → /dashboard/accounting/tb-transfers
TB Backlog     → /dashboard/accounting/tb-backlog
```

## Route Registration

In `App.tsx`, add 3 routes under the accounting section. All static paths — no dynamic segment collision concerns.

## Permissions

Reuse existing `ACCOUNTING_CONFIG_READ` permission from RBAC catalog. No new permission constants needed.

## File Structure

### Backend (in `src/modules/accounting/tigerbeetle/`)
- Modify: `tb-account-registry.service.ts` — add `findAll()` method
- Modify: `tb-evidence.service.ts` — add `findBacklog()` method, add `transferType` filter to `findAll()`
- Create: `tb-admin.controller.ts` — 3 GET endpoints
- Modify: `tigerbeetle.module.ts` — register controller

### Frontend (in `admin-web/src/pages/`)
- Create: `TbAccountList.tsx`
- Create: `TbTransferList.tsx`
- Create: `TbBacklogList.tsx`
- Modify: `DashboardLayout.tsx` — sidebar entries
- Modify: `App.tsx` (or router config) — route registration
