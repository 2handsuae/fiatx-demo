# 对账重构 — 设计 spec（交付 CC 实现）

日期：2026-06-20
状态：设计定稿，待实现
前置：两本账记账体系（spec 2026-06-10）、Model A 法币净额结算（2026-06-09）
背景设定：**法币(AED)当日实时结算；虚拟币(USDT)次日 EOD 结算；EOD 放在次日 00:30，cutoff = 业务日 D 的 00:00（D 结束）。**

> **⚠️ 实现对齐补注（2026-06-21，以 live code 为准；本 spec 写定后代码有微调）**：
> 1. **结算/费用路由钱包 = `F_OPS`**（原 spec/Model A 的 `F_LIQ` 已废）：法币本金 `C_VIBAN↔F_SET↔F_OPS`、crypto 本金 `C_MAIN↔F_OPS`、swap 费 `F_OPS→F_FEE`、提现费 `C_VIBAN/C_MAIN→F_FEE`；`F_SET` 仅作法币两跳中转，`F_LIQ` 退出结算路径（仍是 `FIRM_TREASURY` 名下钱包）。源：`internal-transfer-paths.constant.ts`。
> 2. **式2 加项**：`客户块 = OPEN Outstanding net − 未去混同提现费`（§3 已同步改）。
> 3. **清桥门控 + 触发**：仅"两腿全 SETTLED"的 swap 才清桥（`fx-eod.service`：open = 任一 Outstanding ≠ SETTLED）；清桥既在**每腿 CLEAR**（sweep-only）、也在 **EOD**（sweep+reval）触发，不止 §1.5 写的 EOD 一处。EOD 两大任务 = ①结算当天剩余 crypto（本金+费）②清桥+FX重估+五公式。
> 4. **结算批 6 型 `settlementType`**：`{FIAT|CRYPTO}_{PRINCIPAL|WITHDRAW|SWAP}`（本金 / 提现费 / 兑换费），强类型防呆；兑换费 accrual 再拆 `feeKind = SERVICE_FEE + SPREAD`，提现费 `feeKind = WITHDRAW_FEE`。源：`settlement-type.constant.ts` / `fee-accrual.service.ts`。

> 本 spec 覆盖四块：① swap + 日终结算全套记账；② 外部 statement 接入（余额头表 + 归一化行表）；③ credit-net 对账五公式；④ 下钻匹配找差异。所有金额用 **credit-net 口径（credits − debits，贷正借负，同币种）** 表达，符号机械化、同币种总和恒 = 0。

---

## 0. 核心原则（实现时不可偏离）

1. **点差/手续费在成交 T1 确认**（进 `SPREAD_INCOME`/`FEE_INCOME`），**头寸按 mid 扛**；不要递延到 LP 平盘。
2. **EOD 整笔清桥**：只清"两腿都 SETTLED"的 swap；部分结算的 swap 整笔不清桥。
3. **重估只重标 base 币(AED)估值腿**，数量腿(外币)不动；头寸保持开口，直到 LP 平盘才归零。
4. **`FX_UNREALIZED_PNL`/`FX_REALIZED_PNL` 只在 base 币(AED)**；`FX_POSITION` 多币种、`FEE/SPREAD` native。
5. **book 跟物理账户走**，不跟转账走；跨本账转账 = 两条流水（客户账出 + 公司账入），靠同一 InternalFund 接缝。
6. **对账匹配键 = (account, direction, currency, external_ref)，不含金额**；金额是配上之后再校验（否则"金额不符"会变成两条孤儿）。

---

## 0.5 本期范围（2026-06-20 scope 决策）

- **LP 平盘（事件④）本期不做**：FX 头寸保持开口、EOD 重估只留 `FX_UNREALIZED_PNL` 浮盈；不平盘、不落 `FX_REALIZED_PNL`（COA 保留该科目，本期恒 0）。
- **外部 statement 接入用假数据，不在清洗映射上投入**：归一化行表 schema（§2.2）+ 余额头表（§2.1）是唯一契约；Zand/HexTrust → 表的清洗（§2.3）按假数据走，**缺字段即合成（"当我们有"）**，不追求映射保真。
- **内部资金单（payin / payout / internal_fund）→ 账户腿投影（§4.1）是实打实**：以真实数据为准；**缺数据就补全**（回填 txHash / referenceNo、缺失终态字段等）。
- 真功夫在：**内部腿投影 + 匹配引擎 + 五公式 + 四异常桶**；外部侧只是喂给它的假"真相"。

