# recon 引擎单位契约统一（canonical minor）设计 — v2（据 scale 审计推翻重写）

> 日期：2026-07-04 ｜ 状态：v2 定稿（v1 前提被 scale 审计证伪，整体重写）｜ 分支：demo-realdata
> 触发：真实卡单 push 后 delta 不归 0（=49302=49800−498）。v1 归因"外部是元、把外部×10^decimals 换分"——**审计证明错了**。
> 顶层原则（业主 2026-07-04 拍板）：**内部所有数据按分计｜外部对账单无论什么样，入库一律洗成分｜前端展示时才按 asset.decimals 转成元（小数点）——展示是前端问题，不是存储问题。**

---

## 0. scale 审计结论（v1 为何被推翻）

单笔端到端追踪 + run_wallets 快照 + 逐行读写入方，钉死每列真实 scale：

| 表 / 写入方 | 真实 scale | 铁证 |
|---|---|---|
| `account_flows.amount`（账本真相）| **分** | 8000 元充值 → flow 800000（AED decimals=2，×10^2）|
| `funds_orders.amount` / 整个业务层（充值/提现/兑换/报价/手续费）| **元** | 充值 8000、兑换 toAmount 3650.47 / 134.78557（带小数）|
| `external_statement_lines` / `external_balances` | **无统一契约**：writeMirror 写分、夹具写元 | recon-demo.ts:348/379 贴 account_flow（分）；demo-fixtures.ts:101/76-77 用 netAmount（元）|
| balance-checker 比 closing vs internal | 要**分** | delta=closing−internal，internal 来自 account_flows（分）|
| matcher Pass1/2 比 account_flow vs 外部行 | 要外部是**分** | wallet-flow-matcher:242/264 裸 equals |
| matcher Pass3 比 funds_order vs 外部行 | 要外部是**元** | wallet-flow-matcher:283（比 netAmount/amount）|
| push 回执 receipt-lookup 档2 | 要外部是**元** | receipt-lookup:57/61 `String(order.amount)` 直比 |

**真根因**：外部对账单这**一列**同时被"要它是分"的 Pass1/2 和"要它是元"的 Pass3 / push 回执消费——不可能两头都对。两个 demo 写入方（writeMirror 分 / 夹具 元）本身就打架。heal 差的 49302 = 夹具把 closing 只减 498（元）、真实 POST 却动 49800（分），差 100 倍（AED 10^2）。

**v1 错在哪**：① 以为外部一律是元（实际 writeMirror 已写分）；② 把换算对象定成"外部×10^decimals"（实际外部该是分、不该动，真正是元的是 funds_order）；③ 漏了 push 回执 receipt-lookup 也拿元比。→ v1 的 Task A（换外部）与 Task C（夹具改分）天生矛盾，干完 heal 照样不平。

**v1 的 C1（Pass1/2 未换算）是假警报**：外部定分后 Pass1/2 是分比分，本就不该换算——撤销。

---

## 1. 决策记录（v2）

| # | 问题 | 结论 | 依据 |
|---|---|---|---|
| 1 | canonical 存储 scale | **分**（整数）——内部全分、外部洗成分 | 业主原则；账本/TB 本就是分；分=整数，顺带绝根小数崩溃 |
| 2 | decimals 来源 | **一律 asset 表** | 业主原则；查询层已是 `asset.findMany({select:{code,decimals}})` |
| 3 | 业务层（元）本轮改不改存储 | **不改**（乙/两步）| 充值/提现/兑换/资金单/报价/手续费整层存元，搬分 blast radius 巨大 → 单列 BACKLOG 排期 |
| 4 | 本轮换算对象 | **只 funds_order（元→分）**，在 recon 读入边界（Pass3 + 回执）| 外部已洗成分、account_flows 已是分，唯一入 recon 的元源是 funds_order |
| 5 | 展示 | **前端 分→元（÷10^decimals，asset 表）** | 业主原则；部分页已做，收齐硬编码页 |

**乙的两步**：本轮（这周）= 外部洗成分 + recon 把 funds_order 元→分；**下一步（BACKLOG）** = 业务层整层存储元→分，做完后本轮的边界换算即可撤除。

---

## 2. 本轮改动（component by component）

