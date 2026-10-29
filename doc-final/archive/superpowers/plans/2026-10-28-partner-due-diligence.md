# 甲波六 · 服务商与 LP 的背调与审批 · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「签 LP」和「登记外包服务商」两条线改成同一副骨架——业务申请（带材料上传）→ 合规逐名筛查与定档 → CFO / 高管审批 → （重大服务商）VARA 事前报备门 → ACTIVE；退役 LP 的 mock 自动筛查；存量种子按走完全流程重铺；四幕剧目可演。

**Architecture:** 新主体「尽调评估」（`DDA`，合规办公室域）同时服务两条线，筛查记录与 CISO 信息安全评估挂在它身上；新横切件「文件」（`DOC`，`src/core/documents/`）第一次把二进制存进栈的数据目录；LP / 服务商各自的 workflow 编排「申请 → 评估 → 审批 → 报备」，只调主体服务方法；报备门复用 RI 换人自动开告知单的路径，并给报送台补一条「已报送」领域事件供服务商 workflow 认领。审批引擎零改（两步策略是既有能力），RBAC 新四组、审批新三策略。

**Tech Stack:** NestJS + Prisma（SQLite）后端 ｜ multer（`@nestjs/platform-express` 自带，补 `@types/multer`）｜ React + Vite 管理台 ｜ jest（后端 + admin-web spec 共用根 jest）｜ e2e 经 `on-stack.sh self`

**Spec:** `doc-final/archive/superpowers/specs/2026-10-28-partner-due-diligence-design.md`（执行者必读；§3 骨架与硬规则、§4 / §5 字段表、§12 代码落点）

## Global Constraints

- 通用交付清单见 `doc-final/rules/delivery-checklist.md`，全部适用
- 本轮特有：**schema / 状态机直接按目标终态改**，不写 backfill、不留旧列、不留旧码别名（`screeningAnswer` / `screenedAt` / `dueDiligenceRef` 三列物理删，`lp-entity-screening.mock.ts` 物理删，退役审计码进 `DEPRECATED_AUDIT_ACTIONS`，退役路由从 `rbac.catalog.ts` 与控制器同时删）；全仓 grep 旧名零残留（排除 `doc-final/archive/`、本波 spec / plan）既是判据也是失效验证 ｜ 二进制**只**落 `FILE_STORAGE_DIR`，仓库不进任何 PDF / 图片 ｜ 管理台零 UUID：尽调评估用 `DDA…`、筛查记录用 `SCR…`、文件用 `DOC…`、实际控制人用「父单号 + seq」 ｜ 不动账本、不动资金单（本波零钱动） ｜ 审批引擎本体不改（只加策略与 handler）｜ 员工可见文案不出现 `PENDING_ASSESSMENT` 之类内部枚举——前端映射成「待评估 / 退回补料 / 待批准 / 待报备 / 生效 / 已终止 / 不通过」
- 施工在 worktree `.claude/worktrees/partner_due_diligence/`（分支 `partner-due-diligence`），新树先 `npm ci`（根 + `admin-web`）+ `npm run prisma:generate` + `bash scripts/stack.sh reset self`；闸门一律跑自己的栈（`on-stack.sh self`）；commit 中文 scope，不加署名行
- **派发分层**（CLAUDE.md §6 表 Claude Code 行）：任务执行 = `sonnet`；任务级评审 = `sonnet`，**T3 / T4 / T6 / T7 动状态机与审批 → 评审升 `opus`**；T12 终审 = `opus`；子代理一律显式写 `model`
- **收尾过哪几条**（checklist 命中行，plan 写死，T11 / T12 逐条对账）：持久状态变化→每条边一条审计、metadata 带 from/to（T3–T7）｜ 新审计码→四属性出生即冻结（T1）｜ 新状态→迁移表加边，**全部不计时**（待评估 / 退回 / 待批 / 待报备都不上闹钟墙——复审与到期已拍板另立战役）｜ maker-checker→`ApprovalsService.createAndSubmit` 正门（T4 / T6）｜ 新审批策略→`MAKER_GROUP_BY_POLICY` + `DETAIL_READ_GROUP_BY_POLICY` + `ENTITY_ROUTE_BY_ACTION` 三表同加（T1）｜ 新权限组→四处齐（T1 声明 + T2 / T4 / T6 路由）｜ 新端点→`route()` + `db:base:sync` + 重启（每个后端任务）｜ 新业务动作→前端入口（T5 / T8）｜ 退役动作→前端入口同删（T5 删 Due Diligence Ref 字段与 Entity Screening 卡；T8 删 Vendors tab 的 Register / Edit 弹层）｜ 新事件→先登记 `domain-events.constants.ts`（T1）｜ 改 schema→迁移文件（T2 / T3 / T4 / T6）｜ 改页面或种子→`script.md` 场景 22 / 36 重写 + 37–40 新增、`data.md` 手写区（T9 / T11）｜ 改了前端→截图（永不豁免①，T5 / T8 / T12）｜ 每轮收尾→CHANGELOG 一行 + BACKLOG 销 :514 与 :519 入册门半边 + §9 报告（T11）。**未触发**：动钱 / verify:coa（本波零账本写入；`demo:all` 自带的 COA 恒等式照常跑）｜ 交易三域 ｜ 客户面（全部字段只在管理台，客户端零触碰）｜ 多波承接（甲波六是终波，复审另立战役已登 BACKLOG）

## Review Focus

1. **补料重提后新增了实际控制人**：新人没有筛查记录 → 「通过并送审」必须被后端拒且前端置灰并点名缺谁（T3 `assertSendable` 测 + T4 workflow 测）
2. **重大服务商 CISO 结论「不可接受」**：合规官只剩「不通过」，送审被拒（T3 测）
3. **审批撤单**：LP / 服务商回 `PENDING_ASSESSMENT`，评估解锁可再送审，审计有 `*_APPROVAL_CANCELLED` 边（T4 / T6 workflow 测）
4. **不是本服务商的「已报送」事件**（别的告知单、终止那张单、同号但状态不是待报备）→ 不得激活（T7 测）
5. **上传非 PDF / PNG / JPG 或 > 10 MB** → 400、磁盘零落盘、无审计（T2 测）

---

### Task 1: 登记处地基——权限组 / 审批策略 / 审计码 / 领域事件一次登齐

**Files:**
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（`PermissionGroup` 联合 :9 起；`ACTION_BUCKET_CATALOG` 的 `compliance-office` 域 :1246 附近；`RBAC_ROLE_GROUP_BINDINGS` 各角色段）
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`（`ApprovalActionTypes` :97 附近、`DEFAULT_APPROVAL_POLICIES` :460 附近、`V1_APPROVAL_ACTION_TYPES` :537 附近）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（平表 :478-480 / :499-505；`COMPLIANCE_OFFICE_AUDIT_ACTIONS` :1206；`CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS` :1269；`DEPRECATED_AUDIT_ACTIONS` :1536 附近；`AuditEntityTypes` :36-45；`AuditBusinessWorkflowTypes` :153-163）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.spec.ts:185`（`DEPRECATED_AUDIT_ACTIONS` 计数 120 → 123）
- Modify: `src/common/events/domain-events.constants.ts`
- Modify: `scripts/verify-rbac.ts:254-334`（`MAKER_GROUP_BY_POLICY`）、`scripts/verify-rbac.tables.ts:66`（`DETAIL_READ_GROUP_BY_POLICY`）
- Modify: `admin-web/src/pages/ApprovalPoliciesPage.tsx:37-80`（`ACTION_TYPE_LABELS`）、`admin-web/src/pages/approvalEntityRoutes.ts:72`（`ENTITY_ROUTE_BY_ACTION`）、`admin-web/src/rbac/permissions.ts`
- Test: `src/modules/audit-logging/audit-vocabulary-closure.spec.ts`、`audit-actions.constant.spec.ts`、`admin-web/src/pages/approvalEntityRoutes.spec.ts`

