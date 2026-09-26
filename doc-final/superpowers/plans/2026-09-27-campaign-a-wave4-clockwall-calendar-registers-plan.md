# 战役甲波四 · 闹钟墙/合规日历/登记册 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地波四三件套——统一倒计时闹钟墙（只读聚合）、周期义务台账（到期自动开 GENERAL 族报送单）、两本登记册（外包商 / RI，含 RI 换人事前审批），全程零账务。

**Architecture:** 三张新 Prisma 表（obligations / vendors / responsible_individuals）＋既有 RegulatoryFiling 复用（新类型行 `PERIODIC_RETURN`，EXTERNAL 锚 + `deadlineBusinessDays: 0` → deadline=期末日）；义务 sweep 照报送单 sweep 模板（@Cron 30s、逻辑分离、逐笔 try/catch）；RI 换人审批照 `SANCTION_DISPOSITION` 先例（合规官提、高管单步批）；闹钟墙 = 只读聚合端点现场汇总两张表，不落新表。

**Tech Stack:** NestJS + Prisma(SQLite) + 既有审批引擎 / 审计 / RBAC 目录；admin-web React。

**Spec:** `doc-final/superpowers/specs/2026-09-27-campaign-a-wave4-clockwall-calendar-registers-spec.md`（含 §0 裁定台账与 §9 法定数字核对表）；总纲 `2026-09-25-campaign-a-incident-regulatory-charter.md`。

## Global Constraints（每个 task 的 prompt 必须携带）

- **项目性质**（总纲 §0/§1）：演示系统，只做演示者带同事走流程时看得到讲得到的东西；PRD 级业务规则做、技术兜底不做。
- **禁做**（项目总纲 §2 全项）：幂等｜去重｜重试回放｜补偿 repair｜并发锁｜兼容层｜权限加固｜输入防御性校验｜性能优化｜边界防御。发现技术兜底缺口 → `doc-final/PRODUCTION-NOTES.md` 追加一行放下。
- **六条铁律**：操作必留痕（每个写动作有审计码）｜门不可绕｜各管各的（跨主体只经服务方法）｜状态只能沿显式迁移表走｜钱动必过账（本波零账务，不触发）｜对外用业务键（新前缀 `OBL`/`VEN`/`RI`，UI 不暴露 UUID）。
- **依据不杜撰**：义务种子的频率/条款一律照 spec §9 核对表，表上没有的数字不许出现在代码/文档里。
- **随手闸**（每 task 改完必跑）：`npx tsc --noEmit -p tsconfig.json`；改了 admin-web 另跑 `cd admin-web && npx tsc -b --noEmit`；jest 只跑本任务相关目录，判据全绿。本仓 jest 必须在仓库根跑。
- **测试的绿必须来自行为**；禁止扫源码文本型断言。单测 mock 要行为化（mock 无视 where 会假绿——波一判例）。
- **worktree 环境**：本会话 worktree `.claude/worktrees/act-a-wave4`（分支 `worktree-act-a-wave4`），栈=self（端口在 `.stackports`，DB `/tmp/exchange_js_wt_act_a_wave4/`）。首次跑任何 prisma/jest 前先 `npm install && npx prisma generate`；e2e / demo 类脚本必须经 `bash scripts/on-stack.sh self <script>`，禁止裸跑（裸跑会漏 `DATABASE_URL`/`TB_ADDRESS`，脚本会 fail-fast）。
- **派发档位**：任务执行与任务级 review = sonnet；终审回主会话不降档。本波非高危波，评审常规档。
- 通用交付清单见 `rules/delivery-checklist.md`，全部适用；**每任务尾行已写死「本任务过清单哪几条」，执行者收尾时逐条报**。
- 本轮特有：审计码 13 枚**出生即冻结四属性**（含义/actionDomain/correlationMode/特有必填）且每次写入带显式 `requestId`（漏了被静默去重）；新审批策略必须同步 `verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 加行；rbac.catalog 改动后**必须 reset/重启 self 栈再打探针**（只 seed 不重启 = 403 假阴，SUPER_ADMIN 走内存看不出来）。
- 收尾对照 `doc-final/rules/review-rubric.md` 评审、`doc-final/rules/delivery-checklist.md` 交付（T10 引用，不重抄）。

**预期终态数量（T10 收口时逐项核对，对不上就停）**：RBAC 14→15 域、69→73 桶、77→81 组｜报送类型行 11→12｜审批类型 +1（`RI_REPLACEMENT`）｜Prisma 新表 3｜审计现役码 273→286（§T2/T5 名册合计 13 新码，以 `audit:vocab` 实跑数为准）｜场景 +2（21/22 暂编）。

---

### Task 1: 环境地基 + Prisma 三表 + PERIODIC_RETURN 类型行

**Files:**
- Modify: `prisma/schema.prisma`（三个新 model，放在 `RegulatoryFilingEntry` 之后）
- Create: `prisma/migrations/<timestamp>_wave4_compliance_office_tables/migration.sql`（`npx prisma migrate dev --name wave4_compliance_office_tables` 生成）
- Modify: `src/modules/governance/regulatory-filings/filing-type-registry.ts`（加 `PERIODIC_RETURN` 行；`anchorKind` 注释从「CNMR/PNMR 专用」改为「编排方显式外传 anchorAt（CNMR/PNMR/PERIODIC_RETURN）」）
- Modify: `src/modules/governance/regulatory-filings/filing-type-registry.spec.ts`（穷举断言随 11→12 行更新）

**Interfaces（Produces）:** Prisma models `ComplianceObligation` / `OutsourcingVendor` / `ResponsibleIndividual`；`FILING_TYPE_REGISTRY.PERIODIC_RETURN`。

- [ ] **Step 1: 环境**：`npm install && npx prisma generate`；确认 `node -v` 为 v20。
- [ ] **Step 2: schema 三表**（字段语义见 spec §3.1/§4.1/§4.2，逐列照抄）：

```prisma
model ComplianceObligation {
  id               String    @id @default(uuid())
  obligationNo     String    @unique
  name             String
  description      String?
  frequency        String    // MONTHLY | QUARTERLY | SEMIANNUAL | ANNUAL
  authority        String    // RegulatoryAuthorities 键
  basisNote        String    // 依据条款自由文本，只写 spec §9 查实条款号
  leadBusinessDays Int       @default(5)
  nextDueAt        DateTime
  status           String    @default("ACTIVE") // ACTIVE | DISABLED
  lastFilingNo     String?
  createdByUserId  String
  traceId          String
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  @@index([status])
  @@map("compliance_obligations")
}

