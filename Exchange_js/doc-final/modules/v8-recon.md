# V8 · 对账（账对不对得上）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-02（平账一期半：成因定性 + 改记 + 14 场景重编号，重铺闸实跑）
> 演示幕次：第六幕「账对」 ｜ 验收：第六幕走查（`demo/script.md`）+ 本篇 §4

## 0. 一句话定位

管**内部账本与外部世界对不对得上**：银行对账单、托管方余额、链上记录归一化进来，与账本**逐物理钱包、逐笔流水 1:1 直比**，差异分桶、开案、处置。

## 1. 业务叙事

最重要的一件事：**对账不对总数，对的是每一个钱包的每一笔。** 总数对得上可能只是错误互相抵消；逐钱包逐笔对上了，才敢说账是真的平。

**每天的节拍。** 迪拜时间凌晨两点半（银行与托管账单入库后），自动对前一天：① **先自检**——内部恒等式预门（客户资产 = 客户负债，自己的账都不平就没资格对外，直接中止并报内部破口）；② **逐钱包比余额**——客户钱包外部余额对客户应付+暂扣，公司钱包 1:1 直比；③ **逐笔配流水**——三轮匹配：同参考号跨钱包互证 → 金额+方向+时间窗模糊配 → **在途识别**（外部有、内部还没落的行，去找非终态资金单认领——"钱在路上"不是差异）。

**差异分五桶，命中即止。** 残差不为零 → **破口**（BREAK，真差异）；残差为零但有在途 → 在途；残差为零但流水有异常 → 软标记；干干净净 → 已匹配。破口开案：**每个钱包同时只有一张打开的案子**，下一轮对账自动复核——好了自动销案，没好继续挂着。

**处置的第一个动作：推单。** 卡在途的资金单推到终点——同步腿由系统在已摄入的对账单里找**唯一回执**（参考号三字段精确优先，钱包+方向+金额+时间窗兜底），人工腿由运营强推但必须附三件套证据；两种推法都**逐步走状态机、不直写账本、不跳步**，并回填生效日。推完重对账，差额归零、案子自愈。

**真差异怎么处置：人先选成因，系统再定出口（2026-09-01 立）。** 公理是**外部资料是权威**——银行对账单、托管方余额说是多少就是多少，**没有「对方错了」这一档**。所以一切不平只有三种性质：我方账**错了** / 我方账**缺了** / **时机没到**。屏幕上看见的只是 6 个格子（三种不平形状 × 客户/公司两个池子），而**成因是表象背后的东西，得财务去查才知道**——21 个成因里只有一个机器认得出（同参考号同金额的重复入账双胞胎），其余全靠人。于是界面不猜：第一屏让人从**该格的成因菜单**里选出查证结论、填必填的查证说明；成因一旦选定，出口由**成因注册表**判死（冲正 / 冲销 / 补记 / 改记 / 挂起 / 留档），不再让人二次选择。**定性本身就是交付物**——即使这条差异这一轮修不了（挂起、留档），"查过了、结论是什么、谁查的"也留在了案子上。

**挂起不粉饰。** 「跨账期下期自平」「查不出、已穷尽调查」这两类的查证结论就是**我方账不动**，零分录；案子照旧红着——差异确实还在，只是知道了原因。留档同理：漏记的客户入金要回充值域把流程补跑一遍，本轮只记结论 + 指路，案子长红。

**单位契约。** 内部一切金额按**最小单位（分）**的整数计，外部账单入库先洗成分，展示时才按资产精度转成元——曾经的假破口就是元、分混算造出来的。

## 2. 状态机

