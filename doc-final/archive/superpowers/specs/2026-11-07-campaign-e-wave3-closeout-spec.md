# 战役戊 · 波三 spec —— 公司侧读面闸门 + 收官

> 日期 2026-11-07 ｜ 状态：**已实施并合 main（2026-11-08 ff `fda02779`，21 个提交；plan 同名，同在 archive）**；施工检查（opus：2 问 + 28 处与代码对照）订正见 §0.1
> 总纲：`2026-11-06-campaign-e-ledger-by-location-charter.md` §3 波三行、§6 战役终闸 ｜ 骨架：`2026-11-06-campaign-e-wave3-skeleton.md`（承接波二、数字基线、悬挂项，本文不重抄）｜ 波二 spec / plan 已归档 `archive/superpowers/`
> 收尾对照 `rules/delivery-checklist.md`；评审按 `rules/review-rubric.md`。本波**改 NLA 公式与算术门的触发条件（动钱的门）**，该两个任务的任务级评审升档（总纲 §7）；其余任务为读面、脚本退役、文档收口，常规档。
> 一句话定位：**账本按钱包开户之后，公司侧的三个数字口径（手头能动的钱、看板、交付合同）改成跟新账本一致，然后把整场战役收官**。没有新单据，不动任何状态机，科目页版式不动。

## §0 脑暴裁定台账（2026-11-07）

| # | 岔口 | 裁定 | 谁定 |
|---|---|---|---|
| 1 | NLA（净流动资产，监管红线 1.2 × 月开支）算哪些钱 | **三个算、两个不算**：运营钱包、手续费钱包、LP 前厅（Company Liquidity）的现金户算；结算钱包（付客户的钱第一腿已到、第二腿在路上）与应收 LP（码 51，未到账）不算。原则：**钱在公司自己口袋之间挪，这个数不变；钱一旦踏上离开公司的路，就从数里扣**。业主前提：只看物理钱包 / 账号里的钱 | 业主（作者建议，业主 2026-11-07「可以的」） |
| 2 | 算术门（开单时「动后会不会破线」）随口径怎么变 | **门只在钱离开公司时过**：付款单两种 from（运营、手续费）都计入 NLA，所以**恒过门**（今天 from = 手续费不过门，改）；公司调拨单两头都计入、NLA 不变，**不过门**（今天运营 → 手续费那一向过门，改）；LP 兑换单照旧过门（卖出腿的钱真离开公司，应收不计入）。覆盖波二裁定 12 的适用范围 | 作者（裁定 1 的必然后果；业主看 spec 时核） |
| 3 | 云端「重摆对账场景」按钮 | **撤掉**，面板只留「重铺数据」。重铺本来就在最后一步跑摆差额的脚本；按钮是九月为了「同事处置完想再演一遍、不等一分钟」加的，波二之后处置会写账本，账本只加不删，处置过再重摆对不上，脚本只好拒绝。一个时灵时不灵的按钮不如没有。**脚本 `recon:demo:*` 与 R37 前置闸保留**（开机、重铺、`cloud-verify` 都在空库上跑它） | 业主（「重铺数据是对的」） |
| 4 | 审计码说明词表归谁 | **归 agent 维护，搬出 `lark/`**：种子文件不是飞书叙事文档，是被 `audit:vocab` 脚本机器校验的登记册。搬到 `doc-final/reference/audit-actions-vocab.md`（与 `coa-v3.md`、`recon-cause-handbook.md` 同层）；生成出来的全量版留在 `lark/`（业主同步飞书时拿它贴）；缺的 29 行本波补齐；`audit:vocab` exit 0 进本波收尾闸，并写进 `delivery-checklist.md`「新增审计动作码」那一行。`TOOLING-DEBT.md:164` 登记的「与 §8 正面撞车」随之销账 | 作者（业主已知：「我不记得我有维护」） |
| 5 | 看板版式 | **四个公司钱包并成一格「Company wallets」**（四行 × AED / USDT，每行标 counted / in transit）；NLA 区大数字下加三个小格（算进去的三个钱包各自多少）+ 脚注写清不算的两项；**加「Expenses」格**（300 / 301 / 302 按币种）；「Due from LP」「Income」「Recent fund movements」原样。六格变五格，钱包一个不漏 | 业主（看过 mockup：「看板页可以」） |
| 6 | 账本科目页 | **版式不动**。分组视图与钱包筛选推迟，记 BACKLOG。只单修 USDT-TRON 小数位放大一万倍的旧 bug（BACKLOG :358） | 业主（「科目页不改了先」） |
| 7 | R19 两个重复动作桶 | **删**：`treasury.view_house_transfers` / `act_house_transfers` 组集与 `view_funding` / `act_funding` 完全相同，角色编辑器里多两个不能单独撤销的开关。四条调拨单路由本来就按组名挂，桶删掉路由不动 | 作者 |
| 8 | R39 交付文档滞后 | **`delivery/` 先改，再改其他文档**（它是给开发的目标；S9 还写「9 码封闭」、D-10 还写两步补款） | 作者（骨架既定） |
| 9 | e2e 迪拜 0–4 点窗口 | **修夹具**：四个 recon e2e 里 `toISOString().slice(0, 10)` / 手拼 `T23:59:59.999Z` 一律改经 `business-date.util.ts` 的 `toBusinessDate` / `endOfBusinessDate`（该文件头注释本来就禁止手拼）。不接受「拨钟配方」长期当工作方式 | 作者 |
| 10 | 停放小项（R43 / R44 等六项） | **全清**，见 §8 | 作者 |
| 11 | decisions 收官条目点名取代哪几条 | 总纲 §6 第 3 条引的「2026-06-25 资产聚合每币种一个」**在 `decisions.md` 里不存在**（`:5` 那条讲的是实时 1:1 记账；「每币种一个聚合户」是 COA v2 的结构事实，不是决定）。COA v3 条目点名的是：`:13` 2026-08-13「终盘 9 码」（码数作废、三条永久否决保留）、`:24` 2026-08-26「9 码科目、两恒等式一概不动」（结构部分作废）、`:149` 2026-09-28「F_LIQ 复活为 LP 在途验收户」（作为科目退役、作为现金户 F_LIQ 存续） | 作者（订正总纲引述） |
| 12 | 科目表导出落点 | **原地 `reference/coa-v3.md`** 重导为定稿（状态行从「目标态」改「现状」）；**并把总纲附录 B「七单与调账单记账总表」按实际落地导成该文件第二节**——战役收官总纲要归档，记账总表不能跟着进 archive 不读。`delivery/semantic-contract.md` 与 `modules/accounting-coa.md` 链过去 | 作者 |
| 13 | 上云 | 收官最后一步 `cloud:deploy`（连欠波一、波二）由**业主触发**，spec 只列不跑 | 业主定时机 |

翻案记录（本波改掉的旧裁定，随 §9 写进 `decisions.md`）：2026-09-30 `decisions.md:152`「NLA = F_OPS；`FIRM_SET` / `FIRM_LIQ` 在途不计（保守：未验收落定不算流动，LP 悬空期 NLA 下探是真实审慎细节）」→ 三个钱包计入，**其中 F_LIQ（LP 前厅）由「不计」改「计」是对该条的正面翻案**，新事实 = 业主 2026-11-07 定的口径标准「只看物理钱包 / 账号里的钱」+「口袋间挪钱不改变 NLA」原则；LP 悬空期的下探仍在（卖出腿出钱那一刻到 LP 交货），只是交货即回、不等验收；波二裁定 12「付款单 / 调拨单 from = 运营户时过门」→ 门只在钱离开公司时过；2026-09 云端面板两按钮 → 一按钮。

