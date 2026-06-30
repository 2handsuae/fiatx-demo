# 账本与业务流程参考

> 本文档面向产品 / 运营 / 财务 / 新加入工程师，用业务白话讲清楚平台的账本如何设计、三种交易订单（充值 / 提现 / 兑换）如何动账、对账流程如何运作。
>
> 阅读对象：**不需要懂代码就能读懂**。涉及账本细节用具体数字举例，所有金额按 USDT 6 decimals、AED 2 decimals 计算。
>
> 适用版本：2026-06-25 起的"实时 1:1 资金模型"（取代旧 V7 池化 + V8 五公式对账）。Phase A（资金核心）+ Phase B（对账重写）已并入 main。

---

## 0. 名词速查

| 名词 | 一句话解释 |
|---|---|
| **TigerBeetle / TB** | 平台用的金融账本数据库，所有"钱在谁名下"的最终事实来源 |
| **COA**（Chart of Accounts） | 科目表，账本上有哪几类账户 |
| **Ledger** | 一个币种对应一个 ledger（AED=1，USDT=2） |
| **Code** | 账户类型代号（1-203 的小整数） |
| **TB Account** | 账本上一个具体的账户实例（比如"张三的 USDT 可用余额"） |
| **Wallet（物理钱包）** | 真实世界存在的东西，比如客户的充值地址、VIBAN、HexTrust 托管 |
| **Transfer** | 账本上的一笔转账，必须 1 借 1 贷且金额相等 |
| **Pending** | 锁定占位但还没真正落账的 transfer |
| **Posted** | 真正落账完成 |
| **Voided** | pending 被撤销 |
| **Evidence** | 凭证表，记录每笔 transfer 的业务背景（订单号、为啥转） |
| **AccountFlow** | TB 流水的投影表，按物理钱包索引，给对账和钱包流水页用 |

---

# 第一部分：科目账户的设定与规则

## 1.1 整个账本只有 8 个科目类型

> **顶层设计**：用极少量科目 + 多个币种 ledger 拼出全部可能的账户。币种用 `ledger` 区分，账户类型用 `code` 区分——8 个 `code` 解决一切。

| 类型 | code | 名字 | 含义 | 归属 | 例子 |
|---|---|---|---|---|---|
| **资产 A** | 1 | `CLIENT_ASSET` | 我们代客户保管的总资产 | SYSTEM（每币种 1 个聚合） | USDT 客户资产聚合户 |
| | 50 | `FIRM_ASSET` | 公司自己持有的总资产 | SYSTEM（每币种 1 个聚合） | AED 公司资产聚合户 |
| **负债 L** | 100 | `CLIENT_PAYABLE` | 客户**可用余额**（我们欠客户的） | 每客户每币种 1 个 | 张三的 USDT 可用余额账户 |
| | 101 | `DEPOSIT_SUSPENSE` | 充值合规审查暂存（钱到了但合规没过） | 每客户每币种 1 个 | 张三的 USDT 暂存账户 |
| **权益 E** | 200 | `FIRM_OPS` | 公司运营/流动性（兑换对手盘） | SYSTEM（每币种 1 个单例） | AED 公司运营账户 |
| | 201 | `FIRM_SET` | 法币结算中转户（仅法币 ledger，镜像 Zand 银行约束） | SYSTEM（仅 AED ledger） | AED 法币结算户 |
| | 202 | `FIRM_FEE` | 公司手续费收入 | SYSTEM（每币种 1 个单例） | AED / USDT 手续费户 |
| | 203 | `FIRM_LIQ` | 流动性储备（本版挂着不用） | SYSTEM | — |

## 1.2 符号约定：哪边是"+"

会计基础规则——**资产借方+，负债/权益贷方+**。代码里严格遵守：

```
资产（A）类账户余额  = debits_posted − credits_posted
负债（L）/ 权益（E） = credits_posted − debits_posted
```

**举例**：
- 客户充值 100 USDT，`CLIENT_ASSET` 借方 +100 → 资产账户余额 +100（资产持有增加）✅
- 客户充值 100 USDT，`DEPOSIT_SUSPENSE` 贷方 +100 → 负债账户余额 +100（我们欠客户的暂存增加）✅

不区分会导致资产账户算出负数。

## 1.3 两条全局恒等式（账本健康的灵魂）

**客户侧恒等式**（每个 ledger 各算一次）：

```
Σ CLIENT_ASSET  ==  Σ CLIENT_PAYABLE  +  Σ DEPOSIT_SUSPENSE
```

> **白话**：我们代客户保管的总资产 = 所有客户可用余额之和 + 所有客户审查暂存之和。

**公司侧恒等式**（每个 ledger 各算一次）：

```
Σ FIRM_ASSET  ==  Σ FIRM_OPS  +  Σ FIRM_SET  +  Σ FIRM_FEE  +  Σ FIRM_LIQ
```

> **白话**：公司总资产 = 各运营子账户之和。

**重要性质**：
- 每笔合法的 TB transfer **必然让恒等式两侧同时变化同样金额**（借贷在等式同一侧），所以**正常路径下永远成立**
- 一旦不成立 → 说明账本被系统外干预过（直改 TB / registry 漂移 / seed 漏账户 / 公式忘加新 code）
- 对账时**先查恒等式**——不平就停下来查根，per-wallet 比对没意义

## 1.4 物理钱包 vs 账本账户

**两个不同概念**，要分清楚：

| 概念 | 含义 | 例子 | 实体表 |
|---|---|---|---|
| **物理钱包**（Wallet） | 真实世界存在的"装钱容器" | 张三的 USDT 充值地址 `0xabc...`、张三的 vIBAN | `wallet` |
| **TB 账户**（Account） | 账本上的科目实例 | 张三的 USDT `CLIENT_PAYABLE` 账户 | TigerBeetle 内部 + `tb_account_registry` 索引 |

