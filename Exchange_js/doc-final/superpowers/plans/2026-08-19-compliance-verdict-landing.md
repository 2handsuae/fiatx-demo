# 合规裁决落地的正确性与可取证性 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让三条交易主干（充值/提现/兑换）在收到 Sumsub 合规裁决时，先判定该不该理、再决定写不写证据，并且凡是「收到了但不理」都留下一条可取证的审计。

**Architecture:** 三个域的 `applyKytVerdict` 一律重构成**解析 → 判定 → 落地**三段。新增私有方法 `decideVerdictLanding(status, verdict)` 返回落地档位，**判定必须先于任何写库动作**。忽略档位强制写审计。另修 webhook 去重键，防止真实链路吞掉同一客户的第二条 KYT 裁决。

**Tech Stack:** NestJS 10 · Prisma 5 (SQLite) · Jest · TypeScript

## Global Constraints

以下约束逐条来自 spec `doc-final/superpowers/specs/2026-08-19-compliance-verdict-landing-design.md` §4，**破任何一条必须回头找业主重新拍板**：

- **不动状态机** —— 零新增状态、零新增转移边。三域的 `*-transactions.service.ts` 里的 transitions 表一行不改。
- **不动数据库 schema** —— 零 migration、零 `prisma/schema.prisma` 变更、零重铺。
- **不动记账** —— TigerBeetle 相关文件零改动，一分钱不碰。
- **不动前端** —— `admin-web/` 与 `client-web/` 零文件改动。
- **判定集合成员不得合并** —— 三域忽略集合的成员语义不同（充值 8 态含三个在途处置态、提现纯终态、兑换含 REJECTED/SUCCESS carve-out），统一的是**结构**不是**成员**。
- **审计幂等键保留随机数** —— 业主 2026-08-19 拍板：同一笔单收到 3 次迟到裁决写 3 行审计。`requestId` 一律拼 `randomUUID()`。这是有意为之，勿"顺手优化"成稳定键。
- **`.catch` 不可省** —— 审计写入失败不得把一个本该静默忽略的 webhook 变成异常（否则进 FAILED → 重试 → 死信）。但必须从哑吞改成记 error 日志。
- 全程 `npx tsc --noEmit -p tsconfig.json` 必须 0 错。

---

## File Structure

| 文件 | 职责 | 本计划中的角色 |
|---|---|---|
| `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` | 充值工作流编排 | 改：`applyKytVerdict` 三段化 + 新增 `decideVerdictLanding` / `recordVerdictIgnored` |
| `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` | 提现工作流编排 | 改：同上 + 两处补审计 |
| `src/modules/trading/swap-transactions/swap-workflow.service.ts` | 兑换工作流编排 | 改：同上（审计点必须在 carve-out 之后） |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | 审计动作名单一真相源 | 加：2 个常量 |
| `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | Sumsub webhook 摄入与去重 | 改：`buildDedupeKey` 加交易号维度 |
| `test/kyt-verdict-landing.e2e-spec.ts` | 第一批端到端验收 | 建 |

三个 workflow 文件都已很大（2951 / 2738 / 1477 行）。本计划**不拆文件** —— 新增的两个私有方法紧邻 `applyKytVerdict` 放置，改动面保持最小；拆文件属独立重构，不裹进本批。

---

## Task 1: 充值 — 判定先于写库 + FROZEN 证据保护

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:317-395`
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: 无（本任务是起点）
- Produces: 私有方法形状 `decideVerdictLanding(status, verdict): 'IGNORE' | 'DISPATCH'` 与 `recordVerdictIgnored(entity, v, status): Promise<void>`。Task 2、3 各自在自己的域里**镜像这个形状**（deliberate fork，不抽公共基类 —— 与本仓库既有约定一致），签名与命名必须逐字一致，便于日后 grep 三域对照。

- [ ] **Step 1: 写失败测试 —— FROZEN 收到迟到的非 approved 裁决，证据必须一个字不动**

在 `deposit-workflow.service.spec.ts` 里 `describe('applyKytVerdict', ...)` 块内（紧跟现有 A5 那组 `it.each` 之后）加：

```typescript
    // ── 第一批 (2026-08-19): FROZEN 下没有任何 verdict 能合法推动状态机 ─────────
    // 修复前 approvedWillNoOpFrozen 只挡 approved，一条迟到的 onHold 会先把
    // 制裁裁决/风险分/原始报文整份覆盖，然后才因状态守卫静默 no-op —— 零报错、
    // 零审计。这是"先写后判"正在流血的口子。
    it.each(['onHold', 'awaitUser', 'rejected'] as const)(
      'B1: FROZEN 收到迟到 %s → 不覆写裁决/存证 + IGNORED 审计 + 不抛',
      async (verdict) => {
        depositService.findOne.mockResolvedValue({
          id: 'dep-b1',
          depositNo: 'DEPB1',
          status: DepositTransactionStatus.FROZEN,
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          traceId: null,
        });

        await expect(
          service.applyKytVerdict('dep-b1', {
            verdict,
            riskScore: 50,
            detailRaw: { late: true },
          }),
        ).resolves.toBeUndefined();

        expect(depositService.updateSumsubVerdict).not.toHaveBeenCalled();
        expect(depositService.saveTxnDetail).not.toHaveBeenCalled();
        expect(depositService.updateStatus).not.toHaveBeenCalled();
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED,
            entityNo: 'DEPB1',
          }),
        );
      },
    );

    it('B1: 审计写失败不得把 no-op 裁决变成异常（.catch 是 load-bearing）', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-b1b',
        depositNo: 'DEPB1B',
        status: DepositTransactionStatus.SUCCESS,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });
      auditLogsService.recordSystem.mockRejectedValueOnce(new Error('audit down'));

      await expect(
        service.applyKytVerdict('dep-b1b', { verdict: 'rejected' }),
      ).resolves.toBeUndefined();
    });
```

- [ ] **Step 2: 跑测试确认它红**

Run: `npx jest deposit-workflow.service.spec -t "B1:" 2>&1 | tail -30`
Expected: FAIL —— 三个 `it.each` 用例报 `expect(updateSumsubVerdict).not.toHaveBeenCalled()` 收到 1 次调用。