### §0.1 施工检查后的作者裁定（2026-11-07，opus 施工检查 2 问 + 28 处对照；业主只需核第 1 条）

| # | 施工检查提出的 | 裁定 |
|---|---|---|
| 1 | 裁定 1 把 F_LIQ 计入，正面推翻 `decisions.md:152` 的「`FIRM_LIQ` 在途不计」 | 已写进上面的翻案记录与 §9 决策条目 ⑧；**业主 2026-11-07 确认「维持计入」**（备选「退回前厅不算」未采：那样 NLA 在 LP 悬空期整段下探到验收为止）。决策条目 ⑧ 末尾写「业主拍板」 |
| 2 | 场景 9（`recon-adjustment-money-arcs` 用例 9）本来就在 e2e 基线 B 集里，§8 #6 要它绿、§11.7 又只许 B 集少一名 | 场景 9 的红与「recon-aging 主链路时区」同根（`:1058-1059` 手拼 `T23:59:59.999Z`，`computeAgingDeadline` 用 `endOfBusinessDate`），夹具修复预期一并转绿。§11.7 改为：**预期转绿两名**（recon-aging 时区、recon-adjustment 用例 9），B 集 22 → **20**；§8 #6 的加强断言随夹具修复同一任务做；任何其他名转红或转绿都回主会话 |
| 3 | 「`BACKLOG.md:220` 末句说反」指哪条 | 指**已提交版** `:220`「被锚定的调账单少付（落账金额低于差额）后，差异行仍读绿色『Explained · ADJ…』」（工作树因业主未提交条目下移两行成 `:222`）；其末句「预填原值（pass 0）则行保持 AMOUNT_MISMATCH」与骨架「pass 0 判 AMOUNT_MISMATCH，只有操作员改了预填金额才到」相反，按骨架 / 代码语义改写末句。§8 #1 改按标题定位，不按行号 |
| 4 | 付款单 e2e / 单测要反转的行引错 | `test/vendor-payment-from-wallet.e2e-spec.ts` 要反转的是 `:156` 用例名、`:161` 与 `:205` 的 `not.toHaveBeenCalled`（`:208` 是 F_OPS 调门，不变）；`vendor-payment-workflow.service.spec.ts` 只反转 `:222`，另 `:337`（F_FEE 开单后断言门未调）必红要改；`:161`（余额不够）、`:239`（F_SET 被拒）不变 |
| 5 | 调拨单删门后的测试 | `house-transfer-workflow.service.spec.ts:128-134`「NLA 门拦下」用例删；`:76` 构造函数的 `prudential` 注入随自身清理删；`test/house-transfer.e2e-spec.ts:329` 反转为两向都不调 |
| 6 | 删 `PrudentialOrderKind` 的 `'HOUSE_TRANSFER'` 会打断 `prudential.service.spec.ts:300, 310` | 两条用例一并删（它们测的就是调拨单过门） |
| 7 | `perWallet` 必填会打断 `prudential.service.spec.ts:185-189`、`:332` 的固定写法；`:109-114 / :135 / :171` 的 `perAsset` 断言要按「三钱包合计」重写；mock `makeSystemWallets`（`:37` 不分角色）与 `resolveCashAccountId`（`:55` 非 `w-ops-` 即抛）要按角色返回不同钱包与余额 | 照改；`perWallet` 保持必填 |
| 8 | 旧文字两处未列 | `prudential.controller.ts:28` summary「per-asset F_OPS balances」、`rbac.catalog.ts` `treasury.view_dashboard` 的 description「operating balances vs low-water thresholds, in-transit, settlement…」随 §4 改写 |
| 9 | 门语义旧句四处 + 脚本注释一处未列 | `script.md:532`（场景 29）、`:848`（场景 41）、`company-funds.md:42, 52`、`scripts/recon-demo.ts:708` 注释（NLA 1,364,752.25）进 §9 清单 |
| 10 | 场景 31 新口径估算 | 施工检查估：口径二 ≈ 136,499,846 分、场景 31 ≈ 1,114,998.46 AED（仍破线，缺口 ≈ 85,001.54）、场景 32 ≈ 1,414,998.46；口径一大概率仍 136,469,600（reset 后 F_FEE 与 F_LIQ 皆 0）。执行时实跑为准 |
| 11 | `assertEligible` 加 `side` 后 tsc 抓不全 | `firm-wallet-picker.service.spec.ts:67` 把 `tx as any` 传在第三位会编译过、运行红；按参数个数断言的 mock：`house-transfer-workflow.service.spec.ts:98-99`、`vendor-payment-workflow.service.spec.ts:187, 219`、`internal-transfer-workflow.service.spec.ts:107`；mock `:68-70` 一律抛 FROM 要分 side；`test/house-transfer.e2e-spec.ts:397`（to = 结算户）断言由 `FROM_WALLET_NOT_ELIGIBLE` 改 `TO_WALLET_NOT_ELIGIBLE`（§11.8 的「调拨单 e2e 一条」即改这条，不新增）。生产调用方确实三处（`internal-transfer-workflow.service.ts:128`、`vendor-payment-workflow.service.ts:91`、`house-transfer-workflow.service.ts:88-89`）；注释在 `:9` |
| 12 | demo-ops 退役的测试与行号 | `demo-ops.service.spec.ts` 的 `describe('startReconBreak')` 占 `:93-134`（3 用例）全删，`:43-46` readStatus 用例去掉 `reconBreak`；`demo-ops.controller.spec.ts:10, 15, 24` 随删、用例名「三条路由」改「两条」；端点在 `demo-ops.controller.ts:33-39`；面板区块在 `DemoOpsPanel.tsx:137-159`（含 `:138` 开标签），`:4` 头注释与 `:55` `busy` 一并清；`DemoOpsStatus` 接口 `:11-14` 去 `reconBreak` |
| 13 | `SHORTFALL_RECOGNIZED_EVENT_CODE` 是 `recon-demo.ts:117` 的本地常量 | 连同 `:116` 注释一起删；`explained-difference.service.ts:32` 的同名常量不动 |
| 14 | 两桶名在文档里不止骨架 | `demo/baseline.md:484`、`modules/overview.md:61`、`modules/company-funds.md:89` 进 §9 清单；证据目录不动；§7「终态 0」限 src / scripts / prisma / admin-web/src / test |
| 15 | S13d 要改三处 | `verify-rbac.ts:874` 说明串、`:875` 判断、`:882`「预期 89」 |
| 16 | 「删桶要 `db:base:sync`」不成立 | 桶目录由 `access-control.service.ts:118` 直接从内存返回，不进库；§7 改为**只需重启** |
| 17 | 种子行数口径 | 种子现 364 行（357 现役 + 7 已退役被容忍）；补 29 后 **393**；§12 随改 |
| 18 | `listBooksDelta(c, fmt)` 要传 `fmt`，且非 OPEN 一律 null | 侧栏 Books Δ 直接读 `kase.internalDeltaAmount`（`reconTypes.ts:186` 已有）经 `formatAmount` 显示，缺或为 0 显示「—」；不经 `listBooksDelta` |
| 19 | 码 2 户名断言 5 处 | `wallet-cash-account.service.spec.ts:81, 102, 170`、`tb-account-codes.constant.spec.ts:156, 159`；`:177-178` 原样输出不动；`prisma/seed-tb.helper.ts:115` 自动生效 |
| 20 | admin-web 有单测（根 `jest.config.js:33` roots 含 `admin-web/src`） | §11.1 改写：admin-web 单测照跑（本波改的页面无单测引用，`companyFundsFormat.spec.ts` 必过） |
| 21 | 小出入 | 业主未提交 BACKLOG 条目在 `:156`；`OperatingBalanceCard` 变红逻辑在 `:173-175`（`:192` 是刻线 title）；看板 `perAsset` 唯一读者 `CompanyFundsDashboard.tsx:510` 新语义下仍成立；`performCheck` 审计 metadata 是 `{ ...status }`（`:209`），`perWallet` 自动入审计，无需另写 |
| 22 | 已核无出入 | 六个现金户可解析（`vaults.manifest.ts:16-17` 两网络都有；`SystemWalletResolver.resolve` 收任意 vaultCode；种子 `seed.business.ts:213-234` 七行平台钱包都开现金户）；看板、RBAC、词表脚本、三桶债务、decisions、delivery、截止过滤、小数位各行均与 spec 一致 |

