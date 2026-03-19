# Wave 2 合规基座分阶段规划（Risk / Alert / Case Foundation）

## 1. 文档目的

本文件用于把总版本规划中的 `Wave 2` 进一步拆成多个可执行 `phase`，作为后续开发、产品、测试、agent 协作时的统一参考。

适用原则：

- 本文是 `Wave 2` 的专项规划文档，不替代 `AGENTS.md` 与 `docs/constraints/**`。
- `Phase 1` 的领域基线以 `docs/constraints/compliance-alert-case-foundation-constraints.md` 为准。
- 当前运行时的 `alert / incident` 兼容约束以 `docs/constraints/compliance-alert-incident-constraints.md` 为准。
- `Wave 2` 的核心目标是先把合规中台底座打牢，再决定业务域如何接入。
- 当单个需求只完成部分能力时，以 `phase` 的 `DoD` 判断是否可交付，而不是以功能名字是否出现来判断。

---

## 2. Wave 2 总目标

`Wave 2` 的目标不是做完整 onboarding，也不是做完整客户准入主链，而是先建立一套稳定、可复用、可审计、可取证的合规中台基座：

- `Risk Engine`
- `Decision Record`
- `Alert`
- `Case`
- 标准动作目录
- 统一证据与审计留痕

这套基座完成后，再由 onboarding、交易合规、冻结门禁等业务域逐步接入。

`Wave 2` 的后半段重点不是继续堆页面或补单点功能，而是把底座的关键语义和编排关系收口清楚：

- `Disposition model`
- `Risk Decision -> Alert orchestration`
- `Case investigation kernel`
- `Workflow transition contract`

从 `Phase 6` 开始，`alert / case` 的主组织语言固定为：

- `workflow`
- `stage`
- `rule`

当前 hardening 主线只覆盖：

- `workflow = ONBOARDING`
- `stage = REVIEW_CDD | REVIEW_EDD`

说明：

- `FINAL_APPROVAL` 继续属于 onboarding workflow 阶段，不属于当前 `alert / case` stage。
- 本轮不再使用 `triggerType` 来描述 `alert / case`。
- rule 只负责解释“为什么在这个 stage 出现 alert / case”；更细的风险命中继续落在 `reasonCodes / metadata`。

说明：

- `Approval Trigger Contract` 明确后置，不纳入当前 `Wave 2` hardening 主线。
- onboarding 仍然只是首个消费方，不决定后半段基座设计。

---

## 3. 领域命名冻结

本波次内，领域命名先统一如下：

### 3.1 Provider Response（外部响应容器）

以下对象不再占用“合规 case”语义，而是定义为外部返回数据容器或证据对象：

- `KYT`
- `Travel Rule`
- `CDD`
- `EDD`

这些对象的职责是：

- 存储外部系统返回的结构化响应
- 保留回放、比对、审计、证据展示所需字段
- 在后台提供可视化查看能力
- 当前代码里的 `CddResponse / EddResponse / KytCase / TravelRuleCase` 都按这个层来解释

它们不是合规调查对象，不与 `Case` 争夺命名。

### 3.2 Decision Record

`Decision Record` 是 `Risk Engine` 的执行记录，负责保存：

- 输入快照
- 输入摘要/hash
- 输出决策
- 推荐动作
- 原因码
- 执行状态

它不是分诊对象，也不是调查对象。

### 3.3 Alert

`Alert` 是分诊对象，负责：

- 承接规则命中
- 去重聚合
- 初步分配
- 人工分诊
- 升级到 `Case`

`Alert` 不承载完整调查生命周期。

### 3.4 Case

`Case` 是合规人员真正处理的调查对象，负责：

- 人工调查
- 关联多个 alerts
- 承载标准动作
- 结案与证据沉淀

### 3.5 Incident 的过渡定义

当前代码中的 `incident` 视为未来 `Case` 的过渡实现。

迁移策略：

1. 先冻结领域语义为 `Case`
2. 再逐步调整 UI / API / DTO 命名
3. 最后视收益决定是否做物理表重命名

在 `Wave 2` 中，禁止再新增会和 `Case` 语义冲突的新对象命名。

---

## 4. 当前基线判断

当前代码可作为 `Wave 2` 起点，但还未达到完整中台标准：

- `Alert / Incident` 已有后端服务、状态机、前端页面，可作为 `Alert / Case` 的过渡实现。
- `RiskEngineService` 已有执行和决策记录能力，但仍明显偏 onboarding 特化。
- `KYT / Travel Rule / CDD / EDD` 相关对象已存在，但更适合作为 `Provider Response` / evidence container，而不是合规 case。
- 统一审计底座已具备，可直接复用。
- `onboarding review container integration` 不应主导 `Wave 2`，只应作为后续消费方接入能力。

