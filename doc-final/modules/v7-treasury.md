# V7 · 财资（公司的钱怎么给客户）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-11-07（战役戊波二：认损与补款合并成「认损补缺」一张单（用途 `SHORTFALL_TOPUP`），出钱钱包由人选、余额闸共用，公司池调拨由新「公司调拨单」承接——本篇只改事实句，整篇重写留波三）；此前 2026-10-03（战役丙波四：新增 §7 月结单——客户账本历史月份固化成"出具的单据"，`customer_monthly_statements` 新表 + 30 秒 sweep 追赶式自动出具，见 §7）；此前 2026-09-05（平账二期：内部划转单落地）
> 演示幕次：第六幕场景 16 / 17；月结单（§7）= 第十幕场景 33 ｜ 验收：第六幕走查（`demo/script.md`）+ `modules/v8-recon.md` §4；§7 验收 = 第十幕场景 33

## 0. 一句话定位

管**公司自己的钱放进客户钱包**这件事。它是第四类订单（决策 2026-08-28）：有意图、有审批、有执行、有资金单跟着在途、有账本分录收口。二期只做公司 → 客户两条路：**认损补缺**（2026-11-07 戊波二起认损与补款合并成一张单，原「认损补款」两张单退役）、**退汇垫款**；公司池之间的调拨 2026-11-07 起由新「公司调拨单」承担（只在运营户与手续费户之间挪，见 `modules/company-funds.md` §2.3），结算户仍是过渡户。**公司找场外 LP 补货/回吐库存**是第五类订单（战役乙波一，2026-09-29），见 `modules/lp-desk.md`；**公司自己的钱怎么来、怎么花给外部供应商、怎么一屏看清家底**（注资单/供应商付款单/全景看板，战役乙波二，2026-09-29）见 `modules/company-funds.md`——三者同属 V7 财资域，与本篇内部划转单并列。**客户账本的历史月份怎么固化成"出具的单据"发给客户**（月结单，战役丙波四，2026-10-03）见本篇 §7——同属资产域（`asset-treasury/treasury/`），与上述几类订单无关。

## 1. 业务叙事

**短缺 = 托管里的钱比账本记的少。** 两种：查不出的短缺（认损补缺，一张单、CFO 批一次）；退汇造成的短缺（先垫后扣）。两种都要**先让账说真话，再由公司真金白银补进去**——认损补缺里「记短缺」让案子愈、「补缺」是对客户的交代；垫款金额锁定等于差额，先垫后扣，客户欠公司的三期追索。

**每一步真人开单、真人裁决。** 运营查证定性、金库在案子上发起、CFO 单步复核；金额不可改（多一分都是往客户钱包塞钱）。

**法币必须经结算户。** vIBAN 与运营户不能直转：出钱钱包（运营户；认损补缺可改选手续费户）→ 结算户 → 客户 vIBAN 两腿，与兑换买入腿同一条物理路线；加密币一腿直达。

**钱在路上时对账不红。** 腿一提交，模拟托管方就写两行对账单；账本在腿确认时落账、同一参考号。对账在两钱包各找到一张没走完的资金单，落在途桶。

## 2. 状态机（六态六边）

`PENDING_APPROVAL → EXECUTING → SUCCESS`；`PENDING_APPROVAL → FAILED（批了出钱钱包没钱；认损补缺另有记短缺失败）/ REJECTED（拒绝 / 超时）/ CANCELLED（金库撤回）`；`EXECUTING → FAILED（腿失败）`。不设草稿、不设「已批准」中间态、不计时。资金单腿：加密币一腿沿出金表 5 跳，法币两腿各 4 跳，腿 1 清算后腿 2 才诞生。

