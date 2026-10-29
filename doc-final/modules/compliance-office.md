# 合规办公室（闹钟墙 · 合规日历 · 登记册）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-10-29（甲波六·服务商与 LP 的背调与审批：外包商册改成**服务商准入**——运营申请 → 合规评估（重大服务商另有 CISO 信息安全评估）→ CFO / 高管审批 → 重大的过 VARA 事前报备门才 ACTIVE，页面抬成独立的 Service Providers，Registers 页只剩 RI 一本；新增尽调评估主体 `DDA…` / 筛查记录 `SCR…` 与横切文件 `DOC…`（LP 与服务商共用，见 §3.3）；权限组 +4、本域桶 6 → 10；审计名册 13 → 28 码；报送台第五条自动开单来路，见 §3.1 与 `modules/v9-regulatory-filing.md`）；此前 2026-10-08（报送台整备波：RI 换人批准落地后报送台自动开重大变更告知单，见 §3；`FILING_OVERDUE_MARKED` 等三键审计 metadata 对称补齐，见 §4）；此前 2026-10-03（战役丙波四：闹钟墙加第四类灯 DSR，见 §1）；此前 2026-09-27（战役甲波四：闹钟墙 / 合规日历 / 登记册两本落地，首次实数点验：15 域 73 桶 81 组）
> 演示幕次：第八幕场景 21/22（战役甲波五收官定稿，场景 22 于甲波六按新流程重写）＋第九幕场景 39/40（服务商准入，甲波六）｜ 验收：场景 21/22/39/40 走查（`demo/script.md`）+ 本篇 §5

## 0. 这是什么

合规办公室是**监管义务的统一倒计时看板 + 外包服务商准入 + RI 登记册**，挂在 V1 治理域下、与 V9 报送台共用同一张 `RegulatoryFiling` 主体（见 §2）：

- **闹钟墙**：把「对监管的死限期」——报送单的 `deadlineAt`、周期义务的 `nextDueAt`、投诉的确认 / 裁决钟与资料请求（DSR）的 30 天答复钟——聚合到一张只读表（四类灯：FILING / OBLIGATION / COMPLAINT / DSR），红/黄/绿三色一眼看出谁快到期、谁已超期。
- **合规日历**：周期性监管申报（月报/季报/年报）的义务台账，到期自动开出报送单（一期一单，翻期在生成时）。
- **服务商准入 + RI 登记册**：外包服务商不再是合规官手写一行的登记册，而是一条准入流程（甲波六，2026-10-29）——运营申请 → 合规评估（+ 重大服务商的 CISO 信息安全评估）→ CFO / 高管审批 →（重大的）VARA 事前报备门，页面是独立的 **Service Providers**，详见 §3.1 / §3.3；Registers 页现只剩 RI（Responsible Individual，受托责任人）一本，RI 换人走事前审批（合规官提、高管批）。

**它不做什么**（对照总纲 §2 与本波裁定，spec §0）：不推送提醒（只看板不推送）；不建内幕名单登记册（乙案已判纯组织件不建）；不把 HRC/HRCA 三工作日不反对窗上墙（台账只记「报了没有」，窗口到期后的动作留三域细化）；超时后果止步于「标红 + 审计留痕」，升级成事故由演示者**人工**去事故中心登记——不自动开事故、不为「超时」新造事故类型。

## 1. 闹钟墙

**端点**：`GET /admin/compliance-office/clock-wall`（只读聚合，不落新表）。返回行按归一形状展开：

```
{ kind: 'FILING' | 'OBLIGATION' | 'COMPLAINT' | 'DSR', refNo, title, authority,
  deadlineAt, overdue: boolean, status, linkKey }
```

- **FILING 行**：`deadlineAt != null && status ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF}`——按时提交即下墙；被 sweep 标过 `overdueMarkedAt` 的**红着留墙**，直到提交 / 办结 / 作废才消。数据源即 V9 报送台的 `regulatory_filings.deadlineAt`（GENERAL 族 + AML 族 + 本波新增 PERIODIC_RETURN，同一张表、同一套超时软标机制，见 `modules/v9-regulatory-filing.md` §2）。
- **OBLIGATION 行**：`status = ACTIVE` 的义务全部上墙，按 `nextDueAt` 倒计时；义务行只有绿 / 黄两色，到期即生成工单并翻期（§2），红色由生成的工单行接棒。
- **COMPLAINT 行**（2026-09-28 战役甲波五新增）：`currentStatus != 'RESOLVED'` 的每张投诉一行，`deadlineAt` 取未确认走确认钟（`ackDeadlineAt`）、已确认走裁决钟（`resolveDeadlineAt`），`clockLabel` 区分两钟，超时同样只软标变红、不自动动作——详见 `modules/complaints.md` §5。
- **DSR 行**（2026-10-03 战役丙波四新增，**第四类灯**）：`status != RESOLVED` 的每张资料请求一行，`deadlineAt` 取 `dueAt`（提交时刻 + 30 自然日单钟），`authority` 恒为 `DPO`，逾期 = 读时现算 `dueAt < now`（已办结单永不逾期）——详见 `modules/v2-customer-compliance.md` §8。**行点击**有显式 DSR 分支，落 DSR 详情页（目的页读权由路由守卫判：合规官 / 内审只读，MLRO 落 403 页）；**⚡ 快进**走 DSR 自家端点（`simulate-timeout`，`DEMO_CLOCK_WRITE`）——能同时看到墙又点得动 ⚡ 的只有超管：DPO 是 DSR 经办人但**不持 `COMPLIANCE_OFFICE_VIEW`、看不见墙**，金库有拨钟权同样看不见墙，合规官看得见墙但没有 ⚡ 列（墙是合规官督办视角，DPO 看自己列表页的倒计时列）。

