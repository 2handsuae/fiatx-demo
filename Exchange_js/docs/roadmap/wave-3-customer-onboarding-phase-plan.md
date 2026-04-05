# Wave 3 客户入驻与客户管理分阶段规划（Customer Onboarding + Customer Management + Periodic Review）

## 1. 文档目的

本文件用于把总版本规划中的 `Wave 3` 进一步拆成多个可执行 `phase`，作为后续开发、产品、测试、agent 协作时的统一参考。

适用原则：

- 本文是 `Wave 3` 的专项规划文档，不替代 `AGENTS.md` 与 `docs/constraints/**`。
- `Wave 3` 的历史 cleanup 记录保留在 `docs/cleanup/wave-3-cleanup-master-plan.md`；本文件当前主要保留功能范围、phase 历史和完成态总结。
- onboarding 当前运行时约束以 `docs/constraints/onboarding-flow-constraints.md` 为准。
- `Wave 3` 只聚焦：
  - `customer onboarding`
  - `customer management`
  - `periodic review`
  - `approval-backed final approval`

### 当前完成态说明

- `Wave 3` 现阶段的 onboarding 真相已经切换为：
  - `Sumsub workflow` 承载验证流程
  - 本系统承载 customer 生命周期状态、审计留档、final approval
- 当前运行时长期真相以：
  - `docs/constraints/onboarding-flow-constraints.md`
  - `docs/specs/workflows/onboarding-canonical-workflow.md`
  - `docs/specs/workflows/periodic-review-canonical-workflow.md`
  - `docs/specs/workflows/mlro-and-final-approval-governance.md`
  - `docs/specs/entities/customer-entity.md`
  - `docs/specs/entities/review-response-entity.md`
  - `docs/specs/entities/periodic-review-cycle-entity.md`
  - `docs/specs/entities/approval-case-entity.md`
  - `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
  - `docs/specs/modules/customer-onboarding-module.md`
  - `docs/specs/modules/periodic-review-module.md`
  - `docs/specs/modules/approvals-module.md`
  为准。
- 本文中对早期 CDD/EDD runtime、risk-engine 直连、response/session mock-complete 的描述，只保留历史 phase 语境。

---

## 2. Wave 3 总目标

`Wave 3` 的目标不是继续扩自研合规底座，而是把 customer 主链真正落成：

- onboarding 验证真相迁移到 `Sumsub workflow`
- customer onboarding 主状态机收敛为 customer 生命周期视角
- final approval 保留为本地治理关口
- periodic review 继续作为 customer 生命周期上的独立复审周期
- customer 相关限制/冻结/解冻继续通过已有治理与审计能力留痕
- onboarding / periodic review 主链全部接入 `Audit Center`
- 同一条 onboarding / periodic review 流程可通过统一 `traceId` 在 `Audit Center` 中完整回放

---

## 3. 已锁定决策

### 3.1 Customer 主模型

- `customer` 采用单字段 `onboardingStatus`，不单独存 `onboardingStage`。
- 新增独立 `operatingStatus`。
- 新增独立 `restrictionStatus`。
- `restrictionStatus` 与 `complianceHoldStatus` 并存：
  - `RESTRICTED` 表示 customer 限制
  - `FROZEN` 表示更强的合规冻结
- `publicStatus / cddStatus / eddStatus / complianceStatus / finalApprovalStatus` 在 Wave 3 阶段曾作为兼容镜像字段保留。
- 截至当前代码，以上 legacy customer 字段已从 `CustomerMain` 和 customer-facing/admin-facing payload 中删除。

### 3.2 Verification 主体

- onboarding active verification 由 `Sumsub workflow` 承载。
- `CDD/EDD` 不再是 customer canonical runtime stage。
- `CDD Response / EDD Response` 继续保留为：
  - legacy evidence container
  - compatibility browse surface
  - 历史清理阶段残留的物理实现名
- legacy `REVIEW_EDD -> FINAL_APPROVAL` 路径当前仍作为兼容运行时残留存在。
- customer `/verification` 当前主交互已切换为：
  - `Start Verification`
  - `Continue Verification`
  - `Wait Verification`
  - `Wait Final Approval`
  - `Reinitiate Verification`

### 3.3 Governance / Approval 对接

- onboarding 主验证通过路径不再依赖自研 risk engine / alert / case 作为 canonical routing。
- `FINAL_APPROVAL` 继续保留为本地治理节点。
- 只有经历过 `level2` 且 provider workflow 成功完成的 customer，才进入 `FINAL_APPROVAL`。
- 兼容路径里，legacy EDD review 仍可能进入 `FINAL_APPROVAL`；这不改变 active provider-first 主链定义。
- `level1` 完成且未进入 `level2` 的 customer，可直接 `APPROVED + ACTIVE`。
- `periodic review` 是独立复审周期，不并入 onboarding 主状态机。

### 3.4 Canonical 状态枚举

`onboardingStatus`：

- `NONE`
- `PENDING_VERIFICATION`
- `FINAL_APPROVAL`
- `APPROVED`
- `REJECTED`
- `WITHDRAWN`

`operatingStatus`：

- `INACTIVE`
- `ACTIVE`

`restrictionStatus`：

- `CLEAR`
- `RESTRICTED`

customer onboarding 主链固定为：

- `NONE -> PENDING_VERIFICATION -> APPROVED`
- `NONE -> PENDING_VERIFICATION -> FINAL_APPROVAL -> APPROVED`

额外说明：

- provider workflow 中的 `level1 / level2 / retry / onHold` 都属于 provider 子流程，不是 customer canonical 主状态。
- `periodic review` 不改写 `onboardingStatus`。

### 3.5 Unified Audit Center And Trace Contract

- `Wave 3` 的 canonical audit store 固定为：
  - `audit_log_events`
- `onboarding_audit_logs` 现在只保留历史/兼容说明价值，不再承担运行时真相，也不再持续 mirror 写入。
- `traceId` 根规则固定为：
  - onboarding：`ONBOARDING:<journeyId>`
  - periodic review：`PERIODIC_REVIEW:<cycle.id>`
- onboarding 当前已显式落地的 canonical audit 主要覆盖：
  - final approval（仅 level2 路径）
- verification start / provider webhook / workflow terminal audit 仍属于后续补齐项。
- `Phase 6` 的正式验收要求之一，就是把这部分 provider-event audit 缺口补齐。

---

## 4. Phase 1：Customer / Response 领域重构

**目标**

先把 customer 主体、verification projection、legacy response container 的边界拉直，避免 customer、response、case、control 混用。

**P0 交付物**

- customer canonical 字段落地：
  - `onboardingStatus`
  - `operatingStatus`
  - `restrictionStatus`
  - 继续保留 `complianceHoldStatus`
- onboarding `verification` projection 落地
- `CDD Response / EDD Response` 对外命名统一
- `Response` 生命周期降级为采集/完成语义

**DoD**

- 新逻辑只依赖 canonical customer 字段和 verification projection
- response 仍可读，但不再是 onboarding 主流程唯一真相来源

---

## 5. Phase 2：Onboarding Workflow 主链重写

**目标**

把 customer onboarding 状态机改成 Sumsub workflow-first 的正式流程，不再把 `CDD/EDD` 作为 customer runtime stage。

**P0 交付物**

- `getNextStep()` 全量改为基于：
  - `customer.onboardingStatus`
  - `verification projection`
- onboarding 主链改为：
  - `NONE`
  - `PENDING_VERIFICATION`
  - `FINAL_APPROVAL`
  - `APPROVED`
- provider-driven transition 固定为：
  - `applicantPending -> PENDING_VERIFICATION`
  - `applicantOnHold -> PENDING_VERIFICATION`
  - `applicantReviewed + RED + RETRY -> PENDING_VERIFICATION`
  - `applicantLevelChanged -> PENDING_VERIFICATION`
  - `applicantWorkflowCompleted` and no `level2` -> `APPROVED`
  - `applicantWorkflowCompleted` after `level2` -> `FINAL_APPROVAL`
  - `applicantWorkflowFailed` -> `REJECTED`
- customer `/verification` 从 response/session/mock-complete 流程切换到 provider-backed verification flow

**DoD**

- customer 主状态机成为 onboarding 唯一主线
- provider webhook 成为 onboarding verification truth source
- legacy response/session 入口只保留兼容角色

---

## 6. Phase 3：Customer Management + Case-bound Controls

**目标**

把 customer management 正式纳入 `Wave 3`，同时保持所有 customer 控制动作都基于治理/调查留痕。

**P0 交付物**

- customer management 页面/接口纳入 `Wave 3`
- 支持 customer 级操作：
  - `RESTRICT`
  - `UNRESTRICT`
  - `FREEZE`
  - `UNFREEZE`
- 所有动作强约束固定为：
  - 必须提供并绑定已有治理依据
- 控制语义固定为：
  - `RESTRICT -> restrictionStatus = RESTRICTED`
  - `UNRESTRICT -> restrictionStatus = CLEAR`
  - `FREEZE / UNFREEZE` 继续走 `complianceHoldStatus`
- eligibility gate 口径固定为：
  - `onboardingStatus = APPROVED`
  - `operatingStatus = ACTIVE`
  - `restrictionStatus != RESTRICTED`
  - `complianceHoldStatus != FROZEN`

**DoD**

- customer management 可以操作客户
- 不会长出第二套独立 onboarding 风控引擎

---

## 7. Phase 4：Approval-backed Final Approval

**目标**

把 `FINAL_APPROVAL` 保留成正式审批节点，但只用于 `level2` 成功完成后的 onboarding 路径。

**P0 交付物**

- `FINAL_APPROVAL` 正式接 approvals 模块
- 新增 approval action type：
  - `ONBOARDING_FINAL_APPROVAL`
- 只有 `level2` 路径 provider workflow completed 的 customer 才自动创建 approval case
- 审批通过：
  - `onboardingStatus = APPROVED`
  - `operatingStatus = ACTIVE`
- 审批拒绝：
  - `onboardingStatus = REJECTED`
  - `operatingStatus = INACTIVE`

**DoD**

- onboarding 最终审批不再是人工裸改状态
- 变成正式审批闭环

---

## 8. Phase 5：Periodic Review 独立复审周期

**目标**

把 periodic review 做成 customer 生命周期上的独立复审主线，而不是 onboarding 的延长阶段。

**P0 交付物**

- 新增独立主体：
  - `PeriodicReviewCycle`
- periodic review 不改写 `onboardingStatus`
- periodic review 使用独立 `workflow = PERIODIC_REVIEW`
- 周期复审最小链路固定为：
  - `due -> 创建 PeriodicReviewCycle -> customer RESTRICTED`
  - 客户完成周期复核验证
  - 通过后清除 restriction
  - 拒绝则保持 restriction

---

## 9. Wave 3 Cleanup 历史记录补充

- `Stage 1` 到 `Stage 8` 的 cleanup 已全部完成。
- 这些 cleanup 文档现在只保留为历史记录，不再作为当前语义真相层。
- 注意：这里的 `Stage 6/7/8` 是历史 cleanup 编号，不替代本 roadmap 内部的 phase 编号。
- 当前 onboarding 主链已经从自研 `CDD/EDD + risk engine + alert/case` 迁移到 `Sumsub workflow + local final approval`。

---

## 10. Phase 6：Wave 3 正式验收与兼容收口

**目标**

把 `Wave 3` 做成真正可验收的 customer 主链，而不是局部模块完成。

**P0 交付物**

- 输出并执行一份正式 `Wave 3` 验收剧本
- 验收至少覆盖：
  - `level1 only -> workflow completed -> APPROVED`
  - `level1 -> level2 -> workflow completed -> FINAL_APPROVAL -> approval approve`
  - `provider retry -> continue verification`
  - `provider workflow failed -> REJECTED`
  - `customer management restrict/freeze/unfreeze`
  - `periodic review due -> restrict -> review -> clear`
- `Audit Center` trace 验收：
  - onboarding 一条流程的 provider verification start / provider events / workflow terminal / approval 能按 `traceId` 完整查出
  - periodic review 一条流程的 cycle / review / disposition 能按 `traceId` 完整查出
- 当前实现尚未完全满足上述 onboarding provider-event replay 条件；`Phase 6` 结束前需要显式补齐。

**DoD**

- Customer App、Admin Customer、Approvals、Audit Center、Sumsub simulation / webhook 五条链一致可回放
- `Audit Center` 成为 onboarding / periodic review 的统一审计入口
- `onboarding_audit_logs` 只保留历史兼容说明角色，不再承担运行时 trace 查询职责

---

## 11. Public APIs / Interfaces

`CustomerMain` canonical fields：

- `onboardingStatus`
- `operatingStatus`
- `restrictionStatus`
- `complianceHoldStatus`

verification projection：

- `verificationProvider`
- `sumsubApplicantId`
- `sumsubCurrentLevelName`
- `sumsubLatestReviewId`
- `sumsubLatestAttemptId`
- `sumsubExperiencedLevel2`

approval：

- `ONBOARDING_FINAL_APPROVAL`

workflow：

- `ONBOARDING`
- `PERIODIC_REVIEW`

---

## 12. Test Plan

### Onboarding 主链

- `NONE -> start verification -> PENDING_VERIFICATION`
- `applicantPending -> PENDING_VERIFICATION`
- `applicantOnHold -> PENDING_VERIFICATION`
- `applicantReviewed + RED + RETRY -> continue verification`
- `level1 only workflow completed -> APPROVED + ACTIVE`
- `level2 workflow completed -> FINAL_APPROVAL`
- legacy `REVIEW_CDD/REVIEW_EDD` compatibility 路径仍需单独回归，直到旧 transition 被彻底下线
- final approval 审批通过后才 `APPROVED + ACTIVE`
- final approval 审批拒绝后 `REJECTED + INACTIVE`
- `applicantWorkflowFailed -> REJECTED + INACTIVE`

### Customer Controls

- `RESTRICT / UNRESTRICT / FREEZE / UNFREEZE` 都必须留痕
- gate 正确识别 restriction 与 freeze

### Periodic Review

- 到期自动创建 `PeriodicReviewCycle`
- 到期后 customer 自动 `RESTRICTED`
- review 通过后解除 restriction
- review 拒绝后保持 restriction

### Compatibility

- legacy response/session surfaces 仍可读
- 当前剩余兼容只在内部物理命名与历史清理上下文

### Formal UAT

- Customer App
- Admin Customer
- Approvals
- Audit Center
- Sumsub simulation / webhook

五条链一致可回放。

---

## 13. Assumptions

- `level1` 完成且未进入 `level2`，可直接 `APPROVED`
- `FINAL_APPROVAL` approval-backed 只适用于真正经历 `level2` 并完成 provider workflow 的路径
- legacy review-stage compatibility 仍可能把 customer 写回原始 raw onboarding 状态；这属于 cleanup 未完成项
- 物理表和旧 symbol 在 `Wave 3` 内允许兼容保留，不要求一次性 rename 到数据库层
- `restrictionStatus` 与 `complianceHoldStatus` 并存：
  - `RESTRICTED` 是 customer 限制
  - `FROZEN` 是更强的合规冻结
- `periodic review` 不改写 `onboardingStatus`，它是 customer 的独立复审周期