---

## 1. 记账（swap + 日终结算）

### 1.1 COA（credit-net 贷正借负）

| Code | 科目 | Class | 方向性 | 币种性 |
|--:|---|:-:|---|---|
| 1 | `CLIENT_BANK` | A 资产 | 借 | 法币(聚合) |
| 10 | `CLIENT_CUSTODY` | A 资产 | 借 | 虚拟币(聚合) |
| 50 | `FIRM_TREASURY` | A 资产 | 借 | 全币种 |
| 60 | `FX_POSITION` | A 资产·**双向** | 借/贷 | 多币种(每币一条腿) |
| 100 | `CLIENT_PAYABLE` | L 负债 | 贷 | per-customer |
| 101 | `DEPOSIT_SUSPENSE` | L 负债 | 贷 | per-customer |
| 110 | `TRADE_CLEARING` | L 桥·**双向** | 借/贷 | 全币种 |
| 200 | `PAID_IN_CAPITAL` | E 权益 | 贷 | 全币种 |
| 210 | `RETAINED_EARNINGS` | E 权益 | 贷 | 全币种 |
| 300 | `FEE_INCOME` | R 损益 | 贷 | native |
| 310 | `SPREAD_INCOME` | R 损益 | 贷 | native |
| 320 | `FX_UNREALIZED_PNL` | R 损益·双向 | 借/贷 | **仅 base(AED)** |
| 330 | `FX_REALIZED_PNL` | R 损益·双向 | 借/贷 | **仅 base(AED)** |

### 1.2 计价（T1 快照锁死在 swap 行）

```
mid    = fromAmount × r0                                  (r0 = 成交参考中间价)
gross  = round(fromAmount × r0 × (1 − markupBps/10000), toDecimals)
fee    = flat 服务费(取自费率配置, to 币)
net    = gross − fee
spread = mid − gross
恒等: net + fee = gross ; gross + spread = mid
```

### 1.3 事件①　T1 成交（4 腿原子 linked transfer，立即 posted）

```
借 CLIENT_PAYABLE(from) / 贷 TRADE_CLEARING(from)  = fromAmount   [SWAP_LOCK_FROM]
借 TRADE_CLEARING(to)   / 贷 CLIENT_PAYABLE(to)    = gross        [SWAP_CREDIT_TO]
借 CLIENT_PAYABLE(to)   / 贷 FEE_INCOME(to)        = fee          [FEE 收入·T1认]
借 TRADE_CLEARING(to)   / 贷 SPREAD_INCOME(to)     = spread       [SPREAD 收入·T1认]
```
旁挂：建 **Outstanding** 两腿 —— `from 腿 OUT amount=fromAmount`、`to 腿 IN amount=net`；markup/mid 存 swap 行。
效果：`bridge(from)=+fromAmount`、`bridge(to)=−mid`；`CLIENT_PAYABLE(to)` 净增 net。

### 1.4 事件②　某腿实物结算（法币当日实时 / 虚拟币次日 EOD）

按腿币种是法币(实时)还是虚拟币(EOD)分别触发；**只做物理 mirror，不碰费/点差(T1已认)，不清桥(留事件③)**。

```
该腿=to(客户买该币,IN):  借 A.CLIENT_*(腿币) / 贷 A.FIRM_TREASURY(腿币) = net        [SETTLE_FIRM_TO_POOL]
该腿=from(客户卖该币,OUT):借 A.FIRM_TREASURY(腿币) / 贷 A.CLIENT_*(腿币) = fromAmount  [SETTLE_POOL_TO_FIRM]
```
关闭该腿 Outstanding（→ SETTLED）。`CLIENT_*` = 法币 `CLIENT_BANK` / 虚拟币 `CLIENT_CUSTODY`。

> 提现费（区别于 swap 费）：T1 两阶段 pending `CLIENT_PAYABLE→FEE_INCOME`；去混同 `CLIENT_BANK→FIRM_TREASURY`（`FEE_DECOMMINGLE`，**真 TB 分录**，钱从客户账本搬公司账本）。swap 费无去混同（to 腿只交 net，费天然留公司侧）。

