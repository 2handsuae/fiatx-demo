# 战役丙波四「月结单与资料请求」spec

> 总纲：`2026-09-30-campaign-c-outreach-disclosure-charter.md`（§1 岔口 1 / §2 波四行 / §3 波四 / §6）｜ 骨架（含波三承接 18 条）：`2026-10-02-campaign-c-wave4-statements-dsr-skeleton.md` ｜ 脑暴 2026-10-03 业主全程拍板 ｜ 地基事实三路只读实扫（HEAD `d86a0be8`），凡引 file:line 均为扫描时值
> 本任务做：月度对账单（出具的单据，快照落库）；DSR 资料请求工单（查/改/删三型，DPO 独办）；phone 客户自助改；改档案 admin 通道（填 `CUSTOMER_WRITE` 孤儿桶，销 BACKLOG:236）。
> 本任务不做（对照 CLAUDE.md §2 与总纲）：PDF 真渲染；DSR 真删数据；真发邮件；模板编辑器；审批链（DPO 独办已拍）；幂等/重试/并发锁等技术兜底；全局演示时钟（§0 裁定 10）。

## 执行订正（2026-10-03，T12 收口，spec 原文不改只追记）

1. **phone 自助改路由写作 `PATCH /client/me/phone`，不是 §4.3 的 `/client/me/profile/phone`**（T9）：brief / plan 已用前者，实现照之；零行为差异，命名不翻工。连带：为让 `client/me/*` 前缀与 onboarding 现有路由共存，`customer-profile.controller.ts` 由类级 `@Controller('onboarding')` 改为方法级全路径（`GET onboarding/me` 的 URL 未变）。另两条实作细节 spec 未写：phone 不许清空（400 `PHONE_REQUIRED`）、与现值相同 = 无持久动作 = 无留痕。
2. **⚡ `simulate-timeout` 的审计 `requestId` 带随机后缀**（T5，裁定）：§3.3 钦定"照 `complaints.service.ts:447-461` 逐行同款"，而 brief 字面写 `requestId = requestNo`；审计 `idempotencyKey = sha256(域|action|主体|correlation|requestId)` 不含时间，⚡又可对同单重拨（场景 34 明写"重拨"），固定 requestId 会让第二次被静默吞掉、违铁律①——故照投诉先例（`complaints.service.ts:482`）带随机后缀；其余四个 DSR 码 `requestId = requestNo`（终态单次，天然唯一）。
3. **`clauseRef.versionKey` 取该客户"最新 ACCEPTED 同意版"，不是"最新一行"**（T5）：§3.1 写"取最新同意版"，DECLINED 不是同意（`agreements-read.service.ts` latestAccepted 同口径）；客户无任何 ACCEPTED 行 → resolve 400（种子全客户都有 v1 ACCEPTED，演示不受影响）。
4. **资料摘要内证件号 / 出生日期不打码；摘要四键名由实现定**（T5，裁定）：§3.2 白名单钦定含 `idDocNumber` / `dateOfBirth` 明文，摘要是"我们持有什么"的如实副本，DSR_READ 三职务本就持客户读权，未扩大暴露面；快照键 `generatedAt` / `profile` / `agreementConsents` / `kycMaterials`（spec 未定名）。是否脱敏已登 BACKLOG。客户面投影真相 = **10 键**（含 T5 既有的 `detail`，页面要显示"你问了什么"），§3.4 未列全。
5. **月结单快照行序新→旧、节 `assetCode` 装币种**（T3，裁定）：§1.2 行渲染复用 `buildStatement`（返回新→旧）、未提序，行序原样冻进快照、前端照序渲染不反转（与活水页一致）；节的 `assetCode` / `isFiat` 由 `ledger` 经 `TB_LEDGERS` 反查得币种（`USDT`），不是账户登记行的资产码（`USDT-TRON`），客户端 chips 按币种匹配。审计信封字段名实为 `primarySubjectType` / `primarySubjectNo`（CONFIRMATION_ISSUED 先例），brief 示例写的 `entityType` / `entityNo` 不存在。
6. **管理台月结单响应在三键之上多一个 `balances`**（T4，裁定）：§2.2 "行展开逐币种期末余额"必需配套，非 Extra；客户面两端点严格按 §2.1（列表三键 / 详情 `{statementNo, periodMonth, issuedAt, sections}`）。**补发月的 `issuedAt` = 补发当日**（sweep 追赶时刻，出具时刻如实记）——客户端徽标 "Statement issued Oct 3, 2026" 套在 2026-06 / 07 上，是诚实语义、不是 bug。
7. **§8.1 Henry 种子腿的三处取舍**（T11）：① **上月补一笔充值**（AED 10,000.00，2 日）——brief 把唯一充值放上上月，使"Henry 上月单 AED 节 rows ≥ 3"自相矛盾（上月只剩兑换 + 提现 = 2 行），而 §8.1 原文就是"上月 1 笔充值 + 兑换 + 提现"，期末因此是 44,950.00（不是 35,000−费）；② **只铺客户侧腿、不铺公司侧对手腿**（`SWAP_*_FIRM` / `WITHDRAW_FEE_FIRM` 等）——公司侧会漂移 `F_OPS` / NLA / 运营户水位等场景 31/32 钉死的数，月结单只读 `CLIENT_PAYABLE`，公司侧腿对它零贡献；**费腿因此不对称是有意的**（见 `baseline.md`）；③ 多铺一行极薄 `swap_transactions` 壳（§8.1 预留的"极薄订单壳"选项，`CustomerStatementService.presentGroup` 按 swapNo 反查标题所必需；充值 / 提现行标题不依赖订单行、不造壳——提现壳会撞 `verify:demo-data` R4）。**§8.1 / §8.2 "data.md 零 diff" 判据被推翻**：生成区是绝对读数，`COA CLIENT(AED/USDT)` 两行必随 Henry 余额平移（29612565 → 34107565、4392571811 → 7101620811），花名册表与 FIRM 两行零 diff；T11 把 `demo:all` 自动改写的这两行入库、T12 重铺后 `demo:all` 复跑零 diff。同时，`script.md` 场景 31/32 两处 `verify:coa` CLIENT 钉死数同步订正（推导值，未重走场景 31/32 复读）。
8. **§3.5 / §9.3 "金库拨 ⚡"实际只有超管能实点**（T6 / T10）：⚡ 挂 `DEMO_CLOCK_WRITE`（金库 / 超管），但详情页 ⚡ = `DSR_READ` ∩ `DEMO_CLOCK_WRITE`（唯超管），闹钟墙读挂 `COMPLIANCE_OFFICE_VIEW`（金库 / DPO 均不持有、`wall 403`）——金库的 ⚡ 入口理论上只剩墙，而他看不见墙；故场景 34 的 ⚡ 由超管在**墙上**点（`canFastForward` 落墙侧，DSR 行点击有显式分支），DPO 看自己列表页的倒计时列（墙是合规官督办视角）。这是 §5 钦定的 RBAC 形状，不是缺陷；DPO 要不要看墙已登 BACKLOG。DSR 管理台详情路由全前缀 `/admin/governance/compliance-office/dsr-requests/:requestNo`（§3.3 / brief 写的无前缀形态要改）。
9. **§4.2 "掩码走 `audit-mask.util.ts` 既有 phone / 证件规则"的前提不成立**（T8）：`idDocNumber` / `residentialAddress` 两键名原不在任何掩码集合；更糟，`normalizeKey()` 全小写后再比，集合里 11 个驼峰条目（`apiKey` / `idNo` / `idNumber` / …）永远命不中——最小处置 = 集合里追加小写条目 `iddocnumber` / `residentialaddress`，驼峰死条目只提不删（登 `TOOLING-DEBT.md`，T12 复现确认 11 / 11）。此前 `maskAuditPayload` 全仓零调用方。
10. **§10 "integration（on-stack）"三组未以入库 spec 落地**：DSR 全链 / phone 唯一冲突 / PATCH profile 白名单外拒绝——起完整 `AppModule` 的 jest 在本机 `app.init()` 即抛监听器 52 > 50 的 `TypeError`（`TOOLING-DEBT.md` 已登），改为 ① jest 行为化 mock 单测（DSR 31 条 + client controller 11 条 + customers.service / controller 各组，mock 真按 where / select 过滤、变异验证过）、② 真栈 HTTP 冒烟（T5 30 项 / T7 20 项 / T8 / T9，脚本为临时物未入库）、③ `verify:rbac` 行为探针（DPO resolve ALLOW / 合规官 resolve DENY / 运营 list DENY / DPO ⚡ DENY，T8 另补改档案两条）。**§13.1 "测试造一腿验证快照不漂"在 service spec 里没有对应用例**（最近的是"二次 issue 首单 payload 不被改写"与"issue → 读回往返"），T12 改在真栈上做了一次等价实验：对 Henry 2026-09 单出具后，往 `tb_transfer_evidence` 插一条落在 9 月的 AED 腿（+777.00）——活水页 `total` 4 → 5、`currentBalance` 4495000 → 4572700，而 `GET /client/portfolio/statements/STM-CU2601012635-202609` 的整份 JSON **逐字节不变**（AED 节 opening 5000000 / closing 4495000 / rows 3）。实验数据随 T12 重铺清除；入库用例补缺留给终审 triage。
11. **§9.2 "两张历史单"实为四张**（T11 / T12 走查）：sweep 追赶补齐 2026-06～09 共 4 张（11 客户 × 4 = 44），其中 Henry 只有 08 / 09 两张有内容、06 / 07 空表。**§8.2 判据"≤60 秒"实测远快于上限**（T11 起栈后 ≤5 秒、T12 干净库起栈后约 30 秒（一个 tick）内 44 张齐，取决于 30 秒 tick 的相位）；"Henry 上月账单 payload 行数 ≥4" = AED 节 3 行 + USDT 节 1 行。
12. **幕序（§0 裁定 12 的落地补记）**：新第十幕"客户的账单与资料"= 场景 33–34，协议幕顺延第十一幕、场景 33→35（`script.md` 头部、第十一幕两处总则、`data.md` / `baseline.md` / `v2-customer-compliance.md` 同改；grep 清点见 T12 报告）。**骨架前提 12 的"波四新场景排第十一幕（场景 34 起）"说法被本波订正**——骨架随合并归档，本条即订正记录。
13. **§12 数量表终值（机器数）**：表 +2 ✓ ｜ 桶 / 组 / 域 **83 / 92 / 15**（`verify:rbac` S13d 实测：域 15、`ACTION_BUCKET_CATALOG` 83 桶、三源并集 92 组）｜ 审计现役码 **343**（`npm run audit:vocab` 合计 343，分域 CUSTOMER 34 / GOVERNANCE 54）｜ 通知模板 **19**、`relatedOrderType` **7** 值（ts-node 实数）｜ 审批策略 51 条受 S5 保护（S8 策略全集 52 含 1 条显式豁免）、审批事件监听器 52（`TOOLING-DEBT.md` 在册）——**不动** ｜ 新 admin 路由 **8**（DSR 6 + statements 读 1 + PATCH profile 1）、新 client 路由 **6**（statements 2 + DSR 3 + phone 1）｜ 材料类型 5 型零新增、`CUSTOMER_WRITE` 孤儿桶销账（`verify:rbac` 基线红集 2 → 1）｜ 幕 / 场景 **十一 / 35**。V2 客户册现役码 29 → **31**、触达册 9 → **15**。

