# 戊波一 · 收尾证据目录

> 2026-11-06，T13 收尾会话，代码头 `a35a04f1` + 两支 Sumsub e2e 夹具对齐（commit `84970d02` `test(戊波一): Sumsub 两支 e2e 夹具随新账本对齐`；基点 `0cef9af5`）。**状态：收尾闸全绿；e2e 失败名 = 基线 20 名 + 2 个已登记连带名（见 §4）。**
> 分支与承接见 `../../specs/2026-11-06-campaign-e-wave2-skeleton.md`「承接波一」；分录权威见总纲附录 B。

## 1. 文件清单（每个文件证明什么）

| 文件 | 证明什么 |
|---|---|
| `client-snapshot-before.json` | **改前**（`fd2ebd7d`，代码 = main）重铺 + `demo:all` 后客户侧快照：13 位客户的余额 / 资产组合 / 逐币种流水 / 月结单（T0 采，对照组先采） |
| `client-snapshot-after.json` | **改后**（`a35a04f1`）干净重铺 + `demo:all` 后同口径快照（`client:snapshot -- --out …`，在任何 `recon:demo` 之前拍） |
| `client-snapshot.diff` | `diff before after` 的输出：**0 行（空文件）**；两份 sha256 同为 `c0195e645571dfda…`。Henry 多出的两个钱包行不在这四个接口里，故无差异 |
| `client-snapshot-control.md` | T0 的对照组记录：代码不变时两次独立重铺快照逐字相同；订单号随机尾号的遮罩裁定（R8 / R9）与三项失效验证 |
| `verify-coa-failure-validation.md` | T3 的失效验证：往客户现金户记一笔无对手借方，`verify:coa` 恒等式必须红 |
| `evidence-by-transfer-code.md` | **转账码抽核表**：1–21、30–38、70、80–87 每码一条（凭证号 → TB 实记借 / 贷科目码 → 附录 B），322 次比对 0 处不符；没有行的码逐码交代原因 |
| `evidence-raw-phaseA.json` / `evidence-raw-phaseB.json` | 抽核表的原始行（evidence 行 + TigerBeetle 里取回的真实转账 / 账户），取样后栈已重铺，靠这两份可逐字复现表格 |
| `a4-evidence.js` / `a4-table.js` | 取样脚本（库 + TB → 原始行）与成表脚本（原始行 → 表 + 与附录 B 比对）；用法与失效验证见抽核表末尾 |
| `t8-company-funds-dashboard.png`、`t8-ledger-accounts.png` | T8：公司资金看板与账本科目页（现金户进科目页、数字同源） |
| `t9-reattribution-detail.png` | T9：改记调账单详情页多出的现金对一行 |
| `t11-cases-list.png`、`t11-case-customer.png`、`t11-case-company.png` | T11：对账引擎迁到现金户后的案件列表 / 客户案 / 公司案 |
| `t12-ledger-accounts.png`、`t12-account-flows.png` | T12：现金户户名按模式（`Client Cash · CU… · vIBAN – AED`）；流水页户名不截断 |
| `t13-company-funds-dashboard.png` | 收尾走查：公司资金看板，Operating AED 946,089.35 / USDT 113,999.428189，NLA 1,364,752.25（与账本公司现金·运营同源） |
| `t13-ledger-accounts.png`、`t13-ledger-accounts-wallet-owner.png` | 账本科目页：全部 87 户第 1 页（客户现金户按钱包列出）；Owner=WALLET 过滤后 21 户（14 客户 + 7 公司现金户，户名按模式） |
| `t13-transfer-evidence.png` | 凭证页：102 笔，借贷列显示新助记码（`A.FIRM_CASH` / `E.INCOME_WITHDRAW_FEE` / `L.CLIENT_PAYABLE` / `A.CLIENT_CASH`） |
| `t13-account-flows.png` | 账本流水页：204 行；公司手续费钱包现金户收费行 = IN，客户应付 / 客户现金出账行 = OUT |
| `t13-recon-run-pass-detail.png` | `recon:demo:pass` 跑批详情：PASS — 21 wallets checked: all matched，案件 0 |
| `t13-recon-run-break-detail.png` | `recon:demo:break` 跑批详情：BREAK，9 匹配 / 1 在途 / 2 补偿 / 9 破口，开案 12 |
| `t13-case-customer.png` | 客户案 REC20261106-003：Client cash · USDT-TRON，内部 2,700 / 外部 2,692.5 / 差 −7.5，未解释 −7.5 |
| `t13-case-company.png` | 公司案 REC20261106-002：Company cash · Firm book · USDT-TRON，内部 36 / 外部 35.999993 / 差 −0.000007 |

