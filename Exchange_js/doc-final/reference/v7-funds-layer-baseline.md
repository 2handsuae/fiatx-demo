# V7 资金层范围基线 (Funds Layer Scope Baseline)

> 状态：设计基线 / 讨论收口（pre-implementation）
> 适用：V7 内部转账 + 与之关联的 swap(V6)/withdraw(V5)/deposit(V4) 记账接口
> 说明：本文是 V7 资金层的**范围与实体归属基线**，用于真正动手前对齐"建什么、不建什么、为什么"。带 ❓ 的为待确认项，见 §6。

---

## 0. 一句话定义

> V7 把前面版本"账面已记、物理未动"的资金，在公司钱包/账户之间做真实的链上/银行移动；EOD 对 swap 产生的待交割头寸做轧差结算，并归集费用。**所有内部转账都是真实链上交易或银行指令，无纯账面划拨。**

---

## 1. 概念分层（5 层，别合并）

| 层 | 实体 | 职责 | 谁产生 |
|---|---|---|---|
| 执行层 | **funds flow（资金单 / InternalFund）** | 一笔真实链上 tx / 银行指令；txHash、确认数、状态机、失败重试 | 每条内部转账都有 |
| 编排层 | **Transaction（结算单 / Pool Settlement Batch）** | 按资产轧差、N:1 关联、幂等重跑 | 仅 EOD 结算 + 费用归集 |
| 交割义务 | **Outstanding** | swap 成交时的逐客户待交割债权（IN/OUT） | **仅 swap (V6)** |
| 收入费用 | **FEE_RECEIVABLE**（TB 账户 code 120） | 沉淀收入型 fee，待归集到 Ops | swap/withdraw（+❓deposit） |
| 偿付义务 | **Reimbursement Obligation** | 公司因异常/纠错欠回某方的钱（逐笔、带审批） | 异常事件 |

**铁律**
- 交割义务（Outstanding）与偿付义务（Reimbursement）**分开建**，生命周期不同：前者常规轧差、后者异常逐笔。
- 收入型 fee 进 FEE_RECEIVABLE；**成本型费用（gas/银行费）不是 fee，不进 FEE_RECEIVABLE**，减的是公司钱。
- TB 托管边界：`CUSTODY`/`BANK` 只记客户应得资产；**Liquidity / Ops 在边界之外**。

---

## 2. 总表 A — 义务（Obligations）

| 类型 | 场景 | 谁欠谁 | 实体 | MVP 建？ | 触发来源 |
|---|---|---|---|---|---|
| **交割义务** | swap 待交割（客户↔公司 FX） | 互为对手盘 | **Outstanding** | ✅ 建 | swap 成交 (V6) |
| 交割义务 | 充值 | — | 无 | — | 资产物理已到池，不产生 |
| 交割义务 | 提现 | — | 无 | — | 净额实时出账，不产生 |
| **偿付义务** | 提现失败/stuck/拒绝退回 | 公司→客户 | void pending（简单）/ **Reimbursement**（延迟） | ✅ 最小版 | 提现异常 |
| 偿付义务 | 法币入金被银行冲正(bounce) | 客户→公司(clawback) | **Reimbursement** | ✅ 最小版 | 银行 reversal webhook |
| 偿付义务 | 充值反转/超额退回 | 公司→发款方 | **Reimbursement** | ⏸️ 推后 | 充值异常 |
| 偿付义务 | 费用多收/算错退还 | 公司→客户 | **Reimbursement** | ⏸️ 推后 | 纠错 |
| 偿付义务 | 运营错误补偿（发错额/地址） | 公司→客户 | **Reimbursement** | ⏸️ 推后 | 人工/repair |
| 偿付义务 | 促销/补贴/goodwill | 公司→客户 | **Reimbursement** | ⏸️ 推后 | 营销 |
| 其他义务 | VAT/税应付 | 公司→FTA | **税应付**（独立） | ❓先问财务 | fee 收取时 |
| 其他义务 | LP 净额 | 公司↔LP | LP 仓位项 | ⏸️ 推后 | LP 结算 |
| 其他义务 | 孤儿/suspense | 公司→未定 | suspense | ⏸️ 推后 | 无主资金 |

