# Wave 6 Cleanup Master Plan

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-30
Applies To: `Exchange_js`
Supersedes: none
Depends On:
- `docs/roadmap/wave-6-pricing-quote-swap-phase-plan.md`
- `docs/roadmap/project-version-plan.md`
- `docs/constraints/customer-transaction-flow-constraints.md`
- `docs/constraints/pricing-and-quote-constraints.md`
- `docs/constraints/audit-logging-constraints.md`
- `docs/specs/workflows/swap-canonical-workflow.md`
- `docs/specs/entities/swap-transaction-entity.md`
- `docs/acceptance/wave-6-swap-final-acceptance-checklist.md`
- `docs/acceptance/wave-6-best-execution-evidence-export-runbook.md`
Source of Truth Level: cleanup

## Current Position
- 以 `2026-03-27` 当前仓库状态看，`Wave 6` 兑换主链与 cleanup 应视为 completed：
  - `rate -> quote -> swap`
  - `TX_SWAP_FINAL`
  - `alert / case`
  - `SUCCESS / REJECTED / FAILED`
  - `fee / evidence export`
  - manual risk truth convergence
  - docs / index / acceptance rebaseline
- 当前 durable truth 已收口到：
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- `2026-03-30` closeout 进一步确认：
  - `SWAP` active trace root 已固定为 `swapId / swapNo`
  - quote-root audit / evidence selection expansion 已退休
  - quote-only swap export summary baseline 已退休
- cleanup 层当前不再负责定义 `Wave 6` 行为真相；本文件只用于记录：
  - 当前剩余 cleanup debt
  - 推荐的 stage 切分
  - compatibility shell 退役顺序
  - 文档与检索语义收口范围
- 本轮 cleanup 完成后的判断基线是：
  - 审计检索已收口
  - evidence/export 语义已统一
  - active read model 不再把 compatibility evidence 当主链真相
  - 文档和索引已同步到 shared manual-risk migration 后的真实链路

## Current Debt
- 当前已无 active Wave 6 cleanup debt。
- 当前仅保留 documented retained compatibility：
  - `ONBOARDING_CDD.mockDataType`
  - `InboundTransferSignal.simulationRiskLevel`
  - `InboundTransferSignal.simulationRiskReason`
  - historical alert metadata fallback on `simulationRisk*`
- `quoteId / quoteNo` 现在只保留为 linked evidence，不再是 `SWAP` 的 active workflow root 或 export root。
- 这些字段仍允许存在于 schema、旧 DTO、历史数据读取 fallback 中，但不再构成 Wave 6 runtime truth、主 UI 叙事或 acceptance 基线。

## Target End State
- `swap` 的审计、Evidence Center 检索与审批摘要统一围绕 `swapId / swapNo` 收口，`quoteId / quoteNo` 保留为关联证据，不再充当主 trace root。
- `Risk Execution` 手工模拟成为一等审计对象，必须稳定留下：
  - 谁触发
  - 何时触发
  - 选了什么风险等级
  - 生成了什么 reason code
  - 触发了什么下游 orchestration
- runtime 与 UI 不再依赖 `SwapTransactionAuditLog` 这类非 canonical 旧壳。
- transaction workflow 的输出不再使用 `depositNo` 这类跨领域兼容别名承载 `swapNo`。
- `ONBOARDING_CDD / TX_DEPOSIT_FINAL / TX_SWAP_FINAL` 不再依赖 legacy client risk input 字段解释行为。
- roadmap / cleanup / specs / constraints / acceptance 的入口文档不再包含已删除锚点和过期说明。

## Scope
- 只做 `Wave 6` post-implementation cleanup / convergence 规划。
- 只记录 stage 目标、债务边界、退役顺序和验证标准。
- 允许记录共享 risk simulation 迁移残留，但仅限与 `Wave 6` 直接耦合的 surface。
- 允许把 `swap` 审计检索与 evidence/export 语义统一纳入 cleanup backlog。

## Out Of Scope
- 不新增新的 swap 业务能力。
- 不扩展 multi-LP router 或真实 best execution venue selection。
- 不把 cleanup 文档重新写成新的行为真相文档。
- 不在本文直接执行 schema 删除、route 删除或 API breaking change。
- 不把与 `Wave 6` 无关的通用 frontend 重构或通用 case UX 重写纳入本计划。

## Stages
### Stage 1: Audit / Trace Canonicalization
- 当前状态：
  - runtime implementation complete on `2026-03-27`
  - 采用 `compatibility-query convergence`，未执行历史 audit 数据回填
- 目标：
  - 让 `swap` 的审计链、Risk Execution、Alert / Case、Evidence Center 在检索层面形成单一可解释 trace root。
