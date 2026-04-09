# Deferred Refactors Registry

> **Scope:** project-wide cross-cutting cleanup items that are intentionally deferred. Every new refactor that someone decides not to tackle immediately should land here with enough context that a future engineer (or the same engineer 3 months later) can pick it up without digging through chat history.
>
> **Audience:** anyone about to start architectural work. Check this list first so you can fold related items into your scope.
>
> **Updated:** whenever a deferred item is added, closed, or revised.

## How to use this registry

- **Adding an item:** include the *what*, *why it was deferred*, *who will be unblocked when it lands*, and *estimated effort tier* (S / M / L).
- **Closing an item:** strike it through and link the PR or plan file that closed it. Do not delete — history of decisions matters.
- **Priority:** items within each section are loosely ordered by "how much pain is it causing right now". Bump as needed.

---

## Architectural cleanup

### 1. SWAP workflow should propagate a single shared `traceId` across payin/payout/swap-transaction sub-entities

**Context:** Prior to 2026-04, `audit_log_events` had a dedicated `resolveSwapWorkflowSearchExpansion` query path (audit-logs.service ~line 1335) that let operators filter SWAP audit history by `workflowNo` — the only place in the codebase that needed cross-trace joining, because SWAP sub-entities each generated their own traceId. That expansion code was deleted as part of `2026-04-08-audit-trace-context-and-onboarding-cleanup`, along with `workflowId/workflowNo` columns on `audit_log_events`.

**What needs to happen:** `SwapTransactionWorkflowService` (and its payin/payout bridges) should assign one shared `traceId` to every audit row inside a single swap's lifecycle. Once this is done, operators can filter SWAP history with `WHERE traceId = <swap trace>` and get the same result the old workflowNo expansion used to give.

**Who is blocked:** SWAP operators. Current impact is low because SWAP audit searches are mostly done by swap identifier, not cross-trace.

**Effort:** M — touches `SwapTransactionWorkflowService`, `PayinsService`, `PayoutsService`, plus end-to-end tests that verify the shared traceId.

### 2. Converge `action` naming to `<WORKFLOW_TYPE>_<VERB>` prefix convention

**Context:** `audit_log_events.workflowType` is a denormalized category label that could theoretically be derived from a strict `action` prefix convention (e.g. `ADMIN_LOGIN_FAILED` → workflowType `ADMIN_LOGIN_ACCESS`). Today's action names are inconsistent: some start with the entity (`USER_ROLE_BINDING_UPDATED`), some with the workflow (`CHANGE_TICKET_CREATED`), some with neither (`ACCOUNT_LOCKED`). Enforcing the prefix would let us drop `workflowType` as a column in a future cleanup.

**What needs to happen:** define the canonical prefix per workflow, rename all `AuditActions.*` constants + their call sites, add a lint-time regex check to `ACTION_NAME_RE` in `audit-logs.service.ts` that enforces the prefix.

**Who is blocked:** nobody immediately. This is an architectural simplification for the next Wave cleanup.

**Effort:** L — touches ~100 action name constants and ~400 references across services + specs.

### 3. Business-table `workflowId/workflowNo` columns on `admin_user_invitations`

**Context:** The invitation row stores `workflowType/workflowNo/traceId` columns that were populated by the governance layer to propagate audit context. After the audit log cleanup, these columns are dead weight — they're read back only to reconstruct an audit context that no longer needs `workflowNo`. Only `traceId` remains useful.

**What needs to happen:** drop `workflowType` and `workflowNo` columns from `admin_user_invitations`, keep `traceId`. Update `AdminInvitationsService.findLatestInvitationAuditContext` to return only `{ traceId }`. Update callers.

**Who is blocked:** nobody. Mild schema hygiene.

**Effort:** S — ~20 lines across 2-3 files + SQLite migration.

### 4. Business-table workflow columns on `customer_main` (if any survive after the onboarding cleanup)

**Context:** `customer_main.activeJourneyId` was removed in the 2026-04-08 cleanup. Audit that no other business table has triple-purposed "journey identifier" columns that should be narrowed.

**What needs to happen:** grep for similar patterns in `corporate_profiles`, `ubo_profiles`, etc. Deduplicate if found.