---

## 3. 总表 B — 费用（Fees / Costs / Tax）

### B1. 收入型 fee（→ FEE_RECEIVABLE，公司赚）
| fee | 记账 | MVP | 备注 |
|---|---|---|---|
| Swap 兑换费 | `CLIENT_CREDIT→FEE_RECEIVABLE`（to 币） | ✅ 已有 | |
| Swap 点差 spread | `TRADE_CLEARING→FEE_RECEIVABLE`（to 币） | ✅ 已有 | 公司毛利，留公司侧 |
| 提现费 | `CLIENT_CREDIT→FEE_RECEIVABLE` | ✅ 已有 | ❓构成（纯收入 or 含银行费转嫁） |
| 充值费 | `CLIENT_CREDIT→FEE_RECEIVABLE` | ❓确认收不收 | 当前 V4 未收 |
| 加急/优先提现费 | 同上 | ⏸️ | |
| 休眠/失败/小额费 | 同上 | ⏸️ | 费种一多 → 统一 fee 入口 |

### B2. 成本型费用（**不是 fee**，减公司钱）— **均为固定 OpEx，不进 V7 交易记账**
> 决策：链上 gas 走 HexTrust gas station（打包自担）；银行为**年付固定服务费**（不按笔收）。
> 结果：**两侧都无 per-transaction 成本** → 转账额里不扣费、客户天然 1:1、**无需成本分摊/逐笔对账**；这些成本是财务的固定 P&L OpEx，**V7 funds flow/结算层完全不碰**。

| 成本 | 谁收 | 处理 | MVP |
|---|---|---|---|
| 链上 gas | HexTrust（gas station） | 打包自担，**不进客户托管 TB**，固定 P&L | ✅ V7 外 |
| 银行转账费 | Zand | **外部交易（payin/payout）按笔收费**，从公司 fee account 扣；intra-bank（VA↔CMA）大概率免费（❓待确认）→ 公司 P&L OpEx，V7 外 | ✅ V7 外 |
| 托管费 / KYC / KYT 供应商费 | HexTrust/Sumsub | 固定/按量运营成本 | ⏸️ |
| LP 点差/费 | LP | LP 结算成本 | ⏸️ |

> **连带影响**：成本既不按笔收，"省转账笔数 = 省钱"的动机**大幅减弱**。法币 per-VA 的"1 笔 vs N 笔"在**成本上不再痛**；批量/降频降级为**运营选择**（吞吐/限流/对账量），非成本强制。
> **Caveat**：① FTS（大额）常另有按笔/按额费——务必跟 Zand 确认是否纯年费；② gas 仍是真实经济成本（链上真烧币），不必要的链上转账仍属浪费。

### B3. 税
| 项 | 处理 | MVP |
|---|---|---|
| UAE VAT 5% | fee 含税 or 加税；VAT 应付是对 FTA 的义务 | ❓**先问财务**（若 fee 要收 VAT 则是合规硬需求，需早做） |

---

## 4. 总表 C — 7 条 MVP 资金路径映射

记账类：**A**=客户资产搬位置（边界内，零 TB）｜**B**=跨主体交割（drain TRADE_CLEARING/FEE）

| # | 路径 | From → To | 介质 | 类 | funds flow / +Transaction | Outstanding | fee |
|---|---|---|---|---|---|---|---|
| 1 | 充值归集(币) | 客户充值地址 → Main | 链上 | A | 直接 funds flow | ✗ | ✗ |
| 2 | 法币归集 | 客户 VA → 集中账户 | 银行 | A | 直接 funds flow | ✗ | ✗ |
| 3 | 出金预归集 | Main → Outbound | 链上 | A | 直接 funds flow（parent=提现） | ✗ | ✗ |
| 4 | 出金退回 | Outbound → Main | 链上 | A | 直接 funds flow（repair） | ✗ | ✗ |
| 5 | 卖出交割 INTERNAL-OUT | Main/集中账户 → Liquidity | 链上/银行 | B | **+Transaction** | ✓ 消费 OUT，量=Outstanding OUT | ✗ |
| 6 | 买入交割 INTERNAL-IN | Liquidity → Main/集中账户 | 链上/银行 | B | **+Transaction** | ✓ 消费 IN，量=Outstanding IN + swap fee | ✓ 量含 fee（随头寸注入，留 FEE_RECEIVABLE） |
| 7 | 手续费归集 FEE-COLLECT | pool → Ops | 链上/银行 | B | **+Transaction** | ✗ | ✓ drain FEE_RECEIVABLE（swap费+点差+提现费） |

