# Audit Log Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the redundant AuditLogSubjectNo table and fix approval audit entity inconsistency by removing `hasDedicatedAuditService` + handler base audit logging.

**Architecture:** Two independent cleanup tracks — (A) SubjectNo table deletion removes the entire denormalization layer from schema → service → DTOs → workflows → frontend, (B) approval entity fix deletes handler base audit + `hasDedicatedAuditService` so approvals.service always writes correct entity=APPROVAL_CASE events.

**Tech Stack:** NestJS, Prisma (SQLite), React (admin-web)

---

### Task 1: Prisma Schema — Drop AuditLogSubjectNo

**Files:**
- Modify: `prisma/schema.prisma:685` (remove `subjectNos` relation on AuditLogEvent)
- Modify: `prisma/schema.prisma:1086-1101` (delete entire AuditLogSubjectNo model)

- [ ] **Step 1: Remove the subjectNos relation from AuditLogEvent model**

In `prisma/schema.prisma`, find the AuditLogEvent model (~line 685) and delete this line:

```prisma
  subjectNos      AuditLogSubjectNo[]
```

- [ ] **Step 2: Delete the entire AuditLogSubjectNo model**

Delete the full model block (~lines 1086-1101):

```prisma
model AuditLogSubjectNo {
  id          String        @id @default(uuid())
  eventId     String
  subjectRole String
  subjectType String
  subjectId   String?
  subjectNo   String
  occurredAt  DateTime
  createdAt   DateTime      @default(now())
  event       AuditLogEvent @relation(fields: [eventId], references: [id], onDelete: Cascade)

  @@index([subjectNo, occurredAt])
  @@index([subjectType, subjectNo, occurredAt])
  @@index([eventId])
  @@map("audit_log_subject_nos")
}
```

- [ ] **Step 3: Generate migration**

```bash
cd Exchange_js
npx prisma migrate dev --name drop_audit_log_subject_nos
```

Verify the generated SQL drops the `audit_log_subject_nos` table and removes the relation column.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "chore(schema): drop AuditLogSubjectNo table"
```

---

### Task 2: DTOs and Utility — Remove SubjectNo Types

**Files:**
- Delete: `src/modules/audit-logging/utils/audit-subject-no.util.ts`
- Modify: `src/modules/audit-logging/dto/audit-log.dto.ts`

- [ ] **Step 1: Delete the utility file**

```bash
rm src/modules/audit-logging/utils/audit-subject-no.util.ts
```

- [ ] **Step 2: Remove SubjectNo types from audit-log.dto.ts**

Remove these blocks:

1. `AuditSubjectRole` enum (lines 43-49):
```typescript
export enum AuditSubjectRole {
  ACTOR = 'ACTOR',
  OWNER = 'OWNER',
  ENTITY = 'ENTITY',
  RELATED = 'RELATED',
  SOURCE = 'SOURCE',
}
```

2. `AuditSubjectNoDto` class (lines 51-68):
```typescript
export class AuditSubjectNoDto {
  @ApiPropertyOptional({ enum: AuditSubjectRole })
  @IsEnum(AuditSubjectRole)
  subjectRole!: AuditSubjectRole;
  // ... rest of class
}
```

3. `AuditLogSubjectNoView` interface (lines 70-79):
```typescript
export interface AuditLogSubjectNoView {
  // ... entire interface
}
```

4. `subjectNos` field on `AuditLogView` (line 110):
```typescript
  subjectNos: AuditLogSubjectNoView[];
```

5. `primaryRefNo` field on `AuditLogView` (line 86):
```typescript
  primaryRefNo: string | null;
