# 平账二期 · 内部划转单（第四类订单）设计

- 日期：2026-09-05（骨架立于 2026-09-03；本日新会话读总纲 + 承接 + 骨架后与业主脑暴展开，全部岔口已拍板，见 §0）
- 性质：**spec，只写细本波**。总纲 `2026-09-03-recon-settlement-waves-outline.md`（本波边界与验收口径以总纲为准，总纲二期行已按本 spec 同步）；三期骨架 `2026-09-03-incident-register-design.md`，本波收尾时**只**往它开头写「承接二期」，不展开
- 前序：一期调账单 → 一期半定性 → A 批账龄核销 → B 批补单三入口（spec / plan 已归档 `archive/`）
- 骨架素材：提交 `313c60a1` 的全文版。本 spec 与之相比两处大改：**砍掉公司池之间的调拨**（备付 / 归集 / 手续费归集，§0 F1）；**法币补款两腿经结算户**（vIBAN 与运营户不能直转，§4）
- 下一步：业主审完本 spec → `writing-plans` 出实施计划（subagent-driven，模型分层按 `CLAUDE.md §6`）

## 承接上一波（B 批）

**实际偏差**（对照 B 批 spec / plan 的字面）：
- Task 4：铁律⑥优先于 plan 的接口字面量——`SupplementCandidate` 去掉 `id`、`listCandidates` 出口投影成 `SupplementCandidatesView`（对外无 caseId/walletId/ownerId/assetId，只留 `externalLineId` 一个表单锚）
- Task 4：真库冒烟逮到真 bug——`reconciliation_cases.book` 实际落库值是 `'CUSTOMER'` 不是 `'CLIENT'`（同目录既有惯例是「`=== 'FIRM'` 才算公司账簿，否则客户」），守卫原写 `!== 'CLIENT'` 对任何真实客户案件都必拒，已改 `=== 'FIRM'`。**二期任何涉及 book 判断的新代码都照此写，不要再写 `'CLIENT'` 比较**
- Task 5：批准分支的实现与 plan 不同——不再预翻 `PENDING_SCAN`，`processSignal` 自己无条件收尾且全程不读 `signal.status`；`dedupeKey` 占死问题（拒绝后客户自助补报被静默吞掉）plan 预期修、控制方裁定本批不修，已登记 `BACKLOG.md` §G
- Task 6：`getNextStatus` 的终态前置守卫会挡住新加的边（`SUCCESS` 本就在终态集里，查表前就被拒），修法是把终态检查挪到查表未命中之后——**二期给提现/充值状态机加新边时先查有没有同款前置守卫**
- Task 7：实现者正确顶掉了 brief「把 SUCCESS 移出零出边终态集」的指令——`WITHDRAW_TERMINAL_STATUSES` 有两个外部读者（材料请求作废监听、在途 notIn 查询），移出会让成功单的材料请求永不作废
- Task 8：Critical——spec 明写「拒绝后可再次发起」，但②③拒绝时清了认领列、①不释放 `supplementOfExternalLineId`；已修（复用被拒的信号行，新增状态边 `SUPPLEMENT_REJECTED → SUPPLEMENT_PENDING`）
- Task 11：plan 的一个事实错——花名册 #16 提现的 900 是毛额，净额 898（费 2），外部穿越的出款腿走净额；已改按净额匹配。**实测数字与 plan 预测不同**：`recon:demo:break` 现为 `scenarios 15/15、wallets 10/10、casesOpened 10/10`（不是 plan 写的 11/11），因为场景 14/15 都叠在已计数的钱包上、没有各开一个新钱包
- Task 12：plan 给的两条变异靶子都指错了位置——① 命中的是 `initiateClawback`（发起时点）不是 `executeClawback`（批准时点，全仓曾经零覆盖，本批已补单测）；② 资金单 CONFIRM 步的 `effectiveDate` 参数对充值补录这条路径其实是死代码，真正生效的是充值单自己的 `effectiveDate` 列（列优先、事件参数只是兜底）

**执行中发现的新事实**：
- `AccountingService.createAccounts()` 写 `tb_account_registry` 时 `bigintToHex()` 不补零，u128 账户 id 十六进制首位为 0 时写出 31 字符行，与已知的「读侧未补零」缺陷同源但根因在写侧——已在测试夹具内规避（未改 `src`），登记 `BACKLOG.md` §G。**二期开新账户（内部划转单同样要走 `createAccounts()`）时会撞上同一个坑**，命中率约 1/16
- 批准时点（`executeClawback`）的余额闸此前全仓零测试覆盖，本批变异测试证实这条闸有真实杀伤力（注掉守卫会真落一笔不该落的反向分录）——二期任何「提交时查一次、执行时再查一次」的双重前置条件都要照此补批准时点的单测，不能只测提交时点
- e2e 与 `demo:all` 存在执行顺序耦合：花名册会给种子客户铺一些非零余额/在途锁定，测试套件若依赖种子客户的可用余额，必须改用测试自建的独立客户（本批「② 退汇」的收口轮已示范这个模式）——二期写自己的 e2e 时直接抄这个先例，别再踩一次
- 走查中撞见的两条真实操作事实（与代码/文档一致性无关，纯粹是"演示会卡在这里"）：补录出来的充值单会撞金额下限门，需要运营多点一次「放行下限挂起」；⚡ 裁决按钮要切 `compliance_lead@fiatx.com`（`ops_officer@`/`cfo@` 都没有 `DEMO_VERDICT_WRITE`）——已写进 `demo/script.md` 第六幕，二期若也有类似的隐藏操作步骤，提前想着写脚本

