# CustomerMain 主表设计

Last Updated: 2026-05-08 | 状态: 设计定稿 | 受众: 开发工程师

---

## 一、设计目标

为 V3（财务配置）和 V4（充值流程）打地基：定义 CustomerMain 主表的字段、状态轴、限制机制和属性，使后续版本可以直接依赖客户表进行门控和限额查询，而无需等待 V2 全部 workflow 实现。

---

## 二、设计原则

1. **状态轴独立**：每个状态轴回答一个独立问题，由不同角色/系统控制，互不干扰
2. **全局开关 vs 局部限制分层**：`adminStatus` 和 `complianceStatus` 是全局开关（一旦触发，停止一切）；`restrictions` 是局部限制（ACTIVE + CLEAR 时才看）
3. **restrictions 是可解释通道**：restrictions 数组里的每一条都是可以告诉客户的；不能告诉客户的走 `complianceStatus = FROZEN`
4. **限额走档位制**：`investorTier` 指向限额策略表，不在客户主表上存具体限额数值
5. **冗余字段合并**：消除多个表达同一语义的字段（riskScore/riskLevel/riskTier/amlRiskTier 四合一）

---

## 三、状态轴设计

### 3.1 onboardingStatus — "准入了吗？"

| 值 | 含义 |
|---|---|
| `NONE` | 未开始验证 |
| `PENDING_VERIFICATION` | Sumsub 验证进行中 |
| `FINAL_APPROVAL` | 等待 MLRO 终审 |
| `APPROVED` | 准入通过 |
| `REJECTED` | 准入被拒 |
| `WITHDRAWN` | 客户主动撤回 |

- 控制者：Sumsub + MLRO 终审
- 性质：一次性旅程，APPROVED 后基本不再变化
- 门控：非 APPROVED → V3 不开 TigerBeetle 账户，V4 不接受充值

### 3.2 adminStatus — "能不能用平台？"

| 值 | 含义 |
|---|---|
| `INACTIVE` | 未激活（onboarding 未完成） |
| `ACTIVE` | 正常使用 |
| `SUSPENDED` | 行政暂停（可以告诉客户原因） |
| `OFFBOARDED` | 已注销（不可逆） |

- 控制者：管理层（通过审批 workflow）
- 性质：管理层主开关
- 门控：非 ACTIVE → 所有交易操作阻断
- 附属字段：`suspendedReason`、`suspendedAt`
- 客户体感：可以告诉客户原因，可以引导联系客服/提交申诉

### 3.3 complianceStatus — "合规有没有冻结？"

| 值 | 含义 |
|---|---|
| `CLEAR` | 无合规冻结 |
| `FROZEN` | 合规冻结 |

- 控制者：合规系统自动 / MLRO
- 性质：合规开关，独立于 adminStatus
- 门控：FROZEN → 所有交易操作阻断
- 附属字段：`complianceFreezeReason`、`complianceFreezeCaseId`、`complianceFreezeAt`、`complianceFreezeReleasedAt`
- 客户体感：**法律禁止告诉客户真实原因（tipping-off 禁令）**，只能显示"Your account is under review"

### 3.4 三轴联动规则

| 规则 | 含义 |
|---|---|
| `onboardingStatus ≠ APPROVED` → `adminStatus` 必须是 `INACTIVE` | 没准入不能激活 |
| `adminStatus ≠ ACTIVE` → 所有交易操作阻断，restrictions 不用看 | 全局开关关了 |
| `complianceStatus = FROZEN` → 所有交易操作阻断，restrictions 不用看 | 全局开关关了 |
| 两个全局开关都通过 → 看 `restrictions` 决定哪些具体操作被限制 | 局部限制层 |

---

## 四、细粒度限制（restrictions）

### 4.1 字段定义

```
restrictions  Json  @default("[]")
```

### 4.2 单条 restriction 结构