**Who is blocked:** nobody.

**Effort:** S — investigation + small fixes.

---

## Gotchas learned the hard way

### Use `ALTER TABLE DROP COLUMN`, not table-recreate, for SQLite 3.35+ column drops

**Context:** The 2026-04-08 cleanup originally tried two SQLite table-recreate migrations (`20260408020000_drop_customer_active_journey_id` and `20260408030000_drop_audit_log_workflow_id_no`) using the `CREATE TABLE x_new AS SELECT ... FROM x; DROP TABLE x; ALTER TABLE x_new RENAME TO x;` pattern. This pattern is **broken for this use case** because:

1. **`CREATE TABLE ... AS SELECT` loses ALL constraints.** The new table has no PRIMARY KEY, no UNIQUE, no NOT NULL, no DEFAULTs — it's a plain copy. After rename, `PRAGMA table_info(x)` shows every column with PK=0 and NOT NULL=0. The old constraints are silently gone.
2. **Foreign keys pointing at the recreated table break.** SQLite's FK resolution fails with "foreign key mismatch" at runtime because the referenced column no longer has a PRIMARY KEY or UNIQUE constraint. In our case, 17 tables (deposit_transactions, payouts, periodic_review_cycles, audit_log_subject_nos, etc.) had broken FKs after the recreates.
3. **Trigger dependencies need manual handling.** When `DROP TABLE x` runs, SQLite tries to re-validate every trigger whose body references `x` and errors out with "no such table". Requires `DROP TRIGGER IF EXISTS` before the table drop + recreate after.

**Use the simpler native path instead.** SQLite 3.35+ (March 2021) supports `ALTER TABLE ... DROP COLUMN` as long as the column is not part of a PRIMARY KEY, UNIQUE constraint, FOREIGN KEY, or INDEX. For the common case of dropping a nullable unindexed column, this is ONE statement:

```sql
ALTER TABLE "customer_main" DROP COLUMN "activeJourneyId";
```

If the column is in an index, drop the index first:

```sql
DROP INDEX IF EXISTS "audit_log_events_workflowType_workflowNo_occurredAt_idx";
ALTER TABLE "audit_log_events" DROP COLUMN "workflowId";
ALTER TABLE "audit_log_events" DROP COLUMN "workflowNo";
```

**Rule for any future SQLite column-drop migration:**
1. First try `ALTER TABLE ... DROP COLUMN`. If the column is not in a PK / UNIQUE / FK / INDEX, this just works and preserves everything else.
2. If the column IS in an index, drop the index first (`DROP INDEX IF EXISTS`), then drop the column.
3. If the column IS a PK / UNIQUE / FK (truly needs a schema restructure), only then fall back to the table-recreate pattern — AND use explicit `CREATE TABLE new (...)` with full constraint definitions, not `CREATE TABLE new AS SELECT`, AND handle dependent triggers (drop before, recreate after), AND remember that FKs on OTHER tables referencing the recreated table will need to be rebuilt via a `VACUUM` or separate migration.

**Effort to add this to a migration conventions doc if one is ever created:** S.

---

## Documentation debt

### 5. Update `docs/constraints/onboarding-flow-constraints.md` with the new trace rules

**Context:** `docs/constraints/onboarding-flow-constraints.md` does not yet mention `onboardingTraceId`, the new sumsub audit write path, or the removal of `activeJourneyId`. It should cross-reference `audit-trace-context-constraints.md` and explain how onboarding traces are generated and inherited.

**Who is blocked:** anyone reading the onboarding constraints to build new onboarding-adjacent work.

**Effort:** S — 1 section append.

### 7. Sumsub transaction + behavior event mirroring pipeline

**Context:** Wave 3 firm-driven customer review v1 **不**把我们的交易（deposit / withdraw / swap）和行为事件（login / device change / 2FA reset）mirror 到 Sumsub 的 Transaction Monitoring / Behavior Monitoring API。这意味着 Sumsub 的 applicant risk score 在 onboarding 后基本不再更新，Layer 2 的评级管道只能依靠 AML 重筛结果 + 我们本地自研的简单行为打分，而不能利用 Sumsub Workflow Builder + Custom Rules Engine 的加权评分能力。这是一个有意的 scope 裁剪，为了 v1 更快上线。

