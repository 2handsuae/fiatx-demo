# 充值详情独立页 + 多条 applicant action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把充值详情从弹窗改成右侧区域内的独立页面，支持一笔单挂多条 applicant action、逐条点开各自的认证界面。

**Architecture:** 多条 action 落一张子表 `DepositApplicantAction`（每条自带 `submittedAt`）；充值单上的 `actionSubmittedAt` 保留为「全部交齐的时刻」缓存，使既有五层 tipping-off 防线零改动。客户端从头到尾只见 `seq`，永不接触 action id。

**Tech Stack:** NestJS + Prisma/SQLite（后端）｜ React + Vite + react-router（client-web）｜ jest（后端）+ vitest（前端）

**设计依据:** `doc-final/superpowers/specs/2026-08-06-deposit-detail-page-multi-action-design.md`

## Global Constraints

- 客户面响应体**绝不含** action id（`applicantActionId` / `externalActionId`）、`manualReason`、`sumsub*`、`limitHoldReason`、`slaDeadline`、`slaBreached`、`statusHistory`。定位一条 action 一律用 `seq`。
- 客户面接口的响应体**只由该条 action 的 `submittedAt` 决定，绝不由充值单 `status` 决定**；`POST` 类恒 2xx；`seq` 不存在时返回与「单子不存在」完全相同的 404。
- 「这单算不算已提交」= **全部 action 都交齐**。
- 审计**必须**带真 `applicantActionId`（operator 面），与客户面相反。
- 审计服务 **DI 注入，禁止 `new`**；多表状态变更**必须** `prisma.$transaction`。
- 有稳定业务键时禁止以 `id` 作对外主查询合同（路径参数用 `depositNo`）。
- Prisma 迁移必须纯加表/加列，**不得表重建**。
- 客户面文案**零中文、全英文**，且不得出现 `sanction|seiz|frozen|freeze|confiscat|enforcement|government|police`。注释用中文、标识符用英文。
- 变异验证用 **python**（禁止 perl：`\Q…\E` 把 `\n` 当字面反斜杠 n，文件没改却误判为绿，本项目已实证）；还原禁止 `git checkout`（会丢未提交的实现）。
- **禁止跑 `test/*.e2e-spec.ts` 之外的 e2e**，且 e2e 必须连含 `e2e-` 字样的专用库。
- 后端**无热更**：接口/渲染验收前必须 `npm run build` 并重启 3100。

---

## File Structure

| 文件 | 职责 |
|---|---|
| `prisma/schema.prisma` | 新增 `DepositApplicantAction` 模型 |
| `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts` | **新建**。子表的全部读写：集合同步、按 seq 查、提交并重算缓存 |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | `toCustomerDepositView` 加 `actions`；删 `setActionRefs`/`markActionSubmitted` |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | `applyKytAwaitUser` 改集合比对 |
| `src/modules/trading/deposit-transactions/deposit-verification-session.service.ts` | 改为按 seq 取会话 / 提交 |
| `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts` | 两条会话路由加 `:seq` 段 |
| `client-web/src/pages/DepositDetail.tsx` | **新建**。详情页 |
| `client-web/src/pages/DepositVerification.tsx` | **新建**。认证页（含 demo 假上传组件） |
| `client-web/src/pages/Deposit.tsx` | 删弹窗；行点击改为 `navigate` |
| `client-web/src/pages/MockVerification.tsx` | **删除**（降级为认证页内组件） |
| `client-web/src/App.tsx` | 加两条路由、删 `/mock-verification` |
| `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts` | 加 ⑩ 三条 action 的裁决按钮 |

---

## Task 1: 子表 schema + 集合同步与查询

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_deposit_applicant_actions/migration.sql`（由 prisma 生成）
- Create: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts`
- Create: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts`

**Interfaces:**
- Produces（后续任务依赖，签名不得改）:
  - `syncApplicantActions(depositId: string, incoming: { applicantActionId: string; externalActionId: string }[]): Promise<{ added: number[]; retired: number[] }>`
  - `findBySeq(depositId: string, seq: number): Promise<{ id: string; seq: number; applicantActionId: string; externalActionId: string; submittedAt: Date | null } | null>`

> 客户面列表**不经本 service**：`toCustomerDepositView` 是同步映射函数，await 不了，
> 故走 Prisma `include` 直接带出（Task 4 Step 4），那里的 `select` 就是唯一的把关处。
> 不要在这里再写一个 `listForCustomer`——没有调用方的方法是死码。

- [ ] **Step 1: 加 schema 模型**

在 `prisma/schema.prisma` 的 `DepositTransaction` 模型里，`fundsOrders` 那一行下面加一行关联：

```prisma
  applicantActions      DepositApplicantAction[] @relation("DepositApplicantActions")
```

并在文件末尾（`DepositTransaction` 模型之后）新增：

```prisma
model DepositApplicantAction {
  id                    String   @id @default(uuid())
  depositTransactionId  String
  applicantActionId     String   // Sumsub 侧 id。**只在服务端与审计出现，绝不下发客户端**
  externalActionId      String   // 铸 SDK token 的钥匙，一条 action 一个
  seq                   Int      // 客户面唯一可见的定位符；一旦分配不再变（进 URL）
  createdAt             DateTime @default(now())
  submittedAt           DateTime?

  deposit DepositTransaction @relation("DepositApplicantActions", fields: [depositTransactionId], references: [id], onDelete: Cascade)

  @@unique([depositTransactionId, applicantActionId])
  @@index([depositTransactionId, seq])
  @@map("deposit_applicant_actions")
}
```

- [ ] **Step 2: 生成迁移并确认是纯建表**

```bash
npx prisma migrate dev --name deposit_applicant_actions --create-only
```

打开生成的 `migration.sql` 确认：只有 `CREATE TABLE "deposit_applicant_actions"` + 两条 `CREATE INDEX`/`CREATE UNIQUE INDEX`，**没有任何 `ALTER TABLE ... RENAME` 或 `_new` 表重建**。若出现重建 → 停下报 BLOCKED。

然后应用并重新生成 client：

```bash
npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 3: 写失败测试**

新建 `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts`：

```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';

const A1 = { applicantActionId: 'aa-1', externalActionId: 'EXT-1' };
const A2 = { applicantActionId: 'aa-2', externalActionId: 'EXT-2' };

describe('DepositApplicantActionsService', () => {
  let svc: DepositApplicantActionsService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      depositApplicantAction: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockResolvedValue(0),
      },
      depositTransaction: { update: jest.fn(), updateMany: jest.fn() },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const mod = await Test.createTestingModule({
      providers: [
        DepositApplicantActionsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    svc = mod.get(DepositApplicantActionsService);
  });

  it('全新单：两条都插入，seq 从 1 开始递增', async () => {
    const r = await svc.syncApplicantActions('d-1', [A1, A2]);

    expect(r).toEqual({ added: [1, 2], retired: [] });
    expect(prisma.depositApplicantAction.createMany).toHaveBeenCalledWith({
      data: [
        { depositTransactionId: 'd-1', applicantActionId: 'aa-1', externalActionId: 'EXT-1', seq: 1 },
        { depositTransactionId: 'd-1', applicantActionId: 'aa-2', externalActionId: 'EXT-2', seq: 2 },
      ],
    });
  });

  it('已有 aa-1(seq=1)，报文含 aa-1+aa-2 → 只插 aa-2，seq 接续为 2', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: null },
    ]);

    const r = await svc.syncApplicantActions('d-1', [A1, A2]);

    expect(r).toEqual({ added: [2], retired: [] });
    expect(prisma.depositApplicantAction.createMany).toHaveBeenCalledWith({
      data: [
        { depositTransactionId: 'd-1', applicantActionId: 'aa-2', externalActionId: 'EXT-2', seq: 2 },
      ],
    });
  });

  it('集合完全一致 → 真 no-op，不插不删', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: null },
    ]);

    const r = await svc.syncApplicantActions('d-1', [A1]);

    expect(r).toEqual({ added: [], retired: [] });
    expect(prisma.depositApplicantAction.createMany).not.toHaveBeenCalled();
    expect(prisma.depositApplicantAction.deleteMany).not.toHaveBeenCalled();
  });

  // Sumsub 报文带的是**当前全量列表**。它撤回一条而我方保留，该行永远算作
  // 未提交 →「全部交齐」永不成立 → 客户永久卡死（与 applyKytAwaitUser 早退
  // 那个 bug 同款形状、不同入口）。已提交的行不删——那是历史。
  it('报文撤回了未提交的 aa-2 → 删掉它；已提交的 aa-1 不动', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: new Date('2026-08-06') },
      { id: 'r2', applicantActionId: 'aa-2', seq: 2, submittedAt: null },
    ]);

    const r = await svc.syncApplicantActions('d-1', [A1]);

    expect(r).toEqual({ added: [], retired: [2] });
    expect(prisma.depositApplicantAction.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['r2'] } },
    });
  });

  it('报文里已提交的那条被撤回 → 不删（历史保留）', async () => {
    prisma.depositApplicantAction.findMany.mockResolvedValue([
      { id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: new Date('2026-08-06') },
    ]);

    const r = await svc.syncApplicantActions('d-1', []);

    expect(r).toEqual({ added: [], retired: [] });
    expect(prisma.depositApplicantAction.deleteMany).not.toHaveBeenCalled();
  });

});
```

