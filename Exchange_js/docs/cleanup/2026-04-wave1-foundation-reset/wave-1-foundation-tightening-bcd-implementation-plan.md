# Wave 1 Foundation Tightening BCD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按 `D -> C -> B` 顺序，把 `Wave 1` 底座做成更干净的运行时主路径、更中立的审计底座、和更统一的主体/页面层。

**Architecture:** 先做 `Stage D` 运行态中裁剪，退出不属于 `Wave 1` 的主路径语义，并削薄 `customer / compliance / treasury` 对底座对象的明显直焊。再做 `Stage C` 审计底座收口，把 `AuditLogsService` 拉回统一 contract。最后做 `Stage B` 主体字段分层、页面分层、`id + No/code` 关联规则收敛。整个包只做运行态与 source-of-truth 收口，不做大规模物理删表迁移。

**Tech Stack:** NestJS, Prisma, Jest, React, Vite, TypeScript, Markdown source-of-truth docs

---

## File Map

### Stage D Core Runtime + Docs
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/dto/approval.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/admin-invitations.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/rbac.catalog.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ApprovalsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ApprovalDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/PlatformMembers.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/RoleManagement.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/rbac/permissions.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/governance-approval-constraints.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/rbac-member-management-constraints.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/approval-case-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/admin-user-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/role-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/permission-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/admin-member-auth-boundary-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/approvals-module.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/rbac-member-management-module.md`

### Stage D Wider Coupling Trim
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/CustomerDetail.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/CustomerManagement.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ComplianceCasesPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ComplianceCaseDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/TransactionComplianceCasesPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/TransactionComplianceCaseDetailPage.tsx`

### Stage C Audit Base
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/utils/audit-subject-no.util.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/AuditLogsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/EvidenceExportsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/audit-logging-constraints.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/audit-log-event-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/audit-evidence-package-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/audit-evidence-export-approval-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-module.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-product-doc.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-technical-doc.md`

### Stage B Entity / UI Convergence
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/schema.prisma`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ApprovalsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ApprovalDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/AuditLogsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/EvidenceExportsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/PlatformMembers.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/RoleManagement.tsx`
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/cleanup/2026-04-wave1-foundation-reset/wave-1-foundation-tightening-bcd-acceptance-notes.md`

### Tests
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.controller.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/admin-invitations.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts`

---

## Task 1: Stage D Characterization Baseline

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.service.spec.ts`

- [x] **Step 1: Add failing expectations that define the Wave 1-only runtime surface**

```ts
expect(item.status).not.toBe('APPROVAL_PENDING');
expect(item.status).not.toBe('READY_FOR_DEPLOY');
expect(item).not.toHaveProperty('latestApprovalStatus');
expect(item).not.toHaveProperty('executedByUserId');
```

```ts
expect(customer.archivedOnboardingAuditLogs).toBeUndefined();
expect(customer.auditCenterSummary).toBeDefined();
```

- [x] **Step 2: Run the focused characterization tests**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/approvals/approvals.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/customers/customers.service.spec.ts --runInBand
```

Expected:
- at least one assertion fails because old `Wave 1` runtime leakage is still visible

- [x] **Step 3: Commit the red baseline**

```bash
git add src/modules/governance/approvals/approvals.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/customers/customers.service.spec.ts
git commit -m "test: add stage d characterization baseline"
```

## Task 2: Stage D Trim Approval And Member Runtime Semantics

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/dto/approval.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/admin-invitations.service.ts`

- [x] **Step 1: Remove non-Wave-1 primary-flow wording from approval read models**

```ts
return {
  id: approval.id,
  approvalNo: approval.approvalNo,
  actionType: approval.actionType,
  entityRef: approval.entityRef,
  status: approval.status,
  executionStatus: approval.executionStatus,
  makerUserId: approval.makerUserId,
  checkerRoles: approval.checkerRoles,
  traceId: approval.traceId,
  createdAt: approval.createdAt,
  updatedAt: approval.updatedAt,
};
```

- [x] **Step 2: Keep invitation/member runtime focused on Wave 1 member boundary only**

```ts
return {
  id: user.id,
  userNo: user.userNo,
  email: user.email,
  status: user.status,
  roles,
  inviteLink: invitation.inviteLink,
  inviteExpiresAt: invitation.inviteExpiresAt,
  inviteStatus: invitation.inviteStatus,
};
```

