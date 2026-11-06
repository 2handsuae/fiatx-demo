# T4 付款单 from 钱包可选 · 证据

2026-11-07 ｜ 分支 `claude/campaign-e-wave2-e761d7` ｜ self 栈（后端 3110 / 管理台 3111 / TB 3113）｜ 命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`

## 1. 端点事实（定前端取数口径）

`GET /admin/tb/accounts?ownerType=WALLET&code=50&assetCurrency=AED`（treasury 登录）返回 4 行公司现金户，每行带 `ownerUuid`（= `wallets.id`，既有字段）/ `walletNo` / `walletRole` / `balance`（最小单位）。
**结论：端点已暴露钱包 id（字段名 `ownerUuid`），不改后端、不加字段**；前端过滤 `walletRole ∈ {F_OPS, F_FEE}`，下拉只显示 walletNo，`ownerUuid` 只作表单提交值。
自栈种子：每币种每网络恰一只 F_OPS / F_FEE（AED_ZAND、TRON），故按币种取即唯一；F_FEE（AED）开局余额 11400 最小单位 = 114.00 AED（来自种子手续费收入，e2e 前核过）。

## 2. 单测：红 → 绿

文件：`vendor-payment-workflow.service.spec.ts`、`vendor-payment.service.spec.ts`（from 守卫用**真** `FirmWalletPickerService` 喂同一份内存 prisma，不是桩）。

| 步骤 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| 红①（编译红，改实现前） | `DATABASE_URL=… npx jest src/modules/asset-treasury/company-funding` | 1 | `TS2353: 'fromWalletId' does not exist in type 'InitiateVendorPaymentInput'`、`TS2339: Property 'fromWalletNo' does not exist on type 'VendorPaymentView'` |
| 红②（行为红：ts-jest `diagnostics:false` + 临时给旧 workflow 的构造参数补 `resolve` 垫片，只为让旧代码跑起来） | `npx jest -c <scratch 无诊断配置> …workflow.service.spec.ts` | 1 | `Tests: 9 failed, 13 passed`——失败的正是 F_OPS 快照名 from / F_FEE 不过 NLA / F_FEE 余额闸查 F_FEE / F_SET 与不存在钱包 400 / 门序 / 批准复核跟 row.fromWalletId / F_FEE 腿 from / F_FEE 落 87 贷 F_FEE；`Expected: "w-fee-aed", "asset-aed"  Number of calls: 0`（`assertEligible` 从未被调） |
| 绿 | `DATABASE_URL=… npx jest src/modules/asset-treasury src/modules/funds-layer src/modules/audit-logging` | 0 | `Test Suites: 51 passed, 51 total  Tests: 982 passed, 982 total` |
| 绿（邻接） | `npx jest src/modules/funds-orders src/modules/governance/approvals` | 0 | `Test Suites: 9 passed  Tests: 80 passed` |

新增 / 改写的行为断言：F_FEE 不调 NLA 门、F_OPS 调一次且入参对；F_SET / 不存在钱包 → 400 `FROM_WALLET_NOT_ELIGIBLE` 且下游（余额闸 / NLA / 建行 / 审批）一个都没走；余额闸按人选钱包查（开单与批准复核两处）；开单门序 eligibility → 余额 → NLA → 建行（`invocationCallOrder`）；快照与审计 REQUESTED 的 metadata 带 `fromWalletNo`、零 UUID；F_FEE 行的腿 from = 手续费户、87 贷 `cashAcct(F_FEE)`、只有 87 一笔（无结转）；列表一次批量取 walletNo。

## 3. e2e：`test/vendor-payment-from-wallet.e2e-spec.ts`（新，付款单今天首份 e2e）

真 AppModule 零 mock；收款方 = 种子 HexTrust（ACTIVE）；金额 1.00 AED（手续费户只有百来块，每跑一次真付走 1 块）；NLA 门用 `jest.spyOn` 挂在 app 里那只真 `PrudentialService` 上（透传）；断言取自 TB 余额前后差 + 凭证行 + 审计行。

| 用例 | 断言 |
|---|---|
| from = F_FEE 全弧 | 开单不调 NLA（spy）；行 `fromWalletId` = 手续费户；视图 / 审批快照 / 审计 REQUESTED metadata 都是 walletNo 且无 UUID；批准前 TB 五项快照不变；CFO `approvals.approve` → EXECUTING → 腿 `fromWalletId` = 手续费户 → SUBMIT / CONFIRM（⚡同一入口）→ SUCCESS；**TB 前后差：F_FEE 现金 −100、300 +100、F_OPS 现金 0、200 权益 0、210+211+212 0**；凭证恰 1 行（`VENDOR_PAYMENT`，借 `X.EXPENSE_BANK_CUSTODY`、贷 `A.FIRM_CASH`，`creditTbAccountId` = 手续费户现金户）→ 无 90；全程 NLA spy 0 次 |
| from = F_OPS | NLA spy 恰 1 次，入参 `{currency:'AED', amountMinor:100n, orderKind:'VENDOR_PAYMENT', counterpartyNo, assetNo}`；行与视图指运营户；随后撤回收拾夹具 |
| from = F_SET / 客户钱包 | `getStatus()=400`、`code='FROM_WALLET_NOT_ELIGIBLE'`、话术含 walletNo 不含 id；按本次标记查不到付款单行；NLA spy 0 次 |

| 步骤 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| 绿（终版） | `bash scripts/on-stack.sh self test:e2e --runInBand test/vendor-payment-from-wallet.e2e-spec.ts` | 0 | `Tests: 5 passed, 5 total` |
| 红（对**旧 workflow**：`git show HEAD:…vendor-payment-workflow.service.ts` 换进去 + `test/jest-e2e.json` 临时加 `diagnostics:false`，跑完两处都恢复，`git status` 干净） | 同上 | 1 | `Tests: 3 failed, 2 passed`：F_FEE 用例 `expect(nlaSpy).not.toHaveBeenCalled() … Received number of calls: 1`；F_SET / 客户钱包两例 `Expected: 400  Received: undefined`（旧代码根本不验、照样建单）。F_OPS 用例旧代码也绿——它是回归护栏，不是红点 |
| 变异（失效验证：把 `postPaymentLeg` 的贷方临时改成永远记 F_OPS 现金户，跑完恢复，`grep -c MUTATION`=0） | 同上 | 1 | `Expected: -100n  Received: 0n`（F_FEE 现金差）——TB 层断言会红 |

⚠ 变异那一轮在 self 库里留了一笔「87 贷记到运营户、而托管回单 OUT 落在手续费户」的 1.00 AED 付款（PAY… `E2E-VPF-… from fee` 之一）；self 库可随时重铺，**收尾闸 ⑧ `reset self` 会清掉**。`verify:coa` 是账本恒等式，不看钱包与外部回单是否对得上，故不受影响。

## 4. 闸门

| 闸 | 命令 | 退出码 | 输出 |
|---|---|---|---|
| ① | `npx tsc --noEmit -p tsconfig.json` | 0 | 空 |
| ② | `cd admin-web && npx tsc -b --noEmit` | 0 | 空 |
| ③ | `cd client-web && npx tsc -b --noEmit` | 0 | 空 |
| ④ | 见 §2 | 0 | 982 + 80 全绿 |
| e2e | 见 §3 | 0 | 5/5 |
| `verify:coa`（收尾） | `bash scripts/on-stack.sh self verify:coa` | 0 | 四条恒等式 ✓、`负余额检查 通过 (105 个科目全部 ≥ 0)`、`ALL INVARIANTS PASS` |
| 后端已按终版代码重启 | `bash scripts/stack.sh down && bash scripts/stack.sh up` | 0 / 0 | 3110 / 3111 / 3112 up；`GET /admin/vendor-payments/PAY…` 回 `fromWalletNo` |

真实边界（运行中的后端，treasury 令牌）：
- `POST /admin/vendor-payments` 带 F_SET 钱包 id → `400 {"code":"FROM_WALLET_NOT_ELIGIBLE","message":"Wallet WA2601010577 cannot be chosen as the from wallet for AED — only a Company Operations or Company Fees wallet on the AED_ZAND network can be"}`
- 缺 `fromWalletId` → `400 ["fromWalletId should not be empty","fromWalletId must be a string"]`

## 5. 闸 ⑤ 截图（`scripts/demo-shot.js`，treasury@fiatx.com，已逐张 Read 核对）

| 文件 | 内容 |
|---|---|
| `t4-vendor-payment-from.png` | 建单弹层：选 AED 后 Pay From 展开（临时把 `<select>` 设 `size=3` 以便无头截图里看见下拉项；原生弹层无头不入图——这一步用的是 `demo-shot.js` 的 scratch 副本，仓库里的脚本没动）：`WA2601017408 · Company Operations · balance 946,089.35 AED`（默认高亮）与 `WA2601014540 · Company Fees · balance 112.00 AED`；结算户 / LP 前厅不在列 |
| `t4-vendor-payment-from-default.png` | 同一弹层，原样（未展开）：默认选中运营户 + 提示语 |
| `t4-vendor-payment-ui-submitted.png` | 经 UI 实际填表选 Company Fees、金额 2、点 Initiate：列表顶出现 `Initiated PAY… — approval APR… opened, awaiting CFO` |
| `t4-vendor-payment-detail-from.png` | 该单详情页：Payee 卡里 `PAID FROM (COMPANY WALLET) WA2601014540`（业务键，页面无 UUID） |

UI 提交的那一单库里 `fromWalletId` = 手续费户 id（与注册表 `ownerUuid` 对得上）、无 NLA 调用；截图后已经 API 撤回（CANCELLED），不在审批中心留待批单。
