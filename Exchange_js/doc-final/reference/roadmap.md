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

## V1 — 审计底座

> 建立平台治理基础：审计日志、审批引擎、admin 生命周期管理、角色管理、凭证安全。所有后续版本的操作可信性依赖本版本。
> 注意：SUPER_ADMIN 是演示角色，正式上线后系统中不存在该角色。

### MVP（10 workflows）

- [x] Admin Invite（管理员入职审批，含 SoD 冲突校验；审批通过后管理员点击邀请链接设置密码完成账号激活） — **业务必须**：管理员入职的标准化流程，没有邀请流程就没法加人 ✅ 2026-05-05
- [x] Admin First Login（首次登录仪式：身份确认 → 强制 MFA 绑定 → 绑定验证 → 安全须知确认 → 登录完成；无审批门，但有完整状态机和审计打点；含前端 i18n 全英文化、MFA 弹窗重设计、token 过期 UX 处理、登录审计 workflow 串联——ADMIN_LOGIN_SUCCESS 与 MFA_LOGIN_VERIFIED 共享 traceId） — **VARA**：TIR Rulebook III.A Authentication — MFA 是管理访问的强制要求，首次绑定必须有受控流程和审计证据 ✅ 2026-05-06
- [x] Admin Role Binding Change（角色变更审批，含 SoD 冲突校验 + SoD Rules tab；已完成 3-Layer 架构：薄审批处理器 + 工作流编排器 + 领域服务，路由 `/admin/iam/role-change-requests`，旧 Change Ticket 路径已清理） — **VARA**：TIR Rulebook III.B Access Control — RBAC 治理 + 最小权限原则 + 职责分离 ✅ 2026-05-05
- [x] Admin Account Suspension（账号停用审批；执行时 JWT Strategy 校验拦截 SUSPENDED 用户。**生产环境需改造为 token blacklist 方案实现即时 session 撤销**） ✅ 2026-05-05
- [x] Admin Account Reactivation（账号恢复审批；3-Layer 架构：薄审批处理器 + 工作流编排器 + 领域服务，Suspension 的配对恢复路径） — **业务必须**：Suspension 的配对恢复路径，没有它则停用等于永久删除 ✅ 2026-05-06
- [x] Admin Password Reset（自助忘记密码 + CISO 代操作双路径；自助路径：邮箱→MFA 验证→重置链接；CISO 路径：详情页发起→重置链接展示在成员详情页；token 15min 有效期 + SHA-256 hash + 速率限制；反枚举设计；重置密码页面匹配 Admin 暗色主题；薄 workflow 层审计打点，`workflowType: ADMIN_CREDENTIAL_MGMT`） — **VARA**：TIR Rulebook III.A Authentication — 凭证生命周期管理，泄露时必须能即时重置 ✅ 2026-05-06
- [x] Admin MFA Reset（CISO/TECH_OFFICER 在后台发起 `POST /admin/iam/users/:id/reset-mfa`；RBAC 权限 `IAM_CREDENTIAL_RESET`；重置后目标用户重走首登四步流程；薄 workflow 层审计打点，`workflowType: ADMIN_CREDENTIAL_MGMT`；无审批门） — **VARA**：TIR Rulebook III.A Authentication — MFA 是管理访问的强制要求，设备丢失时必须有受控恢复路径 ✅ 2026-05-06
- [x] Role Definition CRUD（自定义创建角色 / 修改角色权限集；3-Layer 架构：薄审批处理器 + 工作流编排器 + 领域服务；Action Bucket Catalog 提供用户可理解的能力抽象——4 域 13 bucket（Auth 1 forcedOn + IAM 6 + Approval Center 3 含 1 restricted CISO-only + Audit Center 3）；前端 Create/Modify Modal bucket 勾选式权限组装；手动审计录入 API 已移除——日志仅限系统写入） — **业务必须**：组织扩大后需自定义角色；上线后无 SUPER_ADMIN，优先级高 ✅ 2026-05-10
- [x] Audit Evidence Export（审计证据包导出审批；已完成 3-Layer 架构重构：薄审批处理器 + 工作流编排器 + 领域服务，路由迁移至 `/admin/audit/evidence-packages`） — **VARA**：CRM Rulebook III.A Record Keeping — 审计记录必须可导出可验证，保留不少于 8 年 ✅ 2026-05-05
- [x] Approval Policy Management（审批策略管理：V1 白名单过滤展示 6 种审批类型；**多步骤审批链配置**：`stepsConfig` JSON 列取代扁平 `checkerRoles`，每步支持多角色 OR 关系（任一角色可审批该步）；回退链 stepsConfig→checkerRoles→DEFAULT；修改需走 APPROVAL_POLICY_CHANGE 审批（CISO 审批通过后自动 upsert 生效）；APPROVAL_POLICY_CHANGE 自身 checker 硬编码不可修改；3-Layer 架构：Domain Service + 薄审批处理器 + 工作流编排器；前端步骤编辑器含 Add/Remove Step + 角色切换 + current→proposed 步骤对比；修复 5 个 BLOCKER：approve/reject 步骤跳跃、resolveDecisionRole 角色范围、cancel/expire 硬编码 stepNo:1；含 backfill 迁移脚本；workflowType: APPROVAL_POLICY） — **VARA + 业务**：CRM Rulebook II.B Internal Controls + Company Rulebook III Governance — 审批链本身的治理必须自洽且防篡改 ✅ 2026-05-07

