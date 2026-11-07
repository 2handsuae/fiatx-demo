# T11 证据 · 种子 / 剧本 / 基线 / 文档事实句 + 三场景走查

基底 `3889b99a`（T10 修复轮）。栈 = `self`（API 3110 / 管理台 3111 / 客户端 3112 / TB 3113）。每条命令前置 `export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"`。本任务只改文档 + 证据，**未碰代码**。截图器 = `scripts/demo-shot.js`（走查时在 scratchpad 里用了一份加了 `--eval` 步的副本，专为点不中的单选 / 多选框；仓库里的脚本未动）。

## 1. 改了哪些文档、为什么（逐节）

| 文件 | 节 | 改了什么 | 来源 |
|---|---|---|---|
| `demo/script.md` | 开头 + 第九幕说明 | 提到场景 41 与 16 / 18 / 31 合并改写；第九幕「造数」补场景 41 自成一体 | spec §7 |
| | 第六幕注③ / 注⑤ | 「Recognize loss / Initiate compensation」→「Recognize loss & top up」；「认损与补款的批准 = cfo@」→ 认损补缺单批一次 | spec §7（retired 入口同步改） |
| | 第六幕注④ | 补 R37 前置闸：带锚的落账处置之后 `recon:demo:*` 与「重摆对账场景」一律拒绝，改用重铺数据；引用实测拒绝文案 | 控制器 carry R37 |
| | 场景 8 行 | 批准后重对账前后的读面：重对账前停在破口快照（Jack 行仍「Pending CFO · ADJ…」）；重对账后两边按锚配成「Matched · Explained · ADJ…」；纠正「两个案子同时 Resolved」（Kate 案还挂着场景 14 那行，整案仍 Open） | 本任务补走场景 8（§3.4）|
| | 场景 16 行 | 整行重写：一张单一次批、提交即挂、记短缺 → 腿 → Explained、**Hero 仍写未解释直到 Re-reconcile → 紧接点 Re-reconcile**、客户端零行、凭证三笔、R37 | spec §4.1 + 走查 §3.1 |
| | 场景 18 行 | 认损补缺段改写（事故页按钮 → 案件页弹层 → 批一次 → 推腿 → 重对账 → 挂 Transfer）；尾句「补款是对客户的交代」改写 | spec §4.1 事故段 |
| | 场景 26 | ③ 看板「Due from LP」格（卖出腿确认后挂上，CFO 批后仍空）；⑤ 到货后归零并转进「LP Delivery In Transit」；⑦ 加 R37 提示；判据 84/85/86 → 84 / 88 / 85 / 86 | spec §7 + 走查 §3.5 |
| | 场景 27 判据 | 码集合加 88 | T2 minor（`:493`） |
| | 场景 29 ① | 付款单加「Pay From」（默认运营户、可改手续费户、不过 NLA 门、不结转） | T4 carry |
| | 场景 31 整段 | 重写（保留 ①–⑤，改 ⑥–⑨）：**新增 ⑥ 先拒掉 #18**；⑦ 认损补缺；⑧ 推两腿；⑨ Re-reconcile + 客户端 Bob + 看板双线齐红；**删「Bob 负可用窗口」剧本纪律**；判据 / 账实证据 / 期望按新流程；单号换成本次重走的号 | spec §7 + 走查 §3.2 |
| | 场景 32 | 只改称呼与单号：事故状态 `RESOLVING` → `ASSESSED`；⑩ 挂载 Transfer 一条即可；账实证据新值（推导，已标）；账号行；判据 / 期望里「补款划转」→「认损补缺单」；造数处加单号出处说明 | spec §7（「改单号称呼」） |
| | 场景 41（新，第九幕末尾） | 扫费全弧：建单弹层 → CFO 批 → ⚡ 腿 → 详情 89 + 90 → 凭证页 → 看板 → `verify:coa` | spec §7 + 走查 §3.3 |
| `demo/data.md` | `:350` | 三句（场景 16 / 17 / 18 的划转类处置）并成一句，并带 R37 提示 | spec §7 |
| `demo/baseline.md` | `:57` | 「铺场前不得有在途划转」旁加 R37 前置闸 | R37 |
| | `:255` | `LP exchange evidence: 3 + 6` 行加「（戊波二起打印为 4 + 8）」 | T2 minor |
| | `:432` | 审计 360 → **386**（19 册），注明原 360 在波前已过时（波前实测 378）、`audit:vocab` 已 exit 1 | spec §7 |
| | `:484` | verify:rbac 现行数字订正：S4 56 / S5 55 / S5c 51 / S8 56 = 55 + 1 / S9 46 / S13d 桶 89 | spec §7（审批 55 → 56 及连带） |
| | `:534-545` | 戊波一节 `verify:coa` 科目数：reset 后 75 → 81、`demo:all` 后 87 → 105（订正一览表同步）；`:538` 对账数字不动 | spec §7 |
| | 文末新节「战役戊波二判据」 | 计数终态表、重铺与演示、对账与账本、R37、物证指针 | 控制器 + 惯例（每波一节） |
| `modules/v7-treasury.md` | 头 / §0 / §1 / §2 / §3 / §4 / §5 / §6 | 用途 `SHORTFALL_TOPUP` 与 91 / 82 / 83 分录、补款路径退役、余额闸改共用闸、出钱钱包人选、客户端零行、审计八码 | spec §7 |
| `modules/company-funds.md` | 头 / §1 看板 / §2.2 / **新 §2.3** / §3 / §4 / §5 | 调拨单六态六边、用途 `FEE_SWEEP`、from/to 限运营户与手续费户、扫费结转规则；付款单「Pay From」；看板「Due from LP」格；余额闸共用；31 场景描述与 41 | spec §7 |
| `modules/lp-desk.md` | 头 / §2.3 / §5 | 应收 LP：卖出腿确认落 88、85 改贷 51、`ensureForLp`、看板格、余额闸改调共用闸、种子四腿；`:110` 码表加 88、新科目 51 | spec §7 + T3 minor |
| `modules/v8-recon.md` | 头 / §1 / §2 / §3 / §4 / §5 | 对内差额（开案 / 结案口径）、第 0 轮锚配对取代整体排除、解析器合一、INVARIANT 行与读面、R37 闸；删「Initiate compensation」「待补款」「UNEXPLAINED_CLIENT_LOSS 调账」类句，场景 16 / 18 行改写 | spec §7 + T7a minor |
| `modules/accounting-coa.md` | 头 / §2 | 两条天平换成现行口径（客户本 Σ(1)+Σ(2)=Σ(100)+Σ(101)；公司本 Σ(50)+Σ(51)+Σ(300..302)=Σ(200)+Σ(210..212)），加码 2 / 51 两行 | spec §7 |
| `BACKLOG.md` | `:188`；M 节首条 | 手续费归集 → `[x]` 销账（戊波二）；新增「NLA 仍只算运营户…」 | spec §2 / §9 |
| `PRODUCTION-NOTES.md` | 末尾追加 4 行 | 对内不平无业务修法；短缺窗口内客户再提现 TB 拒锁；91 已落补缺腿失败不重补；89 与 90 非原子（R17） | 控制器 carry |
| `TOOLING-DEBT.md` | 末尾追加 2 条（各带复现） | ① e2e 夹具 UTC 日 vs 迪拜业务日（R9，指向 `e2e-baseline-0c6eb7b0.md` §4）；② LP e2e 夹具绕私库种子（spec 裁定 20）。T10 的 `reconciliation_dispositions` 一条已在（`:30`），**未重复** | 控制器 carry |

