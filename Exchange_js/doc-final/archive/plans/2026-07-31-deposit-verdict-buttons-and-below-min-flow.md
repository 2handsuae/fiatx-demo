# 充值仿真裁决按钮 + 小额充值流程改造 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把充值详情页的 8 个多步场景剧本改成 9 个单步裁决按钮（报文按 Sumsub 官方 schema 1:1 复刻、按 `sumsubTxnType` 分型），并把小额充值的金额闸从"建单时判"挪到"合规通过后判"，新增 `OPERATION_PENDING` 状态。

**Architecture:** 三层解耦。① 纯函数报文生成器 `buildTxnReport()` 不依赖 Nest，独立可测；② 裁决按钮定义表把「按钮 → webhook type + 裁决参数」声明化，demo service 只负责组装并投进真实 ingestion；③ 状态机改动全部落在既有 `transitions` 表 + `applyKytApproved()` 单点，处置管道（审批/记账/重试）零改动。

**Tech Stack:** NestJS · Prisma/SQLite · Jest · React + Tailwind(admin-web)

**设计依据:** `doc-final/superpowers/specs/2026-07-31-deposit-verdict-buttons-and-below-min-flow-design.md`

## Global Constraints

- 后端跑 self 栈：backend 3100 / admin 3101 / client 3102 / TB 3103，DB `/tmp/exchange_js_wt_deposit_arcs/dev.db`。**禁止跨栈**。
- **绝不运行 `npm run test:e2e`**（`test/deposit-sumsub-scenarios.e2e-spec.ts:139` 无条件 `deleteMany` 清空栈库，且会把 alice 钱包重建成 `walletRole=GENERAL` 打断客户端建单）。Task 9 修好隔离后才可跑。
- 审计一律经 DI 注入的 `AuditLogsService`，禁止 `new`。
- 多表状态变更必须 `prisma.$transaction`。
- 状态值/动作值一律用 `DepositTransactionStatus` / `DepositTransactionAction` 枚举，禁止裸字符串。
- admin-web 禁止裸 Tailwind 颜色，只用 `adm-*` token（`rules/frontend-admin.md`）。
- `DepositTransaction.status` 是 `String` 列、全库 0 个 Prisma enum → **本计划零 Prisma 迁移**。
- 每个 Task 结束必须：`npx tsc --noEmit` 0 错 + 该 Task 相关 jest 全绿 + commit。

---

## File Structure

**新建**
- `src/modules/deposit-sumsub/fixtures/txn-report.builder.ts` — 纯函数：按官方 getTxn schema 生成报文，依 `txnType`/`isCrypto` 分型
- `src/modules/deposit-sumsub/fixtures/txn-report.builder.spec.ts`
- `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts` — 9 个裁决按钮的声明表（取代 `scenarios.ts`）
- `src/modules/deposit-sumsub/kyt-webhook-types.ts` — KYT webhook 类型常量单一真相源（ingestion/router/handler 共用）

**删除**
- `src/modules/deposit-sumsub/fixtures/scenarios.ts`（被 `verdict-buttons.ts` 取代）

**修改**
- `src/modules/deposit-sumsub/demo-scenario.service.ts` — 从"跑剧本"改为"投单次裁决"
- `src/modules/deposit-sumsub/admin-deposit-demo.controller.ts` — 端点语义改 verdict
- `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts` — 类型名 + `DETAIL_LOOKUP_VERDICTS`
- `src/modules/deposit-sumsub/deposit-webhook.router.ts`(+`.spec`) — 引用常量
- `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:124` — 前缀匹配改集合匹配
- `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts` — 加 `OPERATION_PENDING`
- `src/modules/trading/deposit-transactions/deposit-transactions.service.ts` — 转移表
- `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` — 金额闸 + 三处处置前置
- `admin-web/src/pages/DepositTransactionDetail.tsx` — 9 按钮 + 处置门控
- `admin-web/src/utils/depositStatusMap.ts`(+`.spec`) — `OPERATION_PENDING` 徽章
- `test/deposit-sumsub-scenarios.e2e-spec.ts` — 重写 + 库隔离

---

## Task 1: 报文生成器（纯函数，TDD）

**Files:**
- Create: `src/modules/deposit-sumsub/fixtures/txn-report.builder.ts`
- Test: `src/modules/deposit-sumsub/fixtures/txn-report.builder.spec.ts`

**Interfaces:**
- Produces: `buildTxnReport(ctx: TxnReportContext, verdict: TxnReportVerdict): Record<string, unknown>`，以及导出类型 `TxnReportContext` / `TxnReportVerdict` / `MatchedRule` / `ApplicantAction` / `TypedTag`。Task 4 用它生成每个按钮的报文。

- [ ] **Step 1: 写失败测试**

```ts
// src/modules/deposit-sumsub/fixtures/txn-report.builder.spec.ts
import { buildTxnReport, TxnReportContext, TxnReportVerdict } from './txn-report.builder';

const baseCtx: TxnReportContext = {
  txnId: '66fbab2a916881505f61fd11',
  txnType: 'finance',
  applicantId: '6b1c47f0a2d38e5904bb7215',
  externalUserId: 'CU2601019430',
  clientTxnId: 'DEP2607314153',
  amount: 3000,
  currency: 'USDT',
  isCrypto: true,
  createdAtIso: '2026-07-31T09:39:41.000Z',
};

const approvedVerdict: TxnReportVerdict = {
  reviewStatus: 'completed',
  reviewAnswer: 'GREEN',
  action: 'score',
  score: 5,
  moderationComment: 'Transaction cleared — no risk indicators detected.',
};

describe('buildTxnReport', () => {
  it('产出官方顶层字段,且不含真实 Sumsub 没有的顶层 verdict', () => {
    const r = buildTxnReport(baseCtx, approvedVerdict) as any;
    expect(r.id).toBe('66fbab2a916881505f61fd11');
    expect(r.applicantId).toBe('6b1c47f0a2d38e5904bb7215');
    expect(r.externalUserId).toBe('CU2601019430');
    expect(r.score).toBe(5);
    expect(r.createdAt).toBe('2026-07-31T09:39:41.000Z');
    expect(r.verdict).toBeUndefined();
  });

  it('review.reviewStatus 落官方合法值,reviewResult 嵌在 review 下', () => {
    const r = buildTxnReport(baseCtx, approvedVerdict) as any;
    expect(r.review.reviewStatus).toBe('completed');
    expect(r.review.reviewResult.reviewAnswer).toBe('GREEN');
    expect(r.review.reviewResult.moderationComment).toContain('cleared');
  });

  it('scoringResult.action 是 verdict 的生产来源', () => {
    const r = buildTxnReport(baseCtx, { ...approvedVerdict, action: 'reject' }) as any;
    expect(r.scoringResult.action).toBe('reject');
    expect(r.scoringResult.matchedRules).toEqual([]);
    expect(r.scoringResult.applicantActions).toEqual([]);
    expect(r.scoringResult.failedRules).toEqual([]);
  });

  it('data.type 跟随 ctx.txnType', () => {
    expect((buildTxnReport(baseCtx, approvedVerdict) as any).data.type).toBe('finance');
    expect(
      (buildTxnReport({ ...baseCtx, txnType: 'travelRule' }, approvedVerdict) as any).data.type,
    ).toBe('travelRule');
  });

  it('travelRuleInfo 只在 travelRule 单出现', () => {
    expect((buildTxnReport(baseCtx, approvedVerdict) as any).travelRuleInfo).toBeUndefined();
    const tr = buildTxnReport({ ...baseCtx, txnType: 'travelRule' }, approvedVerdict) as any;
    expect(tr.travelRuleInfo.protocolName).toBe('trp');
    expect(tr.travelRuleInfo.status).toBe('completed');
    expect(tr.travelRuleInfo.counterpartyVaspId).toBeDefined();
  });

  it('cryptoTxnInfo 只在虚拟币单出现', () => {
    expect((buildTxnReport(baseCtx, approvedVerdict) as any).cryptoTxnInfo).toBeDefined();
    const fiat = buildTxnReport(
      { ...baseCtx, isCrypto: false, currency: 'AED' },
      approvedVerdict,
    ) as any;
    expect(fiat.cryptoTxnInfo).toBeUndefined();
  });

  it('typedTags / matchedRules / applicantActions 原样透传', () => {
    const r = buildTxnReport(baseCtx, {
      ...approvedVerdict,
      reviewAnswer: 'RED',
      action: 'reject',
      score: 98,
      typedTags: [{ label: 'SANCTION', type: 'userDefined' }],
      matchedRules: [
        { id: 'AML1', name: 'Sanctions match', revision: 3, title: 'Sanctions', score: 98, dryRun: false, action: 'reject' },
      ],
      applicantActions: [{ applicantActionId: 'act-1', externalActionId: 'ext-1' }],
    }) as any;
    expect(r.typedTags).toEqual([{ label: 'SANCTION', type: 'userDefined' }]);
    expect(r.scoringResult.matchedRules[0].name).toBe('Sanctions match');
    expect(r.scoringResult.applicantActions[0].applicantActionId).toBe('act-1');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/deposit-sumsub/fixtures/txn-report.builder.spec.ts`
