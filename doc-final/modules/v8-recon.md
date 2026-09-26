# V8 · 对账（账对不对得上）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-26（战役甲波二：§4 场景 18 走查步骤随事故通报单槽退役改写——通报环节转手报送台合规官起草送签、高管批准，见 `modules/v9-regulatory-filing.md`）；此前 2026-09-25（战役甲波一收口：§6「事故登记」处置项与 §5 权限段随事故域十类终盘/四结案链/六权限桶改动同步订正，见 `modules/v1-governance.md` §7 主篇）；此前 2026-09-10（对账平账两角色定案：推单 `FUNDS_ORDER_ACT`、拨钟 `DEMO_CLOCK_WRITE`、事故登记 `INCIDENT_WRITE`、对账读面三组整体从 `OPS_OFFICER` 迁 `TREASURY_OFFICER`，运营对账/资金单/事故域清零，只留 `FUNDS_ORDER_VIEW` 只读）；此前 2026-09-08（平账处置改版：行上直接按钮 / 单码制注册表 / 金库全线开单 CFO 复核 / 死胡同修复 / 列表页场景气泡，收尾闸重铺闸实跑）
> 演示幕次：第六幕「账对」 ｜ 验收：第六幕走查（`demo/script.md`）+ 本篇 §4

## 0. 一句话定位

管**内部账本与外部世界对不对得上**：银行对账单、托管方余额、链上记录归一化进来，与账本**逐物理钱包、逐笔流水 1:1 直比**，差异分桶、开案、处置。

## 1. 业务叙事

最重要的一件事：**对账不对总数，对的是每一个钱包的每一笔。** 总数对得上可能只是错误互相抵消；逐钱包逐笔对上了，才敢说账是真的平。

**每天的节拍。** 迪拜时间凌晨两点半（银行与托管账单入库后），自动对前一天：① **先自检**——内部恒等式预门（客户资产 = 客户负债，自己的账都不平就没资格对外，直接中止并报内部破口）；② **逐钱包比余额**——客户钱包外部余额对客户应付+暂扣，公司钱包 1:1 直比；③ **逐笔配流水**——三轮匹配：同参考号跨钱包互证 → 金额+方向+时间窗模糊配 → **在途识别**（外部有、内部还没落的行，去找非终态资金单认领——"钱在路上"不是差异）。

**业务日口径（2026-09-21 波五钉死）。** 业务日 = 迪拜日历日（恒定 UTC+4、无夏令时）：时刻 t 的业务日 = `(t+4h)` 的 UTC 日期；业务日 D 的日终 = `D T19:59:59.999Z`（迪拜次日 00:00 前一刻），日始 = `(D-1) T20:00:00.000Z`。唯一真源 `business-date.util.ts` 的 `toBusinessDate`/`endOfBusinessDate`/`startOfBusinessDate`；全仓不再手拼 `T23:59:59.999Z`/`T00:00:00Z` 表达业务日边界（决策见 `decisions.md` 2026-09-21）。

**差异分四桶，命中即止。** 残差不为零 → **破口**（BREAK，真差异）；残差为零但有在途 → 在途；残差为零但流水有异常 → 抵销；干干净净 → 已匹配。破口开案：**每个钱包同时只有一张打开的案子**，下一轮对账自动复核——好了自动销案，没好继续挂着。

**处置的第一个动作：推单。** 卡在途的资金单推到终点——同步腿由系统在已摄入的对账单里找**唯一回执**（参考号三字段精确优先，钱包+方向+金额+时间窗兜底），人工腿由运营强推但必须附三件套证据；两种推法都**逐步走状态机、不直写账本、不跳步**，并回填生效日。推完重对账，差额归零、案子自愈。

**真差异怎么处置：财务选处置，系统只管硬边界 / 留痕 / 复核（2026-09-08 处置改版，覆盖 2026-09-01「人先选成因、系统再定出口」）。** 公理不变——**外部资料是权威**，银行对账单、托管方余额说是多少就是多少，**没有「对方错了」这一档**，一切不平只有三种性质：我方账**错了** / 我方账**缺了** / **时机没到**。但责任模型翻转了：**错误责任归财务，系统流程不担责**。差异行上**直接长着处置按钮**——按格出、按记账事实过滤（乙档硬边界：只挡"账务上开不出单"的选项，例如 SWAP 来源的行天生没有冲正 / 冲销按钮，因为它压根没有可落的调账码；丙档"软建议"明确不做），合法集合内财务自选。点按钮出**一个弹窗**：证据区只读 → 该处置在这一格能配的原因码（20 个成因里只有一个机器认得出——同参考号同金额的重复入账双胞胎，其余全靠人；`Other` 是正式码、手写必填）→ 系统推导区只读（方向 / 金额 / 生效日，算术不是判断）→ 查证说明必填 → 提交。**动钱的四族（冲正 / 冲销 / 补记 / 改记）与补单三路一次提交即原子开单**，送 **CFO** 单步复核；挂起两种（等下期 / 调查中）零账务，提交即落、不送审。系统只保留三样立场——**硬边界**（开不出的单不给按钮）、**留痕**（码 + reason 成对入审计，两条动作各显式记一条，漏一条即被静默去重）、**复核**（CFO）；选哪个处置是财务的判断，选错了 CFO 打回，审计里是谁的判断一目了然。「Record finding」两屏定性弹窗随之退役。

**挂起不粉饰。** 「跨账期下期自平」「查不出、已穷尽调查」这两类的查证结论就是**我方账不动**，零分录；案子照旧红着——差异确实还在，只是知道了原因。

**补单：钱真进出了，只是没走我方正常流程（2026-09-03 平账 B 批立）。** 漏记的客户入金、被银行退汇的入金、出款后又被银行退回的钱——这三类不是"我方账错了"，是**外面真有一笔钱进出，我方要回到对应的业务域把流程真正跑一遍**（decisions.md 2026-08-28：不许用调账凭空给客户加钱，那等于没跑 KYT、没过合规闸、没有客户单号）。入口摆在案子上，逻辑与数据都在业务域：差异行「Supplement」按钮 → 选中三个成因之一 → 弹出对应表单（补录填来源地址 / IBAN；退汇 / 退回从候选原单里选）→ **金库**发起（2026-09-08 处置改版：三路开单权迁 `TREASURY_OFFICER`，运营退出）→ **CFO 单步复核**（与调账、核销同一个裁决人）→ 业务域自己建单、走完整流程、记账、留痕 → 定性行的补单号回填 → 重对账自愈。三条路里唯一带前置条件的是「Claim recall」：客户可用余额必须够扣，不够走「Initiate advance」（内部划转单，先垫后扣，2026-09-05 平账二期）；垫款之外仍要留痕追索的，案子上「Register shortfall」登记为事故（`CLIENT_SHORTFALL`，2026-09-06 平账三期，见 `modules/v1-governance.md` §7）——只登记欠款、留痕备查，不建分录、没有自动追偿机制。**虚拟币没有退汇**——链上转账不可逆，退汇只发生在法币这条轨道上。

