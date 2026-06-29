# Demo 数据完整性 + 跨表 Invariant 守护

**日期**：2026-06-29
**作者**：codex
**状态**：approved — 用户确认 v0 设计，5 个抓手全开

---

## 背景

在 Alice (CU2601019430) 的 AED 充值地址（C_VIBAN, walletNo=WA2601011857）做对账复核时发现：

| 数据来源 | Alice AED 钱包净值 |
|---|---|
| TigerBeetle 真实余额（PAYABLE+SUSPENSE） | **1,153,047 AED** |
| `account_flows` 按 walletRef 汇总 | 1,163,047 AED |
| demo `external_balance.closingBalance`（借的 balanceChecker） | 1,163,047 AED |

**差 10,000 AED** = Alice 真实做过 1 笔 AED 提现（externalRef=`BANK-PO2606299998`，sourceNo=`WD2606291492`，9,800 NET + 200 FEE），但**钱包级账本完全没体现**。

继续 dive 三表 from/to 字段完整性：

| 模型 | from/to 字段状况 |
|---|---|
| Payin (6 笔) | ✓ 都完整 |
| Payout (5 笔) | ⚠️ `referenceNo` / `txHash` CLEARED 状态下没回填；**Payout 表本身没有 `fromWalletId` 字段，source 钱包只能通过 `withdraw_transactions.fromWalletId` 追溯** |
| **InternalFund (17 笔)** | **❌ 12 笔 SWAP 关联的 `fromWalletId` / `toWalletId` 全空（70%）** |
| **WithdrawTransaction (5 笔)** | **❌ 3 笔 FIAT 提现 `fromWalletId` 全部错挂 Platform C_CMA（WA2601018410），不是客户的 C_VIBAN** |

**最关键的反直觉发现**——`account_flows.walletRef` 写入路径与 `InternalFund.from/to` **互相独立**：

| 业务 | InternalFund 完整度 | account_flows.walletRef | 结论 |
|---|---|---|---|
| SWAP | ❌ NULL | ✓ 客户 C_VIBAN | SWAP 走的不是 from/to 链路 |
| WITHDRAW | ✓ 客户 C_VIBAN | ❌ 写到 Platform C_CMA | WITHDRAW projection 链路错位 |

两条独立写入路径都有缺陷，导致钱包级账本和真实 TB 状态漂移，进一步污染 demo external mirror、客户余额展示、对账引擎结果。

---

## 目标

1. **修生产代码 root cause**——swap workflow 创建 InternalFund 时 from/to 应该正确填充；withdraw / AccountFlowProjector 写 `account_flows.walletRef` 时归属应该对得上 tbAccountId 的 ownerUuid；payout completion 应该回填 referenceNo / txHash。
2. **加 runtime invariant 守护**——R1/R2/R3 三条规则，service 层 throw + verify 工具扫描，让任何同类 bug 不再悄悄落库。
3. **修补现有种子数据**——通过重跑种子 + invariant 自动校验，让 `db:seed:business` 出来的数据天然干净。
4. **对账闭环保持绿**——`verify:coa`、`recon:demo:pass`、`recon:demo:break` 三个端到端验证全部仍然 PASS。

---

## Invariant 规则定义

### R1 — InternalFund 入库时 from/to 必填（按腿类型）

```
客户腿 (eventCode 含 _CLIENT 或 _FEE_CLIENT):
  必填: from 或 to 之一 = 客户钱包 ID（对应该客户的 C_VIBAN / C_DEP）
  另一侧允许 NULL (因为对侧可能是 omnibus aggregate, 无 Wallet 行)

公司腿 (eventCode 含 _FIRM / _OPS_TO_* / _SET_TO_*):
  必填: from + to 都是 firm wallet ID (F_OPS / F_SET / F_FEE / F_LIQ)

omnibus 纯内部腿:
  允许 from + to 都 NULL
  (例: CLIENT_ASSET ↔ DEPOSIT_SUSPENSE 这种，两侧都没 Wallet 行)
```

**违反 → service 层 throw `InvalidInternalFundError`**。

### R2 — account_flows.walletRef 必须可解析 + owner 一致

```
对 account_flows 每一行：
  walletRef 必须能 join 到 wallets 表（不能孤儿）
  wallets.ownerNo / ownerUuid 必须 == tb_account_registry.ownerUuid
    （按 tbAccountId 反查）
  例外：tbAccountId 是 aggregate 账户 (CLIENT_ASSET=1, FIRM_ASSET=50)
    时 walletRef 可以是任一在该 ledger 上活跃的 wallet
    （aggregate 不归属单一客户，但要在合理范围内）
```

**违反 → AccountFlowProjector 写出前 throw `WalletRefMismatchError`**。

