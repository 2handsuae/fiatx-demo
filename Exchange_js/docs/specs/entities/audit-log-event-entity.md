Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/constraints/audit-logging-constraints.md`, `docs/specs/modules/audit-logging-module.md`
Source of Truth Level: specs-entity

# Audit Log Event Entity

## Purpose
- This document defines `AuditLogEvent` as the canonical cross-domain audit evidence record.

## Canonical Fields
- Identity:
  - `id`
  - `auditNo`
- Classification:
  - `triggerType`
  - `action`
  - `module`
  - `entityType`
- Linkage:
  - `entityId`
  - `entityNo`
  - `traceId`
  - `workflowType`
  - `workflowId`
  - `workflowNo`
  - `entityOwnerType`
  - `entityOwnerId`
  - `entityOwnerNo`
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
  - `subjectNos[]`

## Canonical Meaning
- `AuditLogEvent` is the durable evidence record for what happened, who triggered it, what subject it touched, and what result occurred.
- `auditNo` is the operator-facing audit event identifier.
- `AuditLogEvent` is an event subject and evidence root; it is not a business workflow root.

## Write Owners
- `AuditLogsService` owns canonical write semantics.
- Feature modules may request audit writes, but MUST NOT bypass canonical audit logging.

## Read-Model Notes
- Audit Center list/detail surfaces query this entity as the primary truth.
- `subjectNos[]` are part of the operator-facing audit lookup contract.

## Historical / Retired Notes
- Legacy domain audit tables remain historical or compatibility context only and MUST NOT become the write truth for new behavior.
