# Product Roadmap

Last Updated: 2026-06-21
格式：每个版本交付一组 workflow，✅ = 已交付验收，[~] = 部分交付，[ ] = 待实现。

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

> 三个独立基础能力（Asset / Wallet / TB Account）+ 提现地址注册 + 限额配置。三个 primitive 互不依赖，上层编排按需动态组合（如 Asset Listing 通过后触发 Wallet Creation + TB Account Creation）。V4–V7 所有记账操作的硬前置依赖。
> Wallet Creation 是一个 workflow、两个入口（Admin 系统级 + Client 客户级），按 ownerType / walletRole 区分。

### MVP（9 workflows）

- [x] Asset Creation & Activation（资产创建与上线：① 直接创建（无审批门）+ 同事务 TB 系统账户 provisioning → PROVISIONING；② 异步批量创建客户 TB 账户（event-driven + TbAccountBacklog 失败追踪）；③ PROVISIONING 期间可编辑运营字段（限额/开关/合约地址/描述），身份字段锁定；④ 激活走 CISO 审批门 + 就绪检查（TB 账户 + 活跃钱包）→ ACTIVE；⑤ 客户端资产状态守卫：非 ACTIVE 资产不展示、不可创建钱包） — **VARA + 业务**：没有资产定义，V4-V7 全部无法运行 ✅ 2026-05-15
- [x] Custodian Wallet Creation — Crypto（在 HexTrust 创建钱包：Admin 入口创建系统钱包组 MASTER / OUTBOUND / LIQ 等；Client 入口创建客户充值地址；按 ownerType + walletRole 区分） — **业务必须**：V4-V7 充提和内部转账的物理执行依赖 ✅ 2026-05-13
- [x] Custodian Wallet Creation — Fiat（在 ZandBank 创建账户：Admin 入口创建系统账户；Client 入口创建客户 VIBAN；按 ownerType + walletRole 区分） — **业务必须**：V4 法币充值的前置 ✅ 2026-05-13
- [x] Asset Suspension / Reactivation（资产暂停/恢复审批：暂停走 CISO 审批门 + 暂停原因；恢复走 CISO 审批门；各自独立 3-Layer 架构：薄审批处理器 + 工作流编排器 + 领域服务；前端 AssetDetail 侧边栏 Actions 按状态显示对应操作按钮） — **VARA**：TIR Rulebook IV.C Incident Response — 技术故障 / 合规要求 / 链分叉时必须能暂停资产级操作 ✅ 2026-05-15
- [x] Withdrawal Address Registration — Crypto（客户注册提现虚拟币地址：提交地址 → 地址格式 + 网络校验 → PENDING_ACTIVATION → 安全冷却期 24h → 冷却期内客户可取消 → 冷却期满自动 ACTIVE → 方可用于提现；含 skip-cooling 管理员后门；前端完整 UI 含地址管理、详情弹窗、冷却倒计时） — **VARA**：TIR Rulebook III.A Authentication — 安全冷却防止凭证泄露后资产被立即转移 ✅ 2026-05-13
- [x] Withdrawal Address Registration — Bank（客户注册提现银行账户：提交银行账户信息 → PENDING_ACTIVATION → 安全冷却期 → 冷却期满 ACTIVE；含完整银行账户字段（accountName/bankName/iban/bankCode）；前端 UI 与 Crypto 地址共享管理页面） — **VARA**：TIR Rulebook III.A Authentication — 安全冷却防止凭证泄露后资产被立即转移；CRM Rulebook IV.A — 第三方账户禁止 ✅ 2026-05-13
- [x] TB Account Creation（在 TigerBeetle 创建账户：① 系统级 3 账户（BANK/CUSTODY + TRADE_CLEARING + FEE_RECEIVABLE）在资产创建事务中同步 provision；② 客户级 2 账户（CLIENT_PAYABLE + DEPOSIT_SUSPENSE）在 `asset.provisioned` 事件后异步批量创建；TbAccountRegistry 持久化映射；TbAccountBacklog 追踪失败项支持重试；含手动创建 API `POST /admin/tb/accounts`） — **业务必须**：V4-V6 的前置，没有 TB 账户就无法记账 ✅ 2026-05-15
- [x] Transaction Limit Policy Creation（限额策略创建审批：管理员创建新 TransactionLimitPolicy 行（扩展 tradingTier × operationType × period 矩阵）；3-Layer 架构：薄审批处理器 + 工作流编排器 + 领域服务；INSERT PENDING_APPROVAL → MLRO + SMO 两步审批（48h 超时）→ 通过激活 ACTIVE / 拒绝物理 DELETE；tradingTier 支持动态创建（不限预设枚举）；composite unique 约束防重复；policyNo 自增 TLP-NNN；前端 List 页 Create Policy 按钮 + 模态框含"Create New Tier"内联输入） — **VARA + 业务**：CRM Rulebook II.C Risk-Based Approach — 限额矩阵扩展的标准化路径 ✅ 2026-05-16
- [x] Transaction Limit Change（限额策略变更审批：request-record 模式——创建 TransactionLimitChangeRequest 行记录变更生命周期，主 policy 保持 ACTIVE 不变；3-Layer 架构：薄审批处理器 + 工作流编排器 + 领域服务；提交时快照 currentAmount → MLRO + SMO 两步审批（48h 超时）→ 执行时冲突检测（snapshot vs actual，防静默覆盖）→ 通过更新 policy.limitAmount / 拒绝仅标记 request REJECTED；requestNo 自增 TLC-NNN；同一 policy 不可有多个 PENDING 请求（409）；前端 Detail 页 Edit Limit 模态框 POST .../change） — **VARA + 业务**：CRM Rulebook II.C Risk-Based Approach — 限额变更的受控审批路径，含冲突检测防止并发覆盖 ✅ 2026-05-16

### ADVANCED（3 workflows）

- [ ] Asset Delisting（资产下架审批：确认无在途订单 → 客户持仓余额清退路径 → 充值地址停用 → 配置归档 → 审批下架） — **业务必须**：资产上架的配对退出路径
- [ ] Withdrawal Address Deletion — Crypto（客户删除提现虚拟币地址：确认无在途提现 → 地址停用归档） — **业务必须**
- [ ] Withdrawal Address Deletion — Bank（客户删除提现银行账户：确认无在途提现 → 账户停用归档） — **业务必须**

### Supporting Features（非 workflow，无独立状态机）

