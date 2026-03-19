# Wave 3 客户入驻与客户管理分阶段规划（Customer Onboarding + Customer Management + Periodic Review）

## 1. 文档目的

本文件用于把总版本规划中的 `Wave 3` 进一步拆成多个可执行 `phase`，作为后续开发、产品、测试、agent 协作时的统一参考。

适用原则：

- 本文是 `Wave 3` 的专项规划文档，不替代 `AGENTS.md` 与 `docs/constraints/**`。
- `Wave 3` 的 legacy 收口与兼容删除计划以 `docs/cleanup/wave-3-cleanup-master-plan.md` 为准；本文件只负责功能范围与 phase 顺序，不承担 cleanup 真相。
- onboarding 当前运行时约束以 `docs/constraints/onboarding-flow-constraints.md` 为准。
- onboarding 与 compliance center 的对接约束以 `docs/constraints/onboarding-alert-case-workflow-stage-rule-mapping.md` 为准。
- `Wave 3` 只聚焦：
  - `customer onboarding`
  - `customer management`
  - `periodic review`
- 账务、钱包/银行账户、posting/config center、fee skeleton 统一后置到 `Wave 4`。

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
- 截至当前代码，Wave 3 customer/onboarding 对外兼容 contract 也已完成收口；剩余 cleanup 仅在内部物理命名和前端打包层面。

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

## 9. Wave 3 Cleanup 当前状态补充

- `Stage 1` 到 `Stage 8` 的 cleanup 已全部完成。
- cleanup 后续正式按三段推进：
  - `Stage 6`：compatibility contract cleanup
  - `Stage 7`：physical rename
  - `Stage 8`：frontend bundling optimization
- 其中：
  - `Stage 6` 已完成，主要完成 `/onboarding/next-step.publicStatus`、response payload `caseNo / caseType`、legacy helper / legacy 文案 / snapshot 残留清理
  - `Stage 7` 已完成，主要完成 `CddResponse / EddResponse / WorkflowDecisionRecord` 及其直接耦合 runtime symbol 的 physical rename
  - `Stage 8` 已完成，主要完成 `admin-web` 与 `client-web` 的前端打包优化，并消除了 Vite large chunk warning
- 注意：这里的 `Stage 6/7/8` 是 cleanup 编号，不替代本 roadmap 内部的 phase 编号。
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
- `Wave 3` 结束时：
  - 旧字段仍保留兼容
  - 所有新逻辑只写 canonical 字段
  - 读模型允许同时返回旧字段与新字段

**DoD**

- Customer App、Admin Customer、Compliance Center、Approvals、Risk Policy Executions 五条链一致可回放

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