model OutsourcingVendor {
  id                 String    @id @default(uuid())
  vendorNo           String    @unique
  name               String
  serviceDescription String
  criticality        String    // MATERIAL | NON_MATERIAL
  contractStart      DateTime
  contractEnd        DateTime?
  status             String    @default("ACTIVE") // ACTIVE | TERMINATED
  notes              String?
  createdByUserId    String
  traceId            String
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  @@index([status])
  @@map("outsourcing_vendors")
}

model ResponsibleIndividual {
  id                String    @id @default(uuid())
  riNo              String    @unique
  position          String
  incumbentName     String
  varaRef           String?
  effectiveFrom     DateTime
  status            String    @default("ACTIVE")
  pendingApprovalNo String?
  createdByUserId   String
  traceId           String
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt
  @@map("responsible_individuals")
}
```

- [ ] **Step 3: 迁移**：`npx prisma migrate dev --name wave4_compliance_office_tables`（本 worktree 自己的 DB；总纲允许假设「数据随时可重铺」，禁止写 backfill）。
- [ ] **Step 4: 类型行**（`filing-type-registry.ts`，插在 HRCA 之后）：

```ts
PERIODIC_RETURN: { direction: 'OUTBOUND', label: 'Periodic regulatory return',
  establishedBy: 'Per obligation registry (compliance_obligations.basisNote)',
  defaultAuthority: null, defaultCcAuthorities: [], defaultHours: null,
  requiresIncident: false, enabled: true, family: 'GENERAL',
  anchorKind: 'EXTERNAL', deadlineBusinessDays: 0 },
```

- [ ] **Step 5: 先跑 registry spec 看它红**（穷举断言应抓到第 12 行），再更新断言（GENERAL 族 5→6、EXTERNAL 锚集合 +PERIODIC_RETURN、`deadlineBusinessDays: 0` 合法性——断言 `computeDeadline` 经 `addBusinessDays(anchor, 0) === anchor`，已核 `regulatory-filing.service.ts:172` 守卫为 `== null`，0 不被判掉）。
- [ ] **Step 6: 闸**：`npx tsc --noEmit -p tsconfig.json` ＋ `npx jest src/modules/governance/regulatory-filings --silent` 全绿。
- [ ] **Step 7: Commit** `feat(甲波四T1): 合规办公室三表迁移+PERIODIC_RETURN类型行(11→12,EXTERNAL锚0工作日=期末即截止)`

**本任务过清单**：改 schema（迁移新增、空库能建、无 backfill）。

### Task 2: 义务主体服务（CRUD + 翻期纯函数 + 审计名册）

**Files:**
- Create: `src/modules/governance/compliance-office/compliance-obligations.service.ts`
- Create: `src/modules/governance/compliance-office/compliance-office.constants.ts`（状态迁移表 + 频率枚举 + `advanceDueDate` 纯函数）
- Create: `src/modules/governance/compliance-office/compliance-obligations.service.spec.ts`、`compliance-office.constants.spec.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（新常量组 `COMPLIANCE_OFFICE_AUDIT_ACTIONS`，照 `REG_FILING_AUDIT_ACTIONS`:998 形状注册进 `AuditActions` 与名册）