- [ ] **Step 3: 加落地档位类型与判定方法**

在 `deposit-workflow.service.ts` 的 `KYT_VERDICT_IGNORED_STATUSES` 常量声明**之前**，加文件级类型（紧跟 import 段之后、`@Injectable()` 之前）：

```typescript
/**
 * 裁决落地档位（第一批 · 2026-08-19）。
 *   IGNORE   —— 这条裁决不会推动状态机，也不该留在订单上：不写证据、不推状态、必写审计
 *   DISPATCH —— 正常分发到四个 verdict 分支：写证据、推状态
 * 铁律：判定必须先于任何写库动作。见 spec §2.1。
 */
type VerdictLanding = 'IGNORE' | 'DISPATCH';
```

在 `applyKytVerdict` 方法**之后**（`writeBackVerdict` 之前）加两个私有方法：

```typescript
  /**
   * 判定这条裁决该怎么落地。**必须在任何写库动作之前调用。**
   *
   * FROZEN 一律判 IGNORE 的依据：该状态下没有任何 verdict 能合法推动状态机 ——
   *   approved  → applyKytApproved 自己的 FROZEN 守卫 no-op
   *   onHold    → applyKytOnHold 的 status !== COMPLIANCE_PENDING 守卫 no-op
   *   awaitUser → applyKytAwaitUser 全段无 FROZEN 守卫，updateStatus 从 FROZEN
   *               推 ACTION_PENDING 必抛（FROZEN 只有 RESUME/SEIZE 两条出边）
   *   rejected  → SANCTION/FROZEN_BY_MLRO 支要 FREEZE，无自环边，必抛
   * 修复前只有 approvedWillNoOpFrozen 挡 approved 一种，其余三种会先把制裁证据
   * 整份覆盖再静默 no-op。**注意：FROZEN 不加进 KYT_VERDICT_IGNORED_STATUSES**
   * —— 那个集合另有语义（在途处置态），且加进去会影响别处的读取。
   */
  private decideVerdictLanding(
    status: DepositTransactionStatus,
    _verdict: 'approved' | 'rejected' | 'awaitUser' | 'onHold',
  ): VerdictLanding {
    if (DepositWorkflowService.KYT_VERDICT_IGNORED_STATUSES.has(status)) return 'IGNORE';
    if (status === DepositTransactionStatus.FROZEN) return 'IGNORE';
    return 'DISPATCH';
  }

  /**
   * 忽略 ≠ 静默：落一条审计，取证时能指着说"系统收到了、判定不适用、记下来了"。
   *
   * requestId 拼 randomUUID 是**有意为之**（业主 2026-08-19 拍板）：同一笔单收到
   * 3 次迟到裁决要写 3 行，"来了几次"本身是证据。audit-logs.service 的 requestId
   * 去重能力在此被刻意关闭，勿改成稳定键。
   *
   * .catch 是 load-bearing：三个 handler 全无 try/catch，异常会上抛到
   * SumsubIngestionService 的 dispatch catch → retryCount+1 → >=3 进 DEAD。
   * 审计写失败不该把一个本该静默忽略的 webhook 变成死信。但不再哑吞 —— 记 error。
   */
  private async recordVerdictIgnored(
    deposit: any,
    v: { verdict: string; riskScore?: number | null },
    status: DepositTransactionStatus,
  ): Promise<void> {
    await this.auditLogsService
      .recordSystem({
        action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        result: AuditResult.SUCCESS,
        reason: `Late KYT verdict '${v.verdict}' ignored — deposit is ${status} (terminal, disposition in flight, or frozen); existing verdict/evidence left untouched`,
        metadata: {
          depositNo: deposit.depositNo,
          verdict: v.verdict,
          status,
          riskScore: v.riskScore ?? null,
        },
        requestId: `DEPOSIT_KYT_VERDICT_IGNORED_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'SYSTEM',
      })
      .catch((err) => {
        this.logger.error(
          `DEPOSIT_KYT_VERDICT_IGNORED audit failed for ${deposit.depositNo}: ${err?.message}`,
        );
      });
  }
```

- [ ] **Step 4: 把 applyKytVerdict 改成三段结构**

把 `applyKytVerdict` 里从 `const status = deposit.status as DepositTransactionStatus;` 到 `switch (v.verdict) {` 之前的**整段**（原第 335-380 行，含忽略分支的内联审计块与 `approvedWillNoOpFrozen` 块）替换为：

```typescript
    // ── ② 判定：必须先于任何写库动作（spec §2.1）──────────────────────────
    const status = deposit.status as DepositTransactionStatus;
    const landing = this.decideVerdictLanding(status, v.verdict);

    if (landing === 'IGNORE') {
      this.logger.debug(
        `applyKytVerdict no-op: deposit ${depositId} in ignored status (${status})`,
      );
      await this.recordVerdictIgnored(deposit, v, status);
      return;
    }

    // ── ③ 落地：判定已过 DISPATCH，此刻才允许写证据 ────────────────────────
    // 闸门字段回写：状态机负责"这笔单去哪"，闸门字段负责"operator 看得出为什么"。
    await this.writeBackVerdict(deposit, v.verdict, v.riskScore);

    // Sumsub getTxn 原始报文存证。
    if (v.detailRaw !== undefined) {
      await this.depositService.saveTxnDetail(deposit.id, JSON.stringify(v.detailRaw));
    }
```

- [ ] **Step 5: 修一条会被本改动打红的既有测试**

`deposit-workflow.service.spec.ts:2135-2149` 那条 `no-op when already FROZEN and a duplicate rejected+SANCTION webhook arrives` 断言 `expect(auditLogsService.recordSystem).not.toHaveBeenCalled()`。本批改完 FROZEN 会写 IGNORED 审计，该断言必红。改成：

```typescript
    it('no-op when already FROZEN and a duplicate rejected+SANCTION webhook arrives', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-10',
        depositNo: 'DEP010',
        status: DepositTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('dep-10', { verdict: 'rejected', sceneTag: 'SANCTION' });

      expect(depositService.updateStatus).not.toHaveBeenCalled();
      // 第一批 (2026-08-19)：FROZEN 现在判 IGNORE，忽略 ≠ 静默 —— 状态不动但要留痕。
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED }),
      );
    });