---

## 5. Wave 2 分期总览

建议把 `Wave 2` 拆成两段理解：

- `Phase 1-5`: `Foundation Build`
  - 解决“平台基座先跑起来”的问题
- `Phase 6-12`: `Foundation Hardening`
  - 解决“语义、编排、调查、工作流契约定型”的问题
  - `Phase 6-9` 先按 onboarding review 场景收口
  - `Phase 10-12` 再把 onboarding / periodic review 与 transaction 共用的 `alert / case / workflow / report / MLRO` 分层补齐

| Phase | 名称 | 目标 |
| --- | --- | --- |
| `Phase 1` | 领域契约冻结 | 统一命名、对象边界、状态机与迁移策略 |
| `Phase 2` | Risk Engine Core | 把 risk engine 从 onboarding 特化实现中抽离出来 |
| `Phase 3` | Alert Triage Core | 把 alert 建成统一分诊台 |
| `Phase 4` | Case Management Core | 把当前 incident 演进为真正的 case 管理内核 |
| `Phase 5` | Actions + Evidence + Integrations | 补齐标准动作、证据导出、业务接线 |
| `Phase 6` | Disposition Model | 把合规结论从零散字段抽象成正式模型 |
| `Phase 7` | Risk Decision -> Alert Orchestration | 让 alert 来源统一收口到 risk/policy decision 层 |
| `Phase 8` | Case Investigation Kernel | 让 case 成为真正的调查对象而不只是动作容器 |
| `Phase 9` | Workflow Transition Contract | 让业务工作流通过 disposition 消费结论并推进状态 |
| `Phase 10` | Alert Outcome And Workflow Decision Split | 把 alert triage outcome 与 workflow decision 正式拆层 |
| `Phase 11` | Case State Machine And Interim Measures | 把 case 定义成正式调查对象，并单列临时处置措施 |
| `Phase 12` | Report, MLRO Review And Final Disposition Gate | 把调查报告、MLRO 审核与最终结论生效链路定型 |

建议执行顺序：

1. `Phase 1-5` 作为基座建设段完成
2. `Phase 6`
3. `Phase 7`
4. `Phase 8`
5. `Phase 9`
6. `Phase 10`
7. `Phase 11`
8. `Phase 12`

---

## 6. Phase 1：领域契约冻结

### 目标

先冻结 `Wave 2` 的领域语言和对象职责，避免后面边开发边改语义。

### 范围

- 定义 `Provider Response / Decision Record / Alert / Case` 四层模型
- 冻结对象职责边界
- 冻结命名规范
- 冻结过渡期 `incident -> case` 演进策略

### P0 交付物

- `docs/constraints/compliance-alert-case-foundation-constraints.md`
- 更新 `docs/constraints/compliance-alert-incident-constraints.md` 的定位说明
- 统一命名表
- 统一对象职责说明
- `Alert` / `Case` 状态机与动作矩阵
- `Provider Response` 的只读展示定位
- 现有对象映射表
- 公共接口兼容边界说明
- 代码迁移顺序说明：
  - 先领域语义
  - 再 `Decision Record`
  - 再 `Alert`
  - 再 `Case`
  - 最后动作/证据/集成

### Phase 1 核心映射表

| 当前实现对象 | Phase 1 语义定位 | 说明 |
| --- | --- | --- |
| `CddResponse` / `EddResponse` | `Provider Response` | onboarding 外部响应/证据容器，不占用合规 `Case` 语义 |
| `KytCase` / `TravelRuleCase` | `Provider Response` | 交易侧外部响应/证据容器 |
| `WorkflowDecisionRecord` | `Decision Record` 的当前特化实现 | 后续在 `Phase 2` 平台化 |
| `ComplianceAlert` | `Alert` | 当前分诊对象实现 |
| `ComplianceIncident` | `Case` 的当前过渡实现 | 当前运行时仍保留 `incident` 命名 |

### Phase 1 公共接口兼容边界

- 本阶段不改运行时代码，不新增 `/cases` API
- 现有 API 保持不变：
  - `/admin/compliance/alerts/**`
  - `/admin/compliance/incidents/**`
- 现有物理表保持不变：
  - `compliance_alerts`
  - `compliance_incidents`
  - `compliance_incident_alerts`
  - `compliance_incident_events`
- 现有 DTO / service / page 命名保持不变，直到 `Phase 4` 再做代码层收口
- `Case` 在 `Phase 1` 只冻结语义，不冻结具体 `caseType` 枚举

### Wave DoD

- 团队后续讨论和文档中，不再混用：
  - `KYT` 容器与通用 `Case`
  - `Travel Rule` 容器与通用 `Case`
  - `Incident`
  - `Compliance case`
