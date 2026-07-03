# Product Roadmap

Last Updated: 2026-07-03

**三层分类**（按需求来源）：
- **MVP** — 领导定义的基础必须（非常基础，未必行业惯例，但领导要）
- **ADVANCED** — VARA gap 补齐（rulebook 理论要有）+ 低频逆向操作（上线 MVP、下线 ADVANCED）。`⚖️` = 有具体条款号，rulebook 变版时逐条复查
- **OPTIMIZED** — VARA 不强制、行业多半这么做的未来优化

**每条标注**：`来源:`（领导/VARA 条款/行业）｜ `配对:`（正逆操作互链，防逆向遗忘）｜ 状态 `[x]`交付 `[~]`部分 `[ ]`待做 + 日期。
**实现细节与当前真相** → `reference/truth/`（改代码同步那里，不改这里）｜ **技术债/死码/待决策** → `../BACKLOG.md`。
> ⚠️ 三层分类 + truth 外置目前已应用于 **V3 / V4**；其余版本待同款重排（见 BACKLOG「文档漂移」）。

---

## 依赖链总览

```
V1（审计底座）
  └→ V2（客户审批依赖审批引擎）
       └→ V4 / V5 / V6（交易依赖客户合规资格）
V3（财务配置）
  └→ V4 / V5 / V6 / V7（所有记账依赖账户模型）
V4 / V5 / V6 / V7
  └→ V8（对账依赖已有交易数据）
V1–V8
  └→ V9（合规报送依赖所有业务数据）
V7（财资运营）已脱离交易链——旧 EOD 结算/内部转账被实时1:1 取代删除；现管公司自有资金/流动性，全部 ADVANCED 未做
```

---

## V1 — 审计底座（审批 / 审计 / RBAC / Admin 生命周期）

> 平台治理底座：审批引擎 + 审计日志 + RBAC + admin 生命周期 + 凭证安全。所有后续版本操作可信性依赖它。
> 📖 **实现真相** → [`reference/truth/v1-governance-audit.md`](truth/v1-governance-audit.md)
> ⚠️ SUPER_ADMIN 是演示角色（代码硬编码 bypass），正式上线前须移除。

### MVP（领导定义的基础必须，10 工作流全 ✅）

- [x] Admin Invite — 入职审批 + SoD 冲突校验 + 邀请链接设密激活 ｜来源:业务 ｜配对:Admin 删除(ADV) ✅2026-05-05
- [x] Admin First Login — 首登四步(身份确认→强制 MFA 绑定→验证→安全须知)，状态机+审计 ｜VARA TIR III.A ✅2026-05-06
- [x] Admin Role Binding Change — 角色变更审批 + SoD + 3 层；旧 Change Ticket 已清 ｜VARA TIR III.B ✅2026-05-05
- [x] Admin Account Suspension — 停用审批；JWT 拦截 SUSPENDED(非即时，生产需 token blacklist) ｜来源:业务 ｜配对:恢复 ✅2026-05-05
- [x] Admin Account Reactivation — 恢复审批，3 层 ｜来源:业务 ｜配对:停用 ✅2026-05-06
- [x] Admin Password Reset — 自助(邮箱→MFA→链接)+CISO 代操作；15min token+SHA-256+速率限制+反枚举 ｜VARA TIR III.A ✅2026-05-06
- [x] Admin MFA Reset — CISO/TECH_OFFICER 发起，IAM_CREDENTIAL_RESET，重走首登 ｜VARA TIR III.A ✅2026-05-06
- [x] Role Definition CRUD — 自定义角色 + Action Bucket Catalog(现 9 域 23 bucket) ｜来源:业务 ✅2026-05-10
- [x] Audit Evidence Export — 证据包导出审批(approval-backed)+manifest+SHA-256 digest ｜VARA CRM III.A ✅2026-05-05
- [x] Approval Policy Management — 多步骤审批链(stepsConfig 每步多角色 OR)+自审防篡改 ｜VARA CRM II.B ✅2026-05-07

> #5/6/7 共享 `workflowType: ADMIN_CREDENTIAL_MGMT`。

### ADVANCED（全部未做）

- [ ] ⚖️ Admin Account Deletion — 离职完全撤销访问(Suspension 只是临时) ｜VARA TIR III.B.2 ｜配对:Invite(MVP)
- [ ] Audit Evidence Package Deletion — 证据包保留期满受控删除 ｜来源:业务
- [ ] ⚖️ Emergency Break-Glass — 紧急权限绕过+时限 elevated+自动收回+事后 review ｜VARA TIR V.A ｜上线无 SUPER_ADMIN 后优先级高
- [ ] Approval 超时预警/通知 — 到期前 N 小时通知+升级(现只算 timeoutAt 无预警) ｜来源:业务 ｜依赖通知本体
- [ ] ⚖️ Periodic Access Review — 权限快照+休眠/过度权限/SoD 违规标记，CISO 季审 ｜VARA TIR III.B.4
- [ ] ⚖️ API Key Emergency/Scheduled Rotation — 密钥泄露紧急轮换 + 90 天定期 ｜VARA TIR Schedule 1
- [ ] ⚖️ Audit Log Archival — 过期日志冷存储(有 markArchivedBefore 骨架，retention 脚本坏) ｜VARA CRM III.A