## 2. 收尾闸（命令 + 退出码，在 `a35a04f1` 上取）

| 闸 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| 重铺 | `bash scripts/stack.sh reset self` → `up` | 0 / 0 | 后端 >35 s、`customer_monthly_statements`=55 后才拍快照 |
| ⑥ demo:all | `bash scripts/on-stack.sh self demo:all` | **0** | 花名册 35/35；asserts 5/5 PASS；COA 四恒等 34107565 / 94870335 / 8201620811 / 114035428189 |
| 客户侧对照 | `client:snapshot` → `diff before after` | 0 / **0（空）** | 13 位客户；快照内 `"error"` 键 0 个；STM 号 55 个（库内 55 行）；订单号遮罩 58 处；重铺日 = `261106`，与 T0 同日，R9 归一化不需要 |
| ⑦ verify:coa（recon 前） | `on-stack.sh self verify:coa` | **0** | `ALL INVARIANTS PASS`，87 个科目全部 ≥ 0 |
| recon pass | `on-stack.sh self recon:demo:pass` | **0** | `status=PASS walletsChecked=21 casesOpened=0` |
| recon break | `RECON_DEMO_MANIFEST_PATH=… on-stack.sh self recon:demo:break` | **0** | 18/18 DETECTED、12/12 桶、12/12 案；恒等①② OK |
| ⑦ verify:coa（break 后） | 同上 | **0** | CLIENT AED 恒等 34307565（比 recon 前多 200000 最小单位——`recon:demo:break` 场景 6 会真往一位客户记账，预期）；87 个科目 ≥ 0 |
| ① 后端 tsc | `npx tsc --noEmit -p tsconfig.json` | **0** | 无输出（夹具对齐后又跑一次，同样 0） |
| ② 管理台 tsc | `cd admin-web && npx tsc -b --noEmit` | **0** | 无输出 |
| ③ 客户端 tsc | `cd client-web && npx tsc -b --noEmit` | **0** | 无输出 |
| 全量 jest | `npx jest`（仓库根，不接管道） | **0** | `Test Suites: 275 passed, 275 total`；`Tests: 2 skipped, 5 todo, 4592 passed, 4599 total` |
| `test:client`（vitest） | 不需要 | — | `git diff --stat 0cef9af5..HEAD -- client-web` 输出为空（波一没动 client-web） |
| `stack-env.test.sh` | 不需要 | — | `git diff --stat 0cef9af5..HEAD -- scripts/stack*.sh scripts/on-stack.sh` 为空 |
| Phase D 留一个可演示的栈（e2e 最终轮之后重做） | `reset` → `up` → `demo:all` → `verify:coa` | 0 / 0 / **0** / **0** | 花名册 35/35、asserts 5/5；`doc-final/demo/data.md` 生成区与已入库版本逐字相同（`git diff` 0 行）；87 个科目全部 ≥ 0 |

## 3. 走查截图读后记录（Read 过每一张）

- 公司资金看板：Operating AED 946,089.35、USDT 113,999.428189（阈值条绿）；NLA 1,364,752.25 / 底线 1,200,000 / 余量 164,752.25；LP 在途 0；结算在途 0。数字与账本「公司现金·运营」户同源（T8 证 F_OPS AED 现金户 = 946,089.35）。
- 账本科目页：「Ledger Accounts · 87 accounts」；第 1 页每个客户钱包一行现金户，户名 `Client Cash · CU… · vIBAN – AED` / `… · Deposit address – USDT`；暂扣户 `Client Deposits Held – Pending Release`。过滤 Owner=WALLET：21 户，含 `Company Cash · Company Liquidity · AED_ZAND – AED`、`Company Cash · Company Fees · AED_ZAND – AED` 等公司现金户。
- 凭证页：102 笔，借 / 贷列是新助记码；提现手续费 `A.FIRM_CASH → E.INCOME_WITHDRAW_FEE`，应付 / 现金出账 `L.CLIENT_PAYABLE → A.CLIENT_CASH`。
- 流水页：204 行；`Company Cash · Company Fees · TRON – USDT` 收费行 IN（余额 36.000000），`Withdrawal Fee Income` IN；`Payable to Clients` OUT；`Client Cash · CU… · Deposit address` OUT——方向按类别投影。
- 对账 pass 详情：绿色横幅「PASS — 21 wallets checked: all matched」；21 / 21 / 0 / 0 / 0；案件流 0 / 0 / 0；钱包表每行 MATCHED。
- 对账 break 详情：红色横幅「BREAK — 21 wallets checked: 9 matched, 1 in transit, 11 need attention」；9 / 1 / 2 / 9；开案 12。
- 客户案 / 公司案详情：Balance Explained 五格（内部 / 外部 / 差 / 在途 / 未解释）、案件历史、差异行（Mismatch，Resolve 菜单）；钱包行显示 `Client cash`、`Company cash`、`Client book` / `Firm book`。