- **TB Account 类型定义** — 全量定义资产侧 / 负债侧 / 系统级 / 客户级账户类型及 flags ✅ 2026-05-11
- **钱包模型（V3 适配）** — V1 Wallet 模型已有角色体系（DEPOSIT / MASTER / OUTBOUND / LIQ / OPS），需清理适配 V3：去除旧 Journal/Balance 依赖，明确 TB 记账层与物理钱包层的职责分离 ✅ 2026-05-12
- **资产状态守卫** — 钱包创建 API 拒绝非 ACTIVE 资产；客户端所有页面强制 `status=ACTIVE` 过滤 ✅ 2026-05-15
- **资产字段重命名 code→currency** — schema/DTO/service/controller/frontend 全量重命名 `code` → `currency`，新增 compound code 字段（`{currency}-{network}`）作为用户可见主标识 ✅ 2026-05-20
- **资产前端清理** — 移除 contractAddress 字段（admin 创建/编辑表单 + 详情页），清理 dead description 字段 ✅ 2026-05-19

---

## V4 — 充值流程

> 定义完整充值工作流：链上/银行到账检测 → Deposit 订单 → KYT 合规审查 → 记账入账，以及所有异常处理路径。

**前置：** V2（客户合规资格）+ V3（账户模型）

### MVP（2 workflows + 8 sub-flows）

**虚拟币充值工作流** — **VARA + 业务**：CRM Rulebook II.A CDD + TIR Rulebook Schedule 1

- [x] Happy Path：链上广播 → Payin DETECTED → Deposit PAYIN_PENDING → Payin CONFIRMING → Payin CONFIRMED → Deposit COMPLIANCE_PENDING + TB Step 1（CUSTODY→DEPOSIT_SUSPENSE）→ L1 Eligibility 客户合规校验 → L2 Transaction Screen（KYT + Travel Rule）→ 自动审批 → Deposit SUCCESS + TB Step 2（DEPOSIT_SUSPENSE→CLIENT_PAYABLE）→ Payin CLEARED ✅ 2026-05-22
- [ ] 异常分支 — ACTION_PENDING：Sumsub 返回 applicantActionPending → Deposit ACTION_PENDING（客户补材料）→ Sumsub 复审 webhook → approved 回 SUCCESS / rejected 回 REJECTED
- [ ] 异常分支 — FROZEN：制裁命中 → Deposit FROZEN → MLRO 审批门 → 放行回 SUCCESS / 确认没收 CONFISCATED（L1 Eligibility 入口检查已实现 ✅；MLRO 审批门 + 放行/没收路径待实现）
- [ ] 异常分支 — REJECTED：Sumsub rejected → Deposit REJECTED → TB 回退 DEPOSIT_SUSPENSE→CUSTODY
- [ ] 异常分支 — Payin FAILED：链重组 / 交易 drop → Payin FAILED → Deposit FAILED → TB 回退
- [ ] 异常分支 — EXPIRED：ACTION_PENDING 超时 → Deposit EXPIRED → TB 回退 DEPOSIT_SUSPENSE→CUSTODY

> L2 Transaction Screen 合规审查拆分为两个子项：`kytStatus`（PENDING→PASSED/FAILED）+ `travelRuleStatus`（PENDING→PASSED/FAILED/NOT_REQUIRED），两项全部 PASSED 方可自动审批。合规结果通过 Sumsub Webhook 翻译层统一分发。

**法币充值工作流** — **VARA + 业务**：同上

- [x] Happy Path：银行 VIBAN 到账 → Payin DETECTED → Deposit PAYIN_PENDING → Payin CONFIRMED（无 CONFIRMING 阶段）→ Deposit COMPLIANCE_PENDING + TB Step 1（BANK→DEPOSIT_SUSPENSE）→ L1 Eligibility → L2 Transaction Screen（KYT；TR 自动 NOT_REQUIRED）→ 自动审批 → Deposit SUCCESS + TB Step 2（DEPOSIT_SUSPENSE→CLIENT_PAYABLE）→ Payin CLEARED ✅ 2026-05-27
- [ ] 异常分支 — 名义不符（Sender Name Mismatch）：银行到账人名 ≠ 客户注册姓名 → Deposit ACTION_PENDING → 运营人工核实 → 确认同人放行 / 确认第三方拒绝退回
- [ ] 异常分支 — 银行退汇（Bank Return/Bounce）：Payin DETECTED 阶段银行通知资金退回 → Payin FAILED → Deposit FAILED（Step 1 尚未执行，无需 TB 回退）
- [ ] 异常分支 — KYT 失败（AML Flag）：大额现金 / 高风险来源地 / 结构化分拆 → 与虚拟币共享 FROZEN → MLRO 审批路径

> 法币 vs 虚拟币差异：① TB 账户：法币 BANK（code 1），虚拟币 CUSTODY（code 10）；② Payin 状态机：法币无 CONFIRMING 阶段；③ Travel Rule：法币自动 NOT_REQUIRED

### ADVANCED（3 workflows）

- [ ] 充值渠道暂停 / 恢复工作流（指定链/token/法币渠道暂停 + 审批恢复，在途 Payin 处理策略明确） — **业务必须**
- [ ] 孤儿充值处理工作流（资金到达无活跃客户的地址/VIBAN → Suspense → 人工识别归属 → 补记账 / MLRO 审批处置） — **VARA + 业务**：CRM Rulebook III.A
- [ ] 法币 Bank Reversal 工作流（到账后银行冲正 → 客户余额充足自动扣回 / 不足则冻结账户 + 催收） — **业务必须**

### Supporting Features（非 workflow，无独立状态机）

**已完成：**
- **Deposit 事件驱动编排** — Payin 事件 → DepositWorkflowService 自动创建 Deposit 并推进状态机；Deposit 事件 → L1 Eligibility 校验 ✅ 2026-05-22
- **TB 双步记账** — Step 1：BANK/CUSTODY→DEPOSIT_SUSPENSE（按 asset.type 自动选择）；Step 2：DEPOSIT_SUSPENSE→CLIENT_PAYABLE ✅ 2026-05-27
- **KYT/TR 模拟端点** — `POST /admin/sumsub/simulate/kyt-check` + `POST /admin/sumsub/simulate/tr-check`，模拟事件走 Sumsub ingest 管道 ✅ 2026-05-23
- **Admin 充值页面** — Deposit 列表/详情 + Payin 列表/详情（含模拟控件），深色主题 ✅ 2026-05-23
- **Client 充值页面** — 三 Tab（Crypto/Fiat/History）：充值地址 + QR 码 + VIBAN 信息 + 历史记录 ✅ 2026-05-22
- **Client Tipping-Off Safe 映射** — 客户端状态隐藏合规细节（FROZEN→Processing 等） ✅ 2026-05-22
- **Client Overview TB 数据源** — 组合余额从 TigerBeetle 实时读取 ✅ 2026-05-27