**Interfaces（Produces）:**
- `ComplianceObligationsService.create/update/setStatus(actor, dto)`、`claimDue(obligationNo, now): Promise<{ dueAt: Date; obligation }>`（翻期＋审计，**不开单**）、`recordGenerated(obligationNo, filingNo)`、`simulateDue(actor, obligationNo)`（回拨 `nextDueAt` 进生成窗）
- `advanceDueDate(due: Date, frequency: ObligationFrequency): Date`（纯函数）
- 审计码（domain GOVERNANCE）：`OBLIGATION_REGISTERED` / `OBLIGATION_UPDATED` / `OBLIGATION_STATUS_CHANGED` / `OBLIGATION_FILING_GENERATED`（requiredFields: `['dueAt','filingType']`）/ `OBLIGATION_DUE_FASTFORWARDED`

- [ ] **Step 1: 先写 `advanceDueDate` 失败测试再实现**。语义（spec §3.2）：日历月加法 +1/+3/+6/+12，**不许用 Date mutator**（act6 波五判例：`setUTCHours` 类 mutator 是 grep 照不到的边界逃逸），用 `Date.UTC` 重构造 + 目标月末钳制。必测用例：`2026-01-31 +MONTHLY → 2026-02-28`（月末钳制，防 JS 溢出到 3 月）｜`2026-11-30 +QUARTERLY → 2027-02-28`（跨年+钳制）｜`2026-03-15 +ANNUAL → 2027-03-15`（原样日）。

```ts
export function advanceDueDate(due: Date, frequency: ObligationFrequency): Date {
  const months = { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12 }[frequency];
  const y = due.getUTCFullYear(); const m = due.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const d = Math.min(due.getUTCDate(), lastDay);
  return new Date(Date.UTC(y, m, d, due.getUTCHours(), due.getUTCMinutes(), due.getUTCSeconds()));
}
```

- [ ] **Step 2: 状态迁移表**（铁律④显式）：`OBLIGATION_TRANSITIONS = { ACTIVE: ['DISABLED'], DISABLED: ['ACTIVE'] }`，服务层非法跃迁显式 `BadRequestException`；spec 断言两方向 + 同态自转拒绝。
- [ ] **Step 3: service 先测后写**。要点：单号 `generateReferenceNo('OBL')`（`src/common/utils/no-generator.util.ts`）；每方法一条审计（照 `regulatory-filing.service.ts` 的 recordAudit 私有 helper 形状，actor 走 `AuditLogsService.record`，`claimDue` 系统动作走 `recordSystem`，**每次带显式 `requestId`**；五枚新码出生即冻结四属性——含义/actionDomain/correlationMode/特有必填，`assertActionSpec` 校验得到）；`claimDue` 语义 = 读行→`nextDueAt = advanceDueDate(旧值, frequency)` 落库→审计 `OBLIGATION_FILING_GENERATED`（携旧 `dueAt`）→返回旧 dueAt 供开单（**翻期在生成时**，一期一单由构造保证——spec §3.2）；`simulateDue` 把 `nextDueAt` 拨到 `now`（挂 ⚡ 路由在 T5）。单测用行为化 Prisma mock（照 `regulatory-filing.service.spec.ts` 的 makeAccessControl/内存行模式），覆盖：CRUD 审计逐码、非法迁移 400、claimDue 翻期算对（月末例）。
- [ ] **Step 4: 闸**：根 tsc + `npx jest src/modules/governance/compliance-office --silent` 全绿；先破坏一次断言确认会红再复绿（报绿前先验红）。
- [ ] **Step 5: Commit** `feat(甲波四T2): 周期义务主体——CRUD/显式迁移表/advanceDueDate月末钳制/审计五码`

**本任务过清单**：持久状态变化写审计（显式 requestId）｜新审计码四属性冻结｜新状态显式迁移表（计时=nextDueAt 即本主体的钟，已答）｜对外业务键 OBL。

### Task 3: 到期开单联动（openForObligation + 义务 sweep）

**Files:**
- Modify: `src/modules/governance/regulatory-filings/regulatory-filing.service.ts`（新方法 `openForObligation`，照 `openForSanction`:497-540 逐行仿写）
- Create: `src/modules/governance/compliance-office/compliance-obligation-sweep.service.ts`
- Create: `src/modules/governance/compliance-office/compliance-obligation-sweep.service.spec.ts`
- Modify: `src/modules/governance/regulatory-filings/regulatory-filing.service.spec.ts`（openForObligation 用例）
- Create: `src/modules/governance/compliance-office/compliance-office.module.ts`（导入 RegulatoryFilingsModule 拿服务；在 `app.module.ts` 注册）
- Modify: `doc-final/PRODUCTION-NOTES.md`（追加一行：翻期与开单非原子，中断=该期漏单——照波三 T4 先例记账不修）