**Interfaces:**
- Produces（后续任务只引用，不再声明）：
  - 权限组 `'VENDOR_APPLY' | 'VENDOR_READ' | 'DUE_DILIGENCE_WRITE' | 'INFOSEC_ASSESSMENT_WRITE'`；持有：`VENDOR_APPLY` → `OPS_OFFICER`；`VENDOR_READ` → `COMPLIANCE_OFFICER, CISO, CFO, SENIOR_MANAGEMENT_OFFICER, INTERNAL_AUDITOR, TREASURY_OFFICER, OPS_OFFICER`；`DUE_DILIGENCE_WRITE` → `COMPLIANCE_OFFICER`；`INFOSEC_ASSESSMENT_WRITE` → `CISO`；另 `LP_READ` 补给 `SENIOR_MANAGEMENT_OFFICER`
  - 桶（`compliance-office` 域）：`compliance-office.view_vendors`（`VENDOR_READ`）、`compliance-office.apply_vendor`（`VENDOR_APPLY`）、`compliance-office.due_diligence`（`DUE_DILIGENCE_WRITE`）、`compliance-office.infosec_assessment`（`INFOSEC_ASSESSMENT_WRITE`）；既有 `compliance-office.vendors` 文案改为 "Terminate outsourcing vendors"（register / update 退役）
  - `ApprovalActionTypes.LP_PROFILE_HIGH_RISK_APPROVAL | VENDOR_APPROVAL | VENDOR_MATERIAL_APPROVAL`；默认策略：`LP_PROFILE_HIGH_RISK_APPROVAL` 与 `VENDOR_MATERIAL_APPROVAL` = `steps:[{stepNo:1,roles:['CFO']},{stepNo:2,roles:['SENIOR_MANAGEMENT_OFFICER']}], timeoutHours:48, allowCancel:true`；`VENDOR_APPROVAL` = CFO 单步同形
  - 审计码（平表 + 四属性；域 / 相关模式 / 必填）：
    - `COMPLIANCE_OFFICE_AUDIT_ACTIONS` 新增：`VENDOR_APPLIED`(S, `['criticality']`) ｜ `VENDOR_RETURNED` / `VENDOR_RESUBMITTED` / `VENDOR_REJECTED` / `VENDOR_SENT_FOR_APPROVAL` / `VENDOR_APPROVED` / `VENDOR_APPROVAL_REJECTED` / `VENDOR_APPROVAL_CANCELLED` / `VENDOR_ACTIVATED`(均 N, `['fromStatus','toStatus']`) ｜ `VENDOR_MATERIALITY_UPGRADED`(N, `['reason']`) ｜ `VENDOR_NOTIFICATION_OPENED`(N, `['filingNo']`) ｜ `DD_ASSESSMENT_OPENED`(S, `['targetType']`) ｜ `DD_SCREENING_RECORDED`(I, `['result']`) ｜ `DD_ASSESSMENT_SAVED`(I, `['riskTier']`) ｜ `DD_INFOSEC_RECORDED`(I, `['verdict']`) ｜ `DD_ASSESSMENT_CONCLUDED`(I, `['conclusion']`) ｜ `DOCUMENT_UPLOADED`(N, `['docType']`)；`VENDOR_TERMINATED` 不动
    - `CAMPAIGN_B_LP_PROFILE_AUDIT_ACTIONS` 新增：`LP_PROFILE_RETURNED` / `LP_PROFILE_RESUBMITTED` / `LP_PROFILE_SENT_FOR_APPROVAL` / `LP_PROFILE_APPROVAL_CANCELLED`(均 I, `['fromStatus','toStatus']`)；`LP_PROFILE_CREATED` 必填加 `'registeredIn'`；`LP_PROFILE_REJECTED` 保留（合规不通过与审批驳回共用）
    - 退役码**不在本任务动**（closure spec ③ 要求退役码的写点先删）：`LP_PROFILE_SCREENED` 在 T4 退役、`VENDOR_REGISTERED` / `VENDOR_UPDATED` 在 T6 退役，各自同步 `DEPRECATED_AUDIT_ACTIONS` 计数（120 → 121 → 123）
    - `AuditEntityTypes` 新增 `DUE_DILIGENCE_ASSESSMENT`、`SCREENING_RECORD`、`STORED_DOCUMENT`；`AuditBusinessWorkflowTypes` 新增 `DUE_DILIGENCE`
  - `DOMAIN_EVENTS` 新增：`LP_PROFILE_DECIDED`（name `workflow.lp-profile.decided`，emitter `LpProfileApprovalService` / `LpProfileHighRiskApprovalService`，subscriber `LpProfileWorkflowService`）｜ `OUTSOURCING_VENDOR_DECIDED`（`workflow.outsourcing-vendor.decided`，emitter 两个 vendor handler，subscriber `OutsourcingVendorWorkflowService`）｜ `REGULATORY_FILING_SUBMITTED`（`regulatory-filing.submitted`，emitter `RegulatoryFilingService`，subscriber `OutsourcingVendorWorkflowService`，payload `{ filingNo, type, externalRef }`）
  - `MAKER_GROUP_BY_POLICY`：`LP_PROFILE_APPROVAL: 'DUE_DILIGENCE_WRITE'`（原 `'LP_WRITE'` 改）、`LP_PROFILE_HIGH_RISK_APPROVAL: 'DUE_DILIGENCE_WRITE'`、`VENDOR_APPROVAL: 'DUE_DILIGENCE_WRITE'`、`VENDOR_MATERIAL_APPROVAL: 'DUE_DILIGENCE_WRITE'`；`DETAIL_READ_GROUP_BY_POLICY`：LP 两条 `'LP_READ'`、vendor 两条 `'VENDOR_READ'`；`ENTITY_ROUTE_BY_ACTION`：LP 两条 `/admin/lp-profiles/${r}`、vendor 两条 `/admin/governance/compliance-office/service-providers/${r}`；`ACTION_TYPE_LABELS`：`'LP profile registration (high risk)'`、`'Service provider onboarding'`、`'Material service provider onboarding'`
  - `admin-web/src/rbac/permissions.ts` 新键（值 = 代表路由码，T2 / T4 / T6 的路由落地后才真实存在；S6 在 T10 才跑）：`VENDOR_READ: 'api.get.admin_outsourcing_vendors'`、`VENDOR_APPLY: 'api.post.admin_outsourcing_vendors'`、`VENDOR_TERMINATE: 'api.post.admin_outsourcing_vendors_vendorno_terminate'`、`DUE_DILIGENCE_WRITE: 'api.post.admin_lp_profiles_lpno_assessment_conclude'`、`INFOSEC_ASSESSMENT_WRITE: 'api.post.admin_outsourcing_vendors_vendorno_assessment_infosec'`、`LP_PROFILE_RESUBMIT: 'api.post.admin_lp_profiles_lpno_resubmit'`；`VENDOR_REGISTER_WRITE` 键留到 T8 随其唯一消费者一起删

- [x] **Step 1: 写失败测试**——`approvalEntityRoutes.spec.ts` 不改，先只往 `DETAIL_READ_GROUP_BY_POLICY` 加三条 → 跑 `npx jest admin-web/src/pages/approvalEntityRoutes --silent` 应红（键集不等），证明这道闸活着
- [x] **Step 2: 按 Interfaces 逐处登记**——四组进联合类型 + 桶 + 绑定；三策略 + 白名单；审计码两册（只增不退）+ 实体 / workflow 类型；三条事件；verify-rbac 两表；前端两表 + permissions 键
- [x] **Step 3: 跑 `npx jest src/modules/audit-logging admin-web/src/pages/approvalEntityRoutes --silent` 全绿（closure 四条 + 计数）；`npx tsc --noEmit -p tsconfig.json` 绿；`cd admin-web && npx tsc -b --noEmit` 绿**
- [x] **Step 4: Commit** `feat(尽调): 登记处地基——四权限组/三审批策略/审计码两册/三领域事件`

---

### Task 2: 文件存储横切件（`src/core/documents/`）+ 环境变量贯通

**Files:**
- Modify: `prisma/schema.prisma`（新 `model StoredDocument`）；Create: `prisma/migrations/<ts>_stored_documents/migration.sql`（`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --script` 生成后人工核对，只含 CreateTable）
- Create: `src/core/documents/documents.module.ts`、`documents.service.ts`、`documents.controller.ts`、`documents.constants.ts`、`documents.service.spec.ts`
- Modify: `src/app.module.ts`（import `DocumentsModule`）；`src/modules/identity/access-control/rbac.catalog.ts`（1 条 route）；`package.json`（devDependency `@types/multer`）
- Modify: `scripts/db-env.sh`（加 `default_file_storage_dir`）、`scripts/on-stack.sh:53`（注入 `FILE_STORAGE_DIR`）、`scripts/reset-stack.sh`（`db:biz:reset` 前 `rm -rf "${FILE_STORAGE_DIR}"` 并 mkdir；`db:seed:business` 行加 `FILE_STORAGE_DIR=`）、`scripts/stack-common.sh`（self / main 两处同源导出）、`deploy/demo.env.template`（`FILE_STORAGE_DIR=/run/exchange-demo/files`）、`scripts/reset-business-data.ts`（`storedDocument` 进 `BUSINESS_DELEGATES_FK_SAFE`，排在父表前）
- Modify: `admin-web/src/utils/adminFetch.ts:38-40`（body 是 `FormData` 时不强加 JSON Content-Type）

**Interfaces:**
- Produces:
  - `model StoredDocument { id, docNo @unique, ownerType, ownerNo, docType, originalName, mimeType, sizeBytes Int, storagePath, uploadedByUserId, uploadedAt @default(now()) @@index([ownerType, ownerNo]) @@map("stored_documents") }`
  - `DOCUMENT_OWNER_TYPES = { LIQUIDITY_PROVIDER, OUTSOURCING_VENDOR, SCREENING_RECORD } as const`；`DOCUMENT_LIMITS = { maxBytes: 10 * 1024 * 1024, mimeTypes: ['application/pdf','image/png','image/jpeg'] }`；`LP_DOC_TYPES = ['INCORPORATION_CERT','UBO_REGISTER','LICENCE_COPY','AML_POLICY','FINANCIALS','AUTHORISED_SIGNATORIES']`；`VENDOR_DOC_TYPES = ['INCORPORATION_CERT','CONTRACT','LICENCE_COPY','UBO_REGISTER','FINANCIALS','SOC2_ISO_CERT','DR_PLAN','SUBCONTRACTOR_LIST','INSURANCE']`；`SCREENING_DOC_TYPES = ['SCREENING_EVIDENCE']`
  - `DocumentsService.store(input: { ownerType: DocumentOwnerType; ownerNo: string; docType: string; file: { originalname: string; mimetype: string; size: number; buffer: Buffer } }, actor: ApprovalActorContext): Promise<{ docNo: string }>` —— `docNo = generateReferenceNo('DOC')`；落盘路径 `${FILE_STORAGE_DIR}/${ownerType}/${ownerNo}/${docNo}${ext}`；超限 / 非法 MIME 抛 `BadRequestException`（落盘前）；审计 `DOCUMENT_UPLOADED`（domain GOVERNANCE，primary subject `STORED_DOCUMENT/docNo`，subjects 另带 owner 为 RELATED，metadata `{ ownerType, ownerNo, docType, originalName, sizeBytes }`，extra `{ docType }`，`requestId` 带 docNo + uuid）
  - `DocumentsService.listByOwner(ownerType, ownerNo): Promise<StoredDocumentView[]>`，`StoredDocumentView = { docNo, docType, originalName, mimeType, sizeBytes, uploadedBy, uploadedAt }`
  - `DocumentsService.openStream(docNo): Promise<{ stream: ReadStream; mimeType: string; originalName: string }>`
  - `DocumentsService.storageDir(): string`（`process.env.FILE_STORAGE_DIR`，缺则抛——与 `DATABASE_URL` 缺失 fail-fast 同哲学）
  - 路由：`GET /admin/documents/:docNo/content`，groups `['LP_READ','VENDOR_READ']`（OR）；响应 `Content-Disposition: inline; filename="<originalName>"`
  - shell：`default_file_storage_dir <scope>` → `/tmp/exchange_js_<scope>/files`

