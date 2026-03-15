# Wave 2 合规基座分阶段规划（Risk / Alert / Case Foundation）

## 1. 文档目的

本文件用于把总版本规划中的 `Wave 2` 进一步拆成多个可执行 `phase`，作为后续开发、产品、测试、agent 协作时的统一参考。

适用原则：

- 本文是 `Wave 2` 的专项规划文档，不替代 `AGENTS.md` 与 `docs/constraints/**`。
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

| Phase | 名称 | 目标 |
| --- | --- | --- |
| `Phase 1` | 领域契约冻结 | 统一命名、对象边界、状态机与迁移策略 |
| `Phase 2` | Risk Engine Core | 把 risk engine 从 onboarding 特化实现中抽离出来 |
| `Phase 3` | Alert Triage Core | 把 alert 建成统一分诊台 |
| `Phase 4` | Case Management Core | 把当前 incident 演进为真正的 case 管理内核 |
| `Phase 5` | Actions + Evidence + Integrations | 补齐标准动作、证据导出、业务接线 |

建议执行顺序：

1. `Phase 1`
2. `Phase 2`
3. `Phase 3`
4. `Phase 4`
5. `Phase 5`

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

- 统一命名表
- 统一对象职责说明
- `Alert` / `Case` 状态机与动作矩阵
- `Provider Response` 的只读展示定位
- 代码迁移顺序说明：
  - 先领域语义
  - 再 UI/API
  - 后物理存储

### Wave DoD

- 团队后续讨论和文档中，不再混用：
  - `KYT case`
  - `Travel Rule case`
  - `Incident`
  - `Compliance case`
- 所有新增需求都能明确落入四层之一。

### 明确不做

- 数据库迁移
- 大规模重命名
- 页面重构

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
- `Case` 详情页与列表页
- `Case` 和 `Alert` 的关联关系模型
- `Case` 审计写入统一经 `AuditLogsService`
- 兼容策略：
  - 先保留现有 `incident` 物理表
  - UI / API 文案改为 `Case`
  - DTO/service 层逐步收口

### Wave DoD

- 合规调查对象统一叫 `Case`
- `Alert` 只负责分诊，`Case` 负责调查
- 一个 `Case` 可以聚合多个 `Alerts`

### 明确不做

- 一次性物理表重命名
- 跨所有业务域统一切换所有旧字段命名

---

## 10. Phase 5：Actions + Evidence + Integrations

### 目标

补齐真正让合规底座可长期承接业务的最后一层能力。

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

说明：

- 如果届时 customer / onboarding 主体仍未稳定，`onboarding review container integration` 顺延到 `Wave 3`，不阻塞 `Wave 2` 交付。

---

## 11. 与现有代码的映射建议

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
- `onboarding decision record`
  - 当前角色：onboarding 执行记录
  - 目标角色：通用 risk decision record 的历史实现

---

## 12. 本波关键约束

- 不允许再把 `KYT / Travel Rule / CDD / EDD` 容器定义成通用 `Case`
- 不允许在 onboarding 内再长出一套独立 review 容器
- 不允许在业务模块中绕过统一 `Alert / Case / Audit` 主链
- 命名迁移必须先做语义冻结，再做代码迁移

---

## 13. 建议的验收顺序

1. `Phase 1` 文档与命名冻结
2. `Phase 2` risk engine 抽象完成
3. `Phase 3` alert 分诊台定型
4. `Phase 4` case 管理内核定型
5. `Phase 5` 标准动作、证据导出、业务接线

---

## 14. 后续维护规则

- 当 `Wave 2` 范围发生变化时，优先更新本文件，再更新更细的约束文档。
- 如果某个需求跨多个 phase，必须明确：
  - 本次只完成到哪个 phase
  - 哪些能力有意后置
  - 哪些命名仍处于过渡兼容态