- [ ] **Step 4: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts
```

预期：整个 suite 失败，报 `Cannot find module './deposit-applicant-actions.service'`。

- [ ] **Step 5: 实现**

新建 `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts`：

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface IncomingApplicantAction {
  applicantActionId: string;
  externalActionId: string;
}

/**
 * 一笔充值单上挂的多条 Sumsub applicant action。
 *
 * **客户端从头到尾拿不到 action id。** 上一轮的 Critical：`actionId` 曾出现在
 * 客户面响应体里，而 demo fixture 的 id 是 `aa-edd-0002`——`edd` 三个字母把
 * "为什么要你交材料"写在脸上。故对外一律用 `seq` 定位，服务端自己查表换真 id
 * 去铸 token。不是靠"记得别下发"，是客户端根本没有这个字段可漏。
 */
@Injectable()
export class DepositApplicantActionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 用 Sumsub 报文里的 applicantActions **全量列表**同步本地子表。
   *
   * 三种情况：
   *  · 有新 id      → 插行，seq 取现有最大值 +1 往后追加
   *  · 完全一致      → 真 no-op（重复 webhook）
   *  · 库内有、报文无 → **删掉其中未提交的**
   *
   * 第三条是关键：报文带的是当前全量列表，Sumsub 撤回一条而我方保留，该行
   * 永远算作未提交 →「全部交齐」永不成立 → 客户永久卡死。已提交的行不删，
   * 那是历史。
   *
   * seq 一旦分配不再变——它进 URL（/verification/2），客户收藏了链接、或页面
   * 开着时来了新 action，都不能让第 2 条变成第 3 条。
   */
  async syncApplicantActions(
    depositId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number[]; retired: number[] }> {
    const existing = await (this.prisma as any).depositApplicantAction.findMany({
      where: { depositTransactionId: depositId },
      select: { id: true, applicantActionId: true, seq: true, submittedAt: true },
      orderBy: { seq: 'asc' },
    });

    const existingIds = new Set(existing.map((r: any) => r.applicantActionId));
    const incomingIds = new Set(incoming.map((a) => a.applicantActionId));

    const toAdd = incoming.filter((a) => !existingIds.has(a.applicantActionId));
    const toRetire = existing.filter(
      (r: any) => !incomingIds.has(r.applicantActionId) && r.submittedAt === null,
    );

    let nextSeq = existing.reduce((m: number, r: any) => Math.max(m, r.seq), 0) + 1;
    const added: number[] = [];
    const rows = toAdd.map((a) => {
      const seq = nextSeq++;
      added.push(seq);
      return {
        depositTransactionId: depositId,
        applicantActionId: a.applicantActionId,
        externalActionId: a.externalActionId,
        seq,
      };
    });

    if (rows.length) {
      await (this.prisma as any).depositApplicantAction.createMany({ data: rows });
    }
    if (toRetire.length) {
      await (this.prisma as any).depositApplicantAction.deleteMany({
        where: { id: { in: toRetire.map((r: any) => r.id) } },
      });
    }

    return { added, retired: toRetire.map((r: any) => r.seq) };
  }

  /** 服务端按 seq 换回真 id（用于铸 token）。返回 null 交由调用方转成 404。 */
  async findBySeq(depositId: string, seq: number) {
    return (this.prisma as any).depositApplicantAction.findFirst({
      where: { depositTransactionId: depositId, seq },
      select: {
        id: true,
        seq: true,
        applicantActionId: true,
        externalActionId: true,
        submittedAt: true,
      },
    });
  }

}
```

- [ ] **Step 6: 注册到 module**

在 `src/modules/trading/deposit-transactions/deposit-transactions.module.ts` 的 `providers` 数组里加 `DepositApplicantActionsService`，并加进 `exports`（Task 3/4 要跨 service 用）。import 语句：

```ts
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
```

- [ ] **Step 7: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts
npx tsc --noEmit -p .
```

预期：5 passed；tsc 0 错。

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts src/modules/trading/deposit-transactions/deposit-transactions.module.ts
git commit -m "feat(deposit): applicant action 子表 + 集合同步(撤回未提交行防永久卡死)"
```

---

## Task 2: 逐条提交 + 充值单缓存重算 + 绑死两种表示

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `syncApplicantActions` / `findBySeq`
- Produces:
  - `submitBySeq(depositId: string, seq: number, slaDeadline: Date, resetSla: boolean): Promise<{ changed: boolean; allSubmitted: boolean }>`
  - `clearDepositCache(depositId: string, slaDeadline: Date): Promise<void>`

- [ ] **Step 1: 写失败测试**

追加到 `deposit-applicant-actions.service.spec.ts` 的 `describe` 内：

```ts
  describe('逐条提交与充值单缓存', () => {
    const DEADLINE = new Date('2026-08-13T00:00:00Z');

    it('交完最后一条 → 盖上充值单的 actionSubmittedAt', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(0);   // 已无未提交

      const r = await svc.submitBySeq('d-1', 2, DEADLINE, true);

      expect(r).toEqual({ changed: true, allSubmitted: true });
      expect(prisma.depositApplicantAction.updateMany).toHaveBeenCalledWith({
        where: { depositTransactionId: 'd-1', seq: 2, submittedAt: null },
        data: { submittedAt: expect.any(Date) },
      });
      const [[arg]] = prisma.depositTransaction.updateMany.mock.calls;
      expect(arg.data.actionSubmittedAt).toEqual(expect.any(Date));
      expect(arg.data.slaDeadline).toEqual(DEADLINE);
      expect(arg.data.slaBreached).toBe(false);
    });

    it('还剩未提交的 → 充值单缓存**不**盖，客户仍要继续交', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(1);   // 还有 1 条没交

      const r = await svc.submitBySeq('d-1', 1, DEADLINE, true);

      expect(r).toEqual({ changed: true, allSubmitted: false });
      expect(prisma.depositTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('重复提交同一条 → changed:false，不重算不写库', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 0 });

      const r = await svc.submitBySeq('d-1', 1, DEADLINE, true);

      expect(r).toEqual({ changed: false, allSubmitted: false });
      expect(prisma.depositApplicantAction.count).not.toHaveBeenCalled();
      expect(prisma.depositTransaction.updateMany).not.toHaveBeenCalled();
    });

    it('resetSla=false 时只盖 actionSubmittedAt，不碰 operator 的 SLA 两字段', async () => {
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(0);

      await svc.submitBySeq('d-1', 1, DEADLINE, false);

      const [[arg]] = prisma.depositTransaction.updateMany.mock.calls;
      expect(arg.data).toEqual({ actionSubmittedAt: expect.any(Date) });
    });

    it('clearDepositCache 把 actionSubmittedAt 清空并重置 SLA 表', async () => {
      await svc.clearDepositCache('d-1', DEADLINE);
      expect(prisma.depositTransaction.update).toHaveBeenCalledWith({
        where: { id: 'd-1' },
        data: { actionSubmittedAt: null, slaDeadline: DEADLINE, slaBreached: false },
      });
    });
  });

  // 缓存式设计（spec §2.2）的代价是可能漂移：子表说还有未交的，充值单标量
  // 却显示已交齐。这条直接把两种表示绑死——对随机构造的提交组合，断言
  // 「标量该不该有值」与「子表还有没有未提交行」结论一致。漂了就红。
  describe('绑死两种表示（防缓存漂移）', () => {
    const DEADLINE = new Date('2026-08-13T00:00:00Z');

    it.each([
      [3, 0],  // 3 条全未交
      [3, 1],
      [3, 2],
      [3, 3],  // 3 条全交齐
      [1, 0],
      [1, 1],
    ])('%i 条 action 交了 %i 条：缓存与子表结论一致', async (total, submittedCount) => {
      const outstanding = total - submittedCount;
      prisma.depositApplicantAction.updateMany = jest.fn().mockResolvedValue({ count: 1 });
      prisma.depositApplicantAction.count.mockResolvedValue(outstanding);
      prisma.depositTransaction.updateMany.mockClear();

      const r = await svc.submitBySeq('d-1', 1, DEADLINE, true);

      const cacheWritten = prisma.depositTransaction.updateMany.mock.calls.length > 0;
      expect(r.allSubmitted).toBe(outstanding === 0);
      expect(cacheWritten).toBe(outstanding === 0);
    });
  });
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts -t "逐条提交"
```

预期：FAIL，报 `svc.submitBySeq is not a function`（或 ts-jest 的 `TS2339: Property 'submitBySeq' does not exist`——本项目 ts-jest 开了严格类型检查，编译期就会拦下，属同一根因的更早期失败，可接受）。

- [ ] **Step 3: 实现**

在 `DepositApplicantActionsService` 里追加两个方法：

