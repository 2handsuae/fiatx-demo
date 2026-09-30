# 战役乙 · 波三 spec —— 资金合规与收官（NLA 红线 + 算术门 + 巡检 + 穿底主线 + 战役收官）

> 总纲：`2026-09-28-campaign-b-company-funds-charter.md` §3 波三行 ｜ 骨架：`2026-09-29-campaign-b-wave3-skeleton.md`（承接波二，已定事实不重查）｜ 体检：`checkups/2026-09-28-campaign-b-treasury-checkup.md`
> 收尾对照 `rules/delivery-checklist.md`；评审按 `rules/review-rubric.md`。本波**动钱路径（两个提单口加门）+ 动 RBAC（新桶新组 + 一处端点权限重挂）+ 联动甲事件域，评审升档**（总纲 §8 点名）。本波是**战役乙末波**，收尾额外触发总纲 §7 战役终闸六条（见 §9）。

## §0 脑暴裁定台账（2026-09-29/30，业主已拍板）

| # | 岔口 | 裁定 | 依据一句话 |
|---|---|---|---|
| 1 | NLA 事前算术门做不做（总纲岔口④） | **做**——付款单、LP 兑换单两个提单口创建时算「动后 NLA 达标吗」，不达标 400 拒建单 + 留痕；**刻意豁免**补款/垫款划转（对客户的义务优先于自身审慎缓冲——裁定 5 甲案顺序的成立前提）与注资（进项） | 现实闭环=门保自家手、巡检抓外来祸、跌破必报；V7 研究一手条款 Company VI.C.4「调仓可无亏损调穿，动前须算」正是门的条款依据。总纲原倾向「只做红线+事件」就此推翻，新事实=上述闭环论证 + 一手条款 |
| 2 | NLA 口径 | **照条款聚合计**：NLA = F_OPS(AED) + F_OPS(USDT)×钉住汇率折 AED；红线 = 1.2 × 月开支基数（写死常量）。F_SET/F_LIQ 在途**不计**（保守：未验收落定不算流动——LP 悬空期 NLA 下探是真实审慎细节，正合 VI.C.4）；三收入科目**不计**（损益口径非钱包水位）；BTC/ETH 若来不计（VI.C 合格资产筛选，现两资产恰全合格是巧合非口径） | Company VI.C.1/C.2/C.4 一手核（`reference/research/2026-07-06-v7-treasury-research.md:16`）：NLA≥1.2×月开支、只准现金等价物+锚定 VA |
| 3 | 跌破检测形态 | **巡检按钮版**（「每日核对」的演示替身，照对账跑批先例：现实里定时跑、演示里按钮当定时器的替身）——POST 实算 + 审计留痕，**零新表**；看板另有被动红横幅（全员可见，不依赖巡检）。**事故不自动生成**：巡检抓红后由 CFO 亲手登记 | 甲 E5 判语否决的是后台 cron 引擎不是巡检本身；甲波五判例「事件登记须有操作人留痕」+ PRUDENTIAL_BREACH 经办 CFO 族独占（别人代开破族独占） |
| 4 | 巡检按钮归属 | **金库**——新桶 `treasury.prudential_check` + 新组唯金库持有；形成「金库巡检发现红 → CFO 登记审慎事故」两人接力 | 2026-09-10「跑批/拨钟/推单等运行机械整组归金库」先例 |
| 5 | 穿底主线顺序 | **甲案：先补款后注资**——定损 → 补款划转（客户优先）→ 运营户真跌破红线 → 巡检抓红 → CFO 立审慎事故 → 报送 VARA → 注资补回 → 复原。失窃金额校准为「补款划得动（不打负）、划完合计跌破红线」 | 红线被真实穿越又复原，看板/巡检/报警链全有戏；总纲「注资→补款」只是甲乙案拍板时的随手顺序、未经单独论证，非翻案 |
| 6 | 兑换腿权限缺口修法（波二 §E 悬挂） | **丙案：端点改挂**——兑换腿推进端点路由权限从 `TRADING_SWAP_WRITE` 改为 `FUNDS_ORDER_ACT`，不给任何职务发新权 | 「推资金单腿归金库」是 2026-09-10 定案的顺延，端点挂错组才是病根；甲案越权污染 SoD、乙案违反定案、丁案旗舰主线切超管难看 |
| 7 | 常量单源位置 | **后端**（门要在后端算）——骨架「加前端同文件第二条常量」字面就此偏离；看板经新只读端点 `GET /admin/prudential/status` 取红线与合计，前端 `companyFundsThresholds.ts` 只留见底两常量 | 单源纪律：前后端各抄一份=同款漏改隐患（纪律 5） |
| 8 | 幕次定稿（总纲岔口⑤） | 场景 26-32 定为**第九幕「公司的钱」**（照甲先例：场景 19-25 收官定为第八幕） | 业主 2026-09-30 点头 |
| 9 | 导航归并（骨架悬挂项） | **LP 两页（LP Register / LP Exchanges）从 Custody 组迁入 Treasury 组**，V7 财资五页同组归队 | 业主 2026-09-30 点头 |
| 10 | 六节设计整体 | 2026-09-30 业主过目通过（红线与门 / 巡检与检测 / 穿底主线 / 兑换腿修复 / 收官摊子） | 本 spec 即该设计的落笔 |