## 4. e2e：与改前基线（`0cef9af5`，冷缓存，20 例红）的对照

> 口径（R19 / R33）：改后失败名集合 ⊆ 基线 20 名 ∪ {demo-roster 两个连带名（仅当基线的充值超时同轮出现）} ∪ {`deposit-money-arcs` 用例 1（仅当复发）}；每个多出来的名字干净重铺单跑必须绿。**最终一轮满足。**

**最终全量串行**（`on-stack.sh self test:e2e --runInBand --cacheDirectory=<新目录>`，干净重铺 + 7 个私库 + `demo:setup`，exit 1，约 116 s；代码 = `a35a04f1` + 两支 Sumsub 夹具对齐）

| | 套件 | 用例 |
|---|---|---|
| 改前基线（第 3 轮） | 9 failed / 17 passed / 26 | 20 failed / 150 passed / 170 |
| 改后首轮（夹具对齐之前，仅作记录） | 12 failed / 15 passed / 27 | 42 failed / 133 passed / 175 |
| 改后中间轮（只对齐了 `withdraw-sumsub-scenarios`，记录） | 10 failed / 17 passed / 27 | 29 failed / 146 passed / 175 |
| **改后最终轮** | **9 failed / 18 passed / 27**（多出的一套 = 新增 `ledger-flags`） | **22 failed / 153 passed / 175** |

- 最终轮 22 例 = **基线 20 名一名不少、一名不多**（原因同基线：13 例 `AGREEMENT_NOT_ACCEPTED`、`swap-money-arc` 用例 2、`recon-aging` 主链路时区、`recon-adjustment` 用例 9、`customer-restrictions` ②、`demo-roster` 3 例顺序超时；recon-supplement ②③ 与 recon-aging 主链路在 T11 / T12 改过标题，按 ②/③/「主链路」前缀对上）**+ 2 例 demo-roster 连带**（「兑换 3 笔 + 提现 7 笔…」「在途单由 runWithdraws 产出…」）。连带的前提成立：同一轮里基线的「充值 11 笔 … deposit reaches CONFISCATED」超时照常出现。
- 两支被修的夹具现在**整支全绿**：`withdraw-sumsub-scenarios` PASS、`deposit-sumsub-verdicts` PASS（基线 20 名里没有这两个文件的名字；`deposit-sumsub-verdicts` 单跑 18/18）。`deposit-money-arcs` 用例 1 本轮没复发（PASS）。`ledger-flags` PASS。
- 18 个套件全绿：`aml-reporting-family`、`approval-expiry`、`audit-discipline`、`complaints`、`compliance-office`、`customer-business-key`、`deposit-money-arcs`、`deposit-sumsub-verdicts`、`kyt-verdict-landing`、`ledger-flags`、`material-requests`、`recon-reattribution`、`regulatory-filing`、`sanction-subject-split`、`sla`、`vendor-onboarding`、`withdraw-money-arcs`、`withdraw-sumsub-scenarios`。

**夹具对齐（R33；只改测试文件，不改断言意图）**

