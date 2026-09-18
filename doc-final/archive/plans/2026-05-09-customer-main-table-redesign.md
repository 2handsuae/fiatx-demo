# CustomerMain 主表重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CustomerMain 主表从当前混乱的多冗余字段结构重构为设计 spec 定义的 3 状态轴 + restrictions JSON + 2 属性轴的干净结构，为 V3/V4 打地基。

**Architecture:** Prisma schema 迁移 + 全代码库字段重命名 + 核心工具类重写 + 种子数据更新。变更是纯重构，不新增业务逻辑。

**Tech Stack:** Prisma (SQLite), NestJS, React (client-web)

**Spec:** `doc-final/superpowers/specs/2026-05-08-customer-main-table-design.md`

---

## File Structure

### Modified Files

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | CustomerMain model 字段重命名/新增/删除 |
| `src/modules/identity/customer-status.util.ts` | 客户状态类型定义 + 规范化工具 — 核心重写 |
| `src/modules/identity/customer-status.util.spec.ts` | 对应测试 |
| `src/modules/trading/shared/customer-transaction-guard.ts` | 交易门控逻辑 — 核心重写 |
| `prisma/seed.base.ts` | 基础种子数据 |
| `prisma/seed.business.ts` | 业务种子数据 |
| `scripts/wave3-demo-seed.ts` | Wave 3 演示种子 |
| `scripts/wave4-pricing-quote-smoke.ts` | Wave 4 冒烟测试 |
| `client-web/src/hooks/useCustomerProfile.ts` | 客户端 profile hook |
| `client-web/src/utils/customerOnboarding.ts` | 客户端 onboarding 工具 |
| `src/modules/identity/customers/customers.controller.ts` | 客户列表过滤逻辑 |
| `src/modules/identity/customers/customers.controller.spec.ts` | 对应测试 |
| `src/modules/identity/onboarding/*.ts` | onboarding 服务（6 文件） |
| `src/modules/identity/client-risk-assessment/*.ts` | CRA 服务（4 文件） |
| `src/modules/identity/material-refresh/*.ts` | 材料刷新服务（3 文件） |
| `src/modules/identity/periodic-review/*.ts` | 定期复审服务（5 文件） |
| `src/modules/identity/tier-upgrade-case/*.ts` | 等级升级服务（2 文件） |
| `src/modules/identity/profile-banners/profile-banners.service.ts` | Profile banner 服务 |
| `src/modules/identity/auth/customer-auth.service.ts` | 客户认证服务 |
| `src/modules/identity/auth/customer-auth.service.spec.ts` | 对应测试 |
| `src/modules/identity/auth/jwt.strategy.ts` | JWT 策略 |
| `src/modules/identity/auth/jwt.strategy.spec.ts` | 对应测试 |
| `src/modules/risk-engine/*.ts` | 风险引擎服务（8 文件） |
| `src/modules/audit-logging/audit-logs.service.ts` | 审计日志服务 |
| `src/modules/audit-logging/audit-logs.service.spec.ts` | 对应测试 |
| `src/modules/governance/approvals/*.ts` | 审批服务（4 文件） |
| `src/modules/sumsub-ingestion/*.ts` | Sumsub 接入（2 文件） |
| `src/modules/trading/deposit-transactions/*.ts` | 充值交易（3 文件） |
| `src/modules/trading/pricing-center/*.ts` | 定价中心（3 文件） |
| `src/modules/asset-treasury/payins/payins.service.ts` | 入金服务 |

### Created Files

| File | Responsibility |
|---|---|
| `prisma/migrations/xxx_customer_main_redesign/migration.sql` | Prisma 自动生成的迁移文件 |

---

## Task 1: Prisma Schema 迁移

**Files:**
- Modify: `prisma/schema.prisma:178-278`

- [ ] **Step 1: 在 schema.prisma 中修改 CustomerMain model**

重命名字段：
```
operatingStatus → adminStatus
complianceHoldStatus → complianceStatus（默认值从 "ACTIVE" 改为 "CLEAR"）
complianceHoldReason → complianceFreezeReason
complianceHoldCaseId → complianceFreezeCaseId
complianceHoldSetAt → complianceFreezeAt
complianceHoldReleasedAt → complianceFreezeReleasedAt
investorClassification → investorTier（默认值从 "RETAIL" 改为 "STANDARD"）
investorClassificationSource → investorTierSource（默认值从 "CDD" 改为 "ONBOARDING"）
investorClassificationUpdatedAt → investorTierUpdatedAt
```

