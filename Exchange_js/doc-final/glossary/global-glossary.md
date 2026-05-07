# Global Glossary — Exchange Platform 术语表

> **受众**：AI 代码代理 / 所有 Wave 开发者
> **增长策略**：每个 Wave 完成后在此文件追加新术语，已有条目不得修改（仅可扩充 `相关概念`）
> **当前版本**：Wave 1（2026-04-06）
> **语言约定**：中文定义 + 英文术语并排

---

## Maker（发起人）

**定义**：创建并提交一个需要审批的事项（审批申请/变更工单/删除申请）的操作人。Maker 完成创建后，该事项进入等待 Checker 决策的阶段。

**使用场景**：Maker 提交 Change Ticket 或 Delete Request 后，系统自动创建对应的 Approval Case 并路由给 Checker。在审计记录中，`createdByUserId` 字段存储 Maker 的身份。

**相关概念**：Checker、SoD、Maker-Checker SoD、Approval Case、superAdminBypass

---

## Checker（审批人）

**定义**：对 Maker 提交的事项进行独立审查，并作出批准（APPROVED）或拒绝（REJECTED）决策的操作人。Checker 必须与 Maker 为不同用户（Maker-Checker SoD 规则）。

**使用场景**：Approval Case 创建后，系统根据 `approval_action_policies` 表中配置的 `checkerRoles` 确定哪些角色可以充当 Checker。Checker 调用 `POST /governance/approvals/:id/approve` 或 `reject`。

**相关概念**：Maker、SoD、Maker-Checker SoD、GOV_APPROVAL_DECIDE、Approval Action Policy

---

## SoD — Segregation of Duties（职责分离）

**定义**：合规控制原则，要求同一人不得控制同一业务流程中的多个关键决策环节，以防止欺诈和错误。VARA 监管框架明确要求受监管实体在高风险操作上实施 SoD。

**使用场景**：Wave 1 在审批引擎层面实施 SoD——提交申请的 Maker 不得同时担任同一申请的 Checker。SoD 违规时系统抛出 `403 Forbidden`，并在审计记录中写入拒绝原因。

**相关概念**：Maker-Checker SoD、superAdminBypass、ApprovalSoDRuleCodes

---

## Maker-Checker SoD（Maker-Checker 职责分离）

**定义**：Wave 1 实现的具体 SoD 规则：同一用户 ID 不得同时担任同一 Approval Case 的 maker（创建提交方）和 checker（审批决策方）。规则代码为 `DENY_SAME_USER_MAKER_CHECKER`（见 `ApprovalSoDRuleCodes`）。

**使用场景**：`ApprovalsService.decide()` 方法在执行审批操作前检查 `createdByUserId === actor.userId`。若相同且 actor 非 SUPER_ADMIN，则拒绝。SUPER_ADMIN 可绕过此规则，但系统会在 metadata 中写入 `superAdminBypass: true` 标记。

**相关概念**：SoD、superAdminBypass、Approval Case、GOV_APPROVAL_DECIDE

---

## Approval Case（审批单）

**定义**：Wave 1 审批引擎的核心对象，代表一次需要 Checker 独立决策的受控事项。每个需要审批的业务操作（Change Ticket、Delete Request、Audit Evidence Export 等）都会创建一个对应的 Approval Case。

**使用场景**：存储于 `approval_cases` 表（业务编号前缀 `APR`）。状态机：`DRAFT → PENDING → APPROVED / REJECTED / EXPIRED / CANCELLED`。Approval Case 通过 `entityRef` 字段关联被审批的目标对象。

**相关概念**：ApprovalActionTypes、ApprovalStatuses、entityRef、approvalNo、Approval Action Policy、Checker

---

## Change Ticket（变更工单）

**定义**：Wave 1 管理 IAM（身份与访问管理）变更的工作流对象。所有对 admin 用户角色绑定或 RBAC 目录的修改，必须先创建 Change Ticket，经 Checker 审批通过（→ READY 状态），才可执行（Consume）。

