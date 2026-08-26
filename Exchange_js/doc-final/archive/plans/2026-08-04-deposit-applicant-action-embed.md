# 充值 applicant action 客户端交互 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 `ACTION_PENDING` 的充值单在客户端可操作——详情弹窗展示中性材料文案 + 认证入口，点击后在详情区内嵌认证界面；客户提交只改展示与 SLA 计时，不动状态机。

**Architecture:** 裁决管道把 Sumsub 的 `applicantActions[]` 透传到充值单三个新字段；新增两个客户面端点（取会话 / 提交），二者服从与渲染层同一条「不可区分」规则；客户端视图层的「已收到」文案绑 `actionSubmittedAt` 而非 status，堵住冻结时文案消失的可观测口；认证界面位置定义为空容器（stage），演示放 mock 页，将来换真 WebSDK 不动前端结构。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest ｜ React + Vite + Vitest ｜ Sumsub KYT webhook（`SUMSUB_MOCK_MODE=true`）

**设计依据：** `doc-final/superpowers/specs/2026-08-04-deposit-applicant-action-embed-design.md`

## Global Constraints

- `SUMSUB_MOCK_MODE=true` 保持不变，本轮**不接真实 Sumsub**。
- **不新增客户驱动的状态机边**。客户提交绝不调用 `updateStatus`。
- **不建 http/mock 双实现抽象层**（被否的「丙」方案）。
- SLA 时长保持 **7 天**（`ACTION_SLA_DAYS`/`ONHOLD_SLA_DAYS` 数值不动，只换语义）。
- 客户面 JSON **绝不含** `manualReason` / `sumsub*` / `limitHoldReason` / `slaDeadline` / `slaBreached` / `statusHistory`。唯一新开的口子是 `actionSubmittedAt`。
- 客户面文案 **零中文**，全英文。
- 客户面文案**绝不出现** sanction / seiz / frozen / freeze / confiscat / enforcement / government / police 字样。
- 变异测试**禁用 perl**（`\Q…\E` 会把 `\n` 当字面反斜杠 n，导致文件未被修改而误判为绿）。一律用 python。
- 每个任务结束提交一次，commit message 用中文，说清"改了什么 + 为什么"。
- 工作树：本计划在 `.claude/worktrees/<名字>/` 独立工作树内执行，服务用 `bash scripts/stack.sh up`（self 栈）。

---

## File Structure

| 文件 | 责任 | 任务 |
|---|---|---|
| `prisma/schema.prisma` | `DepositTransaction` 加三字段 | T1 |
| `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` | 三字段读写方法 + 客户面白名单开口 | T1, T4 |
| `src/modules/deposit-sumsub/sumsub-txn.types.ts` | `SumsubTxnDetail` 加 `applicantActions` | T2 |
| `src/modules/deposit-sumsub/sumsub-txn-client.mock.ts` / `.http.ts` | 解析 `applicantActions` | T2 |
| `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts` | 透传 `applicantActions` | T2 |
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | `applyKytAwaitUser` 落字段 + 修早退 | T2 |
| `src/modules/deposit-sumsub/deposit-sla.service.ts` | breach 理由按提交戳分岔 | T3 |
| `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts` | 两个客户面端点 | T4 |
| `src/modules/trading/deposit-transactions/deposit-verification-session.service.ts` | **新建**：会话取用 + 提交（不可区分规则的唯一实现处） | T4 |
| `client-web/src/utils/depositStatusView.ts` | 视图签名加 `submitted`，三展示态 | T5 |
| `client-web/src/pages/Deposit.tsx` | 弹窗两尺寸 + 容器 stage + `Transaction` 接口 | T6 |
| `client-web/src/pages/MockVerification.tsx` | **新建**：mock 认证页（无后台外壳） | T6 |
| `client-web/src/App.tsx` | 新路由 `/mock-verification` | T6 |
| `admin-web/src/pages/DepositTransactionDetail.tsx` | 两行只读 | T7 |
| `test/deposit-sumsub-verdicts.e2e-spec.ts` | 完整弧 + 接口不可区分 | T7 |

---

## Task 1: schema 三字段 + service 读写

**Files:**
- Modify: `prisma/schema.prisma`（`model DepositTransaction`）
- Create: `prisma/migrations/<timestamp>_deposit_applicant_action/migration.sql`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

**Interfaces:**
- Produces（T2/T4 依赖）：
  - `setActionRefs(id: string, actionId: string, externalActionId: string, slaDeadline: Date): Promise<any>` — 写两个 id、**清空** `actionSubmittedAt`、重置 `slaDeadline`、`slaBreached=false`
  - `markActionSubmitted(id: string, slaDeadline: Date): Promise<{ changed: boolean }>` — 幂等：已有 `actionSubmittedAt` 则不覆写、返回 `changed:false`

- [ ] **Step 1: 加 schema 字段**

在 `prisma/schema.prisma` 的 `model DepositTransaction` 里，`slaBreached` 那一行下面加：

```prisma
  sumsubActionId          String?
  sumsubExternalActionId  String?
  actionSubmittedAt       DateTime?
```

- [ ] **Step 2: 生成迁移并验证是纯加列**

```bash
npx prisma migrate dev --name deposit_applicant_action --create-only
```

打开生成的 `migration.sql`，**确认只有 `ALTER TABLE ... ADD COLUMN`，没有表重建（`_new` 模式）**。三个字段都可空，SQLite 加可空列不需要重建表。若出现表重建，停下来报告——说明 schema 被别的改动污染了。

- [ ] **Step 3: 应用迁移 + 重新生成 client**

```bash
npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 4: 写失败测试**

在 `deposit-transactions.service.spec.ts` 末尾加：

```ts
describe('applicant action 字段读写', () => {
  const DEADLINE = new Date('2026-08-11T00:00:00Z');

  it('setActionRefs 写两个 id、清提交戳、重置 SLA', async () => {
    ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({});

    await service.setActionRefs('d-1', 'aa-1', 'EXT-1', DEADLINE);

    expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith({
      where: { id: 'd-1' },
      data: {
        sumsubActionId: 'aa-1',
        sumsubExternalActionId: 'EXT-1',
        actionSubmittedAt: null,
        slaDeadline: DEADLINE,
        slaBreached: false,
      },
    });
  });

  it('markActionSubmitted 首次盖戳并重置 SLA', async () => {
    ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
      id: 'd-1',
      actionSubmittedAt: null,
    });
    ((prisma as any).depositTransaction.update as jest.Mock).mockResolvedValue({});

    const r = await service.markActionSubmitted('d-1', DEADLINE);

    expect(r.changed).toBe(true);
    expect((prisma as any).depositTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'd-1' },
        data: expect.objectContaining({ slaDeadline: DEADLINE, slaBreached: false }),
      }),
    );
  });

  it('markActionSubmitted 幂等：已有提交戳则不覆写', async () => {
    ((prisma as any).depositTransaction.findUnique as jest.Mock).mockResolvedValue({
      id: 'd-1',
      actionSubmittedAt: new Date('2026-08-01T00:00:00Z'),
    });
    ((prisma as any).depositTransaction.update as jest.Mock).mockClear();

    const r = await service.markActionSubmitted('d-1', DEADLINE);

    expect(r.changed).toBe(false);
    expect((prisma as any).depositTransaction.update).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "applicant action"
```

预期：FAIL，`service.setActionRefs is not a function`

- [ ] **Step 6: 实现**

在 `deposit-transactions.service.ts` 的 `setSlaDeadline` 方法旁边加：

```ts
  /**
   * 落 Sumsub applicant action 引用。三件事一次写完：换 action 引用、
   * 清掉上一轮的客户提交戳（新 action = 客户要重新交东西）、重置 SLA 表。
   * 缺任一件都会让客户端停在"已收到，审核中"而不知道又被要材料了。
   */
  async setActionRefs(
    id: string,
    actionId: string,
    externalActionId: string,
    slaDeadline: Date,
  ) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: {
        sumsubActionId: actionId,
        sumsubExternalActionId: externalActionId,
        actionSubmittedAt: null,
        slaDeadline,
        slaBreached: false,
      },
    });
  }

  /**
   * 客户提交材料。幂等——重复提交不刷新时间戳，避免客户狂点按钮把
   * SLA 表无限续期。**不碰 status**：客户的动作不驱动状态机（真实世界
   * 里也是等 Sumsub 重评后发 webhook 才动）。
   */
  async markActionSubmitted(id: string, slaDeadline: Date): Promise<{ changed: boolean }> {
    const row = await (this.prisma as any).depositTransaction.findUnique({
      where: { id },
      select: { id: true, actionSubmittedAt: true },
    });
    if (!row || row.actionSubmittedAt) return { changed: false };

    await (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { actionSubmittedAt: new Date(), slaDeadline, slaBreached: false },
    });
    return { changed: true };
  }