- [x] **Step 3: Run the approval/member focused tests**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/approvals/approvals.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts --runInBand
```

Expected:
- PASS

- [x] **Step 4: Commit Stage D core runtime trim**

```bash
git add src/modules/governance/approvals/approvals.service.ts src/modules/governance/approvals/approvals.controller.ts src/modules/governance/approvals/dto/approval.dto.ts src/modules/identity/users/users.service.ts src/modules/identity/users/admin-invitations.service.ts src/modules/governance/approvals/approvals.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts
git commit -m "refactor: trim wave 1 approval and member runtime semantics"
```

## Task 3: Stage D Trim Cross-Wave Direct Coupling In Customer And Compliance Views

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/customers/customers.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/CustomerDetail.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ComplianceCasesPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ComplianceCaseDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/TransactionComplianceCasesPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/TransactionComplianceCaseDetailPage.tsx`

- [x] **Step 1: Remove archived onboarding audit logs from customer primary detail payload**

```ts
return {
  customerNo: customer.customerNo,
  lifecycleStatus: customer.lifecycleStatus,
  reviewStatus: customer.reviewStatus,
  auditCenterSummary: {
    latestTraceId: customer.latestDecisionRecord?.traceId ?? null,
  },
};
```

- [x] **Step 2: Move governance/audit technical references out of compliance primary sections**

```tsx
<InfoField label="Case No" value={detail.caseNo} mono />
<InfoField label="Status" value={detail.status} />
<InfoField label="Customer No" value={detail.customerNo} mono />
```

```tsx
<DetailCard title="Technical References" columns={2}>
  <InfoField label="Approval No" value={detail.approvalNo} mono />
  <InfoField label="Trace ID" value={detail.traceId} mono />
</DetailCard>
```

- [x] **Step 3: Run customer/compliance tests and frontend build**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/identity/customers/customers.service.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected:
- service spec PASS
- frontend build PASS

- [x] **Step 4: Commit Stage D wider trim**

```bash
git add src/modules/identity/customers/customers.service.ts admin-web/src/pages/CustomerDetail.tsx admin-web/src/pages/ComplianceCasesPage.tsx admin-web/src/pages/ComplianceCaseDetailPage.tsx admin-web/src/pages/TransactionComplianceCasesPage.tsx admin-web/src/pages/TransactionComplianceCaseDetailPage.tsx src/modules/identity/customers/customers.service.spec.ts
git commit -m "refactor: trim cross-wave coupling from wave 1 primary views"
```

## Task 4: Stage D Source-Of-Truth Alignment

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/governance-approval-constraints.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/rbac-member-management-constraints.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/approval-case-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/admin-user-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/role-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/permission-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/admin-member-auth-boundary-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/approvals-module.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/rbac-member-management-module.md`

- [x] **Step 1: Rewrite docs so Wave 1 objects describe Wave 1 only**

```md
- MUST describe approval as a generic governance shell.
- MUST NOT describe later-wave workflow specializations as canonical Wave 1 behavior.
```

- [x] **Step 2: Add explicit note that role catalog is fixed and member assignment is the runtime path**

```md
- Role catalog remains fixed in Wave 1.
- Runtime change happens through member role assignment, not catalog mutation.
```

- [x] **Step 3: Review the docs for stale terms**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && rg -n "latestApprovalStatus|execute|READY_FOR_DEPLOY|workflow specialization|governance registries|Wave 9" docs/constraints/governance-approval-constraints.md docs/constraints/rbac-member-management-constraints.md docs/specs/entities/approval-case-entity.md docs/specs/entities/admin-user-entity.md docs/specs/entities/role-entity.md docs/specs/entities/permission-entity.md docs/specs/workflows/admin-member-auth-boundary-workflow.md docs/specs/modules/approvals-module.md docs/specs/modules/rbac-member-management-module.md
```

Expected:
- no stale canonical wording for removed runtime semantics

- [x] **Step 4: Commit Stage D doc alignment**

```bash
git add docs/constraints/governance-approval-constraints.md docs/constraints/rbac-member-management-constraints.md docs/specs/entities/approval-case-entity.md docs/specs/entities/admin-user-entity.md docs/specs/entities/role-entity.md docs/specs/entities/permission-entity.md docs/specs/workflows/admin-member-auth-boundary-workflow.md docs/specs/modules/approvals-module.md docs/specs/modules/rbac-member-management-module.md
git commit -m "docs: align wave 1 approval and member source of truth"
```

