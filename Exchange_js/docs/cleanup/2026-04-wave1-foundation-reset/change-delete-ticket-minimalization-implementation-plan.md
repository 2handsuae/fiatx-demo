# Change / Delete Ticket Minimalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `ChangeTicket` 和 `DeleteRequest` 收敛成 Wave 1 极简治理工单，删除旧的 release-gate / deploy / close 语义，统一状态、类型边界、字段分层和 `id + No/code` 运营关联规则。

**Architecture:** 后端先收紧 Prisma schema、constants、DTO 和 service/controller 语义，再清理连带消费者。`ChangeTicketGateRun` 保留为从属执行记录，不再驱动主状态。前端同步收列表页、创建页、详情页，只保留极简主路径和技术区。最后用服务层单测、控制器单测、联动模块单测和前端构建做回归。

**Tech Stack:** NestJS, Prisma, Jest, React, Vite, TypeScript

---

## File Map

### Backend Core
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/schema.prisma`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/constants/change-ticket.constants.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/constants/delete-request.constants.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/dto/change-ticket.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/dto/delete-request.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.module.ts`
- Delete: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/release-gates.service.ts`

### Backend Collateral
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/business-config/business-config.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/sla-timers/sla-timer-mock.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/sla-timers/sla-timers.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/rbac.catalog.ts`

### Frontend
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketCreatePage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/DeleteRequestsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/DeleteRequestCreatePage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/DeleteRequestDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/rbac/permissions.ts`

### Tests
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.controller.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.controller.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/business-config/business-config.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/sla-timers/sla-timers.service.spec.ts`

### Docs
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/change-ticket-release-gate-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/delete-request-soft-delete-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/change-ticket-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/delete-request-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/governance-change-ticket-constraints.md`

## Canonical Runtime Contract

### Shared Statuses
```ts
const CanonicalTicketStatuses = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  READY: 'READY',
  DONE: 'DONE',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
} as const;
```

### ChangeTicket Types
```ts
const ChangeTicketTypes = {
  ADMIN_ACCESS_CHANGE: 'ADMIN_ACCESS_CHANGE',
  RBAC_CATALOG_CHANGE: 'RBAC_CATALOG_CHANGE',
} as const;
```

### DeleteRequest Target Types
```ts
const DeleteRequestTargetTypes = {
  CHANGE_TICKET: 'CHANGE_TICKET',
  AUDIT_EVIDENCE_PACKAGE: 'AUDIT_EVIDENCE_PACKAGE',
  ADMIN_USER: 'ADMIN_USER',
} as const;
```

### Approval Projection Rule
```ts
// APPROVED -> READY
// REJECTED / EXPIRED / CANCELLED -> REJECTED
```

### Terminal Rule
```ts
// DONE / FAILED / REJECTED / CANCELLED are terminal.
// Retry requires a new ticket / request.
```

## Task 1: Lock Schema, Enums, and DTO Contract

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/schema.prisma`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/constants/change-ticket.constants.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/constants/delete-request.constants.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/dto/change-ticket.dto.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/dto/delete-request.dto.ts`

- [ ] **Step 1: Write failing service-level enum expectations first**

```ts
expect(ChangeTicketStatuses).toEqual({
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  READY: 'READY',
  DONE: 'DONE',
  FAILED: 'FAILED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
});
```

```ts
expect(DeleteRequestTargetTypes).toEqual({
  CHANGE_TICKET: 'CHANGE_TICKET',
  AUDIT_EVIDENCE_PACKAGE: 'AUDIT_EVIDENCE_PACKAGE',
  ADMIN_USER: 'ADMIN_USER',
});
```

- [ ] **Step 2: Run the two governance service specs to see the old enum contract fail**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/governance/delete-requests/delete-requests.service.spec.ts --runInBand
```

Expected:
- `READY_FOR_DEPLOY`
- `READY_TO_EXECUTE`
- old type values
- old field names like `makerUserId` / `executedByUserId`

- [ ] **Step 3: Apply schema and constant reductions**

