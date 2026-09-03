# 对账破口平账 · B 批：补单三入口（充值补录 / 入金退汇认领 / 出金退回认领）设计

- 日期：2026-09-03
- 承接：`archive/specs/2026-09-01-recon-disposition-conclusion-design.md`（一期半，留档指路）、`archive/specs/2026-09-02-recon-aging-writeoff-design.md`（A 批，账龄 + 核销 + 审批人 CFO）
- 状态：业主 2026-09-03 逐段认可，待 plan
- 总纲：`2026-09-03-recon-settlement-waves-outline.md`（目标 / 波次 / 跨波口径，本 spec 只写细 B 批这一波）

## 承接上一波（A 批，合 main b17758ac，2026-09-03）

按 `rules/delivery-checklist.md` 多波行写在这里，不留在 A 批 spec（已归档）。

**实际偏差。** 范围无偏差：账龄线、公司池核销、审批人改 CFO、公司账簿冲销定码、跨日切修复、三处 tooltip 都按 spec 落地。一处实现口径要记住：审批人从 `checkerRoles` 改 CFO 后，`ApprovalPolicyService` 先读库里 `stepsConfig`，seed 只 upsert `checkerRoles`，所以**改审批人必须 `stack.sh reset`，`db:base:sync` 不够**。

**执行中发现的新事实。**
- `stack.sh reset` 清业务表但**不清 `audit_log_events`**（IAM / 治理表也留着）：main 库上 `verify:audit` 不变量③ 因 3 条历史退役码恒红，只有删库重铺能清，业主未拍板；`verify:rbac` V2·CFO 撞了一张手工挂的待批改角色单 RDM-260903336397。B 批在 worktree 里 `reset self` 不受影响，但合 main 后主栈复核要预期这两条红
- **任何「重新对账」都会把场景 9（跨日切）自愈**：第六幕场景 9 必须排在所有重对账之前；B 批新增的三次重对账演示同样要排在它后面
- 案件号 `REC{日期}-{序}` 同日 reset 重跑会复用，e2e 审计断言按 `recordedAt >= testStartedAt` 圈定（`recon-aging-write-off.e2e-spec.ts` 已是范式）
- main 自带缺陷：制裁冻结充值写 `DEPOSIT_FROZEN` 审计被 INHERIT 合同拒（`deposit-workflow.service.ts` 约 2842 行），终态仍对，已登 BACKLOG，B 批不修
- 环境：worktree 会话的 harness 拒绝复合命令（`a && b`），主树会话不拒；后端跑的是 dist，改完要 `stack.sh up` 重启；`/tmp` 下有两个别人的 1.1G 残留 worktree 目录待业主删

**下一波前提有无变化。** 核销仍锁公司池（`assertWriteOffAllowed` 前提 3），B 批不动它，二期解锁；成因表现 20 码（`PRECISION_DUST` 已删），B 批 +1 = 21；`RECON_ADJUSTMENT_POST` 复核人已是 CFO，B 批三个新审批类型照此；场景 14 仍挂在 Alice USDT，B 批搬去 Kate AED。

## 0. 决策记录（本轮脑暴的结论）

