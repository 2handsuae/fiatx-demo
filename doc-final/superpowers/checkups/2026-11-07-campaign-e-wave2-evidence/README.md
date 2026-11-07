# 戊波二 · 证据目录

> 起笔：2026-11-07，T0 对照组采样（改前基线）。代码头 `0c6eb7b0`（≡ main `5ff65ef5` + spec/plan 两份文档）。后续任务把各自的证据**追加**在本文件末尾「后续任务」一节，并在上面的清单里补行。

## 1. 文件清单（每个文件证明什么）

| 文件 | 证明什么 | T0 命令 | 退出码 |
|---|---|---|---|
| `client-snapshot-before.json` | **改前**客户侧快照：13 位客户的余额 / 资产组合 / 逐币种流水 / 月结单。`reset self` → `up` → 等月结单 sweep（`customer_monthly_statements` = 55）→ `demo:all` → **在任何 `recon:demo` 之前**拍 | `bash scripts/on-stack.sh self client:snapshot -- --out doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/client-snapshot-before.json` | 0 |
| `e2e-baseline-0c6eb7b0.md` | 全量 e2e 冷缓存串行基线：失败名逐字、与波一终态的集合差、**迪拜日 / UTC 日错位窗口**对基线的影响及拨钟验证 | 见该文 §1 | 1（有已知红，预期） |
| `counts-before.md` | 计数基线：审批 55 / MAKER 54+1 / S9 45 + 路由 45 / 审计 378（18 册）/ TB 科目码 11 / 转账码最大 87 / 账本科目 87；五条可复现命令原文 | 见该文 C1–C6 | 0 |
| `client-snapshot-after.json` + `client-snapshot.diff` | **改后**客户侧快照（`demo:all` 后、任何 `recon:demo` 之前拍）与改前逐字对照：`diff` 退出码 0、**0 行**，两份 sha256 同为 `bfe3110b610528b3…` | `bash scripts/on-stack.sh self client:snapshot -- --out …/client-snapshot-after.json`；`diff client-snapshot-before.json client-snapshot-after.json > client-snapshot.diff` | 0 / 0 |
| `e2e-after-8b40965d.md` | 全量 e2e 冷缓存串行（改后）与 B 集 22 名的名字级比对、多出两名的单跑复核、卡单污染的反向探针 | 见该文 §1 | 1（有已知红，预期） |
| `evidence-by-transfer-code.md` + `a4-evidence.js` + `a4-table.js` + `evidence-raw-phaseA.json` / `…phaseB.json` | 转账码抽核表：每一行 evidence 都拿去 TigerBeetle `lookup_transfers` 取实记 `code` 与借贷账户 `code`，对附录 B（波一 / 波二列）逐行双检；新码 88–91、83 两形态、85 新贷方 51 都在 | 见 §5.4 | 0 |
| `t1-…` … `t11-…` 各任务证据与 88 张截图 | 各任务自己的命令 / 退出码 / 渲染截图 | 见 §4、§5.7 | — |

## 2. 客户侧快照的验证（T0 采集时做的）

- **同库再拍一次**：`diff` 退出码 0、0 行。
- **独立重铺再拍一次**（收尾那次 `reset self` → `up` → `demo:all`，同代码）：`diff` 退出码 0、0 行；两份 sha256 同为 `bfe3110b610528b3…`。T12 拿改后快照对 `client-snapshot-before.json` 做 `diff`，非空 = 客户侧有变化。
- **对波一的 `client-snapshot-before.json`**（`2026-11-06-campaign-e-wave1-evidence/`，sha256 `c0195e64…`）：把本快照里的 `261107######` 替换成 `261106######` 后 `diff` 为空（232 行差异**全部**是单号日期段）。即：代码未动时，两天的快照除订单号里的重铺日外逐字相同。
- 取快照前提满足：后端起来 > 30 s、`customer_monthly_statements` = 55；快照内 `"error"` 键 0 个，STM 号 55 个，订单号遮罩 58 处。
- ⚠️ **日期段**：订单号形如 `DEP261107######`，日期段 `261107` 是**机器本地日期**（`generateReferenceNo` 用 `new Date().getFullYear()/getMonth()/getDate()`，本机时区 +04）= 重铺当天。T12 若不在 2026-11-07（本机本地日）重铺，`diff` 里会冒出单号日期段差异，要么先对其中一份做 `sed` 归一化（波一裁定 R9 的口径），要么就地说明；这与代码无关。
- 失效验证沿用波一 `2026-11-06-campaign-e-wave1-evidence/client-snapshot-control.md`（剥离器 / 遮罩 / diff 闸三项）；本任务没改 `scripts/client-side-snapshot.ts`，未重做。