## §0 脑暴裁定台账（2026-10-03）

| # | 岔口 | 裁定 | 要点 |
|---|---|---|---|
| 1 | 月结单形态 | **出具的单据，快照落库** | 重查数字会漂（平账调整可回溯）；监管动词是 issue（CRM IV.D.2，结单日后 25 天内）；D-26 确认单三性判例延长线：一单一张（客户×月唯一）/只写一次/出具时刻留痕。复用 `customer-statement.service.ts` 读模型做生成器，tipping-off 白名单随之继承 |
| 2 | 客户端形态 | **扩既有流水页加月份翻页**，不起新页 | 邮件是"信封"不是"账单本身"：模拟邮件=发出凭证，账单本体在客户端页面（总纲验收口径=客户端翻出上月账单截图） |
| 3 | 出具触发 | 业主拍"甲：拨钟跨月自动出"；**执行改判：30 秒 sweep 追赶式自动出具**（见 §1.4） | 实扫证实**系统无全局钟**——⚡"拨钟"全是逐单改写截止列（9 个 simulate-timeout 端点），"跨月"无挂靠点；sweep 保住甲案本质（自动、无人手介入），且零 ⚡按钮（承接 2："能合并的时刻就合并"）。周期义务 `compliance-obligation-sweep.service.ts:29`（`@Cron('*/30 * * * * *')` + `sweep(now=new Date())` 可注入）为现成样板 |
| 4 | DSR 形态 | **工单**：单号/三型/薄状态机/30 天单钟/DPO 独办/全程留痕 | 不走审批链（审批策略仍 51 条，监听器仍 52，不再推高既有超限债——顺带效果非理由，业务理由是 DSR 处置=答复客户，不动钱不动状态机） |
| 5 | 查的出口 | 业主拍"甲：**生成资料摘要进工单**" | DPO 点「生成资料摘要」，档案白名单字段+协议同意历史+KYC 材料清单固化进工单，只写一次；客户端工单详情可看。与 profile 页的区别=范围（含客户平时看不到的三块）+形态（固化副本 vs 活页面） |
| 6 | 改的出口 | **两分流，零新改数据通道**：KYC 字段→办结时开材料请求重核验（§4.1）；联系方式→指路 phone 自助改（§4.3） | 原"转合规官处理"分支取消——phone 自助改落地后无此需求 |
| 7 | 删的出口 | **保留，形态=拒绝信**：结论「因监管留存义务拒绝」，结构化引协议 `versionKey`+§VI，**零删除动作、零字段分析** | 业主曾提议砍删，经澄清"本就不删一个字段、只是有据地说不"后同意保留；波三条款 `agreement-versions.constant.ts:73`（erasure subject to retention obligations）正是为此铺的 |
| 8 | 核验通过后谁落档 | **合规官经新建 PATCH 通道人工落档**（§4.2），非自动 | 实扫推翻脑暴前提"合规官有既有改档案能力"——裸 CRUD 2026-09-16 已删（commit `7cd731e2`），`CUSTOMER_WRITE` 组+`customer.manage_profile` 桶是零路由孤儿（BACKLOG:236）。新端点挂孤儿桶=不新增权限组、顺手销债。模拟裁决不带字段值，自动落档无从落；人核人改带审计正是监管加分项 |
| 9 | phone 自助改 | **做**，只开 phone 一个字段 | email=登录凭据不碰；其余全是 KYC/CDD 字段。实扫补充：phone 也是登录标识之一（`customer-auth.service.ts:98` OR 匹配）且 `@unique`——改后用新号登录属正常语义，唯一冲突显式报错即可（非防御性校验，是业务规则） |
| 10 | 全局演示时钟 | **判不做** | 做真钟要动 155 处 `new Date()` + 37 处 `Date.now()`（复现：`grep -rn "new Date()" src --include='*.ts' | grep -v spec | wc -l`）；演示收益为零——过去的月份本来就是完整的 |
| 11 | 月结单"上月有流水"前提 | **被实扫推翻，补 Henry 种子历史腿**（§8.1） | 种子客户腿全部落在铺数当天（`tb-evidence.service.ts:75,97` 写死 `new Date()`；实测 75/79 行同日）——不补历史腿则所有客户的历史月账单全空。Henry Acme 是唯一"ACTIVE+零腿+零便签+不在 demo:all 花名册+无他幕余额前提"的演员（`script.md` 全量检索，仅 `:658` 排除语与站 5④c 建法币地址一处触碰，均不动余额） |
| 12 | 幕序 | **新幕插为第十幕，协议幕顺延为第十一幕**（§9.1） | 骨架前提 12"排第十一幕"被 `script.md:3,652` 硬约束推翻：协议幕必须排整场最后且演完即 reset（⚡v2 生效后全库客户被拦充兑）。连带场景号重排，grep 清点（判例：数字多处复述必漏改） |
| 13 | DSR 30 天钟口径 | **自然日**，锚提交时刻 | 同投诉三常量（`complaint.constants.ts:39-41`）与协议 `NOTICE_PERIOD_DAYS=30` 两处先例；条款原文"within 30 days"无业务日语义 |
| 14 | 月结单切月口径 | **迪拜业务月**，新增业务月函数进 `business-date.util.ts`（§1.3） | 承接 8：不添第三种取日方式；现 `GET statement` 的 from/to 是裸 UTC（`customer-portfolio.controller.ts:43-90`），月边界差 4 小时的债只在月结单侧修，活水页现状不动 |
| 15 | 升档 | **默认档** | DSR 不真改删数据、月结单不动交易链，总纲预留升档条件均未触发；plan 不点名升档 |

