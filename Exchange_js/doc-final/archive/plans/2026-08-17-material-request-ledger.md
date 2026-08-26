# 材料请求账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「向客户要材料」从散在四个域各自的表和列里，收成一本账（`material_requests`），一行 = 一次下发。

**Architecture:** 新增 `material_requests` 表 + `MaterialRequestsService`（实体守卫）+ `MaterialRequestIssuerService`（下发编排）。四个既有实现（充值/提现的 `*_applicant_actions`、兑换的 `customer_main.pendingAction*` 三列、材料重检的 `sumsubAction*` 三列）逐个迁到这本账上，最后统一删旧结构。客户面四个认证页收成一个 `/verification/:requestNo`。webhook 由「猜域的 if-else 链」改为按 `externalActionId` 一次查表定位。

**Tech Stack:** NestJS + Prisma/SQLite + React（admin-web / client-web）+ Jest

**Spec:** `doc-final/superpowers/specs/2026-08-17-material-request-ledger-design.md`

---

## Global Constraints

以下每一条都是**全局**约束，每个任务的验收隐含包含本节。

**G1 · Demo 数据约定（CLAUDE.md）**：本系统是 demo，数据随时可格式化重铺。schema/账本/状态机改动**直接按目标终态做**，**禁止**为旧数据写 backfill、迁移兼容层、双写过渡或向后兼容列。改完数据结构 = reset + seed。唯一例外：`prisma/migrations` 仍按正常流程新增（保证空库能从零建起），但迁移内容不必兼容已有行。

**G2 · 五条不可违反规则（CLAUDE.md）**：
1. 有持久状态、operator 可见操作 → **必须**写 `AuditLogsService`（DI 注入，禁止 `new`）
2. 多表状态变更 → **必须**用 `prisma.$transaction`
3. 有稳定业务键（`customerNo` / `requestNo` / `depositNo` …）→ **禁止**以 `id` 作主查询合同
4. **禁止**绕过 onboarding / compliance 状态门语义
5. Workflow **禁止**直接写任何 domain 实体的 Prisma 表 → 必须通过该 domain 的 service 方法

**G3 · 加法在前，删除在后**：Task 1 只**新增** `material_requests`，不动任何旧表旧列。每个域在自己的任务里迁到新账，旧结构的物理删除**统一在 Task 12**。理由：一次性删掉两张表六个列会让整棵树同时红，上一轮已为此付出过大量排障成本。

**G4 · tipping-off（spec I1）**：材料请求**只能**挂 `DISCLOSED` 类便签（`PENDING_DOCUMENT` / `MATERIAL_EXPIRED`）。`SANCTION` / `KYT_REJECTED_HARD` 这类 SILENT cause **不得**出现在下发接口的入参白名单，也不得出现在后台下拉。

**G5 · `applicantActionId` 绝不下发客户端（spec I2）**：Sumsub 侧 id 只在服务端与审计出现。客户面一律只认 `requestNo`。任务完成前用 `grep` 自查客户面 DTO 与控制器。

**G6 · 后台/客户端展示规则相反，禁止互相套用（spec §3）**：
- 后台客户详情页 = 该客户**所有**活行，无例外
- 后台订单详情页 = 该单所有活行
- 客户端订单页 = 该单活行，**且该单非终态**
- 客户端横幅 = 活行里「挂了限制的」∪「没绑单的」

**G7 · 活行定义**：`status ∈ {PENDING_SUBMISSION, SUBMITTED}`。终态 `APPROVED` / `REJECTED` / `CANCELLED` 零出边。

**G12 · spec 六条不变量的承接任务**（评审逐条追溯用）：

| 不变量 | 内容 | 承接任务 |
|---|---|---|
| **I1** | 只能挂 DISCLOSED 类便签 | Task 1（白名单 + 回查注册表的守则测试）、Task 3（`resolveCause` 拦死）、Task 6（DTO 无 cause 字段） |
| **I2** | `applicantActionId` 绝不进客户面 | Task 7（客户面投影 + 扫源码的 contract 守则测试）、Task 15 e2e ⑥ |
| **I3** | `orderDomain` / `orderRef` 同空同非空 | Task 2（`create` 校验）、Task 6（控制器校验）、Task 2（`unbindOrder` 一起置空） |
| **I4** | 每一行至少有一个客户端入口（无孤儿） | Task 5（订单终态：没挂限制的作废、挂了的解绑留客户级）、Task 11（横幅按 G6 兜底）、Task 15 e2e ②③ |
| **I5** | 建 action 必须带我方 `externalActionId` | Task 3（改 `SumsubClient`，该参数由可选改必填） |
| **I6** | 一律以 `requestNo` 为操作单位，不以 `id` | Task 6 / Task 7（两侧控制器路径参数都是业务键）、Task 14（客户端路由 `/verification/:requestNo`） |

**G8 · 不真接 Sumsub**：全程走 `SumsubClient`，`SUMSUB_MOCK_MODE=true` 时返回 mock 值。核心参数（`levelName` / `applicantActionId` / `externalActionId`）一个不少地贯穿全链路。

**G9 · 编号防撞**：`generateReferenceNo('MRQ')` 只有 4 位随机（BACKLOG:160 记载已实测撞过号）。`requestNo` 有 `@unique`，写入方**必须**捕获 P2002 重生成，最多重试 5 次。

**G10 · worktree 与栈隔离（CLAUDE.md）**：本计划在独立 worktree 执行，服务一律 `bash scripts/stack.sh up`（self 栈）。**禁止**跨栈访问，**禁止**在主工作树起临时分支跑服务。npm 脚本经 `bash scripts/on-stack.sh self <script>` 包装。

**G11 · 每个任务结束必须**：`npx tsc --noEmit` 零错 + 该任务覆盖的测试全绿 + commit。前端任务另需 `cd admin-web && npx tsc --noEmit -p tsconfig.app.json`（client-web 同理）。

---

## File Structure

### 新建

| 文件 | 职责 |
|---|---|
| `src/modules/identity/material-requests/constants/material-request.constant.ts` | 状态/来源/裁决类型枚举 + 状态机转移表 + `nextStatus()` |
| `src/modules/identity/material-requests/material-requests.service.ts` | 实体守卫：建行/提交/裁决/作废 + 审计 + 幂等 |
| `src/modules/identity/material-requests/material-request-issuer.service.ts` | 下发编排：生成 externalActionId → 调 Sumsub 建 action → 落行 → 可选开便签（单事务） |
| `src/modules/identity/material-requests/material-request-review.service.ts` | 裁决编排：GREEN 撕便签、RETRY 退回、FINAL 终态，并向订单域发事件 |
| `src/modules/identity/material-requests/material-request-order-cancel.listener.ts` | 订单进终态 → 作废/解绑 |
| `src/modules/identity/material-requests/material-requests.admin.controller.ts` | 后台四个端点 |
| `src/modules/identity/material-requests/material-requests.client.controller.ts` | 客户端三个端点 |
| `src/modules/identity/material-requests/dto/material-request.dto.ts` | 入参 DTO + 客户面/后台面视图类型 |
| `src/modules/identity/material-requests/material-requests.module.ts` | 模块装配 |
| `admin-web/src/components/MaterialRequestIssueModal.tsx` | 下发弹窗 |
| `admin-web/src/components/MaterialRequestPanel.tsx` | 列表 + 三个裁决按钮。**客户详情页与订单详情页共用这一个组件** |
| `client-web/src/pages/MaterialVerification.tsx` | 统一认证页 `/verification/:requestNo` |
| `test/material-requests.e2e-spec.ts` | 端到端六用例 |

### 修改

| 文件 | 改什么 |
|---|---|
| `prisma/schema.prisma` | +`MaterialRequest`；Task 12 删 2 表 6 列 |
| `src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts` | `createApplicantAction` 收 `externalActionId`（修 spec §1.3②） |
| `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | `applicantActionReviewed` 改按 `externalActionId` 查表；删 if-else 链 |
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | `applicant-action-result` 改收 `requestNo` + `reviewRejectType` |
| `src/modules/identity/profile-banners/profile-banners.service.ts` | 横幅数据源改材料账 |
| `src/modules/trading/deposit-transactions/*` | 摘掉 `deposit_applicant_actions` 与 `verification-session` 端点 |
| `src/modules/trading/withdraw-transactions/*` | 同上 |
| `src/modules/trading/swap-transactions/swap-transactions.service.ts` | 发 `SWAP_STATUS_CHANGED`（Q1） |
| `src/modules/swap-sumsub/applicant-action.handler.ts` + `swap-webhook-router` | 改走材料账 |
| `src/modules/identity/material-refresh/material-refresh.service.ts` | 建 cycle 时经 issuer 下发 |
| `src/common/events/domain-events.constants.ts` | +`SWAP_STATUS_CHANGED`、+`MATERIAL_REQUEST_REVIEWED` |
| `src/core/rbac/rbac.catalog.ts` + `admin-web/src/rbac/permissions.ts` | 登记后台四个端点 |
| `admin-web/src/pages/CustomerDetail.tsx` | +Verification Requests 节 |
| `admin-web/src/pages/{Deposit,Withdraw,Swap}TransactionDetail.tsx` | 镜像同一个 Panel 组件 |
| `client-web/src/App.tsx` 路由 | +`/verification/:requestNo`，删 4 条旧路由 |
| `prisma/seed.business.ts` | 播两条演示用材料请求 |

### 删除（Task 12 统一执行）

`customer-pending-action.service.ts` / `.controller.ts` / `.spec.ts`｜`material-refresh-cycles.controller.ts`｜三域 `verification-session` 端点与其 service｜`client-web/src/pages/{DepositVerification,WithdrawVerification,Verification,PendingVerification}.tsx`｜`deposit_applicant_actions` / `withdraw_applicant_actions` 两表｜`customer_main` 的 `pendingActionExternalId` / `pendingActionReason` / `pendingActionSubmittedAt` 三列｜`material_refresh_cycles` 的 `sumsubActionId` / `sumsubActionLevelName` / `sumsubActionCreatedAt` 三列

**不动**：`customer_main.hardLineDispositionedAt`（sticky 硬线标记，记的是「这个人被硬线处置过」这个持久事实，与本账无关）｜`material_refresh_cycles` 表本身及其 stage 机｜`tier_upgrade_cases`｜`customer_restrictions`

---

## 跨任务接口契约

**所有任务共用以下签名。任何任务不得自行改名或改形状。**

### 服务层

```ts
// material-requests.service.ts —— 实体守卫，只管单表不变量 + 审计
export interface IssueMaterialRequestInput {
  customerId: string;
  sumsubApplicantId: string;
  materialType: string;          // config/material-refresh-policy.json 的 materials key
  levelName: string;             // 由 materialType 经注册表推导，调用方传入
  applicantActionId: string;
  externalActionId: string;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
  origin: MaterialRequestOrigin;
  reason: string;
  issuedBy: string;              // userNo 或 'SYSTEM'
}

export interface MaterialRequestRow {
  requestNo: string;
  customerId: string;
  materialType: string;
  levelName: string;
  applicantActionId: string;     // 服务端专用，禁止进客户面响应
  externalActionId: string;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
  restrictionNo: string | null;
  origin: MaterialRequestOrigin;
  status: MaterialRequestStatus;
  reason: string;
  issuedBy: string;
  issuedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  traceId: string;
}

class MaterialRequestsService {
  create(input: IssueMaterialRequestInput, tx?: PrismaTx): Promise<MaterialRequestRow>;
  attachRestriction(requestNo: string, restrictionNo: string, tx?: PrismaTx): Promise<void>;
  findByNo(requestNo: string): Promise<MaterialRequestRow | null>;
  findByExternalActionId(externalActionId: string): Promise<MaterialRequestRow | null>;
  listLiveByCustomer(customerId: string): Promise<MaterialRequestRow[]>;
  listAllByCustomer(customerId: string): Promise<MaterialRequestRow[]>;
  listLiveByOrder(orderDomain: string, orderRef: string): Promise<MaterialRequestRow[]>;
  markSubmitted(requestNo: string, actor: MaterialActor): Promise<boolean>;  // 幂等，返回是否真的落章
  markReviewed(requestNo: string, answer: 'GREEN' | 'RED',
               rejectType: 'RETRY' | 'FINAL' | null, actor: MaterialActor): Promise<MaterialRequestRow>;
  cancel(requestNo: string, cancelReason: string, actor: MaterialActor): Promise<void>;
  unbindOrder(requestNo: string, actor: MaterialActor): Promise<void>;
}

// material-request-issuer.service.ts —— 下发编排（唯一建行入口）
class MaterialRequestIssuerService {
  issue(input: {
    customerId: string;
    materialType: string;
    orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
    orderRef: string | null;
    restrict: boolean;
    restrictScopes?: RestrictionScope[];
    restrictCause?: 'PENDING_DOCUMENT' | 'MATERIAL_EXPIRED';   // G4：只允许这两个
    origin: MaterialRequestOrigin;
    reason: string;
    issuedBy: string;
    actor: ApprovalActorContext;
  }): Promise<{ requestNo: string; restrictionNo: string | null }>;

  // 路径 1 专用：Sumsub 已经建好了 action，我们只登记
  register(input: IssueMaterialRequestInput & {
    restrict: boolean; restrictScopes?: RestrictionScope[];
    restrictCause?: 'PENDING_DOCUMENT'; actor: ApprovalActorContext;
  }): Promise<{ requestNo: string; restrictionNo: string | null }>;
}

// material-request-review.service.ts —— 裁决编排
class MaterialRequestReviewService {
  applyReview(input: {
    externalActionId: string;
    reviewAnswer: 'GREEN' | 'RED';
    reviewRejectType?: 'RETRY' | 'FINAL';
    actor: MaterialActor;
  }): Promise<{ requestNo: string; outcome: 'APPROVED' | 'RETRY' | 'REJECTED' } | null>;
  // 返回 null = 这个 externalActionId 不属于本账（调用方决定要不要继续别的路由）
}
```

### 常量

```ts
export type MaterialRequestStatus =
  | 'PENDING_SUBMISSION' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type MaterialRequestOrigin =
  | 'SUMSUB_PUSHED' | 'OPERATOR_ISSUED' | 'SYSTEM_SCHEDULED';
export const MATERIAL_REQUEST_LIVE_STATUSES = ['PENDING_SUBMISSION', 'SUBMITTED'] as const;
/** G4：下发接口只接受 DISCLOSED 类 cause，SILENT 类一律 400 */
export const ISSUABLE_RESTRICTION_CAUSES =
  ['PENDING_DOCUMENT', 'MATERIAL_EXPIRED', 'KYT_REJECTED_SOFT'] as const;
```

### HTTP 端点

| 方法 | 路径 | 谁用 | 响应 |
|---|---|---|---|
| `GET` | `/admin/customers/:customerNo/material-requests` | 后台客户详情 | `AdminMaterialRequestRow[]`（全部，含终态） |
| `GET` | `/admin/material-requests/by-order/:orderDomain/:orderRef` | 后台订单详情 | `AdminMaterialRequestRow[]` |
| `POST` | `/admin/customers/:customerNo/material-requests` | 下发弹窗 | `{ requestNo, restrictionNo }` |
| `POST` | `/admin/sumsub/simulate/applicant-action-result` | 裁决三按钮（**改既有端点**） | `{ requestNo, outcome }` |
| `GET` | `/client/me/material-requests` | 客户端横幅 + 订单页 | `ClientMaterialRequestRow[]`（仅活行，**无 applicantActionId**） |
| `GET` | `/client/me/material-requests/:requestNo/session` | 认证页 | `{ submitted: boolean; sdkToken: string \| null }` |
| `POST` | `/client/me/material-requests/:requestNo/submit` | 认证页 | `{ ok: true }`（幂等恒 2xx） |

### 事件

```ts
// domain-events.constants.ts 新增
SWAP_STATUS_CHANGED: { name: 'swap.status.changed' }          // Q1：补齐三域对称
MATERIAL_REQUEST_REVIEWED: { name: 'material-request.reviewed' }
// payload: { requestNo, customerId, orderDomain, orderRef, outcome, traceId }
```

### 客户面视图（G5：结构上装不下 applicantActionId）

```ts
export interface ClientMaterialRequestRow {
  requestNo: string;
  materialType: string;
  materialLabel: string;         // 'Proof of Address'
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  blocking: boolean;             // restrictionNo !== null
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
  reason: string;
  issuedAt: string;
}
```

---

### Task 1: `material_requests` 表 + 状态机常量

**Files:**
- Create: `src/modules/identity/material-requests/constants/material-request.constant.ts`
- Create: `src/modules/identity/material-requests/constants/material-request.constant.spec.ts` (Test)
- Modify: `prisma/schema.prisma` — 新增 `MaterialRequest` model + `CustomerMain` 上加反向关系
- Create: `prisma/migrations/<timestamp>_material_requests/migration.sql`

**Interfaces:**
- Consumes: 无（本任务是根）
- Produces: `MaterialRequestStatus` / `MaterialRequestOrigin` / `MaterialRequestAction` / `MATERIAL_REQUEST_TRANSITIONS` / `MATERIAL_REQUEST_LIVE_STATUSES` / `MATERIAL_REQUEST_TERMINAL` / `ISSUABLE_RESTRICTION_CAUSES` / `nextMaterialRequestStatus()`；Prisma model `MaterialRequest`

**G3 提醒：本任务只加不删。** 旧的 `deposit_applicant_actions` / `withdraw_applicant_actions` / `customer_main.pendingAction*` / `material_refresh_cycles.sumsubAction*` 一个都不动，它们在 Task 12 统一删。

- [ ] **Step 1: 先写失败的状态机守则测试**

新建 `src/modules/identity/material-requests/constants/material-request.constant.spec.ts`：

```ts
import { BadRequestException } from '@nestjs/common';
import { RESTRICTION_CAUSE_POLICY } from '../../customers/constants/restriction-cause.constant';
import {
  MATERIAL_REQUEST_TRANSITIONS,
  MATERIAL_REQUEST_LIVE_STATUSES,
  MATERIAL_REQUEST_TERMINAL,
  ISSUABLE_RESTRICTION_CAUSES,
  nextMaterialRequestStatus,
  type MaterialRequestStatus,
  type MaterialRequestAction,
} from './material-request.constant';

const ALL_STATUSES: MaterialRequestStatus[] = [
  'PENDING_SUBMISSION', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED',
];
const ALL_ACTIONS: MaterialRequestAction[] = [
  'SUBMIT', 'REVIEW_GREEN', 'REVIEW_RED_RETRY', 'REVIEW_RED_FINAL', 'CANCEL',
];

describe('material request state machine', () => {
  it('有且只有 6 条边 —— 多一条少一条都要在这里红', () => {
    const edges: string[] = [];
    for (const from of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        const to = MATERIAL_REQUEST_TRANSITIONS[from][action];
        if (to) edges.push(`${from} --${action}--> ${to}`);
      }
    }
    expect(edges.sort()).toEqual([
      'PENDING_SUBMISSION --CANCEL--> CANCELLED',
      'PENDING_SUBMISSION --SUBMIT--> SUBMITTED',
      'SUBMITTED --CANCEL--> CANCELLED',
      'SUBMITTED --REVIEW_GREEN--> APPROVED',
      'SUBMITTED --REVIEW_RED_FINAL--> REJECTED',
      'SUBMITTED --REVIEW_RED_RETRY--> PENDING_SUBMISSION',
    ]);
  });

  it('RETRY 回到 PENDING_SUBMISSION 而不是新状态 —— 同一个 action 重交', () => {
    expect(nextMaterialRequestStatus('SUBMITTED', 'REVIEW_RED_RETRY')).toBe('PENDING_SUBMISSION');
  });

  it('三个终态零出边', () => {
    for (const terminal of ['APPROVED', 'REJECTED', 'CANCELLED'] as MaterialRequestStatus[]) {
      expect(MATERIAL_REQUEST_TERMINAL.has(terminal)).toBe(true);
      expect(Object.keys(MATERIAL_REQUEST_TRANSITIONS[terminal])).toHaveLength(0);
    }
  });

  it('活行集合恰是两个非终态', () => {
    expect([...MATERIAL_REQUEST_LIVE_STATUSES].sort()).toEqual(['PENDING_SUBMISSION', 'SUBMITTED']);
    for (const s of MATERIAL_REQUEST_LIVE_STATUSES) {
      expect(MATERIAL_REQUEST_TERMINAL.has(s)).toBe(false);
    }
  });

  it('穷举 5×5 组合，非法边一律抛 BadRequestException 且不返回 null', () => {
    const legal = new Set([
      'PENDING_SUBMISSION|SUBMIT', 'PENDING_SUBMISSION|CANCEL',
      'SUBMITTED|REVIEW_GREEN', 'SUBMITTED|REVIEW_RED_RETRY',
      'SUBMITTED|REVIEW_RED_FINAL', 'SUBMITTED|CANCEL',
    ]);
    for (const from of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        if (legal.has(`${from}|${action}`)) continue;
        expect(() => nextMaterialRequestStatus(from, action)).toThrow(BadRequestException);
      }
    }
  });

  it('G4：白名单里每一个 cause 回查注册表都必须是 DISCLOSED', () => {
    // 不手写名字清单 —— 那样将来加 cause 时这条守则不会跟着响。
    // 直接回查限制账的注册表：只要有人往白名单里塞了 SILENT 类，这里立刻红。
    for (const cause of ISSUABLE_RESTRICTION_CAUSES) {
      expect(RESTRICTION_CAUSE_POLICY[cause].visibility).toBe('DISCLOSED');
    }
    expect(ISSUABLE_RESTRICTION_CAUSES).not.toContain('SANCTION');
    expect(ISSUABLE_RESTRICTION_CAUSES).not.toContain('KYT_REJECTED_HARD');
  });
});
```

- [ ] **Step 2: 跑测试确认它红**

```bash
npx jest src/modules/identity/material-requests
```

期望：`Cannot find module './material-request.constant'`，`Test Suites: 1 failed`。

- [ ] **Step 3: 写常量模块让它转绿**

新建 `src/modules/identity/material-requests/constants/material-request.constant.ts`：

```ts
import { BadRequestException } from '@nestjs/common';

/**
 * 材料请求账的状态机 —— 一行 = 一次下发。
 *
 * 设计稿：doc-final/superpowers/specs/2026-08-17-material-request-ledger-design.md §2.2
 *
 * 关键的一条：RED 分 RETRY 和 FINAL 两种，这是 Sumsub 的真实语义。
 * RETRY = 交的东西不合格，用**同一个 action** 重交 —— 所以它回到 PENDING_SUBMISSION，
 * applicantActionId / externalActionId / 认证链接全部不变，不是新开一行。
 * 树上三条旧路对此互不一致（swap 与 material-refresh 把任何 RED 都当 RETRY，
 * 运营无法关单；只有 onboarding.service.ts:236 分了），本表以 onboarding 为准。
 */
export type MaterialRequestStatus =
  | 'PENDING_SUBMISSION' // 已下发，等客户交
  | 'SUBMITTED' // 客户交了，等裁决
  | 'APPROVED' // 审过了（终态）
  | 'REJECTED' // RED + FINAL（终态）
  | 'CANCELLED'; // 绑的单进终态且没挂限制（终态）

export type MaterialRequestAction =
  | 'SUBMIT'
  | 'REVIEW_GREEN'
  | 'REVIEW_RED_RETRY'
  | 'REVIEW_RED_FINAL'
  | 'CANCEL';

export type MaterialRequestOrigin =
  | 'SUMSUB_PUSHED' // Sumsub 先建 action，webhook 推来
  | 'OPERATOR_ISSUED' // 运营在后台手工下发
  | 'SYSTEM_SCHEDULED'; // 到期 cron + 进件首次收集

export type MaterialRequestOrderDomain = 'DEPOSIT' | 'WITHDRAW' | 'SWAP';

export const MATERIAL_REQUEST_TRANSITIONS: Record<
  MaterialRequestStatus,
  Partial<Record<MaterialRequestAction, MaterialRequestStatus>>
> = {
  PENDING_SUBMISSION: {
    SUBMIT: 'SUBMITTED',
    CANCEL: 'CANCELLED',
  },
  SUBMITTED: {
    REVIEW_GREEN: 'APPROVED',
    // 同一个 action 重交 —— 回起点，不是新状态、更不是新行
    REVIEW_RED_RETRY: 'PENDING_SUBMISSION',
    REVIEW_RED_FINAL: 'REJECTED',
    CANCEL: 'CANCELLED',
  },
  APPROVED: {},
  REJECTED: {},
  CANCELLED: {},
};

/** 活行 = 客户还欠着这份材料。展示规则（spec §3）一律以这个集合过滤。 */
export const MATERIAL_REQUEST_LIVE_STATUSES = [
  'PENDING_SUBMISSION',
  'SUBMITTED',
] as const satisfies readonly MaterialRequestStatus[];

export const MATERIAL_REQUEST_TERMINAL: ReadonlySet<MaterialRequestStatus> =
  new Set<MaterialRequestStatus>(['APPROVED', 'REJECTED', 'CANCELLED']);

/**
 * G4 / spec I1：下发时只允许挂这两个 cause。
 * SANCTION / KYT_REJECTED_HARD 是 SILENT —— 给客户一个能点进去的认证入口，
 * 等于告诉他「你因为某个我们不能说的原因被卡住了」，那是 tipping-off。
 */
export const ISSUABLE_RESTRICTION_CAUSES = [
  'PENDING_DOCUMENT',
  'MATERIAL_EXPIRED',
  // 兑换域软线拒用的就是这个 cause（swap-workflow.service.ts:846），它是 DISCLOSED，
  // 挂材料请求安全。漏了它，Task 10 的兑换迁移会被自己的守卫拦死。
  'KYT_REJECTED_SOFT',
] as const;

export type IssuableRestrictionCause = (typeof ISSUABLE_RESTRICTION_CAUSES)[number];

/** 转移表的唯一执行入口。非法边一律抛，不返回 null、不静默留在原态。 */
export function nextMaterialRequestStatus(
  from: MaterialRequestStatus,
  action: MaterialRequestAction,
): MaterialRequestStatus {
  const to = MATERIAL_REQUEST_TRANSITIONS[from][action];
  if (!to) {
    throw new BadRequestException(
      `Invalid material request action ${action} from ${from}`,
    );
  }
  return to;
}
```

- [ ] **Step 4: 跑测试确认绿**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest src/modules/identity/material-requests
```

期望：`Tests: 6 passed`。

- [ ] **Step 5: 加 Prisma model**

在 `prisma/schema.prisma` 的 `model CustomerRestriction` 之后插入：

```prisma
model MaterialRequest {
  id                String    @id @default(uuid())
  // 业务键。客户端与后台一律以 requestNo 为操作单位（CLAUDE.md 铁律 3）。
  // 生成器只有 4 位随机（BACKLOG:160 实测撞过号），写入方必须捕 P2002 重试。
  requestNo         String    @unique

  // 材料永远是对「人」要的 —— 这一列恒非空，绑不绑单是另一回事
  customerId        String
  sumsubApplicantId String

  // 要什么材料。materialType 是 config/material-refresh-policy.json 的 materials key，
  // levelName 由它经注册表推导后落库（落库而非每次现算：保证历史行不因配置改动而变义）
  materialType      String
  levelName         String

  // Sumsub 侧 id。**只在服务端与审计出现，绝不下发客户端**（spec I2）
  applicantActionId String
  // 我方生成，铸 SDK token 的钥匙。路径 2 建 action 时即带上（修 spec §1.3②）
  externalActionId  String    @unique

  // 绑单。两列同时为空或同时非空（spec I3）
  orderDomain       String?
  orderRef          String?

  // 挂限制。**可后补** —— 到期升档时在同一行上补挂，不新开行（spec §5.3）
  restrictionNo     String?

  origin            String
  status            String    @default("PENDING_SUBMISSION")

  reason            String
  issuedBy          String
  issuedAt          DateTime  @default(now())
  submittedAt       DateTime?
  reviewedAt        DateTime?
  reviewAnswer      String?
  reviewRejectType  String?
  cancelledAt       DateTime?
  cancelReason      String?
  traceId           String

  customer CustomerMain @relation("CustomerMaterialRequests", fields: [customerId], references: [id])

  @@index([customerId, status])
  @@index([orderDomain, orderRef])
  @@index([restrictionNo])
  @@map("material_requests")
}
```

