# Wave 3 Firm-Driven Customer Review Redesign

Date: 2026-04-09
Status: Draft reviewed with user
Scope: `Wave 3 periodic review redesign`, `client risk rating lifecycle`, `material freshness lifecycle`, `Sumsub Applicant Action integration`, `Wave 1 ApprovalCase extension (multi-step)`
Supersedes: Wave 3 原 periodic review 设计（`docs/roadmap/wave-3-customer-onboarding-phase-plan.md` 中的 Phase 5）
Depends On: `docs/constraints/onboarding-flow-constraints.md`, `docs/specs/workflows/onboarding-canonical-workflow.md`, `2026-04-05-sumsub-onboarding-redesign-design.md`, Wave 1 Approval kernel

---

## 1. Goal

把 Wave 3 periodic review 从 "customer-driven 重走 CDD/EDD 表单" 的旧模型，重设计成 **firm-driven、VARA-compliant 的双层架构**：

- **Layer 2 (Client Risk Rating)** —— 基于 Sumsub AML 检查结果 + 本地 policy 聚合产出客户 risk tier，满足 VARA 每 3 月一次的硬闸门要求
- **Layer 3 (Material Freshness)** —— N 个材料级监视器 + 统一的 Sumsub Applicant Action 刷新调度器，维护 CDD 档案"up-to-date"

Wave 3 原 periodic review 流程（让客户重新走一遍 CDD/EDD 表单 → 重新跑风控模拟 → 重新 alert/case）被**完全替换**。Onboarding 的 FINAL_APPROVAL 语义被吸收进新的 ClientRiskAssessment 统一模型。

目标产出：

- onboarding 完成时由统一的 assessment 管线产生首次 risk tier + signoff
- onboarding 之后持续的 firm-driven 审查（每 3 月计划 + Sumsub Ongoing AML Monitoring 事件驱动 + 合规人手动）
- 材料级事件驱动过期检测 + 客户定向补材料（通过 Sumsub Applicant Action）
- PEP 路径支持 MLRO + SENIOR_MANAGEMENT_OFFICER 双签（复用 Wave 1 ApprovalStep 副表）
- Wave 2 本地 compliance kernel 的 alert/case/risk-engine 彻底废弃，统一迁 Sumsub

---

## 2. Non-Goals

本设计**不**包含：

- Sumsub Transaction Monitoring / Behavior Monitoring 事件 mirror（v1 deferred → `deferred-refactors.md` 第 7 项）
- 两份正式 policy markdown 文档的落地（v1 deferred → `deferred-refactors.md` 第 6 项，临时以 design 内表格和 JSON config 为 reference）
- 企业客户 (corporate) 的 UBO 刷新流程（保留占位，demo 阶段只支持 individual）
- 本地 compliance case / risk engine 的重建（明确废弃）
- Real Sumsub Dashboard 生产环境连接（demo 阶段复用 existing simulation controller pattern）
- Sumsub L2 downgrade 回 L1 的能力（policy v1 `downgradeForbidden = true`）

---

## 3. Regulatory Context

### 3.1 VARA Rulebook 原文

本设计的合规依据来自 VARA Compliance and Risk Management Rulebook：

**Rule III.D.8 (Client Risk Assessment 硬频率)**：

> "Client risk assessments required under this Rule III.D must be carried out at regular intervals **no longer than every three (3) months**."

**Rule III.D.7 (方法学所有权)**：

> "the criteria and methodology for the categorisations of each client's AML/CFT risk"
> "how such assessments are planned to be documented and associated courses of action"
> "requirements for maintaining comprehensive audit trails of all risk assessments"

**Rule III.E.5 (Ongoing CDD)**：

> "VASPs should undertake CDD measures in their ongoing supervision of business relationships with clients, including— (a) auditing transactions ... (b) **ensuring that the documents, data or information obtained from CDD measures are up-to-date and appropriate by regularly reviewing such records, particularly those of high-risk clients**."

**Rule III.E.10(b) (高风险客户加强)**：

> For high-risk clients, VASPs must "update the CDD information which it holds on the client and any UBO **more regularly**."

### 3.2 FATF Recommendation 12 (PEP)

> "In relation to foreign PEPs... financial institutions should... obtain **senior management approval** for establishing (or continuing, for existing customers) such business relationships."

→ 本设计的 `PEP_RELATIONSHIP_APPROVAL` 双签（MLRO + SENIOR_MANAGEMENT_OFFICER）直接落实这一条。

### 3.3 VARA / 监管要求 → 本设计映射

| 监管要求 | 本设计组件 |
|---|---|
| III.D.8: 每 3 月 client risk assessment | Layer 2 `SCHEDULED_QUARTERLY` cron |
| III.D.7: 自己定义 methodology + audit trail | `config/client-risk-assessment-policy.json` + `ClientRiskAssessment` 表 + `policyVersion` 字段 |
| III.E.5: 持续 CDD 档案更新 | Layer 3 `CustomerMaterialHolding` + `MaterialRefreshCycle` |
| III.E.10(b): 高风险客户更频繁 | `policy.windowDays` 按 risk tier 差异化（HIGH 窗口短于 LOW）|
| III.E: ongoing monitoring | Sumsub Ongoing AML Monitoring + Sumsub Ongoing Document Monitoring |
| FATF R.12: PEP 高管签字 | `PEP_RELATIONSHIP_APPROVAL` + Wave 1 ApprovalStep 双步推进 |

---

## 4. Architecture Overview

### 4.1 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1 · Continuous Monitoring (always-on, external)       │
│  · Sumsub Ongoing AML Monitoring                             │
│    (sanctions / PEP / adverse media 实时)                    │
│  · Sumsub Ongoing Document Monitoring                        │
│    (ID 证件到期，仅 ID 类材料)                                │
│  输出: webhook 推送 → 路由到 Layer 2 或 Layer 3               │
└───────────────────┬──────────────────┬──────────────────────┘
                    │                  │
         异常信号 / AML 命中           doc 过期
                    ▼                  ▼
┌──────────────────────────────┐  ┌────────────────────────────┐
│ Layer 2 · Analysis           │  │ Layer 3 · Evidence          │
│ ─────────────────────────────│  │ ────────────────────────── │
│ VARA III.D.8 每 3 月硬闸门     │  │ VARA III.E.5 "up-to-date"   │
│                              │  │                            │
│ 触发 (3 源):                  │  │ 触发 (4 源):                │
│ · SCHEDULED_QUARTERLY         │  │ · SCHEDULED_EXPIRY          │
│ · SUMSUB_AML_HIT              │  │ · RISK_TIER_UPGRADED        │
│ · MLRO_MANUAL                 │  │ · INITIAL_COLLECTION        │
│                              │  │ · SUMSUB_DOC_MONITORING     │
│ 产出:                         │  │                            │
│ ClientRiskAssessment          │  │ 产出:                       │
│ (riskTier + reasoning)       │  │ MaterialRefreshCycle        │
│                              │  │ + CustomerMaterialHolding   │
│                              │  │   状态更新                   │
└───────────────┬──────────────┘  └─────────┬────────────────┘
                │                            │
                │ tier 升级 → Layer 3         │ refresh 完成 → 更新
                │ 重算 windows + 缺材料检查   │ holding verifiedAt
                └────────────►◄──────────────┘
                        双向联动
                │                            │
                │ sanctions / PEP             │ grace 超期
                │ / AML RED                   │ → offboard
                ▼                            ▼
     ┌──────────────────────────────────────────┐
     │  Sumsub 内部 compliance case processing    │
     │  (MLRO 在 Sumsub Dashboard 处理,           │
     │   v1 通过 simulation controller 模拟)      │
     └──────────────────────────────────────────┘
```

### 4.2 设计原则

1. **Layer 2 和 Layer 3 是分离的两个系统**，但共享 Sumsub 作为底层数据源
2. **Layer 1 不产出持久化记录**，只做信号源，通过 webhook 分发到 Layer 2/3
3. **Layer 2 是聚合器不是计算器** —— 从 Sumsub AML 结果 + 本地简单打分 + 本地 Layer 3 状态推导 tier，写留痕，触发下游
4. **Layer 3 是 N 个材料监视器 + 一个统一刷新调度器**，不是日历 cycle
5. **Sumsub 对 ID 类材料完全托管** (validity 监控)；**对 PoA/SoF/SoW 等滚动窗口材料不管**，我们自己存 `verifiedAt` 和 cron 监视
6. **内部治理 signoff (tier 变化 / PEP 决定) 用 Wave 1 的 `ApprovalCase` kernel**，和 ONBOARDING_FINAL_APPROVAL 共用基建，新增 3 个 action types
7. **Compliance alerts / investigation / risk engine / STR filing 全部在 Sumsub**。v1 demo 阶段无真实 Sumsub Dashboard 连接，复用现有 `onboarding-sumsub-simulation.controller.ts` 的模式扩展。Simulation 事件和未来真实 webhook 共享同一个 handler 路径。
8. **v1 不 mirror 交易行为到 Sumsub** (deferred)，Layer 2 的 policy 聚合以 AML labels + 本地简单打分为主

### 4.3 Risk Tier ↔ Sumsub Level 约束

下面 4 格矩阵是 v1 policy 强制约束：

| | LOW | MEDIUM | HIGH |
|---|---|---|---|
| **L1 customer** | ✅ | ✅ | ❌ |
| **L2 customer** | ❌ | ✅ | ✅ |

规则：

- **LOW 必须 L1** —— 不需要加强材料
- **HIGH 必须 L2** —— 必须有 SoW 等加强材料
- **MEDIUM 可 L1 也可 L2** —— 行为驱动升级时可留在 L1（如果新 tier 不要求新材料），从 HIGH 保守处理时保持 L2
- **v1 禁止 tier 降级** (`downgradeForbidden = true`)

Carve-out: **sanctions 命中导致的 HIGH 不触发 level 同步**。已决定 offboard 的客户没必要再收加强材料。

---

## 5. Data Model

### 5.1 实体关系

```
┌──────────────────────────────┐
│  customer_main (existing)     │
│  +字段:                       │
│  · riskTier                  │
│  · riskTierUpdatedAt         │
│  · pepStatus                 │
│  · pepConfirmedAt            │
│  · latestRiskAssessmentId    │
│  ~ rename:                    │
│  · latestFinalApprovalId     │
│    → latestRiskApprovalId    │
│  · latestFinalApprovalStatus │
│    → latestRiskApprovalStatus│
└───────────┬──────────────────┘
            │ 1 : N
  ┌─────────┼─────────────┬─────────────────┐
  ▼         ▼             ▼                 ▼