## §1 已核事实（2026-11-07 两只 sonnet 扫描 + 主会话抽查；plan 不必重查）

**NLA 与门**
- `prudential.service.ts:95-131` `computeStatus()`：对 `asset.currency ∈ {AED, USDT}` 逐资产 `systemWallets.resolve(asset.id, 'F_OPS')` → `accounting.resolveCashAccountId(wallet.id, ledger)` → `lookupBalance`，口径 `debitsPosted − creditsPosted − creditsPending`，USDT 经 `usdtMinorToAedMinor`（`prudential.constants.ts:17`）折 AED；常量 `MONTHLY_OPEX_BASE_AED_MINOR = 100_000_000n`（:11）、`NLA_FLOOR_AED_MINOR = ×12/10`（:13）。返回 `PrudentialStatus`（:67-80）：`perAsset[]{assetCode, currency, balanceMinor, aedEquivalentMinor}`、`nlaAedMinor`、`floorAedMinor`、`headroomAedMinor`、`breached`、`monthlyOpexBaseAedMinor`、`coefficient`、`pegRate`。端点 `GET /admin/prudential/status`（`prudential.controller.ts:29`，RBAC `FUNDING_DASHBOARD_VIEW` `rbac.catalog.ts:583`）、`POST /admin/prudential/check`（:36，`PRUDENTIAL_CHECK_WRITE` :586）。
- 门 `assertPostOutflowCompliant`（:142）调用点 3 处：付款单 `vendor-payment-workflow.service.ts:95`（仅 `fromWallet.vaultCode === 'F_OPS'`，:94 注释「NLA 只算运营户」）；调拨单 `house-transfer-workflow.service.ts:95`（仅 from = F_OPS，`orderKind: 'HOUSE_TRANSFER'`）；LP 兑换单 `lp-exchange-workflow.service.ts:120`（无条件）。
- 断言「只读 F_OPS」的测试：`prudential.service.spec.ts:47-52, 94-98, 132`；门是否被调：`test/vendor-payment-from-wallet.e2e-spec.ts:208`、`test/house-transfer.e2e-spec.ts:329`、`vendor-payment-workflow.service.spec.ts:161, 222, 239`、`house-transfer-workflow.service.spec.ts:104, 113, 118, 126`。没有任何测试断言「手续费户余额不计入 NLA 数字」本身。
- 基线 `demo/baseline.md:283-289`：口径一（reset 后）`F_OPS(AED)=94,750,000` 分 + USDT 折 `41,719,600` = **136,469,600 分**；口径二（demo:all 后）**136,475,225 分**；红线 120,000,000；场景 31 破线 1,114,752.25、场景 32 注资后 1,414,752.25；`:358` 另提三个数。`demo/script.md` 含 NLA 数字的行约 20 行（:456 … :848），`data.md` 无数值型 NLA 行。BACKLOG `:356` 是 NLA 待裁条。

**看板**（`admin-web/src/pages/CompanyFundsDashboard.tsx`，653 行，纯前端组装，:2-3 注明不建聚合端点）
- 五路并行 fetch（:305-315）：`/assets?take=100`、`/admin/tb/accounts?ownerType=SYSTEM`、`…?ownerType=WALLET&code=50`、`…?ownerType=LP&code=51`、`/admin/tb/account-flows?take=200`。后端 `tb-admin.controller.ts:21-30` → `TbAccountRegistryService.findAll`（`tb-account-registry.service.ts:93-132`，按 ownerType / code / assetCurrency / q 过滤，行带 `walletRole` / `walletNo` / `ownerName` / 余额）。
- 分格全在前端：`cashAccountsByRole(walletRole)`（:385-388）只取 `F_OPS` / `F_LIQ` / `F_SET`（:393-395）；**`F_FEE` 在本文件零出现**；收入按 210–212（`INCOME_CODES` :62-66）；开支 300–302 在 `COMPANY_CODES`（:71-78）里只用于流水过滤，**没有任何格展示开支**。区块：NLA 区（:437-535，含 `Run prudential check` :454 与水位条 :397-401）、① Operating Balances（:544-556，`OperatingBalanceCard` 带低水位红 :192）、② LP Delivery in Transit（:559-567）、②′ Due from LP（:570-582）、③ Settlement in Transit — Fiat（:585-593）、④ Income (profit)（:596-609）、⑤ Recent Fund Movements（:612-645）。小数位经 `buildAssetLookup` / `currencyOf`（:337-351，`companyFundsFormat.ts`）先把 code 收敛成 currency 再查——这是对的写法。
- 看板与科目页同源：两页都读 `GET /admin/tb/accounts` 的同一批行。

**云端面板与重摆脚本**
- 前端 `admin-web/src/components/DemoOpsPanel.tsx`：区块「Restore reconciliation scenarios」:139-160（按钮 `Restore recon scenarios` :156，`requestReconBreak` :70-，`POST /demo-ops/recon-break` :73）；「Reset all demo data…」:132（`/demo-ops/reset` :60）；轮询 `GET /demo-ops/status` :34。入口按钮 `DashboardLayout.tsx:703-712`（`simulationModeEnabled && demoOpsAvailable`，探测 :130-137，挂载 :757）。
- 后端 `src/modules/demo-ops/demo-ops.controller.ts:15`（`status` :19、`reset` :26、`recon-break` :34-38 → `startReconBreak`）；门控在模块层 `demo-ops.module.ts:8,12`（`DEMO_OPS === '1'`，云端 `deploy/demo.env.template:29`）；`demo-ops.service.ts:50-` `startReconBreak()` 用 `spawn('npm',['run','recon:demo:break'])`，状态 `idle/running/done/fail`、尾 40 行；测试 `demo-ops.service.spec.ts:94-100`。**无审计码、不进 RBAC catalog**（:9-12 头注释「舞台机械」）。
- `recon:demo:break` 的其他调用方（都在空库上跑）：`deploy/demo-run.sh:3,65`（每次开机第 8 步）、`更新重铺.command:48`、`scripts/cloud-verify.sh:37-44`、`package.json:35` `main:recon:break`；文档 `CLAUDE.md:143`、`demo/script.md:7,230,246`、`demo/baseline.md:57,578`、`TOOLING-DEBT.md:33,49,132,160`。
- `scripts/recon-demo.ts`：R37 前置闸 `assertNoAnchoredExplanations` 定义 :278-，唯一调用 :1977（在 `mode === 'reset'` 分支之前，四模式都过）；走不到的排除码 91 那段 = 过滤块 :489-499 里的 :495-497（注释两行 + `eventCode: { not: SHORTFALL_RECOGNIZED_EVENT_CODE }`）。