**悬着多久，悬太久怎么办（2026-09-02 立）。** 每张打开的案子一只钟：业务日日终起算，3 天到线标「超期」、记一条审计、列表醒目，状态不动。到线后按案子在等什么解锁下一步：等钱到账的去推单；等下期的重查；**查不出的**，公司池小额由金库开核销单、CFO 批、一笔分录进损益（少了认损进运营资金，多了计入其他收入）、重对账自愈；大额由运营在案件页点「Escalate to incident」登记为事故（`LARGE_UNEXPLAINED`，2026-09-06 平账三期，见 `modules/v1-governance.md` §7），走独立的调查/定损/通报/结案流程善后，对账侧该行标「事故·待处置」；客户池要等二期划转（托管里真少了钱，先认损再由公司补款）。核销是唯一没有故事的出口，所以门最重：账龄 / 小额线 / CFO 三道锁少一道就是抹差异的后门。**豁免与容差不做**：本系统与服务商精度一致，尘埃差不存在，立场是一分不差、一分也追。

**单位契约。** 内部一切金额按**最小单位（分）**的整数计，外部账单入库先洗成分，展示时才按资产精度转成元——曾经的假破口就是元、分混算造出来的。

**客户池的短缺（2026-09-05 平账二期立）**：查不出的小额短缺到线后走**认损**（分录同核销、只许托管里少了的方向），案子愈；随后金库在案子上「Initiate compensation」、CFO 批、真转账补齐客户。退汇认领余额不够不再只是拒：行上直接给「Initiate advance」，先垫后扣。两条都是第四类订单「内部划转单」，见 `modules/v7-treasury.md`。

## 2. 状态机

| 主体 | 状态流 |
|---|---|
| 对账轮 Run | 每轮一行：四桶计数 + 开案/复核/销案三元组 + 每钱包快照（快照定格，历史数字不再漂移）；run 状态 `PASS / BREAK / INTERNAL_BREAK` 三态——`INTERNAL_BREAK` 是内部恒等预门本身破裂时的 run 结局，per-wallet 分桶整体未跑，**不是钱包差异桶**（波五 T6 写入语义修正：`invariantStatus` 此前把普通 BREAK 也误记成恒等 FAIL；详情页三态呈现：INTERNAL_BREAK 红色专用横幅+隐藏健康检查卡与钱包表） |
| 案件 Case | `OPEN → RESOLVED`（自动复核销案已通；人工核实路径未做）；桶别 = 在途 / 抵销 / 破口 |
| 四桶判定 | 纯函数，180 组网格验证互斥——一笔差异只会落一个桶 |
| **调账单 Adjustment**（2026-08-28 新增）| `DRAFT → PENDING_APPROVAL → POSTED / REJECTED`，后两者为终态、不可撤（账本只进不出，开错了只能再开一张反向单）。驳回 / 取消 / 审批超时三种"不落账"结局统一落 `REJECTED` |
| **定性 Disposition**（2026-09-01 新增）| **覆盖式记录，无状态机**（刻意）——同一条差异行（同锚）至多一条有效定性，重定 = 覆盖 + 各记一条审计；**唯一的锁 = 挂单后不可覆盖**（`adjustmentNo` 非空即拒 400；**2026-09-03 平账 B 批新增 `SUPPLEMENT` 出口同构一把锁**——`supplementNo` 非空同样拒改，业务域执行完成或被拒后回填 / 清空）。不计时：查无果的账龄计时是核销的前置，见下「案件计时」行 |
| **案件计时**（2026-09-02 新增）| `slaDeadline` 开案时 = 业务日日终 + 3 天，复观察不重置；到线 `slaBreached=true`（软破线，状态不动）；⚡拨钟只拨截止、标记只由扫描置 |
| **划转回挂**（2026-09-05 新增）| 认损落账后案子 RESOLVED 但行上「待补款」活着，直到补款 SUCCESS |

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 每日对账 | 系统 cron（迪拜 02:30 对 T-1） | — | 内部恒等预门不过直接中止 |
| 一键重对账 | **金库**（`RECON_RUN_WRITE`，2026-09-08 处置改版迁 `TREASURY_OFFICER`，运营退出） | 直接执行 | 处置后验证自愈 |
| 推单（同步腿） | **金库**（`FUNDS_ORDER_ACT`，2026-09-10 对账平账两角色定案迁 `TREASURY_OFFICER`，运营退出） | 系统找唯一回执，找不到宁可不推 | 逐步推进，不直写账 |
| 推单（人工腿） | **金库** | 强推需三件套证据 + 审计 | 人工也留痕；`FUNDS_ORDER_ACT`（推资金单腿）与案件页处置入口 `RECON_DISPOSITION_WRITE` 仍是两个不同端点各自的权限组，只是 2026-09-10 起同归金库一手持有，不再分属两个角色 |
| **处置：冲正 / 冲销 / 补记 / 挂起**（差异行直接按钮，2026-09-08 处置改版取代旧「先定性 · 再开单」两步）| **金库**（`RECON_DISPOSITION_WRITE`，运营退出案件页业务动作；点差异行按钮——按格 × 记账事实硬边界过滤过的合法处置——选一个原因码、填查证说明）| 冲正 / 冲销 / 补记：**一窗到底、开单原子落**，送**审批中心单步 `CFO`**；挂起两种（等下期 / 调查中）：无需送审 | 原因码菜单**无兜底档**（「查不出」也是一条正式码，要求说明里写清查过什么）；矩阵外处置 / 码不配处置显式拒 400；同锚重定 = 覆盖 + 各记一条审计；**挂单后锁定**不可覆盖；调账三族**无资金单、无真实转账、无在途**（判据见 decisions.md 2026-08-28「资金单看有没有在途要追」），批准即落一笔账本分录，落完点「Re-reconcile」→ 差额归零 → 案子自愈；挂起零账务，提交即落定性 + 审计，案子仍红——不粉饰 |
| **改记（记错客户，换主）** | **金库开单**（`RECON_ADJUSTMENT_WRITE`，从对端候选清单里挑正主方）| **CFO 复核**（审批中心 `RECON_ADJUSTMENT_POST` 单步 `CFO`，复用既有策略未新增）| **一张单牵两个案件**（错记方 + 正主方各一个锚），**资产腿不动**（钱在托管里一分没动，只是主人记错了）；正主方加钱必填关联原单号；两侧业务日必须相同；**一次重对账两案齐愈** |
| **核销（公司池查无果）** | 金库（超期后那行出现「Write off」）| **CFO** | 四前提：超期 / 该行定性 = 挂起·调查中 / 公司账簿 / ≤ 小额线（AED 100 / USDT 30）；分录与补记同腿；定性挂单号锁定 |
| **认损（客户池查无果，2026-09-05 新增）** | 金库（超期后那行出现「Recognize loss」）| **CFO** | 四前提同核销，账簿 × 成因码换客户池「客户池查无果认损」（`UNEXPLAINED_CLIENT_LOSS`）、只许 REDUCE（托管里少了，多出来的走补录）；分录同核销、客户应付相应减少；定性挂单号锁定；落账后案子 RESOLVED，行上挂「待补款」 |
| **发起补款（客户池认损后，同批）** | 金库（案件页，认损落账后）| **审批中心单步 `CFO`** | 内部划转单（第四类订单）；金额锁定 = 认损额；同一认损单只能有一张未走完 / 已成功的划转单；批准后金库在资金单页 ⚡ 推腿，落账即客户余额复位、行上「待补款」清空 |
| **发起补录（漏记客户入金，2026-09-03 平账 B 批）** | **金库**（`DEPOSIT_SUPPLEMENT_WRITE`，2026-09-08 处置改版迁 `TREASURY_OFFICER`；案件页差异行「Supplement」按钮 → 选「Missed customer deposit」→ 链上填来源地址 / 法币填来源 IBAN）| **审批中心单步 `CFO`**（48h，可撤）| 充值域建入站信号（`SUPPLEMENT_PENDING`）→ 批准即走正常充值通道，KYT / 合规照跑到 SUCCESS；生效日 = 案子业务日，参考号取账单行；拒绝/撤回/超时原状态原样不动、可再次发起 |
| **认领退汇（入金被退汇，同批）** | **金库**（`DEPOSIT_CLAWBACK_WRITE`，2026-09-08 处置改版迁 `TREASURY_OFFICER`；案件页差异行「Supplement」按钮 → 选「Deposit recalled」→ 从候选原充值单里选）| **审批中心单步 `CFO`**（提交、批准各查一次客户可用余额）| 充值单 `SUCCESS → CLAWED_BACK`（新终态）；一笔分录借客户应付 / 贷客户资产；余额不够给『Initiate advance』；不建资金单 |
| **发起垫款（退汇余额不足，2026-09-05 新增）** | 金库（案件页，退汇行余额不足时）| **审批中心单步 `CFO`** | 内部划转单；金额锁定 = 账单行 − 客户可用；法币两腿经结算户；到账后行上「Claim recall」按钮回来，走既有流程 |
| **认领退回（出金被退回，同批）** | **金库**（`WITHDRAW_RETURN_CLAIM_WRITE`，2026-09-08 处置改版迁 `TREASURY_OFFICER`；案件页差异行「Supplement」按钮 → 选「Payout returned by bank」→ 从候选原提现单里选）| **审批中心单步 `CFO`** | 提现单 `SUCCESS → RETURNED`（复用既有终态，加一条边）；重记分录本金加回、手续费不退；不建资金单 |
| 人工核实 / 销案 | — | **未做**（deferred） | 账龄到线标记已做，升级通知不做（无通知中心） |

