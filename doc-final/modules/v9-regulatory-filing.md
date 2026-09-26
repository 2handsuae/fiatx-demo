# V9 · 监管报送（报送台，跟监管交差记录在哪）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-26（战役甲波三：报文族台账与联动——类型目录扩到十一行、AML 族独立边集与工作日钟、制裁定性裁决三出口联动、tipping-off 登记本、MLRO 无签发链亲办；此前 2026-09-26 战役甲波二：报送台骨架落地，事故通报单槽退役统一收编）
> 演示幕次：第六幕场景 18（事故通报环节）＋场景 19/20（暂编，AML 报文族）｜ 验收：第六幕走查 + 场景 19/20 走查（`demo/script.md`）+ 本篇 §5

## 0. 这是什么

**报送台**（Regulatory Filing Desk）是全系统统一的「跟监管交差」记录本——不管是事故触发的强制通报、监管来函要求的应答、重大变更 / 审计师任命一类的日常告知义务，还是 MLRO 反洗钱条线的 STR/SAR/CNMR/PNMR/HRC/HRCA，全部落在同一张主体 `RegulatoryFiling`（业务键 `filingNo` 前缀 `FIL`）上——但**不是同一条状态机、同一条经办路径**：波二五类（`INCIDENT_REPORT` 等，下称 **GENERAL 族**）走六态六边、合规官经办、高管签发；波三新增六类反洗钱报文（下称 **AML 族**）走四边、MLRO 一人亲办到底、法定无签发链（详见 §1/§3/§4）。

**它取代了什么**：波一之前，事故通报是事故单据自己身上的六个字段——一个事故只能挂一份通报记录。波二把这块整体搬出来独立成主体，波三在此基础上接入 MLRO 的反洗钱报送条线，两条主线共用一张主体、不同的边集与分权。

**它不做什么**（不做技术兜底、不做真发送）：报送台只负责把「该报的、报了没有、报给谁、什么时候必须报完」这几件事记清楚、留痕清楚——**系统从不真正对外发送任何报文**。「已提交」永远是经办人人工标记 + 手填对外编号，报文正文是自由文本草稿。这是刻意的：真正的业务价值在于「留痕不真发」这条闸本身——标已提交前必须先有对外编号，逼着这一步必须是真人真做过的动作。

## 1. 主体与状态机

**RegulatoryFiling**（表 `regulatory_filings`）核心字段：`filingNo`（对外业务键）、`direction`（OUTBOUND 我方上报 / INBOUND 监管来函应答，由类型决定不可自选）、`type`（类型目录键，见 §2）、`authority` / `ccAuthorities`（受文 / 抄送机构）、`basisCode`（依据码，仅 `INCIDENT_REPORT` 类型有值，一单一码）、`incidentNo`（关联事故，非唯一——一事故可开多单，仅 GENERAL 族用）、`title` / `body`（正文草稿）、`receivedAt`（INBOUND 专用，来函收到时刻）、`deadlineAt`（法定截止，算法见 §2）、`externalRef`（对外编号，标已提交时必填）、**`externalCaseRef`**（波三新列，对外案件引用——STR/SAR 记 Sumsub 案件/applicant 引用、CNMR/PNMR 记 EOCN 名单条目引用，四个 AML 类型开单时必填，GENERAL 族不用）、**`noFilingReason`**（波三新列，决定不报的理由，仅「决定不报」这条 `DRAFT→CLOSED` 边使用，`closeNoFiling()` 强制非空并落进该次审计的 `reason` 列）、`submittedAt`/`submittedByUserId`、`overdueMarkedAt`（超时软标，见 §2）、`closedAt`。

往来记录子表 **RegulatoryFilingEntry**（`regulatory_filing_entries`，只增不改，波三新列 `commDraftedBy`——自由文本拟稿人，仅 `CUSTOMER_COMM` 用）——五种受控 `kind`，「哪族能用 / 态限是什么」按 `FILING_ENTRY_KIND_RULES` 一张显式表查（不写散 if）：

