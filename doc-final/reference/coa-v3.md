# 科目表 · COA v3（战役戊定稿导出）

> 状态：**现状（2026-11-07 戊波三定稿）**——科目表与 §2 记账总表都已按代码核对（`tb-account-codes.constant.ts`、`tb-transfer-codes.constant.ts` 与各工作流的记账调用）；规则叙述在 `modules/accounting-coa.md`，本文是它引用的全表与总表。
> 来源：战役戊总纲（`archive/superpowers/specs/2026-11-06-campaign-e-ledger-by-location-charter.md` 附录 A / B，已于 2026-11-08 随战役收官归档）。**总纲已不是依据**：科目表与总表以本文和代码为准，两者不一致以代码为准。
> 一句话：资产按「钱在哪儿」开户（每个真实账户 / 钱包一个现金户），负债、权益、收入、开支只记「是谁的、为什么」。

## 1. 科目表（COA v3）

**读法**：「类」由代码定义（科目码）；「户」= 类 × 币种 × 归属人。现金户的归属人是钱包，户名 = 类名 · 钱包名。英文名给管理台用；中文名给文档用。

| 大类 | 码 | 常量 | 中文名 | 英文名 | 开户粒度 | ownerType | 借/贷方户 | 开户时机 | 对应旧账本（COA v2） |
|---|---|---|---|---|---|---|---|---|---|
| 资产·客户本 | 1 | CLIENT_CASH（原 CLIENT_ASSET） | 客户现金 | Client Cash | 每个客户钱包一户 | WALLET | 借 | 钱包建行 | 客户资产合计 + 钱包标签 |
| 资产·客户本 | 2 | CLIENT_SHORTFALL | 托管短缺待补 | Custody Shortfall Receivable | 每个客户钱包一户 | WALLET | 借 | 钱包建行（与码 1 同开） | 无 |
| 资产·公司本 | 50 | FIRM_CASH（原 FIRM_ASSET） | 公司现金 | Company Cash | 每个公司钱包一户（7 户） | WALLET | 借 | 钱包建行 | 公司资产合计 + 钱包标签；**FIRM_SET(201) / FIRM_LIQ(203) 并入此类**成为「公司现金·结算 AED」「公司现金·LP 前厅 ×2」 |
| 资产·公司本 | 51 | LP_RECEIVABLE | 应收 LP 交货 | Due from LP | 每 LP 每币种 | LP（占用既有插座） | 借 | LP 档案 ACTIVE（审批批准 / 金库复活） | 无 |
| 负债·客户本 | 100 | CLIENT_PAYABLE | 应付客户 | Payable to Clients – Available Balance | 每客户每币种 | CUSTOMER | 贷 | 不变 | 不变 |
| 负债·客户本 | 101 | DEPOSIT_SUSPENSE | 客户暂扣 | Client Deposits Held – Pending Release | 每客户每币种 | CUSTOMER | 贷 | 不变 | 不变 |
| 负债·公司本 | 150 | VENDOR_PAYABLE | 应付供应商 | Payable to Vendors | 每供应商每币种 | VENDOR | 贷 | 不开户（不做月度计提） | 无 |
| 权益 | 200 | FIRM_EQUITY（原 FIRM_OPS） | 公司权益 | Company Equity | 每币种一户 | SYSTEM | 贷 | 上币 | 运营户的对手盘角色；本钱 + 交易净额；注资贷此户 |
| 收入 | 210 | INCOME_SWAP_FEE | 兑换费收入 | Trading Fee Income | 每币种一户 | SYSTEM | 贷 | 不变 | 不变（脱离 F_FEE 钱包映射） |
| 收入 | 211 | INCOME_WITHDRAW_FEE | 提现费收入 | Withdrawal Fee Income | 每币种一户 | SYSTEM | 贷 | 不变 | 不变 |
| 收入 | 212 | INCOME_OTHER | 其他收入 | Other Service Income | 每币种一户 | SYSTEM | 贷 | 不变 | 不变（没收、银行利息） |
| 开支 | 300 | EXPENSE_BANK_CUSTODY | 银行与托管费用 | Bank & Custody Charges | 每币种一户 | SYSTEM | 借 | 上币 | 无（旧账本借 FIRM_OPS） |
| 开支 | 301 | EXPENSE_RECON_LOSS | 对账核销损失 | Reconciliation Write-off Loss | 每币种一户 | SYSTEM | 借 | 上币 | 无（旧账本借 FIRM_OPS） |
| 开支 | 302 | EXPENSE_OTHER | 其他开支 | Other Expenses | 每币种一户 | SYSTEM | 借 | 上币 | 无 |

