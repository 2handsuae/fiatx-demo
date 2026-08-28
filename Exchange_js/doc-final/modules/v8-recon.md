# V8 · 对账（账对不对得上）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-08-26（底稿 truth 2026-07-04 + 批次三实测 pass/break 实跑）
> 演示幕次：第六幕「账对」 ｜ 验收用例：TC-08（对账）

## 0. 一句话定位

管**内部账本与外部世界对不对得上**：银行对账单、托管方余额、链上记录归一化进来，与账本**逐物理钱包、逐笔流水 1:1 直比**，差异分桶、开案、处置。

## 1. 业务叙事

最重要的一件事：**对账不对总数，对的是每一个钱包的每一笔。** 总数对得上可能只是错误互相抵消；逐钱包逐笔对上了，才敢说账是真的平。

**每天的节拍。** 迪拜时间凌晨两点半（银行与托管账单入库后），自动对前一天：① **先自检**——内部恒等式预门（客户资产 = 客户负债，自己的账都不平就没资格对外，直接中止并报内部破口）；② **逐钱包比余额**——客户钱包外部余额对客户应付+暂扣，公司钱包 1:1 直比；③ **逐笔配流水**——三轮匹配：同参考号跨钱包互证 → 金额+方向+时间窗模糊配 → **在途识别**（外部有、内部还没落的行，去找非终态资金单认领——"钱在路上"不是差异）。

**差异分五桶，命中即止。** 残差不为零 → **破口**（BREAK，真差异）；残差为零但有在途 → 在途；残差为零但流水有异常 → 软标记；干干净净 → 已匹配。破口开案：**每个钱包同时只有一张打开的案子**，下一轮对账自动复核——好了自动销案，没好继续挂着。

**处置的第一个动作：推单。** 卡在途的资金单推到终点——同步腿由系统在已摄入的对账单里找**唯一回执**（参考号三字段精确优先，钱包+方向+金额+时间窗兜底），人工腿由运营强推但必须附三件套证据；两种推法都**逐步走状态机、不直写账本、不跳步**，并回填生效日。推完重对账，差额归零、案子自愈。

**单位契约。** 内部一切金额按**最小单位（分）**的整数计，外部账单入库先洗成分，展示时才按资产精度转成元——曾经的假破口就是元、分混算造出来的。

## 2. 状态机

| 主体 | 状态流 |
|---|---|
| 对账轮 Run | 每轮一行：五桶计数 + 开案/复核/销案三元组 + 每钱包快照（快照定格，历史数字不再漂移） |
| 案件 Case | `OPEN → RESOLVED`（自动复核销案已通；人工核实路径未做）；桶别 = 在途 / 软标记 / 破口 |
| 五桶判定 | 纯函数，180 组网格验证互斥——一笔差异只会落一个桶 |
| **调账单 Adjustment**（2026-08-28 新增）| `DRAFT → PENDING_APPROVAL → POSTED / REJECTED`，后两者为终态、不可撤（账本只进不出，开错了只能再开一张反向单）。驳回 / 取消 / 审批超时三种"不落账"结局统一落 `REJECTED` |

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 每日对账 | 系统 cron（迪拜 02:30 对 T-1） | — | 内部恒等预门不过直接中止 |
| 一键重对账 | 运营 | 直接执行 | 处置后验证自愈 |
| 推单（同步腿） | 运营 | 系统找唯一回执，找不到宁可不推 | 逐步推进，不直写账 |
| 推单（人工腿） | 运营 | 强推需三件套证据 + 审计 | 人工也留痕 |
| **开调账单（纠错）** | 运营（案件页点某条流水行，表单预填） | **审批中心单步 `OPS_OFFICER`** | 批准即落一笔账本分录；**无资金单、无真实转账、无在途**（判据见 decisions.md 2026-08-28「资金单看有没有在途要追」）。落完点「重对账」→ 差额归零 → 案子自愈 |
| 人工核实 / 销案 / SLA 升级 | — | **未做**（deferred） | 案子止于 OPEN + 自动复核 |

## 4. 演示脚本（第六幕 · 账对）

