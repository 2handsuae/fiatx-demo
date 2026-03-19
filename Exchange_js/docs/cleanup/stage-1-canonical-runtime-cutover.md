# Stage 1 Cleanup: Canonical Runtime Cutover

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: onboarding runtime, customer profile/runtime projections, admin customer overview
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`
Source of Truth Level: cleanup-stage

## Current Debt
- Stage 1 范围内的运行时主依赖已经完成切换。
- 当前剩余 legacy status 主要以 compatibility output / legacy display 形式存在，不再属于 Stage 1 阻塞项。
- 与 `CDD/EDD response` 命名、contract、RBAC、菜单、route alias 相关的问题已移入 `Stage 2`。
- `CustomerDetail` 的 mirror / legacy snapshot 深度收口已移入 `Stage 4`。

## Target End State
- 所有业务判断改为 canonical-first 并最终收口到 canonical-only。
- legacy mirror 字段只保留为兼容输出，不再驱动页面主流程、统计、筛选、准入判断。

## In Scope
- client onboarding 和 customer profile 的状态判断。
- admin customer list / customer detail 中依赖 legacy status 的统计与主判断。
- backend customer list/filter 中依赖 legacy mirror 的逻辑。

## Out Of Scope
- route rename。
- schema 字段删除。
- deprecated alias 删除。

## Preconditions
- canonical 字段和 periodic review workflow 已经落地。
- 现有页面已有 canonical 字段可读。

## Implementation Notes
- `/verification` 需要从 `publicStatus + actions[]` 过渡到 canonical-driven projection；如仍保留 `next-step` 兼容层，也只能作为 fallback。
- `CustomerManagement` 的 overview 统计、筛选与主要 badge 要改成 `onboardingStatus / operatingStatus / restrictionStatus / complianceHoldStatus`。
- `CustomerProfile` 的 approved/rejected/final-pending/in-progress 判断改为 canonical-only。
- `publicStatus / cddStatus / eddStatus / complianceStatus / finalApprovalStatus` 保留响应输出，但统一标记为 compatibility mirror。

## Acceptance / Exit Criteria
- `publicStatus` 不再参与主流程判断、列表统计和准入判断。
- 所有 runtime 主判断都能在不依赖 legacy 字段的前提下完成。
- legacy 字段仍可输出，但删除它们不会再造成业务逻辑缺失。

## Current Progress
- client `/verification` 的 onboarding 主投影已切到 canonical 状态；`next-step.publicStatus` 仅保留为兼容动作/fallback 层。
- `CustomerProfile`、`customerOnboarding` helper、`AuthGuard` 这条客户主路径已改成 canonical-only 判断。
- admin `CustomerManagement` overview 和主 badge 已切到 canonical 口径，`CustomerDetail` 首屏也已把 canonical 放到主位。
- `/customers?status` 已保留兼容参数名，但内部按 canonical 条件过滤，legacy 值只做映射输入。
- legacy mirror 字段仍保留输出与局部展示，完整 read-model 收口继续留在 `Stage 4`。

## Stage Status
- completed

## Blockers / Rollback Note
- 如果某页面仍必须通过旧 API contract 获取状态，则只能保留 fallback，不允许继续扩散新的 legacy 依赖。