## 4. 演示脚本（第六幕 · 账对）

1. `recon:demo:pass` → 记分牌全绿——先让观众看到"平"长什么样
2. `recon:demo:break` → 铺 **18 个场景 / 12 张案子**（破口 9 ｜ 抵销 2 ｜ 在途 1；另有已匹配对照组干净钱包不动），**拿着答案键逐个讲**——脚本收尾打印每条的钱包、成因码、预期桶
3. **走查顺序 = 场景号 1→18 = 处置家族顺序**（这是重编号的目的：一路走下来就是把本轮的处置全集演一遍）

| # | 场景 | 落点 | 处置 | 桶 |
|---|---|---|---|---|
| 1 | 在途时序差 | Alice AED | 推单 | 在途 |
| 2 | 小数点错位 | Grace AED（展示位甲）| 冲正 | 破口 |
| 3 | 我方少记 | Grace AED（展示位甲）| 冲正 | 破口 |
| 4 | 舍入精度差 | Grace AED（展示位甲）| 冲正 | 破口 |
| 5 | 手续费轧差 | Bob AED | 冲正 | 破口 |
| 6 | 重复入账 | Frank AED（展示位乙）| 冲销（**唯一有机器线索**的一条）| 破口 |
| 7 | 假信号入账 | Frank AED（展示位乙）| 冲销（纯人判，同格同形状、无线索）| 破口 |
| 8 | 记错客户 | Jack AED ↔ Kate AED | **改记**（一个场景两张案子）| 破口 ×2 |
| 9 | 跨日切 | Grace USDT | 挂起 · 等下期 | 抵销 |
| 10 | 查无果 | 公司池一个钱包 | 挂起·调查中 → 超期 → **核销** | 破口 |
| 11 | 银行杂费 | 公司池一个钱包（与 12 共用）| 补记 | 抵销（与 12 对冲） |
| 12 | 银行利息 | 同 11 | 补记 | 同上 |
| 13 | 漏监听充值 | Bob USDT | 补单 · 充值补录 | 破口 |
| 14 | 入金被退汇 | Kate AED（与场景 8 共案）| 补单 · 退汇认领 | 破口 |
| 15 | 出金被退回 | Grace AED（展示位甲，与场景 2/3/4 共案）| 补单 · 退回认领 | 破口 |
| 16 | 客户池小额查无果 | Alice USDT | 核销 · 认损 → 划转 · 补款 | 破口 |
| 17 | 入金退汇余额不足 | Grace AED（展示位甲，与场景 2/3/4/15 共案）| 划转 · 垫款 → 补单 · 退汇认领 | 破口 |
| 18 | 未授权转出 | Jack USDT-TRON | 登记事故 → 调查 → 定损（联动自动开报送单）→ 报送台起草送签+高管批准+标已提交 → 认损 → 补款 → 结案 | 破口 |

