# 客户生命周期轴 + 限制账 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `CustomerMain` 的三根状态轴（入驻 / 行政 / 合规）收敛成一根 `lifecycle` 轴，把所有「摁住客户」的情形统一成一张 `customer_restrictions` 限制账，并给管理台补上可用的执行与解除入口。

**Architecture:** 一根轴只回答「这个人跟我们是什么关系」（七态九边，`OFFBOARDED` 为终态）；一张限制账回答「他现在被什么事卡着」（一行 = 一次摁住，`scope`/`cause`/`visibility`/`releasePolicy` 四要素，后两者由 `cause` 查注册表推出、不接受人工输入）。所有读侧收口到唯一求值器 `CustomerAccessService.resolve()`，它同时产出服务端执法用的 `blocked` 与客户面专用的 `disclosedBlocked` —— 两者分离是 tipping-off 的结构性保证。写侧遵循「贴不审批、撕才审批」，复刻已验证的 `DEPOSIT_UNFREEZE` / `WITHDRAW_UNFREEZE` maker-checker 范式。

**Tech Stack:** NestJS 单体 + Prisma/SQLite + TigerBeetle 账本；jest（单测 `*.spec.ts` 与源码同目录 / e2e `test/*.e2e-spec.ts`）；admin-web 与 client-web 均为 React 19 + Vite 7 + Tailwind 3，零状态库、原生 fetch。

**设计稿：** `doc-final/superpowers/specs/2026-08-15-customer-lifecycle-restrictions-design.md`（本计划是它的落地拆解，遇到分歧以设计稿为准）

---

## Global Constraints

以下是全项目约束，**每个 Task 的要求都隐含包含本节**，任务体内不再重复：

### 数据与迁移

- **demo 数据约定（业主定，不可违反）**：不考虑存量数据。schema / 账本 / 状态机改动直接按目标终态做，**禁止** backfill、迁移兼容层、双写过渡、向后兼容列。改完数据结构 = reset 重铺（`bash scripts/stack.sh reset-main` 或 `npm run main:reset:biz`），不修旧数据。
- 唯一例外：`prisma/migrations` 仍按正常流程新增，保证空库能从零建起；迁移内容不必兼容已有行。
- SQLite 删带外键的列须走表重建（`create-_new` → copy → drop-old → RENAME，顺序不可颠倒）。Prisma 生成迁移后**必须人工核对 SQL**。

### 后端五条铁律

1. 有持久状态、operator 可见的操作 → **必须** DI 注入 `AuditLogsService` 写审计（**禁止** `new`）。人/API 触发用 `recordByActor()`，job/orchestrator 用 `recordSystem()`。
2. 多表状态变更 → **必须** `prisma.$transaction`。
3. 有稳定业务键（`customerNo`、`restrictionNo`）→ **禁止**以 `id` 作主查询合同，**禁止**让操作员只能用 UUID 查一级主体。
4. **禁止**绕过 onboarding / compliance 状态门语义。
5. Workflow **禁止**直接写任何 domain 实体的 Prisma 表 → 必须通过该 domain 的 service 方法。

### 分层

`Controller`（只解析/校验/返回，禁审计禁业务判断）→ `Workflow service`（编排 + 生成并穿透 traceId + 写全部业务审计）→ `Domain service`（守单实体不变量，写方法接受可选 `tx: Prisma.TransactionClient`）→ `PrismaService`。

内部域事件三条硬规：只有 domain service 与 ingestion/adapter 层可 `emit`；只有 workflow service 可 `@OnEvent` 订阅；**事件必须先登记进 `src/common/events/domain-events.constants.ts` 才准用**（今天只登记了 4 个）。

### 审计字段

- `workflowType` 恒必填，不得由 action 名懒推。
- `action` 必须匹配 `/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/`。
- **三个已删字段绝不准再传**：`workflowId` / `workflowNo`（2026-04-08 删）、`module`（2026-04-29 删）、`triggerType`（2026-04-30 删）。服务间 `auditContext` 只准携 `{ workflowType, traceId }`。
- `traceId` 用 `node:crypto` 的 `randomUUID()` 裸 UUID v4，一个业务序列一个，子动作只继承绝不重新生成。

### RBAC（新 admin 端点必读）

新增 admin 端点必须三步齐全，缺一则前端恒 403：
1. 在 `src/modules/identity/access-control/rbac.catalog.ts` 用 `route()` 登记，并把新权限组加进 `PermissionGroup` 联合类型；
2. `npm run db:base:sync`；
3. **重启后端** —— SUPER_ADMIN 权限走内存 `RBAC_PERMISSION_DEFINITIONS`，只 seed 不重启等于白做。

⚠️ 另：`AdminPermissionGuard` 对非 ADMIN token 是 **fail-open**（已知平台缺陷，不在本轮修）。所以**每个新 admin 端点必须显式调 `assertAdmin(req)`**，样板见 `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts:52`。

### admin 前端硬约束

- HTTP 只走 `adminFetch`，host 只取 `import.meta.env.VITE_API_URL`；`AdminSessionError` 静默 return，`AdminPermissionError` 翻成以 `Permission denied.` 开头的句子。
- 颜色**只用** `adm-*` token（panel/card/bg/border/hover/t1-t3/amber/blue/green/red），**禁止**硬编码 hex 与裸 Tailwind 色。
- 按钮**只用** `adminButtonClass()` 的 13 个变体；状态一律 `<AdminBadge>`；空值一律 `—`（禁 N/A / null / 空白）。
- 列表 `PAGE_SIZE = 20`，分页参数 `skip`/`take`（非 page/pageSize），响应体固定 `{ total, skip, take, items }`。
- 详情页两栏：主区 `flex-1 overflow-y-auto divide-y divide-adm-border`，侧栏精确 `w-[272px] min-w-[272px] border-l bg-adm-panel px-4 py-1`。侧栏块序 ACTIONS → IDENTITY SUMMARY → LIFECYCLE。动作按钮只能在侧栏 Actions 组。
- **禁止展示原始 UUID**，实体间关联用业务键。

### client 前端硬约束

- 只走 `customerFetch`；`admin` 与 `client` 的 session helper 严禁互用。
- 所有流程显式处理 loading / empty / error / success / disabled 状态，**禁止静默失败**。
- **tipping-off 铁律**：客户面永远拿不到 `blocked` 与 `openCount`，只能拿 `disclosedBlocked` 与 `disclosed`。任何"要不要告诉客户"的判断都在后端做完一次，前端**不许**再加条件逻辑 —— 判断散到两处，失败模式就是把制裁调查告诉当事人。

### 验证命令

| 用途 | 命令 |
|---|---|
| 单文件单测 | `npx jest <相对路径>` |
| 全量单测 | `npm test` |
| e2e | `npm run test:e2e` |
| 类型闸 | `npx tsc --noEmit` |
| 端到端演示闸 | `bash scripts/on-stack.sh main demo:all`（期望 `═══ demo:all DONE ✅ ═══`）|
| 账本不变量闸 | `bash scripts/on-stack.sh main verify:coa`（期望 `ALL INVARIANTS PASS`）|
| client 前端单测 | `npm test --prefix client-web` |

⚠️ `recon:demo` / `demo:*` / `verify:coa` 等脚本在 package.json 里硬编码了旧 DB 路径，**必须**经 `bash scripts/on-stack.sh main <script>` 包装，直接 `npm run` 会指向不存在的库。

### 工作树

本计划**不得在 `main` 分支上执行**。开工前按 CLAUDE.md「并行工作 · Worktree 规范」建 `.claude/worktrees/<名字>/` 工作树并 `bash scripts/stack.sh up`（自动分端口、自愈 `.env`、切 node20、重建后端）。每个 commit 只 `git add` 具名文件，**禁止** `git add -A` / `git add .`（仓库有并发 session 在 main 上活动的历史事故）。

---

### Task 1: Prisma schema 改造 + lifecycle 常量与迁移表

把 `CustomerMain` 的三根状态轴（`onboardingStatus` / `adminStatus` / `complianceStatus`）+ `restrictions` JSON 列一次性换成**一根 `lifecycle` 轴 + 一张 `customer_restrictions` 限制账表**，并落地七态八动作迁移表常量。本任务**只动模型层与常量层**，不改任何读侧/写入方代码 —— 任务结束时 `npx tsc --noEmit` 必然非零（40 个已知消费方仍在读被删的列），由 Task 2 / 5 / 6 / 7 逐步收敛，这是预期结果，不是失败。

**Files:**

- Create: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/identity/constants/customer-lifecycle.constant.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/identity/constants/customer-lifecycle.constant.spec.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/prisma/migrations/20260816090000_customer_lifecycle_restrictions/migration.sql`（由 `prisma migrate diff` 生成后人工核对，见 Step 12）
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/prisma/schema.prisma`
  - 206–224 行：三段状态轴注释块 + `restrictions` 列 → 单轴 `lifecycle`
  - 297–301 行：Relations 末尾加 `restrictionRows`，删 `@@index([adminStatus])` / `@@index([complianceStatus])`
  - 319 行（`model CorporateProfile {` 之前）：插入 `model CustomerRestriction`

**Interfaces:**

Consumes:
- `BadRequestException` — `@nestjs/common`
- `prisma/schema.prisma:182-306` 现有 `model CustomerMain`（真实全貌已读，见上述行号）
- `prisma/migrations/20260701150000_drop_payins_payouts/migration.sql:1-21` 的表重建经验注释（`create-_new → copy → drop-old → RENAME` 顺序为何不可颠倒）

Produces:
```ts
// src/modules/identity/constants/customer-lifecycle.constant.ts
export type CustomerLifecycle =
  | 'PROSPECT' | 'IN_VERIFICATION' | 'PENDING_APPROVAL' | 'ACTIVE'
  | 'REJECTED' | 'WITHDRAWN' | 'OFFBOARDED';
export type CustomerLifecycleAction =
  | 'START_VERIFICATION' | 'VERIFICATION_PASSED' | 'VERIFICATION_REJECTED'
  | 'WITHDRAW_APPLICATION' | 'FINAL_APPROVED' | 'FINAL_REJECTED' | 'REAPPLY' | 'OFFBOARD';
export const CUSTOMER_LIFECYCLE_TRANSITIONS: Record<CustomerLifecycle, Partial<Record<CustomerLifecycleAction, CustomerLifecycle>>>;
export const CUSTOMER_LIFECYCLE_TERMINAL: ReadonlySet<CustomerLifecycle>;
export function nextLifecycle(from: CustomerLifecycle, action: CustomerLifecycleAction): CustomerLifecycle;
```
```prisma
// prisma/schema.prisma
model CustomerMain { lifecycle String @default("PROSPECT") ... restrictionRows CustomerRestriction[] }
model CustomerRestriction { ... @@unique([restrictionNo, scope]) @@map("customer_restrictions") }
```
Prisma Client 侧新增 delegate：`prisma.customerRestriction`（Task 3 的 `CustomerRestrictionsService` 直接消费）。

---

- [ ] **Step 1: 确认工作树与分支，禁止在 main 上开工**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git rev-parse --abbrev-ref HEAD
git status --short -- prisma src | head
```
期望：分支名**不是** `main`（本轮工作树分支，如 `feat/customer-lifecycle-restrictions`）；`prisma/`、`src/` 下无未提交改动。若在 `main` 上，停下按 CLAUDE.md「并行工作 · Worktree 规范」开工作树后再继续。

---

- [ ] **Step 2: 建目录，写失败的 lifecycle 守则性单测**

`src/modules/identity/` 下当前**没有** `constants/` 目录，先建：

```bash
mkdir -p /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/src/modules/identity/constants
```

写入 `src/modules/identity/constants/customer-lifecycle.constant.spec.ts`：

```ts
import { BadRequestException } from '@nestjs/common';
import {
  CUSTOMER_LIFECYCLE_TERMINAL,
  CUSTOMER_LIFECYCLE_TRANSITIONS,
  CustomerLifecycle,
  CustomerLifecycleAction,
  nextLifecycle,
} from './customer-lifecycle.constant';

// 守则性测试（复刻充值域 28 边做法，见 deposit-transactions.service.spec.ts:1219-1300）：
// 设计稿 2026-08-15-customer-lifecycle-restrictions-design.md §3.1 定稿的 9 条边逐条列出
// ——多一条、少一条、边指向变了，这里都会红。再用穷举（7 状态 × 8 动作 = 56 组合）反向
// 断言：凡不在这 9 条边名单里的组合一律抛 BadRequestException，即没有偷偷长出第 10 条边。
const ALL_LIFECYCLES: CustomerLifecycle[] = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

const ALL_ACTIONS: CustomerLifecycleAction[] = [
  'START_VERIFICATION',
  'VERIFICATION_PASSED',
  'VERIFICATION_REJECTED',
  'WITHDRAW_APPLICATION',
  'FINAL_APPROVED',
  'FINAL_REJECTED',
  'REAPPLY',
  'OFFBOARD',
];

const EXPECTED_EDGES: Array<{
  from: CustomerLifecycle;
  action: CustomerLifecycleAction;
  to: CustomerLifecycle;
}> = [
  { from: 'PROSPECT', action: 'START_VERIFICATION', to: 'IN_VERIFICATION' },

  { from: 'IN_VERIFICATION', action: 'VERIFICATION_PASSED', to: 'PENDING_APPROVAL' },
  { from: 'IN_VERIFICATION', action: 'VERIFICATION_REJECTED', to: 'REJECTED' },
  { from: 'IN_VERIFICATION', action: 'WITHDRAW_APPLICATION', to: 'WITHDRAWN' },

  { from: 'PENDING_APPROVAL', action: 'FINAL_APPROVED', to: 'ACTIVE' },
  { from: 'PENDING_APPROVAL', action: 'FINAL_REJECTED', to: 'REJECTED' },

  { from: 'ACTIVE', action: 'OFFBOARD', to: 'OFFBOARDED' },

  { from: 'REJECTED', action: 'REAPPLY', to: 'IN_VERIFICATION' },
  { from: 'WITHDRAWN', action: 'REAPPLY', to: 'IN_VERIFICATION' },
];

describe('customer lifecycle transition table (9-edge guard)', () => {
  it('table lists exactly 9 edges', () => {
    expect(EXPECTED_EDGES).toHaveLength(9);
    const declared = ALL_LIFECYCLES.reduce(
      (sum, from) => sum + Object.keys(CUSTOMER_LIFECYCLE_TRANSITIONS[from]).length,
      0,
    );
    expect(declared).toBe(9);
  });

  it.each(
    EXPECTED_EDGES.map((e) => [`${e.from} --${e.action}--> ${e.to}`, e] as const),
  )('%s', (_label, edge) => {
    expect(nextLifecycle(edge.from, edge.action)).toBe(edge.to);
  });

  it('every (lifecycle, action) pair NOT in the 9-edge list throws (no undocumented edge exists)', () => {
    const edgeKeys = new Set(EXPECTED_EDGES.map((e) => `${e.from}::${e.action}`));
    for (const from of ALL_LIFECYCLES) {
      for (const action of ALL_ACTIONS) {
        if (edgeKeys.has(`${from}::${action}`)) continue;
        expect(() => nextLifecycle(from, action)).toThrow(BadRequestException);
        expect(() => nextLifecycle(from, action)).toThrow(
          `Invalid lifecycle action ${action} from ${from}`,
        );
      }
    }
  });

  it('transition table keys cover exactly the 7 lifecycles', () => {
    expect(Object.keys(CUSTOMER_LIFECYCLE_TRANSITIONS).sort()).toEqual(
      [...ALL_LIFECYCLES].sort(),
    );
  });

  // INV-1（设计稿 §3.1）：ACTIVE 的唯一出口是 OFFBOARDED。
  // 今天三处写 ACTIVE→REJECTED / ACTIVE→WITHDRAWN 的代码（sumsub-ingestion:194、
  // tier-upgrade-case:175、material-refresh:151）本轮改为贴限制便签，不动 lifecycle。
  it('INV-1: ACTIVE has no edge to REJECTED or WITHDRAWN', () => {
    expect(CUSTOMER_LIFECYCLE_TRANSITIONS.ACTIVE).toEqual({ OFFBOARD: 'OFFBOARDED' });
    const targets = Object.values(CUSTOMER_LIFECYCLE_TRANSITIONS.ACTIVE);
    expect(targets).not.toContain('REJECTED');
    expect(targets).not.toContain('WITHDRAWN');
  });

  it('OFFBOARDED is terminal: zero out-edges', () => {
    expect(CUSTOMER_LIFECYCLE_TRANSITIONS.OFFBOARDED).toEqual({});
    for (const action of ALL_ACTIONS) {
      expect(() => nextLifecycle('OFFBOARDED', action)).toThrow(BadRequestException);
    }
  });

  it('CUSTOMER_LIFECYCLE_TERMINAL is exactly {OFFBOARDED}', () => {
    expect([...CUSTOMER_LIFECYCLE_TERMINAL]).toEqual(['OFFBOARDED']);
  });

  it('REJECTED / WITHDRAWN are NOT terminal — REAPPLY reopens verification', () => {
    expect(CUSTOMER_LIFECYCLE_TERMINAL.has('REJECTED')).toBe(false);
    expect(CUSTOMER_LIFECYCLE_TERMINAL.has('WITHDRAWN')).toBe(false);
    expect(nextLifecycle('REJECTED', 'REAPPLY')).toBe('IN_VERIFICATION');
    expect(nextLifecycle('WITHDRAWN', 'REAPPLY')).toBe('IN_VERIFICATION');
  });
});
```

---

- [ ] **Step 3: 跑测试，确认它因「实现不存在」而失败**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/constants/customer-lifecycle.constant.spec.ts
```
期望输出包含：
```
● Test suite failed to run
  Cannot find module './customer-lifecycle.constant' from 'src/modules/identity/constants/customer-lifecycle.constant.spec.ts'
Tests:       0 total
```
（`Test suite failed to run` 是这一步的正确结果；若它意外通过，说明文件已存在，停下核对。）

---

- [ ] **Step 4: 写最小实现 —— 七态 + 八动作 + 9 边迁移表**

写入 `src/modules/identity/constants/customer-lifecycle.constant.ts`：

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * 客户关系生命周期 —— 唯一一根状态轴。
 *
 * 取代 CustomerMain 上原来的三根轴：onboardingStatus（准入旅程）、adminStatus（行政）、
 * complianceStatus（合规冻结）。前两根是同一件事的两种写法，第三根是「摁住客户」——
 * 摁住不是状态，是限制账（customer_restrictions）上的一行，不占轴上的位置。
 *
 * 设计稿：doc-final/superpowers/specs/2026-08-15-customer-lifecycle-restrictions-design.md §3.1
 */
export type CustomerLifecycle =
  | 'PROSPECT' // 已注册，未开始认证
  | 'IN_VERIFICATION' // 认证进行中
  | 'PENDING_APPROVAL' // 材料齐备，等 MLRO 终审
  | 'ACTIVE' // 正式客户
  | 'REJECTED' // 未通过（可重新申请，非终态）
  | 'WITHDRAWN' // 客户主动撤回（可重新申请，非终态）
  | 'OFFBOARDED'; // 关系已终止（终态，零出边）

export type CustomerLifecycleAction =
  | 'START_VERIFICATION'
  | 'VERIFICATION_PASSED'
  | 'VERIFICATION_REJECTED'
  | 'WITHDRAW_APPLICATION'
  | 'FINAL_APPROVED'
  | 'FINAL_REJECTED'
  | 'REAPPLY'
  | 'OFFBOARD';

/**
 * 迁移表 —— 9 条边，唯一真相源。
 *
 * INV-1：ACTIVE 的唯一出口是 OFFBOARDED。表里不存在 ACTIVE → REJECTED|WITHDRAWN 的边。
 * 「Sumsub 复评判拒 / 升级审批被拒 / 客户长期不补材料」都不是关系终止，一律落到限制账上，
 * 不许把 ACTIVE 客户退回申请态。要真正终止关系必须走销户（OFFBOARD，本轮只留边不实现流程）。
 */
export const CUSTOMER_LIFECYCLE_TRANSITIONS: Record<
  CustomerLifecycle,
  Partial<Record<CustomerLifecycleAction, CustomerLifecycle>>
> = {
  PROSPECT: {
    START_VERIFICATION: 'IN_VERIFICATION',
  },
  IN_VERIFICATION: {
    VERIFICATION_PASSED: 'PENDING_APPROVAL',
    VERIFICATION_REJECTED: 'REJECTED',
    WITHDRAW_APPLICATION: 'WITHDRAWN',
  },
  PENDING_APPROVAL: {
    FINAL_APPROVED: 'ACTIVE',
    FINAL_REJECTED: 'REJECTED',
  },
  ACTIVE: {
    OFFBOARD: 'OFFBOARDED',
  },
  REJECTED: {
    REAPPLY: 'IN_VERIFICATION',
  },
  WITHDRAWN: {
    REAPPLY: 'IN_VERIFICATION',
  },
  OFFBOARDED: {},
};

/** 终态集合。REJECTED / WITHDRAWN 不在内——他们要能重新申请。 */
export const CUSTOMER_LIFECYCLE_TERMINAL: ReadonlySet<CustomerLifecycle> =
  new Set<CustomerLifecycle>(['OFFBOARDED']);

/** 迁移表的唯一执行入口。非法边一律抛，不返回 null、不静默留在原态。 */
export function nextLifecycle(
  from: CustomerLifecycle,
  action: CustomerLifecycleAction,
): CustomerLifecycle {
  const to = CUSTOMER_LIFECYCLE_TRANSITIONS[from][action];
  if (!to) {
    throw new BadRequestException(`Invalid lifecycle action ${action} from ${from}`);
  }
  return to;
}
```

---

- [ ] **Step 5: 跑测试，确认全绿**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/constants/customer-lifecycle.constant.spec.ts
```
期望输出：
```
Tests:       16 passed, 16 total
Test Suites: 1 passed, 1 total
```
（1 条边数断言 + 9 条 `it.each` 逐边 + 1 条穷举反向 + 1 条键覆盖 + INV-1 + OFFBOARDED 终态 + TERMINAL 集合 + REAPPLY = 16。数量对不上说明有用例被漏写。）

---

- [ ] **Step 6: 提交常量层**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/constants/customer-lifecycle.constant.ts src/modules/identity/constants/customer-lifecycle.constant.spec.ts
git commit -m "feat(identity): 客户生命周期七态迁移表 + nextLifecycle（9 边守则性单测）"
```

---

- [ ] **Step 7: schema.prisma —— 三轴 + restrictions JSON 列换成单轴 lifecycle**

编辑 `prisma/schema.prisma` 206–224 行，把这一整段：

```prisma
  // ═══ 状态轴 1：准入旅程 ═══
  onboardingStatus     String    @default("NONE")
  onboardingTraceId    String?
  onboardingApprovedAt DateTime?

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

  // ═══ 细粒度限制 ═══
  restrictions String @default("[]")
```

替换为：

```prisma
  // ═══ 唯一状态轴：客户关系生命周期 ═══
  // 取值见 src/modules/identity/constants/customer-lifecycle.constant.ts（七态九边）。
  // 「摁住客户」不在这根轴上——制裁/行政暂停/材料过期/等升级/交易审查未过一律进
  // customer_restrictions 限制账（一行 = 一次摁住），可多因并存、各撕各的。
  lifecycle            String    @default("PROSPECT")
  onboardingTraceId    String?
  onboardingApprovedAt DateTime?
```

> `pendingActionExternalId` / `pendingActionReason` / `pendingActionSubmittedAt` / `hardLineDispositionedAt`（226–241 行）**保留不动** —— 客户级补料闭环与限制账互补：限制说「不能做什么」，pendingAction 说「做什么能解开」。

---

- [ ] **Step 8: schema.prisma —— 加反向关系，删两个失效索引**

编辑 297–301 行，把：

```prisma
  explicitTags                CustomerExplicitTag[]

  @@index([adminStatus])
  @@index([complianceStatus])
  @@index([riskRating])
```

替换为：

```prisma
  explicitTags                CustomerExplicitTag[]
  restrictionRows             CustomerRestriction[]

  @@index([riskRating])
```

两个索引随列一起消失（`customer_main_adminStatus_idx` / `customer_main_complianceStatus_idx`，实测存在于 `/tmp/exchange_js_main/dev.db`）。按契约 `CustomerMain` **不新增** `@@index([lifecycle])`，列表页筛选走 `customer_restrictions` 的两条索引 + 全表 lifecycle 扫描，demo 规模无需索引。

---

- [ ] **Step 9: schema.prisma —— 新建 CustomerRestriction model**

在 `model CorporateProfile {`（319 行的空行之后、320 行之前）插入，即紧跟 `CustomerExplicitTag` 之后：

```prisma
model CustomerRestriction {
  id                String    @id @default(uuid())
  // 业务键 generateReferenceNo('RST')。一张便签一个号；卡多个能力 = 同号多行不同 scope，
  // 同贴同撕同事务。API 与前端一律以 restrictionNo 为操作单位，scope 是它的明细。
  restrictionNo     String
  customerId        String
  scope             String
  cause             String
  // visibility / releasePolicy 由 cause 查 RESTRICTION_CAUSE_POLICY 落库（非人工输入）。
  // 落库而非每次现算：保证历史行不因常量表改动而变义。
  visibility        String
  releasePolicy     String
  status            String    @default("OPEN")
  reason            String
  caseRef           String?
  releaseOrderRef   String?
  openedAt          DateTime  @default(now())
  openedBy          String
  releasedAt        DateTime?
  releasedBy        String?
  releaseApprovalNo String?
  releaseMode       String?
  traceId           String

  customer CustomerMain @relation(fields: [customerId], references: [id])

  // 幂等键 (customerId, cause, caseRef) 最多一条 OPEN 由服务层 findFirst 兜底
  // （SQLite 无部分唯一索引，与 ReconciliationCase 同一处理）。
  @@unique([restrictionNo, scope])
  @@index([customerId, status])
  @@index([cause, status])
  @@map("customer_restrictions")
}
```

---

- [ ] **Step 10: 校验 schema 合法**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx prisma validate
```
期望：`The schema at prisma/schema.prisma is valid 🚀`
（不要跑 `npx prisma format` —— 它会重排全文件，把无关行卷进 diff。）

---

- [ ] **Step 11: 生成迁移 SQL（禁止 `prisma migrate dev`）**

本仓迁移是**手工放置 SQL 文件 + `scripts/apply-local-migrations.sh` 按 checksum 顺序应用**，不走 `migrate dev`（后者会对着 `DATABASE_URL` 那个库判漂移并提议 reset；且 main 栈 DB 当前落后 6 个迁移，实测 applied=182 / on-disk=188）。用 `migrate diff` 出 SQL：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
SP=/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/25587352-e7a2-41f6-af36-df029904d1ea/scratchpad
mkdir -p "$SP" prisma/migrations/20260816090000_customer_lifecycle_restrictions
rm -f "$SP/shadow.db"
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --shadow-database-url "file:$SP/shadow.db" \
  --script > prisma/migrations/20260816090000_customer_lifecycle_restrictions/migration.sql
wc -l prisma/migrations/20260816090000_customer_lifecycle_restrictions/migration.sql
```
期望：文件约 100 行；**不得**是 `-- This is an empty migration.`（那说明 Step 7–9 的编辑没保存）。

---

- [ ] **Step 12: 人工核对生成的 SQL（SQLite 删列走表重建，顺序错了子表 FK 会悬空）**

生成物应长成这个形状（节选）：

```sql
-- CreateTable
CREATE TABLE "customer_restrictions" ( ... CONSTRAINT "customer_restrictions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ... );

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_customer_main" ( ... "lifecycle" TEXT NOT NULL DEFAULT 'PROSPECT', ... );
INSERT INTO "new_customer_main" (...) SELECT ... FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";
CREATE UNIQUE INDEX "customer_main_customerNo_key" ...  -- 共 7 条索引重建
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
```

逐条跑校验（全部命中期望值才继续）：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
M=prisma/migrations/20260816090000_customer_lifecycle_restrictions/migration.sql
echo "createTable=$(grep -c 'CREATE TABLE \"customer_restrictions\"' $M)"      # 期望 1
echo "pragma=$(grep -c 'PRAGMA defer_foreign_keys=ON;' $M)"                     # 期望 1
echo "newtable=$(grep -c 'CREATE TABLE \"new_customer_main\"' $M)"              # 期望 1
echo "lifecycle=$(grep -c \"\\\"lifecycle\\\" TEXT NOT NULL DEFAULT 'PROSPECT'\" $M)"  # 期望 1
echo "deadcols=$(grep -cE 'onboardingStatus|adminStatus|complianceStatus|complianceFreeze|suspendedReason|suspendedAt|\"restrictions\"' $M)"  # 期望 0
echo "deadidx=$(grep -c 'customer_main_adminStatus_idx\|customer_main_complianceStatus_idx' $M)"  # 期望 0
echo "uniq=$(grep -c 'customer_restrictions_restrictionNo_scope_key' $M)"       # 期望 1
grep -n 'DROP TABLE "customer_main";' $M
grep -n 'ALTER TABLE "new_customer_main" RENAME TO "customer_main";' $M
```

**最后两条的行号顺序是硬要求：`DROP TABLE "customer_main"` 必须在 `RENAME TO "customer_main"` 之前。** 若 Prisma 生成成了「先 `ALTER TABLE customer_main RENAME TO old_customer_main`」的形状，必须人工改回 drop-then-rename —— 重命名**被引用**的表会触发 SQLite 的子表 FK 重写（所有 `REFERENCES "customer_main"` 会被改指临时名，临时表一 drop 就悬空）。原因逐字见 `prisma/migrations/20260701150000_drop_payins_payouts/migration.sql:1-21`。

---

- [ ] **Step 13: 空库从零重放 + 应用新迁移，实证 SQL 可跑**

不碰 main 栈（它落后 6 个迁移，且 seed 尚未改造，跑 reset 必炸），在 scratchpad 建一次性库验证：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
SP=/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/25587352-e7a2-41f6-af36-df029904d1ea/scratchpad
rm -f "$SP/verify.db" "$SP/shadow2.db"
# 1) 把本次之前的全部迁移重放成基线库（同时证明「空库能从零建起」）
npx prisma migrate diff --from-empty --to-migrations prisma/migrations \
  --shadow-database-url "file:$SP/shadow2.db" --script > "$SP/base.sql"
sqlite3 "$SP/verify.db" < "$SP/base.sql"
echo "tables=$(sqlite3 "$SP/verify.db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';")"
```

> 注意：`base.sql` 是**含本次新迁移在内**的全量重放（`--to-migrations` 读的是目录现状）。所以基线库里 `customer_main` 已经是新形状 —— 这一步验证的是「空库从零建起 + 新旧迁移不打架」。要单独验「老库带数据往上升级」，接着跑：

```bash
# 2) 老形状 + 有数据的库上升级（回到 Step 11 之前的 migrations 目录状态做基线）
rm -f "$SP/old.db" "$SP/shadow3.db"
git stash push -- prisma/migrations/20260816090000_customer_lifecycle_restrictions >/dev/null 2>&1 || \
  mv prisma/migrations/20260816090000_customer_lifecycle_restrictions "$SP/pending-migration"
npx prisma migrate diff --from-empty --to-migrations prisma/migrations \
  --shadow-database-url "file:$SP/shadow3.db" --script > "$SP/old-base.sql"
[ -d "$SP/pending-migration" ] && mv "$SP/pending-migration" prisma/migrations/20260816090000_customer_lifecycle_restrictions
sqlite3 "$SP/old.db" < "$SP/old-base.sql"
sqlite3 "$SP/old.db" "INSERT INTO customer_main (id,customerNo,customerType,updatedAt,onboardingStatus,adminStatus,complianceStatus,restrictions) VALUES ('c1','CUS0001','INDIVIDUAL',CURRENT_TIMESTAMP,'APPROVED','ACTIVE','CLEAR','[]');"
sqlite3 "$SP/old.db" < prisma/migrations/20260816090000_customer_lifecycle_restrictions/migration.sql
sqlite3 "$SP/old.db" "PRAGMA foreign_key_check;"
sqlite3 "$SP/old.db" "SELECT id,lifecycle FROM customer_main;"
echo "leftover_dead_cols=$(sqlite3 "$SP/old.db" "PRAGMA table_info(customer_main);" | grep -cE 'onboardingStatus|adminStatus|complianceStatus|restrictions|suspended')"
sqlite3 "$SP/old.db" "SELECT name FROM sqlite_master WHERE tbl_name='customer_restrictions';"
```

期望输出（实测过的逐字结果）：
```
c1|PROSPECT
leftover_dead_cols=0
customer_restrictions
sqlite_autoindex_customer_restrictions_1
customer_restrictions_customerId_status_idx
customer_restrictions_cause_status_idx
customer_restrictions_restrictionNo_scope_key
```
`PRAGMA foreign_key_check` 必须**零输出**（无悬空 FK）。老行落到 `lifecycle=PROSPECT` 是预期 —— demo 约定不做 backfill，正确取值靠后续 seed 重铺，不靠迁移。

再验 `@@unique([restrictionNo, scope])` 真的挡住重复：

```bash
SP=/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/25587352-e7a2-41f6-af36-df029904d1ea/scratchpad
sqlite3 "$SP/old.db" "PRAGMA foreign_keys=ON; INSERT INTO customer_restrictions (id,restrictionNo,customerId,scope,cause,visibility,releasePolicy,status,reason,openedAt,openedBy,traceId) VALUES ('r1','RST26081600001','c1','WITHDRAW','MATERIAL_EXPIRED','DISCLOSED','OPS_APPROVAL','OPEN','x',CURRENT_TIMESTAMP,'sys','t1');"
sqlite3 "$SP/old.db" "PRAGMA foreign_keys=ON; INSERT INTO customer_restrictions (id,restrictionNo,customerId,scope,cause,visibility,releasePolicy,status,reason,openedAt,openedBy,traceId) VALUES ('r2','RST26081600001','c1','WITHDRAW','MATERIAL_EXPIRED','DISCLOSED','OPS_APPROVAL','OPEN','x',CURRENT_TIMESTAMP,'sys','t1');"
```
第一条成功、第二条期望报：
```
Error: stepping, UNIQUE constraint failed: customer_restrictions.restrictionNo, customer_restrictions.scope (19)
```

---

- [ ] **Step 14: 重新生成 Prisma Client，确认新 delegate 出现、死列消失**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npm run prisma:generate
echo "delegate=$(grep -c 'CustomerRestrictionDelegate' node_modules/.prisma/client/index.d.ts)"   # 期望 ≥ 1
echo "deadcol=$(grep -c 'onboardingStatus' node_modules/.prisma/client/index.d.ts)"               # 期望 0（改前实测 80）
echo "lifecycle=$(grep -c 'CustomerMainWhereInput' node_modules/.prisma/client/index.d.ts)"        # 期望 ≥ 1（sanity：客户端确实重生成了）
```

---

- [ ] **Step 15: 记录 tsc 落地面基线（预期非零，供 Task 2 / 5 / 6 / 7 收敛用）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
SP=/private/tmp/claude-501/-Users-songshengwei-Documents-codex-projects----/25587352-e7a2-41f6-af36-df029904d1ea/scratchpad
npx tsc --noEmit > "$SP/task1-tsc-fallout.txt" 2>&1 || true
echo "errors=$(grep -c 'error TS' "$SP/task1-tsc-fallout.txt")"
echo "hits_in_new_files=$(grep -c 'customer-lifecycle.constant' "$SP/task1-tsc-fallout.txt")"
grep -oE '^[^(]+' "$SP/task1-tsc-fallout.txt" | sort -u > "$SP/task1-tsc-fallout-files.txt"
wc -l < "$SP/task1-tsc-fallout-files.txt"
```

两条硬判据：
- `errors` **必须 > 0**（`tsconfig.json` 的 `include` 只有 `src/**/*`，40 个 src 内消费方仍在读 `onboardingStatus` / `adminStatus` / `complianceStatus` / `complianceFreeze*` / `restrictions`）——这是模型替换的必然中间态，Task 2 / 5 / 6 / 7 收敛到 0。
- `hits_in_new_files` **必须 = 0** —— 本任务新写的两个文件自身不许有类型错。

`task1-tsc-fallout-files.txt` 里的路径应全部落在这几簇里（后续任务的工单清单）：`identity/auth`（`customer-auth.service.ts`、`jwt.strategy.ts`）、`identity/onboarding`、`identity/customers`、`identity/customer-status.util.ts`、`identity/material-refresh`、`identity/tier-upgrade-case`、`identity/client-risk-assessment`、`identity/profile-banners`、`sumsub-ingestion`、`trading/{deposit,withdraw,swap,shared}`、`asset-treasury/{wallets,withdrawal-addresses}`。出现簇外文件要停下核对。另有 `tsc` 覆盖不到但同样待改的三处：`prisma/seed.business.ts`、`scripts/demo-lib.ts`、`test/swap-*.e2e-spec.ts`（由 seed 重铺与 e2e 任务收）。

> 本任务**不跑** `npm test` / `demo:all` / `verify:coa` —— 它们此刻必挂在同一批未收敛的消费方上，跑了只是重复 Step 15 已量化的信息。也**不跑** `bash scripts/stack.sh reset-main`：seed.business.ts 仍在写已删的三列，reset 会在 seed 阶段炸。main 栈的迁移 + 重铺放到 seed 改造任务里一次做完。

---

- [ ] **Step 16: 提交模型层**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add prisma/schema.prisma prisma/migrations/20260816090000_customer_lifecycle_restrictions/migration.sql
git commit -m "feat(prisma): CustomerMain 三轴收敛为 lifecycle 单轴 + 新建 customer_restrictions 限制账表"
```

提交后确认工作树只剩预期改动：

```bash
git status --short -- prisma src
git show --stat HEAD
```
期望：`git status` 对 `prisma/`、`src/` 无输出；`git show --stat` 显示 2 个文件（`prisma/schema.prisma` 约 +40/−22、新迁移文件约 +100）。

---

### Task 2: onboarding 写入点迁移到 lifecycle 轴

把 `onboardingStatus`（+ 已随 Task 1 删列的 `adminStatus` / `complianceStatus`）的 **17 个写入点**全部改为经 `nextLifecycle()` 校验后落 `lifecycle` 单列；作废三轴归一化层 `customer-status.util.ts`；删除 `LEGACY_PENDING_ONBOARDING_STATUSES` 整套遗留值映射（demo 约定禁兼容层）。

> 归属边界：`material-refresh.service.ts:150`、`tier-upgrade-case.service.ts:174`、`sumsub-ingestion.service.ts:194` 三个自动写入方**不在本 Task**（Task 7 处理，它们按 INV-1 改为贴便签而非动轴）。

**Files:**

- Create: `src/modules/identity/customer-lifecycle.util.ts` — 取代 `customer-status.util.ts` 的判据层，只读 `lifecycle` 一根轴
- Create (Test): `src/modules/identity/customer-lifecycle.util.spec.ts`
- Delete: `src/modules/identity/customer-status.util.ts`（全 278 行）
- Delete (Test): `src/modules/identity/customer-status.util.spec.ts`（全 237 行）
- Modify: `src/modules/identity/onboarding/onboarding.service.ts` — L18-33（imports）、L60-66（类型）、L105-121（select 常量）、L137-154（遗留值集合）、L163-173（返回类型）、L205-223（终态守卫）、L250-394（事件 switch + 落库）、L400/L435-438/L832-833（审计字段）、L605-680（三轴私有 helper 区）、L704-741（nextStep 投影）、L936-965（autoExpireIfNeeded）、L1045-1075（getMyOnboarding / snapshot）、L1077-1200（startVerification）、L1218（mockSubmit 守卫）、L1249/L1314/L1367（autoExpire 调用点）、L1261-1300（upsertEntity）、L1303-1331（simulateCustomerExpired 审计）、L1366-1422（assertTradingEligibility）、L1438-1455（recomputeComplianceSnapshot）
- Modify: `src/modules/identity/onboarding/dto/onboarding.dto.ts` — L17-21（import）、L210-214（`StartVerificationCustomerSnapshotDto`）
- Modify: `src/modules/identity/onboarding/onboarding-final-approval.service.ts` — L21（import）、L34-44（`FinalApprovalCustomerRow`）、L58-68（select）、L130-136（`assertCustomerInFinalApproval`）、L458-494（`buildLifecycleProjection`）
- Modify: `src/modules/identity/customers/customers.controller.ts` — L26-57（`buildCustomerStatusWhere`）
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.ts` — L23-37（cron where）
- Modify: `src/modules/accounting/tigerbeetle/tb-manual-account.service.ts` — L21（import）、L92-95（select）
- Modify (Test): `src/modules/identity/onboarding/onboarding.service.spec.ts`（1559 行，165 处三轴引用）
- Modify (Test): `src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`（307 行，21 处）
- Modify (Test): `src/modules/identity/customers/customers.controller.spec.ts`（165 行，L34-163 全部是 legacy 状态筛选断言）

**Interfaces:**

Consumes（Task 1 产物，逐字，不得改名）：
```ts
// src/modules/identity/constants/customer-lifecycle.constant.ts
export type CustomerLifecycle = 'PROSPECT'|'IN_VERIFICATION'|'PENDING_APPROVAL'|'ACTIVE'|'REJECTED'|'WITHDRAWN'|'OFFBOARDED';
export type CustomerLifecycleAction = 'START_VERIFICATION'|'VERIFICATION_PASSED'|'VERIFICATION_REJECTED'|'WITHDRAW_APPLICATION'|'FINAL_APPROVED'|'FINAL_REJECTED'|'REAPPLY'|'OFFBOARD';
export function nextLifecycle(from: CustomerLifecycle, action: CustomerLifecycleAction): CustomerLifecycle;
// CustomerMain.lifecycle String @default("PROSPECT")
```

Produces：
```ts
// src/modules/identity/customer-lifecycle.util.ts
export type CustomerNextStepActionType = 'START_VERIFICATION'|'CONTINUE_VERIFICATION'|'WAIT_VERIFICATION'|'WAIT_FINAL_APPROVAL'|'REINITIATE_VERIFICATION'|'NONE';
export type CustomerReviewStage = 'REVIEW_CDD' | 'REVIEW_EDD';
export interface CustomerLifecycleSource { lifecycle?: string|null; verificationCanContinue?: boolean|null; eddRequired?: boolean|null; cddDocumentExpiresAt?: Date|string|null; }
export function isCustomerLifecycle(value: unknown): value is CustomerLifecycle;
export function readLifecycle(source: CustomerLifecycleSource): CustomerLifecycle;                                  // 未知值 fail-closed 抛 BadRequestException
export function resolveLifecycleTransition(from: CustomerLifecycle, action: CustomerLifecycleAction): CustomerLifecycle | null;  // null = 已在目标态（幂等重放）
export function buildLifecycleTransitionPatch(from: CustomerLifecycle, action: CustomerLifecycleAction): { lifecycle?: CustomerLifecycle };
export function getCustomerNextStepActionTypes(source: CustomerLifecycleSource): CustomerNextStepActionType[];
export function getCustomerBlockedReason(source: CustomerLifecycleSource): string | null;
export function canStartCdd(source: CustomerLifecycleSource): boolean;
export function canReinitiateCdd(source: CustomerLifecycleSource): boolean;
export function canStartEdd(source: CustomerLifecycleSource): boolean;
export function canReinitiateEdd(source: CustomerLifecycleSource): boolean;
export function getExpectedReviewStageFromCustomerState(source: CustomerLifecycleSource): CustomerReviewStage | null;
export function canFinalReview(source: CustomerLifecycleSource): boolean;
export function isCustomerApprovedAndActive(source: CustomerLifecycleSource): boolean;

// OnboardingService（唯一 lifecycle 落库口）
private async advanceLifecycle(customerId: string, action: CustomerLifecycleAction, tx?: Prisma.TransactionClient, extra?: Prisma.CustomerMainUpdateInput): Promise<CustomerMain>;

// 契约变更（Task 7 的 sumsub-ingestion.service.ts:276 消费此返回值）
OnboardingService.handleSumsubVerificationEvent(): Promise<{ customer: { lifecycle: string }; verification: VerificationProjection }>  // 原 { onboardingStatus, adminStatus, complianceStatus }
StartVerificationCustomerSnapshotDto = { lifecycle: CustomerLifecycle }                                              // 原三字段
```

删除的导出（三轴归一化层，全仓无幸存调用方）：`CustomerOnboardingStatus` / `CustomerAdminStatus` / `CustomerComplianceStatus` / `CustomerCanonicalState` / `CustomerStatusSource` / `normalizeCustomerOnboardingStatus` / `normalizeCustomerAdminStatus` / `normalizeCustomerComplianceStatus` / `resolveCustomerCanonicalState` / `buildCustomerLifecyclePatch` / `LEGACY_PENDING_ONBOARDING_STATUSES`（含 `isLegacyPendingOnboardingStatus`）。

**17 个写入点逐处对照（文件:行号 → 今天写什么 → 改成什么）：**

| # | 位置 | 今天写什么 | 改成什么 |
|---|---|---|---|
| 1 | `onboarding.service.ts:255-256` | `applicantPending` → `onboardingStatus:'PENDING_VERIFICATION'` + `adminStatus:'INACTIVE'` | `advanceLifecycle(id,'START_VERIFICATION',tx,updateData)`；已 IN_VERIFICATION 时是 no-op |
| 2 | `onboarding.service.ts:267-268` | `applicantOnHold` → 同上 | 同 #1 |
| 3 | `onboarding.service.ts:279-280` | `applicantLevelChanged` → 同上 | 同 #1 |
| 4 | `onboarding.service.ts:293-294` | `applicantReviewed`（RED/RETRY）→ 同上 | 同 #1 |
| 5 | `onboarding.service.ts:305-306` | `applicantReviewed`（其余）→ 同上 | 同 #1 |
| 6 | `onboarding.service.ts:321-322` | 传给 `ensurePendingApprovalInTransaction` 的内存对象 `{...customer, onboardingStatus:'FINAL_APPROVAL', adminStatus:'INACTIVE'}` | `{ ...customer, lifecycle: 'PENDING_APPROVAL' }`（非落库，仅供 `assertCustomerInFinalApproval` 判据） |
| 7 | `onboarding.service.ts:331-332` | `applicantWorkflowCompleted` + 经历 level2 → `'FINAL_APPROVAL'` + `INACTIVE` | `advanceLifecycle(id,'VERIFICATION_PASSED',tx,updateData)` |
| 8 | `onboarding.service.ts:345-346` | `applicantWorkflowCompleted` 未经 level2 → `'APPROVED'` + `'ACTIVE'`（自动批准） | 九边表无 IN_VERIFICATION→ACTIVE 直达边 → 同事务两跳：先 `advanceLifecycle(id,'VERIFICATION_PASSED',tx)` 再 `advanceLifecycle(id,'FINAL_APPROVED',tx,updateData)` |
| 9 | `onboarding.service.ts:364-365` | `applicantWorkflowFailed` → `'REJECTED'` + `INACTIVE` | `advanceLifecycle(id,'VERIFICATION_REJECTED',tx,updateData)` |
| 10 | `onboarding.service.ts:379-380` | 未知事件 default → `'PENDING_VERIFICATION'` + `INACTIVE` | 同 #1 |
| 11 | `onboarding.service.ts:958-959` | `autoExpireIfNeeded()`：ACTIVE 客户 CDD 过期 → `'PENDING_CDD_INPUT'` + `INACTIVE` | **整个 `autoExpireIfNeeded()` 删除**（连同 `customerAutoExpireSelect` 与 L1046/L1249/L1314/L1367 四个调用点）。理由：违反 INV-1（ACTIVE 唯一出边是 OFFBOARDED），且 `PENDING_CDD_INPUT` 是被删的遗留值，九边表无对应动作。材料过期改由 `MATERIAL_EXPIRED` 便签承接（设计稿 §3.3，属限制账 Task） |
| 12 | `onboarding.service.ts:1147-1148` | `startVerification()` → `'PENDING_VERIFICATION'` + `INACTIVE` | `advanceLifecycle(id, isReinitiating ? 'REAPPLY' : 'START_VERIFICATION', undefined, updateData)` |
| 13 | `onboarding-final-approval.service.ts:466-467` | 审批 APPROVED 投影 → `'APPROVED'` + `'ACTIVE'` | `...buildLifecycleTransitionPatch(readLifecycle(customer),'FINAL_APPROVED')` |
| 14 | `onboarding-final-approval.service.ts:481-482` | 审批 REJECTED 投影 → `'REJECTED'` + `INACTIVE` | `...buildLifecycleTransitionPatch(readLifecycle(customer),'FINAL_REJECTED')` |
| 15 | `customers.controller.ts:35-36` | 列表筛选 where：`ACTIVE` → `{ onboardingStatus:'APPROVED', adminStatus:'ACTIVE' }`（**是查询条件不是建客户**） | `{ lifecycle: 'ACTIVE' }` |
| 16 | `customers.controller.ts:47` | 六个 legacy 值（`PENDING_CDD`/`REVIEW_CDD`/`PENDING_EDD`/`REVIEW_EDD`/`PENDING_CDD_INPUT`/`CDD_UNDER_REVIEW`/`PENDING_EDD_INPUT`/`EDD_UNDER_REVIEW`）→ `{ onboardingStatus:'PENDING_VERIFICATION' }` | **整段 switch 删除**（禁兼容层），函数塌成 `{ lifecycle: normalized }` 直传 |
| 17 | `client-risk-assessment-cron.service.ts:25` | 季度重评 findMany where `onboardingStatus:'APPROVED'` | `lifecycle: 'ACTIVE'` |

**派生点（非字符串字面量，但同批必改，否则 tsc 不过）：** `onboarding.service.ts` L60-66（`LegacyCompatibleOnboardingStatus` 删）、L105-121（两个 select）、L137-154（`recognizedRawOnboardingStatuses` / `legacyRawVerificationStatuses` 删）、L205-223（终态守卫）、L400+L435-438+L832-833（审计 `beforeOnboardingStatus`→`beforeLifecycle`、`onboardingStatusFrom/To`→`lifecycleFrom/To`；这两个入参在 `writeSumsubAudit` 体内**从未被使用**，纯改名）、L605-636（`getCanonicalState`/`normalizeRawOnboardingStatus`/`resolveInvalidRawOnboardingStatus`/`getCustomerOnboardingStatus` 删）、L638-659（`resolveEddRequiredForState` 重写）、L661-680（私有 `buildCustomerLifecyclePatch` 删，换 `advanceLifecycle`）、L704-719（`mapActionsByStatus`/`buildBlockedReason`）、L721-741（`buildNextStep` 去 invalid 分支）、L1049-1055（`getMyOnboarding` 三字段覆写删）、L1064-1075（`buildCustomerSnapshot`）、L1218（`mockSubmitVerification` 守卫 `PENDING_VERIFICATION`→`IN_VERIFICATION`）、L1264-1269（`upsertEntity` 自写回 patch 删）、L1292-1293/L1306/L1322-1323（审计 fromStage/toStage）、L1377-1417（`assertTradingEligibility`）、L1442-1447（`recomputeComplianceSnapshot`）。

---

- [ ] **Step 1: 核对 Task 1 产物的导出名（不核对就动手 = 白改）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
grep -n "export" src/modules/identity/constants/customer-lifecycle.constant.ts
grep -n "lifecycle" prisma/schema.prisma | head -5
grep -rn "onboardingStatus\|adminStatus\|complianceStatus" prisma/schema.prisma
```

期望：第一条至少打印 `export type CustomerLifecycle`、`export type CustomerLifecycleAction`、`export function nextLifecycle`；第二条打印 `lifecycle String @default("PROSPECT")`；第三条**零输出**（三轴列已删）。任一不符 → 停，Task 1 未完成，不要继续。

- [ ] **Step 2: 写 `customer-lifecycle.util.spec.ts`（失败测试先行）**

新建 `src/modules/identity/customer-lifecycle.util.spec.ts`：

```ts
import { BadRequestException } from '@nestjs/common';
import {
  nextLifecycle,
  type CustomerLifecycle,
  type CustomerLifecycleAction,
} from './constants/customer-lifecycle.constant';
import {
  buildLifecycleTransitionPatch,
  canFinalReview,
  canReinitiateCdd,
  canReinitiateEdd,
  canStartCdd,
  canStartEdd,
  getCustomerBlockedReason,
  getCustomerNextStepActionTypes,
  getExpectedReviewStageFromCustomerState,
  isCustomerApprovedAndActive,
  readLifecycle,
  resolveLifecycleTransition,
} from './customer-lifecycle.util';

const ALL_LIFECYCLES: CustomerLifecycle[] = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

const ALL_ACTIONS: CustomerLifecycleAction[] = [
  'START_VERIFICATION',
  'VERIFICATION_PASSED',
  'VERIFICATION_REJECTED',
  'WITHDRAW_APPLICATION',
  'FINAL_APPROVED',
  'FINAL_REJECTED',
  'REAPPLY',
  'OFFBOARD',
];

describe('customer-lifecycle.util', () => {
  describe('转移表一致性（防漂移）', () => {
    it('全量枚举恰好九条合法边，且每个动作只有一个目标态', () => {
      const legal: Array<[CustomerLifecycle, CustomerLifecycleAction, CustomerLifecycle]> = [];
      for (const from of ALL_LIFECYCLES) {
        for (const action of ALL_ACTIONS) {
          try {
            legal.push([from, action, nextLifecycle(from, action)]);
          } catch {
            // 非法边，跳过
          }
        }
      }

      expect(legal).toHaveLength(9);

      const targets = new Map<CustomerLifecycleAction, Set<CustomerLifecycle>>();
      for (const [, action, to] of legal) {
        const bucket = targets.get(action) ?? new Set<CustomerLifecycle>();
        bucket.add(to);
        targets.set(action, bucket);
      }
      for (const [action, bucket] of targets) {
        expect([action, bucket.size]).toEqual([action, 1]);
      }
    });

    it('resolveLifecycleTransition 在每条合法边上与 nextLifecycle 逐字一致', () => {
      for (const from of ALL_LIFECYCLES) {
        for (const action of ALL_ACTIONS) {
          let expected: CustomerLifecycle;
          try {
            expected = nextLifecycle(from, action);
          } catch {
            continue;
          }
          expect(resolveLifecycleTransition(from, action)).toBe(expected);
        }
      }
    });

    it('已在目标态时是幂等 no-op，返回 null 而不抛', () => {
      expect(resolveLifecycleTransition('IN_VERIFICATION', 'START_VERIFICATION')).toBeNull();
      expect(resolveLifecycleTransition('IN_VERIFICATION', 'REAPPLY')).toBeNull();
      expect(resolveLifecycleTransition('REJECTED', 'VERIFICATION_REJECTED')).toBeNull();
    });

    it('非法边抛 BadRequestException', () => {
      expect(() => resolveLifecycleTransition('PROSPECT', 'FINAL_APPROVED')).toThrow(
        BadRequestException,
      );
      expect(() => resolveLifecycleTransition('OFFBOARDED', 'REAPPLY')).toThrow(
        'Invalid lifecycle action REAPPLY from OFFBOARDED',
      );
    });

    it('buildLifecycleTransitionPatch：合法边给 patch，no-op 给空对象', () => {
      expect(buildLifecycleTransitionPatch('PENDING_APPROVAL', 'FINAL_APPROVED')).toEqual({
        lifecycle: 'ACTIVE',
      });
      expect(buildLifecycleTransitionPatch('ACTIVE', 'FINAL_APPROVED')).toEqual({});
    });
  });

  describe('readLifecycle', () => {
    it('大小写归一，未知值 fail-closed', () => {
      expect(readLifecycle({ lifecycle: 'active' })).toBe('ACTIVE');
      expect(() => readLifecycle({ lifecycle: 'PENDING_CDD_INPUT' })).toThrow(BadRequestException);
      expect(() => readLifecycle({ lifecycle: null })).toThrow(BadRequestException);
    });
  });

  describe('判据函数（全部只读 lifecycle）', () => {
    it('getCustomerNextStepActionTypes 逐态', () => {
      expect(getCustomerNextStepActionTypes({ lifecycle: 'PROSPECT' })).toEqual([
        'START_VERIFICATION',
      ]);
      expect(
        getCustomerNextStepActionTypes({ lifecycle: 'IN_VERIFICATION', verificationCanContinue: true }),
      ).toEqual(['CONTINUE_VERIFICATION']);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'IN_VERIFICATION' })).toEqual([
        'WAIT_VERIFICATION',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'PENDING_APPROVAL' })).toEqual([
        'WAIT_FINAL_APPROVAL',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'ACTIVE' })).toEqual(['NONE']);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'REJECTED' })).toEqual([
        'REINITIATE_VERIFICATION',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'WITHDRAWN' })).toEqual([
        'REINITIATE_VERIFICATION',
      ]);
      expect(getCustomerNextStepActionTypes({ lifecycle: 'OFFBOARDED' })).toEqual(['NONE']);
    });

    it('getCustomerBlockedReason 逐态', () => {
      expect(getCustomerBlockedReason({ lifecycle: 'PROSPECT' })).toBeNull();
      expect(getCustomerBlockedReason({ lifecycle: 'IN_VERIFICATION' })).toBeNull();
      expect(getCustomerBlockedReason({ lifecycle: 'PENDING_APPROVAL' })).toBe(
        'Waiting final onboarding decision.',
      );
      expect(getCustomerBlockedReason({ lifecycle: 'ACTIVE' })).toBe('Onboarding completed.');
      expect(getCustomerBlockedReason({ lifecycle: 'REJECTED' })).toBe(
        'Onboarding is rejected. Re-initiate required.',
      );
      expect(getCustomerBlockedReason({ lifecycle: 'WITHDRAWN' })).toBe('Onboarding is withdrawn.');
      expect(getCustomerBlockedReason({ lifecycle: 'OFFBOARDED' })).toBe(
        'Customer relationship is closed.',
      );
    });

    it('CDD / EDD / 终审 / 活跃 判据', () => {
      expect(canStartCdd({ lifecycle: 'PROSPECT' })).toBe(true);
      expect(canStartCdd({ lifecycle: 'IN_VERIFICATION' })).toBe(false);

      expect(canReinitiateCdd({ lifecycle: 'REJECTED' })).toBe(true);
      expect(canReinitiateCdd({ lifecycle: 'WITHDRAWN' })).toBe(true);
      expect(
        canReinitiateCdd({ lifecycle: 'ACTIVE', cddDocumentExpiresAt: new Date(Date.now() - 1000) }),
      ).toBe(true);
      expect(canReinitiateCdd({ lifecycle: 'ACTIVE' })).toBe(false);

      expect(canStartEdd({ lifecycle: 'IN_VERIFICATION', eddRequired: true })).toBe(true);
      expect(canStartEdd({ lifecycle: 'IN_VERIFICATION' })).toBe(false);

      expect(canReinitiateEdd({ lifecycle: 'PENDING_APPROVAL', eddRequired: true })).toBe(true);
      expect(canReinitiateEdd({ lifecycle: 'IN_VERIFICATION', eddRequired: true })).toBe(false);

      expect(getExpectedReviewStageFromCustomerState({ lifecycle: 'IN_VERIFICATION' })).toBe(
        'REVIEW_CDD',
      );
      expect(
        getExpectedReviewStageFromCustomerState({ lifecycle: 'IN_VERIFICATION', eddRequired: true }),
      ).toBe('REVIEW_EDD');
      expect(getExpectedReviewStageFromCustomerState({ lifecycle: 'ACTIVE' })).toBeNull();

      expect(canFinalReview({ lifecycle: 'PENDING_APPROVAL' })).toBe(true);
      expect(canFinalReview({ lifecycle: 'ACTIVE' })).toBe(false);

      expect(isCustomerApprovedAndActive({ lifecycle: 'ACTIVE' })).toBe(true);
      expect(isCustomerApprovedAndActive({ lifecycle: 'PENDING_APPROVAL' })).toBe(false);
    });
  });
});
```

- [ ] **Step 3: 跑它，确认失败**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/customer-lifecycle.util.spec.ts
```

期望输出包含：`Cannot find module './customer-lifecycle.util' from 'src/modules/identity/customer-lifecycle.util.spec.ts'`，`Tests: 0 total`，`Test Suites: 1 failed`。

- [ ] **Step 4: 建 `customer-lifecycle.util.ts`，跑通过**

新建 `src/modules/identity/customer-lifecycle.util.ts`：

```ts
import { BadRequestException } from '@nestjs/common';
import {
  nextLifecycle,
  type CustomerLifecycle,
  type CustomerLifecycleAction,
} from './constants/customer-lifecycle.constant';

export type CustomerNextStepActionType =
  | 'START_VERIFICATION'
  | 'CONTINUE_VERIFICATION'
  | 'WAIT_VERIFICATION'
  | 'WAIT_FINAL_APPROVAL'
  | 'REINITIATE_VERIFICATION'
  | 'NONE';

export type CustomerReviewStage = 'REVIEW_CDD' | 'REVIEW_EDD';

export interface CustomerLifecycleSource {
  lifecycle?: string | null;
  verificationCanContinue?: boolean | null;
  eddRequired?: boolean | null;
  cddDocumentExpiresAt?: Date | string | null;
}

const CUSTOMER_LIFECYCLE_VALUES = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
] as const satisfies readonly CustomerLifecycle[];

/**
 * 九边迁移表的右列去重：每个动作恰有一个目标态（REJECTED 有两条入边
 * VERIFICATION_REJECTED / FINAL_REJECTED，但每个动作各自只指向一个态）。
 * 与 nextLifecycle 的一致性由 customer-lifecycle.util.spec.ts 逐边断言，
 * 表漂移会立刻红。用途只有一个：判断"已在目标态"的幂等重放。
 */
const LIFECYCLE_ACTION_TARGET: Record<CustomerLifecycleAction, CustomerLifecycle> = {
  START_VERIFICATION: 'IN_VERIFICATION',
  VERIFICATION_PASSED: 'PENDING_APPROVAL',
  VERIFICATION_REJECTED: 'REJECTED',
  WITHDRAW_APPLICATION: 'WITHDRAWN',
  FINAL_APPROVED: 'ACTIVE',
  FINAL_REJECTED: 'REJECTED',
  REAPPLY: 'IN_VERIFICATION',
  OFFBOARD: 'OFFBOARDED',
};

export function isCustomerLifecycle(value: unknown): value is CustomerLifecycle {
  return (CUSTOMER_LIFECYCLE_VALUES as readonly string[]).includes(String(value));
}

/** 把 Prisma 的 string 列收窄成 CustomerLifecycle；未知值 fail-closed。 */
export function readLifecycle(source: CustomerLifecycleSource): CustomerLifecycle {
  const raw = String(source.lifecycle ?? '').trim().toUpperCase();
  if (!isCustomerLifecycle(raw)) {
    throw new BadRequestException(`Unknown customer lifecycle ${raw || '(empty)'}`);
  }
  return raw;
}

/**
 * 唯一的边校验入口。
 * - 当前态已等于该动作的目标态 → 返回 null（幂等重放，比如 Sumsub 连发两条
 *   applicantPending），调用方不写 lifecycle
 * - 其余一律交给 nextLifecycle，非法边抛 BadRequestException
 */
export function resolveLifecycleTransition(
  from: CustomerLifecycle,
  action: CustomerLifecycleAction,
): CustomerLifecycle | null {
  if (from === LIFECYCLE_ACTION_TARGET[action]) {
    return null;
  }
  return nextLifecycle(from, action);
}

export function buildLifecycleTransitionPatch(
  from: CustomerLifecycle,
  action: CustomerLifecycleAction,
): { lifecycle?: CustomerLifecycle } {
  const to = resolveLifecycleTransition(from, action);
  return to ? { lifecycle: to } : {};
}

function isExpiredCdd(source: CustomerLifecycleSource): boolean {
  if (!source.cddDocumentExpiresAt) {
    return false;
  }

  const expiresAt =
    source.cddDocumentExpiresAt instanceof Date
      ? source.cddDocumentExpiresAt
      : new Date(source.cddDocumentExpiresAt);

  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() <= Date.now();
}

export function getCustomerNextStepActionTypes(
  source: CustomerLifecycleSource,
): CustomerNextStepActionType[] {
  switch (readLifecycle(source)) {
    case 'PROSPECT':
      return ['START_VERIFICATION'];
    case 'IN_VERIFICATION':
      return source.verificationCanContinue ? ['CONTINUE_VERIFICATION'] : ['WAIT_VERIFICATION'];
    case 'PENDING_APPROVAL':
      return ['WAIT_FINAL_APPROVAL'];
    case 'ACTIVE':
      return ['NONE'];
    case 'REJECTED':
    case 'WITHDRAWN':
      return ['REINITIATE_VERIFICATION'];
    case 'OFFBOARDED':
      return ['NONE'];
  }
}

export function getCustomerBlockedReason(source: CustomerLifecycleSource): string | null {
  switch (readLifecycle(source)) {
    case 'PROSPECT':
    case 'IN_VERIFICATION':
      return null;
    case 'PENDING_APPROVAL':
      return 'Waiting final onboarding decision.';
    case 'ACTIVE':
      return 'Onboarding completed.';
    case 'REJECTED':
      return 'Onboarding is rejected. Re-initiate required.';
    case 'WITHDRAWN':
      return 'Onboarding is withdrawn.';
    case 'OFFBOARDED':
      return 'Customer relationship is closed.';
  }
}

export function canStartCdd(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'PROSPECT';
}

export function canReinitiateCdd(source: CustomerLifecycleSource): boolean {
  const lifecycle = readLifecycle(source);
  return lifecycle === 'REJECTED' || lifecycle === 'WITHDRAWN' || isExpiredCdd(source);
}

/** EDD 是认证流程内的加深环节：认证在途 + 已判定需要 EDD。 */
export function canStartEdd(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'IN_VERIFICATION' && Boolean(source.eddRequired);
}

/** 材料已齐、等终审期间，MLRO 可以要求重跑 EDD。 */
export function canReinitiateEdd(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'PENDING_APPROVAL' && Boolean(source.eddRequired);
}

export function getExpectedReviewStageFromCustomerState(
  source: CustomerLifecycleSource,
): CustomerReviewStage | null {
  if (readLifecycle(source) !== 'IN_VERIFICATION') {
    return null;
  }
  return source.eddRequired ? 'REVIEW_EDD' : 'REVIEW_CDD';
}

export function canFinalReview(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'PENDING_APPROVAL';
}

export function isCustomerApprovedAndActive(source: CustomerLifecycleSource): boolean {
  return readLifecycle(source) === 'ACTIVE';
}
```

```bash
npx jest src/modules/identity/customer-lifecycle.util.spec.ts
```

期望：`Tests: 8 passed, 8 total`，`Test Suites: 1 passed`。

- [ ] **Step 5: 删三轴归一化层，切最后一个非 onboarding 调用方（tb-manual-account）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git rm src/modules/identity/customer-status.util.ts src/modules/identity/customer-status.util.spec.ts
```

`src/modules/accounting/tigerbeetle/tb-manual-account.service.ts` L21：

```ts
import { isCustomerApprovedAndActive } from '../../identity/customer-lifecycle.util';
```

同文件 L92-95：

```ts
      customer = await this.prisma.customerMain.findUnique({
        where: { customerNo: input.customerNo },
        select: { id: true, customerNo: true, lifecycle: true },
      });
```

（L102-107 的 `if (!isCustomerApprovedAndActive(customer))` 与错误码 `CUSTOMER_NOT_APPROVED` 保持不动。）

- [ ] **Step 6: commit 判据层**

```bash
git add src/modules/identity/customer-lifecycle.util.ts src/modules/identity/customer-lifecycle.util.spec.ts src/modules/identity/customer-status.util.ts src/modules/identity/customer-status.util.spec.ts src/modules/accounting/tigerbeetle/tb-manual-account.service.ts
git commit -m "refactor(identity): 判据函数迁到 lifecycle 单轴，删三轴归一化层与遗留值映射"
```

- [ ] **Step 7: 写 `advanceLifecycle` 的失败测试**

在 `src/modules/identity/onboarding/onboarding.service.spec.ts` 末尾（当前 L1558 的 `});` 之前）追加：

```ts
  describe('advanceLifecycle 九边闸门（Task 2）', () => {
    it('applicantPending 在 PROSPECT 上走 START_VERIFICATION 落 IN_VERIFICATION', async () => {
      seedVerificationEventFlow({ lifecycle: 'PROSPECT' });

      await service.handleSumsubVerificationEvent(
        { type: 'applicantPending', applicantId: 'app-1' },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-1' },
          data: expect.objectContaining({ lifecycle: 'IN_VERIFICATION' }),
        }),
      );
    });

    it('已在 IN_VERIFICATION 时重放 applicantPending 不再写 lifecycle（幂等）', async () => {
      seedVerificationEventFlow({ lifecycle: 'IN_VERIFICATION' });

      await service.handleSumsubVerificationEvent(
        { type: 'applicantPending', applicantId: 'app-1' },
        { simulated: false, actorId: 'SUMSUB' },
      );

      const [[{ data }]] = prismaMock.customerMain.update.mock.calls;
      expect(data.lifecycle).toBeUndefined();
      expect(data.verificationSubstatus).toBe('SUBMITTED');
    });

    it('applicantWorkflowCompleted + 经历 level2 → PENDING_APPROVAL', async () => {
      seedVerificationEventFlow({ lifecycle: 'IN_VERIFICATION', sumsubExperiencedLevel2: true });

      await service.handleSumsubVerificationEvent(
        { type: 'applicantWorkflowCompleted', applicantId: 'app-1' },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lifecycle: 'PENDING_APPROVAL' }),
        }),
      );
    });

    it('applicantWorkflowCompleted 未经 level2 按表走两跳落 ACTIVE', async () => {
      const customer = buildVerificationCustomer({
        lifecycle: 'IN_VERIFICATION',
        sumsubExperiencedLevel2: false,
      });
      const rows = ['IN_VERIFICATION', 'PENDING_APPROVAL'];
      prismaMock.customerMain.findUnique.mockImplementation(async () => ({
        ...customer,
        lifecycle: rows.shift() ?? 'PENDING_APPROVAL',
      }));
      prismaMock.customerMain.update.mockImplementation(async ({ data }: any) => ({
        ...customer,
        ...data,
      }));

      await service.handleSumsubVerificationEvent(
        { type: 'applicantWorkflowCompleted', applicantId: 'app-1' },
        { simulated: false, actorId: 'SUMSUB' },
      );

      const written = prismaMock.customerMain.update.mock.calls.map(([arg]: any) => arg.data.lifecycle);
      expect(written).toEqual(['PENDING_APPROVAL', 'ACTIVE']);
    });

    it('applicantWorkflowFailed → REJECTED', async () => {
      seedVerificationEventFlow({ lifecycle: 'IN_VERIFICATION' });

      await service.handleSumsubVerificationEvent(
        { type: 'applicantWorkflowFailed', applicantId: 'app-1' },
        { simulated: false, actorId: 'SUMSUB' },
      );

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lifecycle: 'REJECTED' }) }),
      );
    });

    it('终态客户（ACTIVE/REJECTED/WITHDRAWN/OFFBOARDED）直接忽略事件，不落库', async () => {
      for (const lifecycle of ['ACTIVE', 'REJECTED', 'WITHDRAWN', 'OFFBOARDED']) {
        jest.clearAllMocks();
        prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
        seedVerificationEventFlow({ lifecycle });

        const result = await service.handleSumsubVerificationEvent(
          { type: 'applicantPending', applicantId: 'app-1' },
          { simulated: false, actorId: 'SUMSUB' },
        );

        expect(result.customer.lifecycle).toBe(lifecycle);
        expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
      }
    });

    it('startVerification 在 REJECTED 上走 REAPPLY 回 IN_VERIFICATION', async () => {
      const customer = buildVerificationCustomer({
        lifecycle: 'REJECTED',
        verificationCanContinue: false,
      });
      prismaMock.customerMain.findUnique.mockResolvedValue(customer);
      prismaMock.customerMain.update.mockImplementation(async ({ data }: any) => ({
        ...customer,
        ...data,
      }));
      sumsubClientMock.getApplicantByExternalUserId.mockResolvedValue({ id: 'app-1' });
      sumsubClientMock.createSdkToken.mockResolvedValue({ token: 'tok-1' });

      const result = await service.startVerification('c1');

      expect(prismaMock.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lifecycle: 'IN_VERIFICATION' }) }),
      );
      expect(result.customer).toEqual({ lifecycle: 'IN_VERIFICATION' });
    });
  });
```

- [ ] **Step 8: 跑它，确认失败**

```bash
npx jest src/modules/identity/onboarding/onboarding.service.spec.ts -t "advanceLifecycle 九边闸门"
```

期望：7 个用例全红，首条错误形如 `expect(jest.fn()).toHaveBeenCalledWith(...)` 且 `Received: {"data": {"onboardingStatus": "PENDING_VERIFICATION", "adminStatus": "INACTIVE", ...}}`（旧三轴仍在写）。

- [ ] **Step 9: onboarding.service.ts — 换 import、类型、select、删遗留值集合**

L18-33 整段替换为：

```ts
import {
  CustomerNextStepActionType,
  CustomerLifecycleSource,
  getCustomerBlockedReason,
  getCustomerNextStepActionTypes,
  readLifecycle,
  resolveLifecycleTransition,
} from '../customer-lifecycle.util';
import type {
  CustomerLifecycle,
  CustomerLifecycleAction,
} from '../constants/customer-lifecycle.constant';
```

L60-66 替换为（删 `LegacyCompatibleOnboardingStatus`）：

```ts
export type OnboardingActionType = CustomerNextStepActionType;
```

L105-121 两个 select 替换为（`customerAutoExpireSelect` 整删）：

```ts
const tradingEligibilitySelect = {
  id: true,
  customerNo: true,
  lifecycle: true,
  restrictions: true,
} satisfies Prisma.CustomerMainSelect;
```

L137-154 两个遗留值 Set 整删（`recognizedRawOnboardingStatuses`、`legacyRawVerificationStatuses`），`private readonly logger = new Logger(OnboardingService.name);` 之后直接接 `constructor(`。

同步改 `src/modules/identity/onboarding/dto/onboarding.dto.ts` L17-21：

```ts
import type { CustomerLifecycle } from '../../constants/customer-lifecycle.constant';
```

同文件 L210-214：

```ts
export interface StartVerificationCustomerSnapshotDto {
  lifecycle: CustomerLifecycle;
}
```

- [ ] **Step 10: onboarding.service.ts — 事件处理器返回类型、终态守卫、switch 落库（写入点 #1–#10）**

L166-173 返回类型替换为：

```ts
  ): Promise<{
    customer: {
      lifecycle: string;
    };
    verification: VerificationProjection;
  }> {
```

L205-223 终态守卫替换为：

```ts
      const currentLifecycle = readLifecycle(customer);
      if (currentLifecycle !== 'PROSPECT' && currentLifecycle !== 'IN_VERIFICATION') {
        this.logger.warn(
          `Ignoring Sumsub verification event ${eventType} for terminal lifecycle ${currentLifecycle}.`,
        );
        return {
          customer: { lifecycle: currentLifecycle },
          verification: this.buildVerificationProjection(customer),
        };
      }
```

L250-394（`switch (eventType)` 开头到 `const updatedCustomer = await tx.customerMain.update({...})` 结束）整段替换为：

```ts
      let lifecycleAction: CustomerLifecycleAction;
      // 九边表没有 IN_VERIFICATION → ACTIVE 的直达边。未经 level2 的
      // applicantWorkflowCompleted 今天是「自动批准」，按表拆成两跳
      // （VERIFICATION_PASSED → FINAL_APPROVED），落地结果与今天一致。
      let autoApproveWithoutFinalReview = false;

      switch (eventType) {
        case 'applicantPending':
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'SUBMITTED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
          };
          break;
        case 'applicantOnHold':
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'UNDER_REVIEW',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
          };
          break;
        case 'applicantLevelChanged':
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'NEXT_LEVEL_REQUIRED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: true,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          break;
        case 'applicantReviewed':
          lifecycleAction = 'START_VERIFICATION';
          if (reviewResult.reviewAnswer === 'RED' && reviewResult.reviewRejectType === 'RETRY') {
            updateData = {
              ...updateData,
              verificationSubstatus: 'RESUBMIT_REQUIRED',
              verificationCustomerActionRequired: true,
              verificationCanContinue: true,
              sumsubExperiencedLevel2: experiencedLevel2,
            };
          } else {
            updateData = {
              ...updateData,
              verificationSubstatus: 'UNDER_REVIEW',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: experiencedLevel2,
            };
          }
          break;
        case 'applicantWorkflowCompleted':
          if (experiencedLevel2) {
            lifecycleAction = 'VERIFICATION_PASSED';
            const pendingApproval =
              await this.onboardingFinalApprovalService.ensurePendingApprovalInTransaction(tx, {
                customer: {
                  ...customer,
                  lifecycle: 'PENDING_APPROVAL',
                },
                actorId,
                actorRole,
                reason: `Sumsub workflow completed via ${eventType}`,
              });
            updateData = {
              ...updateData,
              ...this.buildLatestRiskApprovalBindingPatch(pendingApproval.approval.id),
              latestRiskApprovalStatus: pendingApproval.approval.status || 'PENDING',
              verificationSubstatus: 'COMPLETED',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: true,
            };
          } else {
            lifecycleAction = 'FINAL_APPROVED';
            autoApproveWithoutFinalReview = true;
            updateData = {
              ...updateData,
              ...this.buildLatestRiskApprovalBindingPatch(null),
              latestRiskApprovalStatus: null,
              verificationSubstatus: 'COMPLETED',
              verificationCustomerActionRequired: false,
              verificationCanContinue: false,
              sumsubExperiencedLevel2: false,
              // Write-once: lock the NEW_CUSTOMER window start on first ACTIVE;
              // a later re-approval must not reset it.
              onboardingApprovedAt: customer.onboardingApprovedAt ?? now,
            };
          }
          break;
        case 'applicantWorkflowFailed':
          lifecycleAction = 'VERIFICATION_REJECTED';
          updateData = {
            ...updateData,
            ...this.buildLatestRiskApprovalBindingPatch(null),
            latestRiskApprovalStatus: null,
            verificationSubstatus: 'FAILED',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          break;
        default:
          lifecycleAction = 'START_VERIFICATION';
          updateData = {
            ...updateData,
            verificationSubstatus: 'PROCESSING',
            verificationCustomerActionRequired: false,
            verificationCanContinue: false,
            sumsubExperiencedLevel2: experiencedLevel2,
          };
          this.logger.warn(`Unhandled Sumsub verification event ${eventType}; marking as PROCESSING.`);
          break;
      }

      if (autoApproveWithoutFinalReview) {
        await this.advanceLifecycle(customer.id, 'VERIFICATION_PASSED', tx);
      }

      const updatedCustomer = await this.advanceLifecycle(
        customer.id,
        lifecycleAction,
        tx,
        updateData,
      );
```

L398-407 的审计捕获里 L400 改名：

```ts
        beforeLifecycle: currentLifecycle,
```

同步改 L184-193 `TxAuditCapture` 类型里的 `beforeOnboardingStatus: string | null;` → `beforeLifecycle: string;`。

L409-416 最终 return 替换为：

```ts
      return {
        customer: { lifecycle: readLifecycle(updatedCustomer) },
        verification: this.buildVerificationProjection(updatedCustomer),
      };
```

L435-438 审计入参替换为：

```ts
        lifecycleFrom: auditCapture.beforeLifecycle,
        lifecycleTo: this.normalizeOptionalString(auditCapture.updatedCustomer.lifecycle),
```

L832-833 `writeSumsubAudit` 入参声明替换为（这两个字段在函数体内从未被读，纯改名对齐）：

```ts
    lifecycleFrom: string | null;
    lifecycleTo: string | null;
```

- [ ] **Step 11: onboarding.service.ts — 私有 helper 区换血（写入点 #11 的删除在此完成）**

L605-680（`getCanonicalState` 到私有 `buildCustomerLifecyclePatch` 结束）整段替换为：

```ts
  private resolveEddRequiredForState(
    customer: {
      eddRequired?: boolean | null;
    },
    lifecycle: CustomerLifecycle,
  ): boolean {
    switch (lifecycle) {
      case 'PROSPECT':
        return false;
      case 'PENDING_APPROVAL':
        return true;
      case 'IN_VERIFICATION':
      case 'ACTIVE':
      case 'REJECTED':
      case 'WITHDRAWN':
      case 'OFFBOARDED':
        return !!customer.eddRequired;
    }
  }

  /**
   * lifecycle 唯一落库口。任何写 lifecycle 的地方都必须经过这里，九边迁移表
   * 才真正生效（裸写字符串等于没有状态机）。
   * - 动作目标态 == 当前态 → 幂等重放，只写 extra，不动 lifecycle
   * - 非法边 → resolveLifecycleTransition 抛 BadRequestException，事务回滚
   * 这里不写审计：调用方（writeAudit / writeSumsubAudit / 上层 workflow）已各自
   * 记录 fromStage/toStage，在此再写一条会产生重复审计行。
   */
  private async advanceLifecycle(
    customerId: string,
    action: CustomerLifecycleAction,
    tx?: Prisma.TransactionClient,
    extra: Prisma.CustomerMainUpdateInput = {},
  ) {
    const client = tx ?? this.prisma;
    const current = await client.customerMain.findUnique({
      where: { id: customerId },
      select: { lifecycle: true },
    });
    if (!current) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const to = resolveLifecycleTransition(readLifecycle(current), action);

    return client.customerMain.update({
      where: { id: customerId },
      data: to ? { ...extra, lifecycle: to } : extra,
    });
  }
```

L704-741（`mapActionsByStatus` / `buildBlockedReason` / `buildNextStep`）整段替换为：

```ts
  private mapActionsByStatus(customer: CustomerLifecycleSource): OnboardingAction[] {
    return getCustomerNextStepActionTypes(customer).map((type) => ({ type }));
  }

  private async buildNextStep(customer: any): Promise<NextStepPayload> {
    return {
      actions: this.mapActionsByStatus(customer),
      blockedReason: getCustomerBlockedReason(customer),
      activeCaseId: null,
      requiresEdd: this.resolveEddRequiredForState(customer, readLifecycle(customer)),
      verification: this.buildVerificationProjection(customer),
    };
  }
```

L936-965 `autoExpireIfNeeded()` 整个方法删除（写入点 #11）；随之删除 L1046、L1249、L1314、L1367 四行 `await this.autoExpireIfNeeded(customerId);`。材料过期不再动轴，改由 `MATERIAL_EXPIRED` 便签承接（限制账 Task）。

- [ ] **Step 12: onboarding.service.ts — 读侧投影与 startVerification（写入点 #12）**

L1045-1075 替换为：

```ts
  async getMyOnboarding(customerId: string) {
    const customer = await this.getCustomerOrThrow(customerId, true);
    const nextStep = await this.buildNextStep(customer);

    return {
      ...this.omitCustomerInternalOnlyFields(customer),
      actions: nextStep.actions,
      blockedReason: nextStep.blockedReason,
      activeCaseId: nextStep.activeCaseId,
      requiresEdd: nextStep.requiresEdd,
      verification: nextStep.verification,
    };
  }

  private buildCustomerSnapshot(customer: {
    lifecycle?: string | null;
  }): StartVerificationCustomerSnapshotDto {
    return { lifecycle: readLifecycle(customer) };
  }
```

L1081-1123（`startVerification` 的守卫段）替换为：

```ts
    const currentLifecycle = readLifecycle(customer);

    if (
      currentLifecycle !== 'PROSPECT' &&
      currentLifecycle !== 'IN_VERIFICATION' &&
      currentLifecycle !== 'REJECTED' &&
      currentLifecycle !== 'WITHDRAWN'
    ) {
      throw new BadRequestException(
        `Current status ${currentLifecycle} does not allow starting verification.`,
      );
    }

    if (currentLifecycle === 'IN_VERIFICATION' && customer.verificationCanContinue !== true) {
      throw new BadRequestException(
        'Current status IN_VERIFICATION does not allow starting verification.',
      );
    }

    if (
      currentLifecycle === 'IN_VERIFICATION' &&
      customer.verificationProvider &&
      customer.verificationProvider !== 'SUMSUB'
    ) {
      throw new BadRequestException(
        'Current status IN_VERIFICATION does not allow starting verification.',
      );
    }

    const isReinitiating = currentLifecycle === 'REJECTED' || currentLifecycle === 'WITHDRAWN';
    const lifecycleAction: CustomerLifecycleAction = isReinitiating
      ? 'REAPPLY'
      : 'START_VERIFICATION';
    const levelName = String(customer.sumsubCurrentLevelName || '').trim() || 'wave3-level-1';
```

L1145-1160 的 `updateData` 替换为（去掉 lifecycle patch，四处 `PENDING_VERIFICATION` 判断改 `IN_VERIFICATION`）：

```ts
    const updateData: Prisma.CustomerMainUpdateInput = {
      ...(customer.onboardingTraceId ? {} : { onboardingTraceId: randomUUID() }),
      ...(currentLifecycle === 'IN_VERIFICATION' && !customer.verificationProvider
        ? { verificationProvider: 'SUMSUB' }
        : {}),
      ...(currentLifecycle === 'IN_VERIFICATION' && !customer.sumsubCurrentLevelName
        ? { sumsubCurrentLevelName: levelName }
        : {}),
      ...(currentLifecycle === 'IN_VERIFICATION' && !customer.sumsubApplicantId
        ? { sumsubApplicantId: applicantId }
        : {}),
    };

    if (currentLifecycle !== 'IN_VERIFICATION') {
```

L1184-1187 落库替换为：

```ts
    const updated = await this.advanceLifecycle(
      customerId,
      lifecycleAction,
      undefined,
      updateData,
    );
```

L1218 守卫替换为：

```ts
    if (readLifecycle(customer) !== 'IN_VERIFICATION') {
      throw new BadRequestException(
        'mock-submit requires customer to be in IN_VERIFICATION state.',
      );
    }
```

L1261-1273 `upsertEntity` 落库替换为（自写回 patch 在单轴下是纯 no-op，删）：

```ts
    const updated = await this.prisma.customerMain.update({
      where: { id: customerId },
      data: {
        customerType: 'INDIVIDUAL',
        companyName: null,
      },
    });
```

L1292-1293、L1306、L1322-1323 四处审计 stage 取值改为 `readLifecycle(customer)` / `readLifecycle(updated)`。

L1366-1422 `assertTradingEligibility` 替换为（第二段重复的 FROZEN 判断随列消失，restrictions JSON 分支留给读侧收口 Task 换成 `CustomerAccessService`）：

```ts
  async assertTradingEligibility(customerId: string, action: TradeAction) {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: tradingEligibilitySelect,
    });

    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const lifecycle = readLifecycle(customer);
    if (lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({
        message: `${action} is blocked by onboarding gate`,
        customerId,
        customerNo: customer.customerNo,
        lifecycle,
      });
    }

    const restrictions = this.parseJsonArraySafely<{ capability?: string }>(
      customer.restrictions,
    );
    if (restrictions.some((r) => r.capability === action || r.capability === 'ALL')) {
      throw new ForbiddenException({
        code: 'CAPABILITY_RESTRICTED',
        message: `${action} is currently restricted`,
        customerId,
        customerNo: customer.customerNo,
      });
    }

    if (action !== 'DEPOSIT') {
      await this.assertTradingReady(customerId);
    }
  }
```

L1438-1455 `recomputeComplianceSnapshot` 替换为：

```ts
  async recomputeComplianceSnapshot(customerId: string, _journeyId?: string) {
    const customer = await this.getCustomerOrThrow(customerId);
    const eddRequired = this.resolveEddRequiredForState(customer, readLifecycle(customer));

    return this.prisma.customerMain.update({
      where: { id: customerId },
      data: { eddRequired },
    });
  }
```

- [ ] **Step 13: 跑新测试，确认转绿**

```bash
npx jest src/modules/identity/onboarding/onboarding.service.spec.ts -t "advanceLifecycle 九边闸门"
```

期望：`Tests: 7 passed`（其余用例被 `-t` 过滤为 skipped）。

- [ ] **Step 14: 机械迁移旧 spec 的三轴夹具**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
F=src/modules/identity/onboarding/onboarding.service.spec.ts
perl -0pi -e "s/^[ \t]*adminStatus: '(?:ACTIVE|INACTIVE)',\n//mg; s/^[ \t]*complianceStatus: '(?:CLEAR|FROZEN)',\n//mg; s/^[ \t]*expect\(result\.customer\.adminStatus\)\.toBe\('(?:ACTIVE|INACTIVE)'\);\n//mg" \$F
perl -pi -e "s/onboardingStatus: 'PENDING_VERIFICATION'/lifecycle: 'IN_VERIFICATION'/g; s/onboardingStatus: 'APPROVED'/lifecycle: 'ACTIVE'/g; s/onboardingStatus: 'FINAL_APPROVAL'/lifecycle: 'PENDING_APPROVAL'/g; s/onboardingStatus: 'NONE'/lifecycle: 'PROSPECT'/g; s/onboardingStatus: 'REJECTED'/lifecycle: 'REJECTED'/g" \$F
perl -pi -e "s/\.customer\.onboardingStatus\)\.toBe\('PENDING_VERIFICATION'\)/.customer.lifecycle).toBe('IN_VERIFICATION')/g; s/\.customer\.onboardingStatus\)\.toBe\('APPROVED'\)/.customer.lifecycle).toBe('ACTIVE')/g; s/\.customer\.onboardingStatus\)\.toBe\('REJECTED'\)/.customer.lifecycle).toBe('REJECTED')/g; s/\.customer\.onboardingStatus\)\.toBe\('FINAL_APPROVAL'\)/.customer.lifecycle).toBe('PENDING_APPROVAL')/g; s/updateData\.onboardingStatus\)\.toBe\('PENDING_VERIFICATION'\)/updateData.lifecycle).toBe('IN_VERIFICATION')/g" \$F
grep -n "onboardingStatus\|adminStatus\|complianceStatus" \$F
```

最后一条 grep 期望只剩这些残留（下一步逐个处理）：`'PENDING_CDD_INPUT'` ×7、`'CDD_UNDER_REVIEW'` ×4、`'SOMETHING_UNKNOWN'` ×3、`onboardingStatus: status,` ×1、`adminStatus: status === 'APPROVED' ? 'ACTIVE' : 'INACTIVE',` ×1、`expect(result.onboardingStatus).toBe('NONE');` ×1。

- [ ] **Step 15: 删遗留语义用例、改剩余三处夹具**

删除下列 8 个用例整块（它们测的是本轮删掉的遗留值机器与 autoExpire 降级）：

1. `it('should derive REVIEW_CDD next step from canonical onboarding status', ...)`（原 L759-774）
2. `it('should return WAIT_REVIEW action when canonical onboarding is CDD_UNDER_REVIEW', ...)`（原 L776-792）
3. `it.each(['PENDING_CDD_INPUT', 'CDD_UNDER_REVIEW', 'PENDING_EDD_INPUT', 'EDD_UNDER_REVIEW'] as const)(...)`（原 L828-843）
4. `it('should reject verification start when raw onboarding status is unknown', ...)`（原 L845-859）
5. `it('should fail closed on next-step projection when raw onboarding status is unknown', ...)`（原 L861-875）
6. `it('should fail closed on onboarding projection when raw onboarding status is unknown', ...)`（原 L877-891）
7. `it('should auto-expire ACTIVE customer to PENDING_CDD when cddDocumentExpiresAt passed', ...)`（原 L1461-1498）
8. `it('should auto-expire and block DEPOSIT trading when canonical CDD is expired', ...)`（原 L1500-1528）

改写剩余三处：

`it('should block trading when canonical onboarding is not approved active', ...)`（原 L704-717）里 `onboardingStatus: 'CDD_UNDER_REVIEW'` → `lifecycle: 'IN_VERIFICATION'`，并删掉同对象里的 `complianceFreezeCaseId: null,`。

`it('writes a DATA_UPDATE audit row with ADMIN actorType for a simulated event', ...)`（原 L540 附近）与 `it('upsertEntity 响应体同样不得包含 hardLineDispositionedAt / passwordHash…', ...)`（原 L916 附近）里的 `onboardingStatus: 'PENDING_CDD_INPUT'` / `'CDD_UNDER_REVIEW'` 一律 → `lifecycle: 'IN_VERIFICATION'`。

`it.each(['APPROVED', 'FINAL_APPROVAL'] as const)(...)`（原 L811-826）替换为：

```ts
  it.each(['ACTIVE', 'PENDING_APPROVAL'] as const)(
    'should reject verification start while lifecycle is %s',
    async (lifecycle) => {
      prismaMock.customerMain.findUnique.mockResolvedValue({
        id: 'c1',
        customerType: 'INDIVIDUAL',
        lifecycle,
      });

      await expect(service.startVerification('c1')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    },
  );
```

`it('should recompute NONE status into baseline canonical snapshot', ...)`（原 L1530-1557）替换为：

```ts
  it('recomputeComplianceSnapshot 只重算 eddRequired，不动 lifecycle', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      lifecycle: 'PROSPECT',
      eddRequired: true,
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      lifecycle: 'PROSPECT',
      eddRequired: false,
    });

    const result = await service.recomputeComplianceSnapshot('c1', 'ONB-1');

    expect(prismaMock.customerMain.update).toHaveBeenCalledWith({
      where: { id: 'c1' },
      data: { eddRequired: false },
    });
    expect(result.lifecycle).toBe('PROSPECT');
  });
```

- [ ] **Step 16: 跑整个 onboarding.service.spec，必须全绿**

```bash
npx jest src/modules/identity/onboarding/onboarding.service.spec.ts
```

期望：`Test Suites: 1 passed`，`Tests: 0 failed`，且输出里不再出现 `onboardingStatus`。

- [ ] **Step 17: commit onboarding 主体**

```bash
git add src/modules/identity/onboarding/onboarding.service.ts src/modules/identity/onboarding/onboarding.service.spec.ts src/modules/identity/onboarding/dto/onboarding.dto.ts
git commit -m "feat(onboarding): 12 个 onboarding 写入点经 advanceLifecycle 落 lifecycle 单轴"
```

- [ ] **Step 18: 终审服务改夹具（失败测试先行，写入点 #13/#14）**

`src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
G=src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
perl -0pi -e "s/^[ \t]*adminStatus: '(?:ACTIVE|INACTIVE)',\n//mg; s/^[ \t]*complianceStatus: '(?:CLEAR|FROZEN)',\n//mg" \$G
perl -pi -e "s/onboardingStatus: 'FINAL_APPROVAL'/lifecycle: 'PENDING_APPROVAL'/g; s/onboardingStatus: 'APPROVED'/lifecycle: 'ACTIVE'/g; s/onboardingStatus: 'EDD_UNDER_REVIEW'/lifecycle: 'IN_VERIFICATION'/g" \$G
npx jest src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
```

期望失败：断言 `data: { lifecycle: 'ACTIVE' }` 而 `Received` 仍是 `onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE'`。

- [ ] **Step 19: 改 `onboarding-final-approval.service.ts`，跑通过**

L21 替换为：

```ts
import { buildLifecycleTransitionPatch, readLifecycle } from '../customer-lifecycle.util';
```

L34-44 `FinalApprovalCustomerRow` 的 L37-39 三行替换为：

```ts
  lifecycle?: string | null;
```

L58-68 select 的 L61-63 三行替换为：

```ts
  lifecycle: true,
```

L130-136 替换为：

```ts
  private assertCustomerInFinalApproval(customer: FinalApprovalCustomerRow) {
    if (readLifecycle(customer) !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        'Final approval is only available while customer is in PENDING_APPROVAL.',
      );
    }
  }
```

L458-494 `buildLifecycleProjection` 替换为：

```ts
  private buildLifecycleProjection(
    customer: FinalApprovalCustomerRow,
    event: ApprovalDecisionEvent,
  ): Prisma.CustomerMainUpdateInput {
    const status = String(event.status || '').trim().toUpperCase();
    const from = readLifecycle(customer);

    if (status === ApprovalStatuses.APPROVED) {
      return {
        ...buildLifecycleTransitionPatch(from, 'FINAL_APPROVED'),
        eddRequired: true,
        ...this.buildLatestRiskApprovalBindingPatch(event.approvalId),
        latestRiskApprovalStatus: ApprovalStatuses.APPROVED,
        // Write-once: lock the NEW_CUSTOMER window start on first ACTIVE;
        // a later re-approval must not reset it.
        onboardingApprovedAt: customer.onboardingApprovedAt ?? new Date(),
      };
    }

    if (status === ApprovalStatuses.REJECTED) {
      return {
        ...buildLifecycleTransitionPatch(from, 'FINAL_REJECTED'),
        eddRequired: true,
        ...this.buildLatestRiskApprovalBindingPatch(event.approvalId),
        latestRiskApprovalStatus: ApprovalStatuses.REJECTED,
      };
    }

    return {
      ...this.buildLatestRiskApprovalBindingPatch(event.approvalId),
      latestRiskApprovalStatus: status,
    };
  }
```

L514-520 的审计 stage 字面量同步改为 `fromStage: 'PENDING_APPROVAL'`、`'FINAL_APPROVAL_APPROVED' ? 'ACTIVE' : 'REJECTED' : 'PENDING_APPROVAL'`。

```bash
npx jest src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
```

期望：`Test Suites: 1 passed`。

- [ ] **Step 20: commit 终审投影**

```bash
git add src/modules/identity/onboarding/onboarding-final-approval.service.ts src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts
git commit -m "feat(onboarding): 终审 APPROVED/REJECTED 投影改经九边迁移表落 lifecycle"
```

- [ ] **Step 21: 客户列表筛选（失败测试先行，写入点 #15/#16）**

`src/modules/identity/customers/customers.controller.spec.ts` L34-163（`should map legacy ACTIVE filter…` 到 `should accept canonical onboarding status directly` 结束）整段替换为：

```ts
  it('ACTIVE 筛选直接命中 lifecycle', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, 'ACTIVE');

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([expect.objectContaining({ lifecycle: 'ACTIVE' })]),
        }),
      }),
    );
  });

  it('PENDING_APPROVAL 筛选直接命中 lifecycle', () => {
    controller.findAll(
      { user: { type: 'ADMIN' } },
      undefined,
      undefined,
      undefined,
      'pending_approval',
    );

    expect(customersServiceMock.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          AND: expect.arrayContaining([expect.objectContaining({ lifecycle: 'PENDING_APPROVAL' })]),
        }),
      }),
    );
  });

  it('空 status 不追加任何筛选条件', () => {
    controller.findAll({ user: { type: 'ADMIN' } }, undefined, undefined, undefined, '  ');

    const [[arg]] = customersServiceMock.findAll.mock.calls;
    expect(arg.where.AND).toBeUndefined();
  });
```

```bash
npx jest src/modules/identity/customers/customers.controller.spec.ts
```

期望失败：`Received` 里是 `{ onboardingStatus: 'APPROVED', adminStatus: 'ACTIVE' }`。

- [ ] **Step 22: 改 `customers.controller.ts` 与 CRA cron（写入点 #15/#16/#17），跑通过**

`src/modules/identity/customers/customers.controller.ts` L26-57 整段替换为：

```ts
const buildCustomerStatusWhere = (status?: string): Prisma.CustomerMainWhereInput | null => {
  const normalized = String(status || '').trim().toUpperCase();
  if (!normalized) {
    return null;
  }

  return { lifecycle: normalized };
};
```

`src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.ts` L25 替换为：

```ts
        lifecycle: 'ACTIVE',
```

```bash
npx jest src/modules/identity/customers/customers.controller.spec.ts
```

期望：`Tests: 4 passed`（含原有 `should be defined`）。

- [ ] **Step 23: 类型闸 + 本 Task 触及文件的回归**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx tsc --noEmit 2>&1 | grep -E "onboarding|customer-lifecycle|customer-status|customers\.controller|client-risk-assessment-cron|tb-manual-account"
```

期望：**零输出**（其余文件的 `onboardingStatus/adminStatus/complianceStatus` 报错属读侧收口 Task 与 Task 7 的份额，本 Task 不清）。

```bash
npx jest src/modules/identity src/modules/accounting/tigerbeetle 2>&1 | tail -20
```

期望：`customer-lifecycle.util.spec.ts` / `onboarding.service.spec.ts` / `onboarding-final-approval.service.spec.ts` / `customers.controller.spec.ts` / `tb-manual-account` 相关套件全 `passed`；其它套件的失败必须与迁移前基线逐条一致（迁移前先跑一次同命令留底比对，净新增 0）。

- [ ] **Step 24: commit 收尾**

```bash
git add src/modules/identity/customers/customers.controller.ts src/modules/identity/customers/customers.controller.spec.ts src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.ts
git commit -m "feat(identity): 客户列表筛选与 CRA 季度 cron 改读 lifecycle，删遗留状态别名映射"
```

---

### Task 3: 原因注册表 + `CustomerRestrictionsService` 重写

**前置**：Task 1 已落地（`CustomerRestriction` model 进 `prisma/schema.prisma` + 迁移 + `npx prisma generate` 跑过）。本 Task 的 `tx.customerRestriction` 委托与 `import type { CustomerRestriction } from '@prisma/client'` 依赖那次 generate；没跑过则第一步就报 `Property 'customerRestriction' does not exist on type 'PrismaService'`。

**Files:**

- Create: `src/modules/identity/customers/constants/restriction-cause.constant.ts`
- Modify: `src/modules/identity/customers/customer-restrictions.service.ts`（1-118 整体重写；旧 `RestrictableCapability` / `CustomerRestriction` 接口 / `add` / `clear` / `list` / `parse` 全删，全仓无外部导入这两个类型，已 grep 确认）
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts`（16-20，`enum AuditResult` 增一个成员 `SKIPPED`——设计稿 §3.2 要求幂等命中记 `result: SKIPPED`，现有枚举只有 SUCCESS/FAILED/REJECTED）
- Test: `src/modules/identity/customers/customer-restrictions.service.spec.ts`（1-85 整体重写；旧三个用例测的是 `add`/`clear` 的 JSON 列写法，随旧 API 一起删）
- 不改：`src/modules/identity/customers/customers.module.ts`（`CustomerRestrictionsService` 已在 `providers`(:15) 与 `exports`(:17)，构造函数签名不变，DI 无需动）

**Interfaces:**

Consumes（均已存在，行号为真实位置）：
```ts
// src/core/prisma/prisma.service.ts:5
class PrismaService extends PrismaClient {}
// src/modules/audit-logging/audit-logs.service.ts:1307
recordSystem(input: CreateAuditLogEventDto, client?: AuditWriteClient): Promise<...>
// src/modules/audit-logging/constants/audit-actions.constant.ts:490,491,494,495 / :74
AuditActions.CUSTOMER_FROZEN | CUSTOMER_UNFROZEN | CUSTOMER_RESTRICTION_ADDED | CUSTOMER_RESTRICTION_CLEARED
AuditEntityTypes.CUSTOMER
// src/common/utils/no-generator.util.ts:3
generateReferenceNo(prefix: string): string
// Task 1 建的 prisma 委托
prisma.customerRestriction.{findFirst,findMany,createMany,updateMany}
```

Produces：
```ts
// constants/restriction-cause.constant.ts
export type RestrictionScope = 'ALL' | 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
export type RestrictionCause = 'SANCTION' | 'ADMIN_SUSPENSION' | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING' | 'KYT_REJECTED_SOFT' | 'KYT_REJECTED_HARD' | 'PENDING_DOCUMENT';
export type RestrictionVisibility = 'SILENT' | 'DISCLOSED';
export type RestrictionReleasePolicy = 'MLRO_APPROVAL' | 'OPS_APPROVAL';
export interface RestrictionCausePolicy {
  defaultScopes: RestrictionScope[]; visibility: RestrictionVisibility;
  releasePolicy: RestrictionReleasePolicy; scopeSelectable: boolean; customerLabel: string;
}
export const RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy>;

// customer-restrictions.service.ts
export interface OpenRestrictionInput {
  customerId: string; cause: RestrictionCause; scopes?: RestrictionScope[];
  reason: string; caseRef?: string | null; openedBy: string;
}
export interface RestrictionRow {
  restrictionNo: string; customerId: string; scopes: RestrictionScope[];
  cause: RestrictionCause; visibility: RestrictionVisibility; releasePolicy: RestrictionReleasePolicy;
  status: 'OPEN' | 'RELEASED'; reason: string; caseRef: string | null;
  releaseOrderRef: string | null; openedAt: Date; openedBy: string;
  releasedAt: Date | null; releasedBy: string | null;
  releaseApprovalNo: string | null; releaseMode: 'AUTO' | 'MANUAL' | null; traceId: string;
}
class CustomerRestrictionsService {
  open(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }>;
  release(restrictionNo: string, opts: { releasedBy: string; releaseMode: 'AUTO' | 'MANUAL';
    releaseApprovalNo?: string; releaseOrderRef?: string }): Promise<void>;
  findByNo(restrictionNo: string): Promise<RestrictionRow | null>;
  listOpen(customerId: string): Promise<RestrictionRow[]>;
  listAll(customerId: string): Promise<RestrictionRow[]>;
  findOpenByCause(customerId: string, cause: RestrictionCause, caseRef: string | null): Promise<RestrictionRow | null>;
}
// dto/audit-log.dto.ts
enum AuditResult { SUCCESS, FAILED, REJECTED, SKIPPED }
```

---

- [ ] **Step 1: 确认前置与基线**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
grep -n "model CustomerRestriction" -A 4 prisma/schema.prisma
node -e "const {PrismaClient}=require('@prisma/client');console.log(!!new PrismaClient().customerRestriction)"
```
期望：schema 打印出 `model CustomerRestriction {` 起 4 行；node 打印 `true`。打印 `false` 或报错 = Task 1 的 `npx prisma generate` 没跑，先补跑再继续。

- [ ] **Step 2 (RED): 用「注册表逐字」这一个用例整体替换旧 spec**

整体覆盖 `src/modules/identity/customers/customer-restrictions.service.spec.ts`：

```ts
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
} from './constants/restriction-cause.constant';

describe('RESTRICTION_CAUSE_POLICY', () => {
  it('七条 cause 的 defaultScopes / visibility / releasePolicy / scopeSelectable / customerLabel 逐字固定（防漂移）', () => {
    expect(RESTRICTION_CAUSE_POLICY).toEqual({
      SANCTION: {
        defaultScopes: ['ALL'],
        visibility: 'SILENT',
        releasePolicy: 'MLRO_APPROVAL',
        scopeSelectable: false,
        customerLabel: '',
      },
      ADMIN_SUSPENSION: {
        defaultScopes: ['ALL'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Account suspended',
      },
      MATERIAL_EXPIRED: {
        defaultScopes: ['WITHDRAW', 'SWAP'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Document expired',
      },
      TIER_UPGRADE_PENDING: {
        defaultScopes: ['WITHDRAW', 'SWAP'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Additional review in progress',
      },
      KYT_REJECTED_SOFT: {
        defaultScopes: ['SWAP', 'WITHDRAW'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: false,
        customerLabel: 'Verification required',
      },
      KYT_REJECTED_HARD: {
        defaultScopes: ['SWAP', 'WITHDRAW'],
        visibility: 'SILENT',
        releasePolicy: 'MLRO_APPROVAL',
        scopeSelectable: false,
        customerLabel: '',
      },
      PENDING_DOCUMENT: {
        defaultScopes: ['WITHDRAW', 'SWAP'],
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopeSelectable: true,
        customerLabel: 'Document required',
      },
    });
  });

  it('SILENT 的 cause 一律没有 customerLabel（客户面结构性无痕）', () => {
    const causes = Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[];
    expect(causes).toHaveLength(7);
    for (const cause of causes) {
      const policy = RESTRICTION_CAUSE_POLICY[cause];
      if (policy.visibility === 'SILENT') expect(policy.customerLabel).toBe('');
      else expect(policy.customerLabel.length).toBeGreaterThan(0);
    }
  });

  it('只有 PENDING_DOCUMENT 允许运营指定 scope', () => {
    const selectable = (Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[]).filter(
      (c) => RESTRICTION_CAUSE_POLICY[c].scopeSelectable,
    );
    expect(selectable).toEqual(['PENDING_DOCUMENT']);
  });
});
```

- [ ] **Step 3 (RED 验证): 跑它，确认因缺文件而失败**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```
期望：套件整体 fail，输出含
`error TS2307: Cannot find module './constants/restriction-cause.constant' or its corresponding type declarations.`

- [ ] **Step 4 (GREEN): 建原因注册表**

新建 `src/modules/identity/customers/constants/restriction-cause.constant.ts`：

```ts
/**
 * 限制原因注册表（闭集）—— 设计稿 2026-08-15 §3.3。
 *
 * R1：visibility / releasePolicy 是 cause 的函数。运营选不了、API 不接受这两个入参；
 *     贴便签时由服务端查本表**落库**（而非每次现算），保证历史行不因本表日后改动而变义。
 * R2：scope 仅 PENDING_DOCUMENT 允许运营指定（scopeSelectable），其余一律用 defaultScopes。
 * R3：customerLabel 只服务 DISCLOSED；SILENT 恒为空串——客户面没有任何字段可承载它。
 */

export type RestrictionScope = 'ALL' | 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export type RestrictionCause =
  | 'SANCTION'
  | 'ADMIN_SUSPENSION'
  | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING'
  | 'KYT_REJECTED_SOFT'
  | 'KYT_REJECTED_HARD'
  | 'PENDING_DOCUMENT';

export type RestrictionVisibility = 'SILENT' | 'DISCLOSED';

export type RestrictionReleasePolicy = 'MLRO_APPROVAL' | 'OPS_APPROVAL';

export interface RestrictionCausePolicy {
  /** 贴便签时默认卡住的能力；一个 scope 一行，同一 restrictionNo 下多行 */
  defaultScopes: RestrictionScope[];
  visibility: RestrictionVisibility;
  /** 人工解除走哪级审批 */
  releasePolicy: RestrictionReleasePolicy;
  /** 仅 PENDING_DOCUMENT 为 true */
  scopeSelectable: boolean;
  /** DISCLOSED 给客户看的标题；SILENT 一律 '' */
  customerLabel: string;
}

export const RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy> = {
  SANCTION: {
    defaultScopes: ['ALL'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLabel: '',
  },
  ADMIN_SUSPENSION: {
    defaultScopes: ['ALL'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Account suspended',
  },
  MATERIAL_EXPIRED: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Document expired',
  },
  TIER_UPGRADE_PENDING: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Additional review in progress',
  },
  KYT_REJECTED_SOFT: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Verification required',
  },
  KYT_REJECTED_HARD: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLabel: '',
  },
  PENDING_DOCUMENT: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: true,
    customerLabel: 'Document required',
  },
};
```

- [ ] **Step 5 (GREEN 验证 + commit)**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```
期望：`Tests:       3 passed, 3 total`。

```bash
git add src/modules/identity/customers/constants/restriction-cause.constant.ts src/modules/identity/customers/customer-restrictions.service.spec.ts
git commit -m "feat(identity): 限制原因注册表 RESTRICTION_CAUSE_POLICY 七条闭集"
```

- [ ] **Step 6 (RED): 追加 `open()` 的七个用例**

在 spec 文件**末尾追加**（顶部 import 行同时改为下面这三行）：

```ts
import { NotFoundException } from '@nestjs/common';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
} from './constants/restriction-cause.constant';
```

```ts
/**
 * tx.* 是事务内 client，prisma.* 是事务外 base client。分开 mock 才能断言
 * 「幂等查 + 插入」确实同处一个事务（并发双贴的唯一防线），而不是散在事务外。
 */
function createPrismaMock() {
  const tx = {
    customerMain: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001' }),
    },
    customerRestriction: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    customerMain: { findUnique: jest.fn() },
    customerRestriction: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  return { prisma, tx };
}

function createAuditMock() {
  return { recordSystem: jest.fn().mockResolvedValue(undefined), recordByActor: jest.fn() } as any;
}

/** 取第 call 次 createMany 落库的那一批行 */
function createdRows(tx: ReturnType<typeof createPrismaMock>['tx'], call = 0): any[] {
  return tx.customerRestriction.createMany.mock.calls[call][0].data;
}

describe('CustomerRestrictionsService.open', () => {
  it('七个 cause 落库的 scope / visibility / releasePolicy 与注册表逐字一致', async () => {
    for (const cause of Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[]) {
      const { prisma, tx } = createPrismaMock();
      const svc = new CustomerRestrictionsService(prisma, createAuditMock());

      await svc.open({ customerId: 'c1', cause, reason: 'r', openedBy: 'ops@fiatx.com' });

      const policy = RESTRICTION_CAUSE_POLICY[cause];
      const rows = createdRows(tx);
      expect(rows.map((r) => r.scope)).toEqual(policy.defaultScopes);
      expect(new Set(rows.map((r) => r.restrictionNo)).size).toBe(1);
      for (const row of rows) {
        expect(row.visibility).toBe(policy.visibility);
        expect(row.releasePolicy).toBe(policy.releasePolicy);
        expect(row.status).toBe('OPEN');
        expect(row.customerId).toBe('c1');
        expect(row.openedBy).toBe('ops@fiatx.com');
        expect(row.restrictionNo).toMatch(/^RST\d{10}$/);
      }
    }
  });

  it('入参里的 visibility / releasePolicy 一律不生效（类型上不允许，运行时也被忽略）', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());

    await svc.open({
      customerId: 'c1',
      cause: 'SANCTION',
      reason: 'sanctions hit',
      openedBy: 'mlro@fiatx.com',
      ...({ visibility: 'DISCLOSED', releasePolicy: 'OPS_APPROVAL' } as any),
    });

    const [row] = createdRows(tx);
    expect(row.visibility).toBe('SILENT');
    expect(row.releasePolicy).toBe('MLRO_APPROVAL');
  });

  it('scope 只有 PENDING_DOCUMENT 接受运营指定，其余 cause 传了也用注册表默认值', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());

    await svc.open({
      customerId: 'c1',
      cause: 'MATERIAL_EXPIRED',
      scopes: ['DEPOSIT'],
      reason: 'expired',
      openedBy: 'ops@fiatx.com',
    });
    expect(createdRows(tx, 0).map((r) => r.scope)).toEqual(['WITHDRAW', 'SWAP']);

    await svc.open({
      customerId: 'c1',
      cause: 'PENDING_DOCUMENT',
      scopes: ['WITHDRAW'],
      reason: 'need bank statement',
      openedBy: 'ops@fiatx.com',
    });
    expect(createdRows(tx, 1).map((r) => r.scope)).toEqual(['WITHDRAW']);
  });

  it('幂等：同 (customerId, cause, caseRef) 二次 open → created:false、不新增行、审计记 SKIPPED', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findFirst.mockResolvedValue({
      restrictionNo: 'RST2608150001',
      traceId: 'CUSTOMER_RESTRICTION:t-1',
      scope: 'WITHDRAW',
    });
    tx.customerRestriction.findMany.mockResolvedValue([
      { restrictionNo: 'RST2608150001', scope: 'WITHDRAW' },
      { restrictionNo: 'RST2608150001', scope: 'SWAP' },
    ]);
    const svc = new CustomerRestrictionsService(prisma, audit);

    const result = await svc.open({
      customerId: 'c1',
      cause: 'MATERIAL_EXPIRED',
      reason: 'Emirates ID expired',
      caseRef: 'MRC26073100xx',
      openedBy: 'system-cron',
    });

    expect(result).toEqual({ restrictionNo: 'RST2608150001', created: false });
    expect(tx.customerRestriction.createMany).not.toHaveBeenCalled();
    expect(tx.customerRestriction.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'c1',
        cause: 'MATERIAL_EXPIRED',
        caseRef: 'MRC26073100xx',
        status: 'OPEN',
      },
    });
    expect(audit.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_RESTRICTION_ADDED',
        result: 'SKIPPED',
        metadata: expect.objectContaining({
          restrictionNo: 'RST2608150001',
          scopes: ['WITHDRAW', 'SWAP'],
        }),
      }),
    );
  });

  it('caseRef 为 null 时不去重：两次 open 产生两个不同 restrictionNo', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());
    // generateReferenceNo 的随机段固定成两个不同值，避免 1/10000 撞号导致偶发红
    const randomSpy = jest.spyOn(Math, 'random').mockReturnValueOnce(0.1111).mockReturnValueOnce(0.2222);

    const first = await svc.open({
      customerId: 'c1',
      cause: 'PENDING_DOCUMENT',
      reason: 'ID copy',
      openedBy: 'ops@fiatx.com',
    });
    const second = await svc.open({
      customerId: 'c1',
      cause: 'PENDING_DOCUMENT',
      reason: 'proof of address',
      openedBy: 'ops@fiatx.com',
    });
    randomSpy.mockRestore();

    expect(tx.customerRestriction.findFirst).not.toHaveBeenCalled();
    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.restrictionNo).not.toBe(second.restrictionNo);
    expect(tx.customerRestriction.createMany).toHaveBeenCalledTimes(2);
  });

  it('一号多行：MATERIAL_EXPIRED 落 WITHDRAW / SWAP 两行，同号同 traceId 同一事务', async () => {
    const { prisma, tx } = createPrismaMock();
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());

    const result = await svc.open({
      customerId: 'c1',
      cause: 'MATERIAL_EXPIRED',
      reason: 'Emirates ID expired 08-01',
      caseRef: 'MRC26073100xx',
      openedBy: 'system-cron',
    });

    const rows = createdRows(tx);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.scope)).toEqual(['WITHDRAW', 'SWAP']);
    expect(rows[0].restrictionNo).toBe(rows[1].restrictionNo);
    expect(rows[0].traceId).toBe(rows[1].traceId);
    expect(rows[0].caseRef).toBe('MRC26073100xx');
    expect(result).toEqual({ restrictionNo: rows[0].restrictionNo, created: true });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.customerRestriction.findFirst).not.toHaveBeenCalled();
  });

  it('SANCTION 额外写一条 CUSTOMER_FROZEN；非 SANCTION 只写 ADDED', async () => {
    const { prisma } = createPrismaMock();
    const audit = createAuditMock();
    const svc = new CustomerRestrictionsService(prisma, audit);

    await svc.open({ customerId: 'c1', cause: 'SANCTION', reason: 'CRA hit', openedBy: 'mlro@fiatx.com' });
    expect(audit.recordSystem.mock.calls.map((c: any[]) => c[0].action)).toEqual([
      'CUSTOMER_RESTRICTION_ADDED',
      'CUSTOMER_FROZEN',
    ]);

    audit.recordSystem.mockClear();
    await svc.open({ customerId: 'c1', cause: 'ADMIN_SUSPENSION', reason: 'ops hold', openedBy: 'ops@fiatx.com' });
    expect(audit.recordSystem.mock.calls.map((c: any[]) => c[0].action)).toEqual([
      'CUSTOMER_RESTRICTION_ADDED',
    ]);
  });

  it('客户不存在直接抛 NotFoundException', async () => {
    const { prisma, tx } = createPrismaMock();
    tx.customerMain.findUnique.mockResolvedValue(null);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());

    await expect(
      svc.open({ customerId: 'ghost', cause: 'SANCTION', reason: 'x', openedBy: 'ops' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 7 (RED 验证)**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```
期望：套件 fail，输出含 `error TS2339: Property 'open' does not exist on type 'CustomerRestrictionsService'.`

- [ ] **Step 8: `AuditResult` 增 `SKIPPED`**

`src/modules/audit-logging/dto/audit-log.dto.ts` 16-20，把

```ts
export enum AuditResult {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
}
```

改成

```ts
export enum AuditResult {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REJECTED = 'REJECTED',
  /** 幂等命中：动作被识别但按设计没执行（如重复贴同一张限制便签）。设计稿 §3.2 */
  SKIPPED = 'SKIPPED',
}
```

纯追加：`recordByActor`（audit-logs.service.ts:1268）把 result 原样透传，admin-web `AuditLogsPage.tsx:456-463` 的边框色是 if/else 链带空串兜底，未知 result 落到无边框分支，不炸。

- [ ] **Step 9 (GREEN): 重写 service —— 头部 + `open()`**

整体覆盖 `src/modules/identity/customers/customer-restrictions.service.ts`（旧 `add`/`clear`/`list`/`parse` 全删；事务内读改写、审计走 DI 的 `AuditLogsService` 这两个旧文件的优点原样保留）：

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { CustomerRestriction as CustomerRestrictionRecord } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { AuditActions, AuditEntityTypes } from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
  RestrictionReleasePolicy,
  RestrictionScope,
  RestrictionVisibility,
} from './constants/restriction-cause.constant';

export interface OpenRestrictionInput {
  customerId: string;
  cause: RestrictionCause;
  /** 仅 cause.scopeSelectable 为 true（PENDING_DOCUMENT）时生效，其余一律用注册表默认值 */
  scopes?: RestrictionScope[];
  reason: string;
  caseRef?: string | null;
  openedBy: string;
}

/** 一张便签的聚合视图：同 restrictionNo 的多行折成一行，scope 收进 scopes */
export interface RestrictionRow {
  restrictionNo: string;
  customerId: string;
  scopes: RestrictionScope[];
  cause: RestrictionCause;
  visibility: RestrictionVisibility;
  releasePolicy: RestrictionReleasePolicy;
  status: 'OPEN' | 'RELEASED';
  reason: string;
  caseRef: string | null;
  releaseOrderRef: string | null;
  openedAt: Date;
  openedBy: string;
  releasedAt: Date | null;
  releasedBy: string | null;
  releaseApprovalNo: string | null;
  releaseMode: 'AUTO' | 'MANUAL' | null;
  traceId: string;
}

/**
 * 限制账（customer_restrictions）的实体守卫 —— 设计稿 2026-08-15 §3.2/§3.3。
 *
 * 一行 = 一次摁住的一个能力；一张便签 = 同一个 restrictionNo 下的多行，**同贴同撕、同一事务**。
 * 本 service 只守单实体不变量（查表落 visibility/releasePolicy、幂等、同号原子撕）与审计；
 * 审批编排在 CustomerRestrictionWorkflowService，读侧收口在 CustomerAccessService。
 */
@Injectable()
export class CustomerRestrictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async open(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }> {
    const policy = RESTRICTION_CAUSE_POLICY[input.cause];
    if (!policy) throw new BadRequestException(`Unknown restriction cause: ${input.cause}`);

    const caseRef = input.caseRef ?? null;
    // R2：scope 只有 scopeSelectable 的 cause 才听运营的
    const scopes =
      policy.scopeSelectable && input.scopes && input.scopes.length > 0
        ? [...input.scopes]
        : [...policy.defaultScopes];

    // 幂等查 + 插入必须同处一个事务：分开做的话两个并发写入方（到期 cron 与 admin 手工）
    // 会各自查到空、各贴一张，(customerId, cause, caseRef) 就不再是「最多一条 OPEN」。
    const outcome = await this.prisma.$transaction(async (tx) => {
      const customer = await tx.customerMain.findUnique({
        where: { id: input.customerId },
        select: { id: true, customerNo: true },
      });
      if (!customer) throw new NotFoundException(`Customer not found: ${input.customerId}`);

      // caseRef 为 null 的手工便签不去重 —— 运营可对同一客户开多张 PENDING_DOCUMENT，各要一份材料
      if (caseRef !== null) {
        const existing = await tx.customerRestriction.findFirst({
          where: { customerId: input.customerId, cause: input.cause, caseRef, status: 'OPEN' },
        });
        if (existing) {
          const siblings = await tx.customerRestriction.findMany({
            where: { restrictionNo: existing.restrictionNo },
            orderBy: { scope: 'asc' },
          });
          return {
            customerNo: customer.customerNo,
            restrictionNo: existing.restrictionNo,
            traceId: existing.traceId,
            scopes: siblings.map((row) => row.scope as RestrictionScope),
            created: false,
          };
        }
      }

      const restrictionNo = generateReferenceNo('RST');
      const traceId = `CUSTOMER_RESTRICTION:${randomUUID()}`;
      await tx.customerRestriction.createMany({
        data: scopes.map((scope) => ({
          restrictionNo,
          customerId: input.customerId,
          scope,
          cause: input.cause,
          // R1：visibility / releasePolicy 查表落库，入参永远碰不到这两列
          visibility: policy.visibility,
          releasePolicy: policy.releasePolicy,
          status: 'OPEN',
          reason: input.reason,
          caseRef,
          openedBy: input.openedBy,
          traceId,
        })),
      });

      return { customerNo: customer.customerNo, restrictionNo, traceId, scopes, created: true };
    });

    const auditShell = {
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: input.customerId,
      entityNo: outcome.customerNo || undefined,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: input.customerId,
      entityOwnerNo: outcome.customerNo || undefined,
      traceId: outcome.traceId,
      reason: input.reason,
      metadata: {
        restrictionNo: outcome.restrictionNo,
        cause: input.cause,
        scopes: outcome.scopes,
        visibility: policy.visibility,
        releaseMode: null,
        caseRef,
        openedBy: input.openedBy,
      },
    };

    await this.auditLogsService.recordSystem({
      ...auditShell,
      action: AuditActions.CUSTOMER_RESTRICTION_ADDED,
      result: outcome.created ? AuditResult.SUCCESS : AuditResult.SKIPPED,
    });

    // CUSTOMER_FROZEN 此前零写入方，本轮由制裁便签激活
    if (outcome.created && input.cause === 'SANCTION') {
      await this.auditLogsService.recordSystem({
        ...auditShell,
        action: AuditActions.CUSTOMER_FROZEN,
        result: AuditResult.SUCCESS,
      });
    }

    return { restrictionNo: outcome.restrictionNo, created: outcome.created };
  }
}
```

- [ ] **Step 10 (GREEN 验证 + 局部 tsc + commit)**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```
期望：`Tests:       11 passed, 11 total`。

```bash
npx tsc --noEmit 2>&1 | grep -E "customer-restrictions\.service\.ts|restriction-cause\.constant\.ts|audit-log\.dto\.ts"
```
期望：**无输出**（本 Task 自己的三个文件零错）。全量 `tsc` 此刻仍红——Task 1 删列 + 下面 Step 14 记录的两个旧调用方——那是别的 Task 的账，不在本步收。

```bash
git add src/modules/audit-logging/dto/audit-log.dto.ts src/modules/identity/customers/customer-restrictions.service.ts src/modules/identity/customers/customer-restrictions.service.spec.ts
git commit -m "feat(identity): CustomerRestrictionsService.open —— 查表落库+一号多行+幂等 SKIPPED"
```

- [ ] **Step 11 (RED): 追加 `release()` 三个用例**

spec 文件末尾追加：

```ts
describe('CustomerRestrictionsService.release', () => {
  const openRows = (cause: RestrictionCause, visibility: string) => [
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'WITHDRAW',
      cause,
      visibility,
      status: 'OPEN',
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'SWAP',
      cause,
      visibility,
      status: 'OPEN',
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
  ];

  it('一次撕掉同号全部行，写 CUSTOMER_RESTRICTION_CLEARED', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findMany.mockResolvedValue(openRows('MATERIAL_EXPIRED', 'DISCLOSED'));
    const svc = new CustomerRestrictionsService(prisma, audit);

    await svc.release('RST2608150001', {
      releasedBy: 'ops@fiatx.com',
      releaseMode: 'MANUAL',
      releaseApprovalNo: 'APR2608150001',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.customerRestriction.updateMany).toHaveBeenCalledWith({
      where: { restrictionNo: 'RST2608150001', status: 'OPEN' },
      data: expect.objectContaining({
        status: 'RELEASED',
        releasedBy: 'ops@fiatx.com',
        releaseMode: 'MANUAL',
        releaseApprovalNo: 'APR2608150001',
        releaseOrderRef: null,
      }),
    });
    expect(audit.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CUSTOMER_RESTRICTION_CLEARED',
        result: 'SUCCESS',
        traceId: 'CUSTOMER_RESTRICTION:t-1',
        metadata: expect.objectContaining({
          restrictionNo: 'RST2608150001',
          cause: 'MATERIAL_EXPIRED',
          scopes: ['WITHDRAW', 'SWAP'],
          releaseMode: 'MANUAL',
          approvalNo: 'APR2608150001',
        }),
      }),
    );
  });

  it('SANCTION 撕的时候额外写 CUSTOMER_UNFROZEN，并带上政府解除令文书号', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findMany.mockResolvedValue([
      { ...openRows('SANCTION', 'SILENT')[0], scope: 'ALL' },
    ]);
    const svc = new CustomerRestrictionsService(prisma, audit);

    await svc.release('RST2608150001', {
      releasedBy: 'mlro@fiatx.com',
      releaseMode: 'MANUAL',
      releaseApprovalNo: 'APR2608150002',
      releaseOrderRef: 'GOV-2026-0815',
    });

    expect(audit.recordSystem.mock.calls.map((c: any[]) => c[0].action)).toEqual([
      'CUSTOMER_RESTRICTION_CLEARED',
      'CUSTOMER_UNFROZEN',
    ]);
    expect(audit.recordSystem.mock.calls[0][0].metadata.releaseOrderRef).toBe('GOV-2026-0815');
  });

  it('已 RELEASED 的便签幂等成功：不再 update、不重复写审计；号不存在才抛 NotFound', async () => {
    const { prisma, tx } = createPrismaMock();
    const audit = createAuditMock();
    tx.customerRestriction.findMany.mockResolvedValue([
      { ...openRows('MATERIAL_EXPIRED', 'DISCLOSED')[0], status: 'RELEASED' },
    ]);
    const svc = new CustomerRestrictionsService(prisma, audit);

    await expect(
      svc.release('RST2608150001', { releasedBy: 'ops@fiatx.com', releaseMode: 'AUTO' }),
    ).resolves.toBeUndefined();
    expect(tx.customerRestriction.updateMany).not.toHaveBeenCalled();
    expect(audit.recordSystem).not.toHaveBeenCalled();

    tx.customerRestriction.findMany.mockResolvedValue([]);
    await expect(
      svc.release('RST-nope', { releasedBy: 'ops@fiatx.com', releaseMode: 'AUTO' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 12 (RED 验证)**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```
期望：套件 fail，输出含 `error TS2339: Property 'release' does not exist on type 'CustomerRestrictionsService'.`

- [ ] **Step 13 (GREEN): 实现 `release()`**

在 `customer-restrictions.service.ts` 的 `open()` 方法之后、类闭合大括号之前插入：

```ts
  /**
   * 撕便签：以 restrictionNo 为单位，同号全部 OPEN 行一个事务里一起置 RELEASED。
   * 已经 RELEASED 视为幂等成功（重投的审批事件、自动撕与人工撕撞车都会走到这里）。
   */
  async release(
    restrictionNo: string,
    opts: {
      releasedBy: string;
      releaseMode: 'AUTO' | 'MANUAL';
      releaseApprovalNo?: string;
      releaseOrderRef?: string;
    },
  ): Promise<void> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.customerRestriction.findMany({
        where: { restrictionNo },
        orderBy: { scope: 'asc' },
      });
      if (rows.length === 0) throw new NotFoundException(`Restriction not found: ${restrictionNo}`);

      const openRows = rows.filter((row) => row.status === 'OPEN');
      if (openRows.length === 0) return { released: false, rows: openRows, customerNo: null as string | null };

      const customer = await tx.customerMain.findUnique({
        where: { id: rows[0].customerId },
        select: { customerNo: true },
      });
      await tx.customerRestriction.updateMany({
        where: { restrictionNo, status: 'OPEN' },
        data: {
          status: 'RELEASED',
          releasedAt: new Date(),
          releasedBy: opts.releasedBy,
          releaseMode: opts.releaseMode,
          releaseApprovalNo: opts.releaseApprovalNo ?? null,
          releaseOrderRef: opts.releaseOrderRef ?? null,
        },
      });

      return { released: true, rows: openRows, customerNo: customer?.customerNo ?? null };
    });

    if (!outcome.released) return;

    const first = outcome.rows[0];
    const auditShell = {
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: first.customerId,
      entityNo: outcome.customerNo || undefined,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: first.customerId,
      entityOwnerNo: outcome.customerNo || undefined,
      // traceId 撕时继承便签行上的值（贴时生成）
      traceId: first.traceId,
      result: AuditResult.SUCCESS,
      reason: `${first.cause} released by ${opts.releaseMode.toLowerCase()}`,
      metadata: {
        restrictionNo,
        cause: first.cause,
        scopes: outcome.rows.map((row) => row.scope),
        visibility: first.visibility,
        releaseMode: opts.releaseMode,
        approvalNo: opts.releaseApprovalNo ?? null,
        releaseOrderRef: opts.releaseOrderRef ?? null,
      },
    };

    await this.auditLogsService.recordSystem({
      ...auditShell,
      action: AuditActions.CUSTOMER_RESTRICTION_CLEARED,
    });

    if (first.cause === 'SANCTION') {
      await this.auditLogsService.recordSystem({
        ...auditShell,
        action: AuditActions.CUSTOMER_UNFROZEN,
      });
    }
  }
```

- [ ] **Step 14 (GREEN 验证 + commit)**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
npx tsc --noEmit 2>&1 | grep -E "customer-restrictions\.service\.ts|restriction-cause\.constant\.ts"
```
期望：`Tests:       14 passed, 14 total`；grep 无输出。

```bash
git add src/modules/identity/customers/customer-restrictions.service.ts src/modules/identity/customers/customer-restrictions.service.spec.ts
git commit -m "feat(identity): CustomerRestrictionsService.release —— 同号原子撕+SANCTION 解冻审计"
```

- [ ] **Step 15 (RED): 追加四个读方法的用例**

spec 文件末尾追加：

```ts
describe('CustomerRestrictionsService 读侧', () => {
  const dbRows = [
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'WITHDRAW',
      cause: 'MATERIAL_EXPIRED',
      visibility: 'DISCLOSED',
      releasePolicy: 'OPS_APPROVAL',
      status: 'OPEN',
      reason: 'Emirates ID expired',
      caseRef: 'MRC26073100xx',
      releaseOrderRef: null,
      openedAt: new Date('2026-08-09T02:00:00Z'),
      openedBy: 'system-cron',
      releasedAt: null,
      releasedBy: null,
      releaseApprovalNo: null,
      releaseMode: null,
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
    {
      restrictionNo: 'RST2608150001',
      customerId: 'c1',
      scope: 'SWAP',
      cause: 'MATERIAL_EXPIRED',
      visibility: 'DISCLOSED',
      releasePolicy: 'OPS_APPROVAL',
      status: 'OPEN',
      reason: 'Emirates ID expired',
      caseRef: 'MRC26073100xx',
      releaseOrderRef: null,
      openedAt: new Date('2026-08-09T02:00:00Z'),
      openedBy: 'system-cron',
      releasedAt: null,
      releasedBy: null,
      releaseApprovalNo: null,
      releaseMode: null,
      traceId: 'CUSTOMER_RESTRICTION:t-1',
    },
  ];

  it('listOpen / findByNo 把同号多行折成一行、scope 收进 scopes', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerRestriction.findMany.mockResolvedValue(dbRows);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());

    const [row] = await svc.listOpen('c1');
    expect(row.restrictionNo).toBe('RST2608150001');
    expect(row.scopes).toEqual(['WITHDRAW', 'SWAP']);
    expect(row.cause).toBe('MATERIAL_EXPIRED');
    expect(row.visibility).toBe('DISCLOSED');
    expect(row.status).toBe('OPEN');
    expect(prisma.customerRestriction.findMany).toHaveBeenCalledWith({
      where: { customerId: 'c1', status: 'OPEN' },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });

    const byNo = await svc.findByNo('RST2608150001');
    expect(byNo?.scopes).toEqual(['WITHDRAW', 'SWAP']);
  });

  it('listAll 不过滤 status；findByNo 查不到返回 null', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerRestriction.findMany.mockResolvedValue([]);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());

    expect(await svc.listAll('c1')).toEqual([]);
    expect(prisma.customerRestriction.findMany).toHaveBeenCalledWith({
      where: { customerId: 'c1' },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });
    expect(await svc.findByNo('RST-nope')).toBeNull();
  });

  it('findOpenByCause：给了 caseRef 就精确匹配，传 null 表示不限 caseRef', async () => {
    const { prisma } = createPrismaMock();
    prisma.customerRestriction.findFirst.mockResolvedValue(dbRows[0]);
    prisma.customerRestriction.findMany.mockResolvedValue(dbRows);
    const svc = new CustomerRestrictionsService(prisma, createAuditMock());

    const hit = await svc.findOpenByCause('c1', 'MATERIAL_EXPIRED', 'MRC26073100xx');
    expect(hit?.scopes).toEqual(['WITHDRAW', 'SWAP']);
    expect(prisma.customerRestriction.findFirst).toHaveBeenCalledWith({
      where: {
        customerId: 'c1',
        cause: 'MATERIAL_EXPIRED',
        status: 'OPEN',
        caseRef: 'MRC26073100xx',
      },
      orderBy: { openedAt: 'asc' },
    });

    prisma.customerRestriction.findFirst.mockClear();
    await svc.findOpenByCause('c1', 'KYT_REJECTED_SOFT', null);
    expect(prisma.customerRestriction.findFirst).toHaveBeenCalledWith({
      where: { customerId: 'c1', cause: 'KYT_REJECTED_SOFT', status: 'OPEN' },
      orderBy: { openedAt: 'asc' },
    });
  });
});
```

- [ ] **Step 16 (RED 验证)**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```
期望：套件 fail，输出含 `error TS2339: Property 'listOpen' does not exist on type 'CustomerRestrictionsService'.`

- [ ] **Step 17 (GREEN): 实现四个读方法 + 私有聚合器**

在 `release()` 之后、类闭合大括号之前插入：

```ts
  async findByNo(restrictionNo: string): Promise<RestrictionRow | null> {
    const rows = await this.prisma.customerRestriction.findMany({
      where: { restrictionNo },
      orderBy: { scope: 'asc' },
    });
    if (rows.length === 0) return null;
    return this.toRows(rows)[0];
  }

  async listOpen(customerId: string): Promise<RestrictionRow[]> {
    const rows = await this.prisma.customerRestriction.findMany({
      where: { customerId, status: 'OPEN' },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });
    return this.toRows(rows);
  }

  async listAll(customerId: string): Promise<RestrictionRow[]> {
    const rows = await this.prisma.customerRestriction.findMany({
      where: { customerId },
      orderBy: [{ openedAt: 'desc' }, { scope: 'asc' }],
    });
    return this.toRows(rows);
  }

  /**
   * 幂等键的读侧。caseRef 传具体值 = 精确匹配那张便签；传 null = 不限 caseRef、
   * 取该 cause 下最早一张 OPEN —— 自动撕的触发方（如 Sumsub GREEN 回调）往往只知道
   * cause，不知道当初贴的时候挂的是哪个业务号。
   */
  async findOpenByCause(
    customerId: string,
    cause: RestrictionCause,
    caseRef: string | null,
  ): Promise<RestrictionRow | null> {
    const hit = await this.prisma.customerRestriction.findFirst({
      where: {
        customerId,
        cause,
        status: 'OPEN',
        ...(caseRef === null ? {} : { caseRef }),
      },
      orderBy: { openedAt: 'asc' },
    });
    if (!hit) return null;
    return this.findByNo(hit.restrictionNo);
  }

  /** 同 restrictionNo 的多行折成一行，scope 收进 scopes（对外一律以便签为单位） */
  private toRows(records: CustomerRestrictionRecord[]): RestrictionRow[] {
    const byNo = new Map<string, RestrictionRow>();
    for (const record of records) {
      const existing = byNo.get(record.restrictionNo);
      if (existing) {
        existing.scopes.push(record.scope as RestrictionScope);
        continue;
      }
      byNo.set(record.restrictionNo, {
        restrictionNo: record.restrictionNo,
        customerId: record.customerId,
        scopes: [record.scope as RestrictionScope],
        cause: record.cause as RestrictionCause,
        visibility: record.visibility as RestrictionVisibility,
        releasePolicy: record.releasePolicy as RestrictionReleasePolicy,
        status: record.status as 'OPEN' | 'RELEASED',
        reason: record.reason,
        caseRef: record.caseRef,
        releaseOrderRef: record.releaseOrderRef,
        openedAt: record.openedAt,
        openedBy: record.openedBy,
        releasedAt: record.releasedAt,
        releasedBy: record.releasedBy,
        releaseApprovalNo: record.releaseApprovalNo,
        releaseMode: record.releaseMode as 'AUTO' | 'MANUAL' | null,
        traceId: record.traceId,
      });
    }
    return [...byNo.values()];
  }
```

- [ ] **Step 18 (GREEN 验证)**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts
```
期望：`Tests:       17 passed, 17 total`，`Test Suites: 1 passed, 1 total`。

- [ ] **Step 19: 局部闸门 + 记录本 Task 制造的已知破口**

```bash
npx tsc --noEmit 2>&1 | grep -E "customer-restrictions|restriction-cause|audit-log\.dto"
npx tsc --noEmit 2>&1 | grep -nE "\.add\(|\.clear\(" 
grep -rn "restrictionsService.clear\|customerRestrictionsService.add" src --include "*.ts"
```
期望第一条无输出（本 Task 三个文件干净）。第三条恰好命中三处旧 API 调用，它们随本 Task 的重写编译失败，由后续「写入方迁移」任务（swap KYT 拒绝路径改贴 `KYT_REJECTED_SOFT` / `KYT_REJECTED_HARD`、GREEN 回调改 `autoRelease`）负责关闭，本 Task 不动：

| 位置 | 旧调用 | 迁移目标 |
|---|---|---|
| `src/modules/trading/swap-transactions/swap-workflow.service.ts:825` | `customerRestrictionsService.add(swap.ownerId, ['SWAP','WITHDRAW'], 'KYT_REJECTED', 'system')` | `open({ cause: 软/硬线, caseRef: swapNo, openedBy:'system' })` |
| `src/modules/swap-sumsub/applicant-action.handler.ts:127` | `restrictionsService.clear(customer.id, ['SWAP','WITHDRAW'], 'system')` | `autoRelease(customerId,'KYT_REJECTED_SOFT',null,'system')` |
| `src/modules/swap-sumsub/applicant-action.handler.spec.ts:37,65,90,111,127,148,164` | `jest.Mocked<CustomerRestrictionsService>` 上的 `.clear` | 随上一行一起改 |

（`swap-workflow.service.spec.ts:1235` 的 mock 是 `as any` 字面量，不随本 Task 变红。）

- [ ] **Step 20: commit**

```bash
git add src/modules/identity/customers/customer-restrictions.service.ts src/modules/identity/customers/customer-restrictions.service.spec.ts
git commit -m "feat(identity): 限制账读侧 findByNo/listOpen/listAll/findOpenByCause + 同号聚合"
```

---

### Task 4: CustomerAccessService（唯一读侧求值器）+ tipping-off 守则性测试

**依赖**：Task 1（`customer-lifecycle.constant.ts` / `restriction-cause.constant.ts`）与 Task 3（`customer_restrictions` 表 + `CustomerMain.lifecycle` + `CustomerRestrictionsService` 重写 + `prisma generate`）均已落地。本任务只做读侧，不写任何表、不写审计（读操作无持久状态变更，铁律 1 不适用）。

**Files:**

- Create: `Exchange_js/src/modules/identity/customers/customer-access.service.ts`
- Create: `Exchange_js/src/modules/identity/customers/customer-access.service.spec.ts`（Test）
- Create: `Exchange_js/src/modules/identity/customers/customer-access.contract.spec.ts`（Test，守则性）
- Modify: `Exchange_js/src/modules/funds-orders/funds-order.service.ts` — 在 `findNonTerminalByWallet` 结束的第 240 行 `}` 之后、第 242 行 `/* ── Admin read surface (C6) ──` 注释之前插入新方法（现有 import 第 14 行已含 `TERMINAL_STATUSES`，无需改 import）
- Modify: `Exchange_js/src/modules/identity/customers/customers.module.ts` — 全文 19 行，改 import 段（第 1–9 行）与 `@Module` 装饰器（第 11–18 行）

**Interfaces:**

Consumes（均为既有真实签名，已核对）：
```ts
// src/modules/identity/customers/customer-restrictions.service.ts（Task 3 产出）
listOpen(customerId: string): Promise<RestrictionRow[]>
// RestrictionRow.scopes: RestrictionScope[]，openedAt: Date，visibility: 'SILENT'|'DISCLOSED'

// src/modules/identity/customers/constants/restriction-cause.constant.ts（Task 1 产出）
RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy>  // .customerLabel

// src/modules/identity/constants/customer-lifecycle.constant.ts（Task 1 产出）
type CustomerLifecycle

// src/modules/accounting/tigerbeetle/accounting.service.ts:376
getCustomerAvailableBalance(customerUuid: string, assetCurrency: string): Promise<CustomerAvailableBalance>
// CustomerAvailableBalance = { available: bigint; held: bigint; total: bigint }（accounting.types.ts:51-55）
// ⚠️ 客户在某 ledger 无 TB 账户时抛 NotFoundException{code:'TB_ACCOUNT_REGISTRY_NOT_FOUND'}（accounting.service.ts:404-410），必须捕获当 0

// src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant.ts
TB_LEDGERS = { AED: 1, USDT: 2 }

// prisma：CustomerMain.lifecycle（Task 3 迁移已落 + prisma generate 已跑）
```

Produces：
```ts
// src/modules/identity/customers/customer-access.service.ts
export type Capability = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
export const ALL_CAPABILITIES: readonly Capability[];
export interface DisclosedRestrictionView {
  restrictionNo: string; cause: RestrictionCause; scopes: RestrictionScope[];
  label: string; reason: string; openedAt: string;
}
export interface CustomerAccess {
  lifecycle: CustomerLifecycle;
  blocked: Set<Capability>;
  disclosedBlocked: Set<Capability>;
  disclosed: DisclosedRestrictionView[];
  openCount: number;
}
export class CustomerAccessService {
  resolve(customerId: string): Promise<CustomerAccess>;
  assertCapability(customerId: string, capability: Capability): Promise<void>;
  assertOffboardable(customerId: string): Promise<void>;
}

// src/modules/funds-orders/funds-order.service.ts
countNonTerminalByCustomer(customerId: string): Promise<number>;
```

---

- [ ] **Step 1: 写失败的读侧单测（红）**

创建 `Exchange_js/src/modules/identity/customers/customer-access.service.spec.ts`：

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CustomerAccessService } from './customer-access.service';

/**
 * 全部依赖用手写 mock 直接构造（本仓单测惯例，见 customer-restrictions.service.spec.ts）。
 * listOpen 返回的是「按 restrictionNo 聚合后」的 RestrictionRow（scopes 是数组），
 * 与 Task 3 契约一致：一号多行在 domain service 内已合并。
 */
function row(over: Partial<any> = {}) {
  return {
    restrictionNo: 'RST-1',
    customerId: 'cust-1',
    scopes: ['ALL'],
    cause: 'SANCTION',
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    status: 'OPEN',
    reason: 'sanctions hit',
    caseRef: null,
    releaseOrderRef: null,
    openedAt: new Date('2026-08-15T00:00:00.000Z'),
    openedBy: 'system',
    releasedAt: null,
    releasedBy: null,
    releaseApprovalNo: null,
    releaseMode: null,
    traceId: 'trace-1',
    ...over,
  };
}

const SANCTION_ROW = row();
const MATERIAL_ROW = row({
  restrictionNo: 'RST-2',
  scopes: ['WITHDRAW', 'SWAP'],
  cause: 'MATERIAL_EXPIRED',
  visibility: 'DISCLOSED',
  releasePolicy: 'OPS_APPROVAL',
  reason: 'passport expired',
});

function build(opts: {
  lifecycle?: string | null;
  openRows?: any[];
  balances?: Record<string, bigint>;
  inflight?: number;
} = {}) {
  const prisma = {
    customerMain: {
      findUnique: jest.fn().mockResolvedValue(
        opts.lifecycle === null
          ? null
          : { id: 'cust-1', customerNo: 'C-001', lifecycle: opts.lifecycle ?? 'ACTIVE' },
      ),
    },
  } as any;
  const restrictions = { listOpen: jest.fn().mockResolvedValue(opts.openRows ?? []) } as any;
  const accounting = {
    getCustomerAvailableBalance: jest.fn(async (_c: string, currency: string) => {
      const balances = opts.balances ?? {};
      if (!(currency in balances)) {
        // 客户在该 ledger 从未开户 —— 真实 AccountingService 就是抛这个
        throw new NotFoundException({ code: 'TB_ACCOUNT_REGISTRY_NOT_FOUND', message: 'no account' });
      }
      const total = balances[currency];
      return { available: total, held: 0n, total };
    }),
  } as any;
  const fundsOrders = {
    countNonTerminalByCustomer: jest.fn().mockResolvedValue(opts.inflight ?? 0),
  } as any;
  const svc = new CustomerAccessService(prisma, restrictions, accounting, fundsOrders);
  return { svc, prisma, restrictions, accounting, fundsOrders };
}

async function catchForbidden(p: Promise<unknown>): Promise<any> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ForbiddenException);
    return (e as ForbiddenException).getResponse();
  }
  throw new Error('expected ForbiddenException, but the call resolved');
}

describe('CustomerAccessService.resolve', () => {
  it('多因并存：SANCTION(ALL) + MATERIAL_EXPIRED(WITHDRAW,SWAP) → blocked 三能力齐，disclosedBlocked 只有 WITHDRAW+SWAP', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW, MATERIAL_ROW] });
    const access = await svc.resolve('cust-1');

    expect([...access.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    expect([...access.disclosedBlocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
    expect(access.openCount).toBe(2);
    expect(access.lifecycle).toBe('ACTIVE');
  });

  it('tipping-off 命门：仅有 SILENT 限制时 blocked 非空而 disclosedBlocked 为空集', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    const access = await svc.resolve('cust-1');

    expect(access.blocked.size).toBe(3);
    expect(access.disclosedBlocked.size).toBe(0);
    expect(access.disclosed).toEqual([]);
    // 客户面唯一能看到的计数字段不存在；openCount 是 admin 面的，仍要含 SILENT
    expect(access.openCount).toBe(1);
  });

  it('disclosed 不含任何 SILENT 行，label 取自 RESTRICTION_CAUSE_POLICY', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW, MATERIAL_ROW] });
    const access = await svc.resolve('cust-1');

    expect(access.disclosed).toHaveLength(1);
    expect(access.disclosed[0]).toEqual({
      restrictionNo: 'RST-2',
      cause: 'MATERIAL_EXPIRED',
      scopes: ['WITHDRAW', 'SWAP'],
      label: 'Document expired',
      reason: 'passport expired',
      openedAt: '2026-08-15T00:00:00.000Z',
    });
    expect(JSON.stringify(access.disclosed)).not.toContain('SANCTION');
    expect(JSON.stringify(access.disclosed)).not.toContain('SILENT');
  });

  it('客户不存在 → NotFoundException', async () => {
    const { svc } = build({ lifecycle: null });
    await expect(svc.resolve('cust-x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('CustomerAccessService.assertCapability', () => {
  it('lifecycle 非 ACTIVE → LIFECYCLE_NOT_ACTIVE', async () => {
    const { svc } = build({ lifecycle: 'IN_VERIFICATION' });
    const body = await catchForbidden(svc.assertCapability('cust-1', 'WITHDRAW'));
    expect(body.code).toBe('LIFECYCLE_NOT_ACTIVE');
  });

  it('blocked 命中 → CAPABILITY_RESTRICTED，且响应体不泄露 cause / visibility', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    const body = await catchForbidden(svc.assertCapability('cust-1', 'WITHDRAW'));

    expect(body.code).toBe('CAPABILITY_RESTRICTED');
    expect(Object.keys(body).sort()).toEqual(['code', 'message']);
    const text = JSON.stringify(body);
    for (const leak of ['SANCTION', 'SILENT', 'DISCLOSED', 'MATERIAL_EXPIRED', 'RST-1', 'sanctions hit']) {
      expect(text).not.toContain(leak);
    }
  });

  it('SILENT 与 DISCLOSED 两种被拒的响应体逐字相同（否则错误码即信号）', async () => {
    const silent = build({ openRows: [SANCTION_ROW] });
    const disclosed = build({ openRows: [MATERIAL_ROW] });
    const a = await catchForbidden(silent.svc.assertCapability('cust-1', 'WITHDRAW'));
    const b = await catchForbidden(disclosed.svc.assertCapability('cust-1', 'WITHDRAW'));
    expect(a).toEqual(b);
  });

  it('未被卡的能力放行', async () => {
    const { svc } = build({ openRows: [MATERIAL_ROW] });
    await expect(svc.assertCapability('cust-1', 'DEPOSIT')).resolves.toBeUndefined();
  });
});

describe('CustomerAccessService.assertOffboardable', () => {
  it('有 SILENT OPEN 行 → OFFBOARD_BLOCKED_BY_SANCTION', async () => {
    const { svc } = build({ openRows: [SANCTION_ROW] });
    const body = await catchForbidden(svc.assertOffboardable('cust-1'));
    expect(body.code).toBe('OFFBOARD_BLOCKED_BY_SANCTION');
    expect(body.restrictionNo).toBe('RST-1');
  });

  it('余额非零 → OFFBOARD_BLOCKED_BY_BALANCE', async () => {
    const { svc } = build({ openRows: [MATERIAL_ROW], balances: { AED: 12345n } });
    const body = await catchForbidden(svc.assertOffboardable('cust-1'));
    expect(body.code).toBe('OFFBOARD_BLOCKED_BY_BALANCE');
    expect(body.currency).toBe('AED');
    expect(body.total).toBe('12345');
  });

  it('有非终态 funds_order → OFFBOARD_BLOCKED_BY_INFLIGHT', async () => {
    const { svc } = build({ balances: { AED: 0n, USDT: 0n }, inflight: 2 });
    const body = await catchForbidden(svc.assertOffboardable('cust-1'));
    expect(body.code).toBe('OFFBOARD_BLOCKED_BY_INFLIGHT');
    expect(body.inflight).toBe(2);
  });

  it('干净客户放行；某币种从未开户（TB 注册表 404）按 0 处理，不误报 BALANCE', async () => {
    const { svc, accounting } = build({ balances: { AED: 0n } }); // USDT 会抛 NotFound
    await expect(svc.assertOffboardable('cust-1')).resolves.toBeUndefined();
    expect(accounting.getCustomerAvailableBalance).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: 跑测试确认红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/customers/customer-access.service.spec.ts
```

期望输出（整个 suite 失败在解析阶段）：
```
● Test suite failed to run

  Cannot find module './customer-access.service' from 'src/modules/identity/customers/customer-access.service.spec.ts'
```

- [ ] **Step 3: 给 FundsOrderService 加按客户的在途单计数**

`funds_orders` 无 `customerId` 列，只能经三个 parent FK 的 `ownerType/ownerId` 反查（`DepositTransaction:973-974` / `WithdrawTransaction:1211-1212` / `SwapTransaction:1148-1149` 都有这两列）。铁律 7：customers 域不许直查 funds_orders 表，必须经本方法。

在 `Exchange_js/src/modules/funds-orders/funds-order.service.ts` 第 240 行（`findNonTerminalByWallet` 的收尾 `}`）之后、第 242 行 `/* ── Admin read surface (C6)` 之前插入：

```ts

  /**
   * 销户前置校验专用：某客户名下全部非终态资金单计数。
   * funds_orders 无 customerId，归属只能经三个 parent FK 的 ownerType/ownerId 反查。
   */
  async countNonTerminalByCustomer(customerId: string): Promise<number> {
    const owner = { ownerType: 'CUSTOMER', ownerId: customerId };
    return this.prisma.fundsOrder.count({
      where: {
        status: { notIn: Array.from(TERMINAL_STATUSES) },
        OR: [
          { deposit: { is: owner } },
          { withdrawTransaction: { is: owner } },
          { swapTransaction: { is: owner } },
        ],
      },
    });
  }
```

- [ ] **Step 4: 写 CustomerAccessService 最小实现**

创建 `Exchange_js/src/modules/identity/customers/customer-access.service.ts`：

```ts
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AccountingService } from '../../accounting/tigerbeetle/accounting.service';
import { TB_LEDGERS } from '../../accounting/tigerbeetle/constants/tb-ledgers.constant';
import { FundsOrderService } from '../../funds-orders/funds-order.service';
import { CustomerLifecycle } from '../constants/customer-lifecycle.constant';
import {
  RESTRICTION_CAUSE_POLICY,
  RestrictionCause,
  RestrictionScope,
} from './constants/restriction-cause.constant';
import { CustomerRestrictionsService } from './customer-restrictions.service';

export type Capability = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export const ALL_CAPABILITIES: readonly Capability[] = ['DEPOSIT', 'WITHDRAW', 'SWAP'];

export interface DisclosedRestrictionView {
  restrictionNo: string;
  cause: RestrictionCause;
  scopes: RestrictionScope[];
  label: string;
  reason: string;
  openedAt: string;
}

export interface CustomerAccess {
  lifecycle: CustomerLifecycle;
  /** 服务端执法唯一依据：全部 OPEN 行 scope 并集（ALL 展开）。含 SILENT。 */
  blocked: Set<Capability>;
  /** 客户面唯一可序列化的能力集：仅 DISCLOSED 行贡献。 */
  disclosedBlocked: Set<Capability>;
  /** 客户面：仅 DISCLOSED 的 OPEN 行。 */
  disclosed: DisclosedRestrictionView[];
  /** admin 面：OPEN 的 restrictionNo 去重计数，含 SILENT。 */
  openCount: number;
}

/** 中性文案：与网络失败 / 系统繁忙不可区分，绝不透出 cause / visibility。 */
const NEUTRAL_DENIAL = 'This operation is not available for your account at the moment.';

function expandScopes(scopes: RestrictionScope[]): Capability[] {
  const out: Capability[] = [];
  for (const scope of scopes) {
    if (scope === 'ALL') {
      out.push(...ALL_CAPABILITIES);
    } else {
      out.push(scope);
    }
  }
  return out;
}

/**
 * 客户可做什么的唯一求值器。所有读侧（jwt.strategy / 交易前置门 / profile 提示条 /
 * 客户面端点）一律消费本服务，禁止各自解析限制账。
 */
@Injectable()
export class CustomerAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly accountingService: AccountingService,
    private readonly fundsOrderService: FundsOrderService,
  ) {}

  async resolve(customerId: string): Promise<CustomerAccess> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { id: true, customerNo: true, lifecycle: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer not found: ${customerId}`);
    }

    const openRows = await this.restrictionsService.listOpen(customerId);

    const blocked = new Set<Capability>();
    const disclosedBlocked = new Set<Capability>();
    const disclosed: DisclosedRestrictionView[] = [];

    for (const row of openRows) {
      const capabilities = expandScopes(row.scopes);
      for (const capability of capabilities) {
        blocked.add(capability);
      }
      if (row.visibility !== 'DISCLOSED') continue;

      for (const capability of capabilities) {
        disclosedBlocked.add(capability);
      }
      disclosed.push({
        restrictionNo: row.restrictionNo,
        cause: row.cause,
        scopes: row.scopes,
        label: RESTRICTION_CAUSE_POLICY[row.cause].customerLabel,
        reason: row.reason,
        openedAt: row.openedAt.toISOString(),
      });
    }

    return {
      lifecycle: customer.lifecycle as CustomerLifecycle,
      blocked,
      disclosedBlocked,
      disclosed,
      // listOpen 已按 restrictionNo 聚合，一号一行
      openCount: openRows.length,
    };
  }

  async assertCapability(customerId: string, capability: Capability): Promise<void> {
    const access = await this.resolve(customerId);

    if (access.lifecycle !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'LIFECYCLE_NOT_ACTIVE',
        message: NEUTRAL_DENIAL,
      });
    }
    if (access.blocked.has(capability)) {
      // 响应体只有 code + message —— 客户能看到它，多一个字段就是一次泄密
      throw new ForbiddenException({
        code: 'CAPABILITY_RESTRICTED',
        message: NEUTRAL_DENIAL,
      });
    }
  }

  /**
   * 销户前置（INV-2 / INV-3）。仅 admin 侧调用，故错误体可带排障明细。
   */
  async assertOffboardable(customerId: string): Promise<void> {
    const openRows = await this.restrictionsService.listOpen(customerId);
    const silent = openRows.find((row) => row.visibility === 'SILENT');
    if (silent) {
      throw new ForbiddenException({
        code: 'OFFBOARD_BLOCKED_BY_SANCTION',
        message: 'Customer has an open confidential restriction and cannot be offboarded',
        restrictionNo: silent.restrictionNo,
      });
    }

    for (const currency of Object.keys(TB_LEDGERS)) {
      const total = await this.readTotalBalance(customerId, currency);
      if (total !== 0n) {
        throw new ForbiddenException({
          code: 'OFFBOARD_BLOCKED_BY_BALANCE',
          message: `Customer still holds a ${currency} balance`,
          currency,
          total: total.toString(),
        });
      }
    }

    const inflight = await this.fundsOrderService.countNonTerminalByCustomer(customerId);
    if (inflight > 0) {
      throw new ForbiddenException({
        code: 'OFFBOARD_BLOCKED_BY_INFLIGHT',
        message: 'Customer has funds orders still in flight',
        inflight,
      });
    }
  }

  /** 客户在该 ledger 从未开户时 AccountingService 抛 404，语义上等于零余额。 */
  private async readTotalBalance(customerId: string, currency: string): Promise<bigint> {
    try {
      const balance = await this.accountingService.getCustomerAvailableBalance(customerId, currency);
      return balance.total;
    } catch (e) {
      if (e instanceof NotFoundException) return 0n;
      throw e;
    }
  }
}
```

- [ ] **Step 5: 跑测试确认绿**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/customers/customer-access.service.spec.ts
```

期望输出：`Tests:       12 passed, 12 total`（`resolve` 4 + `assertCapability` 4 + `assertOffboardable` 4）。

- [ ] **Step 6: 注册进 CustomersModule 并 exports**

把 `Exchange_js/src/modules/identity/customers/customers.module.ts` 全文（19 行）替换为：

```ts
import { Module, forwardRef } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerAccessService } from './customer-access.service';
import { CustomerPendingActionService } from './customer-pending-action.service';
import { CustomersController } from './customers.controller';
import { CustomerPendingActionController } from './customer-pending-action.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { TigerBeetleModule } from '../../accounting/tigerbeetle/tigerbeetle.module';
import { FundsOrdersModule } from '../../funds-orders/funds-orders.module';

@Module({
  // OnboardingModule：仅为 SumsubClient（客户级补料会话铸 token）。
  // Onboarding 不反向依赖 Customers，无环（2026-08-14 核）。
  // TigerBeetleModule / FundsOrdersModule：仅为 CustomerAccessService.assertOffboardable
  // 的余额与在途单前置。两者的 imports 只有 PrismaModule / AuditLogsModule，
  // 都不反向依赖 Customers，无环（2026-08-15 核）。
  imports: [
    PrismaModule,
    NotificationsModule,
    forwardRef(() => OnboardingModule),
    TigerBeetleModule,
    FundsOrdersModule,
  ],
  providers: [
    CustomersService,
    CustomerRestrictionsService,
    CustomerAccessService,
    CustomerPendingActionService,
  ],
  controllers: [CustomersController, CustomerPendingActionController],
  exports: [CustomerRestrictionsService, CustomerAccessService, CustomerPendingActionService],
})
export class CustomersModule {}
```

- [ ] **Step 7: 硬闸门 tsc + 本模块回归**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx tsc --noEmit
npx jest src/modules/identity/customers src/modules/funds-orders
```

期望：`tsc` 无输出（0 错）；jest 全绿，`funds-order.service.spec.ts` 无新增失败。

- [ ] **Step 8: commit 读侧求值器**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/customers/customer-access.service.ts \
        src/modules/identity/customers/customer-access.service.spec.ts \
        src/modules/identity/customers/customers.module.ts \
        src/modules/funds-orders/funds-order.service.ts
git commit -m "feat(customers): CustomerAccessService 收口读侧求值 —— blocked/disclosedBlocked 双集分离 + 销户三前置"
```

- [ ] **Step 9: 写 tipping-off 守则性测试**

创建 `Exchange_js/src/modules/identity/customers/customer-access.contract.spec.ts`：

```ts
import * as fs from 'fs';
import * as path from 'path';

/**
 * tipping-off 结构性保证的守则性测试。
 *
 * `blocked` 含 SILENT 限制的贡献，`openCount` 含 SILENT 的计数 —— 两者一旦出现在
 * 客户面响应里，被制裁客户的按钮就会置灰 / 计数就会 +1，置灰与计数本身即是信号，
 * 等于告知调查。客户面只允许出现 `disclosedBlocked` 与 `disclosed`。
 *
 * 本测试扫源码文本而非运行时对象：字段是否泄露在写代码那一刻就该被逮住，
 * 而不是等某条运行路径恰好被覆盖到。
 */

const FORBIDDEN_FIELDS = ['blocked', 'openCount'] as const;

/** 去掉注释，免得正文里解释「不许出现 blocked」的注释把自己打成违规。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** 标识符边界匹配：`blockedReason` / `disclosedBlocked` 不算命中，`blocked!:` 算。 */
function findForbiddenFields(source: string): string[] {
  const body = stripComments(source);
  return FORBIDDEN_FIELDS.filter((field) =>
    new RegExp(`(?<![A-Za-z0-9_$])${field}(?![A-Za-z0-9_$])`).test(body),
  );
}

/**
 * 扫描目标 = 客户面 DTO / 响应构造代码。
 * customer-restrictions.client.controller.ts 由 Task 9 建；在它落地之前本行用
 * fs.existsSync 跳过（跳过而不是删掉，是为了它一出生就自动进扫描范围）。
 */
const CLIENT_SURFACE_FILES = [
  path.resolve(__dirname, '../onboarding/dto/onboarding.dto.ts'),
  path.resolve(__dirname, './customer-restrictions.client.controller.ts'),
];

describe('客户面字段守则：探测器自检', () => {
  it('命中真正的字段声明', () => {
    expect(findForbiddenFields('  blocked!: Set<Capability>;')).toEqual(['blocked']);
    expect(findForbiddenFields('  openCount!: number;')).toEqual(['openCount']);
    expect(findForbiddenFields("  return { blocked: [...access.blocked] };")).toEqual(['blocked']);
  });

  it('不误伤同前缀 / 同后缀的合法标识符', () => {
    expect(findForbiddenFields('  blockedReason: string | null;')).toEqual([]);
    expect(findForbiddenFields('  disclosedBlocked!: Capability[];')).toEqual([]);
    expect(findForbiddenFields('  openCounter = 1;')).toEqual([]);
  });

  it('注释里的字段名不算违规', () => {
    expect(findForbiddenFields('// 禁止出现 blocked / openCount')).toEqual([]);
    expect(findForbiddenFields('/* blocked 只允许留在服务端 */')).toEqual([]);
  });
});

describe('客户面 DTO / 响应构造不得出现 blocked 与 openCount', () => {
  for (const file of CLIENT_SURFACE_FILES) {
    const rel = path.relative(path.resolve(__dirname, '../../../..'), file);
    const runner = fs.existsSync(file) ? it : it.skip;
    runner(`${rel} 干净`, () => {
      const hits = findForbiddenFields(fs.readFileSync(file, 'utf8'));
      expect(hits).toEqual([]);
    });
  }
});
```

- [ ] **Step 10: 用哨兵证明守则确实会咬（红）**

守则性测试在干净仓库里天然是绿的，必须先证明它不是空转。在 `Exchange_js/src/modules/identity/onboarding/dto/onboarding.dto.ts` 第 218 行 `  blockedReason: string | null;` 之后插入一行哨兵：

```ts
  openCount: number;
```

然后跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/customers/customer-access.contract.spec.ts
```

期望输出：探测器自检 3 条全过，扫描用例失败：
```
● 客户面 DTO / 响应构造不得出现 blocked 与 openCount › src/modules/identity/onboarding/dto/onboarding.dto.ts 干净

    expect(received).toEqual(expected)
    - Expected  - 1
    + Received  + 3
    - Array []
    + Array [
    +   "openCount",
    + ]
```

- [ ] **Step 11: 撤哨兵、确认转绿**

把 Step 10 插入的那一行 `  openCount: number;` 从 `onboarding.dto.ts` 删除（用编辑器删除该行，不要 `git checkout --`，以免连带回滚同文件的其它未提交改动），然后确认文件已复原且测试转绿：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git diff --stat src/modules/identity/onboarding/dto/onboarding.dto.ts
npx jest src/modules/identity/customers/customer-access.contract.spec.ts
```

期望：`git diff --stat` 无任何输出（文件与 HEAD 一致）；jest 输出 `Tests:       1 skipped, 4 passed, 5 total`（client controller 那条 skip，Task 9 建完后自动转为 passed）。

- [ ] **Step 12: commit 守则性测试**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/customers/customer-access.contract.spec.ts
git commit -m "test(customers): 守则性测试锁死客户面 DTO 不得出现 blocked / openCount"
```

**验收标准**：`npx jest src/modules/identity/customers` 全绿（含 12 条读侧断言 + 5 条守则断言，其中 1 条 skip）；`npx tsc --noEmit` 0 错；`CustomerAccessService` 已从 `CustomersModule` exports，Task 5 起的所有读侧改造可直接 DI 注入。

---

- [ ] **Step 13: 建 `CustomerRestrictionWorkflowService`（只含自动侧两个方法）**

> **为什么在这里建**：Task 7（四个自动冻结点迁移）与 Task 8（兑换 KYT 迁移）都要调 `autoRelease()`，
> 它们在 Task 10 之前执行。若等到 Task 10 才建这个类，Task 7 第一步就编译不过。
> 所以本步骤先把**自动侧**（`openRestriction` / `autoRelease`）落地；**审批侧**
> （`initiateRelease` / `onReleaseDecided`）由 Task 10 往同一个类上追加。

新建 `src/modules/identity/customers/customer-restriction-workflow.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CustomerRestrictionsService, OpenRestrictionInput } from './customer-restrictions.service';
import { RestrictionCause } from './constants/restriction-cause.constant';

/**
 * 限制账的编排层。
 *
 * 本轮分两批落地：
 *  - Task 4（本步骤）：自动侧 —— openRestriction / autoRelease。四个自动冻结点、
 *    兑换 KYT 拒绝、admin 手工贴便签都走 openRestriction；材料补齐、Sumsub 复核判绿、
 *    升级审批通过走 autoRelease。这条路【不走审批】（设计稿 §3.3 规矩 R3：自动撕不审批）。
 *  - Task 10：审批侧 —— initiateRelease / onReleaseDecided。人工撕一律走审批。
 *
 * Rule 5：workflow 不得直写 domain 表，所有落库都经 CustomerRestrictionsService。
 */
@Injectable()
export class CustomerRestrictionWorkflowService {
  private readonly logger = new Logger(CustomerRestrictionWorkflowService.name);

  constructor(private readonly restrictionsService: CustomerRestrictionsService) {}

  /** 贴便签。立即生效，不开审批（设计稿 §3.3 规矩 R4：摁住不审批，放行才审批）。 */
  async openRestriction(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }> {
    return this.restrictionsService.open(input);
  }

  /**
   * 自动撕。按 (customerId, cause, caseRef) 精确定位那一张便签再撕
   * —— 绝不"无条件清空"，这正是旧的单列 complianceStatus 模型出事的地方：
   * 材料补齐时无条件写 complianceStatus:'CLEAR'，把同一个客户身上的制裁冻结一起抹掉。
   * 找不到对应 OPEN 便签时是 no-op（幂等，webhook 可能重投）。
   */
  async autoRelease(
    customerId: string,
    cause: RestrictionCause,
    caseRef: string | null,
    actorId: string,
  ): Promise<void> {
    const row = await this.restrictionsService.findOpenByCause(customerId, cause, caseRef);
    if (!row) {
      this.logger.debug(
        `autoRelease no-op: customer=${customerId} cause=${cause} caseRef=${caseRef ?? 'null'} — no OPEN restriction`,
      );
      return;
    }
    await this.restrictionsService.release(row.restrictionNo, {
      releasedBy: actorId,
      releaseMode: 'AUTO',
    });
  }
}
```

在 `src/modules/identity/customers/customers.module.ts` 的 `providers` 与 `exports` 两处都加上 `CustomerRestrictionWorkflowService`（与本 Task 前面加的 `CustomerAccessService` 并列）。

- [ ] **Step 14: 写并跑 autoRelease 的精确定位测试**

新建 `src/modules/identity/customers/customer-restriction-workflow.service.spec.ts`：

```ts
import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';

describe('CustomerRestrictionWorkflowService.autoRelease', () => {
  const buildWf = () => {
    const restrictionsService = {
      open: jest.fn(),
      release: jest.fn(),
      findOpenByCause: jest.fn(),
    } as any;
    return { wf: new CustomerRestrictionWorkflowService(restrictionsService), restrictionsService };
  };

  it('releases exactly the matching restriction, with mode AUTO', async () => {
    const { wf, restrictionsService } = buildWf();
    restrictionsService.findOpenByCause.mockResolvedValue({ restrictionNo: 'RST2608160002' });

    await wf.autoRelease('cust-1', 'MATERIAL_EXPIRED', 'MRC26073100xx', 'system');

    expect(restrictionsService.findOpenByCause).toHaveBeenCalledWith(
      'cust-1', 'MATERIAL_EXPIRED', 'MRC26073100xx',
    );
    expect(restrictionsService.release).toHaveBeenCalledWith('RST2608160002', {
      releasedBy: 'system',
      releaseMode: 'AUTO',
    });
    expect(restrictionsService.release).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when no matching OPEN restriction exists (idempotent webhook replay)', async () => {
    const { wf, restrictionsService } = buildWf();
    restrictionsService.findOpenByCause.mockResolvedValue(null);

    await wf.autoRelease('cust-1', 'KYT_REJECTED_SOFT', 'SW2608160001', 'system');

    expect(restrictionsService.release).not.toHaveBeenCalled();
  });
});
```

```bash
npx jest src/modules/identity/customers/customer-restriction-workflow.service.spec.ts
```
期望第一次 FAIL（`Cannot find module './customer-restriction-workflow.service'`），完成 Step 13 后重跑期望 `Tests: 2 passed`。

- [ ] **Step 15: 提交**

```bash
git add src/modules/identity/customers/customer-restriction-workflow.service.ts \
        src/modules/identity/customers/customer-restriction-workflow.service.spec.ts \
        src/modules/identity/customers/customers.module.ts
git commit -m "feat(identity): 限制账编排层自动侧（openRestriction / autoRelease）"
```

---

### Task 5: 交易门统一 —— `assertTradingEligibility` 与 `ensureCustomerCanTransact` 收敛到 `CustomerAccessService`

**前置**：Task 1（`CustomerMain.lifecycle` 列 + `prisma generate`）与 Task 4（`CustomerAccessService` 已实现并从 `CustomersModule` 导出）必须已落地，本段只改读侧调用方。

**本段口径（先定死，避免执行时二次决策）**：
- `customer-transaction-guard.ts` **整文件删除**，不留薄封装。全仓交易门只剩一条实现链：`CustomerAccessService.assertCapability()`。
- 三个调用点逐个处置（`grep -rn "ensureCustomerCanTransact" src --include='*.ts'` 实测结果）：

| 调用点 | 今天 | 改法 | 理由 |
|---|---|---|---|
| `inbound-transfer-signals.service.ts:118-122` | 上一行已 `assertTradingEligibility(customerId,'DEPOSIT')`，紧接着又 findUnique + guard | 删 119-122 四行（含只服务于 guard 的 `customer` 局部变量） | (a) 改完后 guard 与上一行逐字等价，纯重复查库 |
| `swap-workflow.service.ts:201-202` | 先 findUnique + guard，下一行才 `assertTradingEligibility(ownerId,'SWAP')` | 删 201-202 两行 | 同上 |
| `withdraw-workflow.service.ts:248-254` | `ownerType==='CUSTOMER'` 时 findUnique + guard；本方法内**没有** `assertTradingEligibility` | 改为注入 `CustomerAccessService` 调 `assertCapability(userId,'WITHDRAW')`，闸门保留 | `WithdrawWorkflowService` 是 `exports` 出去的服务，controller 那道门不是唯一入口；出金不可逆，纵深防御不撤 |

- `autoExpireIfNeeded()` / `getCanonicalState()` 在 **Task 2 已被整体删除**（Task 2 在本任务之前执行）。本段重写 `assertTradingEligibility` 时**不得**再调用它们；本计划给出的替换代码已剔除该调用。若执行到此处它们还在，说明 Task 2 未完成，先回去补齐再动本段。
- 文档同步（truth / BACKLOG / glossary）归本 plan 收官 Task（设计稿 §9 清单），本段不写文档。

**Files:**

Create:
- 无（本段只改与删）

Modify:
- `src/modules/identity/onboarding/onboarding.service.ts` — L2-8（补 `Inject, forwardRef`）、L51 后（补 import）、L113-121（删 `tradingEligibilitySelect`）、L156-161（构造函数加第 5 参）、L595-604（删 `parseJsonArraySafely`，本段改动使其成孤儿）、L1366-1422（重写 `assertTradingEligibility`）
- `src/modules/identity/onboarding/onboarding.module.ts` — L1-11（补 import）、L13-17（imports 数组加 `forwardRef(() => CustomersModule)`）
- `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` — L20（换 import）、L182-198（构造函数加第 17 参）、L248-254（闸门改写）
- `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts` — L1-21（补 import）、L23-37（imports 数组加 `forwardRef(() => CustomersModule)`）
- `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts` — L11（删 import）、L119-122（删四行）
- `src/modules/trading/swap-transactions/swap-workflow.service.ts` — L6（删 import）、L201-202（删两行）
- `src/modules/identity/auth/jwt.strategy.ts` — L25-43（CUSTOMER 分支整段重写）
- `src/modules/identity/auth/customer-auth.service.ts` — L182-211（FROZEN 拒登录整段重写为 OFFBOARDED）
- `client-web/src/utils/customerFetch.ts` — L2-4、L40-41、L87（`CUSTOMER_ACCOUNT_FROZEN` 本段后端已不再产出，属本段造成的孤儿常量）
- `client-web/src/pages/CustomerLogin.tsx` — L50-53、L87-89

Delete:
- `src/modules/trading/shared/customer-transaction-guard.ts`（46 行，全文件）

Test:
- `src/modules/identity/onboarding/onboarding.service.spec.ts` — L100-106 后加 mock、L131-136（构造函数第 5 参）、L640-757（交易门用例块整体重写）、L1500-1528（auto-expire 用例改由 access 门拒）
- `src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts` — L31 后加 mock、L128（构造函数补参）、L131 后加 mock 复位、L195 后加两条新用例
- `src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts` — 10 处 `new WithdrawWorkflowService(` 构造补参（9 处 perl 批量 + L682 手改）
- `src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts` — 3 处构造补参（perl 批量）
- `src/modules/identity/auth/jwt.strategy.spec.ts` — L68-131（三条合规态用例重写）
- `src/modules/identity/auth/customer-auth.service.spec.ts` — L30-44（FROZEN 拒登录 → OFFBOARDED）、L46 前加 SANCTION 放行用例
- `src/modules/identity/auth/customer-auth.controller.spec.ts` — L79-96（错误码换 `CUSTOMER_ACCOUNT_CLOSED`）

**Interfaces:**

Consumes（Task 4 产出，逐字不改）：
```ts
// src/modules/identity/customers/customer-access.service.ts
export type Capability = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
class CustomerAccessService {
  assertCapability(customerId: string, capability: Capability): Promise<void>;
  // 抛 ForbiddenException：lifecycle !== 'ACTIVE' → { code:'LIFECYCLE_NOT_ACTIVE' }
  //                        blocked.has(capability) → { code:'CAPABILITY_RESTRICTED' }
  // 错误体禁止携带 cause / visibility（SILENT 限制的存在本身即 tipping-off 信号）
}
```
```ts
// CustomersModule 必须 exports: [CustomerAccessService]（Task 4）
// prisma: CustomerMain.lifecycle: string（Task 1）
```

Produces：
```ts
// src/modules/identity/onboarding/onboarding.service.ts —— 签名不变，实现改为纯委托
async assertTradingEligibility(customerId: string, action: TradeAction): Promise<void>
// TradeAction = 'SWAP' | 'WITHDRAW' | 'DEPOSIT'（L56，与 Capability 结构等价，无需断言）

// src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts —— 构造函数第 17 参
constructor(..., private readonly applicantActions: WithdrawApplicantActionsService,
            private readonly customerAccessService: CustomerAccessService)

// 删除（全仓零残留）：
//   ensureCustomerCanTransact(customer, capability?) : void
//   interface CustomerGateFields
```

---

- [ ] **Step 1: 核对 Task 4 契约与本段全部调用点真身**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
grep -n "assertCapability" src/modules/identity/customers/customer-access.service.ts
grep -n "CustomerAccessService" src/modules/identity/customers/customers.module.ts
grep -rn "ensureCustomerCanTransact" src --include='*.ts'
grep -c "new WithdrawWorkflowService(" src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts
```

期望：`assertCapability(` 命中一行；`customers.module.ts` 的 `exports` 含 `CustomerAccessService`；`ensureCustomerCanTransact` 恰 7 行命中（1 定义 + 3 import + 3 调用）；三个 spec 的构造点计数为 `10 / 3 / 1`。任一项对不上就停下来先修 Task 4，不要往下走。

- [ ] **Step 2（RED）: 重写 onboarding 交易门单测**

先在 `src/modules/identity/onboarding/onboarding.service.spec.ts` 的 `sumsubClientMock` 块之后（L106 后）插入 mock：

```ts
  const customerAccessServiceMock: any = {
    resolve: jest.fn(),
    assertCapability: jest.fn(),
    assertOffboardable: jest.fn(),
  };
```

把 L131-136 的构造调用改为：

```ts
    service = new OnboardingService(
      prismaMock,
      onboardingFinalApprovalServiceMock,
      sumsubClientMock,
      { recordByActor: recordByActorSpy, recordSystem: jest.fn().mockResolvedValue({}) } as any,
      customerAccessServiceMock,
    );
    customerAccessServiceMock.assertCapability.mockResolvedValue(undefined);
```

再把 L640-757（从 `it('should allow trading when canonical onboarding is APPROVED and active'` 起，到 `restrictions 含 SWAP 时拦截 SWAP，放行 DEPOSIT` 用例的 `});` 止）整块替换为：

```ts
  // ── 交易门（Task 5：唯一实现在 CustomerAccessService）──
  // 本块只断言 OnboardingService 这一层：委托对不对、错误体有没有被它加料。
  // lifecycle / 限制账的语义本身由 customer-access.service.spec.ts 覆盖。
  const activeCustomerRow = {
    id: 'c1',
    customerNo: 'CU1',
    cddDocumentExpiresAt: null,
    onboardingStatus: 'APPROVED',
    adminStatus: 'ACTIVE',
    complianceStatus: 'CLEAR',
  };

  it('access 门放行 + 法币提现地址已激活 → 放行', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(activeCustomerRow);
    prismaMock.withdrawalAddress.count.mockResolvedValue(1);

    await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
    expect(customerAccessServiceMock.assertCapability).toHaveBeenCalledTimes(1);
    expect(customerAccessServiceMock.assertCapability).toHaveBeenCalledWith('c1', 'SWAP');
  });

  describe('assertTradingReady (fiat withdrawal address gate)', () => {
    it('should throw NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS when not ready and action=SWAP', async () => {
      prismaMock.customerMain.findUnique.mockResolvedValue(activeCustomerRow);
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);

      await expect(service.assertTradingEligibility('c1', 'SWAP')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS' }),
      });
    });

    it('should pass when an active fiat withdrawal address exists and action=SWAP', async () => {
      prismaMock.customerMain.findUnique.mockResolvedValue(activeCustomerRow);
      prismaMock.withdrawalAddress.count.mockResolvedValue(1);

      await expect(service.assertTradingEligibility('c1', 'SWAP')).resolves.toBeUndefined();
    });

    it('should NOT throw for the fiat-address reason when not ready and action=DEPOSIT', async () => {
      prismaMock.customerMain.findUnique.mockResolvedValue(activeCustomerRow);
      prismaMock.withdrawalAddress.count.mockResolvedValue(0);

      await expect(service.assertTradingEligibility('c1', 'DEPOSIT')).resolves.toBeUndefined();
      expect(prismaMock.withdrawalAddress.count).not.toHaveBeenCalled();
    });
  });

  it('SILENT 限制客户：抛 CAPABILITY_RESTRICTED，错误体不含 cause / visibility / 合规字段', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(activeCustomerRow);
    customerAccessServiceMock.assertCapability.mockRejectedValue(
      new ForbiddenException({
        code: 'CAPABILITY_RESTRICTED',
        message: 'WITHDRAW is currently restricted',
        customerId: 'c1',
      }),
    );

    const err = await service
      .assertTradingEligibility('c1', 'WITHDRAW')
      .then(() => null)
      .catch((e) => e as ForbiddenException);

    expect(err).toBeInstanceOf(ForbiddenException);
    const body = (err as ForbiddenException).getResponse() as Record<string, unknown>;
    expect(body.code).toBe('CAPABILITY_RESTRICTED');
    // tipping-off 命门：为什么被摁住，一个字都不许出现在错误体里。
    // 旧实现会往里塞 onboardingStatus / complianceStatus / complianceFreezeCaseId。
    expect(Object.keys(body).sort()).toEqual(['code', 'customerId', 'message']);
    expect(JSON.stringify(body)).not.toMatch(
      /cause|visibility|SANCTION|complianceStatus|complianceFreezeCaseId|adminStatus|onboardingStatus/i,
    );
    // 被门拒之后不再往下查法币地址
    expect(prismaMock.withdrawalAddress.count).not.toHaveBeenCalled();
  });

  it('lifecycle 非 ACTIVE：直接抛 LIFECYCLE_NOT_ACTIVE，不查法币地址', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(activeCustomerRow);
    customerAccessServiceMock.assertCapability.mockRejectedValue(
      new ForbiddenException({ code: 'LIFECYCLE_NOT_ACTIVE', message: 'WITHDRAW is blocked' }),
    );

    await expect(service.assertTradingEligibility('c1', 'WITHDRAW')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'LIFECYCLE_NOT_ACTIVE' }),
    });
    expect(prismaMock.withdrawalAddress.count).not.toHaveBeenCalled();
  });

  it('DEPOSIT 被限制时同样拦截（能力门不区分动作）', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(activeCustomerRow);
    customerAccessServiceMock.assertCapability.mockRejectedValue(
      new ForbiddenException({ code: 'CAPABILITY_RESTRICTED', message: 'DEPOSIT is currently restricted' }),
    );

    await expect(service.assertTradingEligibility('c1', 'DEPOSIT')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(customerAccessServiceMock.assertCapability).toHaveBeenCalledWith('c1', 'DEPOSIT');
  });

  it('should throw when customer does not exist for trading gate', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue(null);

    await expect(service.assertTradingEligibility('missing', 'SWAP')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    // 不存在的客户在 autoExpireIfNeeded 就被挡住，不该再打扰能力门
    expect(customerAccessServiceMock.assertCapability).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3（RED 确认）: 跑它，确认红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/onboarding/onboarding.service.spec.ts 2>&1 | tail -25
```

期望：整个 suite 编译失败，输出含
`error TS2554: Expected 4 arguments, but got 5.`（构造函数还没有第 5 参）。这就是 RED。

- [ ] **Step 4（GREEN）: 改 `onboarding.service.ts` —— 注入 + 重写门 + 清孤儿**

改 L2-8 的 `@nestjs/common` import 为：

```ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
```

在 L51 `import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';` 之后加一行：

```ts
import { CustomerAccessService } from '../customers/customer-access.service';
```

删除 L113-121 整块（`tradingEligibilitySelect` 常量，本段改动后零引用）：

```ts
const tradingEligibilitySelect = {
  id: true,
  customerNo: true,
  onboardingStatus: true,
  adminStatus: true,
  complianceStatus: true,
  complianceFreezeCaseId: true,
  restrictions: true,
} satisfies Prisma.CustomerMainSelect;
```

L156-161 构造函数改为：

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingFinalApprovalService: OnboardingFinalApprovalService,
    private readonly sumsubClient: SumsubClient,
    private readonly auditLogsService: AuditLogsService,
    // forwardRef：CustomersModule 已 forwardRef 回 OnboardingModule（取 SumsubClient），
    // 本段让 Onboarding 反向依赖 Customers，两侧模块与此处三点同时 forwardRef 才断得掉环。
    @Inject(forwardRef(() => CustomerAccessService))
    private readonly customerAccessService: CustomerAccessService,
  ) {}
```

删除 L595-604 整块（`parseJsonArraySafely`，本段改动后零引用）：

```ts
  private parseJsonArraySafely<T = unknown>(value?: string | null): T[] {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
```

L1366-1422 的 `assertTradingEligibility` 整体替换为：

```ts
  async assertTradingEligibility(customerId: string, action: TradeAction) {
    // ⚠️ 这里【没有】autoExpireIfNeeded 调用 —— Task 2 已把该方法连同它的四个调用点
    // （含本方法内的那一个）整体删除，理由是它会把 ACTIVE 客户打回 PENDING_CDD_INPUT，
    // 违反 INV-1 且写的是已废弃的遗留值。材料过期改由 MATERIAL_EXPIRED 便签承接。
    // 若你在此处看到 tsc 报"找不到 autoExpireIfNeeded"，说明 Task 2 没做完，回去补。

    // Task 5：交易门的唯一执法依据是 CustomerAccessService（lifecycle 轴 + 限制账）。
    // 这里既不自己读状态列、也不自己解析限制行，更不许把 cause / visibility 拌进
    // 错误体——SILENT 限制的存在本身就是 tipping-off 信号。
    await this.customerAccessService.assertCapability(customerId, action);

    if (action !== 'DEPOSIT') {
      await this.assertTradingReady(customerId);
    }
  }
```

- [ ] **Step 5（GREEN 确认 + 修 auto-expire 用例）: 跑单测**

先跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/onboarding/onboarding.service.spec.ts 2>&1 | tail -25
```

期望：新交易门用例全绿，唯一剩红的是
`● OnboardingService › should auto-expire and block DEPOSIT trading when canonical CDD is expired`
（它靠第二次 findUnique 返回 INACTIVE 来拒，现在拒的责任在能力门）。把 L1500-1528 该用例替换为：

```ts
  it('should auto-expire and block DEPOSIT trading when canonical CDD is expired', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'APPROVED',
      adminStatus: 'ACTIVE',
      complianceStatus: 'CLEAR',
      cddDocumentExpiresAt: new Date(Date.now() - 60 * 1000),
    });
    prismaMock.customerMain.update.mockResolvedValue({
      id: 'c1',
      onboardingStatus: 'PENDING_CDD_INPUT',
      adminStatus: 'INACTIVE',
      complianceStatus: 'CLEAR',
    });
    // 过期回写把客户踢出 ACTIVE 后，拒绝由能力门做出（本服务不再自己判状态）
    customerAccessServiceMock.assertCapability.mockRejectedValue(
      new ForbiddenException({ code: 'LIFECYCLE_NOT_ACTIVE', message: 'DEPOSIT is blocked' }),
    );

    await expect(service.assertTradingEligibility('c1', 'DEPOSIT')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prismaMock.customerMain.update).toHaveBeenCalledTimes(1);
  });
```

再跑一次同一条命令，期望：`Tests: ... passed`，该文件 0 失败。

- [ ] **Step 6: 模块接线 `onboarding.module.ts`**

在 L10 `import { MaterialRefreshService } from '../material-refresh/material-refresh.service';` 之后加：

```ts
import { CustomersModule } from '../customers/customers.module';
```

imports 数组（L13-17）改为：

```ts
  imports: [
    PrismaModule,
    ApprovalsModule,
    forwardRef(() => MaterialRefreshModule),
    // Task 5：OnboardingService 注入 CustomerAccessService（交易门收敛）。
    // CustomersModule 本来就 forwardRef 回本模块（客户级补料会话取 SumsubClient），
    // 双向都必须 forwardRef，否则 require 环里有一侧在 @Module() 装饰时读到 undefined。
    forwardRef(() => CustomersModule),
  ],
```

跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx tsc --noEmit 2>&1 | head -20
```

期望：无输出（0 错）。

- [ ] **Step 7: commit（onboarding 段）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/onboarding/onboarding.service.ts src/modules/identity/onboarding/onboarding.service.spec.ts src/modules/identity/onboarding/onboarding.module.ts
git commit -m "refactor(identity): assertTradingEligibility 收敛到 CustomerAccessService，删重复 FROZEN 判断与手工 restrictions 解析"
```

- [ ] **Step 8（RED）: withdraw 工作流能力门单测**

`src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts`，在 L31 `let module: TestingModule;` 之后插入：

```ts
  const customerAccessServiceMock: any = { assertCapability: jest.fn() };
```

L128 `      {} as any, // applicantActions` 之后插入一行：

```ts
      customerAccessServiceMock, // customerAccessService
```

L131 `jest.clearAllMocks();` 之后插入一行：

```ts
    customerAccessServiceMock.assertCapability.mockResolvedValue(undefined);
```

在 L195（`should create withdraw in COMPLIANCE_PENDING (CRYPTO)` 用例的 `});`）之后插入两条用例：

```ts
  it('客户提现建单前过 CustomerAccessService 能力门（WITHDRAW）', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    mockTx.withdrawTransaction.create.mockResolvedValue({
      id: 'wd-gate-1',
      ownerType: 'CUSTOMER',
      ownerId: 'user-1',
      assetId: 'asset-1',
      amount: new Prisma.Decimal(100),
      netAmount: new Prisma.Decimal(100),
      feeAmount: new Prisma.Decimal(0),
      withdrawNo: 'WD1009',
      fromWalletId: null,
      fromWalletNo: null,
      toWalletId: null,
      toWalletNo: null,
    });
    mockTx.auditLogEvent.create.mockResolvedValue({ id: 'audit-gate-1' });

    await workflow.createWithdrawal(
      { assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any,
      'user-1',
    );

    expect(customerAccessServiceMock.assertCapability).toHaveBeenCalledWith('user-1', 'WITHDRAW');
  });

  it('能力门拒绝时不落单、不开事务', async () => {
    prisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', type: 'CRYPTO' });
    customerAccessServiceMock.assertCapability.mockRejectedValue(
      new ForbiddenException({ code: 'CAPABILITY_RESTRICTED', message: 'WITHDRAW is currently restricted' }),
    );

    await expect(
      workflow.createWithdrawal(
        { assetId: 'asset-1', amount: 100, quoteId: 'wq-1' } as any,
        'user-1',
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CAPABILITY_RESTRICTED' }),
    });

    expect(mockTx.withdrawTransaction.create).not.toHaveBeenCalled();
  });
```

跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts 2>&1 | tail -20
```

期望：suite 编译失败，`error TS2554: Expected 16 arguments, but got 17.` —— RED。

- [ ] **Step 9（GREEN）: 改 `withdraw-workflow.service.ts`**

L20 的 import 换掉：

```ts
import { CustomerAccessService } from '../../identity/customers/customer-access.service';
```

构造函数末尾（L197 `private readonly applicantActions: WithdrawApplicantActionsService,` 之后）加一行：

```ts
    private readonly customerAccessService: CustomerAccessService,
```

L248-254 整块替换为：

```ts
    // Task 5：客户级 lifecycle + 限制账闸门。全仓唯一实现在 CustomerAccessService；
    // 本服务是 exports 出去的 workflow，customer controller 的 assertTradingEligibility
    // 不是唯一入口，出金不可逆 —— 这道纵深防御保留。
    if (ownerType === 'CUSTOMER') {
      await this.customerAccessService.assertCapability(userId, 'WITHDRAW');
    }
```

- [ ] **Step 10（GREEN）: 批量补齐其余 13 处 workflow 构造点**

12 处形如 `{} as any, // applicantActions` 的，用一条命令补：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
perl -0pi -e 's/^(\s*)\{\} as any, \/\/ applicantActions$/$1\{\} as any, \/\/ applicantActions\n$1\{ assertCapability: jest.fn() \} as any, \/\/ customerAccessService/gm' \
  src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts \
  src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts
grep -c "customerAccessService" src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts
```

期望输出：`...withdraw-fee-income.service.spec.ts:3` 与 `...withdraw-workflow.service.spec.ts:9`。

剩下 1 处（`withdraw-workflow.service.spec.ts` L682，`buildFullWorkflow` 用的是具名 mock）手改，把：

```ts
    applicantActions as any,
  );
```

改为：

```ts
    applicantActions as any,
    { assertCapability: jest.fn() } as any, // customerAccessService
  );
```

- [ ] **Step 11: withdraw 模块接线 + 跑三个 spec**

`src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`，在 L20 `import { DepositSumsubModule } from '../../deposit-sumsub/deposit-sumsub.module';` 之后加：

```ts
import { CustomersModule } from '../../identity/customers/customers.module';
```

imports 数组末尾（`forwardRef(() => DepositSumsubModule),` 之后）加：

```ts
    // Task 5：WithdrawWorkflowService 注入 CustomerAccessService（客户级能力门）。
    // forwardRef 同 SwapTransactionsModule 的同名 import——CustomersModule 会绕回
    // OnboardingModule，require 链能折回本模块。
    forwardRef(() => CustomersModule),
```

跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts 2>&1 | tail -15
```

期望：三个 suite 全 `PASS`，含新加的两条用例。

- [ ] **Step 12: 删 guard 文件 + 摘掉 deposit / swap 两处重复调用**

`src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts`：删 L11 的 import 行，并把 L118-123 改为：

```ts
    await this.onboardingService.assertTradingEligibility(customerId, 'DEPOSIT');
    const wallet = await this.getCustomerDepositWalletOrThrow(customerId, dto.walletId);
```

`src/modules/trading/swap-transactions/swap-workflow.service.ts`：删 L6 的 import 行，并把 L199-203 改为：

```ts
  async initiateSwap(ownerId: string, quoteId: string) {
    // ── L1 Eligibility gate (synchronous) ──
    await this.onboardingService.assertTradingEligibility(ownerId, 'SWAP');
```

删文件并验残留：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git rm src/modules/trading/shared/customer-transaction-guard.ts
grep -rn "ensureCustomerCanTransact\|CustomerGateFields" src client-web/src admin-web/src test
npx tsc --noEmit 2>&1 | head -20
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts src/modules/trading/deposit-transactions/inbound-transfer-signals.service.spec.ts 2>&1 | tail -12
```

期望：grep 零命中；`tsc` 无输出；两个 suite `PASS`。

- [ ] **Step 13: commit（trading 段）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/trading/shared/customer-transaction-guard.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts src/modules/trading/withdraw-transactions/withdraw-transactions.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts src/modules/trading/withdraw-transactions/withdraw-fee-income.service.spec.ts src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts src/modules/trading/swap-transactions/swap-workflow.service.ts
git commit -m "refactor(trading): 删 ensureCustomerCanTransact，三域交易门统一走 CustomerAccessService.assertCapability"
```

- [ ] **Step 14（RED）: jwt.strategy 单测反转语义**

把 `src/modules/identity/auth/jwt.strategy.spec.ts` 的 L68-131（三条 `complianceStatus` 用例）整块替换为：

```ts
  it('制裁客户（有 OPEN SANCTION 限制）会话照常放行 —— 本轮语义反转', async () => {
    // 零痕迹：被制裁客户必须能登录、能看页面。禁不禁得动由能力门在动作那一刻拒，
    // 会话层一旦拒，403 本身就是告知调查（tipping-off）。
    prismaMock.customerMain.findUnique.mockResolvedValue({
      id: 'c1',
      lifecycle: 'ACTIVE',
    });

    await expect(
      strategy.validate({
        sub: 'c1',
        username: 'test@example.com',
        userNo: 'CU-1',
        role: 'CUSTOMER',
        type: 'CUSTOMER',
      }),
    ).resolves.toEqual({
      userId: 'c1',
      username: 'test@example.com',
      userNo: 'CU-1',
      role: 'CUSTOMER',
      roleCodes: ['CUSTOMER'],
      type: 'CUSTOMER',
      scope: null,
    });
  });

  it('会话层只读 lifecycle，不再读任何合规列', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', lifecycle: 'ACTIVE' });

    await strategy.validate({
      sub: 'c1',
      username: 'test@example.com',
      userNo: 'CU-1',
      role: 'CUSTOMER',
      type: 'CUSTOMER',
    });

    expect(prismaMock.customerMain.findUnique).toHaveBeenCalledWith({
      where: { id: 'c1' },
      select: { id: true, lifecycle: true },
    });
  });

  it.each(['REJECTED', 'WITHDRAWN'])('lifecycle=%s 仍放行（要能重新申请）', async (lifecycle) => {
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', lifecycle });

    await expect(
      strategy.validate({
        sub: 'c1',
        username: 'test@example.com',
        userNo: 'CU-1',
        role: 'CUSTOMER',
        type: 'CUSTOMER',
      }),
    ).resolves.toMatchObject({ userId: 'c1', type: 'CUSTOMER' });
  });

  it('lifecycle=OFFBOARDED 拒绝会话，code=CUSTOMER_ACCOUNT_CLOSED', async () => {
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', lifecycle: 'OFFBOARDED' });

    const err = await strategy
      .validate({
        sub: 'c1',
        username: 'test@example.com',
        userNo: 'CU-1',
        role: 'CUSTOMER',
        type: 'CUSTOMER',
      })
      .then(() => null)
      .catch((e) => e as ForbiddenException);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'CUSTOMER_ACCOUNT_CLOSED',
    });
  });
```

跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/auth/jwt.strategy.spec.ts 2>&1 | tail -20
```

期望：`制裁客户…照常放行` 与 `只读 lifecycle` 两条红（现实现读 `complianceStatus`、select 不匹配），`OFFBOARDED` 一条红。RED 到位。

- [ ] **Step 15（GREEN）: 改 `jwt.strategy.ts`**

L25-43 的 CUSTOMER 分支整块替换为：

```ts
    if (payload?.type === 'CUSTOMER') {
      const customer = await this.prisma.customerMain.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          lifecycle: true,
        },
      });

      if (!customer) {
        throw new UnauthorizedException('Customer not found');
      }

      // Task 5：会话层只认关系是否终止。合规摁住（含 SANCTION）在这里一律不现形——
      // 每请求 403 本身就是告知调查。REJECTED / WITHDRAWN 同样放行：他们要能重新申请。
      if (String(customer.lifecycle || '').toUpperCase() === 'OFFBOARDED') {
        throw new ForbiddenException({
          code: 'CUSTOMER_ACCOUNT_CLOSED',
          message: '账号已关闭，无法访问。',
        });
      }
    }
```

跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/auth/jwt.strategy.spec.ts 2>&1 | tail -10
```

期望：`PASS`，全部用例绿。

- [ ] **Step 16（RED）: customer-auth 登录门单测**

把 `src/modules/identity/auth/customer-auth.service.spec.ts` 的 L30-44（`should reject login when compliance hold is frozen`）替换为下面两条：

```ts
  it('制裁客户（有 OPEN SANCTION 限制）允许登录 —— 本轮语义反转', async () => {
    const passwordHash = await bcrypt.hash('123456', 4);
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash,
      lifecycle: 'ACTIVE',
      failedLoginCount: 0,
      lockedUntil: null,
    });
    prismaMock.customerMain.update.mockResolvedValue({});

    await expect(
      service.validateCustomer('test@example.com', '123456'),
    ).resolves.toEqual(expect.objectContaining({ id: 'c1', email: 'test@example.com' }));

    // 零痕迹：不许写"登录被拒"的合规审计，登录页也就无从显示任何提示
    expect(auditLogsServiceMock.recordByActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ result: 'REJECTED' }),
      expect.anything(),
    );
  });

  it('lifecycle=OFFBOARDED 拒登录，code=CUSTOMER_ACCOUNT_CLOSED 且写 REJECTED 审计', async () => {
    prismaMock.customerMain.findFirst.mockResolvedValue({
      id: 'c1',
      customerNo: 'CU001',
      email: 'test@example.com',
      passwordHash: '$2b$10$abcdefghijklmnopqrstuv',
      lifecycle: 'OFFBOARDED',
      failedLoginCount: 0,
    });

    const err = await service
      .validateCustomer('test@example.com', '123456')
      .then(() => null)
      .catch((e) => e as ForbiddenException);

    expect(err).toBeInstanceOf(ForbiddenException);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      code: 'CUSTOMER_ACCOUNT_CLOSED',
    });
    expect(auditLogsServiceMock.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        result: 'REJECTED',
        reason: 'Customer login blocked: relationship offboarded',
      }),
      expect.objectContaining({ actorId: 'c1' }),
    );
    expect(prismaMock.customerMain.update).not.toHaveBeenCalled();
  });
```

把 L46 起的 `should allow login when restriction is active but hold is not frozen` 用例里的 `complianceStatus: 'CLEAR',` 一行改为 `lifecycle: 'ACTIVE',`。

跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/auth/customer-auth.service.spec.ts 2>&1 | tail -20
```

期望：`OFFBOARDED 拒登录` 红（现实现只认 `complianceStatus==='FROZEN'`，OFFBOARDED 会走到密码校验并 `resolve`）。RED 到位。

- [ ] **Step 17（GREEN）: 改 `customer-auth.service.ts`**

L182-211 整块替换为：

```ts
    // Task 5：登录门只认关系是否终止。冻结/受限客户一律允许登录——他们要能看到
    // DISCLOSED 提示、能补材料；SANCTION 客户则必须与常人无异（tipping-off 铁律）。
    if (String(customer.lifecycle || '').toUpperCase() === 'OFFBOARDED') {
      await this.auditLogsService.recordByActor(
        {
          action: AuditActions.CUSTOMER_LOGIN_FAILED,
          entityType: AuditEntityTypes.AUTH,
          entityId: customer.id,
          entityNo: customer.customerNo,
          result: AuditResult.REJECTED,
          reason: 'Customer login blocked: relationship offboarded',
          metadata: {
            lifecycle: customer.lifecycle || null,
            identifierHash: this.maskIdentifier(normalized),
          },
          requestId: ctx.requestId,
          sourceIp: ctx.sourceIp,
          sourcePlatform: ctx.sourcePlatform || 'CUSTOMER_AUTH_API',
        },
        {
          actorType: 'CUSTOMER',
          actorId: customer.id,
          actorNo: customer.customerNo,
          actorRole: 'CUSTOMER',
        },
      );
      throw new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_CLOSED',
        message: '账号已关闭，无法登录。',
      });
    }
```

同步把 `src/modules/identity/auth/customer-auth.controller.spec.ts` L79-85 改为：

```ts
  it('should reject login when customer account is closed', async () => {
    serviceMock.validateCustomer.mockRejectedValue(
      new ForbiddenException({
        code: 'CUSTOMER_ACCOUNT_CLOSED',
        message: '账号已关闭，无法登录。',
      }),
    );
```

跑：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/auth 2>&1 | tail -12
```

期望：auth 目录下所有 suite `PASS`。

- [ ] **Step 18: 清掉本段造成的 client-web 孤儿常量**

`client-web/src/utils/customerFetch.ts` L2-4 改为：

```ts
const ACCOUNT_CLOSED_CODE = 'CUSTOMER_ACCOUNT_CLOSED';
const ACCOUNT_CLOSED_MESSAGE =
  'Your account is closed. Please contact support for assistance.';
```

L40-41 改为：

```ts
  if (code === ACCOUNT_CLOSED_CODE) {
    persistLoginNotice(code, message || ACCOUNT_CLOSED_MESSAGE);
```

L87 改为：

```ts
      (code === ACCOUNT_CLOSED_CODE ? ACCOUNT_CLOSED_MESSAGE : SESSION_EXPIRED_MESSAGE);
```

`client-web/src/pages/CustomerLogin.tsx` L50-53 改为：

```ts
      if (String(parsed?.code || '').toUpperCase() === 'CUSTOMER_ACCOUNT_CLOSED') {
        setToastMessage(
          parsed?.message || 'Account closed. Please contact support.',
        );
```

L87-89 改为：

```ts
        if (code === 'CUSTOMER_ACCOUNT_CLOSED') {
          setError('');
          setToastMessage('Account closed. Please contact support.');
```

验残留 + 跑客户端测试：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
grep -rn "CUSTOMER_ACCOUNT_FROZEN" src client-web/src admin-web/src test
npm test --prefix client-web 2>&1 | tail -12
```

期望：grep 零命中；vitest 全绿。

- [ ] **Step 19: 硬闸门全跑**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx tsc --noEmit 2>&1 | head -20
npm test 2>&1 | tail -15
```

期望：`tsc` 无输出；`npm test` 相对本段开工前**净新增失败 0**（`wallets` 那 4 条 pre-existing 失败不算）。若出现 `Nest can't resolve dependencies of the OnboardingService (..., ?)` 一类，回 Step 6 / Step 11 检查两处 `forwardRef(() => CustomersModule)` 是否都加了。

- [ ] **Step 20: DI 真启动验证（forwardRef 双向断环只有 boot 才验得出来）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
bash scripts/stack.sh up
npm run test:e2e -- withdraw-money-arcs 2>&1 | tail -15
```

期望：`AppModule` 编译通过并跑完该 e2e（`PASS test/withdraw-money-arcs.e2e-spec.ts`）。这一步专门抓 `tsc` 抓不到的「模块在 @Module() 装饰时读到 undefined」。

- [ ] **Step 21: commit（auth 段）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/auth/jwt.strategy.ts src/modules/identity/auth/jwt.strategy.spec.ts src/modules/identity/auth/customer-auth.service.ts src/modules/identity/auth/customer-auth.service.spec.ts src/modules/identity/auth/customer-auth.controller.spec.ts client-web/src/utils/customerFetch.ts client-web/src/pages/CustomerLogin.tsx
git commit -m "refactor(auth): 会话/登录门只看 lifecycle=OFFBOARDED，制裁客户不再被拒登录（tipping-off 零痕迹）"
```

---

### Task 6: 客户面读侧 —— `/onboarding/me` 响应体改造 + profile-banners 改由 `disclosed` 驱动

本任务只动**客户面读侧**：把 `/onboarding/me`（客户端真正读的 profile 端点，不是 `/auth/me`）和顶部提示条两处，从「三根旧轴 + `restrictions` JSON 列」切到 `CustomerAccessService.resolve()`。tipping-off 命门在这一段落地：客户面响应体**只允许**承载 `lifecycle` / `disclosedBlocked` / `disclosed`，`blocked` 与 `openCount` 含 SILENT 贡献，出现即泄漏。

**Files:**

- Modify: `src/modules/identity/onboarding/onboarding.service.ts`
  - L2-8（`@nestjs/common` import 块，补 `Inject` / `forwardRef`）
  - L39 后（新增 `CustomerAccessService` import）
  - L156-161（constructor，加第 5 个依赖）
  - L1045-1062（`getMyOnboarding`）
  - L1064-1075（`buildCustomerSnapshot`，改签名收 `customerId`）
  - L1196、L1239（`buildCustomerSnapshot` 两处调用点）
- Modify: `src/modules/identity/onboarding/dto/onboarding.dto.ts`
  - L17-21（删 `customer-status.util` 三个类型 import）
  - L210-214（`StartVerificationCustomerSnapshotDto` 三字段整体替换）
- Modify: `src/modules/identity/onboarding/onboarding.module.ts` L12-17（imports 数组加 `forwardRef(() => CustomersModule)`）
- Modify: `src/modules/identity/profile-banners/profile-banners.service.ts`（整文件重写，125 行 → 约 128 行；材料 cycles 段 L72-118 逐字保留）
- Modify: `src/modules/identity/profile-banners/profile-banners.module.ts` L1-10（整文件）
- Test Modify: `src/modules/identity/onboarding/onboarding.service.spec.ts` L105-135（加 access mock + ctor 第 5 参 + beforeEach 缺省 resolve）、文件末尾追加 3 条用例
- Test Create: `src/modules/identity/profile-banners/profile-banners.service.spec.ts`

**Interfaces:**

Consumes（Task 4 产出，本任务只调用，不实现）：
```ts
// src/modules/identity/customers/customer-access.service.ts
export type Capability = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
export interface DisclosedRestrictionView {
  restrictionNo: string; cause: RestrictionCause; scopes: RestrictionScope[];
  label: string; reason: string; openedAt: string;
}
export interface CustomerAccess {
  lifecycle: CustomerLifecycle;
  blocked: Set<Capability>;
  disclosedBlocked: Set<Capability>;
  disclosed: DisclosedRestrictionView[];
  openCount: number;
}
class CustomerAccessService { resolve(customerId: string): Promise<CustomerAccess> }
// CustomersModule 已 exports CustomerAccessService（Task 4）
```
```ts
// src/modules/identity/constants/customer-lifecycle.constant.ts
export type CustomerLifecycle = 'PROSPECT' | 'IN_VERIFICATION' | 'PENDING_APPROVAL'
  | 'ACTIVE' | 'REJECTED' | 'WITHDRAWN' | 'OFFBOARDED';
// src/modules/identity/customers/constants/restriction-cause.constant.ts
export type RestrictionCause = 'SANCTION' | 'ADMIN_SUSPENSION' | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING' | 'KYT_REJECTED_SOFT' | 'KYT_REJECTED_HARD' | 'PENDING_DOCUMENT';
```

Produces：
```ts
// dto/onboarding.dto.ts —— 客户面唯一状态投影 DTO（名字不变，字段整体替换）
export interface StartVerificationCustomerSnapshotDto {
  lifecycle: CustomerLifecycle;
  disclosedBlocked: Capability[];
  disclosed: DisclosedRestrictionView[];
}

// onboarding.service.ts
private buildCustomerSnapshot(customerId: string): Promise<StartVerificationCustomerSnapshotDto>
async getMyOnboarding(customerId: string): Promise<
  Omit<CustomerMainRow, 'passwordHash' | 'hardLineDispositionedAt'>
  & StartVerificationCustomerSnapshotDto
  & { actions; blockedReason; activeCaseId; requiresEdd; verification }
>   // 不含 onboardingStatus / adminStatus / complianceStatus / restrictions / blocked / openCount

// profile-banners.service.ts
export interface ProfileBanner { type: 'MATERIAL_REFRESH' | 'RESTRICTION'; ... }  // 删 COMPLIANCE_HOLD / PEP_REVIEW_PENDING
class ProfileBannerService {
  constructor(prisma: PrismaService, customerAccessService: CustomerAccessService)
  getBannersFor(customerId: string): Promise<ProfileBanner[]>
}
```

---

- [ ] **Step 1: 给 onboarding spec 装上 access mock 与第 5 个 ctor 参数（先让它编译不过）**

打开 `src/modules/identity/onboarding/onboarding.service.spec.ts`，在 `sumsubClientMock`（L100-106）之后、`let service: OnboardingService;`（L108）之前插入：

```ts
  const customerAccessServiceMock: any = {
    resolve: jest.fn(),
    assertCapability: jest.fn(),
    assertOffboardable: jest.fn(),
  };

  /** CustomerAccess 缺省投影：ACTIVE、零限制。用例按需覆盖字段。 */
  const buildAccess = (overrides?: Record<string, unknown>) => ({
    lifecycle: 'ACTIVE',
    blocked: new Set<string>(),
    disclosedBlocked: new Set<string>(),
    disclosed: [] as Array<Record<string, unknown>>,
    openCount: 0,
    ...overrides,
  });
```

再把 `beforeEach` 里的 `service = new OnboardingService(...)`（L131-136）整段替换为：

```ts
    customerAccessServiceMock.resolve.mockResolvedValue(buildAccess());
    service = new OnboardingService(
      prismaMock,
      onboardingFinalApprovalServiceMock,
      sumsubClientMock,
      { recordByActor: recordByActorSpy, recordSystem: jest.fn().mockResolvedValue({}) } as any,
      customerAccessServiceMock,
    );
```

> `mockResolvedValue(buildAccess())` 这行必须有：L887 / L910 / L1406 三条既有用例都会走 `getMyOnboarding`，缺省返回 `undefined` 会在展开时炸。

- [ ] **Step 2: 追加三条客户面读侧用例（tipping-off 核心断言）**

在 `onboarding.service.spec.ts` 末尾 `});` 之前追加：

```ts
  // ── 设计稿 §3.4 tipping-off 命门 ─────────────────────────────────────
  // 客户面响应只允许 lifecycle / disclosedBlocked / disclosed 三个字段。
  // blocked 与 openCount 含 SILENT（制裁）限制的贡献 —— 它们出现在客户面
  // 响应体里，等于把「你正在被调查」直接告诉被调查人。
  describe('getMyOnboarding 客户面投影', () => {
    const buildProfileCustomer = () => ({
      id: 'c1',
      customerNo: 'CU0001',
      customerType: 'INDIVIDUAL',
      lifecycle: 'ACTIVE',
      riskRating: 'LOW',
      eddRequired: false,
      cddDocumentExpiresAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    it('输出 lifecycle / disclosedBlocked / disclosed，不再输出三根旧轴与 restrictions', async () => {
      prismaMock.customerMain.findUnique.mockResolvedValue(buildProfileCustomer());
      customerAccessServiceMock.resolve.mockResolvedValue(
        buildAccess({
          disclosedBlocked: new Set(['WITHDRAW', 'SWAP']),
          disclosed: [
            {
              restrictionNo: 'RST26080900B7',
              cause: 'MATERIAL_EXPIRED',
              scopes: ['WITHDRAW', 'SWAP'],
              label: 'Document expired',
              reason: 'Emirates ID expired on 2026-08-01',
              openedAt: '2026-08-09T02:00:00.000Z',
            },
          ],
          openCount: 1,
        }),
      );

      const result = await service.getMyOnboarding('c1');

      expect(result.lifecycle).toBe('ACTIVE');
      expect(result.disclosedBlocked).toEqual(['WITHDRAW', 'SWAP']);
      expect(result.disclosed).toHaveLength(1);
      expect(result.disclosed[0].restrictionNo).toBe('RST26080900B7');
      expect(result).not.toHaveProperty('onboardingStatus');
      expect(result).not.toHaveProperty('adminStatus');
      expect(result).not.toHaveProperty('complianceStatus');
      expect(result).not.toHaveProperty('restrictions');
    });

    it('绝不输出 blocked / openCount（SILENT 限制在客户面无字段可承载）', async () => {
      prismaMock.customerMain.findUnique.mockResolvedValue(buildProfileCustomer());
      customerAccessServiceMock.resolve.mockResolvedValue(
        buildAccess({
          blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
          openCount: 1,
        }),
      );

      const result = await service.getMyOnboarding('c1');

      expect(result).not.toHaveProperty('blocked');
      expect(result).not.toHaveProperty('openCount');
      expect(result.disclosedBlocked).toEqual([]);
      expect(result.disclosed).toEqual([]);
    });

    it('SANCTION 客户与无限制客户的响应体逐字节相等（零痕迹）', async () => {
      prismaMock.customerMain.findUnique.mockResolvedValue(buildProfileCustomer());

      customerAccessServiceMock.resolve.mockResolvedValue(buildAccess());
      const clean = await service.getMyOnboarding('c1');

      customerAccessServiceMock.resolve.mockResolvedValue(
        buildAccess({
          blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
          openCount: 1,
        }),
      );
      const sanctioned = await service.getMyOnboarding('c1');

      expect(JSON.stringify(sanctioned)).toBe(JSON.stringify(clean));
    });
  });
```

- [ ] **Step 3: 跑它，确认失败**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/onboarding/onboarding.service.spec.ts -t '客户面投影'
```

期望输出（ts-jest diagnostics 未关，类型错误即失败）：

```
● Test suite failed to run

    src/modules/identity/onboarding/onboarding.service.spec.ts:131:15 - error TS2554: Expected 4 arguments, but got 5.
```

- [ ] **Step 4: 改 DTO —— `StartVerificationCustomerSnapshotDto` 三字段整体替换**

`src/modules/identity/onboarding/dto/onboarding.dto.ts`，把 L17-21 的 import：

```ts
import type {
  CustomerOnboardingStatus,
  CustomerAdminStatus,
  CustomerComplianceStatus,
} from '../../customer-status.util';
```

替换为：

```ts
import type { CustomerLifecycle } from '../../constants/customer-lifecycle.constant';
import type {
  Capability,
  DisclosedRestrictionView,
} from '../../customers/customer-access.service';
```

再把 L210-214：

```ts
export interface StartVerificationCustomerSnapshotDto {
  onboardingStatus: CustomerOnboardingStatus;
  adminStatus: CustomerAdminStatus;
  complianceStatus: CustomerComplianceStatus;
}
```

替换为：

```ts
/**
 * 客户面唯一的状态投影。三个字段是白名单，不是起点 ——
 * CustomerAccess.blocked / openCount 含 SILENT 限制的贡献，加进来即 tipping-off
 * （设计稿 §3.4）。补字段前先回去读那一节。
 */
export interface StartVerificationCustomerSnapshotDto {
  lifecycle: CustomerLifecycle;
  disclosedBlocked: Capability[];
  disclosed: DisclosedRestrictionView[];
}
```

- [ ] **Step 5: OnboardingService 注入 `CustomerAccessService`**

`src/modules/identity/onboarding/onboarding.service.ts`，L2-8 的 import 块替换为：

```ts
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
```

在 L39（`import { SumsubClient } from './providers/sumsub/sumsub.client';`）之后新增一行：

```ts
import { CustomerAccessService } from '../customers/customer-access.service';
```

L156-161 的 constructor 替换为：

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingFinalApprovalService: OnboardingFinalApprovalService,
    private readonly sumsubClient: SumsubClient,
    private readonly auditLogsService: AuditLogsService,
    // CustomersModule ↔ OnboardingModule 互相 import，两侧都要 forwardRef 断环
    @Inject(forwardRef(() => CustomerAccessService))
    private readonly customerAccessService: CustomerAccessService,
  ) {}
```

- [ ] **Step 6: 重写 `getMyOnboarding` 与 `buildCustomerSnapshot`**

⚠️ **归属与行号提醒**：`getMyOnboarding` / `buildCustomerSnapshot` 在 **Task 2 已被重写过一轮**（那一轮负责把三轴字段换成 `lifecycle`）。本任务是在 Task 2 的产出之上**再改一次**，追加 `disclosedBlocked` / `disclosed` 两个客户面字段。
因此 **L1045-1075 这个行号区间在此刻已经失效** —— 请用符号名定位这两个方法（`grep -n "async getMyOnboarding\|buildCustomerSnapshot" src/modules/identity/onboarding/onboarding.service.ts`），把它们整段替换为：

```ts
  async getMyOnboarding(customerId: string) {
    await this.autoExpireIfNeeded(customerId);
    const customer = await this.getCustomerOrThrow(customerId, true);
    const nextStep = await this.buildNextStep(customer);

    return {
      ...this.omitCustomerInternalOnlyFields(customer),
      ...(await this.buildCustomerSnapshot(customerId)),
      actions: nextStep.actions,
      blockedReason: nextStep.blockedReason,
      activeCaseId: nextStep.activeCaseId,
      requiresEdd: nextStep.requiresEdd,
      verification: nextStep.verification,
    };
  }

  /**
   * 客户面「我处于什么状态 / 我被卡了什么」的唯一投影，`/onboarding/me` 与
   * verification start / mock-submit 三处共用一份，避免各写各的再漏一次。
   * 只允许 lifecycle / disclosedBlocked / disclosed —— CustomerAccess.blocked
   * 与 openCount 含 SILENT（制裁）限制的贡献，出现在客户面响应里即 tipping-off
   * （设计稿 §3.4）。禁止在此处补字段。
   */
  private async buildCustomerSnapshot(
    customerId: string,
  ): Promise<StartVerificationCustomerSnapshotDto> {
    const access = await this.customerAccessService.resolve(customerId);
    return {
      lifecycle: access.lifecycle,
      disclosedBlocked: [...access.disclosedBlocked],
      disclosed: access.disclosed,
    };
  }
```

- [ ] **Step 7: 修两处 `buildCustomerSnapshot` 调用点**

同文件 L1196（`startVerification` 返回体内）：

```ts
      customer: this.buildCustomerSnapshot(updated),
```
改为
```ts
      customer: await this.buildCustomerSnapshot(customerId),
```

同文件 L1239（`mockSubmitVerification` 返回体内）：

```ts
      customer: this.buildCustomerSnapshot(refreshed),
```
改为
```ts
      customer: await this.buildCustomerSnapshot(customerId),
```

- [ ] **Step 8: OnboardingModule 引入 CustomersModule（forwardRef 断环）**

`src/modules/identity/onboarding/onboarding.module.ts`，在 L9（`import { MaterialRefreshService } ...` 之后）加一行 import，并改 imports 数组：

```ts
import { CustomersModule } from '../customers/customers.module';
```

```ts
  imports: [
    PrismaModule,
    ApprovalsModule,
    forwardRef(() => MaterialRefreshModule),
    // CustomersModule 已 forwardRef 反向依赖本模块，两侧都要 forwardRef 才断得掉环
    forwardRef(() => CustomersModule),
  ],
```

- [ ] **Step 9: 跑测试，确认通过**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/onboarding/onboarding.service.spec.ts
```

期望：`Tests: ... passed`，`Test Suites: 1 passed`，其中包含
`✓ SANCTION 客户与无限制客户的响应体逐字节相等（零痕迹）`。既有的
`getMyOnboarding 响应体不得包含 hardLineDispositionedAt / passwordHash` 一并仍绿。

- [ ] **Step 10: commit 第一段**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/onboarding/onboarding.service.ts \
        src/modules/identity/onboarding/onboarding.service.spec.ts \
        src/modules/identity/onboarding/onboarding.module.ts \
        src/modules/identity/onboarding/dto/onboarding.dto.ts
git commit -m "feat(identity): /onboarding/me 改输出 lifecycle+disclosedBlocked+disclosed，三根旧轴与 restrictions 下线"
```

- [ ] **Step 11: 写 profile-banners 失败测试**

新建 `src/modules/identity/profile-banners/profile-banners.service.spec.ts`：

```ts
import { ProfileBannerService } from './profile-banners.service';

describe('ProfileBannerService', () => {
  const prismaMock: any = {
    customerMain: { findUnique: jest.fn() },
    materialRefreshCycle: { findMany: jest.fn() },
  };

  const customerAccessServiceMock: any = { resolve: jest.fn() };

  const buildAccess = (overrides?: Record<string, unknown>) => ({
    lifecycle: 'ACTIVE',
    blocked: new Set<string>(),
    disclosedBlocked: new Set<string>(),
    disclosed: [] as Array<Record<string, unknown>>,
    openCount: 0,
    ...overrides,
  });

  let service: ProfileBannerService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.customerMain.findUnique.mockResolvedValue({ id: 'c1', customerNo: 'CU0001' });
    prismaMock.materialRefreshCycle.findMany.mockResolvedValue([]);
    customerAccessServiceMock.resolve.mockResolvedValue(buildAccess());
    service = new ProfileBannerService(prismaMock, customerAccessServiceMock);
  });

  // 零痕迹：SILENT 限制在 CustomerAccess.disclosed 里结构性不存在，
  // 因此提示条这一层拿不到任何可渲染的东西 —— 不是"记得别渲染"，是没数据。
  it('SANCTION 客户返回空数组（不含任何提示该客户被摁住的 banner）', async () => {
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toEqual([]);
  });

  it('MATERIAL_EXPIRED 客户返回一条 RESTRICTION banner，CTA 指向 /verification', async () => {
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        disclosedBlocked: new Set(['WITHDRAW', 'SWAP']),
        disclosed: [
          {
            restrictionNo: 'RST26080900B7',
            cause: 'MATERIAL_EXPIRED',
            scopes: ['WITHDRAW', 'SWAP'],
            label: 'Document expired',
            reason: 'Emirates ID expired on 2026-08-01',
            openedAt: '2026-08-09T02:00:00.000Z',
          },
        ],
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toEqual([
      {
        id: 'banner-restriction-RST26080900B7',
        type: 'RESTRICTION',
        severity: 'WARNING',
        title: 'Document expired',
        description: 'Emirates ID expired on 2026-08-01',
        ctaLabel: 'Go to verification',
        ctaPath: '/verification',
        dismissible: false,
      },
    ]);
  });

  it('scope 含 ALL 的 DISCLOSED 限制升级为 BLOCKING 且无 CTA', async () => {
    customerAccessServiceMock.resolve.mockResolvedValue(
      buildAccess({
        disclosedBlocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
        disclosed: [
          {
            restrictionNo: 'RST26081500A1',
            cause: 'ADMIN_SUSPENSION',
            scopes: ['ALL'],
            label: 'Account suspended',
            reason: 'Suspended pending ops review',
            openedAt: '2026-08-15T10:22:00.000Z',
          },
        ],
        openCount: 1,
      }),
    );

    const banners = await service.getBannersFor('c1');

    expect(banners).toHaveLength(1);
    expect(banners[0].severity).toBe('BLOCKING');
    expect(banners[0].type).toBe('RESTRICTION');
    expect(banners[0].ctaPath).toBeNull();
  });
});
```

- [ ] **Step 12: 跑它，确认失败**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/profile-banners/profile-banners.service.spec.ts
```

期望输出：

```
● Test suite failed to run

    src/modules/identity/profile-banners/profile-banners.service.spec.ts:27:15 - error TS2554: Expected 1 arguments, but got 2.
```

- [ ] **Step 13: 重写 `profile-banners.service.ts`**

整文件替换为（材料 cycles 段与末尾排序逐字保留原样）：

```ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { CustomerAccessService } from '../customers/customer-access.service';
import type { RestrictionCause } from '../customers/constants/restriction-cause.constant';

export interface ProfileBanner {
  id: string;
  type: 'MATERIAL_REFRESH' | 'RESTRICTION';
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  title: string;
  description: string;
  cycleId?: string;
  materialType?: string;
  expiresAt?: string;
  daysFromExpiry?: number;
  ctaLabel?: string | null;
  ctaPath?: string | null;
  dismissible: boolean;
}

function formatMaterialName(m: string): string {
  const map: Record<string, string> = {
    EMIRATES_ID: 'Emirates ID',
    PASSPORT: 'Passport',
    PROOF_OF_ADDRESS: 'Proof of Address',
    SOURCE_OF_FUNDS: 'Source of Funds',
    SOURCE_OF_WEALTH: 'Source of Wealth',
  };
  return map[m] || m;
}

/**
 * 材料类 cause 的提示条挂 /verification 的 CTA，其余 cause 无 CTA（设计稿 §5.1）。
 * SILENT 的 cause（SANCTION / KYT_REJECTED_HARD）永远走不到这张表 ——
 * 本服务只遍历 CustomerAccess.disclosed，SILENT 行结构上进不了那个数组。
 */
const DOCUMENT_CTA_CAUSES = new Set<RestrictionCause>([
  'MATERIAL_EXPIRED',
  'PENDING_DOCUMENT',
]);

@Injectable()
export class ProfileBannerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly customerAccessService: CustomerAccessService,
  ) {}

  async getBannersFor(customerId: string): Promise<ProfileBanner[]> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const banners: ProfileBanner[] = [];

    const access = await this.customerAccessService.resolve(customerId);
    for (const restriction of access.disclosed) {
      const hasCta = DOCUMENT_CTA_CAUSES.has(restriction.cause);
      banners.push({
        id: `banner-restriction-${restriction.restrictionNo}`,
        type: 'RESTRICTION',
        severity: restriction.scopes.includes('ALL') ? 'BLOCKING' : 'WARNING',
        title: restriction.label,
        description: restriction.reason,
        ctaLabel: hasCta ? 'Go to verification' : null,
        ctaPath: hasCta ? '/verification' : null,
        dismissible: false,
      });
    }

    const cycles = await this.prisma.materialRefreshCycle.findMany({
      where: { customerId, status: 'PENDING_CUSTOMER_EVIDENCE' },
      include: { holding: true },
      orderBy: { graceExpiresAt: 'asc' },
    });

    for (const cycle of cycles) {
      const holding = cycle.holding;
      const daysFromExpiry = holding?.expiresAt
        ? Math.floor(
            (holding.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
          )
        : null;

      const severity =
        cycle.stage === 'BLOCKING'
          ? 'BLOCKING'
          : cycle.stage === 'URGENT'
            ? 'WARNING'
            : 'INFO';

      const materialDisplay = formatMaterialName(cycle.materialType);
      const title =
        severity === 'BLOCKING'
          ? `Your ${materialDisplay} has expired`
          : `Your ${materialDisplay} expires in ${daysFromExpiry} days`;

      banners.push({
        id: `banner-mrc-${cycle.id}`,
        type: 'MATERIAL_REFRESH',
        severity,
        title,
        description:
          severity === 'BLOCKING'
            ? 'Refresh it now to restore your account.'
            : severity === 'WARNING'
              ? 'Refresh soon to avoid service interruption.'
              : 'You can refresh it at any time.',
        cycleId: cycle.id,
        materialType: cycle.materialType,
        expiresAt: holding?.expiresAt?.toISOString(),
        daysFromExpiry: daysFromExpiry ?? undefined,
        ctaLabel: `Refresh ${materialDisplay}`,
        ctaPath: `/verification?cycleId=${cycle.id}`,
        dismissible: severity === 'INFO',
      });
    }

    return banners.sort((a, b) => {
      const order = { BLOCKING: 0, WARNING: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
}
```

- [ ] **Step 14: ProfileBannersModule 引入 CustomersModule**

`src/modules/identity/profile-banners/profile-banners.module.ts` 整文件替换为：

```ts
import { Module } from '@nestjs/common';
import { ProfileBannerService } from './profile-banners.service';
import { ProfileBannerController } from './profile-banners.controller';
import { CustomersModule } from '../customers/customers.module';

@Module({
  // CustomersModule 为 CustomerAccessService。本模块不被 Customers 依赖，无环，
  // 无需 forwardRef。PrismaService 走 @Global 的 PrismaModule。
  imports: [CustomersModule],
  providers: [ProfileBannerService],
  controllers: [ProfileBannerController],
  exports: [ProfileBannerService],
})
export class ProfileBannersModule {}
```

- [ ] **Step 15: 跑测试，确认通过 + 死分支确已消失**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/profile-banners/profile-banners.service.spec.ts
grep -rn "complianceStatus\|COMPLIANCE_HOLD\|PEP_REVIEW_PENDING\|pep_review_pending" src/modules/identity/profile-banners/
```

期望：jest `Tests: 3 passed`；grep **零输出**（exit code 1，说明 `complianceStatus === 'FROZEN'` 那块与 `pep_review_pending` 死分支都已删干净）。

- [ ] **Step 16: 硬闸门 —— tsc + 全量 jest**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx tsc --noEmit
npm test 2>&1 | tail -20
```

期望：`tsc` 零输出；`npm test` 相对本任务开工前的基线**净新增失败 0**（wallets 4 条 pre-existing 失败不算，见 CLAUDE.md 记录）。若 tsc 报 `client-web/src/hooks/useCustomerProfile.ts` 相关错误，那是前端任务的范围，本任务不动 —— 确认报错文件全在 `client-web/` / `admin-web/` 下再放行。

- [ ] **Step 17: 真机跑一遍 DI 环 + 响应体（tsc 抓不到 Nest 循环依赖）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
bash scripts/stack.sh up
PORT=$(head -n1 .stackports)
TOKEN=$(curl -s -X POST "http://localhost:${PORT}/auth/customer/login" \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo_alice@example.com","password":"123456"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).access_token||JSON.parse(s).token))')
curl -s "http://localhost:${PORT}/onboarding/me" -H "Authorization: Bearer ${TOKEN}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const o=JSON.parse(s);console.log(JSON.stringify({lifecycle:o.lifecycle,disclosedBlocked:o.disclosedBlocked,disclosed:o.disclosed,leaked:["onboardingStatus","adminStatus","complianceStatus","restrictions","blocked","openCount"].filter(k=>k in o)},null,2))})'
curl -s "http://localhost:${PORT}/customers/me/profile-banners" -H "Authorization: Bearer ${TOKEN}"
```

期望：后端起得来（DI 环没打死，日志里无 `Nest can't resolve dependencies` / `A circular dependency`）；`/onboarding/me` 打印 `"lifecycle": "ACTIVE"`、`"disclosedBlocked": []`、`"disclosed": []`、**`"leaked": []`**；profile-banners 返回 `{"banners":[]}`。若 `leaked` 非空，回 Step 6 查是不是哪个字段被 `omitCustomerInternalOnlyFields` 的整行 spread 又带出来了。

- [ ] **Step 18: commit 第二段**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/profile-banners/profile-banners.service.ts \
        src/modules/identity/profile-banners/profile-banners.service.spec.ts \
        src/modules/identity/profile-banners/profile-banners.module.ts
git commit -m "feat(identity): profile banners 改由 CustomerAccess.disclosed 驱动，删 COMPLIANCE_HOLD 与 pep_review_pending 死分支"
```

---

### Task 7: 四个自动冻结点迁移到限制账 + INV-1 三处修正

把今天散在四个 domain service 里、直接写 `CustomerMain.complianceStatus/complianceFreezeReason` 的自动冻结/解冻，全部迁到 `customer_restrictions` 便签账；同时修掉三处违反 INV-1（`ACTIVE` 的唯一出口是 `OFFBOARDED`）的 lifecycle 回退写入。Task 1 删列之后这四个文件必然 tsc 红，本 Task 是把它们恢复绿的那一刀。

**本 Task 的首要产出不是"能编译"，而是一条用例**：客户同时挂 `SANCTION` + `MATERIAL_EXPIRED` 两张便签，补齐材料触发材料侧自动撕，制裁那张必须纹丝不动。旧的单字段模型在这里必然失败（材料解冻无条件写 `complianceStatus:'CLEAR'`，制裁摁住当场蒸发），这就是整套限制账设计存在的理由。

**范围边界（不是本 Task 的）**：`customer-status.util.ts` / `auth/jwt.strategy.ts` / `auth/customer-auth.service.ts` / `profile-banners/profile-banners.service.ts` / `onboarding/onboarding.service.ts`（`assertTradingEligibility`）里的 `complianceStatus` **读**侧，归 Task 4 的 `CustomerAccessService` 收口；本 Task 只动上述四个**写**入方，外加它们文件内部因删列而被牵连的读点（CRA `postSignoffCascade`、ingestion 的 `onboardingStatus` 四处）。

**Demo 数据约定**：不写 backfill、不写兼容层、不做双写过渡。改完 `bash scripts/on-stack.sh main main:reset:biz` 重铺。

**Files:**

**Create:**
- `src/modules/identity/material-refresh/material-refresh.service.spec.ts` — 材料域三个调用点的参数契约单测（本文件今天不存在）
- `src/modules/identity/material-refresh/material-refresh-multi-cause.spec.ts` — 「多因不互相解」真服务 + 内存 prisma 证明用例 + INV-1 源码守则扫描

**Modify:**
- `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts:1-10`（import）、`:31-38`（构造函数）、`:440-474`（`handleSanctionsPath`）、`:509-510`（level 同步的 FROZEN 读点）
- `src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts:1-23`
- `src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts:1-8`、`:64-92`、`:293-331`
- `src/modules/identity/material-refresh/material-refresh.service.ts:1-32`（import + 构造函数）、`:115-124`（`enterBlockingStage` 冻结段）、`:147-153`（`terminateCycle` 的 INV-1 违规写）、`:225-234`（解冻段）
- `src/modules/identity/material-refresh/material-refresh.module.ts:1-16`
- `src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.ts:1-18`（import + 构造函数）、`:33-52`（`createFromCra` 事务）、`:66-76`（审计取值）、`:139-197`（`handleSignoffComplete` 双分支）
- `src/modules/identity/tier-upgrade-case/tier-upgrade-case.module.ts:1-14`
- `src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.spec.ts:1-49`、`:51-77`、`:136-177`
- `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:1-44`（import + 构造函数）、`:168-209`（`caseDecisionSimulated` 双分支）、`:275`/`:289`/`:298`/`:318`（`onboardingStatus` → `lifecycle` 四处读）
- `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts:1-40`
- `src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts:60-78`（构造函数位参 +2）
- `doc-final/reference/truth/v2-customer-compliance.md:35-36`
- `doc-final/reference/truth/sumsub-ingestion.md:34`

**Test:**
- `src/modules/identity/material-refresh/material-refresh-multi-cause.spec.ts`（新建，本 Task 核心）
- `src/modules/identity/material-refresh/material-refresh.service.spec.ts`（新建）
- `src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`（改）
- `src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.spec.ts`（改）
- `src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts`（改）

**Interfaces:**

**Consumes**（Task 1 / 3 / 4 已产出，本 Task 只调用，禁止改签名）:
```ts
// customer-restrictions.service.ts（Task 3）
open(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }>
listOpen(customerId: string): Promise<RestrictionRow[]>
listAll(customerId: string): Promise<RestrictionRow[]>
// OpenRestrictionInput = { customerId, cause, scopes?, reason, caseRef?, openedBy }

// customer-restriction-workflow.service.ts（Task 5）
autoRelease(customerId: string, cause: RestrictionCause, caseRef: string | null, actorId: string): Promise<void>

// customer-access.service.ts（Task 4）
resolve(customerId: string): Promise<CustomerAccess>

// restriction-cause.constant.ts（Task 1）
type RestrictionCause = 'SANCTION' | 'ADMIN_SUSPENSION' | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING' | 'KYT_REJECTED_SOFT' | 'KYT_REJECTED_HARD' | 'PENDING_DOCUMENT';
```

**Produces**（四个 service 的构造函数各追加依赖，公开方法签名一律不变）:
```ts
// ClientRiskAssessmentService — 追加 1 个尾参
constructor(..., auditLogsService: AuditLogsService, restrictionsService: CustomerRestrictionsService)

// MaterialRefreshService — 追加 2 个尾参
constructor(..., policyLoader: MaterialRefreshPolicyLoader,
  restrictionsService: CustomerRestrictionsService,
  restrictionWorkflowService: CustomerRestrictionWorkflowService)

// TierUpgradeCaseService — 追加 2 个尾参
constructor(..., auditLogsService: AuditLogsService,
  restrictionsService: CustomerRestrictionsService,
  restrictionWorkflowService: CustomerRestrictionWorkflowService)

// SumsubIngestionService — 追加 2 个尾参
constructor(..., swapWebhookRouter: SwapWebhookRouter,
  restrictionsService: CustomerRestrictionsService,
  restrictionWorkflowService: CustomerRestrictionWorkflowService)

// 行为契约（迁移后的 cause × caseRef 配对表，撕的定位键就是这两列）
CRA.handleSanctionsPath          → open   { cause:'SANCTION',             caseRef: assessment.id }
ingestion.caseDecisionSimulated  → open   { cause:'SANCTION',             caseRef: assessmentId }   // REJECT，幂等 no-op
ingestion.caseDecisionSimulated  → autoRelease('SANCTION',             assessmentId)                // APPROVE
material.enterBlockingStage      → open   { cause:'MATERIAL_EXPIRED',     caseRef: holding.activeRefreshCycleId }
material.handleSumsubActionResult→ autoRelease('MATERIAL_EXPIRED',     cycle.id)
material.terminateCycle          → open   { cause:'ADMIN_SUSPENSION',     caseRef: cycle.id }        // INV-1
tier.createFromCra               → open   { cause:'TIER_UPGRADE_PENDING', caseRef: upgradeCase.id }
tier.handleSignoffComplete(APPR) → autoRelease('TIER_UPGRADE_PENDING', upgradeCase.id)
tier.handleSignoffComplete(REJ)  → open   { cause:'ADMIN_SUSPENSION',     caseRef: upgradeCase.id }  // INV-1
                                 + autoRelease('TIER_UPGRADE_PENDING', upgradeCase.id)
```

审计不在本 Task 写：`CUSTOMER_RESTRICTION_ADDED` / `CUSTOMER_RESTRICTION_CLEARED` / `CUSTOMER_FROZEN` / `CUSTOMER_UNFROZEN` 全部由 `CustomerRestrictionsService.open()/release()`（Task 3）内部 DI 注入的 `AuditLogsService` 落，这四个调用点**不得重复写**，否则一次贴便签出两条审计。

---

- [ ] **Step 1: 确认 Task 3-4 的前置产物已就位**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
ls src/modules/identity/customers/customer-access.service.ts \
   src/modules/identity/customers/customer-restriction-workflow.service.ts
grep -n "exports:" src/modules/identity/customers/customers.module.ts
```

期望：两个文件都存在；`exports:` 行同时含 `CustomerRestrictionsService`、`CustomerAccessService`、`CustomerRestrictionWorkflowService` 三个名字。任一缺失说明 Task 3-4 未完成，**停下**，不要在本 Task 里补建它们。

- [ ] **Step 2: 四个模块 imports 引入 `CustomersModule`（全部 forwardRef 断环）**

四条边全都成环，必须 forwardRef：`CustomersModule → OnboardingModule → MaterialRefreshModule → ClientRiskAssessmentModule → {TierUpgradeCaseModule, SumsubIngestionModule}` 都能绕回 `CustomersModule`。

`src/modules/identity/material-refresh/material-refresh.module.ts` — import 段末尾加一行，imports 数组加一项：
```ts
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
    // Task 7: 材料到期/终止周期改贴限制便签，需要 CustomerRestrictionsService +
    // CustomerRestrictionWorkflowService。CustomersModule → OnboardingModule →
    // MaterialRefreshModule 成环，两侧都得 forwardRef。
    forwardRef(() => CustomersModule),
  ],
```

`src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`：
```ts
import { SumsubIngestionModule } from '../../sumsub-ingestion/sumsub-ingestion.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
    ApprovalsModule,
    TierUpgradeCaseModule,
    forwardRef(() => SumsubIngestionModule),
    // Task 7: 制裁路径改贴 SANCTION 便签
    forwardRef(() => CustomersModule),
  ],
```

`src/modules/identity/tier-upgrade-case/tier-upgrade-case.module.ts`：
```ts
import { OnboardingModule } from '../onboarding/onboarding.module';
import { CustomersModule } from '../customers/customers.module';

@Module({
  imports: [
    ApprovalsModule,
    forwardRef(() => OnboardingModule), // provides SumsubClient
    // Task 7: 升级摁住/解开改走限制便签
    forwardRef(() => CustomersModule),
  ],
```

`src/modules/sumsub-ingestion/sumsub-ingestion.module.ts`：
```ts
import { SumsubRetryService } from './sumsub-ingestion-retry.service';
import { CustomersModule } from '../identity/customers/customers.module';
```
imports 数组末尾（`forwardRef(() => SwapSumsubModule),` 之后）加：
```ts
    // Task 7: caseDecisionSimulated 的 APPROVE/REJECT 改走限制便签
    forwardRef(() => CustomersModule),
```

- [ ] **Step 3: 跑编译确认四条边没把 DI 图搞崩**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx tsc --noEmit
```
期望：本步只加模块 import，报错应仅剩 Task 1 删列造成的既有红（`complianceStatus`/`onboardingStatus`/`adminStatus` 不存在于 `CustomerMainUpdateInput`），**不得**出现新的 `Cannot find module` 或循环引用报错。

```bash
git add src/modules/identity/material-refresh/material-refresh.module.ts src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts src/modules/identity/tier-upgrade-case/tier-upgrade-case.module.ts src/modules/sumsub-ingestion/sumsub-ingestion.module.ts
git commit -m "chore(di): 四个自动冻结点模块引入 CustomersModule（forwardRef 断环）"
```

---

##### (a) CRA 制裁路径

- [ ] **Step 4: 改红 CRA 单测 —— 断言贴 SANCTION 便签、且不碰 customerMain**

`src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

import 段（第 8 行 `AuditLogsService` 之后）追加：
```ts
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
```

第 76-77 行（`mockTierUpgradeCaseService` 定义之后）追加 mock：
```ts
  const mockTierUpgradeCaseService = { createFromCra: jest.fn() };
  const mockRestrictionsService = {
    open: jest.fn().mockResolvedValue({ restrictionNo: 'RST-0001', created: true }),
    listOpen: jest.fn().mockResolvedValue([]),
  };
```

providers 数组（`AuditLogsService` 那项之后）追加：
```ts
        { provide: CustomerRestrictionsService, useValue: mockRestrictionsService },
```

`beforeEach` 里 `mockSumsubClient.getApplicant.mockResolvedValue(...)` 之后追加两行（`clearAllMocks` 会清掉实现，必须重置）：
```ts
    mockRestrictionsService.open.mockResolvedValue({ restrictionNo: 'RST-0001', created: true });
    mockRestrictionsService.listOpen.mockResolvedValue([]);
```

把第 295-331 行整个 `describe('handleSanctionsPath — via handleSumsubAmlResult', ...)` 换成：
```ts
  describe('handleSanctionsPath — via handleSumsubAmlResult', () => {
    it('SANCTIONS label → ESCALATED_TO_SUMSUB + 贴一张 SANCTION 便签（不碰 customerMain）', async () => {
      const assessment = {
        id: 'cra-1', customerId: 'cust-1', traceId: 'T1', assessmentNo: 'CRA-001',
        previousRiskTier: 'LOW', status: 'PENDING_SUMSUB_RESULT',
      };
      const customer = {
        id: 'cust-1', riskRating: 'LOW', sumsubApplicantId: 'sub-1',
        pepStatus: 'NONE', lifecycle: 'ACTIVE',
        sumsubCurrentLevelName: 'wave3-level-1', sumsubExperiencedLevel2: false,
      };

      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(assessment);
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
      prisma.customerMain.findUnique.mockResolvedValueOnce(customer);

      await service.handleSumsubAmlResult('insp-1', {
        reviewAnswer: 'RED',
        rejectLabels: ['SANCTIONS_LIST'],
      });

      expect(mockRestrictionsService.open).toHaveBeenCalledTimes(1);
      expect(mockRestrictionsService.open).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'cust-1',
          cause: 'SANCTION',
          caseRef: 'cra-1',
          openedBy: 'SYSTEM',
        }),
      );
      // scopes 不许传：SANCTION 的 scopeSelectable=false，scope 由注册表定
      expect(mockRestrictionsService.open.mock.calls[0][0]).not.toHaveProperty('scopes');
      // 摁住不再落在 CustomerMain 上
      expect(prisma.customerMain.update).not.toHaveBeenCalled();
      expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ESCALATED_TO_SUMSUB' }),
        }),
      );
    });

    it('贴便签失败时不静默吞掉（摁不住必须炸，不能只改评估单状态）', async () => {
      const assessment = {
        id: 'cra-1', customerId: 'cust-1', traceId: 'T1', assessmentNo: 'CRA-001',
        previousRiskTier: 'LOW', status: 'PENDING_SUMSUB_RESULT',
      };
      prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(assessment);
      prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
      prisma.customerMain.findUnique.mockResolvedValueOnce({
        id: 'cust-1', riskRating: 'LOW', sumsubApplicantId: 'sub-1',
        pepStatus: 'NONE', lifecycle: 'ACTIVE',
      });
      mockRestrictionsService.open.mockRejectedValueOnce(new Error('db down'));

      await expect(
        service.handleSumsubAmlResult('insp-1', { reviewAnswer: 'RED', rejectLabels: ['SANCTIONS_LIST'] }),
      ).rejects.toThrow('db down');
    });
  });
```

- [ ] **Step 5: 跑测试确认红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts -t 'handleSanctionsPath'
```
期望失败，报 `Nest can't resolve dependencies of the ClientRiskAssessmentService (..., ?)` 或 `mockRestrictionsService.open` 被调用 0 次 —— 因为服务还在写 `complianceStatus`。

- [ ] **Step 6: 实现 (a) —— `handleSanctionsPath` 改贴便签 + level 同步读点换源**

`src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`

第 10 行 `AuditLogsService` import 之后追加：
```ts
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
```

构造函数（第 31-38 行）末参追加：
```ts
    private readonly auditLogsService: AuditLogsService,
    private readonly restrictionsService: CustomerRestrictionsService,
  ) {}
```

第 440-474 行整个方法替换为：
```ts
  private async handleSanctionsPath(
    assessment: any,
    customer: any,
    labels: string[],
  ): Promise<void> {
    // 先贴便签、再改评估单：两张表分属不同 domain service，共不了一个
    // prisma.$transaction（限制账的写入口只认 CustomerRestrictionsService，
    // 铁律 5）。中途崩的代价必须偏向「多摁一下」而不是「漏摁」——
    // open() 对 (customerId, cause, caseRef) 幂等，重放不会贴出第二张。
    await this.restrictionsService.open({
      customerId: customer.id,
      cause: 'SANCTION',
      reason: `Sanctions labels on ${assessment.assessmentNo}: ${labels.join(', ')}`,
      caseRef: assessment.id,
      openedBy: 'SYSTEM',
    });

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        status: 'ESCALATED_TO_SUMSUB',
        resultingRiskTier: 'HIGH',
        recommendedAction: 'ESCALATE_TO_SUMSUB_CASE',
        signoffMethod: 'ESCALATED',
        reasoning: JSON.stringify({ ruleId: 'P1_labels_contains_SANCTIONS', labels }),
      },
    });

    await this.auditLogsService.recordSystem({
      traceId: assessment.traceId,
      workflowType: 'RISK_ASSESSMENT',
      action: 'RISK_ASSESSMENT_ESCALATED_SANCTIONS',
      entityType: 'ClientRiskAssessment',
      entityId: assessment.id,
      entityOwnerType: 'Customer',
      entityOwnerId: customer.id,
      metadata: { labels },
    });
  }
```

第 509-510 行（`postSignoffCascade` 里的 level 同步门）替换：
```ts
    // Sync Sumsub level（身上有 OPEN 的 SANCTION 便签就跳过：制裁客户不许换 level）
    const openRestrictions = await this.restrictionsService.listOpen(customer.id);
    const sanctioned = openRestrictions.some((r) => r.cause === 'SANCTION');
    if (!sanctioned && assessment.resultingRiskTier) {
```

- [ ] **Step 7: 跑测试确认绿 + 提交**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts
```
期望：该文件全部用例 PASS。

```bash
git add src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts
git commit -m "feat(cra): 制裁路径改贴 SANCTION 便签，level 同步门读限制账"
```

---

##### (b) 材料到期

- [ ] **Step 8: 新建材料域单测（红）—— 三个调用点的参数契约**

新建 `src/modules/identity/material-refresh/material-refresh.service.spec.ts`：
```ts
import { Test } from '@nestjs/testing';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';

/**
 * Task 7：材料域三个限制账调用点的参数契约。
 * 真存储行为（贴/撕到底动了哪几行）由 material-refresh-multi-cause.spec.ts 用
 * 真服务 + 内存 prisma 证明，本文件只锁「调谁、传什么键」。
 */
describe('MaterialRefreshService — 限制账调用点（Task 7）', () => {
  let service: MaterialRefreshService;
  let prisma: any;
  const restrictions = { open: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }) };
  const workflow = { autoRelease: jest.fn().mockResolvedValue(undefined) };
  const sumsub = {
    createApplicantAction: jest.fn().mockResolvedValue({ id: 'act-1' }),
    getApplicant: jest.fn().mockResolvedValue({ info: { idDocs: [] } }),
  };
  const policyLoader = {
    getMaterialConfig: jest.fn().mockReturnValue({
      sumsubActionLevelName: 'wave3-poa',
      enforceRestriction: true,
      windowDays: { LOW: 365 },
    }),
  };

  beforeEach(async () => {
    prisma = {
      customerMaterialHolding: {
        findUnique: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      materialRefreshCycle: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      customerMain: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    const module = await Test.createTestingModule({
      providers: [
        MaterialRefreshService,
        { provide: PrismaService, useValue: prisma },
        { provide: SumsubClient, useValue: sumsub },
        { provide: MaterialRefreshPolicyLoader, useValue: policyLoader },
        { provide: CustomerRestrictionsService, useValue: restrictions },
        { provide: CustomerRestrictionWorkflowService, useValue: workflow },
      ],
    }).compile();
    service = module.get(MaterialRefreshService);
    jest.clearAllMocks();
    restrictions.open.mockResolvedValue({ restrictionNo: 'RST-1', created: true });
    workflow.autoRelease.mockResolvedValue(undefined);
    policyLoader.getMaterialConfig.mockReturnValue({
      sumsubActionLevelName: 'wave3-poa',
      enforceRestriction: true,
      windowDays: { LOW: 365 },
    });
  });

  it('enterBlockingStage → 贴 MATERIAL_EXPIRED，caseRef=活跃周期 id，不碰 customerMain', async () => {
    prisma.customerMaterialHolding.findUnique.mockResolvedValue({
      id: 'hold-1', customerId: 'cust-1', materialType: 'PROOF_OF_ADDRESS',
      activeRefreshCycleId: 'cyc-1', status: 'REFRESH_IN_PROGRESS',
    });

    await service.enterBlockingStage('hold-1');

    expect(restrictions.open).toHaveBeenCalledWith({
      customerId: 'cust-1',
      cause: 'MATERIAL_EXPIRED',
      reason: 'Material expired: PROOF_OF_ADDRESS',
      caseRef: 'cyc-1',
      openedBy: 'SYSTEM',
    });
    expect(prisma.customerMain.update).not.toHaveBeenCalled();
  });

  it('enterBlockingStage → enforceRestriction=false 的材料不贴任何便签', async () => {
    policyLoader.getMaterialConfig.mockReturnValue({
      sumsubActionLevelName: 'wave3-poa', enforceRestriction: false,
    });
    prisma.customerMaterialHolding.findUnique.mockResolvedValue({
      id: 'hold-1', customerId: 'cust-1', materialType: 'PROOF_OF_ADDRESS',
      activeRefreshCycleId: 'cyc-1', status: 'REFRESH_IN_PROGRESS',
    });

    await service.enterBlockingStage('hold-1');

    expect(restrictions.open).not.toHaveBeenCalled();
  });

  it('terminateCycle → INV-1：不动 lifecycle，改贴 ADMIN_SUSPENSION', async () => {
    prisma.materialRefreshCycle.findFirst.mockResolvedValue({
      id: 'cyc-1', cycleNo: 'MRC-001', customerId: 'cust-1', holdingId: 'hold-1',
      status: 'PENDING_CUSTOMER_EVIDENCE',
    });

    await service.terminateCycle('cyc-1', 'grace_expired');

    expect(restrictions.open).toHaveBeenCalledWith({
      customerId: 'cust-1',
      cause: 'ADMIN_SUSPENSION',
      reason: 'Material refresh cycle MRC-001 terminated: grace_expired',
      caseRef: 'cyc-1',
      openedBy: 'SYSTEM',
    });
    expect(prisma.customerMain.update).not.toHaveBeenCalled();
  });

  it('handleSumsubActionResult GREEN → 只自动撕本周期那张 MATERIAL_EXPIRED', async () => {
    prisma.materialRefreshCycle.findFirst.mockResolvedValue({
      id: 'cyc-1', cycleNo: 'MRC-001', customerId: 'cust-1', holdingId: 'hold-1',
      status: 'PENDING_SUMSUB_REVIEW', sumsubActionId: 'act-1', triggerType: 'SCHEDULED_EXPIRY',
    });
    prisma.customerMaterialHolding.findUnique.mockResolvedValue({
      id: 'hold-1', customerId: 'cust-1', materialType: 'PROOF_OF_ADDRESS',
      managementMode: 'SELF_MANAGED',
    });
    prisma.customerMain.findUnique.mockResolvedValue({ id: 'cust-1', riskRating: 'LOW' });

    await service.handleSumsubActionResult({
      actionId: 'act-1', reviewResult: { reviewAnswer: 'GREEN' },
    });

    expect(workflow.autoRelease).toHaveBeenCalledTimes(1);
    expect(workflow.autoRelease).toHaveBeenCalledWith('cust-1', 'MATERIAL_EXPIRED', 'cyc-1', 'system');
    expect(prisma.customerMain.update).not.toHaveBeenCalled();
  });

  it('handleSumsubActionResult RED → 不撕任何便签', async () => {
    prisma.materialRefreshCycle.findFirst.mockResolvedValue({
      id: 'cyc-1', customerId: 'cust-1', holdingId: 'hold-1', status: 'PENDING_SUMSUB_REVIEW',
    });

    await service.handleSumsubActionResult({
      actionId: 'act-1', reviewResult: { reviewAnswer: 'RED' },
    });

    expect(workflow.autoRelease).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 9: 跑测试确认红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/material-refresh/material-refresh.service.spec.ts
```
期望失败：`Nest can't resolve dependencies of the MaterialRefreshService (PrismaService, SumsubClient, MaterialRefreshPolicyLoader, ?)` —— 服务还没有这两个依赖。

- [ ] **Step 10: 实现 (b) —— 材料域三处**

`src/modules/identity/material-refresh/material-refresh.service.ts`

第 8 行 import 之后追加：
```ts
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
```

构造函数（第 27-32 行）末参追加：
```ts
    private readonly policyLoader: MaterialRefreshPolicyLoader,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
  ) {}
```

第 115-124 行（`enterBlockingStage` 的冻结段）替换：
```ts
    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (materialConfig?.enforceRestriction) {
      // 摁住改贴便签：MATERIAL_EXPIRED 默认卡 WITHDRAW+SWAP（DISCLOSED，客户看得见
      // "Document expired"）。caseRef=本次刷新周期 id —— 后面自动撕只能凭这个键
      // 撕自己这张，撕不到客户身上别因的便签。
      await this.restrictionsService.open({
        customerId: holding.customerId,
        cause: 'MATERIAL_EXPIRED',
        reason: `Material expired: ${holding.materialType}`,
        caseRef: holding.activeRefreshCycleId,
        openedBy: 'SYSTEM',
      });
    }
```

第 147-153 行（`terminateCycle` 的 INV-1 违规写）替换：
```ts
    // INV-1：ACTIVE 的唯一出口是 OFFBOARDED。客户并没有「撤回申请」，是平台单方
    // 终止补料周期 —— 原来写 lifecycle=WITHDRAWN 是语义错。改为不动 lifecycle，
    // 贴 ADMIN_SUSPENSION 便签（DISCLOSED / OPS_APPROVAL 解除）。真要终止关系走销户。
    await this.restrictionsService.open({
      customerId: cycle.customerId,
      cause: 'ADMIN_SUSPENSION',
      reason: `Material refresh cycle ${cycle.cycleNo} terminated: ${reason}`,
      caseRef: cycle.id,
      openedBy: 'SYSTEM',
    });
```

第 225-234 行（解冻段）替换：
```ts
    // 自动撕：cause + caseRef 双键定位，只撕本周期贴的那张 MATERIAL_EXPIRED。
    // 客户身上别的因（SANCTION / ADMIN_SUSPENSION / TIER_UPGRADE_PENDING）一概不动
    // ——「多因不互相解」，见 material-refresh-multi-cause.spec.ts。
    await this.restrictionWorkflowService.autoRelease(
      customer.id,
      'MATERIAL_EXPIRED',
      cycle.id,
      'system',
    );
```

- [ ] **Step 11: 跑测试确认绿 + 提交**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/material-refresh/material-refresh.service.spec.ts
```
期望：5 passed。

```bash
git add src/modules/identity/material-refresh/material-refresh.service.ts src/modules/identity/material-refresh/material-refresh.service.spec.ts
git commit -m "feat(material-refresh): 到期摁住/自动解除迁到限制账，terminateCycle 停写 lifecycle(INV-1)"
```

---

##### (f) 「多因不互相解」—— 本 Task 的核心用例

- [ ] **Step 12: 新建真服务 + 内存 prisma 的证明用例（红）**

不用 jest mock 冒充存储：撕的定位逻辑就在 `CustomerRestrictionsService` / `CustomerRestrictionWorkflowService` 里，mock 掉它们等于把要证的东西假设成立。这里跑真服务，只把 prisma 换成一张手搓的内存表。

新建 `src/modules/identity/material-refresh/material-refresh-multi-cause.spec.ts`：
```ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { MaterialRefreshService } from './material-refresh.service';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerAccessService } from '../customers/customer-access.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';

/**
 * Task 7 —「多因不互相解」：整套限制账设计存在的首要理由。
 *
 * 客户身上同时挂 SANCTION（制裁，SILENT，scope=ALL）与 MATERIAL_EXPIRED（材料过期，
 * DISCLOSED，卡 WITHDRAW+SWAP）两张便签，客户补齐材料触发材料侧自动撕 ——
 * SANCTION 那张必须纹丝不动，三个能力仍然全封。
 *
 * 旧的单字段模型（CustomerMain.complianceStatus）在这里必然失败：材料解冻会把
 * complianceStatus 无条件写回 CLEAR，制裁摁住当场蒸发、客户能提币走人。
 *
 * 用真 CustomerRestrictionsService + 真 CustomerRestrictionWorkflowService +
 * 真 CustomerAccessService，跑在内存 prisma 上 —— 只有真服务才能证明「撕的定位键
 * 是 cause + caseRef 而不是客户 id」。
 */

// ─── 手搓内存 prisma（够用即可：等值 / in / not / equals 四种 where 形态）───
type Row = Record<string, any>;

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return (v as Row[]).every((w) => matches(row, w));
    if (k === 'OR') return (v as Row[]).some((w) => matches(row, w));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if ('in' in v) return (v.in as any[]).includes(row[k]);
      if ('notIn' in v) return !(v.notIn as any[]).includes(row[k]);
      if ('not' in v) return row[k] !== (v as any).not;
      if ('equals' in v) return row[k] === (v as any).equals;
      return true;
    }
    return row[k] === v;
  });
}

function makeTable(seed: Row[] = []) {
  const rows: Row[] = seed.map((r) => ({ ...r }));
  let seq = 0;
  return {
    rows,
    create: jest.fn(async ({ data }: any) => {
      const row = { id: data.id ?? `row-${++seq}`, ...data };
      rows.push(row);
      return row;
    }),
    createMany: jest.fn(async ({ data }: any) => {
      for (const d of data) rows.push({ id: d.id ?? `row-${++seq}`, ...d });
      return { count: data.length };
    }),
    findFirst: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))[0] ?? null),
    findUnique: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
    findMany: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where))),
    count: jest.fn(async ({ where }: any = {}) => rows.filter((r) => matches(r, where)).length),
    update: jest.fn(async ({ where, data }: any) => {
      const row = rows.find((r) => matches(r, where));
      if (!row) throw new Error(`no row for ${JSON.stringify(where)}`);
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const hit = rows.filter((r) => matches(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    }),
  };
}

const CUSTOMER_ID = 'cust-1';
const HOLDING_ID = 'hold-1';
const CYCLE_ID = 'cyc-1';

describe('多因不互相解 — 材料自动撕不许碰制裁便签（Task 7）', () => {
  let prisma: any;
  let restrictionsService: CustomerRestrictionsService;
  let accessService: CustomerAccessService;
  let materialRefreshService: MaterialRefreshService;

  beforeEach(async () => {
    prisma = {
      customerMain: makeTable([
        { id: CUSTOMER_ID, customerNo: 'C0001', lifecycle: 'ACTIVE', riskRating: 'LOW', sumsubApplicantId: 'sub-1' },
      ]),
      customerRestriction: makeTable(),
      customerMaterialHolding: makeTable([
        {
          id: HOLDING_ID, customerId: CUSTOMER_ID, materialType: 'PROOF_OF_ADDRESS',
          managementMode: 'SELF_MANAGED', status: 'REFRESH_IN_PROGRESS',
          activeRefreshCycleId: CYCLE_ID, expiresAt: new Date('2026-01-01'),
        },
      ]),
      materialRefreshCycle: makeTable([
        {
          id: CYCLE_ID, cycleNo: 'MRC-001', customerId: CUSTOMER_ID, holdingId: HOLDING_ID,
          materialType: 'PROOF_OF_ADDRESS', status: 'PENDING_SUMSUB_REVIEW', stage: 'URGENT',
          triggerType: 'SCHEDULED_EXPIRY', sumsubActionId: 'act-1',
        },
      ]),
    };
    prisma.$transaction = async (arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg);

    const module = await Test.createTestingModule({
      providers: [
        CustomerRestrictionsService,
        CustomerAccessService,
        CustomerRestrictionWorkflowService,
        MaterialRefreshService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogsService, useValue: { recordSystem: jest.fn().mockResolvedValue({}), recordByActor: jest.fn().mockResolvedValue({}) } },
        { provide: ApprovalsService, useValue: { createAndSubmit: jest.fn().mockResolvedValue({ id: 'ap-1', approvalNo: 'APR-1' }) } },
        { provide: SumsubClient, useValue: { createApplicantAction: jest.fn().mockResolvedValue({ id: 'act-1' }), getApplicant: jest.fn().mockResolvedValue({ info: { idDocs: [] } }) } },
        { provide: MaterialRefreshPolicyLoader, useValue: { getMaterialConfig: jest.fn().mockReturnValue({ sumsubActionLevelName: 'wave3-poa', enforceRestriction: true, windowDays: { LOW: 365 } }) } },
      ],
    }).compile();

    restrictionsService = module.get(CustomerRestrictionsService);
    accessService = module.get(CustomerAccessService);
    materialRefreshService = module.get(MaterialRefreshService);
  });

  it('SANCTION + MATERIAL_EXPIRED 并存，材料自动撕后 SANCTION 仍 OPEN 且三能力全封', async () => {
    // 1. CRA 制裁路径贴的那张（SILENT / scope=ALL / caseRef=CRA id）
    const sanction = await restrictionsService.open({
      customerId: CUSTOMER_ID,
      cause: 'SANCTION',
      reason: 'Sanctions labels on CRA-001: SANCTIONS_LIST',
      caseRef: 'cra-1',
      openedBy: 'SYSTEM',
    });
    // 2. 材料到期 cron 贴的那张（DISCLOSED / WITHDRAW+SWAP / caseRef=周期 id）
    await materialRefreshService.enterBlockingStage(HOLDING_ID);

    const before = await accessService.resolve(CUSTOMER_ID);
    expect([...before.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    expect(before.openCount).toBeGreaterThanOrEqual(2);

    // 3. 客户补齐材料 → Sumsub GREEN → 材料侧自动撕
    await materialRefreshService.handleSumsubActionResult({
      actionId: 'act-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    const rows = await restrictionsService.listAll(CUSTOMER_ID);
    const sanctionRows = rows.filter((r) => r.cause === 'SANCTION');
    const materialRows = rows.filter((r) => r.cause === 'MATERIAL_EXPIRED');

    // 制裁那张纹丝不动
    expect(sanctionRows).toHaveLength(1);
    expect(sanctionRows[0].restrictionNo).toBe(sanction.restrictionNo);
    expect(sanctionRows[0].status).toBe('OPEN');
    expect(sanctionRows[0].releasedAt).toBeNull();
    expect(sanctionRows[0].releaseMode).toBeNull();

    // 材料那张（及其全部 scope 行）撕干净，且标记为自动撕
    expect(materialRows.length).toBeGreaterThan(0);
    expect(materialRows.every((r) => r.status === 'RELEASED')).toBe(true);
    expect(materialRows.every((r) => r.releaseMode === 'AUTO')).toBe(true);

    // 执法读侧：SANCTION 的 scope=ALL 展开后三能力仍全封
    const after = await accessService.resolve(CUSTOMER_ID);
    expect([...after.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
    // 零痕迹：SANCTION 是 SILENT，客户面什么都看不到
    expect(after.disclosed).toHaveLength(0);
    expect(after.disclosedBlocked.size).toBe(0);
  });

  it('对照组：只挂 MATERIAL_EXPIRED 时，自动撕后能力全部恢复（防止用例被空实现骗过）', async () => {
    await materialRefreshService.enterBlockingStage(HOLDING_ID);

    let access = await accessService.resolve(CUSTOMER_ID);
    expect([...access.blocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
    expect(access.disclosed).toHaveLength(1);
    expect(access.disclosed[0].label).toBe('Document expired');

    await materialRefreshService.handleSumsubActionResult({
      actionId: 'act-1',
      reviewResult: { reviewAnswer: 'GREEN' },
    });

    access = await accessService.resolve(CUSTOMER_ID);
    expect(access.blocked.size).toBe(0);
    expect(access.disclosed).toHaveLength(0);
  });

  it('INV-1 守则扫描：四个自动写入点不得再给 lifecycle 赋任何字面值', () => {
    const files = [
      'material-refresh.service.ts',
      '../tier-upgrade-case/tier-upgrade-case.service.ts',
      '../client-risk-assessment/client-risk-assessment.service.ts',
      '../../sumsub-ingestion/sumsub-ingestion.service.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      expect({ file: rel, hits: src.match(/lifecycle:\s*'/g) ?? [] }).toEqual({ file: rel, hits: [] });
    }
  });
});
```

- [ ] **Step 13: 跑测试确认红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/material-refresh/material-refresh-multi-cause.spec.ts
```
期望：Step 10 的实现已在位，前两条用例应当 PASS；若不 PASS，问题一定在 Task 3/3/4 的 `open`/`release`/`findOpenByCause`/`resolve`（如 `release()` 按 `customerId` 而非 `restrictionNo` 撕、`resolve()` 没展开 `ALL`），**回去修那三个服务，不要在本用例里放水**。第三条（INV-1 扫描）此刻应当红，因为 tier-upgrade 与 ingestion 还在写 `lifecycle`/`onboardingStatus` 字面值。

- [ ] **Step 14: 提交核心用例**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/identity/material-refresh/material-refresh-multi-cause.spec.ts
git commit -m "test(restrictions): 多因不互相解 —— 材料自动撕不碰制裁便签（真服务+内存 prisma）"
```

---

##### (c) 升级案

- [ ] **Step 15: 改红 tier-upgrade 单测**

`src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.spec.ts`

第 6 行之后追加 import：
```ts
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
```

第 30 行之后追加两个 mock：
```ts
const mockSumsub = { moveToLevel: jest.fn() };
const mockRestrictions = { open: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }) };
const mockRestrictionWorkflow = { autoRelease: jest.fn().mockResolvedValue(undefined) };
```

providers 数组（`AuditLogsService` 那项之后）追加：
```ts
        { provide: CustomerRestrictionsService, useValue: mockRestrictions },
        { provide: CustomerRestrictionWorkflowService, useValue: mockRestrictionWorkflow },
```

`beforeEach` 里 `mockPrisma.$transaction.mockImplementation(...)` 之后追加：
```ts
    mockRestrictions.open.mockResolvedValue({ restrictionNo: 'RST-1', created: true });
    mockRestrictionWorkflow.autoRelease.mockResolvedValue(undefined);
```

第 69-76 行（`createFromCra` 里断言 `complianceStatus: 'FROZEN'` 的那段）替换为：
```ts
      expect(mockRestrictions.open).toHaveBeenCalledWith({
        customerId: 'cust-1',
        cause: 'TIER_UPGRADE_PENDING',
        reason: expect.stringContaining('pending Sumsub Level 2'),
        caseRef: 'tuc-1',
        openedBy: 'SYSTEM',
      });
      expect(mockPrisma.customerMain.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ lifecycle: expect.anything() }) }),
      );
```
（同一用例的 `mockPrisma.tierUpgradeCase.create.mockResolvedValueOnce({ id: 'tuc-1', caseNo: 'TUC-001' })` 保持不变，`caseRef` 取的就是它的 `id`。）

第 79-88 行「no sumsubApplicantId」用例里，把 `mockPrisma.tierUpgradeCase.create.mockResolvedValueOnce({ id: 'tuc-1' })` 改成 `{ id: 'tuc-1', caseNo: 'TUC-002' }`（`createFromCra` 现在无条件读 `upgradeCase.caseNo` 写审计）。第 90-100 行「moveToLevel throws」用例已经带 `caseNo`，不动。

第 136-177 行两个 `handleSignoffComplete` 用例替换为：
```ts
    it('APPROVED → COMPLETED：升 HIGH，只撕自己那张 TIER_UPGRADE_PENDING', async () => {
      mockPrisma.tierUpgradeCase.findUnique.mockResolvedValueOnce({ ...upgradeCase, caseNo: 'TUC-001' });

      await service.handleSignoffComplete('tuc-1', { status: 'APPROVED' });

      expect(mockPrisma.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ riskRating: 'HIGH' }) }),
      );
      expect(mockRestrictionWorkflow.autoRelease).toHaveBeenCalledWith(
        'cust-1', 'TIER_UPGRADE_PENDING', 'tuc-1', 'system',
      );
      // 不许再无条件清全部：只调这一次，且带 cause+caseRef 双键
      expect(mockRestrictionWorkflow.autoRelease).toHaveBeenCalledTimes(1);
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('REJECTED → INV-1：不动 lifecycle，先贴 ADMIN_SUSPENSION 再撕升级便签', async () => {
      mockPrisma.tierUpgradeCase.findUnique.mockResolvedValueOnce({ ...upgradeCase, caseNo: 'TUC-001' });

      await service.handleSignoffComplete('tuc-1', { status: 'REJECTED' });

      expect(mockRestrictions.open).toHaveBeenCalledWith({
        customerId: 'cust-1',
        cause: 'ADMIN_SUSPENSION',
        reason: 'Tier upgrade TUC-001 rejected at Phase 2 approval',
        caseRef: 'tuc-1',
        openedBy: 'SYSTEM',
      });
      expect(mockRestrictionWorkflow.autoRelease).toHaveBeenCalledWith(
        'cust-1', 'TIER_UPGRADE_PENDING', 'tuc-1', 'system',
      );
      // 顺序：先贴新的再撕旧的，中间不留无限制空窗
      expect(mockRestrictions.open.mock.invocationCallOrder[0])
        .toBeLessThan(mockRestrictionWorkflow.autoRelease.mock.invocationCallOrder[0]);
      expect(mockPrisma.customerMain.update).not.toHaveBeenCalled();
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
    });
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.spec.ts
```
期望失败：`Nest can't resolve dependencies of the TierUpgradeCaseService (..., ?)`。

- [ ] **Step 16: 实现 (c) —— `createFromCra`**

`src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.ts`

第 7 行之后追加 import：
```ts
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
```

构造函数（第 13-18 行）末参追加：
```ts
    private readonly auditLogsService: AuditLogsService,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
  ) {}
```

第 33-52 行（`let upgradeCase: any;` 起到 `$transaction` 结束）替换：
```ts
    const upgradeCase = await this.prisma.tierUpgradeCase.create({
      data: {
        caseNo,
        customerId: cra.customerId,
        sourceCraId: cra.id,
        status: 'PENDING_LEVEL2',
        traceId,
      },
    });

    // 摁住改贴便签：TIER_UPGRADE_PENDING（DISCLOSED，默认卡 WITHDRAW+SWAP，
    // 客户看到 "Additional review in progress"）。caseRef=本升级案 id ——
    // Phase 2 结案时只能凭这个键撕自己这张。原来那个 $transaction 里只剩这一条
    // 写，事务壳已无意义，故拆掉。
    await this.restrictionsService.open({
      customerId: cra.customerId,
      cause: 'TIER_UPGRADE_PENDING',
      reason: `Tier upgrade ${caseNo} pending Sumsub Level 2 + Phase 2 approval`,
      caseRef: upgradeCase.id,
      openedBy: 'SYSTEM',
    });
```

第 66-76 行的审计调用里把 `upgradeCase?.id` / `upgradeCase?.caseNo` 改成 `upgradeCase.id` / `upgradeCase.caseNo`（此刻已确定非空）。

- [ ] **Step 17: 实现 (c) —— `handleSignoffComplete` 双分支**

第 140-157 行（APPROVED 分支）替换：
```ts
      await this.prisma.$transaction(async (tx: any) => {
        await tx.customerMain.update({
          where: { id: upgradeCase.customerId },
          data: {
            riskRating: 'HIGH',
            riskRatingUpdatedAt: new Date(),
            latestRiskAssessmentId: upgradeCase.sourceCraId,
            latestRiskApprovalId: upgradeCase.phase2ApprovalCaseId,
            latestRiskApprovalStatus: 'APPROVED',
          },
        });
        await tx.tierUpgradeCase.update({
          where: { id: upgradeCase.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
      });

      // 只撕自己那张（cause + caseRef 双键），不再无条件把客户清成 CLEAR ——
      // 客户身上若还挂着制裁/材料便签，升级通过不该把它们一起解开。
      await this.restrictionWorkflowService.autoRelease(
        upgradeCase.customerId,
        'TIER_UPGRADE_PENDING',
        upgradeCase.id,
        'system',
      );
```

第 170-184 行（REJECTED 分支的 `$transaction` 整块）替换：
```ts
      await this.prisma.tierUpgradeCase.update({
        where: { id: upgradeCase.id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });

      // INV-1：升级审批被拒 ≠ 客户被拒户，lifecycle 不动（原来写
      // onboardingStatus=REJECTED + adminStatus=INACTIVE 是把两件事混成一件）。
      // 先贴新的 ADMIN_SUSPENSION、再撕旧的 TIER_UPGRADE_PENDING —— 顺序反了
      // 中间会出现一个客户完全不受限的窗口。
      await this.restrictionsService.open({
        customerId: upgradeCase.customerId,
        cause: 'ADMIN_SUSPENSION',
        reason: `Tier upgrade ${upgradeCase.caseNo} rejected at Phase 2 approval`,
        caseRef: upgradeCase.id,
        openedBy: 'SYSTEM',
      });
      await this.restrictionWorkflowService.autoRelease(
        upgradeCase.customerId,
        'TIER_UPGRADE_PENDING',
        upgradeCase.id,
        'system',
      );
```

- [ ] **Step 18: 跑测试确认绿 + 提交**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.spec.ts
```
期望：全部 PASS。

```bash
git add src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.ts src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.spec.ts
git commit -m "feat(tier-upgrade): 升级摁住/解除迁到限制账，Phase2 拒绝停写 lifecycle(INV-1)"
```

---

##### (d) Sumsub 案件裁决

- [ ] **Step 19: 加红 ingestion 单测**

`src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts`

第 5 行之后追加 import：
```ts
import { SumsubWebhookEvent } from '@prisma/client';
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
```

第 24 行之后（`let service:` 之前）追加：
```ts
  let restrictions: jest.Mocked<Pick<CustomerRestrictionsService, 'open'>>;
  let restrictionWorkflow: jest.Mocked<Pick<CustomerRestrictionWorkflowService, 'autoRelease'>>;
```

`beforeEach` 里，`materialRefreshService = ...` 之后、`service = new SumsubIngestionService(` 之前追加：
```ts
    restrictions = { open: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }) } as any;
    restrictionWorkflow = { autoRelease: jest.fn().mockResolvedValue(undefined) } as any;
```
并把构造调用的尾部两行改成：
```ts
      swapWebhookRouter,
      restrictions as any,
      restrictionWorkflow as any,
    );
```

文件末尾（最后一个 `});` 之前）追加新 describe：
```ts
  describe('caseDecisionSimulated → 限制账（Task 7）', () => {
    function caseEvent(decision: 'APPROVE' | 'REJECT'): SumsubWebhookEvent {
      const ev = buildEvent('caseDecisionSimulated');
      (ev as any).eventType = 'caseDecisionSimulated';
      (ev as any).rawPayload = JSON.stringify({
        type: 'caseDecisionSimulated',
        assessmentId: 'cra-1',
        customerId: 'cust-1',
        decision,
      });
      return ev;
    }

    beforeEach(() => {
      prisma.clientRiskAssessment = {
        findUnique: jest.fn().mockResolvedValue({ id: 'cra-1', status: 'ESCALATED_TO_SUMSUB' }),
        update: jest.fn().mockResolvedValue({}),
      };
      prisma.customerMain = { update: jest.fn().mockResolvedValue({}) };
    });

    it('APPROVE → 只撕本 CRA 那张 SANCTION，不碰 customerMain', async () => {
      await service.dispatch(caseEvent('APPROVE'));

      expect(restrictionWorkflow.autoRelease).toHaveBeenCalledWith('cust-1', 'SANCTION', 'cra-1', 'system');
      expect(restrictions.open).not.toHaveBeenCalled();
      expect(prisma.customerMain.update).not.toHaveBeenCalled();
    });

    it('REJECT → INV-1：不动 lifecycle，贴 SANCTION 便签（同 caseRef 幂等）', async () => {
      await service.dispatch(caseEvent('REJECT'));

      expect(restrictions.open).toHaveBeenCalledWith({
        customerId: 'cust-1',
        cause: 'SANCTION',
        reason: 'Sumsub MLRO case decision REJECT on assessment cra-1',
        caseRef: 'cra-1',
        openedBy: 'SYSTEM',
      });
      expect(restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
      expect(prisma.customerMain.update).not.toHaveBeenCalled();
      expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ sumsubCaseFinalDecision: 'REJECT' }),
        }),
      );
    });
  });
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts -t 'caseDecisionSimulated'
```
期望失败：`restrictionWorkflow.autoRelease` 被调用 0 次（服务还在写 `complianceStatus`）。

- [ ] **Step 20: 实现 (d) —— `caseDecisionSimulated` 双分支**

`src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`

第 23 行之后追加 import（相对路径，禁止 `src/` 绝对导入 —— 那会让 `node dist` 必炸）：
```ts
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
```

构造函数（第 43 行 `swapWebhookRouter` 之后）追加：
```ts
    private readonly swapWebhookRouter: SwapWebhookRouter,
    private readonly restrictionsService: CustomerRestrictionsService,
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
  ) {}
```

第 176-206 行（`if (decision === 'APPROVE') { ... } else { ... }` 整块）替换：
```ts
        if (decision === 'APPROVE') {
          await this.prisma.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: {
              status: 'SIGNED',
              signedBy: 'SUMSUB_MLRO',
              signedAt: new Date(),
              sumsubCaseFinalDecision: 'APPROVE',
              sumsubCaseDecidedAt: new Date(),
            },
          });
          // 自动撕：cause + caseRef 双键，只撕 CRA 制裁路径用同一 assessmentId
          // 贴的那张 SANCTION。客户身上材料/升级等别的便签一概不动。
          await this.restrictionWorkflowService.autoRelease(
            customerId,
            'SANCTION',
            assessmentId,
            'system',
          );
        } else {
          // INV-1：Sumsub MLRO 判拒 ≠ lifecycle 回退成 REJECTED（原来还顺手写了
          // adminStatus=INACTIVE + complianceStatus=FROZEN 三件事糊一起）。
          // lifecycle 不动，摁住走便签。CRA 制裁路径已用同一 caseRef 贴过一张，
          // open() 幂等 → 这里 created:false，不会贴出第二张。
          await this.restrictionsService.open({
            customerId,
            cause: 'SANCTION',
            reason: `Sumsub MLRO case decision REJECT on assessment ${assessmentId}`,
            caseRef: assessmentId,
            openedBy: 'SYSTEM',
          });
          await this.prisma.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: {
              status: 'SIGNED',
              signedBy: 'SUMSUB_MLRO',
              signedAt: new Date(),
              sumsubCaseFinalDecision: 'REJECT',
              sumsubCaseDecidedAt: new Date(),
            },
          });
        }
```

- [ ] **Step 21: 实现 (d2) —— 同文件四处 `onboardingStatus` 读点换 `lifecycle`**

先确认 Task 1 是否已随 schema 改名一并改掉：
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
grep -n "onboardingStatus" src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
```
若无输出则跳过本步。若仍有 4 处（275 / 289 / 298 / 318），逐处改：

第 275 行：
```ts
          if (customer.lifecycle === 'IN_VERIFICATION') {
```
第 288-291 行：
```ts
          else if (
            customer.lifecycle === 'ACTIVE' &&
            event.eventType === 'applicantWorkflowCompleted'
          ) {
```
第 297-301 行：
```ts
          else if (
            customer.lifecycle === 'ACTIVE' &&
            event.eventType === 'applicantReviewed' &&
            reviewResult?.reviewAnswer === 'RED'
          ) {
```
第 318 行：
```ts
              customerStatus: customer.lifecycle,
```

- [ ] **Step 22: 跑测试确认绿 + 提交**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts
npx jest src/modules/identity/material-refresh/material-refresh-multi-cause.spec.ts
```
期望：ingestion 全绿；multi-cause 三条全绿（INV-1 源码扫描此刻应转绿 —— 四个文件都不再给 `lifecycle` 赋字面值）。

```bash
git add src/modules/sumsub-ingestion/sumsub-ingestion.service.ts src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts
git commit -m "feat(sumsub-ingestion): 案件裁决迁到限制账，REJECT 停写 lifecycle(INV-1)"
```

---

##### 闸门与文档

- [ ] **Step 23: tsc 全绿**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx tsc --noEmit
```
期望：0 错。若仍报 `complianceStatus`/`adminStatus` 不存在，用 `grep -rn "complianceStatus" src --include "*.ts"` 定位 —— 命中若落在 `customer-status.util.ts` / `auth/` / `profile-banners/` / `onboarding.service.ts`，那是 Task 4 的读侧收口，**不要在本 Task 里改**，记一行到 `doc-final/BACKLOG.md` 说明依赖顺序即可。

- [ ] **Step 24: 全量单测，确认净新增失败 0**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npm test 2>&1 | tail -30
```
期望：`Tests:` 行的 failed 数不高于本分支基线（`wallets` 4 个 pre-existing fail 不算本 Task 引入）。任何新增失败必须当场修，不许挂账。

- [ ] **Step 25: 重铺 main 栈并跑资金闸门回归**

本设计不动账本，`demo:all` / `verify:coa` 作纯回归；但删列后必须重铺库（demo 约定：不修旧数据）。
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
bash scripts/stack.sh up main
bash scripts/on-stack.sh main main:reset:biz
bash scripts/on-stack.sh main demo:all
bash scripts/on-stack.sh main verify:coa
```
期望：`demo:all` 8/8 PASS，`verify:coa` ALL PASS。

- [ ] **Step 26: e2e 全绿**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npm run test:e2e
```
期望：6 个 e2e 文件全绿。若 `withdraw-sumsub-scenarios` / `swap-sumsub-scenarios` 里有断言客户 `complianceStatus` 的旧夹具，改成断言 `GET /admin/customers/:customerNo/restrictions` 里的便签行（端点由 Task 6 提供）。

- [ ] **Step 27: 同步 truth 文档**

`doc-final/reference/truth/v2-customer-compliance.md` 第 35-36 行两条改为：

```md
- **CRA**（`client-risk-assessment/`，~85% 可用）：`startAssessment()` → Sumsub AML → `applyPolicy()`（6 规则：SANCTIONS→摁住/PEP→MLRO/ADVERSE_MEDIA/red_other/material_stale/green_stable）→ `routeSignoff()`（LOW_TO_LOW 自动 / LOW_TO_HIGH 走 `RISK_RATING_MLRO_REVIEW` 审批门=**EDD**）；制裁命中 `handleSanctionsPath()` → **贴 `SANCTION` 便签**（`restrictionsService.open({cause:'SANCTION', caseRef: assessment.id})`，2026-08-16 Task 7 起不再写 `complianceStatus`，该列已删）；`postSignoffCascade()` 的 Sumsub level 同步门也改读限制账（有 OPEN `SANCTION` 即跳过）；月度 cron `runQuarterlyAssessment()` 定期 re-KYC
- **Material Refresh**（`material-refresh/`，~95%）：每日 cron `@Cron('0 2 * * *')` 扫材料时效 → stage 迁移 → BLOCKING 阶段 **贴 `MATERIAL_EXPIRED` 便签**（`caseRef=活跃刷新周期 id`，仅 `enforceRestriction` 材料）；Sumsub doc monitoring 驱动；补件 GREEN 后 `autoRelease(customerId,'MATERIAL_EXPIRED',cycle.id,'system')` **只撕自己那张**；`terminateCycle()` 2026-08-16 起停写 `lifecycle=WITHDRAWN`（INV-1），改贴 `ADMIN_SUSPENSION`
```

同节末尾（第 40 行 `## 4.` 之前）追加一条：
```md
- **四个自动摁住点统一走限制账**（2026-08-16 Task 7）：CRA 制裁 / 材料到期 / 升级待批 / Sumsub 案件判拒，全部 `open(cause, caseRef)` 贴、`autoRelease(cause, caseRef)` 撕，**撕的定位键是 `cause + caseRef` 而非客户 id**——这就是「多因不互相解」：客户同时挂 `SANCTION` + `MATERIAL_EXPIRED` 时，补齐材料只撕材料那张，制裁纹丝不动（旧的 `complianceStatus` 单字段模型在此必然失守）。守则性用例 `material-refresh/material-refresh-multi-cause.spec.ts`（真服务 + 内存 prisma），外加 INV-1 源码扫描：四个写入点不得给 `lifecycle` 赋任何字面值。三处 INV-1 违规（`material-refresh.terminateCycle` 写 `WITHDRAWN`、`tier-upgrade-case.handleSignoffComplete` 拒绝分支写 `REJECTED`、`sumsub-ingestion` 案件 REJECT 写 `REJECTED`）已全部改为不动 lifecycle + 贴便签（前两者 `ADMIN_SUSPENSION`，第三者 `SANCTION`）
```

`doc-final/reference/truth/sumsub-ingestion.md` 第 34 行末尾补一句：
```md
（2026-08-16 Task 7：APPROVE 分支改 `restrictionWorkflowService.autoRelease(customerId,'SANCTION',assessmentId,'system')`，REJECT 分支改 `restrictionsService.open({cause:'SANCTION', caseRef: assessmentId})` + **不动 lifecycle**——原先写 `onboardingStatus=REJECTED + adminStatus=INACTIVE + complianceStatus=FROZEN` 三件事糊一起，违反 INV-1）
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add doc-final/reference/truth/v2-customer-compliance.md doc-final/reference/truth/sumsub-ingestion.md
git commit -m "docs(truth): 四个自动摁住点迁限制账 + INV-1 三处修正同步 v2/sumsub-ingestion"
```

#### 完成判据

- `npx tsc --noEmit` 0 错
- `npm test` 净新增失败 0，其中 `material-refresh-multi-cause.spec.ts` 3/3 PASS
- `npm run test:e2e` 全绿；`demo:all` 8/8；`verify:coa` ALL PASS
- `grep -rn "complianceStatus\|complianceFreeze" src/modules/identity/client-risk-assessment src/modules/identity/material-refresh src/modules/identity/tier-upgrade-case src/modules/sumsub-ingestion --include "*.ts"` 零命中
- `grep -rn "lifecycle:\s*'" src/modules/identity/material-refresh src/modules/identity/tier-upgrade-case src/modules/identity/client-risk-assessment src/modules/sumsub-ingestion --include "*.ts"` 零命中（INV-1）

---

### Task 8: 兑换 KYT 拒绝改走限制账 + 人级复核自动撕

把兑换域两处硬编码的老限制调用换成新限制账：拒绝侧 `add(['SWAP','WITHDRAW'],'KYT_REJECTED')` → 按 **SANCTION / 硬线 / 软线** 三分型 `open()`；人级复核 GREEN 侧 `clear()` → `autoRelease('KYT_REJECTED_SOFT')`。硬线 sticky 沉默、零痕迹、pendingAction 补料闭环三条既有语义**一字不动**。

**Files:**

- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`
  - 42-43（import 区，追加 `RestrictionCause` 类型导入）
  - 738-748（`handleRejectDisposition` 类注释里"每次写入独立幂等"那两条 bullet，`add` 口径已作废）
  - 813-888（`try {` 到 `SWAP_KYT_REJECTED_DISPOSED` 审计结束的整段方法体）
- Modify: `src/modules/swap-sumsub/applicant-action.handler.ts`
  - 1-10（import 区）、13-31（类注释里 `restrictionsService.clear()` 的三处描述）
  - 34-42（构造函数第 2 个注入位）、117-134（GREEN 非硬线分支）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`（Test）
  - 1231-1237（`customerRestrictionsService` mock）、1476-1481、1539-1544、1557、1700-1723、1730-1750、1766-1802、1907
- Modify: `src/modules/swap-sumsub/applicant-action.handler.spec.ts`（Test）
  - 3、25、36-38、44-48、65-69、90、111、127、148-152、164

**Interfaces:**

Consumes（均由前置 Task 交付，本 Task 只调用，不实现）：
```ts
// src/modules/identity/customers/constants/restriction-cause.constant.ts
type RestrictionCause = 'SANCTION' | 'ADMIN_SUSPENSION' | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING' | 'KYT_REJECTED_SOFT' | 'KYT_REJECTED_HARD' | 'PENDING_DOCUMENT';
const RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy>;

// src/modules/identity/customers/customer-restrictions.service.ts
CustomerRestrictionsService.open(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }>
//   OpenRestrictionInput = { customerId; cause; scopes?; reason; caseRef?; openedBy }
//   本 Task 不传 scopes —— SANCTION/KYT_REJECTED_* 三个 cause 的 scopeSelectable 均为 false，
//   scope 由 RESTRICTION_CAUSE_POLICY 带出（SANCTION→['ALL']，KYT_REJECTED_*→['SWAP','WITHDRAW']）

// src/modules/identity/customers/customer-restriction-workflow.service.ts
CustomerRestrictionWorkflowService.autoRelease(
  customerId: string, cause: RestrictionCause, caseRef: string | null, actorId: string,
): Promise<void>

// 既有，签名不变
CustomerPendingActionService.hasHardLineDisposition(customerId: string): Promise<boolean>
CustomerPendingActionService.set(customerId: string, action: CustomerPendingAction | null, markHardLine?: boolean): Promise<void>
CustomerPendingActionService.findByExternalActionId(externalActionId: string): Promise<CustomerMain | null>
AuditLogsService.recordSystem(entry): Promise<void>
```

Produces（无新增导出符号；改的是既有私有方法与 handler 的行为契约）：
```ts
// SwapWorkflowService（private，签名一字不变，只换实现）
private handleRejectDisposition(
  swap: { id; swapNo; ownerId; ownerType; ownerNo; traceId },
  input: { verdict; riskScore?; detailRaw?; applicantActions?; typedTags? },
): Promise<void>
// 新行为：恰好开一张便签，cause = hasSanction ? 'SANCTION'
//        : exposeToCustomer ? 'KYT_REJECTED_SOFT' : 'KYT_REJECTED_HARD'，caseRef = swapNo
// SWAP_KYT_REJECTED_DISPOSED 审计 metadata 新增 { restrictionNo, restrictionCause, restrictionCreated }

// SwapApplicantActionHandler（构造函数第 2 位换类型）
constructor(
  pendingActionService: CustomerPendingActionService,
  restrictionWorkflowService: CustomerRestrictionWorkflowService,  // was CustomerRestrictionsService
  auditLogsService: AuditLogsService,
)
```

> ⚠️ **对 Task 7 的一条硬性语义要求（本 Task 依赖，须回传主 agent 落到 Task 7）**：
> `autoRelease(customerId, cause, caseRef, actorId)` 中 **`caseRef === null` 必须解释为"撕掉该客户该 cause 下的全部 OPEN 便签"**，而不是"匹配 `caseRef IS NULL` 的那一张"。
> 理由是事实性的，不是偏好：`applicantActionReviewed` webhook 是**人级**事件，报文只带 `externalApplicantActionId`；认领入口 `findByExternalActionId` 返回的是 `CustomerMain` 行，而 `pendingActionExternalId / pendingActionReason / pendingActionSubmittedAt` 三列（契约明确"保留不动"）都不存任何订单号，`SwapTransaction` 表也没有反查这个 action id 的列。**handler 在运行时拿不到 `swapNo`**，任务简述里 `autoRelease(customer.id, 'KYT_REJECTED_SOFT', swapNo, 'system')` 的 `swapNo` 在该调用点不存在——只能编造一次"按 ownerId 找最近一笔 REJECTED swap"的查询，那是竞态且无凭据的。传 `null` 同时也与今天的既有行为一致：老代码 `clear(customerId, ['SWAP','WITHDRAW'])` 本来就是人级、不区分订单。

---

- [ ] **Step 1: 前置校验 —— 确认 Task 5/5/6 的三个契约符号已在树上，否则本 Task 无从写起**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
grep -n "KYT_REJECTED_SOFT\|KYT_REJECTED_HARD" src/modules/identity/customers/constants/restriction-cause.constant.ts && \
grep -n "async open(\|OpenRestrictionInput" src/modules/identity/customers/customer-restrictions.service.ts && \
grep -n "async autoRelease(" src/modules/identity/customers/customer-restriction-workflow.service.ts && \
grep -n "CustomerRestrictionWorkflowService" src/modules/identity/customers/customers.module.ts
```

三条 grep 全部有输出，且第四条能在 `customers.module.ts` 的 `exports` 里看到 `CustomerRestrictionWorkflowService`，才继续。`SwapSumsubModule` 已经 `forwardRef(() => CustomersModule)`（`swap-sumsub.module.ts:47`），只要 CustomersModule 导出了它，Step 9 的注入就不需要动模块文件。任一条为空 → 停下，回报主 agent 说前置 Task 未落地。

---

- [ ] **Step 2: RED（一）—— 把 swap-workflow spec 的 restrictions mock 从 `add` 换成 `open`**

编辑 `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`，把 1231-1237 行整段替换：

旧：
```ts
    // Task 8: CustomerRestrictionsService stays a jest mock here — its own
    // idempotency (dedup per capability) is already proven in
    // customer-restrictions.service.spec.ts (Task 1); these tests only need
    // to assert swap-workflow *calls* it correctly.
    const customerRestrictionsService = {
      add: jest.fn(() => Promise.resolve()),
    };
```
新：
```ts
    // Task 8（限制账重构）: CustomerRestrictionsService stays a jest mock here —
    // 便签本身的幂等（(customerId, cause, caseRef) 已有 OPEN 即 created:false）
    // 由 customer-restrictions.service.spec.ts 自证；这里只需要断言
    // swap-workflow **按正确的 cause / caseRef 调它**。分型判据是本文件的责任，
    // 便签落库不是。
    const customerRestrictionsService = {
      open: jest.fn(() =>
        Promise.resolve({ restrictionNo: 'RST26081500A1', created: true }),
      ),
    };
```

再在文件顶部 import 区（紧跟 1868 行附近那句 `import { CustomerPendingActionService } from '../../identity/customers/customer-pending-action.service';` 之后）追加：
```ts
import { RESTRICTION_CAUSE_POLICY } from '../../identity/customers/constants/restriction-cause.constant';
```

---

- [ ] **Step 3: RED（二）—— 改掉两处 SANCTION 断言 + 一处 not.toHaveBeenCalled + 失败注入点**

同一文件，用 `replace_all: true` 替换下面这段（1476-1481 与 1539-1544 两处**逐字节相同**，替换文本也相同，故一次改完）：

旧：
```ts
    expect(mocks.customerRestrictionsService.add).toHaveBeenCalledWith(
      'cust-1',
      ['SWAP', 'WITHDRAW'],
      'KYT_REJECTED',
      'system',
    );
```
新：
```ts
    expect(mocks.customerRestrictionsService.open).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'cust-1',
        cause: 'SANCTION',
        caseRef: 'SWP0001',
        openedBy: 'system',
      }),
    );
```

再改 1557 行（4 空格缩进，唯一）：

旧：
```ts
    expect(mocks.customerRestrictionsService.add).not.toHaveBeenCalled();
```
新：
```ts
    expect(mocks.customerRestrictionsService.open).not.toHaveBeenCalled();
```

再改 1907 行的失败注入：

旧：
```ts
      (mocks.customerRestrictionsService.add as jest.Mock).mockRejectedValueOnce(
```
新：
```ts
      (mocks.customerRestrictionsService.open as jest.Mock).mockRejectedValueOnce(
```

---

- [ ] **Step 4: RED（三）—— 重写 `→ handleRejectDisposition (Task 8)` 里的软线 / 两条硬线 / 幂等四个用例**

同一文件。**软线用例**（1696-1723 整段 `it(...)`）替换为：

旧（首行 `    it('软线（有 applicantActions，无 SANCTION）→ 写 restrictions(SWAP,WITHDRAW) + pendingAction 可见', async () => {`，到它的 `});` 为止）
新：
```ts
    it('软线（有 applicantActions，无 SANCTION）→ 贴 KYT_REJECTED_SOFT 便签（DISCLOSED）+ pendingAction 可见', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
      });

      expect(mocks.customerRestrictionsService.open).toHaveBeenCalledTimes(1);
      const openArg = (mocks.customerRestrictionsService.open as jest.Mock).mock.calls[0][0];
      expect(openArg).toMatchObject({
        customerId: 'cust-1',
        cause: 'KYT_REJECTED_SOFT',
        caseRef: 'SWP0001',
        openedBy: 'system',
      });
      // scope 不由 swap 域指定 —— R2：只有 PENDING_DOCUMENT 允许调用方选 scope。
      expect(openArg.scopes).toBeUndefined();
      expect(openArg.reason).toContain('SWP0001');
      // 「客户能看见」不是这里 mock 出来的断言，而是注册表对这个 cause 的定性：
      // 选了 SOFT 就等于选了 DISCLOSED，客户面 disclosed 必然非空。
      expect(RESTRICTION_CAUSE_POLICY[openArg.cause].visibility).toBe('DISCLOSED');
      expect(RESTRICTION_CAUSE_POLICY[openArg.cause].customerLabel).not.toBe('');

      expect(await mocks.pendingActionService.get('cust-1')).toEqual({
        externalActionId: 'EA1',
        reason: 'KYT_REJECTED',
        submittedAt: null,
      });

      // Review Fix 4 (Minor): business key + which action was shown, both in
      // the audit trail — 外加 Task 8 新增的便签锚点（从 swap 审计跳限制账）。
      const dispositionAudit = (mocks.auditLogsService.recordSystem as jest.Mock).mock.calls
        .map((c) => c[0])
        .find((a: any) => a.action === AuditActions.SWAP_KYT_REJECTED_DISPOSED);
      expect(dispositionAudit.entityOwnerNo).toBe('C0001');
      expect(dispositionAudit.metadata.externalActionId).toBe('EA1');
      expect(dispositionAudit.metadata.restrictionNo).toBe('RST26081500A1');
      expect(dispositionAudit.metadata.restrictionCause).toBe('KYT_REJECTED_SOFT');
    });
```

**SANCTION 硬线用例**（原 1726-1738）替换为：
```ts
    it('制裁命中（SANCTION tag）→ 贴 cause=SANCTION（不是 KYT_REJECTED_HARD）且 SILENT，pendingAction 为 null', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A1', externalActionId: 'EA1' }],
        typedTags: ['SANCTION'],
      });

      const openArg = (mocks.customerRestrictionsService.open as jest.Mock).mock.calls[0][0];
      // 判据优先级 SANCTION > 硬线：记成 KYT_REJECTED_HARD 会同时把 scope 从
      // ALL 缩到 SWAP+WITHDRAW、把解除门槛从 MLRO 降到 OPS —— 两处都放松。
      expect(openArg.cause).toBe('SANCTION');
      expect(RESTRICTION_CAUSE_POLICY[openArg.cause].visibility).toBe('SILENT');
      expect(RESTRICTION_CAUSE_POLICY[openArg.cause].releasePolicy).toBe('MLRO_APPROVAL');
      expect(RESTRICTION_CAUSE_POLICY[openArg.cause].defaultScopes).toEqual(['ALL']);
      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
    });
```

**无 action 硬线用例**（原 1740-1748）替换为：
```ts
    it('硬线（无 applicantActions，非制裁）→ 贴 KYT_REJECTED_HARD（SILENT），pendingAction 为 null，disclosed 为空', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);

      await service.applyKytVerdict('s1', { verdict: 'rejected', applicantActions: [] });

      const openArg = (mocks.customerRestrictionsService.open as jest.Mock).mock.calls[0][0];
      expect(openArg.cause).toBe('KYT_REJECTED_HARD');
      expect(openArg.caseRef).toBe('SWP0001');
      // 零痕迹：SILENT + customerLabel 为空串 ⇒ 客户面 disclosed 拿不到任何行。
      expect(RESTRICTION_CAUSE_POLICY[openArg.cause].visibility).toBe('SILENT');
      expect(RESTRICTION_CAUSE_POLICY[openArg.cause].customerLabel).toBe('');
      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
    });
```

**幂等用例**里的两段 `add` 断言（1782-1793）替换为：
```ts
      expect(mocks.customerRestrictionsService.open).toHaveBeenCalledTimes(2);
      // 两次入参逐字相同 ⇒ 幂等键 (customerId, cause, caseRef) 相同 ⇒ 第二次
      // 在服务层命中已有 OPEN、返回 created:false，不会贴出第二张便签
      // （去重本身由 customer-restrictions.service.spec.ts 自证）。
      const [firstOpen, secondOpen] = (
        mocks.customerRestrictionsService.open as jest.Mock
      ).mock.calls.map((c) => c[0]);
      expect(secondOpen).toEqual(firstOpen);
      expect(firstOpen).toMatchObject({
        customerId: 'cust-1',
        cause: 'KYT_REJECTED_SOFT',
        caseRef: 'SWP0001',
        openedBy: 'system',
      });
```

最后，在幂等用例之后**新增**一条 sticky 泄密回归用例：
```ts
    it('sticky 硬线之后的"软线"裁决必须贴 SILENT 便签，不得贴 DISCLOSED（否则等于变相通风报信）', async () => {
      const mocks = buildApplyKytVerdictMocks();
      const service = makeApplyKytVerdictService(mocks);
      const swapA = { ...mocks.swapRow, id: 'sA', swapNo: 'SWP-A' };
      const swapB = { ...mocks.swapRow, id: 'sB', swapNo: 'SWP-B' };

      await (service as any).handleRejectDisposition(swapA, {
        verdict: 'rejected',
        typedTags: ['SANCTION'],
      });
      await (service as any).handleRejectDisposition(swapB, {
        verdict: 'rejected',
        applicantActions: [{ applicantActionId: 'A2', externalActionId: 'EA2' }],
      });

      const causes = (mocks.customerRestrictionsService.open as jest.Mock).mock.calls.map(
        (c) => c[0].cause,
      );
      expect(causes).toEqual(['SANCTION', 'KYT_REJECTED_HARD']);
      // 不变量：客户能看见的便签 ⇔ 客户有活可干。B 单没暴露入口，便签就不能可见。
      expect(RESTRICTION_CAUSE_POLICY[causes[1]!].visibility).toBe('SILENT');
      expect(await mocks.pendingActionService.get('cust-1')).toBeNull();
    });
```

---

- [ ] **Step 5: 跑测试确认 RED**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t 'handleRejectDisposition'
```

期望：**失败**。实现仍在调 `this.customerRestrictionsService.add(...)`，而 mock 上已只有 `open`，因此 `handleRejectDisposition` 的 `try` 里抛 `TypeError: this.customerRestrictionsService.add is not a function`，被 catch 写完 `SWAP_KYT_REJECTED_DISPOSITION_FAILED` 后原样重抛。输出里应看到多条 `● SwapWorkflowService.applyKytVerdict › → handleRejectDisposition (Task 8) › ...` 且报错文本含 `add is not a function`，`Tests:` 行显示 `failed`。若这里意外全绿，说明改错了文件，停下排查。

---

- [ ] **Step 6: GREEN（一）—— swap-workflow.service.ts 加 `RestrictionCause` 类型导入**

在 43 行之后插入：
```ts
import type { RestrictionCause } from '../../identity/customers/constants/restriction-cause.constant';
```

---

- [ ] **Step 7: GREEN（二）—— 更新 `handleRejectDisposition` 类注释里作废的两条幂等 bullet**

把 742-743 行：
```
   *   - customerRestrictionsService.add is dedup'd per capability (Task 1) —
   *     re-adding SWAP/WITHDRAW is a no-op on repeat calls.
```
替换为：
```
   *   - customerRestrictionsService.open is dedup'd on (customerId, cause,
   *     caseRef); caseRef 传的是本单 swapNo，所以同一笔 swap 的 webhook 重投
   *     恒命中同一张便签、返回 created:false，不会越贴越多。
```

---

- [ ] **Step 8: GREEN（三）—— 重写方法体：三分型 `open()` 取代无条件 `add()`**

把 813-888 行（从 `    try {` 之后的第一行注释起，到 `SWAP_KYT_REJECTED_DISPOSED` 审计那次 `});` 为止）整段替换为：

```ts
      // 收紧方向、免事前审批：无论软硬线都先贴限制便签。scope **不由这里指定**
      // —— 由 RESTRICTION_CAUSE_POLICY 按 cause 带出（R2：只有 PENDING_DOCUMENT
      // 允许调用方选 scope）。由此产生一处**故意的行为变更**：SANCTION 的默认
      // scope 是 ALL，所以制裁命中从本轮起会连 DEPOSIT 一并卡住，取代旧注释
      // 「DEPOSIT 故意不限制 —— 链上资金已到账」的口径（设计 §3.3 + 验收场景 5
      // 明确要求制裁客户三域在途单全冻）。非制裁路径口径不变：KYT_REJECTED_SOFT
      // / KYT_REJECTED_HARD 的默认 scope 仍是 SWAP+WITHDRAW，充值照旧不拦。
      //
      // Review Fix 5 (Minor): 下面这两次写入（restrictions.open /
      // customerPendingActionService.set）不在同一事务里，中途崩溃会留下不
      // 一致状态。当前顺序（先贴便签再写 pendingAction）是故意的 fail-safe
      // 排列：如果崩在两次写入之间，客户已经被限制、只是暂时看不到补料入口
      // （偏保守，不出事）；反过来的顺序会在中途崩溃时出现「入口已经暴露但
      // 限制还没落地」的窗口，更危险。不要因为"看起来能合并成一次"把这个顺
      // 序调换——它是 load-bearing 的。分型所需的三个量（hasSanction /
      // actions / alreadyHardLined）全部是纯计算或只读查询，提到 open() 之前
      // 不改变任何**写入**的先后。
      const hasSanction = (input.typedTags ?? []).includes('SANCTION');
      const actions = input.applicantActions ?? [];
      // 本次裁决单看自己是不是硬线：无 action 可做，或命中 SANCTION。
      const isHardLineThisVerdict = hasSanction || actions.length === 0;

      // Review Fix 2: 跨订单持久化 —— 查这个客户是否曾经被任意一笔 swap 硬线
      // 过。一旦命中过，永久不再暴露，不管这次裁决本身是软线还是硬线。
      const alreadyHardLined = await this.customerPendingActionService.hasHardLineDisposition(
        swap.ownerId,
      );

      // tipping-off 线：制裁调查绝不能提示客户；只有「这次是软线」且「这个
      // 客户从未被硬线过」才暴露入口。
      const exposeToCustomer = !alreadyHardLined && !isHardLineThisVerdict;

      // 三分型，判据优先级 SANCTION > 硬线 > 软线：
      //   1) 命中 SANCTION tag → cause='SANCTION'，**不是** KYT_REJECTED_HARD。
      //      两者都 SILENT，但 SANCTION 的 scope 是 ALL、releasePolicy 是
      //      MLRO_APPROVAL（且撕的时候要 releaseOrderRef）；记成 KYT 硬线会同时
      //      把范围缩到 SWAP+WITHDRAW、把解除门槛降到 OPS —— 两处都是放松。
      //   2) 其余不暴露的情形（本次无 action，或此人已被 sticky 硬线过）→
      //      'KYT_REJECTED_HARD'（SILENT）。
      //   3) 暴露给客户的软线 → 'KYT_REJECTED_SOFT'（DISCLOSED，客户端出
      //      「Verification required」，撕由 applicantActionReviewed=GREEN 自动完成）。
      //
      // cause 与 exposeToCustomer 共用同一个决策量，于是不变量成立：
      // **客户能看见的便签 ⇔ 客户有活可干**。这同时堵住一个泄密口 —— 已被制裁
      // sticky 沉默的客户，之后一笔「看起来是软线」的裁决若贴 DISCLOSED 便签，
      // 会在客户端弹出可见提示，等于变相通风报信。
      const cause: RestrictionCause = hasSanction
        ? 'SANCTION'
        : exposeToCustomer
        ? 'KYT_REJECTED_SOFT'
        : 'KYT_REJECTED_HARD';

      const swapRef = swap.swapNo ?? swap.id;
      const { restrictionNo, created: restrictionCreated } =
        await this.customerRestrictionsService.open({
          customerId: swap.ownerId,
          cause,
          reason: hasSanction
            ? `Sanction screening hit on swap ${swapRef} — KYT verdict rejected`
            : exposeToCustomer
            ? `KYT verdict rejected on swap ${swapRef} — re-verification action available`
            : `KYT verdict rejected on swap ${swapRef} — no re-verification action exposed`,
          // 业务键做 caseRef：便签因哪一笔兑换而贴一眼可查，同时它是幂等键
          // (customerId, cause, caseRef) 的第三段 —— 同一笔 swap 的 webhook
          // 重投只会命中同一张便签，不会越贴越多。
          caseRef: swap.swapNo,
          openedBy: 'system',
        });

      // 无条件调用 set（而非只在暴露时才调用），这样硬线裁决也会把客户此前
      // 可能留下的软线 pendingAction 一并清空，不留旧入口。
      //
      // Finding 3 (Minor, 终审): sticky marker keyed on hasSanction only — see
      // the class-comment note above. isHardLineThisVerdict still decides
      // exposure for THIS verdict (no-actions correctly exposes nothing here
      // too), it just must not be what makes the silence permanent.
      await this.customerPendingActionService.set(
        swap.ownerId,
        exposeToCustomer
          ? { externalActionId: actions[0]!.externalActionId, reason: 'KYT_REJECTED', submittedAt: null }
          : null,
        hasSanction,
      );

      await this.auditLogsService.recordSystem({
        action: AuditActions.SWAP_KYT_REJECTED_DISPOSED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: swap.id,
        entityNo: swap.swapNo || undefined,
        traceId: swap.traceId ?? undefined,
        workflowType: AuditWorkflowTypes.SWAP,
        entityOwnerType: swap.ownerType,
        entityOwnerId: swap.ownerId,
        // Review Fix 4 (Minor): business key alongside the UUID — this is the
        // record explaining a tipping-off decision to an investigator.
        entityOwnerNo: swap.ownerNo || undefined,
        reason: hasSanction
          ? 'Sanction hit — customer not notified (tipping-off)'
          : alreadyHardLined
          ? 'Restricted; customer previously hard-lined on another swap — not notified (sticky silence)'
          : exposeToCustomer
          ? 'Restricted; re-verification action exposed to customer'
          : 'Restricted; no action available — customer not notified',
        metadata: {
          hasSanction,
          actionCount: actions.length,
          exposeToCustomer,
          alreadyHardLined,
          // Task 8: 便签与本单的双向锚点 —— 从 swap 审计跳限制账，caseRef 跳回来。
          restrictionNo,
          restrictionCause: cause,
          restrictionCreated,
          // Review Fix 4 (Minor): which action was actually shown, when one was.
          externalActionId: exposeToCustomer ? actions[0]!.externalActionId : undefined,
        },
        sourcePlatform: 'SYSTEM',
      });
```

---

- [ ] **Step 9: 跑测试确认 GREEN + tsc**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts && \
npx tsc --noEmit
```

期望：jest 输出 `Test Suites: 1 passed, 1 total`（整个文件全绿，不只 `-t` 过滤的那批 —— 1476/1539/1557/1907 四处旁路断言也必须跟着绿）；`npx tsc --noEmit` 零输出。

---

- [ ] **Step 10: commit（a）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
git add src/modules/trading/swap-transactions/swap-workflow.service.ts \
        src/modules/trading/swap-transactions/swap-workflow.service.spec.ts && \
git commit -m "feat(swap): KYT 拒绝改贴限制账便签 —— SANCTION/硬线/软线三分型 open(),caseRef=swapNo"
```

---

- [ ] **Step 11: RED（四）—— 改 applicant-action handler spec 的注入与断言**

编辑 `src/modules/swap-sumsub/applicant-action.handler.spec.ts`。

3 行：
```ts
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
```
→
```ts
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
```

25 行：
```ts
  let restrictionsService: jest.Mocked<CustomerRestrictionsService>;
```
→
```ts
  let restrictionWorkflowService: jest.Mocked<CustomerRestrictionWorkflowService>;
```

36-38 行：
```ts
    restrictionsService = {
      clear: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CustomerRestrictionsService>;
```
→
```ts
    restrictionWorkflowService = {
      autoRelease: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<CustomerRestrictionWorkflowService>;
```

46 行（构造函数第 2 实参）：
```ts
      restrictionsService,
```
→
```ts
      restrictionWorkflowService,
```

65-69 行（GREEN 非硬线）：
```ts
    expect(restrictionsService.clear).toHaveBeenCalledWith(
      'c1',
      ['SWAP', 'WITHDRAW'],
      'system',
    );
```
→
```ts
    // caseRef 传 null —— webhook 是人级事件，报文与 pendingAction 三列都不带
    // 订单号，handler 拿不到 swapNo；null ⇒ 撕掉该客户全部 OPEN 的软线便签，
    // 与改造前 clear(['SWAP','WITHDRAW']) 的人级语义等价。
    expect(restrictionWorkflowService.autoRelease).toHaveBeenCalledWith(
      'c1',
      'KYT_REJECTED_SOFT',
      null,
      'system',
    );
```

148-152 行（真实字段名认领用例里同一段断言）做**同样**的替换。

90 / 111 / 127 / 164 四行（`expect(restrictionsService.clear).not.toHaveBeenCalled();`）用 `replace_all: true` 一次改完：
```ts
    expect(restrictionsService.clear).not.toHaveBeenCalled();
```
→
```ts
    expect(restrictionWorkflowService.autoRelease).not.toHaveBeenCalled();
```

最后在 90 行那条硬线用例的断言后追加一句，把「硬线客户 GREEN → 便签仍 OPEN」写死：
```ts
    // 硬线 sticky：GREEN 只消费掉这次 action，SANCTION / KYT_REJECTED_HARD
    // 便签一张都不能撕 —— 完成一次补料动作不得自我解除制裁。
    expect(restrictionWorkflowService.autoRelease).not.toHaveBeenCalled();
```

---

- [ ] **Step 12: 跑测试确认 RED**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
npx jest src/modules/swap-sumsub/applicant-action.handler.spec.ts
```

期望：**失败**。handler 仍调 `this.restrictionsService.clear(...)`，而第 2 个注入位现在是只有 `autoRelease` 的对象，GREEN 非硬线两条用例报 `TypeError: this.restrictionsService.clear is not a function`；`autoRelease` 断言报 `Number of calls: 0`。`Tests:` 行显示至少 2 failed。

---

- [ ] **Step 13: GREEN（四）—— handler 换注入 + 换调用**

编辑 `src/modules/swap-sumsub/applicant-action.handler.ts`。

3 行：
```ts
import { CustomerRestrictionsService } from '../identity/customers/customer-restrictions.service';
```
→
```ts
import { CustomerRestrictionWorkflowService } from '../identity/customers/customer-restriction-workflow.service';
```

40 行：
```ts
    private readonly restrictionsService: CustomerRestrictionsService,
```
→
```ts
    private readonly restrictionWorkflowService: CustomerRestrictionWorkflowService,
```

24 行（类注释里作废的方法名）：
```
 * 绝不调用 restrictionsService.clear()，并写一条专属审计说明为何限制被保留，
```
→
```
 * 绝不调用 restrictionWorkflowService.autoRelease()，并写一条专属审计说明为何
 * 限制被保留，
```

17 行（类注释里"零调用方"那句已不成立）：
```
 * `CustomerRestrictionsService.clear()` 至今零调用方 —— 本 handler 是它的
 * 第一个调用方。
```
→
```
 * Task 8（限制账重构）：解除口从 `CustomerRestrictionsService.clear()`（人级
 * capability 列表）改为 `CustomerRestrictionWorkflowService.autoRelease()`
 * （按 cause 撕便签、releaseMode=AUTO、不走审批）。
```

117-127 行的 GREEN 非硬线分支注释与调用：
```ts
      // 非硬线：先清限制、再写审计、最后才清 pendingAction 指针。
```
起到
```ts
      await this.restrictionsService.clear(customer.id, ['SWAP', 'WITHDRAW'], 'system');
```
为止，整段替换为：
```ts
      // 非硬线：先撕便签、再写审计、最后才清 pendingAction 指针。
      // 顺序拆成两层考虑：
      // 1）撕便签先于清指针——与 handleRejectDisposition 的 fail-safe 顺序
      //    哲学对称（先落成保守态，中途崩溃时留下的窗口更安全：万一崩在
      //    这之后，客户已经解限只是暂时还看得到入口，不会出现"入口已消失
      //    但仍被限制"这种更危险的状态）。
      // 2）审计先于清指针（Finding 3，同上一个分支的理由）——`set(...,
      //    null, ...)` 才是"消费认领"的那一步，审计必须抢在它前面落地，
      //    否则重投时指针已空、handler 直接落空返回 false，
      //    `SWAP_ACTION_CLEARED` 这条记录就永远不会存在。
      //
      // 只撕 KYT_REJECTED_SOFT 一个 cause —— 这是本域自己贴的、且注册表里
      // 「自动撕条件」写明由 applicantActionReviewed=GREEN 触发的唯一一个。
      // 客户身上若还并存 SANCTION / MATERIAL_EXPIRED 等其它 cause 的便签，
      // 一张都不受影响（多因并存不互相解，这是限制账设计的首要理由）。
      //
      // caseRef 传 null：本 webhook 是**人级**事件，报文只带
      // externalApplicantActionId，认领到的 CustomerMain 行上
      // pendingActionExternalId / pendingActionReason / pendingActionSubmittedAt
      // 三列都不存订单号，SwapTransaction 也没有反查该 action id 的列 ——
      // 这里根本拿不到 swapNo。null ⇒ 撕掉该客户该 cause 下全部 OPEN 便签，
      // 与改造前 clear(customerId, ['SWAP','WITHDRAW']) 的人级语义一致。
      await this.restrictionWorkflowService.autoRelease(
        customer.id,
        'KYT_REJECTED_SOFT',
        null,
        'system',
      );
```

再把紧随其后的 `SWAP_ACTION_CLEARED` 审计的两个字段改成新口径：
```ts
        reason: 'GREEN applicant action review — SWAP/WITHDRAW restrictions cleared',
        metadata: { externalActionId },
```
→
```ts
        reason: 'GREEN applicant action review — KYT_REJECTED_SOFT restriction auto-released',
        metadata: { externalActionId, cause: 'KYT_REJECTED_SOFT', releaseMode: 'AUTO' },
```

---

- [ ] **Step 14: 跑测试确认 GREEN + tsc**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
npx jest src/modules/swap-sumsub/applicant-action.handler.spec.ts src/modules/swap-sumsub/swap-sumsub.module.spec.ts && \
npx tsc --noEmit
```

期望：`Test Suites: 2 passed, 2 total`；tsc 零输出。module spec 一并跑，是为了确认换注入没有把 `SwapSumsubModule` 的 provider 元数据搞崩（`CustomersModule` 已 forwardRef 导入，不需要改模块文件；若这里报 `Nest can't resolve dependencies of SwapApplicantActionHandler`，说明 Task 7 没把 `CustomerRestrictionWorkflowService` 加进 `CustomersModule.exports`，回 Step 1 复核）。

---

- [ ] **Step 15: 全量单测回归 —— 确认没碰坏兑换域其它 spec**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
npx jest src/modules/swap-sumsub src/modules/trading/swap-transactions
```

期望：全部 suite 通过。`swap-kyt-verdict.handler.spec.ts` / `demo-scenario.service.spec.ts` / `swap-webhook.router.spec.ts` 都不直接碰 restrictions，应原样绿；若 `demo-scenario.service.spec.ts` 因喂给 `applyKytVerdict` 的 fixture 而红，按 Step 4 的同一口径（断言 `open` 的 cause 而非 `add` 的 capability 数组）修，不要改产线代码。

---

- [ ] **Step 16: commit（b）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && \
git add src/modules/swap-sumsub/applicant-action.handler.ts \
        src/modules/swap-sumsub/applicant-action.handler.spec.ts && \
git commit -m "feat(swap): 人级复核 GREEN 改走 autoRelease 撕软线便签,硬线 sticky 仍不解限制"
```

---

### Task 9: 贴 scope=ALL 便签时冻结三域在途单（兑换域补齐）

贴一张卡住全部能力的便签（制裁 / 行政暂停）时，该客户名下所有非终态的充值、提现、兑换单必须一起冻住。今天三个域三个答案：充值只在 `runGate0()` 一个时点查、提现在三处查、**兑换只在建单前查一次，`PROCESSING` 中 4 腿照常推完**。本任务统一口径并补齐兑换域。

**架构决策（已定，实施时不要再改）：用内部域事件，不用直调。**

- 直调方案要让 `CustomerRestrictionWorkflowService`（在 `identity`）去调三个 `trading` 域的 workflow。今天依赖方向是 `trading → identity`，反向调用必然要 `forwardRef` 断环，而 `doc-final/rules/backend-platform.md` 明令「Must NOT use `forwardRef()`——循环依赖 = 分层违规，必须结构性修掉」。
- 事件方案完全合规：发射方是 `CustomerRestrictionsService`（拥有 `CustomerRestriction` 实体的 domain service，发的是**自己实体**的状态变化），订阅方是三个 workflow service。与现有 `deposit.status.changed`（`DepositTransactionsService` 发 → `DepositWorkflowService` 订）逐字同构。
- 跨模块决策规则也指向事件：「触发源不知道谁关心 → 广播事件」。限制服务确实不需要知道有三个交易域关心它。

**Files:**

- Modify: `src/common/events/domain-events.constants.ts` — 在 `DOMAIN_EVENTS` 末尾（`FUNDS_ORDER_STATUS_CHANGED` 之后，`} as const;` 之前）加一节；`DomainEventNames` 同步加一行
- Modify: `src/modules/identity/customers/customer-restrictions.service.ts` — 构造函数注入 `EventEmitter2`；`open()` 成功落库后按条件 emit
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` — L64-70（`ABNORMAL_COMPLIANCE` 常量删除）、L154-174（`runGate0()` 改读 `CustomerAccess`）、L850-860（第二处 `ABNORMAL_COMPLIANCE` 用点）、新增 `@OnEvent` 订阅方法
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` — L123-134（`ABNORMAL_COMPLIANCE` 常量删除）、L139-167（`assertCustomerComplianceOrFreeze()` 改读 `CustomerAccess`）、新增 `@OnEvent` 订阅方法
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts` — L1142 附近 `onLegConfirmed()` 前插入客户级闸、新增 `@OnEvent` 订阅方法
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts` / `withdraw-transactions.module.ts` / `swap-transactions.module.ts` — 三处 import `CustomersModule`（已 exports `CustomerAccessService`）
- Test: `src/modules/identity/customers/customer-restrictions.service.spec.ts`（追加 emit 相关用例，文件由 Task 3 建立）
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`（追加兑换在途闸用例）

**Interfaces:**

Consumes（Task 3 / Task 4 产物，逐字）：
```ts
// src/modules/identity/customers/customer-access.service.ts
export type Capability = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
export interface CustomerAccess {
  lifecycle: CustomerLifecycle;
  blocked: Set<Capability>;
  disclosedBlocked: Set<Capability>;
  disclosed: DisclosedRestrictionView[];
  openCount: number;
}
class CustomerAccessService { resolve(customerId: string): Promise<CustomerAccess>; }

// src/modules/identity/customers/customer-restrictions.service.ts
class CustomerRestrictionsService { open(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }>; }
```

Produces：
```ts
// src/common/events/domain-events.constants.ts
DOMAIN_EVENTS.CUSTOMER_RESTRICTION_OPENED = {
  name: 'customer.restriction.opened',
  emitter: 'CustomerRestrictionsService',
  subscribers: ['DepositWorkflowService', 'WithdrawWorkflowService', 'SwapWorkflowService'],
  payload: '{ customerId: string, restrictionNo: string, cause: RestrictionCause, blocksAllCapabilities: true, traceId: string }',
}
DomainEventNames.CUSTOMER_RESTRICTION_OPENED = 'customer.restriction.opened'

// 三域各新增一个订阅者（签名一致）
DepositWorkflowService.onCustomerRestrictionOpened(event: CustomerRestrictionOpenedEvent): Promise<void>
WithdrawWorkflowService.onCustomerRestrictionOpened(event: CustomerRestrictionOpenedEvent): Promise<void>
SwapWorkflowService.onCustomerRestrictionOpened(event: CustomerRestrictionOpenedEvent): Promise<void>

// 兑换域新增在途闸（复刻提现 assertCustomerComplianceOrFreeze 范式）
SwapWorkflowService.assertSwapCustomerAccessOrHalt(swap: any, stage: string): Promise<boolean>
```

被删除的导出/常量：`DepositWorkflowService.ABNORMAL_COMPLIANCE`、`WithdrawWorkflowService.ABNORMAL_COMPLIANCE`（两个字符串集合都读已删的 `complianceStatus` 列）、`DepositTransactionsService.getOwnerComplianceStatus()`、`WithdrawTransactionsService.getOwnerComplianceStatus()`。

---

- [ ] **Step 1: 登记域事件（未登记不准 emit，这是项目铁律）**

在 `src/common/events/domain-events.constants.ts` 的 `FUNDS_ORDER_STATUS_CHANGED` 条目之后、`} as const;` 之前插入：

```ts
  // ── Customer Restriction (2026-08-16) ──
  // 只在「卡住全部能力」的便签落库时发（scope=ALL：制裁 / 行政暂停）。
  // scope < ALL 的便签（材料过期等）刻意不发 —— 设计稿 §3.5：材料过期不该把
  // 已经在路上的提现拽回来。
  CUSTOMER_RESTRICTION_OPENED: {
    name: 'customer.restriction.opened',
    emitter: 'CustomerRestrictionsService',
    subscribers: ['DepositWorkflowService', 'WithdrawWorkflowService', 'SwapWorkflowService'],
    payload:
      '{ customerId: string, restrictionNo: string, cause: string, blocksAllCapabilities: true, traceId: string }',
  },
```

在文件末尾 `DomainEventNames` 的 `FUNDS_ORDER_STATUS_CHANGED` 行之后加：

```ts
  // Customer Restriction
  CUSTOMER_RESTRICTION_OPENED: DOMAIN_EVENTS.CUSTOMER_RESTRICTION_OPENED.name,
```

---

- [ ] **Step 2: 写失败的测试 —— 只有 scope=ALL 才发事件**

在 `src/modules/identity/customers/customer-restrictions.service.spec.ts` 末尾追加：

```ts
describe('CustomerRestrictionsService — customer.restriction.opened emission', () => {
  it('emits customer.restriction.opened when the cause blocks ALL capabilities', async () => {
    const emit = jest.fn();
    const { service } = buildService({ eventEmitter: { emit } as any });

    const { restrictionNo } = await service.open({
      customerId: 'cust-1',
      cause: 'SANCTION',
      reason: 'OFAC SDN match',
      caseRef: 'CRA26081500x',
      openedBy: 'mlro@fiatx.com',
    });

    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      'customer.restriction.opened',
      expect.objectContaining({
        customerId: 'cust-1',
        restrictionNo,
        cause: 'SANCTION',
        blocksAllCapabilities: true,
      }),
    );
  });

  // 设计稿 §3.5：scope < ALL 不得触碰在途单。反向断言，防有人"顺手"把它也广播了。
  it('does NOT emit when the cause blocks only some capabilities', async () => {
    const emit = jest.fn();
    const { service } = buildService({ eventEmitter: { emit } as any });

    await service.open({
      customerId: 'cust-1',
      cause: 'MATERIAL_EXPIRED',
      reason: 'Emirates ID expired 2026-08-01',
      caseRef: 'MRC26073100xx',
      openedBy: 'system-cron',
    });

    expect(emit).not.toHaveBeenCalled();
  });

  it('does NOT emit on an idempotent no-op re-open', async () => {
    const emit = jest.fn();
    const { service } = buildService({ eventEmitter: { emit } as any });

    const first = await service.open({
      customerId: 'cust-1', cause: 'SANCTION', reason: 'r', caseRef: 'c1', openedBy: 'mlro@fiatx.com',
    });
    expect(first.created).toBe(true);
    emit.mockClear();

    const second = await service.open({
      customerId: 'cust-1', cause: 'SANCTION', reason: 'r', caseRef: 'c1', openedBy: 'mlro@fiatx.com',
    });
    expect(second.created).toBe(false);
    expect(emit).not.toHaveBeenCalled();
  });
});
```

> `buildService()` 是 Task 3 在本 spec 文件里建立的工厂。本步骤给它加一个可选的 `eventEmitter` 覆盖入参 —— 若 Task 3 的工厂签名没有该入参，在本步骤一并加上（默认 `{ emit: jest.fn() }`）。

---

- [ ] **Step 3: 跑测试确认失败**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts -t 'customer.restriction.opened'
```
期望：3 个用例全 FAIL，报 `expect(jest.fn()).toHaveBeenCalledTimes(expected 1, received 0)`（服务尚未注入 emitter、尚未发事件）。

---

- [ ] **Step 4: 在 CustomerRestrictionsService 里发事件**

`src/modules/identity/customers/customer-restrictions.service.ts`：构造函数加注入，

```ts
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { RESTRICTION_CAUSE_POLICY } from './constants/restriction-cause.constant';
```

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}
```

在 `open()` 写完审计、`return` 之前插入：

```ts
    // 只有"卡住全部能力"的便签才广播——三个交易域订阅它去冻在途单。
    // scope < ALL 的便签刻意不发（设计稿 §3.5）。幂等 no-op 也不发（created=false 时本段不可达）。
    const blocksAll = RESTRICTION_CAUSE_POLICY[input.cause].defaultScopes.includes('ALL');
    if (blocksAll) {
      this.eventEmitter.emit(DomainEventNames.CUSTOMER_RESTRICTION_OPENED, {
        customerId: input.customerId,
        restrictionNo,
        cause: input.cause,
        blocksAllCapabilities: true as const,
        traceId,
      });
    }
```

> `restrictionNo` 与 `traceId` 是 `open()` 内已有的局部变量（Task 3 产出）。若变量名不同，以 Task 3 实际实现为准，不要新造。

---

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/identity/customers/customer-restrictions.service.spec.ts -t 'customer.restriction.opened'
```
期望：`Tests: 3 passed`。

---

- [ ] **Step 6: 提交事件登记与发射**

```bash
git add src/common/events/domain-events.constants.ts \
        src/modules/identity/customers/customer-restrictions.service.ts \
        src/modules/identity/customers/customer-restrictions.service.spec.ts
git commit -m "feat(identity): 限制账贴 ALL 便签时广播 customer.restriction.opened"
```

---

- [ ] **Step 7: 充值域 —— runGate0 改读 CustomerAccess，删掉字符串集合**

`src/modules/trading/deposit-transactions/deposit-workflow.service.ts`：

删除 L64-70 的 `private static readonly ABNORMAL_COMPLIANCE = new Set([...])` 整段（它读的 `complianceStatus` 列已被 Task 1 删除）。

把 `runGate0()`（L154-174）替换为：

```ts
  private async runGate0(depositId: string) {
    const deposit = await this.depositService.findOne(depositId);
    const access = await this.customerAccessService.resolve(deposit.ownerId);

    if (access.blocked.has('DEPOSIT')) {
      this.logger.warn(
        `Gate 0 FAIL: deposit ${depositId} — customer DEPOSIT capability is blocked`,
      );
      await this.depositService.updateStatus(
        depositId,
        { action: DepositTransactionAction.FREEZE },
        {
          reason: 'Customer DEPOSIT capability is restricted',
          actor: { actorType: 'SYSTEM', actorId: 'COMPLIANCE_GATE_0' },
        },
      );
      return;
    }

    this.logger.log(`Gate 0 PASS: deposit ${depositId}`);

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_GATE0_PASSED,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: AuditWorkflowTypes.DEPOSIT,
      reason: 'Customer-level compliance gate passed',
      metadata: { depositNo: deposit.depositNo },
      sourcePlatform: 'SYSTEM',
    });
  }
```

> ⚠️ 上面 `runGate0()` 的审计段是按 L175-190 现有实现重写的。**动手前先读 L154-200 原文**，把 `recordSystem` 的字段逐字对齐现状（尤其 `entityNo` / `workflowType` 的实际取值），不要照抄本计划里的猜测值。

L850-860 第二处 `ABNORMAL_COMPLIANCE.has(complianceStatus)` 同样改为 `access.blocked.has('DEPOSIT')`（先读该处上下文确认它拿的是哪个变量）。

删除 `DepositTransactionsService.getOwnerComplianceStatus()`（`grep -n "getOwnerComplianceStatus" src/modules/trading/deposit-transactions/deposit-transactions.service.ts` 定位），并确认无其它调用方。

---

- [ ] **Step 8: 充值域订阅事件冻在途单**

在 `DepositWorkflowService` 里新增：

```ts
  /**
   * 客户被贴了"卡住全部能力"的便签（制裁 / 行政暂停）→ 把他名下所有非终态充值单冻住。
   * 事件登记见 common/events/domain-events.constants.ts CUSTOMER_RESTRICTION_OPENED。
   */
  @OnEvent(DomainEventNames.CUSTOMER_RESTRICTION_OPENED, { async: true })
  async onCustomerRestrictionOpened(event: {
    customerId: string;
    restrictionNo: string;
    cause: string;
    blocksAllCapabilities: true;
    traceId: string;
  }): Promise<void> {
    const inflight = await this.depositService.findNonTerminalByOwner(event.customerId);
    for (const d of inflight) {
      try {
        await this.depositService.updateStatus(
          d.id,
          { action: DepositTransactionAction.FREEZE },
          {
            reason: `Customer restriction ${event.restrictionNo} (${event.cause}) opened`,
            actor: { actorType: 'SYSTEM', actorId: 'CUSTOMER_RESTRICTION' },
          },
        );
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_FROZEN,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: d.id,
          entityNo: d.depositNo,
          entityOwnerType: d.ownerType,
          entityOwnerId: d.ownerId,
          traceId: event.traceId,
          workflowType: AuditWorkflowTypes.DEPOSIT,
          reason: `In-flight deposit frozen by customer restriction ${event.restrictionNo}`,
          metadata: { depositNo: d.depositNo, restrictionNo: event.restrictionNo, cause: event.cause },
          sourcePlatform: 'SYSTEM',
        });
      } catch (e) {
        // 逐项错误处理：一笔冻不动（例如已在无 freeze 出边的中间态）不能连累其余几笔。
        this.logger.warn(
          `Failed to freeze in-flight deposit ${d.depositNo} for restriction ${event.restrictionNo}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
```

`DepositTransactionsService` 新增查询方法：

```ts
  /** 某客户名下所有非终态充值单（供客户级限制冻结在途单用）。 */
  async findNonTerminalByOwner(ownerId: string) {
    return this.prisma.depositTransaction.findMany({
      where: {
        ownerId,
        status: {
          notIn: [
            DepositTransactionStatus.SUCCESS,
            DepositTransactionStatus.FAILED,
            DepositTransactionStatus.CONFISCATED,
            DepositTransactionStatus.RETURNED,
            DepositTransactionStatus.SEIZED,
          ],
        },
      },
      select: { id: true, depositNo: true, ownerType: true, ownerId: true, status: true },
    });
  }
```

> 终态集合来自 v4-deposit.md §2：`TERMINAL = {SUCCESS, FAILED, CONFISCATED, RETURNED, SEIZED}`。动手前 `grep -n "TERMINAL" src/modules/trading/deposit-transactions/deposit-transactions.service.ts` 确认现有是否已有同名常量可复用，有就复用不要新写。

---

- [ ] **Step 9: 提现域同样改造**

`src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`：

删除 L123-134 的 `ABNORMAL_COMPLIANCE` 常量。把 `assertCustomerComplianceOrFreeze()`（L139-167）替换为：

```ts
  /**
   * A4 客户级能力闸：WITHDRAW 被限则把这笔提现冻住并返回 false（调用方须立即 return），否则 true。
   * 放在每个"推进前"的节点上——尤其必须早于 initiatePayoutPhase 写
   * WITHDRAW_COMPLIANCE_PASSED 审计，否则审计会替一个已被摁住的客户背书。
   */
  private async assertCustomerComplianceOrFreeze(w: any, stage: string): Promise<boolean> {
    const access = await this.customerAccessService.resolve(w.ownerId);
    if (!access.blocked.has('WITHDRAW')) return true;

    this.logger.warn(
      `A4 capability gate FAIL at ${stage}: withdrawal ${w.withdrawNo} — WITHDRAW blocked → freezing`,
    );
    await this.withdrawService.updateStatus(
      w.id,
      {
        action: WithdrawTransactionAction.FREEZE,
        reason: `Customer WITHDRAW capability restricted, detected at ${stage}`,
      },
      this.systemCtx,
    );
    await this.auditLogsService.recordSystem({
      action: AuditActions.WITHDRAW_FROZEN,
      entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
      entityId: w.id,
      entityNo: w.withdrawNo,
      entityOwnerType: w.ownerType,
      entityOwnerId: w.ownerId,
      traceId: w.traceId || undefined,
      workflowType: AuditWorkflowTypes.WITHDRAW,
      reason: `Customer-level capability gate (A4) failed at ${stage} — in-flight withdrawal frozen`,
      metadata: { withdrawNo: w.withdrawNo, stage },
      sourcePlatform: 'SYSTEM',
    });
    return false;
  }
```

三个调用点（L593 等）签名不变，无需改动。

新增订阅者，结构与 Step 8 的充值版逐行对应，差异只在实体与终态：

```ts
  @OnEvent(DomainEventNames.CUSTOMER_RESTRICTION_OPENED, { async: true })
  async onCustomerRestrictionOpened(event: {
    customerId: string;
    restrictionNo: string;
    cause: string;
    blocksAllCapabilities: true;
    traceId: string;
  }): Promise<void> {
    const inflight = await this.withdrawService.findNonTerminalByOwner(event.customerId);
    for (const w of inflight) {
      if (!(await this.assertCustomerComplianceOrFreeze(w, `restriction:${event.restrictionNo}`))) {
        continue; // 该方法内部已完成冻结与审计
      }
    }
  }
```

> 复用 `assertCustomerComplianceOrFreeze()` 而不是重写一段冻结逻辑 —— 它已经把「冻 + 审计 + 逐项容错」封装好了。`PAYOUT_PENDING` 刻意无 `freeze` 出边（钱已广播），该方法会抛，用 try/catch 包住并只 `logger.warn`，与充值域同款处理。**实施时把 for 循环体包进 try/catch**。

`WithdrawTransactionsService` 新增 `findNonTerminalByOwner()`，终态集合 `{SUCCESS, REJECTED, FAILED, RETURNED}`（来源 v5-withdraw.md §1：10 态中后 4 个是零出边终态）。

删除 `WithdrawTransactionsService.getOwnerComplianceStatus()` 并确认无其它调用方。

---

- [ ] **Step 10: 兑换域 —— 新增在途闸（本轮真正的补齐）**

先读 `src/modules/trading/swap-transactions/swap-workflow.service.ts` L1097-1160（`handleFundsOrderChanged` → `onLegConfirmed`）确认插入点。

新增方法：

```ts
  /**
   * 客户级能力闸（2026-08-16 补齐）。兑换此前只在 initiateSwap() 建单前查一次，
   * PROCESSING 中 4 腿照常推完 —— 客户在推腿途中被摁住也拦不住。复刻提现
   * assertCustomerComplianceOrFreeze 范式：命中则停推 + 审计 + 返回 false，调用方立即 return。
   *
   * 注意：兑换没有 FROZEN 态（SwapTransactionStatus 只有 4 个活态），所以这里
   * 不改状态机，只 markNeedsReview + 停止推进，留在 PROCESSING 等人工处置。
   */
  private async assertSwapCustomerAccessOrHalt(swap: any, stage: string): Promise<boolean> {
    const access = await this.customerAccessService.resolve(swap.ownerId);
    if (!access.blocked.has('SWAP')) return true;

    this.logger.warn(
      `Swap capability gate FAIL at ${stage}: swap ${swap.swapNo} — SWAP blocked → halting leg progression`,
    );
    await this.swapService.markNeedsReview(swap.id, 'CUSTOMER_RESTRICTION');
    await this.auditLogsService.recordSystem({
      action: AuditActions.SWAP_LEG_HALTED_BY_RESTRICTION,
      entityType: AuditEntityTypes.SWAP_TRANSACTION,
      entityId: swap.id,
      entityNo: swap.swapNo,
      entityOwnerType: swap.ownerType,
      entityOwnerId: swap.ownerId,
      traceId: swap.traceId || undefined,
      workflowType: AuditWorkflowTypes.SWAP,
      reason: `Customer SWAP capability restricted at ${stage} — in-flight swap leg progression halted`,
      metadata: { swapNo: swap.swapNo, stage },
      sourcePlatform: 'SYSTEM',
    });
    return false;
  }
```

在 `onLegConfirmed()` 方法体最前面插入：

```ts
    if (!(await this.assertSwapCustomerAccessOrHalt(swap, 'leg-confirmed'))) return;
```

> `swap` 变量名与 `markNeedsReview()` 的真实签名以 `onLegConfirmed()` 现有实现为准，**先读再写**。若 `markNeedsReview` 不存在同名方法，`grep -n "needsReview" src/modules/trading/swap-transactions/` 找到现役写法（v6-swap.md §4 记载腿自愈耗尽时会 `markNeedsReview`）。

新增审计动作常量 `SWAP_LEG_HALTED_BY_RESTRICTION` 到 `src/modules/audit-logging/constants/audit-actions.constant.ts` 的 `AuditActions`（放在现有 `SWAP_*` 动作附近）：

```ts
  SWAP_LEG_HALTED_BY_RESTRICTION: 'SWAP_LEG_HALTED_BY_RESTRICTION',
```

同样新增 `SwapWorkflowService.onCustomerRestrictionOpened()`，遍历该客户非终态 swap（`status` 不在 `{SUCCESS, REJECTED}`）逐个调 `assertSwapCustomerAccessOrHalt(swap, 'restriction:' + event.restrictionNo)`，for 循环体包 try/catch 只 `logger.warn`。

---

- [ ] **Step 11: 三个 trading module 导入 CustomersModule**

`deposit-transactions.module.ts` / `withdraw-transactions.module.ts` / `swap-transactions.module.ts` 三处 `imports` 数组加 `CustomersModule`。

```bash
grep -n "imports:" src/modules/trading/deposit-transactions/deposit-transactions.module.ts \
                   src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts \
                   src/modules/trading/swap-transactions/swap-transactions.module.ts
```

⚠️ **不要用 `forwardRef`**。`CustomersModule` 今天已 `exports: [CustomerRestrictionsService, CustomerPendingActionService]`，Task 4 会追加 `CustomerAccessService`。若加完 `npm run build` 报循环依赖，说明分层出了问题，停下报告，**不要**用 `forwardRef` 掩盖。

---

- [ ] **Step 12: 写兑换在途闸的失败测试**

在 `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts` 追加：

```ts
describe('SwapWorkflowService — in-flight capability gate (2026-08-16)', () => {
  it('halts leg progression when SWAP is blocked mid-PROCESSING', async () => {
    const { service, swapService, auditLogsService, customerAccessService } = buildSwapWorkflow();
    customerAccessService.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
      disclosedBlocked: new Set(),
      disclosed: [],
      openCount: 1,
    });

    const halted = await (service as any).assertSwapCustomerAccessOrHalt(
      { id: 'swap-1', swapNo: 'SW2608160001', ownerId: 'cust-1', ownerType: 'CUSTOMER', traceId: 't1' },
      'leg-confirmed',
    );

    expect(halted).toBe(false);
    expect(swapService.markNeedsReview).toHaveBeenCalledWith('swap-1', 'CUSTOMER_RESTRICTION');
    expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SWAP_LEG_HALTED_BY_RESTRICTION' }),
    );
  });

  it('lets legs proceed when only WITHDRAW is blocked (scope < ALL must not touch in-flight swaps)', async () => {
    const { service, swapService, customerAccessService } = buildSwapWorkflow();
    customerAccessService.resolve.mockResolvedValue({
      lifecycle: 'ACTIVE',
      blocked: new Set(['WITHDRAW']),
      disclosedBlocked: new Set(['WITHDRAW']),
      disclosed: [],
      openCount: 1,
    });

    const ok = await (service as any).assertSwapCustomerAccessOrHalt(
      { id: 'swap-1', swapNo: 'SW2608160001', ownerId: 'cust-1', ownerType: 'CUSTOMER', traceId: 't1' },
      'leg-confirmed',
    );

    expect(ok).toBe(true);
    expect(swapService.markNeedsReview).not.toHaveBeenCalled();
  });
});
```

> `buildSwapWorkflow()` 是该 spec 文件里现有的工厂（`grep -n "buildSwapWorkflow\|const service = " src/modules/trading/swap-transactions/swap-workflow.service.spec.ts` 确认真实名字），需给它加一个 `customerAccessService` mock（`{ resolve: jest.fn() }`）。若工厂名不同，用真实的那个，不要新建。

---

- [ ] **Step 13: 跑测试确认失败，再实现，再跑通过**

```bash
npx jest src/modules/trading/swap-transactions/swap-workflow.service.spec.ts -t 'in-flight capability gate'
```
期望第一次：FAIL，`service.assertSwapCustomerAccessOrHalt is not a function`。
完成 Step 10 的实现后重跑，期望：`Tests: 2 passed`。

---

- [ ] **Step 14: 类型闸 + 全量单测**

```bash
npx tsc --noEmit
npm test
```
期望：`tsc` 0 错（此时 Task 1-8 已全部落地，删列造成的红应已收敛）；`npm test` 相对本任务开始前**净新增失败 0**（项目有 4 个 wallets 相关的 pre-existing 失败，见 BACKLOG，不算本任务的账）。

---

- [ ] **Step 15: 提交**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts \
        src/modules/trading/deposit-transactions/deposit-transactions.service.ts \
        src/modules/trading/deposit-transactions/deposit-transactions.module.ts \
        src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts \
        src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts \
        src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts \
        src/modules/trading/swap-transactions/swap-workflow.service.ts \
        src/modules/trading/swap-transactions/swap-workflow.service.spec.ts \
        src/modules/trading/swap-transactions/swap-transactions.module.ts \
        src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "feat(trading): 客户级限制冻结三域在途单，兑换域补齐 PROCESSING 中的能力闸

- 三域统一改读 CustomerAccess.blocked，删掉两处读已删列的 ABNORMAL_COMPLIANCE 字符串集合
- 兑换此前只在建单前查一次，PROCESSING 中 4 腿照常推完，本次补 assertSwapCustomerAccessOrHalt
- scope < ALL 的便签不触碰在途单（设计稿 §3.5），有反向断言守住"
```

---

### Task 10: 两个审批类型 + 两个 handler + release workflow + RBAC 登记

**Files:**

- Create: `src/modules/identity/customers/customer-restriction-release-mlro-approval.service.ts`
- Create: `src/modules/identity/customers/customer-restriction-release-ops-approval.service.ts`
- Modify: `src/modules/identity/customers/customer-restriction-workflow.service.ts` —— **该文件已由 Task 4 Step 13 创建**（含自动侧 `openRestriction` / `autoRelease`）。本任务只往同一个类上**追加审批侧** `initiateRelease()` / `onReleaseDecided()`，**不要重建文件、不要动已有两个方法**。
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts:82-83`（`ApprovalActionTypes` 末尾，`WITHDRAW_SANCTION_REFUND` 之后、`} as const;` 之前）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts:403-408`（`DEFAULT_APPROVAL_POLICIES` 末尾，`WITHDRAW_SANCTION_REFUND` 条目之后、`};` 之前）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts:171-172`（`AuditBusinessWorkflowTypes` 末尾，`CUSTOMER_TAG` 之后）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:22-23`（`PermissionGroup` 联合类型，`'CUSTOMER_TAG_MANAGE'` 之后）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:233-234`（Customer tags 路由块之后）
- Modify: `src/modules/identity/customers/customers.module.ts:1-19`（整文件重写：加 `ApprovalsModule` import、三个 provider、一个 export）
- Test: `src/modules/identity/customers/customer-restriction-workflow.service.spec.ts`

**Interfaces:**

Consumes（前置 Task 产出，本 Task 只调用不改）：
- `CustomerRestrictionsService.findByNo(restrictionNo: string): Promise<RestrictionRow | null>`
- `CustomerRestrictionsService.findOpenByCause(customerId: string, cause: RestrictionCause, caseRef: string | null): Promise<RestrictionRow | null>`
- `CustomerRestrictionsService.open(input: OpenRestrictionInput): Promise<{ restrictionNo: string; created: boolean }>`
- `CustomerRestrictionsService.release(restrictionNo: string, opts: { releasedBy: string; releaseMode: 'AUTO'|'MANUAL'; releaseApprovalNo?: string; releaseOrderRef?: string }): Promise<void>`
- `interface RestrictionRow` / `interface OpenRestrictionInput`（`./customer-restrictions.service`）
- `type RestrictionCause` / `type RestrictionReleasePolicy`（`./constants/restriction-cause.constant`）
- `ApprovalsService.createAndSubmit(createDto: CreateApprovalDto, submitDto: SubmitApprovalDto, actor: ApprovalActorContext)`（`src/modules/governance/approvals/approvals.service.ts:544`）
- `ApprovalsService.list(query: ApprovalQueryDto): Promise<{ total; skip; take; items }>`（同上 `:873`；`items[].objectSnapshot` 已 `JSON.parse`，见 `:311` + `:350` 的展开）
- `AuditLogsService.recordByActor(input: CreateAuditLogEventDto, actor: AuditActorContext)`（`src/modules/audit-logging/audit-logs.service.ts:1224`；`entityNo`/`entityOwnerNo` 由 `resolveEntityNo`/`resolveEntityOwnerNo` 对 `CUSTOMER` 自动回填，见 `:288` / `:254`，故本服务无需注入 Prisma）
- `abstract class ApprovalHandlerBase`（`src/modules/governance/approvals/approval-handler.base.ts:24`；子类只提供 `actionType` + `workflowType`，二级事件名由 `workflowType` 小写连字符化得出）
- `interface ApprovalDecidedEvent`（同上 `:8`；`metadata` 恒为 `{}`，见 `:52`）

Produces：
- `ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO = 'CUSTOMER_RESTRICTION_RELEASE_MLRO'`
- `ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS = 'CUSTOMER_RESTRICTION_RELEASE_OPS'`
- `AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE = 'CUSTOMER_RESTRICTION_RELEASE'`
- `class CustomerRestrictionReleaseMlroApprovalService extends ApprovalHandlerBase`
- `class CustomerRestrictionReleaseOpsApprovalService extends ApprovalHandlerBase`
- `class CustomerRestrictionWorkflowService`
  - `openRestriction(input: OpenRestrictionInput, actor: ApprovalActorContext): Promise<{ restrictionNo: string; created: boolean }>`
  - `initiateRelease(restrictionNo: string, dto: { reason: string; releaseOrderRef?: string }, actor: ApprovalActorContext): Promise<{ approvalNo: string }>`
  - `onReleaseDecided(event: ApprovalDecidedEvent): Promise<void>` — `@OnEvent('workflow.customer-restriction-release.decided')`
  - `autoRelease(customerId: string, cause: RestrictionCause, caseRef: string | null, actorId: string): Promise<void>`
- PermissionGroup：`'CUSTOMER_RESTRICTION_READ' | 'CUSTOMER_RESTRICTION_WRITE' | 'CUSTOMER_RESTRICTION_RELEASE'` + 三条 `route()` 登记

---

- [ ] **Step 1: 写失败的单测文件（全部 8 个用例，一次写完）**

新建 `src/modules/identity/customers/customer-restriction-workflow.service.spec.ts`：

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { AuditActions, AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  DEFAULT_APPROVAL_POLICIES,
} from '../../governance/approvals/constants/approval.constants';
import { CustomerRestrictionReleaseMlroApprovalService } from './customer-restriction-release-mlro-approval.service';
import { CustomerRestrictionReleaseOpsApprovalService } from './customer-restriction-release-ops-approval.service';
import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
import { RestrictionRow } from './customer-restrictions.service';

const ACTOR: ApprovalActorContext = {
  actorType: 'ADMIN',
  userId: 'admin-1',
  userNo: 'ADM0001',
  role: 'OPS_OFFICER',
  roleCodes: ['OPS_OFFICER'],
};

const RST_NO = 'RST2608150001';

function sanctionRow(overrides: Partial<RestrictionRow> = {}): RestrictionRow {
  return {
    restrictionNo: RST_NO,
    customerId: 'cust-1',
    scopes: ['ALL'],
    cause: 'SANCTION',
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    status: 'OPEN',
    reason: 'OFAC SDN hit',
    caseRef: 'CRA-1',
    releaseOrderRef: null,
    openedAt: new Date('2026-08-15T00:00:00.000Z'),
    openedBy: 'admin-1',
    releasedAt: null,
    releasedBy: null,
    releaseApprovalNo: null,
    releaseMode: null,
    traceId: 'trace-rst-1',
    ...overrides,
  };
}

describe('CustomerRestrictionWorkflowService — release approval arc', () => {
  let workflow: CustomerRestrictionWorkflowService;
  let restrictions: any;
  let approvalsService: any;
  let auditLogsService: any;

  beforeEach(() => {
    restrictions = {
      open: jest.fn(),
      release: jest.fn().mockResolvedValue(undefined),
      findByNo: jest.fn().mockResolvedValue(sanctionRow()),
      findOpenByCause: jest.fn(),
    };
    approvalsService = {
      list: jest.fn().mockResolvedValue({ total: 0, skip: 0, take: 1, items: [] }),
      createAndSubmit: jest.fn().mockResolvedValue({ approvalNo: 'AP-RST-1' }),
    };
    auditLogsService = { recordByActor: jest.fn().mockResolvedValue({}) };

    workflow = new CustomerRestrictionWorkflowService(
      restrictions as any,
      approvalsService as any,
      auditLogsService as any,
    );
  });

  it('rejects an MLRO-policy release submitted without releaseOrderRef', async () => {
    await expect(
      workflow.initiateRelease(RST_NO, { reason: 'delisted by regulator' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it('opens an OPS release case without requiring releaseOrderRef', async () => {
    restrictions.findByNo.mockResolvedValue(
      sanctionRow({
        cause: 'MATERIAL_EXPIRED',
        visibility: 'DISCLOSED',
        releasePolicy: 'OPS_APPROVAL',
        scopes: ['WITHDRAW', 'SWAP'],
      }),
    );

    const result = await workflow.initiateRelease(RST_NO, { reason: 'fresh passport received' }, ACTOR);

    expect(result).toEqual({ approvalNo: 'AP-RST-1' });
    expect(approvalsService.createAndSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS,
        entityRef: RST_NO,
        objectSnapshot: {
          restrictionNo: RST_NO,
          cause: 'MATERIAL_EXPIRED',
          reason: 'fresh passport received',
          releaseOrderRef: null,
        },
      }),
      expect.objectContaining({ reason: 'fresh passport received' }),
      ACTOR,
    );
  });

  it('rejects a second release while one approval is still PENDING', async () => {
    approvalsService.list.mockResolvedValue({
      total: 1,
      skip: 0,
      take: 1,
      items: [{ approvalNo: 'AP-RST-0' }],
    });

    await expect(
      workflow.initiateRelease(RST_NO, { reason: 'delisted', releaseOrderRef: 'GOV-2026-77' }, ACTOR),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(approvalsService.createAndSubmit).not.toHaveBeenCalled();
  });

  it.each(['DECLINED', 'CANCELLED', 'EXPIRED'] as const)(
    'leaves the restriction OPEN when the release approval is %s',
    async (decision) => {
      await workflow.onReleaseDecided({
        decision,
        actionType: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO,
        entityRef: RST_NO,
        approvalId: 'ap-1',
        approvalNo: 'AP-RST-1',
        traceId: 'trace-rst-1',
        workflowType: AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE,
        metadata: {},
      });

      expect(restrictions.release).not.toHaveBeenCalled();
      expect(auditLogsService.recordByActor).not.toHaveBeenCalled();
    },
  );

  it('releases the restriction with releaseMode MANUAL when APPROVED', async () => {
    approvalsService.list.mockResolvedValue({
      total: 1,
      skip: 0,
      take: 1,
      items: [
        {
          approvalNo: 'AP-RST-1',
          objectSnapshot: {
            restrictionNo: RST_NO,
            cause: 'SANCTION',
            reason: 'delisted by regulator',
            releaseOrderRef: 'GOV-2026-77',
          },
        },
      ],
    });

    await workflow.onReleaseDecided({
      decision: 'APPROVED',
      actionType: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO,
      entityRef: RST_NO,
      approvalId: 'ap-1',
      approvalNo: 'AP-RST-1',
      traceId: 'trace-rst-1',
      workflowType: AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE,
      decisionByUserId: 'mlro-1',
      decisionByUserNo: 'ADM0009',
      decisionByRole: 'MLRO',
      metadata: {},
    });

    expect(restrictions.release).toHaveBeenCalledWith(RST_NO, {
      releasedBy: 'mlro-1',
      releaseMode: 'MANUAL',
      releaseApprovalNo: 'AP-RST-1',
      releaseOrderRef: 'GOV-2026-77',
    });
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditActions.CUSTOMER_RESTRICTION_CLEARED,
        metadata: expect.objectContaining({
          restrictionNo: RST_NO,
          cause: 'SANCTION',
          scopes: ['ALL'],
          visibility: 'SILENT',
          releaseMode: 'MANUAL',
          approvalNo: 'AP-RST-1',
          releaseOrderRef: 'GOV-2026-77',
        }),
      }),
      expect.objectContaining({ actorId: 'mlro-1', actorRole: 'MLRO' }),
    );
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: AuditActions.CUSTOMER_UNFROZEN }),
      expect.anything(),
    );
  });

  it('throws before mutating when an approved MLRO case carries no releaseOrderRef', async () => {
    approvalsService.list.mockResolvedValue({
      total: 1,
      skip: 0,
      take: 1,
      items: [{ approvalNo: 'AP-RST-1', objectSnapshot: { restrictionNo: RST_NO, releaseOrderRef: null } }],
    });

    await expect(
      workflow.onReleaseDecided({
        decision: 'APPROVED',
        actionType: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO,
        entityRef: RST_NO,
        approvalId: 'ap-1',
        approvalNo: 'AP-RST-1',
        traceId: 'trace-rst-1',
        workflowType: AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE,
        metadata: {},
      }),
    ).rejects.toThrow(/releaseOrderRef/);
    expect(restrictions.release).not.toHaveBeenCalled();
  });
});

describe('CustomerRestrictionWorkflowService — approval wiring constants', () => {
  it('routes MLRO releases to MLRO and OPS releases to OPS_OFFICER, 48h, cancellable', () => {
    expect(DEFAULT_APPROVAL_POLICIES[ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO]).toEqual({
      steps: [{ stepNo: 1, roles: ['MLRO'] }],
      timeoutHours: 48,
      allowCancel: true,
    });
    expect(DEFAULT_APPROVAL_POLICIES[ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS]).toEqual({
      steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
      timeoutHours: 48,
      allowCancel: true,
    });
  });

  it('gives both handlers the same workflowType so they emit one decided event', () => {
    const emitter = { emitAsync: jest.fn(), emit: jest.fn() } as any;
    const mlro = new CustomerRestrictionReleaseMlroApprovalService(emitter);
    const ops = new CustomerRestrictionReleaseOpsApprovalService(emitter);

    expect(mlro.actionType).toBe(ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO);
    expect(ops.actionType).toBe(ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS);
    expect(mlro.workflowType).toBe(AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE);
    expect(ops.workflowType).toBe(mlro.workflowType);
  });
});
```

- [ ] **Step 2: 跑测试，确认红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/customers/customer-restriction-workflow.service.spec.ts
```

期望：套件无法加载，`Test suite failed to run` + `Cannot find module './customer-restriction-release-mlro-approval.service' from 'src/modules/identity/customers/customer-restriction-workflow.service.spec.ts'`，`Tests: 0 total`。

- [ ] **Step 3: `approval.constants.ts` 加两个 actionType**

在 `src/modules/governance/approvals/constants/approval.constants.ts:82`（`WITHDRAW_SANCTION_REFUND: 'WITHDRAW_SANCTION_REFUND',`）之后、`:83` 的 `} as const;` 之前插入：

```ts
  // Customer Restriction Release (2026-08-15) — 贴不审批撕才审批：解除限制按 cause 的
  // releasePolicy 分流到 MLRO / OPS 两条单步 maker-checker，复刻 WITHDRAW_UNFREEZE 形状。
  CUSTOMER_RESTRICTION_RELEASE_MLRO: 'CUSTOMER_RESTRICTION_RELEASE_MLRO',
  CUSTOMER_RESTRICTION_RELEASE_OPS: 'CUSTOMER_RESTRICTION_RELEASE_OPS',
```

- [ ] **Step 4: `approval.constants.ts` 加两条 DEFAULT_APPROVAL_POLICIES**

在同文件 `:407`（`WITHDRAW_SANCTION_REFUND` 条目收尾的 `},`）之后、`:408` 的 `};` 之前插入：

```ts
  // ─── Customer Restriction Release (2026-08-15) ────
  [ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO]: {
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
  [ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS]: {
    steps: [{ stepNo: 1, roles: ['OPS_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
  },
```

- [ ] **Step 5: `audit-actions.constant.ts` 加 workflowType**

在 `src/modules/audit-logging/constants/audit-actions.constant.ts:171`（`CUSTOMER_TAG: 'CUSTOMER_TAG',`，注意是 `AuditBusinessWorkflowTypes` 里的那一处、不是 `:95`）之后、`:172` 的 `} as const;` 之前插入：

```ts
  // Customer Restriction Release (2026-08-15) — 贴/撕便签的审计都归这条 workflow
  CUSTOMER_RESTRICTION_RELEASE: 'CUSTOMER_RESTRICTION_RELEASE',
```

- [ ] **Step 6: 建两个 handler 文件（逐字复刻 `withdraw-unfreeze-approval.service.ts` 模板）**

`src/modules/identity/customers/customer-restriction-release-mlro-approval.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class CustomerRestrictionReleaseMlroApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO;
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

`src/modules/identity/customers/customer-restriction-release-ops-approval.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditBusinessWorkflowTypes } from '../../audit-logging/constants/audit-actions.constant';
import { ApprovalHandlerBase } from '../../governance/approvals/approval-handler.base';
import { ApprovalActionTypes } from '../../governance/approvals/constants/approval.constants';

@Injectable()
export class CustomerRestrictionReleaseOpsApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS;
  // 与 MLRO handler 共用同一 workflowType：两条审批路线汇入同一个二级事件
  // workflow.customer-restriction-release.decided（见 ApprovalHandlerBase.buildSecondaryEventName）。
  readonly workflowType = AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

- [ ] **Step 7: 建 `customer-restriction-workflow.service.ts`**

新建 `src/modules/identity/customers/customer-restriction-workflow.service.ts`：

```ts
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { randomUUID } from 'crypto';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditBusinessWorkflowTypes,
  AuditEntityTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditActorContext, AuditResult } from '../../audit-logging/dto/audit-log.dto';
import {
  ApprovalDecidedEvent,
} from '../../governance/approvals/approval-handler.base';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalStatuses,
} from '../../governance/approvals/constants/approval.constants';
import {
  RestrictionCause,
  RestrictionReleasePolicy,
} from './constants/restriction-cause.constant';
import {
  CustomerRestrictionsService,
  OpenRestrictionInput,
  RestrictionRow,
} from './customer-restrictions.service';

/** releasePolicy → 审批 actionType。两条线共用一个 workflowType，故只有一个 decided 事件。 */
const RELEASE_ACTION_TYPE: Record<RestrictionReleasePolicy, string> = {
  MLRO_APPROVAL: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO,
  OPS_APPROVAL: ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS,
};

/**
 * 限制便签的编排层：贴（立即生效，不开审批）/ 发起人工撕（开审批案，不写便签表）/
 * 审批落地撕 / 机制自动撕。审计全部在本层写；便签表的写入一律经
 * CustomerRestrictionsService（Rule 5：workflow 不直写 domain 表）。
 *
 * 不对称范式（设计稿 §3.3 R4）：摁住是低风险可回退动作，放行才是高风险动作 ——
 * 与 DEPOSIT_UNFREEZE / WITHDRAW_UNFREEZE 一致。
 */
@Injectable()
export class CustomerRestrictionWorkflowService {
  private readonly logger = new Logger(CustomerRestrictionWorkflowService.name);

  constructor(
    private readonly restrictions: CustomerRestrictionsService,
    private readonly approvalsService: ApprovalsService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  /**
   * 贴便签：立即生效，不开审批。幂等命中（created=false）时不重复落库，但仍写一条
   * CUSTOMER_RESTRICTION_ADDED 说明"重复请求已忽略"，保证运营动作在审计上可追。
   */
  async openRestriction(
    input: OpenRestrictionInput,
    actor: ApprovalActorContext,
  ): Promise<{ restrictionNo: string; created: boolean }> {
    const { restrictionNo, created } = await this.restrictions.open(input);

    const row = await this.restrictions.findByNo(restrictionNo);
    if (!row) {
      throw new NotFoundException(`Restriction not found right after open: ${restrictionNo}`);
    }

    const auditActor = this.toAuditActor(actor);
    await this.audit(
      AuditActions.CUSTOMER_RESTRICTION_ADDED,
      row,
      auditActor,
      created
        ? `${row.cause} restriction opened: ${row.reason}`
        : `${row.cause} restriction already open — duplicate request ignored: ${row.reason}`,
      { releaseMode: null, approvalNo: null, releaseOrderRef: null },
    );

    // 制裁便签额外写 CUSTOMER_FROZEN：客户级冻结在审计上单独可检索。
    if (created && row.cause === 'SANCTION') {
      await this.audit(
        AuditActions.CUSTOMER_FROZEN,
        row,
        auditActor,
        `Customer frozen by sanction restriction ${row.restrictionNo}`,
        { releaseMode: null, approvalNo: null, releaseOrderRef: null },
      );
    }

    return { restrictionNo, created };
  }

  /**
   * 发起人工撕：只读校验 + 防重复开案 + 开审批案，不碰便签表（便签保持 OPEN，
   * 直到 onReleaseDecided 收到 APPROVED）。审批提交本身由 ApprovalsService
   * 写 APPROVAL_SUBMITTED 审计，故此处不再另写一条。
   */
  async initiateRelease(
    restrictionNo: string,
    dto: { reason: string; releaseOrderRef?: string },
    actor: ApprovalActorContext,
  ): Promise<{ approvalNo: string }> {
    if (!dto.reason?.trim()) {
      throw new BadRequestException('Release reason is required');
    }

    const row = await this.restrictions.findByNo(restrictionNo);
    if (!row) {
      throw new NotFoundException(`Restriction not found: ${restrictionNo}`);
    }
    if (row.status !== 'OPEN') {
      throw new BadRequestException(
        `Restriction ${restrictionNo} is already RELEASED, cannot open a release approval`,
      );
    }
    // MLRO 类（SANCTION / KYT_REJECTED_HARD）必须有政府解除令文书号才允许发起。
    if (row.releasePolicy === 'MLRO_APPROVAL' && !dto.releaseOrderRef?.trim()) {
      throw new BadRequestException(
        `Restriction ${restrictionNo} requires a government release order reference (releaseOrderRef)`,
      );
    }

    const actionType = RELEASE_ACTION_TYPE[row.releasePolicy];

    // 防重复开案：一张便签不得同时挂两个待决解除案。
    const openCases = await this.approvalsService.list({
      actionType,
      entityRef: restrictionNo,
      status: ApprovalStatuses.PENDING,
      take: 1,
    });
    if (openCases.total > 0) {
      throw new ConflictException(
        `Restriction ${restrictionNo} already has a pending release approval; resolve it before submitting another.`,
      );
    }

    const traceId = row.traceId || randomUUID();
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType,
        entityRef: restrictionNo,
        traceId,
        objectSnapshot: {
          restrictionNo,
          cause: row.cause,
          reason: dto.reason,
          releaseOrderRef: dto.releaseOrderRef?.trim() || null,
        },
      },
      { reason: dto.reason, traceId },
      actor,
    );

    return { approvalNo: approvalCase.approvalNo };
  }

  /**
   * 解除案决议落地。非 APPROVED 一律只记日志、便签原样保持 OPEN。
   * APPROVED 时先把 releaseOrderRef 从 objectSnapshot 反查回来（守卫先于变更），
   * 再撕便签、写审计。
   */
  @OnEvent('workflow.customer-restriction-release.decided', { async: true })
  async onReleaseDecided(event: ApprovalDecidedEvent): Promise<void> {
    if (event.decision !== 'APPROVED') {
      this.logger.log(
        `Restriction ${event.entityRef} release ${event.decision} (case ${event.approvalNo}) — restriction stays OPEN, nothing released.`,
      );
      return;
    }

    const row = await this.restrictions.findByNo(event.entityRef);
    if (!row) {
      throw new Error(
        `Restriction ${event.entityRef}: approved release case has no matching restriction`,
      );
    }
    if (row.status !== 'OPEN') {
      this.logger.warn(
        `Restriction ${event.entityRef} already RELEASED (case ${event.approvalNo}) — skipping duplicate release.`,
      );
      return;
    }

    const releaseOrderRef = await this.fetchApprovedReleaseOrderRef(event.actionType, event.entityRef);
    if (row.releasePolicy === 'MLRO_APPROVAL' && !releaseOrderRef) {
      throw new Error(
        `Restriction ${event.entityRef}: MLRO release approved with no releaseOrderRef in objectSnapshot`,
      );
    }

    const releasedBy = event.decisionByUserId || 'SYSTEM';
    await this.restrictions.release(event.entityRef, {
      releasedBy,
      releaseMode: 'MANUAL',
      releaseApprovalNo: event.approvalNo,
      ...(releaseOrderRef ? { releaseOrderRef } : {}),
    });

    await this.auditRelease(
      row,
      {
        actorType: 'ADMIN',
        actorId: releasedBy,
        actorNo: event.decisionByUserNo || undefined,
        actorRole: event.decisionByRole || 'MLRO',
      },
      'MANUAL',
      event.approvalNo,
      releaseOrderRef,
    );
  }

  /**
   * 自动撕：由 cause 自身机制触发（材料到齐、Sumsub 转 GREEN、升级审批通过等），
   * 不走审批、releaseMode=AUTO。没有对应 OPEN 便签时静默 no-op —— 机制可能被
   * 重复触发，不该因此报错。
   */
  async autoRelease(
    customerId: string,
    cause: RestrictionCause,
    caseRef: string | null,
    actorId: string,
  ): Promise<void> {
    const row = await this.restrictions.findOpenByCause(customerId, cause, caseRef);
    if (!row) {
      this.logger.log(
        `Auto-release skip: customer ${customerId} has no OPEN ${cause} restriction for caseRef ${caseRef ?? '—'}`,
      );
      return;
    }

    await this.restrictions.release(row.restrictionNo, {
      releasedBy: actorId,
      releaseMode: 'AUTO',
    });

    await this.auditRelease(
      row,
      { actorType: 'SYSTEM', actorId, actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
      'AUTO',
      null,
      null,
    );
  }

  /**
   * ApprovalDecidedEvent.metadata 恒为 {}（见 approval-handler.base.ts 的
   * emitDecidedEvent），releaseOrderRef 只能按 actionType + entityRef + APPROVED
   * 反查 objectSnapshot 取回 —— 复刻 WithdrawWorkflowService.fetchApprovedOrderRef。
   * 快照本身取不到即数据损坏，直接抛；此调用在任何变更之前，抛出时便签仍是 OPEN。
   * OPS 类允许 releaseOrderRef 缺省（返回 null），MLRO 类的必填由调用方复核。
   */
  private async fetchApprovedReleaseOrderRef(
    actionType: string,
    restrictionNo: string,
  ): Promise<string | null> {
    const { items } = await this.approvalsService.list({
      actionType,
      entityRef: restrictionNo,
      status: ApprovalStatuses.APPROVED,
      take: 1,
    });
    const snapshot = items[0]?.objectSnapshot as { releaseOrderRef?: string | null } | null | undefined;
    if (!snapshot) {
      throw new Error(
        `Restriction ${restrictionNo}: no APPROVED ${actionType} case with an objectSnapshot found`,
      );
    }
    return snapshot.releaseOrderRef?.trim() || null;
  }

  private async auditRelease(
    row: RestrictionRow,
    actor: AuditActorContext,
    releaseMode: 'AUTO' | 'MANUAL',
    approvalNo: string | null,
    releaseOrderRef: string | null,
  ): Promise<void> {
    await this.audit(
      AuditActions.CUSTOMER_RESTRICTION_CLEARED,
      row,
      actor,
      `${row.cause} restriction ${row.restrictionNo} released (${releaseMode})`,
      { releaseMode, approvalNo, releaseOrderRef },
    );

    if (row.cause === 'SANCTION') {
      await this.audit(
        AuditActions.CUSTOMER_UNFROZEN,
        row,
        actor,
        `Customer unfrozen — sanction restriction ${row.restrictionNo} released (${releaseMode})`,
        { releaseMode, approvalNo, releaseOrderRef },
      );
    }
  }

  private async audit(
    action: string,
    row: RestrictionRow,
    actor: AuditActorContext,
    reason: string,
    extra: {
      releaseMode: 'AUTO' | 'MANUAL' | null;
      approvalNo: string | null;
      releaseOrderRef: string | null;
    },
  ): Promise<void> {
    // entityNo / entityOwnerNo（customerNo）由 AuditLogsService 自行解析，
    // 见 resolveEntityNo 的 CUSTOMER 映射 —— 本服务因此无需注入 Prisma。
    await this.auditLogsService.recordByActor(
      {
        action,
        entityType: AuditEntityTypes.CUSTOMER,
        entityId: row.customerId,
        entityOwnerType: 'CUSTOMER',
        entityOwnerId: row.customerId,
        traceId: row.traceId,
        workflowType: AuditBusinessWorkflowTypes.CUSTOMER_RESTRICTION_RELEASE,
        result: AuditResult.SUCCESS,
        reason,
        metadata: {
          restrictionNo: row.restrictionNo,
          cause: row.cause,
          scopes: row.scopes,
          visibility: row.visibility,
          releaseMode: extra.releaseMode,
          approvalNo: extra.approvalNo,
          releaseOrderRef: extra.releaseOrderRef,
        },
        sourcePlatform: actor.actorType === 'SYSTEM' ? 'SYSTEM' : 'ADMIN_API',
      },
      actor,
    );
  }
}
```

- [ ] **Step 8: 跑测试，确认绿**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx jest src/modules/identity/customers/customer-restriction-workflow.service.spec.ts
```

期望：`Tests: 8 passed, 8 total`（含 `it.each` 展开的 3 条 DECLINED/CANCELLED/EXPIRED）。

- [ ] **Step 9: 把三个 provider 挂进 `CustomersModule`**

`src/modules/identity/customers/customers.module.ts` 整文件替换为：

```ts
import { Module, forwardRef } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomerRestrictionsService } from './customer-restrictions.service';
import { CustomerPendingActionService } from './customer-pending-action.service';
import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
import { CustomerRestrictionReleaseMlroApprovalService } from './customer-restriction-release-mlro-approval.service';
import { CustomerRestrictionReleaseOpsApprovalService } from './customer-restriction-release-ops-approval.service';
import { CustomersController } from './customers.controller';
import { CustomerPendingActionController } from './customer-pending-action.controller';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { NotificationsModule } from '../../../core/notifications/notifications.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';

@Module({
  // OnboardingModule：仅为 SumsubClient（客户级补料会话铸 token）。
  // Onboarding 不反向依赖 Customers，无环（2026-08-14 核）。
  // ApprovalsModule：限制解除的 maker-checker 审批案。ApprovalsModule 只 import
  // PrismaModule，不反向依赖 Customers，无环（2026-08-15 核）。
  imports: [
    PrismaModule,
    NotificationsModule,
    forwardRef(() => OnboardingModule),
    ApprovalsModule,
  ],
  providers: [
    CustomersService,
    CustomerRestrictionsService,
    CustomerPendingActionService,
    CustomerRestrictionWorkflowService,
    CustomerRestrictionReleaseMlroApprovalService,
    CustomerRestrictionReleaseOpsApprovalService,
  ],
  controllers: [CustomersController, CustomerPendingActionController],
  exports: [
    CustomerRestrictionsService,
    CustomerPendingActionService,
    CustomerRestrictionWorkflowService,
  ],
})
export class CustomersModule {}
```

- [ ] **Step 10: `rbac.catalog.ts` 加三个权限组**

在 `src/modules/identity/access-control/rbac.catalog.ts:22`（`| 'CUSTOMER_TAG_MANAGE'`）之后插入：

```ts
  | 'CUSTOMER_RESTRICTION_READ'
  | 'CUSTOMER_RESTRICTION_WRITE'
  | 'CUSTOMER_RESTRICTION_RELEASE'
```

- [ ] **Step 11: `rbac.catalog.ts` 登记三条 route**

在同文件 `:233`（`route('DELETE', '/admin/customers/:customerNo/tags/:tagCode', ...)`）之后、`:235` 的 `// Pricing center` 之前插入：

```ts

  // Customer restrictions
  route('GET', '/admin/customers/:customerNo/restrictions', 'List customer restrictions', ['CUSTOMER_RESTRICTION_READ']),
  route('POST', '/admin/customers/:customerNo/restrictions', 'Open customer restriction', ['CUSTOMER_RESTRICTION_WRITE']),
  route(
    'POST',
    '/admin/customers/:customerNo/restrictions/:restrictionNo/release',
    'Request restriction release',
    ['CUSTOMER_RESTRICTION_RELEASE'],
  ),
```

- [ ] **Step 12: 硬闸门 tsc + 客户域全量单测**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
npx tsc --noEmit
npx jest src/modules/identity/customers
```

期望：`tsc` 无输出（0 错）；jest 全绿，无净新增失败。

- [ ] **Step 13: 权限落库 + 重启后端（Rule 9）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
bash scripts/on-stack.sh main db:base:sync
bash scripts/stack.sh up main
```

期望：seed 输出无报错；`bash scripts/stack.sh status` 显示 main 栈 3000-3003 全 up。三条 route 的实际 200/403 验证留到控制器 Task（此刻控制器尚未存在，catalog 登记先行，SUPER_ADMIN 走内存 `RBAC_PERMISSION_DEFINITIONS`，重启即生效）。

- [ ] **Step 14: commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
git add src/modules/governance/approvals/constants/approval.constants.ts \
        src/modules/audit-logging/constants/audit-actions.constant.ts \
        src/modules/identity/access-control/rbac.catalog.ts \
        src/modules/identity/customers/customer-restriction-release-mlro-approval.service.ts \
        src/modules/identity/customers/customer-restriction-release-ops-approval.service.ts \
        src/modules/identity/customers/customer-restriction-workflow.service.ts \
        src/modules/identity/customers/customer-restriction-workflow.service.spec.ts \
        src/modules/identity/customers/customers.module.ts
git commit -m "feat(customer-restrictions): 解除审批两类型+两 handler+release workflow+RBAC 登记

- ApprovalActionTypes 加 CUSTOMER_RESTRICTION_RELEASE_MLRO/OPS，DEFAULT_APPROVAL_POLICIES
  各一条单步 48h 可撤（复刻 WITHDRAW_UNFREEZE 形状）
- AuditBusinessWorkflowTypes 加 CUSTOMER_RESTRICTION_RELEASE，两 handler 共用之
  故只有一个二级事件 workflow.customer-restriction-release.decided
- CustomerRestrictionWorkflowService：贴不审批（openRestriction，SANCTION 额外写
  CUSTOMER_FROZEN）/ 撕才审批（initiateRelease 只开案不写便签表）/ APPROVED 落地
  （onReleaseDecided，releaseOrderRef 反查 objectSnapshot、取不到即抛，守卫先于变更）
  / 机制自动撕（autoRelease，releaseMode=AUTO）
- rbac.catalog 三个权限组 + 三条 route 登记"
```

---

### Task 11: admin / client 两个控制器与四个端点

把 Task 3 / 4 / 10 造好的 `RESTRICTION_CAUSE_POLICY` / `CustomerRestrictionsService` / `CustomerAccessService` / `CustomerRestrictionWorkflowService` 接到 HTTP 面：3 个 admin 端点 + 1 个客户端端点。本任务只做传输层（Rule 7：Controller 只做传输），审计与事务全在 workflow / domain service 里，控制器一行 `prisma.$transaction` 都不写。

**Files:**

- Create: `src/modules/identity/customers/dto/customer-restriction.dto.ts`
- Create: `src/modules/identity/customers/customer-restrictions.admin.controller.ts`
- Create: `src/modules/identity/customers/customer-restrictions.client.controller.ts`
- Test (create): `src/modules/identity/customers/customer-restrictions.admin.controller.spec.ts`
- Test (create): `src/modules/identity/customers/customer-restrictions.client.controller.spec.ts`
- Delete: `src/modules/identity/customers/dto/customer-access.dto.ts`（全 13 行；`FreezeCustomerDto` / `UnfreezeCustomerDto` 全仓零引用，已 grep 证实，删完 `dto/` 目录只剩新建的那个文件）
- Modify: `src/modules/identity/customers/customers.module.ts:1-19`（整文件 19 行：加 2 controller、2 provider、`ApprovalsModule` import、导出 `CustomerAccessService`）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:22`（`PermissionGroup` 联合类型，`'CUSTOMER_TAG_MANAGE'` 那行之后插 3 个组）与 `:233`（`route()` 清单，`DELETE /admin/customers/:customerNo/tags/:tagCode` 那行之后插 3 条）

**Interfaces:**

Consumes（由 Task 3 / 4 / 10 产出，签名逐字对齐锁定契约）：
```ts
// ./constants/restriction-cause.constant
RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy>
type RestrictionCause, RestrictionScope
// ./customer-restrictions.service
CustomerRestrictionsService.listAll(customerId: string): Promise<RestrictionRow[]>
CustomerRestrictionsService.findByNo(restrictionNo: string): Promise<RestrictionRow | null>
// ./customer-restriction-workflow.service
CustomerRestrictionWorkflowService.openRestriction(input: OpenRestrictionInput, actor: ApprovalActorContext): Promise<{ restrictionNo: string; created: boolean }>
CustomerRestrictionWorkflowService.initiateRelease(restrictionNo: string, dto: { reason: string; releaseOrderRef?: string }, actor: ApprovalActorContext): Promise<{ approvalNo: string }>
// ./customer-access.service
CustomerAccessService.resolve(customerId: string): Promise<CustomerAccess>
// 现有平台件
ApprovalActorContext                                  // src/modules/governance/approvals/constants/approval.constants.ts:114
buildPermissionCode(method: string, path: string)     // src/modules/identity/access-control/permission-code.util.ts
RequirePermissions(...codes: string[])                // src/modules/identity/access-control/require-permissions.decorator.ts
PrismaService.customerMain.findFirst                  // customerNo → id 解析（Rule 3：对外合同是 customerNo）
```

Produces：
```ts
export class OpenRestrictionDto { cause: RestrictionCause; scopes?: RestrictionScope[]; reason: string; caseRef?: string }
export class ReleaseRestrictionDto { reason: string; releaseOrderRef?: string }

export class CustomerRestrictionsAdminController {
  list(req, customerNo: string): Promise<RestrictionRow[]>                                    // GET  /admin/customers/:customerNo/restrictions
  open(req, customerNo: string, dto: OpenRestrictionDto): Promise<{ restrictionNo: string; created: boolean }>  // POST /admin/customers/:customerNo/restrictions
  release(req, customerNo: string, restrictionNo: string, dto: ReleaseRestrictionDto): Promise<{ approvalNo: string }>  // POST /admin/customers/:customerNo/restrictions/:restrictionNo/release
}
export class CustomerRestrictionsClientController {
  list(req): Promise<DisclosedRestrictionView[]>                                              // GET  /client/me/restrictions
}
```

**Steps:**

- [ ] **Step 1: 先写失败的 admin controller spec（5 个断言里的 4 个 admin 用例）**

  新建 `src/modules/identity/customers/customer-restrictions.admin.controller.spec.ts`，完整内容：

  ```ts
  import { Test, TestingModule } from '@nestjs/testing';
  import {
    BadRequestException,
    ForbiddenException,
    ValidationPipe,
  } from '@nestjs/common';
  import { CustomerRestrictionsAdminController } from './customer-restrictions.admin.controller';
  import { CustomerRestrictionsService } from './customer-restrictions.service';
  import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
  import { PrismaService } from '../../../core/prisma/prisma.service';
  import { OpenRestrictionDto } from './dto/customer-restriction.dto';

  const ADMIN_REQ = {
    user: { type: 'ADMIN', userId: 'admin-1', userNo: 'U0001', role: 'MLRO', roleCodes: ['MLRO'] },
  };
  const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'cust-1' } };

  describe('CustomerRestrictionsAdminController', () => {
    let controller: CustomerRestrictionsAdminController;
    let restrictions: { listAll: jest.Mock; findByNo: jest.Mock };
    let workflow: { openRestriction: jest.Mock; initiateRelease: jest.Mock };
    let prisma: { customerMain: { findFirst: jest.Mock } };

    beforeEach(async () => {
      restrictions = {
        listAll: jest.fn().mockResolvedValue([]),
        findByNo: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', customerId: 'cust-1' }),
      };
      workflow = {
        openRestriction: jest.fn().mockResolvedValue({ restrictionNo: 'RST-1', created: true }),
        initiateRelease: jest.fn().mockResolvedValue({ approvalNo: 'APR-1' }),
      };
      prisma = { customerMain: { findFirst: jest.fn().mockResolvedValue({ id: 'cust-1' }) } };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [CustomerRestrictionsAdminController],
        providers: [
          { provide: CustomerRestrictionsService, useValue: restrictions },
          { provide: CustomerRestrictionWorkflowService, useValue: workflow },
          { provide: PrismaService, useValue: prisma },
        ],
      }).compile();

      controller = module.get(CustomerRestrictionsAdminController);
    });

    afterEach(() => jest.clearAllMocks());

    // ── 防 fail-open 回归 ──────────────────────────────
    // AdminPermissionGuard 对非 ADMIN token 直接 return true
    // (admin-permission.guard.ts:61)，客户 JWT 打 admin 路由靠 guard 是拦不住的。
    // 三个 handler 各自 assertAdmin，且必须发生在任何 DB 读之前。
    describe('non-ADMIN token 打 admin 端点', () => {
      it('GET 列表 → 403，且不落任何 DB 查询', async () => {
        await expect(controller.list(CUSTOMER_REQ, 'C0001')).rejects.toThrow(ForbiddenException);
        expect(prisma.customerMain.findFirst).not.toHaveBeenCalled();
        expect(restrictions.listAll).not.toHaveBeenCalled();
      });

      it('POST 建限制 → 403，且不进 workflow', async () => {
        await expect(
          controller.open(CUSTOMER_REQ, 'C0001', {
            cause: 'ADMIN_SUSPENSION',
            reason: 'x',
          } as OpenRestrictionDto),
        ).rejects.toThrow(ForbiddenException);
        expect(workflow.openRestriction).not.toHaveBeenCalled();
      });

      it('POST 解除 → 403，且不开审批案', async () => {
        await expect(
          controller.release(CUSTOMER_REQ, 'C0001', 'RST-1', { reason: 'x' }),
        ).rejects.toThrow(ForbiddenException);
        expect(workflow.initiateRelease).not.toHaveBeenCalled();
      });
    });

    // ── 入参校验 ──────────────────────────────────────
    // 全局 ValidationPipe(main.ts:38) 只有 whitelist，多余键被静默剥掉而非 400；
    // 这两个 POST 单独挂 forbidNonWhitelisted 的管子，这里直接对管子断言。
    describe('body 校验（forbidNonWhitelisted 管子）', () => {
      const pipe = new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      });
      const meta = { type: 'body' as const, metatype: OpenRestrictionDto, data: '' };

      it('body 带 visibility → 400（策略表说了算，不许调用方指定）', async () => {
        await expect(
          pipe.transform(
            { cause: 'ADMIN_SUSPENSION', reason: 'x', visibility: 'DISCLOSED' },
            meta,
          ),
        ).rejects.toMatchObject({ status: 400 });
      });

      it('body 带 releasePolicy → 400', async () => {
        await expect(
          pipe.transform(
            { cause: 'ADMIN_SUSPENSION', reason: 'x', releasePolicy: 'OPS_APPROVAL' },
            meta,
          ),
        ).rejects.toMatchObject({ status: 400 });
      });

      it('干净 body 过管子', async () => {
        await expect(
          pipe.transform({ cause: 'PENDING_DOCUMENT', reason: 'x', scopes: ['WITHDRAW'] }, meta),
        ).resolves.toMatchObject({ cause: 'PENDING_DOCUMENT', scopes: ['WITHDRAW'] });
      });
    });

    describe('scopes 只在 scopeSelectable 的 cause 上接受', () => {
      it('cause=SANCTION 带 scopes → 400（scopeSelectable=false）', async () => {
        await expect(
          controller.open(ADMIN_REQ, 'C0001', {
            cause: 'SANCTION',
            scopes: ['WITHDRAW'],
            reason: 'OFAC hit',
          } as OpenRestrictionDto),
        ).rejects.toThrow(BadRequestException);
        expect(workflow.openRestriction).not.toHaveBeenCalled();
      });

      it('cause=PENDING_DOCUMENT 带 scopes → 放行，原样透传给 workflow', async () => {
        const result = await controller.open(ADMIN_REQ, 'C0001', {
          cause: 'PENDING_DOCUMENT',
          scopes: ['WITHDRAW'],
          reason: 'passport expired',
        } as OpenRestrictionDto);

        expect(result).toEqual({ restrictionNo: 'RST-1', created: true });
        expect(workflow.openRestriction).toHaveBeenCalledWith(
          {
            customerId: 'cust-1',
            cause: 'PENDING_DOCUMENT',
            scopes: ['WITHDRAW'],
            reason: 'passport expired',
            caseRef: null,
            openedBy: 'admin-1',
          },
          expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1', roleCodes: ['MLRO'] }),
        );
      });

      it('cause=SANCTION 不带 scopes → 放行，scopes 传 undefined 由策略表兜底', async () => {
        await controller.open(ADMIN_REQ, 'C0001', {
          cause: 'SANCTION',
          reason: 'OFAC hit',
        } as OpenRestrictionDto);

        expect(workflow.openRestriction).toHaveBeenCalledWith(
          expect.objectContaining({ cause: 'SANCTION', scopes: undefined }),
          expect.anything(),
        );
      });
    });

    describe('路径参数用业务键', () => {
      it('GET 用 customerNo 解析出 customerId 再查 domain service', async () => {
        await controller.list(ADMIN_REQ, 'C0001');
        expect(prisma.customerMain.findFirst).toHaveBeenCalledWith({
          where: { customerNo: 'C0001' },
          select: { id: true },
        });
        expect(restrictions.listAll).toHaveBeenCalledWith('cust-1');
      });

      it('release 拒绝张冠李戴的 restrictionNo（不属于该客户 → 404）', async () => {
        restrictions.findByNo.mockResolvedValue({ restrictionNo: 'RST-9', customerId: 'other' });
        await expect(
          controller.release(ADMIN_REQ, 'C0001', 'RST-9', { reason: 'cleared' }),
        ).rejects.toThrow(/not found/);
        expect(workflow.initiateRelease).not.toHaveBeenCalled();
      });

      it('release 校验通过 → 开审批案，返回 approvalNo', async () => {
        const result = await controller.release(ADMIN_REQ, 'C0001', 'RST-1', {
          reason: 'cleared',
          releaseOrderRef: 'MLRO-ORDER-7',
        });
        expect(result).toEqual({ approvalNo: 'APR-1' });
        expect(workflow.initiateRelease).toHaveBeenCalledWith(
          'RST-1',
          { reason: 'cleared', releaseOrderRef: 'MLRO-ORDER-7' },
          expect.objectContaining({ actorType: 'ADMIN', userId: 'admin-1' }),
        );
      });
    });
  });
  ```

- [ ] **Step 2: 跑它，确认 RED**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npx jest src/modules/identity/customers/customer-restrictions.admin.controller.spec.ts
  ```
  期望输出：套件整体失败，报
  `Cannot find module './customer-restrictions.admin.controller' from 'src/modules/identity/customers/customer-restrictions.admin.controller.spec.ts'`
  （DTO 与控制器都还不存在）。若报的是别的错（例如 `customer-restriction-workflow.service` 找不到），说明 Task 10 未落地，先回补 Task 10 再继续。

- [ ] **Step 3: 建 DTO 文件**

  新建 `src/modules/identity/customers/dto/customer-restriction.dto.ts`：

  ```ts
  import { ArrayNotEmpty, IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
  import {
    RESTRICTION_CAUSE_POLICY,
    RestrictionCause,
    RestrictionScope,
  } from '../constants/restriction-cause.constant';

  /** 合法 cause 直接从策略表取键，避免第二份枚举漂移 */
  const RESTRICTION_CAUSE_VALUES = Object.keys(RESTRICTION_CAUSE_POLICY) as RestrictionCause[];
  const RESTRICTION_SCOPE_VALUES: RestrictionScope[] = ['ALL', 'DEPOSIT', 'WITHDRAW', 'SWAP'];

  /**
   * 建限制入参。刻意**不含** visibility / releasePolicy —— 这两个由
   * RESTRICTION_CAUSE_POLICY[cause] 派生，调用方传了就是 400
   * （靠控制器上的 forbidNonWhitelisted 管子拦，不靠这里）。
   */
  export class OpenRestrictionDto {
    @IsIn(RESTRICTION_CAUSE_VALUES)
    cause!: RestrictionCause;

    /** 仅 scopeSelectable=true 的 cause（今天只有 PENDING_DOCUMENT）接受；其余传了即 400 */
    @IsOptional()
    @IsArray()
    @ArrayNotEmpty()
    @IsIn(RESTRICTION_SCOPE_VALUES, { each: true })
    scopes?: RestrictionScope[];

    @IsString()
    @MinLength(1)
    reason!: string;

    @IsOptional()
    @IsString()
    caseRef?: string;
  }

  export class ReleaseRestrictionDto {
    @IsString()
    @MinLength(1)
    reason!: string;

    /** releasePolicy=MLRO_APPROVAL 时必填，缺失 400 —— 该校验在 workflow.initiateRelease 里做 */
    @IsOptional()
    @IsString()
    releaseOrderRef?: string;
  }
  ```

- [ ] **Step 4: 建 admin 控制器**

  新建 `src/modules/identity/customers/customer-restrictions.admin.controller.ts`（形状逐字复刻同样挂 `/admin/customers/:customerNo/...` 的 `src/modules/identity/customer-tags/customer-tag.controller.ts`）：

  ```ts
  import {
    BadRequestException,
    Body,
    Controller,
    ForbiddenException,
    Get,
    NotFoundException,
    Param,
    Post,
    Req,
    UseGuards,
    UsePipes,
    ValidationPipe,
  } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
  import { AdminPermissionGuard } from '../access-control/admin-permission.guard';
  import { RequirePermissions } from '../access-control/require-permissions.decorator';
  import { buildPermissionCode } from '../access-control/permission-code.util';
  import { ApprovalActorContext } from '../../governance/approvals/constants/approval.constants';
  import { PrismaService } from '../../../core/prisma/prisma.service';
  import { CustomerRestrictionsService } from './customer-restrictions.service';
  import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
  import { RESTRICTION_CAUSE_POLICY } from './constants/restriction-cause.constant';
  import { OpenRestrictionDto, ReleaseRestrictionDto } from './dto/customer-restriction.dto';

  /**
   * 全局 ValidationPipe（main.ts:38）是 { transform, whitelist } —— 没有
   * forbidNonWhitelisted，多余键会被**静默剥掉**而不是报错。契约要求
   * visibility / releasePolicy 出现在 body 即 400（它们由 cause 派生，不许调用方指定），
   * 所以这两个 POST 单独挂一根更严的管子。
   */
  const RESTRICTION_BODY_PIPE = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  @ApiTags('Admin - Customer Restrictions')
  @ApiBearerAuth()
  @Controller('admin')
  @UseGuards(AuthGuard('jwt'), AdminPermissionGuard)
  export class CustomerRestrictionsAdminController {
    constructor(
      private readonly restrictions: CustomerRestrictionsService,
      private readonly workflow: CustomerRestrictionWorkflowService,
      private readonly prisma: PrismaService,
    ) {}

    /**
     * ⚠️ 不可删。AdminPermissionGuard 对非 ADMIN token 是 fail-open ——
     * admin-permission.guard.ts:61 `if (user.type !== 'ADMIN') return true`，
     * 客户 JWT 打 admin 路由会被原样放行。仓库里有过四条 admin 路由漏这一句的事故，
     * 每个 handler 第一行就得 assertAdmin，且必须早于任何 DB 读。
     */
    private assertAdmin(req: any) {
      if (req.user?.type !== 'ADMIN') {
        throw new ForbiddenException('Admin only');
      }
    }

    private buildAdminActor(req: any): ApprovalActorContext {
      const user = req.user;
      return {
        actorType: 'ADMIN',
        userId: user.userId || user.sub,
        userNo: user.userNo,
        role: user.role,
        roleCodes: user.roleCodes || (user.role ? [user.role] : []),
      };
    }

    /** 对外合同是 customerNo（Rule 3），内部再换成 id 喂 domain service */
    private async resolveCustomerId(customerNo: string): Promise<string> {
      const customer = await this.prisma.customerMain.findFirst({
        where: { customerNo },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${customerNo} not found`);
      }
      return customer.id;
    }

    @Get('customers/:customerNo/restrictions')
    @ApiOperation({ summary: '列一个客户的全部限制（含 SILENT、含已 RELEASED）' })
    @RequirePermissions(buildPermissionCode('GET', '/admin/customers/:customerNo/restrictions'))
    async list(@Req() req: any, @Param('customerNo') customerNo: string) {
      this.assertAdmin(req);
      const customerId = await this.resolveCustomerId(customerNo);
      return this.restrictions.listAll(customerId);
    }

    @Post('customers/:customerNo/restrictions')
    @ApiOperation({ summary: '贴便签：开一条客户限制，立即生效（不开审批）' })
    @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/restrictions'))
    @UsePipes(RESTRICTION_BODY_PIPE)
    async open(
      @Req() req: any,
      @Param('customerNo') customerNo: string,
      @Body() dto: OpenRestrictionDto,
    ) {
      this.assertAdmin(req);

      if (dto.scopes !== undefined && !RESTRICTION_CAUSE_POLICY[dto.cause].scopeSelectable) {
        throw new BadRequestException({
          code: 'RESTRICTION_SCOPE_NOT_SELECTABLE',
          message: `Cause '${dto.cause}' has fixed scopes; 'scopes' must be omitted.`,
          details: {
            cause: dto.cause,
            defaultScopes: RESTRICTION_CAUSE_POLICY[dto.cause].defaultScopes,
          },
        });
      }

      const customerId = await this.resolveCustomerId(customerNo);
      const actor = this.buildAdminActor(req);
      return this.workflow.openRestriction(
        {
          customerId,
          cause: dto.cause,
          scopes: dto.scopes,
          reason: dto.reason,
          caseRef: dto.caseRef ?? null,
          openedBy: actor.userId,
        },
        actor,
      );
    }

    @Post('customers/:customerNo/restrictions/:restrictionNo/release')
    @ApiOperation({
      summary: '发起人工解除：按 cause 的 releasePolicy 开 MLRO / OPS 审批案（此处不撕便签）',
    })
    @RequirePermissions(
      buildPermissionCode('POST', '/admin/customers/:customerNo/restrictions/:restrictionNo/release'),
    )
    @UsePipes(RESTRICTION_BODY_PIPE)
    async release(
      @Req() req: any,
      @Param('customerNo') customerNo: string,
      @Param('restrictionNo') restrictionNo: string,
      @Body() dto: ReleaseRestrictionDto,
    ) {
      this.assertAdmin(req);
      const customerId = await this.resolveCustomerId(customerNo);

      // 路径里的两个业务键必须自洽：别人的 restrictionNo 挂到本客户号下即 404
      const row = await this.restrictions.findByNo(restrictionNo);
      if (!row || row.customerId !== customerId) {
        throw new NotFoundException(
          `Restriction ${restrictionNo} not found for customer ${customerNo}`,
        );
      }

      return this.workflow.initiateRelease(restrictionNo, dto, this.buildAdminActor(req));
    }
  }
  ```

- [ ] **Step 5: 跑 admin spec，确认 GREEN**

  ```bash
  npx jest src/modules/identity/customers/customer-restrictions.admin.controller.spec.ts
  ```
  期望：`Tests: 11 passed, 11 total`，套件 PASS。

- [ ] **Step 6: commit admin 侧**

  ```bash
  git add src/modules/identity/customers/dto/customer-restriction.dto.ts \
          src/modules/identity/customers/customer-restrictions.admin.controller.ts \
          src/modules/identity/customers/customer-restrictions.admin.controller.spec.ts
  git commit -m "feat(customers): admin 客户限制三端点（显式 assertAdmin 防 guard fail-open + scopeSelectable 入参门）"
  ```

- [ ] **Step 7: 写失败的 client controller spec**

  新建 `src/modules/identity/customers/customer-restrictions.client.controller.spec.ts`：

  ```ts
  import { Test, TestingModule } from '@nestjs/testing';
  import { ForbiddenException } from '@nestjs/common';
  import { CustomerRestrictionsClientController } from './customer-restrictions.client.controller';
  import { CustomerAccessService } from './customer-access.service';

  describe('CustomerRestrictionsClientController', () => {
    let controller: CustomerRestrictionsClientController;
    let access: { resolve: jest.Mock };

    beforeEach(async () => {
      access = { resolve: jest.fn() };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [CustomerRestrictionsClientController],
        providers: [{ provide: CustomerAccessService, useValue: access }],
      }).compile();

      controller = module.get(CustomerRestrictionsClientController);
    });

    afterEach(() => jest.clearAllMocks());

    it('被制裁客户（SILENT，全能力被封）拿到的是空数组 —— 零痕迹', async () => {
      access.resolve.mockResolvedValue({
        lifecycle: 'ACTIVE',
        blocked: new Set(['DEPOSIT', 'WITHDRAW', 'SWAP']),
        disclosedBlocked: new Set(),
        disclosed: [],
        openCount: 1,
      });

      const result = await controller.list({ user: { type: 'CUSTOMER', userId: 'cust-1' } });

      expect(access.resolve).toHaveBeenCalledWith('cust-1');
      expect(result).toEqual([]);
    });

    it('没有任何限制的正常客户，响应与被制裁客户逐字节相等', async () => {
      access.resolve.mockResolvedValue({
        lifecycle: 'ACTIVE',
        blocked: new Set(),
        disclosedBlocked: new Set(),
        disclosed: [],
        openCount: 0,
      });

      const clean = await controller.list({ user: { type: 'CUSTOMER', userId: 'cust-2' } });

      expect(JSON.stringify(clean)).toBe(JSON.stringify([]));
    });

    it('DISCLOSED 限制原样返回，且响应体不含 blocked / openCount', async () => {
      access.resolve.mockResolvedValue({
        lifecycle: 'ACTIVE',
        blocked: new Set(['WITHDRAW', 'SWAP']),
        disclosedBlocked: new Set(['WITHDRAW', 'SWAP']),
        disclosed: [
          {
            restrictionNo: 'RST-1',
            cause: 'MATERIAL_EXPIRED',
            scopes: ['WITHDRAW', 'SWAP'],
            label: 'Document expired',
            reason: 'Passport expired 2026-01-01',
            openedAt: '2026-08-15T00:00:00.000Z',
          },
        ],
      });

      const result = await controller.list({ user: { type: 'CUSTOMER', userId: 'cust-3' } });

      expect(result).toHaveLength(1);
      expect(result[0].restrictionNo).toBe('RST-1');
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('blocked');
      expect(serialized).not.toContain('openCount');
    });

    it('admin token 打客户端点 → 403', async () => {
      await expect(
        controller.list({ user: { type: 'ADMIN', userId: 'admin-1' } }),
      ).rejects.toThrow(ForbiddenException);
      expect(access.resolve).not.toHaveBeenCalled();
    });
  });
  ```

  跑它确认 RED：
  ```bash
  npx jest src/modules/identity/customers/customer-restrictions.client.controller.spec.ts
  ```
  期望：`Cannot find module './customer-restrictions.client.controller'`。

- [ ] **Step 8: 建 client 控制器**

  新建 `src/modules/identity/customers/customer-restrictions.client.controller.ts`（复刻同前缀的 `customer-pending-action.controller.ts`：`client/me` + 只挂 `AuthGuard('jwt')`，不进 RBAC catalog）：

  ```ts
  import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
  import { AuthGuard } from '@nestjs/passport';
  import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
  import { CustomerAccessService, DisclosedRestrictionView } from './customer-access.service';

  /**
   * 客户端读面。与 customer-pending-action.controller.ts 同前缀同守卫：
   * 客户端端点走 JwtAuthGuard，不加 AdminPermissionGuard、不进 RBAC catalog。
   *
   * 只吐 CustomerAccess.disclosed 一个字段。blocked / openCount 含 SILENT 的贡献，
   * 泄露即等于告诉被制裁客户"你被盯上了"（tipping-off），永远不出这个口子 ——
   * 这不是靠前端记得别渲染，是数据根本不发出去。
   */
  @ApiTags('client/me')
  @ApiBearerAuth()
  @Controller('client/me')
  @UseGuards(AuthGuard('jwt'))
  export class CustomerRestrictionsClientController {
    constructor(private readonly access: CustomerAccessService) {}

    private extractCustomer(req: any): string {
      if (req.user?.type !== 'CUSTOMER') {
        throw new ForbiddenException('Customer token required');
      }
      return req.user.userId as string;
    }

    @Get('restrictions')
    @ApiOperation({ summary: '我的限制：仅 DISCLOSED，SILENT 一律不出现（含制裁客户恒空数组）' })
    async list(@Req() req: any): Promise<DisclosedRestrictionView[]> {
      const customerId = this.extractCustomer(req);
      const access = await this.access.resolve(customerId);
      return access.disclosed;
    }
  }
  ```

  跑它确认 GREEN：
  ```bash
  npx jest src/modules/identity/customers/customer-restrictions.client.controller.spec.ts
  ```
  期望：`Tests: 4 passed, 4 total`。

- [ ] **Step 9: 删已废弃的 customer-access.dto.ts**

  ```bash
  grep -rn "FreezeCustomerDto\|UnfreezeCustomerDto\|customer-access.dto" src/ admin-web/src client-web/src test/
  ```
  期望输出：只有 `src/modules/identity/customers/dto/customer-access.dto.ts` 自身那两行定义（零外部引用）。然后删：
  ```bash
  git rm src/modules/identity/customers/dto/customer-access.dto.ts
  ```

- [ ] **Step 10: commit client 侧 + 死 DTO 清理**

  ```bash
  git add src/modules/identity/customers/customer-restrictions.client.controller.ts \
          src/modules/identity/customers/customer-restrictions.client.controller.spec.ts \
          src/modules/identity/customers/dto/customer-access.dto.ts
  git commit -m "feat(customers): GET /client/me/restrictions 只吐 disclosed；删无 controller 的 Freeze/UnfreezeCustomerDto"
  ```

- [ ] **Step 11: customers.module.ts 注册两个控制器与两个 service**

  当前 19 行全文已读。对 `src/modules/identity/customers/customers.module.ts` 做三处 Edit：

  import 段（第 1-9 行之后）追加：
  ```ts
  import { CustomerAccessService } from './customer-access.service';
  import { CustomerRestrictionWorkflowService } from './customer-restriction-workflow.service';
  import { CustomerRestrictionsAdminController } from './customer-restrictions.admin.controller';
  import { CustomerRestrictionsClientController } from './customer-restrictions.client.controller';
  import { ApprovalsModule } from '../../governance/approvals/approvals.module';
  ```

  `imports` 数组（原 `[PrismaModule, NotificationsModule, forwardRef(() => OnboardingModule)]`）改为：
  ```ts
    // ApprovalsModule：CustomerRestrictionWorkflowService 开解除审批案要 ApprovalsService。
    // ApprovalsModule 只 import PrismaModule，不反向依赖 Customers，无环。
    imports: [
      PrismaModule,
      NotificationsModule,
      ApprovalsModule,
      forwardRef(() => OnboardingModule),
    ],
  ```

  `providers` / `controllers` / `exports` 三行改为：
  ```ts
    providers: [
      CustomersService,
      CustomerRestrictionsService,
      CustomerAccessService,
      CustomerRestrictionWorkflowService,
      CustomerPendingActionService,
    ],
    controllers: [
      CustomersController,
      CustomerPendingActionController,
      CustomerRestrictionsAdminController,
      CustomerRestrictionsClientController,
    ],
    // CustomerAccessService 要导出：deposit / withdraw / swap 三个 workflow 靠它 assertCapability
    exports: [
      CustomerRestrictionsService,
      CustomerAccessService,
      CustomerRestrictionWorkflowService,
      CustomerPendingActionService,
    ],
  ```
  （`AuditLogsService` 无需 import——`audit-logs.module.ts:8` 是 `@Global()`。）

- [ ] **Step 12: rbac.catalog.ts 登记三条 admin 路由**

  先确认前置任务没登记过（重复 code 会让 `db:base:sync` 撞唯一键）：
  ```bash
  grep -n "CUSTOMER_RESTRICTION_READ\|CUSTOMER_RESTRICTION_WRITE\|CUSTOMER_RESTRICTION_RELEASE'" src/modules/identity/access-control/rbac.catalog.ts
  ```
  期望输出：无匹配。若已有 6 行匹配（联合类型 3 + route 3），跳过本步直接进 Step 13。

  无匹配则做两处 Edit。一、`PermissionGroup` 联合类型，在第 22 行 `| 'CUSTOMER_TAG_MANAGE'` 之后插入：
  ```ts
    | 'CUSTOMER_RESTRICTION_READ'
    | 'CUSTOMER_RESTRICTION_WRITE'
    | 'CUSTOMER_RESTRICTION_RELEASE'
  ```
  二、route 清单，在第 233 行 `route('DELETE', '/admin/customers/:customerNo/tags/:tagCode', ...)` 之后插入：
  ```ts
    route('GET', '/admin/customers/:customerNo/restrictions', 'List customer restrictions', ['CUSTOMER_RESTRICTION_READ']),
    route('POST', '/admin/customers/:customerNo/restrictions', 'Open customer restriction', ['CUSTOMER_RESTRICTION_WRITE']),
    route('POST', '/admin/customers/:customerNo/restrictions/:restrictionNo/release', 'Request restriction release', ['CUSTOMER_RESTRICTION_RELEASE']),
  ```

- [ ] **Step 13: 同步权限种子并重启后端**

  ```bash
  bash scripts/on-stack.sh main db:base:sync
  bash scripts/stack.sh up main
  ```
  期望：seed 无报错；`stack.sh up main` 打出 backend 3000 已就绪。
  ⚠️ 只 seed 不重启无效——SUPER_ADMIN 走的是内存里的 `RBAC_PERMISSION_DEFINITIONS`，不读 DB。

- [ ] **Step 14: 真实 HTTP 冒烟三个 admin 端点 + 一个客户端点**

  ```bash
  TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
  CNO=$(curl -s -H "Authorization: Bearer $TOKEN" 'http://localhost:3000/customers?take=1' \
    | python3 -c 'import sys,json;d=json.load(sys.stdin);print((d.get("items") or d)[0]["customerNo"])')

  # 1) 空列表
  curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/admin/customers/$CNO/restrictions"
  # 2) visibility 混进 body → 400
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"cause":"ADMIN_SUSPENSION","reason":"smoke","visibility":"SILENT"}' \
    "http://localhost:3000/admin/customers/$CNO/restrictions"
  # 3) SANCTION 带 scopes → 400
  curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" \
    -H 'Content-Type: application/json' \
    -d '{"cause":"SANCTION","scopes":["WITHDRAW"],"reason":"smoke"}' \
    "http://localhost:3000/admin/customers/$CNO/restrictions"
  # 4) 干净 body → 201
  curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"cause":"ADMIN_SUSPENSION","reason":"smoke test"}' \
    "http://localhost:3000/admin/customers/$CNO/restrictions"
  ```
  期望：① `[]`；② `400`；③ `400`；④ `{"restrictionNo":"RST...","created":true}`，且再打一次 ① 能看到那条 OPEN 行。
  最后拿客户 token 打 `curl -s -H "Authorization: Bearer $CUST_TOKEN" http://localhost:3000/client/me/restrictions`，期望 `[{"restrictionNo":"RST...","cause":"ADMIN_SUSPENSION",...}]`（ADMIN_SUSPENSION 是 DISCLOSED）；用 admin token 打同一路径期望 `403`。

- [ ] **Step 15: 硬闸门 + 收尾 commit**

  ```bash
  npx tsc --noEmit
  npm test -- src/modules/identity/customers
  ```
  期望：`tsc` 零输出；customers 目录下全部 spec PASS（含本任务新增 15 例）。然后：
  ```bash
  git add src/modules/identity/customers/customers.module.ts \
          src/modules/identity/access-control/rbac.catalog.ts
  git commit -m "feat(customers): 注册限制两控制器/CustomerAccessService/WorkflowService + rbac.catalog 登记三条限制路由"
  ```

---

### Task 12: 管理台前端 —— Restrictions 节 + 两个弹窗 + 列表列

把 admin 侧从「已死的 compliance-case 冻结入口」切到限制账：新增前端 cause 策略镜像表（带漂移守则测试）、客户详情 Restrictions 节、Add / Release 两个弹窗、客户列表 Restrictions 列与筛选，并物理删除 `CaseBoundCustomerControlModal.tsx`（它 PATCH 的 `/admin/compliance/cases/:id/action` 端点后端已不存在，且通篇裸 Tailwind）。

本任务只动 `admin-web/`，后端端点、RBAC 登记、`db:base:sync` + 重启由前序任务完成。

**Files:**

- Create: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/utils/restrictionCauseMeta.ts`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/utils/restrictionCauseMeta.spec.ts` (Test)
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/components/RestrictionOpenModal.tsx`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/components/RestrictionReleaseModal.tsx`
- Delete: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/components/CaseBoundCustomerControlModal.tsx`（全文 285 行；唯一引用方是 `CustomerDetail.tsx:4-6` 与 `:1143-1159`）
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/rbac/permissions.ts` — 在 `CUSTOMER_TAGS_*` 段（L23-26）之后插入三个权限码
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/pages/CustomerDetail.tsx` — L1（react import）、L4-6（删旧弹窗 import）、L71-77（接口字段）、L271（弹窗 state）、L377-380 之后（新 fetch effect）、L437-440（`hasComplianceFreeze`）、L537-538（`canFreeze`/`canUnfreeze`）、L582-585（hero 徽章）、L707-715（Compliance FieldGrid）、L775-788（Compliance Freeze 整节）、L1055-1075（侧栏 Actions）、L1086-1100（侧栏 Status）、L1142-1159（弹窗挂载）
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/pages/CustomerManagement.tsx` — L1-16（imports）、L20-34（`CustomerItem`）、L42-46（`FilterState`）、L67-71（`DEFAULT_FILTERS`）、L73-83（新增 `RestrictionCell` 原语 + state）、L87-95（`buildParams`）、L97-129（`fetchCustomers`）、L133-134（`hasFilter`）、L178-199（筛选下拉）、L225-262（表头 + 空态 colSpan）、L263-316（行渲染）、L322-338（footer 计数）
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/doc-final/BACKLOG.md` — 登记列表页筛选仅作用于当前页这一限制

**Interfaces:**

Consumes（前序任务产出，本任务只读）：
- `RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy>` — `src/modules/identity/customers/constants/restriction-cause.constant.ts`（仅被 `.spec.ts` 直接 import 作漂移断言，生产代码不跨端引用）
- `GET  /admin/customers/:customerNo/restrictions` → `RestrictionRow[]`（含 SILENT、含 RELEASED；`openedAt`/`releasedAt` 上线为 ISO string）
- `POST /admin/customers/:customerNo/restrictions` body `{ cause, scopes?, reason, caseRef? }` → `{ restrictionNo: string; created: boolean }`
- `POST /admin/customers/:customerNo/restrictions/:restrictionNo/release` body `{ reason, releaseOrderRef? }` → `{ approvalNo: string }`
- `GET  /customers/:id` → 详情体带 `lifecycle: string`，不再有 `onboardingStatus`/`adminStatus`/`complianceStatus`/`complianceFreeze*`
- `GET  /customers?skip&take&search&status&customerType` → `{ total, data }`，`status` 值域改为 `CustomerLifecycle`
- `adminFetch(input, init?): Promise<Response>` / `getApiErrorMessage(res, fallback): Promise<string>` / `AdminSessionError` / `AdminPermissionError` — `admin-web/src/utils/adminFetch.ts`
- `adminButtonClass(variant: AdminButtonVariant, className?): string` — `admin-web/src/components/common/adminButtonStyles.ts`（13 变体）
- `AdminBadge({ value, dot? })` — `admin-web/src/components/ui/AdminBadge.tsx`
- `useAdminSession().hasPermission(permission: string): boolean`

Produces：
- `admin-web/src/utils/restrictionCauseMeta.ts`：`RESTRICTION_CAUSE_POLICY`、`RESTRICTION_CAUSES: RestrictionCause[]`、`SELECTABLE_SCOPES: RestrictionScope[]`、`scopeLabel(scopes: RestrictionScope[]): string`、类型 `RestrictionScope` / `RestrictionCause` / `RestrictionVisibility` / `RestrictionReleasePolicy` / `RestrictionCausePolicy` / `AdminRestrictionRow`
- `admin-web/src/components/RestrictionOpenModal.tsx`：`default ({ open, customerNo, customerLabel, onClose, onSubmitted }: { open: boolean; customerNo: string; customerLabel: string; onClose: () => void; onSubmitted: (restrictionNo: string, created: boolean) => Promise<void> | void })`
- `admin-web/src/components/RestrictionReleaseModal.tsx`：`default ({ open, customerNo, restriction, onClose, onSubmitted }: { open: boolean; customerNo: string; restriction: AdminRestrictionRow | null; onClose: () => void; onSubmitted: (approvalNo: string) => Promise<void> | void })`
- `PERMISSIONS.CUSTOMER_RESTRICTIONS_READ | CUSTOMER_RESTRICTIONS_WRITE | CUSTOMER_RESTRICTIONS_RELEASE`

---

- [ ] **Step 1: 先写失败的漂移守则测试（前端 cause 表必须与后端常量逐字相等）**

`admin-web/src/**/*.spec.ts` 由仓库根 jest 收（`jest.config.js` 的 `roots` 含 `<rootDir>/admin-web/src`，`testRegex: '.*\.spec\.ts$'`），且 `admin-web/tsconfig.app.json` 的 `exclude` 含 `src/**/*.spec.ts`、后端 `tsconfig.json` 的 `exclude` 含 `admin-web`——所以 spec 里可以相对路径 import 后端常量做真断言，两边编译都看不到它。参照同目录已有 `depositStatusMap.spec.ts` 的写法。

新建 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/utils/restrictionCauseMeta.spec.ts`：

```ts
// admin-web/src/utils/restrictionCauseMeta.spec.ts
//
// 守则性测试：admin-web 的 cause 策略回显表是后端常量的镜像，一旦后端改了
// scope/可见性/解除方式而前端没跟，这里必须红。相对路径 import 后端常量是
// 刻意的——它只发生在 spec 里（tsconfig.app.json 排除 *.spec.ts，后端
// tsconfig.json 排除 admin-web），生产 bundle 不会跨端拉后端代码。

import { RESTRICTION_CAUSE_POLICY as BACKEND_POLICY } from '../../../src/modules/identity/customers/constants/restriction-cause.constant';
import {
  RESTRICTION_CAUSES,
  RESTRICTION_CAUSE_POLICY,
  SELECTABLE_SCOPES,
  scopeLabel,
} from './restrictionCauseMeta';

describe('restrictionCauseMeta (admin mirror of RESTRICTION_CAUSE_POLICY)', () => {
  it('covers exactly the backend cause set (no more, no less)', () => {
    expect([...RESTRICTION_CAUSES].sort()).toEqual(Object.keys(BACKEND_POLICY).sort());
    expect(RESTRICTION_CAUSES).toHaveLength(7);
  });

  it('mirrors every backend policy field verbatim', () => {
    expect(RESTRICTION_CAUSE_POLICY).toEqual(BACKEND_POLICY);
  });

  it('marks PENDING_DOCUMENT as the only scope-selectable cause', () => {
    const selectable = RESTRICTION_CAUSES.filter(
      (cause) => RESTRICTION_CAUSE_POLICY[cause].scopeSelectable,
    );
    expect(selectable).toEqual(['PENDING_DOCUMENT']);
  });

  it('keeps customerLabel empty for every SILENT cause (nothing to disclose)', () => {
    RESTRICTION_CAUSES.forEach((cause) => {
      const policy = RESTRICTION_CAUSE_POLICY[cause];
      if (policy.visibility === 'SILENT') {
        expect(policy.customerLabel).toBe('');
      } else {
        expect(policy.customerLabel.length).toBeGreaterThan(0);
      }
    });
  });

  it('offers only the three capability scopes for manual selection (never ALL)', () => {
    expect(SELECTABLE_SCOPES).toEqual(['DEPOSIT', 'WITHDRAW', 'SWAP']);
  });

  it('renders scope lists as dot-joined text and falls back to the em dash', () => {
    expect(scopeLabel(['WITHDRAW', 'SWAP'])).toBe('WITHDRAW·SWAP');
    expect(scopeLabel(['ALL'])).toBe('ALL');
    expect(scopeLabel([])).toBe('—');
  });
});
```

- [ ] **Step 2: 跑测试确认它红（模块还不存在）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest admin-web/src/utils/restrictionCauseMeta.spec.ts
```

期望输出含：

```
Cannot find module './restrictionCauseMeta' from 'admin-web/src/utils/restrictionCauseMeta.spec.ts'
Test Suites: 1 failed, 1 total
```

- [ ] **Step 3: 建前端策略镜像表让测试转绿**

新建 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/utils/restrictionCauseMeta.ts`：

```ts
// admin-web/src/utils/restrictionCauseMeta.ts
//
// 与 src/modules/identity/customers/constants/restriction-cause.constant.ts 同步。
// 后端常量是唯一真相源（贴便签时 scope/可见性/解除方式由后端按 cause 定死，
// 前端传了 visibility / releasePolicy 一律 400）；这份镜像只用于弹窗里
// 「选了 cause 之后的只读回显」，让操作员在提交前看清这一贴会带来什么。
// 漂移由 restrictionCauseMeta.spec.ts 拦截：它直接 import 后端常量逐字段比对。

export type RestrictionScope = 'ALL' | 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export type RestrictionCause =
  | 'SANCTION'
  | 'ADMIN_SUSPENSION'
  | 'MATERIAL_EXPIRED'
  | 'TIER_UPGRADE_PENDING'
  | 'KYT_REJECTED_SOFT'
  | 'KYT_REJECTED_HARD'
  | 'PENDING_DOCUMENT';

export type RestrictionVisibility = 'SILENT' | 'DISCLOSED';
export type RestrictionReleasePolicy = 'MLRO_APPROVAL' | 'OPS_APPROVAL';

export interface RestrictionCausePolicy {
  defaultScopes: RestrictionScope[];
  visibility: RestrictionVisibility;
  releasePolicy: RestrictionReleasePolicy;
  scopeSelectable: boolean;
  customerLabel: string;
}

export const RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy> = {
  SANCTION: {
    defaultScopes: ['ALL'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLabel: '',
  },
  ADMIN_SUSPENSION: {
    defaultScopes: ['ALL'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Account suspended',
  },
  MATERIAL_EXPIRED: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Document expired',
  },
  TIER_UPGRADE_PENDING: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Additional review in progress',
  },
  KYT_REJECTED_SOFT: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: false,
    customerLabel: 'Verification required',
  },
  KYT_REJECTED_HARD: {
    defaultScopes: ['SWAP', 'WITHDRAW'],
    visibility: 'SILENT',
    releasePolicy: 'MLRO_APPROVAL',
    scopeSelectable: false,
    customerLabel: '',
  },
  PENDING_DOCUMENT: {
    defaultScopes: ['WITHDRAW', 'SWAP'],
    visibility: 'DISCLOSED',
    releasePolicy: 'OPS_APPROVAL',
    scopeSelectable: true,
    customerLabel: 'Document required',
  },
};

/** 下拉顺序 = 常量声明顺序（制裁在最前，最常用的人工挂起紧随其后）。 */
export const RESTRICTION_CAUSES = Object.keys(
  RESTRICTION_CAUSE_POLICY,
) as RestrictionCause[];

/** 人工可勾的只有三个能力位；`ALL` 由 cause 带出，永不让操作员手选。 */
export const SELECTABLE_SCOPES: RestrictionScope[] = ['DEPOSIT', 'WITHDRAW', 'SWAP'];

export const scopeLabel = (scopes: RestrictionScope[]): string =>
  scopes.length > 0 ? scopes.join('·') : '—';

/* ── Admin wire row（GET /admin/customers/:customerNo/restrictions 的元素） ──
   与后端 RestrictionRow 同形，差别只有日期：上线后是 ISO string。
   一个 restrictionNo 一行，多能力已在后端聚合进 scopes 数组。 */
export interface AdminRestrictionRow {
  restrictionNo: string;
  customerId: string;
  scopes: RestrictionScope[];
  cause: RestrictionCause;
  visibility: RestrictionVisibility;
  releasePolicy: RestrictionReleasePolicy;
  status: 'OPEN' | 'RELEASED';
  reason: string;
  caseRef: string | null;
  releaseOrderRef: string | null;
  openedAt: string;
  openedBy: string;
  releasedAt: string | null;
  releasedBy: string | null;
  releaseApprovalNo: string | null;
  releaseMode: 'AUTO' | 'MANUAL' | null;
  traceId: string;
}
```

- [ ] **Step 4: 跑测试确认绿，然后 commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest admin-web/src/utils/restrictionCauseMeta.spec.ts
```

期望输出含：

```
Tests:       6 passed, 6 total
Test Suites: 1 passed, 1 total
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add admin-web/src/utils/restrictionCauseMeta.ts admin-web/src/utils/restrictionCauseMeta.spec.ts && git commit -m "feat(admin): 前端 cause 策略镜像表 + 与后端常量逐字段对齐的漂移守则测试"
```

- [ ] **Step 5: permissions.ts 加三个权限码并 tsc**

编辑 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/rbac/permissions.ts`，在 L26（`CUSTOMER_TAGS_REVOKE` 那行）之后、L28 空行前插入：

```ts

  CUSTOMER_RESTRICTIONS_READ: 'api.get.admin_customers_customerno_restrictions',
  CUSTOMER_RESTRICTIONS_WRITE: 'api.post.admin_customers_customerno_restrictions',
  CUSTOMER_RESTRICTIONS_RELEASE:
    'api.post.admin_customers_customerno_restrictions_restrictionno_release',
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web && npx tsc --noEmit -p tsconfig.app.json
```

期望：无输出，退出码 0。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add admin-web/src/rbac/permissions.ts && git commit -m "feat(admin): 登记 CUSTOMER_RESTRICTIONS 读/写/解除三个前端权限码"
```

- [ ] **Step 6: 新建 RestrictionOpenModal.tsx（选 cause → 三行只读回显 → reason/caseRef → 立即生效）**

新建 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/components/RestrictionOpenModal.tsx`：

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import {
  RESTRICTION_CAUSES,
  RESTRICTION_CAUSE_POLICY,
  SELECTABLE_SCOPES,
  scopeLabel,
  type RestrictionCause,
  type RestrictionScope,
} from '../utils/restrictionCauseMeta';

interface RestrictionOpenModalProps {
  open: boolean;
  customerNo: string;
  customerLabel: string;
  onClose: () => void;
  onSubmitted: (restrictionNo: string, created: boolean) => Promise<void> | void;
}

/** 默认落在人工挂起而不是制裁——制裁必须是操作员主动选中的动作。 */
const DEFAULT_CAUSE: RestrictionCause = 'ADMIN_SUSPENSION';

const EchoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-adm-border py-2 last:border-b-0">
    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-adm-t3">
      {label}
    </span>
    <span className="min-w-0 text-right font-mono text-[10px] text-adm-t2">{children}</span>
  </div>
);

const RestrictionOpenModal = ({
  open,
  customerNo,
  customerLabel,
  onClose,
  onSubmitted,
}: RestrictionOpenModalProps) => {
  const [cause, setCause] = useState<RestrictionCause>(DEFAULT_CAUSE);
  const [scopes, setScopes] = useState<RestrictionScope[]>(
    RESTRICTION_CAUSE_POLICY[DEFAULT_CAUSE].defaultScopes,
  );
  const [reason, setReason] = useState('');
  const [caseRef, setCaseRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setCause(DEFAULT_CAUSE);
    setScopes(RESTRICTION_CAUSE_POLICY[DEFAULT_CAUSE].defaultScopes);
    setReason('');
    setCaseRef('');
    setError('');
  }, [open]);

  const policy = RESTRICTION_CAUSE_POLICY[cause];

  const pickCause = (next: RestrictionCause) => {
    setCause(next);
    setScopes(RESTRICTION_CAUSE_POLICY[next].defaultScopes);
  };

  const toggleScope = (scope: RestrictionScope) =>
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    );

  const submit = async () => {
    if (!reason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      // scope 仅 scopeSelectable 的 cause 才允许出现在 body，否则后端 400。
      const body: Record<string, unknown> = { cause, reason: reason.trim() };
      if (policy.scopeSelectable) body.scopes = scopes;
      if (caseRef.trim()) body.caseRef = caseRef.trim();

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/restrictions`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to add restriction.'));
      }
      const data = (await res.json()) as { restrictionNo: string; created: boolean };
      await onSubmitted(data.restrictionNo, data.created);
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to add restriction.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const submitDisabled =
    submitting || !reason.trim() || (policy.scopeSelectable && scopes.length === 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">Add Restriction</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            {customerLabel} · {customerNo} — takes effect immediately, no approval.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Cause
          </label>
          <select
            value={cause}
            onChange={(e) => pickCause(e.target.value as RestrictionCause)}
            disabled={submitting}
            className="mb-4 w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors focus:border-adm-amber"
          >
            {RESTRICTION_CAUSES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* 只读回显 —— cause 一选，这三行就是后端会写进便签的事实 */}
          <div className="mb-4 rounded border border-adm-border bg-adm-bg px-3 py-1">
            <EchoRow label="Blocks">
              {policy.scopeSelectable ? (
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  {SELECTABLE_SCOPES.map((scope) => (
                    <label
                      key={scope}
                      className="inline-flex cursor-pointer items-center gap-1 text-adm-t2"
                    >
                      <input
                        type="checkbox"
                        checked={scopes.includes(scope)}
                        onChange={() => toggleScope(scope)}
                        disabled={submitting}
                        className="h-3 w-3 accent-current"
                      />
                      {scope}
                    </label>
                  ))}
                </span>
              ) : (
                scopeLabel(policy.defaultScopes)
              )}
            </EchoRow>
            <EchoRow label="Customer sees">
              {policy.visibility === 'SILENT'
                ? 'SILENT — nothing shown to the customer'
                : `DISCLOSED — "${policy.customerLabel}"`}
            </EchoRow>
            <EchoRow label="Release by">
              {policy.releasePolicy === 'MLRO_APPROVAL'
                ? 'MLRO_APPROVAL — MLRO approval required'
                : 'OPS_APPROVAL — ops officer approval required'}
            </EchoRow>
          </div>

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Sanctions list hit confirmed by MLRO on 2026-08-15"
            disabled={submitting}
            className="mb-4 h-20 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Case Ref (optional)
          </label>
          <input
            value={caseRef}
            onChange={(e) => setCaseRef(e.target.value)}
            placeholder="e.g. CRA26081500x"
            disabled={submitting}
            className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          <p className="mt-1.5 font-mono text-[9px] text-adm-t3">
            Same cause + same case ref on an open restriction is a no-op (idempotent).
          </p>
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitDisabled}
            className={adminButtonClass('workflowNegative')}
          >
            {submitting ? 'Adding…' : 'Add Restriction'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestrictionOpenModal;
```

- [ ] **Step 7: 新建 RestrictionReleaseModal.tsx（回显便签 → MLRO 类要 releaseOrderRef → 开审批案）**

新建 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/components/RestrictionReleaseModal.tsx`：

```tsx
import { useEffect, useState, type ReactNode } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import {
  AdminSessionError,
  adminFetch,
  getApiErrorMessage,
} from '../utils/adminFetch';
import { scopeLabel, type AdminRestrictionRow } from '../utils/restrictionCauseMeta';

interface RestrictionReleaseModalProps {
  open: boolean;
  customerNo: string;
  restriction: AdminRestrictionRow | null;
  onClose: () => void;
  onSubmitted: (approvalNo: string) => Promise<void> | void;
}

const EchoRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex items-start justify-between gap-3 border-b border-adm-border py-2 last:border-b-0">
    <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-adm-t3">
      {label}
    </span>
    <span className="min-w-0 break-all text-right font-mono text-[10px] text-adm-t2">
      {children}
    </span>
  </div>
);

const fmt = (v?: string | null): string => {
  if (!v) return '—';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString();
};

const RestrictionReleaseModal = ({
  open,
  customerNo,
  restriction,
  onClose,
  onSubmitted,
}: RestrictionReleaseModalProps) => {
  const [reason, setReason] = useState('');
  const [releaseOrderRef, setReleaseOrderRef] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setReason('');
    setReleaseOrderRef('');
    setError('');
  }, [open, restriction?.restrictionNo]);

  if (!open || !restriction) return null;

  // releasePolicy 取便签行上的存量值，不重新按 cause 推——便签一旦贴下，
  // 它的解除方式就是当时写死的那一个。
  const needsOrderRef = restriction.releasePolicy === 'MLRO_APPROVAL';

  const submit = async () => {
    if (!reason.trim() || (needsOrderRef && !releaseOrderRef.trim())) return;
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = { reason: reason.trim() };
      if (releaseOrderRef.trim()) body.releaseOrderRef = releaseOrderRef.trim();

      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/restrictions/${restriction.restrictionNo}/release`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (!res.ok) {
        throw new Error(await getApiErrorMessage(res, 'Failed to request release.'));
      }
      const data = (await res.json()) as { approvalNo: string };
      await onSubmitted(data.approvalNo);
      onClose();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Failed to request release.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-adm-border bg-adm-panel shadow-xl">
        <div className="border-b border-adm-border px-6 py-4">
          <h2 className="text-base font-semibold text-adm-t1">Release Restriction</h2>
          <p className="mt-1 font-mono text-[10px] text-adm-t3">
            This opens an approval case. The restriction stays OPEN until it is approved.
          </p>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
              {error}
            </div>
          )}

          <div className="mb-4 rounded border border-adm-border bg-adm-bg px-3 py-1">
            <EchoRow label="Restriction No">
              <span className="font-semibold text-adm-amber">{restriction.restrictionNo}</span>
            </EchoRow>
            <EchoRow label="Cause">
              {restriction.cause}
              {restriction.visibility === 'SILENT' ? ' 🔇' : ''}
            </EchoRow>
            <EchoRow label="Blocks">{scopeLabel(restriction.scopes)}</EchoRow>
            <EchoRow label="Opened">
              {fmt(restriction.openedAt)} · {restriction.openedBy}
            </EchoRow>
            <EchoRow label="Opened Reason">{restriction.reason}</EchoRow>
            <EchoRow label="Case Ref">{restriction.caseRef || '—'}</EchoRow>
            <EchoRow label="Release By">{restriction.releasePolicy}</EchoRow>
          </div>

          <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Release Order Ref{needsOrderRef ? '' : ' (optional)'}
          </label>
          <input
            value={releaseOrderRef}
            onChange={(e) => setReleaseOrderRef(e.target.value)}
            placeholder={
              needsOrderRef
                ? 'Required — e.g. MLRO-ORDER-26081501'
                : 'e.g. OPS-TICKET-26081501'
            }
            disabled={submitting}
            className="w-full rounded border border-adm-border bg-adm-bg px-2.5 py-2 font-mono text-[11px] text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
          {needsOrderRef && (
            <p className="mt-1.5 font-mono text-[9px] text-adm-amber">
              MLRO_APPROVAL restrictions cannot be released without a written order reference.
            </p>
          )}

          <label className="mb-1.5 mt-4 block font-mono text-[9px] font-semibold uppercase tracking-[0.12em] text-adm-t3">
            Release Reason
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Name match cleared — false positive confirmed against passport MRZ"
            disabled={submitting}
            className="h-20 w-full resize-none rounded border border-adm-border bg-adm-bg px-2.5 py-2 text-xs text-adm-t1 outline-none transition-colors placeholder:text-adm-t3 focus:border-adm-amber"
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-adm-border px-6 py-4">
          <button onClick={onClose} disabled={submitting} className={adminButtonClass('modalCancel')}>
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={submitting || !reason.trim() || (needsOrderRef && !releaseOrderRef.trim())}
            className={adminButtonClass('modalConfirm')}
          >
            {submitting ? 'Submitting…' : 'Submit for approval'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default RestrictionReleaseModal;
```

- [ ] **Step 8: tsc 通过后 commit 两个弹窗**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web && npx tsc --noEmit -p tsconfig.app.json
```

期望：无输出，退出码 0。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add admin-web/src/components/RestrictionOpenModal.tsx admin-web/src/components/RestrictionReleaseModal.tsx && git commit -m "feat(admin): Add / Release 两个限制弹窗（adm-* token + 13 变体按钮，贴即时生效、撕走审批）"
```

- [ ] **Step 9: CustomerDetail 数据层 —— 换字段、换 state、加 fetch**

编辑 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/pages/CustomerDetail.tsx`。

9.1 —— L1-6 的 import 头，把 react import 补 `Fragment`、旧弹窗 import 换成新的两个：

```tsx
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link2, RefreshCw } from 'lucide-react';
import RestrictionOpenModal from '../components/RestrictionOpenModal';
import RestrictionReleaseModal from '../components/RestrictionReleaseModal';
```

9.2 —— L17（`import { PERMISSIONS } ...`）之后追加一行：

```tsx
import { scopeLabel, type AdminRestrictionRow } from '../utils/restrictionCauseMeta';
```

9.3 —— L71-77 的七个字段整体替换为一个：

```tsx
  lifecycle: string;
```

9.4 —— L271（`const [controlAction, setControlAction] = ...`）整行替换为：

```tsx
  const [restrictionModalOpen, setRestrictionModalOpen] = useState(false);
  const [releaseTarget, setReleaseTarget] = useState<AdminRestrictionRow | null>(null);
  const [restrictions, setRestrictions] = useState<AdminRestrictionRow[]>([]);
  const [restrictionsLoading, setRestrictionsLoading] = useState(false);
  const [showReleased, setShowReleased] = useState(false);

  /* ── Restrictions permissions ── */
  const canReadRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_READ);
  const canWriteRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_WRITE);
  const canReleaseRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_RELEASE);
```

9.5 —— 在 L380（tags 的 `}, [canViewTags, detail?.customerNo]);`）之后插入 fetch + effect，复刻上方 tags 的写法：

```tsx

  /* ── Restrictions fetching ── */
  const fetchRestrictions = (customerNo: string) => {
    setRestrictionsLoading(true);
    adminFetch(`${import.meta.env.VITE_API_URL}/admin/customers/${customerNo}/restrictions`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: AdminRestrictionRow[]) => setRestrictions(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setRestrictionsLoading(false));
  };

  useEffect(() => {
    if (canReadRestrictions && detail?.customerNo) fetchRestrictions(detail.customerNo);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canReadRestrictions, detail?.customerNo]);
```

9.6 —— 删除 L437-440 的 `hasComplianceFreeze` 整块（`const hasComplianceFreeze = useMemo(...)`，含 `);`）。

9.7 —— 删除 L537-538 两行 `canFreeze` / `canUnfreeze`，在其位置插入派生数组：

```tsx
  const openRestrictions = restrictions.filter((r) => r.status === 'OPEN');
  const releasedRestrictions = restrictions.filter((r) => r.status === 'RELEASED');
```

- [ ] **Step 10: CustomerDetail 主区 —— hero 徽章、Compliance 三字段、Compliance Freeze 节换成 Restrictions 节**

10.1 —— L582-585 的 hero 徽章块替换为（lifecycle 是真状态走 `AdminBadge`；限制数是计数不是状态，走本文件已有的 chip 写法，对齐 L728-732 的 "EDD level2" 与 L1037-1041 的 PEP chip）：

```tsx
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <AdminBadge value={detail.lifecycle} />
              {openRestrictions.length > 0 && (
                <span className="inline-flex items-center rounded border border-adm-red/25 bg-adm-red/10 px-1.5 py-px font-mono text-[9px] font-semibold text-adm-red">
                  {openRestrictions.length} RESTRICTION{openRestrictions.length === 1 ? '' : 'S'}
                </span>
              )}
            </div>
```

10.2 —— L708-710 三个 `Field`（Onboarding Status / Admin Status / Compliance Status）替换为一个：

```tsx
                <Field label="Lifecycle" value={detail.lifecycle} />
```

10.3 —— L775-788 的「⑤ Compliance Freeze detail」整节（含 `{hasComplianceFreeze && (` 到 `)}`）整体替换为 Restrictions 节：

```tsx
          {/* ⑤ Restrictions —— 一行一张便签；🔇 = SILENT，后台可见客户不可见 */}
          {canReadRestrictions && (
            <section className="px-6 py-5">
              <div className="flex items-baseline justify-between gap-3">
                <Cap>Restrictions</Cap>
                <span className="font-mono text-[10px] text-adm-t3">
                  {restrictionsLoading ? 'Loading…' : `${openRestrictions.length} open`}
                </span>
              </div>
              <p className="mt-1 mb-3 font-mono text-[9px] text-adm-t3">
                One row = one restriction. 🔇 marks SILENT — visible here, never to the customer.
              </p>

              {openRestrictions.length === 0 ? (
                <p className="font-mono text-[10px] text-adm-t3">No open restrictions.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr>
                        {(['Restriction No', 'Blocked', 'Cause', 'Opened', 'Opened By', ''] as string[]).map(
                          (h, i) => (
                            <th
                              key={h || `open-col-${i}`}
                              className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                            >
                              {h}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {openRestrictions.map((r) => (
                        <Fragment key={r.restrictionNo}>
                          <tr>
                            <td className="px-3 pt-2 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
                              {r.restrictionNo}
                            </td>
                            <td className="px-3 pt-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                              {scopeLabel(r.scopes)}
                            </td>
                            <td className="px-3 pt-2 whitespace-nowrap">
                              <span
                                className={[
                                  'inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] font-semibold',
                                  r.visibility === 'SILENT'
                                    ? 'border-adm-red/25 bg-adm-red/10 text-adm-red'
                                    : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
                                ].join(' ')}
                              >
                                {r.cause}
                                {r.visibility === 'SILENT' && (
                                  <span title="SILENT — never shown to the customer">🔇</span>
                                )}
                              </span>
                            </td>
                            <td className="px-3 pt-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                              {fmt(r.openedAt)}
                            </td>
                            <td className="px-3 pt-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                              {r.openedBy || '—'}
                            </td>
                            <td className="px-3 pt-2 text-right whitespace-nowrap">
                              {canReleaseRestrictions ? (
                                <button
                                  className={adminButtonClass('rowLink')}
                                  onClick={() => setReleaseTarget(r)}
                                >
                                  Release →
                                </button>
                              ) : (
                                <span className="font-mono text-[10px] text-adm-t3">—</span>
                              )}
                            </td>
                          </tr>
                          <tr className="border-b border-adm-border">
                            <td
                              colSpan={6}
                              className="px-3 pb-2 font-mono text-[9px] leading-relaxed text-adm-t3"
                            >
                              {r.reason}
                              {r.caseRef ? ` · ${r.caseRef}` : ''}
                            </td>
                          </tr>
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {releasedRestrictions.length > 0 && (
                <div className="mt-3">
                  <button
                    className={adminButtonClass('rowSecondaryUtility')}
                    onClick={() => setShowReleased((v) => !v)}
                  >
                    Released ({releasedRestrictions.length}) {showReleased ? '▾' : '▸'}
                  </button>
                  {showReleased && (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr>
                            {(['Restriction No', 'Blocked', 'Cause', 'Released', 'Approval', 'Mode'] as string[]).map(
                              (h) => (
                                <th
                                  key={h}
                                  className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                                >
                                  {h}
                                </th>
                              ),
                            )}
                          </tr>
                        </thead>
                        <tbody>
                          {releasedRestrictions.map((r) => (
                            <tr key={r.restrictionNo} className="border-b border-adm-border">
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {r.restrictionNo}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {scopeLabel(r.scopes)}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {r.cause}
                                {r.visibility === 'SILENT' ? ' 🔇' : ''}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {fmt(r.releasedAt)} · {r.releasedBy || '—'}
                              </td>
                              <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                                {r.releaseApprovalNo || '—'}
                              </td>
                              <td className="px-3 py-2 whitespace-nowrap">
                                <AdminBadge value={r.releaseMode || 'MANUAL'} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
```

- [ ] **Step 11: CustomerDetail 侧栏 + 弹窗挂载，并删掉旧弹窗文件**

11.1 —— L1055-1075 的 Actions 块整体替换（Offboard 用 `<span title>` 包一层：`disabled` 的 button 在 Chrome 里不派发鼠标事件，title 挂在 button 上不会弹）：

```tsx
          {/* Actions */}
          <div className="border-b border-adm-border py-4">
            <Cap>Actions</Cap>
            <div className="mt-2.5 flex flex-col gap-2">
              {canWriteRestrictions && (
                <button
                  onClick={() => setRestrictionModalOpen(true)}
                  className={adminButtonClass('workflowNegative')}
                >
                  Add Restriction
                </button>
              )}
              <span title="Not implemented" className="block">
                <button disabled className={adminButtonClass('workflowSecondary', 'w-full')}>
                  Offboard
                </button>
              </span>
            </div>
          </div>
```

11.2 —— L1086-1100 的 Status 块（三行 Onboarding / Admin / Compliance）整体替换为两行：

```tsx
          {/* Status */}
          <SidebarGroup title="Status">
            <div className="flex items-center justify-between gap-2">
              <span className="shrink-0 font-mono text-[9px] text-adm-t3">Lifecycle</span>
              <AdminBadge value={detail.lifecycle} />
            </div>
            <SidebarKV
              label="Restrictions"
              value={
                openRestrictions.length > 0 ? (
                  <span className="font-mono text-[10px] font-semibold text-adm-red">
                    {openRestrictions.length} OPEN
                  </span>
                ) : (
                  'NONE'
                )
              }
            />
          </SidebarGroup>
```

11.3 —— L1142-1159 的弹窗挂载整体替换：

```tsx
      {/* ── Restriction modals ── */}
      <RestrictionOpenModal
        open={restrictionModalOpen}
        customerNo={detail.customerNo}
        customerLabel={name}
        onClose={() => setRestrictionModalOpen(false)}
        onSubmitted={async (restrictionNo, created) => {
          setNotice(
            created
              ? `Restriction ${restrictionNo} added.`
              : `Restriction ${restrictionNo} already open — no change.`,
          );
          fetchRestrictions(detail.customerNo);
        }}
      />
      <RestrictionReleaseModal
        open={!!releaseTarget}
        customerNo={detail.customerNo}
        restriction={releaseTarget}
        onClose={() => setReleaseTarget(null)}
        onSubmitted={async (approvalNo) => {
          setNotice(`Release approval ${approvalNo} opened — restriction stays OPEN until approved.`);
          fetchRestrictions(detail.customerNo);
        }}
      />
```

11.4 —— 删掉旧弹窗文件并验证：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git rm admin-web/src/components/CaseBoundCustomerControlModal.tsx && cd admin-web && npx tsc --noEmit -p tsconfig.app.json
```

期望：无输出，退出码 0（`noUnusedLocals` 打开，若还有 `controlAction` / `hasComplianceFreeze` 之类残留会在这里报 `is declared but its value is never read`）。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add admin-web/src/pages/CustomerDetail.tsx admin-web/src/components/CaseBoundCustomerControlModal.tsx && git commit -m "feat(admin): 客户详情换限制账 —— Restrictions 节 + 侧栏 Lifecycle/Restrictions 两行，删 Compliance Freeze 节与 case-bound 旧弹窗"
```

- [ ] **Step 12: CustomerManagement —— Lifecycle 列 + Restrictions 列 + 筛选**

编辑 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web/src/pages/CustomerManagement.tsx`。

12.1 —— L16（`import { PageTitleBar } ...`）之后追加两行 import：

```tsx
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';
import type { AdminRestrictionRow } from '../utils/restrictionCauseMeta';
```

12.2 —— L28-30 的三个字段（`onboardingStatus` / `adminStatus` / `complianceStatus`）替换为：

```tsx
  lifecycle: string;
```

12.3 —— L42-46 的 `FilterState` 替换为：

```tsx
interface FilterState {
  keyword: string;
  lifecycle: string;
  customerType: string;
  /** 客户端筛选：'' 全部 / HAS 有限制 / NONE 无限制 / SANCTION 仅制裁 */
  restriction: '' | 'HAS' | 'NONE' | 'SANCTION';
}

interface RestrictionSummary {
  open: number;
  sanction: boolean;
}
```

12.4 —— L67-71 的 `DEFAULT_FILTERS` 替换为：

```tsx
const DEFAULT_FILTERS: FilterState = {
  keyword: '',
  lifecycle: '',
  customerType: '',
  restriction: '',
};

const LIFECYCLES = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];
```

12.5 —— 在 L73（`/* ───── */` 分隔行）之前插入 cell 原语：

```tsx
/* ── RestrictionCell ─────────────────────────────────────────── */

const RestrictionCell = ({ summary }: { summary?: RestrictionSummary }) => {
  if (!summary || summary.open === 0) {
    return <span className="font-mono text-[10px] text-adm-t3">—</span>;
  }
  return (
    <span
      className={[
        'inline-flex items-center rounded border px-1.5 py-px font-mono text-[10px] font-semibold',
        summary.sanction
          ? 'border-adm-red/25 bg-adm-red/10 text-adm-red'
          : 'border-adm-amber/25 bg-adm-amber/10 text-adm-amber',
      ].join(' ')}
    >
      {summary.open} OPEN
    </span>
  );
};
```

12.6 —— L76（`const navigate = useNavigate();`）之后插入：

```tsx
  const { hasPermission } = useAdminSession();
  const canReadRestrictions = hasPermission(PERMISSIONS.CUSTOMER_RESTRICTIONS_READ);
  const [summaries, setSummaries] = useState<Record<string, RestrictionSummary>>({});
```

12.7 —— L92 的 onboarding 过滤行替换（同一个 `status` query 参数，值域改成 lifecycle）：

```tsx
    if (next.lifecycle.trim()) params.set('status', next.lifecycle.trim());
```

12.8 —— 在 L95（`buildParams` 的 `};`）之后插入逐行取限制摘要的函数。没有批量端点，按当页 20 行并发拉合同内的 GET；失败按 0 处理，不阻塞列表：

```tsx

  /* 无批量端点：当页 20 行各拉一次 GET /admin/customers/:customerNo/restrictions。
     take=20 固定，量可控；失败按 0 计，不让摘要拖垮主列表。 */
  const loadRestrictionSummaries = async (rows: CustomerItem[]) => {
    if (!canReadRestrictions || rows.length === 0) {
      setSummaries({});
      return;
    }
    const entries = await Promise.all(
      rows.map(async (row): Promise<[string, RestrictionSummary]> => {
        try {
          const res = await adminFetch(
            `${import.meta.env.VITE_API_URL}/admin/customers/${row.customerNo}/restrictions`,
          );
          if (!res.ok) return [row.customerNo, { open: 0, sanction: false }];
          const data = (await res.json()) as AdminRestrictionRow[];
          const openRows = Array.isArray(data) ? data.filter((r) => r.status === 'OPEN') : [];
          return [
            row.customerNo,
            {
              open: openRows.length,
              sanction: openRows.some((r) => r.cause === 'SANCTION'),
            },
          ];
        } catch {
          return [row.customerNo, { open: 0, sanction: false }];
        }
      }),
    );
    setSummaries(Object.fromEntries(entries));
  };
```

12.9 —— L112-114（`setItems(rows);` 起三行）之后、`} catch` 之前插入：

```tsx
      void loadRestrictionSummaries(rows);
```

12.10 —— L133-134 的 `hasFilter` 替换，并在其后加派生列表：

```tsx
  const hasFilter =
    !!filters.keyword ||
    !!filters.lifecycle ||
    !!filters.customerType ||
    !!filters.restriction;

  /* Restrictions 是客户端筛选（服务端列表没有聚合字段），只作用于当前页。 */
  const visibleItems = items.filter((c) => {
    if (!filters.restriction) return true;
    const summary = summaries[c.customerNo];
    const open = summary?.open ?? 0;
    if (filters.restriction === 'HAS') return open > 0;
    if (filters.restriction === 'NONE') return open === 0;
    return !!summary?.sanction;
  });
```

12.11 —— L178-190 的 onboarding 下拉替换，并在 customerType 下拉（L191-199）之后追加限制筛选：

```tsx
        <select
          value={filters.lifecycle}
          onChange={(e) => updateFilter('lifecycle', e.target.value)}
          className={`${fi} w-44`}
        >
          <option value="">All lifecycle</option>
          {LIFECYCLES.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
```

紧跟在 customerType 下拉之后插入：

```tsx
        {canReadRestrictions && (
          <select
            value={filters.restriction}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                restriction: e.target.value as FilterState['restriction'],
              }))
            }
            className={`${fi} w-40`}
            title="Filters the rows loaded on this page"
          >
            <option value="">All restrictions</option>
            <option value="HAS">Restricted</option>
            <option value="NONE">Unrestricted</option>
            <option value="SANCTION">Sanction only</option>
          </select>
        )}
```

12.12 —— L226-236 的表头数组替换为 8 列：

```tsx
                [
                  ['Customer No',  '150px'],
                  ['Name',         '200px'],
                  ['Email',        '240px'],
                  ['Type',         '110px'],
                  ['Lifecycle',    '160px'],
                  ['Restrictions', '130px'],
                  ['Risk Rating',  '110px'],
                  ['Created',      'auto'],
                ] as [string, string][]
```

12.13 —— L249-262 两处 `colSpan={9}` 改 `colSpan={8}`，并把空态判断改用 `visibleItems`：

```tsx
            {loading && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && visibleItems.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center font-mono text-[11px] text-adm-t3">
                  No customers found.
                </td>
              </tr>
            )}
```

12.14 —— L263 的 `{!loading && items.map((customer) => (` 改成 `{!loading && visibleItems.map((customer) => (`；L291-306 的 Onboarding / Admin / Compliance 三个 `<td>` 替换为两个：

```tsx
                {/* Lifecycle */}
                <td className="px-4 py-2.5">
                  <AdminBadge value={customer.lifecycle} />
                </td>

                {/* Restrictions */}
                <td className="px-4 py-2.5">
                  <RestrictionCell summary={summaries[customer.customerNo]} />
                </td>
```

12.15 —— L324-327 的 footer 计数改用 `visibleItems`：

```tsx
            {total > 0
              ? `Showing ${visibleItems.length} / ${total} customer${total === 1 ? '' : 's'}${
                  filters.restriction ? ' (restriction filter applies to this page)' : ''
                }`
              : 'No customers'}
```

- [ ] **Step 13: 跑硬闸门（tsc + 全量 jest）并 commit 列表页**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web && npx tsc --noEmit -p tsconfig.app.json
```

期望：无输出，退出码 0。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest admin-web/src/utils
```

期望：`Test Suites: 3 passed, 3 total`（`depositStatusMap` / `withdrawStatusMap` / 本轮新增 `restrictionCauseMeta`）。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add admin-web/src/pages/CustomerManagement.tsx && git commit -m "feat(admin): 客户列表 Onboarding/Admin/Compliance 三列换 Lifecycle + Restrictions 两列，加限制筛选"
```

- [ ] **Step 14: 起栈渲染截图验收（curl 200 不算数）**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && bash scripts/stack.sh up && bash scripts/stack.sh status
```

从 `status` 输出读本 worktree 分到的 base 端口，admin 台 = base+1。种子管理员 `admin@fiatx.com` / `123456` 登 `/auth/login`，token 注入预览页 localStorage 的 `admin_token`。

演示数据前置（前序 seed 任务已铺）：Carol 为 `lifecycle=ACTIVE` + 一条 `SANCTION` 便签；另找/贴一条 `MATERIAL_EXPIRED` 便签制造多因并存。

逐张截图存到 scratchpad 并肉眼比对，缺一不可：

1. 客户详情 Restrictions 节：SANCTION 行带 🔇 红 chip、MATERIAL_EXPIRED 行为 amber chip，第二行显示 reason · caseRef，每行右侧 `Release →`
2. 同一节的「Released (N) ▸」折叠展开态（6 列含 Approval / Mode）
3. 侧栏：Actions 只有 `Add Restriction`（红框）+ 灰 `Offboard`（hover 出 "Not implemented"）；Status 只剩 Lifecycle 徽章 + `2 OPEN` 红字两行
4. Add Restriction 弹窗，cause=`SANCTION`：三行回显 `ALL` / `SILENT — nothing shown to the customer` / `MLRO_APPROVAL`
5. Add Restriction 弹窗，cause=`PENDING_DOCUMENT`：Blocks 行变三个可勾复选框，默认勾中 WITHDRAW+SWAP
6. Release 弹窗（对 SANCTION 便签）：Release Order Ref 标为必填 + amber 提示语，按钮文案 `Submit for approval`，未填时置灰
7. 客户列表：Lifecycle + Restrictions 两列，Carol 行是红 `1 OPEN`，筛选切到 `Sanction only` 后只剩制裁客户、footer 出现 "(restriction filter applies to this page)"

对照检查：整屏不得出现 `bg-white` / `text-gray-*` / `brand-primary` 的白底弹窗观感（旧 `CaseBoundCustomerControlModal` 已删，若还看到即说明有残留引用）。

- [ ] **Step 15: BACKLOG 登记「筛选仅当页」这笔账并 commit**

编辑 `/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/doc-final/BACKLOG.md`，在「## 死码清理（Phase C 统一清扫）」小节（L25）之前插入新小节：

```markdown
## 技术债 — 客户限制账（2026-08-15 lifecycle + restrictions）

- [ ] **客户列表 Restrictions 列靠逐行拉、筛选只作用于当前页**：`GET /customers` 列表体没有限制聚合字段，`CustomerManagement.tsx` 改成对当页 20 行各发一次 `GET /admin/customers/:customerNo/restrictions` 求 open 数与是否含 SANCTION；因此「Restricted / Unrestricted / Sanction only」三个筛选是客户端过滤，只对已加载的当页生效，翻页语义不连续（footer 已标注）。彻底修＝列表 `include: { restrictionRows: { where: { status: 'OPEN' } } }` 出 `openRestrictionCount` + `hasSanction` 两个字段并支持服务端 where ｜来源: 2026-08-15 客户生命周期+限制账 Task 12
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add doc-final/BACKLOG.md && git commit -m "docs(backlog): 登记客户列表 Restrictions 列逐行拉取、筛选仅当页生效"
```

---

### Task 13: 客户端前端 —— AuthGuard 去 FROZEN 分支 + 限制提示条 + Profile 区块

把 client-web 从「`onboardingStatus` + `adminStatus` + `complianceStatus` + `restrictions` 四字段」切到「`lifecycle` + `disclosedBlocked` + `disclosed` 三字段」。核心不变量：**前端永远拿不到 `blocked`**，所以 SILENT 限制（`SANCTION` / `KYT_REJECTED_HARD`）在客户端天然不可见，被制裁客户的 Swap/Withdraw 按钮**照常可点、不置灰**，拦截由后端 L1 能力门做——这是设计而非遗漏。

> 本 Task 一并改 `customerOnboarding.ts` 与它的三个消费者（AuthGuard / CustomerProfile / Verification）：`tsconfig.app.json` 开了 `noUnusedLocals`，且这四个文件共用同一套状态谓词，拆开提交任何一个都过不了 `tsc -b`，它们是一个原子单元。

**Files:**

- Create: `Exchange_js/client-web/src/components/RestrictionBanner.tsx`
- Modify:
  - `Exchange_js/client-web/src/utils/restrictedCapabilities.ts`（1-25，整体重写）
  - `Exchange_js/client-web/src/utils/customerOnboarding.ts`（1-78，整体重写）
  - `Exchange_js/client-web/src/hooks/useCustomerProfile.ts`（8-43 接口、63-84 映射）
  - `Exchange_js/client-web/src/components/AuthGuard.tsx`（5-13 imports、92-146 判据、167 分支）
  - `Exchange_js/client-web/src/components/CustomerDashboardLayout.tsx`（82-90 StatusBadge、135-144 displayStatus）
  - `Exchange_js/client-web/src/pages/CustomerProfile.tsx`（6-12 imports、23-42 状态推导、149 起局部变量、296-369 区块、396-400 冗余行）
  - `Exchange_js/client-web/src/pages/DashboardOverview.tsx`（16 import、189 挂载点）
  - `Exchange_js/client-web/src/pages/Swap.tsx`（27-28 imports、143-146 注释与判据、576-582 旧提示条）
  - `Exchange_js/client-web/src/pages/Withdraw.tsx`（3-5 imports、120-122 注释与判据、442-448 旧提示条）
  - `Exchange_js/client-web/src/pages/Verification.tsx`（16-18 import、51-70 OnboardingSnapshot、211-222 参数与变量、237/250-251/265/278/297 字面量、1227-1233 路由判据）
- Test: `Exchange_js/client-web/src/utils/restrictedCapabilities.spec.ts`（1-27，整体重写）

**Interfaces:**

Consumes:
- `GET /onboarding/me` → `{ lifecycle: string; disclosedBlocked: Capability[]; disclosed: DisclosedRestrictionView[]; ... }`（Task 段外已改；响应体**不含** `blocked` / `openCount` / `onboardingStatus` / `adminStatus` / `complianceStatus` / `restrictions`）
- `GET /client/me/restrictions` → `DisclosedRestrictionView[]`
- `DisclosedRestrictionView = { restrictionNo: string; cause: RestrictionCause; scopes: RestrictionScope[]; label: string; reason: string; openedAt: string }`

Produces:
- `restrictedCapabilities(user: unknown): Set<string>`
- `isCapabilityRestricted(user: unknown, capability: string): boolean`（签名不变，含 `'ALL'` 通配）
- `normalizeLifecycle(value?: string | null): CustomerLifecycle | null`
- `isCustomerApprovedForAccess / isCustomerRejected / isCustomerWithdrawn / isCustomerFinalApprovalPending / isCustomerInProgress (source: CustomerLifecycleSnapshot): boolean`（名字不变，判据改 `lifecycle`）
- `export function RestrictionBanner(): JSX.Element | null`
- `export interface DisclosedRestrictionView`（`useCustomerProfile.ts` 导出，供 RestrictionBanner 复用）

---

- [ ] **Step 1: 补装 client-web 依赖（vitest 当前不在 node_modules）**

`npx vitest` 现在直接报 `Cannot find package 'vitest'`——`package-lock.json` 里有 `node_modules/vitest`，工作树的 node_modules 是旧的。在 `Exchange_js/` 下跑：

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm install --prefix client-web
ls client-web/node_modules/.bin/vitest
```

期望最后一行打印出 `client-web/node_modules/.bin/vitest`。后续所有 `npm test` / `tsc -b` 都在 node 20 下跑。

- [ ] **Step 2: 先写失败的测试 —— 重写 `restrictedCapabilities.spec.ts`**

整体覆盖 `Exchange_js/client-web/src/utils/restrictedCapabilities.spec.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { restrictedCapabilities, isCapabilityRestricted } from './restrictedCapabilities';

describe('restrictedCapabilities', () => {
  it('disclosedBlocked 数组 → 原样成集（后端已算好，前端不再归一化）', () => {
    expect(restrictedCapabilities({ disclosedBlocked: ['SWAP', 'WITHDRAW'] })).toEqual(
      new Set(['SWAP', 'WITHDRAW']),
    );
  });

  it('空数组 → 恒 false：制裁客户按钮照常可点，这是设计不是遗漏', () => {
    // SANCTION / KYT_REJECTED_HARD 是 SILENT，不进 disclosedBlocked。
    // 置灰本身即"你被查了"的信号（tipping-off），必须与正常客户逐字相同。
    const sanctioned = { lifecycle: 'ACTIVE', disclosedBlocked: [] };
    expect(restrictedCapabilities(sanctioned).size).toBe(0);
    expect(isCapabilityRestricted(sanctioned, 'SWAP')).toBe(false);
    expect(isCapabilityRestricted(sanctioned, 'WITHDRAW')).toBe(false);
    expect(isCapabilityRestricted(sanctioned, 'DEPOSIT')).toBe(false);
  });

  it("含 'ALL' → 任意能力都被拦", () => {
    const user = { disclosedBlocked: ['ALL'] };
    expect(isCapabilityRestricted(user, 'SWAP')).toBe(true);
    expect(isCapabilityRestricted(user, 'WITHDRAW')).toBe(true);
    expect(isCapabilityRestricted(user, 'DEPOSIT')).toBe(true);
  });

  it('未命中能力不拦', () => {
    expect(isCapabilityRestricted({ disclosedBlocked: ['SWAP'] }, 'WITHDRAW')).toBe(false);
  });

  it('缺失 / 非数组 / null → 空集', () => {
    expect(restrictedCapabilities({}).size).toBe(0);
    expect(restrictedCapabilities(null).size).toBe(0);
    expect(restrictedCapabilities({ disclosedBlocked: 'SWAP' }).size).toBe(0);
  });

  it('旧 restrictions 字段已退役 —— 就算响应里有残留也不许生效', () => {
    expect(restrictedCapabilities({ restrictions: [{ capability: 'SWAP' }] }).size).toBe(0);
  });
});
```

- [ ] **Step 3: 跑它，确认红**

```bash
cd Exchange_js && npx vitest run --root client-web src/utils/restrictedCapabilities.spec.ts
```

期望：`Tests  3 failed | 3 passed (6)`。三条失败分别是
`AssertionError: expected Set{} to deeply equal Set{ 'SWAP', 'WITHDRAW' }`（第 1 条）、
`expected false to be true`（`'ALL'` 那条）、
`expected 1 to be +0`（旧 `restrictions` 残留那条）。

- [ ] **Step 4: 最小实现 —— 重写 `restrictedCapabilities.ts`**

整体覆盖 `Exchange_js/client-web/src/utils/restrictedCapabilities.ts`：

```ts
/**
 * 客户端能力限制读取器 —— 唯一数据源是后端算好的 user.disclosedBlocked。
 *
 * 前端【永远拿不到】blocked：CustomerAccess 有 blocked（服务端执法用，含 SILENT）
 * 和 disclosedBlocked（客户面用，仅 DISCLOSED）两个字段，客户面 DTO 只允许序列化
 * 后者。因此 SILENT 限制（SANCTION / KYT_REJECTED_HARD）在这里天然不可见，被制裁
 * 客户的 disclosedBlocked 是空数组，Swap/Withdraw 按钮照常可点、不置灰 ——
 * 这是设计而非遗漏：置灰本身就是"你被查了"的信号，属 tipping off，在多数反洗钱
 * 法域是刑事犯罪。真正的拦截由后端 L1 能力门（CAPABILITY_RESTRICTED）执行，客户
 * 看到的是与网络失败逐字相同的中性文案。
 *
 * 不要在本文件里补任何"更全"的数据源，也不要按 lifecycle / 交易状态兜底推导。
 */
export function restrictedCapabilities(user: unknown): Set<string> {
  const disclosedBlocked = (user as { disclosedBlocked?: unknown } | null | undefined)
    ?.disclosedBlocked;
  if (!Array.isArray(disclosedBlocked)) return new Set();
  return new Set(
    disclosedBlocked.filter((c): c is string => typeof c === 'string' && c.length > 0),
  );
}

/** 某能力是否被限制（含 ALL 通配）。 */
export function isCapabilityRestricted(user: unknown, capability: string): boolean {
  const caps = restrictedCapabilities(user);
  return caps.has(capability) || caps.has('ALL');
}
```

- [ ] **Step 5: 跑测试，确认绿**

```bash
cd Exchange_js && npx vitest run --root client-web src/utils/restrictedCapabilities.spec.ts
```

期望：`Tests  6 passed (6)`。

- [ ] **Step 6: commit 这一对**

本文件入参是 `unknown`，单独改不影响 `tsc -b`，可独立提交。

```bash
cd Exchange_js
git add client-web/src/utils/restrictedCapabilities.ts client-web/src/utils/restrictedCapabilities.spec.ts
git commit -m "feat(client): 能力限制改读 disclosedBlocked，SILENT 便签在前端天然不可见"
```

- [ ] **Step 7: `useCustomerProfile.ts` —— 换字段、删 JSON.parse 兜底**

把 `Exchange_js/client-web/src/hooks/useCustomerProfile.ts` 第 8-19 行（接口开头到 `restrictions?: string[];`）替换为：

```ts
/** /onboarding/me 下发的「可以告知客户」的限制行；SILENT 便签不在其中。 */
export interface DisclosedRestrictionView {
  restrictionNo: string;
  cause: string;
  scopes: string[];
  label: string;
  reason: string;
  openedAt: string;
}

export interface CustomerProfileData {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName?: string | null;
  customerType: string;
  /** 唯一状态轴。PROSPECT / IN_VERIFICATION / PENDING_APPROVAL / ACTIVE / REJECTED / WITHDRAWN / OFFBOARDED */
  lifecycle: string;
  /** 仅 DISCLOSED 限制贡献的能力集。响应体里【没有】blocked —— 见 restrictedCapabilities.ts。 */
  disclosedBlocked: string[];
  disclosed: DisclosedRestrictionView[];
```

再把第 63-75 行（`setProfile({` 到 `})(),` 那段 restrictions 兜底）替换为：

```ts
        setProfile({
          ...data,
          customerType: data.customerType || 'UNKNOWN',
          lifecycle: String(data.lifecycle || 'PROSPECT').toUpperCase(),
          // 后端已把 SILENT 过滤干净并展开好 scope，前端零加工——
          // 任何"更聪明"的归一化都可能把 SILENT 泄回客户面。
          disclosedBlocked: Array.isArray(data.disclosedBlocked) ? data.disclosedBlocked : [],
          disclosed: Array.isArray(data.disclosed) ? data.disclosed : [],
```

（`actions:` 及其后各行原样保留。）

- [ ] **Step 8: `customerOnboarding.ts` —— 双轴谓词整体改 lifecycle**

整体覆盖 `Exchange_js/client-web/src/utils/customerOnboarding.ts`：

```ts
/**
 * 客户生命周期读取器 —— 唯一状态轴是 lifecycle
 * （后端 src/modules/identity/constants/customer-lifecycle.constant.ts）。
 * 旧的 onboardingStatus + adminStatus 双轴已删；"被合规摁住"不在这根轴上，
 * 走限制便签（见 restrictedCapabilities.ts）。
 */
export type CustomerLifecycle =
  | 'PROSPECT'
  | 'IN_VERIFICATION'
  | 'PENDING_APPROVAL'
  | 'ACTIVE'
  | 'REJECTED'
  | 'WITHDRAWN'
  | 'OFFBOARDED';

export interface CustomerLifecycleSnapshot {
  lifecycle?: string | null;
}

const CUSTOMER_LIFECYCLES: CustomerLifecycle[] = [
  'PROSPECT',
  'IN_VERIFICATION',
  'PENDING_APPROVAL',
  'ACTIVE',
  'REJECTED',
  'WITHDRAWN',
  'OFFBOARDED',
];

export const normalizeLifecycle = (value?: string | null): CustomerLifecycle | null => {
  const current = String(value || '').trim().toUpperCase();
  if (CUSTOMER_LIFECYCLES.includes(current as CustomerLifecycle)) {
    return current as CustomerLifecycle;
  }
  return null;
};

export const isCustomerApprovedForAccess = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'ACTIVE';

export const isCustomerRejected = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'REJECTED';

export const isCustomerWithdrawn = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'WITHDRAWN';

export const isCustomerFinalApprovalPending = (source: CustomerLifecycleSnapshot): boolean =>
  normalizeLifecycle(source.lifecycle) === 'PENDING_APPROVAL';

export const isCustomerInProgress = (source: CustomerLifecycleSnapshot): boolean => {
  const lifecycle = normalizeLifecycle(source.lifecycle);
  if (!lifecycle) return false;
  return ['PROSPECT', 'IN_VERIFICATION', 'PENDING_APPROVAL'].includes(lifecycle);
};
```

- [ ] **Step 9: `AuthGuard.tsx` —— 删 FROZEN 整段 + 四步判据换 lifecycle**

先把第 5-10 行的 import 块替换为（加 `normalizeLifecycle`）：

```tsx
import {
  isCustomerApprovedForAccess,
  isCustomerFinalApprovalPending,
  isCustomerRejected,
  isCustomerWithdrawn,
  normalizeLifecycle,
} from '../utils/customerOnboarding';
```

再把第 92-146 行（`const isApproved = ...` 到 `: 2;`）整体替换为：

```tsx
  const isApproved = user ? isCustomerApprovedForAccess(user) : false;
  if (isApproved) {
    // RESTRICTED（parity 2026-08-14 定稿，本轮沿用）：受限能力的页面【不再重定向】——
    // Swap/Withdraw 页自禁按钮 + RestrictionBanner 逐条提示（业主拍板：页面基本不动）。
    // 唯一保留的重定向是 /wallet/send（该页没有禁用 UI，放进去会裸奔）。
    // 后端 L1 门（CAPABILITY_RESTRICTED）原样在——这里只是体验层。
    // 判据来自 disclosedBlocked：SILENT 便签前端拿不到，被制裁客户在这里与正常
    // 客户完全同路，不会因为多一次跳转而暴露调查（tipping-off）。
    if (isCapabilityRestricted(user, 'WITHDRAW')) {
      const p = '/wallet/send';
      if (location.pathname === p || location.pathname.startsWith(`${p}/`)) {
        return <Navigate to="/profile" replace />;
      }
    }

    // Trading-readiness gate: approved but no active fiat withdrawal address → show the
    // standalone guide page (its CTA routes to /withdrawal-addresses to add one).
    // Business paths blocked; /withdrawal-addresses (the setup page) intentionally NOT blocked.
    // Segment-boundary match: '/withdraw' must NOT catch '/withdrawal-addresses' (its own destination).
    const readinessBlockedPaths = ['/deposit', '/withdraw', '/swap', '/wallet'];
    if (
      !tradingReadinessLoading &&
      !tradingReady &&
      readinessBlockedPaths.some(
        (p) => location.pathname === p || location.pathname.startsWith(`${p}/`),
      )
    ) {
      return <TradingStartGuide />;
    }

    return <>{children}</>;
  }

  // lifecycle 未过的四步拦截页。OFFBOARDED 到不了这里——终态客户的会话在
  // jwt.strategy 就被拒，根本进不到路由。
  const lifecycle = normalizeLifecycle(user?.lifecycle) ?? 'PROSPECT';
  const isRejected = user ? isCustomerRejected(user) : false;
  const isWithdrawn = user ? isCustomerWithdrawn(user) : false;
  const isBlocked = isRejected || isWithdrawn;
  const isFinalPending = user ? isCustomerFinalApprovalPending(user) : false;

  /* Current step index into STEPS (0..3) */
  const stepIndex = isBlocked
    ? 1
    : isFinalPending
      ? 2
      : lifecycle === 'IN_VERIFICATION'
        ? 1
        : lifecycle === 'PROSPECT'
          ? 1
          : 2;
```

最后把原第 167 行 `} else if (onboardingStatus === 'PENDING_VERIFICATION') {` 改为：

```tsx
  } else if (lifecycle === 'IN_VERIFICATION') {
```

- [ ] **Step 10: 新建 `RestrictionBanner.tsx`**

新建 `Exchange_js/client-web/src/components/RestrictionBanner.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
import { CustomerSessionError, customerFetch } from '../utils/customerFetch';
import type { DisclosedRestrictionView } from '../hooks/useCustomerProfile';

/* ────────────────────────────────────────────────────────────────
 *  RestrictionBanner — 客户账户上「可以告知」的限制便签，一条一个条。
 *
 *  显不显示、显示哪几条、标题写什么，全部在后端一次决定：
 *  CustomerAccessService.resolve() 只把 visibility=DISCLOSED 的 OPEN 便签放进
 *  disclosed（标题取 RESTRICTION_CAUSE_POLICY[cause].customerLabel），
 *  GET /client/me/restrictions 原样返回这个数组。SILENT 便签（SANCTION /
 *  KYT_REJECTED_HARD）根本不在响应里 —— 告诉被制裁的客户他被查了，是
 *  "tipping off"，在多数反洗钱法域是刑事犯罪。
 *
 *  因此本组件【只做一件事】：把后端已经给的行换成文案。禁止在这里补任何由
 *  lifecycle / 交易状态 / 余额 / 拒绝原因 / disclosedBlocked 推导出的条件逻辑
 *  —— 那等于把 tipping-off 判定放到两个地方，失败模式是客户被告知一场制裁
 *  调查。与 PendingActionBanner.tsx 同款约束、同款 fetch-on-mount +
 *  refetch-on-visibilitychange。
 * ──────────────────────────────────────────────────────────────── */

// 材料类限制客户自己能解 → CTA 跳认证流程。其余（管理员停用、升级审批中等）
// 客户没有自助动作，不给 CTA —— 给一个点了没用的按钮比不给更糟。
const SELF_SERVE_CAUSES = new Set(['MATERIAL_EXPIRED', 'PENDING_DOCUMENT']);

export function RestrictionBanner() {
  const [rows, setRows] = useState<DisclosedRestrictionView[]>([]);
  const navigate = useNavigate();

  const load = async () => {
    try {
      const res = await customerFetch(
        `${import.meta.env.VITE_API_URL}/client/me/restrictions`,
      );
      if (!res.ok) {
        setRows([]);
        return;
      }
      const data = await res.json();
      setRows(Array.isArray(data) ? (data as DisclosedRestrictionView[]) : []);
    } catch (error) {
      if (error instanceof CustomerSessionError) return;
      // 任何失败路径都清空：便签解除后的一次拉取失败若留着旧条，客户会看到一条
      // 后端已经撕掉的限制。宁可少显示，不可多显示（与 PendingActionBanner 同规）。
      setRows([]);
    }
  };

  useEffect(() => {
    void load();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!rows.length) return null;

  return (
    <div className="space-y-2 mb-4">
      {rows.map((row) => (
        <div
          key={row.restrictionNo}
          className="border-l-4 border-l-fx-rust bg-fx-rust/[0.04] px-4 py-3 flex items-start justify-between gap-4"
        >
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <AlertCircle size={14} className="shrink-0 mt-[1px] text-fx-rust" />
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-rust mb-1">
                {row.label}
              </div>
              <p className="font-sans text-[12px] text-fx-dune leading-snug break-words">
                {row.reason}
              </p>
              <div className="mt-1 font-mono text-[10px] text-fx-dust tabular-nums">
                {row.scopes.join(' · ')}
              </div>
            </div>
          </div>
          {SELF_SERVE_CAUSES.has(row.cause) && (
            <button
              onClick={() => navigate('/verification')}
              className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-fx-brass hover:text-fx-ember transition-colors"
            >
              Resolve
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 11: 挂到 Overview 顶部**

`Exchange_js/client-web/src/pages/DashboardOverview.tsx` 第 16 行 `} from '../utils/customerFetch';` 之后插入：

```tsx
import { RestrictionBanner } from '../components/RestrictionBanner';
```

第 189 行 `<div className="space-y-10">` 之后插入一行：

```tsx
      <RestrictionBanner />
```

- [ ] **Step 12: Swap 页 —— 换掉笼统提示条、注释对齐新判据**

`Exchange_js/client-web/src/pages/Swap.tsx` 第 27-28 行改为：

```tsx
import { PendingActionBanner } from '../components/PendingActionBanner';
import { RestrictionBanner } from '../components/RestrictionBanner';
import { isCapabilityRestricted } from '../utils/restrictedCapabilities';
```

第 143-146 行（`// parity 2026-08-14：...` 三行注释 + `const swapRestricted`）替换为：

```tsx
  // parity 2026-08-14：受限客户页面不封、只禁按钮（业主拍板）。判据是
  // disclosedBlocked —— SILENT 便签前端拿不到，被制裁客户按钮照常可点，
  // 点了由后端 L1 门以中性文案拒绝。具体原因由 RestrictionBanner 按后端
  // 下发的 disclosed 逐条渲染，本页不推导任何文案。
  const swapRestricted = isCapabilityRestricted(user, 'SWAP');
```

第 576-582 行（`{swapRestricted && (` 到对应 `)}`）整段替换为：

```tsx
      <RestrictionBanner />
```

（`swapRestricted` 仍被 801 行 `handlePreview` 与 1067 行确认按钮的 `disabled` 使用，不会变成未用变量。）

- [ ] **Step 13: Withdraw 页 —— 同构改造**

`Exchange_js/client-web/src/pages/Withdraw.tsx` 第 4-5 行改为：

```tsx
import { PendingActionBanner } from '../components/PendingActionBanner';
import { RestrictionBanner } from '../components/RestrictionBanner';
import { isCapabilityRestricted } from '../utils/restrictedCapabilities';
```

第 121-122 行替换为：

```tsx
  // parity 2026-08-14：受限客户页面不封、只禁按钮（业主拍板，与 Swap 页同构）。
  // 判据是 disclosedBlocked，制裁客户按钮不置灰；原因文案走 RestrictionBanner。
  const withdrawRestricted = isCapabilityRestricted(user, 'WITHDRAW');
```

第 442-448 行（`{withdrawRestricted && (` 到对应 `)}`）整段替换为：

```tsx
      <RestrictionBanner />
```

（`withdrawRestricted` 仍被 844 行与 1061 行的 `disabled` 使用。）

- [ ] **Step 14: 侧栏/顶栏徽章改 lifecycle**

`Exchange_js/client-web/src/components/CustomerDashboardLayout.tsx` 第 83-90 行（`const tone =` 到 `: 'text-fx-dune border-fx-rule bg-transparent';`）替换为：

```tsx
  const tone =
    status === 'ACTIVE'
      ? 'text-fx-sage border-fx-sage/30 bg-fx-sage/5'
      : status === 'REJECTED' || status === 'WITHDRAWN' || status === 'OFFBOARDED'
        ? 'text-fx-rust border-fx-rust/30 bg-fx-rust/5'
        : status === 'PENDING_APPROVAL' || status === 'RESTRICTED'
          ? 'text-fx-brass border-fx-brass/30 bg-fx-brass/5'
          : 'text-fx-dune border-fx-rule bg-transparent';
```

第 135-144 行（`const hasRestrictions = ...` 到 `: String(user?.onboardingStatus || 'NONE').toUpperCase();`）替换为：

```tsx
  // 徽章 = lifecycle，唯一例外是有「可告知」限制时压成 RESTRICTED。
  // SILENT 便签不进 disclosedBlocked，被制裁客户的徽章因此与正常客户逐字相同
  // ——徽章变字本身就是信号（tipping-off）。这不是特判，是拿不到数据的自然结果。
  const lifecycle = String(user?.lifecycle || 'PROSPECT').toUpperCase();
  const displayStatus =
    lifecycle === 'ACTIVE' && (user?.disclosedBlocked?.length ?? 0) > 0
      ? 'RESTRICTED'
      : lifecycle;
```

- [ ] **Step 15: Profile 页 —— 状态推导改 lifecycle + 新增「Current restrictions」区块**

`Exchange_js/client-web/src/pages/CustomerProfile.tsx` 第 6-12 行的 import 块加一项：

```tsx
import {
  isCustomerApprovedForAccess,
  isCustomerFinalApprovalPending,
  isCustomerInProgress,
  isCustomerRejected,
  isCustomerWithdrawn,
  normalizeLifecycle,
} from '../utils/customerOnboarding';
```

第 23-42 行（`getPrimaryStatus` + `statusTone` 两个函数）替换为：

```tsx
function getPrimaryStatus(profile: NonNullable<ProfileLike>) {
  // 徽章 = lifecycle，唯一例外是有「可告知」限制时压成 RESTRICTED。
  // SILENT 便签不在 disclosed 里，被制裁客户这里恒等于 ACTIVE（tipping-off）。
  const lifecycle = normalizeLifecycle(profile.lifecycle) ?? 'PROSPECT';
  if (lifecycle === 'ACTIVE' && profile.disclosed.length > 0) return 'RESTRICTED';
  return lifecycle;
}

function statusTone(status: string) {
  if (status === 'ACTIVE') return 'text-fx-sage border-fx-sage/30 bg-fx-sage/5';
  if (status === 'REJECTED' || status === 'WITHDRAWN' || status === 'OFFBOARDED')
    return 'text-fx-rust border-fx-rust/30 bg-fx-rust/5';
  if (status === 'PENDING_APPROVAL' || status === 'RESTRICTED')
    return 'text-fx-brass border-fx-brass/30 bg-fx-brass/5';
  return 'text-fx-dune border-fx-rule bg-transparent';
}
```

第 149 行 `const primaryStatus = getPrimaryStatus(profile);` 之后插入：

```tsx
  const lifecycle = normalizeLifecycle(profile.lifecycle) ?? 'PROSPECT';
```

第 296-369 行（整个 `{/* ── Compliance lifecycle ── */}` section）替换为：

```tsx
      {/* ── Compliance lifecycle ───────────────────────────────── */}
      <section>
        <SectionTitle>Compliance lifecycle</SectionTitle>
        <div className="grid grid-cols-12 gap-x-6 gap-y-5 pt-5">
          <Row
            label="Lifecycle"
            value={
              <span
                className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-mono text-[10px] uppercase tracking-[0.14em] ${statusTone(
                  lifecycle,
                )}`}
              >
                <span className="w-[3px] h-[3px] rounded-full bg-current" />
                {lifecycle.replace(/_/g, ' ')}
              </span>
            }
          />
          <Row label="Risk rating" value={profile.riskRating} mono />
          <Row label="EDD required" value={profile.eddRequired ? 'YES' : 'NO'} mono />
          <Row label="Investor tier" value={profile.investorTier || 'STANDARD'} />
          <Row
            label="CDD document expires"
            value={fmt(profile.cddDocumentExpiresAt)}
            mono
          />
        </div>
      </section>

      {/* ── Current restrictions ───────────────────────────────── */}
      {/* 只列 disclosed —— SILENT 便签后端根本不下发。空则整节隐藏：一行
          "Restrictions  NONE" 对被制裁客户就是一个可对比的信号面，不留。 */}
      {profile.disclosed.length > 0 && (
        <section>
          <SectionTitle>
            Current restrictions
            <span className="ml-2 text-fx-dust/60 normal-case tracking-normal font-sans text-[11px]">
              ({profile.disclosed.length})
            </span>
          </SectionTitle>
          <div className="pt-5 space-y-3">
            {profile.disclosed.map((row) => (
              <div
                key={row.restrictionNo}
                className="border-l-2 border-fx-rust/60 bg-fx-rust/[0.03] px-4 py-3"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-fx-rust">
                    {row.label}
                  </span>
                  <span className="font-mono text-[10px] text-fx-dust tabular-nums">
                    {row.scopes.join(' · ')}
                  </span>
                  <span className="font-mono text-[10px] text-fx-dust tabular-nums">
                    Since {fmtDate(row.openedAt)}
                  </span>
                </div>
                <p className="mt-1.5 font-sans text-[12px] text-fx-dune leading-snug break-words">
                  {row.reason}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
```

最后删掉 Verification snapshot 里现第 396-400 行那个 `<Row label="Onboarding status" ... />`（`Lifecycle` 已在上面的区块里给过，这里是重复）。

- [ ] **Step 16: `Verification.tsx` —— 跟着换轴**

第 16-18 行 import 块改为：

```tsx
import {
  normalizeLifecycle,
} from '../utils/customerOnboarding';
```

`OnboardingSnapshot`（第 51-70 行）里把 `onboardingStatus?: string;` 改为 `lifecycle?: string;`，并删掉 `adminStatus?: string;` 与 `restrictions?: string[];` 两行——`/onboarding/me` 已不返回它们，全文件也无读点。

`mapOnboardingToStep`（第 211-222 行）的第三参数与首行变量改为：

```tsx
  profile: {
    lifecycle?: string;
    actions?: OnboardingAction[];
    eddRequired?: boolean;
  } | null,
): VerificationStepState => {
  const lifecycle = normalizeLifecycle(onboarding?.lifecycle ?? profile?.lifecycle);
```

函数体内五处字面量逐条替换（旧 → 新）：

```
237   if (onboardingStatus === 'APPROVED') {                → if (lifecycle === 'ACTIVE') {
250     onboardingStatus === 'REJECTED' ||                  →   lifecycle === 'REJECTED' ||
251     onboardingStatus === 'WITHDRAWN' ||                 →   lifecycle === 'WITHDRAWN' ||
265   if (onboardingStatus === 'FINAL_APPROVAL' || ...      → if (lifecycle === 'PENDING_APPROVAL' || ...
278     onboardingStatus === 'PENDING_VERIFICATION' ||      →   lifecycle === 'IN_VERIFICATION' ||
297   if (onboardingStatus === 'NONE' || ...                → if (lifecycle === 'PROSPECT' || ...
```

组件体里第 1227-1233 行的路由判据替换为：

```tsx
  // Route: ACTIVE customer with cycleId → material refresh mode
  const lifecycle = String(profile.lifecycle || 'PROSPECT').toUpperCase();
  if (lifecycle === 'ACTIVE' && cycleId) {
    return <MaterialRefreshVerificationMode cycleId={cycleId} />;
  }

  // Route: ACTIVE customer with no cycleId → nothing to do here
  if (lifecycle === 'ACTIVE' && !cycleId) {
```

- [ ] **Step 17: 跑两道硬闸门**

```bash
cd Exchange_js
npx tsc -b --force client-web
npm test --prefix client-web
```

期望：`tsc -b` 零输出退出码 0（`noUnusedLocals` 会逮出任何遗漏的旧 import）；vitest 打印所有 spec 全绿，`restrictedCapabilities.spec.ts` 6 passed。若 `tsc` 报 `Property 'onboardingStatus' does not exist on type 'CustomerProfileData'`，说明 Step 15/16 有漏改点，按报错行号补。

- [ ] **Step 18: 起 main 栈渲染验证（截图，不接受"tsc 过了就算完"）**

```bash
cd Exchange_js
bash scripts/stack.sh up main
```

用种子账号登 `http://localhost:3002/login`，逐项对屏确认：

1. **正常 ACTIVE 客户**：Overview / Swap / Withdraw 顶部无任何红条；顶栏徽章 `ACTIVE`；Swap、Withdraw 提交按钮可点。
2. **有 DISCLOSED 便签的客户**（admin 台给他贴一条 `MATERIAL_EXPIRED`）：三页顶部各出现一条红条，标题 `Document expired`、正文是 admin 填的 reason、右侧 `Resolve` 跳 `/verification`；Swap/Withdraw 提交按钮置灰；顶栏徽章 `RESTRICTED`；Profile 页出现「Current restrictions (1)」区块。
3. **SANCTION 客户**（Carol，seed 已铺 `lifecycle=ACTIVE` + 一条 SILENT 便签）：**与第 1 项截图逐像素一致**——无红条、徽章 `ACTIVE`、按钮**可点**；点提交后弹出的错误文案与断网时的文案逐字相同。这一条是本 Task 的验收命门，必须单独截图存证。
4. `/wallet/send` 在 WITHDRAW 受限时仍跳 `/profile`；`/withdrawal-addresses` 不被 trading-readiness 引导页误伤。

- [ ] **Step 19: commit 剩余改动**

```bash
cd Exchange_js
git add client-web/src/utils/customerOnboarding.ts \
        client-web/src/hooks/useCustomerProfile.ts \
        client-web/src/components/AuthGuard.tsx \
        client-web/src/components/RestrictionBanner.tsx \
        client-web/src/components/CustomerDashboardLayout.tsx \
        client-web/src/pages/CustomerProfile.tsx \
        client-web/src/pages/DashboardOverview.tsx \
        client-web/src/pages/Swap.tsx \
        client-web/src/pages/Withdraw.tsx \
        client-web/src/pages/Verification.tsx
git commit -m "feat(client): 客户端切 lifecycle 单轴 —— AuthGuard 删 FROZEN 分支 + 限制提示条按 disclosed 逐条渲染 + Profile 限制区块"
```

---

### Task 14: seed 重铺 + e2e 全套 + 硬闸门 + 文档同步

**目标**：把前 12 个 task 的模型改动落到可重复演示的数据面（seed / reset / demo 脚本），用一支专用库上的 e2e 把设计稿 §7.2 六条行为逐条钉死，跑完五条硬闸门，最后把 truth / BACKLOG / glossary / rules 四处文档同步到新模型。

> **前置依赖**：Task 1-13 已合入当前分支（`lifecycle` 列、`customer_restrictions` 表与迁移、`CustomerRestrictionsService` / `CustomerAccessService` / `CustomerRestrictionWorkflowService`、两个审批 handler、三个 admin 端点 + `/client/me/restrictions`、§3.5 三域在途单冻结扫描均已就位）。
> **demo 数据约定**：不考虑存量数据——本 task 的"重铺"就是 reset + seed，禁止任何 backfill / 兼容层。

**Files:**

- **Modify** `prisma/seed.business.ts`
  - L1-18（imports）：新增 3 个常量/类型 import
  - L500-582（`③ Customers layer` 注释 + `type DemoCustomer` + `DEMO_CUSTOMERS`）：整段替换
  - L584-640（`seedCustomers()`）：整函数替换
- **Modify** `scripts/reset-business-data.ts` L106-113（`── Customers / assets / wallets / TB registry ──` 段）：`customerMain` 前插 `customerRestriction`
- **Modify** `scripts/demo-lib.ts` L148-160（`resolveDemoCustomers()`）：整函数替换
- **Create/Test** `test/customer-restrictions.e2e-spec.ts`（六个用例 + 双重 `e2e-` 库守卫）
- **Modify** `doc-final/reference/truth/v2-customer-compliance.md` L3、L12、L14-20、L26、L33、L35-36、L43、L56
- **Modify** `doc-final/BACKLOG.md` L9（Last Updated）、L175、L213，并在 L216 后新增一节
- **Modify** `doc-final/glossary/global-glossary.md` L292 后插 4 条词条；L305-311 编号表加 `RST` 行
- **Modify** `doc-final/rules/frontend-admin.md` L160 后加 `CustomerRestriction` 行

**Interfaces:**

*Consumes（均由 Task 1-13 产出，本 task 只调用，不改签名）：*
```ts
type CustomerLifecycle = 'PROSPECT'|'IN_VERIFICATION'|'PENDING_APPROVAL'|'ACTIVE'|'REJECTED'|'WITHDRAWN'|'OFFBOARDED';
type RestrictionCause = 'SANCTION'|'ADMIN_SUSPENSION'|'MATERIAL_EXPIRED'|'TIER_UPGRADE_PENDING'|'KYT_REJECTED_SOFT'|'KYT_REJECTED_HARD'|'PENDING_DOCUMENT';
type RestrictionScope = 'ALL'|'DEPOSIT'|'WITHDRAW'|'SWAP';
const RESTRICTION_CAUSE_POLICY: Record<RestrictionCause, RestrictionCausePolicy>;

CustomerRestrictionWorkflowService.openRestriction(input: OpenRestrictionInput, actor: ApprovalActorContext): Promise<{ restrictionNo: string; created: boolean }>
CustomerRestrictionWorkflowService.autoRelease(customerId: string, cause: RestrictionCause, caseRef: string | null, actorId: string): Promise<void>
CustomerRestrictionsService.listOpen(customerId: string): Promise<RestrictionRow[]>
CustomerRestrictionsService.listAll(customerId: string): Promise<RestrictionRow[]>
CustomerAccessService.resolve(customerId: string): Promise<CustomerAccess>
ApprovalsService.approve(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext)
ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO / .CUSTOMER_RESTRICTION_RELEASE_OPS
generateReferenceNo(prefix: string): string          // src/common/utils/no-generator.util.ts:3
buildDeterministicNo(prefix: string, ...segments: string[]): string   // 同文件:14
```
HTTP（本 task 首次以真实 HTTP 报文验证）：
```
GET  /onboarding/me                                          → { lifecycle, disclosedBlocked, disclosed, ... }
GET  /client/me/restrictions                                 → DisclosedRestrictionView[]
GET  /deposit-transactions/my                                → { total, skip, take, items }
POST /admin/customers/:customerNo/restrictions               body { cause, scopes?, reason, caseRef? }
POST /admin/customers/:customerNo/restrictions/:restrictionNo/release  body { reason, releaseOrderRef? }
```

*Produces：*
```ts
// prisma/seed.business.ts（新导出形状，供 demo/e2e 读）
type DemoRestriction = { cause: RestrictionCause; scopes?: RestrictionScope[]; reason: string; caseRef?: string };
type DemoCustomer    = { email; phone; firstName; lastName; customerType; lifecycle: CustomerLifecycle;
                         riskRating; tradingTier; eddRequired; companyName?; sumsubApplicantId?;
                         restrictions?: DemoRestriction[] };
// scripts/demo-lib.ts
resolveDemoCustomers(prisma: any): Promise<any[]>   // 判定改为 lifecycle==='ACTIVE' 且无 OPEN 便签
```

---

#### A. seed 重铺（red → green）

- [ ] **Step 1: 跑 seed 断言查询确认红**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  sqlite3 /tmp/exchange_js_main/dev.db \
    "select c.email, c.lifecycle, coalesce(r.cause,'-'), coalesce(r.scope,'-'), coalesce(r.visibility,'-')
       from customer_main c
       left join customer_restrictions r on r.customerId = c.id and r.status = 'OPEN'
      where c.email like 'demo\_%' escape '\'
      order by c.email, r.scope;"
  ```

  期望（红）：main 栈此刻还是旧库，输出为
  ```
  Error: in prepare, no such column: c.lifecycle
  ```
  （若 Task 1 的迁移已在 main 栈跑过，则改为 9 行里 Carol/Ivy 那几行第 3-5 列全是 `-`，即无便签。两种都算红，都说明 seed 尚未按新轴铺。）

- [ ] **Step 2: 改 `prisma/seed.business.ts` 的 imports**

  在 L12（`import { TB_LEDGERS } ...`）之后插入：

  ```ts
  import { CustomerLifecycle } from '../src/modules/identity/constants/customer-lifecycle.constant';
  import {
    RESTRICTION_CAUSE_POLICY,
    RestrictionCause,
    RestrictionScope,
  } from '../src/modules/identity/customers/constants/restriction-cause.constant';
  ```

- [ ] **Step 3: 替换 L500-582 的客户 fixture 段**

  把从 `// ─────────────────────────────────────────────────────────────` / `// ③ Customers layer — 8 varied demo customers + customer TB accounts` 起到 `DEMO_CUSTOMERS` 数组结束的 `];`（L582）整段换成：

  ```ts
  // ─────────────────────────────────────────────────────────────
  // ③ Customers layer — 9 varied demo customers + customer TB accounts
  //
  // 一根轴（lifecycle）+ 一张限制账（restrictions）。旧的 onboardingStatus /
  // adminStatus / complianceStatus 三轴与 complianceFreeze* 四列已随 Task 1 删除。
  // 两个演示位是有意安排的：
  //   Carol —— lifecycle=ACTIVE + SANCTION（SILENT）：演示"零痕迹"，客户面与
  //            正常客户逐字节相同，后端 blocked 全禁；
  //   Ivy   —— lifecycle=ACTIVE + MATERIAL_EXPIRED（DISCLOSED）：演示"明示受限"，
  //            客户端出提示条 + 提现/兑换按钮置灰，充值照常。
  // ─────────────────────────────────────────────────────────────

  type DemoRestriction = {
    cause: RestrictionCause;
    /** 省略即取 RESTRICTION_CAUSE_POLICY[cause].defaultScopes —— 可见性与解除权限
     *  一律由 cause 查表推出，fixture 不许自己填（与运行期同一条铁律）。 */
    scopes?: RestrictionScope[];
    reason: string;
    caseRef?: string;
  };

  type DemoCustomer = {
    email: string;
    phone: string;
    firstName: string;
    lastName: string;
    customerType: 'INDIVIDUAL' | 'CORPORATE';
    lifecycle: CustomerLifecycle;
    riskRating: string;
    tradingTier: string;
    eddRequired: boolean;
    companyName?: string;
    sumsubApplicantId?: string;
    restrictions?: DemoRestriction[];
  };

  const DEMO_CUSTOMERS: DemoCustomer[] = [
    // 2× happy (ACTIVE, 无便签)
    {
      email: 'demo_alice@example.com', phone: '+15552000001',
      firstName: 'Alice', lastName: 'Happy', customerType: 'INDIVIDUAL',
      lifecycle: 'ACTIVE',
      riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
      // Sumsub sandbox applicant (externalUserId = this customer's customerNo CU2601019430),
      // tagged shawn-test. Survives reset because customerNo is derived from the email.
      sumsubApplicantId: '6a5dd88f07d9bbd981a22fc9',
    },
    {
      email: 'demo_bob@example.com', phone: '+15552000002',
      firstName: 'Bob', lastName: 'Happy', customerType: 'INDIVIDUAL',
      lifecycle: 'ACTIVE',
      riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    },
    // 1× 制裁便签（SILENT）—— 演示零痕迹。lifecycle 仍是 ACTIVE：客户关系没变，
    // 变的是"能不能干事"，这正是本次三轴收敛的核心断言。
    {
      email: 'demo_carol@example.com', phone: '+15552000003',
      firstName: 'Carol', lastName: 'Silent', customerType: 'INDIVIDUAL',
      lifecycle: 'ACTIVE',
      riskRating: 'MEDIUM', tradingTier: 'BASIC', eddRequired: true,
      restrictions: [
        {
          cause: 'SANCTION',
          reason: 'Sanctions screening hit pending investigation',
          caseRef: 'SEED-SANCTION-CAROL',
        },
      ],
    },
    // 1× 认证中
    {
      email: 'demo_dave@example.com', phone: '+15552000004',
      firstName: 'Dave', lastName: 'Pending', customerType: 'INDIVIDUAL',
      lifecycle: 'IN_VERIFICATION',
      riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    },
    // 1× 刚注册未开认证
    {
      email: 'demo_eve@example.com', phone: '+15552000005',
      firstName: 'Eve', lastName: 'New', customerType: 'INDIVIDUAL',
      lifecycle: 'PROSPECT',
      riskRating: 'LOW', tradingTier: 'BASIC', eddRequired: false,
    },
    // 1× HIGH risk
    {
      email: 'demo_frank@example.com', phone: '+15552000006',
      firstName: 'Frank', lastName: 'HighRisk', customerType: 'INDIVIDUAL',
      lifecycle: 'ACTIVE',
      riskRating: 'HIGH', tradingTier: 'BASIC', eddRequired: true,
    },
    // 1× PREMIUM trading tier
    {
      email: 'demo_grace@example.com', phone: '+15552000007',
      firstName: 'Grace', lastName: 'Premium', customerType: 'INDIVIDUAL',
      lifecycle: 'ACTIVE',
      riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
    },
    // 1× CORPORATE
    {
      email: 'demo_acme@example.com', phone: '+15552000008',
      firstName: 'Henry', lastName: 'Acme', customerType: 'CORPORATE',
      lifecycle: 'ACTIVE',
      riskRating: 'LOW', tradingTier: 'PREMIUM', eddRequired: false,
      companyName: 'Acme Trading LLC',
    },
    // 1× 材料过期便签（DISCLOSED）—— 演示明示受限。新增客户而非改 Dave：
    // Dave 的 IN_VERIFICATION 是另一个演示位，且非 ACTIVE 客户挂交易类便签无意义。
    {
      email: 'demo_ivy@example.com', phone: '+15552000009',
      firstName: 'Ivy', lastName: 'Restricted', customerType: 'INDIVIDUAL',
      lifecycle: 'ACTIVE',
      riskRating: 'MEDIUM', tradingTier: 'BASIC', eddRequired: false,
      restrictions: [
        {
          cause: 'MATERIAL_EXPIRED',
          reason: 'Passport expired on 2026-06-30 — please upload a valid document',
          caseRef: 'SEED-MATERIAL-IVY',
        },
      ],
    },
  ];
  ```

- [ ] **Step 4: 替换 `seedCustomers()`（L584-640）整函数**

  ```ts
  async function seedCustomers(prisma: PrismaClient): Promise<void> {
    const passwordHash = await bcrypt.hash('123456', 10);
    const now = new Date();

    const assets = await prisma.asset.findMany({
      where: { status: 'ACTIVE' },
      select: { code: true, currency: true },
    });

    let restrictionRowCount = 0;

    for (const c of DEMO_CUSTOMERS) {
      const data = {
        customerNo: buildDeterministicNo('CU', c.email),
        phone: c.phone,
        firstName: c.firstName,
        lastName: c.lastName,
        passwordHash,
        passwordUpdatedAt: now,
        customerType: c.customerType,
        lifecycle: c.lifecycle,
        riskRating: c.riskRating,
        tradingTier: c.tradingTier,
        eddRequired: c.eddRequired,
        companyName: c.companyName ?? null,
        sumsubApplicantId: c.sumsubApplicantId ?? null,
      };

      const customer = await prisma.customerMain.upsert({
        where: { email: c.email },
        update: data,
        create: { email: c.email, ...data },
        select: { id: true, customerNo: true },
      });

      // 限制账 fixture。种子是"直接铺终态数据"，不走 workflow —— 没有 operator、
      // 没有审批案、不写审计，与 DEMO_CUSTOMERS 其余字段同一性质（运行期贴便签
      // 必须走 CustomerRestrictionWorkflowService，那条路不受此处影响）。
      // 重铺可重复执行：先清该客户名下全部便签行，再按 fixture 重建。
      await prisma.customerRestriction.deleteMany({ where: { customerId: customer.id } });
      for (const r of c.restrictions ?? []) {
        const policy = RESTRICTION_CAUSE_POLICY[r.cause];
        const restrictionNo = generateReferenceNo('RST');
        const scopes = r.scopes ?? policy.defaultScopes;
        for (const scope of scopes) {
          await prisma.customerRestriction.create({
            data: {
              restrictionNo,
              customerId: customer.id,
              scope,
              cause: r.cause,
              visibility: policy.visibility,
              releasePolicy: policy.releasePolicy,
              status: 'OPEN',
              reason: r.reason,
              caseRef: r.caseRef ?? null,
              openedAt: now,
              openedBy: 'SEED',
              traceId: `seed-${restrictionNo}`,
            },
          });
          restrictionRowCount += 1;
        }
      }

      // Customer-level TB accounts: CLIENT_PAYABLE + DEPOSIT_SUSPENSE per asset.
      for (const asset of assets) {
        const ledger = TB_LEDGERS[asset.currency as keyof typeof TB_LEDGERS];
        for (const code of [TB_ACCOUNT_CODES.CLIENT_PAYABLE, TB_ACCOUNT_CODES.DEPOSIT_SUSPENSE]) {
          await ensureTbAccountRegistry(prisma, {
            code,
            ledger,
            ownerType: 'CUSTOMER',
            ownerUuid: customer.id,
            ownerNo: customer.customerNo,
            assetCode: asset.code,
            description: `${code === TB_ACCOUNT_CODES.CLIENT_PAYABLE ? 'CLIENT_PAYABLE' : 'DEPOSIT_SUSPENSE'} for ${customer.customerNo}/${asset.code}`,
          });
        }
      }
    }

    console.log(
      `Seeded ${DEMO_CUSTOMERS.length} demo customers ` +
        `(+${restrictionRowCount} restriction rows) + customer TB accounts.`,
    );
  }
  ```

- [ ] **Step 5: `scripts/reset-business-data.ts` 补 `customerRestriction` 删除项**

  L106-113 的 `// ── Customers / assets / wallets / TB registry ──` 段里，把

  ```ts
    'tbAccountRegistry',
    'wallet',
    'customerMain',
  ```

  改成

  ```ts
    'tbAccountRegistry',
    'wallet',
    // customer_restrictions FK → customer_main：子表必须先删，否则 reset 撞 FK。
    'customerRestriction',
    'customerMain',
  ```

- [ ] **Step 6: `scripts/demo-lib.ts` 的 `resolveDemoCustomers()`（L148-160）换新轴判定**

  ```ts
  export async function resolveDemoCustomers(prisma: any): Promise<any[]> {
    const rows = await prisma.customerMain.findMany({
      where: { email: { in: [...DEMO_CUSTOMER_EMAILS] } },
      select: {
        id: true, customerNo: true, email: true, firstName: true, lastName: true,
        lifecycle: true,
        // 三轴收敛后"能不能交易"= lifecycle ACTIVE 且名下无 OPEN 便签。
        // 便签一行一 scope，任何一行 OPEN 都足以让 demo 半路卡住，这里一律拒跑。
        restrictionRows: { where: { status: 'OPEN' }, select: { cause: true, scope: true } },
      },
    });
    const missing = DEMO_CUSTOMER_EMAILS.filter((e) => !rows.find((r: any) => r.email === e));
    if (missing.length) throw new Error(`demo customers missing (run business seed): ${missing.join(', ')}`);
    const blocked = rows.filter((r: any) => r.lifecycle !== 'ACTIVE' || r.restrictionRows.length > 0);
    if (blocked.length) {
      throw new Error(
        `demo customers not tradeable: ${blocked
          .map((r: any) => {
            const marks = r.restrictionRows.map((x: any) => `${x.cause}:${x.scope}`).join('+');
            return `${r.email}(${r.lifecycle}${marks ? '/' + marks : ''})`;
          })
          .join(', ')}`,
      );
    }
    // preserve DEMO_CUSTOMER_EMAILS order
    return DEMO_CUSTOMER_EMAILS.map((e) => rows.find((r: any) => r.email === e));
  }
  ```

- [ ] **Step 7: 重铺 main 栈并确认 Step 1 的查询转绿**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  bash scripts/stack.sh reset-main
  ```
  期望尾部：
  ```
  Seeded 9 demo customers (+4 restriction rows) + customer TB accounts.
  business reset complete
  ```
  （4 行 = Carol 的 `SANCTION`→`ALL` 1 行 + Ivy 的 `MATERIAL_EXPIRED`→`WITHDRAW`/`SWAP` 2 行；`RESTRICTION_CAUSE_POLICY` 若被改动此数会变，数对不上就是 policy 表被人动过。）

  再跑 Step 1 的同一条 sqlite 查询，期望输出正好 11 行：
  ```
  demo_acme@example.com|ACTIVE|-|-|-
  demo_alice@example.com|ACTIVE|-|-|-
  demo_bob@example.com|ACTIVE|-|-|-
  demo_carol@example.com|ACTIVE|SANCTION|ALL|SILENT
  demo_dave@example.com|IN_VERIFICATION|-|-|-
  demo_eve@example.com|PROSPECT|-|-|-
  demo_frank@example.com|ACTIVE|-|-|-
  demo_grace@example.com|ACTIVE|-|-|-
  demo_ivy@example.com|ACTIVE|MATERIAL_EXPIRED|SWAP|DISCLOSED
  demo_ivy@example.com|ACTIVE|MATERIAL_EXPIRED|WITHDRAW|DISCLOSED
  ```
  （9 客户 + Ivy 多出的第 2 个 scope 行 = 10 行；若少了 `demo_ivy` 两行说明 Step 3 的 fixture 没落。）

- [ ] **Step 8: commit seed 段**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  git add prisma/seed.business.ts scripts/reset-business-data.ts scripts/demo-lib.ts
  git commit -m "seed(customers): 9 个 demo 客户按 lifecycle 一轴重铺 + Carol 制裁便签/Ivy 材料过期便签；reset 补删 customerRestriction，demo-lib 交易资格改读 lifecycle+OPEN 便签"
  ```

---

#### B. e2e 六用例

- [ ] **Step 9: 备好本 suite 专用的 `e2e-` 库**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  mkdir -p /tmp/exchange_js_main
  DATABASE_URL='file:/tmp/exchange_js_main/e2e-customer-restrictions.db' npx prisma migrate deploy
  DATABASE_URL='file:/tmp/exchange_js_main/e2e-customer-restrictions.db' npm run db:base:sync
  DATABASE_URL='file:/tmp/exchange_js_main/e2e-customer-restrictions.db' TB_ADDRESS=127.0.0.1:3003 npm run db:biz:init
  ```
  期望：`migrate deploy` 打印 `All migrations have been successfully applied.`；`db:biz:init` 尾部同 Step 7 的 `Seeded 9 demo customers (+4 restriction rows) ...`。

  > 库名刻意含 `e2e-`，落点跟 main 栈同目录 `/tmp/exchange_js_main/` —— **不复刻** `test/deposit-sumsub-verdicts.e2e-spec.ts:17` 那个指向早已删除 worktree（`/tmp/exchange_js_wt_deposit_arcs`）的硬编码（BACKLOG「演示/测试环境卫生」第 ③ 条）。

- [ ] **Step 10: 写 spec 头部 + 三重库守卫 + harness（先落文件，此时无用例）**

  新建 `test/customer-restrictions.e2e-spec.ts`：

  ```ts
  import * as path from 'path';
  import * as dotenv from 'dotenv';

  // Node 18 polyfill —— @nestjs/schedule 需要 globalThis.crypto，本 harness 不加载
  // main.ts，所以在 AppModule（→ ScheduleModule）之前重复一遍。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

  // ── 破坏性护栏 ①（必须在任何读 DATABASE_URL 的 import 之前）──────────────
  // 本 suite 会 deleteMany fixture 客户及其便签/三域订单/钱包。指向常驻栈的验收库
  // 会毁真数据（2026-07-31 已两次实证，见 BACKLOG「演示/测试环境卫生」）。
  process.env.DATABASE_URL = 'file:/tmp/exchange_js_main/e2e-customer-restrictions.db';

  // ── 破坏性护栏 ②：上面那行若被人删改回读 .env，这里兜住 ────────────────
  if (!process.env.DATABASE_URL?.includes('e2e-')) {
    throw new Error(
      `[customer-restrictions e2e] 拒绝运行：本 suite 会清空 fixture 客户及其三域订单，` +
        `但 DATABASE_URL 当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。\n` +
        `专用库需先 prisma migrate deploy + db:base:sync + db:biz:init；库名必须含 "e2e-"。`,
    );
  }

  // 本 suite 不打真实 api.sumsub.com；缺这个开关时 SumsubClient 会因无 APP_TOKEN 抛错。
  // 不能靠 .env —— stack.sh 每次 up 都重写它且从不写 SUMSUB_*。
  process.env.SUMSUB_MOCK_MODE = 'true';

  // dotenv 不覆盖已存在的 key：DATABASE_URL 保持上面的专用库，TB_ADDRESS 走 .env。
  dotenv.config({ path: path.resolve(__dirname, '../.env') });

  // ── 破坏性护栏 ③：dotenv 之后再确认一次 ────────────────────────────────
  if (!process.env.DATABASE_URL?.includes('e2e-')) {
    throw new Error(
      `Refusing to run: DATABASE_URL is ${process.env.DATABASE_URL}, expected a dedicated "e2e-" database ` +
        `(e.g. file:/tmp/exchange_js_main/e2e-customer-restrictions.db).`,
    );
  }

  import * as request from 'supertest';
  import { Test } from '@nestjs/testing';
  import { INestApplication } from '@nestjs/common';
  import { EventEmitter2 } from '@nestjs/event-emitter';
  import { JwtService } from '@nestjs/jwt';
  import { Prisma } from '@prisma/client';

  import { AppModule } from '../src/app.module';
  import { PrismaService } from '../src/core/prisma/prisma.service';
  import { CustomerAccessService } from '../src/modules/identity/customers/customer-access.service';
  import { CustomerRestrictionsService } from '../src/modules/identity/customers/customer-restrictions.service';
  import { CustomerRestrictionWorkflowService } from '../src/modules/identity/customers/customer-restriction-workflow.service';
  import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
  import {
    ApprovalActionTypes,
    ApprovalActorContext,
  } from '../src/modules/governance/approvals/constants/approval.constants';
  import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
  import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
  import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
  import { buildDeterministicNo, generateReferenceNo } from '../src/common/utils/no-generator.util';

  /**
   * 设计稿 §7.2 六条 e2e，逐条对应设计稿存在的理由：
   *   ① 多因并存不互相解 —— 三轴收敛的首要动机
   *   ② 零痕迹        —— tipping-off 命门（blocked / disclosedBlocked 分家）
   *   ③ 贴不审批撕审批 —— 贴便签立即生效、撕便签才走审批
   *   ④ MLRO 类缺 releaseOrderRef → 400
   *   ⑤ 贴 ALL 冻在途单（含兑换，§3.5 本轮新补）
   *   ⑥ scope < ALL 不动在途单
   *
   * harness：真 AppModule + 真 HTTP（supertest）。②/③/④ 必须走 HTTP —— 它们断言的
   * 就是"客户/操作员在网络层面看到什么"，绕过 controller 用 service 直调等于没测。
   * fixture 客户全部现建现删（前缀 e2e_restrictions_），不碰 9 个 demo 客户 ——
   * 那 9 个被别的 suite 和人工验收共用。
   */
  describe('Customer lifecycle restrictions (e2e, Task 14)', () => {
    jest.setTimeout(60000);

    let app: INestApplication;
    let prisma: PrismaService;
    let jwt: JwtService;
    let access: CustomerAccessService;
    let restrictions: CustomerRestrictionsService;
    let workflow: CustomerRestrictionWorkflowService;
    let approvals: ApprovalsService;

    let adminToken: string;
    let fiatAssetId: string;
    let cryptoAssetId: string;

    const EMAIL_PREFIX = 'e2e_restrictions_';

    // Maker-checker：贴/发起用 admin JWT（SUPER_ADMIN，maker），批准用另外的 actor。
    const MLRO_CHECKER: ApprovalActorContext = {
      actorType: 'ADMIN', userId: 'E2E_RST_MLRO', userNo: 'E2E_RST_MLRO',
      role: 'MLRO', roleCodes: ['MLRO'],
    };
    const OPS_CHECKER: ApprovalActorContext = {
      actorType: 'ADMIN', userId: 'E2E_RST_OPS', userNo: 'E2E_RST_OPS',
      role: 'OPS_OFFICER', roleCodes: ['OPS_OFFICER'],
    };
    const SEED_ACTOR: ApprovalActorContext = {
      actorType: 'ADMIN', userId: 'E2E_RST_MAKER', userNo: 'E2E_RST_MAKER',
      role: 'MLRO', roleCodes: ['MLRO'],
    };

    type Fixture = {
      id: string; customerNo: string; email: string; phone: string;
      firstName: string; lastName: string; token: string;
    };

    /** 现建 fixture 客户：只写交易门真正读的列，形状对齐 seed.business.ts 的 ACTIVE 个人客户。 */
    async function makeCustomer(tag: string, seq: number): Promise<Fixture> {
      const email = `${EMAIL_PREFIX}${tag}@example.com`;
      const phone = `+1555900${String(seq).padStart(4, '0')}`;
      const row = await prisma.customerMain.create({
        data: {
          email,
          customerNo: buildDeterministicNo('CU', email),
          phone,
          // ② 要求两个客户除身份键外逐字节相同，故所有 fixture 共用同一组姓名。
          firstName: 'Pat',
          lastName: 'Sample',
          customerType: 'INDIVIDUAL',
          lifecycle: 'ACTIVE',
          riskRating: 'LOW',
          tradingTier: 'BASIC',
          eddRequired: false,
        },
        select: { id: true, customerNo: true },
      });
      return {
        id: row.id, customerNo: row.customerNo, email, phone,
        firstName: 'Pat', lastName: 'Sample',
        token: jwt.sign({
          username: email, sub: row.id, role: 'CUSTOMER', type: 'CUSTOMER', userNo: row.customerNo,
        }),
      };
    }

    /** 在途充值 fixture（COMPLIANCE_PENDING）—— 复刻 deposit-money-arcs 的 createDepositAtStatus。 */
    async function makeDeposit(c: Fixture, amount: string): Promise<{ id: string; depositNo: string }> {
      const wallet = await prisma.wallet.create({
        data: {
          ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
          type: 'FIAT_BANK', assetId: fiatAssetId, iban: `AE_E2E_${c.customerNo}`, status: 'ACTIVE',
        },
      });
      const depositNo = generateReferenceNo('DEP');
      const row = await prisma.depositTransaction.create({
        data: {
          depositNo, traceId: depositNo,
          ownerType: 'CUSTOMER', ownerId: c.id,
          status: DepositTransactionStatus.COMPLIANCE_PENDING,
          assetId: fiatAssetId, toWalletId: wallet.id,
          amount: new Prisma.Decimal(amount),
          netAmount: new Prisma.Decimal(amount),
          feeAmount: new Prisma.Decimal(0),
        },
        select: { id: true, depositNo: true },
      });
      return row;
    }

    async function makeWithdraw(c: Fixture, amount: string): Promise<{ id: string; withdrawNo: string }> {
      const withdrawNo = generateReferenceNo('WD');
      return prisma.withdrawTransaction.create({
        data: {
          withdrawNo, traceId: withdrawNo,
          ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
          status: WithdrawTransactionStatus.COMPLIANCE_PENDING,
          assetId: fiatAssetId,
          amount: new Prisma.Decimal(amount),
          netAmount: new Prisma.Decimal(amount),
          feeAmount: new Prisma.Decimal(0),
          toIban: `AE_E2E_OUT_${c.customerNo}`,
        },
        select: { id: true, withdrawNo: true },
      });
    }

    async function makeSwap(c: Fixture, amount: string): Promise<{ id: string; swapNo: string | null }> {
      const swapNo = generateReferenceNo('SWP');
      return prisma.swapTransaction.create({
        data: {
          swapNo, traceId: swapNo,
          ownerType: 'CUSTOMER', ownerId: c.id, ownerNo: c.customerNo,
          status: SwapTransactionStatus.COMPLIANCE_PENDING,
          fromAssetId: fiatAssetId, fromAssetCode: 'AED', fromAmount: new Prisma.Decimal(amount),
          toAssetId: cryptoAssetId, toAssetCode: 'USDT', toAmount: new Prisma.Decimal(amount),
          exchangeRate: new Prisma.Decimal('1'),
        },
        select: { id: true, swapNo: true },
      });
    }

    async function openApprovalCaseFor(restrictionNo: string, actionType: string) {
      return prisma.approvalCase.findFirst({
        where: { actionType, entityRef: restrictionNo },
        orderBy: { createdAt: 'desc' },
      });
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = moduleRef.createNestApplication();
      // 全量 AppModule 往同名事件挂了远超 EventEmitter2 默认 maxListeners=10 的
      // handler，不抬高会在 init 时抛 possible-memory-leak（同 Task 10/12 harness）。
      app.get(EventEmitter2).setMaxListeners(50);
      await app.init();

      prisma = app.get(PrismaService);
      jwt = app.get(JwtService);
      access = app.get(CustomerAccessService);
      restrictions = app.get(CustomerRestrictionsService);
      workflow = app.get(CustomerRestrictionWorkflowService);
      approvals = app.get(ApprovalsService);

      // 清掉上一轮的 fixture（子表先删）。只删本 suite 前缀的客户，9 个 demo 客户不动。
      const stale = await prisma.customerMain.findMany({
        where: { email: { startsWith: EMAIL_PREFIX } },
        select: { id: true },
      });
      const staleIds = stale.map((s) => s.id);
      if (staleIds.length) {
        await prisma.customerRestriction.deleteMany({ where: { customerId: { in: staleIds } } });
        await prisma.depositTransaction.deleteMany({ where: { ownerId: { in: staleIds } } });
        await prisma.withdrawTransaction.deleteMany({ where: { ownerId: { in: staleIds } } });
        await prisma.swapTransaction.deleteMany({ where: { ownerId: { in: staleIds } } });
        await prisma.wallet.deleteMany({ where: { ownerId: { in: staleIds } } });
        await prisma.customerMain.deleteMany({ where: { id: { in: staleIds } } });
      }

      const fiat = await prisma.asset.findFirst({ where: { currency: 'AED' } });
      const crypto = await prisma.asset.findFirst({ where: { currency: 'USDT' } });
      if (!fiat || !crypto) {
        throw new Error('Fixture assets AED/USDT not seeded — run `npm run db:biz:init` on the e2e DB first.');
      }
      fiatAssetId = fiat.id;
      cryptoAssetId = crypto.id;

      // admin JWT：base seed 的 SUPER_ADMIN，AdminPermissionGuard 对其直接放行。
      const admin = await prisma.user.findFirst({
        where: { email: 'admin@fiatx.com', deletedAt: null },
        select: { id: true, userNo: true, email: true },
      });
      if (!admin) {
        throw new Error('Seeded SUPER_ADMIN admin@fiatx.com not found — run `npm run db:base:sync` on the e2e DB.');
      }
      adminToken = jwt.sign({
        username: admin.email, sub: admin.id, role: 'SUPER_ADMIN', type: 'ADMIN', userNo: admin.userNo,
      });
    });

    afterAll(async () => {
      await app?.close();
    });
  });
  ```

  跑一次确认 harness 起得来：
  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npx jest --config ./test/jest-e2e.json test/customer-restrictions.e2e-spec.ts
  ```
  期望（红，因为还没有用例）：
  ```
  Your test suite must contain at least one test.
  ```
  若在这一步就报 `no such table: customer_restrictions` 或 `Unknown arg 'lifecycle'`，说明 Step 9 的专用库没迁移到位，回 Step 9。

- [ ] **Step 11: 加用例 ①②（多因并存 / 零痕迹）**

  在 `afterAll` 之前插入：

  ```ts
    // ── ① 多因并存不互相解 ──────────────────────────────────────────────
    // 这是整个设计存在的首要理由：旧模型单列 complianceStatus 存因，第二个原因
    // 到来即覆盖第一个，交材料自动解冻会把制裁一起解掉。
    it('① 先 SANCTION 后 MATERIAL_EXPIRED，交材料自动撕第二张，SANCTION 仍 OPEN 且全能力仍被禁', async () => {
      const c = await makeCustomer('multicause', 1);

      const sanction = await workflow.openRestriction(
        { customerId: c.id, cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-1', openedBy: SEED_ACTOR.userId },
        SEED_ACTOR,
      );
      const material = await workflow.openRestriction(
        { customerId: c.id, cause: 'MATERIAL_EXPIRED', reason: 'Passport expired', caseRef: 'E2E-CASE-MATERIAL-1', openedBy: SEED_ACTOR.userId },
        SEED_ACTOR,
      );
      expect(sanction.created).toBe(true);
      expect(material.created).toBe(true);

      // 幂等键 (customerId, cause, caseRef)：同因同案重复贴 = no-op。
      const again = await workflow.openRestriction(
        { customerId: c.id, cause: 'SANCTION', reason: 'Sanctions hit (dup)', caseRef: 'E2E-CASE-SANCTION-1', openedBy: SEED_ACTOR.userId },
        SEED_ACTOR,
      );
      expect(again).toEqual({ restrictionNo: sanction.restrictionNo, created: false });

      // 客户交了材料 → 材料侧自动撕自己那张（AUTO，不开审批）。
      await workflow.autoRelease(c.id, 'MATERIAL_EXPIRED', 'E2E-CASE-MATERIAL-1', 'E2E_MATERIAL_REFRESH');

      const all = await restrictions.listAll(c.id);
      const materialRow = all.find((r) => r.restrictionNo === material.restrictionNo);
      const sanctionRow = all.find((r) => r.restrictionNo === sanction.restrictionNo);
      expect(materialRow!.status).toBe('RELEASED');
      expect(materialRow!.releaseMode).toBe('AUTO');
      expect(sanctionRow!.status).toBe('OPEN');

      const acc = await access.resolve(c.id);
      expect([...acc.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
      expect([...acc.disclosedBlocked]).toEqual([]);   // SANCTION 是 SILENT
      expect(acc.disclosed).toEqual([]);
      expect(acc.openCount).toBe(1);
    });

    // ── ② 零痕迹 ────────────────────────────────────────────────────────
    // 被制裁客户与正常客户的三个客户面响应体，归一化后必须逐字节相等。
    // 归一化只剔除"两个客户天然不同"的东西：各自的 id / customerNo / email /
    // phone / 各自订单号、以及所有 UUID 与时间戳。任何跟"有没有便签"相关的差异
    // 都不在剔除范围内 —— 那正是本用例要抓的东西。
    const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z/g;

    function sortDeep(value: any): any {
      if (Array.isArray(value)) return value.map(sortDeep);
      if (value && typeof value === 'object') {
        return Object.keys(value).sort().reduce((acc: any, k) => { acc[k] = sortDeep(value[k]); return acc; }, {});
      }
      return value;
    }

    function normalizeBody(raw: unknown, identity: Record<string, string>): string {
      let text = JSON.stringify(sortDeep(raw));
      // 长串先替换，避免短串是长串子串时把长串切碎（customerNo ⊂ iban 等）。
      for (const [token, value] of Object.entries(identity).sort((a, b) => b[1].length - a[1].length)) {
        if (value) text = text.split(value).join(`<${token}>`);
      }
      return text.replace(UUID_RE, '<UUID>').replace(ISO_RE, '<TS>');
    }

    it('② 零痕迹：SANCTION 客户与正常客户的 /onboarding/me、/client/me/restrictions、/deposit-transactions/my 归一化后逐字节相等', async () => {
      const silent = await makeCustomer('silent', 2);
      const clean = await makeCustomer('clean', 3);

      // 两边各一笔形状完全相同的在途充值 —— 贴 ALL 便签会把被制裁那笔冻成
      // FROZEN，客户面必须仍旧脱敏成同一个字符串（这条同时压住服务端脱敏）。
      const silentDep = await makeDeposit(silent, '5000');
      const cleanDep = await makeDeposit(clean, '5000');

      await workflow.openRestriction(
        { customerId: silent.id, cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-2', openedBy: SEED_ACTOR.userId },
        SEED_ACTOR,
      );

      // 前提校验：后端确实已经冻了，否则"两边一样"是因为什么都没发生。
      const frozen = await prisma.depositTransaction.findUnique({ where: { id: silentDep.id } });
      expect(frozen!.status).toBe(DepositTransactionStatus.FROZEN);
      const silentAccess = await access.resolve(silent.id);
      expect([...silentAccess.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);

      const server = app.getHttpServer();
      const paths = ['/onboarding/me', '/client/me/restrictions', '/deposit-transactions/my'];

      for (const p of paths) {
        const a = await request(server).get(p).set('Authorization', `Bearer ${silent.token}`);
        const b = await request(server).get(p).set('Authorization', `Bearer ${clean.token}`);

        expect(a.status).toBe(b.status);
        expect(a.status).toBe(200);   // 被制裁客户不得被 403/423 挡 —— 状态码本身就是信号

        const na = normalizeBody(a.body, {
          CID: silent.id, CNO: silent.customerNo, EMAIL: silent.email,
          PHONE: silent.phone, ORDER: silentDep.depositNo,
        });
        const nb = normalizeBody(b.body, {
          CID: clean.id, CNO: clean.customerNo, EMAIL: clean.email,
          PHONE: clean.phone, ORDER: cleanDep.depositNo,
        });
        expect(`${p} :: ${na}`).toEqual(`${p} :: ${nb}`);
      }

      // 结构性保证：客户面 DTO 里根本没有承载 SILENT 的字段。
      const me = await request(server).get('/onboarding/me').set('Authorization', `Bearer ${silent.token}`);
      expect(me.body).not.toHaveProperty('blocked');
      expect(me.body).not.toHaveProperty('openCount');
      expect(me.body).not.toHaveProperty('onboardingStatus');
      expect(me.body).not.toHaveProperty('adminStatus');
      expect(me.body).not.toHaveProperty('complianceStatus');
      expect(me.body).not.toHaveProperty('restrictions');
      expect(me.body.lifecycle).toBe('ACTIVE');
      expect(me.body.disclosedBlocked).toEqual([]);
      expect(me.body.disclosed).toEqual([]);
    });
  ```

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npx jest --config ./test/jest-e2e.json test/customer-restrictions.e2e-spec.ts -t '①'
  npx jest --config ./test/jest-e2e.json test/customer-restrictions.e2e-spec.ts -t '②'
  ```
  各期望 `Tests: 1 passed, 1 skipped`（另一条被 `-t` 过滤）。
  ①红 → Task 5/5 的多因并存或幂等键有问题；②红且 diff 落在 `status` / `completedAt` → 服务端脱敏白名单漏了 `FROZEN`（充值域已有，看 `deposit-transactions.service.ts` 的 `CUSTOMER_STATUS_PASSTHROUGH`）；②红且 diff 落在 `disclosed`/`blocked` → Task 7 的客户面 DTO 泄了 SILENT。

- [ ] **Step 12: 加用例 ③④（贴不审批撕审批 / MLRO 缺 releaseOrderRef）**

  接在 ② 之后：

  ```ts
    // ── ③ 贴不审批，撕才审批 ─────────────────────────────────────────────
    it('③ POST 贴便签立即生效且无审批案；POST release 建审批案且便签仍 OPEN；批准后才撕', async () => {
      const c = await makeCustomer('ops-release', 4);
      const server = app.getHttpServer();

      const opened = await request(server)
        .post(`/admin/customers/${c.customerNo}/restrictions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cause: 'ADMIN_SUSPENSION', reason: 'Ops hold pending contract review' });
      expect(opened.status).toBe(201);
      const restrictionNo: string = opened.body.restrictionNo;
      expect(restrictionNo).toMatch(/^RST\d{10}$/);
      expect(opened.body.created).toBe(true);

      // 立即生效
      const afterOpen = await access.resolve(c.id);
      expect([...afterOpen.blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
      expect([...afterOpen.disclosedBlocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);
      expect(afterOpen.disclosed).toHaveLength(1);
      expect(afterOpen.disclosed[0].label).toBe('Account suspended');

      // 贴的时候不开审批案
      expect(await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS)).toBeNull();
      expect(await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO)).toBeNull();

      // visibility / releasePolicy 由 cause 查表推出，入参给了就 400
      const forged = await request(server)
        .post(`/admin/customers/${c.customerNo}/restrictions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cause: 'ADMIN_SUSPENSION', reason: 'forged', visibility: 'SILENT' });
      expect(forged.status).toBe(400);

      // scopeSelectable=false 的 cause 传 scopes 也 400
      const forgedScope = await request(server)
        .post(`/admin/customers/${c.customerNo}/restrictions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cause: 'ADMIN_SUSPENSION', reason: 'forged', scopes: ['WITHDRAW'] });
      expect(forgedScope.status).toBe(400);

      // 撕：开审批案，便签保持 OPEN
      const released = await request(server)
        .post(`/admin/customers/${c.customerNo}/restrictions/${restrictionNo}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Contract review cleared' });
      expect(released.status).toBe(201);
      expect(released.body.approvalNo).toMatch(/^APR\d{10}$/);

      const pending = await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_OPS);
      expect(pending).toBeTruthy();
      expect(pending!.status).toBe('PENDING');
      expect(pending!.entityRef).toBe(restrictionNo);   // entityRef 是业务号不是 uuid
      expect((await restrictions.findByNo(restrictionNo))!.status).toBe('OPEN');
      expect([...(await access.resolve(c.id)).blocked].sort()).toEqual(['DEPOSIT', 'SWAP', 'WITHDRAW']);

      // OPS 批准 → 撕
      await approvals.approve(pending!.id, { reason: 'e2e approve' }, OPS_CHECKER);

      const torn = await restrictions.findByNo(restrictionNo);
      expect(torn!.status).toBe('RELEASED');
      expect(torn!.releaseMode).toBe('MANUAL');
      expect(torn!.releaseApprovalNo).toBe(released.body.approvalNo);
      expect((await access.resolve(c.id)).blocked.size).toBe(0);
    });

    // ── ④ MLRO 类缺 releaseOrderRef → 400 ───────────────────────────────
    it('④ SANCTION（MLRO_APPROVAL）发起解除时缺 releaseOrderRef 直接 400，不开审批案', async () => {
      const c = await makeCustomer('mlro-release', 5);
      const server = app.getHttpServer();

      const opened = await request(server)
        .post(`/admin/customers/${c.customerNo}/restrictions`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-4' });
      expect(opened.status).toBe(201);
      const restrictionNo: string = opened.body.restrictionNo;

      const bad = await request(server)
        .post(`/admin/customers/${c.customerNo}/restrictions/${restrictionNo}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Investigation closed' });
      expect(bad.status).toBe(400);
      expect(await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO)).toBeNull();
      expect((await restrictions.findByNo(restrictionNo))!.status).toBe('OPEN');

      // 带上 releaseOrderRef 就能开案（证明 400 是缺字段所致，不是路由/权限坏了）
      const good = await request(server)
        .post(`/admin/customers/${c.customerNo}/restrictions/${restrictionNo}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ reason: 'Investigation closed', releaseOrderRef: 'MLRO-ORDER-2026-0042' });
      expect(good.status).toBe(201);
      const pending = await openApprovalCaseFor(restrictionNo, ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO);
      expect(pending!.status).toBe('PENDING');

      await approvals.approve(pending!.id, { reason: 'e2e approve' }, MLRO_CHECKER);
      const torn = await restrictions.findByNo(restrictionNo);
      expect(torn!.status).toBe('RELEASED');
      expect(torn!.releaseOrderRef).toBe('MLRO-ORDER-2026-0042');
    });
  ```

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npx jest --config ./test/jest-e2e.json test/customer-restrictions.e2e-spec.ts -t '③'
  npx jest --config ./test/jest-e2e.json test/customer-restrictions.e2e-spec.ts -t '④'
  ```
  各期望 `Tests: 1 passed`。
  ③④ 若 403 → 三个端点没进 `rbac.catalog.ts`（Task 9）或专用库没跑 `db:base:sync`；④ 若 201 而不是 400 → Task 10 的 `initiateRelease` 漏了 MLRO 必填校验。

- [ ] **Step 13: 加用例 ⑤⑥（贴 ALL 冻在途单 / scope < ALL 不动在途单）**

  接在 ④ 之后：

  ```ts
    // ── ⑤ 贴 ALL 冻在途单（三域，含兑换 —— §3.5 本轮新补）───────────────
    it('⑤ 三域各一笔在途单 → 贴 SANCTION（scope=ALL）→ 三笔全 FROZEN', async () => {
      const c = await makeCustomer('freeze-inflight', 6);
      const dep = await makeDeposit(c, '7000');
      const wd = await makeWithdraw(c, '600');
      const sw = await makeSwap(c, '900');

      await workflow.openRestriction(
        { customerId: c.id, cause: 'SANCTION', reason: 'Sanctions hit', caseRef: 'E2E-CASE-SANCTION-5', openedBy: SEED_ACTOR.userId },
        SEED_ACTOR,
      );

      expect((await prisma.depositTransaction.findUnique({ where: { id: dep.id } }))!.status)
        .toBe(DepositTransactionStatus.FROZEN);
      expect((await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } }))!.status)
        .toBe(WithdrawTransactionStatus.FROZEN);
      // 兑换域今天没有 FROZEN 态，由 §3.5 的实现 task 补进 SwapTransactionStatus。
      // 这里刻意用字面量而不是枚举成员：枚举缺成员应当在这条断言上红（"兑换没被冻"），
      // 而不是让整个 spec 编译不过、把失败信息糊成 tsc 错误。
      expect((await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status).toBe('FROZEN');
    });

    // ── ⑥ scope < ALL 不动在途单 ────────────────────────────────────────
    // 材料过期不该把已经在途的提现拽回来 —— 只挡新单，不动旧单。
    it('⑥ 贴 MATERIAL_EXPIRED（WITHDRAW+SWAP）→ 三笔在途单状态一律不变', async () => {
      const c = await makeCustomer('no-freeze-inflight', 7);
      const dep = await makeDeposit(c, '7000');
      const wd = await makeWithdraw(c, '600');
      const sw = await makeSwap(c, '900');

      await workflow.openRestriction(
        { customerId: c.id, cause: 'MATERIAL_EXPIRED', reason: 'Passport expired', caseRef: 'E2E-CASE-MATERIAL-6', openedBy: SEED_ACTOR.userId },
        SEED_ACTOR,
      );

      expect((await prisma.depositTransaction.findUnique({ where: { id: dep.id } }))!.status)
        .toBe(DepositTransactionStatus.COMPLIANCE_PENDING);
      expect((await prisma.withdrawTransaction.findUnique({ where: { id: wd.id } }))!.status)
        .toBe(WithdrawTransactionStatus.COMPLIANCE_PENDING);
      expect((await prisma.swapTransaction.findUnique({ where: { id: sw.id } }))!.status)
        .toBe(SwapTransactionStatus.COMPLIANCE_PENDING);

      // 但新单方向确实被挡住了（在途不动 ≠ 没生效）
      const acc = await access.resolve(c.id);
      expect([...acc.blocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
      expect([...acc.disclosedBlocked].sort()).toEqual(['SWAP', 'WITHDRAW']);
      expect(acc.disclosed[0].label).toBe('Document expired');
      await expect(access.assertCapability(c.id, 'WITHDRAW')).rejects.toMatchObject({
        response: { code: 'CAPABILITY_RESTRICTED' },
      });
      await expect(access.assertCapability(c.id, 'DEPOSIT')).resolves.toBeUndefined();
    });
  ```

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npx jest --config ./test/jest-e2e.json test/customer-restrictions.e2e-spec.ts
  ```
  期望：
  ```
  Tests:       6 passed, 6 total
  Test Suites: 1 passed, 1 total
  ```
  ⑤ 若只有 swap 那条红（`Expected: "FROZEN" / Received: "COMPLIANCE_PENDING"`），说明 §3.5 的兑换域客户级闸没补 —— 回实现 task 补 `SwapTransactionStatus.FROZEN` 与冻结扫描，**不要改这条断言**。

- [ ] **Step 14: commit e2e**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  git add test/customer-restrictions.e2e-spec.ts
  git commit -m "test(e2e): 客户限制账六用例（多因并存/零痕迹逐字节/贴不审批撕审批/MLRO 缺 orderRef 400/ALL 冻在途单/scope<ALL 不动在途单），跑在专用 e2e- 库上"
  ```

---

#### C. 硬闸门逐条跑

- [ ] **Step 15: `npx tsc --noEmit`**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npx tsc --noEmit; echo "exit=$?"
  ```
  期望：无任何输出，仅
  ```
  exit=0
  ```

- [ ] **Step 16: `npm test`（单测，净新增失败必须为 0）**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npm test 2>&1 | tail -8
  ```
  期望尾部形如：
  ```
  Test Suites: 1 failed, NNN passed, NNN total
  Tests:       4 failed, NNNN passed, NNNN total
  ```
  4 条失败必须全部落在 `src/modules/asset-treasury/wallets/`（本轮之前就存在的 pre-existing 失败）。逐条核对失败文件名：任何一条落在 `identity/customers/`、`identity/constants/`、`governance/approvals/` 或 `admin-web/`、`client-web/` 都是本轮引入，必须修到零。

- [ ] **Step 17: `npm run test:e2e`（全 7 支 suite）**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  npm run test:e2e 2>&1 | tail -6
  ```
  期望：
  ```
  Test Suites: 7 passed, 7 total
  Tests:       NN passed, NN total
  ```
  > 若 `deposit-sumsub-verdicts` 报 `Error code 14: Unable to open the database file`，那是它自己硬编码的已删 worktree 路径（BACKLOG 已登记，非本轮引入）——按该条目的说明先 `mkdir -p /tmp/exchange_js_wt_deposit_arcs` 并对那个库跑一遍 `migrate deploy` + `db:base:sync` + `db:biz:init`，本轮不改它的路径。

- [ ] **Step 18: `demo:all`**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  bash scripts/on-stack.sh main demo:all 2>&1 | tail -6
  ```
  期望：
  ```
    asserts: 8/8 PASS

  ═══ demo:all DONE ✅ (all asserts pass) ═══
  ```
  若报 `demo customers not tradeable: demo_xxx@example.com(...)`，说明 Step 6 的判定逮到了 seed 里给 alice/bob/grace 误挂了便签 —— 改 seed，不改判定。

- [ ] **Step 19: `verify:coa`**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  bash scripts/on-stack.sh main verify:coa 2>&1 | tail -3
  ```
  期望：
  ```
  ALL INVARIANTS PASS
  ```
  本设计不动账本，这条纯回归。若报 202/203/204 退役户非零，那是 main 栈尚未执行的一次性 `migrate:coa-v2`（MEMORY 已记，非本轮引入）。

- [ ] **Step 20: 五闸门若有本轮引入的修复，单独提交**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  git add <闸门修复涉及的具名文件>
  git commit -m "fix(restrictions): 硬闸门走查修复 —— <逐条说明修了什么>"
  ```
  （五条全绿且无改动则跳过本步，不产生空 commit。）

---

#### D. 文档同步（设计稿 §9 清单）

- [ ] **Step 21: 重写 `doc-final/reference/truth/v2-customer-compliance.md` 的三轴段**

  1. L3 整行替换为：
     ```
     Last Verified: 2026-08-16（核对方式：客户生命周期轴 + 限制账落地后逐段重写；e2e customer-restrictions 六用例实证）
     ```
  2. L12（§0 一句话定位）里 `核心是**客户主表三轴状态模型**` 替换为
     `核心是**一根客户关系生命周期轴（\`lifecycle\`）+ 一张限制账（\`customer_restrictions\`）**`。
  3. L16-19（§1 的三轴四行）整段替换为：
     ```markdown
     - **一根轴**（`identity/constants/customer-lifecycle.constant.ts`）：`lifecycle` —— 描述客户关系走到哪一步，与"能不能干事"解耦
       - `PROSPECT → IN_VERIFICATION → PENDING_APPROVAL → ACTIVE`；旁支 `REJECTED` / `WITHDRAWN`（可 `REAPPLY` 回 `IN_VERIFICATION`）；终态 `OFFBOARDED`
       - 8 个动作：`START_VERIFICATION` / `VERIFICATION_PASSED` / `VERIFICATION_REJECTED` / `WITHDRAW_APPLICATION` / `FINAL_APPROVED` / `FINAL_REJECTED` / `REAPPLY` / `OFFBOARD`；非法边由 `nextLifecycle()` 抛 `Invalid lifecycle action <action> from <from>`
       - 不变量：不存在 `ACTIVE → REJECTED|WITHDRAWN` 边（已 ACTIVE 的客户只能被 `OFFBOARD`，被摁住走限制账不走轴）
     - **一张限制账**（`customer_restrictions`，一行 = 一次摁住的一个 scope）：范围 / 可见性 / 解除路径三个正交属性由 `cause` 查 `RESTRICTION_CAUSE_POLICY` 推出，人工不可填
       - 7 个 cause：`SANCTION`（SILENT/MLRO）｜`ADMIN_SUSPENSION`（DISCLOSED/OPS）｜`MATERIAL_EXPIRED`｜`TIER_UPGRADE_PENDING`｜`KYT_REJECTED_SOFT`（三者 DISCLOSED/OPS）｜`KYT_REJECTED_HARD`（SILENT/MLRO）｜`PENDING_DOCUMENT`（DISCLOSED/OPS，唯一 `scopeSelectable`）
       - 一张便签多 scope = 同 `restrictionNo` 多行；release 以 `restrictionNo` 为单位一次全撕
       - 幂等键 `(customerId, cause, caseRef)`：已有 OPEN 即 no-op（`caseRef` 为 null 时不去重）
     - 旧的 `adminStatus` / `complianceStatus` / `complianceFreeze*` 四列 / `restrictions` JSON **已全部删除**，无兼容层（demo 数据约定，reset 重铺）
     ```
  4. L26（§2 CustomerMain 那条）整行替换为：
     ```markdown
     - **CustomerMain**：`lifecycle` 一列 + `investorTier`(STANDARD/ENHANCED) + `tradingTier`(BASIC/PREMIUM) + `riskRating`(LOW/MEDIUM/HIGH) + `pendingActionExternalId`/`pendingActionReason`/`pendingActionSubmittedAt`/`hardLineDispositionedAt`（客户级补料闭环，与限制账互补：限制说"不能做什么"，pendingAction 说"做什么能解开"，二者经 `KYT_REJECTED_SOFT` 便签的 `caseRef` 关联）
     - **CustomerRestriction**（`customer_restrictions`）：`restrictionNo`(RST) + `scope` 单值 + `cause`/`visibility`/`releasePolicy`（查表写入）+ `status`(OPEN/RELEASED) + `reason`/`caseRef` + `releaseOrderRef`/`releaseApprovalNo`/`releaseMode`(AUTO/MANUAL) + `traceId`；`@@unique([restrictionNo, scope])`
     ```
  5. L33（`assertTradingEligibility` 那条）整行替换为：
     ```markdown
     - **能力门（V4-V6 交易门，最关键）**：读侧统一收口到 `CustomerAccessService.resolve()`，唯一执法依据是 `lifecycle === 'ACTIVE'`（否则 `LIFECYCLE_NOT_ACTIVE`）+ `!blocked.has(capability)`（否则 `CAPABILITY_RESTRICTED`）；`scope='ALL'` 展开成 {DEPOSIT, WITHDRAW, SWAP}。**`blocked`（含 SILENT，服务端执法）与 `disclosedBlocked`（仅 DISCLOSED，客户面）分成两个字段，是 tipping-off 命门**——客户面 DTO 只允许出现 `disclosedBlocked` / `disclosed`，`blocked` / `openCount` 禁止序列化。被制裁客户前端照常渲染可点按钮，点击后由后端拒绝。2026-07-11 起该门额外并入 `assertTradingReady()`：WITHDRAW/SWAP 须客户有 ≥1 个 ACTIVE 法币（BANK）提现地址，否则抛 `NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS`；DEPOSIT 例外不在此硬拒。贴 `scope=ALL` 便签会同事务冻结该客户名下全部非终态充值/提现/兑换单；`scope < ALL` 不动在途单。
     ```
  6. L35 里 `制裁命中 handleSanctionsPath()→complianceStatus=FROZEN` 改为 `制裁命中 handleSanctionsPath()→贴 SANCTION 便签（SILENT/MLRO 解除）`；L36 里 `BLOCKING 阶段设 complianceStatus=FROZEN` 改为 `BLOCKING 阶段贴 MATERIAL_EXPIRED 便签（DISCLOSED，WITHDRAW+SWAP）`，`补件成功自动解冻` 改为 `补件成功 autoRelease 只撕自己那张（多因并存不互相解）`。
  7. L43 的红线整行替换为（勾掉）：
     ```markdown
     - [x] ~~🔴 **冻结/解冻无统一 workflow**~~ **已兑现（2026-08-16，客户生命周期轴 + 限制账）**：贴便签统一走 `CustomerRestrictionWorkflowService.openRestriction()`（立即生效、不开审批）；撕便签统一走 `initiateRelease()` → 按 `releasePolicy` 分流 `CUSTOMER_RESTRICTION_RELEASE_MLRO`（SANCTION / KYT_REJECTED_HARD）或 `CUSTOMER_RESTRICTION_RELEASE_OPS`（其余五因）审批门 → `onReleaseDecided()` 落地；三个 admin 端点已建（列表 / 贴 / 发起解除）。MLRO 类必填 `releaseOrderRef`，缺失 400。
     ```
  8. L56 整行替换为：
     ```
     `identity/customers/`：`customers.service.ts` ｜ `customer-restrictions.service.ts`（守单实体不变量）｜ `customer-access.service.ts`（读侧唯一收口）｜ `customer-restriction-workflow.service.ts`（编排 + 审计 + 审批）｜ `constants/restriction-cause.constant.ts`（原因注册表）
     ```
     并把最后一行 `trading/shared/customer-transaction-guard.ts（restrictions 解析）` 改为 `trading/shared/customer-transaction-guard.ts（改调 CustomerAccessService.assertCapability）`。

- [ ] **Step 22: `doc-final/BACKLOG.md` —— 勾两条、登记三条**

  1. L9 `Last Updated: 2026-08-13` → `Last Updated: 2026-08-16`
  2. L175 那条整行改为已兑现（保留原文加删除线）：
     ```markdown
     - [x] ~~**新铸 action id 无写入路径 → 无操作员解锁入口，客户可能永久卡在 WITHDRAW-locked(2026-08-13 Task 14 终审 Finding 7)**~~ —— **②已兑现（2026-08-16，客户生命周期轴 + 限制账）**：admin 侧解限出口已建（`POST /admin/customers/:customerNo/restrictions/:restrictionNo/release` → OPS/MLRO 审批门 → 撕便签），运营遇到指针对不上的边缘情况有兜底，不再只能改库。**①仍开口**：把"运营在 Sumsub 后台新建 action"同步写回 `pendingActionExternalId` 的路径（webhook 或轮询）未做——`KYT_REJECTED_SOFT` 便签的 `caseRef` 现在能关联到 pendingAction，但新铸 action id 依旧无人写回 ｜来源: 2026-08-13 Task 14 终审 Finding 7 → 2026-08-16 ② 收口
     ```
  3. L213 那条整行改为已兑现：
     ```markdown
     - [x] ~~🔴 **冻结/解冻无统一 workflow + 无 MLRO 解冻门**~~ —— **已兑现（2026-08-16，客户生命周期轴 + 限制账）**：贴便签立即生效不开审批、撕便签按 `releasePolicy` 强制走 `CUSTOMER_RESTRICTION_RELEASE_MLRO` / `_OPS` 审批门，三个 admin 端点 + `GET /client/me/restrictions` 已建，审计复用 `CUSTOMER_RESTRICTION_ADDED/CLEARED`（SANCTION 额外写 `CUSTOMER_FROZEN`/`CUSTOMER_UNFROZEN`，本轮激活这两个零写入方常量）。关联的提现 `WithdrawSanctionRefundApprovalService.onRefundApproved()` 里那句"manual, V2 freeze API not yet built"现已可接真实调用（**未接，见下节新登记**）｜来源: 2026-07-04 V2 体检 → 2026-08-16 落地
     ```
  4. 在 L216（`## 技术债 — 平账处置（推单）` 之前）插入新一节：
     ```markdown
     ## 技术债 — 客户生命周期轴 + 限制账（2026-08-15 设计定稿，2026-08-16 落地）

     > 来源统一：`superpowers/specs/2026-08-15-customer-lifecycle-restrictions-design.md` §8 待决表。

     - [ ] **Q1 制裁客户的订单级折叠未做**：本轮贴 `scope=ALL` 便签只把在途单打成 `FROZEN`，客户面靠服务端脱敏白名单收敛成 `COMPLIANCE_PENDING`；设计稿讨论过的"收单后一律挂 `PROCESSING`、连状态变化都不产生"的订单级折叠没做。与「提现域 tipping-off 未对齐」（本文件 V5 节）同源，一并排期 ｜来源: 2026-08-15 设计稿 §8 Q1
     - [ ] **Q2 销户流程只落了轴上位置 + 三条断言**：`OFFBOARDED` 是 `lifecycle` 终态，`CustomerAccessService.assertOffboardable()` 只实现三条不变量（`OFFBOARD_BLOCKED_BY_SANCTION` / `_BY_BALANCE` / `_BY_INFLIGHT`）。真正的销户流程——余额清退、材料归档留存期、审批链、客户侧发起入口——全部未做 ｜来源: 2026-08-15 设计稿 §8 Q2
     - [ ] **Q3 `expirePendingApprovals()` 全仓无 @Cron 调用方，`timeoutHours` 是展示字段**：两个新增审批策略照现有范式写了 `timeoutHours: 48`，但平台层压根没人扫超时，48h 到点不会发生任何事。平台级缺陷，不限于本模块（`WITHDRAW_UNFREEZE` 等既有策略同病）｜来源: 2026-08-15 设计稿 §8 Q3
     - [ ] **提现制裁退款批准后的"客户账户层面升级"仍是手工**：`WithdrawSanctionRefundApprovalService.onRefundApproved()` 的审计 reason 里那句 "manual, V2 freeze API not yet built" 现在已经不成立——贴便签 API 已存在，但该处未改为真实调用 `CustomerRestrictionWorkflowService.openRestriction({cause:'SANCTION'})` ｜来源: 2026-08-04 登记 → 2026-08-16 前置依赖已就位，接线未做
     ```

- [ ] **Step 23: `doc-final/glossary/global-glossary.md` 补词条**

  1. 在 L292（`**相关概念**：ApprovalActionTypes、DEFAULT_APPROVAL_POLICIES、Checker、GOV_APPROVAL_DECIDE` 之后的 `---`）与 L294 `## 命名规范` 之间插入：

     ```markdown
     ## 限制账 / Customer Restriction（客户限制账）

     **定义**：记录"客户被摁住"这一事实的账，一行 = 一次摁住的一个能力范围（`scope`）。取代旧模型里 `adminStatus.SUSPENDED` / `complianceStatus.FROZEN` 两个专有状态列与 `restrictions` JSON 列。同一次摁住若覆盖多个能力，产生同 `restrictionNo` 的多行（`@@unique([restrictionNo, scope])`），解除时一次全撕。

     **使用场景**：制裁命中、行政暂停、材料过期、等级升级待审、交易审查未过均贴便签；`CustomerAccessService.resolve()` 把全部 OPEN 行的 scope 求并集，得出该客户被禁的能力集。贴便签立即生效不走审批，撕便签必须走审批。

     **相关概念**：cause、visibility、releasePolicy、lifecycle、CAPABILITY_RESTRICTED、restrictionNo

     ---

     ## cause（限制原因）

     **定义**：限制账的**唯一自变量**，闭集 7 值：`SANCTION`、`ADMIN_SUSPENSION`、`MATERIAL_EXPIRED`、`TIER_UPGRADE_PENDING`、`KYT_REJECTED_SOFT`、`KYT_REJECTED_HARD`、`PENDING_DOCUMENT`。默认范围、可见性、解除路径三者全部由 `cause` 查 `RESTRICTION_CAUSE_POLICY` 推出，**不由人工填写**。

     **使用场景**：`POST /admin/customers/:customerNo/restrictions` 只接受 `{cause, scopes?, reason, caseRef?}`；`scopes` 仅当 `RESTRICTION_CAUSE_POLICY[cause].scopeSelectable` 为 true（今天只有 `PENDING_DOCUMENT`）才接受，`visibility` / `releasePolicy` 出现在请求体即 400。

     **相关概念**：限制账、RESTRICTION_CAUSE_POLICY、scopeSelectable、visibility、releasePolicy

     ---

     ## visibility（限制可见性）

     **定义**：二值 `SILENT` / `DISCLOSED`，决定这次摁住能不能让客户知道。`SILENT`（`SANCTION`、`KYT_REJECTED_HARD`）在任何客户面响应里**没有任何字段可以承载**——这是结构性保证，不是"记得脱敏"的约定：后端执法读 `blocked`（含 SILENT），客户面 DTO 只允许出现 `disclosedBlocked` 与 `disclosed`（仅 DISCLOSED 贡献）。

     **使用场景**：被制裁客户的提现按钮**不置灰**——置灰本身即是信号，等于告知调查（tipping-off）。前端照常渲染可点按钮，点击后由后端 `blocked` 拒绝。e2e 用"两个客户三个客户面响应体归一化后逐字节相等"钉死这条。

     **相关概念**：tipping-off、cause、blocked / disclosedBlocked、customerLabel

     ---

     ## releasePolicy（解除路径）

     **定义**：二值 `MLRO_APPROVAL` / `OPS_APPROVAL`，决定撕这张便签要谁批。`SANCTION` 与 `KYT_REJECTED_HARD` 走 `MLRO_APPROVAL`（对应 `ApprovalActionTypes.CUSTOMER_RESTRICTION_RELEASE_MLRO`，且必填 `releaseOrderRef`，缺失 400）；其余五因走 `OPS_APPROVAL`（`..._RELEASE_OPS`）。两个 actionType 共用同一 `workflowType = CUSTOMER_RESTRICTION_RELEASE`，故二级事件同为 `workflow.customer-restriction-release.decided`。

     **使用场景**：`releaseMode` 记录这次撕是 `MANUAL`（经审批）还是 `AUTO`（如客户交齐材料后系统自动撕 `MATERIAL_EXPIRED`，只撕自己那张，多因并存不互相解）。审批案的 `entityRef` 一律传 `restrictionNo`，不是 uuid。

     **相关概念**：cause、Approval Action Policy、releaseOrderRef、releaseMode、entityRef

     ---
     ```

  2. L305-311 的编号前缀表在 `EVP` 行之后补一行：
     ```markdown
     | `RST` | Customer Restriction（客户限制账） | `restrictionNo` |
     ```

- [ ] **Step 24: `doc-final/rules/frontend-admin.md` 的 Per-entity Sidebar Fields 表补行**

  在 L160（`| **ReconciliationExternalStatement** | ... |`）之后追加：

  ```markdown
  | **CustomerRestriction** | `restrictionNo`, `status` badge, `cause`, `scopes`, `visibility`(🔇 for SILENT), `customerNo` | `openedAt`, `releasedAt` |
  ```

- [ ] **Step 25: commit 文档**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  git add doc-final/reference/truth/v2-customer-compliance.md doc-final/BACKLOG.md doc-final/glossary/global-glossary.md doc-final/rules/frontend-admin.md
  git commit -m "docs: truth v2 三轴段重写为一轴+限制账；BACKLOG 勾掉冻结/解冻无统一 workflow 与永久卡死无出口，登记 Q1/Q2/Q3；glossary 补四词条+RST 前缀；frontend-admin 补 CustomerRestriction 侧栏行"
  ```

---

#### E. 截图验收清单（业主口径：UI 一致性靠渲染截图，curl 200 不算）

- [ ] **Step 26: 起栈并登两端**

  ```bash
  cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
  bash scripts/stack.sh up main
  bash scripts/stack.sh status
  ```
  期望 `main` 行显示 backend 3000 / admin 3001 / client 3002 / TB 3003 全 `UP`。
  admin 登录 `http://localhost:3001/auth/login`，`admin@fiatx.com` / `123456`；客户端登录 `http://localhost:3002`，用 `demo_carol@example.com`、`demo_ivy@example.com`、`demo_alice@example.com`，密码均 `123456`。

  > 新增三个 admin 端点后必须确认已 `db:base:sync` 且**后端已重启**（Step 7 的 `reset-main` 两者都做了），否则前端恒 403，截图会拍到空节。

- [ ] **Step 27: 拍 admin 三张**

  1. `http://localhost:3001/customers/CU2601014327`（Carol，`customerNo` 以 Step 7 查询输出为准）→ 详情页 **Restrictions 节**：必须能看到 `SANCTION` 那行带 🔇 标记（SILENT），`scope=ALL`，状态 `OPEN`，右侧有 Release 按钮。存 `/tmp/claude-501/.../scratchpad/shot-admin-restrictions-section.png`
  2. 同页点 **Add restriction** → `RestrictionOpenModal`：截 cause 下拉展开（7 项）+ 选中 `PENDING_DOCUMENT` 时 scopes 多选出现、选中 `SANCTION` 时 scopes 禁用且不出现 visibility/releasePolicy 输入。存 `shot-admin-restriction-add-modal.png`
  3. 在 SANCTION 行点 **Release** → `RestrictionReleaseModal`：截 `releaseOrderRef` 为必填（红星/留空提交报错）+ 提示"将开 MLRO 审批案"。存 `shot-admin-restriction-release-modal.png`
     （同时确认 `CaseBoundCustomerControlModal.tsx` 已删、客户详情页再无 Freeze/Unfreeze 旧按钮。）

- [ ] **Step 28: 拍客户端三张**

  4. **并排对比**：两个浏览器窗口并排，左 `demo_carol@example.com`（SANCTION/SILENT）右 `demo_alice@example.com`（无便签），同时停在钱包/首页 —— 顶部无任何 banner、提现与兑换按钮**均为可点态**、两侧视觉零差异。存 `shot-client-sanction-vs-clean.png`
  5. 同一对并排在充值记录页（Deposit）—— 两侧列表徽章文案一致（Carol 的在途单即便后台是 `FROZEN` 也仍显示脱敏后的处理中态）。存 `shot-client-sanction-vs-clean-deposit.png`
  6. `demo_ivy@example.com`（MATERIAL_EXPIRED/DISCLOSED）：截**提示条**（标题 `Document expired` + reason 文案）+ 提现/兑换按钮**置灰**、充值按钮**仍可点**。存 `shot-client-material-expired.png`

- [ ] **Step 29: 把六张图交给业主验收**

  用 SendUserFile 一次性发出六张图，附一句对照说明（哪张对应设计稿 §7.4 的哪条）。业主逐张过；任一张与预期不符，回对应实现 task 修 UI，**不改截图口径**。