```ts
  /**
   * 提交某一条 action，并按需重算充值单上的「全部交齐」缓存。
   *
   * 两表都要写，故必须包 `$transaction`（CLAUDE.md 铁律 2）。
   *
   * 幂等靠 `updateMany` 的 where 条件交给 DB 保证互斥——不能退回"先读后写"，
   * 那样并发下两个请求都会读到 submittedAt=null、都返回 changed:true，
   * 调用方据此写审计就会记重。
   *
   * `allSubmitted` 只在真正交完最后一条时为 true（spec §D4：交一条就算完
   * 会让客户以为交完了、剩下的永远不动，那是 bug 不是选项）。
   */
  async submitBySeq(
    depositId: string,
    seq: number,
    slaDeadline: Date,
    resetSla: boolean,
  ): Promise<{ changed: boolean; allSubmitted: boolean }> {
    return this.prisma.$transaction(async (tx: any) => {
      const res = await tx.depositApplicantAction.updateMany({
        where: { depositTransactionId: depositId, seq, submittedAt: null },
        data: { submittedAt: new Date() },
      });
      if (res.count === 0) return { changed: false, allSubmitted: false };

      const outstanding = await tx.depositApplicantAction.count({
        where: { depositTransactionId: depositId, submittedAt: null },
      });
      if (outstanding > 0) return { changed: true, allSubmitted: false };

      // 全部交齐 → 盖充值单缓存。SLA 两字段只在 resetSla 时写：单子已被 SLA
      // 定时器打成 MANUAL_CHECKING(slaBreached=true)后，客户一次提交不该把
      // operator 眼里的违约旗单方面抹掉（该状态不在 findSlaBreachCandidates
      // 的扫描范围内，抹掉后永远发现不了）。
      await tx.depositTransaction.updateMany({
        where: { id: depositId },
        data: {
          actionSubmittedAt: new Date(),
          ...(resetSla && { slaDeadline, slaBreached: false }),
        },
      });
      return { changed: true, allSubmitted: true };
    });
  }

  /**
   * 新 action 进来时清掉充值单的「全部交齐」缓存并重置 SLA 表。
   * 不清的话：客户此前交过的材料让 actionSubmittedAt 留着旧值 → 单子明明又要
   * 客户补材料，客户端却一直显示"已收到，审核中"，客户永远不知道要再交一次。
   */
  async clearDepositCache(depositId: string, slaDeadline: Date): Promise<void> {
    await (this.prisma as any).depositTransaction.update({
      where: { id: depositId },
      data: { actionSubmittedAt: null, slaDeadline, slaBreached: false },
    });
  }
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts
npx tsc --noEmit -p .
```

预期：16 passed（Task 1 的 5 条 + 本任务 5 条 + 绑死 6 条）；tsc 0 错。

- [ ] **Step 5: 变异验证——确认「绑死两种表示」真能抓到漂移**

用 python 把 `if (outstanding > 0) return { changed: true, allSubmitted: false };` 改成永远往下走：

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts')
s = p.read_text()
old = "      if (outstanding > 0) return { changed: true, allSubmitted: false };"
new = "      if (false && outstanding > 0) return { changed: true, allSubmitted: false }; // MUTATION"
assert s.count(old) == 1, f"替换串不唯一/对不上: {s.count(old)}"
p.write_text(s.replace(old, new)); print("变异已写入")
PY
npx jest src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts -t "绑死两种表示"
```

预期：**变红**，且失败的是 `3 条 action 交了 0/1/2 条` 那几条（`allSubmitted` 期望 false 实得 true）。若全绿说明测试无效，回 Step 1 重写。

还原并确认恢复绿：

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts')
s = p.read_text()
old = "      if (false && outstanding > 0) return { changed: true, allSubmitted: false }; // MUTATION"
new = "      if (outstanding > 0) return { changed: true, allSubmitted: false };"
assert s.count(old) == 1, f"还原串对不上: {s.count(old)}"
p.write_text(s.replace(old, new)); print("已还原")
PY
grep -c MUTATION src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts || echo "无 MUTATION 残留 ✅"
npx jest src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/trading/deposit-transactions/deposit-applicant-actions.service.ts src/modules/trading/deposit-transactions/deposit-applicant-actions.service.spec.ts
git commit -m "feat(deposit): 逐条提交+全部交齐才盖缓存,并加测试绑死两种表示"
```

---

## Task 3: 裁决管道改集合比对

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`applyKytAwaitUser`）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（删 `setActionRefs` / `markActionSubmitted`）

**Interfaces:**
- Consumes: Task 1 的 `syncApplicantActions`、Task 2 的 `clearDepositCache`
- Produces: 无新公开签名（`applyKytAwaitUser` 仍是 private）

- [ ] **Step 1: 写失败测试**

在 `deposit-workflow.service.spec.ts` 里，把既有的 `applicant action` 相关 describe 整体替换为：

```ts
  describe('applyKytAwaitUser：多条 action 集合比对', () => {
    const ACTIONS = [
      { applicantActionId: 'aa-1', externalActionId: 'EXT-1' },
      { applicantActionId: 'aa-2', externalActionId: 'EXT-2' },
    ];

    it('从 COMPLIANCE_PENDING 首次进态：同步集合 + 状态迁移', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'COMPLIANCE_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      depositService.updateStatus.mockResolvedValue({ ...dep, status: 'ACTION_PENDING' });
      actionsService.syncApplicantActions.mockResolvedValue({ added: [1, 2], retired: [] });

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(actionsService.syncApplicantActions).toHaveBeenCalledWith('d-1', ACTIONS);
      expect(depositService.updateStatus).toHaveBeenCalled();
      const [, , opts] = depositService.updateStatus.mock.calls[0];
      expect(opts.extraData).toEqual(
        expect.objectContaining({ actionSubmittedAt: null, slaBreached: false }),
      );
    });

    it('已在 ACTION_PENDING 且集合有新增：不动状态，清缓存，记审计', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [2], retired: [] });

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(actionsService.clearDepositCache).toHaveBeenCalledWith('d-1', expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.DEPOSIT_ACTION_REISSUED,
          entityId: 'd-1',
          metadata: expect.objectContaining({ addedSeqs: [2], retiredSeqs: [] }),
        }),
      );
    });

    it('已在 ACTION_PENDING 且集合完全一致：真 no-op', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [], retired: [] });

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(actionsService.clearDepositCache).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_ACTION_REISSUED }),
      );
    });

    // 撤回同样要清缓存：3 条里撤掉 1 条未提交的之后，剩下 2 条若已交齐，
    // 缓存该盖上；反之若还有未交的，缓存必须是空。统一靠 clearDepositCache
    // + 下一次 submitBySeq 重算，不在这里各自算一遍。
    it('已在 ACTION_PENDING 且有撤回：清缓存并把撤回的 seq 记进审计', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [], retired: [2] });

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      expect(actionsService.clearDepositCache).toHaveBeenCalledWith('d-1', expect.any(Date));
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ addedSeqs: [], retiredSeqs: [2] }),
        }),
      );
    });

    it('审计带真 applicantActionId（operator 面需要，与客户面相反）', async () => {
      const dep = { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', ownerType: 'CUSTOMER', ownerId: 'c-1' };
      actionsService.syncApplicantActions.mockResolvedValue({ added: [2], retired: [] });

      await (service as any).applyKytAwaitUser(dep, undefined, ACTIONS);

      const call = auditLogsService.recordSystem.mock.calls.find(
        ([a]: any[]) => a.action === AuditActions.DEPOSIT_ACTION_REISSUED,
      );
      expect(call[0].metadata.incomingActionIds).toEqual(['aa-1', 'aa-2']);
    });
  });
```

在该 spec 的 `beforeEach` 里加入 mock（放在既有 `depositService` mock 旁边）：

```ts
  actionsService = {
    syncApplicantActions: jest.fn().mockResolvedValue({ added: [], retired: [] }),
    clearDepositCache: jest.fn(),
    listForCustomer: jest.fn().mockResolvedValue([]),
    findBySeq: jest.fn(),
    hasOutstanding: jest.fn().mockResolvedValue(false),
    submitBySeq: jest.fn(),
  };
```

并把它加进 `Test.createTestingModule` 的 providers：

```ts
        { provide: DepositApplicantActionsService, useValue: actionsService },
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "集合比对"
```

预期：FAIL（`syncApplicantActions` 未被调用 / DI 解析不到新 provider）。

- [ ] **Step 2b（前置）：让 `syncApplicantActions` 幂等吞掉唯一约束冲突**

Task 1 的复审指出：SQLite 下 Prisma 的 `$transaction` 是文件锁语义——多个读事务能
并发拿 SHARED 锁互不阻塞，两个并发调用完全可能各自读到同一份 `existing`，只在写入时
才被串行化。**真正兜底的是 `@@unique([depositTransactionId, seq])` 约束，不是事务。**

Task 1 时该 service 还没有调用方，所以冲突抛出去无所谓；**本任务把它接进 webhook
handler 之后就有所谓了**——并发或重复投递会让一次合法的 Sumsub webhook 投递变成裸
500，而 webhook 的正确语义是幂等。

在 `deposit-applicant-actions.service.ts` 的 `syncApplicantActions` 外层包一次重试：

```ts
  async syncApplicantActions(
    depositId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number[]; retired: number[] }> {
    try {
      return await this.syncOnce(depositId, incoming);
    } catch (e: any) {
      // P2002 = 唯一约束冲突。并发/重复 webhook 下两个调用算出同一个 nextSeq，
      // 一个成功一个撞约束——这是**预期内**的竞态结果，不是错误：重读一次即可，
      // 此时对方已经把行插好了，第二遍算出来的 toAdd 通常为空，天然幂等。
      // 不重试的话，一次合法投递会被打成 500 抛回 Sumsub，而 webhook 要求幂等。
      if (e?.code !== 'P2002') throw e;
      return this.syncOnce(depositId, incoming);
    }
  }

  private async syncOnce(
    depositId: string,
    incoming: IncomingApplicantAction[],
  ): Promise<{ added: number[]; retired: number[] }> {
    // …原 syncApplicantActions 的函数体原样搬进来，一行不改…
  }
```

