# Cleanup Docs

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: cleanup

## Purpose
- Use this folder for staged legacy cleanup and compatibility removal history.
- Cleanup documents explain how the codebase converged from old semantics to canonical runtime truth.

## Required Reading Order
1. `docs/constraints/**`, `docs/specs/**`, and `docs/acceptance/**` for current truth
2. the relevant wave completion note or phase plan under `docs/roadmap/**`
3. the relevant residual inventory or cleanup master for the wave you are touching
4. final closure plans only when retirement history matters

## Current Cleanup Documents
- Cross-wave priority summary:
  - `docs/cleanup/cross-wave-cleanup-priority-summary.md`
- Wave 1 residual inventory:
  - `docs/cleanup/wave-1-residual-cleanup-inventory.md`
- Wave 1 code candidate list:
  - `docs/cleanup/wave-1-code-cleanup-candidate-list.md`
- Wave 1 master:
  - `docs/cleanup/wave-1-governance-audit-cleanup-master-plan.md`
- Wave 2 residual inventory:
  - `docs/cleanup/wave-2-residual-cleanup-inventory.md`
- Wave 3 residual inventory:
  - `docs/cleanup/wave-3-residual-cleanup-inventory.md`
- Wave 2 master:
  - `docs/cleanup/wave-2-cleanup-master-plan.md`
- Wave 3 master:
  - `docs/cleanup/wave-3-cleanup-master-plan.md`
- Wave 4 master:
  - `docs/cleanup/wave-4-cleanup-master-plan.md`
- Wave 5 master:
  - `docs/cleanup/wave-5-cleanup-master-plan.md`
- Wave 5 residual inventory:
  - `docs/cleanup/wave-5-residual-cleanup-inventory.md`
- Wave 6 master:
  - `docs/cleanup/wave-6-cleanup-master-plan.md`
- Wave 6 residual inventory:
  - `docs/cleanup/wave-6-residual-cleanup-inventory.md`
- Wave 7 master:
  - `docs/cleanup/wave-7-cleanup-master-plan.md`
- Wave 7 residual inventory:
  - `docs/cleanup/wave-7-residual-cleanup-inventory.md`
- Wave 4 retirement inventory:
  - `docs/cleanup/wave-4-field-retirement-inventory.md`
- Final closure:
  - `docs/cleanup/wave-2-wave-3-final-closure-plan.md`
- Stage documents:
  - `docs/cleanup/stage-1-canonical-runtime-cutover.md`
  - `docs/cleanup/stage-2-response-naming-and-contract-convergence.md`
  - `docs/cleanup/stage-3-deprecated-alias-retirement.md`
  - `docs/cleanup/stage-4-customer-auth-and-read-model-convergence.md`
  - `docs/cleanup/stage-5-physical-schema-and-model-cleanup.md`
  - `docs/cleanup/stage-6-compatibility-contract-cleanup.md`
  - `docs/cleanup/stage-7-physical-rename.md`
  - `docs/cleanup/stage-8-frontend-bundling-optimization.md`

## Current Status
- For any broad cleanup sequencing discussion across multiple waves, start from:
  - `docs/cleanup/cross-wave-cleanup-priority-summary.md`
- `Wave 1` governance / audit master 已退回为 closeout history；当前若仍需处理 Wave 1，只允许按 residual inventory 执行：
  - `docs/cleanup/wave-1-residual-cleanup-inventory.md`
  - 允许范围仅限 `doc/index-only`、`physical-only`、`dead-code-only`
  - 长期真相仍在 `docs/constraints/**`、`docs/specs/**`、`docs/acceptance/**`
- `Wave 2` 与 `Wave 3` 的 cleanup 文档都已退为历史完成记录。
- `Wave 2` 截至 `2026-03-30` 已完成 core convergence；active case kernel query / export filters 与 legacy decision normalization duplication 已收口到 canonical / shared compatibility 边界。后续若清理 `incidentNo / owner* / report* / shared legacy decision compatibility edge`，应先读：
  - `docs/cleanup/wave-2-residual-cleanup-inventory.md`
  - 这类工作不应被误判为“Wave 2 已经完全没有残余”，但也不再属于未完成核心 runtime
- `Wave 3` 截至 `2026-03-30` 已完成 core convergence；active workflow output 已不再输出 compatibility `finalApprovalStatus`，`Customer Detail` 中的 `onboardingAuditLogs` 也已明确降为 archived context。后续若清理 `caseNo / caseType / archived onboardingAuditLogs / ownerUserId fallback`，应先读：
  - `docs/cleanup/wave-3-residual-cleanup-inventory.md`
  - 这类工作不应被误判为“Wave 3 已经完全没有残余”，但也不再属于未完成核心 runtime