**用途（戊波二，2026-11-07）**：`SHORTFALL_TOPUP`（认损补缺，由原 `CLIENT_COMPENSATION` 改名）｜ `CLIENT_ADVANCE`（垫款，入口置灰、原样）。**认损补缺是一张单、一次批**：提交即挂（处置记录落 `transferNo`、差异行锁定，驳回 / 撤回 / 超时 / 记短缺失败时解开），CFO 批准那一步**先记短缺**——码 91 借 2「托管短缺待补」/ 贷 1 客户钱包现金，生效日 = 案件业务日，回执落 `recognizedTbTransferId`——**再建腿**；记短缺被拒或复查不过 → 既有边 `PENDING_APPROVAL → FAILED`（`failureReasonCode = RECOGNITION_FAILED`）；最后一腿确认：82（借 301 对账核销损失 / 贷 50 公司钱包现金；法币 = 结算户）+ 83（借 1 客户钱包现金 / 贷 2 短缺待补；`CLIENT_ADVANCE` 仍借 1 / 贷 100）→ SUCCESS，短缺户回零，**客户应付与余额全程不动、客户端零行**。短缺已记而腿失败（`LEG_FAILED`）**不重补**、行入口不回来（`PRODUCTION-NOTES.md`）。出钱钱包由金库在单上选（运营户 / 手续费户，`FirmWalletPickerService.assertEligible` 校验），不再固定运营户；`CLIENT_ADVANCE` 仍固定运营户。**状态机仍是六态六边，一条边没加**；旧「补款」路径（`/compensation` 端点、`COMPENSATION` 读面分支、`sourceAdjustmentNo` 列、`UNEXPLAINED_CLIENT_LOSS` 调账成因、`CLIENT_COMPENSATION` 用途名）已整条退役。与对账的接口：记短缺那笔是客户现金户上一条 OUT 流水，匹配器第 0 轮按单上的锚（`explainedFlowId` / `explainedExternalLineId`）把它与那条差异行配成 Matched，案子随重对账自愈（见 `modules/v8-recon.md`）。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 发起认损补缺 | 金库（案件页差异行 Resolve 菜单「Recognize loss & top up」，或事故页同名按钮跳案件页） | CFO 单步（一次） | 金额锁定（账龄路 = 差额，事故路 = 定损额）；同一差异行至多一张活单（带 `recognizedTbTransferId` 的 FAILED 单也计入）；钱包有在途出款锁定时开单被拒并指路，批准时再查一次 |
| 发起垫款 | 金库（案件页，退汇行余额不足时） | CFO 单步 | 金额 = 账单行 − 客户可用；到账后「认领退汇」回来 |
| 撤回 | 金库（待批时） | — | 执行中不许撤 |
| ⚡ 推腿 | 运营（资金单页） | — | 提交写回单、确认落账 |
| 批准时余额复核 | 系统 | — | 出钱钱包不够 → FAILED，不建资金单（共用余额闸，见 §5） |

## 4. 演示脚本

第六幕场景 16（Alice USDT：认损补缺一张单，一腿）与 17（Grace AED：垫款 → 认领，两腿）——步骤在 `demo/script.md`。

## 5. 关键技术节点

- 主体 `asset-treasury/internal-transfers/internal-transfer.service.ts`（迁移表 / 建行 / 零 UUID 投影；出钱钱包余额闸 2026-11-07 起改调共用的 `AccountingService.assertWalletBalance`——读该钱包现金户「posted − pending 贷方」，不够 400 `INSUFFICIENT_FIRM_BALANCE`，划转单 / 付款单 / 调拨单 / LP 兑换单同调这一份）｜ 工作流 `internal-transfer-workflow.service.ts`（发起 / 撤回 / `workflow.internal-transfer.decided` / `FUNDS_ORDER_STATUS_CHANGED`：提交写回单、确认落账 81/82/83 并清算、失败原因码，戊波二新增 `RECOGNITION_FAILED`；认损补缺开单 `initiateShortfallTopup`、批准时先落码 91 再建腿）｜ 审批 `INTERNAL_TRANSFER_APPROVAL`（CFO 单步 48h 可撤）｜ 端点 `admin/internal-transfers/{shortfall-topup,advance,:no/cancel}` + 列表 / 详情
- 对账域：`reconciliation/simulation/simulated-custodian-statement.service.ts`（模拟托管方回单）｜ 读面 `disposition/funding-next-step.ts`（`ADVANCE`；`COMPENSATION` 分支已随认损补缺退役，客户池认损的 `nextStep.kind` 现为 `SHORTFALL_TOPUP`）
- 资金单第四父键 `internalTransferId`（沿出金走法表）｜ 转账码 81–83（83 按用途分贷方：`SHORTFALL_TOPUP` 贷 2、`CLIENT_ADVANCE` 贷 100）+ 新码 91 `CLIENT_SHORTFALL_RECOGNIZED` ｜ 审计八码 `V7_TREASURY_AUDIT_ACTIONS`（域 TREASURY；戊波二新增 `INTERNAL_TRANSFER_SHORTFALL_RECOGNIZED`）｜ 权限 `INTERNAL_TRANSFER_READ / WRITE`（桶 `treasury.view_transfers` / `treasury.act_client_funding`）
- 表 `internal_transfers`；客户可见面：垫款行「平台垫付」（客户侧腿事件码分）；认损补缺客户端零行（对账单白名单已删 `INTERNAL_TRANSFER_COMPENSATION_IN`）

## 6. 演示缺口（BACKLOG 有账）