### Supporting Features（非 workflow）

- **审批引擎(maker-checker)** ✅ ｜ **审计 write/query** ✅ ｜ **RBAC 权限校验** ✅ ｜ **SoD 互斥(3 对硬编码)** ✅ ｜ **审计 SubjectNo 移除** ✅2026-05-19
- ⚠️ **通知 send/retry** — roadmap 原标 ✅，**实为 STUB**（只 WebSocket gateway，无 email/webhook/retry；见 truth + BACKLOG）
- **Approval delegation / Login anomaly detection** — ADVANCED 未做

> 现状/锚点见 [truth/v1-governance-audit.md](truth/v1-governance-audit.md)；技术债(通知 stub / subjectNos 漂移 / retention 脚本 / SUPER_ADMIN bypass)见 [BACKLOG.md](../BACKLOG.md)。

## V2 — 客户管理 + 合规底座

> 建立客户准入与合规管理体系：客户入驻、风险评估、材料管理、限额升级、账号冻结管控。Sumsub 负责自动化验证与持续监控，EDD 调查在平台内部由 MLRO 执行。V4–V6 交易资格门依赖本版本。
> MVP 阶段仅服务 Individual 客户；机构客户（Corporate/Institutional）所有工作流列入 ADVANCED。
> 客户主表 3 轴状态模型（✅ 2026-05-09）：onboardingStatus（准入）、adminStatus（行政开关）、complianceStatus（合规开关）；两个开关都通过后看 restrictions JSON 做细粒度能力限制。investorTier（STANDARD/ENHANCED）查限额策略表；riskRating（LOW/MEDIUM/HIGH）决定监控强度。详见 `doc-final/superpowers/specs/2026-05-08-customer-main-table-design.md`。

### MVP（6 workflows）

- [x] Sumsub Webhook 翻译层（基础设施，非 workflow；接收 Sumsub webhook → 翻译成内部事件广播，V2 所有合规结果的前置；`POST /webhooks/sumsub` 签名验证 → `ingest()` 创建 `SumsubWebhookEvent` 记录 → `dispatch()` 按 eventType 路由到领域处理器；已处理类型：applicantReviewed / applicantActionReviewed / applicantWorkflowCompleted / ongoingDocExpired；模拟事件含 kytCheckSimulated / travelRuleCheckSimulated / caseDecisionSimulated 均走同一管道；Admin Sumsub Events 列表页展示全部事件记录；支持 retry、dead-letter） — **业务必须**：没有翻译层，平台无法接收任何 Sumsub 验证结果和监控告警 ✅ 2026-05-23
- [ ] 客户 Onboarding（CDD 全套：ID + 自拍 + 地址证明 + 风险问卷 + PEP/制裁筛查 → 通过即 Level 1 开户） — **VARA**：CRM Rulebook II.A Customer Due Diligence — 客户准入强制尽职调查
- [ ] CRA Review（客户风险评估与定期重审；三种触发：① cron 按风险等级定期触发完整 re-KYC ② Sumsub ongoing monitoring alert ③ MLRO 手动；Risk = HIGH 时启动 EDD 调查分支——MLRO 在平台内部收集 SOW/SOF 并人工审查决策） — **VARA**：CRM Rulebook II.C Risk-Based Approach + III.B Enhanced Due Diligence — AML 风险持续评估与高风险客户深度调查义务
- [ ] Material Refresh（材料过期补充：NUDGE → URGENT → BLOCKING → RESOLVED） — **VARA**：CRM Rulebook II.A.3 Ongoing CDD — 客户身份材料必须保持有效
- [ ] Trading Tier Upgrade（交易层级升级审批：客户申请升级 tradingTier（如 BASIC → PREMIUM → VIP）→ 提交收入/流水证明等材料 → Sumsub 增强验证（Enhanced KYC）→ 前置校验 riskLevel ≠ HIGH → MLRO + SMO 审批门（48h）→ 更新 customer.tradingTier，适用新 tier 限额组） — **业务必须**：客户需要更高交易限额的标准化升级路径 ⛔ BLOCKED：依赖客户端材料提交 UI 设计
- [ ] 客户账号冻结 / 解冻（统一 workflow：管理层手动触发走先审批后冻结；合规事件自动触发走先冻结后 MLRO 审查；解冻统一需 MLRO 审批；冻结期间客户不可交易） — **VARA**：CRM Rulebook IV.A Suspicious Activity Response + TIR Rulebook IV.C Incident Response — 合规事件必须能立即冻结客户并有正式解冻决策路径

