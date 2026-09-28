# 战役甲波五 · 投诉工作流 + 战役收官 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地投诉全弧（客户端提交 → 受理/确认/调查/延期/裁决 → 升级转事件）+ 战役甲收官（四主线走查、§4 销账、三刀入 decisions）。

**Architecture:** 新主体 Complaint（两张 Prisma 表 + 六态显式迁移表，双钟 7/28/56 自然日）；裁决走 maker-checker（运营提/合规官批，照 `RI_REPLACEMENT` 先例）；升级 = 人工动作经 workflow 编排生成 `COMPLAINT_ESCALATION` 事件（波一占位通电，手工登记继续拒）；事件结案新开合规官单步链；闹钟墙加 COMPLAINT 分支；client-web 首触（提交 + 只读时间线）。

**Tech Stack:** NestJS + Prisma(SQLite) + 既有审批引擎 / 审计 / RBAC 目录；admin-web + client-web React。

**Spec:** `doc-final/superpowers/specs/2026-09-28-campaign-a-wave5-complaint-closeout-spec.md`（§0 六条裁定台账；§1 一手条文销账）；总纲 `2026-09-25-campaign-a-incident-regulatory-charter.md`；调研 `checkups/2026-09-27-complaint-handling-regulatory-research.md`。

## Global Constraints（每个 task 的 prompt 必须携带）

- **项目性质**（总纲 §0/§1）：演示系统，只做演示者带同事走流程时看得到讲得到的东西；PRD 级业务规则做、技术兜底不做。
- **禁做**（项目总纲 §2 全项）：幂等｜去重｜重试回放｜补偿 repair｜并发锁｜兼容层｜权限加固｜输入防御性校验｜性能优化｜边界防御。发现技术兜底缺口 → `doc-final/PRODUCTION-NOTES.md` 追加一行放下。
- **六条铁律**：操作必留痕｜门不可绕｜各管各的（跨主体只经 workflow 调服务方法）｜状态只能沿显式迁移表走｜钱动必过账（本波零账务，不触发）｜对外用业务键（新前缀 `CMP`，两端 UI 不暴露 UUID）。
- **依据不杜撰**：时限与条款号只用 spec §1 已核值——确认 7 天 / 裁决 28 天 / 延期 56 天（自 submittedAt，自然日）；条款只写 `MC III.A.1` / `MC III.A.5` / `CRM I.B.3.b`。表上没有的数字不许出现在代码/文档。
- **随手闸**（每 task 改完必跑）：`npx tsc --noEmit -p tsconfig.json`；改 admin-web 另跑 `cd admin-web && npx tsc -b --noEmit`；改 client-web 另跑 `cd client-web && npx tsc -b --noEmit` + 仓库根 `npm run test:client`；jest 只跑本任务目录、在仓库根跑，判据全绿。
- **测试的绿必须来自行为**；禁扫源码文本断言；mock 行为化（mock 无视 where 假绿判例）。
- **worktree 环境**：本会话 worktree `.claude/worktrees/act-a-wave5`（分支 `worktree-act-a-wave5`），栈=self（端口在 `.stackports`）。首跑 prisma/jest 前 `npm install && npx prisma generate`；e2e / demo 脚本必经 `bash scripts/on-stack.sh self <script>`。
- **派发档位**：任务执行 = sonnet；**T2/T3/T4 任务级 review 升 opus**（动状态机/审批矩阵/事件门，spec 点名高危）；其余任务级 review sonnet；终审回主会话 Fable 不降档。派 subagent prompt 带项目总纲 §0–§5 要点。
- **client-web 首触**：T5/T9 开工先读 `doc-final/rules/frontend-client.md` + `ui-contract/`；客户可见性按 spec 裁定 6（仅 CLIENT_MESSAGE 三类下发，内部备注/升级/审批不下发）。
- 通用交付清单见 `rules/delivery-checklist.md`，全部适用；每任务尾行写死「本任务过清单哪几条」，执行者收尾逐条报。
- 本轮特有：审计码 **10 枚**出生即冻结四属性 + 每次写入显式 `requestId`；新审批策略两条同步 `verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY`；rbac.catalog 改后必须 `stack.sh reset self` 再打探针（只 seed 不重启 = 403 假阴）；客户动作审计 actor 传 **customerNo**（审计页留账判例，新码不重蹈 UUID）。

**预期终态数量（T10 收口逐项核对，对不上就停）**：RBAC 域 15 不变、桶 73→75、组 81→83｜审批类型 +2（`COMPLAINT_RESOLUTION` / `INCIDENT_CLOSE_CUSTOMER`）｜Prisma 新表 2｜审计现役码 273→286 为波四终值，本波 286→**296**（10 新码，以 `audit:vocab` 实跑为准）｜事件类型行 10 不变（1 行改 0 行增；原误写 12 系报送类型行数，评审订正）｜场景 +2（23/24 暂编）｜页面 client-web +2、admin-web +2。

