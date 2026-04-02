Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-01
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/roadmap/project-version-plan.md`, `docs/roadmap/wave-2-compliance-foundation-phase-plan.md`, `docs/constraints/compliance-alert-case-foundation-constraints.md`, `docs/constraints/compliance-alert-incident-constraints.md`, `docs/constraints/onboarding-flow-constraints.md`, `docs/constraints/onboarding-alert-case-workflow-stage-rule-mapping.md`, `docs/specs/modules/risk-engine-module.md`, `docs/specs/modules/compliance-center-module.md`, `docs/specs/entities/risk-decision-record-entity.md`, `docs/specs/entities/compliance-alert-entity.md`, `docs/specs/entities/compliance-case-entity.md`, `docs/specs/workflows/alert-triage-and-case-escalation.md`, `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`, `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
Source of Truth Level: product-narrative-supporting-doc

# Wave 2 串讲稿：合规中台核（Compliance Foundation）

## 文档目的
- 本文是一份面向开发、产品、内部讲解场景的 `Wave 2` 中文串讲稿。
- 它的用途是把 `Wave 2` 的产品边界、核心对象、讲解口径和已讨论收敛点讲清楚。
- 如果本文与系统运行时真相冲突，以 `docs/constraints/**` 和 `docs/specs/**` 为准。
- `Case` 相关内容在本文中只记录当前已经讨论出的收敛结论与待深挖问题，不把未定方案写成既定真相。

## 使用方式
- 适合在 `Wave 1` 控制底座讲完之后，作为第二个完整模块对开发进行串讲。
- 推荐讲解顺序：
1. 先讲 `Wave 2` 的一句话定位
2. 再讲 `Risk Engine + Decision Record`
3. 再讲 `Alert`
4. 最后讲 `Case` 当前收敛结论与开放问题
- 本文适合 `20-30` 分钟的口头串讲。

## 一句话定位
- `Wave 2` 不是完整客户准入闭环，也不是交易主链。
- `Wave 2` 的定位是：`先把整个平台的合规中台核做出来。`
- 这个中台核当前最重要的对象和能力是：
1. `Risk Engine`
2. `Decision Record`
3. `Alert`
4. `Case`
5. 标准动作目录
6. 合规工作流的统一审计 trace 合同

## Wave 2 和 Wave 1 的关系
- 建议这样讲给开发：
  `Wave 1 解决的是治理控制面，Wave 2 解决的是合规处理内核。`
- `Wave 1` 提供：
1. 权限边界
2. maker-checker
3. 审计底座
4. 证据导出
5. SLA 时间控制
- `Wave 2` 在这层底座之上开始回答：
1. 风险怎么统一判定
2. 命中怎么统一分诊
3. 复杂问题怎么统一调查
4. 调查结果怎么统一回驱业务工作流

## Wave 2 的业务范围
- 当前讲稿口径建议把 `Wave 2` 的范围固定成 5 块：
1. 风险判定内核
2. 风险解释沉淀
3. 告警分诊内核
4. 调查案件内核
5. 合规动作语义冻结
- 最适合直接讲给开发的一句话：
  `Wave 2 的目标不是先把 onboarding 页面补完，而是先把风险、告警、调查这条合规处理链做成统一平台能力。`

## Wave 2 明确不做什么
- 不把 `Wave 2` 讲成完整 onboarding。
- 不把 provider response 讲成 case。
- 不把 `Risk Engine` 讲成状态机 owner。
- 不把 `Alert` 讲成调查对象。
- 不把 `Case` 讲成审批对象。
- 不把 `contextType / workflowType / stage` 讲成三个并列的一等业务概念。

## 标准动作目录到底是什么
- 建议这样解释：
  `标准动作目录不是一个下拉菜单，而是一张平台级动作语义表。`
- 它要回答的是：
1. 哪些动作属于 `Alert`
2. 哪些动作属于 `Case`
3. 哪些动作是 workflow proposal
4. 哪些动作是 interim measure
5. 哪些动作属于 MLRO 治理
- 当前最重要的动作分层可以先收敛成：
1. `Alert Handling`
   - `ASSIGN`
   - `REASSIGN`
   - `FALSE_POSITIVE`
   - `DIRECT_DISPOSITION`
   - `ESCALATE_TO_CASE`
2. `Case Actions`
   - `ASSIGN`
   - `REASSIGN`
   - `LINK_ALERT`
3. `Interim Measures`
   - `FREEZE`
   - `UNFREEZE`
   - `RESTRICT`
   - `UNRESTRICT`
