# 费用计提（FeeAccrual）+ 结算重设计 — 设计

日期：2026-06-15
状态：已确认（用户逐项拍板：独立 FeeAccrual 兄弟表 / 法币即时·虚拟币 EOD 双结算 / 结算分 3 类 PRINCIPAL⊥SWAP_FEE⊥WITHDRAW_FEE / Path 一致化全表改名 / crypto 建 F_FEE / FEE_COLLECT 改指 F_FEE）

## 背景与顶层设计

**核心抽象统一**：系统里只有一种东西——「**应结义务（accrual）→ 结算（settlement）**」，区别只在结算**时机**（法币即时 / 虚拟币 EOD 净额）。本金侧早已用 `Outstanding` 实现这套（每笔 swap 建 Outstanding，法币即时 close、虚拟币 EOD 净额 close，带 `settledByTransferId`/`settlementBatchId`）。本轮把**费用**也纳入同一模型：新增 **`FeeAccrual`** 作为 `Outstanding` 的**兄弟表（同生命周期形状，不同会计含义）**。

**为什么兄弟表、不塞进 Outstanding**：`Outstanding` 语义是**客户本金义务（保管账本 A，A=L 必须自洽）**；费用是**公司收入（firm 账本 B）**。同构靠平行，不靠合并——合并会糊掉「客户钱 vs 公司钱」的保管边界（CLAUDE.md 规则 4），且本金 EOD 净额 `ΣIN−ΣOUT` 口径会被费用污染。

**行业对标**：Stripe `balance_transaction.source`（指回原始订单）+ `.payout`（指向结算它的批次）；卡组织/ACH「批次头 + 明细行」。结论一致：**逐笔计提一条行，批量结算一笔转账，每条行 stamp 上"被哪笔转账/哪批结掉"**。

## 一、Path 枚举一致化全表改名

命名规则 `{CRYPTO|FIAT}_{用途}_{方向}`，两资产侧对称。`TransferPath` 终态：

| 旧名 | 新名 | from→to | mirror | 结算类别 | 变更 |
|---|---|---|---|---|---|
| `AGGREGATE` | `CRYPTO_DEPOSIT_SWEEP` | C_DEP→C_MAIN | 无 | —(充值归集) | 改名 |
| `FUND_OUT` | `CRYPTO_HOTWALLET_FUND` | C_MAIN→C_OUT | 无 | —(提现预拨) | 改名 |
| `FUND_RETURN` | `CRYPTO_HOTWALLET_RETURN` | C_OUT→C_MAIN | 无 | —(回退) | 改名 |
| `INTERNAL_OUT` | `CRYPTO_SETTLE_OUT` | C_MAIN→F_OPS | POOL_TO_FIRM | PRINCIPAL | 改名 |
| `INTERNAL_IN` | `CRYPTO_SETTLE_IN` | F_OPS→C_MAIN | FIRM_TO_POOL | PRINCIPAL | 改名 |
| `FEE_COLLECT` | `CRYPTO_WITHDRAW_FEE_COLLECT` | C_MAIN→**F_FEE** | POOL_TO_FIRM | WITHDRAW_FEE | 改名+**改指(原 F_OPS)** |
| `FIAT_SETTLE_OUT` | `FIAT_SETTLE_OUT` | C_VIBAN→F_SET→F_OPS | POOL_TO_FIRM | PRINCIPAL | 不变 |
| `FIAT_SETTLE_IN` | `FIAT_SETTLE_IN` | F_OPS→F_SET→C_VIBAN | FIRM_TO_POOL | PRINCIPAL | 不变 |
| `FIAT_FEE_COLLECT` | `FIAT_WITHDRAW_FEE_COLLECT` | C_VIBAN→F_FEE | POOL_TO_FIRM | WITHDRAW_FEE | 改名 |
| `FIAT_SPREAD_COLLECT` | `FIAT_SWAP_FEE_COLLECT` | F_OPS→F_FEE | 无 | SWAP_FEE | 改名(修误名:实际搬费+价差) |
| — | `CRYPTO_SWAP_FEE_COLLECT` | F_OPS→F_FEE | 无 | SWAP_FEE | **新增** |

- crypto 费路径 `trigger: ['EOD']`；fiat 费路径保持 `['SWAP']`/`['WITHDRAW']`（即时）。
- `CRYPTO_WITHDRAW_FEE_COLLECT` 由 `FEE_COLLECT` 改指：`to` 从 `F_OPS` 改 `F_FEE`，`trigger` 从 `['CRON']` 改 `['EOD']`，保留 `mirror: POOL_TO_FIRM`。
- **改名零行为变化**：`resolvePathPolicy/resolveRoutePolicy` 按 from/to 匹配，不依赖枚举字面量；改名只动 enum + 引用点 + spec 断言。

## 二、crypto F_FEE 钱包

