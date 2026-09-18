# 第二幕客户域 · 波三「交易档位升级」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 客户主动申请 → Sumsub 模拟补高级材料 → 运营提单 → 高管批 → `tradingTier` BASIC→PREMIUM 当场生效；并把 TB 账本户运行时开户钩子挂上首次 ACTIVE（BACKLOG :155 ⭐ 销账）。

**Architecture:** 新主体 `tier_upgrade_applications`（4 态 4 边显式迁移表）+ 新模块 `identity/tier-upgrade/`（与 onboarding 平级）；Sumsub 侧加申请人级 PREMIUM 档，webhook `applicantReviewed` 按「在审升级申请单存在性」分发两线；审批照入驻准入同构（`ApprovalHandlerBase` 单步高管批）；`tradingTier` 唯一写口收编在裁决处理器；限额门实时读列、生效链零改动。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle ｜ React (admin-web / client-web) ｜ jest

**Spec:** `doc-final/superpowers/specs/2026-09-07-act2-wave3-tier-upgrade-design.md`（§ 编号在下文任务里直接引用）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **每条 node/npm/npx/jest 命令前置 Node20 PATH**：`export PATH="$(ls -d $HOME/.nvm/versions/node/v20*/bin | tail -1):$PATH"`（本机 shell 默认 node18，`nvm use` 无效）；jest 命令**不接管道尾 tail/grep**（吞退出码），且**必须在 `Exchange_js/` 仓库根下跑**
  - **worktree 隔离**：执行前经 superpowers:using-git-worktrees 建 `.claude/worktrees/act2-wave3-tier-upgrade`，一会话一树一分支一 self 栈；带栈的 npm 脚本一律 `bash scripts/on-stack.sh self <script>`
  - 管理台 / 客户端**新文案一律英文**（decisions 2026-09-07 英文化裁定，无 i18n）
  - 客户面白名单：内部术语（MATERIALS_CLEARED / rejectType / 原始时间戳 / 内部 id）不出客户面（spec §8）；材料零存储（spec §3）
  - 审计每次带显式 `requestId`；新码先入 `V2_CUSTOMER_AUDIT_ACTIONS` 名册（闸 = `audit-vocabulary-closure.spec.ts`）
  - 派 subagent 的任务 prompt 必须带 `CLAUDE.md` §0–§5 要点；任务执行与任务级评审 → `sonnet`；**Task 5 / 7 / 8（TB 钩子、状态机裁决、档位写入）评审升 `opus`**；终审回主会话（省略 model 走继承）
  - 每任务收尾跑随手闸：`npx tsc --noEmit -p tsconfig.json`（改前端另跑对应 `npx tsc -b --noEmit`）+ 本任务目录 jest 全绿；改前端的任务必须 preview 截图（两条永不豁免之一）

---

### Task 1: 申请单地基 —— schema + 迁移 + 状态常量

**Files:**
- Modify: `prisma/schema.prisma`（新 model + CustomerMain 反向关系）
- Create: `prisma/migrations/<timestamp>_tier_upgrade_applications/migration.sql`（由 prisma 生成）
- Create: `src/modules/identity/tier-upgrade/tier-upgrade.constant.ts`
- Test: `src/modules/identity/tier-upgrade/tier-upgrade.constant.spec.ts`

**Interfaces:**
- Produces: `TierUpgradeStatus`（`'IN_REVIEW' | 'MATERIALS_CLEARED' | 'APPROVED' | 'REJECTED'`）、`assertTierUpgradeTransition(from, to)`（非法边抛 `BadRequestException`）、Prisma model `TierUpgradeApplication`（表 `tier_upgrade_applications`）——Task 6/7/8 全部消费

**本任务过清单哪几条**：改 schema（新增迁移、不写 backfill）｜新状态走显式迁移表

- [ ] **Step 1: schema 加 model**（先看 `model InternalTransfer` 尾部确认 `@@map` 惯例后照写；`CustomerMain`（`schema.prisma:187` 附近）关系列表加一行 `tierUpgradeApplications TierUpgradeApplication[]`）

```prisma
model TierUpgradeApplication {
  id                   String    @id @default(uuid())
  upgradeNo            String    @unique
  customerId           String
  status               String    @default("IN_REVIEW") // IN_REVIEW | MATERIALS_CLEARED | APPROVED | REJECTED
  fromTier             String // 本波恒 BASIC，落列为审计真相
  toTier               String // 本波恒 PREMIUM
  materialsSubmittedAt DateTime?
  decidedAt            DateTime?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  customer CustomerMain @relation(fields: [customerId], references: [id])

  @@index([customerId, status])
  @@map("tier_upgrade_applications")
}
```

- [ ] **Step 2: 生成迁移 + client**

Run: `export DATABASE_URL="file:/tmp/plan-t1.db" && npx prisma migrate dev --name tier_upgrade_applications && npm run prisma:generate`
Expected: 迁移文件落盘、空库建起、generate 零错

- [ ] **Step 3: 写状态常量（含失败测试先行）**

`tier-upgrade.constant.spec.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';
import { assertTierUpgradeTransition, TIER_UPGRADE_TRANSITIONS } from './tier-upgrade.constant';

describe('tier-upgrade 迁移表（4 态 4 边，铁律④）', () => {
  it.each([
    ['IN_REVIEW', 'MATERIALS_CLEARED'],
    ['IN_REVIEW', 'REJECTED'],
    ['MATERIALS_CLEARED', 'APPROVED'],
    ['MATERIALS_CLEARED', 'REJECTED'],
  ] as const)('合法边 %s → %s 放行', (from, to) => {
    expect(() => assertTierUpgradeTransition(from, to)).not.toThrow();
  });

  it.each([
    ['APPROVED', 'REJECTED'],   // 终态零出边
    ['REJECTED', 'IN_REVIEW'],  // 被拒不复活——再申请开新单
    ['IN_REVIEW', 'APPROVED'],  // 不许跳过材料审
    ['MATERIALS_CLEARED', 'IN_REVIEW'], // 不回头
  ] as const)('非法边 %s → %s 显式拒', (from, to) => {
    expect(() => assertTierUpgradeTransition(from as any, to as any)).toThrow(BadRequestException);
  });

  it('恰好 4 条边（防边表悄悄长草）', () => {
    expect(Object.values(TIER_UPGRADE_TRANSITIONS).flat()).toHaveLength(4);
  });
});
```

`tier-upgrade.constant.ts`:

```typescript
import { BadRequestException } from '@nestjs/common';

/**
 * 升级申请单状态机 —— 4 态 4 边，唯一真相源（铁律④）。
 * RED-RETRY 不是边：停留 IN_REVIEW、清 materialsSubmittedAt 重开会话（spec §4）。
 * 「审批中」不是状态：从关联审批单推导展示（波二教义）。
 */
export type TierUpgradeStatus = 'IN_REVIEW' | 'MATERIALS_CLEARED' | 'APPROVED' | 'REJECTED';

export const TIER_UPGRADE_TRANSITIONS: Record<TierUpgradeStatus, TierUpgradeStatus[]> = {
  IN_REVIEW: ['MATERIALS_CLEARED', 'REJECTED'], // GREEN ｜ RED-FINAL
  MATERIALS_CLEARED: ['APPROVED', 'REJECTED'],  // 高管批 ｜ 高管否
  APPROVED: [],
  REJECTED: [],
};

export function assertTierUpgradeTransition(from: TierUpgradeStatus, to: TierUpgradeStatus): void {
  if (!TIER_UPGRADE_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(`Illegal tier-upgrade transition: ${from} -> ${to}`);
  }
}
```

- [ ] **Step 4: 跑测试红→绿 + 闸**

Run: `npx jest src/modules/identity/tier-upgrade --silent` → 全绿；`npx tsc --noEmit -p tsconfig.json` → 0 错

- [ ] **Step 5: Commit** `git add prisma/schema.prisma prisma/migrations src/modules/identity/tier-upgrade && git commit -m "feat(档位升级): 申请单表+4态4边迁移表"`

---

### Task 2: 合同出生 —— 审批类型 + 6 审计码 + 三处同加

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`ApprovalActionTypes` :69 附近加键；POLICY 表 :362 附近加策略）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（三处：`AuditBusinessWorkflowTypes` :91 段、`AuditActions` :460 段、`V2_CUSTOMER_AUDIT_ACTIONS` :975 段）
- Modify: `admin-web/src/pages/approvalEntityRoutes.ts`（:52 客户域段）
- Modify: `scripts/verify-rbac.ts`（:281 `MAKER_GROUP_BY_POLICY`）

**Interfaces:**
- Produces: `ApprovalActionTypes.CUSTOMER_TIER_UPGRADE`、`AuditBusinessWorkflowTypes.CUSTOMER_TIER_UPGRADE`（→ 二级事件名 `workflow.customer-tier-upgrade.decided`）、六个 `AuditActions.TIER_UPGRADE_* / CUSTOMER_LEDGER_PROVISIONED` —— Task 5/6/7/8 消费

**本任务过清单哪几条**：新增审计动作码（四属性出生即冻结）｜新增 maker-checker 审批策略（verify-rbac 加行）

- [ ] **Step 1: approval.constants.ts** —— `ApprovalActionTypes` 加 `CUSTOMER_TIER_UPGRADE: 'CUSTOMER_TIER_UPGRADE',`；POLICY 表照 `CUSTOMER_ONBOARDING_ACCEPTANCE`（:362-366）逐字同款加：

```typescript
  [ApprovalActionTypes.CUSTOMER_TIER_UPGRADE]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```

**不加**进 `V1_APPROVAL_ACTION_TYPES`（跟入驻准入同先例：不进审批策略管理 UI 白名单）。

- [ ] **Step 2: audit-actions.constant.ts 三处**

`AuditBusinessWorkflowTypes` 段加 `CUSTOMER_TIER_UPGRADE: 'CUSTOMER_TIER_UPGRADE',`。
`AuditActions` 段（入驻 8 码之后）加：

