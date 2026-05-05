# Product Roadmap

Last Updated: 2026-05-05
格式：每个版本交付一组 workflow，✅ = 已交付验收，[ ] = 待实现。

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
V6 → V7（EOD 兑换结算触发 INTERNAL-IN/OUT 真实资产交割；LP 缺口补充亦由此触发）
```

---

## V1 — 审计底座

> 建立平台治理基础：审计日志、审批引擎、admin 生命周期管理、角色管理、凭证安全。所有后续版本的操作可信性依赖本版本。
> 注意：SUPER_ADMIN 是演示角色，正式上线后系统中不存在该角色。

### MVP（10 workflows）

- [x] Admin Invite（管理员入职审批，含 SoD 冲突校验；审批通过后管理员点击邀请链接设置密码完成账号激活） — **业务必须**：管理员入职的标准化流程，没有邀请流程就没法加人 ✅ 2026-05-05
- [ ] Admin First Login（首次登录仪式：身份确认 → 强制 MFA 绑定 → 绑定验证 → 安全须知确认 → 登录完成；无审批门，但有完整状态机和审计打点） — **VARA**：TIR Rulebook III.A Authentication — MFA 是管理访问的强制要求，首次绑定必须有受控流程和审计证据
- [x] Admin Role Binding Change（角色变更审批，含 SoD 冲突校验 + SoD Rules tab；已完成 3-Layer 架构：薄审批处理器 + 工作流编排器 + 领域服务，路由 `/admin/iam/role-change-requests`，旧 Change Ticket 路径已清理） — **VARA**：TIR Rulebook III.B Access Control — RBAC 治理 + 最小权限原则 + 职责分离 ✅ 2026-05-05
- [x] Admin Account Suspension（账号停用审批；执行时 JWT Strategy 校验拦截 SUSPENDED 用户。**生产环境需改造为 token blacklist 方案实现即时 session 撤销**） ✅ 2026-05-05
- [ ] Admin Account Reactivation（账号恢复审批） — **业务必须**：Suspension 的配对恢复路径，没有它则停用等于永久删除
- [ ] Admin Password Reset（自助 + CISO 代操作；薄 workflow 层审计打点，`workflowType: ADMIN_CREDENTIAL_MGMT`） — **VARA**：TIR Rulebook III.A Authentication — 凭证生命周期管理，泄露时必须能即时重置
- [ ] Admin MFA Reset（CISO 在后台发起；薄 workflow 层审计打点，同上 workflowType） — **VARA**：TIR Rulebook III.A Authentication — MFA 是管理访问的强制要求，设备丢失时必须有受控恢复路径
- [ ] Admin Session Force-Revocation（独立于 Suspension：只杀 session 不停用账号；需 JWT 撤销能力改造；薄 workflow 层审计打点，同上 workflowType） — **VARA**：TIR Rulebook III.C Session Management + IV.C Incident Response — 凭证泄露疑似但不确定需要停用时，立即终止所有活跃会话
- [x] Audit Evidence Export（审计证据包导出审批；已完成 3-Layer 架构重构：薄审批处理器 + 工作流编排器 + 领域服务，路由迁移至 `/admin/audit/evidence-packages`） — **VARA**：CRM Rulebook III.A Record Keeping — 审计记录必须可导出可验证，保留不少于 8 年 ✅ 2026-05-05
- [ ] Approval Policy Management（审批策略管理：展示所有审批类型各 step 的 checker 角色配置；修改 checker 配置需走 `APPROVAL_POLICY_CHANGE` 审批类型；该类型自身的 checker 硬编码不可通过平台修改，仅代码部署可变更；谁能发起修改由 RBAC 角色权限控制，不在此处约束） — **VARA + 业务**：CRM Rulebook II.B Internal Controls + Company Rulebook III Governance — 审批链本身的治理必须自洽且防篡改

> \#5/6/7 共享 `workflowType: ADMIN_CREDENTIAL_MGMT`。#7 需要 JWT 撤销能力改造（token blacklist 或 session store）。

### ADVANCED（9 workflows）

- [ ] Admin Account Deletion（管理员账号删除审批） — **VARA**：TIR Rulebook III.B.2 Access Control + Company Rulebook Offboarding — 离职人员必须完全撤销访问，Suspension 只是临时措施
- [ ] Audit Evidence Package Deletion（证据包删除审批） — **业务必须**：证据包生命周期管理，保留期满后需受控删除
- [ ] Role Definition CRUD（自定义创建角色 / 修改角色权限集） — **业务必须**：组织扩大后需自定义角色；上线后无 SUPER_ADMIN，优先级高
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
- **Approval delegation config** — 审批人预配置委托人（ADVANCED）
- **Login anomaly detection** — 异常登录监控告警（ADVANCED）

---

## V2 — 客户管理 + 合规底座

> 建立客户准入与合规管理体系：客户入驻、风险评估、材料管理、限额升级、账号冻结管控。Sumsub 负责自动化验证与持续监控，EDD 调查在平台内部由 MLRO 执行。V4–V6 交易资格门依赖本版本。
> MVP 阶段仅服务 Qualified Individual 客户；机构客户（Corporate/Institutional）所有工作流列入 ADVANCED。
> 客户身上有两个独立状态轴：Customer Level（Level 1/2，产品层，决定限额）和 Risk Rating（HIGH/MED/LOW，合规层，决定监控强度）。限额只和 Level 挂钩；EDD 独立于 Level，由 Risk = HIGH 触发。

### MVP（6 workflows）

- [ ] Sumsub Webhook 翻译层（基础设施，非 workflow；接收 Sumsub webhook → 翻译成内部事件广播，V2 所有合规结果的前置） — **业务必须**：没有翻译层，平台无法接收任何 Sumsub 验证结果和监控告警
- [ ] 客户 Onboarding（CDD 全套：ID + 自拍 + 地址证明 + 风险问卷 + PEP/制裁筛查 → 通过即 Level 1 开户） — **VARA**：CRM Rulebook II.A Customer Due Diligence — 客户准入强制尽职调查
- [ ] CRA Review（客户风险评估与定期重审；三种触发：① cron 按风险等级定期触发完整 re-KYC ② Sumsub ongoing monitoring alert ③ MLRO 手动；Risk = HIGH 时启动 EDD 调查分支——MLRO 在平台内部收集 SOW/SOF 并人工审查决策） — **VARA**：CRM Rulebook II.C Risk-Based Approach + III.B Enhanced Due Diligence — AML 风险持续评估与高风险客户深度调查义务
- [ ] Material Refresh（材料过期补充：NUDGE → URGENT → BLOCKING → RESOLVED） — **VARA**：CRM Rulebook II.A.3 Ongoing CDD — 客户身份材料必须保持有效
- [ ] Tier Upgrade（限额升级：客户申请 → 提交收入/流水证明 → Sumsub 增强验证 → MLRO + SMO 审批门 → Level 2 高限额） — **业务必须**：客户需要更高交易限额的标准化升级路径
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

> 建立新记账架构底座：TigerBeetle 账户模型、客户金融账户开通、充提地址管理。V4–V7 所有记账操作的硬前置依赖。

**客户账户与地址：**

- [ ] 补充 Onboarding 工作流：客户入驻成功后给客户开 TigerBeetle Account
- [ ] 客户创建提现虚拟币地址（含安全冷却：地址创建后进入 PENDING_ACTIVATION 状态，24–48h 冷却期满后变 ACTIVE 方可提现；冷却期内发送通知，客户可取消）
- [ ] 客户创建提现银行账户（同上冷却机制）
- [ ] 为客户创建虚拟币充值地址，创建对应 TigerBeetle Account
- [ ] 为客户创建银行 VIBAN

**推后交付（非 MVP）：**

- [ ] 客户删除提现虚拟币地址（确认无在途提现 → 冷却期校验 → 地址停用归档）
- [ ] 客户删除提现银行账户（同上）

**资产配置：**

- [ ] 创建新资产时配套开 TigerBeetle Account（系统账户全套）

**非工作流：**

- [ ] 整理所有 Account 类型定义（资产侧 / 负债侧 / 系统级 / 客户级）

---

## V4 — 充值流程

> 定义完整充值工作流：链上/银行到账检测 → Deposit 订单 → KYT 合规审查 → 记账入账，以及所有异常处理路径。

**前置：** V2（客户合规资格）+ V3（账户模型）

**Workflow 清单：**

主流程：
- [ ] 虚拟币充值工作流（链上确认 → Payin 匹配 → Deposit 创建 → 路由判断：小额/自托管钱包直接 KYT → 记账；大额 VASP 来源需先完成 Travel Rule 匹配再 KYT → 记账；内嵌：大额超限锁账户触发 Tier Upgrade、客户暂停时挂起进 Suspense 等恢复事件）
- [ ] 法币充值工作流（VIBAN 到账 → Payin 匹配 → Deposit 创建 → KYT → 记账；内嵌同上）

Travel Rule 接收工作流：
- [ ] Travel Rule 接收匹配工作流（接收 originating VASP 推送的 TR 数据包 → 暂存等待 Payin 到达匹配；或 Payin 先到进入 TRAVEL_RULE_PENDING 等 TR 数据；两者到齐后做 originator 身份筛查 → 通过继续 KYT → 超时未匹配进人工审核）

合规异常工作流：
- [ ] KYT 材料补充工作流（KYT RETRY → applicantActionPending → 客户补资金来源 → Sumsub 复审 → 放行 / 拒绝）
- [ ] 制裁 / 高风险地址冻结审批工作流（命中制裁名单或混币器 → 资金进 Frozen Account → MLRO 审批 → 解冻放行 / 确认没收 / SAR）

法币专属异常工作流：
- [ ] 第三方付款退回工作流（汇款人与客户不符 → 拒绝入账 → 发起银行退款 → 确认完成 → 审计记录）

运营治理工作流：
- [ ] 充值渠道暂停 / 恢复工作流（指定链/token/法币渠道：Maker 提案 + Checker 审批 → 暂停，在途 Payin 处理策略明确；恢复同样需审批门；全程审计）
- [ ] 孤儿充值处理工作流（资金到达无活跃客户的地址 → 进 Suspense → 人工识别归属 → 可恢复客户则补记账 / 无法归属则 MLRO 审批处置：退回 / 没收 / SAR）

不单做工作流（技术处理 / 主流程内嵌）：区块重组自动回退、重复 txHash 幂等去重、ERC-20 合约失败忽略、KYT 超时转人工、TB 记账失败走 repair surface。

---

## V5 — 提现流程

> 定义完整提现工作流：提现申请 → 合规筛查 → Travel Rule（VASP 对手方）→ 大额审批门 → Payout 执行 → 链上/银行确认 → 记账。热钱包预充值假设成立；Cold→Hot 自动归集由 V7 补充。

**前置：** V2 + V3 + V4（余额依赖充值）

**Workflow 清单：**

主流程：
- [ ] 虚拟币提现工作流（余额锁定 → KYT + 地址归属识别 → VASP 目标：发 TR 数据包等 ACK 后广播；自托管目标：客户声明后直接广播 → 链上确认 → 记账；内嵌大额审批门、TRAVEL_RULE_PENDING 状态、热钱包不足显式失败）
- [ ] 法币提现工作流（余额锁定 → 目标账户制裁筛查 → 大额审批门 → 银行转账 → 到账确认 → 记账）

合规异常工作流：
- [ ] 提现 KYT 高风险地址工作流（目标地址高风险 → 提现挂起 → MLRO 审批 → 放行恢复广播 / 拒绝解锁余额）
- [ ] 提现制裁地址拦截工作流（目标地址命中 OFAC/SDN → 强制取消 → 余额解锁 → MLRO 审计确认 → SAR）

链上异常工作流：
- [ ] 链上提现异常处理工作流（stuck/failed tx → 超时后重试加速 / 取消 → 余额解锁退回）

法币异常工作流：
- [ ] 法币退款处理工作流（银行退回 bounced → 余额恢复记账 → 通知客户 → 审计记录）

运营治理工作流：
- [ ] 提现渠道暂停 / 恢复工作流（指定链/token/法币渠道：Maker 提案 + Checker 审批 → 暂停，在途提现处理策略明确；恢复同样需审批门；全程审计）

不单做工作流（技术处理 / 主流程内嵌）：余额不足 / 地址未白名单 / 日限额超出 → 前置校验失败不创建订单；大额审批 → 主流程内审批门；VASP TR 超时 → 主流程内状态转换取消；自托管声明 → 主流程内嵌步骤；热钱包不足（V5 阶段）→ 显式错误码 + repair surface，V7 自动化。

---

## V6 — 兑换流程

> 定价中心（基础设施）、Quote 创建与消费、兑换成交、未达成项创建，以及定价与货币对的治理工作流。

**前置：** V2 + V3

**Workflow 清单：**

主流程：
- [ ] 报价工作流（客户请求 from/to CCY + 金额 → PricingService 计算汇率+手续费 → Quote 创建含 TTL → 客户确认触发成交 / TTL 过期或取消 → EXPIRED/CANCELLED）
- [ ] 兑换成交工作流（Quote ACCEPTED → 前置校验 → 锁定源币余额 → [大额审批门] → TB 记账：source debit / target credit / fee capture / Exchange_Pool 轧差 → 完整执行 COMPLETED / 部分执行创建未达成项 → V7 接手）

配置治理工作流：
- [ ] 定价策略变更工作流（Maker 提案变更点差/手续费率/限额等参数，含新旧值对比 → Checker 审批 → 生效；审计记录完整）
- [ ] 货币对上下线工作流（新增货币对：关联 TB Account + 定价配置 + 审批上线；下线货币对：处理在途 Quote + 配置归档 + 审批）

合规 / 风控工作流：
- [ ] 大额兑换合规审查工作流（Sumsub TM 命中异常模式 → 兑换进入 COMPLIANCE_HOLD → MLRO 审查 → 放行继续记账 / 拒绝解锁余额）
- [ ] 交易暂停 / 恢复工作流（指定货币对或全局暂停：已在途 Quote 强制 EXPIRED → Maker 提案 + Checker 审批；恢复时同样需审批门；全程审计）

异常工作流：
- [ ] 兑换执行失败回滚工作流（TB 记账失败或审批被拒 → 解锁源币余额 → FAILED → 通知客户）

不单做工作流（技术处理 / 主流程内嵌）：余额不足 / 客户暂停 / Tier 限额 → 前置校验失败；Quote TTL 过期 → Cron sweep 标 EXPIRED；大额审批 → 成交工作流内审批门；未达成项创建 → 成交工作流内嵌步骤。

---

## V7 — 内部转账流程

> 平台内部资产物理移动的通用治理工作流。**所有内部转账均为真实的链上交易（虚拟币）或银行指令（法币），不存在纯 TB 内划拨路径。** 所有路径共享同一通用内部转账工作流，差异仅在触发条件、审批门级别和 TB 记账标签。Gas 记账独立于业务记账，链上确认后单独落账。

**前置：** V3 + V6（EOD 结算依赖兑换产生的 PENDING_SETTLEMENT 订单）

---

### 内部转账白名单（全量路径）

所有内部转账必须属于以下预定义白名单对，白名单以外的 from-to 组合立即拒绝，不创建 InternalTransferNo。

| 路径标签 | From | To | 介质 | 触发来源 |
|---|---|---|---|---|
| AGGREGATE | Client Deposit Wallet[n] | Client Main Wallet | 链上 | Cron sweep / 单笔充值超阈值立即触发 |
| FUND-OUT | Client Main Wallet | Client Outbound Wallet | 链上 | 提现工作流（V5）：Payout 广播前预归集至出金钱包 |
| INTERNAL-OUT-VA | Client Main Wallet | Company Liquidity Wallet | 链上 | EOD 结算：客户兑换卖出方向交割 |
| INTERNAL-IN-VA | Company Liquidity Wallet | Client Main Wallet | 链上 | EOD 结算：客户兑换买入方向交割 |
| FEE-COLLECT-VA | Company Liquidity Wallet | Company Ops Wallet | 链上 | Cron 定期归集（虚拟币手续费） |
| LP-OUT-VA | Company Liquidity Wallet | LP Crypto Pool | 链上 | 手动 / 仓位过剩归还 LP |
| LP-IN-VA | LP Crypto Pool | Company Liquidity Wallet | 链上 | EOD 缺口补充 / 手动注入 |
| INTERNAL-OUT-FIAT | Client Money Account | Company Liquidity Account | 银行转账 | EOD 结算：法币兑换交割 |
| INTERNAL-IN-FIAT | Company Liquidity Account | Client Money Account | 银行转账 | EOD 结算：法币兑换交割 |
| FEE-COLLECT-FIAT | Company Liquidity Account | Company Ops Account | 银行转账 | Cron 定期归集（法币手续费） |
| LP-OUT-FIAT | Company Liquidity Account | LP Fiat Pool | 银行转账 | 手动 / 仓位过剩归还 LP |
| LP-IN-FIAT | LP Fiat Pool | Company Liquidity Account | 银行转账 | EOD 缺口补充 / 手动注入 |

---

**Workflow 清单：**

核心工作流（MVP）：
- [ ] 通用内部转账工作流（适用所有白名单路径：创建 InternalTransferNo → 白名单校验 → 按金额 + 路径类型判断审批门 → 发起链上广播 / 银行转账指令 → CONFIRMING / BANK_PROCESSING → 确认到账后：① 业务 TB 记账：source → destination 实际到账金额；② Gas TB 记账（链上路径专属）：实际 Gas 消耗 → Gas_Fee_[CCY]_Pool，独立一笔，与业务记账严格分离；③ 校验：发出量 = 到账量 + Gas，差异超阈值进人工审核 → COMPLETED；链上失败 / 银行退回 → FAILED + repair surface）
- [ ] EOD 兑换结算编排工作流（Cron 日终触发 → ① 汇总当日全部 PENDING_SETTLEMENT 兑换单，按币种对计算净仓位轧差，级联触发 INTERNAL-IN-VA / INTERNAL-OUT-VA / INTERNAL-IN-FIAT / INTERNAL-OUT-FIAT 通用转账实例，各实例 COMPLETED 后标记兑换单 SETTLED；若 Company Liquidity Wallet 余额不足，先触发 LP-IN-VA / LP-IN-FIAT 补充，LP 到账后继续结算剩余缺口；② 充值地址残余清零：扫描所有余额高于 dust 阈值、且无活跃合规冻结的充值地址，对每个地址触发 AGGREGATE 通用转账实例；③ 全部子任务完成后日结完毕；支持幂等重跑：已 SETTLED 的兑换单、已归集的地址跳过）
- [ ] 手续费归集工作流（Cron 定期触发 → 级联触发 FEE-COLLECT-VA / FEE-COLLECT-FIAT 通用转账实例；同一通用工作流执行，审批门按归集金额阈值判断）

推后交付：
- [ ] LP 调拨治理工作流（LP-IN / LP-OUT 路径须独立审批门：Maker 提案 + CFO / MLRO 签批 → 审批通过后触发对应通用转账实例；白名单中其余路径不走此工作流）
- [ ] 内部转账阈值配置变更工作流（Maker 提案修改归集阈值 / 审批金额线 / LP 调拨规则 / dust 阈值 → Checker 审批 → 生效；全程审计）
- [ ] Gas Reserve 补充工作流（Gas Reserve Wallet 余额低于阈值时触发：Maker 提案 + Checker 审批 → 从 Company Ops Wallet 划转对应原生币至 Gas Reserve Wallet → 通用内部转账工作流执行；补充路径加入白名单：`Company Ops Wallet → Gas_Reserve_[CCY]_Wallet`）

不单做工作流（主流程内嵌 / 运维操作）：TRX 质押 / 委托 → HexTrust 运维操作，不进业务工作流；Gas 记账缺失补录 → 专用 repair surface（窄于正常路径，需审计记录）；银行转账退回 → bounced 处理内嵌于通用工作流 FAILED 分支；链上重组 / 超时 → FAILED + repair surface，不自动重广播。

---

## V8 — 对账流程

> 客户资产对账：内部 TB 记录与外部（银行 / HexTrust 托管 / 链上）数据的核对与差异处置。设计基于两个前提：① Gas 费用全部由公司钱包承担，客户资产不因 Gas 产生差异；② TB 双式记账结构保证客户资产与负债内部持平，无需内部一致性检查。对账因此退化为单一外部核对。

**前置：** V4 / V5 / V6 / V7（依赖完整交易与持仓数据）

**Workflow 清单：**

核心工作流（MVP）：
- [ ] 每日法币对账工作流（Cron EOD 后触发 → 对比 Client Money Account TB 余额与银行对账单余额，按法币币种独立核对 → 自动识别已知时序差异：已记入 TB 但银行尚未到账的出金指令、银行已到账但 Payin 匹配尚未完成的入金 → 净差异 > 0 触发差异处理工作流）
- [ ] 每日虚拟币对账工作流（Cron EOD 后触发 → 按币种核对：Sum(customer_[CCY] TB 账户) + KYT_pending余额 + outbound_in_transit余额 = HexTrust 客户托管钱包余额 → 自动从系统状态查出已知时序差异：KYT / Travel Rule 审查中尚未记入客户 TB 的链上到账、客户 TB 已扣除但仍在 Client Outbound Wallet 的出金 → 净差异 > 0 触发差异处理工作流）
- [ ] 差异处理工作流（触发：任一对账工作流净差异 > 0 → 创建 ReconciliationCaseNo → 自动拉取当日流水逐笔比对定位根因 → 分配 Finance 人工核实 → 补录 / 联系 HexTrust / 联系银行 → RESOLVED + 完整审计记录；24h 内升级 MLRO + CFO，符合 VARA 差异上报要求）

推后交付：
- [ ] 季度 Proof of Reserves 工作流（从 HexTrust 获取所有客户托管钱包地址 → 链上快照验证余额 → 生成 Sum(client liabilities) ≤ Reserve Assets 证明，按币种出具 → 提交 VARA 季度报告；早期可手动执行，进阶后自动化）
- [ ] 对账报告导出工作流（按日期范围生成对账摘要：余额差异、流水匹配率、未解决 Case 数；VARA 审计 / 半年独立审计的输入材料）
- [ ] LP 仓位对账工作流（与 LP 对手方核对 LP-IN / LP-OUT 历史记录及当前余额；依赖 LP 提供 API 或对账文件，格式待定）

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