customer  material      client_risk       (existing)
material  refresh       assessments        approval_cases
holdings  cycles                            (Wave 1)
(new)     (new)         (new)              + new steps
                          │                   │
                          │ 1:0..1            │
                          └──────────────────►│
                                              │
                                          (approvalCaseId)
```

### 5.2 `CustomerMain` 修改

```prisma
model CustomerMain {
  // ...existing fields (大部分不变)...
  
  // ─── BREAKING rename ────────────────────────
  latestRiskApprovalId       String?   @unique     
    // was: latestFinalApprovalId
  latestRiskApprovalStatus   String?              
    // was: latestFinalApprovalStatus
  latestRiskApproval         ApprovalCase? @relation(
    "CustomerLatestRiskApproval",   // was: CustomerLatestFinalApproval
    fields: [latestRiskApprovalId], references: [id])
  
  // ─── Wave 3 新增 ───────────────────────────────
  riskTier                   String    @default("LOW")
    // LOW | MEDIUM | HIGH | UNKNOWN
  riskTierUpdatedAt          DateTime?
  pepStatus                  String    @default("NONE")
    // NONE | CONFIRMED | CLEARED
  pepConfirmedAt             DateTime?
  latestRiskAssessmentId     String?
}
```

**Migration 步骤**：

1. SQL rename `latestFinalApprovalId` → `latestRiskApprovalId`（保留数据）
2. SQL rename `latestFinalApprovalStatus` → `latestRiskApprovalStatus`
3. ADD COLUMN `riskTier` (default 'LOW'), `riskTierUpdatedAt`, `pepStatus` (default 'NONE'), `pepConfirmedAt`, `latestRiskAssessmentId`
4. Prisma relation name rename：`CustomerLatestFinalApproval` → `CustomerLatestRiskApproval`
5. 更新 `onboarding.service.ts` / `approvals.service.spec.ts` / admin-web 文案

### 5.3 `CustomerMaterialHolding` (新)

**每个客户持有的每一种材料占一行**。Layer 3 daily cron 的扫描对象。

```prisma
model CustomerMaterialHolding {
  id                   String   @id @default(cuid())
  customerId           String
  customer             CustomerMain @relation(fields: [customerId], references: [id])
  
  materialType         String   
    // EMIRATES_ID | PASSPORT | PROOF_OF_ADDRESS |
    // SOURCE_OF_FUNDS | SOURCE_OF_WEALTH
  
  managementMode       String   
    // SUMSUB_MANAGED | SELF_MANAGED
  
  // ─── 时效字段 ──────────────────────────────────
  verifiedAt           DateTime
  expiresAt            DateTime?
    // SUMSUB_MANAGED  → Sumsub 证件 validUntil
    // SELF_MANAGED    → verifiedAt + window(materialType, riskTier)
  status               String   @default("FRESH")
    // FRESH | NOTIFIED | URGENT | BLOCKING |
    // REFRESH_IN_PROGRESS | EXPIRED | MISSING
  
  // ─── Sumsub 关联 ─────────────────────────────
  sumsubIdDocSetType   String?
    // IDENTITY | PROOF_OF_RESIDENCE | PROOF_OF_SOURCE_OF_FUNDS | ...
  sumsubDocId          String?
  
  // ─── 当前 refresh cycle 指针 ────────────────
  activeRefreshCycleId String?  @unique
  activeRefreshCycle   MaterialRefreshCycle? @relation(
    "active", fields: [activeRefreshCycleId], references: [id])
  
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  
  @@unique([customerId, materialType])
  @@index([expiresAt, status])   // daily cron 扫描主路径
  @@index([customerId])
  @@map("customer_material_holdings")
}
```

### 5.4 `MaterialRefreshCycle` (新)

**每次某个材料需要 refresh 创建一条**。一个 holding 一次只能有一条 active cycle。

```prisma
model MaterialRefreshCycle {
  id                       String   @id @default(cuid())
  cycleNo                  String   @unique  // MRC-2026-00001
  customerId               String
  customer                 CustomerMain @relation(fields: [customerId], references: [id])
  
  holdingId                String
  holding                  CustomerMaterialHolding @relation(
    "holdingBackref", fields: [holdingId], references: [id])
  
  materialType             String   // 冗余字段便于查询
  
  // ─── 生命周期 ──────────────────────────────
  status                   String   @default("PENDING_CUSTOMER_EVIDENCE")
    // PENDING_CUSTOMER_EVIDENCE | CLEARED | REJECTED
  stage                    String   @default("NUDGE_ONLY")
    // NUDGE_ONLY | URGENT | BLOCKING  (仅在 status=PENDING 时有意义)
  triggerType              String   
    // SCHEDULED_EXPIRY       - daily cron 检测到到期
    // RISK_TIER_UPGRADED     - Layer 2 tier 升级 cascade
    // INITIAL_COLLECTION     - tier 升级缺必备材料首次索要
    // SUMSUB_DOC_MONITORING  - Sumsub 自己的过期监控兜底
  
  // ─── 时间戳 ──────────────────────────────
  createdAt                DateTime @default(now())
  stageNudgeAt             DateTime?
  stageUrgentAt            DateTime?
  stageBlockingAt          DateTime?
  clearedAt                DateTime?
  rejectedAt               DateTime?
  graceExpiresAt           DateTime?
    // Schedule_expiry: expiresAt + 30d
    // Initial_collection: createdAt + 14/21 d by tier
  resolutionReason         String?
  
  // ─── Sumsub 关联 ─────────────────────────────
  sumsubActionId           String?  // Sumsub Applicant Action ID
  sumsubActionLevelName    String?
  sumsubActionCreatedAt    DateTime?
  
  // ─── Layer 2 cascade 关联 ───────────────────
  triggeredByAssessmentId  String?
  triggeredByAssessment    ClientRiskAssessment? @relation(
    fields: [triggeredByAssessmentId], references: [id])
  
  // ─── 审计 ──────────────────────────────────
  traceId                  String   @unique   // MATERIAL_REFRESH:<cycleId>
  
  @@index([customerId, status])
  @@index([status, graceExpiresAt])
  @@index([sumsubActionId])
  @@map("material_refresh_cycles")
}
```

### 5.5 `ClientRiskAssessment` (新)

**每次 Layer 2 评估创建一条**（quarterly cron / webhook-triggered / onboarding initial / MLRO manual 都算）。

```prisma
model ClientRiskAssessment {
  id                          String   @id @default(cuid())
  assessmentNo                String   @unique  // CRA-2026-00001
  customerId                  String
  customer                    CustomerMain @relation(fields: [customerId], references: [id])
  
  // ─── 触发元信息 ─────────────────────────────
  triggerType                 String   
    // INITIAL_ONBOARDING     - onboarding 完成后由 onboarding flow 创建
    // SCHEDULED_QUARTERLY    - Layer 2 3月 cron
    // SUMSUB_AML_HIT         - Ongoing AML Monitoring 自发推送
    // MLRO_MANUAL            - 合规人手动
  triggeredAt                 DateTime @default(now())
  
  // ─── Sumsub AML check 请求/响应 ──────────────
  sumsubAmlCheckRequestedAt   DateTime?
  sumsubAmlCheckInspectionId  String?
  sumsubAmlReviewAnswer       String?  // GREEN | RED
  sumsubAmlLabels             Json?    // array: ["SANCTIONS_UN", "PEP_CLASS_1_DOMESTIC"]
  sumsubAmlRejectType         String?  // FINAL | RETRY
  sumsubSnapshotAt            DateTime?
  sumsubRiskScore             Int?     // v1 可能为 null (mirror deferred)
  sumsubTags                  Json?
  
  // ─── Policy 输出 ───────────────────────────
  policyVersion               String   // "1.0.0"
  resultingRiskTier           String?  // LOW | MEDIUM | HIGH | UNKNOWN
  previousRiskTier            String?
  scoreSuggestedTier          String?  // 场景 5 用
  recommendedAction           String?  
    // REAFFIRM | UPGRADE_TIER | REQUEST_REFRESH |
    // ESCALATE_TO_SUMSUB_CASE | EXIT
  reasoning                   Json?
  
  // ─── Signoff ─────────────────────────────
  status                      String   @default("PENDING_SUMSUB_RESULT")
    // PENDING_SUMSUB_RESULT | PENDING_SIGNATURE | SIGNED | 
    // ESCALATED_TO_SUMSUB
  signoffMethod               String?
    // AUTO_R2 | MANUAL_COMPLIANCE_OFFICER | MANUAL_MLRO | DUAL_MLRO_SENIOR
  approvalCaseId              String?
  approvalCase                ApprovalCase? @relation(
    fields: [approvalCaseId], references: [id])
  signedBy                    String?  // userId 或 'SYSTEM' 或 'SUMSUB_MLRO'
  signedAt                    DateTime?
  signedUnderPolicyVersion    String?
  
  // ─── Sumsub 内部 case 关联 ────────────────
  sumsubInternalCaseRef       String?
  sumsubCaseFinalDecision     String?  // APPROVE | REJECT
  sumsubCaseDecidedAt         DateTime?
  
  // ─── 关联 refresh cycles ──────────────────
  triggeredRefreshCycles      MaterialRefreshCycle[]
  
  // ─── 审计 ─────────────────────────────────
  traceId                     String   @unique  // CLIENT_RISK_ASSESSMENT:<id>
  createdAt                   DateTime @default(now())
  
  @@index([customerId, status])
  @@index([customerId, triggeredAt])
  @@index([sumsubAmlCheckInspectionId])
  @@index([status, triggeredAt])
  @@map("client_risk_assessments")
}
```

### 5.6 Wave 1 Approval Action Type Catalog 变更

**移除**：

```typescript
// 从 approval.constants.ts 删除
ONBOARDING_FINAL_APPROVAL  // 被下面 3 个替代
```

**新增**：

```typescript
RISK_RATING_MEDIUM_APPROVAL: {
  riskLevel: HIGH,
  checkerRoles: ['COMPLIANCE_OFFICER'],  // 单签
  timeoutHours: 168,                      // 7 天
}
// 用途:
//  - L1 onboarding 完成且 policy 算出 MED → 首次 signoff
//  - Layer 2 quarterly 把客户从 LOW 升到 MED