- 所有新增需求都能明确落入四层之一。

### Phase 1 验收检查

- foundation 文档与本规划文档口径一致
- `alert-incident` 约束文档明确标注为当前 V1 实现约束
- 文档里不再把 `KYT / Travel Rule / CDD / EDD` 直接当作合规 `Case`
- 所有保留的 `incident` 描述都明确属于实现兼容名或过渡名
- 后续 `Phase 2 / 3 / 4` 的入口前提清楚，不需要再次定义核心语义

### 明确不做

- 数据库迁移
- 大规模重命名
- 页面重构
- `/cases` 路由别名
- UI 菜单改名

---

## 7. Phase 2：Risk Engine Core

### 目标

把当前偏 onboarding 的 `Risk Engine` 抽成平台标准件。

### 范围

- 通用 risk evaluate contract
- 通用 decision record 存储与查询
- 风险执行历史查看
- `Provider Response` 作为 evidence/read model 的读取与展示

### P0 交付物

- 通用 `evaluate(...)` 契约，至少支持：
  - `contextType`
  - `subjectType`
  - `subjectId`
  - `ownerType`
  - `ownerId`
  - `signals`
  - `policyVersion`
- 通用 `Decision Record` 模型：
  - input snapshot
  - input hash
  - output snapshot
  - recommended actions
  - reason codes
  - status
- 独立 risk read API：
  - decision record list
  - decision record detail
- 后台 `Risk Policy Executions` 页面从 onboarding 语义中解耦
- `KYT / Travel Rule / CDD / EDD` 视图统一按 provider response/evidence object 展示

### Wave DoD

- `Risk Engine` 不再只服务 onboarding
- `Decision Record` 不再是 onboarding 私有视角
- 新接入业务域可以不依赖 onboarding 模块直接使用 risk engine

### 明确不做

- 完整 case 生命周期
- 业务侧大规模接入
- 完整客户准入状态机

---

## 8. Phase 3：Alert Triage Core

### 目标

把 `Alert` 建成全平台统一分诊台。

### 范围

- alert rule catalog
- dedupe
- assign / reassign
- close / escalate
- overdue 检索
- 审计留痕
- 前端分诊页面定型

### P0 交付物

- 统一 alert 规则目录与规则编码规范
- 标准去重键规则
- `Alert` 生命周期冻结：
  - `OPEN`
  - `ASSIGNED`
  - `ESCALATED`
  - `CLOSED`
- assignee 与重分配约束
- 前端 `Alerts` 页面定型
- 所有 alert 写入统一审计

### Wave DoD

- 所有上游模块只负责产生命中，不自行实现调查流
- `Alert` 成为唯一分诊入口
- 已关闭 alert 再次命中时自动新开，不覆盖旧记录
- 当前运行时的 `incident` 仅作为过渡实现存在，并开始向规范 `Case` 主路径收口

### 明确不做

- 把 alert 直接当 case 用
- 完整冻结/上报动作编排
- 完整业务域覆盖

---

## 9. Phase 4：Case Management Core

### 目标

把当前 `incident` 过渡实现演进成真正的 `Case` 管理内核。

### 范围

- `Alert -> Case` 升级主链
- case assignee 规则
- case timeline
- 多 alert 关联
- case detail/read model
- UI/API 逐步从 `incident` 切到 `case`

### P0 交付物

- 统一 `Case` 生命周期
- `Alert -> Case` 原子升级链路
- 规范主入口：
  - `/admin/compliance/cases/**`
  - `/dashboard/compliance/cases`
- `Case` 详情页与列表页
- `Case` 和 `Alert` 的关联关系模型
- `caseType` 持久化字段与最小 taxonomy：
  - `ONBOARDING`
  - `TRANSACTION`
  - `GENERIC`
- `CASE_READ / CASE_WRITE` 权限分组
- `Case` 审计写入统一经 `AuditLogsService`
- 兼容策略：
  - 先保留现有 `incident` 物理表
  - 旧 `/admin/compliance/incidents/**` 和 `/dashboard/compliance/incidents` 保留兼容别名
  - UI / API 文案改为 `Case`
  - DTO/service 层逐步收口

### Wave DoD

- 合规调查对象统一叫 `Case`
- `Alert` 只负责分诊，`Case` 负责调查
- 一个 `Case` 可以聚合多个 `Alerts`
- 主 UI / API 路径统一切到 `cases`，`incidents` 仅保留兼容访问能力

### 明确不做

- 一次性物理表重命名
- 跨所有业务域统一切换所有旧字段命名

---

## 10. Phase 5：Actions + Evidence + Integrations

### 目标