### R3 — Payout / Payin CLEARED 时 reference + txHash 必填

```
Payout.status == 'CLEARED' 时:
  referenceNo 必填 (FIAT: BANK-PO 号; CRYPTO: 同 txHash)
  txHash 必填 (CRYPTO 类型时)

Payin.status == 'CLEARED' 时:
  referenceNo 必填
  txHash 必填 (CRYPTO 类型时)
```

**违反 → payment service throw `PayoutFinalizationIncompleteError`**。

### R4 — Payout/Withdraw 的 source 钱包必须是客户自有钱包

```
withdraw_transactions.fromWalletId 必填，且：
  FIAT 提现 (Payout.type='FIAT' OR asset.code='AED'):
    fromWalletId 必须是 wallets.walletRole='C_VIBAN' 且 ownerNo=客户的钱包
  CRYPTO 提现 (Payout.type='CRYPTO' OR asset 是加密币种):
    fromWalletId 必须是 wallets.walletRole='C_DEP' 且 ownerNo=客户的钱包

→ 不能挂到 Platform C_CMA、firm F_*、或任何其他客户的钱包
```

类似的 source/target 约束：

```
payins.toWalletId 必填，且:
  FIAT  → 必须是该客户 C_VIBAN
  CRYPTO → 必须是该客户 C_DEP
```

**违反 → withdraw workflow / payin handler throw `IllegalSourceWalletError`**。

**当前数据违反情况（用户口径："payout 一定要是 C_VIBAN 和 C_DEP"）**：

| withdrawNo | 客户 | type | fromWalletId 当前 | 期望 |
|---|---|---|---|---|
| WD2606291492 | CU2601019430 | FIAT (AED) | Platform C_CMA ❌ | 客户 C_VIBAN |
| WD2606296856 | CU2601017625 | FIAT (AED) | Platform C_CMA ❌ | 客户 C_VIBAN |
| WD2606294475 | CU2601014381 | FIAT (AED) | Platform C_CMA ❌ | 客户 C_VIBAN |
| WD2606292736 | CU2601019430 | CRYPTO (USDT) | 客户 C_DEP ✓ | — |
| WD2606293180 | CU2601017625 | CRYPTO (USDT) | 客户 C_DEP ✓ | — |

→ **FIAT 提现 3/3 全部错位**（withdraw workflow 在写 FIAT 提现的 fromWalletId 时走了错误的分支）。CRYPTO 提现 2/2 正确。

---

## 5 个抓手

### 抓手 1 — swap workflow 创建 InternalFund 时填 from/to + R1 throw

**改动文件**（待 P7 dive 确认）：
- `src/modules/trading/swap-transactions/swap-workflow.service.ts` 或同模块
- 单测：每种 swap event 的 IF from/to 正确填入

**规则**：
- `SWAP_SELL_CLIENT` → from=客户卖出币种钱包；to=客户 FIRM 接收方
- `SWAP_BUY_CLIENT` → from=对应 firm 钱包；to=客户买入币种钱包
- `SWAP_FEE_CLIENT` → from=客户钱包；to=`F_FEE` firm 钱包
- `SWAP_FEE_FIRM`、`SWAP_BUY_OPS_TO_SET`、`SWAP_BUY_SET_TO_ASSET`、`SWAP_SELL_FIRM` → 全 firm 钱包，from/to 都填

**验证**：种子跑完后 `internal_funds` 表 SWAP 关联 12 笔的 from/to 全部非空。

### 抓手 2 — withdraw 写 fromWalletId + AccountFlowProjector 写 walletRef 修对 + R2/R4 throw

**改动文件**：
- withdraw workflow 创建 `withdraw_transactions` 的服务（FIAT 分支写 fromWalletId 时改为客户 C_VIBAN，不是 Platform C_CMA）
- `AccountFlowProjector` 服务（precise path 由 P7 dive 确认）
- withdraw workflow 调用 projector 的入口（保证 walletRef 传的是客户钱包 ID）

**预期行为**：
- **withdraw_transactions 创建时**：FIAT → fromWalletId=客户 C_VIBAN；CRYPTO → fromWalletId=客户 C_DEP。**禁止挂到 Platform / firm 钱包**。
- **客户提现的 NET/FEE leg** → walletRef = 客户 C_VIBAN/C_DEP（不是 C_CMA）
- **提现 fee firm leg** → walletRef = F_FEE 钱包
- 写入前对每行调用 `assertWalletRefMatchesTbAccount(walletRef, tbAccountId)` —— mismatch throw（R2）
- withdraw workflow 入口对 fromWalletId 做 `assertSourceWalletIsCustomerOwned(...)`—— mismatch throw（R4）