### 1.5 事件③　EOD（次日 00:30）：整笔清桥 + 重估

**③a 清桥**（每币种；仅"两腿都 SETTLED"的 swap 聚合贡献）：
```
桥为贷方余额: 借 TRADE_CLEARING / 贷 FX_POSITION          [BRIDGE_SWEEP]
桥为借方余额: 借 FX_POSITION / 贷 TRADE_CLEARING
```
桥贡献口径：每笔 swap `from 币 +fromAmount`、`to 币 −(gross+spread)=−mid`，按币种聚合。部分结算 swap 整笔不清。

**③b 重估**（base 币 AED；对每个有 `FX_POSITION` 非 0 的外币头寸）：
```
qty    = FX_POSITION(外币) 数量(不动)
marked = qty × fixing                       (fixing = EOD 取的 mid 快照)
delta  = marked − FX_POSITION(AED 当前账面)
delta>0(赚): 借 FX_POSITION(AED) / 贷 FX_UNREALIZED_PNL = delta   [FX_REVAL]
delta<0(亏): 借 FX_UNREALIZED_PNL / 贷 FX_POSITION(AED) = |delta|
```
**只动 AED 估值腿，数量腿不动，头寸不清零**（整仓重标、昨日 mark 被覆盖）。
成本可还原：`FX_POSITION(AED) − FX_UNREALIZED = 成本基础`。

### 1.6 事件④　LP 平盘（偶发，真实与 LP 成交；非每日）

```
① 币腿:   借 FX_POSITION(币) / 贷 FIRM_TREASURY(币) = qty(多头)        [FX_REALIZE]
② AED腿:  借 FIRM_TREASURY(AED) / 贷 FX_POSITION(AED) = qty × fillRate
③ 残值:   FX_REALIZED_PNL ↔ FX_POSITION(AED) = 账面残差(回款−账面)
④ 浮动回转:浮亏 借 FX_REALIZED / 贷 FX_UNREALIZED；浮盈反向  (清掉 FX_UNREALIZED)
```
平盘后 `FX_POSITION` 两腿归 0、`FX_UNREALIZED` 归 0、损益落 `FX_REALIZED`。
**本期不实现（见 §0.5）**：FX 头寸保持开口、EOD 重估留浮盈即可，事件④整体延后；上面分录仅留作未来参考，本期 `FX_REALIZED_PNL` 恒 0。

### 1.7 充值记账（纯客户账本）

```
T0(确认/到账,放行前): 借 CLIENT_CUSTODY|CLIENT_BANK / 贷 DEPOSIT_SUSPENSE
T1(合规放行):         借 DEPOSIT_SUSPENSE / 贷 CLIENT_PAYABLE
```

### 1.8 EOD 运行顺序

```
1. 虚拟币腿净额结算 (INTERNAL_OUT/IN, SETTLE_*)
2. 虚拟币提现 fee 去混同 (FEE_DECOMMINGLE)
3. 整笔清桥 (BRIDGE_SWEEP)
4. FX 重估 (FX_REVAL)
5. 对账校验 (第 3 节五公式) + 三桶日报
```

---

## 2. 外部 statement → 余额头表 + 归一化行表

> **本期：用假数据喂这两张表（§0.5）。** schema 是契约；Zand/HexTrust 清洗低投入、缺字段合成。§2.3 字段映射按假数据尽力填，不追求保真。假对账单**以真实内部资金单为基底生成**（含刻意 break），见现有 `recon-statement-demo` 思路。

### 2.1 余额头表 `external_balances`（每账户每 cutoff 一行）

| 字段 | 必须 | 说明 |
|---|:-:|---|
| `source` | ✓ | ZAND / HEXTRUST / CHAIN |
| `account_ref` | ✓ | 对账主体（**法币滚到 CMA**，见 2.5） |
| `currency` | ✓ | AED / USDT |
| `book` | ✓ | 客户 / 公司（按 cutoff 快照映射） |
| `cutoff_date` | ✓ | 业务日 D |
| `closing_balance` | ✓ | **核这个**；Zand 取最新行 Balance |
| `opening_balance` | 建议 | 连续性 + roll-forward 自检 |
| `as_of_at` | 建议 | 外部余额精确时点（可能 ≠ 你的 cutoff） |
| `statement_id` | 建议 | 关联原始对账单 |
| `line_count` / `ingested_at` / `status` / `raw_ref` | 运维 | |