```prisma
model ChangeTicket {
  id                 String   @id @default(uuid())
  ticketNo           String   @unique @default("TEMP")
  status             String   @default("DRAFT")
  changeType         String?
  scopeSummary       String?
  changeReason       String?
  testEvidenceRef    String?
  rollbackPlanRef    String?
  bindingSnapshotJson String  @default("{}")
  bindingDigest      String?
  approvalCaseId     String?
  approvalNo         String?
  traceId            String
  createdByUserId    String
  createdByUserNo    String
  submittedByUserId  String?
  submittedByUserNo  String?
  consumedByUserId   String?
  consumedByUserNo   String?
  resultNote         String?
  submittedAt        DateTime?
  consumedAt         DateTime?
  deletedAt          DateTime?
  deletedBy          String?
  deleteRequestId    String?
  deleteRequestNo    String?
  deleteReason       String?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt
}
```

```ts
// Remove:
// SUBMITTED, APPROVAL_PENDING, READY_FOR_DEPLOY, DEPLOYED, DEPLOY_FAILED, CLOSED
// GOVERNANCE_POLICY_CHANGE, COMPLIANCE_WORKFLOW_CHANGE,
// CUSTOMER_LIFECYCLE_WORKFLOW_CHANGE, AUDIT_EVIDENCE_POLICY_CHANGE
// COMPLIANCE_CASE_EVIDENCE_PACKAGE
```

- [ ] **Step 4: Shrink DTOs to the new contract**

```ts
export class CreateChangeTicketDto {
  @IsIn(CHANGE_TICKET_TYPE_VALUES)
  changeType!: string;

  @IsString()
  scopeSummary!: string;

  @IsString()
  changeReason!: string;

  @IsString()
  testEvidenceRef!: string;

  @IsString()
  rollbackPlanRef!: string;

  @IsOptional()
  @IsString()
  traceId?: string;
}
```

```ts
// Remove ChangeTicket DTOs:
// ResubmitChangeTicketDto
// CloseChangeTicketDto
// GateCheckDto
// MarkDeployStatusDto
//
// DeleteRequest rename:
// ExecuteDeleteRequestDto -> ConsumeDeleteRequestDto
```

- [ ] **Step 5: Regenerate Prisma client after schema edits**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run prisma:generate
```

Expected:
- Prisma client generation completes without schema errors

- [ ] **Step 6: Create the migration for the physical schema changes**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npx prisma migrate dev --name wave1_change_delete_ticket_minimalization
```

Expected:
- a new folder appears under `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/prisma/migrations/`
- local Prisma schema and SQL stay in sync

## Task 2: Refactor ChangeTicket Backend to the Minimal Workflow

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.controller.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.module.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/identity/access-control/rbac.catalog.ts`
- Delete: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/release-gates.service.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.service.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/change-tickets/change-tickets.controller.spec.ts`

- [ ] **Step 1: Replace the old state progression tests with the new canonical path**

```ts
it('projects approved approval to READY', async () => {
  expect(result?.status).toBe(ChangeTicketStatuses.READY);
});

it('marks consume success to DONE', async () => {
  expect(result.status).toBe(ChangeTicketStatuses.DONE);
});

it('marks consume failure to FAILED and keeps it terminal', async () => {
  expect(result.status).toBe(ChangeTicketStatuses.FAILED);
  await expect(service.consume('ticket-1', { reason: 'retry' }, actor)).rejects.toBeInstanceOf(
    BadRequestException,
  );
});
```