```

- [ ] **Step 7: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "applicant action"
```

预期：3 passed

- [ ] **Step 8: 提交**

```bash
git add prisma/schema.prisma prisma/migrations src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "feat(deposit): 加 applicant action 三字段 + 幂等读写方法

sumsubActionId/sumsubExternalActionId/actionSubmittedAt。
markActionSubmitted 幂等且不碰 status——客户动作不驱动状态机。"
```

---

## Task 2: 裁决管道透传 applicantActions + 修 applyKytAwaitUser 早退

**Files:**
- Modify: `src/modules/deposit-sumsub/sumsub-txn.types.ts`
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.mock.ts`
- Modify: `src/modules/deposit-sumsub/sumsub-txn-client.http.ts`
- Modify: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes（T1）：`setActionRefs(id, actionId, externalActionId, slaDeadline)`
- Produces（T4/T7 依赖）：充值单在进入 `ACTION_PENDING` 时携带 `sumsubActionId` / `sumsubExternalActionId`

- [ ] **Step 1: 类型加字段**

`sumsub-txn.types.ts`，在 `SumsubTxnDetail` 里 `raw` 上面加：

```ts
  /** scoringResult.applicantActions[] —— awaitUser 时 Sumsub 告诉我们要客户补什么 */
  applicantActions?: { applicantActionId: string; externalActionId: string }[];
```

- [ ] **Step 2: 两个 client 解析该字段**

`sumsub-txn-client.http.ts` 的 `getTxn` 返回体里加（`raw` 同源对象记为 `body`）：

```ts
      applicantActions: Array.isArray(body?.scoringResult?.applicantActions)
        ? body.scoringResult.applicantActions.map((a: any) => ({
            applicantActionId: String(a.applicantActionId ?? ''),
            externalActionId: String(a.externalActionId ?? ''),
          }))
        : undefined,
```

`sumsub-txn-client.mock.ts` 的 `getTxn` 同样从 fixture 报告的 `scoringResult.applicantActions` 透传（fixture 已有该结构，见 `fixtures/verdict-buttons.ts:62,80`）。

- [ ] **Step 3: handler 透传**

`deposit-kyt-verdict.handler.ts`，在 `detailRaw = detail.raw;` 下一行加：

```ts
      applicantActions = detail.applicantActions;
```

并在 `let detailRaw: unknown;` 下面声明：

```ts
    let applicantActions: { applicantActionId: string; externalActionId: string }[] | undefined;
```

`applyKytVerdict` 调用处补一项：

```ts
      ...(applicantActions?.length && { applicantActions }),
```

- [ ] **Step 4: 写失败测试**

在 `deposit-workflow.service.spec.ts` 加：

```ts
describe('applyKytAwaitUser — applicant action 引用', () => {
  const ACTIONS = [{ applicantActionId: 'aa-1', externalActionId: 'EXT-1' }];

  it('首次进 ACTION_PENDING：action 引用随状态一次写入', async () => {
    const deposit = { id: 'd-1', status: 'COMPLIANCE_PENDING' };
    depositService.findOne.mockResolvedValue(deposit);

    await workflow.applyKytVerdict('d-1', {
      verdict: 'awaitUser', riskScore: 40, applicantActions: ACTIONS,
    } as any);

    expect(depositService.updateStatus).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({ action: 'ACTION_PENDING' }),
      expect.objectContaining({
        extraData: expect.objectContaining({
          sumsubActionId: 'aa-1',
          sumsubExternalActionId: 'EXT-1',
        }),
      }),
    );
  });

  it('已在 ACTION_PENDING + 新 action id：刷新引用、清提交戳、重置表，状态不动', async () => {
    depositService.findOne.mockResolvedValue({
      id: 'd-1', status: 'ACTION_PENDING', sumsubActionId: 'aa-OLD',
    });

    await workflow.applyKytVerdict('d-1', {
      verdict: 'awaitUser', riskScore: 40, applicantActions: ACTIONS,
    } as any);

    expect(depositService.setActionRefs).toHaveBeenCalledWith(
      'd-1', 'aa-1', 'EXT-1', expect.any(Date),
    );
    expect(depositService.updateStatus).not.toHaveBeenCalled();
  });

  it('已在 ACTION_PENDING + 同一个 action id：真 no-op（重复 webhook）', async () => {
    depositService.findOne.mockResolvedValue({
      id: 'd-1', status: 'ACTION_PENDING', sumsubActionId: 'aa-1',
    });

    await workflow.applyKytVerdict('d-1', {
      verdict: 'awaitUser', riskScore: 40, applicantActions: ACTIONS,
    } as any);

    expect(depositService.setActionRefs).not.toHaveBeenCalled();
    expect(depositService.updateStatus).not.toHaveBeenCalled();
  });
});
```

（若 spec 文件里 `depositService` mock 尚无 `setActionRefs`，在其 mock 工厂里补 `setActionRefs: jest.fn()`。）

- [ ] **Step 5: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "applicant action 引用"
```

预期：FAIL，第 2 条报 `setActionRefs` 未被调用（现有早退直接 return）

- [ ] **Step 6: 实现**

把 `deposit-workflow.service.ts` 的 `applyKytAwaitUser` 整个替换为：

```ts
  private async applyKytAwaitUser(
    deposit: any,
    sceneTag?: 'SANCTION' | 'PEP',
    applicantActions?: { applicantActionId: string; externalActionId: string }[],
  ) {
    const action = applicantActions?.[0];
    const slaDeadline = new Date(
      Date.now() + DepositWorkflowService.ACTION_SLA_DAYS * 24 * 60 * 60 * 1000,
    );

    if (deposit.status === DepositTransactionStatus.ACTION_PENDING) {
      // 已在目标态。两种情况必须分开：
      //  · 同一个 action id → 真·重复 webhook，no-op
      //  · 新的 action id   → Sumsub 又要客户补一份（"还不够，再交"）。状态确实
      //    不动，但引用必须换、上一轮提交戳必须清、表必须重置——否则客户点进去
      //    看到的是上一份材料的界面，且客户端仍显示"已收到，审核中"，
      //    客户根本不知道又被要东西了。
      if (action && action.applicantActionId !== deposit.sumsubActionId) {
        await this.depositService.setActionRefs(
          deposit.id,
          action.applicantActionId,
          action.externalActionId,
          slaDeadline,
        );
        await this.auditLogsService.recordSystem({
          action: AuditActions.DEPOSIT_ACTION_REISSUED,
          entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
          entityId: deposit.id,
          entityNo: deposit.depositNo,
          entityOwnerType: deposit.ownerType,
          entityOwnerId: deposit.ownerId,
          traceId: deposit.traceId || undefined,
          workflowType: 'DEPOSIT',
          reason: `Sumsub issued a new applicant action while already ACTION_PENDING`,
          metadata: {
            previousActionId: deposit.sumsubActionId ?? null,
            actionId: action.applicantActionId,
          },
          sourcePlatform: 'SYSTEM',
        });
      }
      return;
    }

    const manualReason = sceneTag === 'PEP' ? 'EDD_PEP' : 'CLIENT_ACTION';
    const oldStatus = deposit.status;
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
          ...(action && {
            sumsubActionId: action.applicantActionId,
            sumsubExternalActionId: action.externalActionId,
          }),
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

调用处（`applyKytVerdict` 的 `case 'awaitUser'`）改成：

```ts
      case 'awaitUser':
        await this.applyKytAwaitUser(deposit, v.sceneTag, v.applicantActions);
        return;
```

`applyKytVerdict` 的入参类型补：

```ts
    applicantActions?: { applicantActionId: string; externalActionId: string }[];
```

- [ ] **Step 7: 加审计动作常量**

`src/modules/audit-logging/constants/audit-actions.constant.ts` 加：

```ts
  DEPOSIT_ACTION_REISSUED: 'DEPOSIT_ACTION_REISSUED',
```

- [ ] **Step 8: 确认 extraData 能落这两个字段**

`updateStatus` 的 `extraData` 是直接摊进 Prisma `data` 的（既有 `manualReason`/`slaDeadline` 走的同一条路）。跑一次确认没有字段过滤：

```bash
npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "applicant action 引用"
```

预期：3 passed。若第 1 条因 `extraData` 被过滤而失败，说明 `updateStatus` 里有白名单，需在其中补这两个字段名——改完再跑。

- [ ] **Step 9: 提交**

```bash
git add src/modules/deposit-sumsub src/modules/trading/deposit-transactions src/modules/audit-logging
git commit -m "feat(deposit): 裁决管道透传 applicantActions + 修 applyKytAwaitUser 早退