## §1 已核事实（spec 起草时两路只读扫描 + 主会话抽查，plan 不必重查；file:line 为 2026-09-30 快照）

- **审慎事故链甲已建全，接电=剧本+数据，预期零新代码**：`incident-type-registry.ts:106-112` `PRUDENTIAL_BREACH`{FINANCIAL 族 / `cap.incident.fin`（CFO 独占）/ `closeActionType='INCIDENT_CLOSE_PRUDENTIAL'`（高管单步）/ `reportBasisCandidates=['COMPANY_VI_C_F']` / `requiredAnchors=['metric','shortfallAmount']`（登记时落 subjectRefs，`incident.service.ts:347-359` assertAnchors）/ `assessmentScheme='SHORTFALL'`（定损统一用 `assessedAmount` 字段，无独立 shortfall 列）/ **善后白名单空集**（不能挂任何善后单，定损即可结案）}。定损勾 reportRequired 后 `incident-assessment-workflow.service.ts:21-29` 逐码调 `RegulatoryFilingService.openForIncident()` 自动开 `INCIDENT_REPORT` 报送单；结案前置门②=名下报送单全部 submittedAt 非空。
- **失窃定性只能走 `UNAUTHORIZED_OUTFLOW`**：成因表唯一 INCIDENT 出口（`cause-registry.ts:88`，cell=ORPHAN_EXTERNAL/CLIENT）；认损调账事故分支 `assertIncidentWriteOffAllowed`（`adjustment.service.ts:241-270`）锁金额=assessedAmount、免账龄线，入口路径实际只有 UNAUTHORIZED_OUTFLOW / LARGE_UNEXPLAINED 可达——**CLIENT_SHORTFALL 走 `sourceAdvanceTransferNo` 挂接，到不了认损闸，本剧本不用它**。补款划转发起端点金额直接取自认损调账单（`internal-transfer-workflow.service.ts:68` `BigInt(adj.amount)`，前端锁死不可编辑），守卫 `reasonCode==='UNEXPLAINED_CLIENT_LOSS' && book==='CLIENT'`（事故路成立系 2026-09-06 决策实证在案）。
- **事件善后机制与注资单零交集**（全仓 grep `CapitalInjection` 零命中事件域文件）：FUNDS 族善后白名单四种（SUPPLEMENT/CLAIM/ADJUSTMENT/TRANSFER，`incident.constants.ts:63-70`），场景 31 挂 ADJUSTMENT+TRANSFER 引用即可，**不新增善后 kind**——注资单与审慎事故的关联靠剧本叙事与审计时间线，不建结构性外键（纯投机挂点，纪律 12）。
- **⚡破口铺法现状**：`recon:demo:break` 18 场景无 AED 大额客户短少（唯一事故场景⑱=Jack/USDT-TRON/400，字面量硬编码、「先跑后选」方法论 `recon-demo.ts:1698-1701`）；管理台**无**手写外部余额/账单行端点（写路径唯二=自动镜像服务+脚本直写 Prisma）→ 危机铺设须新增脚本模式（§5）。
- **付款单开单已有创建时 400 前置**（`vendor-payment-workflow.service.ts:81` initiate 内 `assertFirmOpsBalance` 不足即拒、不落库；批准时 `:152-160` 复核落 FAILED）——NLA 门插在同一位置同一形制；LP 兑换单 `LpExchangeService.create`（`lp-exchange.service.ts:29-61`）现有四守卫，门插 workflow 发起层，卖出金额字段 `sellAmount`。
- **钉住汇率单源缺口**：`3.6725` 现为 `binance-rate.provider.ts:29` 私有成员，全仓**无**独立「USDT 折 AED」工具函数（负面结论，搜索命令在扫描报告）——本波把该值提为同文件导出命名常量，provider 与审慎模块同源引用，不复制。
- **拦截留痕形制**（照抄 `WITHDRAW_L1_BLOCKED`，`withdraw-workflow.service.ts:405-424`）：单未建也留痕、outcome=DENIED、快照入 metadata、requestId 带随机后缀。
- **兑换腿端点现状**：`rbac.catalog.ts:435` route 挂 `['TRADING_SWAP_WRITE']`；前端推腿面板在 `FundsOrderDetail.tsx:218,525` 按 `FUNDS_ORDER_PUSH_WRITE` 门控——两组交集为空即波二 §E 病根。
- **RBAC/审计登记面**：PermissionGroup 并集 88（awk 计数复现在扫描报告）；Treasury 域 14 桶；新审计码五处登记（实体类型/工作流类型/平面码/契约册/写点）+ `audit-vocabulary-closure.spec.ts` 封册强制（现十五本名册）。
- **看板取数**：`CompanyFundsDashboard.tsx:185-188` 三端点（assets / tb/accounts / account-flows）；阈值刻线组件 `OperatingBalanceCard:133-139`；导航定义 `DashboardLayout.tsx:286,292`（LP 两页在 Custody）/`:305-329`（Treasury 组）。
- **金额基线（校准输入，plan 开工按当刻实测复核）**：reset 后 F_OPS(AED)=94,750,000 分=947,500.00、F_OPS(USDT)=113,600,000,000 分=113,600.000000（`demo/baseline.md:267`）；demo:all 后 USDT≈113,999.43（thresholds 文件头注实测）；客户池 AED 总额≈296,125.65（`demo/data.md:268`）；AED 大户 Bob≈257,100（其 250,000 提现单在册 PENDING_APPROVAL，校准时须核当刻钱包实值——照⑱「先跑后选」方法论）。
- **剧本现状**：八幕；场景 26-30 标「暂编」未分幕号（`script.md:408-491`）。
- **审批基数波前 51、RBAC 波前 15 域 80 桶 88 组、审计现役码波前 324、转账码 87 止**（骨架承接，不沿用旧估计）。