| kind | 适用族 | 态限 | 说明 |
|---|---|---|---|
| `RECEIPT_ACK` | GENERAL＋AML | 仅 `SUBMITTED` | 监管回执 |
| `REGULATOR_INQUIRY` | GENERAL＋AML | 仅 `SUBMITTED` | 监管追问（GENERAL 族监管指令唯一入口，波三未扩） |
| `OUR_SUPPLEMENT` | GENERAL＋AML | 仅 `SUBMITTED` | 我方补充答复 |
| `CUSTOMER_COMM`（波三新增） | 仅 AML | 非终态 | tipping-off 客户沟通预审登记，见 §4.3 |
| `AUTHORITY_INSTRUCTION`（波三新增） | 仅 AML | 非终态 | EOCN/FIU 指令留痕，记录不推状态，见 §4.3 |

**六态六边显式迁移表——现按族拆成两张**（`FILING_TRANSITIONS_BY_FAMILY`，非法跃迁显式拒，终态零出边；波三前的单表别名 `FILING_TRANSITIONS` 已物理删除，迁移守卫改读族表——留着别名就是一层兼容假象，有人拿它判 AML 单会按 GENERAL 放行）：

**GENERAL 族**（波二五类原样）：
```
DRAFT ──送签(合规官)──► PENDING_SIGNOFF ──高管批准──► SIGNED_OFF ──标已提交+externalRef(合规官)──► SUBMITTED ──办结(合规官)──► CLOSED
  │                          │
  │                          └──高管驳回/合规官撤签──► DRAFT（回草拟改了再送，可再送签）
  └──作废(合规官)──► CANCELLED
```

**AML 族**（波三新增，仅四边，**不经过** `PENDING_SIGNOFF`/`SIGNED_OFF` 两态——送签本身即非法跃迁显式拒）：
```
DRAFT ──标已提交+externalRef(MLRO)──► SUBMITTED ──办结(MLRO)──► CLOSED
  │
  ├──决定不报+noFilingReason(MLRO，仅 allowNoFilingClose 类型即 STR/SAR)──► CLOSED
  └──作废(MLRO)──► CANCELLED
```

前置闸两道是这条状态机的核心业务规则：**送签须 `body` 非空**（不许空文送签，仅 GENERAL 族适用，AML 族无此步）；**标已提交须 `externalRef` 非空**（这是「留痕不真发」的落地闸，两族共用——变异测试③专门验证这道闸拿掉后单测会红）。INBOUND 方向（GENERAL 族独有）共用同一条生命周期——登记来函即开单（DRAFT，钟随即起跑）→ 起草答复 → 送签 → 标已提交（答复发出的人工标记）→ 关闭，不为方向另设状态机。前端人话词表：草拟中 / 待签发 / 已签发待提交 / 已提交 / 已关闭 / 已作废。

事故侧退役了六个过程列（`reportDeadlineAt`/`reportDraft`/`reportDraftedAt`/`reportedAt`/`reportedByUserId`/`reportReference`），保留两列 `reportRequired`/`reportBasisCodes`——「该不该报」的判定仍在事故域（定损时判断），「报的过程」全部搬到报送台。详见 `modules/v1-governance.md` §7。

## 2. 类型目录与钟

十一类（`filing-type-registry.ts`，代码注册表——GENERAL 五类波二原有，AML 六类波三新增）：

