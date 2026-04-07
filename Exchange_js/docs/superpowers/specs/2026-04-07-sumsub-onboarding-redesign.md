# Sumsub Onboarding Redesign — Design Spec

Status: approved
Owner: project-owner
Date: 2026-04-07
Applies To: `Exchange_js` Wave 3 Onboarding + Wave 2 Compliance Cleanup (Onboarding Side)

---

## 1. Context

The platform is outsourcing all compliance operations to Sumsub. Sumsub acts as the compliance engine:
risk scoring, AML/PEP/Sanctions screening, CDD verification, human review, EDD escalation, investigation, reporting, and regulatory filing all happen inside Sumsub. This system becomes a passive signal receiver — it only reacts to Sumsub webhooks and manages its own governance gate (Final Approval).

This spec covers:
- A unified Sumsub webhook ingestion layer (new) that receives, persists, and routes all Sumsub signals
- The correct Wave 3 onboarding state machine under Sumsub full-auto mode
- The Final Approval governance gate (the only step that happens inside this system)
- What Wave 2 onboarding-side compliance code is no longer needed

---

## 2. Business Flow (Source of Truth)

Sumsub is configured fully automatically in the Sumsub backend:

| Sumsub Risk Output | What Sumsub Does Internally | What This System Sees |
|---|---|---|
| LOW risk | Auto-passes level1, completes workflow | `applicantWorkflowCompleted` (no level2) |
| MEDIUM risk | Puts applicant on hold for internal human review | `applicantOnHold` → then outcome webhook |
| MEDIUM risk → human approves | Completes workflow at level1 | `applicantWorkflowCompleted` (no level2) |
| MEDIUM risk → human rejects | Fails workflow | `applicantWorkflowFailed` |
| MEDIUM risk → human escalates to EDD | Escalates to level2 | `applicantLevelChanged` to level2 |
| HIGH risk / PEP | Auto-escalates to level2 | `applicantLevelChanged` to level2 |
| EDD pass | Completes workflow at level2 | `applicantWorkflowCompleted` (with level2) |
| EDD fail | Fails workflow | `applicantWorkflowFailed` |

**Rule:** Final Approval is required if and only if `sumsubExperiencedLevel2 = true` at the time of `applicantWorkflowCompleted`. In other words, anyone who went through EDD needs a Final Approval governance gate in this system.

---

## 3. Onboarding State Machine

### Customer `onboardingStatus` values

```
NONE
  │
  │  POST /onboarding/verification/start
  │  Creates / reuses Sumsub applicant, issues SDK token
  ▼
PENDING_VERIFICATION
  │
  ├── applicantWorkflowCompleted + sumsubExperiencedLevel2 = false
  │   (Low risk auto-pass, or medium risk Sumsub-internal human approved without EDD)
  │   → onboardingStatus: APPROVED
  │     operatingStatus: ACTIVE
  │
  ├── applicantWorkflowCompleted + sumsubExperiencedLevel2 = true
  │   (Customer went through EDD and Sumsub approved)
  │   → onboardingStatus: FINAL_APPROVAL
  │     Auto-creates ONBOARDING_FINAL_APPROVAL approval case
  │     → SMO APPROVE → onboardingStatus: APPROVED, operatingStatus: ACTIVE
  │     → SMO REJECT  → onboardingStatus: REJECTED
  │
  └── applicantWorkflowFailed (any stage, Sumsub-determined failure)
      → onboardingStatus: REJECTED

REJECTED / WITHDRAWN → may reinitiate verification (back to NONE → PENDING_VERIFICATION)
```

### `verificationSubstatus` (projection only, drives client-side UX)

| Sumsub Webhook Event | verificationSubstatus | Customer Action Required |
|---|---|---|
| `applicantPending` | `SUBMITTED` | None — wait |
| `applicantOnHold` | `UNDER_REVIEW` | None — Sumsub is doing internal review |
| `applicantReviewed` RED + RETRY | `RESUBMIT_REQUIRED` | Re-submit documents in Sumsub SDK |
| `applicantLevelChanged` → level2 | `NEXT_LEVEL_REQUIRED` | Continue EDD in Sumsub SDK |
| `applicantWorkflowCompleted` | `COMPLETED` | None — system transitions status |
| `applicantWorkflowFailed` | `FAILED` | None — status moves to REJECTED |