Expected: FAIL — `Cannot find module './txn-report.builder'`

- [ ] **Step 3: 写实现**

```ts
// src/modules/deposit-sumsub/fixtures/txn-report.builder.ts

/**
 * 按 Sumsub 官方 getTxn 报文 schema 生成仿真报文（2026-07-31 查证
 * docs.sumsub.com/reference/get-transaction）。
 *
 * 为什么不再手拼字面量:旧 `buildRawDetail()` 塞了一个真实 Sumsub **不存在**的顶层
 * `verdict` 字段,又缺 `data.type`/`review.reviewStatus`/`scoringResult.action` —— 导致
 * ① 详情页 "Review Status" 行恒空;② `parseDetail` 的生产回退分支(读 scoringResult.action)
 * 在演示里一次都跑不到;③ 报文里看不出这笔是 finance 还是 travelRule。
 */

export interface MatchedRule {
  id: string;
  name: string;
  revision: number;
  title: string;
  score: number;
  dryRun: boolean;
  action: string;
}

export interface ApplicantAction {
  applicantActionId: string;
  externalActionId: string;
}

export interface TypedTag {
  label: string;
  type: 'system' | 'userDefined';
}

export interface TxnReportContext {
  /** 现铸的 24-hex Sumsub txnId */
  txnId: string;
  /** 决定 data.type 与 travelRuleInfo 是否出现 */
  txnType: 'finance' | 'travelRule';
  applicantId: string;
  /** 我方 customerNo */
  externalUserId: string;
  /** 我方 depositNo（提交时的 clientTxnId） */
  clientTxnId: string;
  amount: number;
  currency: string;
  /** 决定 cryptoTxnInfo 是否出现 */
  isCrypto: boolean;
  createdAtIso: string;
}

export interface TxnReportVerdict {
  reviewStatus: 'completed' | 'onHold' | 'awaitingUser';
  reviewAnswer: 'GREEN' | 'RED' | null;
  /** 官方 scoringResult.action —— parseDetail 在生产环境读的就是它 */
  action: 'score' | 'onHold' | 'awaitUser' | 'reject';
  score: number;
  moderationComment: string;
  matchedRules?: MatchedRule[];
  applicantActions?: ApplicantAction[];
  typedTags?: TypedTag[];
}

export function buildTxnReport(
  ctx: TxnReportContext,
  verdict: TxnReportVerdict,
): Record<string, unknown> {
  const report: Record<string, unknown> = {
    id: ctx.txnId,
    applicantId: ctx.applicantId,
    externalUserId: ctx.externalUserId,
    clientId: 'fiatx',
    createdAt: ctx.createdAtIso,
    score: verdict.score,
    data: {
      txnId: ctx.clientTxnId,
      txnDate: ctx.createdAtIso,
      type: ctx.txnType,
      info: {
        amount: ctx.amount,
        currencyCode: ctx.currency,
        currencyType: ctx.isCrypto ? 'crypto' : 'fiat',
        direction: 'in',
      },
    },
    review: {
      reviewId: `rev-${ctx.txnId.slice(0, 12)}`,
      reviewStatus: verdict.reviewStatus,
      reviewResult: {
        reviewAnswer: verdict.reviewAnswer,
        moderationComment: verdict.moderationComment,
      },
    },
    scoringResult: {
      score: verdict.score,
      action: verdict.action,
      matchedRules: verdict.matchedRules ?? [],
      applicantActions: verdict.applicantActions ?? [],
      failedRules: [],
    },
    typedTags: verdict.typedTags ?? [],
  };

  // 官方:cryptoTxnInfo 承载链上筛查商的应答,仅虚拟币交易才有。
  if (ctx.isCrypto) {
    report.cryptoTxnInfo = {
      crystalMonitorData: {
        answer: verdict.reviewAnswer === 'RED' ? 'RED' : 'GREEN',
        riskScore: verdict.score,
      },
    };
  }

  // 官方:travelRuleInfo 只在 data.type === 'travelRule' 时出现。
  if (ctx.txnType === 'travelRule') {
    report.travelRuleInfo = {
      protocolName: 'trp',
      status: 'completed',
      applicantVaspId: 'vasp-fiatx-ae',
      counterpartyVaspId: 'vasp-counterparty-01',
      expiredAt: null,
      needApplicantOwnershipConfirmation: false,
    };
  }

  return report;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/deposit-sumsub/fixtures/txn-report.builder.spec.ts`
Expected: PASS，8 个用例全绿

- [ ] **Step 5: tsc + commit**

```bash
npx tsc --noEmit
git add src/modules/deposit-sumsub/fixtures/txn-report.builder.ts src/modules/deposit-sumsub/fixtures/txn-report.builder.spec.ts
git commit -m "feat(deposit-sumsub): 按 Sumsub 官方 getTxn schema 生成仿真报文,按 txnType 分型"
```

---

## Task 2: 修 onHold webhook 类型名（三层，TDD）

**Files:**
- Create: `src/modules/deposit-sumsub/kyt-webhook-types.ts`
- Modify: `src/modules/deposit-sumsub/deposit-webhook.router.ts`
- Modify: `src/modules/deposit-sumsub/deposit-webhook.router.spec.ts`
- Modify: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts:8-14`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:123-127`

**Interfaces:**
- Produces: `export const KYT_VERDICT_TYPES: ReadonlySet<string>` 与 `export const KYT_ONHOLD_TYPE = 'applicantKytOnHold'`。ingestion / router / handler 三处共用同一份。

**背景（务必读）：** Sumsub 官方 on-hold 事件的 type 是 `applicantKytOnHold`（**无 `Txn`**，官方文档自己注明与其他 KYT 事件命名不一致）。我方五处一致写成 `applicantKytTxnOnHold`。最外层 `sumsum-ingestion.service.ts:124` 是 `startsWith('applicantKytTxn')` 前缀匹配，真实事件连 router 都进不去。**不可**简单改成 `startsWith('applicantKyt')` —— 那会把 `applicantKytAml*` 等其它 KYT 族事件误吞进 deposit 路由。

- [ ] **Step 1: 写失败测试（router 层）**

在 `src/modules/deposit-sumsub/deposit-webhook.router.spec.ts` 末尾追加：

```ts
  it('官方 on-hold 类型 applicantKytOnHold（无 Txn）必须被路由', async () => {
    await router.route({ type: 'applicantKytOnHold', kytTxnId: 'T-onhold' });
    expect(kytVerdictHandler.handle).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'applicantKytOnHold' }),
    );
  });

  it('拼错的 applicantKytTxnOnHold 不再被识别（防回退）', async () => {
    await router.route({ type: 'applicantKytTxnOnHold', kytTxnId: 'T-typo' });
    expect(kytVerdictHandler.handle).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/deposit-sumsub/deposit-webhook.router.spec.ts`