| 主体 | 状态流 |
|---|---|
| 对账轮 Run | 每轮一行：五桶计数 + 开案/复核/销案三元组 + 每钱包快照（快照定格，历史数字不再漂移） |
| 案件 Case | `OPEN → RESOLVED`（自动复核销案已通；人工核实路径未做）；桶别 = 在途 / 软标记 / 破口 |
| 五桶判定 | 纯函数，180 组网格验证互斥——一笔差异只会落一个桶 |
| **调账单 Adjustment**（2026-08-28 新增）| `DRAFT → PENDING_APPROVAL → POSTED / REJECTED`，后两者为终态、不可撤（账本只进不出，开错了只能再开一张反向单）。驳回 / 取消 / 审批超时三种"不落账"结局统一落 `REJECTED` |
| **定性 Disposition**（2026-09-01 新增）| **覆盖式记录，无状态机**（刻意）——同一条差异行（同锚）至多一条有效定性，重定 = 覆盖 + 各记一条审计；**唯一的锁 = 挂单后不可覆盖**（`adjustmentNo` 非空即拒 400）。不计时：查无果的账龄计时是核销的前置，归下一轮 aging |

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 每日对账 | 系统 cron（迪拜 02:30 对 T-1） | — | 内部恒等预门不过直接中止 |
| 一键重对账 | 运营 | 直接执行 | 处置后验证自愈 |
| 推单（同步腿） | 运营 | 系统找唯一回执，找不到宁可不推 | 逐步推进，不直写账 |
| 推单（人工腿） | 运营 | 强推需三件套证据 + 审计 | 人工也留痕 |
| **开调账单（纠错）** | 运营（案件页点某条流水行，表单预填） | **审批中心单步 `OPS_OFFICER`** | 批准即落一笔账本分录；**无资金单、无真实转账、无在途**（判据见 decisions.md 2026-08-28「资金单看有没有在途要追」）。落完点「重对账」→ 差额归零 → 案子自愈 |
| **定性（记查证结论）** | 运营（案件页点某条差异行「处置」，从该格成因菜单里选）| **注册表判出口**——人只选成因，冲正/冲销/补记/改记/挂起/留档由 `cause-registry.ts` 定死 | **成因菜单无兜底档**（「查不出」也是一条正式成因，要求说明里写清查过什么）；查证说明必填；同锚重定 = 覆盖 + 各记一条审计；**挂单后锁定**不可覆盖 |
| **改记（记错客户，换主）** | **金库开单**（`RECON_ADJUSTMENT_WRITE`，从对端候选清单里挑正主方）| **运营复核**（审批中心 `RECON_ADJUSTMENT_POST` 单步 `OPS_OFFICER`，复用既有策略未新增）| **一张单牵两个案件**（错记方 + 正主方各一个锚），**资产腿不动**（钱在托管里一分没动，只是主人记错了）；正主方加钱必填关联原单号；两侧业务日必须相同；**一次重对账两案齐愈** |
| 人工核实 / 销案 / SLA 升级 | — | **未做**（deferred） | 案子止于 OPEN + 自动复核 |

## 4. 演示脚本（第六幕 · 账对）

1. `recon:demo:pass` → 记分牌全绿——先让观众看到"平"长什么样
2. `recon:demo:break` → 铺 **14 个场景 / 11 张案子**（破口 8 ｜ 软标记 2 ｜ 在途 1；另有已匹配对照组干净钱包不动），**拿着答案键逐个讲**——脚本收尾打印每条的钱包、成因码、预期桶
3. **走查顺序 = 场景号 1→14 = 处置家族顺序**（这是重编号的目的：一路走下来就是把本轮的处置全集演一遍）

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
| 9 | 跨日切 | Grace USDT | 挂起 · 等下期 | 软标记 |
| 10 | 查无果 | 公司池一个钱包 | 挂起 · 调查中 | 破口 |
| 11 | 银行杂费 | 公司池一个钱包（与 12 共用）| 补记 | 软标记（与 12 对冲） |
| 12 | 银行利息 | 同 11 | 补记 | 同上 |
| 13 | 漏监听充值 | Bob USDT | 留档 · 补单（下一轮）| 破口 |
| 14 | 退汇 | Alice USDT | 留档 · 补单（下一轮）| 破口 |

