# 审计日志重构 · 第一批实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把审计日志表结构按应然规范重建（含被删的多主体子表），把 32 个非编排层打点上收，并让 V1 治理域的 45 个动作码全部实装——使「按客户查全部」「按依据反查」「谁被拒过」「谁查过审计日志」四类取证从做不出来变成一条查询。

**Architecture:** 子表由 `AuditLogsService` **在同一事务内**随主记录一起写，调用方只传 `subjects[]`，不自己碰子表（沿用「审计写入唯一漏斗」的既有形态）。动作词表改为**扁平全局唯一 + 前缀优先**，每个码在常量表里声明四件事（`actionDomain` / `correlationMode` / 额外必填 / `causationId` 是否必填），写入时按声明做**机器校验**。V1 域的业务码由各 workflow 服务写，审批横切 6 码由 `ApprovalsService` 统一写。

**Tech Stack:** NestJS 10 + Prisma 5 (SQLite) ｜ Jest（**手写 mock 风格**，非 Nest TestingModule）

设计稿：`doc-final/superpowers/specs/2026-08-25-audit-log-redesign-design.md`

---

## Global Constraints

- **工作目录**：`/Users/songshengwei/Documents/codex/projects/重做版/Exchange_js`。每个 Task 开始前 `source ~/.nvm/nvm.sh && nvm use 20`。
- **Demo 数据约定**：数据可随时格式化重铺。**禁止** backfill / 迁移兼容层 / 双写过渡 / 向后兼容列。schema 改动直接按目标终态做；`prisma/migrations` 仍按正常流程新增（保证空库能从零建起），迁移内容不必兼容已有行。
- **字段名与枚举一律以应然为准**（业主裁定，代码不一致时听应然的）：
  `auditNo→eventNo` ｜ `result→outcome` ｜ 六值枚举 → **四值 `SUCCESS`/`DENIED`/`FAILED`/`PARTIAL`** ｜ `entityType/entityId/entityNo→primarySubjectType/primarySubjectNo` ｜ `entityOwnerNo→ownerCustomerNo` ｜ `createdAt→recordedAt` ｜ `actorRole→actorRolesAtTime`（数组） ｜ `updatedAt` **删除** ｜ `workflowType` **停止 V1 域写入**。
- **`workflowType` 本批只停用不删列** —— 交易域 63 处写入点仍传该字段，物理删列排在交易域批次。**这是本批唯一的过渡层例外，已在设计稿 §4.3 标注，不要顺手删。**
- **`subjectRole` 五值封闭**：`PRIMARY`/`OWNER`/`INSTRUMENT`/`RELATED`/`COUNTERPARTY`。**刻意不设 `ACTOR`**（操作人已在主表 `actorNo`）。
- **`PRIMARY` 至多一个，零个合法**。改了 N 个对象 = N 条记录。
- **`subjectNo` 存业务键不存 UUID** —— 对象可能被删，业务键在记录里仍可读。
- **动作码扁平全局唯一 + 前缀优先**：同一趟流程的全部码共享同一前缀。六个后缀语义封闭：`_REQUESTED`/`_APPLIED`/`_COMPLETED`/`_CANCELLED`/`_EXPIRED`/`_DENIED`。
- **`outcome` 说的是「动作执行成没成」，不是「业务结果好不好」**：`APPROVAL_DECLINED` 的 outcome 是 `SUCCESS`（驳回这个动作成功执行了）。
- **审计写入与业务变更同事务，审计写失败则整体回滚。**
- **五条不可违反规则**（`CLAUDE.md`）：① 审计必须 DI 注入 `AuditLogsService`；② 多表变更用 `prisma.$transaction`；③ 有业务键禁止以 `id` 作对外主查询合同；④ 禁绕 onboarding/compliance 状态门；⑤ Workflow 禁止直写 domain 实体表。
- **本批明确不做**：三个交易域的日志梳理（动作码/subjects/拒绝路径）· 安全日志建设 · 回放对账 · 交易域词表瘦身 · `seq`/哈希链校验工具 · `legalHold` 运维流程。**看到这些不要顺手补上。**

- 🔴 **业主裁定（2026-08-25，执行前预检提出）：只保证 V1 域的审计是对的，其他域打审计日志失败没关系，各域的审计留给各域自己的任务做。**

  但**编译不过 ≠ 打日志失败** —— 前者会让整个后端起不来，Task 11 连 `demo:all` 都跑不了。故本批的收口是：

  | | 本批做 | 本批不做 |
  |---|---|---|
  | **V1 域** | 全部正确：45 码 + 声明校验 + subjects + 三条追踪线 | — |
  | **其他域**（交易 / 客户 / 对账 / 资产等 33 文件） | **只机械改字段名，让它编译过** | 内容对不对、码对不对、subjects 有没有、拒绝路径接没接 —— **一概不管** |

  配套放宽：`actionDomain` / `category` 在 DTO 里**声明为可选**，服务层只对 **V1 词表内的码**强制（`assertActionSpec` 的 `if (!spec) return;` 天然如此）。于是其他域的调用**能编译、能跑、写出来的记录内容残缺** —— 正是业主要的效果。

  **机械改名的确切含义**（Task 2 Step 8 执行）：只做下列字面替换 —— **前四组可 sed，后三组要人工判断**；一律**不改任何语义、不加任何字段、不动任何动作码**。
  ```
  entityType:        →  primarySubjectType:
  entityNo:          →  primarySubjectNo:
  entityOwnerNo:     →  ownerCustomerNo:
  result:            →  outcome:
  AuditResult        →  AuditOutcome
  actor 对象里 actorId →  actorNo（并补 actorDisplayName: <原 actorNo 或 'UNKNOWN'>）
  entityId:          →  删除该行（并入 primarySubjectNo）
  ```
  改完**不要**去补 `actionDomain`/`category`/`subjects` —— 那是各域自己任务的活。
- **五道构建闸门，每个 Task 结束都要跑**：
  ```bash
  npx tsc --noEmit -p tsconfig.json
  npx tsc --noEmit -p tsconfig.test.json
  (cd admin-web  && npx tsc -b --noEmit)
  (cd client-web && npx tsc -b --noEmit)
  npx jest
  ```
  **判据是「净新失败 = 0」，不是全绿。** 已知基线常年 3 suites / 4 tests 红。
- **每个新增测试必须做变异测试**：注释掉实现，重跑必须**变红**，撤销后恢复绿。本仓库有过「一批栽六次」的自证型绿灯记录，这一步不能省。

---

## File Structure

| 文件 | 职责 | 动作 |
|---|---|---|
| `prisma/schema.prisma` | 数据模型 | 重建 `AuditLogEvent`；新增 `AuditLogSubject` |
| `prisma/migrations/20260825010000_audit_log_redesign/migration.sql` | 迁移 | 新建（表重建 + 子表） |
| `src/modules/audit-logging/dto/audit-log.dto.ts` | 写入/查询契约 | 新枚举与入参 |
| `src/modules/audit-logging/constants/audit-actions.constant.ts` | 词表 | V1 段重建为 45 码 + 声明 |
| `src/modules/audit-logging/audit-logs.service.ts` | 写入唯一漏斗 + 查询 | 子表落库、声明校验、查询扩展 |
| `src/modules/governance/approvals/approvals.service.ts` | 审批横切 | 6 码实装 |
| `src/modules/identity/users/*-workflow.service.ts` | V1 IAM 编排 | 业务码实装 + 收上来的打点 |
| `src/modules/audit-logging/audit-evidence-export-workflow.service.ts` | AUDIT 域 | 4 码实装 |
| `scripts/verify-audit.ts` | 端到端验收 | 新建 |

---

## Task 1: 重建表结构与子表

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260825010000_audit_log_redesign/migration.sql`

**Interfaces:**
- Produces: Prisma model `AuditLogEvent`（应然十组字段全集）· `AuditLogSubject`（`id`/`eventId`/`subjectType`/`subjectNo`/`subjectRole`/`occurredAt`/`createdAt`）· 关系 `AuditLogEvent.subjects`

- [ ] **Step 1: 重写 `AuditLogEvent` model**

把 `prisma/schema.prisma` 里整个 `model AuditLogEvent { ... }` 替换为：

```prisma
model AuditLogEvent {
  // 组 A · 信封
  id                 String   @id @default(uuid())
  eventNo            String   @unique @default("TEMP")
  schemaVersion      Int      @default(1)
  seq                Int      @unique @default(autoincrement())
  category           String
  isReadOnly         Boolean  @default(false)
  supersedesEventNo  String?
  correctionReason   String?

  // 组 B · 时间（三个，不可合并）
  occurredAt         DateTime @default(now())
  recordedAt         DateTime @default(now())
  effectiveDate      DateTime?

  // 组 C · 动作
  action             String
  actionDomain       String
  workflowType       String?   // ⚠️ 过渡层例外：交易域仍在写，V1 域停止写入，删列排在交易域批次

  // 组 D · 人（两个）
  actorType          String
  actorNo            String
  actorDisplayName   String
  onBehalfOfType     String?
  onBehalfOfNo       String?
  actorRolesAtTime   String    @default("[]")   // JSON 数组快照
  authnMethod        String?

  // 组 E · 来源
  sourcePlatform     String
  requestId          String?
  sessionId          String?
  sourceIp           String?
  userAgent          String?
  endpoint           String?

  // 组 F · 主体（主表冗余；完整关系见 AuditLogSubject）
  primarySubjectType String?
  primarySubjectNo   String?
  ownerCustomerNo    String?

  // 组 G · 结果
  outcome            String    @default("SUCCESS")
  reasonCode         String?
  reason             String?
  fromStatus         String?
  toStatus           String?
  beforeData         String?
  afterData          String?
  amount             String?
  currency           String?

  // 组 H · 授权依据
  permissionCode     String?
  policyCode         String?
  policyVersion      Int?
  approvalNo         String?
  ruleCode           String?
  ruleVersion        Int?
  isOverride         Boolean   @default(false)
  overrideReason     String?

  // 组 I · 关联（三条线）
  correlationId       String?
  causationId         String?
  traceId             String?
  groupEventId        String?
  externalEvidenceRef String?

  // 组 J · 完整性与生命周期
  payloadDigest      String
  prevHash           String?
  selfHash           String?
  retentionClass     String    @default("STANDARD_8Y")
  retainedUntil      DateTime
  legalHold          Boolean   @default(false)
  idempotencyKey     String?   @unique
  signature          String?
  archivedAt         DateTime?
  storageTier        String?   @default("HOT")

  metadata           String?

  subjects           AuditLogSubject[]

  @@index([occurredAt])
  @@index([actorNo, occurredAt])
  @@index([ownerCustomerNo, occurredAt])
  @@index([action, occurredAt])
  @@index([actionDomain, occurredAt])
  @@index([correlationId, occurredAt])
  @@index([causationId])
  @@index([traceId, occurredAt])
  @@index([outcome, occurredAt])
  @@index([primarySubjectType, primarySubjectNo])
  @@index([isReadOnly, occurredAt])
  @@index([retainedUntil])
  @@index([legalHold])
  @@map("audit_log_events")
}

model AuditLogSubject {
  id          String        @id @default(uuid())
  eventId     String
  subjectType String
  subjectNo   String
  subjectRole String
  occurredAt  DateTime
  createdAt   DateTime      @default(now())

  event       AuditLogEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@unique([eventId, subjectType, subjectNo, subjectRole])
  @@index([subjectNo, occurredAt])
  @@index([subjectType, subjectNo, occurredAt])
  @@index([subjectRole, occurredAt])
  @@index([eventId])
  @@map("audit_log_subjects")
}
```

> **`updatedAt` 已删** —— 只增不改的表不该有「更新时间」。
> **唯一键必须含 `subjectRole`** —— 同一对象可在一条事件里担两个角色（「冻结这个客户」时客户既是 `OWNER` 又是 `PRIMARY`），不含角色会被误判成重复。

- [ ] **Step 2: 写迁移 SQL**

SQLite 无法直接改列，走表重建。创建 `prisma/migrations/20260825010000_audit_log_redesign/migration.sql`：

```sql
-- 审计日志重构第一批：按应然规范重建主表 + 恢复 2026-05-20 被 DROP 的多主体子表
-- demo 数据可重铺，不做 backfill，直接建目标终态

DROP TABLE IF EXISTS "audit_log_events";