---

### Task 1: Prisma 两表 + reset 登记

**Files:**
- Modify: `prisma/schema.prisma`（两个新 model，放在波四 `ResponsibleIndividual` 之后）
- Create: `prisma/migrations/<timestamp>_wave5_complaints/migration.sql`（`npx prisma migrate dev --name wave5_complaints` 生成）
- Modify: reset 登记位点（grep `compliance_obligations` 在 `scripts/**` 与 seed 的登记处，两张新表同款照加——波二判例：加表必配 reset 登记表）

**Interfaces（Produces）:** Prisma models `Complaint` / `ComplaintEntry`。

- [ ] **Step 1: 环境**：`npm install && npx prisma generate`；`node -v` 确认 v20。
- [ ] **Step 2: schema 两表**（字段语义 spec §2.1 逐列照抄）：

```prisma
model Complaint {
  id                  String    @id @default(uuid())
  complaintNo         String    @unique
  ownerCustomerNo     String
  category            String    // SERVICE | FEES | ORDER_EXECUTION | FROZEN_FUNDS_APPEAL | OTHER
  relatedOrderNo      String?
  subject             String
  description         String
  currentStatus       String    @default("RECEIVED")
  submittedAt         DateTime  @default(now())
  ackDeadlineAt       DateTime
  acknowledgedAt      DateTime?
  resolveDeadlineAt   DateTime
  extendedAt          DateTime?
  resolvedAt          DateTime?
  resolutionOutcome   String?   // UPHELD | PARTIALLY_UPHELD | REJECTED
  resolutionText      String?
  escalatedIncidentNo String?
  pendingApprovalNo   String?
  traceId             String
  createdAt           DateTime  @default(now())
  updatedAt           DateTime  @updatedAt
  @@index([currentStatus])
  @@index([ownerCustomerNo])
  @@map("complaints")
}

model ComplaintEntry {
  id          String   @id @default(uuid())
  complaintNo String
  kind        String   // INTERNAL_NOTE | CLIENT_MESSAGE
  messageType String?  // CLIENT_MESSAGE 专用: ACK | EXTENSION_NOTICE | FINAL_RESPONSE
  body        String
  actorNo     String   // 客户行=customerNo；内部行=admin userId（显示走既有审计 actor 惯例）
  createdAt   DateTime @default(now())
  @@index([complaintNo])
  @@map("complaint_entries")
}
```

- [ ] **Step 3: 迁移**：`npx prisma migrate dev --name wave5_complaints`（worktree 自己的 DB；禁 backfill）。
- [ ] **Step 4: reset 登记**：按 grep 到的波四三表登记形状把两表加进去；跑 `bash scripts/stack.sh reset self` 确认空库能建。
- [ ] **Step 5: 闸**：根 tsc 绿。
- [ ] **Step 6: Commit** `feat(甲波五T1): complaints/complaint_entries两表迁移+reset登记`

**本任务过清单**：改 schema（迁移新增、空库能建、无 backfill）。

### Task 2: 投诉主体服务（六态迁移表 + 双钟 + 审计十码）