在 `model CustomerMain` 内，紧邻已有的 `restrictions` 关系行之后加一行反向关系：

```prisma
  materialRequests MaterialRequest[] @relation("CustomerMaterialRequests")
```

- [ ] **Step 6: 生成迁移并核对**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && bash scripts/stack.sh up
```

`stack.sh up` 会跑 `apply-local-migrations.sh`。**禁止用 `npx prisma migrate dev`** —— 上一轮用它导致迁移校验和无法被本地脚本核对，评审判定不可验证。手写迁移目录与 SQL：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && mkdir -p prisma/migrations/20260817000000_material_requests
```

`prisma/migrations/20260817000000_material_requests/migration.sql`：

```sql
CREATE TABLE "material_requests" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "requestNo" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "sumsubApplicantId" TEXT NOT NULL,
    "materialType" TEXT NOT NULL,
    "levelName" TEXT NOT NULL,
    "applicantActionId" TEXT NOT NULL,
    "externalActionId" TEXT NOT NULL,
    "orderDomain" TEXT,
    "orderRef" TEXT,
    "restrictionNo" TEXT,
    "origin" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_SUBMISSION',
    "reason" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL,
    "issuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" DATETIME,
    "reviewedAt" DATETIME,
    "reviewAnswer" TEXT,
    "reviewRejectType" TEXT,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "traceId" TEXT NOT NULL,
    CONSTRAINT "material_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer_main" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "material_requests_requestNo_key" ON "material_requests"("requestNo");
CREATE UNIQUE INDEX "material_requests_externalActionId_key" ON "material_requests"("externalActionId");
CREATE INDEX "material_requests_customerId_status_idx" ON "material_requests"("customerId", "status");
CREATE INDEX "material_requests_orderDomain_orderRef_idx" ON "material_requests"("orderDomain", "orderRef");
CREATE INDEX "material_requests_restrictionNo_idx" ON "material_requests"("restrictionNo");
```

- [ ] **Step 7: 应用迁移 + 生成 client + 硬闸**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && bash scripts/apply-local-migrations.sh && npm run prisma:generate && npx tsc --noEmit
```

期望：迁移显示 `applied 20260817000000_material_requests`；`prisma:generate` 成功；`tsc` 无输出。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && sqlite3 "$(grep '^DATABASE_URL=' .env | sed 's|^DATABASE_URL=file:||' | tr -d '"')" ".tables" | tr ' ' '\n' | grep material_requests
```

期望输出：`material_requests`

- [ ] **Step 8: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add prisma/schema.prisma prisma/migrations src/modules/identity/material-requests && git commit -m "feat(material-requests): 材料请求账建表 + 状态机常量

一行 = 一次下发。RED 分 RETRY / FINAL：RETRY 回 PENDING_SUBMISSION 用同一个
action 重交（链接不变），FINAL 才是终态。守则测试锁死 6 条边并穷举 5×5 组合。

本任务只加不删（G3）——旧的两表六列在 Task 12 统一删。"
```

---

### Task 2: `MaterialRequestsService` —— 实体守卫

**Files:**
- Create: `src/modules/identity/material-requests/material-requests.service.ts`
- Create: `src/modules/identity/material-requests/material-requests.service.spec.ts` (Test)
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts` — 加 1 个 entityType、1 个 workflowType、7 个 action

**Interfaces:**
- Consumes: Task 1 的 `nextMaterialRequestStatus()` / `MATERIAL_REQUEST_LIVE_STATUSES` / 各类型；`generateReferenceNo` from `src/common/utils/no-generator.util`
- Produces: `MaterialRequestsService`，方法签名见「跨任务接口契约 · 服务层」，一字不改

**本服务只守单表不变量 + 审计。** 开便签、调 Sumsub、发事件全部不在这里 —— 那是 Task 3 / Task 4 的编排层。

⚠️ `AuditBusinessWorkflowTypes` 被 `audit-logs.service.spec.ts` 的守则性测试**整表冻结**。加值必须同步更新那个测试的期望列表，不要绕过它（上一轮在此被逮过一次）。

- [ ] **Step 1: 先加审计常量**

`src/modules/audit-logging/constants/audit-actions.constant.ts`：

`AuditEntityTypes` 内加一行：

```ts
  MATERIAL_REQUEST: 'MATERIAL_REQUEST',
```

`AuditBusinessWorkflowTypes` 内加一行：

```ts
  // 材料请求账（2026-08-17）：下发 / 提交 / 裁决 / 作废共用一个 workflowType
  MATERIAL_REQUEST: 'MATERIAL_REQUEST',
```

`AuditActions` 内加七行：

```ts
  MATERIAL_REQUEST_ISSUED: 'MATERIAL_REQUEST_ISSUED',
  MATERIAL_REQUEST_SUBMITTED: 'MATERIAL_REQUEST_SUBMITTED',
  MATERIAL_REQUEST_APPROVED: 'MATERIAL_REQUEST_APPROVED',
  MATERIAL_REQUEST_RETRY_REQUESTED: 'MATERIAL_REQUEST_RETRY_REQUESTED',
  MATERIAL_REQUEST_REJECTED: 'MATERIAL_REQUEST_REJECTED',
  MATERIAL_REQUEST_CANCELLED: 'MATERIAL_REQUEST_CANCELLED',
  MATERIAL_REQUEST_ORDER_UNBOUND: 'MATERIAL_REQUEST_ORDER_UNBOUND',
```

同步 `src/modules/audit-logging/audit-logs.service.spec.ts` 里冻结 `AuditBusinessWorkflowTypes` 的那条守则测试的期望列表，加入 `MATERIAL_REQUEST`。

```bash
npx jest src/modules/audit-logging
```

期望：全绿（若红，说明冻结表期望没同步，按提示补上）。

- [ ] **Step 2: 写失败的 service 测试**

新建 `src/modules/identity/material-requests/material-requests.service.spec.ts`：

```ts
import { MaterialRequestsService } from './material-requests.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const ACTOR = { actorType: 'ADMIN' as const, actorId: 'u1', actorNo: 'ADM001', actorRole: 'MLRO' };

function baseRow(over: Record<string, any> = {}) {
  return {
    id: 'r1', requestNo: 'MRQ2608170001', customerId: 'c1', sumsubApplicantId: 'app-1',
    materialType: 'PROOF_OF_ADDRESS', levelName: 'wave3-action-poa-refresh',
    applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: null, orderRef: null, restrictionNo: null,
    origin: 'OPERATOR_ISSUED', status: 'PENDING_SUBMISSION',
    reason: 'why', issuedBy: 'ADM001', issuedAt: new Date('2026-08-17T00:00:00Z'),
    submittedAt: null, reviewedAt: null, reviewAnswer: null, reviewRejectType: null,
    cancelledAt: null, cancelReason: null, traceId: 'MATERIAL_REQUEST:t1',
    ...over,
  };
}

function createPrismaMock() {
  const tx = {
    customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001' }) },
    materialRequest: {
      create: jest.fn(async ({ data }: any) => ({ ...baseRow(), ...data })),
      findUnique: jest.fn().mockResolvedValue(baseRow()),
      update: jest.fn(async ({ data }: any) => ({ ...baseRow(), ...data })),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };
  const prisma = {
    customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', customerNo: 'CUS-001' }) },
    materialRequest: {
      create: tx.materialRequest.create,
      findUnique: jest.fn().mockResolvedValue(baseRow()),
      findFirst: jest.fn().mockResolvedValue(baseRow()),
      findMany: jest.fn().mockResolvedValue([]),
      update: tx.materialRequest.update,
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn((cb: any) => cb(tx)),
  } as any;
  return { prisma, tx };
}

const audit = () => ({ recordSystem: jest.fn().mockResolvedValue(undefined),
                       recordByActor: jest.fn().mockResolvedValue(undefined) } as any);

const INPUT = {
  customerId: 'c1', sumsubApplicantId: 'app-1', materialType: 'PROOF_OF_ADDRESS',
  levelName: 'wave3-action-poa-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
  orderDomain: null, orderRef: null, origin: 'OPERATOR_ISSUED' as const,
  reason: 'why', issuedBy: 'ADM001',
};

describe('MaterialRequestsService.create', () => {
  it('落库带 requestNo / traceId，status 起于 PENDING_SUBMISSION', async () => {
    const { prisma } = createPrismaMock();
    const svc = new MaterialRequestsService(prisma, audit());
    const row = await svc.create(INPUT);
    expect(row.requestNo).toMatch(/^MRQ\d{10}$/);
    expect(row.status).toBe('PENDING_SUBMISSION');
    expect(row.traceId).toMatch(/^MATERIAL_REQUEST:/);
  });

  it('G9：requestNo 撞号（P2002）自动重生成重试，不把 P2002 抛给调用方', async () => {
    const { prisma } = createPrismaMock();
    const p2002 = Object.assign(new Error('unique'), { code: 'P2002' });
    prisma.materialRequest.create
      .mockRejectedValueOnce(p2002)
      .mockImplementationOnce(async ({ data }: any) => ({ ...baseRow(), ...data }));
    const svc = new MaterialRequestsService(prisma, audit());
    await expect(svc.create(INPUT)).resolves.toMatchObject({ status: 'PENDING_SUBMISSION' });
    expect(prisma.materialRequest.create).toHaveBeenCalledTimes(2);
    const first = prisma.materialRequest.create.mock.calls[0][0].data.requestNo;
    const second = prisma.materialRequest.create.mock.calls[1][0].data.requestNo;
    expect(second).not.toBe(first);
  });

  it('spec I3：orderDomain 与 orderRef 半绑 → BadRequest', async () => {
    const { prisma } = createPrismaMock();
    const svc = new MaterialRequestsService(prisma, audit());
    await expect(svc.create({ ...INPUT, orderDomain: 'DEPOSIT', orderRef: null } as any))
      .rejects.toThrow(BadRequestException);
    await expect(svc.create({ ...INPUT, orderDomain: null, orderRef: 'DP1' } as any))
      .rejects.toThrow(BadRequestException);
  });

  it('写一条 MATERIAL_REQUEST_ISSUED 审计', async () => {
    const { prisma } = createPrismaMock();
    const a = audit();
    await new MaterialRequestsService(prisma, a).create(INPUT);
    expect(a.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATERIAL_REQUEST_ISSUED', entityType: 'MATERIAL_REQUEST' }),
    );
  });
});

describe('MaterialRequestsService.markSubmitted', () => {
  it('write-once：首次落章返回 true 并写审计', async () => {
    const { prisma } = createPrismaMock();
    const a = audit();
    const svc = new MaterialRequestsService(prisma, a);
    await expect(svc.markSubmitted('MRQ2608170001', ACTOR)).resolves.toBe(true);
    expect(prisma.materialRequest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requestNo: 'MRQ2608170001', status: 'PENDING_SUBMISSION' }),
      }),
    );
    expect(a.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'MATERIAL_REQUEST_SUBMITTED' }), expect.anything(),
    );
  });

  it('重复提交静默返回 false，不重复写审计（幂等恒成功，不吐状态机信息）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    const a = audit();
    await expect(new MaterialRequestsService(prisma, a).markSubmitted('MRQ2608170001', ACTOR))
      .resolves.toBe(false);
    expect(a.recordByActor).not.toHaveBeenCalled();
  });
});

describe('MaterialRequestsService.markReviewed', () => {
  it('GREEN → APPROVED', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'SUBMITTED' }));
    const row = await new MaterialRequestsService(prisma, audit())
      .markReviewed('MRQ2608170001', 'GREEN', null, ACTOR);
    expect(row.status).toBe('APPROVED');
  });

  it('RED+RETRY → 回 PENDING_SUBMISSION 且清 submittedAt，externalActionId 不变', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(
      baseRow({ status: 'SUBMITTED', submittedAt: new Date() }),
    );
    const row = await new MaterialRequestsService(prisma, audit())
      .markReviewed('MRQ2608170001', 'RED', 'RETRY', ACTOR);
    expect(row.status).toBe('PENDING_SUBMISSION');
    expect(prisma.materialRequest.update.mock.calls[0][0].data.submittedAt).toBeNull();
    expect(row.externalActionId).toBe('ext-1');
  });

  it('RED+FINAL → REJECTED 终态', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'SUBMITTED' }));
    const row = await new MaterialRequestsService(prisma, audit())
      .markReviewed('MRQ2608170001', 'RED', 'FINAL', ACTOR);
    expect(row.status).toBe('REJECTED');
  });

  it('RED 不带 rejectType → BadRequest（不许默默当成 FINAL 关单）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'SUBMITTED' }));
    await expect(new MaterialRequestsService(prisma, audit())
      .markReviewed('MRQ2608170001', 'RED', null, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('对已终态的行裁决 → BadRequest（状态机零出边）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(baseRow({ status: 'APPROVED' }));
    await expect(new MaterialRequestsService(prisma, audit())
      .markReviewed('MRQ2608170001', 'GREEN', null, ACTOR)).rejects.toThrow(BadRequestException);
  });

  it('行不存在 → NotFound', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(null);
    await expect(new MaterialRequestsService(prisma, audit())
      .markReviewed('NOPE', 'GREEN', null, ACTOR)).rejects.toThrow(NotFoundException);
  });
});

describe('MaterialRequestsService 查询侧', () => {
  it('listLiveByCustomer 只查两个活状态', async () => {
    const { prisma } = createPrismaMock();
    await new MaterialRequestsService(prisma, audit()).listLiveByCustomer('c1');
    expect(prisma.materialRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerId: 'c1', status: { in: ['PENDING_SUBMISSION', 'SUBMITTED'] } },
      }),
    );
  });

  it('listAllByCustomer 不带 status 过滤（后台要看全部，G6）', async () => {
    const { prisma } = createPrismaMock();
    await new MaterialRequestsService(prisma, audit()).listAllByCustomer('c1');
    const where = prisma.materialRequest.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ customerId: 'c1' });
  });
});

describe('MaterialRequestsService.unbindOrder', () => {
  it('解绑把两列一起置空（spec I3 同空同非空）', async () => {
    const { prisma } = createPrismaMock();
    prisma.materialRequest.findUnique.mockResolvedValue(
      baseRow({ orderDomain: 'DEPOSIT', orderRef: 'DP1', restrictionNo: 'RST1' }),
    );
    await new MaterialRequestsService(prisma, audit()).unbindOrder('MRQ2608170001', ACTOR);
    const data = prisma.materialRequest.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ orderDomain: null, orderRef: null });
  });
});
```

- [ ] **Step 3: 跑测试确认它红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest src/modules/identity/material-requests/material-requests.service.spec.ts
```

期望：`Cannot find module './material-requests.service'`。

- [ ] **Step 4: 写 service 让测试转绿**

新建 `src/modules/identity/material-requests/material-requests.service.ts`：

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import {
  AuditActions,
  AuditEntityTypes,
  AuditBusinessWorkflowTypes,
} from '../../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../../audit-logging/dto/audit-log.dto';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import {
  MATERIAL_REQUEST_LIVE_STATUSES,
  nextMaterialRequestStatus,
  type MaterialRequestOrderDomain,
  type MaterialRequestOrigin,
  type MaterialRequestStatus,
} from './constants/material-request.constant';

export interface MaterialActor {
  actorType: 'ADMIN' | 'CUSTOMER' | 'SYSTEM';
  actorId: string;
  actorNo?: string;
  actorRole?: string;
}

export interface IssueMaterialRequestInput {
  customerId: string;
  sumsubApplicantId: string;
  materialType: string;
  levelName: string;
  applicantActionId: string;
  externalActionId: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  origin: MaterialRequestOrigin;
  reason: string;
  issuedBy: string;
}

export interface MaterialRequestRow {
  requestNo: string;
  customerId: string;
  materialType: string;
  levelName: string;
  /** Sumsub 侧 id —— 服务端专用，禁止进任何客户面响应（spec I2 / G5） */
  applicantActionId: string;
  externalActionId: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  restrictionNo: string | null;
  origin: MaterialRequestOrigin;
  status: MaterialRequestStatus;
  reason: string;
  issuedBy: string;
  issuedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  traceId: string;
}

const REQUEST_NO_MAX_ATTEMPTS = 5;

/**
 * 材料请求账的实体守卫 —— 设计稿 2026-08-17 §2。
 *
 * 一行 = 一次下发。本 service **只**守单表不变量（状态机、同空同非空、幂等、编号防撞）
 * 与审计；开便签 / 调 Sumsub / 发域事件全在编排层（issuer / review service），
 * 不在这里。
 */
@Injectable()
export class MaterialRequestsService {
  constructor(
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  async create(
    input: IssueMaterialRequestInput,
    tx?: Record<string, any>,
  ): Promise<MaterialRequestRow> {
    // spec I3：半绑状态无法判定展示位置，直接拒
    const bound = input.orderDomain !== null;
    if (bound !== (input.orderRef !== null)) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_HALF_BOUND',
        message: 'orderDomain and orderRef must both be set or both be null',
      });
    }

    const client = (tx ?? this.prisma) as Record<string, any>;
    const traceId = `MATERIAL_REQUEST:${randomUUID()}`;

    // G9：generateReferenceNo 只有 4 位随机，BACKLOG:160 记载实测撞过号。
    // requestNo 有 @unique，撞了是 P2002 —— 重生成重试，别把它抛给调用方。
    let created: any = null;
    for (let attempt = 0; attempt < REQUEST_NO_MAX_ATTEMPTS; attempt += 1) {
      try {
        created = await client.materialRequest.create({
          data: {
            requestNo: generateReferenceNo('MRQ'),
            customerId: input.customerId,
            sumsubApplicantId: input.sumsubApplicantId,
            materialType: input.materialType,
            levelName: input.levelName,
            applicantActionId: input.applicantActionId,
            externalActionId: input.externalActionId,
            orderDomain: input.orderDomain,
            orderRef: input.orderRef,
            origin: input.origin,
            status: 'PENDING_SUBMISSION',
            reason: input.reason,
            issuedBy: input.issuedBy,
            traceId,
          },
        });
        break;
      } catch (e: any) {
        // externalActionId 也是 @unique —— 那个撞号不该重试（重试会造出第二行
        // 指向同一个 Sumsub action），只有 requestNo 撞才重试。
        const target = String(e?.meta?.target ?? '');
        if (e?.code === 'P2002' && !target.includes('externalActionId')) continue;
        throw e;
      }
    }
    if (!created) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_NO_COLLISION',
        message: `Failed to allocate a unique requestNo after ${REQUEST_NO_MAX_ATTEMPTS} attempts`,
      });
    }

    await this.auditLogsService.recordSystem({
      action: AuditActions.MATERIAL_REQUEST_ISSUED,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: created.id,
      entityNo: created.requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: input.customerId,
      result: AuditResult.SUCCESS,
      reason: input.reason,
      metadata: {
        materialType: input.materialType,
        levelName: input.levelName,
        origin: input.origin,
        orderDomain: input.orderDomain,
        orderRef: input.orderRef,
        applicantActionId: input.applicantActionId,
      },
      sourcePlatform: 'SYSTEM',
    });

    return this.project(created);
  }

  async attachRestriction(
    requestNo: string,
    restrictionNo: string,
    tx?: Record<string, any>,
  ): Promise<void> {
    const client = (tx ?? this.prisma) as Record<string, any>;
    await client.materialRequest.update({
      where: { requestNo },
      data: { restrictionNo },
    });
  }

  async findByNo(requestNo: string): Promise<MaterialRequestRow | null> {
    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    return row ? this.project(row) : null;
  }

  async findByExternalActionId(externalActionId: string): Promise<MaterialRequestRow | null> {
    const row = await this.prisma.materialRequest.findFirst({ where: { externalActionId } });
    return row ? this.project(row) : null;
  }

  async listLiveByCustomer(customerId: string): Promise<MaterialRequestRow[]> {
    const rows = await this.prisma.materialRequest.findMany({
      where: { customerId, status: { in: [...MATERIAL_REQUEST_LIVE_STATUSES] } },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r: any) => this.project(r));
  }

  /** 后台客户详情用：全集，含终态（G6 —— 后台那一列全是「露」，没有例外） */
  async listAllByCustomer(customerId: string): Promise<MaterialRequestRow[]> {
    const rows = await this.prisma.materialRequest.findMany({
      where: { customerId },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r: any) => this.project(r));
  }

  async listLiveByOrder(
    orderDomain: MaterialRequestOrderDomain,
    orderRef: string,
  ): Promise<MaterialRequestRow[]> {
    const rows = await this.prisma.materialRequest.findMany({
      where: { orderDomain, orderRef, status: { in: [...MATERIAL_REQUEST_LIVE_STATUSES] } },
      orderBy: { issuedAt: 'desc' },
    });
    return rows.map((r: any) => this.project(r));
  }

  /**
   * 客户提交回执。幂等恒成功：write-once 条件更新，只在 PENDING_SUBMISSION 时落章。
   * 重复提交 / 状态不对一律静默返回 false —— 与充值/提现 submit 端点同款
   * 「恒 2xx、不吐状态机信息」姿态，别让客户从错误码里读出自己的处境。
   */
  async markSubmitted(requestNo: string, actor: MaterialActor): Promise<boolean> {
    const res = await this.prisma.materialRequest.updateMany({
      where: { requestNo, status: 'PENDING_SUBMISSION' },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    if (res.count === 0) return false;

    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.MATERIAL_REQUEST_SUBMITTED,
        entityType: AuditEntityTypes.MATERIAL_REQUEST,
        entityId: row?.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
        traceId: row?.traceId,
        result: AuditResult.SUCCESS,
        reason: 'Customer submitted requested materials',
      },
      {
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole ?? 'CUSTOMER',
      },
    );
    return true;
  }

  /**
   * 落裁决。RED 必须带 rejectType —— 不许默默当成 FINAL 把单关掉，
   * 也不许默默当成 RETRY 让运营永远关不了单（树上两条旧路各犯了其中一个）。
   */
  async markReviewed(
    requestNo: string,
    answer: 'GREEN' | 'RED',
    rejectType: 'RETRY' | 'FINAL' | null,
    actor: MaterialActor,
  ): Promise<MaterialRequestRow> {
    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    if (!row) throw new NotFoundException(`Material request not found: ${requestNo}`);

    if (answer === 'RED' && rejectType !== 'RETRY' && rejectType !== 'FINAL') {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_REJECT_TYPE_REQUIRED',
        message: "RED review must carry reviewRejectType 'RETRY' or 'FINAL'",
      });
    }

    const action =
      answer === 'GREEN'
        ? 'REVIEW_GREEN'
        : rejectType === 'RETRY'
          ? 'REVIEW_RED_RETRY'
          : 'REVIEW_RED_FINAL';
    // 非法边（含对终态行裁决）在这里抛 BadRequestException
    const nextStatus = nextMaterialRequestStatus(row.status as MaterialRequestStatus, action);

    const updated = await this.prisma.materialRequest.update({
      where: { requestNo },
      data: {
        status: nextStatus,
        reviewAnswer: answer,
        reviewRejectType: rejectType,
        reviewedAt: new Date(),
        // RETRY 是「用同一个 action 重交」：清提交章让客户能再进认证页，
        // applicantActionId / externalActionId 一个都不动（spec §2.2）
        ...(action === 'REVIEW_RED_RETRY' ? { submittedAt: null } : {}),
      },
    });

    const auditAction =
      action === 'REVIEW_GREEN'
        ? AuditActions.MATERIAL_REQUEST_APPROVED
        : action === 'REVIEW_RED_RETRY'
          ? AuditActions.MATERIAL_REQUEST_RETRY_REQUESTED
          : AuditActions.MATERIAL_REQUEST_REJECTED;

    await this.auditLogsService.recordSystem({
      action: auditAction,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: row.id,
      entityNo: requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId: row.traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      result: AuditResult.SUCCESS,
      reason: `Sumsub action review ${answer}${rejectType ? ` (${rejectType})` : ''}`,
      metadata: { reviewAnswer: answer, reviewRejectType: rejectType, decidedBy: actor.actorNo ?? actor.actorId },
      sourcePlatform: 'SYSTEM',
    });

    return this.project(updated);
  }

  async cancel(requestNo: string, cancelReason: string, actor: MaterialActor): Promise<void> {
    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    if (!row) throw new NotFoundException(`Material request not found: ${requestNo}`);
    nextMaterialRequestStatus(row.status as MaterialRequestStatus, 'CANCEL');

    await this.prisma.materialRequest.update({
      where: { requestNo },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.MATERIAL_REQUEST_CANCELLED,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: row.id,
      entityNo: requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId: row.traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      result: AuditResult.SUCCESS,
      reason: cancelReason,
      metadata: { cancelledBy: actor.actorNo ?? actor.actorId },
      sourcePlatform: 'SYSTEM',
    });
  }

  /**
   * 解绑订单。挂了限制的行在订单进终态时走这条 —— 从订单页撤下，
   * 但「这个人还欠这份材料」这件事留在客户级横幅上（spec §5.1 第二条）。
   */
  async unbindOrder(requestNo: string, actor: MaterialActor): Promise<void> {
    const row = await this.prisma.materialRequest.findUnique({ where: { requestNo } });
    if (!row) throw new NotFoundException(`Material request not found: ${requestNo}`);

    await this.prisma.materialRequest.update({
      where: { requestNo },
      // spec I3：两列同空同非空，解绑必须一起置空
      data: { orderDomain: null, orderRef: null },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.MATERIAL_REQUEST_ORDER_UNBOUND,
      entityType: AuditEntityTypes.MATERIAL_REQUEST,
      entityId: row.id,
      entityNo: requestNo,
      workflowType: AuditBusinessWorkflowTypes.MATERIAL_REQUEST,
      traceId: row.traceId,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      result: AuditResult.SUCCESS,
      reason: `Order ${row.orderDomain}/${row.orderRef} reached a terminal state; restriction-bearing request kept at customer level`,
      metadata: { unboundBy: actor.actorNo ?? actor.actorId },
      sourcePlatform: 'SYSTEM',
    });
  }

  private project(row: any): MaterialRequestRow {
    return {
      requestNo: row.requestNo,
      customerId: row.customerId,
      materialType: row.materialType,
      levelName: row.levelName,
      applicantActionId: row.applicantActionId,
      externalActionId: row.externalActionId,
      orderDomain: row.orderDomain ?? null,
      orderRef: row.orderRef ?? null,
      restrictionNo: row.restrictionNo ?? null,
      origin: row.origin,
      status: row.status,
      reason: row.reason,
      issuedBy: row.issuedBy,
      issuedAt: row.issuedAt,
      submittedAt: row.submittedAt ?? null,
      reviewedAt: row.reviewedAt ?? null,
      reviewAnswer: row.reviewAnswer ?? null,
      reviewRejectType: row.reviewRejectType ?? null,
      cancelledAt: row.cancelledAt ?? null,
      cancelReason: row.cancelReason ?? null,
      traceId: row.traceId,
    };
  }
}
```

