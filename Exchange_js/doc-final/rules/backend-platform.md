# Backend Platform Rules
Last Updated: 2026-04-30 | Scope: Wave 1+ | Source: architectural decisions

---

## Architecture & Module Boundaries

- Direct DB access must go through `PrismaService` inside services only.
- Must not introduce cross-module circular dependencies.
- Must not let one module directly mutate another module's workflow root state outside the root owner service.
- Cross-module service calls must use canonical entrypoints — no backdoor calls that skip policy checks.

## Service Layer Architecture

Three mandatory layers. Every new service file must declare which layer it belongs to before implementation.

### Layer 1 — Domain Service (`[domain].service.ts`)
- Owns data operations and entity-level invariants for one subject (uniqueness, valid status transitions, required fields).
- Write methods must accept an optional `tx: Prisma.TransactionClient` parameter so workflows can compose atomic operations.
- May emit internal domain events when own entity state changes significantly (see Internal Domain Events below).
- Must NOT write business audit logs.
- Must NOT subscribe to internal domain events.
- Must NOT contain cross-entity flow logic.
- **Delivery requirement:** before a domain service is considered complete, it must explicitly declare: (1) allowed status transitions, (2) uniqueness constraints, (3) preconditions required before any write method may be called.

### Layer 2 — Approval Sub-Workflow (`[type]-approval.service.ts`)
- One file per approval action type; each type is meaningfully different because it carries its own step configuration, SoD rules, and timeout policy.
- All files extend a shared `ApprovalHandlerBase` abstract class. Each subclass provides exactly 4 constants: `actionType`, `workflowType`, `auditActions`, `entityType`. The base class provides all `@OnEvent` handler implementations.
- Writes approval-layer audit logs only: `APPROVAL_GRANTED`, `APPROVAL_DECLINED`, `APPROVAL_CANCELLED`.
- Must NOT execute business actions (token generation, status updates, role changes, account suspension, etc.). Business actions after approval belong in the corresponding workflow.
- Must NOT emit or subscribe to internal domain events.

### Layer 3 — Workflow (`[domain]-workflow.service.ts`)
- Represents one user or system journey from start to finish.
- Orchestrates domain services and calls `approvalsService` to initiate approval sub-workflows.
- Writes all business audit logs for the journey (REQUESTED, GRANTED outcomes with business context, COMPLETED, FAILED, etc.).
- Subscribes to internal domain events and to approval decision events relevant to its journey.
- Business actions that follow an approval decision (creating tokens, updating statuses, triggering downstream steps) live here, not in the approval sub-workflow.
- traceId is generated at journey initiation and threaded explicitly through every downstream call and audit log write.
- **Must NOT write to any domain entity's Prisma table directly.** All domain entity writes must go through the corresponding domain service method. Bypassing the domain service breaks invariant enforcement.
- Customer workflows and admin workflows use the same three-layer architecture. Differences are implementation details only: actor type (`recordByActor` vs `recordSystem`), auth layer (RBAC vs customer JWT), and whether a maker-checker approval gate exists.

### Cross-Module Communication Rules
- **External signals** (webhooks, blockchain events) → ingestion/adapter layer normalises and re-emits as internal domain events → workflow subscribes. Ingestion layer broadcasts because it does not know which workflows care.
- **Scheduled triggers** (cron jobs) → a dedicated sweep/adapter service owns the `@Cron` decorator, finds candidates, and calls the target workflow directly. `@Cron` must NOT appear in workflow or domain service files. Sweep calls directly (not via event) because the relationship is one-to-one and per-item error handling is required.
- **Internal cross-module cascade** (entity A state change drives entity B) → domain service emits event → workflow subscribes.
- **Explicit cross-module action** (one workflow needs a service in another module) → direct service call to the target module's canonical entrypoint.
- Decision rule: if the trigger source does not know who cares → broadcast (event). If the trigger source knows exactly which workflow to call → direct call.
- Must NOT use `forwardRef()` to resolve circular dependencies; circular imports indicate a layer violation that must be fixed structurally.

