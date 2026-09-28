# 投诉工作流（Complaint）

> 对应 PRD：待写 ｜ 技术节点 Last Verified：2026-09-28（战役甲波五：投诉全弧上线，`Incident Register` 域加两桶：15 域 75 桶，组数见 §2）
> 演示幕次：第八幕场景 23/24（战役甲波五收官定稿）｜ 验收：场景 23/24 走查（`demo/script.md`）+ 本篇 §4

## 0. 这是什么

投诉是**客户对外发声、内部按 VARA Market Conduct（`MC III.A`）时限处理的一条独立主体**——客户端首次可以提交、能看进展，管理台运营受理调查、合规官裁决。不是事件登记的子类，也不是材料请求的变体：它有自己的双钟（1 周确认钟、4 周裁决钟，可延一次到 8 周）、自己的六态迁移表、自己的对客户书面（确认函 / 延期说明 / 最终答复）。

- **谁提交**：客户本人，client-web 首触（本波第一次动客户端）。
- **谁受理调查**：运营（`COMPLAINT_WRITE`）——确认收悉、立案、加内部备注、延期、提裁决、升级。
- **谁裁决**：合规官——裁决走 maker-checker（运营提 `COMPLAINT_RESOLUTION` 审批、合规官批），不占额外权限桶（走审批角色路由）。
- **它不做什么**（对照总纲 §2 与 spec §11）：不做自动升级（超时只标红，升级永远是人工点击）；不做二次延期（只许一次）；客户端不做对话 / 附件 / 撤回（只提交 + 只读时间线 + 三类书面）；不联动报送台/日历（VARA 无投诉专属报送义务，调研已证）；不做简单/复杂投诉分级（VARA 无此分级，CBUAE 的规则不适用）。

## 1. 主体与状态机

### 1.1 表 `complaints` / `complaint_entries`

`complaints`：`complaintNo`（`CMP` 前缀业务键）、`ownerCustomerNo`、`category`（`SERVICE / FEES / ORDER_EXECUTION / FROZEN_FUNDS_APPEAL / OTHER`）、`relatedOrderNo?`、`subject` / `description`、`currentStatus`、`submittedAt` / `ackDeadlineAt` / `acknowledgedAt?`、`resolveDeadlineAt` / `extendedAt?` / `resolvedAt?`、`resolutionOutcome?`（`UPHELD / PARTIALLY_UPHELD / REJECTED`）/ `resolutionText?`、`escalatedIncidentNo?`（升级后回填，兼一次性守卫）。冻结期限（自 `submittedAt` 起，自然日，条款 `MC III.A.1`）：确认 7 天、裁决 28 天、延期后 56 天。

`complaint_entries`（三段留档第二段「措施」+ 全部书面往来）：`complaintNo`、`kind`（`INTERNAL_NOTE` 内部备注 / `CLIENT_MESSAGE` 对客户可见）、`messageType?`（`CLIENT_MESSAGE` 专用：`ACK / EXTENSION_NOTICE / FINAL_RESPONSE`）、`body`、`actorNo`、`createdAt`。**客户提交与客户可见记录的 actor 用 customerNo 或内部 admin userNo，不写 UUID**（审计页留账判例，本波不重蹈）；`applyResolution()` 落地的 `FINAL_RESPONSE` 一行的 `actorNo` 是系统动作，落字面量 `'SYSTEM'`（裁决生效无人工 actor）。

### 1.2 状态机（显式迁移表 `COMPLAINT_TRANSITIONS`，铁律④；非法跃迁显式拒绝）

```
RECEIVED ──acknowledge──▶ ACKNOWLEDGED ──startInvestigation──▶ INVESTIGATING
  INVESTIGATING ──extend──▶ INVESTIGATING_EXTENDED          （强制解释文字；28d→56d；extendedAt 已有则拒，只许一次）
  INVESTIGATING / INVESTIGATING_EXTENDED ──proposeResolution──▶ RESOLUTION_PENDING（起草结论+答复，开 COMPLAINT_RESOLUTION 审批）
  RESOLUTION_PENDING ──applyResolution──▶ RESOLVED（审批通过；终态，零出边）
  RESOLUTION_PENDING ──rejectResolution──▶ INVESTIGATING 或 INVESTIGATING_EXTENDED（按 extendedAt 有无选边，两条显式回退边）
```