- [ ] **Step 5: 跑测试确认绿 + tsc**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest src/modules/identity/material-requests && npx tsc --noEmit
```

期望：`Tests: 18 passed`（6 常量 + 12 service）；`tsc` 无输出。

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/identity/material-requests src/modules/audit-logging && git commit -m "feat(material-requests): 实体守卫 service

只守单表不变量 + 审计：状态机（含 RED 必须带 rejectType）、orderDomain/orderRef
同空同非空、markSubmitted write-once 幂等、requestNo 撞 P2002 重生成重试。
开便签 / 调 Sumsub / 发域事件都不在这里，那是编排层的事。

externalActionId 撞号刻意不重试 —— 重试会造出第二行指向同一个 Sumsub action。"
```

---

### Task 3: 修 `createApplicantAction` 的 external id 坑 + `MaterialRequestIssuerService`

**Files:**
- Modify: `src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts:104-116`
- Create: `src/modules/identity/material-requests/material-request-issuer.service.ts`
- Create: `src/modules/identity/material-requests/material-request-issuer.service.spec.ts` (Test)
- Create: `src/modules/identity/material-requests/material-requests.module.ts`

**Interfaces:**
- Consumes: Task 2 的 `MaterialRequestsService.create()` / `.attachRestriction()`；`CustomerRestrictionWorkflowService.openRestriction(input, actor)`（既有）；`MaterialRefreshPolicyLoader.getMaterialConfig(materialType)`（既有，`config/material-refresh-policy.json`）
- Produces: `MaterialRequestIssuerService.issue()` / `.register()`，签名见「跨任务接口契约」

**这个任务修 spec §1.3② 那个坑。** `createApplicantAction` 今天 POST 的是空 `{}`，我方手里没有铸 SDK token 的钥匙 —— 源码注释已自陈此事并登记 BACKLOG。路径 2 必须在建 action 时就把我方 `externalActionId` 带上。

**关键接线**：开便签时 `caseRef` 传 `requestNo`。`CustomerRestrictionWorkflowService.autoRelease(customerId, cause, caseRef, actorId)` 是按 `(customerId, cause, caseRef)` 找便签的，不认 `restrictionNo` —— 用 requestNo 当 caseRef，Task 4 的自动撕就不用改 autoRelease，而且限制账的幂等键天然变成「一次下发一张便签」。

- [ ] **Step 1: 改 SumsubClient**

`src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`，把 `createApplicantAction` 整个方法替换为：

```ts
  /**
   * 建一条 applicant action。
   *
   * `externalActionId` 是**我方**生成并持有的 id，必须在建的时候就传给 Sumsub：
   * 后面铸 SDK token（createActionSdkToken）要拿它当钥匙，webhook 回来也靠它
   * 认领归属。此前这里 POST 的是空 `{}`，导致材料重检那条路建出来的 action
   * 我方手里没有钥匙 —— 修于 2026-08-17 材料请求账。
   */
  async createApplicantAction(input: {
    applicantId: string;
    levelName: string;
    externalActionId: string;
  }): Promise<{ id: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      const { randomUUID } = await import('crypto');
      return { id: `mock-action-${randomUUID()}` };
    }
    return this.post(
      `/resources/applicantActions/-/forApplicant/${input.applicantId}?levelName=${encodeURIComponent(input.levelName)}`,
      { externalActionId: input.externalActionId },
    );
  }
```

同时把 `createActionSdkToken` 的 `externalActionId?: string` 改为必填 `externalActionId: string`，并删掉它上方那段解释「为什么可选」的注释（坑已修，注释过期）：

```ts
  async createActionSdkToken(input: {
    applicantId: string;
    levelName: string;
    /** applicant action 场景官方必填。建 action 时已带上，此处必然有值。 */
    externalActionId: string;
    ttlInSecs?: number;
  }): Promise<{ token: string }> {
```

- [ ] **Step 2: 跑 tsc 看谁被打断**

```bash
npx tsc --noEmit
```

期望：报错指向 `material-refresh.service.ts:69` / `:373`（两处 `createApplicantAction` 少传 `externalActionId`）与 `material-refresh-cycles.controller.ts:106`（`createActionSdkToken` 少传）。**这三处先用最小改动喂过编译**，真正的迁移在 Task 11：

`material-refresh.service.ts` 两处调用各自在上方生成一个 id 并传入（Task 11 会把整段换成走 issuer）：

```ts
      const externalActionId = `MRQ-LEGACY:${randomUUID()}`;
      const action = await this.sumsubClient.createApplicantAction({
        applicantId: customer.sumsubApplicantId,
        levelName: materialConfig.sumsubActionLevelName,
        externalActionId,
      });
```

`material-refresh-cycles.controller.ts:106` 的 `createActionSdkToken` 调用补 `externalActionId: cycle.sumsubActionId ?? ''`（Task 11 整个控制器会删掉）。

再跑一次 `npx tsc --noEmit`，期望无输出。

- [ ] **Step 3: 写失败的 issuer 测试**

新建 `src/modules/identity/material-requests/material-request-issuer.service.spec.ts`：

```ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MaterialRequestIssuerService } from './material-request-issuer.service';

const ACTOR = { actorType: 'ADMIN' as const, userId: 'u1', userNo: 'ADM001', role: 'MLRO', roleCodes: ['MLRO'] };

function deps(over: Record<string, any> = {}) {
  const prisma = {
    customerMain: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'c1', customerNo: 'CUS-001', sumsubApplicantId: 'app-1',
      }),
    },
    $transaction: jest.fn((cb: any) => cb({ __tx: true })),
  } as any;
  const requests = {
    create: jest.fn().mockResolvedValue({ requestNo: 'MRQ2608170001', customerId: 'c1' }),
    attachRestriction: jest.fn().mockResolvedValue(undefined),
  } as any;
  const restrictionWorkflow = {
    openRestriction: jest.fn().mockResolvedValue({ restrictionNo: 'RST2608170001', created: true }),
  } as any;
  const sumsub = {
    createApplicantAction: jest.fn().mockResolvedValue({ id: 'mock-action-xyz' }),
  } as any;
  const policy = {
    getMaterialConfig: jest.fn().mockReturnValue({
      sumsubActionLevelName: 'wave3-action-poa-refresh',
      enforceRestriction: true,
      managementMode: 'SELF_MANAGED',
      requiredForLevels: [],
    }),
  } as any;
  return { prisma, requests, restrictionWorkflow, sumsub, policy, ...over };
}

function build(d: ReturnType<typeof deps>) {
  return new MaterialRequestIssuerService(d.prisma, d.requests, d.restrictionWorkflow, d.sumsub, d.policy);
}

const BASE = {
  customerId: 'c1', materialType: 'PROOF_OF_ADDRESS',
  orderDomain: null, orderRef: null, restrict: false,
  origin: 'OPERATOR_ISSUED' as const, reason: 'need PoA', issuedBy: 'ADM001', actor: ACTOR,
};

describe('MaterialRequestIssuerService.issue', () => {
  it('levelName 由注册表推导，不由调用方手打', async () => {
    const d = deps();
    await build(d).issue(BASE);
    expect(d.policy.getMaterialConfig).toHaveBeenCalledWith('PROOF_OF_ADDRESS');
    expect(d.requests.create.mock.calls[0][0].levelName).toBe('wave3-action-poa-refresh');
  });

  it('建 action 时把我方 externalActionId 传给 Sumsub（修 spec §1.3②）', async () => {
    const d = deps();
    await build(d).issue(BASE);
    const passed = d.sumsub.createApplicantAction.mock.calls[0][0];
    expect(passed.externalActionId).toEqual(expect.any(String));
    expect(passed.externalActionId.length).toBeGreaterThan(0);
    // 传给 Sumsub 的那个 id 与落库的必须是同一个，否则铸不出 token
    expect(d.requests.create.mock.calls[0][0].externalActionId).toBe(passed.externalActionId);
  });

  it('落库的 applicantActionId 用 Sumsub 返回的 id', async () => {
    const d = deps();
    await build(d).issue(BASE);
    expect(d.requests.create.mock.calls[0][0].applicantActionId).toBe('mock-action-xyz');
  });

  it('restrict=false 时不开便签，返回 restrictionNo=null', async () => {
    const d = deps();
    const out = await build(d).issue(BASE);
    expect(d.restrictionWorkflow.openRestriction).not.toHaveBeenCalled();
    expect(out.restrictionNo).toBeNull();
  });

  it('restrict=true 时开便签，caseRef 用 requestNo（autoRelease 靠它找便签）', async () => {
    const d = deps();
    const out = await build(d).issue({ ...BASE, restrict: true, restrictScopes: ['WITHDRAW'] });
    const opened = d.restrictionWorkflow.openRestriction.mock.calls[0][0];
    expect(opened.cause).toBe('PENDING_DOCUMENT');
    expect(opened.caseRef).toBe('MRQ2608170001');
    expect(opened.scopes).toEqual(['WITHDRAW']);
    expect(out.restrictionNo).toBe('RST2608170001');
    expect(d.requests.attachRestriction).toHaveBeenCalledWith(
      'MRQ2608170001', 'RST2608170001', expect.anything(),
    );
  });

  it('G4：restrictCause 传 SILENT 类 → BadRequest，绝不落地', async () => {
    const d = deps();
    await expect(
      build(d).issue({ ...BASE, restrict: true, restrictCause: 'SANCTION' as any }),
    ).rejects.toThrow(BadRequestException);
    expect(d.sumsub.createApplicantAction).not.toHaveBeenCalled();
    expect(d.requests.create).not.toHaveBeenCalled();
  });

  it('未知 materialType → BadRequest（注册表说了算）', async () => {
    const d = deps();
    d.policy.getMaterialConfig.mockReturnValue(null);
    await expect(build(d).issue({ ...BASE, materialType: 'NOPE' })).rejects.toThrow(BadRequestException);
  });

  it('客户没有 sumsubApplicantId → BadRequest（没 applicant 就没法建 action）', async () => {
    const d = deps();
    d.prisma.customerMain.findFirst.mockResolvedValue({ id: 'c1', customerNo: 'CUS-001', sumsubApplicantId: null });
    await expect(build(d).issue(BASE)).rejects.toThrow(BadRequestException);
  });

  it('客户不存在 → NotFound', async () => {
    const d = deps();
    d.prisma.customerMain.findFirst.mockResolvedValue(null);
    await expect(build(d).issue(BASE)).rejects.toThrow(NotFoundException);
  });

  it('落行与开便签同处一个事务（半成品状态是运营看不懂的脏数据）', async () => {
    const d = deps();
    await build(d).issue({ ...BASE, restrict: true });
    expect(d.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('MaterialRequestIssuerService.register（路径 1：Sumsub 已建好 action）', () => {
  it('不再调 createApplicantAction，直接登记两个 id', async () => {
    const d = deps();
    await build(d).register({
      customerId: 'c1', sumsubApplicantId: 'app-1', materialType: 'SOURCE_OF_FUNDS',
      levelName: 'wave3-action-sof-refresh',
      applicantActionId: 'sumsub-act-9', externalActionId: 'sumsub-ext-9',
      orderDomain: 'DEPOSIT', orderRef: 'DP2608170001',
      origin: 'SUMSUB_PUSHED', reason: 'KYT requires SoF', issuedBy: 'SYSTEM',
      restrict: false, actor: ACTOR,
    });
    expect(d.sumsub.createApplicantAction).not.toHaveBeenCalled();
    expect(d.requests.create.mock.calls[0][0]).toMatchObject({
      applicantActionId: 'sumsub-act-9',
      externalActionId: 'sumsub-ext-9',
      orderDomain: 'DEPOSIT',
      orderRef: 'DP2608170001',
      origin: 'SUMSUB_PUSHED',
    });
  });
});
```

- [ ] **Step 4: 跑测试确认它红**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest material-request-issuer
```

期望：`Cannot find module './material-request-issuer.service'`。

- [ ] **Step 5: 写 issuer 让测试转绿**

新建 `src/modules/identity/material-requests/material-request-issuer.service.ts`：

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRequestsService, type IssueMaterialRequestInput } from './material-requests.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';
import type { ApprovalActorContext } from '../../governance/approvals/dto/approval.dto';
import type { RestrictionScope } from '../customers/constants/restriction-cause.constant';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { MaterialRefreshPolicyLoader } from '../material-refresh/policy/material-refresh-policy';
import {
  ISSUABLE_RESTRICTION_CAUSES,
  type IssuableRestrictionCause,
  type MaterialRequestOrderDomain,
  type MaterialRequestOrigin,
} from './constants/material-request.constant';

export interface IssueInput {
  customerId: string;
  materialType: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  restrict: boolean;
  restrictScopes?: RestrictionScope[];
  restrictCause?: IssuableRestrictionCause;
  origin: MaterialRequestOrigin;
  reason: string;
  issuedBy: string;
  actor: ApprovalActorContext;
}

export type RegisterInput = IssueMaterialRequestInput & {
  restrict: boolean;
  restrictScopes?: RestrictionScope[];
  restrictCause?: IssuableRestrictionCause;
  actor: ApprovalActorContext;
};

/**
 * 下发编排 —— 建行的唯一入口（设计稿 2026-08-17 §4.1）。
 *
 * 两条路径的差别只在这一层：
 *  - issue()    路径 2：我方先生成 externalActionId，再调 Sumsub 建 action
 *  - register() 路径 1：Sumsub 已经建好并把两个 id 推给了我们，只登记
 * 建完之后两条路径出来的行**完全同形**，下游一律不区分来源。
 */
@Injectable()
export class MaterialRequestIssuerService {
  constructor(
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly restrictionWorkflow: CustomerRestrictionWorkflowService,
    private readonly sumsubClient: SumsubClient,
    private readonly policyLoader: MaterialRefreshPolicyLoader,
  ) {}

  async issue(input: IssueInput): Promise<{ requestNo: string; restrictionNo: string | null }> {
    const cause = this.resolveCause(input.restrict, input.restrictCause);

    const config = this.policyLoader.getMaterialConfig(input.materialType);
    if (!config) {
      throw new BadRequestException({
        code: 'UNKNOWN_MATERIAL_TYPE',
        message: `Unknown material type: ${input.materialType}`,
      });
    }

    const customer = await this.loadCustomer(input.customerId);

    // 我方先生成，再交给 Sumsub —— 顺序不能反：这是铸 token 与认领 webhook 的钥匙
    const externalActionId = `MRQ:${randomUUID()}`;
    const action = await this.sumsubClient.createApplicantAction({
      applicantId: customer.sumsubApplicantId,
      levelName: config.sumsubActionLevelName,
      externalActionId,
    });

    return this.persist(
      {
        customerId: customer.id,
        sumsubApplicantId: customer.sumsubApplicantId,
        materialType: input.materialType,
        levelName: config.sumsubActionLevelName,
        applicantActionId: action.id,
        externalActionId,
        orderDomain: input.orderDomain,
        orderRef: input.orderRef,
        origin: input.origin,
        reason: input.reason,
        issuedBy: input.issuedBy,
      },
      cause,
      input.restrictScopes,
      input.reason,
      input.actor,
    );
  }

  async register(input: RegisterInput): Promise<{ requestNo: string; restrictionNo: string | null }> {
    const cause = this.resolveCause(input.restrict, input.restrictCause);
    const { restrict, restrictScopes, restrictCause, actor, ...row } = input;
    return this.persist(row, cause, restrictScopes, input.reason, actor);
  }

  /** 落行 + 可选开便签，同一个事务。半成品（有行没便签 / 有便签没行）是运营看不懂的脏数据。 */
  private async persist(
    row: IssueMaterialRequestInput,
    cause: IssuableRestrictionCause | null,
    scopes: RestrictionScope[] | undefined,
    reason: string,
    actor: ApprovalActorContext,
  ): Promise<{ requestNo: string; restrictionNo: string | null }> {
    return this.prisma.$transaction(async (tx: Record<string, any>) => {
      const created = await this.requests.create(row, tx);
      if (!cause) return { requestNo: created.requestNo, restrictionNo: null };

      // caseRef 用 requestNo：CustomerRestrictionWorkflowService.autoRelease() 是按
      // (customerId, cause, caseRef) 找便签的，不认 restrictionNo。用 requestNo 当
      // caseRef，Task 4 的自动撕不用改 autoRelease，限制账的幂等键也天然变成
      // 「一次下发一张便签」。
      const { restrictionNo } = await this.restrictionWorkflow.openRestriction(
        {
          customerId: row.customerId,
          cause,
          scopes,
          reason,
          caseRef: created.requestNo,
          openedBy: row.issuedBy,
        },
        actor,
      );
      await this.requests.attachRestriction(created.requestNo, restrictionNo, tx);
      return { requestNo: created.requestNo, restrictionNo };
    });
  }

  /** G4 / spec I1：SILENT 类 cause 在这里就被拦死，绝不落地 */
  private resolveCause(
    restrict: boolean,
    requested: IssuableRestrictionCause | undefined,
  ): IssuableRestrictionCause | null {
    if (!restrict) return null;
    const cause = requested ?? 'PENDING_DOCUMENT';
    if (!(ISSUABLE_RESTRICTION_CAUSES as readonly string[]).includes(cause)) {
      throw new BadRequestException({
        code: 'RESTRICTION_CAUSE_NOT_ISSUABLE',
        message:
          `Cause '${cause}' cannot back a material request. ` +
          `Only ${ISSUABLE_RESTRICTION_CAUSES.join(' / ')} are allowed — ` +
          'a SILENT cause would tell the customer they are under investigation.',
      });
    }
    return cause;
  }

  private async loadCustomer(customerId: string) {
    const customer = await this.prisma.customerMain.findFirst({
      where: { id: customerId },
      select: { id: true, customerNo: true, sumsubApplicantId: true },
    });
    if (!customer) throw new NotFoundException(`Customer not found: ${customerId}`);
    if (!customer.sumsubApplicantId) {
      throw new BadRequestException({
        code: 'NO_SUMSUB_APPLICANT',
        message: 'Customer has no Sumsub applicant; cannot create an applicant action',
      });
    }
    return customer as { id: string; customerNo: string; sumsubApplicantId: string };
  }
}
```

- [ ] **Step 6: 建模块**

新建 `src/modules/identity/material-requests/material-requests.module.ts`：

```ts
import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { AuditLoggingModule } from '../../audit-logging/audit-logging.module';
import { CustomersModule } from '../customers/customers.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRequestsService } from './material-requests.service';
import { MaterialRequestIssuerService } from './material-request-issuer.service';

@Module({
  imports: [
    PrismaModule,
    AuditLoggingModule,
    forwardRef(() => CustomersModule),
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [MaterialRequestsService, MaterialRequestIssuerService],
  exports: [MaterialRequestsService, MaterialRequestIssuerService],
})
export class MaterialRequestsModule {}
```

⚠️ `CustomersModule` 上一轮已知有三处 `forwardRef` 环（见 `swap-sumsub-compliance` 记忆）。若启动报循环依赖，按既有做法在两侧都加 `forwardRef`，不要拆模块。

在 `src/app.module.ts` 的 `imports` 里注册 `MaterialRequestsModule`。

- [ ] **Step 7: 跑测试 + tsc + 起服务确认能装配**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest src/modules/identity/material-requests && npx tsc --noEmit && bash scripts/stack.sh up
```

期望：`Tests: 29 passed`（6 + 12 + 11）；tsc 无输出；栈起来后 `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$(grep '^API_PORT=' .env | cut -d= -f2)/` 返回 404（说明 Nest 装配成功、只是根路由没定义）。

- [ ] **Step 8: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/identity/material-requests src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts src/modules/identity/material-refresh src/app.module.ts && git commit -m "feat(material-requests): 下发编排 + 修 createApplicantAction 不带 external id 的坑

createApplicantAction 此前 POST 空 {}，我方手里没有铸 SDK token 的钥匙（源码
注释已自陈此坑并登记 BACKLOG）。现在建 action 时就带上我方 externalActionId，
createActionSdkToken 的该参数也从可选改必填。

issuer 是建行唯一入口，两条路径只在这一层分叉：issue() 我方先生成 id 再调
Sumsub 建；register() 登记 Sumsub 已建好的。落行与开便签同一事务。

开便签时 caseRef 传 requestNo —— autoRelease 是按 (customerId, cause, caseRef)
找便签的，这样自动撕不用改 autoRelease，限制账幂等键也正好是一次下发一张。

G4：SILENT 类 cause 在 resolveCause 就被拦死，Sumsub 都不会被调用。"
```

---

### Task 4: 裁决编排 + webhook 路由改按 `externalActionId` 一次查表

**Files:**
- Create: `src/modules/identity/material-requests/material-request-review.service.ts`
- Create: `src/modules/identity/material-requests/material-request-review.service.spec.ts` (Test)
- Modify: `src/common/events/domain-events.constants.ts` — 加 `MATERIAL_REQUEST_REVIEWED`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:225-262` — 删 if-else 链
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts:81-124` — 改收 `requestNo`

**Interfaces:**
- Consumes: `MaterialRequestsService.findByExternalActionId()` / `.markReviewed()`（Task 2）；`CustomerRestrictionWorkflowService.autoRelease(customerId, cause, caseRef, actorId)`（既有）
- Produces: `MaterialRequestReviewService.applyReview(input)` → `{ requestNo, outcome } | null`；事件 `MATERIAL_REQUEST_REVIEWED`

**为什么要删那条 if-else 链**：`applicantActionReviewed` 今天走「先问 swap 认不认、不认再落材料重检」的顺序尝试，源码里有一大段注释自陈这是跨域收窄隐患（`applicantActionReviewed` 命中该分支后，`ongoingDocExpired` 与 `inspectionId` 两条分支就再也走不到了）。根因是没有统一 id 空间。现在有了：`externalActionId` 是本账的 `@unique` 列，一次 `findByExternalActionId` 就能定位归属，不用猜。

- [ ] **Step 1: 登记事件**

`src/common/events/domain-events.constants.ts`，在 `DOMAIN_EVENTS` 里加（照抄该文件既有条目的形状）：

```ts
  MATERIAL_REQUEST_REVIEWED: {
    name: 'material-request.reviewed',
    description:
      '一次材料下发拿到了 Sumsub 复核结果。订单域据此推进自己的合规闸门 —— ' +
      '材料账只广播事实，不替订单域做状态决定。',
  },
```

并在文件下方的 `DomainEventNames` 里加：

```ts
  MATERIAL_REQUEST_REVIEWED: DOMAIN_EVENTS.MATERIAL_REQUEST_REVIEWED.name,
```

- [ ] **Step 2: 写失败的 review service 测试**

新建 `src/modules/identity/material-requests/material-request-review.service.spec.ts`：

```ts
import { MaterialRequestReviewService } from './material-request-review.service';

const ACTOR = { actorType: 'ADMIN' as const, actorId: 'u1', actorNo: 'ADM001', actorRole: 'MLRO' };

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ2608170001', customerId: 'c1', materialType: 'SOURCE_OF_FUNDS',
    levelName: 'wave3-action-sof-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: 'DEPOSIT', orderRef: 'DP2608170001', restrictionNo: 'RST2608170001',
    origin: 'SUMSUB_PUSHED', status: 'SUBMITTED', reason: 'KYT requires SoF',
    issuedBy: 'SYSTEM', issuedAt: new Date(), submittedAt: new Date(),
    reviewedAt: null, reviewAnswer: null, reviewRejectType: null,
    cancelledAt: null, cancelReason: null, traceId: 'MATERIAL_REQUEST:t1',
    ...over,
  };
}

function deps(found: any = row()) {
  const requests = {
    findByExternalActionId: jest.fn().mockResolvedValue(found),
    markReviewed: jest.fn(async (_no: string, ans: string, rt: string | null) =>
      row({
        status: ans === 'GREEN' ? 'APPROVED' : rt === 'RETRY' ? 'PENDING_SUBMISSION' : 'REJECTED',
        reviewAnswer: ans, reviewRejectType: rt,
      })),
  } as any;
  const restrictions = {
    findByNo: jest.fn().mockResolvedValue({
      restrictionNo: 'RST2608170001', cause: 'PENDING_DOCUMENT', caseRef: 'MRQ2608170001',
    }),
  } as any;
  const restrictionWorkflow = { autoRelease: jest.fn().mockResolvedValue(undefined) } as any;
  const eventEmitter = { emit: jest.fn() } as any;
  return { requests, restrictions, restrictionWorkflow, eventEmitter };
}

const build = (d: ReturnType<typeof deps>) =>
  new MaterialRequestReviewService(d.requests, d.restrictions, d.restrictionWorkflow, d.eventEmitter);

describe('MaterialRequestReviewService.applyReview', () => {
  it('GREEN → APPROVED 且自动撕便签（caseRef 用 requestNo，releaseMode 由 autoRelease 定为 AUTO）', async () => {
    const d = deps();
    const out = await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(out).toEqual({ requestNo: 'MRQ2608170001', outcome: 'APPROVED' });
    expect(d.restrictionWorkflow.autoRelease).toHaveBeenCalledWith(
      'c1', 'PENDING_DOCUMENT', 'MRQ2608170001', 'SYSTEM',
    );
  });

  it('便签的 caseRef 不等于 requestNo 时（兑换域用 swapNo），按便签自己的 caseRef 撕', async () => {
    const d = deps();
    d.restrictions.findByNo.mockResolvedValue({
      restrictionNo: 'RST2608170001', cause: 'KYT_REJECTED_SOFT', caseRef: 'SW2608170001',
    });
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(d.restrictionWorkflow.autoRelease).toHaveBeenCalledWith(
      'c1', 'KYT_REJECTED_SOFT', 'SW2608170001', 'SYSTEM',
    );
  });

  it('GREEN 但这一行没挂便签 → 不调 autoRelease', async () => {
    const d = deps(row({ restrictionNo: null }));
    await build(d).applyReview({ externalActionId: 'ext-1', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(d.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });

  it('RED+RETRY → outcome=RETRY，便签原地不动', async () => {
    const d = deps();
    const out = await build(d).applyReview({
      externalActionId: 'ext-1', reviewAnswer: 'RED', reviewRejectType: 'RETRY', actor: ACTOR,
    });
    expect(out).toEqual({ requestNo: 'MRQ2608170001', outcome: 'RETRY' });
    expect(d.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });

  it('RED+FINAL → outcome=REJECTED，便签同样原地不动（审不过就是没解开）', async () => {
    const d = deps();
    const out = await build(d).applyReview({
      externalActionId: 'ext-1', reviewAnswer: 'RED', reviewRejectType: 'FINAL', actor: ACTOR,
    });
    expect(out).toEqual({ requestNo: 'MRQ2608170001', outcome: 'REJECTED' });
    expect(d.restrictionWorkflow.autoRelease).not.toHaveBeenCalled();
  });

  it('三种结局都广播 MATERIAL_REQUEST_REVIEWED，带上绑的单', async () => {
    for (const [ans, rt, outcome] of [
      ['GREEN', undefined, 'APPROVED'], ['RED', 'RETRY', 'RETRY'], ['RED', 'FINAL', 'REJECTED'],
    ] as const) {
      const d = deps();
      await build(d).applyReview({
        externalActionId: 'ext-1', reviewAnswer: ans as any, reviewRejectType: rt as any, actor: ACTOR,
      });
      expect(d.eventEmitter.emit).toHaveBeenCalledWith(
        'material-request.reviewed',
        expect.objectContaining({
          requestNo: 'MRQ2608170001', customerId: 'c1',
          orderDomain: 'DEPOSIT', orderRef: 'DP2608170001', outcome,
        }),
      );
    }
  });

  it('externalActionId 不属于本账 → 返回 null，不抛、不发事件', async () => {
    const d = deps(null);
    const out = await build(d).applyReview({ externalActionId: 'someone-else', reviewAnswer: 'GREEN', actor: ACTOR });
    expect(out).toBeNull();
    expect(d.eventEmitter.emit).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 跑测试确认它红**

```bash
npx jest material-request-review
```

期望：`Cannot find module './material-request-review.service'`。

- [ ] **Step 4: 写 review service**

新建 `src/modules/identity/material-requests/material-request-review.service.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { MaterialRequestsService, type MaterialActor } from './material-requests.service';
import { CustomerRestrictionsService } from '../customers/customer-restrictions.service';
import { CustomerRestrictionWorkflowService } from '../customers/customer-restriction-workflow.service';

