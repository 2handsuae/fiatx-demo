# 充值单 · 单笔提交 + TR 类型判定 + Sumsub 字段对齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 一笔充值只向 Sumsub 报送一次,`type` 由 VARA 三条件判定器决定;数据模型对齐 Sumsub 官方命名;详情页 L2 显示 webhook 裁决原值、报文按官方字段回显;老 mock KYT 管道退役。

**Architecture:** 新增一个纯函数判定器决定 `finance`/`travelRule`;deposit 表由「双 txnId + 双状态列」塌成「单 txnId + type + verdict」;泳道概念整体删除;客户端模拟弹窗新增 VASP 录入项(crypto 专有)驱动判定。

**Tech Stack:** NestJS + Prisma(SQLite) + Jest;React + Vite(admin-web / client-web)。

## Global Constraints

- **放行由 webhook 裁决驱动,不由存储字段驱动。** `sumsubVerdict` 是展示投影,**不得**作为状态机决策依据(本轮纠正的错误范式)。
- **⚠️ 切换硬前提**:合规须先把筛查规则作用域改为 `types: ["finance","travelRule"]` 并确认,**之后**才能启用单笔提交。未确认前 Task 5 的提交切换用开关关闭 —— 否则 TR 单(最大额那批)不进规则 = 筛查真空。
- **仅 deposit 域**:withdraw 的 `preKyt*`/`kyt*`/`travelRule*` 一律不动。
- **法币不带 `counterpartyIsVasp`**:不渲染、不传、库中 null;crypto 必填。
- **VARA 阈值写死代码**:`USDT=1000`、`AED=3500`,边界 `>=` 走 TR。
- **客户面零泄露**:`sumsubTxnDetailJson`、`counterpartyIsVasp` 绝不进 `toCustomerDepositView` 白名单。
- **每轮硬闸**:后端 `tsc` 0、admin `tsc` 0、client `tsc` 0、`jest` 不回归(`asset-treasury/wallets` 4 例 pre-existing 除外)。

---

### Task 1: 判定器(纯函数,TDD)

**Files:**
- Create: `src/modules/deposit-sumsub/kyt-txn-type.resolver.ts`
- Test: `src/modules/deposit-sumsub/kyt-txn-type.resolver.spec.ts`

**Interfaces:**
- Produces: `resolveKytTxnType(input: KytTxnTypeInput): KytTxnTypeDecision`
  - `KytTxnTypeInput = { assetType: string; currency: string; amount: number; counterpartyIsVasp?: boolean | null }`
  - `KytTxnTypeDecision = { type: 'finance' | 'travelRule'; reason: KytTxnTypeReason }`
  - `KytTxnTypeReason = 'NOT_CRYPTO' | 'COUNTERPARTY_NOT_VASP' | 'NO_TR_THRESHOLD_CONFIGURED' | 'BELOW_TR_THRESHOLD' | 'TR_REQUIRED'`

- [ ] **Step 1: 写失败测试(表驱动全矩阵)**

```ts
import { resolveKytTxnType } from './kyt-txn-type.resolver';

describe('resolveKytTxnType', () => {
  const vasp = { assetType: 'CRYPTO', currency: 'USDT', counterpartyIsVasp: true };

  it.each([
    // [说明, 输入, 期望 type, 期望 reason]
    ['法币直接短路',            { assetType: 'FIAT', currency: 'AED', amount: 99999, counterpartyIsVasp: true }, 'finance', 'NOT_CRYPTO'],
    ['非 VASP 对手方',          { ...vasp, counterpartyIsVasp: false, amount: 99999 },                            'finance', 'COUNTERPARTY_NOT_VASP'],
    ['VASP 未知(null)',        { ...vasp, counterpartyIsVasp: null, amount: 99999 },                             'finance', 'COUNTERPARTY_NOT_VASP'],
    ['低于阈值',                { ...vasp, amount: 999.99 },                                                      'finance', 'BELOW_TR_THRESHOLD'],
    ['正好等于阈值 → TR',       { ...vasp, amount: 1000 },                                                        'travelRule', 'TR_REQUIRED'],
    ['高于阈值 → TR',           { ...vasp, amount: 1000.01 },                                                     'travelRule', 'TR_REQUIRED'],
    ['AED 阈值 3500 边界',      { assetType: 'CRYPTO', currency: 'AED', counterpartyIsVasp: true, amount: 3500 }, 'travelRule', 'TR_REQUIRED'],
    ['AED 低于 3500',           { assetType: 'CRYPTO', currency: 'AED', counterpartyIsVasp: true, amount: 3499 }, 'finance', 'BELOW_TR_THRESHOLD'],
    ['币种未配阈值 → 兜底',      { assetType: 'CRYPTO', currency: 'BTC', counterpartyIsVasp: true, amount: 1e9 },  'finance', 'NO_TR_THRESHOLD_CONFIGURED'],
  ])('%s', (_label, input, expectedType, expectedReason) => {
    const out = resolveKytTxnType(input as any);
    expect(out.type).toBe(expectedType);
    expect(out.reason).toBe(expectedReason);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/deposit-sumsub/kyt-txn-type.resolver.spec.ts`
