# ApprovalCase/Step Schema Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove 17 redundant fields from ApprovalCase and 1 from ApprovalStep, delete `markExecutionResult()` method and all 41 call sites, and update frontend pages that display removed fields.

**Architecture:** Fields being removed are either denormalized copies of step-level data (decision fields), workflow identity passed through approval and back (workflowType/Id/No), or policy snapshots with zero runtime branching (riskLevel, allowRetry). The event interfaces (`ApprovalDecisionEvent`, `ApprovalDecidedEvent`) keep decision fields but source them from the last decided step. `buildEventPayload()` derives from `approval.steps` instead of case columns. All `markExecutionResult()` calls become no-ops and are deleted.

**Tech Stack:** NestJS, Prisma (SQLite), React (admin-web)

---

## File Structure

| File | Responsibility |
|------|----------------|
| `prisma/schema.prisma` | Remove 17 ApprovalCase columns + 1 ApprovalStep column + 2 indexes |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Remove `ApprovalExecutionStatuses`, `ApprovalRiskLevels` enums; remove workflowType/Id/No from `ApprovalDecisionEvent` |
| `src/modules/governance/approvals/dto/approval.dto.ts` | Remove docRef, workflowType/Id/No, checkerRole from DTOs |
| `src/modules/governance/approvals/approval-policy.service.ts` | Remove riskLevel, allowRetry from `ResolvedApprovalPolicy` |
| `src/modules/governance/approvals/approvals.service.ts` | Core: delete `markExecutionResult`, `normalizeWorkflowContext`, `assertWorkflowContextConsistency`; rewrite `buildEventPayload`, `mapApproval`, `createDraftCase`, approve/reject/cancel/expire handlers; remove `deletedAt: null` filters |
| `src/modules/governance/approvals/approval-handler.base.ts` | Update `emitDecidedEvent` and audit calls to not rely on event.workflowNo; adjust `ApprovalDecidedEvent` interface |
| 17 workflow files | Delete `markExecutionResult()` calls; remove workflowType/Id/No from `createAndSubmit` DTO |
| `src/modules/audit-logging/audit-logs.service.ts` | Remove executionStatus, decision fields from Prisma selects and mapping |
| `src/modules/identity/customers/customers.service.ts` | Remove decisionByRole from Prisma select |
| `src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts` | Remove decision fields from Prisma select |
| 13 frontend pages | Remove display of deleted fields |

---

### Task 1: Prisma Schema — Remove columns and indexes

**Files:**
- Modify: `prisma/schema.prisma:735-803`

- [ ] **Step 1: Remove 17 fields from ApprovalCase**

In `prisma/schema.prisma`, the `ApprovalCase` model (line 735). Remove these lines:

```
  executionStatus                String                         @default("NOT_EXECUTED")
  riskLevel                      String                         @default("HIGH")
  checkerRoles                   String
  selectedCheckerRole            String
  allowRetry                     Boolean                        @default(true)
  docRef                         String?
  workflowType                   String?
  workflowId                     String?
  workflowNo                     String?
  decidedAt                      DateTime?
  executedAt                     DateTime?
  decisionByUserId               String?
  decisionByUserNo               String?
  decisionByRole                 String?
  decisionReason                 String?
  deletedAt                      DateTime?
  deletedBy                      String?
```

Remove these two indexes:
```
  @@index([workflowType, workflowNo, createdAt])
  @@index([deletedAt])
```

Keep these fields: `id`, `approvalNo`, `actionType`, `entityRef`, `createdByUserId`, `createdByUserNo`, `status`, `allowCancel`, `objectSnapshot`, `traceId`, `createdAt`, `updatedAt`, `submittedAt`, `timeoutAt`, `steps`, `evidencePackage`, `latestForCustomerRiskApproval`, `riskAssessments`, `linkedRegulatoryGates`, `internalTransactionForApproval`, `tierUpgradeCaseApproval`.

Keep these indexes:
```
  @@index([actionType, entityRef, status])
  @@index([status, timeoutAt])
  @@index([traceId, createdAt])
```

- [ ] **Step 2: Remove approvalNo from ApprovalStep**

In `ApprovalStep` model (line 783), remove:
```
  approvalNo            String?
```

Remove this index:
```
  @@index([approvalNo, stepNo])
```

Keep the unique constraint `@@unique([approvalCaseId, stepNo])` and the remaining index `@@index([approvalCaseId, stepNo])`.

- [ ] **Step 3: Rebuild database**

Run: `npm run dev:rebuild`
Expected: Clean rebuild with no errors.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "refactor(schema): remove 17 ApprovalCase fields + 1 ApprovalStep field"
```

---

### Task 2: Constants, DTOs, and Policy Service — Remove types and interfaces

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`
- Modify: `src/modules/governance/approvals/dto/approval.dto.ts`
- Modify: `src/modules/governance/approvals/approval-policy.service.ts`

