# 审计动作码全量导出 —— 按域 × 按工作流（最全版）

> 生成于 2026-09-26 ｜ 基线 main `a17a7aa` ｜ 机器列来源 `src/modules/audit-logging/constants/audit-actions.constant.ts`（9 份名册程序化导出）｜ 说明列来源 `doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md`
> 现役 **270 码**（较 2026-09-15 版少 4：CUSTOMER_DELETED、CUSTOMER_UPDATED、INCIDENT_REGULATOR_REPORTED、INCIDENT_REGULATOR_REPORT_DRAFTED 已退役，进拒写闸），另有退役 117 码进拒写闸（附录全列）。
> **旅程**列：S 起点=该码铸 correlationId 开启一段旅程 ｜ I 继承=延续同一旅程 ｜ N 单步=无旅程可挂（守卫拒绝、单步动作、报价先于订单等）。**异步**=✓ 表示由审批/事件驱动、必须带 causationId。**subjects**=✓ 表示该码在 SUBJECTS_COVERED_ACTIONS 名册（治理域+横切审批 47 码，verify:audit Q2 断言面）；交易域码运行时也写子表行但不在名册故留白；Related No 检索走 OR 语义（主表∨子表）不受此列影响。⚡=演示装置。

**分域计数**：APPROVAL 8 ｜ IAM 30 ｜ CONFIG 60 ｜ AUDIT 4 ｜ CUSTOMER 26 ｜ DEPOSIT 47 ｜ WITHDRAW 33 ｜ SWAP 26 ｜ TREASURY 7 ｜ RECON 9 ｜ GOVERNANCE 20 ｜ 合计 270

## APPROVAL 域 —— 审批引擎（横切）（8 码）

30 个审批子流程共用同一台引擎；任何域的 maker-checker 单在此留「提/批/拒/撤/超时」通用痕，与业务域的具名码互补。

### 审批案生命周期（7）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `APPROVAL_SUBMITTED` | maker 提交审批单 | I 继承 | policyCode, policyVersion |  | ✓ |
| `APPROVAL_GRANTED` | checker 批准（每步一条） | I 继承 | approvalNo |  | ✓ |
| `APPROVAL_DECLINED` | checker 拒绝 | I 继承 | approvalNo, reason |  | ✓ |
| `APPROVAL_CANCELLED` | maker 撤单 | I 继承 | approvalNo, reason |  | ✓ |
| `APPROVAL_EXPIRED` | 超时作废（谁都没批） | I 继承 | approvalNo |  | ✓ |
| `APPROVAL_SOD_DENIED` | 自批被拒——同一账号既提又批，当场拦下并留痕 | I 继承 | reasonCode |  | ✓ |
| `APPROVAL_TIMEOUT_SIMULATED` | ⚡ 演示拨钟：模拟审批超时 | I 继承 | approvalNo |  | ✓ |

### 审批缺失告警（1）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `APPROVAL_REQUIRED_MISSING` | 该走审批的动作被发现没挂审批策略（防御告警） | N 单步 | reason |  |  |

## IAM 域 —— 管理员身份与访问（30 码）

管理员的一生：邀请 → 首登绑 MFA → 上岗 → 停用/恢复；外加凭据重置、账号锁定与权限守卫拒绝。

### 权限守卫拒绝（1） — 「默默拦下也是被禁止的」——403 本身留痕

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_ACCESS_DENIED` | 调用无权限的接口被守卫拦下（带 actorNo/缺失权限码/来源 IP） | N 单步 | — |  |  |

### 常规登录 · MFA 二次校验（2） — 已绑 MFA 的老用户每次登录的二次校验（登录本身按口径不留痕）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `MFA_LOGIN_VERIFIED` | MFA 码校验通过 | N 单步 | authnMethod |  | ✓ |
| `MFA_LOGIN_VERIFY_FAILED` | MFA 码校验失败（含触发锁定的细节在 metadata） | N 单步 | reasonCode |  | ✓ |

### 入职邀请（5）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_INVITE_REQUESTED` | 发起邀请（进审批） | S 起点 | afterData |  | ✓ |
| `ADMIN_INVITE_DISPATCHED` | 邀请批准后派发激活链接（含重发） | I 继承 | — |  | ✓ |
| `ADMIN_INVITE_ACCEPTED` | 新人确认身份接受邀请（成功/失败两结局） | I 继承 | fromStatus, toStatus |  | ✓ |
| `ADMIN_INVITE_EXPIRED` | 邀请超时失效 | I 继承 | — |  | ✓ |
| `ADMIN_INVITE_CANCELLED` | 邀请撤销 | I 继承 | reason |  | ✓ |

### 首次登录（四步）（4）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_FIRST_LOGIN_IDENTITY_CONFIRMED` | 第一步：确认身份 | S 起点 | authnMethod |  | ✓ |
| `ADMIN_FIRST_LOGIN_MFA_INITIATED` | 第二步：发起 MFA 绑定（出 QR） | I 继承 | — |  | ✓ |
| `ADMIN_FIRST_LOGIN_MFA_BOUND` | 第三步：TOTP 绑定校验（成功/失败双结局） | I 继承 | authnMethod |  | ✓ |
| `ADMIN_FIRST_LOGIN_COMPLETED` | 第四步：首登完成、上岗 | I 继承 | fromStatus, toStatus |  | ✓ |

### 账号锁定 / 解锁（2） — 连续失败自动锁定，业主裁定算业务审计

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_ACCOUNT_LOCK_APPLIED` | 连续校验失败触发锁定 | S 起点 | reasonCode, fromStatus, toStatus |  | ✓ |
| `ADMIN_ACCOUNT_LOCK_RELEASED` | 锁定到期解锁 | I 继承 | fromStatus, toStatus |  | ✓ |

### 角色绑定变更（3） — 给人换权力也要过门；CISO 与技术官可提、裁决唯 CISO

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_ROLE_CHANGE_REQUESTED` | 提交角色绑定变更申请 | S 起点 | — |  | ✓ |
| `ADMIN_ROLE_CHANGE_APPLIED` | 审批通过、绑定生效 | I 继承 | beforeData, afterData, approvalNo | ✓ | ✓ |
| `ADMIN_ROLE_CHANGE_CANCELLED` | 申请取消/被拒 | I 继承 | reason | ✓ | ✓ |