补齐真正让合规底座可长期承接业务的动作、证据与集成能力，但不承担工作流/审批契约的终局收口。

### 范围

- 标准动作目录
- case 维度证据导出
- overdue 主动处理
- 最小业务接线
- onboarding review path 接入条件判断

### P0 交付物

- 标准动作目录落地：
  - `freeze`
  - `unfreeze`
  - `report`
  - `close`
- 标准动作与 `Case` 主链打通
- `Case` 维度证据导出能力，至少支持：
  - `caseType`
  - `status`
  - `owner`
  - `period`
- overdue / SLA 主动处理机制
- 只在 customer / journey / review container 足够稳定时，才接入 onboarding review path：
  - risk engine 输出 recommendation
  - review 结果通过 `Alert / Case` 容器处理
  - 非法状态迁移由后端阻断

### Wave DoD

- 合规团队可以依赖这套底座真实调查、动作处置、导出证据
- `Alert / Case` 不再只是演示性模块

### 明确不做

- 完整 onboarding / KYB 状态机
- 客户钱包 / 银行账户模型
- 交易主链全量 case 接入
- `Approval Trigger Contract`
- `Workflow Transition Contract`

说明：

- 如果届时 customer / onboarding 主体仍未稳定，`onboarding review container integration` 顺延到 `Wave 3`，不阻塞 `Wave 2` 交付。

---

## 11. Phase 6：Disposition Model

### 目标

把当前散落在 `decision / closeReason / reportStatus / finalApprovalStatus` 中的“合规结论”抽象成正式模型，并按 onboarding review 的 `workflow / stage / rule` 结构组织。

### 范围

- `Alert disposition`
- `Case disposition`
- `currentDisposition / finalDisposition`
- `disposition history records`
- onboarding review stage 与 `alert / case` 的关系
- `Work Item Action` 与 `Compliance Action` 的边界

### P0 交付物

- `Alert disposition` 字典
- `Case disposition` 字典
- `currentDisposition / finalDisposition / disposition history` 的语义说明
- `status`、`disposition`、`close` 的职责边界
- `workflow / stage / rule` 的最小定义：
  - `workflow = ONBOARDING`
  - `stage = REVIEW_CDD | REVIEW_EDD`
  - `rule = ONB_CDD_REVIEW_REQUIRED | ONB_EDD_REVIEW_REQUIRED`
- `Alert Work Item Action / Alert Compliance Action`
- `Case Work Item Action / Case Compliance Action`
- 当前 `decision` 与未来 `disposition` 的迁移映射表

### 核心规则

- `status`、`disposition`、`close` 是三件事
- `disposition` 可以先于 `close`
- 一个 `Alert / Case` 在任一时刻只有一个 `currentDisposition`
- 历史上可以有 `N` 条 `disposition history records`
- 如果对象进入结案语义，允许再固化 `finalDisposition`
- 未来不再把单个 `decision` 字段直接当成完整结论模型
- `workflow` 只保留 `ONBOARDING`
- `stage` 只保留：
  - `REVIEW_CDD`
  - `REVIEW_EDD`
- 以下 onboarding 状态继续属于 workflow，不属于当前 `alert / case` stage：
  - `PENDING_CDD`
  - `PENDING_EDD`
  - `FINAL_APPROVAL`
  - `ACTIVE`
  - `REJECTED`
  - `WITHDRAWN`
- `Alert` 与 `Case` 的 action 必须拆成两层：
  - `Work Item Action`
  - `Compliance Action`
- `ESCALATE_TO_CASE` 在展示与映射中统一归类到 `Compliance Action`

### Wave DoD

- 文档中所有“合规结论”讨论都落到 disposition 体系上
- 实现者不再需要猜 `decision / closeReason / reportStatus` 各自是否代表最终态度
- 实现者不再需要猜 `FINAL_APPROVAL` 是否属于 `alert / case` stage
- 实现者不再需要猜 `ASSIGN / CLOSE / ESCALATE / FREEZE / REPORT` 是否属于同一类 action

### 明确不做

- 本 phase 不定义 approval
- 不要求一次性改掉现有数据库字段
- 不要求本 phase 同步重写所有页面文案
- 不要求本 phase 保留 transaction/generic 的 rule 词表在主规划中继续活跃

---

## 12. Phase 7：Risk Decision -> Alert Orchestration

### 目标

让 `Alert` 的来源从“各业务自己触发”收口成“统一由 risk/policy decision 层驱动”，并且当前 hardening 只覆盖 onboarding。

### 范围

- `Provider Response -> Risk Decision -> Alert`
- `recommendedActions` 编排层
- `UPSERT_ALERT`
- `AUTO_ESCALATE_CASE`
- onboarding 首个完整接入者定义
- `workflow / stage / rule` 与 risk decision 的连接关系

