# 战役甲波二「报送台骨架」spec

> 定稿 2026-09-26 ｜ 总纲：`2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波二 ｜ 骨架：`2026-09-25-campaign-a-wave2-skeleton.md`（承接/偏差四条/已定事实以骨架为准，本文不重抄）
> 业主裁决（2026-09-26 脑暴，三刀）：
> ① **岔口②＝甲案**：事故侧通报单槽退役，统一为报送台工单；不许双轨。
> ② **经办签发＝甲案**：合规官（COMPLIANCE_OFFICER）统一经办报送台，对外提交前高管（SENIOR_MANAGEMENT_OFFICER）单步签发。
> ③ 整体设计八节（单据/类型目录/状态机/联动/权限/前端/种子/不做）业主当日通过。

## §0 本波做 / 不做

**做**：新主体「监管报送单」（RegulatoryFiling + 往来记录 RegulatoryFilingEntry）｜类型目录首发五类（代码注册表）｜受文机构目录五家｜六态状态机（显式迁移表）｜高管单步签发审批链（REG_FILING_SUBMIT）｜事故定损勾「需通报」→ 按依据码逐码自动开单（workflow 层）｜事故侧六个过程列退役 + 两方法两端点两审计码退役｜依据码目录七条回填 `authority` 字段｜钟链码（`TIR_II_C_24H`）截止钟落地｜超时持久软标 + 审计（销 `BACKLOG.md` 2026-09-06 平账三期那行）｜RBAC 新域两桶两组｜管理台报送台两页 + 事故详情页通报区块改造｜种子两条样例链｜e2e 全生命周期 + 事故用例④改写｜文档收口（新篇 modules + overview + v1-gov + v8-recon + demo 两文档）。

**不做**（项目总纲 §2 全项之外，本波额外）：真实对外发送（「已提交」永远是人工标记 + 对外编号）｜报文正文生成（正文是自由文本草稿，无模板引擎）｜STR/CNMR/PNMR 报文族与 MLRO 提交权（波三）｜闹钟墙统一倒计时看板与 ⚡ 拨钟联动演示（波四；本波只做单据自身的截止时间显示与持久软标）｜合规日历 / 周期申报（波四）｜投诉（波五）｜推送提醒（通知层死码，丙战役）｜抄送机构的独立单据（抄送只是单上一个字段）｜监管门户模拟 / 回执自动到达（回执由合规官人工登记）｜deadline 的人工改期（截止时间一律按类型/依据码算出，不可编辑）。

## §1 主体与数据模型（schema 新增两表 + 事故表六列退役）

**RegulatoryFiling**（表 `regulatory_filings`）：

| 列 | 类型 | 说明 |
|---|---|---|
| `filingNo` | String @unique | `generateReferenceNo('FIL')`（前缀已核不撞车），对外业务键（铁律⑥） |
| `direction` | String | `OUTBOUND`（我方上报）/ `INBOUND`（监管来函应答），由类型行决定、不可自选 |
| `type` | String | filing-type-registry 键（§2） |
| `authority` | String | 受文机构目录键（§2）；INCIDENT_REPORT 从依据码带出，INBOUND/双头类开单时从目录选 |
| `ccAuthorities` | String? | 逗号分隔机构键（照 `reportBasisCodes` 轻量存储先例），仅双头类使用 |
| `basisCode` | String? | **单码**——一单＝一项通报义务（波一码目录注释原话），仅 INCIDENT_REPORT 类型有值 |
| `incidentNo` | String? @index | 关联事故（非唯一：一事故多单，如数据泄露双钟两单）；仅 INCIDENT_REPORT 必填 |
| `title` | String | 自动开单时生成 `<类型 label> — <incidentNo>`，手工开单必填 |
| `body` | String? | 报文正文草稿；SUBMITTED 后即「已提交内容」快照 |
| `receivedAt` | DateTime? | INBOUND 专用：来函收到时刻（登记时填，默认 now），48h 钟锚它 |
| `deadlineAt` | DateTime? | 法定截止：INCIDENT_REPORT 按依据码 hours 锚事故 `createdAt`；INBOUND 按类型 defaultHours 锚 `receivedAt`；无钟码/无钟类型为 null——其中 `immediate=true` 的码词表显示「立即」、其余显示「未设时限」（沿波一语义位，不混为一谈）；钟链码见 §5 |
| `externalRef` | String? | 对外编号（监管受理号）；SIGNED_OFF→SUBMITTED 必填 |
| `submittedAt` / `submittedByUserId` | DateTime? / String? | 人工标记已提交的时点与人 |
| `overdueMarkedAt` | DateTime? | 超时持久软标（§8） |
| `status` | String | §3 六态 |
| `closedAt` | DateTime? | 办结时点 |
| 时间戳 | | `createdAt`/`updatedAt` 照惯例 |

**RegulatoryFilingEntry**（表 `regulatory_filing_entries`，往来记录，只增不改）：`id`、`filingId` FK、`kind`（受控枚举：`RECEIPT_ACK` 监管回执 / `REGULATOR_INQUIRY` 监管追问 / `OUR_SUPPLEMENT` 我方补充答复——照 Ruling-14 教训，前端下拉受控、不做自由文本类型）、`body`、`externalRef?`（回执/追问的监管侧编号）、`recordedByUserId`、`recordedAt`。**仅 SUBMITTED 态可追加**；追加不推状态。

**事故表退役六列**（岔口②甲案落地）：`reportDeadlineAt`、`reportDraft`、`reportDraftedAt`、`reportedAt`、`reportedByUserId`、`reportReference` 直接删列。**保留两列**：`reportRequired`、`reportBasisCodes`——「该不该报」的判定发生在定损、属事故域语义，留作判定留痕与自动开单的输入。迁移文件照常新增、内容按目标终态（总纲 §3 允许假设：禁 backfill，改完 reset 重铺，收尾闸⑧）。

## §2 类型目录与受文机构目录（代码注册表，照 incident-type-registry 先例）

新文件 `src/modules/governance/regulatory-filings/filing-type-registry.ts`：

```ts
interface FilingTypeConfig {
  direction: 'OUTBOUND' | 'INBOUND';
  label: string;
  establishedBy: string;        // 设立出处，注记级、不杜撰条款号
  defaultAuthority: string | null;  // null = 开单时按依据码带出（INCIDENT_REPORT）或从目录人选（INBOUND）
  defaultCcAuthorities: readonly string[];
  defaultHours: number | null;  // null = 无钟或按依据码
  requiresIncident: boolean;
  enabled: boolean;
}
```

首发五行：

| 键 | 方向 | defaultAuthority | 钟 | requiresIncident | 说明 |
|---|---|---|---|---|---|
| `INCIDENT_REPORT` | OUTBOUND | null（按依据码） | 按依据码 | **true** | 事故通报，唯一可被自动开单的类型；`basisCode` 必填且须属该事故类型的 `reportBasisCandidates` |
| `REG_INFO_REQUEST_RESPONSE` | INBOUND | null（开单时从目录选） | 48 | false | 监管信息请求应答（V9 E①「48h 应答」），钟锚 `receivedAt` |
| `MATERIAL_CHANGE_NOTIFICATION` | OUTBOUND | VARA | null | false | 重大变更上报 |
| `AUDITOR_APPOINTMENT_NOTICE` | OUTBOUND | VARA | null | false | 外部审计师任命通知 |
| `MARKET_OFFENCE_DUAL_REPORT` | OUTBOUND | VARA | null | false | 市场违法双头上报；第二头开单时从机构目录选入 `ccAuthorities`（确切第二受文机构的法据不杜撰，种子演示选 UAE FIU） |

受文机构目录（常量 `RegulatoryAuthorities`，同文件或 filing constants）：`VARA` / `UAE_FIU` / `EOCN` / `UAE_DATA_OFFICE` / `CBUAE`，带 label。波三 STR 族、波四日历生成类**只加行不动骨架**——这是本波「骨架」二字的验收含义。

**依据码目录回填**（岔口#4 已裁「打通」）：`INCIDENT_REPORT_BASES` 七条各补一个结构化 `authority` 字段（`TIR_K_H`/`CRM_IV_E_5`/`CRM_V_D_2`/`TIR_II_C_24H`/`COMPANY_IV_H_1`/`COMPANY_VI_C_F` → VARA；`PDPL_ART_9` → UAE_DATA_OFFICE），label 文本不改。自动开单的 `authority` 即从码上取，不再从 label 里读人话。

## §3 状态机（六态六边，显式迁移表，铁律④）

```
DRAFT ──送签(合规官)──► PENDING_SIGNOFF ──高管批准(审批handler推)──► SIGNED_OFF ──标已提交+externalRef(合规官)──► SUBMITTED ──办结(合规官)──► CLOSED
  │                          │
  │                          └──高管驳回 / 合规官撤签(审批handler推)──► DRAFT（回草拟改了再送，可再送签）
  └──作废(合规官)──► CANCELLED