```

6. `subjectNos` field on `CreateAuditLogEventDto` (lines 175-183):
```typescript
  @ApiPropertyOptional({
    type: [AuditSubjectNoDto],
    description: '事件关联主体No集合（可选，未传则由系统自动构造）',
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AuditSubjectNoDto)
  subjectNos?: AuditSubjectNoDto[];
```

7. `subjectNo` and `subjectType` fields on `AuditLogQueryDto` (lines 252-260):
```typescript
  @ApiPropertyOptional({ description: '按主体No精确匹配' })
  @IsOptional()
  @IsString()
  subjectNo?: string;

  @ApiPropertyOptional({ description: '按主体类型过滤（可选）' })
  @IsOptional()
  @IsString()
  subjectType?: string;
```

8. Remove unused imports (`IsArray`, `ValidateNested`, `Type` from class-validator/class-transformer) if they become orphaned. Check before removing — they may be used by other fields.

- [ ] **Step 3: Commit**

```bash
git add -A src/modules/audit-logging/utils/ src/modules/audit-logging/dto/audit-log.dto.ts
git commit -m "chore(audit): remove SubjectNo types and utility file"
```

---

### Task 3: audit-logs.service.ts — Remove SubjectNo Logic

This is the largest single change. Remove 6 methods, the `AuditWorkflowContext.relatedSubjectNos` field, all `includeSubjectNos` patterns, and update `recordByActor`.

**Files:**
- Modify: `src/modules/audit-logging/audit-logs.service.ts`

- [ ] **Step 1: Remove imports**

Remove from the import block (~lines 27, 37-38):
```typescript
  AuditSubjectRole,       // from './dto/audit-log.dto'
```
```typescript
import {
  buildAuditSubjectNos,
  type AuditSubjectNoRecord,
} from './utils/audit-subject-no.util';
```

- [ ] **Step 2: Remove `AuditWorkflowContext.relatedSubjectNos` field**

At line 156, change the interface:
```typescript
interface AuditWorkflowContext {
  traceId: string | null;
  workflowType: string | null;
  entityOwnerNo: string | null;
}
```

Remove the `relatedSubjectNos: AuditSubjectNoRecord[];` field.

- [ ] **Step 3: Delete 5 private methods**

Delete entirely:
1. `canOperateAuditLogSubjectNo()` (~lines 193-199)
2. `buildSubjectNos()` (~lines 365-389)
3. `mergeSubjectNos()` (~lines 391-408)
4. `buildRelatedSubjectNo()` (~lines 416-431)
5. `derivePrimaryRefNo()` (~lines 1012-1060)

- [ ] **Step 4: Remove relatedSubjectNos from resolveDepositWorkflowContext**

In `resolveDepositWorkflowContext()` (~line 437), remove all `mergeSubjectNos` and `buildRelatedSubjectNo` calls. Each return statement should drop the `relatedSubjectNos` field.

**WITHDRAW path** (~line 583): remove the `relatedSubjectNos` variable and its `mergeSubjectNos(buildRelatedSubjectNo(...), buildRelatedSubjectNo(...))` calls. Change the return to:
```typescript
return {
  traceId: ...,
  workflowType: AuditWorkflowTypes.WITHDRAW,
  entityOwnerNo: resolvedEntityOwnerNo,
};
```

**SWAP path** (~line 706): same pattern — remove `relatedSubjectNos` variable, simplify return.

**DEPOSIT path** (~line 791): same pattern.

**Default return** at the end of the method: remove `relatedSubjectNos: []`.

- [ ] **Step 5: Simplify recordByActor**

In `recordByActor()` (~lines 1551-1642):

1. Remove the `buildSubjectNos()` call (~line 1577) and the `subjectNos` variable.
2. Remove `subjectNos` from the `payloadDigest` computation (~line in sha256Hex call).
3. Change `createEventWithUniqueNo()` call to not pass `subjectNos` — remove the second argument.

- [ ] **Step 6: Simplify createEventWithUniqueNo**

In `createEventWithUniqueNo()` (~lines 1246-1310):

1. Remove `subjectNos: AuditSubjectNoRecord[]` parameter.
2. Remove `withSubjectNoRelation` and `includeSubjectNos` variables.
3. Remove the `subjectNos: { create: ... }` block from `createData`.
4. Remove `...includeSubjectNos` from all `findUnique`/`create` calls inside this method.

- [ ] **Step 7: Remove includeSubjectNos from findAll, findOne, prepareEvidencePackageSelection**

In `findAll()` (~line 1672): remove `includeSubjectNos` variable and `...includeSubjectNos` spread from `findMany`/`count`.

In `findOne()` (~line 1706): same — remove from `findUnique`.

In `prepareEvidencePackageSelection()` (~line 1375): remove `includeSubjectNos` variable and spread from `findMany`.

- [ ] **Step 8: Simplify mapEvent**

In `mapEvent()` (~line 920):

1. Remove the `subjectNos` mapping block (lines that map `raw.subjectNos` to view objects).
2. Remove the `primaryRefNo: this.derivePrimaryRefNo(...)` line. Replace with `primaryRefNo: raw.entityNo ?? null`.
3. Remove `subjectNos` from the returned object.

Actually — since `primaryRefNo` is not used by any frontend page, just set it to `null` or remove it entirely from the return. But since the `AuditLogView` interface still has the field... wait, we removed it in Task 2. So just remove it from the return object entirely.

- [ ] **Step 9: Remove subjectNo/subjectType from buildWhere**

In `buildWhere()` (~line 1196): remove the block:
```typescript
if (query.subjectNo || query.subjectType) {
  andClauses.push({
    subjectNos: {
      some: {
        ...(query.subjectNo ? { subjectNo: query.subjectNo } : {}),
        ...(query.subjectType ? { subjectType: query.subjectType } : {}),
      },
    },
  });
}
```

- [ ] **Step 10: Verify compilation**

```bash
npx tsc --noEmit
```

Fix any remaining references to deleted types/methods.

- [ ] **Step 11: Commit**

```bash
git add src/modules/audit-logging/audit-logs.service.ts
git commit -m "refactor(audit): remove SubjectNo logic from audit service"
```

---

### Task 4: Workflow Files — Remove subjectNos Parameters

Remove `subjectNos` arrays and `AuditSubjectRole` imports from 6 workflow files (2 files with `subjectNo` usage in onboarding services may only import AuditSubjectRole without using it — check and remove import only).

**Files:**
- Modify: `src/modules/identity/access-control/role-definition-create-workflow.service.ts`
- Modify: `src/modules/identity/access-control/role-definition-modify-workflow.service.ts`
- Modify: `src/modules/asset-treasury/wallets/custodian-wallet-create-workflow.service.ts`
- Modify: `src/modules/asset-treasury/withdrawal-addresses/withdrawal-address-workflow.service.ts`
- Modify: `src/modules/audit-logging/audit-evidence-export-workflow.service.ts`
- Modify: `src/modules/governance/sla-timers/sla-timers.service.ts`
- Check: `src/modules/identity/onboarding/workflow-transition.service.ts`
- Check: `src/modules/identity/onboarding/onboarding-workflow-transition.service.ts`

- [ ] **Step 1: role-definition-create-workflow.service.ts**

Remove `AuditSubjectRole` from the import (line 15). Delete the `subjectNos` array (lines 140-147) from the `recordByActor` call in `initiateCreate()`.

- [ ] **Step 2: role-definition-modify-workflow.service.ts**

Same pattern — remove `AuditSubjectRole` import (line 15), delete `subjectNos` array (lines 172-179).

- [ ] **Step 3: custodian-wallet-create-workflow.service.ts**

Remove `AuditSubjectRole` import (line 9/15), delete `subjectNos` array (lines 203-208).

- [ ] **Step 4: withdrawal-address-workflow.service.ts**

Remove `AuditSubjectRole` import (line 9). Delete `subjectNos` arrays from ALL 6 `recordByActor`/`recordSystem` calls (lines 77, 136, 161, 186, 212, 256).

- [ ] **Step 5: audit-evidence-export-workflow.service.ts**

Remove `AuditSubjectRole` import (line 12). Remove the `buildApprovalRelatedSubjects` helper method if it exists, and delete `subjectNos` from all `recordByActor` calls (lines 158-163, 204-209).

- [ ] **Step 6: sla-timers.service.ts**

Remove `AuditSubjectRole` import (line 20). Delete the `timerSubjectNos()` helper method (~lines 151-182). Remove `subjectNos: this.timerSubjectNos(timer)` from `recordTimerAudit()` (~line 494).

- [ ] **Step 7: Check onboarding files**

Check `workflow-transition.service.ts` and `onboarding-workflow-transition.service.ts` — if they import `AuditSubjectRole` but don't use it in `subjectNos`, just remove the import. If they pass `subjectNos`, delete those too.

- [ ] **Step 8: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add src/modules/identity/ src/modules/asset-treasury/ src/modules/audit-logging/ src/modules/governance/
git commit -m "chore(workflows): remove subjectNos from all audit calls"
```

---

### Task 5: Approval Entity Fix — Remove hasDedicatedAuditService + Handler Audit

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts`
- Modify: `src/modules/governance/approvals/approval-handler.base.ts`
- Modify: 16 handler subclass files (see list below)

- [ ] **Step 1: Remove hasDedicatedAuditService from approvals.service.ts**

Delete the `hasDedicatedAuditService()` method (~lines 146-167).

Remove all `if (!this.hasDedicatedAuditService(...))` guards. There are 5 call sites:

1. `emitSubmittedSideEffects()` (~line 554): Remove the `if` wrapper — the `recordAudit` call should always execute.
2. `createAndSubmit()` (~line 584): Same — remove guard.
3. `approve()` (~line 687): Same.
4. `reject()` (~line 773): Same.
5. `cancel()` (~line 838): Same.

Each site: unwrap the `recordAudit` call so it runs unconditionally.

- [ ] **Step 2: Simplify approval-handler.base.ts**

Rewrite the file. The new version keeps only:
- `ApprovalDecidedEvent` interface (unchanged)
- `ApprovalHandlerBase` abstract class with:
  - `abstract readonly actionType: string`
  - `abstract readonly workflowType: string`
  - Constructor takes only `eventEmitter: EventEmitter2`
  - `private buildSecondaryEventName()` (unchanged)
  - `private emitDecidedEvent()` (unchanged)
  - `handleApproved()` — filter by actionType, call `emitDecidedEvent('APPROVED', event)` only
  - `handleRejected()` — filter by actionType, call `emitDecidedEvent('DECLINED', event)` only
  - `handleCancelled()` — filter by actionType, call `emitDecidedEvent('CANCELLED', event)` only
  - `handleExpired()` — filter by actionType, call `emitDecidedEvent('EXPIRED', event)` only

Remove: `auditLogsService` dependency, `buildAuditActor()`, `auditActions` abstract, `entityType` abstract, all `recordByActor`/`recordSystem` calls.

Remove imports: `AuditLogsService`, `AuditResult`.

The new file:
```typescript
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  ApprovalDecisionEvent,
  ApprovalEvents,
} from './constants/approval.constants';