**Interfaces:**
- Consumes: `ComplianceObligationsService.claimDue/recordGenerated`（T2 签名）
- Produces: `RegulatoryFilingService.openForObligation(obligation: { obligationNo, name, authority, basisNote }, dueAt: Date): Promise<{ filingNo }>`——`type='PERIODIC_RETURN'`、`anchorAt=dueAt`（→ `deadlineAt=dueAt`）、`title` 含期别（`${name} — due ${dueAt 的 YYYY-MM-DD}`；纯日期串禁止直接 `new Date(字符串)` 反解析——客户端波判例）、`createdByUserId='SYSTEM'`、审计 `FILING_OPENED`（沿用波二既有开单码，metadata 带 `obligationNo`）
- Produces: `ComplianceObligationSweepService.sweep(now = new Date()): Promise<{ generated: number }>`

- [ ] **Step 1: openForObligation 先测后写**：断言 deadline === dueAt（EXTERNAL 锚 + 0 工作日）、type/authority/createdBy、审计 metadata 带 obligationNo。
- [ ] **Step 2: sweep 先测后写**，模板逐字照 `regulatory-filing-sweep.service.ts`（@Cron `*/30 * * * * *` 包装与 `sweep(now)` 分离、逐笔 try/catch 单笔失败不拖批次）。判据（spec §3.2）：`status='ACTIVE' && addBusinessDays(now, leadBusinessDays) >= nextDueAt`——`addBusinessDays` 从 `../regulatory-filings/business-days` 导入，**不许自写时区逻辑**（波三 T1 评审红项判例：宿主时区判周末在不同部署算出不同截止日）。命中序：`claimDue` → `openForObligation` → `recordGenerated`。测试：命中开单一次、翻期后同一 now 再跑零命中（一期一单）、DISABLED 不命中、窗外不命中、openForObligation 抛错不拖垮批次且该义务已翻期（如实断言这个已知窗口，别掩饰）。
- [ ] **Step 3: PRODUCTION-NOTES 追加一行**（格式照该文件既有行）：`- 波四义务翻期(claimDue)与开单(openForObligation)非原子：两步间进程中断=该期静默漏单(义务已翻期无单)。演示可接受；生产需 outbox/事务化。2026-09-27`
- [ ] **Step 4: 闸**：根 tsc + `npx jest src/modules/governance --silent` 全绿。
- [ ] **Step 5: Commit** `feat(甲波四T3): 义务到期sweep+openForObligation——EXTERNAL锚deadline=期末日,一期一单翻期在生成时`

**本任务过清单**：持久状态变化写审计（系统动作 recordSystem＋显式 requestId）｜技术兜底缺口登 PRODUCTION-NOTES 一行放下。

### Task 4: 登记册两本（vendor + RI 主体服务）

**Files:**
- Create: `src/modules/governance/compliance-office/outsourcing-vendors.service.ts` + `.spec.ts`
- Create: `src/modules/governance/compliance-office/responsible-individuals.service.ts` + `.spec.ts`
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`VENDOR_REGISTERED`/`VENDOR_UPDATED`/`VENDOR_TERMINATED`/`RI_SEAT_REGISTERED`/`RI_REPLACEMENT_PROPOSED`/`RI_REPLACEMENT_APPLIED`（requiredFields: `['fromIncumbent','toIncumbent']`）/`RI_REPLACEMENT_REJECTED` 七码入 T2 同一常量组）
- Modify: `compliance-office.constants.ts`（`VENDOR_TRANSITIONS = { ACTIVE: ['TERMINATED'], TERMINATED: [] }`）

**Interfaces（Produces）:**
- `OutsourcingVendorsService.register/update/terminate(actor, dto)`——单号 `generateReferenceNo('VEN')`；terminate 走显式迁移表，终态零出边
- `ResponsibleIndividualsService.createSeat(actor, dto)`（`generateReferenceNo('RI')`）、`proposeReplacement(actor, riNo, dto: { newIncumbentName, effectiveFrom, reason, varaRef? })`（写 `pendingApprovalNo`；**非空再提 → 400**）、`applyReplacement(riNo, approvalNo)`（换 incumbent/effectiveFrom/varaRef、清 pending、审计 APPLIED 携 from/to）、`clearReplacement(riNo, approvalNo, decision)`（驳回/撤/过期路径，审计 REJECTED）

- [ ] **Step 1: vendor 先测后写**（CRUD 审计逐码、`TERMINATED→*` 显式拒、无硬删）。
- [ ] **Step 2: RI 先测后写**（建席位、在途重复提 400、apply 换人三字段并清 pending、clear 只清不换人）。`proposeReplacement` 本 task 只落本表字段与审计，**不开审批单**——审批联动在 T5，接缝签名以本 task Interfaces 为准。
- [ ] **Step 3: 闸**：根 tsc + `npx jest src/modules/governance/compliance-office --silent`。
- [ ] **Step 4: Commit** `feat(甲波四T4): 登记册两本——vendor三态审计/RI席位+换人落地方法(一席一在途)`