**退役码**：201 FIRM_SET、203 FIRM_LIQ（科目退役；钱包存续为 50 类下的现金户）；加入退役名黑名单（与 FIRM_FEE / FIRM_SEIZED 同列）。
**挂起、不开户**：应收垫款（追回链，等 Zand）。

**户名模式**（代码 `cashAccountName`）：钱包户 = `类名 · 钱包名`。平台钱包 = vault 标签 + 网络（例 `Company Cash · Company Operations · AED_ZAND`）；客户钱包 = 客户号 + 角色（`vIBAN` / `Deposit address`），码 1 例 `Client Cash · CU2601012635 · vIBAN`，码 2 例 `Custody Shortfall Receivable · CU2601012635 · vIBAN`。其余户「一码一名」（英文名取 `TB_ACCOUNT_NAMES`，即上表英文名列）。

**物理世界 ↔ 现金户（一比一）**

| 位置 | 托管方 | 币种 | 钱包行 | 现金户 |
|---|---|---|---|---|
| Zand 运营账户 | Zand | AED | F_OPS · AED_ZAND | 公司现金 · 运营 AED |
| Zand 结算账户 | Zand | AED | F_SET · AED_ZAND | 公司现金 · 结算 AED（原 FIRM_SET 科目） |
| Zand 手续费账户 | Zand | AED | F_FEE · AED_ZAND | 公司现金 · 手续费 AED |
| Zand LP 前厅账户 | Zand | AED | F_LIQ · AED_ZAND | 公司现金 · LP 前厅 AED（原 FIRM_LIQ） |
| HexTrust 运营地址 | HexTrust | USDT | F_OPS · TRON | 公司现金 · 运营 USDT |
| HexTrust 手续费地址 | HexTrust | USDT | F_FEE · TRON | 公司现金 · 手续费 USDT |
| HexTrust LP 前厅地址 | HexTrust | USDT | F_LIQ · TRON | 公司现金 · LP 前厅 USDT（原 FIRM_LIQ） |
| 客户 vIBAN（每客户） | Zand | AED | C_VIBAN | 客户现金 · <客户号> · vIBAN |
| 客户充值地址（每客户） | HexTrust | USDT | C_DEP | 客户现金 · <客户号> · 地址 |

不开户、只当对手方写在流水「对方」栏：客户自己的提现地址与银行账户、LP 的打款地址、供应商收款账户、出资方、当局。

**天平与不变量**

- 客户本：Σ(1) + Σ(2) = Σ(100) + Σ(101)，按币种。
- 公司本：Σ(50) + Σ(51) + Σ(300..302) = Σ(200) + Σ(210..212) + Σ(150)，按币种。
- 不负：全部户。借方户 `credits_must_not_exceed_debits`，贷方户 `debits_must_not_exceed_credits`。
- **公司权益 ≥ 公司现金·运营 恒成立**：差额 = 其他公司现金户 + 应收 LP + 未结转开支 − (已扫入运营户但未结转的收入)。最后一项靠「扫费同额结转」（码 90，见 §2 公司调拨单）钉为零，于是现金闸（出款前查公司现金·运营）顺带保住公司权益不负。谁给公司权益加一条不经现金的借方分录，这个保证就破了——已写进交付合同 S9。
- 逐客户控制报表（不是账本结构）：客户现金·该客户 + 短缺待补·该客户 = 应付 + 暂扣，逐客户算；法币改母账户模式时退化为总数，账本不改。

## 2. 七单与调账单记账总表（按代码实际落地导出，2026-11-07）