| # | 结论 | 依据 |
|---|---|---|
| 1 | **B 批范围 = 补单三入口、四条路**：① 漏记入金补录（链上 / 法币两种表单）② 入金被退汇认领 ③ 出金被退回认领 | 业主 2026-09-03 拍板；③ 是 BACKLOG「SUCCESS 后退汇无处理」和第五幕结尾「SUCCESS 后退汇归对账认领」那句话头的兑现 |
| 2 | **退汇只有法币**：链上转账最终不可逆，入金退回和出金退回都不存在虚拟币版本；漏记入金链上法币都有 | 行业共识（强）。链上"像退汇"的事已各有其名：区块重组 = 假信号入账（冲销）、广播未确认 = 提现已记未执行（冲销）、对方手动打回 = 新进账（补录） |
| 3 | **法币入金退回只演银行单方面扣回**：对方银行发起撤回、我方同意后主动退款，是我方自己发起的出款、有资金单有在途、对账看不到破口，那是充值域「入账后退回」功能，不属补单 | 行业惯例（中强）：收款行只在自身记错或撤回窗口内单方面冲回 |
| 4 | **复核人口径：合规驱动的动作归 MLRO，纯资金的动作归 CFO**。三条补单路的审批全部 CFO 单步 | 业主 2026-09-03。现有充值/提现域的退回、上缴、解冻都是合规件所以放 MLRO；补单是纯资金件 |
| 5 | **补录也过 CFO**（此前我建议不设，已改口）。行业四眼盯的是「把这笔钱归到这个客户」的判断本身；充值域的 KYT 与合规闸筛的是付款方干不干净，两道门管的不是一件事 | 行业标准（强）：银行未归属进账的手工归属、交易所手工补记均为四眼；业主认可 |
| 6 | **不做分级审批**（小额免批）：一律 CFO | 演示不需要 |
| 7 | **退汇认领前置条件：客户可用余额 ≥ 退汇金额**，提交与批准两个时点各查一次；不够即拒绝，案子照旧红，原因写明「余额不足，待二期公司垫款与三期追索」 | 客户资金池不许出现借方余额；公司垫款 = 二期内部划转，追索/认损 = 三期事故，账上无「客户应收」科目（COA 九码不预留）|
| 8 | **入口摆法甲**：按钮在对账案子上，逻辑与数据归业务域 | 证据（成因、账单行、案号）都在案子上；对账侧只发起调用，业务域自己建单、审批、记账、审计 |
| 9 | **三条硬规矩**：账务生效日一律写案子的业务日；流水参考号一律取那条账单行的参考号；一条账单行只能被补单一次 | 对账第一轮靠参考号精确配，模糊配只看物理时间跨天配不上；生效日回填管道推单那批已留（`effective-cutoff.ts` 第 ③ 支） |
| 10 | **退汇 / 退回不建资金单**，只落账本分录 | decisions 2026-08-28：外部单方面发生、我方事后追认的既成事实只落分录 |

## 1. 定位与边界

**补单是什么。** 外面真有钱进出、我方没记：不许用调账凭空改客户余额（decisions 2026-08-28），必须回业务域把流程真跑一遍或补一个真结局。一期半把这类成因做到「留档 · 指路」为止，案子长红；本批把三个入口开出来，案子能愈。

**四条路一张表。**

| 路 | 成因码（所在格） | 业务域动作 | 订单结局 | 账务 | 案子怎么愈 |
|---|---|---|---|---|---|
| ①a 补录·链上 | `MISSED_DEPOSIT`（外有我无 × 客户，IN） | 充值域凭账单行补喂入站信号 | 新充值单，走完整流程到 SUCCESS | 充值正常两步 | 新充值流水带账单行 txHash，重对账按参考号配上 |
| ①b 补录·法币 | 同上 | 同上，表单要填来源 IBAN | 同上 | 同上 | 参考号换成银行参考号 |
| ② 入金退汇认领 | `BOUNCED_FUNDS`（外有我无 × 客户，OUT） | 充值域认领退汇，指回原充值单 | 原充值单 SUCCESS → **CLAWED_BACK**（新终态） | 客户应付减、客户资产减 | 反向流水带 OUT 行参考号，配上 |
| ③ 出金退回认领 | `PAYOUT_RETURNED`（**新码**，外有我无 × 客户，IN） | 提现域认领退回，指回原提现单 | 原提现单 SUCCESS → **RETURNED**（复用现有终态，加一条边） | 复用现有退汇重记：客户资产加、客户应付加，手续费不退 | 重记流水带 IN 行参考号，配上 |

**不碰的东西。** 对账引擎（匹配器 / 桶分类 / 余额检查）一行不改；调账单不碰；成因表只加一个码、改两个码的出口。

## 2. 共通机制

### 2.1 证据与守卫（三条路共用，服务端判）

补单的证据永远是一条 `external_statement_lines` 行。提交时校验，任一不满足即 400，原因写人话：

1. 该行是**指定案子最新一轮**的差异行，`matchStatus = ORPHAN_EXTERNAL`，钱包与案子一致（`reconciliation_line_items.externalTxId = 该行 id`）
2. 案子 `status = OPEN`，账簿 `CLIENT`
3. 方向与路对应：① IN ｜ ② OUT ｜ ③ IN；币种与钱包资产一致
4. 该行**未被任何一条路认领过**（三张表各一个唯一列，见附录 A）
5. 定性行存在且成因码属于该路（`MISSED_DEPOSIT` / `BOUNCED_FUNDS` / `PAYOUT_RETURNED`），且 `supplementNo` 为空
6. ② 另加：原充值单 SUCCESS、同钱包、金额 = 行金额；客户可用余额 ≥ 行金额（`AccountingService.getCustomerAvailableBalance`，批准时再查一次）
7. ③ 另加：原提现单 SUCCESS、同钱包、净额 = 行金额

