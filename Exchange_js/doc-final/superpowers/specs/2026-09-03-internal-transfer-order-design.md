# 平账二期 · 内部划转单（第四类订单）设计 —— 草稿

- 日期：2026-09-03
- 状态：**草稿，未经业主逐段脑暴**。写它是为了以后另开会话时不用从零摸底：§0 把「已经定了的」和「还没定的」分开列，开工第一件事是把 §0.2 的岔口过一遍（brainstorming 从那里起步，不必重摸代码），拍完板再进 writing-plans
- 承接：`decisions.md` [2026-08-28] 三层职责 / 资金单判据 / 客户侧公司承担无捷径 / 平账分三期；`BACKLOG.md` §G「二期 · 内部划转单」；A 批 spec §3.2 前提 3（客户池核销待二期）；B 批 spec §4「余额不够时」
- 前序批次：一期调账单 → 一期半定性 → A 批账龄核销 → B 批补单三入口（`2026-09-03-recon-supplement-design.md`）

## 0. 事实与岔口

### 0.1 已经定了的（有出处，不翻案）

| # | 事实 | 出处 |
|---|---|---|
| 1 | 订单 = 意图 ｜ 资金单 = 物理转账的镜像 ｜ 账本 = 记账。四类订单：充值 / 提现 / 兑换 / **内部划转**；调账不是订单 | decisions 2026-08-28 |
| 2 | 资金单只在「有在途要追」时诞生；审批、合规这些「钱还没动」的状态只能挂订单层 | decisions 2026-08-28；提现代码注释：合规/审批被拒的单从不产生资金单 |
| 3 | 客户侧「公司承担」没有账面捷径：客户钱包与公司钱包是两组物理钱包，托管里少了 15 只有真放 15 进去才能变回来。完整表达两步：**调账认损**（客户应付 −15，账实相符）+ **内部划转补款**（公司资产 −15、客户应付 +15 复位） | decisions 2026-08-28 |
| 4 | 两个用例合用一条通道、开两个入口：① 公司池内部调度（归集、补头寸、调拨）② 公司补款给客户 | BACKLOG §G 二期条 |
| 5 | 必须是订单不能只有资金单（审批期间无资金单；`FundsOrderService.create` 硬要求父单）；状态机与提现同构；**在途必须有资金单**否则划转期间两个钱包各爆一个假 BREAK | BACKLOG §G 二期条 |
| 6 | 纯资金动作复核人 = CFO（合规驱动的归 MLRO） | 业主 2026-09-03（B 批脑暴） |
| 7 | 公司侧恒等：公司资产 = 运营 + 结算中转 + 三收入户；COA 终盘九码，不预留号段 | `modules/accounting-coa.md`；decisions 2026-08-13 |
| 8 | 钱包级对账：公司钱包内部余额 = 该 walletRef 上权益 / 收入码流水之和（聚合腿 FIRM_ASSET 被丢弃）；在途识别第三轮按钱包的**非终态资金单**认领外部行 | `engine/v2/wallet-balance-checker.service.ts` 头注释；`wallet-flow-matcher.service.ts` 头注释 |
| 9 | 公司钱包角色与科目：`F_OPS → E.FIRM_OPS`（链上 + 法币，兑换对手盘就是它）｜ `F_SET → E.FIRM_SET`（法币结算户）｜ `F_FEE → 三收入户` ｜ `F_LIQ → E.FIRM_LIQ`（**科目已退役、钱包仍在、期望恒 0**） | `wallet-recon-run.service.ts` `COA_BY_ROLE`；`tb-account-codes.constant.ts` 退役名单 |
| 10 | 资金单迁移表四套（CRYPTO/FIAT × IN/OUT），头注释写明 crypto OUT 与 INTERNAL 共用全 5 跳；资金单父键今天只有充值 / 兑换 / 提现三个 | `funds-order-transitions.constant.ts`；`prisma/schema.prisma` FundsOrder |
| 11 | 后续批次已经把三个用例交给这一期：客户池核销（A 批留）、退汇余额不足的公司垫款（B 批留）、事故赔付（三期） | A 批 spec §3.2；B 批 spec §4；BACKLOG 三期条 |

### 0.2 待拍板（开工先过这一节；每条带我的建议）