- `Wave 4` cleanup master 与 retirement inventory 已进入 closeout history 入口。
- `Wave 4` cleanup round 1-3 之后，又完成了 post-cleanup remediation，用于补齐 governance audit logging 与 core runtime type conformance。
- `Wave 4` 截至 `2026-03-30` 已完成 closeout，当前应按 residual-only 阅读：
  - `docs/cleanup/wave-4-cleanup-master-plan.md`
  - `docs/cleanup/wave-4-field-retirement-inventory.md`
  - 当前还应继续记住：
    - active operator/admin debt 已收口
    - acceptance 已从 `draft` 升为 active closeout baseline
    - 剩余内容主要是历史 migration SQL 与 cleanup 记录
- `Wave 5` cleanup / closeout 已完成；runtime 主链按 `Phase 0-4` 已完成，acceptance / runbook / truth hardening 已落地，delivery hygiene 已按 `4` 个交付单元完成收口：
  - `Runtime Core`
  - `Simulation Surface`
  - `Alert / Transaction Case Integration`
  - `Docs / Index / Cleanup Meta`
- `docs/cleanup/wave-5-cleanup-master-plan.md` 现在保留为 closure record，不再作为 active backlog。
- `Wave 5` 截至 `2026-03-30` 已完成 active route / operator-surface residual retirement；`tx-cases/mock-backfill` 已退休，`TX_DEPOSIT_TRAVEL_RULE` 只剩历史 replay / ingestion 边界，tx response lifecycle normalization 只剩 compatibility edge。后续若继续收窄这些历史边界，应先读：
  - `docs/cleanup/wave-5-residual-cleanup-inventory.md`
  - 这类工作不应被误判为“Wave 5 主链没有任何残余”，但也不再属于 active admin/runtime debt
- `Wave 6` runtime 主链与 cleanup 已完成，当前处于 `runtime complete, cleanup complete` 状态；`docs/cleanup/wave-6-cleanup-master-plan.md` 现保留为 completed closure record：
  - Stage 1-5 已完成 runtime / trace / compatibility shell / docs-index 收口
  - Stage 6 已完成 manual-risk truth convergence 与 final closeout audit
  - retained compatibility 仍需以 cleanup master 中的边界说明为准
- `Wave 6` 截至 `2026-03-30` 已完成 active operator / audit / evidence-root residual retirement；当前只剩冻结的 shared manual-risk compatibility memory。后续若重新触碰这类边界，应先读：
  - `docs/cleanup/wave-6-residual-cleanup-inventory.md`
  - 这类工作不应被误判为“需要重新打开 Wave 6 cleanup 主线程”
- `Wave 7` Phase 0-4 runtime、minimum reconciliation、withdraw evidence export、以及 Stage 1-5 cleanup convergence 已落地。
- `Wave 7` 截至当前审查已完成 cleanup closeout；`docs/cleanup/wave-7-cleanup-master-plan.md` 现保留为 closure record：
  - active operator-surface debt 已收口
  - active residual retirement 也已完成
  - 当前只保留冻结的 historical / compatibility closure record，见：
    - `docs/cleanup/wave-7-residual-cleanup-inventory.md`
  - 当前仍需记住但不再作为开放 residual 的是：
    - 旧库值 `CLEAR` 与旧 raw lifecycle 输入仍通过 read-boundary normalization 被吸收
    - historical `TX_WITHDRAW_PRECHECK / REVIEW_WITHDRAW_PRECHECK` replay support 仍保留为 read-only evidence boundary
    - legacy response lifecycle input support 仍冻结在 compatibility adapter
  - 当前长期真相仍在 `constraints/specs/acceptance`，不在 cleanup 层
- 当前长期真相不在 cleanup 层，而在：
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`

## Update When
- A legacy alias is introduced or removed.
- A cleanup stage starts, advances, or completes.
- A field or route changes from compatibility-only to physically deleted or migration-ready.

## Minimum Stage Structure
- current debt
- target end state
- in-scope
- out-of-scope
- preconditions
- implementation notes
- acceptance / exit criteria
- blockers / rollback note

## Do Not Use For
- Long-term source-of-truth behavior.
- Product roadmap sequencing unless cleanup itself is the subject.