**规则**
- 直接 funds flow（1–4）：1:1、无轧差、无 Outstanding/fee，cron/事件直接造资金单。
- +Transaction（5–7）：需轧差 + N:1 + 幂等 → 编排单 spawn funds flow。5/6 属同一 **EOD 结算 Transaction**（每资产按净方向出一条）；7 属独立 **费用归集 Transaction**（可低频）。
- ⚠️ 法币侧若 Zand 仅 per-VA：一个 Transaction 轧出净额后 **spawn N 笔 funds flow**（每 VA 一笔）；加密侧 spawn 1 笔。

---

## 5. 不变量速查（记账闭环）

- TB 账户：`BANK(1)` `CUSTODY(10)` | `CLIENT_CREDIT(100)` `CLIENT_AUDIT(101)` `TRADE_CLEARING(110)` `FEE_RECEIVABLE(120)`。
- Swap 四腿（混合版）：
  1. `CLIENT_CREDIT(from)→TRADE_CLEARING(from)` = fromAmount
  2. `TRADE_CLEARING(to)→CLIENT_CREDIT(to)` = toAmount（毛）
  3. `CLIENT_CREDIT(to)→FEE_RECEIVABLE(to)` = fee
  4. `TRADE_CLEARING(to)→FEE_RECEIVABLE(to)` = spread
- 核心不变量：**TRADE_CLEARING(币) = Outstanding(币) + FEE_RECEIVABLE(币 swap 部分)**。
- EOD 结算量 = `|TRADE_CLEARING|`（= Outstanding + swap fee）；fee 归集量 = `FEE_RECEIVABLE`。
- A 类零 TB；B 类 drain `TRADE_CLEARING/FEE_RECEIVABLE ↔ CUSTODY/BANK`。
- 提现：`CLIENT_CREDIT→CUSTODY/BANK`(净，实时) + `CLIENT_CREDIT→FEE_RECEIVABLE`(费)；**不产生 Outstanding、无 EOD 净结算**，只贡献 fee。

---

## 6. 待确认项（open questions）

**Zand（法币）— 决定法币 EOD 是 1 笔还是 per-VA N 笔：**
1. CMA（母账户）能否作 Debtor 直接对外/对内出金？
2. 有无 VA→CMA 归集 / CMA→VA？无归集时钱在 VA 还是池？
3. VA 能否直接转去公司 Liquidity（INTRA）？
4. （已问出去的英文问题清单见沟通稿）

**财务/产品：**
5. 充值费收不收（尤其法币入金）？
6. 提现费构成：纯收入 vs 含银行费转嫁？
7. VAT 5% 是否适用于 fee？含税还是加税？是否需早做 VAT 应付？
8. ~~银行转账费：确认 Zand 是纯年费、转账免费，还是年费 + 每笔费。~~ **已确认（2026-06-03）**：Zand 对**外部交易（payin/payout，即与行外账户收付）按笔收费**，费用从公司侧 fee account 扣除，不从交易金额中扣。**结论**：① 成本型费用原则不变——不进 FEE_RECEIVABLE、不进客户 TB，仍为公司 P&L OpEx；② TB 记账不受影响；③ Payin/Payout 记录需补 `bankFee`/`bankFeeRef` 字段用于对账（V8）；④ "省转账笔数 = 省钱"动机**仅回归外部交易（V4/V5）**，V7 内部转账若为 intra-bank 则不适用。**残留确认项**：VA↔CMA intra-bank movement 是否也收 per-tx 费（大概率不收，待 Zand 明确）。

**模型：**
9. 集中账户 = CMA 还是指定 treasury VA（待 Zand 答复后定）。
10. Reimbursement Obligation 最小版边界：MVP 先覆盖"提现退回 + 银行 bounce"两类。