Expected: FAIL — 第一条断言不通过（`applicantKytOnHold` 未被路由）

- [ ] **Step 3: 建常量单一真相源**

```ts
// src/modules/deposit-sumsub/kyt-webhook-types.ts

/**
 * KYT 交易 webhook 类型的单一真相源，ingestion 前置分流 / router / handler 共用。
 *
 * ⚠️ `applicantKytOnHold` **没有 `Txn`** —— 这是 Sumsub 官方的命名不一致（其文档自己
 * 注明了）。此前我方五处一致写成 `applicantKytTxnOnHold`，且 ingestion 用
 * `startsWith('applicantKytTxn')` 前缀匹配，导致真实 on-hold 事件在最外层就被丢弃、
 * 挂起复核整条路失效；因为 fixture 也一样错，演示与单测全绿、掩盖了缺陷。
 *
 * 前缀匹配已改为显式集合匹配：`applicantKyt` 前缀下还有 AML 等其它族事件，
 * 放宽前缀会把它们误吞进 deposit 路由。
 */
export const KYT_ONHOLD_TYPE = 'applicantKytOnHold';

export const KYT_VERDICT_TYPES: ReadonlySet<string> = new Set([
  'applicantKytTxnApproved',
  'applicantKytTxnRejected',
  'applicantKytTxnAwaitingUser',
  KYT_ONHOLD_TYPE,
  'applicantKytTxnReviewed',
  'applicantKytTxnCreated',
]);
```

- [ ] **Step 4: router 引用常量**

`deposit-webhook.router.ts` 删掉本地 `KYT_VERDICT_TYPES` 定义，改为：

```ts
import { KYT_VERDICT_TYPES } from './kyt-webhook-types';
```

- [ ] **Step 5: handler 改映射**

`deposit-kyt-verdict.handler.ts:8-14` 改为：

```ts
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';

// payload.type → 归一 verdict;'ignore' = Reviewed/Created,不推进状态机。
const VERDICT_BY_TYPE: Record<string, KytVerdict | 'ignore'> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
  applicantKytTxnReviewed: 'ignore',
  applicantKytTxnCreated: 'ignore',
};
```

- [ ] **Step 6: ingestion 前缀改集合**

`sumsub-ingestion.service.ts:123-127` 改为：

```ts
      const depositWebhookType = String(payload.type ?? '');
      // 显式集合匹配,不用 startsWith:官方 on-hold 事件是 `applicantKytOnHold`(无 Txn),
      // 旧的 `startsWith('applicantKytTxn')` 会把它漏在门外;而放宽成 `applicantKyt`
      // 又会误吞 AML 等同前缀的其它族事件。见 kyt-webhook-types.ts。
      if (KYT_VERDICT_TYPES.has(depositWebhookType)) {
```

文件顶部加：

```ts
import { KYT_VERDICT_TYPES } from '../deposit-sumsub/kyt-webhook-types';
```

- [ ] **Step 7: 跑测试确认通过**

Run: `npx jest src/modules/deposit-sumsub src/modules/sumsub-ingestion`
Expected: PASS，无回归

- [ ] **Step 8: tsc + commit**

```bash
npx tsc --noEmit
git add src/modules/deposit-sumsub/kyt-webhook-types.ts src/modules/deposit-sumsub/deposit-webhook.router.ts src/modules/deposit-sumsub/deposit-webhook.router.spec.ts src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
git commit -m "fix(deposit-sumsub): onHold webhook 官方类型名是 applicantKytOnHold(无 Txn),三层修正 + 前缀匹配改集合"
```

---

## Task 3: onHold 也拉报文存证（TDD）

**Files:**
- Modify: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts:17`
- Test: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `KYT_ONHOLD_TYPE`

**背景：** 实测 onHold 单落库 `score=(空) detail=(无报文)`，officer 看到"挂起"却零证据。onHold 的语义是"规则已算完分、判定需人工复核"，分数与命中规则正是决策依据；官方 `scoringResult.action` 合法值本就含 `onHold`。

- [ ] **Step 1: 写失败测试**

在 `deposit-kyt-verdict.handler.spec.ts` 追加：

```ts
  it('onHold 也拉 getTxn 存证(分数+报文),但不读处置 tag', async () => {
    depositService.findBySumsubTxnId.mockResolvedValue({ id: 'dep-1' });
    sumsubTxnClient.getTxn.mockResolvedValue({
      txnId: 'T-oh',
      verdict: 'onHold',
      reviewAnswer: null,
      riskScore: 55,
      typedTags: [{ label: 'FROZEN_BY_MLRO', type: 'userDefined' }],
      raw: { id: 'T-oh' },
    });

    await handler.handle({ type: 'applicantKytOnHold', kytTxnId: 'T-oh' });

    expect(sumsubTxnClient.getTxn).toHaveBeenCalledWith('T-oh');
    expect(workflow.applyKytVerdict).toHaveBeenCalledWith('dep-1', {
      verdict: 'onHold',
      riskScore: 55,
      detailRaw: { id: 'T-oh' },
    });
    // onHold 不读处置 tag —— 上面 fixture 故意塞了 FROZEN_BY_MLRO,不应被解析出来
    expect(workflow.applyKytVerdict).not.toHaveBeenCalledWith(
      'dep-1',
      expect.objectContaining({ dispoTag: 'FROZEN_BY_MLRO' }),
    );
  });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts -t "onHold 也拉"`
Expected: FAIL — `sumsubTxnClient.getTxn` 未被调用

- [ ] **Step 3: 改实现**

`deposit-kyt-verdict.handler.ts:16-19` 改为：

```ts
// approved / onHold 也拉:证据对齐(score + 报文),但都不读处置 tag。
// onHold 语义是「规则已算完分、判定需人工复核」,分数与命中规则正是 officer 的决策依据;
// 此前 onHold 不拉,导致挂起单在详情页零证据(2026-07-31 实测 score/报文双空)。
const DETAIL_LOOKUP_VERDICTS = new Set<KytVerdict>(['approved', 'rejected', 'awaitUser', 'onHold']);
// 标签不在 webhook 里,只在 rejected/awaitUser 时才读 typedTags。
const TAG_LOOKUP_VERDICTS = new Set<KytVerdict>(['rejected', 'awaitUser']);
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/deposit-sumsub`
Expected: PASS

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts
git commit -m "fix(deposit-sumsub): onHold 也拉 getTxn 存证,挂起单不再零证据"
```

---

## Task 4: 9 个裁决按钮 + demo service 改单步投递

**Files:**
- Create: `src/modules/deposit-sumsub/fixtures/verdict-buttons.ts`
- Create: `src/modules/deposit-sumsub/fixtures/verdict-buttons.spec.ts`
- Delete: `src/modules/deposit-sumsub/fixtures/scenarios.ts`
- Modify: `src/modules/deposit-sumsub/demo-scenario.service.ts`
- Modify: `src/modules/deposit-sumsub/admin-deposit-demo.controller.ts`

**Interfaces:**
- Consumes: Task 1 的 `buildTxnReport` / `TxnReportVerdict`；Task 2 的 `KYT_ONHOLD_TYPE`
- Produces: `DEPOSIT_VERDICT_BUTTONS: Record<string, DepositVerdictButton>`；`DepositDemoScenarioService.runVerdict(depositId, buttonKey, actor)`

> ⚠️ **Task 1 之后的修正（必读，优先于下方代码字面量）**：`moderationComment` **已从
> `TxnReportVerdict` 删除** —— 两次独立核对官方文档确认，交易的 `review.reviewResult`
> 只有 `reviewAnswer` 和 `reviewRejectType` 两个字段，`moderationComment` 属 applicant
> 审核 schema，不在交易报文里。
>
> 因此下方按钮定义里每处 `moderationComment: '...'` 都要这样落地：
> 1. **删掉** `moderationComment` 这一行；
> 2. 那句人类可读的叙述改放进 `matchedRules[].title`（官方真字段，raw payload 里可见度与
>    原先等同）—— 把 `RULE()` 辅助函数改成 `RULE(id, name, score, action, title)`，
>    `title` 传原 `moderationComment` 的句子，`name` 保持短规则名不变；
> 3. ① Approved 与 ⑧ On hold 这类无叙述可挂的，直接不传即可（真实 Sumsub 的干净交易
>    本来就没有散文解释，这更贴近实际）。
> 4. rejected 类按钮可顺带传 `reviewRejectType: 'FINAL'`（官方字段，Task 1 已支持）。