- `acknowledge` 必填确认函文本 → entries `CLIENT_MESSAGE/ACK`；`extend` 必填解释 → entries `CLIENT_MESSAGE/EXTENSION_NOTICE`；`applyResolution` 落 `resolutionText` → entries `CLIENT_MESSAGE/FINAL_RESPONSE`——三个动作各自把「状态迁移 + 强制往来记录 + 审计」绑死。
- **升级是动作不是状态**（照事故域 `escalate` 先例）：`INVESTIGATING` / `INVESTIGATING_EXTENDED` 两态可执行 `markEscalated`，守卫 = `escalatedIncidentNo` 为空；升级后投诉弧继续走——8 周条文义务不因内部升级消失（`RESOLVED` 后不可再升级），实测（场景 24）升级后投诉仍停在 `INVESTIGATING_EXTENDED`，需要另外走 `proposeResolution` 才能收尾。
- 审批载荷时序照波四判例拆三步：`propose` 快照进审批单 `objectSnapshot`，`apply` 从载荷读值落地——投诉表本身不落 `outcome`/`resolutionText`，值住在审批单里直到批准那一刻。

### 1.3 单号与业务键

`complaintNo` 用 `generateReferenceNo('CMP')`，照 RI/VEN/OBL/FIL 既有前缀惯例（铁律⑥）；对外识别一律用 `complaintNo`，两端 UI 不暴露 UUID。

## 2. 权限与审批

### 2.1 RBAC（桶挂 `Incident Register` 域，不新增域——骨架岔口 4 裁定）

| 桶 | 组 | 持有 |
|---|---|---|
| `complaints.view`（看列表 / 详情 / 双钟 / 往来） | `COMPLAINT_READ`, `COMPLAINT_WRITE`（OR） | `COMPLAINT_READ` 恰为合规官 / MLRO / 内审三职务；`COMPLAINT_WRITE` 见下 |
| `complaints.manage`（确认 / 立案 / 备注 / 延期 / 提裁决 / 升级） | `COMPLAINT_WRITE` | 唯运营（`OPS_OFFICER`）——绑 `INCIDENT_OPS_WRITE` 现持有职务，同一角色受理调查 |

`Incident Register` 域因此从 6 桶扩到 **8 桶**（`incidents.*` 六桶 + `complaints.view` + `complaints.manage`）；`verify:rbac` S12a/b/c 三条静态判据钉死「两组四处齐 / `COMPLAINT_WRITE` 唯运营 / `COMPLAINT_READ` 恰三职务」。合规官虽是裁决人，但**不持 `COMPLAINT_WRITE`**——裁决走审批角色路由（`MAKER_GROUP_BY_POLICY['COMPLAINT_RESOLUTION'] = 'COMPLAINT_WRITE'`，`ApprovalActionTypes.COMPLAINT_RESOLUTION` 策略 `steps:[{roles:['COMPLIANCE_OFFICER']}]`），不占额外权限桶——这是本波「maker≠checker 靠角色路由分立、不靠权限组分立」的示范。

### 2.2 两条新审批策略（`approval.constants.ts`，48h 超时可撤，照 `RI_REPLACEMENT` 先例）

| 审批类型 | 步数 · 裁决人 | 用途 |
|---|---|---|
| `COMPLAINT_RESOLUTION` | 单步：`COMPLIANCE_OFFICER` | 投诉裁决——运营 `propose`，合规官批准后 `applyResolution` 落地；驳回 / 撤单 / 过期 → `rejectResolution` |
| `INCIDENT_CLOSE_CUSTOMER` | 单步：`COMPLIANCE_OFFICER` | 升级出的 `COMPLAINT_ESCALATION` 事件结案——占位改判（原 `INCIDENT_CLOSE_FINANCIAL` 占位，本波改 CUSTOMER），事件族第五条结案链，见 §3 |