## 2. 数字与来源命令（本任务实测，2026-11-07，代码头 `3889b99a`）

| 数字 | 命令 | 退出 | 关键行 |
|---|---|---|---|
| 审批策略 56 / MAKER 55 + 豁免 1 / S9 = 路由表 46 / 审计 386（19 册）/ 科目码 13 / 转账码 41 个、最大 91 | `counts-before.md` C1–C5 原样重跑（从仓库根 `node - < <块>`） | 0 ×5 | `DEFAULT_APPROVAL_POLICIES 56`；`MAKER_GROUP_BY_POLICY 55`、`MAKER_GROUP_EXEMPT 1`、`union size 56`；`S9 … 46`、`ENTITY_ROUTE_BY_ACTION 46`；`total codes … 386`、`rosters … 19`；`TB_ACCOUNT_CODES count: 13`、`TB_TRANSFER_CODES count: 41 … max: 91` |
| `HTR` 前缀恰 1 处 | `rg -c "generateReferenceNo\('HTR'" src` | 0 | `…/company-funding/house-transfer.service.ts:1` |
| 科目数 reset 后 81 / `demo:all` 后 105 | `stack.sh reset self` → `up` → `on-stack.sh self verify:coa` → `demo:all` → `verify:coa` | 0 ×5 | `负余额检查 通过 (81 个科目全部 ≥ 0)`；`(105 个科目全部 ≥ 0)`；`34107565 / 94870335 / 8201620811 / 114035428189` |
| verify:rbac 186 ✓ / 1 ✗，S4 56 / S5 55 / S5c 51 / S8 56 / S9 46 / S13d 桶 89 | `bash scripts/on-stack.sh self verify:rbac` | 1（既有 S7） | `✗ S7 … 四条 sumsub demo 死行`；`FAIL: 1 check(s) failed`；`grep -c "^✓"` = 186 |
| `demo:all` 35/35、5/5；`data.md` 生成区零 diff | `on-stack.sh self demo:all`，之后 `git diff -U0 doc-final/demo/data.md` | 0 | `花名册：35/35 符合预期`、`asserts: 5/5 PASS`；diff 只有我手改的 `:350` 一行（`-`/`+` 各一行，同一行内容） |
| `recon:demo:break` 18/18、12/12、12/12 | `on-stack.sh self recon:demo:break` | 0 | `scenarios: 18/18 DETECTED`、`OK wallets 12/12`、`OK casesOpened 12/12`、`OK identities OK` |
| `recon:demo:pass` 21 钱包 0 案 | `on-stack.sh self recon:demo:pass`（场景 41 扫费后） | 0 | `status=PASS  walletsChecked=21  casesOpened=0` |
| R37 拒绝文案 | 场景 16 走完后 `on-stack.sh self recon:demo:break` | 1 | `Cannot re-stage the reconciliation scenarios: ITR261107362759 is posted and anchored to the current external statement, and re-staging regenerates that statement. Use "Reset demo data" (full reseed, about 1 minute) instead.` |
| reset 打印 `4 evidence row(s) + 8 flow row(s)` | `stack.sh reset self` 日志 | 0 | `✔ LP exchange evidence: 4 evidence row(s) + 8 flow row(s)`；`verify:demo-data ALL PASS` |
| `npm run audit:vocab` | `npm run audit:vocab` | **1** | `有码没说明（常量里有、种子文档没有，29 个）`——其中 8 个是本波新码（`HOUSE_TRANSFER_*` ×7 + `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`），21 个是既有（`DD_*` / `VENDOR_*` / `LP_PROFILE_*` / `DOCUMENT_UPLOADED`，`TOOLING-DEBT.md:164` 已登）；未写盘，`git status` 无 `doc-final/lark` 改动 |
| 闸 ① ② ③ | `npx tsc --noEmit -p tsconfig.json`；`cd admin-web && npx tsc -b --noEmit`；`cd client-web && npx tsc -b --noEmit` | 0 / 0 / 0 | 各 0 字节输出 |

