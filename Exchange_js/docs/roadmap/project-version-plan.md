# 项目 9-Wave 版本规划（Agent Working Guide）

## 1. 文档目的与使用方式

本文件用于定义 `Exchange_js` 项目的中长期交付节奏，给后续 agent、开发、产品、测试在做范围判断、优先级排序、波次切分时提供统一参考。

使用规则：

- 本文是版本与交付规划文档，不替代约束文档。
- 任何涉及 `Exchange_js` 的代码变更，仍然必须先读取 `AGENTS.md` 与 `docs/constraints/**`。
- 当用户提出的新需求与当前波次规划不一致时，agent 必须明确指出：
  - 该需求属于哪个 wave
  - 是否依赖尚未交付的前置能力
  - 是否需要拆分成“本波最小实现 + 后续补全”
- workflow 可以跨多个 wave 分阶段交付；判断是否可交付，以“当前 wave 的 DoD 是否满足”为准，而不是以 workflow 名称是否首次出现为准。

## 2. 规划原则

- 先做平台标准件，再做具体业务链路。
- 先做“自动阻断 + 可审计 + 可取证”的控制面，再做业务面。
- 客户主链顺序固定为：`准入 -> 充值 -> 兑换 -> 提现`。
- `Risk Engine / Alerts / Incidents` 是全平台共用能力，必须早于大部分业务 workflow。
- `Posting / Config Center` 是交易与资金闭环的账务底座，必须在客户资金主链前完成。
- 每个 wave 都必须交付“主流程 + 异常回滚流程”，不能只交付 happy path。

## 3. 全局 DoD（所有 wave 必须满足）

- 该波对应 workflow 的 `P0` 子任务 `100%` 完成，`P1/P2` 按该波明确定义的范围完成。
- 该波涉及的每个 workflow 都可以导出证据包，证据包至少包含：
  - 时间
  - 操作者
  - 审批轨迹
  - 关键业务 ID / No
- 关键闸门必须是“自动阻断”，不是只有提示；并且必须写入阻断日志。
- 至少通过 `1` 条端到端 `UAT` 主流程与 `1` 条异常回滚流程。
- `P0` 缺陷为 `0`；`P1` 缺陷必须有明确修复计划和截止日期。

## 4. Workflow 分波映射总览

| Workflow | 交付波次 | 交付说明 |
| --- | --- | --- |
| `WF-01` Audit Events + Evidence Export | `Wave 1` | 一次性完成基础能力，后续各波只扩展覆盖面 |
| `WF-02` RBAC + Auth Boundary | `Wave 1` | 一次性完成基础能力 |
| `WF-03` SoD Block + Maker-Checker | `Wave 1` | 已按 Wave 1 落地通用 approval engine 与 3 类敏感动作复用 |
| `WF-04` Notice Registry + SLA Timers | `Wave 1`、`Wave 9` | `Wave 1` 只保留历史最小 timer/notification kernel；通用 `obligation / SLA / escalation` 治理能力后移到 `Wave 9` |
| `WF-05` Retention + Delete Gate | `Wave 1` | 已按 Wave 1 落地 delete request + soft delete gate 审批闭环 |
| `WF-06` Change Ticket + Release Gate + Link Integrity | `Wave 1`、`Wave 9` | `Wave 1` 完成发布闸门 P0；`Wave 9` 完成 P2 的 link integrity 深化 |
| `WF-07` PayIn→Deposit | `Wave 5` | 完整交付充值链路 |
| `WF-08` Pricing→Quote→Swap | `Wave 6` | 完整交付兑换链路 |
| `WF-09` Withdraw→Payout | `Wave 7` | 完整交付提现链路 |
| `WF-10` Onboarding + Trading Eligibility Gate | `Wave 2`、`Wave 3` | `Wave 2` 完成与 risk engine 的 review container 接轨；`Wave 3` 完成 customer onboarding 主状态机与 customer 管理 |
| `WF-11` Wallet Binding + VA Standards + Key Safeguarding | `Wave 4` | 完成客户/平台钱包与银行账户模型 |
| `WF-12` Risk Engine Cases | `Wave 2`、`Wave 3`、`Wave 5`、`Wave 7` | `Wave 2` 完成标准内核；`Wave 3` 接 onboarding sanctions；`Wave 5/7` 接入交易侧案例 |
| `WF-14` Alerts→Incidents + Incident Mgmt | `Wave 2` | 标准告警/事件内核提前完成 |
| `WF-15` Posting Engine + Base Config Center | `Wave 4` | 完整交付账务底座 |
| `WF-16` Safeguarding Reconciliation + Funding SLA | `Wave 7`、`Wave 8`、`Wave 9` | `Wave 7` 做最小日对账；`Wave 8` 做全量保障对账与财务运营事实；如需统一 overdue/escalation 治理壳，则后移到 `Wave 9` |
| `WF-17` Periodic Risk Review | `Wave 3` | 与 onboarding/customer gate 一起完成正式 customer review 闭环 |
| `WF-18` Monthly Statements | `Wave 9` | 后置扩展 |
| `WF-19` Splitting Items + Fee Engine | `Wave 4`、`Wave 6`、`Wave 8` | `Wave 4` 完成骨架；`Wave 6` 覆盖 swap；`Wave 8` 覆盖 treasury/reconciliation |
| `WF-21` Internal Treasury | `Wave 8` | 在客户主链稳定后做全量内部资金运营 |
| `WF-22` Outsourcing Governance | `Wave 9` | 后置扩展 |
| `WF-23` Complaints + Disputes/Refunds + RCA/CAPA | `Wave 9` | 后置扩展；如监管优先级提高，可前移到 `Wave 8` |
| `WF-24` Regulatory Reporting Calendar + Production Packs + Agreements | `Wave 9` | 后置扩展 |
| `WF-GOV-01` Governance Registries | `Wave 9` | 后移到治理运营波次，统一与证据工厂一起收口 |
| `WF-GOV-02` Filing + Receipt + Effectiveness Gate | `Wave 9` | `Wave 1` 未落地；后移到治理运营波次完成 filing/receipt/effective 全链路 |
| `WF-GOV-03` Security/Privacy Programme Evidence Factory | `Wave 9` | 后置扩展 |
| `WF-GOV-04` Policy & Attestation Lifecycle | `Wave 9` | 后置扩展 |