**候选原单**（②③ 表单用）：`GET /admin/reconciliation/cases/:caseNo/supplement-candidates?externalLineId=`，返回该行事实（来源 / 金额 / 币种 / 时间 / 参考号 / 银行描述）+ 候选列表（同钱包、SUCCESS、同金额，`createdAt` 倒序，只回业务单号与金额、时间）。对账域横向读充值/提现主数据，只读。

### 2.2 审批（maker-checker 正门）

三个审批类型，形状复刻 `DEPOSIT_RETURN`（`ApprovalHandlerBase` 子类 + workflow 里的 `*.decided` 回调）：

| 类型 | 主体 | 发起权限组（新增） | 复核 | 超时 | 可撤 |
|---|---|---|---|---|---|
| `DEPOSIT_SUPPLEMENT` | 入站信号 `signalNo` | `DEPOSIT_SUPPLEMENT_WRITE` | CFO 单步 | 48h | 是 |
| `DEPOSIT_CLAWBACK` | 充值单 `depositNo` | `DEPOSIT_CLAWBACK_WRITE` | CFO 单步 | 48h | 是 |
| `WITHDRAW_RETURN_CLAIM` | 提现单 `withdrawNo` | `WITHDRAW_RETURN_CLAIM_WRITE` | CFO 单步 | 48h | 是 |

- 三个权限组都归 `OPS_OFFICER`（与 `RECON_DISPOSITION_WRITE` 同持有人：定性的人接着发起补单）；maker ≠ checker 由 `verify:rbac` S5 守着，`scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` **加三行**
- 不复用 `WITHDRAW_BOUNCE_WRITE`：那条路由是「出款中被银行退回」的既有动作，业务含义与「成功后退回认领」不同
- 拒绝 / 超时 / 撤回：原状态原样不动（② 充值单仍 SUCCESS，③ 提现单仍 SUCCESS，① 信号停在 `SUPPLEMENT_REJECTED`），定性行的 `supplementNo` 清空，可再次发起
- 审批页是通用的，不改；审批单摘要里写后果原话（「Kate 的 1200 AED 充值将被退汇，余额相应减少」）

### 2.3 生效日与参考号（让重跑当天对账看得见）

- **生效日**：三条路的账本分录 `effectiveDate` = 案子 `businessDate`。管道：
  - ①：`InboundTransferSignalsService.advanceFundsOrder` 的 CONFIRM 步带 `{ effectiveDate }`（`FundsOrderService.advance` 已支持）；法币资金单出生即 CONFIRMED，`FundsOrderService.create` 的 `funds_order.status.changed` 事件载荷**加 `effectiveDate` 字段**（事件字段，不落资金单表），`onPayinConfirmed` 原样收。充值单新增列 `effectiveDate`（补录才有值），`executeDepositAccounting` 的 STEP_1 / STEP_2 都读它
  - ②③：分录直接带
- **参考号**：① 信号的 `txHash`（链上）/ `referenceNo`（法币）= 账单行 `externalRef`，资金单 CONFIRMED 铸参考号时「已有值不覆盖」；② ③ 分录的 `externalRef` = 账单行 `externalRef`。三条都走匹配器第一轮（参考号相等）
- 演示里的账单行由 `recon:demo` 造，`externalRef` 必有值；真实法币入金行参考号可能为空，那是引擎的模糊匹配课题，本批不碰（§10）

### 2.4 案子怎么愈

不新增任何「解释」索引。执行完成后运营点「重新对账」（现有按钮，按当天日终截止重跑）：新流水与账单行按参考号配上 → 钱包无破口 → `autoHealCases` 关案（`AUTO_HEALED`）。⚠ 第六幕既有提醒仍成立：任何重对账都会把场景 9 收进窗口，场景 9 必须先演。

### 2.5 定性联动

- `ReconciliationDisposition` 新增 `supplementNo String?`，与 `adjustmentNo` 平行：① 申请时写 `signalNo`，执行完成改写为 `depositNo`；② 写 `depositNo`；③ 写 `withdrawNo`
- 写了 `supplementNo` 的定性**锁死不可覆盖**（同调账单规矩，`DispositionService.record` 的既有 400 分支扩一句）；审批被拒 / 撤回 / 超时时清空
- `outlet` 新值 `SUPPLEMENT`；`deferredTarget` 列复用，取值 `SUPPLEMENT_DEPOSIT` / `SUPPLEMENT_BOUNCE` / `SUPPLEMENT_PAYOUT_RETURN`
- 案子详情定性徽标：未发起「已定性 · 漏记客户入金 → 补单 · 充值补录」；已发起「已转补单 → SIG…／DEP…／WDR…（待 CFO 复核 / 已执行）」，单号可点跳详情

