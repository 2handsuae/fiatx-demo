# V3 财务配置治愈 · 波二「行为与判据」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 第一幕后半三站（站 2 / 4 / 5）的每个动作——包括被拦下的——都能在第七幕审计页拉出证据；资产暂停成为 L1 硬门；`verify:act1` 对 V3 行为判据全绿。

**Architecture:** 资产可用性成为三域共用 `L1GateService` 的第十项自判 check；充值域的 L1 行政级问题改成「打标记、不换状态、照常送检」，`OPERATION_PENDING` 只在合规通过后由现成的 `holdIfHeld` 进入（状态机零改动）；提现 / 兑换 BLOCK 与地址五门各补一条 DENIED 审计码；判据用真登录真 HTTP 扩 `verify:act1`。

**Tech Stack:** NestJS + Prisma（SQLite）+ TigerBeetle ｜ React（admin-web / client-web，vite）｜ jest（后端 + admin-web spec）｜ vitest（client-web）｜ ts-node 脚本闸（`verify:*`）

**Spec:** `doc-final/superpowers/specs/2026-09-03-v3-config-cure-wave2-design.md`（§10 交付清单命中表是每个任务「过哪几条」的来源）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：
  - **不改状态机**：充值 28 边守则单测不许动；`OPERATION_PENDING` 只能经 `holdIfHeld` 进入；不给迟到裁决加边
  - **不动 schema / 迁移 / seed**（新审计码不是 schema）
  - **新审计码 4 条**（`WITHDRAW_L1_BLOCKED` / `SWAP_L1_BLOCKED` / `DEPOSIT_L1_HELD` / `WITHDRAWAL_ADDRESS_REQUEST_DENIED`）出生即冻结四属性，登记进对应 `V*_AUDIT_ACTIONS` map（`assertActionSpec` 只查这些 map，`AuditActions` 名字表只是常量方便）
  - **L1 BLOCK 对客户仍是中性文案 `NEUTRAL_DENIAL`**（tipping-off 防线，不得因资产原因单独透出）
  - **「Gate 0」这个词从代码、注释、日志、文档里退役**，统一 L1；actorId `COMPLIANCE_GATE_0` → `L1_GATE`
  - **所有 file:line 以任务开工时的 HEAD 为准**，先 grep 再改（波一三次栽在过期行号上）
  - 每个任务开场列「本任务做 / 不做」，收尾列「本任务过交付清单哪几条」（从 spec §10 抄）

## 开工前置（执行前一次性）

```bash
# 1. worktree（superpowers:using-git-worktrees）：分支 feat/v3-cure-wave2，目录 .claude/worktrees/v3-wave2
# 2. 在 worktree 里：
export PATH="$HOME/.nvm/versions/node/v20.19.0/bin:$PATH"   # 本机 shell 默认 node18，每条命令前置（见 memory）
npm run prisma:generate
bash scripts/stack.sh up            # self 栈；端口记在 .stackports
bash scripts/on-stack.sh self demo:setup   # 若 stack.sh up 已含则跳过；verify:* 要 11 个职务账号
```

派工分层（`CLAUDE.md §6`）：执行一律 `sonnet`；任务级评审 `sonnet`，**Task 3（改交易主路径分流）与 Task 12（判据）评审升 `opus`**；终审 `fable`（额度不够降 `opus`），终审必问「spec §2–§5 每条承诺的代码在哪个 commit」。

---

### Task 1: L1 求值器加第十项 `ASSET_AVAILABILITY`

**本任务做 / 不做**：做求值器与类型；不改任何调用方（调用方在 Task 2 / 3）。

**Files:**
- Modify: `src/modules/trading/shared/l1-gate/l1-gate.types.ts`
- Modify: `src/modules/trading/shared/l1-gate/l1-gate.service.ts`
- Test: `src/modules/trading/shared/l1-gate/l1-gate.service.spec.ts`

**Interfaces:**
- Produces: `L1GateInput.assetIds?: string[]`；`L1CheckCode` 含 `'ASSET_AVAILABILITY'`；快照 `holdReason` 对该项为 `'ASSET_SUSPENDED'`；新导出的纯函数 `l1ReasonCodeOf(code: L1CheckCode): string`（Task 2 的 BLOCK 审计用它算 reasonCode）

- [ ] **Step 1: 写失败测试**（追加到 `l1-gate.service.spec.ts` 末尾 `describe` 内）

```ts
  describe('ASSET_AVAILABILITY（波二第十项）', () => {
    it('资产 SUSPENDED + 提现域 → BLOCK，第十格 FAIL', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', assetNo: 'AS2601012024', currency: 'USDT', status: 'SUSPENDED' }]) };

      const snap = await service.evaluate({ domain: 'WITHDRAW', customerId: 'c1', assetIds: ['a-usdt'] });

      expect(snap.verdict).toBe('BLOCK');
      const check = snap.checks.find((c) => c.code === 'ASSET_AVAILABILITY');
      expect(check?.outcome).toBe('FAIL');
      expect(check?.detail).toContain('AS2601012024');
      expect(prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['a-usdt'] } } }));
    });

    it('资产 SUSPENDED + 充值域 → HOLD，holdReason=ASSET_SUSPENDED', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', assetNo: 'AS2601012024', currency: 'USDT', status: 'SUSPENDED' }]) };

      const snap = await service.evaluate({ domain: 'DEPOSIT', customerId: 'c1', assetIds: ['a-usdt'] });

      expect(snap.verdict).toBe('HOLD');
      expect(snap.holdReason).toBe('ASSET_SUSPENDED');
    });

    it('两个资产都 ACTIVE（兑换）→ PASS；不传 assetIds → 第十格 SKIPPED', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([
        { id: 'a-usdt', assetNo: 'AS1', currency: 'USDT', status: 'ACTIVE' },
        { id: 'a-aed', assetNo: 'AS2', currency: 'AED', status: 'ACTIVE' },
      ]) };

      const ok = await service.evaluate({ domain: 'SWAP', customerId: 'c1', assetIds: ['a-usdt', 'a-aed'] });
      expect(ok.verdict).toBe('PASS');
      expect(ok.checks.find((c) => c.code === 'ASSET_AVAILABILITY')?.outcome).toBe('PASS');

      const none = await service.evaluate({ domain: 'SWAP', customerId: 'c1' });
      expect(none.checks.find((c) => c.code === 'ASSET_AVAILABILITY')?.outcome).toBe('SKIPPED');
    });

    it('自判自赢：preChecks 里塞 ASSET_AVAILABILITY=PASS 也盖不掉本 service 判出的 FAIL', async () => {
      customerAccess.resolve.mockResolvedValue(activeAccess);
      prisma.customerMain.findUnique.mockResolvedValue({ tradingTier: 'BASIC' });
      prisma.asset = { findMany: jest.fn().mockResolvedValue([{ id: 'a-usdt', assetNo: 'AS1', currency: 'USDT', status: 'SUSPENDED' }]) };

      const snap = await service.evaluate({
        domain: 'WITHDRAW', customerId: 'c1', assetIds: ['a-usdt'],
        preChecks: [{ code: 'ASSET_AVAILABILITY', outcome: 'PASS', detail: '伪造' }],
      });
      expect(snap.checks.find((c) => c.code === 'ASSET_AVAILABILITY')?.outcome).toBe('FAIL');
    });
  });
```

- [ ] **Step 2: 跑测试确认红**

Run: `npx jest src/modules/trading/shared/l1-gate/l1-gate.service.spec.ts -t "ASSET_AVAILABILITY"`
Expected: FAIL（`assetIds` 不在 `L1GateInput` 类型上 / 第十格不存在）

- [ ] **Step 3: 改类型**（`l1-gate.types.ts`）

```ts
export type L1CheckCode =
  | 'CUSTOMER_ELIGIBILITY'   // 生命周期 ACTIVE
  | 'CUSTOMER_RESTRICTION'   // 限制便签是否卡住本域能力
  | 'SINGLE_LIMIT'           // 单笔上下限（原生币种）
  | 'CUMULATIVE_LIMIT'       // 累计额度（AED，档位 × 日/月窗口）
  | 'LARGE_APPROVAL'         // 大额转审批阈值（AED）
  | 'ACCOUNT_READINESS'      // 收付账户就绪
  | 'BALANCE_SUFFICIENCY'    // 余额充足
  | 'QUOTE_VALIDITY'         // 报价有效性
  | 'TRADING_READINESS'      // 交易起始就绪
  | 'ASSET_AVAILABILITY';    // 资产 ACTIVE（波二第十项，三域适用，本 service 自判；业主 2026-09-05：资产暂停是 L1 硬门）

export interface L1GateInput {
  domain: L1Domain;
  customerId: string;
  /** 本次交易涉及的资产 id（充值 1 / 提现 1 / 兑换 2）。不传或空数组 = 第十格 SKIPPED。 */
  assetIds?: string[];
  preChecks?: L1Check[];
}
```

- [ ] **Step 4: 改求值器**（`l1-gate.service.ts`）

`CHECK_ORDER` 末尾加 `'ASSET_AVAILABILITY'`；`SELF_OWNED_CHECKS` 加 `'ASSET_AVAILABILITY'`；在 `evaluate()` 的「② 客户限制」块之后、「③ 合并」之前插入：

```ts
    // ③ 资产可用性 —— 波二第十项。资产 SUSPENDED = 三条路的硬门（决定 2026-09-05）。
    //    只查不抛：提现/兑换见 BLOCK 自己抛，充值见 HOLD 打标不换状态（先合规后挂起）。
    if (input.assetIds && input.assetIds.length > 0) {
      const assets: Array<{ id: string; assetNo: string | null; currency: string; status: string }> =
        await (this.prisma as any).asset.findMany({
          where: { id: { in: input.assetIds } },
          select: { id: true, assetNo: true, currency: true, status: true },
        });
      const missing = input.assetIds.filter((id) => !assets.some((a) => a.id === id));
      const inactive = assets.filter((a) => a.status !== 'ACTIVE');
      const ok = missing.length === 0 && inactive.length === 0;
      own.push({
        code: 'ASSET_AVAILABILITY',
        outcome: ok ? 'PASS' : 'FAIL',
        detail: ok
          ? `资产 ${assets.map((a) => a.currency).join(' / ')} 均 ACTIVE`
          : [
              ...inactive.map((a) => `资产 ${a.assetNo ?? a.id}（${a.currency}）状态 ${a.status}，不可交易`),
              ...missing.map((id) => `资产 ${id} 不存在`),
            ].join('；'),
      });
    }
```

把 `private holdReasonOf(first)` 改成调用新导出的纯函数（文件顶部 `@Injectable()` 之前加）：

```ts
/** L1 失败项 → 稳定的机器可读原因码（充值 holdReason / 提现兑换 BLOCK 审计 reasonCode 共用一份映射） */
export function l1ReasonCodeOf(code: L1CheckCode): string {
  switch (code) {
    case 'CUSTOMER_ELIGIBILITY': return 'LIFECYCLE_NOT_ACTIVE';
    case 'CUSTOMER_RESTRICTION': return 'CAPABILITY_RESTRICTED';
    case 'SINGLE_LIMIT': return 'BELOW_MIN';
    case 'ASSET_AVAILABILITY': return 'ASSET_SUSPENDED';
    default: return code;
  }
}
```

```ts
  private holdReasonOf(first: L1Check): string {
    return l1ReasonCodeOf(first.code);
  }
```

- [ ] **Step 5: 跑测试确认绿 + 全 spec 不回归**

Run: `npx jest src/modules/trading/shared/l1-gate/`
Expected: PASS（原有用例 + 新 4 条）

- [ ] **Step 6: 随手闸 ①**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 错误

- [ ] **Step 7: Commit**

```bash
git add src/modules/trading/shared/l1-gate/
git commit -m "feat(l1): 资产可用性成为 L1 第十项 ASSET_AVAILABILITY（自判、三域适用、holdReason=ASSET_SUSPENDED）"
```

---

### Task 2: 四条新审计码登记 + 提现 / 兑换 L1 BLOCK 留痕（含 assetIds 接入）

**本任务做 / 不做**：登记 4 条码（含 Task 3 / 5 要用的两条，一次登记完）；提现 / 兑换建单传 `assetIds` 并在 BLOCK 时写 DENIED 审计。不改充值（Task 3）、不改地址（Task 5）。

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`AuditActions` 名字表 + `V1_AUDIT_ACTIONS` / `V4_DEPOSIT_AUDIT_ACTIONS` / `V5_WITHDRAW_AUDIT_ACTIONS` / `V6_SWAP_AUDIT_ACTIONS`）
- Modify: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts`（L1 调用处，现 `:346-378`）
- Modify: `src/modules/trading/swap-transactions/swap-workflow.service.ts`（`quotePeek` select 现 `:214-217`；L1 调用处现 `:316-328`）
- Test: `src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts`、`src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的 `assetIds` 与 `l1ReasonCodeOf`
- Produces: 审计码 `WITHDRAW_L1_BLOCKED` / `SWAP_L1_BLOCKED`（outcome DENIED，reasonCode = `l1ReasonCodeOf(第一条 FAIL)`，subjects：OWNER 客户 + RELATED 资产号）；`DEPOSIT_L1_HELD`、`WITHDRAWAL_ADDRESS_REQUEST_DENIED` 两条码已登记供 Task 3 / 5 直接写