**读法**：每行 = 一笔账本转账。「转账码」是账本里的类型码（`tb-transfer-codes.constant.ts`，u16，一经分配不可改号）；借 / 贷写科目类，现金户后跟具体是哪只钱包；「eventCode」是凭证行上的事件码（同单据同 eventCode 的转账号相同，所以同一单据里两笔同形状分录必须换 eventCode）。每张凭证单币种，跨币种交易是两张凭证；客户本与公司本各自平，钱跨本时一次物理移动写两对分录；对方（客户自己的提现地址 / 银行账户、LP 打款地址、供应商收款账户、出资方、当局）永远不开户，只写在流水「对方」栏。

**两阶段（挂起 → 落账 / 作废）**：提现的本金与费、兑换每条腿的全部分录、充值的没收 / 退回 / 上缴，先 pending 锁定，成功后 post，失败 void。**post / void 是对同一笔挂起转账的翻转，账本里沿用挂起时的转账码**——码表里的 6 / 7 / 9 / 11 / 12 / 14 / 15 / 20 是保留的语义别名，代码没有任何调用点用它们建转账；这些行在下表里并入挂起那一行写。

### 充值（DEPOSIT）

| 步骤 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 钱到账（链上确认 / 银行到账） | 1 | 客户现金（落地钱包，1） | 客户暂扣（101） | `DEPOSIT_ASSET_TO_SUSPENSE` |
| 合规放行（不碰现金） | 2 | 客户暂扣（101） | 客户应付（100） | `DEPOSIT_SUSPENSE_TO_PAYABLE` |
| 低于最低额没收·腿 1（挂起，落账 / 作废） | 3 | 客户暂扣（101） | 客户现金（落地钱包，1） | `CONFISCATE_REVERSE_SUSPENSE`（作废 `…_VOID`） |
| 低于最低额没收·腿 2：钱打到手续费钱包（挂起，落账 / 作废） | 4 | 公司现金（手续费钱包，50） | 其他收入（212） | `CONFISCATE_INCOME_OTHER`（作废 `…_VOID`） |
| 退回来源方（挂起；落账补记为 POST 语义；作废） | 5 | 客户暂扣（101） | 客户现金（落地钱包，1） | `DEPOSIT_RETURN_PENDING` → `DEPOSIT_RETURN_POST` ／ `DEPOSIT_RETURN_VOID` |
| 上缴当局（挂起，落账 / 作废；对方栏是当局） | 8 | 客户暂扣（101） | 客户现金（落地钱包，1） | `SEIZE_REVERSE_SUSPENSE`（作废同名） |
| 入账后被银行追回（认领退汇；**入口置灰，代码保留**） | 21 | 客户应付（100） | 客户现金（落地钱包，1） | `DEPOSIT_CLAWBACK` |

### 提现（WITHDRAWAL）

| 步骤 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 建单，锁定本金（挂起） | 10 | 客户应付（100） | 客户现金（出款源钱包，1） | `WITHDRAW_LOCK_NET` |
| 建单，锁定费（挂起；费为 0 不建） | 13 | 客户应付（100） | 客户现金（出款源钱包，1） | `WITHDRAW_LOCK_FEE` |
| 出款确认：本金落账（对方 = 客户外部地址）；失败 / 取消则作废 | 10（post / void） | 同上 | 同上 | `WITHDRAW_NET_POST` |
| 出款确认：费落账；失败 / 取消则作废 | 13（post / void） | 同上 | 同上 | `WITHDRAW_FEE_POST` |
| 费到公司：费落账后公司侧收费 | 16 | 公司现金（手续费钱包，50） | 提现费收入（211） | `WITHDRAW_FEE_FIRM` |
| 出款后被银行 / 链上退回（费不退） | 17 | 客户现金（出款源钱包，1） | 客户应付（100） | `WITHDRAW_BOUNCE_REENTRY` |

### 兑换（SWAP）

每条腿开始时，该腿的全部分录一起挂起（pending），腿确认时一起落账；合规拒绝 / 失败则作废。腿 1 的挂起发生在建单 / 开始那一步。分录由 `swap-leg-plan.constant.ts` 定；现金贷方 = 该腿 fromRole 钱包、现金借方 = toRole 钱包。手续费收在**买入币**上（下面「卖法币买币」费收 USDT，「卖币买法币」费收 AED）。