**待实现：**
- **区块重组自动回退** — 链上确认数回退时撤销 Deposit 记账，append 补偿凭证
- **重复 txHash 幂等去重** — 同一 txHash 不产生重复 Deposit
- **ERC-20 合约失败忽略** — 合约执行失败的交易不创建 Payin
- **KYT 超时转人工** — KYT 审查超时后转运营人工决策
- **TB 记账失败 repair surface** — 合规通过但 TB 记账失败时的修复路径
- **充值成功通知** — 到账推送客户通知，复用 V1 Notification send
- **TransactionComplianceService 废弃** — Deposit 已不使用该服务；V5/V6 完成后整体删除 transaction-compliance 模块
- **Admin PATCH deposit status 绕过 workflow** — controller 直接调 service.updateStatus 跳过 DepositWorkflowService 的 TB 记账和审计
- **deposit.status.changed 同步 emit** — 用 `emit` 而非 `emitAsync`，异常不传播到调用方

---

## V5 — 提现流程

> 定义完整提现工作流：提现申请 → 合规筛查 → Travel Rule（VASP 对手方）→ 大额审批门 → Payout 执行 → 链上/银行确认 → 记账。热钱包预充值假设成立；Cold→Hot 自动归集由 V7 补充。
>
> 合规架构采用三层框架：L1 Eligibility Guard（客户资格，pre-creation 同步校验）→ L2 Transaction Screen（Pre-KYT + Travel Rule，唯一阻塞闸门）→ L3 Post-Tx Archive（txHash 归档，fire-and-forget）。充值流程概念对齐但不改代码。

**前置：** V2 + V3 + V4（余额依赖充值）

### MVP（2 workflows + 8 sub-flows + 3 配置治理 workflows）

**虚拟币提现工作流** — **VARA + 业务**：CRM Rulebook II.A CDD + TIR Rulebook Schedule 1

- [x] Happy Path：客户提交提现 → L1 Eligibility（assertTradingEligibility pre-creation）→ Withdraw CREATED → TB pending transfer 锁定余额（CLIENT_PAYABLE→CLIENT_ASSET net + fee，real-time 1:1）→ L2 Transaction Screen（Pre-KYT + Travel Rule 并行）→ 全部 PASSED → 自动审批 APPROVED → 创建 Payout → Payout 确认（txHash）→ TB post pending + 公司侧 `FIRM_ASSET→FIRM_FEE` 同笔收取 fee → L3 Post-Tx Archive（fire-and-forget txHash 归档）→ Withdraw SUCCESS ✅ 2026-05-30
- [ ] 异常分支 — KYT 高风险地址：目标地址高风险 → 提现挂起 FROZEN → MLRO 审批门 → 放行恢复广播 / 拒绝解锁余额（TB void pending）
- [ ] 异常分支 — 制裁地址拦截：目标地址命中 OFAC/SDN → 强制取消 → 余额解锁（TB void pending）→ MLRO 审计确认 → SAR
- [ ] 异常分支 — 链上失败：stuck/failed tx → 超时后重试加速 / 取消 → 余额解锁退回（TB void pending）
- [ ] 异常分支 — REJECTED：管理员拒绝 → TB void pending 解锁余额 → 通知客户

> L2 Transaction Screen 合规审查拆分为两个子项：`preKytStatus`（PENDING→PASSED/FAILED）+ `travelRuleStatus`（PENDING→PASSED/FAILED/NOT_REQUIRED），两项全部 PASSED 方可自动审批。合规结果通过 Sumsub Webhook 翻译层统一分发；DEV 阶段通过模拟端点触发。

**法币提现工作流** — **VARA + 业务**：同上

- [x] Happy Path：客户提交法币提现 → L1 Eligibility → Withdraw CREATED → TB pending transfer 锁定余额（CLIENT_PAYABLE→CLIENT_ASSET net + fee，real-time 1:1）→ L2 Transaction Screen（Pre-KYT PENDING + TR NOT_REQUIRED）→ Pre-KYT PASSED → 自动审批 → 创建 Payout（FIAT）→ 银行到账确认 → TB post + 公司侧 `FIRM_ASSET→FIRM_FEE` 同笔收取 fee → Withdraw SUCCESS ✅ 2026-05-31
- [ ] 异常分支 — KYT 高风险受益人：大额/结构化汇款/高风险受益人 → FROZEN → MLRO 审批门 → 放行 / 拒绝解锁余额（TB void pending）
- [ ] 异常分支 — 制裁命中：受益人银行/国家命中制裁名单 → 强制取消 → 余额解锁（TB void pending）→ MLRO 审计确认 → SAR
- [ ] 异常分支 — 银行退回（bounced）：银行退汇 → 余额恢复记账（TB void pending）→ 通知客户 → 审计记录
- [ ] 异常分支 — REJECTED：管理员拒绝 → TB void pending 解锁余额 → 通知客户

> 法币 vs 虚拟币差异：① Travel Rule：法币自动 NOT_REQUIRED；② L3 Archive：法币无（仅虚拟币有 txHash 归档）；③ KYT/制裁/REJECTED 异常路径共享同一 workflow 逻辑，仅触发场景不同（IBAN+受益人 vs 链上地址）；④ 法币独有：银行退回（bounced），虚拟币独有：链上失败（stuck/failed tx）（TB 账户统一 `CLIENT_ASSET`，按 ledger 区分资产）

**提现费率配置治理** — **业务必须**：费率结构变更的受控审批路径

- [x] Withdrawal Fee Level Creation（费率等级创建审批：3-Layer 架构——薄审批处理器 + 工作流编排器 + 领域服务；MLRO + SMO 两步审批，48h 超时；创建含 tier 列表 JSON，每 tier 定义 fixedFee + feeRate + minFee + maxFee；Admin 列表页含 Create Modal + TierEditor 组件） — **VARA + 业务**：CRM Rulebook II.C Risk-Based Approach ✅ 2026-05-30
- [x] Withdrawal Fee Level Change（费率等级变更审批：request-record 模式——创建 WithdrawalFeeLevelChangeRequest 行记录变更生命周期，主 level 保持 ACTIVE 不变；MLRO + SMO 两步审批，48h 超时；执行时 hash 冲突检测（snapshot vs actual，防静默覆盖）；Admin 详情页 Change Modal + proposed vs current 对比） — **VARA + 业务**：CRM Rulebook II.C Risk-Based Approach ✅ 2026-05-30
- [x] Withdrawal Fee Level Binding（客户费率等级绑定/解绑：无审批门，直接生效 + 审计记录；一个客户同资产同时只能有一个绑定；Admin 详情页 Bind Modal + Bindings 列表） ✅ 2026-05-30