### 停用 / 恢复（4） — 配对两案；无取消路径是刻意的

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_SUSPENSION_REQUESTED` | 提停用 | S 起点 | reason |  | ✓ |
| `ADMIN_SUSPENSION_APPLIED` | 审批通过、下次请求即失效 | I 继承 | fromStatus, toStatus, approvalNo | ✓ | ✓ |
| `ADMIN_REACTIVATION_REQUESTED` | 提恢复 | S 起点 | reason |  | ✓ |
| `ADMIN_REACTIVATION_APPLIED` | 审批通过、账号复活 | I 继承 | fromStatus, toStatus, approvalNo | ✓ | ✓ |

### 密码重置（自助 / 官员代办两条链）（6）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_PASSWORD_RESET_SELF_REQUESTED` | 自助发起重置 | S 起点 | — |  | ✓ |
| `ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED` | MFA 校验通过后签发重置令牌（含限流拒发） | I 继承 | — |  | ✓ |
| `ADMIN_PASSWORD_RESET_SELF_COMPLETED` | 自助重置完成 | I 继承 | — |  | ✓ |
| `ADMIN_PASSWORD_RESET_OFFICER_REQUESTED` | 官员代提重置（进审批） | S 起点 | onBehalfOfNo |  | ✓ |
| `ADMIN_PASSWORD_RESET_OFFICER_APPLIED` | 审批通过、代办重置生效 | I 继承 | onBehalfOfNo, approvalNo | ✓ | ✓ |
| `ADMIN_PASSWORD_RESET_CANCELLED` | 重置申请取消 | I 继承 | reason |  | ✓ |

### MFA 重置（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ADMIN_MFA_RESET_REQUESTED` | 官员代提 MFA 重置（进审批） | S 起点 | onBehalfOfNo |  | ✓ |
| `ADMIN_MFA_RESET_APPLIED` | 审批通过、MFA 解绑待重绑 | I 继承 | fromStatus, toStatus, approvalNo | ✓ | ✓ |
| `ADMIN_MFA_RESET_CANCELLED` | 申请取消 | I 继承 | reason | ✓ | ✓ |

## CONFIG 域 —— 配置治理（V3 财务配置 + 角色/策略定义）（60 码）

「配置有身世」：角色定义、审批策略、费率两族、资产暂停恢复、限额、提现地址、客户标签——改配置本身全部过门留痕；种子装载即第一行履历。

### 角色定义（建 / 改）（6）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ROLE_DEFINITION_CREATE_REQUESTED` | 提交新建角色（硬互斥当场校验） | S 起点 | afterData |  | ✓ |
| `ROLE_DEFINITION_CREATE_APPLIED` | 审批通过、角色生效 | I 继承 | afterData, approvalNo | ✓ | ✓ |
| `ROLE_DEFINITION_CREATE_CANCELLED` | 新建取消/被拒 | I 继承 | reason | ✓ | ✓ |
| `ROLE_DEFINITION_MODIFY_REQUESTED` | 提交角色定义修改（改权限包组合） | S 起点 | beforeData, afterData |  | ✓ |
| `ROLE_DEFINITION_MODIFY_APPLIED` | 审批通过、修改生效 | I 继承 | beforeData, afterData, approvalNo | ✓ | ✓ |
| `ROLE_DEFINITION_MODIFY_CANCELLED` | 修改取消/被拒 | I 继承 | reason | ✓ | ✓ |

### 审批策略变更（2） — 「门自己也要过门」——改"谁能批"本身要批，裁决唯 CISO

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `APPROVAL_POLICY_CHANGE_REQUESTED` | 高管提交策略变更 | S 起点 | beforeData, afterData |  | ✓ |
| `APPROVAL_POLICY_CHANGE_APPLIED` | CISO 批准、策略翻 CUSTOMIZED | I 继承 | beforeData, afterData, policyVersion, approvalNo | ✓ | ✓ |

### 兑换费率档（建 / 改 / 退役）（11） — CFO 提、运营批

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_FEE_LEVEL_CREATION_REQUESTED` | 提交新建费率档 | S 起点 | afterData |  |  |
| `SWAP_FEE_LEVEL_CREATION_APPLIED` | 审批通过、档位生效 | I 继承 | afterData, approvalNo | ✓ |  |
| `SWAP_FEE_LEVEL_CREATION_APPLY_FAILED` | 批了但落地失败 | I 继承 | — | ✓ |  |
| `SWAP_FEE_LEVEL_CREATION_CANCELLED` | 新建取消/被拒 | I 继承 | reason | ✓ |  |
| `SWAP_FEE_LEVEL_CHANGE_REQUESTED` | 提交改档（费率/受众/分层） | S 起点 | beforeData, afterData |  |  |
| `SWAP_FEE_LEVEL_CHANGE_APPLIED` | 审批通过、改动生效 | I 继承 | beforeData, afterData, approvalNo | ✓ |  |
| `SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED` | 批了但落地失败 | I 继承 | — | ✓ |  |
| `SWAP_FEE_LEVEL_CHANGE_CANCELLED` | 改档取消/被拒 | I 继承 | reason | ✓ |  |
| `SWAP_FEE_LEVEL_RETIRE_REQUESTED` | 提交退役（"删"=终态，最后一个默认档不可退） | S 起点 | beforeData |  |  |
| `SWAP_FEE_LEVEL_RETIRED` | 审批通过、档位进 RETIRED 终态 | I 继承 | approvalNo | ✓ |  |
| `SWAP_FEE_LEVEL_RETIRE_CANCELLED` | 退役取消/被拒 | I 继承 | reason | ✓ |  |

### 提现费率档（建 / 改 / 退役）（11） — 与兑换侧逐码镜像

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAWAL_FEE_LEVEL_CREATION_REQUESTED` | 提交新建费率档 | S 起点 | afterData |  |  |
| `WITHDRAWAL_FEE_LEVEL_CREATION_APPLIED` | 审批通过、档位生效 | I 继承 | afterData, approvalNo | ✓ |  |
| `WITHDRAWAL_FEE_LEVEL_CREATION_APPLY_FAILED` | 批了但落地失败 | I 继承 | — | ✓ |  |
| `WITHDRAWAL_FEE_LEVEL_CREATION_CANCELLED` | 新建取消/被拒 | I 继承 | reason | ✓ |  |
| `WITHDRAWAL_FEE_LEVEL_CHANGE_REQUESTED` | 提交改档 | S 起点 | beforeData, afterData |  |  |
| `WITHDRAWAL_FEE_LEVEL_CHANGE_APPLIED` | 审批通过、改动生效 | I 继承 | beforeData, afterData, approvalNo | ✓ |  |
| `WITHDRAWAL_FEE_LEVEL_CHANGE_APPLY_FAILED` | 批了但落地失败 | I 继承 | — | ✓ |  |
| `WITHDRAWAL_FEE_LEVEL_CHANGE_CANCELLED` | 改档取消/被拒 | I 继承 | reason | ✓ |  |
| `WITHDRAWAL_FEE_LEVEL_RETIRE_REQUESTED` | 提交退役 | S 起点 | beforeData |  |  |
| `WITHDRAWAL_FEE_LEVEL_RETIRED` | 审批通过、档位进 RETIRED 终态 | I 继承 | approvalNo | ✓ |  |
| `WITHDRAWAL_FEE_LEVEL_RETIRE_CANCELLED` | 退役取消/被拒 | I 继承 | reason | ✓ |  |