备注：

- `WF-13` 已并入 `WF-12`，不单独排波。
- `WF-20` 已拆分并并入 `WF-15 / WF-08 / WF-21 / WF-16`，不单独排波。

## 5. 详细版本规划

## 4.0 Wave 1 Completion Note

- `Wave 1` 在当前官方范围下已经达到：
  - implementation-complete
  - documentation-complete
- `Wave 1` 当前官方完成范围固定为：
  - `WF-01`
  - `WF-02`
  - `WF-03`
  - `WF-04`
  - `WF-05`
  - `WF-06`
- `Wave 1` 的长期真相应优先读取：
  - `docs/constraints/**`
  - `docs/specs/workflows/**`
  - `docs/specs/entities/**`
  - `docs/specs/modules/**`
  - `docs/acceptance/wave-1-foundation-final-acceptance.md`
- `Wave 1` 的 durable reference 入口固定为：
  - workflow:
    - `docs/specs/workflows/audit-evidence-export-approval-workflow.md`
    - `docs/specs/workflows/change-ticket-release-gate-workflow.md`
    - `docs/specs/workflows/delete-request-soft-delete-workflow.md`
    - `docs/specs/workflows/governance-sla-timer-workflow.md`
    - `docs/specs/workflows/admin-member-auth-boundary-workflow.md`
  - entity:
    - `docs/specs/entities/audit-evidence-package-entity.md`
    - `docs/specs/entities/change-ticket-entity.md`
    - `docs/specs/entities/delete-request-entity.md`
    - `docs/specs/entities/governance-sla-timer-entity.md`
    - `docs/specs/entities/admin-user-entity.md`
    - `docs/specs/entities/approval-case-entity.md`
  - module:
    - `docs/specs/modules/governance-control-foundation-module.md`
    - `docs/specs/modules/rbac-member-management-module.md`
    - `docs/specs/modules/approvals-module.md`
    - `docs/specs/modules/audit-logging-module.md`
- 以下 cleanup 文档继续保留，但只作为 Wave 1 收口历史：
  - `docs/cleanup/wave-1-governance-audit-cleanup-master-plan.md`
- `Wave 1` 的最终 acceptance 结论入口固定为：
  - `docs/acceptance/wave-1-foundation-final-acceptance.md`
- `WF-GOV-02` filing / receipt / effectiveness gate 不属于当前 `Wave 1` 完成范围。
- `WF-04` 在 `Wave 1` 的完成范围应理解为历史最小 timer/notifier 资产，而不是未来通用 `obligation / SLA / escalation` 平台；后者统一后移到 `Wave 9`。

## 4.1 Wave 2 / Wave 3 Completion Note

- `Wave 2` 与 `Wave 3` 的主体能力和最终收口已完成。
- 当前长期真相应优先读取：
  - `docs/constraints/**`
  - `docs/specs/workflows/**`
  - `docs/specs/entities/**`
  - `docs/specs/modules/**`
  - `docs/acceptance/wave-2-wave-3-final-acceptance-checklist.md`