- 主要任务：
  - 审计 `swap create / workflow transition / risk / alert / case / export` 当前使用的 `workflowType / workflowId / workflowNo`
  - 把 post-quote 的 `swap` 主链审计收口到 `swapId / swapNo`
  - 保留 `quoteId / quoteNo` 为关联对象，而不是 swap lifecycle 的主 trace root
  - 补齐并验证 `RISK_DECISION_MANUAL_SIMULATED`
  - 确认按 `swapNo` 搜索时可以拉出完整链路，不要求用户再手工切换到 `quoteNo`
- 退出标准：
  - Audit Center 中按 `swapNo` 可看到 quote consume 之后的完整 swap 主链
  - 手工 simulate 具备独立审计事件
  - `SWP2603263044` 这类 spot-check 不再出现“数据齐但审计链分裂”的问题

### Stage 2: Evidence Export And Approval Summary Convergence
- 当前状态：
  - runtime implementation complete on `2026-03-27`
  - `workflowSummary` / approval metadata / package manifest 在 linked swap 场景下已收口到 `swapNo`
  - `quoteNo` 保留在 `swapEvidenceChain` 与 quote snapshot 中作为关联证据
- 目标：
  - 让 swap evidence package 的 manifest、approval summary、selection semantics 与 canonical swap trace root 对齐。
- 主要任务：
  - 审计 `audit evidence export` 在 swap 场景下的 `workflowSummary` 与 package selection contract
  - 把 `workflowType=SWAP` 的审批与导出摘要收口到 `swapNo`
  - 保留 `quoteId / quoteNo` 在 `swapEvidenceChain` 中作为关联快照
  - 清理测试中仍接受 quote-root summary 的历史基线
- 退出标准：
  - 以 `swapNo` 发起 evidence export 时，审批摘要和 package manifest 能自然解释
  - `swapId -> quoteId -> risk / journal / outstanding` 链在包内可回放
  - 不再要求用 `quoteNo` 充当 swap evidence export 的 primary workflow reference

### Stage 3: Workflow Output And Read Model Contract Cleanup
- 当前状态：
  - runtime implementation complete on `2026-03-27`
  - transaction workflow 已启用 canonical `updatedSubject`
  - swap detail read model 已切断对 legacy `auditLogs` relation 的 active 依赖
- 目标：
  - 清理 Wave 6 为兼容 transaction workflow 复用而保留的别名输出和 read-model 漂移。
- 主要任务：
  - 收口 `WorkflowTransitionService` 的 transaction output shape，消除 `depositNo` 承载 `swapNo` 的兼容壳
  - 梳理 `Risk Execution / Alert / Case` 详情页对 compat 字段或 JSON shell 的依赖
  - 让 swap detail / list / evidence summary 只依赖当前 canonical 字段与 relation
- 退出标准：
  - swap 场景不再通过 `depositNo` 或其他跨领域命名对外暴露主标识
  - 关键 read model 可以不依赖 compat alias 正常解释

### Stage 4: Legacy Compatibility Shell Retirement
- 当前状态：
  - implementation complete on `2026-03-27`
  - `SwapTransactionAuditLog` relation / model / table 已删除
  - `TX_DEPOSIT_FINAL / TX_SWAP_FINAL` 新写入已收口到 `riskBand / riskReason / simulationMode`
  - `ONBOARDING_CDD.mockDataType` 与 deposit inbound `simulationRisk*` 已明确标记为 retained compatibility
- 目标：
  - 物理收缩 Wave 6 仍保留但已不再承担 runtime truth 的兼容层。
- 主要任务：
  - 删除 `SwapTransactionAuditLog` relation / model / table，结束 dead shell 的物理保留
  - 把 `TX_DEPOSIT_FINAL / TX_SWAP_FINAL` 的 canonical runtime input 收口到 `riskBand / riskReason / simulationMode`
  - 停止在 swap/deposit final-review 新写入的 signals、alert metadata、case metadata、provider evidence payload 中生成 `simulationRisk*`
  - 明确 `ONBOARDING_CDD.mockDataType` 与 `InboundTransferSignal.simulationRisk*` 为 retained compatibility，不在本阶段做 breaking removal
- 退出标准：
  - `SwapTransactionAuditLog` 已物理删除
  - Wave 6 transaction-final 主链不再依赖或新写入 compatibility-only client risk input shell
  - 剩余兼容字段被明确定义为 retained compatibility，而不是“不确定是否还需要”

### Stage 5: Docs / Index / Deleted-Anchor Cleanup
- 当前状态：
  - implementation complete on `2026-03-27`
  - deleted anchor references 已从 active Wave 6 roadmap / index 层移除
  - shared risk simulation 文档已改写为 `Risk Policy Executions` canonical 口径