运营治理工作流：
- [ ] 提现渠道暂停 / 恢复工作流（指定链/token/法币渠道：Maker 提案 + Checker 审批 → 暂停，在途提现处理策略明确；恢复同样需审批门；全程审计）

不单做工作流（技术处理 / 主流程内嵌）：余额不足 / 地址未白名单 / 日限额超出 → 前置校验失败不创建订单；大额审批 → 主流程内审批门；VASP TR 超时 → 主流程内状态转换取消；自托管声明 → 主流程内嵌步骤；热钱包不足（V5 阶段）→ 显式错误码 + repair surface，V7 自动化。

### ADVANCED（4 workflows）

- [ ] 批量提现处理（机构客户批量提交提现请求 CSV → 逐笔校验地址/余额/限额 → 批量合规审查 → 统一审批门 → 逐笔 Payout 执行 → 汇总报告） — **业务必须**：机构客户高频提现的标准化路径
- [ ] 大额提现增强审查（超额提现强制 EDD：要求客户提供 SOF/SOW 证明 → Sumsub 增强验证 → MLRO 审批门 → 通过后恢复正常提现流程；阈值按 tradingTier 配置） — **VARA**：CRM Rulebook III.B Enhanced Due Diligence — 大额资金流出的强化尽职调查义务
- [ ] 提现渠道切换/降级（主渠道故障时切备用渠道：自动检测主渠道健康 → 降级通知 + 审批 → 在途提现处理策略 → 备用渠道执行 → 主渠道恢复后切回） — **业务必须**：渠道容灾能力
- [ ] 提现限额变更（提现专属阈值变更审批：request-record 模式 → MLRO + SMO 两步审批 → 冲突检测 → 生效；区别于 V3 Transaction Limit Policy 的通用限额） — **业务必须**：提现维度独立限额治理

### Supporting Features（非 workflow，无独立状态机）

**已完成：**
- **Withdraw 事件驱动编排** — WithdrawWorkflowService 三层合规架构：CREATED → L2 initializeTransactionScreen（Pre-KYT + TR）→ checkScreenPass convergence → APPROVED → Payout → handlePayoutConfirmed → finalizeWithdrawal → L3 archivePostKyt（crypto only）→ SUCCESS；事件：WITHDRAWAL_CREATED / KYT_UPDATED / TRAVELRULE_UPDATED / PAYOUT_STATUS_CONFIRMED ✅ 2026-05-31
- **TB pending transfer 记账** — 创建时锁定余额（create pending net + fee），成功时结算（post pending），失败/拒绝时解锁（void pending）；客户侧统一 `CLIENT_PAYABLE↔CLIENT_ASSET`（real-time 1:1，按 ledger 区分资产）；post 时公司侧同笔 `FIRM_ASSET→FIRM_FEE` 收取 fee（无 FEE_RECEIVABLE 中转、无 EOD drain）；decimalToBigint 精度转换 ✅ 2026-05-31
- **模拟端点** — `POST /withdraw-transactions/:id/simulate/kyt-phase1` + `kyt-phase2` + `travel-rule` + `payout-confirmed`，DEV 阶段模拟合规结果与链上确认；法币和虚拟币共用同一组端点 ✅ 2026-05-30
- **Admin 提现页面** — Withdraw 列表/详情（含 L1/L2/L3 合规层卡片、Payout 关联、状态历史时间线）+ Payout 列表/详情 + Withdrawal Fee Level 列表/详情（含 TierEditor、Create/Change/Bind Modal），深色主题 ✅ 2026-05-31
- **Client 提现页面** — 三 Tab（Crypto/Fiat/History）：资产选择 → 地址选择/手动输入 → 金额输入含费用预览 → 确认弹窗 → 提交；History 列表含状态筛选 ✅ 2026-05-30
- **Client Tipping-Off Safe 映射** — 客户端状态隐藏合规细节（FROZEN→Processing 等），复用 V4 映射模式 ✅ 2026-05-30
- **CustomerWithdrawController** — 客户端专用 API：创建提现 + 查询列表/详情 + 预览费用报价；Admin controller 锁定仅管理员访问 ✅ 2026-05-30
- **WithdrawQuoteService** — 从 PricingCenterService 拆分独立的 Withdrawal quote 逻辑，支持多 level 取最优费率 ✅ 2026-05-30
- **费率数据迁移** — PricingPolicy WITHDRAWAL_PRICING → WithdrawalFeeLevel seed 脚本 ✅ 2026-05-30

**已完成（追加）：**
- **大额审批门** — 提现毛额 ≥ 200,000 AED（Binance 市场汇率估值，fail-closed）触发 SENIOR_MANAGEMENT_OFFICER 单步审批（48h），门置于 L2 合规之前；新增 `PENDING_APPROVAL` 态 + `WITHDRAW_LARGE_VALUE_APPROVAL` 审批类型；批准→进合规 / 拒绝→void TB pending 解锁；估值快照（grossAedValue/aedRate/...）落库 + Admin Approval Gate 卡片。设计/计划见 `doc-final/superpowers/specs/2026-06-01-withdraw-large-value-approval-gate-design.md`。兑换流程经评估**不设**审批门（资金不出境）。✅ 2026-06-01

- **提现资金单结构** — 一笔提现 = 1 Payout(本金) + 1 fee InternalFund（fee fund 仅 PAYOUT_PENDING 创建）；无独立的本金跟踪单 ✅ 2026-06-26
- **对账 evidence 字段** — NET_POST / FEE_POST / FEE_FIRM evidence 携带 `walletRef` + `externalRef`；FEE_POST 与 FEE_FIRM 共享同一 externalRef，支持跨钱包同 ref 互证 ✅ 2026-06-26

**待实现：**
- **Sumsub KYT/TR 真实集成** — 替换模拟端点，走 Sumsub webhook 翻译层；L3 archivePostKyt stub 替换为真实 PATCH /kyt/txns/{id}/data/info 调用
- **热钱包余额校验** — Payout 前检查 Outbound Wallet 余额，不足时显式失败
- **提现成功通知** — 完成推送客户通知，复用 V1 Notification send
- **TB 记账失败 repair surface** — 合规通过但 TB 记账失败时的修复路径

---

## V6 — 兑换流程

