# Wave 5 Cleanup Master Plan

Status: archived
Owner: project-owner-and-agents
Last Updated: 2026-03-26
Applies To: `Exchange_js`
Supersedes: none
Depends On:
- `docs/roadmap/wave-5-payin-deposit-phase-plan.md`
- `docs/roadmap/project-version-plan.md`
- `docs/constraints/customer-transaction-flow-constraints.md`
- `docs/constraints/compliance-alert-incident-constraints.md`
- `docs/constraints/audit-logging-constraints.md`
- `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`
Source of Truth Level: cleanup

## Current Position
- 以 `2026-03-26` 的仓库状态与验证基线看，`Wave 5` 充值主链应视为 `runtime implementation-complete`，且本轮 cleanup / closeout 已完成。
- 当前 durable truth 已收口到：
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- cleanup 层不再承担行为真相职责；本文件现仅作为 closure record 保留，用于记录：
  - closeout 判断
  - retained surface 边界
  - dead-surface retirement 与 delivery hygiene 历史
- 当前不再存在活跃的 `Wave 5` cleanup batching 任务；后续若有新清理项，应作为独立 retirement / remediation 线程处理。

## Target End State
- `Wave 5` 已被明确标记为：runtime implementation-complete，且 closeout complete。
- `docs/roadmap/wave-5-payin-deposit-phase-plan.md` 保留为历史 phase 计划参考，不再承担主链完成度判断。
- `docs/cleanup/wave-5-cleanup-master-plan.md` 作为 `Wave 5` closeout closure record 保留，统一说明：
  - 哪些 surface 必须保留
  - 哪些项属于 dead code / dead helper cleanup
  - 哪些项属于 delivery hygiene

## Scope
- 记录 `Wave 5` 主链完成判定与验证基线。
- 明确保留项、cleanup 候选项、delivery hygiene backlog。
- 作为后续 runtime cleanup 线程的决策入口，而不是新的行为规范文档。

## Out Of Scope
- 不改 `case` 通用模型或 case 页面行为。
- 不新增新的充值主链功能。
- 不把 cleanup 文档写成新的长期 source of truth。
- 不在本文直接执行 git 打包、release、或 dead code 删除。

## Current Implemented Baseline
- `PayIn -> Deposit` 主工作流已形成正式 runtime 闭环：
  - `src/modules/asset-treasury/payins/**`
  - `src/modules/trading/deposit-transactions/**`
  - `src/orchestrators/deposit-workflow.service.ts`
- deposit 侧 `tx compliance -> risk decision -> alert / case` 已接通：
  - `src/modules/risk-engine/transaction-compliance/**`
  - `src/modules/risk-engine/risk-engine.service.ts`
  - `src/modules/risk-engine/compliance-alerts/**`
  - `src/modules/risk-engine/compliance-incidents/**`