CREATE TABLE "audit_log_events" (
    "id"                 TEXT NOT NULL PRIMARY KEY,
    "eventNo"            TEXT NOT NULL DEFAULT 'TEMP',
    "schemaVersion"      INTEGER NOT NULL DEFAULT 1,
    "seq"                INTEGER NOT NULL,
    "category"           TEXT NOT NULL,
    "isReadOnly"         BOOLEAN NOT NULL DEFAULT false,
    "supersedesEventNo"  TEXT,
    "correctionReason"   TEXT,
    "occurredAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt"         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveDate"      DATETIME,
    "action"             TEXT NOT NULL,
    "actionDomain"       TEXT NOT NULL,
    "workflowType"       TEXT,
    "actorType"          TEXT NOT NULL,
    "actorNo"            TEXT NOT NULL,
    "actorDisplayName"   TEXT NOT NULL,
    "onBehalfOfType"     TEXT,
    "onBehalfOfNo"       TEXT,
    "actorRolesAtTime"   TEXT NOT NULL DEFAULT '[]',
    "authnMethod"        TEXT,
    "sourcePlatform"     TEXT NOT NULL,
    "requestId"          TEXT,
    "sessionId"          TEXT,
    "sourceIp"           TEXT,
    "userAgent"          TEXT,
    "endpoint"           TEXT,
    "primarySubjectType" TEXT,
    "primarySubjectNo"   TEXT,
    "ownerCustomerNo"    TEXT,
    "outcome"            TEXT NOT NULL DEFAULT 'SUCCESS',
    "reasonCode"         TEXT,
    "reason"             TEXT,
    "fromStatus"         TEXT,
    "toStatus"           TEXT,
    "beforeData"         TEXT,
    "afterData"          TEXT,
    "amount"             TEXT,
    "currency"           TEXT,
    "permissionCode"     TEXT,
    "policyCode"         TEXT,
    "policyVersion"      INTEGER,
    "approvalNo"         TEXT,
    "ruleCode"           TEXT,
    "ruleVersion"        INTEGER,
    "isOverride"         BOOLEAN NOT NULL DEFAULT false,
    "overrideReason"     TEXT,
    "correlationId"       TEXT,
    "causationId"         TEXT,
    "traceId"             TEXT,
    "groupEventId"        TEXT,
    "externalEvidenceRef" TEXT,
    "payloadDigest"      TEXT NOT NULL,
    "prevHash"           TEXT,
    "selfHash"           TEXT,
    "retentionClass"     TEXT NOT NULL DEFAULT 'STANDARD_8Y',
    "retainedUntil"      DATETIME NOT NULL,
    "legalHold"          BOOLEAN NOT NULL DEFAULT false,
    "idempotencyKey"     TEXT,
    "signature"          TEXT,
    "archivedAt"         DATETIME,
    "storageTier"        TEXT DEFAULT 'HOT',
    "metadata"           TEXT
);

CREATE UNIQUE INDEX "audit_log_events_eventNo_key"        ON "audit_log_events"("eventNo");
CREATE UNIQUE INDEX "audit_log_events_seq_key"            ON "audit_log_events"("seq");
CREATE UNIQUE INDEX "audit_log_events_idempotencyKey_key" ON "audit_log_events"("idempotencyKey");
CREATE INDEX "audit_log_events_occurredAt_idx"            ON "audit_log_events"("occurredAt");
CREATE INDEX "audit_log_events_actorNo_occurredAt_idx"    ON "audit_log_events"("actorNo","occurredAt");
CREATE INDEX "audit_log_events_owner_occurredAt_idx"      ON "audit_log_events"("ownerCustomerNo","occurredAt");
CREATE INDEX "audit_log_events_action_occurredAt_idx"     ON "audit_log_events"("action","occurredAt");
CREATE INDEX "audit_log_events_domain_occurredAt_idx"     ON "audit_log_events"("actionDomain","occurredAt");
CREATE INDEX "audit_log_events_corr_occurredAt_idx"       ON "audit_log_events"("correlationId","occurredAt");
CREATE INDEX "audit_log_events_causationId_idx"           ON "audit_log_events"("causationId");
CREATE INDEX "audit_log_events_traceId_occurredAt_idx"    ON "audit_log_events"("traceId","occurredAt");
CREATE INDEX "audit_log_events_outcome_occurredAt_idx"    ON "audit_log_events"("outcome","occurredAt");
CREATE INDEX "audit_log_events_primarySubject_idx"        ON "audit_log_events"("primarySubjectType","primarySubjectNo");
CREATE INDEX "audit_log_events_isReadOnly_occurredAt_idx" ON "audit_log_events"("isReadOnly","occurredAt");
CREATE INDEX "audit_log_events_retainedUntil_idx"         ON "audit_log_events"("retainedUntil");
CREATE INDEX "audit_log_events_legalHold_idx"             ON "audit_log_events"("legalHold");