- [ ] **Step 1: 写按钮定义表**

```ts
// src/modules/deposit-sumsub/fixtures/verdict-buttons.ts
import { KYT_ONHOLD_TYPE } from '../kyt-webhook-types';
import { TxnReportVerdict } from './txn-report.builder';

/**
 * 9 个**单步**裁决按钮,取代此前的 8 个多步场景剧本。
 *
 * 语义:一个按钮 = 投递一次 Sumsub webhook + 一份配套报文,状态流转完全交给现有
 * DepositKytVerdictHandler / DepositWorkflowService。operator 自由串联,贴近真实
 * (真实世界就是一次次 webhook 进来):
 *   ② → ①  补料后通过
 *   ⑦ → ⑤  人工复核后 MLRO 冻结
 *   ⑧ → ⑨  挂起后超时转人工
 *
 * 报文由 buildTxnReport() 按该 deposit 实际的 sumsubTxnType 现生成,不写死。
 */
export interface DepositVerdictButton {
  key: string;
  label: string;
  webhookType: string;
  verdict: TxnReportVerdict;
}

const RULE = (id: string, name: string, score: number, action: string) => ({
  id, name, revision: 1, title: name, score, dryRun: false, action,
});

const TAG = (label: string) => ({ label, type: 'userDefined' as const });

export const DEPOSIT_VERDICT_BUTTONS: Record<string, DepositVerdictButton> = {
  V1_APPROVED: {
    key: 'V1_APPROVED',
    label: '① Approved',
    webhookType: 'applicantKytTxnApproved',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'GREEN',
      action: 'score',
      score: 5,
      moderationComment: 'Transaction cleared — no risk indicators detected.',
    },
  },

  V2_AWAIT_USER: {
    key: 'V2_AWAIT_USER',
    label: '② Awaiting user',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: {
      reviewStatus: 'awaitingUser',
      reviewAnswer: null,
      action: 'awaitUser',
      score: 40,
      moderationComment: 'Additional information required from the applicant.',
      matchedRules: [RULE('KYC7', 'Source of funds unclear', 40, 'awaitUser')],
      applicantActions: [
        { applicantActionId: 'aa-sof-0001', externalActionId: 'EXT-SOF-0001' },
      ],
    },
  },

  V3_AWAIT_USER_PEP: {
    key: 'V3_AWAIT_USER_PEP',
    label: '③ Awaiting user · PEP',
    webhookType: 'applicantKytTxnAwaitingUser',
    verdict: {
      reviewStatus: 'awaitingUser',
      reviewAnswer: null,
      action: 'awaitUser',
      score: 62,
      moderationComment: 'Politically exposed person — enhanced due diligence documents required.',
      matchedRules: [RULE('AML4', 'PEP match', 62, 'awaitUser')],
      applicantActions: [
        { applicantActionId: 'aa-edd-0002', externalActionId: 'EXT-EDD-0002' },
      ],
      typedTags: [TAG('PEP')],
    },
  },

  V4_REJECTED_SANCTION: {
    key: 'V4_REJECTED_SANCTION',
    label: '④ Rejected · Sanctions',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 98,
      moderationComment: 'Counterparty address matches an OFAC SDN sanctions list entry.',
      matchedRules: [RULE('AML1', 'Sanctions match', 98, 'reject')],
      typedTags: [TAG('SANCTION')],
    },
  },

  V5_REJECTED_FROZEN_MLRO: {
    key: 'V5_REJECTED_FROZEN_MLRO',
    label: '⑤ Rejected · MLRO freeze',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 84,
      moderationComment: 'MLRO disposition: freeze pending investigation.',
      matchedRules: [RULE('AML9', 'High-risk transaction pattern', 84, 'reject')],
      typedTags: [TAG('FROZEN_BY_MLRO')],
    },
  },

  V6_REJECTED_RETURN: {
    key: 'V6_REJECTED_RETURN',
    label: '⑥ Rejected · MLRO return',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 79,
      moderationComment: 'MLRO disposition: return funds to the originating account.',
      matchedRules: [RULE('AML9', 'High-risk transaction pattern', 79, 'reject')],
      typedTags: [TAG('RETURN_TO_SENDER')],
    },
  },

  V7_REJECTED_NO_TAG: {
    key: 'V7_REJECTED_NO_TAG',
    label: '⑦ Rejected · no disposition tag',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 71,
      moderationComment: 'Risk threshold exceeded — awaiting officer disposition.',
      matchedRules: [RULE('AML9', 'High-risk transaction pattern', 71, 'reject')],
    },
  },

  V8_ONHOLD: {
    key: 'V8_ONHOLD',
    label: '⑧ On hold',
    webhookType: KYT_ONHOLD_TYPE,
    verdict: {
      reviewStatus: 'onHold',
      reviewAnswer: null,
      action: 'onHold',
      score: 55,
      moderationComment: 'Queued for manual officer review.',
      matchedRules: [RULE('AML12', 'Manual review threshold', 55, 'onHold')],
    },
  },

  V9_REJECTED_SLA: {
    key: 'V9_REJECTED_SLA',
    label: '⑨ Rejected · SLA breach',
    webhookType: 'applicantKytTxnRejected',
    verdict: {
      reviewStatus: 'completed',
      reviewAnswer: 'RED',
      action: 'reject',
      score: 55,
      moderationComment: 'Review SLA elapsed without officer disposition.',
      matchedRules: [RULE('AML12', 'Manual review threshold', 55, 'reject')],
      typedTags: [TAG('SLA_BREACH')],
    },
  },
};
```

- [ ] **Step 2: 写按钮表的守卫测试**

```ts
// src/modules/deposit-sumsub/fixtures/verdict-buttons.spec.ts
import { DEPOSIT_VERDICT_BUTTONS } from './verdict-buttons';
import { KYT_VERDICT_TYPES } from '../kyt-webhook-types';

describe('DEPOSIT_VERDICT_BUTTONS', () => {
  const buttons = Object.values(DEPOSIT_VERDICT_BUTTONS);

  it('共 9 个按钮,key 与 map 键一致', () => {
    expect(buttons).toHaveLength(9);
    for (const [k, b] of Object.entries(DEPOSIT_VERDICT_BUTTONS)) expect(b.key).toBe(k);
  });

  it('每个按钮的 webhookType 都在 ingestion 认识的集合里(防拼错静默丢弃)', () => {
    for (const b of buttons) expect(KYT_VERDICT_TYPES.has(b.webhookType)).toBe(true);
  });

  it('② ③ 必须带 applicantActions —— 否则详情页 Applicant Action IDs 永远空', () => {
    expect(DEPOSIT_VERDICT_BUTTONS.V2_AWAIT_USER.verdict.applicantActions?.length).toBeGreaterThan(0);
    expect(DEPOSIT_VERDICT_BUTTONS.V3_AWAIT_USER_PEP.verdict.applicantActions?.length).toBeGreaterThan(0);
  });

  it('处置 tag 逐个对上 handler 的词表', () => {
    const tagOf = (k: string) =>
      (DEPOSIT_VERDICT_BUTTONS[k].verdict.typedTags ?? []).map((t) => t.label);
    expect(tagOf('V4_REJECTED_SANCTION')).toEqual(['SANCTION']);
    expect(tagOf('V5_REJECTED_FROZEN_MLRO')).toEqual(['FROZEN_BY_MLRO']);
    expect(tagOf('V6_REJECTED_RETURN')).toEqual(['RETURN_TO_SENDER']);
    expect(tagOf('V7_REJECTED_NO_TAG')).toEqual([]);
    expect(tagOf('V3_AWAIT_USER_PEP')).toEqual(['PEP']);
  });
});
```