**Files:**
- Create: `src/modules/governance/complaints/complaint.constants.ts`（状态/类别/结论枚举 + `COMPLAINT_TRANSITIONS` + 期限常量）
- Create: `src/modules/governance/complaints/complaints.service.ts` + `.spec.ts`、`complaint.constants.spec.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（新常量组 `COMPLAINT_AUDIT_ACTIONS`，照波四 `COMPLIANCE_OFFICE_AUDIT_ACTIONS` 形状注册进 `AuditActions` 与名册）

**Interfaces（Produces）:**
- 迁移表：

```ts
export const COMPLAINT_TRANSITIONS: Record<string, readonly string[]> = {
  RECEIVED: ['ACKNOWLEDGED'],
  ACKNOWLEDGED: ['INVESTIGATING'],
  INVESTIGATING: ['INVESTIGATING_EXTENDED', 'RESOLUTION_PENDING'],
  INVESTIGATING_EXTENDED: ['RESOLUTION_PENDING'],
  RESOLUTION_PENDING: ['RESOLVED', 'INVESTIGATING', 'INVESTIGATING_EXTENDED'],
  RESOLVED: [],
};
export const ACK_DEADLINE_DAYS = 7;        // MC III.A.1.a
export const RESOLVE_DEADLINE_DAYS = 28;   // MC III.A.1.b
export const EXTENDED_DEADLINE_DAYS = 56;  // MC III.A.1.b.ii
```

- `ComplaintsService`（单号 `generateReferenceNo('CMP')`；期限 = `new Date(submittedAt.getTime() + N*86400000)`，禁 Date mutator——act6 判例）：
  - `submit(customerNo: string, dto: { category; subject; description; relatedOrderNo? }): Promise<{ complaintNo: string }>`（审计 `COMPLAINT_SUBMITTED`，actor=customerNo）
  - `acknowledge(actor, complaintNo, dto: { message: string })`（→ACKNOWLEDGED；entry CLIENT/ACK；acknowledgedAt=now）
  - `startInvestigation(actor, complaintNo)`（→INVESTIGATING）
  - `addNote(actor, complaintNo, body: string)`（INTERNAL_NOTE；任意非终态可加）
  - `extend(actor, complaintNo, dto: { explanation: string })`（守卫 extendedAt 为空且状态=INVESTIGATING；→INVESTIGATING_EXTENDED；resolveDeadlineAt=submittedAt+56d；entry CLIENT/EXTENSION_NOTICE）
  - `proposeResolution(actor, complaintNo, dto: { outcome; resolutionText }, approvalNo: string)`（→RESOLUTION_PENDING；记 pendingApprovalNo；**不落 outcome/text 本表**——值住审批载荷，时序照 `ri-replacement` 三步先例）
  - `applyResolution(complaintNo, approvalNo, dto: { outcome; resolutionText })`（→RESOLVED；落 outcome/text/resolvedAt；entry CLIENT/FINAL_RESPONSE；清 pending）
  - `rejectResolution(complaintNo, approvalNo, decision: 'REJECTED' | 'CANCELLED' | 'EXPIRED')`（按 extendedAt 有无回 INVESTIGATING_EXTENDED / INVESTIGATING 两条显式边；清 pending）
  - `markEscalated(actor, complaintNo, incidentNo)`（守卫：状态 ∈ 两调查态且 escalatedIncidentNo 为空；不迁状态）
  - `simulateTimeout(actor, complaintNo, target: 'ACK' | 'RESOLVE')`（⚡ 拨对应 deadline 至 now−1h；终态 400）
  - 读面：`listForCustomer(customerNo)` / `getForCustomer(customerNo, complaintNo)`（entries 仅 CLIENT_MESSAGE；别人的号照 material-requests 惯例统一「查无」不回 403）/ `listAdmin()` / `getAdmin(complaintNo)`（entries 全量）
- 审计十码（domain GOVERNANCE，四属性出生冻结；展示级字段镜像 metadata——R5 判例）：`COMPLAINT_SUBMITTED` / `COMPLAINT_ACKNOWLEDGED` / `COMPLAINT_INVESTIGATION_STARTED` / `COMPLAINT_NOTE_ADDED` / `COMPLAINT_EXTENDED`（requiredFields `['newResolveDeadlineAt']`）/ `COMPLAINT_RESOLUTION_PROPOSED`（`['outcome']`）/ `COMPLAINT_RESOLUTION_APPLIED`（`['outcome']`）/ `COMPLAINT_RESOLUTION_REJECTED` / `COMPLAINT_ESCALATED`（`['escalatedIncidentNo']`）/ `COMPLAINT_DEADLINE_FASTFORWARDED`（`['target']`）。状态边码一律写 fromStatus/toStatus（判例）。

- [ ] **Step 1: constants 先测后写**：迁移表全边穷举 + 非法跃迁抽样（RECEIVED→RESOLUTION_PENDING、RESOLVED→任意）+ 期限常量三值断言引条款注释。
- [ ] **Step 2: service 先测后写**（照 `regulatory-filing.service.spec.ts` 行为化 mock 模式）。必测：submit 两钟算对（7d/28d）｜acknowledge 停确认钟+CLIENT/ACK 落 entry｜extend 一次性守卫（二次 400）+死线改 56d｜propose/apply/reject 三步与两条驳回边｜markEscalated 守卫三连（非调查态 400、已升级 400、RESOLVED 400）｜simulateTimeout 拨钟｜客户读面看不到 INTERNAL_NOTE、别人的号「查无」｜每动作审计码+requestId 显式。
- [ ] **Step 3: 闸**：根 tsc + `npx jest src/modules/governance/complaints --silent`；先破坏一条迁移断言验红再复绿。
- [ ] **Step 4: Commit** `feat(甲波五T2): 投诉主体——六态迁移表/双钟7-28-56/延期一次性/审计十码`

**本任务过清单**：持久状态变化写审计（显式 requestId）｜新审计码十枚四属性冻结｜新状态显式迁移表 + 计时已答（双钟即本主体 SLA，挂墙在 T5）｜对外业务键 CMP。

### Task 3: 裁决审批链 + 事件结案链 + resolution workflow

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`ApprovalActionTypes` +2 键、默认策略 +2、`INCIDENT_CLOSE_*` 数组:460-465 加 `INCIDENT_CLOSE_CUSTOMER`）
- Modify: `src/common/events/domain-events.constants.ts`（COMPLAINT_RESOLUTION decided 事件键，照 RI_REPLACEMENT 条目形状）
- Modify: `scripts/verify-rbac.ts`（`MAKER_GROUP_BY_POLICY` +2 行：`COMPLAINT_RESOLUTION`→`COMPLAINT_WRITE`、`INCIDENT_CLOSE_CUSTOMER`→`INCIDENT_OPS_WRITE`——**同一 commit**，清单第 6 行）
- Create: `src/modules/governance/complaints/complaint-resolution-workflow.service.ts` + `.spec.ts`（照 `src/modules/governance/compliance-office/ri-replacement-workflow.service.ts` 提单/onDecided 双面逐行仿写；**只编排零自己审计**）

**Interfaces:**
- Consumes: T2 `proposeResolution/applyResolution/rejectResolution` 签名。
- Produces:

```ts
[ApprovalActionTypes.COMPLAINT_RESOLUTION]: {
  steps: [{ stepNo: 1, roles: ['COMPLIANCE_OFFICER'] }], timeoutHours: 48, allowCancel: true,
},
[ApprovalActionTypes.INCIDENT_CLOSE_CUSTOMER]: {
  steps: [{ stepNo: 1, roles: ['COMPLIANCE_OFFICER'] }], timeoutHours: 48, allowCancel: true,
},
```

- `ComplaintResolutionWorkflowService.propose(actor, complaintNo, dto: { outcome; resolutionText })`（开审批携 objectSnapshot={complaintNo, outcome, resolutionText} → 调 T2 proposeResolution）；`onDecided(approvalNo, decision)`（APPROVED→applyResolution（dto 从载荷读）；REJECTED/CANCELLED/EXPIRED→rejectResolution）。

- [ ] **Step 1: 常量三处 + 事件键 + MAKER_GROUP_BY_POLICY 两行**先落（注释「波五：运营提、合规官批」/「客户族结案：运营提、合规官批」）。
- [ ] **Step 2: workflow 先测后写**：批准分发 apply（dto 来自载荷）、三种否定分发 reject、maker≠checker 由引擎保证只断言分发正确。
- [ ] **Step 3: 闸**：根 tsc + `npx jest src/modules/governance --silent`。
- [ ] **Step 4: Commit** `feat(甲波五T3): COMPLAINT_RESOLUTION+INCIDENT_CLOSE_CUSTOMER两链(合规官单步)+裁决workflow+MAKER_GROUP两行`

**本任务过清单**：maker-checker 走 ApprovalsService 正门｜新审批策略入 MAKER_GROUP_BY_POLICY｜新事件先登记 domain-events.constants.ts。

### Task 4: 升级联动（占位通电 + 门语义 + escalation workflow）

**Files:**
- Modify: `src/modules/governance/incidents/incident-type-registry.ts:113-119`（enabled:true；closeActionType→`INCIDENT_CLOSE_CUSTOMER`；requiredAnchors→`['complaintNo','ownerCustomerNo']`；label 去掉 placeholder 字样；establishedBy 保持 `Market Conduct III.A`）
- Modify: `src/modules/governance/incidents/incident-type-registry.spec.ts:44-46`（「停用抛 disabled」断言改写为「enabled:true 且 closeActionType=CUSTOMER」）
- Modify: `src/modules/governance/incidents/incident.service.ts`（register 的人工拒绝改为显式清单含 `COMPLAINT_ESCALATION`；新增 `registerFromComplaint(actor, dto: { complaintNo; ownerCustomerNo; title; description }): Promise<{ incidentNo }>` 走同一落库路径、审计复用既有登记码 metadata 带 complaintNo）
- Modify: `src/modules/governance/incidents/incident.service.spec.ts:138-141`（改断言：register 拒 + registerFromComplaint 通）
- Create: `src/modules/governance/complaints/complaint-escalation-workflow.service.ts` + `.spec.ts`（铁律③：只调 `IncidentService.registerFromComplaint` 与 `ComplaintsService.markEscalated`，零直写零自己审计）
- Create: `src/modules/governance/complaints/complaints.module.ts`（imports IncidentsModule / ApprovalsModule 等；`app.module.ts` 或 `governance.module.ts` 注册——照波四挂载惯例挂 governance）

**Interfaces:**
- Consumes: T2 `markEscalated`；incident 落库路径既有形状。
- Produces: `ComplaintEscalationWorkflowService.escalate(actor, complaintNo): Promise<{ incidentNo }>`（事件 title=`Complaint escalation — ${complaintNo}`，description 取投诉 subject）。

- [ ] **Step 1: registry 行与 spec 先改**：先跑 registry.spec 看旧断言红，再更新（穷举集合 12 行不变、CUSTOMER 链、anchors 断言）。
- [ ] **Step 2: register 门先测后写**：`/admin/incidents` 人工登记 `COMPLAINT_ESCALATION` 400（与 MANUAL 同清单）；`registerFromComplaint` 落库成功、anchors 齐、metadata 带 complaintNo。
- [ ] **Step 3: escalation workflow 先测后写**：escalate 后投诉 escalatedIncidentNo 回填、二次 escalate 400（T2 守卫）、事件已生成。
- [ ] **Step 4: 闸**：根 tsc + `npx jest src/modules/governance --silent`（incidents + complaints 两目录都在内）。
- [ ] **Step 5: Commit** `feat(甲波五T4): COMPLAINT_ESCALATION通电——手工登记仍拒/registerFromComplaint内部门/升级workflow编排`

**本任务过清单**：持久状态变化写审计（事件登记复用既有码）｜门不可绕（手工登记拒绝清单即演示门）｜各管各的（workflow 只调两侧服务方法）。

### Task 5: 控制器两面 + RBAC + 闹钟墙分支 + ⚡

**Files:**
- Create: `src/modules/governance/complaints/complaints.controller.ts`（admin 面）
- Create: `src/modules/governance/complaints/complaints.client.controller.ts`（`@Controller('client/me')` + `AuthGuard('jwt')` + ensureCustomer，逐行照 `material-requests.client.controller.ts` 形状）
- Create: `src/modules/governance/complaints/dto/complaint.dto.ts`（提交/动作 DTO，必填即可不加防御性格式校验）
- Modify: `src/modules/governance/compliance-office/compliance-clock-wall.service.ts` + `.spec.ts`（加 COMPLAINT 分支）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（四处：`PermissionGroup` +2；事件登记域桶块 +`COMPLAINT_READ`/`COMPLAINT_WRITE`；`route()` 新路由集；`RBAC_ROLE_GROUP_BINDINGS`——`COMPLAINT_WRITE` 绑 `INCIDENT_OPS_WRITE` 现持有职务（grep 绑定表照加），`COMPLAINT_READ` 绑合规官/MLRO/内审）

**Interfaces:**
- Consumes: T2/T3/T4 服务签名。
- Produces（路由 × 门；client 三条不进 catalog）:

```
GET  /admin/complaints                                  [COMPLAINT_READ, COMPLAINT_WRITE]
GET  /admin/complaints/:complaintNo                     [COMPLAINT_READ, COMPLAINT_WRITE]
POST /admin/complaints/:complaintNo/acknowledge         [COMPLAINT_WRITE]
POST /admin/complaints/:complaintNo/investigation       [COMPLAINT_WRITE]
POST /admin/complaints/:complaintNo/notes               [COMPLAINT_WRITE]
POST /admin/complaints/:complaintNo/extend              [COMPLAINT_WRITE]
POST /admin/complaints/:complaintNo/propose-resolution  [COMPLAINT_WRITE]
POST /admin/complaints/:complaintNo/escalate            [COMPLAINT_WRITE]
POST /admin/complaints/:complaintNo/simulate-timeout    [DEMO_CLOCK_WRITE]
POST /client/me/complaints ｜ GET /client/me/complaints ｜ GET /client/me/complaints/:complaintNo
```

- clock-wall COMPLAINT 行：`currentStatus != 'RESOLVED'` 的每张投诉一行——`kind:'COMPLAINT'`、refNo=complaintNo、title=subject、`deadlineAt = acknowledgedAt == null ? ackDeadlineAt : resolveDeadlineAt`、clockLabel（`'ACK (1w)'` / `'RESOLVE (4w/8w)'`）、overdue（**不复用他表列名**——骨架字段命名提醒在此落地）。

- [ ] **Step 1: clock-wall 分支先测后写**：未确认件走确认钟、已确认走裁决钟、RESOLVED 不上墙、overdue 红标位。
- [ ] **Step 2: 控制器两面**。admin actor 取法照 `regulatory-filings.controller.ts`；client 面「别人的号统一查无」照 material-requests 注释语义；propose-resolution 调 T3 workflow、escalate 调 T4 workflow（不直调 service——门在 workflow）。
- [ ] **Step 3: rbac.catalog 四处**；新端点必须 route() 登记（判例：只 seed 不重启 = 403）。
- [ ] **Step 4: 闸**：根 tsc + `npx jest src/modules/governance src/modules/identity/access-control --silent`。
- [ ] **Step 5: Commit** `feat(甲波五T5): 投诉两面控制器+COMPLAINT_READ/WRITE两桶+闹钟墙COMPLAINT双钟分支+⚡simulate-timeout`

**本任务过清单**：新权限组四处齐｜新 admin 端点 route() 登记｜对外业务键（路由参数 complaintNo）｜新字段到客户面的可见性已按 spec 裁定 6 执行。

### Task 6: verify:rbac 扩判据 + audit:vocab 入库

**Files:**
- Modify: `scripts/verify-rbac.ts`
- Modify: `doc-final/reference/`（audit:vocab 输出落点按脚本既有行为）

**Interfaces:** Consumes T3/T5 的组名/桶键/路由/策略。

- [ ] **Step 1: 静态判据**（照波四 S11 写法）：两桶四处齐；`COMPLAINT_WRITE` 唯运营职务持有、`COMPLAINT_READ` 恰为 {合规官, MLRO, 内审}；两条新审批策略在 `MAKER_GROUP_BY_POLICY`。
- [ ] **Step 2: 行为探针**（真端点 403/200，照既有形状）：运营 acknowledge 200 ｜ 合规官 acknowledge 403（写面不越界）｜ 金库 GET /admin/complaints 403 ｜ 合规官经审批中心批 COMPLAINT_RESOLUTION 200 ｜ 运营批同单 403（maker≠checker）｜ ⚡ simulate-timeout 金库 200、运营 403（门控交叉现象实证，演示话术素材）。
- [ ] **Step 3: 跑**：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self verify:rbac` 全绿；先注释一处绑定验红再复绿。既有红集与波前基线恒等口径（波四判例）。
- [ ] **Step 4: `bash scripts/on-stack.sh self audit:vocab`**：预期现役码 296；不符先对名册再动数字。
- [ ] **Step 5: Commit** `feat(甲波五T6): verify:rbac两桶判据+6行为探针;audit:vocab 286→296入库`