RISK_RATING_HIGH_APPROVAL: {
  riskLevel: HIGH,
  checkerRoles: ['MLRO'],                 // 单签
  timeoutHours: 168,
}
// 用途:
//  - L2 onboarding 完成且 policy 算出 HIGH → 首次 signoff
//  - Layer 2 quarterly HIGH→HIGH reaffirm
//  - Layer 2 LOW/MED → HIGH 升级

PEP_RELATIONSHIP_APPROVAL: {
  riskLevel: HIGH,
  checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],  // 双签
  timeoutHours: 240,                      // 10 天
}
// 用途: 任何 PEP 相关签字 (FATF R.12)
//  - onboarding 命中 PEP → 首次关系确认
//  - Layer 2 quarterly PEP reaffirm
//  - Ongoing Monitoring 推新 PEP label → 关系评估
```

### 5.7 Wave 1 `ApprovalStep` 副表扩展

Schema 已支持多步，service 单步流需要扩展：

```typescript
// src/modules/governance/approvals/approvals.service.ts

// 1. createCase 支持多 step 初始化
//    从 catalog 读 checkerRoles
//    if roles.length > 1: 为每个 role 创建一个 step (stepNo 1..N)
//    else: 保持现有单 step 逻辑

// 2. approve 改成推进逻辑
async approve(id, dto, actor) {
  return this.prisma.$transaction(async (tx) => {
    const approval = await findCaseOrThrow(...);
    const currentStep = approval.steps.find(
      s => s.status === 'PENDING' && 
           s.checkerRoleCandidates.includes(actor.role)
    );
    if (!currentStep) throw new ForbiddenException(...);
    
    await tx.approvalStep.update({
      where: { id: currentStep.id },
      data: { status: 'APPROVED', decidedByUserId: actor.userId, ... },
    });
    
    const nextPendingStep = approval.steps.find(
      s => s.stepNo > currentStep.stepNo && s.status === 'PENDING'
    );
    
    if (nextPendingStep) {
      return approval;  // case 仍 PENDING, 等下一个角色
    }
    
    // 最后一步, case APPROVED
    return tx.approvalCase.update({
      where: { id: approval.id },
      data: { status: 'APPROVED', ... },
    });
  });
}

// 3. reject: 任一步 REJECT → 整个 case REJECTED (AND 关系)
```

### 5.8 Policy Config 文件

**位置**：

```
Exchange_js/config/
  ├─ material-refresh-policy.json
  └─ client-risk-assessment-policy.json
```

**material-refresh-policy.json**:

```jsonc
{
  "version": "1.0.0",
  "effectiveFrom": "2026-04-09",
  "stages": [
    { "daysFromExpiry": -30, "action": "CREATE_CYCLE_NUDGE_ONLY" },
    { "daysFromExpiry":  -7, "action": "ESCALATE_URGENT" },
    { "daysFromExpiry":   0, "action": "ENFORCE_RESTRICTION" },
    { "daysFromExpiry":  30, "action": "TERMINATE_CYCLE_OFFBOARD" }
  ],
  "materials": {
    "EMIRATES_ID": {
      "managementMode": "SUMSUB_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubIdDocSetType": "IDENTITY",
      "sumsubActionLevelName": "wave3-action-id-refresh",
      "enforceRestriction": true
    },
    "PASSPORT": {
      "managementMode": "SUMSUB_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubIdDocSetType": "IDENTITY",
      "sumsubActionLevelName": "wave3-action-id-refresh",
      "enforceRestriction": true,
      "alternativeOf": "EMIRATES_ID"
    },
    "PROOF_OF_ADDRESS": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubActionLevelName": "wave3-action-poa-refresh",
      "windowDays": { "LOW": 365, "MEDIUM": 270, "HIGH": 180 },
      "initialCollectionWindowDays": { "MEDIUM": 21, "HIGH": 14 },
      "enforceRestriction": true
    },
    "SOURCE_OF_FUNDS": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["MEDIUM", "HIGH"],
      "sumsubActionLevelName": "wave3-action-sof-refresh",
      "windowDays": { "MEDIUM": 540, "HIGH": 365 },
      "initialCollectionWindowDays": { "MEDIUM": 21, "HIGH": 14 },
      "enforceRestriction": true
    },
    "SOURCE_OF_WEALTH": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["HIGH"],
      "sumsubActionLevelName": "wave3-action-sow-refresh",
      "windowDays": { "HIGH": 730 },
      "initialCollectionWindowDays": { "HIGH": 14 },
      "enforceRestriction": true
    }
  }
}
```

**client-risk-assessment-policy.json**:

```jsonc
{
  "version": "1.0.0",
  "effectiveFrom": "2026-04-09",
  "assessmentFrequencyDays": {
    "LOW": 90, "MEDIUM": 90, "HIGH": 90
  },
  "tierMappingRules": [
    { "priority": 1, "condition": "labels_contains_SANCTIONS", 
      "tier": "HIGH", "action": "ESCALATE_TO_SUMSUB_CASE",
      "immediateEffect": "FREEZE" },
    { "priority": 2, "condition": "labels_contains_PEP", 
      "tier": "HIGH", "action": "PEP_REVIEW",
      "immediateEffect": "RESTRICT" },
    { "priority": 3, "condition": "labels_contains_ADVERSE_MEDIA", 
      "tier": "HIGH", "action": "MANUAL_REVIEW" },
    { "priority": 4, "condition": "red_other", 
      "tier": "<keep_previous>", "action": "MANUAL_REVIEW" },
    { "priority": 5, "condition": "any_required_material_stale", 
      "tier": "UNKNOWN", "action": "REQUEST_REFRESH" },
    { "priority": 6, "condition": "local_behavior_score_high", 
      "tier": "HIGH", "action": "UPGRADE_TIER" },
    { "priority": 7, "condition": "local_behavior_score_medium", 
      "tier": "MEDIUM", "action": "UPGRADE_OR_REAFFIRM" },
    { "priority": 8, "condition": "green_stable", 
      "tier": "LOW", "action": "REAFFIRM" }
  ],
  "signoffRules": [
    { "when": "tierUnchanged AND tier IN [LOW, MEDIUM] AND noRed AND noPep", 
      "method": "AUTO_R2", "actionType": null },
    { "when": "tierUnchanged AND tier = HIGH AND noPep", 
      "method": "MANUAL_MLRO", "actionType": "RISK_RATING_HIGH_APPROVAL" },
    { "when": "tierChange → MEDIUM", 
      "method": "MANUAL_COMPLIANCE_OFFICER", 
      "actionType": "RISK_RATING_MEDIUM_APPROVAL" },
    { "when": "tierChange → HIGH AND noPep", 
      "method": "MANUAL_MLRO", "actionType": "RISK_RATING_HIGH_APPROVAL" },
    { "when": "pepDetected OR pepReaffirm", 
      "method": "DUAL_MLRO_SENIOR", "actionType": "PEP_RELATIONSHIP_APPROVAL" },
    { "when": "sanctions", 
      "method": "ESCALATED", "actionType": null }
  ],
  "tierLevelConstraint": {
    "LOW":    ["wave3-level-1"],
    "MEDIUM": ["wave3-level-1", "wave3-level-2"],
    "HIGH":   ["wave3-level-2"]
  },
  "frozenCustomersSkipLevelSync": true,
  "downgradeForbidden": true
}
```

---

## 6. Layer 2: Client Risk Assessment 详细设计

### 6.1 触发源

3 种 Layer 2 触发源（不包括 onboarding initial）：

| # | Trigger | 场景 | 谁调用 |
|---|---|---|---|
| 1 | `SCHEDULED_QUARTERLY` | 每月 cron 扫到期客户 | `ClientRiskAssessmentCronService` |
| 2 | `SUMSUB_AML_HIT` | Sumsub Ongoing AML Monitoring 推新 RED | `SumsubWebhookDispatcher` |
| 3 | `MLRO_MANUAL` | 合规人手动 | admin API |

**额外路径**：onboarding 完成时由 `OnboardingService.handleApplicantWorkflowCompleted` 调用 `ClientRiskAssessmentService.recordAssessmentFromKnownAmlResult()`，创建 triggerType=`INITIAL_ONBOARDING` 的记录。**跳过** `/aml/check`，直接使用 onboarding workflow 已有的 Sumsub AML 数据。**不属于 Layer 2 的 "trigger"**。

### 6.2 ClientRiskAssessmentService 公开方法

```typescript
class ClientRiskAssessmentService {
  /** Layer 2 主入口，会主动调 /aml/check */
  async startAssessment(input: {
    customerId: string;
    triggerType: 'SCHEDULED_QUARTERLY' | 'SUMSUB_AML_HIT' | 'MLRO_MANUAL';
    triggeredBy?: string;
    triggeredContext?: object;
  }): Promise<ClientRiskAssessment>;
  
  /** Onboarding 等外部源复用，不调 /aml/check */
  async recordAssessmentFromKnownAmlResult(input: {
    customerId: string;
    triggerType: 'INITIAL_ONBOARDING';
    knownAmlResult: SumsubReviewResult;
    snapshot: SumsubApplicantSnapshot;
  }): Promise<ClientRiskAssessment>;
  
  /** 收到 Sumsub applicantReviewed webhook 后处理 */
  async handleSumsubAmlResult(
    inspectionId: string,
    reviewResult: SumsubReviewResult,
  ): Promise<void>;
  