早退原本整段 return 不写任何字段。加了 action 引用字段后成为缺陷:
Sumsub 二次索要材料会带新 applicantActionId,状态确实不该动,但引用不换、
提交戳不清、SLA 表不重置 → 客户端仍显示"已收到,审核中",客户不知道又被要东西。
现改为: action id 变则刷新三项并记审计,未变才 no-op。"
```

---

## Task 3: SLA breach 理由按提交戳分岔

**Files:**
- Modify: `src/modules/deposit-sumsub/deposit-sla.service.ts`
- Test: `src/modules/deposit-sumsub/deposit-sla.service.spec.ts`

**Interfaces:**
- Consumes（T1）：充值单行上的 `actionSubmittedAt`

- [ ] **Step 1: 写失败测试**

在 `deposit-sla.service.spec.ts` 加：

```ts
describe('breach 理由按客户是否已提交分岔', () => {
  it('未提交 → 理由指向客户未响应', async () => {
    depositService.findSlaBreachCandidates.mockResolvedValue([
      { id: 'd-1', depositNo: 'DEP1', status: 'ACTION_PENDING', actionSubmittedAt: null },
    ]);

    await service.checkSlaBreaches();

    expect(depositService.updateStatus).toHaveBeenCalledWith(
      'd-1',
      expect.objectContaining({
        reason: 'SLA breached: no compliance action before deadline',
      }),
      expect.anything(),
    );
  });

  it('已提交 → 理由指向 Provider 重评超时，不冤枉客户', async () => {
    depositService.findSlaBreachCandidates.mockResolvedValue([
      {
        id: 'd-2', depositNo: 'DEP2', status: 'ACTION_PENDING',
        actionSubmittedAt: new Date('2026-08-01T00:00:00Z'),
      },
    ]);

    await service.checkSlaBreaches();

    expect(depositService.updateStatus).toHaveBeenCalledWith(
      'd-2',
      expect.objectContaining({
        reason:
          'SLA breached: provider re-review exceeded deadline after customer submission',
      }),
      expect.anything(),
    );
  });

  it('已提交的单，审计理由里不得出现"no compliance action"字样', async () => {
    depositService.findSlaBreachCandidates.mockResolvedValue([
      {
        id: 'd-3', depositNo: 'DEP3', status: 'ACTION_PENDING',
        actionSubmittedAt: new Date('2026-08-01T00:00:00Z'),
      },
    ]);

    await service.checkSlaBreaches();

    const call = auditLogsService.recordSystem.mock.calls.at(-1)[0];
    expect(call.reason).not.toMatch(/no compliance action/i);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/deposit-sumsub/deposit-sla.service.spec.ts -t "分岔"
```

预期：后两条 FAIL（现在理由写死）

- [ ] **Step 3: 实现**

`deposit-sla.service.ts` 的 `breach()` 开头加：

```ts
  private async breach(deposit: any): Promise<void> {
    const oldStatus = deposit.status;
    // 这块表量的是"等谁"：客户没交 → 等客户；交了 → 等 Provider 重评。
    // 理由必须跟着换，否则一个已经配合交了材料的客户会被以"未响应"的名义
    // 踢进人工复核，而这条会进审计。
    const submitted = !!deposit.actionSubmittedAt;
    const reason = submitted
      ? 'SLA breached: provider re-review exceeded deadline after customer submission'
      : 'SLA breached: no compliance action before deadline';
```

把 `updateStatus` 里的 `reason:` 换成 `reason,`；把审计的 `reason:` 换成：

```ts
      reason: `${reason} (deposit was ${oldStatus})`,
```

并在审计 `metadata` 里补 `waitingOn: submitted ? 'PROVIDER' : 'CUSTOMER'`。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/deposit-sumsub/deposit-sla.service.spec.ts
```

预期：全绿（含原有 2 条）

- [ ] **Step 5: 变异测试——证明守卫真能红**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/deposit-sumsub/deposit-sla.service.ts')
s = p.read_text()
orig = s
s = s.replace(
  "const submitted = !!deposit.actionSubmittedAt;",
  "const submitted = false; // MUTATION",
)
assert s != orig, "变异未生效——替换串对不上，停下来检查"
p.write_text(s)
print("变异已写入")
PY

npx jest src/modules/deposit-sumsub/deposit-sla.service.spec.ts -t "分岔"
```

**预期：FAIL，且失败信息点名"已提交 → 理由指向 Provider 重评超时"。**
若为绿，说明测试无效，回到 Step 1 重写。

- [ ] **Step 6: 还原变异并确认恢复绿**

⚠️ **不要用 `git checkout` 还原**——Step 3 的实现尚未提交，会被一并丢掉。用反向替换：

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('src/modules/deposit-sumsub/deposit-sla.service.ts')
s = p.read_text()
s = s.replace("const submitted = false; // MUTATION",
              "const submitted = !!deposit.actionSubmittedAt;")
p.write_text(s)
PY

npx jest src/modules/deposit-sumsub/deposit-sla.service.spec.ts
```

预期：全绿

- [ ] **Step 7: 提交**

```bash
git add src/modules/deposit-sumsub/deposit-sla.service.ts src/modules/deposit-sumsub/deposit-sla.service.spec.ts
git commit -m "fix(deposit): SLA breach 理由按客户是否已提交分岔

原理由写死'no compliance action before deadline'。客户交了材料、只是
Provider 还没重评完时超时,会以'客户未响应'的名义把人踢进人工复核,
且该措辞进审计——与事实相反。现按 actionSubmittedAt 派生。
变异测试已验证守卫可被弄红。"
```

---

## Task 4: 两个客户面端点（不可区分规则）

**Files:**
- Create: `src/modules/trading/deposit-transactions/deposit-verification-session.service.ts`
- Create: `src/modules/trading/deposit-transactions/deposit-verification-session.service.spec.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.controller.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.module.ts`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（白名单开口）
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`（改既有白名单断言）

**Interfaces:**
- Consumes（T1）：`markActionSubmitted(id, slaDeadline)`
- Produces（T6 依赖）：
  - `GET  deposit-transactions/my/:depositNo/verification-session` → `{ submitted: boolean; embedUrl: string | null; materialKind: 'SOURCE_OF_FUNDS' | 'SUPPORTING_DOCUMENTS' | null }`
  - `POST deposit-transactions/my/:depositNo/verification-session/submit` → `{ ok: true }`

- [ ] **Step 1: 写失败测试**

新建 `deposit-verification-session.service.spec.ts`：

```ts
import { DepositVerificationSessionService } from './deposit-verification-session.service';

describe('DepositVerificationSessionService', () => {
  let svc: DepositVerificationSessionService;
  let prisma: any;
  let deposits: any;

  const ROW = (over: any = {}) => ({
    id: 'd-1',
    depositNo: 'DEP1',
    ownerId: 'cust-1',
    status: 'ACTION_PENDING',
    manualReason: 'CLIENT_ACTION',
    sumsubActionId: 'aa-1',
    sumsubExternalActionId: 'EXT-1',
    actionSubmittedAt: null,
    ...over,
  });

  beforeEach(() => {
    prisma = { depositTransaction: { findFirst: jest.fn() } };
    deposits = { markActionSubmitted: jest.fn().mockResolvedValue({ changed: true }) };
    svc = new DepositVerificationSessionService(prisma, deposits);
  });

  it('未提交 + 有 action → 给 embedUrl 与中性 materialKind', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(r.submitted).toBe(false);
    expect(r.materialKind).toBe('SOURCE_OF_FUNDS');
    expect(r.embedUrl).toContain('DEP1');
  });

  it('EDD_PEP 映射成中性 SUPPORTING_DOCUMENTS —— 不下发 manualReason', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ manualReason: 'EDD_PEP' }));

    const r = await svc.getSession('cust-1', 'DEP1');

    expect(r.materialKind).toBe('SUPPORTING_DOCUMENTS');
    expect(JSON.stringify(r)).not.toMatch(/EDD_PEP|PEP/);
  });

  // ── 核心：接口层的不可区分规则 ──────────────────────────────
  it('已提交的单，ACTION_PENDING 与 FROZEN 响应体全等', async () => {
    const submittedAt = new Date('2026-08-01T00:00:00Z');

    prisma.depositTransaction.findFirst.mockResolvedValue(
      ROW({ status: 'ACTION_PENDING', actionSubmittedAt: submittedAt }),
    );
    const a = await svc.getSession('cust-1', 'DEP1');

    prisma.depositTransaction.findFirst.mockResolvedValue(
      ROW({ status: 'FROZEN', actionSubmittedAt: submittedAt }),
    );
    const b = await svc.getSession('cust-1', 'DEP1');

    expect(b).toEqual(a);
  });

  it('提交端点对冻结单照样 200（不返错误码当探针）', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW({ status: 'FROZEN' }));

    await expect(svc.submit('cust-1', 'DEP1')).resolves.toEqual({ ok: true });
  });

  it('别人的单 → 404', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(null);

    await expect(svc.getSession('cust-9', 'DEP1')).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-verification-session.service.spec.ts
```

预期：FAIL，模块不存在

- [ ] **Step 3: 实现 service**

新建 `deposit-verification-session.service.ts`：

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DepositTransactionsService } from './deposit-transactions.service';

export type MaterialKind = 'SOURCE_OF_FUNDS' | 'SUPPORTING_DOCUMENTS';

export interface VerificationSessionView {
  submitted: boolean;
  embedUrl: string | null;
  materialKind: MaterialKind | null;
  // ⚠️ 不要加 actionId：demo fixture 的 id 带语义（PEP 场景是 aa-edd-…），
  // 下发即等于泄露 materialKind 想封的那 1 比特。spec 已同步删除该契约字段，
  // 且 spec 文件里有一条钉死响应 key 集合的断言会拦住任何新增字段。
}

/** 客户提交后重新计时的窗口，与 ACTION_SLA_DAYS 同为 7 天（换语义不换数字） */
const PROVIDER_REVIEW_SLA_DAYS = 7;

/**
 * 充值补料会话。**本服务是"接口层不可区分规则"的唯一实现处。**
 *
 * 渲染层已经把 FROZEN/SEIZING/SEIZED/MANUAL_CHECKING 收敛成与正常处理
 * 逐字段一致（见 client-web/src/utils/depositStatusView.ts）。但新增端点
 * 本身是一个新的可观测面：若它对 ACTION_PENDING 返 200、对 FROZEN 返 404，
 * 客户开 DevTools 就能直接问出自己那单是不是被冻了，渲染层防线归零。
 *
 * 故：响应体只由 `actionSubmittedAt` 决定，**绝不由 status 决定**。
 */
@Injectable()
export class DepositVerificationSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deposits: DepositTransactionsService,
  ) {}

  private async mustFindOwn(customerId: string, depositNo: string) {
    const row = await (this.prisma as any).depositTransaction.findFirst({
      where: { depositNo, ownerId: customerId },
    });
    if (!row) throw new NotFoundException('Deposit not found');
    return row;
  }

  /**
   * manualReason → 中性材料类型。**manualReason 本身绝不下发**：它取值
   * EDD_PEP 时等同于告诉客户"你被判定为 PEP"。
   */
  private materialKindOf(manualReason: string | null): MaterialKind {
    return manualReason === 'EDD_PEP' ? 'SUPPORTING_DOCUMENTS' : 'SOURCE_OF_FUNDS';
  }

  async getSession(customerId: string, depositNo: string): Promise<VerificationSessionView> {
    const row = await this.mustFindOwn(customerId, depositNo);

    // 已提交：无论此刻是 ACTION_PENDING 还是已被冻，一律同一个响应体。
    if (row.actionSubmittedAt) {
      return { submitted: true, embedUrl: null, materialKind: null };
    }

    if (!row.sumsubActionId) {
      return { submitted: false, embedUrl: null, materialKind: null };
    }

    return {
      submitted: false,
      embedUrl: `/mock-verification?deposit=${encodeURIComponent(row.depositNo)}`,
      materialKind: this.materialKindOf(row.manualReason),
    };
  }

  /**
   * 客户提交。幂等、恒 200、不碰状态机。
   * 冻结单上提交照收——收下不做事，好过返错误码告诉对方"你这单不一样了"。
   *
   * 审计：CLAUDE.md 铁律 1「有持久状态、operator 可见操作 → 必须写
   * AuditLogsService」。本操作既改持久状态（actionSubmittedAt / slaDeadline），
   * 又对 operator 可见（admin 详情有 Customer submitted at 一行），故必须落审计。
   * 只在**真正落库那一次**记（`changed === true`），幂等的重复提交不刷屏。
   */
  async submit(customerId: string, depositNo: string): Promise<{ ok: true }> {
    const row = await this.mustFindOwn(customerId, depositNo);
    if (row.sumsubActionId) {
      const deadline = new Date(
        Date.now() + PROVIDER_REVIEW_SLA_DAYS * 24 * 60 * 60 * 1000,
      );
      const { changed } = await this.deposits.markActionSubmitted(row.id, deadline);
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
            reason:
              'Customer submitted applicant-action materials; SLA clock switched to provider re-review',
            metadata: {
              actionId: row.sumsubActionId,
              slaDeadline: deadline,
              waitingOn: 'PROVIDER',
            },
            sourcePlatform: 'CUSTOMER_API',
          },
          { actorType: 'CUSTOMER', actorId: customerId, actorRole: 'CUSTOMER' },
        );
      }
    }
    return { ok: true };
  }
}
```

构造函数同时注入 `private readonly auditLogs: AuditLogsService,`（**DI 注入，禁止 `new`**——CLAUDE.md 铁律 1）。

`audit-actions.constant.ts` 加：

```ts
  DEPOSIT_ACTION_SUBMITTED: 'DEPOSIT_ACTION_SUBMITTED',
```

spec 里对应加一条断言：

```ts
  it('落库那次记审计；幂等的重复提交不重复记', async () => {
    prisma.depositTransaction.findFirst.mockResolvedValue(ROW());

    deposits.markActionSubmitted.mockResolvedValue({ changed: true });
    await svc.submit('cust-1', 'DEP1');
    expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);
    expect(auditLogs.recordByActor.mock.calls[0][1]).toEqual(
      expect.objectContaining({ actorType: 'CUSTOMER', actorId: 'cust-1' }),
    );

    deposits.markActionSubmitted.mockResolvedValue({ changed: false });
    await svc.submit('cust-1', 'DEP1');
    expect(auditLogs.recordByActor).toHaveBeenCalledTimes(1);   // 没涨
  });
```

（`beforeEach` 里补 `auditLogs = { recordByActor: jest.fn() };` 并传入构造函数。）

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/trading/deposit-transactions/deposit-verification-session.service.spec.ts
```

预期：6 passed

- [ ] **Step 4b: 把 `markActionSubmitted` 改成原子更新（承接 Task 1 评审的 Minor）**

Task 1 的实现是 `findUnique` 读一次、再 `update` 写一次——两步之间有 TOCTOU 窗口：两个并发提交都可能读到 `actionSubmittedAt === null`，于是**都**返回 `changed: true`。本任务正是**靠 `changed` 决定要不要写审计**，所以这个竞态会让同一次提交记出两条审计。

先加一条测试到 `deposit-transactions.service.spec.ts` 的 `applicant action 字段读写` 块里：

```ts
  it('markActionSubmitted 用单条带条件的更新（无 TOCTOU 窗口）', async () => {
    ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 1 });

    const r = await service.markActionSubmitted('d-1', DEADLINE);

    expect(r.changed).toBe(true);
    expect((prisma as any).depositTransaction.updateMany).toHaveBeenCalledWith({
      where: { id: 'd-1', actionSubmittedAt: null },   // ← 条件写在 where 里，由 DB 保证互斥
      data: expect.objectContaining({ slaDeadline: DEADLINE, slaBreached: false }),
    });
    // 读-改-写的两步式已被取代，不应再有先读一次的动作
    expect((prisma as any).depositTransaction.findUnique).not.toHaveBeenCalled();
  });

  it('markActionSubmitted 并发落败方拿到 changed:false（匹配 0 行）', async () => {
    ((prisma as any).depositTransaction.updateMany as jest.Mock).mockResolvedValue({ count: 0 });

    await expect(service.markActionSubmitted('d-1', DEADLINE)).resolves.toEqual({ changed: false });
  });
