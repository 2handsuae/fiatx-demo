# 平账三期 · 事故登记 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地治理件「事故登记」：独立主体 `Incident` 五态生命周期 + 通报留痕 + 双类型结案审批 + 案子三入口 + 未授权转出演示闭环（场景 18），全程零账务。

**Architecture:** 新模块 `src/modules/governance/incidents/`（与 approvals 平级）；对账侧只加出口与入口（`cause-registry` 新 `INCIDENT` 出口、案件页三按钮）；善后复用既有原语（认损调账开 `INCIDENT` 分支门、补款走 `adjustmentNo` 既有通道）；审批走 `ApprovalsService` 正门、两个动作类型分链。

**Tech Stack:** NestJS + Prisma(SQLite) + React admin-web；审批框架 `ApprovalHandlerBase`；审计合同 `assertActionSpec`。

**Spec:** `doc-final/superpowers/specs/2026-09-03-incident-register-design.md`（§0 拍板记录 = 本 plan 的裁决依据，不重议）

## Global Constraints

- 通用交付清单见 `rules/delivery-checklist.md`，全部适用
- 本轮特有：**事故零账务**（Incident 模块禁止出现 AccountingService / FundsOrder 依赖）｜ 客户端零可见（client-web 不改一行）｜ 72h 常量只绑 `TIR_K_H` 依据，禁止出现"重大事件 72h"式泛化命名 ｜ 通报倒计时起算 = 事故登记时刻 ｜ 验收必须整库重铺（轻量重跑场景 6 假红）｜ CLAUDE.md §2 禁做清单照旧（无幂等/并发/重试）
- 执行环境：worktree 分支 `worktree-recon-wave3`（`superpowers:using-git-worktrees`），栈用 `self`，闸门命令一律 `bash scripts/on-stack.sh self <script>`
- 模型分层（CLAUDE.md §6）：任务执行 `sonnet`；Task 7 / 9 / 10（审批接线、状态机、动钱路径改门）评审升 `opus`；终审 Fable（派发省略 model 字段走继承）
- 每任务开场列「本任务做 / 不做」；收尾列「本任务过哪几条交付清单行」（本 plan 每任务已写死）

---

### Task 1: 三张新表 + 定性行加列 + 重铺登记

**做**：schema 迁移、reset 清单登记。**不做**：任何服务逻辑。

**Files:**
- Modify: `prisma/schema.prisma`（`ReconciliationDisposition` 之后加三模型；`ReconciliationDisposition` 加一列）
- Modify: `scripts/reset-business-data.ts:56` 附近（`reconciliationAdjustment` 之前插三行）
- Create: 迁移文件（`npx prisma migrate dev --name incident-register`）

**Interfaces（后续任务消费）:**
- Prisma delegates：`incident` / `incidentNote` / `incidentRemediation`；`reconciliationDisposition.incidentNo: string | null`

- [ ] **Step 1: schema 加模型**（字段照抄，命名对齐 `InternalTransfer` 风格）：

```prisma
model Incident {
  id                 String    @id @default(uuid())
  incidentNo         String    @unique
  type               String    // UNAUTHORIZED_OUTFLOW | LARGE_UNEXPLAINED | CLIENT_SHORTFALL | MANUAL
  status             String    @default("REGISTERED") // REGISTERED | INVESTIGATING | ASSESSED | RESOLVING | CLOSED | WITHDRAWN
  title              String
  description        String
  sourceCaseNo       String?
  sourceDispositionNo String?
  sourceExternalLineId String? // 内部 id，任何界面不得展示
  sourceAdvanceTransferNo String? // CLIENT_SHORTFALL：欠条锚定的垫款单
  walletRef          String?
  customerId         String?
  customerNo         String?
  assetCode          String?
  amount             Decimal?  // 元（对齐 InternalTransfer.amount 口径）
  assessedAmount     Decimal?
  assessmentBasis    String?   // RECOVERED | FIRM_LOSS | CLIENT_COLLECTION | NO_LOSS
  reportRequired     Boolean   @default(false)
  reportBasisCodes   String?   // 逗号分隔依据码，如 "TIR_K_H,CRM_V_D_2"
  reportDeadlineAt   DateTime?
  reportDraft        String?
  reportDraftedAt    DateTime?
  reportedAt         DateTime?
  reportedByUserId   String?
  reportReference    String?
  approvalNo         String?   // 结案审批单
  registeredByUserId String
  closedAt           DateTime?
  withdrawnReason    String?
  traceId            String
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  notes        IncidentNote[]
  remediations IncidentRemediation[]
  @@index([status])
  @@index([sourceCaseNo])
  @@map("incidents")
}

model IncidentNote {
  id           String   @id @default(uuid())
  incidentId   String
  kind         String   // NOTE | ESCALATION
  escalatedTo  String?  // MLRO | CFO | SENIOR_MANAGEMENT（kind=ESCALATION 必填）
  body         String
  authorUserId String
  createdAt    DateTime @default(now())
  incident Incident @relation(fields: [incidentId], references: [id])
  @@index([incidentId])
  @@map("incident_notes")
}

model IncidentRemediation {
  id             String   @id @default(uuid())
  incidentId     String
  kind           String   // SUPPLEMENT | CLAIM | ADJUSTMENT | TRANSFER
  referenceNo    String
  linkedByUserId String
  createdAt      DateTime @default(now())
  incident Incident @relation(fields: [incidentId], references: [id])
  @@index([incidentId])
  @@map("incident_remediations")
}
```

`ReconciliationDisposition` 加：`incidentNo String?`（放 `supplementNo` 之后，注释「平账三期：与 adjustmentNo/supplementNo 平行，登记事故后写回」）。