**颜色三档**：红 = `overdue`（FILING / COMPLAINT / DSR 三类行都可能红——FILING 行由 sweep 标 `overdueMarkedAt`、COMPLAINT 行超时软标、DSR 行读时现算 `dueAt < now`；OBLIGATION 行只有绿 / 黄）；黄 = 剩余 ≤ 24h（聚合端点不携带锚时间戳或 `leadBusinessDays`，四种 kind 统一走「总长不可知」分支，见前端实现注释）；绿 = 其余。阈值数字是展示参数，不入验收判据。

**权限**：`COMPLIANCE_OFFICE_VIEW`（合规官、MLRO、高管、内审、CISO 五职务共持，见 §4）。

**⚡ 快进**（四条，均挂 `DEMO_CLOCK_WRITE`，金库/超管持有，审计各一条；前两条随闹钟墙 / 合规日历一并落地，后两条分别由投诉 / 资料请求两波加入，墙上 FILING / COMPLAINT / DSR 行点 ⚡ 各走自己类别的端点，OBLIGATION 的 simulate-due 不在墙行上）：
- `POST /admin/regulatory-filings/:filingNo/simulate-deadline-timeout`——把该单 `deadlineAt` 回拨到过去（仅限墙上行集内状态，终态 / 已提交单 400），30 秒内被既有 sweep 标红，落 `FILING_DEADLINE_FASTFORWARDED` 审计。
- `POST /admin/compliance-obligations/:obligationNo/simulate-due`——把 `nextDueAt` 回拨进生成窗，sweep 30 秒内当场开单（见 §2），落 `OBLIGATION_DUE_FASTFORWARDED` 审计。
- `POST /admin/complaints/:complaintNo/simulate-timeout`——把该投诉的确认钟或裁决钟（body `target`）回拨到过去，落 `COMPLAINT_DEADLINE_FASTFORWARDED` 审计（详见 `modules/complaints.md` §5）。
- `POST /admin/dsr-requests/:requestNo/simulate-timeout`——把该资料请求 `dueAt` 回拨到 now−1h（终态 400），落 `DSR_DEADLINE_FASTFORWARDED` 审计（详见 `modules/v2-customer-compliance.md` §8）。

前端按钮走 `useSimulationMode` 既有门控；合规官不持 `DEMO_CLOCK_WRITE`（不是自己的裁决人），页面上不出现任何 ⚡ 按钮——只有金库 / 超管这类持有 `DEMO_CLOCK_WRITE` **且**持有 `COMPLIANCE_OFFICE_VIEW`（金库不持有，实际能点的只有 SUPER_ADMIN）才看得到并能点，这一「无人独自持有两把钥匙」的现象是本波真实的 RBAC 交叉产物，非缺陷（见 §4）。

## 2. 合规日历

### 2.1 新主体 ComplianceObligation（表 `compliance_obligations`）

对外业务键 `obligationNo`（前缀 `OBL`）。字段：`name`/`description?`、`frequency`（`MONTHLY|QUARTERLY|SEMIANNUAL|ANNUAL`）、`authority`（既有五家受文机构目录取值）、`basisNote`（依据条款自由文本，不杜撰）、`leadBusinessDays`（生成提前量，默认 5）、`nextDueAt`、`status`（`ACTIVE|DISABLED`，显式迁移表两边）、`lastFilingNo?`（回填最近一期生成的工单号）。CRUD 全归合规官（`OBLIGATION_WRITE`）：建 / 改 / 停用 / 复用，全程审计，无硬删。

### 2.2 到期生成（一期一单，翻期在生成时）

`ComplianceObligationSweepService`（@Cron 每 30 秒，`sweep(now)` 与定时分离，逐笔 try/catch，照报送单 sweep 模板）。触发判据：`status='ACTIVE' && addBusinessDays(now, leadBusinessDays) >= nextDueAt`（正推比对，不写反推函数）。命中即：

1. `ComplianceObligationsService.claimDue()`：自表写——`nextDueAt` 按 `frequency` 翻到下一期（日历月加法 +1/+3/+6/+12，落周末不挪，v1 简化）＋ 审计 `OBLIGATION_FILING_GENERATED`。翻期在生成时完成，一期一单由构造保证，不需要去重机制。
2. `RegulatoryFilingService.openForObligation()`：开一张 `type=PERIODIC_RETURN` 报送单，`anchorAt = 该期 dueAt`（EXTERNAL 锚 → `deadlineAt = dueAt`），`authority`/`title` 从义务行带出（title 含期别，如 "VARA Monthly Regulatory Return — due 2026-09-30"），`createdByUserId='SYSTEM'`。
3. 回填 `lastFilingNo`。

工单被作废不回拨义务（下一期照走）；该期要补报走手工开单（`openManual`，EXTERNAL 锚手工路拿不到锚、`deadlineAt` 留 `null`，与 CNMR/PNMR 手工路先例同款）。

**类型目录新增 `PERIODIC_RETURN`**（十一行→十二行，详见 `modules/v9-regulatory-filing.md` §2）：`family='GENERAL'`——走既有六态六边全弧原样（合规官起草 → 高管签发 → 标已提交 → 办结），零新边、零新审批类型，定期申报要高管签字业务上讲得圆。

**实测边界发现**（T10 场景 21 走查坐实，非缺陷）：`leadBusinessDays` 默认 5 个工作日，若义务的自然期末恰好落在铺场时刻 5 个工作日以内（如月末 / 季末临近铺场日），后端服务一启动、sweep 30 秒内即自动触发生成——不需要演示者动 ⚡ 按钮。本波种子铺场当日（2026-09-27，月末季末均为 2026-09-30）即命中此边界，Monthly/Quarterly 两条义务开箱即已生成 `PERIODIC_RETURN` 单；仅 Annual（次年到期，远超提前量）需要 ⚡ 才能现场演示「快进」机制。

## 3. 服务商准入与 RI 登记册

### 3.1 服务商准入 OutsourcingVendor（表 `outsourcing_vendors`，页面 Compliance Office → Service Providers）