```

（prisma mock 工厂里若无 `updateMany`，补 `updateMany: jest.fn()`。）

实现替换为：

```ts
  /**
   * 客户提交材料。幂等——重复提交不刷新时间戳，避免客户狂点按钮把
   * SLA 表无限续期。**不碰 status**：客户的动作不驱动状态机（真实世界
   * 里也是等 Sumsub 重评后发 webhook 才动）。
   *
   * 用**单条带条件的 updateMany** 而非「先读后写」：调用方靠返回的 `changed`
   * 决定是否写审计，两步式在并发下两个请求都会读到 null、都返回 true，
   * 同一次提交会记出两条审计。条件放进 where 交给 DB 保证互斥后，
   * 只有一个请求能匹配到行。
   */
  async markActionSubmitted(id: string, slaDeadline: Date): Promise<{ changed: boolean }> {
    const res = await (this.prisma as any).depositTransaction.updateMany({
      where: { id, actionSubmittedAt: null },
      data: { actionSubmittedAt: new Date(), slaDeadline, slaBreached: false },
    });
    return { changed: res.count > 0 };
  }
```

Task 1 遗留的三条旧测试里，「首次盖戳」与「幂等：已有提交戳则不覆写」两条是按 `findUnique`+`update` 写的，改为按 `updateMany` 的 `count` 断言（语义不变：能盖 → `count: 1` → `changed: true`；已盖过 → `count: 0` → `changed: false`）。**不要**删掉这两条，它们仍是幂等性的回归防护。

跑：

```bash
npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "applicant action"
```

预期：5 passed（原 3 条改写后 + 新 2 条）

- [ ] **Step 5: 挂 controller 与 module**

`deposit-transactions.controller.ts` 在 `@Post('my/inbound-signals/scan')` 之后加：

```ts
  @Get('my/:depositNo/verification-session')
  @ApiOperation({ summary: 'Get my deposit verification session' })
  getMyVerificationSession(@Req() req: any, @Param('depositNo') depositNo: string) {
    return this.verificationSessions.getSession(req.user.userId, depositNo);
  }

  @Post('my/:depositNo/verification-session/submit')
  @ApiOperation({ summary: 'Mark my deposit verification materials as submitted' })
  submitMyVerification(@Req() req: any, @Param('depositNo') depositNo: string) {
    return this.verificationSessions.submit(req.user.userId, depositNo);
  }