| # | 岔口 | 选项 | 建议 |
|---|---|---|---|
| F1 | **同池物理搬家怎么记账**（冷热钱包、两个 F_OPS 钱包之间）。TigerBeetle 一笔转账借贷不能是同一账户，而同池两个钱包共用一个科目账户 | 甲 二期只做**跨池**划转（F_SET↔F_OPS、F_FEE→F_OPS），同池搬家缓 ｜ 乙 新增「划转在途」科目当中转（破九码不预留，要 decisions 翻案）｜ 丙 每个物理钱包一个 TB 账户（大改） | **甲**。今天没有冷钱包角色，"冷热调拨"是纸上的；等真有第二个 F_OPS 钱包再议 |
| F2 | **F_LIQ 去留**：钱包在、科目退役、期望 0 | 甲 退役 `F_LIQ` 钱包角色（职能与 F_OPS 重叠：`FIRM_OPS` 的注释本就是「运营 / 流动性(兑换对手盘)」）｜ 乙 让 F_LIQ 钱包挂 FIRM_OPS 码（一码两钱包 → 撞 F1） | **甲**，二期第一个任务；`COA_BY_ROLE`、`system-wallet.util.ts`、种子、钱包页同步删 |
| F3 | **补款给客户走什么账**：是公司履约（两条分录，不过充值合规闸），还是当成一笔「公司付款人的客户充值」走充值域 KYT/合规 | 甲 履约：公司侧缩 + 客户侧涨两条分录，不过 KYT ｜ 乙 走充值域 | **甲**。这不是客户入金，付款人是我们自己；但要在 decisions 写一句「公司补款不走充值合规闸」 |
| F4 | **客户看到什么**：补款到账那一行客户流水显示什么 | 甲 「平台调整入账」+ 划转单号 ｜ 乙 显示原因（认损案号） | **甲**。内部调查信息不外露；余额历史页是账本投影，行会自然出现，只定文案 |
| F5 | **谁发起**：金库（`TREASURY_OFFICER`，已持调账开单权）还是运营（`OPS_OFFICER`，案子上点） | 甲 两个入口同一权限组 `INTERNAL_TRANSFER_WRITE` 归金库，案子上的按钮对运营只读指路 ｜ 乙 运营也持有 | **甲**。动公司的钱是金库的活，maker 金库 ≠ checker CFO，`verify:rbac` S5 守得住 |
| F6 | **大额双签**（CFO + 管理层两步） | 做 / 不做 | **不做**，与 B 批口径一致，一律 CFO 单步 |
| F7 | **执行中要不要计时（SLA）** | 软标 N 天 / 不计时 | **不计时**。卡单由对账在途桶 + 推单（一期已有）暴露与推进 |
| F8 | **演示怎么摆**：归集放哪一幕；补款闭环需要一个客户池小额「查不出」场景，今天破口演示里没有（场景 10 是公司池） | 归集放第三幕（资产与钱包）或第六幕开头；补款闭环放第六幕 | 归集放第六幕开头当「公司池自己的钱怎么动」的铺垫；新增场景 16 客户池小额查不出（B 批把场景 14 搬走后 **Alice USDT 位空出来了**） |

## 1. 定位与边界

**是什么。** 公司自己的钱在两个物理钱包之间移动，或者公司把钱放进某个客户的钱包。它是订单：有意图、有审批、有执行、有资金单跟着在途、有账本分录收口。

**两个入口，一条通道。**
- **池间划转**（财资页「新建划转」）：F_SET → F_OPS 归集、F_FEE → F_OPS 收入归集、F_OPS → F_SET 备付。同资产、同币种、两个公司钱包
- **补款给客户**（案子 / 调账单页「发起补款」）：F_OPS → 某客户钱包。来源三种：客户池认损（A 批解锁，见 §7）、退汇余额不足垫款（B 批）、事故赔付（三期）

**不是什么。** 不是客户间转账（不存在）；不是客户→公司（费用、没收各有其名）；不是换汇（同币种）；不是同池搬家（F1 甲）。

## 2. 主体与状态机

主体 `InternalTransfer`（单号 `ITR` + 日期 + 序号，`generateReferenceNo('ITR')`），字段见附录 A。

| 状态 | 含义 | 出边 |
|---|---|---|
| `DRAFT` 草稿 | 金库填好未提交 | `SUBMIT → PENDING_APPROVAL`；`CANCEL → CANCELLED` |
| `PENDING_APPROVAL` 待审批 | 审批单已开，钱没动、无资金单 | `APPROVE → APPROVED`；`REJECT → REJECTED`；`CANCEL → CANCELLED`（撤回同时撤审批单） |
| `APPROVED` 已批准 | 瞬态，批准回调里立即执行 | `EXECUTE → EXECUTING` |
| `EXECUTING` 执行中 | **资金单在此诞生**，托管 / 银行在搬钱 | `SETTLE → SUCCESS`（资金单 CLEARED）；`FAIL → FAILED`（资金单 FAILED，钱没动） |
| `SUCCESS` / `FAILED` / `REJECTED` / `CANCELLED` | 终态，零出边 | — |