对外业务键 `vendorNo`（前缀 `VEN`）。**甲波六（2026-10-29）起，外包商册不再是合规官直接登记 / 修改的台账，而是一条准入流程**：运营申请 → 合规评估 → CFO / 高管审批 →（重大的）VARA 事前报备门 → ACTIVE。合规官原有的 register / update 路由整条退役（`PATCH /admin/outsourcing-vendors/:vendorNo` 不存在；`POST /admin/outsourcing-vendors` 现在是运营的「申请」），合规官只留**终止**。与波一「外包商断供」事件（`outsourcing-kyc-relay-degraded`）的呼应仍是纯叙事——不建外键、不建联动。

**申请（运营，`VENDOR_APPLY`；Service Providers 列表 → Apply，申请页 `/admin/governance/compliance-office/service-providers/new`，提交按钮 Submit application）。** 后端必填：法定名称、注册地、注册号、服务交付地 / 数据存放地（国家，逗号分隔，至少一个）、联系人 + 邮箱、服务描述、「是否受监管职能」（MLRO / CISO / DPO 等 VARA IV.A.3 允许外包的职能；**答 Yes 时发牌机构 + 牌照号必填**，否则选填）、合同起始日、「涉及个人数据」「涉及机密信息」、申请理由、重大性自判四问与「换掉难不难」；选填：实际控制人（序号规则同 LP，重提不重排）、合同终止日、年费用 + 币种、是否分包 + 分包商名单。所有 Yes/No 题**没有默认答案**，页面逼着点选。材料可缺（PDF / PNG / JPG，单份 ≤ 10 MB），页面按答案出槽位：一般档 = 注册证书 + 服务合同；受监管职能加牌照副本；重大档再加股东 / 实际控制人名册、最近财报、SOC 2 / ISO 27001 证书、灾备计划、分包商名单、保险单（共九类 `VENDOR_DOC_TYPES`）。提交即建档为 `PENDING_ASSESSMENT`，同一动作里自动开尽调评估 `DDA…`。

**重大性判定（系统规则，运营改不了）。** 四问对应 VARA Schedule 1「关键或重要职能」定义 (a)–(d)：断了会不会影响牌照合规 / 其他法律义务 / 财务表现 / 核心业务连续性；纯函数 `judgeCriticality`：**任一答「会」→ `MATERIAL`，四问全「不会」→ `NON_MATERIAL`**，结果在提交时落库、列表与详情都显示（Material / Non-material 徽章）。「换掉难不难」（Easy / Hard to replace）只供合规参考，不参与判定；申请表里没有 `criticality` 这一项。合规官评估时可把 NON_MATERIAL **升**为 MATERIAL（详情页 Materiality 区 Upgrade to MATERIAL，理由必填，审计 `VENDOR_MATERIALITY_UPGRADED`），**不可降**；被退回重提时即使四问都改成「不会」，已升为重大的仍是重大。服务商的审批**只按重大性分流**，风险档（Low/Medium/High）是合规判断的留痕、不改审批路线——合规官认为风险高到该走两步的，用「升档」这条规则。

**状态机：七态十边**（`compliance-office.constants.ts` `VENDOR_TRANSITIONS`）。
```
PENDING_ASSESSMENT ──Return for documents(合规官,原因必填)──▶ RETURNED ──Edit & resubmit(运营)──▶ PENDING_ASSESSMENT
PENDING_ASSESSMENT ──Reject(合规官,原因必填)──▶ REJECTED（终态）
PENDING_ASSESSMENT ──Send for approval(硬规则全过)──▶ PENDING_APPROVAL
PENDING_APPROVAL ──approve[NON_MATERIAL: CFO 单步]──▶ ACTIVE
PENDING_APPROVAL ──approve[MATERIAL: CFO → 高管]──▶ PENDING_NOTIFICATION ──告知单被标已提交──▶ ACTIVE
PENDING_APPROVAL ──reject/timeout──▶ REJECTED ｜ ──cancel(提单人合规官/超管)──▶ PENDING_ASSESSMENT
ACTIVE ──terminate(合规官)──▶ TERMINATED（终态）
```
十条边 = 设计稿的九条新边 + 既有的 `ACTIVE→TERMINATED`；两种批准落点（ACTIVE / PENDING_NOTIFICATION）共用审计码 `VENDOR_APPROVED`，靠 `toStatus` 区分；每条边在 `VENDOR_ACTION_BY_EDGE` 里有一条审计码，写入前先过完整性闸（缺码抛 500 且**先于**落库）。**出发态钉死**（共享迁移表里有可被借用的边）：`resubmit` 只收 `RETURNED`；`conclude` 只收 `PENDING_ASSESSMENT`；`terminate` 只收 `ACTIVE`；报备门认领只收 `PENDING_NOTIFICATION`（通向 ACTIVE 的边有两条，不钉的话一条带着告知单号却停在 `PENDING_APPROVAL` 的行会被「已报送」事件无痕放进 ACTIVE，绕开审批门）。**SLA 答复：各态不计时**——`PENDING_APPROVAL` 靠审批单自身 48h 兜底，`PENDING_NOTIFICATION` 无时限（告知单本身无钟）。

**合规评估 + CISO。** 评估与 LP 完全同款（同一个尽调评估主体、同一套筛查记录、同一个前端区块，见 §3.3），风险档照填；**Return / Reject / Send for approval 三个动作只在「待评估」态可下**——被退回的申请必须先由运营 Edit & resubmit，合规官才能再下结论，退回期间筛查记录、评估表单、CISO 评估仍可编辑（为重提后的评估备料）。**重大服务商**多一段 CISO 信息安全评估（`INFOSEC_ASSESSMENT_WRITE`，CISO 独占；NON_MATERIAL 不开这一段）：SOC 2 / ISO 27001（Held / None / Expired）、数据存放地可接受（Yes/No）、灾备计划可接受（Yes/No）、意见、结论（Acceptable / Not acceptable），按钮 Record CISO assessment（已填后为 Update CISO assessment，送审前可重填）。门：重大且 CISO 评估未填 → Send for approval 置灰「Waiting for the CISO assessment」（后端 `Waiting for CISO information-security assessment`）；CISO 结论 Not acceptable → 只能 Reject，Return for documents 与 Send for approval 两个按钮都不出现（后端同拒：红灯同款——任一筛查记录为 Red 也只能 Reject）。