  /** ApprovalCase 签字完成事件处理 */
  async handleSignoffComplete(
    assessmentId: string,
    approvalCase: ApprovalCase,
  ): Promise<void>;
  
  /** Sumsub 内部 case 最终决定处理 (sanctions/PEP escalation 路径) */
  async handleSumsubCaseFinalDecision(
    assessmentId: string,
    decision: 'APPROVE' | 'REJECT',
    context: object,
  ): Promise<void>;
}
```

### 6.3 状态机

```
                 startAssessment(input)
                        │
                        ▼
              ┌─────────────────────┐
              │ 幂等 check           │
              │ pending 存在?        │
              └─┬─────────────────┬─┘
                │ YES: 返回现有    │ NO
                │                 │
                ▼                 ▼
             (结束)     ┌─────────────────┐
                        │ 创建 assessment │
                        │ status =        │
                        │ PENDING_SUMSUB_ │
                        │ RESULT          │
                        └────────┬────────┘
                                 │
                                 ▼
                        POST /aml/check
                                 │
                              (等 webhook)
                                 │
                                 ▼
                handleSumsubAmlResult(inspectionId, result)
                                 │
                                 ▼
                   ┌───────────────────────────┐
                   │ 分叉 A: reviewAnswer?     │
                   └──┬─────────────────┬──────┘
                      │ GREEN           │ RED
                      │                 │
                      │                 ▼
                      │       ┌───────────────┐
                      │       │ 分叉 B: labels │
                      │       └──┬────┬────┬──┘
                      │       SANC  PEP  OTHER
                      │          │    │    │
                      │          ▼    │    │
                      │     (PATH:    │    │
                      │      SANCT)   │    │
                      │               ▼    ▼
                      │           (PATH: (PATH:
                      │            PEP)   RED_OTHER)
                      ▼
              (PATH: GREEN)
                      │
                      ▼
          GET /applicants/{id}/one
          (snapshot + 本地 holdings)
                      │
                      ▼
          applyPolicy(input) → {
            resultingTier, recommendedAction,
            signoffMethod, reasoning
          }
                      │
                      ▼
          ┌───────────────────────────┐
          │ 分叉 C: signoffMethod     │
          └──┬─────┬──────────┬────┬──┘
             │AUTO │MANUAL_CO │MLRO│DUAL
             │_R2  │          │    │
             │     │          │    │
             ▼     ▼          ▼    ▼
           auto  createApprovalCase(actionType)
           sign         │
             │          ▼
             │    (等人工签, webhook 回来)
             │          │
             │          ▼
             │    handleSignoffComplete
             │          │
             └──────────┴────────┐
                                 ▼
                        postSignoffCascade()
```

### 6.4 PATH: GREEN 详细动作

```typescript
async function handleSumsubAmlResult_green(assessment, event) {
  // 1. 记录 AML 结果
  assessment.sumsubAmlReviewAnswer = 'GREEN';
  
  // 2. 拉完整快照
  const snapshot = await sumsubClient.getApplicant(
    customer.sumsubApplicantId
  );
  assessment.sumsubSnapshotAt = now;
  assessment.sumsubRiskScore = snapshot.totalScore ?? null;
  assessment.sumsubTags = snapshot.tags ?? [];
  
  // 3. 读本地 holdings 状态
  const holdings = await getHoldings(customer.id);
  
  // 4. 应用 policy
  const policyOutput = applyPolicy({
    amlAnswer: 'GREEN',
    amlLabels: [],
    snapshot,
    holdings,
    previousTier: customer.riskTier,
    previousPepStatus: customer.pepStatus,
  });
  
  // 5. 更新 assessment 字段
  assessment.resultingRiskTier = policyOutput.resultingTier;
  assessment.recommendedAction = policyOutput.recommendedAction;
  assessment.signoffMethod = policyOutput.signoffMethod;
  assessment.reasoning = policyOutput.reasoning;
  
  // 6. 路由 signoff
  await routeSignoff(assessment, policyOutput);
}

async function routeSignoff(assessment, policyOutput) {
  switch (policyOutput.signoffMethod) {
    case 'AUTO_R2':
      assessment.status = 'SIGNED';
      assessment.signedBy = 'SYSTEM';
      assessment.signedAt = now;
      assessment.signedUnderPolicyVersion = policyOutput.policyVersion;
      await assessment.save();
      await postSignoffCascade(assessment);
      break;
    
    case 'MANUAL_COMPLIANCE_OFFICER':
      await createApprovalCase(assessment, {
        actionType: 'RISK_RATING_MEDIUM_APPROVAL',
      });
      break;
    
    case 'MANUAL_MLRO':
      await createApprovalCase(assessment, {
        actionType: 'RISK_RATING_HIGH_APPROVAL',
      });
      break;
    
    case 'DUAL_MLRO_SENIOR':
      await createApprovalCase(assessment, {
        actionType: 'PEP_RELATIONSHIP_APPROVAL',
      });
      break;
    
    case 'ESCALATED':
      // sanctions 路径
      assessment.status = 'ESCALATED_TO_SUMSUB';
      await assessment.save();
      break;
  }
}
```

### 6.5 PATH: RED SANCTIONS

```typescript
async function handleSumsubAmlResult_redSanctions(assessment, event) {
  assessment.sumsubAmlReviewAnswer = 'RED';
  assessment.sumsubAmlLabels = event.reviewResult.rejectLabels;
  assessment.resultingRiskTier = 'HIGH';
  assessment.recommendedAction = 'ESCALATE_TO_SUMSUB_CASE';
  assessment.status = 'ESCALATED_TO_SUMSUB';
  
  // 立即客户动作 (R5 规则)
  const customer = await getCustomer(assessment.customerId);
  customer.complianceHoldStatus = 'FROZEN';
  customer.complianceHoldReason = 'sanctions_hit_pending_investigation';
  customer.complianceHoldAt = now;
  
  // 取消 pending 资金操作
  await TxService.cancelPendingTransactions(
    customer.id, 
    'sanctions_freeze'
  );
  
  // 不调用任何 Sumsub 写接口
  // Sumsub 那边自己把 applicant 放到内部 case 队列
  // MLRO 登录 Sumsub Dashboard 处理 (v1 demo 用 simulation)
  
  await customer.save();
  await assessment.save();
  await audit.write({
    traceId: assessment.traceId,
    action: 'ESCALATED_TO_SUMSUB_SANCTIONS',
    metadata: { labels: event.reviewResult.rejectLabels },
  });
}

// 数小时~数天后, 收到 Sumsub second webhook
async function handleSumsubCaseFinalDecision(
  assessment,
  decision,  // 'APPROVE' (false positive) | 'REJECT' (true match)
) {
  assessment.sumsubCaseFinalDecision = decision;
  assessment.sumsubCaseDecidedAt = now;
  const customer = await getCustomer(assessment.customerId);
  
  if (decision === 'APPROVE') {
    // false positive 解除
    customer.complianceHoldStatus = 'CLEAR';
    customer.complianceHoldReason = null;
    assessment.status = 'SIGNED';
    assessment.signedBy = 'SUMSUB_MLRO';
  } else {
    // true match 正式 offboard
    customer.onboardingStatus = 'REJECTED';
    customer.operatingStatus = 'INACTIVE';
    customer.complianceHoldStatus = 'FROZEN';  // 永久
    assessment.status = 'SIGNED';
    assessment.signedBy = 'SUMSUB_MLRO';
  }
  
  await customer.save();
  await assessment.save();
}
```

### 6.6 PATH: RED PEP

```typescript
async function handleSumsubAmlResult_redPep(assessment, event) {
  assessment.sumsubAmlReviewAnswer = 'RED';
  assessment.sumsubAmlLabels = event.reviewResult.rejectLabels;
  assessment.resultingRiskTier = 'HIGH';
  assessment.recommendedAction = 'PEP_REVIEW';
  assessment.signoffMethod = 'DUAL_MLRO_SENIOR';
  
  // 立即 RESTRICT (不 freeze, PEP 不违法)
  const customer = await getCustomer(assessment.customerId);
  customer.restrictionStatus = 'RESTRICTED';
  customer.restrictionReason = 'pep_review_pending';
  customer.pepStatus = 'CONFIRMED';  // 暂时标记, 等 signoff 确认
  customer.pepConfirmedAt = now;
  
  // 创建 Wave 1 ApprovalCase (双签)
  const approvalCase = await approvalService.createCase({
    actionType: 'PEP_RELATIONSHIP_APPROVAL',
    entityRef: `client_risk_assessment:${assessment.id}`,
    traceId: assessment.traceId,
    createdByUserId: 'SYSTEM',
    metadataJson: JSON.stringify({
      assessmentId: assessment.id,
      pepLabels: event.reviewResult.rejectLabels,
    }),
    // Wave 1 approvalService 根据 catalog 创建 2 个 step
  });
  
  assessment.status = 'PENDING_SIGNATURE';
  assessment.approvalCaseId = approvalCase.id;
  
  await customer.save();
  await assessment.save();
}