> \#5/6/7 共享 `workflowType: ADMIN_CREDENTIAL_MGMT`。

### ADVANCED（8 workflows）

- [ ] Admin Account Deletion（管理员账号删除审批） — **VARA**：TIR Rulebook III.B.2 Access Control + Company Rulebook Offboarding — 离职人员必须完全撤销访问，Suspension 只是临时措施
- [ ] Audit Evidence Package Deletion（证据包删除审批） — **业务必须**：证据包生命周期管理，保留期满后需受控删除
- [ ] Emergency Break-Glass（紧急权限绕过：请求 → 增强验证 → 时限 elevated access → 自动收回 → 事后 review） — **VARA**：TIR Rulebook V.A Business Continuity — 紧急情况下维持关键系统操作能力；上线后无 SUPER_ADMIN，优先级高
- [ ] Approval 超时预警 / 通知（到期前 N 小时通知审批人；仍无响应则升级到上级角色） — **业务必须**：防止审批静默过期导致业务卡死
- [ ] Periodic Access Review（权限快照导出 + 标记休眠账号 / 过度权限 / SoD 违规；CISO 季度审查签字用） — **VARA**：TIR Rulebook III.B.4 Access Control — 定期审查"谁有什么权限"，VARA 审计必查项
- [ ] API Key Emergency Rotation（外部集成密钥泄露时紧急轮换：撤销 → 生成新 key → 更新配置 → 验证连通性；`workflowType: SYSTEM_CREDENTIAL_MGMT`） — **VARA + 业务**：TIR Rulebook Schedule 1 Cryptographic Key Governance — 密钥泄露时必须能立即轮换
- [ ] API Key Scheduled Rotation（非紧急定期轮换，如 90 天周期，cron 触发，同上机制） — **VARA**：TIR Rulebook Schedule 1 — 密钥定期轮换策略
- [ ] Audit Log Archival（过期日志迁移冷存储：压缩 → 迁移 → 完整性验证 → 清理热存储） — **VARA**：CRM Rulebook III.A Record Keeping — 8 年保留期的长期存储落地方案

### Supporting Features（非 workflow，无独立状态机）

