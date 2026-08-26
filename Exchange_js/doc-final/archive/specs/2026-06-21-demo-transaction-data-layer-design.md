# 演示交易数据层 — 设计 (Transaction-Data Layer)

> 状态：设计 / 待实现
> 日期：2026-06-21
> 范围：**仅交易数据层**。对账 demo（external 生成 / manifest / 注入-vs-检出 UI）本轮**不做**，留后续（见 §9）。
> 目标读者：实现者 + 复核者

---

## 0. 一句话定义

一组**独立、幂等、走真实工作流**的 CLI 脚本，为复用的 business-seed 客户快速产出一整天的充值/兑换/提现订单 + 资金单；跑完后系统处于「**法币结算完成、虚拟币等待结算**」的确定终态，且 **`TRADE_CLEARING(AED)` 与 `TRADE_CLEARING(USDT)` 均非零**（桥未清）。

脚本只是"加速器"：同样的订单你也可以在 admin UI 手动建。脚本不绕过任何工作流——所有状态推进都是调用真实 service 方法（模拟点击），与手动操作产生的数据无差别。

---

## 1. 为什么这样做（底层逻辑）

- **真实工作流驱动**：已验证模式见 `scripts/sim-e2e-demo.ts` / `scripts/verify-two-book.ts`——通过 `PayinsService` / `DepositWorkflowService` / `SwapWorkflowService` / `FundsFlowService` / `WithdrawTransactionsService` / `PayoutsService` 把订单逐状态推进。本设计**提取并拆分**其驱动序列为按阶段独立的脚本，不新造工作流。
- **`TRADE_CLEARING` 何时清**（已用代码核实）：
  - 兑换成交时两个币种的桥都被写入：`SWAP_POST_FROM`（`CLIENT_PAYABLE→TRADE_CLEARING`，from 币）+ `SWAP_POST_TO`（`TRADE_CLEARING→CLIENT_PAYABLE`，to 币 gross）+ `SWAP_POST_SPREAD`（`TRADE_CLEARING→SPREAD_INCOME`）。见 `src/modules/trading/swap-transactions/swap-workflow.service.ts`。
  - 桥**只在 EOD 清桥**时被扫平：`TRADE_CLEARING ↔ FX_POSITION`（`BRIDGE_SWEEP_OUT/IN`）。见 `src/modules/funds-layer/accounting/fx-eod.service.ts`。常量注释亦载明 `TRADE_CLEARING: 110 // swap 桥(双向,EOD 清入 FX_POSITION)`。
  - **法币腿结算不碰桥**（mirror 客户池↔`FIRM_TREASURY`）。
  - ∴ **跳过 EOD ⇒ 两个币种的 `TRADE_CLEARING` 自然留存**。
- **背景 cron 警示**：`src/modules/funds-layer/sweep/eod-settlement-sweep.service.ts` 有 `@Cron('0 30 0 * * *', Asia/Dubai)` → `runEodSettlement('CRON')`，每天 00:30（迪拜）自动结算虚拟币 + 清桥。本层**不修改**该生产代码（见 §7 决策）。

---

## 2. 范围

### In（本轮做）
- 5 个脚本：`demo:setup` / `demo:deposit` / `demo:swap` / `demo:withdraw` / `demo:all`
- 复用 business-seed 可交易客户子集（Alice / Bob / Grace）
- 确定性固定金额（非随机），保证终态可复现 + `TRADE_CLEARING` 非零可断言
- 终态契约 + 验收断言（§6）

### Out（本轮不做）
- 任何对账逻辑：external 对账单生成、break manifest、注入-vs-检出对比、recon run/case/UI
- schema 变更（本层**零** Prisma 迁移）
- 修改任何生产 service / sweep / cron

### 不变（不可违反）
- 不绕过工作流：所有订单状态推进经 domain/workflow service 方法。
- 不修改 business-seed 客户的 compliance 状态（Carol/Dave/Eve/Frank 的 frozen/pending/new/high-risk 是合规演示资产，保留）。
- 不写死业务日 `2026-06-16`、不依赖 `REF-SEED5` 锚点。

---

## 3. 客户集

复用 `prisma/seed.ts --mode=business` 已建客户中**可交易**的子集（`onboardingStatus=APPROVED` 且 `complianceStatus=CLEAR`）：

| 客户 | email | 说明 |
|---|---|---|
| Alice Happy | demo_alice@example.com | 可交易 |
| Bob Happy | demo_bob@example.com | 可交易 |
| Grace Premium | demo_grace@example.com | 可交易 |

> Carol(Frozen) / Dave(Pending) / Eve(New) / Frank(HighRisk) / Henry(Corporate) **排除**——它们的状态用于演示被阻断流程，不得改动。
> 手动建单与脚本建单落在同一批客户上，契合"脚本只是加速器"。
> 若日后需要更多体量，再切换到独立 cohort（本轮不做）。