// MLRO + SENIOR 分两次签, 最后一签触发 handleSignoffComplete
async function handleSignoffComplete_pep(assessment, approvalCase) {
  const customer = await getCustomer(assessment.customerId);
  
  if (approvalCase.status === 'APPROVED') {
    // 双签通过, 继续 PEP 关系
    customer.restrictionStatus = 'CLEAR';
    customer.restrictionReason = null;
    customer.riskTier = 'HIGH';
    customer.riskTierUpdatedAt = now;
    customer.pepStatus = 'CONFIRMED';  // 最终确认
    assessment.status = 'SIGNED';
    
    // tier 升到 HIGH, 需要同步 Sumsub level
    if (customer.sumsubCurrentLevelName !== 'wave3-level-2') {
      await sumsubClient.moveToLevel(
        customer.sumsubApplicantId, 
        'wave3-level-2'
      );
      customer.sumsubCurrentLevelName = 'wave3-level-2';
      customer.sumsubExperiencedLevel2 = true;
    }
    
    // 触发 Layer 3 重算 windows + 检查缺失材料 (SoW)
    await materialRefreshService.recomputeHoldingsForCustomer(
      customer.id, 'HIGH'
    );
  } else {
    // REJECTED - 不继续关系
    customer.onboardingStatus = 'REJECTED';
    customer.operatingStatus = 'INACTIVE';
    customer.pepStatus = 'CLEARED';
    assessment.status = 'SIGNED';
  }
  
  await customer.save();
  await assessment.save();
}
```

### 6.7 postSignoffCascade

```typescript
async function postSignoffCascade(assessment) {
  const customer = await getCustomer(assessment.customerId);
  
  // 1. 同步 customer tier
  const tierChanged = assessment.resultingRiskTier !== customer.riskTier;
  if (tierChanged) {
    customer.riskTier = assessment.resultingRiskTier;
    customer.riskTierUpdatedAt = now;
  }
  customer.latestRiskAssessmentId = assessment.id;
  customer.latestRiskApprovalId = assessment.approvalCaseId;
  customer.latestRiskApprovalStatus = 'APPROVED';
  
  // 2. 同步 Sumsub level (frozen 客户跳过)
  if (customer.complianceHoldStatus !== 'FROZEN') {
    const allowedLevels = getAllowedLevelsForTier(customer.riskTier);
    if (!allowedLevels.includes(customer.sumsubCurrentLevelName)) {
      await sumsubClient.moveToLevel(
        customer.sumsubApplicantId,
        allowedLevels[0],
      );
      customer.sumsubCurrentLevelName = allowedLevels[0];
      if (allowedLevels[0] === 'wave3-level-2') {
        customer.sumsubExperiencedLevel2 = true;
      }
    }
  }
  
  // 3. 触发 Layer 3 重算 windows + 缺失材料
  if (tierChanged) {
    await materialRefreshService.recomputeHoldingsForCustomer(
      customer.id,
      customer.riskTier,
    );
  }
  
  // 4. 解除临时 restriction (PEP 路径)
  if (customer.restrictionReason === 'pep_review_pending' && 
      assessment.status === 'SIGNED') {
    customer.restrictionStatus = 'CLEAR';
    customer.restrictionReason = null;
  }
  
  await customer.save();
  
  // 5. audit log
  await audit.write({
    traceId: assessment.traceId,
    action: 'CLIENT_RISK_ASSESSMENT_COMPLETED',
    customerId: customer.id,
    metadata: {
      tierBefore: assessment.previousRiskTier,
      tierAfter: assessment.resultingRiskTier,
      signoffMethod: assessment.signoffMethod,
      signedBy: assessment.signedBy,
    },
  });
}
```

### 6.8 7 场景对应表

| # | 起始 | AML | 结果 | signoffMethod | actionType | 立即效果 |
|---|---|---|---|---|---|---|
| 1 | L1 LOW | GREEN clean | LOW | AUTO_R2 | — | 无 |
| 2 | L1 LOW | GREEN | MED | MANUAL_COMPLIANCE_OFFICER | RISK_RATING_MEDIUM_APPROVAL | 无 |
| 3a | L1 LOW | GREEN | HIGH (非 PEP) | MANUAL_MLRO | RISK_RATING_HIGH_APPROVAL | 无 |
| 3b | L1 LOW | RED (PEP) | HIGH (PEP) | DUAL_MLRO_SENIOR | PEP_RELATIONSHIP_APPROVAL | RESTRICT |
| 4 | L1 LOW | RED (SANCTIONS) | HIGH (frozen) | ESCALATED | — | **FROZEN** |
| 5 | L2 HIGH | GREEN (score 降) | HIGH (keep) | MANUAL_MLRO | RISK_RATING_HIGH_APPROVAL | 无 |
| 6a | L2 HIGH | GREEN | HIGH | MANUAL_MLRO | RISK_RATING_HIGH_APPROVAL | 无 |
| 6b | L2 PEP | RED (已知 PEP) | HIGH (PEP) | DUAL_MLRO_SENIOR | PEP_RELATIONSHIP_APPROVAL | 无 |
| 7 | L2 HIGH | RED (SANCTIONS) | HIGH (frozen) | ESCALATED | — | **FROZEN** + 内部 post-mortem |

---

## 7. Layer 3: Material Refresh 详细设计

### 7.1 触发源 (4 种)

| # | Trigger | 场景 |
|---|---|---|
| 1 | `SCHEDULED_EXPIRY` | Daily cron 扫到进入 stage 时间窗 |
| 2 | `RISK_TIER_UPGRADED` | Layer 2 tier 升级导致 window 缩短 |
| 3 | `INITIAL_COLLECTION` | Layer 2 tier 升级缺必备材料 |
| 4 | `SUMSUB_DOC_MONITORING` | Sumsub Ongoing Doc Monitoring 自发 fire (兜底) |

### 7.2 Daily Cron 流程

```typescript
// 每日 02:00 UTC
async function runDailyCheck() {
  // Step 1: 同步 Sumsub-managed 材料 validUntil
  for (const customer of await getActiveCustomers()) {
    const applicant = await sumsubClient.getApplicant(
      customer.sumsubApplicantId
    );
    for (const idDoc of applicant.info.idDocs ?? []) {
      const materialType = mapSumsubDocToMaterialType(idDoc);
      if (!materialType) continue;
      
      const holding = await getHolding(customer.id, materialType);
      if (holding && holding.expiresAt?.getTime() !== idDoc.validUntil?.getTime()) {
        holding.expiresAt = idDoc.validUntil;
        await holding.save();
      }
    }
  }
  
  // Step 2: 推进 holding stage
  const holdings = await getHoldingsNeedingAttention();
  for (const holding of holdings) {
    const daysFromExpiry = Math.floor(
      (holding.expiresAt.getTime() - Date.now()) / DAY_MS
    );
    const targetStage = computeStage(daysFromExpiry);  // pure function
    
    if (targetStage !== holding.status) {
      await dispatchStageTransition(holding, targetStage);
    }
  }
  
  // Step 3: 扫 grace 超期的 cycle
  const expiredCycles = await prisma.materialRefreshCycle.findMany({
    where: {
      status: 'PENDING_CUSTOMER_EVIDENCE',
      graceExpiresAt: { lt: new Date() },
    },
  });
  for (const cycle of expiredCycles) {
    await terminateCycle(cycle, 'grace_expired');
  }
  
  // Step 4: 扫 stuck cycles (Sumsub 异常兜底)
  const stuckCycles = await prisma.materialRefreshCycle.findMany({
    where: {
      status: 'PENDING_CUSTOMER_EVIDENCE',
      sumsubActionId: null,
      createdAt: { lt: new Date(Date.now() - 60 * 60 * 1000) },
    },
  });
  for (const cycle of stuckCycles) {
    alertEngineer('stuck_cycle_no_sumsub_action', cycle);
  }
}

function computeStage(daysFromExpiry: number): Stage {
  if (daysFromExpiry > 30) return 'FRESH';
  if (daysFromExpiry > 7)  return 'NOTIFIED';   // [-7, 30]
  if (daysFromExpiry > 0)  return 'URGENT';     // (0, 7]
  return 'BLOCKING';                              // <= 0
}
```

### 7.3 Stage 转换动作

见 Section 3 的 `enterNotifiedStage` / `escalateToUrgent` / `enterBlockingStage` 伪代码。核心要点：

- **T-30 创建 cycle + 调 Sumsub 创建 Applicant Action** —— 客户从 T-30 开始任何 stage 都可以主动补
- **T-7 仅升级 stage + banner 强度**，不重建 cycle，不重建 Sumsub action
- **T-0 升级到 BLOCKING + RESTRICT 客户** （if `enforceRestriction`）
- **T+grace 超期** cycle REJECTED + 客户 offboard

### 7.4 客户完整补材料旅程

```
[Customer 访问 /profile]
  ↓ GET /customers/me/profile-banners
[看到 banner]
  ↓ 点击 "Refresh now"
[/verification?cycleId=xxx]
  ↓ GET /onboarding/refresh-cycles/:id
  ↓ POST /onboarding/refresh-cycles/:id/sdk-token
[Sumsub WebSDK 在 FIATX 主题外框内渲染]
  ↓ 客户上传新材料
[Sumsub 处理 → GREEN → 推 applicantActionReviewed webhook]
  ↓
[SumsubWebhookDispatcher → MaterialRefreshService.handleSumsubActionResult]
  ↓
[cycle CLEARED + holding FRESH + 解除 restriction (如果有)]
  ↓
[前端显示 success + 2s 后跳回 /profile]
  ↓
[/profile banner 消失]
```

### 7.5 Layer 2 → Layer 3 Cascade

```typescript
// Layer 2 的 postSignoffCascade 调这个
async function recomputeHoldingsForCustomer(
  customerId: string,
  newRiskTier: RiskTier,
): Promise<MaterialRefreshCycle[]> {
  const customer = await getCustomer(customerId);
  const holdings = await getHoldings(customerId);
  const createdCycles: MaterialRefreshCycle[] = [];
  
  // Step 1: 对 SELF_MANAGED holdings 重算 expiresAt
  for (const holding of holdings) {
    if (holding.managementMode !== 'SELF_MANAGED') continue;
    
    const policy = getMaterialPolicy(holding.materialType);
    const newWindowDays = policy.windowDays[newRiskTier];
    if (!newWindowDays) continue;
    
    const newExpiresAt = addDays(holding.verifiedAt, newWindowDays);
    if (newExpiresAt < holding.expiresAt) {
      holding.expiresAt = newExpiresAt;
      await holding.save();
      // 不立即推进 stage, 让下次 daily cron 自然处理
    }
  }
  
  // Step 2: 检查新 tier 是否要求当前没有的材料
  const requiredMaterials = getRequiredMaterialsForTier(newRiskTier);
  
  for (const materialType of requiredMaterials) {
    const existing = holdings.find(h => h.materialType === materialType);
    if (!existing) {
      // 缺失 → 创建 holding (MISSING) + 立即创 cycle
      const holding = await createMissingHolding(customerId, materialType);
      const cycle = await createInitialCollectionCycle(holding);
      createdCycles.push(cycle);
    }
  }
  
  return createdCycles;
}