加两条测试到 `deposit-applicant-actions.service.spec.ts`：

```ts
    it('撞唯一约束(P2002) → 重读一次,不把异常抛给调用方', async () => {
      const conflict = Object.assign(new Error('unique'), { code: 'P2002' });
      prisma.depositApplicantAction.createMany
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ count: 0 });
      // 第二遍读到对方已插好的行 → toAdd 为空
      prisma.depositApplicantAction.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'r1', applicantActionId: 'aa-1', seq: 1, submittedAt: null }]);

      await expect(svc.syncApplicantActions('d-1', [A1])).resolves.toEqual({ added: [], retired: [] });
    });

    it('非 P2002 的错误原样抛出,不吞', async () => {
      const boom = Object.assign(new Error('disk full'), { code: 'P9999' });
      prisma.depositApplicantAction.createMany.mockRejectedValue(boom);
      await expect(svc.syncApplicantActions('d-1', [A1])).rejects.toBe(boom);
    });
```

- [ ] **Step 3: 实现**

把 `applyKytAwaitUser` 整个替换为：

```ts
  private async applyKytAwaitUser(
    deposit: any,
    sceneTag?: 'SANCTION' | 'PEP',
    applicantActions?: { applicantActionId: string; externalActionId: string }[],
  ) {
    const incoming = applicantActions ?? [];
    const slaDeadline = new Date(
      Date.now() + DepositWorkflowService.ACTION_SLA_DAYS * 24 * 60 * 60 * 1000,
    );

    // 集合同步先做：无论状态动不动，子表都必须与报文的**全量列表**对齐。
    const { added, retired } = await this.applicantActions.syncApplicantActions(
      deposit.id,
      incoming,
    );

    if (deposit.status === DepositTransactionStatus.ACTION_PENDING) {
      // 已在目标态。集合没变 → 真·重复 webhook，no-op。
      if (added.length === 0 && retired.length === 0) return;

      // 集合变了：状态确实不动，但「全部交齐」缓存必须清、表必须重置——
      // 否则客户端仍显示"已收到，审核中"，客户根本不知道又被要东西了。
      await this.applicantActions.clearDepositCache(deposit.id, slaDeadline);
      await this.auditLogsService.recordSystem({
        action: AuditActions.DEPOSIT_ACTION_REISSUED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        reason: 'Sumsub changed the applicant-action set while already ACTION_PENDING',
        metadata: {
          addedSeqs: added,
          retiredSeqs: retired,
          // 审计是 operator 面，**必须**带真 id，否则运营对不上 Sumsub 后台。
          // 与客户面正好相反（客户面永不下发 id）——别看混。
          incomingActionIds: incoming.map((a) => a.applicantActionId),
        },
        sourcePlatform: 'SYSTEM',
      });
      return;
    }

    const manualReason = sceneTag === 'PEP' ? 'EDD_PEP' : 'CLIENT_ACTION';
    const oldStatus = deposit.status;
    // actionSubmittedAt/slaBreached 必须在这条跨状态弧（常见于 MANUAL_CHECKING →
    // ACTION_PENDING，Sumsub officer 把已进人工复核的单又打回 awaitingUser，
    // 2026-07-31 沙盒实测过）里一并清掉。它们是两个独立的持久字段，updateStatus
    // 不会替你清，不显式写就会原样带过去——客户此前交过的材料让缓存留着旧值，
    // 客户端会一直显示"已收到，审核中"，客户被永久卡死。
    const updated = await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.ACTION_PENDING,
        reason: 'KYT verdict: awaitUser',
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'KYT_VERDICT' },
        sourcePlatform: 'SYSTEM',
        extraData: {
          manualReason,
          slaDeadline,
          actionSubmittedAt: null,
          slaBreached: false,
        },
      },
    );

    await this.recordStateTransitionAudit(
      updated,
      oldStatus,
      updated.status,
      `KYT verdict: awaitUser (manualReason=${manualReason})`,
    );
  }
```

在该 service 的构造函数里注入（**DI 注入，禁止 `new`**）：

```ts
    private readonly applicantActions: DepositApplicantActionsService,
```

import：

```ts
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
```

- [ ] **Step 4: 确认 `deposit-workflow.service.ts` 已不再调用旧的两个方法**

```bash
grep -rn "setActionRefs\|markActionSubmitted" src/modules/trading/deposit-transactions/deposit-workflow.service.ts
```

预期：**无输出**（本任务已改为走子表方法）。

⚠️ **本任务不删除 `setActionRefs` / `markActionSubmitted` 本身。**
计划早先版本要求在这里删，那是**排序错误**：`deposit-verification-session.service.ts`
仍在调用 `markActionSubmitted`，而重写该 service 是 **Task 4** 的范围（它会把
`getSession`/`submit` 改成按 `seq` 走 `findBySeq`/`submitBySeq`）。此刻删除会让
out-of-scope 文件 tsc 变红，或逼本任务提前吞掉 Task 4 的全部工作量。

删除动作已移交 Task 4 Step 4b —— 那时它才真的没有调用方。全仓 grep 也留到那时做。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions src/modules/deposit-sumsub
npx tsc --noEmit -p .
```

预期：全绿；tsc 0 错。

- [ ] **Step 6: 变异验证——确认 no-op 判据真的被测住**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/trading/deposit-transactions/deposit-workflow.service.ts')
s = p.read_text()
old = "      if (added.length === 0 && retired.length === 0) return;"
new = "      if (false) return; // MUTATION"
assert s.count(old) == 1, f"替换串不唯一/对不上: {s.count(old)}"
p.write_text(s.replace(old, new)); print("变异已写入")
PY
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "集合比对"
```

预期：**变红**在「集合完全一致：真 no-op」那条。然后还原：

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/trading/deposit-transactions/deposit-workflow.service.ts')
s = p.read_text()
old = "      if (false) return; // MUTATION"
new = "      if (added.length === 0 && retired.length === 0) return;"
assert s.count(old) == 1, f"还原串对不上: {s.count(old)}"
p.write_text(s.replace(old, new)); print("已还原")
PY
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/deposit-transactions/
git commit -m "feat(deposit): 裁决管道改集合比对,删掉被取代的单条 action 读写"
```

---

## Task 4: 客户面接口（详情 actions + 按 seq 取会话）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（`toCustomerDepositView`）
- Modify: `src/modules/trading/deposit-transactions/deposit-verification-session.service.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-verification-session.service.spec.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `listForCustomer` / `findBySeq`、Task 2 的 `submitBySeq`
- Produces:
  - `GET  /deposit-transactions/my/:depositNo/verification-session/:seq` → `{ submitted: boolean; sdkToken: string | null }`
  - `POST /deposit-transactions/my/:depositNo/verification-session/:seq/submit` → `{ ok: true }`
  - 客户面详情/列表新增 `actions: { seq: number; submittedAt: Date | null }[]`

- [ ] **Step 1: 写失败测试（会话服务）**

把 `deposit-verification-session.service.spec.ts` 整体替换为：

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { DepositVerificationSessionService } from './deposit-verification-session.service';
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import { AuditLogsService } from '../../audit-logging/audit-logs.service';
import { SumsubClient } from '../../identity/onboarding/providers/sumsub/sumsub.client';

const ROW = (over: any = {}) => ({
  id: 'd-1', depositNo: 'DEP1', ownerType: 'CUSTOMER', ownerId: 'cust-1',
  traceId: 't-1', status: 'ACTION_PENDING', slaBreached: false,
  customer: { sumsubApplicantId: 'appl-1' }, ...over,
});
const ACTION = (over: any = {}) => ({
  id: 'a-1', seq: 1, applicantActionId: 'aa-edd-0002',
  externalActionId: 'EXT-EDD-0002', submittedAt: null, ...over,
});