---

## 4. Unified Sumsub Webhook Ingestion Layer

All Sumsub signals — regardless of domain (onboarding, periodic review, future transaction monitoring) — enter the system through a single ingestion layer.

### Architecture

```
Sumsub
  │
  ▼
POST /webhooks/sumsub  (unified entry point)
  │
  ├── 1. Verify HMAC-SHA256 signature (x-payload-digest)
  ├── 2. Persist raw event → sumsub_webhook_events (status: PENDING)
  ├── 3. Parse: eventType + applicantId + externalUserId + context
  ├── 4. Route to domain handler:
  │       ├── context = ONBOARDING      → OnboardingService
  │       ├── context = PERIODIC_REVIEW → PeriodicReviewService  (future)
  │       └── context = TRANSACTION     → TransactionService     (future)
  ├── 5. On success → update record status: PROCESSED
  └── 6. On failure → update record status: FAILED, increment retryCount
              └── Auto-retry (up to 3 attempts, exponential backoff)
                      └── Still failing → status: DEAD, write system alert
```

### `sumsub_webhook_events` table

| Field | Type | Notes |
|---|---|---|
| `id` | string | Primary key |
| `eventNo` | string | Human-readable reference (e.g. `SWH-0001`) |
| `eventType` | string | Sumsub event type (e.g. `applicantWorkflowCompleted`) |
| `applicantId` | string | Sumsub applicant ID |
| `externalUserId` | string | Our customer ID as sent to Sumsub |
| `context` | enum | `ONBOARDING` / `PERIODIC_REVIEW` / `TRANSACTION` |
| `rawPayload` | json | Full raw webhook body, immutable |
| `receivedAt` | datetime | Wall-clock time of receipt |
| `status` | enum | `PENDING` / `PROCESSED` / `FAILED` / `DEAD` |
| `retryCount` | int | Number of processing attempts (max 3) |
| `lastErrorMessage` | string | Error from last failed attempt |
| `processedAt` | datetime | Timestamp of successful processing |
| `dispatchedTo` | string | Which downstream handler was called |
| `isSimulated` | boolean | `true` when created via admin simulation |
| `simulatedByUserId` | string | Admin user who triggered simulation |
| `createdAt` | datetime | |

### Idempotency

Each Sumsub event carries a unique `type + applicantId + reviewId/attemptId`. Before dispatching to the domain handler, the ingestion layer checks for an existing `PROCESSED` record with the same deduplication key. If found, the new event is stored as `PROCESSED` immediately with no downstream dispatch.

### Retry policy

- Max attempts: 3
- Backoff: 30 s → 5 min → 30 min
- After 3 failures: status → `DEAD`, write a system-level alert to notify operators
- Dead events can be manually replayed from the Admin "Sumsub Events" page

---

## 5. Admin: Sumsub Events Page

Location in admin nav: **Compliance → Sumsub Events**

This page is the operational home for all Sumsub signal history and simulation.

### Event log table

Columns: Event No | Received At | Type | Applicant ID | Customer No | Context | Status | Simulated | Actions

- Status badge: `PROCESSED` (green) / `PENDING` (blue) / `FAILED` (amber) / `DEAD` (red)
- Clicking a row shows: raw payload, parsed fields, dispatch result, retry history
- `DEAD` events show a "Replay" button
- Simulated events show a "Simulated" badge

### Simulation panel

A "Simulate Event" button opens a form with:

| Field | Input |
|---|---|
| Customer | Search by customer no / email |
| Event Type | Dropdown: all supported Sumsub event types |
| Scenario | Pre-built scenario shortcuts (see below) |
| Raw override | Optional: paste custom JSON payload |

**Pre-built scenarios (shortcuts for common demo flows):**

| Scenario Label | Event Sent |
|---|---|
| ✅ Low risk — auto approve | `applicantWorkflowCompleted` (no level2) |
| 🔍 Manual review required | `applicantOnHold` |
| 📄 Resubmission required | `applicantReviewed` RED + RETRY |
| ⬆️ Escalate to EDD | `applicantLevelChanged` → level2 |
| ✅ EDD passed — needs Final Approval | `applicantWorkflowCompleted` (with level2) |
| ❌ Workflow failed — rejected | `applicantWorkflowFailed` |