### 资产暂停 / 恢复（6） — 运营提、CISO 批；暂停即总开关（三页下拉同时消失 + L1 第十项拦新单）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ASSET_SUSPENSION_REQUESTED` | 提暂停资产 | S 起点 | beforeData |  |  |
| `ASSET_SUSPENDED` | 审批通过、SUSPENDED 生效 | I 继承 | approvalNo | ✓ |  |
| `ASSET_SUSPENSION_FAILED` | 批了但落地失败 | I 继承 | — | ✓ |  |
| `ASSET_REACTIVATION_REQUESTED` | 提恢复资产 | S 起点 | beforeData |  |  |
| `ASSET_REACTIVATED` | 审批通过、ACTIVE 恢复 | I 继承 | approvalNo | ✓ |  |
| `ASSET_REACTIVATION_FAILED` | 批了但落地失败 | I 继承 | — | ✓ |  |

### 交易限额（改规则 + 运行时拦截）（5） — 限额只改不建不删；裁决人高管

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `TRANSACTION_LIMIT_CHANGE_REQUESTED` | 提交限额变更 | S 起点 | beforeData, afterData |  |  |
| `TRANSACTION_LIMIT_CHANGE_APPLIED` | 审批通过、新限额生效 | I 继承 | beforeData, afterData, approvalNo | ✓ |  |
| `TRANSACTION_LIMIT_CHANGE_APPLY_FAILED` | 批了但落地失败 | I 继承 | — | ✓ |  |
| `TRANSACTION_LIMIT_CHANGE_CANCELLED` | 变更取消/被拒 | I 继承 | reason | ✓ |  |
| `TRANSACTION_LIMIT_REJECTED` | L1 金额闸运行时拦下客户建单（发生在订单出生前） | N 单步 | reasonCode |  |  |

### 客户标签（2） — 单步动作，不经审批

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `CUSTOMER_TAG_ASSIGNED` | 给客户贴标签（如 VIP） | N 单步 | afterData |  |  |
| `CUSTOMER_TAG_REVOKED` | 撕标签 | N 单步 | beforeData, reason |  |  |

### 客户提现地址（24h 冷却闸全生命周期）（9）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAWAL_ADDRESS_REGISTERED` | 客户登记地址（铸地址自己的 traceId） | S 起点 | afterData |  |  |
| `WITHDRAWAL_ADDRESS_ACTIVATED` | 冷却期满自动激活 | I 继承 | — |  |  |
| `WITHDRAWAL_ADDRESS_CANCELLED` | 冷却期内客户撤销登记 | I 继承 | reason |  |  |
| `WITHDRAWAL_ADDRESS_SUSPENDED` | 金库专员强制暂停 | I 继承 | reason |  |  |
| `WITHDRAWAL_ADDRESS_UNSUSPENDED` | 金库专员恢复 | I 继承 | reason |  |  |
| `WITHDRAWAL_ADDRESS_DEACTIVATED` | 客户停用地址 | I 继承 | reason |  |  |
| `WITHDRAWAL_ADDRESS_UPDATED` | 改标签/收款人信息 | I 继承 | beforeData, afterData |  |  |
| `WITHDRAWAL_ADDRESS_COOLING_SKIPPED` | ⚡ 后门跳过冷却期（理由必填，留痕是这条码的演示点） | I 继承 | reason |  |  |
| `WITHDRAWAL_ADDRESS_REQUEST_DENIED` | 地址五门拒绝留痕（数量上限/冷却未到/最后一个法币地址等） | N 单步 | reasonCode |  |  |