## §1 月结单主体（挂 `src/modules/asset-treasury/treasury/`，与读模型同屋）

### 1.1 表 `customer_monthly_statements`（新迁移 + `scripts/reset-business-data.ts` 登记，甲波二判例）

| 列 | 说明 |
|---|---|
| `id` | uuid |
| `statementNo` | 业务键，`STM-<customerNo>-<YYYYMM>`（客户×月天然唯一且可读，铁律⑥） |
| `customerId` | → customer_main |
| `periodMonth` | `YYYY-MM`（迪拜业务月） |
| `issuedAt` | 出具时刻 |
| `payload` | JSON 快照：逐币种分节 `[{ assetCode, isFiat, openingBalance, closingBalance, rows: StatementRow[] }]`，金额最小单位字符串，行结构沿用 `StatementRow`（`customer-statement.service.ts:30-41`） |
| `@@unique([customerId, periodMonth])` | 一单一张（单据三性之一，业务规则非幂等兜底） |

只写一次：无 update 路径，出具后永不变更。

### 1.2 生成器 `MonthlyStatementService`

- 枚举客户币种：`TbAccountRegistryService.findByOwner(ownerUuid)`（`tb-account-registry.service.ts:78-82`，CLIENT_PAYABLE code=100）——后端自枚举，不走客户端传参那条活水路。
- 逐币种取腿：`TbEvidenceService.getAccountStatement(tbAccountId)`（`tb-evidence.service.ts:396-415`，runningBalance 按 createdAt asc 全史累加）；按**腿的 createdAt 落在该迪拜业务月窗口**过滤（口径=记账月：后月回溯的平账调整记入它实际入账的那个月，与银行"更正记当月"同款，也正是快照不漂的原因）。
- 期初余额 = 窗口前最后一腿的 runningBalance（无则 0）；期末余额 = 窗口内最后一腿的 runningBalance（窗口无腿则 = 期初）。"行能加出余额"由账本恒等天然保证（语义合同 S23）。
- 行渲染复用 `CustomerStatementService.buildStatement`（窗口=整月、take=全量）——tipping-off 白名单（`ROW_PRESENTATION`/`FALLBACK_PRESENTATION`）原样继承，**冻结/受限客户的账单与普通客户一字不差**（decisions:122/65，反面走查见 §9.3）。
- 零腿币种也出节（期初=期末，空行表）；客户所有币种全空照样出单——"无活动月结单"是真实银行行为。

