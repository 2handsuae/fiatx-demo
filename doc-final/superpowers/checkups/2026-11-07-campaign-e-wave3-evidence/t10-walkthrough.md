# T10 走查记录 · 剧本与基线按新 NLA 口径重钉

栈 = `self`（API 3120 / 管理台 3121 / 客户端 3122 / TB 3123），本机时间 2026-11-08 00:4x–00:5x（迪拜）。每条命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`。

**走查方式（如实）**：业务动作全部经**管理台同一批 HTTP 端点**驱动（Node `fetch`，各角色登录：treasury / cfo / sm / mlro / compliance_lead，不是点按钮），随后用 `scripts/demo-shot.js` 的草稿副本（`networkidle2` 换 `domcontentloaded`）无头渲染管理台页面截图，每张 PNG 都 Read 过。真点击只有场景 29 的 Initiate 弹层（`--click "Initiate payment"`）一张。剧本其余未列场景（第一至第五幕、第七幕、第八幕大部、场景 8 / 26–28 / 30 / 33–40）**本任务没有重走**——它们的行为本波未变，只在剧本里换数字或看板格名（见下方「文档改动」）。

## 1. NLA 两次取数（口径一 / 口径二）

| 时点 | 命令 | NLA（分） | 备注 |
|---|---|---|---|
| 口径一 | `bash scripts/stack.sh reset self`（exit 0）→ `bash scripts/stack.sh up`（exit 0）→ treasury 登录 `GET /admin/prudential/status` | **136,469,600**（headroom 16,469,600，`breached=false`） | 与 spec 估计一致；`t10-nla-k1.json` |
| 口径二 | `bash scripts/on-stack.sh self demo:all`（exit 0，`asserts: 5/5 PASS`）→ 同一接口 | **136,499,846**（headroom 16,499,846） | 与 Task 1 一致；运营户 AED 94,608,935 + 手续费户 AED 11,400 + 运营户 USDT 折 41,866,290 + 手续费户 USDT 折 13,221；旧口径 136,475,225；`t10-nla-k2.json` |

## 2. 走查顺序与 R37 处理

1. reset → up → `demo:all`（口径二）→ **`recon:demo:crisis`（exit 0，1 案 `REC20261108-001`、失窃 250,000.00 AED）** → 场景 31 → 场景 32 → 场景 29（两种 Pay From）→ 场景 41 → 场景 37 真 LP 批准。**场景 31 的认损补缺是带锚处置，之后命令行 `recon:demo:*` 会被拒——所以需要 crisis / break 的场景都排在它之前，或重铺后再演。**
2. 再 `reset → up → demo:all → recon:demo:break`（exit 0，18/18、12/12、casesOpened 12/12）→ 场景 18（Jack USDT 案）→ 场景 16（Alice USDT 案，挂起 → ⚡ 拨账龄 → 超期 → 认损补缺）。
3. 此刻库里有两张已记短缺的认损补缺单：连跑 `recon:demo:break` / `crisis` / `pass` **三种都 exit 1**，末行 `Cannot re-stage the reconciliation scenarios: ITR261108064412, ITR261108240869 are posted and anchored … Use "Reset all demo data…" (full reseed, about 1 minute) instead.`（`t10-r37-{break,crisis,pass}.txt`）——R37 前置闸在本栈实测成立。
4. 最后 `reset → up → demo:all` 留标准栈（见 §4）。

## 3. 逐场景表

| 场景 | 做了什么（UI / API / CLI） | 观察到的 | 截图 | NLA |
|---|---|---|---|---|
| 31 ①②（造数 + 案件页） | CLI `recon:demo:crisis`；API 取案件 | crisis 只动外部账单，NLA 不变 `breached=false`；案件 `REC20261108-001`，差额 −250,000.00，Bob `CU2601017625`，钱包 `WA2601014725` | — | 136,499,846 |
| 31 ③ 定性登记 | API `POST …/cases/:caseNo/dispositions`（`INCIDENT` / `UNAUTHORIZED_OUTFLOW`，需 `externalDirection=OUT`、`deltaSign=-1`） | `RCD261108722614`，出口 Register incident | — | — |
| 31 ④⑤ 事故 | API 登记 `INC261108640715` → 调查 → 加记录 → 定损（`FIRM_LOSS`、250000.00 AED、报送依据 `CLIENT_MONEY_DISCREPANCY`） | 事故 `ASSESSED`，联动开报送单 `FIL261108992579` | — | 不变 |
| 31 ⑥ 先拒在途提现 | API treasury 试开认损补缺单 | **400 `CLIENT_WALLET_PAYOUTS_IN_FLIGHT`**：「…has only 12200.00 AED of cash free of in-flight payouts, but the custody shortfall to recognize is 250000.00 AED — first handle this wallet's in-flight payouts…」；sm 拒 `APR261108385523`（#18 大额提现 `WDR261108257654` → `REJECTED`） | — | 不变 |
| 31 ⑦ 认损补缺 | API treasury 提单 `ITR261108804982`（审批 `APR261108735999`）→ cfo 批 | 提交即挂；**提交后 NLA 仍是 136,499,846（不过门；批准那一刻未单独取数，腿清算前资金没动）** | — | 136,499,846 |
| 31 ⑧ 推两腿 | API `advance` SUBMIT → CONFIRM ×2（`FDO261108514662`、`FDO261108086412`） | 两腿 `CLEARED`，划转单 `SUCCESS`；案件页「Explained · ITR…」但 Hero 仍写全额未解释 | `t10-scene-31-6-explained-before-reheal.png` | **111,499,846**（**破线**） |
| 31 ⑨ 重对账 + 看板 | API `POST /admin/reconciliation/runs/wallet`（`RUN20261108-2`，`casesAutoHealed 1`） | 案子 `RESOLVED`（`AUTO_HEALED`），行「Matched · Explained · ITR…」；看板红横幅「NLA below regulatory floor — shortfall AED 85,001.54…」，NLA 1,114,998.46 / Floor 1,200,000.00 / Headroom −85,001.54；Operations AED 696,089.35 转红；NLA 区三小格 + 脚注「Not counted…」；Company wallets 总表；`breached=true` | `t10-scene-31-7-healed.png`、`t10-scene-31-8-dashboard-nla-breach.png`、JSON `t10-nla-scene31-breach.json` | **111,499,846 = 1,114,998.46；缺口 8,500,154 分 = 85,001.54** |
| 32 ① 巡检红 | **修复轮重走**：reset → demo:all → crisis → 场景 31 全套（同上）到认损补缺落账；UI 点「Run prudential check」 | 红卡「NLA_BREACH — shortfall AED 85,001.54…」；本轮 NLA 111,499,846，与首轮逐位相同（`t10-nla-scene31-breach.json` 已用本轮值覆盖，值不变） | `t10-scene-32-check-red.png` | 111,499,846 |
| 32 ② 门的证明 | API treasury 开付款单（HexTrust）Pay From **手续费户** 10.00 AED（跌破窗口内） | **400**「Blocked by prudential floor (Company Rulebook VI.C): … NLA now 1114998.46 AED, after 1114988.46 AED, floor 1200000.00 AED.」——手续费户路径的门拦截现场触发（首轮曾只做代码读证，此条取代它）；运营户 5,000.00 的拒单首轮已实测（NLA now 1114998.46 / after 1109998.46） | `t10-scene-32-fee-wallet-gate.txt` | 不变 |
| 32 ⑦ 注资 | API 注资 300,000.00 AED（`CIN261108772428`）→ cfo 批 → ⚡ simulate-contribution → confirm | 跌破窗口内发起 / 批 / 兑现全成功，`SUCCESS` | — | — |
| 32 ⑧ 复原 | UI 点「Run prudential check」+ 看板截图 | **NLA 141,499,846 = 1,414,998.46，Headroom 21,499,846 = 214,998.46**（本轮实测，与首轮及 baseline / script / BACKLOG 所引一致，无需改值）；绿卡「NLA_OK — NLA AED 1,414,998.46, Floor AED 1,200,000.00, Headroom AED 214,998.46. Logged to audit trail.」；运营户 AED 996,089.35 | `t10-scene-32-check-green.png`、`t10-scene-32-dashboard-recovered.png`；JSON `t10-nla-scene32-recovered.json`（本轮：141,499,846，`breached=false`） | **141,499,846** |
| 32 ③–⑥ ⑨–⑪ | **未重走**（审慎事故登记、两张报送单、两起事故结案）——不受 NLA 口径影响，只换数字 | — | — | — |
| 29 Pay From | API 两张付款单：运营户 3,200.00 AED（`PAY261108718062`）、手续费户 14.00 AED（`PAY261108126413`）；各自 cfo 批 → 推腿 SUBMIT/CONFIRM | 两种都真实过门（创建成功）、批准前后 NLA 不变、清算后 `SUCCESS` 才扣；NLA 141,499,846 → 141,179,846（−3,200.00）→ 141,178,446（−14.00） | `t10-scene-29-1-vendor-payments-list.png`、`t10-scene-29-2-initiate-pay-from.png`（真点击：Initiate 弹层，含 **Pay From** 下拉与说明「Paying from the fee wallet uses collected fees and leaves the operating balance untouched.」） | 见左 |
| 41 扫费 | API 反向探针：运营户 → 手续费户 5.00 AED 调拨单（创建成功，无门，随后 cancel）；正向：手续费户 → 运营户 100.00 AED（`HTR261108108303`）→ cfo 批 → 推腿 | 调拨单 `SUCCESS`；详情页「Ledger postings」：Move cash (89) 100.00 + Close fee income to equity (90) 三笔 20.00 / 52.00 / 28.00，Σ 100.00 | `t10-scene-41-2-house-transfer-detail.png`、`t10-scene-41-1-dashboard-after-sweep.png`（看板：NLA 1,411,784.46，Fees AED 0.00 | USDT 36.000000） | **前后均 141,178,446——调拨单不改 NLA** |
| 37 真 LP 批准 | 改写 wave 2 的 `t12-lp-approve-walk.js`：treasury 申请 `LPP261108473192` → compliance_lead 筛查 / 评估 / 送审 → cfo 批 | LP `ACTIVE`；`tb_account_registry` 码 51 行 4 → **6**（新 LP 的 L1 + L2 两户） | `t10-scene-37-1-lp-active.png` | — |
| 18 | API（reset → break 之后）：Jack USDT 案 `REC20261108-009` 定性 → 事故 `INC261108039104`（调查 / 升级 MLRO / 定损 `FIRM_LOSS` 400 USDT、依据 `CLIENT_VA_DISCREPANCY`）→ 认损补缺 `ITR261108064412` → cfo 批 → 币腿 SUBMIT/OBSERVE_CONFIRMING/CONFIRM → 重对账 → 报送单 `FIL261108308070` 起草 / 送签 / sm 批 / 标已提交 → 挂 TRANSFER → treasury 提结案 → mlro、cfo 两步批 | 案子 `RESOLVED`，行「Explained · ITR…」；事故 `CLOSED`；未被在途出款拦（Jack 钱包无在途） | `t10-scene-18-1-incident-closed.png`、`t10-scene-18-2-case-healed.png` | 随认损补缺降 146,900 分（400 USDT × 3.6725），不过门 |
| 16 | API：Alice USDT 案 `REC20261108-003` 挂起（`HOLD_INVESTIGATING` / `UNEXPLAINED`）→ ⚡ simulate-aging-timeout → 等下一轮扫描（第 3 次轮询、约半分钟后出现）→ 行出现 `SHORTFALL_TOPUP` → 认损补缺 `ITR261108240869` 7.5 USDT → cfo 批 → 币腿三步 → 重对账 | 案子 `RESOLVED`；超期帧「Overdue · eligible to recognize loss」；愈合帧「Explained · ITR…」 | `t10-scene-16-1-overdue-eligible.png`、`t10-scene-16-2-healed.png` | 再降 2,755 分；两笔后 136,350,191 |
| R37 | CLI 三种 `recon:demo:*` | 全 exit 1，拒绝文案原样 | `t10-r37-*.txt` | — |


### 第一至第五幕、第七幕：每幕一张关键截图（修复轮，R16）

**不逐步重走**；状态由 `demo:all` 产出（花名册 35/35、asserts 5/5，修复轮末次 reset → up → demo:all 后截图）；本波在这些路径上不改代码；页面在当前构建上正常渲染。

| 幕 | 页面（账号） | 观察 | 截图 |
|---|---|---|---|
| 一 开业 | Swap Fee Levels（admin） | 4 档费率 ACTIVE（STD / VIP / NEWCUST） | `t10-act-1-swap-fee-levels.png` |
| 二 迎客 | Customer Management（admin） | 13 位种子客户，状态与受限标记齐 | `t10-act-2-customers.png` |
| 三 钱进 | Deposit Transactions（treasury） | 22 笔充值，含 RETURNED / SUCCESS | `t10-act-3-deposits.png` |
| 四 钱换 | Swap Transactions（treasury） | 5 笔兑换，含 FROZEN（CUSTOMER_FROZEN） | `t10-act-4-swaps.png` |
| 五 钱出 | Withdraw Transactions（treasury） | 9 笔提现，含 PENDING APPROVAL / FROZEN / AWAITING CUSTOMER | `t10-act-5-withdrawals.png` |
| 七 事后说得清 | Audit Logs（admin） | 5,417 条审计，最新为提现链各动作 | `t10-act-7-audit-logs.png` |

## 4. 终态

`reset self → up → demo:all` 后：见任务报告（`data.md` 生成区零 diff 检查与终态 NLA 取数）。

## 5. 缺口（如实）

- （修复轮已补）场景 32 红 / 绿卡与复原看板截图、手续费户门拦截实测。
- 场景 31 / 32 / 41 / 29 / 16 / 18 的动作是 API 驱动，不是浏览器真点击；页面渲染由截图验证。
- 场景 8 与第六幕其余带锚处置、场景 26–28、30、36、38–40 未重走。