**使用场景**：存储于 `change_tickets` 表（业务编号前缀 `CT`）。当前支持的变更类型：`ADMIN_ACCESS_CHANGE`（管理员访问变更）和 `RBAC_CATALOG_CHANGE`（RBAC 目录变更）。变更内容在创建时冻结为 Binding Snapshot。

**相关概念**：Binding Snapshot、Binding Digest、Governed Execution、ChangeTicketStatuses、ChangeTicketTypes、Consumption

---

## Delete Request（删除申请）

**定义**：Wave 1 管理受控软删除的工作流对象。对受保护数据的删除操作不可直接执行，必须先创建 Delete Request，经审批通过后才可执行软删除（Consume）。

**使用场景**：存储于 `delete_requests` 表（业务编号前缀 `DR`）。状态机与 Change Ticket 类似：`DRAFT → PENDING_APPROVAL → READY → DONE / FAILED`。申请人可在审批前主动取消（`DELETE_REQUEST_CANCELLED`）。

**相关概念**：Soft Delete、Governed Execution、Consumption、GOV_DELETE_REQUEST_CONSUME

---

## Governed Execution（受控执行）

**定义**：经过完整审批工作流（Maker 提交 → Checker 审批 → 系统 Consume）后才触发的业务操作执行。"受控"意指该操作已被独立审查确认，且留有完整的审计轨迹。

**使用场景**：在 Wave 1 中，Change Ticket 和 Delete Request 的 `consume()` 方法即为 Governed Execution 的实现点。系统通过 `GovernedExecutionListener` 监听 `change-ticket.consumed` 事件后分发实际的 IAM 变更操作。

**相关概念**：Change Ticket、Delete Request、Consumption、GovernedExecutionListener

---

## Binding Snapshot（绑定快照）

**定义**：Change Ticket 在提交审批时（`DRAFT → PENDING_APPROVAL` 状态转换）冻结的变更内容 JSON。一旦冻结，`bindingSnapshotJson` 字段不可修改，确保 Checker 审批的内容与最终执行的内容完全一致，防止"内容偷换"攻击。

**使用场景**：存储于 `change_tickets.bindingSnapshotJson`（TEXT 列）。Consume 阶段从 `bindingSnapshotJson` 反序列化变更内容并执行，而不是从当前请求参数读取。

**相关概念**：Binding Digest、Change Ticket、Governed Execution

---

## Binding Digest（绑定摘要）

**定义**：Binding Snapshot JSON 内容的 SHA256 哈希值，存储于 `change_tickets.bindingDigest`。用于在 Consume 阶段对快照内容进行完整性验证——若快照被篡改，摘要校验将失败。

**使用场景**：系统在提交审批时计算：`bindingDigest = sha256Hex(bindingSnapshot)`。Audit Center 可展示此摘要作为不可篡改的变更内容证明。

**相关概念**：Binding Snapshot、Change Ticket

---

## traceId（链路追踪 ID）

**定义**：贯穿单个工作流实例全生命周期的唯一标识符。从工作流对象（Change Ticket / Delete Request / Approval Case）创建时生成，并传递给该实例产生的所有审计事件。

**使用场景**：Audit Center 使用 `traceId` 关联同一工作流的所有 `audit_log_events` 记录，形成完整的"工作流时间线"视图。所有 `AuditLogsService.recordSystem()` 和 `recordByActor()` 调用都必须传入 `traceId`，省略会导致事件孤立。

**相关概念**：AuditLogsService、AuditLogView、workflowType / workflowId / workflowNo

---

## entityRef（实体引用）

**定义**：Approval Case 中关联被审批目标对象的字段，存储目标对象的内部 UUID。通过 `entityRef`，系统可以在审批执行阶段定位到具体的 Change Ticket 或 Delete Request 并触发 Consume。

**使用场景**：`approval_cases.entityRef` 列。例如：Change Ticket 审批的 `entityRef` 存储 `changeTicketId`；Delete Request 审批的 `entityRef` 存储 `deleteRequestId`。