---

## 4. 脚本设计

所有脚本：`NestFactory.createApplicationContext(AppModule)` 起一个上下文，取真实 service，跑完 `app.close()`。Node18 polyfill（`crypto.randomUUID`）置于所有 import 之前（参照现有脚本）。所有标识用确定性生成（`buildDeterministicNo` / 固定 ref），**不含 `Date.now()`**，保证可复现。

### 4.1 `demo:setup`
**职责**：确保 3 个可交易客户具备交易前置（幂等）。
- 校验客户存在且可交易（APPROVED + CLEAR），否则报错列出缺失项。
- 每客户 upsert：`C_DEP`（USDT 充值地址钱包）+ `C_VIBAN`（AED 法币钱包），`walletNo` 用 `buildDeterministicNo('WA','DEMO',role,customerNo)`，地址/IBAN 由 walletNo hash 确定性派生。
- 每客户每资产（USDT/AED）确保 TB 账户 `CLIENT_PAYABLE` + `DEPOSIT_SUSPENSE`：`ensureTbAccountRegistry` 写注册表 → `provisionTbAccounts` 推入 TigerBeetle（复用 `prisma/seed-tb.helper.ts`）。
- **费率前置**（数据完整性，使 `FEE_INCOME`/`SPREAD_INCOME` 真实产生）：把 demo 用到的费率档调成非零（`swapFeeLevel` STD-USDT-AED / STD-AED-USDT 的 `SWAP_SERVICE_FEE`；`withdrawalFeeLevel` STD-AED-FIAT / STD-USDT-TRON 的 `WITHDRAW_SERVICE_FEE`），写法同 `sim-e2e-demo.ts` 的 `bumpFee`（改 tiersJson + 重算 configHash）。
- **幂等**：钱包/TB 账户 upsert；费率为设定目标值（重跑等效）。

### 4.2 `demo:deposit`
**职责**：每客户 1 笔 USDT 虚拟币 + 1 笔 AED 法币充值 → `SUCCESS`。
- 固定金额：USDT `3000`、AED `8000`（充裕，给后续兑换/提现留余量）。
- 驱动序列（复用 `sim-e2e-demo.ts` `driveDeposit`）：
  - `PayinsService.createDetected({ assetId, toWalletId, type, amount, txHash?(0xDEMO<idx>USDT), fromIban?, referenceNo: REF-DEMO-<idx>-<ccy> })` → 工作流自动建 Deposit。
  - 虚拟币：`PayinAction.BLOCK` → `CONFIRM`；法币：`CONFIRM`。→ payin `CLEARED`（mockBalance credit）、deposit 进 `COMPLIANCE_PENDING`（TB STEP_1）。
  - `DepositWorkflowService.applyKytResult(depId,'PASSED',5)`；虚拟币再 `applyTrResult(depId,'PASSED')` → 自动 STEP_2（`CLIENT_PAYABLE` credit）→ deposit `SUCCESS`。
- **幂等**：若该钱包已存在 `CLEARED` payin 则跳过。

### 4.3 `demo:swap`
**职责**：每客户 1 笔兑换；法币腿驱动到 `CLEAR`，**不跑虚拟币 EOD**。
- 固定金额 + 方向（**刻意非对称**以保证 `TRADE_CLEARING(AED)` 净额清晰非零）：

  | 客户 | 方向 | from 金额 |
  |---|---|---|
  | Alice | USDT→AED | 1000 USDT |
  | Bob | USDT→AED | 800 USDT |
  | Grace | AED→USDT | 500 AED |

- 驱动序列（复用 `sim-e2e-demo.ts` TASK 3 + 法币腿驱动）：
  - `SwapQuoteService.createQuote(...)` → `SwapWorkflowService.executeSwap(customerId, quoteId)`（建 Swap、TB 三腿、`Outstanding` IN+OUT、spawn `FIAT_SETTLEMENT` 内部交易=2 跳 internal_fund）。
  - 驱动法币腿：`driveFiatLeg(hop1)`（SUBMIT→CONFIRM）→ hop2 自动 SUBMIT → 等 hop2 `CONFIRMING` → `CONFIRM hop2` → 法币腿 `CLEAR`、镜像入 `CLIENT_BANK`/`FIRM_TREASURY`、fiat `Outstanding=SETTLED`。
