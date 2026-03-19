# Stage 2 Cleanup: Response Naming And Contract Convergence

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: onboarding and periodic review response naming
Supersedes: none
Depends On: `docs/cleanup/wave-3-cleanup-master-plan.md`, `docs/cleanup/stage-1-canonical-runtime-cutover.md`
Source of Truth Level: cleanup-stage

## Current Debt
- 页面标题已部分改成 `CDD Response / EDD Response`，但路由、DTO、控制器路径、RBAC、服务名和前端本地类型仍大量使用 `cdd-cases / edd-cases / caseType / caseNo`。
- periodic review 和 onboarding 两套 contract 都仍在复用 case 语义字段。
- admin 菜单、Swagger summary、RBAC 标签与响应 shape 之间还不统一。

## Target End State
- onboarding / periodic review 的 `CDD/EDD` 主体在所有 operator-facing 与 app-facing 合同中统一为 `response` 语义。
- 旧 case-named 合同只作为过渡 alias，并在下一阶段删除。

## In Scope
- 页面和菜单命名。
- route、DTO、controller summary、前端 type、RBAC label、服务命名。
- onboarding 和 periodic review 两套 response contract 的统一化。

## Out Of Scope
- `KYT / Travel Rule` 等 transaction compliance case 命名。
- physical model rename。

## Preconditions
- Stage 1 已完成，运行时判断不再依赖 legacy status。
- 客户端和 admin 已能承受 contract 的命名层切换。

## Implementation Notes
- 优先引入 response-named contract，并保留 case-named alias 以避免大范围一次性 breaking change。
- `caseNo / caseType` 需要规划成 compatibility 字段，新的命名应能表达 response identity 与 response kind。
- RBAC 和菜单文案要与页面和 Swagger 对齐，避免 operator 视角继续混用 `case` 和 `response`。

## Acceptance / Exit Criteria
- onboarding / periodic review 的 operator-facing 界面不再把 `CDD/EDD response` 称为 case。
- 新代码默认使用 response-named types 和 route/helper。
- case-named 路由和字段只剩明确标注的 alias。

## Current Progress
- Stage 2 已进入 contract 收口阶段，不再停留在纯展示命名调整。
- 已引入 response-named canonical routes：
  - admin: `cdd-responses / edd-responses`
  - onboarding: `responses / cdd-responses / edd-responses / response-sessions`
  - periodic review: `responses / cdd-responses / edd-responses / response-sessions`
- 旧 `cdd-cases / edd-cases / cases / sessions` 路径继续保留，但明确是 compatibility alias route。
- wire payload 已新增 `responseNo / responseType`，并继续保留 `caseNo / caseType` 作为 compatibility alias 字段。
- admin/client 默认调用和跳转已切到 response-named 路由；Stage 3 仅在确认旧 alias 无活跃依赖后再删除。

## Stage Status
- completed

## Blockers / Rollback Note
- 如果外部页面或测试 fixture 仍强依赖旧命名，允许短期保留 alias，但必须登记到 Stage 3 删除清单。