### 2.6 审计（铁律①）

每条路三个码（① 多一个拒绝码，共十个），出生即冻结四属性，`assertActionSpec` 校验；每次写带显式 `requestId`；主体是业务单号，案号与定性号进 metadata：

| 路 | 码 | domain | correlationMode | 特有必填 |
|---|---|---|---|---|
| ① | `DEPOSIT_SUPPLEMENT_REQUESTED` / `DEPOSIT_SUPPLEMENT_STARTED` / `DEPOSIT_SUPPLEMENT_REJECTED` / `DEPOSIT_SUPPLEMENTED` | DEPOSIT | `N`（信号无 correlationId，照 `INBOUND_SIGNAL_*`）| STARTED / REJECTED 必填 `approvalNo`；SUPPLEMENTED 必填 `depositNo`。① 拒绝会改信号状态（持久化），所以比 ②③ 多一个拒绝码 |
| ② | `DEPOSIT_CLAWBACK_REQUESTED` / `DEPOSIT_CLAWBACK_STARTED` / `DEPOSIT_CLAWED_BACK` | DEPOSIT | `I`（照 `DEPOSIT_RETURN_*`）| STARTED 必填 `approvalNo` + `causationId`；CLAWED_BACK 必填 `fromStatus` / `toStatus`，`externalLineId` 进 metadata |
| ③ | `WITHDRAW_RETURN_CLAIM_REQUESTED` / `WITHDRAW_RETURN_CLAIM_STARTED` / `WITHDRAW_RETURNED_AFTER_SUCCESS` | WITHDRAW | `I`（照 `WITHDRAW_UNFREEZE_*`）| STARTED 必填 `approvalNo` + `causationId`；RETURNED_AFTER_SUCCESS 必填 `fromStatus` / `toStatus` |

定性行 `supplementNo` 的回写属同一持久化动作，不另立码，REQUESTED 的 metadata 带 `caseNo` / `dispositionNo` / `externalLineId`。`AuditBusinessWorkflowTypes` 加三个：`DEPOSIT_SUPPLEMENT` / `DEPOSIT_CLAWBACK` / `WITHDRAW_RETURN_CLAIM`。

### 2.7 端点（`rbac.catalog.ts` `route()` 登记 + `db:base:sync` + 重启）

| 方法 | 路径 | 权限组 | 说明 |
|---|---|---|---|
| POST | `/deposit-transactions/supplement` | `DEPOSIT_SUPPLEMENT_WRITE` | ① 发起：`{ externalLineId, caseNo, dispositionNo, fromAddress?, fromIban?, reason }` |
| POST | `/deposit-transactions/:depositNo/clawback` | `DEPOSIT_CLAWBACK_WRITE` | ② 发起：`{ externalLineId, caseNo, dispositionNo, reason }` |
| POST | `/withdraw-transactions/:withdrawNo/return-claim` | `WITHDRAW_RETURN_CLAIM_WRITE` | ③ 发起：同上 |
| GET | `/admin/reconciliation/cases/:caseNo/supplement-candidates` | `RECON_CASE_READ` | 行事实 + 候选原单 |

新端点一律业务键，不暴露 UUID（`externalLineId` 是账单行 id，对外不展示，只在表单里作隐藏锚，页面显示参考号）。

## 3. ① 充值补录

**流程。** 案子详情 → 定性行「发起补录」→ 表单：只读证据区 + 链上填来源地址 / 法币填来源 IBAN + 原因；客户与钱包由账单行 `subAccount`（钱包 id）定死，页面显示钱包号与客户号 → 提交 → 充值域建入站信号（状态 `SUPPLEMENT_PENDING`）+ 审批单 → CFO 批 → 信号进正常通道（`processSignal`，`QUICK_DEMO` 模式驱动资金单，CONFIRM 步带生效日）→ 充值单照常：KYT、合规闸、SUCCESS → 定性行 `supplementNo` 改写为 `depositNo` → 重对账自愈。