### Pre-Flight Checklist — Before Developing Any Workflow
A workflow may not begin development until all of the following are defined and documented:
1. **Trigger**: human action / external signal / internal domain event — which one starts this workflow?
2. **Emitted events**: which internal domain events does this workflow emit, and when?
3. **Subscribed events**: which internal domain events does this workflow subscribe to?
4. **Direct cross-module dependencies**: which other modules' services are called directly?
5. **Audit actions**: which audit log actions does this workflow write, in what sequence?
6. **Approval sub-workflow**: if an approval gate exists, which `[type]-approval.service.ts` handles it?

## Controllers

- Controllers handle transport only: parse request, validate input, call the appropriate workflow or query service, return response.
- Controllers must NOT call `AuditLogsService` directly. All audit log writes belong in the workflow or approval sub-workflow layer. A controller writing audit logs directly means audit coverage depends on which HTTP path was used, not on which business event occurred.
- Controllers must NOT contain business logic or status transition decisions.

## Accounting Adapter

- `AccountingService` is a thin adapter layer that translates domain semantics into TigerBeetle accounts and transfers. It contains no business logic or decision-making.
- Workflows call `AccountingService` directly and synchronously. If the accounting call fails, the workflow fails — there is no silent background retry. This preserves TigerBeetle's ACID guarantee.
- Must NOT route accounting through internal domain events. Event-based accounting would convert a synchronous ACID guarantee into eventual consistency, which is unacceptable for financial operations.
- TigerBeetle is the source of truth for balances. Prisma retains human-readable journal entries (凭证) as audit evidence and read model only.
- A workflow that requires accounting must call `AccountingService` before marking the business entity as complete. If accounting fails, the entity status must not advance.
- On-chain transfers produce two independent accounting events that must never be merged into a single TB Transfer: (1) Business accounting — executed at workflow decision time with known amounts (customer balance change, fee capture, order completion); (2) Gas accounting — executed after on-chain confirmation as a separate post-step, using actual chain data, recorded into the corresponding `Gas_Fee_[CCY]_Pool`. The two events occur at different times and must remain separate regardless of whether gas is zero (staking fully covers it) or non-zero.

## Data Integrity & Transactions

- Multi-table state changes must use DB transaction.
- Must keep base config (base seed/sync) and business data (business reset script) concerns separated.
- Must not rely on startup side-effect writes; boot-time checks may validate, but must not write.

## API Contract

- List, detail, action, and export endpoints must each have a single, non-overlapping semantic role.
- List endpoints must expose operator-facing identity and key lifecycle/status fields.
- Detail endpoints must not require the frontend to reconstruct primary business truth from multiple unrelated APIs.
- Action endpoints must represent a named, canonical business/governance action — not free-form partial mutation.
- Action responses must indicate: acceptance, target subject, and resulting/next state.
- Error responses must include: machine-readable code, HTTP status, human-readable message, and request/trace context.
- Must use DTO classes with `class-validator`; `ValidationPipe({ whitelist: true })` is global.
- Must reject unsupported enum/status transitions with explicit exceptions.
- Must not expose raw Prisma-shaped records as the long-term API contract.
- Must not expose `id` as the primary operator query contract when a stable operator-facing key exists.
- Must keep Swagger available at `/api` in local dev.
- Behavioral changes to existing endpoints must include: impact list, backward compatibility statement, migration strategy.

## Identity & Operator Keys

- Every durable table must have `id` for internal binding and FK relations.
- Every first-class subject must have one stable `operatorKey` in one of the forms: `...No`, stable natural `code`/`policyCode`/`eventCode`/`templateCode`, `businessKey`, or deterministic `compositeRef`.
- Workflow, transaction, and governance root subjects should use `...No`.
- Subordinate subjects should use a deterministic parent-anchored composite reference (e.g. `approvalNo + stepNo`).
- Operator list/detail pages must prioritize operatorKey over `id`; admin exact-match filters must prefer `No/Code/compositeRef`.
- Must not introduce a first-class subject that only has `id`.
- Must not require operators to query first-class subjects only by UUID.
- Compatibility aliases must not appear as competing identity fields in active DTOs.

## State Machine & Workflows