**审批。** `NON_MATERIAL` → `VENDOR_APPROVAL`（CFO 单步）；`MATERIAL` → `VENDOR_MATERIAL_APPROVAL`（CFO → 高管 `SENIOR_MANAGEMENT_OFFICER` 两步），均 48h、可撤。提单人 = 点 Send for approval 的合规官，审批理由取评估意见，载荷快照 `{vendorNo, name, serviceDescription, criticality, deliveryLocations[], riskTier, assessmentNo}`；批准 → 一般 `ACTIVE` / 重大 `PENDING_NOTIFICATION`，驳回或超时 → `REJECTED`，撤单 → 回 `PENDING_ASSESSMENT`（评估壳保留）。

**VARA 事前报备门（只对 MATERIAL）——报送台第五条自动开单来路。** 重大服务商审批通过后，`OutsourcingVendorWorkflowService#onDecided` 先把它迁到 `PENDING_NOTIFICATION`（待报备，页面 Pending VARA notification），再调 `RegulatoryFilingService#openForVendorNotification` 开一张 `MATERIAL_CHANGE_NOTIFICATION`（`DRAFT`、`createdByUserId='SYSTEM'`、受文机构 VARA、无钟，标题 `Material outsourcing — <服务商名>: onboarding`，正文预填五行：Provider / Scope / Delivery & data locations / Materiality / Contract start），再把单号盖回服务商（`notificationFilingNo`，审计 `VENDOR_NOTIFICATION_OPENED`）——**报送单表没有 entityRef 列、本波不动，关联方向由服务商自己记单号**（各管各的）；该单的 `FILING_OPENED` 审计 metadata 带 `source: 'VENDOR_ONBOARDING'` / `vendorNo` / `approvalNo`。合规官把这张单沿既有 GENERAL 族六态走：Submit for Sign-off → 高管（`sm@`，`REG_FILING_SUBMIT`）Approve → Mark Submitted 填 VARA 回执号（External Reference）。`markSubmitted` 此前**不发事件**，本波新增领域事件 `regulatory-filing.submitted`（`DOMAIN_EVENTS.REGULATORY_FILING_SUBMITTED`，载荷 `{filingNo, type, externalRef}`，在状态落库与 `FILING_SUBMITTED` 审计之后发出）；服务商 workflow 监听它，按 `notificationFilingNo` 反查认领，命中且仍是 `PENDING_NOTIFICATION` 才迁 `ACTIVE`（审计 `VENDOR_ACTIVATED`，`causationId` = 告知单号，reason 带回执号），其余报送单的「已报送」一律静默忽略。**待报备期间付款单照拦**：金库付款单对「服务商必须 ACTIVE」的既有门（`assertActiveByNo`）不动；前端 Vendor Payments 的收款方下拉列出所有非 TERMINATED 的服务商，非 ACTIVE 的**置灰并标状态**（如「— Pending VARA notification」），演示者先指给观众看，签发之后回来它就能选了。一般服务商不报备、批完直接 ACTIVE。**非原子（照实）**：状态已落 `PENDING_NOTIFICATION` 后若开单抛错，不补偿、不重试——登 `PRODUCTION-NOTES.md`（2026-10-29）。**告知单被作废后没有回退边**，服务商卡在待报备——这是正常单人操作就能触发的业务缺口，登 `BACKLOG.md` §L（2026-10-29）。

**终止（合规官，`VENDOR_REGISTER_WRITE`，详情页 Terminate → 弹层 Notes 选填 → Confirm termination）。** 只收 `ACTIVE`，终态零出边。终止**重大**服务商时同样自动开一张告知单（标题 `…: termination`，metadata `source: 'VENDOR_TERMINATION'`），但**不卡终止**（先终止后开单）、**不盖章**（服务商的 `notificationFilingNo` 仍指向入驻那张，终止单的「已报送」认领不到任何服务商）；一般服务商终止不开单。

**侧栏（对运营）。** Compliance Office 组按权限过滤，运营能看到 Service Providers（`VENDOR_READ`）；但他同时持有的既有项 **Sumsub Events**（`SUMSUB_EVENT_VIEW`，2026-10-06 起就在本组末位）也会一并露出——所以是两项而不是一项，本波不动 Sumsub Events 的位置。

**种子（四家）**：Sumsub（Material，ACTIVE）、HexTrust（Material，ACTIVE）、Gulf Office Systems（Non-material，ACTIVE）都按「已走完全流程」补齐评估、材料、审批单（重大的另带一张已签发并报送的历史告知单与 VARA 回执号）；新增 Pearl Clean Services LLC（Non-material，`PENDING_APPROVAL`，评估已做，CFO 一步待批——其审批单超时点钉在 2099-12-31，免得起栈一分钟后被过期扫描判死）供场景 40 使用。逐项数据见 `demo/data.md`。

### 3.2 RI 册 ResponsibleIndividual（表 `responsible_individuals`）

对外业务键 `riNo`（前缀 `RI`）。字段：`position`（岗位名自由文本，演示合理集非法定名录）、`incumbentName`（自然人姓名，与 IAM 账号无外键无联动）、`varaRef?`、`effectiveFrom`、`pendingApprovalNo?`（在途换人审批单号，一席一在途，非空时再提 400）、`status`（`ACTIVE` 常驻，v1 无退席位边）。