### 种子身世（7） — 配置随版本装载，装载即留痕（actor=RELEASE/DEMO_SEED，seed 直写）——第七幕按资产查，第一行就是它

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ASSET_SEEDED` | 资产随版本上架入库 | S 起点 | afterData |  |  |
| `CUSTODIAN_WALLET_SEEDED` | 托管钱包地址行装载 | S 起点 | afterData |  |  |
| `TRANSACTION_LIMIT_SEEDED` | 限额规则装载 | S 起点 | afterData |  |  |
| `SWAP_FEE_LEVEL_SEEDED` | 兑换费率档装载 | S 起点 | afterData |  |  |
| `WITHDRAWAL_FEE_LEVEL_SEEDED` | 提现费率档装载 | S 起点 | afterData |  |  |
| `CUSTOMER_DEPOSIT_ADDRESS_SEEDED` | 客户充值地址装载 | S 起点 | afterData |  |  |
| `WITHDRAWAL_ADDRESS_SEEDED` | 客户提现地址装载 | S 起点 | afterData |  |  |

### 资金单模拟推进（⚡ 站在外部世界那侧）（1）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `FUNDS_ORDER_ADVANCED` | ⚡ 推资金单一步（SUBMIT/OBSERVE_CONFIRMING/CONFIRM/CLEAR/FAIL/TIMEOUT 六动作共用一码，动作值在 metadata） | N 单步 | — |  |  |

## AUDIT 域 —— 审计自身的操作（4 码）

查审计、导证据包，这些动作自己也留痕——「谁查过审计日志」是监管会问的问题。

### 证据包导出（内审建包、MLRO 背书）（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `AUDIT_EVIDENCE_EXPORT_REQUESTED` | 发起导出请求（建包 + 提 MLRO 审批） | S 起点 | — |  | ✓ |
| `AUDIT_EVIDENCE_EXPORT_GENERATED` | 审批通过后生成包（成功带摘要 / 失败也留痕） | I 继承 | payloadDigest | ✓ | ✓ |
| `AUDIT_EVIDENCE_EXPORT_DOWNLOADED` | 下载包（带来源 IP） | I 继承 | sourceIp |  | ✓ |

### 审计查询自留痕（1）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `AUDIT_LOG_QUERIED` | 每次查询审计列表自动记一条（重铺后 Q6 靠它转绿） | N 单步 | — |  |  |

## CUSTOMER 域 —— V2 客户与合规（26 码）

客户主档、限制便签（含制裁冻人）、材料请求账、现场开户（CDD/EDD）、档位升级。客户级件无订单旅程，全册单步。

### 客户主档（1）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `CUSTOMER_CREATED` | 客户建档（注册 / 管理端建） | N 单步 | ownerCustomerNo |  |  |

### 限制便签（贴 / 撕 / 冻 / 解冻）（4） — 系统命中与运营手动双通道

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `CUSTOMER_RESTRICTION_ADDED` | 开限制便签（含制裁命中自动贴） | N 单步 | — |  |  |
| `CUSTOMER_RESTRICTION_CLEARED` | 限制解除（MLRO 批准后落地） | N 单步 | — |  |  |
| `CUSTOMER_FROZEN` | 客户级冻结（制裁便签连带） | N 单步 | — |  |  |
| `CUSTOMER_UNFROZEN` | 客户级解冻 | N 单步 | — |  |  |

### 材料请求账（7）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `MATERIAL_REQUEST_ISSUED` | 合规官下发材料请求 | N 单步 | reason |  |  |
| `MATERIAL_REQUEST_SUBMITTED` | 客户提交材料 | N 单步 | — |  |  |
| `MATERIAL_REQUEST_APPROVED` | 裁决 GREEN（自动撕对应便签） | N 单步 | — |  |  |
| `MATERIAL_REQUEST_RETRY_REQUESTED` | 裁决 RED·RETRY（打回补交） | N 单步 | — |  |  |
| `MATERIAL_REQUEST_REJECTED` | 裁决 RED·FINAL（终拒，触发离场路径） | N 单步 | — |  |  |
| `MATERIAL_REQUEST_CANCELLED` | 请求作废 | N 单步 | reason |  |  |
| `MATERIAL_REQUEST_ORDER_UNBOUND` | 与订单解绑 | N 单步 | — |  |  |

### 入驻（现场开户 CDD/EDD）（8）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `ONBOARDING_VERIFICATION_STARTED` | 客户点 Start verification | N 单步 | afterData |  |  |
| `ONBOARDING_SUBMITTED` | 客户提交 CDD/EDD 材料 | N 单步 | afterData |  |  |
| `ONBOARDING_LEVEL_CHANGED` | 认证模板切换（如 Escalate to EDD） | N 单步 | beforeData, afterData |  |  |
| `ONBOARDING_VERDICT_APPLIED` | Sumsub 裁决落地（GREEN 直通 / RED 打回） | N 单步 | afterData |  |  |
| `ONBOARDING_WITHDRAWN` | 客户撤回申请 | N 单步 | — |  |  |
| `ONBOARDING_REAPPLIED` | 客户重新申请 | N 单步 | — |  |  |
| `ONBOARDING_ACCEPTANCE_SUBMITTED` | 运营提 EDD 高风险准入核准（进高管审批） | N 单步 | approvalNo, reason |  |  |
| `ONBOARDING_ACCEPTANCE_DECIDED` | 高管裁决、批准即 ACTIVE 开户 | N 单步 | approvalNo |  |  |

### 档位升级（BASIC→PREMIUM）+ 账本开户钩子（6）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `TIER_UPGRADE_APPLIED` | 客户发起升级申请 | N 单步 | afterData |  |  |
| `TIER_UPGRADE_SUBMITTED` | 客户提交 PoA/SoF 材料 | N 单步 | afterData |  |  |
| `TIER_UPGRADE_VERDICT_APPLIED` | 材料裁决落地（GREEN 过 / RED 打回） | N 单步 | afterData |  |  |
| `TIER_UPGRADE_ACCEPTANCE_SUBMITTED` | 运营提验收核准（进高管审批） | N 单步 | approvalNo, reason |  |  |
| `TIER_UPGRADE_ACCEPTANCE_DECIDED` | 高管裁决、tradingTier 翻 PREMIUM | N 单步 | approvalNo |  |  |
| `CUSTOMER_LEDGER_PROVISIONED` | 客户首次 ACTIVE 时 TB 账本户静默开好（运行时开户钩子） | N 单步 | afterData |  |  |

## DEPOSIT 域 —— V4 充值（47 码）

一笔钱进来要闯几道门；闯不过去的钱四种下场（没收/退回/上缴/解冻）。CREATED 铸旅程号，一笔充值一段链。

### 主线（建单 → 到账 → 筛查 → 放行）（7）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `DEPOSIT_CREATED` | 充值单出生（铸旅程号，带金额/币种/客户） | S 起点 | amount, currency, ownerCustomerNo |  |  |
| `DEPOSIT_PAYIN_COMPLETED` | 链上/银行确认到账 | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_HELD` | 挂起（三停摆一名三因：BELOW_MIN / LIFECYCLE / 交易未就绪，reasonCode 区分） | I 继承 | reasonCode |  |  |
| `DEPOSIT_L1_HELD` | L1 行政级问题打标不换状态、照常送检（暂停期间收钱的证据） | I 继承 | reasonCode |  |  |
| `DEPOSIT_SUMSUB_SUBMITTED` | 送 KYT 筛查 | I 继承 | — |  |  |
| `DEPOSIT_APPROVED` | 放行入账（一码四态：成功/翻案/冻结拒批/记账失败） | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_LIMIT_WAIVED` | 运营放行下限挂起（PASS · Waive Min-Limit） | I 继承 | reason |  |  |

### 裁决与复核（6）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `DEPOSIT_ONHOLD` | KYT 判 On hold 待人工 | I 继承 | — |  |  |
| `DEPOSIT_MANUAL_CHECKING` | 进人工复核 | I 继承 | reasonCode |  |  |
| `DEPOSIT_FROZEN` | 冻结（制裁命中 / L1 FREEZE 分支，含创建即冻） | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_ACTION_REQUIRED` | 要求客户补材料 | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_MATERIAL_APPROVED_RESUMED` | 材料审过、单子回炉重筛（A7 回边） | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_KYT_VERDICT_IGNORED` | 裁决到达但按当前状态判定忽略 | I 继承 | reason |  |  |

