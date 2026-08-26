# EOD Cutoff Window — 设计 Spec

> 状态：设计已对齐（pre-implementation）
> 日期：2026-06-18
> 适用：V7 funds-layer crypto EOD 结算（principal pass + fee pass）
> 目标读者：实现者 / 复核者

---

## 1. 背景与问题

当前 crypto EOD 结算（`EodSettlementWorkflowService.runEodSettlement`）的选行口径是**纯按状态、无时间窗**：

- principal pass — `OutstandingConsumerService.findOpenCryptoByAsset()`：
  `where: { status:'OPEN', asset:{type:'CRYPTO'}, settlementBatchId:null }`
- fee pass — `runFeePass()`：`feeAccrual.findMany({ where:{ status:'ACCRUED', asset:{type:'CRYPTO'} } })`

cron 在 `0 59 23 * * *`（Asia/Dubai，即 T+0 当天 23:59）触发，把**触发那一刻**所有 OPEN/ACCRUED 的行全部纳入结算。

**问题（脏切面 race）**：23:59 起跑到 24:00 之间、以及 EOD 运行过程中新成交的交易，会随机命中或不命中当批——是否进批完全取决于时序赛跑，没有一个稳定的「以 24:00 为界」的干净交易切面。

`schema.prisma` 已具备改造所需字段，**无需迁移**：
- `Outstanding.createdAt`（含 `@@index([createdAt])`）
- `FeeAccrual.createdAt`
- `SettlementBatch.cutoffAt DateTime`（当前被错误地写成跑批时刻 `new Date()`，而非逻辑切点）

---

## 2. 目标与成功标准

**目标**：把 EOD 从「按状态选行」改为「按 T+0 自然日切面选行」，并把跑批时点移到 T+1 00:30，使 24:00 成为稳定的干净交易切面。

**成功标准**：
1. cron 在每日 Asia/Dubai 00:30 触发。
2. 一次跑批只结清 `createdAt < cutoff`（cutoff = 跑批当天 Dubai 00:00:00）的 OPEN/ACCRUED crypto 行。
3. `[cutoff, 跑批时刻)`（即 T+1 00:00–00:30）之间新成交的 Outstanding/FeeAccrual **不进入**本批，保持 OPEN/ACCRUED，由次日批结清。
4. 晚到的 T+0 行（`createdAt < cutoff` 但落库晚于跑批）不丢失、不重复结算。
5. 两本账 FX 不变量（I1/I2）在开窗后仍成立。
6. 全量回归测试 + 新增边界测试通过。

---

## 3. 范围 / 非目标

**改**：
- crypto EOD principal pass + fee pass 的**选行口径**（加 `createdAt < cutoff` 上界）。
- EOD cron 时点（`0 59 23 * * *` → `0 30 0 * * *`）。
- `SettlementBatch.cutoffAt` 写入语义（跑批时刻 → 逻辑切点）。

**不改（非目标）**：
- **fiat 结算**：per-swap 实时、无批、无切面问题。
- **`FxEodService`（fx-eod）**：按 TB 余额 + 已结/未结 swap 状态驱动，不按日期选行；开窗后天然自洽（见 §6）。
- **swap 成交写入路径（V6）**：不引入 `tradingDay` 列（`createdAt`+索引已足够，YAGNI）。
- **schema**：0 迁移。
- **手动补跑历史日**（带显式 cutoff 入参）：列为 ADVANCED，本次不做。

---

## 4. Cutoff 模型

**时区**：Asia/Dubai，全年 UTC+4、**无 DST** → 固定 offset 即正确，且与现有 cron `timeZone:'Asia/Dubai'` 对齐。

**区间**：半开 `[T+0 00:00:00, T+1 00:00:00)`，判定用 `createdAt < cutoff`（`createdAt == cutoff` 归 T+1）。

**唯一新增逻辑** — 纯函数 `src/modules/funds-layer/workflow/eod-cutoff.util.ts`：

```ts
// Dubai 全年 UTC+4、无 DST → 固定 offset 即正确。
export const EOD_OFFSET_MS = 4 * 60 * 60 * 1000;

/** 返回「now 所在 Dubai 自然日 00:00:00」对应的 UTC 时刻。 */
export function resolveEodCutoff(now: Date): Date {
  const dubaiMs = now.getTime() + EOD_OFFSET_MS;
  const midnightDubai = Math.floor(dubaiMs / 86_400_000) * 86_400_000;
  return new Date(midnightDubai - EOD_OFFSET_MS);
}
```

00:30 跑批 → `resolveEodCutoff(now)` = 当天 Dubai 00:00:00 = 昨日(T+0) 收盘切点。

---

## 5. 精确改动（4 改 + 1 新建）