> 公司池那两个落点由脚本按**当轮账本快照动态挑**（anchor-free：`firmHedgedPlan` 取第一个干净的公司钱包、`firmUnexplainedPlan` 取下一个有流水的），**不锚死某个具体公司户**——每次重铺可能换户，讲的时候看脚本当场打印的钱包号。

4. **四条闭环各演一条**：
   - **推单**（场景 1）：资金单详情页推单 → 「Re-reconcile」→ 差额归零、案子自愈
   - **冲正**（场景 5 最干净——Bob AED 只挂这一条）：案件页点那行「**Correction**」按钮 → 选「Bank fee netted」→ 系统推导区只读（方向 / 金额 / 生效日）→ 填查证说明 → **Submit for CFO review**（2026-09-08 处置改版：行上直接按钮 + 一窗到底，取代旧「Record finding」两屏）→ 审批中心批（单步 `CFO`，审批页显示的是后果原话）→「Re-reconcile」→ 案子 Resolved、那行显示「Explained · ADJxxx」
   - **改记**（场景 8）：Jack 那条「我有外无」点「**Reattribute**」按钮 → 系统给出对端候选（同业务日 · 同资产 · 同金额 · 反向孤儿）→ 确认 Kate → 填查证说明 → 一张单送审 → 批准 →「Re-reconcile」→ **两张案子同时 Resolved**
   - **核销**（场景 10）：金库那行点「**Hold · Investigating**」按钮选「Unexplained (exhausted)」→ 金库 ⚡「Fast-forward aging」（2026-09-10 起拨钟与案件处置同归金库一手，不必换账号）→ 一分钟后「Overdue」→ 同一行「**Write off**」→ 锁定视图 → 送审 → CFO 批 →「Re-reconcile」→ Resolved
   - **补单**（场景 13/14/15，2026-09-03 平账 B 批）：案件页点差异行「**Supplement**」按钮，选中三个成因之一 → 弹出对应表单（Record missed deposit / Claim recall / Claim return）→ 金库提交给 CFO 批（2026-09-08 处置改版：开单权归金库，运营退出）→ 业务域自己走完流程（补录走完整充值到 SUCCESS；退汇 / 退回落 `CLAWED_BACK` / `RETURNED`）→「Re-reconcile」，三条对应差异行自愈
   - **事故登记**（场景 18，2026-09-06 平账三期；通报环节 2026-09-26 战役甲波二起改走报送台）：差异行点「**Register incident**」按钮选「Unauthorized outflow」→ 自动跳转事故登记表单（预填）→ 登记 → 事故详情页调查（记录+升级 MLRO）→ 定损（认损 + 需通报，选依据 TIR_K_H）→ **提交联动自动开出一张报送单**（一码一单，72 小时倒计时随之出现）→ 切合规官打开该单起草正文 → 送签 → 切高管审批中心批准（`SIGNED_OFF`）→ 切回合规官标已提交（填对外编号）→ 切回金库回案件页「Recognize loss」开单（金额锁定=定损额，CFO 批落账）→「Re-reconcile」案愈 → 事故页挂载调账单 → 金库「Initiate compensation」（CFO 批，⚡推腿到账）→ 事故页挂载划转单 → 「提结案」（未授权转出走 MLRO→CFO 两步，此时报送单已提交，前置门放行）→ 事故 CLOSED
5. **挂起要专门讲"不粉饰"**：场景 9 定性完案子**仍是红的**——差异确实还在，只是知道了原因、留下了查证记录，这是账实真不符时唯一诚实的呈现。**场景 13/14/15 不一样**（同批）：点「Supplement」按钮后还有对应的补录 / 退汇 / 退回表单可填，走完 CFO 复核 + 业务域执行的整条链路后案子是真能自愈的——挂起是"知道了原因但账不动"，补单是"知道了原因、而且这次真把账动完整了"，两者都不是给一个动作让案子好看，但结局不同
6. **展示位甲/乙是这一幕最值钱的一屏**：甲位（Grace AED）三条金额差、乙位（Frank AED）两条「我有外无」——**同一个格子、同一个形状，原因码菜单一模一样，处置由财务查出来的成因判断决定**。乙位那两条对照尤其鲜明：⑥ 有机器线索（已匹配列表里躺着同参考号同金额的双胞胎），⑦ 形状一模一样但屏幕上什么线索都没有
7. 顺带讲内部恒等预门："对外之前先自证"，`verify:coa` 现场跑一遍全绿

**已知口径**：`recon:demo:break` **18/18 场景 + 12/12 钱包桶全检出**（2026-09-06 平账三期加场景 18 后实测：桶内构成 break 9 / softFlag 2 / inTransit 1）。18 条里我方本轮能自己平掉 **17** 条（按场景数：推单 1 / 冲正 4 / 冲销 2 / 改记 1 / 补记 2 / 核销 1 / 补单 3 / 划转 2 / **事故登记 1**——改记那 1 条场景牵 2 张案子同愈；补单场景 14/15 与划转场景 17 叠在场景 8、2/3/4 已经开着的案子上，那几条差异行本身确认自愈，但所在案子要等同案其它行也处置完才整体 RESOLVED；事故登记场景 18 走完认损+补款两步落账后同样重对账自愈），余 **1** 条（场景 **9**）等外部下一期自然对平，案子长红且**不许粉饰**。

**走查截图（2026-09-02 平账 A 批）**：`../superpowers/plans/artifacts/2026-09-02-A-cases-list-breached.png`（列表超期红标）｜ `../superpowers/plans/artifacts/2026-09-02-A-case-detail-breached.png`（详情超期徽标）｜ `../superpowers/plans/artifacts/2026-09-02-A-case-detail-fastforward-button.png`（⚡按钮可见态）｜ `../superpowers/plans/artifacts/2026-09-02-A-writeoff-locked-view.png`（核销锁定视图）｜ `../superpowers/plans/artifacts/2026-09-02-A-approval-impact.png`（审批页后果原话）｜ `../superpowers/plans/artifacts/2026-09-02-A-case-resolved.png`（案子自愈已解释）｜ `../superpowers/plans/artifacts/2026-09-02-A-scenario9-clickable.png`（场景 9 可点处置）

## 5. 关键技术节点（≤30 行）