### P0 交付物

- 标准 `recommendedActions` 类型清单
- `Provider Response -> signals -> decision -> recommendedActions -> alert` 主链定义
- orchestration layer 的职责说明
- `UPSERT_ALERT`、`AUTO_ESCALATE_CASE` 等编排动作契约
- onboarding 作为第一个完整接入者的落地说明：
  - `workflow = ONBOARDING`
  - `stage = REVIEW_CDD | REVIEW_EDD`
  - `rule` 只保留 onboarding 最小集
- 当前 rule 最小集说明：
  - `ONB_CDD_REVIEW_REQUIRED`
  - `ONB_EDD_REVIEW_REQUIRED`

### 核心规则

- 规范主链是：`Provider Response -> Risk Decision -> Alert`
- `Alert` 不是 `Provider Response`
- `Provider Response` 先转成标准 `signals`
- `Risk Engine` 输出：
  - `decision`
  - `reasonCodes`
  - `recommendedActions`
- alert 由 orchestration layer 消费 `recommendedActions` 后创建或更新
- 允许未来支持自动升级 case，但仍保留清晰的 `Alert -> Case` 关系
- 当前主规划中，以下 rule 从 active scope 删除：
  - `TX_KYT_*`
  - `TX_TRAVEL_RULE_*`
  - `TX_COMPLIANCE_*`
  - `ONB_CDD_REJECTED`
  - `ONB_EDD_REJECTED`
  - `ONB_FINAL_REJECTED`
  - `ONB_COMPLIANCE_BLOCKED_OR_RESTRICTED`
  - `ONB_PEP_HIT`
  - `ONB_SANCTIONS_HIT`
- `ONB_CDD_REVIEW_REQUIRED` 是 `REVIEW_CDD` 的 canonical stage rule
- `ONB_EDD_REVIEW_REQUIRED` 是 `REVIEW_EDD` 的 canonical stage rule
- `ONB_ONBOARDING_JOURNEY_REVIEW` 只保留为兼容别名：
  - `stage=REVIEW_CDD` 时映射到 `ONB_CDD_REVIEW_REQUIRED`
  - `stage=REVIEW_EDD` 时映射到 `ONB_EDD_REVIEW_REQUIRED`
- `PEP_HIT / SANCTIONS_HIT` 的风险细节不再占用 rule：
  - 运行时统一沉到 `reasonCodes / metadata`

### Wave DoD

- 新业务域接入时，不能再绕过 risk decision 直接起 alert
- alert 来源在架构层有唯一推荐路径
- onboarding 的 `workflow / stage / rule` 主链定型，不再继续沿用 `triggerType` 口径

### 明确不做

- 不要求本 phase 把 transaction/generic 历史实现一起收口
- 不在本 phase 扩展所有 case taxonomy
- 不把 `Alert -> Case` 自动升级策略一次性定死

---

## 13. Phase 8：Case Investigation Kernel

### 目标

把 `Case` 从“可升级、可关闭的容器”升级成真正的调查对象，并在 onboarding review 主线下定义与 `Alert` 的调查分工。

### 范围

- `Case Report / Investigation Report`
- case close 与调查报告关系
- `REPORT` 动作边界
- `STR / SAR` 与 case report 的边界
- `Case Work Item Action / Compliance Action` 分层

### P0 交付物

- `Case Report` 最小结构：
  - facts
  - scope
  - evidence summary
  - analyst conclusion
  - recommended actions
  - final disposition
- `Case close` 与 `Case report` 的关系说明
- `REPORT` 动作与 `Case report`、未来 `STR/SAR` 的边界
- `Case` 作为调查对象的最小能力清单
- onboarding review 下 `Case` 的最小动作矩阵：
  - `Work Item Action`
    - `ASSIGN`
    - `REASSIGN`
    - `LINK_ALERT`
    - `CLOSE`
  - `Compliance Action`
    - `APPROVE_STAGE`
    - `REJECT_STAGE`
    - `REQUIRE_EDD`（仅 `REVIEW_CDD`）
    - `FREEZE`
    - `UNFREEZE`
    - `REPORT`
    - `FALSE_POSITIVE`

### 核心规则

- `Case` 必须承载正式调查结果
- `Case Report / Investigation Report` 是独立对象，不等于 `closeReason`
- `STR / SAR` 不等于 case closing report
- `STR / SAR` 是 case 的可能输出之一，不是 case 报告本身
- `Case` 可以：
  - 结案但不报送
  - 结案并产生内部/外部报告