新增字段：
```prisma
suspendedReason   String?
suspendedAt       DateTime?
restrictions      Json      @default("[]")
riskRating        String    @default("LOW")
riskRatingUpdatedAt DateTime?
```

删除字段：
```
riskScore, riskLevel, riskTier, amlRiskTier, riskUpdatedAt, riskTierUpdatedAt
restrictionStatus, restrictionCaseId, restrictionReason, restrictionSetAt, restrictionReleasedAt
periodicReviewOverdueAt, periodicReviewOverdueReason
```

修改默认值：
```
customerType @default("UNKNOWN") → @default("INDIVIDUAL")
```

修改索引：
```
@@index([complianceHoldStatus]) → @@index([complianceStatus])
@@index([latestRiskApprovalStatus]) → @@index([riskRating])
新增 @@index([adminStatus])
```

完整的新 model 参见 spec 文档第七节。

- [ ] **Step 2: 生成 Prisma 迁移**

Run: `cd Exchange_js && npx prisma migrate dev --name customer_main_redesign`

注意：因为 SQLite 不支持 ALTER COLUMN RENAME，Prisma 会生成一个包含数据迁移的 SQL。检查生成的迁移文件确保：
1. 旧列数据被正确复制到新列
2. `complianceHoldStatus = 'ACTIVE'` 的数据映射到 `complianceStatus = 'CLEAR'`
3. `amlRiskTier` 的值复制到 `riskRating`
4. `investorClassification = 'RETAIL'` 映射到 `investorTier = 'STANDARD'`；`QUALIFIED`/`INSTITUTIONAL` 映射到 `'ENHANCED'`

如果 Prisma 自动迁移不处理数据转换，手动编辑 migration.sql 加入转换逻辑。

- [ ] **Step 3: 生成 Prisma Client**

Run: `cd Exchange_js && npx prisma generate`

Expected: 无报错，`@prisma/client` 重新生成

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
refactor: redesign CustomerMain schema — 3 status axes + restrictions JSON

Rename operatingStatus→adminStatus, complianceHoldStatus→complianceStatus,
investorClassification→investorTier. Add restrictions JSON field, riskRating.
Remove redundant risk fields (riskScore/riskLevel/riskTier/amlRiskTier) and
restriction fields (restrictionStatus + 4 附属). Remove periodicReviewOverdue
fields (belong on PeriodicReviewCycle table).
EOF
)"
```

---

## Task 2: 核心工具类重写 — customer-status.util.ts

**Files:**
- Modify: `src/modules/identity/customer-status.util.ts`
- Modify: `src/modules/identity/customer-status.util.spec.ts`

- [ ] **Step 1: 重写类型定义和规范化函数**

将 `customer-status.util.ts` 中的类型重写：

```typescript
// 旧
export type CustomerOperatingStatus = 'INACTIVE' | 'ACTIVE';
export type CustomerRestrictionStatus = 'CLEAR' | 'RESTRICTED';

// 新
export type CustomerAdminStatus = 'INACTIVE' | 'ACTIVE' | 'SUSPENDED' | 'OFFBOARDED';
export type CustomerComplianceStatus = 'CLEAR' | 'FROZEN';
```

更新 `CustomerCanonicalState` 接口：

```typescript
// 旧
export interface CustomerCanonicalState {
  onboardingStatus: CustomerOnboardingStatus;
  operatingStatus: CustomerOperatingStatus;
  restrictionStatus: CustomerRestrictionStatus;
}

// 新
export interface CustomerCanonicalState {
  onboardingStatus: CustomerOnboardingStatus;
  adminStatus: CustomerAdminStatus;
  complianceStatus: CustomerComplianceStatus;
}
```

更新 `CustomerStatusSource` 接口：

```typescript
// 旧字段
operatingStatus?: string | null;
restrictionStatus?: string | null;

