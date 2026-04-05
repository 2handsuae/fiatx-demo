Status: draft
Owner: project-owner-and-agents
Last Updated: 2026-04-02
Applies To: `Exchange_js`
Supersedes: none
Depends On: `docs/cleanup/2026-04-wave1-foundation-reset/README.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-subject-table-dictionary-and-minimal-model-review.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-core-table-field-necessity-review.md`, `docs/cleanup/2026-04-wave1-foundation-reset/wave-1-no-first-missing-field-review.md`, `docs/roadmap/project-version-plan.md`, `docs/specs/workflows/change-ticket-release-gate-workflow.md`, `docs/specs/workflows/delete-request-soft-delete-workflow.md`, `prisma/schema.prisma`
Source of Truth Level: design-note

# Change / Delete Ticket Minimalization Design

## Purpose
- 把 `ChangeTicket` 和 `DeleteRequest` 从“各自长出一整套重状态机”收回成统一的 Wave 1 治理工单骨架。
- 严格限制范围在 Wave 1 已有主体，不提前承接 Wave 2-9 的业务对象和治理旁支。
- 为后续代码实现、测试和验收提供唯一设计基线。

## Design Summary
- 保留两套模块：
  - `ChangeTicket`
  - `DeleteRequest`
- 不并表，不做抽象 `GovernanceTicket` 总表。
- 但两者统一采用同一组产品语义：
  - 创建
  - 审批
  - 就绪
  - 被消费
  - 成功 / 失败 / 拒绝 / 取消
- `ApprovalCase` 继续保持独立治理对象，不并入工单主体。
- 本轮不保留历史兼容状态、不保留旧枚举映射、不保留过渡读写逻辑。

## Scope

### In Scope
- `ChangeTicket` 状态、类型、字段、页面、DTO、service 语义极简化。
- `DeleteRequest` 状态、目标类型、字段、页面、DTO、service 语义极简化。
- 统一 `id + No/code` 的运营关联规则。
- 把 `ChangeTicketGateRun` 从“主流程状态一部分”降级为从属执行记录。

### Out of Scope
- 并表为统一 `GovernanceTicket`。
- 引入新的 Wave 2-9 业务对象。
- 引入通用 `obligation / SLA / escalation` 语义。
- 为未上线系统保留历史状态兼容层。

## Product Boundary

### ChangeTicket
- 语义：批准一个 Wave 1 变更意图进入消费环节。
- 不再把它定义为“部署流程对象”。
- 具体如何被消费，由从属执行记录承接。

### DeleteRequest
- 语义：批准一个 Wave 1 删除动作进入消费环节。
- 继续是 governed soft-delete root。
- 执行是它的唯一消费动作。

## Type Boundary

### ChangeTicket.changeType
- 只保留：
  - `ADMIN_ACCESS_CHANGE`
  - `RBAC_CATALOG_CHANGE`

### Why These Two
- 两者都能对应到明确的 Wave 1 主体或配置面：
  - admin member / auth boundary
  - role / permission / route catalog
- 当前 `COMPLIANCE_WORKFLOW_CHANGE`、`CUSTOMER_LIFECYCLE_WORKFLOW_CHANGE` 已踩到 Wave 2-3。
- 当前 `GOVERNANCE_POLICY_CHANGE`、`AUDIT_EVIDENCE_POLICY_CHANGE` 缺少足够扎实、运营可感知的 Wave 1 主体承接。

### DeleteRequest.targetType
- 只保留：
  - `CHANGE_TICKET`
  - `AUDIT_EVIDENCE_PACKAGE`
  - `ADMIN_USER`

### Why These Three
- 三者都有明确的 Wave 1 主体表、详情页和运营语义。
- `COMPLIANCE_CASE_EVIDENCE_PACKAGE` 已踩到 Wave 2-3，不留在这轮极简化里。

## Unified Status Model

### Canonical Statuses
- `DRAFT`
- `PENDING_APPROVAL`
- `READY`
- `DONE`
- `FAILED`
- `REJECTED`
- `CANCELLED`

### Status Meaning
- `DRAFT`
  - 已创建但还未送审。
- `PENDING_APPROVAL`
  - 已提交审批，等待 checker 处理。
- `READY`
  - 审批通过，可进入消费动作。
- `DONE`
  - 消费动作成功完成。
- `FAILED`
  - 消费动作执行过，但失败。
- `REJECTED`
  - 审批被拒绝，或审批终态为 `EXPIRED / CANCELLED` 后映射成拒绝。
- `CANCELLED`
  - 工单在审批通过前被发起方取消。

### Explicitly Removed Statuses
- `SUBMITTED`
- `APPROVAL_PENDING`
- `READY_FOR_DEPLOY`
- `READY_TO_EXECUTE`
- `DEPLOYED`
- `DEPLOY_FAILED`
- `EXECUTED`
- `EXECUTION_FAILED`
- `CLOSED`