- 编排 `clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts → run()`（预门→逐钱包→分桶→开案→快照→自动复核）/`computeInternalIdentity()`（内部恒等预门，与 verify:coa 同式）
- 引擎 `engine/v2/wallet-balance-checker.service.ts → checkBalance()` ｜ `wallet-flow-matcher.service.ts → matchFlows()`（三轮匹配）｜ 纯函数 `bucket-classifier.ts → computeBucket()`（四桶互斥：MATCHED/IN_TRANSIT/COMPENSATING/BREAK）+ `effective-cutoff.ts`（生效日过滤）
- 处置 `disposition/push-order.service.ts → syncPush()/manualPush()/driveToCleared()`（逐步 advance 不直写）｜ `receipt-lookup.service.ts → findUniqueReceipt()`
- 处置·调账（一期，2026-08-28）：`disposition/adjustment-rules.ts`（纯函数：四种分录组合由「账簿 × 方向」定，成因不参与计算；成因闸 `assertReasonAllowed`；边界线守卫 `requiresRelatedOrder`）｜ `disposition/adjustment.service.ts → createDraft()/submit()/onApproved()/onRejected()`（不直写 TB，只调 `AccountingService.executeTransfer`，evidence 必带 `walletRef` + `isExternalCrossing:false`）｜ `disposition/adjustment-approval.service.ts`（四钩子全覆盖，`@OnEvent` 必须显式重标——子类覆盖拿不到基类元数据）｜ `disposition/adjustment.controller.ts`（4 端点：开单 / 提审 / 列表 / 详情）｜ 表 `reconciliation_adjustments`
- 处置·统一注册表（2026-09-08 处置改版 Task 1/2，覆盖旧两层「成因 → 出口」判死机制）：`disposition/cause-registry.ts`（**单一来源**——20 个成因码铺满 6 格 + `OTHER` 兜底、纯常量无 IO；`dispositionsFor(facts)` 出该格**合法处置矩阵**（乙档硬边界：按记账事实过滤，SWAP 等无调账码来源不出冲正 / 冲销按钮）、`causesFor(kind, matchType, book)` 按处置出原因码菜单、`outletOf(kind)` 存储映射；旧 `resolveOutlet`/`menuFor`/`staticOutletLabel`「成因反推出口」三个函数已随 Task 13 退役）｜ `disposition/adjustment-rules.ts`（**单码制**：`ReasonCode` 改与注册表成因码 1:1 直落，旧 8 个折叠码 `DEPOSIT_AMOUNT_CORRECTION`/`DEPOSIT_DUPLICATE_REVERSAL`/`DEPOSIT_SIGNAL_VOID`/`WITHDRAW_AMOUNT_CORRECTION`/`WITHDRAW_VOID_REFUND`/`BANK_INTEREST`/`BANK_CHARGE`/`FIRM_ENTRY_REVERSAL` 已退役，3 个单级专码 `CUSTOMER_REATTRIBUTION`/`UNEXPLAINED_WRITE_OFF`/`UNEXPLAINED_CLIENT_LOSS` 保留；借贷科目**仍只由「账簿 × 方向」定，码不参与算账**不变）；财务手册 `doc-final/reference/recon-cause-handbook.md`、界面菜单、种子答案键 `rootCause`、审计 `causeCode` 四处同码
- 处置·定性与原子开单（一期半 2026-09-01；2026-09-08 处置改版 Task 3 写端翻转）：`disposition/disposition.service.ts → record()`（入参改「成因 + 财务所选处置」，按 `dispositionsFor`/`causesFor` 矩阵校验，矩阵外处置 / 码不配处置显式拒 400，存 `outletOf(disposition)`；upsert 语义：同锚覆盖 + 各记一条审计；`adjustmentNo`/`supplementNo` 非空拒改 400）/`linkAdjustment()`/`linkSupplement()`/`attachIncident()`/`listReattributionCandidates()`｜ 调账 `adjustment.service.ts → createDraft()`、补单 `deposit-workflow.service.ts → initiateSupplement()/initiateClawback()`、`withdraw-workflow.service.ts → initiateReturnClaim()` 三路：行无定性且带 `causeCode`+`findingNote` → **原子落**（先 record 再建单，`RECON_DISPOSITION_RECORDED` + 对应 `_DRAFTED` 两条审计各显式一条 `requestId`，漏一条即被静默去重）｜ `disposition.controller.ts`（3 端点：记定性 / 取改记对端候选 / 取补单候选）｜ 表 `reconciliation_dispositions`（锚 `explainedFlowId` / `explainedExternalLineId`，与调账单同款锚真实证据 id、跨轮稳定，**不锚每轮重建的 `ReconciliationLineItem.id`**）
- 处置·改记（调账单**第四族**）：`adjustment-rules.ts` 成因码 `CUSTOMER_REATTRIBUTION`（`family: 'REATTRIBUTE'`、`directions: []`——**不走 book × direction 语义，分录由族直接定**）｜ `adjustment.service.ts` 第四族 `createDraft` 分支（两案守卫、双锚、同业务日校验、正主方加钱必填原单号）+ `direction` 落 `'REATTRIBUTE'` + 新字段 `toWalletRef`/`toOwnerNo` ｜ 第五种分录组合：借错记方 `CLIENT_PAYABLE` / 贷正主方 `CLIENT_PAYABLE`，**客户资产腿不动**，不新增科目、无资金单
- 账龄（A 批）：workflow/case-aging.service.ts（算截止 / 找候选 / 置标记 / ⚡拨钟（`POST .../simulate-aging-timeout` 返回 201）+ 审计）｜ sweep/case-aging-sweep.service.ts（@Cron 每分钟迪拜时区，到线审计 RECON_CASE_AGING_BREACHED）｜ 常量 disposition/recon-thresholds.constant.ts（3 天 / 小额线两币种）｜ 读面 getCase 行注解 nextStep（`CLIENT_SURPLUS` / `INCIDENT_DEFERRED` / `WRITE_OFF` / `COMPENSATION` / `ADVANCE`——后两码为二期新增，`TRANSFER_DEFERRED` 已退役）｜ 核销 = 调账单第五族 WRITE_OFF（reason UNEXPLAINED_WRITE_OFF，守卫 adjustment.service.assertWriteOffAllowed）｜ 跑批 cutoffAt → 案件页按它重建 ｜ 审计 9 码（+AGING_BREACHED 系统 / +AGING_TIMEOUT_SIMULATED 操作员）
- 前端 `pages/ReconciliationCasesDetailPage.tsx`（2026-09-07 界面收口轮 Task 8 重排，全页英文化：Hero 只留案号 + 徽标（bucket/severity/OVERDUE nD/status）+ `buildCaseConclusion` 一句结论（RESOLVED 态前缀 `Resolved · `、已解释部分单独措辞不与"全额待排查"打架）｜ Account 五字段独立成节（钱包/客户/科目短语标签/资产·账簿/业务日）｜ Case History 三格 `OPENED BY`/`LAST RE-CHECKED`/`AGING`（复观察次数刻意不展示，见 §6）｜ Balance Explained 五格不变｜ Differences 表治横滚：Type/Dir/Amount/Reference/Source/Time/Disposition 七列，外部参考号截断+复制按钮+`title`全文，Source 直显业务单号可点进原单，Disposition 列固定约 250px 1280 视口内不横滚｜ 动作列（2026-09-08 处置改版 Task 7/8/9/10，取代旧「Record finding」两屏入口）：差异行**直接长着处置按钮组**——按读面下发的 `dispositions` 渲染，`Correction`/`Reversal`/`Record entry`/`Reattribute`/`Supplement`/`Register incident`/`Hold · Next period`/`Hold · Investigating`（`DISPOSITION_LABEL`，唯一来源 `cause-registry.ts`）；行已挂单（`adjustmentNo`/`supplementNo` 非空）按钮消失、只留既有 chip（`Explained · ADJxxx` 等词表不变）；账龄到线追加 `Write off`/`Recognize loss`/`Escalate to incident`/`Register shortfall`，事故已定损同款按钮原地覆盖（金额锁定 = 定损额，见 §6）｜ `components/ReconciliationHoldModal.tsx`（Task 7 新建：挂起两种共用一个组件，按 `kind` 切原因单选 + 必填 Investigation note，零账务不送审）｜ `components/ReconciliationAdjustmentCreateModal.tsx`（Task 8/10 改造：冲正/冲销/补记三族新增「按处置进入」模式——原因单选 + 系统推导区只读 + Investigation note + 受控 Customer-facing note、一次提交原子开单；`locked` 锁定视图机制保留给改记对端确认屏与核销 / 认损（`writeOff.source: 'AGING'|'INCIDENT'` 前提清单区按来源切）；旧 8 码 `REASON_META` 行随 Task 13 清除，全表对齐后端单码制注册表）｜ `components/ReconciliationSupplementModal.tsx`（Task 9：单「Supplement」入口按方向出类型，M5 表单区加下限挂起提示）｜ **旧两屏「Record finding」定性弹窗（`ReconciliationDispositionModal.tsx`）已随 Task 13 删除、零残余**｜ `pages/ReconciliationCasesListPage.tsx`（Task 15 治横滚：`table-fixed` + 逐列 truncate，COA 列复用短语标签、First/Last Run 并一列 `RUNxxx-1 → -2`，定性进度列 `已定性/总差异行`，1280×800 视口零横滚；2026-09-08 处置改版 Task 11：Disposition 列尾追加 **⚡ 场景气泡**——`demoScenarios` 非空时渲染，hover 纯 CSS tooltip 列出场景号 + 成因 + 处置，仅模拟模式答案键在场；真实 / pass 轮无徽标）｜ `pages/ReconciliationRunsDetailPage.tsx`（Task 6 重排：判词横幅一句人话 `BREAK — N wallets checked: ...`、Case Flow 三卡压成一条细条 `Opened/Re-observed/Closed` + 跳转链接、快照表 Flows 列废弃缩写改人话短语、Wallet 副行钱包角色码人话）
- **调账单独立菜单**（2026-09-07 界面收口轮 Task 1）：后端 `GET /admin/reconciliation/adjustments` 列表端点（`adjustment.controller.ts`，权限复用 `RECON_CASE_READ`）｜ 前端 `pages/ReconciliationAdjustmentListPage.tsx`（Adjustment No/Case No/Customer/Asset/Reason/Dir/Amount/Status/Effective Date 九列，不暴露 UUID）｜ 路由 `reconciliation/adjustments` 注册在 `:adjustmentNo` 动态段之前；侧栏 Reconciliation 组第四项。菜单闭环：列表 → 点 Adjustment No 进详情 → 点 Case No 直接回案件详情页
- **Demo Compare 页已退役**（2026-09-07 Task 6，业主拍板删，BACKLOG 销账）：`ReconciliationDemoComparePage.tsx`、路由、后端 `GET demo/compare` 端点与孤儿读块全部删除；`recon:demo` 答案键打印不受影响
- **客户流水页与入口**（客户端，2026-09-07 Task 7/10/11）：Overview 资产行尾 History 图标从「打开对账单弹层」改为跳转 `pages/TransactionHistory.tsx?assetId=`（弹层组件与死码一并清除）；读模型复用扩展 `GET /client/portfolio/statement`，按订单聚合、金额最小单位出展示层按 `decimals` 换算；行格式：日期｜描述（主行业务话术+副行仅客户自见单号）｜金额（主行总额+副行费用 `fee x.xx`）｜余额；无下钻。**受控客户词表**（Task 10）：调账/改记客户可见文案由 `REASON_SPECS.customerLabel`/`FAMILY_LABEL` 受控词表提供，前端「Internal Note」输入框（对应后端 `reasonCustomer`）**不会**直通客户面——客户流水固定显示受控标签，自由文本止步于内部审计记录，逐场景实证见 §4 演示脚本证据链
- **没收 / 制裁类 tipping-off 白名单**（Task 6/11 实证）：充值没收/上缴等资金若从未进客户可用余额（钱一直在 `DEPOSIT_SUSPENSE` 暂扣户、账本证据见 `account_flows` 只有 `*_REVERSE_SUSPENSE`/`*_TO_SUSPENSE` 事件，无 `CLIENT_PAYABLE` 腿），客户流水**天然无行**（非兜底文案，是读模型只投影触达 `CLIENT_PAYABLE` 的流水）；口径先例见 `client-web/src/utils/depositStatusView.ts` 头部注释
- 数据 `account_flows`（账本流水投影，分口径）｜ `external_balances`+`external_statement_lines`（外部归一化两表）｜ `reconciliation_run_wallets`（快照表）
- 触发 `sweep/reconciliation-sweep.service.ts → dailyRecon()`（@Cron 迪拜 02:30）；读面 `reconciliation-query.service.ts`（差异行随行下发 **`dispositions`**（2026-09-08 处置改版 Task 5 起取代 `menu`：按 `dispositionsFor` 算出的合法处置分组，组内带该处置在这一格可选的原因码，SUPPLEMENT 按行方向再过滤一层）、`disposition` 定性 / 开单状态（`outletLabel` 由 `KIND_OF_OUTLET` 反查存储 outlet + `DISPOSITION_LABEL` 取代旧 `resolveOutlet` 反推）、`duplicateTwinRef` 双胞胎线索、`decimals`、**`demoRecommended`**（行级 ⚡ 推荐，2026-09-09：按行匹配键 `externalLine.externalRef ?? internalFlow.externalRef` 反查该案所属最近 break 轮 `demoManifest`，取种子成因 `usableIn[0]` 的处置种类，必须同时校验该处置在 `dispositions` 里、该成因在其 `causes` 里才下发；`MISATTRIBUTED_FROM/TO` 同一 rootCause 铺两侧按行实际格取 sibling 码；真实/pass 轮恒不下发）；案件列表下发定性进度 + **`demoScenarios`**（Task 5/11：⚡ 场景气泡数据源，最近一轮带 `demoManifest` 的跑批按 `walletRef` 聚合，业务键投影不带 UUID）——两者前端渲染均加 `useSimulationMode` 门控（关闭即消失，2026-09-09 补齐列表页气泡与详情页行级提示同一开关；`demoRecommended` 命中的处置按钮加环形高亮，命中的成因在 `DispositionFindingModal`/`ReconciliationHoldModal`/`ReconciliationAdjustmentCreateModal` 三处选码层加 ⚡ 前缀标）
- 权限 `rbac.catalog.ts`：`RECON_DISPOSITION_WRITE` **四处齐**（`PermissionGroup` 联合类型 / 端点 `route()` / 权限桶 `recon.act_dispose` / 持有职务）——一期调账单当初只齐两处，结果是「没人能开单、自定义角色 UI 勾不到」。**2026-09-08 处置改版 Task 6**：持有职务由 `OPS_OFFICER` 迁 `TREASURY_OFFICER`（连同 `RECON_RUN_WRITE`/`DEPOSIT_SUPPLEMENT_WRITE`/`DEPOSIT_CLAWBACK_WRITE`/`WITHDRAW_RETURN_CLAIM_WRITE`——处置全线金库开单、CFO 复核，运营退出案件页业务动作，当时只留只读组 `RECON_RUN_READ`/`RECON_CASE_READ`/`RECON_EXTERNAL_BALANCE_READ`）；`INCIDENT_WRITE` 当时未迁、仍双持。**2026-09-10 对账平账两角色定案（业主裁定：对账平账只留金库与 CFO，运营整组清零、不拆组不双持）**：上一轮遗留的只读三组（`RECON_RUN_READ`/`RECON_CASE_READ`/`RECON_EXTERNAL_BALANCE_READ`）连同 `FUNDS_ORDER_ACT`（推单）/`DEMO_CLOCK_WRITE`（拨钟）/`INCIDENT_WRITE`（事故登记，此前双持的那一半也收回）六组整体从 `OPS_OFFICER` 迁 `TREASURY_OFFICER`——运营在对账 / 资金单动作 / 事故域上归零，只留 `FUNDS_ORDER_VIEW` 只读（业主未点名，不动）；此前金库持 `RECON_CASE_READ` 却不持 `RECON_RUN_READ`/`RECON_EXTERNAL_BALANCE_READ`，导致 Runs 记分牌 / External Balances 两页对金库是 403（隐藏缺口），本轮一并补齐，对账侧栏三页全开。改完必须 `db:base:sync`（`VALID_PERMISSION_GROUPS`/角色绑定是落进 `role_permissions` 表的，改完须 `db:base:sync`；若同时改了桶目录 `ACTION_BUCKET_CATALOG` 这类纯内存常量还需**重启后端**）。**⚠️ 2026-09-25 战役甲波一起「事故域运营归零」这句已不再整体成立**——事故域自身十类终盘拆成五族独立经办组（`INCIDENT_WRITE`/`INCIDENT_TECH_WRITE`/`INCIDENT_DATA_WRITE`/`INCIDENT_OPS_WRITE`/`INCIDENT_FIN_WRITE`），运营新持 `INCIDENT_OPS_WRITE`（OPERATIONS 族独占，`ASSET_NONCOMPLIANCE`/`STUCK_TRANSACTION_MAJOR` 两类）——本段"运营归零"专指 2026-09-10 那一轮把 FUNDS 族整体迁金库这件事，不再代表运营在整个事故域上归零，详见 `modules/v1-governance.md` §7
- 处置·补单（B 批，2026-09-03）：`disposition/supplement-evidence.service.ts → SupplementEvidenceService`（三路共用证据与候选原单守卫，`assertClaimable()`/`describeLine()`/`listCandidates()`，对外投影 `SupplementCandidatesView` 不带 UUID，从 `ReconciliationModule` 导出可被业务域复用）｜ `deposit-transactions/deposit-workflow.service.ts → initiateSupplement()/initiateClawback()+executeClawback()`（① 补录建入站信号 `SUPPLEMENT_PENDING`，走既有 `processSignal` 通道；② 退汇提交与批准各查一次客户余额，`SUCCESS → CLAWED_BACK` 新终态、新转账码 `DEPOSIT_CLAWBACK`）｜ `withdraw-transactions/withdraw-workflow.service.ts → initiateReturnClaim()+onReturnAfterSuccess()`（③ 复用 `onBounce()` 的重记分录、跳过费腿分支，`SUCCESS → RETURNED` 加一条边）｜ 三个新审批类型 `DEPOSIT_SUPPLEMENT`/`DEPOSIT_CLAWBACK`/`WITHDRAW_RETURN_CLAIM`，发起角色 2026-09-08 处置改版由 `OPS_OFFICER` 迁 `TREASURY_OFFICER`（Task 6，三路同改互查）、**CFO 单步复核**｜ 十个新审计码（①比②③多一个拒绝码，因为拒绝会改信号的持久状态）｜ 生效日管道：充值单新列 `effectiveDate`（补录才有值，STEP_1/STEP_2 都读它；资金单 CONFIRM 步的同名参数对这条路径其实是死代码——列优先、事件参数只是兜底）；②③分录直接带案子业务日｜ 前端 `ReconciliationSupplementModal.tsx`（三路一个弹层，按 `deferredTarget` 切表单区）
- 处置·划转（二期，2026-09-05）：读面 `disposition/funding-next-step.ts`（`COMPENSATION` / `ADVANCE`）｜ 回单 `reconciliation/simulation/simulated-custodian-statement.service.ts`（腿提交时写模拟托管方对账单）｜ 成因表 21 → 20（`FIRM_TRANSFER_UNTRACKED` 退役）｜ 主体见 `modules/v7-treasury.md`
- 演示 `scripts/recon-demo.ts`（pass/break 两模式，break 按成因铺满全部破口 + manifest 答案键）+ `recon-rerun.ts`
- 留痕（站5-β + 一期半 + A 批，`V8_RECON_AUDIT_ACTIONS` 9 码）：跑批完成 RECON_RUN_COMPLETED（双通道：cron 系统 / 管理员触发记名，主对象=runNo）｜ 立案 RECON_CASE_OPENED ｜ 自愈 RECON_CASE_AUTO_HEALED ｜ 推单 RECON_PUSH_ORDER（同码双证据通道，继承父单旅程号，主对象=资金单号）｜ **定性 RECON_DISPOSITION_RECORDED**（requiredFields `causeCode`+`outlet`，主对象=dispositionNo，子主体带 caseNo + walletNo；2026-09-08 处置改版起 `outlet` 语义改为「财务所选处置」，`causeCode` 照录不变；调账 / 补单 / 事故三路原子落时与对应开单审计码各显式记一条，两码不合并）｜ **开单 RECON_ADJUSTMENT_DRAFTED**（四族通用，requiredFields `reasonCode`+`amount`，主对象=adjustmentNo；销掉「开调账单零审计」那条铁律①缺口）｜ **落账 RECON_ADJUSTMENT_POSTED**（审批通过后一次性记账，requiredFields `reasonCode`+`amount`+`effectiveDate`，主对象=adjustmentNo——本模块唯一记录「钱真的过账了」的一码，继承案件旅程走 I 模式）｜ **`RECON_CASE_AGING_BREACHED`**（系统通道，actor AGING_TIMER，主对象 = caseNo，子主体钱包用 walletNo；metadata `slaDeadline / ageDays / bucket / book / severity`；NONE 模式）｜ **`RECON_AGING_TIMEOUT_SIMULATED`**（操作员通道，⚡拨钟，主对象 = caseNo；metadata previous/new deadline；NONE 模式）——对账件无客户旅程走 NONE 模式，唯推单与落账 INHERIT