- Every workflow root must define: root subject, owning service, canonical status set, allowed actions, transition guards, side effects, audit obligations, repair boundary.
- Workflow actions must be named domain actions, not free-form field patching.
- Unsupported transitions must be rejected explicitly.
- Repeated actions must be idempotent or fail clearly when replay is forbidden.
- Each subject may have one primary lifecycle `status`; additional state axes (approval status, execution status, etc.) must be separated into explicit fields.
- Must not encode unrelated decision axes into one overloaded `status` field.

## Internal Domain Events

Internal domain events are the mechanism by which one module announces a state-change fact so that other modules can react without direct coupling.

### Who May Emit
- **Domain services**: may emit events about their own entity's state changes only. A payin domain service may emit `payin.status.cleared`; it must not emit events about deposit orders.
- **Ingestion/adapter layer**: may emit internal events that represent translated external signals (webhooks, blockchain confirmations, scheduled triggers).
- Approval sub-workflow services and workflow services must NOT emit custom domain events.

### Who May Subscribe
- Only **workflow services** may subscribe to internal domain events via `@OnEvent`.
- Domain services and approval sub-workflow services must NOT subscribe.

### Event Registry
- All internal domain events must be declared in `src/common/events/domain-events.constants.ts` before they can be used in any emitter or subscriber.
- A workflow that depends on an undeclared event is not permitted to ship.
- Each entry in the registry must state: event name, emitting layer, subscribing workflow(s), payload shape summary.

### Naming Convention
Format: `[module].[subject].[past-tense-verb]`

Examples: `payin.status.cleared`, `sumsub.kyc.result.received`, `deposit.compliance.passed`

## Async, Idempotency & Repair

- Any flow using callbacks, jobs, retries, or compensating re-entry must define: trigger source, idempotency key, replay behavior, failure behavior, repair surface.
- Repeated deliveries of the same semantic event must not create duplicate durable business results.
- Repair is only allowed through explicit, named surfaces (e.g. retry, replay, recalculate, compensate). Each repair surface must be narrower than the normal workflow path and must be defined before the workflow ships.
- Must not rely on manual SQL as the canonical repair mechanism.
- Must not allow repair actions that bypass lifecycle ownership or audit.
- Every repair action must capture: who triggered it, why, which subject, what the result was.

## Read Model

- Backend services own operator-facing read models — frontend must not be the primary place where subject truth is joined or inferred.
- First-class subject detail should expose: operator-facing identity, canonical lifecycle status, key timestamps, linked subject keys, important derived display truth, allowed actions.
- Derived fields must not replace canonical source-of-truth fields.
- Operator-facing read models should mirror linked subject `No/Code` values when operationally relevant.
- Must not expose only IDs when the operator decision depends on human-readable linked identities.

## Data Lifecycle

- Audit/evidence data must be treated as immutable except where an explicit governed delete path exists.
- Snapshot/projection data may be rebuilt; direct manual edits are forbidden.
- Delete is not a default right — subjects are deletable only when an active constraint explicitly defines the scope, workflow, read filtering, and retention/audit expectations.
- Retired concepts must not return to active DTO, UI, or test language.
- Immutable execution history must be corrected by compensation or reversal, not overwrite.

## Auth & Authorization

- Route access and business action authority must not be treated as the same thing; high-risk actions should use explicit action permission checks even when the route is protected.
- Authorization truth must come from canonical role/permission binding, not compatibility shadow fields.
- Sensitive governance and repair actions must respect maker-checker or maker-executor boundaries.
- Any privileged bypass must be explicit and auditable.
- Must not hardcode authorization truth into UI assumptions alone.
- Must not grant action authority implicitly just because a user can open the page.

## Provider Integration

- Provider callbacks, reports, and response containers must be treated as external evidence/integration artifacts — not as business workflow root substitutes.
- Callback ingestion must define dedupe semantics explicitly; replayed callbacks must update or no-op deterministically.
- Provider responses may inform workflow decisions but must not directly mutate canonical business state outside a documented domain workflow entrypoint.
- Must not treat raw provider status words as business truth without normalization.
- Must not accept provider callback side effects without audit evidence.

## Testing & Delivery