describe('DepositVerificationSessionService', () => {
  let svc: DepositVerificationSessionService;
  let prisma: any; let actions: any; let audit: any; let sumsub: any;

  beforeEach(async () => {
    prisma = { depositTransaction: { findFirst: jest.fn().mockResolvedValue(ROW()) } };
    actions = { findBySeq: jest.fn().mockResolvedValue(ACTION()), submitBySeq: jest.fn().mockResolvedValue({ changed: true, allSubmitted: false }) };
    audit = { recordByActor: jest.fn() };
    sumsub = { createActionSdkToken: jest.fn().mockResolvedValue({ token: 'tok-abc' }) };
    const mod = await Test.createTestingModule({
      providers: [
        DepositVerificationSessionService,
        { provide: PrismaService, useValue: prisma },
        { provide: DepositApplicantActionsService, useValue: actions },
        { provide: AuditLogsService, useValue: audit },
        { provide: SumsubClient, useValue: sumsub },
      ],
    }).compile();
    svc = mod.get(DepositVerificationSessionService);
  });

  it('未提交 → 给 sdkToken；响应体只有两个键', async () => {
    const r = await svc.getSession('cust-1', 'DEP1', 1);
    expect(r).toEqual({ submitted: false, sdkToken: 'tok-abc' });
    expect(Object.keys(r).sort()).toEqual(['sdkToken', 'submitted']);
  });

  // 上一轮的 Critical：actionId 曾出现在响应体里，而 fixture 的 id 是
  // aa-edd-0002——edd = enhanced due diligence，客户开 DevTools 就能反推
  // PEP 判定。这里刻意用那个真实高危 id 造数据，断言它不出现在序列化结果里。
  it('响应体不含任何 action id（用真实高危 id 造数据）', async () => {
    const r = await svc.getSession('cust-1', 'DEP1', 1);
    expect(JSON.stringify(r)).not.toMatch(/aa-edd|EXT-EDD|edd/i);
  });

  it('已提交 → submitted:true 且不再给 token', async () => {
    actions.findBySeq.mockResolvedValue(ACTION({ submittedAt: new Date('2026-08-06') }));
    const r = await svc.getSession('cust-1', 'DEP1', 1);
    expect(r).toEqual({ submitted: true, sdkToken: null });
  });

  // 接口层不可区分规则（粒度从整单降到这一条）：同一条 action，充值单为
  // ACTION_PENDING 与 FROZEN 时响应体必须全等。若不成立，客户开 DevTools
  // 就能问出自己那单被冻了，渲染层防线归零。
  it.each([null, new Date('2026-08-06')])(
    '逐条不可区分：ACTION_PENDING 与 FROZEN 响应体全等（submittedAt=%s）',
    async (submittedAt) => {
      actions.findBySeq.mockResolvedValue(ACTION({ submittedAt }));
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'ACTION_PENDING' }));
      const a = await svc.getSession('cust-1', 'DEP1', 1);
      prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));
      const b = await svc.getSession('cust-1', 'DEP1', 1);
      expect(b).toEqual(a);
    },
  );

  it('seq 不存在 → 与「单子不存在」完全相同的 404', async () => {
    actions.findBySeq.mockResolvedValue(null);
    await expect(svc.getSession('cust-1', 'DEP1', 9)).rejects.toThrow(NotFoundException);
    prisma.depositTransaction.findFirst.mockResolvedValue(null);
    await expect(svc.getSession('cust-1', 'NOPE', 1)).rejects.toThrow(NotFoundException);
  });

  it('submit 恒返 {ok:true}，冻结单也照收', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));
    await expect(svc.submit('cust-1', 'DEP1', 1)).resolves.toEqual({ ok: true });
  });

  it('真落库那次记审计，actor 为 CUSTOMER，metadata 带 seq 与真 id', async () => {
    await svc.submit('cust-1', 'DEP1', 1);
    expect(audit.recordByActor).toHaveBeenCalledTimes(1);
    const [payload, actor] = audit.recordByActor.mock.calls[0];
    expect(actor).toEqual(expect.objectContaining({ actorType: 'CUSTOMER', actorId: 'cust-1' }));
    expect(payload.metadata).toEqual(expect.objectContaining({ seq: 1, actionId: 'aa-edd-0002' }));
  });

  it('幂等重复提交不重复记审计', async () => {
    actions.submitBySeq.mockResolvedValue({ changed: false, allSubmitted: false });
    await svc.submit('cust-1', 'DEP1', 1);
    expect(audit.recordByActor).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-verification-session.service.spec.ts
```

预期：FAIL（`getSession` 只接受两个参数）。

- [ ] **Step 3（前置）：修 `createActionSdkToken`——现签名不支持 applicant action**

`src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts` 的现实现有两个问题，
本任务要用它必须先修：

```ts
    return this.post('/resources/accessTokens/sdk', {
      userId: input.applicantId,      // ← ① 传错字段
      levelName: input.levelName,
      ttlInSecs: input.ttlInSecs ?? 600,
    });                               // ← ② 缺 externalActionId
```

① 按 Sumsub 官方定义，`userId` 是「**你那边**的客户标识，对应 applicant 的
`externalUserId`」，而 `applicantId` 是 Sumsub 侧 id——两者不是一个东西
（实测：`applicantId=6a5de866…` vs `externalUserId=SHAWN-AML-A-04`）。传错会绑到
错的（或新建的）applicant。
② 官方对 `externalActionId` 的说明原文：*"⚠️ It is **required** when you generate an
access token for applicant actions."* 缺它这个场景直接不成立。

两个问题现在都被 `SUMSUB_MOCK_MODE=true` 的假返回盖住，真接必炸。改为：

```ts
  async createActionSdkToken(input: {
    applicantId: string;
    levelName: string;
    externalActionId: string;
    ttlInSecs?: number;
  }): Promise<{ token: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      // ⚠️ 占位 token **不得**嵌入 externalActionId：demo fixture 的值形如
      // `EXT-EDD-0002`，`EDD`（enhanced due diligence）会随 token 一路下发到
      // 客户端，等于把上一轮封掉的 PEP 那 1 比特换个载体又漏出去。用不可逆
      // 摘要，既保持"同一条 action 拿到同一个 token"又不携带原文。
      const digest = createHash('sha256').update(input.externalActionId).digest('hex').slice(0, 16);
      return { token: `mock-sdk-token-${digest}` };
    }
    return this.post('/resources/accessTokens/sdk', {
      // applicantId 是 Sumsub 侧 id，必须走这个字段；userId 是我方 externalUserId，
      // 两者不可混用（此前传的是 userId: applicantId，会绑到错的 applicant）。
      applicantId: input.applicantId,
      levelName: input.levelName,
      // applicant action 场景官方必填。
      externalActionId: input.externalActionId,
      ttlInSecs: input.ttlInSecs ?? 600,
    });
  }
```

`createHash` 从 `crypto` import（该文件已 import `createHmac`/`timingSafeEqual`，加进同一行即可）。

改完后 grep 既有调用方并补齐新必填参数：

```bash
grep -rn "createActionSdkToken" src --include="*.ts" | grep -v sumsub.client.ts
```

`material-refresh-cycles.controller.ts` 是唯一调用方，它有 `cycle.sumsubActionId`，
把它作为 `externalActionId` 传入即可（该流程的 action 由我方 `createApplicantAction`
创建，两个 id 同源）。

- [ ] **Step 3: 实现会话服务**

把 `deposit-verification-session.service.ts` 的 `VerificationSessionView`、`mustFindOwn`、`getSession`、`submit` 替换为：

```ts
/**
 * 客户面能看到的全部内容。**只有这两个键。**
 *
 * **不含 action id（上一轮的 Critical，勿加回来）**：demo fixture 的
 * `applicantActionId` 本身携带信息——PEP 场景是 `aa-edd-0002`、非 PEP 是
 * `aa-sof-0001`。客户开 DevTools 看 `edd`（enhanced due diligence）就能
 * 反推 PEP 判定。前端不需要它：定位一条 action 用 `seq`，服务端自己查表
 * 换真 id 去铸 token。
 *
 * **不含 materialKind**：`manualReason` 值域只有两个值，映射成两个
 * materialKind 是双射，"是不是 PEP" 这 1 比特被无损保留，等于没脱敏。
 * 客户要交什么由验证组件自己告诉他。
 */
export interface VerificationSessionView {
  submitted: boolean;
  sdkToken: string | null;
}

  private async mustFindOwn(customerId: string, depositNo: string) {
    const row = await (this.prisma as any).depositTransaction.findFirst({
      where: { depositNo, ownerId: customerId, limitHoldReason: null },
      select: {
        id: true, depositNo: true, ownerType: true, ownerId: true,
        traceId: true, status: true, slaBreached: true,
        customer: { select: { sumsubApplicantId: true } },
      },
    });
    if (!row) throw new NotFoundException('Deposit not found');
    return row;
  }

  /**
   * 响应体只由**这一条 action** 的 submittedAt 决定，绝不由充值单 status 决定。
   * seq 不存在时抛与「单子不存在」完全相同的 404——不给新的探测面。
   */
  async getSession(
    customerId: string,
    depositNo: string,
    seq: number,
  ): Promise<VerificationSessionView> {
    const row = await this.mustFindOwn(customerId, depositNo);
    const action = await this.applicantActions.findBySeq(row.id, seq);
    if (!action) throw new NotFoundException('Deposit not found');

    if (action.submittedAt) return { submitted: true, sdkToken: null };

    // applicantId 必须是**客户的** sumsubApplicantId，不是充值单 id。
    const applicantId = row.customer?.sumsubApplicantId;
    if (!applicantId) return { submitted: false, sdkToken: null };

    const { token } = await this.sumsubClient.createActionSdkToken({
      applicantId,
      levelName: SUMSUB_ACTION_LEVEL,
      externalActionId: action.externalActionId,
    });
    return { submitted: false, sdkToken: token };
  }

  /** 幂等、恒 2xx、不碰状态机。冻结单上提交照收——返错误码等于告诉对方"你这单不一样了"。 */
  async submit(customerId: string, depositNo: string, seq: number): Promise<{ ok: true }> {
    const row = await this.mustFindOwn(customerId, depositNo);
    const action = await this.applicantActions.findBySeq(row.id, seq);
    if (!action) throw new NotFoundException('Deposit not found');

    const deadline = new Date(Date.now() + PROVIDER_REVIEW_SLA_DAYS * 24 * 60 * 60 * 1000);
    const resetSla =
      row.status === DepositTransactionStatus.ACTION_PENDING && !row.slaBreached;

    const { changed, allSubmitted } = await this.applicantActions.submitBySeq(
      row.id, seq, deadline, resetSla,
    );

    if (changed) {
      await this.auditLogs.recordByActor(
        {
          action: AuditActions.DEPOSIT_ACTION_SUBMITTED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: row.id,
          entityNo: row.depositNo,
          entityOwnerType: row.ownerType,
          entityOwnerId: row.ownerId,
          traceId: row.traceId || undefined,
          workflowType: 'DEPOSIT',
          reason: allSubmitted
            ? 'Customer submitted the last outstanding applicant action; all materials received'
            : 'Customer submitted one applicant action; others still outstanding',
          metadata: {
            seq,
            // 审计是 operator 面，必须带真 id 否则对不上 Sumsub 后台。
            // 与客户面正好相反——别看混。
            actionId: action.applicantActionId,
            allSubmitted,
            ...(allSubmitted && resetSla && { slaDeadline: deadline }),
          },
          sourcePlatform: 'CUSTOMER_API',
        },
        { actorType: 'CUSTOMER', actorId: customerId, actorRole: 'CUSTOMER' },
      );
    }
    return { ok: true };
  }
```

构造函数改为（DI 注入，禁止 `new`）：

```ts
  constructor(
    private readonly prisma: PrismaService,
    private readonly applicantActions: DepositApplicantActionsService,
    private readonly auditLogs: AuditLogsService,
    private readonly sumsubClient: SumsubClient,
  ) {}
```

文件顶部加常量与 import：

```ts
import { DepositApplicantActionsService } from './deposit-applicant-actions.service';
import { SumsubClient } from '../../identity/onboarding/providers/sumsub/sumsub.client';

/** 补料 action 走的验证等级。真接 Sumsub 时按租户配置调整。 */
const SUMSUB_ACTION_LEVEL = 'basic-kyc-level';
```

`SumsubClient` 由 `OnboardingModule` 导出（`onboarding.module.ts` 的 `exports` 里已有），
按**类**注入即可，不要新造字符串 token。在 `deposit-transactions.module.ts` 的 `imports`
里加 `forwardRef(() => OnboardingModule)`（与 `tier-upgrade-case.module.ts` 同写法，
该文件注释已标明「provides SumsubClient」）。

- [ ] **Step 4: 详情响应加 actions**

`deposit-transactions.service.ts` 的 `toCustomerDepositView` 末尾加一行，并在 `findAll`/`findOneForCustomer` 的 `include` 里带上关联：

```ts
      // 客户面白名单再开一个口（与当初开 actionSubmittedAt 同等对待）。
      // **只有 seq 与 submittedAt 两个键**——无 id、无类型、无理由。够画那个
      // 列表和各自状态，多一个字段都是风险面（上一轮的 Critical 正是这么来的）。
      actions: (item.applicantActions ?? []).map((a: any) => ({
        seq: a.seq,
        submittedAt: a.submittedAt,
      })),
```

`include` 里加：

```ts
          applicantActions: { select: { seq: true, submittedAt: true }, orderBy: { seq: 'asc' } },
```

并在 `deposit-transactions.service.spec.ts` 的 tipping-off 白名单精确断言里，把 `actions: []` 加进期望对象（**必须显式加，不能改成 objectContaining**——白名单开口子要是显式决定，不能悄悄混过去）。

- [ ] **Step 4b: 删掉被取代的两个方法（自 Task 3 移交）**

本任务把 `deposit-verification-session.service.ts` 改成走 `findBySeq`/`submitBySeq`
之后，`setActionRefs` / `markActionSubmitted` 才真正没有调用方（Task 3 已让
`deposit-workflow.service.ts` 不再调它们）。现在删：

从 `deposit-transactions.service.ts` 删除这两个方法及其注释块，并删除
`deposit-transactions.service.spec.ts` 里针对它们的既有测试块（测的是已删除的代码）。

全仓确认无残留调用方：

```bash
grep -rn "setActionRefs\|markActionSubmitted" src client-web/src test | grep -v node_modules
```

预期：**无输出**。若仍有命中，说明还有本计划没覆盖到的调用点——停下报告，不要
擅自改那个文件。

- [ ] **Step 5: controller 路由加 :seq**

`deposit-transactions.controller.ts` 里两条路由改为：

```ts
  @Get('my/:depositNo/verification-session/:seq')
  getMyVerificationSession(
    @Req() req: any,
    @Param('depositNo') depositNo: string,
    @Param('seq', ParseIntPipe) seq: number,
  ) {
    return this.verificationSessionService.getSession(req.user.userId, depositNo, seq);
  }

  @Post('my/:depositNo/verification-session/:seq/submit')
  submitMyVerification(
    @Req() req: any,
    @Param('depositNo') depositNo: string,
    @Param('seq', ParseIntPipe) seq: number,
  ) {
    return this.verificationSessionService.submit(req.user.userId, depositNo, seq);
  }
```

`ParseIntPipe` 从 `@nestjs/common` import。

- [ ] **Step 6: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions src/modules/deposit-sumsub
npx tsc --noEmit -p .
```

- [ ] **Step 7: 变异验证——确认「逐条不可区分」真能抓**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/trading/deposit-transactions/deposit-verification-session.service.ts')
s = p.read_text()
old = "    if (action.submittedAt) return { submitted: true, sdkToken: null };"
new = "    if (action.submittedAt) return { submitted: true, sdkToken: row.status === 'FROZEN' ? 'x' : null }; // MUTATION"
assert s.count(old) == 1, f"替换串不唯一/对不上: {s.count(old)}"
p.write_text(s.replace(old, new)); print("变异已写入")
PY
npx jest src/modules/trading/deposit-transactions/deposit-verification-session.service.spec.ts -t "逐条不可区分"
```

预期：**变红**。还原：

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/trading/deposit-transactions/deposit-verification-session.service.ts')
s = p.read_text()
old = "    if (action.submittedAt) return { submitted: true, sdkToken: row.status === 'FROZEN' ? 'x' : null }; // MUTATION"
new = "    if (action.submittedAt) return { submitted: true, sdkToken: null };"
assert s.count(old) == 1, f"还原串对不上: {s.count(old)}"
p.write_text(s.replace(old, new)); print("已还原")
PY
npx jest src/modules/trading/deposit-transactions
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/trading/deposit-transactions/
git commit -m "feat(deposit): 会话接口按 seq 取,详情加 actions(只 seq+submittedAt)"
```

---

## Task 5: 详情独立页 + 删弹窗

**Files:**
- Create: `client-web/src/pages/DepositDetail.tsx`
- Modify: `client-web/src/pages/Deposit.tsx`（删弹窗、行点击改 navigate）
- Modify: `client-web/src/App.tsx`

**Interfaces:**
- Consumes: Task 4 的详情响应（含 `actions`）
- Produces: 路由 `/deposit/:depositNo`

- [ ] **Step 1: 加路由**

`App.tsx` 的 `CustomerDashboardLayout` 组内，`/deposit` 那行下面加：

```tsx
                 <Route path="/deposit/:depositNo" element={<AuthGuard><DepositDetail /></AuthGuard>} />
```

并加 lazy import（与既有页面同写法）：

```tsx
const DepositDetail = lazy(() => import('./pages/DepositDetail'));
```

- [ ] **Step 2: 建详情页**

新建 `client-web/src/pages/DepositDetail.tsx`：

```tsx
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { getDepositStatusView } from '../utils/depositStatusView';

interface ActionRow { seq: number; submittedAt: string | null }
interface DepositDetailData {
  depositNo: string; status: string; amount: string;
  createdAt: string; completedAt: string | null;
  txHash: string | null; referenceNo: string | null;
  fromAddress: string | null; fromIban: string | null;
  actionSubmittedAt: string | null;
  actions: ActionRow[];
  asset: { code: string; currency: string; network: string | null; decimals: number } | null;
}

const DepositDetail = () => {
  const { depositNo } = useParams();
  const navigate = useNavigate();
  const [tx, setTx] = useState<DepositDetailData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await customerFetch(
          `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}`,
        );
        if (!r.ok) throw new Error('not found');
        const d = await r.json();
        if (alive) setTx(d);
      } catch {
        if (alive) setErr('This deposit is not available.');
      }
    })();
    return () => { alive = false; };
  }, [depositNo]);

  if (err) return <div className="p-6 text-fx-dust">{err}</div>;
  if (!tx) return <div className="p-6 text-fx-dust">Loading…</div>;

  // 徽章与文案必须与列表页走同一条路径（连 submitted 一起传）——只传 status
  // 的话，已提交的 ACTION_PENDING 在这里显示 ACTION REQUIRED、在列表显示
  // PROCESSING，同一笔单两处说法不一；且该单被冻时这里的标签会变。
  const view = getDepositStatusView(tx.status, { submitted: !!tx.actionSubmittedAt });
  const outstanding = tx.actions.filter((a) => !a.submittedAt);

  return (
    <div className="p-6 max-w-4xl">
      <button onClick={() => navigate('/deposit')} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Deposits
      </button>

      <div className="flex items-start justify-between gap-4 pb-6 border-b border-fx-rule">
        <div>
          <div className="text-3xl font-bold text-fx-sand">
            {tx.amount} <span className="text-lg text-fx-dust">{tx.asset?.code}</span>
          </div>
          <div className="font-mono text-xs text-fx-dust mt-1">
            {tx.depositNo}{tx.asset?.network ? ` · ${tx.asset.network}` : ''}
          </div>
        </div>
        <span className="rounded-xl px-3 py-1 text-xs font-semibold border border-fx-rule text-fx-sand">
          {view.label}
        </span>
      </div>

      {tx.actions.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-fx-sand mb-3">Outstanding verification</h2>
          <div className="space-y-2">
            {tx.actions.map((a) => (
              <div key={a.seq} className="flex items-center gap-3 rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-3">
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-fx-sand">Document request {a.seq}</div>
                  <div className="text-xs text-fx-dust">
                    {a.submittedAt ? 'Received · under review' : 'Awaiting your documents'}
                  </div>
                </div>
                {!a.submittedAt && (
                  <button
                    onClick={() => navigate(`/deposit/${tx.depositNo}/verification/${a.seq}`)}
                    className="rounded-xl border border-fx-brass/40 bg-fx-brass/10 px-4 py-2 text-sm font-semibold text-fx-brass hover:bg-fx-brass/20"
                  >
                    Provide documents
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-fx-sand mb-3">Details</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Submitted" value={new Date(tx.createdAt).toLocaleString()} />
          <Field label="Reference" value={tx.referenceNo || '—'} mono />
          {tx.completedAt && <Field label="Completed" value={new Date(tx.completedAt).toLocaleString()} />}
          {tx.fromAddress && <Field label="From address" value={tx.fromAddress} mono wide />}
          {tx.fromIban && <Field label="From IBAN" value={tx.fromIban} mono wide />}
          {tx.txHash && <Field label="Transaction hash" value={tx.txHash} mono wide />}
        </dl>
      </section>
    </div>
  );
};

const Field = ({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) => (
  <div className={`rounded-xl bg-fx-charcoal/40 px-4 py-3 ${wide ? 'sm:col-span-2' : ''}`}>
    <dt className="text-xs text-fx-dust">{label}</dt>
    <dd className={`text-sm text-fx-sand mt-1 break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
  </div>
);