// 新字段
adminStatus?: string | null;
complianceStatus?: string | null;
```

更新所有规范化函数：
- `normalizeCustomerOperatingStatus` → `normalizeCustomerAdminStatus`（增加 `SUSPENDED`、`OFFBOARDED`）
- `normalizeCustomerRestrictionStatus` → 删除（被 restrictions JSON 替代）
- `resolveCustomerCanonicalState` 内部引用更新
- `buildCustomerLifecyclePatch` 内部引用更新
- `isCustomerApprovedAndActive` 更新为检查 `adminStatus === 'ACTIVE'`

- [ ] **Step 2: 更新 customer-status.util.spec.ts**

将所有测试中的 `operatingStatus` 替换为 `adminStatus`，`restrictionStatus` 替换为 `complianceStatus` 相关逻辑。移除 `normalizeCustomerRestrictionStatus` 测试。

- [ ] **Step 3: 运行测试验证**

Run: `cd Exchange_js && npx jest src/modules/identity/customer-status.util.spec.ts --verbose`

Expected: 所有测试通过

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/customer-status.util.ts src/modules/identity/customer-status.util.spec.ts
git commit -m "$(cat <<'EOF'
refactor: rewrite customer-status.util for 3-axis status model

Replace operatingStatus→adminStatus, remove restrictionStatus,
add complianceStatus. Update all normalize/resolve functions.
EOF
)"
```

---

## Task 3: 交易门控重写 — customer-transaction-guard.ts

**Files:**
- Modify: `src/modules/trading/shared/customer-transaction-guard.ts`

- [ ] **Step 1: 重写门控函数**

```typescript
import { ForbiddenException } from '@nestjs/common';

export interface CustomerGateFields {
  onboardingStatus?: string;
  adminStatus?: string;
  complianceStatus?: string;
  restrictions?: Array<{ capability: string; reason: string }> | string;
}

export function ensureCustomerCanTransact(
  customer: CustomerGateFields | null | undefined,
  capability?: string,
): void {
  if (!customer) {
    throw new ForbiddenException('Customer not found');
  }
  if (customer.onboardingStatus !== 'APPROVED') {
    throw new ForbiddenException('Customer onboarding not approved');
  }
  if (customer.complianceStatus === 'FROZEN') {
    throw new ForbiddenException('Account is frozen');
  }
  if (customer.adminStatus !== 'ACTIVE') {
    throw new ForbiddenException('Account is not active');
  }
  if (capability) {
    const restrictions = parseRestrictions(customer.restrictions);
    const blocked = restrictions.some(
      (r) => r.capability === capability || r.capability === 'ALL',
    );
    if (blocked) {
      throw new ForbiddenException(`Operation ${capability} is currently restricted`);
    }
  }
}

function parseRestrictions(
  raw: Array<{ capability: string; reason: string }> | string | null | undefined,
): Array<{ capability: string; reason: string }> {
  if (!raw) return [];
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return []; }
  }
  return Array.isArray(raw) ? raw : [];
}
```

- [ ] **Step 2: 全局搜索 `ensureCustomerCanTransact` 的调用者，确认参数兼容**

Run: `cd Exchange_js && grep -rn "ensureCustomerCanTransact" --include="*.ts" -l`

检查每个调用者传入的 customer 对象是否包含新字段。

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/shared/customer-transaction-guard.ts
git commit -m "$(cat <<'EOF'
refactor: rewrite customer-transaction-guard for 3-axis + restrictions model

Now checks onboardingStatus, complianceStatus, adminStatus, and
restrictions JSON array. Supports capability-specific restriction checks.
EOF
)"
```

---

## Task 4: 种子数据更新

**Files:**
- Modify: `prisma/seed.base.ts`
- Modify: `prisma/seed.business.ts`
- Modify: `scripts/wave3-demo-seed.ts`
- Modify: `scripts/wave4-pricing-quote-smoke.ts`

- [ ] **Step 1: 在 seed.base.ts 中全局替换字段名**

```
operatingStatus → adminStatus
restrictionStatus → 删除（不需要设置，默认 restrictions = []）
amlRiskTier → riskRating
riskLevel → 评估是否可直接删除或替换
investorClassification → investorTier（'RETAIL' → 'STANDARD'）
```

在客户创建数据块中（约 line 457, 472, 1031）：
```typescript
// 旧
operatingStatus: 'ACTIVE',
restrictionStatus: 'CLEAR',
amlRiskTier: 'LOW',

