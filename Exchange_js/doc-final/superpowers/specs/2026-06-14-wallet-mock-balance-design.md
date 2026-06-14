# 钱包 mockBalance 余额变更 — 设计

日期：2026-06-14
状态：已确认（用户批准；时点=物理 CLEAR、C_CMA=读时派生）

## 背景

`Wallet.mockBalance Decimal @default(0)` 当前**只读不写**——仅在 `wallet-query.service` 暴露成
`balance`、admin 钱包详情展示，全仓无任何写入，余额恒为 seed 值。本轮让它随资金移动而变化。

定位：纯 **mock 余额账**，不校验、允许负数、暂不引入重试/回调机制（一步步来）。不碰 TB 记账。

## 统一机制

新增 `WalletBalanceService`（asset-treasury/wallets）：
```
adjust(walletId: string, delta: Prisma.Decimal, tx: Prisma.TransactionClient): Promise<void>
  → wallet.update({ where:{id}, data:{ mockBalance: { increment: delta } } })
```
- 无余额校验、允许结果为负。
- 必须传入 `tx`（在调用方现有的状态机事务内执行，保证原子 + 一次）。
- walletId 为 null/缺失时 no-op（安全）。

## 变更点（全部 inline 在状态机终态转换事务内）

| 触点 | 落点 | 动作 | 金额 |
|---|---|---|---|
| 充值 | `payins.service.updateStatus`，nextStatus = CLEARED | `adjust(payin.toWalletId, +amount)` | payin.amount |
| payout | `payouts.service.updateStatus`，nextStatus = CLEARED | 解析来源钱包(crypto C_OUT / fiat C_VIBAN，复用 `resolveSourceWallet` 取 walletId) → `adjust(srcWalletId, −amount)` | payout.amount |
| internalfund | `funds-flow.service.updateStatus` nextStatus=CLEAR **且** `autoClearConfirmedFunds` 自动清算 | `adjust(fromWalletId, −amount)` + `adjust(toWalletId, +amount)` | internalFund.amount |

说明：
- payout 无 `fromWalletId`，须按角色解析来源钱包（已存在 `resolveSourceWallet(type, assetId, ownerId)`，
  改造为可返回 walletId 或新增一个取 wallet 的内部查找）。来源是外部，无内部 to-wallet。
- internalfund 的 CLEAR 有两条路径（手动 updateStatus + autoClearConfirmedFunds），**两条都挂**。
- 虚拟币侧无独立逻辑：同一套 adjust 落在各腿 from/to（充值落 C_DEP；归集 C_DEP→C_MAIN 一扣一加；
  payout 扣 C_OUT），允许负。

## C_CMA = Σ C_VIBAN（读时派生）

`wallet-query.service`：当 `wallet.walletRole === 'C_CMA'` 时，返回的 `balance` 不取自身 mockBalance，
而是现算 = 该资产所有 `walletRole==='C_VIBAN'` 钱包的 `mockBalance` 之和（list + detail 两处）。
- C_CMA 自身 mockBalance 不写（恒 0）。
- 永远与 VIBAN 一致、零漂移、无额外写。

## 边界（用户已认可）

- payout / internalfund 中途 FAIL / DROP / TIMEOUT → **不回调余额**（无重试机制）。
- 余额仅在终态 CLEAR/CLEARED 一次性变更；中间态不反映在途资金。
- mockBalance 可为负（不校验）。

## 验收

- 单测（TDD red→green）：
  - `WalletBalanceService.adjust` increment / 允许负 / null no-op。
  - payin CLEARED → toWallet +amount（mock prisma 断言 increment）。
  - payout CLEARED → 来源钱包 −amount。
  - internalfund CLEAR（手动 + 自动）→ from −、to +。
  - wallet-query：C_CMA 读 = Σ VIBAN；C_VIBAN/其他读自身 mockBalance。
- 全量 `npx jest` 0 failed + `npm run build` + `admin tsc`（balance 字段链路不变，前端无需改）。
- 重启 branch stack；可选手动动线：模拟一笔充值→VIBAN 余额涨、CMA 汇总涨。

## 不在范围

- 余额校验 / 转账失败回滚 / 重试机制（明确推迟）。
- TB 记账联动（mockBalance 与 TB 独立）。
- 历史回填（现有单据不追溯改余额）。
