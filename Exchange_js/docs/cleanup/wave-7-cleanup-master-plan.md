# Wave 7 Cleanup Master Plan

Status: active
Owner: project-owner-and-agents
Last Updated: 2026-03-27
Applies To: `Exchange_js`
Supersedes: none
Depends On:
- `docs/roadmap/wave-7-withdraw-payout-phase-plan.md`
- `docs/roadmap/project-version-plan.md`
- `docs/constraints/customer-transaction-flow-constraints.md`
- `docs/constraints/posting-clearing-balance-projection-constraints.md`
- `docs/constraints/safeguarding-reconciliation-constraints.md`
- `docs/constraints/audit-logging-constraints.md`
- `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
- `docs/specs/workflows/safeguarding-reconciliation-workflow.md`
- `docs/specs/entities/withdraw-transaction-entity.md`
- `docs/specs/entities/payout-entity.md`
- `docs/specs/entities/reconciliation-break-entity.md`
- `docs/acceptance/wave-7-withdraw-payout-final-acceptance-checklist.md`
- `docs/acceptance/wave-7-withdraw-accounting-blocked-runbook.md`
- `docs/acceptance/wave-7-withdraw-evidence-export-runbook.md`
- `docs/acceptance/wave-7-minimum-daily-reconciliation-runbook.md`
Source of Truth Level: cleanup

## Current Position
- 以 `2026-03-27` 当前仓库状态看，`Wave 7` 应视为 `runtime implementation-complete`，但 `cleanup / closeout` 仍未完成。
- 当前主链已具备：
  - canonical `Withdraw -> Payout`
  - `TX_WITHDRAW_PRECHECK / TX_WITHDRAW_FINAL`
  - `alert / case -> canonical withdraw callback`
  - `FAILED / RETURNED` canonical compensation replay
  - extreme-volatility runtime gate
  - minimum daily reconciliation
  - approval-backed withdraw evidence export
- 当前 durable truth 已收口到：
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- cleanup 层当前不再负责定义 `Wave 7` 行为真相；本文件只用于记录：
  - 当前剩余 cleanup debt
  - retained surface 边界
  - compatibility shell 退役顺序
  - 文档与索引收口要求
  - `Wave 8` handoff 边界

## Current Debt
- 当前已不存在新的 `Wave 7` 产品能力缺口；剩余问题主要是 cleanup / closeout 层面的收口：
  - retained dev/operator surface 尚未像 `Wave 5/6` 那样被正式冻结
  - `Wave 7` roadmap 仍混合了一部分“历史 gap 叙事”和“当前已落地能力”
  - `withdraw` 兼容壳仍然存在，但边界尚未在 cleanup 层正式锁死：
    - `WithdrawTransactionStatus.APPROVED`
    - internal-only terminal action constants
  - transaction compliance 的 callback / mock-complete / read-only evidence surface 还没有在 `Wave 7 cleanup` 里被分类为 retained 或候选 retirement
  - minimum reconciliation 与 withdraw evidence export 已落地，但 closeout 层还没有形成统一的:
    - retained compatibility inventory
    - deleted-anchor / old wording retirement plan
    - `Wave 8` 明确 handoff

## Target End State
- `Wave 7` 被明确标记为：
  - runtime implementation-complete
  - cleanup complete
- `docs/roadmap/wave-7-withdraw-payout-phase-plan.md` 保留为历史 phase 计划与 sequencing record，不再承担当前是否“还缺产品能力”的判断。
- `docs/cleanup/wave-7-cleanup-master-plan.md` 作为 `Wave 7` closeout closure record 保留，统一回答：
  - 哪些 surface 必须保留
  - 哪些 shell 只是 compatibility，不再是 active truth
  - 哪些 dead helper / old wording / duplicate surface 可以退休
  - 哪些 follow-up 明确属于 `Wave 8`

## Scope
- 只做 `Wave 7` post-implementation cleanup / convergence 规划。
- 只记录 stage 目标、债务边界、退役顺序和验证标准。
- 允许记录 retained operator / developer surface，但仅限与 `withdraw / payout / tx compliance / reconciliation / evidence export` 直接耦合的能力。
- 允许把 `Wave 8` handoff 作为 cleanup 输出的一部分固定下来。

## Out Of Scope
- 不新增新的 `Wave 7` runtime feature。
- 不把 `Wave 8` 的 full safeguarding reconciliation、threshold / escalation、funding / treasury coverage 提前塞回 `Wave 7 cleanup`。
- 不把 cleanup 文档改写成新的长期行为真相文档。
- 不在本文直接执行 schema 删除、route 删除、breaking API change 或 UI 重构。
- 不把与 `Wave 7` 无关的通用 case UX、通用 frontend 优化或 treasury 运营台建设纳入本计划。

## Current Implemented Baseline
- `Withdraw -> Payout` canonical runtime 已形成正式闭环：
  - `src/modules/trading/withdraw-transactions/**`
  - `src/modules/asset-treasury/payouts/**`
  - `src/orchestrators/withdraw-workflow.orchestrator.ts`
  - `src/orchestrators/payout-closeout-repair.controller.ts`
- withdraw 侧 transaction risk、alert / case、callback 已接通：
  - `src/modules/risk-engine/transaction-compliance/**`
  - `src/modules/risk-engine/transaction-risk-bridge.service.ts`
  - `src/modules/risk-engine/compliance-alerts/**`
  - `src/modules/risk-engine/compliance-incidents/**`
  - `src/modules/trading/withdraw-transactions/withdraw-transaction-workflow.service.ts`
- accounting / compensation / evidence closeout 已接入提现主链：
  - `src/orchestrators/accounting-event-execution.service.ts`
  - `src/modules/accounting/journals/**`
  - `src/modules/clearing-settle/clearing/**`
  - `src/modules/risk-engine/audit-logs/**`
- `Phase 4` minimum daily reconciliation 已作为独立 runtime 落地：
  - `src/modules/clearing-settle/safeguarding-reconciliation/**`
  - `admin-web/src/pages/SafeguardingBreakList.tsx`
  - `admin-web/src/pages/SafeguardingBreakDetail.tsx`
- withdraw evidence export 已并入现有 approval-backed export 主链：
  - `POST /admin/audit-logs/export/evidence-package`
  - `workflowType = WITHDRAW`
  - `reconciliationBreaks` 已进入 evidence package snapshots

## Retained Dev / Operator Surface
- 下列 surface 是 `Wave 7` 当前有意保留的 developer / operator support capability，不属于 cleanup debt：
  - `POST /payouts/:id/re-closeout`
  - `POST /payouts/:id/re-compensate`
  - `POST /admin/compliance/tx-kyt-cases/callback`
  - `POST /admin/compliance/tx-travel-rule-cases/callback`
  - `POST /admin/compliance/tx-kyt-cases/mock-complete`
  - `POST /admin/compliance/tx-travel-rule-cases/mock-complete`
  - admin `simulateWithdrawal(...)`
  - `POST /admin/reconciliation/safeguarding-breaks/generate-daily-diff`
- 这些 surface 的定位必须保持清晰：
  - `callback` 是 canonical external evidence ingestion path
  - `mock-complete` 是 developer / demo / UAT support surface
  - `re-closeout / re-compensate` 是 operator repair surface
  - `simulateWithdrawal` 是 read-only 演示 /运营支持能力
  - `generate-daily-diff` 是 operator-run Phase 4 reconciliation trigger，不是后台自动 job
- cleanup 规则固定为：
  - retained surface 不是 debt
  - orphan、重复、未暴露、未被 UI/controller/docs 依赖的 helper 才是 cleanup debt

## Retained Compatibility Shell
- 下列项在当前阶段视为 retained compatibility，不属于 immediate retirement：
  - `WithdrawTransactionStatus.APPROVED`
    - 仅作为兼容枚举保留
    - 不再是 `Wave 7` happy path 主语义
  - internal-only `success / fail / return / clear` action constants
    - 允许 workflow / orchestrator / system 使用
    - 不允许重新暴露成 admin happy-path 入口
- cleanup 固定判断为：
  - retained compatibility 可以继续留在 schema / enum / service transition map 中
  - 但不能继续占据主 UI、主 API、主 acceptance 叙事

## Cleanup Stages
### Stage 1: Contract Freeze And Surface Classification
- 当前状态：
  - runtime implementation complete on `2026-03-27`
  - retained operator/developer surface 已存在，但尚未完成 cleanup 层冻结
- 目标：
  - 正式锁定哪些入口是 retained surface，哪些才属于 retirement 候选
- 主要任务：
  - 冻结 repair surface：
    - `re-closeout`
    - `re-compensate`
  - 冻结 tx compliance support surface：
    - callback ingestion
    - mock-complete
  - 冻结 `simulateWithdrawal` 与 manual `generate-daily-diff` 的定位
  - 冻结 `APPROVED` 和 internal terminal actions 的 compatibility-only 语义
- 退出标准：
  - 后续 cleanup 线程不再把上述 retained surface 误判为 dead code
  - 后续若要退休 retained surface，必须先补一轮 operator decision + boundary review

### Stage 2: Runtime Shell And Alias Audit
- 当前状态：
  - `Wave 7` canonical runtime 已成立，但 compatibility shell 仍物理存在
- 目标：
  - 梳理哪些 runtime shell 仍承担活跃调用，哪些已经只是历史兼容
- 主要任务：
  - 审计 `withdraw / payout` 仍保留的 legacy transition / enum shell
  - 审计 controller / DTO / admin-web 是否仍存在 direct terminal path 残留
  - 审计 `WITHDRAW` trace root 是否已在 audit / evidence / UI 检索层完全替代旧 transaction-root 心智
  - 清点所有与 `Wave 7` 直接相关但已不再承担 runtime truth 的 helper / alias / wording
- 退出标准：
  - compatibility shell 与 active runtime surface 的边界清晰
  - 若存在 orphan helper，可进入单独 retirement 线程
  - cleanup 不再依赖“边改边猜哪些还能删”

### Stage 3: Reconciliation And Evidence Read-Model Convergence
- 当前状态：
  - minimum daily reconciliation 与 withdraw evidence export 已可运行
  - 但 Phase 4 仍需要一轮 cleanup 级别的读模型 / 叙事收口
- 目标：
  - 让 reconciliation 与 evidence export 的主叙事固定围绕 `withdrawId / withdrawNo` 收口
- 主要任务：
  - 审计 admin list / detail / export summary 是否存在 duplicate wording 或 generic fallback 主位
  - 确认 `reconciliation alert` 始终保持 non-workflow-bound，不回写交易终态
  - 确认 evidence package 中：
    - `withdrawNo` 是 primary workflow summary
    - `payout`、`risk`、`journals`、`clearings`、`reconciliationBreaks` 都作为关联证据回放
  - 清理已经不需要继续占据主叙事的 generic compatibility wording
- 退出标准：
  - Audit Center、Evidence Center、Reconciliation Center 的 `Wave 7` 主叙事一致
  - 不存在第二套“提现证据导出语义”或“提现日对账语义”

### Stage 4: Docs / Index / Historical Wording Cleanup
- 当前状态：
  - `Wave 7` docs 已从 draft 提升为 active
  - 但 roadmap / cleanup / index 仍存在部分 “active/in-progress” 或 “历史缺口” 口径
- 目标：
  - 把 `Wave 7` 的文档入口统一到 `runtime complete, cleanup active` 的真实状态
- 主要任务：
  - 规范 `docs/README.md`、`docs/roadmap/README.md`、`docs/cleanup/README.md` 的 `Wave 7` 口径
  - 把 phase plan 中仅用于历史解释的 gap wording 与当前 active truth 明确分层
  - 清理已完成能力仍被写成“缺失”的表述
  - 统一 `Wave 7` 与 `Wave 8` 的 handoff 边界描述
- 退出标准：
  - docs index 不再把 `Wave 7` 写成“功能仍未落地”
  - 读者能清楚区分：
    - 当前 truth
    - historical planning context
    - Wave 8 follow-up

### Stage 5: Final Closeout Audit And Wave 8 Handoff
- 当前状态：
  - `Wave 7` 行为真相已在 `constraints/specs/acceptance` 层落档
  - cleanup 还没有形成最终 closeout audit 结论
- 目标：
  - 完成 `Wave 7` 最后一轮 closeout audit，并把剩余问题全部 handoff 到 `Wave 8` 或独立 retirement 线程
- 主要任务：
  - 固定 `Wave 7` focused verification baseline
  - 固定 retained compatibility inventory
  - 明确 `Wave 8` owns：
    - full safeguarding reconciliation
    - threshold / escalation
    - funding / treasury coverage
    - richer treasury operations tooling
  - 将 `Wave 7 cleanup master` 从 active backlog 转为 closure record
- 退出标准：
  - `Wave 7` 可正式标记为 `runtime complete, cleanup complete`
  - 剩余工作被明确标注为 `Wave 8` 或独立 cleanup/remediation thread

## Stage Ordering Rationale
- 先做 `Stage 1`，因为 `Wave 7` 新增了 repair、simulation、callback、reconciliation trigger 等多类 support surface；如果不先冻结 retained surface，后续 cleanup 很容易误删运营入口。
- 再做 `Stage 2`，因为 compatibility shell / alias 是否还能删，必须先基于真实调用面审计，而不是只看命名。
- 然后做 `Stage 3`，因为 reconciliation 与 evidence export 是 `Phase 4` 新增面，最容易留下 duplicate read model 或 generic fallback 主叙事。
- 再做 `Stage 4`，把 roadmap / index / cleanup wording 同步到收口后的真实状态，避免代码已经完成、文档还在说“缺功能”。
- 最后做 `Stage 5`，统一验证、handoff 与 closure record，把 `Wave 8` 的范围彻底从 `Wave 7 cleanup` 中切出去。

## Residual Inventory

| Item | Current Anchor | Status | Cleanup Position |
| --- | --- | --- | --- |
| canonical withdraw / payout runtime | withdraw/payout services + orchestrator + admin UI | done | treat as implementation-complete |
| tx-risk / alert / case / callback | tx compliance + risk engine + compliance center | done | treat as implementation-complete |
| minimum daily reconciliation | safeguarding-reconciliation module + admin UI + docs | done | treat as implementation-complete |
| withdraw evidence export | audit-logs evidence package + approval workflow | done | treat as implementation-complete |
| repair surface | `re-closeout`, `re-compensate` | retained | keep, document boundary, do not retire in cleanup by default |
| tx evidence support surface | callback + mock-complete | retained | keep, classify explicitly, retire only by separate decision |
| admin simulation / manual diff trigger | `simulateWithdrawal`, `generate-daily-diff` | retained | keep as operator/dev support |
| compatibility enum shell | `WithdrawTransactionStatus.APPROVED` | retained compatibility | keep out of main truth; evaluate only after caller audit |
| Wave 8 boundary wording | roadmap / cleanup / index docs | open cleanup task | normalize and handoff explicitly |

## Verification Baseline
- 本 cleanup 规划基于以下 `Wave 7` 当前验证事实：
  - focused withdraw / payout / orchestrator / tx-risk / pricing / audit / reconciliation specs 已按阶段补齐
  - Phase 4 新增 focused tests 已覆盖：
    - `SafeguardingReconciliationService`
    - withdraw evidence export snapshots
    - safeguarding-break RBAC routes
  - backend `npm run build` 通过
  - `admin-web` build 通过
- 因此当前判断应为：
  - runtime-complete
  - cleanup-not-complete

## Exit Criteria
- `Wave 7` cleanup 完成时，至少应满足：
  - retained surface 已被冻结并写成明确 inventory
  - compatibility shell 与 active truth 的边界已固定
  - reconciliation / evidence export / admin read model 不再存在 duplicate 主叙事
  - docs / roadmap / cleanup / index 不再把已完成能力写成 active feature gap
  - `Wave 8` handoff 已明确，`Wave 7` 不再继续承接 full safeguarding backlog
  - cleanup master 能从 active plan 退为 closure record

## Rollback / Compatibility Note
- 本计划是 cleanup backlog，不是新的产品波次。
- cleanup 执行时应遵守：
  - 先冻结 retained surface
  - 再审计 compatibility shell / active callers
  - 最后才做 retirement 与 docs wording 删除
- 若任一阶段发现 active caller 仍依赖兼容层：
  - 优先回退到“保留兼容壳并明示 retained status”
  - 不得为了完成 cleanup 而破坏当前 `Wave 7` 主链、repair surface 或 operator support capability
