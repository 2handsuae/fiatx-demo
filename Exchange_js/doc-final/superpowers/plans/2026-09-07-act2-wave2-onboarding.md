# 第二幕客户域 · 波二「入驻重建」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把开户流程接活：注册 → 发起认证 → CDD/EDD 模拟认证 → 裁决 → （EDD 时）高管准入批 → ACTIVE，含被拒/撤回/重申旁支、新客费率档与第二幕剧本重写。

**Architecture:** 新建 `identity/onboarding` 模块（workflow + client/admin controller + 审批 handler），生命周期迁移收口进新的主体服务 `CustomerLifecycleService`；Sumsub 侧全部复用既有摄取链（`SumsubWebhookEvent` 表 + `ingest()` + ⚡ 同款端点），客户端复用 `MaterialVerification.tsx` 双分支语法。设计稿：`doc-final/superpowers/specs/2026-09-07-act2-wave2-onboarding-design.md`（下称 spec）。

**Tech Stack:** NestJS + Prisma(SQLite) ｜ jest（构造注入 + jest.fn 哑桩的家风单测）｜ React (admin-web / client-web)

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **每条 Bash 前置 node20**：`export PATH="$(ls -d $HOME/.nvm/versions/node/v20* | tail -1)/bin:$PATH"`（本机默认 node18，engines>=20 会拒装/拒跑；管道尾不接 tail，zsh 用 `${pipestatus[1]}` 或不走管道）
  - **jest 必须在 `Exchange_js/` 根下跑**；随手闸 = `CLAUDE.md §7` ①②③ + 本任务相关 jest 目录全绿；改前端必须 preview 截图
  - 一会话 = 一 worktree（`.claude/worktrees/<名>/`）= 一分支 = 一套 self 栈（`bash scripts/stack.sh up`；12 个 demo/recon 脚本必须 `bash scripts/on-stack.sh self <script>` 包装）
  - 派 subagent 的任务 prompt 必须带 `CLAUDE.md §0–§5` 要点；执行与随码测试 → sonnet；**Task 2 / 6 / 8 评审升档 opus**（动状态机/审批门）；终审回主会话
  - 模拟基调：演示主线走模拟分支，webhook 形状 / externalUserId / level 概念照真 Sumsub 契约保真（spec 头注）
  - 经 Sumsub 采集的材料零存储（EDD 的 SoF/SoW 连名录不落）；CDD 五列例外入客户主表
  - 审计每笔带显式 `requestId`；禁做清单（`CLAUDE.md §2`）全程有效——不写幂等/去重/重试/防御校验

---

### Task 1: 客户主表 +7 列、迁移、种子回填

**Files:**
- Modify: `prisma/schema.prisma`（CustomerMain 段，约 :200-230）
- Create: `prisma/migrations/<自动生成>/migration.sql`（`prisma migrate dev` 产出）
- Modify: `prisma/seed.business.ts`（customersData 各条目，约 :529-680）

**Interfaces:**
- Produces: `CustomerMain` 新列 `dateOfBirth/nationality/idDocType/idDocNumber/residentialAddress: String?`、`onboardingSubmittedAt/onboardingFinalRejectedAt: DateTime?`（后续所有任务依赖这 7 列 + prisma client 类型）

清单行：改 schema（迁移新增，不 backfill）｜改种子（`demo/data.md` 同步统一放 Task 12，波内合并前完成）

- [ ] **Step 1: schema 加 7 列**（放在 `sumsubCurrentLevelName` 附近，同时把 :202 注释「七态九边」改「七态十边」）

```prisma
  // ── 波二入驻（2026-09-07）：CDD 基础信息——写方 = 客户端 CDD 表单，读方 = 客户详情 / 准入单快照
  dateOfBirth        String?
  nationality        String?
  idDocType          String?
  idDocNumber        String?
  residentialAddress String?
  // 当前认证会话「已提交待审」标记：提交端点落值；换档 / 重申时清空（spec §3）
  onboardingSubmittedAt DateTime?
  // Sumsub RED+FINAL 终拒标记：非空即堵死 REAPPLY（写方 = 裁决处理器）
  onboardingFinalRejectedAt DateTime?
```

- [ ] **Step 2: 生成迁移并验证空库能建**

```bash
DATABASE_URL="file:/tmp/mig_scratch.db" npx prisma migrate dev --name act2_wave2_onboarding_fields --skip-seed
rm -f /tmp/mig_scratch.db*
npx prisma generate
```
Expected: 新迁移目录生成，migrate 无报错。

- [ ] **Step 3: 种子回填**。规则：**所有 `lifecycle: 'ACTIVE'` 条目**（alice/bob/carol/frank/grace/henry(acme)/ivy/jack/kate）统一补：`onboardingApprovedAt: new Date('2026-06-15T09:00:00Z')`（出 30 天新客窗）、CDD 五列可信值、缺 `sumsubApplicantId` 的补 `mockSumsubApplicantId(email)`、`sumsubCurrentLevelName`：`eddRequired === true` 的条目（carol/frank）给 `'edd-sof-sow-level'`，其余给 `'basic-cdd-level'`。Dave（IN_VERIFICATION）补 applicantId + `'basic-cdd-level'`，五列与 submittedAt 留空（"还没交表"）；Eve（PROSPECT）全空。示例（alice 条目）：

```ts
  {
    email: 'demo_alice@example.com', /* …原有字段不动… */
    // 波二回填：入驻史（数月前开户，出新客窗）+ CDD 基础信息（数据齐全轴）
    onboardingApprovedAt: new Date('2026-06-15T09:00:00Z'),
    sumsubCurrentLevelName: 'basic-cdd-level',
    dateOfBirth: '1992-03-14', nationality: 'AE', idDocType: 'PASSPORT',
    idDocNumber: 'P-AE-1000001', residentialAddress: 'Marina Tower 12F, Dubai',
  },
```
（每人证件号 / 生日 / 地址取不同可信值即可，勿全员雷同。）

- [ ] **Step 4: 随手闸 + 重铺验证**

```bash
npx tsc --noEmit -p tsconfig.json
bash scripts/stack.sh reset self
```
Expected: tsc 0 错；reset 从零建库重铺全绿（含新迁移）。

- [ ] **Step 5: Commit** `git add prisma/ && git commit -m "feat(入驻波二): 客户主表加 CDD 五列与两枚入驻标记,种子回填入驻史"`

---

### Task 2: 状态机新边 CDD_CLEARED + 主体服务 CustomerLifecycleService（评审升档 opus）

**Files:**
- Modify: `src/modules/identity/constants/customer-lifecycle.constant.ts`
- Create: `src/modules/identity/customers/customer-lifecycle.service.ts`
- Test: `src/modules/identity/customers/customer-lifecycle.service.spec.ts`
- Modify: `src/modules/identity/customers/customers.module.ts`（providers + exports 加 CustomerLifecycleService）

**Interfaces:**
- Produces: `CustomerLifecycleService.applyAction(customerId: string, action: CustomerLifecycleAction, tx?: Prisma.TransactionClient): Promise<{ from: CustomerLifecycle; to: CustomerLifecycle }>`——唯一的 lifecycle 写入口；REAPPLY 守卫与 onboardingApprovedAt 一次性落值都在这里
- Consumes: Task 1 的新列

清单行：新状态/新结局（迁移表加边 + 非法拒；SLA 显式回答 = 不上，spec §2）｜审计不在本任务（编排层 Task 5 写）

- [ ] **Step 1: 写失败测试**

```ts
// src/modules/identity/customers/customer-lifecycle.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { CustomerLifecycleService } from './customer-lifecycle.service';

const makePrisma = (row: Record<string, unknown>) => ({
  customerMain: {
    findUnique: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue({}),
  },
});

describe('CustomerLifecycleService.applyAction', () => {
  it('CDD_CLEARED: IN_VERIFICATION → ACTIVE，首次落 onboardingApprovedAt', async () => {
    const prisma = makePrisma({ lifecycle: 'IN_VERIFICATION', onboardingApprovedAt: null, onboardingFinalRejectedAt: null });
    const svc = new CustomerLifecycleService(prisma as any);
    const r = await svc.applyAction('cid', 'CDD_CLEARED');
    expect(r).toEqual({ from: 'IN_VERIFICATION', to: 'ACTIVE' });
    const data = prisma.customerMain.update.mock.calls[0][0].data;
    expect(data.lifecycle).toBe('ACTIVE');
    expect(data.onboardingApprovedAt).toBeInstanceOf(Date);
  });

  it('已有 onboardingApprovedAt 时进 ACTIVE 不覆盖（新客窗口只开一次）', async () => {
    const seeded = new Date('2026-06-15T09:00:00Z');
    const prisma = makePrisma({ lifecycle: 'PENDING_APPROVAL', onboardingApprovedAt: seeded, onboardingFinalRejectedAt: null });
    const svc = new CustomerLifecycleService(prisma as any);
    await svc.applyAction('cid', 'FINAL_APPROVED');
    const data = prisma.customerMain.update.mock.calls[0][0].data;
    expect(data.onboardingApprovedAt).toBeUndefined();
  });

  it('REAPPLY 被 onboardingFinalRejectedAt 堵死', async () => {
    const prisma = makePrisma({ lifecycle: 'REJECTED', onboardingApprovedAt: null, onboardingFinalRejectedAt: new Date() });
    const svc = new CustomerLifecycleService(prisma as any);
    await expect(svc.applyAction('cid', 'REAPPLY')).rejects.toThrow(BadRequestException);
    expect(prisma.customerMain.update).not.toHaveBeenCalled();
  });

  it('非法边显式抛（PROSPECT + FINAL_APPROVED）', async () => {
    const prisma = makePrisma({ lifecycle: 'PROSPECT', onboardingApprovedAt: null, onboardingFinalRejectedAt: null });
    const svc = new CustomerLifecycleService(prisma as any);
    await expect(svc.applyAction('cid', 'FINAL_APPROVED')).rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败** `npx jest src/modules/identity/customers/customer-lifecycle.service.spec.ts` → FAIL（模块不存在）

- [ ] **Step 3: 实现**。常量文件：`CustomerLifecycleAction` 联合类型加 `'CDD_CLEARED'`；`IN_VERIFICATION` 段加 `CDD_CLEARED: 'ACTIVE',`；头注「9 条边」改「10 条边（波二 +CDD_CLEARED：低风险直通，Sumsub GREEN 即终点；EDD 路径仍走 VERIFICATION_PASSED → FINAL_APPROVED 两段）」。服务：

```ts
// src/modules/identity/customers/customer-lifecycle.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CustomerLifecycle,
  CustomerLifecycleAction,
  nextLifecycle,
} from '../constants/customer-lifecycle.constant';

