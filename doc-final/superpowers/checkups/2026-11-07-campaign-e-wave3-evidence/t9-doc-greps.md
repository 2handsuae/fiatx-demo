# T9 文档清册 1–6 · 旧名与门语义 grep 证据

> 2026-11-07 戊波三 Task 9。每文件先在改前跑同一 grep 取清单（见任务过程），改后重跑，下面是**改后**输出；合法命中逐条标注。搜索边界：仅这些文件、仅这两组正则（字面旧名 + 门语义短语）；换形态（中文别名「运营资金」「客户资产」等）另用宽松 grep 扫过 funds-orders / v6-swap / v7-treasury / v8-recon / handbook 的分录句，结果见各节。

```
G='FIRM_OPS|FIRM_LIQ|FIRM_SET|FIRM_ASSET|CLIENT_ASSET|结算中转|客户资产池|公司资产|9 码|10 码|九码|201|203'
P='只算运营|NLA 只|运营户时过门|from = 运营|from = F_OPS|from = F_FEE|仅运营户'
grep -n -E "$G|$P" <file>
```

## doc-final/delivery/semantic-contract.md

```
hits=0
```

## doc-final/delivery/decision-log.md

```
hits=1
10:- **D-5 COA 终盘 9 码，三条永久否决**：暂扣场景不拆科目、点差不单独记账、不按费种立户。COA 为系统服务，财务需求走对钩视图，不预留号段。（20
```

## doc-final/delivery/dependency-contract-status.md

```
hits=0
```

## doc-final/delivery/nonfunctional-baseline.md

```
hits=0
```

## doc-final/modules/accounting-coa.md

```
hits=1
41:**科目也有生死。** 旧的手续费 / 罚没两户（COA v2）、结算中转与 LP 前厅两个独立科目（COA v3）都已退役：后两者作为科目退役、作为现金户存续（�
```

## doc-final/reference/coa-v3.md

```
hits=9
13:| 资产·客户本 | 1 | CLIENT_CASH（原 CLIENT_ASSET） | 客户现金 | Client Cash | 每个客户钱包一户 | WALLET | 借 | 钱包建行 | 客户资产合计 + 钱包标签 |
15:| 资产·公司本 | 50 | FIRM_CASH（原 FIRM_ASSET） | 公司现金 | Company Cash | 每个公司钱包一户（7 户） | WALLET | 借 | 钱包建行 | 公司资产合计 + 钱包标签；**FI
20:| 权益 | 200 | FIRM_EQUITY（原 FIRM_OPS） | 公司权益 | Company Equity | 每币种一户 | SYSTEM | 贷 | 上币 | 运营户的对手盘角色；本钱 + 交易净额；注资贷此户 |
24:| 开支 | 300 | EXPENSE_BANK_CUSTODY | 银行与托管费用 | Bank & Custody Charges | 每币种一户 | SYSTEM | 借 | 上币 | 无（旧账本借 FIRM_OPS） |
25:| 开支 | 301 | EXPENSE_RECON_LOSS | 对账核销损失 | Reconciliation Write-off Loss | 每币种一户 | SYSTEM | 借 | 上币 | 无（旧账本借 FIRM_OPS） |
28:**退役码**：201 FIRM_SET、203 FIRM_LIQ（科目退役；钱包存续为 50 类下的现金户）；加入退役名黑名单（与 FIRM_FEE / FIRM_SEIZED 同列）。
38:| Zand 结算账户 | Zand | AED | F_SET · AED_ZAND | 公司现金 · 结算 AED（原 FIRM_SET 科目） |
40:| Zand LP 前厅账户 | Zand | AED | F_LIQ · AED_ZAND | 公司现金 · LP 前厅 AED（原 FIRM_LIQ） |
43:| HexTrust LP 前厅地址 | HexTrust | USDT | F_LIQ · TRON | 公司现金 · LP 前厅 USDT（原 FIRM_LIQ） |
```

## doc-final/modules/company-funds.md