- [ ] **Step 3: 跑测试确认失败再通过**

Run: `npx jest src/modules/deposit-sumsub/fixtures/verdict-buttons.spec.ts`
Expected: 先 FAIL（模块不存在）→ 建好文件后 PASS

- [ ] **Step 4: demo service 改单步投递**

把 `demo-scenario.service.ts` 的 `runScenario()` 整体替换为 `runVerdict()`。保留 `mintTxnId()` 不动（槽位铸号逻辑仍需要，用于该单尚未提交时预置 submit 结果）。

```ts
  /**
   * 投递一次裁决:按 deposit 当前的 sumsubTxnType 生成官方形状报文 → prime mock 的
   * getTxn 应答 → 把 webhook 喂进真实 ingestion 链路。
   *
   * 与旧 runScenario 的区别:不再有"剧本/预期终态"概念。状态去哪由 handler 决定,
   * 这里只如实回报投递前后的状态,不做 matchedExpectation 判定。
   */
  async runVerdict(depositId: string, buttonKey: string, actor: DemoScenarioActor) {
    const button = DEPOSIT_VERDICT_BUTTONS[buttonKey];
    if (!button) {
      throw new BadRequestException(
        `Unknown verdict "${buttonKey}". Valid keys: ${Object.keys(DEPOSIT_VERDICT_BUTTONS).join(', ')}`,
      );
    }
    if (!(this.sumsubTxnClient instanceof MockSumsubTxnClient)) {
      throw new BadRequestException(
        'Demo verdict runner requires SUMSUB_MOCK_MODE=true (SUMSUB_TXN_CLIENT is not the mock client)',
      );
    }
    const mockClient = this.sumsubTxnClient;

    const deposit = await this.depositService.findOne(depositId);
    const statusBefore = deposit.status;

    // 该单已过 Gate 0 → 用它自己的真号;还没过 → 现铸一个并 prime,等 Gate 0 取用。
    const txnId = deposit.sumsubTxnId ?? this.mintTxnId(deposit, button.key);
    if (!deposit.sumsubTxnId) mockClient.primeSubmit(deposit.depositNo, txnId);

    const txnType = (deposit.sumsubTxnType as 'finance' | 'travelRule') ?? 'finance';
    const isCrypto = deposit.asset?.type === 'CRYPTO';

    const raw = buildTxnReport(
      {
        txnId,
        txnType,
        applicantId: deposit.customer?.sumsubApplicantId ?? '',
        externalUserId: deposit.customer?.customerNo ?? deposit.ownerId,
        clientTxnId: deposit.depositNo,
        amount: Number(deposit.amount),
        currency: deposit.asset?.currency ?? '',
        isCrypto,
        createdAtIso: new Date(deposit.createdAt).toISOString(),
      },
      button.verdict,
    );

    mockClient.primeTxn(txnId, {
      txnId,
      verdict: VERDICT_OF[button.webhookType],
      reviewAnswer: button.verdict.reviewAnswer,
      riskScore: button.verdict.score,
      typedTags: button.verdict.typedTags ?? [],
      raw,
    });

    await this.ingestionService.ingest(
      this.buildWebhookPayload(deposit, button, txnId, txnType),
      { isSimulated: true },
    );

    const refreshed = await this.depositService.findOne(deposit.id);

    await this.auditLogsService.recordByActor(
      {
        action: AuditActions.DEPOSIT_DEMO_SCENARIO_RUN,
        entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
        entityId: deposit.id,
        entityNo: deposit.depositNo,
        entityOwnerType: deposit.ownerType,
        entityOwnerId: deposit.ownerId,
        traceId: deposit.traceId || undefined,
        workflowType: 'DEPOSIT',
        result: AuditResult.SUCCESS,
        reason: `Demo verdict ${button.key} fed into deposit ${deposit.depositNo}`,
        metadata: {
          verdict: button.key,
          webhookType: button.webhookType,
          txnType,
          statusBefore,
          statusAfter: refreshed.status,
        },
        requestId: `DEPOSIT_DEMO_VERDICT_${deposit.depositNo}_${randomUUID()}`,
        sourcePlatform: 'ADMIN_API',
      },
      {
        actorType: 'ADMIN',
        actorId: actor.actorId,
        actorNo: actor.actorNo,
        actorRole: actor.actorRole || 'ADMIN',
      },
    );

    return {
      verdict: button.key,
      label: button.label,
      depositId: deposit.id,
      depositNo: deposit.depositNo,
      txnType,
      statusBefore,
      statusAfter: refreshed.status,
    };
  }
```

同文件顶部补映射常量与 import：

```ts
import { DEPOSIT_VERDICT_BUTTONS, DepositVerdictButton } from './fixtures/verdict-buttons';
import { buildTxnReport } from './fixtures/txn-report.builder';
import { KYT_ONHOLD_TYPE } from './kyt-webhook-types';
import { KytVerdict } from './sumsub-txn.types';

/** webhookType → 归一 verdict,与 DepositKytVerdictHandler 的 VERDICT_BY_TYPE 同源同值 */
const VERDICT_OF: Record<string, KytVerdict> = {
  applicantKytTxnApproved: 'approved',
  applicantKytTxnRejected: 'rejected',
  applicantKytTxnAwaitingUser: 'awaitUser',
  [KYT_ONHOLD_TYPE]: 'onHold',
};
```

`buildWebhookPayload` 改为按官方 webhook 形状补齐字段：

```ts
  /**
   * 按官方 Transaction Monitoring webhook 形状生成 payload
   * (2026-07-31 查证 docs.sumsub.com/reference/transaction-monitoring-webhooks)。
   * handler 只读 type + kytTxnId,其余字段供 sumsub_webhook_events 落库回看,
   * 并让演示报文与真实报文形状一致。
   */
  private buildWebhookPayload(
    deposit: any,
    button: DepositVerdictButton,
    kytTxnId: string,
    txnType: 'finance' | 'travelRule',
  ): Record<string, unknown> {
    return {
      type: button.webhookType,
      kytTxnId,
      kytDataTxnId: deposit.depositNo,
      kytTxnType: txnType,
      applicantId: deposit.customer?.sumsubApplicantId ?? '',
      applicantType: 'individual',
      externalUserId: deposit.customer?.customerNo ?? deposit.ownerId,
      clientId: 'fiatx',
      correlationId: `req-${randomUUID()}`,
      reviewStatus: button.verdict.reviewStatus,
      reviewResult: {
        reviewAnswer: button.verdict.reviewAnswer,
        moderationComment: button.verdict.moderationComment,
      },
      sandboxMode: true,
      createdAtMs: new Date().toISOString(),
    };
  }
```

删除 `runScenario()`、`DEPOSIT_SCENARIOS` import、`slaService` 注入（`needsSlaTimer` 随剧本一并退役；SLA 演示改由 ⑨ 按钮承担，见 spec §2.5）。

- [ ] **Step 5: controller 改端点**

```ts
  @Post('run-verdict')
  @ApiOperation({ summary: 'Feed one Sumsub KYT verdict webhook into this deposit (demo only)' })
  async runVerdict(
    @Body() body: { depositId?: string; verdict?: string },
    @Req() req: any,
  ) {
    if (!body?.depositId) throw new BadRequestException('depositId is required');
    if (!body?.verdict) throw new BadRequestException('verdict is required');

    const actor = {
      actorId: req.user?.userId,
      actorNo: req.user?.userNo,
      actorRole: req.user?.role,
    };
    return this.demoScenarioService.runVerdict(body.depositId, body.verdict, actor);
  }
```

**RBAC 登记**（见 memory `admin-endpoint-rbac-registration`）：新路由须在 `rbac.catalog.ts` 用 `route()` 登记 → 跑 `db:base:sync` → **重启后端**，否则 SUPER_ADMIN 也 403。