```typescript
  // ── 档位升级（波三 2026-09-07）──────────────────────
  TIER_UPGRADE_APPLIED: 'TIER_UPGRADE_APPLIED',
  TIER_UPGRADE_SUBMITTED: 'TIER_UPGRADE_SUBMITTED',
  TIER_UPGRADE_VERDICT_APPLIED: 'TIER_UPGRADE_VERDICT_APPLIED',
  TIER_UPGRADE_ACCEPTANCE_SUBMITTED: 'TIER_UPGRADE_ACCEPTANCE_SUBMITTED',
  TIER_UPGRADE_ACCEPTANCE_DECIDED: 'TIER_UPGRADE_ACCEPTANCE_DECIDED',
  CUSTOMER_LEDGER_PROVISIONED: 'CUSTOMER_LEDGER_PROVISIONED',
```

`V2_CUSTOMER_AUDIT_ACTIONS`（入驻 8 条之后，22 → 28）：

```typescript
  // ── 档位升级（6，波三 2026-09-07）：客户级件，correlationMode 全 N ──
  TIER_UPGRADE_APPLIED:              { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  TIER_UPGRADE_SUBMITTED:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  TIER_UPGRADE_VERDICT_APPLIED:      { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  TIER_UPGRADE_ACCEPTANCE_SUBMITTED: { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  TIER_UPGRADE_ACCEPTANCE_DECIDED:   { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
  CUSTOMER_LEDGER_PROVISIONED:       { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
```

- [ ] **Step 3: 三处同加另外两处**

`approvalEntityRoutes.ts` 客户域段（`CUSTOMER_ONBOARDING_ACCEPTANCE` 行下）加：`CUSTOMER_TIER_UPGRADE: (r) => \`/admin/customers/${r}\`,`（entityRef = customerNo，同入驻先例）。
`scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加：`CUSTOMER_TIER_UPGRADE: 'CUSTOMER_TIER_UPGRADE_WRITE',`（组 Task 9 才建，S5 在收尾闸跑，届时已齐）。

- [ ] **Step 4: 闸**

Run: `npx jest src/modules/audit-logging --silent`（封册守则 + 四属性断言全绿）；`npx tsc --noEmit -p tsconfig.json`；`cd admin-web && npx tsc -b --noEmit && cd ..`
Expected: 全绿（词表闭合测试证明 6 码已归籍 V2 册）

- [ ] **Step 5: Commit** `git commit -m "feat(档位升级): 审批类型+6审计码合同出生,三处同加"`

---

### Task 3: PREMIUM 申请人级 level 常量 + 模板

**Files:**
- Modify: `src/modules/identity/constants/onboarding-level.constant.ts`
- Test: `src/modules/identity/constants/onboarding-level.constant.spec.ts`（新建，锁模板形状）

**Interfaces:**
- Produces: `ONBOARDING_LEVELS.PREMIUM === 'premium-tier-level'`；`ONBOARDING_LEVEL_TEMPLATES[PREMIUM]`（kind `'TIER_UPGRADE_UPLOAD'`，两个上传槽）—— Task 6/11 消费

**本任务过清单哪几条**：（承接波二偏差① 收口）申请人级与动作级 level **不合并**——本任务只动申请人级表，`material-policy.ts` 不碰

- [ ] **Step 1: 常量扩展**

```typescript
export const ONBOARDING_LEVELS = {
  CDD: 'basic-cdd-level',
  EDD: 'edd-sof-sow-level',
  PREMIUM: 'premium-tier-level', // 波三档位升级档（spec §3）
} as const;

export interface OnboardingLevelTemplate {
  kind: 'CDD_FORM' | 'EDD_UPLOAD' | 'TIER_UPGRADE_UPLOAD';
  uploadSlots?: Array<{ code: 'SOURCE_OF_FUNDS' | 'SOURCE_OF_WEALTH' | 'PROOF_OF_ADDRESS'; label: string }>;
}

export const ONBOARDING_LEVEL_TEMPLATES: Record<OnboardingLevelName, OnboardingLevelTemplate> = {
  [ONBOARDING_LEVELS.CDD]: { kind: 'CDD_FORM' },
  [ONBOARDING_LEVELS.EDD]: {
    kind: 'EDD_UPLOAD',
    uploadSlots: [
      { code: 'SOURCE_OF_FUNDS', label: 'Source of Funds (SoF)' },
      { code: 'SOURCE_OF_WEALTH', label: 'Source of Wealth (SoW)' },
    ],
  },
  [ONBOARDING_LEVELS.PREMIUM]: {
    kind: 'TIER_UPGRADE_UPLOAD',
    uploadSlots: [
      { code: 'PROOF_OF_ADDRESS', label: 'Proof of Address (PoA)' },
      { code: 'SOURCE_OF_FUNDS', label: 'Source of Funds (SoF)' },
    ],
  },
};
```

- [ ] **Step 2: 测试**（`onboarding-level.constant.spec.ts`）

```typescript
import { ONBOARDING_LEVELS, ONBOARDING_LEVEL_TEMPLATES } from './onboarding-level.constant';

describe('申请人级 level 常量（波三 +PREMIUM）', () => {
  it('三档齐且值不漂（sumsubCurrentLevelName 的合法值域）', () => {
    expect(ONBOARDING_LEVELS).toEqual({
      CDD: 'basic-cdd-level', EDD: 'edd-sof-sow-level', PREMIUM: 'premium-tier-level',
    });
  });
  it('PREMIUM 模板 = 两个上传槽（PoA + SoF），零存储只是形状', () => {
    expect(ONBOARDING_LEVEL_TEMPLATES[ONBOARDING_LEVELS.PREMIUM]).toEqual({
      kind: 'TIER_UPGRADE_UPLOAD',
      uploadSlots: [
        { code: 'PROOF_OF_ADDRESS', label: 'Proof of Address (PoA)' },
        { code: 'SOURCE_OF_FUNDS', label: 'Source of Funds (SoF)' },
      ],
    });
  });
});
```

- [ ] **Step 3: 闸 + Commit**

Run: `npx jest src/modules/identity/constants src/modules/identity/onboarding --silent`（含入驻既有 spec 回归——`Record<OnboardingLevelName,...>` 扩键后须仍编译）；`npx tsc --noEmit -p tsconfig.json`
`git commit -m "feat(档位升级): PREMIUM 申请人级 level+上传模板"`

---

### Task 4: TB 运行时开户 service（accounting 侧）

**Files:**
- Create: `src/modules/accounting/tigerbeetle/customer-ledger-provisioning.service.ts`
- Modify: `src/modules/accounting/tigerbeetle/tigerbeetle.module.ts`（providers + exports 各加一行）
- Test: `src/modules/accounting/tigerbeetle/customer-ledger-provisioning.service.spec.ts`

**Interfaces:**
- Consumes: `AccountingService.createAccounts(paramsList, tx?)`、`TbAccountRegistryService.resolve({code, ledger, ownerType, ownerUuid})`
- Produces: `CustomerLedgerProvisioningService.provisionCustomerAccounts({id, customerNo}): Promise<{ created: number; accounts: string[] }>` —— Task 5 消费

**本任务过清单哪几条**：动了钱那行的**边界确认**——开户无分录、用既有科目码（CLIENT_PAYABLE/DEPOSIT_SUSPENSE），不新增科目；TB 不可达当场抛（不 graceful skip）

- [ ] **Step 1: 失败测试先行**

```typescript
import { CustomerLedgerProvisioningService } from './customer-ledger-provisioning.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';