- [ ] **Step 1: Clean up approval.constants.ts**

Delete the `ApprovalExecutionStatuses` const (lines 85-89):
```typescript
export const ApprovalExecutionStatuses = {
  NOT_EXECUTED: 'NOT_EXECUTED',
  EXECUTED: 'EXECUTED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
} as const;
```

Delete the `ApprovalRiskLevels` const (lines 91-93):
```typescript
export const ApprovalRiskLevels = {
  HIGH: 'HIGH',
} as const;
```

Remove `workflowType`, `workflowId`, `workflowNo` from the `ApprovalDecisionEvent` interface (lines 121-123):
```typescript
  workflowType?: string | null;
  workflowId?: string | null;
  workflowNo?: string | null;
```

In `DEFAULT_APPROVAL_POLICIES`, replace all `riskLevel: ApprovalRiskLevels.HIGH` with `riskLevel: 'HIGH'` (since `ApprovalRiskLevels` is being deleted). This preserves the policy-level riskLevel which stays on `ApprovalActionPolicy` model.

- [ ] **Step 2: Clean up approval.dto.ts**

In `CreateApprovalDto`, remove:
```typescript
  @IsOptional()
  @IsString()
  docRef?: string;

  @IsOptional()
  @IsString()
  workflowType?: string;

  @IsOptional()
  @IsString()
  workflowId?: string;

  @IsOptional()
  @IsString()
  workflowNo?: string;

  @IsOptional()
  @IsString()
  checkerRole?: string;
```

In `SubmitApprovalDto`, remove workflowType/Id/No fields (same pattern).