`CRYPTO_SYSTEM_WALLET_ROLES` 现为 `[C_MAIN, C_OUT, F_OPS]` → **加 `F_FEE`**；开户/seed 为每个 crypto 资产 provision 一个平台 `F_FEE` 钱包。`SystemWalletResolver.resolve(assetId,'F_FEE')` 据此命中。当前 F_FEE 仅 fiat（AED），本轮补齐 crypto（USDT）。

## 三、FeeAccrual 数据模型（新表）

```prisma
model FeeAccrual {
  id                  String    @id @default(uuid())
  feeAccrualNo        String?   @unique          // 业务键 FAC...
  sourceType          String                     // SWAP | WITHDRAW
  sourceId            String                     // 订单 id
  sourceNo            String?                     // 订单号 SWP.../WD...（反查抓手）
  ownerType           String
  ownerId             String
  ownerNo             String?
  feeKind             String                     // SERVICE_FEE | SPREAD | WITHDRAW_FEE
  category            String                     // SWAP_FEE | WITHDRAW_FEE（结算类别，派生自 feeKind）
  assetId             String
  assetCode           String?
  amount              Decimal
  status              String    @default("ACCRUED")   // ACCRUED → LOCKED → SETTLED（与 Outstanding 三态一致：accrue→锁批起转账→leg CLEAR 时结清）
  settledByTransferId String?                    // FK internal_transactions（结算它的那笔转账）
  settlementBatchId   String?                    // FK settlement_batches（FEE 类别批）
  closedAt            DateTime?
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@unique([sourceType, sourceId, feeKind])      // 幂等：同单同 kind 不重复计提
  @@index([status]) @@index([sourceType, sourceId]) @@index([assetId]) @@index([settlementBatchId])
}
```

- 一笔 **swap** 产 2 条 accrual：`SERVICE_FEE`(category=SWAP_FEE) + `SPREAD`(category=SWAP_FEE)。
- 一笔 **withdraw** 产 1 条 accrual：`WITHDRAW_FEE`(category=WITHDRAW_FEE)。
- 金额口径来自订单：swap.`feeAmount`/`spreadAmount`；withdraw.`feeAmount`。

## 四、结算分类（settlement_batches 加 category）

`settlement_batches` 新增：
```
category               String @default("PRINCIPAL")  // PRINCIPAL | SWAP_FEE | WITHDRAW_FEE
totalFeeAccrualCount   Int    @default(0)
settledFeeAccrualCount Int    @default(0)
```

**为什么 3 类、按"过界性质"分而非"叫不叫费"**（代码实锤 `funds-accounting.service.ts`）：

| 类别 | 路径 | mirror | CLEAR 时 TB 记什么 | 性质 |
|---|---|---|---|---|
| `PRINCIPAL` | 池↔F_OPS | 有 | `SETTLE_POOL_TO_FIRM`/`SETTLE_FIRM_TO_POOL` | 客户本金过界 |
| `WITHDRAW_FEE` | 池→F_FEE | **有(POOL_TO_FIRM)** | **`FEE_DECOMMINGLE`**（从客户保管池去混同） | 客户钱过界，受 safeguarding 约束 |
| `SWAP_FEE` | F_OPS→F_FEE | **无** | **零分录**（`tbApplied:false`，收入早在 swap 时点已记 FEE_INCOME） | 公司内部现金重分类 |

合批会破坏 4 个下游闭环：① 对账（batch 总额 ≠ TB 足迹）② safeguarding 报告（de-comingle 移动须可干净枚举）③ 失败域耦合（池侧依赖 vs 公司内部）④ batch 级 TB 不变量丢失。故 **3 类各自独立成批**。

## 五、数据流：计提 + 结算（FeeAccrualService）

新增 `FeeAccrualService`（funds-layer/domain），统一两条轨：

- `accrueForSwap(swapId, tx)` → 建 SERVICE_FEE + SPREAD accrual（费/价差 >0 才建；幂等）。
- `accrueForWithdraw(withdrawId, tx)` → 建 WITHDRAW_FEE accrual。
- `settle(accruals[], category, settlementType, tx)` → 按 (asset, category) 分组，每组建 1 个 `settlement_batch(category)` + **1 笔净额转账**(`pathLabel` 对应类别) + leg；accrual 在该 leg **CLEAR 时** close（`status=SETTLED, settledByTransferId, settlementBatchId, closedAt`）——与 Outstanding 在 CLEAR 时 close 一致。

**触发与时机**（`accrue` 都在订单 success 事件；差别只在 `settle` 时机）：