const OWNER = { id: 'uuid-1', customerNo: 'CU250907001' };
const makeDeps = (over: { assets?: any[]; existing?: any } = {}) => {
  const prisma: any = {
    asset: { findMany: jest.fn().mockResolvedValue(over.assets ?? [
      { code: 'AED', currency: 'AED' },
      { code: 'USDT-TRON', currency: 'USDT' },
      { code: 'USDT-ERC20', currency: 'USDT' }, // 同币种第二资产：ledger 撞，须去重
    ]) },
  };
  const registry: any = { resolve: jest.fn().mockResolvedValue(over.existing ?? null) };
  const accounting: any = { createAccounts: jest.fn().mockResolvedValue(undefined) };
  return { prisma, registry, accounting };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new CustomerLedgerProvisioningService(d.prisma, d.accounting, d.registry);

describe('CustomerLedgerProvisioningService（spec §7）', () => {
  it('ACTIVE 资产×两科目、按 (code,ledger) 去重：三资产两币种 → 4 户一次建齐', async () => {
    const d = makeDeps();
    const r = await build(d).provisionCustomerAccounts(OWNER);
    expect(r.created).toBe(4);
    const params = d.accounting.createAccounts.mock.calls[0][0];
    expect(params).toHaveLength(4);
    expect(params.map((p: any) => [p.code, p.ledger]).sort()).toEqual([
      [TB_ACCOUNT_CODES.CLIENT_PAYABLE, 1], [TB_ACCOUNT_CODES.CLIENT_PAYABLE, 2],
      [TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, 1], [TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE, 2],
    ].sort());
    expect(params[0]).toMatchObject({ ownerType: 'CUSTOMER', ownerUuid: 'uuid-1', ownerNo: 'CU250907001' });
  });

  it('registry 已有行（种子客户）→ 跳过、零建户（与种子 findFirst 语义一致，spec §7）', async () => {
    const d = makeDeps({ existing: { tbAccountId: 'deadbeef' } });
    const r = await build(d).provisionCustomerAccounts(OWNER);
    expect(r.created).toBe(0);
    expect(d.accounting.createAccounts).not.toHaveBeenCalled();
  });

  it('TB 建户抛错 → 原样上抛，不吞（吞错正是 :155 卡单的病根）', async () => {
    const d = makeDeps();
    d.accounting.createAccounts.mockRejectedValue(new Error('TB down'));
    await expect(build(d).provisionCustomerAccounts(OWNER)).rejects.toThrow('TB down');
  });
});
```

Run: `npx jest src/modules/accounting/tigerbeetle/customer-ledger-provisioning --silent` → FAIL（服务不存在）

- [ ] **Step 2: 实现**

```typescript
// src/modules/accounting/tigerbeetle/customer-ledger-provisioning.service.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from './accounting.service';
import { TbAccountRegistryService } from './tb-account-registry.service';
import { TB_ACCOUNT_CODES } from './constants/tb-account-codes.constant';
import { TB_LEDGERS } from './constants/tb-ledgers.constant';
import { CreateTbAccountParams } from './types/accounting.types';

/**
 * 客户账本户运行时开户（波三 spec §7，BACKLOG :155 销账）。
 * 行形状与种子 seedCustomers 同款：ACTIVE 资产 × [CLIENT_PAYABLE, DEPOSIT_SUSPENSE]，
 * 同币种多资产共 ledger、行按 (code, ledger) 一份（与种子 ensureTbAccountRegistry 的
 * findFirst 语义一致）。TB 不可达 = 抛错阻断激活，不 graceful skip。
 */
@Injectable()
export class CustomerLedgerProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounting: AccountingService,
    private readonly registry: TbAccountRegistryService,
  ) {}

  async provisionCustomerAccounts(owner: { id: string; customerNo: string }): Promise<{ created: number; accounts: string[] }> {
    const assets = await this.prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      select: { code: true, currency: true },
    });
    const params: CreateTbAccountParams[] = [];
    const seen = new Set<string>();
    const accounts: string[] = [];
    for (const asset of assets) {
      const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
      for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
        const key = `${code}|${ledger}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = await this.registry.resolve({ code, ledger, ownerType: 'CUSTOMER', ownerUuid: owner.id });
        if (existing) continue;
        const name = code === TB_ACCOUNT_CODES.CLIENT_PAYABLE ? 'CLIENT_PAYABLE' : 'DEPOSIT_SUSPENSE';
        accounts.push(`${name}/${asset.currency}`);
        params.push({
          code, ledger, ownerType: 'CUSTOMER', ownerUuid: owner.id, ownerNo: owner.customerNo,
          assetCurrency: asset.code, description: `${name} for ${owner.customerNo}/${asset.code}`,
        });
      }
    }
    if (params.length > 0) await this.accounting.createAccounts(params);
    return { created: params.length, accounts };
  }
}
```

`tigerbeetle.module.ts`：providers 与 exports 各加 `CustomerLedgerProvisioningService`（import 语句同步）。

- [ ] **Step 3: 跑绿 + 闸 + Commit**

Run: `npx jest src/modules/accounting/tigerbeetle --silent`（含既有 4 个 spec 回归）；`npx tsc --noEmit -p tsconfig.json`
`git commit -m "feat(档位升级): TB 客户账本户运行时开户 service"`

---

### Task 5: 入驻 workflow 首次 ACTIVE 钩子（⭐ 销账的接线）【评审升 opus】

**Files:**
- Modify: `src/modules/identity/onboarding/onboarding-workflow.service.ts`（构造函数 + `applyReviewVerdict` + `onAcceptanceDecided` + 新私有方法）
- Modify: `src/modules/identity/onboarding/onboarding.module.ts`（imports 加 `TigerBeetleModule`）
- Test: `src/modules/identity/onboarding/onboarding-workflow.service.spec.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `CustomerLedgerProvisioningService.provisionCustomerAccounts`（Task 4）、`AuditActions.CUSTOMER_LEDGER_PROVISIONED`（Task 2）
- Produces: 行为——现场客户首次进 ACTIVE（CDD_CLEARED 或 FINAL_APPROVED）前账本户已开好；种子客户（`onboardingApprovedAt` 已回填）钩子恒不触发

**本任务过清单哪几条**：任何持久状态变化写审计（recordSystem + 显式 requestId）

- [ ] **Step 1: 失败测试先行**（追加到既有 spec；`makeDeps` 加 `provisioning = { provisionCustomerAccounts: jest.fn().mockResolvedValue({ created: 4, accounts: ['CLIENT_PAYABLE/AED'] }) }`，`build` 构造参数尾部追加 `d.provisioning as any`）

```typescript
describe('首次 ACTIVE 开账本户钩子（波三 spec §7）', () => {
  it('CDD GREEN 且 onboardingApprovedAt 为 null → 先开户再迁移，且留 CUSTOMER_LEDGER_PROVISIONED 痕', async () => {
    const d = makeDeps(inVerif({ onboardingApprovedAt: null }));
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(d.provisioning.provisionCustomerAccounts).toHaveBeenCalledWith({ id: 'cid', customerNo: 'CU250907001' });
    const order = d.provisioning.provisionCustomerAccounts.mock.invocationCallOrder[0];
    expect(order).toBeLessThan(d.lifecycle.applyAction.mock.invocationCallOrder[0]); // 开户在迁移前
    expect(d.audit.recordSystem.mock.calls.some(([p]: any[]) => p.action === 'CUSTOMER_LEDGER_PROVISIONED')).toBe(true);
  });

  it('onboardingApprovedAt 已有值（种子客户/重复进 ACTIVE）→ 钩子不触发', async () => {
    const d = makeDeps(inVerif({ onboardingApprovedAt: new Date('2026-06-01') }));
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(d.provisioning.provisionCustomerAccounts).not.toHaveBeenCalled();
  });

  it('高管准入批准路径（FINAL_APPROVED）同样触发钩子', async () => {
    const d = makeDeps(customerRow({ lifecycle: 'PENDING_APPROVAL', onboardingApprovedAt: null }));
    await build(d).onAcceptanceDecided({ decision: 'APPROVED', entityRef: 'CU250907001', approvalNo: 'APR0001' } as any);
    expect(d.provisioning.provisionCustomerAccounts).toHaveBeenCalled();
  });

  it('TB 不可达 → 激活当场失败（客户停在原态，不产生无账户的 ACTIVE）', async () => {
    const d = makeDeps(inVerif({ onboardingApprovedAt: null }));
    d.provisioning.provisionCustomerAccounts.mockRejectedValue(new Error('TB down'));
    await expect(build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' })).rejects.toThrow('TB down');
    expect(d.lifecycle.applyAction).not.toHaveBeenCalled();
  });

  it('RED 裁决不触发钩子', async () => {
    const d = makeDeps(inVerif({ onboardingApprovedAt: null }));
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'RED', reviewRejectType: 'RETRY' });
    expect(d.provisioning.provisionCustomerAccounts).not.toHaveBeenCalled();
  });
});
```

（`customerRow` 工厂加默认 `onboardingApprovedAt: null`。）Run → FAIL。

- [ ] **Step 2: 实现**——构造函数注入 `private readonly ledgerProvisioning: CustomerLedgerProvisioningService`；新私有方法：

```typescript
  /** 首次进 ACTIVE 前开客户账本户（spec §7）。失败即激活失败——不吞（:155 病根）。 */
  private async provisionLedgerIfFirstActive(c: { id: string; customerNo: string; onboardingApprovedAt: Date | null }) {
    if (c.onboardingApprovedAt) return;
    const r = await this.ledgerProvisioning.provisionCustomerAccounts({ id: c.id, customerNo: c.customerNo });
    await this.audit(AuditActions.CUSTOMER_LEDGER_PROVISIONED, c, {
      afterData: { created: r.created, accounts: r.accounts },
    }, false);
  }
```

`applyReviewVerdict`：算出 `action` 后、`$transaction` 前加 `if (action === 'CDD_CLEARED') await this.provisionLedgerIfFirstActive(c);`
`onAcceptanceDecided`：`const action = ...` 后、`$transaction` 前加 `if (action === 'FINAL_APPROVED') await this.provisionLedgerIfFirstActive(c as any);`
`onboarding.module.ts` imports 加 `TigerBeetleModule`（方向 identity → accounting，无环，不加 forwardRef）。

- [ ] **Step 3: 跑绿 + 闸 + Commit**

Run: `npx jest src/modules/identity/onboarding --silent`；`npx tsc --noEmit -p tsconfig.json`
`git commit -m "feat(档位升级): 首次 ACTIVE 开账本户钩子(BACKLOG:155 接线)"`

---

### Task 6: tier-upgrade 模块骨架 —— 申请 / 概览 / 会话 / 提交 + 客户面 controller

**Files:**
- Create: `src/modules/identity/tier-upgrade/tier-upgrade-workflow.service.ts`
- Create: `src/modules/identity/tier-upgrade/tier-upgrade.client.controller.ts`
- Create: `src/modules/identity/tier-upgrade/tier-upgrade.module.ts`
- Modify: `src/app.module.ts`（:90 `OnboardingModule` 旁注册 `TierUpgradeModule`）
- Test: `src/modules/identity/tier-upgrade/tier-upgrade-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 常量、Task 3 level、`SumsubClient.changeLevel(applicantId, levelName)` 与 `createSdkToken`（现成）、`generateReferenceNo`（`src/common/utils/no-generator.util.ts`）
- Produces（后续任务靠这些签名）:
  - `apply(customerId): Promise<{ upgradeNo: string }>`
  - `getOverview(customerId): Promise<{ tradingTier; limits: Array<{operationType; period; basicLimit; premiumLimit}>; application: { upgradeNo; stage } | null; canApply: boolean }>`（stage ∈ `SUBMIT_MATERIALS | UNDER_REVIEW | PENDING_DECISION | APPROVED | REJECTED`——客户面派生词，内部 status 不出客户面）
  - `getSession(customerId): Promise<{ submitted; sdkToken; template }>`
  - `submitMaterials(customerId): Promise<{ ok: true }>`
  - 客户面路由：`POST /client/me/tier-upgrade/apply`、`GET /client/me/tier-upgrade`、`GET /client/me/tier-upgrade/session`、`POST /client/me/tier-upgrade/submit`（JWT CUSTOMER，不进 rbac 目录——客户面惯例）