> 公司池那两个落点由脚本按**当轮账本快照动态挑**（anchor-free：`firmHedgedPlan` 取第一个干净的公司钱包、`firmUnexplainedPlan` 取下一个有流水的），**不锚死某个具体公司户**——每次重铺可能换户，讲的时候看脚本当场打印的钱包号。

4. **三条闭环各演一条**：
   - **推单**（场景 1）：资金单详情页推单 → 一键重对账 → 差额归零、案子自愈
   - **冲正**（场景 5 最干净——Bob AED 只挂这一条）：案件页点那行「处置」→ 选「银行轧差入账（手续费被扣净额）」→ 填查证说明 → 下一步（**成因回显不可选、方向只读**）→ 提交送审 → 审批中心批（审批页显示的是后果原话）→ 重对账 → 案子 RESOLVED、那行显示「已解释 · ADJxxx」
   - **改记**（场景 8）：Jack 那条「我有外无」选「记错客户——这笔钱是别人的」→ 系统给出对端候选（同业务日 · 同资产 · 同金额 · 反向孤儿）→ 确认 Kate → 一张单送审 → 批准 → 重对账 → **两张案子同时 RESOLVED**
5. **挂起与留档要专门讲"不粉饰"**：场景 9/10 定性完案子**仍是红的**，场景 13/14 也是——差异确实还在，只是知道了原因、留下了查证记录。这不是缺陷，是账实真不符时唯一诚实的呈现
6. **展示位甲/乙是这一幕最值钱的一屏**：甲位（Grace AED）三条金额差、乙位（Frank AED）两条「我有外无」——**同一个格子、同一个形状，成因菜单一模一样，出口由人查出来的成因决定**。乙位那两条对照尤其鲜明：⑥ 有机器线索（已匹配列表里躺着同参考号同金额的双胞胎），⑦ 形状一模一样但屏幕上什么线索都没有
7. 顺带讲内部恒等预门："对外之前先自证"，`verify:coa` 现场跑一遍全绿

**已知口径**：`recon:demo:break` **14/14 场景 + 11/11 钱包桶全检出**。14 条里我方本轮能自己平掉 10 条（按场景数：推单 1 / 冲正 4 / 冲销 2 / 改记 1 / 补记 2——改记那 1 条场景牵 2 张案子同愈，补记那 2 条场景其实挤在同 1 张案子里），余 4 条（场景 9/10/13/14）要么等外部下一期、要么等下一轮的补单入口，案子长红且**不许粉饰**。

## 5. 关键技术节点（≤30 行）