**本任务过清单**：持久状态变化写审计（显式 requestId）｜新审计码七枚四属性冻结｜新状态显式迁移表（vendor 两态无钟、RI 无状态机变更——计时问题已答：两册不计时）｜对外业务键 VEN/RI。

### Task 5: RI 换人审批链 + 控制器 + RBAC 目录 + 闹钟墙聚合

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`ApprovalActionTypes.RI_REPLACEMENT` + 默认策略——照 `SANCTION_DISPOSITION`:82-84/408-414 两处形状：`steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }], timeoutHours: 48, allowCancel: true`）
- Modify: `src/common/events/domain-events.constants.ts`（换人 decided 事件键，照 SANCTION_DISPOSITION 条目）
- Create: `src/modules/governance/compliance-office/ri-replacement-workflow.service.ts` + `.spec.ts`（照 `src/modules/identity/customers/sanction-disposition-workflow.service.ts` 的提单/onDecided 双面结构：提单面调 `ResponsibleIndividualsService.proposeReplacement` 后开审批；`onDecided` 按 decision 分发 `applyReplacement`/`clearReplacement`——铁律③只调主体服务方法）
- Create: `src/modules/governance/compliance-office/compliance-clock-wall.service.ts` + `.spec.ts`（只读聚合：FILING 行 = `deadlineAt != null && status IN (DRAFT,PENDING_SIGNOFF,SIGNED_OFF)` ＋ `overdueMarkedAt` 非空的未提交单；OBLIGATION 行 = `status='ACTIVE'`；归一行形状照 spec §2）
- Create: `src/modules/governance/compliance-office/compliance-office.controller.ts`
- Modify: `src/modules/governance/regulatory-filings/regulatory-filings.controller.ts` + `regulatory-filing.service.ts`（⚡ `simulate-deadline-timeout`：仅墙上行集状态可拨，终态/SUBMITTED 400；回拨 `deadlineAt` 到 `now - 1h`；审计 `FILING_DEADLINE_FASTFORWARDED` 入 T2 常量组）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（四处：`PermissionGroup` 联合类型 +4 组；新域 `Compliance Office` 4 桶（照 `filings.*`:1013-1015 块形状）；`route()` 新路由集；`RBAC_ROLE_GROUP_BINDINGS`——合规官 +4 组、MLRO/高管/内审/CISO 各 +`COMPLIANCE_OFFICE_VIEW`）

**Interfaces:**
- Consumes: T2/T3/T4 全部服务签名
- Produces（路由 × 门）：

```
GET  /admin/compliance-office/clock-wall                    [COMPLIANCE_OFFICE_VIEW]
GET  /admin/compliance-obligations(+/:obligationNo)         [COMPLIANCE_OFFICE_VIEW]
POST /admin/compliance-obligations                          [OBLIGATION_WRITE]
PATCH /admin/compliance-obligations/:obligationNo           [OBLIGATION_WRITE]
POST /admin/compliance-obligations/:obligationNo/status     [OBLIGATION_WRITE]
POST /admin/compliance-obligations/:obligationNo/simulate-due        [DEMO_CLOCK_WRITE]
GET  /admin/outsourcing-vendors(+/:vendorNo)                [COMPLIANCE_OFFICE_VIEW]
POST /admin/outsourcing-vendors                             [VENDOR_REGISTER_WRITE]
PATCH /admin/outsourcing-vendors/:vendorNo                  [VENDOR_REGISTER_WRITE]
POST /admin/outsourcing-vendors/:vendorNo/terminate         [VENDOR_REGISTER_WRITE]
GET  /admin/responsible-individuals(+/:riNo)                [COMPLIANCE_OFFICE_VIEW]
POST /admin/responsible-individuals                         [RI_REGISTER_WRITE]
POST /admin/responsible-individuals/:riNo/replacement       [RI_REGISTER_WRITE]
POST /admin/regulatory-filings/:filingNo/simulate-deadline-timeout   [DEMO_CLOCK_WRITE]
```

- [ ] **Step 1: 审批常量与事件键**先落（两处形状照抄先例，注释写明「波四：合规官提、高管单步批」）。**同一 commit 内**往 `scripts/verify-rbac.ts` 的 `MAKER_GROUP_BY_POLICY` 加一行（`RI_REPLACEMENT` → maker 组 `RI_REGISTER_WRITE`）——人工维护表，S5 自批死锁闸只遍历它，表外策略不受保护（2026-09-01 调账单判例，delivery-checklist 第 6 行）。
- [ ] **Step 2: workflow 先测后写**：批准→applyReplacement、驳回/撤单/过期→clearReplacement；maker≠checker 由审批引擎保证，spec 只断言分发正确。
- [ ] **Step 3: clock-wall 先测后写**：行为化 mock 两表，断言行集判据（按时提交的单不上墙、overdue 红标位、DISABLED 义务不上墙、行含 refNo/kind/deadlineAt/overdue）。
- [ ] **Step 4: 控制器 + rbac.catalog 四处**。新域块插在 `Regulatory Filings` 域块之后；每个写路由的 controller 方法从 token 取 actor 照 `regulatory-filings.controller.ts` 既有写法。**新端点必须 route() 登记**（本仓判例：只 seed 不重启/不登记 = 403）。
- [ ] **Step 5: 闸**：根 tsc + `npx jest src/modules/governance src/modules/identity/access-control --silent`。
- [ ] **Step 6: Commit** `feat(甲波四T5): RI换人审批链(合规官提·高管单步批)+合规办公室域4桶4组+闹钟墙聚合端点+⚡两条快进+MAKER_GROUP_BY_POLICY加行`

