# 第一幕系统属性收口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把第一幕「开业」四条塌掉的系统属性补上——审批超时门真的会响（⑥）、后半场的操作留痕进审计合同且码不再撞车（①）、管理台不再拿 UUID 当对外识别（⑨）、资产状态改走显式迁移表（⑦）——最后由一条行为校验器和一次端到端走查证明它们是真的（⑪⑩）。

**Architecture:** 五段顺序推进，每段独立可回滚。⑥ 只缺一个 @Cron 调用方与一个 ⚡ 模拟入口，机器早已建好；① 走三域用过的「换新名册」老路（新码进合同 + 旧码进退役拒写名册），进合同即由 `assertActionSpec` 在写入时强制，不需要额外校验器；⑨⑦ 是局部替换；⑪ 新增 `verify:act1` 行为校验器，判据一律真登录真 HTTP，禁止扫源码文本。

**Tech Stack:** NestJS + `@nestjs/schedule`（@Cron）+ Prisma/SQLite ｜ React 管理台 ｜ ts-node 校验脚本

## Global Constraints

- **本任务做**：⑥ 审批超时 cron + ⚡ 模拟入口 ｜ ① 第一幕后半 45 个审计槽位换新名册并进合同 ｜ ⑨ 5 处 UUID 路由改业务号 ｜ ⑦ 资产显式迁移表 ｜ ⑪ `verify:act1` 行为判据 ｜ ⑩ 端到端走查 + 文档同步
- **本任务不做**（对照 CLAUDE.md §2）：不做幂等、不做去重、不做重试回放、不做补偿 repair、不做并发锁、**不为旧审计行写任何兼容层或 backfill**（审计只增不改，历史行保持原样；新写入按新合同）、不加固管理 API 权限、不做性能优化、不为让测试通过而改测试框架
- **超时 cron 不是「重试回放」**：它是业务规则——审批单会过期。`expirePendingApprovalCase()` 早已实现（含审计、事件、状态机），本轮只补触发器
- 审计词表遵守封册守则：**新码出生即定死四件事**（domain / correlationMode / requiredFields / requiresCausation），旧码一律进 `DEPRECATED_AUDIT_ACTIONS` 退役拒写，不许悄悄删
- **本轮明确不碰的属性**：⑤ 权限分组（2026-08-31 上一轮刚重建，`verify:rbac` 75 判据在守）｜ ⑧ 钱动过账（第一幕几乎不动钱，唯一相关的是 BACKLOG「资本注入流水缺 evidence 行」，那是种子数据问题、与本轮四条属性无耦合，**留在 BACKLOG 不进本轮**）｜ ②③④ 流程可用/代码清晰/前端完好（**grep 判不了，只能靠走查取证**，故不设修复任务，由 Task 12 Step 2 负责撞出来并分流登记）
- 闸门每个 Task 收尾必跑：`npx tsc --noEmit -p tsconfig.json`、`npx tsc --noEmit -p tsconfig.test.json`、`cd admin-web && npx tsc -b --noEmit`、`cd client-web && npx tsc -b --noEmit`，加本任务相关 jest，判据 = 全绿
- 测试的绿必须来自行为；**禁止写「扫源码文本」型断言**（本仓库已因此栽过六次）
- worktree 内一律用 `bash scripts/on-stack.sh self <script>`，绝不裸跑 npm 脚本（会写到 main 的账本）

---

## 事实底稿（本计划所依据的实测，写计划时逐条在 HEAD=80e5ba29 上验过）

| 事实 | 证据位置 |
|---|---|
| `expirePendingApprovals()` 已完整实现，**零调用方** | `src/modules/governance/approvals/approvals.service.ts:1101`；唯一另一处提及是 `admin-invite-workflow.service.ts:408` 的注释 |
| `expirePendingApprovalCase()` 已写审计、已发事件，`sourcePlatform` 就填着 `'CRON'` | 同文件 `:1043-1099` |
| `APPROVAL_EXPIRED` **已在合同内** | `audit-actions.constant.ts:647` |
| `timeoutAt` 提交时即算好写入 | `approvals.service.ts:607`（`now + policy.timeoutHours*3600*1000`）、`:628` |
| 30 个审批子流程都已挂 `@OnEvent(EXPIRED)` | `approval-handler.base.ts:81` |
| `DEMO_CLOCK_WRITE` 现有 4 个 ⚡ 端点，**没有审批超时那个** | `rbac.catalog.ts:256/292/319/345` |
| `assertActionSpec` 对不在合同的码 **静默放行** | `audit-logs.service.ts:896` `if (!spec) return;` |
| 第一幕后半 **45 个裸词槽位 → 只有 31 个不同码值，7 个码被 3 族共用** | 见下方撞车表 |
| `ApprovalCase` 有 `approvalNo @unique`、`Wallet` 有 `walletNo @unique`——业务号存在但前端用 `id` | `schema.prisma`；`ApprovalsPage.tsx:306`、`CustodianWalletList.tsx:307` |
| 资产状态无迁移表，靠散落 `if` 守 | `assets.service.ts:155-162`（activate）、`:120-127`（reactivate） |

**撞车表（同一字符串被三个族写入，审计页按 action 筛时分不开）**

```
CHANGE_REQUESTED       ← TRANSACTION_LIMIT_CHANGE / WITHDRAWAL_FEE_LEVEL_CHANGE / SWAP_FEE_LEVEL_CHANGE
CHANGE_APPLIED         ← 同上三族
CHANGE_CANCELLED       ← 同上三族
CREATION_REQUESTED     ← TRANSACTION_LIMIT_CREATION / WITHDRAWAL_FEE_LEVEL_CREATION / SWAP_FEE_LEVEL_CREATION
CREATION_APPLIED       ← 同上三族
CREATION_APPLY_FAILED  ← 同上三族
CREATION_CANCELLED     ← 同上三族
```

---

## File Structure

**新建**
- `src/modules/governance/approvals/approval-expiry.service.ts` —— @Cron 扫描器（唯一职责：定时叫 `expirePendingApprovals()`）
- `src/modules/asset-treasury/assets/constants/asset-transitions.constant.ts` —— 资产状态迁移表
- `scripts/verify-act1.ts` —— 第一幕行为校验器（⑥⑦⑨）
- `test/approval-expiry.e2e-spec.ts` —— 超时门端到端

**修改**
- `src/modules/governance/approvals/approvals.module.ts` —— 注册新 service
- `src/modules/governance/approvals/approvals.controller.ts` —— ⚡ 模拟端点
- `src/modules/governance/approvals/approvals.service.ts` —— `simulateTimeoutByNo()`；`:id` 改 `:approvalNo` 查找
- `src/modules/audit-logging/constants/audit-actions.constant.ts` —— 31 个新码进 6 张合同表、45 个旧槽位进退役名册、`AuditGovernanceActions` 清空
- 13 个族的 55 处调用点（分四批，见 Task 3–6）
- `src/modules/identity/access-control/rbac.catalog.ts` —— 新 ⚡ 路由登记 + `:id`→`:approvalNo` 路由改写
- `src/modules/asset-treasury/assets/assets.service.ts` —— 改走迁移表
- `admin-web/src/App.tsx` + 4 个页面 —— UUID 路由改业务号
- `package.json` —— `verify:act1` 脚本
- 文档：`doc-final/demo/script.md`、`modules/v1-governance.md`、`modules/v3-financial-config.md`、`demo/baseline.md`、`CHANGELOG.md`、`BACKLOG.md`

---

# Phase 1 · ⑥ 超时门（把画上去的门变成真门）