### ADVANCED

**Individual 进阶（3 workflows）：**

- [ ] 客户资料变更（核心身份信息变更触发重新验证：低风险字段直接生效 + 审计；高风险字段如姓名/国籍/证件 → 触发 Sumsub 重新验证） — **VARA**：CRM Rulebook II.A.3 Ongoing CDD — 客户信息必须保持最新
- [ ] 客户销户（余额清零确认 → 在途订单处理 → AML 最终审查 → KYC 数据保留归档 → 充值地址注销 → 账号关闭） — **VARA**：CRM Rulebook IV.C Record Retention — 受监管退出流程，数据保留 8 年，不可用"冻结"代替
- [ ] 客户协议版本管理（T&C / 隐私政策 / 费率表版本变更：Maker 起草 → Legal 审批 → 发布 → 通知客户 → 客户确认记录） — **业务必须**：协议版本与客户签署记录不可篡改，用于争议举证

**Institutional 扩展（接入机构客户后，7 workflows）：**

- [ ] Corporate Onboarding / KYB（实体验证 + UBO/董事识别与个人 KYC + 授权代表指定 + 董事会开户决议 + 公司级风险评估 → MLRO 审批 → 开户） — **VARA**：CRM Rulebook II.B CDD for Legal Persons — 法人客户准入强制尽职调查
- [ ] UBO 管理（识别持股 >25% 自然人 + 每人走个人 KYC + PEP/制裁筛查；存续期间股权变更 → 重新识别 → 新 UBO 走 KYC → 任一 UBO 命中 PEP/制裁 → 级联触发公司级风险重评估） — **VARA**：CRM Rulebook II.B.3 Beneficial Ownership — 最终受益人识别与持续监控义务
- [ ] 授权代表管理（新增/移除/权限变更，均需董事会决议 + 个人 KYC + 审批；移除时撤销所有权限 + session 失效） — **VARA**：CRM Rulebook II.B.2 Authorized Persons — 代表公司操作平台的自然人必须经过验证和授权
- [ ] 公司结构变更（董事/股东/公司名/注册地/经营范围变更 → 提交新公司文件 → 按类型分级：股东/董事变更触发 UBO 重识别 + 风险重评估；公司名/注册地变更触发制裁重筛） — **VARA**：CRM Rulebook II.A.3 Ongoing CDD — 法人客户重大变更必须重新验证
- [ ] 多用户企业账户访问控制（一个企业账户下多个授权代表各自独立权限：查看/交易/提现分级；权限变更需董事会决议 + 审批；企业级冻结时所有代表同时失去操作权限） — **业务必须**：机构客户多人操作的基础能力
- [ ] Corporate CRA Review（机构风险评估模型：行业风险 + 注册地风险 + 股权结构层级复杂度 + 关联人 PEP 暴露 + 财报健康度 + 经营年限；与个人 CRA 是不同的风险模型） — **VARA**：CRM Rulebook II.C Risk-Based Approach — 法人客户需要独立的风险评估模型
- [ ] Corporate Periodic Review / Re-KYB（定期重新收集公司注册证明 + 最新股东名册 + 年度财报 + 所有 UBO/董事重新筛查；频率按风险等级：HIGH 每年 / MEDIUM 每 2 年 / LOW 每 3 年） — **VARA**：CRM Rulebook II.A.3 Ongoing CDD — 法人客户定期重新验证义务

---

## V3 — 财务配置

> 交易的前置底座：资产 / 钱包 / 账本账户三个 primitive + 提现地址 + 金额闸门。
> **前置**：V1（审批引擎）｜**被依赖**：V4-V7 所有记账操作。
> 📖 **实现真相** → [`reference/truth/v3-financial-config.md`](truth/v3-financial-config.md)

### MVP（领导定义的基础必须）

- [x] 资产上线与激活 — 直接创建→PROVISIONING→CISO 审批+就绪检查→ACTIVE ｜来源:领导 ｜配对:资产下架(ADV) ✅2026-05-15
- [x] 资产暂停/恢复 — 双向独立 CISO 审批门 ｜来源:领导+VARA TIR IV.C ✅2026-05-15
- [x] 托管钱包创建 — Crypto — Admin 系统钱包 / Client 充值地址双入口 ｜来源:领导 ✅2026-05-13
- [x] 托管钱包创建 — Fiat — Admin 系统账户 / Client VIBAN 双入口 ｜来源:领导 ✅2026-05-13
- [x] 账本账户开设 — 随资产同事务开系统账户，客户账户首笔懒解析+手动兜底 ｜来源:领导 ✅2026-05-15
- [x] 提现地址登记 — Crypto — 24h 安全冷却 ｜来源:领导+VARA TIR III.A ｜配对:地址停用归档(ADV) ✅2026-05-13
- [x] 提现地址登记 — Bank — 同冷却机制 ｜来源:领导+VARA TIR III.A ｜配对:地址停用归档(ADV) ✅2026-05-13
- [~] 金额闸门体系 — 限额配置管道✅2026-05-16；**未接入执行**（充/提/兑均不消费限额表，侧边栏入口已隐藏 84cfffb）。三条金额线（tier 限额 / 大额审批 20 万 / TR 阈值 3,500）待合并为"金额闸门矩阵"统一接入 L1 ｜来源:领导（2026-07-03 定性 MVP 未完成，待重设计）