### 1.3 业务月函数（进 `business-date.util.ts`，守该文件头注释的"唯一出口"纪律）

`businessMonthOf(at: Date): string`（YYYY-MM）/ `startOfBusinessMonth(month): Date` / `endOfBusinessMonth(month): Date`——由既有 `toBusinessDate`/`startOfBusinessDate`/`endOfBusinessDate`（`business-date.util.ts:8-15`）推导，单测照 `business-date.util.spec.ts` 补闭环用例（月首/月末边界各一）。

### 1.4 出具 sweep `MonthlyStatementSweepService`

- `@Cron('*/30 * * * * *')` + `sweep(now: Date = new Date())` 可注入（样板 `compliance-obligation-sweep.service.ts:29,43`）。
- 对象：有 `onboardingApprovedAt` 的客户（Dave/Eve 无，天然不出单）。
- 判据：从 `businessMonthOf(onboardingApprovedAt)` 起到 `businessMonthOf(now)` 前一月止，逐月查无则出具（追赶式：重铺后首轮 sweep 自动补齐 2026-06～上月全部历史月）。
- 每张出具：写快照行 + 审计 `STATEMENT_ISSUED`（actor=system，同 `CONFIRMATION_ISSUED` 先例）+ 通知；**单轮 sweep 对同一客户补出多月时仅最新月发通知**（避免重铺后一人连收 4 条"6/7/8/9 月账单已出"）。
- 发信形态照波一三原则（后置、持久物先于信号、服务边界吞错——样板 `agreement-publish-workflow.service.ts:232-237`）。
- `demo:all` 零改动：sweep 随后端常驻，铺数后 ≤30 秒自动补齐，无需显式步骤（§8.2 的等待判据覆盖）。

## §2 月结单两端

### 2.1 客户端（扩 `TransactionHistory.tsx`，不起新页）

- 顶部日期区（`:233-275`）旁加**月份选择**：「Current activity」（活水，现状不动）+ 已出具月份列表（新端点 `GET /client/portfolio/statements` 返回该客户 `{statementNo, periodMonth, issuedAt}[]`）。
- 选中历史月：`GET /client/portfolio/statements/:statementNo` 返回快照 payload，**前端渲染快照、不重查**；页头标注 `Statement issued <issuedAt>`，与活水视图可区分。
- 两端点进 `customer-portfolio.controller.ts`（类级 `AuthGuard('jwt')` + `ensureCustomer` 自检，`:24,37` 现状），客户面零权限码（client 端点不进 rbac.catalog，实证 `grep -c "client/" rbac.catalog.ts` = 0）。
- 深链：通知点开 → `/transactions?statement=<statementNo>`（Messages 路由映射见 §7）。