### 2.1 外部对账单入库一律分（"洗成分"）
- **夹具 `injectStuckExternalMirror`（demo-fixtures.ts）**：现写元（line.amount=元、closing=分±裸元）→ 改**分**：
  - `bumpMinor = BigInt(amount.mul(10^decimals).toFixed(0))`（元→分，Prisma.Decimal 乘，禁浮点）
  - `closing = internalPosted(分) ± bumpMinor`
  - `line.amount = bumpMinor`
  - 注释 line 44-47 的"主/最小单位混用蒙混"整段删除，改为"入库洗成分"。
  - `toAsset.decimals > 2` 的 swap 方向硬 guard **撤除**（元→分后卡腿金额恒整数，to-USDT 6 位方向重新可用；顺带绝根 T2 的 `BigInt(小数)` 崩溃）。
  - amount 入参仍是元（腿 netAmount/amount，业务层本轮存元），换算在夹具内做。
- **writeMirror（recon-demo.ts）**：已写分（贴 account_flow）——**不动**。
- **未来真实银行/托管导入器**：入库时按 asset.decimals 洗成分（本轮无真实导入器，仅立契约）。

### 2.2 matcher（wallet-flow-matcher.service.ts）
- **Pass1/2**：account_flow（分）vs 外部行（分）——**不换算**（撤 v1 C1）。补注释：外部行契约=分。
- **Pass3**：外部行（分）vs funds_order（元）——**只换 funds_order**：
  - `extMinor = BigInt(ext.amount.toFixed(0))`（外部已是分整数，直用）
  - `toMinor(d) = BigInt(d.mul(10^decimals).toFixed(0))` 只作用于 `c.netAmount`/`c.amount`（funds_order 元）
  - `amountOk = extMinor === toMinor(c.netAmount) || extMinor === toMinor(c.amount)`
  - 输出 `inTransit.amount = extMinor.toString()`（分）
  - **撤掉 v1 对 ext 的 toMinor 包裹**（ext 本是分）。
- run 服务批量查 decimals 传入不变；`:202` inTransitSigned（分）不变。

### 2.3 push 回执 receipt-lookup（receipt-lookup.service.ts）— v1 漏掉
- 档2（`:57/61`）：`String(order.amount)`（funds_order 元）直比 `l.amount`（现改分）→ **会 MISS**。改：先按币种查 asset.decimals，`toMinor(order.amount) === BigInt(String(l.amount))` 再比。decimals 来源：`bal` 有 currency，按之查 asset。
- 档1（ref 精配）不比金额，**不动**。

### 2.4 展示层 分→元（前端）
- **External Balances 页**（`ReconciliationExternalBalancesPage.tsx:54` `fmtAmount(v, decimals)`）：已 `÷10^decimals(asset)`——**不动**。
- **Cases/Runs 详情页**（`ReconciliationCasesDetailPage.tsx:165` 硬编码 `DEFAULT_DECIMALS`）：改用后端已提供的 asset.decimals（getCase 已查 `reconciliation-query.service.ts:568-575`），前端接上。Runs 详情页同排查。

### 2.5 不动的
- balance-checker（已分）；writeMirror（已分）；account_flows 存储（已分）；业务层存储（元，本轮不搬，见 §6 BACKLOG）。

---

## 3. heal 闭环（本轮目标，验算）

夹具改分后（AED 498 元 → 49800 分）：
- push 前：closing = internal − 49800（分）；delta = −49800；Pass3 认领卡腿（funds_order 498 元 → toMinor=49800 分）→ inTransitSigned = −49800；残差 = delta − inTransitSigned = 0 → **IN_TRANSIT**。
- push sync → 驱 CLEARED → 真 POST（internal −49800 分，带回填生效日）→ 重对账：delta = closing − internal = (internal−49800) − (internal−49800) = **0**，卡腿终态不再在途 → **delta=0 / case AUTO_HEALED**。

场景 2-9（break 检测型）：纯外部自洽 delta，与换算无关；金闸门 9/9 保持（recon-demo 场景 bump/line 若需随"外部=分"口径核对，见 §4 Task 5）。

---

## 4. 任务拆分（Subagent-Driven）