- [ ] **Step 6: 删旧 fixture 并跑全模块测试**

```bash
git rm src/modules/deposit-sumsub/fixtures/scenarios.ts
npx jest src/modules/deposit-sumsub
npx tsc --noEmit
```

Expected: `deposit-sumsub` 模块全绿，tsc 0 错

- [ ] **Step 7: commit**

```bash
git add -A src/modules/deposit-sumsub
git commit -m "feat(deposit-sumsub): 8 个场景剧本改 9 个单步裁决按钮,报文按 txnType 现生成"
```

---

## Task 5: `OPERATION_PENDING` 状态 + 转移边（TDD）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts:4-20, 76-93`
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:506-525`
- Test: `src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`

**Interfaces:**
- Produces: `DepositTransactionStatus.OPERATION_PENDING`、`DepositTransactionAction.OPERATION_PENDING`。Task 6/7/8 依赖。

- [ ] **Step 1: 写失败测试**

在 `deposit-transactions.service.spec.ts` 的状态机 describe 内追加：

```ts
    it('COMPLIANCE_PENDING → OPERATION_PENDING via operation_pending', async () => {
      await expectTransition(
        DepositTransactionStatus.COMPLIANCE_PENDING,
        DepositTransactionAction.OPERATION_PENDING,
        DepositTransactionStatus.OPERATION_PENDING,
      );
    });

    it('OPERATION_PENDING → SUCCESS via approve (放行)', async () => {
      await expectTransition(
        DepositTransactionStatus.OPERATION_PENDING,
        DepositTransactionAction.APPROVE,
        DepositTransactionStatus.SUCCESS,
      );
    });

    it('OPERATION_PENDING → CONFISCATING via confiscate_start (没收)', async () => {
      await expectTransition(
        DepositTransactionStatus.OPERATION_PENDING,
        DepositTransactionAction.CONFISCATE_START,
        DepositTransactionStatus.CONFISCATING,
      );
    });

    it('COMPLIANCE_PENDING 不再直接 confiscate_start —— 没收入口已上移到 OPERATION_PENDING', async () => {
      await expect(
        expectTransition(
          DepositTransactionStatus.COMPLIANCE_PENDING,
          DepositTransactionAction.CONFISCATE_START,
          DepositTransactionStatus.CONFISCATING,
        ),
      ).rejects.toThrow(/Invalid action/);
    });
```

> `expectTransition` 若文件内不存在，按同 describe 内既有用例（`deposit-transactions.service.spec.ts:397-425` 的 `COMPLIANCE_PENDING → ACTION_PENDING` 等）的写法照搬构造，不要新造抽象。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts -t "OPERATION_PENDING"`
Expected: FAIL — `Property 'OPERATION_PENDING' does not exist`

- [ ] **Step 3: 加枚举值**

`dto/deposit-transaction.dto.ts` 的 `DepositTransactionStatus` 内，`ACTION_PENDING` 之后插入：

```ts
  /** 合规已通过、但金额低于下限,等运营处置(放行/没收)。与 ACTION_PENDING(等客户补料)互不重叠。 */
  OPERATION_PENDING = 'OPERATION_PENDING',
```

`DepositTransactionAction` 内，`ACTION_PENDING` 之后插入：

```ts
  OPERATION_PENDING = 'operation_pending',
```

- [ ] **Step 4: 改转移表**

`deposit-transactions.service.ts` 的 `COMPLIANCE_PENDING` 块：**删除** `CONFISCATE_START` 那一项（连同其上方那段 C1 注释一并迁走），**新增** `OPERATION_PENDING`：

```ts
      [DepositTransactionStatus.COMPLIANCE_PENDING]: {
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.REJECT]: DepositTransactionStatus.REJECTED,
        [DepositTransactionAction.FREEZE]: DepositTransactionStatus.FROZEN,
        [DepositTransactionAction.ACTION_PENDING]:
          DepositTransactionStatus.ACTION_PENDING,
        // 合规通过后才判金额(口径 2026-07-31 反转:旧=先判金额后合规)。
        // 低于下限 → OPERATION_PENDING 等运营处置,没收入口随之上移。
        [DepositTransactionAction.OPERATION_PENDING]:
          DepositTransactionStatus.OPERATION_PENDING,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
        [DepositTransactionAction.MANUAL_CHECK]:
          DepositTransactionStatus.MANUAL_CHECKING,
      },
```

在 `ACTION_PENDING` 块之后新增：

```ts
      [DepositTransactionStatus.OPERATION_PENDING]: {
        // 放行:直接入账。没收:异步两阶段(C1)——OPERATION_PENDING → CONFISCATING
        //(资金在途、记账 pending 锁)→ ops 推资金单 → CONFISCATE_SETTLE 落 CONFISCATED。
        [DepositTransactionAction.APPROVE]: DepositTransactionStatus.SUCCESS,
        [DepositTransactionAction.CONFISCATE_START]:
          DepositTransactionStatus.CONFISCATING,
        [DepositTransactionAction.FAIL]: DepositTransactionStatus.FAILED,
      },
```

- [ ] **Step 5: 跑测试确认通过**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts`
Expected: PASS

- [ ] **Step 6: commit**

```bash
npx tsc --noEmit
git add src/modules/trading/deposit-transactions/dto/deposit-transaction.dto.ts src/modules/trading/deposit-transactions/deposit-transactions.service.ts src/modules/trading/deposit-transactions/deposit-transactions.service.spec.ts
git commit -m "feat(deposit): 新增 OPERATION_PENDING 状态,没收入口从 COMPLIANCE_PENDING 上移"
```

---

## Task 6: approved 主路径加金额闸（复现并修 Bug 2，TDD）

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:397-444`（`applyKytApproved`）
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:600-630`（`checkAutoApproval`）
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 5 的 `DepositTransactionStatus.OPERATION_PENDING` / `DepositTransactionAction.OPERATION_PENDING`

**背景（Bug 2 实测复现）：** 种子下限 100，建一笔 50 USDT，建单时正确落 `limitHoldReason=BELOW_MIN`，喂 approved webhook 后**直接 SUCCESS、钱记进客户账**，审计无 `DEPOSIT_HELD_BELOW_MIN`。根因：金额闸只写在 `checkAutoApproval()`（waive 后重评入口），webhook 主路径 `applyKytApproved()` 直通 `approveDeposit()`。

- [ ] **Step 1: 写失败测试（红灯即 Bug 复现）**

```ts
    it('BELOW_MIN 单收到 approved → 转 OPERATION_PENDING,不放行不记账（Bug 2 回归闸）', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-below-min',
        depositNo: 'DEP-BELOW-MIN-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        limitHoldReason: 'BELOW_MIN',
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
        traceId: 'tr-1',
      });
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);
      const approveSpy = jest.spyOn(service, 'approveDeposit');

      await (service as any).applyKytApproved(await depositService.findOne('dep-below-min'));

      expect(approveSpy).not.toHaveBeenCalled();
      expect(depositService.updateStatus).toHaveBeenCalledWith(
        'dep-below-min',
        expect.objectContaining({ action: DepositTransactionAction.OPERATION_PENDING }),
        expect.anything(),
      );
      expect(auditLogsService.recordSystem).toHaveBeenCalledWith(
        expect.objectContaining({ action: AuditActions.DEPOSIT_HELD_BELOW_MIN }),
      );
    });

    it('金额达标单收到 approved → 照常 approveDeposit', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'dep-ok',
        depositNo: 'DEP-OK-001',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
        limitHoldReason: null,
        ownerType: 'CUSTOMER',
        ownerId: 'cust-1',
      });
      withdrawalAddresses.hasActiveFiatWithdrawalAddress.mockResolvedValue(true);
      const approveSpy = jest.spyOn(service, 'approveDeposit').mockResolvedValue(undefined as any);

      await (service as any).applyKytApproved(await depositService.findOne('dep-ok'));

      expect(approveSpy).toHaveBeenCalledWith('dep-ok');
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "BELOW_MIN 单收到 approved"`
Expected: FAIL — `approveDeposit` 被调用了（这正是线上会发生的事）

- [ ] **Step 3: 抽出金额闸并在两处复用**

在 `DepositWorkflowService` 内新增私有方法：

```ts
  /**
   * 合规通过后的金额闸(2026-07-31 口径反转:旧=建单时判金额、合规只是后续;
   * 新=先走完合规,approved 之后才判金额)。
   *
   * 返回 true = 已被挂起(调用方须 return,不得放行)。
   *
   * 判定依据是建单时落的 `limitHoldReason`,**不在此处重查限额规则** —— 规则可能在
   * 单子生命周期内被改,用出生时的标记更稳定、可追溯。边界沿用 `amount < min`,
   * 即恰好等于下限放行。
   */
  private async holdBelowMinIfNeeded(deposit: any): Promise<boolean> {
    if (deposit.limitHoldReason !== 'BELOW_MIN') return false;

    await this.depositService.updateStatus(
      deposit.id,
      {
        action: DepositTransactionAction.OPERATION_PENDING,
        reason: 'Compliance approved; amount below configured minimum — awaiting ops disposition',
      },
      {
        actor: { actorType: 'SYSTEM', actorId: 'SYSTEM' },
        sourcePlatform: 'SYSTEM',
      },
    );

    await this.auditLogsService.recordSystem({
      action: AuditActions.DEPOSIT_HELD_BELOW_MIN,
      entityType: AuditEntityTypes.DEPOSIT_TRANSACTION,
      entityId: deposit.id,
      entityNo: deposit.depositNo,
      entityOwnerType: deposit.ownerType,
      entityOwnerId: deposit.ownerId,
      traceId: deposit.traceId || undefined,
      workflowType: 'DEPOSIT',
      reason: 'Deposit held: compliance approved but amount below configured minimum (BELOW_MIN)',
      metadata: { depositNo: deposit.depositNo, amount: String(deposit.amount) },
      sourcePlatform: 'SYSTEM',
    });

    this.logger.warn(
      `Below-min hold: deposit ${deposit.id} approved by compliance but below minimum — OPERATION_PENDING`,
    );
    return true;
  }