**二期前提有无变化**：
- `SupplementEvidenceService` 与 `DispositionService` 已从 `ReconciliationModule` 的 `exports` 数组导出（`reconciliation.module.ts:59`：`exports: [WalletReconRunService, CaseAgingService, DispositionService, SupplementEvidenceService]`），二期若要复用这两个服务（如内部划转单也要走证据校验或定性联动），直接 import 即可，不需要再改模块声明
- 生效日管道已通到充值两步：`deposit_transactions.effectiveDate` 新列，`executeDepositAccounting` 的 STEP_1/STEP_2 都优先读它（资金单 CONFIRM 步的同名参数是兜底，充值补录这条路径从不用到兜底分支）——二期内部划转单若也要挂业务日，参考这个「列优先、事件兜底」的模式
- `assertWriteOffAllowed` 仍然锁死公司池（`adjustment.service.ts:129-130`：`book !== 'FIRM'` 即拒，错误文案原文就是「客户池的查无果差异不能一笔核销：托管里真少了钱，要先认损再由公司补款（二期划转）」）——客户池核销继续等二期的认损调账 + 补款两步，B 批未动这道守卫
- Alice USDT 钱包位已真空出：场景 14（入金被退汇）从 Alice USDT 搬到 Kate AED（与场景 8 共案），Alice USDT 不再承载任何 B 批场景，可以给二期新场景 16（客户池小额查不出）用，不需要另开钱包
- `reconciliation_cases.book` 真实值是 `'CUSTOMER'` 不是 `'CLIENT'`（见上「实际偏差」Task 4）——0.1 已定事实第 6 条「纯资金动作复核人 = CFO」不受影响，但二期任何新写的 book 判断代码都要按 `=== 'FIRM'` 写，不要重蹈覆辙

## 0. 拍板记录（2026-09-05 脑暴，不翻案）

| # | 岔口 | 裁定 | 理由 |
|---|---|---|---|
| F1 | 公司池调拨（备付 / 归集 / 同池搬家）做不做 | **不做**，二期只做公司 → 客户两条路 | 结算户是 vIBAN 与运营户之间的过渡户：兑换法币买入腿 运营户 → 结算户 → 客户 vIBAN，卖出腿反过来走一遍，每笔进多少出多少，余额恒零（主栈实测 `FIRM_SET` 6 条流水净 0）；备付 / 归集在本模型里没有触发它的业务，做出来只是"因为订单类型能做"。同池搬家今天没有第二个运营钱包 |
| F1' | 手续费归集（手续费户 → 运营户） | 不做，留 BACKLOG 等报表层 | 账上等于把收入户结转进运营户（期末结转分录），能做；但收入户兼作钱包位置，归集后余额清零，没有报表层时观众读不出本期收入 |
| F2 | F_LIQ 流动性钱包退役 | **不动** | 骨架要退役它的理由是「没有科目、不能当划转端点」；现在不存在自由选端点，它只是一个期望恒零的闲置钱包，不碰 |
| F3 | 补款给客户走什么账 | **履约**：公司侧缩 + 客户侧涨两条分录，不过充值合规闸 | 付款人是公司自己，不是客户入金；公司损失体现为运营户减少，不设损失科目（COA 九码不动） |
| F4 | 客户看到什么 | 账本对账单里显示「平台调整 / 平台补款 / 平台垫付」+ 单号；划转单本身对客户不可见 | 客户真经历过的余额变动必须可见（decisions 2026-08-28 合并三原则）；内部调查信息不外露 |
| F5 | 谁发起 | **金库**（新组 `INTERNAL_TRANSFER_WRITE`）；案子上的按钮对运营只读指路 | 动公司的钱是金库的活；maker 金库 ≠ checker CFO，`verify:rbac` S5 守得住 |
| F6 | 大额双签 | 不做 | 与 B 批口径一致，一律 CFO 单步 |
| F7 | 执行中计时 | 不计时 | 卡单由对账在途桶 + 资金单页暴露；审批有自己的 48h |
| F8 | 演示摆法 | 第六幕开头**不**加公司池段；新增场景 16（Alice USDT，认损 → 补款，加密币一腿）与场景 17（Grace AED，退汇余额不足 → 垫款 → 认领，法币两腿） | 两条物理路线各演一次。Kate 放不下 17：场景 8 改记会把 Jack 的 5000 记到她名下，怎么摆余额都够扣。Grace 的 6500 是她最大一笔入金，后面兑换 + 提现花掉一部分，无论 2/3/4/15 先做后做差额始终为正；花名册不用改 |
| N1 | 认损批完后补款单怎么发起 | **甲：金库在案子上点「发起补款」，表单预填、金额不可改，单号回挂那一行** | 每一步真人开单真人裁决；不设草稿态；与 B 批补单交互同构（定性行旁出按钮 → 带单号徽标）。否决乙（系统自动生成草稿：多一个草稿态、开单人是「系统」要另解释）与丙（认损 + 补款一张单一次批：decisions 2026-08-28 明确调账不是订单，硬塞会让调账单定义糊掉） |
| N2 | 成因「公司调拨已记账、无资金单跟踪」 | **退役**，成因表 21 → 20 | 出口「留档 · 二期内部划转」永远点不通；同格另两条成因（公司收支误记 → 冲销、查不出 → 挂起）已把真实情况分完，时机没到本就归在途桶不进这个格；留着改出口会让一个格子两条成因指向同一出口 |
| N3 | 两条搭车 | **做**：① `AccountingService.createAccounts()` 登记账户号补零 ② 公司注资写进流水凭证 | ① 二期 e2e 建新客户必撞（承接记录已预警），同一 bug 家族的写侧根治，一行 ② 场景 16 会让观众看运营户那一行，今天外部余额页显示负数（注资不在流水里，主栈实测 `FIRM_OPS` 流水净额 AED 49.53 / USDT −571.811），BACKLOG「资本注入少一行流水凭证」早已在案 |

## 1. 定位与边界

**是什么。** 公司把自己的钱放进某个客户的钱包。它是订单（第四类订单，decisions 2026-08-28）：有意图、有审批、有执行、有资金单跟着在途、有账本分录收口。**一个订单类型，两个用途，两条物理路线。**