**本任务过清单**：新权限组四处齐的机器判据｜新端点 reset self 重启后再验。

### Task 7: 种子 + demo 数据文档 + 重铺闸

**Files:**
- Modify: `prisma/seed.business.ts`（投诉种子区块，单号 `buildDeterministicNo` 照既有种子写法保重铺幂等）
- Modify: `doc-final/demo/data.md`、`doc-final/demo/baseline.md`；`scripts/demo-data-md.ts` 若生成区涉新表照既有结构扩展

**Interfaces:** Consumes T1 模型（种子直写表照本仓惯例）。

- [ ] **Step 1: 种子人设先查 seed**（判例）选一位既有客户，三张投诉：① RECEIVED（submittedAt=now−1d，确认钟在跑）｜② INVESTIGATING（submittedAt=now−26d，裁决钟临近 4 周——⚡/延期演示起点）｜③ RESOLVED 全档（entries 三类 CLIENT_MESSAGE 齐 + 一条 INTERNAL_NOTE，三段留档完整可查）。时间相对当前时钟（照波四义务种子先例）。
- [ ] **Step 2: 重铺闸首验**：`bash scripts/stack.sh reset self` 全绿；data.md 生成区零 diff 或重生成后 commit（生成区 diff=脏库探针判例）。
- [ ] **Step 3: baseline.md 补两表断言行**（行数与关键行值）。
- [ ] **Step 4: Commit** `feat(甲波五T7): 种子三投诉(新到/临近死线/全档)+data.md·baseline.md同步+重铺闸首验`