### 处置四弧（没收 / 退回 / 上缴 / 解冻，maker-checker）（17）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `DEPOSIT_CONFISCATION_REQUESTED` | 提没收（小额挂起单，CFO 裁决） | I 继承 | — |  |  |
| `DEPOSIT_CONFISCATION_STARTED` | 批准、没收执行开始 | I 继承 | approvalNo | ✓ |  |
| `DEPOSIT_CONFISCATION_RETRIED` | 没收腿重试 | I 继承 | — |  |  |
| `DEPOSIT_CONFISCATION_STUCK` | 没收腿卡住待人工 | I 继承 | — |  |  |
| `DEPOSIT_CONFISCATION_EXECUTED` | 没收完成（钱进公司费用户） | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_RETURN_REQUESTED` | 提原路退回（目的地锁死原发款方） | I 继承 | — |  |  |
| `DEPOSIT_RETURN_STARTED` | 批准、退回执行开始 | I 继承 | approvalNo | ✓ |  |
| `DEPOSIT_RETURN_RETRIED` | 退回腿重试 | I 继承 | — |  |  |
| `DEPOSIT_RETURN_STUCK` | 退回腿卡住待人工 | I 继承 | — |  |  |
| `DEPOSIT_RETURNED` | 退回完成 | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_SEIZE_REQUESTED` | 提上缴（政府移交，高管第一步） | I 继承 | — |  |  |
| `DEPOSIT_SEIZE_STARTED` | 批准、上缴执行开始 | I 继承 | approvalNo | ✓ |  |
| `DEPOSIT_SEIZE_RETRIED` | 上缴腿重试 | I 继承 | — |  |  |
| `DEPOSIT_SEIZE_STUCK` | 上缴腿卡住待人工 | I 继承 | — |  |  |
| `DEPOSIT_SEIZED` | 上缴完成 | I 继承 | fromStatus, toStatus |  |  |
| `DEPOSIT_UNFREEZE_REQUESTED` | 合规官提解冻（MLRO 裁决） | I 继承 | — |  |  |
| `DEPOSIT_UNFROZEN` | 批准、平反回炉 | I 继承 | approvalNo | ✓ |  |

### 补单与追回（平账 B 批）（7）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `DEPOSIT_SUPPLEMENT_REQUESTED` | 对账差异行发起漏记入金补录（金库提、CFO 复核） | N 单步 | — |  |  |
| `DEPOSIT_SUPPLEMENT_STARTED` | CFO 批准、补录建单 | N 单步 | approvalNo |  |  |
| `DEPOSIT_SUPPLEMENT_REJECTED` | CFO 拒绝补录 | N 单步 | approvalNo |  |  |
| `DEPOSIT_SUPPLEMENTED` | 补录充值单落地（带「补录」小标，照常过 KYT） | N 单步 | depositNo |  |  |
| `DEPOSIT_CLAWBACK_REQUESTED` | 退汇认领：入金被银行追回（金库提、CFO 复核） | I 继承 | — |  |  |
| `DEPOSIT_CLAWBACK_STARTED` | 批准、追回执行 | I 继承 | approvalNo | ✓ |  |
| `DEPOSIT_CLAWED_BACK` | 原充值单转 CLAWED BACK、客户余额扣回 | I 继承 | fromStatus, toStatus |  |  |

### 入账信号与充值地址（建单之前）（7）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `INBOUND_SIGNAL_SUBMITTED` | 客户自报「我打了这笔钱」 | N 单步 | — |  |  |
| `INBOUND_SIGNAL_SCANNED` | 客户触发扫描比对 | N 单步 | — |  |  |
| `INBOUND_SIGNAL_MATCHED` | 信号撞库匹配成功 | N 单步 | — |  |  |
| `INBOUND_SIGNAL_BLOCKED` | 信号被拦（带理由） | N 单步 | reason |  |  |
| `INBOUND_SIGNAL_FAILED` | 信号处理失败 | N 单步 | reason |  |  |
| `DEPOSIT_SIGNAL_REJECTED` | 合约对不上任何资产、建单前被拒（UNKNOWN_ASSET） | N 单步 | — |  |  |
| `CUSTOMER_DEPOSIT_ADDRESS_CREATED` | 客户在某网络开收款地址（钱包表唯一写路径） | N 单步 | afterData |  |  |

### SLA 与演示（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `DEPOSIT_SLA_BREACHED` | 处理时限软破线 | I 继承 | fromStatus |  |  |
| `DEPOSIT_SLA_TIMEOUT_SIMULATED` | ⚡ 拨钟模拟 SLA 超时 | I 继承 | — |  |  |
| `DEPOSIT_DEMO_SCENARIO_RUN` | ⚡ 喂裁决按钮被按下（demo 元审计：谁点了哪个） | I 继承 | — |  |  |

## WITHDRAW 域 —— V5 提现（33 码）

出金门最多：地址白名单、限额、大额审批、KYT、补料。钱后动拆三码（发起/完成/终态），银行退票与事后退回都有名字。

### 出生与 L1 闸（2）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_CREATED` | 提现单出生（铸旅程号；消费报价一并发生） | S 起点 | amount, currency, ownerCustomerNo |  |  |
| `WITHDRAW_L1_BLOCKED` | L1 十项闸拦下建单（单未建、无单号，主体=客户） | N 单步 | reasonCode |  |  |

### 大额审批闸（SMO）（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_LARGE_VALUE_REQUESTED` | 触线进大额审批 | I 继承 | — |  |  |
| `WITHDRAW_LARGE_VALUE_PASSED` | 高管批准放行 | I 继承 | approvalNo, fromStatus, toStatus | ✓ |  |
| `WITHDRAW_REJECTED` | 高管拒绝、整单终止退锁 | I 继承 | approvalNo, fromStatus, toStatus | ✓ |  |

### 合规流转（KYT + 补料 + 冻结落地）（9）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_SUMSUB_SUBMITTED` | 送 KYT 筛查 | I 继承 | — |  |  |
| `WITHDRAW_ONHOLD` | KYT 判 On hold | I 继承 | — |  |  |
| `WITHDRAW_MANUAL_CHECKING` | 进人工复核 | I 继承 | fromStatus, toStatus |  |  |
| `WITHDRAW_ACTION_REQUIRED` | 要求客户补材料（Sumsub 内嵌补料） | I 继承 | fromStatus, toStatus |  |  |
| `WITHDRAW_MATERIAL_APPROVED_RESUMED` | 材料审过、回炉重筛（B3 回边） | I 继承 | fromStatus, toStatus |  |  |
| `WITHDRAW_FROZEN` | 冻结（⑨ 调查扣审只冻单 / ⑦ 制裁连坐，含创建即冻） | I 继承 | fromStatus, toStatus |  |  |
| `WITHDRAW_KYT_VERDICT_IGNORED` | 裁决到达但被判定忽略 | I 继承 | reason |  |  |
| `WITHDRAW_POST_BROADCAST_VERDICT` | 钱已广播后才到的裁决（在途裁决窗口） | I 继承 | reason |  |  |
| `WITHDRAW_COMPLIANCE_PASSED` | 合规通过、进付款 | I 继承 | fromStatus, toStatus |  |  |