- `LINK_ALERT` 是纯 `Work Item Action`，不进入 disposition
- `FREEZE / REPORT` 是 `Compliance Action`，但不等于 status
- disposition 只保留结论层：
  - `FREEZE -> RESTRICT`
  - `REPORT -> REPORT`
  - `UNFREEZE` 不单独生成新的正向 disposition

### Wave DoD

- 文档上 `Case` 已经是“调查对象”，不是“动作容器”
- 后续实现者不需要再决定 `report` 和 `case close` 是否同义
- 后续实现者不需要再猜 `FREEZE / UNFREEZE / REPORT / LINK_ALERT / CLOSE` 是否属于同一类 action

### 明确不做

- 不在本 phase 直接接外部 `STR / SAR` 系统
- 不在本 phase 设计完整报送生命周期
- 不把当前内部 `REPORT` 动作直接等同于正式报送

---

## 14. Phase 9：Workflow Transition Contract

### 目标

让 `Alert / Case` 只产出合规结论，由业务 workflow 消费这些结论推进状态；当前示例只覆盖 onboarding。

### 范围

- `Disposition -> Workflow Transition`
- `Alert disposition -> workflow transition`
- `Case disposition -> workflow transition`
- onboarding 作为首个消费者的示例路径

### P0 交付物

- `Alert disposition -> workflow transition` 映射规则
- `Case disposition -> workflow transition` 映射规则
- onboarding 示例路径：
  - `CDD Alert disposition REQUIRE_EDD -> onboarding transition to PENDING_EDD`
  - `EDD Alert disposition APPROVE -> transition to FINAL_APPROVAL`
- onboarding-only 的 `workflow / stage / rule` 与 transition 关系说明
- `final workflow outcome` 与 `alert/case disposition` 的边界说明
- `disposition producer / workflow transition consumer` 的职责划分

### 核心规则

- 主链改为：`Disposition -> Workflow Transition`
- `Alert / Case` 不直接拥有业务主状态机
- `WorkflowTransitionService` 只是很薄的分发边界，不是通用 workflow engine
- 当前运行时固定为：
  - `WorkflowTransitionService -> OnboardingWorkflowTransitionService`
- onboarding 只是第一个消费者，不是唯一消费者
- 当前 workflow 只保留：
  - `ONBOARDING`
- 当前 `alert / case` stage 只保留：
  - `REVIEW_CDD`
  - `REVIEW_EDD`
- `FINAL_APPROVAL` 在本 phase 中继续被视为 workflow 级状态，而不是 `alert / case` stage
- `Workflow Transition` 与 `Approval Trigger` 明确分层：
  - 本 phase 只定义 transition contract
  - approval 后置

### Wave DoD

- 文档中工作流推进不再写成“alert/case 直接改业务状态”
- 实现者能明确知道谁负责给结论，谁负责消费结论
- 现有 onboarding decision 入口保持不变，但内部统一走 transition contract
- decision record 可同时回放 `orchestration + workflowTransition`

### 明确不做

- 不接 approvals 模块
- 不在本 phase 定义 maker/checker 或审批 action type
- 不把 `FINAL_APPROVAL` 并入当前 `alert / case` stage

---

## 15. Phase 10：Alert Outcome And Workflow Decision Split

### 目标

把 `alert` 从“混合动作容器”收口成轻量 triage work item，并把 workflow 推进从 alert action 中彻底拆出来。

### 范围

- `Alert Action`
- `Alert Outcome`
- `Workflow Decision`
- workflow-bound alert 与 generic alert 的差异
- onboarding / periodic review 与 transaction 两类 alert 分流模型

### P0 交付物

- `Alert Action / Alert Outcome / Workflow Decision` 三层边界图
- workflow-bound alert 的最小动作集
- transaction alert 的最小 triage 分流图
- `False Positive -> Clear` 自动收敛规则
- `alert disposition` 与 `workflow decision` 分别建模的说明

### 核心规则

- `Alert Action` 固定为轻量 triage / ownership：
  - `ASSIGN`
  - `REASSIGN`
  - `FALSE_POSITIVE`
  - `ESCALATE_TO_CASE`
- `Workflow Decision` 独立于 alert action，至少包含：
  - `CLEAR`
  - `REQUIRE_EDD`
  - `REJECT`
- `False Positive` 在 workflow-bound alert 上自动收敛到 `workflow decision = CLEAR`
- 但记录层必须分开：
  - `alert disposition`
  - `workflow decision`
- `No Action` 不再作为 workflow-bound alert 的推荐长期模型
- `Confirm Risk` 不作为独立按钮引入
- `Escalate to Case` 只表示 triage 升级，不表示 workflow 推进
- onboarding / periodic review 中，不再把 `Approve Stage` 作为推荐长期命名，统一收口到 `CLEAR`

