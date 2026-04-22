Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-21
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`
Source of Truth Level: roadmap

# Wave 4 Phase Plan — Ledger, Asset Structure & Config Admin UI

## 1. Purpose

This document records the Wave 4 delivery scope, phase breakdown, and completion status for:

- Backend: posting engine, COA, AcctEvent, journal/clearing templates, pricing policy config release model
- Admin UI: config-release subject pages (list / detail / snapshot) for the six business-config subjects

Backend runtime and business-config release pipeline are covered in `project-version-plan.md`. This document focuses on the **admin frontend UI slice** of Wave 4, which is the primary context for current active delivery.

---

## 2. Wave 4 Admin UI Scope

### 2.1 Config-Release Subjects

Wave 4 covers six business-config release subjects. Each subject maps to a `subjectType` in the release pipeline API.

| subjectType | Business Domain | Wave 4 UI Status |
|---|---|---|
| `ASSET_CONFIG` | Asset master (reference design) | ✅ Complete — list / detail / snapshot / history |
| `COA` | Chart of Accounts | ✅ Complete — list / detail / snapshot / history |
| `ACCT_EVENT` | Accounting Event Code | ✅ Complete — list / detail / snapshot / history |
| `JOURNAL_TEMPLATE` | Journal Header Template | ✅ Complete — list / detail / snapshot / history |
| `CLEARING_TEMPLATE` | Clearing Header Template | ✅ Complete — list / detail / snapshot / history |
| `PRICING_POLICY` | Pricing Policy | ⚠️ Partial — list / history only; detail/snapshot deferred |

### 2.2 PRICING_POLICY Deferral

`PRICING_POLICY` detail and snapshot pages are **explicitly out of Wave 4 scope**:

- `SWAP Policy` detail + snapshot → **Wave 6** (`Pricing → Quote → Swap`)
- `WITHDRAWAL Policy` detail + snapshot → **Wave 7** (`Withdraw → Payout`)

Rationale: pricing policy configuration is only meaningful to operators in the context of the business chain it governs. Showing swap pair fee matrices before swap transactions exist adds no operator value.

---

## 3. File Inventory

### 3.1 ASSET_CONFIG (reference design — pre-existing)

| File | Route | Role |
|---|---|---|
| `src/pages/AssetConfigList.tsx` | `/dashboard/system/asset-configs` | List |
| `src/pages/AssetConfigDetail.tsx` | `/dashboard/system/asset-configs/:assetNo` | Detail |
| `src/pages/AssetConfigHistory.tsx` | `/dashboard/system/asset-configs/history` | History |
| `src/pages/AssetConfigSnapshot.tsx` | `/dashboard/system/asset-configs/history/:releaseNo` | Snapshot |

### 3.2 COA

| File | Route | Role |
|---|---|---|
| `src/pages/CoaList.tsx` | `/ledger/coa` | List |
| `src/pages/CoaDetail.tsx` | `/ledger/coa/:accountCode` | Detail |
| `src/pages/CoaHistory.tsx` | `/ledger/coa/history` | History |
| `src/pages/CoaSnapshot.tsx` | `/ledger/coa/history/:releaseNo` | Snapshot |

Signature element: **T-Account Diagram** — two-panel (DR | CR) with highlighted normal balance side (ASSET/EXPENSE → amber DR, LIABILITY/EQUITY/REVENUE → blue CR).

### 3.3 ACCT_EVENT

| File | Route | Role |
|---|---|---|
| `src/pages/AcctEventList.tsx` | `/dashboard/system/acct-events` | List |
| `src/pages/AcctEventDetail.tsx` | `/dashboard/system/acct-events/:eventCode` | Detail |
| `src/pages/AcctEventHistory.tsx` | `/dashboard/system/acct-events/history` | History |
| `src/pages/AcctEventSnapshot.tsx` | `/dashboard/system/acct-events/history/:releaseNo` | Snapshot |

Signature element: **State Transition Diagram** — `fromStatus` pill (plain) → SVG arrow → `toStatus` pill (amber highlight). `fromStatus === null` renders as "any state" in italic.

### 3.4 JOURNAL_TEMPLATE

| File | Route | Role |
|---|---|---|
| `src/pages/JournalHeaderTemplateList.tsx` | `/dashboard/system/journal-header-templates` | List |
| `src/pages/JournalHeaderTemplateDetail.tsx` | `/dashboard/system/journal-header-templates/:templateCode` | Detail |
| `src/pages/JournalHeaderTemplateHistory.tsx` | `/dashboard/system/journal-header-templates/history` | History |
| `src/pages/JournalTemplateSnapshot.tsx` | `/dashboard/system/journal-header-templates/history/:releaseNo` | Snapshot |

Signature element: **DR/CR Double-Entry Ledger** — two-column layout (DEBIT amber | CREDIT blue). Each line card shows accountCode, amountSource, assetSource, conditionExpr. Balance indicator (green if DR count == CR count).

Payload structure (nested):
```
payload.header.{ templateCode, eventCode, version, status, description }
payload.lines[].{ lineNo, accountCode, drCr, amountSource, assetSource, ownerTypeSource, ... }
```

Snapshot: two-level expandable accordion — header row expands to reveal lines mini-table.

### 3.5 CLEARING_TEMPLATE

| File | Route | Role |
|---|---|---|
| `src/pages/ClearingHeaderTemplateList.tsx` | `/dashboard/system/clearing-header-templates` | List |
| `src/pages/ClearingHeaderTemplateDetail.tsx` | `/dashboard/system/clearing-header-templates/:templateCode` | Detail |
| `src/pages/ClearingHeaderTemplateHistory.tsx` | `/dashboard/system/clearing-header-templates/history` | History |
| `src/pages/ClearingTemplateSnapshot.tsx` | `/dashboard/system/clearing-header-templates/history/:releaseNo` | Snapshot |

Signature element: **Clearing Flow Pipeline** — INCOMING lane cards (green) → Pool node (circle) → FEE cards (amber) + OUTGOING cards (blue). Each card shows partyType, amountSource, assetSource.

Payload structure (flat with embedded array):
```
payload.{ code, clearingType, sourceType, description, isEnabled, feeMethod }
payload.lineTemplates[].{ lineNo, lineType, partyType, partyIdSource, assetSource, amountSource, memoTemplate, isEnabled }
```

Snapshot: two-level expandable accordion — header row expands to reveal lineTemplates mini-table.

### 3.6 PRICING_POLICY (partial)

| File | Route | Role |
|---|---|---|
| `src/pages/PricingPolicyList.tsx` | `/dashboard/pricing/policies` | List |
| `src/pages/PricingPolicyHistory.tsx` | `/dashboard/pricing/policies/history` | History |
| `PricingPolicyDetail` (SWAP) | `/dashboard/pricing/policies/swap/:policyId` | **Wave 6** |
| `PricingPolicySnapshot` (SWAP) | `/dashboard/pricing/policies/swap/history/:releaseNo` | **Wave 6** |
| `PricingPolicyDetail` (WITHDRAWAL) | `/dashboard/pricing/policies/withdrawal/:policyId` | **Wave 7** |
| `PricingPolicySnapshot` (WITHDRAWAL) | `/dashboard/pricing/policies/withdrawal/history/:releaseNo` | **Wave 7** |

Payload structure:
```
payload.{ policyId, policyName, business }
payload.channel.{ online, storeComingSoon }
payload.pairs[]     (SWAP — currency pair configs)
payload.assets[]    (WITHDRAWAL — asset withdrawal fee tiers)
payload.restrictions.{ extremeVolatilityBlocked, ... }
```

---

## 4. Design Pattern Summary

All five complete subjects (ASSET_CONFIG, COA, ACCT_EVENT, JOURNAL_TEMPLATE, CLEARING_TEMPLATE) follow the identical design pattern defined in `docs/constraints/frontend-admin-ui-constraints.md` Section 13. Key constants:

### API Contract (two-step fetch)
```
GET /admin/business-config/releases?subjectType=X&status=ACTIVE&take=1
GET /admin/business-config/releases/:releaseNo
→ items[].{ businessKey, payload }
```

### Shared Components Used
| Component | Import Path | Role |
|---|---|---|
| `PageTitleBar` | `../components/ui/PageTitleBar` | List page title + action bar |
| `DetailPageHeader` | `../components/compliance/DetailPageComponents` | Detail/Snapshot header |
| `AdminBadge` | `../components/ui/AdminBadge` | Status badges |
| `adminFetch` | `../utils/adminFetch` | HTTP client (MUST be only client) |
| `AdminSessionError` | `../utils/adminFetch` | Session expiry guard |
| `getApiErrorMessage` | `../utils/adminFetch` | Error message extraction |
| `adminButtonClass` | `../components/common/adminButtonStyles` | Button styling |
| `adminIconButtonClass` | `../components/common/adminButtonStyles` | Icon button styling |

### Route Registration Order (App.tsx)
Static segments MUST be registered before dynamic params to prevent React Router v6 collision:
```
history              ← registered first
history/:releaseNo   ← registered second
:key                 ← registered last
```

---

## 5. DashboardLayout Menu Entries

All completed subjects are registered in `src/components/DashboardLayout.tsx` under the following groups:

**Infrastructure Domain:**
- Assets → `/dashboard/system/asset-configs`
- Chart of Accounts (COA) → `/ledger/coa`
- Event Code Management → `/dashboard/system/acct-events`
- Journal Templates → `/dashboard/system/journal-header-templates`
- Clearing Templates → `/dashboard/system/clearing-header-templates`

**Pricing Center:**
- Pricing Policies → `/dashboard/pricing/policies`

---

## 6. Out of Scope for Wave 4 Admin UI

The following are explicitly excluded:

- `PRICING_POLICY` detail and snapshot pages (→ Wave 6 for SWAP, Wave 7 for WITHDRAWAL)
- `JournalLineTemplate` separate detail page — lines are embedded in `JournalHeaderTemplateDetail`
- `ClearingLineTemplate` separate detail page — lines are embedded in `ClearingHeaderTemplateDetail`
- Any write/edit/create flows for config subject pages (all surfaces are read-only + version history)
- Client-facing (`client-web`) equivalents of these config views

---

## 7. Durable References

| Concern | Document |
|---|---|
| Config-release subject UI design constraints | `docs/constraints/frontend-admin-ui-constraints.md` § 13 |
| Business-config release backend model | `docs/constraints/business-base-config-release-constraints.md` |
| Config release activation workflow | `docs/specs/workflows/config-release-activation-workflow.md` |
| Pricing policy entity | `docs/specs/entities/pricing-policy-entity.md` |
| Pricing center module | `docs/specs/modules/pricing-center-module.md` |
| Wave 4 high-level scope | `docs/roadmap/project-version-plan.md` § Wave 4 |
| SWAP Policy UI (Wave 6 scope) | `docs/roadmap/project-version-plan.md` § Wave 6 |
| WITHDRAWAL Policy UI (Wave 7 scope) | `docs/roadmap/project-version-plan.md` § Wave 7 |
