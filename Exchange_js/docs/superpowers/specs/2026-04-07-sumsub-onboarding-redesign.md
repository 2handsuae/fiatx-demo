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

## 4. Sumsub Webhook Handler

**Endpoint:** `POST /onboarding/sumsub/webhook`
**Auth:** HMAC-SHA256 signature verification (`x-payload-digest` header)
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

### Idempotency

Each webhook event carries a unique `type + applicantId + reviewId/attemptId`. The handler must be idempotent: replaying the same event must not produce duplicate audit entries, duplicate approval cases, or duplicate status transitions.

---

## 5. Final Approval Gate

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

## 6. System Responsibility Boundary

### This system owns

| Concern | Where |
|---|---|
| Sumsub webhook receiver + HMAC verification | `onboarding-sumsub-webhook.controller.ts` |
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

## 7. Active API Endpoints (Post-Cleanup)

### Customer-facing

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/onboarding/verification/start` | Get Sumsub SDK token, initiate verification |
| `GET` | `/onboarding/me` | Current onboarding status snapshot |
| `GET` | `/onboarding/next-step` | Next action guidance for client UI |

### Sumsub-facing

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/onboarding/sumsub/webhook` | Receive all Sumsub verification events |
| `POST` | `/onboarding/sumsub/simulate` | Dev/test simulation only |

---

## 8. Wave 2 Onboarding-Side Cleanup Scope

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

## 9. Out of Scope

- Periodic Review redesign for Sumsub (follow-on work, same pattern)
- Transaction compliance (KYT / Travel Rule) Sumsub integration
- Sumsub configuration details (done in Sumsub backend, not this codebase)
- Client-web UX redesign for the new substatus values

---

## 10. Success Criteria

1. `POST /onboarding/sumsub/webhook` correctly drives all `onboardingStatus` transitions.
2. Low-risk customers reach `APPROVED` with no internal human action required.
3. EDD-experienced customers auto-create `ONBOARDING_FINAL_APPROVAL`; SMO approval moves them to `APPROVED`.
4. `applicantWorkflowFailed` always results in `REJECTED`.
5. All transitions produce audit log entries with correct `traceId = ONBOARDING:<journeyId>`.
6. Webhook handler is idempotent — replaying any event produces no duplicate side effects.
7. Legacy CDD/EDD response write paths are removed; read paths (admin browse) may remain as historical views.