In `DecisionApprovalDto`, remove workflowType/Id/No fields (same pattern). Keep `checkerRole` (it's needed for the decision).

In `CancelApprovalDto`, remove workflowType/Id/No fields (same pattern).

- [ ] **Step 3: Clean up approval-policy.service.ts**

In `ResolvedApprovalPolicy` interface, remove `riskLevel` and `allowRetry`:
```typescript
export interface ResolvedApprovalPolicy {
  actionType: string;
  steps: PolicyStepConfig[];
  checkerRoles: string[];
  timeoutHours: number;
  allowCancel: boolean;
}
```

In `getPolicy()` method, remove riskLevel and allowRetry from the return:
```typescript
    return {
      actionType: normalizedActionType,
      steps,
      checkerRoles: deriveCheckerRoles(steps),
      timeoutHours: policy?.timeoutHours ?? fallback?.timeoutHours ?? 24,
      allowCancel: policy?.allowCancel ?? fallback?.allowCancel ?? true,
    };
```

In `listV1Policies()`, remove riskLevel and allowRetry from the return object and the return type. The type becomes:
```typescript
  async listV1Policies(): Promise<
    (ResolvedApprovalPolicy & { source: 'DEFAULT' | 'CUSTOMIZED'; editable: boolean })[]
  >
```

The return mapping removes `riskLevel` and `allowRetry` lines.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -50`
Expected: Errors only from files not yet updated (approvals.service.ts, workflow files, etc). The constants/DTO/policy files themselves should be clean.

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts src/modules/governance/approvals/dto/approval.dto.ts src/modules/governance/approvals/approval-policy.service.ts
git commit -m "refactor(approvals): remove ExecutionStatuses, RiskLevels enums; strip workflow fields from DTOs and policy"
```

---

### Task 3: approvals.service.ts — Core rewrite

This is the largest and most critical task. The service has ~1228 lines and needs ~15 distinct changes.

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`

- [ ] **Step 1: Remove imports of deleted symbols**

Remove `ApprovalExecutionStatuses` from the import at line 30. Remove `joinRoleCsv` from line 35 (only used for `checkerRoles` field which is removed).

After:
```typescript
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  ApprovalDecisionEvent,
  ApprovalEvents,
  ApprovalStatuses,
  ApprovalStepStatuses,
  isSuperAdminRoleContext,
  splitRoleCsv,
} from './constants/approval.constants';
```

- [ ] **Step 2: Remove ApprovalRequirementInput workflow fields**

Remove `workflowType`, `workflowId`, `workflowNo` from the `ApprovalRequirementInput` interface (lines 62-64):

After:
```typescript
interface ApprovalRequirementInput {
  actionType: string;
  entityRef: string;
  approvalCaseId?: string | null;
  actor?: ApprovalActorContext;
  traceId?: string | null;
}
```

- [ ] **Step 3: Delete normalizeWorkflowContext and assertWorkflowContextConsistency**

Delete the entire `normalizeWorkflowContext` method (lines 123-144).
Delete the entire `assertWorkflowContextConsistency` method (lines 146-180).

- [ ] **Step 4: Rewrite recordAudit to not use workflow fields from case**

The `recordAudit` method (line 182) reads `approval.workflowNo`, `approval.workflowType`, `approval.workflowId` for audit metadata. Since these fields no longer exist on the case, remove the `subjectNos` block and the `parentEntityType/Id/No` metadata block. Also remove `executionStatus` from metadata.

After:
```typescript
  private async recordAudit(
    action: string,
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    result: AuditResult,
    reason?: string | null,
    metadata?: Record<string, unknown>,
  ) {
    await this.auditLogsService.recordByActor(
      {
        action,
        entityType: AuditEntityTypes.APPROVAL_CASE,
        entityId: approval.id,
        entityNo: approval.approvalNo,
        traceId: approval.traceId,
        result,
        reason: reason || undefined,
        metadata: {
          approvalNo: approval.approvalNo,
          actionType: approval.actionType,
          entityRef: approval.entityRef,
          ...(metadata || {}),
        },
        requestId: `APPROVAL_${approval.approvalNo}_${action}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );
  }
```

- [ ] **Step 5: Delete hasDedicatedAuditService**

Delete the `hasDedicatedAuditService` method (lines 243-258). It reads `workflowType` from the case which no longer exists. All callers of this method use it to skip generic audit writes — since workflowType is gone, the approval service can't know whether a dedicated service exists. The simplest fix: always write the generic audit. But that would create duplicates for workflows that have their own audit. So instead, we keep the method but change it to always return false — meaning the approval service always writes its generic events. Wait — the workflows with dedicated audit services already write their own audit entries. Having both would create duplicates.

Actually, let's keep `hasDedicatedAuditService` but change its input. It can check by `actionType` instead of `workflowType`:

```typescript
  private hasDedicatedAuditService(actionType: string): boolean {
    const DEDICATED: string[] = [
      ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL,
      ApprovalActionTypes.ADMIN_INVITE_APPROVAL,
      ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL,
      ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL,
      ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL,
      ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
      ApprovalActionTypes.ROLE_DEFINITION_CREATE,
      ApprovalActionTypes.ROLE_DEFINITION_MODIFY,
      ApprovalActionTypes.ADMIN_PASSWORD_RESET,
      ApprovalActionTypes.ADMIN_MFA_RESET,
      ApprovalActionTypes.CUSTODIAN_WALLET_CREATE,
    ];
    return DEDICATED.includes(actionType);
  }
```

Update all call sites from `this.hasDedicatedAuditService(xxx.workflowType)` to `this.hasDedicatedAuditService(xxx.actionType)`.

Call sites:
- `emitSubmittedSideEffects` (line 690): `approval.workflowType` → `approval.actionType`
- `createAndSubmit` (line 720): `submitted.workflowType` → `submitted.actionType`
- `approve` (line 830): `updated.workflowType` → `updated.actionType`
- `reject` (line 923): `updated.workflowType` → `updated.actionType`
- `cancel` (line 994): `updated.workflowType` → `updated.actionType`
- `markExecutionResult` (line 1037): deleted entirely in a later step

- [ ] **Step 6: Rewrite buildEventPayload to derive from steps**

Replace `buildEventPayload` (lines 261-278). Instead of reading case-level decision fields, derive from the last non-PENDING step:

```typescript
  private buildEventPayload(approval: ApprovalCaseRow): ApprovalDecisionEvent {
    const decidedStep = [...(approval.steps || [])]
      .sort((a: any, b: any) => b.stepNo - a.stepNo)
      .find((s: any) => s.status !== ApprovalStepStatuses.PENDING);

    return {
      approvalId: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      traceId: approval.traceId,
      status: approval.status,
      decisionByUserId: decidedStep?.decidedByUserId || null,
      decisionByUserNo: decidedStep?.decidedByUserNo || null,
      decisionByRole: decidedStep?.decidedByRole || null,
      decisionReason: decidedStep?.reason || null,
      decidedAt: decidedStep?.decidedAt
        ? decidedStep.decidedAt.toISOString()
        : null,
    };
  }
```

- [ ] **Step 7: Remove deletedAt check from findCaseOrThrow**

In `findCaseOrThrow` (line 324), remove `|| found.deletedAt`:
```typescript
    if (!found) {
      throw new NotFoundException(`Approval case not found: ${id}`);
    }
```

- [ ] **Step 8: Remove approvalNo from createCaseWithUniqueNo step creation**

In `createCaseWithUniqueNo` (line 370-372), steps are created with `approvalNo`. Remove that:
```typescript
        const stepsPayload = stepsCreate
          ? {
              create: Array.isArray(stepsCreate)
                ? stepsCreate
                : stepsCreate,
            }
          : undefined;
```

Actually simpler — just pass through `steps` as-is since we no longer inject `approvalNo`:
```typescript
        const stepsPayload = data.steps;
```

Wait, the steps are inside a `create` wrapper. Let me keep the original structure but just stop adding `approvalNo`:
```typescript
        const stepsPayload = stepsCreate
          ? { create: stepsCreate }
          : undefined;
```

- [ ] **Step 9: Rewrite mapApproval to remove deleted fields**

In `mapApproval` (line 394), remove: `executionStatus`, `riskLevel`, `checkerRoles` local variable and return field, `docRef`, `workflowType`, `workflowId`, `workflowNo`, `decidedAt`, `decisionByUserNo`, `executedAt`.

Remove the `checkerRoles` split at line 399 since the field is gone.

The `resolveDecisionRole` fallback at line 509 (`splitRoleCsv(approval.checkerRoles)`) needs to use step candidates instead. This is already handled by `stepCandidateRoles` parameter — ensure callers always pass it.

After:
```typescript
  private mapApproval(approval: ApprovalCaseRow, actor?: ApprovalActorContext) {
    const cancellableStatuses = new Set<string>([
      ApprovalStatuses.DRAFT,
      ApprovalStatuses.PENDING,
    ]);
    const pendingStep = (approval.steps || []).find(
      (s: any) => s.status === ApprovalStepStatuses.PENDING,
    );
    const stepRoles = pendingStep
      ? splitRoleCsv(pendingStep.checkerRoleCandidates)
      : [];
    const availableDecisionRoles = actor
      ? this.isSuperAdmin(actor)
        ? stepRoles
        : stepRoles.filter((role) => actor.roleCodes.includes(role))
      : [];
    const makerCheckerConflict = actor
      ? !this.isSuperAdmin(actor) &&
        actor.userId === approval.createdByUserId &&
        availableDecisionRoles.length > 0
      : false;
    const crossStepConflict = actor
      ? this.hasActorApprovedAnyStep(approval.steps || [], actor.userId)
      : false;
    const canDecide =
      approval.status === ApprovalStatuses.PENDING &&
      !!pendingStep &&
      availableDecisionRoles.length > 0 &&
      !makerCheckerConflict &&
      !crossStepConflict;

    return {
      id: approval.id,
      approvalNo: approval.approvalNo,
      actionType: approval.actionType,
      entityRef: approval.entityRef,
      createdByUserId: approval.createdByUserId,
      createdByUserNo: approval.createdByUserNo || null,
      status: approval.status,
      objectSnapshot: approval.objectSnapshot ? JSON.parse(approval.objectSnapshot as string) : null,
      traceId: approval.traceId,
      submittedAt: approval.submittedAt,
      timeoutAt: approval.timeoutAt,
      createdAt: approval.createdAt,
      updatedAt: approval.updatedAt,
      availableDecisionRoles,
      canApprove: canDecide,
      canReject: canDecide,
      canCancel:
        !!actor &&
        approval.allowCancel &&
        (actor.userId === approval.createdByUserId || this.isSuperAdmin(actor)) &&
        cancellableStatuses.has(approval.status),
    };
  }
```

- [ ] **Step 10: Rewrite mapApprovalsForReadModel**

In `mapApprovalsForReadModel` (line 461), remove `selectedCheckerRole`, `allowRetry`, `decisionReason` from the spread. Remove `approvalNo` from step mapping (line 470).

After:
```typescript
  private async mapApprovalsForReadModel(
    approvals: ApprovalCaseRow[],
    actor?: ApprovalActorContext,
  ) {
    return approvals.map((approval) => {
      const allSteps = (approval.steps || [])
        .sort((a: any, b: any) => a.stepNo - b.stepNo)
        .map((s: any) => ({
          id: s.id,
          stepNo: s.stepNo,
          status: s.status,
          checkerRoleCandidates: splitRoleCsv(s.checkerRoleCandidates),
          decidedByUserNo: s.decidedByUserNo || null,
          decidedByRole: s.decidedByRole,
          reason: s.reason,
          decidedAt: s.decidedAt,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        }));
      const currentStep = allSteps.find((s: any) => s.status === 'PENDING') || allSteps[0] || null;

      return {
        ...this.mapApproval(approval, actor),
        allowCancel: approval.allowCancel,
        step: currentStep,
        steps: allSteps,
        evidencePackage: approval.evidencePackage,
      };
    });
  }
```

- [ ] **Step 11: Rewrite resolveDecisionRole**

Remove the `splitRoleCsv(approval.checkerRoles)` fallback at line 509. The `allowedRoles` should come solely from `stepCandidateRoles`:

```typescript
  private async resolveDecisionRole(
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    requestedRole?: string,
    stepCandidateRoles?: string[],
  ): Promise<string> {
    const normalizedRequestedRole = this.normalizeOptionalString(requestedRole);
    const allowedRoles = stepCandidateRoles || [];
    // ... rest unchanged
```

- [ ] **Step 12: Rewrite createDraftCase**

Remove `normalizeWorkflowContext` call (line 571). Remove `deletedAt: null` from findFirst where (line 578). Remove from create data: `executionStatus`, `riskLevel`, `checkerRoles`, `selectedCheckerRole`, `allowRetry`, `docRef`, `workflowType`, `workflowId`, `workflowNo`.

Remove the `selectedCheckerRole` validation block (lines 595-601).

After:
```typescript
  private async createDraftCase(
    dto: CreateApprovalDto,
    actor: ApprovalActorContext,
    client?: ApprovalWriteClient,
  ): Promise<ApprovalCaseRow> {
    const db = this.getDb(client);
    const actionType = String(dto.actionType || '').trim().toUpperCase();
    const entityRef = String(dto.entityRef || '').trim();

    if (!actionType) {
      throw new BadRequestException('actionType is required');
    }
    if (!entityRef) {
      throw new BadRequestException('entityRef is required');
    }

    const existingPending = await db.approvalCase.findFirst({
      where: {
        actionType,
        entityRef,
        status: ApprovalStatuses.PENDING,
      },
      include: this.approvalInclude(),
      orderBy: { createdAt: 'desc' },
    });

    if (existingPending) {
      this.assertTraceConsistency(existingPending.traceId, dto.traceId);
      return existingPending as ApprovalCaseRow;
    }

    const policy = await this.approvalPolicyService.getPolicy(actionType);
    if (!policy.steps.length) {
      throw new BadRequestException(`No steps configured for actionType ${actionType}`);
    }

    return this.createCaseWithUniqueNo(
      {
        actionType,
        entityRef,
        createdByUserId: actor.userId,
        createdByUserNo: this.normalizeOptionalString(actor.userNo),
        status: ApprovalStatuses.DRAFT,
        allowCancel: policy.allowCancel,
        objectSnapshot: dto.objectSnapshot ? JSON.stringify(dto.objectSnapshot) : null,
        traceId: this.normalizeOptionalString(dto.traceId) || randomUUID(),
        steps: {
          create: policy.steps.map((step) => ({
            stepNo: step.stepNo,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: step.roles.join(','),
          })),
        },
      },
      client,
    );
  }
```

- [ ] **Step 13: Clean submitCase**

Remove `this.assertWorkflowContextConsistency(approval, dto)` call (line 650).
Remove `decisionReason` from the update data (line 676).

After update data:
```typescript
      data: {
        status: ApprovalStatuses.PENDING,
        submittedAt: now,
        timeoutAt,
      },
```

- [ ] **Step 14: Clean approve handler — remove case-level decision writes**

In `approve` (line 751), remove `this.assertWorkflowContextConsistency(approval, dto)` (line 758).

In the "Last step: case APPROVED" update (lines 815-827), remove `selectedCheckerRole`, `decisionByUserId`, `decisionByUserNo`, `decisionByRole`, `decisionReason`, `decidedAt` from the data:

After:
```typescript
      return tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.APPROVED,
        },
        include: this.approvalInclude(),
      }) as Promise<ApprovalCaseRow>;
```

Update `hasDedicatedAuditService` call (line 830): `updated.workflowType` → `updated.actionType`.

- [ ] **Step 15: Clean reject handler — remove case-level decision writes**

In `reject` (line 849), remove `this.assertWorkflowContextConsistency(approval, dto)` (line 856).

In the case update (lines 908-920), remove `selectedCheckerRole`, `decisionByUserId`, `decisionByUserNo`, `decisionByRole`, `decisionReason`, `decidedAt`:

After:
```typescript
      return tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.REJECTED,
        },
        include: this.approvalInclude(),
      }) as Promise<ApprovalCaseRow>;
```

Update `hasDedicatedAuditService` call (line 923): `updated.workflowType` → `updated.actionType`.

- [ ] **Step 16: Clean cancel handler — remove case-level decision writes**

In `cancel` (line 940), remove `this.assertWorkflowContextConsistency(approval, dto)` (line 959).

In the case update (lines 978-989), remove `decisionByUserId`, `decisionByUserNo`, `decisionByRole`, `decisionReason`, `decidedAt`:

After:
```typescript
      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.CANCELLED,
        },
        include: this.approvalInclude(),
      });
```

Update `hasDedicatedAuditService` call (line 994): `updated.workflowType` → `updated.actionType`.

- [ ] **Step 17: Delete markExecutionResult method**

Delete the entire `markExecutionResult` method (lines 1011-1049).

- [ ] **Step 18: Clean requireApproved**

Remove `deletedAt: null` from the findFirst where (line 1058).
Remove `this.assertWorkflowContextConsistency(approval, input)` call (line 1089).

- [ ] **Step 19: Clean list method**

Remove `deletedAt: null` from the where clause (line 1109).
Remove `decisionByUserNo` and `decisionByUserId` from keyword search OR clause (lines 1125-1127).

After OR clause:
```typescript
      where.OR = [
        { approvalNo: { contains: keyword } },
        { id: { contains: keyword } },
        { actionType: { contains: keyword } },
        { entityRef: { contains: keyword } },
        { createdByUserNo: { contains: keyword } },
        { createdByUserId: { contains: keyword } },
      ];
```

- [ ] **Step 20: Clean expirePendingApprovalCase**

In the case update (lines 1171-1178), remove `decisionReason` and `decidedAt`:

After:
```typescript
      const next = await tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.EXPIRED,
        },
        include: this.approvalInclude(),
      });
```

- [ ] **Step 21: Clean expirePendingApprovals**

Remove `deletedAt: null` from the where clause (line 1205).

- [ ] **Step 22: Verify TypeScript compiles for this file**

Run: `npx tsc --noEmit 2>&1 | grep 'approvals.service' | head -10`
Expected: No errors in approvals.service.ts. Other files (workflows, etc.) will still have errors.

- [ ] **Step 23: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "refactor(approvals): remove 17 case fields from service core, delete markExecutionResult"
```

---

### Task 4: approval-handler.base.ts — Update event bridge

**Files:**
- Modify: `src/modules/governance/approvals/approval-handler.base.ts`

- [ ] **Step 1: Remove workflowNo from audit entityNo**

In `handleApproved` (line 93), `handleRejected` (line 116), `handleCancelled` (line 144), `handleExpired` (line 164): change `entityNo: event.workflowNo || undefined` to `entityNo: event.approvalNo`.

The `entityNo` was using the workflow's business number. Since event no longer carries `workflowNo`, use `approvalNo` as the audit entity reference. The workflow handler already writes its own audit log with the correct domain entityNo — this is just the approval-level audit.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | grep 'approval-handler.base' | head -5`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/approval-handler.base.ts
git commit -m "refactor(approvals): use approvalNo as audit entityNo in handler base"
```

---

### Task 5: 17 Workflow Files — Delete markExecutionResult calls and workflowType/Id/No from createAndSubmit

This is mechanical deletion across 17 files. Each file has 2-5 `markExecutionResult` calls and 3 lines of `workflowType/Id/No` in the `createAndSubmit` DTO.

**Files (all under `src/modules/`):**
- Modify: `identity/users/admin-invite-workflow.service.ts`
- Modify: `identity/users/admin-suspension-workflow.service.ts`
- Modify: `identity/users/admin-reactivation-workflow.service.ts`
- Modify: `identity/users/admin-role-binding-change-workflow.service.ts`
- Modify: `identity/users/admin-password-reset-workflow.service.ts`
- Modify: `identity/users/admin-mfa-reset-workflow.service.ts`
- Modify: `identity/access-control/role-definition-create-workflow.service.ts`
- Modify: `identity/access-control/role-definition-modify-workflow.service.ts`
- Modify: `identity/onboarding/onboarding-final-approval.service.ts`
- Modify: `asset-treasury/assets/asset-activation-workflow.service.ts`
- Modify: `asset-treasury/assets/asset-suspension-workflow.service.ts`
- Modify: `asset-treasury/assets/asset-reactivation-workflow.service.ts`
- Modify: `asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`
- Modify: `governance/transaction-limits/transaction-limit-change-workflow.service.ts`
- Modify: `governance/transaction-limits/transaction-limit-creation-workflow.service.ts`
- Modify: `governance/approvals/approval-policy-change-workflow.service.ts`
- Modify: `audit-logging/audit-evidence-export-workflow.service.ts`

- [ ] **Step 1: For each file, delete all markExecutionResult calls**

The pattern is always one of:
```typescript
// Pattern A: success
await this.approvalsService.markExecutionResult(
  event.approvalId,
  true,
  SYSTEM_ACTOR_OR_BUILT_ACTOR,
  'reason',
);

// Pattern B: failure
await this.approvalsService.markExecutionResult(
  event.approvalId,
  false,
  SYSTEM_ACTOR_OR_BUILT_ACTOR,
  error.message,
);

// Pattern C: failure with .catch
await this.approvalsService
  .markExecutionResult(...)
  .catch(() => undefined);
```

Delete the entire `await this.approvalsService.markExecutionResult(...)` statement (including `.catch()` chains). For Pattern C, also delete the `.catch(() => undefined)` line. After deletion, if there's only `throw error;` left in a catch block, keep it.

- [ ] **Step 2: For each file, remove workflowType/Id/No from createAndSubmit DTO**

The pattern in each file's `createAndSubmit` call:
```typescript
approvalCase = await this.approvalsService.createAndSubmit(
  {
    actionType: ApprovalActionTypes.XXX,
    entityRef: someEntity.id,
    workflowType: AuditBusinessWorkflowTypes.XXX,   // DELETE
    workflowId: someEntity.id,                       // DELETE
    workflowNo: someEntity.someNo,                   // DELETE
    traceId,
    objectSnapshot: { ... },
  },
  { reason: '...', traceId },
  actor,
);
```

Delete the three `workflowType`, `workflowId`, `workflowNo` lines from each createAndSubmit call's first argument.

Also remove `docRef` if any file passes it (check `approval-policy-change-workflow.service.ts`).

- [ ] **Step 3: For each file, remove workflowType/Id/No from submit DTO if present**

Some files may pass `workflowType/Id/No` in the second argument (SubmitApprovalDto). Check and remove.

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -30`
Expected: Errors only from remaining files not yet updated (frontend, other backend consumers).

- [ ] **Step 5: Commit**

```bash
git add src/modules/identity/ src/modules/asset-treasury/ src/modules/governance/ src/modules/audit-logging/audit-evidence-export-workflow.service.ts
git commit -m "refactor(workflows): delete all markExecutionResult calls, remove workflowType/Id/No from createAndSubmit"
```

---

### Task 6: Other Backend Consumers — Update Prisma selects

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts`
- Modify: `src/modules/identity/customers/customers.service.ts`
- Modify: `src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts`

- [ ] **Step 1: audit-logs.service.ts — Remove deleted fields from Prisma selects and mapping**

At lines 3061-3067 (list evidence packages query), remove from select:
```
              executionStatus: true,
              deletedAt: true,
              decisionByUserNo: true,
              decisionByUserId: true,
              decisionByRole: true,
```

At lines 3100-3106 (find evidence package query), same removal.

At lines 829-841 (mapEvidencePackage), remove `!raw.approvalCase.deletedAt` condition and remove `executionStatus`, `decisionByUserNo`, `decisionByUserId`, `decisionByRole` from the mapped object.

After mapping:
```typescript
      approvalCase: raw.approvalCase
        ? {
            id: raw.approvalCase.id,
            approvalNo: raw.approvalCase.approvalNo,
            actionType: raw.approvalCase.actionType,
            entityRef: raw.approvalCase.entityRef,
            status: raw.approvalCase.status,
            traceId: raw.approvalCase.traceId,
            decidedAt: raw.approvalCase.decidedAt,
            createdAt: raw.approvalCase.createdAt,
            updatedAt: raw.approvalCase.updatedAt,
          }
        : null,
```

Wait — `decidedAt` is also removed from the case. Remove it too:
```typescript
      approvalCase: raw.approvalCase
        ? {
            id: raw.approvalCase.id,
            approvalNo: raw.approvalCase.approvalNo,
            actionType: raw.approvalCase.actionType,
            entityRef: raw.approvalCase.entityRef,
            status: raw.approvalCase.status,
            traceId: raw.approvalCase.traceId,
            createdAt: raw.approvalCase.createdAt,
            updatedAt: raw.approvalCase.updatedAt,
          }
        : null,
```

And from the Prisma selects, also remove `decidedAt: true`.

- [ ] **Step 2: customers.service.ts — Remove decisionByRole from select**

At line 16-17, the `riskApprovalSummarySelect` includes `decidedAt` and `decisionByRole`. Remove both:

```typescript
const riskApprovalSummarySelect = {
  id: true,
  approvalNo: true,
  status: true,
} satisfies Prisma.ApprovalCaseSelect;
```

- [ ] **Step 3: internal-transactions.service.ts — Remove decision fields from select**

At lines 836-838, remove:
```
            decisionByUserId: true,
            decisionByRole: true,
            decisionReason: true,
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No backend errors remaining.

- [ ] **Step 5: Commit**

```bash
git add src/modules/audit-logging/audit-logs.service.ts src/modules/identity/customers/customers.service.ts src/modules/asset-treasury/internal-transactions/internal-transactions.service.ts
git commit -m "refactor(consumers): remove deleted ApprovalCase fields from Prisma selects"
```

---

### Task 7: Test Files — Update mocks

**Files:**
- Modify: `src/modules/identity/users/admin-role-binding-change-workflow.service.spec.ts`
- Modify: `src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts`
- Modify: `src/modules/identity/users/admin-password-reset-workflow.service.spec.ts`

- [ ] **Step 1: Remove markExecutionResult from mock objects**

In each spec file, find the mock `approvalsService` object and remove `markExecutionResult: jest.fn(...)` line.

- [ ] **Step 2: Remove markExecutionResult assertions**

Search each spec for `expect(approvalsService.markExecutionResult)` and delete those assertion blocks.

- [ ] **Step 3: Run affected tests**

Run: `npx jest admin-role-binding-change-workflow admin-password-reset-workflow onboarding-final-approval 2>&1 | tail -20`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/users/admin-role-binding-change-workflow.service.spec.ts src/modules/identity/onboarding/onboarding-final-approval.service.spec.ts src/modules/identity/users/admin-password-reset-workflow.service.spec.ts
git commit -m "test: remove markExecutionResult from workflow test mocks and assertions"
```

---

### Task 8: Frontend — Remove deleted fields from admin pages

**Files:**
- Modify: `admin-web/src/pages/ApprovalDetailPage.tsx`
- Modify: `admin-web/src/pages/ApprovalsPage.tsx`
- Modify: `admin-web/src/pages/GovernanceRegistryFormPage.tsx`
- Modify: `admin-web/src/pages/governanceRegistryFormConfig.ts`
- Modify: `admin-web/src/pages/GovernanceRegistryDetailPage.tsx`
- Modify: `admin-web/src/pages/CaseEvidenceExportDetailPage.tsx`
- Modify: `admin-web/src/pages/CaseEvidenceExportsPage.tsx`
- Modify: `admin-web/src/pages/EvidenceExportsPage.tsx`
- Modify: `admin-web/src/pages/EvidenceExportDetailPage.tsx`
- Modify: `admin-web/src/pages/PolicyChangeRequestDetailPage.tsx`
- Modify: `admin-web/src/pages/PolicyChangeRequestsPage.tsx`
- Modify: `admin-web/src/pages/RoleChangeRequestDetailPage.tsx`
- Modify: `admin-web/src/pages/RoleChangeRequestsPage.tsx`

- [ ] **Step 1: ApprovalDetailPage.tsx**

Remove all references to: `executionStatus`, `executedAt`, `riskLevel`, `selectedCheckerRole`, `checkerRoles`, `allowRetry`, `docRef`, `workflowType`, `workflowNo`, `decisionByUserNo`, `decisionReason`, `decidedAt`.

These will be in type definitions, destructured fields, JSX display sections, and sidebar fields. Remove the entire display blocks (InfoField, SidebarKV, etc.) for these fields. If a whole section becomes empty, remove the section.

Note: Step-level decision fields (from `steps[]`) stay — they show per-step decisions.

- [ ] **Step 2: ApprovalsPage.tsx**

Remove `executionStatus` from the table columns and type definition.

- [ ] **Step 3: GovernanceRegistryFormPage.tsx**

Remove `docRef` input field and any references to it.

- [ ] **Step 4: governanceRegistryFormConfig.ts**

Remove `docRef` from form state, initial values, validation, and mapping.

- [ ] **Step 5: GovernanceRegistryDetailPage.tsx**

Remove `docRef` display.

- [ ] **Step 6: Evidence export pages**

In `CaseEvidenceExportDetailPage.tsx`, `CaseEvidenceExportsPage.tsx`, `EvidenceExportsPage.tsx`, `EvidenceExportDetailPage.tsx`: remove `executionStatus` references.

- [ ] **Step 7: Policy/Role change request pages**

In `PolicyChangeRequestDetailPage.tsx` and `PolicyChangeRequestsPage.tsx`: remove `executedAt` references.
In `RoleChangeRequestDetailPage.tsx` and `RoleChangeRequestsPage.tsx`: remove `executedAt` references.

**IMPORTANT:** These pages display `PolicyChangeRequest` and `RoleDefinitionChangeRequest` model fields. Only remove `executedAt` if it's reading from `approvalCase.executedAt`. If it's reading from the change request model's own `executedAt`, DO NOT remove it.

- [ ] **Step 8: Start admin-web dev server and verify**

Run: `cd admin-web && npm run dev -- --port 3501`
Navigate to: approval list, approval detail, governance registry form, evidence export pages.
Expected: Pages render without errors. Removed fields are gone from UI.

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/
git commit -m "refactor(admin-web): remove deleted ApprovalCase fields from all admin pages"
```

---

### Task 9: Rebuild and Smoke Test

- [ ] **Step 1: Full rebuild**

```bash
npm run dev:rebuild
```

Expected: Clean rebuild, no migration errors.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Run all approval-related tests**

```bash
npx jest approvals 2>&1 | tail -20
npx jest approval-policy 2>&1 | tail -20
npx jest admin-invite-workflow 2>&1 | tail -10
npx jest admin-role-binding-change-workflow 2>&1 | tail -10
npx jest onboarding-final-approval 2>&1 | tail -10
npx jest admin-password-reset-workflow 2>&1 | tail -10
```

Expected: All pass.

- [ ] **Step 4: Start full stack and test basic approval flow**

```bash
npm run dev:start
```

Create and approve one test approval via the admin UI to verify the happy path works end-to-end.

- [ ] **Step 5: Final commit (if any fixes needed)**

Only if smoke testing reveals issues that need fixing.