### ADVANCED（VARA gap + 低频逆向）

- [ ] ⚖️ 资产对外披露信息页 — 每资产公开摘要（符号/发行日/市值/流通量/合约审计/最大回撤）｜VARA BD I.B.1(c) ｜挂靠资产上线，下架联动摘除
- [ ] ⚖️ 资产下架 — 在途订单清退 + 持仓清退 + 披露页摘除 + 审批 ｜来源:VARA(披露一致性)+行业(Coinbase/Kraken) ｜配对:资产上线(MVP)
- [ ] ⚖️ 阈值参数配置治理 — 归集/dust/大额线/TR 阈值走 Maker-Checker，出硬编码 ｜VARA Company(职责分离，硬编码绕过四眼) ｜自 V7 移入
- [ ] ⚖️(待核) 提现地址 hosted/unhosted 区分 — 非托管钱包风险标记 ｜CRM Rulebook(条款待人工复核) ｜TravelRuleAdapter 归因已有地基
- [ ] 提现地址停用归档 — 确认无在途提现→停用（8 年保留，不物理删）｜来源:领导 ｜配对:地址登记(MVP)

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] 资产上线三重评审矩阵 — 法律定性/合规风险/技术安全独立评审位 ｜来源:行业(Coinbase Listing Framework)
- [ ] 辖区×币种白名单矩阵 — 多辖区/多法币后启用 ｜来源:行业+FATF

> **支撑项**（TB 账户类型定义 / 钱包模型 V3 适配 / 资产状态守卫 / code→currency 改名 / 前端清理）均已交付；实现现状见 [truth/v3-financial-config.md](truth/v3-financial-config.md)。**技术债**（TB 建账失败无 backlog、contractAddress 残留等）见 [BACKLOG.md](../BACKLOG.md)。

---

## V4 — 充值流程

> 链上/银行到账 → 充值订单 → 暂扣两步记账 → L1 资格 + L2 合规筛查 → 入账。
> **前置**：V2（客户合规资格）+ V3（账户模型）。
> 📖 **实现真相** → [`reference/truth/v4-deposit.md`](truth/v4-deposit.md)（含双链路状态机、异常分支现状、半截桥风险）

### MVP（领导定义的基础必须）

- [x] 虚拟币充值 Happy Path — 链上到账→资金单确认→暂扣记账(Step1 CLIENT_ASSET→SUSPENSE)→L1 资格→L2(KYT+TR 全 PASSED)→入账(Step2 SUSPENSE→PAYABLE) ｜来源:领导+VARA CRM II.A ✅2026-05-22
- [x] 法币充值 Happy Path — VIBAN 到账(无确认阶段)→暂扣记账→L1→L2(KYT；TR 自动 NOT_REQUIRED)→入账 ｜来源:领导+VARA CRM II.A ✅2026-05-27

### ADVANCED（VARA gap + 异常分支；括号内 P0/P1/P2 = 实施优先级）

**P0（硬条款欠账 + 已上线按钮钱路未通）：**
- [ ] ⚖️ 制裁冻结完整闭环 — KYT/制裁命中→FROZEN→MLRO 审批门→放行/没收(CONFISCATE 治理化) ｜VARA CRM III.H(命中即冻结、记录 8 年) ｜(P0)
- [ ] ⚖️ 已记账异常终态 TB 回退 — REJECTED/FAILED/EXPIRED 若已过 Step1 须反向 SUSPENSE→CLIENT_ASSET ｜VARA BD(禁止不当处置客户资产) ｜(P0，临时守卫见 BACKLOG task_16af8187)
- [ ] KYT FAILED 消化路径 — 失败不能永挂 COMPLIANCE_PENDING ｜来源:业务 ｜(P0)

**P1（有具体数字/字段的条款欠账）：**
- [ ] ⚖️ TR 阈值 3,500 闸门 + 数据缺失分支 — 单笔/分方向/严格大于；缺对手方数据→等待时限→处置 ｜VARA CRM III.G ｜(P1，并入金额闸门矩阵)
- [ ] ⚖️ 拆单聚合监控 — 关联交易识别，防规避阈值 ｜VARA CRM III.G.9 + FATF 红旗指标 ｜(P1)
- [ ] ⚖️ 法币名义不符核验 — senderName 字段+比对，first-party 付款人核验 ｜VARA CRM III.E(SoF/首笔经持牌账户) ｜(P1)
- [ ] 按链确认数配置 + 区块重组回退 — 确认数按链差异化（非全局常量）｜来源:行业(Coinbase/Kraken) ｜(P1)
- [ ] ACTION_PENDING 补材料闭环 — 接 Sumsub 复审 webhook ｜来源:业务 ｜配对:L2 筛查 ｜(P1)