唯一键 `UNIQUE(source, account_ref, cutoff_date)`。
**余额对账直接用来源报的 closing_balance，不用明细加总**（明细只用于下钻）。

### 2.2 归一化行表 `external_statement_lines`（每笔一行）

| 字段 | 说明 |
|---|---|
| `id` | PK |
| `source` | ZAND / HEXTRUST / CHAIN |
| `account_ref` | **法币滚到 CMA**（用于余额求和） |
| `sub_account` | 原始 VirtualAccount / walletId（**保留！** 下钻 + 充值模糊配） |
| `book` | 客户 / 公司 |
| `currency` | |
| `direction` | **入 / 出**（按余额增减；不用银行原始借贷） |
| `amount` | |
| `external_ref` | 出金=你的号(回显)；入金=空(法币)或 txHash(虚拟币) |
| `channel_ref` | Zand ChannelRefId（关联"出金↔退汇"用，**会重复**） |
| `datetime` | 精确入账时刻 |
| `balance_after` | 行后余额（法币=主账户级） |
| `description` | 分类（Incoming/Outgoing/Return/Intra…） |
| `statement_id` / `raw` / `ingested_at` | |
| `dedup_key` | 内容组合键（见 2.4） |

### 2.3 字段映射

**Zand（trade.json 格式）：**

| 归一化 | Zand 来源 | 备注 |
|---|---|---|
| account_ref | `VirtualAccount` → 滚到 CMA；缺失回落 `StatementInfo.AccountId` | ⚠ 部分记录无 VirtualAccount |
| sub_account | `VirtualAccount`（保留原值） | |
| direction | `TransactionType`：Credit→入 / Debit→出 | |
| currency | `TransactionAmount.Currency` | |
| amount | `TransactionAmount.Amount` | |
| external_ref | **出金**=`InstructionIdentification`(你的 W 号回显)；**入金**=空（`"Ref: CUSTOMERREF3000"` 是付款方号，不用） | |
| channel_ref | `ChannelRefId`（出金↔退汇共享，**不唯一**） | |
| datetime | `PostedDate` | |
| balance_after | `Balance`（**主账户级**） | |
| description | `Description`(+`Remarks`) | Return=退汇分支 |

**HexTrust（GET /transactions；确切字段名以 openapi.json 为准，下为待确认占位）：**

| 归一化 | HexTrust 来源 | 备注 |
|---|---|---|
| account_ref | walletId / subWalletId（滚到客户crypto池或保留逐钱包） | ⚠ 确认字段名 |
| direction | deposit→入 / withdrawal→出 | ⚠ |
| currency | asset / token | ⚠ |
| amount | amount | ⚠ |
| external_ref | **txHash**（进出都有）；出金另带你 POST 时的 **`x-request-id`** | x-request-id = 你的客户号 |
| datetime | createdAt | ⚠ |
| status | transaction status（过滤终态） | ⚠ |
| 余额 | **不在此接口**，另调 wallet balances 接口喂余额头表 | ⚠ |

### 2.4 去重（外部真重复）

`ChannelRefId` **不唯一**（出金和退汇共享、批量共享），不能单独做键。用**内容组合键**：
```
dedup_key = hash(source, sub_account, datetime, direction, amount, channel_ref, external_ref)
```
**优先用来源的逐条 posting/booking id（若 Zand/HexTrust 提供）作唯一键**；内容组合 `dedup_key` 仅作兜底（极端"同时刻·同额·同向·同 ref"会误并，接受为已知边界）。upsert，重复拉是 no-op。

### 2.5 法币按 CMA 滚（决策）

法币 `account_ref` 一律滚到 **CMA**：
- 内部 `CLIENT_BANK(AED)` 本就是聚合系统账（不分 VIBAN），Zand 也只给主账户余额 → CMA 级两边天然 1:1。
- 银行自理 VIBAN→CMA 归集，VIBAN 是入金路由标签。
- **但行表必须保留 `sub_account=VirtualAccount`**：① 充值模糊配缩范围；② break 下钻定位客户。
- 逐客户债权仍在 `CLIENT_PAYABLE`（TB 负债侧 per-customer），客户级追踪不丢。