### Wave DoD

- 实现者不再把 `False Positive / Escalate to Case / Clear / Require EDD / Reject` 视为同一类按钮
- onboarding / periodic review 的 alert 页面可以清楚拆成 triage outcome 与 workflow decision 两个区域
- transaction alert 的职责边界与 workflow-bound alert 清楚分开

### 明确不做

- 不在本 phase 直接改现有 UI 或 API
- 不把 case investigation 流程一并塞进 alert 模型
- 不在本 phase 引入 `Confirm Risk` 中间态

---

## 16. Phase 11：Case State Machine And Interim Measures

### 目标

把 `Case` 定义成正式调查对象，而不是 alert 放大版，并把临时处置措施从 workflow decision 中拆出来。

### 范围

- `Case` 状态机
- `Case Actions`
- `Interim Measures`
- `Workflow Decisions`
- onboarding case 与 transaction case 的最小分流模型

### P0 交付物

- 新 `Case` 状态机图
- `Case Actions / Interim Measures / Workflow Decisions` 三层按钮分组
- onboarding case 与 transaction case 的最小动作矩阵
- transaction 主线：
  - `Alert -> Escalate to Case -> Interim Measure -> Investigate -> Final Disposition`

### 核心规则

- `Case` 目标状态机固定为：
  - `OPEN`
  - `ASSIGNED`
  - `INVESTIGATING`
  - `PENDING_MLRO_REVIEW`
  - `CLOSED`
- `RESOLVED` 只保留为历史兼容，不再生产
- `Case Actions` 只负责 work item 本身：
  - `ASSIGN`
  - `REASSIGN`
  - `FALSE_POSITIVE`
  - `LINK_ALERT`（若保留）
- `Interim Measures` 单独成类：
  - `FREEZE`
  - `UNFREEZE`
  - `RESTRICT`
  - `UNRESTRICT`
- `Workflow Decisions` 只在 case 承载 workflow 时出现：
  - `CLEAR`
  - `REQUIRE_EDD`
  - `REJECT`
- investigator 允许先采取一轮临时措施，再继续调查
- onboarding case 只是复杂 review 的 investigation 容器，不是所有 EDD 自动升级后的默认形态

### Wave DoD

- 实现者不再把 `FREEZE / RESTRICT / REPORT / CLEAR / REQUIRE_EDD / REJECT` 全部混成同一类 case action
- case 的多轮处置不再依赖单薄的 `OPEN / ASSIGNED / CLOSED` 三态解释
- onboarding 与 transaction 的 case 分工可以从文档直接读出

### 明确不做

- 不在本 phase 直接落地双人审批或 approval policy
- 不在本 phase 定义所有 transaction 最终 disposition 枚举
- 不要求本 phase 改写现有运行时代码

---

## 17. Phase 12：Report, MLRO Review And Final Disposition Gate

### 目标

把“调查完成”与“最终结论生效”正式分层，并让 `MLRO` 成为 case 最终结论生效前的治理 gate。

### 范围

- `Report Lifecycle`
- `MLRO Review Gate`
- `proposed final disposition`
- `approved final disposition`
- workflow-bound case 与 transaction case 的最终结论收口

### P0 交付物

- report lifecycle 定义
- `INVESTIGATING -> PENDING_MLRO_REVIEW -> CLOSED` 的门禁图
- `proposed final disposition` 与 `approved final disposition` 的边界说明
- `final disposition` 与 `workflow decision` 的分层说明
- onboarding / periodic review 与 transaction 的最终结论示例路径

### 核心规则

- `Report Lifecycle` 独立存在，不等于最终 disposition：
  - `draft`
  - `finalize`
  - `returned / superseded`
- `MLRO Review Gate` 是 case 最终结论生效前的必经环节
- `INVESTIGATING -> PENDING_MLRO_REVIEW` 的前置条件至少包含：
  - finalized report
  - proposed final disposition
  - 必要时带 proposed workflow decision
- `MLRO` 只有两类标准结果：
  - `RETURN_FOR_INVESTIGATION`
  - `APPROVE_FINAL_DISPOSITION`
- 只有 MLRO 批准后，才执行：
  - 最终业务处置
  - 若为 workflow-bound case，再执行 workflow transition
  - 然后 case `CLOSED`
- `REPORT` 不再等同于“写报告”，而是 final disposition 的一种可能结论
- 双场景示例固定为：
  - onboarding / periodic review：`CLEAR / REQUIRE_EDD / REJECT`
  - transaction：`REPORT / MAINTAIN_RESTRICTION / RELEASE_RESTRICTION / CLEAR`
- “EDD review 需要更高治理” 不得被直接解释为 “EDD 自动升级成 case”