- 迁移表显式，非法跃迁 400；与提现同构（`PENDING_APPROVAL → PAYOUT_PENDING → SUCCESS/RETURNED` 的形状）
- 计时：不设（F7）
- 先账后状态：`SETTLE` 里分录先落，再翻 SUCCESS；分录失败整步失败，状态停在 EXECUTING，由推单 / 重试都不做（禁做清单），演示里 ⚡ 重跑资金单即可

## 3. 审批（maker-checker 正门）

- 审批类型 `INTERNAL_TRANSFER_POST`：主体 `transferNo`，CFO 单步，48h，可撤；`ApprovalHandlerBase` 子类 + workflow `workflow.internal-transfer.decided` 回调（复刻 `DEPOSIT_RETURN` 形状）
- maker 权限组 `INTERNAL_TRANSFER_WRITE`（`TREASURY_OFFICER`）；`scripts/verify-rbac.ts` `MAKER_GROUP_BY_POLICY` 加一行
- 审批单摘要写后果原话：「从结算户划 50,000 AED 到运营户」「向客户 CUS… 补款 15 USDT（认损案 REC…）」
- 拒绝 / 超时 / 撤回：订单进对应终态，无资金单、无分录

## 4. 资金单与在途

**诞生。** 批准回调里：订单 `APPROVED → EXECUTING`，同一事务内建资金单：父键 `internalTransferId`（新列）、`fromWalletId` = 源钱包、`toWalletId` = 目标钱包、`legSeq 1`、方向 `INTERNAL`、资产类型按币种；迁移表沿用 OUT 那套（头注释已写明 INTERNAL 共用）。`directionOf()` 加内部划转父键分支。

**在途。** 执行期间托管 / 银行账单先出源钱包 OUT、后出目标钱包 IN。匹配器第三轮按钱包的非终态资金单认领：**候选查询必须同时按 `fromWalletId` 和 `toWalletId` 取**（今天提现只用 from，充值只用 to；plan 阶段核实这一点，缺就补）→ 两个钱包都落 `IN_TRANSIT` 桶，不开案。资金单参考号在 CONFIRMED 时按既有规则铸，外部行按参考号配。

**结清。** 资金单 `CLEARED` 事件 → workflow `onSettled`：落分录（§5）→ 订单 `SUCCESS`。⚡：复用资金单模拟面板（`advance` 端点，已有），不新开模拟端点。

**失败。** 资金单 `FAILED`（托管拒绝、银行退单）→ 订单 `FAILED`，钱没动、不落分录。执行后被退回（钱出去又回来）不在二期（那是 B 批③的公司版，BACKLOG 一行）。

## 5. 账务（同步直调 `AccountingService`，失败即流程失败）

**池间划转**（一条分录，同币种）：借 源池权益码 / 贷 目标池权益码，`debitWalletRef` = 源钱包、`creditWalletRef` = 目标钱包，金额最小单位，`externalRef` = 资金单参考号，`effectiveDate` = 结清日。例：F_SET → F_OPS 50,000 AED：借 `FIRM_SET` 50,000 / 贷 `FIRM_OPS` 50,000。公司资产总量不变，只是构成变了；恒等式两边同时不动。钱包级：F_SET 钱包 OUT 流水、F_OPS 钱包 IN 流水，各自与账单行按参考号配。新转账码 `INTERNAL_TRANSFER_POOL`（取下一个空号）。

**补款给客户**（两条分录，一个步骤内，任一失败整步失败）：
1. 公司侧缩：借 `FIRM_OPS` / 贷 `FIRM_ASSET`，两腿 walletRef = F_OPS 钱包。公司资产 −X、运营 −X，恒等式仍平；**公司的损失就体现在 FIRM_OPS 减少**，COA 无独立损失科目、不新增
2. 客户侧涨：借 `CLIENT_ASSET` / 贷 `CLIENT_PAYABLE`（该客户），两腿 walletRef = 客户钱包。客户资产 +X、应付 +X

转账码 `INTERNAL_TRANSFER_COMPENSATION_OUT` / `_IN` 两个（或一个码两腿，plan 定）。`TB_CODE_TO_COA` 无新科目。