### 2.2 管理台（`CustomerDetail.tsx` 加一节，样板=波三协议行 `fd437465`）

- Transactions 节（`:1173-1200`）下加「Monthly statements」只读列表（月份/出具时刻/statementNo），点击展开快照摘要（逐币种期末余额即可，不整页复刻）。
- 后端挂 `GET /customers/:customerNo/statements`，权限**挂既有** `CUSTOMER_READ`（读挂既有组不增桶，与详情页同门槛）。

## §3 DSR 主体（新模块 `src/modules/identity/dsr-requests/`）

### 3.1 表 `data_subject_requests`（同一迁移 + reset 登记）

| 列 | 说明 |
|---|---|
| `id` / `requestNo` | `DSR-` 前缀业务键（生成器照 complaintNo 模式） |
| `customerId` | → customer_main |
| `type` | `ACCESS \| RECTIFICATION \| ERASURE` |
| `detail` | 客户自述（提交时必填） |
| `status` | 三态：`SUBMITTED → IN_REVIEW → RESOLVED`（显式迁移表 2 边，铁律④；RESOLVED 终态） |
| `submittedAt` / `reviewStartedAt` / `resolvedAt` | 各态时刻 |
| `dueAt` | `submittedAt + 30 天`（自然日，裁定 13），提交时一次算定（投诉同款 `complaints.service.ts:241-242`） |
| `resolutionCode` | 四值，与 type 匹配校验：`ACCESS_SUMMARY_PROVIDED` ｜ `RECTIFICATION_REVERIFY`（连带开材料请求，§4.1）｜ `RECTIFICATION_SELF_SERVICE`（指路 phone 自助改）｜ `ERASURE_REFUSED_RETENTION`（连带条款引用） |
| `resolutionNote` | DPO 答复正文（客户可见，措辞自律：不含内部调查信息，decisions:65） |
| `clauseRef` | JSON `{versionKey, section:'VI'}`（仅 ERASURE_REFUSED_RETENTION 必填）；versionKey 取该客户 `customer_agreement_consents` 最新同意版 |
| `summary` | JSON 资料摘要快照（仅 ACCESS，只写一次，见 3.2） |
| `materialRequestNo` | 仅 RECTIFICATION_REVERIFY：连带开出的材料请求号（叙事互链用） |

### 3.2 资料摘要（裁定 5）

DPO 在 IN_REVIEW 态点「生成资料摘要」，固化三块进 `summary`：

1. **档案白名单字段**（显式枚举，防 tipping-off 泄露）：customerNo、姓名/公司名、email、phone、dateOfBirth、nationality、idDocType、idDocNumber、residentialAddress、tradingTier、lifecycle、onboardingApprovedAt。**不入摘要**：riskRating、eddRequired、hardLineDispositionedAt、限制账、标签——内部合规判断一概不外露（decisions:65）。
2. **协议同意历史**：`customer_agreement_consents` 全量 `{versionKey, actedAt, decision}`。
3. **KYC 材料清单**：该客户 `material_requests` 的 `{materialType, status, issuedAt}`（客户面投影既有字段，`reason` 原文本就下发客户，照抄不加列）。

### 3.3 行为端点（admin `/admin/dsr-requests`）

列表（过滤 type/status/逾期）｜ 详情 ｜ `POST :requestNo/start-review` ｜ `POST :requestNo/generate-summary`（仅 ACCESS、仅 IN_REVIEW）｜ `POST :requestNo/resolve`（带 resolutionCode+note，type 匹配校验，RESOLVED 后一律 400——终态守卫照投诉）｜ ⚡`POST :requestNo/simulate-timeout`（`dueAt → now−1h`，终态 400，照 `complaints.service.ts:447-461` 逐行同款）。

### 3.4 客户端

- 提交页：三选一 + 自述（入口放 `CustomerProfile.tsx` 的 Audit & retention 节 `:467-484`——该节现成写着 DPO 邮箱与"thirty days"文案，正是叙事位）；controller 照 `complaints.client.controller.ts:15-40` 样板（`client/me` + JWT + ensureCustomer）。
- 我的请求列表/详情：状态、答复、摘要（ACCESS）、条款引用卡（ERASURE：展示 versionKey+§VI+原文摘录，链接 `/agreement`）。
- 办结发通知（§7）；提交/受理不发（提交是客户自己的动作，收敛判据不触发）。

### 3.5 闹钟墙第四类灯

`compliance-clock-wall.service.ts` 加 `kind:'DSR'`（`:9` 联合、`:38-55` 查询、`:98` 拼接；逾期=读时现算 `dueAt < now`，投诉同款）。前端 `ComplianceClockWallPage.tsx` 五处联动：`:18` 类型、`:73-83` 徽章/标签、`:122-130` 行点击路由（**必须加显式分支——else 兜底会错跳义务页**）、`:134-158` ⚡快进走 DSR 端点、`:194` canFastForward 加 DSR。⚠️ 单测 `compliance-clock-wall.service.spec.ts:51-75` 的 fixture 只模拟三张表，**必须同步加 `dsrRequest.findMany`，否则既有全部 getWall 用例当场炸**（实扫预警）。

## §4 衔接链三件

### 4.1 DSR → 材料请求（RECTIFICATION_REVERIFY 连带动作）