- `Wave 2` / `Wave 3` 的 durable reference 入口固定为：
  - workflow:
    - `docs/specs/workflows/onboarding-canonical-workflow.md`
    - `docs/specs/workflows/periodic-review-canonical-workflow.md`
    - `docs/specs/workflows/alert-triage-and-case-escalation.md`
    - `docs/specs/workflows/mlro-and-final-approval-governance.md`
    - `docs/specs/workflows/case-final-lifecycle-and-external-filing.md`
    - `docs/specs/workflows/onboarding-periodic-review-audit-trace-contract.md`
  - entity:
    - `docs/specs/entities/compliance-alert-entity.md`
    - `docs/specs/entities/compliance-case-entity.md`
    - `docs/specs/entities/compliance-case-report-entity.md`
    - `docs/specs/entities/compliance-external-filing-entity.md`
    - `docs/specs/entities/customer-entity.md`
    - `docs/specs/entities/review-response-entity.md`
    - `docs/specs/entities/periodic-review-cycle-entity.md`
    - `docs/specs/entities/approval-case-entity.md`
    - `docs/specs/entities/risk-decision-record-entity.md`
  - module:
    - `docs/specs/modules/compliance-center-module.md`
    - `docs/specs/modules/risk-engine-module.md`
    - `docs/specs/modules/customer-onboarding-module.md`
    - `docs/specs/modules/periodic-review-module.md`
    - `docs/specs/modules/approvals-module.md`
    - `docs/specs/modules/audit-logging-module.md`
- 以下 cleanup 文档继续保留，但只作为历史完成记录：
  - `docs/cleanup/wave-2-wave-3-final-closure-plan.md`
  - `docs/cleanup/wave-2-cleanup-master-plan.md`
  - `docs/cleanup/wave-3-cleanup-master-plan.md`

### Wave 1：控制底座（Control Foundation）

**目标**

建立所有后续业务都会复用的控制面底座：权限边界、审计取证、maker-checker、软删除、发布闸门，以及历史已落地的最小时限内核。

**本波 workflow**

- `WF-01` 全量
- `WF-02` 全量
- `WF-03` Approval Engine + maker-checker
- `WF-04` 历史最小 timer/notifier kernel
- `WF-05` Delete Request + soft delete gate
- `WF-06` Change Ticket + Release Gate

**为什么放在这里**

- 后续每个业务波次都要依赖统一审计、统一审批、统一闸门，以及最小可复用的时限事实。
- 不先做底座，后面 onboarding、deposit、swap、withdraw 都会各做一套临时逻辑，返工成本极高。

**P0 交付物**

- 统一审计事件标准、统一查询接口、统一证据包导出、`export_hash` 生成。
- `RBAC + Auth Boundary` 生效，客户端/管理端边界明确，未授权请求默认拒绝并留痕。
- maker-checker 引擎落地，并已至少复用于：
  - 敏感导出
  - 软删除
  - 发布动作
- soft delete 能力落地：
  - `deletedAt / deletedBy / deleteRequestId / deleteReason`
  - `Delete Request`
  - 审批流闭环与快照保留
- Release gate 生效：
  - 缺变更单禁止上线
  - 缺测试证据禁止上线
  - 缺回滚方案禁止上线
- 历史最小时限能力落地：
  - `APPROVAL_TIMEOUT`
  - `CHANGE_POST_APPROVAL_FOLLOWUP`
  - notification registry
  - `Close / Recalc / demo mock`
  - 但不把它继续定义为通用 `obligation / breach / escalation` 平台

**Wave DoD**

- `WF-01 / WF-02 / WF-03 / WF-04 / WF-05 / WF-06` 达到当前项目定义的 Wave 1 交付基线。

**代表性 UAT**

- 主流程：
  - 管理员发起敏感导出
  - 进入 maker-checker 审批
  - 审批通过后生成证据包
  - 审计日志中可查询导出动作、审批轨迹、`export_hash`
- 异常回滚流程：
  - 发布动作缺变更单或回滚方案
  - 系统自动阻断
  - 阻断原因和操作者写入日志
  - 功能开关保持未生效

**明确不做**

- 完整 filing 管理台账
- 完整投诉/监管通知业务面
- link integrity 的 P2 巡检深化
- hard delete

### Wave 2：合规中台核（Risk / Alert / Incident Core）

**目标**

把 `risk engine + alerts + incidents` 这套标准中台提前做出来，并让 onboarding 从第一天起就使用统一的 review container，而不是单独做一套临时审批流。