- [ ] **Step 1: 登记四条码**

`AuditActions` 名字表：在 `DEPOSIT_SIGNAL_REJECTED: 'DEPOSIT_SIGNAL_REJECTED',` 之后加 `DEPOSIT_L1_HELD: 'DEPOSIT_L1_HELD',`；在 `SWAP_CREATED: 'SWAP_CREATED',` 之后加 `SWAP_L1_BLOCKED: 'SWAP_L1_BLOCKED',`；在 `WITHDRAW_CREATED: 'WITHDRAW_CREATED',` 之后加 `WITHDRAW_L1_BLOCKED: 'WITHDRAW_L1_BLOCKED',`。

四张 spec map（四属性出生即冻结）：

```ts
// V4_DEPOSIT_AUDIT_ACTIONS —— 紧跟 DEPOSIT_HELD 那一行之后
  // 波二（2026-09-05）：L1 行政级问题打标不换状态、照常送检；这一行是打标当刻的证据（KYT 若随后拒绝，它是「暂停曾拦下它」的唯一审计痕）
  DEPOSIT_L1_HELD:        { domain: 'DEPOSIT', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },

// V5_WITHDRAW_AUDIT_ACTIONS —— 紧跟 WITHDRAW_CREATED 之后
  // 波二：L1 拦下留痕（单未建、无单号；主体=客户；次主体 RELATED=资产）
  WITHDRAW_L1_BLOCKED:      { domain: 'WITHDRAW', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },

// V6_SWAP_AUDIT_ACTIONS —— 紧跟 SWAP_CREATED 之后
  SWAP_L1_BLOCKED:           { domain: 'SWAP', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },

// V1_AUDIT_ACTIONS —— 紧跟 WITHDRAWAL_ADDRESS_UNSUSPENDED 那一行之后
  // 波二：地址五门（ADDRESS_LIMIT_REACHED / COOLING_PERIOD_NOT_EXPIRED / LAST_ACTIVE_FIAT_ADDRESS /
  // ADDRESS_HAS_INFLIGHT_WITHDRAWAL / NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS）拒绝留痕，reasonCode = 门的 code
  WITHDRAWAL_ADDRESS_REQUEST_DENIED: { domain: 'CONFIG', correlationMode: N, requiredFields: ['reasonCode'], requiresCausation: false },
```

Run: `npx jest src/modules/audit-logging --silent 2>&1 | tail -5`
Expected: 全绿（已核实：本仓库没有按域计数的词表断言，加码不会撞守则）

- [ ] **Step 2: 写提现 BLOCK 留痕的失败测试**（`withdraw-workflow.service.spec.ts`，新增 describe；照该文件 `:60-80` 的构造顺序把 `l1Gate` 位置换成 BLOCK 快照）

```ts
describe('波二 · L1 BLOCK 留痕（提现）', () => {
  it('资产 SUSPENDED → 403 L1_GATE_BLOCKED，且写 WITHDRAW_L1_BLOCKED（DENIED / reasonCode ASSET_SUSPENDED / RELATED 资产号）', async () => {
    // 复制本文件第一个 describe 的 beforeEach 构造，只改两处：
    //   · auditLogsService = { recordByActor: jest.fn().mockResolvedValue({}), recordSystem: jest.fn().mockResolvedValue({}) }
    //   · l1Gate 位置的 mock 改为：
    //     { evaluate: jest.fn().mockResolvedValue({ evaluatedAt: '2026-09-05T00:00:00.000Z', domain: 'WITHDRAW', verdict: 'BLOCK', holdReason: null, tradingTier: 'BASIC',
    //         checks: [{ code: 'ASSET_AVAILABILITY', outcome: 'FAIL', detail: '资产 AS2601012024（USDT）状态 SUSPENDED，不可交易' }] }) }
    //   · prisma.asset.findUnique 返回 { id: 'a-usdt', assetNo: 'AS2601012024', type: 'CRYPTO', network: 'TRON', currency: 'USDT' }
    //   · prisma.withdrawalAddress.findFirst 返回 { addressType: 'SELF_CUSTODY' }
    //   · prisma.customerMain.findUnique 返回 { customerNo: 'CUST0001' }
    const err: any = await workflow
      .createWithdrawal('cust-1', 'CUSTOMER', { assetId: 'a-usdt', amount: 10, toAddress: 'TXYZ' } as any)
      .catch((e) => e);
    const body = err?.getResponse ? err.getResponse() : err;
    expect(body.code).toBe('L1_GATE_BLOCKED');

    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAW_L1_BLOCKED',
        actionDomain: 'WITHDRAW',
        outcome: 'DENIED',
        reasonCode: 'ASSET_SUSPENDED',
        subjects: expect.arrayContaining([
          expect.objectContaining({ subjectType: 'ASSET', subjectNo: 'AS2601012024', subjectRole: 'RELATED' }),
        ]),
        requestId: expect.stringMatching(/^WITHDRAW_L1_BLOCKED_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER' }),
    );
    expect(l1Gate.evaluate).toHaveBeenCalledWith(expect.objectContaining({ assetIds: ['a-usdt'] }));
  });
});
```

（构造时把 l1Gate 位置的 mock 先抽成变量 `const l1Gate = { evaluate: jest.fn().mockResolvedValue({...}) }` 再传入，断言才拿得到它。`createWithdrawal` 的实际参数顺序以 `withdraw-workflow.service.ts:225-230` 的签名为准，先 `sed -n '225,232p'` 看一眼再写调用。）

- [ ] **Step 3: 跑测试确认红**

Run: `npx jest src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts -t "L1 BLOCK 留痕"`
Expected: FAIL（`recordByActor` 未被调用）

- [ ] **Step 4: 改提现 workflow**

把 `l1 = await this.l1Gate.evaluate({ domain: 'WITHDRAW', customerId: userId, preChecks });` 改为传 `assetIds: [assetId]`，并把紧随的 `if (l1.verdict === 'BLOCK') { throw ... }` 改为：

```ts
      l1 = await this.l1Gate.evaluate({ domain: 'WITHDRAW', customerId: userId, assetIds: [assetId], preChecks });
      if (l1.verdict === 'BLOCK') {
        // 波二·法一：被拦下也留痕。单未建、无单号——主体是客户，资产当次主体（第七幕按资产号能拉出被它拦下的单）。
        const failed = l1.checks.filter((c) => c.outcome === 'FAIL');
        const actorNo = ownerNo ?? userId;
        await this.auditLogsService.recordByActor(
          {
            action: 'WITHDRAW_L1_BLOCKED',
            actionDomain: 'WITHDRAW',
            category: AuditCategory.BUSINESS,
            primarySubjectType: 'CUSTOMER',
            primarySubjectNo: actorNo,
            ownerCustomerNo: ownerNo ?? undefined,
            outcome: AuditOutcome.DENIED,
            reasonCode: failed[0] ? l1ReasonCodeOf(failed[0].code) : 'L1_BLOCK',
            reason: `L1 blocked withdrawal: ${failed.map((c) => `${c.code} — ${c.detail}`).join('; ')}`,
            subjects: [
              ...(ownerNo ? [{ subjectType: 'CUSTOMER', subjectNo: ownerNo, subjectRole: AuditSubjectRole.OWNER }] : []),
              ...(asset.assetNo ? [{ subjectType: AuditEntityTypes.ASSET, subjectNo: asset.assetNo, subjectRole: AuditSubjectRole.RELATED }] : []),
            ],
            metadata: { assetId, amount: String(amount), l1Snapshot: l1 },
            requestId: `WITHDRAW_L1_BLOCKED_${actorNo}_${randomUUID()}`,
            sourcePlatform: 'CUSTOMER_API',
          } as any,
          { actorType: 'CUSTOMER', actorNo, actorDisplayName: actorNo, actorRolesAtTime: ['CUSTOMER'] },
        );
        throw new ForbiddenException({
          code: 'L1_GATE_BLOCKED',
          // 中性文案 —— 直接引用 CustomerAccessService 的那一份（禁止手抄副本）。
          message: NEUTRAL_DENIAL,
        });
      }
```

import 行：`import { l1ReasonCodeOf } from '../shared/l1-gate/l1-gate.service';`；确认文件已 import `randomUUID`（`grep -n "randomUUID" withdraw-workflow.service.ts | head -1`，没有则 `import { randomUUID } from 'crypto';`）。注意 `ownerNo` 在 `:311-316` 已算出、位于 L1 调用之前。

- [ ] **Step 5: 兑换同款**（`swap-workflow.service.ts`）

`quotePeek` 的 select 加 `toAssetId: true`；L1 调用与 BLOCK 块改为：

```ts
    const swapAssetIds = quotePeek ? [quotePeek.fromAssetId, quotePeek.toAssetId] : [];
    const l1 = await this.l1Gate.evaluate({ domain: 'SWAP', customerId: ownerId, assetIds: swapAssetIds, preChecks });
    if (l1.verdict === 'BLOCK') {
      const failed = l1.checks.filter((c) => c.outcome === 'FAIL');
      const actorNo = customer?.customerNo ?? ownerId;
      const blockedAssets: Array<{ assetNo: string | null }> = swapAssetIds.length
        ? await this.prisma.asset.findMany({ where: { id: { in: swapAssetIds } }, select: { assetNo: true } })
        : [];
      await this.auditLogsService.recordByActor(
        {
          action: 'SWAP_L1_BLOCKED',
          actionDomain: 'SWAP',
          category: AuditCategory.BUSINESS,
          primarySubjectType: 'CUSTOMER',
          primarySubjectNo: actorNo,
          ownerCustomerNo: customer?.customerNo ?? undefined,
          outcome: AuditOutcome.DENIED,
          reasonCode: failed[0] ? l1ReasonCodeOf(failed[0].code) : 'L1_BLOCK',
          reason: `L1 blocked swap: ${failed.map((c) => `${c.code} — ${c.detail}`).join('; ')}`,
          subjects: [
            ...(customer?.customerNo ? [{ subjectType: 'CUSTOMER', subjectNo: customer.customerNo, subjectRole: AuditSubjectRole.OWNER }] : []),
            ...blockedAssets.filter((a) => a.assetNo).map((a) => ({ subjectType: AuditEntityTypes.ASSET, subjectNo: a.assetNo as string, subjectRole: AuditSubjectRole.RELATED })),
          ],
          metadata: { quoteId, assetIds: swapAssetIds, l1Snapshot: l1 },
          requestId: `SWAP_L1_BLOCKED_${actorNo}_${randomUUID()}`,
          sourcePlatform: 'CUSTOMER_API',
        } as any,
        { actorType: 'CUSTOMER', actorNo, actorDisplayName: actorNo, actorRolesAtTime: ['CUSTOMER'] },
      );
      throw new ForbiddenException({
        code: 'L1_GATE_BLOCKED',
        // 中性文案 —— 直接引用 CustomerAccessService 的那一份（禁止手抄副本：
        // 拒绝理由有差异即可被指纹识别）。绝不透出 cause / visibility。
        message: NEUTRAL_DENIAL,
      });
    }
```

`customer` 是 `initiateSwap` 第一行查出的 `customerMain` 行（`:204`）。兑换 spec：在 `describe('B2 · 兑换 L1 资格闸')` 里加一条同形状的断言（`mocks.auditLogsService.recordByActor` 被调用、action `SWAP_L1_BLOCKED`、outcome DENIED、`mocks.l1Gate.evaluate` 收到 `assetIds`），`mocks.prisma.asset.findMany` 返回 `[{ assetNo: 'AS1' }, { assetNo: 'AS2' }]`。

- [ ] **Step 6: 跑两域 spec 确认绿**

Run: `npx jest src/modules/trading/withdraw-transactions/withdraw-workflow.service.spec.ts src/modules/trading/swap-transactions/swap-workflow.service.spec.ts`
Expected: PASS