/**
 * 生命周期主体服务——lifecycle 的唯一写入口（铁律④）。
 * 波二接驱动：所有迁移经 nextLifecycle() 沿边走；REAPPLY 守卫与
 * onboardingApprovedAt「仅 null 时落值」纪律（spec §2）都收口在这。
 */
@Injectable()
export class CustomerLifecycleService {
  constructor(private readonly prisma: PrismaService) {}

  async applyAction(
    customerId: string,
    action: CustomerLifecycleAction,
    tx?: Prisma.TransactionClient,
  ): Promise<{ from: CustomerLifecycle; to: CustomerLifecycle }> {
    const db = (tx ?? this.prisma) as PrismaService;
    const c = await db.customerMain.findUnique({
      where: { id: customerId },
      select: { lifecycle: true, onboardingApprovedAt: true, onboardingFinalRejectedAt: true },
    });
    if (!c) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (action === 'REAPPLY' && c.onboardingFinalRejectedAt) {
      throw new BadRequestException('Final rejection on record: reapply is not allowed');
    }
    const from = c.lifecycle as CustomerLifecycle;
    const to = nextLifecycle(from, action); // 非法边在这显式抛
    const data: Prisma.CustomerMainUpdateInput = { lifecycle: to };
    if (to === 'ACTIVE' && !c.onboardingApprovedAt) data.onboardingApprovedAt = new Date();
    await db.customerMain.update({ where: { id: customerId }, data });
    return { from, to };
  }
}
```

- [ ] **Step 4: 跑测试全绿** + `npx tsc --noEmit -p tsconfig.json`；customers.module.ts 的 providers/exports 各加 `CustomerLifecycleService`

- [ ] **Step 5: Commit** `git commit -m "feat(入驻波二): 状态机加 CDD_CLEARED 直通边,生命周期写入口收口进 CustomerLifecycleService"`

---

### Task 3: 审计词表 +8 码、workflowType 常量

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（三处：AuditActions 名册约 :451 材料请求名旁；`V2_CUSTOMER_AUDIT_ACTIONS` 约 :946；`AuditBusinessWorkflowTypes` 约 :91）

**Interfaces:**
- Produces: `AuditActions.ONBOARDING_*` 8 个名字 + 四属性冻结的 spec 条目；`AuditBusinessWorkflowTypes.CUSTOMER_ONBOARDING_ACCEPTANCE`

清单行：新增审计动作码（出生冻结四属性，assertActionSpec 写入时校验）

- [ ] **Step 1: AuditActions 名册加 8 名**（材料请求名后）

```ts
  // ── 入驻（波二 2026-09-07）──────────────────────────
  ONBOARDING_VERIFICATION_STARTED: 'ONBOARDING_VERIFICATION_STARTED',
  ONBOARDING_SUBMITTED: 'ONBOARDING_SUBMITTED',
  ONBOARDING_LEVEL_CHANGED: 'ONBOARDING_LEVEL_CHANGED',
  ONBOARDING_VERDICT_APPLIED: 'ONBOARDING_VERDICT_APPLIED',
  ONBOARDING_WITHDRAWN: 'ONBOARDING_WITHDRAWN',
  ONBOARDING_REAPPLIED: 'ONBOARDING_REAPPLIED',
  ONBOARDING_ACCEPTANCE_SUBMITTED: 'ONBOARDING_ACCEPTANCE_SUBMITTED',
  ONBOARDING_ACCEPTANCE_DECIDED: 'ONBOARDING_ACCEPTANCE_DECIDED',