**本任务过清单**：改种子同步 data.md（生成区不手改）｜改 schema 后重铺闸。

### Task 8: e2e 全链（真 AppModule 零 mock）

**Files:**
- Create: `test/complaints.e2e-spec.ts`（头部 polyfill/dotenv 照 `test/regulatory-filing.e2e-spec.ts:1-15` 逐字）

**Interfaces:** Consumes 全部服务真身。

- [ ] **Step 1: 用例四段**（服务直调分段照波二三惯例）：
  ① 主弧：submit → acknowledge → investigation → proposeResolution（经 workflow）→ 合规官经 `ApprovalsService` 批 → RESOLVED、三类 CLIENT_MESSAGE 齐、审计链逐码在（含 fromStatus/toStatus）、客户读面 entries 无 INTERNAL_NOTE。
  ② 延期分支 + 变异：extend 后死线=submittedAt+56d、EXTENSION_NOTICE 落 entry；二次 extend 400；RECEIVED 直接 propose 400；驳回回 INVESTIGATING_EXTENDED（延期过）与 INVESTIGATING（未延期）两边各验。
  ③ 升级线：⚡ simulateTimeout('RESOLVE') → clock-wall 行 overdue=true → escalate → 事件生成（type=COMPLAINT_ESCALATION、anchors 齐）→ 事件调查 → 结案经 `INCIDENT_CLOSE_CUSTOMER` 合规官批 → 事件关闭；投诉 escalatedIncidentNo 回填、二次升级 400；RESOLVED 后升级 400。
  ④ 门与归属：`/admin/incidents` 手工登记 COMPLAINT_ESCALATION 400；客户 A 查客户 B 的投诉「查无」。