## §2 审慎常量与计算（后端单源）

新模块 `src/modules/asset-treasury/prudential/`（constants + service + controller）：

- `prudential.constants.ts`：`MONTHLY_OPEX_BASE_MINOR`（月开支基数，AED 分）+ `NLA_FLOOR_COEFFICIENT = 1.2`（VI.C.1 条款系数，不可配）。**候选值：月开支基数 1,000,000.00 AED → 红线 1,200,000.00 AED**；plan 开工实测钉死，取值判据见 §5 校准表。叙事口径：基数含工资/房租等系统外开支（总纲不建⑫⑬正因它们在系统外，台账里只有 HexTrust 月费恰好讲得通）。
- 汇率单源：`binance-rate.provider.ts` 的 `3.6725` 提为该文件导出命名常量（如 `AED_USD_PEG_RATE`），provider 原逻辑改引该常量（行为零变化），审慎服务 import 同一常量折算 USDT→AED。
- `PrudentialService.computeStatus()`：读 F_OPS 两币余额（既有 accounting 查询，可用余额口径与既有 `assertFirmOpsBalance` 同式 `creditsPosted − debitsPosted − debitsPending`）→ 返回 `{ perAsset 明细, nlaAedMinor, floorAedMinor, headroomAedMinor, breached }`。纯读不写。
- `PrudentialService.assertPostOutflowCompliant(currency, amountMinor, context)`：算「当前 NLA − 折算后出款额 < 红线？」，是则写 `PRUDENTIAL_GATE_BLOCKED` 审计（§3）后抛 400。