场景 31 收尾 / 场景 16 之后 / 场景 41 之后的 `verify:coa`（均 exit 0、`ALL INVARIANTS PASS`）：41 之后 `ledger 1 FIRM 94870335`（扫费前后不变）+ 105 科目；16 之后 `ledger 1 CLIENT 34307565`（= 34107565 + `recon:demo:break` 场景 6 真写的 200000）；31 之后 `34107565 / 94870335 / 8201620811 / 114035428189`。

## 3. 走查（均 self 栈真实渲染；业务点击走 UI，只有 R37 拒绝与几处读数用 API / 命令；截图均 Read 过）

### 3.1 场景 16（Alice USDT，案 `REC20261107-003`）`t11-scene-16-*.png`
起点：`reset self` → `up` → `demo:all` → `recon:demo:break`。UI 全程：案件页 → Resolve →「Hold · Investigating」→ 勾「Unexplained (exhausted)」+ 备注 →「Record hold」（`-3`）→ ⚡ Fast-forward aging（几十秒内 `nextStep = SHORTFALL_TOPUP`，7500000 / AGING）→ Resolve 菜单「Fix the books」组出现「Recognize loss & top up」（`-4`）→ 弹层（`-5`：成因只读、短缺额锁定、Top up from 默认运营户）→「Submit to CFO」（`-6`，`ITR261107362759` / `APR261107770479`）→ 行「Pending CFO · ITR…」无菜单（`-7`）→ `cfo@` 审批页（`-8`）→ Approve → 行「Shortfall recognised · topping up」（`-9`）→ 腿 `FDO261107653195`（`-10`）⚡ Broadcast → ⚡ Seen in Mempool → ⚡ Confirm → 划转单 SUCCESS → **Hero 仍写「full amount unexplained」、行已「Explained · ITR…」**（`-11`）→ Re-reconcile → `RESOLVED`，行 Matched · Explained · ITR…（`-12`）→ 客户端 Alice USDT 流水 5 行、无认损 / 补款（`-13`，余额 2,700.000000 USDT）→ 凭证页按 ITR 号三笔：`SHORTFALL_RECOGNIZED`（A.CLIENT_SHORTFALL / A.CLIENT_CASH）、`FIRM_OUT`（X.EXPENSE_RECON_LOSS / A.FIRM_CASH）、`SHORTFALL_TOPUP_IN`（A.CLIENT_CASH / A.CLIENT_SHORTFALL）（`-14`）。随后 `recon:demo:break` exit 1（R37）。