```json
{
  "capability": "WITHDRAW",
  "reason": "PROFILE_CHANGE_COOLDOWN",
  "guidance": "WAIT_COOLDOWN",
  "source": "PROFILE_CHANGE",
  "sourceRef": "profile-change-2026-05-08",
  "blockedAt": "2026-05-08T10:00:00Z",
  "expiresAt": "2026-05-10T10:00:00Z"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `capability` | String | 是 | 被限制的能力：`DEPOSIT` / `WITHDRAW` / `SWAP` / `WALLET_CREATE` / `ALL` |
| `reason` | String | 是 | 限制原因（机器可读）：`DOCUMENT_EXPIRED` / `COOLDOWN` / `SECURITY_REVIEW` / `PROFILE_CHANGE_COOLDOWN` 等 |
| `guidance` | String | 是 | 客户引导类型：`REFRESH_DOCUMENTS` / `WAIT_COOLDOWN` / `CONTACT_SUPPORT` / `NONE` |
| `source` | String | 是 | 限制来源：`MATERIAL_REFRESH` / `SYSTEM` / `PROFILE_CHANGE` / `KYT_REVIEW` 等 |
| `sourceRef` | String? | 否 | 来源引用（如 MaterialRefreshCycle 的 No） |
| `blockedAt` | ISO8601 | 是 | 限制开始时间 |
| `expiresAt` | ISO8601? | 否 | 自动过期时间（有的限制不会自动过期） |

### 4.3 与状态轴的联动

```
adminStatus → SUSPENDED 时：
  追加 { capability: "ALL", reason: "ACCOUNT_SUSPENDED", guidance: "CONTACT_SUPPORT" }
adminStatus → ACTIVE 时：
  移除 reason === "ACCOUNT_SUSPENDED" 的条目

complianceStatus → FROZEN 时：
  追加 { capability: "ALL", reason: "UNDER_REVIEW", guidance: "NONE" }
complianceStatus → CLEAR 时：
  移除 reason === "UNDER_REVIEW" 的条目