-- 多主体子表：恢复 2026-05-20 被 DROP 的 audit_log_subject_nos，形状按应然重建
CREATE TABLE "audit_log_subjects" (
    "id"          TEXT NOT NULL PRIMARY KEY,
    "eventId"     TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectNo"   TEXT NOT NULL,
    "subjectRole" TEXT NOT NULL,
    "occurredAt"  DATETIME NOT NULL,
    "createdAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_log_subjects_eventId_fkey" FOREIGN KEY ("eventId")
        REFERENCES "audit_log_events" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "audit_log_subjects_event_type_no_role_key"
    ON "audit_log_subjects"("eventId","subjectType","subjectNo","subjectRole");
CREATE INDEX "audit_log_subjects_subjectNo_occurredAt_idx"
    ON "audit_log_subjects"("subjectNo","occurredAt");
CREATE INDEX "audit_log_subjects_type_no_occurredAt_idx"
    ON "audit_log_subjects"("subjectType","subjectNo","occurredAt");
CREATE INDEX "audit_log_subjects_subjectRole_occurredAt_idx"
    ON "audit_log_subjects"("subjectRole","occurredAt");
CREATE INDEX "audit_log_subjects_eventId_idx"
    ON "audit_log_subjects"("eventId");
```

- [ ] **Step 3: 生成 client 并应用**

```bash
npx prisma generate
npm run db:migrate:local
```

Expected: `Generated Prisma Client`；迁移脚本无报错。

- [ ] **Step 4: 验证表真的按目标建成**

```bash
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(audit_log_events);" | wc -l
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(audit_log_events);" | grep -cE "outcome|correlationId|causationId|legalHold|seq|actionDomain|actorRolesAtTime"
sqlite3 /tmp/exchange_js_main/dev.db "PRAGMA table_info(audit_log_events);" | grep -c "updatedAt"
sqlite3 /tmp/exchange_js_main/dev.db ".schema audit_log_subjects" | grep -c subjectRole
```

Expected: 第一条 ≥ 57；第二条 `7`；第三条 `0`（`updatedAt` 已删）；第四条 ≥ 2。

- [ ] **Step 5: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
git add prisma/schema.prisma prisma/migrations/20260825010000_audit_log_redesign/
git commit -m "feat(audit): 按应然规范重建 audit_log_events + 恢复多主体子表"
```

> ⚠️ 本 Task 后 `tsc` 会在 `audit-logs.service.ts` 报错（旧字段名不存在），**这是预期的**，由 Task 2 修复。本步只跑 `tsconfig.json` 确认 schema 本身无误，不要求全绿。

---

## Task 2: 写入侧新契约

**Files:**
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Test: `src/modules/audit-logging/audit-logs.service.spec.ts`

**Interfaces:**
- Consumes: Task 1 的两个 model
- Produces:
  - `enum AuditOutcome { SUCCESS, DENIED, FAILED, PARTIAL }`
  - `enum AuditSubjectRole { PRIMARY, OWNER, INSTRUMENT, RELATED, COUNTERPARTY }`
  - `enum AuditCategory { BUSINESS, GOVERNANCE, SECURITY, SYSTEM }`
  - `interface AuditSubjectInput { subjectType: string; subjectNo: string; subjectRole: AuditSubjectRole }`
  - `CreateAuditLogEventDto` 全新形状（见下）
  - `AuditLogsService.persistSubjects(eventId: string, occurredAt: Date, subjects: AuditSubjectInput[] | undefined, client?: AuditWriteClient): Promise<void>`

- [ ] **Step 1: 写失败的测试**

追加到 `src/modules/audit-logging/audit-logs.service.spec.ts`：

```typescript
describe('第一批 · 写入侧新契约', () => {
  beforeEach(() => {
    prisma.auditLogSubject = { createMany: jest.fn().mockResolvedValue({ count: 0 }) };
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockResolvedValue({ id: 'evt-1', eventNo: 'AUD1' });
  });

  it('subjects 逐行落子表，角色各留一行', async () => {
    await service.recordSystem({
      action: 'ADMIN_SUSPENSION_APPLIED',
      actionDomain: 'IAM',
      category: AuditCategory.GOVERNANCE,
      primarySubjectType: 'ADMIN_USER',
      primarySubjectNo: 'USR001',
      subjects: [
        { subjectType: 'ADMIN_USER',    subjectNo: 'USR001', subjectRole: AuditSubjectRole.PRIMARY },
        { subjectType: 'APPROVAL_CASE', subjectNo: 'APR077', subjectRole: AuditSubjectRole.INSTRUMENT },
      ],
    } as any);

    expect(prisma.auditLogSubject.createMany).toHaveBeenCalledTimes(1);
    const rows = prisma.auditLogSubject.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.eventId === 'evt-1')).toBe(true);
    expect(rows.map((r: any) => r.subjectRole).sort()).toEqual(['INSTRUMENT', 'PRIMARY']);
  });

  it('PRIMARY 多于一个时抛错', async () => {
    await expect(
      service.recordSystem({
        action: 'ADMIN_SUSPENSION_APPLIED',
        actionDomain: 'IAM',
        category: AuditCategory.GOVERNANCE,
        subjects: [
          { subjectType: 'ADMIN_USER', subjectNo: 'U1', subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'ADMIN_USER', subjectNo: 'U2', subjectRole: AuditSubjectRole.PRIMARY },
        ],
      } as any),
    ).rejects.toThrow('exactly one PRIMARY');
  });

  it('PRIMARY 零个是合法的——建单前被拦截时没有主对象', async () => {
    await service.recordSystem({
      action: 'ADMIN_INVITE_REQUESTED',
      actionDomain: 'IAM',
      category: AuditCategory.GOVERNANCE,
      outcome: AuditOutcome.DENIED,
      reasonCode: 'SOD_CONFLICT',
      subjects: [
        { subjectType: 'ADMIN_USER', subjectNo: 'U1', subjectRole: AuditSubjectRole.OWNER },
      ],
    } as any);

    expect(prisma.auditLogSubject.createMany).toHaveBeenCalledTimes(1);
  });

  it('没传 subjects 时不碰子表', async () => {
    await service.recordSystem({
      action: 'AUDIT_LOG_QUERIED',
      actionDomain: 'AUDIT',
      category: AuditCategory.GOVERNANCE,
    } as any);
    expect(prisma.auditLogSubject.createMany).not.toHaveBeenCalled();
  });

  it('outcome 四值枚举落库，reasonCode 原样保留', async () => {
    await service.recordSystem({
      action: 'APPROVAL_SOD_DENIED',
      actionDomain: 'APPROVAL',
      category: AuditCategory.GOVERNANCE,
      outcome: AuditOutcome.DENIED,
      reasonCode: 'SELF_APPROVE',
    } as any);

    const data = prisma.auditLogEvent.create.mock.calls[0][0].data;
    expect(data.outcome).toBe('DENIED');
    expect(data.reasonCode).toBe('SELF_APPROVE');
  });

  it('actorRolesAtTime 以 JSON 数组落库，不是单值字符串', async () => {
    await service.recordByActor(
      { action: 'ADMIN_ROLE_CHANGE_APPLIED', actionDomain: 'IAM', category: AuditCategory.GOVERNANCE } as any,
      { actorType: 'ADMIN', actorNo: 'USR009', actorDisplayName: '张三', actorRolesAtTime: ['MLRO', 'CISO'] } as any,
    );

    const data = prisma.auditLogEvent.create.mock.calls[0][0].data;
    expect(JSON.parse(data.actorRolesAtTime)).toEqual(['MLRO', 'CISO']);
    expect(data.actorDisplayName).toBe('张三');
  });

  it('幂等键含 actionDomain 与 correlationId 两维', async () => {
    await service.recordSystem({
      action: 'APPROVAL_GRANTED',
      actionDomain: 'APPROVAL',
      category: AuditCategory.GOVERNANCE,
      primarySubjectNo: 'APR077',
      correlationId: 'corr-1',
      requestId: 'req-1',
    } as any);
    const k1 = prisma.auditLogEvent.create.mock.calls[0][0].data.idempotencyKey;

    prisma.auditLogEvent.create.mockClear();
    await service.recordSystem({
      action: 'APPROVAL_GRANTED',
      actionDomain: 'APPROVAL',
      category: AuditCategory.GOVERNANCE,
      primarySubjectNo: 'APR077',
      correlationId: 'corr-2',
      requestId: 'req-1',
    } as any);
    const k2 = prisma.auditLogEvent.create.mock.calls[0][0].data.idempotencyKey;

    expect(k1).not.toBe(k2);
  });
});
```

在该文件顶部 import 块补：

```typescript
import {
  AuditOutcome,
  AuditSubjectRole,
  AuditCategory,
} from './dto/audit-log.dto';
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts -t "第一批 · 写入侧新契约"
```

Expected: FAIL —— `AuditOutcome` / `AuditSubjectRole` / `AuditCategory` 未从 DTO 导出。

- [ ] **Step 3: 重写 DTO**

把 `src/modules/audit-logging/dto/audit-log.dto.ts` 里的 `enum AuditResult` 整块替换为：

```typescript
/** 动作执行成没成——不是「业务结果好不好」。审批被驳回时 outcome 仍是 SUCCESS。 */
export enum AuditOutcome {
  /** 动作成功执行 */
  SUCCESS = 'SUCCESS',
  /** 系统主动挡住、动作压根没执行成：SoD 冲突、自审防篡改、速率限制、令牌失效 */
  DENIED = 'DENIED',
  /** 试了但技术上没成：邮件发送失败、下游写库失败 */
  FAILED = 'FAILED',
  /** 部分成功 */
  PARTIAL = 'PARTIAL',
}

export enum AuditCategory {
  BUSINESS = 'BUSINESS',
  GOVERNANCE = 'GOVERNANCE',
  SECURITY = 'SECURITY',
  SYSTEM = 'SYSTEM',
}

/**
 * 主体在本条审计事件里扮演的角色。五值封闭。
 * 刻意不设 ACTOR —— 操作人已由主表 actorNo 记录，同一份信息只存一处。
 */
export enum AuditSubjectRole {
  /** 事件直接作用的对象。至多一个；零个合法（建单前被拦截时没有主对象） */
  PRIMARY = 'PRIMARY',
  /** 归属主体，通常是客户。监管索档走这个角色 */
  OWNER = 'OWNER',
  /** 动作所依据的凭据：审批单、规则行、提现地址、报价单 */
  INSTRUMENT = 'INSTRUMENT',
  /** 被牵连的相关单据：资金单、资产、钱包、账本账户 */
  RELATED = 'RELATED',
  /** 对手方：外部 VASP、收款人、汇款人 */
  COUNTERPARTY = 'COUNTERPARTY',
}

export enum AuditCorrelationMode {
  /** 开启新旅程：生成 UUID v4，同事务写回主单 */
  START = 'START',
  /** 延续已有旅程：从 PRIMARY 主体上读；读不到必须报错，不许静默生成 */
  INHERIT = 'INHERIT',
  /** 不属于任何旅程 */
  NONE = 'NONE',
}

export interface AuditSubjectInput {
  subjectType: string;
  /** 业务键，不是 UUID —— 对象可能被删，业务键在记录里仍可读 */
  subjectNo: string;
  subjectRole: AuditSubjectRole;
}

export interface AuditActorContext {
  actorType: string;
  actorNo: string;
  /** 当时的姓名/账号快照。人会离职改名，不存快照则记录三年后读不懂 */
  actorDisplayName: string;
  actorRolesAtTime?: string[];
  onBehalfOfType?: string;
  onBehalfOfNo?: string;
  authnMethod?: string;
}
```

把 `CreateAuditLogEventDto` 类体替换为（保留既有的 `@ApiPropertyOptional` / `@IsOptional` / `@IsString` 装饰器风格）：

```typescript
export class CreateAuditLogEventDto {
  @ApiProperty() @IsString()
  action!: string;

  /**
   * ⚠️ 本批刻意声明为可选：只对 V1 词表内的码强制（见 assertActionSpec）。
   * 其他域的调用不填也能编译能跑，写出来的记录内容残缺——业主 2026-08-25 裁定接受，
   * 各域的审计正确性留给各域自己的任务。
   */
  @ApiPropertyOptional() @IsOptional() @IsString()
  actionDomain?: string;

  @ApiPropertyOptional({ enum: AuditCategory }) @IsOptional() @IsEnum(AuditCategory)
  category?: AuditCategory;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  ownerCustomerNo?: string;

  @ApiPropertyOptional() @IsOptional()
  subjects?: AuditSubjectInput[];

  @ApiPropertyOptional({ enum: AuditOutcome }) @IsOptional() @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @ApiPropertyOptional() @IsOptional() @IsString()
  reasonCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  reason?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  fromStatus?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  toStatus?: string;

  @ApiPropertyOptional() @IsOptional()
  beforeData?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional()
  afterData?: Record<string, unknown>;

  @ApiPropertyOptional() @IsOptional() @IsString()
  amount?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  currency?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  permissionCode?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  policyCode?: string;

  @ApiPropertyOptional() @IsOptional()
  policyVersion?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  approvalNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  ruleCode?: string;

  @ApiPropertyOptional() @IsOptional()
  ruleVersion?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  correlationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  causationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  traceId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  groupEventId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  externalEvidenceRef?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  requestId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sessionId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sourceIp?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  sourcePlatform?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  userAgent?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  endpoint?: string;

  @ApiPropertyOptional() @IsOptional()
  isReadOnly?: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString()
  effectiveDate?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  occurredAt?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional() @IsOptional()
  metadata?: Record<string, unknown>;
}
```

- [ ] **Step 4: 改写服务层写入路径**

在 `src/modules/audit-logging/audit-logs.service.ts`：

**4a.** 替换 `buildIdempotencyKey` 的 `parts`（补两维，堵住「共用码 + 同 entityId 时第二条被静默去重」）：

```typescript
    const parts = [
      input.actionDomain,
      input.action,
      input.primarySubjectType || 'NA',
      input.primarySubjectNo || 'NA',
      input.correlationId || 'NO_CORRELATION',
      normalizedRequestId || 'NO_REQUEST_ID',
    ];
```

**4b.** 替换 `createEventWithUniqueNo` 的入参对象为新字段名（整块替换 `action:` 到 `occurredAt,` 之间）：

```typescript
      {
        action: input.action,
        actionDomain: input.actionDomain,
        category: input.category,
        isReadOnly: input.isReadOnly ?? false,
        primarySubjectType: input.primarySubjectType ?? null,
        primarySubjectNo: input.primarySubjectNo ?? null,
        ownerCustomerNo: input.ownerCustomerNo ?? null,
        actorType: actor.actorType,
        actorNo: actor.actorNo,
        actorDisplayName: actor.actorDisplayName,
        actorRolesAtTime: JSON.stringify(actor.actorRolesAtTime ?? []),
        onBehalfOfType: actor.onBehalfOfType ?? null,
        onBehalfOfNo: actor.onBehalfOfNo ?? null,
        authnMethod: actor.authnMethod ?? null,
        sourcePlatform: input.sourcePlatform ?? 'SYSTEM',
        requestId: normalizedRequestId,
        sessionId: input.sessionId ?? null,
        sourceIp: maskedSourceIp,
        userAgent: input.userAgent ?? null,
        endpoint: input.endpoint ?? null,
        outcome: input.outcome ?? AuditOutcome.SUCCESS,
        reasonCode: input.reasonCode ?? null,
        reason: input.reason ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        beforeData: this.serializeJson(input.beforeData ?? null),
        afterData: this.serializeJson(input.afterData ?? null),
        amount: input.amount ?? null,
        currency: input.currency ?? null,
        permissionCode: input.permissionCode ?? null,
        policyCode: input.policyCode ?? null,
        policyVersion: input.policyVersion ?? null,
        approvalNo: input.approvalNo ?? null,
        ruleCode: input.ruleCode ?? null,
        ruleVersion: input.ruleVersion ?? null,
        correlationId: input.correlationId ?? null,
        causationId: input.causationId ?? null,
        traceId: input.traceId ?? null,
        groupEventId: input.groupEventId ?? null,
        externalEvidenceRef: input.externalEvidenceRef ?? null,
        metadata: this.serializeJson(input.metadata ?? null),
        effectiveDate: input.effectiveDate ? this.toDate(input.effectiveDate) : null,
        idempotencyKey,
        payloadDigest,
        retainedUntil,
        occurredAt,
        recordedAt: new Date(),
      },
```

同时把 `createEventWithUniqueNo` 内 `auditNo: generateReferenceNo('AUD')` 改为 `eventNo: generateReferenceNo('AUD')`，`isUniqueConflict(error, 'auditNo')` 改为 `'eventNo'`。

**4c.** 把 `return this.mapEvent(created);` 改为：

```typescript
    await this.persistSubjects(created.id, occurredAt, input.subjects, client);

    return this.mapEvent(created);
```

**4d.** 在 `createEventWithUniqueNo` 之前新增私有方法：

```typescript
  /**
   * 把 subjects 逐行落子表。与主记录同一个 client（同事务）。
   * 不做 upsert —— 唯一键冲突意味着调用方重复传了同一 (类型, 业务键, 角色)，是调用方 bug，应当响。
   */
  private async persistSubjects(
    eventId: string,
    occurredAt: Date,
    subjects: AuditSubjectInput[] | undefined,
    client?: AuditWriteClient,
  ): Promise<void> {
    if (!subjects || subjects.length === 0) return;

    const primaryCount = subjects.filter(
      (s) => s.subjectRole === AuditSubjectRole.PRIMARY,
    ).length;
    if (primaryCount > 1) {
      throw new BadRequestException(
        `Audit event must carry at most exactly one PRIMARY subject, got ${primaryCount}. ` +
          '改了 N 个对象就写 N 条记录，不要在一条记录上挂多个 PRIMARY。',
      );
    }

    const db = this.getDb(client) as any;
    if (!db?.auditLogSubject?.createMany) return;

    await db.auditLogSubject.createMany({
      data: subjects.map((s) => ({
        eventId,
        subjectType: s.subjectType,
        subjectNo: s.subjectNo,
        subjectRole: s.subjectRole,
        occurredAt,
      })),
    });
  }
```

**4e.** `recordSystem` 的 actor 改为新形状：

```typescript
      {
        actorType: 'SYSTEM',
        actorNo: 'SYSTEM',
        actorDisplayName: 'SYSTEM',
        actorRolesAtTime: [],
      },
```

**4f.** 顶部 import 补：

```typescript
import {
  AuditOutcome,
  AuditSubjectInput,
  AuditSubjectRole,
} from './dto/audit-log.dto';
```

> ⚠️ 若这些名字已在同一条 import 语句里，并进去，不要新开重复 import。
> ⚠️ 全文件搜索 `AuditResult` 并替换为 `AuditOutcome`；搜索 `input.entityType`/`entityId`/`entityNo`/`entityOwnerNo` 替换为新字段名；`resolveEntityNo`/`resolveEntityOwnerNo` 等辅助方法同步改名与改字段。

- [ ] **Step 5: 跑测试确认通过**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts
```

Expected: 新增 7 个用例全绿。该文件既有用例中引用旧字段名的会红，**同步改到新字段名**（这是本 Task 的一部分，不是遗留失败）。

- [ ] **Step 6: 变异测试**

分别做两次，每次改完重跑 `-t "第一批 · 写入侧新契约"`，确认变红后撤销：

1. 注释掉 `persistSubjects` 里的 `await db.auditLogSubject.createMany({...})` 整句 → Expected **FAIL**（前 3 个用例红）
2. 把 `buildIdempotencyKey` 的 `parts` 里 `input.correlationId || 'NO_CORRELATION',` 一行删掉 → Expected **FAIL**（幂等键那条红）

- [ ] **Step 7: 先提交契约变更本体**

```bash
git add src/modules/audit-logging/dto/audit-log.dto.ts src/modules/audit-logging/audit-logs.service.ts src/modules/audit-logging/audit-logs.service.spec.ts
git commit -m "feat(audit): 写入侧改应然契约——outcome 四值/subjects 子表/actor 快照/幂等键补两维"
```

> ⚠️ 此刻 `tsc` **必然是红的** —— 全仓 62 个文件传的还是旧字段名。这是预期的，由下一步收口。

- [ ] **Step 8: 全仓机械改名，让其余域编译过**

这一步**只做字面替换，不改任何语义、不加任何字段、不动任何动作码**。改完不要去补 `actionDomain`/`category`/`subjects` —— 那是各域自己任务的活（业主 2026-08-25 裁定）。

先看清波及面：

```bash
grep -rn "entityType:" src/ --include="*.ts" | grep -v "\.spec\." | wc -l
grep -rln "entityType:\|entityNo:\|entityOwnerNo:\|result:\|AuditResult" src/ --include="*.ts" | grep -v "\.spec\." | wc -l
```

Expected: 约 301 处 / 约 62 个文件。

逐组替换（**逐组跑一次 `tsc` 看错误数下降，不要六组一起改**）：

```bash
FILES=$(grep -rl "entityType:\|entityNo:\|entityOwnerNo:\|AuditResult" src/ --include="*.ts" \
        | grep -v "audit-log.dto.ts" | grep -v "audit-logs.service.ts")

# 一组一组来，每组后跑 npx tsc --noEmit -p tsconfig.json 看错误数
echo "$FILES" | xargs sed -i '' 's/\bentityType:/primarySubjectType:/g'
echo "$FILES" | xargs sed -i '' 's/\bentityNo:/primarySubjectNo:/g'
echo "$FILES" | xargs sed -i '' 's/\bentityOwnerNo:/ownerCustomerNo:/g'
echo "$FILES" | xargs sed -i '' 's/\bAuditResult\b/AuditOutcome/g'
```

剩下三处需要**人工判断**（sed 做不了，逐个文件改）：

1. **`result:` → `outcome:`** —— 不能全局 sed，`result` 是常见变量名。只改**审计写入对象字面量里**的那些：先 `grep -rn "result: AuditOutcome\|result: 'SUCCESS'\|result: AuditOutcome\." src/` 定位，逐个确认后改。
2. **`entityId:` 那一行删除** —— 它并入 `primarySubjectNo`。若该处原本只有 `entityId` 没有 `entityNo`，把 `entityId: x` 改成 `primarySubjectNo: x`；两者都有则删 `entityId` 行。
3. **actor 对象** —— `{ actorType, actorId, actorNo, actorRole }` 改成 `{ actorType, actorNo, actorDisplayName }`。`actorDisplayName` 填原 `actorNo` 的值（其他域的记录内容残缺是可接受的），`actorRole` 若有值则改成 `actorRolesAtTime: [原值]`。

- [ ] **Step 9: 闸门 —— 这次必须真绿**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
(cd admin-web  && npx tsc -b --noEmit)
(cd client-web && npx tsc -b --noEmit)
npx jest
```

Expected: 四份 tsc **0 错**；`npx jest` 净新失败 = 0（其他域的审计**单测**可能因缺字段而红——若红，**改测试断言以匹配新字段名，不要去补业务字段**）。

- [ ] **Step 10: 提交机械改名**

```bash
git add src/
git commit -m "refactor(audit): 全仓审计调用点机械改字段名（仅字面替换，其他域内容正确性留各域任务）"
```

---

## Task 3: 查询侧扩展

**Files:**
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Test: `src/modules/audit-logging/audit-logs.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 的 `AuditSubjectRole` / `AuditOutcome`
- Produces: `AuditLogQueryDto` 新增 `subjectNo?` / `subjectRole?` / `actionDomain?` / `outcome?` / `correlationId?` / `causationId?` / `isReadOnly?`；`findOne()` 返回体带 `subjects`

- [ ] **Step 1: 写失败的测试**

```typescript
describe('第一批 · 按主体检索', () => {
  beforeEach(() => {
    prisma.auditLogEvent.count.mockResolvedValue(0);
    prisma.auditLogEvent.findMany.mockResolvedValue([]);
  });

  it('传 subjectNo 时用子表关系过滤', async () => {
    await service.findAll({ subjectNo: 'CUS889' } as any);
    expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.subjects)
      .toEqual({ some: { subjectNo: 'CUS889' } });
  });

  it('subjectNo 与 subjectRole 同传时落在同一个 some 里', async () => {
    await service.findAll({ subjectNo: 'CUS889', subjectRole: AuditSubjectRole.OWNER } as any);
    expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.subjects)
      .toEqual({ some: { subjectNo: 'CUS889', subjectRole: 'OWNER' } });
  });

  it('两个都不传时不加 subjects 条件', async () => {
    await service.findAll({} as any);
    expect(prisma.auditLogEvent.findMany.mock.calls[0][0].where.subjects).toBeUndefined();
  });

  it('outcome 与 actionDomain 可过滤', async () => {
    await service.findAll({ outcome: AuditOutcome.DENIED, actionDomain: 'IAM' } as any);
    const where = prisma.auditLogEvent.findMany.mock.calls[0][0].where;
    expect(where.outcome).toBe('DENIED');
    expect(where.actionDomain).toBe('IAM');
  });

  it('详情返回 subjects 数组', async () => {
    prisma.auditLogEvent.findUnique.mockResolvedValue({
      id: 'evt-9', eventNo: 'AUD9', action: 'ADMIN_SUSPENSION_APPLIED',
      actionDomain: 'IAM', category: 'GOVERNANCE', actorType: 'ADMIN', actorNo: 'U1',
      actorDisplayName: '张三', actorRolesAtTime: '["CISO"]', occurredAt: new Date(),
      subjects: [{ subjectType: 'ADMIN_USER', subjectNo: 'USR001', subjectRole: 'PRIMARY' }],
    });

    const r: any = await service.findOne('evt-9');
    expect(r.subjects).toEqual([
      { subjectType: 'ADMIN_USER', subjectNo: 'USR001', subjectRole: 'PRIMARY' },
    ]);
    expect(r.actorRolesAtTime).toEqual(['CISO']);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts -t "第一批 · 按主体检索"
```

Expected: FAIL —— `where.subjects` 为 `undefined`；详情无 `subjects`。

- [ ] **Step 3: 查询 DTO 加入参**

在 `AuditLogQueryDto` 里把 `entityType`/`entityId`/`entityOwnerNo` 三项替换为，并追加新项：

```typescript
  @ApiPropertyOptional({ description: '按主体业务键检索（经子表）——监管索档的主入口' })
  @IsOptional() @IsString()
  subjectNo?: string;

  @ApiPropertyOptional({ enum: AuditSubjectRole, description: '与 subjectNo 组合使用，限定该主体扮演的角色' })
  @IsOptional() @IsEnum(AuditSubjectRole)
  subjectRole?: AuditSubjectRole;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectType?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  primarySubjectNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  ownerCustomerNo?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  actionDomain?: string;

  @ApiPropertyOptional({ enum: AuditOutcome }) @IsOptional() @IsEnum(AuditOutcome)
  outcome?: AuditOutcome;

  @ApiPropertyOptional() @IsOptional() @IsString()
  correlationId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  causationId?: string;

  @ApiPropertyOptional() @IsOptional()
  isReadOnly?: boolean;
```

- [ ] **Step 4: `findAll` 的 where 构造**

在 `findAll` 里，`where` 组装完成之后、调用 `count`/`findMany` 之前插入：

```typescript
    if (query.actionDomain) (where as any).actionDomain = query.actionDomain;
    if (query.outcome) (where as any).outcome = query.outcome;
    if (query.correlationId) (where as any).correlationId = query.correlationId;
    if (query.causationId) (where as any).causationId = query.causationId;
    if (query.ownerCustomerNo) (where as any).ownerCustomerNo = query.ownerCustomerNo;
    if (query.primarySubjectType) (where as any).primarySubjectType = query.primarySubjectType;
    if (query.primarySubjectNo) (where as any).primarySubjectNo = query.primarySubjectNo;
    if (query.isReadOnly !== undefined) (where as any).isReadOnly = query.isReadOnly;

    if (query.subjectNo || query.subjectRole) {
      const some: Record<string, string> = {};
      if (query.subjectNo) some.subjectNo = query.subjectNo;
      if (query.subjectRole) some.subjectRole = query.subjectRole;
      (where as any).subjects = { some };
    }
```

> 用 `some` 而不是 join：一条事件有多个主体，**任一**命中就该返回。

- [ ] **Step 5: `findOne` 带出子表并映射**

`findUnique` 加 include：

```typescript
    const event = await db.auditLogEvent.findUnique({
      where: { id },
      include: {
        subjects: { select: { subjectType: true, subjectNo: true, subjectRole: true } },
      },
    });
```

返回前映射（紧接 `mapEvent` 之后）：

```typescript
    const mapped: any = this.mapEvent(event);
    mapped.subjects = (event.subjects ?? []).map((s: any) => ({
      subjectType: s.subjectType,
      subjectNo: s.subjectNo,
      subjectRole: s.subjectRole,
    }));
    return mapped;
```

并在 `mapEvent` 里把 `actorRolesAtTime` 反序列化：

```typescript
      actorRolesAtTime: (() => {
        try { return JSON.parse(row.actorRolesAtTime ?? '[]'); } catch { return []; }
      })(),
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx jest src/modules/audit-logging/audit-logs.service.spec.ts
```

Expected: PASS。

- [ ] **Step 7: 变异测试**

注释掉 Step 4 的 `if (query.subjectNo || query.subjectRole) {...}` 整块，重跑 `-t "第一批 · 按主体检索"`。Expected **FAIL**（前两条红）。撤销后恢复。

- [ ] **Step 8: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
git add src/modules/audit-logging/
git commit -m "feat(audit): 查询侧支持 subjectNo/subjectRole/outcome/actionDomain 过滤，详情返回 subjects"
```

---

## Task 4: V1 词表重建 + 声明校验

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Test: `src/modules/audit-logging/constants/audit-actions.constant.spec.ts`

**Interfaces:**
- Produces:
  - `const V1_AUDIT_ACTIONS: Record<string, AuditActionSpec>` —— 45 码，每码带 `domain` / `correlationMode` / `requiredFields` / `requiresCausation`
  - `interface AuditActionSpec { domain: string; correlationMode: AuditCorrelationMode; requiredFields: string[]; requiresCausation: boolean }`
  - `const DEPRECATED_AUDIT_ACTIONS: readonly string[]` —— 11 个退役码
  - `AuditLogsService.assertActionSpec(input)` —— 写入前按声明校验

- [ ] **Step 1: 写失败的测试**

在 `src/modules/audit-logging/constants/audit-actions.constant.spec.ts` 末尾追加：

```typescript
import { V1_AUDIT_ACTIONS, DEPRECATED_AUDIT_ACTIONS } from './audit-actions.constant';
import { AuditCorrelationMode } from '../dto/audit-log.dto';

describe('第一批 · V1 词表守则', () => {
  const codes = Object.keys(V1_AUDIT_ACTIONS);

  it('恰好 45 个码', () => {
    expect(codes).toHaveLength(45);
  });

  it('全部全局唯一（键即字面量，无重复）', () => {
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('六个后缀语义封闭，无例外', () => {
    const ok = /_(REQUESTED|APPLIED|COMPLETED|CANCELLED|EXPIRED|DENIED|GRANTED|SUBMITTED|DECLINED|DISPATCHED|ACCEPTED|INITIATED|BOUND|CONFIRMED|ISSUED|GENERATED|DOWNLOADED|QUERIED|RELEASED)$/;
    const bad = codes.filter((c) => !ok.test(c));
    expect(bad).toEqual([]);
  });

  it('每码都声明了四件事', () => {
    for (const c of codes) {
      const s = V1_AUDIT_ACTIONS[c];
      expect(typeof s.domain).toBe('string');
      expect(Object.values(AuditCorrelationMode)).toContain(s.correlationMode);
      expect(Array.isArray(s.requiredFields)).toBe(true);
      expect(typeof s.requiresCausation).toBe('boolean');
    }
  });

  it('前缀优先：同一趟流程的码共享前缀', () => {
    const expectCount: Record<string, number> = {
      'ADMIN_INVITE_': 5, 'ADMIN_FIRST_LOGIN_': 4, 'ADMIN_ROLE_CHANGE_': 3,
      'ADMIN_SUSPENSION_': 2, 'ADMIN_REACTIVATION_': 2, 'ADMIN_PASSWORD_RESET_': 6,
      'ADMIN_MFA_RESET_': 3, 'ADMIN_ACCOUNT_LOCK_': 2,
      'ROLE_DEFINITION_CREATE_': 3, 'ROLE_DEFINITION_MODIFY_': 3,
      'APPROVAL_POLICY_CHANGE_': 2, 'AUDIT_EVIDENCE_EXPORT_': 3,
    };
    for (const [p, n] of Object.entries(expectCount)) {
      expect(codes.filter((c) => c.startsWith(p))).toHaveLength(n);
    }
  });

  it('恰好 13 个 START', () => {
    expect(codes.filter((c) => V1_AUDIT_ACTIONS[c].correlationMode === AuditCorrelationMode.START))
      .toHaveLength(13);
  });

  it('退役码 11 个，且与在用码零交集', () => {
    expect(DEPRECATED_AUDIT_ACTIONS).toHaveLength(11);
    expect(DEPRECATED_AUDIT_ACTIONS.filter((d) => codes.includes(d))).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/audit-logging/constants/audit-actions.constant.spec.ts -t "第一批 · V1 词表守则"
```

Expected: FAIL —— `V1_AUDIT_ACTIONS` 未导出。

- [ ] **Step 3: 写词表**

在 `audit-actions.constant.ts` 末尾追加（**并删除旧的 `AuditGovernanceActions` 中 V1 相关 12 组**，交易域相关组保留不动）：

```typescript
import { AuditCorrelationMode } from '../dto/audit-log.dto';

export interface AuditActionSpec {
  /** actionDomain 列的值 */
  domain: 'IAM' | 'APPROVAL' | 'CONFIG' | 'AUDIT';
  /** 开启还是延续旅程——码的固有属性，不随场景变 */
  correlationMode: AuditCorrelationMode;
  /** 该码特有的必填字段（通用必填不在此列） */
  requiredFields: string[];
  /** 异步驱动的码必须带 causationId */
  requiresCausation: boolean;
}

const S = AuditCorrelationMode.START;
const I = AuditCorrelationMode.INHERIT;
const N = AuditCorrelationMode.NONE;

/**
 * V1 治理底座动作词表 —— 45 码，扁平全局唯一，前缀优先命名。
 * 每码出生即定死：新增码时必须当场声明四件事，不允许「先上线回头补」。
 * 一旦有记录用某码写入，再补必填规则时那些历史记录永远残缺且改不了（只增不改）。
 */
export const V1_AUDIT_ACTIONS: Record<string, AuditActionSpec> = {
  // ── 横切 · 审批引擎（8 个工作流共用）────────────────────────
  APPROVAL_SUBMITTED:  { domain: 'APPROVAL', correlationMode: I, requiredFields: ['policyCode', 'policyVersion'], requiresCausation: false },
  APPROVAL_GRANTED:    { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: false },
  APPROVAL_DECLINED:   { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  APPROVAL_CANCELLED:  { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo', 'reason'], requiresCausation: false },
  APPROVAL_EXPIRED:    { domain: 'APPROVAL', correlationMode: I, requiredFields: ['approvalNo'], requiresCausation: false },
  APPROVAL_SOD_DENIED: { domain: 'APPROVAL', correlationMode: I, requiredFields: ['reasonCode'], requiresCausation: false },

  // ── ① 入职邀请 ──────────────────────────────────────────
  ADMIN_INVITE_REQUESTED:  { domain: 'IAM', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  ADMIN_INVITE_DISPATCHED: { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_INVITE_ACCEPTED:   { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },
  ADMIN_INVITE_EXPIRED:    { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_INVITE_CANCELLED:  { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },

  // ── ② 首次登录（四步）───────────────────────────────────
  ADMIN_FIRST_LOGIN_IDENTITY_CONFIRMED: { domain: 'IAM', correlationMode: S, requiredFields: ['authnMethod'], requiresCausation: false },
  ADMIN_FIRST_LOGIN_MFA_INITIATED:      { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_FIRST_LOGIN_MFA_BOUND:          { domain: 'IAM', correlationMode: I, requiredFields: ['authnMethod'], requiresCausation: false },
  ADMIN_FIRST_LOGIN_COMPLETED:          { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },

  // ── ③ 角色绑定变更 ──────────────────────────────────────
  ADMIN_ROLE_CHANGE_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: [], requiresCausation: false },
  ADMIN_ROLE_CHANGE_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  ADMIN_ROLE_CHANGE_CANCELLED: { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ④⑤ 停用 / 恢复（代码里无取消路径，刻意不加 CANCELLED）──
  ADMIN_SUSPENSION_REQUESTED:   { domain: 'IAM', correlationMode: S, requiredFields: ['reason'], requiresCausation: false },
  ADMIN_SUSPENSION_APPLIED:     { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus', 'approvalNo'], requiresCausation: true },
  ADMIN_REACTIVATION_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: ['reason'], requiresCausation: false },
  ADMIN_REACTIVATION_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus', 'approvalNo'], requiresCausation: true },

  // ── ⑥ 密码重置（自助 / 官员代操作两条路各自成链）──────────
  ADMIN_PASSWORD_RESET_SELF_REQUESTED:    { domain: 'IAM', correlationMode: S, requiredFields: [], requiresCausation: false },
  ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED: { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_PASSWORD_RESET_SELF_COMPLETED:    { domain: 'IAM', correlationMode: I, requiredFields: [], requiresCausation: false },
  ADMIN_PASSWORD_RESET_OFFICER_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: ['onBehalfOfNo'], requiresCausation: false },
  ADMIN_PASSWORD_RESET_OFFICER_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['onBehalfOfNo', 'approvalNo'], requiresCausation: true },
  ADMIN_PASSWORD_RESET_CANCELLED:         { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: false },

  // ── ⑦ MFA 重置 ─────────────────────────────────────────
  ADMIN_MFA_RESET_REQUESTED: { domain: 'IAM', correlationMode: S, requiredFields: ['onBehalfOfNo'], requiresCausation: false },
  ADMIN_MFA_RESET_APPLIED:   { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus', 'approvalNo'], requiresCausation: true },
  ADMIN_MFA_RESET_CANCELLED: { domain: 'IAM', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ⑧ 账号锁定 / 解锁（业主裁定：连续失败自动锁定算业务审计）─
  ADMIN_ACCOUNT_LOCK_APPLIED:  { domain: 'IAM', correlationMode: S, requiredFields: ['reasonCode', 'fromStatus', 'toStatus'], requiresCausation: false },
  ADMIN_ACCOUNT_LOCK_RELEASED: { domain: 'IAM', correlationMode: I, requiredFields: ['fromStatus', 'toStatus'], requiresCausation: false },

  // ── ⑨ 角色定义（建 / 改）────────────────────────────────
  ROLE_DEFINITION_CREATE_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['afterData'], requiresCausation: false },
  ROLE_DEFINITION_CREATE_APPLIED:   { domain: 'CONFIG', correlationMode: I, requiredFields: ['afterData', 'approvalNo'], requiresCausation: true },
  ROLE_DEFINITION_CREATE_CANCELLED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },
  ROLE_DEFINITION_MODIFY_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  ROLE_DEFINITION_MODIFY_APPLIED:   { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'approvalNo'], requiresCausation: true },
  ROLE_DEFINITION_MODIFY_CANCELLED: { domain: 'CONFIG', correlationMode: I, requiredFields: ['reason'], requiresCausation: true },

  // ── ⑩ 审批策略变更（改策略自身走策略自己审批）──────────────
  APPROVAL_POLICY_CHANGE_REQUESTED: { domain: 'CONFIG', correlationMode: S, requiredFields: ['beforeData', 'afterData'], requiresCausation: false },
  APPROVAL_POLICY_CHANGE_APPLIED:   { domain: 'CONFIG', correlationMode: I, requiredFields: ['beforeData', 'afterData', 'policyVersion', 'approvalNo'], requiresCausation: true },

  // ── ⑪ 审计日志自身的操作 ────────────────────────────────
  AUDIT_EVIDENCE_EXPORT_REQUESTED:  { domain: 'AUDIT', correlationMode: S, requiredFields: [], requiresCausation: false },
  AUDIT_EVIDENCE_EXPORT_GENERATED:  { domain: 'AUDIT', correlationMode: I, requiredFields: ['payloadDigest'], requiresCausation: true },
  AUDIT_EVIDENCE_EXPORT_DOWNLOADED: { domain: 'AUDIT', correlationMode: I, requiredFields: ['sourceIp'], requiresCausation: false },
  AUDIT_LOG_QUERIED:                { domain: 'AUDIT', correlationMode: N, requiredFields: [], requiresCausation: false },
};

/**
 * 退役码：标记 deprecated、不再允许新写入、历史仍可读。不是删除。
 * 7 个 *_FAILED 收编进 outcome=FAILED + reasonCode；4 个登录码归安全日志（③）。
 */
export const DEPRECATED_AUDIT_ACTIONS: readonly string[] = [
  'FIRST_LOGIN_MFA_VERIFY_FAILED',
  'RESET_FAILED',
  'CHANGE_APPLY_FAILED',
  'ROLE_ACTIVATE_FAILED',
  'ROLE_MODIFY_FAILED',
  'MODIFICATION_APPLY_FAILED',
  'GENERATION_FAILED',
  'ADMIN_LOGIN_SUCCESS',
  'ADMIN_LOGIN_FAILED',
  'MFA_LOGIN_VERIFIED',
  'MFA_LOGIN_VERIFY_FAILED',
] as const;
```

- [ ] **Step 4: 服务层按声明校验**

在 `audit-logs.service.ts` 的 `recordByActor` 开头（`const db = ...` 之前）插入：

```typescript
    this.assertActionSpec(input);
```

并新增私有方法：

```typescript
  /**
   * 按词表声明做写入前校验。声明缺一项就拒绝写入——
   * 「条件必填」由此从一句文档变成硬闸门。
   * 未在 V1 词表里的码（交易域）暂不校验，留给交易域批次。
   */
  private assertActionSpec(input: CreateAuditLogEventDto): void {
    if (DEPRECATED_AUDIT_ACTIONS.includes(input.action)) {
      throw new BadRequestException(
        `Audit action ${input.action} is deprecated and no longer accepts new writes.`,
      );
    }

    const spec = V1_AUDIT_ACTIONS[input.action];
    if (!spec) return;

    if (input.actionDomain !== spec.domain) {
      throw new BadRequestException(
        `Audit action ${input.action} must carry actionDomain=${spec.domain}, got ${input.actionDomain}.`,
      );
    }

    const missing = spec.requiredFields.filter(
      (f) => (input as any)[f] === undefined || (input as any)[f] === null,
    );
    if (missing.length > 0) {
      throw new BadRequestException(
        `Audit action ${input.action} missing required field(s): ${missing.join(', ')}.`,
      );
    }

    if (spec.requiresCausation && !input.causationId) {
      throw new BadRequestException(
        `Audit action ${input.action} is asynchronously driven and must carry causationId.`,
      );
    }

    if (spec.correlationMode === AuditCorrelationMode.INHERIT && !input.correlationId) {
      throw new BadRequestException(
        `Audit action ${input.action} is INHERIT and must inherit an existing correlationId. ` +
          '读不到就是有问题（主单没落库，或 START 那步漏了）——绝不允许静默生成新值。',
      );
    }
  }
```

顶部 import 补 `V1_AUDIT_ACTIONS` / `DEPRECATED_AUDIT_ACTIONS` / `AuditCorrelationMode`。

- [ ] **Step 5: 补服务层的校验测试**

追加到 `audit-logs.service.spec.ts`：

```typescript
describe('第一批 · 声明校验', () => {
  beforeEach(() => {
    prisma.auditLogSubject = { createMany: jest.fn() };
    prisma.auditLogEvent.findUnique.mockResolvedValue(null);
    prisma.auditLogEvent.create.mockResolvedValue({ id: 'e', eventNo: 'A' });
  });

  it('缺声明里的必填字段时拒绝写入', async () => {
    await expect(service.recordSystem({
      action: 'ADMIN_ROLE_CHANGE_APPLIED', actionDomain: 'IAM',
      category: AuditCategory.GOVERNANCE, correlationId: 'c1', causationId: 'x1',
    } as any)).rejects.toThrow('missing required field');
  });

  it('INHERIT 的码没有 correlationId 时拒绝写入，不静默生成', async () => {
    await expect(service.recordSystem({
      action: 'ADMIN_INVITE_ACCEPTED', actionDomain: 'IAM',
      category: AuditCategory.GOVERNANCE, fromStatus: 'A', toStatus: 'B',
    } as any)).rejects.toThrow('must inherit an existing correlationId');
  });

  it('actionDomain 与声明不符时拒绝写入', async () => {
    await expect(service.recordSystem({
      action: 'AUDIT_LOG_QUERIED', actionDomain: 'IAM',
      category: AuditCategory.GOVERNANCE,
    } as any)).rejects.toThrow('must carry actionDomain=AUDIT');
  });

  it('退役码拒绝新写入', async () => {
    await expect(service.recordSystem({
      action: 'ADMIN_LOGIN_SUCCESS', actionDomain: 'IAM',
      category: AuditCategory.SECURITY,
    } as any)).rejects.toThrow('deprecated');
  });
});
```

- [ ] **Step 6: 跑测试确认通过**

```bash
npx jest src/modules/audit-logging/
```

Expected: 词表守则 7 条 + 声明校验 4 条全绿。

- [ ] **Step 7: 变异测试**

把 `assertActionSpec` 里 `if (spec.correlationMode === AuditCorrelationMode.INHERIT && !input.correlationId)` 整块注释掉，重跑 `-t "第一批 · 声明校验"`。Expected **FAIL**。撤销后恢复。

- [ ] **Step 8: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
git add src/modules/audit-logging/
git commit -m "feat(audit): V1 词表重建为 45 码（前缀优先）+ 每码声明与写入前机器校验"
```

---

## Task 5: 审批横切 6 码实装

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`
- Test: `src/modules/governance/approvals/approvals.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 契约 · Task 4 词表
- Produces: 审批引擎写出 6 码，全部带 `subjects[PRIMARY=审批单, RELATED=业务对象]`

- [ ] **Step 1: 写失败的测试**

```typescript
describe('第一批 · 审批横切 6 码', () => {
  it('提交审批写 APPROVAL_SUBMITTED，PRIMARY 是审批单、业务对象是 RELATED', async () => {
    const { service, auditLogsService, approvalCase } = buildSubmitFixture();
    await service.submit(buildSubmitInput());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'APPROVAL_SUBMITTED');
    expect(call).toBeDefined();
    expect(call[0].actionDomain).toBe('APPROVAL');
    expect(call[0].primarySubjectNo).toBe(approvalCase.approvalNo);
    expect(call[0].subjects).toEqual(expect.arrayContaining([
      expect.objectContaining({ subjectRole: 'PRIMARY', subjectNo: approvalCase.approvalNo }),
      expect.objectContaining({ subjectRole: 'RELATED' }),
    ]));
    expect(call[0].subjects.filter((s: any) => s.subjectRole === 'PRIMARY')).toHaveLength(1);
  });

  it('中间票的 fromStatus/toStatus 留空——审批单状态未变', async () => {
    const { service, auditLogsService } = buildTwoStepFirstVoteFixture();
    await service.approve(buildApproveInput());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'APPROVAL_GRANTED');
    expect(call[0].fromStatus).toBeUndefined();
    expect(call[0].toStatus).toBeUndefined();
  });

  it('末票推动单据状态，fromStatus/toStatus 有值', async () => {
    const { service, auditLogsService } = buildTwoStepLastVoteFixture();
    await service.approve(buildApproveInput());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'APPROVAL_GRANTED');
    expect(call[0].fromStatus).toBe('PENDING');
    expect(call[0].toStatus).toBe('APPROVED');
  });

  it('驳回的 outcome 是 SUCCESS——驳回这个动作成功执行了', async () => {
    const { service, auditLogsService } = buildRejectFixture();
    await service.reject(buildRejectInput());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'APPROVAL_DECLINED');
    expect(call[0].outcome).toBe('SUCCESS');
    expect(call[0].reason).toBeTruthy();
  });

  it('SoD 自审拦截写 APPROVAL_SOD_DENIED + outcome=DENIED', async () => {
    const { service, auditLogsService } = buildSelfApproveFixture();
    await expect(service.approve(buildApproveInput())).rejects.toThrow();

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'APPROVAL_SOD_DENIED');
    expect(call).toBeDefined();
    expect(call[0].outcome).toBe('DENIED');
    expect(call[0].reasonCode).toBe('SELF_APPROVE');
  });
});
```

> fixture 按本文件既有的构造方式实现。**不要裸写 mock 对象绕过 service** —— 本仓库有过 fixture 裸写导致断言恒绿的记录。

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/governance/approvals/approvals.service.spec.ts -t "第一批 · 审批横切 6 码"
```