## Task 5: Stage C Audit Contract Red Baseline

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts`

- [x] **Step 1: Add failing tests for the intended audit contract**

```ts
expect(event.subjectNos).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ subjectNo: 'CUS2604010001' }),
    expect.objectContaining({ subjectNo: 'APP2604010001' }),
  ]),
);
expect(event.beforeData).toEqual(expect.objectContaining({ digest: expect.any(String) }));
expect(event.afterData).toEqual(expect.objectContaining({ digest: expect.any(String) }));
```

- [x] **Step 2: Run audit service spec and capture the red state**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand
```

Expected:
- FAIL because current audit service still mixes generic contract and domain-specific evidence assembly

- [x] **Step 3: Commit the red baseline**

```bash
git add src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts
git commit -m "test: add stage c audit contract baseline"
```

## Task 6: Stage C Refactor Audit Service Back To A Neutral Contract

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/utils/audit-subject-no.util.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts`

- [x] **Step 1: Split operator-facing typed core from context JSON**

```ts
return {
  auditNo: event.auditNo,
  triggerType: event.triggerType,
  action: event.action,
  module: event.module,
  workflowType: event.workflowType,
  workflowNo: event.workflowNo,
  traceId: event.traceId,
  result: event.result,
  occurredAt: event.occurredAt,
  subjectNos: mappedSubjectNos,
  beforeData: normalizeAuditDelta(event.beforeData),
  afterData: normalizeAuditDelta(event.afterData),
};
```

- [x] **Step 2: Remove domain-specific evidence assembly from the generic core path**

```ts
private buildAuditEvidenceSummary(input: DomainEvidenceInput) {
  return {
    digest: input.digest,
    subjectNos: input.subjectNos,
    summary: input.summary,
  };
}
```

- [x] **Step 3: Keep `subjectNo` and `workflow + traceId` roles separate**

```ts
if (query.subjectNo) {
  where.subjectNos = { some: { subjectNo: query.subjectNo.trim() } };
}
if (query.traceId) {
  where.traceId = query.traceId.trim();
}
```

- [x] **Step 4: Run focused audit tests**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand
```

Expected:
- PASS

- [x] **Step 5: Commit Stage C service tightening**

```bash
git add src/modules/risk-engine/audit-logs/audit-logs.service.ts src/modules/risk-engine/audit-logs/dto/audit-log.dto.ts src/modules/risk-engine/audit-logs/utils/audit-subject-no.util.ts src/modules/risk-engine/audit-logs/constants/audit-actions.constant.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts
git commit -m "refactor: tighten audit foundation contract"
```

## Task 7: Stage C Audit UI + Source-Of-Truth Alignment

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/AuditLogsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/EvidenceExportsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/audit-logging-constraints.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/audit-log-event-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/audit-evidence-package-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/audit-evidence-export-approval-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-module.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-product-doc.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/modules/audit-logging-technical-doc.md`

- [x] **Step 1: Make Audit Center filters and table speak the neutral contract**

```tsx
<InfoField label="Workflow No" value={item.workflowNo} mono />
<InfoField label="Trace ID" value={item.traceId} mono />
<InfoField label="Subject No" value={item.primarySubjectNo} mono />
```

- [x] **Step 2: Rewrite docs around typed core / subjectNos / context JSON**

```md
- Core lookup fields remain typed.
- Context payload remains JSON.
- `subjectNos[]` is the operator-facing multi-anchor lookup layer.
```

- [x] **Step 3: Run frontend build and stale-doc scan**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && rg -n "full raw payload|single trace only|onboarding_audit_logs as canonical|domain-specific evidence assembly" docs/constraints/audit-logging-constraints.md docs/specs/entities/audit-log-event-entity.md docs/specs/entities/audit-evidence-package-entity.md docs/specs/workflows/audit-evidence-export-approval-workflow.md docs/specs/modules/audit-logging-module.md docs/specs/modules/audit-logging-product-doc.md docs/specs/modules/audit-logging-technical-doc.md
```

Expected:
- frontend build PASS
- no stale canonical phrasing

- [x] **Step 4: Commit Stage C UI/doc alignment**