Expected: FAIL — `Cannot find module './kyt-txn-type.resolver'`

- [ ] **Step 3: 实现判定器**

```ts
import { Logger } from '@nestjs/common';

/**
 * VARA Travel Rule 门槛(按资产写死,业主 2026-07-31 定)。
 * 监管数值,不做管理台可配 —— 改动须走发版 + review。
 */
const TR_THRESHOLD_BY_CURRENCY: Record<string, number> = {
  USDT: 1000,
  AED: 3500,
};

export type KytTxnType = 'finance' | 'travelRule';
export type KytTxnTypeReason =
  | 'NOT_CRYPTO'
  | 'COUNTERPARTY_NOT_VASP'
  | 'NO_TR_THRESHOLD_CONFIGURED'
  | 'BELOW_TR_THRESHOLD'
  | 'TR_REQUIRED';

export interface KytTxnTypeInput {
  assetType: string;
  currency: string;
  amount: number;
  counterpartyIsVasp?: boolean | null;
}
export interface KytTxnTypeDecision {
  type: KytTxnType;
  reason: KytTxnTypeReason;
}

const logger = new Logger('resolveKytTxnType');

/**
 * 判定这笔充值报哪个 Sumsub 交易类型。
 * 口径(业主 2026-07-31):crypto ∧ 对手方是 VASP ∧ amount >= 阈值 → travelRule;其余 finance。
 * 边界取 >=(正好 1000 USDT / 3500 AED 要走 TR)。
 */
export function resolveKytTxnType(input: KytTxnTypeInput): KytTxnTypeDecision {
  if (String(input.assetType).toUpperCase() !== 'CRYPTO') {
    return { type: 'finance', reason: 'NOT_CRYPTO' };
  }
  if (input.counterpartyIsVasp !== true) {
    return { type: 'finance', reason: 'COUNTERPARTY_NOT_VASP' };
  }
  const threshold = TR_THRESHOLD_BY_CURRENCY[String(input.currency).toUpperCase()];
  if (threshold === undefined) {
    // 漏配币种:判 finance 保证不卡单,但必须能被发现 —— 静默漏报比报错危险。
    logger.warn(
      `No VARA TR threshold configured for currency=${input.currency}; falling back to finance. Add it to TR_THRESHOLD_BY_CURRENCY.`,
    );
    return { type: 'finance', reason: 'NO_TR_THRESHOLD_CONFIGURED' };
  }
  if (input.amount < threshold) {
    return { type: 'finance', reason: 'BELOW_TR_THRESHOLD' };
  }
  return { type: 'travelRule', reason: 'TR_REQUIRED' };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx jest src/modules/deposit-sumsub/kyt-txn-type.resolver.spec.ts`
Expected: PASS(9 例全绿)

- [ ] **Step 5: tsc + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → 0
```bash
git add src/modules/deposit-sumsub/kyt-txn-type.resolver.ts src/modules/deposit-sumsub/kyt-txn-type.resolver.spec.ts
git commit -m "feat(deposit): VARA TR 类型判定器(crypto+VASP+阈值三条件,阈值写死代码)"
```