- **建席位**：合规官（`RI_REGISTER_WRITE`）。
- **换人（事前审批，本册唯一流程戏）**：合规官提 `RI_REPLACEMENT` 审批（新任姓名 + 生效日 + 理由 + `varaRef?`）→ **高管单步批**（`ApprovalActionTypes.RI_REPLACEMENT`，策略 `{steps:[{stepNo:1,roles:['SENIOR_MANAGEMENT_OFFICER']}], timeoutHours:48, allowCancel:true}`，照 `SANCTION_DISPOSITION` 先例注册）→ `ri-replacement-workflow.service.ts`（`onDecided` 监听，照 `sanction-disposition-workflow.service.ts` 先例）调服务方法落地：换 `incumbentName`/`effectiveFrom`/`varaRef`、清 `pendingApprovalNo`、审计 `RI_REPLACEMENT_APPLIED`（携 `fromIncumbent`/`toIncumbent`）；**落地后紧接着横向调 `RegulatoryFilingService.openForRiChange()`，在报送台自动开一张 `MATERIAL_CHANGE_NOTIFICATION`（DRAFT、`SYSTEM` 开单、无钟，标题 `Responsible Individual change — <席位>: <旧任> → <新任>`；2026-10-08 报送台整备波），合规官接手走 GENERAL 六态原样**——不建外键、RI 行不回填 `filingNo`，双向可查靠标题与该单 `FILING_OPENED` 审计的 `riNo`/`approvalNo`；开单失败时换人不回滚（非原子，已记 `PRODUCTION-NOTES.md`）。驳回 / 撤单 / 过期 → 只清 `pendingApprovalNo` + 审计 `RI_REPLACEMENT_REJECTED`，不换人、不开单。详见 `modules/v9-regulatory-filing.md` §2.2。
- 换人史靠审计链可查：`RI_REPLACEMENT_APPLIED` 这条审计的 `metadata` 里直接落着 `fromIncumbent`/`toIncumbent`/`approvalNo` 三键（T8 评审修复——`extra` 顶层字段此前只供 `assertActionSpec` 校验、不落库，已镜像进 `metadata`，见 §5 R5），管理台审计详情页 Payload/Metadata 区可直接读到「谁换了谁」，场景 22 走查已实证（`doc-final/superpowers/checkups/2026-09-27-act-a-wave4-evidence/22-04-ri-replacement-audit-from-to.png`）。

### 3.3 尽调评估（`DDA` / `SCR`）与文件（`DOC`）——LP 与服务商共用

**尽调评估 DueDiligenceAssessment**（表 `due_diligence_assessments`，业务键 `DDA…`）。每个 LP / 服务商申请提交时自动开一份（审计 `DD_ASSESSMENT_OPENED`），`targetType`（`LIQUIDITY_PROVIDER` | `OUTSOURCING_VENDOR`）+ `targetNo`（lpNo / vendorNo）唯一。字段：风险档（LOW / MEDIUM / HIGH）、评估意见、附加条件、**最新一轮**结论（`RETURNED` / `REJECTED` / `SENT_FOR_APPROVAL`）+ 原因 + 落结论的时间与人、CISO 信息安全评估（`soc2` / `iso27001`：HAS | NONE | EXPIRED；数据存放地可接受 / 灾备计划可接受两个布尔；意见；结论 ACCEPTABLE | UNACCEPTABLE；登记人与时间）。**评估本身没有状态列、不另立迁移表**——铁律④的主体是 LP / 服务商；评估能不能改完全跟着所属对象的状态：`PENDING_ASSESSMENT` 或 `RETURNED` 可写，送审后一律锁（`Assessment is locked`），撤单回待评估即重新解锁。结论覆盖存最新一轮，往轮历史看审计时间线（每次落结论都有 `DD_ASSESSMENT_CONCLUDED`，metadata 带结论、原因、风险档）。

**筛查记录 ScreeningRecord**（表 `screening_records`，业务键 `SCR…`，挂在评估下）。字段：`subjectKind`（`COMPANY` | `BENEFICIAL_OWNER`）、`subjectName`、`uboSeq`（实际控制人必填，指认申请表里的第几位）、`listsChecked`（UN / OFAC / EU / UAE_LOCAL / PEP / ADVERSE_MEDIA 多选）、`result`（GREEN / YELLOW / RED）、`screenedAt`、证据文件号 `evidenceDocNo`（每条最多一张，重传则指针换新、旧文件留在盘上）、登记人。**筛查是合规官人工登记，系统不自动筛**（业主乙案，`decisions.md` 2026-10-28）；每条登记写 `DD_SCREENING_RECORDED`（SCR 作 RELATED 子主体，审计页按 SCR 号也搜得到）。

**送审五道硬规则**（`DueDiligenceService#assertSendable`，两线共用，按序、第一道不过就拒，不攒错）：①评估下**任一条**筛查记录为 RED → 只能不通过；②公司与**现有**每位实际控制人缺「身份对得上」的记录 → 点名拒；③风险档未定；④（仅重大服务商）CISO 评估未填；⑤CISO 结论不可接受 → 只能不通过（不看是否重大，已登记的不可接受结论照样挡）。②③④只拦「送审」；Reject 不经任何前置检查；Return 经 `DueDiligenceService#assertReturnable`，只过第①⑤两道（同文案：红灯 / CISO 不可接受时退回补料也拒，评估结论只许不通过），缺名 / 未定档 / 等 CISO 都不拦退回。**「身份对得上」（R4）**：公司 = 同类（COMPANY）且名字相同；实际控制人 = 序号相同**且**名字相同；名字比对首尾去空白、大小写不敏感。所以**改名、换人都要补一条新的筛查记录**；被删者的记录留在库里但不再计入「已筛」——它若是 RED，仍按第①道挡住送审（红灯规则是字面的）；前端在重提时保持既有序号不变，免得换人后新人继承了旧人的序号和记录。**黄色不自动绑任何东西**——它是合规官定档、写附加条件的依据，不强制档位、不改审批路线。

