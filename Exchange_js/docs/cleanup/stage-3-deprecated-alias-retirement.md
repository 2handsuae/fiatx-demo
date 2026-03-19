# Stage 3 Cleanup: Deprecated Alias Retirement

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: deprecated runtime paths and compatibility-only aliases
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/cleanup/stage-2-response-naming-and-contract-convergence.md`
Source of Truth Level: cleanup-stage

## Current Debt
- Stage 3A 已完成：direct customer control 旧入口、死 review route、`final-review` compatibility alias 已从 runtime 与 RBAC 中删除。
- Stage 3B 已完成：case-named response route、dashboard redirect alias 与对应 RBAC/permission alias 使用已从第一方运行时中移除。

## Target End State
- 所有已完成替代的 deprecated alias 被删除，不再挂在运行时里。
- operator 只能看到且只能调用当前正式入口。

## In Scope
- direct customer control 旧入口。
- 旧 review route。
- `final-review` compatibility alias。
- Stage 2 之后的 case-named alias route。

## Out Of Scope
- schema 字段删除。
- auth 语义迁移。

## Preconditions
- Stage 2 已经提供完整替代入口。
- admin/client 已切换到新入口。

## Implementation Notes
- 删除前要先确认没有 active 页面、测试、seed 演示脚本仍依赖旧路径。
- 对外 contract 删除顺序必须和文档、前端调用、RBAC 注册一起推进。

## Acceptance / Exit Criteria
- runtime 中不再保留只会报 conflict/deprecated 的死入口。
- deprecated alias 从 controller、RBAC、前端调用点中同步消失。
- cleanup 文档中的 alias 清单被标记为 retired。

## Stage 3A Completion
- 已删除 `/customers/:id/status`、`/customers/:id/freeze`、`/customers/:id/unfreeze`。
- 已删除 `POST /admin/compliance/customers/:id/final-review`。
- 已删除 `POST /admin/compliance/cdd-cases/:id/review` 与 `POST /admin/compliance/edd-cases/:id/mlro-review`。
- 已同步删除对应的 RBAC route definition、controller spec 和 deprecated service/spec 壳。
- `cdd-cases / edd-cases / cases / sessions` 这组 response alias route 已移交 Stage 3B 处理。

## Stage 3B Completion
- 已删除 admin onboarding response 的 case-named alias route：`/admin/compliance/cdd-cases*`、`/admin/compliance/edd-cases*`。
- 已删除 onboarding customer response 的 case-named alias route：`/onboarding/cases`、`/onboarding/cdd-cases/*`、`/onboarding/edd-cases/*`、`/onboarding/sessions/*`。
- 已删除 periodic review customer response 的 case-named alias route：`/periodic-review/cases`、`/periodic-review/cdd-cases/*`、`/periodic-review/edd-cases/*`、`/periodic-review/sessions/*`。
- 已删除 admin dashboard 的 `cdd-cases / edd-cases` redirect alias。
- 已删除 `CDD_CASES_READ / EDD_CASES_READ` 第一方 permission alias 使用，以及 `GET /admin/compliance/cdd-cases*`、`GET /admin/compliance/edd-cases*` 的 RBAC route definition。
- `responseNo / responseType` 仍是 canonical wire 字段，`caseNo / caseType` 仍保留为 payload compatibility alias，不在本阶段删除。

## Blockers / Rollback Note
- 若演示链路或 acceptance checklist 仍引用旧入口，则需要先完成文档和页面切换，再删 route。
