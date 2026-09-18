# 资金单 externalRef 生成回写收口 — 设计

> Date: 2026-07-11 ｜ Status: 设计定稿(待评审)
> 定调来源:业主。externalRef 的生成+回写归位到 `FundsOrderService`,订单三域仅作发起方。

---

## 0. 背景与问题

`externalRef`(一笔真实资金移动的外部凭证:虚拟币 txHash / 法币银行 ReferenceNo)当前:

1. **散落在三个订单域各自现算**,口径互不一致:
   - 充值 `deposit-workflow.service.ts → executeDepositAccounting()`(~476):`fundsOrder?.txHash ?? fundsOrder?.referenceNo ?? deposit.txHash ?? deposit.referenceNo` 盲 coalesce,不分类型。
   - 提现 `withdraw-workflow.service.ts → recognitionRefs()`(~944):`w.txHash ?? w.referenceNo`,**读 WithdrawTransaction、不读 funds_order**。
   - 兑换 `swap-leg-accounting.ts → initiateLegPending()`(~299):`` `${swapNo}:${legSeq}:${attempt}:pending` `` **合成串,非真实凭证,永远 `:pending`**。
2. **funds_order 自己的 `txHash`/`referenceNo` 列只在 `create()` 写一次,之后永不回写**(全库唯一 `fundsOrder.update` 在 `advance()`,只改 `status + statusHistory`)。提现的真实 txHash 因此只落在 WithdrawTransaction、funds_order 那列恒 null。
3. **swap 代码自相矛盾**:标 `isExternalCrossing: true`(承认是真实跨钱包穿越)却填合成 `:pending`(信"swaps don't broadcast on-chain")→ 对账 Pass1(同 externalRef 跨钱包互证)里 swap 腿永远配不上真实外部行。这是"回写错了"的机理。

**症状**:很多资金单没回写 externalRef(提现)、有的回写是错的(兑换)。

### 领域澄清(纠正旧口径)

- **"internal" 指账户归属在我方掌控内,不指"只动账本不动钱"。** swap 腿是我方掌控账户间的**真实转账**,有真实 externalRef。
- **系统全模拟,无真实外部 API。** 故没有"外部真值"要迁就:内部流水(account_flows)与外部对账单行(external_statement_lines)**两侧都由我方铸造**,只要同种子铸造即恒等匹配。
- 旧口径"swap 资金不出境/无外部对手/纯内部记账"是错的,需随本次一并清除(见 §6 文档同步)。

---

## 1. 目标(底层逻辑)

`FundsOrderService` 是 externalRef 的**唯一 owner**:资金单**首次到达 CONFIRMED** 时,按 `assetType` 自铸凭证并落到 funds_order 行的既有列;账务 / 对账 / 推单 / 前端一律**读 funds_order**;订单三域(deposit/withdraw/swap)仅作**发起方**,create 后与 externalRef 生成脱钩。

**非目标**:不改状态机迁移表、不改对账引擎算法、不改记账科目、不接真实外部 API、不做 schema 迁移。

---

## 2. 设计

### 2.1 存储(方案甲 — 复用现有列,零迁移)

沿用 `funds_orders` 既有的 `txHash` / `referenceNo` 两列,**不新增 `externalRef` 列**(避免双源漂移;对账/推单现状本就读 `[txHash, referenceNo, providerTxnId]`)。

- `assetType = CRYPTO` → 号落 `txHash`
- `assetType = FIAT`   → 号落 `referenceNo`

### 2.2 铸造规则(一处,取代三处散落)

新增私有 `FundsOrderService.stampExternalRef(row, tx)`:**当资金单首次达到 CONFIRMED** 触发,以 `fundsOrderNo` 为确定性种子铸号,**幂等**(对应列已有值则保留不覆盖):

```
CRYPTO:  if (!row.txHash)      txHash      = fakeChainTxHash(row.fundsOrderNo)
FIAT:    if (!row.referenceNo) referenceNo = fakeBankRef(row.fundsOrderNo, effectiveDate ?? businessDate)
```