```
hits=1
90:- **共用件（戊波二）**：`FirmWalletPickerService.assertEligible`（funds-layer）由付款单 / 调拨单 / 认损补缺单三处同调；`AccountingService.assertWalletBalance(walletId, l
```

## doc-final/modules/lp-desk.md

```
hits=2
36:**LP 前厅是 F_LIQ 钱包的公司现金户。** 战役乙波一因 LP 在途验收需求把 2026-08 退役的 F_LIQ 科目（203）复活；2026-11-06 COA v3 起它作为**科目**再度退役�
113:- COA：前厅 = F_LIQ 钱包的公司现金户（码 50，`tb-account-codes.constant.ts`；独立科目 203 已于 2026-11-06 退役）；对账读该现金户 1:1 直比对账单（`wallet-balan
```

## doc-final/modules/overview.md

```
hits=0
```

## doc-final/modules/v8-recon.md

```
hits=2
120:- 账龄（A 批）：workflow/case-aging.service.ts（算截止 / 找候选 / 置标记 / ⚡拨钟（`POST .../simulate-aging-timeout` 返回 201）+ 审计）｜ sweep/case-aging-sweep.service.
132:- 留痕（站5-β + 一期半 + A 批，`V8_RECON_AUDIT_ACTIONS` 9 码）：跑批完成 RECON_RUN_COMPLETED（双通道：cron 系统 / 管理员触发记名，主对象=runNo）｜ 立案 RECON
```

## doc-final/modules/funds-orders.md

```
hits=0
```

## doc-final/modules/v6-swap.md

```
hits=0
```

## doc-final/modules/v7-treasury.md

```
hits=0
```

## doc-final/reference/recon-cause-handbook.md

```
hits=0
```

## scripts/recon-demo.ts（注释行，仅此一处改动）

```
grep -n "1,364,752.25\|1,364,998.46" scripts/recon-demo.ts
702://   F_OPS(AED) 当刻 946,089.35，NLA 当刻 1,364,752.25（旧口径：只算运营户；2026-11-07 戊波三
703://   改三钱包口径〔运营 + 手续费 + LP 前厅〕后，同一时点 demo:all 之后为 1,364,998.46），红线 1,200,000.00，
```

## 代码旧文字复核（Task 1 已改，本任务只复核不改）

```
grep -n "summary: 'Get the current NLA" src/modules/asset-treasury/prudential/prudential.controller.ts
28:  @ApiOperation({ summary: 'Get the current NLA prudential status (Net Liquid Assets = operations + fees + liquidity wallet balances converted to AED, with per-wallet breakdown, floor, headroom)' })
grep -n "One-screen view of firm liquidity" src/modules/identity/access-control/rbac.catalog.ts
1128:        description: 'One-screen view of firm liquidity: company wallets, due from LP, income and expenses',
```

## 合法命中标注

| 文件:行 | 命中 | 为什么合法 |
|---|---|---|
| `delivery/decision-log.md:10` | D-5「9 码」 | 历史决策原文，后接「已被 D-31 取代」标注（spec §9.1） |
| `modules/accounting-coa.md:41` | 「结算中转」 | 说明旧科目已退役、作为现金户存续的一句历史交代 |
| `reference/coa-v3.md:13, 15, 20, 24–25, 28, 38, 40, 43` | 旧常量名 / 201 / 203 / FIRM_OPS | 「对应旧账本（COA v2）」列、「退役码」行与物理位置表的「原 xx 科目」括注——都是新旧对照，不是现状描述 |
| `modules/company-funds.md:90` | `from = F_OPS` | 描述 LP 兑换单**余额闸**（不是 NLA 门）固定 from = F_OPS，属实 |
| `modules/lp-desk.md:36, 113` | F_LIQ / 203 | 说明 203 科目退役、前厅现为 F_LIQ 钱包的公司现金户 |
| `modules/v8-recon.md:120` | `返回 201` | HTTP 201 状态码 |
| `modules/v8-recon.md:132` | `V8_RECON_AUDIT_ACTIONS 9 码` | 审计动作码数量，非科目 |

`delivery/semantic-contract.md`、`dependency-contract-status.md`、`nonfunctional-baseline.md`、`overview.md`、`funds-orders.md`、`v6-swap.md`、`v7-treasury.md`、`recon-cause-handbook.md`：改后 hits=0。

`nonfunctional-baseline.md`：数字型基线核过——全文无科目数 / 码数 / 转账码数等数字（13 条均为工程原则），零改动。

## 宽松 grep（换形态再搜，纪律 3）

```
cd doc-final
grep -n -E "分录|借 |贷 |DR |CR |客户资产|运营资金|科目" modules/funds-orders.md modules/v6-swap.md   → 仅 v6-swap.md:61「账本页看四腿分录」，无旧科目名
grep -rn -E "只算运营|NLA 只|仅算运营|NLA = F_OPS|F_OPS\(AED\)|运营户时过门|from = 运营|from = F_OPS|1,364,752" --include='*.md' . （排除 archive / superpowers / lark）
   → 本任务范围内（modules / reference / delivery）无命中；余下命中在 demo/baseline.md、demo/script.md（任务 10 范围）、CHANGELOG.md:23 与 BACKLOG.md:354（历史条目 / 待销账条，任务 10 范围）、decisions.md:152（被翻案的原条，只追加不改）、decisions.md:178（新条 ⑧ 自述）
grep -rn -E "客户资产这条腿|客户资产腿|资产腿一分没动|资产腿完全不动" --include='*.md' . （排除 archive / superpowers / lark）
   → 仅 decisions.md:41（2026-09-01 历史条，只追加不改）。recon-cause-handbook「改记」一节原写「客户资产这条腿完全不动」与 v3 四腿实现相反，已改为四腿说明
```

覆盖边界：未覆盖 `demo/`、`CLAUDE.md`、`BACKLOG.md`、`TOOLING-DEBT.md`、`CHANGELOG.md`（任务 10）；未覆盖 `lark/` 与 `archive/`（项目约定不读）；动态拼接的文档引用不在 grep 能力之内。

## decisions.md 计数

```
wc -l doc-final/decisions.md   改前 170   改后 181   （+11，spec §9.2 ①–⑪）
grep -n "^- \[2026-11-07\]" doc-final/decisions.md | wc -l   → 11（行 171–181）
```

`delivery/decision-log.md` 的 D 编号：既有末号 D-30；本任务新增 **D-31 … D-37**（COA v3 / 公司调拨单 / 付款单 from / 扫费结转 / 对内差额 / 第 0 轮锚配对 / NLA 三算两不算 + 门），D-5 加「被 D-31 取代」标注，D-10 改为认损补缺一张单，D-21 措辞「认损/补款」→「认损补缺」。