**权限桶**（`src/modules/identity/access-control/rbac.catalog.ts`，1681 行）
- `treasury.view_funding` :1117-1120 `['FUNDING_READ']`｜`treasury.act_funding` :1122-1125 `['FUNDING_WRITE']`｜`treasury.view_house_transfers` :1127-1130 `['FUNDING_READ']`｜`treasury.act_house_transfers` :1132-1135 `['FUNDING_WRITE']`。调拨单四条路由 :577-580 按组名挂（写 `FUNDING_WRITE`、读 `FUNDING_READ`），桶与路由之间没有单独的挂表。
- `scripts/verify-rbac.ts` S13d :840-886 断言 `totalDomains === 15 && totalBuckets === 89 && declaredPermissionGroups.size === 96`，:871-873 注释记「戊波二 T5 新增两桶 87→89」；S14a-c（:902-940）只按组名。今日实数（取并集脚本）：domains 15 / buckets 89 / groups 96。`verify:rbac` 既有红：仅 S7 四行 sumsub demo 死行（`TOOLING-DEBT.md:142-148`）。

**审计词表**
- `scripts/export-audit-vocab.ts:23` `SEED` 默认 `doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md`，`:24` `OUT = doc-final/lark/2026-09-16-audit-actions-catalog-full.md`；种子行正则 :63（五列 `| 动作码 | 说明 | 旅程 | 必填字段 | 异步 |`，示例 `:15-17`）；域节头 `/^## ([A-Z]+) 域 —— (.+)$/`（11 域 :9 … :687）、分组头 `### …（n）`；缺说明判定 :92-103 → `exit 1`（写盘之前）；退役码容忍 :106-108；19 份名册 :11-19 / :26-46。`npm run audit:vocab` 今日 **exit 1，29 码缺说明**：波二 8（`HOUSE_TRANSFER_REQUESTED / CANCELLED / REJECTED / EXECUTION_STARTED / LEG_POSTED / SETTLED / FAILED`，`INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`）+ 既有 21（`DD_ASSESSMENT_CONCLUDED / OPENED / SAVED`、`DD_INFOSEC_RECORDED`、`DD_SCREENING_RECORDED`、`DOCUMENT_UPLOADED`、`LP_PROFILE_APPROVAL_CANCELLED / RESUBMITTED / RETURNED / SENT_FOR_APPROVAL`、`VENDOR_ACTIVATED / APPLIED / APPROVAL_CANCELLED / APPROVAL_REJECTED / APPROVED / MATERIALITY_UPGRADED / NOTIFICATION_OPENED / REJECTED / RESUBMITTED / RETURNED / SENT_FOR_APPROVAL`，来自甲波六服务商背调与 LP 两步准入）。种子路径字面只在该脚本引用；`TOOLING-DEBT.md:164` 登记了「种子在业主维护区、与 §8 撞车」，`:203` 写的 `export-audit-vocab.ts:136` 现为 `:137`。
- 管理台审计页**不读词表**：`AuditLogsPage.tsx:616` 显示 `userActionLabel`，后端 `audit-logs.service.ts:285` `toDisplayLabel(userAction)` 从码名机械拼出。

**e2e 迪拜窗口**（`TOOLING-DEBT.md:211`）
- 按 UTC 日写的夹具：`test/recon-aging-write-off.e2e-spec.ts:349, 414, 543`、`test/recon-supplement.e2e-spec.ts:276`、`test/recon-reattribution.e2e-spec.ts:126, 341`、`test/recon-adjustment-money-arcs.e2e-spec.ts:144, 400` 及场景 9（:1056 起 `PAST_DATE` / `FUND_DATE` / `PAST_CUTOFF`）。已按迪拜日写的对照：`recon-internal-delta.e2e-spec.ts:210`、`recon-internal-transfer.e2e-spec.ts:99`（`toBusinessDate`）。产品 helper `src/modules/accounting/tigerbeetle/utils/business-date.util.ts`（`toBusinessDate` :7、`endOfBusinessDate` :12、`startOfBusinessDate` :17；头注释 :4 禁手拼）。波二 e2e 基线：B 集 22 名（`checkups/2026-11-07-campaign-e-wave2-evidence/e2e-baseline-0c6eb7b0.md` §2），其中「recon-aging 主链路时区」一名预计随夹具修复转绿。

**停放小项**
- `BACKLOG.md:220`：「已结案案件页五格取破口快照、差异行按结案那一轮重建」那条（波二终审 M5）——骨架说「末句说反」。
- to 钱包文案：`firm-wallet-picker.service.ts:16-33` `assertEligible(walletId, assetId, tx?)` 一律抛 `FROM_WALLET_NOT_ELIGIBLE` /「cannot be chosen as the **from** wallet」；调拨单 `house-transfer-workflow.service.ts:88-89` 对 from、to 各调一次，to 不合法也报 from 文案；:10 注释称三处同调（付款单、调拨单、认损补缺）。
- 案件页侧栏 Δ：`ReconciliationCasesDetailPage.tsx:671` 读 `kase.deltaAmount`（外部差额）；对内不平案外部差额为 0，侧栏就显示 0.00。对内 Δ 的既有取法：`utils/caseInternalCheck.ts:54-59` `listBooksDelta`（列表页 :29 在用）、`:23-29` `buildInternalCheckLine`（`CaseBalanceTiles.tsx:135-146`）。
- 码 2 户名：常量表 `tb-account-codes.constant.ts:52` `'Custody Shortfall Receivable'`（= 总纲附录 A :103 英文名），户名生成 :173 / :183-184 字面 `Custody Shortfall · ${ownerNo} · ${role}`（少「Receivable」）；测试断言 `wallet-cash-account.service.spec.ts:81,102,170`、`tb-account-codes.constant.spec.ts:81,153-178`；admin-web / prisma / scripts 无此字面。
- 截止过滤三支：`engine/v2/effective-cutoff.ts:21-32`（① 早于业务日 ② 同日且 createdAt ≤ cutoff ③ 同日回填 createdAt > endOfBiz），单测 `effective-cutoff.spec.ts:16-29, 40-46`；e2e 只有场景 9（`recon-adjustment-money-arcs.e2e-spec.ts:1038-1056` 注释声明走第③支，:1123-1128 断言 `createdAt.slice(0,10) > PAST_DATE`）。
- 小数位：`LedgerAccountList.tsx:155-157` `decimalsMap` 按 `asset.currency` 建键（`USDT`），`:184` `decimalsOf(assetCode)` 用行上的 `assetCode`（`USDT-TRON`）查，查不到回退 2 位（:364 使用）；**`AccountFlowList.tsx:116-121 / :128 / :436, 440` 同款写法**（BACKLOG 只点了科目页）；`LedgerAccountDetail.tsx` 无小数位格式化。资产注册表 `assets.manifest.ts:36-48` USDT：`currency 'USDT'`、`code 'USDT-TRON'`、`decimals 6`。BACKLOG `:358-359`（含「更深根因」四处注册表键的说明）。

