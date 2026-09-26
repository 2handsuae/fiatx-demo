# V9 · 监管报送（报送台，跟监管交差记录在哪）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-26（战役甲波二：报送台骨架落地，事故通报单槽退役统一收编）
> 演示幕次：第六幕场景 18（事故通报环节，`demo/script.md`）｜ 验收：第六幕走查 + 本篇 §4

## 0. 这是什么

**报送台**（Regulatory Filing Desk）是全系统统一的「跟监管交差」记录本——不管是事故触发的强制通报、监管来函要求的应答，还是重大变更 / 审计师任命一类的日常告知义务，全部落在同一张新主体 `RegulatoryFiling`（业务键 `filingNo` 前缀 `FIL`）上，走同一套六态状态机、同一条签发审批链。

**它取代了什么**：波一之前，事故通报是事故单据自己身上的六个字段（草稿 / 时限 / 已通报标记等）——一个事故只能挂一份通报记录。波二把这块整体搬出来独立成主体，理由是波一码目录早就明写「一码 = 一项通报义务（一只钟 + 一个受文机构）」——数据泄露这类事件天然需要同时满足两项独立的监管义务（各自的钟、各自的受文机构），单槽字段装不下，只能造出报送台这个新主体来one-code-one-filing。

**它不做什么**（不做技术兜底、不做真发送）：报送台只负责把「该报的、报了没有、报给谁、什么时候必须报完」这几件事记清楚、留痕清楚——**系统从不真正对外发送任何报文**。「已提交」永远是合规官人工标记 + 手填对外编号，报文正文是自由文本草稿（无模板引擎、无格式校验）。这是刻意的：演示系统假装自己是监管报送渠道没有意义，真正的业务价值在于「留痕不真发」这条闸本身——标已提交前必须先有对外编号，逼着这一步必须是真人真做过的动作，不能被顺手跳过。

## 1. 主体与状态机

**RegulatoryFiling**（表 `regulatory_filings`）核心字段：`filingNo`（对外业务键）、`direction`（OUTBOUND 我方上报 / INBOUND 监管来函应答，由类型决定不可自选）、`type`（类型目录键，见 §2）、`authority` / `ccAuthorities`（受文 / 抄送机构）、`basisCode`（依据码，仅 `INCIDENT_REPORT` 类型有值，一单一码）、`incidentNo`（关联事故，非唯一——一事故可开多单）、`title` / `body`（正文草稿）、`receivedAt`（INBOUND 专用，来函收到时刻）、`deadlineAt`（法定截止，算法见 §2）、`externalRef`（对外编号，标已提交时必填）、`submittedAt`/`submittedByUserId`、`overdueMarkedAt`（超时软标，见 §2）、`closedAt`。往来记录另有子表 **RegulatoryFilingEntry**（`regulatory_filing_entries`，只增不改）——三种受控 `kind`：`RECEIPT_ACK`（监管回执）/ `REGULATOR_INQUIRY`（监管追问）/ `OUR_SUPPLEMENT`（我方补充答复），仅 `SUBMITTED` 态可追加，追加不推状态。

**六态六边显式迁移表**（`FILING_TRANSITIONS`，非法跃迁显式拒，终态零出边）：

```
DRAFT ──送签(合规官)──► PENDING_SIGNOFF ──高管批准──► SIGNED_OFF ──标已提交+externalRef(合规官)──► SUBMITTED ──办结(合规官)──► CLOSED
  │                          │
  │                          └──高管驳回/合规官撤签──► DRAFT（回草拟改了再送，可再送签）
  └──作废(合规官)──► CANCELLED
```

前置闸两道是这条状态机的核心业务规则：**送签须 `body` 非空**（不许空文送签）；**标已提交须 `externalRef` 非空**（这是「留痕不真发」的落地闸——变异测试③专门验证这道闸拿掉后单测会红）。INBOUND 方向共用同一条生命周期——登记来函即开单（DRAFT，钟随即起跑）→ 起草答复 → 送签 → 标已提交（答复发出的人工标记）→ 关闭，不为方向另设状态机。前端人话词表：草拟中 / 待签发 / 已签发待提交 / 已提交 / 已关闭 / 已作废。

事故侧退役了六个过程列（`reportDeadlineAt`/`reportDraft`/`reportDraftedAt`/`reportedAt`/`reportedByUserId`/`reportReference`），保留两列 `reportRequired`/`reportBasisCodes`——「该不该报」的判定仍在事故域（定损时判断），「报的过程」全部搬到报送台。详见 `modules/v1-governance.md` §7。

## 2. 类型目录与钟

首发五类（`filing-type-registry.ts`，代码注册表，波三 STR/CNMR/PNMR 只需加行）：