---

### Task 2: 数据模型重构(列增删 + 迁移保真)

**Files:**
- Modify: `prisma/schema.prisma`(DepositTransaction:`:968-976` 的 finance*/travelRule* 段、`:985-989` 的 sumsub*/detail 段;InboundTransferSignal:`:929` 附近加列)
- Create: `prisma/migrations/<ts>_deposit_single_sumsub_txn/migration.sql`

**Interfaces:**
- Produces: deposit 列 `sumsubTxnId` / `sumsubTxnType` / `sumsubVerdict` / `sumsubScore` / `sumsubScoredAt` / `sumsubTxnDetailJson` / `counterpartyIsVasp`;signal 列 `counterpartyIsVasp`。

- [ ] **Step 1: schema 改列**

`model DepositTransaction` —— **删**:`financeStatus`、`financeScreeningId`、`financeRiskScore`、`financeCheckedAt`、`travelRuleRequired`、`travelRuleStatus`、`travelRuleTxnDetailJson`、`sumsubFinanceTxnId`、`sumsubTravelRuleTxnId`、`financeTxnDetailJson`。
**保留**:`travelRuleTransferId`、`counterpartyVasp`、`travelRuleCheckedAt`(本轮不涉及,勿动)。
**加**:
```prisma
  sumsubTxnId          String?
  sumsubTxnType        String?   // finance | travelRule
  sumsubVerdict        String?   // approved | rejected | onHold | awaitingUser（webhook 裁决原值）
  sumsubScore          Int?
  sumsubScoredAt       DateTime?
  sumsubTxnDetailJson  String?
  counterpartyIsVasp   Boolean?  // crypto 必填；fiat 为 null
```
`model InboundTransferSignal` 加:
```prisma
  counterpartyIsVasp   Boolean?
```

- [ ] **Step 2: 生成迁移并手工核对回填**

Run: `npx prisma migrate dev --name deposit_single_sumsub_txn --create-only`

SQLite 会整表重建。**必须打开 migration.sql 手工补/核对回填**,`INSERT INTO new_deposit_transactions (...) SELECT (...)` 中:
- `sumsubTxnId` ← `sumsubFinanceTxnId`
- `sumsubTxnType` ← 字面量 `'finance'`
- `sumsubScore` ← `financeRiskScore`
- `sumsubScoredAt` ← `financeCheckedAt`
- `sumsubTxnDetailJson` ← `financeTxnDetailJson`
- `sumsubVerdict` ← `CASE financeStatus WHEN 'PASSED' THEN 'approved' WHEN 'FAILED' THEN 'rejected' WHEN 'ON_HOLD' THEN 'onHold' WHEN 'AWAITING_USER' THEN 'awaitingUser' ELSE NULL END`
- `counterpartyIsVasp` ← `NULL`
- 其余所有列**逐列照抄**(重建整表,漏一列即丢数据)

- [ ] **Step 3: 应用迁移并验数据保真**

Run: `npx prisma migrate deploy && npx prisma generate`
Run 核对(迁移前先记录行数):
```bash
sqlite3 /tmp/exchange_js_wt_deposit_arcs/dev.db "SELECT COUNT(*) FROM deposit_transactions;"
sqlite3 /tmp/exchange_js_wt_deposit_arcs/dev.db "SELECT depositNo,sumsubTxnId,sumsubTxnType,sumsubVerdict,sumsubScore FROM deposit_transactions LIMIT 10;"
```
Expected: 行数与迁移前一致;原 FROZEN 单的 `sumsubVerdict='rejected'`、`sumsubScore` 非空。

- [ ] **Step 4: commit**

```bash
git add prisma
git commit -m "refactor(deposit): 数据模型塌成单笔 Sumsub 交易(单 txnId+type+verdict),对齐官方命名"
```

---

### Task 3: 后端收敛 —— 泳道删除 + 存证/回写改单列