- **Audit event write** — 每次状态变更 append-only 写入审计日志（MVP）
- **Audit log query & trace** — 按 subjectNo / actorNo / traceId / 时间范围检索（MVP）
- **Approval engine (maker-checker)** — 审批引擎核心：pending → approved / rejected；被其他 workflow 调用，非独立业务流程（MVP）
- **Permission check (authz)** — 每次 API 调用运行时权限校验（MVP）
- **SoD rule config** — 角色互斥表硬编码常量 + Admin UI SoD Rules tab（MVP）
- **Notification send** — 事件驱动通知服务，邮件 + webhook（MVP）
- **Notification retry** — 发送失败 3 次退避重试（MVP）
- **审计 SubjectNo 移除** — 移除 `audit_log_subject_nos` 关联表及 SubjectNo 逻辑，简化审计模型；审批处理器 `hasDedicatedAuditService` 简化 ✅ 2026-05-19
- **Approval delegation config** — 审批人预配置委托人（ADVANCED）
- **Login anomaly detection** — 异常登录监控告警（ADVANCED）

---

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

> 客户资产对账：内部 TB 记录与外部（银行 / HexTrust 托管 / 链上）数据的核对与差异处置。设计基于两个前提：① Gas 费用全部由公司钱包承担，客户资产不因 Gas 产生差异；② TB 双式记账结构保证客户资产与负债内部持平，无需内部一致性检查。对账因此退化为单一外部核对。
>
> **模型重设计（2026-06-20）**：上述"退化为单一外部核对"经一轮 Socratic 推导重构为 **credit-net 五公式**（贷正借负、同币种 Σ=0）——式1 总账恒等 / 式2 客户块↔OPEN Outstanding / 式3 桥块↔未清桥 swap / 式4 客户账外 / 式5 公司账外（式1-3 账内、式4-5 账外扣在途）。取代早先 I1-I5；全程按 **币种 × 客户/公司(book)** 分层。外部接入归一化为两表 `external_balances`(头) + `external_statement_lines`(行)。详见 `superpowers/specs/2026-06-20-reconciliation-redesign-design.md` + `2026-06-20-external-balances-pages-and-statement-retire.md`。
>
> **再次重设计（2026-06-25/26，实时 1:1 资金模型后）**：随 V4/V5/V6 完成 **实时 1:1 镜像账本** 重构（8 码新 COA：CLIENT_ASSET/FIRM_ASSET + CLIENT_PAYABLE/DEPOSIT_SUSPENSE + FIRM_OPS/SET/FEE/LIQ；删除 Outstanding/FeeAccrual/SettlementBatch/L.TRADE_CLEARING），**credit-net 五公式失去前提**（式2 客户块↔Outstanding、式3 桥块↔swap bridge 引用的实体均已不存在）。Phase B 改为 **按物理钱包 1:1 外部对账**：①(SUSPENSE[c]+PAYABLE[c]) 1:1 镜像一个客户钱包、外部余额 1:1 直比（不分层）；② AccountFlow 投影 + `walletRef`/`externalRef`/`isExternalCrossing` 三字段，跨钱包一笔转账两端同 ref 互证；③ 内部 reclass（SUSPENSE→PAYABLE）排除流水匹配。详见 `superpowers/specs/2026-06-26-phase-b-reconciliation-design.md` + plans/2026-06-26-phase-b-reconciliation-plan.md（10 任务，subagent-driven）。credit-net 五公式引擎本期 **neuter，不删**（Phase C 统一清死码）。

**前置：** V4 / V5 / V6 / V7（依赖完整交易与持仓数据）

**Workflow 清单：**