| 类型键 | 方向 | 受文机构 | 钟 | 关联事故 |
|---|---|---|---|---|
| `INCIDENT_REPORT` | OUTBOUND | 按依据码带出 | 按依据码 | **必须**——唯一可被自动开单的类型 |
| `REG_INFO_REQUEST_RESPONSE` | INBOUND | 手工选 | 48h，锚 `receivedAt` | 否 |
| `MATERIAL_CHANGE_NOTIFICATION` | OUTBOUND | VARA | 无 | 否 |
| `AUDITOR_APPOINTMENT_NOTICE` | OUTBOUND | VARA | 无 | 否 |
| `MARKET_OFFENCE_DUAL_REPORT` | OUTBOUND | VARA（第二受文机构手工选入 `ccAuthorities`，种子演示选 UAE FIU） | 无 | 否 |

受文机构目录五家：`VARA` / `UAE_FIU` / `EOCN` / `UAE_DATA_OFFICE` / `CBUAE`。

**一码一单，自动开单**：事故定损时勾「需要监管通报」并选中依据码，按**每个依据码各开一张** `INCIDENT_REPORT` 单——`incident-assessment-workflow.service.ts`（铁律③：跨主体协作只在 workflow）先调 `IncidentService.assess()` 判定留痕，再逐码调 `RegulatoryFilingService.openForIncident()` 建单。数据泄露场景勾 `PDPL_ART_9` + `TIR_II_C_24H` 两码 → 两张单、两只钟、两个受文机构，这就是「同事件双钟」的落地方式。依据码目录七条（`INCIDENT_REPORT_BASES`，见 `modules/v1-governance.md` §7）本波补上结构化 `authority` 字段，自动开单时直接从码上取受文机构，不再从人话 label 里解析。

**钟锚算法**（`regulatory-filing.service.ts computeDeadline`）：`INCIDENT_REPORT` 按依据码的 `hours`，从**事故登记时刻**（不是定损时刻）起算；其余类型按类型 `defaultHours`，从 `receivedAt` 起算；两者都没有依据则 `deadlineAt=null`（不杜撰时限）。

**钟链机制**（波一明确「本波不落」，本波落地）：依据码 `chainStart='NOTICE'`（目前仅 `TIR_II_C_24H`）的单据开单时 `deadlineAt=null`——**同一事故下另一张单首次进入 `SUBMITTED` 时**，才把链单的 `deadlineAt` 落定为 `该单 submittedAt + hours`（`markSubmitted()` 内联做，仅当链单尚未提交且钟未落定时生效），落钟动作记进触发单 `FILING_SUBMITTED` 审计的 `metadata.chainDeadlineSetFor`。这是「泄露通知发出后 24 小时内二次上报」这类"钟的起点是另一个动作，不是登记时刻"的场景第一次在系统里落地。

**手工开单**：合规官可开全部启用类型；`INCIDENT_REPORT` 手工开单须给 `incidentNo` + 合法 `basisCode`（必须属该事故类型的 `reportBasisCandidates` 候选集，否则 400——补开逃生口，不绕过依据校验）。

**超时持久软标**（`regulatory-filing-sweep.service.ts`，@Cron 每 30 秒，销 `BACKLOG.md` 2026-09-06 那笔债）：`deadlineAt < now` 且 `overdueMarkedAt IS NULL` 且状态 ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF} → 落 `overdueMarkedAt` + 记一条 `FILING_OVERDUE_MARKED`（系统 actor，一次性，逐笔 try/catch 不因单笔失败拖垮整批）。按时提交过的单子永不触发；标记留着不清，迟交的照样红着。列表/详情页超时红标读这个持久字段，不再是前端现算倒计时——这样才能保证「sweep 每 30 秒跑一次」和「界面显示」两者的结论任何时刻都一致。

## 3. 权限与审批

**RBAC 新域（14 域 68 桶 76 组，`overview.md` §4）**：`filings.view`「View regulatory filings」→ `REG_FILING_READ`（单组桶，只读）；`filings.desk`「Operate the regulatory filing desk」→ `REG_FILING_WRITE`（开单/草稿/送签/标已提交/往来记录/办结/作废全动作，一个经办组覆盖全部写路由，本域经办组唯一、不设 `cap.*` 标记码）。9 条路由（`GET` 列表/详情两条 OR 两组；7 条 `POST` 仅 `REG_FILING_WRITE`）。

**经办与签发分权**（业主裁决，岔口②）：**合规官（`COMPLIANCE_OFFICER`）统一经办**报送台——开单、起草、送签、标已提交、往来记录、办结、作废全在他手上；**对外提交前必须高管（`SENIOR_MANAGEMENT_OFFICER`）单步签发**（`ApprovalActionTypes.REG_FILING_SUBMIT`，`steps: [{ roles: ['SENIOR_MANAGEMENT_OFFICER'] }]`，`timeoutHours: 48`，`allowCancel: true`）。maker（合规官送签）与 checker（高管批准）职务天然分立，`verify:rbac` S5 家族守自批死锁。合规官同时补持 `INCIDENT_READ`（起草通报必须能读到事故详情与调查留痕，照「裁决人要看得见」同款理由）；`SENIOR_MANAGEMENT_OFFICER`/`INTERNAL_AUDITOR` 补持 `REG_FILING_READ`（裁决人与内审要看得见报送台）。