- [ ] **Step 2: reset 登记**（二期 Task 2/10 的 FK 教训——与建表同一提交）。在 `BUSINESS_DELEGATES_FK_SAFE` 的 `'reconciliationAdjustment'` 之前插入（children before parents）：

```ts
  // 平账三期：事故登记（零 FK 到 asset，但 notes/remediations FK → incidents，子先删）
  'incidentNote',
  'incidentRemediation',
  'incident',
```

- [ ] **Step 3: 迁移 + 重铺验证**

Run: `npx prisma migrate dev --name incident-register && npx prisma generate`，然后 `bash scripts/stack.sh reset self`
Expected: 迁移成功、空库重铺全绿（对照 `doc-final/demo/baseline.md`）

- [ ] **Step 4: Commit** `feat(平账三期): incidents 三表 + 定性行 incidentNo 列 + reset 登记`

**交付清单行**：改 schema ｜ 任何持久状态变化（表就位，审计在 Task 2/5 起写）

---

### Task 2: 审计码 11 个 + 合同接线

**做**：`INCIDENT_AUDIT_ACTIONS` 族、`assertActionSpec` 链接线、词表闭合测试。**不做**：写入调用（Task 5-7 做）。

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`AuditActions` +11；新导出 `INCIDENT_AUDIT_ACTIONS` 族，**四属性字段名与取值格式逐项对照同文件 `V7_TREASURY_AUDIT_ACTIONS` 族照写**；workflow 类型枚举两处（本文件 :67 与 :144 的 `INTERNAL_TRANSFER` 所在两张表）各 +`INCIDENT: 'INCIDENT'`）
- Modify: `src/modules/audit-logging/audit-logs.service.ts:895`（`??` 链）
- Create: `src/modules/audit-logging/constants/incident-audit-codes.spec.ts`（模板：同目录 `internal-transfer-audit-codes.spec.ts`）

**Interfaces:**
- Produces: `AuditActions.INCIDENT_REGISTERED | INCIDENT_INVESTIGATION_STARTED | INCIDENT_NOTE_ADDED | INCIDENT_ESCALATED | INCIDENT_ASSESSED | INCIDENT_REMEDIATION_LINKED | INCIDENT_REGULATOR_REPORT_DRAFTED | INCIDENT_REGULATOR_REPORTED | INCIDENT_CLOSE_REQUESTED | INCIDENT_CLOSED | INCIDENT_WITHDRAWN`

- [ ] **Step 1: 写失败测试**——新 spec 断言：① 11 码在 `INCIDENT_AUDIT_ACTIONS` 且四属性齐（含义 / actionDomain / correlationMode / 特有必填）；② `INCIDENT_ESCALATED` 必填 `escalatedTo`、`INCIDENT_REGULATOR_REPORTED` 必填 `basisCodes`；③ 走真 `AuditLogsService.recordByActor` 写一条 `INCIDENT_NOTE_ADDED` 缺必填字段被拒（证明 `??` 链接上了——**这是二期 Critical 的回归测试**：只登记常量不接链 = 免检放行）。correlationMode：`REGISTERED / CLOSE_REQUESTED / CLOSED` 关联审批 / 单号；纯单步动作（NOTE_ADDED / ESCALATED / ASSESSED / REMEDIATION_LINKED / REPORT_DRAFTED / REPORTED / WITHDRAWN / INVESTIGATION_STARTED）= N，不伪造关联（判例）。
- [ ] **Step 2: 跑测试确认红**（`npx jest src/modules/audit-logging/constants/incident-audit-codes.spec.ts`，在 Exchange_js 根下、不接管道）
- [ ] **Step 3: 实现**——常量族照 V7 模板；接线（关键行，位置在 `V7_TREASURY_AUDIT_ACTIONS[input.action] ??` 之后、V2 之前）：

```ts
      V7_TREASURY_AUDIT_ACTIONS[input.action] ??
      INCIDENT_AUDIT_ACTIONS[input.action] ??
```

- [ ] **Step 4: 跑测试确认绿**；同时跑 `audit-vocabulary-closure.spec.ts` 与 `audit-actions.constant.spec.ts` 确认词表闭合未破
- [ ] **Step 5: Commit** `feat(平账三期): 事故 11 审计码 + assertActionSpec 链接线（含回归测试）`

**交付清单行**：新增审计动作码（四属性冻结 + 机器校验）

---

### Task 3: 结案双审批类型登记（三处同加）

**做**：动作类型 / 策略 / maker 表 / 策略管理 UI 白名单。**不做**：handler（Task 7）。

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`ApprovalActionTypes` +2；`POLICY` 表 +2；`V1_APPROVAL_ACTION_TYPES` +2——`INTERNAL_TRANSFER_APPROVAL` 在 :381 的先例）
- Modify: `scripts/verify-rbac.ts:243` `MAKER_GROUP_BY_POLICY` +2
- Test: `src/modules/governance/approvals/approval-policy.service.spec.ts`（若有策略清单断言则更新）

**Interfaces:**
- Produces: `ApprovalActionTypes.INCIDENT_CLOSE_SECURITY`（两步 MLRO→CFO）/ `INCIDENT_CLOSE_FINANCIAL`（单步 CFO）

- [ ] **Step 1: 登记四处**：

```ts
// ApprovalActionTypes
INCIDENT_CLOSE_SECURITY: 'INCIDENT_CLOSE_SECURITY',
INCIDENT_CLOSE_FINANCIAL: 'INCIDENT_CLOSE_FINANCIAL',
// POLICY（两步形状先例 = DEPOSIT_SEIZE :304）
[ApprovalActionTypes.INCIDENT_CLOSE_SECURITY]: {
  steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true,
},
[ApprovalActionTypes.INCIDENT_CLOSE_FINANCIAL]: {
  steps: [{ stepNo: 1, roles: ['CFO'] }], timeoutHours: 48, allowCancel: true,
},
```