## Task 1：审批超时扫描器接上 @Cron

**Files:**
- Create: `src/modules/governance/approvals/approval-expiry.service.ts`
- Modify: `src/modules/governance/approvals/approvals.module.ts`
- Test: `test/approval-expiry.e2e-spec.ts`

**Interfaces:**
- Consumes: `ApprovalsService.expirePendingApprovals(): Promise<{ expiredCount: number; expiredIds: string[] }>`（`approvals.service.ts:1101`，已存在，不要改它）
- Produces: `ApprovalExpiryService.sweep(): Promise<void>`（供测试直接调用，不等真实时钟）；`ApprovalExpiryService.handleCron()`（@Cron 包装层）

- [ ] **Step 1: 写失败的 e2e 测试**

新建 `test/approval-expiry.e2e-spec.ts`：

```typescript
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { ApprovalExpiryService } from '../src/modules/governance/approvals/approval-expiry.service';
import { ApprovalStatuses } from '../src/modules/governance/approvals/constants/approval.constants';

describe('审批超时门（⑥ 门不可绕）', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let expiry: ApprovalExpiryService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    expiry = app.get(ApprovalExpiryService);
  });

  afterAll(async () => { await app.close(); });

  it('timeoutAt 已过的 PENDING 单，扫一轮后变 EXPIRED', async () => {
    // 直接建一张过期的 PENDING 单——这里测的是扫描器认不认过期时间，
    // 不是审批提交流程（那条线由 Task 2 的行为判据覆盖）。
    const created = await prisma.approvalCase.create({
      data: {
        approvalNo: `APR-EXPIRY-TEST-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE',
        entityRef: 'TEST-ENTITY',
        createdByUserId: 'test-user',
        status: ApprovalStatuses.PENDING,
        traceId: `trace-expiry-${Date.now()}`,
        timeoutAt: new Date(Date.now() - 60_000),
      },
    });

    await expiry.sweep();

    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe(ApprovalStatuses.EXPIRED);
  });

  it('timeoutAt 还没到的 PENDING 单，扫描器不碰它', async () => {
    const created = await prisma.approvalCase.create({
      data: {
        approvalNo: `APR-FUTURE-TEST-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE',
        entityRef: 'TEST-ENTITY-2',
        createdByUserId: 'test-user',
        status: ApprovalStatuses.PENDING,
        traceId: `trace-future-${Date.now()}`,
        timeoutAt: new Date(Date.now() + 3_600_000),
      },
    });

    await expiry.sweep();

    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe(ApprovalStatuses.PENDING);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts
```

预期：FAIL，报 `Nest could not find ApprovalExpiryService element`（服务还不存在）

- [ ] **Step 3: 写扫描器**

新建 `src/modules/governance/approvals/approval-expiry.service.ts`：

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ApprovalsService } from './approvals.service';

/**
 * 审批超时扫描（2026-09-01 补）。
 *
 * `expirePendingApprovals()` 与 `expirePendingApprovalCase()` 自建成起就是完整的
 * ——含状态机、审计（APPROVAL_EXPIRED，sourcePlatform 就写着 'CRON'）、
 * ApprovalEvents.EXPIRED 事件——**唯独没有人定时叫它**，于是每条审批策略上的
 * `timeoutHours: 48` 一直是纯展示字段：48 小时到点什么都不会发生。
 *
 * 这不是「重试/回放」类兜底（那是禁做清单里的），是业务规则本身：单子会过期。
 *
 * 周期取 */1，与三域 SLA 扫描一致——演示体感的下限，观众按下 ⚡ 后最多等一分钟。
 */
@Injectable()
export class ApprovalExpiryService {
  private readonly logger = new Logger(ApprovalExpiryService.name);

  constructor(private readonly approvalsService: ApprovalsService) {}

  @Cron('*/1 * * * *', { timeZone: 'Asia/Dubai' })
  async handleCron(): Promise<void> {
    await this.sweep();
  }

  // 与 @Cron 包装层分开，测试可直接调用、不等真实时钟。
  async sweep(): Promise<void> {
    try {
      const { expiredCount } = await this.approvalsService.expirePendingApprovals();
      if (expiredCount > 0) {
        this.logger.log(`approval expiry sweep: ${expiredCount} case(s) expired`);
      }
    } catch (err) {
      this.logger.error(
        `approval expiry sweep failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
```

- [ ] **Step 4: 在模块里注册**

`src/modules/governance/approvals/approvals.module.ts` —— import 并加进 `providers`：

```typescript
import { ApprovalExpiryService } from './approval-expiry.service';
// ...
  providers: [
    // ...既有 providers 原样保留...
    ApprovalExpiryService,
  ],
```

- [ ] **Step 5: 跑测试确认通过**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts
```

预期：2 passed

- [ ] **Step 6: 跑四道 tsc**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)
```

预期：全部无输出（exit 0）

- [ ] **Step 7: 提交**

```bash
git add src/modules/governance/approvals/approval-expiry.service.ts src/modules/governance/approvals/approvals.module.ts test/approval-expiry.e2e-spec.ts
git commit -m "feat(approvals): 超时门接上 @Cron——timeoutHours 从展示字段变成真会响的门"
```

---

## Task 2：⚡ 让审批单当场过期（48 小时演不了）

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`（新增方法，追加在文件末尾 `expirePendingApprovals()` 之后）
- Modify: `src/modules/governance/approvals/approvals.controller.ts`
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`
- Test: `test/approval-expiry.e2e-spec.ts`（追加一个 it）

**Interfaces:**
- Consumes: Task 1 的 `ApprovalExpiryService.sweep()`
- Produces: `ApprovalsService.simulateTimeoutByNo(approvalNo: string): Promise<{ approvalNo: string; timeoutAt: Date }>`；HTTP `POST /admin/control-gates/approvals/:approvalNo/simulate-timeout`

- [ ] **Step 1: 追加失败的测试**

在 `test/approval-expiry.e2e-spec.ts` 里追加：

```typescript
  it('⚡ 把 timeoutAt 拨到过去后，下一轮扫描该单即过期', async () => {
    const approvalsService = app.get(ApprovalsService);
    const created = await prisma.approvalCase.create({
      data: {
        approvalNo: `APR-SIM-TEST-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE',
        entityRef: 'TEST-ENTITY-3',
        createdByUserId: 'test-user',
        status: ApprovalStatuses.PENDING,
        traceId: `trace-sim-${Date.now()}`,
        timeoutAt: new Date(Date.now() + 48 * 3_600_000),
      },
    });

    await approvalsService.simulateTimeoutByNo(created.approvalNo);
    await expiry.sweep();

    const after = await prisma.approvalCase.findUniqueOrThrow({ where: { id: created.id } });
    expect(after.status).toBe(ApprovalStatuses.EXPIRED);
  });
```

文件顶部补 import：

```typescript
import { ApprovalsService } from '../src/modules/governance/approvals/approvals.service';
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts -t "拨到过去"
```

预期：FAIL，`approvalsService.simulateTimeoutByNo is not a function`

- [ ] **Step 3: 写 service 方法**

在 `src/modules/governance/approvals/approvals.service.ts` 的 `expirePendingApprovals()` 之后追加：

```typescript
  /**
   * 演示用：把该单的超时时间拨到过去，下一轮 @Cron 扫描即过期。
   * 与三域 SLA 的 simulate-sla-timeout 同款——演示不可能等 48 小时。
   * 只动时间、不直接改状态：过期这条边必须由扫描器走，否则演的就不是真门。
   */
  async simulateTimeoutByNo(approvalNo: string) {
    const approval = await this.prisma.approvalCase.findUnique({ where: { approvalNo } });
    if (!approval) {
      throw new NotFoundException(`Approval ${approvalNo} not found`);
    }
    if (approval.status !== ApprovalStatuses.PENDING) {
      throw new BadRequestException(
        `Approval ${approvalNo} is ${approval.status}, only PENDING can be fast-forwarded`,
      );
    }
    const timeoutAt = new Date(Date.now() - 1000);
    await this.prisma.approvalCase.update({ where: { id: approval.id }, data: { timeoutAt } });
    return { approvalNo, timeoutAt };
  }
```

（`NotFoundException` / `BadRequestException` 该文件已 import，无需再加。）

- [ ] **Step 4: 加 controller 端点**

在 `src/modules/governance/approvals/approvals.controller.ts` 里，紧挨现有 `:id/cancel` 端点之后追加：

```typescript
  @Post(':approvalNo/simulate-timeout')
  @ApiOperation({ summary: '演示用：把该审批单的超时时间拨到过去，下轮扫描即过期' })
  @RequirePermissions(
    buildPermissionCode('POST', '/admin/control-gates/approvals/:approvalNo/simulate-timeout'),
  )
  simulateTimeout(@Param('approvalNo') approvalNo: string) {
    return this.approvalsService.simulateTimeoutByNo(approvalNo);
  }
```

⚠️ 照抄该文件既有端点的装饰器写法（`@RequirePermissions` 与 `buildPermissionCode` 的具体 import 名以文件现状为准，不要凭本计划想当然）。

- [ ] **Step 5: 登记 RBAC 路由**

`src/modules/identity/access-control/rbac.catalog.ts` —— 在 `:id/cancel`（约 `:438`）之后加一行：

```typescript
  route('POST', '/admin/control-gates/approvals/:approvalNo/simulate-timeout', 'Fast-forward approval timeout (demo only)', ['DEMO_CLOCK_WRITE']),
```

⚠️ 加完必须 `db:base:sync` **并重启后端**——SUPER_ADMIN 走内存定义，只 seed 不重启等于白做（本仓库已栽过）。

- [ ] **Step 6: 管理台加 ⚡ 按钮**

`admin-web/src/pages/ApprovalDetailPage.tsx` —— 在现有 Cancel 按钮旁（约 `:542-548` 那组动作按钮里）加：

```tsx
{detail?.status === 'PENDING' && (
  <Button
    onClick={async () => {
      await api.post(`/admin/control-gates/approvals/${detail.approvalNo}/simulate-timeout`);
      message.success('已把超时时间拨到过去，一分钟内该单将自动过期');
      void reload();
    }}
  >
    ⚡ 模拟超时
  </Button>
)}
```

⚠️ `Button` / `message` / `api` / `reload` 的具体名字照该文件现状，别新引入组件库。

- [ ] **Step 7: 跑测试与四道 tsc**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)
```

预期：3 passed；tsc 全绿

- [ ] **Step 8: 起 preview 截图验证（改了前端，tsc 不算数）**

起栈、登 `sm@fiatx.com`/`123456`、提一张审批单、进详情页点 ⚡ 模拟超时、等一分钟刷新看状态变 EXPIRED，截图存证。

- [ ] **Step 9: 提交**

```bash
git add src/modules/governance/approvals/ src/modules/identity/access-control/rbac.catalog.ts admin-web/src/pages/ApprovalDetailPage.tsx test/approval-expiry.e2e-spec.ts
git commit -m "feat(approvals): ⚡ 模拟超时入口——48 小时的门在演示里一分钟看得到"
```

---

# Phase 2 · ① 第一幕后半换新名册（45 槽位 / 31 码 / 55 调用点）

> **四批的共同规矩**（每批照做，不再重抄）：
> 1. 新码全部**前缀优先、全局唯一**，进 `V1_AUDIT_ACTIONS`，`domain: 'CONFIG'`
> 2. `*_REQUESTED` = `S`(START，开旅程)；其余 = `I`(INHERIT，续旅程)
> 3. `*_APPLIED` / `*_CREATED` 类由审批事件异步驱动 → `requiresCausation: true`，必填含 `approvalNo`
> 4. `*_CANCELLED` 必填 `reason`；`*_FAILED` 走非成功分支，由 `assertActionSpec` 自动强制 `reasonCode`，`requiredFields` 留空
> 5. 45 个旧槽位的**字符串值**全部追加进 `DEPRECATED_AUDIT_ACTIONS`（退役拒写），族本身从 `AuditGovernanceActions` 删除
> 6. **不写任何兼容层**：历史审计行保持原样（只增不改），新写入按新码

## Task 3：费率两域四族换名册（18 处调用）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: 四族的 18 处调用点，用 `grep -rn "AuditGovernanceActions.SWAP_FEE_LEVEL_\|AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_" src --include='*.ts' | grep -v spec` 逐一定位
- Test: `src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`

**Interfaces:**
- Produces: 16 个新码（见下），后续 Task 7 的封册断言依赖它们全部在册

- [ ] **Step 1: 在 `V1_AUDIT_ACTIONS` 里加 16 条新码**

在 `APPROVAL_POLICY_CHANGE_APPLIED` 那段之后追加：

```typescript
  // ── ⑫ 兑换费率等级（2026-09-01 第一幕后半换名册）──────────
  SWAP_FEE_LEVEL_CREATION_REQUESTED:     { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_CREATION_APPLIED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_CREATION_APPLY_FAILED:  { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  SWAP_FEE_LEVEL_CREATION_CANCELLED:     { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_REQUESTED:       { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  SWAP_FEE_LEVEL_CHANGE_APPLIED:         { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_APPLY_FAILED:    { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  SWAP_FEE_LEVEL_CHANGE_CANCELLED:       { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ⑬ 提现费率等级 ────────────────────────────────────
  WITHDRAWAL_FEE_LEVEL_CREATION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_CREATION_APPLIED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CREATION_APPLY_FAILED: { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CREATION_CANCELLED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_REQUESTED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  WITHDRAWAL_FEE_LEVEL_CHANGE_APPLIED:        { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_APPLY_FAILED:   { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  WITHDRAWAL_FEE_LEVEL_CHANGE_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
```

- [ ] **Step 2: 改 18 处调用点**

先列出全部调用点：

```bash
cd Exchange_js && grep -rn "AuditGovernanceActions.SWAP_FEE_LEVEL_\|AuditGovernanceActions.WITHDRAWAL_FEE_LEVEL_" src --include='*.ts' | grep -v spec
```

逐处把 `AuditGovernanceActions.SWAP_FEE_LEVEL_CHANGE.CHANGE_REQUESTED` 改成字面量 `'SWAP_FEE_LEVEL_CHANGE_REQUESTED'`（其余同理，按上表一一对应），并**当场确认该调用传了新合同要求的字段**：
- `*_REQUESTED` 要有 `afterData`（CHANGE 还要 `beforeData`）
- `*_APPLIED` 要有 `approvalNo` + `causationId`
- `*_CANCELLED` 要有 `reason` + `causationId`
- `*_APPLY_FAILED` 要有 `outcome: AuditOutcome.FAILED` + `reasonCode`

缺哪个就在调用处补上——**这正是进合同的意义**：以前缺了没人管，现在缺了会当场抛。

- [ ] **Step 3: 旧码进退役名册、族从 `AuditGovernanceActions` 删除**

在 `DEPRECATED_AUDIT_ACTIONS` 数组末尾追加（注意：这 7 个字符串是三族共用的，只加一次）：

```typescript
  // 2026-09-01 第一幕后半换名册 —— 裸名且跨族撞车，前缀化后退役
  'CREATION_REQUESTED', 'CREATION_APPLIED', 'CREATION_APPLY_FAILED', 'CREATION_CANCELLED',
  'CHANGE_REQUESTED', 'CHANGE_APPLIED', 'CHANGE_APPLY_FAILED', 'CHANGE_CANCELLED',
```

删除 `AuditGovernanceActions` 里的 `SWAP_FEE_LEVEL_CREATION` / `SWAP_FEE_LEVEL_CHANGE` / `WITHDRAWAL_FEE_LEVEL_CREATION` / `WITHDRAWAL_FEE_LEVEL_CHANGE` 四个族。

⚠️ `TRANSACTION_LIMIT_CREATION` / `TRANSACTION_LIMIT_CHANGE` 两族**留到 Task 5 再删**（它们也用这 8 个字符串，Task 3 删了退役名册它们就写不进去了）。所以：**Task 3 先只加退役名册里的字符串，两个 limit 族的调用点必须在 Task 5 之前保持能跑**——如果 Task 3 加完退役名册导致 limit 族当场抛，就把这 8 个字符串的退役登记挪到 Task 5 末尾一次性做。执行者按实际跑出来的结果决定，并在 commit message 里写明选了哪条。

- [ ] **Step 4: 跑闸门**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json
bash scripts/on-stack.sh self jest -- src/modules/audit-logging
bash scripts/on-stack.sh self verify:audit
```

预期：tsc 全绿；jest 全绿；`verify:audit` 全绿

- [ ] **Step 5: 提交**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/trading src/modules/asset-treasury
git commit -m "refactor(audit): 费率两域换新名册——16 个前缀唯一码进合同，解掉 CHANGE_REQUESTED 三族撞车"
```

---

## Task 4：资产四族换名册（12 处调用）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: 12 处调用点，`grep -rn "AuditGovernanceActions.ASSET_" src --include='*.ts' | grep -v spec`
- Test: 同上

**Interfaces:**
- Produces: 12 个新码

- [ ] **Step 1: 加 12 条新码**

```typescript
  // ── ⑭ 资产上架 / 停复牌 ────────────────────────────────
  ASSET_CREATED_AND_PROVISIONED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  ASSET_CREATION_FAILED:         { domain: 'CONFIG', correlationMode: S, requiredFields: [], requiresCausation: false },
  ASSET_PROVISIONING_UPDATED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData'], requiresCausation: false },
  ASSET_ACTIVATION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_ACTIVATED:               { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_ACTIVATION_FAILED:       { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  ASSET_SUSPENSION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_SUSPENDED:               { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_SUSPENSION_FAILED:       { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  ASSET_REACTIVATION_REQUESTED:  { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData'], requiresCausation: false },
  ASSET_REACTIVATED:             { domain: 'CONFIG', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  ASSET_REACTIVATION_FAILED:     { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
```

（`ASSET_CREATED_AND_PROVISIONED` / `ASSET_CREATION_FAILED` / `ASSET_PROVISIONING_UPDATED` / `ASSET_SUSPENDED` / `ASSET_REACTIVATED` / `ASSET_ACTIVATED` 六个码值本来就前缀唯一，**码值不变、只是进合同**，调用点只需确认字段齐；另外六个是裸名，要改。）

- [ ] **Step 2: 改 12 处调用点，字段补齐**

裸名 → 新名对照：
- `SUSPENSION_REQUESTED` → `'ASSET_SUSPENSION_REQUESTED'`
- `SUSPENSION_EXECUTION_FAILED` → `'ASSET_SUSPENSION_FAILED'`
- `REACTIVATION_REQUESTED` → `'ASSET_REACTIVATION_REQUESTED'`
- `REACTIVATION_EXECUTION_FAILED` → `'ASSET_REACTIVATION_FAILED'`
- `ACTIVATION_REQUESTED` → `'ASSET_ACTIVATION_REQUESTED'`
- `ACTIVATION_FAILED` → `'ASSET_ACTIVATION_FAILED'`

- [ ] **Step 3: 旧裸名进退役名册、四族删除**

```typescript
  'SUSPENSION_REQUESTED', 'SUSPENSION_EXECUTION_FAILED',
  'REACTIVATION_REQUESTED', 'REACTIVATION_EXECUTION_FAILED',
  'ACTIVATION_REQUESTED', 'ACTIVATION_FAILED',
```

从 `AuditGovernanceActions` 删除 `ASSET_SUSPENSION` / `ASSET_REACTIVATION` / `ASSET_CREATION` / `ASSET_ACTIVATION` 四族。

- [ ] **Step 4: 闸门**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json
bash scripts/on-stack.sh self jest -- src/modules/asset-treasury/assets src/modules/audit-logging
bash scripts/on-stack.sh self verify:audit
```

- [ ] **Step 5: 提交**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/asset-treasury/assets
git commit -m "refactor(audit): 资产四族换新名册——12 码进合同，上架/停复牌留痕有合同"
```

---

## Task 5：限额两族 + 客户标签换名册（11 处调用）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: 11 处调用点，`grep -rn "AuditGovernanceActions.TRANSACTION_LIMIT_\|AuditGovernanceActions.CUSTOMER_TAG" src --include='*.ts' | grep -v spec`

**Interfaces:**
- Produces: 10 个新码；本任务结束后 `AuditGovernanceActions` 里应只剩 `TRANSACTION_LIMIT_REJECTED`（它已在别处有合同，见 Step 3 核对）

- [ ] **Step 1: 加 10 条新码**

```typescript
  // ── ⑮ 交易限额规则 ────────────────────────────────────
  TRANSACTION_LIMIT_CREATION_REQUESTED:    { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  TRANSACTION_LIMIT_CREATION_APPLIED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  TRANSACTION_LIMIT_CREATION_APPLY_FAILED: { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  TRANSACTION_LIMIT_CREATION_CANCELLED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_REQUESTED:      { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  TRANSACTION_LIMIT_CHANGE_APPLIED:        { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_APPLY_FAILED:   { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  TRANSACTION_LIMIT_CHANGE_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ⑯ 客户标签（受众谓词的原料）──────────────────────────
  CUSTOMER_TAG_ASSIGNED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData'], requiresCausation: false },
  CUSTOMER_TAG_REVOKED:  { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'reason'], requiresCausation: false },
```

- [ ] **Step 2: 改 11 处调用点**

`TAG_ASSIGNED` → `'CUSTOMER_TAG_ASSIGNED'`、`TAG_REVOKED` → `'CUSTOMER_TAG_REVOKED'`；两个 limit 族按上表前缀化。

- [ ] **Step 3: 收尾退役名册，清空 `AuditGovernanceActions`**

追加：

```typescript
  'TAG_ASSIGNED', 'TAG_REVOKED',
```

（`CREATION_*` / `CHANGE_*` 那 8 个字符串若 Task 3 已加则不重复；若 Task 3 按其 Step 3 的说明推迟了，在此一次性加。）

删除 `TRANSACTION_LIMIT_CREATION` / `TRANSACTION_LIMIT_CHANGE` / `CUSTOMER_TAG` 三族。

核对 `TRANSACTION_LIMIT_REJECTED` 是否已在某张合同表里；若不在，**当场加进 `V1_AUDIT_ACTIONS`**：

```typescript
  TRANSACTION_LIMIT_REJECTED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },
```

- [ ] **Step 4: 闸门**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json
bash scripts/on-stack.sh self jest -- src/modules/asset-treasury src/modules/audit-logging src/modules/identity
bash scripts/on-stack.sh self verify:audit
```

- [ ] **Step 5: 提交**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/asset-treasury src/modules/identity
git commit -m "refactor(audit): 限额两族+客户标签换新名册——10 码进合同"
```

---

## Task 6：钱包与提现地址两族换名册（14 处调用）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: 14 处调用点，`grep -rn "AuditGovernanceActions.CUSTODIAN_WALLET_CREATE\|AuditGovernanceActions.WITHDRAWAL_ADDRESS_REGISTRATION" src --include='*.ts' | grep -v spec`

**Interfaces:**
- Produces: 10 个新码；本任务结束后 `AuditGovernanceActions` 应彻底空掉

- [ ] **Step 1: 加 10 条新码**

```typescript
  // ── ⑰ 托管钱包创建 ────────────────────────────────────
  CUSTODIAN_WALLET_CREATE_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  CUSTODIAN_WALLET_CREATED:          { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  CUSTODIAN_WALLET_CREATE_FAILED:    { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: true },
  CUSTODIAN_WALLET_CREATE_CANCELLED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ⑱ 客户提现地址登记（24h 冷却闸）────────────────────
  WITHDRAWAL_ADDRESS_REGISTERED:     { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_ACTIVATED:      { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: false },
  WITHDRAWAL_ADDRESS_CANCELLED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_SUSPENDED:      { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_DEACTIVATED:    { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
  WITHDRAWAL_ADDRESS_COOLING_SKIPPED:{ domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },
```

- [ ] **Step 2: 改 14 处调用点**

对照：`CREATE_REQUESTED`→`'CUSTODIAN_WALLET_CREATE_REQUESTED'`、`WALLET_CREATED`→`'CUSTODIAN_WALLET_CREATED'`、`WALLET_CREATE_FAILED`→`'CUSTODIAN_WALLET_CREATE_FAILED'`、`CREATE_CANCELLED`→`'CUSTODIAN_WALLET_CREATE_CANCELLED'`、`ADDRESS_REGISTERED`→`'WITHDRAWAL_ADDRESS_REGISTERED'`、`ADDRESS_ACTIVATED`→`'WITHDRAWAL_ADDRESS_ACTIVATED'`、`ADDRESS_CANCELLED`→`'WITHDRAWAL_ADDRESS_CANCELLED'`、`ADDRESS_SUSPENDED`→`'WITHDRAWAL_ADDRESS_SUSPENDED'`、`ADDRESS_DEACTIVATED`→`'WITHDRAWAL_ADDRESS_DEACTIVATED'`、`MANUAL_COOLING_SKIP`→`'WITHDRAWAL_ADDRESS_COOLING_SKIPPED'`

⚠️ `MANUAL_COOLING_SKIP` 是**后门端点**的留痕（跳过 24h 冷却），必须留 `reason` ——这是演示里要讲清「这是后门」的那条。

- [ ] **Step 3: 退役名册收尾 + 删掉 `AuditGovernanceActions` 本体**

追加退役字符串：

```typescript
  'CREATE_REQUESTED', 'WALLET_CREATED', 'WALLET_CREATE_FAILED', 'CREATE_CANCELLED',
  'ADDRESS_REGISTERED', 'ADDRESS_ACTIVATED', 'ADDRESS_CANCELLED',
  'ADDRESS_SUSPENDED', 'ADDRESS_DEACTIVATED', 'MANUAL_COOLING_SKIP',
```

删除最后两族。若此时 `AuditGovernanceActions` 已空，**整个常量删除**，并清掉全仓 import（`grep -rn "AuditGovernanceActions" src --include='*.ts'` 应为 0）。若还剩 `TRANSACTION_LIMIT_REJECTED` 一条，把它挪进 `AuditActions` 或直接用字面量，然后删除本常量。

- [ ] **Step 4: 闸门**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)
bash scripts/on-stack.sh self jest -- src/modules/asset-treasury src/modules/audit-logging
bash scripts/on-stack.sh self verify:audit
```

- [ ] **Step 5: 提交**

```bash
git add -A src/modules
git commit -m "refactor(audit): 钱包与提现地址换新名册——AuditGovernanceActions 清零，第一幕后半全部进合同"
```

---

## Task 7：封册守则闭环（防复发）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts`

**Interfaces:**
- Consumes: Task 3–6 产出的 31 个新码与退役名册
- Produces: 一条会在有人再引入裸词时当场变红的断言

- [ ] **Step 1: 写会失败的断言（先故意留一个裸词验证它抓得住）**

在 `audit-vocabulary-closure.spec.ts` 追加：

```typescript
  it('审计码必须全局唯一且前缀化——不许再出现跨族撞车的裸名', () => {
    const contracted = [
      ...Object.keys(V1_AUDIT_ACTIONS), ...Object.keys(V4_DEPOSIT_AUDIT_ACTIONS),
      ...Object.keys(V5_WITHDRAW_AUDIT_ACTIONS), ...Object.keys(V6_SWAP_AUDIT_ACTIONS),
      ...Object.keys(V8_RECON_AUDIT_ACTIONS), ...Object.keys(V2_CUSTOMER_AUDIT_ACTIONS),
    ];
    // 全局唯一：合同表之间不许有同名码
    expect(new Set(contracted).size).toBe(contracted.length);

    // 裸名黑名单：这些通用动词不带主体前缀，一律不许再进合同
    const BARE = ['CREATION_REQUESTED', 'CREATION_APPLIED', 'CHANGE_REQUESTED', 'CHANGE_APPLIED',
                  'ACTIVATION_REQUESTED', 'TAG_ASSIGNED', 'CREATE_REQUESTED', 'ADDRESS_REGISTERED'];
    expect(contracted.filter((c) => BARE.includes(c))).toEqual([]);
  });
```

- [ ] **Step 2: 变异验证——证明它真抓得住**

临时把 `'CHANGE_REQUESTED': { domain: 'CONFIG', correlationMode: I, requiredFields: [], requiresCausation: false },` 塞回 `V1_AUDIT_ACTIONS`，跑：

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- audit-vocabulary-closure
```

预期：**FAIL**，报 `expected [] to equal ['CHANGE_REQUESTED']`。确认后把那行删掉再跑一次，预期 PASS。
⚠️ 这一步不能跳——本仓库栽过六次「断言在功能存在前就绿了」的自证型绿灯。

- [ ] **Step 3: 提交**

```bash
git add src/modules/audit-logging/constants/audit-vocabulary-closure.spec.ts
git commit -m "test(audit): 封册守则加「全局唯一 + 禁裸名」两条，变异实证能抓住撞车码"
```

---

# Phase 3 · ⑨ 业务键（管理台不暴露 UUID）

## Task 8：审批单对外识别改 approvalNo

**Files:**
- Modify: `src/modules/governance/approvals/approvals.controller.ts`（4 个端点 `:id` → `:approvalNo`）
- Modify: `src/modules/governance/approvals/approvals.service.ts`（按号查找）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts:436-439`
- Modify: `admin-web/src/App.tsx:329`、`admin-web/src/pages/ApprovalsPage.tsx:306`、`admin-web/src/pages/ApprovalDetailPage.tsx`

**Interfaces:**
- Consumes: Task 2 已建的 `POST /admin/control-gates/approvals/:approvalNo/simulate-timeout`（本任务把其余 4 个端点对齐成同一种键）
- Produces: `ApprovalsService.findCaseByNoOrThrow(approvalNo: string, tx?): Promise<ApprovalCaseRow>`

- [ ] **Step 1: 写行为测试**

在 `test/approval-expiry.e2e-spec.ts` 追加：

```typescript
  it('审批详情端点收业务号；拿 UUID 去打应当 404', async () => {
    const created = await prisma.approvalCase.create({
      data: {
        approvalNo: `APR-KEY-TEST-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE', entityRef: 'E', createdByUserId: 'u',
        status: ApprovalStatuses.PENDING, traceId: `t-${Date.now()}`,
      },
    });
    const token = await loginAs('ciso');   // 该 helper 照 test/ 下既有 e2e 的写法
    const byNo = await request(app.getHttpServer())
      .get(`/admin/control-gates/approvals/${created.approvalNo}`)
      .set('Authorization', `Bearer ${token}`);
    expect(byNo.status).toBe(200);

    const byUuid = await request(app.getHttpServer())
      .get(`/admin/control-gates/approvals/${created.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(byUuid.status).toBe(404);
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts -t "业务号"
```

预期：FAIL（现在 UUID 那条会返回 200）

- [ ] **Step 3: service 加按号查找**

在 `approvals.service.ts` 里，紧挨 `findCaseOrThrow` 之后：

```typescript
  private async findCaseByNoOrThrow(approvalNo: string, tx?: any) {
    const client = tx ?? this.prisma;
    const approval = await client.approvalCase.findUnique({
      where: { approvalNo },
      include: this.approvalInclude(),
    });
    if (!approval) throw new NotFoundException(`Approval ${approvalNo} not found`);
    return approval as ApprovalCaseRow;
  }
```

把 `approve()` / `reject()` / `cancel()` / `getDetail()` 四个公开方法的入参从 `id: string` 改成 `approvalNo: string`，内部改调 `findCaseByNoOrThrow`。

⚠️ **只改这四个对外方法**。`expirePendingApprovalCase(id)` 是内部按 id 走的（扫描器查出来的就是 id），不要动它——外部识别用业务号、内部关联用 id，这两件事本来就该分开。

- [ ] **Step 4: controller 与 RBAC 路由改名**

`approvals.controller.ts` 四处 `@Param('id')` → `@Param('approvalNo')`，路径 `:id` → `:approvalNo`。
`rbac.catalog.ts:436-439` 四行路径同步改成 `:approvalNo`，并跑 `db:base:sync` + **重启后端**。

- [ ] **Step 5: 前端改用业务号**

- `admin-web/src/App.tsx:329`：`path="control-gates/approvals/:id"` → `:approvalNo`（`:493` 那条 `governance/approvals/:id` 同改）
- `ApprovalsPage.tsx:306`：`navigate(\`/admin/governance/approvals/${item.id}\`)` → `${item.approvalNo}`
- `ApprovalDetailPage.tsx`：`useParams` 取 `approvalNo`，所有 `${id}` 拼接改 `${approvalNo}`

- [ ] **Step 6: 闸门 + 截图**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json && (cd admin-web && npx tsc -b --noEmit)
bash scripts/on-stack.sh self jest -- test/approval-expiry.e2e-spec.ts src/modules/governance
```

起 preview，登 `ciso@`，进审批中心点开一单，**截图地址栏**——应是 `APR-...` 不是 UUID。

- [ ] **Step 7: 提交**

```bash
git add src/modules/governance/approvals src/modules/identity/access-control/rbac.catalog.ts admin-web test/
git commit -m "refactor(approvals): 对外识别改 approvalNo——地址栏不再是 UUID（铁律⑥）"
```

---

## Task 9：钱包 / 成员 / 两处客户跳转改业务号

**Files:**
- Modify: `admin-web/src/App.tsx:457`（`custody/wallets/:id` → `:walletNo`）、`:423`（`iam/members/:id` → `:userNo`）
- Modify: `admin-web/src/pages/CustodianWalletList.tsx:307,325`
- Modify: `admin-web/src/pages/PlatformMembers.tsx:357`
- Modify: `admin-web/src/pages/LedgerAccountList.tsx:343`
- Modify: 对应后端端点与 `rbac.catalog.ts:369-371`

- [ ] **Step 1: 逐处替换**

| 位置 | 现在 | 改成 |
|---|---|---|
| `CustodianWalletList.tsx:307` | `/admin/custody/wallets/${w.id}` | `${w.walletNo}` |
| `CustodianWalletList.tsx:325` | `/admin/customers/${w.ownerId}` | `${w.ownerNo}` |
| `PlatformMembers.tsx:357` | `/admin/iam/members/${member.id}` | `${member.userNo}` |
| `LedgerAccountList.tsx:343` | `/admin/customers/${row.ownerUuid}` | `${row.ownerNo}` |

⚠️ 每处**先确认列表接口真的返回了那个业务号字段**（`walletNo` / `ownerNo` / `userNo`）。没返回就先在后端 select 里补上——**不要在前端拿 UUID 再查一次**。
⚠️ `LedgerAccountList.tsx:304` 的 `${row.tbAccountId}` **保留不动**：那是账本自己的账户号，不是内部 UUID，本来就是对的对外键。

- [ ] **Step 2: 后端端点与路由同步**

`/wallets/:id` 三条（`rbac.catalog.ts:369-371`）改 `:walletNo`；成员详情端点同理。改完 `db:base:sync` + 重启后端。

- [ ] **Step 3: 闸门 + 截图**

```bash
cd Exchange_js && npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit)
```

起 preview，登 `treasury@`，钱包列表点进详情、再点客户链接，**两次都截地址栏**。

- [ ] **Step 4: 提交**

```bash
git add admin-web src/modules
git commit -m "refactor(admin): 钱包/成员/客户跳转改业务号——第一幕 UUID 暴露清零"
```

---

# Phase 4 · ⑦ 资产状态沿边走

## Task 10：资产显式迁移表

**Files:**
- Create: `src/modules/asset-treasury/assets/constants/asset-transitions.constant.ts`
- Modify: `src/modules/asset-treasury/assets/assets.service.ts`
- Test: `src/modules/asset-treasury/assets/assets.service.spec.ts`

**Interfaces:**
- Produces: `ASSET_TRANSITIONS: Partial<Record<AssetStatus, Partial<Record<AssetAction, AssetStatus>>>>`；`assertAssetTransition(from: string, action: AssetAction): string`（返回目标状态，非法则抛 `ConflictException`）

- [ ] **Step 1: 写失败的测试**

在 `assets.service.spec.ts` 追加：

```typescript
  it('非法跃迁被迁移表挡下：ACTIVE 的资产不能再次 activate', () => {
    expect(() => assertAssetTransition('ACTIVE', AssetAction.ACTIVATE)).toThrow(/Invalid transition/);
  });

  it('合法边照走：PROVISIONING --ACTIVATE--> ACTIVE', () => {
    expect(assertAssetTransition('PROVISIONING', AssetAction.ACTIVATE)).toBe('ACTIVE');
  });

  it('SUSPENDED 只能 REACTIVATE，不能 ACTIVATE', () => {
    expect(assertAssetTransition('SUSPENDED', AssetAction.REACTIVATE)).toBe('ACTIVE');
    expect(() => assertAssetTransition('SUSPENDED', AssetAction.ACTIVATE)).toThrow(/Invalid transition/);
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- src/modules/asset-treasury/assets
```

预期：FAIL，`assertAssetTransition is not defined`

- [ ] **Step 3: 写迁移表**

新建 `src/modules/asset-treasury/assets/constants/asset-transitions.constant.ts`：

```typescript
import { ConflictException } from '@nestjs/common';

export enum AssetAction {
  ACTIVATE = 'ACTIVATE',
  SUSPEND = 'SUSPEND',
  REACTIVATE = 'REACTIVATE',
}

/**
 * 资产状态迁移表（2026-09-01 补）。
 * 此前三处状态变更靠散落的 `if (asset.status !== 'X') throw` 守——效果在，
 * 但没有单一真相处：加新边时没人挡得住绕表直写（铁律④）。
 */
export const ASSET_TRANSITIONS: Record<string, Partial<Record<AssetAction, string>>> = {
  PROVISIONING: { [AssetAction.ACTIVATE]: 'ACTIVE' },
  ACTIVE:       { [AssetAction.SUSPEND]: 'SUSPENDED' },
  SUSPENDED:    { [AssetAction.REACTIVATE]: 'ACTIVE' },
};

export function assertAssetTransition(from: string, action: AssetAction): string {
  const to = ASSET_TRANSITIONS[from]?.[action];
  if (!to) {
    throw new ConflictException(
      `Invalid transition: asset in ${from} cannot ${action}`,
    );
  }
  return to;
}
```

- [ ] **Step 4: 三处改走表**

`assets.service.ts`：
- `activateAsset()`（约 `:155-162`）：把 `if (asset.status !== 'PROVISIONING') throw ...` 换成 `const to = assertAssetTransition(asset.status, AssetAction.ACTIVATE);`，update 时 `data: { status: to }`
- `reactivateAsset()`（约 `:120-127`）：同理用 `AssetAction.REACTIVATE`
- 停牌方法：同理用 `AssetAction.SUSPEND`

- [ ] **Step 5: 跑测试确认通过 + 闸门**

```bash
cd Exchange_js && bash scripts/on-stack.sh self jest -- src/modules/asset-treasury/assets
npx tsc --noEmit -p tsconfig.json && npx tsc --noEmit -p tsconfig.test.json
```

- [ ] **Step 6: 提交**

```bash
git add src/modules/asset-treasury/assets
git commit -m "refactor(assets): 资产状态改走显式迁移表——非法跃迁有单一真相处（铁律④）"
```

---

# Phase 5 · ⑪⑩ 判据与走查

## Task 11：`verify:act1` 行为校验器

**Files:**
- Create: `scripts/verify-act1.ts`
- Modify: `package.json`
- Modify: `doc-final/demo/baseline.md`

**Interfaces:**
- Consumes: Task 1/2 的 cron 与 ⚡ 端点、Task 8/9 的业务号端点、Task 10 的迁移表
- Produces: `npm run verify:act1` —— 退出码 0 = 全过；非 0 = 打印第一条不符项

- [ ] **Step 1: 写校验器**

新建 `scripts/verify-act1.ts`。**三条关键设计照抄 `verify-rbac.ts` 的教训**：
① 端口从 `.stackports` 读，**不许写死 3000**（写死会打到 main 的栈）；② 每条判据先做**存在性预检**（路径写错 → 404 → 被当成"非 403 = 通过"的假绿）；③ 一律真登录真 HTTP，**禁止扫源码文本**。

```typescript
// scripts/verify-act1.ts
// 第一幕系统属性行为校验器（⑥ 超时门 / ⑦ 状态沿边走 / ⑨ 业务键 / ① 留痕带上下文）。
// 判据一律真登录真 HTTP —— 本仓库栽过六次「扫源码文本」的自证型绿灯。
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

// ① 端口必须从本 worktree 的 .stackports 读，绝不写死——写死 3000 会打到 main 的栈。
function apiBase(): string {
  const raw = readFileSync(join(__dirname, '..', '.stackports'), 'utf8');
  const port = /BACKEND_PORT=(\d+)/.exec(raw)?.[1];
  if (!port) throw new Error('.stackports 里读不到 BACKEND_PORT——先 stack.sh up');
  return `http://localhost:${port}`;
}

const API = apiBase();
const prisma = new PrismaClient();
const results: Array<{ id: string; ok: boolean; msg: string }> = [];
const judge = (id: string, ok: boolean, msg: string) => {
  results.push({ id, ok, msg });
  console.log(`${ok ? '✓' : '✗'} ${id} ${msg}`);
};

async function login(user: string): Promise<string> {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${user}@fiatx.com`, password: '123456' }),
  });
  const j: any = await r.json();
  if (!j.access_token) throw new Error(`登录失败: ${user}`);
  return j.access_token;
}

const call = (path: string, token: string, method = 'GET') =>
  fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });

// ② 存在性预检：路径打不通就直接判红，绝不让 404 冒充「通过」。
async function precheck(path: string, token: string) {
  const r = await call(path, token);
  if (r.status === 404) throw new Error(`预检失败：${path} 返回 404，判据本身写错了`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ciso = await login('ciso');
  const treasury = await login('treasury');
  const tech = await login('tech_admin');

  // ── ⑥ 超时门 ────────────────────────────────────────────
  const mk = (suffix: string, timeoutAt: Date) =>
    prisma.approvalCase.create({
      data: {
        approvalNo: `APR-VERIFY-${suffix}-${Date.now()}`,
        actionType: 'SWAP_FEE_LEVEL_CHANGE', entityRef: 'VERIFY', createdByUserId: 'verify',
        status: 'PENDING', traceId: `verify-${suffix}-${Date.now()}`, timeoutAt,
      },
    });

  const due = await mk('DUE', new Date(Date.now() + 48 * 3_600_000));
  const notDue = await mk('NOTDUE', new Date(Date.now() + 48 * 3_600_000));

  await precheck(`/admin/control-gates/approvals/${due.approvalNo}`, ciso);
  const sim = await call(`/admin/control-gates/approvals/${due.approvalNo}/simulate-timeout`, ciso, 'POST');
  judge('B0', sim.status === 200 || sim.status === 201, `⚡ 模拟超时端点可用 (http=${sim.status})`);

  // cron 是 */1，最多等 90 秒
  let flipped = false;
  for (let i = 0; i < 18 && !flipped; i++) {
    await sleep(5000);
    const row = await prisma.approvalCase.findUniqueOrThrow({ where: { id: due.id } });
    flipped = row.status === 'EXPIRED';
  }
  judge('B1', flipped, '⑥ 拨到过去的单在 90 秒内被 cron 判过期');

  const untouched = await prisma.approvalCase.findUniqueOrThrow({ where: { id: notDue.id } });
  judge('B2', untouched.status === 'PENDING', '⑥ 未到期的单同一轮里没被误杀');

  const simAgain = await call(`/admin/control-gates/approvals/${due.approvalNo}/simulate-timeout`, ciso, 'POST');
  judge('B3', simAgain.status === 400, `⑥ 对已过期的单打 ⚡ → 400 而非 500 (http=${simAgain.status})`);

  // ── ⑨ 业务键 ────────────────────────────────────────────
  const byNo = await call(`/admin/control-gates/approvals/${due.approvalNo}`, ciso);
  judge('B4', byNo.status === 200, `⑨ 审批详情收业务号 (http=${byNo.status})`);
  const byUuid = await call(`/admin/control-gates/approvals/${due.id}`, ciso);
  judge('B5', byUuid.status === 404, `⑨ 拿 UUID 打审批详情 → 404 (http=${byUuid.status})`);

  const wallet = await prisma.wallet.findFirst({ where: { walletNo: { not: null } } });
  if (!wallet?.walletNo) throw new Error('预检失败：库里没有带 walletNo 的钱包——先 demo:all');
  const wByNo = await call(`/wallets/${wallet.walletNo}`, treasury);
  const wByUuid = await call(`/wallets/${wallet.id}`, treasury);
  judge('B6', wByNo.status === 200 && wByUuid.status === 404,
    `⑨ 钱包收业务号拒 UUID (byNo=${wByNo.status} byUuid=${wByUuid.status})`);

  // ── ⑦ 状态沿边走 ────────────────────────────────────────
  const active = await prisma.asset.findFirst({ where: { status: 'ACTIVE' } });
  if (!active?.assetNo) throw new Error('预检失败：库里没有 ACTIVE 资产');
  const reActivate = await call(`/admin/assets/${active.assetNo}/activate`, tech, 'POST');
  const body = await reActivate.text();
  judge('B7', reActivate.status === 409 && /Invalid transition/.test(body),
    `⑦ 对 ACTIVE 资产再激活 → 409 + Invalid transition (http=${reActivate.status})`);

  // ── ① 留痕带上下文 ──────────────────────────────────────
  const log = await prisma.auditLog.findFirst({
    where: { action: 'APPROVAL_EXPIRED', primarySubjectNo: due.approvalNo },
  });
  judge('B8', !!log && (log as any).fromStatus === 'PENDING' && (log as any).toStatus === 'EXPIRED',
    '① APPROVAL_EXPIRED 留痕带 from/to（不是裸词）');

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} PASS`);
  if (failed.length) { console.error(`首条不符：${failed[0].id} ${failed[0].msg}`); process.exit(1); }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

⚠️ `.stackports` 的键名、`/admin/assets/:assetNo/activate` 的真实路径、`auditLog` 的表名与 `fromStatus`/`toStatus` 列名，**执行者必须先 grep 确认再写**——本计划给的是结构，名字以代码现状为准。任何一处写错都会变成"预检失败"而不是假绿，这是设计如此。

- [ ] **Step 2: 注册脚本**

`package.json` 加：

```json
    "verify:act1": "ts-node -r tsconfig-paths/register scripts/verify-act1.ts",
```

- [ ] **Step 3: 跑一遍全绿**

```bash
cd Exchange_js && bash scripts/on-stack.sh self verify:act1
```

预期：8/8 PASS

- [ ] **Step 4: 变异验证每一条都抓得住**

逐条做一次破坏、确认对应判据变红、再改回：
- 注释掉 `ApprovalExpiryService` 的 `@Cron` → B1 必须红
- 把 Task 10 的 `ASSET_TRANSITIONS.ACTIVE` 加上 `[AssetAction.ACTIVATE]: 'ACTIVE'` → B7 必须红
- 把 `approvals.controller.ts` 的 `:approvalNo` 改回 `:id` → B4/B5 必须红

⚠️ **这一步不能跳**。没做变异验证的校验器等于没有校验器。

- [ ] **Step 5: 记进基线**

`doc-final/demo/baseline.md` 追加一节，写明：
- `verify:act1` **会写数据**（每轮留一张 EXPIRED 的审批单）
- 运行顺序约束：`verify:rbac` → `verify:act1` → `stack.sh reset` → `demo:all`
- **绝不能在演示前跑**

- [ ] **Step 6: 提交**

```bash
git add scripts/verify-act1.ts package.json doc-final/demo/baseline.md
git commit -m "test(act1): verify:act1 行为校验器 8 条——⑥⑦⑨ 各条变异实证抓得住"
```

---

## Task 12：第一幕端到端走查 + 文档同步

**Files:**
- Modify: `doc-final/demo/script.md`（第一幕）
- Modify: `doc-final/modules/v1-governance.md`、`doc-final/modules/v3-financial-config.md`
- Modify: `doc-final/CHANGELOG.md`、`doc-final/BACKLOG.md`

**Interfaces:**
- Consumes: Task 1–11 的全部产出

- [ ] **Step 1: 重铺 + 造数**

```bash
cd Exchange_js && bash scripts/stack.sh reset self && bash scripts/on-stack.sh self demo:all
```

- [ ] **Step 2: 真人走查五站，逐站截图**

按 `demo/script.md` 第一幕现有 5 站，用 11 个职务账号真登录点完。**每站记三样**：走通没有、页面对不对、审计页查不查得到刚才那笔。
撞到的每个问题当场记下（这是本轮 ②③④ 的唯一取证途径）。

- [ ] **Step 3: 把超时门加进剧本**

`script.md` 站 3「门自己也要过门」末尾追加：

```
⑤ 换 `sm@` 再提一张策略变更 → 详情页点 ⚡ 模拟超时 → 等一分钟刷新 → 状态 EXPIRED，
   审计页按该单号查得到 APPROVAL_EXPIRED（谁都没批，是时间到了）
期望：三种结局都演到——批准、当场拒绝、超时自动作废
```

- [ ] **Step 4: 模块文档同步**

- `v1-governance.md` §5：审计词表数字从「48 live + 30 退役」更新为实测新值；§6 删掉「V3 财务配置域词汇未入册」那条缺口（本轮已解）
- `v3-financial-config.md` §5：补审计合同已覆盖的说明
- 两篇表头 `Last Verified` 改 2026-09-01

- [ ] **Step 5: 缺口登记**

Step 2 撞出来的问题按 CLAUDE.md §4 三桶分流：业务缺口 → `BACKLOG.md`；技术兜底 → `PRODUCTION-NOTES.md`；工具环境 → `TOOLING-DEBT.md`。
`BACKLOG.md` 里 ⭐ Q3「`expirePendingApprovals()` 无 @Cron 调用方」条**销账**。

- [ ] **Step 6: CHANGELOG 记一条**

按既有格式追加一条 2026-09-01 的业务口径变更。

- [ ] **Step 7: 收尾闸全跑**

```bash
cd Exchange_js
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:act1
bash scripts/stack.sh reset self
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self recon:demo:pass
bash scripts/on-stack.sh self recon:demo:break
```

判据对照 `doc-final/demo/baseline.md`，**全绿**。

- [ ] **Step 8: 提交**

```bash
git add doc-final
git commit -m "docs(act1): 第一幕走查收尾——超时门进剧本，V3 留痕缺口销账"
```

---

## 已知风险与执行者须知

1. **Task 3 与 Task 5 的退役名册有顺序耦合**：8 个 `CREATION_*`/`CHANGE_*` 字符串被费率两族和限额两族共用。Task 3 若先把它们登记进 `DEPRECATED_AUDIT_ACTIONS`，限额族的写入会当场抛。执行者必须实跑确认，二选一：(a) Task 3 只改码不登退役，退役登记推迟到 Task 5 末尾；(b) Task 3 与 Task 5 合并成一个任务。**在 commit message 里写明选了哪条**。
2. **RBAC 路由改名必须重启后端**：`db:base:sync` 只写库，SUPER_ADMIN 走内存定义。只 seed 不重启 = 白做。
3. **Task 8 只改四个对外方法**：`expirePendingApprovalCase(id)` 内部按 id 走，不要一起改——对外用业务号、内部用 id，这是两件事。
4. **⚡ 只拨时间不改状态**：过期这条边必须由扫描器走完，否则演的是假门。
5. **进合同会让缺字段的调用当场抛**——这是特性不是 bug。Task 3–6 每处调用点都要补齐字段，别为了不抛而把 `requiredFields` 写空。
6. **前端改动一律要 preview 截图**，tsc 过不算数（本仓库明令）。