async function createInitialCollectionCycle(holding) {
  const policy = getMaterialPolicy(holding.materialType);
  const customer = await getCustomer(holding.customerId);
  const gracePeriodDays = policy.initialCollectionWindowDays[customer.riskTier];
  
  const cycle = await prisma.materialRefreshCycle.create({
    data: {
      cycleNo: generateCycleNo(),
      customerId: holding.customerId,
      holdingId: holding.id,
      materialType: holding.materialType,
      status: 'PENDING_CUSTOMER_EVIDENCE',
      stage: 'NUDGE_ONLY',
      triggerType: 'INITIAL_COLLECTION',
      graceExpiresAt: addDays(new Date(), gracePeriodDays),
      traceId: `MATERIAL_REFRESH:${cycleId}`,
    },
  });
  
  const response = await sumsubClient.createApplicantAction({
    applicantId: customer.sumsubApplicantId,
    levelName: policy.sumsubActionLevelName,
  });
  cycle.sumsubActionId = response.id;
  cycle.sumsubActionLevelName = policy.sumsubActionLevelName;
  cycle.sumsubActionCreatedAt = new Date();
  await cycle.save();
  
  holding.activeRefreshCycleId = cycle.id;
  holding.status = 'REFRESH_IN_PROGRESS';
  await holding.save();
  
  return cycle;
}
```

---

## 8. Customer UX

### 8.1 状态矩阵

| customer 状态组合 | UI 效果 | 客户能做什么 |
|---|---|---|
| APPROVED + ACTIVE + CLEAR + 全部 FRESH | 正常 profile，无 banner | 全部功能 |
| APPROVED + ACTIVE + CLEAR + 某材料 NOTIFIED | 顶部温和 banner（橙）| 全部功能 |
| APPROVED + ACTIVE + CLEAR + 某材料 URGENT | 顶部强烈 banner（深橙）| 全部功能 |
| APPROVED + ACTIVE + RESTRICTED (材料到期) | 顶部阻塞 banner（红）| 只 /profile + /verification，交易被拒 |
| APPROVED + ACTIVE + RESTRICTED (PEP review) | 顶部等待 banner，无 CTA | 同上 |
| APPROVED + INACTIVE + FROZEN | 顶部冻结 banner（深红）| 只 /profile 只读 |
| FINAL_APPROVAL / PENDING_VERIFICATION | AuthGuard 全屏拦截 | 只能等 |
| REJECTED / WITHDRAWN | AuthGuard 全屏 offboard 提示 | 只能退出 |

### 8.2 Profile Banner API

```
GET /customers/me/profile-banners
Response:
{
  "banners": [
    {
      "id": "banner-mrc-abc123",
      "type": "MATERIAL_REFRESH" | "COMPLIANCE_HOLD" | "PEP_REVIEW_PENDING",
      "severity": "INFO" | "WARNING" | "BLOCKING",
      "title": "...",
      "description": "...",
      "cycleId": "...",
      "materialType": "PROOF_OF_ADDRESS",
      "expiresAt": "...",
      "daysFromExpiry": -1,
      "ctaLabel": "Refresh Proof of Address",
      "ctaPath": "/verification?cycleId=xxx",
      "dismissible": false
    }
  ]
}
```

### 8.3 /verification 页多模式

```tsx
const Verification = () => {
  const { profile } = useCustomerProfile();
  const [searchParams] = useSearchParams();
  const cycleId = searchParams.get('cycleId');
  
  if (profile.onboardingStatus !== 'APPROVED') {
    return <OnboardingVerification profile={profile} />;
  }
  
  if (cycleId) {
    return <MaterialRefreshVerification cycleId={cycleId} />;
  }
  
  return <Navigate to="/profile" replace />;
};
```

### 8.4 AuthGuard 细化

```typescript
if (customer.onboardingStatus !== 'APPROVED' || 
    customer.operatingStatus !== 'ACTIVE') {
  return <SimplifiedPendingPage />;
}

if (customer.complianceHoldStatus === 'FROZEN') {
  if (currentPath !== '/profile') return <Navigate to="/profile" />;
  return children;  // /profile 自己负责显示 frozen banner
}

if (customer.restrictionStatus === 'RESTRICTED') {
  const blocked = ['/deposit', '/withdraw', '/swap', '/wallet/send'];
  if (blocked.includes(currentPath)) return <Navigate to="/profile" />;
  return children;
}

return children;
```

### 8.5 交易 API 强制检查

Backend `deposit.service.ts` / `withdraw.service.ts` / `swap.service.ts` 在请求入口增加 guard：

```typescript
async function ensureCustomerCanTransact(customer: CustomerMain) {
  if (customer.complianceHoldStatus === 'FROZEN') {
    throw new ForbiddenException('Account is frozen');
  }
  if (customer.restrictionStatus === 'RESTRICTED') {
    throw new ForbiddenException(
      `Account restricted: ${customer.restrictionReason}`
    );
  }
  if (customer.operatingStatus !== 'ACTIVE') {
    throw new ForbiddenException('Account is not active');
  }
}
```

前端路由拦截只是 UX 优化，**后端 guard 是安全底线**。

---

## 9. Sumsub Integration Layer

### 9.1 Webhook Dispatcher

新增 `SumsubWebhookDispatcher` 服务，统一路由所有 Sumsub webhook 到对应业务 handler：

```typescript
class SumsubWebhookDispatcher {
  async dispatch(event, context) {
    // 线索 1: reviewMode 字段
    if (event.reviewMode === 'ongoingDocExpired') {
      return this.materialRefreshService.handleSumsubDocMonitoringFire(event);
    }
    
    // 线索 2: pending ClientRiskAssessment by inspectionId
    const pendingAssessment = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        sumsubAmlCheckInspectionId: event.inspectionId,
        status: 'PENDING_SUMSUB_RESULT',
      },
    });
    if (pendingAssessment) {
      return this.clientRiskAssessmentService.handleSumsubAmlResult(
        event.inspectionId, event.reviewResult
      );
    }
    
    // 线索 3: pending MaterialRefreshCycle by actionId
    const pendingCycle = await this.prisma.materialRefreshCycle.findFirst({
      where: {
        sumsubActionId: event.actionId,
        status: 'PENDING_CUSTOMER_EVIDENCE',
      },
    });
    if (pendingCycle) {
      return this.materialRefreshService.handleSumsubActionResult(event);
    }
    
    // 线索 4: customer 还在 onboarding
    const customer = await findByApplicantId(event.applicantId);
    if (customer.onboardingStatus === 'PENDING_VERIFICATION') {
      return this.onboardingService.handleSumsubVerificationEvent(event, context);
    }
    
    // 线索 5: 自发 Ongoing Monitoring 事件
    if (customer.onboardingStatus === 'APPROVED' && 
        event.reviewResult?.reviewAnswer === 'RED') {
      return this.clientRiskAssessmentService.startAssessment({
        customerId: customer.id,
        triggerType: 'SUMSUB_AML_HIT',
        triggeredContext: { spontaneousEvent: event },
      });
    }
    
    // 兜底
    this.logger.warn('unrouted_sumsub_webhook', event);
  }
}
```

### 9.2 SumsubClient 新方法

扩展 `src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`：

```typescript
class SumsubClient {
  // existing: createApplicant, createSdkToken, 
  //           getApplicantReviewStatus, changeLevel
  
  // ─── Wave 3 新增 ────────────────────────────
  async runAmlCheck(applicantId: string): Promise<{ ok: number }> {
    return this.post(
      `/resources/applicants/${applicantId}/aml/check`
    );
  }
  
  async getApplicant(applicantId: string): Promise<SumsubApplicantSnapshot> {
    return this.get(`/resources/applicants/${applicantId}/one`);
  }
  
  async createApplicantAction(input: {
    applicantId: string;
    levelName: string;
  }): Promise<{ id: string }> {
    return this.post(
      `/resources/applicantActions/-/forApplicant/${input.applicantId}` +
      `?levelName=${encodeURIComponent(input.levelName)}`
    );
  }
  
  async createActionSdkToken(input: {
    applicantId: string;
    levelName: string;
    ttlInSecs?: number;
  }): Promise<{ token: string }> {
    return this.post('/resources/accessTokens/sdk', {
      userId: input.applicantId,
      levelName: input.levelName,
      ttlInSecs: input.ttlInSecs ?? 600,
    });
  }
  
  async moveToLevel(applicantId: string, levelName: string, docSets?: any[]) {
    return this.post(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      docSets ? { docSets } : {}
    );
  }
}
```

### 9.3 Simulation Controller 扩展

现有 `onboarding-sumsub-simulation.controller.ts` 保留，新增 `admin-sumsub-simulation.controller.ts` 用于 admin 侧模拟 Layer 2/3 事件：

```typescript
@Controller('admin/sumsub/simulate')
@UseGuards(AdminAuthGuard)
export class AdminSumsubSimulationController {
  constructor(private readonly dispatcher: SumsubWebhookDispatcher) {}
  
  @Post('aml-check-result')
  simulateAmlCheckResult(@Body() body: SimulateAmlResultDto) {
    // 构造一个 applicantReviewed payload
    const payload = {
      type: 'applicantReviewed',
      applicantId: body.applicantId,
      inspectionId: body.inspectionId,
      reviewResult: {
        reviewAnswer: body.reviewAnswer,
        rejectLabels: body.rejectLabels,
        reviewRejectType: body.reviewRejectType,
      },
      createdAtMs: String(Date.now()),
    };
    return this.dispatcher.dispatch(payload, { simulated: true });
  }
  
  @Post('applicant-action-result')
  simulateApplicantActionResult(@Body() body: ...) { ... }
  
  @Post('sumsub-case-decision')
  simulateSumsubCaseDecision(@Body() body: ...) { ... }
  