- [ ] **Step 7: 随手闸 ① + Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/audit-logging/constants/audit-actions.constant.ts src/modules/trading/withdraw-transactions src/modules/trading/swap-transactions
git commit -m "feat(l1): 提现/兑换建单传 assetIds，L1 BLOCK 写 DENIED 审计（WITHDRAW_/SWAP_L1_BLOCKED，资产当次主体）；登记波二四条审计码"
```

---

### Task 3: 充值 L1 分流改造——打标不换状态、照常送检、`DEPOSIT_L1_HELD`、`holdIfHeld` 补 from/to 与次主体

**本任务做 / 不做**：改 `deposit-workflow.service.ts` 的 L1 分流与两处审计、`deposit-transactions.service.ts` 加两个小方法、spec 更新；改名只做本文件内的 `runGate0` / `holdAtGate0` / actorId（其余文件的改名在 Task 4）。不改状态机、不改 `decideVerdictLanding`、不碰 FREEZE 分支的审计缺口（BACKLOG:137/139，V4 线）。

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`（`runGate0` 现 `:212-336`，`holdAtGate0` 现 `:366-406`，`holdIfHeld` 现 `:728-778`，`depositAudit` 助手，`handleDepositStatusChanged` 现 `:199-207`）
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`（`clearLimitHold` 现 `:1072` 旁加两个方法）
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`（`describe('handleDepositStatusChanged — Gate 0')` 现 `:231-553`；`depositService` mock 现 `:152` / `:162`）

**Interfaces:**
- Consumes: Task 1 `assetIds` / `holdReason='ASSET_SUSPENDED'`；Task 2 登记的 `DEPOSIT_L1_HELD`
- Produces: `DepositTransactionsService.markLimitHold(id, reason)`、`DepositTransactionsService.singleDepositLimitRule(assetId)`；`DepositWorkflowService.evaluateL1(depositId, ownerId)`（原 `runGate0`）、`markL1Hold(deposit, l1)`（原 `holdAtGate0`）；`depositAudit` patch 新增可选 `extraSubjects?: AuditSubjectInput[]`；审计行 `DEPOSIT_L1_HELD`（打标当刻，无 from/to）与 `DEPOSIT_HELD`（合规通过后，带 from/to）都带 RELATED 资产号 /（BELOW_MIN 时）INSTRUMENT 规则号

- [ ] **Step 1: 改 spec 里会变的三条既有用例 + 加两条新用例**

在 `depositService` mock（`:152` 附近）加：
```ts
      markLimitHold: jest.fn().mockResolvedValue(undefined),
      singleDepositLimitRule: jest.fn().mockResolvedValue({ ruleNo: 'TLR-DEP-USDT', minAmount: '100' }),
```
`describe('handleDepositStatusChanged — Gate 0')` 改名 `'handleDepositStatusChanged — L1'`；`gate0Deposit` 夹具加 `assetId: 'asset-1', asset: { assetNo: 'AS2601012024', type: 'CRYPTO' }`。

用例 `'B4 修复轮：BELOW_MIN 单被 Gate 0 行政级挂起时…'` 用的是真 `L1GateService`（`realGate`），Task 1 之后它会按 `assetIds` 查 `prisma.asset.findMany`——该用例的假 prisma 要补一项：
```ts
      const realGate = new L1GateService(customerAccessService as any, {
        customerMain: { findUnique: jest.fn().mockResolvedValue({ tradingTier: 'BASIC' }) },
        asset: { findMany: jest.fn().mockResolvedValue([{ id: 'asset-1', assetNo: 'AS2601012024', currency: 'USDT', status: 'ACTIVE' }]) },
      } as any);
```
同一用例的两段 `expect(depositService.updateStatus)` 改为：
```ts
      // 波二：打标不换状态——不再推 OPERATION_PENDING；已有原因优先，所以也不重写 limitHoldReason
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(depositService.markLimitHold).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'DEPOSIT_L1_HELD', reasonCode: 'BELOW_MIN' }),
      );
```
（`auditLogsService` 在本 spec 的 mock 名以 `grep -n "auditLogsService = {" deposit-workflow.service.spec.ts` 为准。）

新增两条：
```ts
    it('波二：资产暂停 → L1 HOLD 打标（ASSET_SUSPENDED）、状态不动、照常送检、DEPOSIT_L1_HELD 带 RELATED 资产号', async () => {
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      depositService.findOne.mockResolvedValue(gate0Deposit());
      l1Gate.evaluate.mockResolvedValue(l1SnapshotFixture({
        verdict: 'HOLD', holdReason: 'ASSET_SUSPENDED',
        checks: [{ code: 'ASSET_AVAILABILITY', outcome: 'FAIL', detail: '资产 AS2601012024（USDT）状态 SUSPENDED，不可交易' }],
      }));

      await service.handleDepositStatusChanged(gate0Event());

      expect(l1Gate.evaluate).toHaveBeenCalledWith(expect.objectContaining({ domain: 'DEPOSIT', assetIds: ['asset-1'] }));
      expect(depositService.markLimitHold).toHaveBeenCalledWith('dep-1', 'ASSET_SUSPENDED');
      expect(depositService.updateStatus).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DEPOSIT_L1_HELD',
          reasonCode: 'ASSET_SUSPENDED',
          subjects: expect.arrayContaining([
            expect.objectContaining({ subjectType: 'ASSET', subjectNo: 'AS2601012024', subjectRole: 'RELATED' }),
          ]),
        }),
      );
      // 送检没被打标短路：submitSumsubTxns 在本 describe 的开关 OFF 下会 return，但它一定被走到——用 spy 断言
      expect(submitSpy).toHaveBeenCalledWith(expect.objectContaining({ id: 'dep-1' }));
    });

    it('波二：L1 PASS 路径不打标、不写 DEPOSIT_L1_HELD', async () => {
      customerAccessService.resolve.mockResolvedValue(accessAllowing());
      depositService.findOne.mockResolvedValue(gate0Deposit());
      l1Gate.evaluate.mockResolvedValue(l1SnapshotFixture({ verdict: 'PASS', holdReason: null }));

      await service.handleDepositStatusChanged(gate0Event());

      expect(depositService.markLimitHold).not.toHaveBeenCalled();
      expect(auditLogsService.recordSystem).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'DEPOSIT_L1_HELD' }));
    });
```
`submitSpy` 在该 describe 的 `beforeEach` 里建：`const submitSpy = jest.spyOn(service as any, 'submitSumsubTxns').mockResolvedValue(undefined);`（其余用例不受影响：spy 只是替换成 no-op）。

- [ ] **Step 2: 跑确认红**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "handleDepositStatusChanged"`
Expected: FAIL（`markLimitHold` 不存在 / 仍推 OPERATION_PENDING）

- [ ] **Step 3: `deposit-transactions.service.ts` 加两个方法**（放在 `clearLimitHold` 旁）

```ts
  /** 波二：L1 行政级问题「打标记、不换状态」——只写挂起原因，状态留给合规通过后的 holdIfHeld 推进 */
  async markLimitHold(id: string, reason: string) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { limitHoldReason: reason },
    });
  }

  /** 充值单笔下限规则——挂起证据要把命中的规则号当次主体（INSTRUMENT） */
  async singleDepositLimitRule(assetId: string) {
    return this.limitRulesService.getSingleRule('DEPOSIT', assetId);
  }
```

- [ ] **Step 4: 改 workflow**

(a) `handleDepositStatusChanged` 里 `await this.runGate0(depositId, event.ownerId);` → `await this.evaluateL1(depositId, event.ownerId);`

(b) `runGate0` 整体替换为（保留原有 L1 快照与 FREEZE 逻辑，去掉两个 `holdAtGate0` 分支的 `return`）：

```ts
  /**
   * L1 —— 进入 COMPLIANCE_PENDING 时跑一次的平台内限制判断（原名 Gate 0，2026-09-05 随 L1/L2 命名统一退役）。
   *
   * 分流（业主 2026-09-05）：
   *   · 执法级限制（releasePolicy=MLRO_APPROVAL）→ FREEZE（不变）
   *   · 其余 L1 FAIL（行政级限制 / 生命周期 / 资产暂停 / 低于下限）→ **打标记、不换状态、照常送检**
   *     —— OPERATION_PENDING 只能从合规通过进入（holdIfHeld），没有后悔药；这恢复的是 2026-07-31
   *     「先合规后判金额」口径，08-22 在 KYT 之前直推 OPERATION_PENDING 属反向，本波纠正
   *   · PASS → 送检（不变）
   */
  private async evaluateL1(depositId: string, ownerId: string) {
    const access = await this.customerAccessService.resolve(ownerId);
    const deposit = await this.depositService.findOne(depositId);

    const openRows: RestrictionRow[] =
      await this.customerRestrictionsService.listOpen(ownerId);
    const depositBlockers = openRows.filter((row) =>
      row.scopes.some((scope) => scope === 'ALL' || scope === 'DEPOSIT'),
    );

    const belowMin = deposit.limitHoldReason === 'BELOW_MIN';
    const preChecks: L1Check[] = [
      belowMin
        ? { code: 'SINGLE_LIMIT', outcome: 'FAIL', detail: '建单时判定金额低于 DEPOSIT 单笔下限（BELOW_MIN），等运营处置' }
        : { code: 'SINGLE_LIMIT', outcome: 'PASS', detail: '建单时已过 DEPOSIT 单笔下限判定（充值是被动入金，只判下限、无上限）' },
      { code: 'ACCOUNT_READINESS', outcome: 'PASS', detail: '建单时校验过收款钱包存在且资产匹配（不匹配则整单不建）' },
      { code: 'TRADING_READINESS', outcome: 'SKIPPED', detail: '交易起始就绪（法币提现地址）由放行前的 assertTradingReadyOrHold 校验，本评估点在其之前' },
    ];
    const l1 = await this.l1Gate.evaluate({
      domain: 'DEPOSIT',
      customerId: ownerId,
      assetIds: deposit.assetId ? [deposit.assetId] : [],
      preChecks,
    });
    // 三条分支（冻 / 标 / 放行）都要留下证据，所以落库放在分流之前。
    await this.depositService.saveL1Snapshot(depositId, JSON.stringify(l1));

    if (access.blocked.has('DEPOSIT')) {
      const enforcement =
        depositBlockers.length === 0 ||
        depositBlockers.some((row) => row.releasePolicy === 'MLRO_APPROVAL');
      if (enforcement) {
        this.logger.warn(`L1 FAIL: deposit ${depositId} — customer DEPOSIT capability is blocked (enforcement)`);
        await this.depositService.updateStatus(
          depositId,
          { action: DepositTransactionAction.FREEZE },
          {
            reason: 'Customer DEPOSIT capability is restricted',
            actor: { actorType: 'SYSTEM', actorId: 'L1_GATE' },
          },
        );
        return;
      }
    }

    if (l1.verdict === 'HOLD') {
      await this.markL1Hold(deposit, l1);
    } else {
      this.logger.log(`L1 PASS: deposit ${depositId}`);
    }

    // 打标不短路送检：L2 照筛。合规通过后 holdIfHeld 才把带标记的单推进 OPERATION_PENDING。
    try {
      await this.submitSumsubTxns(deposit);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.error(
        `Sumsub submit failed for deposit ${depositId}: ${error.message} — ` +
          `deposit remains COMPLIANCE_PENDING for manual handling/retry; L1 continues`,
      );
    }
  }
```

(c) `holdAtGate0` 整体替换为：

```ts
  /**
   * L1 挂起打标（原 holdAtGate0）：只写 limitHoldReason，**不换状态、不写 DEPOSIT_HELD**——那条由合规通过后的
   * holdIfHeld 写。已有挂起原因优先（不覆盖建单时落的 BELOW_MIN）。打标本身是持久化动作，留 DEPOSIT_L1_HELD。
   */
  private async markL1Hold(deposit: any, l1: L1Snapshot) {
    const effectiveHoldReason: string = deposit.limitHoldReason ?? l1.holdReason ?? 'L1_HOLD';
    const failed = l1.checks.filter((c) => c.outcome === 'FAIL');
    if (deposit.limitHoldReason !== effectiveHoldReason) {
      await this.depositService.markLimitHold(deposit.id, effectiveHoldReason);
    }
    await this.depositAudit(deposit, {
      action: 'DEPOSIT_L1_HELD',
      reasonCode: effectiveHoldReason,
      reason: `L1 hold marked (${failed.map((c) => `${c.code}: ${c.detail}`).join('; ')}) — awaiting compliance (L2); status unchanged`,
      metadata: { limitHoldReason: effectiveHoldReason, l1Failed: failed.map((c) => c.code) },
      extraSubjects: await this.l1HoldSubjects(deposit, effectiveHoldReason),
    });
    this.logger.warn(`L1 HOLD marked: deposit ${deposit.id} — ${effectiveHoldReason}; status stays ${deposit.status}, submitting to Sumsub`);
  }

  /** 挂起证据的次主体：资产（RELATED）、命中的限额规则（INSTRUMENT，仅 BELOW_MIN） */
  private async l1HoldSubjects(deposit: any, holdReason: string): Promise<AuditSubjectInput[]> {
    const subjects: AuditSubjectInput[] = [];
    const assetNo: string | null = deposit.asset?.assetNo ?? null;
    if (assetNo) {
      subjects.push({ subjectType: AuditEntityTypes.ASSET, subjectNo: assetNo, subjectRole: AuditSubjectRole.RELATED });
    }
    if (holdReason === 'BELOW_MIN' && deposit.assetId) {
      const rule = await this.depositService.singleDepositLimitRule(deposit.assetId);
      if (rule?.ruleNo) {
        subjects.push({ subjectType: AuditEntityTypes.TRANSACTION_LIMIT_POLICY, subjectNo: rule.ruleNo, subjectRole: AuditSubjectRole.INSTRUMENT });
      }
    }
    return subjects;
  }