**对应关系**：
- 一个**客户充值钱包**对应 **2 个 TB 账户**：`CLIENT_PAYABLE`（可用）+ `DEPOSIT_SUSPENSE`（暂存）
- 一个**公司钱包**对应 **1 个 TB 账户**：`FIRM_OPS` / `FIRM_SET` / `FIRM_FEE` 之一
- evidence 行带 `walletRef` 字段——挂"这笔流水属于哪个物理钱包"，对账时按物理钱包合并视图

## 1.5 账户的三种"钱量"

每个 TB 账户有三个数：

```
total      = credits_posted − debits_posted   （已落账总额）
held       = debits_pending                    （锁定中）
available  = total − held                      （可用）
```

> **客户 App 看到的余额 = available**。提现申请瞬间 held +1000，available -1000；payout 成功后 total -1000、held 归零（钱真扣了）。

## 1.6 三态生命周期：Pending / Posted / Voided

每笔 transfer 有三种状态：

| 状态 | 含义 | 何时用 |
|---|---|---|
| **Pending** | 占位但未落账 | 提现申请时锁钱、swap 腿首次发起 |
| **Posted** | 真正落账完成 | 充值入账、提现确认、swap 腿成功 |
| **Voided** | pending 被撤销，原路退回 | 提现失败、swap 腿失败 |

**生命周期**：
```
普通 transfer：               直接 Posted（一步到位）
两阶段 transfer：    Pending ──(post)──→ Posted
                            └──(void)──→ Voided
```

> **重要**：post / void 操作生成**新的 transfer id**，但通过 `pending_id` 关联原 pending。evidence 表里**只有 1 行**——pending 那行原地升级到 POSTED 或 VOIDED，不开新行。

## 1.7 Deterministic Transfer ID（幂等的根）

每笔 transfer 的 128-bit id 由业务键算出：

```
transferId = SHA256("sourceType:sourceNo:eventCode:legIndex")[:16]
```

举例：
```
deterministicTransferId('DEPOSIT', 'DEP-001', 'DEPOSIT_ASSET_TO_SUSPENSE', 0)
→ 永远是同一个 id
```

**作用**：
- TB 引擎层去重——同 id 重复调用直接 reject（返回 `exists`）
- 网络重试、消息重投、workflow 重跑都安全
- swap leg 失败重试时 `legIndex` += 1，新 id 不撞老 id

## 1.8 三张表的关系

每笔 TB transfer 落地时**原子写三处**：

```
┌─────────────────────────────────────────────────────────────┐
│  TigerBeetle 真账（核心数据库）                              │
│  存：账户余额 + 每笔 transfer (id, debit, credit, amount)   │
└─────────────────────────────────────────────────────────────┘
            ↑
            │
┌─────────────────────────────────────────────────────────────┐
│  tb_account_registry（账户索引表 — SQL）                     │
│  存：TB id ↔ (code, ledger, ownerType, ownerUuid) 的映射     │
│  作用：业务层用业务语言查账户，registry 翻译成 TB id        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  tb_transfer_evidence（凭证表 — SQL）                        │
│  存：每笔 transfer 的业务背景                                │
│  字段：sourceType / sourceNo / eventCode / walletRef        │
│       externalRef / isExternalCrossing / traceId / memo     │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  account_flow（投影表 — SQL）                                │
│  每笔 evidence 投影为 2 行（debit→OUT 一行、credit→IN 一行） │
│  作用：按 walletRef 索引，对账引擎 + 钱包流水页读这个       │
└─────────────────────────────────────────────────────────────┘
```

> **三者必须事务原子**——一笔成全成，一笔挂全挂。

## 1.9 安全规则与不变量

| 规则 | 怎么强制 |
|---|---|
| 客户余额不能透支 | `CLIENT_PAYABLE` 账户加 `debits_must_not_exceed_credits` flag，TB 引擎层拒绝 |
| 同一笔业务不能重复落账 | Deterministic transferId + TB 引擎层 `exists` 去重 |
| evidence walletRef 必须真实存在 | 投影前 R2 守卫校验 `walletRef ∈ wallets` 且 owner 匹配 registry，否则抛 `WalletRefMismatchError` |
| evidence 写失败必须留痕 | 失败时写 `tb_evidence_backlog`，等运营 / cron 补 |
| 提现 SUCCESS 必须三笔记账齐 | 乙不变量守卫 `assertWithdrawSettled`：`NET_POST + FEE_POST + FEE_FIRM` 必须都在 evidence 表里 |
| Payout / Payin CLEARED 必须有外部凭证 | R3 守卫：必须有 `referenceNo`，CRYPTO 还要 `txHash` |
| 提现源钱包必须客户自有 | R4 守卫：必须是 customer-owned 的 `C_DEP`（虚拟币）/ `C_VIBAN`（法币） |

---

# 第二部分：三个交易订单

## 2.1 充值订单（Deposit）

### 客户视角

> 张三想充 100 USDT 到平台。

1. App 进"充值"页，复制自己的 USDT 充值地址 `0xabc...`
2. 张三在外部钱包发起转账，拿到 txHash
3. **张三回到 App，主动声明"我转了"**（不是被动等链上 webhook）→ 提交 `inbound signal`：
   - walletId、amount、txHash、fromAddress
4. 张三再点"扫描"→ 系统处理这条 signal
5. 几秒后 App 余额从 0 → 100 USDT ✅

### 流程链路

