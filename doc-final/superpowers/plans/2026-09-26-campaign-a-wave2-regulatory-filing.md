# 战役甲波二「报送台骨架」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建「监管报送单」新主体（六态状态机 + 高管签发链 + 事件联动自动开单 + 超时软标），并把事故侧通报单槽收编干净（不许双轨）。

**Architecture:** 新模块 `src/modules/governance/regulatory-filings/`（照 `governance/incidents/` 同构：constants + type-registry + service + workflow + approval-handler + controller + module）；事故域只改三处（assess 走新 workflow、结案守卫改判、getView 加摘要）并退役单槽。前端两页 + 事故详情页通报区块换脸。

**Tech Stack:** NestJS + Prisma(SQLite) + TigerBeetle（本波零账务，不碰）+ React admin-web。

**Spec:** `doc-final/superpowers/specs/2026-09-26-campaign-a-wave2-regulatory-filing-spec.md`（执行者必读，本 plan 论证全部锚它；总纲 `2026-09-25-campaign-a-incident-regulatory-charter.md` §3 波二行）

## Global Constraints

- **项目总纲 §0–§5 要点随任务 prompt 下发**（演示系统/禁做清单/允许假设/三桶出口/六条铁律）——SDD 派发者负责贴。
- **随手闸每任务必跑**：`npx tsc --noEmit -p tsconfig.json`；改了 admin-web 再 `cd admin-web && npx tsc -b --noEmit && cd ..`；jest 只跑本任务相关目录、判据全绿。
- **worktree 隔离**：本波在 `.claude/worktrees/<名>/` 独立 worktree + 分支执行，栈用 self（`bash scripts/on-stack.sh self <script>`）。
- **业务键**：单号一律 `filingNo`（`FIL` 前缀），前端零 UUID（铁律⑥）。
- **留痕不真发**：「已提交」永远是人工标记 + `externalRef` 必填，无任何真实发送通道。
- **零账务**：本波不碰 TigerBeetle / 资金单 / 分录（收尾闸⑦不触发）。
- **受控枚举不许静默降级**（波一 Ruling-14 教训）：authority / ccAuthorities / entry kind 全下拉受控，spec 写枚举就实现枚举。
- **派发档位**：任务执行与任务级 review 走执行档；终审、变异测试不降档（模型映射见项目总纲附录 A，派发省略 model 字段走继承的坑照旧）。
- 迁移文件照常新增保证空库能建起，**不写 backfill**；收尾重铺闸⑧兜底。

---

### Task 1: 常量层 + 类型注册表 + 依据码 authority 回填

**Files:**
- Create: `src/modules/governance/regulatory-filings/regulatory-filing.constants.ts`
- Create: `src/modules/governance/regulatory-filings/filing-type-registry.ts`
- Create: `src/modules/governance/regulatory-filings/filing-type-registry.spec.ts`
- Modify: `src/modules/governance/incidents/incident.constants.ts:109-117`（`INCIDENT_REPORT_BASES` 七条补 `authority`）

**Interfaces (Produces):**
- `FilingStatus`/`FILING_TRANSITIONS`/`FilingDirections`/`FilingEntryKinds`/`RegulatoryAuthorities`/`REGULATORY_AUTHORITY_LABELS` 常量
- `OpenFilingDto { type; authority?; ccAuthorities?; incidentNo?; basisCode?; title?; receivedAt? }`、`FilingEntryDto { kind; body; externalRef? }`、`MarkFilingSubmittedDto { externalRef }` 接口
- `FILING_TYPE_REGISTRY: Record<string, FilingTypeConfig>` 五行 + `getFilingTypeConfig(type)`（未知/disabled 抛 `BadRequestException`，照 `getIncidentTypeConfig` 同款）
- `INCIDENT_REPORT_BASES` 每条新增 `authority: string` 字段

- [ ] **Step 1: 写红测** `filing-type-registry.spec.ts`：①注册表恰好 5 键且全 enabled ②`INCIDENT_REPORT` 是唯一 `requiresIncident=true` ③`REG_INFO_REQUEST_RESPONSE` 是唯一 INBOUND 且 `defaultHours===48` ④`getFilingTypeConfig('NOPE')` 抛 BadRequest ⑤`FILING_TRANSITIONS` 六态、`CLOSED`/`CANCELLED` 出边为空数组 ⑥`INCIDENT_REPORT_BASES` 七条每条 `authority` ∈ `RegulatoryAuthorities` 键集，且 `PDPL_ART_9.authority==='UAE_DATA_OFFICE'`、其余六条为 `'VARA'`。
- [ ] **Step 2: 跑红** `npx jest src/modules/governance/regulatory-filings --colors`，期望 module not found。
- [ ] **Step 3: 实现常量文件**（防环：registry 不 import constants，照 incident 两文件分工先例；DTO 接口放 constants）：

```ts
// regulatory-filing.constants.ts（头注释照 incident.constants.ts 风格：只放常量与纯类型）
export const FilingStatus = {
  DRAFT: 'DRAFT', PENDING_SIGNOFF: 'PENDING_SIGNOFF', SIGNED_OFF: 'SIGNED_OFF',
  SUBMITTED: 'SUBMITTED', CLOSED: 'CLOSED', CANCELLED: 'CANCELLED',
} as const;
/** spec §3 六态六边；终态零出边。 */
export const FILING_TRANSITIONS: Record<string, readonly string[]> = {
  [FilingStatus.DRAFT]: [FilingStatus.PENDING_SIGNOFF, FilingStatus.CANCELLED],
  [FilingStatus.PENDING_SIGNOFF]: [FilingStatus.SIGNED_OFF, FilingStatus.DRAFT],
  [FilingStatus.SIGNED_OFF]: [FilingStatus.SUBMITTED],
  [FilingStatus.SUBMITTED]: [FilingStatus.CLOSED],
  [FilingStatus.CLOSED]: [], [FilingStatus.CANCELLED]: [],
};
export const FilingDirections = { OUTBOUND: 'OUTBOUND', INBOUND: 'INBOUND' } as const;
export const FilingEntryKinds = { RECEIPT_ACK: 'RECEIPT_ACK', REGULATOR_INQUIRY: 'REGULATOR_INQUIRY', OUR_SUPPLEMENT: 'OUR_SUPPLEMENT' } as const;
export const RegulatoryAuthorities = { VARA: 'VARA', UAE_FIU: 'UAE_FIU', EOCN: 'EOCN', UAE_DATA_OFFICE: 'UAE_DATA_OFFICE', CBUAE: 'CBUAE' } as const;
export const REGULATORY_AUTHORITY_LABELS: Record<string, string> = {
  VARA: 'VARA (Dubai Virtual Assets Regulatory Authority)', UAE_FIU: 'UAE Financial Intelligence Unit',
  EOCN: 'Executive Office for Control & Non-Proliferation', UAE_DATA_OFFICE: 'UAE Data Office',
  CBUAE: 'Central Bank of the UAE',
};
export interface OpenFilingDto { type: string; authority?: string; ccAuthorities?: string[]; incidentNo?: string; basisCode?: string; title?: string; receivedAt?: string; }
export interface FilingEntryDto { kind: string; body: string; externalRef?: string; }
export interface MarkFilingSubmittedDto { externalRef: string; }
```