```

(d) `depositAudit` 的 `patch` 类型加 `extraSubjects?: AuditSubjectInput[];`，在组 `subjects` 的地方（`fundsOrderNo` 那段之后）加 `subjects.push(...(patch.extraSubjects ?? []));`。

(e) `holdIfHeld` 两处 `DEPOSIT_HELD` 的 `depositAudit` 调用都加：
```ts
        fromStatus: deposit.status,
        toStatus: DepositTransactionStatus.OPERATION_PENDING,
        extraSubjects: await this.l1HoldSubjects(deposit, holdReason),
```
（第二处的 `reasonCode: holdReason` 保留；第一处 BELOW_MIN 原 metadata 保留。）

(f) 全文件把剩余的 `COMPLIANCE_GATE_0` 换成 `L1_GATE`，注释里的「Gate 0」换成「L1」：`grep -n "Gate 0\|GATE_0\|gate0\|Gate0" deposit-workflow.service.ts` 应为 0 行。`ADMINISTRATIVE_HOLD_REASONS` 集合加 `'ASSET_SUSPENDED'`（它决定退回落地时清哪些行政级挂起——资产暂停同属行政级）。

- [ ] **Step 5: 跑本目录全部 spec**

Run: `npx jest src/modules/trading/deposit-transactions/`
Expected: 全绿（含 28 边守则单测；`grep -c "it(" deposit-workflow.service.spec.ts` 比开工前多 2）

- [ ] **Step 6: 行为闸——真栈 e2e**

```bash
bash scripts/stack.sh reset self && bash scripts/on-stack.sh self test:e2e --runInBand test/deposit-sumsub-verdicts.e2e-spec.ts
```
Expected: 全绿。该套件直接调 `workflow.handleDepositStatusChanged`（`test/deposit-sumsub-verdicts.e2e-spec.ts:352`），小额挂起三条用例本来就是「先 KYT 通过再 OPERATION_PENDING」，与新分流一致；若有用例断言 hold 后立刻 OPERATION_PENDING（KYT 之前），那条用例写的是被本波纠正的反向行为——改断言为 `COMPLIANCE_PENDING` + `limitHoldReason` 非空 + `DEPOSIT_L1_HELD`，并在 commit message 里点名。

- [ ] **Step 7: 随手闸 ① + Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/trading/deposit-transactions/
git commit -m "feat(deposit): L1 行政级问题打标不换状态、照常送检——OPERATION_PENDING 只从合规通过进入（holdIfHeld）；打标当刻写 DEPOSIT_L1_HELD，DEPOSIT_HELD 补 from/to 与资产/规则次主体；runGate0→evaluateL1、holdAtGate0→markL1Hold、actorId L1_GATE"
```

---

### Task 4: 「Gate 0」全仓退役 + 管理台 Release Hold 提示按新流程重写

**本任务做 / 不做**：机械改名 + 三段管理台文案。不改行为。

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`、`deposit-transactions.service.ts`、`deposit-transactions.module.ts`、`deposit-transactions.service.spec.ts`
- Modify: `src/modules/deposit-sumsub/demo-scenario.service.ts`、`demo-scenario.service.spec.ts`、`src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts:2261`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`（`:244-258`、`:460-470`、`:758-770`）、`admin-web/src/pages/DepositTransactionList.tsx:346`
- Modify: `test/deposit-sumsub-verdicts.e2e-spec.ts`（`:92,128,304,318,320`）、`test/deposit-money-arcs.e2e-spec.ts:47`、`test/withdraw-sumsub-scenarios.e2e-spec.ts:125`、`scripts/demo-lib.ts`（`:549-595,747`）
- Modify: `doc-final/modules/v4-deposit.md:64`、`doc-final/PRODUCTION-NOTES.md`（`:111` 节名、`:360`）、`doc-final/BACKLOG.md`（`:137`、`:139` 措辞）

- [ ] **Step 1: 盘点**

Run: `grep -rIn -i "gate 0\|gate_0\|gate0\|gate-0" src scripts test admin-web/src client-web/src doc-final --exclude-dir=archive --exclude-dir=node_modules | grep -v "DEPOSIT_GATE0_PASSED" | wc -l`
Expected: 约 110（记下数字，收尾要归零；`DEPOSIT_GATE0_PASSED` 是退役码字面量，不改）

- [ ] **Step 2: 代码与脚本里的改名**

规则：注释 / 日志 / JSDoc 里「Gate 0」→「L1」；`runGate0` → `evaluateL1`；`holdAtGate0` → `markL1Hold`；`COMPLIANCE_GATE_0` → `L1_GATE`；e2e 哈希种子 `` `gate0:${depositNo}` `` → `` `l1:${depositNo}` ``。逐文件手改（不要 sed 全局替换——`DEPOSIT_GATE0_PASSED` 必须留）。spec 里描述性字符串（`it('...Gate 0...')`）一并改。

- [ ] **Step 3: 管理台三段文案按新流程重写**（`DepositTransactionDetail.tsx`）

`handleWaiveLimit` 里的 `outcomeLine`：
```ts
    const outcomeLine = isBelowMin
      ? 'Compliance already cleared this deposit, so releasing the hold lets it finish and credit the customer.'
      : `Compliance (L2) already cleared this deposit; it was held by L1 (${holdReason}). Releasing the hold lets it finish and credit the customer.`;
```
`:460-470` 注释改为：「L1 行政级挂起（CAPABILITY_RESTRICTED / LIFECYCLE_NOT_ACTIVE / ASSET_SUSPENDED）与 BELOW_MIN 同一形状：先合规后挂起，OPERATION_PENDING 时合规已过。」
`:758-770`：按钮文案 `'Release Hold (does not resume compliance)'` → `'Release Hold'`；删掉那段「This deposit was never screened by Sumsub…」提示与其上方的终审 I1 注释整块。

- [ ] **Step 4: 文档措辞**

`v4-deposit.md:64`：`runGate0()`（L1 三分流…）→ `evaluateL1()`（L1：执法级 FREEZE / 其余 FAIL 打标不换状态照常送检 / PASS 送检）。`PRODUCTION-NOTES.md:111` 节名「Gate 0 / 退回弧」→「L1 / 退回弧」，`:360` 句中「Gate 0」→「L1」。`BACKLOG.md:137/139` 两条只把「runGate0 / Gate 0」换成「evaluateL1 / L1」，内容不动（V4 线，本波不做）。

- [ ] **Step 5: 归零验证 + 三闸 + 截图**

```bash
grep -rIn -i "gate 0\|gate_0\|gate0\|gate-0" src scripts test admin-web/src client-web/src doc-final --exclude-dir=archive | grep -v "DEPOSIT_GATE0_PASSED"
```
Expected: 0 行。然后 `npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit)`，`npx jest src/modules/trading/deposit-transactions src/modules/deposit-sumsub`。起 preview 打开一笔 OPERATION_PENDING 的充值详情（`demo:deposit` 花名册 #6 小额挂起单），截图 Release Hold 区域。

- [ ] **Step 6: Commit**

```bash
git add -A src scripts test admin-web/src doc-final/modules/v4-deposit.md doc-final/PRODUCTION-NOTES.md doc-final/BACKLOG.md
git commit -m "refactor: 「Gate 0」退役统一 L1（业主 2026-09-05 命名裁定）；管理台 Release Hold 提示按「先合规后挂起」重写"
```

---

### Task 5: 地址域留痕——五门 DENIED、客户动作 actor、requestId、落地行 from/to

**本任务做 / 不做**：只改 `withdrawal-address-workflow.service.ts` 与其 spec。主体层 `withdrawal-address.service.ts` 照抛不改（铁律③）。

**Files:**
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`
- Test: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 登记的 `WITHDRAWAL_ADDRESS_REQUEST_DENIED`
- Produces: 客户发起的 5 个动作（登记链上地址 / 登记银行账户 / 取消 / 停用 / 改标签）审计 `actorType=CUSTOMER`；全部 9 处 record 带 `requestId`；5 条落地行带 `fromStatus/toStatus`；五门拒绝写 DENIED 行后重抛

- [ ] **Step 1: 先改既有断言再加新用例**

`describe('… deactivateAddress')` 里 `auditLogsService` mock 加 `recordByActor: jest.fn().mockResolvedValue({})`，`'calls addressService.deactivate and writes ADDRESS_DEACTIVATED audit'` 的断言改为：
```ts
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_DEACTIVATED',
        fromStatus: 'ACTIVE',
        toStatus: 'DEACTIVATED',
        requestId: expect.stringMatching(/^WITHDRAWAL_ADDRESS_DEACTIVATED_WAD1001_/),
      }),
      expect.objectContaining({ actorType: 'CUSTOMER', actorNo: 'CUST0001' }),
    );
```
同 describe 加：
```ts
  it('最后一个法币地址停不掉 → 主体层抛 LAST_ACTIVE_FIAT_ADDRESS，workflow 记 DENIED 后原样重抛', async () => {
    const { BadRequestException } = await import('@nestjs/common');
    addressService.deactivate.mockRejectedValue(
      new BadRequestException({ code: 'LAST_ACTIVE_FIAT_ADDRESS', message: '这是最后一个可用法币提现地址' }),
    );

    await expect(workflow.deactivateAddress('WAD1001', 'cust-1', 'CUST0001', 'bye')).rejects.toMatchObject({
      response: { code: 'LAST_ACTIVE_FIAT_ADDRESS' },
    });
    expect(auditLogsService.recordByActor).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED',
        actionDomain: 'CONFIG',
        outcome: 'DENIED',
        reasonCode: 'LAST_ACTIVE_FIAT_ADDRESS',
        primarySubjectNo: 'WAD1001',
        ownerCustomerNo: 'CUST0001',
      }),
      expect.objectContaining({ actorType: 'CUSTOMER' }),
    );
  });

  it('非五门的错误（ADDRESS_NOT_FOUND 等）不记 DENIED', async () => {
    addressService.findByNo.mockResolvedValue(null);
    await expect(workflow.deactivateAddress('WAD9', 'cust-1', 'CUST0001', 'bye')).rejects.toThrow();
    expect(auditLogsService.recordByActor).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED' }),
      expect.anything(),
    );
  });
```
`registerAddress` 的 describe：`'rejects with NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS…'` 加断言 `recordByActor` 被调用且 `reasonCode: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS'`；`'proceeds when…'` 加断言 `WITHDRAWAL_ADDRESS_REGISTERED` 走 `recordByActor`（CUSTOMER）且 `requestId` 匹配 `/^WITHDRAWAL_ADDRESS_REGISTERED_/`。该 describe 的 `auditLogsService` mock 同样补 `recordByActor`。

- [ ] **Step 2: 跑确认红**

Run: `npx jest src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.spec.ts`
Expected: 新增 / 改动的用例 FAIL

- [ ] **Step 3: 改 workflow**

(a) import：`import { Injectable, Inject, Logger, NotFoundException, BadRequestException, ForbiddenException, HttpException } from '@nestjs/common';`，`import { AuditOutcome, AuditActorContext } from '../../audit-logging/dto/audit-log.dto';`，删掉 `AuditBusinessWorkflowTypes,` 那一行 import（死 import，Task 10 会统一清，本文件顺手）。

(b) 类里加三个私有件：

```ts
  /** 五门：主体层抛的业务拒绝码（其余异常不算「被拦下」，不记） */
  private static readonly DENIED_GATE_CODES: ReadonlySet<string> = new Set([
    'ADDRESS_LIMIT_REACHED',
    'COOLING_PERIOD_NOT_EXPIRED',
    'LAST_ACTIVE_FIAT_ADDRESS',
    'ADDRESS_HAS_INFLIGHT_WITHDRAWAL',
    'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS',
  ]);

  private customerActor(customerNo: string): AuditActorContext {
    return { actorType: 'CUSTOMER', actorNo: customerNo, actorDisplayName: customerNo, actorRolesAtTime: ['CUSTOMER'] };
  }

  /**
   * 法一·被拦下也留痕：主体层照抛（铁律③ 主体不写审计），这里认出五门的 code 就记一条 DENIED，再原样重抛。
   */
  private async recordDeniedAndRethrow(
    err: unknown,
    ctx: { attempted: string; addressNo?: string; customerNo: string; actor: AuditActorContext; sourcePlatform: 'CLIENT_API' | 'ADMIN_API'; metadata?: Record<string, unknown> },
  ): Promise<never> {
    const body: any = err instanceof HttpException ? err.getResponse() : null;
    const code: string | undefined = body && typeof body === 'object' ? body.code : undefined;
    if (code && WithdrawalAddressWorkflowService.DENIED_GATE_CODES.has(code)) {
      await this.auditLogsService.recordByActor(
        {
          action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED',
          actionDomain: 'CONFIG',
          primarySubjectType: AuditEntityTypes.WITHDRAWAL_ADDRESS,
          primarySubjectNo: ctx.addressNo,
          outcome: AuditOutcome.DENIED,
          reasonCode: code,
          reason: `${ctx.attempted} denied: ${body.message ?? code}`,
          metadata: ctx.metadata,
          ownerCustomerNo: ctx.customerNo,
          requestId: `WITHDRAWAL_ADDRESS_REQUEST_DENIED_${ctx.addressNo ?? ctx.customerNo}_${crypto.randomUUID()}`,
          sourcePlatform: ctx.sourcePlatform,
        } as any,
        ctx.actor,
      );
    }
    throw err;
  }
```