```

### 4.4 client-web 渲染逻辑

```typescript
function getAccountDisplayState(customer): 'GREEN' | 'YELLOW' | 'RED' | 'BLACK' {
  if (customer.complianceStatus === 'FROZEN')   return 'BLACK';
  if (customer.adminStatus === 'SUSPENDED')     return 'RED';
  if (customer.restrictions.length > 0)         return 'YELLOW';
  return 'GREEN';
}
```

### 4.5 V4 充值门控

```typescript
if (customer.onboardingStatus !== 'APPROVED')              → reject
if (customer.adminStatus !== 'ACTIVE')                     → reject
if (customer.complianceStatus !== 'CLEAR')                 → reject
if (restrictions.some(r => r.capability === 'DEPOSIT'))    → hold in Suspense
// 通过后 → 查 investorTier 对应的限额表
```

---

## 五、产品属性

### 5.1 investorTier — 限额档位

| 值 | 含义 |
|---|---|
| `STANDARD` | 默认档位（Level 1） |
| `ENHANCED` | 升级档位（Level 2），通过 Tier Upgrade workflow 获得 |

- `investorTierSource`：`ONBOARDING`（默认）/ `ADMIN_OVERRIDE`
- V4/V5/V6 读 `investorTier` 查限额策略表，不在客户主表上存限额数值
- 未来需要个体覆盖时，新建 `customer_limit_overrides` 表，不改主表

---

## 六、合规属性

| 字段 | 值域 | 用途 |
|---|---|---|
| `riskRating` | `LOW` / `MEDIUM` / `HIGH` | 风险等级，决定监控强度和复审频率 |
| `riskRatingUpdatedAt` | DateTime? | 最近风险评级更新时间 |
| `eddRequired` | Boolean | HIGH 时触发 EDD 调查 |
| `pepStatus` | `NONE` / `CONFIRMED` / `CLEARED` | PEP 状态 |
| `pepConfirmedAt` | DateTime? | PEP 确认时间 |
| `cddDocumentExpiresAt` | DateTime? | CDD 证件过期时间 |

---

## 七、完整 Prisma Model

```prisma
model CustomerMain {
  // ═══ 身份 ═══
  id              String    @id @default(uuid())
  customerNo      String    @unique @default("TEMP")
  customerType    String    @default("INDIVIDUAL") // INDIVIDUAL, CORPORATE
  email           String?   @unique
  phone           String?   @unique
  emailVerifiedAt DateTime?
  phoneVerifiedAt DateTime?
  firstName       String?
  lastName        String?
  companyName     String?

  // ═══ 认证 / 安全 ═══
  passwordHash      String?
  passwordUpdatedAt DateTime?
  failedLoginCount  Int       @default(0)
  lockedUntil       DateTime?
  lastLoginAt       DateTime?
  lastLoginIp       String?
  locale            String?
  timezone          String?
  termsAcceptedAt   DateTime?

  // ═══ 状态轴 1：准入旅程（一次性） ═══
  onboardingStatus  String    @default("NONE")
  onboardingTraceId String?

  // ═══ 状态轴 2：行政生命周期 ═══
  adminStatus       String    @default("INACTIVE")
  suspendedReason   String?
  suspendedAt       DateTime?

  // ═══ 状态轴 3：合规冻结 ═══
  complianceStatus           String    @default("CLEAR")
  complianceFreezeReason     String?
  complianceFreezeCaseId     String?
  complianceFreezeAt         DateTime?
  complianceFreezeReleasedAt DateTime?

  // ═══ 细粒度限制（client-web 直接消费） ═══
  restrictions Json @default("[]")

  // ═══ 产品属性 ═══
  investorTier          String    @default("STANDARD")
  investorTierSource    String    @default("ONBOARDING")
  investorTierUpdatedAt DateTime?

  // ═══ 合规属性 ═══
  riskRating          String    @default("LOW")
  riskRatingUpdatedAt DateTime?
  eddRequired         Boolean   @default(false)
  pepStatus           String    @default("NONE")
  pepConfirmedAt      DateTime?
  cddDocumentExpiresAt DateTime?

  // ═══ Sumsub 集成 ═══
  sumsubApplicantId                  String?   @unique
  sumsubCurrentLevelName             String?
  sumsubLatestReviewId               String?
  sumsubLatestAttemptId              String?
  sumsubExperiencedLevel2            Boolean   @default(false)
  verificationProvider               String?
  verificationSubstatus              String?
  verificationCustomerActionRequired Boolean   @default(false)
  verificationCanContinue            Boolean   @default(false)
  verificationLatestEventType        String?
  verificationLatestEventAt          DateTime?

  // ═══ 工作流指针 ═══
  latestRiskApprovalId        String?   @unique
  latestRiskApprovalStatus    String?
  latestRiskAssessmentId      String?
  latestDecisionRecordId      String?
  activePeriodicReviewCycleId String?   @unique
  nextReviewAt                DateTime?

  // ═══ 时间戳 ═══
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // ═══ Relations ═══
  depositTransactions       DepositTransaction[]
  swapTransactions          SwapTransaction[]
  withdrawTransactions      WithdrawTransaction[]
  payouts                   Payout[]
  payins                    Payin[]
  inboundTransferSignals    InboundTransferSignal[]
  cddResponses              CddResponse[]
  eddResponses              EddResponse[]
  corporateProfile          CorporateProfile?
  uboProfiles               UboProfile[]
  onboardingAuditLogs       OnboardingAuditLog[]
  workflowDecisionRecords   WorkflowDecisionRecord[]
  complianceSessions        ComplianceSession[]
  cddResponseReports        CddResponseReport[]
  eddResponseReports        EddResponseReport[]
  latestRiskApproval        ApprovalCase?            @relation("CustomerLatestRiskApproval", fields: [latestRiskApprovalId], references: [id], onDelete: SetNull)
  activePeriodicReviewCycle PeriodicReviewCycle?     @relation("CustomerActivePeriodicReviewCycle", fields: [activePeriodicReviewCycleId], references: [id], onDelete: SetNull)
  periodicReviewCycles      PeriodicReviewCycle[]    @relation("CustomerPeriodicReviewCycles")
  materialHoldings          CustomerMaterialHolding[] @relation("CustomerMaterialHoldings")
  materialRefreshCycles     MaterialRefreshCycle[]   @relation("CustomerMaterialRefreshCycles")
  riskAssessments           ClientRiskAssessment[]   @relation("CustomerRiskAssessments")
  tierUpgradeCases          TierUpgradeCase[]        @relation("CustomerTierUpgradeCases")

  @@index([adminStatus])
  @@index([complianceStatus])
  @@index([riskRating])
  @@index([activePeriodicReviewCycleId])
  @@map("customer_main")
}
```

---

## 八、变更清单（当前 schema → 新 schema）

| 类型 | 旧字段 | 新字段 | 说明 |
|---|---|---|---|
| 重命名 | `operatingStatus` | `adminStatus` | 明确行政控制语义，扩展值域加 SUSPENDED/OFFBOARDED |
| 重命名 | `complianceHoldStatus` | `complianceStatus` | 简洁，值域 ACTIVE/FROZEN → CLEAR/FROZEN |
| 重命名 | `complianceHoldReason` | `complianceFreezeReason` | 动作语义更准确 |
| 重命名 | `complianceHoldCaseId` | `complianceFreezeCaseId` | 同上 |
| 重命名 | `complianceHoldSetAt` | `complianceFreezeAt` | 同上 |
| 重命名 | `complianceHoldReleasedAt` | `complianceFreezeReleasedAt` | 同上 |
| 重命名 | `investorClassification` | `investorTier` | 它是限额查找键 |
| 重命名 | `investorClassificationSource` | `investorTierSource` | 跟随主字段 |
| 重命名 | `investorClassificationUpdatedAt` | `investorTierUpdatedAt` | 跟随主字段 |
| 新增 | — | `adminStatus` 扩展值域 | 覆盖 SUSPENDED + OFFBOARDED |
| 新增 | — | `suspendedReason` | 行政暂停原因 |
| 新增 | — | `suspendedAt` | 行政暂停时间 |
| 新增 | — | `restrictions` (Json) | 细粒度限制 + 客户引导 |
| 合并 | `riskScore` / `riskLevel` / `riskTier` / `amlRiskTier` | `riskRating` | 四合一 |
| 合并 | `riskUpdatedAt` / `riskTierUpdatedAt` | `riskRatingUpdatedAt` | 合并 |
| 删除 | `restrictionStatus` | — | 被 restrictions JSON 替代 |
| 删除 | `restrictionCaseId` | — | 同上 |
| 删除 | `restrictionReason` | — | 同上 |
| 删除 | `restrictionSetAt` | — | 同上 |
| 删除 | `restrictionReleasedAt` | — | 同上 |
| 删除 | `riskScore` | — | 冗余 |
| 删除 | `riskLevel` | — | 冗余 |
| 删除 | `periodicReviewOverdueAt` | — | 属于 PeriodicReviewCycle 表 |
| 删除 | `periodicReviewOverdueReason` | — | 属于 PeriodicReviewCycle 表 |
| 默认值 | `customerType @default("UNKNOWN")` | `@default("INDIVIDUAL")` | MVP 只服务个人 |
| 默认值 | `investorTierSource @default("CDD")` | `@default("ONBOARDING")` | 语义更准确 |
| 索引 | `@@index([complianceHoldStatus])` | `@@index([complianceStatus])` | 跟随重命名 |
| 索引 | `@@index([latestRiskApprovalStatus])` | `@@index([riskRating])` | 更有查询价值 |
| 索引新增 | — | `@@index([adminStatus])` | 按状态筛选客户 |