**P2（依赖真实银行集成或低频）：**
- [ ] ⚖️ 稳定币发行方冻结应对 — USDT 黑名单事件 runbook + 资产暂停联动 ｜FATF 2025(非法活动多涉稳定币) ｜(P2)
- [ ] 法币银行退汇/冲正 — bounce→FAILED；到账后 reversal→扣回/催收 ｜来源:业务 ｜(P2)
- [ ] EXPIRED 超时回退 — 补材料超时→回退 ｜来源:业务 ｜(P2)
- [ ] 孤儿充值处理 — 无主资金→suspense→人工归属/MLRO；VIBAN 归属校验建议先补 ｜VARA CRM III.A ｜(P2)
- [ ] 充值渠道暂停/恢复 — 指定链/token/法币渠道 + 审批 ｜来源:业务 ｜(P2)

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] 充值成功通知 — 到账推送客户，复用 V1 Notification ｜来源:行业(UX)

> **支撑项**（事件驱动编排 / KYT-TR 模拟端点 / Admin 充值页 / Client 三 Tab / Tipping-off 映射 / Overview 读 TB）均已交付；现状见 [truth/v4-deposit.md](truth/v4-deposit.md)。**技术债**（txHash 去重、repair surface、emit vs emitAsync、PATCH 绕过等）见 [BACKLOG.md](../BACKLOG.md)。**TransactionComplianceService 废弃** — 已确认全仓 0 命中（删干净）。

---

## V5 — 提现流程

> 提现申请 → L1 资格 → 大额审批门 → L2 合规筛查（Pre-KYT + TR）→ Payout → 链上/银行确认 → 记账。crypto/fiat 共用同一工作流。
> **前置**：V2 + V3 + V4（余额依赖充值）。
> 📖 **实现真相** → [`reference/truth/v5-withdraw.md`](truth/v5-withdraw.md)（状态机 / 三层合规 / 大额门 / 费率治理 / funds_order 2 腿）

### MVP（领导定义的基础必须）

- [x] 虚拟币提现 Happy Path — L1 资格→大额门→L2(Pre-KYT+TR 全 PASSED)→Payout→txHash 确认→TB post(客户 CLIENT_PAYABLE↔CLIENT_ASSET + 公司 FIRM_ASSET→FIRM_FEE)→L3 归档→SUCCESS ｜来源:领导+VARA CRM II.A ✅2026-05-30
- [x] 法币提现 Happy Path — 同链路；TR 自动 NOT_REQUIRED、无 L3、银行到账确认(走 funds_order CONFIRMED) ｜来源:领导+VARA CRM II.A ✅2026-05-31
- [x] 大额审批门 — 毛额 ≥20 万 AED(fail-closed 估值)触发 SMO 单步 48h，门置于 L2 之前 ｜来源:领导+VARA ✅2026-06-01（**现役唯一金额闸门**）
- [x] 提现费率等级 创建/变更/绑定 — 3 独立工作流；创建/变更走审批(现状 OPS_OFFICER 单步)、变更 request-record+configHash 冲突检测、绑定无门直接生效 ｜来源:领导+VARA CRM II.C ✅2026-05-30

### ADVANCED（VARA gap + 异常分支）

- [ ] ⚖️ 制裁地址/受益人拦截 — 命中 OFAC/SDN→强制取消→void 解锁→MLRO 审计→SAR ｜VARA CRM III.H ｜配对:L2 筛查
- [ ] ⚖️ KYT 高风险 MLRO 审批门 — 高风险地址/受益人→挂起→MLRO 放行/拒绝(void)；后端需补 FROZEN 或等价挂起态 ｜VARA CRM
- [ ] ⚖️ 大额提现增强审查(EDD) — 超阈值强制 SOF/SOW→Sumsub 增强→MLRO 门(阈值按 tradingTier) ｜VARA CRM III.B
- [ ] 链上失败重试/加速 — stuck/failed→超时重试加速或取消(现仅 onPayoutLegFailed→FAILED+void，无重试) ｜来源:业务
- [ ] 法币银行退回(bounced) — 退汇→void 恢复→通知→审计 ｜来源:业务 ｜配对:V4 充值 bounce
- [ ] 提现渠道暂停/恢复 — 指定链/token/法币渠道 Maker+Checker，在途处理策略明确 ｜来源:业务
- [ ] 提现渠道切换/降级 — 主渠道故障切备用 + 审批 ｜来源:业务
- [ ] 批量提现(机构) — CSV 批量→逐笔校验→统一审批→逐笔 Payout+汇总 ｜来源:业务(机构)
- [ ] 提现专属限额变更 — request-record 审批(区别于 V3 通用限额) ｜来源:业务 ｜与金额闸门矩阵一并

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] 提现成功通知 — SUCCESS 推送客户，复用 V1 Notification（基础设施在、未接）｜来源:行业(UX)