## §3 算术门（两个提单口，L1 式拒建单+留痕）

| 插点 | 位置 | 豁免声明 |
|---|---|---|
| 付款单发起 | `VendorPaymentWorkflowService.initiate`，紧邻既有 `assertFirmOpsBalance` 前置检查（同一层同一形制） | — |
| LP 兑换单发起 | `LpExchangeWorkflowService` 发起层，按 `sellAmount`/卖出币折算 | 买入腿是未来进项，不抵扣（保守口径，与 §0 裁定 2「在途不计」同轴） |
| **不插** | 内部划转（补款/垫款——义务性动作，裁定 1 豁免；场景 31 的成立前提）、注资（进项）、既有余额闸（照旧独立运行，两闸各管各的） | 豁免是业务立场非遗漏，写进 modules 篇 |

- 拒单话术（英文界面）：明说「payment/LP exchange would take Net Liquid Assets below the regulatory floor」+ 三个数（当前 NLA / 动后 NLA / 红线）。
- 审计：`PRUDENTIAL_GATE_BLOCKED`（TREASURY 域，outcome=DENIED，单未建无单号——主体挂对手方业务键 vendorNo/lpNo，资产 RELATED，metadata 记 {amount, currency, nlaBefore, nlaAfter, floor}，形制照 `WITHDRAW_L1_BLOCKED`）。
- 检查只在发起时算一次（单人顺序假设；审批时不复检 NLA——既有余额闸的批准时复核照旧，不叠加）。

## §4 巡检与状态端点

- `GET /admin/prudential/status`（只读）：挂组 `FUNDING_DASHBOARD_VIEW`（路由登记进既有桶 `treasury.view_dashboard`，持有者=看板四职务，零权限扩张）。看板据此渲染：合计 NLA 水位条 + 红线刻线（与分币种见底线分层共存）+ 跌破时全员可见红横幅（含缺口数与「register a prudential incident」提示文案，纯文案不带按钮——登记入口在事件中心，CFO 族独占）。
- `POST /admin/prudential/check`（巡检）：新桶 `treasury.prudential_check` + 新组 `PRUDENTIAL_CHECK_WRITE`（唯金库）。实算 + 写 `PRUDENTIAL_CHECK_PERFORMED` 审计（结果快照入 metadata，PASS/BREACH 同一码以 outcome 区分）+ 返回 status。**零新表**——「每日核对有据可查」由审计日志承担（铁律①满足）。
- 按钮放看板页头、只对持有人渲染（波二「看板本身不设操作按钮」陈述随之修订，修订记进 `modules/company-funds.md`）；巡检是真实业务动作（每日核对的替身），**不挂 ⚡ simulation 门控**。
- 事故登记/定损/报送/结案全走甲既有机制（§1 第一条），本波零改动。

## §5 穿底主线（场景 31/32，帧级钉死）

**危机铺设**：`scripts/recon-demo.ts` 新增独立模式（npm 脚本 `recon:demo:crisis`，必经 on-stack 包装器惯例）——只铺**一条** AED 大额未授权转出外部账单行（客户 AED 托管钱包出现一笔我方无单、客户未发起的外部流出，照⑱同构放大），**不入 18 场景常规集**，`recon:demo:break`/`pass` 与既有 baseline 判据零变动；重铺（reset）即消除，可反复演。

**金额校准表**（plan 开工按⑱「先跑后选」方法论实测钉死；候选：失窃 250,000.00 AED、月开支基数 1,000,000 → 红线 1,200,000）：