核心工作流（MVP）：
- [~] 每日法币对账工作流（Cron EOD 后触发 → 对比 Client Money Account TB 余额与银行对账单余额，按法币币种独立核对 → 自动识别已知时序差异：已记入 TB 但银行尚未到账的出金指令、银行已到账但 Payin 匹配尚未完成的入金 → 净差异 > 0 触发差异处理工作流） — 🔶 **自动检测已交付**（credit-net 五公式 + 四桶匹配，按币种×客户/公司分层，见下「已交付实现」）；止于 Case OPEN，平账/人工核实 deferred
- [~] 每日虚拟币对账工作流（Cron EOD 后触发 → 按币种核对：Sum(customer_[CCY] TB 账户) + KYT_pending余额 + outbound_in_transit余额 = HexTrust 客户托管钱包余额 → 自动从系统状态查出已知时序差异：KYT / Travel Rule 审查中尚未记入客户 TB 的链上到账、客户 TB 已扣除但仍在 Client Outbound Wallet 的出金 → 净差异 > 0 触发差异处理工作流） — 🔶 **自动检测已交付**（同上，crypto 侧式4/式5）；止于 Case OPEN
- [~] 差异处理工作流（触发：任一对账工作流净差异 > 0 → 创建 ReconciliationCaseNo → 自动拉取当日流水逐笔比对定位根因 → 分配 Finance 人工核实 → 补录 / 联系 HexTrust / 联系银行 → RESOLVED + 完整审计记录；24h 内升级 MLRO + CFO，符合 VARA 差异上报要求） — 🔶 **Case + 四桶 line item 下钻已交付**（admin 可视，case 详情 book-aware）；Finance 人工核实/补录/RESOLVED + SLA 升级 deferred
- [ ] **偿付义务工作流（从 V7 移入，决策 2026-06-03）** — 统一拥有 `ReimbursementObligation` 实体 + 独立状态机（OPEN→PENDING_APPROVAL→APPROVED→REIMBURSED/REJECTED）+ 审批门（CFO/MLRO）。**两类触发源共用同一出口**：① 对账差异处理判定公司确实欠/被欠（主要来源，detective）；② event-driven 失败（提现终态失败退回、法币银行 bounce 追偿，known 子集）。结清走 funds-layer 通用内部转账（资金侧）+ TB 记账（客户债权侧 CLIENT_PAYABLE 补回）。⚠️ **redesign 中 `ReimbursementObligation` 表已 drop、仅留 hook（TODO 复活）**——deferred。

**已交付实现（2026-06-20/21, branch；模型重设计落地，领先 main 未合）：**

- [x] **credit-net 五公式引擎** — `credit-net.service`(÷10^dec 缩放) + `formula-checker`(5 纯函数) + `subledger-inputs`；按币种×客户/公司(book) 分层；jest 绿 ✅ 2026-06-20
- [x] **假对账单生成器（`recon:gen`）** — 以真实 payin/payout/internal_fund 为基底合成 Zand(AED)+HexTrust(USDT) 外部数据，写归一化两表 `external_balances`(头) + `external_statement_lines`(行)；FIRM 枚举真实 `F_*` 钱包补齐、closing 锚 `FIRM_TREASURY` TB（式5 干净对平）✅ 2026-06-20
- [x] **内部腿投影 + 四桶匹配** — `leg-projection`(terminal-only, 法币滚 CMA) + `match-engine-v2`(匹配键不含金额 + VIBAN 回退 + 池化等额) + `anomaly-classifier`(PASS / AMOUNT_MISMATCH / ORPHAN_INTERNAL / ORPHAN_EXTERNAL) ✅ 2026-06-20
- [x] **Run / Case admin 页** — 列表+详情按币种×客户/公司分层；run 详情**健康记分牌**（verdict 条 + scope×币种矩阵 + 点格下钻→case）；case 详情 book-aware（式4/式5 off-book + 桶下钻）✅ 2026-06-20
- [x] **External Balances 父子页（外部数据 #4/#5）** — 一页 list 按 book 分区 + 每区 closing 小计（=式4/式5 外部侧）；detail = roll-forward 自检（opening+Σnet=closing）+ 流水行表（VIBAN sub-account）+ raw 行内展开；路由用 statementId 业务键 ✅ 2026-06-21
- [x] **旧 External Statements 全退役** — drop `reconciliation_external_statements` blob 表（migration）+ 连带删死页 / endpoint / file adapter / 旧 demo；原始报文改走 `line.raw` + statementId + 审计 ✅ 2026-06-21

**已交付实现（2026-06-25/26，已合 main，funds-realtime-1to1 分支）：**