  @Post('ongoing-doc-monitoring-fire')
  simulateOngoingDocMonitoringFire(@Body() body: ...) { ... }
}
```

**硬性规则**：`NODE_ENV === 'development'` 才可用，其他环境返回 403。

---

## 10. Migration + Operations

### 10.1 Sumsub Dashboard 预配 Runbook

运维在代码部署前完成：

1. **创建 4 个 Action Level** (Workflow Builder):
   - `wave3-action-id-refresh` → IDENTITY
   - `wave3-action-poa-refresh` → PROOF_OF_RESIDENCE
   - `wave3-action-sof-refresh` → APPLICANT_DATA + PROOF_OF_SOURCE_OF_FUNDS
   - `wave3-action-sow-refresh` → APPLICANT_DATA + PROOF_OF_SOURCE_OF_WEALTH
2. **ID 过期策略**: UAE EID + Passport + DL 全部 "Accept only valid" + 最少 6 月剩余
3. **启用 Ongoing Document Monitoring** (grace 0 天)
4. **启用 Ongoing AML Monitoring** + Workflow Builder 配 "reject → onHold"
5. **Webhook 订阅**: applicantReviewed, applicantPending, applicantOnHold, applicantActionPending, applicantActionOnHold, applicantActionReviewed, applicantWorkflowCompleted, applicantWorkflowFailed

Runbook 落地位置: `docs/operations/sumsub-dashboard-wave3-config-runbook.md`

### 10.2 Backfill Script

Eager 模式，位置 `scripts/wave3-firm-driven-review-backfill.ts`：

```typescript
async function backfillWave3({ dryRun, batchSize = 100, fromCustomerNo }) {
  const approved = await prisma.customerMain.findMany({
    where: {
      onboardingStatus: 'APPROVED',
      sumsubApplicantId: { not: null },
      ...(fromCustomerNo ? { customerNo: { gte: fromCustomerNo } } : {}),
    },
    orderBy: { customerNo: 'asc' },
  });
  
  for (const batch of chunks(approved, batchSize)) {
    for (const customer of batch) {
      try {
        if (dryRun) {
          console.log(`[DRY] ${customer.customerNo}`);
          continue;
        }
        
        await prisma.$transaction(async (tx) => {
          // 1. 默认 riskTier
          if (!customer.riskTier) {
            await tx.customerMain.update({
              where: { id: customer.id },
              data: { riskTier: 'LOW', pepStatus: 'NONE' },
            });
          }
          
          // 2. 读 Sumsub snapshot
          const snapshot = await sumsubClient.getApplicant(
            customer.sumsubApplicantId
          );
          
          // 3. 创建 LOW tier 必备材料 holdings
          for (const materialType of ['EMIRATES_ID', 'PROOF_OF_ADDRESS']) {
            const existing = await tx.customerMaterialHolding.findUnique({
              where: { customerId_materialType: { 
                customerId: customer.id, materialType 
              } },
            });
            if (existing) continue;
            
            const holding = buildHoldingFromSnapshot(
              customer, materialType, snapshot
            );
            await tx.customerMaterialHolding.create({ data: holding });
          }
        });
        
        console.log(`✓ ${customer.customerNo}`);
      } catch (err) {
        console.error(`✗ ${customer.customerNo}: ${err.message}`);
      }
    }
    await sleep(1000);  // rate limit protection
  }
}
```

### 10.3 Deployment Order

```
Step 1: Approval Kernel 多步扩展
  · approvals.service.ts createCase/approve/reject 支持多 step
  · 部署到 staging → 验证 → production

Step 2: Schema Migration
  · customer_main rename + add fields
  · 新表 3 张
  · 更新 Prisma client + 依赖服务

Step 3: Approval action type catalog 更新
  · 移除 ONBOARDING_FINAL_APPROVAL
  · 新增 RISK_RATING_MEDIUM/HIGH_APPROVAL, PEP_RELATIONSHIP_APPROVAL
  · admin-web 文案更新

Step 4: Sumsub Dashboard 预配 (运维, 和 code deploy 并行)

Step 5: Wave 3 服务部署 (FF=false)

Step 6: Backfill 执行 (staging dry-run → staging real → production)

Step 7: 启用 crons + 前端部署
  · FF=true
  · Layer 2 + Layer 3 crons 启动
  · 前端 /profile banner + /verification refresh mode
```

### 10.4 Feature Flag

Master 开关 `FF_WAVE3_FIRM_DRIVEN_REVIEW`，控制：
- Layer 2 cron 启动
- Layer 3 cron 启动
- Webhook dispatcher Layer 2/3 路由（false 时只走 onboarding）
- ProfileBanner 返回范围
- Onboarding flow 创建 initial assessment（false 时保留旧 ONBOARDING_FINAL_APPROVAL 兼容路径）

### 10.5 全局 Edge Cases

| 情况 | 处理 |
|---|---|
| Sumsub API 完全宕机 | Pending 记录保留，独立重试 cron 每 10min 扫一次，最多 3 次；失败告警 |
| Sumsub 429 rate limit | 退避重试 1s/5s/30s；cron batch 严格控制 80/min |
| Webhook secret 验证失败 | 401 + security 告警，不处理事件 |
| Webhook 事件顺序错乱 | 按 `createdAtMs` 排序，以最新为准 |
| Customer 多设备并发访问 /verification | 两个 device 共用同一 `sumsubActionId` |
| Customer 在 cycle 进行中又 tier 升级 | 对 active cycle 的 holding 跳过 window 重算 |
| customer.riskTier 和 assessment 不一致 | 每日 consistency check cron 修正 + 告警 |
| Sumsub applicant 被手动 delete | consistency check 检测 404，holdings 进 UNKNOWN，告警 MLRO |
| 两个 Action Level 命名冲突 | 部署前 lint 核对 policy JSON vs Sumsub Dashboard |
| FROZEN 状态下客户尝试 /verification refresh | 403 + "账户冻结期间无法刷新材料" |

### 10.6 监控 + 告警

Metrics:
- `wave3_assessment_total{status, triggerType, signoffMethod}`
- `wave3_assessment_stuck_total`
- `wave3_assessment_escalated_to_sumsub_total{label}`
- `wave3_material_refresh_cycle_total{status, stage, triggerType}`
- `wave3_material_refresh_grace_expired_total`
- `wave3_sumsub_api_calls_total{endpoint, status}`
- `wave3_sumsub_webhook_unrouted_total`

告警:
- Sanctions 命中: CRITICAL, page MLRO
- Assessment stuck > 30min: HIGH, page engineer
- Daily cron 失败: HIGH, page engineer
- Sumsub API 5xx > 5%: MEDIUM, Slack
- Webhook signature 无效 > 10/min: HIGH, page security
- PEP approval 超时未签: MEDIUM, Slack 提醒合规
- Refresh cycle grace 超期: INFO, 日汇总

### 10.7 Rollback 预案

| 场景 | 预案 |
|---|---|
| cron 行为异常 | FF=false 立即停 cron；不 revert schema；修 bug 后再开 |
| 数据损坏 | FF=false；写数据修复脚本；修复后再开 |
| Sumsub 集成故障导致 onboarding 挂 | 立即 revert SumsubWebhookDispatcher，保留其他代码 |
| 灾难性故障 | **不 revert schema**（数据优先保留）；revert 服务代码；新字段 fallback 读取双字段 |

---

## 11. Acceptance Criteria

本重设计完成的判断：

1. **Layer 2 能产出 ClientRiskAssessment** 覆盖 4 种 AML result 分支（GREEN / RED SANCTIONS / RED PEP / RED OTHER）
2. **Layer 2 signoff 路由** 能正确对应到 3 个新 action type + AUTO_R2
3. **Wave 1 ApprovalCase 多步** 成功支持 PEP 双签（MLRO → SENIOR）
4. **Layer 3 daily cron** 能推进 holding 通过 NOTIFIED → URGENT → BLOCKING 并创建 MaterialRefreshCycle
5. **Sumsub Applicant Action 集成**: cycle 创建时调 Sumsub，客户通过 /verification 拿 SDK token，完成后 webhook 关闭 cycle
6. **Tier 升级级联**: Layer 2 签完字升 tier → Layer 3 重算 holdings window + 创建缺失材料的 initial collection cycle
7. **Sumsub Ongoing Monitoring webhook** 能路由到 Layer 2 `SUMSUB_AML_HIT` 触发路径
8. **Sumsub Ongoing Document Monitoring webhook** 能路由到 Layer 3 `SUMSUB_DOC_MONITORING` 兜底路径
9. **Simulation controller** 能驱动 6 个 e2e 测试剧本
10. **Backfill script** 成功给 staging 所有 APPROVED 客户创建 holdings
11. **Customer /profile banner** 正确显示 active cycles + 限制/冻结状态
12. **/verification 页面** 支持 onboarding 和 refresh 两种模式，复用 Sumsub WebSDK
13. **AuthGuard** 对 FROZEN / RESTRICTED 做路由级拦截，而非全屏拦截
14. **交易服务 backend guard** 拒绝 RESTRICTED / FROZEN 客户的交易请求
15. **Wave 2 compliance 内容（alert / case / risk engine）零引用** 在 Wave 3 新代码中
16. **VARA III.D.8 每 3 月硬闸门** 体现为 `assessmentFrequencyDays.LOW/MED/HIGH = 90` 的 cron 调度
17. **FATF R.12 senior management PEP approval** 体现为 `PEP_RELATIONSHIP_APPROVAL` 双签 catalog entry

---

## 12. Task List (for writing-plans)

```
Phase 0: 预配 (并行, non-code)
  T0.1  Sumsub Dashboard 配 4 个 Action Level
  T0.2  Sumsub Dashboard 启用 Ongoing Doc + AML Monitoring
  T0.3  Sumsub Dashboard 配 ID 过期策略
  T0.4  写 docs/operations/sumsub-dashboard-wave3-config-runbook.md

Phase 1: Approval Kernel 扩展
  T1.1  approvals.service.ts 支持多步 createCase
  T1.2  approvals.service.ts 支持多步 approve (推进 or 最终 APPROVED)
  T1.3  approvals.service.ts 支持多步 reject (任一步 REJECT → case REJECTED)
  T1.4  多步权限检查 (角色匹配 current step)
  T1.5  多步单元测试 (happy / reject 每步 / 超时 / 权限错误)