```
客户报到 (POST /my/inbound-signals)
   ↓
客户点扫描 (POST .../scan)
   ↓
processSignal → 创建 Payin (DETECTED)
   ↓
advancePayin 推进:
   FIAT:  DETECTED ──(CONFIRM)──> CONFIRMED ──(CLEAR)──> CLEARED
   CRYPTO: DETECTED ──(BLOCK)──> CONFIRMING ──(CONFIRM)──> CONFIRMED ──(CLEAR)──> CLEARED
   ↓
Payin CONFIRMED 触发 DepositWorkflow:
   - STEP_1 TB 记账
   - Deposit 转 COMPLIANCE_PENDING
   - Payin 转 CLEARED
   ↓
Deposit COMPLIANCE_PENDING 触发 runGate0:
   - 查客户合规状态
   - 通过 → 启动 KYT + Travel Rule
   ↓
KYT / TR 结果到达 → checkAutoApproval:
   - kyt=PASSED && tr∈{PASSED, NOT_REQUIRED} && 客户合规正常
   ↓
approveDeposit:
   - STEP_2 TB 记账
   - Deposit 转 SUCCESS
```

### 账本视角：2 笔 TB transfer

> 期初假设三个账户都是 0。

#### 第 1 笔（Step 1）— 钱进暂存

```
触发时机: Payin 到 CONFIRMED 时
TB transfer:
  code:    1 (DEPOSIT_ASSET_TO_SUSPENSE)
  debit:   A.CLIENT_ASSET    (SYSTEM 聚合 USDT)
  credit:  L.DEPOSIT_SUSPENSE (张三 USDT)
  amount:  100_000000n (100 USDT, 6 decimals)
  flags:   0 (普通 posted)
Evidence:
  externalRef: 张三的 txHash
  isExternalCrossing: true   ← 真有外部交割
```

**TB 余额变化**：
- `A.CLIENT_ASSET`：debits +100 → 余额 +100
- `L.DEPOSIT_SUSPENSE`（张三）：credits +100 → 余额 +100

**恒等式**：`100 == 0 + 100` ✅

**客户感知**：App 余额还是 0（暂存不是可用）

#### 第 2 笔（Step 2）— 合规通过，钱进可用

```
触发时机: KYT + TR 都过 + Gate 0 过
TB transfer:
  code:    2 (DEPOSIT_SUSPENSE_TO_PAYABLE)
  debit:   L.DEPOSIT_SUSPENSE (张三 USDT)
  credit:  L.CLIENT_PAYABLE   (张三 USDT)
  amount:  100_000000n
  flags:   0
Evidence:
  externalRef: null            ← 纯账内 reclass
  isExternalCrossing: false    ← 不算真出境
```

**TB 余额变化**：
- `L.DEPOSIT_SUSPENSE`（张三）：debits +100 → 余额 0
- `L.CLIENT_PAYABLE`（张三）：credits +100 → 余额 +100

**恒等式**：`100 == 100 + 0` ✅

**客户感知**：App 余额 0 → 100 USDT ✅

### Deposit 状态机

```
PAYIN_PENDING ──(payin_confirmed)──> COMPLIANCE_PENDING
              ──(fail)──> FAILED

COMPLIANCE_PENDING ──(approve)──> SUCCESS              ← Admin API 禁用
                   ──(reject)──> REJECTED
                   ──(freeze)──> FROZEN
                   ──(action_pending)──> ACTION_PENDING
                   ──(fail)──> FAILED

ACTION_PENDING ──(approve)──> SUCCESS
               ──(reject)──> REJECTED
               ──(freeze)──> FROZEN
               ──(resume)──> COMPLIANCE_PENDING
               ──(expire)──> EXPIRED

FROZEN ──(approve)──> SUCCESS
       ──(confiscate)──> CONFISCATED

终态: SUCCESS / REJECTED / FAILED / EXPIRED / CONFISCATED
```

> Admin 守卫：admin 不能直接 patch 到 SUCCESS，必须走 workflow。防止绕过 TB 记账。

### 充值的特征

- 2 笔 transfer 都是 posted（无 pending）
- 充值**不收手续费**
- 只动客户侧账户，不动公司侧
- Step 1 真出境（`isExternalCrossing=true`）；Step 2 内部 reclass（false）
- 两笔共用同一个 `walletRef`（张三那个充值钱包 id）

---

## 2.2 提现订单（Withdrawal）

### 客户视角

> 李四想从平台提 1000 AED 到自己银行账户。

1. App 进"提现"页，选已绑定的银行账户
2. App 算报价：净到账 995 AED + 手续费 5 AED，30 秒有效
3. 李四点"确认"→ 余额从 1000 → 0（被锁了但还没出账）
4. 后台跑合规审查
5. 几分钟到几小时后，银行确认到账 → 状态 SUCCESS ✅

### 流程链路

```
客户提交 (POST /client/withdraw-transactions)
   ↓
事务原子做 3 件事:
   - 校验 + 消费 quote
   - 插 Withdraw 行 (CREATED)
   - TB 锁 2 笔 pending (net + fee)
   ↓
emit WITHDRAWAL_CREATED
   ↓
handleWithdrawalCreated:
   - 用 Binance 算 AED 估值
   - ≥ 200000 AED → 走 SMO 审批门 (PENDING_APPROVAL)
   - 否则 → 直接进合规 (PENDING_COMPLIANCE)
   ↓
合规通过 checkScreenPass:
   - preKyt=PASSED && tr∈{PASSED, NOT_REQUIRED}
   ↓
initiatePayoutPhase:
   - R4 守卫绑源钱包
   - 转 PAYOUT_PENDING
   - 创建 Payout (本金) + fee fund (手续费)
   ↓
Payout 推进:
   CRYPTO: CREATED ──(SIGN)──> SIGNING ──(BROADCAST)──> BROADCASTED ──(SEEN)──> CONFIRMING ──(CONFIRM)──> CONFIRMED
   FIAT:   CREATED ──(SUBMIT)──> CONFIRMING ──(CONFIRM)──> CONFIRMED
   ↓
Payout CONFIRMED → finalizeWithdrawal:
   - 3 笔 TB 操作 (POST net + POST fee + FIRM_ASSET→FIRM_FEE)
   - 乙不变量守卫
   - Withdraw 转 SUCCESS
```