| 文件 | 改动 | 对照（红→绿） |
|---|---|---|
| `test/withdraw-sumsub-scenarios.e2e-spec.ts`（12 例） | `fundCustomer` 改成真实充值形状：码 1 借客户钱包现金户（`SystemWalletResolver.resolveCustomer` + `resolveCashAccountId`）/ 贷暂扣，再码 2 借暂扣 / 贷应付；`ensureCustomerWallet` 新建钱包后 `WalletCashAccountService.ensureForWallet` | 改前 12 例 `TB status 54 exceeds_credits`（栈在 `fundCustomer`），改后整支绿 |
| `test/deposit-sumsub-verdicts.e2e-spec.ts`（7 例） | 两只 `prisma.wallet.create` 的钱包补 `ensureForWallet`；`createDeposit` 里补记真实 Step 1（码 1 借落地钱包现金户 / 贷暂扣）——夹具直接造 `COMPLIANCE_PENDING` 单、跳过了 `detected()`，暂扣户里没有这笔钱，放行 / 没收的 Step 2 借暂扣就被拒 | 只补现金户一步仍红（单测日志：`TB Step 2 failed … status 54`）→ 再补 Step 1 后 18/18；两个文件里都没有旧助记码断言，无需改名 |

**分组 / 单跑（干净重铺；`--verbose`）**

| 组 | 命令 | 退出码 | 结果 | 对照基线 |
|---|---|---|---|---|
| 账本 + 三条 money-arc | `test:e2e --runInBand test/ledger-flags test/swap-money-arc test/deposit-money-arcs test/withdraw-money-arcs` | 1 | 17 过 / 1 失败：`ledger-flags` 3/3；`deposit-money-arcs` 5/5；`withdraw-money-arcs` 7/7；`swap-money-arc` 用例 1 ✓、**1b（AED→USDT 反向）✓**、用例 2 ✕ | 红的是基线名（用例 2 陈旧断言）；deposit 5/5、withdraw 7/7 = 基线 |
| 对账组 | `test:e2e --runInBand test/recon- test/incident-register` | 1 | 30 过 / 7 失败；`recon-reattribution` 全绿（含 `:699–713`） | 红的 7 例逐名 = 基线（recon 组 6 + incident-register 1） |
| `demo-roster`（连带名的单跑复核，最终代码上） | `test:e2e --runInBand --verbose test/demo-roster.e2e-spec.ts` | 0 | 5/5，两个连带名都 ✓ | 单跑绿 = 基线 |
| `deposit-money-arcs` | `test:e2e --runInBand test/deposit-money-arcs.e2e-spec.ts` | 0 | 5/5（另一次 d1 组内也是 5/5） | = 基线 |
| `deposit-sumsub-verdicts` | `test:e2e --runInBand --verbose test/deposit-sumsub-verdicts` | 0 | 18/18 | 基线该文件无红名 |

- 副作用：roster 套件会把花名册结果写进 `doc-final/demo/data.md` 的生成区（该套件里有刻意制造失败的用例），每次都 `git checkout` 还原；最终 Phase D `demo:all` 之后该文件与入库版本无差异（`git diff` 0 行）。
- **工具债登记（已写入 `doc-final/TOOLING-DEBT.md`）**：①私库 `db:biz:init` 停点从 `seedStatementHistoryLegs` 前移到 `seedCapitalInjection`（TB `status 37`；各库钱包现金户 id 不同而确定性转账号共用一个 TB）——7 个私库全如此，目前没有私库套件因此红；②`demo-roster` 全量连带红从 3 例扩到 5 例（账本不得透支的预期新规则，非回归）；③`deposit-money-arcs` 用例 1：`onReturnApproved` 状态翻了两个 `await` 之后才写 `DEPOSIT_RETURN_STARTED` 审计，测试等到状态就读审计 → 全量负载下偶发读早；顺序在基点上逐行相同。

## 5. 没做 / 没覆盖

- 全量 e2e 在最终代码上只跑了一遍冷缓存串行（外加分组 / 单跑；此前还有两轮记录在 §4 表里）；`vendor-onboarding ①` 各轮都是绿的，没触发已知偶发。
- 全量 jest（275 套 / 4592 过）是在夹具对齐前跑的；夹具对齐只改了两个 `*.e2e-spec.ts`，不在根 jest 的 `.spec.ts` 匹配范围内，故没重跑，① tsc 已覆盖这两个文件。
- 抽核表的覆盖边界与「没有行的码」见 `evidence-by-transfer-code.md`。
- 未做：`npm run test:client`（客户端零改动）、`stack-env.test.sh`（栈脚本零改动）。