> **支撑项**（事件驱动编排 / TB pending-post-void 记账 / 模拟端点 / Admin+Client 页 / Tipping-off 映射 / WithdrawQuote 取最优 / 费率 seed）均已交付；现状见 [truth/v5-withdraw.md](truth/v5-withdraw.md)。**技术债**（Sumsub 真集成 / 热钱包校验 / 通知 / repair surface）见 [BACKLOG.md](../BACKLOG.md)。
> ⚠️ **措辞订正（2026-07-03 体检）**：费率审批已从 MLRO+SMO 简化为 OPS_OFFICER 单步（2026-06-01）；REJECTED/大额否决的 void 解锁**已实现**（异常分支非全空）；提现资金单 = 2 腿 funds_order（payout+fee），FUND_OUT 预归集已退役。

---

## V6 — 兑换流程

> 平台内兑换（crypto↔fiat 余额交换，**资金不出境、无外部对手方**）：报价 → L1 资格 → 消费 Quote → 4 腿实时记账 → SUCCESS。合规**仅 L1 同步闸门**（无 L2/大额门，因资金不出境）。
> **前置**：V2 + V3。
> 📖 **实现真相** → [`reference/truth/v6-swap.md`](truth/v6-swap.md)（4 腿账户 / FAILED-REVERSED 死枚举 / 费率治理）

### MVP（领导定义的基础必须）

- [x] 报价工作流 — SwapQuote(30s TTL)：resolveBestLevel 最优费 + Binance 实时汇率 + PricingEngine 算 amountOut/spread/fee ｜来源:领导 ✅2026-06-01
- [x] 兑换成交 Happy Path — L1 资格→消费 Quote→PROCESSING→4 腿 per-leg two-phase(客户 CLIENT_PAYABLE↔CLIENT_ASSET + 公司 FIRM_ASSET↔FIRM_OPS/SET/FEE)→leg1 自动/leg2-4 admin advance→4 腿 CLEAR→SUCCESS ｜来源:领导+VARA CRM II.A ✅2026-06-01
- [x] 兑换费率等级 创建/变更/绑定 — 3 独立工作流；创建/变更 OPS_OFFICER 单步、变更 request-record+configHash 冲突、绑定无门；tier=rateMarkupBps+feeItems(支持 spread-only) ｜来源:领导+VARA CRM II.C ✅2026-06-01

### ADVANCED（VARA gap + 治理 + 失败终态）

- [ ] swap 失败终态治理 — 接 reverse 端点(整笔冲正→REVERSED) + 自动 FAILED 状态机；现 FAILED/REVERSED 为**死枚举**、失败仅自愈→STUCK 留 PROCESSING ｜来源:业务 ｜配对:成交 Happy Path
- [ ] ⚖️ 大额兑换增强审查(EDD) — 超阈值强制 SOF/SOW→Sumsub 增强→MLRO；⚠️设计立场:swap 资金不出境现仅 L1 eligibility，是否启用异步合规门待定 ｜VARA CRM III.B
- [ ] 交易暂停/恢复 — 货币对/全局暂停，在途 Quote 强制 EXPIRED，Maker+Checker ｜来源:业务
- [ ] 货币对上下线 — 新增(关联 TB Account+默认 SwapFeeLevel+审批)/下线(处理在途 Quote+归档) ｜来源:业务
- [ ] 批量兑换(机构) — CSV 批量→逐笔校验→统一审批→逐笔成交 ｜来源:业务(机构)

### OPTIMIZED（VARA 不强制、行业惯例）

- [ ] Quote TTL cron sweep — 过期 Quote 自动标 EXPIRED(现仅懒过期) ｜来源:行业
- [ ] 兑换成功通知 — SUCCESS 推送客户，复用 V1 Notification ｜来源:行业(UX)

> **支撑项**（SwapQuoteService 拆分 / PricingCenterService 删除 −3500 行 / 4 腿声明式记账 / Client 兑换页 / Swap Quotes admin 页 / 审批策略 6 类简化 OPS_OFFICER / legacy swap config 已清）均已交付；现状见 [truth/v6-swap.md](truth/v6-swap.md)。**技术债**（Sumsub TM / repair surface / InternalFund 命名债）见 [BACKLOG.md](../BACKLOG.md)。
> ⚠️ **措辞订正（2026-07-04 体检）**：① reverse 整笔冲正 / REVERSED / FAILED 实为**死枚举 + 无 reverse 端点**（原 2026-06-26 ✅ 过度声明，降为 ADVANCED 待做）；② 编排类名实为 `SwapWorkflowService`+`SwapLegAccounting`，**无 `SwapSettlementService`**；③ swap 腿 = funds_order（代码仍用 InternalFund 旧名，命名债）。