- **明确不调用** `EodSettlementWorkflowService.runEodSettlement`：虚拟币 `Outstanding` 留 `OPEN`，两个 `TRADE_CLEARING` 桥留存。
- **法币 swap 费结算**：兑换成功事件自动 accrue + settle 法币 swap 费/点差（spawn `SWAP_FEE_SETTLEMENT`，accrual `LOCKED`）；脚本随后驱动该法币腿到 `CLEAR` → accrual `SETTLED` 并归集入 `F_FEE`。虚拟币 swap 费 accrual 保持 `ACCRUED`（属被跳过的 EOD）。
- **桥非零的保证（rate-immune）**：2 笔 USDT→AED（借记 AED 桥 ≈ gross+spread）对 1 笔较小 AED→USDT（贷记 AED 桥 = 500），方向/金额非对称 ⇒ `TRADE_CLEARING(AED)` 净额清晰为负且非零；`TRADE_CLEARING(USDT)` 净额清晰为正且非零。断言只校验**符号 + 非零**，不校验随汇率漂移的精确值。
- **幂等**：若该客户已有 `SUCCESS` 的 demo swap 则跳过。

### 4.4 `demo:withdraw`
**职责**：每客户在其持仓资产上提现 → `SUCCESS`、payout `CLEARED`。
- 兑换后持仓：Alice/Bob 持 AED（USDT→AED 所得）、Grace 持 USDT（AED→USDT 所得）；另各有充值余量。固定金额：
  - 每客户 1 笔法币 AED 提现 `100 AED`；
  - Alice/Bob 各再 1 笔虚拟币 USDT 提现 `50 USDT`。
- 驱动序列（复用 `sim-e2e-demo.ts` `driveWithdraw`）：
  - `WithdrawQuoteService.createQuote(...)` → `WithdrawTransactionsService.create(...)`（TB pending 锁额）。
  - `updateKytStatus(id,'PASSED',...)`；虚拟币再 `updateTravelRuleStatus(id,'PASSED')` → `PAYOUT_PENDING` + payoutId。
  - 驱动 payout 到 `CLEARED`：法币 `SUBMIT→CONFIRM→CLEAR`；虚拟币 `SIGN→BROADCAST→SEEN_IN_MEMPOOL→CONFIRM→CLEAR`（`CLEAR` 须以 `operatorId='SYSTEM'`）→ withdraw `SUCCESS`、fee collection spawn。
- **法币 withdraw 费结算**：法币提现成功事件自动 accrue + settle（spawn `WITHDRAW_FEE_SETTLEMENT`，accrual `LOCKED`）；脚本随后驱动该腿到 `CLEAR` → accrual `SETTLED`。虚拟币提现费 accrual 保持 `ACCRUED`（属被跳过的 EOD）。
- **幂等**：若该客户已有同资产 `SUCCESS` 的 demo withdraw 则跳过；法币费腿仅驱动未 `CLEAR` 的，重跑安全。

### 4.5 `demo:all`
**职责**：编排 + 验收。
- 顺序：`setup → deposit → swap → withdraw`（每步即上面的脚本逻辑；各步仍可单独跑）。
- **不自动 reset**：假定已在干净的 business seed 上（推荐先 `npm run dev:reset`）；脚本幂等可叠加重跑。
- 末尾打印两本账余额表（仿 `verify-two-book.ts` 的 `console.table`）+ 运行 §6 验收断言；任一断言失败则非零退出。

---

## 5. npm 脚本命名

```
demo:setup      ts-node -r tsconfig-paths/register scripts/demo-setup.ts
demo:deposit    ts-node -r tsconfig-paths/register scripts/demo-deposit.ts
demo:swap       ts-node -r tsconfig-paths/register scripts/demo-swap.ts
demo:withdraw   ts-node -r tsconfig-paths/register scripts/demo-withdraw.ts
demo:all        ts-node -r tsconfig-paths/register scripts/demo-all.ts
```
> 与现有 `recon:*` 命名空间分离（数据层 ≠ 对账）。各脚本设 `DATABASE_URL=file:/tmp/exchange_js_branch/dev.db`、`TB_ADDRESS=127.0.0.1:3503`（branch 栈），同现有 recon 脚本写法。

---

## 6. 终态契约 + 验收断言

`demo:all` 跑完（订单全 SUCCESS）后必须满足：

1. **订单终态**：3 客户的 Deposit / Swap / Withdraw 交易均 `SUCCESS`；对应 Payin / Payout 均 `CLEARED`。
2. **桥非零（核心要求）**：`creditNet(TRADE_CLEARING, AED) ≠ 0` **且** `creditNet(TRADE_CLEARING, USDT) ≠ 0`（按 §4.3 非对称设计，AED 桥应为负、USDT 桥应为正）。
3. **虚拟币待结算**：存在 `status=OPEN` 的虚拟币（USDT）`Outstanding`。
4. **法币已结算**：法币（AED）`Outstanding` 全 `SETTLED`。
5. **法币费已结算**：demo 客户的 AED `FeeAccrual` 全 `SETTLED`（swap 费+点差 & 提现费）；虚拟币 `FeeAccrual` 保持 pending（其结算属被跳过的 EOD）。
6. **EOD 未跑**：不存在本次 demo 触发的 `EOD_SETTLEMENT` 批次。