---

## 3. 对账五公式（credit-net，全收敛到 = 0）

三个块（同币种 credit-net 相加）：
```
客户块 = CLIENT_BANK/CUSTODY + CLIENT_PAYABLE + DEPOSIT_SUSPENSE
桥块   = TRADE_CLEARING
公司块 = FIRM_TREASURY + FX_POSITION + PAID_IN + RETAINED + FEE + SPREAD + FX_UNREALIZED + FX_REALIZED
```

### 账内三式（只读 TB + 子账）

**式1　总账恒等（试算平衡）**
```
客户块 + 桥块 + 公司块 = 0          (展开 = 全账每账户 cn 求和 = 0)
```

**式2　客户勾稽（TB 客户块 ↔ Outstanding 子账 − 未去混同提现费）**
```
客户块cn = (ΣIN − ΣOUT)_OPEN Outstanding − 未去混同提现费        (IN 记 +，OUT 记 −)
★ 仅 OPEN(未 SETTLED) 的 Outstanding 腿；某腿实物结算→该腿 SETTLED→退出求和（与客户块同步减）
★ 未去混同提现费 = category=WITHDRAW_FEE 且 status≠SETTLED 的提现费：扣客户 claim 时客户块即减，
  但物理去混同(client pool→F_FEE)在 EOD/手动才发生 → RHS 须减该段在途，两侧才同步；
  swap 费已 netted 进 Outstanding net，不重复扣。（live code: formula-checker.formula2）
```

**式3　桥勾稽（TB 桥块 ↔ swap 子账）**
```
桥块cn − Σ(swap 桥贡献) = 0                     (from 腿 +fromAmount，to 腿 −mid)
★ 仅未清桥(非两腿全 SETTLED)的 swap；整笔清桥后该 swap 退出求和（与桥块同步减）
```
> 公司块（≈I4）= 派生：`公司块 = −(客户块+桥块)`，式1/2/3 成立即自动成立，不单查。
> FX 头寸完整性（I3，可选交叉验证）：`FX_POSITION(AED) − FX_UNREALIZED = 成本 = Σ持仓swap(gross+spread)`。

### 账外两式（内部 ↔ 外部真实，扣在途）

**式4　客户账外**
```
客户池(CLIENT_BANK/CUSTODY) = Σ客户外部余额(external_balances where book=客户) ± 在途时序
```
**式5　公司账外**
```
FIRM_TREASURY = Σ公司外部余额(external_balances where book=公司) ± 在途时序
```

### 在途时序项（式4/5 右侧的 ±）

| 类 | 项 | 方向 |
|---|---|---|
| 流入在途 | 虚拟币充值已上链未确认入账；法币已到 VIBAN 未匹配 | 外部 > 内部 |
| 流出在途 | 提现已 TB post、币还在 C_OUT/链上未确认；法币已 post、银行未结算 | 外部 > 内部 |
| 内部转账在途 | 归集 C_DEP→C_MAIN 未 CLEAR（只影响逐钱包，不影响总额） | — |
| 外部独有 | 银行 per-tx 手续费已扣未记；意外入金/孤儿充值 | 外部 ≠ 内部 |
| 切点差 | 内部 cutoff 与外部对账单 cutoff 不同步 | 结构性，单独 bucket |

> swap 结算腿（C_MAIN→F_OPS 等）在 cutoff 内外都 pre-settlement，**不是账外时序项**，由式2 Outstanding 管。

---

## 4. 下钻匹配（找流水差异）

### 4.1 内部三表投影成"账户腿"（read-time，只取终态）

```
Payin(CLEARED)        → 1 腿: (toWallet,   入, ccy, amount, txHash,    'PAYIN', id)
Payout(SUCCESS)       → 1 腿: (srcWallet,  出, ccy, amount, payoutRef, 'PAYOUT', id)
InternalFund(CLEAR)   → 2 腿: (fromWallet, 出, ccy, amount, txHash, 'INTERNALFUND', id)
                                (toWallet,   入, ccy, amount, txHash, 'INTERNALFUND', id)
```
法币腿的 account 同样滚到 CMA、保留 sub_account=VIBAN。在途（未终态）不投影 → 它们是式4/5 的在途时序，不是 break。**投影源是真实 payin/payout/internal_fund（§0.5）；缺数据按需补全（回填 txHash/referenceNo、缺失终态字段）。**