| 类型键 | 族 | 方向 | 受文机构 | 钟 | 锚 | 备注 |
|---|---|---|---|---|---|---|
| `INCIDENT_REPORT` | GENERAL | OUTBOUND | 按依据码带出 | 按依据码（小时制） | `BASIS` | 唯一可被自动开单的 GENERAL 类型——事故定损联动 |
| `REG_INFO_REQUEST_RESPONSE` | GENERAL | INBOUND | 手工选 | 48h | `RECEIVED_AT` | 锚来函收到时刻 |
| `MATERIAL_CHANGE_NOTIFICATION` | GENERAL | OUTBOUND | VARA | 无 | `NONE` | |
| `AUDITOR_APPOINTMENT_NOTICE` | GENERAL | OUTBOUND | VARA | 无 | `NONE` | |
| `MARKET_OFFENCE_DUAL_REPORT` | GENERAL | OUTBOUND | VARA（第二受文机构手工选入 `ccAuthorities`） | 无 | `NONE` | |
| `STR`（波三） | AML | OUTBOUND | UAE_FIU | 无（形成怀疑即报，不杜撰法定时限） | `NONE` | `allowNoFilingClose`＋`requiresExternalCaseRef`；叙事锚交易单号，不建列 |
| `SAR`（波三） | AML | OUTBOUND | UAE_FIU | 无 | `NONE` | 同上；叙事锚客户（无交易可锚——这正是台账要与 STR 分两行的原因） |
| `CNMR`（波三） | AML | OUTBOUND | EOCN | **5 工作日** | `EXTERNAL` | `requiresExternalCaseRef`；锚制裁便签 `openedAt`（官方口径「自冻结起算」） |
| `PNMR`（波三） | AML | OUTBOUND | EOCN | **5 工作日** | `EXTERNAL` | `requiresExternalCaseRef`；锚制裁便签 `openedAt`（官方口径「自暂停起算」；10 工作日补证窗并行走，不是本钟） |
| `HRC`（波三） | AML | OUTBOUND | UAE_FIU | 无（本台账不建钟） | `NONE` | 报后 3 工作日 FIU 不反对方可执行——交易 HOLD 边移交三域细化，台账只记「报了没有」 |
| `HRCA`（波三） | AML | OUTBOUND | UAE_FIU | 无 | `NONE` | 交易属性不全时的替代报文，同上钟备注 |

受文机构目录仍五家：`VARA` / `UAE_FIU` / `EOCN` / `UAE_DATA_OFFICE` / `CBUAE`。

**`FilingTypeConfig` 波三新增的族相关字段**：

- `family: 'GENERAL' | 'AML'`——服务层按族独占的判据（见 §3 `cap.filing.*`）。
- `anchorKind: 'BASIS' | 'RECEIVED_AT' | 'EXTERNAL' | 'NONE'`——钟的起算点，四值穷举、不留隐式：`BASIS`＝依据码事故创建时刻（`INCIDENT_REPORT` 专用，波二既有）；`RECEIVED_AT`＝收件时刻（`REG_INFO_REQUEST_RESPONSE`，波二既有）；**`EXTERNAL`＝workflow 显式外传 `anchorAt`（波三新增，CNMR/PNMR 专用）**——锚只能来自 `openForSanction()` 的调用方传入，手工开单拿不到锚、`deadlineAt` 留 `null`，不杜撰；`NONE`＝无钟。
- `deadlineBusinessDays`——工作日制钟（周一至五），与小时制 `defaultHours` 互斥，两者不得同时设值；`computeDeadline()` 按 `anchorKind==='EXTERNAL'` 分支走 `addBusinessDays(anchorAt, deadlineBusinessDays)`。
- `allowNoFilingClose`——仅 STR/SAR 为 `true`，见 §4.2「决定不报」。
- `requiresExternalCaseRef`——STR/SAR/CNMR/PNMR 四类型 `true`（HRC/HRCA 锚交易属性、无外部案件可引，不填）。

**族边集**：`FILING_TRANSITIONS_BY_FAMILY` 一张常量、迁移守卫按单据 `type` 所属族查对应子表（两张迁移表见 §1），不是靠散 `if (family==='AML')` 判；要新增族只需在这张表加一行 key。

**工作日钟纯函数**（`business-days.ts → addBusinessDays`）：按**迪拜日历**（UTC+4，无夏令时）判周末（周六、周日），复用 `business-date.util.ts` 的 `DUBAI_UTC_OFFSET_MS` 毫秒步进、与账务业务日同一口径——**T1 升档评审红项修复**：原实现按宿主进程时区判周末，同一份代码在不同部署时区会算出不同的截止日，已用「周六起算」+「迪拜跨日边界」两用例、四时区矩阵单测坐实修复。