Expected: FAIL —— 动作码仍是旧名、无 `subjects`、SoD 拦截无审计。

- [ ] **Step 3: 改写六处审计写入**

在 `approvals.service.ts` 中把三处既有写入改名并补字段，另新增三处。以 `APPROVAL_SUBMITTED` 为模板（其余五处同形状，只换 `action` / `outcome` / `requiredFields` 对应字段）：

```typescript
    await this.auditLogsService.recordByActor(
      {
        action: 'APPROVAL_SUBMITTED',
        actionDomain: 'APPROVAL',
        category: AuditCategory.GOVERNANCE,
        primarySubjectType: 'APPROVAL_CASE',
        primarySubjectNo: approvalCase.approvalNo,
        ownerCustomerNo: undefined,
        correlationId: businessCorrelationId,
        policyCode: policy.policyCode,
        policyVersion: policy.version,
        subjects: [
          { subjectType: 'APPROVAL_CASE',      subjectNo: approvalCase.approvalNo, subjectRole: AuditSubjectRole.PRIMARY },
          { subjectType: 'APPROVAL_POLICY',    subjectNo: policy.policyCode,       subjectRole: AuditSubjectRole.INSTRUMENT },
          { subjectType: approvalCase.entityType, subjectNo: approvalCase.entityNo, subjectRole: AuditSubjectRole.RELATED },
        ],
        sourcePlatform: 'ADMIN_API',
      },
      actorContext,
    );
```