4. `Workflow Proposal`
   - `CLEAR`
   - `REJECT`
   - `REQUIRE_EDD`
   - transaction 场景兼容 `FREEZE_TRANSACTION`
5. `MLRO Review`
   - `RETURN_FOR_INVESTIGATION`
   - `APPROVE_FINAL_DISPOSITION`
- 一句收口：
  `标准动作目录的价值，是把“能做什么动作”从散落在 service 和页面里的 if-else，提升成平台级语义规则。`

## 统一证据与审计 Trace
- 这里最容易讲混，建议直接区分两层：
1. `Wave 1`
   - 给了统一审计底座和证据导出能力
2. `Wave 2`
   - 把合规工作流的 trace contract 定死
- 建议这样讲：
  `Wave 1 提供的是审计基础设施，Wave 2 提供的是合规工作流如何共用同一条 trace 的领域合同。`
- 当前最重要的口径是：
1. workflow-bound `alert / case / approval / filing` 必须继承同一条 trace
2. 不能每个对象自己重新 mint 一条 trace
3. `Audit Center` 必须能按一条 workflow root 回放整条链

## 第一模块：Risk Engine + Decision Record

### 先下定义
- `Risk Engine` 是统一风险判定器。
- `Decision Record` 是每次风险判定留下来的解释根。
- 建议直接讲：
  `Risk Engine 负责做判断，Decision Record 负责把这次判断固定成可回放事实。`

### 为什么建议一起讲
- 如果只讲 `Risk Engine`，开发容易把它理解成一个黑盒函数。
- 把 `Decision Record` 一起讲进去，系统语义才完整：
1. 输入是什么
2. 怎么判
3. 输出什么
4. 判完沉淀成什么对象
5. 下游怎么消费

### Risk Engine 的核心输入
- 当前最适合对开发讲的输入只有 5 个：
1. `workflowType`
2. `stage`
3. `subjectId`
4. `signals`
5. `policyVersion`
- 讲解建议：
  `workflowType` 表示这次评估属于哪条业务链，`stage` 表示它卡在哪个审核关口，`signals` 是证据输入，`policyVersion` 表示这次采用哪版风险策略口径。`

### 关于 `contextType`
- 当前项目运行时里仍然存在 `contextType`。
- 但我们这轮讨论的收敛结论是：
  `在当前范围里，contextType 和 workflowType + stage 高度重叠。`
- 所以在讲稿口径上建议降级成：
  `contextType 是 Risk Engine 内部的评估模板别名，不需要和 workflowType + stage 并列成三个同级概念。`
- 一句推荐说法：
  `workflowType 解决“属于哪条业务链”，stage 解决“卡在哪一关”，contextType 只是风险引擎内部模板别名。`

### Risk Engine 的核心输出
- 当前建议讲成 5 个输出：
1. `riskLevel`
2. `reasonCodes`
3. `recommendedWorkflowDecisions`
4. `orchestrationSignals`
5. `decisionRecord`
- 特别要补一句：
  `riskLevel` 是业务上一等输出，即使当前物理模型里还没有一个特别干净的独立字段。`

### Recommendation 到底怎么理解
- 当前讨论后的收敛口径建议这样写：
  `workflowType + stage 定义允许建议什么，Risk Engine 输出这次实际推荐什么。`
- 也就是说：
1. 动作全集不是 Risk Engine 随意发明的
2. 动作全集由 workflow/stage 语义预先限定
3. Risk Engine 只是给出本次推荐子集
- 这也是为什么 `Case` 的临时措施不应该算进 `Risk Engine` 原生输出。

### Decision Record 的意义
- `Decision Record` 是风险评估的解释根。
- 它不是 triage 对象，也不是调查对象。
- 它的作用是让这次评估具备：
1. 可解释
2. 可回放
3. 可审计
4. 可做后续 alert/case 编排
- 最适合直接讲的一句话：
  `Decision Record 不是风险问题本身，而是这次风险判断为什么成立的官方记录。`

### Decision Record 当前物理真相
- 当前物理模型还是 `WorkflowDecisionRecord`。
- 当前 canonical fields 至少包括：
1. `contextType`
2. `subjectId`
3. `policyVersion`
4. `status`
5. `inputPayload`
6. `inputHash`
7. `outputDecision`
8. `recommendedActions`
9. `outputs`
10. `reasonCodes`
- 这里建议对开发补一句：
  `产品语义上它已经是 Decision Record，但物理模型名还没完全改干净。`