**GENERAL 族一码一单，自动开单**（波二机制，本波未改）：事故定损时勾「需要监管通报」并选中依据码，按每个依据码各开一张 `INCIDENT_REPORT` 单——`incident-assessment-workflow.service.ts`（铁律③）先调 `IncidentService.assess()` 判定留痕，再逐码调 `RegulatoryFilingService.openForIncident()` 建单。**钟锚算法**：`INCIDENT_REPORT` 按依据码的 `hours`，从事故登记时刻起算；`REG_INFO_REQUEST_RESPONSE` 按 48h，从 `receivedAt` 起算；两者都没有依据则 `deadlineAt=null`。**钟链机制**（`chainStart='NOTICE'`，目前仅 `TIR_II_C_24H`）原样不动。

**AML 族一单一钟，不复用钟链**（波三脑暴裁定②——CNMR/PNMR 的语义与「同一事故两只独立钟」不同，是「同一制裁便签下按定性结果分别开单」）：确认命中开 CNMR 单、部分命中开 PNMR 单，部分命中后续升级为确认命中**再开一张新 CNMR 单**（不复用旧 PNMR 单、不改它的钟），各单各走各自 5 工作日钟——落地细节见 §4.1。「24h 冻结」不建倒计时钟：⚡ 命中即冻瞬时完成，制裁便签的 `openedAt` 本身就是 `EXTERNAL` 锚的数据源，兼作留痕；闹钟墙式的倒计时展示留给波四。

**手工开单**：合规官可开全部启用 GENERAL 类型；MLRO 可开全部启用 AML 类型（`openManual()` 内先过族独占断言，合规官打不开 STR/SAR，MLRO 打不开 GENERAL 五类，见 §3）；`INCIDENT_REPORT` 手工开单须给 `incidentNo` + 合法 `basisCode`（必须属该事故类型的 `reportBasisCandidates` 候选集）；`requiresExternalCaseRef` 类型（STR/SAR/CNMR/PNMR）手工开单缺 `externalCaseRef` 即 400；CNMR/PNMR 手工开单拿不到 `anchorAt`，`deadlineAt` 留 `null`——现场演示 SAR/HRC/HRCA 就是走这条手工路（§4.2/§5「演示脚本」）。

**超时持久软标**（`regulatory-filing-sweep.service.ts`，@Cron 每 30 秒，两族共用，本波未改）：`deadlineAt < now` 且 `overdueMarkedAt IS NULL` 且状态 ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF}（AML 族因无 `PENDING_SIGNOFF`/`SIGNED_OFF` 两态，实际只在 DRAFT 触发）→ 落 `overdueMarkedAt` + 记一条 `FILING_OVERDUE_MARKED`（系统 actor）。按时提交过的单子永不触发；标记留着不清，迟交的照样红着。

## 3. 权限与审批

**RBAC 新域（14 域 69 桶 77 组，`overview.md` §4）**：`filings.view`「View regulatory filings」→ 三组 OR 只读（`REG_FILING_READ`/`REG_FILING_WRITE`/`REG_FILING_AML_WRITE`，波三新增第三组 OR）；`filings.desk`「Operate the regulatory filing desk」→ `REG_FILING_WRITE`（GENERAL 族全部写动作，合规官独占）；**`filings.aml-desk`「Operate AML reporting desk」（波三新增第三桶）→ `REG_FILING_AML_WRITE`（MLRO 独占：开单/正文/标已提交/往来/决定不报/办结/作废六类型全在他手上，无签发链）**。写路由现为两组 OR 的粗门（既有 7 条 POST + 波三新增 `POST /admin/regulatory-filings/:filingNo/close-no-filing` 共 **8 条 POST**，均挂 `['REG_FILING_WRITE', 'REG_FILING_AML_WRITE']`；波二"9 条"计的是含 2 条 GET 的路由总数，2026-09-26 终审订正口径）；GET 两条挂三组 OR（含 AML 组）。

**共享路由、服务层按族独占才是真把关**（波三 T3，照 `cap.incident.*` 先例——`v1-governance.md` §7 Ruling-6）：路由层的两组 OR 只放行「你是报送台某一个经办人」，真正判定「这张单是不是你那族」的在服务层——`RegulatoryFilingService` 精确判定 actor 是否持有该单据类型所属族的能力码 `cap.filing.general`（合规官持有）/`cap.filing.aml`（MLRO 持有），跨族一律 403。不走「权限码反查所属组」这条老路（码被多组共享时会把持有人一并错误抬进所有共享组）。