**Files:**
- Modify: `src/modules/deposit-sumsub/sumsub-txn.types.ts`(删 `KytLane`)
- Modify: `src/modules/deposit-sumsub/deposit-kyt-verdict.handler.ts:5,55,80`(删泳道反查与 `lane` 传参)
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:359,378-400`(删 `GATE_STATUS_BY_VERDICT`,`writeBackGateStatus` 改写)
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts:609,620`(`updateFinanceStatus`/`updateTravelRuleStatus` → 合并为 `updateSumsubVerdict`;`saveTxnDetail` 去 lane 参)
- Test: `deposit-kyt-verdict.handler.spec.ts`、`deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的新列。
- Produces: `updateSumsubVerdict(id, verdict, score?)` 写 `sumsubVerdict`/`sumsubScore`/`sumsubScoredAt`;`saveTxnDetail(id, json)`(去掉 lane 参)写 `sumsubTxnDetailJson`;`applyKytVerdict(depositId, { verdict, score?, detailRaw?, sceneTag?, dispoTag? })`(**去掉 `lane`**)。

- [ ] **Step 1: 改测试(先失败)**

`deposit-kyt-verdict.handler.spec.ts`:所有断言去掉 `lane` 字段;删除两条泳道判定用例(`lane=TRAVEL_RULE` / `lane=FINANCE`)。
`deposit-workflow.service.spec.ts`:`saveTxnDetail` 断言改为 `(depositId, json)` 两参;`updateFinanceStatus` 断言改 `updateSumsubVerdict(id, 'rejected', 98)` 形态。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/deposit-sumsub/deposit-kyt-verdict.handler.spec.ts src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts`
Expected: FAIL

- [ ] **Step 3: 删泳道**

`sumsub-txn.types.ts` 删 `KytLane` 类型及其注释块。
`deposit-kyt-verdict.handler.ts`:import 去掉 `KytLane`;删 `:55` 的 `const lane = ...` 整段;`applyKytVerdict` 调用去掉 `lane` 键。

- [ ] **Step 4: 回写改单列**

`deposit-workflow.service.ts`:删 `GATE_STATUS_BY_VERDICT`(`:359`);`writeBackGateStatus` 改为:
```ts
  /** webhook 裁决 → 展示投影(sumsubVerdict/sumsubScore)。仅供 L2 显示,不作决策依据。 */
  private async writeBackVerdict(deposit: any, verdict: string, score: number | null | undefined) {
    await this.depositService.updateSumsubVerdict(deposit.id, verdict, score ?? deposit.sumsubScore ?? null);
  }
```
调用处同步改名并去掉 `lane` 实参;`saveTxnDetail` 调用去掉 lane 实参。

`deposit-transactions.service.ts`:`updateFinanceStatus` + `updateTravelRuleStatus` 两个方法**合并**为:
```ts
  async updateSumsubVerdict(id: string, verdict: string, score?: number | null) {
    return (this.prisma as any).depositTransaction.update({
      where: { id },
      data: { sumsubVerdict: verdict, sumsubScore: score ?? null, sumsubScoredAt: new Date() },
    });
  }
```
`saveTxnDetail` 去掉 lane 分支,固定写 `sumsubTxnDetailJson`。
`initializeComplianceGates`(`:593-606`)**整个删除** —— `travelRuleRequired`/`travelRuleStatus` 已不存在;其调用点 `deposit-workflow.service.ts:197` 一并删。

- [ ] **Step 5: 跑测试 + tsc + commit**

Run: `npx jest src/modules/deposit-sumsub src/modules/trading/deposit-transactions`
Run: `npx tsc --noEmit -p tsconfig.json` → 0(漏改会在此报错,逐个修)
```bash
git commit -am "refactor(deposit): 删除泳道概念,裁决/存证收敛到单列(updateSumsubVerdict/saveTxnDetail)"
```

---

### Task 4: 老 mock KYT 管道退役 + `checkAutoApproval` 改数据源

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts`(删 `applyKytResult` `:633`、`applyTrResult` `:655`;`checkAutoApproval` `:675` 改判断)
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts:130-140`(删两个合成事件分支)
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`(删产生 `kytCheckSimulated`/`travelRuleCheckSimulated` 的端点,`:354` 起)
- Test: `deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `sumsubVerdict`。
- ⚠️ `checkAutoApproval` **保留**(`waiveLimitHold` 依赖它),只改数据源。