export type ReviewOutcome = 'APPROVED' | 'RETRY' | 'REJECTED';

/**
 * 裁决编排（设计稿 2026-08-17 §5.2）。
 *
 * 三条结局共用一句原则：**只有 GREEN 撕便签**。两种 RED 都把便签留在原地 ——
 * 审不过就是没解开，这是整套设计里最不能含糊的一条。RETRY 与 FINAL 的区别
 * 只在这一行还能不能继续用。
 */
@Injectable()
export class MaterialRequestReviewService {
  private readonly logger = new Logger(MaterialRequestReviewService.name);

  constructor(
    private readonly requests: MaterialRequestsService,
    private readonly restrictions: CustomerRestrictionsService,
    private readonly restrictionWorkflow: CustomerRestrictionWorkflowService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async applyReview(input: {
    externalActionId: string;
    reviewAnswer: 'GREEN' | 'RED';
    reviewRejectType?: 'RETRY' | 'FINAL';
    actor: MaterialActor;
  }): Promise<{ requestNo: string; outcome: ReviewOutcome } | null> {
    const row = await this.requests.findByExternalActionId(input.externalActionId);
    // 不属于本账 —— 静默返回 null，让调用方决定要不要继续别的路由。
    // 不抛：真实 Sumsub 会推来各种我们不认领的 action。
    if (!row) return null;

    const rejectType = input.reviewAnswer === 'RED' ? (input.reviewRejectType ?? null) : null;
    const updated = await this.requests.markReviewed(
      row.requestNo,
      input.reviewAnswer,
      rejectType,
      input.actor,
    );

    const outcome: ReviewOutcome =
      input.reviewAnswer === 'GREEN' ? 'APPROVED' : rejectType === 'RETRY' ? 'RETRY' : 'REJECTED';

    if (outcome === 'APPROVED' && row.restrictionNo) {
      // autoRelease 按 (customerId, cause, caseRef) 找便签，不认 restrictionNo。
      // ⚠️ 不要假定 caseRef === requestNo：那只在 issuer 自己开的便签上成立
      // （Task 3）。兑换域的软线拒是**先**开便签（caseRef=swapNo）**再**登记
      // 材料请求的——那个 fail-safe 顺序是 load-bearing 的，不能为了凑
      // caseRef 而调换。所以这里读便签自己的 caseRef，两条路径都对。
      const restriction = await this.restrictions.findByNo(row.restrictionNo);
      if (restriction) {
        await this.restrictionWorkflow.autoRelease(
          row.customerId,
          restriction.cause,
          restriction.caseRef,
          'SYSTEM',
        );
      } else {
        this.logger.warn(
          `Material request ${row.requestNo} points at restriction ${row.restrictionNo} which no longer exists — nothing to auto-release`,
        );
      }
    }

    // 只广播事实，不替订单域做状态决定 —— 各域的合规闸门规矩不一样，
    // 材料账不该知道充值退回和提现拒付分别该怎么走。
    this.eventEmitter.emit(DomainEventNames.MATERIAL_REQUEST_REVIEWED, {
      requestNo: updated.requestNo,
      customerId: updated.customerId,
      orderDomain: updated.orderDomain,
      orderRef: updated.orderRef,
      outcome,
      traceId: updated.traceId,
    });

    return { requestNo: updated.requestNo, outcome };
  }
}
```

在 `material-requests.module.ts` 的 `providers` 与 `exports` 里加 `MaterialRequestReviewService`。

- [ ] **Step 5: 跑测试确认绿**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest material-request-review && npx tsc --noEmit
```

期望：`Tests: 6 passed`；tsc 无输出。

- [ ] **Step 6: 改 ingestion 路由 —— 删掉 if-else 链**

`src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`，把 `else if (depositWebhookType === 'applicantActionReviewed') { ... }` 那整个分支（含上方那段长注释，约 L225-262）替换为：

```ts
      // ── applicantActionReviewed：按 externalActionId 一次查表定位归属 ──
      // 2026-08-17 材料请求账之前，这里是一条「先问 swap 认不认、不认再落材料重检」
      // 的顺序尝试链，且因为同属一条 else-if 链，一旦命中就把下面的
      // ongoingDocExpired / inspectionId 两条分支彻底遮蔽 —— 原注释自陈这是
      // 跨域收窄隐患。根因是没有统一 id 空间。现在 externalActionId 是
      // material_requests 的 @unique 列，一次查表就能定位，不用猜。
      else if (depositWebhookType === 'applicantActionReviewed' && externalActionId) {
        const reviewed = await this.materialRequestReviewService.applyReview({
          externalActionId,
          reviewAnswer: reviewResult?.reviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
          reviewRejectType:
            reviewResult?.reviewRejectType === 'RETRY' ? 'RETRY' : 'FINAL',
          actor: { actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM' },
        });
        if (reviewed) {
          result = { routedTo: 'material-requests', ...reviewed };
          dispatchedContext = 'MATERIAL_REQUEST';
        }
      }
```

在该方法顶部、解构 payload 的地方补一行（若已有同名变量则复用）：

```ts
    const externalActionId: string | undefined =
      payload.externalActionId ?? payload.applicantActionExternalId ?? undefined;
```

在构造函数注入 `private readonly materialRequestReviewService: MaterialRequestReviewService`，并在 `SumsubIngestionModule` 的 `imports` 里加 `forwardRef(() => MaterialRequestsModule)`。

- [ ] **Step 7: 改模拟端点收 `requestNo`**

`src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`，把 `simulateApplicantActionResult` 整个方法替换为：

```ts
  @Post('applicant-action-result')
  @ApiOperation({ summary: '模拟 applicantActionReviewed —— 后台三个裁决按钮打这里' })
  async simulateApplicantActionResult(
    @Req() req: any,
    @Body() body: {
      requestNo: string;
      reviewAnswer: 'GREEN' | 'RED';
      reviewRejectType?: 'RETRY' | 'FINAL';
    },
  ) {
    this.ensureAdmin(req);
    if (!body.requestNo) throw new BadRequestException('requestNo is required');
    if (body.reviewAnswer === 'RED' && !body.reviewRejectType) {
      // 不许默默当成 FINAL 把单关掉，也不许默默当成 RETRY 让运营永远关不了单 ——
      // 树上两条旧路各犯了其中一个，本轮统一（设计稿 §2.2）。
      throw new BadRequestException("RED must carry reviewRejectType 'RETRY' or 'FINAL'");
    }

    const request = await this.materialRequests.findByNo(body.requestNo);
    if (!request) throw new NotFoundException(`Material request not found: ${body.requestNo}`);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: request.customerId },
      select: { sumsubApplicantId: true },
    });

    return this.ingestionService.ingest(
      {
        type: 'applicantActionReviewed',
        applicantId: customer?.sumsubApplicantId,
        actionId: request.applicantActionId,
        externalActionId: request.externalActionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
    );
  }
```

构造函数注入 `private readonly materialRequests: MaterialRequestsService`。

- [ ] **Step 8: 全量硬闸 + Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx tsc --noEmit && npx jest src/modules/sumsub-ingestion src/modules/identity/material-requests
```

期望：tsc 无输出；两个模块的测试全绿。**若 `sumsub-ingestion.service.spec.ts` 里那条锁 "swap miss 时 Clue 3 仍会触发" 的用例红了，那是预期的** —— 它锁的正是本任务拆掉的那条链。改写该用例为「非本账的 externalActionId 不被认领、后续分支照常可达」。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/identity/material-requests src/modules/sumsub-ingestion src/common/events/domain-events.constants.ts && git commit -m "feat(material-requests): 裁决编排 + webhook 路由改按 externalActionId 一次查表

三条结局共用一句原则：只有 GREEN 撕便签。两种 RED 都把便签留在原地——
审不过就是没解开。RETRY 与 FINAL 的区别只在这一行还能不能继续用。

删掉 applicantActionReviewed 那条「先问 swap、不认再落材料重检」的顺序尝试链。
它同属一条 else-if，命中后会把 ongoingDocExpired / inspectionId 两条分支彻底
遮蔽，源码注释已自陈是跨域收窄隐患。根因是没有统一 id 空间——现在
externalActionId 是 material_requests 的 @unique 列，一次查表定位。

模拟端点从写死 cycleId 改收 requestNo，RED 必须带 rejectType。"
```

---

### Task 5: 订单进终态 → 作废 / 解绑（含补齐 `SWAP_STATUS_CHANGED`）

**Files:**
- Create: `src/modules/identity/material-requests/material-request-order-cancel.listener.ts`
- Create: `src/modules/identity/material-requests/material-request-order-cancel.listener.spec.ts` (Test)
- Modify: `src/common/events/domain-events.constants.ts` — 加 `SWAP_STATUS_CHANGED`
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts` — `updateStatus` 落库后 emit
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` — 导出终态集合
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.service.ts` — 导出终态集合
- Modify: `src/modules/trading/swap-transactions/swap-transactions.service.ts` — 导出终态集合

**Interfaces:**
- Consumes: `MaterialRequestsService.listLiveByOrder()` / `.cancel()` / `.unbindOrder()`（Task 2）
- Produces: 事件 `SWAP_STATUS_CHANGED`（补齐三域对称，解设计稿 Q1）；三域各导出一个 `*_TERMINAL_STATUSES`

**规则（设计稿 §5.1）**，订单进终态时对该单所有活行：

| 挂了限制吗 | 动作 | 为什么 |
|---|---|---|
| 没挂 | `cancel(requestNo, 'ORDER_TERMINAL')` | 它本来就只在订单页露，单死了彻底没意义，不留孤儿 |
| 挂了 | `unbindOrder(requestNo)`，**不作废** | 「这个人还欠一张资金来源证明」不该因为单子结了就消失。从订单页撤下、留在客户级横幅 |

**Q1**：deposit 与 withdraw 已有 `DEPOSIT_STATUS_CHANGED` / `WITHDRAWAL_STATUS_CHANGED`，**swap 没有**（它走 `FUNDS_ORDER_STATUS_CHANGED`，那是资金单粒度不是兑换单粒度）。三域就这一处不对称，本任务补齐。

- [ ] **Step 1: 三域各导出终态集合**

**不要在 listener 里硬编码状态字符串数组** —— 那会造出第四份终态定义，将来某个域加了终态这里不会跟着变。三域各自导出：

`deposit-transactions.service.ts`，把 `updateStatus` 里那个局部 `const TERMINAL = new Set([...])`（约 L654）提到文件顶层并导出：

```ts
/** 充值终态。零出边 —— 材料账的作废监听器也读这一份，不另立第二份定义。 */
export const DEPOSIT_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  DepositTransactionStatus.SUCCESS,
  DepositTransactionStatus.FAILED,
  DepositTransactionStatus.CONFISCATED,
  DepositTransactionStatus.RETURNED,
  DepositTransactionStatus.SEIZED,
]);
```

`updateStatus` 里原来引用 `TERMINAL` 的地方改引用 `DEPOSIT_TERMINAL_STATUSES`。

`withdraw-transactions.service.ts` 顶层加（值取自该文件注释里写明的 TERMINAL 集合）：

```ts
/** 提现终态。零出边（状态机收窄后不再有 SUCCESS→RETURNED 或终态自环）。 */
export const WITHDRAW_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  WithdrawTransactionStatus.SUCCESS,
  WithdrawTransactionStatus.REJECTED,
  WithdrawTransactionStatus.FAILED,
  WithdrawTransactionStatus.RETURNED,
]);
```

`swap-transactions.service.ts` 顶层加：

```ts
/** 兑换终态。零出边。 */
export const SWAP_TERMINAL_STATUSES: ReadonlySet<string> = new Set<string>([
  SwapTransactionStatus.SUCCESS,
  SwapTransactionStatus.REJECTED,
  SwapTransactionStatus.FAILED,
  SwapTransactionStatus.REVERSED,
]);
```

⚠️ 写完先核对：打开三个域的转移表，确认上面每个集合恰好等于「该域中没有任何出边的状态」。多一个会导致材料请求被提前作废，少一个会留下永不作废的孤儿。

- [ ] **Step 2: 补 `SWAP_STATUS_CHANGED` 事件并在 swap 域 emit**

`src/common/events/domain-events.constants.ts` 的 `DOMAIN_EVENTS` 里加：

```ts
  SWAP_STATUS_CHANGED: {
    name: 'swap.status.changed',
    description:
      '兑换单状态变更。补于 2026-08-17 —— 此前三域只有充值/提现有单据级状态事件，' +
      '兑换只有资金单粒度的 FUNDS_ORDER_STATUS_CHANGED，材料账的作废监听器接不上。',
  },
```

`DomainEventNames` 里加：

```ts
  SWAP_STATUS_CHANGED: DOMAIN_EVENTS.SWAP_STATUS_CHANGED.name,
```

`swap-transactions.service.ts` 的 `updateStatus` 落库成功之后 emit（照抄 deposit 域既有的 emit 写法，参数形状对齐 `DEPOSIT_STATUS_CHANGED` 的 payload）：

```ts
    this.eventEmitter.emit(DomainEventNames.SWAP_STATUS_CHANGED, {
      swapId: updated.id,
      swapNo: updated.swapNo,
      ownerId: updated.ownerId,
      previousStatus: current.status,
      status: updated.status,
      traceId: updated.traceId,
    });
```

若该 service 尚未注入 `EventEmitter2`，在构造函数补上。

- [ ] **Step 3: 写失败的 listener 测试**

新建 `src/modules/identity/material-requests/material-request-order-cancel.listener.spec.ts`：

```ts
import { MaterialRequestOrderCancelListener } from './material-request-order-cancel.listener';

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ1', customerId: 'c1', restrictionNo: null,
    orderDomain: 'DEPOSIT', orderRef: 'DP1', status: 'PENDING_SUBMISSION',
    ...over,
  };
}

function deps(live: any[] = []) {
  const requests = {
    listLiveByOrder: jest.fn().mockResolvedValue(live),
    cancel: jest.fn().mockResolvedValue(undefined),
    unbindOrder: jest.fn().mockResolvedValue(undefined),
  } as any;
  return { requests };
}

const build = (d: ReturnType<typeof deps>) => new MaterialRequestOrderCancelListener(d.requests);