**文件 StoredDocument（`DOC…`）——系统首次存文件**（横切件 `src/core/documents/`，表 `stored_documents`）。归属 `ownerType` ∈ `LIQUIDITY_PROVIDER | OUTSOURCING_VENDOR | SCREENING_RECORD` + `ownerNo`（LPP… / VEN… / SCR…）+ 文件类别（LP 六类、服务商九类、筛查证据一类）。只收 PDF / PNG / JPG，单份 ≤ 10 MB，超限直接 400，不做分片 / 病毒扫描 / 版本 / 去重；落盘扩展名按校验后的 MIME 定，不信客户端文件名。**存哪**：栈数据目录下的 `files/`（主栈 `/tmp/exchange_js_main/files/`、worktree `/tmp/exchange_js_wt_<名>/files/`；云端 `/run/exchange-demo/files/`，与 SQLite 同在 systemd 的 `RuntimeDirectory`，服务重启即清，正合「每次启动从零铺数据」），环境变量 `FILE_STORAGE_DIR` 由栈脚本同路推导并注入、`deploy/demo.env.template` 渲染，`stack.sh reset` 连目录一起清；路径 `${FILE_STORAGE_DIR}/${ownerType}/${ownerNo}/${docNo}${ext}`。种子占位 PDF 由种子脚本当场生成（几百字节的合法 PDF，仓库里不放二进制）。**上传留痕** `DOCUMENT_UPLOADED`（metadata 记归属对象与类别）；**下载不留痕**（非持久化动作）。**下载**：`GET /admin/documents/:docNo/content`，流式 inline 返回，前端用带 token 的 fetch 取成 blob 在新窗口打开，从不直链磁盘路径；RBAC 门为 `LP_READ` 或 `VENDOR_READ` 任一（OR 粗门，仅持其一的职务能打开另一线的文件——登 `PRODUCTION-NOTES.md`）。

## 4. 权限、审计、RBAC

**`Compliance Office` 域桶表**（波四时点本域四桶、RBAC 15 域 73 桶 81 组；2026-09-28 波五后 75 桶 83 组，权威快照见 `overview.md` §4；此后丙波三 / 四加 `.agreements` / `.dsr` 两桶，**甲波六（2026-10-29）再加四桶** `.view_vendors` / `.apply_vendor` / `.due_diligence` / `.infosec_assessment`——本域现 10 桶，全 RBAC 现 15 域 87 桶）：

| 桶 | 组 | 持有 |
|---|---|---|
| `compliance-office.view`（看闹钟墙 / 日历 / 登记册） | `COMPLIANCE_OFFICE_VIEW` | 合规官、MLRO、高管、内审、CISO |
| `compliance-office.obligations`（管周期义务台账） | `OBLIGATION_WRITE` | 合规官独占 |
| `compliance-office.vendors`（**只剩终止服务商**，登记 / 修改已退役） | `VENDOR_REGISTER_WRITE` | 合规官独占 |
| `compliance-office.view_vendors`（看服务商列表 / 详情 / 评估 / 材料） | `VENDOR_READ`（甲波六） | 合规官、CISO、CFO、高管、内审、金库、运营七职务 |
| `compliance-office.apply_vendor`（申请 / 重提 / 传材料） | `VENDOR_APPLY`（甲波六） | 运营独占 |
| `compliance-office.due_diligence`（LP 与服务商共用：登记筛查 / 传证据 / 保存评估 / 下结论 / 升档） | `DUE_DILIGENCE_WRITE`（甲波六） | 合规官独占 |
| `compliance-office.infosec_assessment`（重大服务商的信息安全评估） | `INFOSEC_ASSESSMENT_WRITE`（甲波六） | CISO 独占 |
| `compliance-office.ri`（管 RI 册 + 提换人） | `RI_REGISTER_WRITE` | 合规官独占 |

不需要 `cap.*` 服务层族独占——本波三个写面各自单一经办人，路由门即精确门（与波三「两个经办人共享同一组写路由」的场景不同，无需按族再分权）。高管新增 `RI_REPLACEMENT` 裁决位，随之补持 `COMPLIANCE_OFFICE_VIEW`。⚡ 两条新路由挂既有 `DEMO_CLOCK_WRITE`（金库，Demo Instruments 桶描述扩一句，不加桶不加组）。

**甲波六的四个新组（2026-10-29）。** `VENDOR_READ` **替换**原来两条 GET 的 `COMPLIANCE_OFFICE_VIEW | FUNDING_WRITE` OR 粗门——CFO 两者皆无，而两步审批的每个批准人都得读得到详情，所以要一个明确的读组、不借 `COMPLIANCE_OFFICE_VIEW`（借了它的话「恰五职务」判据就破）；代价是 MLRO（原靠 `COMPLIANCE_OFFICE_VIEW` 读得到服务商）不再能读。`DUE_DILIGENCE_WRITE` 是合规官在两条线上的唯一评估写门，也是四条新审批策略（含 LP 的两条）的 maker 组（`MAKER_GROUP_BY_POLICY`），裁决人 CFO / 高管均不持它（无自批死锁）；评估视图与文件列表归读组（LP 线 `LP_READ`、服务商线 `VENDOR_READ`），高管因此补持 `LP_READ`。`VENDOR_REGISTER_WRITE` 在路由上只剩 terminate。新增 admin 端点均已在 `rbac.catalog.ts` 用 `route()` 登记，`GET /admin/documents/:docNo/content` 无桶、门为 `LP_READ | VENDOR_READ`。