**本波 workflow**

- `WF-12` Phase A（platform core）
- `WF-14` 全量
- `WF-10` Phase A（review container integration）

**为什么放在这里**

- 只要是业务，就会碰到风险决策、告警升级、冻结/解冻、事件升级与证据导出。
- onboarding 是最早会接入 risk engine 的业务域，应该从这里开始统一。
- `Wave 2` 的后半段需要继续完成 `Phase 10-13`：
  - 先拆清 `alert action / workflow decision / case measures / MLRO gate`
  - 再把 `report`、`final disposition` 与未来 `external filing` 彻底分层
- `Wave 2` 当前剩余 compatibility / audit / filing / runtime debt 不再散落在 thread notes 中，统一以后续 cleanup master 管理：
  - `docs/cleanup/wave-2-cleanup-master-plan.md`

**P0 交付物**

- `Risk Engine` 标准输入/输出契约落地：
  - decision record
  - input snapshot
  - output snapshot
  - replay/hash
- 标准 case kernel 落地，至少覆盖：
  - `KYT`
  - `TRAVEL_RULE`
  - `STR`
  - `SANCTIONS`
- `Alerts -> Incidents` 标准生命周期落地：
  - status machine
  - assignee rule
  - escalation
  - case-local overdue facts
  - 不在本波抽象通用 `obligation / SLA / breach` 引擎
- 标准动作目录落地：
  - 冻结
  - 解冻
  - 上报
  - 结案
- case 后期治理模型定型：
  - case report
  - MLRO review gate
  - final disposition
  - external filing 预留语义
- 统一证据包导出支持按：
  - case type
  - status
  - owner
  - period
- onboarding review path 接入：
  - risk engine 输出 recommendation
  - review 结果通过 alert/incident 容器处理
  - 非法状态迁移由后端阻断

**Wave DoD**

- risk engine、alert、incident 不再是 demo 模块，而是平台标准件。
- onboarding review container 不再自带一套独立状态机，而是复用这套中台能力。
- `REPORT` 与未来 `STR / SAR / VARA / FIU filing` 的边界已在文档层分清，外部报送被定义为独立后续维度。

**代表性 UAT**

- 主流程：
  - onboarding CDD mock 触发中风险
  - risk engine 生成 decision record
  - 系统创建 onboarding journey alert
  - 合规员分配、处置、结案
  - 全链路证据可导出
- 异常回滚流程：
  - 已关闭 alert 再次命中同 dedupe key
  - 系统自动新开 alert 而非覆盖旧记录
  - 审计链不中断

**明确不做**

- deposit/withdraw 侧的交易类 case 全量接入
- 全量 onboarding/KYB 状态机
- 客户钱包/银行账户模型

### Wave 3：客户入驻与客户管理（Customer Onboarding + Customer Management）

**目标**

完成 customer onboarding 主状态机、customer 档案/状态/限制、trading eligibility gate、periodic review 与 onboarding sanctions integration，并把 onboarding 与 Compliance Center 的联动做成正式可验收闭环。

**本波 workflow**

- `WF-10` Phase B
- `WF-12` Phase B（onboarding sanctions integration）
- `WF-17` 全量

**为什么放在这里**

- customer 是否准入、是否可交易、是否需要限制、是否进入周期复审，必须先于所有资金业务主链稳定下来。
- `Wave 2` 已经把 Compliance Center 和 onboarding review container 打通；这一波负责把 customer 主状态机和 customer 管理补成正式业务闭环。

**P0 交付物**

- onboarding 完整状态机落地：
  - `CDD`
  - `EDD`
  - `FINAL_APPROVAL`
  - trading eligibility gate
- customer 管理最小闭环落地：
  - customer 档案查询
  - customer 状态/限制快照
  - customer eligibility 管理
- 冻结门禁生效：被冻结主体不可交易、不可出金。
- 周期复审到期自动限制，复审通过后解除。
- sanctions screening 接入 onboarding：
  - 命中自动建案
  - 自动触发冻结动作
- Compliance Center 正式验收剧本可执行：
  - onboarding review alert/case
  - case report
  - freeze/report 对 workflow 的非推进行为
  - final review 进入 customer 主状态机

**Wave DoD**

- `WF-10/17` 达到“未通过不可交易、被冻结不可交易/不可出金、周期复审闭环可运行”的标准。
- `WF-12 Phase B` 达到“onboarding sanctions integration 可自动建案并正确联动限制”的标准。

**代表性 UAT**