`V1_APPROVAL_ACTION_TYPES` 数组尾部 +2 条；`MAKER_GROUP_BY_POLICY` +：

```ts
    INCIDENT_CLOSE_SECURITY: 'INCIDENT_WRITE',
    INCIDENT_CLOSE_FINANCIAL: 'INCIDENT_WRITE',
```

- [ ] **Step 2: 防漏对照**——`grep -rn "INTERNAL_TRANSFER_APPROVAL" src/ scripts/ admin-web/src/ | grep -v spec | grep -v node_modules`，逐处判断新类型是否需要同类登记（审批详情页 actionType→路由映射、审批中心文案表等），需要的照加。把对照结果写进 commit message。
- [ ] **Step 3: 闸**：`npx tsc --noEmit -p tsconfig.json`；`npx jest src/modules/governance/approvals`。Expected: 全绿。
- [ ] **Step 4: Commit** `feat(平账三期): 结案双审批类型——安全类两步 MLRO→CFO / 资金类单步 CFO（grep 对照 INTERNAL_TRANSFER_APPROVAL 全登记点）`

**交付清单行**：新增审批策略（MAKER_GROUP_BY_POLICY 加行）｜ 该走 maker-checker

---

### Task 4: 权限组两枚 + 「事故登记」新域两桶 + 端点占位登记