**经办与签发分权——两族刻意不对称，是波三的核心演示点**：

- **GENERAL 族**（波二不动）：合规官统一经办（开单/起草/送签/标已提交/往来/办结/作废），**对外提交前必须高管单步签发**（`ApprovalActionTypes.REG_FILING_SUBMIT`，`timeoutHours: 48`）。
- **AML 族**（波三新增）：**MLRO 亲办全程、无签发审批链**——goAML 账户注册在他个人名下，STR/SAR 法定谁也拦不得（`FDL 20/2018`）；`DRAFT→SUBMITTED` 一步到位，全生命周期零 `PENDING_SIGNOFF`/`SIGNED_OFF`、零审批单。这与 GENERAL 族「连事故通报都要高管过一道签发」同屏对比，是本波刻意设计的演示反差——`verify:rbac` 的「AML 单全生命周期零审批单」断言（S10b 与专项探针）就是钉住这条不对称。

合规官在报文族零角色（不持 `REG_FILING_AML_WRITE`）；MLRO 随本波补持 `REG_FILING_READ`（此前只有内审/高管等读组，MLRO 亲办报文族必须先看得见，评审补齐这条遗漏）；合规官原有的 `INCIDENT_READ`（波二遗留）不变。`verify:rbac` 新增双向族探针（合规官打 AML 单写动作应 403、MLRO 打 GENERAL 单写动作应 403，服务层真拦，非路由层）与四处齐判据（S10a/S10b：`REG_FILING_AML_WRITE` 同时出现在 `route()`/`ACTION_BUCKET_CATALOG`/职务绑定三处、且唯 MLRO 持有）。

**审批通过 / 驳回落地**（GENERAL 族，波二不动）：`regulatory-filing-workflow.service.ts` 的 `onDecided` 监听 `workflow.regulatory-filing.decided` 事件，四种 decision 全部转发给 `RegulatoryFilingService.applySignoffDecision`，由服务侧的迁移守卫决定落地状态（批准 → `SIGNED_OFF`；驳回 / 撤单 → 回 `DRAFT`）。AML 族无此环节。

**审计名册十一码**（`REG_FILING_AUDIT_ACTIONS`，domain GOVERNANCE）：波二十码 + 波三新增 `FILING_CLOSED_NO_FILING`（仅 AML 族触发，`requiredFields: ['noFilingReason']`，落进 `reason` 列）。事故侧原十一码名册随通报字段退役收缩为九码（波二遗留，不变），两个域各自封闭，不共用码位。

**结案联动**（不动，波二遗留）：事故结案前置门语义仍读 `RegulatoryFilingService.summaryForIncident()`——本波未改这条判据（AML 族单据从不关联 `incidentNo`、不产生 `INCIDENT_REPORT` 类型，与事故结案门无交集）。

## 4. AML 报文族（STR/SAR/CNMR/PNMR/HRC/HRCA，战役甲波三）

**定位。** 报送台第二条主线——MLRO 反洗钱报送独立于事故触发的 GENERAL 族，同样落在 `RegulatoryFiling` 主体上（不另起主体），走 §1 的 AML 四边迁移表、§3 的无签发链分权。

### 4.1 制裁定性裁决与三出口（B 线）

现状 `SANCTION` 便签（SILENT、`MLRO_APPROVAL`、`customerLevel=true`）**重定义为「命中待裁」态**——三层防线（客户面零痕迹）全程不动。波三新增**制裁定性裁决**（`SANCTION_DISPOSITION` 审批类型，`sanction-disposition-workflow.service.ts`）：合规官提单（带出口选择 + 判断依据摘要 + `externalCaseRef`）、**MLRO 单步批**（挂在 `CUSTOMER_RESTRICTION_RELEASE` 提单组，与「解限制」共用——同款双持结构，maker=合规官/checker=MLRO，SoD 天然分立，`verify-rbac.ts` 的 `MAKER_CHECKER_OVERLAP_EXEMPT` 表第七条登记）；提单前置门：客户必须有 OPEN 的 `SANCTION` 便签，且同客户已有 PENDING 定性案时 409（`initiateDisposition()` 判据——防重复开案导致审计与实际批的案子对不上）。

