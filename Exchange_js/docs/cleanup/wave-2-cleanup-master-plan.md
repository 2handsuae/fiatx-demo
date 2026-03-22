# Wave 2 Cleanup Master Plan

Status: archived
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Wave 2` alert / case / audit / filing / compatibility cleanup
Supersedes: none
Depends On: `docs/roadmap/wave-2-compliance-foundation-phase-plan.md`, `docs/constraints/compliance-alert-incident-constraints.md`, `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`, `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
Source of Truth Level: cleanup-master

## Historical Completion Note
- `Stage 1` 到 `Stage 5` 已全部完成。
- 本文现在只保留 `Wave 2` staged cleanup 的历史分阶段记录。
- `Wave 2` 后续 final closure 也已完成；当前运行时真相请读：
  - `docs/constraints/compliance-alert-incident-constraints.md`
  - `docs/specs/entities/compliance-alert-entity.md`
  - `docs/specs/entities/compliance-case-entity.md`
  - `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
  - `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`

## Target End State
- `Wave 2` runtime 以 canonical contract 为唯一主语义：
  - `caseNo`
  - `assignee*`
  - `workflow decision`
  - `final disposition`
  - `external filing`
- compat 字段、compat routes、compat mirror 只保留在明确标注的 alias / compatibility surface，不再主导默认 API、默认查询和默认 UI。
- runtime vocabulary 只保留当前有效主语义：
  - alert workflow：`CLEAR / REJECT / REQUIRE_EDD`
  - case final disposition：`CLEAR / FALSE_POSITIVE / RISK_CONFIRMED`
- `Audit Center` 能按：
  - `traceId`
  - `workflowType`
  - `workflowNo`
  完整查出 workflow-bound `response / alert / case / MLRO / approval / filing` 全链路。
- `external filing` 成为唯一主模型；`reportStatus / reportRefNo / reportedAt` 仅作为 compatibility mirror 继续只读暴露。

## Stage Overview
1. `Stage 1`：Compatibility Contract Downscope
   - status: completed
   - result: canonical case contract is now the default primary API/UI path; compat fields remain only as alias or compatibility output
2. `Stage 2`：Legacy Vocabulary Retirement
   - status: completed
   - result: active runtime/operator-facing paths now default to canonical vocabulary; legacy words remain only at normalization and historical compatibility boundaries
3. `Stage 3`：Audit Trace And Approval Chain Convergence
   - status: completed
   - result: approval canonical audit now carries workflow dimensions and legacy mirror backfill follows deterministic-only rules with documented residual null rows
4. `Stage 4`：Atomicity And Runtime Guard Alignment
   - status: completed
   - result: periodic review due-chain now reuses a single case transaction and alert workflow buttons only appear when backend execution is actually allowed
5. `Stage 5`：External Filing And Mirror Convergence
   - status: completed
   - result: canonical filing read-models and actions now ignore compatibility-only legacy backfill rows; `reportStatus / reportRefNo / reportedAt` remain compatibility mirrors only

## Compatibility Matrix
| Item | Current Role | Target Role | Planned Stage |
| --- | --- | --- | --- |
| `incidentNo` | case alias still accepted by DTO/query/read-model/UI | compatibility alias only | Stage 1 |
| `ownerUserId / ownerUserNo` | assignee alias still accepted by DTO/query/read-model/UI | compatibility alias only | Stage 1 |
| `/admin/compliance/incidents/**` | canonical runtime route plus historical naming | compatibility alias only | Stage 1 -> Stage 5 |
| `APPROVE_STAGE / REJECT_STAGE / NO_ACTION` | active import surface in constants and transitions | historical normalization boundary only | Stage 2 |
| `RESOLVED` | legacy status still visible in read-model/UI compatibility paths | read-only historical compatibility only | Stage 2 |
| approval audit without `workflowType / workflowNo` | partial trace participation | full workflow-trace participation | Stage 3 |
| `onboarding_audit_logs` | compatibility mirror without complete historical trace strategy | mirror then retire | Stage 3 |
| `reportStatus / reportRefNo / reportedAt` | still visible in case primary list/detail semantics | compatibility-only mirror | Stage 5 |
| Phase 13 filing backfill heuristics | automatic approximation of historical filing need | bounded compatibility backfill with explicit residual debt | Stage 5 |

## Stage Mapping
### Stage 1: Compatibility Contract Downscope
- 目标：把 legacy/compat 字段从主路径降级成真正的兼容层，不再作为默认 contract、默认查询条件或默认 UI 展示。
- 当前状态：已完成。
- in-scope：
  - case/query DTO 中的 `ownerUserId / incidentNo`
  - case read-model 中的 `incidentNo / ownerUserId / ownerUserNo`
  - 前端主展示里的 `caseNo || incidentNo`、`assigneeUserNo || ownerUserNo`
  - compat mirror `reportStatus / reportRefNo / reportedAt` 在列表主位的可见性
- out-of-scope：
  - 物理表 rename
  - `/incidents/**` 立即删除
- exit criteria：
  - canonical contract 成为默认入口
  - compat 字段只保留 alias 或 `Compatibility` 区
  - 前端首页与列表不再依赖 compat fallback 才能正常展示

### Stage 2: Legacy Vocabulary Retirement
- 目标：把 `APPROVE_STAGE / REJECT_STAGE / NO_ACTION / RESOLVED` 从 active runtime vocabulary 中清出去。
- 当前状态：已完成。
- in-scope：
  - `onboarding-compliance-workflow.constant.ts`
  - `compliance-disposition.constant.ts`
  - onboarding / periodic review transition services
  - 风险决策、测试和 fixture 中仍直接产出的旧 disposition 值
- out-of-scope：
  - 历史数据库中旧值的物理清除
  - 新增新的业务状态机
- exit criteria：
  - active runtime 只认当前 canonical vocabulary
  - 旧词汇只允许存在于历史数据归一化边界和 migration 兼容层

### Stage 3: Audit Trace And Approval Chain Convergence
- 目标：把 `Wave 2/3` 统一 trace contract 补完整，不再出现 approval 链只带 `traceId`、不带 workflow 维度的半接入状态。
- 当前状态：已完成。
- in-scope：
  - approval canonical audit 写入 `workflowType / workflowId / workflowNo`
  - onboarding final approval 对上游 trace 的继承契约
  - `onboarding_audit_logs` 新 trace 字段的历史 backfill / residual debt 策略
- out-of-scope：
  - 新建第三套 audit store
  - 改写 Audit Center 查询接口
- exit criteria：
  - `Audit Center` 可按 `traceId` 和 `workflowNo` 完整查出：
    - response
    - alert
    - case
    - MLRO
    - approval
    - filing
  - `onboarding_audit_logs` 的镜像角色与历史策略在文档和代码中明确一致
- residual debt:
  - 历史 `onboarding_audit_logs` 中无法通过 `journeyId`、`periodicReviewCycleId` 或响应关联确定 workflow root 的行继续保留 `null`
  - 非 workflow-bound approval 继续允许只有 `traceId`，不强行回填 workflow 三元组

### Stage 4: Atomicity And Runtime Guard Alignment
- 目标：修正当前运行时最容易造成“状态看着对，但行为断裂”的边界问题。
- 当前状态：已完成。
- in-scope：
  - periodic review `create cycle -> alert -> case -> restrict` 的事务原子性
  - alert detail 按钮可见性与真正执行 guard 的一致性
  - case / MLRO / filing 等跨服务 side effects 的事务边界
- out-of-scope：
  - 新产品动作
  - 新审批角色模型
- exit criteria：
  - 不再出现：
    - 周期复审 cycle 回滚但 case/restrict 已提交
    - UI 显示按钮但点击必然被 backend 拒绝
    - 事务内创建对象、事务外立刻读取导致 `not found`

### Stage 5: External Filing And Mirror Convergence
- 目标：把 `external filing` 与 compat report mirror 的边界真正稳定下来，并清理 `Phase 13` 的启发式回填风险。
- 当前状态：已完成。
- in-scope：
  - `Phase 13` migration 中对 `filingRequired / external filing` 的弱规则回填
  - 列表页把 `reportRefNo / reportedAt` 当主语义的问题
  - detail 页中 `reportStatus` 的兼容展示位置
- out-of-scope：
  - 真实 `FIU / VARA / STR / SAR` 外部集成
  - 新 filing authority taxonomy
- exit criteria：
  - `external filing` 成为唯一主模型
  - `reportStatus / reportRefNo / reportedAt` 只保留 compatibility 展示
  - 历史 backfill 明确：
    - 哪些保留
    - 哪些人工修复
    - 哪些放弃自动回填
- residual debt:
  - `metadata.source = LEGACY_PHASE12_BACKFILL` 且缺少确定性提交证据的 filing row 不做物理删除，只标记为 `compatibilityOnly = true`
  - 这类 `LEGACY_HEURISTIC_BACKFILL` residual row 继续保留历史解释价值，但不再进入 canonical `currentFiling / filingStatus / availableFilingActions`

## Deletion Order
1. 先停止页面和服务对 compat 字段的真实主路径依赖。
2. 再收口 runtime vocabulary 与 legacy constants import surface。
3. 再补齐 audit / trace / approval chain 的 workflow 维度。
4. 再修事务与执行 guard 边界。
5. 最后下沉或删除 compat alias、compat mirror 和历史 route。

## Blockers And Defaults
- `/incidents/**` 暂不立即删除，等 `Stage 1-4` 收口后再决定何时 retirement。
- 不做物理表 rename；本 cleanup master 只管理 compatibility 和 runtime truth，不引入新的 physical rename 计划。
- 不在 cleanup master 里发明新的业务状态机，只收口当前已经锁定的 workflow、disposition、filing、audit truth。
- `Audit Center` canonical store 继续是 `audit_log_events`。
- `transaction compliance` 交易侧更深的 case / filing 扩展不纳入本 cleanup master，只在边界上说明。

## Preconditions
- `Wave 2 Phase 10-13` 的主语义已经冻结：
  - alert/action split
  - case state machine
  - MLRO gate
  - external filing separation
- `Wave 2 / Wave 3` trace contract 已经落地到主链，但尚需 cleanup convergences。

## Rollback / Compatibility Note
- cleanup stages 默认遵循 `Mirror Then Retire`：
  - 先保留 compat alias，但从主路径降级
  - 再把 canonical contract 设为唯一默认
  - 最后在验证通过后删除 compat alias
- 若某一阶段发现仍有页面、脚本或证据导出真实依赖 compat 字段，只能回退到 `compatibility pending`，不得强删。

## Final Closure Handoff
- `Wave 2` cleanup master 现在只保留：
  - 已完成 stage 的历史记录
  - 当前 debt 的来源说明
- 该后续文档目前也已完成，并作为 archived completion record 保留：
  - `docs/cleanup/wave-2-wave-3-final-closure-plan.md`