- [x] **Phase A · 实时 1:1 资金核心** — 8 码新 COA + 充值/提现/兑换 三流改为实时记账（删 Outstanding/FeeAccrual/SettlementBatch）；e2e 充值/提现/swap 全 SUCCESS、verify:coa 四式 ALL PASS ✅ 2026-06-25
- [x] **swap 4-腿 InternalFund 编排** — 不再原子瞬态 SUCCESS：swap 自持 4 个 InternalFund 腿（swapTransactionId+legSeq，不走 InternalTransaction/白名单）+ 每腿两阶段记账（pending→post / void）+ admin `POST /admin/swap-transactions/:swapNo/legs/:legSeq/advance` 手动逐腿推进 + 失败 `POST .../:swapNo/reverse` 冲正 ✅ 2026-06-25
- [x] **InternalFund 详情可逐腿 simulate**（swap 腿点击落地到 advance 端点；含所属 Swap/Withdrawal 跳转、状态机感知按钮集）✅ 2026-06-26
- [x] **提现资金单重设计** — 删 C_MAIN→C_OUT FUND_OUT 跟踪单；一笔提现 = 1 Payout(本金) + 1 InternalFund(手续费)；fee fund 在 PAYOUT_PENDING 创建（compliance/approval 被拒不产生）；订单详情统一 Linked Funds Orders（提现=payout+fee/充值=payin/swap=4 腿）✅ 2026-06-26
- [x] **Account Statement 多账户化 + 资产符号修复** — 改为 master-detail（左所有 TB 账户 + 过滤 / 右单账户流水），按 COA 类别取号（资产 = debits − credits，L/E = credits − debits），LedgerAccountDetail 加"View Statement (流水)"深链接 ✅ 2026-06-26
- [x] **Phase B 对账设计 + 实施计划落盘** — `superpowers/specs/2026-06-26-phase-b-reconciliation-design.md` + `plans/2026-06-26-phase-b-reconciliation-plan.md`（10 任务）✅ 2026-06-26（**实施未开工**）

推后交付：
- [ ] 季度 Proof of Reserves 工作流（从 HexTrust 获取所有客户托管钱包地址 → 链上快照验证余额 → 生成 Sum(client liabilities) ≤ Reserve Assets 证明，按币种出具 → 提交 VARA 季度报告；早期可手动执行，进阶后自动化）
- [ ] 对账报告导出工作流（按日期范围生成对账摘要：余额差异、流水匹配率、未解决 Case 数；VARA 审计 / 半年独立审计的输入材料）
- [ ] LP 仓位对账工作流（与 LP 对手方核对 LP-IN / LP-OUT 历史记录及当前余额；依赖 LP 提供 API 或对账文件，格式待定）

**下一步（Phase B 实施，spec/plan 已落盘）：**
- [x] **T1-T3 流水基建** — `AccountFlow` 投影表（2 行/transfer）+ `walletRef`/`externalRef`/`isExternalCrossing` 三字段 + 充值/提现/swap/手续费四条流程逐腿供给 ✅（先于 Round3，Phase B 早期任务）
- [x] **T4 Account Statement by-wallet 视图** — 按 walletRef 合并客户/公司钱包流水，全量/链上对账双视图 ✅（先于 Round3）
- [x] **T5-T7 引擎重写** — `WalletReconRunService` + `WalletBalanceCheckerService` + `WalletFlowMatcherService`（v2）逐钱包 1:1 余额对账 + 流水匹配 + Run 编排 ✅（先于 Round3，Phase B 早期任务）
- [x] **T8 recon:demo 重写** — 见下方「Round3 已交付」，anchor-free pass/break + manifest 答案键（Round3 扩展为 9 场景）✅ 2026-07-03
- [x] **T9 旧 V8 引擎 neuter → 物理删** — 见下方「Round3 已交付」Phase C 死码清扫 ✅ 2026-07-03