> 报价中心、Quote 创建与消费、兑换成交，以及费率与货币对的治理工作流。兑换为平台内余额交换，资金不出境、无外部对手方，合规仅 L1 Eligibility 同步闸门；成交为 4 腿 per-leg two-phase 实时多腿记账，无未达成项概念。

**前置：** V2 + V3

### MVP

**主流程：**

- [x] 报价工作流（客户请求 from/to CCY + 金额 → SwapQuoteService 解析 SwapFeeLevel 最优费率 + BinanceRateProvider 实时汇率 → PricingEngine 计算 amountOut/spread/fee → Quote 创建含 30s TTL → 客户确认触发成交 / 取消 → CANCELLED） — **业务必须** ✅ 2026-06-01
- [x] 兑换成交工作流 Happy Path（L1 Eligibility 闸门（assertTradingEligibility，pre-creation 同步）→ 消费 Quote → swap 进 PROCESSING，`SwapSettlementService.start()` 按 `swap-leg-plan.constant.ts` 创建 4 个 InternalFund 腿（挂 swapTransactionId+legSeq，不走白名单），leg1 自动 initiate pending，leg 2-4 lazy（admin `POST .../legs/:legSeq/advance` 推）→ per-leg two-phase pending→post（成功）/ void（失败）→ 4 腿全 CLEAR 即 SUCCESS；客户侧 `CLIENT_PAYABLE↔CLIENT_ASSET`、公司侧 `FIRM_ASSET↔FIRM_OPS/SET/FEE` 实时记账；三层架构 L1 SwapTransactionsService + L3 SwapWorkflowService + L2 SwapSettlementService） — **VARA + 业务**：CRM Rulebook II.A CDD ✅ 2026-06-01
  - [ ] 异常分支 — 执行失败回滚（TB best-effort void 补偿已内置；失败 swap 可经 admin `POST .../reverse` 整笔冲正到 REVERSED 终态；自动 FAILED 状态机仍 deferred）
  - [ ] 异常分支 — 大额/可疑兑换 COMPLIANCE_HOLD → MLRO（**设计偏离：swap 资金不出境，现为同步 eligibility-only，无异步合规闸门；此项待确认是否适用**）

**兑换费率配置治理：** — **VARA + 业务**：CRM Rulebook II.C Risk-Based Approach

- [x] Swap Fee Level Creation（费率等级创建审批：3-Layer 架构——薄审批处理器 + 工作流编排器 + 领域服务；OPS_OFFICER 单步审批，48h 超时；创建含 tier 列表 JSON，每 tier 定义 rateMarkupBps（点差）+ feeItems（可选，支持 spread-only tier）；Admin 列表页含 Create Modal + TierEditor swap 模式（currency 下拉 + SWAP_SERVICE_FEE/COMPLIANCE_FEE codes）） ✅ 2026-06-01
- [x] Swap Fee Level Change（费率等级变更审批：request-record 模式——创建 SwapFeeLevelChangeRequest 记录变更生命周期，主 level 保持 ACTIVE；OPS_OFFICER 单步审批；执行时 hash 冲突检测；Admin 详情页 Change Modal + proposed vs current 对比） ✅ 2026-06-01
- [x] Swap Fee Level Binding（客户费率等级绑定/解绑：无审批门，直接生效 + 审计；Admin 详情页 Bind Modal + Bindings 列表） ✅ 2026-06-01

**运营治理：**

- [ ] 交易暂停 / 恢复工作流（指定货币对或全局暂停：已在途 Quote 强制 EXPIRED → Maker 提案 + Checker 审批；恢复时同样需审批门；全程审计） — **业务必须**

> 不单做工作流（技术处理 / 主流程内嵌）：余额不足 / 客户暂停 / Tier 限额 → 前置校验失败不创建订单；Quote TTL 过期 → Cron sweep 标 EXPIRED；4 腿全部实时 post，无未达成项创建。

### ADVANCED

- [ ] 货币对上下线工作流（新增货币对：关联 TB Account + SwapFeeLevel 默认配置 + 审批上线；下线货币对：处理在途 Quote + 配置归档 + 审批） — **业务必须**：货币对的标准化上下线路径
- [ ] 大额兑换增强审查（超阈值强制 EDD：要求 SOF/SOW 证明 → Sumsub 增强验证 → MLRO 审批门 → 通过后恢复正常兑换；阈值按 tradingTier 配置） — **VARA**：CRM Rulebook III.B Enhanced Due Diligence
- [ ] 批量兑换（机构客户批量提交兑换请求 → 逐笔校验余额/限额 → 批量合规审查 → 统一审批门 → 逐笔成交） — **业务必须**：机构客户高频兑换路径

### Supporting Features（非 workflow，无独立状态机）

**已完成：**
- **SwapQuoteService 拆分** — 从 PricingCenterService 独立，BinanceRateProvider 实时费率 + 多 level 取最优 + Quote 全生命周期（create/consume/cancel/admin 查询）✅ 2026-06-01
- **PricingCenterService 删除** — God Service（2926 行）彻底移除，swap/withdraw quote 各自归属领域模块，PricingCenterModule 仅保留 PricingEngineService + BinanceRateProvider 工具导出，净减 ~3500 行 ✅ 2026-06-01
- **SwapFeeLevel 三层治理 + Admin 页面** — SwapFeeLevelService（L1）+ 创建/变更/绑定审批处理器与工作流；Admin List/Detail + Create/Change/Bind Modal + TierEditor swap 模式 ✅ 2026-06-01
- **Swap Quotes admin 只读页** — 报价快照列表/详情（含 from/to pair、amounts、rate、spread、fee、生命周期），dark 主题 ✅ 2026-06-01
- **TB 4 腿 per-leg 记账** — `swap-leg-plan.constant.ts` 声明式 4 腿（CRYPTO→FIAT / FIAT→CRYPTO 各一组）；客户侧 `CLIENT_PAYABLE↔CLIENT_ASSET`、公司侧 `FIRM_ASSET↔FIRM_OPS/SET/FEE`；per-leg two-phase pending→post 可补偿；无 clearing bridge、无 Outstanding、无 FEE_RECEIVABLE ✅ 2026-06-01
- **Client 兑换页面** — 报价 → 确认弹窗（pay/net receive/fee/rate）→ 执行 → 历史；余额读 TB portfolio；dark-native 品牌样式对齐 Deposit/Withdraw ✅ 2026-06-01
- **Customer 报价契约 + 余额接口** — createQuote 全字段返回（netAmountOut/currencyIn/currencyOut 等）；余额改用 `/client/portfolio/balances`（TB ledger，JWT 取客户）✅ 2026-06-01
- **审批策略简化** — TRANSACTION_LIMIT_CREATION/CHANGE + WITHDRAWAL_FEE_LEVEL_CREATION/CHANGE + SWAP_FEE_LEVEL_CREATION/CHANGE 共 6 类从 MLRO→SMO 两步改为 OPS_OFFICER 单步（含 OPS_OFFICER 权限补充与 backfill）✅ 2026-06-01

