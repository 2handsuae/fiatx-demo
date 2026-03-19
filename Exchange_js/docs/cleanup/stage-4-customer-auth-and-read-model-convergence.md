# Stage 4 Cleanup: Customer Auth And Read-model Convergence

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: customer auth, customer detail/list read-models
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/cleanup/stage-3-deprecated-alias-retirement.md`
Source of Truth Level: cleanup-stage

## Current Debt
- `accountStatus*` 仍在部分 payload 和 compatibility 展示中保留，但不应继续承担冻结门禁真相。
- `activeCaseType / activeCaseId / currentCddResponseId / currentEddResponseId` 仍在 payload 和 compatibility 展示中保留旧式指针语义。
- `/verification` 和 customer/admin 页面仍保留少量 compatibility-only 字段与说明，留待 Stage 5 再评估是否物理删除。

## Target End State
- customer auth 完全以 canonical gating 为主，legacy account status 不再承担独立业务真相。
- customer read-model 以 canonical 状态、restriction/freeze 信息、workflow-bound summary 为主。
- 旧状态面板和旧 badge 被清退或显式标为历史兼容信息。

## In Scope
- customer auth gating。
- customer detail / customer management read-model 与 UI。
- legacy pointer 字段的 read-model 替换策略。

## Out Of Scope
- 物理 schema 删除。
- response route rename。

## Preconditions
- Stage 1 已完成。
- Stage 3 已删除大部分旧 runtime alias，减少双轨逻辑。

## Implementation Notes
- 先统一 auth gating 真相，再清 UI 展示，不要先删字段后补行为。
- 如果 legacy pointer 字段仍用于演示或外部兼容，需要先提供 workflow-bound summary 再删除。

## Acceptance / Exit Criteria
- 登录与准入不再依赖 `accountStatus`。
- customer list/detail 的主状态展示不再以 legacy 字段为核心。
- legacy 指针要么被新 summary 替代，要么被显式标记为 removable。

## Progress
- customer login gate 已切到 canonical `complianceHoldStatus = FROZEN`。
- `restrictionStatus = RESTRICTED` 保持只阻断交易，不阻断登录。
- `CustomerDetail` 顶部 badge 与主 `Compliance Snapshot` 已收口到 canonical 字段。
- legacy account / mirror status / pointer 字段已集中到单独 `Compatibility Snapshot` 区块。
- `CustomerManagement` 列表主状态与主要摘要已保持 canonical-first，legacy mirrors 只保留弱提示。
- client `/verification` onboarding 模式已改成 canonical step 投影，`publicStatus` 不再作为页面内部主状态机。
- `CustomerProfile` 主说明已移除 compatibility status，legacy 字段不再参与主叙事。

## Blockers / Rollback Note
- 若外部 token/jwt payload 仍依赖 `accountStatus`，需先完成 auth contract 迁移后再继续。