| 轨 | 触发 | accrue | settle |
|---|---|---|---|
| **法币 swap** | `SWAP_SUCCEEDED`(FIAT) | SERVICE_FEE+SPREAD | **即时**：SWAP_FEE 批(F_OPS→F_FEE) |
| **法币 withdraw** | `WITHDRAWAL_SUCCESS`(FIAT) | WITHDRAW_FEE | **即时**：WITHDRAW_FEE 批(C_VIBAN→F_FEE) |
| **虚拟币 swap** | `SWAP_SUCCEEDED`(CRYPTO) | SERVICE_FEE+SPREAD | **EOD**：开放 accrual 净额 SWAP_FEE 批(F_OPS→F_FEE) |
| **虚拟币 withdraw** | `WITHDRAWAL_SUCCESS`(CRYPTO) | WITHDRAW_FEE | **EOD**：开放 accrual 净额 WITHDRAW_FEE 批(C_MAIN→F_FEE) |

- **法币**：`accrue` 后立刻 `settle`（替代现有 `FiatFeeCollectionWorkflowService` 的逐单 spawnCollect；该服务被 `FeeAccrualService` 吸收/改造）。法币 swap 的费+价差 2 条 accrual → 同 1 个 SWAP_FEE 批、1 笔净额转账(费+价差合计)关闭。
- **虚拟币**：`accrue` 后留 `ACCRUED`；`eod-settlement-workflow` 在本金净额之后追加 fee pass：每资产查开放 crypto accrual → 按 category 各 1 笔净额转账 → 关闭。
- **幂等**：accrual `@@unique` + EOD 只捞 `status=ACCRUED` → 重跑不重收。

## 六、可追溯：统一出口

`getFeeCollectionStatus(orderNo)` → `{ collected: boolean, items: [{ feeKind, category, status, settledByTransferNo, settlementBatchNo }] }`，**两条轨同一查询**（按 `FeeAccrual.sourceNo`）。法币虚拟币、swap/withdraw 都从这里答"哪笔费、哪个组件、结了没、被哪笔/哪批结的"。

## 七、TB 记账影响（funds-accounting.service.ts）

`isFeePath` 判定从旧名改为两条 WITHDRAW_FEE 路径：
```
isFeePath = pathLabel === CRYPTO_WITHDRAW_FEE_COLLECT || pathLabel === FIAT_WITHDRAW_FEE_COLLECT
```
SWAP_FEE 两路径无 mirror → `tbApplied:false`，本就不进 isFeePath 分支。**不改 TB 记账方向/口径**，仅同步枚举名。

## 八、对账不变量（verify 脚本断言）

1. `PRINCIPAL batch 总额 == 本金净额 == TB SETTLE_* 总额`（不变，仅加 category 维度）。
2. `WITHDRAW_FEE batch 总额 == Σ WITHDRAW_FEE accrual == TB FEE_DECOMMINGLE 总额`。
3. `SWAP_FEE batch 总额 == Σ (SERVICE_FEE+SPREAD) accrual`，TB 零分录。
4. `F_FEE(asset) 余额 == Σ SETTLED accrual(该 asset)`（两币种都成立，含 crypto F_FEE）。
5. 每条 SETTLED accrual 必有 `settledByTransferId` 且其 leg=CLEAR。

## 九、影响面与分解（W1→W2→W3 串行 TDD）

- **W1 Path 一致化改名**（机械、面广）：enum + whitelist 11 项（含 FEE_COLLECT 改指 + 新增 CRYPTO_SWAP_FEE_COLLECT）+ `isFeePath` + 全部 `.spec` 路径断言 + 代码内 `TransferPath.X` 引用。可独立 agent 机械扫，全量 jest 兜底证零行为变化。
- **W2 crypto F_FEE 钱包**：role 常量 + seed/provisioning + resolver 命中测试。
- **W3 FeeAccrual + 双结算 + 分批 + 可追溯**：
  - schema：新表 `fee_accruals` + `settlement_batches.category`/费计数 + prisma migrate（**禁用 dev:rebuild**，用 migrate dev 针对 branch DB）。
  - `FeeAccrualService`：accrue/settle，吸收改造 `FiatFeeCollectionWorkflowService`。
  - `eod-settlement-workflow`：本金后追加 SWAP_FEE/WITHDRAW_FEE fee pass。
  - `getFeeCollectionStatus` 统一出口。
  - verify-two-book 加 §八对账断言。

## 十、非目标（明确不做）

- 不改 TB 收入确认时机（FEE_INCOME/SPREAD_INCOME 仍在 swap/withdraw 时点记）。
- 不改本金 Outstanding 净额逻辑（仅给 batch 标 `category=PRINCIPAL`）。
- 不引入余额校验/重试转账（延续 mock-balance「一步步来」）。
- 不把费并入本金转账（早前已否决）。
- 前端展示（FeeAccrual 列表/详情页）不在本轮，留后续 UX 轮。

## 验收

`npx jest` 0 failed + `npm run build` + admin `tsc --noEmit` + 重启 branch 栈(3500-3503，无 DI 环) + 重跑 10 客户 sim：crypto F_FEE(USDT) 入账、§八 5 条对账全平、`getFeeCollectionStatus` 两轨可答。