- 主流程：
  - 新客户完成 CDD/EDD
  - 通过 Compliance Center 完成 review 与 final approval
  - 客户获得准入
  - customer eligibility gate 生效
  - periodic review 到期后自动限制，复审通过后恢复
- 异常回滚流程：
  - 客户命中 sanctions
  - 自动建案并冻结
  - 尝试交易时被自动阻断
  - 阻断日志、case 证据和 onboarding transition 可导出

**明确不做**

- 钱包/银行账户模型
- posting/config center
- clearing / fee 骨架
- payin/deposit 实际入账链路
- quote/swap 生命周期
- payout/withdraw 链路

### Wave 4：账务内核与资产结构（Ledger + Asset Structure）

**目标**

完成账务底座、配置中心、钱包/账户模型和 clearing / fee skeleton，为充值链路、兑换链路和后续资产运营准备可复用底座。

详细 phase 规划见：

- `docs/roadmap/wave-4-ledger-asset-structure-phase-plan.md`

**本波 workflow**

- `WF-15` 全量
- `WF-19` Phase A
- `WF-11` 全量

**为什么放在这里**

- 新 `Wave 3` 已经把 customer 准入、限制与周期复审稳定下来；这一波补齐账务与资产结构，为下一波充值链路提供前置底座。
- 钱包/银行账户模型和 posting/config center 不再作为 onboarding 的一部分，而是作为资金业务底层能力独立交付。

**P0 交付物**

- `Wave 4` 的细化交付由专项 phase plan 管理。
- 本波总览级交付目标固定为：
  - `Assets / Wallet / account model` 定型
  - `COA / AcctEvents / Templates / PricingPolicy` 发布治理模型定型
  - `AcctEvent -> clearing + journal -> wallet balance` 驱动链定型
  - `quote snapshot + fee skeleton` 成为后续业务波次的共享合同

**Wave DoD**

- `WF-15/19` 达到“账务内核可被业务复用”的标准。
- `WF-11` 达到“客户/平台资产结构可支撑下一波充值与兑换链路”的标准。

**代表性 UAT**

- 主流程：
  - `COA release` 历史回看
  - `internal transaction success -> clearing + journal`
  - `swap/withdraw quote -> transaction -> event`
- 异常回滚流程：
  - 模板配置错误或借贷不平
  - 系统自动阻断过账
  - 不污染余额、不生成脏账务数据

**明确不做**

- payin/deposit 实际入账链路
- quote/swap 生命周期
- payout/withdraw 链路
- `PricingPolicy` admin 详情页与版本快照 UI —— SWAP Policy 拆入 Wave 6，WITHDRAWAL Policy 拆入 Wave 7；Wave 4 仅交付后端发布治理模型与 list + history 页面

### Wave 5：充值链路（PayIn -> Deposit）

- 详细专项规划见：`docs/roadmap/wave-5-payin-deposit-phase-plan.md`
- cleanup / closeout closure record 见：`docs/cleanup/wave-5-cleanup-master-plan.md`

**当前状态**

- `Wave 5` 的 runtime 主链已按 `Phase 0-4` 实现闭环。
- `Wave 5` 现在已经拥有 durable references across constraints / specs / acceptance。
- `Wave 5` cleanup / closeout 已完成；`4` 个 closeout delivery units 全部完成：
  - `Runtime Core`
  - `Simulation Surface`
  - `Alert / Transaction Case Integration`
  - `Docs / Index / Cleanup Meta`

**当前 durable references**

- constraints:
  - `docs/constraints/customer-transaction-flow-constraints.md`
  - `docs/constraints/internal-transaction-flow-constraints.md`
- workflow:
  - `docs/specs/workflows/payin-deposit-canonical-workflow.md`
- entity:
  - `docs/specs/entities/inbound-transfer-signal-entity.md`
  - `docs/specs/entities/payin-entity.md`
  - `docs/specs/entities/deposit-transaction-entity.md`
  - `docs/specs/entities/risk-decision-record-entity.md`
  - `docs/specs/entities/audit-evidence-package-entity.md`
- module:
  - `docs/specs/modules/risk-engine-module.md`
  - `docs/specs/modules/compliance-center-module.md`
  - `docs/specs/modules/accounting-ledger-module.md`
- acceptance:
  - `docs/acceptance/wave-5-payin-deposit-final-acceptance-checklist.md`
  - `docs/acceptance/wave-5-deposit-accounting-blocked-runbook.md`
  - `docs/acceptance/wave-5-deposit-evidence-export-runbook.md`
- cleanup:
  - `docs/cleanup/wave-5-cleanup-master-plan.md` only as closeout closure record
  - 其中已记录 `4` 组 closeout delivery units、验证顺序与完成结论