Phase 2: Schema 迁移
  T2.1  prisma/schema.prisma: customer_main rename + 新字段
  T2.2  prisma/schema.prisma: 新增 3 张表
  T2.3  SQLite migration
  T2.4  更新 onboarding.service.ts 使用新字段名
  T2.5  更新 approvals.service.spec.ts 的引用
  T2.6  admin-web 更新显示字符串
  T2.7  移除 ONBOARDING_FINAL_APPROVAL action type
  T2.8  新增 3 个 Wave 3 action type catalog entries

Phase 3: Layer 2 实现
  T3.1  config/client-risk-assessment-policy.json (v1.0.0)
  T3.2  src/modules/identity/client-risk-assessment/ 模块骨架
  T3.3  policy/client-risk-assessment-policy.ts pure function
  T3.4  policy/policy-loader.ts
  T3.5  client-risk-assessment.service.ts - startAssessment()
  T3.6  client-risk-assessment.service.ts - handleSumsubAmlResult()
  T3.7  client-risk-assessment.service.ts - recordAssessmentFromKnownAmlResult()
  T3.8  client-risk-assessment.service.ts - handleSignoffComplete()
  T3.9  client-risk-assessment.service.ts - postSignoffCascade()
  T3.10 client-risk-assessment.service.ts - handleSumsubCaseFinalDecision()
  T3.11 client-risk-assessment-cron.service.ts - quarterly cron
  T3.12 admin 触发 API
  T3.13 单元测试 (policy 穷举 + service mock)

Phase 4: Layer 3 实现
  T4.1  config/material-refresh-policy.json (v1.0.0)
  T4.2  src/modules/identity/material-refresh/ 模块骨架
  T4.3  policy/material-refresh-policy.ts + compute-stage.ts
  T4.4  material-holding.service.ts
  T4.5  material-refresh.service.ts - enterNotifiedStage / URGENT / BLOCKING
  T4.6  material-refresh.service.ts - handleSumsubActionResult
  T4.7  material-refresh.service.ts - handleSumsubDocMonitoringFire
  T4.8  material-refresh.service.ts - recomputeHoldingsForCustomer
  T4.9  material-refresh.service.ts - createInitialCollectionCycle
  T4.10 material-refresh.service.ts - getSdkTokenForCycle (customer API)
  T4.11 material-freshness-cron.service.ts - daily cron
  T4.12 material-refresh-cycles.controller.ts
  T4.13 单元测试 + integration with Layer 2

Phase 5: Sumsub 集成层
  T5.1  src/modules/identity/sumsub-integration/ 模块骨架
  T5.2  sumsub-webhook-dispatcher.service.ts
  T5.3  admin-sumsub-simulation.controller.ts
  T5.4  改造 onboarding-sumsub-webhook.controller 委托给 dispatcher
  T5.5  扩展 SumsubClient 支持 runAmlCheck + getApplicant +
        createApplicantAction + createActionSdkToken + moveToLevel 
  T5.6  单元测试 dispatcher 路由逻辑

Phase 6: Profile Banner + Frontend
  T6.1  src/modules/identity/profile-banners/ 后端模块
  T6.2  profile-banners.service.ts
  T6.3  profile-banners.controller.ts
  T6.4  client-web: ProfileBanner 组件
  T6.5  client-web: ProfileBannerStack 组件
  T6.6  client-web: CustomerProfile 页面插入 banner stack
  T6.7  client-web: Verification 页面支持 refresh mode
  T6.8  client-web: AuthGuard 细化 FROZEN/RESTRICTED 路由拦截
  T6.9  trading 服务加 ensureCustomerCanTransact guard
        (deposit/withdraw/swap)

Phase 7: Backfill + 上线
  T7.1  scripts/wave3-firm-driven-review-backfill.ts
  T7.2  Feature flag 基建
  T7.3  监控 metrics 埋点
  T7.4  告警规则配置
  T7.5  Dry-run backfill on staging
  T7.6  Real backfill on staging
  T7.7  Staging 验收 (6 测试剧本)
  T7.8  Production 部署 (按 10.3 的 7 步)

Phase 8: 文档
  T8.1  更新 docs/specs/modules/periodic-review-module.md
  T8.2  新建 docs/specs/workflows/firm-driven-customer-review-workflow.md
  T8.3  新建 docs/specs/entities/client-risk-assessment-entity.md
  T8.4  新建 docs/specs/entities/customer-material-holding-entity.md
  T8.5  新建 docs/specs/entities/material-refresh-cycle-entity.md
  T8.6  更新 docs/cleanup/wave-3-residual-cleanup-inventory.md
  T8.7  更新 docs/constraints/onboarding-flow-constraints.md
  T8.8  新建 docs/acceptance/wave3-firm-driven-review-manual-acceptance.md
```

**估算**: ~12.5 人天 (熟悉 codebase 的工程师)

---

## 13. Key Design Decisions Log

以下是 brainstorming 过程中的关键决策 + 依据，写入文档以便未来维护者追溯：

| # | 决策 | 选择 | 依据 |
|---|---|---|---|
| D1 | VARA 3 月硬闸门适用于所有 tier 还是只 LOW | 所有 tier 都 3 月 | 用户决策；VARA 只规定"不超过 3 月"，简化策略 |
| D2 | Sumsub 事件 mirror v1 做还是 deferred | Deferred | 用户决策；节省 5-7 天工作量；Layer 2 降级为 AML label + 本地简单打分 |
| D3 | 必备材料 tier 矩阵 | 方案 A (宽松) | 用户决策；demo 友好；LOW=ID+PoA, MED=+SoF, HIGH=+SoW |
| D4 | 现有 APPROVED 客户 backfill 策略 | Eager 迁移脚本 | 用户决策；demo 规模小；零监控盲区 |
| D5 | 客户通知渠道 | /profile 页 banner | 用户决策；零新基建依赖 |
| D6 | Q2 自动签字范围 | 方案 B | 用户决策；LOW/MED 自动，HIGH 永远 MLRO 手签，PEP 双签 |
| D7 | Layer 2 做法 A (读 score) 或 B (强制跑 AML check) | B | 用户决策；VARA audit trail 要求每次评估时刻 AML 新鲜 |
| D8 | 首次 Layer 2 时机 | onboarding 后 3 月 | 用户决策；onboarding 的 final approval 视为第 0 次 |
| D9 | MaterialRefreshCycle 命名 | 改自原 CddRefreshCycle | 用户指出"CDD" 有歧义，EDD 也包含在内 |
| D10 | Layer 2 signoff 位置 | 本地 Wave 1 ApprovalCase | 用户澄清 Approvals = Wave 1 保留，alerts/cases = Wave 2 废弃 |
| D11 | Wave 2 compliance kernel 处置 | 完全废弃，全部迁 Sumsub | 用户决策；"所有 case 都在 sumsub 里面" |
| D12 | PEP 双签实现 | 扩展 Wave 1 ApprovalStep 单步逻辑到多步 | 用户告知 step 副表已存在，只是 service 没用 |
| D13 | ONBOARDING_FINAL_APPROVAL rename | 移除，用 3 个新 action type 取代 | initial assessment 和 quarterly assessment 统一语义 |
| D14 | Action type 命名 | RISK_RATING_MEDIUM/HIGH_APPROVAL + PEP_RELATIONSHIP_APPROVAL | 用户反馈命名要中性，能同时表达 onboarding + quarterly |
| D15 | LOW initial onboarding 自动签 vs 手签 | 自动（和 Layer 2 方案 B 对齐）| 用户决策；initial 和 quarterly 行为一致 |
| D16 | tier ↔ Sumsub level 关系 | 4 格矩阵约束 | 用户提出简化，避免"L1 HIGH"这种怪物状态 |
| D17 | Layer 2 触发源从 5 砍到 3 | 移除 INITIAL_ONBOARDING 和 MATERIAL_REFRESHED | 用户质疑；initial 由 onboarding 自己创建；material refresh 不改变 tier |
| D18 | Sumsub Ongoing Monitoring pre-expiry | 确认不支持，必须自己 cron | 查 Sumsub 官方文档 |
| D19 | Policy 文档 v1 落地 | JSON config file; markdown 文档 deferred | 用户决策；避免 documentation ceremony 阻塞 plan |
| D20 | 监管响应路径 | Sumsub 内部 case + simulation controller | 用户决策；v1 demo 无真实 Sumsub Dashboard 连接 |

---

## 14. Open Items (Deferred)

明确保留作为 deferred 项，不纳入本设计范围：

1. **Sumsub transaction/behavior 事件 mirror** → `docs/cleanup/deferred-refactors.md` 第 7 项
2. **正式 policy markdown 文档双签发布** → `docs/cleanup/deferred-refactors.md` 第 6 项
3. **企业客户 (corporate) UBO 刷新流程** → 保留占位，demo 阶段只支持 individual
4. **policy config 从 JSON 文件迁到 DB 表** → 生产环境优化项
5. **pre-expiry advance warning** 的高级配置 (按材料类型不同提前天数) → 当前使用统一 stage timeline

---

## 15. References

- `docs/cleanup/deferred-refactors.md` (第 6/7 项)
- `docs/cleanup/2026-04-wave3-foundation-reset/2026-04-05-sumsub-onboarding-redesign-design.md`
- `docs/roadmap/wave-3-customer-onboarding-phase-plan.md` (Phase 5 被本设计替代)
- `docs/specs/modules/periodic-review-module.md` (将被更新)
- `docs/constraints/onboarding-flow-constraints.md`
- VARA Compliance and Risk Management Rulebook (Part III, Sections D and E)
- FATF Recommendation 12 (Politically Exposed Persons)
- [Sumsub — Ongoing AML monitoring](https://docs.sumsub.com/docs/ongoing-aml-monitoring)
- [Sumsub — Ongoing document monitoring](https://docs.sumsub.com/docs/ongoing-document-monitoring)
- [Sumsub — Applicant actions](https://docs.sumsub.com/docs/applicant-actions)
- [Sumsub — Run AML check](https://docs.sumsub.com/reference/run-aml-check)
- [Sumsub — User verification webhooks](https://docs.sumsub.com/docs/user-verification-webhooks)