```

- [ ] **Step 6: 跑全量充值单测**

Run: `npx jest deposit-workflow.service.spec 2>&1 | tail -20`
Expected: PASS，且失败数为 0。若有其它用例红，逐条核对是不是同类"断言 FROZEN 不写审计"的既有假设，按 Step 5 同法订正；**不要**为了让测试变绿而回退实现。

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit -p tsconfig.json && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 8: 提交**

```bash
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "fix(deposit): 裁决落地改判定先于写库，FROZEN 下证据不再被迟到裁决覆盖"
```

---

## Task 2: 提现 — 同款三段化 + 补两处缺失审计

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（提现段，现有 `WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 在 :417 附近）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:2302-2390`
- Test: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 定义的方法形状 `decideVerdictLanding` / `recordVerdictIgnored`（镜像，不共享代码）
- Produces: 新审计常量 `AuditActions.WITHDRAW_KYT_VERDICT_IGNORED`（字符串值 `'WITHDRAW_KYT_VERDICT_IGNORED'`），Task 5 的 e2e 断言它

提现比充值多一个档位：`PAYOUT_PENDING` 要**写证据但不推状态**（既有 Review Fix 2 的行为），故落地档位是三个。

- [ ] **Step 1: 加审计常量**

在 `audit-actions.constant.ts` 的 `WITHDRAW_REFUND_TAG_ON_FROZEN_IGNORED` 那一行**之后**加：

```typescript
  WITHDRAW_KYT_VERDICT_IGNORED: 'WITHDRAW_KYT_VERDICT_IGNORED',
```

- [ ] **Step 2: 写失败测试**

在 `withdraw-workflow.service.spec.ts` 的 `describe('applyKytVerdict', ...)` 块内加：

```typescript
    // ── 第一批 (2026-08-19): 三段结构 —— 判定先于写库 ──────────────────────
    it.each(['onHold', 'awaitUser', 'rejected'] as const)(
      'B2: FROZEN 收到迟到 %s → 不覆写证据 + IGNORED 审计 + 不抛',
      async (verdict) => {
        withdrawService.findOneInternal.mockResolvedValue({
          id: 'wd-b2',
          withdrawNo: 'WDB2',
          status: WithdrawTransactionStatus.FROZEN,
          ownerType: 'CUSTOMER',
          ownerId: 'cust-1',
          traceId: null,
        });

        await expect(
          service.applyKytVerdict('wd-b2', {
            verdict,
            riskScore: 50,
            detailRaw: { late: true },
          }),
        ).resolves.toBeUndefined();

        expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
        expect(withdrawService.updateStatus).not.toHaveBeenCalled();
        expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
          expect.objectContaining({
            action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED,
            entityNo: 'WDB2',
          }),
        );
      },
    );

    it('B2: FROZEN 收到迟到 approved → 同样留痕（此前只有 logger.debug）', async () => {
      withdrawService.findOneInternal.mockResolvedValue({
        id: 'wd-b2b',
        withdrawNo: 'WDB2B',
        status: WithdrawTransactionStatus.FROZEN,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('wd-b2b', { verdict: 'approved' });

      expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED }),
      );
    });

    it('B2: SUCCESS 终态收到迟到 rejected → 留痕（此前零审计）', async () => {
      withdrawService.findOneInternal.mockResolvedValue({
        id: 'wd-b2c',
        withdrawNo: 'WDB2C',
        status: WithdrawTransactionStatus.SUCCESS,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('wd-b2c', { verdict: 'rejected', riskScore: 98 });

      expect(withdrawService.saveSumsubVerdict).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED,
          metadata: expect.objectContaining({ verdict: 'rejected', riskScore: 98 }),
        }),
      );
    });
```

- [ ] **Step 3: 跑测试确认它红**

Run: `npx jest withdraw-workflow.service.spec -t "B2:" 2>&1 | tail -30`
Expected: FAIL —— `WITHDRAW_KYT_VERDICT_IGNORED` 从未被调用。

- [ ] **Step 4: 加类型与两个私有方法**

在 `withdraw-workflow.service.ts` 的 import 段之后、`@Injectable()` 之前加：

```typescript
/**
 * 裁决落地档位（第一批 · 2026-08-19），与充值域镜像（deliberate fork，不共享代码）。
 *   IGNORE        —— 不写证据、不推状态、必写审计
 *   EVIDENCE_ONLY —— 写证据、不推状态、写审计（PAYOUT_PENDING：钱已广播，无合法边）
 *   DISPATCH      —— 写证据、推状态
 */
type VerdictLanding = 'IGNORE' | 'EVIDENCE_ONLY' | 'DISPATCH';
```

在 `applyKytVerdict` 方法之后加：

```typescript
  /**
   * 判定这条裁决该怎么落地。**必须在任何写库动作之前调用。**
   *
   * FROZEN 一律判 IGNORE：该状态下没有任何 verdict 能合法推动状态机（出口走 §4
   * 双审批弧，不是 approve）。修复前只有 approvedWillNoOpFrozen 挡 approved 一种，
   * 迟到的 onHold/awaitUser/rejected 会先把制裁证据整份覆盖再静默 no-op。
   *
   * PAYOUT_PENDING 判 EVIDENCE_ONLY：钱已广播、四个 verdict 分支都没有合法边，
   * 但证据仍要留（既有 Review Fix 2 的行为，本次只是把它显式化成一个档位）。
   */
  private decideVerdictLanding(
    status: WithdrawTransactionStatus,
    _verdict: 'approved' | 'rejected' | 'awaitUser' | 'onHold',
  ): VerdictLanding {
    if (WithdrawWorkflowService.KYT_VERDICT_TERMINAL_STATUSES.has(status)) return 'IGNORE';
    if (status === WithdrawTransactionStatus.FROZEN) return 'IGNORE';
    if (status === WithdrawTransactionStatus.PAYOUT_PENDING) return 'EVIDENCE_ONLY';
    return 'DISPATCH';
  }

  /**
   * 忽略 ≠ 静默。requestId 拼 randomUUID 是有意为之（业主 2026-08-19 拍板：
   * 3 次写 3 行）。.catch 是 load-bearing（审计失败不得让 webhook 进死信），
   * 但记 error 不哑吞。与充值域 recordVerdictIgnored 逐字镜像。
   */
  private async recordVerdictIgnored(
    w: any,
    input: { verdict: string; riskScore?: number | null },
    status: WithdrawTransactionStatus,
  ): Promise<void> {
    await this.auditLogsService
      .recordSystem({
        action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `Late KYT verdict '${input.verdict}' ignored — withdrawal is ${status} (terminal or frozen); existing verdict/evidence left untouched`,
        metadata: {
          withdrawNo: w.withdrawNo,
          verdict: input.verdict,
          status,
          riskScore: input.riskScore ?? null,
        },
        requestId: `WITHDRAW_KYT_VERDICT_IGNORED_${w.withdrawNo}_${randomUUID()}`,
        sourcePlatform: 'SYSTEM',
      })
      .catch((err) => {
        this.logger.error(
          `WITHDRAW_KYT_VERDICT_IGNORED audit failed for ${w.withdrawNo}: ${err?.message}`,
        );
      });
  }
