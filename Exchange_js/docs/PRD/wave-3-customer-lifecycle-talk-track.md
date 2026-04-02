Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-01
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/roadmap/wave-3-customer-onboarding-phase-plan.md`, `docs/constraints/onboarding-flow-constraints.md`, `docs/constraints/onboarding-alert-case-workflow-stage-rule-mapping.md`, `docs/specs/entities/customer-entity.md`, `docs/specs/entities/review-response-entity.md`, `docs/specs/entities/periodic-review-cycle-entity.md`, `docs/specs/entities/approval-case-entity.md`, `docs/specs/workflows/onboarding-canonical-workflow.md`, `docs/specs/workflows/periodic-review-canonical-workflow.md`, `docs/specs/workflows/mlro-and-final-approval-governance.md`, `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`, `docs/specs/modules/customer-onboarding-module.md`, `docs/specs/modules/periodic-review-module.md`, `docs/specs/modules/compliance-center-module.md`, `docs/specs/modules/approvals-module.md`
Source of Truth Level: product-narrative-supporting-doc

# Wave 3 串讲稿：客户正式生命周期（Customer Lifecycle）

## 文档目的
- 本文是一份面向开发、产品、内部讲解场景的 `Wave 3` 中文串讲稿。
- 它的用途是把 `Wave 3` 的业务范围、核心对象、主状态机和讲解口径讲清楚。
- 如果本文与系统运行时真相冲突，以 `docs/constraints/**` 和 `docs/specs/**` 为准。
- 本文默认沿用我们已经讨论并收敛的讲法；对仍需继续深化的问题，不把它们写成既定真相。

## 使用方式
- 适合在 `Wave 1` 控制底座和 `Wave 2` 合规中台核讲完之后，作为第三个完整模块对开发进行串讲。
- 推荐讲解顺序：
1. 先讲 `Wave 3` 的一句话定位
2. 再讲 `Customer` 主模型
3. 再讲 `Onboarding` 主链
4. 再讲 `Onboarding` 如何接 `Risk Engine / Alert / Case`
5. 再讲 `Final Approval`
6. 再讲 `Customer Management`
7. 最后讲 `Periodic Review` 与统一 `trace`
- 本文适合 `20-30` 分钟的口头串讲。

## 一句话定位
- `Wave 3` 不是继续做合规底座，也不是开始资金业务。
- `Wave 3` 的定位是：
  `把 Wave 2 的合规中台核，真正落成一条正式的 customer 主链。`
- 也就是把这些已经具备的平台能力：
1. `Risk Engine`
2. `Decision Record`
3. `Alert`
4. `Case`
5. `Workflow Transition`
6. `Approval`
- 真正接到客户生命周期上，形成：
1. `customer onboarding`
2. `customer management`
3. `periodic review`

## Wave 3 和前两波的关系
- 建议这样讲给开发：
  `Wave 1 定义控制规则，Wave 2 定义合规处理内核，Wave 3 让客户正式穿过这套控制和合规体系。`
- 这波不是重新发明审批、审计、告警和调查。
- 这波做的是把前两波已有的共享能力挂到 `Customer` 主链上。

## Wave 3 的业务范围
- 当前讲稿口径建议把 `Wave 3` 的范围固定为 3 块：
1. `customer onboarding`
2. `customer management`
3. `periodic review`
- 最适合直接讲给开发的一句话：
  `Wave 3 真正完成的，不是几个 onboarding 页面，而是客户正式生命周期。`

## Wave 3 明确不做什么
- 不做钱包或银行账户建模。
- 不做 posting / config center / fee skeleton。
- 不做充值、兑换、提现主链。
- 不让 onboarding 自己再长出第二套 review / approval 引擎。
- 不把 `CDD Response / EDD Response` 讲成合规 `Case`。

## 核心对象
- `Customer`
- `CDD Response`
- `EDD Response`
- `Decision Record`
- `Alert`
- `Case`
- `Approval Case`
- `PeriodicReviewCycle`

## 第一模块：Customer 主模型

### 先下定义
- `Wave 3` 先做的不是页面，而是把 customer 状态语言定型。
- 核心思想只有一句：
  `准入状态、运营状态、限制状态、冻结状态，不能再混成一个字段。`

### Customer 上最重要的 4 组状态字段
1. `onboardingStatus`
2. `operatingStatus`
3. `restrictionStatus`
4. `complianceHoldStatus`

### `onboardingStatus` 回答什么
- 它回答：
  `客户准入主链现在走到哪一步。`
- 当前 canonical 状态固定为：
1. `NONE`
2. `PENDING_CDD_INPUT`
3. `CDD_UNDER_REVIEW`
4. `PENDING_EDD_INPUT`
5. `EDD_UNDER_REVIEW`
6. `FINAL_APPROVAL`
7. `APPROVED`
8. `REJECTED`
9. `WITHDRAWN`

### `operatingStatus` 回答什么
- 它回答：
  `客户当前能不能作为正式运营客户被系统使用。`
- 当前主状态为：
1. `INACTIVE`
2. `ACTIVE`

### `restrictionStatus` 回答什么
- 它回答：
  `客户当前有没有被限制。`
- 当前主状态为：
1. `CLEAR`
2. `RESTRICTED`

### `complianceHoldStatus` 回答什么
- 它回答：
  `客户当前有没有被更强的合规冻结。`
- 对开发最重要的提醒：
  `RESTRICTED` 和 `FROZEN` 不是同一层控制。

## 第二模块：Onboarding 主链

### 主链一句话
- `Onboarding` 在 `Wave 3` 里第一次变成了 customer 视角的正式状态机。

### 主路径怎么走
- 当前最适合讲给开发的主链是：
  `NONE -> PENDING_CDD_INPUT -> CDD_UNDER_REVIEW -> PENDING_EDD_INPUT -> EDD_UNDER_REVIEW -> FINAL_APPROVAL -> APPROVED`

### 每一步在做什么
1. `PENDING_CDD_INPUT`
   - 客户已经进入 onboarding，但还没完成 CDD 证据输入。
2. `CDD_UNDER_REVIEW`
   - 客户完成 `CDD Response`
   - 系统创建一条 pending `Decision Record`
   - 准入链正式进入 review 关口
3. `PENDING_EDD_INPUT`
   - `REVIEW_CDD` 给出 `REQUIRE_EDD`
   - 客户必须补更深的尽调材料
4. `EDD_UNDER_REVIEW`
   - 客户完成 `EDD Response`
   - 系统创建一条 pending `ONBOARDING_EDD` decision record
5. `FINAL_APPROVAL`
   - `EDD` 路径在合规上已经清楚
   - 但 customer 还没最终准入
   - 这一步必须转入 approvals 模块
6. `APPROVED`
   - final approval 通过
   - customer 才真正完成准入

### 两个特别容易讲错的分支
1. `ONBOARDING_CDD -> LOW`
   - 不创建 review alert
   - customer 直接进入 `APPROVED`
2. `ONBOARDING_EDD -> LOW + EDD_CLEAR`
   - 不创建 review alert / case
   - customer 直接进入 `FINAL_APPROVAL`
   - 然后自动创建 `ONBOARDING_FINAL_APPROVAL`

### 最重要的一句提醒
- `EDD CLEAR` 不等于最终开户完成。
- 后面还有一层独立的 `Final Approval`。

## 第三模块：Onboarding 如何接共享 Compliance Kernel

### 先讲原则
- 建议直接讲：
  `Wave 3 没有重新发明 review 系统，而是把 onboarding 接到了 Wave 2 已经建好的 Risk Engine / Alert / Case 内核上。`

### `CDD / EDD Response` 到底是什么
- 这里一定要反复强调：
  `CDD Response / EDD Response 是证据容器，不是合规 Case。`
- 它们负责：
1. 承载证据输入
2. 生成 `Decision Record`
3. 把后续 review 链接到统一 trace 上

### Review stage 应该留在哪一层
- 当前 runtime 真相是：
1. `REVIEW_CDD`
2. `REVIEW_EDD`
- 这两个 review stage 只保留在合规侧。
- `FINAL_APPROVAL` 是 workflow 状态，不是 alert/case stage。

### Onboarding review 如何生成 alert / case
- 当前推荐讲法：
1. 客户提交 response
2. 系统创建 pending `Decision Record`
3. operator 在 `Risk Policy Executions` 完成最终风险模拟
4. 如果需要人工 review，就 upsert workflow-bound `Alert`
5. 如果 triage 无法直接解决，再升级为 `Case`

### 为什么要强调 workflow-bound
- 因为 `Onboarding` 不是 generic risk ticket。
- 它是一条挂在特定 `journey` 上的正式业务链。
- 所以：
1. review signal 必须按 `journey + stage` upsert
2. `REVIEW_EDD` alert 不能覆盖 `REVIEW_CDD` alert
3. alert/case 只是承载 review 行为，不直接成为 customer root

### 最重要的开发边界
- 建议原话讲：
  `Alert / Case 先记录 disposition，再由 workflow transition consumer 去改 customer 状态。`
- 也就是说：
1. 不能在每个 alert handler 里随手改 customer
2. 不能让 case service 越权当 onboarding root owner

## 第四模块：Final Approval

### 为什么 `Final Approval` 要单独存在
- 这块一定要单独讲。
- 建议直接说：
  `Case 里的 MLRO review 和 customer 的 final approval，是两层不同治理。`

### 顺序怎么理解
1. case 内完成调查和 MLRO gate
2. case 给出最终 workflow decision
3. customer 进入 `FINAL_APPROVAL`
4. 系统创建 `ONBOARDING_FINAL_APPROVAL`
5. `SM` 审批
6. customer 才真正进入 `APPROVED`

### 对开发最关键的结论
- `MLRO gate` 属于 case 内治理。
- `ONBOARDING_FINAL_APPROVAL` 属于 approvals 模块治理。
- 它们不是同一个对象，也不是同一步。

## 第五模块：Customer Management + Case-bound Controls

### 这块到底做了什么
- 这块不要讲成“客户列表页增强”。
- 正确讲法是：
  `Wave 3 把 customer management 正式变成一个受 compliance case 约束的控制面。`

### 当前 customer 级动作
1. `RESTRICT`
2. `UNRESTRICT`
3. `FREEZE`
4. `UNFREEZE`

### 当前硬规则
- 所有这些动作都必须绑定**已有 compliance case**。
- 也就是说：
1. 不允许绕过 case 直接改客户控制状态
2. customer management 不能长出第二套独立合规动作系统

### 动作语义怎么理解
1. `RESTRICT`
   - `restrictionStatus = RESTRICTED`
2. `UNRESTRICT`
   - `restrictionStatus = CLEAR`
3. `FREEZE / UNFREEZE`
   - 继续走 `complianceHoldStatus`

### 为什么这条规则重要
- 因为它保证：
1. customer control 有调查来源
2. customer control 有审计链
3. customer control 不会变成 operator 随手操作

## 第六模块：Periodic Review

### 一句话定位
- `Periodic Review` 不是 onboarding 的延长线。
- 它是：
  `客户生命周期上的独立复审周期。`

### 为什么要独立讲
- 因为它虽然复用了同一套 `Risk Engine / Alert / Case`
- 但它自己的 workflow root、trace root、状态机和 customer 影响都不同

### 当前主路径
1. due customer 触发 `PeriodicReviewCycle`
2. cycle 创建，customer 自动进入 `RESTRICTED`
3. customer 提交 `CDD Response`
4. 系统创建 `PERIODIC_REVIEW_CDD` decision record
5. operator 在 `Risk Policy Executions` 完成 manual simulation
6. 需要时进入 alert / case / MLRO
7. 如果 `REQUIRE_EDD`
   - cycle 进入 `PENDING_EDD_INPUT`
8. customer 提交 `EDD Response`
9. 系统创建 `PERIODIC_REVIEW_EDD` decision record
10. 再次经过 review 链
11. `CLEAR`
   - 去掉 restriction
   - cycle 变 `CLEARED`
12. `REJECT`
   - 保持 restriction
   - cycle 变 `REJECTED`

### Periodic Review 状态机
- 当前 canonical cycle state 固定为：
1. `PENDING_CDD_INPUT`
2. `CDD_UNDER_REVIEW`
3. `PENDING_EDD_INPUT`
4. `EDD_UNDER_REVIEW`
5. `CLEARED`
6. `REJECTED`

### 和 Onboarding 最重要的区别
- 建议直接讲：
  `Onboarding 解决客户能不能进来，Periodic Review 解决已经进来的客户还能不能继续留在系统里。`
- 最重要的 runtime 规则：
  `Periodic Review 不改写 onboardingStatus。`

## 第七模块：统一 Audit Center 与 Trace Contract

### 为什么 Wave 3 必须单独讲 trace
- 因为 `Wave 3` 是第一波真正把客户正式生命周期串起来的波次。
- 一旦 trace 不统一，`Audit Center` 就只能看到碎片，不能回放整条链。

### 当前固定 trace root
1. onboarding：
   - `ONBOARDING:<journeyId>`
2. periodic review：
   - `PERIODIC_REVIEW:<cycle.id>`

### 哪些对象必须共用同一条 trace
- onboarding 主链上至少包括：
1. response
2. alert
3. case
4. MLRO
5. final approval
- periodic review 主链上至少包括：
1. cycle
2. response
3. alert
4. case
5. final disposition

### 最重要的一句提醒
- 建议直接说：
  `同一条业务链上的对象不能自己重新 mint trace；它们必须继承 workflow root trace。`

## 开发最容易写偏的点
- 不要把 `CDD / EDD Response` 当成 `Case`。
- 不要让 `Risk Engine` 直接改 customer 状态。
- 不要让 `Alert / Case` 越权拥有 onboarding 主状态机。
- 不要把 `EDD CLEAR` 讲成最终开户完成。
- 不要把 `Periodic Review` 当成 onboarding 的延长状态。
- 不要让 customer control 绕过已有 compliance case。

## 最适合收尾的一段话
- 可以直接这样讲给开发：
  `Wave 3 真正完成的，不是几个 onboarding 页面，而是客户正式生命周期。它把 Customer 状态模型、CDD/EDD 证据采集、Risk Engine 判定、Alert/Case 调查、MLRO 治理、Final Approval、Customer Management 和 Periodic Review 全部串成了一条正式主链。到这一步，平台第一次真正拥有了“客户如何进入系统、如何被持续复审、如何被限制或批准”的完整语义。`

## 超短版提纲
- `Wave 3 = onboarding + customer management + periodic review`
- `Customer 状态模型正式定型`
- `CDD/EDD Response 是证据容器，不是 Case`
- `Onboarding review 复用 Wave 2 的 Risk Engine / Alert / Case`
- `EDD CLEAR 不等于开户完成，后面还有 Final Approval`
- `Periodic Review 是独立复审周期，不改写 onboardingStatus`