**目标**

完成客户“资金进入系统”的第一条真实业务主链，包括 payin ingestion、deposit 状态机、充值合规接入与最小连接器。

**本波 workflow**

- `WF-07` 全量
- `WF-12` Phase C1（deposit-side KYT / Travel Rule integration）

**为什么放在这里**

- 充值是客户主链中最先发生、风险最可控的一段，适合在新 `Wave 3-4` 完成后率先交付。

**P0 交付物**

- payin ingestion 幂等落地，重复上报不重复入账。
- `PayIn -> Deposit` 状态机完整，且支持重试不重入。
- provider connector v1 落地，至少支持最小手工/回执登记。
- deposit 业务事件到分录映射可追溯。
- deposit 侧交易合规接入：
  - payin confirmed 时创建/更新 `KYT`
  - payin confirmed 时创建/更新 `TRAVEL_RULE`
- 关键阻断点自动生效：
  - 未通过准入不可触发充值业务入账
  - 冻结账户不可继续推进到成功入账

**Wave DoD**

- `WF-07` 满足“payin ingestion 幂等，deposit 状态机可重试且不重入”。
- 充值侧证据包可以串起：`payinId -> depositId -> caseId -> journalId`。

**代表性 UAT**

- 主流程：
  - 客户入金
  - 系统识别 payin
  - 生成 deposit
  - 触发 KYT / Travel Rule evidence
  - 成功入账并可查询完整证据链
- 异常回滚流程：
  - 同一 payin 重复推送
  - 系统只保留一个有效业务推进结果
  - 不产生重复分录、不产生重复 case

**明确不做**

- quote/swap
- withdraw/payout
- 日对账全量 break 管理

### Wave 6：兑换链路（Pricing -> Quote -> Swap）

**目标**

完成 quote 生命周期、swap 成交流程、best execution 证据与产品限制闸门，建立客户第二条业务主链。

**本波 workflow**

- `WF-08` 全量
- `WF-19` Phase B（swap coverage）

**为什么放在这里**

- 兑换依赖：
  - onboarding/trading gate
  - 钱包/余额
  - posting/config center
  - 充值完成后的客户资产基础

**P0 交付物**

- quote 生命周期完整：
  - `TTL`
  - 单次使用
  - 快照不可篡改
- swap 可从 quote 创建并完成落账。
- best execution 证据包可导出，至少包含：
  - 报价来源
  - 时间戳
  - 关键参数
  - quote snapshot
- 产品限制闸门生效：
  - 禁用品类
  - 禁用条件
  - 自动阻断与阻断日志
- swap 失败场景可回滚且不留下账务悬挂。
- fee items 在 swap 中闭环落地。
- **SWAP Policy admin UI 交付**：
  - `PricingPolicyDetail`（SWAP）— 详情页，展示 pair grid（货币对费率矩阵），包含 spread、markup、限额等配置
  - `PricingPolicySnapshot`（SWAP）— 版本快照，展示历史版本内容，与 COA/AcctEvent/JournalTemplate/ClearingTemplate 快照模式对齐

**Wave DoD**

- `WF-08` 满足”quote 可追踪、swap 可落账、失败可回滚、证据可导出”。

**代表性 UAT**

- 主流程：
  - 客户请求 quote
  - quote 在有效期内被单次消费
  - 创建 swap
  - 生成分录
  - 导出 best execution 证据
- 异常回滚流程：
  - 客户使用过期或已使用 quote
  - 系统自动阻断
  - 不生成 swap、不生成分录、不污染余额

**明确不做**

- withdraw/payout
- 日对账 full break lifecycle
- complaints/disputes

### Wave 7：提现闭环 + 交易合规全量接入（Withdraw / Payout / Tx Compliance）

**目标**

完成客户“资金离开系统”的主链，同时把交易级 risk cases 真正接入到 deposit/withdraw 业务路径里，并上线最小日对账。

**本波 workflow**

- `WF-09` 全量
- `WF-12` Phase C2（transaction rollout）
- `WF-16` Phase A（minimum daily reconciliation）

**为什么放在这里**

- 提现是风险最高的客户主链，必须建立在：
  - risk engine 标准内核
  - alert/incident
  - posting / reversal
  - onboarding / freeze gate
  - payout receipt traceability
  之上。

**P0 交付物**

- `Withdraw -> Payout` 闭环完成，支持链上/银行回执追溯。
- withdraw 关键状态机、payout 状态机、失败/退回补偿完整。
- `PRE-KYT / KYT / Travel Rule / STR` 接入交易侧业务路径。
- case 处置动作能驱动：
  - 冻结
  - 解冻
  - 上报
  - 结案