**信号（主体：入站信号）。**
- 新列：`supplementOfExternalLineId String? @unique`（一行一次）、`supplementReconCaseNo String?`、`supplementRequestedByUserId String?`
- 状态新增两枚：`SUPPLEMENT_PENDING`（申请中）、`SUPPLEMENT_REJECTED`（拒绝 / 撤回 / 超时）；批准即置 `PENDING_SCAN` 走既有通道。信号无显式迁移表，本批也不为它建（三态直写、注释写明边）
- 运营路径**不做**客户端那条 `assertTradingEligibility(customerId,'DEPOSIT')`：那是拦客户「发起」的；钱已经物理进了，该冻该退由充值域自己的闸决定（制裁客户的漏记入金补录后会走到 FROZEN，这才是对的结局）
- 信号 `txHash` / `referenceNo` = 账单行 `externalRef`；`amount` = 行金额；`dedupeKey` 沿用既有构造（钱包 + 参考号），与客户端演示入口天然去重

**充值单。** 新列 `effectiveDate String?`（补录才有值，详情页显示「业务归属日」）；列表与详情带「补录」小标，来源块「补单来源：对账案 REC… · 账单行参考号 …」（经信号回查，`providerTxnId = signal.id` 既有）。客户端看到的是一笔普通充值，无新状态。

## 4. ② 入金退汇认领

**流程。** 案子详情 → 定性行「认领退汇」→ 表单：只读证据区 + 候选原充值单（单选）+ 原因 → 提交（守卫 §2.1 含余额）→ 审批单 → CFO 批（再查余额）→ 充值域执行：先账后状态 → 定性行 `supplementNo = depositNo` → 重对账自愈。

**状态机（主体：充值单）。** 新终态 `CLAWED_BACK`（已退汇），新动作 `CLAWBACK`，迁移表加一条边 `SUCCESS → CLAWED_BACK`，其余状态不许；终态无计时。管理台列表桶：并入 `RETURNED` 桶（`RETURNED_BUCKET_WHERE` 改为 `status IN (RETURNED, CLAWED_BACK)`，桶名文案「已退回 / 已退汇」）。客户面白名单 `CUSTOMER_STATUS_PASSTHROUGH` 加 `CLAWED_BACK`（银行事实，非合规动作，不涉 tipping-off）；`client-web/src/utils/depositStatusView.ts` 加 `CLAWED_BACK` 视图（标签「已退汇」）。

**账务。** 一笔分录：借 `CLIENT_PAYABLE`（该客户）/ 贷 `CLIENT_ASSET`，金额 = 行金额，新转账码 `DEPOSIT_CLAWBACK`（`tb-transfer-codes.constant.ts` 取下一个空号），evidence：`sourceType DEPOSIT`、`sourceNo depositNo`；`eventCode DEPOSIT_CLAWBACK`；`debitWalletRef = creditWalletRef = 客户钱包`；`externalRef = 行参考号`；`effectiveDate = 案子业务日`。同步直调 `AccountingService`，失败即整步失败、状态不推进。不建资金单（§0-10）。

**新列。** `clawbackExternalLineId String? @unique`、`clawbackReconCaseNo String?`。

**客户看到什么。** 充值详情状态「已退汇」；`journal-lines/customer-balance-history` 是账本分录的直接投影，先加后减两行自然出现，不需要改读模型（decisions 2026-08-28「不藏客户经历过的余额变动」自动满足）。

**余额不够时。** 提交或批准任一时点可用余额 < 行金额 → 400 / 审批执行失败，文案「客户可用余额不足以退汇（可用 X，需 Y），待二期公司垫款与三期追索」；案子照旧红；BACKLOG 登记指向二期 / 三期。演示不演这条。

## 5. ③ 出金退回认领

**流程。** 案子详情 → 定性行「认领退回」→ 表单：只读证据区 + 候选原提现单（单选）+ 原因 → 提交 → 审批单 → CFO 批 → 提现域执行 → 定性行 `supplementNo = withdrawNo` → 重对账自愈。

**状态机（主体：提现单）。** 迁移表 `[SUCCESS]` 从 `{}` 改为 `{ RETURN: RETURNED }`，一条边；终态无计时。`RETURNED` 客户端标签已有（`withdrawStatusView.ts`），详情文案补一句「出款后被银行退回，本金已重新记入余额，手续费不退」。

**账务。** 新方法 `WithdrawWorkflowService.onReturnAfterSuccess(withdrawId, { externalLineId, caseNo, reason, effectiveDate, externalRef }, actor)`：复用 `onBounce` 的重记分录（借 `CLIENT_ASSET` / 贷 `CLIENT_PAYABLE`，码 `WITHDRAW_BOUNCE_REENTRY`，金额 = 净额），evidence 的 `externalRef` 与 `effectiveDate` 用传入值；**跳过** `onBounce` 里的费腿分支（SUCCESS 时费腿早已结清，手续费不退，审计 reason 写明）；先账后状态，再走 `updateStatus({ action: RETURN })`。不建资金单。

