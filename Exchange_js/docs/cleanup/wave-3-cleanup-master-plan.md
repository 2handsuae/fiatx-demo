# Wave 3 Cleanup Master Plan

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-19
Applies To: `Wave 3` customer onboarding / customer management / periodic review
Supersedes: none
Depends On: `docs/roadmap/wave-3-customer-onboarding-phase-plan.md`, `docs/constraints/onboarding-flow-constraints.md`, `docs/constraints/compliance-alert-case-foundation-constraints.md`
Source of Truth Level: cleanup-master

## Current Debt
- Wave 3 cleanup 的 `Stage 1` 到 `Stage 8` 已全部完成。
- `CustomerMain` legacy customer fields、compatibility contracts、physical rename、frontend bundling warning 已全部收口。
- 当前在 Wave 3 范围内没有剩余的 planned cleanup debt；后续仅保留常规增量维护，不再作为 Wave 3 cleanup stage 管理。

## Target End State
- onboarding、customer management、periodic review 全部以 canonical 状态和 canonical read-model 为主，不再依赖 legacy mirror 字段进行业务判断。
- `CDD/EDD Response` 在文案、路由、DTO、权限、页面类型、服务名上统一完成 response 语义收口。
- 所有 deprecated alias 在具备替代入口后被显式删除，不再长期保留死兼容层。
- customer auth 和 customer read-model 只保留 canonical 语义，legacy account / legacy status 不再承担业务真相。
- 最终收掉剩余 compatibility contract，并在合适时机执行物理模型 rename 与前端 bundling 优化。

## Stage Overview
1. `Stage 1`：Canonical Runtime Cutover
   - status: completed
   - result: runtime judgment has been cut over for client onboarding/profile, admin customer overview, and `/customers?status` filtering
2. `Stage 2`：Response Naming And Contract Convergence
   - status: completed
   - result: canonical response-named routes and response alias fields are introduced; admin/client now default to response-named routes, while old case-named routes remain as compatibility aliases pending Stage 3 retirement
3. `Stage 3`：Deprecated Alias Retirement
   - status: completed
   - result: dead/deprecated aliases and case-named response route aliases are retired from runtime; payload alias fields remain for later cleanup
4. `Stage 4`：Customer Auth And Read-model Convergence
   - status: completed
   - result: customer login gate now uses canonical hold semantics, `/verification` onboarding mode uses canonical UI steps, and customer admin/client primary status presentation has converged to canonical-first read-models with compatibility fields isolated
5. `Stage 5`：Physical Schema And Model Cleanup
   - status: completed
   - result: legacy customer fields have been removed from `CustomerMain`, customer-facing/admin-facing payloads no longer expose them, and seeds/tests have been converged
6. `Stage 6`：Compatibility Contract Cleanup
   - status: completed
   - result: removed `next-step.publicStatus`, removed onboarding / periodic-review response alias fields (`caseNo / caseType`), cleaned legacy operator-facing status copy, and converged Stage 6 tests/build outputs to response-only contracts
7. `Stage 7`：Physical Rename
   - status: completed
   - result: Prisma models / relations, backend runtime symbols, admin page files, and periodic review internal pointers have been renamed to response/workflow semantics
8. `Stage 8`：Frontend Bundling Optimization
   - status: completed
   - result: page-level route lazy loading is in place for both `admin-web` and `client-web`; both builds now pass without Vite large chunk warnings and no `manualChunks` configuration was needed

## Compatibility Matrix
| Item | Current Role | Target Role | Planned Stage |
| --- | --- | --- | --- |
| `publicStatus` | removed from customer schema/payload and `next-step` contract | delete | Completed in Stage 6 |
| `cddStatus / eddStatus` | removed from customer schema/payload | delete | Completed in Stage 5 |
| `complianceStatus` | removed from customer schema/payload | delete | Completed in Stage 5 |
| `finalApprovalStatus*` | removed from customer schema/payload; replaced by `latestFinalApproval*` summary | keep summary only | Completed in Stage 5 |
| `accountStatus*` | removed from customer schema/payload and auth gate | canonical gate only | Completed in Stage 5 |
| `currentCddResponseId / currentEddResponseId / activeCaseId / activeCaseType` | removed from customer schema/payload | workflow-bound summary or response lookup | Completed in Stage 5 |
| response payload `caseNo / caseType` aliases | removed from onboarding / periodic-review wire payload | response-only payload | Completed in Stage 6 |
| `cdd-cases / edd-cases` routes and DTOs | compatibility DTO/field naming | response naming | Stage 2 -> Stage 3 |
| deprecated control/review aliases | compatibility-only runtime path | delete | Stage 3 |
| `WorkflowDecisionRecord` physical name | renamed and aligned with current shared decision-record semantics | keep current name | Completed in Stage 7 |