**相关概念**：Approval Case、Change Ticket、Delete Request

---

## approvalNo / ticketNo / requestNo（业务编号）

**定义**：各治理对象面向操作员的主要可读标识符，区别于内部 UUID。格式为 `{PREFIX}{YYMMDD}{4位随机数}`（由 `generateReferenceNo()` 生成）。

| 对象 | 字段名 | 前缀 | 示例 |
|---|---|---|---|
| Approval Case | `approvalNo` | `APR` | `APR26040100XX` |
| Change Ticket | `ticketNo` | `CT` | `CT26040100XX` |
| Delete Request | `requestNo` | `DR` | `DR26040100XX` |
| Audit Log Event | `auditNo` | `AUD` | `AUD26040100XX` |
| Audit Evidence Package | `packageNo` | `EVP` | `EVP26040100XX` |

**使用场景**：操作员在 Admin Web 中通过业务编号定位记录；审计报告中引用业务编号而非 UUID；`subjectNos` 数组中存储业务编号用于 Audit Center 搜索。

**相关概念**：traceId、AuditLogView

---

## DRAFT / PENDING / READY / DONE（治理工作流状态机）

**定义**：Wave 1 治理工作流对象的通用状态机阶段：

| 状态 | 含义 | 适用对象 |
|---|---|---|
| `DRAFT` | 已创建但未提交审批 | Change Ticket、Delete Request |
| `PENDING_APPROVAL` | 已提交，等待 Checker 决策 | Change Ticket、Delete Request |
| `PENDING` | 审批单等待决策中 | Approval Case |
| `READY` | 审批已通过，等待 Consume 执行 | Change Ticket |
| `DONE` | 已成功执行（终态） | Change Ticket、Delete Request |
| `FAILED` | 执行失败（终态） | Change Ticket、Delete Request |
| `REJECTED` | 审批被拒绝（终态） | Change Ticket、Approval Case |
| `EXPIRED` | 审批超时（终态） | Approval Case |
| `CANCELLED` | 被取消（终态） | Delete Request、Approval Case |

**使用场景**：所有状态转换均在对应的 service 中通过 Prisma 事务原子写入，并同步触发审计事件。

**相关概念**：Change Ticket、Delete Request、Approval Case

---

## Consumption（消费/执行）

**定义**：Change Ticket 和 Delete Request 工作流中的最终执行步骤，将已审批的变更或删除操作真正落地。仅当工作流对象处于 `READY` 状态时方可触发 Consume。

**使用场景**：
- Change Ticket Consume：从 `bindingSnapshotJson` 读取变更内容，执行 IAM 操作，写入 `DONE` 状态，触发 `CHANGE_TICKET_CONSUMED` 审计事件。
- Delete Request Consume：对目标实体执行软删除（写入 `deletedAt`），写入 `DONE` 状态，触发 `DELETE_REQUEST_CONSUMED` 审计事件。

**相关概念**：Governed Execution、Binding Snapshot、Soft Delete、READY

---

## Audit Evidence Package（审计证据包）

**定义**：经审批后导出的审计日志快照，包含筛选条件、事件列表、完整性摘要（SHA256）和清单（manifest）。用于监管报告和合规存档，生命周期受审批工作流保护。

**使用场景**：导出流程：操作员申请（`AUDIT_EVIDENCE_EXPORT_REQUESTED`）→ Checker 审批（`AUDIT_EVIDENCE_EXPORT_APPROVAL`）→ 系统生成（`AUDIT_EVIDENCE_PACKAGE_EXPORTED`）→ 操作员下载（`AUDIT_EVIDENCE_PACKAGE_DOWNLOADED`）。存储于 `audit_evidence_packages` 表，业务编号前缀 `EVP`，默认保留 8 年。

**相关概念**：AUDIT_LOGS 模块审计事件、Approval Case、AuditEvidencePackageStatus

