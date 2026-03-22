# Wave 2 / Wave 3 Final Closure Plan

Status: archived
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Wave 2` alert / case kernel, `Wave 3` onboarding / periodic review final closure
Supersedes: none
Depends On: `docs/cleanup/wave-2-cleanup-master-plan.md`, `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/roadmap/project-version-plan.md`
Source of Truth Level: cleanup-master

## Completion Summary
- `Wave 2` 与 `Wave 3` 的 final closure 已完成。
- 已完成内容包括：
  - active compatibility route / permission surface retirement
  - canonical case / alert / response / customer contract cutover
  - legacy public-status/helper retirement from active runtime
  - `onboarding_audit_logs` 退出运行时真相
  - final acceptance and entity-spec documentation closure

## Achieved End State
- `Wave 2` / `Wave 3` active runtime now uses canonical contract, canonical workflow semantics, and canonical audit truth.
- `alert / case` active runtime semantics are documented as platform kernel semantics.
- onboarding / periodic review active runtime no longer depend on legacy response/status compatibility layers.
- `audit_log_events` is the canonical audit truth used for replay and evidence export.

## Closure Tracks
### Track A: Wave 2 Runtime Retirement
- completed:
  - retired `/admin/compliance/incidents/**` active surface and related aliases
  - production pages and read-models now keep only:
  - `caseNo`
  - `assignee*`
  - `filingStatus`
- legacy fields such as `incidentNo / ownerUserId / ownerUserNo / reportStatus / reportRefNo / reportedAt / reportReason`
  now remain only in:
  - migration
  - normalization/backfill helper
  - 历史修复脚本
  - legacy export fixtures

### Track B: Wave 2 Kernel Generalization
- completed:
  - workflow-bound case / alert no longer rely on active legacy case contract
  - adapter-style workflow root / stage / rule / decision semantics are now the documented long-term boundary
- fixed adapter contract:
  - workflow root
  - stage / rule
  - allowed workflow decisions
  - post-MLRO transition callback
- transaction / generic case semantics are now documented as separate consumers of the same case kernel.

### Track C: Wave 3 Runtime Retirement
- completed:
  - retired `toResponsePayload(caseNo/caseType -> responseNo/responseType)` active compatibility layer
  - retired `getLegacyPublicStatusFromCanonical(...)` from active runtime
  - onboarding / periodic review now use:
  - canonical onboarding status
  - canonical response identity
  - canonical final approval summary

### Track D: Audit Mirror Retirement
- completed:
  - `onboarding_audit_logs` no longer participates in active runtime truth
  - canonical trace query, evidence export, and Audit Center use `audit_log_events`
  - historical mirror rows remain only as archived compatibility context

### Track E: Physical Cleanup
- completed after runtime cutover:
  - retired compat route / permission code from active runtime
  - retired active compat DTO and page-contract usage
  - retired legacy helper from active runtime
  - retired active mirror write path

## Search Gates
- 下列 token 只允许存在于 migration、backfill、历史兼容 helper、历史测试样本中：
  - `incidentNo`
  - `ownerUserId`
  - `ownerUserNo`
  - `reportStatus`
  - `APPROVE_STAGE`
  - `REJECT_STAGE`
  - `NO_ACTION`
  - `getLegacyPublicStatusFromCanonical`
  - `/admin/compliance/incidents`

## Final Acceptance Reference
- Final runtime validation is now carried by:
  - `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`
- Completed outcomes:
  - Wave 2 alert / case / MLRO / filing now use canonical contract
  - Wave 3 onboarding / periodic review response chain uses canonical response identity
  - Audit Center can replay `response -> alert -> case -> MLRO -> approval -> filing`

## Historical Note
- This file is retained as the archived record of the final closure wave.
- Current long-term truth is now carried by:
  - `docs/constraints/**`
  - `docs/specs/workflows/**`
  - `docs/specs/entities/**`
  - `docs/acceptance/**`