三选一出口，落地走同一个 workflow（铁律③：横向只调三个主体各自的服务方法，不直写任何表）：

| 出口 | 便签联动 | 报送联动 | 客户可见性 |
|---|---|---|---|
| **CLEARED**（排除，重名虚惊） | `SANCTION` 便签直接 `release()`（`releaseMode=MANUAL`、`releaseApprovalNo`=定性审批单号——不走 `initiateRelease()` 手工链，也不用 `SYSTEM` actor `autoRelease`，这是一次真实裁决的落地，不是机制自动触发） | 无 | 客户全程无感 |
| **PARTIAL**（部分命中，拿不准） | `SANCTION` 便签原样维持 OPEN，不碰 | 自动开 PNMR（锚=`SANCTION` 便签 `openedAt`）＋ 经 `material-request-issuer` 自动发一份中性补料（`EMIRATES_ID`，`blocking:false`——便签已卡住全部能力，补料只是发话术，不重复限制） | 维持 SILENT |
| **CONFIRMED**（确认命中） | `SANCTION` 便签 `release()` ＋ 新开 `SANCTION_CONFIRMED` 便签（DISCLOSED，见下） | 自动开 CNMR（锚同上） | 客户端 Profile 页出现横幅——从这一刻起首次可见 |

支持二次定性——PARTIAL 之后据 EOCN 指令（往来记录里的 `AUTHORITY_INSTRUCTION`）可再次对同一张便签提单，定 `CLEARED`（排除）或升级 `CONFIRMED`（见 §5 场景 19 分支二）。**二次定性 CNMR 仍锚首次命中时刻**（`SANCTION` 便签的原始 `openedAt`，不是第二次批准的时刻）——这意味着若定性拖得久，升级后开出的 CNMR 单钟从一开始就已经在跑，**开单即可能已经逾期**：这是刻意保留的合规压力可见化，不是 bug（`decisions.md` 2026-09-26 条）。「24h 冻结」不建倒计时钟：⚡ 命中即冻瞬时完成（详见 §2）。

**限制因由新增 `SANCTION_CONFIRMED`**（8 条因由之一，`restriction-cause.constant.ts`）：`visibility: 'DISCLOSED'` / `defaultScopes: ['ALL']` / `releasePolicy: 'MLRO_APPROVAL'`（同 `SANCTION` 一样走政府解除令闸）/ `customerLevel: true` / `customerLabel: 'Account restricted — confirmed sanctions match'`——刻意可见，是三出口里唯一一个客户面出现依据的分支。`CUSTOMER_FROZEN`/`CUSTOMER_UNFROZEN` 两个审计码的判据从字面量 `cause==='SANCTION'` 改成查 `RESTRICTION_CAUSE_POLICY[cause].customerLevel`（T4 评审黄项修复），`SANCTION_CONFIRMED` 因此与 `SANCTION` 配对正确，不会漏判。

**⚠️ 事实订正——CONFIRMED 出口不是单一事务原子落地**：`sanction-disposition-workflow.service.ts#landConfirmed()` 内，「SILENT 便签解列 + 新开 DISCLOSED 便签」这两步确实在同一个 `prisma.$transaction` 里；但**紧随其后的 CNMR 开单调用（`RegulatoryFilingService.openForSanction('CNMR', …)`）在这个事务之外**——若开单这一步失败，客户会停在「两张便签已翻牌、但 CNMR 单还没开」的半落地窗口。此前 T4 提交信息里「同一事务原子落地」的说法与代码真实形状不符，已按 CLAUDE.md §2（不做补偿/repair）记入 `PRODUCTION-NOTES.md`，本篇按实际代码路径记录，不美化。

**审批快照人话摘要**：三出口各自的「批了会怎样」落进 `objectSnapshot.impact`（管理台审批详情页 `ApprovalDetailPage.tsx` 直接读），批准前 MLRO 看得懂后果，不用先读代码——如 CONFIRMED 那句是「formally confirms the sanctions match (customer-visible), keeps the account frozen … opens a Confirmed Name Match Report (CNMR) to EOCN (5 business days from freeze).」。