**做**：RBAC 四处齐。**不做**：controller 实现（Task 8，本任务 route 先登记、路由 404 无妨——`db:base:sync` 与前端桶目录只读 catalog）。

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`：
  - `PermissionGroup` 联合类型 +`'INCIDENT_READ' | 'INCIDENT_WRITE'`（:54 附近）
  - `route()` 清单 +11 条（模板 :396-398）：

```ts
route('POST', '/admin/incidents', 'Register an incident (from a recon case or manually)', ['INCIDENT_WRITE']),
route('GET', '/admin/incidents', 'List incidents', ['INCIDENT_READ', 'INCIDENT_WRITE']),
route('GET', '/admin/incidents/:incidentNo', 'View incident detail', ['INCIDENT_READ', 'INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/investigation', 'Start investigation', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/notes', 'Add investigation note', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/escalate', 'Record an escalation (MLRO / CFO / senior management)', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/assess', 'Record loss assessment and reporting decision', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/remediations', 'Link a remediation order', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/regulator-report', 'Save regulator report draft', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/regulator-report/mark', 'Mark regulator report as filed', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/close', 'Request incident closure (opens approval)', ['INCIDENT_WRITE']),
route('POST', '/admin/incidents/:incidentNo/withdraw', 'Withdraw a mis-registered incident', ['INCIDENT_WRITE']),
```

（12 条——列表/详情拆两条 GET；spec §7 的「11 端点」按 handler 计，`investigation` 并入后仍以本清单为准，收尾把 spec 数字对齐实测。）
  - `ACTION_BUCKET_CATALOG` 新域（放 `Reconciliation` 域之后，模板 :629 Approval Center）：

```ts
{
  key: 'incidents',
  label: 'Incident Register',
  buckets: [
    { key: 'incidents.view', label: 'View incidents', description: 'Browse the incident register and reporting trail', groups: ['INCIDENT_READ', 'INCIDENT_WRITE'] },
    { key: 'incidents.manage', label: 'Register & manage incidents', description: 'Register, investigate, assess, link remediations, request closure', groups: ['INCIDENT_WRITE'] },
  ],
},
```

  - `RBAC_ROLE_GROUP_BINDINGS`：`OPS_OFFICER` + `TREASURY_OFFICER` 加 `INCIDENT_WRITE`；`MLRO` / `CFO` / `INTERNAL_AUDITOR` / `SENIOR_MANAGEMENT_OFFICER` / `DPO` 加 `INCIDENT_READ`
- Modify: `scripts/verify-rbac.ts`（若有 12 域 56 桶计数断言 → 13 域 58 桶；S1/S2 静态判据随 catalog 自增则不动）

- [ ] **Step 1: 改 catalog 四处 + sync**：`npm run db:base:sync`
- [ ] **Step 2: 闸**：`npx tsc --noEmit -p tsconfig.json`；`bash scripts/on-stack.sh self verify:rbac`。Expected: S1/S2 绿（行为探针在端点就位后的 Task 13 再全跑；本步允许 47 条探针对新路由 404 报红时**只记录不修**，Task 8 完成后复跑必须全绿）。
- [ ] **Step 3: Commit** `feat(平账三期): INCIDENT_READ/WRITE 两权限组 + Incident Register 新域两桶 + 12 端点登记（13 域 58 桶）`

**交付清单行**：新增权限组（四处齐）｜ 新增 admin 端点（route + sync + 重启在栈内自动）

---

### Task 5: Incident 主体服务——状态机 / 登记 / 调查 / 升级 / 撤回

**做**：模块骨架 + 主体服务 + 显式迁移表 + 四类登记校验 + 审计。**不做**：定损/通报（Task 6）、结案（Task 7）、HTTP 层（Task 8）。

**Files:**
- Create: `src/modules/governance/incidents/incidents.module.ts`（注册进 `src/modules/governance/governance.module.ts`）
- Create: `src/modules/governance/incidents/incident.constants.ts`
- Create: `src/modules/governance/incidents/incident.service.ts`
- Create: `src/modules/governance/incidents/incident.service.spec.ts`

**Interfaces:**
- Produces:
  - `IncidentTypes = { UNAUTHORIZED_OUTFLOW, LARGE_UNEXPLAINED, CLIENT_SHORTFALL, MANUAL }`、`IncidentStatus`、`INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentAction[]>`
  - `IncidentService.register(dto: RegisterIncidentDto, actor): Promise<{ incidentNo: string }>`（dto：`type, title, description, sourceCaseNo?, sourceDispositionNo?, sourceAdvanceTransferNo?, walletRef?, customerNo?, assetCode?, amount?`）
  - `startInvestigation(incidentNo, actor)` / `addNote(incidentNo, body, actor)` / `escalate(incidentNo, { to, note }, actor)` / `withdraw(incidentNo, reason, actor)` / `linkRemediation(incidentNo, { kind, referenceNo }, actor)`
- Consumes: Task 1 delegates、Task 2 审计码；单号生成复用既有业务号 helper（grep `transferNo` 的生成处，`internal-transfer.service.ts` 内，同一工具、前缀 `INC`）

- [ ] **Step 1: 写失败测试**（真库 spec 风格照 `internal-transfer-workflow.service.spec.ts` 的 mock 形态）：
  - 迁移表：`REGISTERED→INVESTIGATING/WITHDRAWN`、`INVESTIGATING→ASSESSED`（Task 6 补）、非法跃迁（`REGISTERED` 直接 close）显式 400
  - 登记校验按类型：`UNAUTHORIZED_OUTFLOW` 必带 `sourceCaseNo+sourceDispositionNo`，且定性行 `outlet==='INCIDENT'`、`causeCode==='UNAUTHORIZED_OUTFLOW'`、`incidentNo` 未占用（防一行两事故）；登记成功后写回 `reconciliationDisposition.incidentNo`；`LARGE_UNEXPLAINED` 必带 `sourceCaseNo` 且案子 `slaBreached===true`；`CLIENT_SHORTFALL` 必带 `customerNo+amount`，给了 `sourceAdvanceTransferNo` 则校验该划转单 `purpose==='CLIENT_ADVANCE'`；`MANUAL` 只要 `title+description`
  - `escalate` 落 `IncidentNote{kind:'ESCALATION', escalatedTo}` + `INCIDENT_ESCALATED` 审计（`escalatedTo` 进 metadata）
  - `withdraw` 必填 `reason`、只许从 `REGISTERED`；`linkRemediation` 校验 `referenceNo` 在对应域存在（ADJUSTMENT→`reconciliationAdjustment`、TRANSFER→`internalTransfer`、SUPPLEMENT/CLAIM→充值单/账单行认领记录，查不到 404）
  - 每个动作一条审计（`recordByActor`、显式 `requestId`）
- [ ] **Step 2: 确认红** → **Step 3: 实现**（服务只写自己的表 + 定性行 `incidentNo` 写回——这一列是对账主体的数据，写回走 `disposition` 侧仓储方法置于 Task 9？**不**：铁律③跨主体写只在 workflow。本任务 `register` 即编排点，允许经 `IncidentService` 直写 `reconciliationDisposition.incidentNo` 会踩铁律③——**改为**：`incidents.module` 里建 `IncidentRegistrationWorkflowService`，`register` 编排「建事故单（IncidentService）+ 写回定性行（调 Task 9 在 disposition 侧新增的 `DispositionService.attachIncident(dispositionNo, incidentNo)`）」。Task 9 先行提供该方法签名：`attachIncident(dispositionNo: string, incidentNo: string): Promise<void>`（本任务先以接口 mock 测，Task 9 落真）
- [ ] **Step 4: 确认绿**：`npx jest src/modules/governance/incidents` → **Step 5: Commit** `feat(平账三期): Incident 主体——五态迁移表 + 四类登记校验 + 升级/撤回/善后挂载`

**交付清单行**：任何持久状态变化 ｜ 新状态/新结局（迁移表 + 计时答案：通报一只钟见 Task 6）｜ 对外识别（incidentNo）

---

### Task 6: 定损 + 通报留痕（依据目录 / 72h 倒计时 / 草案 / 标已通报）

**做**：`assess` / `saveReportDraft` / `markReported`、`INCIDENT_REPORT_BASES` 目录、deadline 计算。**不做**：结案。

**Files:**
- Modify: `src/modules/governance/incidents/incident.constants.ts`、`incident.service.ts`
- Test: `src/modules/governance/incidents/incident.service.spec.ts`

**Interfaces:**
- Produces:
  - `INCIDENT_REPORT_BASES`（**数字来源 roadmap 一手核，不得改动**）：

```ts
/** 依据条款目录（spec §4）。hours=null 的依据没有法定钟——界面显式「未设时限」，不杜撰。 */
export const INCIDENT_REPORT_BASES = {
  TIR_K_H:    { label: 'TIR Rulebook Section K + H — 网安 / BCDR 事件报 VARA', hours: 72 },
  CRM_IV_E_5: { label: 'CRM IV.E.5 — Client Money 重大未平差异', hours: null },
  CRM_V_D_2:  { label: 'CRM V.D.2 — Client VAs 重大未平差异', hours: null },
} as const;
```

  - `assess(incidentNo, dto: { assessedAmount: string; assessmentBasis: 'RECOVERED'|'FIRM_LOSS'|'CLIENT_COLLECTION'|'NO_LOSS'; reportRequired: boolean; reportBasisCodes?: string[] }, actor)`
  - `saveReportDraft(incidentNo, draft, actor)` / `markReported(incidentNo, { reference? }, actor)`

- [ ] **Step 1: 写失败测试**：
  - `assess` 只许从 `INVESTIGATING`；`reportRequired=true` 必带非空 `reportBasisCodes` 且码在目录内
  - **deadline = `incident.createdAt` + min(所选依据的 hours)**（登记时刻起算——"检测后 72h"）；只选无钟依据 → `reportDeadlineAt` 保持 null
  - `markReported` 前置：`reportRequired && reportDraft 非空`；落 `reportedAt/reportedByUserId` + `INCIDENT_REGULATOR_REPORTED` 审计（metadata 带 `basisCodes`）
  - `saveReportDraft` 首次落草案记 `INCIDENT_REGULATOR_REPORT_DRAFTED` + `reportDraftedAt`，再次保存只更新草案不再记该码（spec 已核结论）
  - **变异靶子②的正测**：断言 `reportDeadlineAt.getTime() === createdAt.getTime() + 72*3600*1000`——将来删掉 deadline 计算这条必红
- [ ] **Step 2: 红** → **Step 3: 实现** → **Step 4: 绿**（`npx jest src/modules/governance/incidents`）
- [ ] **Step 5: Commit** `feat(平账三期): 定损 + 通报留痕——依据目录三条、72h 登记时刻起算、无钟依据显式未设时限`

**交付清单行**：任何持久状态变化 ｜ 新状态（ASSESSED 入边 + 通报一只钟、软标）

---

### Task 7: 结案工作流 + 审批接线（handler）

**做**：`requestClose` / `CLOSE_NO_ACTION` / handler `onDecided`。**不做**：前端。

**Files:**
- Create: `src/modules/governance/incidents/incident-approval.service.ts`（`extends ApprovalHandlerBase`，模板：`src/modules/asset-treasury/internal-transfers/internal-transfer-approval.service.ts`——注册方式、事件订阅照抄）
- Modify: `incident.service.ts`（或独立 `incident-close-workflow.service.ts`，若 close 需要读善后单状态则独立 workflow，遵铁律③）
- Test: `incident.service.spec.ts` + `incident-approval.service.spec.ts`

**Interfaces:**
- Consumes: Task 3 双动作类型；`ApprovalsService.createAndSubmit`（用法照 `internal-transfer-workflow.service.ts:submitForApproval`——objectSnapshot 零 UUID）
- Produces: `requestClose(incidentNo, actor)`：按 `type==='UNAUTHORIZED_OUTFLOW' ? INCIDENT_CLOSE_SECURITY : INCIDENT_CLOSE_FINANCIAL` 开审批；`onDecided(APPROVED)` → 状态 `CLOSED` + `closedAt` + `INCIDENT_CLOSED` 审计；`REJECTED` → 留在原状态 + 审计

- [ ] **Step 1: 写失败测试**：
  - `requestClose` 前置：状态 ∈ {`ASSESSED`（仅 `NO_LOSS` 且零善后挂载 = CLOSE_NO_ACTION 路）, `RESOLVING`}；**`ASSESSED` 之前（REGISTERED/INVESTIGATING）→ 400**（**变异靶子①**：删这条守卫，本用例 + Task 13 e2e 对应用例必红）
  - `reportRequired=true` 而未 `markReported` → 400（结案前通报必须留痕）
  - 类型→动作类型路由断言（两分支各一条）
  - objectSnapshot 内容断言：类型、金额、定损口径、善后单号清单、是否已通报——全业务键零 UUID
  - `onDecided` APPROVED→CLOSED / REJECTED→原状态
- [ ] **Step 2: 红** → **Step 3: 实现** → **Step 4: 绿** → **Step 5: Commit** `feat(平账三期): 结案工作流——双类型路由 + 定损前结案 400 + 通报未留痕不许关`

**交付清单行**：该走 maker-checker（正门）｜ 任何持久状态变化

---

### Task 8: Controller + DTO（12 端点落地）

**做**：HTTP 层、DTO 校验、`assertAdmin`。**不做**：新业务规则（全在 Task 5-7 服务层）。

**Files:**
- Create: `src/modules/governance/incidents/incidents.controller.ts`（模板：`internal-transfer.controller.ts`——actor 构造、守卫、路径与 Task 4 的 route() 清单逐条一致）
- Create: `src/modules/governance/incidents/dto/incident.dto.ts`
- Test: `incidents.controller.spec.ts`（薄：路由→服务转发 + 权限守卫存在）

- [ ] **Step 1: 失败测试 → Step 2: 红 → Step 3: 实现 → Step 4: 绿**
- [ ] **Step 5: 栈内冒烟**：`bash scripts/stack.sh up self` 后用种子管理员 token `curl` 建一笔 MANUAL 事故 → 列表可见；`bash scripts/on-stack.sh self verify:rbac` **全绿**（Task 4 遗留的 404 探针在此清零）
- [ ] **Step 6: Commit** `feat(平账三期): incidents 12 端点 + DTO（verify:rbac 行为探针全绿）`

**交付清单行**：新增 admin 端点（三件套齐）

---

### Task 9: 对账侧接线——INCIDENT 出口 + attachIncident + 案子数据支撑

**做**：`cause-registry` 新出口、定性行写回方法、案件详情 API 带出事故信息。**不做**：前端（Task 12）。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/cause-registry.ts`：
  - `StoredOutlet` / `kind` 联合类型 +`'INCIDENT'`（:14-16、:43）
  - `UNAUTHORIZED_OUTFLOW` 条目（:77）：`kind: 'DEFERRED', deferredTarget: 'INCIDENT', deferredLabel: '事故升级（三期）'` → `kind: 'INCIDENT'`（删 deferredTarget/deferredLabel 两字段）
  - `storedOutlet()`（:155 附近）加分支：`if (spec.kind === 'INCIDENT') return { outlet: 'INCIDENT', outletLabel: '事故·待登记' };`（已登记后的展示由前端按 `disposition.incidentNo` 渲染「事故 · INC…」，标签静态部分只管未登记态）
- Modify: `src/modules/clearing-settle/reconciliation/disposition/disposition.service.ts`：+`attachIncident(dispositionNo, incidentNo)`（Task 5 已按此签名 mock；只写 `incidentNo` 一列、已占用则 409）
- Modify: 案件详情查询（`reconciliation-query.service.ts`）：定性行带出 `incidentNo`；案件对象带出关联事故摘要（号/状态/类型）——前端三入口与出口徽标的数据源
- Test: `cause-registry.spec.ts`（出口断言更新）、`disposition.service` 相关 spec

- [ ] **Step 1: 失败测试**（含：`UNAUTHORIZED_OUTFLOW` 定性落库 `outlet==='INCIDENT'`；老码 `DEFERRED` 断言改写）→ **Step 2: 红 → Step 3: 实现 → Step 4: 绿**：`npx jest src/modules/clearing-settle/reconciliation`
- [ ] **Step 5: Commit** `feat(平账三期): 成因表 UNAUTHORIZED_OUTFLOW 出口 DEFERRED→INCIDENT + 定性行 attachIncident`

**交付清单行**：任何持久状态变化 ｜（成因注册表是单一来源——手册文案 Task 16 收口同步）

---

### Task 10: 认损调账事故分支（动钱路径改门——评审升 opus）

**做**：`assertWriteOffAllowed` 开 `INCIDENT` 分支；认损文案改口。**不做**：补款改动（**零改动**——spec §5 实证结论）。

**Files:**
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment.service.ts:116-157`
- Modify: `src/modules/clearing-settle/reconciliation/disposition/adjustment-rules.ts:61`（`internalLabel: '客户池查无果认损'` → `'客户池认损'`——事故路不是查无果，文案两义则改中性；同步 `adjustment-rules.spec.ts:141` 断言与手册行（Task 16））
- Test: `adjustment.service.spec.ts`（新 describe：事故路认损）

**Interfaces:**
- Consumes: Task 9 的 `disposition.incidentNo`、Task 6 的 `assessedAmount/assessmentBasis`

- [ ] **Step 1: 写失败测试**：
  - 定性行 `outlet==='INCIDENT'` 且事故 `status ∈ {ASSESSED, RESOLVING}`、`assessmentBasis==='FIRM_LOSS'`、`dto.amount ===` 定损额（最小单位换算后）→ 放行，**不要求 `slaBreached`、不查小额线**
  - 事故未定损（INVESTIGATING）→ 400「事故还没定损」；口径非认损（RECOVERED）→ 400；金额 ≠ 定损额 → 400（锁额）
  - 原挂起路（`HOLD_INVESTIGATING`）四前提回归：账龄线 / 小额线原样不动
- [ ] **Step 2: 红 → Step 3: 实现**（在 `assertWriteOffAllowed` 内：锚中行 `outlet==='INCIDENT'` 时走新分支校验后 return，`HOLD_INVESTIGATING` 老路原样）→ **Step 4: 绿**
- [ ] **Step 5: 补款零改动实证**：跑 `npx jest src/modules/asset-treasury/internal-transfers` 全绿（守卫链未动的回归证明）
- [ ] **Step 6: Commit** `feat(平账三期): 认损调账事故分支——定损锁额、免账龄线小额线；补款通道零改动`

**交付清单行**：任何持久状态变化 ｜ 动了钱？——**否**（本任务只改开单门，分录路径未动；但 Task 14 收尾闸带 `verify:coa`）

---

### Task 11: 前端——事故列表 / 详情 / 新建 + 路由 + 侧栏

**做**：三页 + 权限常量 + 导航。**不做**：案件页改动（Task 12）。

**Files:**
- Create: `admin-web/src/pages/IncidentListPage.tsx` / `IncidentDetailPage.tsx`（列表模板 `InternalTransferList.tsx`；详情模板 `InternalTransferDetail.tsx`——时间线块参照审批详情页的步骤渲染）；新建走详情路由前的表单页或列表页抽屉，与既有同域页式样一致（第五批「同一职责同一组件」规矩）
- Modify: `admin-web/src/App.tsx`（`governance/incidents` + `governance/incidents/:incidentNo` 两路由，`withPermission` 挂新权限）
- Modify: PERMISSIONS 常量文件（`grep -rn "INTERNAL_TRANSFERS_READ" admin-web/src` 定位）：+`INCIDENTS_READ` / `INCIDENT_DETAIL_READ` / `INCIDENT_WRITE` 映射
- Modify: 侧栏导航（`grep -rn "internal-transfers" admin-web/src` 定位 nav 配置）：治理区块 +「事故登记」

**页面要件（详情页六块，按 spec §6）**：基本信息（类型/状态/金额/来源案号可点跳案件页）｜调查时间线（notes+escalations 混排）｜定损块｜善后单列表（挂载表单：kind 下拉 + 单号，各单号可点跳各自详情页）｜通报留痕块（依据多选自目录、倒计时徽标——无钟依据显示「未设时限」、超时红标；草案 textarea；「已通报」按钮 + 对外编号）｜结案/撤回动作区（按钮按状态机可用性禁用，禁用态带原因 tooltip）。列表列：单号/类型/状态/金额/来源案号/通报状态/时限倒计时。**「去冻结」指路链接**：详情页客户块跳 `customers/:customerNo`（不自动冻，G6）。

- [ ] **Step 1: 实现三页 + 路由 + 侧栏**
- [ ] **Step 2: 闸**：`cd admin-web && npx tsc -b --noEmit`
- [ ] **Step 3: preview 渲染**（tsc 不算数）：起 self 栈，建一笔 MANUAL 事故走到定损，截图列表 + 详情两张核对六块齐全
- [ ] **Step 4: Commit** `feat(平账三期): 事故登记三页 + 路由权限 + 侧栏`

**交付清单行**：新增业务动作（前端入口）｜ 改了前端（截图）

---

### Task 12: 前端——案件页三入口 + 大额到线按钮 + 出口徽标

**Files:**
- Modify: `admin-web/src/pages/ReconciliationCasesDetailPage.tsx`：
  - 定性行出口为 `INCIDENT` 且未登记 → 「登记事故」按钮（预填类型/钱包/客户/金额/案号/账单行参考号 → 跳新建页带查询参数）；已登记 → 「事故 · INC…」徽标可点跳详情
  - A 批「超期 · 待升级事故（三期）」文案处（案子 `slaBreached` 且超小额线、公司池）→ 改「升级事故」按钮，预填 `LARGE_UNEXPLAINED`/金额/钱包/案号
  - B 批退汇认领余额不足的拒绝提示处（垫款按钮旁）→ +「登记欠款」按钮，预填 `CLIENT_SHORTFALL`/客户/差额/垫款单号（有则带）
  - 认损调账入口：定性行事故已定损（FIRM_LOSS）→ 现认损开单入口对该行可用（金额预填定损额、只读）
- Modify: `IncidentDetailPage.tsx`：善后区 +「发起补款」按钮（事故 `RESOLVING` 且挂载中有已落账认损单 → 跳内部划转补款发起、带 `adjustmentNo`——复用既有页面/端点，零新通道）

- [ ] **Step 1: 实现 → Step 2: `cd admin-web && npx tsc -b --noEmit` → Step 3: preview 三处入口逐一截图**（未授权转出行 / 大额到线行 / 退汇拒绝行）
- [ ] **Step 4: Commit** `feat(平账三期): 案件页三入口 + 大额到线按钮化 + 事故页发起补款`

**交付清单行**：新增业务动作（入口四处齐）｜ 改了前端（截图）

---

### Task 13: e2e 全链

**Files:**
- Create: `test/incident-register.e2e-spec.ts`（模板：`test/recon-internal-transfer.e2e-spec.ts`——登录、种子角色 token、造案手法照抄；截止时间用真实"现在"且不跨 UTC 午夜的约束同二期 Task 9）

**断言清单（每条独立 it）**：
1. 造未授权转出破口 → 定性 `UNAUTHORIZED_OUTFLOW` → 定性行 `outlet==='INCIDENT'` → 登记事故（运营）→ 定性行 `incidentNo` 写回、案子照旧 OPEN
2. 调查 → 两条 note + 一条升级（MLRO）→ 时间线可读
3. `REGISTERED/INVESTIGATING` 状态下 `close` → **400**（变异靶子①的 e2e 面）
4. 定损 FIRM_LOSS + 需通报（TIR_K_H + CRM_V_D_2）→ `reportDeadlineAt === createdAt+72h`（变异靶子②的 e2e 面）；草案 → 标已通报
5. 认损调账（金库开、金额=定损额、CFO 批、落账）→ 补款（`adjustmentNo` 通道、CFO 批、⚡ 推腿到 SUCCESS）→ 重对账案愈 → 挂载两单到事故
6. 提结案 → 审批类型 `INCIDENT_CLOSE_SECURITY`；**MLRO 未批时 CFO 批不动**；MLRO 批 → CFO 批 → 事故 `CLOSED`
7. 权限探针：运营能登记不能裁决（403）；CFO 无 `INCIDENT_WRITE` 提不了结案（403，自批死锁不存在的行为证明）
8. `MANUAL` 登记 → 撤回（必填理由）→ `WITHDRAWN`
9. `CLIENT_SHORTFALL`：带垫款单号登记 → 锚定校验（`purpose==='CLIENT_ADVANCE'`）
10. 全程 `verify:coa` 口径：事故动作前后账本零变化（步骤 1-4、6-9 之间断言余额不动——零账务的行为证明）

- [ ] **Step 1: 写全 → Step 2: 跑红 →（有产品缺陷则回上游任务修）→ Step 3: 全绿**：`npx jest test/incident-register.e2e-spec.ts --config tsconfig 对应 e2e 配置`（照 recon e2e 现行跑法，在 Exchange_js 根下）
- [ ] **Step 4: 变异测试实跑**：①注释掉「定损前不许结案」守卫 → 断言 3 红 → 还原；②注释掉 deadline 计算 → 断言 4 红 → 还原（结果写进 commit message）
- [ ] **Step 5: Commit** `test(平账三期): incident e2e 十段全链 + 双变异靶实证`

---

### Task 14: 演示场景 18 + 判据重钉

**Files:**
- Modify: `scripts/recon-demo.ts`（场景 18，模板 = 场景 17 块 :1630-1652：注入客户钱包 `ORPHAN_EXTERNAL` OUT + `bumpClosing` 负向 + `expectedLines` 带 `rootCause: 'UNAUTHORIZED_OUTFLOW'`；头注释 17 场景 → 18）
- Modify: `doc-final/demo/baseline.md`（判据重钉：场景 17/17→**18/18**、钱包桶 11/11→**12/12**（break 8→9）、`casesOpened` 11/11→**12/12**；重钉历史行 +本波）
- Modify: `doc-final/demo/script.md` 第六幕末段（登记→调查→升级→定损→通报→善后→结案走查步骤 + `MANUAL` 登记撤回一笔）
- Modify: `doc-final/demo/data.md` 手写区（若涉及；生成区由 `demo:all` 自写勿手改）

**钱包位选择规则（先跑后选）**：先 `bash scripts/on-stack.sh self recon:demo:break` 打印现行钱包桶，选**当前不在 break 桶的客户钱包**（优先 Bob USDT-TRON；若已占用则按花名册选下一个空位客户钱包），金额取该钱包当刻余额内的整数（建议 2000.00 量级，够讲"大"又不穿仓）；写死进场景注释与 baseline。

- [ ] **Step 1: 实现场景 18 → Step 2: 整库重铺验证**：`bash scripts/stack.sh reset self` → `bash scripts/on-stack.sh self demo:all` → `bash scripts/on-stack.sh self recon:demo:break`。Expected: `scenarios 18/18 DETECTED / wallets 12/12 bucket OK / casesOpened 12/12`（实测值若异于预估，按实测改 baseline 并在 commit message 说明——判据看当场显示值，二期 Task 11 前例）
- [ ] **Step 3: Commit** `feat(平账三期): 破口场景 18 未授权转出 + 判据重钉 18/18·12/12·12/12`

**交付清单行**：改页面或种子（script.md + data.md 同步）

---

### Task 15: 第六幕末段走查 + 截图六张

- [ ] **Step 1**: self 栈整库重铺后按 `demo/script.md` 第六幕末段人肉走一遍（工具 `demo-shot.js` 截图落盘）：①登记表单（预填可见）②调查中详情（升级记录在时间线）③定损 + 通报草案（**72h 倒计时在画面里**）④善后单挂载（两单可点）⑤两步结案审批（MLRO 步 + CFO 步各一张可合并）⑥案子三处入口。走查中发现旧口径文案（二期 Task 12 型缺陷：写死的「三期」「留档」字样）当场改。
- [ ] **Step 2: Commit** `docs(平账三期): 第六幕末段走查截图六张 + 旧口径文案清理`

**交付清单行**：改了前端（截图——永不豁免①）

---

### Task 16: 收尾闸 + 文档收口 + 多波收官

- [ ] **Step 1: 收尾闸全套**（self 栈）：`reset self` 整库重铺 → `demo:all` → `recon:demo:break` 18/18 → `verify:coa`（**永不豁免②**：善后动了真钱）→ `verify:audit`（11 新码）→ `verify:rbac` 全绿 → 三处 tsc → jest 全量（`governance/incidents` + `reconciliation` + `approvals` + `internal-transfers`）
- [ ] **Step 2: 文档收口**：
  - `modules/v1-governance.md` +「事故登记」一节（定位/状态机/审批/通报留痕/入口——plan 裁决：**进 V1 篇**，不另立新篇；治理件归治理底座）
  - `modules/v8-recon.md` §5：三处「三期」句改现状（出口 INCIDENT / 大额到线按钮 / 追索登记）
  - 财务查证手册：`UNAUTHORIZED_OUTFLOW` 行出口改「登记事故」；「客户池认损」文案行同步（Task 10 改口）
  - `modules/overview.md`：§1 模块表 V1 行提事故登记、§4 改 13 域 58 桶 + 职务独有动作表（运营/金库 +登记事故；结案裁决位 MLRO/CFO）、§5 模块根提 `governance/incidents`
  - `CHANGELOG.md` 一行；`BACKLOG.md` 销三条（§G 三期条、上报留痕待设计、B 批追索行）
  - `decisions.md` 已落（2026-09-06 四条）核对无漂移
  - 提醒业主：roadmap :461 未平差异报 VARA 行可标部分兑现、:373 卡单 72h 行不受影响（业主维护，agent 不代改）
- [ ] **Step 3: 多波收官**：合并 main 后——本波 spec + plan 移入 `doc-final/archive/`；**总纲 `2026-09-03-recon-settlement-waves-outline.md` 随之归档**（总纲第 4 行自定生命周期：活到最后一波）；三期状态格更新后一并归档
- [ ] **Step 4: 合并规程**（CLAUDE.md §10）：main 快进合并 → 重启后端 + `npm run db:base:sync` → 动过 schema → `stack.sh reset main` 整库重铺 → main 栈按 baseline 复核 18/18
- [ ] **Step 5: Commit + 归档 commit** `docs(平账三期): 收口——modules/手册/overview/CHANGELOG/BACKLOG + 多波收官归档`

**交付清单行**：每轮收尾 ｜ 多波收官（总纲归档）｜ Thread 完成规则：`Documentation updated: modules§0-5 / demo / decisions — 平账三期事故登记落地`

---

## Plan 自审记录（写毕即查）

- **Spec 覆盖**：§2 状态机→T5/6/7；§3 审批→T3/7；§4 通报→T6；§5 类型入口善后→T5/9/10/12；§6 页面→T11/12；§7 审计权限端点→T2/4/8；§8 演示→T14/15；§9 验收→T13/16；§10 不做清单由 Global Constraints 押着；附录 A→T1；附录 B→各任务交付行 + T16。无缺口。
- **占位扫描**：无 TBD；「先跑后选」的钱包位、「按实测改 baseline」均给了判定规则与先例，不是留白。
- **类型一致性**：`attachIncident(dispositionNo, incidentNo)` T5(mock)/T9(落地) 同签名；`INCIDENT_REPORT_BASES` 键名 T6 定义、T13 断言引用一致；双审批类型名 T3/T7/T13 一致；`assessmentBasis` 枚举 T1 schema / T6 dto / T10 校验一致。