| 用途 | 什么时候发生 | 金额 | 来源（单上必带） |
|---|---|---|---|
| `CLIENT_COMPENSATION` 认损补款 | 客户池「查不出」的小额短缺到线，认损调账**落账之后**，公司认赔 | = 认损金额，不可改 | 案号 + 认损调账单号 |
| `CLIENT_ADVANCE` 退汇垫款 | 银行扣回一笔入金、客户可用余额不够扣，**退汇认领之前**，公司先垫 | = 账单行金额 − 客户可用余额，不可改 | 案号 + 那条账单行 |

金额不可改是刻意的：补款只能补认损那么多，垫款只能垫差那么多，多一分都是往客户钱包里塞钱，那是绕充值合规闸的口子。

**不是什么。** 不是公司池之间的调拨（F1）；不是客户间转账（不存在）；不是客户 → 公司（没收、手续费、追索各有其名，追索三期）；不是换汇。

## 2. 客户资金短缺：业务叙事

客户的钱在托管方的钱包里，账本记着「欠每个客户多少」。正常时两边相等。**短缺 = 托管里的钱比账本记的少。** 本系统会遇到两种：

**第一种，查不出的短缺（场景 16）。** Alice 充了 3000 USDT。托管方对账单说她钱包只有 2992.5，账上记 3000，差 7.5。财务翻遍凭证找不到原因，定性「查不出（已穷尽调查）」，案子挂着；三天到线。

**第二种，退汇造成的短缺（场景 17 用 Grace 演，这里沿用 B 批的 Kate 数字讲）。** Kate 充了 1200 AED，后来花掉 900，账上剩 300，托管里也是 300。银行这时把那 1200 扣回去，对账单显示 OUT 1200，托管里变成 −900。认领退汇要扣 Kate 1200，她只有 300，B 批在此直接拒（客户资金池不许借方余额）。

此刻账和钱平没平，分三个时点：

| 时点 | 第一种 | 第二种 |
|---|---|---|
| 短缺发生时 | 不平，钱比账少 7.5 | 不平，钱比账少 1200 |
| 只记短缺、不垫钱 | 平了，但 Alice 余额显示 2992.5 | 账上 Kate 会变负 900，系统禁止 |
| 公司垫钱之后 | 平，Alice 回到 3000 | 平，Kate 归零，公司垫了 900 |

两种短缺都要**先让账说真话，再由公司真金白银补进去**，顺序相反：

**认损补款，两张单。**

| 步 | 谁做 | 动作 | 分录 | 结果 |
|---|---|---|---|---|
| 1 | 金库开单、CFO 批 | 认损调账 7.5 | 借 客户应付 Alice / 贷 客户资产池 | 账 2992.5 = 钱 2992.5，重对账案子愈 |
| 2 | 金库发起、CFO 批 | 补款划转 7.5，运营户 → Alice 钱包，真转账 | 公司侧：借 运营户 / 贷 公司资产；客户侧：借 客户资产池 / 贷 客户应付 Alice | Alice 回到 3000，公司运营资金少 7.5 |

不能跳过第一步直接补：跳过的话账本写 3007.5、托管 3000，又不平；或者补进去的钱账上没主，客户资产池和应付对不上。**认损让案子愈，补款是对客户的交代**——案子愈了不等于完事，列表上挂「待补款」直到补款到账。

**退汇垫款，先垫后扣。**

| 步 | 谁做 | 动作 | 分录 | 结果 |
|---|---|---|---|---|
| 1 | 金库发起、CFO 批 | 垫款划转 900，运营户 → Kate 钱包，真转账 | 与补款同一套分录 | Kate 账上 1200，钱也回到 300 |
| 2 | 运营发起、CFO 批 | 认领退汇 1200（B 批既有） | 借 客户应付 Kate / 贷 客户资产池 | Kate 归零，账 0 = 钱 0 |

公司运营资金少了 900，Kate 欠公司 900；账上不设应收科目，三期登记追索。

三期的赔付走同一条路：未授权转出定损后，认损 + 补款就是赔付原语。

## 3. 主体与状态机

主体 `InternalTransfer`（表 `internal_transfers`，单号 `ITR` + 日期 + 6 位随机，`generateReferenceNo('ITR')`），字段见附录 A。**六态六边，不设「已批准」中间态，不设草稿态**：

```
PENDING_APPROVAL 待审批（出生态：金库在案子上提交即送审；无资金单、无分录）
  ├─ CFO 批准 + 运营户余额够 ──→ EXECUTING 执行中（第一腿资金单在此诞生）
  ├─ CFO 批准 + 运营户余额不够 ──→ FAILED（批了也付不出，钱一分没动，reasonCode INSUFFICIENT_FIRM_BALANCE）
  ├─ CFO 拒绝 / 审批超时 ──→ REJECTED
  └─ 金库撤回 ──→ CANCELLED（同时撤审批单）
EXECUTING 执行中
  ├─ 最后一腿已确认、分录落完 ──→ SUCCESS
  └─ 任一腿失败 / 超时 ──→ FAILED（reasonCode LEG_FAILED）
SUCCESS / FAILED / REJECTED / CANCELLED：终态，零出边
```

- 迁移表显式，非法跃迁 400；执行中不许撤回（钱已在路上）
- 计时：不设（F7）
- **先账后状态**：腿确认时分录先落再收口清算再翻状态；分录失败订单停在执行中、腿停在已确认，审计记 `POSTING_FAILED`，不重试（禁做清单）
- **出生守卫（提交时）**：① 补款：来源调账单已 POSTED、族 WRITE_OFF、客户账簿；垫款：那条账单行已定性为退汇（出口 SUPPLEMENT · 退汇认领）且尚未回填补单号、差额 > 0 ② 同一来源已有一张未走完（待批 / 执行中）或已成功的划转单，拒；失败 / 拒绝 / 撤回之后可重发，旧单留档 ③ 运营户该币种余额 ≥ 金额 ④ 出方、中转、入方钱包在提交时解析并落库（运营户按资产的网络取；法币中转结算户；入方 = 案子的钱包，就是客户在该网络的收款行）
- **批准时再查一次余额**，不够落 FAILED——与 B 批退汇「提交查一次、批准查一次」同一纪律，**两个时点都要有单测**（承接记录点名）
- **法币腿 2 失败**：腿 1 已落账，钱真在结算户里，账和钱是一致的；订单落 FAILED，详情写「款项停在结算户，财资人工处理」，不做自动退回（外部故障类，禁做清单）