### 付款与终局（4）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_PAYOUT_INITIATED` | 发起对外付款 | I 继承 | — |  |  |
| `WITHDRAW_PAYOUT_COMPLETED` | 付款外部确认+落账（一码双结局：失败=整单败+解锁） | I 继承 | — |  |  |
| `WITHDRAW_BOUNCED` | 银行退票 | I 继承 | fromStatus, toStatus |  |  |
| `WITHDRAW_SUCCESS` | 整单成功终态 | I 继承 | fromStatus, toStatus |  |  |

### 费用尾巴（2）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_FEE_RETRIED` | 费腿重试 | I 继承 | — |  |  |
| `WITHDRAW_FEE_STUCK` | 费腿卡住待人工 | I 继承 | — |  |  |

### 冻结处置与事后退回（7）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_UNFREEZE_REQUESTED` | 合规官提解冻（MLRO 裁决） | I 继承 | — |  |  |
| `WITHDRAW_UNFROZEN` | 批准、回正常轨道 | I 继承 | approvalNo | ✓ |  |
| `WITHDRAW_REFUND_REQUESTED` | 提裁决退款（冻结单拒退） | I 继承 | — |  |  |
| `WITHDRAW_REFUNDED` | 退款落地、锁放回余额 | I 继承 | fromStatus, toStatus |  |  |
| `WITHDRAW_RETURN_CLAIM_REQUESTED` | 出金被银行退回的认领（金库提、CFO 复核） | I 继承 | — |  |  |
| `WITHDRAW_RETURN_CLAIM_STARTED` | CFO 批准、认领执行 | I 继承 | approvalNo | ✓ |  |
| `WITHDRAW_RETURNED_AFTER_SUCCESS` | 已成功单转 RETURNED、本金净额回余额（手续费不退） | I 继承 | fromStatus, toStatus |  |  |

### 报价（3） — 报价先于提现单出生，无旅程可继承

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_QUOTE_CREATED` | 客户拿报价 | N 单步 | — |  |  |
| `WITHDRAW_QUOTE_USED` | 报价被建单消费 | N 单步 | — |  |  |
| `WITHDRAW_QUOTE_CANCELLED` | 报价取消 | N 单步 | — |  |  |

### SLA 与演示（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `WITHDRAW_SLA_BREACHED` | 处理时限软破线 | I 继承 | fromStatus |  |  |
| `WITHDRAW_SLA_TIMEOUT_SIMULATED` | ⚡ 拨钟模拟 SLA 超时 | I 继承 | — |  |  |
| `WITHDRAW_DEMO_SCENARIO_RUN` | ⚡ 喂裁决按钮被按下 | I 继承 | — |  |  |

## SWAP 域 —— V6 兑换（26 码）

拿报价换币、四腿原子记账、大额过合规；下单即上出生锁。FROZEN 自 2026-09-14 起是押锁待处置的中间态（解冻续走 / 拒退两条出边）。

### 出生与 L1 闸（2）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_CREATED` | 兑换单出生（铸旅程号，携出生锁金额） | S 起点 | amount, currency, ownerCustomerNo |  |  |
| `SWAP_L1_BLOCKED` | L1 十项闸拦下建单 | N 单步 | reasonCode |  |  |

### KYT 合规（6）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_KYT_SUBMITTED` | 送 KYT 筛查 | I 继承 | — |  |  |
| `SWAP_KYT_APPROVED` | KYT 通过、进结算 | I 继承 | fromStatus, toStatus |  |  |
| `SWAP_KYT_REJECTED` | KYT 拒绝（出生锁随处置口径动） | I 继承 | fromStatus, toStatus |  |  |
| `SWAP_KYT_VERDICT_IGNORED` | 裁决到达但被判定忽略 | I 继承 | reason |  |  |
| `SWAP_POST_APPROVAL_VERDICT` | 已放行后才到的裁决 | I 继承 | reason |  |  |
| `SWAP_KYT_REJECTED_DISPOSED` | 拒绝后的通知决策留痕（tipping-off 决策本身是业务事件） | I 继承 | reason |  |  |

### 冻结与处置（波五中间态）（5）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_FROZEN` | 冻结（押锁不放，含创建即冻） | I 继承 | fromStatus, toStatus |  |  |
| `SWAP_UNFREEZE_REQUESTED` | 合规官提解冻（MLRO 裁决） | I 继承 | — |  |  |
| `SWAP_UNFROZEN` | 批准、RESUME 回 COMPLIANCE_PENDING（锁原封押着，5 分钟 SLA 重计时） | I 继承 | approvalNo | ✓ |  |
| `SWAP_REFUND_REQUESTED` | 运营提拒退（MLRO 裁决） | I 继承 | — |  |  |
| `SWAP_REFUNDED` | 拒退落地、出生锁放回余额 | I 继承 | fromStatus, toStatus |  |  |

### 结算四腿（5）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_LEG_POSTED` | 一条腿记账落地 | I 继承 | — |  |  |
| `SWAP_LEG_RETRIED` | 腿重试 | I 继承 | — |  |  |
| `SWAP_LEG_STUCK` | 腿卡住待人工（needsReview） | I 继承 | — |  |  |
| `SWAP_LEG_RESUMED` | 人工恢复卡住的腿 | I 继承 | — |  |  |
| `SWAP_LEG_HALTED_BY_RESTRICTION` | 客户限制把在途腿按停 | I 继承 | — |  |  |

### 终局与客户级（2）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_SUCCEEDED` | 四腿齐、整单成功 | I 继承 | fromStatus, toStatus |  |  |
| `SWAP_ACTION_GREEN_HARDLINE_HELD` | GREEN 但硬线规则仍按住（客户级） | I 继承 | reason |  |  |

### 报价（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_QUOTE_CREATED` | 客户拿报价（费率档命中在此刻定） | N 单步 | — |  |  |
| `SWAP_QUOTE_USED` | 报价被建单消费 | N 单步 | — |  |  |
| `SWAP_QUOTE_CANCELLED` | 报价取消 | N 单步 | — |  |  |

### SLA 与演示（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `SWAP_SLA_BREACHED` | 处理时限软破线 | I 继承 | fromStatus |  |  |
| `SWAP_SLA_TIMEOUT_SIMULATED` | ⚡ 拨钟模拟 SLA 超时 | I 继承 | — |  |  |
| `SWAP_DEMO_SCENARIO_RUN` | ⚡ 喂裁决按钮被按下 | I 继承 | — |  |  |

## TREASURY 域 —— V7 财资（内部划转单）（7 码）

公司的钱给客户：认损补款 / 退汇垫款。第四类订单，法币两腿经结算户、加密币一腿；金库提、CFO 批。