**已交付实现（2026-07-03，Round3，分支 `feat/recon-round3-cockpit`，11 任务全部 subagent-driven 双审通过）：**

- [x] **在途识别（匹配器第三轮）** — `WalletFlowMatcherService` 新增 Pass 3：前两轮剩余孤儿外部行 ↔ `FundsOrderService.findNonTerminalByWallet`（非终态资金单）配对，单号精确优先、金额+方向+72h 兜底；产出 `inTransit[]` 桶，line item 落 `matchStatus='IN_TRANSIT'` 并挂 `fundsOrderNo` ✅
- [x] **五桶纯函数分类器** — `bucket-classifier.ts::computeBucket`：残差(delta−在途签名和)≠0→BREAK；残差=0且有在途→IN_TRANSIT；残差=0且流水异常→SOFT_FLAG；否则 MATCHED；命中即止，180 组穷举网格验证互斥恒等式 ✅
- [x] **run 快照持久化** — 新表 `reconciliation_run_wallets`（run 完成时每钱包定格一行：四桶归属/内外余额/差额/在途金额/流水计数/caseNo），根治"run 详情页历史数字会漂移"的既有 bug；`reconciliation_runs` 加五桶+三元组计数列 ✅
- [x] **case 每钱包唯一 OPEN（跨日）** — upsert 探测键/auto-heal 均去掉 `businessDate` 限定，一个钱包同一时刻只有一个 OPEN case、可跨多个 run 复用；`reconciliation_cases` 加 `bucket` 列 ✅
- [x] **无主外部账户不再静默跳过** — `walletRef=null` 的外部余额头直接开 BREAK case（`caseReason='unattributed_external_account'`），同样落快照行 ✅
- [x] **对账模块审计起步** — case 开单/auto-heal/run 完成三处接入 `AuditLogsService.recordSystem`（DI，`AuditActions.RECON_CASE_OPENED`/`SYSTEM_RECON_CASE_AUTO_HEALED`/`SYSTEM_RECON_RUN_COMPLETED`），此前模块零审计覆盖 ✅
- [x] **Run 详情页驾驶舱改版** — 结论条 + 「本次体检」五桶点击过滤 + 「工单流转」三元组点击跳转 + 快照明细表（10 列，含在途/Case 深链），legacy run（无快照）显示占位文案 ✅
- [x] **Case 详情页改版** — 桶徽章 + 「差额解释」五格（内部/外部/Δ/在途解释/未解释残差）+ 「观察历史」横条（首见→复观察→关闭/老化）+ 流水单表混排（四类型徽章+严重度排序+IN_TRANSIT 行资金单只读深链+MATCHED 默认折叠）✅
- [x] **Phase C 死码清扫** — 物理删除旧 credit-net 五公式引擎 11 文件（balance-snapshot/subledger-inputs/in-transit/balance-recon/match-engine(+v2)/classifier/anomaly-classifier/internal-actions/leg-projection/drilldown-match）+ 兼容垫片 `FundsOrderSourceRepo` + `adapters/`（mock-external/external-data-provider）+ 4 个孤儿常量 + 4 条 RBAC 死路由，共 −2401 行；清单先行逐项验引用，独立 worktree 隔离复核零误删 ✅
- [x] **recon:demo 九场景重写** — manifest v2 + 9 个 MVP 平账根因场景注入（在途时序差/手续费差额/对账单缺行/精度错/银行杂费+利息对冲/充值漏监听/银行退汇/孤儿充值），场景1 造真实非终态 FundsOrder（不触发 TB 记账），场景5+7 同 FIRM 钱包对冲制造 soft-flag；两条恒等式自验；9/9 DETECTED + 恒等式 OK ✅
- [x] **推单交互方案存档（下期用）** — case 在途行"去处理"→资金单详情页两阶梯按钮（同步状态/幂等安全 vs 人工确认/强推+强制证据+审计），设计定稿写入 spec §8，本期未实现