**新列。** `returnExternalLineId String? @unique`、`returnReconCaseNo String?`。

**与②的镜像关系。** ② 减客户余额有余额前置条件；③ 加客户余额无前置条件。两者都不触发合规复核（§10）。

## 6. 成因表与手册变更清单

`disposition/cause-registry.ts`：
- `CauseSpec.kind` 加 `'SUPPLEMENT'`，配 `supplementTarget: DeferredTarget` 与 `supplementLabel`；`StoredOutlet` 加 `'SUPPLEMENT'`；`DeferredTarget` 加 `'SUPPLEMENT_PAYOUT_RETURN'`
- `MISSED_DEPOSIT`：`kind DEFERRED` → `SUPPLEMENT`，target `SUPPLEMENT_DEPOSIT`，label 「补单 · 充值补录」，加 `requiredDirection: 'IN'`
- `BOUNCED_FUNDS`：→ `SUPPLEMENT`，target `SUPPLEMENT_BOUNCE`，「补单 · 退汇认领」，`requiredDirection: 'OUT'`
- 新码 `PAYOUT_RETURNED`：格 `ORPHAN_EXTERNAL × CLIENT`，label 「提现被银行退回（出款后退汇）」，clue 「外部 IN 与某笔成功提现同额，带原出款关联号」，`SUPPLEMENT` / `SUPPLEMENT_PAYOUT_RETURN`，「补单 · 退回认领」，`requiredDirection: 'IN'`
- `resolveOutlet`：`kind === 'SUPPLEMENT'` → `{ outlet: 'SUPPLEMENT', outletLabel: '补单·…', deferredTarget }`；`requiredDirection` 与 `facts.externalDirection` 不符 → 400「成因与账单行方向不符」
- `staticOutletLabel` / `menuFor` 同步；`cause-registry.spec.ts` 加三条：出口映射、方向拒绝、码总数 21

`reference/recon-cause-handbook.md`：三行改写（出口从「留档」改「补单」，加「怎么演」一句）；来源链接加本 spec。

## 7. 页面

**管理台**
- `ReconciliationCasesDetailPage.tsx`：定性行徽标（§2.5）+ 「发起补录 / 认领退汇 / 认领退回」按钮（成因为三码之一且 `supplementNo` 空时显示）；新建 `ReconciliationSupplementModal.tsx`（三路一个组件，按 `deferredTarget` 切表单区；证据区只读；候选原单来自 §2.1 端点）
- `DepositTransactionDetail.tsx`：状态 `CLAWED_BACK` 文案「已退汇」；「补录」小标与来源块；「业务归属日」
- 充值列表：「补录」小标（列表接口回 `isSupplement` 布尔，源自信号列）
- `WithdrawTransactionDetail.tsx`：`RETURNED` 详情补「出款后退回」来源块（有 `returnExternalLineId` 时）
- `StatusPill.tsx`：`CLAWED_BACK` 配色同 `RETURNED`
- 审批中心：通用，不改；审批单摘要文案由后端 `summary` 给

**客户端**
- `depositStatusView.ts`：`CLAWED_BACK` → 「已退汇」，说明「银行已撤回这笔入账，余额相应减少」
- 提现 `RETURNED` 标签已有，不改
- 余额历史页无改动（账本投影）

**截图清单（收尾闸 ⑤）**：案子详情补单按钮与表单（三路各一）｜ 审批中心待批单 ｜ 充值详情「已退汇」｜ 提现详情「已退回」来源块 ｜ 客户端充值详情「已退汇」｜ 重对账后案子 AUTO_HEALED。

## 8. 演示脚本变化（第六幕）