- 公司池调拨 2026-11-07 起只做运营户 ⇄ 手续费户的「公司调拨单」（扫费，见 `modules/company-funds.md` §2.3），其余池间调拨（备付等）仍不做；认损补缺单与划转腿的原子性（码 91 已落、腿失败不重补）见 `PRODUCTION-NOTES.md`
- 法币腿 2 失败后款项停在结算户，人工处理，不做自动退回
- 追索三期：垫款只登记不入账，账上无应收科目
- 铺场前不得有在途划转（脚本前置闸）；已落账的调账单、已记短缺的认损补缺单之后也不得重摆对账场景，须重铺数据（R37）

## 7. 月结单（战役丙波四，2026-10-03）

> 总纲 `archive/superpowers/specs/2026-09-30-campaign-c-outreach-disclosure-charter.md`（已归档） §1 岔口 1 / §2 波四行；spec 随合并归档（含执行订正）。月结单主体挂 `asset-treasury/treasury/`，与读模型 `customer-statement.service.ts` 同屋——它和上文内部划转单是同一域里两件不相干的事：划转单管"公司的钱怎么给客户"，月结单管"客户账本的历史月份怎么固化成单据发给客户"。

**为什么是"出具的单据"。** 客户端原先只有"活水页"（`GET client/portfolio/statement`，按日期区间现查账本腿）：每次打开都重算，平账调整可回溯，同一个月今天看与下月看数字可能不同。监管的动词是 **issue**（VARA CRM IV.D.2：客户资金月结单须于结单日后 25 天内出具；Custody III.D.4 的月度虚拟资产对账单本司仅 BD 牌照、是否适用波内留白）。所以月结单是**出具并留存的单据**，沿成交确认单（D-26）三性：**一单一张（客户 × 月）、只写一次、出具时刻与审计留痕**——决策见 `decisions.md` 与 `delivery/decision-log.md` D-28。

**表 `customer_monthly_statements`**（迁移 + `reset-business-data.ts` 登记）：`statementNo` = `STM-<customerNo>-<YYYYMM>`（客户 × 月天然唯一且可读，铁律⑥）｜ `customerId` ｜ `periodMonth`（`YYYY-MM`，迪拜业务月）｜ `issuedAt` ｜ `payload`（JSON 快照：逐币种分节 `[{assetCode, isFiat, openingBalance, closingBalance, rows[]}]`，金额最小单位整数字符串，行结构沿用 `StatementRow`）｜ `@@unique([customerId, periodMonth])`（"一单一张"是业务规则，不是幂等兜底）。**只写一次**：服务里没有任何 update / upsert 路径，出具后永不变更。

**生成器 `MonthlyStatementService`。**
- **枚举币种**：`TbAccountRegistryService.findByOwner(客户)` 只取 `CLIENT_PAYABLE`（码 100）户（暂扣户 101 不入账单），按 ledger 升序——后端自枚举，不走客户端传参那条活水路；节的 `assetCode` 装的是**币种**（如 `USDT`）而非资产码（`USDT-TRON`）。
- **窗口 = 迪拜业务月**：三个业务月函数 `businessMonthOf` / `startOfBusinessMonth` / `endOfBusinessMonth` 住 `business-date.util.ts`（守该文件"业务日唯一出口"纪律，不添第三种取日方式；语义合同 S20）。**归月口径 = 记账月**：腿的 `createdAt` 落在哪个月就记哪个月——后月才发生的平账调整记入它**实际入账的那个月**（与银行"更正记当月"同款，正是快照不漂的原因）。
- **期初 / 期末**：期初 = 窗口前最后一腿的 `runningBalance`（无则 0）；期末 = 窗口内最后一腿的 `runningBalance`（窗口无腿则 = 期初）；"行能加出余额"由账本恒等天然保证（语义合同 S23）。
- **行渲染一律复用 `CustomerStatementService.buildStatement`**：tipping-off 白名单（`ROW_PRESENTATION` / `FALLBACK_PRESENTATION`）随之继承——**冻结 / 受限客户的账单与普通客户一字不差**，异常事件码一律落通用标题 "Balance adjustment"、原始码不进快照；生成器不得自造行标题。行序**新→旧**（与活水页一致，前端不反转）。零腿币种照样出节（期初 = 期末，空行表）；客户所有币种全空照样出单——"无活动月结单"是真实银行行为。
- **次序**：先落快照行 → 再写审计 `STATEMENT_ISSUED`（actor=system，同 `CONFIRMATION_ISSUED` 先例）→ sweep 内再发通知（持久物先于留痕先于信号）。