| # | 任务 | 文件 | 依赖 |
|---|---|---|---|
| **T1** | matcher Pass3 换算对象改为 funds_order（撤 ext 包裹）+ Pass1/2 补注释；单测红→绿 | wallet-flow-matcher.service.ts (+spec) | — |
| **T2** | 夹具 injectStuckExternalMirror 入库洗成分（closing+line）+ 撤 swap `>2` guard | demo-fixtures.ts | — |
| **T3** | receipt-lookup 档2 funds_order 元→分（按币种 decimals）+ spec | receipt-lookup.service.ts (+spec) | — |
| **T4** | Cases/Runs 详情页 分→元 用 asset.decimals（撤硬编码） | ReconciliationCasesDetailPage.tsx / Runs 页 | — |
| **T5** | recon:demo scenario-1 去壳（复用 createStuckWithdraw）+ 场景 2-9 外部=分口径复核 | recon-demo.ts | T1,T2 |
| **T6** | 重置脏库 → 全 heal e2e（delta→0/AUTO_HEALED）+ 金闸门 9/9 + tsc/jest + 文档 truth 同步 + BACKLOG 登记 | 收口 | T1-T5 |

## 5. 验收标准

- [x] 单测：matcher decimals=2 + 外部行 49800 分 + funds_order 498 元 → in-transit amount=49800 分（认领成功，红→绿）— T1 spec 绿
- [x] 单测：matcher 外部行分 vs funds_order 元，USDT decimals=6 也认领（多小数位）— T1 spec 绿
- [x] e2e：`demo:in-transit`（夹具改分）→ recon IN_TRANSIT 残差 0 → push sync CLEARED → 重对账 **delta=0**（**整件事目标·已实证**，`--verify: PASS`，连跑无 reset 3 次幂等）。⚠️ case 自愈到 AUTO_HEALED/RESOLVED 需钱包零异常达 MATCHED——复用 demo 钱包有历史内部单腿故落 SOFT_FLAG（delta 已归 0），case-close 路径由单测 `wallet-recon-run.service.spec.ts`（run A 破 → run B 恢复 → RESOLVED/AUTO_HEALED）证明。T6 另修两 heal 阻断 bug（历史流水 Pass2 抢配 + 异步 POST 竞态，见 BACKLOG）
- [x] 回执：receipt-lookup 档2 改分后 push sync 命中真实卡单（不 MISS）— T3；heal e2e 中 `syncPush` 全程 CLEARED 命中
- [x] 金闸门：`recon:demo:break` 9/9 DETECTED + 两恒等式（外部=分口径）— reset && break 连跑两遍幂等 9/9，identity①② OK
- [x] createStuckSwap 撤 `>2` guard 后 to-USDT 方向也能造在途（可选）— T2；swap 钱包 heal e2e 中稳定 IN_TRANSIT
- [x] 展示：Cases/Runs 详情页金额改 asset.decimals；AED（2 位）+ USDT（6 位）小数正确 — T4；后端 `accountStatusTable[].decimals`/`getCase.decimals` 就位，前端 `formatAmount(raw,decimals)` 对 live API 实证：AED 251947→2,519.47、-49800→-498.00；USDT 297000000000→297,000.000000、61→0.000061（preview харness 无法接自栈 3111，用 exact-formatAmount-on-live-API 佐证，见 BACKLOG launch.json 治理）
- [x] 后端 tsc 0 / admin-web tsc 0 / jest 净新增失败 0 — backend tsc 0、admin tsc 0、jest 742 pass / 4 fail（全 pre-existing，均在 `asset-treasury/wallets/`，与 canon2 零关联）
- [x] 脏 demo 库重置后重跑（避免 v1 陈行干扰）— 每次 e2e/金闸门前 `recon:demo:reset`；T6 另加"金额避让历史净额"使无 reset 连跑也幂等

## 6. 明确不做（本轮）+ BACKLOG

不做：业务层存储元→分整层迁移（乙第二步）｜真实银行/托管导入器｜容差/舍入策略变更（元→分是精确 ×10^n）｜前端非金额改动

BACKLOG：
- **新增**：业务层（充值/提现/兑换/资金单/报价/手续费）存储 **元→分** 整层迁移——乙第二步；完成后可撤除 recon 边界的 funds_order 元→分 换算（§2.2/2.3）｜来源: 2026-07-04 scale 审计 + 业主"内部全分"原则
- **关闭**（本轮兑现）：v1 遗留"缺真实卡单 demo heal"（推单 T5 欠账）
- **撤销**：v1 code-quality C1（Pass1/2 未换算）——外部定分后分比分正确，非缺陷