### 4.2 STR/SAR 全程亲办（A 线）与「决定不报」

MLRO 开 STR（叙事上锚交易单号）或 SAR（叙事上锚客户，无交易可锚）——起草 → 标已提交（`externalRef`=goAML 回执号样式）→ 往来 → 办结，全程一人、`DRAFT→SUBMITTED` 一步到位（见 §1/§3）。**「决定不报」**（`closeNoFiling()`，`DRAFT→CLOSED` 边，仅 `allowNoFilingClose` 类型即 STR/SAR）：`noFilingReason` 必填，法定可辩护留痕落进该次审计 `FILING_CLOSED_NO_FILING` 的 `reason` 列；`close()`（原有的「办结」动作）维持只认 `SUBMITTED` 态，DRAFT 态调 `close()` 端点 400（动作级守卫——评审黄项：防「法定必报单被无理由 Close」误用错方法绕开理由必填闸）。

### 4.3 tipping-off 登记本 ＋ EOCN 指令留痕

往来记录新增两种受控 `kind`（均仅 AML 族，见 §1 表）：

- **`CUSTOMER_COMM`**——客户沟通预审登记本。`commDraftedBy`（自由文本拟稿人）+ `recordedByUserId`（=actor=MLRO 本人，放行人）+ `body`（放行话术）。演示话术定案为「MLRO 亲录预审」——报文族唯 MLRO 可写，两签不装作两个账号；这是给人看的「怎么说」，与客户面 DTO 零 STR/报文引用的契约测试是两层不同的防线，不要混同。
- **`AUTHORITY_INSTRUCTION`**——EOCN/FIU 指令留痕。记录不推状态，解除/升级动作仍走 §4.1 的定性 workflow 各自的链。

两种 kind 态限放宽至**非终态均可追加**（`DRAFT`/`PENDING_SIGNOFF`/`SIGNED_OFF`/`SUBMITTED`，`CLOSED`/`CANCELLED` 拒）——波二三种旧 kind 维持仅 `SUBMITTED` 不变；GENERAL 族监管指令继续走既有 `REGULATOR_INQUIRY`，不新增 kind（评审白项定口径）。行为测试覆盖：客户面 DTO 全量断言零 STR/报文/`filingNo` 引用（三层防线契约测试扩展）＋ tipping-off 违禁词断言。

### 4.4 ⚡ EOCN 名单更新（存量客户命中）

⚡ 新入口落**客户域**（`POST /admin/sumsub/simulate/eocn-sanctions-hit`，`DEMO_VERDICT_WRITE`）——对一位当前无任何限制的 ACTIVE 客户模拟「EOCN 名单更新命中」，最终经 `CustomerRestrictionWorkflowService.openRestriction()` 贴一张 SILENT `SANCTION` 便签（复用既有三层防线，自带 `CUSTOMER_RESTRICTION_ADDED`/`CUSTOMER_FROZEN` 审计 + ⚡ actor 留痕）——**不照抄** `deposit-workflow.service.ts` 裸 `open()` 那条路（其留痕搭在 KYT 审计上，⚡ 场景无 KYT 单可搭，评审黄项订正）。命中之后走 §4.1 的定性裁决流程。报送台本身不建名单接收入口——「收到名单」不满足总纲覆盖判据；A 线（STR/SAR）不新增 ⚡，案件裁决叙事上由手工开单代替。

## 5. 演示脚本

报送台没有独立幕次，挂在**第六幕场景 18**（未授权转出事故，`demo/script.md`）的「通报」环节：定损时勾「需要监管通报」并选依据码提交，联动自动开出对应报送单 → 切合规官账号打开报送台详情页起草正文 → 送签 → 切高管账号在审批中心批准（`SIGNED_OFF`）→ 切回合规官标已提交（填对外编号）→ 事故侧「提结案」两步门（MLRO → CFO）此时才放行，因为报送单已提交。

**双钟链现场走法**（两种都可用于演示）：