- 编排 `clearing-settle/reconciliation/workflow/wallet-recon-run.service.ts → run()`（预门→逐钱包→分桶→开案→快照→自动复核）/`computeInternalIdentity()`（内部恒等预门，与 verify:coa 同式）
- 引擎 `engine/v2/wallet-balance-checker.service.ts → checkBalance()` ｜ `wallet-flow-matcher.service.ts → matchFlows()`（三轮匹配）｜ 纯函数 `bucket-classifier.ts → computeBucket()`（五桶互斥）+ `effective-cutoff.ts`（生效日过滤）
- 处置 `disposition/push-order.service.ts → syncPush()/manualPush()/driveToCleared()`（逐步 advance 不直写）｜ `receipt-lookup.service.ts → findUniqueReceipt()`
- 处置·调账（一期，2026-08-28）：`disposition/adjustment-rules.ts`（纯函数：四种分录组合由「账簿 × 方向」定，成因不参与计算；成因闸 `assertReasonAllowed`；边界线守卫 `requiresRelatedOrder`）｜ `disposition/adjustment.service.ts → createDraft()/submit()/onApproved()/onRejected()`（不直写 TB，只调 `AccountingService.executeTransfer`，evidence 必带 `walletRef` + `isExternalCrossing:false`）｜ `disposition/adjustment-approval.service.ts`（四钩子全覆盖，`@OnEvent` 必须显式重标——子类覆盖拿不到基类元数据）｜ `disposition/adjustment.controller.ts`（3 端点）｜ 表 `reconciliation_adjustments`
- 处置·定性（一期半，2026-09-01）：`disposition/cause-registry.ts`（**成因注册表单一来源**——21 个成因码铺满 6 格，纯常量无 IO；`menuFor(matchType, book)` 出该格菜单、`resolveOutlet(causeCode, row)` 判出口/族/调账 reason/方向；财务手册 `doc-final/reference/recon-cause-handbook.md`、界面菜单、种子答案键 `rootCause`、审计 `causeCode` 四处同码）｜ `disposition/disposition.service.ts → record()/linkAdjustment()/listReattributionCandidates()`（upsert 语义：同锚覆盖 + 各记一条审计；`adjustmentNo` 非空拒改 400）｜ `disposition/disposition.controller.ts`（2 端点：记定性 / 取改记对端候选）｜ 表 `reconciliation_dispositions`（锚 `explainedFlowId` / `explainedExternalLineId`，与调账单同款锚真实证据 id、跨轮稳定，**不锚每轮重建的 `ReconciliationLineItem.id`**）
- 处置·改记（调账单**第四族**）：`adjustment-rules.ts` 第 8 码 `CUSTOMER_REATTRIBUTION`（`family: 'REATTRIBUTE'`、`directions: []`——**不走 book × direction 语义，分录由族直接定**）｜ `adjustment.service.ts` 第四族 `createDraft` 分支（两案守卫、双锚、同业务日校验、正主方加钱必填原单号）+ `direction` 落 `'REATTRIBUTE'` + 新字段 `toWalletRef`/`toOwnerNo` ｜ 第五种分录组合：借错记方 `CLIENT_PAYABLE` / 贷正主方 `CLIENT_PAYABLE`，**客户资产腿不动**，不新增科目、无资金单
- 前端 `pages/ReconciliationCasesDetailPage.tsx`（动作列六态：空 / 去推单 / 处置 / 已定性·待开单 / 已定性·终态 / 已解释）｜ `components/ReconciliationDispositionModal.tsx`（两屏：成因菜单 + 机器线索 + 必填查证说明 → 按出口分四种第二屏）｜ `components/ReconciliationAdjustmentCreateModal.tsx`（ADJUST 通道锁定视图：成因定死不给下拉、方向只读附推导依据；第四族对端确认视图）｜ `pages/ReconciliationCasesListPage.tsx`（定性进度列 `已定性/总差异行`）
- 数据 `account_flows`（账本流水投影，分口径）｜ `external_balances`+`external_statement_lines`（外部归一化两表）｜ `reconciliation_run_wallets`（快照表）
- 触发 `sweep/reconciliation-sweep.service.ts → dailyRecon()`（@Cron 迪拜 02:30）；读面 `reconciliation-query.service.ts`（差异行随行下发 `menu` 该格成因清单、`disposition` 定性状态、`duplicateTwinRef` 双胞胎线索、`decimals`；列表下发定性进度）
- 权限 `rbac.catalog.ts`：新组 `RECON_DISPOSITION_WRITE` **四处齐**（`PermissionGroup` 联合类型 / 端点 `route()` / 权限桶 `recon.act_dispose` / `OPS_OFFICER` 持有）——一期调账单当初只齐两处，结果是「没人能开单、自定义角色 UI 勾不到」。改完必须 `db:base:sync` **并重启后端**（`VALID_PERMISSION_GROUPS` 是进程启动时读进内存的）
- 演示 `scripts/recon-demo.ts`（pass/break 两模式，break 按成因铺满全部破口 + manifest 答案键）+ `recon-rerun.ts`
- 留痕（站5-β + 一期半，`V8_RECON_AUDIT_ACTIONS` 7 码）：跑批完成 RECON_RUN_COMPLETED（双通道：cron 系统 / 管理员触发记名，主对象=runNo）｜ 立案 RECON_CASE_OPENED ｜ 自愈 RECON_CASE_AUTO_HEALED ｜ 推单 RECON_PUSH_ORDER（同码双证据通道，继承父单旅程号，主对象=资金单号）｜ **定性 RECON_DISPOSITION_RECORDED**（requiredFields `causeCode`+`outlet`，主对象=dispositionNo，子主体带 caseNo + walletNo）｜ **开单 RECON_ADJUSTMENT_DRAFTED**（四族通用，requiredFields `reasonCode`+`amount`，主对象=adjustmentNo；销掉「开调账单零审计」那条铁律①缺口）｜ **落账 RECON_ADJUSTMENT_POSTED**（审批通过后一次性记账，requiredFields `reasonCode`+`amount`+`effectiveDate`，主对象=adjustmentNo——本模块唯一记录「钱真的过账了」的一码，继承案件旅程走 I 模式）——对账件无客户旅程走 NONE 模式，唯推单与落账 INHERIT