- [ ] **Step 1: 写 `waiveLimitHold` 时序测试(先失败)**

在 `deposit-workflow.service.spec.ts` 加:
```ts
it('waiveLimitHold: KYT 已 approved 的单,豁免后应放行', async () => {
  depositService.findOne.mockResolvedValue({
    id: 'dep-w1', depositNo: 'DEPW1', status: DepositTransactionStatus.COMPLIANCE_PENDING,
    limitHoldReason: 'BELOW_MIN', sumsubVerdict: 'approved', ownerType: 'FIRM', ownerId: 'firm-1', traceId: null,
  });
  depositService.updateStatus.mockResolvedValue({ status: DepositTransactionStatus.SUCCESS });
  await service.waiveLimitHold('dep-w1', { actorId: 'admin-1' });
  expect(depositService.updateStatus).toHaveBeenCalledWith('dep-w1', { action: DepositTransactionAction.APPROVE });
});

it('waiveLimitHold: KYT 未 approved 的单,豁免后不放行', async () => {
  depositService.findOne.mockResolvedValue({
    id: 'dep-w2', depositNo: 'DEPW2', status: DepositTransactionStatus.COMPLIANCE_PENDING,
    limitHoldReason: 'BELOW_MIN', sumsubVerdict: 'onHold', ownerType: 'FIRM', ownerId: 'firm-1', traceId: null,
  });
  await service.waiveLimitHold('dep-w2', { actorId: 'admin-1' });
  expect(depositService.updateStatus).not.toHaveBeenCalledWith('dep-w2', { action: DepositTransactionAction.APPROVE });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t waiveLimitHold`
Expected: FAIL(仍读 `financeStatus`)

- [ ] **Step 3: `checkAutoApproval` 改判断**

```ts
    // 放行由 webhook 裁决驱动;这里读的是裁决字段(不是展示用的翻译值)。
    if (deposit.sumsubVerdict !== 'approved') {
      this.logger.debug(`Auto-approval skip: deposit ${depositId} sumsubVerdict=${deposit.sumsubVerdict}`);
      return;
    }
    // 原 travelRuleStatus 那道闸整条删除 —— 一笔单只有一个 type,不存在「另一腿未过」。
```

- [ ] **Step 4: 删老 mock 管道**

- `deposit-workflow.service.ts`:删 `applyKytResult()` 与 `applyTrResult()` 两个方法整体。
- `sumsub-ingestion.service.ts`:删 `else if (event.eventType === 'kytCheckSimulated') {...}` 与 `else if (event.eventType === 'travelRuleCheckSimulated') {...}` 两个分支整体。
- `admin-sumsub-simulation.controller.ts`:删产生这两个合成事件的端点方法。**保留**该文件其余(withdraw 相关)内容。
- **勿动** `AdminDepositDemoController`(新 demo 端点,`SUMSUB_MOCK_MODE` 门控),与此无关。

- [ ] **Step 5: 跑测试 + tsc + commit**

Run: `npx jest src/modules/trading/deposit-transactions src/modules/sumsub-ingestion` → 全绿
Run: `npx tsc --noEmit -p tsconfig.json` → 0
```bash
git commit -am "refactor(deposit): 老 mock KYT 管道退役;checkAutoApproval 改读 sumsubVerdict(保留 waiveLimitHold 依赖)"
```

---

### Task 5: 单笔提交(判定接线,带开关)

**Files:**
- Modify: `src/modules/trading/deposit-transactions/deposit-workflow.service.ts:208`(`submitSumsubTxns`)
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`(`setSumsubTxnIds` → `setSumsubTxn`)
- Test: `deposit-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 `resolveKytTxnType`;Task 2 的 `counterpartyIsVasp`/`sumsubTxnId`/`sumsubTxnType`。
- Produces: `setSumsubTxn(depositId, { sumsubTxnId, sumsubTxnType })`。

- [ ] **Step 1: 写测试(先失败)**

断言:①crypto+VASP+超阈值 → `submitTxn` **只被调一次**且 `type==='travelRule'`;②crypto+非VASP → 只调一次且 `type==='finance'`;③fiat → 只调一次 `finance`;④审计 metadata 含 `txnType` + `reason`。