### 账本视角：5 笔 TB 操作 / 3 行 evidence

> 期初假设李四 AED 可用 1000，公司侧全 0。

#### 时刻 T0：申请时锁 2 笔 pending

**第 1 笔（pending）**：
```
code: 10 (WITHDRAW_NET_PENDING)
debit:  L.CLIENT_PAYABLE  (李四 AED)
credit: A.CLIENT_ASSET    (SYSTEM 聚合 AED)
amount: 99500n (995 AED, 2 decimals)
flags:  pending
Evidence:
  eventCode: WITHDRAW_LOCK_NET
  transferType: PENDING
  externalRef: null
  isExternalCrossing: false    ← LOCK 阶段还没真出境
```

**第 2 笔（pending）**：
```
code: 13 (WITHDRAW_FEE_PENDING)
debit:  L.CLIENT_PAYABLE
credit: A.CLIENT_ASSET
amount: 500n (5 AED)
flags:  pending
Evidence:
  eventCode: WITHDRAW_LOCK_FEE
  transferType: PENDING
```

**TB 变化**：
- `L.CLIENT_PAYABLE`（李四）：`debits_pending` +1000 → `held` = 1000，`available` = 0，`total` 仍 1000
- `A.CLIENT_ASSET`：`credits_pending` +1000 → posted 不变

**恒等式（用 posted 算）**：`1000 == 1000 + 0` ✅

**客户感知**：App 余额 1000 → 0（被锁，但没真出账）

#### 时刻 T1：Payout 到账，finalize 跑 3 笔操作

**第 3 笔（post pending）— POST net**：
```
TigerBeetle: postPendingTransfer(net pending id, 99500n, flags=post_pending_transfer)
Evidence 表特殊操作: 不开新行,
  原 LOCK_NET 那行原地升级:
    eventCode: WITHDRAW_LOCK_NET → WITHDRAW_NET_POST
    transferType: PENDING → POSTED
    externalRef: null → 银行 referenceNo
    isExternalCrossing: false → true   ← 升级了！
```

**第 4 笔（post pending）— POST fee**：同上升级 `WITHDRAW_FEE_POST`。

**第 5 笔（普通 posted）— 公司侧 fee 入账**：
```
code: 16 (WITHDRAW_FEE_FIRM)
debit:  A.FIRM_ASSET (SYSTEM 聚合 AED)
credit: E.FIRM_FEE   (SYSTEM 单例 AED)
amount: 500n
flags:  0 (普通 posted)
Evidence:
  externalRef: 银行 referenceNo  ← 跟 FEE_POST 共享同一个！
  isExternalCrossing: true
```

**TB 余额变化**：
- `L.CLIENT_PAYABLE`（李四）：`debits_pending` 0、`debits_posted` +1000 → 余额 0
- `A.CLIENT_ASSET`：`credits_pending` 0、`credits_posted` +1000 → 余额 -1000（原本 1000）
- `A.FIRM_ASSET`：`debits_posted` +5 → 余额 +5
- `E.FIRM_FEE`：`credits_posted` +5 → 余额 +5

**两侧恒等式**：
```
客户侧 AED: -1000 == 0 + 0 - (-1000) ✅
公司侧 AED:    5 == 0 + 0 + 5 + 0  ✅
```

**乙不变量守卫**：查 evidence 必须能找到 `WITHDRAW_NET_POST + WITHDRAW_FEE_POST + WITHDRAW_FEE_FIRM` 三行。少一个抛错，Withdraw 留 `PAYOUT_PENDING` 等运营 `reCloseoutPayout`。

#### 失败回滚：releaseLock

```
voidPendingTransfer(net pending id, 99500n)
voidPendingTransfer(fee pending id, 500n)
Evidence: 同行 UPDATE transferType = VOIDED
fee fund: 转 CANCELLED
```

TB 上 `debits_pending` 减回去，客户 `available` 恢复 1000。

### Withdraw 状态机

```
CREATED ──(REQUIRE_APPROVAL)──> PENDING_APPROVAL
        ──(CHECK)──> PENDING_COMPLIANCE
        ──(CANCEL)──> CANCELLED

PENDING_APPROVAL ──(GATE_APPROVE)──> PENDING_COMPLIANCE
                ──(REJECT)──> REJECTED
                ──(CANCEL)──> CANCELLED

PENDING_COMPLIANCE ──(APPROVE)──> PAYOUT_PENDING     ← Admin API 禁用
                  ──(FLAG)──> UNDER_REVIEW
                  ──(REJECT)──> REJECTED
                  ──(CANCEL)──> CANCELLED

UNDER_REVIEW ──(APPROVE)──> PAYOUT_PENDING            ← Admin API 禁用
            ──(REJECT)──> REJECTED
            ──(CANCEL)──> CANCELLED

PAYOUT_PENDING ──(SUCCESS)──> SUCCESS                 ← Admin API 禁用
              ──(FAIL)──> FAILED                      ← Admin API 禁用
              ──(FLAG)──> UNDER_REVIEW
              ──(REJECT)──> REJECTED

SUCCESS ──(RETURN)──> RETURNED                        ← Admin API 禁用
```

> Admin 不能直接转 PAYOUT_PENDING / SUCCESS / FAILED / RETURNED——必须 workflow 或 system 触发。

### 提现的特征

