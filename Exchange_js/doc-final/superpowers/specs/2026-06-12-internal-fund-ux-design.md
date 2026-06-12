# InternalFund 列表/详情页 UX 对齐 Payout + Payout gas 补列 — 设计

日期：2026-06-12
状态：已确认（用户批准 + 追加 payout gas 展示）

## 背景

Payout 列表/详情页已完成打磨（per-rail 状态机 sim 面板、DetailCard 布局、source-wallet 补缺）。
InternalFund（funds-layer 执行腿）这对页面复现了 payout 改造前的全部三类问题，
且列表页比 payout 还要素。另外用户指出 Payout 虚拟币详情页没有展示 gas 使用——
摸底发现 **Payout 模型根本没有 gas 列**（只有 txHash/confirmations），需要端到端补。

## 范围

1. InternalFund 列表页（`admin-web/src/pages/funds-layer/InternalFundListPage.tsx`）
2. InternalFund 详情页（`admin-web/src/pages/funds-layer/InternalFundDetailPage.tsx`）
3. `admin-web/src/utils/fundActionMap.ts` 重写
4. funds-layer 后端：列表筛选 + detail select + REORG 转换
5. Payout：Prisma gas 列 + DTO + CONFIRM 写入 + 详情页展示

不在范围：aggregator/auto-clear 机制、legacy asset-treasury InternalFundsService 状态机、
深重组/对账域事件。

## 一、Sim 面板（权威：funds-flow.service.ts CRYPTO_TRANSITIONS / FIAT_TRANSITIONS）

状态 10 个：CREATED / SIGNING / BROADCASTED / CONFIRMING / CONFIRMED / CLEAR /
FAILED / TIMEOUT / RETURNED / CANCELLED。

### Crypto 轨（改造后）

| 状态 | 按钮 | 说明 |
|---|---|---|
| CREATED | Sign · Cancel | |
| SIGNING | Broadcast · Sign Fail · Cancel | |
| BROADCASTED | Seen in Mempool · Drop · Timeout · Cancel | |
| CONFIRMING | Confirm · **Reorg（新增）** · Fail · Timeout · Cancel | REORG→BROADCASTED，后端新增 |
| CONFIRMED | 无按钮，文案 `Auto-clears when all legs of the transfer confirm…` | CLEAR 由 autoClearConfirmedFunds 自动驱动，删手动按钮（payout 同款赛跑修复） |
| 终态（CLEAR/FAILED/TIMEOUT/RETURNED/CANCELLED） | 文案 `Terminal state — no simulatable events` | |

### Fiat 轨（改造后）

| 状态 | 按钮 | 说明 |
|---|---|---|
| CREATED | Submit · Cancel | |
| CONFIRMING | Confirm · Fail · Timeout | |
| CONFIRMED | Return（bank recall）+ 自动清算文案 | 删手动 Clear 按钮 |
| CLEAR | **Return（bank recall）** | 现状 bug：单一 FUND_TERMINAL 含 CLEAR 把该按钮永久禁用 |
| 终态（FAILED/TIMEOUT/RETURNED/CANCELLED） | 终态文案 | |

### fundActionMap.ts 重写要点

- 拆 per-rail 终态集：`CRYPTO_TERMINAL = {CLEAR, FAILED, TIMEOUT, RETURNED, CANCELLED}`，
  `FIAT_TERMINAL = {FAILED, TIMEOUT, RETURNED, CANCELLED}`（fiat CLEAR 非终态，可 RETURN）
- 删除两轨的 `CLEAR` 手动按钮（自动转换不给按钮）
- crypto 增加 `REORG`（enabledStatuses: CONFIRMING）
- 导出 `isFundSimTerminal(status, assetType)`
- 面板渲染换 payout IIFE 模式：只列 enabled 按钮；无 enabled 时给一行 amber 文案
  （CONFIRMED 给自动清算文案，终态给 Terminal 文案）；外层条件只看 `simulationModeEnabled`

### 后端：REORG

- `InternalFundAction` 枚举（asset-treasury internal-fund.dto.ts）加 `REORG = 'REORG'`（additive）
- `CRYPTO_TRANSITIONS[CONFIRMING][REORG] = BROADCASTED`（浅重组回退，对齐 payin/payout）
- FIAT_TRANSITIONS 不加（银行轨无重组）

## 二、详情页布局（对齐 PayoutDetail）

```
Hero             fundNo · Status / Amount / Type(Crypto·Fiat) / Asset(code · network)
Transfer Route   (DetailCard 2列) From Wallet(walletNo 链接→/dashboard/treasury/custodian-wallets/:id,
                 role · ownerNo) · From Address(crypto)/From IBAN(fiat) · To 同理
                 （注：InternalFund 是资金单，不存在 fee —— 不展示 Fee/Net，用户裁定）
Chain Execution  (crypto only) Tx Hash(explorerTxUrl 链接+copy) · Confirmations · Block No ·
                 Nonce · Gas Used · Effective Gas Price
Bank Transfer    (fiat only) Reference No · Provider Txn ID
Linked Transfer  (DetailCard) internalTxNo(链接) · Type · Path Label · Status badge
Status History   现有 timeline 套 DetailCard
Sidebar          Simulation Controls(新逻辑) / Identity(不变) / Lifecycle(+Sent At/Confirmed At)
```

- from/to address/iban 优先用 fund 行快照，空则回退 wallet 关联字段
- 后端 `findOneByNoForAdmin` 的 internalTransaction select 补 `type`

## 三、列表页（对齐 PayoutList）

| 项 | 设计 |
|---|---|
| 筛选 | Fund No 输入 · Tx Hash 输入 · Status 10 状态下拉 · Type(Crypto/Fiat) 下拉 · 日期范围（后端已支持） |
| 列 | Fund No · Status · Type · Asset · Amount · Tx Hash(截断) · Transfer · Created |
| 后端 | FundsQueryDto + findAllForAdmin 加 `type`（`where.asset = { type }`）；list include 删 fromWallet/toWallet 全量行（列表不用，detail 保留） |

## 四、Payout gas 补列（用户追加）

- Prisma `Payout` 模型加 `gasUsed String?`、`effectiveGasPrice String?`（命名对齐 InternalFund），migration
- `UpdatePayoutStatusDto` / `AdminUpdatePayoutStatusDto` 加可选 `gasUsed`、`effectiveGasPrice`
- `payouts.service.updateStatus`：持久化两字段（同 txHash 模式）；CRYPTO + CONFIRM 且无传入无存量时
  生成 mock 值（镜像 fiat CONFIRM 自动 `BANK-` referenceNo 的先例），如 gasUsed='21000'、
  effectiveGasPrice='3500000000'
- `PayoutDetail` Chain Details 加 `Gas Used`、`Effective Gas Price` 两个 InfoField

## 五、InternalFund mock 链上回执（用户追加）

`funds-flow.service.updateStatus`（crypto 腿、无传入且无存量时兜底，真实 adapter 传入值优先）：
- BROADCAST → 生成 mock txHash（`0x` + 64 hex）
- CONFIRM → 生成 mock gasUsed / effectiveGasPrice（同 payout 模式）

## 验收

- 全量 jest 0 failed（红→绿证据贴出）
- `npm run build`、`cd admin-web && npx tsc --noEmit` 通过
- Prisma migration 应用到 branch DB（/tmp/exchange_js_branch/dev.db）
- 重启 branch stack（3500/3501/3502/3503），curl 列表/详情页 200
- 手动动线：crypto fund 走 CONFIRMING→Reorg 回退；fiat fund CLEAR 后 Return 可点；
  payout crypto CONFIRM 后详情页可见 gas