- resolve 落库后，workflow 调既有 `MaterialRequestIssuerService.issue()`（铁律③：跨主体协作在 workflow、只调主体服务方法）：`materialType: 'EMIRATES_ID'`（复用注册表既有类型，零新增——新类型要同步 5 处平行副本不值；制裁 PARTIAL 出口先例 `sanction-disposition-workflow.service.ts:382` 同款用法）、`origin: 'OPERATOR_ISSUED'`、`orderDomain: null`、不挂限制、`reason` 写中性话术（含 DSR 单号）。
- 前置：`issue()` 硬要求 `sumsubApplicantId`（`material-request-issuer.service.ts:186-191`），缺则 resolve 显式 400（演示客户全有，防呆即可）。
- 客户发现途径**零新代码**：`orderDomain=null` 的材料请求自动进 Overview/Profile 横幅堆（`profile-banners.service.ts:72-87`，CTA "Verify now" 直达提交页）。
- GREEN 后无自动分支（`MATERIAL_REQUEST_REVIEWED` 三个监听者全按 orderDomain 过滤、null 直接返回——实证），正合设计：落档是人做（4.2）。

### 4.2 改档案 admin 通道（填孤儿桶，销 BACKLOG:236）

- `PATCH /customers/:customerNo/profile`，字段白名单=CDD 七字段（`firstName/lastName/dateOfBirth/nationality/idDocType/idDocNumber/residentialAddress`，与 `CustomersService.updateOnboardingData` 既有字段表对齐 `customers.service.ts:44-60`），服务层新方法、逐字段 diff 进审计 metadata（掩码走 `audit-mask.util.ts` 既有 phone/证件规则）。
- 权限：挂既有孤儿桶 `customer.manage_profile`（`rbac.catalog.ts:1073`）+ 既有组 `CUSTOMER_WRITE`（`:18,1363`，合规官已绑定）——**零新桶零新组**，BACKLOG:236 行随波销账。
- 审计新码 `CUSTOMER_PROFILE_UPDATED`（CUSTOMER 册；旧 `CUSTOMER_UPDATED` 在退役拒写闸 `audit-actions.constant.ts:1414-1416`，不复活，新码新名）。
- 管理台：`CustomerDetail.tsx` Profile 节（`:1085`）加「Edit profile」（持 `CUSTOMER_WRITE` 可见），弹窗改七字段。

### 4.3 phone 自助改

- `PATCH /client/me/profile/phone`（client 端点零权限码；样板 `withdrawal-address.controller.ts:62-67`）；唯一冲突显式报错（`phone @unique`，schema:189）。
- 审计新码 `CUSTOMER_PHONE_UPDATED`（actor=customer，CUSTOMER 册，metadata 掩码）。
- `CustomerProfile.tsx` Identity 节 phone 行（`:308`）加行内编辑，保存后 `refreshProfile()`（hook 既有）。

## §5 权限与 RBAC 计数

- 新桶 1：`Compliance Office` 域 `compliance-office.dsr`（5→6 桶，域数 15 不变）。
- 新组 2：`DSR_WRITE`（**DPO 独占**——他的第一个经办面；DPO 枚举名实证就叫 `DPO`，`rbac.catalog.ts:173-176`）；`DSR_READ`（DPO/合规官/内审三职务，照 `COMPLAINT_READ` 三读者先例）。DPO 现 13 组（`:1315-1325`）→ 15 组。
- ⚡`simulate-timeout` 挂既有 `DEMO_CLOCK_WRITE`（金库/超管，投诉同款；DPO 是经办人但拨不动钟——与投诉"运营拨不动"同款 RBAC 交叉，是演示点不是缺陷）。
- 月结单 admin 读挂既有 `CUSTOMER_READ`；改档案挂既有 `CUSTOMER_WRITE`；闹钟墙读挂既有 `COMPLIANCE_OFFICE_VIEW`（DPO 不持有也不补发——他看自己列表页的倒计时列，墙是合规官督办视角）。
- **S13d 预期数：15 域 / 82→83 桶 / 90→92 组**。同步 `scripts/verify-rbac.ts:816-822`（标题、判据、失败提示）与 `:898` 注释、`:820` 追加 `has('DSR_WRITE')`/`has('DSR_READ')`；S16 系按新页补静态条目；行为探针补：DPO resolve 200、合规官 POST resolve 403、运营 PATCH profile 403、DPO PATCH profile 403（写面独占双向验证）。
- admin-web 联动：`rbac/permissions.ts` 加两键；`DashboardLayout.tsx` 侧栏加「Data Requests」（`DSR_READ` 门控）。
- 审批策略 +0（监听器维持 52，承接 9 的债不加重）。

## §6 审计（335 → 预期 343，+8，`audit:vocab` 机器数为准）

| 码 | 册/域 | actor | requiredFields（预期） |
|---|---|---|---|
| `STATEMENT_ISSUED` | 触达册/GOVERNANCE | system | `statementNo, periodMonth` |
| `DSR_SUBMITTED` | 触达册/GOVERNANCE | customer | `requestNo, type` |
| `DSR_REVIEW_STARTED` | 触达册/GOVERNANCE | DPO | `requestNo` |
| `DSR_SUMMARY_GENERATED` | 触达册/GOVERNANCE | DPO | `requestNo` |
| `DSR_RESOLVED` | 触达册/GOVERNANCE | DPO | `requestNo, resolutionCode` |
| `DSR_DEADLINE_FASTFORWARDED` | 触达册/GOVERNANCE | 金库/超管 | `requestNo`（照 `COMPLAINT_DEADLINE_FASTFORWARDED` 规格 `:1193`） |
| `CUSTOMER_PROFILE_UPDATED` | CUSTOMER 册 | 合规官 | `customerNo, changedFields` |
| `CUSTOMER_PHONE_UPDATED` | CUSTOMER 册 | customer | `customerNo` |