**文档现状**
- `modules/accounting-coa.md`（63 行）：`:3` 状态行自述「其余章节仍是 2026-08-26 的 COA v2 底稿，整篇重写留波三」；旧口径 `:14`（九个科目）、`:16`、`:20`、`:54`（9 码）；§2 天平 `:28` 已是 v3。其他 modules 旧科目行：`company-funds.md:12, 16, 99`、`lp-desk.md:8, 32, 36, 79, 113`、`overview.md:101`（10 码）；`v8-recon.md` §1 / §5 与 `funds-orders.md`、`v6-swap.md`、`v7-treasury.md` 的分录句按总纲 §6 第 2 条逐篇核（grep 盲区：中文旧名「客户资产池 / 公司资产 / 结算中转」与 `CLIENT_ASSET / FIRM_ASSET / FIRM_SET` 字面要另搜）。
- `delivery/`：`semantic-contract.md:24` S9「科目表 9 码封闭…decisions 2026-08-13」、`:25` S10、`:28` S13；`decision-log.md:10` D-5「COA 终盘 9 码」、`:15` D-10「认损调账＋补款划转两步」、`:16` D-11、`:26` D-21；`dependency-contract-status.md:8`（引 S7/S8/S9）、`:13`（托管方回单占位）；`nonfunctional-baseline.md` 无命中（数字型基线按 §9 核）。
- `decisions.md`（170 行，单行条目 `- [日期] **标题**：正文 ｜ 依据 ｜ 业主拍板`，只追加）：`:5` 2026-06-25 实时 1:1、`:13` 2026-08-13 九码、`:24` 2026-08-26 地基不动、`:149` 2026-09-28 F_LIQ 复活；**尚无 COA v3 / 戊条目**。波二 spec §10 列的待写条目：托管短缺待补甲案 + 认损补缺一张单（翻 2026-09-05 `:61`；`:27 / :63 / :65` 仍按旧补款路径写，收官时一并核）、公司调拨单（翻 `:59`）、付款单 from 可选、扫费同额结转、对内差额开案 / 结案、第 0 轮锚配对、NLA。
- `reference/coa-v3.md`（55 行）：`:4` 状态「目标态」；科目表 14 行（含 150 列而不开）`:13-26`；退役码 `:27`；物理位置 ↔ 现金户表 `:35-45`；不在 CLAUDE.md 路由表、由总纲链到。
- `CHANGELOG.md` 格式 `- [日期] **标题** —— 观众能感知的变化：①…`，`:5` 波二、`:6` 波一。`CLAUDE.md:143`（面板两按钮）、`:98`（lark 行）、`:101`（reference/roadmap 行）、`:103`（不读 archive / lark）。`TOOLING-DEBT.md:211-213` 波二三条、`:164 / :203` 词表两条；`PRODUCTION-NOTES.md:559-562` 波二四条（本波不动）。`BACKLOG.md` 工作树有**未提交的业主条目**（`:155`，2026-10-29「登记欠款入口」），本波改 BACKLOG 时连同提交。

**数字基线**（骨架「对波三的前提」）：审批策略 56｜MAKER 55 + 1｜S9 = 路由表 46｜审计现役码 386（19 册）｜TB 科目码 13｜转账码最大 91｜演示库科目 105｜花名册 35 / asserts 5｜对账 21 钱包、18 场景、12 桶、12 案｜全量 jest 288 套 / 4862 例｜RBAC 15 域 / 89 桶 / 96 组。

## §2 本波做 / 不做

**做**：① NLA 口径三算两不算 + 门只在钱离开公司时过（§3）；② 看板改版（§4）；③ 云端面板撤重摆按钮、端点与 service 退役、`recon-demo.ts` 死段删除（§5）；④ 审计词表搬家、补 29 行、`audit:vocab` 进收尾闸（§6）；⑤ R19 两桶删除（§7）；⑥ e2e 夹具改迪拜业务日（§8）；⑦ 停放小项六项 + 科目页小数位（§8）；⑧ 文档清册（`delivery/` 先、`decisions.md` 11 条、`accounting-coa.md` 整篇重写、`coa-v3.md` 定稿 + 记账总表、各模块分录句、剧本 / 基线 / data.md、CLAUDE.md 三行、三桶债务销账、BACKLOG、CHANGELOG）（§9）；⑨ 七幕走查 + 战役归档（§10）。

**不做**（对照项目总纲 §2 与总纲 §5）：账本三列表分组 / 钱包筛选（业主推迟，记 BACKLOG）｜ 账本科目页十六进制「ID」列（既有，记 BACKLOG 不动）｜ NLA 之外任何新审慎规则、红线系数、月开支基数 ｜ 结算钱包或应收 LP 以任何形式计入 NLA ｜ 重摆按钮改造成「连带清掉带锚处置」｜ 新审计码、新端点、新审批、新状态 ｜ 21 个旧审计码当年为何漏说明的追溯 ｜ `lark/` 全量版手工编辑（只由脚本生成）｜ `reference/roadmap.md`（业主维护，骨架 R39 提到的 V7 行与 :431 / :442 / :452 旧补款路径由业主改，spec 只在收尾报告里提醒）｜ `cloud:deploy`（业主触发）｜ 小数位「更深根因」（注册表 `asset.code` 键）的改造——显示层查对键即修好，BACKLOG 该条销账时把根因句保留为一条新的低优先级条目 ｜ 客户侧任何改动。

## §3 NLA 口径与算术门

**公式**（`prudential.service.ts computeStatus`）：对资产 ∈ {AED, USDT}、钱包角色 ∈ {`F_OPS`, `F_FEE`, `F_LIQ`}，逐个 `systemWallets.resolve(asset.id, role)` → `resolveCashAccountId` → `lookupBalance`，余额口径不变（`debitsPosted − creditsPosted − creditsPending`），USDT 折 AED 不变；`F_SET` 与码 51 不读。NLA = 六个现金户折 AED 之和。某资产下该角色钱包不存在（例如 F_SET 只走法币，但它本来就不读）→ 不在本波范围；三个角色在两种资产上都有钱包（`vaults.manifest.ts:14-17`）。

**返回结构** `PrudentialStatus`：新增 `perWallet: Array<{ vaultCode: 'F_OPS' | 'F_FEE' | 'F_LIQ'; label: string; assetCode: string; currency: string; balanceMinor: string; aedEquivalentMinor: string }>`（六行）；`perAsset` 保留，语义改为「该币种三个钱包合计」；其余字段不变。`label` 取 `vaults.manifest.ts` 的 `label`（Company Operations / Company Fees / Company Liquidity）。

**门**（裁定 2）：
- 付款单 `vendor-payment-workflow.service.ts:94-95`：去掉 `=== 'F_OPS'` 条件，两种 from 恒调门；注释改写。
- 调拨单 `house-transfer-workflow.service.ts:95`：删除门调用；`PrudentialOrderKind` 里的 `'HOUSE_TRANSFER'` 分支与审计里对手方写法若因此成孤儿，一并删（自身清理）。
- LP 兑换单 :120 不动。
- 门的算法不变：`after = NLA − 折 AED 出款额`；只是「谁调」变了。

**测试**（行号以 §0.1 第 4–7 条为准）：`prudential.service.spec.ts` mock 按角色返回不同钱包与余额，断言 6 次 `resolve`（三角色 × 两资产）与 6 次 `resolveCashAccountId`、`perAsset` 为三钱包合计、新增一条「F_SET 余额不进 NLA」（mock 里给 F_SET 一个大余额，NLA 不含它）、删 `:300, 310` 两条调拨单过门用例、`:185-189 / :332` 固定写法加 `perWallet`；`vendor-payment-workflow.service.spec.ts:222` 与 `:337`、`test/vendor-payment-from-wallet.e2e-spec.ts:156, 161, 205` 的「from = F_FEE 不调门」反转为「调门」；`house-transfer-workflow.service.spec.ts:128-134` 删、`:76` 去 `prudential` 注入、`test/house-transfer.e2e-spec.ts:329` 反转为「两向都不调」。

**读面**：看板 NLA 区三个小格读 `perWallet`，按 `vaultCode` 分三格、格内两币种各一行；脚注固定文案「Not counted: Company Settlement (money already on its way to a client) and amounts due from LP (not yet received). USDT at the pegged rate.」。`Run prudential check` 的审计 metadata 若含余额明细，执行者按 `perWallet` 同形写入（审计码不变，`PRUDENTIAL_CHECK_PERFORMED` 四属性不动）。