**本任务过清单哪几条**：写审计（APPLIED/SUBMITTED，客户 actor + requestId）｜新字段到客户面当场定白名单（stage 派生词 + upgradeNo，无内部时间戳/枚举）｜对外用业务键（upgradeNo）

- [ ] **Step 1: 失败测试先行**（照 `onboarding-workflow.service.spec.ts` 的 makeDeps/build 语法；关键用例）

```typescript
import { BadRequestException } from '@nestjs/common';
import { TierUpgradeWorkflowService } from './tier-upgrade-workflow.service';
import { ONBOARDING_LEVELS } from '../constants/onboarding-level.constant';

const customerRow = (over: Record<string, unknown> = {}) => ({
  id: 'cid', customerNo: 'CU250907001', lifecycle: 'ACTIVE', tradingTier: 'BASIC',
  riskRating: 'LOW', sumsubApplicantId: 'MOCK-CU250907001',
  sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD, ...over,
});
const appRow = (over: Record<string, unknown> = {}) => ({
  id: 'tid', upgradeNo: 'TUP250907XXXX', customerId: 'cid', status: 'IN_REVIEW',
  fromTier: 'BASIC', toTier: 'PREMIUM', materialsSubmittedAt: null, decidedAt: null, ...over,
});
const makeDeps = (row = customerRow(), app: any = null) => {
  const prisma: any = {
    customerMain: { findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row), update: jest.fn() },
    tierUpgradeApplication: {
      findFirst: jest.fn().mockResolvedValue(app),
      create: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...appRow(), ...data })),
      update: jest.fn().mockImplementation(({ data }: any) => Promise.resolve({ ...appRow(), ...data })),
    },
    transactionLimitRule: { findMany: jest.fn().mockResolvedValue([
      { operationType: 'SWAP', period: 'DAILY', tradingTier: 'BASIC', defaultLimit: '100000' },
      { operationType: 'SWAP', period: 'DAILY', tradingTier: 'PREMIUM', defaultLimit: '1000000' },
    ]) },
    approvalCase: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const customers = { updateOnboardingData: jest.fn().mockResolvedValue({}), applyTierUpgrade: jest.fn().mockResolvedValue({ fromTier: 'BASIC', toTier: 'PREMIUM' }) };
  const sumsub = { changeLevel: jest.fn().mockResolvedValue({}), createSdkToken: jest.fn().mockResolvedValue({ token: 'MOCK-SDK-TOKEN' }), createApplicant: jest.fn().mockResolvedValue({ id: 'MOCK-NEW' }) };
  const approvals = { createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR0002' }) };
  const audit = { recordByActor: jest.fn(), recordSystem: jest.fn() };
  return { prisma, customers, sumsub, approvals, audit };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new TierUpgradeWorkflowService(d.prisma as any, d.customers as any, d.sumsub as any, d.approvals as any, d.audit as any);

describe('TierUpgradeWorkflowService 申请侧', () => {
  it('apply: 建单(IN_REVIEW,BASIC→PREMIUM) + applicant 换 PREMIUM 档 + 客户 actor 留痕', async () => {
    const d = makeDeps();
    const r = await build(d).apply('cid');
    expect(r.upgradeNo).toMatch(/^TUP/);
    expect(d.sumsub.changeLevel).toHaveBeenCalledWith('MOCK-CU250907001', ONBOARDING_LEVELS.PREMIUM);
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ sumsubCurrentLevelName: ONBOARDING_LEVELS.PREMIUM }), expect.anything());
    expect(d.audit.recordByActor.mock.calls[0][0].action).toBe('TIER_UPGRADE_APPLIED');
  });
  it('守卫：非 ACTIVE / 非 BASIC / 已有在途单 → 各显式拒', async () => {
    await expect(build(makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION' }))).apply('cid')).rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(customerRow({ tradingTier: 'PREMIUM' }))).apply('cid')).rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(customerRow(), appRow())).apply('cid')).rejects.toThrow(BadRequestException);
  });
  it('getOverview: 两档限额并排 + stage 派生（IN_REVIEW 未交=SUBMIT_MATERIALS，已交=UNDER_REVIEW）', async () => {
    const o1 = await build(makeDeps(customerRow(), appRow())).getOverview('cid');
    expect(o1.application).toEqual({ upgradeNo: 'TUP250907XXXX', stage: 'SUBMIT_MATERIALS' });
    expect(o1.limits).toEqual([{ operationType: 'SWAP', period: 'DAILY', basicLimit: '100000', premiumLimit: '1000000' }]);
    expect(o1.canApply).toBe(false);
    const o2 = await build(makeDeps(customerRow(), appRow({ materialsSubmittedAt: new Date() }))).getOverview('cid');
    expect(o2.application!.stage).toBe('UNDER_REVIEW');
  });
  it('submitMaterials: 落 materialsSubmittedAt + TIER_UPGRADE_SUBMITTED；无在途单/已交 → 显式拒', async () => {
    const d = makeDeps(customerRow(), appRow());
    await build(d).submitMaterials('cid');
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ materialsSubmittedAt: expect.any(Date) }) }));
    await expect(build(makeDeps(customerRow(), null)).submitMaterials('cid')).rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(customerRow(), appRow({ materialsSubmittedAt: new Date() }))).submitMaterials('cid')).rejects.toThrow(BadRequestException);
  });
});
```

Run → FAIL（服务不存在）。

- [ ] **Step 2: 实现 workflow service**（依赖注入顺序 = 测试 build 的参数顺序：prisma, customers, sumsubClient, approvalsService, auditLogsService；`audit()` 私有方法逐字照抄 onboarding 的 :46-60 版本）

```typescript
// src/modules/identity/tier-upgrade/tier-upgrade-workflow.service.ts —— 核心方法（audit/loadCustomer 照 onboarding 版式）
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomersService } from '../customers/customers.service';
import { SumsubClient } from '../../sumsub-applicant-client/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ONBOARDING_LEVELS, ONBOARDING_LEVEL_TEMPLATES } from '../constants/onboarding-level.constant';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { assertTierUpgradeTransition, TierUpgradeStatus } from './tier-upgrade.constant';

const OPEN_STATUSES: TierUpgradeStatus[] = ['IN_REVIEW', 'MATERIALS_CLEARED'];

@Injectable()
export class TierUpgradeWorkflowService {
  constructor(/* 见上：prisma, customers, sumsubClient, approvalsService, auditLogsService */) {}

  /** 客户发起：建单 + applicant 换 PREMIUM 档（我方主动换档，spec §3）。 */
  async apply(customerId: string): Promise<{ upgradeNo: string }> {
    const c = await this.loadCustomer(customerId);
    if (c.lifecycle !== 'ACTIVE') throw new BadRequestException('Tier upgrade requires an active customer');
    if (c.tradingTier !== 'BASIC') throw new BadRequestException('Only BASIC customers can request an upgrade');
    const open = await this.prisma.tierUpgradeApplication.findFirst({
      where: { customerId, status: { in: OPEN_STATUSES } },
    });
    if (open) throw new BadRequestException(`Upgrade already in progress: ${open.upgradeNo}`);
    let applicantId = c.sumsubApplicantId;
    if (!applicantId) {
      const created = await this.sumsubClient.createApplicant({ externalUserId: c.customerNo, levelName: ONBOARDING_LEVELS.PREMIUM });
      applicantId = created.id;
    }
    await this.sumsubClient.changeLevel(applicantId!, ONBOARDING_LEVELS.PREMIUM);
    const upgradeNo = generateReferenceNo('TUP');
    await this.prisma.$transaction(async (tx) => {
      await tx.tierUpgradeApplication.create({
        data: { upgradeNo, customerId, status: 'IN_REVIEW', fromTier: 'BASIC', toTier: 'PREMIUM' },
      });
      await this.customers.updateOnboardingData(customerId,
        { sumsubApplicantId: applicantId!, sumsubCurrentLevelName: ONBOARDING_LEVELS.PREMIUM }, tx);
    });
    await this.audit(AuditActions.TIER_UPGRADE_APPLIED, c, {
      afterData: { upgradeNo, fromTier: 'BASIC', toTier: 'PREMIUM', levelName: ONBOARDING_LEVELS.PREMIUM },
    });
    return { upgradeNo };
  }

  /** Profile 档位卡片数据（客户面白名单：stage 派生词，内部 status 不出）。 */
  async getOverview(customerId: string) {
    const c = await this.loadCustomer(customerId);
    const app = await this.prisma.tierUpgradeApplication.findFirst({
      where: { customerId }, orderBy: { createdAt: 'desc' },
    });
    const rules = await this.prisma.transactionLimitRule.findMany({
      where: { gateType: 'CUMULATIVE' }, orderBy: [{ operationType: 'asc' }, { period: 'asc' }],
    });
    const byKey = new Map<string, { operationType: string; period: string; basicLimit?: string; premiumLimit?: string }>();
    for (const r of rules) {
      const k = `${r.operationType}|${r.period}`;
      const row = byKey.get(k) ?? { operationType: r.operationType, period: r.period };
      if (r.tradingTier === 'BASIC') row.basicLimit = r.defaultLimit?.toString();
      if (r.tradingTier === 'PREMIUM') row.premiumLimit = r.defaultLimit?.toString();
      byKey.set(k, row);
    }
    const stage = !app ? null
      : app.status === 'IN_REVIEW' ? (app.materialsSubmittedAt ? 'UNDER_REVIEW' : 'SUBMIT_MATERIALS')
      : app.status === 'MATERIALS_CLEARED' ? 'PENDING_DECISION'
      : app.status; // APPROVED | REJECTED
    return {
      tradingTier: c.tradingTier,
      limits: [...byKey.values()],
      application: app && stage ? { upgradeNo: app.upgradeNo, stage } : null,
      canApply: c.tradingTier === 'BASIC' && (!app || !OPEN_STATUSES.includes(app.status as TierUpgradeStatus)),
    };
  }

  /** 补料会话（照 onboarding getSession 投影语法）。 */
  async getSession(customerId: string) {
    const c = await this.loadCustomer(customerId);
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId, status: 'IN_REVIEW' } });
    if (!app || app.materialsSubmittedAt) return { submitted: true, sdkToken: null, template: null };
    const { token } = await this.sumsubClient.createSdkToken({ externalUserId: c.customerNo, levelName: ONBOARDING_LEVELS.PREMIUM });
    return { submitted: false, sdkToken: token, template: ONBOARDING_LEVEL_TEMPLATES[ONBOARDING_LEVELS.PREMIUM] };
  }

  /** 材料提交（零存储：只落 materialsSubmittedAt，spec §3）。 */
  async submitMaterials(customerId: string): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId, status: 'IN_REVIEW' } });
    if (!app || app.materialsSubmittedAt) throw new BadRequestException('No upgrade session awaiting submission');
    await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { materialsSubmittedAt: new Date() } });
    await this.audit(AuditActions.TIER_UPGRADE_SUBMITTED, c, { afterData: { upgradeNo: app.upgradeNo } });
    return { ok: true };
  }
}
```