### 4.2 匹配（外部已去重）

主匹配（有 external_ref）：
```
internal_legs ⟗(full outer) external_lines
  ON (account, direction, currency, external_ref)     ← 不含金额
配上后比 amount。
```
回退匹配（无 external_ref，主要是法币充值）：
```
ON (sub_account/VIBAN, direction, currency, amount, datetime ± 窗口)   ← 模糊,可能要 1:1 贪心或人工
```

### 4.3 四个异常桶 + 定性

```
i 有 + e 有 + 金额等   → ✓ pass
i 有 + e 有 + 金额异   → ⚠ 金额不符   → 银行扣费/部分到账/汇率差 → 更正
i 有 + e 无           → ⚠ 内部有外部无 → 看状态:在途=时序(下期消);终态=真break(记了没发生)
i 无 + e 有           → ⚠ 外部有内部无 → 银行费没记/孤儿入金/漏记 → 补记或查
```
退汇（Description=Return）：用 `channel_ref` 关联回原出金。
轧差：EOD N 笔 swap = 1 笔 InternalFund(1 txHash)，在 **InternalFund 层**配，不在 swap 层；swap/Outstanding 无外部对手。

### 4.4 串链 + case
用 `traceId/originTraceId` 把内部流水串回源头（充值/兑换/提现）。净差 > 容差 → 建 `ReconciliationCase`，逐笔比对定位，分配 Finance；公司欠/被欠走 `ReimbursementObligation`（CFO/MLRO 审批，资金侧通用内部转账 + TB 补 CLIENT_PAYABLE）；24h 升级 MLRO+CFO；安全保管缺口先用公司资本垫足再查。

---

## 5. 给 CC 的实现清单

**记账层**
- [ ] 校验四事件分录与 transfer code（SWAP_*/SETTLE_*/BRIDGE_SWEEP/FX_REVAL/FEE_DECOMMINGLE）符合第 1 节。**事件④ LP/FX_REALIZE 本期不做（§0.5），`FX_REALIZED_PNL` 恒 0。**
- [ ] 清桥仅对两腿 SETTLED 的 swap；重估只动 AED 腿、头寸不清零。

**外部接入层（本期假数据 §0.5，低投入）**
- [ ] 建 `external_balances` + `external_statement_lines`（schema 见 2.1/2.2）。
- [ ] 假对账单生成器：**以真实 payin/payout/internal_fund 为基底**合成 Zand/HexTrust 行+头表余额（含刻意 break），缺字段合成；不追求映射保真。
- [ ] Zand 解析器：按 2.3 映射；direction=Credit/Debit→入/出；出金 external_ref 取 InstructionIdentification；法币 account_ref 滚 CMA、保留 sub_account；dedup_key 用内容组合键。
- [ ] HexTrust 解析器：txHash + x-request-id 为 ref；余额另调 wallet balances 接口；字段名对照 openapi.json 确认。
- [ ] 出金指令把内部单号写进 Zand InstructionIdentification / HexTrust x-request-id（保证回显可配）。

**对账层**
- [ ] credit-net 工具（每账户 credits−debits）。
- [ ] 账内式1/2/3（TB + **OPEN** Outstanding + **未清桥** swap 行）；式4/5（vs external_balances，扣在途）。
- [ ] 内部腿投影视图（4.1）；匹配引擎（4.2，主键不含金额）；四桶 + 定性（4.3）。
- [ ] `ReconciliationCase` + 复用 `ReimbursementObligation`；SLA 升级。

**注意事项（避免重蹈覆辙）**
- 匹配键不含金额；金额配上后再校。
- ChannelRefId 不唯一，不能单独去重；跨账户两条腿不能合并去重。
- book 跟账户走；跨本账转账两条腿靠同一 InternalFund 接缝。
- FX_UNREAL/REAL 只在 AED。
- 余额对账用来源 closing_balance，不靠明细加总。