```

`applyKytApproved()` 末尾，`approveDeposit` 之前插入：

```ts
    if (await this.holdBelowMinIfNeeded(deposit)) return;
    await this.approveDeposit(deposit.id);
```

`checkAutoApproval()` 内原来那段 BELOW_MIN 早退（`:610-627`）**整段删除**，改在 `sumsubVerdict` 与 compliance 校验都通过之后、调 `approveDeposit` 之前插入同一行：

```ts
    if (await this.holdBelowMinIfNeeded(deposit)) return;
```

> 为什么要挪到后面：旧代码把金额闸放在 `sumsubVerdict` 判断**之前**，等于"合规还没过就先卡金额"——正是本次要反转的口径。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/trading/deposit-transactions`
Expected: PASS，含既有 129 条不回归

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "fix(deposit): approved 主路径补金额闸,BELOW_MIN 单转 OPERATION_PENDING 而非直接入账"
```

---

## Task 7: 三处处置入口条件改 `OPERATION_PENDING`

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` — `waiveLimitHold()`(~:820)、`initiateConfiscation()`(~:875)、`settleConfiscation()` 漂移守卫(~:1008)
- Test: `src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 5 的 `OPERATION_PENDING`

- [ ] **Step 1: 写失败测试**

```ts
    it('waiveLimitHold 只接受 OPERATION_PENDING,COMPLIANCE_PENDING 拒绝', async () => {
      depositService.findOne.mockResolvedValue({
        id: 'd1', limitHoldReason: 'BELOW_MIN',
        status: DepositTransactionStatus.COMPLIANCE_PENDING,
      });
      await expect(service.waiveLimitHold('d1', { actorId: 'a1' })).rejects.toThrow(
        /no BELOW_MIN hold to waive/,
      );

      depositService.findOne.mockResolvedValue({
        id: 'd1', depositNo: 'DEP-1', limitHoldReason: 'BELOW_MIN',
        status: DepositTransactionStatus.OPERATION_PENDING,
        ownerType: 'CUSTOMER', ownerId: 'c1',
      });
      await expect(service.waiveLimitHold('d1', { actorId: 'a1' })).resolves.toBeDefined();
    });
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t "waiveLimitHold 只接受"`
Expected: FAIL — 第一段本该 reject 却 resolve

- [ ] **Step 3: 三处逐个替换**

三处的判断都把

```ts
      deposit.status !== DepositTransactionStatus.COMPLIANCE_PENDING
```

改为

```ts
      deposit.status !== DepositTransactionStatus.OPERATION_PENDING
```

（`waiveLimitHold` / `initiateConfiscation` 的 `throw new BadRequestException(...)` 文案不变；`settleConfiscation` 的漂移守卫 warn 文案不变。）

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/trading/deposit-transactions`
Expected: PASS

- [ ] **Step 5: commit**

```bash
npx tsc --noEmit
git add src/modules/trading/deposit-transactions/deposit-workflow.service.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts
git commit -m "refactor(deposit): 没收/放行入口条件从 COMPLIANCE_PENDING 改 OPERATION_PENDING"
```

---

## Task 8: 前端 — 9 按钮 + `OPERATION_PENDING` 徽章 + 处置门控

**Files:**
- Modify: `admin-web/src/utils/depositStatusMap.ts`
- Modify: `admin-web/src/utils/depositStatusMap.spec.ts`
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx:39-48, 218-240, 391, 604-632, 637+`

- [ ] **Step 1: 状态映射加条目 + 测试**

`depositStatusMap.spec.ts` 追加：

```ts
  it('OPERATION_PENDING 归 NEEDS_OFFICER 组,有专属文案', () => {
    const meta = getDepositStatusMeta('OPERATION_PENDING');
    expect(meta.label).toBe('OPERATION PENDING');
    expect(meta.group).toBe('NEEDS_OFFICER');
    expect(meta.badgeClass).not.toBe(getDepositStatusMeta('UNKNOWN_XYZ').badgeClass);
  });
```

`depositStatusMap.ts` 的 map 内，`ACTION_PENDING` 条目之后加：

```ts
  OPERATION_PENDING: { label: 'OPERATION PENDING', group: 'NEEDS_OFFICER', badgeClass: AMBER },
```

Run（**在仓库根跑，不要 `cd admin-web`** —— admin-web 自己没有测试运行器，该 spec 由根 `jest.config.js` 收编）：

```bash
npx jest admin-web/src/utils/depositStatusMap.spec.ts
```
Expected: PASS

- [ ] **Step 2: 按钮清单换 9 个**

`DepositTransactionDetail.tsx:39-48` 整块替换：

```tsx
/* 9 个单步裁决按钮(取代旧的 8 个多步剧本)。key 必须与后端
   src/modules/deposit-sumsub/fixtures/verdict-buttons.ts 的 DEPOSIT_VERDICT_BUTTONS 一致。 */
const DEPOSIT_VERDICT_BUTTONS: Array<{ key: string; label: string }> = [
  { key: 'V1_APPROVED', label: '① Approved' },
  { key: 'V2_AWAIT_USER', label: '② Awaiting user' },
  { key: 'V3_AWAIT_USER_PEP', label: '③ Awaiting user · PEP' },
  { key: 'V4_REJECTED_SANCTION', label: '④ Rejected · Sanctions' },
  { key: 'V5_REJECTED_FROZEN_MLRO', label: '⑤ Rejected · MLRO freeze' },
  { key: 'V6_REJECTED_RETURN', label: '⑥ Rejected · MLRO return' },
  { key: 'V7_REJECTED_NO_TAG', label: '⑦ Rejected · no disposition tag' },
  { key: 'V8_ONHOLD', label: '⑧ On hold' },
  { key: 'V9_REJECTED_SLA', label: '⑨ Rejected · SLA breach' },
];
```

- [ ] **Step 3: 调用端点改 run-verdict**

`handleRunScenario` 改名 `handleRunVerdict`，URL 与 body 同改：

```tsx
      const response = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/deposit-sumsub/demo/run-verdict`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ depositId: id, verdict: key }),
        },
      );
```