(c) 逐方法改（形状一致，全部写出）：

`registerAddress`：法币前置那段改为
```ts
    if (!(await this.addressService.hasActiveFiatWithdrawalAddress(customerId))) {
      await this.recordDeniedAndRethrow(
        new ForbiddenException({ code: 'NO_ACTIVE_FIAT_WITHDRAWAL_ADDRESS', message: '需要先创建并激活一个法币提现地址才能登记提现地址' }),
        { attempted: 'registerAddress', customerNo, actor: this.customerActor(customerNo), sourcePlatform: 'CLIENT_API', metadata: { network: network.code } },
      );
    }
```
`const address = await this.addressService.create({...})` 包成
```ts
    const address = await this.addressService.create({ /* 原参数不动 */ }).catch((err) =>
      this.recordDeniedAndRethrow(err, { attempted: 'registerAddress', customerNo, actor: this.customerActor(customerNo), sourcePlatform: 'CLIENT_API', metadata: { network: network.code, address: dto.address } }),
    );
```
其后的 `recordSystem({ action: 'WITHDRAWAL_ADDRESS_REGISTERED', … })` 改成 `recordByActor({ …同字段, requestId: \`WITHDRAWAL_ADDRESS_REGISTERED_${address.addressNo}_${crypto.randomUUID()}\` } as any, this.customerActor(customerNo))`。

`registerBankAccount`：`createBankAccount(...)` 同款 `.catch(...)`（attempted `'registerBankAccount'`）；审计改 `recordByActor` + requestId。

`cancelAddress`：`this.addressService.cancel(addressNo, customerId)` 同款 `.catch(...)`（带 `addressNo`）；审计改 `recordByActor` + `fromStatus: existing.status, toStatus: result.status` + requestId。

`deactivateAddress`：同 cancel（attempted `'deactivateAddress'`）。

`updateAddress`：审计改 `recordByActor` + requestId（不涉五门，无 catch）。

`activateAddress`（系统扫描 / 懒激活）：**保持 `recordSystem`**，加 `fromStatus: existing.status, toStatus: result.status` + `requestId: \`WITHDRAWAL_ADDRESS_ACTIVATED_${addressNo}_${crypto.randomUUID()}\``。

`suspendAddress` / `skipCoolingPeriod` / `unsuspendAddress`（管理员，已是 `recordByActor`）：各加 `fromStatus: existing.status, toStatus: result.status` + requestId（模板 `<码>_<addressNo>_<uuid>`）；`skipCoolingPeriod` 的 `skipCooling(addressNo)` 与 `suspendAddress` 的 `suspend(...)` 都包 `.catch(...)`（attempted 对应方法名，`sourcePlatform: 'ADMIN_API'`，actor 用该方法已有的 ADMIN actor 对象）——冷却中地址管理员停不掉 / 已过冷却再跳过，都可能撞五门。

- [ ] **Step 4: 跑确认绿 + 计数核对**

Run: `npx jest src/modules/asset-treasury/withdrawal-addresses/`
Expected: PASS。再核：
```bash
grep -c "requestId" src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts   # ≥ 10（9 处 record + DENIED）
grep -c "recordSystem(" src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts   # 1（只剩 activateAddress）
```