---

## V7 — 财资运营（Treasury Ops）

> 管**公司自有资金与流动性**（客户的钱由 V4-V6 管，实时1:1 safeguarding）。
> ⚠️ **旧 V7「内部转账 / 延迟结算」整套已废弃**：随实时1:1 重构，通用内部转账工作流 / EOD 轧差结算 / 充值归集 cron / 手续费归集 / 法币交割 / Outstanding / SettlementBatch / FeeAccrual / 白名单 全部删除（C5b）。每笔交易现**自己就地记账**（V4 两步 / V5 payout+fee / V6 四腿）。资金单（funds_orders）是**跨版本共享原语**（V4 起在用），归 `truth/funds-orders.md`（待建），不属于本版本。
> **前置**：V3（账户模型）。
> 📖 无独立 truth（无活体 V7 业务）；旧延迟结算设计仅作历史存档 → `reference/v7-funds-layer-baseline.md`（只读追溯，勿当现状）。

### MVP

- 无。原 MVP（通用内部转账 / 充值归集 / EOD 结算 / 法币交割 / 手续费归集）已被实时1:1 吸收进 V4-V6 或删除。

### ADVANCED（全部未做，平台跑起量、自有资金进出多了才痛）

**流动性管理（最先痛）：**
- [ ] LP 调拨治理 — LP-IN 补货 / LP-OUT 回吐（Maker + CFO/MLRO 审批）；客户换出多了库存见底须找 LP 平盘 ｜来源:业务
- [ ] 公司自有流动性再平衡 — FIRM 各钱包 Main↔Liquidity 库存调拨 ｜来源:业务
- [ ] 跨网络库存再平衡 — 同资产跨链（如 USDT-ERC20↔TRC20，可能走 OTC）｜来源:业务

**储备与收入：**
- [ ] ⚖️ 储备金注资 / 穿底补救 — 公司外部→客户池，补足 safeguarding 缺口 ｜VARA(客户资产 1:1 保障)
- [ ] 收入提取 — FIRM_FEE → 公司运营 / 银行账户 ｜来源:业务

**异常与配置治理：**
- [ ] 异常资金处置 — 孤儿/无主资金归位 / 冻结·制裁资产隔离 / 错账冲正 ｜来源:业务+VARA
- [ ] 内部转账阈值配置治理 — 归集/审批线/dust 阈值出硬编码（Maker+Checker）｜来源:业务 ｜与 V3 金额闸门矩阵一并

> **边界决策（仍有效）**：链上 gas → HexTrust gas station 自担（不进 TB，固定 P&L）；钱包热/冷分层 + 托管扫钱 → HexTrust 管，平台不编排；银行费 → 年付固定 OpEx。
> **别双重登记**：偿付义务（Reimbursement）+ 储备证明（Proof of Reserves）已归 V8 对账。

---

## V8 — 对账流程

> 客户/公司资产对账：内部账本（TB / AccountFlow 投影）vs 外部数据（银行 / HexTrust / 链上）**逐物理钱包 1:1 直比** + 差异分五桶 + 平账处置。
> **前置**：V3-V6（依赖完整交易与持仓数据）。
> 📖 **实现真相** → [`reference/truth/v8-recon.md`](truth/v8-recon.md)（Phase B 引擎 / 五桶 / Run-Case 驾驶舱 / effectiveDate / 推单处置）
> ⚠️ 历史：经 I1-I5 → credit-net 五公式 → Phase B 三轮重构；旧 credit-net 五公式引擎已 **Phase C 物理删**（11 文件）。设计存档见 `superpowers/specs/2026-06-20 ~ 2026-07-03-*` 系列（只读追溯，勿当现状）。

### MVP（领导定义的基础必须）

- [x] 逐钱包 1:1 余额对账 — 客户钱包 external==PAYABLE+SUSPENSE / 公司钱包 1:1 直比；内部恒等预门(TB 直读) ｜来源:领导+VARA CRM III.A ✅Phase B
- [x] 五桶流水匹配 — 三轮(同 ref 跨钱包互证 / 金额方向窗口模糊 / 在途↔非终态资金单)+残差恒等式分桶(MATCHED/IN_TRANSIT/SOFT_FLAG/BREAK) ｜来源:领导 ✅Round3
- [x] Run 编排 + 快照 + 审计 — 每日 cron(02:30 Dubai)→逐钱包→开 case(每钱包跨日唯一 OPEN)+auto-heal+run 快照(根治历史漂移)+审计三打点 ｜来源:领导 ✅Round3
- [x] Run/Case 驾驶舱 admin — Run(结论条+五桶过滤+三元组跳转+快照表)/Case(桶徽章+差额五格+观察历史+流水混排) ｜来源:领导 ✅Round3
- [x] effectiveDate 平账准备 — 双表加列+等价保真切换(effectiveCutoffFilter)+回填透传链(advance→writeEvidence→account_flows)+recon:rerun 工具 ｜来源:领导 ✅2026-07-03
- [x] 推单处置(7 平账动作第 1 个) — 同步腿(唯一回执匹配)+人工腿(三件套)，逐步 advance 不直写 TB+回填生效日；双端点+审计 ｜来源:领导 ✅2026-07-03
- [x] recon:demo 九场景 — anchor-free pass/break + manifest 答案键(9 类平账根因)+恒等式自验 ｜来源:领导 ✅2026-07-03