| 判据 | 式 | 候选值核 |
|---|---|---|
| 补款划得动 | 失窃额 < F_OPS(AED) 当刻 | 250,000 < ≈947,500 ✓ |
| 划完合计跌破 | NLA前 − 失窃额 < 红线 < NLA前 | ≈1,364,700 − 250,000 = 1,114,700 < 1,200,000 < 1,364,700 ✓ |
| 失窃立得住 | 失窃额 ≤ 该客户 AED 托管当刻余额（候选 Bob，须核其 250,000 在途提现的当刻影响） | plan 实测 |
| 双线齐红（加分项） | F_OPS(AED) − 失窃额 < 见底线 900,000 | 697,500 < 900,000 ✓ |
| 既有场景不误伤 | 场景 26 LP 卖出 50,000 悬空期 NLA、场景 29 付款 2,500 均仍在红线上方 | ≈1,314,700 / ≈1,362,200 > 1,200,000 ✓ |

**场景 31（暂编）· ⚡穿底：托管失窃与客户复原**（角色：金库、CFO）

1. ⚡ `on-stack … recon:demo:crisis` 铺破口 → 2. 金库跑对账，新案开、差异行 ORPHAN_EXTERNAL/CLIENT → 3. 金库差异行定性「登记事故」（成因 UNAUTHORIZED_OUTFLOW）→ 4. 金库登记 `UNAUTHORIZED_OUTFLOW` 事故（带 sourceDispositionNo，定性行自动回填 incidentNo）→ 5. 金库调查→定损（FIRM_LOSS，assessedAmount=失窃额；勾 reportRequired + `CRM_IV_E_5` → 自动开一张 INCIDENT_REPORT 报送单，本场景不展开、场景 32 一并收）→ 6. 金库开认损调账（金额锁=定损额、免账龄线）→ CFO 批 → 落账 → 7. 金库在案件行发起补款划转（金额锁=认损额）→ CFO 批 → 腿 1 推/确认（码 81）→ 腿 2 推/确认（码 82+客户侧复位）→ 划转 SUCCESS → 8. 金库重对账，案件愈合关闭 → 9. **收尾镜头**：看板 F_OPS(AED) 跌破见底线、合计 NLA 跌破红线，双线齐红、红横幅在场。（客户池已复原、公司自己撞了监管线——场景 32 的钩子。）

**场景 32（暂编）· 审慎红线：跌破 → 报监管 → 注资复原**（角色：金库、CFO、合规官、高管、MLRO）

1. 金库看板点「审慎核对」→ 结果红（NLA X < 红线 Y，缺口 Z），审计事件落 → 2. **门的现场证明**：金库试开一张付款单 → 400 拒（跌破期一切裁量出款被拦；话术三个数在屏）→ 3. CFO 事件中心登记 `PRUDENTIAL_BREACH`（subjectRefs：metric='NLA'、shortfallAmount=Z；描述引用巡检发现）→ 4. CFO 定损（SHORTFALL，assessedAmount=Z；勾 reportRequired + `COMPANY_VI_C_F`）→ 报送单自动开（即时义务、界面「未设时限」，「每日更新直至 VARA 满意」入起草叙事）→ 5. 合规官起草→送签；高管签发；合规官标已提交（对外编号）→ 6. 顺手快帧收场景 31 那张 CRM_IV_E_5 报送单（起草→送签→签发→标提交，四帧带过——通报族正戏第八幕已演过，此处只为结案前置门②闭合）→ 7. 金库开注资单（出资方=股东叙事名，金额≥缺口取整数（候选 300,000 AED），审慎目的='restore NLA compliance'）→ CFO 批 → ⚡出资方打款 → 金库确认入账 → 8. 看板 NLA 回红线上方、横幅消失；金库再巡检一次→绿（红绿两条审计记录成对照）→ 9. 高管单步结案 PRUDENTIAL_BREACH（前置：定损✓、名下报送单已提交✓）→ 10. 场景 31 事故收尾：金库挂善后引用（ADJUSTMENT+TRANSFER 两条）→ 提结案 → MLRO→CFO 两步批 `INCIDENT_CLOSE_SECURITY` → 11. 尾帧：两事故 CLOSED、看板复原、第九幕落幕。

## §6 兑换腿修复（丙案）

