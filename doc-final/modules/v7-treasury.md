# V7 · 财资（公司的钱怎么给客户）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-03（战役丙波四：新增 §7 月结单——客户账本历史月份固化成"出具的单据"，`customer_monthly_statements` 新表 + 30 秒 sweep 追赶式自动出具，见 §7）；此前 2026-09-05（平账二期：内部划转单落地）
> 演示幕次：第六幕场景 16 / 17；月结单（§7）= 第十幕场景 33 ｜ 验收：第六幕走查（`demo/script.md`）+ `modules/v8-recon.md` §4；§7 验收 = 第十幕场景 33

## 0. 一句话定位

管**公司自己的钱放进客户钱包**这件事。它是第四类订单（决策 2026-08-28）：有意图、有审批、有执行、有资金单跟着在途、有账本分录收口。二期只做公司 → 客户两条路：**认损补款**、**退汇垫款**；公司池之间的调拨不做（结算户是过渡户，兑换每笔进多少出多少）。**公司找场外 LP 补货/回吐库存**是第五类订单（战役乙波一，2026-09-29），见 `modules/lp-desk.md`；**公司自己的钱怎么来、怎么花给外部供应商、怎么一屏看清家底**（注资单/供应商付款单/全景看板，战役乙波二，2026-09-29）见 `modules/company-funds.md`——三者同属 V7 财资域，与本篇内部划转单并列。**客户账本的历史月份怎么固化成"出具的单据"发给客户**（月结单，战役丙波四，2026-10-03）见本篇 §7——同属资产域（`asset-treasury/treasury/`），与上述几类订单无关。

## 1. 业务叙事

**短缺 = 托管里的钱比账本记的少。** 两种：查不出的短缺（认损 + 补款）；退汇造成的短缺（先垫后扣）。两种都要**先让账说真话，再由公司真金白银补进去**——认损让案子愈，补款是对客户的交代；垫款金额锁定等于差额，先垫后扣，客户欠公司的三期追索。

**每一步真人开单、真人裁决。** 运营查证定性、金库在案子上发起、CFO 单步复核；金额不可改（多一分都是往客户钱包塞钱）。

**法币必须经结算户。** vIBAN 与运营户不能直转：运营户 → 结算户 → 客户 vIBAN 两腿，与兑换买入腿同一条物理路线；加密币一腿直达。

**钱在路上时对账不红。** 腿一提交，模拟托管方就写两行对账单；账本在腿确认时落账、同一参考号。对账在两钱包各找到一张没走完的资金单，落在途桶。

## 2. 状态机（六态六边）

`PENDING_APPROVAL → EXECUTING → SUCCESS`；`PENDING_APPROVAL → FAILED（批了运营户没钱）/ REJECTED（拒绝 / 超时）/ CANCELLED（金库撤回）`；`EXECUTING → FAILED（腿失败）`。不设草稿、不设「已批准」中间态、不计时。资金单腿：加密币一腿沿出金表 5 跳，法币两腿各 4 跳，腿 1 清算后腿 2 才诞生。

## 3. 决策点与角色

| 动作 | 谁发起 | 谁裁决 | 要点 |
|---|---|---|---|
| 发起补款 | 金库（案件页，认损落账后） | CFO 单步 | 金额 = 认损额；同一认损单只能有一张未走完 / 已成功的划转单 |
| 发起垫款 | 金库（案件页，退汇行余额不足时） | CFO 单步 | 金额 = 账单行 − 客户可用；到账后「认领退汇」回来 |
| 撤回 | 金库（待批时） | — | 执行中不许撤 |
| ⚡ 推腿 | 运营（资金单页） | — | 提交写回单、确认落账 |
| 批准时余额复核 | 系统 | — | 运营户不够 → FAILED，不建资金单 |

## 4. 演示脚本

第六幕场景 16（Alice USDT：认损 → 补款，一腿）与 17（Grace AED：垫款 → 认领，两腿）——步骤在 `demo/script.md`。

## 5. 关键技术节点

- 主体 `asset-treasury/internal-transfers/internal-transfer.service.ts`（迁移表 / 建行 / 零 UUID 投影 / 运营户余额闸）｜ 工作流 `internal-transfer-workflow.service.ts`（发起 / 撤回 / `workflow.internal-transfer.decided` / `FUNDS_ORDER_STATUS_CHANGED`：提交写回单、确认落账 81/82/83 并清算、失败三种原因码）｜ 审批 `INTERNAL_TRANSFER_APPROVAL`（CFO 单步 48h 可撤）｜ 端点 `admin/internal-transfers/{compensation,advance,:no/cancel}` + 列表 / 详情
- 对账域：`reconciliation/simulation/simulated-custodian-statement.service.ts`（模拟托管方回单）｜ 读面 `disposition/funding-next-step.ts`（`COMPENSATION` / `ADVANCE`）
- 资金单第四父键 `internalTransferId`（沿出金走法表）｜ 转账码 81–83 ｜ 审计七码 `V7_TREASURY_AUDIT_ACTIONS`（域 TREASURY）｜ 权限 `INTERNAL_TRANSFER_READ / WRITE`（桶 `treasury.view_transfers` / `treasury.act_client_funding`）
- 表 `internal_transfers`；客户可见面：账本对账单行「平台补款 / 平台垫付」（客户侧腿事件码分）

## 6. 演示缺口（BACKLOG 有账）

- 公司池调拨（备付 / 归集）不做；手续费归集等报表层
- 法币腿 2 失败后款项停在结算户，人工处理，不做自动退回
- 追索三期：垫款只登记不入账，账上无应收科目
- 铺场前不得有在途划转（脚本前置闸）

## 7. 月结单（战役丙波四，2026-10-03）

> 总纲 `superpowers/specs/2026-09-30-campaign-c-outreach-disclosure-charter.md` §1 岔口 1 / §2 波四行；spec 随合并归档（含执行订正）。月结单主体挂 `asset-treasury/treasury/`，与读模型 `customer-statement.service.ts` 同屋——它和上文内部划转单是同一域里两件不相干的事：划转单管"公司的钱怎么给客户"，月结单管"客户账本的历史月份怎么固化成单据发给客户"。

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