Stage 1 note:
- The legacy status fields above no longer drive primary runtime judgment in onboarding/profile/customer overview flows. Remaining usage is compatibility output, legacy display, or later-stage cleanup work.

## Stage Mapping
### Stage 1: Canonical Runtime Cutover
- 先清运行时依赖，不删字段。
- 目标是让 canonical 字段成为唯一业务判断真相，legacy 字段只做镜像或只读兼容输出。

### Stage 2: Response Naming And Contract Convergence
- 统一 `CDD/EDD Response` 的接口、文案、RBAC、DTO、前端本地类型和服务命名。
- 旧 case-named 入口先保留 alias，直到新 contract 落稳。

### Stage 3: Deprecated Alias Retirement
- 删除 direct customer control 的旧写入口、死 review route、`final-review` 等兼容别名。
- 删除前提是已有新入口且前端已切换。
- 当前已完成：runtime route alias、dashboard redirect alias、RBAC route alias 全部退役；剩余仅是 payload 和内部命名兼容。

### Stage 4: Customer Auth And Read-model Convergence
- 清理 `accountStatus*`、legacy badges、legacy status panels、legacy pointers。
- 完成 customer auth / customer detail / customer list 的统一语义。
- 当前状态：已完成。auth gate 已切到 canonical hold 语义；`/verification` onboarding UI step 已去掉 legacy public-status 主投影；customer/admin 主位 UI 已把 legacy status/account 降到 compatibility 区。

### Stage 5: Physical Schema And Model Cleanup
- 最后删除 schema 中已无读写用途的 legacy 字段。
- 当前状态：已完成 legacy customer fields cleanup；后续 physical rename 已在 Stage 7 完成。

### Stage 6: Compatibility Contract Cleanup
- 当前状态：已完成。
- `GET /onboarding/next-step` 已删除 `publicStatus`
- onboarding / periodic-review response payload 与 session payload 已删除 `caseNo / caseType`
- `customerOnboarding.ts` 的 legacy public-status helper 已删除
- alerts / incidents / risk-decision detail 已切到 canonical summary，不再暴露 `customer.publicStatus`

### Stage 7: Physical Rename
- 当前状态：已完成。
- `CddResponse / EddResponse / WorkflowDecisionRecord` 的 Prisma 模型、runtime symbol、测试、fixture、admin 页面文件名和周期复审指针命名都已统一。
- 这一阶段不改公开路由或 wire contract，只完成内部实现与物理命名收口。

### Stage 8: Frontend Bundling Optimization
- 当前状态：已完成。
- `admin-web` 与 `client-web` 已完成页面级路由懒加载。
- 本轮仅靠 lazy loading 即消除了 large chunk warning，因此未引入 `manualChunks`。
- 若后续页面继续膨胀，再单独评估新的 chunk 策略。

## Deletion Order
1. 先移除页面和服务对 legacy 字段的真实依赖。
2. 再收口外部 contract 和 route 命名。
3. 再删除 deprecated alias。
4. 再迁移 auth/read-model 的 legacy 语义。
5. 最后删除 schema 字段并执行物理 rename。

## Blockers And Defaults
- `transaction compliance` 的 `KYT/TRV case` 不纳入本轮 Wave 3 cleanup 主线，只在边界说明中保留。
- 任何 physical rename 都不得早于 runtime dependency 清理。
- 若某 legacy 字段仍被 client/admin 页面真实依赖，则只能标记为 `cleanup pending`，不得提前删除。
- periodic review cycle 自身的 `currentCddResponseId / currentEddResponseId` 仍是有效周期字段，不得误归类为已删除的 customer legacy pointer。