- A backend change is not delivery-complete until it answers: which subject/domain changed, which API/read-model changed, which workflow/lifecycle changed, which audit behavior changed, which tests prove it.
- Workflow changes should validate: valid transition path, invalid transition rejection, side effects, idempotency when relevant.
- Must not treat implementation as complete when audit integration is missing for required surfaces.
- Must not change backend semantic truth without documentation impact review.
- Any new feature or workflow with durable state, operator-visible action, or automatic blocking behavior must integrate canonical audit logging through `AuditLogsService` — missing audit logging means the feature is not delivery-complete.

---

## Version Sign-off Checklist

每个版本的所有 workflow 实现完成后，必须过以下清单才视为版本交付完毕。

### 治理 / 合规
- [ ] **Audit log 覆盖** — 所有有持久状态或 operator 可见操作的路径已覆盖 `AuditLogsService`；action 命名符合规范；traceId 已穿透所有调用链
- [ ] **审批 SoD 完整** — 所有新增审批类型的步骤配置、maker/checker 角色分离、超时策略已定义；无隐式单人自批路径
- [ ] **RBAC 权限补全** — 所有新增 endpoint 和 business action 已映射到具体 role；无依赖页面访问隐式授权的操作

### 架构 / 设计
- [ ] **Domain Event 注册** — 所有新增内部事件已写入 `domain-events.constants.ts`，payload shape 已声明
- [ ] **Operator Key 完整性** — 所有新增一级主体有 `...No` 或稳定 `code`；无仅有 `id` 的一级主体上线
- [ ] **Pre-flight Checklist** — 所有新增 workflow 的触发源、订阅事件、直接依赖、audit actions、approval sub-workflow 已声明
- [ ] **状态机文档化** — 所有新增 workflow 根主体的 canonical status set、allowed transitions、guards 已明确定义
- [ ] **Repair Surface 定义** — 所有涉及异步、回调、重试的流程，repair surface 已命名、范围比正常路径更窄、触发方式已记录

### API / 读模型
- [ ] **API 合同完整** — 新增 endpoint 的 DTO、Swagger 注解、error code、response shape 已完整；无裸 Prisma 结构直接暴露
- [ ] **Read Model 完整性** — 新增主体的 detail endpoint 暴露：operator key、lifecycle status、关键时间戳、linked subject keys、allowed actions

### 记账（V3 起每版必查）
- [ ] **TigerBeetle Account 类型** — 所有新增 TB Account 的 flags（asset vs liability）、ledger 分配正确
- [ ] **JournalRef 覆盖** — 所有产生 TB Transfer 的路径有对应 Prisma JournalRef 记录

### 外部集成（按版本按需）
- [ ] **Webhook 去重语义** — 新增外部 webhook 的 dedupe key、replay 行为已显式定义；重复推送不产生重复业务结果
- [ ] **Provider 状态归一化** — 外部 provider 原始状态已归一化为内部事件；无裸 provider 状态字直接驱动业务逻辑

### 测试
- [ ] **核心路径测试** — 每个 workflow：happy path、非法状态转换拒绝、有幂等要求的路径的幂等验证
- [ ] **Migration 安全** — 新增迁移文件不破坏现有数据、无启动副作用写入、已在 dev:rebuild 下验证通过

---

## 已废弃的设计（禁止复用）

以下模式已被明确废弃。如在 git 历史或旧分支中发现相关代码，不得将其引回主线。

- **`compliance-alerts` / `compliance-incidents` / `RiskDecisionOrchestratorService`**：Wave 2 已全部删除。合规执行由 Sumsub 承接，平台侧仅保留 webhook 翻译层和审计日志，不重建内部合规信号管道。
- **Change Ticket + `BusinessConfigRelease` / `BusinessConfigRevision` 模型**：Wave 4 引入，现已废弃。所有配置变更（定价策略、货币对、TB 账户定义等）统一通过标准 Maker/Checker 工作流治理，不重建 config-as-code 发布流水线。
- **`triggerType` 字段**：已从 `AuditLogsService` 字段合约中移除，不得在新代码中引入。`workflowType` + `action` 已足够表达触发语义。
- **`workflowId` / `workflowNo` 审计字段**：已从 `audit_log_events` 移除，由 `traceId` + `workflowType` 替代。父实体指针通过 `metadata.parentEntityType/Id/No` 表达。
