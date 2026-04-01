Status: active
Owner: project-owner-and-agents
Last Updated: 2026-04-01
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/README.md`
Source of Truth Level: requirement-reference

# Workflow Requirement Snapshot

## Purpose
- This document is a Markdown snapshot converted from `Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx` sheet `Workflows`.
- It preserves imported requirement / control-matrix input for project planning and review.
- It does not override `docs/constraints/**`, `docs/specs/**`, or active runtime truth.

## Source
- Workbook: `/Users/songshengwei/Downloads/原始表格/Workflow_Task_Mapping_MVP_CN_v2_clean.xlsx`
- Sheet: `Workflows`
- Data Rows: `26`
- Columns: `5`

## Columns
- `Workflow_ID`
- `Workflow_Name`
- `MVP_Status`
- `Scope`
- `CN_Scenario`

## Data

| Workflow_ID | Workflow_Name | MVP_Status | Scope | CN_Scenario |
| --- | --- | --- | --- | --- |
| WF-01 | Audit Events + Evidence Export | Must | Unified audit logs/events + evidence exports (CSV/JSON+hash) | 审计与取证：所有关键动作写入审计事件/日志，并支持按条件导出证据包（含hash），用于监管抽查与内部审计。 |
| WF-02 | RBAC + Auth Boundary | Must | RBAC, access logs, customer/admin boundary (break-glass deferred in v1) | 权限与身份边界：区分客户端/管理端；RBAC 授权回收留痕；后台敏感接口做权限校验并可审计（应急权限 break-glass v1 暂不做）。 |
| WF-03 | SoD Block + Maker-Checker | Must | SoD conflicts + maker-checker for sensitive actions | 职责隔离与双人复核：配置 SoD 冲突对；敏感操作必须 maker-checker；冲突授权被系统阻断并留痕。 |
| WF-04 | Notice Registry + SLA Timers | Must | Notice registry + timer engine for 4h/24h/48h/72h/T+N | 监管通知与时限：把 4h/24h/48h/72h 等通知义务做成登记台账+计时器+逾期升级，生成通知材料包与回执引用。 |
| WF-05 | Retention + Delete Gate | Must | Retention policy + delete approval gate + logs | 记录保留与删除闸门：按记录类型配置保留期；删除/清理必须审批并留痕，防止不可逆误删导致审计风险。 |
| WF-06 | Change Ticket + Release Gate (TGRAF) + Link Integrity | Must | Change control workflow + CI gate + link integrity checks | 变更管理与发布闸门：生产变更必须有变更单、测试证据、回滚方案；TGRAF 不完整禁止发布；链接完整性巡检阻断对外披露错误。 |
| WF-07 | PayIn→Deposit (Business) + Provider Connectors v1 | Must | Payin ingestion + deposit workflow + provider connectors v1 | 充值链路：银行/链上入金识别（payin）→充值入账（deposit）状态机推进→合规检查→记账/余额可用；含最小手工/回执登记的连接器。 |
| WF-08 | Pricing→Quote→Swap + Best Execution + Product Restrictions | Must | Pricing config + quote lifecycle + swap workflow + best execution evidence | 兑换链路：定价配置→生成 firm quote（TTL/单次使用/快照）→创建 swap 成交→记账；同时记录 best execution 证据与产品限制/禁用规则。 |
| WF-09 | Withdraw→Payout + Volatility Policy | Must | Withdraw workflow + payout orchestration + reversal policy | 提现链路：客户提交 withdraw→合规门禁→生成/推进 payout（回执tx/bank ref）→成功记账；失败/退回触发冲正/回滚策略；含极端波动下的暂停/限制规则。 |
| WF-10 | Onboarding (CDD/EDD/KYB) + Trading Eligibility Gate | Must | Customer onboarding cases + eligibility gate | 入驻与交易资格：客户入驻流程（CDD/EDD/KYB）+投资者分类；产出合规快照与交易资格状态，未达标阻断交易/提现。 |
| WF-11 | Wallet Binding + VA Standards + Key Safeguarding | Must | Wallet/address binding + VA standards per assetcode + key safeguards | 钱包与资产标准：客户充值/主/出金钱包与银行账户绑定、冻结；按 assetcode（资产+网络）管理 VA 标准卡与钥匙/权限变更留痕。 |
| WF-12 | Risk Engine Cases (KYT/TR/STR/Sanctions subtype) | Must | Unified risk engine cases + callbacks + derived status + restrictions | 风控引擎案件：统一承载 KYT/Travel Rule/STR/（含Sanctions子类型）的 case→回调→派生状态→下发限制（冻结/禁止提现/hold）并留痕导出。 |
| WF-14 | Alerts→Incidents + Incident Mgmt | Must | Alerts lifecycle + incidents + linkage + reporting | 告警与事件：alerts SLA、分派、调查、关闭；必要时升级为 incident 并关联多条告警；支持重大事件/业务中断等通知与证据包。 |
| WF-15 | Posting Engine + Base Config Center (Assets/COA/Events/Templates) | Must | AcctEvent→Templates→Journals posting; base configs managed and gated | 记账与基础配置中心：管理 Assets/COA/AcctEvents/模板；业务状态触发 acctEvent→按模板生成分录→余额投影；缺模板/配置时 fail-fast 并留痕。 |
| WF-16 | Safeguarding Reconciliation (Client Money/VA) + Funding SLA | Must | Reconciliation batches + breaks + segregation & funding SLA evidence | 客户资产保障对账：客户资金/虚拟资产的日对账与差异登记（break）；资金隔离与入账SLA证据；输出可审计报表。 |
| WF-17 | Periodic Risk Review (90d/1y) | Must | Periodic reviews + restrictions + evidence exports | 定期风险复审：按高风险90天/其他1年触发复审任务；到期限制交易；复审完成后解除限制并留痕导出。 |
| WF-18 | Monthly Statements (T+25) | Deferred | Client statements generation + delivery logs | 客户月结账单：按月生成账单（T+25等时限）、投递通知、下载留痕与可复核的hash证据（可后置）。 |
| WF-19 | Splitting Items + Fee Engine | Must | Splitting items; fee config + application | 拆分条目与费用：把订单/资金动作拆成 splitting items（本金/手续费/通道费/价差等）并用于记账与对账；费用规则可配置并可审计。 |
| WF-21 | Internal Treasury (Internal Tx/Fund/Collection) | Must | Internal funds/collection/rebalancing controls | 内部资金操作：内部归集/调拨/内部交易单与资金单；支持 dryRun/onlyMissing；用于维持平台流动性与资金池健康。 |
| WF-22 | Outsourcing Governance (Register/Clauses/Cross-border) | Deferred | Vendor register + DD gate + clauses + cross-border | 外包治理（后置）：第三方登记台账、尽调门禁、合同关键条款检查、跨境外包材料与回执；MVP 可延后但需保留登记口径。 |
| WF-23 | Complaints + Disputes/Refunds + RCA/CAPA | Must | Complaints intake + SLA; disputes/refunds and RCA/CAPA as needed | 投诉与争议：投诉受理、SLA、调查与回复；必要时退款/冲正；RCA 分析与 CAPA 闭环（可分阶段）。 |
| WF-24 | Regulatory Reporting Calendar + Production Packs + Agreements | Deferred | Reporting scheduler + production packs + agreement lifecycle | 监管日历与材料工厂（后置）：周期报送日历、材料打包、回执归档、协议生命周期（版本/通知/接受）一体化。 |
| WF-GOV-01 | Governance Registries (ownership/roles/board/conflicts/training/wind-down) | Must | Governance registries + training logs + wind-down packs registry | 治理台账：股权/组织架构、关键岗位任命、董事会决议、利益冲突、培训记录、wind-down 计划等以“登记+文件引用”最小线上化。 |
| WF-GOV-02 | Regulatory Filing + Receipt + Effectiveness Gate + Public Disclosures | Must | Filing/receipt workflow + effectiveness gates + disclosure registry | 监管报送与生效门禁：公司变更/披露等需向 VARA 报送的事项形成 filing→提交→回执→生效；回执前禁止配置/披露生效（effectiveness gate）。 |
| WF-GOV-03 | Security/Privacy Programme Evidence Factory (Cyber/DLP/TLPT) | Deferred | Cybersecurity programme + DLP + TLPT + privacy evidence packs | 安全与隐私项目群（后置）：网络安全政策、渗透/TLPT、DLP 告警、隐私计划等的证据包登记、导出与周期复核。 |
| WF-GOV-04 | Policy & Attestation Lifecycle (incl resubmission timers) | Deferred | Policy library + attestation + resubmission timers (e.g., 21 days) | 政策与第三方证明（后置）：政策库版本化、第三方 attestation 绑定、变更后21天再提交等定时任务与证据留痕。 |