- [x] **Step 1: 写失败测试** `documents.service.spec.ts`（内存 prisma mock + 临时目录 `fs.mkdtempSync`，`process.env.FILE_STORAGE_DIR` 指向它）：

```ts
it('store：PDF 落到 <dir>/<ownerType>/<ownerNo>/<docNo>.pdf，返回 DOC 开头单号，写 DOCUMENT_UPLOADED 审计', ...)
it('store：> 10 MB 抛 400，目录为空，审计零调用', ...)
it('store：mimetype text/plain 抛 400，目录为空', ...)
it('listByOwner 只返回该 owner 的文件且不含 storagePath / id', ...)
it('storageDir：缺 FILE_STORAGE_DIR 抛错', ...)
```

- [x] **Step 2: 跑 `npx jest src/core/documents --silent` 确认红**（模块不存在）
- [x] **Step 3: 实现** schema + 迁移 + module / service / controller（`@UseInterceptors(FileInterceptor('file'))` 只在各 owner 的上传端点用——本任务不建上传端点，只建下载端点与服务）+ `@types/multer` + rbac `route()` + `reset-business-data.ts` 登记
- [x] **Step 4: shell / 部署贯通**——`db-env.sh` 加函数；`stack-common.sh` 在算出 `STACK` 后 `export FILE_STORAGE_DIR="$(default_file_storage_dir "${STACK}")"`（main 同理）；`on-stack.sh` 的 `exec env` 行加 `FILE_STORAGE_DIR="${FILE_STORAGE_DIR}"`；`reset-stack.sh` 在 `db:biz:reset` 前 `rm -rf` + `mkdir -p`，`db:seed:business` 那行加 `FILE_STORAGE_DIR="${FILE_STORAGE_DIR}"`；`demo.env.template` 加行；`deploy/demo-run.sh` 不改（`RuntimeDirectory` 每次启动新建）
- [x] **Step 5: `adminFetch` 改法**——`if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type'))`
- [x] **Step 6: 跑 `npx jest src/core/documents --silent` 绿；后端 tsc 绿；admin tsc 绿；`bash scripts/stack.sh reset self` 走通（迁移建表 + 目录创建，`ls /tmp/exchange_js_wt_<名>/files` 存在）**
- [x] **Step 7: 失效验证**——临时把 `maxBytes` 改成 1 再跑 spec 第一条应红，还原
- [x] **Step 8: Commit** `feat(文件): 系统首个文件存储——stored_documents + FILE_STORAGE_DIR 贯通栈脚本与云端模板`

---

### Task 3: 尽调评估主体（`DDA` / `SCR`）——筛查记录、定档、CISO 评估、三条硬规则

**Files:**
- Modify: `prisma/schema.prisma`（`model DueDiligenceAssessment`、`model ScreeningRecord`）；Create: 迁移 `<ts>_due_diligence_assessments`
- Create: `src/modules/governance/compliance-office/due-diligence.service.ts`、`due-diligence.constants.ts`、`dto/due-diligence.dto.ts`、`due-diligence.service.spec.ts`
- Modify: `compliance-office.module.ts`（provider + export `DueDiligenceService`；import `DocumentsModule`）；`scripts/reset-business-data.ts`（`screeningRecord`、`dueDiligenceAssessment` 两 delegate，子表在前）

**Interfaces:**
- Consumes: T1 审计码；T2 `DocumentsService.store`（证据截图）
- Produces:
  - schema：`DueDiligenceAssessment { id, assessmentNo @unique, targetType, targetNo, riskTier?, opinion?, conditions?, conclusion?, conclusionReason?, concludedAt?, concludedByUserId?, infosecSoc2?, infosecIso27001?, infosecDataLocationOk Boolean?, infosecDrPlanOk Boolean?, infosecOpinion?, infosecVerdict?, infosecByUserId?, infosecAt?, createdByUserId, createdAt, updatedAt, screeningRecords ScreeningRecord[] @@unique([targetType, targetNo]) @@map("due_diligence_assessments") }`；`ScreeningRecord { id, recordNo @unique, assessmentId, subjectKind, subjectName, uboSeq Int?, listsChecked, result, screenedAt, evidenceDocNo?, recordedByUserId, createdAt @@map("screening_records") }`
  - 常量：`DD_TARGET_TYPES = { LIQUIDITY_PROVIDER, OUTSOURCING_VENDOR }`；`RISK_TIERS = ['LOW','MEDIUM','HIGH']`；`SCREENING_RESULTS = ['GREEN','YELLOW','RED']`；`SCREENING_LISTS = ['UN','OFAC','EU','UAE_LOCAL','PEP','ADVERSE_MEDIA']`；`SUBJECT_KINDS = ['COMPANY','BENEFICIAL_OWNER']`；`DD_CONCLUSIONS = ['RETURNED','REJECTED','SENT_FOR_APPROVAL']`；`INFOSEC_CERT_STATES = ['HAS','NONE','EXPIRED']`；`INFOSEC_VERDICTS = ['ACCEPTABLE','UNACCEPTABLE']`
  - DTO（class-validator）：`RecordScreeningDto { subjectKind; subjectName; uboSeq?; listsChecked: string[]; result; screenedAt?: string }`；`SaveAssessmentDto { riskTier; opinion; conditions? }`；`RecordInfosecDto { soc2; iso27001; dataLocationAcceptable: boolean; drPlanAcceptable: boolean; opinion; verdict }`；`ConcludeAssessmentDto { conclusion; reason?: string }`（`RETURNED` / `REJECTED` 必带 reason，服务层校验）
  - `DueDiligenceService`：
    - `open(targetType, targetNo, actor): Promise<{ assessmentNo }>`（`generateReferenceNo('DDA')`；已存在则原样返回不重开；审计 `DD_ASSESSMENT_OPENED`）
    - `getView(targetType, targetNo): Promise<DueDiligenceView | null>`，`DueDiligenceView = { assessmentNo, targetType, targetNo, riskTier, opinion, conditions, conclusion, conclusionReason, concludedAt, infosec: { soc2, iso27001, dataLocationAcceptable, drPlanAcceptable, opinion, verdict, recordedBy, recordedAt } | null, screeningRecords: ScreeningRecordView[] }`，`ScreeningRecordView = { recordNo, subjectKind, subjectName, uboSeq, listsChecked: string[], result, screenedAt, evidenceDocNo, recordedBy }`
    - `recordScreening(targetType, targetNo, dto, actor): Promise<{ recordNo }>`（`generateReferenceNo('SCR')`；审计 `DD_SCREENING_RECORDED` metadata `{ subjectKind, subjectName, uboSeq, listsChecked, result }`）
    - `attachEvidence(recordNo, file, actor): Promise<{ docNo }>`（调 `documents.store({ ownerType:'SCREENING_RECORD', ownerNo: recordNo, docType:'SCREENING_EVIDENCE', file })` 后写 `evidenceDocNo`）
    - `saveAssessment(targetType, targetNo, dto, actor)`；`recordInfosec(targetType, targetNo, dto, actor)`
    - `assertSendable(targetType, targetNo, input: { companyName: string; beneficialOwners: { seq: number; name: string }[]; requireInfosec: boolean }): Promise<void>` —— 顺序检查并抛 `BadRequestException`：① 任一记录 `RED` → `'Screening hit (RED) — only REJECT is allowed'`；② 公司名无记录或某位 UBO（按 `uboSeq`）无记录 → `'Screening missing for: <names>'`；③ `riskTier` 空 → `'Risk tier not set'`；④ `requireInfosec && !infosecVerdict` → `'Waiting for CISO information-security assessment'`；⑤ `infosecVerdict === 'UNACCEPTABLE'` → `'CISO verdict UNACCEPTABLE — only REJECT is allowed'`
    - `conclude(targetType, targetNo, dto, actor): Promise<void>`（写 conclusion / reason / concludedAt / by；审计 `DD_ASSESSMENT_CONCLUDED` metadata `{ conclusion, reason, riskTier }`；**不**自己调 `assertSendable`——由 workflow 先调，本方法只落结论）
    - `hasRed(targetType, targetNo): Promise<boolean>`（供前端 view 决定按钮，放进 `DueDiligenceView.flags = { hasRed, missingNames: string[], infosecBlocked }`——`getView` 可选传 `input` 算 flags）
  - 审计信封：domain `GOVERNANCE`，category GOVERNANCE，workflowType `DUE_DILIGENCE`，primary subject `DUE_DILIGENCE_ASSESSMENT/assessmentNo`，subjects 另带目标（`LIQUIDITY_PROVIDER` 或 `OUTSOURCING_VENDOR`）为 RELATED，`correlationId = assessmentNo`（OPENED 为 START），`requestId` 带 action + assessmentNo + uuid

- [x] **Step 1: 写失败测试** `due-diligence.service.spec.ts`（照 `outsourcing-vendors.service.spec.ts:162-215` 的 `Test.createTestingModule` + 真 `AuditLogsService` 过闸写法，prisma 用行为化内存 mock——`findUnique` 按 where 真过滤，不许无视 where）：