### 3.2 场景 31（Bob，案 `REC20261107-001`）`t11-scene-31-*.png`
起点：`reset self` → `up` → `demo:all` → `recon:demo:crisis`（exit 0，`status==BREAK`、`casesOpened==1`）。案件页含新副行（`-1`）；Register incident 弹层（`-2`）→ 登记表单预填（`-3`）→ `INC261107696444`；调查备注 + 定损（Loss recognized、勾 Client Money discrepancy report，`-4`、`-5`；`FIL261107925276` DRAFT）→ 事故页「Recognize loss & top up」→ 案件页弹层自动开（`-6`）→ **提交被拒**（`-7`：`has only 12200.00 AED of cash free of in-flight payouts … first handle this wallet's in-flight payouts`）→ **`sm@` 拒 #18**（`APR261107100376` / `WDR261107083196`，`-8` 弹窗、`-9` 结果）→ 重新提交成功 `ITR261107890885` / `APR261107393906`（`-10`）→ `cfo@` 批（`-11`）→ 腿 1 `FDO261107523971` ⚡ Submit / Settle（`-12`）→ 腿 2 `FDO261107546518` ⚡ Submit / Settle（`-13`）→ 行 Explained · ITR…、Hero 仍未解释（`-14`）→ Re-reconcile → `RESOLVED`（`-15`）→ 事故页按钮仍在、状态 `Assessed`（`-16`）→ 挂 Transfer → `Resolving`、按钮消失（`-17`，这是场景 32 ⑩ 的动作，提前验证）→ 看板 NLA 1,114,752.25 / 红线 1,200,000.00 / 缺口 −85,247.75，运营户 AED 696,089.35 红（`-18`）→ 客户端 Bob AED 流水只有 `demo:all` 两笔、余额 257,100.00（`-19`）。
TB 读数（`GET /admin/tb/accounts`）：Bob 钱包现金 26220000、短缺待补 0、客户应付 25710000 + 暂扣 510000 = 26220000，F_OPS(AED) 69608935；`verify:coa` 见 §2。`/admin/prudential/status`：`nlaAedMinor 111475225`、`headroomAedMinor -8524775`、`breached true`。

### 3.3 场景 41（AED 扫费，`HTR261107419852`）`t11-scene-41-*.png`
全程 UI：看板「前」帧（`-0`，`reset → up → demo:all` 之后重拍；AED 运营户 946,089.35、三收入格 20.00 / 52.00 / 42.00）→ House Transfers 建单弹层（`-1`：From 默认 Company Fees 114.00、To 默认 Company Operations、金额自动 114.00）→ 提交（`-2`，Pending CFO review，`APR261107633507`）→ `cfo@` 审批页（`-3`，Impact 原话）→ Approve → 腿 `FDO261107134820`（`-4`，「Linked House Transfer」卡、只有 ⚡ Submit）→ ⚡ Submit / Settle → 详情页（`-5`：`Move cash (89)` 114.00 + `Close fee income to equity (90)` 20.00 / 52.00 / 42.00，Σ 114.00）→ 凭证页按 HTR 号四行（`-6`）→ 看板「后」帧（`-7`，运营户 946,203.35、AED 三收入格 0.00、USDT 两格不动）。TB 读数：210 / 211 / 212 = 0 / 0 / 0（AED）、公司权益 AED 94870335（= 94858935 + 11400）、F_FEE 0、F_OPS 94620335。