1. **现场登记走一遍**：管理台事故列表页登记一个 `DATA_BREACH` 类型事故 → 调查 → 定损时勾 `PDPL_ART_9` + `TIR_II_C_24H` 两个依据码、需要通报 → 提交，联动开出两张报送单——`PDPL_ART_9` 那张无钟（deadline 为 null，前端显示「No deadline set」），`TIR_II_C_24H` 那张 `deadlineAt=null`（钟链未落定）→ 把 `PDPL_ART_9` 那张走完全链标已提交 → 回看 `TIR_II_C_24H` 那张，`deadlineAt` 已经落定为「刚才那次提交时刻 + 24h」，倒计时随之出现——这一步是钟链机制唯一直观可见的证据。
2. **用种子样例直接讲解**（`data-breach-crm-export` 事故，`incidentNo=INC2601011480`）：省去现场操作时间，种子已经铺好两张单——`FIL...`（`PDPL_ART_9`）态 `SUBMITTED`，挂一条 `RECEIPT_ACK` 往来记录；`FIL...`（`TIR_II_C_24H`）链单态 `SIGNED_OFF` 待提交，`deadlineAt` = 前者 `submittedAt`+24h，铺场时还剩约 4 小时在跑——直接打开这两张单的详情页对照讲「同一泄露事件、两项独立的监管义务、两只独立的钟」。种子另铺一张**入站在途**样例：`REG_INFO_REQUEST_RESPONSE`（`authority=VARA`，`receivedAt` 近期）草拟中，48h 倒计时在跑，用于讲解 INBOUND 方向共用同一条生命周期。

三种类型（`MATERIAL_CHANGE_NOTIFICATION`/`AUDITOR_APPOINTMENT_NOTICE`/`MARKET_OFFENCE_DUAL_REPORT`）本波不建种子，演示时可现场手工开单讲解（合规官账号，报送台列表页「Open Filing」，类型下拉选中后按 `requiresIncident`/`defaultAuthority` 决定表单字段显隐）。

**AML 报文族**（场景 19/20，暂编——战役甲波三 T10 新增，幕次编号是否并入既有幕次留波五收官统一，本节先把走查步骤钉住，详见 `demo/script.md`）：

- **场景 19 · B 线**（制裁定性两分支）：种子已铺两个终态样例可直接翻给观众看——Leo Confirmed（CNMR 已提交 `FIL2601015358`、客户端横幅可见）、Mona Partial（PNMR 挂钟 `FIL2601012321`、EMIRATES_ID 补料在途、一条 `AUTHORITY_INSTRUCTION` 待决）；现场再活走两条分支——分支一 ⚡ 现场命中一位新客户走到「确认命中→横幅+CNMR」，分支二直接对着 Mona 现成的 PARTIAL 状态走「据指令排除」（二次定性）。观众看懂三件事：① 三出口分别联动限制账与报送台，同一个 workflow 两个主体各写各的；② 确认命中才翻明示、部分命中维持静默，tipping-off 两防不混；③ AML 报文族（CNMR/PNMR）无签发链，MLRO/合规官走完全程零高管审批——与通用族「高管签发」同屏对照。
- **场景 20 · A 线**（STR/SAR 与 tipping-off 登记本）：种子已铺 STR 已提交样例（锚 Frank HighRisk，`FIL2601017376`，挂一条 `CUSTOMER_COMM` + 一条 `RECEIPT_ACK`）；现场再开一张新 STR 走「起草→标已提交→往来」全链，一张「决定不报」独立小单，SAR 现场开一张讲透「锚客户不锚交易」。`mlro@` 全程一人对照第七幕事故通报那条链 `compliance_lead@`→`sm@` 的两人两步。

种子三样例与关键客户（Leo Confirmed / Mona Partial）种子详情见 `demo/data.md`「报文族种子」节；⚠️ Task 9 前端截图走查因容器无 TigerBeetle 二进制（出站策略同时拒 `tigerbeetle.com`/`github`，无法离线补装）而暂缺，收尾闸⑥⑧、`demo:all`、场景 19/20 现场走查、`verify:rbac` 行为探针均需本地补跑（详见 `TOOLING-DEBT.md` 对应条目）。