- `rbac.catalog.ts:435` 该 route 的 groups `['TRADING_SWAP_WRITE']` → `['FUNDS_ORDER_ACT']`（唯一改动点；controller 装饰器走 buildPermissionCode 自动跟随）；ACTION_BUCKET_CATALOG 桶挂载连带核对（该路由从兑换处理桶义移入推单桶义，桶数不变）。
- `verify:rbac` 新增探针：金库 POST 该端点 ALLOW（非 403 即过）、运营 DENY（精确 403）；改完 `db:base:sync` + 重启惯例。
- 效果：面板可见性（`FUNDS_ORDER_PUSH_WRITE`）与端点权限同源，金库两头都有、运营两头都无；收官走查主线一全程无超管。`BACKLOG.md` §E 该条销账。

## §7 权限、审计、审批（预期终态数量——改完必须对上，纪律 5）

| 计数 | 波前 | 预期终态 | 增量内容 |
|---|---|---|---|
| RBAC 域 | 15 | **15** | 不新增域 |
| RBAC 桶 | 80 | **81** | `treasury.prudential_check`（Treasury 域 14→15 桶）；`GET status` 登记进既有桶 `treasury.view_dashboard` 不增桶 |
| RBAC 组 | 88 | **89** | `PRUDENTIAL_CHECK_WRITE`（唯金库）；丙案是重挂不增组 |
| 审批类型 | 51 | **51** | **零新增**（门是 400 不是审批；巡检不设门；审慎事故结案链甲已建） |
| 审计现役码 | 324 | **326** | `PRUDENTIAL_CHECK_PERFORMED` / `PRUDENTIAL_GATE_BLOCKED`（TREASURY 域；五处登记 + 新契约册一本，封册测试基线十五→十六本；词表 326 入库重导，照波二惯例） |
| 转账码 | 87 止 | **87 止，零新增** | 穿底链全程复用既有码（81/82 划转、70 注资）；骨架「理论上零新码」坐实 |
| COA 科目 | 10 | **10** | 零增删 |
| prisma 表 | — | **+0** | 零新表零新列（本波唯一无 schema 改动的波） |
| 审批白名单表 | — | 零改动 | 无新审批类型，甲教训本波不适用（记录在案防评审误报） |

- `verify:rbac` 扩 S15 判据：S15a 审慎桶/组四处齐 ｜ S15b `PRUDENTIAL_CHECK_WRITE` 唯金库 ｜ S15c 兑换腿 route groups 恰 `['FUNDS_ORDER_ACT']`（丙案钉死防回退）；行为探针：金库 check ALLOW / 运营 check DENY / 合规官 check DENY / 高管 GET status ALLOW / 运营 GET status DENY。既有红集与波前基线恒等口径（甲判例）。
- ⚠️ 波二 MARKER 码 `cap.treasury.funding_dashboard` **必须保留**（骨架红字：删它=越权回归）；本波看板改动不碰其门控逻辑。

## §8 种子与演示同步

- **种子零改动**（无新表无基线变动；月开支基数是代码常量不是种子）。`demo/baseline.md` 增补：NLA 合计与红线的 reset 后期望值（由常量+基线推得的静态判据）。
- `demo/script.md`：场景 26-30 摘「暂编」、定稿**第九幕「公司的钱」**（裁定 8，幕题与七幕主线句续写为「…异常与监管 → 公司的钱」）；新增场景 31/32（§5 帧序）；第六幕零改动（crisis 模式不入常规破口集）。
- `demo/data.md`：GENERATED 区照生成器惯例（crisis 属按需铺设不入生成区，行为同 recon:demo:break 的临时态——重铺即消）。
- 导航归并（裁定 9）：`DashboardLayout.tsx` LP 两页迁 Treasury 组，Custody 组余下页面不动；截图闸走查两组导航。
- 走查证据目录 `checkups/2026-09-30-campaign-b-wave3-evidence/` 惯例。

## §9 战役收官（总纲 §7 终闸六条 + 收尾清单）