- 铸造器复用现成 `src/common/utils/fake-external-refs.util.ts`(`fakeChainTxHash` / `fakeBankRef`,确定性 sha256 种子)。
- **方向无关**:进(充值)/出(提现)/兑换腿同一规则。幂等保留吸收"充值 IN 由发起方在 create 时带入真实号"的情形(见 §2.4)。
- 种子恒为 `fundsOrderNo` → 外部对账单播种也用同一种子(见 §4 第 5 项)→ 两侧恒等匹配。
- **swap 自愈跨重试不撞号**:每个 `(legSeq, attempt)` 是独立 funds_order 行(`@@unique([swapTransactionId, legSeq, attempt])`,失败留历史行、取 MAX attempt 为活跃腿),各 attempt 有各自 `fundsOrderNo` → 铸出不同号,旧 `${swapNo}:${legSeq}:${attempt}:pending` 里 attempt 段的去重作用被 `fundsOrderNo` 种子天然保住。

### 2.3 触发时机(首达 CONFIRMED,两处入口)

`stampExternalRef` 必须在**任何**使资金单首次进入 `CONFIRMED` 的路径上触发:

- **`advance()`**:当 `next === CONFIRMED` 时,在同一事务内 stamp 后再 emit 事件。
- **`create()`**:当 `initialStatus` 已 `>= CONFIRMED` 时(**`FIAT_IN` 法币充值出生态即 CONFIRMED**,不经 advance),在 create 事务内 stamp。

> 封装成同一个 `stampExternalRef` 被两处调用,避免遗漏法币充值这条"出生即 CONFIRMED"的边界。

### 2.4 读取访问器(下游统一入口)

新增 `FundsOrderService.resolveExternalRef(row): string | null`:
```
CRYPTO → row.txHash ?? null
FIAT   → row.referenceNo ?? null
```
这即业主所说"其他地方去读的那个 No"。账务写 evidence 时经此取号。

### 2.5 纯重分类腿保持 null(不误伤)

以下腿是真·纯账本重分类(资金不跨外部边界,`isExternalCrossing: false`),**保持 `externalRef: null`,不铸号**:
- 充值 STEP_2:DEPOSIT_SUSPENSE → CLIENT_PAYABLE(`deposit-workflow.service.ts:556`)
- 提现锁定腿:pending LOCK(`withdraw-workflow.service.ts:313`)

铸号只发生在 funds_order 层(每资金单一次),记账各腿按需读 `resolveExternalRef()`;纯重分类腿显式传 null,与现状一致。

---

## 3. 数据流(收口后)

```
订单域(发起方)  create funds_order  ─┐  (充值 IN:附带发起方带入的 txHash/referenceNo)
                                      │
FundsOrderService ── 首达 CONFIRMED ──┤─ stampExternalRef():按 assetType 铸号落列(幂等)
                                      │
                    resolveExternalRef(row) ←── 账务写 evidence 取号 ── account_flows.externalRef
                                      │
                    txHash/referenceNo 列 ←──── admin 详情页直读(零改动,自动显示正确值)
                                      │
外部对账单播种(sim) ── 同种子 fundsOrderNo 铸号 ── external_statement_lines.externalRef
                                      │
                            对账引擎 Pass1 同 externalRef 互证 → 恒等匹配
```

---

## 4. 下游改动清单

