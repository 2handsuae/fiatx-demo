# Wave 1 Governance And Audit Cleanup Master Plan

Status: completed
Owner: project-owner-and-agents
Last Updated: 2026-03-22
Applies To: `Wave 1` governance approval / change ticket / delete request / SLA / audit logging / evidence export cleanup
Supersedes: none
Depends On: `docs/constraints/governance-approval-constraints.md`, `docs/constraints/governance-change-ticket-constraints.md`, `docs/constraints/governance-delete-request-constraints.md`, `docs/constraints/governance-sla-timer-constraints.md`, `docs/constraints/audit-logging-constraints.md`
Source of Truth Level: cleanup-master

## Initial Debt Snapshot
- `approval`、`change ticket`、`delete request` 的 type taxonomy 仍带有早期泛化值和跨 wave 未收敛值。
- audit evidence export 已切到 approval-backed 主链，但 `AuditLogsService.exportEvidencePackage()` 旧直出旁路仍存在。
- `Approval Detail` 只对 audit evidence export 暴露 package 摘要和跳转入口，未覆盖 case evidence export。
- `Delete Request` 仍允许直接删除 `APPROVAL_CASE`，会切断 wave2/3 共享审批链。
- `ComplianceCaseEvidencePackage` 与 `User` 尚未对齐 Wave 1 软删除标准字段。
- admin case 页面仍残留 `incident` 命名和兼容 fallback，已不符合当前 canonical `case` 语义。

## Target End State
- 治理链路只保留一条 canonical 流程，不再保留已退役的旁路或 compatibility-only 写法。
- Wave 1/2/3 共用治理对象采用统一 taxonomy：
  - approval action type
  - change ticket type
  - delete request target type
- delete request 只作用在顶层业务对象，不再允许直接删除共享治理对象。
- audit evidence export 与 case evidence export 的 approval、detail、download、delete contract 完全对齐。
- admin member 相关 read/write/auth/invitation 链路统一排除已软删 admin user。

## Stage Overview
1. `Stage 1`：Canonical Taxonomy Freeze And Doc Alignment
   - status: completed
   - result target: cleanup master、constraints、acceptance 统一写明 canonical taxonomy 和 retirement boundary
2. `Stage 2`：Evidence Export / Approval / Delete Chain Convergence
   - status: completed
   - result target: audit export 只保留 approval-backed 主链，approval detail 同时支持两类 evidence export，case evidence export 接入标准软删除
3. `Stage 3`：Admin Governance Object Convergence
   - status: completed
   - result target: `ADMIN_USER` 正式接入 delete request，member/auth/invitation 链路与 role change 语义收口
4. `Stage 4`：Legacy Path Retirement And Naming Cleanup
   - status: completed
   - result target: 删除旧 export 直出和无意义 compatibility path，并清理 admin case surface 上的 `incident` 命名残留
5. `Stage 5`：Acceptance And Documentation Convergence
   - status: completed
   - result target: acceptance、constraints、specs 与 cleanup 阶段状态一致，残余 debt 只剩未做的 physical cleanup

## Implementation Result
- Canonical taxonomy、constraints、acceptance 和 cleanup index 已完成同步。
- audit evidence export 已完全切换到 approval-backed 主链，旧 `AuditLogsService.exportEvidencePackage()` 旁路已删除。
- `Approval Detail` 已同时支持 audit evidence export 与 case evidence export 摘要和跳转。
- `Delete Request` 已移除 `APPROVAL_CASE` target，并正式支持 `COMPLIANCE_CASE_EVIDENCE_PACKAGE` 与 `ADMIN_USER`。
- `ComplianceCaseEvidencePackage` 与 `User` 已补齐标准软删除字段，并将 member/auth/invitation read path 收敛到 soft-delete aware 行为。
- admin case 页面已切到 canonical `case` surface，不再依赖 `case || incident` fallback。
- onboarding / periodic review 的 case decision API 已切到 `case-only` contract，不再返回 `incident` 兼容字段。
- 本地 `main` stack 已补齐 `wave1:foundation:smoke`，用于固定 runtime compat debt 为 `0` 的回归入口。
- stack-managed runtime commands now resolve the `main` DB by stack name, instead of inheriting a worktree-local experimental `DATABASE_URL`.
- `Wave 1` 已落最终 acceptance 结论文档：`docs/acceptance/wave-1-foundation-final-acceptance.md`。
- `Wave 1` 在当前官方范围下已达到 `implementation-complete` 与 `documentation-complete`。

## Canonical Taxonomy
### Approval Action Type
- `AUDIT_EVIDENCE_EXPORT_APPROVAL`
- `CASE_EVIDENCE_EXPORT_APPROVAL`
- `CHANGE_TICKET_APPROVAL`
- `DELETE_REQUEST_APPROVAL`
- `ONBOARDING_FINAL_APPROVAL`