**场景搬家与新增（`scripts/recon-demo.ts`）**
- 场景 13 不动：Bob USDT-TRON，演链上补录（`txHash` = 幽灵行参考号）
- 场景 14 搬到 **Kate AED**（与场景 8 改记接收端叠同一钱包，`scenarioIds: [8, 14]`）：幽灵 OUT 行 1200 AED（最小单位 `120000`），`externalRef = refFor('AED','CLAWBACK')`，`description = 'Demo bank return — a previously credited deposit was clawed back'`；种子时断言 Kate 存在 SUCCESS 的 1200 AED 充值（花名册 #28），不存在即 throw
- 新场景 15 在 **Grace AED**（展示位甲，`scenarioIds: [2, 3, 4, 15]`）：幽灵 IN 行 900 AED（`90000`），`externalRef = refFor('AED','PAYOUTRET')`，`channelRef = 原提现资金单号`，`description = 'Demo bank return — a completed payout bounced back'`，`rootCause: 'PAYOUT_RETURNED'`；断言 Grace 存在 SUCCESS 的 900 AED 提现（#16）
- 收盘调整：Kate 压低 1200，Grace 抬高 900；桶预期不变（都是 BREAK）；manifest 15/15、钱包 11/11
- 方向不会误配：Kate 幽灵 OUT 对内部 IN、Grace 幽灵 IN 对内部 OUT，模糊匹配按方向先筛

**`demo/script.md` 第六幕**：13 / 14 两行改写为「选成因 → 发起补单 → 审批中心 CFO 批 → 业务域执行 → 回案子看『已转补单』」，新加第 15 行（Grace AED 案第四行）；末尾加一步「三笔补单批完后点一次『重新对账』，三案 AUTO_HEALED；长红只剩公司池那张和场景 9（若还没演）」。第五幕结尾那句「SUCCESS 后退汇归对账认领」改为「见第六幕场景 15」。`demo/data.md` 场景表 14 行改、15 行加；`demo/baseline.md` 判据 15/15。

**顺序提醒**：场景 9 先演；种子在 UTC 18:00 前铺。

## 9. 验收标准（实现期展开为 plan 硬闸）

- 随手闸 ①②③ 全绿；jest 只跑 `reconciliation/` `deposit-transactions/` `withdraw-transactions/` `funds-orders/` `approvals/`，判据全绿；`npm run test:client`（改了 depositStatusView）
- e2e `test/recon-supplement.e2e-spec.ts`（沿用 `recon-aging-write-off.e2e-spec.ts` 的三要素跑法与 `recordedAt >= testStartedAt` 圈定）：
  1. ①a 链上：造案 → 定性 `MISSED_DEPOSIT` → 发起 → 信号 `SUPPLEMENT_PENDING` → CFO 批 → 充值单 SUCCESS，STEP_1 流水 `effectiveDate = 案子业务日`、`externalRef = 行参考号` → 重跑 → 案子 `AUTO_HEALED`
  2. ①b 法币：同上，走 `referenceNo` / `fromIban`
  3. ②：定性 `BOUNCED_FUNDS` → 发起（候选含原单）→ 批 → 充值单 `CLAWED_BACK`，分录借应付贷资产，客户余额减 → 重跑愈
  4. ③：定性 `PAYOUT_RETURNED` → 发起 → 批 → 提现单 `RETURNED`，重记分录，客户余额加 → 重跑愈
  5. 拒绝路径：同一行二次发起 400；② 余额不足 400；成因与方向不符 400；CFO 拒绝后原状态不动、`supplementNo` 清空、可再发起
  6. 审计：每条路三个码各至少一条，主体为业务单号，metadata 带 `caseNo`
- 收尾闸：`reset self` → `demo:all` 29/29 + COA 5/5 → `recon:demo:break` **15/15、11/11** → 按第六幕走完三笔补单 + 重对账 → `verify:coa` → `verify:audit` → `verify:rbac`（新三行策略）→ 截图清单 §7
- 变异测试（终审）：把 ② 的余额前置条件注掉，e2e 第 5 条必须红；把 `effectiveDate` 传参去掉，第 1 条「重跑愈」必须红

## 10. 明确不做（本批）

对照 `CLAUDE.md §2` 与本轮讨论：

- 分级审批（小额免批）｜ 余额不足时的公司垫款（二期）与追索 / 认损（三期）｜ 无主入金超期退回付款方（登 BACKLOG）｜ 入账后我方主动退款（充值域「入账后退回」功能，非补单）｜ 退汇触发合规复核 / 冻结 ｜ 虚拟币退汇（不存在）
- 引擎：真实法币行无参考号时的模糊匹配改进 ｜ 任何匹配器 / 桶 / 余额检查改动
- 信号的显式迁移表 ｜ 幂等 / 去重 / 重试 / 并发锁 / 补偿 ｜ 审批过期 cron（既有缺口，不在本批）

## 11. `decisions.md` 追加原文（plan 直接落）