- [ ] **Step 2: 跑测试确认失败**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts -t submitSumsub`
Expected: FAIL(现仍发两笔)

- [ ] **Step 3: 改 `submitSumsubTxns` 为单笔**

```ts
    const decision = resolveKytTxnType({
      assetType: deposit.asset?.type,
      currency: deposit.asset?.currency,
      amount: Number(deposit.amount),
      counterpartyIsVasp: deposit.counterpartyIsVasp,
    });

    const result = await this.sumsubTxnClient.submitTxn({
      applicantId,
      clientTxnId: deposit.depositNo,
      type: decision.type,
      direction: 'in',
      amount: Number(deposit.amount),
      currencyCode: deposit.asset?.currency,
      currencyType: deposit.asset?.type === 'CRYPTO' ? 'crypto' : 'fiat',
    });

    await this.depositService.setSumsubTxn(deposit.id, {
      sumsubTxnId: result.txnId,
      sumsubTxnType: decision.type,
    });
```
幂等守卫由 `deposit.sumsubFinanceTxnId` 改为 `deposit.sumsubTxnId`。
审计 metadata 改为 `{ sumsubTxnId: result.txnId, txnType: decision.type, reason: decision.reason }`。

- [ ] **Step 4: 加切换开关**

在 `submitSumsubTxns` 顶部:
```ts
// ⚠️ 硬前提:合规须先把筛查规则作用域改为 types:["finance","travelRule"] 并确认,
// 否则 travelRule 单不进规则 = 筛查真空(且 TR 单正是最大额那批)。确认后置为 true。
const SINGLE_TXN_SUBMIT_ENABLED = process.env.SUMSUB_SINGLE_TXN_SUBMIT === 'true';
```
未启用时:仍按 `decision.type` 提交**一笔**,但强制 `type='finance'`(退回旧筛查覆盖面,不产生真空);启用后按判定结果。两种分支都只发一笔。

- [ ] **Step 5: 跑测试 + tsc + commit**

Run: `npx jest src/modules/trading/deposit-transactions/deposit-workflow.service.spec.ts` → 全绿
```bash
git commit -am "feat(deposit): 单笔提交 —— 按 VARA 判定选 type(开关门控,待合规确认规则作用域后启用)"
```

---

### Task 6: 客户端 VASP 录入(crypto 专有)

**Files:**
- Modify: `client-web/src/pages/Deposit.tsx:105`(payload 接口)、`:371`(`buildMockInboundSignalPayload`)、`:1068` 后(弹窗新增项)、`:167` 附近(新 state)
- Modify: `src/modules/trading/deposit-transactions/dto/inbound-transfer-signal.dto.ts:62`(`CreateInboundTransferSignalDto`)
- Modify: `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts:174`(signal create)、`:367`(`detected()` 调用)
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`(`detected()` 入参 + create)

**Interfaces:**
- Produces: DTO 字段 `counterpartyIsVasp?: boolean`(crypto 必填 / fiat 禁传);`detected()` 入参增 `counterpartyIsVasp?: boolean | null`。

- [ ] **Step 1: DTO 可选字段 + service 端按资产校验**

**已核实:`CreateInboundTransferSignalDto` 没有 `assetType` 字段**(资产由 `walletId` 反查),所以 `@ValidateIf` 拿不到判据 —— 校验**必须落在 service 端**。

DTO 只声明为可选布尔:
```ts
  // crypto 必填 / fiat 禁传 —— 判据依赖 wallet 的 asset.type,校验在
  // InboundTransferSignalsService.createForCustomer() 内(DTO 层拿不到 assetType)。
  @IsOptional()
  @IsBoolean()
  counterpartyIsVasp?: boolean;
```

`inbound-transfer-signals.service.ts` 的 `createForCustomer()` 内,取到 wallet 的 asset 之后加:
```ts
    const isCrypto = String(wallet.asset?.type).toUpperCase() === 'CRYPTO';
    if (isCrypto && dto.counterpartyIsVasp === undefined) {
      throw new BadRequestException('counterpartyIsVasp is required for crypto deposits');
    }
    if (!isCrypto && dto.counterpartyIsVasp !== undefined) {
      throw new BadRequestException('counterpartyIsVasp must not be provided for fiat deposits');
    }
```

