Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/backend-platform-constraints.md`, `docs/constraints/backend-domain-model-constraints.md`
Source of Truth Level: constraints

# Backend Identity And Operator Key Constraints

## 1) Purpose
- This document fixes the identity model used across backend persistence, APIs, read-models, audit, and operator search.

## 2) Canonical Identity Layers
- Every durable table MUST have `id` for internal binding and foreign-key relations.
- Every first-class subject MUST have one stable `operatorKey`.
- Allowed operatorKey forms are:
1. `...No`
2. stable natural `code`
3. stable natural `policyCode`
4. stable natural `eventCode`
5. stable natural `templateCode`
6. `businessKey`
7. deterministic `compositeRef`

## 3) No / Code / Composite Rules
- Workflow, transaction, and governance root subjects SHOULD use `...No`.
- Catalog and configuration root subjects SHOULD use a stable natural key rather than inventing an unnecessary `No`.
- Subordinate subjects SHOULD use a deterministic parent-anchored composite reference instead of a global `No`.
- Examples of canonical subordinate references include:
1. `approvalNo + stepNo`
2. `ticketNo + targetEnv + releaseVersion`
3. `caseNo + version`
4. `releaseNo + businessKey`
5. `journalNo + lineNo`
6. `clearingNo + lineNo`

## 4) Read-Model and Search Contract
- Operator list/detail pages MUST prioritize operatorKey over `id`.
- Admin exact-match filters MUST prefer `No/Code/compositeRef`.
- `keyword` search MAY complement exact filters but MUST NOT replace them.
- `id` MAY appear in internal DTOs and routes, but it MUST NOT be the default operator lookup language.

## 5) Cross-Subject Binding Rule
- Where a subject is routinely surfaced with a linked subject, the payload SHOULD expose both:
1. `...Id`
2. `...No` or natural key
- Workflow-bound subjects SHOULD carry:
1. `workflowId`
2. `workflowNo`
3. `traceId`

## 6) Invariants
- A concept MUST have one canonical operator-facing name and one canonical operator-facing key.
- Compatibility aliases MUST NOT appear as competing identity fields in active DTOs.
- Missing operator-facing identity on a first-class subject is a contract gap, not a cosmetic issue.

## 7) Forbidden Patterns
- MUST NOT introduce a new first-class subject that only has `id`.
- MUST NOT expose random, unstable, or human-unfriendly strings as the primary operator key.
- MUST NOT require operators to query first-class subjects only by UUID.

## 8) Change Protocol
- Any identity contract change MUST include:
1. old key
2. new key
3. migration/read-model impact
4. audit/filter/search impact