export interface ApprovalDecidedEvent {
  decision: 'APPROVED' | 'DECLINED' | 'CANCELLED' | 'EXPIRED';
  actionType: string;
  entityRef: string;
  approvalId: string;
  approvalNo: string;
  traceId: string;
  workflowType: string;
  decisionByUserId?: string | null;
  decisionByUserNo?: string | null;
  decisionByRole?: string | null;
  decisionReason?: string | null;
  decidedAt?: string | null;
  metadata: Record<string, any>;
}

export abstract class ApprovalHandlerBase {
  abstract readonly actionType: string;
  abstract readonly workflowType: string;

  constructor(protected readonly eventEmitter: EventEmitter2) {}

  private buildSecondaryEventName(): string {
    const kebab = this.workflowType.toLowerCase().replace(/_/g, '-');
    return `workflow.${kebab}.decided`;
  }

  private async emitDecidedEvent(
    decision: ApprovalDecidedEvent['decision'],
    event: ApprovalDecisionEvent,
  ) {
    const payload: ApprovalDecidedEvent = {
      decision,
      actionType: event.actionType,
      entityRef: event.entityRef,
      approvalId: event.approvalId,
      approvalNo: event.approvalNo,
      traceId: event.traceId,
      workflowType: this.workflowType,
      decisionByUserId: event.decisionByUserId,
      decisionByUserNo: event.decisionByUserNo,
      decisionByRole: event.decisionByRole,
      decisionReason: event.decisionReason,
      decidedAt: event.decidedAt,
      metadata: {},
    };

    const eventName = this.buildSecondaryEventName();
    if (typeof this.eventEmitter.emitAsync === 'function') {
      await this.eventEmitter.emitAsync(eventName, payload);
    } else {
      this.eventEmitter.emit(eventName, payload);
    }
  }

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async handleApproved(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;
    await this.emitDecidedEvent('APPROVED', event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async handleRejected(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;
    await this.emitDecidedEvent('DECLINED', event);
  }

  @OnEvent(ApprovalEvents.CANCELLED, { async: true })
  async handleCancelled(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;
    await this.emitDecidedEvent('CANCELLED', event);
  }

  @OnEvent(ApprovalEvents.EXPIRED, { async: true })
  async handleExpired(event: ApprovalDecisionEvent) {
    if (event.actionType !== this.actionType) return;
    await this.emitDecidedEvent('EXPIRED', event);
  }
}
```

- [ ] **Step 3: Simplify all 16 handler subclasses**

Each handler currently looks like:
```typescript
@Injectable()
export class SomeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.SOME;
  readonly workflowType = AuditBusinessWorkflowTypes.SOME;
  readonly auditActions = { granted: ..., declined: ..., cancelled: ..., expired: ... };
  readonly entityType = AuditEntityTypes.SOME;

  constructor(auditLogsService: AuditLogsService, eventEmitter: EventEmitter2) {
    super(auditLogsService, eventEmitter);
  }
}
```

Change each to:
```typescript
@Injectable()
export class SomeApprovalService extends ApprovalHandlerBase {
  readonly actionType = ApprovalActionTypes.SOME;
  readonly workflowType = AuditBusinessWorkflowTypes.SOME;

  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
  }
}
```

Remove: `auditActions`, `entityType`, `AuditLogsService` import, `AuditGovernanceActions` import (if only used for auditActions), `AuditEntityTypes` import (if only used for entityType).

**The 16 files:**
1. `src/modules/audit-logging/audit-evidence-export-approval.service.ts`
2. `src/modules/asset-treasury/wallets/custodian-wallet-create-approval.service.ts`
3. `src/modules/asset-treasury/assets/asset-activation-approval.service.ts`
4. `src/modules/asset-treasury/assets/asset-reactivation-approval.service.ts`
5. `src/modules/asset-treasury/assets/asset-suspension-approval.service.ts`
6. `src/modules/identity/users/admin-mfa-reset-approval.service.ts`
7. `src/modules/identity/users/admin-suspension-approval.service.ts`
8. `src/modules/identity/users/admin-password-reset-approval.service.ts`
9. `src/modules/identity/users/admin-role-binding-change-approval.service.ts`
10. `src/modules/identity/users/admin-invite-approval.service.ts`
11. `src/modules/identity/users/admin-reactivation-approval.service.ts`
12. `src/modules/identity/access-control/role-definition-modify-approval.service.ts`
13. `src/modules/identity/access-control/role-definition-create-approval.service.ts`
14. `src/modules/governance/transaction-limits/transaction-limit-creation-approval.service.ts`
15. `src/modules/governance/transaction-limits/transaction-limit-change-approval.service.ts`
16. `src/modules/governance/approvals/approval-policy-change-approval.service.ts`

- [ ] **Step 4: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/approvals/ src/modules/audit-logging/ src/modules/asset-treasury/ src/modules/identity/
git commit -m "refactor(approvals): remove hasDedicatedAuditService, simplify handler base"
```

