# Wave 1 Evidence Export Audit Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove evidence export SLA side effects and make the evidence export audit chain complete and consistent.

**Architecture:** Keep changes tightly scoped to the evidence export approval flow and audit read model. Add the missing audit records at the orchestration layer, explicitly attach related subject numbers, and leave unrelated workflows untouched.

**Tech Stack:** NestJS, Prisma, Jest

---

### Task 1: Lock behavior with failing tests

**Files:**
- Modify: `src/modules/governance/approvals/audit-evidence-export-approval.service.spec.ts`
- Modify: `src/modules/governance/sla-timers/approval-sla-projection.service.spec.ts`
- Modify: `src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts`

- [x] Add failing tests for evidence export request-created and download audit events.
- [x] Add failing tests proving evidence export approvals no longer create or close SLA timers.
- [x] Add failing tests proving evidence export rows expose stable workflow/primary ref and richer subjectNos.

### Task 2: Implement the evidence export audit chain

**Files:**
- Modify: `src/modules/governance/approvals/audit-evidence-export-approval.service.ts`
- Modify: `src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`
- Modify: `src/modules/governance/sla-timers/approval-sla-projection.service.ts`

- [x] Record a request-created audit event when an evidence export request is created.
- [x] Record a downloaded audit event when an evidence package is downloaded.
- [x] Explicitly attach package/approval related subjects and keep one workflow + trace chain.
- [x] Skip SLA projection for audit evidence export approvals.

### Task 3: Align read-model mapping and verify

**Files:**
- Modify: `src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- Modify: `src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts`

- [x] Align user-action mapping so the new evidence export events surface cleanly.
- [x] Verify primary ref stays on `EVP...` and evidence export approval rows inherit the same workflow context.
- [x] Run focused Jest suites for evidence export, SLA projection, and audit log mapping.