```

构造函数注入 `private readonly verificationSessions: DepositVerificationSessionService,`；`deposit-transactions.module.ts` 的 `providers` 加 `DepositVerificationSessionService`。

> 这两条是**客户面**路由（`my/` 前缀，JWT 守卫），不是 admin 路由，**不需要**登记 `rbac.catalog.ts`。

- [ ] **Step 6: 白名单开口 + 改既有断言**

`deposit-transactions.service.ts` 的 `toCustomerDepositView()` 返回体加一行：

```ts
      actionSubmittedAt: item.actionSubmittedAt,
```

并在该方法的文档注释末尾补一段：

```
   * 例外 —— `actionSubmittedAt` 是本白名单唯一有意开的口子：它记录的是
   * **客户自己的动作**（客户本就知道自己交没交，不构成新信息），且对执法态
   * 与正常态一视同仁地存在（提交过的单无论后来是 FROZEN 还是
   * COMPLIANCE_PENDING 该值都在），因此不产生新的可辨识信号。
   * `manualReason` 不可比照办理——它取值 EDD_PEP 时等同于告知客户其 PEP 判定。
```

改既有断言 `Fix 1 (tipping-off): customer list strips ...`：在 `expect(item).toEqual({...})` 的对象里补 `actionSubmittedAt: SENSITIVE_FULL_ROW.actionSubmittedAt,`，并在 `SENSITIVE_FULL_ROW` 里加 `actionSubmittedAt: new Date('2026-08-01T00:00:00Z')`。**不要**把它加进 `SENSITIVE_KEYS`。

- [ ] **Step 7: 跑全量后端单测**

```bash
npx jest src/modules/trading/deposit-transactions src/modules/deposit-sumsub
```

预期：全绿

- [ ] **Step 8: 提交**

```bash
git add src/modules/trading/deposit-transactions
git commit -m "feat(deposit): 补料会话两端点——响应体只认提交戳、不认 status

新端点本身是新的可观测面:若对 ACTION_PENDING 返 200、对 FROZEN 返 404,
客户开 DevTools 即可问出自己那单是否被冻,渲染层防线归零。故响应体只由
actionSubmittedAt 决定;提交端点对冻结单恒 200,不返错误码当探针。
manualReason 映射成中性 materialKind 再下发,绝不下发原值(EDD_PEP)。
白名单为 actionSubmittedAt 开唯一口子,理由写进注释。"
```

---

## Task 5: 客户端视图层三展示态 + 堵泄密口

**Files:**
- Modify: `client-web/src/utils/depositStatusView.ts`
- Test: `client-web/src/utils/depositStatusView.spec.ts`

**Interfaces:**
- Produces（T6 依赖）：`getDepositStatusView(status: string, opts?: { submitted?: boolean }): DepositStatusView`

- [ ] **Step 1: 写失败测试**

在 `depositStatusView.spec.ts` 末尾（`forbidden-word sweep` 之后）加：

```ts
  // ── applicant action 三展示态 + 泄密口 ──────────────────────
  //
  // 态③（客户已提交）要显示"已收到，审核中"。若该 note 按 **status** 给出，
  // 则：客户提交 → 见"已收到" → Sumsub 判回制裁 → 单子进 FROZEN → 该句
  // **凭空消失**。客户盯着自己那单，眼看一句话没了——这正是 2026-08-02
  // 收敛要堵的"一眼看出自己这单与众不同"。
  //
  // 故：该 note 绑 `submitted`，**不绑 status**。提交过即恒显，冻结时刻
  // 客户端零变化。
  describe('applicant action 展示态', () => {
    it('态①未提交：ACTION REQUIRED + 索要文案', () => {
      const v = getDepositStatusView('ACTION_PENDING', { submitted: false });
      expect(v.label).toBe('ACTION REQUIRED');
      expect(v.tone).toBe('warning');
    });

    it('态③已提交：收敛成 PROCESSING + 已收到文案', () => {
      const v = getDepositStatusView('ACTION_PENDING', { submitted: true });
      expect(v.label).toBe('PROCESSING');
      expect(v.tone).toBe('neutral');
      expect(v.note).toMatch(/received/i);
    });

    it.each([true, false])(
      '执法四态与 COMPLIANCE_PENDING 逐字段一致（submitted=%s 两个取值都要成立）',
      (submitted) => {
        for (const s of ['FROZEN', 'SEIZING', 'SEIZED', 'MANUAL_CHECKING']) {
          expect(getDepositStatusView(s, { submitted })).toEqual(
            getDepositStatusView('COMPLIANCE_PENDING', { submitted }),
          );
        }
      },
    );

    // 时序不变量：这才是客户实际观察到的东西
    it('提交后被冻——客户端渲染逐字段不变', () => {
      const before = getDepositStatusView('ACTION_PENDING', { submitted: true });
      const after = getDepositStatusView('FROZEN', { submitted: true });
      expect(after).toEqual(before);
    });

    it('已提交的文案里同样不得出现执法字样', () => {
      for (const s of ALL_STATUSES) {
        const v = getDepositStatusView(s, { submitted: true });
        expect(`${v.label} ${v.note ?? ''}`).not.toMatch(FORBIDDEN);
      }
    });
  });
```

把 `const FORBIDDEN` 从 `it` 作用域提到 `describe` 顶层（若尚未）。

- [ ] **Step 2: 跑测试确认失败**

```bash
cd client-web && npx vitest run src/utils/depositStatusView.spec.ts
```

预期：FAIL（`submitted` 参数被忽略，态③仍返 ACTION REQUIRED）

- [ ] **Step 3: 实现**

`depositStatusView.ts` 末尾，把 `getDepositStatusView` 换成：

```ts
/** 客户已提交补料后的统一呈现——绑提交事实，不绑当前状态（见下方注释） */
const SUBMITTED_VIEW: DepositStatusView = {
  label: 'PROCESSING',
  note: 'We have received your information and it is being reviewed',
  tone: 'neutral',
};

/**
 * Returns the customer-facing view for a deposit status. Unknown or
 * unmapped statuses (including CONFISCATING/CONFISCATED, which the
 * server should already have filtered out) fall back to the neutral
 * "Processing" default rather than ever rendering enforcement wording.
 *
 * `opts.submitted` = 该单的 `actionSubmittedAt` 非空。
 *
 * ⚠️ 规则 4（2026-08-04）：只要客户提交过补料，**一律**走 SUBMITTED_VIEW，
 * 与当前 status 无关。这不是偷懒，是防线：若按 status 给这条 note，则
 * 「提交 → 见'已收到' → 被冻 → 该句消失」构成一次客户可观测的状态变化，
 * 等于在规则 1 刚补好的防线上重新开洞。绑提交事实后，冻结时刻客户端零变化。
 * 勿"优化"成按 status 分支。
 */