Simulated events are stored in `sumsub_webhook_events` with `isSimulated = true` and `simulatedByUserId` set. They flow through the exact same ingestion → routing → domain handler path as real events. The result appears in the event log immediately.

---

## 6. Domain Webhook Handler: Onboarding

Receives dispatched events from the ingestion layer for `context = ONBOARDING`.

**All logic flows through:** `OnboardingService.handleSumsubVerificationEvent()`

### Event handling table

| Event | System Actions |
|---|---|
| `applicantPending` | Update `verificationSubstatus = SUBMITTED`, write audit log |
| `applicantOnHold` | Update `verificationSubstatus = UNDER_REVIEW`, write audit log |
| `applicantReviewed` RED + RETRY | Update `verificationSubstatus = RESUBMIT_REQUIRED`, write audit log |
| `applicantLevelChanged` to level2 | Set `sumsubExperiencedLevel2 = true`, `verificationSubstatus = NEXT_LEVEL_REQUIRED`, write audit log |
| `applicantLevelChanged` other | Update `sumsubCurrentLevelName`, write audit log |
| `applicantWorkflowCompleted` (no level2) | `onboardingStatus = APPROVED`, `operatingStatus = ACTIVE`, write audit log |
| `applicantWorkflowCompleted` (level2) | `onboardingStatus = FINAL_APPROVAL`, auto-create `ONBOARDING_FINAL_APPROVAL`, write audit log |
| `applicantWorkflowFailed` | `onboardingStatus = REJECTED`, write audit log |

---

## 7. Final Approval Gate

This is the only governance step that happens inside this system (not in Sumsub).

**Trigger:** `applicantWorkflowCompleted` webhook received AND `sumsubExperiencedLevel2 = true`

**Approval case:** `ONBOARDING_FINAL_APPROVAL` — created automatically by `onboarding-final-approval.service.ts`

**Approver role:** `SENIOR_MANAGEMENT_OFFICER` (SMO)

**Approval mechanism:** Single-approver (SMO reviews and acts). Uses the existing Governance Approvals Engine.

**Outcomes:**

| SMO Decision | Customer State |
|---|---|
| APPROVE | `onboardingStatus = APPROVED`, `operatingStatus = ACTIVE` |
| REJECT | `onboardingStatus = REJECTED` |

**Audit:** Both the auto-creation and SMO decision must write audit log entries with `workflowType = ONBOARDING`, `traceId = ONBOARDING:<journeyId>`.

---

## 8. System Responsibility Boundary

### This system owns

| Concern | Where |
|---|---|
| Unified Sumsub webhook receiver + HMAC verification | `sumsub-ingestion.controller.ts` (new) |
| Webhook event persistence + retry + dead-letter | `sumsub-ingestion.service.ts` (new) |
| Domain routing (onboarding / periodic review / transaction) | `sumsub-ingestion.service.ts` (new) |
| Admin Sumsub Events page + simulation UI | `admin-web/SumsubEventsPage.tsx` (new) |
| Customer state transitions (onboardingStatus, operatingStatus) | `onboarding.service.ts` |
| verificationSubstatus projection | `onboarding.service.ts` |
| Auto-create ONBOARDING_FINAL_APPROVAL | `onboarding-final-approval.service.ts` |
| SMO approval → customer status update | Governance Approvals Module (existing) |
| Full audit trail of all events and transitions | `AuditLogsService` (existing) |
| Trading gate enforcement (APPROVED + ACTIVE + unfrozen + unrestricted) | Existing gate (unchanged) |

### Sumsub owns (this system does not replicate)

- Document collection and authenticity verification
- AML / PEP / Sanctions screening
- Risk scoring
- Human review workflow
- EDD escalation decision
- EDD data collection and review
- Investigation reports
- Regulatory filing (STR / SAR)

---

## 9. Active API Endpoints (Post-Cleanup)