// 新
adminStatus: 'ACTIVE',
complianceStatus: 'CLEAR',
riskRating: 'LOW',
```

注意：`riskLevel` 出现在 approval policy 相关代码中（line 298, 306, 999, 1015），这里的 `riskLevel` 可能是 approval policy 自身的字段而非 CustomerMain 的。检查上下文确认——如果是 `approval_policies` 表的字段则不改。

- [ ] **Step 2: 在 seed.business.ts 中执行相同替换**

Run: `cd Exchange_js && grep -n "operatingStatus\|restrictionStatus\|amlRiskTier\|investorClassification" prisma/seed.business.ts`

按输出逐一替换。

- [ ] **Step 3: 在 scripts/wave3-demo-seed.ts 和 wave4-pricing-quote-smoke.ts 中执行相同替换**

Run: `cd Exchange_js && grep -n "operatingStatus\|restrictionStatus\|amlRiskTier\|riskTier\|investorClassification\|complianceHoldStatus" scripts/wave3-demo-seed.ts scripts/wave4-pricing-quote-smoke.ts`

按输出逐一替换。

- [ ] **Step 4: 验证种子可运行**

Run: `cd Exchange_js && npx prisma db push --force-reset && npx ts-node prisma/seed.base.ts`

Expected: 种子执行无报错

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.base.ts prisma/seed.business.ts scripts/wave3-demo-seed.ts scripts/wave4-pricing-quote-smoke.ts
git commit -m "$(cat <<'EOF'
refactor: update seed files for CustomerMain field renames

operatingStatus→adminStatus, restrictionStatus→removed,
amlRiskTier→riskRating, investorClassification→investorTier.
EOF
)"
```

---

## Task 5: Identity 模块批量重命名 — Onboarding 服务

**Files:**
- Modify: `src/modules/identity/onboarding/onboarding.service.ts`
- Modify: `src/modules/identity/onboarding/onboarding.service.spec.ts`
- Modify: `src/modules/identity/onboarding/onboarding-final-approval.service.ts`
- Modify: `src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`
- Modify: `src/modules/identity/onboarding/onboarding-workflow-transition.service.ts`
- Modify: `src/modules/identity/onboarding/onboarding-workflow-transition.service.spec.ts`
- Modify: `src/modules/identity/onboarding/dto/onboarding.dto.ts`

- [ ] **Step 1: 在以上所有文件中执行全局替换**

替换规则（按顺序执行，避免部分匹配）：
```
complianceHoldReleasedAt → complianceFreezeReleasedAt
complianceHoldStatus → complianceStatus
complianceHoldReason → complianceFreezeReason
complianceHoldCaseId → complianceFreezeCaseId
complianceHoldSetAt → complianceFreezeAt
operatingStatus → adminStatus
restrictionStatus → （视上下文删除或替换为 complianceStatus/restrictions）
amlRiskTier → riskRating
riskTier → riskRating（注意不误改 investorTier）
investorClassification → investorTier
periodicReviewOverdueAt → 删除引用
periodicReviewOverdueReason → 删除引用
```

特殊处理：`restrictionStatus` 在 onboarding 代码中被用于设置客户状态，检查每处用法：
- 如果是 `restrictionStatus: 'CLEAR'` → 删除该行（新 schema 无此字段，默认 restrictions=[]）
- 如果是 `restrictionStatus: 'RESTRICTED'` → 改为操作 restrictions JSON

- [ ] **Step 2: 运行 onboarding 测试**