- [ ] **Step 2: 跑**：`bash scripts/on-stack.sh self test:e2e -- --testPathPattern complaints` 全绿（实跑命令形式照 `checkups/2026-09-27-act-a-wave4-evidence/` 留档可抄）。
- [ ] **Step 3: 回归**：`incident` 族既有 e2e/单测 + 波四 `compliance-office.e2e-spec.ts` 复绿（动了共享 registry/审批常量/clock-wall）。
- [ ] **Step 4: Commit** `test(甲波五T8): complaints e2e四段全链+事故域·波四回归复绿`

**本任务过清单**：行为绿（真 AppModule 零 mock、integration 必经 on-stack）。

### Task 9: 前端四页（client-web 首触两页 + admin-web 两页）

**Files:**
- Create: `client-web/src/pages/Complaints.tsx`（列表 + 提交表单）、`client-web/src/pages/ComplaintDetail.tsx`（状态时间线 + 三类书面往来）；路由/导航注册 grep 既有页面（如 `Deposit.tsx`）挂载形状照加
- Create: `admin-web/src/pages/ComplaintListPage.tsx`、`ComplaintDetailPage.tsx`；`admin-web/src/App.tsx` lazy+Route 两条；侧边栏挂事件中心组；`PERMISSIONS` 常量 +2 键
- Modify: `admin-web/src/pages/ComplianceClockWallPage.tsx`（COMPLAINT 徽标 + 行点击跳投诉详情 + ⚡ 按钮挂 simulate-timeout，`useSimulationMode` 门控）