describe('订单进终态 → 材料请求处置', () => {
  it('没挂限制 → 作废，cancelReason=ORDER_TERMINAL', async () => {
    const d = deps([row()]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'RETURNED' } as any);
    expect(d.requests.cancel).toHaveBeenCalledWith('MRQ1', 'ORDER_TERMINAL', expect.anything());
    expect(d.requests.unbindOrder).not.toHaveBeenCalled();
  });

  it('挂了限制 → 解绑不作废（从订单页撤下、留在客户级横幅）', async () => {
    const d = deps([row({ restrictionNo: 'RST1' })]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'RETURNED' } as any);
    expect(d.requests.unbindOrder).toHaveBeenCalledWith('MRQ1', expect.anything());
    expect(d.requests.cancel).not.toHaveBeenCalled();
  });

  it('非终态一律不动（连查都不查）', async () => {
    const d = deps([row()]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'COMPLIANCE_PENDING' } as any);
    expect(d.requests.listLiveByOrder).not.toHaveBeenCalled();
  });

  it('同一单上混着两种行 → 各走各的', async () => {
    const d = deps([row({ requestNo: 'MRQ1' }), row({ requestNo: 'MRQ2', restrictionNo: 'RST2' })]);
    await build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'SUCCESS' } as any);
    expect(d.requests.cancel).toHaveBeenCalledWith('MRQ1', 'ORDER_TERMINAL', expect.anything());
    expect(d.requests.unbindOrder).toHaveBeenCalledWith('MRQ2', expect.anything());
  });

  it('提现终态同样生效', async () => {
    const d = deps([row({ orderDomain: 'WITHDRAW', orderRef: 'WD1' })]);
    await build(d).onWithdrawStatusChanged({ withdrawNo: 'WD1', status: 'REJECTED' } as any);
    expect(d.requests.listLiveByOrder).toHaveBeenCalledWith('WITHDRAW', 'WD1');
    expect(d.requests.cancel).toHaveBeenCalled();
  });

  it('兑换终态同样生效（Q1 补的事件真的接上了）', async () => {
    const d = deps([row({ orderDomain: 'SWAP', orderRef: 'SW1' })]);
    await build(d).onSwapStatusChanged({ swapNo: 'SW1', status: 'REJECTED' } as any);
    expect(d.requests.listLiveByOrder).toHaveBeenCalledWith('SWAP', 'SW1');
    expect(d.requests.cancel).toHaveBeenCalled();
  });

  it('单笔失败不拖垮同单其余行', async () => {
    const d = deps([row({ requestNo: 'MRQ1' }), row({ requestNo: 'MRQ2' })]);
    d.requests.cancel.mockRejectedValueOnce(new Error('boom'));
    await expect(
      build(d).onDepositStatusChanged({ depositNo: 'DP1', status: 'SUCCESS' } as any),
    ).resolves.toBeUndefined();
    expect(d.requests.cancel).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 4: 跑测试确认它红**

```bash
npx jest material-request-order-cancel
```

期望：`Cannot find module './material-request-order-cancel.listener'`。

- [ ] **Step 5: 写 listener**

新建 `src/modules/identity/material-requests/material-request-order-cancel.listener.ts`：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { DomainEventNames } from '../../../common/events/domain-events.constants';
import { MaterialRequestsService, type MaterialActor } from './material-requests.service';
import { DEPOSIT_TERMINAL_STATUSES } from '../../trading/deposit-transactions/deposit-transactions.service';
import { WITHDRAW_TERMINAL_STATUSES } from '../../trading/withdraw-transactions/withdraw-transactions.service';
import { SWAP_TERMINAL_STATUSES } from '../../trading/swap-transactions/swap-transactions.service';
import type { MaterialRequestOrderDomain } from './constants/material-request.constant';

const SYSTEM_ACTOR: MaterialActor = {
  actorType: 'SYSTEM',
  actorId: 'SYSTEM',
  actorNo: 'SYSTEM',
  actorRole: 'SYSTEM',
};

/**
 * 订单进终态 → 处置该单上还活着的材料请求（设计稿 §5.1）。
 *
 * 分两种，差别在挂没挂限制：
 *  - 没挂 → 作废。它本来就只在订单页露（客户级横幅只兜「挂了限制的」∪「没绑单的」），
 *    单死了它就再没有任何入口，留着就是孤儿。
 *  - 挂了 → **不作废**，只解绑订单。充值退回了，但「这个人还欠一张资金来源证明」
 *    这件事没跟着消失 —— 从订单页撤下，在客户级横幅上留着。这是本设计的价值点。
 */
@Injectable()
export class MaterialRequestOrderCancelListener {
  private readonly logger = new Logger(MaterialRequestOrderCancelListener.name);

  constructor(private readonly requests: MaterialRequestsService) {}

  @OnEvent(DomainEventNames.DEPOSIT_STATUS_CHANGED, { async: true })
  async onDepositStatusChanged(event: { depositNo?: string; status?: string }): Promise<void> {
    if (!event?.depositNo || !DEPOSIT_TERMINAL_STATUSES.has(String(event.status))) return;
    await this.settle('DEPOSIT', event.depositNo, String(event.status));
  }

  @OnEvent(DomainEventNames.WITHDRAWAL_STATUS_CHANGED, { async: true })
  async onWithdrawStatusChanged(event: { withdrawNo?: string; status?: string }): Promise<void> {
    if (!event?.withdrawNo || !WITHDRAW_TERMINAL_STATUSES.has(String(event.status))) return;
    await this.settle('WITHDRAW', event.withdrawNo, String(event.status));
  }

  @OnEvent(DomainEventNames.SWAP_STATUS_CHANGED, { async: true })
  async onSwapStatusChanged(event: { swapNo?: string; status?: string }): Promise<void> {
    if (!event?.swapNo || !SWAP_TERMINAL_STATUSES.has(String(event.status))) return;
    await this.settle('SWAP', event.swapNo, String(event.status));
  }

  private async settle(
    orderDomain: MaterialRequestOrderDomain,
    orderRef: string,
    terminalStatus: string,
  ): Promise<void> {
    const live = await this.requests.listLiveByOrder(orderDomain, orderRef);
    for (const row of live) {
      try {
        if (row.restrictionNo) {
          await this.requests.unbindOrder(row.requestNo, SYSTEM_ACTOR);
        } else {
          await this.requests.cancel(row.requestNo, 'ORDER_TERMINAL', SYSTEM_ACTOR);
        }
      } catch (e) {
        // 逐项兜住：一行处置失败不该让同单其余行也留在半吊子状态
        this.logger.warn(
          `Failed to settle material request ${row.requestNo} after ${orderDomain}/${orderRef} reached ${terminalStatus}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
}
```

在 `material-requests.module.ts` 的 `providers` 里加 `MaterialRequestOrderCancelListener`（不需要 export，它只被事件系统调用），并在 `imports` 里加三个交易域模块的 `forwardRef`。

- [ ] **Step 6: 跑测试 + tsc + Commit**

```bash
npx jest material-request-order-cancel src/modules/trading && npx tsc --noEmit
```

期望：listener 7 条全绿；三个交易域既有测试不因导出常量而变红；tsc 无输出。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/identity/material-requests src/modules/trading src/common/events/domain-events.constants.ts && git commit -m "feat(material-requests): 订单进终态 → 作废/解绑 + 补齐 SWAP_STATUS_CHANGED

没挂限制的行随单作废（它只在订单页露过，单死了就是孤儿）；挂了限制的只解绑
订单、不作废 —— 充值退回了，但「这个人还欠一张资金来源证明」不该跟着消失。

Q1 解决：三域此前只有充值/提现有单据级状态事件，兑换只有资金单粒度的
FUNDS_ORDER_STATUS_CHANGED，接不上作废监听器。补 SWAP_STATUS_CHANGED。

三域各导出自己的终态集合，listener 读它们而不是自己硬编码第四份定义。"
```

---

### Task 6: 后台三个端点 + RBAC 登记

**Files:**
- Create: `src/modules/identity/material-requests/dto/material-request.dto.ts`
- Create: `src/modules/identity/material-requests/material-requests.admin.controller.ts`
- Create: `src/modules/identity/material-requests/material-requests.admin.controller.spec.ts` (Test)
- Modify: `src/core/rbac/rbac.catalog.ts` — 登记三条 route()

**Interfaces:**
- Consumes: `MaterialRequestsService.listAllByCustomer()` / `.listLiveByOrder()`；`MaterialRequestIssuerService.issue()`
- Produces: 三个端点（见接口契约）；DTO 类型 `IssueMaterialRequestDto` / `AdminMaterialRequestRow` / `MATERIAL_TYPE_LABELS`

**G6 提醒**：后台客户详情页要**全集**（含终态），订单详情页要该单**活行**。别把客户端那套「挂限制的 ∪ 没绑单的」过滤搬进来。

- [ ] **Step 1: 写 DTO**

新建 `src/modules/identity/material-requests/dto/material-request.dto.ts`：

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { MaterialRequestOrderDomain, MaterialRequestOrigin, MaterialRequestStatus }
  from '../constants/material-request.constant';

/** 材料类型 → 人话。运营看得懂 Proof of Address，看不懂 wave3-action-poa-refresh。 */
export const MATERIAL_TYPE_LABELS: Record<string, string> = {
  EMIRATES_ID: 'Emirates ID',
  LIVENESS: 'Liveness Check',
  PROOF_OF_ADDRESS: 'Proof of Address',
  SOURCE_OF_FUNDS: 'Source of Funds',
  SOURCE_OF_WEALTH: 'Source of Wealth',
};

export const materialLabel = (materialType: string): string =>
  MATERIAL_TYPE_LABELS[materialType] ?? materialType;

const ORDER_DOMAINS = ['DEPOSIT', 'WITHDRAW', 'SWAP'] as const;
const SCOPES = ['DEPOSIT', 'WITHDRAW', 'SWAP'] as const;

export class IssueMaterialRequestDto {
  @ApiProperty({ description: 'config/material-refresh-policy.json 的 materials key' })
  @IsString()
  @MinLength(1)
  materialType!: string;

  @ApiPropertyOptional({ enum: ORDER_DOMAINS })
  @IsOptional()
  @IsIn(ORDER_DOMAINS as unknown as string[])
  orderDomain?: MaterialRequestOrderDomain;

  @ApiPropertyOptional({ description: 'depositNo / withdrawNo / swapNo' })
  @IsOptional()
  @IsString()
  orderRef?: string;

  @ApiProperty({ description: '勾了就同时开一张 PENDING_DOCUMENT 便签' })
  @IsBoolean()
  restrict!: boolean;

  @ApiPropertyOptional({ enum: SCOPES, isArray: true })
  @IsOptional()
  @IsArray()
  @IsIn(SCOPES as unknown as string[], { each: true })
  restrictScopes?: ('DEPOSIT' | 'WITHDRAW' | 'SWAP')[];

  @ApiProperty()
  @IsString()
  @MinLength(1)
  reason!: string;
}

/**
 * 后台面视图。**故意不含 customerId** —— 调用方给的就是 customerNo，
 * 回一个 UUID 只是把原始 ID 递到前端手上（管理台约定）。
 * applicantActionId 保留：后台是运营的操作台，排障时要能对上 Sumsub 侧。
 */
export interface AdminMaterialRequestRow {
  requestNo: string;
  materialType: string;
  materialLabel: string;
  levelName: string;
  applicantActionId: string;
  orderDomain: MaterialRequestOrderDomain | null;
  orderRef: string | null;
  restrictionNo: string | null;
  origin: MaterialRequestOrigin;
  status: MaterialRequestStatus;
  reason: string;
  issuedBy: string;
  issuedAt: Date;
  submittedAt: Date | null;
  reviewedAt: Date | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  cancelReason: string | null;
}
```

- [ ] **Step 2: 写失败的 controller 测试**

新建 `src/modules/identity/material-requests/material-requests.admin.controller.spec.ts`：

```ts
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MaterialRequestsAdminController } from './material-requests.admin.controller';

const ADMIN_REQ = {
  user: { type: 'ADMIN', userId: 'admin-1', userNo: 'ADM001', role: 'MLRO', roleCodes: ['MLRO'] },
};
const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'c1' } };

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ1', customerId: 'c1', materialType: 'PROOF_OF_ADDRESS',
    levelName: 'wave3-action-poa-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: null, orderRef: null, restrictionNo: null, origin: 'OPERATOR_ISSUED',
    status: 'PENDING_SUBMISSION', reason: 'need PoA', issuedBy: 'ADM001',
    issuedAt: new Date(), submittedAt: null, reviewedAt: null,
    reviewAnswer: null, reviewRejectType: null, cancelledAt: null, cancelReason: null,
    traceId: 't1', ...over,
  };
}

function build() {
  const prisma = {
    customerMain: { findFirst: jest.fn().mockResolvedValue({ id: 'c1' }) },
  } as any;
  const requests = {
    listAllByCustomer: jest.fn().mockResolvedValue([row()]),
    listLiveByOrder: jest.fn().mockResolvedValue([row({ orderDomain: 'DEPOSIT', orderRef: 'DP1' })]),
  } as any;
  const issuer = {
    issue: jest.fn().mockResolvedValue({ requestNo: 'MRQ1', restrictionNo: null }),
  } as any;
  const controller = new MaterialRequestsAdminController(prisma, requests, issuer);
  return { controller, prisma, requests, issuer };
}

describe('MaterialRequestsAdminController 鉴权', () => {
  it('三个端点对非 ADMIN 一律 Forbidden', async () => {
    const { controller } = build();
    await expect(controller.listByCustomer(CUSTOMER_REQ, 'CUS-001')).rejects.toThrow(ForbiddenException);
    await expect(controller.listByOrder(CUSTOMER_REQ, 'DEPOSIT', 'DP1')).rejects.toThrow(ForbiddenException);
    await expect(
      controller.issue(CUSTOMER_REQ, 'CUS-001', { materialType: 'PROOF_OF_ADDRESS', restrict: false, reason: 'r' } as any),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('MaterialRequestsAdminController.listByCustomer', () => {
  it('G6：后台要全集，调的是 listAllByCustomer 不是 listLive', async () => {
    const { controller, requests } = build();
    await controller.listByCustomer(ADMIN_REQ, 'CUS-001');
    expect(requests.listAllByCustomer).toHaveBeenCalledWith('c1');
  });

  it('对外合同是 customerNo，内部才换 id', async () => {
    const { controller, prisma } = build();
    await controller.listByCustomer(ADMIN_REQ, 'CUS-001');
    expect(prisma.customerMain.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { customerNo: 'CUS-001' } }),
    );
  });

  it('客户不存在 → NotFound', async () => {
    const { controller, prisma } = build();
    prisma.customerMain.findFirst.mockResolvedValue(null);
    await expect(controller.listByCustomer(ADMIN_REQ, 'NOPE')).rejects.toThrow(NotFoundException);
  });

  it('回包剥掉 customerId 与 externalActionId，带上 materialLabel', async () => {
    const { controller } = build();
    const out = await controller.listByCustomer(ADMIN_REQ, 'CUS-001');
    expect(out[0]).not.toHaveProperty('customerId');
    expect(out[0]).not.toHaveProperty('externalActionId');
    expect(out[0].materialLabel).toBe('Proof of Address');
    expect(out[0].applicantActionId).toBe('act-1');
  });
});

describe('MaterialRequestsAdminController.issue', () => {
  it('原样透传给 issuer，origin 固定 OPERATOR_ISSUED，issuedBy 用 userNo 不用 UUID', async () => {
    const { controller, issuer } = build();
    await controller.issue(ADMIN_REQ, 'CUS-001', {
      materialType: 'SOURCE_OF_FUNDS', restrict: true, restrictScopes: ['WITHDRAW'], reason: 'edd',
    } as any);
    expect(issuer.issue).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: 'c1', materialType: 'SOURCE_OF_FUNDS',
        restrict: true, restrictScopes: ['WITHDRAW'],
        origin: 'OPERATOR_ISSUED', issuedBy: 'ADM001',
        orderDomain: null, orderRef: null,
      }),
    );
  });

  it('G4：不接受 cause 入参 —— DTO 里根本没有这个字段，cause 固定 PENDING_DOCUMENT', async () => {
    const { controller, issuer } = build();
    await controller.issue(ADMIN_REQ, 'CUS-001', {
      materialType: 'SOURCE_OF_FUNDS', restrict: true, reason: 'edd',
      restrictCause: 'SANCTION',
    } as any);
    // 即便调用方硬塞，控制器也不透传 —— issuer 收到的 input 里没有 restrictCause
    expect(issuer.issue.mock.calls[0][0].restrictCause).toBeUndefined();
  });

  it('绑单时两列一起传下去', async () => {
    const { controller, issuer } = build();
    await controller.issue(ADMIN_REQ, 'CUS-001', {
      materialType: 'PROOF_OF_ADDRESS', orderDomain: 'DEPOSIT', orderRef: 'DP1',
      restrict: false, reason: 'r',
    } as any);
    expect(issuer.issue.mock.calls[0][0]).toMatchObject({ orderDomain: 'DEPOSIT', orderRef: 'DP1' });
  });
});

describe('MaterialRequestsAdminController.listByOrder', () => {
  it('订单维度只查活行', async () => {
    const { controller, requests } = build();
    await controller.listByOrder(ADMIN_REQ, 'DEPOSIT', 'DP1');
    expect(requests.listLiveByOrder).toHaveBeenCalledWith('DEPOSIT', 'DP1');
  });

  it('orderDomain 非法值 → Forbidden/BadRequest，不落到 service', async () => {
    const { controller, requests } = build();
    await expect(controller.listByOrder(ADMIN_REQ, 'NOPE' as any, 'X1')).rejects.toThrow();
    expect(requests.listLiveByOrder).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 跑测试确认它红**

```bash
npx jest material-requests.admin.controller
```

期望：`Cannot find module './material-requests.admin.controller'`。

- [ ] **Step 4: 写 controller**

新建 `src/modules/identity/material-requests/material-requests.admin.controller.ts`：

```ts
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, Inject,
  NotFoundException, Param, Post, Req, UseGuards, UsePipes, ValidationPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RequirePermissions } from '../../../core/rbac/require-permissions.decorator';
import { buildPermissionCode } from '../../../core/rbac/rbac.catalog';
import { MaterialRequestsService, type MaterialRequestRow } from './material-requests.service';
import { MaterialRequestIssuerService } from './material-request-issuer.service';
import {
  IssueMaterialRequestDto, materialLabel, type AdminMaterialRequestRow,
} from './dto/material-request.dto';
import type { MaterialRequestOrderDomain } from './constants/material-request.constant';
import type { ApprovalActorContext } from '../../governance/approvals/dto/approval.dto';

const ORDER_DOMAINS: MaterialRequestOrderDomain[] = ['DEPOSIT', 'WITHDRAW', 'SWAP'];

@ApiTags('Admin - Material Requests')
@Controller('admin')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MaterialRequestsAdminController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly issuer: MaterialRequestIssuerService,
  ) {}

  @Get('customers/:customerNo/material-requests')
  @ApiOperation({ summary: '列一个客户的全部材料请求（含终态 —— 后台要全集）' })
  @RequirePermissions(buildPermissionCode('GET', '/admin/customers/:customerNo/material-requests'))
  async listByCustomer(@Req() req: any, @Param('customerNo') customerNo: string) {
    this.assertAdmin(req);
    const customerId = await this.resolveCustomerId(customerNo);
    // G6：后台客户详情页那一列全是「露」，没有例外 —— 用 listAll 不是 listLive
    const rows = await this.requests.listAllByCustomer(customerId);
    return rows.map((r) => this.toAdminRow(r));
  }

  @Get('material-requests/by-order/:orderDomain/:orderRef')
  @ApiOperation({ summary: '列一个单上还活着的材料请求' })
  @RequirePermissions(
    buildPermissionCode('GET', '/admin/material-requests/by-order/:orderDomain/:orderRef'),
  )
  async listByOrder(
    @Req() req: any,
    @Param('orderDomain') orderDomain: string,
    @Param('orderRef') orderRef: string,
  ) {
    this.assertAdmin(req);
    if (!ORDER_DOMAINS.includes(orderDomain as MaterialRequestOrderDomain)) {
      throw new BadRequestException(`Unknown order domain: ${orderDomain}`);
    }
    const rows = await this.requests.listLiveByOrder(
      orderDomain as MaterialRequestOrderDomain,
      orderRef,
    );
    return rows.map((r) => this.toAdminRow(r));
  }

  @Post('customers/:customerNo/material-requests')
  @ApiOperation({ summary: '下发材料：建 Sumsub action + 落账，可选同时摁住' })
  @RequirePermissions(buildPermissionCode('POST', '/admin/customers/:customerNo/material-requests'))
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }))
  async issue(
    @Req() req: any,
    @Param('customerNo') customerNo: string,
    @Body() dto: IssueMaterialRequestDto,
  ) {
    this.assertAdmin(req);

    // spec I3：两列同空同非空
    if ((dto.orderDomain === undefined) !== (dto.orderRef === undefined)) {
      throw new BadRequestException({
        code: 'MATERIAL_REQUEST_HALF_BOUND',
        message: 'orderDomain and orderRef must be supplied together',
      });
    }

    const customerId = await this.resolveCustomerId(customerNo);
    const actor = this.buildAdminActor(req);

    return this.issuer.issue({
      customerId,
      materialType: dto.materialType,
      orderDomain: dto.orderDomain ?? null,
      orderRef: dto.orderRef ?? null,
      restrict: dto.restrict,
      restrictScopes: dto.restrictScopes,
      // G4：cause 不接受入参。运营只决定「摁不摁」，摁的名义永远是 PENDING_DOCUMENT
      // —— 让运营选 cause 就等于把 SANCTION 摆上台面，那是 tipping-off 的入口。
      origin: 'OPERATOR_ISSUED',
      reason: dto.reason,
      issuedBy: actor.userNo ?? actor.userId,
      actor,
    });
  }

  private assertAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') throw new ForbiddenException('Admin only');
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

  /** 对外合同是 customerNo（CLAUDE.md 铁律 3），内部再换 id 喂 domain service */
  private async resolveCustomerId(customerNo: string): Promise<string> {
    const customer = await this.prisma.customerMain.findFirst({
      where: { customerNo },
      select: { id: true },
    });
    if (!customer) throw new NotFoundException(`Customer ${customerNo} not found`);
    return customer.id;
  }

  /** 剥掉 customerId 与 externalActionId：前者是原始 ID，后者是铸 token 的钥匙，都不该出后台列表 */
  private toAdminRow(r: MaterialRequestRow): AdminMaterialRequestRow {
    return {
      requestNo: r.requestNo,
      materialType: r.materialType,
      materialLabel: materialLabel(r.materialType),
      levelName: r.levelName,
      applicantActionId: r.applicantActionId,
      orderDomain: r.orderDomain,
      orderRef: r.orderRef,
      restrictionNo: r.restrictionNo,
      origin: r.origin,
      status: r.status,
      reason: r.reason,
      issuedBy: r.issuedBy,
      issuedAt: r.issuedAt,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      reviewAnswer: r.reviewAnswer,
      reviewRejectType: r.reviewRejectType,
      cancelReason: r.cancelReason,
    };
  }
}
```

在 `material-requests.module.ts` 的 `controllers` 里注册它。

- [ ] **Step 5: 登记 RBAC**

`src/core/rbac/rbac.catalog.ts` 里，照抄 `CUSTOMER_RESTRICTIONS` 那三条的写法加三条：

```ts
  route('GET', '/admin/customers/:customerNo/material-requests', 'Customer Center', '查看客户材料请求'),
  route('POST', '/admin/customers/:customerNo/material-requests', 'Customer Center', '下发材料请求'),
  route('GET', '/admin/material-requests/by-order/:orderDomain/:orderRef', 'Customer Center', '查看单上材料请求'),
```

- [ ] **Step 6: 同步权限到库并重启后端**

⚠️ 这三步缺一不可。SUPER_ADMIN 的权限走内存 `RBAC_PERMISSION_DEFINITIONS`，**只 seed 不重启等于白费**，前端会恒 403：

```bash
bash scripts/on-stack.sh self db:base:sync && bash scripts/stack.sh down && bash scripts/stack.sh up
```

核对三个权限码真的落库了：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && sqlite3 "$(grep '^DATABASE_URL=' .env | sed 's|^DATABASE_URL=file:||' | tr -d '"')" "select code from permissions where code like '%material_requests%';"
```

期望三行：
```
api.get.admin_customers_customerno_material_requests
api.post.admin_customers_customerno_material_requests
api.get.admin_material_requests_by_order_orderdomain_orderref
```

- [ ] **Step 7: 真机验证三个端点**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
P=$(grep '^API_PORT=' .env | cut -d= -f2)
AT=$(curl -s -X POST http://127.0.0.1:$P/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
CU=$(sqlite3 "$(grep '^DATABASE_URL=' .env | sed 's|^DATABASE_URL=file:||' | tr -d '"')" "select customerNo from customer_main where email='demo_bob@example.com';")
echo "── 下发一条（不绑单、不摁人）──"
curl -s -X POST http://127.0.0.1:$P/admin/customers/$CU/material-requests -H "Authorization: Bearer $AT" \
  -H 'Content-Type: application/json' \
  -d '{"materialType":"PROOF_OF_ADDRESS","restrict":false,"reason":"Address on file is stale"}'
echo; echo "── 列该客户 ──"
curl -s http://127.0.0.1:$P/admin/customers/$CU/material-requests -H "Authorization: Bearer $AT" | python3 -m json.tool
```

期望：下发返回 `{"requestNo":"MRQ...","restrictionNo":null}`；列表里那一行 `status=PENDING_SUBMISSION`、`materialLabel="Proof of Address"`、`origin="OPERATOR_ISSUED"`，且**没有** `customerId` / `externalActionId` 两个键。

- [ ] **Step 8: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/identity/material-requests src/core/rbac/rbac.catalog.ts && git commit -m "feat(material-requests): 后台三个端点 + RBAC 登记

列客户（全集含终态，G6）/ 列单上活行 / 下发。对外合同一律 customerNo，
内部再换 id。回包剥掉 customerId 与 externalActionId。

G4：DTO 里没有 cause 字段，运营只决定摁不摁，摁的名义永远是 PENDING_DOCUMENT
—— 让运营选 cause 等于把 SANCTION 摆上台面。控制器即便收到硬塞的
restrictCause 也不透传。

权限码已 db:base:sync + 重启后端（只 seed 不重启前端恒 403）。"
```

---

### Task 7: 客户端三个端点 + 客户面字段守则测试

**Files:**
- Create: `src/modules/identity/material-requests/material-requests.client.controller.ts`
- Create: `src/modules/identity/material-requests/material-requests.client.controller.spec.ts` (Test)
- Create: `src/modules/identity/material-requests/material-request.contract.spec.ts` (Test，守则性)
- Modify: `src/modules/identity/material-requests/dto/material-request.dto.ts` — 加 `ClientMaterialRequestRow`

**Interfaces:**
- Consumes: `MaterialRequestsService.listLiveByCustomer()` / `.findByNo()` / `.markSubmitted()`；`SumsubClient.createActionSdkToken({ applicantId, levelName, externalActionId })`（Task 3 已把该参数改必填）
- Produces: 三个客户端端点（见接口契约）；`ClientMaterialRequestRow`

**这个任务的命门是 G5 / spec I2**：`applicantActionId` 绝不能出现在任何客户面响应里。光靠人记得过滤不够——本任务写一条**守则性测试**扫源码文本，让漏网在 CI 里红。

**第二条命门**：不属于自己的 `requestNo` 一律按「不存在」处理，返回 `{ submitted: true, sdkToken: null }` 而**不是** 403。403 本身就是信息泄漏——它告诉探测者「这个号真实存在，只是不属于你」。

- [ ] **Step 1: 加客户面视图类型**

`dto/material-request.dto.ts` 末尾追加：

```ts
/**
 * 客户面视图。**结构上装不下 applicantActionId 与 externalActionId** ——
 * 前者是 Sumsub 侧 id（spec I2），后者是铸 token 的钥匙，两个都只该留在服务端。
 * 由 material-request.contract.spec.ts 扫源码守着。
 */
export interface ClientMaterialRequestRow {
  requestNo: string;
  materialType: string;
  materialLabel: string;
  status: 'PENDING_SUBMISSION' | 'SUBMITTED';
  /** 挂了限制 = 真摁住你了（红档）；没挂 = 只是提醒（黄档） */
  blocking: boolean;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
  reason: string;
  issuedAt: string;
}

export interface ClientVerificationSessionView {
  submitted: boolean;
  sdkToken: string | null;
}
```

- [ ] **Step 2: 写守则性测试（先红）**

新建 `src/modules/identity/material-requests/material-request.contract.spec.ts`。探测器思路照抄 `src/modules/identity/customers/customer-access.contract.spec.ts`（它已经解决了「注释里出现不算违规」「不误伤同前缀标识符」两个坑）：

```ts
import * as fs from 'fs';
import * as path from 'path';

const FORBIDDEN = ['applicantActionId', 'externalActionId'];

/** 客户面源码 —— 这些文件里出现上面两个字段名即违规 */
const CLIENT_SURFACE_FILES = [
  path.resolve(__dirname, './material-requests.client.controller.ts'),
];

/** 只认「真的字段声明或对象字面量键」，注释与同前缀标识符不算 */
function findForbiddenFields(line: string): string[] {
  const withoutComments = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
  return FORBIDDEN.filter((f) =>
    new RegExp(`(^|[^A-Za-z0-9_])${f}\\s*[!?]?\\s*[:.]`).test(withoutComments) ||
    new RegExp(`(^|[^A-Za-z0-9_])${f}\\s*,`).test(withoutComments),
  );
}

describe('客户面字段守则：探测器自检', () => {
  it('命中真正的字段声明与对象字面量键', () => {
    expect(findForbiddenFields('  applicantActionId!: string;')).toEqual(['applicantActionId']);
    expect(findForbiddenFields('  return { externalActionId: row.externalActionId };'))
      .toEqual(['externalActionId']);
    expect(findForbiddenFields('    externalActionId,')).toEqual(['externalActionId']);
  });

  it('注释里的字段名不算违规', () => {
    expect(findForbiddenFields('// 绝不下发 applicantActionId')).toEqual([]);
    expect(findForbiddenFields('/* externalActionId 只留在服务端 */')).toEqual([]);
  });

  it('不误伤同前缀标识符', () => {
    expect(findForbiddenFields('  applicantActionIdList: string[];')).toEqual([]);
    expect(findForbiddenFields('  myExternalActionIdx = 1;')).toEqual([]);
  });
});

describe('G5 / spec I2：客户面源码不得出现 Sumsub 侧 id', () => {
  for (const file of CLIENT_SURFACE_FILES) {
    const rel = path.relative(path.resolve(__dirname, '../../../..'), file);
    const runner = fs.existsSync(file) ? it : it.skip;
    runner(`${rel} 干净`, () => {
      const hits: string[] = [];
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        findForbiddenFields(line).forEach((f) => hits.push(`${rel}:${i + 1} → ${f}`));
      });
      expect(hits).toEqual([]);
    });
  }
});

describe('ClientMaterialRequestRow 类型本身也装不下这两个字段', () => {
  it('dto 文件里 ClientMaterialRequestRow 的字段清单是白名单', () => {
    const dto = fs.readFileSync(path.resolve(__dirname, './dto/material-request.dto.ts'), 'utf8');
    const block = dto.split('export interface ClientMaterialRequestRow')[1]?.split('}')[0] ?? '';
    expect(block).not.toContain('applicantActionId');
    expect(block).not.toContain('externalActionId');
    expect(block).toContain('requestNo');
    expect(block).toContain('blocking');
  });
});
```

- [ ] **Step 3: 写失败的 controller 测试**

新建 `src/modules/identity/material-requests/material-requests.client.controller.spec.ts`：

```ts
import { ForbiddenException } from '@nestjs/common';
import { MaterialRequestsClientController } from './material-requests.client.controller';

const CUSTOMER_REQ = { user: { type: 'CUSTOMER', userId: 'c1', userNo: 'CUS-001' } };
const ADMIN_REQ = { user: { type: 'ADMIN', userId: 'admin-1' } };

function row(over: Record<string, any> = {}) {
  return {
    requestNo: 'MRQ1', customerId: 'c1', materialType: 'PROOF_OF_ADDRESS',
    levelName: 'wave3-action-poa-refresh', applicantActionId: 'act-1', externalActionId: 'ext-1',
    orderDomain: null, orderRef: null, restrictionNo: null, origin: 'OPERATOR_ISSUED',
    status: 'PENDING_SUBMISSION', reason: 'Address on file is stale', issuedBy: 'ADM001',
    issuedAt: new Date('2026-08-17T00:00:00Z'), submittedAt: null, reviewedAt: null,
    reviewAnswer: null, reviewRejectType: null, cancelledAt: null, cancelReason: null,
    traceId: 't1', ...over,
  };
}

function build(found: any = row()) {
  const prisma = {
    customerMain: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', sumsubApplicantId: 'app-1' }) },
  } as any;
  const requests = {
    listLiveByCustomer: jest.fn().mockResolvedValue([row()]),
    findByNo: jest.fn().mockResolvedValue(found),
    markSubmitted: jest.fn().mockResolvedValue(true),
  } as any;
  const sumsub = { createActionSdkToken: jest.fn().mockResolvedValue({ token: 'tok-1' }) } as any;
  const controller = new MaterialRequestsClientController(prisma, requests, sumsub);
  return { controller, prisma, requests, sumsub };
}

describe('客户端端点鉴权', () => {
  it('非 CUSTOMER 一律 Forbidden', async () => {
    const { controller } = build();
    await expect(controller.listMine(ADMIN_REQ)).rejects.toThrow(ForbiddenException);
    await expect(controller.getSession(ADMIN_REQ, 'MRQ1')).rejects.toThrow(ForbiddenException);
    await expect(controller.submit(ADMIN_REQ, 'MRQ1')).rejects.toThrow(ForbiddenException);
  });
});

describe('GET /client/me/material-requests', () => {
  it('只回活行，且回包里没有任何 Sumsub 侧 id（G5）', async () => {
    const { controller } = build();
    const out = await controller.listMine(CUSTOMER_REQ);
    expect(JSON.stringify(out)).not.toContain('act-1');
    expect(JSON.stringify(out)).not.toContain('ext-1');
    expect(out[0]).toMatchObject({ requestNo: 'MRQ1', blocking: false, materialLabel: 'Proof of Address' });
  });

  it('挂了限制的行 blocking=true（横幅据此分红黄两档）', async () => {
    const { controller, requests } = build();
    requests.listLiveByCustomer.mockResolvedValue([row({ restrictionNo: 'RST1' })]);
    const out = await controller.listMine(CUSTOMER_REQ);
    expect(out[0].blocking).toBe(true);
  });
});

describe('GET /client/me/material-requests/:requestNo/session', () => {
  it('正常行 → 铸 token，externalActionId 作为钥匙传给 Sumsub', async () => {
    const { controller, sumsub } = build();
    const out = await controller.getSession(CUSTOMER_REQ, 'MRQ1');
    expect(out).toEqual({ submitted: false, sdkToken: 'tok-1' });
    expect(sumsub.createActionSdkToken).toHaveBeenCalledWith(
      expect.objectContaining({
        applicantId: 'app-1', levelName: 'wave3-action-poa-refresh', externalActionId: 'ext-1',
      }),
    );
  });

  it('已提交 → {submitted:true, sdkToken:null}，不铸 token', async () => {
    const { controller, sumsub } = build(row({ status: 'SUBMITTED', submittedAt: new Date() }));
    await expect(controller.getSession(CUSTOMER_REQ, 'MRQ1'))
      .resolves.toEqual({ submitted: true, sdkToken: null });
    expect(sumsub.createActionSdkToken).not.toHaveBeenCalled();
  });

  it('别人的 requestNo → 与「不存在」逐字相同的响应，不是 403（403 本身就是信息泄漏）', async () => {
    const notMine = build(row({ customerId: 'someone-else' }));
    const missing = build(null);
    const a = await notMine.controller.getSession(CUSTOMER_REQ, 'MRQ1');
    const b = await missing.controller.getSession(CUSTOMER_REQ, 'MRQ-NOPE');
    expect(a).toEqual(b);
    expect(a).toEqual({ submitted: true, sdkToken: null });
  });

  it('终态行 → 同样按「没什么可做」回，不铸 token', async () => {
    const { controller, sumsub } = build(row({ status: 'REJECTED' }));
    await expect(controller.getSession(CUSTOMER_REQ, 'MRQ1'))
      .resolves.toEqual({ submitted: true, sdkToken: null });
    expect(sumsub.createActionSdkToken).not.toHaveBeenCalled();
  });
});

describe('POST /client/me/material-requests/:requestNo/submit', () => {
  it('幂等恒 2xx，不吐状态机信息', async () => {
    const { controller, requests } = build();
    await expect(controller.submit(CUSTOMER_REQ, 'MRQ1')).resolves.toEqual({ ok: true });
    requests.markSubmitted.mockResolvedValue(false);
    await expect(controller.submit(CUSTOMER_REQ, 'MRQ1')).resolves.toEqual({ ok: true });
  });

  it('别人的 requestNo → 同样 {ok:true}，但不真的落章', async () => {
    const { controller, requests } = build(row({ customerId: 'someone-else' }));
    await expect(controller.submit(CUSTOMER_REQ, 'MRQ1')).resolves.toEqual({ ok: true });
    expect(requests.markSubmitted).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: 跑测试确认它红**

```bash
npx jest src/modules/identity/material-requests
```

期望：contract spec 的自检三条绿、扫描那条 skip（文件还不存在）；controller spec 报 `Cannot find module`。

- [ ] **Step 5: 写 controller**

新建 `src/modules/identity/material-requests/material-requests.client.controller.ts`：

```ts
import { Controller, ForbiddenException, Get, Inject, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRequestsService, type MaterialRequestRow } from './material-requests.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import {
  materialLabel,
  type ClientMaterialRequestRow,
  type ClientVerificationSessionView,
} from './dto/material-request.dto';
import { MATERIAL_REQUEST_LIVE_STATUSES } from './constants/material-request.constant';

/** 「没什么可做」的统一回复。别人的号、不存在的号、已提交、已终态 —— 逐字相同。 */
const NOTHING_TO_DO: ClientVerificationSessionView = { submitted: true, sdkToken: null };

@ApiTags('Client - Material Requests')
@Controller('client/me')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MaterialRequestsClientController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Get('material-requests')
  @ApiOperation({ summary: '我当前还欠着的材料（横幅与订单页都读这一个）' })
  async listMine(@Req() req: any): Promise<ClientMaterialRequestRow[]> {
    const customerId = this.ensureCustomer(req);
    const rows = await this.requests.listLiveByCustomer(customerId);
    return rows.map((r) => this.toClientRow(r));
  }

  @Get('material-requests/:requestNo/session')
  @ApiOperation({ summary: '取认证会话（模拟模式下 sdkToken 是 mock 值）' })
  async getSession(
    @Req() req: any,
    @Param('requestNo') requestNo: string,
  ): Promise<ClientVerificationSessionView> {
    const customerId = this.ensureCustomer(req);
    const row = await this.loadOwn(customerId, requestNo);
    // 不属于自己 / 不存在 / 已提交 / 已终态 —— 四种情形回同一句话。
    // 尤其不能对「别人的号」回 403：那等于确认了这个号真实存在。
    if (!row || row.status !== 'PENDING_SUBMISSION') return NOTHING_TO_DO;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) return NOTHING_TO_DO;

    const { token } = await this.sumsubClient.createActionSdkToken({
      applicantId: customer.sumsubApplicantId,
      levelName: row.levelName,
      externalActionId: row.externalActionId,
      ttlInSecs: 600,
    });
    return { submitted: false, sdkToken: token };
  }

  @Post('material-requests/:requestNo/submit')
  @ApiOperation({ summary: '提交回执。幂等恒 2xx，不吐状态机信息' })
  async submit(@Req() req: any, @Param('requestNo') requestNo: string): Promise<{ ok: true }> {
    const customerId = this.ensureCustomer(req);
    const row = await this.loadOwn(customerId, requestNo);
    if (row) {
      await this.requests.markSubmitted(requestNo, {
        actorType: 'CUSTOMER',
        actorId: customerId,
        actorRole: 'CUSTOMER',
      });
    }
    // 无论落没落章都回同一句 —— 重复提交、别人的号、不存在的号，客户看到的一样
    return { ok: true };
  }

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') throw new ForbiddenException('Customer token required');
    return req.user.userId as string;
  }

  private async loadOwn(customerId: string, requestNo: string): Promise<MaterialRequestRow | null> {
    const row = await this.requests.findByNo(requestNo);
    return row && row.customerId === customerId ? row : null;
  }

  /**
   * G5 / spec I2：这个投影是客户面的唯一出口。
   * Sumsub 侧 id 与铸 token 的钥匙都不在里面 —— 由
   * material-request.contract.spec.ts 扫本文件源码守着，不靠人记得。
   */
  private toClientRow(r: MaterialRequestRow): ClientMaterialRequestRow {
    return {
      requestNo: r.requestNo,
      materialType: r.materialType,
      materialLabel: materialLabel(r.materialType),
      status: r.status as (typeof MATERIAL_REQUEST_LIVE_STATUSES)[number],
      blocking: r.restrictionNo !== null,
      orderDomain: r.orderDomain,
      orderRef: r.orderRef,
      reason: r.reason,
      issuedAt: r.issuedAt.toISOString(),
    };
  }
}
```

在 `material-requests.module.ts` 的 `controllers` 里注册它。

- [ ] **Step 6: 跑测试确认全绿**

```bash
npx jest src/modules/identity/material-requests && npx tsc --noEmit
```

期望：contract spec 的扫描用例从 skip 变成 pass；controller 用例全绿；tsc 无输出。

- [ ] **Step 7: 真机验证「不可区分」那条**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
P=$(grep '^API_PORT=' .env | cut -d= -f2)
CT=$(curl -s -X POST http://127.0.0.1:$P/auth/customer/login -H 'Content-Type: application/json' \
  -d '{"email":"demo_bob@example.com","password":"123456"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "── 我的材料请求 ──"
curl -s http://127.0.0.1:$P/client/me/material-requests -H "Authorization: Bearer $CT" | python3 -m json.tool
echo "── 编造一个号 vs 别人的号，两个响应必须逐字相同 ──"
A=$(curl -s http://127.0.0.1:$P/client/me/material-requests/MRQ0000000000/session -H "Authorization: Bearer $CT")
B=$(curl -s http://127.0.0.1:$P/client/me/material-requests/MRQ9999999999/session -H "Authorization: Bearer $CT")
echo "$A"; echo "$B"; [ "$A" = "$B" ] && echo "✓ 逐字相同" || echo "✗ 泄漏了"
echo "── 客户面响应里搜 Sumsub 侧 id（应为 0）──"
curl -s http://127.0.0.1:$P/client/me/material-requests -H "Authorization: Bearer $CT" | grep -c "applicantActionId\|externalActionId" || echo 0
```