- [2026-09-03] **退汇只有法币**：链上转账最终不可逆，入金退回与出金退回不存在虚拟币版本；漏记入金链上法币都有 ｜ 行业共识。链上"像退汇"的事各有其名：区块重组 = 假信号入账，广播未确认 = 提现已记未执行，对方手动打回 = 新进账走补录
- [2026-09-03] **复核人口径**：合规驱动的动作归 MLRO（退回 / 上缴 / 解冻），纯资金的动作归 CFO（调账、核销、补单三路）｜ 业主拍板
- [2026-09-03] **补录也过 CFO**：行业四眼盯的是「把这笔钱归到这个客户」的判断，充值域 KYT 与合规闸筛的是付款方，两道门管的不是一件事；不做金额分级 ｜ 行业标准
- [2026-09-03] **退汇认领前置条件：客户可用余额 ≥ 退汇金额**，不够即拒、案子照旧红；客户资金池不许出现借方余额，公司垫款归二期内部划转、追索认损归三期 ｜ 业主认可
- [2026-09-03] **补单入口在案子上、逻辑与数据在业务域**（甲）：对账侧只发起调用，业务域自己建单、审批、记账、审计；账务生效日写案子业务日、参考号取账单行、一行只补一次 ｜ 业主拍板

## 附录 A · 数据模型改动（一个迁移：`20260903120000_recon_supplement_entries`）

| 表 | 改动 |
|---|---|
| `inbound_transfer_signals` | + `supplementOfExternalLineId String? @unique`、`supplementReconCaseNo String?`、`supplementRequestedByUserId String?`；`status` 新值 `SUPPLEMENT_PENDING` / `SUPPLEMENT_REJECTED`（String 列，无 enum 迁移） |
| `deposit_transactions` | + `effectiveDate String?`、`clawbackExternalLineId String? @unique`、`clawbackReconCaseNo String?`；`status` 新值 `CLAWED_BACK` |
| `withdraw_transactions` | + `returnExternalLineId String? @unique`、`returnReconCaseNo String?` |
| `reconciliation_dispositions` | + `supplementNo String?`；`outlet` 新值 `SUPPLEMENT`；`deferredTarget` 新值 `SUPPLEMENT_PAYOUT_RETURN` |

常量：`TB_TRANSFER_CODES.DEPOSIT_CLAWBACK`（下一个空号）+ `TB_CODE_TO_COA` 无新科目；`ApprovalActionTypes` +3、`DEFAULT_APPROVAL_POLICIES` +3；`AuditActions` +10、`AuditBusinessWorkflowTypes` +3；`PermissionGroup` +3、`route()` +4、`ACTION_BUCKET_CATALOG` 桶各一条、`OPS_OFFICER` 持有；`DomainEventNames` 无新事件（审批 decided 事件由 `ApprovalHandlerBase` 按既有命名派生）。

## 附录 B · 本批触发的交付清单行（`rules/delivery-checklist.md`）

任何持久状态变化（审计 + requestId）｜ 新增审计动作码（10 个，四属性冻结）｜ 新状态 / 新结局（`CLAWED_BACK` 一条边、`SUCCESS→RETURNED` 一条边、信号两态；计时：都不要，终态或有审批超时兜着）｜ 动了钱（同步直调、不建资金单、不新增科目；`verify:coa`）｜ 该走 maker-checker（三类走 `ApprovalsService` 正门）｜ 新增审批策略（`MAKER_GROUP_BY_POLICY` +3）｜ 新增权限组（三个，四处齐）｜ 新增 admin 端点（4 条，登记 + sync + 重启）｜ 新增业务动作（前端入口三个）｜ 改了交易三域（充值、提现都动了；兑换无对应，因为兑换不产生外部行）｜ 新字段 / 新状态到客户面（`CLAWED_BACK` 客户可见，白名单加）｜ 涉及金额（最小单位存）｜ 对外识别（业务键）｜ 改 schema（一个迁移，无 backfill）｜ 改页面或种子（`data.md` / `script.md` / `baseline.md`）｜ 改了前端（截图六张）｜ **本任务是多波中的一波**（合并前把「承接 B 批」写进二期 spec `2026-09-03-internal-transfer-order-design.md` 开头：实际偏差 / 新事实 / 二期前提变化；**只写承接，不展开二期**，展开是二期新会话读总纲 + 承接 + 骨架后跟业主脑暴的活；本 spec 随即归档）｜ 每轮收尾（modules v8-recon / v4-deposit / v5-withdraw / overview、手册、decisions +5、CHANGELOG、BACKLOG 销三行加两行）

不触发：退役业务动作（无）｜ 新事件（无）