- 登记面全套（波三 `AGREEMENT_PUBLISHED` 九处样板，实扫清单在案）：平面表 + 册内四属性 + `AuditEntityTypes` 加 `MONTHLY_STATEMENT`/`DSR_REQUEST` + lark 种子文档说明行与头部手写计数 + `npm run audit:vocab` 重导 + 闭合守则三件自动验。新主体不加 workflowType（无审批链），`audit-logs.service.spec.ts:74-153` 快照不动。
- 触达册注释 `:1309`"通知+确认单+协议"改为"+月结单+DSR"。

## §7 通知（模板 17→19，`relatedOrderType` 5→7）

- 模板 +2：`STATEMENT_ISSUED`（simulateEmail:true——发出凭证正是监管戏眼）、`DSR_RESOLVED`（simulateEmail:true）。`NotificationTemplateParams`（`notification-templates.constant.ts:7-12`）扩 `periodMonth?`；执法词黑名单断言（spec `:125-131`）自动覆盖新模板；`toHaveLength(17)`（`notifications.service.spec.ts:150-151`）改 19。
- `relatedOrderType` 加 `STATEMENT`（relatedOrderNo=statementNo）与 `DSR`（=requestNo）。全量同步点（实扫清单）：`schema.prisma:1972` 注释（String 列免迁移）、`notifications.service.ts` 新增 `notifyStatementIssued`/`notifyDsrResolved`（照 `:151-177` 协议样板，含服务内逐客户吞错）、`Messages.tsx:25-32` `ORDER_ROUTES` 加两行（STATEMENT→`/transactions?statement=…`、DSR→客户端 DSR 详情）、`overview.md:104`、`v1-governance.md` 发信点计数（17→19 点）、`baseline.md` 重铺判据加两行。
- 发信时序三原则照旧（decisions 2026-10-01）；月结单通知在 sweep 内快照落库+审计之后调。

## §8 种子与 demo

### 8.1 Henry 历史腿（裁定 11 对策）

- `seed.business.ts` 给 Henry（`demo_acme`）铺**上月与上上月**各一小组腿：上上月 1 笔 AED 充值；上月 1 笔充值 + 1 笔 AED→USDT 兑换（四腿）+ 1 笔提现（两腿）——覆盖 kind 全谱，账单行像样。
- 工艺=LP 先例三件套（`seed.business.ts:2425-2487`）：TB `createTransfers` 真写（verify:coa 直读 TB，不写必红）+ `tbTransferEvidence` 回拨 `createdAt`（事件码照真实流程：`DEPOSIT_SUSPENSE_TO_PAYABLE`/`SWAP_*`/`WITHDRAW_*_POST`，确保读模型白名单认得）+ `accountFlow` 镜像（recon 模拟对账单由内部记录派生，自洽不出破口——LP 先例已证，收尾闸仍以场景 6/7 对账数照 `baseline.md` 复核兜底）。
- 腿只进账本史，不造订单行（无 depositNo 可点属可接受——账单行 refs 指向的单号在种子叙事里标注"historic"；若评审认为裸号碍眼，plan 可加极薄订单壳，当场裁）。
- Henry 不在 `DEMO_CUSTOMER_EMAILS`（`demo-lib.ts:90-96`）与 29 笔花名册——demo:all 终态比对、data.md 零 diff 判据不受扰。⚠️ 自查 `test/swap-money-arc.e2e-spec.ts:118`（self 栈拿 demo_acme 跑兑换）：若其断言被 Henry 期初余额影响，改用其断言容差/换人，plan 期核。

### 8.2 预铺与判据

- DSR 预铺**一张已办结 ACCESS 单**（演员 Grace，摘要已固化）作列表对照——现场戏（改/删）不被抢跑（承接 3）；种子直写不补审计，与投诉种子同口径。
- 重铺判据（`baseline.md` 新增）：后端起稳 ≤60 秒内 `customer_monthly_statements` 行数 = 11 客户 × 各自 2026-06 起已完整月数（铺数月份不同总数不同，判据写公式+当月快照值）；Henry 上月账单 payload 行数 ≥4；`data_subject_requests` = 1；通知表 STATEMENT 类 = 11（仅最新月规则）。
- `demo:all` 零改动（sweep 自动补齐）；`verify:coa` 必跑（Henry 种子腿动了账本——本波唯一动账本的点）。

## §9 演示（幕序改判见裁定 12）

### 9.1 幕序重排

- **新第十幕「客户的账单与资料」**：场景 33（月结单）+ 场景 34（DSR 全链）。
- **协议幕顺延为第十一幕**，场景 33→35；"必须最后+演完 reset"的硬约束随迁（`script.md:3,652` 两处总则同改）。
- 连带引用 grep 清点（判例：多处复述必漏改）：`script.md` 头部"十幕主线"→十一幕、`:648,654` 幕/场景头、`:676` 审计引用；`baseline.md`、`modules/v2-customer-compliance.md` §7、`overview.md` 凡"第十幕·场景 33"处；骨架前提 12 的"第十一幕"说法在收尾承接里订正。
- `script.md:14,24` 陈旧"14 域 68 桶"顺手改现值（与本波无关的既有漂移，只改数字不扩面）。

### 9.2 场景 33「月结单」（演员 Henry，三条件已核：干净/有种子历史/非他幕余额当事人）

管理台：合规官开 Henry 客户详情看「Monthly statements」两张历史单 → 审计中心查 `STATEMENT_ISSUED`（actor=system）。客户端：Henry 登录（已在 Quick login 11 人面板内——实扫 `CustomerLogin.tsx:14-26` 缺的是 Leo/Mona）→ 消息中心见"上月账单已出"（EMAIL_SIMULATED 徽章=发出凭证，CRM IV.D.2 台词位）→ 流水页翻上月账单（期初/行/费/期末）↔ 切回活水视图对比"固定 vs 活页"。