- [ ] **Step 2: Run only change-ticket tests before refactor**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/governance/change-tickets/change-tickets.controller.spec.ts --runInBand
```

Expected:
- failures around removed statuses
- failures around removed `release-gates` controller delegation

- [ ] **Step 3: Replace submit/approval/consume semantics in the service**

```ts
// create -> DRAFT
// submit -> PENDING_APPROVAL
// approval approved -> READY
// approval rejected/expired/cancelled -> REJECTED
// consume success -> DONE
// consume failure -> FAILED
```

```ts
// remove methods:
// resubmit
// close
// runGateCheck
// markDeployStatus
//
// add method:
// consume(id, dto, actor)
```

- [ ] **Step 4: Preserve operator-facing `id + No` pairs in mapping**

```ts
return {
  id: ticket.id,
  ticketNo: ticket.ticketNo,
  approvalCaseId: ticket.approvalCaseId,
  approvalNo: ticket.approvalNo,
  createdByUserId: ticket.createdByUserId,
  createdByUserNo: ticket.createdByUserNo,
  submittedByUserId: ticket.submittedByUserId,
  submittedByUserNo: ticket.submittedByUserNo,
  consumedByUserId: ticket.consumedByUserId,
  consumedByUserNo: ticket.consumedByUserNo,
};
```

- [ ] **Step 5: Collapse the controller to `create/list/get/submit/consume`**

```ts
@Post(':id/consume')
consume(
  @Req() req: any,
  @Param('id') id: string,
  @Body(new ValidationPipe({ transform: true })) body: ConsumeChangeTicketDto,
) {
  return this.changeTicketsService.consume(id, body, this.ensureAdmin(req));
}
```

```ts
// remove controller routes:
// :id/resubmit
// :id/gate-checks
// :id/deploy-status
// :id/close
// :id/gate-runs
```

- [ ] **Step 5.5: Remove stale RBAC route registrations for deleted ChangeTicket actions**

```ts
// remove from rbac.catalog.ts:
// POST /admin/control-gates/change-tickets/:id/resubmit
// GET  /admin/control-gates/change-tickets/:id/gate-runs
// POST /admin/control-gates/change-tickets/:id/gate-checks
// POST /admin/control-gates/change-tickets/:id/deploy-status
// POST /admin/control-gates/change-tickets/:id/close
//
// add:
// POST /admin/control-gates/change-tickets/:id/consume
```

- [ ] **Step 6: Remove `ReleaseGatesService` from module wiring and controller tests**

```ts
providers: [ChangeTicketsService],
exports: [ChangeTicketsService],
```

- [ ] **Step 7: Re-run change-ticket backend tests**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/governance/change-tickets/change-tickets.controller.spec.ts --runInBand
```

Expected:
- all change-ticket governance tests pass on the new workflow

## Task 3: Refactor DeleteRequest Backend to the Minimal Workflow

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.controller.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.service.spec.ts`
- Test: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/delete-requests/delete-requests.controller.spec.ts`

- [ ] **Step 1: Rewrite delete-request tests to the new names and terminal states**

```ts
it('projects approved approval to READY', async () => {
  expect(result?.status).toBe(DeleteRequestStatuses.READY);
});

it('consumes delete request to DONE', async () => {
  expect(result.status).toBe(DeleteRequestStatuses.DONE);
});

it('marks consume failure to FAILED', async () => {
  expect(result.status).toBe(DeleteRequestStatuses.FAILED);
});
```

- [ ] **Step 2: Run delete-request tests before refactor**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/delete-requests/delete-requests.controller.spec.ts --runInBand
```

Expected:
- failures around `READY_TO_EXECUTE`
- failures around `EXECUTED` / `EXECUTION_FAILED`
- failures around `COMPLIANCE_CASE_EVIDENCE_PACKAGE`

- [ ] **Step 3: Rename the field model inside the service**

```ts
// makerUserId -> createdByUserId
// executedByUserId -> consumedByUserId
// executedAt -> consumedAt
// latestApprovalId/latestApprovalStatus -> approvalCaseId/approvalNo
```

```ts
const created = await this.createRequestWithUniqueNo({
  status: DeleteRequestStatuses.DRAFT,
  createdByUserId: actor.userId,
  createdByUserNo: actor.userNo,
  targetSnapshotJson: this.serializeJson(snapshot),
  targetSnapshotDigest: digest,
});
```

- [ ] **Step 4: Restrict target resolution to the three Wave 1 target types**

```ts
switch (targetType) {
  case DeleteRequestTargetTypes.CHANGE_TICKET:
  case DeleteRequestTargetTypes.AUDIT_EVIDENCE_PACKAGE:
  case DeleteRequestTargetTypes.ADMIN_USER:
    return ...;
  default:
    throw new BadRequestException(`Unsupported delete target type: ${targetType}`);
}
```

- [ ] **Step 5: Keep `submit/cancel/consume`, rename `execute` to `consume`, and map statuses**

```ts
// submit -> PENDING_APPROVAL
// approved -> READY
// cancel -> CANCELLED
// consume success -> DONE
// consume failure -> FAILED
```

- [ ] **Step 6: Re-run delete-request backend tests**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/delete-requests/delete-requests.controller.spec.ts --runInBand
```

Expected:
- delete-request tests pass with the new fields and reduced type surface

## Task 4: Update Collateral Consumers and Remove Old Deploy Semantics

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/business-config/business-config.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/business-config/business-config.service.spec.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/sla-timers/sla-timer-mock.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/sla-timers/sla-timers.service.ts`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/src/modules/governance/sla-timers/sla-timers.service.spec.ts`