```ts
// filing-type-registry.ts（establishedBy 注记级、不杜撰条款号——spec §2 原话照抄）
import { BadRequestException } from '@nestjs/common';
export interface FilingTypeConfig {
  direction: 'OUTBOUND' | 'INBOUND'; label: string; establishedBy: string;
  defaultAuthority: string | null; defaultCcAuthorities: readonly string[];
  defaultHours: number | null; requiresIncident: boolean; enabled: boolean;
}
export const FILING_TYPE_REGISTRY: Record<string, FilingTypeConfig> = {
  INCIDENT_REPORT: { direction: 'OUTBOUND', label: 'Incident report to regulator', establishedBy: 'Per basis code (INCIDENT_REPORT_BASES)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: null, requiresIncident: true, enabled: true },
  REG_INFO_REQUEST_RESPONSE: { direction: 'INBOUND', label: 'Regulator information request — response', establishedBy: 'Regulator information request (48h response duty)', defaultAuthority: null, defaultCcAuthorities: [], defaultHours: 48, requiresIncident: false, enabled: true },
  MATERIAL_CHANGE_NOTIFICATION: { direction: 'OUTBOUND', label: 'Material change notification', establishedBy: 'Company Rulebook — material change notification', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true },
  AUDITOR_APPOINTMENT_NOTICE: { direction: 'OUTBOUND', label: 'External auditor appointment notice', establishedBy: 'Company Rulebook — auditor appointment notice', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true },
  MARKET_OFFENCE_DUAL_REPORT: { direction: 'OUTBOUND', label: 'Market offence dual-headed report', establishedBy: 'Market Conduct Rulebook — dual-headed reporting', defaultAuthority: 'VARA', defaultCcAuthorities: [], defaultHours: null, requiresIncident: false, enabled: true },
};
export function getFilingTypeConfig(type: string): FilingTypeConfig {
  const c = FILING_TYPE_REGISTRY[type];
  if (!c) throw new BadRequestException(`Unknown filing type: ${type}`);
  if (!c.enabled) throw new BadRequestException(`Filing type ${type} is disabled (reserved for a later wave)`);
  return c;
}
```

`incident.constants.ts`：`INCIDENT_REPORT_BASES` 的类型签名加 `authority: string`，七条逐一补值（`PDPL_ART_9` → `'UAE_DATA_OFFICE'`，其余六条 → `'VARA'`），label 一字不动。
- [ ] **Step 4: 跑绿**（同 Step 2 命令）+ `npx jest src/modules/governance/incidents --colors` 确认存量不红。
- [ ] **Step 5: 随手闸 ①，commit** `feat(甲波二T1): 报送常量六态六边·类型注册表五行·依据码目录补authority`

---

### Task 2: schema 两表 + 迁移

**Files:**
- Modify: `prisma/schema.prisma`（`IncidentRemediation` 之后、`ReconciliationRunWallet` 之前插两个 model；**本任务不动 Incident 六列**，那是 Task 6 的迁移）
- 迁移目录：`prisma/migrations/<timestamp>_filing_wave2_tables/`

**Interfaces (Produces):** `prisma.regulatoryFiling` / `prisma.regulatoryFilingEntry` 两 delegate，字段如下（后续任务按此拼写引用）。

- [ ] **Step 1: schema 追加**（`approvalNo`/`createdByUserId`/`traceId`/`cancelledReason` 四列是照 `Incident` 先例的实现配套：签发审批单号、开单人、审计旅程、作废原因）：

```prisma
// 战役甲波二（2026-09-26）：监管报送单——事故通报单槽收编后的权威记录（spec §1）。
model RegulatoryFiling {
  id                String    @id @default(uuid())
  filingNo          String    @unique
  direction         String    // OUTBOUND | INBOUND（由类型行决定）
  type              String    // FILING_TYPE_REGISTRY 键
  authority         String    // RegulatoryAuthorities 键
  ccAuthorities     String?   // 逗号分隔机构键（照 reportBasisCodes 轻量存储先例）
  basisCode         String?   // 单码=一项通报义务，仅 INCIDENT_REPORT 有值
  incidentNo        String?   // 一事故多单（双钟即两单）
  title             String
  body              String?   // 报文正文草稿；SUBMITTED 后即已提交内容快照
  receivedAt        DateTime? // INBOUND 来函收到时刻，48h 钟锚它
  deadlineAt        DateTime? // null=无钟/即时义务/钟链未落定（spec §1）
  externalRef       String?   // 对外编号，标已提交必填
  submittedAt       DateTime?
  submittedByUserId String?
  overdueMarkedAt   DateTime? // 超时持久软标（spec §8）
  status            String    @default("DRAFT")
  approvalNo        String?   // 签发审批单
  closedAt          DateTime?
  cancelledReason   String?
  createdByUserId   String
  traceId           String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  entries RegulatoryFilingEntry[]
  @@index([incidentNo])
  @@index([status])
  @@map("regulatory_filings")
}

model RegulatoryFilingEntry {
  id               String   @id @default(uuid())
  filingId         String
  kind             String   // RECEIPT_ACK | REGULATOR_INQUIRY | OUR_SUPPLEMENT
  body             String
  externalRef      String?
  recordedByUserId String
  createdAt        DateTime @default(now())
  filing RegulatoryFiling @relation(fields: [filingId], references: [id])
  @@index([filingId])
  @@map("regulatory_filing_entries")
}
```

- [ ] **Step 2:** `npx prisma migrate dev --name filing_wave2_tables` + `npx prisma generate`（首启撞旧 client 判例：generate 必跑）。
- [ ] **Step 3: 验证** `npx tsc --noEmit -p tsconfig.json` 绿；`sqlite3 /tmp/exchange_js_wt_<名>/dev.db ".tables" | grep regulatory` 见两表（worktree 库；没起过栈就先 `bash scripts/stack.sh reset self`）。
- [ ] **Step 4: commit** `feat(甲波二T2): regulatory_filings两表迁移`

---

### Task 3: 审计名册 + RegulatoryFilingService

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`AuditEntityTypes` +1、`AuditBusinessWorkflowTypes` +1、`AuditActions` +10 键、新 `REG_FILING_AUDIT_ACTIONS`）
- Modify: `src/modules/audit-logging/audit-logs.service.ts:829-837`（spec 解析链 `INCIDENT_AUDIT_ACTIONS[...] ??` 之后插 `REG_FILING_AUDIT_ACTIONS[input.action] ??`，import 同步）
- Create: `src/modules/governance/regulatory-filings/regulatory-filing.service.ts`
- Create: `src/modules/governance/regulatory-filings/regulatory-filing.service.spec.ts`