## 4. 资金单与两条物理路线

**父键。** `funds_orders` 加 `internalTransferId`；`FundsOrderService.create` 的"恰好一个父键"从三种放宽到四种；`directionOf()` 加内部划转父键分支返回 `'INTERNAL'`，`getTransitionMap()` 对非 IN 方向本就落出金那套走法表，不新建表。`FUNDS_ORDER_STATUS_CHANGED` 的 `parent` 负载加 `internalTransferId?`，订阅方加划转工作流（`domain-events.constants.ts` 同步）。

| 路线 | 腿 | 从哪到哪 | 走法（沿用出金表） |
|---|---|---|---|
| 加密币 | 腿 1 | 运营户 TRON 地址 → 客户 C_DEP | CREATED → SUBMITTED → CONFIRMING → CONFIRMED → CLEARED；FAIL / TIMEOUT 旁支 |
| 法币 | 腿 1 | 运营户 IBAN → 结算户 IBAN | CREATED → SUBMITTED → CONFIRMED → CLEARED |
| 法币 | 腿 2 | 结算户 IBAN → 客户 vIBAN | 同上，**腿 1 清算后才诞生** |

**每一步谁做、账上动什么、外面动什么：**

| 步 | 触发 | 订单 | 腿 | 账本 | 外部账单（模拟托管方） | 案子那行 |
|---|---|---|---|---|---|---|
| 提交 | 金库，案子上点 | 待审批 | 无 | 不动 | 不动 | 补款 ITR… · 待 CFO 复核 |
| 批准 | CFO | 执行中 | 腿 1 CREATED | 不动 | 不动 | 补款 ITR… · 执行中 |
| 提交腿 | ⚡ 或托管方 | 执行中 | 腿 1 SUBMITTED | 不动 | **写两行**：出方 OUT、入方 IN，带该腿参考号；两钱包外部余额同步增减 | 在途 |
| 确认腿 | ⚡ 或托管方 | 执行中 | 腿 1 CONFIRMED → CLEARED | **先落账**，同一参考号；法币此刻建腿 2 | 不动 | 在途 |
| 法币腿 2 | 同上两步 | 执行中 → SUCCESS | 腿 2 走完 | 落账 | 写两行 | 已到账 |
| 腿失败 / 超时 | ⚡ 或托管方 | FAILED | 该腿 FAILED / TIMEOUT | 该腿不落账 | 不动 | 补款 ITR… · 失败，按钮回来可重发 |

**参考号**：内部划转腿的参考号在**提交那一步**就铸（链上 = 交易哈希、法币 = 银行参考号，演示铸造值），镜像行与落账用同一个，对账 Pass 1 精确配对。⚡ 面板复用资金单详情页既有的 `advance` 端点，不新开模拟端点。

**模拟托管方回单**是本波唯一的新演示装置（`demo/simulated-externals.md` 登记）：对账域提供一个「记一笔模拟外部移动」的写入口，划转工作流在腿 SUBMITTED 时调用；它写 `external_statement_lines`（source 按网络：TRON → 托管方、AED_ZAND → 银行，与铺场脚本同表同口径；subAccount = 钱包；金额最小单位；externalRef = 腿参考号；dedupKey = `SIM-<资金单号>-<钱包>`）并对当日 `external_balances` 增减收盘（当日无行则以该钱包当刻账本流水余额 ± 本笔建行）。除此之外的所有外部账单仍只由 `recon:demo` 铸。

## 5. 账务（同步直调 `AccountingService`，失败即流程失败）

新转账码三个（`tb-transfer-codes.constant.ts` 「平账·划转（81–83）」段）：

| 腿 | 转账码 | 分录 | 落到哪个钱包（walletRef） | 外部可见 |
|---|---|---|---|---|
| 法币腿 1 | 81 `INTERNAL_TRANSFER_OPS_TO_SET` | 借 `FIRM_OPS` / 贷 `FIRM_SET` X | 借方运营户 IBAN 行，贷方结算户 IBAN 行 | crossing = true |
| 法币腿 2 · 公司侧 | 82 `INTERNAL_TRANSFER_FIRM_OUT` | 借 `FIRM_SET` / 贷 `FIRM_ASSET` X | 两腿都落结算户（照兑换 `SWAP_BUY_SET_TO_ASSET`） | crossing = true |
| 法币腿 2 · 客户侧 | 83 `INTERNAL_TRANSFER_CLIENT_IN` | 借 `CLIENT_ASSET` / 贷 `CLIENT_PAYABLE`（该客户）X | 两腿都落客户 vIBAN 行 | crossing = true |
| 加密币腿 1 · 公司侧 | 82 | 借 `FIRM_OPS` / 贷 `FIRM_ASSET` X | 两腿都落运营户 TRON 行（照 `SWAP_BUY_OPS_TO_ASSET`） | crossing = true |
| 加密币腿 1 · 客户侧 | 83 | 借 `CLIENT_ASSET` / 贷 `CLIENT_PAYABLE` X | 两腿都落客户 C_DEP 行 | crossing = true |

- 每一腿落完，公司侧恒等（公司资产 = 运营 + 结算 + 三收入户）与客户侧恒等（客户资产池 = 应付 + 暂扣）各自平；法币腿 1 落完只是钱换了个公司口袋；公司的损失体现为 `FIRM_OPS` 减少，**不新增科目**
- `sourceType = 'INTERNAL_TRANSFER'`、`sourceNo = transferNo`；`eventCode` 按腿铸，客户侧腿再按用途分 `INTERNAL_TRANSFER_COMPENSATION_IN` / `INTERNAL_TRANSFER_ADVANCE_IN`（客户端对账单靠它显示「平台补款 / 平台垫付」，§11）；`assetCurrency` 必须用 `asset.currency`（USDT-TRON vs USDT 的坑，调账单落账注释已论证过）；`effectiveDate` 不回填，取落账当日
- ownerType 口径照调账单 `onApproved`：`CLIENT_PAYABLE` 按客户 UUID，其余 `'SYSTEM'`
- 客户侧腿是**客户实际经历的余额上升**，必须留在客户对账单里（§11）
- 认损调账（§7）继续走 80 `RECON_ADJUSTMENT`，`isExternalCrossing: false`