**基线与剧本**：`baseline.md:283-289` 两口径数字重钉（口径一 = reset 后六户之和；口径二 = demo:all 后）；场景 31 仍须破线、场景 32 注资后仍须回到红线之上——执行者在 self 栈实走取数后改 `script.md` 约 20 行 NLA 数字；若新口径下场景 31 不再破线（手续费户与前厅之和 ≥ 缺口 85,247.75 AED），**停下来回主会话**，不许改事故金额来凑。`data.md` 不动（无数值 NLA 行）。BACKLOG `:356` 销账。

## §4 看板

`CompanyFundsDashboard.tsx` 五区改四格 + NLA 区：
1. **NLA 区**：大数字、红线、余量、水位条、`Run prudential check` 原样；大数字下新增三个小格（§3 读面）+ 脚注。
2. **Company wallets**（取代 ① Operating Balances、② LP Delivery in Transit、③ Settlement in Transit 三格）：表格四行固定顺序 Operations / Fees / Liquidity (LP front hall) / Settlement (fiat only)，列 Wallet｜AED｜USDT｜In NLA；In NLA 列前三行 `counted`、Settlement 行 `in transit`；Settlement 的 USDT 格显示「—」（F_SET 只走法币）。Operations 行保留今天 `OperatingBalanceCard` 的低水位红（:192）语义：低于阈值该格数字变红并带 title。四行数据仍来自同一次 `…?ownerType=WALLET&code=50` 请求，按 `walletRole` 分行，**新增 `F_FEE`**。
3. **Due from LP — Pending Delivery**：原样。
4. **Income (profit)**：原样。
5. **Expenses**（新）：300 Bank & custody charges / 301 Reconciliation write-offs / 302 Other expenses 三行 × 按币种，取自已拉的 SYSTEM 户（`COMPANY_CODES` 已含 300–302），户名字面照科目页。
6. **Recent Fund Movements — Last 10**：原样。
页面副标题（:409）改为「Firm liquidity at a glance — company wallets, due from LP, income and expenses」。无新端点；无新权限。**同源同值核对**：看板 Company wallets 四行 × 两币种的数字与科目页按 `code=50` 筛出的同户余额逐格相等（走查时截图并列）。文案按 `frontend-admin.md` 既有英文风格。

## §5 云端面板与重摆脚本退役

- 前端：删 `DemoOpsPanel.tsx:137-159` 整块（含 `:138` 开标签）、`requestReconBreak`、`reconState / reconRequested / reconPending` 状态、`DemoOpsStatus.reconBreak`（:11-14）、`:4` 头注释与 `:55` `busy` 里的 recon 引用；`Reset all demo data…` 及其确认流原样；`DashboardLayout` 不动。
- 后端：删 `demo-ops.controller.ts:33-39` `recon-break`、`demo-ops.service.ts startReconBreak` 及 `reconBreak` 状态字段；测试：`demo-ops.service.spec.ts:93-134` 三用例删、`:43-46` 去 `reconBreak`，`demo-ops.controller.spec.ts:10, 15, 24` 随删（用例名改「两条路由」）；`status` 返回体去掉 `reconBreak`。
- 脚本：`scripts/recon-demo.ts:495-497` 删除（过滤块其余原样），本地常量 `SHORTFALL_RECOGNIZED_EVENT_CODE`（`:116-117`）随删；`assertNoAnchoredExplanations` 与 :1977 调用保留；`package.json` 的 `recon:demo:*` / `main:recon:*` 保留；`deploy/demo-run.sh`、`更新重铺.command`、`cloud-verify.sh` 不动。
- 文档：`CLAUDE.md:143` 改为「Demo Data 面板只有『重铺数据』（整服务自退重启约 1 分钟，末步自动重摆对账差额）；带锚处置落账后 `recon:demo:*` 命令行被拒、只能重铺」；`script.md:230, 246`、`baseline.md:57, 578` 同口径改写；`TOOLING-DEBT.md` 四处提到 `recon:demo:break` 的行按命令行语义核一遍、不涉及按钮的不动。
- 退役四件套：前端入口 ✓、端点 ✓、service ✓、测试 ✓；`grep -rn "recon-break"`（src / admin-web/src / scripts / deploy / doc-final 非 archive）终态 **0**。

## §6 审计词表归 agent 维护

- `git mv doc-final/lark/2026-09-15-audit-actions-catalog-by-domain-workflow.md doc-final/reference/audit-actions-vocab.md`；文件头两行改写为「审计动作码词表（种子）｜ agent 维护：新增审计码必须在这里补一行，`npm run audit:vocab` 校验并生成 `lark/2026-09-16-audit-actions-catalog-full.md`（给飞书）」，去掉「生成于 2026-09-15 ｜ 基线 …」那种一次性头（计数行由执行者按实际改）。
- `scripts/export-audit-vocab.ts:23` `SEED` 默认改新路径；`OUT` 不变。
- 补 29 行：每行五列照既有格式；**说明**列用中文一句人话（照既有行的粒度，如「金库提交公司调拨单（扫费）」）；**旅程**列按常量 `correlationMode`（S 起点 / I 继承 / N 单步）；**必填字段**照常量 `requiredFields`；**异步**列按 `requiresCausation`；域节与分组按常量 `domain` 放（8 条波二码进 TREASURY，`LP_PROFILE_*` 进 TREASURY，`VENDOR_*` / `DD_*` / `DOCUMENT_UPLOADED` 按各自常量的 `domain`），放进语义相近的既有 `###` 分组或新开一组（如「公司调拨单（7）」「LP 两步准入补遗（4）」「服务商与 LP 背调（n）」），域节头括号里的码数随改。
- `npm run audit:vocab` → exit 0、`386` 现役码、全量版重生成并随提交入库（全量版头部版本哈希由脚本写）。
- 规则落地：`rules/delivery-checklist.md`「新增审计动作码」行加「+ `reference/audit-actions-vocab.md` 补一行，`audit:vocab` 绿」；`CLAUDE.md` §8 路由表加一行「新增审计码 → `reference/audit-actions-vocab.md`（agent 维护；`lark/` 的全量版是它的导出）」；§8 `:98` lark 行加括注「全量审计清单是 `reference/audit-actions-vocab.md` 的生成物」。`TOOLING-DEBT.md:164` 销账、`:203` 行号订正为 `:137`。
- `CLAUDE.md §7` 收尾闸不加常驻项（闸门清单保持短）；`audit:vocab` 进本波验收口径（§11）与 delivery-checklist 触发行。

## §7 权限桶合并（R19）

删 `rbac.catalog.ts:1127-1135` 两桶；`scripts/verify-rbac.ts` S13d 三处（`:874` 说明串、`:875` 判断 `89 → 87`、`:882`「预期 89」）与 `:871-873` 注释改写为「戊波三删两桶 89→87」；`grep -rn "view_house_transfers\|act_house_transfers"`（src / scripts / prisma / admin-web/src / test）终态 **0**；文档里的三处（`demo/baseline.md:484`、`modules/overview.md:61`、`modules/company-funds.md:89`）随 §9 改。桶目录在内存（`access-control.service.ts:118`）不进库，**只需重启后端**，不跑 `db:base:sync`；角色编辑器里 Treasury 域开关数减 2（截图）。终态：15 域 / **87** 桶 / 96 组。

## §8 停放小项与小数位