---

### Task 6: Remove Unused Audit Action Constants

**Files:**
- Modify: `src/modules/audit-logging/constants/audit-actions.constant.ts`

- [ ] **Step 1: Remove APPROVAL_GRANTED/DECLINED/CANCELLED/EXPIRED from AuditGovernanceActions**

In `audit-actions.constant.ts`, for each of these 17 workflow entries in `AuditGovernanceActions`, remove the 4 approval-related action constants:

1. ADMIN_INVITE (~lines 397-407)
2. ADMIN_ROLE_BINDING_CHANGE (~lines 410-418)
3. ADMIN_SUSPENSION (~lines 421-428)
4. ADMIN_REACTIVATION (~lines 431-438)
5. APPROVAL_POLICY (~lines 441-449)
6. AUDIT_EVIDENCE_EXPORT (~lines 452-461)
7. ADMIN_PASSWORD_RESET (~lines 464-478)
8. ADMIN_MFA_RESET (~lines 480-489)
9. ROLE_DEFINITION_CREATE (~lines 505-514)
10. ROLE_DEFINITION_MODIFY (~lines 517-526)
11. ASSET_LISTING (~lines 529-540)
12. CUSTODIAN_WALLET_CREATE (~lines 543-552)
13. ASSET_SUSPENSION (~lines 564-572)
14. ASSET_REACTIVATION (~lines 575-583)
15. ASSET_ACTIVATION (~lines 593-601)
16. TRANSACTION_LIMIT_CHANGE (~lines 604-614)
17. TRANSACTION_LIMIT_CREATION (~lines 617-626)

