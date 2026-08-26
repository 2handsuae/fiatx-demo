# Custodian Wallet UI Polish

**Date:** 2026-05-19
**Scope:** 2 files — list page + detail page, frontend only
**Principle:** One value per column in list tables; strict three-block sidebar in detail pages

---

## Background

The Custodian Wallets list page has 4 columns that render two field values each (a primary value + a secondary sub-line). The frontend-admin.md rules require each column to present a single piece of information. Additionally, the detail page sidebar has 5 groups (ACTIONS, Quick Reference, Vault Info, Approval, Lifecycle) instead of the mandated 3-block structure (ACTIONS → IDENTITY SUMMARY → LIFECYCLE).

---

## Change 1: List Page — Eliminate Dual-Value Columns

**File:** `admin-web/src/pages/CustodianWalletList.tsx`

### Wallet No column (lines 299-304)
- **Remove** the `type` sub-line (`CRYPTO_ADDRESS` / `FIAT_BANK`)
- Keep only the walletNo in amber mono
- Rationale: type is redundant with the Role badge column

### Owner column (lines 312-315)
- **Remove** the `ownerType` sub-line (`CUSTOMER` / `PLATFORM`)
- Keep only the ownerLabel (name / ownerNo / ownerId)
- Rationale: ownerType is implied by Role (C_* = CUSTOMER, F_* = PLATFORM)

### Asset column (lines 318-321)
- **Split** into two separate columns: **Asset** (code only) and **Network** (network only)
- Asset column: `w.asset?.code || '—'`
- Network column: `w.asset?.network || '—'`

### Balance column (lines 324-329)
- **No change** — "0.00 AED" is a single composite monetary value

### Column header update
- From 8 columns to 9: `Wallet No · Role · Owner · Asset · Network · Balance · Status · Vault · Updated`
- Adjust column widths: Asset 80px, Network 90px (freed space from removing sub-lines)
- Update `colSpan` from 8 to 9 in loading/empty placeholder rows

---

## Change 2: Detail Page Sidebar — Strict Three-Block Structure

**File:** `admin-web/src/pages/CustodianWalletDetail.tsx`

### Sidebar after change (3 groups only)

```
[ACTIONS]            conditional — Retry Creation / Enable / Disable / Create Collection
[IDENTITY SUMMARY]   5 fields — walletNo, status badge, walletRole, roleName, asset.code
[LIFECYCLE]          2 fields — Created, Updated (mono timestamps)
```

### Remove VAULT INFO group (lines 492-496)
Move fields to main body DETAILS section:
- `Vault ID` — `wallet.vaultId`, mono, in existing 2-col grid
- `Custodian` — derived label: `'ZandBank'` for FIAT_BANK, `'HexTrust'` for CRYPTO_ADDRESS

### Remove APPROVAL group (lines 498-517)
Move field to main body DETAILS section:
- `Approval Case` — `wallet.approvalCaseNo`, conditional (only when non-null), clickable link to `/dashboard/control-gates/approvals/${wallet.approvalCaseId}`

### DETAILS section after change
Current 6 fields + 3 new = 9 fields in 2-col grid:
1. Owner / Owner Type
2. Owner No / Direction
3. Asset / Network
4. Vault ID / Custodian
5. Approval Case / (empty, conditional)

---

## Change 3: Fix backLabel

**File:** `admin-web/src/pages/CustodianWalletDetail.tsx` (line 290-294)

Add `backLabel="Custodian Wallets"` to `DetailPageHeader`. Per frontend-admin.md: "entity type is conveyed by backLabel only."

---

## Files Changed

| File | Change |
|---|---|
| `admin-web/src/pages/CustodianWalletList.tsx` | Remove 3 sub-lines, split Asset into Asset+Network, update colSpan |
| `admin-web/src/pages/CustodianWalletDetail.tsx` | Delete Vault Info + Approval sidebar groups, add 3 fields to DETAILS, fix backLabel |

---

## Success Criteria

1. List page: every column renders exactly one value (Balance "0.00 AED" is one composite value)
2. List page: 9 columns — Wallet No, Role, Owner, Asset, Network, Balance, Status, Vault, Updated
3. Detail sidebar: exactly 3 groups — ACTIONS (conditional), Identity Summary (5 fields), Lifecycle (2 timestamps)
4. Detail DETAILS section: includes Vault ID, Custodian, Approval Case (conditional link)
5. Detail backLabel shows "Custodian Wallets" instead of generic "Back"
6. No TypeScript errors, no visual regressions