export function getDepositStatusView(
  status: string,
  opts?: { submitted?: boolean },
): DepositStatusView {
  if (opts?.submitted) return SUBMITTED_VIEW;
  const key = String(status || '').toUpperCase();
  return VIEW_MAP[key] ?? DEFAULT_VIEW;
}
```

- [ ] **Step 4: 跑测试确认通过**

```bash
cd client-web && npx vitest run src/utils/depositStatusView.spec.ts
```

预期：全绿（原 8 条 + 新 5 条）

- [ ] **Step 5: 变异测试**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('client-web/src/utils/depositStatusView.ts')
s = p.read_text(); orig = s
s = s.replace(
  "  if (opts?.submitted) return SUBMITTED_VIEW;",
  "  if (opts?.submitted && String(status).toUpperCase() === 'ACTION_PENDING') return SUBMITTED_VIEW; // MUTATION",
)
assert s != orig, "变异未生效——替换串对不上，停下来检查"
p.write_text(s); print("变异已写入：把绑提交戳偷偷改回绑 status")
PY

cd client-web && npx vitest run src/utils/depositStatusView.spec.ts
```

**预期：FAIL，且点名「提交后被冻——客户端渲染逐字段不变」与「执法四态…submitted=true」。**
若为绿，测试无效，回 Step 1 重写。

- [ ] **Step 6: 还原并确认绿**

```bash
python3 - <<'PY'
import pathlib
p = pathlib.Path('client-web/src/utils/depositStatusView.ts')
s = p.read_text()
s = s.replace(
  "  if (opts?.submitted && String(status).toUpperCase() === 'ACTION_PENDING') return SUBMITTED_VIEW; // MUTATION",
  "  if (opts?.submitted) return SUBMITTED_VIEW;",
)
p.write_text(s)
PY

cd client-web && npx vitest run src/utils/depositStatusView.spec.ts
```

预期：全绿

- [ ] **Step 7: 提交**

```bash
git add client-web/src/utils/depositStatusView.ts client-web/src/utils/depositStatusView.spec.ts
git commit -m "feat(client): 充值补料三展示态——已收到文案绑提交戳而非 status

堵一处泄密口:若按 status 给'已收到'这条 note,则「提交→见已收到→被冻→
该句消失」是一次客户可观测的状态变化,等于在 08-02 刚补好的 tipping-off
防线上重新开洞。改为只要提交过就恒显,冻结时刻客户端零变化。
变异测试已验证守卫可被弄红。"
```

---

## Task 6: 详情弹窗两尺寸 + 容器 stage + mock 认证页

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx`
- Create: `client-web/src/pages/MockVerification.tsx`
- Modify: `client-web/src/App.tsx`

**Interfaces:**
- Consumes（T4）：两个客户面端点；（T5）：`getDepositStatusView(status, { submitted })`

- [ ] **Step 1: `Transaction` 接口补字段**

`Deposit.tsx` 的 `Transaction` 接口加：

```ts
  actionSubmittedAt?: string | null;
```

> 该接口的注释在后端白名单里被点名为"实际字段合同"，两边必须同步。

- [ ] **Step 2: 所有 `getDepositStatusView` 调用点传 submitted**

`renderStatusBadge` / `renderStatusDetail` 改为接收整条 `tx` 而非裸 `status`：

```tsx
  const viewOf = (tx: Transaction) =>
    getDepositStatusView(tx.status, { submitted: !!tx.actionSubmittedAt });
```

列表行与弹窗都改用 `viewOf(tx)`。**列表必须一起改**——否则列表显示 ACTION REQUIRED、弹窗显示 PROCESSING，自相矛盾。

- [ ] **Step 3: 替换那段 "Please contact support"**

把 `renderStatusDetail` 里 `isActionPending` 那个分支（含那段自陈注释）整体换成：

```tsx
        {needsAction ? (
          <button
            onClick={() => void openVerification(tx)}
            className="rounded-xl border border-fx-brass/40 bg-fx-brass/10 px-4 py-3 text-sm font-semibold text-fx-brass hover:bg-fx-brass/20"
          >
            Provide the requested documents
          </button>
        ) : null}
