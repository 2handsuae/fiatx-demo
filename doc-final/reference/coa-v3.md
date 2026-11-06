# 科目表 · COA v3（战役戊定稿导出）

> 导出日期 2026-11-06 ｜ 来源：`superpowers/specs/2026-11-06-campaign-e-ledger-by-location-charter.md` 附录 A（**以总纲为准**，本文是给业主与开发看的定稿快照，总纲附录改了要重新导出）
> 状态：**目标态**。现状真相在 `modules/accounting-coa.md`，直到战役戊波三收官重写该篇为止。
> 一句话：资产按「钱在哪儿」开户（每个真实账户 / 钱包一个现金户），负债、权益、收入、开支只记「是谁的、为什么」。

## 科目表（COA v3 定稿，2026-11-06）

**读法**：「类」由代码定义（科目码）；「户」= 类 × 币种 × 归属人。现金户的归属人是钱包，户名 = 类名 · 钱包名。英文名给管理台用；中文名给文档用。

| 大类 | 码 | 常量 | 中文名 | 英文名 | 开户粒度 | ownerType | 借/贷方户 | 开户时机 | 对应今天 |
|---|---|---|---|---|---|---|---|---|---|
| 资产·客户本 | 1 | CLIENT_CASH（原 CLIENT_ASSET） | 客户现金 | Client Cash | 每个客户钱包一户 | WALLET | 借 | 钱包建行 | 客户资产合计 + 钱包标签 |
| 资产·客户本 | 2 | CLIENT_SHORTFALL | 托管短缺待补 | Custody Shortfall Receivable | 每个客户钱包一户 | WALLET | 借 | 钱包建行（**波二**起开） | 无 |
| 资产·公司本 | 50 | FIRM_CASH（原 FIRM_ASSET） | 公司现金 | Company Cash | 每个公司钱包一户（7 户） | WALLET | 借 | 钱包建行 | 公司资产合计 + 钱包标签；**FIRM_SET(201) / FIRM_LIQ(203) 并入此类**成为「公司现金·结算 AED」「公司现金·LP 前厅 ×2」 |
| 资产·公司本 | 51 | LP_RECEIVABLE | 应收 LP 交货 | Due from LP | 每 LP 每币种 | LP（占用既有插座） | 借 | LP 档案 ACTIVE（**波二**起开） | 无 |
| 负债·客户本 | 100 | CLIENT_PAYABLE | 应付客户 | Payable to Clients – Available Balance | 每客户每币种 | CUSTOMER | 贷 | 不变 | 不变 |
| 负债·客户本 | 101 | DEPOSIT_SUSPENSE | 客户暂扣 | Client Deposits Held – Pending Release | 每客户每币种 | CUSTOMER | 贷 | 不变 | 不变 |
| 负债·公司本 | 150 | VENDOR_PAYABLE | 应付供应商 | Payable to Vendors | 每供应商每币种 | VENDOR | 贷 | **本战役不开** | 无 |
| 权益 | 200 | FIRM_EQUITY（原 FIRM_OPS） | 公司权益 | Company Equity | 每币种一户 | SYSTEM | 贷 | 上币 | 运营户的对手盘角色；本钱 + 交易净额；注资贷此户 |
| 收入 | 210 | INCOME_SWAP_FEE | 兑换费收入 | Trading Fee Income | 每币种一户 | SYSTEM | 贷 | 不变 | 不变（脱离 F_FEE 钱包映射） |
| 收入 | 211 | INCOME_WITHDRAW_FEE | 提现费收入 | Withdrawal Fee Income | 每币种一户 | SYSTEM | 贷 | 不变 | 不变 |
| 收入 | 212 | INCOME_OTHER | 其他收入 | Other Service Income | 每币种一户 | SYSTEM | 贷 | 不变 | 不变（没收、银行利息） |
| 开支 | 300 | EXPENSE_BANK_CUSTODY | 银行与托管费用 | Bank & Custody Charges | 每币种一户 | SYSTEM | 借 | 上币 | 无（今天借 FIRM_OPS） |
| 开支 | 301 | EXPENSE_RECON_LOSS | 对账核销损失 | Reconciliation Write-off Loss | 每币种一户 | SYSTEM | 借 | 上币 | 无（今天借 FIRM_OPS） |
| 开支 | 302 | EXPENSE_OTHER | 其他开支 | Other Expenses | 每币种一户 | SYSTEM | 借 | 上币 | 无 |

**退役码**：201 FIRM_SET、203 FIRM_LIQ（科目退役；钱包存续为 50 类下的现金户）；加入退役名黑名单（与 FIRM_FEE / FIRM_SEIZED 同列）。
**挂起、不开户**：应收垫款（追回链，等 Zand）。

**户名模式**：现金户 = `类名 · 钱包名`。钱包名：平台钱包 = vault 标签 + 网络（例 `Company Cash · Company Operations · AED_ZAND`）；客户钱包 = 客户号 + 角色（例 `Client Cash · CU2601012635 · vIBAN`）。其余户照今天「一码一名」。

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
- **公司权益 ≥ 公司现金·运营 恒成立**：差额 = 其他公司现金户 + 应收 LP + 未结转开支 − (已扫入运营户但未结转的收入)。最后一项靠 §4 岔口 5「扫费同额结转」钉为零，于是现金闸（出款前查公司现金·运营）顺带保住公司权益不负。谁给公司权益加一条不经现金的借方分录，这个保证就破了——写进交付合同。
- 逐客户控制报表（不是账本结构）：客户现金·该客户 + 短缺待补·该客户 = 应付 + 暂扣，逐客户算；法币改母账户模式时退化为总数，账本不改。