---

## Soft Delete（软删除）

**定义**：不物理删除数据行，而是在记录上写入 `deletedAt` 时间戳（或等效标记字段），使该记录在标准查询中不可见，但数据仍然保留在数据库中，可用于审计回溯和合规查询。

**使用场景**：Wave 1 中受 Delete Request 工作流保护的实体（如 admin 用户等）使用软删除。执行 Delete Request Consume 时，`DeleteRequestsService` 在同一事务中写入 `deletedAt`。

**相关概念**：Delete Request、Consumption、Governed Execution

---

## Wave（开发迭代单元）

**定义**：项目分阶段开发的迭代单位，每个 Wave 实现一组相关业务功能，并维护与前序 Wave 的向后兼容。Wave 完成后，其 API 合约、状态机和审计事件字典视为"稳定合约"，不得在后续 Wave 中静默修改。

**使用场景**：Wave 1 实现治理底座（审批引擎、Change Ticket、Delete Request、审计底座）。Wave 2-3 预计接入 Onboarding Final Approval 等。各 Wave 在 `approval.constants.ts` 头部注释中标注归属。

**相关概念**：ApprovalActionTypes（各 Wave 预注册）

---

## VARA RI — VARA Responsible Individual（合规负责人）

**定义**：VARA（Virtual Assets Regulatory Authority，迪拜虚拟资产监管局）监管框架要求受监管实体指定的合规负责人角色。最少须配置 2 名 RI，须经 VARA 书面审批。在 Exchange 平台中，CISO 和 MLRO 是 VARA RI 候选角色。

**使用场景**：CISO（信息安全负责人）作为 IAM Change Ticket 审批的 checker；MLRO（反洗钱报告官）作为 AML/SAR 相关决策的负责人。两个角色均在 `RBAC_ROLE_DEFINITIONS` 中定义，描述中注明"VARA Responsible Individual candidate"。

**相关概念**：Checker、RBAC Role、GOV_APPROVAL_DECIDE

---

## GOV_CHANGE_TICKET_WRITE / GOV_APPROVAL_DECIDE 等权限组（Permission Group）

**定义**：RBAC 权限组代码，控制哪些角色可以执行哪些治理操作。权限组在 `rbac.catalog.ts` 的 `PermissionGroup` 类型中定义，每个 API 端点关联一个或多个权限组。

Wave 1 治理相关权限组一览：

| 权限组代码 | 控制的操作 |
|---|---|
| `GOV_APPROVAL_READ` | 查看审批单列表和详情 |
| `GOV_APPROVAL_WRITE` | 创建/提交审批单 |
| `GOV_APPROVAL_DECIDE` | 审批单的批准/拒绝/取消决策 |
| `GOV_CHANGE_TICKET_READ` | 查看变更工单 |
| `GOV_CHANGE_TICKET_WRITE` | 创建/提交变更工单 |
| `GOV_CHANGE_TICKET_GATE` | 执行 Release Gate 检查 |
| `GOV_CHANGE_TICKET_CLOSE` | 关闭变更工单 |
| `GOV_DELETE_REQUEST_READ` | 查看删除申请 |
| `GOV_DELETE_REQUEST_WRITE` | 创建/提交/取消删除申请 |
| `GOV_DELETE_REQUEST_CONSUME` | 执行软删除（Consume） |

**使用场景**：每个 API route 在 `rbac.catalog.ts` 中通过 `route()` 函数绑定权限组，NestJS 的 `@RequirePermissionGroups()` 装饰器在请求层面执行鉴权。

**相关概念**：PermissionGroup、RbacPermissionDefinition、Checker、Maker

---

## superAdminBypass（超级管理员绕过标记）

**定义**：当 SUPER_ADMIN 角色的用户执行正常情况下受 SoD 规则约束的操作时（例如：同时担任 Maker 和 Checker），系统允许操作通过，但在审计记录的 `metadata` 字段中写入 `{ superAdminBypass: true }` 标记，供事后审查。