```

若 `randomUUID` 尚未 import，在文件顶部加 `import { randomUUID } from 'crypto';`。

- [ ] **Step 5: 把 applyKytVerdict 改成三段结构**

把从 `const status = w.status as WithdrawTransactionStatus;` 到 PAYOUT_PENDING 那个 `if` 块结束（原第 2315-2372 行）**整段**替换为：

```typescript
    // ── ② 判定：必须先于任何写库动作（spec §2.1）──────────────────────────
    const status = w.status as WithdrawTransactionStatus;
    const landing = this.decideVerdictLanding(status, input.verdict);

    if (landing === 'IGNORE') {
      this.logger.debug(
        `applyKytVerdict no-op: withdrawal ${withdrawId} in ignored status (${status})`,
      );
      await this.recordVerdictIgnored(w, input, status);
      return;
    }

    // ── ③ 落地：判定已过，此刻才允许写证据 ────────────────────────────────
    await this.withdrawService.saveSumsubVerdict(w.id, {
      verdict: input.verdict,
      score: input.riskScore ?? null,
      scoredAt: new Date(),
      ...(input.detailRaw !== undefined && { detailJson: JSON.stringify(input.detailRaw) }),
    });

    if (landing === 'EVIDENCE_ONLY') {
      // PAYOUT_PENDING：钱已广播，四个分支都没有合法边。证据已存，只审计 + 标记待复核。
      await this.auditLogsService.recordSystem({
        action: AuditActions.WITHDRAW_POST_BROADCAST_VERDICT,
        entityType: AuditEntityTypes.WITHDRAW_TRANSACTION,
        entityId: w.id,
        entityNo: w.withdrawNo,
        entityOwnerType: w.ownerType,
        entityOwnerId: w.ownerId,
        traceId: w.traceId || undefined,
        workflowType: AuditWorkflowTypes.WITHDRAW,
        reason: `KYT verdict '${input.verdict}' received after payout broadcast — no state-machine action taken`,
        metadata: { verdict: input.verdict },
        sourcePlatform: 'SYSTEM',
      });
      if (input.verdict === 'rejected') {
        await this.withdrawService.markNeedsReview(w.id);
      }
      return;
    }
```

- [ ] **Step 6: 跑全量提现单测**

Run: `npx jest withdraw-workflow.service.spec 2>&1 | tail -20`
Expected: PASS。若既有用例因"FROZEN 不写审计"的旧假设变红，按 Task 1 Step 5 同法订正断言，**不要回退实现**。

- [ ] **Step 7: 类型检查 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json && echo TSC_OK`
Expected: `TSC_OK`

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts
git commit -m "fix(withdraw): 裁决落地三段化，FROZEN 与终态忽略分支补审计留痕"
```

---

## Task 3: 兑换 — 三段化 + 忽略留痕（carve-out 之后）

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（兑换段，现有 SWAP_* 常量在 :327-345 附近）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts:490-560`
- Test: `src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的方法形状（镜像）
- Produces: 新审计常量 `AuditActions.SWAP_KYT_VERDICT_IGNORED`（值 `'SWAP_KYT_VERDICT_IGNORED'`）

⚠️ 兑换已经是"先判后写"，本任务**不改它的顺序**，只补三件事：显式化档位、忽略分支补审计、审计点必须落在 carve-out **之后**。

- [ ] **Step 1: 加审计常量**

在 `audit-actions.constant.ts` 的 SWAP 段（`SWAP_KYT_REJECTED_DISPOSED` 附近）加：

```typescript
  SWAP_KYT_VERDICT_IGNORED: 'SWAP_KYT_VERDICT_IGNORED',
```

- [ ] **Step 2: 写失败测试**

在 `swap-workflow.service.spec.ts` 的 `describe('applyKytVerdict', ...)` 块内加：

```typescript
    // ── 第一批 (2026-08-19): 忽略 ≠ 静默 ─────────────────────────────────
    it('B3: SUCCESS 收到迟到 approved → 写 IGNORED 审计、不动订单', async () => {
      swapTransactionsService.findByIdInternal.mockResolvedValue({
        id: 'swap-b3',
        swapNo: 'SWPB3',
        status: SwapTransactionStatus.SUCCESS,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('swap-b3', { verdict: 'approved' });

      expect(swapTransactionsService.markStatus).not.toHaveBeenCalled();
      expect(swapTransactionsService.saveSumsubVerdict).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: AuditActions.SWAP_KYT_VERDICT_IGNORED,
          entityNo: 'SWPB3',
        }),
      );
    });

    it('B3: REJECTED 收到迟到 rejected → 仍跑处置，且【不】写 IGNORED（carve-out 保留）', async () => {
      swapTransactionsService.findByIdInternal.mockResolvedValue({
        id: 'swap-b3b',
        swapNo: 'SWPB3B',
        status: SwapTransactionStatus.REJECTED,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: null,
      });

      await service.applyKytVerdict('swap-b3b', {
        verdict: 'rejected',
        typedTags: ['SANCTION'],
      });

      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.SWAP_KYT_VERDICT_IGNORED }),
      );
    });