**审批通过 / 驳回落地**：`regulatory-filing-workflow.service.ts` 的 `onDecided` 监听 `workflow.regulatory-filing.decided` 事件，四种 decision 全部转发给 `RegulatoryFilingService.applySignoffDecision`，由服务侧的迁移守卫决定落地状态（批准 → `SIGNED_OFF`；驳回 / 撤单 → 回 `DRAFT`）。

**审计名册十码**（`REG_FILING_AUDIT_ACTIONS`，domain GOVERNANCE，新主体独立名册）：`FILING_OPENED` / `FILING_DRAFT_SAVED`（仅首次）/ `FILING_SIGNOFF_REQUESTED` / `FILING_SIGNED_OFF` / `FILING_SIGNOFF_REJECTED` / `FILING_SUBMITTED`（requiredFields 含 `externalRef`）/ `FILING_ENTRY_LOGGED` / `FILING_OVERDUE_MARKED`（系统）/ `FILING_CLOSED` / `FILING_CANCELLED`。事故侧原十一码名册随通报字段退役收缩为九码（`INCIDENT_REGULATOR_REPORT_DRAFTED`/`INCIDENT_REGULATOR_REPORTED` 两码退役），两个域各自封闭，不共用码位。

**结案联动**：事故结案前置门语义随岔口②改判——`reportRequired=true` 时，该事故名下**全部** `INCIDENT_REPORT` 类型报送单（排除已作废）必须 `submittedAt` 非空，任一未提交或名下零单均 400 拒绝结案；`IncidentCloseWorkflowService` 横向只读 `RegulatoryFilingService.summaryForIncident()`（铁律③：跨主体协作只读放行，事故域不直写报送表）。事故详情页 `getView()` 同样横向只读挂一份 `filings` 摘要（`filingNo`/`status`/`authority`/`deadlineAt`/`overdueMarkedAt`），任何持有事故读权限的角色都看得到，写权限仍锁在报送台自己的两组上。

## 4. 演示脚本

报送台没有独立幕次，挂在**第六幕场景 18**（未授权转出事故，`demo/script.md`）的「通报」环节：定损时勾「需要监管通报」并选依据码提交，联动自动开出对应报送单 → 切合规官账号打开报送台详情页起草正文 → 送签 → 切高管账号在审批中心批准（`SIGNED_OFF`）→ 切回合规官标已提交（填对外编号）→ 事故侧「提结案」两步门（MLRO → CFO）此时才放行，因为报送单已提交。

**双钟链现场走法**（两种都可用于演示）：

1. **现场登记走一遍**：管理台事故列表页登记一个 `DATA_BREACH` 类型事故 → 调查 → 定损时勾 `PDPL_ART_9` + `TIR_II_C_24H` 两个依据码、需要通报 → 提交，联动开出两张报送单——`PDPL_ART_9` 那张无钟（deadline 为 null，因为该依据码本身法条未载明时限，前端显示「No deadline set」；不是 immediate 类即时义务，两者词表二分不可混用），`TIR_II_C_24H` 那张 `deadlineAt=null`（钟链未落定）→ 把 `PDPL_ART_9` 那张走完全链标已提交 → 回看 `TIR_II_C_24H` 那张，`deadlineAt` 已经落定为「刚才那次提交时刻 + 24h」，倒计时随之出现——这一步是钟链机制唯一直观可见的证据。
2. **用种子样例直接讲解**（`data-breach-crm-export` 事故，`incidentNo=INC2601011480`）：省去现场操作时间，种子已经铺好两张单——`FIL...`（`PDPL_ART_9`）态 `SUBMITTED`，挂一条 `RECEIPT_ACK` 往来记录，`externalRef` 形如 `DATAOFFICE-ACK-2026-0001`；`FIL...`（`TIR_II_C_24H`）链单态 `SIGNED_OFF` 待提交，`deadlineAt` = 前者 `submittedAt`+24h，铺场时还剩约 4 小时在跑——直接打开这两张单的详情页对照讲「同一泄露事件、两项独立的监管义务、两只独立的钟」。种子另铺一张 **入站在途**样例：`REG_INFO_REQUEST_RESPONSE`（`authority=VARA`，`receivedAt` 近期）草拟中，48h 倒计时在跑，用于讲解 INBOUND 方向共用同一条生命周期。

三种类型（`MATERIAL_CHANGE_NOTIFICATION`/`AUDITOR_APPOINTMENT_NOTICE`/`MARKET_OFFENCE_DUAL_REPORT`）本波不建种子，演示时可现场手工开单讲解（合规官账号，报送台列表页「Open Filing」，类型下拉选中后按 `requiresIncident`/`defaultAuthority` 决定表单字段显隐）。