```bash
git add admin-web/src/pages/AuditLogsPage.tsx admin-web/src/pages/EvidenceExportsPage.tsx docs/constraints/audit-logging-constraints.md docs/specs/entities/audit-log-event-entity.md docs/specs/entities/audit-evidence-package-entity.md docs/specs/workflows/audit-evidence-export-approval-workflow.md docs/specs/modules/audit-logging-module.md docs/specs/modules/audit-logging-product-doc.md docs/specs/modules/audit-logging-technical-doc.md
git commit -m "docs: align audit center with tightened audit contract"
```

## Task 8: Stage B Entity And UI Convergence

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/schema.prisma`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/approvals/approvals.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/users/users.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/risk-engine/audit-logs/audit-logs.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ApprovalsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ApprovalDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/PlatformMembers.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/RoleManagement.tsx`

- [x] **Step 1: Add or keep only the missing `No/code` fields required by active operator flows**

```prisma
approvalNo        String?
createdByUserNo   String
submittedByUserNo String?
consumedByUserNo  String?
```

```prisma
code String @unique
```

- [x] **Step 2: Apply the four-layer display model to the remaining Wave 1 pages**

```tsx
<DetailCard title="Summary" columns={3}>...</DetailCard>
<DetailCard title="Workflow References" columns={3}>...</DetailCard>
<DetailCard title="Technical References" columns={2}>...</DetailCard>
```

- [x] **Step 3: Keep list pages operator-first**

```tsx
const columns = [
  'approvalNo',
  'actionType',
  'status',
  'makerUserNo',
  'submittedAt',
  'traceId',
];
```

- [x] **Step 4: Run stage B focused verification**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/approvals/approvals.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected:
- all focused tests PASS
- frontend build PASS

- [x] **Step 5: Commit Stage B convergence**

```bash
git add prisma/schema.prisma src/modules/governance/approvals/approvals.service.ts src/modules/identity/users/users.service.ts src/modules/risk-engine/audit-logs/audit-logs.service.ts admin-web/src/pages/ApprovalsPage.tsx admin-web/src/pages/ApprovalDetailPage.tsx admin-web/src/pages/PlatformMembers.tsx admin-web/src/pages/RoleManagement.tsx src/modules/governance/approvals/approvals.service.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts
git commit -m "refactor: converge remaining wave 1 base entities"
```

## Task 9: Final BCD Acceptance Notes And Regression Pass

**Files:**
- Create: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/cleanup/2026-04-wave1-foundation-reset/wave-1-foundation-tightening-bcd-acceptance-notes.md`

- [x] **Step 1: Write acceptance notes using the final stage outputs**

```md
## Stage D
- runtime leakage removed from primary Wave 1 paths

## Stage C
- audit contract tightened

## Stage B
- entity and UI layering converged
```

- [x] **Step 2: Run the combined focused regression**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/approvals/approvals.service.spec.ts src/modules/governance/approvals/approvals.controller.spec.ts src/modules/identity/users/users.service.spec.ts src/modules/identity/users/admin-invitations.service.spec.ts src/modules/identity/customers/customers.service.spec.ts src/modules/risk-engine/audit-logs/audit-logs.service.spec.ts --runInBand
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected:
- all focused suites PASS
- frontend build PASS

- [x] **Step 3: Run backend build to record final repo state**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run build
```

Expected:
- either PASS
- or fail only on pre-existing unrelated repo issues, which must be written into the acceptance notes

- [x] **Step 4: Commit acceptance notes**

```bash
git add docs/cleanup/2026-04-wave1-foundation-reset/wave-1-foundation-tightening-bcd-acceptance-notes.md
git commit -m "docs: add bcd acceptance notes"
```

## Spec Coverage Check

- `Stage D` spec coverage:
  - runtime trimming of `Wave 1` base paths -> Tasks 1-4
  - wider coupling cleanup in customer/compliance views -> Task 3
- `Stage C` spec coverage:
  - audit contract tightening -> Tasks 5-7
- `Stage B` spec coverage:
  - entity layering, page layering, `id + No/code` convergence -> Task 8
- final documentation prep and regression capture -> Task 9

## Placeholder Scan

- No `TODO`
- No `TBD`
- No “similar to previous task”
- Each task includes files, commands, and expected outputs

## Type Consistency Check

- `Stage D` only trims runtime semantics; it does not require physical schema deletion.
- `Stage C` keeps `subjectNos[]`, `workflowNo`, and `traceId` as distinct concepts.
- `Stage B` is the only stage allowed to add missing active-path `No/code` fields if required by the final operator contract.