- `alert / case -> deposit callback` 与 customer canonical gate 已落地：
  - `src/modules/trading/deposit-transactions/transaction-deposit-workflow.service.ts`
  - `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
  - `src/modules/identity/onboarding/workflow-transition.service.ts`
- accounting 与 evidence closeout 已接入充值主链：
  - `src/orchestrators/deposit-workflow.service.ts`
  - `src/modules/risk-engine/audit-logs/audit-logs.service.ts`
  - `src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts`
  - `src/modules/asset-treasury/internal-funds/internal-funds.service.ts`

## Retained Dev / Operator Surface
- 下列 surface 是 `Wave 5` 当前有意保留的 developer / operator support capability，不属于 cleanup debt：
  - `POST /admin/treasury/payins/:id/mock-event`
  - `POST /admin/compliance/tx-kyt-cases/mock-complete`
  - `POST /admin/compliance/tx-travel-rule-cases/mock-complete`
  - `Simulation Mode`
  - `SimulationRail`
  - client `/deposit` 的模拟入口
  - `PATCH /deposit-transactions/:id/status?action=payin_confirmed` 这条 compensation-only path
- 这些 surface 的定位必须保持清晰：
  - simulation-only 用于开发 / 演示 / UAT 推进
  - compensation-only 用于人工补偿与运维修复
- 规则固定为：
  - developer simulation surface 不是 debt
  - orphan、未暴露、未被 UI/controller/docs 依赖的 helper 才是 cleanup debt
- 本轮未被明确归类的 repair helper 保持不动；是否退休需要单独线程决定。

## Cleanup Backlog
### A. Contract Freeze
- 固定 `Wave 5` canonical 入口与长期真相来源：
  - 正常主链真相在 `constraints/specs/acceptance`
  - cleanup 只记录收口与退役
- 固定边界语义：
  - simulation-only surface 保留
  - compensation-only surface 保留
  - cleanup 不再尝试把这些入口解释为产品 debt
- 任何后续 closeout 线程都必须先遵守这条判断：
  - 不得为了“瘦身”删除现有 simulation / compensation contract

### B. Runtime Cleanup
- 当前已完成的最小 cleanup：
  - Cleanup Batch 1 已移除 `src/modules/asset-treasury/payins/payins.service.ts` 中未暴露、未被 UI/controller/docs 使用的 orphan `simulate()` 方法，以及对应 `SimulatePayinDto`
- 当前已完成的 delivery packaging：
  - Cleanup Batch 3 已将 `Runtime Core` 作为独立交付单元完成验证，当前 runtime 主链可在不依赖 simulation UI 与 alert/case 公开契约页面的前提下独立解释。
  - Cleanup Batch 4 已将 `Simulation Surface` 作为独立交付单元完成验证，当前 developer/operator simulation surface 已能与 runtime core 分开解释与验收。
  - Cleanup Batch 5 已将 `Alert / Transaction Case Integration` 作为独立交付单元完成验证，当前 alert canonical contract、transaction case closeout 与 MLRO 回驱已能作为单独行为面解释。
- 当前剩余 cleanup 候选包括：
  - 其余未被引用的 dead helper、旧 demo 入口、历史 planning wording
- runtime cleanup 的执行顺序必须是：
  1. 先做引用 / grep 审计
  2. 确认不属于 retained dev/operator surface
  3. 再执行删除
- 对于交易合规 repair helper、mock backfill 这类未在本轮明确归类的入口：
  - 默认保持不动
  - 若未来要退役，必须先补一轮 operator decision + boundary review

### C. Delivery Hygiene
- 当前 `Wave 5` delivery hygiene closeout 已完成：
  - dirty worktree 已按 `4` 个 delivery units 固定边界并完成验证
  - roadmap / cleanup / docs index 已统一到 closeout-complete 口径
  - cleanup master 已退为 closure record
- 若后续还要继续做文档或提交整理，应按独立 delivery / release 线程处理，而不是继续扩展 `Wave 5` cleanup batch。
- 若后续需要新增 closeout 文档，只能是：
  - release packaging note
  - retirement inventory
  - operator/UAT delivery record
- 不应再新增第二份 Wave 5 cleanup 主文档。

## Frozen Delivery Units
### 1. Runtime Core
- 这组承载 `Wave 5` 充值主链真正的后端运行时闭环，必须作为第一层交付：
  - `payin / inbound signal / deposit / tx compliance / risk bridge / deposit orchestrator`
  - `prisma` schema 与 migrations
  - `internal collection` 自动触发关闭
  - 与上述行为直接绑定的 spec / constraints / acceptance 文档
- 当前状态：
  - 已在 Cleanup Batch 3 中完成打包与验证
  - 允许纳入 `compliance-alerts.service.ts`、`compliance-incidents.service.ts` 中仅用于 deposit runtime 主链闭环的 backend-only 逻辑
  - 不包含 alert/case 的公开契约、RBAC、admin 页面收口
- 代表路径：
  - `src/modules/trading/deposit-transactions/**`
  - `src/modules/asset-treasury/payins/**`
  - `src/modules/risk-engine/transaction-compliance/**`
  - `src/orchestrators/deposit-workflow.service*`
  - `src/orchestrators/internal-collection-workflow.orchestrator*`
  - `prisma/**`
  - `docs/constraints/customer-transaction-flow-constraints.md`
  - `docs/specs/workflows/payin-deposit-canonical-workflow.md`
  - `docs/acceptance/wave-5-*.md`

### 2. Simulation Surface
- 这组是明确保留的 developer / operator surface，不参与 runtime dead-code retirement：
  - `POST /admin/treasury/payins/:id/mock-event`
  - `POST /admin/compliance/tx-kyt-cases/mock-complete`
  - `POST /admin/compliance/tx-travel-rule-cases/mock-complete`
  - `Simulation Mode`
  - `SimulationRail`
  - client `/deposit` 模拟入口
- 当前状态：
  - 已在 Cleanup Batch 4 中完成打包与验证
  - 包含 simulation-only 权限、admin 路由、client/admin 页面与 route wiring
  - 不包含 alert/case resolution 的公开契约与页面收口
- 代表路径：
  - `admin-web/src/components/SimulationRail.tsx`
  - `admin-web/src/components/DashboardLayout.tsx`
  - `admin-web/src/pages/PayinDetail.tsx`
  - `admin-web/src/pages/TransactionKytResponseDetailPage.tsx`
  - `admin-web/src/pages/TransactionTravelRuleResponseDetailPage.tsx`
  - `admin-web/src/pages/PayinList.tsx`
  - `admin-web/src/pages/DepositTransactionDetail.tsx`
  - `admin-web/src/pages/DepositTransactionList.tsx`
  - `client-web/src/pages/Deposit.tsx`
  - `client-web/src/utils/simulationMode.ts`
  - `src/modules/asset-treasury/payins/payins.admin.controller.ts`

### 3. Alert / Transaction Case Integration
- 这组只收口与 `transaction workflow` 直接耦合的 alert/case 行为，不展开成通用 case cleanup：
  - `Alert Handling` 与 `resolve` 契约
  - `primaryObject / availableHandlingActions / availableDirectProposals`
  - transaction case 的 workflow proposal / MLRO 回驱
  - 对应 RBAC、controller、spec、admin 页面
- 当前状态：
  - 已在 Cleanup Batch 5 中完成打包与验证
  - 仅收口 transaction workflow 直接耦合的 alert/case 行为
  - 不包含 docs 索引层收尾，也不扩展为通用 case UX 重构
- 代表路径：
  - `src/modules/risk-engine/compliance-alerts/**`
  - `src/modules/risk-engine/compliance-incidents/**`
  - `src/modules/identity/access-control/rbac.catalog*`
  - `src/modules/identity/onboarding/onboarding-admin.controller.ts`
  - `src/modules/identity/periodic-review/periodic-review-admin.controller.ts`
  - `admin-web/src/pages/ComplianceAlertDetailPage.tsx`
  - `admin-web/src/pages/ComplianceAlertsPage.tsx`
  - `admin-web/src/pages/ComplianceCaseDetailPage.tsx`
  - 对应 alert docs / constraints / module docs
- `ComplianceCaseDetailPage` 在本组中的定位仅限 transaction workflow closeout，不视为通用 case UX 收口。

### 4. Docs / Index / Cleanup Meta
- 这组只放导航、索引、cleanup master、roadmap 汇总，不承载运行时行为。
- 代表路径：
  - `docs/README.md`
  - `docs/specs/README.md`
  - `docs/specs/entities/README.md`
  - `docs/specs/workflows/README.md`
  - `docs/acceptance/README.md`
  - `docs/cleanup/README.md`
  - `docs/roadmap/README.md`
  - `docs/roadmap/project-version-plan.md`
  - `docs/cleanup/wave-5-cleanup-master-plan.md`
- 这组必须最后交付，确保索引反映前 `3` 组的最终边界。

## Delivery Rules
- 当前 `Wave 5` closeout 的固定交付顺序为：
  1. `Runtime Core`
  2. `Simulation Surface`
  3. `Alert / Transaction Case Integration`
  4. `Docs / Index / Cleanup Meta`
- 每一组都必须做到“代码、测试、文档”自洽，不允许把行为放在前一组、再把行为真相说明拖到最后的 docs 组补写。
- 唯一允许后置统一更新的文件是：
  - `docs/cleanup/wave-5-cleanup-master-plan.md`
- 运行时真相文档必须跟随所属行为组交付，不能只留在 cleanup 层追记。
- 本轮不继续删除更多 runtime helper，除非它已经满足：
  - 无公开入口
  - 无 UI 调用
  - 无文档契约依赖
- `POST /admin/compliance/tx-cases/mock-backfill` 已在 `2026-03-30` 的 residual-retirement 线程中退休：
  - 已从 active controller / service / DTO / RBAC route catalog 删除
  - 若未来仍需历史修复，必须改走 dedicated script 或 one-off remediation 线程

## Residual Inventory

| Item | Current Anchor | Status | Cleanup Position |
| --- | --- | --- | --- |
| Wave 5 主链完成判定 | acceptance + focused tests + build baseline | done | treat as implementation-complete |
| historical tx-case admin backfill route | `tx-cases/mock-backfill` | retired on `2026-03-30` | do not restore without a new remediation decision |
| simulation / compensation surface | payin mock-event, tx mock-complete, simulation UI, `payin_confirmed` compensation path | retained | keep, document boundary, do not retire in cleanup |
| orphan / dead helper | `PayinsService.simulate()` / `SimulatePayinDto` | done in cleanup batch 1 | retired after reference audit; future orphan helpers require the same rule |
| historical planning wording | roadmap / cleanup wording that still sounds like open feature gap | done in cleanup batch 6 | normalized to closeout-complete wording in roadmap / cleanup / docs indexes |
| dirty worktree / delivery packaging | current working tree snapshot | docs / index / cleanup meta packaged in cleanup batch 6 | all frozen delivery units completed; no active Wave 5 batching remains |

## Verification Baseline
- 本 cleanup 判定基于 `2026-03-26` 的验证结果：
  - `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`
  - `Wave 5` focused Jest suite：`15/15` 通过，`190` 个测试全绿
  - backend `npm run build` 通过
  - `admin-web` build 通过
  - `client-web` build 通过
- 这组验证足以支持当前结论：
  - `Wave 5` 主链已完成
  - cleanup 目标是 closeout 与瘦身，而不是继续补业务闭环

## Recorded Delivery Hygiene Refresh (2026-03-26)
- Cleanup Batch 3（`Runtime Core`）已完成以下验证：
  - `npx jest ... --runInBand`，覆盖 `payins / inbound signal / deposit / tx compliance / transaction risk bridge / risk engine / risk decision records / audit logs / internal transactions / internal funds / workflow transition / compliance-alerts service / compliance-incidents service`
  - 结果：`16/16` suites 通过，`194` tests 全绿
  - backend `npm run build` 通过
- Cleanup Batch 4（`Simulation Surface`）已完成以下验证：
  - `npx jest src/modules/asset-treasury/payins/payins.service.spec.ts src/modules/risk-engine/transaction-compliance/transaction-compliance-admin.controller.spec.ts src/modules/identity/access-control/rbac.catalog.spec.ts --runInBand`
  - 结果：`3/3` suites 通过，`27` tests 全绿
  - backend `npm run build` 通过
  - `admin-web` build 通过
  - `client-web` build 通过
- Cleanup Batch 5（`Alert / Transaction Case Integration`）已完成以下验证：
  - `npx jest src/modules/risk-engine/compliance-alerts/compliance-alerts-admin.controller.spec.ts src/modules/risk-engine/compliance-alerts/compliance-alerts.service.spec.ts src/modules/risk-engine/compliance-alerts/dto/compliance-alert.dto.spec.ts src/modules/risk-engine/compliance-incidents/compliance-incidents.service.spec.ts src/modules/identity/access-control/rbac.catalog.spec.ts src/modules/identity/onboarding/onboarding-admin.controller.spec.ts src/modules/identity/periodic-review/periodic-review-admin.controller.spec.ts --runInBand`
  - 结果：`7/7` suites 通过，`107` tests 全绿
  - backend `npm run build` 通过
  - `admin-web` build 通过
- Cleanup Batch 6（`Docs / Index / Cleanup Meta`）已完成以下验证：
  - `rg` 自检 cleanup / roadmap / docs index 中关于 `Wave 5` closeout 的进行时表述、batch 进度与 closure record 定位
  - 校验 `docs/README.md`、`docs/cleanup/README.md`、`docs/roadmap/README.md`、`docs/roadmap/project-version-plan.md`、`docs/roadmap/wave-5-payin-deposit-phase-plan.md`、`docs/cleanup/wave-5-cleanup-master-plan.md` 的索引路径均存在
- 这次刷新说明：
  - runtime core 可以独立作为后端交付单元成立
  - simulation surface 可以独立作为 retained developer/operator capability 成立
  - alert / transaction case integration 可以独立作为 transaction workflow closeout 行为面成立
  - docs / index / cleanup meta 已完成最终收尾，`Wave 5` cleanup 不再处于 active batching 状态

## Verification Order For Delivery Hygiene
- `Runtime Core`
  - `Wave 5` focused backend specs
  - backend `npm run build`
- `Simulation Surface`
  - admin `npm run build`
  - client `npm run build`
  - 相关 controller / spec 最小回归
- `Alert / Transaction Case Integration`
  - `compliance-alerts`、`compliance-incidents`、`rbac`、`onboarding/periodic-review controller` 相关 specs
  - backend `npm run build`
  - admin `npm run build`
- `Docs / Index / Cleanup Meta`
  - `rg` 自检旧术语、旧路由、错误索引
  - 不额外要求业务测试

## Exit Criteria
- `Wave 5` cleanup master 已成为可发现的 closure record。
- 本文当前能够明确回答：
  - `Wave 5` 已完成，且 closeout complete
  - `Wave 5` 的 durable truth 在 `constraints/specs/acceptance`
  - 不能删除的仍是 simulation 与 compensation surface
  - 可以继续清理的仍然仅限未暴露、未引用、无产品职责的 orphan helper
- delivery hygiene 的 `4` 个 delivery units 已全部完成：
  - `Batch 3 / Runtime Core`
  - `Batch 4 / Simulation Surface`
  - `Batch 5 / Alert / Transaction Case Integration`
  - `Batch 6 / Docs / Index / Cleanup Meta`
- cleanup backlog 已按 `contract freeze / runtime cleanup / delivery hygiene` 分层归档记录。
- 本文不再作为 active backlog 使用；后续如有新增退休项，应新开独立 cleanup / remediation 线程。

## Rollback / Compatibility Note
- 本轮是纯文档 cleanup，不改变 runtime 行为。
- 本文不会覆盖 `docs/constraints/**` 与 `docs/specs/**` 的长期真相。
- 如果后续代码 hardening 或接受标准发生变化，应优先更新对应 `constraints/specs/acceptance`，再回写本 cleanup 文档的阶段状态。