- [ ] **Step 8: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/identity/material-requests && git commit -m "feat(material-requests): 客户端三个端点 + 客户面字段守则测试

列我的活行 / 取认证会话 / 提交回执。

两条命门各配一道防线：
- applicantActionId 与 externalActionId 绝不进客户面 —— 不靠人记得过滤，
  contract spec 扫控制器源码文本，漏网在 CI 里红（探测器自检三条防误伤）。
- 别人的号、不存在的号、已提交、已终态，四种情形回逐字相同的
  {submitted:true, sdkToken:null}。对别人的号回 403 等于确认这个号真实存在。

submit 幂等恒 2xx，落没落章客户都看不出来。"
```

---

### Task 8: 充值域迁到材料账

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:534-560` — 写入侧改走材料账
- Modify: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts` — 整个类改成薄适配层（**不删文件**，G3）
- Modify: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts` — 断言改新行为
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts` — 引入 `MaterialRequestsModule`

**Interfaces:**
- Consumes: `MaterialRequestIssuerService.register()`；`MaterialRequestsService.listLiveByOrder()` / `.cancel()`
- Produces: `DepositApplicantActionsService.syncApplicantActions()` / `.hasOutstanding()` 签名**不变**，实现改走材料账 —— 这样 `deposit-workflow` 那一大段状态机逻辑一行不用动

**为什么保签名不改 workflow**：`deposit-workflow.service.ts:539-560` 那段有两处带长注释的死角修复（「ACTION_PENDING 但零条可提交项」的两个分支），判据是 `hasOutstanding()`。动它风险高、收益为零。本任务只把 `DepositApplicantActionsService` 的**内脏**换成材料账，对外签名逐字不变。

**一个必须保住的既有行为**：`syncApplicantActions` 做的是**集合同步** —— Sumsub 报文带的是该单当前 action 的**全量列表**，报文里消失的行要退役。子表时代是 `deleteMany`；材料账是审计账不能删行，等价动作是 `cancel(requestNo, 'RETIRED_BY_SUMSUB')`。

- [ ] **Step 1: 先改测试，锁住「签名不变、内脏换掉」**

`deposit-applicant-actions.service.spec.ts` 顶部把 prisma 子表桩换成材料账依赖桩，并加这四条（其余既有用例保留，只把断言目标从 `tx.depositApplicantAction.*` 改成 issuer/requests 的调用）：

```ts
  it('新 action 走 issuer.register 落材料账，不再写 deposit_applicant_actions 子表', async () => {
    const { svc, issuer, prisma } = build();
    await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        orderDomain: 'DEPOSIT', orderRef: 'DP2608170001',
        origin: 'SUMSUB_PUSHED', restrict: true,
        applicantActionId: 'a1', externalActionId: 'e1',
      }),
    );
    expect(prisma.depositApplicantAction).toBeUndefined();
  });

  it('报文里已消失的行 → cancel(RETIRED_BY_SUMSUB)，不是删行（账不能删）', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-old', externalActionId: 'gone', status: 'PENDING_SUBMISSION' },
    ]);
    await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(requests.cancel).toHaveBeenCalledWith('MRQ-old', 'RETIRED_BY_SUMSUB', expect.anything());
  });

  it('报文里已存在的行不重复 register（幂等，重复 webhook 不造第二行）', async () => {
    const { svc, issuer, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'PENDING_SUBMISSION' },
    ]);
    await svc.syncApplicantActions('dep-1', [
      { applicantActionId: 'a1', externalActionId: 'e1' },
    ]);
    expect(issuer.register).not.toHaveBeenCalled();
    expect(requests.cancel).not.toHaveBeenCalled();
  });

  it('hasOutstanding 判据 = 该单还有 PENDING_SUBMISSION 的行（SUBMITTED 不算未提交）', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'SUBMITTED' },
    ]);
    await expect(svc.hasOutstanding('dep-1')).resolves.toBe(false);
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-2', externalActionId: 'e2', status: 'PENDING_SUBMISSION' },
    ]);
    await expect(svc.hasOutstanding('dep-1')).resolves.toBe(true);
  });
```

`build()` helper：

```ts
function build() {
  const prisma = {
    depositTransaction: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'dep-1', depositNo: 'DP2608170001', ownerId: 'c1',
      }),
    },
    customerMain: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', sumsubApplicantId: 'app-1' }),
    },
  } as any;
  const requests = {
    listLiveByOrder: jest.fn().mockResolvedValue([]),
    cancel: jest.fn().mockResolvedValue(undefined),
    markSubmitted: jest.fn().mockResolvedValue(true),
  } as any;
  const issuer = { register: jest.fn().mockResolvedValue({ requestNo: 'MRQ-new', restrictionNo: 'RST-1' }) } as any;
  const svc = new DepositApplicantActionsService(prisma, requests, issuer);
  return { svc, prisma, requests, issuer };
}
```

- [ ] **Step 2: 跑测试确认它红**

```bash
npx jest deposit-applicant-actions
```

期望：构造函数入参数量对不上 / `issuer.register` 未被调用，多条红。

- [ ] **Step 3: 把 service 内脏换成材料账**

`src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts` 整体替换为：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRequestsService, type MaterialActor } from '../../identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../../identity/material-requests/material-request-issuer.service';

export interface IncomingApplicantAction {
  applicantActionId: string;
  externalActionId: string;
}

const SYSTEM_ACTOR: MaterialActor = {
  actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM',
};

/**
 * 一笔充值单上挂的多条 Sumsub applicant action。
 *
 * **2026-08-17 材料请求账**：本类不再拥有 `deposit_applicant_actions` 子表，
 * 内脏换成了统一的材料账（`material_requests`，orderDomain='DEPOSIT'）。
 * 对外签名逐字不变 —— `deposit-workflow.service.ts` 里那段带死角修复注释的
 * 状态机逻辑（判据是 hasOutstanding）因此一行都不用动。
 *
 * 子表本身在 Task 12 统一物理删除（G3：加法在前、删除在后）。本类已经
 * **零写入**旧表，看到还有代码读它就是漏网。
 *
 * **客户端从头到尾拿不到 action id** —— 这条口径没变，只是防线换了地方：
 * 以前靠「对外用 seq 定位」，现在靠材料账客户面投影结构上装不下
 * applicantActionId（由 material-request.contract.spec.ts 扫源码守着）。
 */
@Injectable()
export class DepositApplicantActionsService {
  private readonly logger = new Logger(DepositApplicantActionsService.name);

  constructor(
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly issuer: MaterialRequestIssuerService,
  ) {}

  /**
   * 集合同步：报文带的是该单当前 action 的**全量列表**，本方法让材料账与它对齐。
   * 报文里新出现的 → register 落一行；报文里消失的 → cancel。
   *
   * 账不能删行（审计），所以退役动作是 CANCELLED 而不是 deleteMany —— 这是与
   * 子表时代唯一的语义差别，其余行为一致。
   */
  async syncApplicantActions(
    depositId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number; retired: number }> {
    const deposit = await this.prisma.depositTransaction.findUnique({
      where: { id: depositId },
      select: { id: true, depositNo: true, ownerId: true },
    });
    if (!deposit) return { added: 0, retired: 0 };

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: deposit.ownerId },
      select: { id: true, sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      this.logger.warn(
        `Deposit ${deposit.depositNo}: owner has no Sumsub applicant; skipping action sync`,
      );
      return { added: 0, retired: 0 };
    }

    const live = await this.requests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    const liveByExternal = new Map(live.map((r) => [r.externalActionId, r]));
    const incomingIds = new Set(incoming.map((a) => a.externalActionId));

    let added = 0;
    for (const action of incoming) {
      if (liveByExternal.has(action.externalActionId)) continue; // 幂等：重复 webhook 不造第二行
      await this.issuer.register({
        customerId: customer.id,
        sumsubApplicantId: customer.sumsubApplicantId,
        // Sumsub 的 applicantActionReviewed 报文不带材料类型，只有 level 概念。
        // 充值补料统一按「资金来源」登记 —— 这是 KYT 拒绝时实际要的东西，
        // 也是运营在列表里最需要一眼看懂的那个词。真接 Sumsub 后若报文能带出
        // 具体 docType，改这里一处即可。
        materialType: 'SOURCE_OF_FUNDS',
        levelName: 'wave3-action-sof-refresh',
        applicantActionId: action.applicantActionId,
        externalActionId: action.externalActionId,
        orderDomain: 'DEPOSIT',
        orderRef: deposit.depositNo,
        origin: 'SUMSUB_PUSHED',
        reason: `KYT review on deposit ${deposit.depositNo} requires additional materials`,
        issuedBy: 'SYSTEM',
        restrict: true,
        actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
      });
      added += 1;
    }

    let retired = 0;
    for (const row of live) {
      if (incomingIds.has(row.externalActionId)) continue;
      await this.requests.cancel(row.requestNo, 'RETIRED_BY_SUMSUB', SYSTEM_ACTOR);
      retired += 1;
    }

    return { added, retired };
  }

  /**
   * 该单是否还有「客户还没交」的行。
   *
   * 判据必须是「还有 PENDING_SUBMISSION」而不是「incoming 非空」——
   * 报文也可能带的全是已经提交过的旧 id，那样是零未提交。这条判据撑着
   * deposit-workflow 里两处死角修复，别改语义。
   */
  async hasOutstanding(depositId: string): Promise<boolean> {
    const deposit = await this.prisma.depositTransaction.findUnique({
      where: { id: depositId },
      select: { depositNo: true },
    });
    if (!deposit) return false;
    const live = await this.requests.listLiveByOrder('DEPOSIT', deposit.depositNo);
    return live.some((r) => r.status === 'PENDING_SUBMISSION');
  }
}
```

**删掉** `findBySeq` / `submitBySeq` / `clearDepositCache` 三个方法 —— 它们是 seq 定位时代的产物，客户面已改走 `requestNo`。它们的调用方 `deposit-verification-session.service.ts` 在 Task 12 整体删除；本任务先让它编译不过是不行的，所以**同步做 Step 4**。

- [ ] **Step 4: 摘掉 seq 时代的会话服务与端点**

`deposit-transactions.controller.ts:99-118` 的两个 `verification-session/:seq` 端点整体删除（客户端在 Task 14 改走新端点，本任务之后这两条已无调用方）。

`deposit-verification-session.service.ts` 里对 `applicantActions.findBySeq/submitBySeq/clearDepositCache` 的调用一并删除；若删完该文件已无内容，保留一个空壳并在文件头加注释：

```ts
// 2026-08-17 材料请求账：本服务的职责（按 seq 取会话 / 提交）已并入
// material-requests.client.controller.ts，按 requestNo 定位。
// 文件在 Task 12 统一删除（G3：加法在前、删除在后）。
```

从 `deposit-transactions.module.ts` 的 `providers` 里摘掉 `DepositVerificationSessionService`，并在 `imports` 加 `forwardRef(() => MaterialRequestsModule)`。

- [ ] **Step 5: 跑测试 + tsc**

```bash
npx jest src/modules/trading/deposit-transactions && npx tsc --noEmit
```

期望：deposit 域测试全绿；tsc 无输出。`deposit-workflow.service.spec.ts` 应当**一条都不用改** —— 若它红了，说明你动了对外签名，退回去。

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions && git commit -m "refactor(deposit): applicant action 改走材料账

DepositApplicantActionsService 对外签名逐字不变，内脏换成 material_requests
（orderDomain='DEPOSIT'）——deposit-workflow 里那段带死角修复注释的状态机逻辑
一行没动，它的判据 hasOutstanding 语义保持「还有 PENDING_SUBMISSION」。

集合同步语义保住了：报文带全量列表，新出现的 register、消失的 cancel。
与子表时代唯一的差别是退役动作从 deleteMany 变成 CANCELLED——账不能删行。