- **SwapSettlementService per-leg 编排** — swap PROCESSING 创建 4 个 InternalFund 腿（挂 swapTransactionId+legSeq，不走白名单）；leg1 自动 initiate、leg 2-4 lazy；admin `POST .../legs/:legSeq/advance` 逐腿推 + `POST .../reverse` 整笔冲正；状态机含 PROCESSING / SUCCESS / FAILED / REVERSED 终态 ✅ 2026-06-26
- **对账 evidence 字段** — 每腿 evidence 携带 `debitWalletRef`/`creditWalletRef`/`externalRef = ${swapNo}:${legSeq}:pending`/`isExternalCrossing = true`；swap 不上链，swap-internal ref 即跨钱包同 ref 互证键 ✅ 2026-06-26

**待实现：**
- **Sumsub TM 真实集成** — 若启用大额兑换合规，替换为 Sumsub webhook 翻译层
- **大额审批门** — 超阈值兑换走 MLRO 审批
- **Quote TTL Cron sweep** — 过期 Quote 自动标 EXPIRED
- **兑换成功通知** — 完成推送客户通知，复用 V1 Notification send
- **TB 记账失败 repair surface** — 合规/校验通过但 TB 记账失败时的修复路径
- **legacy swap config 清理** — 旧 PricingSwapConfigPage / swap pair config 残留移除

---

## V7 — 内部转账流程

> 平台内部资产物理移动的通用治理。**所有内部转账都是真实的链上交易（虚拟币）或银行指令（法币），不存在纯 TB 内划拨路径。** 所有路径共享同一通用内部转账工作流，差异仅在触发条件、审批门级别和记账类别（A 类零 TB / B 类 drain）。

**前置：** V3（账户模型）+ V6（swap 产生 Outstanding / FEE_RECEIVABLE）

**关键决策与最终落地**（详见 `reference/v7-funds-layer-baseline.md` + `superpowers/specs/2026-06-08-v7-fiat-swap-settlement-design.md` + `superpowers/specs/2026-06-08-v7-fiat-fee-collection-design.md`）：
- 链上 gas → HexTrust gas station 打包自担，**不进客户托管 TB**；钱包热/冷分层 → HexTrust 管，平台不编排。
- 银行费 → 年付固定 OpEx、不按笔，**不进 V7 交易记账**。
- **法币侧落地客户资产隔离模型**：客户级 `C_VIBAN`（入/出金）+ 平台 `F_SET`(结算中转) / `F_LIQ`(流动性) / `F_FEE`(手续费) / `F_OPS`(运营) / `C_CMA`(法币主账号，查询用)。`C_VIBAN→F_FEE` 可直连单跳；`VIBAN↔F_LIQ` 经 `F_SET` 中转两跳。
- **法币结算 = per-swap 即时**（隔离禁止跨客户池级轧差），**crypto 结算 = EOD 轧差**；两套引擎共享 SettlementBatch / Outstanding / funds-flow 原语。**法币结算 Model A（2026-06-09）**：IN 交割只把 **net** 经 `F_LIQ→F_SET→VIBAN` 交到 VIBAN；服务费在**公司侧** `F_LIQ→F_FEE` 确认，永不进客户 VIBAN。**记账仍 gross**（swap 成交时记入 TRADE_CLEARING+FEE_RECEIVABLE，结算 drain 按余额驱动，与转账金额解耦）。见 `superpowers/specs/2026-06-09-fiat-net-settlement-model-a-design.md`。
- **法币归集（VA→集中账户）删除** —— 由银行自理，平台不编排。
- **Outstanding 仅 swap 产生**；**偿付义务（Reimbursement）移出 → V8 对账**。
- **两本账记账体系（2026-06-10）已落地** —— 取代上文 drain/FEE_RECEIVABLE 口径（`FEE_RECEIVABLE` 已删）。内容：① COA 重定为客户账本（safeguarding：`CLIENT_BANK`/`CLIENT_CUSTODY`/`CLIENT_PAYABLE`/`DEPOSIT_SUSPENSE`/`TRADE_CLEARING`）+ 公司账本（`FIRM_TREASURY`/`FX_POSITION` + E 段 `PAID_IN_CAPITAL`/`RETAINED_EARNINGS` + R 段四收入科目），seed 注入资本（AED 1,000,000 / USDT 100,000）；② T1 收入确认 —— swap 费/点差成交即记 `FEE_INCOME`/`SPREAD_INCOME`，提现费两阶段 pending→post；③ 物理资金流 CLEAR 时 TB **mirror 镜像**（客户池↔`FIRM_TREASURY`，`SETTLE_*`/`FEE_DECOMMINGLE`）取代 drain，公司内部倒手（`F_LIQ→F_FEE`）TB no-op；④ EOD `FxEodService` 清桥（`TRADE_CLEARING`→`FX_POSITION`，扣除 open swap 贡献）+ 每日重估（`FX_UNREALIZED_PNL`）+ LP 平盘（`FX_REALIZED_PNL`，浮动回转）+ I1/I2 对账不变量；⑤ 三桶损益：费收入 / 点差收入 / FX 盈亏（浮动+已实现）；⑥ `scripts/verify-two-book.ts` 全链验收（充值→兑换→法币结算→EOD→提现→平盘→终局守恒，41/41 PASS）。见 `superpowers/specs/2026-06-10-two-book-accounting-design.md`。

---

### 内部转账白名单（最终实现）

所有内部转账必须属于以下预定义白名单对（`TRANSFER_PATH_WHITELIST`），白名单以外的 from-to 立即拒绝，不创建 funds flow。

