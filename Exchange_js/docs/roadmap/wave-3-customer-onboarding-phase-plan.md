# Wave 3 客户入驻与客户管理分阶段规划（Customer Onboarding + Customer Management + Periodic Review）

## 1. 文档目的

本文件用于把总版本规划中的 `Wave 3` 进一步拆成多个可执行 `phase`，作为后续开发、产品、测试、agent 协作时的统一参考。

适用原则：

- 本文是 `Wave 3` 的专项规划文档，不替代 `AGENTS.md` 与 `docs/constraints/**`。
- `Wave 3` 的历史 cleanup 记录保留在 `docs/cleanup/wave-3-cleanup-master-plan.md`；本文件当前主要保留功能范围、phase 历史和完成态总结。
- onboarding 当前运行时约束以 `docs/constraints/onboarding-flow-constraints.md` 为准。
- onboarding 与 compliance center 的对接约束以 `docs/constraints/onboarding-alert-case-workflow-stage-rule-mapping.md` 为准。
- `Wave 3` 只聚焦：
  - `customer onboarding`
  - `customer management`
  - `periodic review`
- 账务、钱包/银行账户、posting/config center、fee skeleton 统一后置到 `Wave 4`。

### 当前完成态说明

- `Wave 3` 主体能力与 final closure 已完成。
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
  - `docs/specs/modules/compliance-center-module.md`
  - `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`
  为准。
- 本文中对早期 compatibility mirror、phase 内保留旧字段、cleanup stage 的描述，均属于历史 phase 语境。

---

## 2. Wave 3 总目标

`Wave 3` 的目标不是继续扩合规底座，也不是开始资金业务，而是把 `Wave 2` 已经完成的：

- `Risk Engine`
- `Decision Record`
- `Alert`
- `Compliance Case`
- `Workflow Transition`
- `Approval`

真正落成一条正式的 customer 主链。

本波核心结果固定为：

- customer onboarding 主状态机成型
- customer 管理能力成型
- final approval 接入 approval 单
- periodic review 成为 customer 生命周期上的独立复审周期
- customer 相关限制/冻结/解冻全部通过已有 compliance case 留痕
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
- 截至当前代码，Wave 3 customer/onboarding 对外兼容 contract 与 final closure 均已完成；cleanup 文档只保留历史记录。

### 3.2 CDD / EDD 主体

- `CDD/EDD` 对外统一改名为：
  - `CDD Response`
  - `EDD Response`
- `Response` 是 provider response / evidence container，不是 compliance `Case`。
- `Response` canonical 生命周期固定为：
  - `CREATED`
  - `COMPLETED`
- 物理表可继续沿用 `cddResponse / eddResponse` 作为兼容实现。
- response payload 已统一为 `responseNo / responseType`；`caseNo / caseType` alias 已从 onboarding / periodic review 对外 contract 删除。

### 3.3 Compliance Center 对接

- `rule` 保持当前结构含义，继续表达 stage 容器规则。
- 细粒度命中原因继续放在：
  - `reasonCodes`
  - `metadata`
- customer 上的控制动作必须绑定**已有 compliance case**。
- `FINAL_APPROVAL` 本波接入 approval 单。
- `periodic review` 是独立复审周期，不并入 onboarding 主状态机。

### 3.4 Canonical 状态枚举

`onboardingStatus`：

- `NONE`
- `PENDING_CDD_INPUT`
- `CDD_UNDER_REVIEW`
- `PENDING_EDD_INPUT`
- `EDD_UNDER_REVIEW`
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

- `NONE -> PENDING_CDD_INPUT -> CDD_UNDER_REVIEW -> PENDING_EDD_INPUT -> EDD_UNDER_REVIEW -> FINAL_APPROVAL -> APPROVED`

额外说明：

- `LOW_RISK CDD` 继续直通：
  - `onboardingStatus = APPROVED`
  - `operatingStatus = ACTIVE`
- `periodic review` 不改写 `onboardingStatus`。

### 3.5 Unified Audit Center And Trace Contract

- `Wave 3` 的 canonical audit store 固定为：
  - `audit_log_events`
- `onboarding_audit_logs` 现在只保留历史/兼容说明价值，不再承担运行时真相，也不再持续 mirror 写入。
- `traceId` 根规则固定为：
  - onboarding：`ONBOARDING:<journeyId>`
  - periodic review：`PERIODIC_REVIEW:<cycle.id>`