### 9.3 场景 34「DSR 全链」（演员 Henry）

改：客户端提 RECTIFICATION（"证件信息有误"）→ DPO 列表（倒计时列）→ 受理 → ⚡拨到期演闹钟墙 DSR 灯（金库拨，DPO 拨不动——RBAC 交叉台词）→（重拨回/或直接）resolve=REVERIFY → Henry 端横幅"Verify now"→ 提交材料 → 合规官 ⚡GREEN → 合规官 Edit profile 落档（新通道）→ 审计链 `DSR_*`+`MATERIAL_*`+`CUSTOMER_PROFILE_UPDATED` 一串点出来。
删：Henry 提 ERASURE → DPO resolve=REFUSED_RETENTION（引 v1 §VI）→ Henry 端看条款引用卡+通知。
查的对照：列表里 Grace 那张已办结 ACCESS 单点开看摘要（不现场重演）。
tipping-off 反面步（总纲 §6）：Carol/Frank 的账单与普通客户同款字样——走查步并入第六幕或本幕一句带过，spec 定为本幕末补一步。

## §10 测试与闸

- 单测：业务月函数边界；生成器（期初/期末/跨月腿/零腿币种/未知事件码走 FALLBACK）；DSR 迁移表非法跃迁拒绝、resolutionCode×type 匹配、终态 400；摘要白名单（断言 riskRating 等**不出现**——反向断言防泄露）；闹钟墙 DSR 分支+fixture 补表（§3.5 预警）。
- integration（on-stack）：DSR 全链（提交→受理→resolve 三出口）；phone 自助改+唯一冲突；PATCH profile 白名单外字段拒绝。
- 行为非文本：禁"扫源码"型断言（§7 闸门纪律）；摘要/账单断言落在 API 响应与 DB 行上。
- 随手闸①-⑤照常（前端动了 TransactionHistory/CustomerProfile/CustomerDetail/ClockWall/Messages → ⑤ preview 截图必过，**打印态不涉及**——本波无打印件，承接 7 不触发）。
- 收尾闸：⑥ demo:all + ⑦ verify:coa（Henry 种子腿动账本）+ ⑧ reset 重铺（动 schema/seed）按 `baseline.md` 新判据全绿；`verify:rbac` 显式 `API_BASE=http://localhost:<.stackports>`（承接 6，worktree 内子代理铁规）；jest 范围内 `invite-expiry` 红按既有债交代不称全绿（承接 9）；e2e 夹具缺协议行是登记在案的 TOOLING-DEBT，本波若撞上按既有债口径交代、不顺手修（§2 边界）。

## §11 文档与剧本同步（收尾按 `rules/delivery-checklist.md` 触发行过）

`modules/v2-customer-compliance.md`（DSR+phone 自助改+改档案通道，§7 后新 §8）｜ `modules/overview.md`（§4 计数 83/92、§5 技术节点、§1 表格 V2 行）｜ `modules/v7-treasury.md` 或 treasury 篇（月结单主体归属 asset-treasury，plan 定篇）｜ `demo/script.md`+`demo/data.md`+`demo/baseline.md`（§9 全量）｜ `BACKLOG.md`（:236 销账）｜ `decisions.md`（+3：无全局钟判死/月结单记账月口径/DSR 不走审批链）｜ `CHANGELOG.md` 一行 ｜ delivery 四文件 30 秒触碰检查：命中状态机（DSR 三态）、审计集（+8）、业务键（statementNo/requestNo）→ 语义合同与 decision-log 按指针式补 D-28 ｜ 下一波（若有）骨架承接：波四是丙战役末波，承接记录写进**战役收官同步**（总纲状态行+归档）。

## §12 数量表（终审逐条可点）

| 项 | 波前 | 波后预期 |
|---|---|---|
| 表 | — | +2（statements/dsr），reset 登记同步 |
| 桶/组/域 | 82/90/15 | **83/92/15**（S13d 同改） |
| 审计现役码 | 335 | **343**（+8，机器数为准） |
| 通知模板/relatedOrderType | 17/5 值 | **19/7 值** |
| 审批策略/监听器 | 51/52 | **51/52（不动）** |
| 新 admin 路由 | — | DSR 6（含⚡）+ statements 读 1 + PATCH profile 1 |
| 新 client 路由 | — | statements 2 + DSR 3 + phone 1 |
| 材料类型/孤儿桶 | 5 型/1 孤儿 | **5 型（零新增）/孤儿销账** |
| 幕/场景 | 十幕/33 | **十一幕/35** |

## §13 验收口径（总纲波四行展开）

1. 客户端翻出 Henry 上月账单截图（期初/行/期末可见，issued 标注）；同单 11 月再看一字不差（快照判据：issuedAt 后新增回溯腿不改旧单——测试造一腿验证）。
2. 一张 DSR 工单走完全程留痕：改-重核验链六步审计可点；删-拒绝信引 v1 §VI 可点开协议原文。
3. 闹钟墙 DSR 灯亮（⚡拨快）；DPO 拨不动钟、合规官写不动 DSR（RBAC 探针）。
4. 冻结客户（Carol/Frank）账单与普通客户行标题一字不差（tipping-off 反面步）。
5. 收尾闸全绿（⑥⑦⑧ + verify:rbac 新预期数），`audit:vocab`/S13d/模板数三处机器数与 §12 一致。