| # | 项 | 做法 |
|---|---|---|
| 1 | BACKLOG「被锚定的调账单少付…仍读绿色『Explained · ADJ…』」条末句说反（已提交版 `:220`，工作树 `:222`） | 末句「预填原值（pass 0）则行保持 AMOUNT_MISMATCH」按代码语义改写为「pass 0 按锚配对判 AMOUNT_MISMATCH；只有操作员改了预填金额、落账低于差额才会出现『行读 Explained 但金额对不上』」，条目保留 |
| 2 | to 钱包报错文案写成 from | `FirmWalletPickerService.assertEligible(walletId, assetId, side: 'from' \| 'to', tx?)`；`side = 'to'` 时 code `TO_WALLET_NOT_ELIGIBLE`、文案「…cannot be chosen as the to wallet…」；三处生产调用方传 side；测试按 §0.1 第 11 条逐处改（picker spec `:67`、三份 mock 的按参数断言、`house-transfer.e2e:397` 改断言码） |
| 3 | 对内不平案侧栏 Δ 显示 0.00 | `ReconciliationCasesDetailPage.tsx:671` 下加一行 `SidebarKV label="Books Δ"`，直接读 `kase.internalDeltaAmount`（`reconTypes.ts:186`）经 `formatAmount` 带符号显示；缺或为 0 显示「—」；外部 Δ 行原样。截图一张对内不平案 |
| 4 | `recon-demo.ts:495` 死段 | §5 已删 |
| 5 | 码 2 户名字面 vs 常量英文名 | 户名生成 `tb-account-codes.constant.ts:173, 183-184` 改为 `Custody Shortfall Receivable · ${ownerNo} · ${role}`（以常量表 :52 = 总纲附录 A 为准）；五处测试断言随改（§0.1 第 19 条）；`seed-tb.helper.ts:115` 自动生效；重铺后科目页截图一张码 2 户 |
| 6 | 截止过滤第③支无 e2e | 不新写 e2e 文件：场景 9（`recon-adjustment-money-arcs.e2e-spec.ts:1123-1128`）把「`createdAt.slice(0,10) > PAST_DATE`」加强为「`createdAt > endOfBusinessDate(PAST_DATE)` 且该行被匹配器纳入（MATCHED）」，显式钉住走的是第③支 |
| 7 | 科目页 / 流水页小数位 | `LedgerAccountList.tsx:155-157, 184` 与 `AccountFlowList.tsx:116-121, 128` 改用 `companyFundsFormat.ts` 的 `buildAssetLookup` / `currencyOf`（看板既有写法）按 `assetCode` → `currency` → `decimals` 查；重铺后 USDT-TRON 户与流水各截一张（改前放大一万倍、改后 6 位）；BACKLOG `:358` 销账，`:359` 的「更深根因」拆成一条新的低优先级条目 |

## §9 文档清册（按此顺序改；一篇不漏，逐篇在证据 README 打勾）

1. **`delivery/`（先）**：`semantic-contract.md:24` S9 改写（13 码、类由代码定义 / 户随钱包登记自动开、两条天平、150 列而不开、三条永久否决保留、依据改指 `decisions.md` 新 COA v3 条 + `reference/coa-v3.md`）；`:25` S10、`:28` S13 核认损补缺一张单后的措辞；`decision-log.md:10` D-5 标「被 D-xx 取代」、`:15` D-10 改为认损补缺一张单（取代两步）、新增 D 条：COA v3、公司调拨单、付款单 from 可选、扫费结转、对内差额、第 0 轮锚配对、NLA 三算两不算 + 门只在钱离开公司时过；`dependency-contract-status.md:8, 13` 核；`nonfunctional-baseline.md` 数字型基线（科目 105、码 13、转账码 91 等）核。
2. **`decisions.md`**（只追加，11 条，日期 2026-11-07，每条末尾「业主拍板」或「作者裁定、业主认可」）：① COA v3（点名 `:13` / `:24` / `:149`；FIRM_SET / FIRM_LIQ 作为科目退役、作为现金户存续；「类是代码定义的，户随钱包登记自动开」；两条天平）② 托管短缺待补甲案 + 认损补缺一张单（翻 2026-09-05 `:61`；`:27 / :63 / :65` 核）③ 公司调拨单（翻 `:59`；用途是标签；from / to 限运营户与手续费户）④ 付款单 from 可选 ⑤ 扫费同额结转（含「收入户余额 = 未扫的费」的代价）⑥ 对内差额 ≠0 即开案、归零才结案 ⑦ 第 0 轮锚配对取代 sourceType 排除 ⑧ NLA 三算两不算 + 门只在钱离开公司时过（正面翻 2026-09-30 `:152`「`FIRM_LIQ` 在途不计」那半句，新事实 = 业主「只看物理钱包里的钱」口径 + 口袋间挪钱不变原则；覆盖波二裁定 12）⑨ 云端面板只留重铺、带锚处置后只能重铺 ⑩ 审计词表归 agent 维护 ⑪ 入账追回与垫款链挂起（总纲 §6 第 3 条）。
3. **`modules/accounting-coa.md` 整篇重写**（§0–§6 骨架不变）：13 码分五类、开户粒度与开户时机、七个公司钱包现金户 + 客户钱包每户两码、两条天平、转账码 1–91 只给索引（总表在 `reference/coa-v3.md` §2）、NLA 口径一句、演示脚本按账本视角、§5 技术节点（常量文件、`verify:coa`、开户服务）、§6 缺口（科目页分组推迟、150 不开、追回链挂起）。
4. **`reference/coa-v3.md`**：状态行改「现状（2026-11-07 戊波三定稿）」；科目表按实际落地核一遍（码 2 英文名、户名模式）；**新增 §2「七单与调账单记账总表」**（总纲附录 B 按实际落地导出：转账码、借贷科目、eventCode、触发那一步）。
5. **各模块分录句与门语义句**：`company-funds.md:12, 16, 42, 52, 89, 99`、`lp-desk.md:8, 32, 36, 79, 113`、`overview.md:61, 101`、`v8-recon.md` §1 / §5、`funds-orders.md`、`v6-swap.md`、`v7-treasury.md`；代码旧文字 `prudential.controller.ts:28` summary、`rbac.catalog.ts` `treasury.view_dashboard` description、`scripts/recon-demo.ts:708` 注释——每篇先 grep `FIRM_OPS|FIRM_LIQ|FIRM_SET|FIRM_ASSET|CLIENT_ASSET|结算中转|客户资产池|公司资产|9 码|10 码|九码|201|203` 得清单再改，改后同一 grep 只剩合法命中（审计码计数、HTTP 201 之类）；`company-funds.md` 另写 NLA 新口径与看板新格。
6. **`reference/recon-cause-handbook.md`** 分录表按新户名核。
7. **`demo/baseline.md`**：NLA 两口径与场景 31 / 32 数字、`:57 / :578` 重摆口径、`:484` 桶名、RBAC 桶数 87、`audit:vocab` 386 入库行、e2e B 集 20 名。
8. **`demo/script.md`**：NLA 数字行、`:230 / :246`（重摆）、`:532 / :848`（门语义：付款单两种 from 都过门、调拨单不过门）、看板格名（走查时按新页面核）。`demo/data.md` 平台钱包表若已有科目列（`:46 / :48` 已显示户名）则只核不改。
9. **`CLAUDE.md`**：`:143`（§5）、§8 路由表加词表行 + lark 行括注（§6）；§7 不动。
10. **三桶债务**：`TOOLING-DEBT.md:164`（销）、`:203`（订正）、`:211`（销，附修复后在窗口外与拨钟两种口径各跑一次的记录）；`PRODUCTION-NOTES.md` 零改动；`BACKLOG.md`：销「NLA 仍只算运营户」「小数位查找键」两条，改「被锚定的调账单少付」条末句，新增「账本三列表分组视图 + 钱包筛选（业主 2026-11-07 推迟）」「账本科目页十六进制 ID 列（铁律⑥）」「小数位更深根因（注册表键）」三条，连同工作树里业主未提交的 `:156` 条一起提交。
11. **`CHANGELOG.md`** 一行（观众能感知：看板四钱包一格 + 开支格、NLA 新口径、云端面板只剩重铺、to 钱包报错、对内 Δ 侧栏、小数位修好、角色编辑器少两开关）；`CLAUDE.md §9` 报告 `Documentation updated: modules§0-4 / modules§5 / demo / decisions / delivery`。