- 目标：
  - 把 Wave 6 已完成实现与 cleanup closure record 的文档入口彻底同步。
- 主要任务：
  - 修正 roadmap 中仍引用已删除 swap workflow 旧实现锚点的描述
  - 更新共享 risk simulation 文档，去掉旧的 client-side 风险选择描述
  - 统一 `docs/README.md`、`docs/cleanup/README.md`、相关 constraints/specs/acceptance 的入口说明
  - 统一 Stage 5 时的 Wave 6 索引与状态口径
- 退出标准：
  - docs 索引层不再指向已删除文件或过期流程
  - Wave 6 的 roadmap / cleanup / truth layers 能清晰回答“当前已完成什么、仍要 cleanup 什么”

### Stage 6: Manual Risk Truth Convergence And Final Closeout Audit
- 当前状态：
  - implementation complete on `2026-03-27`
  - admin read model 已改成 canonical-first，signal-level compatibility evidence 不再占据 final risk 主位
  - Wave 6 active docs / acceptance 已重基线到 `pending decision record -> Admin Risk Policy Executions simulate`
- 目标：
  - 完成 Wave 6 最后一轮 closeout audit，确认仅剩 documented retained compatibility，而不再存在 active debt。
- 主要任务：
  - 删除 transaction bridge 中已失效的旧自动风险推导 helper
  - 下沉 payin / deposit signal-level compatibility evidence 的 UI 主位
  - 把 alert detail 的 risk 展示改为 canonical-first
  - 重写 Wave 6 cleanup master、acceptance 与 sequencing docs 的最终状态口径
- 退出标准：
  - active docs 中不再把 swap/deposit final review 写成创建后自动 low-risk clear
  - payin / deposit detail 不再把 signal-level risk 当作 final risk truth 主位展示
  - cleanup master 不再把 Stage 1-5 已完成事项重复列为当前 debt
  - Wave 6 可正式标记为 `runtime complete, cleanup complete`

## Verification Baseline
- 本 cleanup 规划基于以下事实：
  - `Wave 6` 客户 swap 主链已可从 `rate -> quote -> swap -> pending decision record -> Risk Policy Executions simulate -> alert / case -> success / rejected` 走通
  - focused Wave 6 backend tests、backend build 与 `admin-web` build 已在 Stage 6 closeout 后通过
  - active Wave 6 docs 已重基线到 shared manual-risk migration 后的真实链路
- 因此当前 cleanup 判定应为：
  - runtime-complete
  - cleanup-complete

## Stage Ordering Rationale
- 先做 `Stage 1`，因为没有单一审计 trace root，后续 evidence/export 与 UI read model 都会继续分裂。
- 再做 `Stage 2`，因为 evidence/export 必须建立在 trace root 稳定的前提上。
- 然后做 `Stage 3`，把 transaction workflow 输出和 read model 的兼容别名清干净。
- 再做 `Stage 4`，物理退掉确认无调用方的 compatibility shell，避免过早删掉仍在被隐式依赖的旧层。
- 再做 `Stage 5`，统一文档与索引，避免 cleanup 文档先说“删掉了”，而代码和行为层还没真正收口。
- 最后做 `Stage 6`，把 manual-risk truth、read-model 主叙事和 final closeout audit 一次收口。

## Exit Criteria
- `Wave 6` cleanup 完成时，至少应满足：
  - 按 `swapNo` 检索可以得到完整审计链
  - `Risk Execution` 手工 simulate 具备稳定、可检索的独立审计事件
  - evidence export / approval summary 以 `swapNo` 为自然主引用
  - swap runtime / UI 不再依赖 legacy `SwapTransactionAuditLog`
  - transaction workflow 输出不再用 `depositNo` 这类跨领域别名承载 `swapNo`
  - shared manual-risk contexts 不再依赖旧 client risk input 字段解释行为
  - active docs / acceptance / read model 不再把 signal-level compatibility evidence 误当成 final risk truth
  - 文档索引与 roadmap 不再引用已删除锚点或旧 client-side 风险选择路径

## Rollback / Compatibility Note
- 本计划是 cleanup backlog，不是新的产品波次。
- cleanup 执行时应遵守：
  - 先收口 trace / read-model / caller 审计
  - 再退 compatibility shell
  - 最后更新删除类文档口径
- 若在任一阶段发现 active caller 仍依赖兼容层：
  - 优先回退到“保留兼容壳并明示 retained status”
  - 不得为了完成 cleanup 而破坏当前 Wave 6 主链