### Change Ticket Type
- `ADMIN_ACCESS_CHANGE`
- `RBAC_CATALOG_CHANGE`
- `GOVERNANCE_POLICY_CHANGE`
- `COMPLIANCE_WORKFLOW_CHANGE`
- `CUSTOMER_LIFECYCLE_WORKFLOW_CHANGE`
- `AUDIT_EVIDENCE_POLICY_CHANGE`

### Delete Request Target Type
- `CHANGE_TICKET`
- `AUDIT_EVIDENCE_PACKAGE`
- `COMPLIANCE_CASE_EVIDENCE_PACKAGE`
- `ADMIN_USER`

### SLA Taxonomy Freeze
- `timerType`
  - `APPROVAL_TIMEOUT`
  - `CHANGE_POST_APPROVAL_FOLLOWUP`
- `workflowType`
  - `APPROVAL`
  - `CHANGE_TICKET`
- `subjectType`
  - `APPROVAL_CASE`
  - `CHANGE_TICKET`

## Stage Mapping
### Stage 1: Canonical Taxonomy Freeze And Doc Alignment
- 新建本 cleanup master，作为本轮 staged cleanup 的总入口。
- 更新 constraints 和 acceptance，把 canonical taxonomy 与已退役项写清楚。
- `APPROVAL_CASE` 从 delete request target 中降为 forbidden pattern，不保留 compatibility alias。

### Stage 2: Evidence Export / Approval / Delete Chain Convergence
- 删除 audit evidence export 旧直出旁路，只保留 approval-backed 流程。
- `SENSITIVE_EXPORT_APPROVAL` 退役，统一替换为 `AUDIT_EVIDENCE_EXPORT_APPROVAL`。
- `Approval Detail` 同时暴露：
  - `evidencePackage`
  - `caseEvidencePackage`
- `ComplianceCaseEvidencePackage` 补齐标准软删除字段与 read filter。

### Stage 3: Admin Governance Object Convergence
- `ADMIN_USER` 纳入 delete request target。
- `User` 补齐标准软删除字段：
  - `deletedAt`
  - `deletedBy`
  - `deleteRequestId`
  - `deleteReason`
- 平台成员、admin login、邀请预览、邀请接受、重发邀请、角色绑定统一拒绝已软删 admin user。
- admin 权限变化统一使用 `ADMIN_ACCESS_CHANGE` / `RBAC_CATALOG_CHANGE` 语义，不再依赖 generic change type。

### Stage 4: Legacy Path Retirement And Naming Cleanup
- 删除旧 audit export 直出方法与相关测试。
- 删除 delete request 中 `APPROVAL_CASE` 解析、执行、snapshot 分支。
- 删除无业务意义的 generic/trading-oriented change types。
- 清理 admin case surface 上的 `incident` 命名、`case || incident` fallback，以及 onboarding / periodic review case decision 的 `incident` 外露 contract。

### Stage 5: Acceptance And Documentation Convergence
- governance acceptance checklist 固化以下回归场景：
  - audit evidence export 审批化全链路
  - case evidence export 审批化全链路
  - approval detail 对两类 export 的追跳
  - delete request 删除 case evidence export
  - delete request 删除 admin user
  - change ticket 仅接受 canonical type
  - SLA 行为无新增 type、无回归
- cleanup 文档记录阶段完成态；长期语义真相仍以下层文档为准：
  - `docs/constraints/**`
  - `docs/specs/**`
  - `docs/acceptance/**`
- `Wave 1` 最终验收入口已迁移到：
  - `docs/acceptance/wave-1-foundation-final-acceptance.md`

## Deletion Order
1. 先冻结 taxonomy 与 constraints。
2. 再切换 evidence export / approval detail / delete contract 主链。
3. 再把 admin user 纳入 delete request，并统一 member/auth/invitation 过滤。
4. 再删除旧 export 直出、`APPROVAL_CASE` delete path 和 generic change types。
5. 最后清理命名残留和 acceptance/doc convergence。

## Rollback / Compatibility Note
- 本轮默认遵循 `Converge Then Retire`：
  - 先补齐 canonical read/write path
  - 再切换前端与测试
  - 最后删除 compatibility-only path
- 不做 evidence package 物理表合并。
- 不做新的 physical table rename。
- 若某条删除链仍被实际页面或脚本依赖，只允许短期标记为 `cleanup pending`，不得悄悄保留旁路为长期默认。

## Residual Debt Default
- 本 cleanup 完成后，允许保留的 residual debt 只限于：
  - 未执行的 physical rename
  - 未执行的 physical model merge
- 不允许继续保留 runtime compat debt、shared approval delete path 或 export bypass path。
- 当前状态：`runtime compat debt = 0`。