### ① `sweep/eod-settlement-sweep.service.ts` — 仅 cron 表达式
```diff
- @Cron('0 59 23 * * *', { timeZone: 'Asia/Dubai' })
+ @Cron('0 30 0 * * *',  { timeZone: 'Asia/Dubai' })
```
其余不变（cutoff 由 workflow 计算）。

### ② `workflow/eod-settlement-workflow.service.ts` — 算 cutoff + 下传
- 签名：`runEodSettlement(operatorId = 'SYSTEM', cutoff?: Date)`
- 顶部：`const cut = cutoff ?? resolveEodCutoff(new Date());`
- `this.consumer.findOpenCryptoByAsset(cut)`
- `this.batchService.createBatch({ cutoffAt: cut })`（替换现有 `new Date()`）
- 两个分支（无 open outstanding 的 fee-only 分支 + 正常分支）均调 `this.runFeePass(cut)`
- `runFeePass(cutoff: Date)`：distinct-asset 查询 + 每类（SWAP_FEE / WITHDRAW_FEE）的 `feeAccrual.findMany` 各加 `createdAt: { lt: cutoff }`
- import `resolveEodCutoff`

> cutoff 作为可选入参注入：默认 = 当天 00:00（cron 与手动触发共用），同时让单测可注入固定切点。

### ③ `domain/outstanding-consumer.service.ts` — principal 选行加上界
- 签名：`findOpenCryptoByAsset(cutoff: Date)`
```diff
  where: {
    status: 'OPEN',
    asset: { type: 'CRYPTO' },
    settlementBatchId: null,
+   createdAt: { lt: cutoff },
  },
```
其余分组/轧差逻辑不变。

### ④ `controllers/settlement-admin.controller.ts` — 不改
`run()` 仍调 `runEodSettlement('ADMIN')`，cutoff 走默认 = 当天 00:00（边界假设 #2）。

### ⑤ 新建 `workflow/eod-cutoff.util.ts`
见 §4。

---

## 6. 边界 / 不变量

| 场景 | 行为 | 保障机制 |
|---|---|---|
| 晚到的 T+0 行（落库晚于 00:30，但 `createdAt < cutoff`） | 本批未取到 → 次日批（cutoff 更晚）兜住 | 只卡上界 + `settlementBatchId:null`，不漏不重 |
| 漏跑 / 同日重跑 | 已结行不再取，幂等；至多产生小补批/空批 | `settlementBatchId:null` 过滤 |
| `[00:00, 00:30)` 成交 | `createdAt ≥ cutoff` → 排除 → 次日结 | 即设计要的干净切面 |
| fx-eod 一致性 | T+1 swap 停 OPEN → 进 `openNet`、留在桥 → I2 `bridgeNet==openNet` 成立；principal sweep 只搬已结的 T+0 部分 | fx-eod 按余额+已结/未结驱动，不按日期，天然自洽，**不改** |
| 每日重估 fixing | 时点从 23:59 顺延到 ~00:30（30 分钟汇率新鲜度差） | 非正确性问题，可接受 |
| DST | Dubai 无 DST，固定 UTC+4 | `EOD_OFFSET_MS` 常量安全 |

---

## 7. 测试计划（TDD）

- **`eod-cutoff.util.spec.ts`（新建）**：`now` = Dubai 00:30 / 23:45 / 跨 UTC 日界（如 UTC 20:00 = Dubai 次日 00:00）时，cutoff 均落「当天 Dubai 00:00:00」对应 UTC 时刻。
- **`outstanding-consumer.service.spec.ts`**：`createdAt < cutoff` 纳入；`== cutoff` 排除；`> cutoff` 排除。
- **`eod-settlement-workflow.service.spec.ts`**：
  - 播 T+0 + T+1 两组 Outstanding/FeeAccrual → `runEodSettlement('TEST', cut)` → 仅 T+0 结清；T+1 留 OPEN/ACCRUED；`batch.cutoffAt == cut`。
  - 再用「次日 cutoff」跑 → 原 T+1 行结清（验证 roll-forward 不丢）。
  - 「无 open crypto outstanding → 仅 fee pass」分支同样按 cutoff 开窗。
- **回归**：funds-layer 既有 EOD/settlement 相关单测全绿；`scripts/verify-two-book.ts` 全链验收仍 PASS（验证 I1/I2 不变量）。

---

## 8. 风险 / 落地备注

- **24h SLA 口径**：T+0 批在 T+1 00:30 跑 = 距 24:00 收盘 30 分钟，按「距交易日收盘 24h 内」解读达标。（若按「距单笔成交 24h」则任何午夜切批对刚过零点的交易都接近 24h，属切面设计固有代价——已与需求方对齐采用前者。）
- **fx 重估 fixing 顺延 30 分钟**：每日 mark 用 ~00:30 的 fixing 而非 24:00，经济上属可接受的 mark-timing 选择。
- **补跑历史日**：当前手动触发只能用「当天 00:00」cutoff；带显式日期的补跑入口列为后续 ADVANCED。