```

- 迁移表常量 `FILING_TRANSITIONS`，非法跃迁显式拒（照 `INCIDENT_TRANSITIONS` 先例）；终态 `CLOSED`/`CANCELLED` 零出边。
- 前置条件：送签须 `body` 非空；标已提交须 `externalRef` 非空（**留痕不真发的核心闸**）；往来记录仅 SUBMITTED；作废仅 DRAFT。
- INBOUND 同一生命周期：登记来函（开单，DRAFT，钟即起跑）→ 起草**答复** → 送签 → 标已提交（答复发出的人工标记）→ 关闭。不为方向另做状态机。
- 状态标签词表（前端人话）：草拟中 / 待签发 / 已签发待提交 / 已提交 / 已关闭 / 已作废。

## §4 签发审批链（走既有审批引擎）

- `ApprovalActionTypes.REG_FILING_SUBMIT`，链 `steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }]`，`timeoutHours: 48`，`allowCancel: true`（照 `INCIDENT_CLOSE_PRUDENTIAL` 同款形状）。
- maker＝合规官（送签动作创建审批单），checker＝高管——两角色天然分立，maker≠checker 由 verify:rbac S5 家族守（无自批面）。
- 审批通过 handler → 推 `PENDING_SIGNOFF→SIGNED_OFF`；驳回 / 撤单 handler → 推回 `DRAFT`（照事故结案链 handler 注册先例）。审批域自身留痕照旧，报送侧另记 §7 的迁移审计。

## §5 事件联动与事故侧收编（岔口②甲案落地）

**自动开单（一码一单）**：事故定损 `reportRequired=true` 时，**按选中的依据码逐码各开一张** `INCIDENT_REPORT` 单——波一码目录注释「一码＝一项通报义务（一只钟＋一个受文机构）」直接落成单据粒度。数据泄露勾 `PDPL_ART_9`+`TIR_II_C_24H` → 两张单、两只钟、两个受文机构，「同事件双钟」（总纲 §4 E①）自然成立。

**铁律③落法**：跨主体写只在 workflow——新 `incident-assessment-workflow.service.ts`（照 `incident-registration-workflow` 先例），controller 的 assess 端点改调它：先 `IncidentService.assess()`（原方法，判定留痕照旧），再 `RegulatoryFilingService.openForIncident()` 逐码建单。assess 返回形状从 `{ reportDeadlineAt }` 改为 `{ filingsOpened: filingNo[] }`（事故侧不再有自己的钟）。

**钟链码落地**（波一明注「波一不落这只钟」，本波落）：`chainStart='NOTICE'` 的码（现仅 `TIR_II_C_24H`）开单时 `deadlineAt=null`；**同事故下另一张单首次进 SUBMITTED 时**，将链单的 `deadlineAt` 落定为该 `submittedAt + hours`（仅当链单尚未 SUBMITTED 且钟未落定）。落钟动作记入触发单 `FILING_SUBMITTED` 审计的 metadata（`chainDeadlineSetFor: [filingNo]`），不另加码。

**手工开单**：合规官可开全部启用类型；`INCIDENT_REPORT` 手工开单须给 `incidentNo` + 合法 `basisCode`（补开逃生口，同样受 §6 权限与 §7 审计约束）。

**事故侧退役清单**（逐项，评审按此追）：
1. `IncidentService.saveReportDraft` / `markReported` 两方法删；`computeReportDeadline` 删（钟算法迁至 filing 服务按码计算）。
2. `incidents.controller.ts` 两端点删：`POST /:incidentNo/regulator-report`、`POST /:incidentNo/regulator-report/mark`；`SaveReportDraftDto`/`MarkReportedBodyDto`/`MarkReportedDto` 三 DTO 删。
3. rbac catalog 两条 POST 路由码删——**退役权限码必查 bindings**（2026-08-31 判例）：两码现挂五族写组，逐组摘除后 `db:base:sync` 自清。
4. 审计码 `INCIDENT_REGULATOR_REPORT_DRAFTED`/`INCIDENT_REGULATOR_REPORTED` 出名册：事故名册 11 码→9 码（动审计集，收尾过 delivery 触碰检查）。历史行不迁（重铺后无旧码行）；`audit:vocab` 词表脚本重跑入库，差集 fail-fast 按 act7 波三惯例处置。
5. `test/incident-register.e2e-spec.ts` 用例④改写：断言从「草案→标已通报」改为「定损→自动开单（两码两单）→ deadlineAt 按码」，原「reportDeadlineAt===null（两码均无钟）」的断言语义平移到单据上。
6. 事故 `getView` 增 `filings` 摘要（filingNo/status/authority/deadlineAt/overdueMarkedAt）——事故侧**横向只读** filing 行（读放行、写仍禁，铁律③），事故读权限即可看到摘要，免得五族经办人开事故页撞 403；单据详情页才要 §6 的读权限。
7. **结案守卫改判**（plan 摸底补充，2026-09-26）：`IncidentCloseWorkflowService.requestClose` 现有前置「`reportRequired && !reportedAt` → 400（通报没留痕不许关）」随 `reportedAt` 退役改判为——`reportRequired=true` 时，该事故名下全部 `INCIDENT_REPORT` 报送单须已提交（`submittedAt` 非空，即状态 ∈ {SUBMITTED, CLOSED}），任一未提交或名下零单均 400。语义不变（没向监管交差不许关事故），证据源从事故单槽换成报送单。结案审批快照的 `reported` 布尔同步改从该判定取值。

## §6 RBAC（新域两桶两组）

- 新域 **Regulatory Filings**（overview §4 表 13 域→14 域，66 桶→68 桶）：
  - `filings.view`「View regulatory filings」→ `['REG_FILING_READ']`——**单组桶**，照 Ruling-13 直接按单组设计，不新增第三个同形缺口。
  - `filings.desk`「Operate the regulatory filing desk」→ `['REG_FILING_WRITE']`（开单/草稿/送签/标已提交/往来记录/办结/作废全动作）。
- 组两个（PermissionGroup 74→76）：`REG_FILING_READ` 含两条 GET 码；`REG_FILING_WRITE` 含 GET+全部 POST 码（写组码集包含读码，子集完备推导先例）。
- **不设 `cap.*` 标记码**：Ruling-6 的标记码解决「多组共享路由码时服务层按族独占」；本域经办组唯一（合规官），POST 路由码只挂 `REG_FILING_WRITE` 一组，路由门即精确门，服务层不再重复造门（YAGNI）。
- 路由：`GET /admin/regulatory-filings`、`GET /admin/regulatory-filings/:filingNo` → 两组 OR；`POST /admin/regulatory-filings`（手工开单）、`POST /:filingNo/draft`、`/:filingNo/signoff`、`/:filingNo/mark-submitted`、`/:filingNo/entries`、`/:filingNo/close`、`/:filingNo/cancel` → 仅 WRITE。
- 角色绑定：`COMPLIANCE_OFFICER` += `REG_FILING_WRITE` **及 `INCIDENT_READ`**（plan 摸底补充：合规官现况不持 `INCIDENT_READ`，但起草事故通报必须读得到事故详情与留痕，照「裁决人要看得见」同款理由）；`SENIOR_MANAGEMENT_OFFICER`、`INTERNAL_AUDITOR` += `REG_FILING_READ`（签字人与内审要看得见，照 CISO 批事故拿 `INCIDENT_READ` 先例）。MLRO 本波不给（波三报文族随其瘦身包一并设计）。
- `verify:rbac` 扩判据：正探针（合规官开单/送签打真端点）＋反探针（运营/金库/技术官 POST 403）＋签发链唯高管；矩阵头条补一句「报送台经办唯合规官、签发唯高管」。
- 惯例收尾：route() 登记 + `db:base:sync` + 重启（只 seed 不重启＝403 判例）。

## §7 审计名册（新主体十码，铁律①）

`REG_FILING_AUDIT_ACTIONS`（domain GOVERNANCE，requiredFields 逐码钉，照事故名册风格）：

| 码 | 触发 | 要点 |
|---|---|---|
| `FILING_OPENED` | 自动/手工开单 | metadata 带 source（`INCIDENT_ASSESSMENT`/`MANUAL`）、incidentNo、basisCode、authority、deadlineAt |
| `FILING_DRAFT_SAVED` | **首次**存草稿 | 照事故先例只证「何时开始起草」，再存不重记 |
| `FILING_SIGNOFF_REQUESTED` | 送签 | 带 approvalNo |
| `FILING_SIGNED_OFF` | 审批通过 handler | fromStatus/toStatus |
| `FILING_SIGNOFF_REJECTED` | 驳回/撤签 handler | 同上 |
| `FILING_SUBMITTED` | 标已提交 | requiredFields 含 externalRef；metadata 可带 chainDeadlineSetFor |
| `FILING_ENTRY_LOGGED` | 追加往来记录 | requiredFields 含 kind |
| `FILING_OVERDUE_MARKED` | 超时软标（§8，系统 actor） | 带 deadlineAt |
| `FILING_CLOSED` | 办结 | |
| `FILING_CANCELLED` | 作废 | |

## §8 超时持久软标（销 BACKLOG 2026-09-06 行）

- 新 `regulatory-filing-sweep.service.ts`：`@Cron` 包装 + 扫描逻辑分离（照 `swap-sla.service.ts` 先例，测试直调不等真钟）。条件：`deadlineAt < now` 且 `overdueMarkedAt IS NULL` 且 status ∈ {DRAFT, PENDING_SIGNOFF, SIGNED_OFF}（按时提交过的永不标；迟交的标记留着不清）。命中：落 `overdueMarkedAt` + 记 `FILING_OVERDUE_MARKED`（一次性）。
- 这正是 BACKLOG「事故通报超时无持久软标与审计」的债：钟已随岔口②搬到单据上，软标+审计在单据侧补齐；「须业主扩名册」的前提由本 spec 业主复核时一并裁决（新主体新名册，不动事故十一码合同——事故侧反而收缩为九码）。列表/详情页超时行标红用这个持久字段，不再是前端算。
- ⚡ 拨钟联动的**演示编排**归波四闹钟墙；本波交付机制本身（sweep + 软标 + 审计），e2e 直调扫描逻辑验证。

## §9 前端（管理台，photo 闸⑤）

- 新页 `RegulatoryFilingListPage`（列表：filingNo/类型/方向/机构/状态/截止时间/超时红标/关联事故）+ `RegulatoryFilingDetailPage`（详情：正文草稿编辑、送签、标已提交（填对外编号）、往来记录时间线（受控 kind 下拉）、办结/作废、审计留痕区照惯例）。侧边栏入治理组。
- `IncidentDetailPage` 通报区块改造：删草稿 textarea 与「标已通报」按钮，改「关联报送单」表（读 getView 新摘要），行点击跳单据详情（有读权限者）。
- 受控枚举纪律（Ruling-14）：authority、cc、entry kind 全下拉受控；basisCode 自动带出只读。
- 词表：状态六标签 + entry kind 三标签入词表；对外一律 filingNo（铁律⑥，UUID 不出前端）。

## §10 种子与演示数据

种子铺两条样例（`prisma/seed.business.ts` 惯例位，`demo/data.md` 生成区同步）：
1. **出站全链**：一条 `CYBER_BCDR` 事故定损勾 `TIR_K_H` → 自动开单 → 已签发 → 已提交（externalRef `VARA-ACK-2026-xxxx` 样式）→ 一条 `RECEIPT_ACK` 往来记录。演示「事件→工单→已提交→回执」验收主线。复用波一五条种子样例之一还是新增一条，以**不破坏 `demo/data.md` 既有生成区断言**为判据，plan 时实测定。
2. **入站在途**：一张 `REG_INFO_REQUEST_RESPONSE`（authority VARA，`receivedAt` 近期）草拟中，48h 倒计时在跑。
双钟链（DATA_BREACH 两单）不入种子，留 demo 现场走（modules 新篇 §4 演示脚本编排）。

## §11 测试与闸

- 单测：迁移表非法边显式拒 / 送签空正文拒 / 标已提交缺 externalRef 拒 / entries 非 SUBMITTED 拒 / 钟链落定 / 手工开单 basisCode 越类型拒 / sweep 条件三分支。
- e2e 新 `test/regulatory-filing.e2e-spec.ts`（integration spec 必经 on-stack 跑，act7 波二判例）：出站全链（含高管批）/ 驳回回草拟再送 / 入站 48h 钟 / 自动开单一码一单 / sweep 直调标超时。
- 既有改写：事故 e2e 用例④（§5 第 5 条）；`verify:rbac` 扩判据。
- 变异测试点（评审/终审用，常驻化照波一）：①迁移表删一条边应红 ②签发链角色换运营应红 ③externalRef 前置注释掉应红。
- 闸：随手闸①②③④⑤照总纲；收尾⑥ `on-stack demo:all` + ⑧重铺闸（动 schema）；⑦不触发——**本波零账务**（无资金移动，无资金单，无分录）。

## §12 文档收口清单（delivery-checklist 触发项）

- 新篇 `modules/v9-regulatory-filing.md`（§0-4 照篇目结构，§4 演示脚本含双钟链走法）；overview §1 模块表加一行、§4 权限表 14 域 68 桶 76 组改数、§5 技术节点补模块根。
- `v1-governance.md` §7 通报节改写（判定留事故、过程归报送台）；`v8-recon.md` 场景 18 走查步骤改（「保存通报草案→标已通报」→「自动开单→单上办」）。
- `demo/data.md` 生成区 + `demo/script.md` 对应步骤同步。
- `BACKLOG.md` 销「事故通报超时无持久软标与审计」行；甲波一 T11 登记的 `customer.view` 三组捆绑行**不动**（客户域债，非本波）。
- delivery 30 秒触碰检查命中两项：动了**审计集**（事故 11→9、新增报送十码）、新增**状态机**——改 `delivery/` 对应文件。
- `CHANGELOG.md` 一合并一行；岔口②与经办签发两裁决随波五收官统一入 `decisions.md`（总纲 §7）。
- 收尾立**波三骨架**（链总纲 + 承接：报送台工单主体形状、类型目录扩行方式、MLRO 包待设计）。

## §13 波三 / 波四钩子（本波只留位，不实现）

- 波三 STR/CNMR/PNMR：filing-type-registry 加行即可挂上状态机与审批链；MLRO「报文类工单独占提交权」届时按本域先例加组（若报文族要与通用族分权、且路由码共享，届时按 Ruling-6 标记码模式，本波不预设）。
- 波四：闹钟墙读 `deadlineAt`/`overdueMarkedAt`；合规日历「到期生成待办工单」的挂靠对象＝本主体（`PRUDENTIAL_BREACH` 每日更新即挂 filing，骨架「PRUDENTIAL 联动位」议题就此闭合）。

## §14 流程注记

- 波二非总纲点名高危波（§8 点名波一/波三），plan 评审按常规档；终审、变异测试不降档（项目惯例）。执行照 SDD，任务 prompt 带项目总纲 §0–§5 要点。
- 骨架五岔口处置：①岔口②＝甲（业主）②六字段＝留二删六（业主通过设计稿）③PRUDENTIAL 立即通知＝切工单（随甲案）④authority＝回填打通（随设计稿）⑤联动触发＝自动开单+手工逃生口（随设计稿）。