**本任务过清单**：maker-checker 走 ApprovalsService 正门｜新审批策略入 MAKER_GROUP_BY_POLICY｜新权限组四处齐｜新 admin 端点 route() 登记｜新事件先登记 domain-events.constants.ts。

### Task 6: verify:rbac 扩判据 + audit:vocab 入库

**Files:**
- Modify: `scripts/verify-rbac.ts`
- Modify: `doc-final/reference/`（audit:vocab 输出落点按脚本既有行为）

**Interfaces:** Consumes T5 的组名/桶键/路由。

- [ ] **Step 1: 静态判据**：新域四处齐（`route()` / `ACTION_BUCKET_CATALOG` / 职务绑定三处同现，照波三 S10a/S10b 写法）；四组唯一持有断言——`OBLIGATION_WRITE`/`VENDOR_REGISTER_WRITE`/`RI_REGISTER_WRITE` 唯合规官，`COMPLIANCE_OFFICE_VIEW` 恰为 {合规官, MLRO, 高管, 内审, CISO}。
- [ ] **Step 2: 行为探针**（真端点打真 403/200，照既有 47 条探针形状）：合规官 POST obligations 200 ｜ 金库 POST obligations 403 ｜ 内审 POST vendors 403（内审零写人设不破）｜ 合规官提 RI 换人 200、重复提 400 ｜ 高管批换人经审批中心 200 ｜ 运营 GET clock-wall 403 ｜ ⚡ simulate-due 唯金库 200、合规官 403。
- [ ] **Step 3: 跑**：先 `bash scripts/stack.sh reset self`（rbac.catalog 动过——只 seed 不重启后端 = 探针打到旧内存字典 403 假阴，SUPER_ADMIN 走内存看不出来），再 `bash scripts/on-stack.sh self verify:rbac` 全绿；**先注释掉一处绑定跑一次确认探针会红**，恢复后复绿（报绿前先验红）。
- [ ] **Step 4: `bash scripts/on-stack.sh self audit:vocab`**，记录现役码终数（预期 286，若不符，先对名册再动数字）。
- [ ] **Step 5: Commit** `feat(甲波四T6): verify:rbac新域四处齐+8行为探针;audit:vocab 273→286入库`

**本任务过清单**：新权限组四处齐的机器判据｜新端点重启后端再验（reset self）。

### Task 7: 种子 + demo/data.md 同步

**Files:**
- Modify: `prisma/seed.business.ts`（照 1261 行起的报送单种子区形状，新增三区块）
- Modify: `doc-final/demo/data.md`、`doc-final/demo/baseline.md`（三表种子断言入重铺判据）
- Modify: `scripts/demo-data-md.ts`（若生成区涉及新表，按脚本既有结构扩展）

**Interfaces:** Consumes T1 模型与 T2/T4 服务（种子直写表照本仓种子惯例，单号用 `buildDeterministicNo` 保重铺幂等——照既有种子写法）。

- [ ] **Step 1: 义务种子三行**（值逐字来自 spec §7/§9，`nextDueAt` 相对当前时钟取下一自然期末，保证墙上开箱绿/黄可见）：VARA Monthly Regulatory Return（MONTHLY，authority VARA，basisNote `CRM Rulebook Part I, Rule I.H.1`）｜ VARA Quarterly Report（QUARTERLY，`Rule I.H.2`）｜ VARA Annual Report incl. audited financials（ANNUAL，`Rule I.H.3 + I.G.1`）。
- [ ] **Step 2: vendor 种子三行**：Sumsub（KYC/AML screening，MATERIAL）、HexTrust（custody，MATERIAL）、一家 NON_MATERIAL 对照（如 office-IT 供应商）。RI 席位四行：MLRO / Compliance Officer / CFO / CISO（现任人名对齐种子管理员人设，`varaRef` 用演示格式 `VARA-RI-0xx`；spec §4.2 已钉「演示合理集非法定名录」）。
- [ ] **Step 3: 重铺闸**：`bash scripts/stack.sh reset self` 从零建库全绿（动过 schema/seed 必跑——收尾闸⑧提前到本 task 首验），`demo/data.md` 生成区零 diff 或按脚本重生成后 commit（生成区 diff 是脏库探针——第七幕判例，起栈前必 reset）。
- [ ] **Step 4: baseline.md 补三表断言行**（行数与关键行值）。
- [ ] **Step 5: Commit** `feat(甲波四T7): 种子三义务/三vendor/四RI席位+data.md·baseline.md同步+重铺闸首验`

