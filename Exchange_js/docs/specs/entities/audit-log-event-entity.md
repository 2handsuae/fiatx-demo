Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-03
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/audit-logging-constraints.md`, `docs/specs/modules/audit-logging-module.md`
Source of Truth Level: specs-entity

# Audit Log Event Entity

## Purpose
- This document defines `AuditLogEvent` as the canonical cross-domain audit evidence record.

## Canonical Fields
- Typed Core:
  - `id`
  - `auditNo`
  - `triggerType`
  - `action`
  - `module`
  - `entityType`
- Lookup Anchors:
  - `entityId`
  - `entityNo`
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`
  - `entityOwnerType`
  - `entityOwnerId`
  - `entityOwnerNo`
- Operator Lookup Layer:
  - `subjectNos[]`
- Context JSON:
  - `requestId`
  - `sourceIp`
  - `sourcePlatform`
  - `metadata`
  - `beforeData`
  - `afterData`
- Actor and result:
  - `actorType`
  - `actorId`
  - `actorNo`
  - `actorRole`
  - `result`
  - `reason`
- Governance and retention:
  - `idempotencyKey`
  - `payloadDigest`
  - `maskVersion`
  - `retainedUntil`
  - `occurredAt`

## Canonical Meaning
- `AuditLogEvent` is the durable typed-core evidence record for what happened, who triggered it, what subject it touched, and what result occurred.
- `auditNo` is the operator-facing audit event identifier.
- `subjectNos[]` is the operator-facing multi-anchor lookup layer derived from subject rows, not the canonical truth itself.
- `metadata`, `beforeData`, and `afterData` are masked context JSON attached to the event; they are not the source of truth.
- `AuditLogEvent` is an event evidence root; it is not a business workflow root.

## Write Owners
- `AuditLogsService` owns canonical write semantics.
- Feature modules may request audit writes, but MUST NOT bypass canonical audit logging.

## Read-Model Notes
- Audit Center list/detail surfaces query this entity as the primary truth.
- `subjectNos[]` are part of the operator-facing audit lookup contract.
- Exact `subjectNo` search and `traceId + workflowType/workflowNo` search are separate read paths and SHOULD stay separate in callers and DTOs.

## Historical / Retired Notes
- Legacy domain audit tables remain historical or compatibility context only and MUST NOT become the write truth for new behavior.