- **大额审批门**：≥ 200000 AED 走 SMO 单步审批（Binance 拿不到汇率 fail-closed 也走审批）
- **5 笔 TB 操作 / 3 行 evidence**：pending 行被 post 时原地升级，不开新行
- **先锁后扣**：客户余额申请瞬间被锁，确认后才真扣
- **同 ref 跨账本配对**：`FEE_POST` 和 `FEE_FIRM` 共享同一 `externalRef`，对账时按同 ref 跨钱包匹配
- **fee fund 在 PAYOUT_PENDING 阶段才建**：合规拒掉的提现不会留 fee fund 痕迹

---

## 2.3 兑换订单（Swap）

### 客户视角

> 王五用 100 USDT 换 AED。

1. App 进"兑换"页
2. 输入 100 USDT → App 显示报价：净到账 365 AED + 手续费 1 AED + 实际汇率 3.66（市场 3.67），30 秒有效
3. 王五点"确认"
4. **几秒内**：USDT 余额从 100 → 0、AED 余额从 0 → 365 ✅

### 流程链路

```
客户拿报价 (POST /swap-transactions/quotes)
   ↓ assertTradingEligibility('SWAP')
SwapQuoteService 工作:
   - 查客户绑的 fee level 中费率最便宜的
   - Binance 拿实时市场汇率
   - 加上点差 (rateMarkupBps) 算 quotedRate
   - TTL = 30 秒
   ↓
客户用 quote 建 swap (POST /swap-transactions { quoteId })
   ↓
executeSwap (事务内):
   - 校验 + 消费 quote
   - 建 swap 行 (PROCESSING)
   - 只建腿 1 + 启动腿 1 的 pending
   ↓
逐腿 advance:
   POST /admin/swap-transactions/:swapNo/legs/:legSeq/advance
   ↓
腿 N CLEAR → onLegCleared:
   - 不是最后一腿 → 链式建腿 N+1
   - 是最后一腿 → swap 转 SUCCESS + emit SWAP_SUCCEEDED
   ↓
腿 N 失败 → onLegFailedSelfHeal:
   - voidLeg 撤 pending
   - attempt < 3 → 自动重试 (attempt+1)
   - attempt = 3 → 标 NEEDS_REVIEW，swap 仍 PROCESSING
   ↓
NEEDS_REVIEW → 运营 resumeLeg (POST .../legs/:legSeq/resume)
```

### 账本视角：CRYPTO → FIAT 路径的 4 腿 7 笔 TB transfer

> 期初客户 USDT PAYABLE 100，其他 0。所有 transfer 全是 pending → post。

#### Leg 1 — SELL（客户出 USDT 给公司 OPS）

**第 1 笔**：
```
code: 30 (SWAP_SELL_CLIENT)
debit:  L.CLIENT_PAYABLE  (王五 USDT)
credit: A.CLIENT_ASSET    (SYSTEM USDT)
amount: 100_000000n
externalRef: SWP-001:1:1:pending
```

**第 2 笔**：
```
code: 31 (SWAP_SELL_FIRM)
debit:  A.FIRM_ASSET (SYSTEM USDT)
credit: E.FIRM_OPS   (SYSTEM USDT)
amount: 100_000000n
externalRef: SWP-001:1:1:pending  ← 同 leg 1 共享
```

**post 后 TB 余额**：
- USDT 客户侧：`CLIENT_ASSET` -100、`CLIENT_PAYABLE`（王五）-100 → 恒等式 `-100 == -100 + 0` ✅
- USDT 公司侧：`FIRM_ASSET` +100、`FIRM_OPS` +100 → 恒等式 `100 == 100 + 0` ✅

#### Leg 2 — SETTLE（公司内部 AED 腾挪）

**第 3 笔**：
```
code: 32 (SWAP_BUY_OPS_TO_SET)
debit:  E.FIRM_OPS (SYSTEM AED)
credit: E.FIRM_SET (SYSTEM AED)
amount: 36600n (366 AED 毛得)
externalRef: SWP-001:2:1:pending
```

> 这一笔**只动公司侧 AED**——为了镜像 Zand 银行约束（客户 vIBAN 入金必须从 FIRM_SET 出）。

**post 后 TB 余额**：
- AED 公司侧：`FIRM_OPS` -366、`FIRM_SET` +366 → 恒等式 `0 == -366 + 366 + 0 + 0` ✅

#### Leg 3 — BUY（公司把 AED 给客户）

**第 4 笔**：
```
code: 33 (SWAP_BUY_SET_TO_ASSET)
debit:  E.FIRM_SET   (SYSTEM AED)
credit: A.FIRM_ASSET (SYSTEM AED)
amount: 36600n
externalRef: SWP-001:3:1:pending
```

**第 5 笔**：
```
code: 34 (SWAP_BUY_CLIENT)
debit:  A.CLIENT_ASSET    (SYSTEM AED)
credit: L.CLIENT_PAYABLE  (王五 AED)
amount: 36600n
externalRef: SWP-001:3:1:pending  ← 同 leg 3 共享
```

**post 后 TB 余额**：
- AED 公司侧：`FIRM_SET` -366（累计 0）、`FIRM_ASSET` -366
- AED 客户侧：`CLIENT_ASSET` +366、`CLIENT_PAYABLE`（王五）+366
- 恒等式 客户侧 `366 == 366 + 0` ✅、公司侧 `-366 == -366 + 0 + 0 + 0` ✅

#### Leg 4 — FEE（客户付 1 块手续费给公司）

**第 6 笔**：
```
code: 35 (SWAP_FEE_CLIENT)
debit:  L.CLIENT_PAYABLE  (王五 AED)
credit: A.CLIENT_ASSET    (SYSTEM AED)
amount: 100n (1 AED)
externalRef: SWP-001:4:1:pending
```

**第 7 笔**：
```
code: 36 (SWAP_FEE_FIRM)
debit:  A.FIRM_ASSET (SYSTEM AED)
credit: E.FIRM_FEE   (SYSTEM AED)
amount: 100n
externalRef: SWP-001:4:1:pending  ← 同 leg 4 共享
```