> 断言用关系式/符号判断，避免依赖随 Binance 汇率漂移的精确数值（参照 `verify-two-book.ts`）。

---

## 7. 关键决策记录

- **EOD cron 不碰生产代码**（用户拍板）：交易数据层保持纯脚本、真正独立，不给 `eod-settlement-sweep.service.ts` 加任何 demo 开关。终态有效期到下一个 00:30（迪拜）EOD cron；演示前重跑 `demo:all` 即可恢复。`demo:all` 断言 `TRADE_CLEARING(AED)≠0`，被扫掉会立刻断言失败、不会"静默错误"。
- **客户复用 business seed**（用户拍板）：手动 + 脚本订单共用同一批客户。
- **manifest 存储**（已定，留给对账轮用）：`ReconciliationRun.demoManifest String?`——本轮不实现。

---

## 8. 文件计划

**新增**
- `scripts/demo-setup.ts`
- `scripts/demo-deposit.ts`
- `scripts/demo-swap.ts`
- `scripts/demo-withdraw.ts`
- `scripts/demo-all.ts`

**改动**
- `package.json`：加 5 条 `demo:*` 脚本。

**复用（不改，仅参照/导入其 service 与 helper）**
- `scripts/sim-e2e-demo.ts`（驱动序列范本）、`scripts/verify-two-book.ts`（断言/余额表范本）
- `prisma/seed-tb.helper.ts`（`ensureTbAccountRegistry` / `provisionTbAccounts`）
- 各 domain/workflow service（Payins / Deposit / Swap / FundsFlow / Withdraw / Payouts）

> 共享驱动器（`driveFiatLeg` / `driveCryptoLeg` / `driveDeposit` / `driveWithdraw`）可抽到 `scripts/demo-lib.ts` 供 5 个脚本复用，避免复制粘贴（实现计划阶段定）。

---

## 9. 后续（本轮不做，仅留指针）

对账 demo（在本数据层之上）：`recon:demo --mode=pass|break` 从真实资金单去锚点合成 external 两表、写 break manifest、跑引擎 APPLY；admin 只读「注入 vs 检出」对比页。设计要点已在对话中对齐，待交易数据层落地后另起一轮 spec。

---

## 10. 实现状态（2026-06-21）

✅ 已实现并验收。
- 文件：`scripts/demo-lib.ts`（共享驱动器 + 4 stage + verify）、`scripts/demo-{setup,deposit,swap,withdraw,all}.ts`、`package.json` 加 `demo:*` 5 条命令。
- 验收：`npm run demo:all` 全绿 **9/9 断言 PASS**（Alice/Bob/Grace）：
  - deposits 6/6 SUCCESS · swaps 3/3 SUCCESS · withdrawals 5/5 SUCCESS · payouts 5/5 CLEARED
  - `TRADE_CLEARING(AED)` credit-net = −611050（−6110.50 AED，负且非零，符合 §4.3 非对称设计）
  - `TRADE_CLEARING(USDT)` credit-net = 1663852961（+1663.85 USDT，正且非零）
  - crypto(USDT) Outstanding OPEN=3 · fiat(AED) Outstanding 全 SETTLED
  - **fiat(AED) FeeAccruals 全 SETTLED 7/7**（swap 费+点差驱 `SWAP_FEE_SETTLEMENT` 2 腿、提现费驱 `WITHDRAW_FEE_SETTLEMENT` 3 腿）；crypto(USDT) FeeAccrual pending=4（保留给被跳过的 EOD）
- 幂等已验证：重跑计数不翻倍（deposits 仍 6、swaps 仍 3、withdrawals 仍 5）；法币费腿仅驱未 `CLEAR` 的，重跑安全。
- `demo-lib.ts` 新增 `settleFiatFees()`：runSwaps 末驱 `SWAP_FEE_SETTLEMENT`、runWithdraws 末驱 `WITHDRAW_FEE_SETTLEMENT`（均 AED + 按 demo 客户作用域，轮询应对事件驱动延迟）。
- 实现备注：`driveWithdraw` 加了 P2002(withdrawNo) 重试——`generateReferenceNo('WD')`（`src/common/utils/no-generator.util.ts`）仅 4 位随机，同日命名空间拥挤会撞号。**这是生产侧弱点**（真实提现繁忙日也可能撞号失败），已单独标记，不在本层修复。
- 验收在「带历史数据」的当前 branch DB 上跑通；pristine 数值需先跑干净 business seed（branch-scoped；注意 `dev:reset`/`dev:rebuild` 是 **main-scoped**，勿用）。