- [ ] **Step 4: 面板文案改口径**

面板内两段说明替换为：

```tsx
              <p className="font-mono text-[11px] text-adm-t3">
                Feeds ONE Sumsub KYT verdict webhook into the real ingestion
                pipeline. The report is generated to match this deposit's actual
                Sumsub txn type. Requires SUMSUB_MOCK_MODE on the backend.
              </p>
              <p className="font-mono text-[11px] text-adm-amber">
                Verdicts are atomic — chain them freely (e.g. ② then ①, or ⑦ then ⑤).
              </p>
```

- [ ] **Step 5: 处置门控改状态**

`:391` 的 `isBelowMinPending` 判断里，把 `status === 'COMPLIANCE_PENDING'` 改为 `status === 'OPERATION_PENDING'`；侧栏 `SidebarGroup title="Below-Min Disposition"` 文案改为 `"Ops Disposition"`。

- [ ] **Step 6: 构建 + 渲染验证**

```bash
cd admin-web && npm run build
```

（`admin-web` 的 build 脚本本身就是 `tsc -b && vite build`，是 project-references 构建，**不要**另跑 `npx tsc --noEmit`——那会因缺 `-b` 报一堆无关错误。）

然后**真机渲染验证**（memory `feedback_verify_ui_by_rendering`：声称前端完成前必须截图）：起 self 栈 → 建一笔 50 USDT 的单 → 点 ① Approved → 详情页应显示 `OPERATION PENDING` 徽章 + 侧栏 Ops Disposition 两个按钮 → 截图留证。

- [ ] **Step 7: commit**

```bash
git add admin-web/src/utils/depositStatusMap.ts admin-web/src/utils/depositStatusMap.spec.ts admin-web/src/pages/DepositTransactionDetail.tsx
git commit -m "feat(admin-web): Simulation 改 9 个原子裁决按钮 + OPERATION_PENDING 徽章与处置门控"
```

---

## Task 9: e2e 重写 + 库隔离修复 + 文档同步

**Files:**
- Modify: `test/deposit-sumsub-scenarios.e2e-spec.ts` → 重命名 `test/deposit-sumsub-verdicts.e2e-spec.ts`
- Modify: `test/jest-e2e.json`
- Modify: `doc-final/reference/truth/v4-deposit.md`
- Modify: `doc-final/BACKLOG.md`

**背景（务必读）：** 该 e2e 当前 `beforeAll` 里 `prisma.depositTransaction.deleteMany({})` **无条件清空全表**，且 `test/jest-e2e.json` 不配独立 `DATABASE_URL` → 跑的就是 worktree 常驻栈的验收库；它还把 alice（唯一带 `sumsubApplicantId` 的种子客户）的 wallet 重建成 `walletRole=GENERAL`，导致客户端建单 403。2026-07-31 已实际踩中一次。**先修隔离，再写用例。**

- [ ] **Step 1: 给 e2e 配独立库**

`test/jest-e2e.json` 加 `globalSetup`，或在 spec 顶部（任何 Nest import 之前）写死独立库：

```ts
// 必须在任何会读 DATABASE_URL 的 import 之前执行。
// 该 suite 会 deleteMany 全表,跑在 worktree 常驻栈库上会清掉正在验收的数据
// (2026-07-31 实测踩中:清空全部 deposit + 把 alice 钱包降级成 GENERAL 打断建单)。
process.env.DATABASE_URL = 'file:/tmp/exchange_js_wt_deposit_arcs/e2e-verdicts.db';
```

配套：suite 启动前用 `prisma migrate deploy` + 业务种子把这个独立库初始化好（照搬 `scripts/db-setup.sh` 的调用方式，不新造脚本）。

- [ ] **Step 2: 加防护断言**

`beforeAll` 最前面：

```ts
    // 双保险:即使有人改坏了上面的 env 赋值,也不允许在栈库上跑 deleteMany。
    if (!process.env.DATABASE_URL?.includes('e2e-')) {
      throw new Error(
        `Refusing to run: this suite wipes deposit_transactions but DATABASE_URL is ${process.env.DATABASE_URL}. ` +
          `Point it at a dedicated e2e database.`,
      );
    }
```

- [ ] **Step 3: 按 9 按钮重写用例**

覆盖矩阵（每条 = 建单 → 过 Gate 0 → 投一个或多个裁决 → 断言状态 + 落库字段）：

| 用例 | 投递序列 | 断言 |
|---|---|---|
| 通过 | ① | `SUCCESS` |
| 小额挂起 | ① （50 USDT，min=100） | `OPERATION_PENDING` + `DEPOSIT_HELD_BELOW_MIN` 审计 + 未记账 |
| 小额放行 | ① → waive | `SUCCESS` + `limitHoldReason=null` |
| 小额没收 | ① → confiscate | `CONFISCATING` |
| 补料后通过 | ② → ① | `ACTION_PENDING` → `SUCCESS`；中途 `applicantActionIds` 非空 |
| PEP 补料 | ③ | `ACTION_PENDING` + 报文含 `PEP` tag |
| 制裁 | ④ | `FROZEN` + 零记账 |
| MLRO 冻结 | ⑦ → ⑤ | `MANUAL_CHECKING` → `FROZEN` |
| MLRO 退回 | ⑦ → ⑥ | 开 `DEPOSIT_RETURN` 审批，留 `MANUAL_CHECKING` |
| 挂起有证据 | ⑧ | 状态**不变**（仍 `COMPLIANCE_PENDING`）+ `sumsubScore=55` + 报文非空 |
| SLA | ⑧ → ⑨ | `MANUAL_CHECKING` + 报文含 `SLA_BREACH` tag |
| travelRule 分型 | VASP+3000 USDT 单投 ① | 报文 `data.type==='travelRule'` 且 `travelRuleInfo` 存在 |
| finance 分型 | 非 VASP 单投 ① | 报文 `data.type==='finance'` 且 `travelRuleInfo` 不存在 |
| 幂等 | ① ① | 只流转一次，第二次 no-op |

- [ ] **Step 4: 跑 e2e**

```bash
npm run test:e2e -- --testPathPatterns=deposit-sumsub-verdicts
```
Expected: 全绿；跑完后**核对栈库未被清空**：

```bash
sqlite3 /tmp/exchange_js_wt_deposit_arcs/dev.db "SELECT COUNT(*) FROM deposit_transactions;"
```
（跑前后计数应一致）

- [ ] **Step 5: 全量硬闸**

```bash
npx tsc --noEmit
npx jest
(cd admin-web && npm run build)
(cd client-web && npm run build)
```
Expected: tsc 0 错；jest 净新增失败 0（`asset-treasury/wallets` 4 条 pre-existing 不计，2026-07-31 基线为 1142 pass / 4 fail）；两个前端 build 0 错

- [ ] **Step 6: 文档同步**

`doc-final/reference/truth/v4-deposit.md`：
- 第 2 节状态机表加 `OPERATION_PENDING` 行与转移边
- 第 4.1 节 `applyKytApproved` 条补金额闸（口径反转说明）
- 第 4.5 节补：webhook 类型名修正、onHold 存证、9 按钮仿真模型、报文按型生成
- 第 10 节 admin 映射表加 `OPERATION_PENDING`

`doc-final/BACKLOG.md` 登记三条：
1. 按钮 ⑨ 与真实 SLA 定时器取证痕迹不一致（业主已知，"以后再说"）
2. 翻案/放行后原命中证据被覆写，无历史留档
3. 原 e2e 清库条目**标记已修**（本 Task 修掉了隔离）

- [ ] **Step 7: commit**

```bash
git add -A test doc-final
git commit -m "test(deposit): e2e 按 9 裁决按钮重写 + 独立测试库隔离；同步 truth 与 BACKLOG"
```