## 3. T0 的三个值得下游知道的事

1. **e2e 基线随时钟窗口变**：每天 UTC 20:00–24:00（= 迪拜 00:00–04:00）窗口内跑，会多出 11 个失败名（10 个窗口效应 + 1 个已知偶发）；窗口外 / 拨钟后是 9 套件 22 例，与波一终态逐名一致。T12 须在窗口外跑（迪拜 04:00–24:00）或用 `e2e-baseline-0c6eb7b0.md` §4 的拨钟配置。**T0 就是在窗口内（迪拜 00:57–01:20）采的**，所以该文同时给了两组数。
2. 窗口缺陷在测试夹具（`CUTOFF.toISOString().slice(0, 10)` 用 UTC 日、产品用迪拜业务日），T0 只量不改，**未登记** `TOOLING-DEBT.md`，交控制者定。（T11 已按裁定 R9 登记，见 `TOOLING-DEBT.md`。）
3. 私库 `db:biz:init` 恒 exit 1 仍在（已知债，非本任务）；7 个私库每轮重铺。

## 4. 后续任务

（T1 起在此追加：任务号 / 文件 / 命令 + 退出码 + 关键行。）

- **T1 科目码 2 / 51、开户、投影、天平**：`t1-account-codes-2-51-evidence.md`——TDD 红 / 绿与两组失效验证、闸门退出码、重铺后 81 户 → demo:all 后 **105** 户、`verify:coa` 前后、造不平一笔看天平变红再还原、天平硬编码清单（三处，全改）、一次 FDO 撞号偶发红的如实记录。
- **T2 转账码 88–91 + 应收 LP 接线**：`t2-transfer-codes-88-91-lp-receivable-evidence.md`——单测与 e2e 的红 / 绿（e2e 红 = 把 workflow 临时还原成改前版）、闸门退出码、种子四腿（84→88→85→86）期末 51 = 0 的 TB 只读查询、e2e 里 51 / 200 / F_OPS / F_LIQ 的 TB 余额前后表、`GET /admin/tb/accounts?ownerType=LP&code=51` 返回 `ownerName`。
- **T11 种子 / 剧本 / 基线 / 文档事实句 + 三场景走查**：`t11-docs-and-walks-evidence.md`——每个改动的文档节与来源、每个数字的命令 + 退出码、场景 16 / 31 / 41（另补走 8 与 26 一段）的真实渲染走查步骤与 `t11-scene-*` 截图清单、剧本里与 brief 不一致处（#18 的裁决人是高管不是 CFO）、读面小问题与未覆盖项。
- **T4 付款单 from 钱包可选**：`t4-vendor-payment-from-wallet-evidence.md`（+ `t4-*.png` 4 张）。
- **T5 公司调拨单后端**：`t5-house-transfer-evidence.md`。
- **T6 公司调拨单管理台**：`t6-house-transfer-admin-evidence.md`（+ `t6-*.png` 8 张）。
- **T7a / T7b 认损补缺一张单（后端 / e2e）**：`t7a-shortfall-topup-evidence.md`、`t7b-shortfall-topup-e2e-evidence.md`。
- **T8 认损补缺管理台与事故页**：`t8-shortfall-admin-evidence.md`（+ `t8-*.png` 12 张）。
- **T9a / T9b 对内差额与第 0 轮锚配对**：`t9a-internal-delta-evidence.md`、`t9b-anchor-pairing-evidence.md`。
- **T10 读面汇总**：`t10-read-surface-evidence.md`（+ `t10-*.png` 14 张）。
- **T12 收尾**：见下 §5。