**本任务过清单**：改种子同步 data.md/script.md（生成区由 demo:all 写、不手改）｜改 schema 后重铺闸。

### Task 8: e2e 全链（真 AppModule 零 mock）

**Files:**
- Create: `test/compliance-office.e2e-spec.ts`（头部 polyfill/dotenv 三件套逐字照 `test/regulatory-filing.e2e-spec.ts:1-15`）

**Interfaces:** Consumes 全部服务真身。

- [ ] **Step 1: 用例集**（服务直调，照波二三 e2e 惯例分段）：
  ① 义务全弧：建义务（未来期）→ `simulateDue` → `sweep(now)` 直调 → 断言开出 `PERIODIC_RETURN` 单、`deadlineAt` 等于翻期前 `nextDueAt`、`createdByUserId='SYSTEM'`、义务已翻期且 `lastFilingNo` 回填 → 同一 now 再 `sweep` 零新单（一期一单）→ 工单走合规官起草→送签→高管批→标已提交→办结全弧（复用波二 workflow 服务调用形状）。
  ② 报送单 ⚡ 超时：在途 PNMR 种子单 `simulate-deadline-timeout` → `RegulatoryFilingSweepService.sweep()` 直调 → `overdueMarkedAt` 非空 + `FILING_OVERDUE_MARKED` 审计存在 → clock-wall 行 `overdue=true`。
  ③ 登记册：vendor 建/改/终止 + `TERMINATED→ACTIVE` 显式拒；RI 建席位 → 提换人 → 高管经 `ApprovalsService` 批 → incumbent 已换、pending 清空、`RI_REPLACEMENT_APPLIED` 审计携 from/to；驳回分支 pending 清空不换人；在途重复提 400。
  ④ clock-wall 行集：按时提交的单不在墙上；DISABLED 义务不在墙上。
- [ ] **Step 2: 跑**：`bash scripts/on-stack.sh self test:e2e -- --testPathPattern compliance-office`（integration spec 必经 on-stack——第七幕波二判例；若包装器传参形式不同，以 `scripts/on-stack.sh` 头部 usage 为准，波三 e2e 的实跑命令在 `checkups/2026-09-26-act-a-wave3-evidence/` 可查抄）；全绿。
- [ ] **Step 3: 波二波三既有 e2e 回归**：`regulatory-filing.e2e-spec.ts` + `aml-reporting-family.e2e-spec.ts` 复绿（本波动了共享的类型目录与 service）。
- [ ] **Step 4: Commit** `test(甲波四T8): compliance-office e2e四段全链+波二三报送e2e回归复绿`

**本任务过清单**：行为绿（真 AppModule 零 mock、integration 必经 on-stack）。

### Task 9: 前端三页（admin-web）

**Files:**
- Create: `admin-web/src/pages/ComplianceClockWallPage.tsx`、`ComplianceObligationListPage.tsx`、`ComplianceRegistersPage.tsx`（vendors/RI 两 tab）
- Modify: `admin-web/src/App.tsx`（lazy + Route 三条，照 :70-71/270-271 形状）；侧边栏导航注册（grep `governance/regulatory-filings` 找到 nav 配置文件照加一组「Compliance Office」）；`PERMISSIONS` 常量表 +4 键
- Modify: 详情跳转：clock-wall 行点击 FILING → `governance/regulatory-filings/:filingNo` 既有详情页；OBLIGATION → 义务列表定位行

**Interfaces:** Consumes T5 路由集（返回形状以 controller DTO 为准）。

- [ ] **Step 1: Clock Wall 页**：列 = 类型（Filing/Obligation 徽标）/ 单号或义务号（业务键，可点跳）/ 标题 / 受文机构 / 到期时刻 / 剩余倒计时 / 状态色徽标（绿黄红，判据照 spec §2：红=overdue，黄=剩余≤25% 或 ≤24h、义务进生成窗；阈值常量置顶可调）；「Only overdue」过滤开关。全站英文文案（平账收尾轮惯例）。
- [ ] **Step 2: Obligations 页**：列表（名/频率/机构/下次到期/最近工单号可点跳+状态）＋ 建/改/停用弹窗 ＋ ⚡ Fast-forward due（`useSimulationMode` 门控——照资金单模拟面板惯例，非模拟态不渲染）。
- [ ] **Step 2b: 报送单 ⚡ Fast-forward deadline 前端入口**（清单第 9 行：没有入口 = 功能不存在）：闹钟墙 FILING 行加 ⚡ 按钮（同门控），调 T5 的 `simulate-deadline-timeout`——场景 21 的「⚡ 报送单超时」就点它。
- [ ] **Step 3: Registers 页**：vendors tab（登记/修改/终止，终止二次确认）；RI tab（席位列表：岗位/现任/VARA ref/生效日/在途审批号链接到审批中心详情；「Propose replacement」弹窗）。UUID 不出现在任何列。
- [ ] **Step 4: 闸**：`cd admin-web && npx tsc -b --noEmit`；起 self 栈 preview 渲染三页 + 截图（闸⑤——tsc 通过不算数，UI 一致性靠渲染截图验证）；截图落盘 `doc-final/superpowers/checkups/2026-09-27-act-a-wave4-evidence/`（物证必须写明落盘路径——波五判例）。
- [ ] **Step 5: Commit** `feat(甲波四T9): 管理台三页——闹钟墙(含⚡拨deadline)/义务台账(⚡门控)/登记册两tab,权限键4枚,截图物证入档`