**SoD 拦截处**（`DENY_SAME_USER_MAKER_CHECKER` 抛异常**之前**）新增：

```typescript
      await this.auditLogsService.recordByActor(
        {
          action: 'APPROVAL_SOD_DENIED',
          actionDomain: 'APPROVAL',
          category: AuditCategory.GOVERNANCE,
          primarySubjectType: 'APPROVAL_CASE',
          primarySubjectNo: approvalCase.approvalNo,
          correlationId: approvalCase.correlationId,
          outcome: AuditOutcome.DENIED,
          reasonCode: 'SELF_APPROVE',
          reason: 'Maker cannot approve own request (SoD)',
          subjects: [
            { subjectType: 'APPROVAL_CASE',         subjectNo: approvalCase.approvalNo, subjectRole: AuditSubjectRole.PRIMARY },
            { subjectType: approvalCase.entityType, subjectNo: approvalCase.entityNo,   subjectRole: AuditSubjectRole.RELATED },
          ],
          sourcePlatform: 'ADMIN_API',
        },
        actorContext,
      );
```

**`APPROVAL_EXPIRED`** 由 `expirePendingApprovals()` 用 `recordSystem` 写，`sourcePlatform: 'CRON'`。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/governance/approvals/
```

Expected: PASS。

- [ ] **Step 5: 变异测试**

注释掉 Step 3 中 SoD 拦截那整块 `recordByActor`，重跑 `-t "第一批 · 审批横切"`。Expected **FAIL**。撤销后恢复。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
npx jest
git add src/modules/governance/approvals/
git commit -m "feat(audit): 审批横切 6 码实装，新增 SOD_DENIED 拦截留痕"
```