- [ ] **Step 5: 随手闸 ① + Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/asset-treasury/withdrawal-addresses/
git commit -m "feat(withdrawal-address): 五门拒绝留 DENIED 痕（WITHDRAWAL_ADDRESS_REQUEST_DENIED）；客户动作 actor=CUSTOMER；9 处 requestId；落地行带 from/to"
```

---

### Task 6: 资产 / 费率落地行补 from/to

**Files:**
- Modify: `src/modules/asset-treasury/assets/asset-suspension-workflow.service.ts`（`ASSET_SUSPENDED` 记录现 `:148-162`）
- Modify: `src/modules/asset-treasury/assets/asset-reactivation-workflow.service.ts`（`ASSET_REACTIVATED` 现 `:148` 附近）
- Modify: `src/modules/trading/swap-fee-level/swap-fee-level-creation-workflow.service.ts:180-200`、`src/modules/trading/withdrawal-fee-level/withdrawal-fee-level-creation-workflow.service.ts:176-196`
- Test: 各文件同名 `.spec.ts`（`ls` 确认存在；不存在的由 Task 12 的判据 V1 兜底断言 `ASSET_SUSPENDED` 的 from/to）

- [ ] **Step 1: 改四处审计调用**

`ASSET_SUSPENDED` 的 `recordSystem({...})` 加 `fromStatus: 'ACTIVE', toStatus: 'SUSPENDED',`；`ASSET_REACTIVATED` 加 `fromStatus: 'SUSPENDED', toStatus: 'ACTIVE',`；两族 `*_FEE_LEVEL_CREATION_APPLIED` 加 `fromStatus: 'PENDING_APPROVAL', toStatus: 'ACTIVE',`（这两个值来自 `asset-transitions.constant.ts` 与 `shared/fee-level-transitions.constant.ts` 的边，不是猜的）。

- [ ] **Step 2: 有 spec 的补断言**

对存在的 spec：找到断言该动作码的 `toHaveBeenCalledWith(expect.objectContaining({ action: 'ASSET_SUSPENDED' …` 处，加 `fromStatus: 'ACTIVE', toStatus: 'SUSPENDED'`（其余三处同理）。没有 spec 的文件不新建（判据 V1 兜底）。

Run: `npx jest src/modules/asset-treasury/assets src/modules/trading/swap-fee-level src/modules/trading/withdrawal-fee-level`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
npx tsc --noEmit -p tsconfig.json
git add src/modules/asset-treasury/assets src/modules/trading/swap-fee-level src/modules/trading/withdrawal-fee-level
git commit -m "feat(audit): 资产暂停/恢复与费率创建落地行带 fromStatus/toStatus"
```

---

### Task 7: 兑换实时报价带客户身份（岔口 4）

**Files:**
- Modify: `src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts:129-146`
- Create: `src/modules/trading/swap-transactions/swap-transactions-customer.controller.spec.ts`

- [ ] **Step 1: 写失败测试**

```ts
import { SwapTransactionsCustomerController } from './swap-transactions-customer.controller';

describe('SwapTransactionsCustomerController.getRate（波二·岔口 4）', () => {
  it('实时报价预览把客户身份传给 getExecutableRate（否则 VIP 打字时看到默认档价）', async () => {
    const swapTransactionsService = { getExecutableRate: jest.fn().mockResolvedValue({ executableRate: 3.67 }) };
    // 绕过构造器顺序：控制器字段就是普通属性
    const ctrl = Object.assign(Object.create(SwapTransactionsCustomerController.prototype), { swapTransactionsService });

    await ctrl.getRate({ user: { userId: 'cust-grace' } }, 'a-usdt', 'a-aed', '100');

    expect(swapTransactionsService.getExecutableRate).toHaveBeenCalledWith(
      'a-usdt',
      'a-aed',
      expect.objectContaining({ amount: 100, ownerType: 'CUSTOMER', ownerId: 'cust-grace' }),
    );
  });
});
```

Run: `npx jest src/modules/trading/swap-transactions/swap-transactions-customer.controller.spec.ts`
Expected: FAIL（参数错位 / ownerId 未传）

- [ ] **Step 2: 改控制器**

```ts
  @Get('rate')
  @ApiOperation({ summary: 'Get executable swap rate for an asset pair' })
  getRate(
    @Request() req: any,
    @Query('fromAssetId') fromAssetId: string,
    @Query('toAssetId') toAssetId: string,
    @Query('amount') amountRaw: string,
  ) {
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('amount query parameter is required and must be > 0');
    }
    // 波二·岔口 4：预览与确认同一身份——resolveBestLevel 按客户标签选档，缺身份就永远落默认档（BACKLOG:20）
    return this.swapTransactionsService.getExecutableRate(fromAssetId, toAssetId, {
      amount,
      ownerType: 'CUSTOMER',
      ownerId: req.user.userId,
    });
  }
```

- [ ] **Step 3: 绿 + 三闸 + Commit**

Run: `npx jest src/modules/trading/swap-transactions/ && npx tsc --noEmit -p tsconfig.json`
```bash
git add src/modules/trading/swap-transactions/swap-transactions-customer.controller.ts src/modules/trading/swap-transactions/swap-transactions-customer.controller.spec.ts
git commit -m "fix(swap): 实时报价预览带客户身份，VIP 预览价=确认价（BACKLOG:20，站 2 ④ 对照节拍）"
```

---

### Task 8: 客户端三处——⚡ 面板列全部状态资产、倒计时走秒、提现页假规则句删

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx`（`interface Asset` 现 `:16-23`；`handleSimulate…` 现 `:437-470`；模拟弹窗现 `:1056-1080`）
- Modify: `client-web/src/pages/WithdrawalAddresses.tsx`（`formatCountdown` 现 `:61-66`；组件起始 `:125`；四处调用 `:668,822,1064,1408`）
- Modify: `client-web/src/pages/Withdraw.tsx:924-931`
- Create: `client-web/src/pages/countdown.test.ts`

- [ ] **Step 1: 倒计时——先写失败测试**

把 `formatCountdown` 从 `WithdrawalAddresses.tsx` 抽到新文件 `client-web/src/pages/countdown.ts`（页面 import 它），签名改为 `(activatesAt: string, now: number)`：
```ts
export function formatCountdown(activatesAt: string, now: number): string {
  const ms = Math.max(0, new Date(activatesAt).getTime() - now);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${h}h ${m}m ${s}s`;
}
```
测试 `client-web/src/pages/countdown.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { formatCountdown } from './countdown';

describe('formatCountdown（站 5 ④ 倒计时走秒）', () => {
  const activatesAt = '2026-09-06T00:00:00.000Z';
  it('now 推进 1 秒，显示减 1 秒', () => {
    const t0 = new Date('2026-09-05T23:00:00.000Z').getTime();
    expect(formatCountdown(activatesAt, t0)).toBe('1h 0m 0s');
    expect(formatCountdown(activatesAt, t0 + 1000)).toBe('0h 59m 59s');
  });
  it('到期后钉在 0', () => {
    expect(formatCountdown(activatesAt, new Date('2026-09-06T00:00:01.000Z').getTime())).toBe('0h 0m 0s');
  });
});
```
Run: `cd client-web && npx vitest run src/pages/countdown.test.ts`
Expected: 先 FAIL（模块不存在）→ 建文件后 PASS

- [ ] **Step 2: 页面接 tick**

`WithdrawalAddresses()` 组件体开头（`:126` 之后）加：
```tsx
  // 站 5 ④：倒计时走秒。到期那一秒重拉一次列表——后端查询时懒激活，会把 PENDING_ACTIVATION 翻成 ACTIVE。
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
```
`fetchAddresses` 定义之后加：
```tsx
  useEffect(() => {
    const due = addresses.some(
      (a) => a.status === 'PENDING_ACTIVATION' && new Date(a.activatesAt).getTime() <= now,
    );
    if (due) void fetchAddresses();
  }, [now, addresses, fetchAddresses]);
```
四处 `formatCountdown(x.activatesAt)` → `formatCountdown(x.activatesAt, now)`。

- [ ] **Step 3: 提现页假规则句删**

删除 `Withdraw.tsx:924-931` 整块（`<div className="p-4 bg-fx-charcoal/60 …">` 到对应 `</div>`，即「For security reasons, your first withdrawal after changing security settings will be delayed by 24 hours.」那个提示框）。`:917-922`「Minimum Withdrawal」块保留（它说的是真话）。`grep -n "24 hours\|AlertTriangle" Withdraw.tsx`：若 `AlertTriangle` 只剩 import 无使用，连 import 一起删。

- [ ] **Step 4: ⚡ 面板资产来源**

`interface Asset` 加 `status?: string;`。组件里加：
```tsx
  // 站 4 ⑦：⚡ 面板模拟的是链上世界，链上不认我方开关——按当前网络列全部状态的资产（含 SUSPENDED，带标记）。
  // 真实充值下拉（filteredAssets）仍只读 ACTIVE 列表，两者刻意分离。
  const [simAssets, setSimAssets] = useState<Asset[]>([]);
  const [simAssetId, setSimAssetId] = useState('');
  useEffect(() => {
    if (!showSimulateModal || !depositWallet) return;
    (async () => {
      try {
        const res = await customerFetch(`${import.meta.env.VITE_API_URL}/assets?take=200`);
        if (!res.ok) return;
        const data = await res.json();
        const onNetwork = ((data.items || []) as Asset[]).filter((a) => a.network === depositWallet.network);
        setSimAssets(onNetwork);
        setSimAssetId((cur) => (onNetwork.some((a) => a.id === cur) ? cur : (selectedAsset?.id ?? onNetwork[0]?.id ?? '')));
      } catch (err) {
        if (err instanceof CustomerSessionError) return;
      }
    })();
  }, [showSimulateModal, depositWallet, selectedAsset?.id]);
  const simAsset = simAssets.find((a) => a.id === simAssetId) ?? selectedAsset;
```
模拟提交处 `if (!depositWallet || !selectedAsset) return;` → `if (!depositWallet || !simAsset) return;`，`buildMockInboundSignalPayload(depositWallet, selectedAsset, …)` → `(depositWallet, simAsset, …)`。弹窗里 `{signalFeedback ? renderSimulationFeedback(signalFeedback) : null}` 之后插入：
```tsx
              <label className="block text-xs text-fx-dust">
                Asset (on {depositWallet.network})
                <select
                  className="mt-1 w-full rounded-xl border border-fx-rule bg-fx-charcoal/50 px-3 py-2 text-sm text-fx-sand"
                  value={simAssetId}
                  onChange={(e) => setSimAssetId(e.target.value)}
                  disabled={simulatingSignal}
                >
                  {simAssets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code}{a.status && a.status !== 'ACTIVE' ? ` — ${a.status}` : ''}
                    </option>
                  ))}
                </select>
              </label>
```

- [ ] **Step 5: 三闸 + 截图**

```bash
cd client-web && npx tsc -b --noEmit && npx vitest run && cd ..
```
起 preview（client 端口见 `.stackports`）：① 地址页一条冷却中地址，连续两张间隔 ≥1s 的截图，秒数变化；② 提现页无 24h 句；③ 把 USDT-TRON 暂停（ops 提 → ciso 批，管理台）后打开充值页 ⚡ 面板，截图下拉里出现 `USDT — SUSPENDED`；截图存 `doc-final/superpowers/plans/artifacts/wave2/`。

- [ ] **Step 6: Commit**

```bash
git add client-web/src
git commit -m "feat(client): 冷却倒计时走秒；提现页删假的 24h 规则句；⚡ 入金面板按网络列全部状态资产（站 4 ⑦ 前置）"
```

---

### Task 9: 管理台费率表单中文夹英文改英文（地址详情按钮门控已在 HEAD 落地，只截图复核）

**Files:**
- Modify: `admin-web/src/pages/SwapFeeLevelList.tsx:609,623`、`admin-web/src/pages/WithdrawalFeeLevelList.tsx:563,577`
- 复核（不改）：`admin-web/src/pages/WithdrawalAddressDetail.tsx:136,455-495`——`canWrite = hasAnyPermission([PERMISSIONS.WITHDRAWAL_ADDRESS_SUSPEND])` 已门控三个按钮（波一做的，体检 D7 那条已过期）

- [ ] **Step 1: 改四处文案**

`Select 全体客户（everyone） for no restriction, or a single tag this level applies to.` → `Select "Everyone" for no restriction, or a single tag this level applies to.`；`<option value="">全体客户（everyone）</option>` → `<option value="">Everyone (no restriction)</option>`。两文件各两处。
Run: `grep -rn "全体客户\|长期有效" admin-web/src/pages/*FeeLevel* | wc -l` → 0

- [ ] **Step 2: 三闸 + 截图**

`cd admin-web && npx tsc -b --noEmit && cd ..`；preview：cfo@ 登录费率页「新建」表单截图；sm@ 登录一条 ACTIVE 地址详情，截图证明无 Force Suspend 按钮（门控复核）。

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/SwapFeeLevelList.tsx admin-web/src/pages/WithdrawalFeeLevelList.tsx
git commit -m "fix(admin): 费率受众表单中文夹英文改英文"
```

---

### Task 10: 搭车——死 import、`/dashboard` 旧树、`AssetProvisioningService`

**本任务做 / 不做**：纯删。不动 `/admin` 树、不动 `systemAccountCodesFor`。

**Files:**
- Modify: 21 个只 import 不用 `AuditBusinessWorkflowTypes` 的文件（开工时重数）
- Modify: `admin-web/src/App.tsx`（`:55-56` 两个 lazy import；`:182-409` 整棵 `/dashboard` 树）
- Delete: `admin-web/src/pages/PolicyChangeRequestsPage.tsx`、`admin-web/src/pages/PolicyChangeRequestDetailPage.tsx`
- Modify: `src/modules/asset-treasury/assets/asset-provisioning.service.ts`（只留 `systemAccountCodesFor`）、`assets.module.ts`；Delete: `asset-provisioning.service.spec.ts`

- [ ] **Step 1: 死 import**

```bash
for f in $(grep -rl "AuditBusinessWorkflowTypes" src --include='*.ts' | grep -v spec | grep -v "audit-actions.constant.ts"); do
  n=$(grep -c "AuditBusinessWorkflowTypes" "$f"); [ "$n" = "1" ] && echo "$f"; done
```
对列出的每个文件，删掉 import 花括号里的 `AuditBusinessWorkflowTypes,` 一行（若整个 import 只剩它，删整条 import）。再跑同一条命令 → 0 行；`npx tsc --noEmit -p tsconfig.json` → 0 错。

- [ ] **Step 2: `/dashboard` 树**

先核边界：`grep -n '<Route path="/dashboard">' admin-web/src/App.tsx`（应 182）与 `grep -n '/funds-layer + /ledger roots removed' admin-web/src/App.tsx`（应 407）；删除从 `<Route path="/dashboard">` 到它的闭合 `</Route>`——即那条注释上方最近的一行 `</Route>`（现 `:405`）——整段，删 `:55-56` 两行 lazy import，删两个页面文件。核：
```bash
grep -rn "PolicyChangeRequest\|'/dashboard" admin-web/src | grep -v "App.tsx" ; echo "(应为空)"
cd admin-web && npx tsc -b --noEmit && cd ..
```
preview 登录管理台，随手点侧栏 5 个入口都 200（`/admin` 树不动）。

- [ ] **Step 3: `AssetProvisioningService`**

`asset-provisioning.service.ts` 只保留 `systemAccountCodesFor` 与它用到的 `TB_ACCOUNT_CODES` import（删 `@Injectable` 类、`PrismaService` / `AccountingService` / `CreateTbAccountParams` / `Prisma` / `Logger` import）；`assets.module.ts` 删 import 与 providers 里的 `AssetProvisioningService`；删 `asset-provisioning.service.spec.ts`。核：`grep -rn "AssetProvisioningService" src prisma` → 0；`prisma/seed.business.ts:12` 的 import 路径不变仍可用。

- [ ] **Step 4: 三闸 + jest + Commit**

```bash
npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit) && npx jest src/modules/asset-treasury/assets
git add -A src admin-web/src
git commit -m "chore: 清 21 处 AuditBusinessWorkflowTypes 死 import；删整棵零入站的 /dashboard 旧路由树与两张死页；删零调用方的 AssetProvisioningService（保留 systemAccountCodesFor 供种子）"
```

---

### Task 11: 两张手抄表配伴生断言——`verify:audit` 改 import 源常量；S9 表 ↔ 前端路由表

**Files:**
- Modify: `scripts/verify-audit.ts:78-100`
- Create: `scripts/verify-rbac.tables.ts`；Modify: `scripts/verify-rbac.ts:504-532`
- Create: `admin-web/src/pages/approvalEntityRoutes.ts`；Modify: `admin-web/src/pages/ApprovalDetailPage.tsx:86-115`
- Create: `admin-web/src/pages/approvalEntityRoutes.spec.ts`（jest，`jest.config.js` 的 roots 含 `admin-web/src` 与 `scripts`）

- [ ] **Step 1: `verify-audit` 用源常量**

文件头加 `import { DEPRECATED_AUDIT_ACTIONS } from '../src/modules/audit-logging/constants/audit-actions.constant';`，把 `where: { action: { in: [ …手抄清单… ] } }` 改为 `where: { action: { in: [...DEPRECATED_AUDIT_ACTIONS] } }`，删掉手抄清单与其上方那段「从旧附册搬进 V1 合同」的注释。Run：`bash scripts/on-stack.sh self verify:audit` → 全绿。若不变量③ 因源常量里某个码在库里仍有合法写入而转红，**那是真发现**：记进任务汇报，不许把码从源常量里挪走了事。

- [ ] **Step 2: S9 表抽成可 import 模块**

`scripts/verify-rbac.tables.ts`（无副作用，只导出）：
```ts
/**
 * S9：审批策略 → 裁决人必须持有的详情页读权限组。
 * 镜像 admin-web/src/pages/approvalEntityRoutes.ts 的 ENTITY_ROUTE_BY_ACTION 键集——两边键集相等由
 * admin-web/src/pages/approvalEntityRoutes.spec.ts 断言（判例：每张手工维护的表都必须配伴生断言）。
 */
export const DETAIL_READ_GROUP_BY_POLICY: Record<string, string> = {
  // ↓ 把 verify-rbac.ts:506-532 那张表原样搬过来（23 条），不增不减
};
```
`verify-rbac.ts` 删原表，加 `import { DETAIL_READ_GROUP_BY_POLICY } from './verify-rbac.tables';`。

- [ ] **Step 3: 前端路由表抽出**

`admin-web/src/pages/approvalEntityRoutes.ts`：把 `ApprovalDetailPage.tsx` 的 `const ENTITY_ROUTE_BY_ACTION: Record<string, (ref: string) => string | null> = {…}` 整段（含注释）搬过来并 `export`；`ApprovalDetailPage.tsx` 改 `import { ENTITY_ROUTE_BY_ACTION } from './approvalEntityRoutes';`。

- [ ] **Step 4: 伴生断言**

`admin-web/src/pages/approvalEntityRoutes.spec.ts`：
```ts
// 守则性测试：S9 表（scripts）与审批详情页路由表（admin-web）必须键集相等。
// 跨包相对 import 是刻意的，只发生在 spec 里（先例 utils/restrictionCauseMeta.spec.ts）。
import { ENTITY_ROUTE_BY_ACTION } from './approvalEntityRoutes';
import { DETAIL_READ_GROUP_BY_POLICY } from '../../../scripts/verify-rbac.tables';

describe('S9 表 ↔ 审批详情页路由表', () => {
  it('两边键集相等（新增审批策略要两边同时加）', () => {
    const page = Object.keys(ENTITY_ROUTE_BY_ACTION).sort();
    const gate = Object.keys(DETAIL_READ_GROUP_BY_POLICY).sort();
    expect(gate).toEqual(page);
  });
});
```
Run: `npx jest admin-web/src/pages/approvalEntityRoutes.spec.ts` → PASS（23 = 23；若不等，差集就是真漂移，按 spec 判例补齐后再绿）。

- [ ] **Step 5: 三闸 + Commit**

```bash
npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit) && bash scripts/on-stack.sh self verify:rbac
git add scripts/verify-audit.ts scripts/verify-rbac.ts scripts/verify-rbac.tables.ts admin-web/src/pages/approvalEntityRoutes.ts admin-web/src/pages/approvalEntityRoutes.spec.ts admin-web/src/pages/ApprovalDetailPage.tsx
git commit -m "test(gates): verify:audit 退役名单改读源常量；S9 表与审批详情页路由表抽成模块并配伴生断言"
```

---

### Task 12: `verify:act1` 扩 V 组判据（V1–V10）

**本任务做 / 不做**：只加判据；每条判据真登录真 HTTP（禁扫源码）；判据自带夹具、自带清理（重铺闸会冲掉残留）。

**Files:**
- Modify: `scripts/verify-act1.ts`（在 B14 之后、汇总之前插入；`/15` 改成动态）

**Interfaces:**
- Consumes: Task 2/3/5/7 的行为；路由 `POST /admin/assets/:assetNo/suspend|reactivate`、`POST /admin/control-gates/approvals/:approvalNo/approve`、`POST /auth/customer/login`、`POST /client/deposit-wallets`、`POST /deposit-transactions/my/inbound-signals` + `/scan`、`POST /admin/deposit-sumsub/demo/run-verdict`、`POST /deposit-transactions/:id/waive-limit`、`POST /swap-transactions/quotes` + `POST /swap-transactions` + `GET /swap-transactions/rate`、`POST /client/withdraw-transactions`、`POST /client/withdrawal-addresses` + `POST /admin/withdrawal-addresses/:addressNo/skip-cooling`、`GET /admin/audit-logs?subjectNo=`

- [ ] **Step 1: 助手**（放在 `call()` 之后）

```ts
async function customerLogin(email: string): Promise<string> {
  const r = await fetch(`${API}/auth/customer/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: '123456' }),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!j.access_token) throw new Error(`客户登录失败: ${email} → ${r.status} ${JSON.stringify(j)}`);
  return j.access_token as string;
}

/** 运营提暂停/恢复 → CISO 批 → 等资产落到目标状态 */
async function driveAssetStatus(assetNo: string, target: 'SUSPENDED' | 'ACTIVE', tokens: Record<string, string>): Promise<string> {
  const action = target === 'SUSPENDED' ? 'suspend' : 'reactivate';
  precheckRoute('POST', `/admin/assets/:assetNo/${action}`);
  const req = await call('POST', `/admin/assets/${assetNo}/${action}`, tokens.ops_officer, { reason: `verify:act1 V 组 ${action}` });
  if (req.status >= 300) throw new Error(`${action} → ${req.status} ${req.text}`);
  const approvalNo: string = req.json.approvalNo;
  const ok = await call('POST', `/admin/control-gates/approvals/${approvalNo}/approve`, tokens.ciso, { reason: 'verify:act1' });
  if (ok.status >= 300) throw new Error(`approve ${approvalNo} → ${ok.status} ${ok.text}`);
  const landed = await waitUntil(async () => (await prisma.asset.findFirst({ where: { assetNo } }))?.status === target, 15_000, 300);
  if (!landed) throw new Error(`资产 ${assetNo} 未在 15s 内到 ${target}`);
  return approvalNo;
}
```

- [ ] **Step 2: V 组判据**（插在 `judge('B14', …)` 之后）

```ts
  // ══════════════════════ V1–V10：波二 · 资产暂停是 L1 硬门 + 留痕 + 报价身份 ══════════════════════
  const usdt = await prisma.asset.findFirstOrThrow({ where: { currency: 'USDT', network: 'TRON' } });
  const aed = await prisma.asset.findFirstOrThrow({ where: { currency: 'AED' } });
  const alice = await prisma.customerMain.findFirstOrThrow({ where: { email: 'demo_alice@example.com' } });
  const aliceTok = await customerLogin('demo_alice@example.com');
  const graceTok = await customerLogin('demo_grace@example.com');
  const vStart = new Date();

  // ── 第一轮暂停：V3 暂停期间入金 → V4 通过后挂运营 → 恢复 → V5 放行入账（alice 由此拿到 150 USDT，供 V1/V6 的兑换用）
  await driveAssetStatus(usdt.assetNo!, 'SUSPENDED', tokens);

  const wallet = await call('POST', '/client/deposit-wallets', aliceTok, { network: 'TRON' });
  const toAddress: string = wallet.json?.address ?? wallet.json?.wallet?.address;
  if (!toAddress) throw new Error(`POST /client/deposit-wallets 没返回地址：${wallet.status} ${wallet.text}`);
  const txSeed = `${Date.now()}`;
  await call('POST', '/deposit-transactions/my/inbound-signals', aliceTok, {
    network: 'TRON', toAddress, contractAddress: usdt.contractAddress, amount: '150',
    txHash: Buffer.from(`v3-${txSeed}`).toString('hex').padEnd(64, '0').slice(0, 64),
    fromAddress: `TVerifyAct1${txSeed}`.padEnd(34, 'x').slice(0, 34),
  });
  const scan = await call('POST', '/deposit-transactions/my/inbound-signals/scan', aliceTok, { network: 'TRON', toAddress });
  const depositId: string | undefined = scan.json?.depositIds?.[0];
  let v3row: any = null;
  const v3ok = !!depositId && (await waitUntil(async () => {
    v3row = await prisma.depositTransaction.findUnique({ where: { id: depositId } });
    return v3row?.status === 'COMPLIANCE_PENDING' && v3row?.limitHoldReason === 'ASSET_SUSPENDED' && !!v3row?.sumsubTxnId;
  }, 15_000, 300));
  const v3snap = v3row?.l1Snapshot ? JSON.parse(v3row.l1Snapshot) : null;
  const v3held = depositId ? await prisma.auditLogEvent.findFirst({
    where: { action: 'DEPOSIT_L1_HELD', primarySubjectNo: v3row?.depositNo, recordedAt: { gte: vStart } },
    include: { subjects: true },
  }) : null;
  judge(
    'V3',
    v3ok && v3snap?.checks?.some((c: any) => c.code === 'ASSET_AVAILABILITY' && c.outcome === 'FAIL')
      && !!v3held && v3held.fromStatus == null
      && v3held.subjects.some((s: any) => s.subjectType === 'ASSET' && s.subjectNo === usdt.assetNo && s.subjectRole === 'RELATED'),
    `暂停期间入金 scan → depositIds=${JSON.stringify(scan.json?.depositIds)} status=${v3row?.status} hold=${v3row?.limitHoldReason} sumsubTxnId=${v3row?.sumsubTxnId ? '有' : '无'} DEPOSIT_L1_HELD=${v3held ? '有' : '无'}`,
  );

  const v4 = depositId ? await call('POST', '/admin/deposit-sumsub/demo/run-verdict', tokens.admin, { depositId, verdict: 'V1_APPROVED' }) : { status: 0, json: null, text: 'no deposit' };
  const v4ok = v4.status < 300 && (await waitUntil(async () => (await prisma.depositTransaction.findUnique({ where: { id: depositId! } }))?.status === 'OPERATION_PENDING', 15_000, 300));
  const v4held = v3row ? await prisma.auditLogEvent.findFirst({
    where: { action: 'DEPOSIT_HELD', primarySubjectNo: v3row.depositNo, recordedAt: { gte: vStart } }, include: { subjects: true },
  }) : null;
  judge(
    'V4',
    v4ok && v4held?.fromStatus === 'COMPLIANCE_PENDING' && v4held?.toStatus === 'OPERATION_PENDING' && v4held?.reasonCode === 'ASSET_SUSPENDED'
      && v4held.subjects.some((s: any) => s.subjectType === 'ASSET' && s.subjectNo === usdt.assetNo),
    `run-verdict(V1_APPROVED) → ${v4.status}；DEPOSIT_HELD from=${v4held?.fromStatus} to=${v4held?.toStatus} reason=${v4held?.reasonCode}`,
  );

  await driveAssetStatus(usdt.assetNo!, 'ACTIVE', tokens);
  const suspendedRow = await prisma.auditLogEvent.findFirst({ where: { action: 'ASSET_SUSPENDED', primarySubjectNo: usdt.assetNo!, recordedAt: { gte: vStart } } });
  precheckRoute('POST', '/deposit-transactions/:id/waive-limit');
  const v5 = depositId ? await call('POST', `/deposit-transactions/${depositId}/waive-limit`, tokens.ops_officer) : { status: 0, json: null, text: 'no deposit' };
  const v5ok = v5.status < 300 && (await waitUntil(async () => (await prisma.depositTransaction.findUnique({ where: { id: depositId! } }))?.status === 'SUCCESS', 20_000, 300));
  judge('V5', v5ok && suspendedRow?.fromStatus === 'ACTIVE' && suspendedRow?.toStatus === 'SUSPENDED',
    `恢复后 Release Hold → ${v5.status}，终态=${v5ok ? 'SUCCESS' : '未到 SUCCESS'}；ASSET_SUSPENDED 行 from/to=${suspendedRow?.fromStatus}/${suspendedRow?.toStatus}`);

  // ── V7/V8：地址登记 actor 与四门之一（同时给 V2 备一个 ACTIVE 的 TRON 地址）
  const { fakeTronAddress } = await import('../src/common/utils/tron-address.util');
  // 客户路由不在 RBAC_PERMISSION_DEFINITIONS 里，不走 precheckRoute（它只核管理端路由）
  const reg1 = await call('POST', '/client/withdrawal-addresses', aliceTok, { network: 'TRON', address: fakeTronAddress(`act1-${txSeed}-1`), ownershipDeclaration: true, label: 'verify:act1 V7' });
  const addr1No: string | undefined = reg1.json?.addressNo;
  const v7row = addr1No ? await prisma.auditLogEvent.findFirst({ where: { action: 'WITHDRAWAL_ADDRESS_REGISTERED', primarySubjectNo: addr1No } }) : null;
  judge('V7', reg1.status < 300 && reg1.json?.status === 'PENDING_ACTIVATION' && v7row?.actorType === 'CUSTOMER' && !!v7row?.requestId,
    `登记链上地址 → ${reg1.status} ${reg1.json?.status}；审计 actorType=${v7row?.actorType} requestId=${v7row?.requestId ? '有' : '无'}`);

  const existingActive = await prisma.withdrawalAddress.count({ where: { customerId: alice.id, network: 'TRON', status: { in: ['PENDING_ACTIVATION', 'ACTIVE'] } } });
  for (let i = existingActive; i < 3; i += 1) {
    await call('POST', '/client/withdrawal-addresses', aliceTok, { network: 'TRON', address: fakeTronAddress(`act1-${txSeed}-fill${i}`), ownershipDeclaration: true });
  }
  const reg4 = await call('POST', '/client/withdrawal-addresses', aliceTok, { network: 'TRON', address: fakeTronAddress(`act1-${txSeed}-4`), ownershipDeclaration: true });
  const v8row = await prisma.auditLogEvent.findFirst({
    where: { action: 'WITHDRAWAL_ADDRESS_REQUEST_DENIED', reasonCode: 'ADDRESS_LIMIT_REACHED', ownerCustomerNo: alice.customerNo, recordedAt: { gte: vStart } },
  });
  judge('V8', reg4.status === 400 && reg4.json?.code === 'ADDRESS_LIMIT_REACHED' && !!v8row && v8row.outcome === 'DENIED',
    `同网络第 4 条 → ${reg4.status} ${reg4.json?.code}；DENIED 行=${v8row ? '有' : '无'}`);

  if (addr1No) {
    precheckRoute('POST', '/admin/withdrawal-addresses/:addressNo/skip-cooling');
    await call('POST', `/admin/withdrawal-addresses/${addr1No}/skip-cooling`, tokens.treasury, { reason: 'verify:act1 V2 需要一个 ACTIVE 地址' });
  }
  const activeAddr = await prisma.withdrawalAddress.findFirst({ where: { customerId: alice.id, network: 'TRON', status: 'ACTIVE' } });

  // ── 第二轮暂停：V1 兑换 BLOCK、V2 提现 BLOCK（alice 此刻已有 150 USDT，余额前置不会先拦）
  await driveAssetStatus(usdt.assetNo!, 'SUSPENDED', tokens);
  const q1 = await call('POST', '/swap-transactions/quotes', aliceTok, { fromAssetId: usdt.id, toAssetId: aed.id, fromAmount: 10 });
  const v1 = q1.status < 300 ? await call('POST', '/swap-transactions', aliceTok, { quoteId: q1.json.id }) : { status: q1.status, json: q1.json, text: q1.text };
  const v1row = await prisma.auditLogEvent.findFirst({
    where: { action: 'SWAP_L1_BLOCKED', ownerCustomerNo: alice.customerNo, recordedAt: { gte: vStart } }, include: { subjects: true }, orderBy: { recordedAt: 'desc' },
  });
  judge('V1', v1.status === 403 && v1.json?.code === 'L1_GATE_BLOCKED' && v1row?.outcome === 'DENIED' && v1row?.reasonCode === 'ASSET_SUSPENDED'
      && v1row.subjects.some((s: any) => s.subjectType === 'ASSET' && s.subjectNo === usdt.assetNo),
    `暂停中建兑换单 → ${v1.status} ${v1.json?.code}；SWAP_L1_BLOCKED reason=${v1row?.reasonCode}`);

  const v2 = activeAddr
    ? await call('POST', '/client/withdraw-transactions', aliceTok, { assetId: usdt.id, amount: 5, toAddress: activeAddr.address })
    : { status: 0, json: null, text: 'no active TRON address' };
  const v2row = await prisma.auditLogEvent.findFirst({
    where: { action: 'WITHDRAW_L1_BLOCKED', ownerCustomerNo: alice.customerNo, recordedAt: { gte: vStart } }, orderBy: { recordedAt: 'desc' },
  });
  judge('V2', v2.status === 403 && v2.json?.code === 'L1_GATE_BLOCKED' && v2row?.outcome === 'DENIED' && v2row?.reasonCode === 'ASSET_SUSPENDED',
    `暂停中建提现单 → ${v2.status} ${v2.json?.code}；WITHDRAW_L1_BLOCKED=${v2row ? '有' : '无'}`);

  await driveAssetStatus(usdt.assetNo!, 'ACTIVE', tokens);
  const q6 = await call('POST', '/swap-transactions/quotes', aliceTok, { fromAssetId: usdt.id, toAssetId: aed.id, fromAmount: 10 });
  const v6 = q6.status < 300 ? await call('POST', '/swap-transactions', aliceTok, { quoteId: q6.json.id }) : { status: q6.status, json: q6.json, text: q6.text };
  judge('V6', v6.status === 201 || v6.status === 200, `恢复后同一客户建兑换单 → ${v6.status}（对照：门不是永远关着）${v6.status >= 300 ? ' ' + v6.text : ''}`);

  // ── V9：VIP 预览价 = 确认价（岔口 4）
  const rateGrace = await call('GET', `/swap-transactions/rate?fromAssetId=${usdt.id}&toAssetId=${aed.id}&amount=100`, graceTok);
  const rateAlice = await call('GET', `/swap-transactions/rate?fromAssetId=${usdt.id}&toAssetId=${aed.id}&amount=100`, aliceTok);
  const quoteGrace = await call('POST', '/swap-transactions/quotes', graceTok, { fromAssetId: usdt.id, toAssetId: aed.id, fromAmount: 100 });
  // 修复前两人的预览都落默认档 → tierId 相同；修复后 Grace 命中 VIP 档 → tierId 不同。用 tierId 而不用点差数值：
  // 两档点差恰好相等时数值比较会伪绿，tierId 不会。
  judge('V9',
    rateGrace.status === 200 && rateAlice.status === 200 && quoteGrace.status < 300
      && !!rateGrace.json.tierId && rateGrace.json.tierId !== rateAlice.json.tierId
      && String(quoteGrace.json.feeLevelCode).startsWith('VIP'),
    `Grace 预览 tierId=${rateGrace.json?.tierId} vs Alice ${rateAlice.json?.tierId}；Grace 报价 level=${quoteGrace.json?.feeLevelCode}`);

  // ── V10：取证路径本身进判据——审计页 Subject No 栏按资产号能拉出被它拦下的单
  const v10 = await call('GET', `/admin/audit-logs?subjectNo=${encodeURIComponent(usdt.assetNo!)}&take=100`, tokens.admin);
  const v10actions: string[] = (v10.json?.items ?? []).map((i: any) => i.action);
  judge('V10', v10.status === 200 && v10actions.includes('SWAP_L1_BLOCKED') && v10actions.includes('DEPOSIT_HELD'),
    `GET audit-logs?subjectNo=${usdt.assetNo} → ${v10.status}，含 ${['SWAP_L1_BLOCKED', 'DEPOSIT_HELD'].filter((a) => v10actions.includes(a)).join('+') || '无'}`);
```

汇总行 `console.log(\`${passCount}/15 PASS…\`)` 改为 `` `${passCount}/${results.length} PASS` ``。

（`inbound-signals/scan` 的 body 以 `client-web/src/pages/Deposit.tsx:419` 附近的调用为准——先 `sed -n '415,425p'` 看一眼；若它传的是 `walletId`，把上面 scan 的 body 换成同样的键。`ScanSummary.depositIds` 是 `scanForCustomer` 的返回字段，`inbound-transfer-signals.service.ts:406-470`。）

- [ ] **Step 3: 跑闸（顺序照 baseline：rbac → act1 → reset → demo:all）**

```bash
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:act1
```
Expected: `25/25 PASS`（15 + 10）。若 V3 因 `sumsubTxnId` 为空而红，先查 alice 的 `sumsubApplicantId`（`PRODUCTION-NOTES:360` 登记的既有缺口：缺 applicantId 时送检被跳过）——那是夹具问题，不是本波行为，给 alice 补 applicantId 后重跑；不许把 V3 的 `sumsubTxnId` 断言删掉。**变异测试**（评审人做，不是执行者）：把 Task 1 的 `own.push({ code: 'ASSET_AVAILABILITY' …` 临时改成恒 PASS 再跑 → V1/V2/V3 必红；改回。

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-act1.ts
git commit -m "test(verify:act1): V 组 10 条——资产暂停 L1 硬门三域行为、挂起证据链、地址 actor/四门 DENIED、VIP 预览价=确认价、按资产号取证"
```

---

### Task 13: 剧本、模块篇、章程与账本收口

**Files:**
- Modify: `doc-final/demo/script.md`（站 2 ④、站 4 ④⑥ + 新 ⑦、站 5 ④）
- Modify: `doc-final/modules/v3-financial-config.md:15`、`doc-final/modules/v4-deposit.md`（`:14` 进门三步、§2 表「小额/行政挂起」行、`:82` §5 缺口）、`doc-final/modules/v5-withdraw.md:72`、`doc-final/modules/v6-swap.md:68`、`doc-final/modules/overview.md` §5
- Modify: `doc-final/BACKLOG.md`（`:20`、`:23`、`:129`、`:131` 销）、`doc-final/TOOLING-DEBT.md:114`（销）、`../CLAUDE.md` §10（加一行）、`doc-final/CHANGELOG.md`（加一行）

- [ ] **Step 1: 剧本**

站 2 ④ 末尾加：「（预览即对照：Grace 输入金额时预览费用已是 VIP 档——2026-09-05 修复前预览拿不到身份，会先显示默认档价）」。
站 4 ④ 改为：「切客户端 alice：充值 / 兑换 / 提现三个页面的下拉里 USDT 同时消失（三页共读 `GET /assets?status=ACTIVE`）；**而且绕过界面直接打接口也做不成新交易**——资产可用性是 L1 第十项，兑换 / 提现建单当场 403 并留 `SWAP_/WITHDRAW_L1_BLOCKED` 痕；已经在路上的单照走完，已经到账的钱照收（见 ⑦）」。
站 4 ⑥ 改：「审计页 **Subject No 栏**填 `AS2601012024`（关键词搜索只覆盖主字段，次主体要用这一栏）……除资产自己的履历外，还能看到被它拦下的单（`SWAP_L1_BLOCKED` / `DEPOSIT_HELD`）」。
站 4 新 ⑦（放在 ⑥ 之前、③ 之后更顺：暂停中做）：「⚡ 暂停期间打进来一笔 USDT：客户端 alice 充值页 ⚡ 面板资产选 `USDT — SUSPENDED`，喂 150 → 管理台充值列表看单 COMPLIANCE_PENDING，详情 L1 十项面板资产格红、挂起原因 ASSET_SUSPENDED（**先合规后挂起**：L2 照筛）→ ⚡ 喂「① Approved」→ 单子转 OPERATION_PENDING 等运营 → 回 ⑤ 恢复资产 → 运营 Release Hold → SUCCESS，账本页看客户应付」。
站 5 ④ 「24h 冷却倒计时」后加「（走秒；到期那一秒列表自动刷新为 ACTIVE）」。

- [ ] **Step 2: 模块篇与首读**

`v3-financial-config.md:15` 那段「⚠️ 后端目前没有资产状态门……已登记 BACKLOG」整句删，改为「暂停 = L1 第十项 `ASSET_AVAILABILITY`：提现 / 兑换建单 BLOCK（403 + `*_L1_BLOCKED` 审计），充值照建单、打标、送检、合规通过后挂给运营（`DEPOSIT_L1_HELD` → `DEPOSIT_HELD`）；在途单不受影响；入金识别不判状态」。
`v4-deposit.md:14` 进门三步 ① 改为「先过 **L1**（十项快照，三分流：执法级 FREEZE / 其余 FAIL **打标记、不换状态、照常送检** / PASS 送检）」，③ 里「通过 → 入账」补「（带 L1 标记的单：通过 → `OPERATION_PENDING` 等运营）」；§2 表「小额/行政挂起」行入边注明「只从合规通过进入（`holdIfHeld`）」；`:82` 那条缺口删。
`v5-withdraw.md:72` / `v6-swap.md:68`：L1 描述加「（十项，含资产可用性；BLOCK 留 `*_L1_BLOCKED` 痕）」。
`overview.md` §5 加一行：「- 两级门：**L1** = 平台内所有限制条件的判断（`L1GateService` 十项，三域共用），**L2** = Sumsub 合规判断；`OPERATION_PENDING` 只能从 L2 通过进入」。

- [ ] **Step 3: 账本与章程**

`BACKLOG.md` `:20` `:23` `:129` `:131` 四条改 `[x]` 并在句尾加「｜ 2026-09-05 波二销：<commit>」。`TOOLING-DEBT.md:114` 改 `[x]`，句尾加「｜ 已入 `CLAUDE.md §10`」。`CLAUDE.md §10` 列表末尾加：「- **合并进 main 后必做**：重启后端 + `npm run db:base:sync`（权限字典与内存 `RBAC_PERMISSION_DEFINITIONS` 都是旧的会 403）；动过 schema / seed 再 `stack.sh reset main`」。`CHANGELOG.md` 顶部加：「- [2026-09-05] **资产暂停成了真门，被拦下的也留痕**：暂停后绕过界面打接口也做不成兑换 / 提现（403 且审计可查）；暂停期间打进来的钱照收、照筛，合规通过后挂给运营，恢复后一键放行；地址簿五道门拒绝、客户自己的登记 / 取消 / 停用，第七幕都查得到「谁、为什么」；VIP 客户报价预览与确认同价；「Gate 0」改叫 L1」。

- [ ] **Step 4: Commit**

```bash
git add doc-final ../CLAUDE.md
git commit -m "docs(波二): 剧本站 2/4/5 定稿（站 4 加暂停期间入金一拍、取证走 Subject No 栏）；v3/v4/v5/v6/overview 按 L1 十项与「先合规后挂起」改口；BACKLOG 20/23/129/131 与 TOOLING-DEBT 114 销账；合并后重启+sync 入章程；CHANGELOG"
```

---

### Task 14: 收尾闸 + 三站走查截图 + 终审

- [ ] **Step 1: 随手闸三连 + 全量 jest（本波触及目录）**

```bash
npx tsc --noEmit -p tsconfig.json && (cd admin-web && npx tsc -b --noEmit) && (cd client-web && npx tsc -b --noEmit)
npx jest src/modules/trading src/modules/asset-treasury src/modules/audit-logging src/modules/deposit-sumsub admin-web/src/pages/approvalEntityRoutes.spec.ts
(cd client-web && npx vitest run)
```

- [ ] **Step 2: 收尾闸（顺序照 `demo/baseline.md`）**

```bash
bash scripts/on-stack.sh self verify:rbac
bash scripts/on-stack.sh self verify:act1          # 25/25
bash scripts/stack.sh reset self                   # 冲掉判据残留
bash scripts/on-stack.sh self test:e2e --runInBand test/deposit-money-arcs.e2e-spec.ts test/withdraw-money-arcs.e2e-spec.ts test/swap-money-arc.e2e-spec.ts test/deposit-sumsub-verdicts.e2e-spec.ts test/withdraw-sumsub-scenarios.e2e-spec.ts test/swap-sumsub-scenarios.e2e-spec.ts
bash scripts/stack.sh reset self                   # e2e 后再重铺（e2e 与 demo:all 不同库跑，见 baseline）
bash scripts/on-stack.sh self demo:all
bash scripts/on-stack.sh self verify:coa
bash scripts/on-stack.sh self verify:audit
bash scripts/on-stack.sh self verify:demo-data
```
另外五个私库 e2e 套件按 baseline「私库先铺」跑法各跑一次（清单在 `demo/baseline.md` e2e 节）。全部全绿才算过。

- [ ] **Step 3: 三站真机走查 + 截图**（preview，两端）

站 4 新 ⑦ 全程（≥6 张：⚡ 面板选 SUSPENDED 资产 / 管理台单 COMPLIANCE_PENDING 十项面板资产格红 / OPERATION_PENDING 挂起原因 / 恢复审批 / Release Hold / SUCCESS 账本）；站 4 ⑥ 审计页 Subject No=`AS2601012024` 结果含 `SWAP_L1_BLOCKED`、`DEPOSIT_HELD`；站 2 ④ Grace 预览与确认同价；站 5 ④ 倒计时两张。存 `doc-final/superpowers/plans/artifacts/wave2/`，在 `CHANGELOG` 那行末尾链一下目录。

- [ ] **Step 4: 终审（`fable`）**

对 spec §2–§5 逐条问「这条承诺的代码在哪个 commit」，列表回答；对 spec §10 命中表逐行核「做了没」；跑一次 Task 12 的变异测试。任何「承诺了但没人建」直接开任务补，不留到合并后。

- [ ] **Step 5: 合并准备**

`superpowers:finishing-a-development-branch`：合并进 main 后**先执行本波写进章程的那条**——重启 main 栈 + `db:base:sync`；再 `rm -f /tmp/exchange_js_main/dev.db && npm run prisma:generate && bash scripts/stack.sh reset main && bash scripts/on-stack.sh main demo:all`（波一承接里的两条硬前提）。总纲与本 spec 归档到 `doc-final/archive/superpowers/`；worktree 与分支清掉。