- `CDD/EDD Response -> alert -> case -> MLRO -> final approval` 必须共用同一条 workflow trace。
- `onboarding final approval` 作为 approval 对象存在时，必须继承上游 onboarding trace，而不是自行生成新的随机 trace。

---

## 4. Phase 1：Customer / Response 领域重构

**目标**

先把 onboarding 里的主体定义拉直，避免 customer、response、case、control 混用。

**P0 交付物**

- customer canonical 字段落地：
  - `onboardingStatus`
  - `operatingStatus`
  - `restrictionStatus`
  - 继续保留 `complianceHoldStatus`
- `CDD Response / EDD Response` 对外命名统一
- `Response` 生命周期降级为采集/完成语义
- 旧状态字段保留为 compatibility mirror

**DoD**

- 新逻辑只依赖 canonical 字段
- 旧字段仍可读，但不再是唯一真相来源

---

## 5. Phase 2：Onboarding Workflow 主链重写

**目标**

把 customer onboarding 状态机改成 customer 视角的正式流程，不再混合旧的 review 状态表达。

**P0 交付物**

- `getNextStep()` 全量改为基于 `customer.onboardingStatus`
- onboarding 主链改为：
  - `NONE`
  - `PENDING_CDD_INPUT`
  - `CDD_UNDER_REVIEW`
  - `PENDING_EDD_INPUT`
  - `EDD_UNDER_REVIEW`
  - `FINAL_APPROVAL`
  - `APPROVED`
- `alert / case.reviewStage` 继续只保留：
  - `REVIEW_CDD`
  - `REVIEW_EDD`
- `Workflow Transition` 映射改成新状态口径：
  - `CDD approve -> APPROVED`
  - `CDD require EDD -> PENDING_EDD_INPUT`
  - `EDD approve -> FINAL_APPROVAL`
  - `EDD reject -> REJECTED`
- `LOW_RISK CDD` 继续不走 review alert，直接落：
  - `onboardingStatus = APPROVED`
  - `operatingStatus = ACTIVE`

**DoD**

- customer 主状态机成为 onboarding 唯一主线
- review stage 只留在 compliance center

---

## 6. Phase 3：Customer Management + Case-bound Controls

**目标**

把 customer management 正式纳入 `Wave 3`，同时保持所有 customer 控制动作都基于调查。

**P0 交付物**

- customer management 页面/接口纳入 `Wave 3`
- 支持 customer 级操作：
  - `RESTRICT`
  - `UNRESTRICT`
  - `FREEZE`
  - `UNFREEZE`
- 所有动作强约束固定为：
  - 必须提供并绑定**已有 compliance case**
  - 不允许绕过 case 直接留痕
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
- 但不会长出第二套独立合规动作引擎

---

## 7. Phase 4：Approval-backed Final Approval

**目标**

把 `FINAL_APPROVAL` 从“直接 final review 改 customer 状态”升级成正式审批节点。

**P0 交付物**

- `FINAL_APPROVAL` 正式接 approvals 模块
- 新增 approval action type：
  - `ONBOARDING_FINAL_APPROVAL`
- 只有进入 `FINAL_APPROVAL` 的 customer 才自动创建 approval case
- 审批通过：
  - `onboardingStatus = APPROVED`
  - `operatingStatus = ACTIVE`
- 审批拒绝：
  - `onboardingStatus = REJECTED`
  - `operatingStatus = INACTIVE`
- 现有 `reviewCustomerFinalDecision()` 降级为兼容入口
- 兼容入口内部统一改走 approval 结果消费

**DoD**

- onboarding 最终通过不再是人工裸改状态
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
- 复用现有 `reviewStage`：
  - `REVIEW_CDD`
  - `REVIEW_EDD`
- 新增 periodic review 规则：
  - `PRR_CDD_REVIEW_REQUIRED`
  - `PRR_EDD_REVIEW_REQUIRED`
- 周期复审最小链路固定为：
  - `due -> 创建 PeriodicReviewCycle -> customer RESTRICTED`
  - 客户补 `CDD Response`
  - 必要时进入 `EDD Response`
  - 合规中心 review
  - 通过后清除 restriction
  - 拒绝则保持 restriction

---

## 9. Wave 3 Cleanup 历史记录补充