- [ ] **Step 2: 通路打通**

`inbound-transfer-signals.service.ts` signal create 加 `counterpartyIsVasp: dto.counterpartyIsVasp ?? null`;`detected()` 调用处透传 `counterpartyIsVasp: signal.counterpartyIsVasp`。
`deposit-transactions.service.ts` 的 `detected()` 入参加该字段并写进 `depositTransaction.create` 的 data。

- [ ] **Step 3: 客户端弹窗新增项**

`Deposit.tsx`:加 `const [counterpartyIsVasp, setCounterpartyIsVasp] = useState<boolean | null>(null);`
在 Amount 输入块之后,**仅 `depositWallet.asset.type === 'CRYPTO'` 时**渲染二选一(radio 或两个按钮),文案全英文:
```
Counterparty
( ) VASP (exchange / custodian)      ( ) Unhosted wallet
```
`buildMockInboundSignalPayload` 的 crypto 分支加 `counterpartyIsVasp`;fiat 分支**不加**。提交前若 crypto 且未选,禁用提交按钮或提示 `Please select the counterparty type`。

- [ ] **Step 4: 三端 tsc + commit**

Run: `npx tsc --noEmit -p tsconfig.json` → 0
Run: `cd client-web && npx tsc --noEmit && cd ..` → 0
```bash
git commit -am "feat(deposit): 客户端模拟充值新增对手方 VASP 录入(crypto 专有),打通至判定器"
```

---

### Task 7: 详情页三块改造

**Files:**
- Modify: `admin-web/src/pages/DepositTransactionDetail.tsx`(L2 卡、Sumsub References 卡、Sumsub Transaction Detail 卡、`DepositDetail` 接口)
- Modify: `src/modules/trading/deposit-transactions/deposit-transactions.service.ts`(`findOneForAdmin` 的 `parseDetail`/返回体去掉双份)

**Interfaces:**
- Consumes: Task 2/3 的 `sumsubTxnId`/`sumsubTxnType`/`sumsubVerdict`/`sumsubScore`/`sumsubTxnDetailJson`。
- Produces: `findOneForAdmin` 返回 `sumsubDetail`(单份,取代 `financeDetail`/`travelRuleDetail`)。

- [ ] **Step 1: 后端返回体收敛**

`findOneForAdmin`:`parseDetail(item.financeTxnDetailJson)` / `parseDetail(item.travelRuleTxnDetailJson)` 两处 → 合并为 `sumsubDetail: parseDetail(item.sumsubTxnDetailJson)`。`parseDetail` 内部**新增**回显官方字段:
```ts
    reviewStatus: d?.review?.reviewStatus ?? null,
    reviewAnswer: d?.review?.reviewResult?.reviewAnswer ?? null,
```

- [ ] **Step 2: L2 收敛为一行(webhook 裁决原值)**

标签按 `sumsubTxnType`(`travelRule` → `Travel Rule:` / 否则 `Finance:`),值为 `data.sumsubVerdict`(四值原样,**不翻译**),后接 `Score: {data.sumsubScore ?? '—'}`。删除原 Finance/Travel Rule 双行结构与 `trStyle`。

- [ ] **Step 3: References 收敛为一组**

```
Applicant ID
─────────────────────────────
Txn ID │ Type │ Verdict │ Received At
```
删除原两组三件套与 `financeWebhook`/`travelRuleWebhook` 分腿变量(`latestSumsubWebhook` 现只有一条,直接用)。

- [ ] **Step 4: Transaction Detail 单份 + 官方字段**

`SumsubDetailSection` 只渲染一次(读 `data.sumsubDetail`),字段行加 `Review Status` / `Review Answer`(官方名),其余(Score/Matched rules/Applicant Action IDs/折叠原文)不变。删除 `data.travelRuleRequired &&` 的第二次渲染。

- [ ] **Step 5: admin tsc + commit**