**What needs to happen:**

- 新建一张 `sumsub_mirror_event` outbox 表（follow outbox pattern，保证可靠投递）
- 拦截所有资金事件 + 关键行为事件写数据库时同步 enqueue outbox 行
- 后台 worker 消费 outbox → `POST /resources/applicants/-/kyt/txns/-/data`（[Sumsub Submit Transaction API](https://docs.sumsub.com/reference/submit-transaction-for-existing-applicant)）
- 处理 Sumsub 返回的同步打分 + 后续 `applicantReviewed` webhook（路由到 Layer 2/3）
- 重试策略 + dead letter queue
- 在 Sumsub Dashboard 配置 Custom Rules（按我们定义的加权评分方法）
- 更新 `client-risk-assessment-policy-v1.md` 把 Sumsub score 纳入聚合公式
- 调整 Layer 2 的 `applyPolicy` 从"AML labels + 本地评分" 切换到"Sumsub 加权 score 为主"
- 更新 ClientRiskAssessment schema 把 `sumsubRiskScore` 和 `sumsubTags` 字段从"可选占位" 升级为"必填核心"

**Who is blocked:** 需要完整动态风险画像的生产环境。demo / 内部测试用本地自研打分够了。

**Effort:** L —— 5-7 天工作量。outbox 表 + worker + retry + DLQ 本身是独立基建。外加 Sumsub Dashboard 规则配置 + 对 existing customers 的反向 replay（把 onboarding 之后积累的交易 backfill 到 Sumsub）。

---

### 6. Draft Wave 3 firm-driven customer review policy documents

**Context:** Wave 3 周期审查重设计（firm-driven Layer 2 `ClientRiskAssessment` 风险评级 + Layer 3 `MaterialRefreshCycle` 材料续档）落地时，VARA III.D.7 明确要求 VASP 自己定义 "criteria and methodology" 的客户风险评估方法学文档。设计阶段决定把 policy 的实际数字（tier mapping、material windows、signoff 角色矩阵）内嵌到 design 文档的表格里作为临时 reference，两份独立 policy 文件本身暂缓成稿，避免 plan 启动被文档 ceremony 阻塞。

**What needs to happen:** 在合适的时机单独产出两份独立文档：

- `docs/specs/policies/client-risk-assessment-policy-v1.md`
  —— Layer 2 的 tier mapping（Sumsub riskScore → LOW/MEDIUM/HIGH）、signoff rules（方案 B 的自动/人工矩阵）、Sumsub Custom Rules Engine 配置映射表，对应 VARA III.D.7 的 "criteria and methodology" 要求
- `docs/specs/policies/material-refresh-policy-v1.md`
  —— Layer 3 的材料目录（哪些材料、哪些 tier 需要）、各材料的 `windowDays` 按 risk tier 差异化值、stage timeline（`-30 / -7 / 0 / +30`）、initialCollectionWindow、Sumsub Applicant Action level 映射

两份文档发布时需要 MLRO + SENIOR_MANAGEMENT_OFFICER 双签；发布后 `ClientRiskAssessment.policyVersion` 字段引用其版本号，`MaterialRefreshCycle` 在 trace 里引用 `material-refresh-policy-v1.md` 的版本号。

**Who is blocked:** 正式 VARA audit 时会要求出示这两份独立文档。demo 阶段和内部开发不受阻 —— 临时 reference 在 design 文档内已有，运行时逻辑直接编码在 policy config 里。

**Effort:** M —— 两份约 400 行的 policy 文档，需要和合规对齐数字（windows、tier 阈值、signoff 角色、频率）并走双签流程。

---

## Conventions

- When an item is closed: prefix the heading with `~~` and append `**→ closed by [plan file / PR]**` at the end of the section.
- When a new item is added mid-sprint: put it at the bottom of the relevant section, not at the top. Order matters as a weak priority signal.
- When an item blocks something in-flight: escalate it out of this file and into an actual plan file under `docs/superpowers/plans/`.