| 标签 | From → To | 介质 | 记账类 | 触发 | 状态 |
|---|---|---|---|---|---|
| 充值归集 (AGGREGATE) | C_DEP → C_MAIN | 链上 | A（零 TB） | 每小时 Cron / 超阈值 | ✅ crypto |
| 出金预归集 (FUND_OUT) | C_MAIN → C_OUT | 链上 | A（零 TB） | V5 提现 Payout 前 | ✅ V5 已 wire |
| 出金退回 (FUND_RETURN) | C_OUT → C_MAIN | 链上 | A（零 TB） | 提现取消/失败 | ✅ repair 入口 |
| 兑换卖出交割 (INTERNAL_OUT) | C_MAIN → F_OPS | 链上 | B（mirror POOL_TO_FIRM） | EOD 轧差 | ✅ crypto |
| 兑换买入交割 (INTERNAL_IN) | F_OPS → C_MAIN | 链上 | B（mirror FIRM_TO_POOL） | EOD 轧差 | ✅ crypto |
| 手续费归集 (FEE_COLLECT) | C_MAIN → F_FEE | 链上 | B（mirror POOL_TO_FIRM） | EOD | ✅ crypto |
| 法币卖出交割 (FIAT_SETTLE_OUT) | C_VIBAN → F_SET → F_OPS | 银行 | B（mirror POOL_TO_FIRM） | swap 成交即时 | ✅ fiat |
| 法币买入交割 (FIAT_SETTLE_IN) | F_OPS → F_SET → C_VIBAN(net) | 银行 | B（mirror FIRM_TO_POOL） | swap 成交即时 | ✅ fiat |
| 法币手续费 (FIAT_WITHDRAW_FEE_COLLECT) | C_VIBAN → F_FEE | 银行 | B（mirror POOL_TO_FIRM） | 提现成功 | ✅ fiat |
| 兑换费/点差 (FIAT_SWAP_FEE_COLLECT) | F_OPS → F_FEE | 银行 | B（公司内倒手 TB no-op） | swap 结算后 | ✅ fiat |
| ~~法币归集~~ | ~~客户 VA → 集中账户~~ | 银行 | — | — | ❌ 删除（银行自理） |

> LP-IN/OUT、热/冷分层、Gas Reserve 移出 MVP（见 ADVANCED）。法币交割是 **2 跳**（经 F_SET），建模为 1 InternalTransaction + 2 顺序 InternalFund；法币费归集是 **1 跳**（1 transfer + 1 fund）。
>
> **⚠️ 钱包路由对齐（2026-06-21，以 live code 为准）**：本 V7 节**上方决策记录（Model A / 两本账条目）与下方交付清单中，凡结算/费用路由出现的 `F_LIQ` 一律以 `F_OPS` 为准**——`F_LIQ` 已退出所有结算/费用路径（仍是 `FIRM_TREASURY` 名下流动性钱包）。即：crypto 本金 `C_MAIN↔F_OPS`、法币本金 `C_VIBAN↔F_SET↔F_OPS`、swap 费 `F_OPS→F_FEE`、提现费 `C_VIBAN/C_MAIN→F_FEE`。源：`internal-transfer-paths.constant.ts`。
> **结算批 6 型 `settlementType`**（`settlement-type.constant.ts`，强类型防呆）：`{FIAT|CRYPTO}_{PRINCIPAL|WITHDRAW|SWAP}` = 本金 / 提现费 / 兑换费；兑换费 accrual 再拆 `feeKind = SERVICE_FEE + SPREAD`。物理 CLEAR 时 TB 走 **mirror**（客户池↔FIRM_TREASURY）非 drain（见上方 2026-06-10 两本账条目）。

---

### MVP（核心工作流）

- [x] **通用内部转账工作流** — 白名单校验 → 创建 funds flow → 发起链上/银行指令 → 确认后记账（A 零 TB；B drain `TRADE_CLEARING`/`FEE_RECEIVABLE ↔ CUSTODY/BANK`）→ COMPLETED。crypto `InternalTransferWorkflowService`；fiat `FiatSettlementWorkflowService` + `FiatFeeCollectionWorkflowService`。✅ 2026-06-08
- [x] **充值归集（crypto）** — 每小时 `@Cron` sweep 扫客户充值地址 → C_MAIN；阈值（`AGGREGATION_THRESHOLD=100`）+ dust（`<1`）跳过；A 类直接 funds flow，无 Outstanding/fee。✅ 2026-06-04 ｜ 法币归集 ❌ 删除（银行自理）
- [x] **EOD 兑换结算编排（crypto）** — 23:59 `@Cron` 按资产轧差 `TRADE_CLEARING` → SettlementBatch → INTERNAL_OUT/IN funds flow → Outstanding `SETTLED`（`closedByInternalFundId`），幂等重跑。✅ 2026-06-04
- [x] **法币 swap 交割（fiat）** — per-swap 即时：swap 提交后 emit `SWAP_SUCCEEDED` → 两跳 `C_VIBAN↔F_SET↔F_LIQ`（1 transfer + 2 顺序 fund，**IN 交 net — Model A 2026-06-09**）→ transfer SUCCESS 时 drain `TRADE_CLEARING↔BANK`。`FIAT_TRANSITIONS` 状态机。✅ 2026-06-08（live 验收 PASS）
- [x] **手续费归集（crypto）** — 每日 `@Cron` drain `FEE_RECEIVABLE`（swap 费+点差+提现费）→ C_MAIN→F_OPS（全额 drain）。✅ 2026-06-04
- [x] **法币手续费归集（fiat）** — per-event：**Model A（2026-06-09）**—swap 服务费 + 点差均**公司侧** `F_LIQ→F_FEE`（服务费不再走 `C_VIBAN→F_FEE`，避免穿过隔离 VIBAN）；提现费仍 `C_VIBAN→F_FEE`（确从客户 VIBAN 扣）；**按指定金额** drain `FEE_RECEIVABLE→BANK`。swap 费随结算 ride-along，提现费监听 `WithdrawEvents.EVT_WITHDRAWAL_SUCCESS__FIAT`。✅ 2026-06-08（live 验收 PASS）

**遗留缺口（happy path 已交付，欠韧性/治理）：**
- [ ] **fiat 兜底 cron** — 法币结算/费用纯事件驱动，OPEN 法币 outstanding 为持久工作项但无低频 cron 漏单兜底（设计留接口未接）
- [ ] **repair surface 偏薄** — 仅 crypto `fund-return-repair`；法币结算/费用单 FAILED/TIMEOUT/RETURNED 无 admin 重试/修复入口
- [ ] **内部转账审批门** — 当前所有内部转账自动 `APPROVED`，无按金额人工审批门（原列「按金额判审批门」未做）
- [ ] **异常/FAILED 分支处理** — funds-flow FAILED/RETURNED 状态可达但无消化工作流（银行退回追偿 → V8）

