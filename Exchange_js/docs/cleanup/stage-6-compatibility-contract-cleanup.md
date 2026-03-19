# Stage 6: Compatibility Contract Cleanup

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: onboarding next-step contract, response payload aliases, legacy status display/snapshot cleanup
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/constraints/onboarding-flow-constraints.md`
Source of Truth Level: cleanup-stage

## Current Debt
- Stage 6 已完成后，onboarding / periodic review 的对外 contract 不再暴露 `publicStatus`、`caseNo`、`caseType` 这类 compatibility 字段。
- 当前遗留已不属于本阶段，而是后续两条线：
  - `Stage 7`: physical/runtime symbol rename
  - `Stage 8`: frontend bundling optimization

## Target End State
- onboarding/customer/compliance 相关主链不再暴露或依赖 legacy status contract。
- response payload 只保留 canonical response 语义字段。
- operator-facing 文案与 detail snapshot 全部改成 canonical summary 或明确的 compatibility-only 描述。

## In Scope
- `/onboarding/next-step` compatibility contract 的后续处理。
- response payload 中 `caseNo / caseType` alias。
- legacy helper、legacy status operator-facing 文案、decision-record compatibility snapshot。

## Out Of Scope
- `CddResponse / EddResponse / WorkflowDecisionRecord` 物理 rename。
- route、schema、Prisma model 的 rename。
- 前端 bundling 优化。

## Preconditions
- Stage 1 到 Stage 5 已完成。
- admin/client 已切到 canonical runtime judgment 和 response-named routes。

## Implementation Notes
- 已完成项：
  - `GET /onboarding/next-step` 已删除 `publicStatus`
  - onboarding / periodic review response payload 与 session payload 已删除 `caseNo / caseType`
  - `CreateResponseSessionDto` 已删除 `caseType` 输入 alias，只接受 `responseType`
  - `client-web/src/utils/customerOnboarding.ts` 已删除 legacy public-status helper
  - alerts / incidents operator-facing onboarding decision 文案已切到 canonical summary
  - `risk-decision-records` detail 已删除 `customer.publicStatus` snapshot
- 内部实现仍允许保留 `caseType`、`CddResponse / EddResponse`、`WorkflowDecisionRecord` 等 symbol；这明确留给 `Stage 7`
- transaction compliance 域的真实 case/status 语义继续排除在本阶段之外。

## Acceptance / Exit Criteria
- `/onboarding/next-step` 不再返回 `publicStatus`
- response payload 与 response session payload 不再返回 `caseNo / caseType`
- admin/client/risk-decision 相关展示不再把 `publicStatus` 当作 operator-facing 状态文本
- backend build、Stage 6 定向测试、admin/client build 全部通过

## Blockers / Rollback Note
- 这是 breaking cleanup；若外部脚本仍依赖 `next-step.publicStatus` 或 `caseNo / caseType`，必须改脚本而不是恢复兼容空壳。