```

- [ ] **Step 3: 跑测试确认它红**

Run: `npx jest swap-workflow.service.spec -t "B3:" 2>&1 | tail -30`
Expected: 第一条 FAIL（`SWAP_KYT_VERDICT_IGNORED` 从未调用），第二条可能已 PASS（carve-out 本就存在）。

- [ ] **Step 4: 加 recordVerdictIgnored 并接到忽略分支**

在 `swap-workflow.service.ts` 的 `applyKytVerdict` 之后加：

```typescript
  /**
   * 忽略 ≠ 静默（第一批 · 2026-08-19，与充值/提现域镜像）。
   *
   * ⚠️ 调用点必须在 REJECTED/SUCCESS + rejected 的 carve-out **之后** ——
   * 那条 carve-out 会去跑 handleRejectDisposition（写 SWAP_KYT_REJECTED_DISPOSED），
   * 若在它之前写 IGNORED，同一事件会既"已忽略"又"已处置"，自相矛盾。
   *
   * requestId 拼 randomUUID 是有意为之（3 次写 3 行）。.catch 记 error 不哑吞。
   */
  private async recordVerdictIgnored(
    swap: any,
    input: { verdict: string; riskScore?: number | null },
    status: SwapTransactionStatus,
  ): Promise<void> {
    await this.auditLogsService
      .recordSystem({
        action: AuditActions.SWAP_KYT_VERDICT_IGNORED,
        entityType: AuditEntityTypes.SWAP_TRANSACTION,
        entityId: swap.id,
        entityNo: swap.swapNo,
        entityOwnerType: swap.ownerType,
        entityOwnerId: swap.ownerId,
        traceId: swap.traceId || undefined,
        workflowType: AuditWorkflowTypes.SWAP,
        reason: `Late KYT verdict '${input.verdict}' ignored — swap is ${status} (terminal); existing verdict/evidence left untouched`,
        metadata: {
          swapNo: swap.swapNo,
          verdict: input.verdict,
          status,
          riskScore: input.riskScore ?? null,
        },
        requestId: `SWAP_KYT_VERDICT_IGNORED_${swap.swapNo}_${randomUUID()}`,
        sourcePlatform: 'SYSTEM',
      })
      .catch((err) => {
        this.logger.error(
          `SWAP_KYT_VERDICT_IGNORED audit failed for ${swap.swapNo}: ${err?.message}`,
        );
      });
  }
```

- [ ] **Step 5: 接到忽略分支（carve-out 之后那一行）**

把 `applyKytVerdict` 里终态分支末尾的这一行：

```typescript
      this.logger.debug(`applyKytVerdict no-op: swap ${swapId} already terminal (${status})`);
      return;
```

替换为：

```typescript
      this.logger.debug(`applyKytVerdict no-op: swap ${swapId} already terminal (${status})`);
      // 第一批 (2026-08-19)：忽略 ≠ 静默。位置刻意在 carve-out 之后 —— 走到这里
      // 说明这条裁决既不推状态机、也不触发处置，是真正的 no-op，才该记 IGNORED。
      await this.recordVerdictIgnored(swap, input, status);
      return;
```

- [ ] **Step 6: 跑全量兑换单测 + 类型检查**

Run: `npx jest swap-workflow.service.spec 2>&1 | tail -20`
Expected: PASS

Run: `npx tsc --noEmit -p tsconfig.json && echo TSC_OK`
Expected: `TSC_OK`

- [ ] **Step 7: 提交**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/trading/swap-transactions/swap-workflow.service.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts
git commit -m "fix(swap): 终态忽略分支补 IGNORED 审计，位置落在处置 carve-out 之后"
```

---

## Task 4: 去重键补交易号 — 防真实链路吞掉第二条裁决

**Files:**
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:570-583`
- Test: `src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts`

**Interfaces:**
- Consumes: 无
- Produces: 无对外签名变更（`buildDedupeKey` / `extractDedupeKey` 均为 private）

KYT 交易裁决报文不带 `reviewId` / `attemptId`，于是同一客户的第二条同类型裁决键与第一条逐字相同 → 命中旧 `PROCESSED` 行直接 return，新裁决不落行、不派发。模拟入口跳过去重（`!options.isSimulated`），所以演示不复现、真实链路必中。`kytTxnId` 字段确认存在（`deposit-kyt-verdict.handler.ts:51` 已在读它）。

- [ ] **Step 1: 写失败测试**

在 `sumsub-ingestion.service.spec.ts` 加：

```typescript
  describe('buildDedupeKey (第一批 2026-08-19)', () => {
    it('B4: 同一客户两条 KYT 裁决，交易号不同 → 去重键必须不同', () => {
      const build = (service as any).buildDedupeKey.bind(service);
      const first = build({
        type: 'applicantKytTxnApproved',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        kytTxnId: 'txn-A',
      });
      const second = build({
        type: 'applicantKytTxnRejected',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        kytTxnId: 'txn-B',
      });
      const sameTypeDiffTxn = build({
        type: 'applicantKytTxnApproved',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        kytTxnId: 'txn-B',
      });

      expect(first).not.toBe(second);
      // 关键：同 type + 同客户，仅交易号不同，也必须区分开
      expect(first).not.toBe(sameTypeDiffTxn);
    });

    it('B4: 非 KYT 事件无 kytTxnId → 行为与改动前一致（不因空串塌成同一把键）', () => {
      const build = (service as any).buildDedupeKey.bind(service);
      const a = build({
        type: 'applicantReviewed',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        reviewResult: { reviewId: 'r-1', attemptId: 'a-1' },
      });
      const b = build({
        type: 'applicantReviewed',
        applicantId: 'app-1',
        externalUserId: 'cust-1',
        reviewResult: { reviewId: 'r-2', attemptId: 'a-2' },
      });
      expect(a).not.toBe(b);
    });
  });