设计文档：`superpowers/specs/2026-07-03-recon-cockpit-round3-design.md` + `superpowers/plans/2026-07-03-recon-cockpit-round3-plan.md`。

**redesign 遗留（technical debt）：**
- [x] ~~旧 I1-I5 + credit-net 五公式引擎退役~~ → Round3 Phase C 已物理删除 ✅ 2026-07-03
- [ ] FIRM "Treasury position snapshot" 余额标记行误入交易下钻（Phase B 重设计后此 case 不再产生，但旧 Run 历史数据残留，未清）
- [x] ~~case line item 跨 run 累积去重~~ → Round3 已解决（跨日唯一 OPEN + delete-then-insert 覆盖）✅ 2026-07-03
- [ ] **资本注入流水补写** — FIRM_ASSET 流水缺资本那笔的 evidence 行（小修，独立事项）
- [ ] **资金单合并可行性评估** — payin/payout/internalfund 状态机近乎同构，可合表合服务；Phase C 决策，未做
- [ ] **`case.observation.reObservedCount` 恒为 0** — T5 的 line items 是 delete-then-insert（每次 run 清空重写），`foundByRunId` 只剩最近一次 run 的值，distinct 数恒为 1；正确修法需 `ReconciliationCase` 加专用计数列（`upsertCaseForWallet` 的 existing 分支 +1）或改变 line item 累积策略；代码内已加 KNOWN LIMITATION 注释（`reconciliation-query.service.ts`），Round3 未修（超出改造范围）
- [ ] **`admin-web/src/rbac/permissions.ts` 孤儿权限常量** — `OUTSTANDINGS_READ`/`OUTSTANDING_DETAIL_READ`/`FEE_ACCRUALS_READ`/`FEE_ACCRUAL_DETAIL_READ` 对应后端路由已随 Phase C 删除，前端常量未同步清理（Round3 范围限定 backend-only，pre-existing debt）
- [~] **推单/补单/冲正/豁免/偿付等平账处置动作** — 7 原子动作字典脑暴定稿；**动作①推单（push-order）已交付**（分支 `settle-opt`，见下方「推单处置动作」）；其余 6 动作（补单/冲正/冲销/豁免/偿付/…）留待后续轮次
- [~] **effective date（结算日期字段）** — 准备字段已交付（双表双写 + 引擎等价保真切换 + `recon:rerun` 工具，见下方「effectiveDate 平账准备字段」）；处置侧回填口子留待平账期

**effectiveDate 平账准备字段（2026-07-03，分支 `feat/recon-round3-cockpit`，4 任务）：**

- [x] **双表加列 + 存量回填** — `tb_transfer_evidence` / `account_flows` 各加 `effectiveDate`（生效日/结算日）列；迁移把存量行回填为 `date(createdAt)`，满足 `effectiveDate == date(createdAt)` 不变式，保证切换前后逐笔等价 ✅
- [x] **写入侧打生效日** — `writeEvidence` 唯一写入漏斗打 `effectiveDate`，投影器复制到 `account_flows`，新流水默认生效日=写入日 ✅
- [x] **引擎等价保真切换** — 3 处读取点（balance-checker / flow-matcher / query）从 `createdAt ≤ cutoff` 换成复合过滤式 `effectiveCutoffFilter`：生效日<截止日全进（回填的账落这段）、生效日=截止日仍按物理时刻卡（保持现行为逐笔等价）✅
- [x] **`recon:rerun` 离线重跑工具** — `scripts/recon-rerun.ts` 不经 HTTP/登录直接触发一次 per-wallet 对账 run，平账回填后重跑验证用；env 锁定 main 栈（`npm run recon:rerun`，可加 `--cutoff=`）✅
- 金闸门：九场景 pre/post 判定行逐字一致（18 行零差异，等价保真已证）；回填吸收 e2e：给一个 BREAK 钱包注入「生效日=昨天、createdAt=现在」的补账，delta 79200000→0、桶 BREAK→SOFT_FLAG（余额差被昨天生效的补账全额吸收，残留流水孤儿落 SOFT_FLAG 属预期），删数据后复原回 BREAK ✅
- 处置侧回填口子（operator 手动补账 UI/动作）留待平账期，与推单/补单/冲正等处置动作同期实现。