---

## Task 6: V1 IAM 生命周期 12 码

**Files:**
- Modify: `src/modules/identity/users/admin-invite-workflow.service.ts`
- Modify: `src/modules/identity/users/mfa-binding-workflow.service.ts`
- Modify: `src/modules/identity/users/admin-role-binding-change-workflow.service.ts`
- Test: 各自的 `.spec.ts`

**Interfaces:**
- Consumes: Task 2 契约 · Task 4 词表
- Produces: 入职邀请 5 码 · 首次登录 4 码 · 角色变更 3 码（含新增 `ADMIN_ROLE_CHANGE_CANCELLED`）

- [ ] **Step 1: 写失败的测试**

在 `admin-invite-workflow.service.spec.ts` 追加：

```typescript
describe('第一批 · 入职邀请 5 码', () => {
  it('发起时 correlationMode=START：生成新 correlationId 并写回邀请记录', async () => {
    const { service, auditLogsService, prisma } = buildInviteFixture();
    await service.requestInvite(buildInviteInput());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_INVITE_REQUESTED');
    expect(call[0].correlationId).toBeTruthy();
    expect(call[0].afterData).toBeDefined();
    expect(prisma.adminUserInvitation.create.mock.calls[0][0].data.correlationId)
      .toBe(call[0].correlationId);
  });

  it('SoD 冲突时写 outcome=DENIED + reasonCode', async () => {
    const { service, auditLogsService } = buildInviteSodConflictFixture();
    await expect(service.requestInvite(buildInviteInput())).rejects.toThrow();

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].outcome === 'DENIED');
    expect(call[0].action).toBe('ADMIN_INVITE_REQUESTED');
    expect(call[0].reasonCode).toBe('SOD_CONFLICT');
  });

  it('接受邀请与账号激活合成一条 ADMIN_INVITE_ACCEPTED，带前后状态', async () => {
    const { service, auditLogsService } = buildAcceptInviteFixture();
    await service.acceptInvite(buildAcceptInput());

    const calls = auditLogsService.recordByActor.mock.calls
      .filter((c: any[]) => ['ADMIN_INVITE_ACCEPTED', 'ADMIN_ACCOUNT_ACTIVATED'].includes(c[0].action));
    expect(calls).toHaveLength(1);
    expect(calls[0][0].action).toBe('ADMIN_INVITE_ACCEPTED');
    expect(calls[0][0].fromStatus).toBeTruthy();
    expect(calls[0][0].toStatus).toBeTruthy();
  });

  it('链接过期由 cron 写 ADMIN_INVITE_EXPIRED，sourcePlatform=CRON', async () => {
    const { service, auditLogsService } = buildInviteExpiryFixture();
    await service.sweepExpiredInvites();

    const call = auditLogsService.recordSystem.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_INVITE_EXPIRED');
    expect(call).toBeDefined();
    expect(call[0].sourcePlatform).toBe('CRON');
  });
});
```

在 `admin-role-binding-change-workflow.service.spec.ts` 追加：

```typescript
describe('第一批 · 角色变更 3 码', () => {
  it('执行条必带前后角色列表', async () => {
    const { service, auditLogsService } = buildRoleChangeApplyFixture();
    await service.executeChange(buildChangeEvent());

    const call = auditLogsService.recordSystem.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_APPLIED');
    expect(call[0].beforeData).toBeDefined();
    expect(call[0].afterData).toBeDefined();
    expect(call[0].causationId).toBeTruthy();
  });

  it('取消路径写 ADMIN_ROLE_CHANGE_CANCELLED（本轮新增码）', async () => {
    const { service, auditLogsService } = buildRoleChangeCancelFixture();
    await service.executeTermination(buildCancelEvent(), 'CANCELLED');

    const call = auditLogsService.recordSystem.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_ROLE_CHANGE_CANCELLED');
    expect(call).toBeDefined();
    expect(call[0].reason).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/identity/users/ -t "第一批"
```

Expected: FAIL。

- [ ] **Step 3: 实装三个工作流的码**

按 Task 5 Step 3 的模板逐处改写。**关键约定**：

- `_REQUESTED` 类（`correlationMode=START`）：`const correlationId = randomUUID();`，**同事务**写回主实体的 `correlationId` 列
- `_APPLIED` / `_ACCEPTED` 等（`INHERIT`）：`correlationId: entity.correlationId`，读不到**不要兜底生成**（服务层会拒绝）
- 异步驱动的码（`requiresCausation: true`）：传入触发它的那条记录 id
- 接受邀请与账号激活**合成一条**（同事务、同 PRIMARY，判据甲乙均不触发）
- `mfa-binding-workflow.service.ts` 里原 `FIRST_LOGIN_MFA_VERIFY_FAILED` 改为 `ADMIN_FIRST_LOGIN_MFA_BOUND` + `outcome: AuditOutcome.FAILED` + `reasonCode: 'INVALID_CODE'`
- 原 `FIRST_LOGIN_MFA_VERIFY_LOCKED` 改为**另写一条** `ADMIN_ACCOUNT_LOCK_APPLIED`（它改变了访问能力，属另一件事）

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/identity/users/
```

Expected: PASS。

- [ ] **Step 5: 变异测试**

把 `ADMIN_ROLE_CHANGE_CANCELLED` 那处写入注释掉，重跑 `-t "第一批 · 角色变更"`。Expected **FAIL**。撤销后恢复。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
npx jest
git add src/modules/identity/users/
git commit -m "feat(audit): V1 IAM 生命周期 12 码实装（邀请/首登/角色变更，补 ROLE_CHANGE_CANCELLED）"
```

---

## Task 7: V1 IAM 凭证与状态 15 码