### 内部划转单生命周期（7）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `INTERNAL_TRANSFER_REQUESTED` | 发起补款/垫款（案子上预填、金库提交） | N 单步 | amount, reason |  |  |
| `INTERNAL_TRANSFER_CANCELLED` | 撤单 | I 继承 | reason |  |  |
| `INTERNAL_TRANSFER_REJECTED` | CFO 拒绝 | I 继承 | approvalNo | ✓ |  |
| `INTERNAL_TRANSFER_EXECUTION_STARTED` | CFO 批准、执行开始 | I 继承 | approvalNo | ✓ |  |
| `INTERNAL_TRANSFER_LEG_POSTED` | 一条腿落账（法币两腿各一条） | I 继承 | amount |  |  |
| `INTERNAL_TRANSFER_SETTLED` | 整单结清、客户余额复位 | I 继承 | amount, effectiveDate |  |  |
| `INTERNAL_TRANSFER_FAILED` | 执行失败（腿 2 失败款停结算户，人工处理） | I 继承 | reasonCode |  |  |

## RECON 域 —— V8 对账（9 码）

逐钱包逐笔核对、破口开案、按格处置。对账件天生无客户旅程；唯推单/调账落在父单旅程里。

### 跑批与案件（3）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `RECON_RUN_COMPLETED` | 跑批完成（cron 系统通道 / 管理员触发操作员通道，同码不拆名） | N 单步 | — |  |  |
| `RECON_CASE_OPENED` | 破口开案（钱包/桶/差额在 metadata） | N 单步 | — |  |  |
| `RECON_CASE_AUTO_HEALED` | 重对账后案件自愈 | N 单步 | — |  |  |

### 差异行处置（4）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `RECON_DISPOSITION_RECORDED` | 差异行定性（成因码 + 出口，含挂起两种零账务处置） | N 单步 | causeCode, outlet |  |  |
| `RECON_ADJUSTMENT_DRAFTED` | 开调账单（DRAFT，冲正/冲销/补记/改记四族通用） | N 单步 | reasonCode, amount |  |  |
| `RECON_ADJUSTMENT_POSTED` | CFO 批准后调账落账（继承案件旅程） | I 继承 | reasonCode, amount, effectiveDate |  |  |
| `RECON_PUSH_ORDER` | 在途资金单推单（落在父单旅程里） | I 继承 | fromStatus, toStatus |  |  |

### 账龄（2）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `RECON_CASE_AGING_BREACHED` | 账龄到线（系统通道，actor=AGING_TIMER，核销/认损按钮由此解锁） | N 单步 | — |  |  |
| `RECON_AGING_TIMEOUT_SIMULATED` | ⚡ 拨钟：把账龄截止拨到过去（拨钟一条、到线一条，各说各的事） | N 单步 | — |  |  |

## GOVERNANCE 域 —— 事故登记（平账三期）（20 码）

性质严重的差异正式立「事故」：登记 / 调查 / 定损 / 通报 / 善后 / 结案，全程零账务；动钱挂调账单与划转单引用。

### 事故一生（金库操作、结案两步门）（9）

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `INCIDENT_REGISTERED` | 登记事故（四类：未授权转出/大额查不出/客户欠款/人工） | S 起点 | type |  |  |
| `INCIDENT_INVESTIGATION_STARTED` | 开始调查 | N 单步 | fromStatus, toStatus |  |  |
| `INCIDENT_NOTE_ADDED` | 添加调查记录 | N 单步 | body |  |  |
| `INCIDENT_ESCALATED` | 记录升级（MLRO / CFO / 高管） | N 单步 | escalatedTo |  |  |
| `INCIDENT_ASSESSED` | 提交定损（口径 + 是否需要监管通报） | N 单步 | assessmentBasis |  |  |
| `INCIDENT_REMEDIATION_LINKED` | 挂载善后单（调账单/划转单引用） | N 单步 | referenceNo |  |  |
| `INCIDENT_CLOSE_REQUESTED` | 提结案（安全类两步 MLRO→CFO / 财务类单步 CFO） | I 继承 | — |  |  |
| `INCIDENT_CLOSED` | 审批通过、事故 CLOSED | I 继承 | approvalNo | ✓ |  |
| `INCIDENT_WITHDRAWN` | 撤回误登记（仅 REGISTERED 态，理由留痕，不是删除） | N 单步 | reason |  |  |

### 报送台生命周期（11） — 战役甲波二新增，事故定损批量开单 / 合规官手动开单两条入口共用；波三报文族加不报结案

| 动作码 | 说明 | 旅程 | 必填字段 | 异步 | subjects |
|---|---|---|---|---|---|
| `FILING_OPENED` | 开一张报送单（事故定损批量开单 / 合规官手动开单，选定报送类型与依据） | S 起点 | type |  |  |
| `FILING_DRAFT_SAVED` | 保存报送正文草稿（首次记审计，续存不重记） | N 单步 | — |  |  |
| `FILING_SIGNOFF_REQUESTED` | 送签（草稿转入待签核，进审批旅程） | I 继承 | approvalNo |  |  |
| `FILING_SIGNED_OFF` | 签核通过（审批裁决驱动） | I 继承 | approvalNo | ✓ |  |
| `FILING_SIGNOFF_REJECTED` | 签核被拒，退回起草（审批裁决驱动） | I 继承 | approvalNo, reason | ✓ |  |
| `FILING_SUBMITTED` | 标记已提交监管机构（落外部编号；同事故钟链兄弟单在此落定时限） | N 单步 | externalRef |  |  |
| `FILING_ENTRY_LOGGED` | 记一条往来记录（仅 SUBMITTED 可记，如监管来函 / 我方回复） | N 单步 | kind |  |  |
| `FILING_OVERDUE_MARKED` | 扫描到期未提交，标记逾期（系统通道） | N 单步 | deadlineAt |  |  |
| `FILING_CLOSED` | 结案（仅 SUBMITTED 可结） | N 单步 | — |  |  |
| `FILING_CANCELLED` | 作废（仅 DRAFT 可撤，理由留痕） | N 单步 | reason |  |  |
| `FILING_CLOSED_NO_FILING` | 报文族「决定不报」结案（仅 STR/SAR，理由留痕——no-file decision 法定可辩护，MLRO 亲办） | N 单步 | noFilingReason |  |  |

## 附录 · 退役码（拒写闸名单，历史可读、不再允许写入）

退役码进拒写闸，共 117 码：