**审计名册现 28 码**（domain GOVERNANCE，`COMPLIANCE_OFFICE_AUDIT_ACTIONS`，独立常量组照 filing 先例；2026-09-27 时点 13 码、全库现役 273→286，甲波六净 +15 码）：周期义务 5 码 `OBLIGATION_REGISTERED` / `OBLIGATION_UPDATED` / `OBLIGATION_STATUS_CHANGED` / `OBLIGATION_FILING_GENERATED` / `OBLIGATION_DUE_FASTFORWARDED` ｜ 服务商 12 码 `VENDOR_APPLIED`（铸旅程，必填 `criticality`）/ `VENDOR_RETURNED` / `VENDOR_RESUBMITTED` / `VENDOR_REJECTED`（合规不通过）/ `VENDOR_SENT_FOR_APPROVAL` / `VENDOR_APPROVED`（一般 →ACTIVE、重大 →PENDING_NOTIFICATION，`toStatus` 区分）/ `VENDOR_APPROVAL_REJECTED`（审批驳回或超时）/ `VENDOR_APPROVAL_CANCELLED`（撤单）/ `VENDOR_ACTIVATED`（报备完成转 ACTIVE）/ `VENDOR_TERMINATED` / `VENDOR_MATERIALITY_UPGRADED`（必填 `reason`）/ `VENDOR_NOTIFICATION_OPENED`（必填 `filingNo`）——状态边码都必填 `fromStatus` / `toStatus` ｜ 尽调评估 5 码 `DD_ASSESSMENT_OPENED`（铸旅程，必填 `targetType`）/ `DD_SCREENING_RECORDED`（必填 `result`）/ `DD_ASSESSMENT_SAVED`（`riskTier`）/ `DD_INFOSEC_RECORDED`（`verdict`）/ `DD_ASSESSMENT_CONCLUDED`（`conclusion`），后四码继承评估旅程 ｜ 文件 1 码 `DOCUMENT_UPLOADED`（必填 `docType`）｜ RI 4 码 `RI_SEAT_REGISTERED` / `RI_REPLACEMENT_PROPOSED` / `RI_REPLACEMENT_APPLIED` / `RI_REPLACEMENT_REJECTED` ｜ `FILING_DEADLINE_FASTFORWARDED`（挂本组而非 `REG_FILING_AUDIT_ACTIONS`，单步演示动作无旅程可继承）。**不新建注册表对象**（新建要连改 `audit-logs.service` 的 `??` 链、闭合 spec 的「十八册」文案与词表导出）：服务商 / 评估 / 文件的码进本册，LP 的码进 `CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS`。退役原「登记」「修改」两个服务商审计码（已入 `DEPRECATED_AUDIT_ACTIONS`，写点已删）。2026-10-29 全库现役 **378 码**（GOVERNANCE 域 69；取自各名册并集——`npm run audit:vocab` 因说明种子未补 21 个新码而 exit 1，见 `TOOLING-DEBT.md` 既有条目）。

**R5 修复（T8 评审）**：`RI_REPLACEMENT_APPLIED` 等码此前 `fromIncumbent`/`toIncumbent`/`frequency`/`criticality`/`position`/`nextDueAt`/`dueAt`/`filingType`/`deadlineAt`/`approvalNo`/`decision` 这些展示级字段只在写入时供 `assertActionSpec` 校验必填、不落任何持久化列——审计详情页查不到。已把这些字段镜像进 `metadata` JSON（`extra` 校验形态保留不动，双落而非改字段结构）。波二遗留的同类写点已于 2026-10-08 报送台整备波补齐：`FILING_OVERDUE_MARKED` 的 `deadlineAt`、`FILING_SUBMITTED` 的 `externalRef`、`FILING_ENTRY_LOGGED` 的 `kind` 三键现均镜像进 `metadata`，与本波新写点处理方式对称（`extra` 校验形态同样保留）。

**`verify:rbac` 扩判据**（波四口径）：新域四处齐（route / 桶目录 / 职务绑定）＋ 三写组唯合规官 ＋ `COMPLIANCE_OFFICE_VIEW` 恰五职务 ＋ 行为探针（合规官三写面可写、其余职务 403、RI 在途重复提 400、高管可批换人、内审仍零写、⚡ 唯金库/超管）。收尾口径（Ruling R4）：本波新增判据全绿，既有红集（`S7`/`BACKLOG:234` COMPLIANCE_OFFICER 孤儿组）与波前基线恒等、不新增。**甲波六后本域的组不再全归合规官**（`VENDOR_APPLY` 运营、`INFOSEC_ASSESSMENT_WRITE` CISO、`VENDOR_READ` 七职务），本节所列「三写组唯合规官」「恰五职务」只对波四原有的三个写组与 `COMPLIANCE_OFFICE_VIEW` 成立，`verify:rbac` 对本域的判据口径随之由 Task 10 改写（以脚本实跑为准）。

## 5. 演示脚本

**场景 21 · 闹钟墙与合规日历**（墙现为四类灯——报送单 / 周期义务 / 投诉 / DSR；本场景只走前两类，投诉灯与 DSR 灯分别在各自场景里演）：看墙（报送单钟 + 三条义务倒计时）→ ⚡ 义务快进 → 工单当场出现在墙上与报送台 → 合规官起草送签 → 高管签发 → 标已提交 → 义务翻期；再 ⚡ 报送单超时 → 墙上变红 + 审计留痕 → 口播「升级出口 = 人工登记事故」（不实际登记，指给观众看入口）。

**场景 22 · 登记册（RI）**：RI 换人提单 → 高管批准 → 名册翻新 → 报送台自动多出一张重大变更告知草稿单 → 审计链回查（`RI_REPLACEMENT_APPLIED` 携 from/to）。外包商已不在这一页——服务商准入是场景 39 / 40（甲波六重写）。

**场景 39 · 服务商重大路**：运营申请「Nimbus Cloud Hosting LLC」，四问答一个「会」→ 系统判重大 → 合规官逐名筛查、定档 → CISO 填信息安全评估 → 合规官送审 → CFO 批、高管批 → 待报备（付款单下拉里它置灰）→ 报送台那张自动开出的告知单送签、高管签发、标已提交填回执号 → 服务商 ACTIVE → 付款单可选它。**场景 40 · 服务商一般路**：CFO 直接批 Pearl Clean Services LLC → ACTIVE，三十秒，对照「一般的不报备」。