**Interfaces (Produces):**
```ts
class RegulatoryFilingService {
  openForIncident(incident: { incidentNo: string; type: string; title: string; createdAt: Date; customerNo?: string | null; traceId: string }, basisCodes: string[], actor: ApprovalActorContext): Promise<{ filingNos: string[] }>;
  openManual(dto: OpenFilingDto, actor: ApprovalActorContext): Promise<{ filingNo: string }>;
  saveDraft(filingNo: string, body: string, actor: ApprovalActorContext): Promise<{ filingNo: string }>;
  markSignoffRequested(filingNo: string, approvalNo: string, actor: ApprovalActorContext): Promise<void>;       // DRAFT→PENDING_SIGNOFF
  applySignoffDecision(filingNo: string, decision: 'APPROVED'|'DECLINED'|'CANCELLED'|'EXPIRED', event: { approvalNo: string; approvalId: string; decisionReason?: string | null }): Promise<void>; // →SIGNED_OFF / →DRAFT
  markSubmitted(filingNo: string, dto: MarkFilingSubmittedDto, actor: ApprovalActorContext): Promise<{ filingNo: string; chainDeadlineSetFor: string[] }>;
  addEntry(filingNo: string, dto: FilingEntryDto, actor: ApprovalActorContext): Promise<{ filingNo: string }>;
  close(filingNo: string, actor: ApprovalActorContext, note?: string): Promise<{ filingNo: string }>;
  cancel(filingNo: string, reason: string, actor: ApprovalActorContext): Promise<{ filingNo: string }>;
  list(q: { status?: string; type?: string; incidentNo?: string }): Promise<...投影数组>;
  getView(filingNo: string): Promise<...detail 投影（含 entries，零 UUID 对外）>;
  findByNo(filingNo: string): Promise<RegulatoryFiling>;   // 找不到 NotFound
  summaryForIncident(incidentNo: string): Promise<Array<{ filingNo; status; authority; basisCode; deadlineAt; overdueMarkedAt; submittedAt }>>;
}
```

- [ ] **Step 1: 审计名册注册**（先于服务，服务红测要用码）：

```ts
// AuditEntityTypes 尾部： REGULATORY_FILING: 'REGULATORY_FILING',
// AuditBusinessWorkflowTypes 尾部： REGULATORY_FILING: 'REGULATORY_FILING',
// AuditActions 里 INCIDENT_* 键组之后加 FILING_OPENED …… FILING_CANCELLED 十键（与下表同名）。
/** 战役甲波二（spec §7）：报送台十码。OPENED 铸旅程（S）；签发三码走审批旅程（I，
 * SIGNED_OFF/SIGNOFF_REJECTED 由审批裁决驱动带因果）；其余直接单步操作照事故先例老实标 N。 */
export const REG_FILING_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  FILING_OPENED:            { domain: 'GOVERNANCE', correlationMode: S, requiredFields: ['type'], requiresCausation: false },
  FILING_DRAFT_SAVED:       { domain: 'GOVERNANCE', correlationMode: N, requiredFields: [], requiresCausation: false },
  FILING_SIGNOFF_REQUESTED: { domain: 'GOVERNANCE', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: false },
  FILING_SIGNED_OFF:        { domain: 'GOVERNANCE', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: true },
  FILING_SIGNOFF_REJECTED:  { domain: 'GOVERNANCE', correlationMode: I, requiredFields: ['approvalNo', 'reason'], requiresCausation: true },
  FILING_SUBMITTED:         { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['externalRef'], requiresCausation: false },
  FILING_ENTRY_LOGGED:      { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['kind'], requiresCausation: false },
  FILING_OVERDUE_MARKED:    { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['deadlineAt'], requiresCausation: false },
  // ↑ 评审白2 收口：spec §7「带 approvalNo / 带 deadlineAt」落成 requiredFields（extra 顶层展开可过闸），终审逐条追承诺时口径一致。
  FILING_CLOSED:            { domain: 'GOVERNANCE', correlationMode: N, requiredFields: [], requiresCausation: false },
  FILING_CANCELLED:         { domain: 'GOVERNANCE', correlationMode: N, requiredFields: ['reason'], requiresCausation: false },
};
```

- [ ] **Step 2: 写红测** `regulatory-filing.service.spec.ts`（Test.createTestingModule + 真 PrismaService，mock AuditLogsService 为行为化 spy——记录 action 序列，照 incident.service.spec.ts 的 mock 口径）：①`openForIncident` 两码开两单，`TIR_K_H` 单 deadline=createdAt+72h、`TIR_II_C_24H` 单 deadline=null ②`openManual` INBOUND 类型 deadline=receivedAt+48h、authority 必须给且 ∈ 目录 ③`openManual('INCIDENT_REPORT')` 缺 incidentNo/basisCode 拒、basisCode 不在该事故类型 `reportBasisCandidates` 拒——**校验全在 service 内**（评审黄4 修正：手工开单是 controller 直调 service、不经 workflow，校验没有别处可放）：横向只读 `prisma.incident` 拿 type（铁律③读放行；找不到事故 → NotFound），查 `INCIDENT_TYPE_REGISTRY[type].reportBasisCandidates`（跨 import incidents 的纯常量文件，无模块环）④`saveDraft` 首次记 `FILING_DRAFT_SAVED`、再存不重记 ⑤非法跃迁显式拒（DRAFT 直接 markSubmitted → BadRequest 报 `Invalid filing transition`）⑥`markSubmitted` 缺 externalRef 拒；成功后**同事故钟链单** deadline 落定为 submittedAt+24h 且返回 `chainDeadlineSetFor` ⑦`addEntry` 非 SUBMITTED 拒、kind 越枚举拒 ⑧`cancel` 仅 DRAFT ⑨`close` 仅 SUBMITTED。
- [ ] **Step 3: 跑红。**
- [ ] **Step 4: 实现 service**。要点（模板：`incident.service.ts` 的 transition/recordAudit 形状）：
  - `generateReferenceNo('FIL')` 出单号（`src/common/utils/no-generator.util.ts`）；`traceId = randomUUID()`（OPENED 铸旅程）。
  - 私有 `transition(row, to)` 查 `FILING_TRANSITIONS`，非法抛 `Invalid filing transition ${from} → ${to}`。
  - 私有 `computeDeadline(cfg, basisCode, anchors)`：INCIDENT_REPORT → 查 `INCIDENT_REPORT_BASES[basisCode]`，`chainStart==='NOTICE'` 或 `hours==null` → null，否则 `incidentCreatedAt + hours*3600e3`；其余类型 `defaultHours!=null` → `(receivedAt ?? now) + hours`；否则 null。
  - `openForIncident`：逐码建行（direction OUTBOUND、authority=码的 `authority`、title=`${typeLabel} — ${incidentNo}`、createdByUserId=actor）＋逐单 `FILING_OPENED` 审计（metadata: `{ source: 'INCIDENT_ASSESSMENT', incidentNo, basisCode, authority, deadlineAt }`，subjects 带 INCIDENT RELATED + CUSTOMER OWNER（有值时），extra `{ type: 'INCIDENT_REPORT' }`）。
  - `markSubmitted`：transition SIGNED_OFF→SUBMITTED、落 submittedAt/ByUserId/externalRef；然后查同 `incidentNo` 下 `deadlineAt=null && submittedAt=null && basisCode!=null` 的兄弟单，命中 `chainStart==='NOTICE' && hours!=null` 的逐单落 `deadlineAt = submittedAt + hours`；`FILING_SUBMITTED` 审计 extra `{ externalRef }`、metadata 带 `chainDeadlineSetFor`。
  - `applySignoffDecision`：APPROVED → SIGNED_OFF + `FILING_SIGNED_OFF`（extra `{ approvalNo }`、causationId=approvalId、`recordSystem`——审批异步驱动无 actor，照 sweep 的 recordSystem 先例）；DECLINED/CANCELLED/EXPIRED → DRAFT + `FILING_SIGNOFF_REJECTED`（extra `{ approvalNo, reason: decisionReason ?? decision }`）。
  - 审计 helper 照 `incident-close-workflow.service.ts` 的 `closeAudit` 形状：`actionDomain:'GOVERNANCE'`、workflowType `REGULATORY_FILING`、primarySubject `REGULATORY_FILING`/filingNo、`correlationId: row.traceId`、requestId `${action}_${filingNo}_${randomUUID()}`、有 actor 用 `recordByActor`，无 actor `recordSystem`。
  - 投影零 UUID：list/getView 只出 filingNo/incidentNo 等业务键；entries 投影不带 id。