### ADVANCED（差异处置闭环 + 监管报送，全 deferred）

- [ ] ⚖️ 差异处理人工闭环 — Finance 人工核实/补录→RESOLVED + 24h SLA 升级 MLRO/CFO ｜VARA(差异上报) ｜现止于 Case OPEN
- [ ] 其余 6 平账处置动作 — 补单/冲正/冲销/豁免/偿付/…(推单已做) ｜来源:业务
- [ ] 偿付义务工作流(Reimbursement) — 从 V7 移入；OPEN→审批(CFO/MLRO)→REIMBURSED；表已 drop 留 hook；两触发源(对账差异/event 失败)共出口 ｜来源:业务+VARA
- [ ] ⚖️ 季度 Proof of Reserves — HexTrust 钱包链上快照→Sum(客户负债)≤储备证明→VARA 季报 ｜VARA(储备证明)
- [ ] 对账报告导出 — 日期范围摘要(余额差/匹配率/未决 Case)，VARA 审计 / 半年独立审计输入 ｜VARA
- [ ] LP 仓位对账 — 与 LP 对手方核对 LP-IN/OUT，依赖 LP API/文件 ｜来源:业务

> **设计前提（仍有效）**：① Gas 全由公司承担，客户资产不因 Gas 产生差异；② 实时1:1 双式记账保证客户资产与负债内部持平，对账退化为外部核对。
> **技术债**（reObservedCount=0 bug / Reimbursement 三处残留 / FIRM treasury 历史残留 / 资本注入 evidence 待核）见 [BACKLOG.md](../BACKLOG.md)。

## V9 — 合规治理顶层

> 平台对监管机构和客户的直接义务：VARA 强制 SLA 管控、重大事件上报、客户投诉处理。STR 申报、制裁筛查、KYT 等合规执行已由 Sumsub 承接；V9 专注于 Sumsub 覆盖不到、平台必须自建的合规治理机制。

**前置：** V1–V8

**Workflow 清单：**

核心工作流（MVP）：
- [ ] 重大事件上报工作流（触发：客户资产缺口 / 重大安全事件 / 系统性运营中断 / 牌照相关重大变更等 → 内部评估是否达到 VARA 材料性门槛 → 达到：CEOs + MLRO 多级审批 → **72 小时内**提交 VARA（VARA 强制要求）→ 系统内置倒计时告警，临近截止时升级提醒 → 跟踪 VARA 回执 → 归档完整证据链；未达到：记录评估结论 + 理由存档）
- [ ] 客户投诉处理工作流（触发：客户通过 Client 端提交投诉 → 创建 ComplaintNo → 按类型分类：资金类 / 账户类 / 服务类 → 分配对应团队调查 → 平台自定义 SLA 内出具处置决定：接受 / 拒绝 / 部分接受 → 书面回复客户并说明理由 → 客户不接受 → 升级至 MLRO / 外部仲裁路径；全程审计记录，VARA Market Conduct Rulebook 要求）

**SLA 监控基础设施（MVP，非独立工作流）：**

跨工作流的 VARA 要求 SLA 统一监控层，覆盖以下场景。有 VARA 明确数字的用规定值，无规定的平台自定义并写入合规政策：

| SLA 场景 | VARA 要求 | 来源工作流 |
|---|---|---|
| 重大事件上报 | 72 小时 | V9 重大事件上报 |
| 未授权转账余额恢复 | 24 小时 | V5 / V8 |
| 兑换成交结算 | 24 小时 | V7 EOD 结算 |
| STR 申报 | 近实时 | Sumsub → goAML |
| 对账差异升级 MLRO | 平台自定义 | V8 差异处理 |
| KYC 审核完成 | 平台自定义 | V2 Onboarding |
| 合规冻结最长持续 | 平台自定义 | V4 / V5 合规异常 |
| 冻结资产处置决定 | 平台自定义 | V4 制裁冻结审批 |
| 客户投诉最终答复 | 平台自定义 | V9 客户投诉处理 |

推后交付：
- [ ] 合规日历（工具层：追踪所有监管截止日期，临期告警，完成状态记录）
- [ ] 季度监管报告（待 MLRO 入职后确认 VARA 要求的具体内容和提交渠道；早期手动执行，平台提供数据导出接口）