完整走查步骤见 `demo/script.md`「场景 21」「场景 22」「场景 39」「场景 40」四节；波四走查截图（真实 self 栈渲染，含账号切换与判据核对）入 `doc-final/superpowers/checkups/2026-09-27-act-a-wave4-evidence/`（`21-01`~`21-06`、`22-01`~`22-04`；其中 `22-01`、`22-02` 拍的是已退役的 Registers 页 Vendors tab，仅作历史留底）；甲波六服务商页截图入 `doc-final/superpowers/plans/artifacts/2026-10-28-partner-due-diligence/`。

## 6. 关键技术节点

- 后端模块 `src/modules/governance/compliance-office/`：`compliance-clock-wall.service.ts`（只读聚合）｜ `compliance-obligations.service.ts` + `compliance-obligation-sweep.service.ts`（@Cron 30s）｜ `outsourcing-vendors.service.ts`（七态十边迁移表 / 申请 / 重提 / 升档 / 终止 / 盖单号）+ `outsourcing-vendor-workflow.service.ts`（申请 / 评估编排 / 送审 / 审批裁决回流 / 报备门认领 / 终止联动开单）+ `outsourcing-vendor-approval.service.ts`（`VENDOR_APPROVAL` 与 `VENDOR_MATERIAL_APPROVAL` 两个 handler）｜ `due-diligence.service.ts` + `due-diligence.constants.ts`（尽调评估 `DDA` / 筛查记录 `SCR`，LP 线同用，见 §3.3）｜ `responsible-individuals.service.ts` + `ri-replacement-workflow.service.ts` + `ri-replacement-approval.service.ts` ｜ 挂载 `compliance-office.module.ts`（同域下 governance.module.ts 既有惯例）
- 端点：`GET .../clock-wall`；`compliance-obligations` 五条（list/detail/create/update/status，+⚡ `simulate-due`）；`outsourcing-vendors` 十四条（GET list / detail / `:vendorNo/documents` / `:vendorNo/assessment`；POST apply〔= 根路径 POST〕/ `:vendorNo/resubmit` / `:vendorNo/documents`；评估写 `assessment/screening-records` / `…/screening-records/:recordNo/evidence` / `PATCH assessment` / `assessment/conclude` / `assessment/upgrade-materiality` / `assessment/infosec`；`:vendorNo/terminate`）；文件下载 `GET /admin/documents/:docNo/content` 在横切件 `src/core/documents/`；`responsible-individuals` 四条（list/detail/create/replacement）；报送单 ⚡ `simulate-deadline-timeout` 挂在 V9 域路由（详见 `modules/v9-regulatory-filing.md`）
- 前端 `admin-web/src/pages/ComplianceClockWallPage.tsx` / `ComplianceObligationListPage.tsx` / `ComplianceRegistersPage.tsx`（现只剩 RI 一本）；甲波六新增 `ServiceProvidersPage.tsx`（列表 + 状态筛选 + Apply）/ `ServiceProviderApplyPage.tsx`（新申请与重提共用一页）/ `ServiceProviderDetailPage.tsx`（Service Provider / Application / Materiality / Beneficial Owners / Documents / Due Diligence 含 CISO 区 / Approval / VARA Notification 各块 + Terminate）；Documents / Due Diligence 两块与 LP 详情页共用组件（`components/compliance/`）；侧边栏 Compliance Office 组在 Obligations 与 Registers 之间加 `Service Providers`（`VENDOR_READ`）；Vendor Payments 付款单下拉改为列全部非终止服务商、非 ACTIVE 置灰
- 单号前缀 `OBL`/`VEN`/`RI`（`generateReferenceNo()` 共享工具），甲波六新增 `DDA`（尽调评估）/ `SCR`（筛查记录）/ `DOC`（文件，`FIL` 已被报送单占用）；Prisma 表 `compliance_obligations`/`outsourcing_vendors`/`responsible_individuals` 三表互无外键、无横向联动，闹钟墙聚合是唯一跨表读点且只读；`outsourcing_vendors` 甲波六加 24 列（申请字段 / 重大性四问 / `approvalNo` / `notificationFilingNo` 等）、默认状态改 `PENDING_ASSESSMENT`（迁移 `20261029060000_vendor_due_diligence`），另新三表 `stored_documents`（迁移 `20261029030000`）/ `due_diligence_assessments` + `screening_records`（迁移 `20261029040000`）；`reset` 登记顺序先 `storedDocument` → `screeningRecord` → `dueDiligenceAssessment`，再到服务商 / LP

## 7. 演示缺口（BACKLOG 有账）

- HRC/HRCA 3 工作日 FIU 不反对窗不上墙（随交易 HOLD 边一起做，`BACKLOG.md`）
- 报送单结构化正文表单（按报文类型细分字段）——现行通用形式（`body` 自由文本 + 外部引用号）不变，待合规同事提需求后按类型追加
- 推送提醒、内幕名单登记册：按裁定判组织件 / 非本波范围，不建
- 甲波六边界（`decisions.md` 2026-10-28）：**定期复审**（复审日 / 到期提醒 / 重评 / 过期拦截）整体不做，另立「合作方复审专项战役」，`BACKLOG.md` 已登；**自动筛查**不做（人工登记）；VARA 对报备提出反对的分支、告知单被撤销 / 驳回时服务商状态回退不做（后者登 `BACKLOG.md` §L）；服务商分包商自身尽调、合同条款逐条核（VARA IV.D / IV.E）不做，分包只记名单、合同只上传；站内通知 / 邮件不做（归 `BACKLOG.md` 管理台站内通知一揽子）；闹钟墙不新增条目（复审不做，无到期物可挂）
- 甲波六遗留的技术兜底已登 `PRODUCTION-NOTES.md`（2026-10-29 三条）：文件下载 OR 粗门、筛查证据上传不核对记录归属、服务商先改状态后开告知单的非原子窗口；告知单被撤销后服务商卡在待报备属业务缺口，登 `BACKLOG.md` §L