- [ ] **Step 5: 跑绿** + `npx jest src/modules/audit-logging --colors` 存量不红。
- [ ] **Step 6: 随手闸①，commit** `feat(甲波二T3): 报送十码名册+FIL主体服务(开单/钟链/六态迁移/审计)`

---

### Task 4: 签发审批链（常量 + handler + workflow）

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（三处：`ApprovalActionTypes` 键、`DEFAULT_APPROVAL_POLICIES` 条目、文件尾 `V1_APPROVAL_ACTION_TYPES` 数组追加）
- Create: `src/modules/governance/regulatory-filings/regulatory-filing-approval.service.ts`
- Create: `src/modules/governance/regulatory-filings/regulatory-filing-workflow.service.ts`
- Create: `src/modules/governance/regulatory-filings/regulatory-filing-workflow.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 的 `markSignoffRequested`/`applySignoffDecision`/`findByNo`。
- Produces: `RegulatoryFilingWorkflowService.submitForSignoff(filingNo, actor): Promise<{ filingNo; approvalNo }>`；二级事件名 `workflow.regulatory-filing.decided`（`ApprovalHandlerBase.buildSecondaryEventName` 对 `REGULATORY_FILING` 的 kebab 结果）。

- [ ] **Step 1: 常量三处**：

```ts
// ApprovalActionTypes（INCIDENT_CLOSE_PRUDENTIAL 之后）：
// 战役甲波二（2026-09-26）：报送签发——合规官提、高管单步批（spec §4）
REG_FILING_SUBMIT: 'REG_FILING_SUBMIT',
// DEFAULT_APPROVAL_POLICIES（INCIDENT_CLOSE_PRUDENTIAL 条目之后）：
[ApprovalActionTypes.REG_FILING_SUBMIT]: {
  steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true,
},
// V1_APPROVAL_ACTION_TYPES 数组尾（INCIDENT_CLOSE_PRUDENTIAL 之后）：
ApprovalActionTypes.REG_FILING_SUBMIT,
```

- [ ] **Step 2: handler**（逐字照抄 `incident-approval.service.ts` 的类形状，一个类）：`RegFilingSubmitApprovalService extends ApprovalHandlerBase`，`actionType = REG_FILING_SUBMIT`，`workflowType = AuditBusinessWorkflowTypes.REGULATORY_FILING`。
- [ ] **Step 3: 写红测** workflow spec（mock ApprovalsService.createAndSubmit 返回 `{ approvalNo }`、mock filing service）：①DRAFT 且 body 非空 → createAndSubmit 收到 actionType/entityRef/objectSnapshot（快照零 UUID：filingNo/type/direction/authority/ccAuthorities/basisCode/incidentNo/deadlineAt/title/impact 人话串）且 `markSignoffRequested` 被调 ②body 空 → BadRequest 且不触审批 ③非 DRAFT → BadRequest ④`onDecided` APPROVED → `applySignoffDecision('APPROVED',…)`；DECLINED → 同法转发。
- [ ] **Step 4: 跑红 → 实现**。`submitForSignoff` 模板照 `incident-close-workflow.service.ts` 的 `requestClose`（守卫→createAndSubmit→回写→审计由 service 侧 `markSignoffRequested` 记 `FILING_SIGNOFF_REQUESTED`）；`onDecided` 用 `@OnEvent('workflow.regulatory-filing.decided', { async: true })`，四种 decision 全转发给 `applySignoffDecision`（区别于事故 close 只吃 APPROVED——报送被驳回要回草拟，spec §3）。impact 串一句人话：`Submitting ${typeLabel} to ${authority}${incidentNo ? ` for incident ${incidentNo}` : ''}${deadlineAt ? `, statutory deadline ${iso}` : ''}`。
- [ ] **Step 5: 跑绿 + 随手闸①，commit** `feat(甲波二T4): REG_FILING_SUBMIT高管单步链+签发workflow`

---

### Task 5: controller + module 接线 + RBAC 登记 + 探针

**Files:**
- Create: `src/modules/governance/regulatory-filings/dto/regulatory-filing.dto.ts`（class-validator BodyDto：`OpenFilingBodyDto`/`SaveFilingDraftDto { body }`/`MarkFilingSubmittedBodyDto`/`FilingEntryBodyDto`/`CancelFilingDto { reason }`/`CloseFilingDto { note? }`/`FilingListQueryDto`，照 `dto/incident.dto.ts` 风格）
- Create: `src/modules/governance/regulatory-filings/regulatory-filings.controller.ts`
- Create: `src/modules/governance/regulatory-filings/regulatory-filings.module.ts`
- Modify: `src/modules/governance/governance.module.ts`（imports/exports 加 `RegulatoryFilingsModule`）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts` 四处
- Modify: `scripts/verify-rbac.ts`（探针 + 矩阵头条 + **`MAKER_GROUP_BY_POLICY` 表加一行**——评审黄3：头注释明写新增 maker-checker 策略必须登记，漏加则 S8「策略全集=表∪豁免」断言红，verify:rbac 全绿不可达）
- Modify: `scripts/verify-rbac.tables.ts`（`DETAIL_READ_GROUP_BY_POLICY` 加一行，S9 用）
- Modify: `admin-web/src/pages/approvalEntityRoutes.ts` + `admin-web/src/pages/ApprovalPoliciesPage.tsx`（评审黄3：审批类型登记点**共四处**，且 `approvalEntityRoutes.spec.ts` 断言前端路由表与 `verify-rbac.tables.ts` 两表键集相等——四处必须同任务落，不能拆给 T9）