**最终 TB 余额**：
- AED 客户侧：`CLIENT_ASSET` +365、`CLIENT_PAYABLE`（王五）+365 → 恒等式 `365 == 365` ✅
- AED 公司侧：`FIRM_ASSET` -365、`FIRM_OPS` -366、`FIRM_SET` 0、`FIRM_FEE` +1 → 恒等式 `-365 == -366 + 0 + 1 + 0` ✅

**4 腿全 CLEAR** → swap 转 `SUCCESS`，emit `SWAP_SUCCEEDED`。

### Swap 状态机

```
swap:
  PROCESSING ──(全部腿 CLEAR)──> SUCCESS
  ⚠ 永不 markStatus FAILED — self-heal 永远留 PROCESSING

每腿 InternalFund (CRYPTO 路径):
  CREATED ──(SIGN)──> SIGNING ──(BROADCAST)──> BROADCASTED
  BROADCASTED ──(SEEN_IN_MEMPOOL)──> CONFIRMING
              ├─(DROP)──> FAILED
              └─(TIMEOUT)──> TIMEOUT
  CONFIRMING ──(CONFIRM)──> CONFIRMED ──(CLEAR)──> CLEAR
             ├─(REORG)──> BROADCASTED
             └─(FAIL/TIMEOUT)──> FAILED/TIMEOUT

每腿 InternalFund (FIAT 路径):
  CREATED ──(SUBMIT)──> CONFIRMING ──(CONFIRM)──> CONFIRMED ──(CLEAR)──> CLEAR
                                    ├─(FAIL/TIMEOUT)──> FAILED/TIMEOUT
```

### 兑换的特征

- **跨 2 个 ledger**（USDT + AED）—— TB 不允许跨 ledger transfer，客户的 USDT 出账和 AED 入账是两笔独立 transfer
- **7 笔 transfer 全是 pending → post**——每笔都可 void
- **腿是链式生成**：腿 N CLEAR 时才建腿 N+1，不一次建 4 条
- **每腿带 attempt 进 externalRef**：`SWP-001:legSeq:attempt:pending`，self-heal 重试时 `attempt+1`
- **swap 不会 FAILED**：失败最多到 NEEDS_REVIEW 等运营 resume
- **价差不在 fee 里**：埋在汇率里（市场 3.67，给客户 3.66，差的部分公司隐性赚）

---

## 2.4 三个交易在账本上的对比

|  | 充值 100 USDT | 提现 1000 AED (净 995 + 费 5) | 兑换 100 USDT → 365 AED + 费 1 |
|---|---|---|---|
| **TB transfer 数** | 2 | 5 | 7 |
| **Evidence 行数** | 2 | 3 | 7 |
| **AccountFlow 行数** | 4 | 6 | 14 |
| **跨 ledger 吗** | 否 | 否 | **是** |
| **动客户侧** | ✅ | ✅ | ✅ |
| **动公司侧** | ❌ | ✅（fee_firm） | ✅（所有腿） |
| **用 pending 吗** | ❌ | ✅（先锁后扣） | ✅（每腿两阶段） |
| **isExternalCrossing** | step1=true, step2=false | LOCK=false → POST=true | 全 true（但 swap 不真出境，是配对标记） |
| **跨账本同 ref 配对** | 无 | FEE_POST + FEE_FIRM | 每 leg 内部成对 |
| **失败回滚** | TB 反向 transfer | void pending + cancel fee fund | voidLeg + 自愈重试 |
| **手续费** | 不收 | 同笔扣 | 单独一腿 |
| **审批门** | 无 | ≥ 200000 AED 走 SMO | 无 |
| **失败终态** | FAILED / REJECTED / FROZEN / CONFISCATED | FAILED / REJECTED / RETURNED | **无**（NEEDS_REVIEW 等人） |

---

# 第三部分：对账流程

## 3.1 对账要回答什么问题

> 平台到底有没有客户的钱、有没有公司的钱、数对不对——这事**不能靠我们自己的账本说了算**，必须拿"真实世界"来核。

对账系统每次跑 (`POST /admin/reconciliation/runs/wallet { cutoff }`) 回答两类问题：

| 问题 | 检查办法 |
|---|---|
| **账本本身对不对** | 内部恒等预检（读 TB 算 2 条恒等式） |
| **账本跟真实世界对不对** | 逐钱包 1:1 比对（内部 vs 外部对账单） |

## 3.2 对账三步走

### 第 1 步：内部恒等预检（门口体检）

直接读 TigerBeetle 算每个 ledger 的两条恒等式：

```
客户侧: Σ CLIENT_ASSET == Σ (CLIENT_PAYABLE + DEPOSIT_SUSPENSE)
公司侧: Σ FIRM_ASSET   == Σ (FIRM_OPS + FIRM_SET + FIRM_FEE + FIRM_LIQ)
```

**任一条不平** → 整个 run 标记 `INTERNAL_BREAK`，**直接结束、跳过后面所有 per-wallet 检查**。

> **设计意图**：账本自己都不平的话，每个钱包跟外部比毫无意义——内部数都是错的，会产生一堆假阳性 BREAK。先修根。

**什么时候会真触发 INTERNAL_BREAK**（正常路径下永不触发）：
- TB 服务不可达
- 有人绕过 service 直接改 TB
- `tb_account_registry` 表跟 TB 真账不一致（seed 数据脏）
- 新增账户类型没同步进恒等式公式

### 第 2 步：逐钱包 1:1 比对（主战场）

预检过了之后，拿外部对账单（HexTrust 余额 + 银行对账单）提到的每个钱包，**做两项检查**：

#### 2a. 余额检查 `WalletBalanceCheckerService`

