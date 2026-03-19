# Stage 5 Cleanup: Physical Schema And Model Cleanup

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: prisma schema, physical models, seeds, fixtures, audit/entity resolvers
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/cleanup/stage-4-customer-auth-and-read-model-convergence.md`
Source of Truth Level: cleanup-stage

## Current Debt
- `CustomerMain` 上的 legacy customer 字段已完成本轮删除；Stage 6 也已进一步完成 next-step / response payload compatibility contract cleanup。
- `cddResponse / eddResponse` 与 `WorkflowDecisionRecord` 的物理命名仍落后于真实领域语义。
- transaction compliance 独立域仍保留其真实 `case` 语义，不在本轮清理。

## Target End State
- 已完成：删除 `CustomerMain` 上已无运行时真相作用的 legacy status / account / pointer 字段，并同步 read-model、payload、seeds、tests。
- 后续状态：compatibility contract cleanup 已由 `Stage 6` 完成；physical rename 已由 `Stage 7` 完成。

## In Scope
- prisma schema 删除 `CustomerMain` legacy customer 字段。
- migrations、seeds、fixtures、tests、customer read-model / auth / onboarding 适配。
- 记录物理 rename 后置边界。

## Out Of Scope
- `/onboarding/next-step` 的 `publicStatus` 删除。
- `CddResponse / EddResponse / WorkflowDecisionRecord` 物理 rename。
- `caseNo / caseType` payload alias 删除。
- transaction compliance 独立域的 case 命名清理。

## Preconditions
- Stage 1 到 Stage 4 已完成。
- 不再存在对 legacy 字段和旧命名的运行时依赖。

## Implementation Notes
- 删除前必须先完成 repo 全局搜索确认无运行时依赖。
- 物理 rename 只在外部 contract 和页面命名已经稳定后执行。
- migration 需要兼顾本地演示库和已有 acceptance 路径。

## Acceptance / Exit Criteria
- `CustomerMain` 已删除：
  - `accountStatus*`
  - `publicStatus`
  - `cddStatus`
  - `eddStatus`
  - `complianceStatus`
  - `finalApprovalStatus*`
  - `activeCaseType / activeCaseId / currentCddResponseId / currentEddResponseId`
- `GET /onboarding/me`、`GET /customers`、`GET /customers/:id` 不再返回上述 legacy customer 字段。
- schema、seed、tests、read-model 口径已与 canonical customer 模型对齐。
- 物理 rename 已明确后置，不作为本阶段阻塞项。

## Open Follow-ups
- `Stage 7 physical rename`
  - 已完成：`CddResponse / EddResponse / WorkflowDecisionRecord` 物理命名与直接耦合 symbol rename
- `Stage 8 frontend bundling follow-up`
  - 已完成：`admin-web` 和 `client-web` 已通过页面级路由懒加载消除 Vite large chunk warning

## Blockers / Rollback Note
- 若后续发现外部脚本仍依赖已删除 customer 字段，需要改脚本而不是恢复 schema。
- 本阶段依赖的后续 cleanup 已收口完成；后续不再需要恢复已删除 customer 字段。