| # | 文件 → 符号 | 改动 |
|---|---|---|
| 1 | `funds-orders/funds-order.service.ts → create()/advance()` | 新增私有 `stampExternalRef()` + 公开 `resolveExternalRef()`;首达 CONFIRMED 触发铸造;引入 `fake-external-refs.util` |
| 2 | `trading/deposit-transactions/deposit-workflow.service.ts → executeDepositAccounting()` (~476) | 删本地 coalesce,STEP_1 externalRef 改读 `fundsOrders.resolveExternalRef(fundsOrder)` |
| 3 | `trading/withdraw-transactions/withdraw-workflow.service.ts → recognitionRefs()` (~944) | externalRef 改读 funds_order(经 resolver),不再读 `w.txHash`;walletRef 逻辑不变 |
| 4 | `trading/swap-transactions/swap-leg-accounting.ts → initiateLegPending()` (~299) | 删 `:pending` 合成串,改读 funds_order 铸的真实号 → **修掉"回写错了"** |
| 5 | `scripts/recon-demo.ts → writeMirror()` 外部行镜像 | **无需改**——mirror 从 `account_flows.externalRef` 复制(第 524/536 行),account_flows 拿到 funds_order 真号后自动同值;仅需 `recon:demo:pass/break` 回归验证。stuck 场景(demo-fixtures)按 fundsOrderNo/金额走 Pass3 在途配对,不依赖铸号,亦无需改 |
| 6 | 文档同步(见 §6) | 清除"swap 无外部/不出境"旧口径 |

**零改动(自动受益或本就正确)**:
- admin `FundsOrderDetail` / `DepositTransactionDetail` / `WithdrawTransactionDetail` — 直读列,填值后自动显示。
- 对账引擎 / push-order / AccountStatement / ExternalBalances / CasesDetail 页 — 读 `account_flows.externalRef` 或列,口径不变。
- client-web `Deposit.tsx`(~352 铸 `0x${txSeed}` / `REF-...`)— **保留**,它是充值 IN 发起方带入号的源头(create 时交给 funds_order,幂等保留)。

---

## 5. 不变量与验收

### 不变量
- **同源恒等**:外部对账单行 `externalRef` 由 `writeMirror()` 从 `account_flows.externalRef` 复制得到 → 与内部侧**构造性恒等**(account_flows 的号来自 funds_order 铸值)。
- **单一漏斗**:铸造在 `FundsOrderService.advance()`/`create()` 内,所有路径(真实 workflow / demo-lib / sim 面板)都经此,无旁路。
- **一单一号**:每资金单最多铸一次(幂等);纯重分类腿 externalRef 恒 null。
- **类型正确**:CRYPTO 单号落 txHash 且形如 `0x`+64hex;FIAT 单号落 referenceNo 且形如 `ZB…`。

### 验收标准(□)
- □ 提现资金单 CONFIRMED 后 `funds_orders.txHash`(crypto)/`referenceNo`(fiat)非空(此前恒 null)。
- □ 兑换 4 腿 externalRef 为真实铸号,**无 `:pending` 残留**;对账 Pass1 能同 ref 互证。
- □ 充值资金单沿用发起方带入号(幂等未被覆盖),对账仍匹配。
- □ `demo:all` 8/8 PASS;`recon:demo:pass` PASS、`recon:demo:break` 桶判定不回退。
- □ `verify:coa` `ALL INVARIANTS PASS`;`tsc` 0 error。
- □ admin FundsOrderDetail 提现/兑换单显示真实凭证(此前空)。

---

## 6. 文档同步(改代码=同步 truth)

- `reference/truth/funds-orders.md`:§2/§3 补 externalRef 铸造归位 + `resolveExternalRef`/`stampExternalRef` 锚点;§4 移除"命名债"外补本次收口。
- `reference/truth/v6-swap.md:11`:删"资金不出境、无外部对手方"错口径,改为"我方掌控账户间真实转账,有真实 externalRef"。
- `swap-leg-accounting.ts:96-100 / 293-297` 注释:删"swaps don't broadcast on-chain"。
- `BACKLOG.md`:勾掉/更新 swap `:pending` 合成串条目;登记 client-web 铸号格式与 canonical `fake-external-refs` 不一致(如需后续统一)。

---

## 7. 锚点

- 铸造/读取:`funds-orders/funds-order.service.ts → stampExternalRef()/resolveExternalRef()`
- 铸造器:`common/utils/fake-external-refs.util.ts → fakeChainTxHash()/fakeBankRef()`
- 消费(记账):`trading/*/*-workflow.service.ts`、`swap-transactions/swap-leg-accounting.ts`
- 外部侧播种:`scripts/recon-demo.ts`、`scripts/demo-fixtures.ts`
- 对账消费:`clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts`