### Decision Record 当前实际 workflowType / stage 映射
- 当前运行时里，`Decision Record` 表里并没有单独存 `workflowType / stage` 字段。
- 它们主要从 `contextType` 投影出来。
- 当前实际在用的映射可以先这样讲：
1. `ONBOARDING`
   - `REVIEW_CDD`
   - `REVIEW_EDD`
2. `PERIODIC_REVIEW`
   - `REVIEW_CDD`
   - `REVIEW_EDD`
3. `TRANSACTION`
   - `REVIEW_KYT`
   - `REVIEW_TRAVEL_RULE`
   - `REVIEW_DEPOSIT_FINAL`
   - `REVIEW_WITHDRAW_PRECHECK`
   - `REVIEW_WITHDRAW_FINAL`
   - `REVIEW_SWAP_FINAL`
- 当前讨论结论补充：
  `长期讲解口径上，更理想的是让 workflowType 直接表达业务根类型；但当前运行时兼容层里，交易侧仍大量表现为 TRANSACTION + stage。`

### `policyVersion` 到底是什么
- 当前收敛口径：
  `policyVersion` 不是单条规则编号，而是整套风险策略包的版本号。`
- 它更像：
  `这次评估采用的是哪一版规则书`
- 它和 `reasonCodes` 的区别要讲清楚：
1. `policyVersion`
   - 哪一版策略包
2. `reasonCodes`
   - 这次具体命中了哪些原因/规则
- 当前运行时来源：
1. onboarding 显式传 `onboarding-risk-policy/v1`
2. periodic review 显式传 `periodic-review-risk-policy/v1`
3. transaction 默认回退到 `transaction-risk-policy/v1`
- 当前实现它主要还是代码里的版本标签。
- 目标态产品判断：
  `policyVersion 背后应当是一份受治理的风险策略配置版本，未来应该接入 Change Ticket + Config Release，而不是长期写死在代码里。`

## 第二模块：Alert

### 先下定义
- `Alert` 是合规中台里的分诊对象。
- 它负责把风险命中变成一个可分配、可处理、可升级的 triage work item。
- 一句最推荐的话：
  `Risk Engine 负责发现风险，Alert 负责接住风险并做第一层处理。`

### Alert 解决什么问题
- `Alert` 主要做 5 件事：
1. 承接风险命中
2. 去重聚合
3. 分配责任人
4. 做 alert 级处置
5. 必要时升级成 `Case`

### Alert 不是什么
- 它不是 `Decision Record`
- 它不是 `Case`
- 它不是 provider response
- 它不是审批流
- 它不是最终治理对象

### Alert 的结构
- 推荐按 6 组字段讲：
1. 身份字段
   - `id`
   - `alertNo`
2. 指派字段
   - `assigneeUserId`
   - `assigneeUserNo`
   - `assignedAt`
3. 运行时分类字段
   - `workflow`
   - `stage`
   - `rule`
   - `severity`
4. 生命周期字段
   - `status`
   - `dueAt`
   - `closedAt`
5. 处理结论字段
   - `currentDispositionCode`
   - `finalDispositionCode`
   - `primaryObject`
   - `availableHandlingActions`
   - `availableDirectProposals`
6. Trace 字段
   - `traceId`
   - `workflowType`
   - `workflowId`
   - `workflowNo`

### Alert 的状态机
- 当前 canonical 状态机是：
1. `OPEN`
2. `ASSIGNED`
3. `ESCALATED`
4. `CLOSED`
- `OPEN` 主要解决“还没人接手”
- `ASSIGNED` 表示已有 triage owner
- `ESCALATED` 表示已经升级到 case
- `CLOSED` 是终态

### Alert Handling
- 当前 alert 只有一个 canonical handling surface：
  `Alert Handling`
- 它同时包含：
1. work-item ownership actions
2. alert-level resolution actions
- 当前 canonical handling actions：
1. `ASSIGN`
2. `REASSIGN`
3. `FALSE_POSITIVE`
4. `DIRECT_DISPOSITION`
5. `ESCALATE_TO_CASE`

### 最推荐的收敛讲法
- 当前我们讨论后的收敛讲法建议是：
  `Alert 的 disposition 核心只回答两件事：这是不是风险问题，以及如果能直接处理，这条业务链建议怎么走。`
- 对开发可以直接讲成：
1. 不是风险
   - `FALSE_POSITIVE`
2. 是风险，但 alert 层就能直接给出建议
   - `DIRECT_DISPOSITION`
3. 还不能下结论，需要正式调查
   - `ESCALATE_TO_CASE`

### workflow-bound alert
- workflow-bound alert 会额外带：
1. `workflow`
2. `stage`
3. `rule`
4. `primaryObject`
- 它的 direct proposal 当前是有限集，不是任意动作。
- 当前最常被点名的 proposal：
1. onboarding / periodic review `REVIEW_CDD`
   - `REJECT`
   - `REQUIRE_EDD`
2. onboarding / periodic review `REVIEW_EDD`
   - `REJECT`
3. deposit review alerts
   - `REJECT`
   - `FREEZE_TRANSACTION`

### Alert 的一句话总结
- 直接讲：
  `Alert 不是调查对象，它是风险命中的分诊工作项。`

## 第三模块：Case（当前收敛结论与待深挖问题）

### 先下定义
- `Case` 是合规中台里的调查对象。
- 如果说 `Alert` 负责分诊，那么 `Case` 负责正式调查、提案、临时控制和进入 MLRO 治理边界。

### 当前已经收敛的结论
- 这轮讨论里已经比较稳定的收敛结论有 4 条：
1. `Case` 不应该被讲成“更重一点的 Alert”
2. `Case` 的第一职责是 `investigation`
3. `Case` 当前最实在的新增能力是 `customer control`
4. `MLRO gate` 才是 case 结论真正生效的边界

### 当前最推荐的讲法
- 建议先把 `Case` 收敛成 3 个面：
1. `Investigation`
2. `Customer Control`
3. `MLRO Gate`
- 讲给开发可以直接说：
  `Case 不是一个更大的 disposition 容器，而是调查、客户控制和最终治理生效的结合体。`

### Interim Measure 当前到底作用在哪
- 当前最重要的收敛结论：
  `Case interim measure 现在主要打在 customer control state 上，而不是一个通用多主体 measure 引擎。`
- 当前最核心的 measure：
1. `FREEZE / UNFREEZE`
2. `RESTRICT / UNRESTRICT`
- 当前更接近的真实语义是：
1. `FREEZE / UNFREEZE`
   - 写 `complianceHoldStatus`
2. `RESTRICT / UNRESTRICT`
   - 写 `restrictionStatus`
- 所以当前讲解时不建议把它讲成：
  `Case 可以对任意主体做通用临时处置`
- 当前更稳的说法是：
  `Case 当前的临时处置，本质上还是 customer control。`

### `FREEZE_TRANSACTION` 和 `Case FREEZE` 不是一回事
- 这里必须提醒开发：
1. `FREEZE_TRANSACTION`
   - 更像 workflow proposal / transaction action
2. `Case FREEZE`
   - 当前更像 customer control measure
- 这两个如果不拆开，`Case` 模型会一直显得臃肿。

### `CDD` 和 `EDD` 到底怎么和 Case 对齐
- 当前已经比较明确的结论：
1. `Alert` 必须按 `stage` 分开
2. `REVIEW_CDD` 和 `REVIEW_EDD` 不能共用一个 alert
- 当前更值得后续继续设计的问题是：
  `Case` 是否应该按 workflow root 聚合，而不是按 stage 拆分
- 我们这轮讨论更偏向的方向是：
1. 一个 workflow root 可以有多个 stage alert
2. 一个 workflow root 同时最好只有一个 active case
3. 后续新阶段 alert 默认 link 到已有 active case
- 但这里还没有在本文中把它写成最终既定真相
- 原因是：
1. 当前文档和测试仍保留了按阶段分 case 的痕迹
2. 这部分需要后续深度设计后再定

### 当前对 Case 的保守口径
- 在正式定案前，建议对开发只讲到这里：
  `Case 是 investigation kernel，它在 Alert 的基础上新增 customer control 和 MLRO gate；其中 customer control 当前主要还是 customer 级控制，而不是任意主体的通用处置。`

## 讲到这里该怎么收口
- 最适合的收尾方式：
  `Wave 2 先把风险判定、解释沉淀、告警分诊和调查内核做出来。`
- 也可以更具体一点：
  `Risk Engine 负责判，Decision Record 负责留痕，Alert 负责分诊，Case 负责调查和治理生效。`
- 然后再接下一句：
  `后面的 onboarding / deposit / swap / withdraw，只是这些平台能力的业务消费者。`

## 当前最值得提醒开发的 5 句话
1. `Risk Engine` 不是状态机 owner
2. `Decision Record` 不是 alert，也不是 case
3. `Alert` 是 triage kernel，不是 investigation kernel
4. `Case` 当前最值得收敛成 investigation + customer control + MLRO gate
5. `policyVersion` 背后最终应该接入受治理的 config release，而不是长期写死在代码里