export default DepositDetail;
```

- [ ] **Step 3: 后端补单条详情端点（若不存在）**

确认 `GET /deposit-transactions/my/:depositNo` 存在：

```bash
grep -n "my/:depositNo'" src/modules/trading/deposit-transactions/deposit-transactions.controller.ts
```

若无，加一条（走 `findOneForCustomer`，与列表同一映射函数，故自动享有 status 收敛与白名单）：

```ts
  @Get('my/:depositNo')
  getMyDeposit(@Req() req: any, @Param('depositNo') depositNo: string) {
    return this.depositTransactionsService.findOneForCustomer(req.user.userId, depositNo);
  }
```

⚠️ 这条必须声明在 `my/:depositNo/verification-session/:seq` **之后**，否则会抢占该路由。

- [ ] **Step 4: 删弹窗、行点击改跳转**

`Deposit.tsx` 里：删除 `selectedTx` state、整个 `{selectedTx && (…)}` 弹窗块、`renderStatusDetail`、以及所有 `openVerification`/`embedOpen`/`session` 相关 state 与函数。历史行的 `onClick` 改为：

```tsx
                        onClick={() => navigate(`/deposit/${tx.depositNo}`)}
```

删掉因此变成孤儿的 import（`X` 图标、`MockVerification` 相关等）。用 tsc 找孤儿：

```bash
cd client-web && npx tsc -b --force
```

- [ ] **Step 5: 渲染验收**

后端先重建重启：

```bash
lsof -ti:3100 | xargs kill 2>/dev/null; sleep 2
npm run build && (nohup node dist/main > /tmp/exchange_js_runtime_wt_deposit_action_embed/backend.log 2>&1 &)
sleep 8
```

在 http://localhost:3102 以 `demo_alice@example.com` / `123456` 登录，逐条确认并截图：

1. Deposit → History 点任一行 → **跳转到 `/deposit/DEPxxxx`，侧栏仍在**（不是弹窗）
2. `ACTION_PENDING` 且有 action 的单 → 出现 `Outstanding verification` 区块，每条一张卡带 `Provide documents`
3. 已提交的那条 → **无按钮**，文案 `Received · under review`
4. 普通 `SUCCESS` 单 → **不出现** `Outstanding verification` 区块
5. 页面文案零中文、无 `sanction|seiz|frozen|freeze|confiscat|enforcement|government|police`

- [ ] **Step 6: Commit**

```bash
git add client-web/src/pages/DepositDetail.tsx client-web/src/pages/Deposit.tsx client-web/src/App.tsx src/modules/trading/deposit-transactions/deposit-transactions.controller.ts
git commit -m "feat(client): 充值详情改独立页,列表弹窗删除"
```

---

## Task 6: 认证独立页 + 删 /mock-verification

**Files:**
- Create: `client-web/src/pages/DepositVerification.tsx`
- Delete: `client-web/src/pages/MockVerification.tsx`
- Modify: `client-web/src/App.tsx`

**Interfaces:**
- Consumes: Task 4 的 `GET/POST …/verification-session/:seq`
- Produces: 路由 `/deposit/:depositNo/verification/:seq`

- [ ] **Step 1: 建认证页**

新建 `client-web/src/pages/DepositVerification.tsx`：

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { customerFetch } from '../utils/customerFetch';
import { useSimulationMode } from '../utils/simulationMode';

const DepositVerification = () => {
  const { depositNo, seq } = useParams();
  const navigate = useNavigate();
  const simulation = useSimulationMode();
  const [token, setToken] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    setState('loading');
    try {
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/${seq}`,
      );
      if (!r.ok) throw new Error('session failed');
      const s = await r.json();
      setSubmitted(s.submitted);
      setToken(s.sdkToken);
      setState('ready');
    } catch {
      setState('error');
    }
  };

  useEffect(() => { void load(); }, [depositNo, seq]);

  // 真接 Sumsub：token 到手后由 SDK 自己往容器里塞 iframe。
  // demo 模式不走这条——见下方的假上传组件。
  useEffect(() => {
    if (simulation || !token || submitted || !containerRef.current) return;
    const sdk = (window as any).snsWebSdk;
    if (!sdk) { setState('error'); return; }
    const inst = sdk
      .init(token, () => Promise.resolve(token))
      .withOptions({ addViewportTag: false, adaptIframeHeight: true })
      .on('idCheck.onReady', () => setState('ready'))
      .on('idCheck.onApplicantSubmitted', () => { void doSubmit(); })
      .on('idCheck.onError', () => setState('error'))
      .build();
    inst.launch('#sumsub-container');
    return () => { if (containerRef.current) containerRef.current.innerHTML = ''; };
  }, [simulation, token, submitted]);

  const doSubmit = async () => {
    setBusy(true);
    try {
      await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/${seq}/submit`,
        { method: 'POST' },
      );
      navigate(`/deposit/${depositNo}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => navigate(`/deposit/${depositNo}`)} className="flex items-center gap-2 text-sm text-fx-dust hover:text-fx-brass mb-6">
        <ArrowLeft size={16} /> Deposit {depositNo}
      </button>

      <h1 className="text-xl font-bold text-fx-sand mb-1">Document request {seq}</h1>
      <p className="text-sm text-fx-dust mb-6">Provide the requested documents to continue.</p>

      {submitted ? (
        <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-4 py-4 text-sm text-fx-dust">
          We have received your information and it is being reviewed.
        </div>
      ) : state === 'error' ? (
        <div className="rounded-xl border border-fx-rust/30 bg-fx-rust/5 px-4 py-4">
          <p className="text-sm text-fx-rust mb-3">Verification failed to load.</p>
          <button onClick={() => void load()} className="fx-btn-ghost">Retry</button>
        </div>
      ) : simulation ? (
        <MockUploader busy={busy} onSubmit={() => void doSubmit()} />
      ) : (
        <div className="relative min-h-[600px]">
          <div id="sumsub-container" ref={containerRef} />
          {state === 'loading' && (
            <div className="absolute inset-0 grid place-items-center text-sm text-fx-dust">
              Loading verification…
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/** 演示用的假上传界面。真接 Sumsub 时这块由 SDK 渲染，本组件不参与。 */
const MockUploader = ({ busy, onSubmit }: { busy: boolean; onSubmit: () => void }) => (
  <div className="rounded-xl border border-fx-rule bg-fx-charcoal/40 px-6 py-8">
    <div className="border border-dashed border-fx-rule rounded-xl px-6 py-10 text-center text-sm text-fx-dust mb-6">
      Drag a file here, or browse
    </div>
    <button onClick={onSubmit} disabled={busy} className="fx-btn-primary w-full disabled:opacity-50">
      {busy ? 'Submitting…' : 'Submit documents'}
    </button>
  </div>
);

export default DepositVerification;
```

- [ ] **Step 2: 改路由、删旧页**

`App.tsx`：删掉 `/mock-verification` 那条 `<Route>` 与它的 import；在 `/deposit/:depositNo` 下面加：

```tsx
                 <Route path="/deposit/:depositNo/verification/:seq" element={<AuthGuard><DepositVerification /></AuthGuard>} />
```

加 lazy import：

```tsx
const DepositVerification = lazy(() => import('./pages/DepositVerification'));
```

删文件：

```bash
rm client-web/src/pages/MockVerification.tsx
grep -rn "MockVerification\|mock-verification" client-web/src src | grep -v node_modules
```

预期：无输出。

- [ ] **Step 3: 类型检查**

```bash
cd client-web && npx tsc -b --force && npm test
```

预期：0 错；既有 76 条测试仍全绿。

- [ ] **Step 4: 渲染验收**

后端重建重启后，在 http://localhost:3102 确认：

1. 详情页点某条的 `Provide documents` → **跳到 `/deposit/DEPxxxx/verification/1`,侧栏仍在**
2. 演示模式下出现假上传界面 + `Submit documents`
3. 点提交 → 跳回详情页,该条变成 `Received · under review` 且**无按钮**
4. 直接访问一个不存在的 seq（例如 `/verification/9`）→ 显示错误与 Retry,不白屏
5. 文案零中文、无禁用词

- [ ] **Step 5: Commit**

```bash
git add client-web/src/pages/DepositVerification.tsx client-web/src/App.tsx
git rm client-web/src/pages/MockVerification.tsx
git commit -m "feat(client): 认证改独立页(token 内嵌),删 /mock-verification 独立路由"
```

---

## Task 7: 多条 fixture + e2e + 文档 + 硬闸

**Files:**
- Modify: `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts`
- Modify: `test/deposit-sumsub-verdicts.e2e-spec.ts`
- Modify: `doc-final/reference/truth/v4-deposit.md`
- Modify: `doc-final/BACKLOG.md`

- [ ] **Step 1: 加三条 action 的裁决按钮**

`verdict-buttons.ts` 末尾加：

```ts
  V10_AWAIT_USER_MULTI: {
    key: 'V10_AWAIT_USER_MULTI',
    label: '⑩ Awaiting user · 多条',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: {
      reviewStatus: 'awaitingUser',
      reviewAnswer: null,
      action: 'awaitUser',
      score: 45,
      matchedRules: [
        RULE('KYC9', 'Multiple documents required', 45, 'awaitUser', 'Several items required from the applicant.'),
      ],
      // 三条一次性下发,用于验证"点哪条看哪条"以及"交完前两条徽章仍是
      // ACTION REQUIRED、交完第三条才切已收到"。
      applicantActions: [
        { applicantActionId: 'aa-multi-0001', externalActionId: 'EXT-MULTI-0001' },
        { applicantActionId: 'aa-multi-0002', externalActionId: 'EXT-MULTI-0002' },
        { applicantActionId: 'aa-multi-0003', externalActionId: 'EXT-MULTI-0003' },
      ],
    },
  },
```

- [ ] **Step 2: e2e 加两条**

在 `test/deposit-sumsub-verdicts.e2e-spec.ts` 里加：

```ts
  it('多条 action：交完前两条仍 ACTION REQUIRED，交完第三条才算全部交齐', async () => {
    const dep = await seedDepositAt('COMPLIANCE_PENDING');
    await runVerdict(dep.id, 'V10_AWAIT_USER_MULTI');

    const detail1 = await getMy(dep.depositNo);
    expect(detail1.actions.map((a: any) => a.seq)).toEqual([1, 2, 3]);
    expect(detail1.actionSubmittedAt).toBeNull();

    await submitSeq(dep.depositNo, 1);
    await submitSeq(dep.depositNo, 2);
    const detail2 = await getMy(dep.depositNo);
    expect(detail2.actionSubmittedAt).toBeNull();          // 还没交齐

    await submitSeq(dep.depositNo, 3);
    const detail3 = await getMy(dep.depositNo);
    expect(detail3.actionSubmittedAt).not.toBeNull();      // 交齐了
  });

  it('逐条不可区分：同一条 action 在 ACTION_PENDING 与 FROZEN 下会话响应体全等', async () => {
    const dep = await seedDepositAt('COMPLIANCE_PENDING');
    await runVerdict(dep.id, 'V10_AWAIT_USER_MULTI');
    await submitSeq(dep.depositNo, 1);

    const before = await getSession(dep.depositNo, 1);
    await freezeViaAdmin(dep.id);                          // 走真实 admin 接口
    const after = await getSession(dep.depositNo, 1);

    expect(after).toEqual(before);
  });
```

（`seedDepositAt` / `runVerdict` / `getMy` / `submitSeq` / `getSession` / `freezeViaAdmin` 沿用该文件既有的同名 helper；若某个不存在，照既有 helper 的写法补一个，**不要**改动它们连接的 DB。）

- [ ] **Step 3: 跑 e2e**

先确认库路径含 `e2e-`：

```bash
grep -n "process.env.DATABASE_URL = " test/deposit-sumsub-verdicts.e2e-spec.ts
npx jest --config test/jest-e2e.json test/deposit-sumsub-verdicts.e2e-spec.ts
```

预期：18/18（既有 16 + 新 2）。

- [ ] **Step 4: 同步 truth 文档**

`doc-final/reference/truth/v4-deposit.md` 的 §4.6 里，把「单条 action」的描述改为多条，写清：

- 子表 `deposit_applicant_actions`（每条自带 `submittedAt`）
- 充值单 `actionSubmittedAt` 语义为「**全部**交齐的时刻」，是缓存不是真相
- 客户面只见 `seq`，接口与 URL 一律用它；action id 永不下发
- 会话接口路径带 `:seq`
- Sumsub 撤回未提交 action 时我方同步删除（防客户永久卡死）

只写「现在是什么样」。改之前先通读该节，别新增段落把已有描述架空。

- [ ] **Step 5: BACKLOG 登记**

`doc-final/BACKLOG.md` 加两条：

```markdown
- 【充值补料】action 的人话标签：现只显示 `Document request N`。Sumsub 报文只给两个 id，
  `externalActionId` 前缀（如 `paymentMethod-`）虽透露类型但无契约保证；要拿可靠类型需
  额外调 `GET /resources/applicantActions/{id}/one`。2026-08-06 业主定稿先只给序号
  （按前缀猜标签等于把已封掉的 PEP 那 1 比特从后门放回来）。
- 【充值补料】真接 Sumsub 时 `SUMSUB_ACTION_LEVEL` 需按租户实际等级名配置，
  现为硬编码占位（`deposit-verification-session.service.ts`）。
- 【充值补料】`DepositApplicantAction` 上 `@@index([depositTransactionId, seq])` 与
  `@@unique([depositTransactionId, seq])` 完全冗余（已用 sqlite3 确认磁盘上两个索引
  并存），每次 insert/delete 多维护一棵无查询收益的 B-tree。删除需要一次纯 DROP INDEX
  迁移，2026-08-06 未授权清理故保留。
```

- [ ] **Step 6: 四道硬闸**

```bash
npx tsc --noEmit -p .
npx jest src/modules/trading/deposit-transactions src/modules/deposit-sumsub
npx jest --config test/jest-e2e.json test/deposit-sumsub-verdicts.e2e-spec.ts
(cd client-web && npx tsc -b --force && npm test)
npx jest 2>&1 | tail -6
```

判定口径：前四条必须全绿；最后一条 jest 全量以「**净新增失败数 = 0**」为准——已知 `src/modules/asset-treasury/wallets` 有 4 条既有失败（在干净 main 上同样失败，已核实），不在本轮范围。

- [ ] **Step 7: 渲染验收（多条那条最重要）**

后端重建重启后，用 ⑩ 裁决按钮造一笔三条 action 的单，逐条确认：

1. 详情页出现 3 张卡，各自带按钮
2. 点第 2 张 → 进 `/verification/2`，与第 1 张是不同页面
3. 交完第 1、2 条 → 徽章**仍是** `ACTION REQUIRED`，仍落 `ACTION_REQUIRED` 桶
4. 交完第 3 条 → 徽章切 `PROCESSING` + 「已收到」，落 `PROCESSING` 桶
5. **冻结验收必须走真实 admin 接口**（`PATCH :id/status` → `adminFreeze` → `updateStatus`），不得直接改库——上一轮正是因为改库绕过 `updateStatus`，`completedAt` 从未被写，验收方法自己把洞盖住了

- [ ] **Step 8: Commit**

```bash
git add src/modules/deposit-sumsub/fixtures/verdict-buttons.ts test/deposit-sumsub-verdicts.e2e-spec.ts doc-final/
git commit -m "feat(deposit): 多条 action fixture + e2e + truth/BACKLOG 同步"
```

---

## 自查清单（执行完全部任务后逐条核对）

- [ ] 客户面任何响应体（列表 / 详情 / 会话 / scan）都搜不到 `applicantActionId` / `externalActionId` / `aa-` / `EXT-`
- [ ] `grep -rn "setActionRefs\|markActionSubmitted" src client-web/src test` 无输出
- [ ] `grep -rn "MockVerification\|mock-verification" src client-web/src` 无输出
- [ ] `getDepositStatusView` 的所有调用点都传了 `{ submitted }`
- [ ] 三条本轮特有守卫（绑死两种表示 / 逐条不可区分 / 集合比对三情况）都做过变异验证且见过红灯
- [ ] 迁移是纯建表，无 `_new` 重建