**验证**：跑完种子后 `account_flows` 任一行的 walletRef 都能 join wallets 且 owner ↔ tbAccountId 的 owner 一致；`withdraw_transactions.fromWalletId` 5/5 都是客户钱包（不是 Platform）。

### 抓手 3 — payout completion 回填 referenceNo / txHash + R3 throw

**改动文件**：
- 处理 payout `markCleared` / `finalize` 的 service
- clearing handler 调用 payout completion 的入口

**预期行为**：
- FIAT payout 完结 → 必传 `BANK-PO...` 形态的 reference
- CRYPTO payout 完结 → 必传 `txHash`（链上 hash 形态）
- 服务层校验，缺一不可。

**验证**：种子跑完所有 CLEARED 状态 payout 都有 referenceNo + (CRYPTO 时) txHash。

### 抓手 4 — `scripts/verify-demo-data.ts` 工具

**新建文件**：`scripts/verify-demo-data.ts`

**输入**：dev.db 路径（DATABASE_URL）
**输出**：5 段扫描结果

```
═══ R1: InternalFund from/to 完整性扫描 ═══
  ✓ 17/17 笔通过 (SWAP 12, WITHDRAW 5)
  或
  ✗ N 笔违反:
    IFD2606xxxxxx eventCode=... parent=SWAP from=NULL to=NULL → expected from=...

═══ R2: account_flows.walletRef 解析 + owner 一致性 ═══
  ✓ N 行通过
  或
  ✗ N 行违反:
    row=... walletRef=fe8d1e5f-... tbAccountId=a0a2d460 → wallet owner=PLATFORM != tb owner=CU2601019430

═══ R3: Payout/Payin CLEARED ref/txHash 完整性 ═══
  ...

═══ Wallet 余额恒等（额外扫描）═══
  Σ(account_flows by walletRef) == TB balance
  ...
```

**退出码**：全 PASS → exit 0；任一违反 → exit 1 + 红色错误。

**package.json 入口**：`"verify:demo-data": "DATABASE_URL=file:/tmp/exchange_js_main/dev.db ts-node -r tsconfig-paths/register scripts/verify-demo-data.ts"`

### 抓手 5 — `db:seed:business` 末尾自动调抓手 4

**改动文件**：
- `prisma/seed.business.ts`（末尾追加调用）或 `package.json`（链式 npm 脚本）

**预期行为**：
- 种子完成后自动调 `verify:demo-data`
- 如果工具 exit 1，种子整体也 exit 1（CI / 开发者立刻看到）

**验证**：`bash scripts/stack.sh reset-main` 末尾出现 `verify:demo-data ALL PASS` 字样，缺一不可。

---

## 验收门槛

```
1. bash scripts/stack.sh reset-main             → 末尾 verify:demo-data ALL PASS
2. verify-realtime-coa.ts                       → ALL INVARIANTS PASS
3. npm run recon:demo:pass                      → status=PASS, casesOpened=0
4. npm run recon:demo:break                     → status=BREAK, manifest 5/5
5. Alice (CU2601019430) AED C_VIBAN 余额        → 1,153,047 AED (扣完提现)
6. jest src/modules/clearing-settle/reconciliation  → 全绿（≥110）
7. internal_funds 表 70% 空 → 0%                → 17/17 全部 from/to 合规
8. payouts 表 referenceNo NULL                  → 0% （CLEARED 状态）
9. withdraw_transactions.fromWalletId 错挂率    → 0% (5/5 客户自有 C_VIBAN/C_DEP)
```

---

## 边界（不做）

- 不动 `Wallet` model 结构（不加新字段、不重命名）
- 不动 `tb_account_registry` 模型
- 不动 `TB_LEDGERS` 常量
- 不修任何 admin UI / client UI（这些层依赖底层数据，底层修了上层自动正确）
- 不上 prisma migration（schema 不变）

---

## 风险评估

| 风险 | 描述 | 缓解 |
|---|---|---|
| 改 AccountFlowProjector 影响所有业务流 | deposit / swap / withdraw / internal-transfer 都走这里 | 改前先建立全场景回归测试基线；改后逐个跑 |
| Runtime throw 影响线上 | 旧数据如果跑老路径会触发 throw | 先抹掉旧种子数据 + 重跑；线上启用前确认无残留旧记录 |
| seed 改动可能影响其他依赖 | 比如 e2e / verify scripts 假设了旧种子布局 | 改完种子跑全量 jest 当作回归 |

---

## 后续可扩展（不在本轮）

- R4 钱包级余额恒等（TB vs account_flows）—— 已经在 verify 工具里加扫描，但**没有 runtime throw**。需要单独评估。
- demo `recon:demo:pass` 前置守门 —— 暂不做，被乙覆盖。
- 客户端 UI 改成按 PAYABLE 账户级展示流水 —— 单独 spec。
