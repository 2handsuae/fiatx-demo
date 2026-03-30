Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-async-idempotency-repair-constraints.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: constraints

# Backend Provider Integration Constraints

## 1) Purpose
- This document defines the common backend rules for external provider integration, callback ingestion, evidence containers, and provider-bound replay safety.

## 2) Provider Boundary
- Provider callbacks, provider reports, and provider response containers MUST be treated as external evidence or integration artifacts unless a domain spec explicitly says otherwise.
- Provider payloads MUST NOT become hidden substitutes for business workflow roots.

## 3) Snapshot Rule
- When provider data matters for replay, the system MUST persist enough provider snapshot data to explain:
1. what the provider returned
2. when it was received
3. which source subject it belongs to

## 4) Binding Rule
- Provider-origin records MUST bind to a canonical source scope such as:
1. `sourceType`
2. `sourceId`
3. provider reference
- Binding MUST be stable enough for dedupe, replay, and audit.

## 5) Idempotency Rule
- Callback ingestion MUST define dedupe semantics explicitly.
- Replayed provider callbacks MUST update or no-op deterministically; they MUST NOT fork multiple semantic results for the same source scope.

## 6) Workflow Truth Rule
- Provider responses MAY inform workflow decisions.
- Provider responses MUST NOT directly mutate canonical business state outside a documented domain workflow entrypoint.

## 7) Forbidden Patterns
- MUST NOT let provider transport details leak into product-facing lifecycle language unnecessarily.
- MUST NOT treat raw provider status words as business truth without normalization.
- MUST NOT accept provider callback side effects without audit evidence.

## 8) Change Protocol
- Any provider-integration change MUST include:
1. provider surface impacted
2. source-binding impact
3. dedupe/replay impact
4. business-truth boundary impact