```ts
it('open 两次同一目标只开一份 DDA，审计 DD_ASSESSMENT_OPENED 仅一条', ...)
it('recordScreening 返回 SCR 单号，getView 列出记录且 listsChecked 为数组', ...)
it('assertSendable：有 RED 记录 → 抛含 "RED" 的 400', ...)
it('assertSendable：UBO seq 2 无记录 → 抛 "Screening missing for: <name>"', ...)
it('assertSendable：riskTier 空 → 抛 "Risk tier not set"', ...)
it('assertSendable：requireInfosec 且无 CISO 结论 → 抛 "Waiting for CISO"', ...)
it('assertSendable：CISO UNACCEPTABLE → 抛 "UNACCEPTABLE"', ...)
it('assertSendable：全绿 + 定档 + （无需 infosec）→ 不抛', ...)
it('conclude RETURNED 无 reason → 400；带 reason → 落库并审计 DD_ASSESSMENT_CONCLUDED', ...)
it('四属性过闸：每条审计都经 assertActionSpec 不抛', ...)
```

- [x] **Step 2: 跑 `npx jest src/modules/governance/compliance-office/due-diligence --silent` 确认红**
- [x] **Step 3: 实现** schema + 迁移 + 常量 + DTO + 服务 + 模块登记 + reset 清单
- [x] **Step 4: 跑该 spec 绿；后端 tsc 绿；`npx jest src/modules/audit-logging --silent`（closure ③ 此刻仍因旧写点红——记录，不算本任务红）**
- [x] **Step 5: Commit** `feat(尽调): 尽调评估主体——DDA/SCR 两表、逐名筛查、定档、CISO 评估、送审五道硬规则`

---

### Task 4: LP 线后端——申请表、状态机七边、评估编排、按档分流审批、退役 mock

**Files:**
- Modify: `prisma/schema.prisma:925-943`（`LiquidityProvider` 加列删列）；Create: 迁移 `<ts>_lp_profile_due_diligence`
- Modify: `src/modules/asset-treasury/lp-desk/dto/lp-profile.dto.ts`、`constants/lp-profile-transitions.constant.ts`、`lp-profile.service.ts`、`lp-profile-workflow.service.ts`、`lp-profile.controller.ts`、`lp-desk.module.ts`（import `ComplianceOfficeModule`、`DocumentsModule`；provider `LpProfileHighRiskApprovalService`）
- Create: `lp-profile-high-risk-approval.service.ts`
- Delete: `lp-entity-screening.mock.ts`（及 `doc-final/reference/sumsub-mock-touchpoints.md:19` 的改写放 T11）
- Modify: `src/modules/identity/access-control/rbac.catalog.ts`（LP 路由块 :508-512 附近）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`LP_PROFILE_SCREENED` 从 LP 册移入 `DEPRECATED_AUDIT_ACTIONS`）+ `audit-actions.constant.spec.ts:185`（120 → 121）
- Modify / Test: `lp-profile.service.spec.ts`、`lp-profile-workflow.service.spec.ts`、`lp-profile.controller.spec.ts`；`test/` 下若有 LP e2e（`grep -l "lp-profiles" test/*.ts`）同步
- Modify: `prisma/seed.business.ts:2188-2216`（Falcon / Dune 的 `create` 去掉三列、补新必填列——最小改动让种子能跑；完整重铺在 T9）

**Interfaces:**
- Consumes: T1 策略 / 审计码 / 事件；T2 `DocumentsService`；T3 `DueDiligenceService`
- Produces:
  - schema 变更：删 `screeningAnswer`、`screenedAt`、`dueDiligenceRef`；加 `registeredIn`、`registrationNo`、`licensingAuthority`、`licenceNo`、`beneficialOwners`（String，JSON `[{seq:number,name:string,nationality?:string}]`，默认 `'[]'`）、`tradingTypes`（String，CSV）、`expectedMonthlyVolume`（Decimal）、`volumeCurrency`、`applicationReason`、`agreementStart?`（DateTime）、`contactName`、`contactEmail`；`status @default("PENDING_ASSESSMENT")`
  - `LpProfileStatus` 六态：`PENDING_ASSESSMENT | RETURNED | PENDING_APPROVAL | ACTIVE | SUSPENDED | REJECTED`；`LP_PROFILE_TRANSITIONS`：`PENDING_ASSESSMENT:[RETURNED, REJECTED, PENDING_APPROVAL]`、`RETURNED:[PENDING_ASSESSMENT]`、`PENDING_APPROVAL:[ACTIVE, REJECTED, PENDING_ASSESSMENT]`、`ACTIVE:[SUSPENDED]`、`SUSPENDED:[ACTIVE]`、`REJECTED:[]`；`ACTION_BY_EDGE` 七条新映射：`PA->RETURNED: LP_PROFILE_RETURNED`、`RETURNED->PA: LP_PROFILE_RESUBMITTED`、`PA->REJECTED: LP_PROFILE_REJECTED`、`PA->PENDING_APPROVAL: LP_PROFILE_SENT_FOR_APPROVAL`、`PENDING_APPROVAL->PENDING_ASSESSMENT: LP_PROFILE_APPROVAL_CANCELLED`（既有四条不动）
  - `CreateLpProfileDto`：`name, registeredIn, registrationNo, licensingAuthority, licenceNo, beneficialOwners: BeneficialOwnerDto[]（{ seq, name, nationality? }，`@ValidateNested`）, tradingTypes: string[], expectedMonthlyVolume: string, volumeCurrency, applicationReason, agreementRef, agreementStart?, contactName, contactEmail`（删 `dueDiligenceRef`、`reason`——理由并入 `applicationReason`）；`ResubmitLpProfileDto = CreateLpProfileDto`
  - `LpProfileService.create(actor, dto): Promise<LiquidityProvider>`（删第三参；状态 `PENDING_ASSESSMENT`；审计只写 `LP_PROFILE_CREATED`，metadata 含 `registeredIn, licensingAuthority, tradingTypes`）；`resubmit(lpNo, actor, dto)`（仅 `RETURNED` 态可调，整行覆盖后 `transition(... PENDING_ASSESSMENT)`）；`beneficialOwnersOf(row): { seq; name }[]`（解析 JSON）；`transition` / `stampApprovalNo` 不变
  - `LpProfileWorkflowService`（构造注入 `profiles, approvals, dueDiligence: DueDiligenceService, documents: DocumentsService`）：
    - `initiateCreate(dto, actor): Promise<{ lpNo; status: 'PENDING_ASSESSMENT' }>` —— `create` → `dueDiligence.open('LIQUIDITY_PROVIDER', lpNo, actor)`；**不开审批单**
    - `resubmit(lpNo, dto, actor)`
    - `uploadDocument(lpNo, docType, file, actor): Promise<{ docNo }>`（`docType ∈ LP_DOC_TYPES`；LP 须在 `PENDING_ASSESSMENT | RETURNED`）；`listDocuments(lpNo)`
    - `getAssessment(lpNo): Promise<DueDiligenceView>`（带 flags：`companyName = row.name`，`beneficialOwners` 解析自行，`requireInfosec:false`）
    - `recordScreening(lpNo, dto, actor)` / `attachEvidence(lpNo, recordNo, file, actor)` / `saveAssessment(lpNo, dto, actor)`：先 `assertAssessable(row)`（状态 ∈ `PENDING_ASSESSMENT | RETURNED`，否则 400 `'Assessment is locked'`），再转调 DDA
    - `conclude(lpNo, dto, actor): Promise<{ lpNo; status; approvalNo?: string }>` —— `RETURNED` → `dueDiligence.conclude` + `profiles.transition(RETURNED, {}, {actor, reason})`；`REJECTED` → conclude + `transition(REJECTED)`；`SENT_FOR_APPROVAL` → `dueDiligence.assertSendable(...)` → conclude → `transition(PENDING_APPROVAL)` → `approvals.createAndSubmit({ actionType: riskTier==='HIGH' ? LP_PROFILE_HIGH_RISK_APPROVAL : LP_PROFILE_APPROVAL, entityRef: lpNo, objectSnapshot: { lpNo, name, registeredIn, licensingAuthority, riskTier, conditions, assessmentNo } }, { reason: view.opinion }, actor)` → `stampApprovalNo`
    - `onDecided(event)`（`@OnEvent(DOMAIN_EVENTS.LP_PROFILE_DECIDED.name)`，两种 actionType 同一处理）：`APPROVED` → ACTIVE；`DECLINED | EXPIRED` → REJECTED；**`CANCELLED` → `PENDING_ASSESSMENT`**（审计 `LP_PROFILE_APPROVAL_CANCELLED`，reason 取 `decisionReason ?? 'Approval cancelled'`）
  - `LpProfileHighRiskApprovalService extends ApprovalHandlerBase`（`actionType = LP_PROFILE_HIGH_RISK_APPROVAL`，`workflowType = LP_PROFILE`）
  - 路由（`rbac.catalog.ts` 与控制器同加；`@RequirePermissions(buildPermissionCode(...))` 逐条一致）：`POST /admin/lp-profiles` 改 body ｜ `POST /admin/lp-profiles/:lpNo/resubmit` [`LP_WRITE`] ｜ `POST /admin/lp-profiles/:lpNo/documents` [`LP_WRITE`]（multipart：`file` + 字段 `docType`）｜ `GET /admin/lp-profiles/:lpNo/documents` [`LP_READ`] ｜ `GET /admin/lp-profiles/:lpNo/assessment` [`LP_READ`] ｜ `POST .../assessment/screening-records` ｜ `POST .../assessment/screening-records/:recordNo/evidence`（multipart）｜ `PATCH .../assessment` ｜ `POST .../assessment/conclude`（后四条 [`DUE_DILIGENCE_WRITE`]）
  - `LpProfileView` 随新列更新（`beneficialOwners` 解析为数组；删三旧键）

- [x] **Step 1: 全量清点**：`grep -rnE "screeningAnswer|screenedAt|dueDiligenceRef|screenLpEntityName|LP_PROFILE_SCREENED|lp-entity-screening" src test prisma scripts admin-web/src doc-final --include="*.ts" --include="*.tsx" --include="*.md" | grep -v "doc-final/archive"`——预期终态：src / test / prisma / scripts / admin-web 为 **0**，`doc-final` 只剩本波 spec / plan 与 T11 要改的 `sumsub-mock-touchpoints.md:19`、`decisions.md:166`（历史裁定原文不改）
- [x] **Step 2: 写失败测试**（`lp-profile-workflow.service.spec.ts` 重写第一 describe；照既有 `new` 直构 + jest.fn 写法，DDA / documents 也 mock）：