```

- [ ] **Step 2: 跑测试确认它红**

Run: `npx jest sumsub-ingestion.service.spec -t "B4:" 2>&1 | tail -20`
Expected: 第一条 FAIL —— `first` 与 `sameTypeDiffTxn` 相等（都是 `applicantKytTxnApproved:app-1:cust-1::`）。

- [ ] **Step 3: 实现**

把 `buildDedupeKey` 替换为：

```typescript
  private buildDedupeKey(payload: Record<string, unknown>): string | null {
    const type = String(payload.type ?? '');
    const applicantId = String(payload.applicantId ?? '');
    const externalUserId = String(payload.externalUserId ?? '');
    const reviewResult = payload.reviewResult as Record<string, unknown> | undefined;
    const reviewId = String(reviewResult?.reviewId ?? payload.reviewId ?? '');
    const attemptId = String(reviewResult?.attemptId ?? payload.attemptId ?? '');
    // 第一批 (2026-08-19)：KYT 交易裁决报文不带 reviewId/attemptId，于是同一客户的
    // 第二条同类型裁决键与第一条逐字相同 → 命中旧 PROCESSED 行直接 return，新裁决
    // 不落行、不派发。模拟入口跳过去重所以演示不复现，接真 Sumsub 必中。
    // kytTxnId 只有 KYT 事件带，其它事件为空串 —— 对既有行为无影响。
    const kytTxnId = String(payload.kytTxnId ?? '');
    if (!type || !applicantId) return null;
    return `${type}:${applicantId}:${externalUserId}:${reviewId}:${attemptId}:${kytTxnId}`;
  }
```

`extractDedupeKey` 无需改动（它直接转调 `buildDedupeKey`）。

- [ ] **Step 4: 跑测试 + 全量摄入单测**

Run: `npx jest sumsub-ingestion 2>&1 | tail -20`
Expected: PASS

- [ ] **Step 5: 类型检查 + 提交**

Run: `npx tsc --noEmit -p tsconfig.json && echo TSC_OK`
Expected: `TSC_OK`

```bash
git add src/modules/sumsub-ingestion/sumsub-ingestion.service.ts src/modules/sumsub-ingestion/sumsub-ingestion.service.spec.ts
git commit -m "fix(sumsub-ingestion): 去重键补 kytTxnId，防同客户第二条 KYT 裁决被吞"
```

---

## Task 5: 端到端验收 — spec §5 的 8 条

**Files:**
- Create: `test/kyt-verdict-landing.e2e-spec.ts`

**Interfaces:**
- Consumes: Task 1-4 的全部产出，特别是三个新审计常量
- Produces: 无

> ⚠️ **破坏性护栏 — 先读这段再动手。** 本仓库的 e2e suite 会 `deleteMany` 整表。
> 2026-07-31 曾**两次**因为 `DATABASE_URL` 指向常驻栈库而销毁真实在途验收数据
> （见 `test/deposit-sumsub-verdicts.e2e-spec.ts:12-30` 的注释与 `BACKLOG.md`）。
> 因此本 suite 必须：① 在**任何读 DATABASE_URL 的 import 之前**把它改指到
> `e2e-` 专用库；② 带一道 fail-closed 断言，库名不含 `e2e-` 就拒跑。
> 唯一的解析入口是 `test/e2e-db.ts` 导出的 `resolveE2eDatabaseUrl(fileName)`
> —— **它是该文件唯一的导出**，不要臆造别的 helper。

- [ ] **Step 1: 准备专用 e2e 库（一次性，跑测试前必须先做）**

```bash
E2E_URL="file:$(dirname "$(grep '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\"' | sed 's|^file:||')")/e2e-kyt-verdict-landing.db"
echo "e2e 库: $E2E_URL"
DATABASE_URL="$E2E_URL" npx prisma migrate deploy
DATABASE_URL="$E2E_URL" npm run db:base:sync
DATABASE_URL="$E2E_URL" npm run db:biz:init
```

Expected: 三条命令均成功，最后一条打印 seed 完成。

- [ ] **Step 2: 建文件 —— 头部样板（顺序不可调换）**

```typescript
import { resolveE2eDatabaseUrl } from './e2e-db';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Node 18 polyfill：@nestjs/schedule 需要 globalThis.crypto（Node 19+ 才稳定），
// 本 harness 不加载 src/main.ts，所以要在 AppModule 之前自己补。
// eslint-disable-next-line @typescript-eslint/no-var-requires
if (!globalThis.crypto) { (globalThis as any).crypto = require('crypto').webcrypto; }

// 必须在任何读 DATABASE_URL 的 import 之前执行。
process.env.DATABASE_URL = resolveE2eDatabaseUrl('e2e-kyt-verdict-landing.db');
process.env.SUMSUB_MOCK_MODE = 'true';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

// ── 破坏性护栏（2026-07-31 起，因为真的炸过两次）────────────────────────
if (!process.env.DATABASE_URL?.includes('e2e-')) {
  throw new Error(
    `[kyt-verdict-landing e2e] 拒绝运行：本 suite 会写入并清理交易表，但 DATABASE_URL ` +
      `当前指向 ${process.env.DATABASE_URL} —— 这看起来是常驻栈的验收库。` +
      `先按 Task 5 Step 1 建好 e2e- 专用库。`,
  );
}

import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/core/prisma/prisma.service';
import { SUMSUB_TXN_CLIENT } from '../src/modules/deposit-sumsub/sumsub-txn-client.interface';
import { MockSumsubTxnClient } from '../src/modules/deposit-sumsub/sumsub-txn-client.mock';
import { DepositWorkflowService } from '../src/modules/trading/deposit-transactions/deposit-workflow.service';
import { WithdrawWorkflowService } from '../src/modules/trading/withdraw-transactions/withdraw-workflow.service';
import { SwapWorkflowService } from '../src/modules/trading/swap-transactions/swap-workflow.service';
import { DepositTransactionStatus } from '../src/modules/trading/deposit-transactions/dto/deposit-transaction.dto';
import { WithdrawTransactionStatus } from '../src/modules/trading/withdraw-transactions/dto/withdraw-transaction.dto';
import { SwapTransactionStatus } from '../src/modules/trading/swap-transactions/dto/swap-transaction.dto';
import { AuditActions } from '../src/modules/audit-logging/constants/audit-actions.constant';
```

- [ ] **Step 3: 写 suite 骨架与自建 fixture**

**不要**用 `findFirstOrThrow` 去捞种子库里现成的单 —— 那会让用例依赖 seed 内容、且跨库不可复现。本 suite 自己插入所需状态的单据。

```typescript
describe('第一批 · 合规裁决落地 (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let customerId: string;
  let assetId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SUMSUB_TXN_CLIENT)
      .useClass(MockSumsubTxnClient)
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const customer = await prisma.customerMain.findFirstOrThrow();
    const asset = await prisma.asset.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    customerId = customer.id;
    assetId = asset.id;
  });

  afterAll(async () => {
    await app.close();
  });

  /** 插一笔指定状态的充值单，带完整的既有裁决证据（模拟"已因制裁冻结"）。 */
  async function seedFrozenDeposit(no: string) {
    return prisma.depositTransaction.create({
      data: {
        depositNo: no,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        amount: '5000',
        status: DepositTransactionStatus.FROZEN,
        sumsubVerdict: 'rejected',
        sumsubScore: 100,
        sumsubTxnDetailJson: JSON.stringify({ sanction: 'OFAC-HIT' }),
      },
    });
  }
