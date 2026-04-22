# Key Architectural Decisions (Wave 1–4)
Last Updated: 2026-04-21 | Scope: Wave 1–4 | Source: AGENTS.md, docs/adr/

---

## Audit Infrastructure

### AuditLogsService as the sole write path
**Decision:** All audit writes MUST route through `AuditLogsService`; no ad-hoc table writes are permitted in feature modules.
**Why:** Centralising writes enforces uniform field contracts (`traceId`, `workflowType`, `action`, `triggerType`) and prevents silent compliance gaps where business actions leave no audit trail.
**Impact:** `src/modules/audit-logging/` is a `@Global()` module imported once in `AppModule`; every domain service injects `AuditLogsService` rather than writing directly to domain audit tables.

### audit-logging promoted to standalone @Global module
**Decision:** `audit-logs` was extracted from `risk-engine/audit-logs/` into a top-level `src/modules/audit-logging/` `@Global()` module during Wave 2 cleanup (2026-04-11).
**Why:** After Wave 2 deleted the compliance-alert/incident machinery, audit logging had no logical reason to remain nested inside `risk-engine`; promoting it to a global module removes the circular dependency risk and makes the injection contract explicit.
**Impact:** All imports of the old path were updated; `risk-engine` no longer owns the audit surface.

### traceId + workflowType replaces workflowId/workflowNo as sequence key
**Decision:** `workflowId` and `workflowNo` were removed from `audit_log_events`; `traceId` (UUID v4) + `workflowType` is the canonical grouping key.
**Why:** `workflowId`/`workflowNo` duplicated parent-entity identity without adding grouping semantics; parent pointers when needed live in `metadata.parentEntityType/Id/No`.
**Impact:** All 32+ `recordByActor`/`recordSystem` call sites were mechanically cleaned in `2026-04-08-audit-trace-context-and-onboarding-cleanup`; downstream filters and UI use `traceId`.

---

## Identity & Operator Keys

### Operator key (No/Code) as primary query contract, not id
**Decision:** Every first-class subject MUST carry a stable `operatorKey` (`...No`, natural `code`, `policyCode`, etc.); `id` (UUID/CUID) MUST NOT be the primary operator lookup surface.
**Why:** UUIDs are opaque and human-unfriendly; stable operator keys support audit lookup, cross-system correlation, and demo traceability without leaking internal surrogate keys.
**Impact:** Admin list/detail pages, exact-match filters, and audit `subjectNos[]` all use `No`/`Code` first; routes MAY include `id` for internal binding but MUST NOT require it as the only identifier.

---

## Wave 2 — Compliance Engine

### Wave 2 compliance alert/incident code deprecated in favour of Sumsub
**Decision:** All `compliance-alerts/` and `compliance-incidents/` directories, Prisma tables, and `RiskDecisionOrchestratorService` were deleted; Sumsub becomes the single external compliance engine.
**Why:** Maintaining a parallel internal compliance-signal pipeline alongside Sumsub duplicated logic, split the audit trail, and added maintenance overhead without adding operator value.
**Impact:** `SumsubIngestionService` is the canonical webhook handler with 5-clue routing; transaction compliance (KYT/Travel Rule) remains in `risk-engine/transaction-compliance/` but compliance emission was removed pending Wave 5/7 Sumsub reconnect.

### Unified Sumsub webhook ingestion layer
**Decision:** All Sumsub signals (onboarding, periodic review, future transaction monitoring) enter through a single `POST /webhooks/sumsub` endpoint backed by `SumsubIngestionService`.
**Why:** Domain-specific webhook endpoints scattered signal handling, made deduplication and replay harder, and prevented a single audit view of all Sumsub interactions.
**Impact:** `sumsub_webhook_events` table stores every raw event with `context` enum (`ONBOARDING`/`PERIODIC_REVIEW`/`TRANSACTION`) before routing to domain handlers.

---

## Wave 3 — Periodic Review

### Sweep-based periodic review trigger, not event-based
**Decision:** `PeriodicReviewSweepService` runs on a 60-second cron; reviews are triggered by comparing `cddDocumentExpiresAt` against the current date, not by customer lifecycle events.
**Why:** A sweep model decouples the review cadence from individual customer events, supports catch-up on missed windows, and mirrors VARA III.D.8 mandatory re-assessment frequency semantics.
**Impact:** `AssessmentTriggerType` carries `SCHEDULED_QUARTERLY` as the canonical scheduled path; manual (`MLRO_MANUAL`) and signal-driven (`SUMSUB_AML_HIT`) paths are additive overlays.

### Firm-driven signoff model for CRA (Wave 1 ApprovalCase reused)
**Decision:** Wave 3 Client Risk Assessment reuses the Wave 1 `ApprovalCase` mechanism for all non-auto signoff paths rather than introducing a new approval entity.
**Why:** Wave 1 already established a governed approval state machine with SoD rules and audit integration; duplicating it for CRA would fragment the governance surface operators must monitor.
**Impact:** `signoffMethod` on `ClientRiskAssessment` maps to `ApprovalCase` action types (`RISK_RATING_UPGRADE_PHASE1`, `RISK_RATING_HIGH_APPROVAL`, etc.); `AUTO_R2` path bypasses case creation entirely (system auto-signs).

---

## Wave 4 — Config Release Governance

### business-config as the release governance layer, not individual subject modules
**Decision:** Wave 4 adopts a `config-as-code + item revision + subject release` model where each subject (`COA`, `AcctEvent`, `JournalTemplate`, `ClearingTemplate`, `PricingPolicy`) is released per-subject via a Change Ticket + Approval gate, not through admin self-service editors.
**Why:** Per-subject releases allow independent approval granularity, enable "as-of-release" historical replay, and match the product owner's explicit preference for repo-authored governance over admin-UI drafting.
**Impact:** `BusinessConfigRelease` and `BusinessConfigRevision` tables own the governance history; admin views are read-only (`Current`, `As-Of-Release`, `Revision Detail`, `Release Diff`); a single global platform release was rejected as too coarse.

### JournalHeaderTemplate + line templates version as one bundle
**Decision:** `JournalHeaderTemplate + JournalLineTemplate` and `ClearingTemplate + ClearingLineTemplate` each version as a single bundle; independent line-level version streams are forbidden.
**Why:** Header and lines form one semantic unit; separate version streams make release replay and approval-chain reasoning error-prone.
**Impact:** Release diff and snapshot pages always render header + lines together; the revision model treats the bundle as the atomic unit.

### PRICING_POLICY detail/snapshot deferred to Wave 6/7
**Decision:** `PRICING_POLICY` backend release governance ships in Wave 4, but detail and snapshot admin pages are deferred: SWAP Policy to Wave 6, Withdrawal Policy to Wave 7.
**Why:** Pricing policy configuration is only operator-meaningful in the context of the business chain it governs; showing swap pair fee matrices before swap transactions exist adds no demo value.
**Impact:** Wave 4 delivers `PRICING_POLICY` list + history pages only; `PricingPolicyDetail` and `PricingPolicySnapshot` routes are stubs until the respective transaction waves land.