**本任务过清单**：新业务动作前端全有入口（含两枚 ⚡）｜UUID 不暴露｜改前端必 preview 截图（永不豁免①）。

### Task 10: 文档收口 + 场景走查 + 收尾闸

**Files:**
- Modify: `doc-final/modules/v9-regulatory-filing.md`（类型表 +PERIODIC_RETURN 行；新 §「合规日历与周期申报」§「闹钟墙」）
- Create: `doc-final/modules/compliance-office.md`（两册+闹钟墙+日历的现状篇：§0-§4 照 modules 篇目模板）
- Modify: `doc-final/modules/overview.md`（§1 V9 行提合规办公室一句；§4 权限包总数 14→15 域 69→73 桶 77→81 组 + 新域行 + 合规官/高管/MLRO/内审/CISO 行补写；技术节点 Last Verified 行）
- Modify: `doc-final/demo/script.md`（场景 21/22 暂编，动作指令逐步可实走）、`doc-final/demo/data.md`（若 T7 未收干净的行）
- Modify: `doc-final/CHANGELOG.md`（一行）
- Modify: `doc-final/superpowers/specs/2026-09-26-campaign-a-wave4-skeleton.md` → 收官时随惯例归档（合并 main 时做，本 task 先不动）
- Create: `doc-final/superpowers/specs/2026-09-27-campaign-a-wave5-skeleton.md`（波五骨架：链总纲 + 承接记录 + 已定事实 + 岔口——含外来包投诉对撞点提示，spec §10）

**Steps:**

- [ ] **Step 1: 场景 21/22 写入 script.md 并全程实走**（预铺态实走——动作指令必须真点过：场景 21 = 墙→⚡义务→工单全弧→⚡超时标红→口播升级出口；场景 22 = vendor 增改止→RI 换人审批全弧→审计链回查），四组截图入 T9 同一物证目录。
- [ ] **Step 2: 收尾闸**：三 tsc ＋ `npx jest src/modules/governance src/modules/identity --silent` ＋ `bash scripts/on-stack.sh self demo:all`（⑥，断言终态照花名册）＋ `bash scripts/stack.sh reset self` 后复跑 ⑥（⑧，动过 schema/seed 必跑，判据对照 baseline.md 全绿）。本波零账务，⑦ 不触发。
- [ ] **Step 3: 预期终态数量逐项核对**（Global Constraints 表）：域/桶/组/类型行/审批类型/审计码/新表/场景，任何一项对不上就停，找出漏改位点再收口。
- [ ] **Step 4: 对照 `doc-final/rules/delivery-checklist.md` 逐条过**；对照 spec 逐条问「这条承诺的代码在哪」（spec 承诺无 diff 是终审必逮项——判例在案）；**BACKLOG 扫一遍**：本波有无可销账行（销则划掉注明），本波新登的两行（报文表单/HRC 窗）确认在档。
- [ ] **Step 5: 波五骨架立档**（承接记录含：本波实际交付清单、偏差、悬挂项、波五岔口——投诉字段模型参考外来包评估 `checkups/2026-09-25-raymond-stage4-intake-assessment.md`、对撞点「escalate 走系统外文案 vs 升级=转事件」、场景编号定稿岔口）。
- [ ] **Step 6: Commit** `docs(甲波四T10): modules两篇+overview计数15域73桶81组+场景21/22实走+收尾闸⑥⑧全绿+波五骨架立档`

**本任务过清单**：多波承接写进波五骨架（不代写波五 spec）｜每轮收尾三件套（文档分层收口＋CHANGELOG 一行＋BACKLOG 销账）｜改页面/种子同步 demo 两文档。

---

## 终审（主会话，不降档）

T10 后回主会话终审：逐 task 抽查复现命令、spec 承诺逐条对代码、否定性结论（"零引用""不上墙"）抽查复现、数字复述 grep 清点（多处复述必漏改——act6 波四判例）、随后按需变异测试。终审红项修完才进合并流程（`superpowers:finishing-a-development-branch`）。