**Interfaces (Produces):** 9 条 HTTP 路由（spec §6 清单原文），路径拼写全仓唯一真源在 rbac.catalog 的 route() 行。

- [ ] **Step 1: controller**——模板逐处照抄 `incidents.controller.ts`（`buildActor`/`assertAdmin`/`@RequirePermissions(buildPermissionCode(...))` 三件套），9 端点映射：`POST /admin/regulatory-filings`→workflow 不经、直调 `service.openManual`；`/:filingNo/draft`→`saveDraft`；`/:filingNo/signoff`→`workflow.submitForSignoff`；`/:filingNo/mark-submitted`→`markSubmitted`；`/:filingNo/entries`→`addEntry`；`/:filingNo/close`→`close`；`/:filingNo/cancel`→`cancel`；`GET` 两条→`list`/`getView`。module 照 `incidents.module.ts`（imports: PrismaModule/AuditLogsModule/ApprovalsModule；providers: service+workflow+handler；exports: service）。
- [ ] **Step 2: rbac.catalog 四处**：①`PermissionGroup` 联合类型尾加 `| 'REG_FILING_READ' | 'REG_FILING_WRITE'` ②incidents 路由区块后加 9 条 route()（GET 两条 groups `['REG_FILING_READ','REG_FILING_WRITE']`，POST 七条 `['REG_FILING_WRITE']`，spec §6 逐字）③`ACTION_BUCKET_CATALOG` 的 Incident Register 域块后插新域：

```ts
// ─── Domain: Regulatory Filings ──────────────────────
// 战役甲波二：报送台——单经办组（合规官），view 桶照 Ruling-13 只挂单组；
// 不设 cap.* 标记码（Ruling-6 是多组共享路由码时的解法，本域 POST 码只挂一组，路由门即精确门）。
{
  id: 'filings', label: 'Regulatory Filings', icon: '📨',
  buckets: [
    { key: 'filings.view', label: 'View regulatory filings', description: 'Browse the regulatory filing desk and correspondence trail', groups: ['REG_FILING_READ'] },
    { key: 'filings.desk', label: 'Operate the regulatory filing desk', description: 'Open filings, draft, submit for sign-off, mark submitted, log correspondence, close — the compliance desk', groups: ['REG_FILING_WRITE'] },
  ],
},
```

