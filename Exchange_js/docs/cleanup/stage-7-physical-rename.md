# Stage 7: Physical Rename

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: legacy physical/runtime naming in onboarding and periodic review
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/cleanup/stage-6-compatibility-contract-cleanup.md`
Source of Truth Level: cleanup-stage

## Current Debt
- 本阶段启动前，onboarding / periodic review / risk-decision 仍残留 `CddResponse / EddResponse / WorkflowDecisionRecord` 物理与运行时命名。
- 周期复审内部仍保留 `currentCddResponseId / currentEddResponseId` 之前的 case-era 指针命名遗留。
- admin response 页面文件名与 backend DTO / spec symbol 也仍有旧实现命名。

## Target End State
- onboarding / periodic review / risk-decision 相关物理命名与当前领域语义一致。
- 旧物理命名不再出现在主实现、fixture、DTO 和测试里。

## In Scope
- `CddResponse / EddResponse` 相关内部/物理命名。
- `WorkflowDecisionRecord` 相关内部/物理命名。
- 与之直接耦合的 DTO、fixture、test、service symbol rename。

## Out Of Scope
- compatibility contract 删除。
- 前端 bundling 优化。
- transaction compliance 的真实 case 命名。

## Preconditions
- Stage 6 已完成，不再存在需要保留的同层兼容 contract。
- response-named routes 和 canonical customer read-model 已稳定。

## Implementation Notes
- 这是一轮 rename，不应顺手修改业务语义。
- 必须先确认 Prisma/schema、service symbol、DTO、fixture、spec 的 rename 顺序，避免半 rename 状态。
- 迁移和命名变更必须配套更新文档与 acceptance。

## Acceptance / Exit Criteria
- `CddResponse / EddResponse / WorkflowDecisionRecord` 的主实现命名已完成迁移。
- 对应测试、fixture、read-model、文档全部跟上。
- 不再需要在 cleanup 文档中把旧物理名作为长期兼容层说明。
- 当前状态：已完成。schema / migration、Prisma client、backend service/DTO/spec、admin response 页面文件名与周期复审内部指针已统一到 response/workflow 命名。

## Blockers / Rollback Note
- 任何 rename 都可能影响历史脚本、SQL、fixture 或演示环境；实施前必须先做全仓引用扫描，避免遗漏。