**卖法币买币（Alice 卖 AED 买 USDT）**

| 腿 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 1 客户 vIBAN → 结算钱包 | 30 | 客户应付（100） | 客户现金（vIBAN，1） | `SWAP_SELL_CLIENT` |
| 1（同腿） | 31 | 公司现金（结算钱包，50） | 公司权益（200，AED） | `SWAP_SELL_FIRM` |
| 2 结算钱包 → 运营钱包 | 37 | 公司现金（运营钱包，50） | 公司现金（结算钱包，50） | `SWAP_SELL_SET_TO_OPS` |
| 3 运营地址 → 客户地址 | 38 | 公司权益（200，USDT） | 公司现金（运营钱包，50） | `SWAP_BUY_OPS_TO_ASSET` |
| 3（同腿） | 34 | 客户现金（充值地址，1） | 客户应付（100） | `SWAP_BUY_CLIENT` |
| 4 客户地址 → 手续费地址 | 35 | 客户应付（100） | 客户现金（充值地址，1） | `SWAP_FEE_CLIENT` |
| 4（同腿） | 36 | 公司现金（手续费钱包，50） | 兑换费收入（210） | `SWAP_FEE_FIRM` |

**卖币买法币（反向）**

| 腿 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 1 客户地址 → 运营地址 | 30 | 客户应付（100） | 客户现金（充值地址，1） | `SWAP_SELL_CLIENT` |
| 1（同腿） | 31 | 公司现金（运营钱包，50） | 公司权益（200，USDT） | `SWAP_SELL_FIRM` |
| 2 运营钱包 → 结算钱包 | 32 | 公司现金（结算钱包，50） | 公司现金（运营钱包，50） | `SWAP_BUY_OPS_TO_SET` |
| 3 结算钱包 → 客户 vIBAN | 33 | 公司权益（200，AED） | 公司现金（结算钱包，50） | `SWAP_BUY_SET_TO_ASSET` |
| 3（同腿） | 34 | 客户现金（vIBAN，1） | 客户应付（100） | `SWAP_BUY_CLIENT` |
| 4 客户 vIBAN → 手续费钱包 | 35 | 客户应付（100） | 客户现金（vIBAN，1） | `SWAP_FEE_CLIENT` |
| 4（同腿） | 36 | 公司现金（手续费钱包，50） | 兑换费收入（210） | `SWAP_FEE_FIRM` |

### 注资（CAPITAL_INJECTION）与供应商付款（VENDOR_PAYMENT）

| 单据 / 步骤 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 注资：CFO 批准、等钱——无分录 | — | — | — | — |
| 注资：钱到、金库核对确认 | 70 | 公司现金（收款钱包 = 运营钱包，50） | 公司权益（200） | `CAPITAL_INJECTION` |
| 付款：CFO 批准——无分录（不做月度计提） | — | — | — | — |
| 付款：出款回单确认（所选钱包 = 运营或手续费钱包；从手续费钱包付不结转） | 87 | 银行与托管费用（300） | 公司现金（所选钱包，50） | `VENDOR_PAYMENT` |

### LP 兑换（LP_EXCHANGE，卖 50,000 AED 向 LP 买 13,600 USDT 为例）

| 步骤 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 卖出腿出款确认：钱付给 LP | 84 | 公司权益（200，卖出币） | 公司现金（运营钱包，50） | `LP_EXCHANGE_PAY` |
| 同一步，紧随 84：挂应收（金额 = 买入合同数） | 88 | 应收 LP（该 LP，51，买入币） | 公司权益（200，买入币） | `LP_EXCHANGE_RECEIVABLE` |
| LP 发货到前厅：消应收 | 85 | 公司现金（LP 前厅钱包，50） | 应收 LP（该 LP，51） | `LP_EXCHANGE_RECEIVE` |
| 验收入库：前厅 → 运营 | 86 | 公司现金（运营钱包，50） | 公司现金（LP 前厅钱包，50） | `LP_EXCHANGE_ACCEPT` |