- `Stage 1` 到 `Stage 8` 的 cleanup 已全部完成。
- 这些 cleanup 文档现在只保留为历史记录，不再作为当前语义真相层。
- 注意：这里的 `Stage 6/7/8` 是历史 cleanup 编号，不替代本 roadmap 内部的 phase 编号。
- periodic review 复用：
  - `Response`
  - `Decision Record`
  - `Alert`
  - `Compliance Case`
  - `Workflow Transition`
- transition consumer 是 `PeriodicReviewCycle`，不是 onboarding workflow

**DoD**

- onboarding 与 periodic review 分离
- customer 后续复审不再污染 onboarding 主状态机

---

## 9. Phase 6：Wave 3 正式验收与兼容收口

**目标**

把 `Wave 3` 做成真正可验收的 customer 主链，而不是局部模块完成。

**P0 交付物**

- 输出并执行一份正式 `Wave 3` 验收剧本
- 验收至少覆盖：
  - `LOW_RISK CDD`
  - `CDD review -> REQUIRE_EDD`
  - `EDD review -> FINAL_APPROVAL -> approval approve`
  - `EDD review -> REJECT`
  - `customer management restrict/freeze/unfreeze` 必须绑定 case
  - `periodic review due -> restrict -> review -> clear`
- `Audit Center` trace 验收：
  - onboarding 一条流程的 response / alert / case / MLRO / approval 能按 `traceId` 完整查出
  - periodic review 一条流程的 cycle / response / alert / case / disposition 能按 `traceId` 完整查出
- `Wave 3` 结束时：
  - 主运行时只使用 canonical contract
  - 兼容字段只允许留在 migration / normalization / historical fixture / archived cleanup context

**DoD**

- Customer App、Admin Customer、Compliance Center、Approvals、Risk Policy Executions 五条链一致可回放
- `Audit Center` 成为 onboarding / periodic review 的统一审计入口
- `onboarding_audit_logs` 只保留历史兼容说明角色，不再承担运行时 trace 查询职责

---

## 10. Public APIs / Interfaces

`CustomerMain` canonical fields：

- `onboardingStatus`
- `operatingStatus`
- `restrictionStatus`
- `complianceHoldStatus`

对外命名：

- `CDD Response / EDD Response`
- `PeriodicReviewCycle`

approval：

- `ONBOARDING_FINAL_APPROVAL`

workflow：

- `ONBOARDING`
- `PERIODIC_REVIEW`

reviewStage：

- `REVIEW_CDD`
- `REVIEW_EDD`

---

## 11. Test Plan

### Onboarding 主链

- `LOW_RISK CDD` 直接 `APPROVED + ACTIVE`
- `REVIEW_CDD -> REQUIRE_EDD -> PENDING_EDD_INPUT`
- `REVIEW_EDD -> FINAL_APPROVAL`
- final approval 审批通过后才 `APPROVED + ACTIVE`
- final approval 审批拒绝后 `REJECTED + INACTIVE`

### Customer Controls

- `RESTRICT / UNRESTRICT / FREEZE / UNFREEZE` 都必须带已有 `complianceCaseId`
- 无 case 绑定直接拒绝
- gate 正确识别 restriction 与 freeze

### Periodic Review

- 到期自动创建 `PeriodicReviewCycle`
- 到期后 customer 自动 `RESTRICTED`
- review 通过后解除 restriction
- review 拒绝后保持 restriction

### Compatibility

- customer/onboarding 对外 legacy contract 已收口完成
- 当前剩余兼容只在内部物理命名与少量 transaction-compliance case 语义边界，不在本 roadmap 主链回归

### Formal UAT

- Customer App
- Admin Customer
- Compliance Center
- Approvals
- Risk Policy Executions

五条链一致可回放。

---

## 12. Assumptions

- `LOW_RISK` 直通路径继续不走 `FINAL_APPROVAL`
- `FINAL_APPROVAL` approval-backed 只适用于真正进入该状态的高风险 / EDD 路径
- 物理表和旧 symbol 在 `Wave 3` 内允许兼容保留，不要求一次性 rename 到数据库层
- `restrictionStatus` 与 `complianceHoldStatus` 并存：
  - `RESTRICTED` 是 customer 限制
  - `FROZEN` 是更强的合规冻结
- `periodic review` 不改写 `onboardingStatus`，它是 customer 的独立复审周期