## 5. T12 收尾闸与证据（2026-11-07，代码头 `8b40965d`，self 栈 3110–3113）

> 所有命令在 worktree 根跑，前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`；要退出码的命令一律重定向到文件再取 `$?`，不接管道。收尾时钟：开跑前 `date -u` = 05:48 UTC（迪拜 09:48），全部收尾闸在 UTC 20:00–24:00 窗口之外，**没用拨钟配置**。

### 5.1 闸门表（命令 / 退出码 / 关键行）

| 闸 | 命令 | 退出码 | 关键行 |
|---|---|---|---|
| ① 后端 tsc | `npx tsc --noEmit -p tsconfig.json` | **0** | 无输出 |
| ② 管理台 tsc | `cd admin-web && npx tsc -b --noEmit` | **0** | 无输出 |
| ③ 客户端 tsc | `cd client-web && npx tsc -b --noEmit` | **0** | 无输出 |
| ④ 全量 jest | `npx jest`（仓库根，**不接管道**，输出进文件） | **0** | `Test Suites: 288 passed, 288 total`；`Tests: 2 skipped, 5 todo, 4862 passed, 4869 total`；`Time: 36.877 s`（波一终态 275 套 / 4592 过） |
| ⑧ 重铺 | `bash scripts/stack.sh reset self` → `up` | 0 / 0 | 等 `customer_monthly_statements`=55 再往下 |
| ⑥ demo:all | `bash scripts/on-stack.sh self demo:all` | **0** | `花名册：35/35 符合预期`；`asserts: 5/5 PASS`；COA 四恒等 34107565 / 94870335 / 8201620811 / 114035428189（式子已含 CLIENT_SHORTFALL / LP_RECEIVABLE）；`demo:all DONE ✅`。本次两次 `demo:all`（这一次与收尾留栈那一次）都没出已知偶发（FDO 撞号 / #35 `travelRuleSnapshotJson` 空） |
| 客户侧快照 | `… self client:snapshot -- --out …/client-snapshot-after.json` → `diff before after` | 0 / **0** | `diff` **0 行**；同日重铺（`261107`），R10 的日期段归一化用不上；快照内 `"error"` 键 0 个、STM 号 55 个、订单号遮罩 58 处、13 位客户 |
| ⑦ verify:coa（recon 前） | `… self verify:coa`；取数：`grep -oE "[0-9]+ 个科目全部 ≥ 0"` | **0** | `ALL INVARIANTS PASS`；**105 个科目全部 ≥ 0**；四恒等同上 |
| recon pass | `… self recon:demo:pass` | **0** | `status=PASS walletsChecked=21 casesOpened=0`；orphan / mismatch 全 0 |
| recon break | `RECON_DEMO_MANIFEST_PATH=<scratch> … self recon:demo:break` | **0** | `scenarios: 18/18 DETECTED`、`wallets: 12/12 bucket OK`、`casesOpened 12/12`、恒等①② OK |
| ⑦ verify:coa（break 后） | 同上 | **0** | `ALL INVARIANTS PASS`；CLIENT AED 恒等 34307565（比 recon 前多 200000 最小单位，`recon:demo:break` 场景 6 会真往一位客户记账，同波一）；**105 个科目全部 ≥ 0** |
| 计数终态 | 见 §5.2 | 0 | 全部 = 预期 |
| LP 真批准（T1 minor） | 见 §5.3 | 0 | 注册表码 51：4 → **6** |
| 转账码抽核 | 见 §5.4 | 0 | 327 次比对 0 处不符 |
| 全量 e2e | 见 `e2e-after-8b40965d.md` | 1（预期） | 24 红名 = B 集 22 + 2 偶发（单跑绿） |
| 收尾留栈 | `reset self` → `up` → `demo:all` → `verify:coa` | 0 / 0 / **0** / **0** | 35/35、5/5、105 个科目 ≥ 0；`doc-final/demo/data.md` 生成区无 diff |
| `test:client`（vitest） | 不需要 | — | `git diff --stat 5ff65ef5..HEAD -- client-web` 输出为空（波二没动 client-web）|
| `stack-env.test.sh` | 不需要 | — | `git diff --stat 5ff65ef5..HEAD -- scripts/stack.sh scripts/stack-common.sh scripts/on-stack.sh` 输出为空 |

**没做失效验证的闸**：①②③ 与全量 jest 是既有闸，本任务只跑、没有重做变异；`client:snapshot` 的剥离 / 遮罩 / diff 三项失效验证沿用波一 `client-snapshot-control.md`（本波没改 `scripts/client-side-snapshot.ts`）。**做了失效验证的**：转账码抽核脚本——把脚本副本里 85 的期望贷方改成 200、91 的借贷对调换后重跑，退出码 1 并列出 `MISMATCH 85 …`（A 1 行、B 2 行）与 `MISMATCH 91 …`（B 4 行）共 7 行；计数命令 C2 / C4 的失效验证见 `counts-before.md` 末节（T0 做的，本任务原样重跑）。

> 两条 `git diff --stat` 在 HEAD 上实测输出为空（命令见 §5.10）。

### 5.2 计数终态：改前 → 改后（逐项同 T0 命令重跑；`demo:all` 后的科目数在全量 e2e **之前**取）

C1–C5 就是 `counts-before.md` 里五段 `node - <<'JS'` 原文（从该文件机械抽出，经 stdin 喂给 `node -`，因为 `require('ts-node')` 要从仓库根解析），退出码全 0。

| 项 | 命令 | 改前（T0） | 预期（spec §6） | **测得** | 一致 |
|---|---|---|---|---|---|
| 审批策略 `DEFAULT_APPROVAL_POLICIES` | C1 | 55 | **56** | **56** | 是 |
| `MAKER_GROUP_BY_POLICY` / 豁免 | C2 | 54 / 1 | 55 / 1 | **55 / 1**；两表并集 56 = 策略全集，双向差集为空 | 是 |
| （附）`MAKER_CHECKER_OVERLAP_EXEMPT` / `S5_KNOWN_DEADLOCKS` | C2 | 7 / 0 | — | 7 / 0 | 仅记录 |
| S9 表 / 管理台路由表 | C3 | 45 / 45 | **46** | **46 / 46**，键集双向差集为空，S9 键 ⊆ 策略全集 | 是 |
| 审计现役码 / 名册 | C4 | 378 / 18 | **386 / 19** | **386 / 19**（distinct 386）；`V7_TREASURY` 7 → 8，新名册 `CAMPAIGN_E_HOUSE_TRANSFER` 7；spec `REGISTRIES` 与 `*_AUDIT_ACTIONS` 导出双向差集为空；退役词表仍 123 | 是 |
| TB 科目码 | C5 | 11 | **13** | **13**（1,50,2,51,100,101,200,210,211,212,300,301,302） | 是 |
| TB 转账码个数 / 最大 | C5 | 37 / 87 | 41 / **91** | **41 / 91**（值互异 41） | 是 |
| 演示库科目数（`verify:coa`，`demo:all` 后；重铺后、`demo:all` 前为 81——T1 实测，T12 未重量） | C6 | 87 | **105** | **105**（recon 前、break 后两次都是） | 是 |
| 注册表分布（`demo:all` 后） | `sqlite3 … "select code,count(*) from tb_account_registry group by code"` | — | 码 2 = 14（客户钱包）、码 51 = 4（Falcon / Dune × AED / USDT） | 1:14 · 2:14 · 50:7 · 51:4 · 100:26 · 101:26 · 200:2 · 210:2 · 211:2 · 212:2 · 300:2 · 301:2 · 302:2 = 105 | 是 |
| 业务号前缀 `HTR` | `rg "generateReferenceNo\('HTR'" src`（另 `grep -rn … \| wc -l`） | — | 恰 1 处 | **1**（`house-transfer.service.ts`）；两种搜法一致 | 是 |
| 动作桶（`rbac.catalog.ts` 中 `key: 'x.y'` 行数；`ACTION_BUCKET_CATALOG` 15 组） | `grep -cE "^\s*key: '[a-z_]+\.[a-z_]+'"` 对 `0c6eb7b0:` 与 HEAD | 34 | +2 | **36** | 是 |
| 码 2 流水 `walletRef` | `sqlite3`：`account_flows` ⨝ `tb_account_registry` 取 `code=2` | — | 全 NULL | **`demo:all` 后 0 行（空真，种子不造补缺单）**；**全量 e2e 后 8 行、8 行全 NULL**（同口径对码 1：`demo:all` 后 64 行、0 行 NULL，即码 1 流水都带 `walletRef`） | 是 |

⚠️ 科目数 105 取在全量 e2e 之前：e2e 夹具会开账户（`lp-receivable` 每跑一次开 2 个码 51 户，造客户钱包的夹具经 `ensureForWallet` 各开 1 + 2），全量跑完后注册表是 278 个户，不是 105；那是 e2e 的副作用，不是产品口径。

### 5.3 T1 遗留项：真 LP 批准开两个码 51 户

T1 的 minor（单测 + 开机覆盖了 `ensureForLp`，没有在栈上走过真批准）。T12 在 self 栈用**真 HTTP**走了一遍（脚本入库为 `t12-lp-approve-walk.js`，退出码 0，输出里有“前 / 后 / 新 LP 的 51 户数”三行）：`treasury@` `POST /admin/lp-profiles`（`LPP261107431103`，`PENDING_ASSESSMENT`）→ `compliance_lead@` `POST …/assessment/screening-records`（COMPANY、六张名单、GREEN）→ `PATCH …/assessment`（LOW）→ `POST …/assessment/conclude`（`SENT_FOR_APPROVAL`，开出 `APR261107939269`）→ `cfo@` `POST /admin/control-gates/approvals/APR261107939269/approve` → 档案 `ACTIVE`。

- 前：`select … from tb_account_registry where ownerType='LP' and code=51` = **4 行**（Falcon、Dune 各 L1 / L2）。
- 后：**6 行**，新增 `LPP261107431103 / L1`、`/ L2`，户名 `Due from LP · T12 Walk Capital Ltd`。
- TigerBeetle 侧 `lookupAccounts` 查到这两个户：`code 51`，ledger 1 / 2，`flags 4`（`credits_must_not_exceed_debits`），`debits_posted = credits_posted = 0`。
- 只走了「审批批准」这一条边；「金库复活 `reactivate`」那条边没有单独走（种子 LP 的户已存在，复活走 `ensureForLp` 的“已存在直接返回”分支，不会开新户）。

### 5.4 转账码抽核表

`evidence-by-transfer-code.md`（由 `a4-table.js` 离线重生成，退出码 0）。取法同波一：evidence 每行的 `tbTransferId` 拿去 TigerBeetle `lookup_transfers`，读真实落账的 `code` 与借 / 贷账户自己的 `code`，**不信 evidence 自述**。两次取样：**A** = 重铺 → `demo:all` → `recon:demo:pass` / `break` → `verify:coa` → LP 走查之后（107 行）；**B** = 干净重铺 + 7 私库 + `demo:setup` 后的整套串行 e2e 之后（258 行，含 `lp-receivable` / `house-transfer` / `recon-internal-transfer` / `vendor-payment-from-wallet` 等的产物）。

- 365 行 = 产品 289 + e2e 夹具 76（单列、不计）+ 无 TB 转账 0；产品行 **327 次比对：借贷对 327/327、钱包角色 59/59、阶段转账 38/38，0 处不符、0 个 UNEXPECTED**；TB 里 post / void 转账共 98 笔，存的 code 全 = 其 pending 的 code（R34）。
- 本波新码与改写：**88**（借 51·该 LP / 贷 200，3/3）｜**89**（借 50·to / 贷 50·from，运营 ⇄ 手续费，6/6）｜**90** 三 eventCode 各一行：`FEE_INCOME_CLOSE_SWAP` 借 210（4/4）、`…_WITHDRAW` 借 211（3/3）、`…_OTHER` 借 212（2/2），均贷 200｜**91**（借 2 / 贷 1，4/4 产品行）｜**83** 两形态：`INTERNAL_TRANSFER_SHORTFALL_TOPUP_IN` 借 1 / 贷 **2**（3/3）；`INTERNAL_TRANSFER_ADVANCE_IN`（借 1 / 贷 100）**无 live 行**（垫款入口置灰，本波不动）｜**85** 新贷方 **51**（借 50·Company Liquidity，3/3）。
- 抽核工具相对波一的改动只有：科目助记表加 2 / 51；期望表加 88–91、改 85 贷方为 51；83、90 按 `eventCode` 分形态判并各取一个样本；87 与 81 的出钱钱包角色放宽为「运营或手续费」（付款单 from 可选、认损补缺 from 可选）。首次生成曾因 `81` 的贷方角色仍按波一写「运营户」而报 1 处不符——该行是认损补缺单（`ITR261107421200`，`fromVault = F_FEE`，e2e P2 用例），是 spec 新增的合法形态，已改期望，不是产品错账。

### 5.5 e2e

详见 `e2e-after-8b40965d.md`。要点：全量冷缓存串行 `10 failed, 21 passed, 31 total` / `24 failed, 173 passed, 197 total`，**失败名 = B 集 22 名 ∪ {`customer-restrictions` ⑤, `vendor-onboarding` ①}**；两个多出名字干净重铺**单跑**：⑤ 绿（同跑 ② ⑥ 红 = B 集）、① 绿 ⇒ 偶发；4 个新 e2e 文件全绿；卡单污染探针（先 `house-transfer`、再跑全部 recon 套件）：7 个红名 = B 集 recon 组逐名一致。

### 5.6 客户侧快照

`client-snapshot.diff` **0 行**（`diff` 退出码 0）。R42：`demo:all` 不造补缺单，所以「Alice 少两行」的对比在这份快照上不适用，预期差异为空——结果即空。「客户端零行」的正面证据另有两处：T7b e2e A（认损补缺全弧里 `100` 应付流水不变）与 T11 场景 16 走查（`t11-scene-16-13-client-alice-usdt.png`、`t11-scene-16-14-voucher-91-82-83.png`）。

### 5.7 截图索引（88 张，`t*.png`；由各任务产出并在任务内查看，T12 没有重新逐张审看）

- **T4 付款单 Pay From（4）**：`t4-vendor-payment-detail-from.png`、`t4-vendor-payment-from-default.png`、`t4-vendor-payment-from.png`、`t4-vendor-payment-ui-submitted.png`。
- **T6 公司调拨单（8）**——列表（各态）/ 建单弹层 / 详情（整扫含结转、运营→手续费无结转、卡单 Stuck）/ 资金单页腿：`t6-funds-order-leg.png`、`t6-house-transfer-create.png`、`t6-house-transfer-detail-no-income.png`、`t6-house-transfer-detail-ops-to-fee.png`、`t6-house-transfer-detail-stuck.png`、`t6-house-transfer-detail.png`、`t6-house-transfer-list-states.png`、`t6-house-transfer-list.png`。
- **T8 认损补缺管理台与事故页（12）**——案件页菜单 / 弹层 / 提交挂起 / 补款中 / Explained / 失败标签、调拨单（认损补缺）列表与详情、事故页入口 / 弹层 / 无锚不出现：`t8-incident-entry-unanchored.png`、`t8-incident-entry.png`、`t8-incident-modal.png`、`t8-shortfall-explained.png`、`t8-shortfall-failed.png`、`t8-shortfall-menu.png`、`t8-shortfall-modal.png`、`t8-shortfall-pending.png`、`t8-shortfall-submitted.png`、`t8-shortfall-topping.png`、`t8-transfer-detail.png`、`t8-transfer-list.png`。
- **T10 读面汇总（14）**——案件页 INVARIANT 行与 Explained 三态 / 自愈、案件列表 INVARIANT 计数、看板 Due from LP 与交货后、账本科目页 Owner = LP 与码过滤项、跑批详情对内列、凭证页 88–91：`t10-case-customer-balance-row.png`、`t10-case-explained-before-reheal.png`、`t10-case-explained-topping-up.png`、`t10-case-healed-after-topup.png`、`t10-case-invariant-healed.png`、`t10-case-invariant-row.png`、`t10-case-list-invariant-count.png`、`t10-dashboard-due-from-lp-delivered.png`、`t10-dashboard-due-from-lp.png`、`t10-ledger-accounts-code-filter-options.png`、`t10-ledger-accounts-owner-lp.png`、`t10-run-detail-internal-check.png`、`t10-transfer-evidence-88-91.png`、`t10-transfer-evidence-coa-filter-options.png`。
- **T11 三场景走查（50）**：
  - 场景 16（Alice USDT，认损补缺账龄路，14）：`t11-scene-16-1-case-before.png`、`t11-scene-16-10-leg-before-push.png`、`t11-scene-16-11-explained-before-reheal.png`、`t11-scene-16-12-healed.png`、`t11-scene-16-13-client-alice-usdt.png`、`t11-scene-16-14-voucher-91-82-83.png`、`t11-scene-16-2-hold-modal.png`、`t11-scene-16-3-held.png`、`t11-scene-16-4-menu-overdue.png`、`t11-scene-16-5-modal.png`、`t11-scene-16-6-submitted.png`、`t11-scene-16-7-pending.png`、`t11-scene-16-8-cfo-approval.png`、`t11-scene-16-9-topping-up.png`
  - 场景 31（Bob，事故路含 sm@ 拒 #18 与 NLA 红线，19）：`t11-scene-31-1-case-before.png`、`t11-scene-31-10-submitted.png`、`t11-scene-31-11-cfo-approval.png`、`t11-scene-31-12-leg1-before-push.png`、`t11-scene-31-13-leg2-before-push.png`、`t11-scene-31-14-explained-before-reheal.png`、`t11-scene-31-15-healed.png`、`t11-scene-31-16-incident-after-topup.png`、`t11-scene-31-17-incident-linked.png`、`t11-scene-31-18-dashboard-nla-breach.png`、`t11-scene-31-19-client-bob-aed.png`、`t11-scene-31-2-register-incident-modal.png`、`t11-scene-31-3-incident-form.png`、`t11-scene-31-4-assessment.png`、`t11-scene-31-5-assessed.png`、`t11-scene-31-6-topup-modal-from-incident.png`、`t11-scene-31-7-refused-outflow-lock.png`、`t11-scene-31-8-sm-reject-18.png`、`t11-scene-31-9-sm-rejected-18.png`
  - 场景 41（AED 扫费，8）：`t11-scene-41-0-dashboard-before.png`、`t11-scene-41-1-create-modal.png`、`t11-scene-41-2-pending.png`、`t11-scene-41-3-cfo-approval.png`、`t11-scene-41-4-leg-before-push.png`、`t11-scene-41-5-detail-89-90.png`、`t11-scene-41-6-voucher-list.png`、`t11-scene-41-7-dashboard-after.png`
  - 场景 8 补走（Jack ↔ Kate 改记，3）：`t11-scene-08-1-jack-before-reconcile.png`、`t11-scene-08-2-jack-after-reconcile.png`、`t11-scene-08-3-kate-after-reconcile.png`
  - 场景 26 补走（看板 Due from LP，2）：`t11-scene-26-1-dashboard-due-from-lp.png`、`t11-scene-26-2-dashboard-after-delivery.png`
  - R41 读面订正后重截（4）：`t11-fix-26-dashboard-subtitle.png`、`t11-fix-8-1-jack-pending.png`、`t11-fix-8-2-jack-posted-before-reconcile.png`、`t11-fix-8-3-kate-after-reconcile.png`

T12 自己**没有新截图**：T12 没改任何前端；渲染证据全在各任务名下。

### 5.8 观察到的偶发 / 噪音 / 已知债（逐条如实）

1. `customer-restrictions` ⑤——全量里红过 1 次（`SWAP_FROZEN` 审计行 0 条），单跑绿；新见，已登记 `TOOLING-DEBT.md`，归因是推断。
2. `vendor-onboarding` ①——全量里红过 1 次（`VENDOR_ACTIVATED` 审计晚于状态），单跑绿；T0 / 波一都记过的老偶发。
3. `demo:all` 已知罕见偶发（`FDO` 参考号撞号、#35 `travelRuleSnapshotJson` 空）：本次两次 `demo:all` **均未出现**，所以没有可记录的出现；T1 / T5 的出现见各自证据。
4. `demo:all` 日志里有 55 行 `[NotificationsService] emitCustomerUpdated failed … Cannot read properties of null (reading 'to')`：脚本进程里没有起 socket 网关，`this.server` 为空；`src/core/notifications/notifications.service.spec.ts` 专门有用例构造这个 TypeError 并断言它被吞掉，属预期噪音，`demo:all` 退出码不受影响（没有拿它和 T0 的 `demo:all` 日志逐行比，T0 没留日志）。
5. 7 个私库 `db:biz:init` 恒 exit 1（`TOOLING-DEBT.md` 私库条，与 T0 一致）。
6. `client:snapshot` 输出 `MaxListenersExceededWarning`（既有的监听器上限噪音，不影响快照）。
7. `audit:vocab` exit 1（29 码缺描述 = 本波 8 + 既有 21）：未在 T12 重跑，沿用 T11 的实测与 R40（描述来自业主维护的 lark 种子，agent 不读不填）。

### 5.9 没覆盖 / 边界

- e2e 全量只一遍 + 两次单跑 + 一次卡单探针；没有三轮取多数，偶发频率没量化。
- `recon-adjustment` 用例 9 与基线只对到名字，没对到失败签名（T0 文档没记）。
- 转账码抽核覆盖「A、B 两次取样里出现过的行」：`18 / 19 / 20 / 21` 四个码两次取样都没有产品行（与波一同类，不是本波新增缺口）；`83 CLIENT_ADVANCE` 无 live 行。
- 「金库复活」那条 LP →ACTIVE 边没单独走（§5.3）。
- 否定性结论的搜索边界：「`83 CLIENT_ADVANCE` 无 live 行」= 在 A、B 两份 evidence（`tb_transfer_evidence`）里按 `eventCode` 分组没有 `INTERNAL_TRANSFER_ADVANCE_IN`，不覆盖别的库；「`HTR` 恰 1 处」= 在 `src` 内用 `rg` 与 `grep -rn` 两种搜法，不覆盖 `scripts/`、`prisma/`、`test/`。

### 5.10 复现命令（可粘贴；关键几条）

```bash
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
git diff --stat 5ff65ef5..HEAD -- client-web scripts/stack.sh scripts/stack-common.sh scripts/on-stack.sh   # 空输出 = 两个条件闸免跑
npx jest > /tmp/jest-full.log 2>&1; echo $?                                    # 0
bash scripts/stack.sh reset self && bash scripts/stack.sh up
bash scripts/on-stack.sh self demo:all > /tmp/demo-all.log 2>&1; echo $?       # 0
bash scripts/on-stack.sh self verify:coa > /tmp/coa.log 2>&1; echo $?          # 0；grep -oE "[0-9]+ 个科目全部 ≥ 0" /tmp/coa.log → 105 个科目全部 ≥ 0
node doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/a4-evidence.js <dev.db> 127.0.0.1:3113 <out.json>
node doc-final/superpowers/checkups/2026-11-07-campaign-e-wave2-evidence/a4-table.js <out.md> A=<outA.json> B=<outB.json>
```