- `FIRST_LOGIN_MFA_VERIFY_FAILED`
- `DEPOSIT_GATE0_PASSED`
- `DEPOSIT_HELD_BELOW_MIN`
- `DEPOSIT_HELD_NOT_TRADING_READY`
- `DEPOSIT_PAYIN_CONFIRMED`
- `DEPOSIT_PAYIN_FAILED`
- `DEPOSIT_COMPLETED`
- `DEPOSIT_COMPLIANCE_STARTED`
- `DEPOSIT_MANUAL_APPROVED`
- `DEPOSIT_APPROVE_BLOCKED_FROZEN`
- `DEPOSIT_ACCOUNTING_BLOCKED`
- `DEPOSIT_AWAITUSER_EMPTY_ACTIONS`
- `DEPOSIT_SANCTION_HIT_ON_IGNORED_VERDICT`
- `DEPOSIT_CONFISCATION_FAILED`
- `DEPOSIT_CONFISCATION_UNLOCK_FAILED`
- `DEPOSIT_RETURN_APPROVAL_REQUESTED`
- `DEPOSIT_SEIZE_APPROVAL_REQUESTED`
- `DEPOSIT_UNFREEZE_APPROVAL_REQUESTED`
- `DEPOSIT_LEG_CLEAR_FAILED`
- `WITHDRAW_REQUESTED`
- `WITHDRAW_APPROVAL_REQUESTED`
- `WITHDRAW_APPROVAL_GRANTED`
- `WITHDRAW_APPROVAL_DECLINED`
- `WITHDRAW_MANUAL_APPROVED`
- `WITHDRAW_ACCOUNTING_POSTED`
- `WITHDRAW_PAYOUT_CONFIRMED`
- `WITHDRAW_PAYOUT_FAILED`
- `WITHDRAW_SANCTION_HIT_ON_IGNORED_VERDICT`
- `WITHDRAW_REFUNDED_BY_TAG`
- `WITHDRAW_SANCTION_REFUNDED`
- `WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED`
- `WITHDRAW_LOCK_RELEASED`
- `WITHDRAW_AWAITUSER_EMPTY_ACTIONS`
- `WITHDRAW_UNFREEZE_APPROVAL_REQUESTED`
- `WITHDRAW_SANCTION_REFUND_APPROVAL_REQUESTED`
- `WITHDRAW_FEE_LEG_REBUILT`
- `WITHDRAW_FEE_SETTLE_STUCK`
- `SWAP_FAILED`
- `SWAP_KYT_SUBMIT_FAILED`
- `SWAP_KYT_REJECTED_DISPOSITION_FAILED`
- `SYSTEM_RECON_RUN_COMPLETED`
- `SYSTEM_RECON_CASE_AUTO_HEALED`
- `RECON_PUSH_ORDER_SYNCED`
- `RECON_PUSH_ORDER_MANUAL`
- `DEPOSIT_WALLET_CREATE_FAILED`
- `RESET_FAILED`
- `CHANGE_APPLY_FAILED`
- `ROLE_ACTIVATE_FAILED`
- `ROLE_MODIFY_FAILED`
- `MODIFICATION_APPLY_FAILED`
- `GENERATION_FAILED`
- `ADMIN_LOGIN_SUCCESS`
- `ADMIN_LOGIN_FAILED`
- `REGULATORY_GATE_CREATED`
- `REGULATORY_GATE_UPDATED`
- `REGULATORY_GATE_SUBMITTED`
- `REGULATORY_GATE_FEEDBACK_RECORDED`
- `REGULATORY_GATE_RECEIPT_BOUND`
- `REGULATORY_GATE_MARKED_EFFECTIVE`
- `REGULATORY_GATE_REVOKED`
- `SHAREHOLDING_REGISTRY_CREATED`
- `SHAREHOLDING_REGISTRY_UPDATED`
- `APPOINTMENT_RECORD_CREATED`
- `APPOINTMENT_RECORD_UPDATED`
- `TRAINING_RECORD_CREATED`
- `TRAINING_RECORD_UPDATED`
- `CONFLICT_DISCLOSURE_CREATED`
- `CONFLICT_DISCLOSURE_UPDATED`
- `WIND_DOWN_MATERIAL_CREATED`
- `WIND_DOWN_MATERIAL_UPDATED`
- `LP_CONFIG_UPDATED`
- `MANUAL_TB_ACCOUNT_CREATED`
- `SUSPENSION_REQUESTED`
- `SUSPENSION_EXECUTION_FAILED`
- `REACTIVATION_REQUESTED`
- `REACTIVATION_EXECUTION_FAILED`
- `ACTIVATION_REQUESTED`
- `ACTIVATION_FAILED`
- `CREATION_REQUESTED`
- `CREATION_APPLIED`
- `CREATION_APPLY_FAILED`
- `CREATION_CANCELLED`
- `CHANGE_REQUESTED`
- `CHANGE_APPLIED`
- `CHANGE_CANCELLED`
- `TAG_ASSIGNED`
- `TAG_REVOKED`
- `CREATE_REQUESTED`
- `WALLET_CREATED`
- `WALLET_CREATE_FAILED`
- `CREATE_CANCELLED`
- `ADDRESS_REGISTERED`
- `ADDRESS_ACTIVATED`
- `ADDRESS_CANCELLED`
- `ADDRESS_SUSPENDED`
- `ADDRESS_DEACTIVATED`
- `MANUAL_COOLING_SKIP`
- `ASSET_CREATED_AND_PROVISIONED`
- `ASSET_CREATION_FAILED`
- `ASSET_PROVISIONING_UPDATED`
- `ASSET_ACTIVATION_REQUESTED`
- `ASSET_ACTIVATED`
- `ASSET_ACTIVATION_FAILED`
- `CUSTODIAN_WALLET_CREATE_REQUESTED`
- `CUSTODIAN_WALLET_CREATED`
- `CUSTODIAN_WALLET_CREATE_FAILED`
- `CUSTODIAN_WALLET_CREATE_CANCELLED`
- `WALLET_STATUS_UPDATED`
- `DEPOSIT_WALLET_CREATED`
- `TRANSACTION_LIMIT_CREATION_REQUESTED`
- `TRANSACTION_LIMIT_CREATION_APPLIED`
- `TRANSACTION_LIMIT_CREATION_APPLY_FAILED`
- `TRANSACTION_LIMIT_CREATION_CANCELLED`
- `CUSTOMER_UPDATED`
- `CUSTOMER_DELETED`
- `INCIDENT_REGULATOR_REPORT_DRAFTED`
- `INCIDENT_REGULATOR_REPORTED`

> 另有动态迁移码族按形状拒写：`<域>_<从>_TO_<到>`（RETIRED_DYNAMIC_TRANSITION_PATTERN）。