## 6. 对账互动

- 执行中：两钱包 `IN_TRANSIT`；结清后：按参考号匹配，无破口
- 成因表 `FIRM_TRANSFER_UNTRACKED`（公司调拨已记账、无资金单跟踪）：二期后这种情况"本不该发生"，出口从「留档 · 二期内部划转」改为「挂起 · 调查中」，线索改写「查是谁绕过划转单直接动了钱」
- `UNCLAIMED_INFLOW`（无主入金）线索里「查明是公司 → 补记」不变

## 7. 客户池核销解锁（A 批留下的口子）

A 批把核销锁在公司池（`assertWriteOffAllowed` 前提 3：`case.book = FIRM`），理由是「托管里真少了钱，不能一笔分录了结」。二期打开它，形状按 decisions 2026-08-28 那两步：

1. 案子上「核销」对客户池放行，调账单族仍 `WRITE_OFF`、理由码 `UNEXPLAINED_WRITE_OFF`，分录改为**认损**：借 `CLIENT_PAYABLE`（该客户）/ 贷 `CLIENT_ASSET`，让内部等于外部（客户余额暂时下降）。前提 1/2/4 不变（到线、挂起·调查中、≤ 小额线）
2. 调账单 POSTED 回调里**自动生成一张补款划转单草稿**（F_OPS → 该客户钱包，金额 = 认损额，来源 = 调账单号），金库提交、CFO 批、执行、客户余额复位
3. 案子在步骤 1 后重对账即愈（账实已相符）；补款是对客户的交代，不影响案子

演示口径一句话：「查不出的钱，先让账跟着外面走，再由公司把客户补齐；两步都有单、都有人批」。

## 8. 页面

- 管理台财资：「内部划转」列表 / 详情 / 新建（源钱包、目标钱包、资产、金额、用途枚举 `POOL_REBALANCE` / `FEE_SWEEP` / `CLIENT_COMPENSATION`、说明、关联单号只读）；详情含资金单卡片与分录链接；状态徽标沿用提现配色
- 对账案子详情 / 调账单详情：`CLIENT_COMPENSATION` 来源的「发起补款」按钮（F5 甲：金库可点，运营只读看到草稿状态）；A 批核销弹窗的公司池限制文案改为两池各自的说明
- 审批中心：通用
- 客户端：无新页面；余额历史那一行文案「平台调整入账」（F4 甲）

**截图**：新建划转表单｜待批单｜执行中详情（资金单在途）｜结清详情｜对账在途桶（两钱包 IN_TRANSIT）｜客户池核销 + 补款草稿｜客户端余额历史那一行。

## 9. 审计与权限

- 审计码：`INTERNAL_TRANSFER_DRAFTED` / `_SUBMITTED` / `_APPROVAL_REQUESTED` / `_EXECUTION_STARTED` / `_SETTLED` / `_FAILED` / `_CANCELLED` / `_REJECTED`（domain `TREASURY`，四属性冻结）；补款自动生成草稿走 `_DRAFTED` 且 metadata 带 `adjustmentNo` / `caseNo`；工作流类型 `INTERNAL_TRANSFER`
- 权限组：`INTERNAL_TRANSFER_WRITE`（`TREASURY_OFFICER`）｜ `INTERNAL_TRANSFER_READ`（CFO / 金库 / 运营 / 内审）；四处齐；端点 `POST /admin/internal-transfers`、`POST …/:transferNo/submit`、`…/cancel`、`GET` 列表 / 详情，`route()` 登记 + sync + 重启

## 10. 演示脚本变化

- 第六幕开头加一段「公司池自己的钱怎么动」：新建 F_SET → F_OPS 归集 → CFO 批 → 执行中跑一次对账，两钱包在途不红 → ⚡ 结清 → 再对账，全绿
- 新增破口场景 16：Alice USDT 客户池小额查不出（幽灵 OUT ≤ 30 USDT）→ 定性「查不出」→ ⚡拨钟到线 → 核销（认损）→ 自动补款草稿 → 金库提交 → CFO 批 → ⚡结清 → 客户端看 Alice 余额先降后复位 → 重对账愈
- 花名册：`demo:all` 加 1 笔「内部划转 · 归集成功」（终态断言 30/30）；`recon:demo:break` 16/16、12/12 钱包（Alice USDT 回来）；`baseline.md` 判据同步

## 11. 验收标准（plan 展开为硬闸）