## §10 收官

1. **七幕走查**（总纲 §6 第 1 条）：self 栈重铺后按 `demo/script.md` 走完；重点场景 16（认损补缺）、31 / 32（穿底与注资，NLA 新数字）、41（扫费）、37（LP 应收）、29（Pay From）、18（事故路）——骨架「走查未覆盖」四项本波补走；每幕关键截图入证据目录。
2. **归档**：总纲 + 波三骨架 + 波三 spec / plan → `archive/superpowers/{specs,plans}/`；`grep -rn "campaign-e" doc-final --exclude-dir=archive` 只剩 CHANGELOG / decisions / 证据目录的历史引用。
3. **`cloud:deploy`**：spec 不跑；收尾报告里一句「连欠波一至波三，命令 `npm run cloud:deploy`，业主触发」。

## §11 验收口径（本波收尾一次过）

1. 随手闸 ①②③ 零输出；本波相关 jest（prudential、company-funding、funds-layer、demo-ops、identity/access-control、clearing-settle/reconciliation、admin-web 单测——根 jest roots 含 `admin-web/src`，本波页面无单测引用、`companyFundsFormat.spec.ts` 必过）全绿；`verify:rbac` S13d 按 87 过、红集与既有基线恒等（仅 S7 四行）。
2. 重铺闸 ⑧：`stack.sh reset self` → `up` → `demo:all` 花名册 35/35、asserts 5/5 → `verify:coa` 105 户全 ≥ 0、两条天平过 → `recon:demo:pass` 21 钱包 0 案 → `recon:demo:break` 18/18 → `verify:coa` 再过。
3. NLA：`GET /admin/prudential/status` 返回 `perWallet` 六行、`nlaAedMinor` = 六行之和（脚本比对）；基线两口径数字写进 `baseline.md` 并复现；场景 31 破线 / 32 回线实走；§3 五组测试反转后全绿；付款单 from = F_FEE 一笔在破线窗口被 400 拒（e2e）；调拨单两向在破线窗口照常成功（e2e）。
4. 看板：截图（light / dark 各一）；Company wallets 四行 × 两币种与科目页同户余额逐格相等（截图并列 + 数字表）；Expenses 格三行；NLA 三小格之和 = 大数字。
5. 面板：self 栈以 `DEMO_OPS=1` 起后端，Demo Data 面板截图只剩重铺块；`POST /demo-ops/recon-break` → 404；`recon:demo:break` 命令行在空库照常 18/18、在带锚处置后照常被拒（R37 不变）。
6. 词表：`npm run audit:vocab` exit 0、386 入库、全量版 diff 只增不减；`grep -rn "2026-09-15-audit-actions" src scripts package.json` 终态 0。
7. e2e 迪拜：四个文件 `grep -c "toISOString().slice(0, 10)\|T23:59:59.999Z"` 终态 0；本波全量 e2e 冷缓存按波二协议跑一遍，失败名集合 ⊆ B 集 22 名 且恰好「recon-aging 主链路时区」「recon-adjustment 用例 9」两名转绿 → 新基线 **20** 名（多一名少一名都回主会话，写进证据）；再用 `e2e-baseline-0c6eb7b0.md` §4 拨钟配方跑同四个文件一次，结果与真实时钟一致。
8. 停放小项：to 钱包 400 `TO_WALLET_NOT_ELIGIBLE`（单测 + `house-transfer.e2e:397` 改断言码）；案件页 Books Δ 截图；码 2 户名截图；场景 9 加强断言绿；小数位改前改后截图各一。
9. 文档清册：证据 README 列 §9 的 11 项逐篇 ✓，每篇附一条「改后 grep 旧名只剩合法命中」的命令与结果；`decisions.md` +11 行、`delivery/decision-log.md` +N 行实数。
10. 七幕走查截图索引；归档后 `grep campaign-e` 结果。

## §12 数量终态（纪律 5；对不上就停）

| 项 | 波前 | 本波 | 终态 |
|---|---|---|---|
| RBAC 动作桶 | 89 | −2 | **87**（域 15、组 96 不变；S13d 常量改） |
| 审计现役码 / 名册 | 386 / 19 | 0 | 386 / 19；词表种子行 364（357 现役 + 7 退役容忍）→ **393**（`audit:vocab` 自证 386 现役齐） |
| 科目码 / 转账码最大 / 演示库科目 | 13 / 91 / 105 | 0 | 不变 |
| 算术门调用点 | 3（两处带 F_OPS 条件） | 付款单去条件、调拨单删调用 | **2**（付款单恒调、LP 兑换单恒调） |
| `PrudentialStatus` 字段 | 8 | +1 `perWallet` | 9 |
| `demo-ops` 端点 | 3 | −1 | 2（`status` / `reset`） |
| `recon:demo:break` 脚本调用方 | 4（demo-run / 更新重铺 / cloud-verify / package） | 0 | 4 |
| e2e 基线 B 集 | 22 名 | −2（recon-aging 时区、recon-adjustment 用例 9，同一时区根因） | **20**（实跑核，多少都停） |
| TOOLING-DEBT | — | −2（:164, :211）、订正 1（:203） | 执行时记行号 |
| BACKLOG | — | −2（:356, :358）、改 1（:220）、+3 | 执行时记行号 |
| `decisions.md` | 170 行 | +11 | 181 行 |
| 文档含旧科目字面 | 见 §1 清单 | 归零 | 只剩合法命中（逐篇附命令） |

## §13 交付清单触发项（plan 写死）

动了钱的门（同步直调，失败即 400）｜ 改页面 → `demo/script.md`、`data.md` 同步、preview 截图（看板 light / dark、面板、案件页、科目页、流水页、角色编辑器）｜ 退役业务动作 → 前端入口同步删（面板按钮）｜ 新增 admin 端点：无；删端点后 `db:base:sync` 不涉及（demo-ops 不在 catalog），但 R19 删桶要 `db:base:sync` + 重启 ｜ 动了审计：零新码，词表补行 + `audit:vocab` ｜ 改 schema：无 ｜ 多波之末：承接写进总纲归档说明 + CHANGELOG ｜ 每轮收尾：CHANGELOG 一行 + BACKLOG 销账 + `CLAUDE.md §9` 报告。

## §14 留给执行者

- `perWallet` 的 `label` 直接取 `VAULTS[code].label`；前端三小格标题用同一字串，不另造文案。
- 看板 Company wallets 的 Settlement 行：F_SET 没有 TRON 钱包行，USDT 格渲染「—」而不是 0。
- `OperatingBalanceCard` 的低水位阈值逻辑迁到表格行时，阈值来源（:192 的 `thresholdMajor`）不变。
- 词表 29 行的说明文字：先读每个码在 `audit-actions.constant.ts` 的四属性与写点（grep 常量名找 `recordByActor` / `recordSystem` 调用处），再写一句；不确定的写点以代码为准，不猜。
- `assertEligible` 加 `side` 参数是破坏性签名改动：三处调用方一次改齐，tsc 自证。
- 文档改写顺序严格按 §9 1 → 11；`accounting-coa.md` 重写时不保留任何「波一 / 波二」过程叙述，只写现状。
- 全量 e2e 必须冷缓存、私库每轮重铺（波二 `e2e-baseline-0c6eb7b0.md` §1 协议），跑完后再决定 B 集新基线；失败名多一名少一名都回主会话。
- 所有数量以执行时实跑为准，§12 的「终态」列是预期，对不上就停。