### 公司调拨单（HOUSE_TRANSFER，from / to 限运营钱包与手续费钱包）

| 步骤 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 腿确认：挪钱 | 89 | 公司现金（to 钱包，50） | 公司现金（from 钱包，50） | `HOUSE_TRANSFER` |
| 紧随 89，**仅手续费钱包 → 运营钱包**：扫费同额结转，额 = min(调拨额, 三收入户余额合计)，按 210 → 211 → 212 每户至多一笔 | 90 | 兑换费收入（210）／提现费收入（211）／其他收入（212） | 公司权益（200） | `FEE_INCOME_CLOSE_SWAP` ／ `…_WITHDRAW` ／ `…_OTHER` |

### 内部划转单（INTERNAL_TRANSFER，公司 → 客户）

加密币一腿直达，跳过结算户（无 81）。

| 用途 · 步骤 | 转账码 | 借 | 贷 | eventCode |
|---|---|---|---|---|
| 认损补缺（`SHORTFALL_TOPUP`）·CFO 批准那一步，先于建腿：记短缺（生效日 = 案件业务日；客户应付不动） | 91 | 托管短缺待补（该客户钱包，2） | 客户现金（同一只钱包，1） | `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED` |
| 法币腿 1：运营钱包 → 结算钱包 | 81 | 公司现金（结算钱包，50） | 公司现金（运营或手续费钱包 = from，50） | `INTERNAL_TRANSFER_OPS_TO_SET` |
| 公司放出（法币腿 2 从结算钱包 / 加密币腿 1 从 from 钱包） | 82 | 对账核销损失（301） | 公司现金（结算钱包或 from 钱包，50） | `INTERNAL_TRANSFER_FIRM_OUT` |
| 客户收到·认损补缺：短缺归零 | 83 | 客户现金（客户钱包，1） | 托管短缺待补（同一只钱包，2） | `INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN` |
| 客户收到·垫款（`CLIENT_ADVANCE`，入口置灰、代码保留） | 83 | 客户现金（客户钱包，1） | 客户应付（100） | `INTERNAL_TRANSFER_ADVANCE_IN` |

### 平账调账单（RECON_ADJUSTMENT，转账码 80）

现金腿 = 案子钱包的现金户（客户池 1 / 公司池 50）。**REDUCE = 借对手 / 贷现金；INCREASE = 借现金 / 贷对手。**eventCode 均为 `RECON_ADJUSTMENT_POSTED`，改记第二笔为 `RECON_ADJUSTMENT_POSTED_CASH`。

| 处置 | 对手腿 | 说明 |
|---|---|---|
| 客户池冲正 / 冲销 | 客户应付（100） | REDUCE：借 100 / 贷 1；INCREASE：借 1 / 贷 100 |
| 公司池错账更正 / 冲销 | 公司权益（200） | REDUCE：借 200 / 贷 50；INCREASE：借 50 / 贷 200 |
| 补记银行杂费（公司池 REDUCE） | 银行与托管费用（300） | 借 300 / 贷 50 |
| 补记银行利息（公司池 INCREASE） | 其他收入（212） | 借 50 / 贷 212 |
| 核销（公司池）·托管里少了 | 对账核销损失（301） | 借 301 / 贷 50 |
| 核销（公司池）·托管里多出 | 其他收入（212） | 借 50 / 贷 212（301 是借方户，贷不得超借会被账本拒） |
| 改记（客户池，一张凭证两笔码 80、四条腿） | 应付对 + 现金对 | 应付对：借 应付·错记方 / 贷 应付·正主（`…_POSTED`）；现金对：借 客户现金·正主钱包 / 贷 客户现金·错记方钱包（`…_POSTED_CASH`）。每客户一钱包，记错人 = 记错钱包 |
| ~~认损（客户池）~~ | — | **已不是调账单**：认损补缺改走内部划转单（码 91 + 81–83），调账单的认损成因已退役；客户池认损对客户端零行 |

**不算新单的**：补单三路（补录充值、认领追回、认领退回）复用充值和提现的分录；事故登记、欠款登记、月结单、成交确认单全部零分录。