```ts
it('initiateCreate：建档 PENDING_ASSESSMENT，开 DDA，不开审批单', ...)
it('conclude SENT_FOR_APPROVAL：LOW 档开 LP_PROFILE_APPROVAL；HIGH 档开 LP_PROFILE_HIGH_RISK_APPROVAL；调用顺序 assertSendable → conclude → transition → createAndSubmit → stampApprovalNo', ...)
it('conclude SENT_FOR_APPROVAL：assertSendable 抛 → 不落结论、不迁状态、不开单', ...)
it('conclude RETURNED：迁 RETURNED 带 reason；resubmit 后回 PENDING_ASSESSMENT', ...)
it('recordScreening 在 PENDING_APPROVAL 态 → 400 Assessment is locked', ...)
it('onDecided CANCELLED → PENDING_ASSESSMENT，再次 conclude 可送审', ...)
it('onDecided APPROVED（HIGH_RISK 类型）→ ACTIVE', ...)
// lp-profile.service.spec.ts：
it('transition 七条新边各写对应审计码且 metadata 带 from/to；非法边抛 Illegal LP profile status transition', ...)
it('create 不再写 LP_PROFILE_SCREENED；LP_PROFILE_CREATED 过四属性闸（registeredIn 必填）', ...)
```

- [x] **Step 3: 跑 `npx jest src/modules/asset-treasury/lp-desk --silent` 确认红**
- [x] **Step 4: 实现**——schema + 迁移（`ALTER TABLE` 加列 / 删列：SQLite 删列用 `prisma migrate diff` 生成的表重建脚本）；DTO；迁移表 + `ACTION_BY_EDGE`；服务；workflow；handler；控制器（multipart 端点 `@UseInterceptors(FileInterceptor('file'))` + `@UploadedFile() file: Express.Multer.File` + `@Body('docType')`）；模块；rbac 路由；删 mock 文件；种子最小改
- [x] **Step 5: 跑 Step 1 的 grep 核对终态；`npx jest src/modules/asset-treasury/lp-desk src/modules/audit-logging --silent` 全绿（`LP_PROFILE_SCREENED` 写点已删、已退役、计数 121）；后端 tsc 绿**
- [x] **Step 6: `bash scripts/stack.sh reset self` 走通；`bash scripts/on-stack.sh self test:e2e -- --testPathPattern lp` 若存在则绿**
- [x] **Step 7: Commit** `feat(LP): 申请表扩成尽调申请、六态七边、合规评估编排、按风险档分流审批、退役 mock 自动筛查`

---

### Task 5: LP 线前端——申请页、详情三块、共用尽调组件

**Files:**
- Create: `admin-web/src/pages/LpProfileApplyPage.tsx`（路由 `lp-profiles/new` 与 `lp-profiles/:lpNo/resubmit`，权限 `LP_PROFILE_CREATE` / `LP_PROFILE_RESUBMIT`）
- Create: `admin-web/src/components/compliance/DueDiligencePanel.tsx`、`DocumentsCard.tsx`、`UploadButton.tsx`、`partnerStatusMap.ts`（`admin-web/src/utils/`）
- Modify: `admin-web/src/pages/LpProfileList.tsx`（删 Register 弹层 → 按钮跳 `/admin/lp-profiles/new`；列加 Status 筛选下拉；状态列用 `partnerStatusMap`）、`LpProfileDetail.tsx`（删 `Entity Screening` 卡 :405；加 `DocumentsCard`、`DueDiligencePanel`、Approval 链接保留；`RETURNED` 态显示「Edit & resubmit」跳 resubmit 页；`Detail` 接口随 T4 `LpProfileView`）
- Modify: `admin-web/src/App.tsx`（两条新路由）、`admin-web/src/rbac/permissions.ts`（T1 已加键）

**Interfaces:**
- Consumes: T4 全部 LP 端点；T2 下载端点
- Produces（T8 复用，签名钉死）：
  - `DueDiligencePanel({ kind: 'LP' | 'VENDOR'; targetNo: string; basePath: string /* '/admin/lp-profiles' | '/admin/outsourcing-vendors' */; assessment: DueDiligenceView | null; locked: boolean; canWrite: boolean; canWriteInfosec: boolean; requireInfosec: boolean; onChanged: () => void })` —— 渲染：筛查记录表（Subject / Lists / Result 色点 / Evidence 链接 / Screened at）+ 「Add screening record」表单（subjectKind 下拉、UBO 按 seq 下拉、lists 多选、result 三选、evidence 文件）+ 评估表单（riskTier / opinion / conditions，Save）+ CISO 区（仅 `requireInfosec`）+ 三按钮：Return（弹原因）/ Reject（弹原因）/ **Send for approval**（`assessment.flags.hasRed || infosecBlocked` 时整个不渲染；`missingNames.length>0` 或无 riskTier 或 `requireInfosec && !infosec` 时 disabled + title 说明缺什么）；`locked` 时全部只读
  - `DocumentsCard({ ownerKind: 'LP' | 'VENDOR'; ownerNo: string; basePath: string; docTypes: { code: string; label: string }[]; documents: StoredDocumentView[]; canUpload: boolean; onChanged: () => void })`（每行 原名 / 类别 / 大小 / 上传人时间 / 「Open」= `GET /admin/documents/:docNo/content` 新窗）
  - `UploadButton({ url: string; fields: Record<string,string>; accept: string; label: string; onDone: (docNo: string) => void })`（`FormData` + `adminFetch`）
  - `partnerStatusMap.ts`：`PARTNER_STATUS_META: Record<string, { label: string; badgeClass: string }>`，键 `PENDING_ASSESSMENT→'Pending assessment'`、`RETURNED→'Returned for documents'`、`PENDING_APPROVAL→'Pending approval'`、`PENDING_NOTIFICATION→'Pending VARA notification'`、`ACTIVE→'Active'`、`SUSPENDED→'Suspended'`、`REJECTED→'Rejected'`、`TERMINATED→'Terminated'`；`LP_DOC_TYPE_LABELS`、`VENDOR_DOC_TYPE_LABELS`、`SCREENING_LIST_LABELS`、`RISK_TIER_LABELS`
  - 申请页：按 spec §4.1 分三组渲染；UBO 为可增删行（seq 自动编号）；六个文件槽（各一个 `UploadButton`，提交成功拿到 lpNo 后逐槽上传，全部完成后跳详情）；resubmit 模式预填 + 文件槽显示已有文件

- [x] **Step 1: 实现四个共用件 + 申请页 + 列表 / 详情改造**（照 `DetailCard` / `InfoField` / `SidebarGroup` 既有 props；按钮样式 `adminButtonClass`）
- [x] **Step 2: `cd admin-web && npx tsc -b --noEmit` 绿；`npx jest admin-web/src --silent` 绿（`module-parity.spec` 不涉本页）**
- [x] **Step 3: preview 渲染验证**（self 栈，`stack.sh up`；treasury 号登录）：① `/admin/lp-profiles/new` 填表 + 传 2 个 PDF → 详情页 Documents 两行、状态 Pending assessment；② 切合规官号：记公司 GREEN + UBO#1 RED → Send 按钮消失、Reject 可点；再记一家全绿 + 定档 LOW → Send 可点 → 审批中心出现 `LP_PROFILE_APPROVAL`；③ CFO 批 → 详情 Active。**三张截图**落 `doc-final/superpowers/plans/artifacts/2026-10-28-partner-due-diligence/lp-*.png`
- [x] **Step 4: Commit** `feat(LP·前端): 尽调申请页、详情三块（材料/合规评估/审批）、共用尽调面板与文件卡`

---

### Task 6: 服务商线后端——运营申请、重大性判定、六态九边、workflow 编排、按重大性分流