```

**⚠️ 两种场景共用同一句文案，不按材料类型分岔（2026-08-04 业主定稿，取代本计划早先的写法）。**
原设计按 `materialKind` 给两句不同文案（`SOURCE_OF_FUNDS` → "proof of source of funds"、
`SUPPORTING_DOCUMENTS` → "additional supporting documents"）。评审指出：`manualReason`
的值域只有 `{CLIENT_ACTION, EDD_PEP}` 两个，映射到两个 `materialKind` 是**双射** ——
"是不是 PEP" 这 1 个比特被无损保留，只换了措辞，等于没脱敏。

改为统一文案后，**我方接口一个比特都不带**；具体要什么材料由验证组件自己告诉客户
（真接 Sumsub 后本就如此，泄露源在 Sumsub 侧而非我方）。代价是客户点进去之前
不知道要准备什么，这是有意接受的取舍。

因此本任务还要**回改 Task 4 已发的后端**（`deposit-verification-session.service.ts`）：
- 删掉 `MaterialKind` 类型、`materialKindOf()` 私有方法、`VerificationSessionView.materialKind` 字段
- 三个 return 分支同步去掉该键
- spec 里那两条钉死响应 key 集合的断言（两个分支各一条）同步更新期望值；
  断言 `manualReason` 不出现在响应里的那条**保留**
- 该 service 从此**完全不读 `manualReason`**，`mustFindOwn` 的 `select` 里也去掉它

其中 `needsAction = tx.status.toUpperCase() === 'ACTION_PENDING' && !tx.actionSubmittedAt`。

`openVerification` 拉会话并展开宽版：

```tsx
  const openVerification = async (tx: Transaction) => {
    setEmbedError(false);
    setEmbedLoading(true);
    try {
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${tx.depositNo}/verification-session`,
      );
      if (!r.ok) throw new Error('session fetch failed');
      const s = await r.json();
      setSession(s);
      if (s.embedUrl) setEmbedOpen(true);
      else setEmbedError(true);
    } catch {
      // §6：加载失败必须给可重试 CTA，不能只 console.error 让客户卡在 loading
      setEmbedOpen(true);
      setEmbedError(true);
    }
  };
```

- [ ] **Step 4: 弹窗两尺寸 + 容器 stage**

弹窗外层 className 由固定 `max-w-lg` 改为：

```tsx
className={`bg-fx-ink rounded-2xl shadow-xl w-full max-h-[90vh] overflow-y-auto border border-fx-rule ${
  embedOpen ? 'max-w-3xl' : 'max-w-lg'
}`}
```

在弹窗正文里（金额/状态块之后）加容器：

```tsx
{embedOpen && session?.embedUrl ? (
  <div className="relative min-h-[680px] border border-fx-rule rounded-xl overflow-hidden">
    {/* 这块地方是"第三方验证组件渲染的舞台"，不是"我们设 src 的 iframe"。
        演示放 mock 页；真接 Sumsub 时改成 snsWebSdk.launch('#sumsub-websdk-container')，
        布局/高度/遮罩与周边文案一行不用动。 */}
    <div id="sumsub-websdk-container" className="h-full">
      <iframe
        src={session.embedUrl}
        title="Verification"
        className="w-full h-[680px] border-0"
        onLoad={() => setEmbedLoading(false)}
      />
    </div>
    {embedLoading ? (
      <div className="absolute inset-0 grid place-items-center bg-fx-ink text-fx-dust text-sm">
        Loading verification…
      </div>
    ) : null}
    {embedError ? (
      <div className="absolute inset-0 grid place-items-center bg-fx-ink">
        {/* 重试必须真的重新拉会话——只清 error 标志是个假按钮 */}
        <button onClick={() => selectedTx && void openVerification(selectedTx)}
                className="fx-btn-ghost">
          Verification failed to load — retry
        </button>
      </div>
    ) : null}
  </div>
) : null}
```

状态：`const [embedOpen, setEmbedOpen] = useState(false);`、`embedLoading`（初值 `true`）、`embedError`、`session`。关闭弹窗时全部重置。

> 遮罩不可省：官方明说不接 `onReady`/不挂遮罩是"widget 一片空白"报障的头号原因。

- [ ] **Step 5: 监听提交事件**

```tsx
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== 'idCheck.onApplicantSubmitted') return;
      setEmbedOpen(false);
      setSession(null);
      void refreshTransactions();   // 重拉列表，拿到 actionSubmittedAt → 切态③
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);
```

> 事件名**故意**用真实 SDK 的 `idCheck.onApplicantSubmitted`。将来换真 SDK，这个 handler 从 `postMessage` 监听改成 `.on('idCheck.onApplicantSubmitted', …)`，里面逻辑不变。
> `e.origin` 校验必须有：不校验就等于任何页面都能伪造提交。

- [ ] **Step 6: mock 认证页**

新建 `client-web/src/pages/MockVerification.tsx`：

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { customerFetch } from '../utils/customerFetch';

/**
 * Mock 认证页——演示期占住真实 Sumsub WebSDK 将来要占的那块容器。
 * 不真收文件。提交后 postMessage 出真实 SDK 的事件名，父页面 handler
 * 换成真 SDK 时无需改动。
 */
export default function MockVerification() {
  const [params] = useSearchParams();
  const depositNo = params.get('deposit') ?? '';
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      // 用项目既有的 customerFetch（它读 localStorage 的 `customer_token`
      // 并统一挂 Authorization）。**不要**自己拼 token：本项目客户端 token
      // 的 key 是 `customer_token` 而非 `token`，手拼必 401。
      const r = await customerFetch(
        `${import.meta.env.VITE_API_URL}/deposit-transactions/my/${depositNo}/verification-session/submit`,
        { method: 'POST' },
      );
      if (!r.ok) throw new Error('submit failed');
      window.parent.postMessage(
        { type: 'idCheck.onApplicantSubmitted' },
        window.location.origin,
      );
    } catch {
      setErr('Submission failed. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-fx-obsidian px-8 py-10 text-fx-sand">
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
        Verification provider · demo
      </div>
      <h1 className="fx-display mt-3 text-[28px] font-light">Upload your documents</h1>
      <p className="fx-serif mt-3 max-w-[460px] text-[14px] leading-[1.7] text-fx-dune">
        Please upload the supporting documents requested for this transaction.
      </p>

      <div className="mt-8 grid place-items-center rounded-xl border border-dashed border-fx-rule py-14 text-fx-dust">
        Drag files here, or click to browse
      </div>

      <button
        onClick={() => void submit()}
        disabled={busy || !depositNo}
        className="mt-8 rounded-xl bg-fx-brass px-6 py-3 font-semibold text-fx-obsidian disabled:opacity-50"
      >
        {busy ? 'Submitting…' : 'Submit'}
      </button>
      {err ? <div className="mt-3 text-sm text-fx-rust">{err}</div> : null}
    </div>
  );
}
```

- [ ] **Step 7: 加路由**

`App.tsx` 在 `/register` 那行下面加（**放在 `CustomerDashboardLayout` 之外**，因为它要在 iframe 里裸渲染）：

```tsx
              <Route path="/mock-verification" element={<MockVerification />} />
```

并加对应的 lazy import，与同文件既有页面写法一致。

- [ ] **Step 8: 渲染验证（不是 tsc 过了就算）**

```bash
bash scripts/stack.sh up
```

用种子账号登客户端，构造一笔 ACTION_PENDING 充值单（admin 侧点 ② Awaiting user），然后**截图逐一确认**：

1. 列表行显示 `ACTION REQUIRED`
2. 弹窗显示索要文案按钮，弹窗为窄版
3. 点按钮 → 弹窗变宽版，认证页在容器内渲染，遮罩先出现后消失
4. 点 Submit → 弹窗收起，列表行变 `PROCESSING`，弹窗内出现 "We have received your information…"
5. admin 侧点 ⑤ Rejected · MLRO freeze 把该单冻掉 → **刷新客户端，第 4 步的画面逐字不变**

第 5 条是本轮的核心防线，必须亲眼看到"什么都没变"，`tsc` 通过不算数。

- [ ] **Step 9: 提交**

```bash
git add client-web/src
git commit -m "feat(client): 充值详情弹窗两尺寸 + 容器 stage + mock 认证页

弹窗点认证按钮展开宽版,认证界面渲染在一个空容器里(不是我们设 src 的 iframe)
——真接 Sumsub 时改成 snsWebSdk.launch 同一个容器,布局不动。
mock 页提交后 postMessage 真实 SDK 事件名 idCheck.onApplicantSubmitted,
并校验 origin。删掉那段'Please contact support'降级兜底。"
```

---

- [ ] **Step 9（增补）：修历史筛选下拉——它把视图层刚收敛掉的区分度原样还了回去**

`client-web/src/pages/Deposit.tsx:137` 的 `HISTORY_STATUS_FILTERS` 现在长这样：

```ts
  { label: getDepositStatusView('PAYIN_PENDING').label, statuses: ['PAYIN_PENDING', 'COMPLIANCE_PENDING'] },
  { label: getDepositStatusView('ACTION_PENDING').label, statuses: ['ACTION_PENDING'] },
  { label: getDepositStatusView('FROZEN').label, statuses: ['FROZEN', 'SEIZING', 'SEIZED', 'MANUAL_CHECKING'] },
```

第 1 条和第 3 条的 `label` **都是 `'PROCESSING'`**（因为视图层已把这些态收敛成同一个词），
但 `statuses` 不同。于是下拉里出现两个同名选项，客户选第一个自己那单消失、选第三个才出现
——**页面层把视图层花大力气收敛掉的区分度原样还了回去**。顺带 `key={filter.label}` 重复。
（既有缺陷，来自 2026-07-29 的 `145df175`，已在 main。）

**还有第二层，是本功能引入的**：单子提交后徽章变 `PROCESSING`，但它仍归在 `ACTION REQUIRED`
桶里。于是「已提交 → 被冻」时，在 `ACTION REQUIRED` 筛选下这单**会消失** —— 与上面同一类洞。

**修法：筛选桶必须与「渲染出来的标签」一一对应，而不是与原始 status 对应。**
改成发**桶名**而非 status 列表，由后端把桶映射成 where 条件：

前端：

```ts
/** 桶名与 getDepositStatusView 渲染出的 label 一一对应——凡是渲染成同一个词的，
 *  必须落在同一个桶里，否则客户能用筛选器把视图层遮蔽掉的差别问出来。 */
const HISTORY_STATUS_FILTERS: Array<{ label: string; bucket: string }> = [
  { label: 'PROCESSING', bucket: 'PROCESSING' },
  { label: 'ACTION REQUIRED', bucket: 'ACTION_REQUIRED' },
  { label: 'RETURNING', bucket: 'RETURNING' },
  { label: 'RETURNED', bucket: 'RETURNED' },
  { label: 'SUCCESS', bucket: 'SUCCESS' },
  { label: 'FAILED', bucket: 'FAILED' },
];
```

`<option key={filter.bucket} value={filter.bucket}>`；请求参数从 `status` 改为 `bucket`。

后端（`deposit-transactions.service.ts` 的 `findAll`，**仅 customerScope 生效**）：

```ts
    // 客户面筛选桶：必须与 client-web/src/utils/depositStatusView.ts 渲染出的
    // label 一一对应。ACTION_PENDING 按「是否已提交」劈成两半——已提交的渲染成
    // PROCESSING，就必须归进 PROCESSING 桶；否则该单被冻时会从 ACTION_REQUIRED
    // 桶里消失，客户用筛选器就能看出自己这单出事了。
    const CUSTOMER_BUCKETS: Record<string, any> = {
      PROCESSING: {
        OR: [
          { status: { in: ['PAYIN_PENDING', 'COMPLIANCE_PENDING', 'FROZEN', 'SEIZING', 'SEIZED', 'MANUAL_CHECKING'] } },
          { status: 'ACTION_PENDING', actionSubmittedAt: { not: null } },
        ],
      },
      ACTION_REQUIRED: { status: 'ACTION_PENDING', actionSubmittedAt: null },
      RETURNING: { status: 'RETURNING' },
      RETURNED: { status: 'RETURNED' },
      SUCCESS: { status: 'SUCCESS' },
      FAILED: { status: 'FAILED' },
    };
```

customerScope 下收到 `bucket` 就并进 `where`；未知桶名 → 忽略（等同 All Status），**不要报错**
（报错本身又是一个可探测面）。admin 侧的 `status` 参数行为**一字不动**。

必须加的测试（`deposit-transactions.service.spec.ts`）：

```ts
  it('PROCESSING 桶覆盖全部渲染成 PROCESSING 的态（含已提交的 ACTION_PENDING）', async () => { … });
  it('ACTION_REQUIRED 桶只含未提交的 ACTION_PENDING', async () => { … });
  it('提交过的单从 ACTION_PENDING 变 FROZEN，前后都落在 PROCESSING 桶里（筛选器不泄密）', async () => { … });
  it('未知桶名 → 不加 status 约束、不抛错', async () => { … });
  it('admin scope 不受桶映射影响，仍按 status 参数过滤', async () => { … });
```

并做变异验证：把 `ACTION_REQUIRED` 桶改成 `{ status: 'ACTION_PENDING' }`（去掉
`actionSubmittedAt: null`），确认第 3 条测试变红。用 python，**禁止 perl / `git checkout`**。

## Task 7: admin 两行 + e2e + 文档同步 + 硬闸

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`
- Modify: `test/deposit-sumsub-verdicts.e2e-spec.ts`
- Modify: `doc-final/reference/truth/v4-deposit.md`
- Modify: `doc-final/reference/truth/sumsub-ingestion.md`
- Modify: `doc-final/BACKLOG.md`

- [ ] **Step 1: admin 详情加两行只读**

在 Sumsub 相关字段区块内加两行，与既有只读行同款式：

```tsx
<DetailRow label="Applicant action id" value={data.sumsubActionId ?? '—'} />
<DetailRow label="Customer submitted at"
           value={data.actionSubmittedAt ? new Date(data.actionSubmittedAt).toLocaleString() : '—'} />
```

（`DetailRow` 用该文件既有的行组件名；若名称不同则照搬同文件其它只读行的写法。）
admin 走的是 `findOne` 全字段返回，**不新增端点，故不涉及 RBAC catalog 登记**。

- [ ] **Step 2: e2e 加两条**

在 `test/deposit-sumsub-verdicts.e2e-spec.ts` 加：

```ts
  it('补料完整弧：awaitUser → 取会话 → 提交 → 状态未动 → 操作员放行 → SUCCESS', async () => {
    const dep = await seedDepositInCompliancePending();

    await fireVerdict(dep, 'V2_AWAIT_USER');
    expect((await getDeposit(dep)).status).toBe('ACTION_PENDING');

    const s1 = await api.get(`/deposit-transactions/my/${dep.depositNo}/verification-session`);
    expect(s1.body.submitted).toBe(false);
    expect(s1.body.embedUrl).toBeTruthy();

    await api.post(`/deposit-transactions/my/${dep.depositNo}/verification-session/submit`).expect(201);

    const after = await getDeposit(dep);
    expect(after.status).toBe('ACTION_PENDING');        // 状态没动
    expect(after.actionSubmittedAt).toBeTruthy();       // 戳落了
    expect(new Date(after.slaDeadline).getTime())       // 表重置了
      .toBeGreaterThan(Date.now() + 6 * 24 * 3600 * 1000);

    await fireVerdict(dep, 'V1_APPROVED');
    expect((await getDeposit(dep)).status).toBe('SUCCESS');
  });

  it('接口不可区分：已提交的单，ACTION_PENDING 与 FROZEN 的会话响应体全等', async () => {
    const dep = await seedDepositInCompliancePending();
    await fireVerdict(dep, 'V2_AWAIT_USER');
    await api.post(`/deposit-transactions/my/${dep.depositNo}/verification-session/submit`).expect(201);

    const a = await api.get(`/deposit-transactions/my/${dep.depositNo}/verification-session`);

    await freezeDeposit(dep);   // 走 admin freeze 端点
    expect((await getDeposit(dep)).status).toBe('FROZEN');

    const b = await api.get(`/deposit-transactions/my/${dep.depositNo}/verification-session`);
    expect(b.body).toEqual(a.body);
  });
```

（`seedDepositInCompliancePending` / `fireVerdict` / `getDeposit` / `api` 沿用该文件既有 helper；`freezeDeposit` 若无则照该文件既有 admin 调用写法新增。）

- [ ] **Step 3: 跑 e2e**

```bash
npx jest --config ./test/jest-e2e.json test/deposit-sumsub-verdicts.e2e-spec.ts
```

预期：原 14 条 + 新 2 条全绿。**该文件头部的 `e2e-` 库名硬守卫不得删改。**

- [ ] **Step 4: 四道硬闸**

```bash
npx tsc --noEmit
npx jest
cd client-web && npx vitest run && npx tsc --noEmit && cd ..
bash scripts/on-stack.sh self demo:all
```

`npx jest` 允许存在既有的 wallets 相关失败（pre-existing），但**净新增失败必须为 0**——跑之前先在 `main` 基线上记一次失败数，比对。

- [ ] **Step 5: 同步 truth 文档**

`doc-final/reference/truth/v4-deposit.md`：
- `ACTION_PENDING` 段落补：三个新字段、客户补料交互、SLA 换表的派生规则
- 客户端呈现段落补：态①/③ 与「已收到」绑 `actionSubmittedAt` 的理由
- 客户面白名单段落补：`actionSubmittedAt` 是唯一开口及其理由
- 更新 `Last Verified` 行，写明本次核对方式

`doc-final/reference/truth/sumsub-ingestion.md`：
- 第 3 节补：`applicantActions[]` 从 `getTxn` 经 handler 透传到充值单
- 第 4 节缺口：`createActionSdkToken()` 两处缺陷（见下）

- [ ] **Step 6: 登记 BACKLOG**

`doc-final/BACKLOG.md` 加三行：

```markdown
- **`createActionSdkToken()` 真接 Sumsub 必炸**（`identity/onboarding/providers/sumsub/sumsub.client.ts:118`）：`userId` 传的是 Sumsub 侧 `applicantId`，官方定义要求传我方 `externalUserId`（真实数据里两者不同）；且缺 applicant action 场景必填的 `externalActionId`。现被 `SUMSUB_MOCK_MODE=true` 假返回掩盖。属 V2 材料重检路径，接真实 Sumsub 前必修。
- **未提交即被冻时 `ACTION REQUIRED` 消失可被观测**（`client-web/src/utils/depositStatusView.ts`）：客户尚未提交就被冻结时，索要材料的提示会消失。2026-08-04 有意不堵——要堵只能在冻结后继续向客户索要我方根本不会审阅的文件。属合规口径，业主可覆盖。
- **`websdkLink` 返回 url 的 iframe 可行性未实测**：身份验证类托管页通常设 `X-Frame-Options`。当前走 `accessTokens/sdk` token 路线不依赖它；若将来改跳转路线需实测。
```

- [ ] **Step 7: 提交**

```bash
git add admin-web/src test doc-final
git commit -m "feat(deposit): admin 两行 + e2e 补料完整弧与接口不可区分 + truth/BACKLOG 同步

e2e 两条:①完整弧证明客户提交不动状态机、戳落表重置、操作员放行后 SUCCESS
②已提交的单在 ACTION_PENDING 与 FROZEN 上会话响应体全等(接口层不可区分)。
BACKLOG 登记三项:createActionSdkToken 真接必炸、未提交即被冻的可观测性、
websdkLink iframe 可行性未实测。"
```

---

- [ ] **Step 8（增补）：把客户端测试真正接进项目——现在那道闸门是假的**

实施期核查发现：`client-web` **没有 `test` 脚本、`vitest` 不在 `devDependencies`、没有任何
vitest 配置**。也就是说 `depositStatusView.spec.ts`（含本次那条经双向变异验证的 tipping-off
守卫）以及**已经合进 main 的 `withdrawStatusView.spec.ts`**，从来没有被任何项目命令跑过 ——
只有人手动敲 `npx vitest run --globals` 才有信号。

**没人跑的守卫不是守卫。** 将来谁把 `note: 'Please contact support'` 加回 `VIEW_MAP`，
不会有任何红灯。本任务的交付物之一恰好就是这条守卫，所以必须把闸门做成真的。

改 `client-web/package.json`：

```json
  "scripts": {
    …
    "test": "vitest run"
  },
  "devDependencies": {
    …
    "vitest": "^3.2.4"
  }
```

新建 `client-web/vitest.config.ts`：

```ts
import { defineConfig } from 'vitest/config';

// spec 文件不 import { describe, it, expect }（沿用 jest 风格的全局），
// 故必须开 globals；不开的话所有 spec 会以 "describe is not defined" 整体失败。
export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.spec.ts'],
  },
});
```

装依赖并验证（**只在 `client-web/` 目录内跑 npm，别动仓库根或后端的 lockfile**）：

```bash
cd client-web && npm install
npm test
```

预期：两个 spec 文件都被收进来并全绿（`depositStatusView.spec.ts` + `withdrawStatusView.spec.ts`），
且**不再需要 `--globals`**。若 `withdrawStatusView.spec.ts` 有失败，**不要改它**——
那是 main 上既有的问题，如实写进报告由我裁决。

装完确认 `client-web/package-lock.json` 的改动只有 vitest 及其传递依赖，没有把别的包顺手升级。

## 自查清单（执行完全部任务后逐条核对）

- [ ] `git grep -n "Please contact support" client-web/src/pages/Deposit.tsx` → 无输出
- [ ] `git grep -n "manualReason" client-web/src` → 无输出（客户端绝不该见到它）
- [ ] `getDepositStatusView` 的全部调用点都传了 `submitted`（列表 + 弹窗）
- [ ] 变异测试在 T3、T5 都真实跑过并见到红灯（不是"应该会红"）
- [ ] `test/deposit-sumsub-verdicts.e2e-spec.ts` 头部 `e2e-` 硬守卫仍在
- [ ] `npx jest` 净新增失败为 0（与 main 基线比对过）
- [ ] Task 6 Step 8 的第 5 条截图确认过"冻结前后客户端逐字不变"