### 3.4 场景 8（补走，Jack ↔ Kate）`t11-scene-08-*.png`
UI：Reattribute 两窗 → `ADJ261107084508` → `cfo@` 批 → **批准后重对账前** Jack 案页仍是破口快照、行标签「Pending CFO · ADJ…」（`-1`）→ Re-reconcile → Jack 案 `RESOLVED`、行 Matched · Explained · ADJ…（`-2`）；Kate 案同一行 Matched · Explained · ADJ…，但案里还有场景 14 那条 1,200.00 OUT 孤儿行，**整案仍 Open**（`-3`）。这是 brief 里「场景 8 文字」那条的实证依据，也纠正了旧文「两个案子同时 Resolved」。

### 3.5 场景 26（补走一段，LP 看板）`t11-scene-26-*.png`
UI：开 LP 兑换单（Falcon，卖 10,000 AED 买 2,720 USDT）→ CFO 批 → 卖出腿 ⚡ Submit / Settle → 看板「Due from LP — Pending Delivery」读 `FALCON LIQUIDITY FZE · USDT  2,720.000000 USDT`（`-1`）；CFO 批之后、卖出腿确认之前 TB 读数 51 全 0；⚡ Simulate LP delivery 后 51 回 0、「LP Delivery In Transit」USDT 格 2,720.000000（`-2`）。

## 4. 走查中发现、需要主会话知道的事

1. **brief / spec 写「CFO 拒 #18」，产品里不是 CFO**：#18 是 `WITHDRAW_LARGE_VALUE_APPROVAL`，审批链唯一一步 = `SENIOR_MANAGEMENT_OFFICER`；`cfo@` 打开那张审批单没有 Approve / Reject 按钮（`t11-scene-31-8-cfo-reject-18` 的 notfound 帧已删，未入库），`sm@` 才有。剧本按产品写成 `sm@`（场景 31 账号行与 ⑥）。不是缺陷，是前提偏差；spec 裁定 14 原话是「金库把待批提现拒掉 / 撤回」，金库同样没这个权限。
2. **场景 8 / 16 的重摆**：`recon:demo:pass` 与 `break` 都被 R37 闸拒绝（不只 break）；场景 26 ⑦ 要现场跑 pass，已加提示。
3. **读面小问题（未修，登记于此）**：(a) 开着的案子在「调账单已落账 / 未重对账」期间，行标签仍是「Pending CFO · ADJ…」（页面按破口那一轮的截止点读；认损补缺单的标签是随单状态走的，不受此影响）；(b) 场景 8 的 Kate 案在 Re-reconcile 之后 Hero 仍写「… 5,000.00 explained, awaiting re-reconcile」——T10 登记的「`awaiting re-reconcile` 后缀可能对开着的案子过期」**已复现**；(c) 看板「Due from LP」格副标题写「Clears when the LP delivers and the delivery is accepted」，实际在 ⚡ 到货（`DELIVERED`）那一步就归零，验收之前——剧本按实际行为写。
4. **`audit:vocab` exit 1**：见 §2；基线 `:432` 行已注明，不再写「exit 0」。
5. **未走 / 未验**：场景 18（与 31 同一条事故路代码；18 的 Jack 钱包有无在途出款未查）、场景 32（只验了 ⑩ 的挂载一步）、场景 29 的 Pay From（有 T4 证据，未重走）、场景 37 的真实 LP 批准开 51 户（T1 minor「→ T11 walk」**未覆盖**：本任务用的是种子 LP，51 户是种子开的）。
6. **其他仍写旧路径的活文档（不在本任务清单，未改）**：`doc-final/modules/overview.md:61 / :86`（「发起补款 · 垫款」）、`doc-final/delivery/decision-log.md` D-10（「认损调账＋真金白银补款划转」）。`decisions.md` 的历史条目按惯例留给收官（spec §10）。

## 5. 收尾态

`bash scripts/stack.sh reset self` → `up` → `bash scripts/on-stack.sh self demo:all`（0 / 0 / 0；`花名册：35/35`、`asserts: 5/5 PASS`）→ `verify:coa`（0，105 科目）。栈留在这个态：案件 0 条、无在途单据；`doc-final/demo/data.md` 生成区未被改写。