**Interfaces:** Consumes T5 路由集（返回形状以 controller DTO 为准）。

- [ ] **Step 1: 开工先读** `doc-final/rules/frontend-client.md` + `ui-contract/`（client-web 首触）。
- [ ] **Step 2: client 两页**：提交四字段；详情时间线用人话标签（判例：说人话不术语）；只渲染 CLIENT_MESSAGE；黑白双主题用既有 token（客户端主题判例：禁整值 var 色）；纯日期串禁 `new Date(字符串)` 反解析（判例）。
- [ ] **Step 3: admin 两页**：列表（单号/客户/类别/状态/双钟倒计时红标）；详情 = 基本信息 + 双钟卡 + 往来记录全量 + 动作按钮**七枚逐一落位**（Acknowledge / Start investigation / Add note / Extend / Propose resolution / Escalate / ⚡ Fast-forward——清单第 9 行：没有入口=功能不存在；可见性按**状态 × 持码**双维，波二判例）+ 升级事件号跳转 + 审计区惯例。UUID 不出现在任何列。全站英文文案。
- [ ] **Step 4: 闸⑤**：三 tsc + `npm run test:client`；起 self 栈 preview 渲染四页 + 截图（client 两页含黑/白双主题各一张），落盘 `doc-final/superpowers/checkups/2026-09-28-act-a-wave5-evidence/`（物证写明路径——判例）。
- [ ] **Step 5: Commit** `feat(甲波五T9): client投诉两页(双主题)+admin两页+闹钟墙COMPLAINT行⚡,权限键2枚,截图物证入档`

**本任务过清单**：新业务动作前端全有入口（含 ⚡）｜UUID 不暴露｜改前端必 preview 截图（永不豁免①）｜客户可见性按 spec 裁定 6 落地。

### Task 10: 文档收口 + 场景 23/24 实走 + 收尾闸 + 数量核对

**Files:**
- Create: `doc-final/modules/complaints.md`（现状篇 §0–§4 照 modules 模板；§4 演示脚本节）
- Modify: `doc-final/modules/incident-register 篇`（升级入边一句 + 类型表 COMPLAINT_ESCALATION 行启用）、`doc-final/modules/compliance-office.md`（闹钟墙 COMPLAINT 分支一句）
- Modify: `doc-final/modules/overview.md`（§4 计数 15 域 75 桶 83 组 + 投诉行；技术节点 Last Verified）
- Modify: `doc-final/demo/script.md`（场景 23/24 暂编，动作指令逐步可实走）、`doc-final/demo/data.md` 残行、`doc-final/CHANGELOG.md` 一行
- Modify: `doc-final/BACKLOG.md`（扫账：可销行销、新债登记）

**Steps:**