- 随手闸三处；jest 目录：`internal-transfers/`（新）、`funds-orders/`、`reconciliation/`、`approvals/`
- e2e `test/internal-transfer.e2e-spec.ts`：归集全流程（草稿→批→执行中→在途桶→结清→匹配）｜ 补款闭环（认损调账 → 草稿自动生成 → 批 → 客户余额复位）｜ 拒绝路径（拒绝后无资金单无分录；同池两钱包 400；余额不足 400；非金库发起 403）｜ 恒等式在每一步后成立
- 收尾闸：`reset self` → `demo:all` 30/30 → `recon:demo:break` 16/16 → 第六幕走完 → `verify:coa` → `verify:audit` → `verify:rbac`（新策略行）→ 截图
- 变异测试：把「候选按 toWalletId 取」去掉，目标钱包在途桶断言必须红；把补款第二条分录注掉，恒等式断言必须红

## 12. 明确不做

同池搬家 / 冷钱包（F1）｜ 换汇划转 ｜ 客户间转账 ｜ 大额双签（F6）｜ 执行中 SLA（F7）｜ 定时自动归集 ｜ 执行后被退回的公司版（BACKLOG）｜ 幂等 / 重试 / 补偿 / 并发锁 ｜ 通知中心 ｜ 损失科目（FIRM_OPS 减少即损失）

## 13. `decisions.md` 追加草稿（拍板后落）

- [日期] **内部划转二期只做跨池**：同池两钱包共用一个科目账户，TB 借贷不能同账户；同池搬家等真有第二个 F_OPS 钱包再议 ｜ 待业主
- [日期] **F_LIQ 钱包角色退役**：科目 2026-08-13 已退役、期望恒 0、职能与 F_OPS 重叠 ｜ 待业主
- [日期] **公司补款给客户不走充值合规闸**：付款人是公司自己，是履约不是入金；两条分录，公司损失体现为 FIRM_OPS 减少，不设损失科目 ｜ 待业主
- [日期] **客户池核销 = 认损调账 + 补款划转两步**，调账 POSTED 自动生成补款草稿，金库提交、CFO 批 ｜ 承接 2026-08-28

## 附录 A · 数据模型（一个迁移）

| 表 | 改动 |
|---|---|
| `internal_transfers`（新） | `id`、`transferNo @unique`、`purpose`（POOL_REBALANCE / FEE_SWEEP / CLIENT_COMPENSATION）、`assetId`、`amount Decimal`、`fromWalletId`、`toWalletId`、`toCustomerId?`、`status`、`reason`、`sourceAdjustmentNo?`、`sourceCaseNo?`、`sourceIncidentNo?`（三期用，先留列或不留，plan 定）、`createdByUserId`、`approvedAt?`、`settledAt?`、`traceId`、时间戳 |
| `funds_orders` | + `internalTransferId String?` + 关系 + 唯一约束 `[internalTransferId, legSeq, attempt]` |
| `wallets` | F2 甲：删 `F_LIQ` 角色的种子行；枚举值退役（保留定义直到引用清净） |

常量：`TB_TRANSFER_CODES` +2 或 +3；`ApprovalActionTypes` +1、策略 +1；`AuditActions` +8、工作流类型 +1；`PermissionGroup` +2、`route()` +5；`DomainEventNames` 视 workflow 是否需要新事件（建议不需要，资金单事件已够）。

## 附录 B · 交付清单行

任何持久状态变化 ｜ 新增审计动作码 ｜ 新状态 / 新结局（一整套迁移表；计时：不要）｜ 动了钱（同步直调；资金单 1:1；不新增科目；`verify:coa`）｜ 该走 maker-checker ｜ 新增审批策略 ｜ 新增权限组 ｜ 新增 admin 端点 ｜ 新增业务动作（前端入口两个）｜ 新字段到客户面（余额历史一行文案）｜ 涉及金额 ｜ 对外识别（`transferNo`）｜ 改 schema ｜ 改页面或种子（花名册 +1、破口场景 +1）｜ 改了前端（截图七张）｜ 每轮收尾（modules：新篇 `v7-treasury.md` 或并入 `funds-orders.md`，plan 定；accounting-coa §退役 F_LIQ；v8-recon §7 核销解锁；overview；decisions；CHANGELOG；BACKLOG 销 §G 二期条与 A 批 / B 批留下的两行）

不触发：改了交易三域（无）｜ 退役业务动作（F_LIQ 是钱包角色不是动作；若有钱包页入口一并删）