## 6. 演示缺口（BACKLOG 有账）

**处置全集十件，本轮全覆盖**：推单 ｜ 冲正 ｜ 冲销 ｜ 补记 ｜ 改记 ｜ 挂起（两子类：等下期 / 调查中，零账务）｜ 核销（公司池，四前提 + CFO 批）｜ 补单（三入口：充值补录 / 退汇认领 / 退回认领，案子上发起、CFO 单步复核、业务域执行，2026-09-03 平账 B 批）｜ **划转**（第四类订单：认损补款 / 退汇垫款，法币两腿经结算户、加密币一腿，2026-09-05 平账二期）｜ **事故登记**（未授权转出出口 / 大额到线升级 / 退汇欠款登记三条对账触发入口，均落 FUNDS 族三类；事故域整体 2026-09-25 战役甲波一已扩至十类终盘、四条结案链，本文对账触发的这三类是十类中的一族，其余七类走事故列表页直接登记，非对账触发，五态生命周期、全程零账务不变，见 `modules/v1-governance.md` §7）：

- **无主入金查不出归属，超期没有退回付款方的出路**：`UNCLAIMED_INFLOW` 格排查不出是客户还是公司的，行业惯例是账龄到期后原路退回付款方，本系统今天没有这个出口，只能停在「挂起·调查中」（BACKLOG 在案）
- **豁免 / 容差不做**（精度一致，decisions 2026-09-02）：本系统与服务商精度一致（AED 2 位 / USDT 6 位），精度尘埃差成因 `PRECISION_DUST` 已从注册表删除；立场一分不差、一分也追
- **超期不发通知**（无通知中心）：账龄到线只标记 + 记审计，不升级通知任何人
- ~~严重度分级跨资产不可比~~（**已解决，波五 T5**）：`computeSeverity(currency, delta)` 改按 `asset.currency` 索引 `SEVERITY_LINES_MINOR`（与小额线同居 `recon-thresholds.constant.ts`，缺币种 fail-fast、不静默兜底）；终值 AED `med=100 / high=10,000`（元）、USDT `med=30 / high=3,000`（元），锚定既有小额线 100 AED ↔ 30 USDT 等值惯例，种子 12 案分布 AED L1/M4/H1、USDT L5/M1/H0，未触发整体下移（销 `BACKLOG:194`）
- **INTERNAL_BREAK 明细未呈现**（`BACKLOG:192` 余项）：内部恒等预门破裂时详情页只给红色专用横幅说明，不逐资产列「资产合计/负债合计/差额」——run 行未持久化 `breaks[]`，要做需加列；此态只在故障（如 TigerBeetle 不可达）时出现、非 18 场景演示内容。**空表危险已除**（波五 T6：写入语义修正+三态呈现，此前 `walletCount=0` 会渲染成「BREAK — 0 wallets checked」+ 全零卡片，看着像干净）；明细呈现待 `breaks[]` 持久化另议
- **改记的两处边界**：① 只支持两侧**同业务日**（跨日改记不做，不同则 400）；② **换主后对正主的合规复核缺口**——本轮放行依据是「记在错记方名下的那张原始充值单 KYT 已经跑过」，换主之后没有对正主重跑 KYT，BACKLOG 在案
- **SWAP 来源行没有冲正 / 冲销出口（A1b 甲，2026-09-08 处置改版拍板）**：`dispositionsFor()` 按内部流水 `sourceType` 过滤，只有 DEPOSIT / WITHDRAW 系来源开放冲正 / 冲销按钮——SWAP 等无调账码来源的差异行**按钮天生不出现**，只剩挂起两种；不是「选了会报错」，是从头就不给选项。「兑换冲正 / 冲销码」记 BACKLOG 在案，不为演示铺不到的场景立码
- **调账 / 改记的客户可见面已落地**（2026-09-07 界面收口轮 Task 11，BACKLOG №290 销账）：客户流水读模型按订单聚合上线，调账（含核销/认损）与改记均对客户可见——主行 `Balance correction · <reasonCustomer 英文话术>`、有关联原单则副行 `Original order <单号>`；**不显示 `ADJxxx` 内部单号、行不可展开下钻**（业主 2026-09-07 裁定取代此前"详情十格"设计，decisions.md 同日条目 3）；改记两侧（错记方 / 正主方）各自可见、互不见对方客户，均可追溯回构成行（读模型内部字段，不进客户面）
- **定性只许覆盖、不许删除**；挂单后锁定
- **外部账单没有真实摄入管道**：演示的"银行对账单"由脚本铸造——讲清这是模拟件
- **复核计数恒为 0**（已知实现限制，注释在案；2026-09-07 界面收口轮 Task 8 起 Case History 三格改用 `OPENED BY`/`LAST RE-CHECKED`/`AGING`，**不再展示该数字**——绕开显示，计数器本身未修，decisions.md 同日条目 6）