```

> 若 `depositTransaction.create` 因必填列报错，按 `prisma/schema.prisma` 的 `DepositTransaction` 逐列补齐 —— **不要**把断言改宽来绕过。

- [ ] **Step 4: 写验收 1（充值 FROZEN 证据保护）**

```typescript
  it('验收1: FROZEN 制裁充值单收到迟到 onHold → 制裁证据一个字不动 + 留痕', async () => {
    const dep = await seedFrozenDeposit(`E2E-DEP-${Date.now()}`);

    await app
      .get(DepositWorkflowService)
      .applyKytVerdict(dep.id, { verdict: 'onHold', riskScore: 50, detailRaw: { late: true } });

    const after = await prisma.depositTransaction.findUniqueOrThrow({ where: { id: dep.id } });
    expect(after.sumsubVerdict).toBe('rejected');
    expect(after.sumsubScore).toBe(100);
    expect(after.sumsubTxnDetailJson).toBe(JSON.stringify({ sanction: 'OFAC-HIT' }));
    expect(after.status).toBe(DepositTransactionStatus.FROZEN);

    const audits = await prisma.auditLogEvent.findMany({
      where: { entityId: dep.id, action: AuditActions.DEPOSIT_KYT_VERDICT_IGNORED },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
```

- [ ] **Step 5: 跑验收 1，确认能起来**

Run: `npx jest --config ./test/jest-e2e.json kyt-verdict-landing -t "验收1" 2>&1 | tail -30`
Expected: PASS。若护栏抛错，回 Step 1 建库；若 `create` 报必填列缺失，按 Step 3 的提示补列。

- [ ] **Step 6: 写验收 3+4（提现连收 3 次 → 恰好 3 行）**

```typescript
  it('验收3+4: SUCCESS 提现连收 3 条迟到 rejected → 审计恰好 3 行', async () => {
    const wd = await prisma.withdrawTransaction.create({
      data: {
        withdrawNo: `E2E-WD-${Date.now()}`,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        assetId,
        amount: '100',
        status: WithdrawTransactionStatus.SUCCESS,
      },
    });
    const workflow = app.get(WithdrawWorkflowService);

    for (let i = 0; i < 3; i += 1) {
      await workflow.applyKytVerdict(wd.id, { verdict: 'rejected', riskScore: 98 });
    }

    const audits = await prisma.auditLogEvent.findMany({
      where: { entityId: wd.id, action: AuditActions.WITHDRAW_KYT_VERDICT_IGNORED },
    });
    expect(audits).toHaveLength(3);
  });
```

- [ ] **Step 7: 写验收 5+6（兑换 carve-out 与忽略留痕）**

```typescript
  it('验收5: REJECTED 兑换收到迟到 rejected → 仍跑处置，不写 IGNORED', async () => {
    const swap = await prisma.swapTransaction.create({
      data: {
        swapNo: `E2E-SWP-R-${Date.now()}`,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        fromAssetId: assetId,
        toAssetId: assetId,
        fromAmount: '100',
        toAmount: '100',
        exchangeRate: '1',
        status: SwapTransactionStatus.REJECTED,
      },
    });

    await app
      .get(SwapWorkflowService)
      .applyKytVerdict(swap.id, { verdict: 'rejected', typedTags: ['SANCTION'] });

    const ignored = await prisma.auditLogEvent.findMany({
      where: { entityId: swap.id, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
    });
    expect(ignored).toHaveLength(0);
  });

  it('验收6: SUCCESS 兑换收到迟到 approved → 写 IGNORED，不动订单', async () => {
    const swap = await prisma.swapTransaction.create({
      data: {
        swapNo: `E2E-SWP-S-${Date.now()}`,
        ownerType: 'CUSTOMER',
        ownerId: customerId,
        fromAssetId: assetId,
        toAssetId: assetId,
        fromAmount: '100',
        toAmount: '100',
        exchangeRate: '1',
        status: SwapTransactionStatus.SUCCESS,
      },
    });

    await app.get(SwapWorkflowService).applyKytVerdict(swap.id, { verdict: 'approved' });

    const after = await prisma.swapTransaction.findUniqueOrThrow({ where: { id: swap.id } });
    expect(after.status).toBe(SwapTransactionStatus.SUCCESS);
    const audits = await prisma.auditLogEvent.findMany({
      where: { entityId: swap.id, action: AuditActions.SWAP_KYT_VERDICT_IGNORED },
    });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });
});
```

（验收 2 由 Task 2 单测 `B2` 覆盖；验收 7 由 Task 4 单测覆盖；验收 8 由 Task 1 的"审计写失败不抛"用例覆盖 —— e2e 不重复造。）

- [ ] **Step 8: 跑全量硬闸**

先在**干净工作树**上记基线（若尚未记）：

```bash
git stash && npx jest 2>&1 | tail -5 && git stash pop
```

然后：

```bash
npx tsc --noEmit -p tsconfig.json && echo TSC_OK
npx jest 2>&1 | tail -8
npx jest --config ./test/jest-e2e.json kyt-verdict-landing 2>&1 | tail -8
```

Expected: `TSC_OK`；jest 失败数**不高于基线**；本 suite 4 条用例全绿。

- [ ] **Step 9: 提交**

```bash
git add test/kyt-verdict-landing.e2e-spec.ts
git commit -m "test(compliance): 第一批裁决落地 e2e 验收（专用 e2e 库 + 破坏性护栏）"
```

---

## Task 6: 真相文档同步（项目铁律：改代码 = 同步 truth）

**Files:**
- Modify: `doc-final/reference/truth/v4-deposit.md`
- Modify: `doc-final/reference/truth/v5-withdraw.md`
- Modify: `doc-final/reference/truth/v6-swap.md`
- Modify: `doc-final/reference/truth/sumsub-ingestion.md`

**Interfaces:**
- Consumes: Task 1-5 的全部实现
- Produces: 无代码产出

- [ ] **Step 1: 三份交易域 truth 各补一段「裁决落地三段结构」**

在每份文档的合规裁决章节（充值/提现的 L2 段、兑换的 §3）补入：

```markdown
- **裁决落地 = 解析 → 判定 → 落地三段**（第一批，2026-08-19）：`applyKytVerdict` 先调私有
  `decideVerdictLanding(status, verdict)` 得出落地档位，**判定先于任何写库动作**；
  `IGNORE` 档不写证据、不推状态、必写 `<域>_KYT_VERDICT_IGNORED` 审计（`requestId` 拼
  `randomUUID`，同一笔单收到 N 次写 N 行，业主 2026-08-19 拍板：来了几次本身是证据）。
  `FROZEN` 一律判 `IGNORE` —— 该状态下没有任何 verdict 能合法推动状态机，修复前只有
  `approvedWillNoOpFrozen` 挡 `approved` 一种，迟到的 `onHold`/`awaitUser`/`rejected`
  会先把制裁证据整份覆盖再静默 no-op。⚠️ `FROZEN` **不在**忽略集合成员里，是判定组合得出的。
```

提现额外注明 `PAYOUT_PENDING` = `EVIDENCE_ONLY` 档；兑换额外注明审计点在 `REJECTED`/`SUCCESS` + `rejected` 的处置 carve-out **之后**。

- [ ] **Step 2: `sumsub-ingestion.md` 补去重键变更**

```markdown
- **去重键（2026-08-19 第一批修正）**：`type:applicantId:externalUserId:reviewId:attemptId:kytTxnId`。
  补 `kytTxnId` 的原因：KYT 交易裁决报文不带 `reviewId`/`attemptId`，同一客户的第二条同类型
  裁决键与第一条逐字相同 → 命中旧 `PROCESSED` 行直接 return，**新裁决不落行、不派发**。
  模拟入口 `isSimulated` 跳过去重，所以演示环境不复现、真实链路必中。
```

- [ ] **Step 3: 四份文档的 Last Verified 全部刷到 2026-08-19，并写清核对方式**

每份文档头部的 `Last Verified:` 行改成 `Last Verified: 2026-08-19（核对方式：第一批「合规裁决落地」落地后逐条回代码核 —— …）`，括号里写明本次实际跑过的硬闸结果（tsc / jest / e2e）。

- [ ] **Step 4: 提交**

```bash
git add doc-final/reference/truth/
git commit -m "docs(truth): 同步第一批裁决落地三段结构与去重键变更"
```

---

## Self-Review

**1. Spec coverage** — 逐条对照 spec：

| spec 条目 | 落在哪个 Task |
|---|---|
| §2.1 三段结构 | Task 1 / 2 / 3 |
| §2.2 判定组合不扩容集合 | Task 1 Step 3、Task 2 Step 4（注释里写死了"不加进集合"） |
| §2.3 忽略分支强制写审计 + `.catch` 记 error + 提现补两个点 | Task 1 Step 3、Task 2 Step 1/4/5 |
| §2.4 兑换 carve-out 保留、审计点在其后 | Task 3 Step 5 + 测试 B3 第二条 |
| §2.5 幂等键保留随机数 | Task 1/2/3 的 `requestId` 均拼 `randomUUID`，Global Constraints 写死 |
| §2.6 去重键补 `kytTxnId` | Task 4 |
| §4 硬约束 | Global Constraints；各 Task 均未触碰 schema / 状态机 / 记账 / 前端 |
| §5 验收 1-8 | Task 5（1/3/4/5/6 走 e2e，2/7/8 由单测覆盖，Task 5 Step 3 已注明） |
| §6 改动清单含 truth 同步 | Task 6 |

**2. Placeholder scan** — 已扫，无 TBD / TODO / "类似 Task N" / "添加适当的错误处理"。每个改代码的步骤都带完整代码块。

**3. Type consistency** — `decideVerdictLanding` 在三域签名一致（第二参数均为 `_verdict`，充值/提现用 4 值联合、兑换用 2 值联合，与各域 `applyKytVerdict` 入参逐字对应）；`recordVerdictIgnored` 三域第二参数统一为 `{ verdict: string; riskScore?: number | null }`；`VerdictLanding` 在充值是 2 成员、提现是 3 成员、兑换不引入该类型（它只需要在既有终态分支后加一次审计调用）——**这是刻意的**，三域成员不同已在 Global Constraints 与 §2.2 写明。

**4. 自检时修正的计划缺陷（记录在案）** — 初稿 Task 5 臆造了 `bootstrapE2eApp` / `teardownE2eApp` 两个不存在的 helper（`test/e2e-db.ts` 唯一导出是 `resolveE2eDatabaseUrl`），且用 `findFirstOrThrow` 直接读当前 `DATABASE_URL` 指向的库 —— 那会在常驻栈库上跑，正是 2026-07-31 两次销毁真实验收数据的同款操作。已整节重写：改用真实样板（专用 `e2e-` 库 + fail-closed 护栏 + 自建 fixture）。

**5. 已识别的连带影响（实施者必须知道）** — `deposit-workflow.service.spec.ts:2135-2149` 的既有用例断言 FROZEN + rejected **不写审计**，本批改完必红，Task 1 Step 5 已给出订正后的完整代码。提现/兑换若有同类旧假设，按同法处理，**不得回退实现**。