## 6. 审批（maker-checker 正门）

- 审批类型 `INTERNAL_TRANSFER_APPROVAL`：主体 `transferNo`（entityRef，铁律⑥），**CFO 单步**，48h，可撤；`ApprovalHandlerBase` 子类派生 `workflow.internal-transfer.decided`（复刻 `DepositClawbackApprovalService` 形状），划转工作流接
- `scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加一行 `INTERNAL_TRANSFER_APPROVAL: 'INTERNAL_TRANSFER_WRITE'`；`V1_APPROVAL_ACTION_TYPES` 加入（与 `RECON_ADJUSTMENT_POST` 同列，审批策略页可见）
- 审批单 `objectSnapshot` 不放任何 UUID：transferNo / purpose / customerNo / amount（元）/ currency / sourceCaseNo / sourceAdjustmentNo 或 externalRef / impact
- 后果原话：补款「向客户 CU… 补款 7.5 USDT（认损单 ADJ…，对账案 REC…）」；垫款「为客户 CU… 垫付 900 AED 退汇差额（对账案 REC…，账单行 …；客户可用 300、退汇 1200）」
- 拒绝 / 超时 → REJECTED；撤回 → CANCELLED；均无资金单、无分录

## 7. 对账互动

**7.1 客户池核销解锁，但只许一个方向。** `assertWriteOffAllowed` 前提③从「公司账簿」改为「公司账簿走 `UNEXPLAINED_WRITE_OFF`；客户账簿走新成因码 `UNEXPLAINED_CLIENT_LOSS`（`REASON_SPECS`：book CLIENT、directions 只有 REDUCE、family WRITE_OFF、customerLabel「平台调整」、internalLabel「客户池查无果认损」）」，其余三把锁不变（超期 / 已定性挂起·调查中且未挂单 / ≤ 小额线，`recon-thresholds.constant.ts` 不动）。分录 = 既有 `resolvePostingLegs('CLIENT','REDUCE')`：借客户应付 / 贷客户资产池，ownerUuid = 案子客户。**托管里多出来的钱不能核销进客户余额**：方向解析为 INCREASE 时 400，文案「客户池多出来的钱查清归属走补录」；读面 `nextStep` 新种类 `CLIENT_SURPLUS` 指路。后果原话带钱包号 / 超期天数 / 查证结论，末尾加「认损后由公司补款」。

**7.2 认损落账后案子自愈，那行还活着。** 认损与其它调账单一样，落账时把它解释的那条差异行标掉（`ExplainedDifferenceService` 既有机制），重对账余额相等、案子 RESOLVED。但「发起补款」挂在已解释的那一行上，**案子 RESOLVED 之后照样能点**——今天的惯例是案子一关就不给任何动作入口，这一点要明写并在读面 / 前端两处放行。读面：对客户账簿、族 WRITE_OFF 且已 POSTED 的调账单，行上给 `nextStep = { kind: 'COMPENSATION', adjustmentNo, amount, customerNo, walletNo }`，直到存在一张未走完或已成功的划转单；行上另给 `transfer: { transferNo, status }` 回挂。

**7.3 退汇余额不足改成指路而不是 400。** 读面对已定性为退汇（出口 SUPPLEMENT · 退汇认领）且未回填补单号的行，算 `shortfall = 账单行金额 − 客户可用余额`（`getCustomerAvailableBalance`，按 currency）；> 0 时 `nextStep = { kind: 'ADVANCE', amount, externalLineId, customerNo }`，前端用它换掉「认领退汇」按钮；垫款到账后 shortfall 归零，按钮换回来，走 B 批原路。`initiateClawback` / `executeClawback` 的余额守卫不动，只把文案里的「待二期公司垫款」改成「先由金库在案子上发起垫款」。

**7.4 钱在路上时对账不红。** 腿一提交，镜像两行已在、账本未动；此时跑对账，引擎在两个钱包上各找到一张非终态资金单（`findNonTerminalByWallet` 已同时按 from / to 取，承接记录核实无需改），落在途桶（琥珀）。腿确认落账后再跑，参考号对上，在途案自愈。

**7.5 铺场脚本和模拟托管方不打架。** `recon:demo` pass / break 两模式都先 `clearWalletDemo` 清空全部外部账单再从账本流水重铸，划转结清后的流水会被一并重铸，不会同一笔两行。代价是一条硬约束：**铺场时不得有在途划转**——`recon-demo.ts` 加前置闸：存在任一非终态内部划转腿即当场报错（与既有 `assertTargetWalletsClean` 同一道闸的扩面）。`baseline.md` 写明。

**7.6 成因表退一条。** `FIRM_TRANSFER_UNTRACKED` 退役（N2）：注册表删条目，`deferredTarget: 'INTERNAL_TRANSFER'` 字面量与读面 `nextStep.kind = 'TRANSFER_DEFERRED'` 一并退役；`cause-registry.spec.ts` 的「21 码」断言改 20；手册 `recon-cause-handbook.md` 删那一节并在成因表版本行注明；菜单自动少一项；答案键本就没用它。

## 8. 页面

| 位置 | 改什么 |
|---|---|
| `ReconciliationCasesDetailPage.tsx` | 客户池行的「超期 · 待二期划转」换成「认损」按钮（走既有核销锁定视图，成因固定为客户池认损）；认损落账后同一行出现「发起补款 X」；退汇行余额不足时「认领退汇」换成「余额不足，发起垫款 X」，到账后换回；金库看到按钮，运营看到只读文字（「待补款」/「余额不足 X，待金库垫款」）；客户池托管里多出来的行显示「多出来的钱查清归属走补录」（`CLIENT_SURPLUS`）；行徽标：待补款 → 补款 ITR… · 待 CFO 复核 → 执行中 → 在途 → 已到账 / 失败；ITR… 可点回划转详情；**案子 RESOLVED 后补款按钮仍可点** |
| `ReconciliationCasesListPage.tsx` | 「待补款」「待垫款」徽标（读面随列表下发计数） |
| 新页 `InternalTransferList.tsx` / `InternalTransferDetail.tsx`，路由 `/admin/treasury/internal-transfers[/:transferNo]`，侧栏 Treasury 组「Internal Transfers」放托管钱包旁 | 列表：单号 / 用途 / 客户 / 币种金额 / 状态 / 来源案号 / 时间；详情：来源案号、来源调账单或账单行、客户、币种金额、用途、状态、审批单回链、资金单卡片（法币两腿）、分录链接；待批时金库可撤回；状态徽标沿用提现配色 |
| `ReconciliationSupplementModal.tsx` 或新建 `InternalTransferInitiateModal.tsx` | 一个弹层两种用途：全部字段预填只读，理由必填 |
| `ApprovalDetailPage.tsx` | `ENTITY_ROUTE_BY_ACTION` 加 `INTERNAL_TRANSFER_APPROVAL → /admin/treasury/internal-transfers/:transferNo` |
| `FundsOrderList.tsx` / 后端 `parentFkWhere` | 父单筛选加「内部划转」；详情父单显示 transferNo |
| 客户端 `DashboardOverview.tsx` 对账单弹层 | 行来源显示映射：`RECON_ADJUSTMENT → 平台调整`；`INTERNAL_TRANSFER` 按对账单行已有的 `eventCode` 分两种：`INTERNAL_TRANSFER_COMPENSATION_IN → 平台补款`、`INTERNAL_TRANSFER_ADVANCE_IN → 平台垫付`（客户侧腿的 eventCode 按用途铸，§5）；其余不动；不加页面 |

**截图八张**（闸⑤）：认损锁定视图 ｜ 发起补款弹层 ｜ 垫款按钮 ｜ 审批页后果原话 ｜ 划转详情资金单在途 ｜ 案件页在途徽标 ｜ 结清后案子愈 ｜ 客户端两行。

## 9. 权限

| 项 | 内容 |
|---|---|
| 新权限组 | `INTERNAL_TRANSFER_WRITE`（发起补款 / 垫款、撤回）归 `TREASURY_OFFICER`；`INTERNAL_TRANSFER_READ`（列表 / 详情）归与「看对账案件」同一批职务（CFO / 金库 / 运营 / 内审 / 高管等，照 `RECON_CASE_READ` 的持有名单） |
| 权限桶 | Treasury 域加两桶：`treasury.view_transfers`「查内部划转」、`treasury.act_client_funding`「发起补款 / 垫款」；**四处齐**：`PermissionGroup` 联合类型 / `route()` / `ACTION_BUCKET_CATALOG` / 职务持有（调账单当初只齐两处的教训） |
| 认损开单 | 复用 `RECON_ADJUSTMENT_WRITE`（金库），不新增 |
| 审批 | `INTERNAL_TRANSFER_APPROVAL` CFO 单步；金库提、CFO 批 |
| ⚡ 推腿 | 运营既有推资金单权，剧本写明切账号 |
| 端点 | `POST /admin/internal-transfers/compensation`（adjustmentNo, reason）｜ `POST /admin/internal-transfers/advance`（caseNo, externalLineId, reason）｜ `POST /admin/internal-transfers/:transferNo/cancel` ｜ `GET /admin/internal-transfers` ｜ `GET /admin/internal-transfers/:transferNo`；`rbac.catalog.ts` `route()` 登记 + `db:base:sync` + **重启后端**；前端权限码镜像同步（`verify:rbac` 双向差集判据） |

两个组名 2026-09-02 曾作为 V7 遗留孤儿组被删，本波重铸，四处齐后不再是孤儿；`overview.md` §4 那段「INTERNAL_TRANSFER_READ/WRITE 零桶零绑定」的过期句子一并改掉。

## 10. 审计（七码，四属性出生即冻结，每条带显式 `requestId`）

主对象一律 `INTERNAL_TRANSFER`（`AuditEntityTypes` 新增）· `transferNo`；子主体：客户（OWNER，customerNo）、对账案（RELATED，caseNo）、认损调账单（RELATED，adjustmentNo，仅补款）。REQUESTED 起划转单自己的旅程（NONE），其余继承该旅程（INHERIT）。

| 码 | 含义 | 通道 | 特有必填 |
|---|---|---|---|
| `INTERNAL_TRANSFER_REQUESTED` | 金库提交补款 / 垫款并送审 | 操作员 | purpose, amount, sourceCaseNo |
| `INTERNAL_TRANSFER_CANCELLED` | 金库撤回待批单 | 操作员 | reason |
| `INTERNAL_TRANSFER_REJECTED` | CFO 拒绝或审批超时 | 系统，因果 approvalNo | approvalNo |
| `INTERNAL_TRANSFER_EXECUTION_STARTED` | 批准通过、余额复核通过、第一腿资金单建立 | 系统，因果 approvalNo | approvalNo, fundsOrderNo |
| `INTERNAL_TRANSFER_LEG_POSTED` | 某腿确认，分录落账并收口清算 | 系统 | legSeq, fundsOrderNo, amount |
| `INTERNAL_TRANSFER_SETTLED` | 最后一腿落账，订单 SUCCESS | 系统 | amount, effectiveDate |
| `INTERNAL_TRANSFER_FAILED` | 失败 | 系统 | reasonCode ∈ INSUFFICIENT_FIRM_BALANCE / LEG_FAILED / POSTING_FAILED |

- 认损复用 `RECON_ADJUSTMENT_DRAFTED` / `RECON_ADJUSTMENT_POSTED`，新成因码进 metadata `reasonCode`
- ⚡ 推腿沿用资金单模拟推进的既有审计，模拟回单写的两行以 metadata 附在那条上
- 新码进封册名册与 `audit-vocabulary-closure.spec.ts` 的家族清单；`verify:audit` 七项恒绿

## 11. 客户可见面（新字段 / 新状态到客户面：当场决定）

- 划转单本身对客户**不可见**：无客户端列表、无通知
- 账本对账单里客户会看到三种行，都是他真经历过的余额变动，**不藏**（decisions 2026-08-28）：认损 −X「平台调整 · ADJ…」；补款 +X「平台补款 · ITR…」；垫款 +X「平台垫付 · ITR…」；退汇 −X 仍显示充值那一行（B 批既有）
- 无 tipping-off 顾虑：成因是「查不出」或「银行退汇」，不涉合规

## 12. 演示（第六幕）

第六幕开头不加公司池段。两个新场景接在 15 之后，处置家族顺序不变（16/17 = 二期家族）：

| # | 场景 | 落点 | 演什么 | 数字 |
|---|---|---|---|---|
| 16 | 客户池小额查不出 → 认损 → 补款 | Alice USDT（B 批搬走场景 14 后空出的位） | 运营定性「查不出」→ ⚡拨钟 → 一分钟后超期 → 切金库「认损」锁定视图 → 提审 → 切 CFO 批 → 「重新对账」RESOLVED、行「已解释 · ADJ…」+「发起补款 7.5 USDT」→ 金库点、提交 → CFO 批 → 切运营 资金单页 ⚡ SUBMIT → 案件页「重新对账」→ Alice USDT 与运营户 TRON 各开一张**在途**案（琥珀不红）→ ⚡ CONFIRMING → ⚡ CONFIRM → 划转 SUCCESS → 「重新对账」两张在途案自愈 → 客户端 Alice 对账单两行：−7.5 平台调整、+7.5 平台补款，余额复位 | 铺场把 Alice USDT 一条外部行改小 7.5 USDT 并压收盘（同场景 10 手法）；7.5 在小额线 30 以内 |
| 17 | 入金被退汇、余额不足 → 垫款 → 认领 | Grace AED（展示位甲，第五行） | 运营对 OUT 6500 那行「处置」→ 选「入金被退汇」→ 提交 → 行显示「余额不足 ≈1700，发起垫款」→ 切金库点、提交 → CFO 批 → 切运营 ⚡ 腿 1（运营户 → 结算户）SUBMIT / CONFIRM → 腿 2（结算户 → Grace vIBAN）SUBMIT / CONFIRM → 划转 SUCCESS → 行「认领退汇」回来 → 运营认领（候选原单唯一命中 6500）→ CFO 批 → CLAWED BACK，Grace AED 归零 → 「重新对账」那行已匹配；整案要看其它行 | 铺场在 Grace AED 加一条 OUT 6500 外部行（同场景 14 手法）；差额 = 6500 − 当刻可用余额，脚本铺场时打印 |

剧本要点：⚡拨钟归运营；认损 / 补款 / 垫款开单归 `treasury@`；批准归 `cfo@`；⚡ 推腿与认领退汇归 `ops_officer@`。**铺场前不得有在途划转**；16/17 与所在案子的重对账在同一天内演，跨日照实讲（次日 cron 会把两侧一起收进去）。演划转在途期间不要去重对账公司池的案子（在途会把同钱包的软标记案暂判为破口，结清即回）。

**判据**：`recon:demo:break` **17/17 场景 + 11/11 钱包桶 + `casesOpened` 11/11**（只多 Alice USDT 一个钱包；Grace AED 已在）；`demo:all` 花名册 **29/29 不变**；`data.md` / `script.md` / `baseline.md` 同步。

## 13. 搭车两条（N3）

1. `accounting.service.ts` `createAccounts()` 登记 registry 时 `bigintToHex(accountId).padStart(32, '0')`——一处改完整类问题连根拔；`recon-supplement.e2e-spec.ts` 夹具里的补零规避随之删除（写侧根治后它是死代码，留着会掩盖回归）；BACKLOG 那条销
2. `seed.business.ts` `seedCapitalInjection` 在 TB 转账之外补写凭证与流水行（`sourceType SEED_CAPITAL`，walletRef = 该币种网络上的运营户行，`isExternalCrossing: true`，externalRef 铸造值）——种子路径直写两表，与账户注册表同款；`recon:demo` 会把这笔当正常穿越流水镜像，pass 仍 PASS，公司钱包候选集合不变；BACKLOG「资本注入少一行流水凭证」销；`accounting-coa.md` §6 那条缺口划掉

## 14. 验收（plan 展开为硬闸）

- 随手闸三处 tsc；jest 目录：`asset-treasury/internal-transfers/`（新）、`funds-orders/`、`clearing-settle/reconciliation/`、`governance/approvals/`、`audit-logging/constants/`；改了前端跑 `test:client`
- e2e `test/recon-internal-transfer.e2e-spec.ts`（真 AppModule 零 mock，夹具照 `recon-aging-write-off.e2e-spec.ts`，**用测试自建的独立客户**，承接记录点名）：
  1. 认损 → 补款（加密币一腿）：客户池超期 + 查不出 → 认损四锁逐条 400 → 认损 POSTED → 重对账 RESOLVED → 发起补款 → CFO 批 → 腿 SUBMIT（镜像两行在）→ 重对账两钱包 IN_TRANSIT → CONFIRM → 落账 → SUCCESS → 重对账自愈 → 客户余额复位
  2. 垫款 → 认领（法币两腿）：退汇行余额不足 → 读面 ADVANCE → 发起垫款 → 批 → 腿 1、腿 2 各走完 → 客户可用余额够 → 认领退汇 → 批 → CLAWED_BACK → 重对账匹配
  3. 拒绝路径：客户池多出来的钱核销 400；同一来源二次发起 400；执行中撤回 400；批准时运营户余额不足 → FAILED 且无资金单无分录；腿失败 → FAILED 且该腿不落账；非金库发起 403
  4. 每一步后两条恒等式成立（`verify:coa` 同式）
- 变异三条：去掉批准时余额检查 → 拒绝路径断言必须红；注掉客户侧分录 → 恒等式断言必须红；铺场时留一张在途划转 → `recon:demo:break` 必须报错
- 收尾闸：`stack.sh reset self` → `demo:all` 29/29 → `recon:demo:break` 17/17 + 11/11 → 第六幕 16、17 走通 → `verify:coa` → `verify:audit` → `verify:rbac`（新策略行 + 前后端权限码差集）→ 截图八张

## 15. 明确不做

公司池调拨（备付 / 归集 / 手续费归集 / 同池搬家 / 冷钱包）｜ 换汇划转 ｜ 客户间转账 ｜ 大额双签 ｜ 执行中 SLA ｜ 定时自动归集 ｜ 法币腿 2 失败后的自动退回 ｜ 追索与应收科目（三期）｜ 幂等 / 重试 / 补偿 / 并发锁 ｜ 通知中心 ｜ 损失科目 ｜ F_LIQ 退役 ｜ 客户端划转单页面

## 16. 文档收口与决策

- `modules/`：新篇 `v7-treasury.md`（V7 财资 · 公司的钱怎么给客户：定位 / 叙事 / 状态机 / 决策点 / 演示 / 技术节点 / 缺口），`overview.md` 模块表 V7 行与路由表挂上；`v8-recon.md` §1 §2 §3 §4 §5 §6（客户池核销解锁、补款 / 垫款出口、场景 16/17、成因 20 码）；`funds-orders.md`（父键四种、INTERNAL 方向、模拟回单）；`accounting-coa.md`（转账码 81–83、注资流水缺口销）；`v4-deposit.md`（退汇余额不足 → 垫款）；`overview.md` §4（权限桶 12 域 56 桶、金库 / CFO 独有动作各加一句、删过期例外句）
- `demo/script.md` 第六幕 16/17 + 注③（切账号）+ 注④（铺场前不得有在途划转）；`demo/data.md`（脚本表 17 场景 / 11 钱包）；`demo/baseline.md`（判据 + e2e 文件清单 +1）；`demo/simulated-externals.md`（模拟托管方回单）
- `reference/recon-cause-handbook.md` 删 `FIRM_TRANSFER_UNTRACKED` 节
- `decisions.md` 本日七条已随本 spec 追加（见 git）
- `BACKLOG.md`：销「二期 · 内部划转单」「退汇认领余额不足」「`createAccounts` 不补零」「资本注入少一行流水凭证」「客户池核销待二期」；加「手续费归集（等报表层）」「法币腿 2 失败款项停在结算户的人工处理」；三期条补「追索 = 垫款反向，客户 → 公司」
- `CHANGELOG.md` 一行；三期骨架开头写「承接二期」（实际偏差 / 新事实 / 前提变化，**只写承接**）；本 spec 与 plan 归档

## 附录 A · 数据模型（一个迁移，无 backfill）

| 表 | 改动 |
|---|---|
| `internal_transfers`（新） | `id`、`transferNo @unique`、`purpose`（CLIENT_COMPENSATION / CLIENT_ADVANCE）、`assetId`、`amount Decimal`（元）、`fromWalletId`、`viaWalletId?`（法币结算户）、`toWalletId`、`customerId`、`customerNo`、`status`、`reason`、`sourceCaseNo`、`sourceAdjustmentNo?`、`sourceExternalLineId?`、`approvalNo?`、`failureReasonCode?`、`failureNote?`、`executedAt?`、`settledAt?`、`traceId`、`createdByUserId`、时间戳；索引 `status` / `sourceCaseNo` / `sourceAdjustmentNo` / `sourceExternalLineId` |
| `funds_orders` | + `internalTransferId String?` + 关系 + 唯一约束 `[internalTransferId, legSeq, attempt]` + 索引 |

常量：`TB_TRANSFER_CODES` +3（81–83）｜ `ApprovalActionTypes` +1、策略 +1 ｜ `AuditActions` +7、`AuditBusinessWorkflowTypes` +1、`AuditEntityTypes` +1 ｜ `PermissionGroup` +2、`route()` +5、桶 +2 ｜ `REASON_SPECS` +1 ｜ `CAUSE_REGISTRY` −1 ｜ `DomainEventNames` 不加事件，只扩 `FUNDS_ORDER_STATUS_CHANGED` 的 `parent` 负载。代码落点 `src/modules/asset-treasury/internal-transfers/`（service / workflow / approval handler / controller / dto / constants）。

## 附录 B · 交付清单命中表（`rules/delivery-checklist.md`）

任何持久状态变化（七码审计 + requestId）｜ 新增审计动作码（7，四属性冻结）｜ 新状态 / 新结局（划转单六态迁移表；计时：不要）｜ 动了钱（同步直调；资金单 1:1；不新增科目；`verify:coa`）｜ 该走 maker-checker（`INTERNAL_TRANSFER_APPROVAL` 走正门）｜ 新增审批策略（`MAKER_GROUP_BY_POLICY` +1）｜ 新增权限组（2，四处齐）｜ 新增 admin 端点（5，登记 + sync + 重启）｜ 新增业务动作（前端入口：认损 / 发起补款 / 发起垫款 / 撤回）｜ 退役业务动作（成因 `FIRM_TRANSFER_UNTRACKED` 菜单项随注册表消失；「待二期划转」文字退役）｜ 改了交易三域（充值域退汇守卫文案；提现 / 兑换无对应）｜ 新字段 / 新状态到客户面（§11 已定）｜ 涉及金额（最小单位存、展示层换算）｜ 对外识别（`transferNo`）｜ 改 schema（一个迁移）｜ 改页面或种子（16/17 场景、注资凭证、`data.md` / `script.md`）｜ 改了前端（截图八张）｜ **本任务是多波中的一波**（承接写进三期骨架开头，不展开）｜ 每轮收尾（§16）

不触发：新事件（无新事件，只扩负载）