1. **四条主线全程走查**（第九幕 26-32 连走）：①注资→LP 铺货→客户兑换消耗库存（丙案后无超管）→见底→再兑换补货（28→26→30→26'）②反向回吐（27）③HexTrust 月费付款（29）④⚡穿底→事件→补款→跌破→报送→注资→复原（31+32，「水位跌破→事件→报送」并线其中）。
2. **§4 销账快照**：20 条枚举 + roadmap 13 条逐项四态（波内/收编/不建/满足）对照表落 `checkups/`（照甲 closeout-ledger 先例），交业主确认；⑳ 无主资金措辞照波二 spec §0 尾注。
3. **RBAC 收口**：S15 判据 + overview §4 权限包表同步（81 桶 89 组 + 巡检桶行 + 丙案重挂注记）。
4. **常规收尾闸⑥⑦⑧全触发**（战役级：波一二动过 schema/seed/COA）：`demo:all` 走通断言终态 ｜ `verify:coa`（动钱必跑，含穿底剧情中间态时点）｜ `stack.sh reset` 重铺闸对 baseline 全绿。
5. **decisions.md 一并落笔**（总纲 §7 第 5 条 + 本波新增）：F_LIQ 复活翻案（含 COA v2 局部取代声明）｜ LP 三拍板 ｜ ⑰甲案 + B1/B2 两分 ｜ NLA 门与口径（§0 裁定 1/2，含对总纲岔口④原倾向的推翻依据）｜ 巡检按钮版与归属（裁定 3/4）｜ 穿底甲案顺序（裁定 5）｜ 兑换腿丙案（裁定 6）——细节两波骨架 + 本 spec §0 已备齐，收尾只抄不脑暴。
6. **文档收口**：`modules/company-funds.md` 扩「审慎红线与巡检」节（含门的豁免立场、按钮修订注记、8 年安全港叙事收口——审慎目的字段波一二已建，本波只收叙事）；`modules/overview.md` 计数与 §4 表；`BACKLOG.md` §E 销账；`CHANGELOG.md` 一行。
7. **归档**：总纲 + 三波 spec/骨架 + 本 spec 随战役收官移入 `doc-final/archive/`（总纲头注「活文档存续到末波收官」到期）。

## §10 验收判据（可执行口径）

1. **场景 31/32 全程实走**：截图物证入惯例目录；31 含「双线齐红」收尾帧；32 含「门拒付款三个数」帧与「巡检红绿对照」两帧。
2. **算术门变异测试**（绿必须来自行为，禁扫源码文本）：跌破期开付款 400 ｜ 跌破期开 LP 兑换 400 ｜ 正常期超红线余量的大额付款 400 ｜ 正常期小额付款照常过 ｜ **补款划转在跌破期照常发起成功**（豁免的行为证明）｜ 注资在跌破期照常发起成功 ｜ 拒单审计 DENIED 落且带三个数 metadata。
3. **巡检行为**：PASS/BREACH 两种 outcome 审计各落一条；运营/合规官 POST check 403；按钮对非持有人不渲染（截图）。
4. **丙案行为**：金库经面板推完一条兑换腿全程（截图）；运营 403 探针；`verify:rbac` S15 全绿、既有红集零新增。
5. **穿底链完整性**：场景 31 结束时客户池 AED 复原到失窃前、F_OPS 差额=失窃额；场景 32 结束时 NLA ≥ 红线、两事故 CLOSED、两报送单 SUBMITTED；`verify:coa` 全程各时点全绿。
6. **既有面零回归**：`recon:demo:break` 仍 18/18、场景 26-30 重走全绿（crisis 模式隔离的行为证明）；`demo:all` 全绿。
7. 闸门：随手闸①—⑤（动 admin-web → preview 渲染+截图）；jest 本任务目录全绿；改栈脚本 → `bash scripts/stack-env.test.sh`。
8. 收官四主线走查 + §9 各项逐条对照 `delivery-checklist.md` 触发条件交付。

## §11 本波不做（对照总纲 §6 与项目总纲 §2）

每日核对 cron 引擎（巡检=按钮替身，E5 判语维持）｜ 通知推送（假设①维持，丙战役回接）｜ NLA 历史曲线/趋势图（看板只报当刻）｜ 阈值配置面（写死常量）｜ 审批时 NLA 复检（单人顺序假设）｜ 划转/注资插门（豁免是立场）｜ 新善后 kind 或注资↔事故结构性外键 ｜ `LedgerAccountList` decimals 旧缺口（§M 照旧挂账）｜ 交易域（充/提/兑）任何顺手改动——丙案只动一行路由权限登记，不碰兑换业务逻辑。