- [ ] **Step 1: Rewrite business-config publish guard to the new ticket meaning**

```ts
if (changeTicket.status !== ChangeTicketStatuses.READY) {
  throw new BadRequestException(
    `Change ticket ${changeTicket.ticketNo} must be READY before publish`,
  );
}
```

```ts
// keep approval requirement:
if (!changeTicket.approvalCaseId) {
  throw new BadRequestException(`Change ticket ${changeTicket.ticketNo} requires linked approval`);
}
```

- [ ] **Step 2: Replace old SLA/mock references to removed change types and deploy states**

```ts
changeType: ChangeTicketTypes.ADMIN_ACCESS_CHANGE
```

```ts
// replace DEPLOYED / DEPLOY_FAILED / CLOSED watchers
// with DONE / FAILED terminal handling
```

- [ ] **Step 3: Run the collateral unit tests**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/business-config/business-config.service.spec.ts src/modules/governance/sla-timers/sla-timers.service.spec.ts --runInBand
```

Expected:
- publish guard expects `READY`
- no test refers to removed type or old deploy states

## Task 5: Simplify ChangeTicket Frontend Pages

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketCreatePage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/ChangeTicketDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/rbac/permissions.ts`

- [ ] **Step 1: Reduce create-page form to the minimal fields**

```ts
const CHANGE_TYPE_OPTIONS = ['ADMIN_ACCESS_CHANGE', 'RBAC_CATALOG_CHANGE'];

const [formData, setFormData] = useState({
  changeType: 'ADMIN_ACCESS_CHANGE',
  scopeSummary: '',
  changeReason: '',
  testEvidenceRef: '',
  rollbackPlanRef: '',
});
```

```tsx
// remove:
// Risk Level
// Emergency
// Emergency Reason
// Post Approval Due At
```

- [ ] **Step 2: Simplify list filters and columns**

```ts
interface FilterState {
  ticketNo: string;
  status: string;
  changeType: string;
  approvalNo: string;
  createdByUserNo: string;
  consumedByUserNo: string;
  traceId: string;
  keyword: string;
}
```

```tsx
// remove releaseVersion filter
// replace latestApprovalStatus filter with approvalNo / operator-facing No filters
```

- [ ] **Step 3: Replace detail actions with `submit` and `consume` only**

```tsx
{canSubmit && detail.status === 'DRAFT' && <SubmitButton />}
{canConsume && detail.status === 'READY' && <ConsumeButton />}
```

```tsx
// remove:
// gate-runs fetch
// gate check action
// mark deployed / mark failed
// close action
// releaseVersion / targetEnv inputs
```

- [ ] **Step 3.5: Remove stale frontend permissions for deleted ChangeTicket actions**

```ts
// remove:
// GOV_CHANGE_TICKET_RESUBMIT
// GOV_CHANGE_TICKET_GATE_RUNS_READ
// GOV_CHANGE_TICKET_GATE_CHECK
// GOV_CHANGE_TICKET_DEPLOY_STATUS
// GOV_CHANGE_TICKET_CLOSE
//
// add:
// GOV_CHANGE_TICKET_CONSUME
```

- [ ] **Step 4: Move technical fields into a secondary section**

```tsx
<DetailCard title="Technical" columns={2}>
  <InfoField label="ID" value={detail.id} mono />
  <InfoField label="Trace ID" value={detail.traceId} mono />
  <InfoField label="Binding Digest" value={detail.bindingDigest} mono />
</DetailCard>
```

- [ ] **Step 5: Build the frontend app**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected:
- Vite build passes
- no TypeScript references to removed change-ticket fields

## Task 6: Simplify DeleteRequest Frontend Pages

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/DeleteRequestsPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/DeleteRequestCreatePage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/pages/DeleteRequestDetailPage.tsx`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web/src/rbac/permissions.ts`

- [ ] **Step 1: Remove the compliance case evidence target from the create page**

```ts
const TARGET_TYPE_OPTIONS = [
  'CHANGE_TICKET',
  'AUDIT_EVIDENCE_PACKAGE',
  'ADMIN_USER',
];
```

- [ ] **Step 2: Update list-page filters to operator-facing No pairs**

```ts
interface FilterState {
  requestNo: string;
  targetType: string;
  targetNo: string;
  status: string;
  approvalNo: string;
  createdByUserNo: string;
  consumedByUserNo: string;
  traceId: string;
  keyword: string;
}
```