Run: `cd admin-web && npx tsc --noEmit && cd ..` → 0
```bash
git commit -am "feat(admin): 详情页 L2/References/Transaction Detail 随单笔交易模型收敛为单份"
```

---

### Task 8: fixtures + e2e 重做,全量验证,文档同步

**Files:**
- Modify: `src/modules/deposit-sumsub/fixtures/scenarios.ts`(S2 双腿场景改单笔;字段随改名同步)
- Modify: `test/deposit-sumsub-scenarios.e2e-spec.ts`
- Modify: `doc-final/reference/truth/v4-deposit.md`、`doc-final/BACKLOG.md`

- [ ] **Step 1: fixtures 改单笔**

`S2_HAPPY_CRYPTO` 从「finance + travelRule 两腿各自 Created→Approved」改为**单笔**(按新口径:crypto happy 场景若要演 TR,须 `counterpartyIsVasp=true` + 金额过阈值)。`submit` 结构去掉 `travelRuleTxnId`。其余场景 `primeTxn` 随字段名同步。

- [ ] **Step 2: e2e 重做并跑通**

Run: `npm run test:e2e -- --testPathPatterns=deposit-sumsub-scenarios`
Expected: 全绿(建单 helper 需带 `counterpartyIsVasp`)

- [ ] **Step 3: 全量硬闸**

Run: `npx tsc --noEmit -p tsconfig.json` → 0
Run: `cd admin-web && npx tsc --noEmit && cd ..` → 0
Run: `cd client-web && npx tsc --noEmit && cd ..` → 0
Run: `npx jest` → 仅 `asset-treasury/wallets` 4 例 pre-existing 失败,净新增 0

- [ ] **Step 4: 渲染验证(项目铁律)**

Run: `bash scripts/stack.sh up`
截图比对:①客户端弹窗 crypto 有 VASP 二选一 / 法币无该项;②造两笔单(VASP+超阈值 → L2 显示 `Travel Rule: approved`;非 VASP → `Finance: approved`);③References 一组;④Transaction Detail 单份且含 Review Status/Answer。

- [ ] **Step 5: 客户面零泄露断言**

```bash
curl -s "http://localhost:3100/deposit-transactions/my?take=3" -H "Authorization: Bearer <客户token>" | grep -ci "sumsubTxnDetailJson\|counterpartyIsVasp\|sumsubVerdict"
```
Expected: 0

- [ ] **Step 6: 文档同步 + commit**

`truth/v4-deposit.md` 新增一节记录单笔模型与判定口径;`BACKLOG.md` 记:①合规三项确认(规则双类型作用域 / 聚合分桶 / 币种守卫);②真实 VASP 归属服务未接(演示用录入模拟);③`SUMSUB_SINGLE_TXN_SUBMIT` 开关待合规确认后启用并最终删除。
```bash
git commit -am "docs(truth+backlog): 同步单笔 Sumsub 交易模型与 VARA 判定口径;登记合规确认项与开关退场"
```

---

## 自查(写完计划回看 spec)

- **spec 覆盖**:§1 判定器→Task1;§2 数据模型→Task2;§3 提交逻辑→Task5;§4.2 老管道退役 + §4.3 checkAutoApproval→Task4;§5 客户端→Task6;§6 详情页→Task7;§7 硬前提→Task5 开关 + Task8 BACKLOG;§8 验证→Task8。**全覆盖**。
- **类型一致**:`resolveKytTxnType`/`KytTxnTypeDecision`(T1)、`updateSumsubVerdict`/`saveTxnDetail(id,json)`/`applyKytVerdict` 去 lane(T3)、`setSumsubTxn`(T5)、`sumsubDetail`(T7)—— 各 task 命名一致。
- **顺序依赖**:T1 独立;T2 是地基;T3 依赖 T2;T4 依赖 T2(读 `sumsubVerdict`);T5 依赖 T1+T2;T6 依赖 T2;T7 依赖 T2+T3;T8 收尾。**建议顺序 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**。
- **风险点已在计划内标注**:T2 迁移回填(整表重建漏列即丢数据)、T4 `checkAutoApproval` 不可整删、T5 开关硬前提。