Run: `cd Exchange_js && npx jest src/modules/identity/onboarding/ --verbose`

Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/onboarding/
git commit -m "$(cat <<'EOF'
refactor: update onboarding services for CustomerMain field renames
EOF
)"
```

---

## Task 6: Identity 模块批量重命名 — CRA / Material / Periodic / Tier / Auth / Profile

**Files:**
- Modify: `src/modules/identity/client-risk-assessment/*.ts`（4 文件）
- Modify: `src/modules/identity/material-refresh/*.ts`（3 文件）
- Modify: `src/modules/identity/periodic-review/*.ts`（5 文件）
- Modify: `src/modules/identity/tier-upgrade-case/*.ts`（2 文件）
- Modify: `src/modules/identity/profile-banners/profile-banners.service.ts`
- Modify: `src/modules/identity/auth/customer-auth.service.ts`
- Modify: `src/modules/identity/auth/customer-auth.service.spec.ts`
- Modify: `src/modules/identity/auth/jwt.strategy.ts`
- Modify: `src/modules/identity/auth/jwt.strategy.spec.ts`
- Modify: `src/modules/identity/customers/customers.controller.ts`
- Modify: `src/modules/identity/customers/customers.controller.spec.ts`

- [ ] **Step 1: 在所有文件中执行全局替换**

使用 Task 5 相同的替换规则。额外注意：

`customers.controller.ts` 的 `buildCustomerStatusWhere` 函数（line 33-37）：
```typescript
// 旧
case 'ACTIVE':
  return {
    onboardingStatus: 'APPROVED',
    operatingStatus: 'ACTIVE',
  };

// 新
case 'ACTIVE':
  return {
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
  };
```

`jwt.strategy.ts` 和 `customer-auth.service.ts` 中的 `complianceHoldStatus` 检查：
```typescript
// 旧
if (customer.complianceHoldStatus === 'FROZEN') { ... }

// 新
if (customer.complianceStatus === 'FROZEN') { ... }
```

- [ ] **Step 2: 运行 identity 模块全部测试**

Run: `cd Exchange_js && npx jest src/modules/identity/ --verbose`

Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/
git commit -m "$(cat <<'EOF'
refactor: update all identity module services for CustomerMain field renames

CRA, material-refresh, periodic-review, tier-upgrade, auth, profile-banners,
customers controller — all updated to use adminStatus, complianceStatus,
riskRating, investorTier.
EOF
)"
```

---

## Task 7: Risk Engine 模块批量重命名

**Files:**
- Modify: `src/modules/risk-engine/risk-engine.service.ts`
- Modify: `src/modules/risk-engine/risk-engine.service.spec.ts`
- Modify: `src/modules/risk-engine/risk-decision-records.service.ts`
- Modify: `src/modules/risk-engine/risk-decision-records.service.spec.ts`
- Modify: `src/modules/risk-engine/risk-decision-records-admin.controller.spec.ts`
- Modify: `src/modules/risk-engine/dto/risk-decision-record.dto.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-compliance.service.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-compliance.service.spec.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.spec.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/dto/tx-compliance.dto.ts`
- Modify: `src/modules/risk-engine/transaction-compliance/types/tx-compliance.types.ts`

- [ ] **Step 1: 执行全局替换**

风险引擎中的特殊替换：
```
amlRiskTier → riskRating
riskTier → riskRating（检查上下文，不误改其他含 riskTier 的变量名）
riskLevel → riskRating（检查上下文，可能有 function 参数名需更新）
riskScore → 删除引用或替换为 riskRating
riskUpdatedAt → riskRatingUpdatedAt
riskTierUpdatedAt → riskRatingUpdatedAt
investorClassification → investorTier
```

注意：`riskLevel` 在 `approval_policies` 表中可能是独立字段，不属于 CustomerMain。只替换明确引用 CustomerMain 字段的位置。

- [ ] **Step 2: 运行 risk-engine 测试**

Run: `cd Exchange_js && npx jest src/modules/risk-engine/ --verbose`

Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/modules/risk-engine/
git commit -m "$(cat <<'EOF'
refactor: update risk-engine for CustomerMain field renames

amlRiskTier/riskTier/riskLevel/riskScore → riskRating,
investorClassification → investorTier.
EOF
)"
```

---

## Task 8: Trading / Governance / Audit / Sumsub / Asset-Treasury 批量重命名

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`
- Modify: `src/modules/trading/deposit-transactions/transaction-deposit-workflow.service.spec.ts`
- Modify: `src/modules/trading/pricing-center/pricing-center.service.ts`
- Modify: `src/modules/trading/pricing-center/pricing-center.quote-lifecycle.spec.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.spec.ts`
- Modify: `src/modules/governance/approvals/approvals.service.ts`
- Modify: `src/modules/governance/approvals/approvals.service.spec.ts`
- Modify: `src/modules/governance/approvals/approval-policy.service.ts`
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/governance/change-tickets/change-tickets.service.spec.ts`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`
- Modify: `src/modules/asset-treasury/payins/payins.service.ts`

- [ ] **Step 1: 执行全局替换**

使用与前面任务相同的替换规则。这些文件中的引用主要是：
- `operatingStatus` → `adminStatus`
- `complianceHoldStatus` → `complianceStatus`
- `restrictionStatus` → 删除或替换
- `amlRiskTier` / `riskTier` → `riskRating`
- `investorClassification` → `investorTier`

特别注意 `governance/approvals/` 中的 `riskLevel`：如果是 approval_policies 表自身的字段则不改。

- [ ] **Step 2: 运行受影响模块测试**

Run: `cd Exchange_js && npx jest src/modules/trading/ src/modules/audit-logging/ src/modules/governance/ src/modules/sumsub-ingestion/ src/modules/asset-treasury/ --verbose`

Expected: 所有测试通过

- [ ] **Step 3: Commit**

```bash
git add src/modules/trading/ src/modules/audit-logging/ src/modules/governance/ src/modules/sumsub-ingestion/ src/modules/asset-treasury/
git commit -m "$(cat <<'EOF'
refactor: update trading/governance/audit/sumsub modules for CustomerMain renames
EOF
)"
```

---

## Task 9: Client-Web 前端更新

**Files:**
- Modify: `client-web/src/hooks/useCustomerProfile.ts`
- Modify: `client-web/src/utils/customerOnboarding.ts`

- [ ] **Step 1: 更新 useCustomerProfile.ts**

更新 `CustomerProfileData` 接口：
```typescript
// 旧字段
operatingStatus?: string;
restrictionStatus?: string;
complianceHoldStatus?: string;
amlRiskTier: string;
periodicReviewOverdueAt?: string | null;
periodicReviewOverdueReason?: string | null;
investorClassification?: string | null;

// 新字段
adminStatus?: string;
complianceStatus?: string;
restrictions?: Array<{ capability: string; reason: string; guidance: string; source: string; sourceRef?: string; blockedAt: string; expiresAt?: string }>;
riskRating: string;
investorTier?: string | null;
```

更新 `fetchProfile` 中的字段映射：
```typescript
// 旧
operatingStatus: data.operatingStatus || 'INACTIVE',
restrictionStatus: data.restrictionStatus || 'CLEAR',
complianceHoldStatus: data.complianceHoldStatus || 'ACTIVE',
amlRiskTier: data.amlRiskTier || 'LOW',
periodicReviewOverdueAt: data.periodicReviewOverdueAt || null,
periodicReviewOverdueReason: data.periodicReviewOverdueReason || null,
investorClassification: data.investorClassification || 'RETAIL',

// 新
adminStatus: data.adminStatus || 'INACTIVE',
complianceStatus: data.complianceStatus || 'CLEAR',
restrictions: Array.isArray(data.restrictions) ? data.restrictions : [],
riskRating: data.riskRating || 'LOW',
investorTier: data.investorTier || 'STANDARD',
```

- [ ] **Step 2: 更新 customerOnboarding.ts**

Run: `cd Exchange_js && grep -n "operatingStatus\|restrictionStatus\|complianceHoldStatus" client-web/src/utils/customerOnboarding.ts`

按输出逐一替换。

- [ ] **Step 3: 全局搜索 client-web 中是否有其他引用**

Run: `cd Exchange_js && grep -rn "operatingStatus\|complianceHoldStatus\|restrictionStatus\|amlRiskTier\|investorClassification" client-web/src/ --include="*.ts" --include="*.tsx"`

如有遗漏，逐一修复。

- [ ] **Step 4: Commit**

```bash
git add client-web/
git commit -m "$(cat <<'EOF'
refactor: update client-web for CustomerMain field renames

Update CustomerProfileData interface and fetchProfile mapping to use
adminStatus, complianceStatus, restrictions, riskRating, investorTier.
EOF
)"
```

---

## Task 10: 全量构建与测试验证

- [ ] **Step 1: TypeScript 编译检查**

Run: `cd Exchange_js && npx tsc --noEmit 2>&1 | head -50`

Expected: 无编译错误。如有错误，逐一修复遗漏的字段引用。

- [ ] **Step 2: 运行全量测试**

Run: `cd Exchange_js && npx jest --verbose 2>&1 | tail -30`

Expected: 所有测试通过

- [ ] **Step 3: 全局残留检查**

Run: `cd Exchange_js && grep -rn "operatingStatus\|complianceHoldStatus\|complianceHoldReason\|complianceHoldCaseId\|complianceHoldSetAt\|complianceHoldReleasedAt\|restrictionStatus\|restrictionCaseId\|restrictionReason\|restrictionSetAt\|restrictionReleasedAt\|investorClassification\b\|amlRiskTier\|riskTierUpdatedAt\|periodicReviewOverdueAt\|periodicReviewOverdueReason" --include="*.ts" --include="*.tsx" --include="*.prisma" | grep -v "node_modules\|\.generated\|migration"`

Expected: 无输出（所有旧字段名已清除）。如有残留，逐一修复。

- [ ] **Step 4: 数据库重建验证**

Run: `cd Exchange_js && npm run dev:rebuild`

Expected: 数据库重建成功，种子数据加载无报错

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
refactor: fix any remaining references from CustomerMain field renames
EOF
)"
```

仅在 Step 3 发现残留时才有内容需要提交，否则跳过。