摘掉 seq 时代的两个 verification-session 端点与其 service（客户面改走
requestNo）。子表与残壳在 Task 12 统一物理删除。"
```

---

### Task 9: 提现域迁到材料账

**Files:**
- Modify: `src/modules/trading/withdraw-transactions/withdraw-applicant-actions.service.ts` — 内脏换材料账
- Modify: `src/modules/trading/withdraw-transactions/withdraw-applicant-actions.service.spec.ts`
- Modify: `src/modules/trading/withdraw-transactions/customer-withdraw.controller.ts:61-80` — 删两个 seq 端点
- Modify: `src/modules/trading/withdraw-transactions/withdraw-transactions.module.ts`

**Interfaces:**
- Consumes: `MaterialRequestIssuerService.register()`；`MaterialRequestsService.listLiveByOrder()` / `.cancel()`
- Produces: `WithdrawApplicantActionsService.syncApplicantActions()` / `.hasOutstanding()` 签名不变

与充值域结构对称，但**本任务完整给出提现域的代码** —— 读到这里的人可能没读过 Task 8。

- [ ] **Step 1: 改测试**

`withdraw-applicant-actions.service.spec.ts` 的 `build()`：

```ts
function build() {
  const prisma = {
    withdrawTransaction: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'wd-1', withdrawNo: 'WD2608170001', ownerId: 'c1',
      }),
    },
    customerMain: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', sumsubApplicantId: 'app-1' }),
    },
  } as any;
  const requests = {
    listLiveByOrder: jest.fn().mockResolvedValue([]),
    cancel: jest.fn().mockResolvedValue(undefined),
  } as any;
  const issuer = { register: jest.fn().mockResolvedValue({ requestNo: 'MRQ-new', restrictionNo: 'RST-1' }) } as any;
  const svc = new WithdrawApplicantActionsService(prisma, requests, issuer);
  return { svc, prisma, requests, issuer };
}
```

四条断言：

```ts
  it('新 action 走 issuer.register，orderDomain=WITHDRAW、orderRef=withdrawNo', async () => {
    const { svc, issuer } = build();
    await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(issuer.register).toHaveBeenCalledWith(
      expect.objectContaining({
        orderDomain: 'WITHDRAW', orderRef: 'WD2608170001',
        origin: 'SUMSUB_PUSHED', restrict: true,
        applicantActionId: 'a1', externalActionId: 'e1',
      }),
    );
  });

  it('报文里消失的行 → cancel(RETIRED_BY_SUMSUB)', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-old', externalActionId: 'gone', status: 'PENDING_SUBMISSION' },
    ]);
    await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(requests.cancel).toHaveBeenCalledWith('MRQ-old', 'RETIRED_BY_SUMSUB', expect.anything());
  });

  it('已存在的行不重复 register', async () => {
    const { svc, issuer, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([
      { requestNo: 'MRQ-1', externalActionId: 'e1', status: 'PENDING_SUBMISSION' },
    ]);
    await svc.syncApplicantActions('wd-1', [{ applicantActionId: 'a1', externalActionId: 'e1' }]);
    expect(issuer.register).not.toHaveBeenCalled();
  });

  it('hasOutstanding = 该单还有 PENDING_SUBMISSION 的行', async () => {
    const { svc, requests } = build();
    requests.listLiveByOrder.mockResolvedValue([{ requestNo: 'M1', externalActionId: 'e1', status: 'SUBMITTED' }]);
    await expect(svc.hasOutstanding('wd-1')).resolves.toBe(false);
    requests.listLiveByOrder.mockResolvedValue([{ requestNo: 'M2', externalActionId: 'e2', status: 'PENDING_SUBMISSION' }]);
    await expect(svc.hasOutstanding('wd-1')).resolves.toBe(true);
  });
```

- [ ] **Step 2: 跑测试确认它红**

```bash
npx jest withdraw-applicant-actions
```

- [ ] **Step 3: 换内脏**

`src/modules/trading/withdraw-transactions/withdraw-applicant-actions.service.ts` 整体替换：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRequestsService, type MaterialActor } from '../../identity/material-requests/material-requests.service';
import { MaterialRequestIssuerService } from '../../identity/material-requests/material-request-issuer.service';

export interface IncomingApplicantAction {
  applicantActionId: string;
  externalActionId: string;
}

const SYSTEM_ACTOR: MaterialActor = {
  actorType: 'SYSTEM', actorId: 'SYSTEM', actorNo: 'SYSTEM', actorRole: 'SYSTEM',
};

/**
 * 一笔提现单上挂的多条 Sumsub applicant action。
 *
 * **2026-08-17 材料请求账**：内脏换成统一的材料账（orderDomain='WITHDRAW'），
 * 对外签名逐字不变，withdraw-workflow 的状态机逻辑不用动。
 * `withdraw_applicant_actions` 子表已零写入，Task 12 统一物理删除。
 */
@Injectable()
export class WithdrawApplicantActionsService {
  private readonly logger = new Logger(WithdrawApplicantActionsService.name);

  constructor(
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly requests: MaterialRequestsService,
    private readonly issuer: MaterialRequestIssuerService,
  ) {}

  async syncApplicantActions(
    withdrawId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number; retired: number }> {
    const withdraw = await this.prisma.withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: { id: true, withdrawNo: true, ownerId: true },
    });
    if (!withdraw) return { added: 0, retired: 0 };

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: withdraw.ownerId },
      select: { id: true, sumsubApplicantId: true },
    });
    if (!customer?.sumsubApplicantId) {
      this.logger.warn(
        `Withdraw ${withdraw.withdrawNo}: owner has no Sumsub applicant; skipping action sync`,
      );
      return { added: 0, retired: 0 };
    }

    const live = await this.requests.listLiveByOrder('WITHDRAW', withdraw.withdrawNo);
    const liveByExternal = new Map(live.map((r) => [r.externalActionId, r]));
    const incomingIds = new Set(incoming.map((a) => a.externalActionId));

    let added = 0;
    for (const action of incoming) {
      if (liveByExternal.has(action.externalActionId)) continue;
      await this.issuer.register({
        customerId: customer.id,
        sumsubApplicantId: customer.sumsubApplicantId,
        // 提现补料同样统一按「资金来源」登记，理由见充值域同址注释
        materialType: 'SOURCE_OF_FUNDS',
        levelName: 'wave3-action-sof-refresh',
        applicantActionId: action.applicantActionId,
        externalActionId: action.externalActionId,
        orderDomain: 'WITHDRAW',
        orderRef: withdraw.withdrawNo,
        origin: 'SUMSUB_PUSHED',
        reason: `KYT review on withdrawal ${withdraw.withdrawNo} requires additional materials`,
        issuedBy: 'SYSTEM',
        restrict: true,
        actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
      });
      added += 1;
    }

    let retired = 0;
    for (const row of live) {
      if (incomingIds.has(row.externalActionId)) continue;
      await this.requests.cancel(row.requestNo, 'RETIRED_BY_SUMSUB', SYSTEM_ACTOR);
      retired += 1;
    }

    return { added, retired };
  }

  async hasOutstanding(withdrawId: string): Promise<boolean> {
    const withdraw = await this.prisma.withdrawTransaction.findUnique({
      where: { id: withdrawId },
      select: { withdrawNo: true },
    });
    if (!withdraw) return false;
    const live = await this.requests.listLiveByOrder('WITHDRAW', withdraw.withdrawNo);
    return live.some((r) => r.status === 'PENDING_SUBMISSION');
  }
}
```

同样**删掉** `findBySeq` / `submitBySeq` / `clearWithdrawCache` 三个 seq 时代的方法。

- [ ] **Step 4: 摘掉 seq 端点**

`customer-withdraw.controller.ts:61-80` 的两个 `verification-session/:seq` 端点整体删除；其会话 service（`withdraw-verification-session.service.ts`）里对 `applicantActions.findBySeq/submitBySeq` 的调用一并删除；若删完已无内容，保留空壳并在文件头加注释：

```ts
// 2026-08-17 材料请求账：本服务的职责（按 seq 取会话 / 提交）已并入
// material-requests.client.controller.ts，按 requestNo 定位。
// 文件在 Task 12 统一删除（G3：加法在前、删除在后）。
```

`withdraw-transactions.module.ts` 的 `imports` 加 `forwardRef(() => MaterialRequestsModule)`，`providers` 摘掉会话 service。

- [ ] **Step 5: 跑测试 + tsc + Commit**

```bash
npx jest src/modules/trading/withdraw-transactions && npx tsc --noEmit
```

期望：提现域测试全绿（`withdraw-workflow.service.spec.ts` 一条都不该改）；tsc 无输出。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/trading/withdraw-transactions && git commit -m "refactor(withdraw): applicant action 改走材料账

与充值域对称：对外签名逐字不变、内脏换成 material_requests
（orderDomain='WITHDRAW'），withdraw-workflow 状态机一行没动。
集合同步语义保留，退役动作 deleteMany → CANCELLED。
摘掉 seq 时代的两个 verification-session 端点。"
```

---

### Task 10: 兑换域迁到材料账 —— 拆掉客户级单指针

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:817-875` — 处置块改走材料账
- Modify: `src/modules/swap-sumsub/applicant-action.handler.ts` — 裁决处置让给 Task 4，只留 sticky 判断
- Modify: `src/modules/swap-sumsub/swap-webhook-router.ts` — 不再认领 applicantActionReviewed
- Modify: `src/modules/trading/swap-transactions/swap-transactions.module.ts` / `swap-sumsub.module.ts`
- **不删** `customer-pending-action.service.ts`（G3，Task 12 删）

**Interfaces:**
- Consumes: `MaterialRequestIssuerService.register()`；`CustomerPendingActionService.hasHardLineDisposition()`（**保留**）
- Produces: 兑换域零写入 `customer_main.pendingAction*` 三列

**这是本设计要治的那个病本身。** `pendingActionExternalId` 是单值、`set()` 是覆盖写，而 `swap-workflow.service.ts:869` 只取 `actions[0]!.externalActionId` —— 一笔单带回多条 action 时后面几条直接丢，同一客户第二笔单软线拒时又把第一笔整个盖掉。

**两条不许动的既有设计**：

1. **fail-safe 顺序**（`swap-workflow.service.ts:838-845` 有长注释）：先开便签、再暴露补料入口。崩在中间时客户「已被限制但暂时看不到入口」是保守的；反过来会出现「入口已暴露但限制没落地」。**登记材料请求属于「暴露入口」，必须排在 open 之后。**
2. **sticky 硬线标记**：`hasHardLineDisposition()` 读 `customer_main.hardLineDispositionedAt`，跨订单持久。这一列与本账无关，**保留**。硬线时仍然不登记任何材料请求。

- [ ] **Step 1: 改 swap-workflow 的处置块**

`swap-workflow.service.ts` 把 `await this.customerPendingActionService.set(...)` 那一整段（约 L860-875，含其上方的注释）替换为：

```ts
      // tipping-off 线：制裁调查绝不能提示客户；只有「这次是软线」且「这个客户
      // 从未被硬线过」才登记补料入口（exposeToCustomer 已在上方算好）。
      //
      // 2026-08-17 材料请求账：从 customerPendingActionService.set() 换成逐条
      // 登记材料账。旧写法是 customer_main 上一个**单值指针**，只取
      // actions[0]，同一客户第二笔单软线拒还会把第一笔整个盖掉 —— 那正是本轮
      // 要治的病。现在一条 action 一行，各交各的、各撕各的。
      //
      // ⚠️ 本段必须留在上面 open() 之后：登记材料请求 = 暴露入口，
      // fail-safe 顺序是 load-bearing 的（见上方注释），不要合并或调换。
      if (exposeToCustomer) {
        const customer = await this.prisma.customerMain.findUnique({
          where: { id: swap.ownerId },
          select: { id: true, sumsubApplicantId: true },
        });
        if (customer?.sumsubApplicantId) {
          for (const action of actions) {
            await this.materialRequestIssuer.register({
              customerId: customer.id,
              sumsubApplicantId: customer.sumsubApplicantId,
              materialType: 'SOURCE_OF_FUNDS',
              levelName: 'wave3-action-sof-refresh',
              applicantActionId: action.applicantActionId,
              externalActionId: action.externalActionId,
              orderDomain: 'SWAP',
              orderRef: swap.swapNo,
              origin: 'SUMSUB_PUSHED',
              reason: `Swap ${swap.swapNo} KYT rejected — additional materials required`,
              issuedBy: 'SYSTEM',
              // 便签上面已经开好了（restrictionNo 在手），这里不重复开 ——
              // register 的 restrict=false 表示「不要再开一张」，不表示「不摁人」。
              restrict: false,
              actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
            });
          }
        }
      }
      // 硬线（含制裁）：一条材料请求都不登记 —— 客户端因此结构上没有任何入口。
      // 旧写法这里是 set(null) 把可能残留的软线指针清空；单指针没了之后不需要
      // 这一步，因为软线登记的是**属于那笔单**的行，不会被这笔硬线单波及。
      // 真要收口历史入口，靠的是 hardLineDispositionedAt 这个 sticky 标记
      // （下面仍然照常盖章），而不是清指针。
```

紧接其后保留既有的 sticky 盖章调用，把它从 `set(..., hasSanction)` 抽成独立方法调用：

```ts
      if (hasSanction) {
        await this.customerPendingActionService.markHardLineDisposition(swap.ownerId);
      }
```

在 `CustomerPendingActionService` 上新增这个方法（该文件 Task 12 才删，但 `hasHardLineDisposition` / `markHardLineDisposition` 两个方法要在删文件时**搬到** `CustomersService`，Task 12 负责）：

```ts
  /**
   * 盖 sticky 硬线章。一旦盖上，这个客户后续任何软线裁决都不再暴露补料入口。
   * 只在命中制裁时盖 —— 「无 action 的硬线」不该造成永久沉默（终审 Finding 3）。
   */
  async markHardLineDisposition(customerId: string): Promise<void> {
    const existing = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    if (existing?.hardLineDispositionedAt) return;
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { hardLineDispositionedAt: new Date() },
    });
  }
```

在 `swap-workflow.service.ts` 构造函数注入 `private readonly materialRequestIssuer: MaterialRequestIssuerService`，模块 `imports` 加 `forwardRef(() => MaterialRequestsModule)`。

- [ ] **Step 2: 让 applicant-action.handler 交出裁决处置**

`src/modules/swap-sumsub/applicant-action.handler.ts`：GREEN/RED 的处置（清指针、resetSubmission、autoRelease）现在归 Task 4 的 `MaterialRequestReviewService` 统一管。本 handler 只剩一件它独有的事 —— **「GREEN 到过但被刻意不解锁」那条审计**。整个文件替换为：

```ts
import { Injectable, Logger } from '@nestjs/common';
import { AuditLogsService } from '../audit-logging/audit-logs.service';
import {
  AuditActions, AuditEntityTypes, AuditWorkflowTypes,
} from '../audit-logging/constants/audit-actions.constant';
import { AuditResult } from '../audit-logging/dto/audit-log.dto';
import { PrismaService } from '../../core/prisma/prisma.service';
import { CustomerPendingActionService } from '../identity/customers/customer-pending-action.service';
import { MaterialRequestsService } from '../identity/material-requests/material-requests.service';

/**
 * 兑换域对 applicantActionReviewed 的**唯一剩余职责**：
 * 记录「这个客户的补料 GREEN 过，但因为他被硬线处置过，限制被刻意保留」。
 *
 * 2026-08-17 材料请求账之前，本 handler 还负责清 pendingAction 指针、
 * resetSubmission、决定撕不撕限制 —— 那些现在统一在
 * MaterialRequestReviewService（Task 4）里做，三个域一套逻辑。
 * 留在这里的只有这条审计：调查员需要能查到「GREEN 到过、被刻意没解锁」，
 * 而那个判断依据（hardLineDispositionedAt）是兑换域独有的。
 */
@Injectable()
export class SwapApplicantActionHandler {
  private readonly logger = new Logger(SwapApplicantActionHandler.name);

  constructor(
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly auditLogsService: AuditLogsService,
    private readonly pendingActionService: CustomerPendingActionService,
    private readonly materialRequests: MaterialRequestsService,
  ) {}

  /** 由 MaterialRequestReviewService 在 GREEN 落地后回调；非兑换域的行直接返回。 */
  async noteHardLineHeld(requestNo: string): Promise<void> {
    const row = await this.materialRequests.findByNo(requestNo);
    if (!row || row.orderDomain !== 'SWAP') return;

    const hardLined = await this.pendingActionService.hasHardLineDisposition(row.customerId);
    if (!hardLined) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: row.customerId },
      select: { customerNo: true },
    });

    await this.auditLogsService.recordSystem({
      action: AuditActions.SWAP_ACTION_GREEN_HARDLINE_HELD,
      entityType: AuditEntityTypes.CUSTOMER,
      entityId: row.customerId,
      entityNo: customer?.customerNo || undefined,
      workflowType: AuditWorkflowTypes.SWAP,
      entityOwnerType: 'CUSTOMER',
      entityOwnerId: row.customerId,
      result: AuditResult.SUCCESS,
      reason:
        `Material request ${requestNo} reviewed GREEN, but this customer carries a sticky ` +
        'hard-line disposition — restrictions deliberately held. Recorded so an investigator ' +
        'can verify the GREEN was seen and consciously not acted on.',
      metadata: { requestNo, orderRef: row.orderRef },
      sourcePlatform: 'SYSTEM',
    });
  }
}
```

在 `MaterialRequestReviewService.applyReview` 的 GREEN 分支、`autoRelease` 之后加一行回调（构造函数注入该 handler，模块间用 `forwardRef`）：

```ts
      await this.swapApplicantActionHandler.noteHardLineHeld(row.requestNo);
```

- [ ] **Step 3: 让 webhook router 不再认领 applicantActionReviewed**

`swap-webhook-router.ts` 里 `route()` 对 `applicantActionReviewed` 的分支删除（Task 4 已把该报文改成按 `externalActionId` 查材料账定位）。若删完 `route()` 只剩其它报文类型，保留；若整个 router 只服务这一种报文，删掉该文件并从模块摘掉。

- [ ] **Step 4: 改测试**

`applicant-action.handler.spec.ts` 原有用例大半失效（它们断言的是已经搬走的处置逻辑）。整体重写为三条：

```ts
describe('SwapApplicantActionHandler.noteHardLineHeld', () => {
  it('非 SWAP 域的行直接返回，不写审计', async () => {
    const { handler, audit, requests } = build();
    requests.findByNo.mockResolvedValue({ requestNo: 'M1', customerId: 'c1', orderDomain: 'DEPOSIT' });
    await handler.noteHardLineHeld('M1');
    expect(audit.recordSystem).not.toHaveBeenCalled();
  });

  it('SWAP 域但没被硬线过 → 不写审计（正常放行，没什么可记的）', async () => {
    const { handler, audit, pending } = build();
    pending.hasHardLineDisposition.mockResolvedValue(false);
    await handler.noteHardLineHeld('M1');
    expect(audit.recordSystem).not.toHaveBeenCalled();
  });

  it('SWAP 域且被硬线过 → 写一条 GREEN_HARDLINE_HELD，供调查员核实', async () => {
    const { handler, audit, pending } = build();
    pending.hasHardLineDisposition.mockResolvedValue(true);
    await handler.noteHardLineHeld('M1');
    expect(audit.recordSystem).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'SWAP_ACTION_GREEN_HARDLINE_HELD' }),
    );
  });
});
```

`swap-workflow.service.spec.ts` 里断言 `customerPendingActionService.set` 的用例改为断言 `materialRequestIssuer.register`：软线暴露时**逐条**调用（`actions.length` 次，不再只取第一条），硬线一次都不调，`markHardLineDisposition` 只在 `hasSanction` 时调。

```ts
  it('软线拒：报文带三条 action → 逐条登记，不再只取第一条（单指针病的直接反证）', async () => {
    // ...三条 action 的 verdict fixture
    expect(issuer.register).toHaveBeenCalledTimes(3);
  });

  it('硬线拒：一条都不登记 —— 客户端结构上没有入口', async () => {
    expect(issuer.register).not.toHaveBeenCalled();
  });

  it('fail-safe 顺序：open 便签的调用发生在 register 之前', async () => {
    const openOrder = restrictions.open.mock.invocationCallOrder[0];
    const registerOrder = issuer.register.mock.invocationCallOrder[0];
    expect(openOrder).toBeLessThan(registerOrder);
  });
```

- [ ] **Step 5: 跑测试 + tsc**

```bash
npx jest src/modules/trading/swap-transactions src/modules/swap-sumsub src/modules/identity/material-requests && npx tsc --noEmit
```

- [ ] **Step 6: 核对单指针真的不再被写**

```bash
grep -rn --include='*.ts' "pendingActionExternalId\|pendingActionReason\|pendingActionSubmittedAt" src/ | grep -v '\.spec\.ts' | grep -v "customer-pending-action.service.ts"
```

期望：**无输出**。只剩 `customer-pending-action.service.ts` 自己（它 Task 12 才删）。

- [ ] **Step 7: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/trading/swap-transactions src/modules/swap-sumsub src/modules/identity && git commit -m "refactor(swap): 软线补料改走材料账，拆掉客户级单指针

customer_main.pendingActionExternalId 是单值、set() 是覆盖写，而处置块只取
actions[0] —— 一笔单带回多条 action 时后面几条直接丢，同一客户第二笔单软线拒
又把第一笔整个盖掉。这正是本轮要治的病。现在一条 action 一行。

两条不许动的既有设计都保住了：
- fail-safe 顺序：登记材料请求 = 暴露入口，仍排在 open 便签之后（有测试锁顺序）
- sticky 硬线标记：hardLineDispositionedAt 保留，硬线时一条都不登记

applicant-action.handler 交出 GREEN/RED 处置（归 Task 4 三域统一），只留
「GREEN 到过但被刻意不解锁」那条兑换域独有的审计。"
```

---

### Task 11: 材料重检域迁到材料账 + Profile 横幅改数据源

**Files:**
- Modify: `src/modules/identity/material-refresh/material-refresh.service.ts:44-90` 与 `:355-395`
- Modify: `src/modules/identity/material-refresh/material-freshness-cron.service.ts` — 升 BLOCKING 时补挂便签
- Modify: `src/modules/identity/profile-banners/profile-banners.service.ts` — 横幅数据源
- Modify: `prisma/schema.prisma` + 新迁移 — `material_refresh_cycles` 加 `materialRequestNo`
- Modify: `src/modules/identity/profile-banners/profile-banners.service.spec.ts`

**Interfaces:**
- Consumes: `MaterialRequestIssuerService.issue()`；`MaterialRequestsService.listLiveByCustomer()`；`CustomerRestrictionWorkflowService.openRestriction()`
- Produces: `material_refresh_cycles.materialRequestNo` 列

**核心约束（设计稿 §5.3）**：T-30 建行时**不挂限制**，T-0 在**同一行上补挂**。**不要重新下发** —— 客户手里那个认证链接从 T-30 到 T-0 必须不变。今天的行为就是如此（已核实：`material-refresh.service.ts` 两处 `createApplicantAction` 都只在建 cycle 那一刻调，升档 cron 只改 stage）。

- [ ] **Step 1: 加列 + 迁移**

`prisma/schema.prisma` 的 `MaterialRefreshCycle` 里加：

```prisma
  /** 本轮到期提醒对应的材料请求。cycle 管「哪天到期」，材料账管「下发本身」。 */
  materialRequestNo        String?
```

`prisma/migrations/20260817010000_cycle_material_request_no/migration.sql`：

```sql
ALTER TABLE "material_refresh_cycles" ADD COLUMN "materialRequestNo" TEXT;
```

```bash
bash scripts/apply-local-migrations.sh && npm run prisma:generate
```

- [ ] **Step 2: 建 cycle 时改走 issuer**

`material-refresh.service.ts` 两处（`triggerType: 'SCHEDULED_EXPIRY'` 与 `'INITIAL_COLLECTION'`）的 `createApplicantAction` + `update sumsubAction*` 整块，各自替换为：

```ts
    try {
      // T-30 建行**不挂限制** —— 证件还没过期，只是提醒（设计稿 §5.3）。
      // 到 T-0 由 cron 在**同一行上**补挂便签，认证链接全程不变。
      const { requestNo } = await this.issuer.issue({
        customerId: holding.customerId,
        materialType: holding.materialType,
        orderDomain: null,
        orderRef: null,
        restrict: false,
        origin: 'SYSTEM_SCHEDULED',
        reason: `${holding.materialType} expires on ${holding.expiresAt?.toISOString().slice(0, 10) ?? 'unknown'}`,
        issuedBy: 'SYSTEM',
        actor: { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
      });
      await this.prisma.materialRefreshCycle.update({
        where: { id: cycle.id },
        data: { materialRequestNo: requestNo },
      });
    } catch (err) {
      this.logger.error(
        `Failed to issue material request for cycle ${cycle.cycleNo}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
```

构造函数注入 `MaterialRequestIssuerService`，删掉对 `sumsubClient.createApplicantAction` 的直接依赖与 Task 3 打的 `MRQ-LEGACY` 临时补丁。

- [ ] **Step 3: 升 BLOCKING 时在同一行补挂便签**

`material-freshness-cron.service.ts` 里 `targetStage === 'BLOCKING'` 那一支，在改 stage 之后加：

```ts
        // 同一行补挂便签 —— **不重新下发**。客户手里那个认证链接从 T-30 到
        // T-0 必须不变；重新下发会让 Sumsub 侧多一条 action、老的还悬着，
        // 客户还会收到第二个链接。
        if (cycle.materialRequestNo) {
          const { restrictionNo } = await this.restrictionWorkflow.openRestriction(
            {
              customerId: cycle.customerId,
              cause: 'MATERIAL_EXPIRED',
              reason: `${cycle.materialType} expired — trading restricted until refreshed`,
              caseRef: cycle.materialRequestNo,
              openedBy: 'SYSTEM',
            },
            { actorType: 'SYSTEM', userId: 'SYSTEM', userNo: 'SYSTEM', role: 'SYSTEM', roleCodes: ['SYSTEM'] } as any,
          );
          await this.materialRequests.attachRestriction(cycle.materialRequestNo, restrictionNo);
        }
```

- [ ] **Step 4: 横幅改数据源**

`profile-banners.service.ts` 里 `MATERIAL_REFRESH` 那一路（读 `materialRefreshCycle` 的整段）替换为读材料账：

```ts
    // ── 材料请求横幅（2026-08-17 起数据源是材料账，不再是 cycle）──
    // G6：客户级横幅 = 活行里「挂了限制的」∪「没绑单的」。
    // 绑了单又没挂限制的只在订单页露 —— 那种行在这里被过滤掉。
    const requests = await this.materialRequests.listLiveByCustomer(customerId);
    for (const r of requests) {
      const blocking = r.restrictionNo !== null;
      if (!blocking && r.orderDomain !== null) continue; // 订单页管它

      banners.push({
        id: `material-request:${r.requestNo}`,
        type: 'MATERIAL_REFRESH',
        // 挂了摁人的限制 → 红；只是提醒 → 黄
        severity: blocking ? 'BLOCKING' : 'INFO',
        title: blocking
          ? `${formatMaterialName(r.materialType)} required`
          : `${formatMaterialName(r.materialType)} needs refreshing`,
        description: r.reason,
        materialType: r.materialType,
        ctaLabel: r.status === 'SUBMITTED' ? null : 'Verify now',
        ctaPath: r.status === 'SUBMITTED' ? null : `/verification/${r.requestNo}`,
        dismissible: !blocking,
      });
    }
```

`RESTRICTION` 那一路（读 `CustomerAccess.disclosed`）**保持不动** —— 它服务的是不带材料请求的限制（比如 `ADMIN_SUSPENSION`）。

⚠️ 会出现「同一张便签既有 RESTRICTION 横幅、又有 MATERIAL_REFRESH 横幅」的重复。去重：`RESTRICTION` 那一路跳过 `restrictionNo` 已被某条活的材料请求引用的便签（那条便签的故事由材料横幅讲，它带 CTA、更有用）。在该循环里加：

```ts
    const claimedRestrictionNos = new Set(
      requests.filter((r) => r.restrictionNo).map((r) => r.restrictionNo as string),
    );
    // ...RESTRICTION 循环内：
      if (claimedRestrictionNos.has(restriction.restrictionNo)) continue;
```

（把 `requests` 的查询提到两个循环之前。）

- [ ] **Step 5: 测试**

`profile-banners.service.spec.ts` 加四条：

```ts
  it('不绑单不挂限制（护照 T-30）→ INFO 黄档，带 CTA', async () => { /* severity 'INFO'，ctaPath '/verification/MRQ1' */ });
  it('挂了限制 → BLOCKING 红档', async () => { /* severity 'BLOCKING' */ });
  it('绑了单又没挂限制 → 横幅上不露（订单页管它，G6）', async () => { /* banners 里没有它 */ });
  it('已提交的行不给 CTA（客户没什么可点的）', async () => { /* ctaPath null */ });
  it('同一张便签不同时出两条横幅（材料横幅优先，它带 CTA）', async () => { /* 只有一条 */ });
```

- [ ] **Step 6: 跑测试 + tsc + Commit**

```bash
npx jest src/modules/identity/material-refresh src/modules/identity/profile-banners && npx tsc --noEmit
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add src/modules/identity prisma && git commit -m "refactor(material-refresh): 到期提醒改走材料账 + 横幅两档

T-30 建行不挂限制（黄档提醒），T-0 由 cron 在**同一行上**补挂 MATERIAL_EXPIRED
便签转红。不重新下发 —— 客户手里那个认证链接从 T-30 到 T-0 全程不变，重新下发
会让 Sumsub 侧多一条 action、老的还悬着、客户收到第二个链接。

cycle 表加 materialRequestNo：cycle 管「哪天到期」（下发的理由），材料账管
「下发本身」。两者职责分开，cycle 表本身保留。

横幅数据源改材料账并按 G6 过滤（挂限制的 ∪ 没绑单的），severity 由 restrictionNo
决定。同一张便签不再同时出 RESTRICTION 与 MATERIAL_REFRESH 两条。"
```

---

### Task 12: 统一删旧结构 + 收口自查

**Files:**
- Modify: `prisma/schema.prisma` — 删 2 表 6 列
- Create: `prisma/migrations/20260817020000_drop_legacy_action_stores/migration.sql`
- Delete: `customer-pending-action.service.ts` / `.controller.ts` / `.spec.ts`、`material-refresh-cycles.controller.ts`、三域 verification-session service 残壳
- Modify: `customers.service.ts` — 接收从 pending-action service 搬来的两个 sticky 方法

**Interfaces:**
- Consumes: 无新增
- Produces: `CustomersService.hasHardLineDisposition(customerId)` / `.markHardLineDisposition(customerId)`（从被删的 service 搬过来）

这是 G3 的兑现任务。前序任务已让旧结构全部零写入。

⚠️ **完成度指标是 grep 残留数，不是 tsc 错误数。** 上一轮实测：删列后 tsc 只能逮住约 24% 的残留引用 —— `(prisma as any)` 和 `async (tx: any)` 会让删列的读写在编译期完全隐形，构建绿着但运行时炸，或者更糟：一道合规闸门静默失效而没人发现。

- [ ] **Step 1: 先搬走要保留的两个方法**

`hardLineDispositionedAt` 这一列**保留**（跨订单 sticky 事实，与本账无关），但它的两个访问方法住在即将被删的 `CustomerPendingActionService` 里。搬到 `CustomersService`：

```ts
  /** 这个客户是否曾被任意一笔兑换硬线处置过。一旦为真，后续软线裁决不再暴露补料入口。 */
  async hasHardLineDisposition(customerId: string): Promise<boolean> {
    const c = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    return !!c?.hardLineDispositionedAt;
  }

  /** 盖 sticky 硬线章。只在命中制裁时盖 —— 「无 action 的硬线」不该造成永久沉默。 */
  async markHardLineDisposition(customerId: string): Promise<void> {
    const c = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { hardLineDispositionedAt: true },
    });
    if (c?.hardLineDispositionedAt) return;
    await this.prisma.customerMain.update({
      where: { id: customerId },
      data: { hardLineDispositionedAt: new Date() },
    });
  }
```

把 `swap-workflow.service.ts` 与 `applicant-action.handler.ts` 里对 `customerPendingActionService.hasHardLineDisposition/markHardLineDisposition` 的调用改指向 `customersService`。

- [ ] **Step 2: 删文件**

```bash
git rm \
  src/modules/identity/customers/customer-pending-action.service.ts \
  src/modules/identity/customers/customer-pending-action.controller.ts \
  src/modules/identity/customers/customer-pending-action.service.spec.ts \
  src/modules/identity/material-refresh/material-refresh-cycles.controller.ts \
  src/modules/trading/deposit-transactions/deposit-verification-session.service.ts \
  src/modules/trading/withdraw-transactions/withdraw-verification-session.service.ts
```

（若某个 spec 文件名不同，先 `ls` 确认再删；`material-refresh-cycles.controller.ts` 的三个端点已由 `/client/me/material-requests/*` 取代。）

从各自的 module 的 `controllers` / `providers` / `exports` 里摘掉它们。

- [ ] **Step 3: 删 schema 里的 2 表 6 列**

`prisma/schema.prisma`：
- 整块删除 `model DepositApplicantAction` 与 `model WithdrawApplicantAction`
- 删除 `DepositTransaction` / `WithdrawTransaction` 上对应的 `applicantActions` 关系行
- 删除 `CustomerMain` 的 `pendingActionExternalId` / `pendingActionReason` / `pendingActionSubmittedAt` 三行（**保留** `hardLineDispositionedAt`）以及 `@@index([pendingActionExternalId])`
- 删除 `MaterialRefreshCycle` 的 `sumsubActionId` / `sumsubActionLevelName` / `sumsubActionCreatedAt` 三行（**保留** 表本身与新加的 `materialRequestNo`）

- [ ] **Step 4: 手写迁移（SQLite 删列必须表重建）**

⚠️ SQLite 删带 FK 的列要用「建 `_new` 表 → 拷数据 → drop 旧 → rename」的表重建模式（funds-orders Round 2 踩过）。**禁止** `npx prisma migrate dev`（上一轮因此被评审判定不可验证）。

`prisma/migrations/20260817020000_drop_legacy_action_stores/migration.sql`：

```sql
PRAGMA foreign_keys=OFF;

DROP TABLE "deposit_applicant_actions";
DROP TABLE "withdraw_applicant_actions";

-- customer_main：删三个 pendingAction* 列，保留 hardLineDispositionedAt。
-- 用 Prisma 生成的完整建表语句填 <...>：先跑一次
--   npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script
-- 取其中 customer_main 的 CREATE TABLE 段，改名为 new_customer_main 贴在下面，
-- 再按列名逐一对应 INSERT。不要手打列清单 —— 这张表有 60 多列，手打必漏。
CREATE TABLE "new_customer_main" ( /* <粘贴 diff 出来的建表语句，表名改 new_customer_main> */ );
INSERT INTO "new_customer_main" ( /* <粘贴同一份列清单，去掉三个 pendingAction* 列> */ )
  SELECT /* <同上列清单> */ FROM "customer_main";
DROP TABLE "customer_main";
ALTER TABLE "new_customer_main" RENAME TO "customer_main";

-- material_refresh_cycles：删三个 sumsubAction* 列，保留表与 materialRequestNo
CREATE TABLE "new_material_refresh_cycles" ( /* <同法> */ );
INSERT INTO "new_material_refresh_cycles" ( /* <列清单，去掉三个 sumsubAction*> */ )
  SELECT /* <同上> */ FROM "material_refresh_cycles";
DROP TABLE "material_refresh_cycles";
ALTER TABLE "new_material_refresh_cycles" RENAME TO "material_refresh_cycles";

PRAGMA foreign_keys=ON;
```

**重建表后必须重建索引与唯一约束** —— 表重建会把它们一起丢掉。从 `migrate diff` 的输出里把这两张表的所有 `CREATE INDEX` / `CREATE UNIQUE INDEX` 原样补在文件末尾。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && bash scripts/stack.sh down && rm -f "$(grep '^DATABASE_URL=' .env | sed 's|^DATABASE_URL=file:||' | tr -d '"')" && bash scripts/stack.sh up && bash scripts/on-stack.sh self db:base:sync && bash scripts/on-stack.sh self db:biz:init
```

（G1：demo 数据随时可重铺，直接删库从零建更干净，也顺便验证了迁移能从空库跑通。）

- [ ] **Step 5: 收口自查 —— 这一步是本任务的真正验收**

逐条跑，**每条期望输出都是 0**：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
echo -n "pendingAction* 残留: "; grep -rn --include='*.ts' "pendingActionExternalId\|pendingActionReason\|pendingActionSubmittedAt" src/ test/ prisma/ | wc -l | tr -d ' '
echo -n "两张子表残留:       "; grep -rn --include='*.ts' "deposit_applicant_actions\|withdraw_applicant_actions\|depositApplicantAction\|withdrawApplicantAction" src/ test/ prisma/ | wc -l | tr -d ' '
echo -n "sumsubAction* 残留:  "; grep -rn --include='*.ts' "sumsubActionId\|sumsubActionLevelName\|sumsubActionCreatedAt" src/ test/ prisma/ | wc -l | tr -d ' '
echo -n "verification-session 端点残留: "; grep -rn --include='*.ts' "verification-session" src/ | wc -l | tr -d ' '
echo -n "CustomerPendingActionService 引用: "; grep -rn --include='*.ts' "CustomerPendingActionService" src/ | wc -l | tr -d ' '
echo -n "schema 残留:        "; grep -cE "pendingAction(ExternalId|Reason|SubmittedAt)|DepositApplicantAction|WithdrawApplicantAction|sumsubAction" prisma/schema.prisma
echo -n "hardLineDispositionedAt 应当还在（期望 ≥1）: "; grep -c "hardLineDispositionedAt" prisma/schema.prisma
```

任何一条非 0（除最后一条）就是漏网，回去补。**不要**因为 `tsc` 是绿的就认为干净了。

- [ ] **Step 6: 硬闸 + Commit**

```bash
npx tsc --noEmit && npx jest && bash scripts/on-stack.sh self demo:all
```

期望：tsc 无输出；jest 除 3 个既有失败（wallets 两支 + client-web restrictedCapabilities）外全绿；demo:all 8/8。

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add -A && git commit -m "refactor: 删掉四套旧的 applicant action 存储（G3 兑现）

删：deposit_applicant_actions / withdraw_applicant_actions 两张表；
customer_main 的 pendingAction* 三列；material_refresh_cycles 的 sumsubAction* 三列；
CustomerPendingActionService 与其 controller；material-refresh-cycles.controller；
三域 verification-session 残壳。

保留：customer_main.hardLineDispositionedAt（跨订单 sticky 事实，与本账无关），
其两个访问方法搬到 CustomersService；material_refresh_cycles 表本身（它管
「哪天到期」，是下发的理由不是下发本身）。

SQLite 删列走表重建模式并重建全部索引。验收以 grep 残留数为准而非 tsc ——
(prisma as any) 与 (tx: any) 会让删列的读写在编译期完全隐形。"
```

---

### Task 13: admin 前端 —— Panel 组件 + 下发弹窗 + 四处挂载

**Files:**
- Create: `admin-web/src/components/MaterialRequestPanel.tsx`
- Create: `admin-web/src/components/MaterialRequestIssueModal.tsx`
- Modify: `admin-web/src/rbac/permissions.ts` — 三个权限码
- Modify: `admin-web/src/pages/CustomerDetail.tsx` — 新增 Verification Requests 节
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx` / `WithdrawTransactionDetail.tsx` / `SwapTransactionDetail.tsx` — 各镜像一份

**Interfaces:**
- Consumes: Task 6 的三个后台端点、Task 4 改过的 `POST /admin/sumsub/simulate/applicant-action-result`
- Produces: `MaterialRequestPanel({ mode, customerNo?, orderDomain?, orderRef?, onChanged })`

**业主明确选了乙**：裁决按钮客户详情页与订单详情页两处都给，但**严格共用同一个组件、同一个端点**。所以 Panel 只写一份，用 `mode` 区分数据源。

**三个按钮不是两个**（设计稿 §2.2）：`✅ Approve` / `🔄 Reject · Retry` / `❌ Reject · Final`。只给「通过/不通过」就模拟不出真实流程里最常见的「让他重交」那一支。

- [ ] **Step 1: 加三个权限码**

`admin-web/src/rbac/permissions.ts`，在 `CUSTOMER_RESTRICTIONS_*` 三行之后插入：

```ts

  MATERIAL_REQUESTS_READ: 'api.get.admin_customers_customerno_material_requests',
  MATERIAL_REQUESTS_WRITE: 'api.post.admin_customers_customerno_material_requests',
  MATERIAL_REQUESTS_BY_ORDER_READ: 'api.get.admin_material_requests_by_order_orderdomain_orderref',
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web && npx tsc --noEmit -p tsconfig.app.json
```

- [ ] **Step 2: 写 Panel 组件**

新建 `admin-web/src/components/MaterialRequestPanel.tsx`。样式与结构照抄 `CustomerDetail.tsx` 里 Restrictions 节的表格（同样的 `border-adm-border` / `font-mono text-[10px]` / `AdminBadge` 语汇），裁决区照抄 `DepositTransactionDetail.tsx` 「10. Simulation」区的 `useSimulationMode()` 门控。

```tsx
import { useCallback, useEffect, useState } from 'react';
import { adminButtonClass } from './common/adminButtonStyles';
import { AdminBadge } from './ui/AdminBadge';
import { AdminSessionError, adminFetch, getApiErrorMessage } from '../utils/adminFetch';
import { useSimulationMode } from '../utils/simulationMode';
import { useAdminSession } from '../contexts/AdminSessionContext';
import { PERMISSIONS } from '../rbac/permissions';

export interface AdminMaterialRequestRow {
  requestNo: string;
  materialType: string;
  materialLabel: string;
  levelName: string;
  applicantActionId: string;
  orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP' | null;
  orderRef: string | null;
  restrictionNo: string | null;
  origin: 'SUMSUB_PUSHED' | 'OPERATOR_ISSUED' | 'SYSTEM_SCHEDULED';
  status: 'PENDING_SUBMISSION' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string;
  issuedBy: string;
  issuedAt: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewAnswer: 'GREEN' | 'RED' | null;
  reviewRejectType: 'RETRY' | 'FINAL' | null;
  cancelReason: string | null;
}

type Props =
  | { mode: 'customer'; customerNo: string; onChanged?: () => void }
  | {
      mode: 'order';
      orderDomain: 'DEPOSIT' | 'WITHDRAW' | 'SWAP';
      orderRef: string;
      onChanged?: () => void;
    };

const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');

/** 三个裁决按钮 —— RED 分 RETRY / FINAL 是 Sumsub 的真实语义，不能合成一个「不通过」。 */
const VERDICTS = [
  { key: 'GREEN', label: '✅ Approve', variant: 'workflowPrimary' as const, rejectType: undefined },
  { key: 'RETRY', label: '🔄 Reject · Retry', variant: 'workflowSecondary' as const, rejectType: 'RETRY' as const },
  { key: 'FINAL', label: '❌ Reject · Final', variant: 'workflowNegative' as const, rejectType: 'FINAL' as const },
];

const MaterialRequestPanel = (props: Props) => {
  const { hasPermission } = useAdminSession();
  const { enabled: simEnabled } = useSimulationMode();
  const [rows, setRows] = useState<AdminMaterialRequestRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const canRead =
    props.mode === 'customer'
      ? hasPermission(PERMISSIONS.MATERIAL_REQUESTS_READ)
      : hasPermission(PERMISSIONS.MATERIAL_REQUESTS_BY_ORDER_READ);

  const url =
    props.mode === 'customer'
      ? `${import.meta.env.VITE_API_URL}/admin/customers/${props.customerNo}/material-requests`
      : `${import.meta.env.VITE_API_URL}/admin/material-requests/by-order/${props.orderDomain}/${props.orderRef}`;

  const load = useCallback(() => {
    if (!canRead) return;
    setLoading(true);
    adminFetch(url)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: AdminMaterialRequestRow[]) => setRows(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [url, canRead]);

  useEffect(() => { load(); }, [load]);

  const runVerdict = async (requestNo: string, verdict: (typeof VERDICTS)[number]) => {
    setBusy(`${requestNo}:${verdict.key}`);
    setError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/sumsub/simulate/applicant-action-result`,
        {
          method: 'POST',
          body: JSON.stringify({
            requestNo,
            reviewAnswer: verdict.key === 'GREEN' ? 'GREEN' : 'RED',
            ...(verdict.rejectType ? { reviewRejectType: verdict.rejectType } : {}),
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Verdict failed.'));
      load();
      props.onChanged?.();
    } catch (e) {
      if (e instanceof AdminSessionError) return;
      setError(e instanceof Error ? e.message : 'Verdict failed.');
    } finally {
      setBusy(null);
    }
  };

  if (!canRead) return null;

  return (
    <div>
      {error && (
        <div className="mb-3 rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
          {error}
        </div>
      )}
      {loading ? (
        <p className="font-mono text-[10px] text-adm-t3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="font-mono text-[10px] text-adm-t3">No material requests.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {['Request No', 'Material', 'Bound To', 'Blocks', 'Status', 'Issued', ''].map((h, i) => (
                  <th
                    key={h || `col-${i}`}
                    className="border-b border-adm-border bg-adm-panel px-3 py-1.5 text-left font-mono text-[8.5px] font-semibold uppercase tracking-[0.12em] text-adm-t3 whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.requestNo} className="border-b border-adm-border">
                  <td className="px-3 py-2 font-mono text-[11px] font-semibold text-adm-amber whitespace-nowrap">
                    {r.requestNo}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {r.materialLabel}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {r.orderRef ? `${r.orderDomain} ${r.orderRef}` : 'Customer level'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] whitespace-nowrap">
                    {r.restrictionNo ? (
                      <span className="text-adm-red">{r.restrictionNo}</span>
                    ) : (
                      <span className="text-adm-t3">— nudge only</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <AdminBadge value={r.status} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px] text-adm-t2 whitespace-nowrap">
                    {fmt(r.issuedAt)} · {r.issuedBy}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {/* 只有客户已经交了才有得裁决。整块受模拟模式门控 —— 真接
                        Sumsub 时裁决在 Sumsub 后台做，这里不该出现按钮。 */}
                    {simEnabled && r.status === 'SUBMITTED' ? (
                      <span className="inline-flex gap-1.5">
                        {VERDICTS.map((v) => (
                          <button
                            key={v.key}
                            disabled={busy !== null}
                            onClick={() => void runVerdict(r.requestNo, v)}
                            className={adminButtonClass(v.variant)}
                          >
                            {busy === `${r.requestNo}:${v.key}` ? '…' : v.label}
                          </button>
                        ))}
                      </span>
                    ) : (
                      <span className="font-mono text-[10px] text-adm-t3">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MaterialRequestPanel;
```

- [ ] **Step 3: 写下发弹窗**

新建 `admin-web/src/components/MaterialRequestIssueModal.tsx`。形态照抄 `RestrictionOpenModal.tsx`（同样的 `fixed inset-0 z-50` 遮罩 + `EchoRow` 只读回显 + 底部两个按钮）。要点：

- 材料类型下拉 = 五个 key，显示人话标签
- 绑单下拉 = 该客户非终态单（从 `GET /admin/customers/:customerNo` 详情里已有的单列表取；若详情不带，加一个 `orderRef` 手填输入框，**不要**为此新造一个后台端点）
- 「Restrict trading」勾选，默认值取该材料的 `enforceRestriction`（前端硬编码一张 `{ EMIRATES_ID: true, LIVENESS: true, PROOF_OF_ADDRESS: true, SOURCE_OF_FUNDS: true, SOURCE_OF_WEALTH: true }`，并在注释里注明它镜像 `config/material-refresh-policy.json`）
- 勾了才显示能力范围勾选框（`DEPOSIT` / `WITHDRAW` / `SWAP`）
- **没有 cause 下拉**（G4）。回显区固定写一行：`Restriction cause · PENDING_DOCUMENT (disclosed to the customer)`
- 提交打 `POST /admin/customers/:customerNo/material-requests`

- [ ] **Step 4: 四处挂载**

`CustomerDetail.tsx`：在 Restrictions 节之后加一节，右上角一个「Request Documents」按钮开弹窗：

```tsx
          {/* ⑥ Verification Requests —— 这个客户当前所有的材料下发（含终态） */}
          <section className="px-6 py-5">
            <div className="flex items-baseline justify-between gap-3">
              <Cap>Verification Requests</Cap>
              {hasPermission(PERMISSIONS.MATERIAL_REQUESTS_WRITE) && (
                <button
                  onClick={() => setIssueModalOpen(true)}
                  className={adminButtonClass('rowSecondaryUtility')}
                >
                  Request Documents
                </button>
              )}
            </div>
            <p className="mt-1 mb-3 font-mono text-[9px] text-adm-t3">
              One row = one issuance. Rows without a restriction are reminders only.
            </p>
            <MaterialRequestPanel
              mode="customer"
              customerNo={detail.customerNo}
              onChanged={() => fetchRestrictions(detail.customerNo)}
            />
          </section>
```

三个订单详情页各加一节（以充值为例，提现/兑换同形，只换 `orderDomain` 与单号变量）：

```tsx
        <section className="px-6 py-5">
          <Cap>Verification Requests</Cap>
          <MaterialRequestPanel mode="order" orderDomain="DEPOSIT" orderRef={data.depositNo} />
        </section>
```

- [ ] **Step 5: tsc + 渲染截图验收**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/admin-web && npx tsc --noEmit -p tsconfig.app.json
```

**curl 200 不算数** —— 必须起栈、登录、渲染、截图比对：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && bash scripts/stack.sh up
```

用 admin 账号 `admin@fiatx.com / 123456` 登录 `http://localhost:<ADMIN_PORT>`，逐一截图确认：
1. 客户详情页 Verification Requests 节渲染出行，「Request Documents」按钮在
2. 下发弹窗：切换材料类型时「Restrict trading」默认值跟着变；**下拉里没有任何 cause 选项**
3. 下发一条后列表立刻出现该行，`Blocks` 列显示便签号或 `— nudge only`
4. 客户端提交后回到后台，该行状态变 `SUBMITTED` 且**三个**裁决按钮出现
5. 同一条行在订单详情页也能看到、按钮一样（证明两处共用同一组件）
6. 关掉模拟模式开关 → 裁决按钮整体消失

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add admin-web && git commit -m "feat(admin): 材料请求面板 + 下发弹窗，客户详情与订单详情共用

业主选的乙：裁决按钮两处都给，但严格共用一个组件一个端点，用 mode 区分
数据源，行为天然一致。

三个裁决按钮而不是两个 —— RED 分 RETRY / FINAL 是 Sumsub 真实语义，只给
「通过/不通过」就模拟不出真实流程里最常见的「让他重交」。裁决区整体受模拟
模式门控，真接 Sumsub 时裁决在 Sumsub 后台做。

G4：下发弹窗没有 cause 下拉，回显区固定写 PENDING_DOCUMENT。"
```

---

### Task 14: client 前端 —— 统一认证页 + 删四个旧页 + 横幅接线

**Files:**
- Create: `client-web/src/pages/MaterialVerification.tsx`
- Delete: `client-web/src/pages/{DepositVerification,WithdrawVerification,Verification,PendingVerification}.tsx`
- Modify: `client-web/src/App.tsx`（或路由文件）— 加 `/verification/:requestNo`，删四条旧路由
- Modify: `client-web/src/components/PendingActionBanner.tsx` — 数据源改材料账
- Modify: 充值/提现/兑换详情页 — 材料入口改指 `/verification/:requestNo`

**Interfaces:**
- Consumes: Task 7 的三个客户端端点
- Produces: 路由 `/verification/:requestNo`

前端文件不受 G3 约束（G3 管的是数据库结构与后端端点），四个旧页本任务直接删。

- [ ] **Step 1: 写统一认证页**

新建 `client-web/src/pages/MaterialVerification.tsx`。**照抄 `DepositVerification.tsx` 已经跑通的两态结构**，只把定位符从 `depositNo + seq` 换成 `requestNo`。那个文件里有两处修过的坑，一并抄过来：

- 提交前必须检查 `r.ok`（否则后端 404/500 时前端会静默「成功」跳走）
- demo 分支要有加载态（会话 GET 还在飞时假上传组件不能已经可点）

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useSimulationMode } from '../utils/simulationMode';

type SessionView = { submitted: boolean; sdkToken: string | null };

const MaterialVerification = () => {
  const { requestNo } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { enabled: simulation } = useSimulationMode();

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [submitted, setSubmitted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  /** 从哪来回哪去。没有 from 就回 Profile —— 材料这件事的常驻入口在那儿。 */
  const goBack = () => navigate(params.get('from') || '/profile');

  const load = useCallback(async () => {
    try {
      const r = await fetch(
        `${import.meta.env.VITE_API_URL}/client/me/material-requests/${requestNo}/session`,
        { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
      );
      const s = (await r.json()) as SessionView;
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      // 真接分支专属：submitted===false 却没拿到 token，说明这条 action 眼下
      // 铸不出会话（Sumsub 侧异常）。demo 分支不会走到这里。
      if (!simulation && !s.submitted && !s.sdkToken) {
        setState('error');
        return;
      }
      setState('ready');
    } catch {
      setState('error');
    }
  }, [requestNo, simulation]);

  useEffect(() => { void load(); }, [load]);

  const submit = async () => {
    setSubmitError(false);
    const r = await fetch(
      `${import.meta.env.VITE_API_URL}/client/me/material-requests/${requestNo}/submit`,
      { method: 'POST', headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } },
    );
    // 不检查 r.ok 就 navigate 会在后端 404/500 时静默「成功」跳走 —— 旧页踩过
    if (!r.ok) { setSubmitError(true); return; }
    setSubmitted(true);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <button onClick={goBack} className="mb-6 flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass">
        <ArrowLeft size={16} /> Back
      </button>

      <h1 className="mb-1 text-xl font-bold text-fx-sand">Document request</h1>
      <p className="mb-6 text-sm text-fx-dust">Provide the requested documents to continue.</p>

      {submitError && (
        <div className="mb-4 rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-3 text-sm text-fx-rust">
          Could not submit your documents. Please try again.
        </div>
      )}

      {submitted ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          We have received your information and it is being reviewed.
        </div>
      ) : state === 'error' ? (
        <div className="rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-4">
          <p className="mb-3 text-sm text-fx-rust">Verification failed to load.</p>
          <button onClick={() => void load()} className="fx-btn-ghost">Retry</button>
        </div>
      ) : state === 'loading' && simulation ? (
        // demo 分支必须有加载态：会话 GET 还在飞时假上传组件不能已经可点，
        // 否则这期间点提交会静默跳走（旧页踩过）。真接分支的加载态由下面的
        // SDK 容器自己处理，容器 DOM 必须全程挂着，所以这条分支只拦 simulation。
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          Loading verification…
        </div>
      ) : simulation ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-6">
          <p className="mb-4 text-sm text-fx-dust">
            Demo mode — no documents are actually uploaded.
          </p>
          <button onClick={() => void submit()} className="fx-btn-primary">
            Submit documents
          </button>
        </div>
      ) : (
        <div ref={containerRef} id="sumsub-sdk-container" />
      )}
    </div>
  );
};

export default MaterialVerification;
```

（真接分支挂 SDK 的那段 `useEffect` 从 `DepositVerification.tsx` 原样搬过来，含它的 token 刷新回调 —— 那段有注释说明为什么必须重新打会话接口拿新 token 而不是复用旧的。）

- [ ] **Step 2: 换路由**

路由文件里删这四条旧路由与其 import：`/deposit/:depositNo/verification/:seq`、`/withdraw/:withdrawNo/verification/:seq`、`/verification`、`/pending-verification`（确切路径以文件里实际写的为准），加一条：

```tsx
        <Route path="/verification/:requestNo" element={<MaterialVerification />} />
```

```bash
git rm client-web/src/pages/DepositVerification.tsx client-web/src/pages/WithdrawVerification.tsx client-web/src/pages/Verification.tsx client-web/src/pages/PendingVerification.tsx
```

⚠️ 记忆坑：路由匹配用 `startsWith('/verification')` 会误匹配别的以此开头的路径。若守卫里要判断当前是不是认证页，用**段边界**匹配（`/^\/verification\//`），别用 `startsWith`。

- [ ] **Step 3: 横幅接线**

`PendingActionBanner.tsx` 数据源从旧的客户级 pending-action 端点改成 `GET /client/me/material-requests`，按 G6 过滤并分两档：

```tsx
  const [rows, setRows] = useState<ClientMaterialRequestRow[]>([]);
  // ...fetch /client/me/material-requests

  // G6：客户级横幅 = 活行里「挂了限制的」∪「没绑单的」。
  // 绑了单又没挂限制的只在订单页露，不在这儿重复。
  const visible = rows.filter((r) => r.blocking || r.orderDomain === null);
```

每条渲染成一个条目，`blocking` 决定配色（红 / 黄），CTA 指 `/verification/${r.requestNo}?from=${encodeURIComponent(location.pathname)}`；`status === 'SUBMITTED'` 的不给 CTA、文案换成「审核中」。

三个订单详情页的材料入口过滤条件是「`orderRef === 本单号` 且本单非终态」，CTA 同样指新路由。

- [ ] **Step 4: 类型检查 + client 测试**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js/client-web && npx tsc --noEmit -p tsconfig.app.json && npm test
```

⚠️ client-web 的测试跑 `npm test --prefix client-web`（vitest）。**不要**用根 jest —— 根 jest 会把 client-web 的 vitest spec 捡起来报 `Vitest cannot be imported in a CommonJS module`，那是既有现象（BACKLOG 已记），不是你引入的。

- [ ] **Step 5: 渲染截图验收**

起栈，用 `demo_bob@example.com / 123456` 登客户端，逐一截图：
1. 有一条「不绑单不挂限制」的行 → 横幅**黄**档，带「Verify now」
2. 有一条「挂了限制」的行 → 横幅**红**档
3. 有一条「绑单不挂限制」的行 → 横幅上**看不到**，只在该订单详情页出现
4. 点 CTA 进 `/verification/:requestNo`，点提交 → 页面变「审核中」，横幅该条 CTA 消失
5. 制裁客户（`demo_carol@example.com`）登进去：横幅、Profile、订单页**一处都没有**材料入口

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add -A client-web && git commit -m "feat(client): 四个认证页收成一个 /verification/:requestNo

DepositVerification / WithdrawVerification / Verification / PendingVerification
四个页面干的是同一件事，合并成一个按 requestNo 定位的页面。旧页修过的两个坑
一并抄过来：提交前检查 r.ok（否则后端 404 时静默跳走）、demo 分支要有加载态。

横幅按 G6 过滤并分两档：挂了限制的红、只是提醒的黄；绑了单又没挂限制的不在
横幅露（订单页管它）。"
```

---

### Task 15: 种子 + e2e 六用例 + 五道硬闸 + 文档同步

**Files:**
- Modify: `prisma/seed.business.ts` — 播两条演示用材料请求
- Create: `test/material-requests.e2e-spec.ts`
- Modify: `doc-final/reference/truth/` 下相关文档、`doc-final/BACKLOG.md`、`doc-final/glossary/`

**Interfaces:**
- Consumes: 全部前序任务
- Produces: 无（收尾任务）

- [ ] **Step 1: 种子播两条**

`prisma/seed.business.ts`，照抄上一轮 `seedCustomerRestriction()` 的写法加一个 `seedMaterialRequest()`，给两个 demo 客户各播一条：

- **Ivy**（已有 `MATERIAL_EXPIRED` 便签）：一条**挂限制**的 `PROOF_OF_ADDRESS` 行，`origin='SYSTEM_SCHEDULED'`，`restrictionNo` 指向她那张便签 —— 演红档
- **Bob**：一条**不绑单不挂限制**的 `EMIRATES_ID` 行，`origin='SYSTEM_SCHEDULED'` —— 演黄档提醒

编号用 `buildDeterministicNo('MRQ', email + ':' + materialType)`，reset 重铺后号不变。`externalActionId` 同法派生，`applicantActionId` 写 `mock-action-<派生值>`。

- [ ] **Step 2: 写 e2e 六用例**

新建 `test/material-requests.e2e-spec.ts`。**顶部照抄 `test/customer-restrictions.e2e-spec.ts` 的破坏性护栏**：

```ts
// ── 破坏性护栏（必须在任何读 DATABASE_URL 的 import 之前）──
import { resolveE2eDatabaseUrl } from './e2e-db';
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-material-requests.db');
```

六条用例逐条对应设计稿 §10：

```ts
it('① 同一客户「不绑单无限制的提醒」与「绑单挂限制的补料」两行并存，互不覆盖', ...)
// 直接反证 spec §1.3① 那个单指针病：旧模型第二条会把第一条盖掉

it('② 挂限制的充值单走到 RETURNED：订单页查不到、客户级仍在、行未作废且已解绑', ...)
// 断言 listLiveByOrder('DEPOSIT', no) 为空、listLiveByCustomer 仍含该行、
// 该行 status 仍是活的、orderDomain/orderRef 双双为 null

it('③ 不挂限制的充值单走到 RETURNED：该行 CANCELLED，两端都查不到', ...)

it('④ 同一行从无限制到补挂限制：requestNo 与 externalActionId 全程逐字不变', ...)
// 取补挂前后两次快照比对这两个字段

it('⑤ Approve 撕便签、两种 Reject 都不撕', ...)
// GREEN → 便签 RELEASED 且 releaseMode='AUTO' 且无审批案；
// RED+RETRY → 便签仍 OPEN、行退回 PENDING_SUBMISSION、externalActionId 不变；
// RED+FINAL → 便签仍 OPEN、行 REJECTED

it('⑥ 客户面响应体里搜不到 applicantActionId 字面值（G5 / spec I2）', ...)
// 打 GET /client/me/material-requests 与 .../session，把响应 JSON.stringify
// 后断言不含该行真实的 applicantActionId 值
```

⚠️ 三个 `@OnEvent` 都是 `{ async: true }`（裁决回调、订单终态作废、限制撕）。emit 立即返回、handler detached 跑完 —— **直接断言等于跟事件循环赛跑**。照抄 `customer-restrictions.e2e-spec.ts` 里的 `waitUntil()` 轮询助手。

- [ ] **Step 3: 给 e2e 专用库做 provision**

⚠️ 专用库不会自己建 —— 上一轮忘了这步，7 个用例全挂在 `TB account not found` 上：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
STACK_DB=$(grep '^DATABASE_URL=' .env | sed 's|^DATABASE_URL=file:||' | tr -d '"')
E2E_DB="file:$(dirname "$STACK_DB")/e2e-material-requests.db"
export DATABASE_URL="$E2E_DB" \
       TB_ADDRESS="$(grep '^TB_ADDRESS=' .env | cut -d= -f2)" \
       TB_DATA_FILE="$(grep '^TB_DATA_FILE=' .env | cut -d= -f2)"
npx prisma migrate deploy && npm run db:base:sync && npm run db:biz:init
```

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && npx jest --config test/jest-e2e.json test/material-requests.e2e-spec.ts
```

期望：`Tests: 6 passed`。

- [ ] **Step 4: 五道硬闸**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
echo "闸①"; npx tsc --noEmit && echo "  tsc 0"
echo "闸②"; npx jest 2>&1 | tail -4
echo "闸③"; npm run test:e2e 2>&1 | tail -4
```

闸②期望：除 3 个既有失败（`wallets.service.spec` / `system-wallet.util.spec` / `client-web/restrictedCapabilities.spec`）外全绿，**净新 0**。
闸③期望：七支 e2e 各自单跑通过。若并行跑时有支飘红，先单跑确认 —— 那几支 money-arc suite 共用常驻栈库、互相污染，是 BACKLOG:19/23/110 记过的既有毛病，**不是本轮引入的**。

闸④⑤必须在**干净账本**上跑（money-arc e2e 会把栈库搞脏，BACKLOG:19）：

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js
bash scripts/stack.sh down
rm -f "$(grep '^DATABASE_URL=' .env | sed 's|^DATABASE_URL=file:||' | tr -d '"')" "$(grep '^TB_DATA_FILE=' .env | cut -d= -f2)"
bash scripts/stack.sh up
bash scripts/on-stack.sh self db:base:sync && bash scripts/on-stack.sh self db:biz:init
echo "闸④"; bash scripts/on-stack.sh self demo:all 2>&1 | tail -4
echo "闸⑤"; bash scripts/on-stack.sh self verify:coa 2>&1 | tail -3
```

期望：`asserts: 8/8 PASS`；`ALL INVARIANTS PASS`。

- [ ] **Step 5: 文档同步**

- `doc-final/reference/truth/` 下与充值/提现/兑换/客户合规相关的文档：把「applicant action 存在各域子表 / 客户级三列」改成「统一在 `material_requests`」，并写明 RED 分 RETRY/FINAL
- `doc-final/glossary/`：加「材料请求账」词条 —— 一行 = 一次下发；与限制账配对（限制账记「摁住了什么」，材料账记「交什么才能松开」）
- `doc-final/BACKLOG.md` 登记设计稿 §9 剩下的两条：
  - Q2：`config/material-refresh-policy.json` 里 5 个 level 名与 Sumsub 租户实际配置需在真接前核对；`PASSPORT` 出现在 `ProfileBannerService.formatMaterialName()` 却不在注册表中
  - Q3：被 `REJECTED` 的行，其便签长期挂着无人清理，靠运营再下发或手工撕，无 SLA 提醒

- [ ] **Step 6: Commit**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/Exchange_js && git add -A && git commit -m "test(material-requests): 六用例 e2e + 种子 + 文档同步

六条对应设计稿 §10：多行并存不覆盖（直接反证单指针病）/ 挂限制单终态后解绑
留客户级 / 不挂限制单终态后作废 / 补挂限制时 requestNo 与 externalActionId
不变 / Approve 撕便签而两种 Reject 都不撕 / 客户面搜不到 applicantActionId。

三个 @OnEvent 都是 async detached，断言一律走 waitUntil 轮询。
e2e 专用库先 migrate deploy + db:base:sync + db:biz:init，别再让它挂在
TB account not found 上。

五道硬闸全绿，闸④⑤在干净账本上跑（money-arc e2e 会把栈库搞脏，BACKLOG:19）。"
```

---

## 执行顺序与依赖

```
Task 1  建表 + 状态机常量          （根）
  └─ Task 2  实体守卫 service
       └─ Task 3  下发编排 + 修 external id 坑
            ├─ Task 4  裁决编排 + webhook 路由
            │    └─ Task 10 兑换域（要 review service 的回调点）
            ├─ Task 5  订单终态作废 listener
            ├─ Task 6  后台端点        ─┐
            ├─ Task 7  客户端端点      ─┼─ Task 13 admin 前端
            ├─ Task 8  充值域            │   Task 14 client 前端
            ├─ Task 9  提现域            │
            └─ Task 11 材料重检 + 横幅 ─┘
                 └─ Task 12 统一删旧结构（必须在 8/9/10/11 全部完成之后）
                      └─ Task 15 种子 + e2e + 五闸 + 文档
```

Task 4-11 之间除「10 依赖 4」外相互独立，可按任意顺序做。**Task 12 必须最后于 8/9/10/11**，否则会删掉还在被读的结构。