- 极端波动策略可一键限制相关提现能力并留痕。
- 最小日对账上线：
  - 每日产出差异清单
  - 差异自动建 Alert，必要时人工升 Case
  - 可追踪处理状态
- withdraw / payout 失败或 returned 时，自动冲正或补偿，不得留下账务悬挂。
- **WITHDRAWAL Policy admin UI 交付**：
  - `PricingPolicyDetail`（WITHDRAWAL）— 详情页，展示 asset tier ladder（资产提现费用分层阶梯），包含区间范围、费率/固定费、限额等配置
  - `PricingPolicySnapshot`（WITHDRAWAL）— 版本快照，展示历史版本内容，与其他 config subject 快照模式对齐

**Wave DoD**

- `WF-09/12/16(最小)` 达到”提现可控、交易合规全链路留痕、日对账最小闭环可运行”的标准。

**代表性 UAT**

- 主流程：
  - 客户提交提现
  - 经过合规门禁
  - 生成 payout
  - 获取回执
  - 成功出账并能导出完整监管包
- 异常回滚流程：
  - payout 失败或 returned
  - 系统自动冲正/补偿
  - 不出现重复冲正
  - 差异与处理轨迹可导出

**当前阶段文档**

- `docs/roadmap/wave-7-withdraw-payout-phase-plan.md`
- `docs/specs/workflows/withdraw-payout-canonical-workflow.md`
- `docs/acceptance/wave-7-withdraw-payout-final-acceptance-checklist.md`

**明确不做**

- full safeguarding threshold/threshold escalation
- internal treasury 全量运营工具
- governance registries

### Wave 8：财务运营主线（Finance Ops）

**目标**

补齐资金保障全量闭环、内部资金流、treasury/reconciliation 成本覆盖与运营视图，把系统从“能跑业务”升级到“能长期做财务运营”；本波只做财务运营主线，不在这里产品化通用治理式 `SLA / obligation / escalation`。

**本波 workflow**

- `WF-16` Phase B（full safeguarding reconciliation）
- `WF-19` Phase C（funding/reconciliation coverage）
- `WF-21` 全量

**为什么放在这里**

- 客户资金主链在 `Wave 5-7` 完成后，这一波负责把保障、资金运营、费用补回与 operator tooling 真正收口成可持续的财务运营体系。
- `Client Money` 日对账、safeguarding batch、break register 这些业务本体都属于 `Wave 8`；只有通用超时治理壳才后移到 `Wave 9`。

**P0 交付物**

- 客户资产保障对账全量上线：
  - daily batch
  - threshold
  - break register
  - break owner / closure tracking
- 内部资金流全量上线：
  - internal tx/fund/collection
  - `dryRun`
  - `onlyMissing`
  - 安全重放
- fee items 扩展到 treasury/reconciliation 场景。
- 管理视图能实时看到：
  - safeguarding 状态
  - 未补回项
  - 未闭环项
  - 但 overdue/breach/escalation 仍只保留业务事实，不在本波抽象成统一治理对象

**Wave DoD**

- `WF-16 全量 / WF-19 Wave 8 scope / WF-21 全量` 达到“可持续财务运营”的标准。

**代表性 UAT**

- 主流程：
  - 日对账发现差异
  - 自动建 break
  - 运营发起内部调拨
  - 闭环后差异解除
  - 证据包包含对账、审批、执行、结案链路
- 异常回滚流程：
  - 归集/内部资金重放命中 `dryRun` / `onlyMissing` / idempotent 保护
  - 系统不重复建单
  - 返回明确执行结果并保留责任链

**明确不做**

- 月结账单
- 通用 `obligation / breach / escalation` engine
- governance registries
- filing / receipt / effectiveness gate
- 外包治理
- complaints/disputes
- security/privacy evidence factory

### Wave 9：治理运营与证据工厂（Governance Ops + Evidence Factory）

**目标**

补齐不属于资金主链必需、但治理运营成熟度与监管留痕需要的后置能力，把通用 `obligation / SLA / breach / escalation`、governance registries、filing/receipt/effectiveness、报送材料与证据工厂统一收口。

**本波 workflow**

- `WF-18` 全量
- `WF-04` Phase B（generic obligation / breach / escalation）
- `WF-22` 全量
- `WF-23` 全量
- `WF-24` 全量
- `WF-GOV-01` 全量
- `WF-GOV-02` 全量
- `WF-GOV-03` 全量
- `WF-GOV-04` 全量
- `WF-06` Phase B（P2 link integrity and publish hardening）