> **偿付义务（Reimbursement）已移出 V7，并入 V8 对账（决策 2026-06-03）**：偿付义务是「纠正动作」，其主要发现源是对账（detective control）；event-driven 失败（提现退回、银行 bounce）只是已知子集。故 `ReimbursementObligation` 实体 + 状态机 + 审批门由 V8 差异处理工作流统一拥有，两类触发源（对账差异 / event-driven 失败）共用同一出口。`ReimbursementObligation` 表已在 V7 Phase 0 解耦预备（owedTo/sourceType/approvalCaseId 字段就位），V8 直接复用。FUND_RETURN（提现退回的资金侧 Outbound→Main）已由 V7 funds-layer 交付，不受影响。

> FUND_OUT（出金预归集）由 V5 提现工作流触发（`withdraw-workflow.service` 调 `fundTransferWorkflow.fundOut`，非阻塞）✅；FUND_RETURN 经 admin repair 入口触发 ✅。两者不单列工作流。

### ADVANCED（推后交付）

- [ ] LP 调拨治理工作流（LP-IN / LP-OUT 路径独立审批门：Maker 提案 + CFO / MLRO 签批 → 触发对应通用转账实例）
- [ ] 内部转账阈值配置变更工作流（Maker 提案修改归集阈值 / 审批金额线 / dust 阈值 → Checker 审批 → 生效；全程审计）—— 现 `AGGREGATION_THRESHOLD`/`DUST_THRESHOLD` 硬编码常量
- [ ] ~~偿付义务工作流（完整版）~~ → **移入 V8 对账**（费用多收退还 / 运营错误补偿 / 充值反转退回 / 促销补贴 等，主要由对账差异处理触发）
- [ ] 异常处置工作流 —— 孤儿充值归位 / 冻结·制裁资产隔离 / 错账冲正
- [ ] 储备金注资 / 穿底补救工作流（公司外部 → 客户池，补足储备）
- [ ] 公司自有流动性调拨（Main ↔ Liquidity 库存再平衡）
- [ ] 跨网络库存再平衡（同资产跨链，可能需 OTC）

### Supporting Features（非 workflow，无独立状态机）

- **funds flow（资金单）执行引擎** ✅ — 链上 `CRYPTO_TRANSITIONS`（签名→广播→确认→CLEAR）+ 银行 `FIAT_TRANSITIONS`（SUBMIT→CONFIRM→CLEAR），按 `asset.type` 选；费/确认数留痕。`createLeg` 支持单 transfer 多 fund（法币两跳）
- **Transaction（结算单）轧差引擎** ✅ — `SettlementBatchService`，按资产净额，N:1 关联，幂等重算
- **Outstanding 结算关闭** ✅ — V6 建、V7 消费：OPEN → LOCKED → SETTLED，挂 `closedByInternalFundId`
- **FEE_RECEIVABLE drain 记账** ✅ — crypto 全额 drain（`applyAccounting`）+ fiat **按指定金额** drain（`drainFeeReceivableAmount`，截断对齐计提，FIAT 对手账户 BANK）
- **白名单校验 guard** ✅ — `assertWhitelisted`（单跳）+ `assertRoute`（法币多跳）；非白名单立即拒绝
- **Cron sweep 适配器** ✅ crypto — 充值归集（每小时）/ EOD 结算（23:59）/ 手续费归集（每日）`@Cron`；**fiat 无 cron，纯事件驱动**（兜底 cron 待接）
- **幂等键** ✅ — EOD/归集：`sourceType+sourceId` 去重，已 SETTLED 跳过
- **repair surface** ⚠️ 仅 crypto — `fund-return-repair` 入口；法币失败修复入口待补
- **fee_accrual 实体 + 状态机** ✅ — ACCRUED → LOCKED → SETTLED；per-batch（EOD 聚合）+ per-transfer（fiat 即时）两种结算路径；Admin 列表/详情页
- **traceId 全链审计** ✅ — payin / swap_quote / settlement_batch UUID + outstanding / fee_accrual originTraceId 跨实体串联

### 不单做工作流（主流程内嵌 / 运维 / 已外包）

- **链上 gas** → HexTrust gas station 自担，不进 TB，固定 P&L
- **钱包热 / 冷分层** → HexTrust 管，平台不编排
- **银行转账费** → 年付固定 OpEx，不进交易记账
- **链上重组 / 超时** → FAILED + repair surface，不自动重广播
- **银行退回（bounced）** → 通用内部转账 FAILED 分支 / 偿付义务

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
- [ ] **T1-T3 流水基建** — `tb_transfer_evidence` 加 `walletRef`/`externalRef`/`isExternalCrossing` 三列；记账写入路径（充值/提现/swap/手续费四条流程）逐腿供给；新建 `AccountFlow` 投影表（2 行/transfer）+ 回填脚本。
- [ ] **T4 Account Statement by-wallet 视图** — 按 walletRef 合并 SUSPENSE[c]+PAYABLE[c]（客户钱包）/ FIRM_OPS/SET/FEE（公司钱包）的流水；全量 / 链上对账（crossingOnly）两视图切换。
- [ ] **T5-T7 引擎重写** — ExternalBalance/Case/LineItem 加 walletRef/coaCode/ownerNo 定位列；逐钱包余额对账（external == PAYABLE+SUSPENSE / 公司 1:1 直比）+ 流水匹配（同 ref 跨钱包互证）+ Run 编排（`WalletReconRunService`）。
- [ ] **T8 recon:demo 重写** — anchor-free pass/break + manifest 答案键（4 类异常：ORPHAN_INTERNAL/EXTERNAL、AMOUNT_MISMATCH、balance break）。
- [ ] **T9 旧 V8 引擎 neuter** — credit-net + formula-checker(式1-5) + invariant-checker(I1/I2) 标 @deprecated、推到新引擎；Phase C 物理删。

**redesign 遗留（technical debt，Phase B 进行中不立即处理）：**
- [~] **旧 I1-I5 + credit-net 五公式引擎退役** — Phase B 取代后随 Phase C 死码清扫物理删（neuter 优先）
- [ ] FIRM "Treasury position snapshot" 余额标记行误入交易下钻 → firm case 在式5 已平(Δ=0)时仍 OPEN 带噪音（Phase B 重设计后此 case 不再产生，但旧 Run 历史数据残留）
- [ ] case line item 跨 run 累积去重（按最新 run 收口）；式5 firm-side 在途 stub=0 待接（Phase B 重写后口径改变，旧 case 历史不动）
- [ ] **资本注入流水补写** — FIRM_ASSET 流水缺资本那笔的 evidence 行（小修，独立于 Phase B）
- [ ] **资金单合并可行性评估** — payin/payout/internalfund 状态机近乎同构（Payout ≈ InternalFund crypto；Payin = 只观察子集），可合表合服务；本期未做，Phase C 决策

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