**Files:**
- Modify: `src/modules/identity/users/admin-suspension-workflow.service.ts`
- Modify: `src/modules/identity/users/admin-reactivation-workflow.service.ts`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.ts`
- Modify: `src/modules/identity/users/admin-mfa-reset-workflow.service.ts`
- Test: 各自的 `.spec.ts`

**Interfaces:**
- Consumes: Task 2 契约 · Task 4 词表
- Produces: 停用 2 · 恢复 2 · 密码重置 6 · MFA 重置 3 · 账号锁定 2 = 15 码

- [ ] **Step 1: 写失败的测试**

在 `admin-password-reset-workflow.service.spec.ts` 追加（**本 Task 最要紧的一条**）：

```typescript
describe('第一批 · 密码重置两条路各自成链', () => {
  it('自助路径走 SELF_* 三码，不走 OFFICER_*', async () => {
    const { service, auditLogsService } = buildSelfResetFixture();
    await service.requestSelfReset(buildSelfInput());
    await service.consumeToken(buildConsumeInput({ requestSource: 'SELF' }));

    const actions = auditLogsService.recordByActor.mock.calls.map((c: any[]) => c[0].action);
    expect(actions).toEqual(expect.arrayContaining([
      'ADMIN_PASSWORD_RESET_SELF_REQUESTED',
      'ADMIN_PASSWORD_RESET_SELF_TOKEN_ISSUED',
      'ADMIN_PASSWORD_RESET_SELF_COMPLETED',
    ]));
    expect(actions.filter((a: string) => a.includes('OFFICER'))).toEqual([]);
  });

  it('官员代操作走 OFFICER_* 两码，且带 onBehalfOfNo', async () => {
    const { service, auditLogsService, targetUser } = buildOfficerResetFixture();
    await service.requestOfficerReset(buildOfficerInput());
    await service.consumeToken(buildConsumeInput({ requestSource: 'OFFICER' }));

    const applied = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_PASSWORD_RESET_OFFICER_APPLIED');
    expect(applied).toBeDefined();
    expect(applied[0].onBehalfOfNo).toBe(targetUser.userNo);
    expect(applied[0].approvalNo).toBeTruthy();
  });

  it('令牌过期时 outcome=DENIED + reasonCode=TOKEN_EXPIRED', async () => {
    const { service, auditLogsService } = buildExpiredTokenFixture();
    await expect(service.consumeToken(buildConsumeInput())).rejects.toThrow();

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].outcome === 'DENIED');
    expect(call[0].reasonCode).toBe('TOKEN_EXPIRED');
  });

  it('自助请求被速率限制时 outcome=DENIED + reasonCode=RATE_LIMITED', async () => {
    const { service, auditLogsService } = buildRateLimitedFixture();
    await expect(service.requestSelfReset(buildSelfInput())).rejects.toThrow();

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].outcome === 'DENIED');
    expect(call[0].reasonCode).toBe('RATE_LIMITED');
  });
});
```

在 `admin-suspension-workflow.service.spec.ts` 追加：

```typescript
describe('第一批 · 停用 2 码', () => {
  it('发起与执行是两条记录，PRIMARY 都是目标 Admin', async () => {
    const { service, auditLogsService, targetUser } = buildSuspensionFixture();
    await service.requestSuspension(buildRequestInput());
    await service.executeSuspension(buildApprovedEvent());

    const req = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_SUSPENSION_REQUESTED');
    const app = auditLogsService.recordSystem.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_SUSPENSION_APPLIED');

    expect(req[0].primarySubjectNo).toBe(targetUser.userNo);
    expect(app[0].primarySubjectNo).toBe(targetUser.userNo);
    expect(app[0].fromStatus).toBeTruthy();
    expect(app[0].toStatus).toBeTruthy();
    expect(app[0].correlationId).toBe(req[0].correlationId);
  });

  it('刻意没有 CANCELLED 码——代码里无取消路径', () => {
    const src = require('fs').readFileSync(
      'src/modules/identity/users/admin-suspension-workflow.service.ts', 'utf8');
    expect(src).not.toContain('ADMIN_SUSPENSION_CANCELLED');
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/identity/users/ -t "第一批 · 密码重置"
```

Expected: FAIL。

- [ ] **Step 3: 实装 15 码**

**密码重置的分流是本 Task 的核心**。现有代码 `admin-password-reset-workflow.service.ts:452` 已按 `requestSource` 分流，改为新码：

```typescript
    const consumeAction =
      tokenRecord.requestSource === 'SELF'
        ? 'ADMIN_PASSWORD_RESET_SELF_COMPLETED'
        : 'ADMIN_PASSWORD_RESET_OFFICER_APPLIED';
```

`OFFICER_APPLIED` 分支必须补 `onBehalfOfNo` 与 `approvalNo`（词表声明为必填，缺了写入会被拒）。

**账号锁定**（`ADMIN_ACCOUNT_LOCK_APPLIED`）由 `auth.service.ts` 连续失败判定处触发，但**写入上收到 workflow 层**（见 Task 9）。本 Task 只实装 workflow 侧的方法与码。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/identity/users/
```

Expected: PASS。

- [ ] **Step 5: 变异测试**

把 Step 3 的 `consumeAction` 三元表达式改成恒返回 `'ADMIN_PASSWORD_RESET_SELF_COMPLETED'`，重跑 `-t "第一批 · 密码重置"`。Expected **FAIL**（官员那条红）。撤销后恢复。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
npx jest
git add src/modules/identity/users/
git commit -m "feat(audit): V1 IAM 凭证与状态 15 码实装（密码重置两条路拆开、停用恢复、账号锁定）"
```

---

## Task 8: V1 CONFIG + AUDIT 12 码

**Files:**
- Modify: `src/modules/identity/access-control/role-definition-create-workflow.service.ts`
- Modify: `src/modules/identity/access-control/role-definition-modify-workflow.service.ts`
- Modify: `src/modules/governance/approvals/approval-policy-change-workflow.service.ts`
- Modify: `src/modules/audit-logging/audit-evidence-export-workflow.service.ts`
- Modify: `src/modules/audit-logging/audit-logs.controller.ts`
- Test: 各自的 `.spec.ts`

**Interfaces:**
- Consumes: Task 2 契约 · Task 4 词表
- Produces: 角色定义 6 码 · 审批策略 2 码 · 审计日志自身 4 码（含新增 `AUDIT_LOG_QUERIED`）

- [ ] **Step 1: 写失败的测试**

```typescript
describe('第一批 · CONFIG 类必带前后值', () => {
  it('角色定义修改必带 beforeData/afterData，且只含变更项', async () => {
    const { service, auditLogsService } = buildRoleModifyFixture();
    await service.executeModify(buildModifyEvent());

    const call = auditLogsService.recordSystem.mock.calls
      .find((c: any[]) => c[0].action === 'ROLE_DEFINITION_MODIFY_APPLIED');
    expect(call[0].beforeData).toBeDefined();
    expect(call[0].afterData).toBeDefined();
    expect(Object.keys(call[0].afterData)).not.toContain('updatedAt');
  });

  it('审批策略变更有独立的 REQUESTED 码，不复用 APPROVAL_SUBMITTED', async () => {
    const { service, auditLogsService } = buildPolicyChangeFixture();
    await service.requestChange(buildPolicyChangeInput());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'APPROVAL_POLICY_CHANGE_REQUESTED');
    expect(call).toBeDefined();
    expect(call[0].primarySubjectType).toBe('APPROVAL_POLICY');
  });
});

describe('第一批 · AUDIT 域 4 码', () => {
  it('查审计日志写 AUDIT_LOG_QUERIED，isReadOnly=true、correlationMode=NONE 故无 correlationId', async () => {
    const { controller, auditLogsService } = buildQueryFixture();
    await controller.findAll({ ownerCustomerNo: 'CUS889' } as any, buildReq());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'AUDIT_LOG_QUERIED');
    expect(call).toBeDefined();
    expect(call[0].isReadOnly).toBe(true);
    expect(call[0].correlationId).toBeUndefined();
    expect(call[0].metadata.query).toBeDefined();
  });

  it('下载证据包 isReadOnly=true 且必带 sourceIp', async () => {
    const { service, auditLogsService } = buildDownloadFixture();
    await service.download(buildDownloadInput());

    const call = auditLogsService.recordByActor.mock.calls
      .find((c: any[]) => c[0].action === 'AUDIT_EVIDENCE_EXPORT_DOWNLOADED');
    expect(call[0].isReadOnly).toBe(true);
    expect(call[0].sourceIp).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest src/modules/identity/access-control/ src/modules/audit-logging/ -t "第一批 · CONFIG"
npx jest src/modules/audit-logging/ -t "第一批 · AUDIT 域"
```

Expected: FAIL。

- [ ] **Step 3: 实装 12 码**

**`AUDIT_LOG_QUERIED` 是新增能力**，在 `audit-logs.controller.ts` 的 `findAll` 里、返回结果之后写：

```typescript
  @Get()
  @ApiOperation({ summary: 'List audit log events' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async findAll(@Query() query: AuditLogQueryDto, @Req() req: any) {
    const result = await this.service.findAll(query);

    await this.service.recordByActor(
      {
        action: 'AUDIT_LOG_QUERIED',
        actionDomain: 'AUDIT',
        category: AuditCategory.GOVERNANCE,
        isReadOnly: true,
        ownerCustomerNo: query.ownerCustomerNo,
        subjects: query.ownerCustomerNo
          ? [{ subjectType: 'CUSTOMER', subjectNo: query.ownerCustomerNo, subjectRole: AuditSubjectRole.OWNER }]
          : undefined,
        sourceIp: req.ip,
        userAgent: req.headers?.['user-agent'],
        endpoint: 'GET /admin/audit-logs',
        sourcePlatform: 'ADMIN_API',
        metadata: { query, hitCount: result.total },
      },
      buildActorContext(req),
    );

    return result;
  }
```

> ⚠️ 这是**本批唯一允许 controller 直接写审计的例外**：查询这个动作**只存在于 controller 层**，没有对应的 workflow。词表已把它声明为 `correlationMode = NONE`。**其余 controller 一律不许写审计。**

**角色定义与审批策略**按 Task 5 模板改写，`beforeData`/`afterData` **只存变更项**，机械字段（`updatedAt`/`version`）不进。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/identity/access-control/ src/modules/audit-logging/ src/modules/governance/
```

Expected: PASS。

- [ ] **Step 5: 变异测试**

把 `AUDIT_LOG_QUERIED` 那整块 `recordByActor` 注释掉，重跑 `-t "第一批 · AUDIT 域"`。Expected **FAIL**。撤销后恢复。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
npx jest
git add src/modules/identity/access-control/ src/modules/audit-logging/ src/modules/governance/
git commit -m "feat(audit): V1 CONFIG+AUDIT 12 码实装（补 POLICY_CHANGE_REQUESTED 与 AUDIT_LOG_QUERIED）"
```

---

## Task 9: 打点上收 —— V1 域 4 个文件

**Files:**
- Modify: `src/modules/identity/auth/auth.service.ts`（8 处）
- Modify: `src/modules/identity/auth/customer-auth.service.ts`（10 处）
- Modify: `src/modules/identity/users/admin-invitations.service.ts`（3 处）
- Modify: `src/modules/identity/access-control/access-control.service.ts`（1 处）
- Test: 各自的 `.spec.ts`

**Interfaces:**
- Consumes: Task 4-8 的码与实装
- Produces: 四个文件零 `recordByActor`/`recordSystem` 调用；登录类打点删除（归安全日志），锁定类打点上收 workflow

- [ ] **Step 1: 写失败的测试**

```typescript
describe('第一批 · V1 域打点上收', () => {
  const files = [
    'src/modules/identity/auth/auth.service.ts',
    'src/modules/identity/auth/customer-auth.service.ts',
    'src/modules/identity/users/admin-invitations.service.ts',
    'src/modules/identity/access-control/access-control.service.ts',
  ];

  it.each(files)('%s 不再直接写审计', (f) => {
    const src = require('fs').readFileSync(f, 'utf8');
    expect(src).not.toMatch(/recordByActor|recordSystem/);
  });

  it('连续失败锁定改由 workflow 写 ADMIN_ACCOUNT_LOCK_APPLIED', async () => {
    const { service, auditLogsService } = buildLockoutFixture();
    await service.handleConsecutiveAuthFailure(buildFailureEvent());

    const call = auditLogsService.recordSystem.mock.calls
      .find((c: any[]) => c[0].action === 'ADMIN_ACCOUNT_LOCK_APPLIED');
    expect(call).toBeDefined();
    expect(call[0].reasonCode).toBe('CONSECUTIVE_AUTH_FAILURE');
    expect(call[0].fromStatus).toBeTruthy();
    expect(call[0].toStatus).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest -t "第一批 · V1 域打点上收"
```

Expected: FAIL —— 四个文件仍含审计调用。

- [ ] **Step 3: 逐文件处置**

| 文件 | 处置 |
|---|---|
| `auth.service.ts` | **删除全部 8 处审计调用**。登录成功/失败归安全日志（本项目不做）。连续失败达阈值时改为 `emit` 领域事件，由 workflow 层接住写 `ADMIN_ACCOUNT_LOCK_APPLIED` |
| `customer-auth.service.ts` | **删除全部 10 处**。同上，客户登录归安全日志 |
| `admin-invitations.service.ts` | **上收**到 `admin-invite-workflow.service.ts`。领域服务保留业务方法，审计由 workflow 写（它才拿得到 actor / 旅程 / 依据 / 多主体） |
| `access-control.service.ts` | **上收**到对应的角色定义 workflow |

**上收的通用做法**：领域服务**只返回结果**（含 `fromStatus`/`toStatus`/变更项），编排层拿到后写审计。领域服务的拒绝改为**抛带原因码的结构化异常**，编排层捕获后写 `outcome=DENIED`。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest src/modules/identity/
```

Expected: PASS。

- [ ] **Step 5: 全仓扫描确认 V1 域干净**

```bash
grep -rn "recordByActor\|recordSystem" \
  src/modules/identity/auth/ \
  src/modules/identity/users/admin-invitations.service.ts \
  src/modules/identity/access-control/access-control.service.ts \
  | grep -v "\.spec\."
```

Expected: **无输出**。

- [ ] **Step 6: 变异测试**

在 `src/modules/identity/auth/auth.service.ts` 里临时加回一句：

```typescript
    await this.auditLogsService.recordSystem({ action: 'X', actionDomain: 'IAM' } as any);
```

重跑：

```bash
npx jest -t "第一批 · V1 域打点上收"
```

Expected: **FAIL**（`auth.service.ts 不再直接写审计` 那条红）。删掉这句后重跑确认恢复 PASS。

> 不做这一步，那条 `expect(src).not.toMatch(...)` 有可能因为路径写错而**永远绿**——文件读不到时断言同样通过。

- [ ] **Step 7: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
npx jest
git add src/modules/identity/
git commit -m "refactor(audit): V1 域 4 个文件打点上收编排层，登录类打点删除归安全日志"
```

---

## Task 10: 打点上收 —— 其余 28 个文件

**Files:** 见设计稿 §10.3 的 A/B/C 三段清单（20 个领域服务 + 7 个适配层 + 1 个 controller）

**Interfaces:**
- Consumes: Task 2 的新契约
- Produces: 领域服务与 controller 零审计调用；适配层按定性保留者补齐 subjects 与三条追踪线

> **纯位置迁移**：只把写入从领域服务搬到编排层，**不改动作码、不改字段语义、不补任何字段**。
> 字段改名已在 Task 2 Step 8 一次做完，本 Task 不再涉及。
> 交易域记录的内容正确性（码对不对、subjects 有没有、拒绝路径接没接）**留给各域自己的任务**（业主 2026-08-25 裁定），本 Task 不碰。

- [ ] **Step 1: 写失败的测试**

```typescript
describe('第一批 · 全仓打点位置守则', () => {
  const { execSync } = require('child_process');

  it('领域服务零审计调用', () => {
    const out = execSync(
      `grep -rl "recordByActor\\|recordSystem" src/ | grep -v "\\.spec\\." || true`,
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);

    const allowed = /(workflow\.service\.ts|approvals\.service\.ts|audit-logs\.service\.ts|audit-logs\.controller\.ts|sla\.service\.ts|\.handler\.ts|demo-scenario\.service\.ts|audit-actions\.constant\.ts)$/;
    const violators = out.filter((f) => !allowed.test(f));
    expect(violators).toEqual([]);
  });

  it('controller 零审计调用（AUDIT_LOG_QUERIED 是唯一例外）', () => {
    const out = execSync(
      `grep -rl "recordByActor\\|recordSystem" src/ | grep "\\.controller\\.ts" || true`,
      { encoding: 'utf8' },
    ).trim().split('\n').filter(Boolean);
    expect(out).toEqual(['src/modules/audit-logging/audit-logs.controller.ts']);
  });
});
```

- [ ] **Step 2: 跑测试确认它失败**

```bash
npx jest -t "第一批 · 全仓打点位置守则"
```

Expected: FAIL —— 列出约 28 个违规文件。

- [ ] **Step 3: 逐个上收**

**A 段 · 20 个领域服务**：每个的审计调用移到其对应的 workflow 服务。领域服务改为返回结果 / 抛结构化异常。

**B 段 · 7 个适配层**（定性保留，但要补齐）：SLA 扫描服务与 webhook handler 属**编排性质**（拿得到 actor / 旅程 / 依据），保留原位但必须补 `subjects` 与三条追踪线；`demo-scenario.service.ts` 的写入标 `sourcePlatform: 'SCRIPT'`。

**C 段 · 1 个 controller**：`funds-orders.admin.controller.ts:82` 上收到对应 workflow。

- [ ] **Step 4: 跑测试确认通过**

```bash
npx jest -t "第一批 · 全仓打点位置守则"
```

Expected: PASS，两条断言均绿。

- [ ] **Step 5: 变异测试**

在任一已上收的领域服务里临时加回一句 `await this.auditLogsService.recordSystem({} as any);`，重跑。Expected **FAIL**。撤销后恢复。

- [ ] **Step 6: 闸门 + 提交**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
(cd admin-web  && npx tsc -b --noEmit)
(cd client-web && npx tsc -b --noEmit)
npx jest
git add src/
git commit -m "refactor(audit): 其余 28 个文件打点上收编排层（机械迁移，不改码不改语义）"
```

---

## Task 11: 端到端验收

**Files:**
- Create: `scripts/verify-audit.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: Task 1-10 全部产出
- Produces: `npm run verify:audit` —— 六个取证问题 + 三条不变量实跑，全过输出 `ALL AUDIT CHECKS PASS`，任一失败退出码非零

- [ ] **Step 1: 重铺数据并跑一轮 V1 业务**

```bash
bash scripts/stack.sh down main
rm -rf /tmp/exchange_js_main
bash scripts/stack.sh up main
bash scripts/on-stack.sh main demo:all
```

Expected: `demo:all` 输出 8/8 PASS。

> 必须重铺：本批重建了主表并新增子表，旧库 466 条历史记录没有子表行也没有新字段，直接查会全空且分不清是「功能没做」还是「老数据没有」。

- [ ] **Step 2: 写验收脚本**

创建 `scripts/verify-audit.ts`：

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
let failed = 0;

function check(name: string, ok: boolean, detail: string) {
  console.log(`${ok ? '✓' : '✗'} ${name} —— ${detail}`);
  if (!ok) failed += 1;
}

async function main() {
  // ── Q2 按单据查全部（含它只是「相关方」的事件）──────────────
  const anyPrimary = await prisma.auditLogSubject.findFirst({ where: { subjectRole: 'PRIMARY' } });
  if (!anyPrimary) {
    check('Q2 按单据查全部', false, '库里没有任何 PRIMARY 子表行，前置数据缺失');
  } else {
    const rows = await prisma.auditLogEvent.findMany({
      where: { subjects: { some: { subjectNo: anyPrimary.subjectNo } } },
      select: { eventNo: true, action: true },
    });
    check('Q2 按单据查全部', rows.length > 0, `${anyPrimary.subjectNo} 命中 ${rows.length} 条`);
  }

  // ── Q4 按客户查全部（客户从未被改，只作为 OWNER 出现）────────
  const anyOwner = await prisma.auditLogSubject.findFirst({
    where: { subjectRole: 'OWNER', subjectType: 'CUSTOMER' },
  });
  if (!anyOwner) {
    check('Q4 按客户查全部', false, '库里没有任何 OWNER=CUSTOMER 子表行');
  } else {
    const rows = await prisma.auditLogEvent.findMany({
      where: { subjects: { some: { subjectNo: anyOwner.subjectNo, subjectRole: 'OWNER' } } },
      select: { eventNo: true, primarySubjectType: true },
    });
    const notCustomerPrimary = rows.filter((r) => r.primarySubjectType !== 'CUSTOMER').length;
    check('Q4 按客户查全部', rows.length > 0 && notCustomerPrimary > 0,
      `${anyOwner.subjectNo} 命中 ${rows.length} 条，其中 ${notCustomerPrimary} 条主对象不是客户本人`);
  }

  // ── Q5 拒绝有痕 ──────────────────────────────────────────
  const denied = await prisma.auditLogEvent.findMany({
    where: { outcome: { not: 'SUCCESS' } },
    select: { eventNo: true, action: true, outcome: true, reasonCode: true },
  });
  const withCode = denied.filter((r) => !!r.reasonCode).length;
  check('Q5 拒绝有痕', denied.length > 0 && withCode === denied.length,
    `${denied.length} 条非 SUCCESS，其中 ${withCode} 条带 reasonCode`);

  // ── Q6 谁查过审计日志 ────────────────────────────────────
  const queried = await prisma.auditLogEvent.count({
    where: { action: 'AUDIT_LOG_QUERIED', isReadOnly: true },
  });
  check('Q6 谁查过审计日志', queried > 0, `${queried} 条 AUDIT_LOG_QUERIED`);

  // ── 不变量①：每条事件至多一个 PRIMARY ────────────────────
  const grouped = await prisma.auditLogSubject.groupBy({
    by: ['eventId'], where: { subjectRole: 'PRIMARY' }, _count: { _all: true },
  });
  const multiPrimary = grouped.filter((g) => g._count._all > 1);
  check('不变量① PRIMARY 至多一个', multiPrimary.length === 0,
    multiPrimary.length === 0 ? '全部合规' : `${multiPrimary.length} 条事件挂了多个 PRIMARY`);

  // ── 不变量②：INHERIT 的码必须有 correlationId ─────────────
  const inheritCodes = ['ADMIN_SUSPENSION_APPLIED', 'ADMIN_ROLE_CHANGE_APPLIED', 'APPROVAL_GRANTED'];
  const orphan = await prisma.auditLogEvent.count({
    where: { action: { in: inheritCodes }, correlationId: null },
  });
  check('不变量② INHERIT 必有 correlationId', orphan === 0,
    orphan === 0 ? '无孤儿记录' : `${orphan} 条 INHERIT 记录缺 correlationId`);

  // ── 不变量③：退役码零新写入 ──────────────────────────────
  const deprecated = await prisma.auditLogEvent.count({
    where: { action: { in: ['ADMIN_LOGIN_SUCCESS', 'RESET_FAILED', 'MFA_LOGIN_VERIFIED'] } },
  });
  check('不变量③ 退役码零写入', deprecated === 0, `${deprecated} 条退役码记录`);

  // ── V1 词表覆盖率 ────────────────────────────────────────
  const used = await prisma.auditLogEvent.groupBy({ by: ['action'] });
  const v1Used = used.filter((u) =>
    /^(APPROVAL_|ADMIN_|ROLE_DEFINITION_|AUDIT_)/.test(u.action)).length;
  check('V1 词表已被使用', v1Used > 0, `${v1Used} 个 V1 码有真实写入`);

  console.log('');
  console.log(failed === 0 ? 'ALL AUDIT CHECKS PASS' : `FAIL: ${failed} check(s) failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main();
```

- [ ] **Step 3: 注册 npm 脚本**

在 `package.json` 的 `scripts` 里，`verify:coa` 那一行之后加：

```json
    "verify:audit": "ts-node -r tsconfig-paths/register scripts/verify-audit.ts",
```

- [ ] **Step 4: 跑验收**

```bash
bash scripts/on-stack.sh main verify:audit
```

Expected:

```
✓ Q2 按单据查全部 —— XXX 命中 N 条
✓ Q4 按客户查全部 —— CUSXXX 命中 N 条，其中 M 条主对象不是客户本人
✓ Q5 拒绝有痕 —— K 条非 SUCCESS，其中 K 条带 reasonCode
✓ Q6 谁查过审计日志 —— N 条 AUDIT_LOG_QUERIED
✓ 不变量① PRIMARY 至多一个 —— 全部合规
✓ 不变量② INHERIT 必有 correlationId —— 无孤儿记录
✓ 不变量③ 退役码零写入 —— 0 条退役码记录
✓ V1 词表已被使用 —— N 个 V1 码有真实写入

ALL AUDIT CHECKS PASS
```

> **Q4 的 `M > 0` 是关键判据**：它证明「客户从未被改、但按客户号仍检索得到」——这正是子表存在的全部理由。判据写松了这个 Task 就白验了。

- [ ] **Step 5: 变异测试 —— 证明这个脚本不是恒绿**

依次做三次，每次改完跑 `bash scripts/on-stack.sh main verify:audit`，确认**变红且指向正确的那一条**，然后撤销：

1. 手工插一条多 PRIMARY 的子表行：
   ```bash
   sqlite3 /tmp/exchange_js_main/dev.db "
     INSERT INTO audit_log_subjects (id,eventId,subjectType,subjectNo,subjectRole,occurredAt)
     SELECT 'mutant-1', eventId, 'X', 'X1', 'PRIMARY', occurredAt
     FROM audit_log_subjects WHERE subjectRole='PRIMARY' LIMIT 1;"
   ```
   Expected: `✗ 不变量① PRIMARY 至多一个 —— 1 条事件挂了多个 PRIMARY`，退出码非零。
   撤销：`sqlite3 ... "DELETE FROM audit_log_subjects WHERE id='mutant-1';"`

2. 手工清掉一条 INHERIT 记录的 `correlationId`：
   ```bash
   sqlite3 /tmp/exchange_js_main/dev.db "
     UPDATE audit_log_events SET correlationId=NULL
     WHERE action='APPROVAL_GRANTED' AND correlationId IS NOT NULL LIMIT 1;"
   ```
   Expected: `✗ 不变量② INHERIT 必有 correlationId`。撤销靠重跑 `demo:all`。

3. 把脚本里 Q4 的判据从 `notCustomerPrimary > 0` 改成 `rows.length > 0`，重跑 —— **它应该照样绿**。这证明**松判据验不出东西**，是为什么必须用 `M > 0`。看完把判据改回去。

> 三次变异不能省。`verify:coa` 当年就出过「两条恒等式全绿但账已经错了」的先例——**验收脚本自己不被验证，就只是一个让人安心的摆设**。

- [ ] **Step 6: 五道闸门全跑**

```bash
npx tsc --noEmit -p tsconfig.json
npx tsc --noEmit -p tsconfig.test.json
(cd admin-web  && npx tsc -b --noEmit)
(cd client-web && npx tsc -b --noEmit)
npx jest
```

Expected: 前四道 0 错；`npx jest` **净新失败 = 0**（已知基线 3 suites / 4 tests 红不算）。

- [ ] **Step 7: 提交**

```bash
git add scripts/verify-audit.ts package.json
git commit -m "test(audit): 加 verify:audit 端到端验收（四个取证问题 + 三条不变量）"
```

---

## 收尾：文档同步

- [ ] **Step 1: 同步 truth**

在 `doc-final/reference/truth/v1-governance-audit.md` 的「审计」一节改写：`audit_log_events` 按应然十组字段重建（`outcome` 四值 / `workflowType` 停用 / `updatedAt` 已删）· 子表 `audit_log_subjects` 已建（五角色、唯一键含角色）· V1 词表 45 码 + 每码声明 + 写入前机器校验 · 打点全部上收编排层（`AUDIT_LOG_QUERIED` 是唯一 controller 例外）。刷新 `Last Verified` 为 `2026-08-25`。

- [ ] **Step 2: 同步 rules**

在 `doc-final/rules/audit-logging.md` 全面改写：新字段名与四值枚举 · `subjectRole` 五值 · 拆条两判据 · 六个后缀命名规则 · 每码出生即定死 · 打点必须在编排层 · 五条约定。**删除已废止的 `workflowId`/`triggerType`/`module` 段落，并把 `subjectNos[]` 查询契约改为 `subjects` 的新形状**（该契约此前要求与实现脱节，本批兑现）。

- [ ] **Step 3: 登记 BACKLOG**

在 `doc-final/BACKLOG.md` 新增「审计日志重构 · 第一批之后仍欠的账」一节，逐条登记：三个交易域的日志梳理 · `workflowType` 物理删列（过渡层例外，清理时点＝交易域批次）· 交易域词表瘦身（496→59）· `seq`/哈希链校验工具 · `legalHold` 运维流程 · 回放对账 · `AUDIT_LOG_QUERIED` 查询规模分级。每条链回设计稿对应小节。

- [ ] **Step 4: 提交**

```bash
git add doc-final/
git commit -m "docs(audit): 同步第一批 truth 与 rules，登记后续欠账"
```

---

## 验收标准（对齐设计稿 §15）

| # | 标准 | 怎么验 |
|---|---|---|
| 1 | 表结构齐备，`updatedAt` 已删 | Task 1 Step 4 |
| 2 | 命名与枚举全按应然 | Task 2 单测 + `tsc` 全绿 |
| 3 | 子表可用，五角色齐，唯一键含 `subjectRole` | Task 1 Step 4 |
| 4 | `PRIMARY` 唯一性守卫生效，零个合法 | Task 2 单测 + Task 11 不变量① |
| 5 | **按客户查得到**，判据 `M > 0` | Task 11 Q4 |
| 6 | 按依据查得到 | Task 11 Q2 同款查询换 `subjectNo` |
| 7 | 拒绝有痕，8 个 DENIED 码各有记录 | Task 11 Q5 |
| 8 | `INHERIT` 读不到即报错，不静默生成 | Task 4 单测 + Task 11 不变量② |
| 9 | 打点全部在编排层 | Task 10 守则测试（全仓扫描） |
| 10 | V1 词表 45 码实装，11 退役码零写入 | Task 4 词表守则 + Task 11 不变量③ |
| 11 | 每码声明四项齐备且可机器校验 | Task 4 词表守则 |
| 12 | 六个取证问题在 V1 域可答 | Task 11 |
| 13 | 断言不是自证型绿灯 | 每个 Task 的变异测试步骤 |
| 14 | 硬闸 | 五道闸门，净新失败 = 0 |

---

## 本批之后仍欠的账（进 BACKLOG，不在本计划内做）

| 项 | 去向 |
|---|---|
| 三个交易域（充值/提现/兑换）的日志梳理：动作码、subjects 填充、拒绝路径接入 | 第二批 |
| `workflowType` 物理删列 | 第二批（交易域批次，**本批唯一的过渡层例外**） |
| 交易域词表瘦身 496 → 实际在用量级 | 第二批 |
| `seq` 与哈希链的校验工具（列本批已建） | 第三批 |
| `legalHold` 的触发与解除运维流程（列本批已建） | 第三批 |
| 回放对账 / 覆盖率闸门 | 业主裁定本期不做，方法见设计稿 §11 |
| `AUDIT_LOG_QUERIED` 的查询规模分级 | 后续，本批先无差别记录 |
| 安全日志（③）建设 | 归运维，本项目不做 |