```
客户钱包: 内部余额 = CLIENT_PAYABLE + DEPOSIT_SUSPENSE
公司钱包: 内部余额 = 对应的 FIRM_OPS / FIRM_SET / FIRM_FEE
```

```
delta = external - internal
delta == 0 → PASS
delta != 0 → 开 case
```

#### 2b. 流水匹配 `WalletFlowMatcherService`

逐笔比对内部流水（从 `account_flow` 投影读）vs 外部流水（从 `external_statement_line` 读）。

**匹配优先级 1：按 externalRef 配对**

- 内部和外部都带 `externalRef`（txHash / 银行 ref / swap 内部 ref）
- 同 ref 同金额 → matched (via `ref`)
- 同 ref 不同金额 → `mismatch`（同一笔交易两边数对不上，明显的破）

**匹配优先级 2：fuzzy 兜底**

- 同方向（IN/OUT）+ 同金额 + 时间窗 ≤60 分钟 → matched (via `fuzzy`)
- 一旦匹上，外部行被消费，不会再被别人匹

> **fuzzy 在正常路径下永远用不到**——所有内部流水都带 ref。fuzzy 只在 ① 测试故意制造 ref 漂移 ② 数据迁移历史流水没 ref ③ 未来真实银行回执 ref 滞后 时触发。正常生产环境 fuzzy 匹上一条 = **数据完整性 bug 告警**。

**4 个匹配桶**：

| 桶 | 含义 |
|---|---|
| `matched` | 匹上了，不开 case |
| `orphanInternal` | 内部有外部无——"记了没发生" |
| `orphanExternal` | 外部有内部无——"发生了没记" 或 银行扣费没记 |
| `mismatch` | 同 ref 不同金额——明显破 |

#### 余额或流水任一不过 → 开一个 Case

按 `(walletRef, businessDate)` 幂等 upsert——**同一钱包同一天只开一个 case**。

Case 含：
- `caseNo`：`REC20260630-001`
- `walletRef` / `coaCode` / `book`（CUSTOMER/FIRM）
- `delta` / `internal` / `external`
- `severity`：HIGH（差 ≥10000）/ MEDIUM（≥100）/ LOW
- `firstSeenRunId`（第一次发现的 run）/ `lastUpdatedRunId`（最近一次跑刷新的）
- 下挂 `lineItems`：本次 run 发现的所有 orphan/mismatch 明细

### 第 3 步：自愈（auto-heal）

run 末尾：
- 本次 run 中 OPEN 但 walletRef 不在"本次仍破钱包列表"的 case → 自动转 `RESOLVED`，标 `AUTO_HEALED`
- 只影响 `layer=WALLET` 的 case，不动旧 V8 case

> 意思是"上次破这次平了 = 修复了"自动关闭。

## 3.3 三级账户状态（驾驶台 UI 用）

每个钱包在 Run 详情页用三级状态展示：

| 状态 | 颜色 | 含义 |
|---|---|---|
| **MATCH** | 绿 | 余额过 + 流水过 |
| **FLOW_REVIEW** | 黄 | 余额过了，但流水有 orphan/mismatch（"假平账"警示） |
| **BREAK** | 红 | 余额不过，硬破 |

> **为啥要区分 FLOW_REVIEW**：内部多记 +100、又多记 -100 → 净 0 余额平账，但实际是两笔假账互相掩盖。流水级 1:1 比对是防欺诈、防漏记的关键探针。

## 3.4 对账的数据源

### 内部数据：`account_flow` 表（投影）

> 对账引擎不直接读 TigerBeetle，读的是 **投影表**。

每次系统在 TB 上 `executeTransfer` / `postPending` / `voidPending` 时，**projector** 同步把这笔投到 2 行 `account_flow`：
- debit 那一行 → `direction = OUT`
- credit 那一行 → `direction = IN`

每行带：`walletRef` / `amount` / `externalRef` / `isExternalCrossing` / `eventCode` / `transferType`(POSTED/PENDING)。

**R2 守卫**：投影前校验 `walletRef ∈ wallets` 且 owner 匹配 registry，否则抛错——防止"流水挂错人头上"。

### 外部数据：`external_balance` + `external_statement_line` 表

外部对账单（HexTrust 余额报表、Zand 银行日终对账单）通过 adapter（DEV 用 mock，未来对接真实 API）拉进来：

- `external_balance`：某日终某钱包的收盘余额
- `external_statement_line`：当天每笔进出明细

**对账引擎只读这两张表**，不直接访问 HexTrust / Zand API。

## 3.5 Demo / 测试机制

| 命令 | 用途 |
|---|---|
| `npm run recon:demo:pass` | 从真实 AccountFlow 镜像出"完美对账单" → run 应 PASS / 0 case |
| `npm run recon:demo:break` | 在 pass 基础上**注入 4 种异常**：删 external 行 / 插无主 external / 改 external 金额 / 改 external 余额 → run 应 BREAK / 4 cases |
| `npm run recon:demo:reset` | 清掉 WALLET_V1 所有痕迹 |

> 在 main 栈下必须用 `bash scripts/on-stack.sh main recon:demo:pass` 包装运行，否则脚本会指向已删除的 branch DB 路径。

`recon:demo:break` 会写 `manifest.json` 记录"我注入了哪 4 种异常"。然后 admin 页面 `GET /admin/reconciliation/demo/compare?runNo=` 拿"注入的 vs 引擎发现的"对照，验证引擎是否把所有人为放的坑都找出来。

## 3.6 反直觉的 7 个设计点

### ① 对账是手动触发的

管理员需要主动调 `POST /admin/reconciliation/runs/wallet { cutoff }` 才会跑。**没看到自动 cron 调度**（虽然有个 41 行的 `reconciliation-sweep.service.ts` 可能埋着 cron，但主入口明确是手动）。