From each entry, delete lines like:
```typescript
APPROVAL_GRANTED: 'WORKFLOW_NAME_APPROVAL_GRANTED',
APPROVAL_DECLINED: 'WORKFLOW_NAME_APPROVAL_DECLINED',
APPROVAL_CANCELLED: 'WORKFLOW_NAME_APPROVAL_CANCELLED',
APPROVAL_EXPIRED: 'WORKFLOW_NAME_APPROVAL_EXPIRED',
```

- [ ] **Step 2: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/audit-logging/constants/audit-actions.constant.ts
git commit -m "chore(audit): remove unused APPROVAL_GRANTED/DECLINED/CANCELLED/EXPIRED constants"
```

---

### Task 7: Frontend — Remove Subject Anchors

**Files:**
- Modify: `admin-web/src/pages/AuditLogDetailPage.tsx`
- Modify: `admin-web/src/pages/AuditLogsPage.tsx`

- [ ] **Step 1: AuditLogDetailPage.tsx**

1. Delete the `AuditSubjectNo` interface (lines 14-21).
2. Remove `subjectNos?: AuditSubjectNo[];` from `AuditLogDetail` interface (line 57).
3. Remove `const hasSubjects = !!(detail.subjectNos?.length);` (line 246).
4. Delete the entire "Subject Anchors" section (lines 378-397):
```tsx
{/* ── 5 · SUBJECT ANCHORS ── */}
{hasSubjects && (
  <section className="px-6 py-5">
    ...
  </section>
)}
```

- [ ] **Step 2: AuditLogsPage.tsx**

1. Delete the `AuditSubjectNo` interface (lines 32-38).
2. Remove `subjectNos?: AuditSubjectNo[] | null;` from the `AuditLogItem` interface (line 29).

- [ ] **Step 3: Commit**

```bash
git add admin-web/src/pages/AuditLogDetailPage.tsx admin-web/src/pages/AuditLogsPage.tsx
git commit -m "chore(admin): remove SubjectNo display from audit log pages"
```

---

### Task 8: Test Files — Update Mocks

**Files:**
- Modify: `src/modules/governance/sla-timers/sla-timers.service.spec.ts` (if it references subjectNos)
- Check: any other test files referencing SubjectNo or hasDedicatedAuditService

- [ ] **Step 1: Find test files that reference removed concepts**

```bash
grep -rn 'subjectNo\|subjectNos\|hasDedicatedAuditService\|auditActions\|APPROVAL_GRANTED\|APPROVAL_DECLINED' src/ --include='*.spec.ts'
```

- [ ] **Step 2: Update each test file**

For any test mocking `subjectNos` in audit calls — remove the `subjectNos` from mock expectations. For tests checking `hasDedicatedAuditService` behavior — remove those test cases. For tests referencing `APPROVAL_GRANTED`/`DECLINED` actions — update to check `APPROVAL_APPROVED`/`APPROVAL_REJECTED` from the generic service instead.

- [ ] **Step 3: Run tests**

```bash
npx jest --passWithNoTests
```

- [ ] **Step 4: Commit**

```bash
git add src/
git commit -m "test: update mocks for SubjectNo removal and approval audit changes"
```

---

### Task 9: Rebuild and Smoke Test

- [ ] **Step 1: Full rebuild**

```bash
npm run dev:rebuild
```

- [ ] **Step 2: Type check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Start services**

```bash
npm run dev:start
```

Verify backend starts on port 3500, admin-web on 3501.

- [ ] **Step 4: Smoke test — create an approval and verify audit trail**

1. Create a role definition via admin API (triggers approval workflow)
2. Approve it
3. Check audit logs for the traceId — verify:
   - CREATE_REQUESTED has entity=ACCESS_CONTROL
   - APPROVAL_SUBMITTED has entity=APPROVAL_CASE
   - APPROVAL_APPROVED has entity=APPROVAL_CASE
   - ROLE_ACTIVATED has entity=ACCESS_CONTROL

4. Check audit log detail page — confirm "Subject Anchors" section no longer appears.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during smoke test"
```