**Files:**
- Modify: `prisma/schema.prisma:1967-1984`；Create: 迁移 `<ts>_vendor_due_diligence`
- Modify: `src/modules/governance/compliance-office/compliance-office.constants.ts:56-63`、`dto/compliance-office.dto.ts:41-62`、`outsourcing-vendors.service.ts`、`compliance-office.controller.ts:110-145`、`compliance-office.module.ts`
- Create: `outsourcing-vendor-workflow.service.ts`、`outsourcing-vendor-approval.service.ts`（两个 handler 类同文件）、`outsourcing-vendor-workflow.service.spec.ts`
- Modify: `rbac.catalog.ts:637-641`（vendor 路由块重写）；`outsourcing-vendors.service.spec.ts`、`test/compliance-office.e2e-spec.ts:232-253`（vendor 用例按新流程重写）
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`（`VENDOR_REGISTERED` / `VENDOR_UPDATED` 移入 `DEPRECATED_AUDIT_ACTIONS`）+ `audit-actions.constant.spec.ts:185`（121 → 123）
- Modify: `prisma/seed.business.ts:1714-1773`（三家种子补新必填列、状态 ACTIVE 不变——最小改，T9 重铺）

**Interfaces:**
- Consumes: T1 / T2 / T3
- Produces:
  - schema 加列：`registeredIn, registrationNo, deliveryLocations（CSV）, contactName, contactEmail, beneficialOwners（JSON String, 默认 '[]'）, licensingAuthority?, licenceNo?, regulatedFunction Boolean, involvesPersonalData Boolean, involvesConfidentialInfo Boolean, annualFee Decimal?, feeCurrency?, subcontracts Boolean @default(false), subcontractorNames?, applicationReason, impactLicence Boolean, impactLegal Boolean, impactFinancial Boolean, impactContinuity Boolean, replaceability（'EASY'|'HARD'）, criticalityReason?（升档理由）, approvalNo?, notificationFilingNo?`；`status @default("PENDING_ASSESSMENT")`；`criticality` 保留
  - `VendorStatus` 七态：`PENDING_ASSESSMENT | RETURNED | PENDING_APPROVAL | PENDING_NOTIFICATION | ACTIVE | REJECTED | TERMINATED`；`VENDOR_TRANSITIONS`：`PENDING_ASSESSMENT:[RETURNED, REJECTED, PENDING_APPROVAL]`、`RETURNED:[PENDING_ASSESSMENT]`、`PENDING_APPROVAL:[ACTIVE, PENDING_NOTIFICATION, REJECTED, PENDING_ASSESSMENT]`、`PENDING_NOTIFICATION:[ACTIVE]`、`ACTIVE:[TERMINATED]`、`REJECTED:[]`、`TERMINATED:[]`；`VENDOR_ACTION_BY_EDGE`（新建，形如 LP 的 `ACTION_BY_EDGE`）：`PA->RETURNED: VENDOR_RETURNED`、`RETURNED->PA: VENDOR_RESUBMITTED`、`PA->REJECTED: VENDOR_REJECTED`、`PA->PENDING_APPROVAL: VENDOR_SENT_FOR_APPROVAL`、`PENDING_APPROVAL->ACTIVE: VENDOR_APPROVED`、`PENDING_APPROVAL->PENDING_NOTIFICATION: VENDOR_APPROVED`、`PENDING_APPROVAL->REJECTED: VENDOR_APPROVAL_REJECTED`、`PENDING_APPROVAL->PENDING_ASSESSMENT: VENDOR_APPROVAL_CANCELLED`、`PENDING_NOTIFICATION->ACTIVE: VENDOR_ACTIVATED`、`ACTIVE->TERMINATED: VENDOR_TERMINATED`
  - `judgeCriticality(a: { impactLicence; impactLegal; impactFinancial; impactContinuity }): 'MATERIAL' | 'NON_MATERIAL'`（纯函数，任一 true → MATERIAL；放 constants）
  - DTO：`ApplyVendorBodyDto`（spec §5.1 全字段，`beneficialOwners: BeneficialOwnerDto[]`，`regulatedFunction=true` 时 `licensingAuthority`/`licenceNo` 必填——服务层校验）；`ResubmitVendorBodyDto = ApplyVendorBodyDto`；`UpgradeMaterialityDto { reason }`；删 `CreateVendorBodyDto` / `UpdateVendorBodyDto`；`TerminateVendorBodyDto` 不动
  - `OutsourcingVendorsService`：`apply(actor, dto): Promise<{ vendorNo }>`（`criticality = judgeCriticality(dto)`，状态 `PENDING_ASSESSMENT`，审计 `VENDOR_APPLIED` extra `{ criticality }`）；`resubmit(vendorNo, actor, dto)`（仅 `RETURNED`，整行覆盖，重算 criticality，不得降档——若原 MATERIAL 则保持）；`transition(vendorNo, to, patch, audit?)`（照 LP 的 `transition` 形状，经 `VENDOR_TRANSITIONS` + `VENDOR_ACTION_BY_EDGE` 完整性闸）；`upgradeMateriality(vendorNo, actor, reason)`（仅 `NON_MATERIAL → MATERIAL`，审计 `VENDOR_MATERIALITY_UPGRADED`）；`stampApprovalNo` / `stampNotificationFilingNo(vendorNo, filingNo)`；`findByNotificationFilingNo(filingNo)`；`beneficialOwnersOf(row)`；`assertActiveByNo` / `findByNo` / `list` / `getView` 不动（`getView` 随新列扩展）；**删** `register` / `update` / `terminate` 的直接实现改为 `terminate` 走 `transition`（审计码 `VENDOR_TERMINATED` 不变，`compliance-office.e2e-spec.ts:249` 的 `/Invalid vendor transition/` 断言改为新的通用非法边文案 `'Illegal vendor status transition'`）
  - `OutsourcingVendorWorkflowService`（注入 `vendors, approvals, dueDiligence, documents, filings: RegulatoryFilingService`）：`apply(dto, actor)` → `vendors.apply` + `dueDiligence.open('OUTSOURCING_VENDOR', vendorNo, actor)`；`resubmit`；`uploadDocument(vendorNo, docType, file, actor)`（`docType ∈ VENDOR_DOC_TYPES`）；`listDocuments`；`getAssessment(vendorNo)`（flags 以 `requireInfosec = criticality==='MATERIAL'`）；`recordScreening` / `attachEvidence` / `saveAssessment` / `recordInfosec` / `upgradeMateriality`（均 `assertAssessable`）；`conclude(vendorNo, dto, actor)`（同 LP；送审时 `actionType = criticality==='MATERIAL' ? VENDOR_MATERIAL_APPROVAL : VENDOR_APPROVAL`，snapshot `{ vendorNo, name, serviceDescription, criticality, deliveryLocations, riskTier, assessmentNo }`）；`onDecided(event)`（`@OnEvent(DOMAIN_EVENTS.OUTSOURCING_VENDOR_DECIDED.name)`）：`APPROVED` → `NON_MATERIAL` 则 `ACTIVE`；`MATERIAL` 则 `PENDING_NOTIFICATION`（**报备开单在 T7 接上**）；`DECLINED|EXPIRED` → `REJECTED`；`CANCELLED` → `PENDING_ASSESSMENT`；`terminate(vendorNo, dto, actor)` → `vendors.terminate`（T7 加开单）
  - `OutsourcingVendorApprovalService` / `OutsourcingVendorMaterialApprovalService extends ApprovalHandlerBase`（workflowType `OUTSOURCING_VENDOR`）
  - 路由（控制器 + `rbac.catalog.ts` 重写 vendor 块）：`GET /admin/outsourcing-vendors`、`GET /:vendorNo`、`GET /:vendorNo/documents`、`GET /:vendorNo/assessment` [`VENDOR_READ`] ｜ `POST /admin/outsourcing-vendors`（apply）、`POST /:vendorNo/resubmit`、`POST /:vendorNo/documents` [`VENDOR_APPLY`] ｜ `POST /:vendorNo/assessment/screening-records`、`POST .../screening-records/:recordNo/evidence`、`PATCH /:vendorNo/assessment`、`POST /:vendorNo/assessment/conclude`、`POST /:vendorNo/assessment/upgrade-materiality` [`DUE_DILIGENCE_WRITE`] ｜ `POST /:vendorNo/assessment/infosec` [`INFOSEC_ASSESSMENT_WRITE`] ｜ `POST /:vendorNo/terminate` [`VENDOR_REGISTER_WRITE`]；**删** `PATCH /:vendorNo`

- [x] **Step 1: 清点**：`grep -rnE "VENDOR_REGISTERED|VENDOR_UPDATED|CreateVendorBodyDto|UpdateVendorBodyDto|vendors\.register\(|vendors\.update\(" src test prisma scripts admin-web/src | grep -v spec` 记清单，预期终态 0（admin-web 的消费者 T8 删，本任务后端侧归零）
- [x] **Step 2: 写失败测试** `outsourcing-vendor-workflow.service.spec.ts`（照 LP workflow spec 写法）：

```ts
it('apply：四问任一「会」→ MATERIAL；全「不会」→ NON_MATERIAL；状态 PENDING_ASSESSMENT；开 DDA', ...)
it('resubmit：原 MATERIAL 改答全「不会」仍 MATERIAL（不得降档）', ...)
it('upgradeMateriality：NON_MATERIAL→MATERIAL 带 reason 审计；MATERIAL 再升 → 400', ...)
it('conclude 送审：NON_MATERIAL 开 VENDOR_APPROVAL；MATERIAL 开 VENDOR_MATERIAL_APPROVAL；assertSendable 入参 requireInfosec 随档', ...)
it('onDecided APPROVED：NON_MATERIAL→ACTIVE；MATERIAL→PENDING_NOTIFICATION', ...)
it('onDecided CANCELLED→PENDING_ASSESSMENT；DECLINED→REJECTED', ...)
it('recordInfosec 在 PENDING_APPROVAL 态 → 400 locked', ...)
// outsourcing-vendors.service.spec.ts 重写：
it('transition 九条边各写对应审计码并带 from/to；ACTIVE→PENDING_ASSESSMENT 抛 Illegal vendor status transition', ...)
it('assertActiveByNo：PENDING_NOTIFICATION 抛 400（付款门）', ...)
```

- [x] **Step 3: 跑 `npx jest src/modules/governance/compliance-office --silent` 确认红**
- [x] **Step 4: 实现**（schema / 迁移 / 常量 / DTO / 服务 / workflow / handlers / 控制器 / 模块 / rbac / 种子最小改 / e2e 重写）
- [x] **Step 5: 跑 compliance-office 单测 + `src/modules/audit-logging` 全绿（两退役码写点已删、计数 123）；后端 tsc 绿；`stack.sh reset self` 走通；`on-stack.sh self test:e2e -- --testPathPattern compliance-office` 绿**
- [x] **Step 6: Commit** `feat(服务商): 运营申请+重大性判定、七态九边、尽调编排、按重大性分流审批、退役合规直接登记`

---

### Task 7: VARA 报备门——告知单自动开出、「已报送」事件、服务商认领转 ACTIVE、终止联动

**Files:**
- Modify: `src/modules/governance/regulatory-filings/regulatory-filing.service.ts`（新方法 `openForVendorNotification`；`markSubmitted` :360-395 末尾 emit 事件；构造器注入 `EventEmitter2`）
- Modify: `src/modules/governance/compliance-office/outsourcing-vendor-workflow.service.ts`（`onDecided` MATERIAL 分支接开单 + 盖章；`onFilingSubmitted`；`terminate` 联动）
- Test: `regulatory-filing.service.spec.ts`、`outsourcing-vendor-workflow.service.spec.ts`

**Interfaces:**
- Consumes: T1 `DOMAIN_EVENTS.REGULATORY_FILING_SUBMITTED`；T6 workflow / service
- Produces:
  - `RegulatoryFilingService.openForVendorNotification(input: { vendorNo; vendorName; serviceDescription; deliveryLocations: string[]; criticality: 'MATERIAL'; contractStart: string; approvalNo?: string; reason: 'ONBOARDING' | 'TERMINATION' }): Promise<{ filingNo }>` —— 类型 `'MATERIAL_CHANGE_NOTIFICATION'`，DRAFT，`createdByUserId:'SYSTEM'`，title `Material outsourcing — ${vendorName}: ${reason==='ONBOARDING'?'onboarding':'termination'}`，`body` 预填五行（Provider / Scope / Delivery & data locations / Materiality / Contract start）；审计 `FILING_OPENED` metadata `{ source: reason==='ONBOARDING' ? 'VENDOR_ONBOARDING' : 'VENDOR_TERMINATION', vendorNo, approvalNo }`
  - `markSubmitted` 在审计之后 `this.eventEmitter.emit(DOMAIN_EVENTS.REGULATORY_FILING_SUBMITTED.name, { filingNo, type: row.type, externalRef })`
  - workflow：`onDecided` APPROVED + MATERIAL → `transition(PENDING_NOTIFICATION)` → `filings.openForVendorNotification({..., approvalNo, reason:'ONBOARDING'})` → `vendors.stampNotificationFilingNo` → 审计 `VENDOR_NOTIFICATION_OPENED`（metadata / extra `{ filingNo }`，由 `stampNotificationFilingNo` 内写）；`onFilingSubmitted(event)`（`@OnEvent(DOMAIN_EVENTS.REGULATORY_FILING_SUBMITTED.name, { async: true })`）：`vendors.findByNotificationFilingNo(event.filingNo)`，命中且状态 `PENDING_NOTIFICATION` → `transition(ACTIVE, {}, { causationId: event.filingNo })`，否则无动作；`terminate`：`vendors.terminate` 后若 `criticality==='MATERIAL'` → `openForVendorNotification({..., reason:'TERMINATION'})`（**不**盖 `notificationFilingNo`，不等它）

- [x] **Step 1: 写失败测试**：

```ts
// regulatory-filing.service.spec.ts
it('openForVendorNotification：DRAFT、SYSTEM 源、标题含服务商名与 onboarding、body 五行、FILING_OPENED metadata source=VENDOR_ONBOARDING', ...)
it('markSubmitted 成功后 emit regulatory-filing.submitted {filingNo,type,externalRef}；缺 externalRef 抛 400 且零 emit', ...)
// outsourcing-vendor-workflow.service.spec.ts 追加
it('onDecided APPROVED + MATERIAL：PENDING_NOTIFICATION → openForVendorNotification(reason ONBOARDING, approvalNo) → stampNotificationFilingNo，顺序断言', ...)
it('onFilingSubmitted：filingNo 匹配且 PENDING_NOTIFICATION → ACTIVE（VENDOR_ACTIVATED）', ...)
it('onFilingSubmitted：filingNo 不匹配 / 匹配但状态 ACTIVE / 终止那张单 → 零 transition', ...)
it('terminate MATERIAL：TERMINATED 后开 reason=TERMINATION 告知单，不盖章；NON_MATERIAL 不开单', ...)
```

- [x] **Step 2: 确认红 → 实现 → `npx jest src/modules/governance --silent` 全绿；后端 tsc 绿**
- [x] **Step 3: 栈级验证**（self 栈）：用 e2e 或 `scripts/` 临时脚本走「申请 MATERIAL → 评估 + CISO → 送审 → CFO 批 → 高管批 → 报送台出现 DRAFT 告知单 → signoff → 审批 → mark-submitted → 服务商 ACTIVE」，断言 `outsourcing_vendors.status` 与 `audit_log_events` 序列；把该脚本固化成 `test/vendor-onboarding.e2e-spec.ts`（照 `compliance-office.e2e-spec.ts` 写法，`waitUntil` 等事件）
- [x] **Step 4: Commit** `feat(报备门): 重大服务商批后自动开告知单、报送台发「已报送」事件、服务商认领转 ACTIVE、终止联动`

---

### Task 8: 服务商前端——Service Providers 独立页、申请页、详情页、侧栏、付款单下拉置灰

**Files:**
- Create: `admin-web/src/pages/ServiceProvidersPage.tsx`（列表 + 筛选 + Apply 按钮）、`ServiceProviderApplyPage.tsx`（申请 / 重提）、`ServiceProviderDetailPage.tsx`
- Modify: `admin-web/src/pages/ComplianceRegistersPage.tsx`（删 `VendorsTab` / `VendorModal` / `TerminateVendorModal` / `VendorItem`；`TABS` 只剩 `ri`，`?tab=` 参数逻辑简化或删）、`admin-web/src/components/DashboardLayout.tsx:434-455`（Compliance Office 组加 `{ path:'/admin/governance/compliance-office/service-providers', label:'Service Providers', requiredPermissions:[PERMISSIONS.VENDOR_READ] }`，放 Registers 之前）、`admin-web/src/App.tsx`（三条路由：列表 `VENDOR_READ`、`service-providers/new` 与 `/:vendorNo/resubmit` `VENDOR_APPLY`、`/:vendorNo` `VENDOR_READ`）、`admin-web/src/pages/VendorPaymentList.tsx:81-87`（不再过滤；下拉 `<option disabled>` 非 ACTIVE 并后缀 `— ${PARTNER_STATUS_META[status].label}`）、`admin-web/src/rbac/permissions.ts`（删 `VENDOR_REGISTER_WRITE` 键）
- Test: `admin-web/src/pages/approvalEntityRoutes.spec.ts`（已绿）

**Interfaces:**
- Consumes: T5 `DueDiligencePanel` / `DocumentsCard` / `UploadButton` / `partnerStatusMap`；T6 / T7 端点
- Produces: 详情页区块：Application（§5.1 三组字段，重大性四问以 ✓/✗ 列出 + 系统判定徽章 + 升档理由）/ Documents / Due diligence（`requireInfosec = criticality==='MATERIAL'`，`canWriteInfosec = hasPermission(INFOSEC_ASSESSMENT_WRITE)`）/ Approval（`approvalNo` 链审批中心）/ VARA notification（`notificationFilingNo` 链报送台详情；`PENDING_NOTIFICATION` 态横幅「Waiting for VARA notification to be submitted」）/ Lifecycle 侧栏 + Terminate 按钮（`VENDOR_TERMINATE`）/ `RETURNED` 态「Edit & resubmit」；合规官在评估区多一个「Upgrade to MATERIAL」（仅 NON_MATERIAL，弹理由）

- [x] **Step 1: 实现三页 + 删旧 tab + 侧栏 + 路由 + 付款单下拉**
- [x] **Step 2: `cd admin-web && npx tsc -b --noEmit` 绿；`npx jest admin-web/src --silent` 绿；`grep -rn "VENDOR_REGISTER_WRITE\|VendorModal" admin-web/src` 为 0**
- [x] **Step 3: preview 渲染验证**（self 栈）：① 运营号：侧栏 Compliance Office 组只露 Service Providers；申请页四问答一个「会」→ 提交后详情显示 MATERIAL 徽章且无降档入口；② 合规官号：评估区 Send 置灰 title 显示「Waiting for CISO」；③ CISO 号：填 infosec → 合规官 Send 可点；④ CFO 批 → 高管批 → 详情横幅待报备；金库号付款单下拉里该服务商置灰带「Pending VARA notification」；⑤ 合规官在报送台走到 SUBMITTED → 详情 Active，下拉可选。**五张截图**落 artifacts 目录 `vendor-*.png`
- [x] **Step 4: Commit** `feat(服务商·前端): Service Providers 独立页（申请/详情/评估/报备）、Registers 只剩 RI、付款单下拉置灰非生效服务商`

---

### Task 9: 种子重铺——存量五家走完全流程 + 两家新种子 + 占位 PDF + data.md 手写区

**Files:**
- Modify: `prisma/seed.business.ts`（`seedOutsourcingVendors` :1744-1773 重写；`seedLpDesk` :2149-2260 的 LP 段重写；新函数 `seedPartnerDueDiligence` 在两者之后、`seedCompanyFunding` 之前调用）
- Modify: `prisma/seed-audit.helper.ts`（若 `SeedAuditInput` 缺 subjects 多主体写法则补；否则不动）
- Modify: `doc-final/demo/data.md`（手写区 :170-172 服务商表、:211-212 LP 表、新增「尽调评估 / 筛查记录 / 文件」小节；生成区不手改）
- Test: `scripts/verify-demo-data.ts`（若其断言表数或种子名单，同步）

**Interfaces:**
- Consumes: T2–T7 全部表与服务常量（种子直铺 prisma，不走服务；审计用 `writeSeedAudit`）；用户号常量：`COMPLIANCE_USER_NO='ADM2501010006'`、`CISO_USER_NO='ADM2501010003'`、`SMO_USER_NO='ADM2501010002'`、`OPS_USER_NO='ADM2501010008'`、`CFO_USER_NO='ADM2501010010'`、`TREASURY_USER_NO='ADM2501010011'`（`seed.base.ts:27-48`）
- Produces（单号 `buildDeterministicNo`，seedKey 写死）：
  - Falcon（ACTIVE，LOW）/ Dune（SUSPENDED，MEDIUM）：新必填列按 spec §4.1 填合理值（Falcon 注册地 UAE-DIFC、发牌 DFSA；Dune 注册地 UAE-DMCC、发牌 VARA）；各 1 位 UBO；DDA + 2 条 GREEN 筛查记录（UN,OFAC,EU,UAE_LOCAL,PEP,ADVERSE_MEDIA）+ 结论 SENT_FOR_APPROVAL；六份占位 PDF（`docType` 各一）；既有 CFO 审批单保留 / Dune 补一张 APPROVED 单；审计序列 `LP_PROFILE_CREATED → DD_ASSESSMENT_OPENED → DD_SCREENING_RECORDED×2 → DD_ASSESSMENT_SAVED → DD_ASSESSMENT_CONCLUDED → LP_PROFILE_SENT_FOR_APPROVAL → LP_PROFILE_APPROVED`（Dune 再 `LP_PROFILE_SUSPENDED`）
  - Sumsub / HexTrust（MATERIAL, ACTIVE）：四问各 2 个 true，`replaceability HARD`，交付地 `GB`/`HK`，涉个人数据 true；DDA + 2 条 GREEN + infosec（HAS/HAS/true/true/ACCEPTABLE）+ 结论；材料：INCORPORATION_CERT、CONTRACT、SOC2_ISO_CERT、DR_PLAN 占位 PDF；两步审批单 APPROVED（CFO step1 + SMO step2）；一张 `MATERIAL_CHANGE_NOTIFICATION` 报送单 `SUBMITTED`（externalRef `VARA-MCN-2026-0xx`），`notificationFilingNo` 盖上；审计序列含 `VENDOR_NOTIFICATION_OPENED → VENDOR_ACTIVATED`
  - Gulf Office Systems（NON_MATERIAL, ACTIVE）：四问全 false，单步审批 APPROVED，材料 INCORPORATION_CERT + CONTRACT
  - **Sable Crest Trading FZCO**（LP，`PENDING_ASSESSMENT`）：注册地 UAE-RAK ICC，1 位 UBO「Marwan Al-Sable」，六份 PDF 已传，DDA 已开、零筛查记录
  - **Pearl Clean Services LLC**（服务商，NON_MATERIAL，`PENDING_APPROVAL`）：DDA 结论 SENT_FOR_APPROVAL、LOW、2 条 GREEN；一张 `VENDOR_APPROVAL` 审批单 `PENDING_APPROVAL`（提单人合规官）
  - 占位 PDF：种子内 `writePlaceholderPdf(path, title)` 写最小合法 PDF（约 300 字节，`%PDF-1.4` + 一页含标题文本），路径与 `DocumentsService` 同规则（`${FILE_STORAGE_DIR}/${ownerType}/${ownerNo}/${docNo}.pdf`）；种子启动时 `FILE_STORAGE_DIR` 缺失即抛
- [x] **Step 1: 写种子 + data.md 手写区**
- [x] **Step 2: `bash scripts/stack.sh reset self` 全程绿（含 `verify:demo-data ALL PASS`）；`bash scripts/on-stack.sh self demo:all` 全绿（花名册 + COA 恒等式）；`ls` 文件目录看到 5 + 2 家的 PDF**
- [x] **Step 3: 失效验证**：把 Pearl Clean 的审批单 `status` 改成 `APPROVED` 再 reset → 剧目第 40 幕 CFO 队列应空（人工确认后还原）
- [x] **Step 4: Commit** `feat(种子): LP 两家、服务商三家按尽调全流程重铺；新增 Sable Crest（待评估）与 Pearl Clean（待批准）；占位 PDF 落文件目录`

---

### Task 10: `verify:rbac` 判据改写 + 全量闸

**Files:**
- Modify: `scripts/verify-rbac.ts:643-694`（S11）、`:747-834`（S13）
- Modify: `doc-final/modules/v1-governance.md:59`（路由与权限码数量——实数以 verify:rbac 输出为准）

**Interfaces:**
- Produces 新判据：S11a 组清单加 `VENDOR_APPLY, VENDOR_READ, DUE_DILIGENCE_WRITE, INFOSEC_ASSESSMENT_WRITE`；S11b 改成**显式持有者表** `{ OBLIGATION_WRITE:['COMPLIANCE_OFFICER'], VENDOR_REGISTER_WRITE:['COMPLIANCE_OFFICER'], RI_REGISTER_WRITE:['COMPLIANCE_OFFICER'], DUE_DILIGENCE_WRITE:['COMPLIANCE_OFFICER'], VENDOR_APPLY:['OPS_OFFICER'], INFOSEC_ASSESSMENT_WRITE:['CISO'] }` 恰等；S11d（新）`VENDOR_READ` 持有集恰为 T1 七角色；S11c 不变（`COMPLIANCE_OFFICE_VIEW` 仍五角色）；S13c `LP_READ` 持有集加 `SENIOR_MANAGEMENT_OFFICER` 成五；S13d：`totalDomains === 15 && totalBuckets === 87 && declaredPermissionGroups.size === 96`（实跑后以输出为准，差异要能解释到组 / 桶）
- [x] **Step 1: 改判据 → `bash scripts/on-stack.sh self verify:rbac` 全绿**；失效验证：临时把 CFO 的 `VENDOR_READ` 拿掉 → S9 应红（vendor 两策略），还原
- [x] **Step 2: 全量闸**：`npx tsc --noEmit -p tsconfig.json`；`cd admin-web && npx tsc -b --noEmit`；`cd client-web && npx tsc -b --noEmit`；`npx jest --silent`（**全量，不接管道**，判据全绿）；`bash scripts/on-stack.sh self test:e2e`（全量，环境债红要逐条说明）；`bash scripts/stack.sh reset self` → `demo:all`，判据对照 `doc-final/demo/baseline.md` 全绿（`test:client` 不触发——client-web 零改动）
- [x] **Step 3: Commit** `chore(闸门): verify:rbac 判据随四组三策略改写；全量闸绿`

---

### Task 11: 文档收口

**Files:**
- Modify: `doc-final/modules/lp-desk.md`（§1 建档流程、§2 状态机六态七边、§3 审计码、§4 演示脚本指向场景 37 / 38、§6 权限）；`doc-final/modules/compliance-office.md`（§3.1 外包商册 → 服务商准入：七态九边、重大性判定、报备门；新 §3.x 尽调评估主体 `DDA` / `SCR`、文件 `DOC`；§5 审计码；§6 权限）；`doc-final/modules/v1-governance.md`（三策略、四组；RBAC 数量 T10 已改）；`doc-final/modules/v9-regulatory-filing.md`（第五条自动来路：服务商准入 / 终止；新事件 `regulatory-filing.submitted`）
- Modify: `doc-final/demo/script.md`（场景 22 :346-371 重写为「运营申请 → 合规评估 → 批」摘要并指向 39 / 40；场景 36 :660-706 重写为新 LP 流程并指向 37 / 38；新增场景 37–40 按 spec §10 四幕逐步写，含登录账号、点哪里、看到什么）；`doc-final/demo/data.md`（T9 已改手写区，核对生成区由 demo:all 刷新过）
- Modify: `doc-final/reference/sumsub-mock-touchpoints.md:19`（⑨ 行改「人工登记，无外部服务——2026-10-28 甲波六退役 mock」）
- Modify: `doc-final/decisions.md`（末尾追加「2026-10-28 甲波六·服务商与 LP 背调六拍板」：① 复审整体另立战役 ② LP 不设额度上限（否决）③ 筛查人工登记非自动（乙案）④ 重大性四问任一「会」强制 MATERIAL、只升不降 ⑤ 重大服务商批后过 VARA 事前报备门才 ACTIVE ⑥ 服务商抬成独立页、不建统一尽调队列）
- Modify: `doc-final/BACKLOG.md`（:514 → `[x]` 本波解决；:519 → `[x]` 入册门半边已做、年审在 :516）；`doc-final/CHANGELOG.md`（顶部一行）；`doc-final/archive/superpowers/specs/2026-09-25-campaign-a-incident-regulatory-charter.md`（补「波六」一节：目标 / 边界 / 验收 = 场景 37–40 可演 + 闸全绿，指向本 spec）；本 spec 头状态改「已实施（plan 同名）」
- Modify: 根 `README.md` / `doc-final/delivery/`（触碰检查：动了状态机、审计集、业务键 `DDA/SCR/DOC` → 对应文件补一行）

- [x] **Step 1: 逐文件改；`grep -rn "dueDiligenceRef\|Entity Screening\|VENDOR_REGISTERED\|Register Vendor" doc-final --include="*.md" | grep -v "archive\|superpowers/specs/2026-10-28\|superpowers/plans/2026-10-28\|decisions.md"` 为 0**
- [x] **Step 2: Commit** `docs(甲波六): 模块文档/剧本 37–40/决策六拍板/BACKLOG 销账/CHANGELOG/总纲波六`

---

### Task 12: 四幕走查 + 终审

- [x] **Step 1: 干净重铺**：`bash scripts/stack.sh reset self && bash scripts/stack.sh up`，等就绪
- [x] **Step 2: 按 `demo/script.md` 场景 37–40 逐步走**（`scripts/demo-shot.js` 先例截图，每幕 ≥ 2 张，落 artifacts 目录），每幕末核对：审计时间线 / 审批单 / 报送单 / 文件可打开；任何一步与剧本不符 → 回对应任务修，不改剧本迁就
- [x] **Step 3: 终审（`opus`）**：拿 spec §1「做」表与 §3–§10 逐条问「这条承诺的代码在哪」（含括号里的承诺）；`review-rubric.md` 三件事；孤儿清点（`npx ts-prune` 或 grep 本波新增导出的消费者）；修复轮按 CLAUDE.md 分层
- [x] **Step 4: 收尾报告**：闸门清单（命令 + 退出码 + 关键行）、checklist 对账表（Global Constraints「收尾过哪几条」逐条打勾）、`Documentation updated: modules§0-4 / modules§5 / demo / decisions — 甲波六`
- [ ] **Step 5: 合并前**（未执行——会话指令「不合并、不推送」，待业主拍板合并后执行）：`superpowers:finishing-a-development-branch`；合并后主树 `prisma:generate` → build → `stack.sh reset main` → `up` → `db:base:sync` → `demo:all`（判例顺序）；spec / plan 移 `doc-final/archive/superpowers/`；evidence 目录压缩改写