**为啥这么设计**：当前 Phase B 完成度，自动调度归到 Phase C deferred。

**会咬人的场景**：上生产忘配 cron / 运营忘点 → 一周没对账，发现问题晚一周。

### ② 账本自己不平 → 整个 run 跳过 per-wallet

预检挂了直接停，不查任何钱包。

**为啥**：账本本身坏的话每个钱包的内部余额都偏，跑出来一堆假阳性 BREAK 把人淹没。

**会咬人的场景**：新加币种忘了加进恒等式公式 → 该币种所有 run 都 `INTERNAL_BREAK`。

### ③ 余额对得上 ≠ 没事

余额平了还要查流水——防"假平账"（两笔互相抵消的假账）。UI 上有专门 `FLOW_REVIEW` 黄色状态。

**会咬人的场景**：接入新 adapter 时 ref 写丢了 → 余额平账但流水匹不上，全是 FLOW_REVIEW。

### ④ Case 不能 admin 手动关

没有任何 admin 关 case 的 API。修了数据只能等下次 run 自愈关闭。

**为啥**：防"运营随手关 case 但根因没修"。

**会咬人的场景**：半夜出 case 修完，下次对账要到第二天早上 → case 挂半天没人能手动关。

**Deferred**：Case 处置 workflow（CLOSE / WAIVE / 指派 / SLA）在路线图但没做。

### ⑤ 每次 run，case 的 lineItems 全部替换

delete-then-insert——每次 run 把 case 的 lineItems 全删了重写。

**为啥**：lineItems 描述当前快照，不累加历史。历史可恢复——每条 line item 上有 `foundByRunId`。

**会咬人的场景**：想看"问题哪天最先出现"——必须看 case 的 `firstSeenRunId`。

### ⑥ 匹配只看 POSTED 流水，不看 PENDING

提现申请后余额被锁但还没 post 的 pending 流水，对账**不算进内部余额**。

**为啥**：pending 是"承诺"不是"现实"，外部世界根本没有这笔交易。

**会咬人的场景**：长时间未确认 pending 卡着 → 对账抓不到，得靠**别的工具**（stuck transfer 监控）。

### ⑦ 只匹"主体账户"流水，不匹"聚合账户"流水

只看 6 个具体业务账户（`CLIENT_PAYABLE` `DEPOSIT_SUSPENSE` `FIRM_OPS` `FIRM_SET` `FIRM_FEE` `FIRM_LIQ`），完全丢掉 2 个聚合账户（`CLIENT_ASSET` `FIRM_ASSET`）。

**为啥**：聚合账户是整体账本视图，不属于某个物理钱包。如果也进 matcher，每笔交易会"算两次"全部成为 orphan。

**会咬人的场景**：加新账户类型忘了加进 `OWNED_CODES` 白名单 → 这类账户流水被对账忽略。

## 3.7 对账闭环一句话

> **每天选个截止时间点 → 先查账本自己平不平 → 平了再逐个钱包跟外部世界比 → 比不上的开 case → 下次跑时自己平了的 case 自愈 → 实在自愈不了的等人工查**。

---

# 附录 A：术语与代码位置索引

| 概念 | 代码位置 |
|---|---|
| 8 个 COA 定义 | `src/modules/accounting/tigerbeetle/constants/tb-account-codes.constant.ts` |
| Transfer code 定义 | `src/modules/accounting/tigerbeetle/constants/tb-transfer-codes.constant.ts` |
| 币种 ledger | `src/modules/accounting/tigerbeetle/constants/tb-ledgers.constant.ts` |
| 记账核心服务 | `src/modules/accounting/tigerbeetle/accounting.service.ts` |
| 凭证表服务 | `src/modules/accounting/tigerbeetle/tb-evidence.service.ts` |
| Deterministic ID | `src/modules/accounting/tigerbeetle/utils/tb-id.util.ts` |
| AccountFlow 投影 | `src/modules/clearing-settle/reconciliation/projector/account-flow-projector.service.ts` |
| 充值 workflow | `src/modules/trading/deposit-transactions/deposit-workflow.service.ts` |
| 充值 inbound 入口 | `src/modules/trading/deposit-transactions/inbound-transfer-signals.service.ts` |
| 提现 workflow | `src/modules/trading/withdraw-transactions/withdraw-workflow.service.ts` |
| 兑换 workflow | `src/modules/trading/swap-transactions/swap-workflow.service.ts` |
| Swap leg plan | `src/modules/funds-layer/constants/swap-leg-plan.constant.ts` |
| Swap leg 记账 | `src/modules/trading/swap-transactions/swap-leg-accounting.ts` |
| 对账 run 入口 | `src/modules/clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts` |
| 余额检查 | `src/modules/clearing-settle/reconciliation/engine/v2/wallet-balance-checker.service.ts` |
| 流水匹配 | `src/modules/clearing-settle/reconciliation/engine/v2/wallet-flow-matcher.service.ts` |
| 对账 admin API | `src/modules/clearing-settle/reconciliation/controllers/reconciliation-admin.controller.ts` |
| 大额审批阈值 | `src/modules/trading/withdraw-transactions/constants/withdraw-approval.constant.ts` |

# 附录 B：Phase C 未完成项

- Case 处置 workflow（CLOSE / WAIVE / 指派 / SLA）
- 自动 reimbursement（差账自动推冲账资金单）
- 真实接入 HexTrust / Zand API（替换 mock adapter）
- 对账定时自动跑（替换手动 trigger）
- 旧 V8 五公式引擎物理删除（当前仅 `@deprecated`）
- 旧死服务删除（`funds-accounting` / `fx-eod` / `fiat-settlement` / `internal-transfer-workflow` 等仅 neuter 未删）
- 投影表 `tbAccountId` 32 字符 padding 统一（当前历史 / 新数据混存 31/32 字符两种）