## Field Layering Rule

### Method
- 依照本轮既有字段分层方法执行：
  - 主字段：驱动状态、审批、检索、运营理解
  - 结构化子对象：一对多从属执行记录
  - JSON：冻结意图、执行前快照
  - 技术字段：只服务校验或完整性证明
- 运营相关的跨表关联必须成对保留：
  - `id + No/code`

## ChangeTicket Final Field Layout

### Main Fields
- `id`
- `ticketNo`
- `status`
- `changeType`
- `scopeSummary`
- `changeReason`
- `testEvidenceRef`
- `rollbackPlanRef`
- `approvalCaseId`
- `approvalNo`
- `createdByUserId`
- `createdByUserNo`
- `submittedByUserId`
- `submittedByUserNo`
- `consumedByUserId`
- `consumedByUserNo`
- `traceId`
- `resultNote`
- `createdAt`
- `submittedAt`
- `consumedAt`
- `deletedAt`
- `deletedBy`
- `deleteRequestId`
- `deleteRequestNo`
- `deleteReason`

### JSON Fields
- `bindingSnapshotJson`
  - 冻结这次被批准的变更意图。

### Technical Fields
- `bindingDigest`
  - 用于保证审批后不会换内容。

### Structured Child Records
- `executionRecords[]`
  - 由当前 `ChangeTicketGateRun` 演进而来。
  - 只承接具体消费动作，不再占用主工单状态语义。

### Child Record Fields
- `id`
- `ticketId`
- `ticketNo`
- `targetEnv`
- `releaseVersion`
- `status`
- `operatorUserId`
- `operatorUserNo`
- `traceId`
- `startedAt`
- `finishedAt`
- `resultNote`

### Removed Fields
- `riskLevel`
- `latestApprovalId`
- `latestApprovalStatus`
- `emergency`
- `emergencyReason`
- `postApprovalDueAt`
- `postApprovalCompletedAt`
- `closedByUserId`
- `deployedAt`
- `closedAt`

## DeleteRequest Final Field Layout

### Main Fields
- `id`
- `requestNo`
- `status`
- `targetType`
- `targetId`
- `targetNo`
- `deleteReason`
- `docRef`
- `approvalCaseId`
- `approvalNo`
- `createdByUserId`
- `createdByUserNo`
- `submittedByUserId`
- `submittedByUserNo`
- `consumedByUserId`
- `consumedByUserNo`
- `traceId`
- `resultNote`
- `createdAt`
- `submittedAt`
- `consumedAt`

### JSON Fields
- `targetSnapshotJson`
  - 删除前快照，供之后审计和详情回看。

### Technical Fields
- `targetSnapshotDigest`
  - 执行前校验目标未漂移。

### Removed / Renamed Fields
- remove:
  - `latestApprovalId`
  - `latestApprovalStatus`
- rename:
  - `makerUserId -> createdByUserId`
  - `executedByUserId -> consumedByUserId`
  - `executedAt -> consumedAt`

## Read / Search Rule

### Default Search
- `ChangeTicket`
  - `ticketNo`
  - `status`
  - `changeType`
  - `approvalNo`
  - `createdByUserNo`
  - `submittedByUserNo`
  - `consumedByUserNo`
  - `traceId`
- `DeleteRequest`
  - `requestNo`
  - `status`
  - `targetType`
  - `targetNo`
  - `approvalNo`
  - `createdByUserNo`
  - `submittedByUserNo`
  - `consumedByUserNo`
  - `traceId`

### Display Layering
- list page:
  - `ticketNo / requestNo`
  - `status`
  - `changeType / targetType`
  - `scopeSummary / targetNo`
  - `approvalNo`
  - `submittedAt`
- detail primary section:
  - `changeReason / deleteReason`
  - `testEvidenceRef / rollbackPlanRef / docRef`
  - `createdByUserNo / submittedByUserNo / consumedByUserNo`
  - `resultNote`
- technical section:
  - `id`
  - `traceId`
  - `bindingDigest`
  - `targetSnapshotDigest`
  - `bindingSnapshotJson`
  - `targetSnapshotJson`
  - delete linkage

## Implementation Consequences
- Prisma schema 要直接删掉旧状态与旧字段，不保留兼容层。
- DTO、常量、service、controller、admin pages、tests 必须同步收口。
- `ChangeTicketGateRun` 需要改名或语义重述为 execution record，但本轮不强制要求物理更名表名；只要求产品语义降级。
- 文档、验收、测试必须全部改成新口径。

## Non-Goals
- 不在本轮引入通用治理工单总表。
- 不在本轮引入 Wave 9 obligation / escalation。
- 不在本轮把 `ChangeTicket` 接到更多业务域。