### Customer-facing

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/onboarding/verification/start` | Get Sumsub SDK token, initiate verification |
| `GET` | `/onboarding/me` | Current onboarding status snapshot |
| `GET` | `/onboarding/next-step` | Next action guidance for client UI |

### Sumsub-facing (unified ingestion)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/webhooks/sumsub` | Unified Sumsub webhook receiver (replaces `/onboarding/sumsub/webhook`) |

### Admin-facing (new)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/sumsub-events` | List webhook event log (paginated, filterable) |
| `GET` | `/admin/sumsub-events/:id` | Event detail + raw payload + retry history |
| `POST` | `/admin/sumsub-events/:id/replay` | Replay a DEAD event |
| `POST` | `/admin/sumsub-events/simulate` | Trigger a simulated Sumsub event |

---

## 10. Wave 2 Onboarding-Side Cleanup Scope

The following are no longer needed for onboarding now that Sumsub handles all compliance logic. They should be deprecated and removed.

### Code paths to remove

| Item | Location | Reason |
|---|---|---|
| CDD/EDD internal risk assessment | `risk-engine.service.ts` (onboarding context) | Sumsub does risk scoring |
| `WorkflowDecisionRecord` creation (onboarding side) | `onboarding.service.ts` | No internal decision needed |
| `CddResponse` write path | `onboarding.service.ts` | Legacy evidence container, Sumsub holds evidence |
| `EddResponse` write path | `onboarding.service.ts` | Legacy evidence container, Sumsub holds evidence |
| Onboarding alert creation logic | `compliance-alerts/` | Alerts happen in Sumsub |
| Onboarding case creation logic | `compliance-incidents/` | Cases managed in Sumsub |

### API endpoints to deprecate

| Method | Path | Reason |
|---|---|---|
| `POST` | `/onboarding/cdd-responses/bootstrap` | Legacy CDD flow |
| `POST` | `/onboarding/cdd-responses/reinitiate` | Legacy CDD flow |
| `POST` | `/onboarding/edd-responses/start` | Legacy EDD flow |
| `POST` | `/onboarding/edd-responses/reinitiate` | Legacy EDD flow |
| `POST` | `/onboarding/responses/:id/sessions` | Legacy session flow |
| `POST` | `/onboarding/response-sessions/:sessionId/mock-complete` | Legacy mock flow |

### What to keep (still has value)

| Item | Reason |
|---|---|
| `compliance_alerts` / `compliance_incidents` tables | Transaction compliance (Wave 5/7) still uses these; physical tables kept |
| `AuditLogsService` | Still needed for full audit trail |
| Customer freeze/unfreeze mechanism | Still driven by system-level compliance decisions |
| `ONBOARDING_FINAL_APPROVAL` approval flow | Internal governance gate, independent of Sumsub |

### Transaction compliance (Wave 5/7 KYT / Travel Rule)

KYT and Travel Rule cases currently use `compliance_alerts` / `compliance_incidents`. These are also eventually moving to Sumsub Transaction Monitoring, but the timing is not yet confirmed. Cleanup of the transaction-side compliance machinery is **deferred** — do not remove it in this round.

---

## 11. Out of Scope

- Periodic Review redesign for Sumsub (follow-on work, same pattern)
- Transaction compliance (KYT / Travel Rule) Sumsub integration
- Sumsub configuration details (done in Sumsub backend, not this codebase)
- Client-web UX redesign for the new substatus values

---

## 12. Success Criteria

1. `POST /webhooks/sumsub` receives all Sumsub events, persists them, and routes correctly by context.
2. Every received event (real or simulated) appears in the Admin Sumsub Events log.
3. Failed events auto-retry up to 3 times; dead events surface as system alerts.
4. Low-risk customers reach `APPROVED` with no internal human action required.
5. EDD-experienced customers auto-create `ONBOARDING_FINAL_APPROVAL`; SMO approval moves them to `APPROVED`.
6. `applicantWorkflowFailed` always results in `REJECTED`.
7. All transitions produce audit log entries with correct `traceId = ONBOARDING:<journeyId>`.
8. Webhook handler is idempotent — replaying any event produces no duplicate side effects.
9. Admin simulation covers all 6 pre-built scenarios and produces the correct downstream state change.
10. Legacy CDD/EDD response write paths are removed; read paths (admin browse) may remain as historical views.
