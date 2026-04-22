Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-21
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`
Source of Truth Level: roadmap

# Wave 1–4 Product Workflow Summary

This document records the product-level workflows delivered in Waves 1–4, verified against the running codebase. It is the authoritative quick reference for product scope, demo scenarios, and acceptance review.

For technical detail, see the linked workflow specs in `docs/specs/workflows/`.

---

## Wave 1 — Governance Platform (Control Layer)

**Scope:** Admin identity, access control, change governance, deletion governance, audit evidence.

### Delivered Workflows

| # | Workflow | Mechanism | Technical Spec |
|---|---|---|---|
| 1 | Create admin member | Admin invitation → Change Ticket (ADMIN_INVITE type) → CT approved → invitation email activated → admin account created | `admin-member-auth-boundary-workflow.md` |
| 2 | Change admin role | Role binding change → Change Ticket (ROLE_BINDING type) → maker-checker approved → `executeGovernedRoleBindingChange` executed | `change-ticket-release-gate-workflow.md` |
| 3 | Export audit evidence package | Evidence export request → Approval (DIRECT_EXECUTE type) → on approval, package auto-executes (no separate consume step) | `audit-evidence-export-approval-workflow.md` |
| 4 | Delete admin member | Delete Request (target: ADMIN_USER) → requester ≠ consumer rule enforced → soft delete executed | `delete-request-soft-delete-workflow.md` |
| 5 | Delete change ticket | Delete Request (target: CHANGE_TICKET) → CT must be in terminal state before deletion permitted | `delete-request-soft-delete-workflow.md` |
| 6 | Delete evidence package | Delete Request (target: AUDIT_EVIDENCE_PACKAGE) → maker-checker delete gate → soft delete executed | `delete-request-soft-delete-workflow.md` |

### Governance Containers

Three approval container types underpin all Wave 1 workflows:

| Container | Pattern | Key Rule |
|---|---|---|
| Change Ticket | create → submit → approve → consume → execute | Consumer ≠ creator (SoD) |
| Delete Request | create → submit → approve → consume → execute | Consumer ≠ creator (SoD); target must be in terminal state |
| Approval Direct Execute | approve → auto-execute | No consume step; used for evidence export |

### Supporting Infrastructure

- SLA timer engine: 4h / 24h / 48h / 72h notification obligations
- Audit log write on every state transition (traceId UUID v4, workflowType, action, triggerType)

---

## Wave 2 — Risk Engine & Sumsub Integration

**Scope:** Sumsub webhook ingestion, compliance simulation. No new governance workflows added.

### Delivered: Sumsub Webhook Simulation Center

Wave 2 built the Sumsub integration and a simulation center for demo/testing. No customer-facing or governance workflows are introduced in this wave.

**Simulation endpoints** (`/admin/sumsub/simulate/*`):

| Endpoint | Scenario |
|---|---|
| `POST /admin/sumsub/simulate/onboarding-approved` | KYC approval (onboarding path) |
| `POST /admin/sumsub/simulate/onboarding-rejected` | KYC rejection |
| `POST /admin/sumsub/simulate/aml-flagged` | AML flag (ongoing monitoring) |
| `POST /admin/sumsub/simulate/material-refresh-required` | Material expiry / re-submission request |
| `POST /admin/sumsub/simulate/case-decision` | Case outcome callback |
| `POST /admin/sumsub/simulate/tier-upgrade-approved` | Level 2 upgrade approval |

**Admin UI simulation tabs** (5 scenario panels in `SumsubEventsPage.tsx`):
Onboarding Approved / Rejected, AML Flagged, Material Refresh, Tier Upgrade, Case Decision.

**Webhook dispatch** routes each event to 5 handlers:
onboarding path, AML path, material refresh path, tier upgrade path, case decision path.

---

## Wave 3 — Customer Onboarding & Periodic Review

**Scope:** Full customer onboarding state machine, material refresh, periodic review, tier upgrade.

### Delivered Workflows

| # | Workflow | Description |
|---|---|---|
| 1 | Customer onboarding | KYC/CDD/EDD state machine — see below |
| 2 | Material refresh (layer 3) | Expiry-triggered document re-submission flow |
| 3 | Periodic risk review (layer 2) | Scheduled customer re-assessment every 60s sweep |
| 4 | Tier upgrade (Level 2) | 3-phase upgrade requiring CRA + Sumsub + MLRO/SMO approval |

### 1. Customer Onboarding State Machine

```
PENDING_VERIFICATION
    ↓ (Sumsub Level 1 approved)
CDD_IN_PROGRESS
    ↓ (CDD complete, high risk?)
    ├── [high risk] → EDD_IN_PROGRESS
    │       ↓ (EDD complete)
    │   FINAL_APPROVAL_PENDING
    └── [standard] → FINAL_APPROVAL_PENDING
         ↓ (MLRO + SMO approve)
         ├── APPROVED (trading gate open)
         └── REJECTED (trading gate closed)
```

Key gates: trading/withdrawal blocked until `APPROVED`; EDD path requires MLRO + SMO dual approval.

### 2. Material Refresh (Layer 3 — Ongoing Doc Monitoring)

Triggered by Sumsub's ongoing monitoring webhook when a document expires or is flagged.

```
NUDGE_ONLY
    ↓ (document still not refreshed after T+N)
URGENT
    ↓ (document still not refreshed after T+N)
BLOCKING   ← trading/withdrawal suspended
    ↓ (customer submits; Sumsub verifies)
RESOLVED   ← trading gate restored
```

Spec: `docs/specs/wave3-layer3-material-refresh.md`

### 3. Periodic Risk Review (Layer 2)

`PeriodicReviewSweepService` runs every 60 seconds. Checks `cddDocumentExpiresAt` against current date.

- High-risk customers: review cycle = 90 days
- Standard customers: review cycle = 1 year
- On expiry: trading restrictions applied; MLRO review case opened
- On clearance: restrictions lifted; audit trace written

Spec: `docs/specs/wave3-layer2-risk-assessment.md`

### 4. Tier Upgrade (Level 2)

Three-phase process for customers requesting Level 2 status:

| Phase | Actor | Action |
|---|---|---|
| Phase 1 | CRA assessment | Customer Risk Assessment must be HIGH to proceed |
| Phase 2 | Sumsub | Level 2 document verification (webhook callback) |
| Phase 3 | MLRO + SMO | Dual governance approval gate |

Only after all three phases pass does the customer tier upgrade to Level 2.

---

## Wave 4 — Ledger, Asset Structure & Config Admin UI

**Scope:** Accounting posting engine, COA, AcctEvent, Journal/Clearing templates, Pricing Policy config, Wallet management UI.

### Delivered: 6 Config Release Subjects

Each subject follows the same release pipeline: Stage → Validate → Publish (governance-gated).

| Subject Type | Business Domain | Admin UI Status |
|---|---|---|
| `ASSET_CONFIG` | Asset master | ✅ List / Detail / Snapshot / History |
| `COA` | Chart of Accounts | ✅ List / Detail / Snapshot / History |
| `ACCT_EVENT` | Accounting Event Code | ✅ List / Detail / Snapshot / History |
| `JOURNAL_TEMPLATE` | Journal Header Template | ✅ List / Detail / Snapshot / History |
| `CLEARING_TEMPLATE` | Clearing Header Template | ✅ List / Detail / Snapshot / History |
| `PRICING_POLICY` | Pricing Policy | ⚠️ List / History only — Detail/Snapshot deferred to Wave 6 (SWAP) / Wave 7 (WITHDRAWAL) |

> **Note:** There are 6 subjects, not 5. ASSET_CONFIG is a full subject with its own release pipeline and admin pages.

### Config Release Pipeline

```
DRAFT
  ↓ stageRelease()
STAGED
  ↓ validateRelease()
VALIDATED
  ↓ publishRelease()  ← Change Ticket approval gate (optional)
ACTIVE    ← live configuration; read by all services
```

The release pipeline lives in `BusinessConfigService` (1736 lines). Individual subject controllers (COA, AcctEvent, etc.) are **read-only** — they query `business_config_releases` as the source of truth.

Spec: `docs/specs/workflows/config-release-activation-workflow.md`

### Wallet Management UI (Partial)

| Page | Status | Notes |
|---|---|---|
| `WalletList.tsx` | ✅ Exists | Lists platform + customer wallets |
| `WalletDetail.tsx` | ✅ Exists | Shows wallet detail and balance |
| Create wallet form | ❌ Not built | Wave 4 scope gap |
| Edit wallet form | ❌ Not built | Wave 4 scope gap |

> **Note:** Wallet management is partially done, not entirely undone. List and detail pages exist; create/edit forms are missing.

### Accounting Execution Flow

```
Business event (e.g., swap settled)
  ↓
AccountingEventExecutionService
  ├── JournalsService  → creates journal entries (DR/CR lines)
  └── ClearingsService → creates clearing entries (pool settlement)
```

`JournalsService` and `ClearingsService` are independent — both called by the orchestrator. Neither calls the other directly.

---

## Accuracy Notes (Corrections vs. Earlier Documentation)

| Topic | Previous Claim | Corrected Fact |
|---|---|---|
| Wave 4 subject count | "5 subjects" | 6 subjects: ASSET_CONFIG + COA + ACCT_EVENT + JOURNAL_TEMPLATE + CLEARING_TEMPLATE + PRICING_POLICY |
| Wave 4 wallet management | "还没有做" (not done) | Partially done: WalletList + WalletDetail exist; create/edit forms missing |
| Wave 1 evidence export | "独立 workflow" | Approval DIRECT_EXECUTE type — no consume step; auto-executes on approval |
| Wave 2 simulation | "5 scenarios" | 6 simulation endpoints; 5 UI scenario tabs |

---

## Cross-Wave Dependency Map

```
Wave 1 (Governance)
  → provides Change Ticket + Delete Request + Approval containers
  → used by Wave 3 (MLRO/SMO approval) + Wave 4 (config release gate)

Wave 2 (Sumsub)
  → provides webhook ingestion + simulation
  → used by Wave 3 (onboarding, material refresh, tier upgrade callbacks)

Wave 3 (Onboarding)
  → provides customer APPROVED status = trading eligibility gate
  → used by Wave 5 (deposit), Wave 6 (swap), Wave 7 (withdraw)

Wave 4 (Posting Engine + Config)
  → provides COA + AcctEvent + Journal/Clearing templates
  → used by Wave 5/6/7 (all transaction accounting)
```