④`RBAC_ROLE_GROUP_BINDINGS`：`COMPLIANCE_OFFICER` 加 `'REG_FILING_WRITE', 'INCIDENT_READ'`（后者带注释：起草事故通报要读得到事故，spec §6）；`SENIOR_MANAGEMENT_OFFICER`、`INTERNAL_AUDITOR` 各加 `'REG_FILING_READ'`。
- [ ] **Step 3: 审批类型四处登记**（评审黄3，同任务落齐）：`scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 加 `REG_FILING_SUBMIT: 'REG_FILING_WRITE'`；`scripts/verify-rbac.tables.ts` 的 `DETAIL_READ_GROUP_BY_POLICY` 加 `REG_FILING_SUBMIT: 'REG_FILING_READ'`；`approvalEntityRoutes.ts` 加 ``REG_FILING_SUBMIT: (r) => `/admin/governance/regulatory-filings/${r}` ``；`ApprovalPoliciesPage.tsx` 标签表加 `REG_FILING_SUBMIT: 'Regulatory Filing · Sign-off'`。落完跑根 jest 的 `approvalEntityRoutes` 相关 spec（纯 .spec.ts 被根 jest 实跑判例）确认两表键集相等。
- [ ] **Step 4: verify:rbac 探针**（照 T9 事故探针形状，`scripts/verify-rbac.ts` 事故区块后加）：①正向：`compliance`（合规官种子号）`POST /admin/regulatory-filings` body `{ type: 'MATERIAL_CHANGE_NOTIFICATION', title: 'RBAC probe — material change filing' }` expect ALLOW，`cleanup` 用同 token `POST /:filingNo/cancel { reason: 'probe cleanup' }`（DRAFT→CANCELLED 收脚印，照 M4 修复先例）②反向：`ops`、`treasury`、`tech_admin` **三条**（评审白1 对齐 spec 点名的三角色）同 body expect DENY ③矩阵头条句子补「报送台经办唯合规官、签发唯高管」。
- [ ] **Step 5: 起栈实证**：`bash scripts/stack.sh up`（self）→ `npm run db:base:sync` → 重启后端 →（只 seed 不重启=403 判例）→ `npx ts-node -r tsconfig-paths/register scripts/verify-rbac.ts` 全绿。
- [ ] **Step 6: 随手闸①③ + jest 本目录，commit** `feat(甲波二T5): 报送controller九路由+RBAC新域两桶两组+审批类型四处登记+探针`

---

### Task 6: 事件联动 + 事故侧收编（本波最大任务）

**Files:**
- Create: `src/modules/governance/incidents/incident-assessment-workflow.service.ts`
- Modify: `src/modules/governance/incidents/incident.service.ts`（assess 剥离钟与开单、删 `saveReportDraft`/`markReported`/`computeReportDeadline`、getView 加 filings 摘要）
- Modify: `src/modules/governance/incidents/incidents.controller.ts`（assess 改调 workflow；删两端点、两 DTO import）
- Modify: `src/modules/governance/incidents/dto/incident.dto.ts`（删 `SaveReportDraftDto`/`MarkReportedBodyDto`）＋ `incident.constants.ts`（删 `MarkReportedDto`）
- Modify: `src/modules/governance/incidents/incident-close-workflow.service.ts:97-99`（结案守卫改判）＋ `:124`（快照 reported 取值）
- Modify: `src/modules/governance/incidents/incidents.module.ts`（imports 加 `RegulatoryFilingsModule`、providers 加 assessment workflow）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（删 `regulator-report` 两条 route()——**退役权限码必查 bindings**：两码只经五族写组的组内码集引用，摘 route 行即摘净，跑 `db:base:sync` 自清）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`INCIDENT_AUDIT_ACTIONS` 删两码、`AuditActions` 删两键，11→9）
- Modify: `prisma/schema.prisma`（Incident 删 `reportDeadlineAt`/`reportDraft`/`reportDraftedAt`/`reportedAt`/`reportedByUserId`/`reportReference` 六列；保留 `reportRequired`/`reportBasisCodes`）＋迁移 `incident_wave2_drop_report_slot`
- Modify: `test/incident-register.e2e-spec.ts` 用例④ + 相关直调处、`src/modules/governance/incidents/incident.service.spec.ts`、`incidents.controller.spec.ts`
- Modify: `src/modules/governance/incidents/incident-close-workflow.service.spec.ts`（评审黄1：:10,81,86,262,290 存有旧守卫「reportedAt=null→400」行为测试——改判为报送单口径，并 mock `summaryForIncident`）
- Modify: `src/modules/audit-logging/constants/incident-audit-codes.spec.ts`（评审黄2：:12-24 用 `toEqual` 冻结 11 码名单——改断言 9 码，删两退役码）
- 顺手清两处注释残留（评审否定性结论附带）：`incident.service.ts:551`、`incident-close-workflow.service.ts:148` 提及退役码/字段的注释随方法删除一并改写

**Interfaces:**
- Consumes: Task 3 `openForIncident`/`summaryForIncident`。
- Produces: assess 端点返回形状改为 `{ incidentNo, status, filingsOpened: string[] }`（前端 Task 9、e2e Task 8 按此）。

- [ ] **Step 1: 写红测**（incident.service.spec / 新 workflow spec）：①assess 勾两码 → filing service 的 `openForIncident` 收到两码（mock 校验入参）且 incident 行不再写 `reportDeadlineAt` ②assess 不勾 → 不开单 ③requestClose：reportRequired=true 且摘要有未提交单 → BadRequest 文案含 `not yet submitted`；全部已提交 → 通过；零单 → BadRequest ④getView 返回 `filings` 数组透传摘要。
- [ ] **Step 2: 跑红 → 实现**：
  - 新 workflow（铁律③头注释照抄 `incident-registration-workflow` 风格）：

```ts
@Injectable()
export class IncidentAssessmentWorkflowService {
  constructor(private readonly incidents: IncidentService, private readonly filings: RegulatoryFilingService) {}
  async assess(incidentNo: string, dto: AssessIncidentDto, actor: ApprovalActorContext): Promise<{ incidentNo: string; status: string; filingsOpened: string[] }> {
    const result = await this.incidents.assess(incidentNo, dto, actor); // 判定留痕照旧（INCIDENT_ASSESSED）
    let filingsOpened: string[] = [];
    if (dto.reportRequired) {
      const row = await this.incidents.findByNo(incidentNo);
      filingsOpened = (await this.filings.openForIncident(row, dto.reportBasisCodes ?? [], actor)).filingNos;
    }
    return { incidentNo, status: result.status, filingsOpened };
  }
}
```

  - `IncidentService.assess`：删 `reportDeadlineAt: this.computeReportDeadline(...)` 行与整个私有方法，返回值签名去掉 `reportDeadlineAt`；审计 metadata 照旧（reportRequired/reportBasisCodes 是判定留痕，不动）。
  - 结案守卫（`incident-close-workflow.service.ts:97`）：

```ts
if (row.reportRequired) {
  const filings = (await this.filings.summaryForIncident(row.incidentNo))
    .filter((f) => f.basisCode != null && f.status !== 'CANCELLED');
  const unsubmitted = filings.filter((f) => !f.submittedAt);
  if (filings.length === 0 || unsubmitted.length > 0) {
    throw new BadRequestException(`Incident ${incidentNo} requires regulator reporting but its filing(s) have not yet been submitted — it cannot be closed (${filings.length === 0 ? 'no filing opened' : unsubmitted.map((f) => f.filingNo).join(', ')})`);
  }
}
```
    快照 `reported: !!row.reportRequired && <上判定通过>`（抽局部变量复用）；注入 `RegulatoryFilingService`（module imports 已加）。
  - `getView`：`this.filings.summaryForIncident(row.incidentNo)` 结果挂 `filings` 键——**注意**：IncidentService 不注入 filing service 会成环？不会：`RegulatoryFilingsModule` 不 import `IncidentsModule`（filing 侧零事故依赖，入参传行），单向依赖合法。getView 在 IncidentService 内注入 `RegulatoryFilingService` 即可。
  - controller：assess 改 `this.assessmentWorkflow.assess(...)`；删两端点与 DTO；`incidents.module.ts` providers 加 workflow、imports 加 `RegulatoryFilingsModule`。
  - schema 六列删除 + `npx prisma migrate dev --name incident_wave2_drop_report_slot` + generate（此时 tsc 会揪出所有残余引用——`grep -rn "reportDraft\|reportedAt\|reportDeadlineAt\|reportReference" src/ test/ admin-web/src/` 逐处清点，前端引用留给 Task 9 的先在本任务用 `git grep` 出清单贴任务报告，**后端与 test/ 必须本任务清零**）。
- [ ] **Step 3: e2e 用例④改写**（`test/incident-register.e2e-spec.ts:456-478`）：定损勾 `CRM_IV_E_5`+`CRM_V_D_2` → 断言 `filingsOpened.length===2`、两单 `deadlineAt` 均 null（两码均无钟）、authority 均 VARA；再走一单 saveDraft→submitForSignoff→高管批（直调 ApprovalsService 裁决，照本文件既有审批直调先例）→markSubmitted(externalRef 'VARA-REG-2026-001')→第二单同样提交→requestClose 通过；中途在仅一单提交时 requestClose 断言 400。其余用例里 `reportRequired:false` 的直调处只需跟着 assess 新入口改（搜 `incidents.assess(` 全换 `assessmentWorkflow.assess(`——或保留服务直调处不动，仅④走 workflow；以**编译与语义**为准逐处判断）。
- [ ] **Step 4: 跑** `npx jest src/modules/governance src/modules/audit-logging --colors`（audit-logging 必须进范围——黄2 的冻结名单 spec 住那边，只跑 governance 照不到）+ `bash scripts/on-stack.sh self <e2e 跑法照 jest-e2e 惯例>`（integration spec 必经 on-stack 判例）。
- [ ] **Step 5: 随手闸①③（admin-web 此刻应还绿——前端仍读旧字段的话说明 Step 2 清点漏了前端豁免边界，核对清单）+ commit** `feat(甲波二T6): assess联动自动开单·结案守卫改判报送单·单槽六列退役(审计11→9码)`

---

### Task 7: 超时 sweep + 持久软标

**Files:**
- Create: `src/modules/governance/regulatory-filings/regulatory-filing-sweep.service.ts`
- Create: `src/modules/governance/regulatory-filings/regulatory-filing-sweep.service.spec.ts`
- Modify: `regulatory-filings.module.ts`（provider 注册）

- [ ] **Step 1: 红测**：①deadline 已过、未标、状态 DRAFT → 标记 overdueMarkedAt + `FILING_OVERDUE_MARKED`（recordSystem）②已 SUBMITTED（按时交）→ 不标 ③已标过 → 不重复 ④单笔失败不拖垮批次（mock 一单抛错，其余照标）。
- [ ] **Step 2: 实现**——模板照 `swap-sla.service.ts`：`@Cron('*/30 * * * * *')` 包装 + `sweep(now = new Date())` 分离；查询条件 `deadlineAt < now && overdueMarkedAt == null && status in ('DRAFT','PENDING_SIGNOFF','SIGNED_OFF')`；逐笔 try/catch。审计照 Task 3 helper 的 recordSystem 分支。
- [ ] **Step 3: 跑绿 + 随手闸①，commit** `feat(甲波二T7): 报送超时sweep持久软标+审计(销BACKLOG债的机制半)`

---

### Task 8: e2e 全生命周期

**Files:**
- Create: `test/regulatory-filing.e2e-spec.ts`（头部 polyfill/dotenv/AppModule 三件套逐字照抄 `incident-register.e2e-spec.ts:1-25`）

- [ ] **Step 1: 写用例**（直调服务 + supertest 混合，照事故 e2e 风格；actor 工厂照它的 `treasury()` 形状造 `compliance()`/`seniorMgmt()`）：
  ① 出站全链：登记 CYBER_BCDR（走 registration workflow）→ 调查 → 定损勾 `TIR_K_H` → 断言开出一单 deadline=+72h → saveDraft → submitForSignoff（断言审批单 actionType=REG_FILING_SUBMIT）→ 高管 APPROVE → 断言 SIGNED_OFF → markSubmitted(externalRef) → addEntry(RECEIPT_ACK) → close → 全程审计码序列断言（OPENED→DRAFT_SAVED→SIGNOFF_REQUESTED→SIGNED_OFF→SUBMITTED→ENTRY_LOGGED→CLOSED，查 audit 表按 filingNo）
  ② 驳回环：另一单送签 → 高管 DECLINE → 断言回 DRAFT + `FILING_SIGNOFF_REJECTED` → 再送签成功
  ③ 钟链：登记 DATA_BREACH → 定损勾 `PDPL_ART_9`+`TIR_II_C_24H` → 两单、链单 deadline null → 提交 PDPL 单 → 断言链单 deadline=该 submittedAt+24h
  ④ 入站：openManual `REG_INFO_REQUEST_RESPONSE`（authority VARA、receivedAt 46h 前）→ deadline= receivedAt+48h → sweep 直调（now=+3h）→ 断言 overdueMarkedAt 落、审计一条、再 sweep 不重复
  ⑤ 结案联动：③的事故在链单未提交时 requestClose 400；两单都提交后结案链走通（DATA_BREACH 走 TECHSEC/CISO 批）
  ⑥ 手工越界：openManual INCIDENT_REPORT 带不属该事故类型候选集的 basisCode → 400。
- [ ] **Step 2:** `bash scripts/on-stack.sh self`（e2e 跑法照 jest-e2e.json 惯例与 memory「jest 必须在仓库根跑+带 DATABASE_URL」判例）全绿。
- [ ] **Step 3: commit** `test(甲波二T8): 报送e2e六段(全链/驳回/钟链/入站超时/结案联动/越界)`

---

### Task 9: 前端两页 + 事故页改造 + 审批中心登记

**Files:**
- Create: `admin-web/src/utils/regulatoryFilingMap.ts`（词表镜像：`FILING_STATUS_LABEL` 六值人话（Draft/Pending sign-off/Signed off — to submit/Submitted/Closed/Cancelled）、`FILING_ENTRY_KIND_LABEL` 三值、`AUTHORITY_LABEL` 五值、`FILING_TYPE_MIRROR` 五行（label/direction/requiresIncident/defaultAuthority）、deadline 显示与色调 helper——把 `incidentStatusMap.ts` 的 `reportDeadlineDisplay`/`reportBasisClockText`/`REPORT_DEADLINE_TONE_CLASS` **迁移**过来（事故页不再用；immediate 码显示「Immediate」不是「未设时限」，spec §1））
- Create: `admin-web/src/pages/RegulatoryFilingListPage.tsx`、`admin-web/src/pages/RegulatoryFilingDetailPage.tsx`
- Modify: `admin-web/src/App.tsx:264` 附近（两条 Route）、`admin-web/src/components/DashboardLayout.tsx:390` 附近（Incident Register 条目后加 nav 项）、`admin-web/src/rbac/permissions.ts`（`REG_FILINGS_READ: 'api.get.admin_regulatory_filings'`、`REG_FILING_DETAIL_READ: 'api.get.admin_regulatory_filings_filingno'`——拼写按 `normalizePermissionPath` 规则：连字符转下划线）
- Modify: `admin-web/src/pages/IncidentDetailPage.tsx`（通报区块换脸）、`admin-web/src/pages/IncidentListPage.tsx`（评审黄1：:40-41,424,436-438 的「Report status」「Deadline」两列退役，换单列「Reporting」读 `reportRequired`（Required / —）——spec §9 补裁）、`admin-web/src/utils/incidentStatusMap.ts`（摘走迁移的三个 helper；`INCIDENT_REPORT_BASES` 镜像**保留**——定损弹窗还在用）
- （审批中心两处前端登记已随评审黄3 移入 Task 5，本任务不再碰）

- [ ] **Step 1: ListPage**——模板 `IncidentListPage.tsx`：列 = filingNo（链接）/ Type / Direction / Authority / Status（StatusPill + 词表）/ Deadline（超时行 `overdueMarkedAt` 非空标红，用迁移来的 tone helper）/ Incident（incidentNo 链接到事故页，可空显 `—`）；顶部筛选 status/type；「Open filing」按钮（持 `REG_FILING_WRITE` 路由码即 `api.post.admin_regulatory_filings` 显示）弹开单表单：type 下拉（registry 镜像五行，选 INCIDENT_REPORT 时显 incidentNo+basisCode 输入、INBOUND 类型显 receivedAt+authority 下拉、双头类显 cc 多选）——**全下拉受控，零自由文本机构**。
- [ ] **Step 2: DetailPage**——模板 `IncidentDetailPage.tsx` 六块改五块：基本信息（含 basisCode 依据码 label、deadline 倒计时、关联事故链接）｜正文草稿（textarea，DRAFT 态可编辑 + Save draft）｜签发区（DRAFT 显「Submit for sign-off」；PENDING_SIGNOFF 显审批单号链接；SIGNED_OFF 显「Mark submitted」弹窗必填 externalRef）｜往来记录时间线（SUBMITTED 态显「Log entry」，kind 受控下拉）｜办结/作废（SUBMITTED→Close；DRAFT→Cancel 需 reason）。动作按钮可见性 = 状态机边 × 持码（adminFetch + PERMISSIONS，照事故页 `canWrite` 口径）。
- [ ] **Step 3: IncidentDetailPage 通报区块换脸**：删草稿 textarea/「Mark reported」按钮/`canSaveDraft`/`canMarkReported`/detail 接口 72-76 行五个退役字段/`closeGateReason`（实名以 IncidentDetailPage.tsx:110 为准，评审白4 订正）里 128-129 行判断改为「有未提交报送单则显示 filings 表内红字提示」；新区块 = 「Regulatory filings」表（读 getView 新 `filings` 键：filingNo/status/authority/deadline，行链接到报送详情页）。定损弹窗保持——`reportRequired`/`reportBasisCodes` 判定 UI 不动，提交后 toast 显示 `filingsOpened` 单号。
- [ ] **Step 4: 闸③ + 闸⑤**：`cd admin-web && npx tsc -b --noEmit`；起 self 栈 preview 渲染，截图四张：报送列表（含超时红行）/ 报送详情（SIGNED_OFF 态）/ 开单弹窗 / 事故详情新通报区块——落盘 `doc-final/superpowers/checkups/2026-09-26-act-a-wave2-evidence/`（物证必须写明落盘路径判例）。
- [ ] **Step 5: commit** `feat(甲波二T9): 报送台两页+事故通报区块换脸+审批中心两登记+词表镜像`

---

### Task 10: 种子 + demo 文档同步

**Files:**
- Modify: `prisma/seed.business.ts`（`seedIncidents` 之后加 `seedRegulatoryFilings`，主流程 ③c 后挂 ③d）
- Modify: `doc-final/demo/data.md`（事故样例节后加报送台节——先 `grep -n "事故\|Incident" doc-final/demo/data.md` 找准手写节位置；生成区 GENERATED 标记内**不动**）
- Modify: `doc-final/demo/script.md`（`grep -n "通报\|regulator" doc-final/demo/script.md` 命中处同步改为开单流程措辞；无命中则只在 data.md 记）

- [ ] **Step 1: seed**——照 `DEMO_INCIDENTS` 直铺快照先例（不走服务、不写审计，注释声明「登记会留痕由 e2e 证」；`buildDeterministicNo('FIL', seedKey)` 出稳定单号）。**评审黄5 改判（spec §10 已同步）**：
  样例一挂**既有 `data-breach-crm-export`**（seed.business.ts:1013-1019，ASSESSED＋reportRequired 双码）——甲案后它是「零单」不可达态，必须补单归位：`PDPL_ART_9` 单 SUBMITTED（authority UAE_DATA_OFFICE，externalRef `DATAOFFICE-ACK-2026-0001`，submittedAt=now-20h）＋一条 RECEIPT_ACK entry；`TIR_II_C_24H` 链单 SIGNED_OFF 或 DRAFT，deadline＝前者 submittedAt＋24h（还剩约 4h，倒计时在跑）。种子即演双钟链。**不新增 CYBER_BCDR 种子**——seed 头注释（:978-984）明写该类故意留给演示现场登记，波一设计不动。
  样例二：一单 `REG_INFO_REQUEST_RESPONSE`/VARA/DRAFT，receivedAt=now-6h（48h 钟在跑）。
- [ ] **Step 2: 重铺闸⑧**：`bash scripts/stack.sh reset self` → 起栈 → `bash scripts/on-stack.sh self demo:all` 全绿（旧库重跑必红判例：reset 先行）。
- [ ] **Step 3: data.md/script.md 同步**（评审白3 量级订正：不是措辞级）：`demo/data.md:65` 附近 `data-breach-crm-export` 描述行整行改写（旧「双倒计时徽章」等已失真）＋新增报送台节；`demo/script.md` 场景 18 走查**编排重写**——收编后「保存通报草案→标已通报」两步换成「定损自动开单→切合规官起草送签→切高管批→切回合规官标已提交」，:189/199/203 附近「全程 treasury@」注③注⑤不再成立，**账号切换总表**同步改（treasury→compliance→senior management→treasury）。
- [ ] **Step 4: commit** `feat(甲波二T10): 种子双钟链样例归位+来函样例+demo两文档重编排`

---

### Task 11: 文档收口 + 变异实证 + 波三骨架（收尾对照 `doc-final/rules/delivery-checklist.md`）

**Files:**
- Create: `doc-final/modules/v9-regulatory-filing.md`（§0-4 照篇目结构；§4 演示脚本含双钟链现场走法）
- Modify: `doc-final/modules/overview.md`（§1 模块表 +1 行、§4 头行与权限表 13→14 域 66→68 桶 74→76 组 + 新域一行 + 合规官/高管/内审三行独有动作更新、§5 技术节点补模块根）
- Modify: `doc-final/modules/v1-governance.md` §7（通报节改写：判定留事故、过程归报送台、结案守卫新语义）
- Modify: `doc-final/modules/v8-recon.md`（场景 18 走查步骤 100 行附近：「保存通报草案→标已通报」→「自动开单→单上办结」）
- Modify: `doc-final/BACKLOG.md`（销 156 行「事故通报超时无持久软标与审计」——注明波二机制与位置）
- Modify: `doc-final/CHANGELOG.md`（一合并一行，合并时写）
- Modify: `delivery/` 触碰检查命中两项（动审计集：事故 11→9 + 报送十码新册；新状态机：FILING 六态六边）——按 `README.md` 四刀声明的对应文件落
- Create: `doc-final/superpowers/specs/2026-09-26-campaign-a-wave3-skeleton.md`（链总纲 + 承接：工单主体形状/类型目录扩行方式/MLRO 包待设计/岔口留位）

- [ ] **Step 1: 变异实证三点**（spec §11，结果记 evidence 目录）：①`FILING_TRANSITIONS` 注释掉 `SIGNED_OFF→SUBMITTED` 边 → 相关测试必红 ②签发链 roles 换 `OPS_OFFICER` → e2e ①必红 ③markSubmitted 的 externalRef 前置注释掉 → 单测⑥必红。逐点改→跑→红→还原→绿，命令与退出码入档。
- [ ] **Step 2: 词表入库**：`npm run audit:vocab`（差集 fail-fast 停手考古判例——退役两码在重铺库中应零残留）。
- [ ] **Step 3: 全量收尾闸**：随手闸①②③ + `npx jest src/modules/governance src/modules/audit-logging --colors` + on-stack e2e + demo:all + verify:rbac，全绿证据（命令+退出码+关键行）入 `checkups/2026-09-26-act-a-wave2-evidence/`。
- [ ] **Step 4: 文档六件套逐一落**（overview 数字改动处 grep 清点复述位置，「数字多处复述必漏改」判例）。
- [ ] **Step 5: commit** `docs(甲波二T11): truth同步·v9新篇·BACKLOG销账·delivery触碰·波三骨架`

---

## 里程碑与依赖

T1→T2→T3→T4→T5（后端主体线，严格串行）；T6 依赖 T3/T5；T7 依赖 T3；T8 依赖 T6/T7；T9 依赖 T6（assess 返回形状）；T10 依赖 T9；T11 收尾。评审节奏照 SDD：每任务任务级 review（执行档），全部任务完成后终审（不降档）逐条追 spec 承诺 + 变异三点复核。

## Self-review 已核对

- spec §0-§14 逐节有任务承接（§2→T1、§1→T2、§7→T3、§4→T4、§6→T5、§5→T6、§8→T7、§11→T8/T11、§9→T9、§10→T10、§12→T11、§13→波三骨架）。
- 类型/签名一致性：`openForIncident`/`summaryForIncident`/`filingsOpened` 三处跨任务引用拼写已统一；权限码拼写按 `normalizePermissionPath`（连字符→下划线）核过。
- 无 TBD；前端两页以模板文件+完整行为清单表达（列/按钮/可见性/受控枚举逐项点名），样式原语沿用既有组件库。