**为什么放在这里**

- 这些能力重要，但不应阻塞前面八个 waves 的交易主链、账务主链、财务运营主链；它们更适合作为治理运营化与证据工厂波次统一收口。
- 这里统一承接“时限义务”而不是重写前面 waves 的主流程：前面 waves 只保留业务事实和控制结果，`Wave 9` 再统一接住 case-bound obligation、overdue、breach、escalation 与 evidence。

**P0 交付物**

- 月结账单：
  - `T+25` 内自动生成
  - 分发
  - 回执归档
- 通用治理时限引擎：
  - case-bound obligation
  - deadline / recurring / prior-notice / ongoing-follow-up 四类规则
  - overdue / breach 记录
  - escalation policy
  - completion evidence
- 治理运营：
  - governance registries
  - filing / receipt / effectiveness gate
  - governance summary / operator views
- 外包治理：
  - materiality 判定
  - 合同条款闸门
  - 跨境控制
- 监管日历 + 材料工厂：
  - 周期生成
  - 提交包生成
  - receipt 归档
- complaints / disputes / refunds：
  - `4w/8w SLA`
  - RCA / CAPA
  - 标准证据导出
- 监管与治理时限场景：
  - AML 补件 `48h`
  - cyber / BCDR `72h`
  - 立即通知类义务
  - outsourcing prior notice
- security / privacy programme evidence：
  - 审计模板导出
  - 周期复核记录
- policy attestation：
  - 版本化
  - `21` 天再提交计时器
- link integrity P2：
  - 巡检
  - 发布阻断

**Wave DoD**

- `WF-04` Phase B、`WF-18/22/23/24/GOV-01/GOV-02/GOV-03/GOV-04 + WF-06(P2)` 达到“治理运营与监管证据工厂”的标准。

**代表性 UAT**

- 主流程：
  - AML 补件 case 自动生成 `48h` obligation
  - 到期前完成提交并归档 evidence
  - 治理台账完成更新
  - filing 提交并取得 receipt
  - effect gate 满足后允许正式生效
  - 周期性监管材料自动生成
  - 审核后提交
  - 回执归档
  - 证据包按模板导出
- 异常回滚流程：
  - obligation 超时进入 breach
  - escalation policy 自动升级责任链
  - 公示链接失效或外包合同缺关键条款
  - 发布/生效动作被自动阻断
  - 阻断原因、责任人、整改动作留痕

**明确不做**

- 新的客户交易主链
- 对前面 wave 已完成 contract 的破坏性重写

## 6. 关键依赖关系（给 Agent 的快速判断）

- 如果需求涉及 `risk decision / case / alert / incident / freeze / unfreeze`，优先看 `Wave 2`。
- 如果需求涉及 `customer onboarding / customer status / customer restriction / onboarding final approval / eligibility gate / periodic review`，优先看 `Wave 3`。
- 如果需求涉及 `wallet-account model / ledger / posting / base config / fee skeleton`，优先看 `Wave 4`。
- 如果需求涉及 `payin / deposit`，优先看 `Wave 5`。
- 如果需求涉及 `quote / swap / best execution / product restriction`，优先看 `Wave 6`。
- 如果需求涉及 `withdraw / payout / pre-kyt / tx kyt / travel rule / reversal / minimum reconciliation`，优先看 `Wave 7`。
- 如果需求涉及 `internal treasury / safeguarding full reconciliation / client money daily reconciliation / treasury fee & reimbursement / finance ops dashboard`，优先看 `Wave 8`。
- 如果需求涉及 `obligation / overdue / breach / escalation / regulatory response timer / complaints SLA / monthly statements / outsourcing / governance registry / filing receipt effectiveness / policy attestation / security privacy evidence`，优先看 `Wave 9`。

## 7. Agent 执行注意事项

- 不要把后置扩展 workflow 倒灌进前面的 wave，除非用户明确要求重排优先级。
- 当需求横跨多个 wave 时，优先建议“当前 wave 最小闭环实现”，并在说明中明确：
  - 本次完成什么
  - 哪些能力必须后置到下一波
  - 哪些 contract 现在就要预留
- 当需求涉及 gate、approval、evidence package 时，优先复用已有平台引擎，而不是在业务模块里单独实现。
- 当需求涉及 `timer / overdue / breach / escalation` 时，先判断它是不是业务主流程事实；如果不是，默认按 `Wave 9` 的治理旁支处理，而不是塞回业务状态机。
- 当需求与本文件冲突但与 `docs/constraints/**` 一致时，以约束文档为准；本文件应作为交付顺序参考，而不是行为 contract。