```

- [ ] **Step 2: V2_CUSTOMER_AUDIT_ACTIONS 加四属性条目**（14 → 22；「材料请求（7）」块后）

```ts
  // ── 入驻（8，波二 2026-09-07）：客户级件无订单旅程，correlationMode 全 N ──
  ONBOARDING_VERIFICATION_STARTED: { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  ONBOARDING_SUBMITTED:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  ONBOARDING_LEVEL_CHANGED:        { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  ONBOARDING_VERDICT_APPLIED:      { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['afterData'], requiresCausation: false },
  ONBOARDING_WITHDRAWN:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  ONBOARDING_REAPPLIED:            { domain: 'CUSTOMER', correlationMode: N, requiredFields: [], requiresCausation: false },
  ONBOARDING_ACCEPTANCE_SUBMITTED: { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  ONBOARDING_ACCEPTANCE_DECIDED:   { domain: 'CUSTOMER', correlationMode: N, requiredFields: ['approvalNo'], requiresCausation: false },
```

- [ ] **Step 3: AuditBusinessWorkflowTypes 加** `CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_ONBOARDING_ACCEPTANCE',`

- [ ] **Step 4: 闸** `npx tsc --noEmit -p tsconfig.json && npx jest src/modules/audit-logging` → 全绿

- [ ] **Step 5: Commit** `git commit -m "feat(入驻波二): V2 审计词表 14→22,入驻族 8 码出生冻结四属性"`

---

### Task 4: 申请人级 level 常量 + CustomersService 显式写方法

**Files:**
- Create: `src/modules/identity/constants/onboarding-level.constant.ts`
- Modify: `src/modules/identity/customers/customers.service.ts`
- Test: `src/modules/identity/customers/customers.service.spec.ts`（追加一个 describe）

**Interfaces:**
- Produces: `ONBOARDING_LEVELS.CDD = 'basic-cdd-level'` / `ONBOARDING_LEVELS.EDD = 'edd-sof-sow-level'`；`ONBOARDING_LEVEL_TEMPLATES`（客户端模板描述符）；`CustomersService.updateOnboardingData(customerId, data, tx?)`——onboarding 实体字段的唯一显式写方法（workflow 不直写表，铁律③）

清单行：无新触发（纯常量与主体写方法；审计在编排层 Task 5）

- [ ] **Step 1: 常量文件**

```ts
// src/modules/identity/constants/onboarding-level.constant.ts
/**
 * 申请人级认证等级（Sumsub applicant level，波二只两档；与材料请求的
 * 动作级 sumsubActionLevelName 不是一回事——那个在 material-policy.ts）。
 * 命名照 Sumsub level 风格；值存 CustomerMain.sumsubCurrentLevelName。
 */
export const ONBOARDING_LEVELS = {
  CDD: 'basic-cdd-level',
  EDD: 'edd-sof-sow-level',
} as const;
export type OnboardingLevelName = (typeof ONBOARDING_LEVELS)[keyof typeof ONBOARDING_LEVELS];

export interface OnboardingLevelTemplate {
  kind: 'CDD_FORM' | 'EDD_UPLOAD';
  uploadSlots?: Array<{ code: 'SOURCE_OF_FUNDS' | 'SOURCE_OF_WEALTH'; label: string }>;
}

/** 客户端会话端点下发的模板描述符（模拟分支按它渲染我方模板，spec §6）。 */
export const ONBOARDING_LEVEL_TEMPLATES: Record<OnboardingLevelName, OnboardingLevelTemplate> = {
  [ONBOARDING_LEVELS.CDD]: { kind: 'CDD_FORM' },
  [ONBOARDING_LEVELS.EDD]: {
    kind: 'EDD_UPLOAD',
    uploadSlots: [
      { code: 'SOURCE_OF_FUNDS', label: 'Source of Funds (SoF)' },
      { code: 'SOURCE_OF_WEALTH', label: 'Source of Wealth (SoW)' },
    ],
  },
};
```

- [ ] **Step 2: CustomersService 加显式写方法**（放既有 update 方法旁）

```ts
  /** 入驻实体字段的唯一显式写方法（波二）。workflow 不直写表（铁律③）。 */
  async updateOnboardingData(
    customerId: string,
    data: Partial<{
      firstName: string; lastName: string;
      dateOfBirth: string; nationality: string; idDocType: string;
      idDocNumber: string; residentialAddress: string;
      onboardingSubmittedAt: Date | null;
      onboardingFinalRejectedAt: Date | null;
      eddRequired: boolean;
      sumsubApplicantId: string;
      sumsubCurrentLevelName: string;
    }>,
    tx?: Prisma.TransactionClient,
  ) {
    const db = (tx ?? this.prisma) as PrismaService;
    return db.customerMain.update({ where: { id: customerId }, data });
  }
```

- [ ] **Step 3: 追加单测**（customers.service.spec.ts，照该文件既有 stub 风格）：断言 update 收到 where:{id} 与透传 data；跑 `npx jest src/modules/identity/customers/customers.service.spec.ts` 全绿

- [ ] **Step 4: Commit** `git commit -m "feat(入驻波二): 申请人级 level 常量与模板描述符,customers 主体加显式入驻写方法"`

---

### Task 5: OnboardingWorkflowService 客户侧旅程 + client controller + 模块装配

**Files:**
- Create: `src/modules/identity/onboarding/onboarding.module.ts`
- Create: `src/modules/identity/onboarding/onboarding-workflow.service.ts`
- Create: `src/modules/identity/onboarding/onboarding.client.controller.ts`
- Test: `src/modules/identity/onboarding/onboarding-workflow.service.spec.ts`
- Modify: `src/app.module.ts`（imports 加 OnboardingModule）
- Modify: `src/modules/identity/auth/customer-auth.service.ts`（register 补 CUSTOMER_CREATED 审计——实测缺失）

**Interfaces:**
- Consumes: Task 2 `CustomerLifecycleService.applyAction`、Task 4 `updateOnboardingData` / `ONBOARDING_LEVELS`、`SumsubClient.createApplicant({externalUserId, levelName})` / `createSdkToken({externalUserId, levelName})`
- Produces（Task 6/8/9 依赖）:
  - `startVerification(customerId): Promise<{ levelName: string }>`
  - `getSession(customerId): Promise<{ submitted: boolean; sdkToken: string | null; levelName: string | null; template: OnboardingLevelTemplate | null; prefill: Record<string, string | null> | null }>`
  - `submit(customerId, dto): Promise<{ ok: true }>`
  - `withdrawApplication(customerId)` / `reapply(customerId)`
  - client 路由：`POST /client/me/onboarding/start|submit|withdraw|reapply`、`GET /client/me/onboarding/session`

清单行：持久状态变化写审计（显式 requestId）｜新业务动作前端入口（Task 9 交付）｜客户面白名单（session/me 投影，spec §6）

- [ ] **Step 1: 写失败测试**（家风：构造注入 + jest.fn 哑桩）

```ts
// src/modules/identity/onboarding/onboarding-workflow.service.spec.ts
import { BadRequestException } from '@nestjs/common';
import { OnboardingWorkflowService } from './onboarding-workflow.service';
import { ONBOARDING_LEVELS } from '../constants/onboarding-level.constant';

const customerRow = (over: Record<string, unknown> = {}) => ({
  id: 'cid', customerNo: 'CU250907001', lifecycle: 'PROSPECT',
  sumsubApplicantId: null, sumsubCurrentLevelName: null,
  onboardingSubmittedAt: null, onboardingFinalRejectedAt: null, eddRequired: false,
  firstName: 'Neo', lastName: 'One', dateOfBirth: null, nationality: null,
  idDocType: null, idDocNumber: null, residentialAddress: null, riskRating: 'LOW',
  ...over,
});

const makeDeps = (row: ReturnType<typeof customerRow>) => {
  const prisma = {
    customerMain: { findUnique: jest.fn().mockResolvedValue(row), findFirst: jest.fn().mockResolvedValue(row) },
    approvalCase: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn((fn: any) => fn(prisma)),
  };
  const lifecycle = { applyAction: jest.fn().mockResolvedValue({ from: row.lifecycle, to: 'IN_VERIFICATION' }) };
  const customers = { updateOnboardingData: jest.fn().mockResolvedValue({}) };
  const sumsub = {
    createApplicant: jest.fn().mockResolvedValue({ id: 'MOCK-CU250907001' }),
    createSdkToken: jest.fn().mockResolvedValue({ token: 'MOCK-SDK-TOKEN-CU250907001' }),
  };
  const approvals = { createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'APR0001' }) };
  const audit = { recordByActor: jest.fn().mockResolvedValue(undefined), recordSystem: jest.fn().mockResolvedValue(undefined) };
  return { prisma, lifecycle, customers, sumsub, approvals, audit };
};
const build = (d: ReturnType<typeof makeDeps>) =>
  new OnboardingWorkflowService(d.prisma as any, d.lifecycle as any, d.customers as any, d.sumsub as any, d.approvals as any, d.audit as any);

describe('OnboardingWorkflowService 客户侧旅程', () => {
  it('startVerification: 建 applicant、绑 id + CDD 档、驱 START_VERIFICATION、留痕', async () => {
    const d = makeDeps(customerRow());
    await build(d).startVerification('cid');
    expect(d.sumsub.createApplicant).toHaveBeenCalledWith({ externalUserId: 'CU250907001', levelName: ONBOARDING_LEVELS.CDD });
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ sumsubApplicantId: 'MOCK-CU250907001', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD }), expect.anything());
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'START_VERIFICATION', expect.anything());
    expect(d.audit.recordByActor).toHaveBeenCalled();
  });

  it('startVerification: 已有 applicant 不重建（REAPPLY 续用同一 externalUserId）', async () => {
    const d = makeDeps(customerRow({ sumsubApplicantId: 'MOCK-CU250907001' }));
    await build(d).startVerification('cid');
    expect(d.sumsub.createApplicant).not.toHaveBeenCalled();
  });

  it('getSession: IN_VERIFICATION 未提交 → sdkToken + 模板；已提交 → {submitted:true, sdkToken:null}', async () => {
    const d1 = makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD }));
    const s1 = await build(d1).getSession('cid');
    expect(s1.submitted).toBe(false);
    expect(s1.sdkToken).toBe('MOCK-SDK-TOKEN-CU250907001');
    expect(s1.template).toEqual({ kind: 'CDD_FORM' });
    const d2 = makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD, onboardingSubmittedAt: new Date() }));
    const s2 = await build(d2).getSession('cid');
    expect(s2).toMatchObject({ submitted: true, sdkToken: null });
  });

  it('submit(CDD): 五列写入 + submittedAt 落值；缺字段显式拒', async () => {
    const row = customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD });
    const d = makeDeps(row);
    const dto = { dateOfBirth: '1990-01-02', nationality: 'AE', idDocType: 'PASSPORT', idDocNumber: 'P123', residentialAddress: 'Dubai' };
    await build(d).submit('cid', dto);
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ ...dto, onboardingSubmittedAt: expect.any(Date) }), undefined);
    await expect(build(makeDeps(row)).submit('cid', { ...dto, idDocNumber: '' } as any)).rejects.toThrow(BadRequestException);
  });

  it('submit(EDD): 零存储——只落 submittedAt，不写任何材料字段', async () => {
    const d = makeDeps(customerRow({ lifecycle: 'IN_VERIFICATION', sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD }));
    await build(d).submit('cid', {});
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid', { onboardingSubmittedAt: expect.any(Date) }, undefined);
  });

  it('reapply: 清 submittedAt 并驱 REAPPLY', async () => {
    const d = makeDeps(customerRow({ lifecycle: 'REJECTED' }));
    await build(d).reapply('cid');
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'REAPPLY', expect.anything());
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid', { onboardingSubmittedAt: null }, expect.anything());
  });
});
```

- [ ] **Step 2: 跑测试确认失败** `npx jest src/modules/identity/onboarding` → FAIL

- [ ] **Step 3: 实现 workflow**（方法名 = 业务动词；审计全带显式 requestId；actor 投影照 material 客户面同款）

```ts
// src/modules/identity/onboarding/onboarding-workflow.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerLifecycleService } from '../customers/customer-lifecycle.service';
import { CustomersService } from '../customers/customers.service';
import { SumsubClient } from '../../sumsub-applicant-client/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import {
  ONBOARDING_LEVELS,
  ONBOARDING_LEVEL_TEMPLATES,
  OnboardingLevelName,
} from '../constants/onboarding-level.constant';

const CDD_FIELDS = ['dateOfBirth', 'nationality', 'idDocType', 'idDocNumber', 'residentialAddress'] as const;

/** 客户 actor 投影（与 material 客户面同款口径）。 */
const customerActor = (c: { customerNo: string }) => ({
  actorType: 'CUSTOMER' as const,
  actorNo: c.customerNo,
  actorDisplayName: c.customerNo,
  actorRolesAtTime: ['CUSTOMER'],
});

@Injectable()
export class OnboardingWorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: CustomerLifecycleService,
    private readonly customers: CustomersService,
    private readonly sumsubClient: SumsubClient,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  private async loadCustomer(customerId: string) {
    const c = await this.prisma.customerMain.findUnique({ where: { id: customerId } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  private audit(action: string, c: { customerNo: string }, extra: Record<string, unknown>, byCustomer = true) {
    const payload = {
      action,
      actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER,
      primarySubjectNo: c.customerNo,
      ownerCustomerNo: c.customerNo,
      requestId: `${action}_${c.customerNo}_${randomUUID()}`,
      sourcePlatform: byCustomer ? 'CLIENT_API' : 'SYSTEM',
      ...extra,
    } as any;
    return byCustomer
      ? this.auditLogsService.recordByActor(payload, customerActor(c))
      : this.auditLogsService.recordSystem(payload);
  }

  /** 开始认证：建（或续用）Sumsub 申请人，绑 id + CDD 档，PROSPECT → IN_VERIFICATION。 */
  async startVerification(customerId: string): Promise<{ levelName: string }> {
    const c = await this.loadCustomer(customerId);
    let applicantId = c.sumsubApplicantId;
    if (!applicantId) {
      const created = await this.sumsubClient.createApplicant({
        externalUserId: c.customerNo,
        levelName: ONBOARDING_LEVELS.CDD,
      });
      applicantId = created.id;
    }
    await this.prisma.$transaction(async (tx) => {
      await this.customers.updateOnboardingData(
        customerId,
        { sumsubApplicantId: applicantId!, sumsubCurrentLevelName: c.sumsubCurrentLevelName ?? ONBOARDING_LEVELS.CDD },
        tx,
      );
      await this.lifecycle.applyAction(customerId, 'START_VERIFICATION', tx);
    });
    await this.audit(AuditActions.ONBOARDING_VERIFICATION_STARTED, c, {
      afterData: { levelName: c.sumsubCurrentLevelName ?? ONBOARDING_LEVELS.CDD, sumsubApplicantId: applicantId },
    });
    return { levelName: c.sumsubCurrentLevelName ?? ONBOARDING_LEVELS.CDD };
  }

  /** 认证会话（照 material 的 {submitted, sdkToken} 投影语法，另带模板与预填）。 */
  async getSession(customerId: string) {
    const c = await this.loadCustomer(customerId);
    const levelName = (c.sumsubCurrentLevelName ?? null) as OnboardingLevelName | null;
    if (c.lifecycle !== 'IN_VERIFICATION' || c.onboardingSubmittedAt || !levelName) {
      return { submitted: true, sdkToken: null, levelName, template: null, prefill: null };
    }
    const { token } = await this.sumsubClient.createSdkToken({ externalUserId: c.customerNo, levelName });
    return {
      submitted: false,
      sdkToken: token,
      levelName,
      template: ONBOARDING_LEVEL_TEMPLATES[levelName],
      prefill: {
        firstName: c.firstName, lastName: c.lastName, dateOfBirth: c.dateOfBirth,
        nationality: c.nationality, idDocType: c.idDocType, idDocNumber: c.idDocNumber,
        residentialAddress: c.residentialAddress,
      },
    };
  }

  /** 提交：CDD 落五列（业务规则：资料齐了才能交），EDD 零存储；均落 submittedAt。 */
  async submit(customerId: string, dto: Record<string, string | undefined>): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    if (c.lifecycle !== 'IN_VERIFICATION' || c.onboardingSubmittedAt) {
      throw new BadRequestException('No verification session awaiting submission');
    }
    let data: Parameters<CustomersService['updateOnboardingData']>[1];
    if (c.sumsubCurrentLevelName === ONBOARDING_LEVELS.CDD) {
      for (const f of CDD_FIELDS) {
        if (!dto[f]) throw new BadRequestException(`Missing required field: ${f}`);
      }
      data = {
        dateOfBirth: dto.dateOfBirth!, nationality: dto.nationality!, idDocType: dto.idDocType!,
        idDocNumber: dto.idDocNumber!, residentialAddress: dto.residentialAddress!,
        ...(dto.firstName ? { firstName: dto.firstName } : {}),
        ...(dto.lastName ? { lastName: dto.lastName } : {}),
        onboardingSubmittedAt: new Date(),
      };
    } else {
      // EDD：SoF/SoW 真身在 Sumsub，我方连名录都不落（decisions 2026-09-07）
      data = { onboardingSubmittedAt: new Date() };
    }
    await this.customers.updateOnboardingData(customerId, data, undefined);
    await this.audit(AuditActions.ONBOARDING_SUBMITTED, c, { afterData: { levelName: c.sumsubCurrentLevelName } });
    return { ok: true };
  }

  /** 撤回申请（IN_VERIFICATION → WITHDRAWN）。 */
  async withdrawApplication(customerId: string): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    await this.lifecycle.applyAction(customerId, 'WITHDRAW_APPLICATION');
    await this.audit(AuditActions.ONBOARDING_WITHDRAWN, c, {});
    return { ok: true };
  }

  /** 重新申请（REJECTED/WITHDRAWN → IN_VERIFICATION；终拒守卫在 lifecycle 服务）。 */
  async reapply(customerId: string): Promise<{ ok: true }> {
    const c = await this.loadCustomer(customerId);
    await this.prisma.$transaction(async (tx) => {
      await this.lifecycle.applyAction(customerId, 'REAPPLY', tx);
      await this.customers.updateOnboardingData(customerId, { onboardingSubmittedAt: null }, tx);
    });
    await this.audit(AuditActions.ONBOARDING_REAPPLIED, c, {});
    return { ok: true };
  }
}
```
（Task 6 会往本文件追加裁决/换档方法，Task 8 追加准入线方法——本任务先立客户侧旅程。）

- [ ] **Step 4: client controller**（照 material 客户面惯例：JWT + type 校验；不进 rbac 目录）

```ts
// src/modules/identity/onboarding/onboarding.client.controller.ts
import { Body, Controller, ForbiddenException, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingWorkflowService } from './onboarding-workflow.service';

@ApiTags('Client - Onboarding')
@Controller('client/me/onboarding')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class OnboardingClientController {
  constructor(private readonly workflow: OnboardingWorkflowService) {}

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userId as string;
  }

  @Post('start')
  @ApiOperation({ summary: '开始认证（建/续用 Sumsub 申请人，进入认证中）' })
  start(@Req() req: any) { return this.workflow.startVerification(this.ensureCustomer(req)); }

  @Get('session')
  @ApiOperation({ summary: '取认证会话（模拟模式下 sdkToken 是 mock 值）' })
  session(@Req() req: any) { return this.workflow.getSession(this.ensureCustomer(req)); }

  @Post('submit')
  @ApiOperation({ summary: '提交认证资料（CDD 落基础信息；EDD 零存储）' })
  submit(@Req() req: any, @Body() dto: Record<string, string | undefined>) {
    return this.workflow.submit(this.ensureCustomer(req), dto ?? {});
  }

  @Post('withdraw')
  @ApiOperation({ summary: '撤回申请' })
  withdraw(@Req() req: any) { return this.workflow.withdrawApplication(this.ensureCustomer(req)); }

  @Post('reapply')
  @ApiOperation({ summary: '重新申请（终拒后被拒绝）' })
  reapply(@Req() req: any) { return this.workflow.reapply(this.ensureCustomer(req)); }
}
```

- [ ] **Step 5: 模块装配**：`onboarding.module.ts` imports `CustomersModule` + 导出 `SumsubClient` 的模块（照 material-requests 模块对它的 import 写法）+ `GovernanceModule`（ApprovalsService 提供方，照 trading 域 maker 的 import 写法）+ 审计模块；providers/exports `OnboardingWorkflowService`，controllers 挂 client controller。`app.module.ts` imports 加 `OnboardingModule`。**新代码不加 forwardRef**——方向是 onboarding → customers 单向。

- [ ] **Step 6: register 补审计**（customer-auth.service.ts register 创建成功后；AuditLogsService 经模块注入）：

```ts
    await this.auditLogsService.recordByActor({
      action: AuditActions.CUSTOMER_CREATED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: customer.customerNo,
      ownerCustomerNo: customer.customerNo,
      afterData: { email: customer.email, customerType: customer.customerType },
      requestId: `CUSTOMER_CREATED_${customer.customerNo}_${randomUUID()}`,
      sourcePlatform: 'CLIENT_API',
    } as any, { actorType: 'CUSTOMER', actorNo: customer.customerNo, actorDisplayName: customer.customerNo, actorRolesAtTime: ['CUSTOMER'] });
```

- [ ] **Step 7: 闸** `npx jest src/modules/identity/onboarding src/modules/identity/auth && npx tsc --noEmit -p tsconfig.json` → 全绿

- [ ] **Step 8: Commit** `git commit -m "feat(入驻波二): onboarding workflow 客户侧旅程五端点,注册补 CUSTOMER_CREATED 留痕"`

---

### Task 6: 裁决与换档处理 + 摄取分发器开路（评审升档 opus）

**Files:**
- Modify: `src/modules/identity/onboarding/onboarding-workflow.service.ts`（追加两方法）
- Modify: `src/modules/identity/onboarding/onboarding-workflow.service.spec.ts`（追加 describe）
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`（Clues 4&5 前插两分支，约 :185-206）
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts`（imports 加 OnboardingModule，构造器注入 OnboardingWorkflowService）

**Interfaces:**
- Produces:
  - `applyReviewVerdict(input: { applicantId: string; reviewAnswer: 'GREEN' | 'RED'; reviewRejectType: 'RETRY' | 'FINAL' }): Promise<{ customerNo: string; to: string } | null>`（null = 查无此客户，落回 unrouted warn）
  - `applyLevelChange(input: { applicantId: string }): Promise<{ customerNo: string; levelName: string } | null>`
- Consumes: Task 2 / 4 / 5 全部接口

清单行：持久状态变化写审计（recordSystem + 显式 requestId）｜交易三域不动（只加申请人级分支，既有 KYT 级联与材料请求两路原样、放行顺序不变——复用铁则 spec §4）

- [ ] **Step 1: 追加失败测试**（onboarding-workflow.service.spec.ts）

```ts
describe('OnboardingWorkflowService 裁决与换档（webhook 侧）', () => {
  const inVerif = (over: Record<string, unknown> = {}) => customerRow({
    lifecycle: 'IN_VERIFICATION', sumsubApplicantId: 'MOCK-CU250907001',
    sumsubCurrentLevelName: ONBOARDING_LEVELS.CDD, onboardingSubmittedAt: new Date(), ...over,
  });

  it('CDD GREEN → CDD_CLEARED（直通 ACTIVE）', async () => {
    const d = makeDeps(inVerif());
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'CDD_CLEARED', expect.anything());
    expect(d.audit.recordSystem).toHaveBeenCalled();
  });

  it('EDD GREEN → VERIFICATION_PASSED（进待准入）', async () => {
    const d = makeDeps(inVerif({ sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD }));
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' });
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'VERIFICATION_PASSED', expect.anything());
  });

  it('RED+FINAL → VERIFICATION_REJECTED 且落 onboardingFinalRejectedAt', async () => {
    const d = makeDeps(inVerif());
    await build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'RED', reviewRejectType: 'FINAL' });
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'VERIFICATION_REJECTED', expect.anything());
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      expect.objectContaining({ onboardingFinalRejectedAt: expect.any(Date) }), expect.anything());
  });

  it('未提交先裁决 → 显式拒（非法迁移不静默）', async () => {
    const d = makeDeps(inVerif({ onboardingSubmittedAt: null }));
    await expect(build(d).applyReviewVerdict({ applicantId: 'MOCK-CU250907001', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' }))
      .rejects.toThrow(BadRequestException);
  });

  it('查无 applicant → 返回 null（落回 unrouted warn，不抛）', async () => {
    const d = makeDeps(inVerif());
    d.prisma.customerMain.findFirst.mockResolvedValue(null);
    expect(await build(d).applyReviewVerdict({ applicantId: 'X', reviewAnswer: 'GREEN', reviewRejectType: 'RETRY' })).toBeNull();
  });

  it('applyLevelChange: eddRequired=true、档名切 EDD、清 submittedAt、状态轴不动', async () => {
    const d = makeDeps(inVerif());
    await build(d).applyLevelChange({ applicantId: 'MOCK-CU250907001' });
    expect(d.customers.updateOnboardingData).toHaveBeenCalledWith('cid',
      { eddRequired: true, sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD, onboardingSubmittedAt: null }, undefined);
    expect(d.lifecycle.applyAction).not.toHaveBeenCalled();
  });

  it('applyLevelChange: 非 CDD 档或未提交 → 显式拒', async () => {
    await expect(build(makeDeps(inVerif({ sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD }))).applyLevelChange({ applicantId: 'MOCK-CU250907001' }))
      .rejects.toThrow(BadRequestException);
    await expect(build(makeDeps(inVerif({ onboardingSubmittedAt: null }))).applyLevelChange({ applicantId: 'MOCK-CU250907001' }))
      .rejects.toThrow(BadRequestException);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**，然后实现两方法（追加到 workflow）：

```ts
  private async loadByApplicantId(applicantId: string) {
    return this.prisma.customerMain.findFirst({ where: { sumsubApplicantId: applicantId } });
  }

  /** applicantReviewed 落轴（摄取分发器直调；按当前档名分流，spec §4）。 */
  async applyReviewVerdict(input: {
    applicantId: string;
    reviewAnswer: 'GREEN' | 'RED';
    reviewRejectType: 'RETRY' | 'FINAL';
  }): Promise<{ customerNo: string; to: string } | null> {
    const c = await this.loadByApplicantId(input.applicantId);
    if (!c) return null; // 落回 unrouted warn
    if (c.lifecycle !== 'IN_VERIFICATION' || !c.onboardingSubmittedAt) {
      throw new BadRequestException(`Verdict rejected: customer ${c.customerNo} is not awaiting review`);
    }
    const action =
      input.reviewAnswer === 'GREEN'
        ? c.sumsubCurrentLevelName === ONBOARDING_LEVELS.EDD
          ? 'VERIFICATION_PASSED'
          : 'CDD_CLEARED'
        : 'VERIFICATION_REJECTED';
    let to = '';
    await this.prisma.$transaction(async (tx) => {
      const r = await this.lifecycle.applyAction(c.id, action, tx);
      to = r.to;
      if (input.reviewAnswer === 'RED' && input.reviewRejectType === 'FINAL') {
        await this.customers.updateOnboardingData(c.id, { onboardingFinalRejectedAt: new Date() }, tx);
      }
    });
    await this.audit(AuditActions.ONBOARDING_VERDICT_APPLIED, c, {
      afterData: { reviewAnswer: input.reviewAnswer, reviewRejectType: input.reviewRejectType, levelName: c.sumsubCurrentLevelName, to },
    }, false);
    return { customerNo: c.customerNo, to };
  }

  /** applicantLevelChanged：换档到 EDD——尽调深度变了，关系没变，状态轴不动。 */
  async applyLevelChange(input: { applicantId: string }): Promise<{ customerNo: string; levelName: string } | null> {
    const c = await this.loadByApplicantId(input.applicantId);
    if (!c) return null;
    if (c.lifecycle !== 'IN_VERIFICATION' || c.sumsubCurrentLevelName !== ONBOARDING_LEVELS.CDD || !c.onboardingSubmittedAt) {
      throw new BadRequestException(`Level change rejected: customer ${c.customerNo} has no reviewable CDD submission`);
    }
    await this.customers.updateOnboardingData(
      c.id,
      { eddRequired: true, sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD, onboardingSubmittedAt: null },
      undefined,
    );
    await this.audit(AuditActions.ONBOARDING_LEVEL_CHANGED, c, {
      beforeData: { levelName: ONBOARDING_LEVELS.CDD },
      afterData: { levelName: ONBOARDING_LEVELS.EDD, eddRequired: true },
    }, false);
    return { customerNo: c.customerNo, levelName: ONBOARDING_LEVELS.EDD };
  }
```

- [ ] **Step 3: 摄取分发器开路**。`sumsub-ingestion.service.ts` 构造器注入 `private readonly onboardingWorkflow: OnboardingWorkflowService`；在 `applicantActionReviewed && externalActionId` 分支**之后**、Clues 4&5 兜底块之前，插入：

```ts
      // ── 波二开路：申请人级主流程（入驻）。放行顺序不变：KYT 级联与材料请求
      // 两路在前；这里只认两个申请人级事件类型，其余照旧落 unrouted warn。──
      else if (depositWebhookType === 'applicantLevelChanged' && applicantId) {
        const changed = await this.onboardingWorkflow.applyLevelChange({ applicantId });
        if (changed) {
          result = { routedTo: 'onboarding', ...changed };
          dispatchedContext = 'ONBOARDING';
        }
      }
      else if (depositWebhookType === 'applicantReviewed' && applicantId) {
        const verdict = await this.onboardingWorkflow.applyReviewVerdict({
          applicantId,
          reviewAnswer: reviewResult?.reviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
          reviewRejectType: reviewResult?.reviewRejectType === 'FINAL' ? 'FINAL' : 'RETRY',
        });
        if (verdict) {
          result = { routedTo: 'onboarding', ...verdict };
          dispatchedContext = 'ONBOARDING';
        }
      }
```
模块 imports 加 `OnboardingModule`（方向：ingestion → onboarding，无环，不加 forwardRef）。同文件 Clues 4&5 注释里「一期重做接真 Sumsub 时在此重新开路」句改为「申请人级主流程已于波二开路（onboarding 分支）；仍未命中的事件落此警告」。

- [ ] **Step 4: 闸** `npx jest src/modules/identity/onboarding src/modules/sumsub-ingestion && npx tsc --noEmit -p tsconfig.json`（sumsub-ingestion.service.spec.ts 若因构造器新参编译不过，按其既有哑桩风格补一个 `{} as any` 位）

- [ ] **Step 5: Commit** `git commit -m "feat(入驻波二): 裁决/换档落轴,摄取分发器申请人级开路(既有两路原样)"`

---

### Task 7: ⚡ 入驻模拟两端点 + rbac 登记

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（:262 两条 simulate 路由旁）

**Interfaces:**
- Produces: `POST /admin/sumsub/simulate/onboarding-review-result` `{customerNo, reviewAnswer, reviewRejectType?}`、`POST /admin/sumsub/simulate/onboarding-level-change` `{customerNo}`（Task 10 的 ⚡ 按钮打这两个）

清单行：新增 admin 端点（rbac.catalog 登记 + 合并后 db:base:sync + 重启）｜前端入口 Task 10 交付

- [ ] **Step 1: 两方法**（与 applicant-action-result 逐字同款语法）

```ts
  @Post('onboarding-review-result')
  @ApiOperation({ summary: '模拟 applicantReviewed —— 入驻 ⚡ 三个裁决按钮打这里' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/onboarding-review-result'))
  async simulateOnboardingReviewResult(
    @Req() req: any,
    @Body() body: { customerNo: string; reviewAnswer: 'GREEN' | 'RED'; reviewRejectType?: 'RETRY' | 'FINAL' },
  ) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    if (body.reviewAnswer === 'RED' && !body.reviewRejectType) {
      // 照 applicant-action-result 判例：不许默默当 FINAL 或 RETRY
      throw new BadRequestException("RED must carry reviewRejectType 'RETRY' or 'FINAL'");
    }
    const customer = await this.prisma.customerMain.findUnique({
      where: { customerNo: body.customerNo },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      throw new NotFoundException(`Customer has no Sumsub applicant: ${body.customerNo}`);
    }
    return this.ingestionService.ingest(
      {
        type: 'applicantReviewed',
        applicantId: customer.sumsubApplicantId,
        reviewResult: { reviewAnswer: body.reviewAnswer, reviewRejectType: body.reviewRejectType },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('onboarding-level-change')
  @ApiOperation({ summary: '模拟 applicantLevelChanged —— CDD 提交后升 EDD' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/sumsub/simulate/onboarding-level-change'))
  async simulateOnboardingLevelChange(@Req() req: any, @Body() body: { customerNo: string }) {
    this.ensureAdmin(req);
    if (!body.customerNo) throw new BadRequestException('customerNo is required');
    const customer = await this.prisma.customerMain.findUnique({
      where: { customerNo: body.customerNo },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      throw new NotFoundException(`Customer has no Sumsub applicant: ${body.customerNo}`);
    }
    return this.ingestionService.ingest(
      { type: 'applicantLevelChanged', applicantId: customer.sumsubApplicantId, levelName: 'edd-sof-sow-level', createdAtMs: String(Date.now()) },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }
```

- [ ] **Step 2: rbac.catalog 登记**（既有组 `DEMO_VERDICT_WRITE`，:262 后）

```ts
  route('POST', '/admin/sumsub/simulate/onboarding-review-result', 'Feed a simulated Sumsub applicant-review verdict for onboarding (demo only)', ['DEMO_VERDICT_WRITE']),
  route('POST', '/admin/sumsub/simulate/onboarding-level-change', 'Escalate a simulated onboarding applicant to the EDD level (demo only)', ['DEMO_VERDICT_WRITE']),
```

- [ ] **Step 3: 闸** `npx tsc --noEmit -p tsconfig.json && npx jest src/modules/sumsub-ingestion`

- [ ] **Step 4: Commit** `git commit -m "feat(入驻波二): ⚡入驻模拟两端点(与三域同款payload→ingest语法),DEMO_VERDICT_WRITE 组登记"`

---

### Task 8: 准入审批线（评审升档 opus）

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（ActionTypes 约 :64；默认策略表约 :350）
- Create: `src/modules/identity/onboarding/onboarding-acceptance-approval.service.ts`
- Modify: `src/modules/identity/onboarding/onboarding-workflow.service.ts`（追加 submitAcceptance + decided 订阅）
- Create: `src/modules/identity/onboarding/onboarding.admin.controller.ts`
- Modify: `src/modules/identity/onboarding/onboarding.module.ts`（providers 加 handler，controllers 加 admin controller）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（新权限组四处）
- Modify: `scripts/verify-rbac.ts`（MAKER_GROUP_BY_POLICY 加一行，:260 区）
- Modify: `admin-web/src/pages/approvalEntityRoutes.ts`（回链一行）
- Test: `src/modules/identity/onboarding/onboarding-workflow.service.spec.ts`（追加 describe）

**Interfaces:**
- Produces: `ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE`（单步 `SENIOR_MANAGEMENT_OFFICER` 批）；`POST /admin/customers/:customerNo/onboarding-acceptance {reason}`（maker=运营）；`workflow.customer-onboarding-acceptance.decided` 订阅驱 FINAL_APPROVED / FINAL_REJECTED
- Consumes: `ApprovalsService.createAndSubmit({actionType, entityRef, traceId, objectSnapshot}, {reason, traceId}, actor)`（返回 `{approvalNo}`）；`ApprovalHandlerBase`

清单行：该走 maker-checker（ApprovalsService 正门）｜新增审批策略（MAKER_GROUP_BY_POLICY 一行）｜新增权限组（四处同现）｜新增 admin 端点（catalog + sync + 重启）｜对外识别（entityRef = customerNo）

- [ ] **Step 1: 追加失败测试**

```ts
describe('OnboardingWorkflowService 准入审批线', () => {
  const pending = () => customerRow({ lifecycle: 'PENDING_APPROVAL', eddRequired: true,
    sumsubCurrentLevelName: ONBOARDING_LEVELS.EDD, onboardingSubmittedAt: new Date() });
  const adminActor = { userId: 'u1', userNo: 'ADM001', roleCodes: ['OPS_OFFICER'] } as any;

  it('submitAcceptance: 走 ApprovalsService 正门,快照带后果原话,留痕带 approvalNo', async () => {
    const d = makeDeps(pending());
    await build(d).submitAcceptance('CU250907001', '尽调完成，提请准入', adminActor);
    const [first] = d.approvals.createAndSubmit.mock.calls[0];
    expect(first.actionType).toBe('CUSTOMER_ONBOARDING_ACCEPTANCE');
    expect(first.entityRef).toBe('CU250907001');
    expect(first.objectSnapshot.impact).toContain('CU250907001');
    expect(d.audit.recordByActor).toHaveBeenCalled();
  });

  it('submitAcceptance: 非 PENDING_APPROVAL 或已有在批单 → 显式拒', async () => {
    const d1 = makeDeps(customerRow({ lifecycle: 'ACTIVE' }));
    await expect(build(d1).submitAcceptance('CU250907001', 'x', adminActor)).rejects.toThrow(BadRequestException);
    const d2 = makeDeps(pending());
    d2.prisma.approvalCase.findFirst.mockResolvedValue({ approvalNo: 'APR0009', status: 'PENDING' });
    await expect(build(d2).submitAcceptance('CU250907001', 'x', adminActor)).rejects.toThrow(BadRequestException);
  });

  it('decided APPROVED → FINAL_APPROVED；DECLINED → FINAL_REJECTED；CANCELLED 不动轴', async () => {
    const base = { actionType: 'CUSTOMER_ONBOARDING_ACCEPTANCE', entityRef: 'CU250907001', approvalNo: 'APR0001',
      decisionByUserNo: 'ADM2501010002', decisionByRole: 'SENIOR_MANAGEMENT_OFFICER' } as any;
    const d = makeDeps(pending());
    await build(d).onAcceptanceDecided({ ...base, decision: 'APPROVED' });
    expect(d.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'FINAL_APPROVED', expect.anything());
    const d2 = makeDeps(pending());
    await build(d2).onAcceptanceDecided({ ...base, decision: 'DECLINED' });
    expect(d2.lifecycle.applyAction).toHaveBeenCalledWith('cid', 'FINAL_REJECTED', expect.anything());
    const d3 = makeDeps(pending());
    await build(d3).onAcceptanceDecided({ ...base, decision: 'CANCELLED' });
    expect(d3.lifecycle.applyAction).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 常量与策略**（approval.constants.ts）：ActionTypes 加 `CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_ONBOARDING_ACCEPTANCE',`；默认策略表加

```ts
  // ─── 高风险客户准入核准（波二 2026-09-07）：审的是「接不接这个客户关系」，
  // 不是重审尽调（MLRO 的活 100% 在 Sumsub）。maker=运营，checker=高管。───
  [ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE]: {
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```

- [ ] **Step 3: handler**（与 deposit-supplement 同款 12 行）

```ts
// src/modules/identity/onboarding/onboarding-acceptance-approval.service.ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';

@Injectable()
export class OnboardingAcceptanceApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTOMER_ONBOARDING_ACCEPTANCE;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_ONBOARDING_ACCEPTANCE;
  constructor(eventEmitter: EventEmitter2) { super(eventEmitter); }
}
```

- [ ] **Step 4: workflow 追加两方法**（`@OnEvent` 从 `@nestjs/event-emitter` import；`ApprovalDecidedEvent` 从 approval-handler.base import）

```ts
  /** 运营提请准入核准（maker）。守卫：客户在 PENDING_APPROVAL 且无在批单。 */
  async submitAcceptance(customerNo: string, reason: string, actor: { userId?: string; userNo?: string; roleCodes?: string[] }) {
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo } });
    if (!c) throw new NotFoundException(`Customer not found: ${customerNo}`);
    if (c.lifecycle !== 'PENDING_APPROVAL') {
      throw new BadRequestException(`Customer ${customerNo} is not awaiting acceptance`);
    }
    const open = await this.prisma.approvalCase.findFirst({
      where: { actionType: 'CUSTOMER_ONBOARDING_ACCEPTANCE', entityRef: customerNo, status: { in: ['DRAFT', 'PENDING'] } },
    });
    if (open) throw new BadRequestException(`Acceptance already pending approval: ${open.approvalNo}`);
    const traceId = randomUUID();
    const impact = `高风险客户准入核准：${customerNo}（风险 ${c.riskRating}，EDD 已在 Sumsub 完成，GREEN）——批准即开户 ACTIVE，限额与费率按默认档生效`;
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: 'CUSTOMER_ONBOARDING_ACCEPTANCE', entityRef: customerNo, traceId,
        objectSnapshot: {
          customerNo, riskRating: c.riskRating, eddRequired: c.eddRequired,
          levelName: c.sumsubCurrentLevelName, submittedAt: c.onboardingSubmittedAt, impact,
        },
      },
      { reason, traceId },
      actor,
    );
    await this.auditLogsService.recordByActor({
      action: AuditActions.ONBOARDING_ACCEPTANCE_SUBMITTED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: customerNo, ownerCustomerNo: customerNo,
      subjects: [
        { subjectType: AuditEntityTypes.CUSTOMER, subjectNo: customerNo, subjectRole: 'PRIMARY' },
        { subjectType: AuditEntityTypes.APPROVAL_CASE, subjectNo: approvalCase.approvalNo, subjectRole: 'INSTRUMENT' },
      ],
      reason, approvalNo: approvalCase.approvalNo,
      requestId: `ONBOARDING_ACCEPTANCE_SUBMITTED_${customerNo}_${randomUUID()}`,
      afterData: { approvalNo: approvalCase.approvalNo },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: actor.userNo ?? actor.userId ?? 'ADMIN', actorDisplayName: actor.userNo ?? actor.userId ?? 'ADMIN', actorRolesAtTime: actor.roleCodes ?? [] });
    return { approvalNo: approvalCase.approvalNo };
  }

  /** 高管裁决落轴（handler 二级事件）。APPROVED → ACTIVE；DECLINED → REJECTED（可重申）。 */
  @OnEvent('workflow.customer-onboarding-acceptance.decided', { async: true })
  async onAcceptanceDecided(event: ApprovalDecidedEvent) {
    if (event.decision !== 'APPROVED' && event.decision !== 'DECLINED') return;
    const c = await this.prisma.customerMain.findFirst({ where: { customerNo: event.entityRef } });
    if (!c) return;
    const action = event.decision === 'APPROVED' ? 'FINAL_APPROVED' : 'FINAL_REJECTED';
    const r = await this.lifecycle.applyAction(c.id, action, undefined);
    await this.auditLogsService.recordByActor({
      action: AuditActions.ONBOARDING_ACCEPTANCE_DECIDED, actionDomain: 'CUSTOMER',
      primarySubjectType: AuditEntityTypes.CUSTOMER, primarySubjectNo: c.customerNo, ownerCustomerNo: c.customerNo,
      approvalNo: event.approvalNo,
      requestId: `ONBOARDING_ACCEPTANCE_DECIDED_${c.customerNo}_${randomUUID()}`,
      afterData: { decision: event.decision, to: r.to },
      sourcePlatform: 'ADMIN_API',
    } as any, { actorType: 'ADMIN', actorNo: event.decisionByUserNo ?? 'ADMIN', actorDisplayName: event.decisionByUserNo ?? 'ADMIN', actorRolesAtTime: [event.decisionByRole ?? 'UNKNOWN'] });
  }
```

- [ ] **Step 5: admin controller**

```ts
// src/modules/identity/onboarding/onboarding.admin.controller.ts
import { Body, Controller, ForbiddenException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
import { RequirePermissions } from '../access-control/require-permissions.decorator';
import { buildPermissionCode } from '../access-control/permission-code.util';
import { OnboardingWorkflowService } from './onboarding-workflow.service';

@ApiTags('Admin - Onboarding')
@Controller('admin/customers')
@UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
@ApiBearerAuth()
export class OnboardingAdminController {
  constructor(private readonly workflow: OnboardingWorkflowService) {}

  @Post(':customerNo/onboarding-acceptance')
  @ApiOperation({ summary: '提请高风险客户准入核准（运营 maker → 高管 checker）' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/onboarding-acceptance'))
  submit(@Req() req: any, @Param('customerNo') customerNo: string, @Body() body: { reason: string }) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin token required');
    return this.workflow.submitAcceptance(customerNo, body?.reason ?? '', {
      userId: req.user.userId, userNo: req.user.userNo, roleCodes: req.user.roleCodes,
    });
  }
}
```

- [ ] **Step 6: 权限组四处 + maker 表 + 回链**
  - `rbac.catalog.ts`：①联合类型（:23 区）加 `| 'CUSTOMER_ONBOARDING_ACCEPT_WRITE'`；②route：`route('POST', '/admin/customers/:customerNo/onboarding-acceptance', 'Open a senior-management acceptance approval for a high-risk onboarding customer', ['CUSTOMER_ONBOARDING_ACCEPT_WRITE']),`（客户域路由段 :231 附近）；③ACTION_BUCKET_CATALOG 客户桶加 `{ key: 'customer.act_onboarding_acceptance', label: 'Request onboarding acceptance', description: 'Open a senior-management approval to accept a high-risk onboarding customer', groups: ['CUSTOMER_ONBOARDING_ACCEPT_WRITE'] },`；④职务 `OPS_OFFICER` 数组（:1034）加该组（确认 SENIOR_MANAGEMENT_OFFICER 数组**不**持有——自批死锁闸）
  - `scripts/verify-rbac.ts` MAKER_GROUP_BY_POLICY 加 `CUSTOMER_ONBOARDING_ACCEPTANCE: 'CUSTOMER_ONBOARDING_ACCEPT_WRITE',`
  - `approvalEntityRoutes.ts` 加 `// 客户域（entityRef = customerNo）` + `CUSTOMER_ONBOARDING_ACCEPTANCE: (r) => \`/admin/customers/${r}\`,`

- [ ] **Step 7: 闸** `npx jest src/modules/identity/onboarding && npx tsc --noEmit -p tsconfig.json && cd admin-web && npx tsc -b --noEmit && cd ..`

- [ ] **Step 8: Commit** `git commit -m "feat(入驻波二): 高风险准入审批线——运营提单/高管单步批/decided落轴,权限组四处+maker表+回链"`

---

### Task 9: 客户端——gate 页开门 + 认证页 + 投影白名单

**Files:**
- Modify: `src/modules/identity/customers/customer-profile.controller.ts`（select + 响应加 2 派生字段）
- Modify: `client-web/src/App.tsx`（:55 附近加路由）
- Modify: `client-web/src/components/AuthGuard.tsx`（CTA 接回 + `/onboarding/verify` 放行）
- Create: `client-web/src/pages/OnboardingVerification.tsx`
- Modify: `client-web/src/hooks/useCustomerProfile.ts`（类型加 `submitted?: boolean; canReapply?: boolean`——按该文件现有类型声明位置）

**Interfaces:**
- Consumes: Task 5 的五个 client 端点
- Produces: `/onboarding/me` 响应新增 `submitted: boolean`、`canReapply: boolean`（gate 页据此渲染 CTA；**不下发** onboardingSubmittedAt/FinalRejectedAt 本身——派生布尔先例，spec §6）

清单行：新字段到客户面（白名单当场定，spec §6 已定）｜改前端必须 preview 截图｜新业务动作前端入口

- [ ] **Step 1: 投影扩展**（customer-profile.controller.ts：select 加 `onboardingSubmittedAt: true, onboardingFinalRejectedAt: true,`；返回体加派生布尔、**剥掉原始两列**）

```ts
    const { onboardingSubmittedAt, onboardingFinalRejectedAt, ...profile } = customer;
    return {
      ...profile,
      lifecycle: access.lifecycle,
      disclosedBlocked: [...access.disclosedBlocked],
      disclosed: access.disclosed,
      submitted: onboardingSubmittedAt !== null,
      canReapply: onboardingFinalRejectedAt === null,
    };
```
头注补一行：「波二加 submitted / canReapply 两个派生布尔（入驻会话事实，非限制账事实）；原始时间戳不下发——内部术语不出客户面」。跑 `npx jest src/modules/identity/customers/customer-access.contract.spec.ts` 确认 tipping-off 契约仍绿。

- [ ] **Step 2: 路由**（App.tsx :55 旁）`<Route path="/onboarding/verify" element={<AuthGuard><OnboardingVerification /></AuthGuard>} />`

- [ ] **Step 3: AuthGuard 开门**。lifecycle 拦截段（:126 起）前加放行：认证页自身对 pending 客户可达：

```ts
  // 波二开门：认证页本身对未 ACTIVE 客户放行（照 readiness 门放行 /withdrawal-addresses 的先例）
  if (location.pathname === '/onboarding/verify') return <>{children}</>;
```
CTA 区（:207 站6注释处）替换为按状态接线（`copy.cta` 文案已在，全部复用；`canReapply === false` 的 blocked 分支不渲染按钮，正文换中性句 `This application cannot be reopened. Please contact support.`）：

```tsx
        <div className="mt-10 flex flex-wrap items-center gap-5">
          {(() => {
            const goVerify = () => navigate('/onboarding/verify');
            const post = (p: string) =>
              customerFetch(`${import.meta.env.VITE_API_URL}/client/me/onboarding/${p}`, { method: 'POST' });
            if (isBlocked && user?.canReapply === false) return null; // 终拒：无 CTA，中性文案
            if (isBlocked) {
              return <button className="fx-btn-primary" onClick={async () => { const r = await post('reapply'); if (r.ok) goVerify(); }}>{copy.cta}</button>;
            }
            if (isFinalPending) return null; // 等高管终审：陈述屏，无动作
            if (lifecycle === 'IN_VERIFICATION') {
              return <button className="fx-btn-primary" onClick={goVerify}>{copy.cta}</button>;
            }
            return <button className="fx-btn-primary" onClick={async () => { const r = await post('start'); if (r.ok) goVerify(); }}>{copy.cta}</button>;
          })()}
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
            Est. 3 min · VARA regulated
          </span>
        </div>
```
（`customerFetch` / `user` 取自该文件既有 import 与 profile 钩子；终拒正文替换在 `isBlocked` copy 分支里按 `user?.canReapply === false` 出中性句。）

- [ ] **Step 4: OnboardingVerification.tsx**——整体照 `MaterialVerification.tsx` 语法（双分支/加载态先拦/提交必查 r.ok），模板区按 session.template 分流：

```tsx
// client-web/src/pages/OnboardingVerification.tsx —— 结构骨架（样式类与状态机照 MaterialVerification.tsx 逐段搬）
// 差异点只有模板区：
//   template.kind === 'CDD_FORM'  → 五字段表单（prefill 预填，姓名可改）+ Submit
//   template.kind === 'EDD_UPLOAD' → 两个虚线占位上传框（SoF/SoW 标签，与补料页假上传同构，不做真文件处理）+ Submit
//   submitted === true            → "We have received your information and it is being reviewed."
//   页脚：lifecycle IN_VERIFICATION 时给 "Withdraw application"（POST withdraw 成功后 navigate('/overview')）
// 会话:  GET  /client/me/onboarding/session
// 提交:  POST /client/me/onboarding/submit   （CDD body = 七字段: 五必填 + firstName/lastName）
// 撤回:  POST /client/me/onboarding/withdraw
// 真接分支: snsWebSdk.init(token, refresh).build().launch('#sumsub-container')——refresh 重打 session 端点取新 token
```
CDD 表单五输入（date/text）+ 姓名两输入；提交后 `setSubmitted(true)`；错误横幅同款。**页面代码完整实现，不留 TODO**——执行者以 MaterialVerification.tsx 为唯一样板逐段对照写。

- [ ] **Step 5: 闸 + 截图**：`cd client-web && npx tsc -b --noEmit && cd ..`；worktree 起栈（`bash scripts/stack.sh up`），preview 打开 client 端口，截图三景：gate 页 PROSPECT（CTA 可见）/ CDD 表单 / 提交后等待屏。

- [ ] **Step 6: Commit** `git commit -m "feat(入驻波二): client 认证页与 gate 页开门,/onboarding/me 加 submitted/canReapply 派生布尔"`

---

### Task 10: 管理台——CustomerDetail 入驻卡 + ⚡区 + 提请准入按钮

**Files:**
- Modify: `admin-web/src/pages/CustomerDetail.tsx`

**Interfaces:**
- Consumes: Task 7 两个 ⚡ 端点、Task 8 提单端点；admin 客户详情接口已透传新列（无 select 过滤，后端零改）

清单行：新业务动作前端入口（⚡ 四按钮 + 提请按钮）｜前端截图｜对外识别（全程 customerNo）

- [ ] **Step 1: 基本信息区加 CDD 五字段展示**（Date of Birth / Nationality / ID Type / ID Number / Residential Address；空值显 `—`，沿用该页既有字段行组件写法）

- [ ] **Step 2: 入驻状态卡**（放 lifecycle 徽章附近）：`Verification level`（sumsubCurrentLevelName）/ `EDD required`（eddRequired）/ `Submitted at`（onboardingSubmittedAt）；`onboardingFinalRejectedAt` 非空 → 徽章「尽调终拒 · 不可重新申请」（复用波一终拒文字位样式）；`lifecycle === 'PENDING_APPROVAL'` → 按钮「提请准入核准」：

```tsx
  const submitAcceptance = async () => {
    const reason = window.prompt('Reason for acceptance request');
    if (!reason) return;
    const r = await adminFetch(`/admin/customers/${customer.customerNo}/onboarding-acceptance`, {
      method: 'POST', body: JSON.stringify({ reason }),
    });
    if (r.ok) { const { approvalNo } = await r.json(); setAcceptanceNo(approvalNo); refresh(); }
    else setActionError(await readErrorMessage(r));
  };
```
（`adminFetch`/错误读取/`refresh` 用该页既有工具与惯例；提交成功后展示 `Acceptance approval: {approvalNo}` 文本行。）

- [ ] **Step 3: ⚡ 入驻模拟区**（`useSimulationMode` 门控，`admin-web/src/utils/simulationMode.ts` 已有；样式照三域交易详情 ⚡ 面板）。四按钮与可用性：

```tsx
  const canVerdict = customer.lifecycle === 'IN_VERIFICATION' && customer.onboardingSubmittedAt != null;
  const canEscalate = canVerdict && customer.sumsubCurrentLevelName === 'basic-cdd-level';
  // ⚡ Approve (GREEN) | ⚡ Reject – retry (RED/RETRY) | ⚡ Reject – final (RED/FINAL) → POST onboarding-review-result
  // ⚡ Escalate to EDD → POST onboarding-level-change
```
每按钮 POST 后 `refresh()`；失败展示后端 message（非法迁移的显式拒绝就是演示口径）。

- [ ] **Step 4: 闸 + 截图**：`cd admin-web && npx tsc -b --noEmit && cd ..`；preview 截图两景：Dave 详情（IN_VERIFICATION，⚡区可见、裁决钮禁用态——他未提交）/ 任一 ACTIVE 客户详情（CDD 五字段有值）。

- [ ] **Step 5: Commit** `git commit -m "feat(入驻波二): 客户详情入驻卡+CDD字段+提请准入按钮+⚡入驻模拟区"`

---

### Task 11: 新客费率档种子

**Files:**
- Modify: `prisma/seed.business.ts`（VIP 档块 :307-330 之后，照抄其结构）

**Interfaces:**
- Produces: swapFeeLevel `NEWCUST-USDT-AED`（requiredTags `['NEW_CUSTOMER']`，各档费率 STD 与 VIP 之间）

清单行：改种子（data.md 同步在 Task 12）

- [ ] **Step 1: 加档**（与 VIP 块逐字同构，仅数值与命名不同；tiers：rateMarkupBps 80/50/30/15、flatFee '25'/'16'/'11'/'7'——每档严格便宜于 STD 的 100/60/40/20 与 30/20/15/10，贵于 VIP；cheapest-wins 下新客命中它、VIP 客户仍拿 VIP 档）：levelCode `NEWCUST-USDT-AED`、name `New Customer USDT → AED`、`requiredTagsJson: JSON.stringify(['NEW_CUSTOMER'])`、`isDefault: false` + 同款 `writeSeedAudit`（`SWAP_FEE_LEVEL_SEEDED`）。

- [ ] **Step 2: 验证**：`bash scripts/stack.sh reset self` 全绿；sqlite 抽查：

```bash
sqlite3 $(ls /tmp/exchange_js_wt_*/dev.db | head -1) "select levelCode, requiredTagsJson from swap_fee_levels where levelCode like 'NEWCUST%';"
```
Expected: 一行，`["NEW_CUSTOMER"]`。种子客户全部回填 2026-06-15 开户（Task 1），出 30 天窗——`bash scripts/on-stack.sh self demo:all` 花名册终态与站2对照不受扰（此步先跑通，完整收尾闸在 Task 14）。

- [ ] **Step 3: Commit** `git commit -m "feat(入驻波二): 新客受众费率档 NEWCUST-USDT-AED(照 VIP 先例),cheapest-wins 介于 STD/VIP 之间"`

---

### Task 12: 剧本第二幕重写 + demo/data.md 同步

**Files:**
- Modify: `doc-final/demo/script.md`（第二幕整段替换，:49-54）
- Modify: `doc-final/demo/data.md`（客户矩阵注记 + 费率档条目 + 现场注册约定）

清单行：改页面/种子同步 demo 文档（data.md 生成区不手改）

- [ ] **Step 1: script.md 第二幕替换为四段结构**（spec §10；文风与幕次格式照第一/三幕）：
  1. 静态矩阵（原①）；2. **现场开户 · CDD 直通**：客户端注册新客户（邮箱 `demo_live1_<日期>@example.com`）→ 登录 → gate 页「Start verification」→ CDD 表单提交 → 管理台该客户详情 ⚡ Approve → 刷新客户端：ACTIVE 进主界面 → 管理台标签区 NEW_CUSTOMER 亮 → 客户端登记首个法币账户（即时生效）→ Swap 报价：费率 flat 25（新客档；对照 Alice 同额报价 flat 30 STD）；旁支：第二位现场客户 ⚡ Reject–retry → gate 页「Retry verification」重申续走；3. **现场开户 · EDD 高风险**：第三位现场客户 CDD 提交 → ⚡ Escalate to EDD → 客户端切 SoF/SoW 上传位提交 → ⚡ Approve → 切 `ops_officer@` 客户详情「提请准入核准」→ 切 `sm@` 审批中心批（读后果原话）→ 客户端刷新 ACTIVE；讲词一句「MLRO 的审在 Sumsub 完成，我方批的是接不接这个客户」；4. 便签联动（原②③④保留 + 材料请求站）。期望行同步改写（"开户全程可现场走"取代"状态是种子摆拍"）。
- [ ] **Step 2: data.md**：种子回填口径行（ACTIVE 客户开户日 2026-06-15、CDD 五列已铺、Carol/Frank=EDD 档）；费率档表加 NEWCUST 行（与 VIP 行同格式）；「现场注册客户即用即弃、重演换新邮箱、不依赖 reset」约定一句。
- [ ] **Step 3: Commit** `git commit -m "docs(入驻波二): 第二幕剧本重写为现场开户双路径,demo 数据口径同步"`

---

### Task 13: 文档收口（v2 篇 / BACKLOG / CHANGELOG）

**Files:**
- Modify: `doc-final/modules/v2-customer-compliance.md`
- Modify: `doc-final/BACKLOG.md`
- Modify: `doc-final/CHANGELOG.md`

清单行：每轮收尾（文档分层收口 + CHANGELOG 一行 + BACKLOG 销账）

- [ ] **Step 1: v2 篇逐节**（对照 spec §11）：§0 定位「本波未接」句改「已接（波二 2026-09-07）」并去总纲改指本 spec 归档位；§1 开户之路段落改活 + 加一句材料零存储统一规矩；§2 状态机行改「…ACTIVE；低风险直通边 CDD_CLEARED（IN_VERIFICATION → ACTIVE）…」（8→9 动作、9→10 边）；§3 决策表加行「提请准入核准 ｜ 运营 ｜ 高管（单步） ｜ 审的是接不接客户关系，不是重审尽调」；§4 演示脚本与 script.md 第二幕四段同步；§5 技术节点：nextLifecycle 行改「驱动已接（CustomerLifecycleService 唯一写入口）」、加 onboarding workflow / client 五端点 / ⚡ 两端点 / 审计 22 码 / CUSTOMER_ONBOARDING_ACCEPTANCE 各一行、Sumsub 翻译层行加「申请人级两事件路由 onboarding」；§6 缺口销「一期重做」条（改「入驻已演；档位升级见总纲波三」），加「高管拒收滞留 REJECTED 的清退承接归销户缺口」
- [ ] **Step 2: BACKLOG**：:99 一期重做条销**入驻部分**（留档位升级指波三）；销户缺口链附一句高管拒收承接
- [ ] **Step 3: CHANGELOG** 一行：`2026-09-0X 波二入驻重建合并——开户全程可现场走（CDD 直通/EDD 准入门/被拒重申/新客费率档），审计 V2 22 码`
- [ ] **Step 4: Commit** `git commit -m "docs(入驻波二): v2 篇口径接活,BACKLOG :99 入驻部分销账,CHANGELOG 一行"`

---

### Task 14: 收尾闸 + 走查五景 + 承接波三

**Files:**
- Modify: `doc-final/superpowers/specs/2026-09-06-act2-wave3-tier-upgrade-skeleton.md`（承接记录写进开头）

清单行：两条永不豁免之①（前端截图）｜多波承接（写波三骨架，不展开波三 spec）｜收尾闸 `CLAUDE.md §7`

- [ ] **Step 1: 全量闸**（worktree 内）

```bash
npx tsc --noEmit -p tsconfig.json
cd admin-web && npx tsc -b --noEmit && cd ..
cd client-web && npx tsc -b --noEmit && cd ..
npx jest src/modules/identity src/modules/sumsub-ingestion src/modules/audit-logging
bash scripts/on-stack.sh self verify:rbac   # +3 路由 +1 权限组 +1 maker 行；⚠️ 它会写测试数据，必须排在 reset 之前（判例 2026-09-03）
bash scripts/stack.sh reset self            # 闸⑧：动了 schema/seed；顺带清掉 verify:rbac 的落数
bash scripts/on-stack.sh self demo:all      # 闸⑥：终态全绿（判据 doc-final/demo/baseline.md）
bash scripts/on-stack.sh self verify:audit  # 词表 +8 后全部不变量仍绿（只读断言，排 demo:all 之后取真实写入面）
```
Expected: 全绿。任何红先按 systematic-debugging 归因，不改判据凑绿。

- [ ] **Step 2: 走查五景**（spec §12；`demo-shot.js` 截图落盘，支持 `--select`/`--type` 有序交互）：①CDD 直通全程（注册→表单→⚡GREEN→ACTIVE→标签亮→登记法币账户→报价 flat 25 vs Alice flat 30——**报价数字断言写进截图说明**）②EDD 全程（换档→上传→⚡GREEN→运营提单→sm@ 批→ACTIVE）③RED-RETRY 重申走通（同一 applicant 不重建：⚡ 前后 sumsubApplicantId 不变）④RED-FINAL：客户端中性文案无 CTA + 管理台终拒徽章 + 重申端点显式 400 ⑤撤回→重申。每景对铁律①：`sqlite3` 按 customerNo 查 audit_log_events 出对应码。

- [ ] **Step 3: 承接记录写入波三骨架开头**（实际偏差 / 执行中新事实 / 波三前提有无变化——只写承接，不展开波三 spec）

- [ ] **Step 4: Commit** `git commit -m "chore(入驻波二): 收尾闸全绿,走查五景截图,承接记录写入波三骨架"`

- [ ] **Step 5: 合并后必做**（主树）：`git merge --ff-only`（或按 finishing-a-development-branch 流程）→ 重启后端 + `npm run db:base:sync`（新 rbac 路由/权限组）→ `bash scripts/stack.sh reset main`（动了 schema/seed；先 `rm -f /tmp/exchange_js_main/dev.db` 判例）→ 主栈抽查 CDD 直通一遍 → 清 worktree 与分支 → spec 归档 `doc-final/archive/specs/`、本 plan 归档 `doc-final/archive/plans/`

---

## 本 plan 过交付清单哪几条（收尾对账用）

触发：持久状态写审计+requestId（T5/6/8）｜新审计码四属性（T3）｜新状态+边+SLA 回答（T2）｜maker-checker 正门（T8）｜新审批策略进 maker 表（T8）｜新权限组四处（T8）｜新增 admin 端点登记+sync+重启（T7/8/14）｜新业务动作前端入口（T9/10）｜新字段到客户面白名单（T9）｜对外识别业务键（全程 customerNo）｜改 schema 迁移（T1）｜改种子/页面同步 demo 文档（T12）｜改前端截图（T9/10/14）｜多波承接（T14）｜每轮收尾三件套（T13）。
**不触发**：动钱/金额（无资金移动，verify:coa 不跑）｜退役动作（无）｜交易三域改动（分发器只加申请人级分支）｜新事件登记（handler 二级事件 `workflow.customer-onboarding-acceptance.decided` 由 ApprovalHandlerBase 机制自动派生，非新增域事件；若执行中确需新域事件，先登记 domain-events.constants.ts）。