## 6. 演示缺口（BACKLOG 有账）

**处置全集十件，本轮覆盖六件**：推单 ｜ 冲正 ｜ 冲销 ｜ 补记 ｜ **改记**（本轮新建）｜ **挂起**（本轮新建，两子类：等下期 / 调查中，零账务）。余下四件按轮排：

- **补单两入口未建**（下一轮）：外面真有钱进出而我方没记的，一律回业务域把流程补跑一遍（进 → 充值域补录、出 → 退汇认领），**不许用调账凭空给客户加钱**（decisions.md 2026-08-28：那等于没跑 KYT、没过合规闸、没有客户单号）。所以场景 13/14 今天只能走到「留档 · 指路」为止，**案子长红——这是账实确实不符，不粉饰**
- **核销 / 豁免 / 容差 / aging 同批下一轮**：核销挂在**查证结果轴**上（查不出 → 挂起·调查中 → 账龄到线 → 小额核销、大额升事故），**没有 aging 就没有核销的触发时机**，先做核销按钮 = 抹差异的后门。场景 10（查无果，铺在公司池）就是为它预埋的素材——公司池核销 = 一笔分录进损益即结案，是核销首演最干净的落点。豁免（查明了但永远修不了，挂永久调节项、不动账）与容差（豁免的事前自动版，低于阈值不开案）同批
- **公司账簿冲销无码**：`FIRM_AMT_OVERBOOKED` / `FIRM_MISBOOKED` 本轮只能留档，下一轮随核销一起定码
- **事故升级三期**：`UNAUTHORIZED_OUTFLOW`（未授权转出）只能留档；事故要的是登记 / 定性 / 升级 MLRO / 通报监管，是治理件不是差异处置。上报留痕（对象 / 时限 / 依据）待三期正式设计时定
- **改记的两处边界**：① 只支持两侧**同业务日**（跨日改记不做，不同则 400）；② **换主后对正主的合规复核缺口**——本轮放行依据是「记在错记方名下的那张原始充值单 KYT 已经跑过」，换主之后没有对正主重跑 KYT，BACKLOG 在案
- **冲正类成因遇 SWAP 流水无 reason 码**：调账 reason 按内部流水 `sourceType` 派生，只有 DEPOSIT / WITHDRAW 有码，SWAP 落留档（演示无此案）
- **调账 / 改记的客户可见面仍缺**：错记方余额下降必须对客户可见，随「客户流水读模型」任务做（BACKLOG 在案，行设计已定稿：错记方减一行、正主方加一行，均可追溯回分录）
- **定性只许覆盖、不许删除**；挂单后锁定
- **五桶命名 `SOFT_FLAG` → `COMPENSATING` 改名债仍在**（BACKLOG）：记分牌上观众看到的桶名与 PRD 对不上
- **人工核实 / 销案 / SLA 升级**仍 deferred：案子止于 OPEN + 自动复核
- **外部账单没有真实摄入管道**：演示的"银行对账单"由脚本铸造——讲清这是模拟件
- **复核计数恒为 0**（已知实现限制，注释在案）；**SUCCESS 后退汇应归对账认领**（承接第五幕话头）未接