**出具 sweep `MonthlyStatementSweepService`。** `@Cron('*/30 * * * * *')` + `sweep(now)` 可注入（样板 `compliance-obligation-sweep.service.ts`）；对象 = 有 `onboardingApprovedAt` 的客户（Dave / Eve 无，天然不出单）；**追赶式**：从 `businessMonthOf(onboardingApprovedAt)` 起到 `businessMonthOf(now)` 的前一月止（当月不出）逐月查无则出，重铺后首轮 sweep 自动补齐 2026-06 ～ 上月全部历史月（`demo:all` 零改动）；单轮对同一客户补出多月时**仅最新月发通知**（避免一人连收 4 条）；单月 / 单客户失败 try/catch 不拖垮批次。补发月的 `issuedAt` = 补发当日——出具时刻如实记，不假装"当月月末"。**为什么是 sweep 而不是"拨钟跨月自动出"**：业主拍板时设想挂拨钟，实扫证实**系统无全局钟**——⚡"拨钟"全是逐单改写截止列（9 个 `simulate-timeout` 端点），"跨月"无挂靠点；做真钟要动 155 处 `new Date()` + 37 处 `Date.now()`、演示收益为零（过去的月份本来就是完整的）。sweep 保住"自动、无人手介入"的本质且零 ⚡按钮，见 `decisions.md`。

**两端。**
- **客户端**（扩既有 `TransactionHistory.tsx`，不起新页）：资产 chips 行右侧加 **Statements** 下拉——`Current activity`（活水，现状不动）+ 已出具月份降序；选中历史月 → `GET client/portfolio/statements/:statementNo` 取快照，**前端渲染快照、不重查**，页头 `Statement issued <出具日>` 徽标 + 月名 + 单号 + 当前币种 Opening / Closing，快照行客户端分页；通知深链 `/transactions?statement=<statementNo>`（自动选中有行的币种）。两端点（列表三键 `{statementNo, periodMonth, issuedAt}` / 详情快照）进 `customer-portfolio.controller.ts`，**客户面零权限码**；别人的单号 = 不存在（同一 404，归属是业务规则）。
- **管理台**：`GET /customers/:customerNo/statements`（挂既有 `CUSTOMER_READ`，读挂既有组不增桶，与客户详情同门槛）→ `CustomerDetail.tsx` Transactions 节下加「Monthly statements」只读节：月份 / 出具时刻 / statementNo，行右 `Balances ▸` 展开逐币种期末余额（响应在三键之上多一个 `balances[{assetCode, decimals, closingBalance}]`，行展开必需）。

**通知与审计。** 通知模板 `STATEMENT_ISSUED`（email 模拟留痕——发出凭证正是监管戏眼；`relatedOrderType` 第六值 `STATEMENT`，`relatedOrderNo` = statementNo，深链见上），发信点第 18 个（第 19 个是 DSR 办结，见 `modules/v2-customer-compliance.md` §8）；审计 `STATEMENT_ISSUED`（域 GOVERNANCE、触达册，必填 `statementNo` / `periodMonth`，主体类型 `MONTHLY_STATEMENT`，OWNER=客户）。

**种子。** 种子客户的腿原先全落在铺数当天（`tb-evidence.service.ts` 写死 `new Date()`），不补则所有客户的历史月账单全空——所以给 Henry Acme 补了上上月 / 上月历史腿（LP 先例三件套：TB 真写 + 回拨时间的 `tbTransferEvidence` + `accountFlow` 镜像；只铺客户侧腿，**费腿不对称是有意的**），详见 `demo/data.md`「月结单与资料请求种子」与 `demo/baseline.md`「战役丙波四种子断言」；**月结单本身一律由 sweep 经真实生成器出具，种子不直插**（"实时快照不可批量补拍"判例，乙波三）。

**不做**：PDF 真渲染 / 打印件（本波无打印）；补发 / 修正 / 作废重出流；整版哈希留存；月结单"重出"（出具后永不变是设计，不是缺口）。

**演示**：第十幕·场景 33（演员 Henry：管理台月结单节 → 审计 `STATEMENT_ISSUED` → 客户端消息 → 深链翻月 → 固定 vs 活页），见 `demo/script.md`。**关键技术节点**：`asset-treasury/treasury/monthly-statement.service.ts`（生成器 + 读面三方法 `listForCustomer` / `getForCustomer` / `listForAdmin`）、`monthly-statement-sweep.service.ts`（sweep）、`customer-portfolio.controller.ts`（客户端两端点）、`identity/customers/customers.controller.ts`（管理台一端点）；客户端 `TransactionHistory.tsx`，管理台 `CustomerDetail.tsx`。