### Wave DoD

- 文档里 `report`、`MLRO review`、`final disposition`、`workflow decision` 四层不再混写
- 实现者能明确知道何时只是调查完成，何时才是最终结论生效
- onboarding / periodic review 与 transaction 两种最终结论路径都具备统一治理口径

### 明确不做

- 不在本 phase 直接确定 EDD 后双人审批的具体实现方案
- 不把 approvals 模块的具体 step 设计提前写死到 case 模型中
- 不把 `REPORT` 直接等同为外部正式报送集成

---

## 18. 与现有代码的映射建议

当前代码在 `Wave 2` 中建议按下面方式解释：

- `risk-engine.service.ts`
  - 当前角色：onboarding 特化 risk evaluator
  - 目标角色：通用 risk engine core
- `compliance-alerts/**`
  - 当前角色：alert 分诊基础实现
  - 目标角色：平台统一 triage center
- `compliance-incidents/**`
  - 当前角色：incident 升级容器
  - 目标角色：过渡期 `case` 管理内核
- `transaction-compliance` 下 `KYT / Travel Rule`
  - 当前角色：交易侧 provider response/evidence container
  - 目标角色：只读外部响应容器 + 证据对象
- `onboarding` 下 `cddResponse / eddResponse`
  - 当前角色：onboarding provider response/evidence container
  - 目标角色：不再占用通用 `Case` 语义
- `onboarding decision record`
  - 当前角色：onboarding 执行记录
  - 目标角色：通用 risk decision record 的历史实现
- `decision`
  - 当前角色：过渡期结论字段
  - 目标角色：后续映射到正式 `disposition` 体系
- `ONB_ONBOARDING_JOURNEY_REVIEW`
  - 当前角色：runtime 的 onboarding journey review rule
  - 目标角色：`ONB_CDD_REVIEW_REQUIRED / ONB_EDD_REVIEW_REQUIRED` 的兼容别名
- `resolutionSummary / closureChecklist`
  - 当前角色：case close/summary 的过渡字段
  - 目标角色：后续映射到正式 `Case Report` 体系
- 当前 alert / case 页面与服务实现
  - 当前角色：仍混有 `alert triage`、`workflow decision`、`interim measures`
  - 目标角色：在 `Phase 10-12` 中完成职责拆分，而不是继续往 mixed model 里堆按钮

---

## 19. 本波关键约束

- 不允许再把 `KYT / Travel Rule / CDD / EDD` 容器定义成通用 `Case`
- 不允许在 onboarding 内再长出一套独立 review 容器
- 不允许在业务模块中绕过统一 `Alert / Case / Audit` 主链
- 命名迁移必须先做语义冻结，再做代码迁移
- 不允许把 `decision` 直接等同于完整 `disposition`
- 不允许把 `report` 直接等同于 `case investigation report`
- 不允许让 `alert/case` 直接兼任业务 workflow owner
- 不允许在 `Phase 6-9` 中提前引入 approval 作为主线依赖
- 不允许继续用 `triggerType` 组织 `alert / case`
- 不允许把 `FINAL_APPROVAL` 当作当前 `alert / case` stage
- 不允许在当前 hardening 主线里继续保留 `TX_*` rule 作为 active scope
- 不允许再把 `workflow decision` 混写成 `alert action`
- 不允许继续把 `False Positive / Escalate to Case` 和 `Clear / Require EDD / Reject` 当成同一类按钮
- 不允许 `Case` 在无 finalized report、无 MLRO gate 时直接成为最终处置 owner
- 不允许把 `REPORT` 继续同时表示“报告生命周期动作”和“最终处置结果”
- 不允许把“EDD review 需要更高治理”直接解释为“EDD 自动升级成 case”

---

## 20. 建议的验收顺序

1. `Phase 1-5` 文档与基座建设段完成
2. `Phase 6` disposition model 定型
3. `Phase 7` risk decision -> alert orchestration 定型
4. `Phase 8` case investigation kernel 定型
5. `Phase 9` workflow transition contract 定型
6. `Phase 10` alert outcome 与 workflow decision 分层定型
7. `Phase 11` case state machine 与 interim measures 定型
8. `Phase 12` report / MLRO review / final disposition gate 定型

---

## 21. 后续维护规则

- 当 `Wave 2` 范围发生变化时，优先更新本文件，再更新更细的约束文档。
- 如果某个需求跨多个 phase，必须明确：
  - 本次只完成到哪个 phase
  - 哪些能力有意后置
  - 哪些命名仍处于过渡兼容态
- 如果后续决定把 `Approval Trigger Contract` 纳入主线，应作为新的后续 phase 单独补进本文件，而不是提前塞进 `Phase 6-9`