- [ ] **Step 3: 客户面 controller + module + app 注册**（controller 逐字照 `onboarding.client.controller.ts` 版式：`@Controller('client/me/tier-upgrade')`，四路由 `apply/''(GET)/session/submit` 映射四方法，`ensureCustomer` 同款；module 照 `onboarding.module.ts`：imports `PrismaModule, AuditLogsModule, CustomersModule, SumsubApplicantClientModule, ApprovalsModule`，providers `[TierUpgradeWorkflowService]`，exports 同；`app.module.ts` :90 旁加 `TierUpgradeModule`）

- [ ] **Step 4: 跑绿 + 闸 + Commit**

Run: `npx jest src/modules/identity/tier-upgrade --silent`；`npx tsc --noEmit -p tsconfig.json`
`git commit -m "feat(档位升级): 申请单 workflow 四方法+客户面端点族"`

---

### Task 7: 裁决路径 —— applyReviewVerdict + 分发器开路 + ⚡ 端点【评审升 opus】

**Files:**
- Modify: `src/modules/identity/tier-upgrade/tier-upgrade-workflow.service.ts`（加 `applyReviewVerdict`）
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`（:195 `applicantReviewed` 分支改两线分发）
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts`（imports 加 `TierUpgradeModule`）
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`（加 `tier-upgrade-review-result` 端点）
- Test: `src/modules/identity/tier-upgrade/tier-upgrade-workflow.service.spec.ts`（追加）

**Interfaces:**
- Produces: `applyReviewVerdict({ applicantId, reviewAnswer, reviewRejectType }): Promise<{ customerNo; upgradeNo; to } | null>` —— **null = 该客户无在审升级单，调用方落回入驻线**（两线隔离的全部机制，spec §4）
- ⚡ 路由：`POST /admin/sumsub/simulate/tier-upgrade-review-result` `{customerNo, reviewAnswer, reviewRejectType?}`

**本任务过清单哪几条**：新状态沿边走（GREEN/RED-FINAL 经 assertTransition）｜写审计（VERDICT_APPLIED，recordSystem + fromStatus/toStatus）｜交易三域改动确认——分发器只加升档分支，KYT 级联 / 材料请求 / 入驻三路原样（spec §12 有实证理由）

- [ ] **Step 1: 失败测试先行**（追加 describe）

```typescript
describe('TierUpgradeWorkflowService 裁决路径（webhook 侧）', () => {
  const submitted = () => appRow({ materialsSubmittedAt: new Date() });

  it('GREEN → IN_REVIEW 沿边 MATERIALS_CLEARED + VERDICT_APPLIED 带 fromStatus/toStatus', async () => {
    const d = makeDeps(customerRow(), submitted());
    const r = await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(r).toMatchObject({ customerNo: 'CU250907001', to: 'MATERIALS_CLEARED' });
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'MATERIALS_CLEARED' }) }));
    const audited = d.audit.recordSystem.mock.calls.find(([p]: any[]) => p.action === 'TIER_UPGRADE_VERDICT_APPLIED');
    expect(audited[0].afterData).toMatchObject({ fromStatus: 'IN_REVIEW', toStatus: 'MATERIALS_CLEARED', reviewAnswer: 'GREEN' });
  });

  it('RED+RETRY → 不迁移，清 materialsSubmittedAt 重开会话（spec §4 承接波二先例）', async () => {
    const d = makeDeps(customerRow(), submitted());
    const r = await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'RED', reviewRejectType: 'RETRY' });
    expect(r!.to).toBe('IN_REVIEW');
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ materialsSubmittedAt: null }) }));
  });

  it('RED+FINAL → REJECTED + decidedAt；客户 lifecycle 全程不碰', async () => {
    const d = makeDeps(customerRow(), submitted());
    const r = await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'RED', reviewRejectType: 'FINAL' });
    expect(r!.to).toBe('REJECTED');
    expect(d.prisma.customerMain.update).not.toHaveBeenCalled();
  });

  it('无在审升级单 → 返回 null（落回入驻线，两线隔离）', async () => {
    const d = makeDeps(customerRow(), null);
    expect(await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' })).toBeNull();
  });

  it('未提交先裁决 → 显式拒（非法迁移不静默）', async () => {
    const d = makeDeps(customerRow(), appRow()); // materialsSubmittedAt: null
    await expect(build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' }))
      .rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 实现 `applyReviewVerdict`**

```typescript
  /** applicantReviewed 落轴（摄取分发器直调）。返回 null = 无在审升级单，调用方落回入驻线。 */
  async applyReviewVerdict(input: { applicantId: string; reviewAnswer: 'GREEN' | 'RED'; reviewRejectType: 'RETRY' | 'FINAL' }) {
    const c = await this.prisma.customerMain.findFirst({ where: { sumsubApplicantId: input.applicantId } });
    if (!c) return null;
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId: c.id, status: 'IN_REVIEW' } });
    if (!app) return null;
    if (!app.materialsSubmittedAt) {
      throw new BadRequestException(`Verdict rejected: upgrade ${app.upgradeNo} is not awaiting review`);
    }
    let to: TierUpgradeStatus = 'IN_REVIEW';
    if (input.reviewAnswer === 'GREEN') {
      to = 'MATERIALS_CLEARED';
      assertTierUpgradeTransition('IN_REVIEW', to);
      await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { status: to } });
    } else if (input.reviewRejectType === 'FINAL') {
      to = 'REJECTED';
      assertTierUpgradeTransition('IN_REVIEW', to);
      await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { status: to, decidedAt: new Date() } });
    } else {
      // RED-RETRY：不是边——停留 IN_REVIEW，清 submittedAt 重开会话（spec §4）
      await this.prisma.tierUpgradeApplication.update({ where: { id: app.id }, data: { materialsSubmittedAt: null } });
    }
    await this.audit(AuditActions.TIER_UPGRADE_VERDICT_APPLIED, c, {
      afterData: { upgradeNo: app.upgradeNo, reviewAnswer: input.reviewAnswer, reviewRejectType: input.reviewRejectType, fromStatus: 'IN_REVIEW', toStatus: to },
    }, false);
    return { customerNo: c.customerNo, upgradeNo: app.upgradeNo, to };
  }
```

- [ ] **Step 3: 分发器开路**（`sumsub-ingestion.service.ts` :195 分支改为先问升档、null 落回入驻；注入 `TierUpgradeWorkflowService`，module imports 加 `TierUpgradeModule`——方向 ingestion → identity，与 OnboardingModule 同向无环）

```typescript
      else if (depositWebhookType === 'applicantReviewed' && applicantId) {
        // 波三：先问升档线（按「在审升级申请单存在性」认领，spec §4）；null 落回入驻线。
        const upgraded = await this.tierUpgradeWorkflow.applyReviewVerdict({
          applicantId,
          reviewAnswer: reviewResult?.reviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
          reviewRejectType: reviewResult?.reviewRejectType === 'FINAL' ? 'FINAL' : 'RETRY',
        });
        if (upgraded) {
          result = { routedTo: 'tier-upgrade', ...upgraded };
          dispatchedContext = 'TIER_UPGRADE';
        } else {
          const verdict = await this.onboardingWorkflow.applyReviewVerdict({
            applicantId,
            reviewAnswer: reviewResult?.reviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
            reviewRejectType: reviewResult?.reviewRejectType === 'FINAL' ? 'FINAL' : 'RETRY',
          });
          if (verdict) { result = { routedTo: 'onboarding', ...verdict }; dispatchedContext = 'ONBOARDING'; }
        }
      }
```

- [ ] **Step 4: ⚡ 端点**（`admin-sumsub-simulation.controller.ts`，逐字照 `onboarding-review-result` :73-102 语法，差异仅两处：路由名 `tier-upgrade-review-result`、多一道「该客户须有 IN_REVIEW 升级单」的守卫——注入 prisma 已有，`findFirst({ where: { customer: { customerNo: body.customerNo }, status: 'IN_REVIEW' } })` 查 `tierUpgradeApplication`，查无抛 `NotFoundException('No tier-upgrade application in review for ' + body.customerNo)`；payload 仍拼 `type: 'applicantReviewed'` 走 `ingest()`）

- [ ] **Step 5: 跑绿 + 闸 + Commit**

Run: `npx jest src/modules/identity/tier-upgrade src/modules/sumsub-ingestion --silent`；`npx tsc --noEmit -p tsconfig.json`
`git commit -m "feat(档位升级): 裁决落轴+分发器两线开路+⚡端点"`

---

### Task 8: 审批路径 —— 提单 / 裁决处理器 / 档位唯一写口【评审升 opus】

**Files:**
- Modify: `src/modules/identity/customers/customers.service.ts`（加 `applyTierUpgrade`）
- Modify: `src/modules/identity/tier-upgrade/tier-upgrade-workflow.service.ts`（加 `submitAcceptance` / `getAcceptanceCase` / `getAdminView` / `onAcceptanceDecided`）
- Create: `src/modules/identity/tier-upgrade/tier-upgrade-approval.service.ts`
- Create: `src/modules/identity/tier-upgrade/tier-upgrade.admin.controller.ts`
- Modify: `src/modules/identity/tier-upgrade/tier-upgrade.module.ts`（providers/controllers 补齐）
- Test: 两个 spec（workflow 追加 + customers.service 追加）

**Interfaces:**
- Consumes: `ApprovalHandlerBase`、`ApprovalActionTypes.CUSTOMER_TIER_UPGRADE`（Task 2）
- Produces:
  - `CustomersService.applyTierUpgrade(customerId, tx?): Promise<{ fromTier: 'BASIC'; toTier: 'PREMIUM' }>`（档位唯一运行时写口——非 BASIC 显式拒）
  - `submitAcceptance(customerNo, reason, actor): Promise<{ approvalNo }>`；`getAcceptanceCase(customerNo)`；`getAdminView(customerNo): Promise<{ tradingTier; application | null; acceptanceCase | null }>`
  - `@OnEvent('workflow.customer-tier-upgrade.decided')` 处理器：APPROVED → 申请单 APPROVED + 档位翻转（同事务）；DECLINED → REJECTED
  - admin 路由：`POST /admin/customers/:customerNo/tier-upgrade-acceptance`（`CUSTOMER_TIER_UPGRADE_WRITE`）、`GET /admin/customers/:customerNo/tier-upgrade`（`CUSTOMER_READ`）

**本任务过清单哪几条**：该走 maker-checker → `ApprovalsService.createAndSubmit` 正门｜写审计（ACCEPTANCE_*，带 approvalNo + before/after tier + fromStatus/toStatus）｜对外业务键（entityRef=customerNo，快照带 upgradeNo）

- [ ] **Step 1: 失败测试先行**（workflow spec 追加）

```typescript
describe('TierUpgradeWorkflowService 审批路径', () => {
  const cleared = () => appRow({ status: 'MATERIALS_CLEARED', materialsSubmittedAt: new Date() });

  it('submitAcceptance: MATERIALS_CLEARED 才可提；开单走正门并留痕带 approvalNo', async () => {
    const d = makeDeps(customerRow(), cleared());
    const r = await build(d).submitAcceptance('CU250907001', 'limits raise', { actorType: 'ADMIN', userNo: 'OP01', roleCodes: ['OPS_OFFICER'] } as any);
    expect(r.approvalNo).toBe('APR0002');
    const snap = d.approvals.createAndSubmit.mock.calls[0][0];
    expect(snap).toMatchObject({ actionType: 'CUSTOMER_TIER_UPGRADE', entityRef: 'CU250907001' });
    expect(snap.objectSnapshot).toMatchObject({ upgradeNo: 'TUP250907XXXX', fromTier: 'BASIC', toTier: 'PREMIUM' });
    await expect(build(makeDeps(customerRow(), appRow())).submitAcceptance('CU250907001', 'x', {} as any)).rejects.toThrow(BadRequestException);
  });

  it('已有在批单 → 显式拒（不重复开单）', async () => {
    const d = makeDeps(customerRow(), cleared());
    d.prisma.approvalCase.findFirst.mockResolvedValue({ approvalNo: 'APR0001', status: 'PENDING' });
    await expect(build(d).submitAcceptance('CU250907001', 'x', {} as any)).rejects.toThrow(/APR0001/);
  });

  it('onAcceptanceDecided APPROVED → 申请单沿边 APPROVED + 档位写口同事务调用 + 留痕', async () => {
    const d = makeDeps(customerRow(), cleared());
    await build(d).onAcceptanceDecided({ decision: 'APPROVED', entityRef: 'CU250907001', approvalNo: 'APR0002', decisionByUserNo: 'SM01' } as any);
    expect(d.customers.applyTierUpgrade).toHaveBeenCalledWith('cid', expect.anything());
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', decidedAt: expect.any(Date) }) }));
    const audited = d.audit.recordByActor.mock.calls.find(([p]: any[]) => p.action === 'TIER_UPGRADE_ACCEPTANCE_DECIDED');
    expect(audited[0].afterData).toMatchObject({ decision: 'APPROVED', beforeTier: 'BASIC', afterTier: 'PREMIUM', fromStatus: 'MATERIALS_CLEARED', toStatus: 'APPROVED' });
  });

  it('DECLINED → REJECTED，档位不动、lifecycle 不碰', async () => {
    const d = makeDeps(customerRow(), cleared());
    await build(d).onAcceptanceDecided({ decision: 'DECLINED', entityRef: 'CU250907001', approvalNo: 'APR0002' } as any);
    expect(d.customers.applyTierUpgrade).not.toHaveBeenCalled();
    expect(d.prisma.tierUpgradeApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }));
  });
});
```

customers.service spec 追加（该文件若无既有 spec 则新建，mock prisma 即可）：

```typescript
it('applyTierUpgrade: BASIC→PREMIUM 唯一写口；非 BASIC 显式拒', async () => {
  // prisma.customerMain.findUnique → { tradingTier: 'BASIC' } → update 被调、返回 {fromTier,toTier}
  // prisma.customerMain.findUnique → { tradingTier: 'PREMIUM' } → BadRequestException
});
```

- [ ] **Step 2: 实现**——`CustomersService.applyTierUpgrade`：

```typescript
  /** 档位唯一运行时写口（波三 spec §6）：只许 BASIC→PREMIUM，一切经升级申请单裁决处理器。 */
  async applyTierUpgrade(customerId: string, tx?: Prisma.TransactionClient): Promise<{ fromTier: 'BASIC'; toTier: 'PREMIUM' }> {
    const db = tx ?? this.prisma;
    const c = await db.customerMain.findUnique({ where: { id: customerId }, select: { tradingTier: true } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (c.tradingTier !== 'BASIC') throw new BadRequestException(`Tier transition not allowed: ${c.tradingTier} -> PREMIUM`);
    await db.customerMain.update({ where: { id: customerId }, data: { tradingTier: 'PREMIUM' } });
    return { fromTier: 'BASIC', toTier: 'PREMIUM' };
  }
```

workflow 三方法照 onboarding 同名方法版式（:209-277）逐段搬，差异：actionType/事件名/审计码换 TIER_UPGRADE 系；提单守卫 = 存在 MATERIALS_CLEARED 单（非 lifecycle）；快照 `{ customerNo, upgradeNo: app.upgradeNo, fromTier, toTier, levelName: c.sumsubCurrentLevelName, riskRating: c.riskRating, impact }`，impact 英文：`` `Trading tier upgrade acceptance: ${customerNo} / ${app.upgradeNo} — approving raises the trading tier BASIC -> PREMIUM; cumulative limits switch to the PREMIUM schedule immediately.` ``；裁决处理器：

```typescript
  @OnEvent('workflow.customer-tier-upgrade.decided', { async: true })
  async onAcceptanceDecided(event: ApprovalDecidedEvent) {
    if (event.decision !== 'APPROVED' && event.decision !== 'DECLINED') return;
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo: event.entityRef } });
    if (!c) return;
    const app = await this.prisma.tierUpgradeApplication.findFirst({ where: { customerId: c.id, status: 'MATERIALS_CLEARED' } });
    if (!app) return;
    const to: TierUpgradeStatus = event.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    assertTierUpgradeTransition('MATERIALS_CLEARED', to);
    let tiers: { fromTier: string; toTier: string } | null = null;
    await this.prisma.$transaction(async (tx) => {
      await tx.tierUpgradeApplication.update({ where: { id: app.id }, data: { status: to, decidedAt: new Date() } });
      if (event.decision === 'APPROVED') tiers = await this.customers.applyTierUpgrade(c.id, tx);
    });
    // recordByActor（actor 取 event.decisionByUserNo，照 onboarding :269-276 版式），afterData:
    // { decision, upgradeNo: app.upgradeNo, fromStatus: 'MATERIALS_CLEARED', toStatus: to,
    //   beforeTier: tiers?.fromTier ?? 'BASIC', afterTier: tiers?.toTier ?? 'BASIC' }, approvalNo: event.approvalNo
  }
```

`getAdminView(customerNo)`：`{ tradingTier, application: app ? { upgradeNo, status, materialsSubmittedAt, createdAt, decidedAt } : null, acceptanceCase: await this.getAcceptanceCase(customerNo) }`（管理台看内部态，合法）。
handler 文件照 `onboarding-acceptance-approval.service.ts` 16 行版式（actionType/workflowType 换 `CUSTOMER_TIER_UPGRADE`）；admin controller 照 `onboarding.admin.controller.ts` 版式（POST `:customerNo/tier-upgrade-acceptance` + GET `:customerNo/tier-upgrade` → `getAdminView`）；module 补 `TierUpgradeApprovalService` provider 与 admin/client 两 controller。

- [ ] **Step 3: 跑绿 + 闸 + Commit**

Run: `npx jest src/modules/identity/tier-upgrade src/modules/identity/customers --silent`；`npx tsc --noEmit -p tsconfig.json`
`git commit -m "feat(档位升级): 高管单步审批线+tradingTier 唯一写口"`

---

### Task 9: RBAC 登记（四处同现 + 三条路由）

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（四处：union :24 段 ｜ routes :253 段 ｜ customer 域桶 :816 段 ｜ `OPS_OFFICER` 绑定 :1066 段）

**Interfaces:**
- Produces: 权限组 `CUSTOMER_TIER_UPGRADE_WRITE`（运营持）；三条路由登记齐（Task 7/8 的端点从 403 变可达）

**本任务过清单哪几条**：新增权限组四处同现｜新增 admin 端点 rbac 登记（sync+重启在收尾闸 Task 15 做，worktree 阶段静态登记即可）

- [ ] **Step 1: 四处各加**——union 加 `| 'CUSTOMER_TIER_UPGRADE_WRITE'`；routes（onboarding-acceptance 两条旁）：

```typescript
  // Tier upgrade（客户域波三·档位升级审批线，2026-09-07）
  route('POST', '/admin/customers/:customerNo/tier-upgrade-acceptance',
    'Open a senior-management acceptance approval for a trading-tier upgrade', ['CUSTOMER_TIER_UPGRADE_WRITE']),
  route('GET', '/admin/customers/:customerNo/tier-upgrade',
    'Get the latest tier-upgrade application and acceptance case for a customer', ['CUSTOMER_READ']),
```

⚡ 路由（:278 两条旁）：`route('POST', '/admin/sumsub/simulate/tier-upgrade-review-result', 'Feed a simulated Sumsub applicant-review verdict for a tier upgrade (demo only)', ['DEMO_VERDICT_WRITE']),`
customer 域桶（`customer.act_onboarding_acceptance` 旁）：

```typescript
      {
        key: 'customer.act_tier_upgrade',
        label: 'Request tier-upgrade acceptance',
        description: 'Open a senior-management approval to raise a customer trading tier (BASIC -> PREMIUM)',
        groups: ['CUSTOMER_TIER_UPGRADE_WRITE'],
      },
```

`OPS_OFFICER` 绑定行 `'CUSTOMER_ONBOARDING_ACCEPT_WRITE'` 后加 `'CUSTOMER_TIER_UPGRADE_WRITE'`。

- [ ] **Step 2: 闸 + Commit**

Run: `npx tsc --noEmit -p tsconfig.json`；`npx jest src/modules/identity/access-control --silent`（catalog 有守则测试则须绿）
`git commit -m "feat(档位升级): RBAC 组/路由/桶/绑定四处同现"`

---

### Task 10: 客户端 Profile 档位卡片 + `/onboarding/me` 补 tradingTier

**Files:**
- Modify: `src/modules/identity/customers/customer-profile.controller.ts`（select 加 `tradingTier: true`，响应展开自带）
- Modify: `client-web/src/hooks/useCustomerProfile.ts`（接口加 `tradingTier: string;`，映射加 `tradingTier: data.tradingTier || 'BASIC',`）
- Create: `client-web/src/hooks/useTierUpgrade.ts`
- Modify: `client-web/src/pages/CustomerProfile.tsx`（「Compliance lifecycle」节后插「Trading tier」节）

**Interfaces:**
- Consumes: `GET /client/me/tier-upgrade`（Task 6 overview）
- Produces: `useTierUpgrade(): { data: TierUpgradeOverview | null; loading; reload }`；Profile 档位卡片（Task 14 剧本第 3 拍的落点）

**本任务过清单哪几条**：新字段到客户面白名单（tradingTier 是客户自己的档位，可见✓）｜改前端必须截图

- [ ] **Step 1: hook**（照 `useCustomerProfile` 的 customerFetch 语法）

```typescript
// client-web/src/hooks/useTierUpgrade.ts
import { useCallback, useEffect, useState } from 'react';
import { customerFetch } from '../utils/customerFetch';

export interface TierUpgradeOverview {
  tradingTier: string;
  limits: Array<{ operationType: string; period: string; basicLimit?: string; premiumLimit?: string }>;
  application: { upgradeNo: string; stage: 'SUBMIT_MATERIALS' | 'UNDER_REVIEW' | 'PENDING_DECISION' | 'APPROVED' | 'REJECTED' } | null;
  canApply: boolean;
}

export const useTierUpgrade = () => {
  const [data, setData] = useState<TierUpgradeOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await customerFetch(`${import.meta.env.VITE_API_URL}/client/me/tier-upgrade`);
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, reload };
};
```

- [ ] **Step 2: Profile 档位节**（复用页内 `Row`/`SectionTitle`；仅 ACTIVE 客户渲染整节；`stage` → 文案映射：SUBMIT_MATERIALS `Upgrade started — submit your documents`（附 `Continue` 按钮 → `/tier-upgrade/verify`）/ UNDER_REVIEW `Documents under review` / PENDING_DECISION `Awaiting final decision` / REJECTED `Upgrade declined — you may apply again`）

```tsx
      {lifecycle === 'ACTIVE' && (
        <section>
          <SectionTitle>Trading tier</SectionTitle>
          <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
            <Row label="Current tier" value={tier?.tradingTier ?? profile.tradingTier} mono accent />
          </div>
          {tier && tier.limits.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full max-w-xl text-left font-mono text-[11px] text-fx-dune">
                <thead><tr className="text-fx-dust uppercase tracking-[0.12em] text-[9px]">
                  <th className="py-1 pr-4">Cumulative limit (AED)</th><th className="py-1 pr-4">Basic</th><th className="py-1">Premium</th>
                </tr></thead>
                <tbody>
                  {tier.limits.map((l) => (
                    <tr key={`${l.operationType}-${l.period}`} className="border-t border-fx-rule">
                      <td className="py-1.5 pr-4">{l.operationType} · {l.period}</td>
                      <td className="py-1.5 pr-4 tabular-nums">{l.basicLimit ?? '—'}</td>
                      <td className="py-1.5 tabular-nums text-fx-brass">{l.premiumLimit ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-5">
            {tier?.canApply ? (
              <button onClick={() => void applyForUpgrade()} className="fx-btn-primary">
                Upgrade to Premium →
              </button>
            ) : tier?.application ? (
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-brass">
                {STAGE_COPY[tier.application.stage]}
              </span>
            ) : null}
            {tier?.application?.stage === 'SUBMIT_MATERIALS' && (
              <button onClick={() => navigate('/tier-upgrade/verify')} className="ml-3 fx-btn-ghost">Continue</button>
            )}
          </div>
        </section>
      )}
```

`applyForUpgrade`：`POST /client/me/tier-upgrade/apply`，`r.ok` 必查，成功后 `navigate('/tier-upgrade/verify')`。

- [ ] **Step 3: 闸 + 截图 + Commit**

Run: `npx tsc --noEmit -p tsconfig.json`；`cd client-web && npx tsc -b --noEmit && cd ..`；起 self 栈 preview 截 Profile 页（BASIC 客户见对照表 + 按钮）
`git commit -m "feat(档位升级): Profile 档位卡片+两档限额对照"`

---

### Task 11: 客户端补料会话页 + 路由

**Files:**
- Create: `client-web/src/pages/TierUpgradeVerification.tsx`
- Modify: `client-web/src/App.tsx`（`/onboarding/verify` 行旁加 `<Route path="/tier-upgrade/verify" element={<AuthGuard><TierUpgradeVerification /></AuthGuard>} />`）

**本任务过清单哪几条**：改前端必须截图｜材料零存储（假上传框不做真文件处理）

- [ ] **Step 1: 页面**——整体照 `OnboardingVerification.tsx` 搬（同款 load/session/doSubmit/submitError/加载态先拦/`r.ok` 必查/真接 snsWebSdk 分支），删去 CDD 表单分支与 withdraw 区，端点换 `/client/me/tier-upgrade/session` 与 `/client/me/tier-upgrade/submit`，标题 `Tier upgrade — additional documents`，副题 `Proof of address and source of funds · reviewed by compliance.`，模板分支只认 `template?.kind === 'TIER_UPGRADE_UPLOAD'`（渲染 `uploadSlots` 虚线占位框 + `Submit documents` 按钮，与 EDD_UPLOAD 分支同构）；提交成功屏文案 `We have received your documents and they are being reviewed.`，另加 `Back to profile` ghost 按钮 → `/profile`。

- [ ] **Step 2: 闸 + 截图 + Commit**

Run: `cd client-web && npx tsc -b --noEmit && cd ..`；preview 截会话页（两个上传槽 + Submit）
`git commit -m "feat(档位升级): 客户端补料会话页"`

---

### Task 12: 限额错误页内提示条（Swap / Withdraw）

**Files:**
- Modify: `client-web/src/utils/limitErrorText.ts`（加 `resolveSubmitErrorInfo` + `TIER_UPGRADE_HINT_CODES`；原 `resolveSubmitErrorMessage` 迁完两处调用后删除——本改动制造的孤儿自己清）
- Modify: `client-web/src/pages/Swap.tsx`（:515 else 块）
- Modify: `client-web/src/pages/Withdraw.tsx`（:400 else 块）

**本任务过清单哪几条**：改前端必须截图｜交易三域对照——充值域不改有实证理由（L1 HOLD 无拒单错误路径，spec §6）

- [ ] **Step 1: resolver 扩展**

```typescript
/** 超限两码给升级 CTA（spec §8）；BELOW_MIN/UNPRICEABLE 提示条无 CTA；非限额码走 alert 原路。 */
export const TIER_UPGRADE_HINT_CODES = new Set([
  'TRANSACTION_LIMIT_ABOVE_MAX',
  'TRANSACTION_LIMIT_CUMULATIVE_EXCEEDED',
]);

export const resolveSubmitErrorInfo = async (
  response: Response,
  fallback = 'Request failed.',
): Promise<{ message: string; limitCode: string | null }> => {
  let payload: Record<string, unknown> = {};
  try {
    const json = await response.clone().json();
    if (json && typeof json === 'object') payload = json as Record<string, unknown>;
  } catch { /* body not JSON */ }
  const code = typeof payload.code === 'string' ? payload.code : undefined;
  if (code && LIMIT_ERROR_TEXT[code]) return { message: LIMIT_ERROR_TEXT[code](payload), limitCode: code };
  const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message : fallback;
  return { message, limitCode: null };
};
```

- [ ] **Step 2: 两页改造**（各加 state `const [limitBanner, setLimitBanner] = useState<{ message: string; upgradeHint: boolean } | null>(null);`，提交成功路径清空；else 块改为）

```tsx
        const { message, limitCode } = await resolveSubmitErrorInfo(response, 'Swap failed');
        if (limitCode) {
          setLimitBanner({ message, upgradeHint: TIER_UPGRADE_HINT_CODES.has(limitCode) });
        } else {
          alert(message);
          if (message.includes('Quote')) { setShowConfirm(false); setFirmQuote(null); setQuoteExpiresIn(0); }
        }
```

（Withdraw 同构，alert 分支保留其 `clearQuoteState()` 逻辑。）提交按钮上方渲染：

```tsx
      {limitBanner && (
        <div className="mb-4 rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 text-sm text-fx-rust">
          {limitBanner.message}
          {limitBanner.upgradeHint && (
            <span className="ml-2">
              Need more headroom?{' '}
              <a href="/profile" className="underline text-fx-brass">Upgrade your tier</a>
            </span>
          )}
        </div>
      )}
```

- [ ] **Step 3: 闸 + 截图 + Commit**

Run: `cd client-web && npx tsc -b --noEmit && cd ..`；`npm run test:client`（client-web 动了）；preview 截 Swap 超限提示条（含 Upgrade 链接）
`git commit -m "feat(档位升级): 限额拒单页内提示条+升级 CTA"`

---

### Task 13: 管理台客户详情「升级申请」区块

**Files:**
- Modify: `admin-web/src/pages/CustomerDetail.tsx`（照入驻区块三段式：state/fetch :223-330 段、⚡ handlers :416-460 段、渲染 :600-640 段旁各加升档版）

**本任务过清单哪几条**：新增业务动作前端要有入口（⚡ 三钮 + 提单钮）｜改前端必须截图｜对外业务键（区块显示 upgradeNo，无 UUID）

- [ ] **Step 1: 数据接线**——state `const [tierUpgrade, setTierUpgrade] = useState<{ tradingTier: string; application: { upgradeNo: string; status: string; materialsSubmittedAt: string | null; createdAt: string; decidedAt: string | null } | null; acceptanceCase: { approvalNo: string; status: string } | null } | null>(null);`；随详情加载 `adminFetch(.../admin/customers/${customerNo}/tier-upgrade)`（照 :326 acceptanceCase 语法，动作后 reload）。

- [ ] **Step 2: 动作**——⚡ 三钮 handler 照 :427 的 `simulateOnboardingReviewResult` 语法打 `POST /admin/sumsub/simulate/tier-upgrade-review-result`（GREEN / RED+RETRY / RED+FINAL）；提单钮照 :397 语法打 `POST /admin/customers/${customerNo}/tier-upgrade-acceptance`（body `{ reason }`，用页面既有 prompt/reason 交互惯例）。

- [ ] **Step 3: 渲染**——入驻准入区块旁加 `Tier upgrade` 区块：`Current tier`（tradingTier）｜application 空则 `No upgrade application`；非空显示 `upgradeNo · status · submitted at`；关联单显示照 :630 语法（`acceptanceCase ? \`${approvalNo} (${status})\` : 'Not requested'`）。按钮可用性：⚡ 三钮仅 `simulation 模式开 && application.status === 'IN_REVIEW' && materialsSubmittedAt 非空`；提单钮仅 `application.status === 'MATERIALS_CLEARED' && 无在批 acceptanceCase`（权限不足时 adminFetch 403 由页面既有惯例处理）。全部英文文案。

- [ ] **Step 4: 闸 + 截图 + Commit**

Run: `cd admin-web && npx tsc -b --noEmit && cd ..`；preview 截客户详情升级区块（IN_REVIEW 态 ⚡ 钮亮）
`git commit -m "feat(档位升级): 管理台升级申请区块+⚡三钮+提单钮"`

---

### Task 14: 剧本与演示数据

**Files:**
- Modify: `doc-final/demo/script.md`（第二幕 :49 段落加第 5 拍「档位升级」）
- Modify: `doc-final/demo/data.md`（剧本参数 + 现场客户命名沿波二约定）

**本任务过清单哪几条**：改页面/种子同步 demo 两文档（本波种子零改动，只加剧本）

- [ ] **Step 1: 参数核定**（写死进 data.md 前先实测）：起 self 栈，`GET /swap-transactions/rate` 询 30000 USDT→AED 的 AED 名义值——须 > 100000（BASIC · SWAP · DAILY 种子值）且 < 1000000（PREMIUM 档），不满足则调量（充值量 = 卖出量 + 10000 缓冲）。预置参数：**充值 40000 USDT，卖出 30000 USDT**。
- [ ] **Step 2: 第二幕第 5 拍**（承接第 2 拍的现场 CDD 客户）：① 客户端 Simulate Deposit 40000 USDT → 管理台资金单 ⚡ 三段推进至 CLEARED → 余额到账（讲：TB 钩子已在 ACTIVE 时静默开户，波二「演不了入金」的钳制解除）② Swap 卖 30000 USDT → 页内提示条 `Daily limit exceeded` + `Upgrade your tier` ③ 点链接进 Profile → 两档对照表讲一句 → Upgrade to Premium → 传 PoA/SoF → Submit ④ 管理台 ⚡ GREEN → 运营提单 → 高管批 → 详情区块 tier 翻 PREMIUM ⑤ 回客户端重试同额 Swap → 成交；旁支一句：⚡ RED-RETRY 时客户端会话重新开放提交。同步波二遗留句：报价拍「现场自见新客价待 TB 开户解锁」改回现场自见。
- [ ] **Step 3: Commit** `git commit -m "docs(档位升级): 第二幕第5拍剧本+参数"`

---

### Task 15: 收尾闸 + 走查 + 文档收口（主会话/终审前置）

**Files:**
- Modify: `doc-final/modules/v2-customer-compliance.md`（§1 升档之路 / §2 申请单状态机表 + 注明不碰 lifecycle / §3 决策表加行 / §4 剧本同步 / §5 技术节点 / §6 销波三条）
- Modify: `doc-final/modules/overview.md`（Customer Management 4→5 桶、运营职务 +1 项、§5 技术节点补 TB 钩子与 tier-upgrade 模块一句）
- Modify: `doc-final/BACKLOG.md`（:97 Tier Upgrade 销账；:155 ⭐ 销账并附翻绿证据）
- Modify: `doc-final/CHANGELOG.md`（合并时一行）

**本任务过清单哪几条**：每轮收尾三件套｜两条永不豁免（截图 + verify:coa）｜多波收尾——波三是最后一波：**总纲与本 spec/plan 合并后一起归档，无下一波承接**

- [ ] **Step 1: 走查全弧线**（self 栈，`node scripts/demo-shot.js --cookie shared_simulation_mode=true ...` 复用波二 flags）：现场注册 → CDD 直通 ACTIVE → 充值 40000 USDT 全套推进 → 撞限提示条 → 申请/补料 → ⚡GREEN → 提单 → 高管批 → 重试成交；另拍 RED-RETRY 重交、高管否单后重新申请。逐拍截图落盘。
- [ ] **Step 2: TB 钩子直接断言**（:155 复现命令翻绿）：`sqlite3 <self栈db> "SELECT count(*) FROM tb_account_registry WHERE ownerUuid='<现场客户id>'"` = ACTIVE 资产币种数×2；充值单 `SUCCESS`、资金单 `CLEARED`；`grep "TB Step 1 failed" <backend.log>` 零命中。
- [ ] **Step 3: 审计断言**（承接的 sqlite 姿势）：按 `ownerCustomerNo` 查得 `TIER_UPGRADE_APPLIED/SUBMITTED/VERDICT_APPLIED/ACCEPTANCE_SUBMITTED/ACCEPTANCE_DECIDED/CUSTOMER_LEDGER_PROVISIONED` 六码各≥1 行、`VERDICT/DECIDED` 的 afterData 带 fromStatus/toStatus。
- [ ] **Step 4: 铁律④非法喂**：未提交先 ⚡GREEN → 400；已 APPROVED 客户再 apply → 400（Only BASIC）；同客户在途重复 apply → 400。
- [ ] **Step 5: 收尾闸**：三 tsc + jest 全量相关目录（identity/tier-upgrade、identity/onboarding、identity/customers、accounting/tigerbeetle、sumsub-ingestion、audit-logging）+ `npm run test:client` → `bash scripts/on-stack.sh self demo:all`（花名册全绿，种子客户不受扰）→ `bash scripts/on-stack.sh self verify:coa` → `bash scripts/stack.sh reset self` 重铺后复跑 demo:all（闸⑧，动了 schema）→ `npx tsx scripts/verify-rbac.ts`（S5 见新 maker 行）→ verify:audit（词表 +6）。
- [ ] **Step 6: 文档收口 + Commit**；合并 main 后（业主确认时）：重启 + `npm run db:base:sync` + `bash scripts/stack.sh reset main`（新权限组 + 新 schema 双重必需）；总纲/spec/plan 移 `doc-final/archive/`；CHANGELOG 一行。

---

## Self-Review 备注（写毕自查已做）

- spec 覆盖：§1→T6/7/8、§2→T1/6、§3→T3/6、§4→T7、§5→T2/8、§6→T8（生效链零改动，无任务，T15 断言）、§7→T4/5、§8→T10/11/12、§9→T13、§10→T2/9、§11→T14、§12/§13→T15；spec「不做」清单无任务对应 ✓
- 类型一致性：`applyReviewVerdict` 返回 null 语义（T7 定义 = 分发器消费）、`applyTierUpgrade(customerId, tx?)`（T8 定义 = decided 处理器消费）、`TierUpgradeOverview.stage` 五值（T6 定义 = T10 STAGE_COPY 消费）逐一核过
- 遗留给执行者的两个现场核对点（非 TBD，是防漂移指令）：schema `@@map` 惯例照邻近 model；CustomerDetail 行号段以 grep 现场定位为准（该文件常被并行改动）