- [ ] **Step 1: 场景 23/24 写入 script.md 并预铺态全程实走**（判例：动作指令必须真点过）：23 = 客户提交→确认→调查→⚡拨至第 4 周→延期→裁决审批→客户端看三类书面；24 = ⚡拨过 8 周→墙红→升级→事件全弧→合规官批结案→双向跳转。**⚡ 步骤剧本内预写换号话术**（运营不持 `DEMO_CLOCK_WRITE`，T6 探针已实证 403——spec §6 承诺，不临场现编）。截图入 T9 物证目录。
- [ ] **Step 2: 收尾闸**：三 tsc + `npx jest src/modules/governance src/modules/identity --silent` + `bash scripts/on-stack.sh self demo:all`（⑥）+ `bash scripts/stack.sh reset self` 后复跑 ⑥（⑧，判据对照 baseline.md 全绿）。零账务，⑦ 不触发。
- [ ] **Step 3: 预期终态数量逐项核对**（Global Constraints 表），对不上就停找漏改位点。
- [ ] **Step 4: 对照 `rules/delivery-checklist.md` 逐条过 + 对照 spec 逐条问「这条承诺的代码在哪」**（spec 承诺无 diff 是终审必逮项）。
- [ ] **Step 5: Commit** `docs(甲波五T10): modules投诉新篇+overview计数75桶83组+场景23/24实走+收尾闸⑥⑧全绿`

**本任务过清单**：每轮收尾三件套（分层收口＋CHANGELOG＋BACKLOG）｜改页面/种子同步 demo 两文档。

### Task 11: 战役甲收官（总纲 §7 终闸）

**Files:**
- Modify: `doc-final/demo/script.md`（「异常与监管」幕定稿——**依赖业主拍板岔口 3**）
- Create: `doc-final/superpowers/checkups/2026-09-28-campaign-a-closeout-ledger.md`（§4 销账快照表）
- Modify: `doc-final/decisions.md`（三刀 + §2 覆盖判据 + 波五六条裁定摘记）
- Modify: `doc-final/CHANGELOG.md`、`doc-final/BACKLOG.md`（收官行）

**Steps:**

- [ ] **Step 0: 回主会话向业主拿岔口 3 定稿**（新幕 vs 并入既有幕；场景 19–24 终编）——拿到前本任务不动 script.md 编号。
- [ ] **Step 1: 四条主线剧本全程走查**（终闸 1，按 script.md 对应场景逐条实走 + 截图入 evidence 目录）：网安→72h 双钟→上报→回执→结案 ｜ 制裁→24h 冻结→CNMR→回执 ｜ 可疑→MLRO→STR→tipping-off ｜ 投诉→超时→升级事件（场景 24 即是）。
- [ ] **Step 2: §4 销账**（终闸 2）：36+5 逐条四态对照（波内/挂起/不建/移交）落快照表，roadmap 翻勾清单一并列出，**交业主确认后**才算销。
- [ ] **Step 3: decisions.md**（终闸 5）：三刀（投诉并入事件｜报送覆盖判据｜留痕不真发承袭）+ 波五裁定 1/3/4/5 摘记（升级=转事件、两级分工、显式延期、客户族结案链）。
- [ ] **Step 4: 悬挂项移交清单**：HRCA 官方名一手核 ｜ EOCN TFS 原文存档 ｜ 云 setup 装 TigerBeetle——逐项写明去向（BACKLOG/TOOLING-DEBT 行号），不静默丢失。
- [ ] **Step 5: 归档备忘 + 合并后必做**：spec/plan/骨架随合并入 `archive/` 惯例；总纲随末波归档（活文档条款）——本 task 只注明，合并时做。**业主本地合并 main 后三件套**（重启后端 + `npm run db:base:sync` + `bash scripts/stack.sh reset main`——权限字典/内存定义/schema+seed 均动过，清单第 8 行的合并侧半边）写进收官报告显要处；给同事看新版走 `npm run cloud:deploy`。
- [ ] **Step 6: Commit** `docs(甲波五T11): 战役甲收官——四主线走查+§4销账快照+三刀入decisions+幕次定稿`

**本任务过清单**：多波承接（末波变体：无下一波骨架，改为销账快照 + 归档备忘 + 悬挂项移交）｜每轮收尾三件套。

---

## 终审（主会话，Fable 不降档）

T11 后回主会话终审：逐 task 抽查复现命令、spec 六条裁定与全部承诺逐条对代码（「承诺无 diff」必逮项）、否定性结论（「不上墙」「查无」「手工登记拒」）抽查复现、数字复述 grep 清点（75/83/296/12 多处复述必漏改判例）、状态机与门语义按需变异测试。终审红项修完才进合并流程（`superpowers:finishing-a-development-branch`）。