- [ ] **Step 3: Replace detail naming and status language**

```tsx
interface DeleteRequestDetail {
  createdByUserId: string;
  createdByUserNo: string;
  consumedByUserId: string | null;
  consumedByUserNo: string | null;
  approvalCaseId: string | null;
  approvalNo: string | null;
  resultNote: string | null;
  consumedAt: string | null;
}
```

```tsx
// rename button path:
// execute -> consume
// READY_TO_EXECUTE -> READY
// EXECUTED -> DONE
```

- [ ] **Step 3.5: Rename frontend permission surface from execute to consume**

```ts
// rename:
// GOV_DELETE_REQUEST_EXECUTE -> GOV_DELETE_REQUEST_CONSUME
```

- [ ] **Step 4: Keep snapshot JSON in a technical section, not in the primary summary**

```tsx
<DetailCard title="Technical Snapshot" columns={1}>
  <JsonBlock title="Target Snapshot JSON" value={detail.targetSnapshotJson || {}} compact />
</DetailCard>
```

- [ ] **Step 5: Rebuild the frontend after delete-request page changes**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected:
- build passes
- no page still references `READY_TO_EXECUTE`, `EXECUTED`, or removed target type

## Task 7: Final Regression and Permanent Docs

**Files:**
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/change-ticket-release-gate-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/workflows/delete-request-soft-delete-workflow.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/change-ticket-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/specs/entities/delete-request-entity.md`
- Modify: `/Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/docs/constraints/governance-change-ticket-constraints.md`

- [ ] **Step 1: Update the permanent docs to the new semantics**

```md
ChangeTicket:
- DRAFT -> PENDING_APPROVAL -> READY -> DONE / FAILED / REJECTED / CANCELLED
- changeType only allows ADMIN_ACCESS_CHANGE / RBAC_CATALOG_CHANGE

DeleteRequest:
- DRAFT -> PENDING_APPROVAL -> READY -> DONE / FAILED / REJECTED / CANCELLED
- targetType only allows CHANGE_TICKET / AUDIT_EVIDENCE_PACKAGE / ADMIN_USER
```

- [ ] **Step 2: Run the focused backend governance regression**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm test -- src/modules/governance/change-tickets/change-tickets.service.spec.ts src/modules/governance/change-tickets/change-tickets.controller.spec.ts src/modules/governance/delete-requests/delete-requests.service.spec.ts src/modules/governance/delete-requests/delete-requests.controller.spec.ts src/modules/governance/business-config/business-config.service.spec.ts src/modules/governance/sla-timers/sla-timers.service.spec.ts --runInBand
```

Expected:
- all touched governance specs pass together

- [ ] **Step 3: Run the fastest relevant builds**

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js && npm run build
```

Run:
```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js/admin-web && npm run build
```

Expected:
- Nest build passes
- admin-web build passes

- [ ] **Step 4: Commit the minimalization as a single focused change**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
git add prisma/schema.prisma prisma/migrations src/modules/governance admin-web/src/pages docs/specs/workflows docs/specs/entities docs/constraints/governance-change-ticket-constraints.md docs/cleanup/2026-04-wave1-foundation-reset
git commit -m "refactor: minimalize change and delete tickets"
```

## Self-Review

### Spec Coverage
- Status simplification: covered by Tasks 1-3.
- Type reduction: covered by Tasks 1-3 and Tasks 5-6.
- Field layering and `id + No/code`: covered by Tasks 1-3 and Tasks 5-6.
- ChangeTicket deploy/gate removal: covered by Tasks 2 and 4-5.
- DeleteRequest Wave 1-only targets: covered by Tasks 1 and 3-6.
- Collateral updates (`business-config`, `sla-timers`): covered by Task 4.
- Permanent docs and regression: covered by Task 7.

### Placeholder Scan
- No `TODO` / `TBD`.
- Every task includes exact file paths and commands.
- Commands use existing package scripts from the repo.

### Type Consistency
- Shared terminal statuses are fixed as `DONE / FAILED / REJECTED / CANCELLED`.
- `ChangeTicket.consume` and `DeleteRequest.consume` are the runtime verbs.
- Approval projection target is fixed to `READY`.
- Removed statuses and removed type values are consistently absent from later tasks.