两条策略在 `scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 各占一行（`COMPLAINT_RESOLUTION`→`COMPLAINT_WRITE`、`INCIDENT_CLOSE_CUSTOMER`→`INCIDENT_OPS_WRITE`，S5 自批死锁闸覆盖）。

### 2.3 审计十码（domain `GOVERNANCE`，`COMPLAINT_AUDIT_ACTIONS`，出生即冻结四属性）

`COMPLAINT_SUBMITTED` / `COMPLAINT_ACKNOWLEDGED` / `COMPLAINT_INVESTIGATION_STARTED` / `COMPLAINT_NOTE_ADDED` / `COMPLAINT_EXTENDED`（必填 `newResolveDeadlineAt`）/ `COMPLAINT_RESOLUTION_PROPOSED`（必填 `resolutionOutcome`）/ `COMPLAINT_RESOLUTION_APPLIED`（必填 `resolutionOutcome`）/ `COMPLAINT_RESOLUTION_REJECTED` / `COMPLAINT_ESCALATED`（必填 `escalatedIncidentNo`）/ `COMPLAINT_DEADLINE_FASTFORWARDED`（必填 `target`）。

**控制器承接项（措辞订正）**：PROPOSED / APPLIED 两码的特有必填字段名是 **`resolutionOutcome`**，不是 plan 原文的 `outcome`——DTO 请求体字段确实叫 `outcome`（`ResolutionBodyDto.outcome`），但落审计时改用 `resolutionOutcome`，因为审计信封本身已经保留 `outcome` 这个键名（其它域的码也用它，撞名会让 `assertActionSpec` 校验拿错字段），本波裁定改名避让。状态边码一律写 `fromStatus`/`toStatus`（判例）；展示级字段（`newResolveDeadlineAt`、`resolutionOutcome`、`target` 等）镜像进 `metadata`（R5 判例延续，波五新写点不重蹈波二 `FILING_OVERDUE_MARKED` 的 `extra`-only 老问题）。

审计现役码全量目录 **286 → 296**（`audit:vocab` 实跑数，GOVERNANCE 域 33 → 43）。

## 3. 与事件中心的联动

- **升级 = 生成真实事件，不是文案**（骨架岔口 1 裁定，业主拍板）：`ComplaintEscalationWorkflowService.escalate(actor, complaintNo)` 照 `ri-replacement-workflow` 先例只编排、零自己审计——投诉侧 `markEscalated`（记 `escalatedIncidentNo` + 审计 `COMPLAINT_ESCALATED`）、事件侧 `IncidentService.registerFromComplaint()`（审计复用既有登记码，metadata 带 `complaintNo`）。
- **扳机是人工点击，不是超时自动**（裁定 1 子岔口）：超时只软标变红（clock-wall 分支，见下），不自动开事件；升级唯一入口 = 投诉详情页「Escalate to Incident」按钮，预拦 = 两调查态 + 未升级过，拒时不建单。
- **`incident-type-registry.ts` 的 `COMPLAINT_ESCALATION` 行**（本波从占位 `enabled:false` 改 `enabled:true`）：`family:'CUSTOMER'`、`operatorGroup:'INCIDENT_OPS_WRITE'`（波一裁决点名保留，运营也是事件经办人）、`closeActionType:'INCIDENT_CLOSE_CUSTOMER'`、`requiredAnchors:['complaintNo','ownerCustomerNo']`、`reportBasisCandidates:[]`（调研 §2.4 证无监管通报义务）、`assessmentScheme:'IMPACT'`、`allowedRemediationKinds:[]`（空集——同 `CYBER_BCDR`/`OUTSOURCING_FAILURE`/`STUCK_TRANSACTION_MAJOR`/`PRUDENTIAL_BREACH` 四类先例，定损即可直接结案，Ruling-10 乙案，无需先挂善后单）。详见 `modules/v1-governance.md` §7 类型表。
- **门语义保留**（评审要点，T8 e2e 覆盖）：`/admin/incidents` 手工登记入口对 `COMPLAINT_ESCALATION` 显式拒绝（`MANUAL_REGISTRATION_BLOCKED_TYPES` 清单，任意 actor 400，门在 `assertOperator` 之前）；只有投诉侧内部入口（`registerFromComplaint`）能生成这类事件——实测（场景 24）该事件走完标准事件调查/定损（IMPACT 口径）/结案三步，结案审批 `actionType=INCIDENT_CLOSE_CUSTOMER`、裁决人合规官单步批准。
- **双向可点**：投诉详情页「Escalated Incident」链接跳事件详情；事件详情页「Complaint No」链接跳回投诉详情（`incidentStatusMap.ts` `ANCHOR_FIELD_LABEL` 补 `complaintNo` 人话标签 + `IncidentDetailPage.tsx` 该字段渲染回链）。

## 4. 客户端与管理台可见面

### 4.1 client-web（本波首触，spec 裁定 6：能提交、能看进展，不能来回聊）

- `Complaints.tsx`（列表 + 「New Complaint」提交表单：类别 / 主题 / 可选关联单号 / 描述）、`ComplaintDetail.tsx`（四步人话 Progress 时间线 + 仅 `CLIENT_MESSAGE` 三类往来，人话标签）。
- 路由：`POST /client/me/complaints`、`GET /client/me/complaints`（仅本人）、`GET /client/me/complaints/:complaintNo`（别人的号统一「查无」，非 403）。
- **不下发**：升级、内部备注、审批过程——客户端只看得到「处理中」，看不到 `pendingApprovalNo` / `escalatedIncidentNo` / `entries.actorNo`（内部治理信息不下发，裁定原话）。

### 4.2 admin-web

- `ComplaintListPage.tsx`（单号 / 客户(链) / 类别 / 主题 / 状态 / 双钟倒计时(超时红) / 升级事件号(链)，七列零 UUID）、`ComplaintDetailPage.tsx`（Basic Info / 双钟卡 / Workflow 七枚按钮逐一落位(Acknowledge / Start investigation / Add note / Extend / Propose resolution / Escalate / ⚡ Fast-forward) / Correspondence 全量含内部备注 / Audit Trail 惯例），动作按钮可见性 = **状态 × 持码**双维（波二判例）。
- 路由（`rbac.catalog.ts route()` 登记）：`GET /admin/complaints`、`GET /admin/complaints/:complaintNo`、`POST .../acknowledge | investigation | notes | extend | propose-resolution | escalate`（均 `COMPLAINT_WRITE`）、`POST .../simulate-timeout`（`DEMO_CLOCK_WRITE`，见 §5）。

### 4.3 演示脚本

完整走查步骤见 `demo/script.md`「场景 23」「场景 24」两节；走查截图（真实 self 栈渲染，含账号切换）入 `doc-final/superpowers/checkups/2026-09-28-act-a-wave5-evidence/`（`08`~`13`，续 T9 的 `01`~`07`）。

**场景 23 · 投诉全弧含延期**：客户提交 → 运营确认（1 周钟停）→ 立案调查 → ⚡ 拨过裁决钟 → 运营延期（强制解释，4→8 周）→ 提裁决（`COMPLAINT_RESOLUTION` 审批）→ 合规官批 → 客户端详情看三类书面齐全（确认函 / 延期说明 / 最终答复）。

**场景 24 · 升级转事件**：（承接一张 INVESTIGATING 种子投诉）运营先延期到 8 周 → ⚡ 拨过裁决钟 → 闹钟墙该行变红 Overdue → 运营点 Escalate to Incident → 事件生成（`COMPLAINT_ESCALATION`，anchors 齐）→ 事件调查 + 定损（IMPACT 口径，无需善后单）→ 提结案（`INCIDENT_CLOSE_CUSTOMER` 审批）→ 合规官批 → 事件 CLOSED、投诉侧 `escalatedIncidentNo` 回填、投诉/事件详情页双向跳转可点；口播「手工登记这类事件仍被拒绝，只有投诉侧内部入口能开」。

**⚡ 换号话术（两幕都要用）**：运营（受理调查的经办人）**不持 `DEMO_CLOCK_WRITE`**——投诉详情页看不到 Fast-forward 按钮；能拨钟的是**金库或超管**（`DEMO_CLOCK_WRITE` 持有者），但金库不持 `COMPLAINT_READ`/`COMPLAINT_WRITE`、进不了投诉详情/列表页，实测能同时看到页面又点得动按钮的只有超管（`admin@fiatx.com`）——与场景 21 闹钟墙 ⚡ 同款 RBAC 交叉现象，T6 探针已实证（金库 simulate-timeout 200、运营 403）。剧本步骤：运营立案后 → 切超管 → 详情页点 ⚡ → 切回运营继续走延期/裁决。

## 5. 时钟与闹钟墙

`compliance-clock-wall.service.ts` 加 `kind='COMPLAINT'` 分支：`currentStatus != 'RESOLVED'` 的每张投诉一行——`deadlineAt = acknowledgedAt == null ? ackDeadlineAt : resolveDeadlineAt`，`clockLabel` 区分两钟（`Acknowledge (1w)` / `Resolve (4w/8w)`），不复用 FILING/OBLIGATION 两表的列名（骨架字段命名提醒落地）。超时 = 软标变红，无自动动作（裁定 2，同报送单/义务台账先例）。

⚡ 新装置 `POST /admin/complaints/:complaintNo/simulate-timeout`（挂既有 `DEMO_CLOCK_WRITE`，波五起两族拨钟权全归金库+超管，运营已退出旧持有——T6 探针实证的门控交叉现象）：拨对应 deadline 至 `now-1h`；终态 400。

## 6. 关键技术节点

- 后端模块 `src/modules/governance/complaints/`：`complaint.constants.ts`（六态迁移表/双钟常量/枚举）｜ `complaints.service.ts`（主体服务，`submit`/`acknowledge`/`startInvestigation`/`addNote`/`extend`/`proposeResolution`/`applyResolution`/`rejectResolution`/`markEscalated`/`simulateTimeout`/客户与管理台读面）｜ `complaint-resolution-workflow.service.ts` + `complaint-resolution-approval.service.ts`（裁决 maker-checker 编排，照 `ri-replacement-workflow` 先例）｜ `complaint-escalation-workflow.service.ts`（升级编排，铁律③：只调 `IncidentService.registerFromComplaint` 与 `ComplaintsService.markEscalated`）｜ `complaints.controller.ts`（admin 面）｜ `complaints.client.controller.ts`（client 面，`@Controller('client/me')`）｜ `dto/complaint.dto.ts`｜ `complaints.module.ts`（挂 governance 域，imports IncidentsModule/ApprovalsModule）
- Prisma 新表两张 `complaints`/`complaint_entries`，互无外键、无横向联动；reset 登记表已加（波二判例）
- 单号前缀 `CMP`（`generateReferenceNo()` 共享工具）
- 种子三张投诉（Bob Happy 名下）：① `RECEIVED` 新到（确认钟在跑）② `INVESTIGATING` 临近裁决钟（供 ⚡/延期演示起点）③ `RESOLVED` 全档（三段留档完整，entries 四条）——详见 `demo/data.md`「投诉种子」

## 7. 演示缺口（BACKLOG 有账）

无本波新登业务缺口——本波扫账结论见 `BACKLOG.md` 末尾 Last Updated 行；波二遗留的 `FILING_OVERDUE_MARKED` `metadata` 不对称行与本波无关，不在此重复。