**使用场景**：`ApprovalsService.decide()` 和 `DeleteRequestsService.submit()` 中均有此逻辑。SUPER_ADMIN 账户定义为"紧急全权访问账户，不用于日常操作"，其每次 SoD 绕过均须留痕，便于监管审计。

**相关概念**：SoD、Maker-Checker SoD、SUPER_ADMIN、审计元数据

---

## Actor Context（操作人上下文）

**定义**：在治理工作流中传递的操作人信息结构，携带执行某操作的用户的完整身份信息，包括 userId、userNo、当前角色和角色代码列表。

**使用场景**：审批服务、变更工单服务、删除申请服务均接受 actor context 作为入参，用于：① SoD 校验（比较 createdByUserId 与 actor.userId）；② 审计记录填充（actorId、actorNo、actorRole）；③ 权限决策（roleCodes）。

TypeScript 结构（以 Approval 模块为例）：
```typescript
interface ApprovalActorContext {
  actorType: 'ADMIN';
  userId: string;
  userNo?: string;
  role?: string;
  roleCodes: string[];
}
```

**相关概念**：AuditActorContext、Maker、Checker、superAdminBypass

---

## Approval Action Policy（审批策略）

**定义**：存储在 `approval_action_policies` 表中（或作为代码常量 `DEFAULT_APPROVAL_POLICIES`）的每种审批类型的配置，定义该类型审批的 checker 角色要求、超时时长、是否允许取消和重试等规则。

**使用场景**：Wave 1 的三种稳定审批类型及其默认策略：

| 审批类型 | checkerRoles | timeoutHours | allowCancel |
|---|---|---|---|
| `CHANGE_TICKET_APPROVAL` | `['CISO']` | 24 | true |
| `DELETE_REQUEST_APPROVAL` | `['DPO', 'CISO']` | 24 | true |
| `AUDIT_EVIDENCE_EXPORT_APPROVAL` | `['MLRO']` | 24 | true |

**相关概念**：ApprovalActionTypes、DEFAULT_APPROVAL_POLICIES、Checker、GOV_APPROVAL_DECIDE

---

## 命名规范

### 业务编号格式

实际格式由 `generateReferenceNo(prefix)` 生成：`{PREFIX}{YY}{MM}{DD}{4位随机数}`

示例：`APR26040100XX`（2026年4月1日生成）

| 前缀 | 对象 | 字段名 |
|---|---|---|
| `APR` | Approval Case（审批单） | `approvalNo` |
| `CT` | Change Ticket（变更工单） | `ticketNo` |
| `DR` | Delete Request（删除申请） | `requestNo` |
| `AUD` | Audit Log Event（审计日志事件） | `auditNo` |
| `EVP` | Audit Evidence Package（审计证据包） | `packageNo` |

> 注意：历史文档中曾使用 `AEP` 前缀描述证据包，代码中实际前缀为 `EVP`，以代码为准。

### 角色代码命名规范

- 普通业务角色统一使用 `_OFFICER` 后缀：`COMPLIANCE_OFFICER`、`TECH_OFFICER`、`OPS_OFFICER`
- VARA 法定缩写角色保持原缩写：`MLRO`（Money Laundering Reporting Officer）、`DPO`（Data Protection Officer）、`CISO`（Chief Information Security Officer）
- 特殊角色：`SUPER_ADMIN`（紧急全权账户）、`SENIOR_MANAGEMENT_OFFICER`（高管监督）

### 权限组代码命名规范

- `GOV_` 前缀：治理模块权限（Change Ticket、Approval、Delete Request、Registry、Regulatory Gate、SLA）
- `IAM_` 前缀：身份管理权限（用户查看、角色分配）
- `AUDIT_` 前缀：审计模块权限（查看、导出、下载）
- 操作类型后缀：`_READ`（只读）、`_WRITE`（写入）、`_DECIDE`（决策）、`_CONSUME`（执行消费）、`_GATE`（门控检查）