设计文档：`superpowers/specs/2026-07-03-effective-date-prep-design.md` + `superpowers/plans/2026-07-03-effective-date-prep-plan.md`。

**推单处置动作（push-order，2026-07-03，分支 `settle-opt`，5 任务）— 7 平账处置动作的第 1 个：**

- [x] **两腿推进编排** — `PushOrderService`：同步腿（机器查已摄入外部对账单行找唯一回执）+ 人工腿（operator 强推·三件套证据），复用同一条状态机 advance 路径（`FundsOrderService.advance`，逐步 SUBMITTED→…→CLEARED，不跳步不造新迁移）；铁律不破——推单不直写 TB，全经状态机事件链记账 ✅
- [x] **回填生效日透传链（三层）** — 回填值经 状态机 advance → 工作流监听器 → `AccountingService.executeTransfer`（`EvidenceParams.effectiveDate`）→ `writeEvidence`/`enrichForPost` 流到库；三处记账入口全补 `effectiveDate?`（不传=写当天，默认零变化）✅
- [x] **同步唯一回执匹配（两档严格度）** — tier-1 参考号三字段 `[txHash,referenceNo,providerTxnId]` membership（对齐对账 matcher `refsOf`）；tier-2 钱包+方向+金额+时间窗要素精配；恰好 1 条才 HIT，0/多条降级人工，同步永不猜 ✅
- [x] **双端点 + 审计 + RBAC** — `POST /admin/funds-orders/:no/push/sync` + `…/push/manual`；审计 `RECON_PUSH_ORDER_SYNCED`/`RECON_PUSH_ORDER_MANUAL`（DI，`AuditActions` 字典，人工腿带 `manualConfirm`+三件套）✅
- [x] **前端两按钮 + 徽记 + 一键重对账** — 资金单详情页侧栏 Actions 同步/人工两按钮（与 ⚡模拟面板分区）；case 在途行"已推进·待重对账"派生徽记（`kase.status===OPEN && fundsOrderStatus===CLEARED`，零新增存储）；case/run 页"重新对账"按钮打 `POST /admin/reconciliation/runs/wallet {cutoff:now}` ✅
- 金闸门：`recon:demo` 九场景 pre/post 结论行逐字一致（`GOLDEN_GATE_OK`，检测侧零回归）；tsc 0 / jest 净新增失败 0。
- e2e：同步腿（effectiveDate=昨天回填、审计三段）、人工腿（CLEARED+审计三件套+manualConfirm）、失败路径（0 候选/未来日/早于创建日均 400 且状态不变）、重对账端点均 curl+sqlite 实证 ✅
- **⚠️ 合成 demo 数据 heal 边界（诚实记录）**：`recon:demo` 场景1 在途单挂在已 SUCCESS deposit 上、本身无待记账链（demo 设计不触发 TB 记账），故推单驱到 CLEARED 不产生新记账、重对账时桶 IN_TRANSIT→BREAK 而非 delta→0/AUTO_HEALED；DB 内 deposit/withdraw 全已 SUCCESS 无未记账真实单可挂，Option A 在本 demo 数据上不可低成本达成。"回填→记账→对账吸收 delta 归 0"完整闭环由 effectiveDate 准备字段 e2e 已单独证过（上条）；推单侧证到"回填生效日经漏斗盖进记账"这一环，最后"记账吸收"依赖真实首次记账。前端点击流因本环境浏览器不可达改以数据契约头验替代（getCase 徽记字段 + 重对账端点均实证）。详见 spec §7.1。

设计文档：`superpowers/specs/2026-07-03-push-order-disposition-design.md` + `superpowers/plans/2026-07-03-push-order-disposition-plan.md`。

---

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