1. `recon:demo:pass` → 记分牌全绿——先让观众看到"平"长什么样
2. `recon:demo:break` → 铺 9 种破口，**拿着答案键逐个讲**（金额错配 / 漏行 / 精度错 / 漏存款 / 银行退回 / 孤儿存款…）→ 记分牌红、案件列表逐案点开看"差额解释五格"
3. 挑一笔在途：资金单详情页推单 → 一键重对账 → **差额归零、案子自愈**——处置闭环的实感
4. 顺带讲内部恒等预门："对外之前先自证"，verify:coa 现场跑一遍全绿

**已知口径**：9 种破口引擎现漏检 2 种（银行手续费/利息两类软标记）——按 7 种讲，缺口 BACKLOG 在案（批次三实测）。

## 5. 关键技术节点（≤30 行）

- 编排 `clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts → run()`（预门→逐钱包→分桶→开案→快照→自动复核）/`computeInternalIdentity()`（内部恒等预门，与 verify:coa 同式）
- 引擎 `engine/v2/wallet-balance-checker.service.ts → checkBalance()` ｜ `wallet-flow-matcher.service.ts → matchFlows()`（三轮匹配）｜ 纯函数 `bucket-classifier.ts → computeBucket()`（五桶互斥）+ `effective-cutoff.ts`（生效日过滤）
- 处置 `disposition/push-order.service.ts → syncPush()/manualPush()/driveToCleared()`（逐步 advance 不直写）｜ `receipt-lookup.service.ts → findUniqueReceipt()`
- 处置·调账（一期，2026-08-28）：`disposition/adjustment-rules.ts`（纯函数：四种分录组合由「账簿 × 方向」定，成因不参与计算；成因闸 `assertReasonAllowed`；边界线守卫 `requiresRelatedOrder`）｜ `disposition/adjustment.service.ts → createDraft()/submit()/onApproved()/onRejected()`（不直写 TB，只调 `AccountingService.executeTransfer`，evidence 必带 `walletRef` + `isExternalCrossing:false`）｜ `disposition/adjustment-approval.service.ts`（四钩子全覆盖，`@OnEvent` 必须显式重标——子类覆盖拿不到基类元数据）｜ `disposition/adjustment.controller.ts`（3 端点）｜ 表 `reconciliation_adjustments`
- 数据 `account_flows`（账本流水投影，分口径）｜ `external_balances`+`external_statement_lines`（外部归一化两表）｜ `reconciliation_run_wallets`（快照表）
- 触发 `sweep/reconciliation-sweep.service.ts → dailyRecon()`（@Cron 迪拜 02:30）；读面 `reconciliation-query.service.ts`
- 演示 `scripts/recon-demo.ts`（九场景 pass/break + manifest 答案键）+ `recon-rerun.ts`
- 留痕（站5-β，V8_RECON_AUDIT_ACTIONS 4 码）：跑批完成 RECON_RUN_COMPLETED（双通道：cron 系统 / 管理员触发记名，主对象=runNo）｜ 立案 RECON_CASE_OPENED ｜ 自愈 RECON_CASE_AUTO_HEALED ｜ 推单 RECON_PUSH_ORDER（同码双证据通道，继承父单旅程号，主对象=资金单号）——对账件无客户旅程走 NONE 模式，唯推单 INHERIT

## 6. 演示缺口（BACKLOG 有账）

- **处置现有两个动作**：在途走**推单**，"我们记错了"走**调账单**（一期，2026-08-28 落地：七个成因、四种分录组合、审批单步 `OPS_OFFICER`、落完重对账自愈）。仍 deferred：人工核实 / 销案 / SLA 升级；**补记真实资金流入流出**（漏监听的充值等）按 decisions.md 2026-08-28 归交易三域，不归调账；**公司补款给客户**（C3 未授权转出的赔付）与**事故登记**分别是二期、三期，BACKLOG 在案
- **外部账单没有真实摄入管道**：演示的"银行对账单"由脚本铸造——讲清这是模拟件
- **复核计数恒为 0**（已知实现限制，注释在案）；**SUCCESS 后退汇应归对账认领**（承接第五幕话头）未接
