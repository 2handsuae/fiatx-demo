# Wave 2 Compliance Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all Wave 2 internal compliance code (alerts/incidents/orchestrator), move audit-logs to a standalone module, and consolidate two parallel Sumsub webhook paths into one canonical entry point.

**Architecture:**
- `src/modules/risk-engine/audit-logs/` → `src/modules/audit-logging/` (Wave 1 foundation, standalone)
- `compliance-alerts/`, `compliance-incidents/`, `risk-decision-orchestrator.service.ts` → deleted entirely
- All caller services stripped of alert/incident injection and call sites
- Sumsub: `identity/sumsub-integration/` merged into `sumsub-ingestion/`; single canonical webhook at `POST /webhooks/sumsub`

**Tech Stack:** NestJS 10, TypeScript 5, Prisma 6, SQLite

**⚠️ Intentional Behavior Change:** Periodic review will no longer RESTRICT customers internally after cleanup. This is by design — the RESTRICT path will be reconnected via Sumsub webhook in a future Wave 3 reconnection sprint.

---

## File Map

### Created
- `src/modules/audit-logging/` (moved from `risk-engine/audit-logs/`, 9 files)
- `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` (moved from `identity/sumsub-integration/`)

### Deleted
- `src/modules/risk-engine/audit-logs/` (entire directory, moved)
- `src/modules/risk-engine/compliance-alerts/` (entire directory, 8 files)
- `src/modules/risk-engine/compliance-incidents/` (entire directory, 16 files)
- `src/modules/risk-engine/risk-decision-orchestrator.service.ts`
- `src/modules/identity/sumsub-integration/` (entire directory, 3 files)
- `src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts`
- `src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts`
- `src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts`

### Modified
- `src/modules/risk-engine/risk-engine.module.ts`
- `src/modules/risk-engine/transaction-compliance/transaction-compliance.module.ts`
- `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts`
- `src/modules/identity/onboarding/onboarding.module.ts`
- `src/modules/identity/onboarding/onboarding.service.ts`
- `src/modules/identity/periodic-review/periodic-review.service.ts`
- `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.module.ts`
- `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts`
- `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts`
- `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`
- `src/app.module.ts`
- `Exchange_js/AGENTS.md`
- `prisma/schema.prisma`

---

## Task 1: Move audit-logs to standalone module

**Files:**
- Create: `src/modules/audit-logging/` (9 files moved from `risk-engine/audit-logs/`)
- Modify: `src/app.module.ts`
- Delete: `src/modules/risk-engine/audit-logs/`

**Why first:** 127 files import from `risk-engine/audit-logs`. Moving it now means all subsequent cleanup tasks work with correct import paths.

- [ ] **Step 1.1: Copy the audit-logs directory**

```bash
cp -r src/modules/risk-engine/audit-logs src/modules/audit-logging
```

- [ ] **Step 1.2: Update all 127 import paths with a single sed command**

Run from `Exchange_js/` directory:

```bash
find src -name "*.ts" ! -path "*/node_modules/*" -exec sed -i '' 's|risk-engine/audit-logs|audit-logging|g' {} +
```

- [ ] **Step 1.3: Verify the replacement worked**

```bash
grep -r "risk-engine/audit-logs" src/ --include="*.ts"
```
Expected: no output (zero matches).

- [ ] **Step 1.4: Update app.module.ts import path**

Open `src/app.module.ts`. The line:
```typescript
import { AuditLogsModule } from './modules/risk-engine/audit-logs/audit-logs.module';
```
Should now read (after sed, verify it was updated):
```typescript
import { AuditLogsModule } from './modules/audit-logging/audit-logs.module';
```
If sed already handled it, this is just a verification step.

- [ ] **Step 1.5: Delete the old directory**

```bash
rm -rf src/modules/risk-engine/audit-logs
```

- [ ] **Step 1.6: Build to verify no broken imports**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 1.7: Commit**

```bash
git add src/modules/audit-logging src/app.module.ts
git rm -r src/modules/risk-engine/audit-logs
git commit -m "refactor: move audit-logs to standalone module src/modules/audit-logging"
```

---

## Task 2: Delete RiskDecisionOrchestratorService and strip from all callers

**Files:**
- Modify: `src/modules/identity/onboarding/onboarding.service.ts`
- Modify: `src/modules/identity/periodic-review/periodic-review.service.ts`
- Modify: `src/modules/risk-engine/risk-engine.module.ts`
- Delete: `src/modules/risk-engine/risk-decision-orchestrator.service.ts`

**Context:** `RiskDecisionOrchestratorService` exists solely to create compliance alerts for onboarding/periodic-review workflows. Both callers must have it removed before the file is deleted.

### Step 2.1 — onboarding.service.ts

- [ ] **Step 2.1a: Remove RiskDecisionOrchestratorService from onboarding.service.ts**

In `src/modules/identity/onboarding/onboarding.service.ts`:

1. Delete the import line:
```typescript
import { RiskDecisionOrchestratorService } from '../../risk-engine/risk-decision-orchestrator.service';
```

2. Remove `private readonly riskDecisionOrchestratorService: RiskDecisionOrchestratorService,` from the constructor.

3. Search for all uses of `this.riskDecisionOrchestratorService` in the file. For each call:
   - If the return value is used for `alertId` or `alertNo`, replace with a no-op or delete the block.
   - If the call is in a void context, delete the call.

Run:
```bash
grep -n "riskDecisionOrchestratorService" src/modules/identity/onboarding/onboarding.service.ts
```
Remove every line or block found.

### Step 2.2 — periodic-review.service.ts

- [ ] **Step 2.2a: Remove RiskDecisionOrchestratorService from periodic-review.service.ts**

In `src/modules/identity/periodic-review/periodic-review.service.ts`:

1. Delete the import for `RiskDecisionOrchestratorService`.
2. Remove from constructor: `private readonly riskDecisionOrchestratorService: RiskDecisionOrchestratorService,`
3. Find all usages:
```bash
grep -n "riskDecisionOrchestratorService" src/modules/identity/periodic-review/periodic-review.service.ts
```
Remove every call or block. If a block uses the return value for `alertId`, replace the variable with `null` or `undefined`.

### Step 2.3 — risk-engine.module.ts

- [ ] **Step 2.3a: Update risk-engine.module.ts to remove orchestrator**

Replace the entire file content with:

```typescript
import { Module } from '@nestjs/common';
import { RiskEngineService } from './risk-engine.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { RiskDecisionRecordsService } from './risk-decision-records.service';
import { RiskDecisionRecordsAdminController } from './risk-decision-records-admin.controller';

@Module({
  imports: [PrismaModule],
  providers: [
    RiskEngineService,
    RiskDecisionRecordsService,
  ],
  controllers: [RiskDecisionRecordsAdminController],
  exports: [
    RiskEngineService,
    RiskDecisionRecordsService,
  ],
})
export class RiskEngineModule {}
```

### Step 2.4 — Delete the file

- [ ] **Step 2.4a: Delete the orchestrator service file**

```bash
rm src/modules/risk-engine/risk-decision-orchestrator.service.ts
```

- [ ] **Step 2.5: Build to verify**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 2.6: Commit**

```bash
git add src/modules/identity/onboarding/onboarding.service.ts \
  src/modules/identity/periodic-review/periodic-review.service.ts \
  src/modules/risk-engine/risk-engine.module.ts
git rm src/modules/risk-engine/risk-decision-orchestrator.service.ts
git commit -m "refactor: delete RiskDecisionOrchestratorService and remove all callers"
```

---

## Task 3: Strip compliance from transaction-risk-bridge.service.ts

**Files:**
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts`

**Context:** 4077-line file. Remove only the compliance alert/incident integration points. The KYT/Travel Rule case logic itself stays intact.

- [ ] **Step 3.1: Remove imports at lines 5–7**

Delete these 3 import lines:
```typescript
import { ComplianceAlertsService } from '../compliance-alerts/compliance-alerts.service';
import { ComplianceAlertSeverity } from '../compliance-alerts/constants/compliance-alert-rules.constant';
import { ComplianceIncidentsService } from '../compliance-incidents/compliance-incidents.service';
```

Also update the audit-logs import (now at the new path, already handled by Task 1's sed):
```typescript
import { AuditLogsService } from '../../../modules/audit-logging/audit-logs.service';
```
(Verify this was updated by Task 1 sed — it should be.)

- [ ] **Step 3.2: Remove the two private helper methods (lines 400–424)**

Delete the entire `getComplianceAlertsService()` method (lines 400–411):
```typescript
private getComplianceAlertsService() {
  const service =
    this.moduleRef?.get(ComplianceAlertsService, {
      strict: false,
    }) || null;
  if (!service) {
    throw new NotFoundException(
      'ComplianceAlertsService is unavailable in TransactionRiskBridgeService',
    );
  }
  return service;
}
```

Delete the entire `getComplianceIncidentsService()` method (lines 413–424):
```typescript
private getComplianceIncidentsService() {
  const service =
    this.moduleRef?.get(ComplianceIncidentsService, {
      strict: false,
    }) || null;
  if (!service) {
    throw new NotFoundException(
      'ComplianceIncidentsService is unavailable in TransactionRiskBridgeService',
    );
  }
  return service;
}
```

- [ ] **Step 3.3: Remove the 5 UPSERT_ALERT blocks**

For each of the 5 alert-creation blocks, delete the pattern:

**Pattern to find and delete (appears 5 times, each variation similar):**
```typescript
let alert: { id: string; alertNo?: string | null } | null = null;
if (
  !decisionResult.reused &&
  actionNames.includes(RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT)
) {
  const alertAction = decisionResult.recommendedActions.find(
    (item) =>
      normalizeRiskRecommendedActionType(item.type) ===
      RISK_RECOMMENDED_ACTIONS.UPSERT_ALERT,
  );
  alert = await this.getComplianceAlertsService().triggerSystemAlert(
    { ... }  // entire call block
  );
}
```

**Locations (approximate line numbers):**
1. Deposit final review: around line 993 — `UPSERT_ALERT` block for `TX_DEPOSIT_FINAL_REVIEW_REQUIRED`
2. Swap final review: around line 2608 — `UPSERT_ALERT` block for `TX_SWAP_FINAL_REVIEW_REQUIRED`
3. Withdraw final review: around line 3056 — `UPSERT_ALERT` block for `TX_WITHDRAW_FINAL_REVIEW_REQUIRED`
4. KYT review: around line 3720 — `UPSERT_ALERT` block for `TX_KYT_REVIEW_REQUIRED`
5. Travel Rule review: around line 3924 — `UPSERT_ALERT` block for `TX_TRAVEL_RULE_REVIEW_REQUIRED`

For each: delete the `let alert = null` declaration AND the entire `if (...UPSERT_ALERT...)` block. Then search downstream in the same method for any use of the `alert` variable (e.g., passing `alert?.id` to a return value or another function). Replace `alert?.id` with `null` and `alert?.alertNo` with `null`. If `alert` was the sole return value, remove the return or replace with a minimal result.

- [ ] **Step 3.4: Verify no remaining references to removed symbols**

```bash
grep -n "ComplianceAlertsService\|ComplianceIncidentsService\|getComplianceAlertsService\|getComplianceIncidentsService\|triggerSystemAlert" \
  src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts
```
Expected: no output.

- [ ] **Step 3.5: Build to verify**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 3.6: Commit**

```bash
git add src/modules/risk-engine/transaction-compliance/transaction-risk-bridge.service.ts
git commit -m "refactor: remove compliance alert/incident calls from TransactionRiskBridgeService"
```

---

## Task 4: Strip compliance from periodic-review.service.ts

**Files:**
- Modify: `src/modules/identity/periodic-review/periodic-review.service.ts`

**Context:** Remove `ComplianceAlertsService` and `ComplianceIncidentsService` imports, constructor injection, and all call sites. The RESTRICT action (via incident) will be reconnected via Sumsub webhook in a future sprint.

- [ ] **Step 4.1: Remove imports**

Delete these two import lines:
```typescript
import { ComplianceAlertsService } from '../../risk-engine/compliance-alerts/compliance-alerts.service';
import { ComplianceIncidentsService } from '../../risk-engine/compliance-incidents/compliance-incidents.service';
```

- [ ] **Step 4.2: Remove from constructor**

Remove both injected parameters from the constructor:
```typescript
private readonly complianceAlertsService: ComplianceAlertsService,
private readonly complianceIncidentsService: ComplianceIncidentsService,
```

- [ ] **Step 4.3: Remove call sites — find all usages**

```bash
grep -n "complianceAlertsService\|complianceIncidentsService" \
  src/modules/identity/periodic-review/periodic-review.service.ts
```

For each hit:

**Block around line 1524 (triggerSystemAlert):**
Delete the entire block that calls `this.complianceAlertsService.triggerSystemAlert(...)` and the subsequent `createFromAlertInTransaction` + `applyActionInTransaction` calls. Replace the deleted block with a single comment:
```typescript
// TODO(Wave3-reconnect): RESTRICT customer via Sumsub webhook signal
```

**Line ~1850 (findOne for alert in return):**
Delete or replace the `complianceAlertsService.findOne(result.alertId)` call. If the result is part of a `Promise.all`, remove that array element. If `alertDetail` is returned to the caller, replace it with `null`.

**Lines ~1972–1973 (findOne for alert and incident):**
Delete the `complianceAlertsService.findOne(result.alertId)` and `complianceIncidentsService.findOne(incidentId)` entries from `Promise.all`. Replace with `null` for the corresponding variables or remove them.

- [ ] **Step 4.4: Verify no remaining references**

```bash
grep -n "complianceAlertsService\|complianceIncidentsService\|ComplianceAlertsService\|ComplianceIncidentsService" \
  src/modules/identity/periodic-review/periodic-review.service.ts
```
Expected: no output.

- [ ] **Step 4.5: Build to verify**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 4.6: Commit**

```bash
git add src/modules/identity/periodic-review/periodic-review.service.ts
git commit -m "refactor: remove compliance alert/incident calls from PeriodicReviewService"
```

---

## Task 5: Strip compliance from onboarding.service.ts

**Files:**
- Modify: `src/modules/identity/onboarding/onboarding.service.ts`

- [ ] **Step 5.1: Remove import**

Delete:
```typescript
import { ComplianceIncidentsService } from '../../risk-engine/compliance-incidents/compliance-incidents.service';
```

- [ ] **Step 5.2: Remove from constructor**

Remove:
```typescript
private readonly complianceIncidentsService: ComplianceIncidentsService,
```

- [ ] **Step 5.3: Find and remove all usages**

```bash
grep -n "complianceIncidentsService\|ComplianceIncidentsService" \
  src/modules/identity/onboarding/onboarding.service.ts
```

For each hit: delete the call or block. If a return value from `complianceIncidentsService` is used downstream, replace with `null` or remove.

- [ ] **Step 5.4: Verify**

```bash
grep -n "complianceIncidentsService\|ComplianceIncidentsService" \
  src/modules/identity/onboarding/onboarding.service.ts
```
Expected: no output.

- [ ] **Step 5.5: Build**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 5.6: Commit**

```bash
git add src/modules/identity/onboarding/onboarding.service.ts
git commit -m "refactor: remove ComplianceIncidentsService from OnboardingService"
```

---

## Task 6: Strip compliance from safeguarding-reconciliation.service.ts

**Files:**
- Modify: `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts`

- [ ] **Step 6.1: Remove import**

Delete:
```typescript
import { ComplianceAlertsService } from '../../risk-engine/compliance-alerts/compliance-alerts.service';
```

- [ ] **Step 6.2: Remove from constructor**

The constructor currently is:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly complianceAlertsService: ComplianceAlertsService,
  private readonly auditLogsService: AuditLogsService,
) {}
```

Replace with:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly auditLogsService: AuditLogsService,
) {}
```

- [ ] **Step 6.3: Remove the alert creation block (around line 997)**

Find and delete the block:
```typescript
const alert = await this.complianceAlertsService.triggerSystemAlert(
  {
    ruleCode: TRANSACTION_REVIEW_RULES.TX_SAFEGUARDING_BREAK_DETECTED,
    sourceModule: AuditModules.SAFEGUARDING_RECONCILIATION,
    sourceType: SAFEGUARDING_BREAK_SOURCE_TYPE,
    ...
  }
);
```

If `alert` is used after creation (e.g., `alert.id` stored on the break record), replace it with `null` or remove the downstream storage.

- [ ] **Step 6.4: Verify**

```bash
grep -n "complianceAlertsService\|ComplianceAlertsService" \
  src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts
```
Expected: no output.

- [ ] **Step 6.5: Build**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 6.6: Commit**

```bash
git add src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.service.ts
git commit -m "refactor: remove ComplianceAlertsService from SafeguardingReconciliationService"
```

---

## Task 7: Delete compliance module directories and update all module files

**Files:**
- Delete: `src/modules/risk-engine/compliance-alerts/` (entire directory)
- Delete: `src/modules/risk-engine/compliance-incidents/` (entire directory)
- Modify: `src/modules/risk-engine/risk-engine.module.ts` (already done in Task 2)
- Modify: `src/modules/risk-engine/transaction-compliance/transaction-compliance.module.ts`
- Modify: `src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.module.ts`
- Modify: `src/modules/identity/onboarding/onboarding.module.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 7.1: Delete the compliance directories**

```bash
rm -rf src/modules/risk-engine/compliance-alerts
rm -rf src/modules/risk-engine/compliance-incidents
```

- [ ] **Step 7.2: Update transaction-compliance.module.ts**

Replace entire file with:
```typescript
import { Module } from '@nestjs/common';
import { TransactionComplianceService } from './transaction-compliance.service';
import { TransactionComplianceAdminController } from './transaction-compliance-admin.controller';
import { RiskEngineModule } from '../risk-engine.module';
import { TransactionRiskBridgeService } from './transaction-risk-bridge.service';

@Module({
  imports: [RiskEngineModule],
  providers: [TransactionComplianceService, TransactionRiskBridgeService],
  controllers: [TransactionComplianceAdminController],
  exports: [TransactionComplianceService],
})
export class TransactionComplianceModule {}
```

- [ ] **Step 7.3: Update safeguarding-reconciliation.module.ts**

Replace entire file with:
```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { SafeguardingReconciliationController } from './safeguarding-reconciliation.controller';
import { SafeguardingReconciliationService } from './safeguarding-reconciliation.service';

@Module({
  imports: [PrismaModule],
  controllers: [SafeguardingReconciliationController],
  providers: [SafeguardingReconciliationService],
  exports: [SafeguardingReconciliationService],
})
export class SafeguardingReconciliationModule {}
```

- [ ] **Step 7.4: Update onboarding.module.ts**

Replace entire file with (removes `ComplianceAlertsModule` and `ComplianceIncidentsModule`):
```typescript
import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { PrismaModule } from '../../../core/prisma/prisma.module';
import { OnboardingService } from './onboarding.service';
import { OnboardingCustomerController } from './onboarding-customer.controller';
import { OnboardingAdminController } from './onboarding-admin.controller';
import { RiskEngineModule } from '../../risk-engine/risk-engine.module';
import { WorkflowTransitionService } from './workflow-transition.service';
import { OnboardingWorkflowTransitionService } from './onboarding-workflow-transition.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OnboardingFinalApprovalService } from './onboarding-final-approval.service';
import { PeriodicReviewService } from '../periodic-review/periodic-review.service';
import { PeriodicReviewCustomerController } from '../periodic-review/periodic-review-customer.controller';
import { PeriodicReviewAdminController } from '../periodic-review/periodic-review-admin.controller';
import { PeriodicReviewSweepService } from '../periodic-review/periodic-review-sweep.service';
import { PeriodicReviewWorkflowTransitionService } from '../periodic-review/periodic-review-workflow-transition.service';
import { SumsubClient } from './providers/sumsub/sumsub.client';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';

@Module({
  imports: [
    PrismaModule,
    RiskEngineModule,
    ApprovalsModule,
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [
    OnboardingService,
    WorkflowTransitionService,
    OnboardingWorkflowTransitionService,
    OnboardingFinalApprovalService,
    PeriodicReviewService,
    PeriodicReviewSweepService,
    PeriodicReviewWorkflowTransitionService,
    SumsubClient,
  ],
  controllers: [
    OnboardingCustomerController,
    OnboardingAdminController,
    PeriodicReviewCustomerController,
    PeriodicReviewAdminController,
  ],
  exports: [OnboardingService, OnboardingFinalApprovalService, PeriodicReviewService, SumsubClient],
})
export class OnboardingModule implements OnModuleInit {
  constructor(
    private readonly finalApprovalService: OnboardingFinalApprovalService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  onModuleInit() {
    this.finalApprovalService.materialRefreshService = this.materialRefreshService;
  }
}
```

- [ ] **Step 7.5: Update app.module.ts — remove ComplianceAlertsModule and ComplianceIncidentsModule**

In `src/app.module.ts`:

1. Delete the two import lines:
```typescript
import { ComplianceAlertsModule } from './modules/risk-engine/compliance-alerts/compliance-alerts.module';
import { ComplianceIncidentsModule } from './modules/risk-engine/compliance-incidents/compliance-incidents.module';
```

2. Remove `ComplianceAlertsModule` and `ComplianceIncidentsModule` from the `imports` array inside `@Module({...})`.

- [ ] **Step 7.6: Verify no remaining references to deleted modules**

```bash
grep -rn "ComplianceAlertsModule\|ComplianceIncidentsModule\|compliance-alerts\|compliance-incidents" \
  src/ --include="*.ts"
```
Expected: no output.

- [ ] **Step 7.7: Build to verify**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 7.8: Commit**

```bash
git add src/modules/risk-engine/transaction-compliance/transaction-compliance.module.ts \
  src/modules/clearing-settle/safeguarding-reconciliation/safeguarding-reconciliation.module.ts \
  src/modules/identity/onboarding/onboarding.module.ts \
  src/app.module.ts
git rm -r src/modules/risk-engine/compliance-alerts \
  src/modules/risk-engine/compliance-incidents
git commit -m "refactor: delete compliance-alerts and compliance-incidents modules; update all module files"
```

---

## Task 8: Remove Wave 2 compliance tables from Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 8.1: Remove the 9 compliance tables from schema.prisma**

Open `prisma/schema.prisma` and delete the following complete model blocks:

1. `model ComplianceAlert { ... }`
2. `model ComplianceAlertEvent { ... }`
3. `model ComplianceAlertDispositionRecord { ... }`
4. `model ComplianceIncident { ... }`
5. `model ComplianceIncidentEvent { ... }`
6. `model ComplianceIncidentDispositionRecord { ... }`
7. `model ComplianceIncidentReport { ... }`
8. `model ComplianceIncidentExternalFiling { ... }`
9. `model ComplianceCaseEvidencePackage { ... }`

Also remove any `@relation` fields that reference these models from OTHER models (e.g., if `KytCase` has `complianceAlert   ComplianceAlert?   @relation(...)`).

**Search for references to deleted models:**
```bash
grep -n "ComplianceAlert\|ComplianceIncident\|ComplianceCaseEvidence" prisma/schema.prisma
```
Delete every reference found (both the model blocks and any `@relation` fields).

- [ ] **Step 8.2: Rebuild the local database**

```bash
npm run dev:rebuild
```
Expected: completes successfully with no schema validation errors.

- [ ] **Step 8.3: Build to verify**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output. (Prisma client is regenerated by `dev:rebuild` so all `prisma.complianceAlert.*` references from deleted code are already gone.)

- [ ] **Step 8.4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "refactor: remove Wave 2 compliance tables from Prisma schema"
```

---

## Task 9: Consolidate Sumsub webhook — merge dispatcher into sumsub-ingestion

**Files:**
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.module.ts`
- Create: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` (moved)
- Delete: `src/modules/identity/sumsub-integration/` (entire directory)
- Delete: `src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts` + spec
- Delete: `src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts`
- Modify: `src/app.module.ts`

**Context:** The current `SumsubIngestionService.dispatch()` only routes to `OnboardingService`. The smart multi-context routing lives in `SumsubWebhookDispatcher`. We merge the dispatcher logic into `SumsubIngestionService` and delete the dispatcher.

### Step 9.1 — Update SumsubIngestionService.dispatch()

- [ ] **Step 9.1: Replace dispatch() method in sumsub-ingestion.service.ts**

1. Add the following imports at the top of the file (after existing imports):

```typescript
import { OnboardingService } from '../identity/onboarding/onboarding.service';
import { ClientRiskAssessmentService } from '../identity/client-risk-assessment/client-risk-assessment.service';
import { MaterialRefreshService } from '../identity/material-refresh/material-refresh.service';
```

(Note: `OnboardingService` import already exists — only add the two new ones.)

2. Update the constructor to inject the two new services:

```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly onboardingService: OnboardingService,
  private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
  private readonly materialRefreshService: MaterialRefreshService,
) {}
```

3. Replace the existing `dispatch()` method body (the block from `if (event.context === 'ONBOARDING')` to `throw new Error(...)`) with the smart routing logic:

```typescript
async dispatch(event: SumsubWebhookEvent): Promise<unknown> {
  try {
    const payload = this.parseRawPayload(event.rawPayload);
    let result: unknown;
    let dispatchedTo: string;

    // Clue 1: explicit reviewMode tells us this is doc monitoring
    if ((payload as any).reviewMode === 'ongoingDocExpired') {
      dispatchedTo = 'MATERIAL_REFRESH_DOC_MONITORING';
      result = await this.materialRefreshService.handleSumsubDocMonitoringFire({
        applicantId: String((payload as any).applicantId || ''),
      });
    }

    // Clue 2: matching pending ClientRiskAssessment by inspectionId
    else if ((payload as any).inspectionId && (payload as any).reviewResult) {
      const pending = await this.prisma.clientRiskAssessment.findFirst({
        where: {
          sumsubAmlCheckInspectionId: String((payload as any).inspectionId),
          status: 'PENDING_SUMSUB_RESULT',
        },
      });
      if (pending) {
        dispatchedTo = 'CLIENT_RISK_ASSESSMENT_AML';
        result = await this.clientRiskAssessmentService.handleSumsubAmlResult(
          String((payload as any).inspectionId),
          (payload as any).reviewResult,
        );
      } else {
        dispatchedTo = 'UNROUTED_INSPECTION_NO_PENDING';
        this.logger.warn('dispatch: no pending CRA for inspectionId', { inspectionId: (payload as any).inspectionId });
      }
    }

    // Clue 3: matching pending MaterialRefreshCycle by actionId
    else if ((payload as any).actionId && (payload as any).reviewResult) {
      const pending = await this.prisma.materialRefreshCycle.findFirst({
        where: {
          sumsubActionId: String((payload as any).actionId),
          status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] },
        },
      });
      if (pending) {
        dispatchedTo = 'MATERIAL_REFRESH_ACTION';
        result = await this.materialRefreshService.handleSumsubActionResult({
          actionId: String((payload as any).actionId),
          reviewResult: (payload as any).reviewResult,
        });
      } else {
        dispatchedTo = 'UNROUTED_ACTION_NO_PENDING';
        this.logger.warn('dispatch: no pending cycle for actionId', { actionId: (payload as any).actionId });
      }
    }

    // Clues 4 & 5: look up customer by applicantId
    else {
      const applicantId = String((payload as any).applicantId || '');
      if (!applicantId) {
        dispatchedTo = 'UNROUTED_NO_APPLICANT_ID';
        this.logger.warn('dispatch: no applicantId in payload');
      } else {
        const customer = await this.prisma.customerMain.findFirst({
          where: { sumsubApplicantId: applicantId },
        });

        if (!customer) {
          dispatchedTo = 'UNROUTED_NO_CUSTOMER';
          this.logger.warn('dispatch: no customer for applicantId', { applicantId });
        }

        // Clue 4: customer in PENDING_VERIFICATION → onboarding
        else if (customer.onboardingStatus === 'PENDING_VERIFICATION') {
          dispatchedTo = 'ONBOARDING';
          result = await this.onboardingService.handleSumsubVerificationEvent(payload as any, {
            simulated: event.isSimulated,
            actorId: event.isSimulated
              ? (event.externalUserId || event.simulatedByUserId || 'ADMIN_SIM')
              : 'SUMSUB',
            simulatedByUserId: event.simulatedByUserId || null,
            rawBody: Buffer.from(JSON.stringify(payload)),
          });
        }

        // Clue 5: APPROVED customer + spontaneous AML RED → new CRA
        else if (
          customer.onboardingStatus === 'APPROVED' &&
          (payload as any).type === 'applicantReviewed' &&
          (payload as any).reviewResult?.reviewAnswer === 'RED'
        ) {
          dispatchedTo = 'CLIENT_RISK_ASSESSMENT_SPONTANEOUS';
          await this.clientRiskAssessmentService.startAssessment({
            customerId: customer.id,
            triggerType: 'SUMSUB_AML_HIT',
            triggeredContext: {
              spontaneousEvent: payload,
              labels: (payload as any).reviewResult?.rejectLabels || [],
            },
          });
        }

        else {
          dispatchedTo = 'UNROUTED';
          this.logger.warn('dispatch: unrouted webhook', {
            applicantId,
            type: (payload as any).type,
            customerStatus: customer?.onboardingStatus,
          });
        }
      }
    }

    await this.prisma.sumsubWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: 'PROCESSED',
        processedAt: new Date(),
        dispatchedTo: dispatchedTo!,
      },
    });

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const newRetryCount = event.retryCount + 1;
    const newStatus = newRetryCount >= MAX_DISPATCH_ATTEMPTS ? 'DEAD' : 'FAILED';

    await this.prisma.sumsubWebhookEvent.update({
      where: { id: event.id },
      data: {
        status: newStatus,
        retryCount: newRetryCount,
        lastRetryAt: new Date(),
        lastErrorMessage: message,
      },
    });

    if (newStatus === 'DEAD') {
      this.logger.error(
        `Event ${event.eventNo} is DEAD after ${newRetryCount} attempts: ${message}`,
      );
    }

    throw err;
  }
}
```

### Step 9.2 — Update SumsubIngestionModule

- [ ] **Step 9.2: Replace sumsub-ingestion.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { OnboardingModule } from '../identity/onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../identity/client-risk-assessment/client-risk-assessment.module';
import { MaterialRefreshModule } from '../identity/material-refresh/material-refresh.module';
import { SumsubIngestionService } from './sumsub-ingestion.service';
import { SumsubIngestionController } from './sumsub-ingestion.controller';
import { SumsubIngestionAdminController } from './sumsub-ingestion-admin.controller';
import { SumsubRetryService } from './sumsub-ingestion-retry.service';
import { AdminSumsubSimulationController } from './admin-sumsub-simulation.controller';

@Module({
  imports: [
    PrismaModule,
    OnboardingModule,
    ClientRiskAssessmentModule,
    MaterialRefreshModule,
  ],
  providers: [SumsubIngestionService, SumsubRetryService],
  controllers: [
    SumsubIngestionController,
    SumsubIngestionAdminController,
    AdminSumsubSimulationController,
  ],
  exports: [SumsubIngestionService],
})
export class SumsubIngestionModule {}
```

### Step 9.3 — Move AdminSumsubSimulationController

- [ ] **Step 9.3: Copy admin-sumsub-simulation.controller.ts to sumsub-ingestion/**

```bash
cp src/modules/identity/sumsub-integration/admin-sumsub-simulation.controller.ts \
   src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts
```

- [ ] **Step 9.4: Update the copied file's imports and dependencies**

Open `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`.

1. Replace the import of `SumsubWebhookDispatcher`:
```typescript
// DELETE:
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';

// REPLACE WITH:
import { SumsubIngestionService } from './sumsub-ingestion.service';
```

2. Replace the import path for `ClientRiskAssessmentService`:
```typescript
// DELETE:
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';

// REPLACE WITH:
import { ClientRiskAssessmentService } from '../modules/identity/client-risk-assessment/client-risk-assessment.service';
```

Wait — since the file is now in `sumsub-ingestion/` (at `src/modules/sumsub-ingestion/`), the relative path to identity modules is `../identity/`:

```typescript
import { ClientRiskAssessmentService } from '../identity/client-risk-assessment/client-risk-assessment.service';
import { PrismaService } from '../../core/prisma/prisma.service';
```

3. In the constructor, replace `SumsubWebhookDispatcher` with `SumsubIngestionService`:

```typescript
constructor(
  private readonly sumsubIngestionService: SumsubIngestionService,
  private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
  @Inject(PrismaService)
  private readonly prisma: PrismaService & Record<string, any>,
) {}
```

4. Replace every call to `this.dispatcher.dispatch(payload, ctx)` with `this.sumsubIngestionService.ingest(payload, { isSimulated: true, simulatedByUserId: ctx.actorId })`.

There are 4 such calls in the controller (methods: `simulateAmlCheckResult`, `simulateApplicantActionResult`, `simulateRiskAssessmentScenario`, `simulateOngoingDocMonitoring`).

For each, change:
```typescript
return this.dispatcher.dispatch(
  { ... payload ... } as any,
  { simulated: true, actorId: 'ADMIN_SIMULATION' },
);
```
To:
```typescript
const { dispatchResult } = await this.sumsubIngestionService.ingest(
  { ... payload ... },
  { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
);
return dispatchResult;
```

### Step 9.4 — Delete the legacy files

- [ ] **Step 9.5: Delete sumsub-integration directory**

```bash
rm -rf src/modules/identity/sumsub-integration
```

- [ ] **Step 9.6: Delete legacy onboarding sumsub controllers**

```bash
rm src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts
rm src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts
rm src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts
```

### Step 9.5 — Update app.module.ts

- [ ] **Step 9.7: Remove SumsubIntegrationModule from app.module.ts**

In `src/app.module.ts`:

1. Delete:
```typescript
import { SumsubIntegrationModule } from './modules/identity/sumsub-integration/sumsub-integration.module';
```

2. Remove `SumsubIntegrationModule` from the `imports` array.

### Step 9.6 — Verify and commit

- [ ] **Step 9.8: Verify no remaining references to deleted files**

```bash
grep -rn "SumsubIntegrationModule\|SumsubWebhookDispatcher\|onboarding-sumsub-webhook\|onboarding-sumsub-simulation" \
  src/ --include="*.ts"
```
Expected: no output.

- [ ] **Step 9.9: Build to verify**

```bash
npm run build 2>&1 | grep -E "error TS|Cannot find"
```
Expected: no output.

- [ ] **Step 9.10: Commit**

```bash
git add src/modules/sumsub-ingestion/
git rm -r src/modules/identity/sumsub-integration
git rm src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts \
  src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.spec.ts \
  src/modules/identity/onboarding/onboarding-sumsub-simulation.controller.ts
git add src/app.module.ts
git commit -m "refactor: consolidate Sumsub webhook into sumsub-ingestion; delete sumsub-integration module"
```

---

## Task 10: Update AGENTS.md

**Files:**
- Modify: `Exchange_js/AGENTS.md`

- [ ] **Step 10.1: Fix the backend domain module table in AGENTS.md**

Find the table row:
```
| risk-engine | src/modules/risk-engine | 合规告警、案件、事件、审计日志 |
```

Replace with two rows:
```
| audit-logging | src/modules/audit-logging | Wave 1 审计日志基础设施（全局模块） |
| risk-engine | src/modules/risk-engine | 交易风险决策记录（KYT/Travel Rule 风险评估）；Wave 2 合规内容已废弃 |
```

- [ ] **Step 10.2: Add note about Sumsub unification**

In the "Recent Core Decisions" section or a new entry, add:

```markdown
## Recent Core Decisions (2026-04-11)
- Wave 2 internal compliance center (alerts/incidents/orchestrator) fully removed.
  - `compliance-alerts/`, `compliance-incidents/`, `risk-decision-orchestrator.service.ts` deleted.
  - Transaction compliance (KYT/Travel Rule case records) kept; alert creation removed pending Sumsub reconnection.
  - Periodic review RESTRICT path removed; will be reconnected via Sumsub webhook in future sprint.
- Sumsub webhook consolidated: single canonical endpoint `POST /webhooks/sumsub` via `SumsubIngestionModule`.
  - `identity/sumsub-integration/` deleted; dispatcher logic merged into `SumsubIngestionService`.
  - Legacy `POST /onboarding/sumsub/webhook` endpoint removed.
- audit-logs module moved from `src/modules/risk-engine/audit-logs/` to `src/modules/audit-logging/` (Wave 1 foundation).
```

- [ ] **Step 10.3: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md — audit-logging standalone, Wave 2 removal, Sumsub unification"
```

---

## Final Verification

- [ ] **Step 11.1: Full clean build**

```bash
npm run build 2>&1 | tail -5
```
Expected: ends with `Successfully compiled` or `webpack compiled` with no errors.

- [ ] **Step 11.2: Database rebuild**

```bash
npm run dev:rebuild
```
Expected: completes successfully.

- [ ] **Step 11.3: Scope verification — confirm no Wave 2 code remains**

```bash
# Should return no results:
grep -rn "ComplianceAlert\|ComplianceIncident\|RiskDecisionOrchestrator\|SumsubWebhookDispatcher\|SumsubIntegrationModule" \
  src/ --include="*.ts"
```

```bash
# audit-logging module should exist:
ls src/modules/audit-logging/
```

```bash
# sumsub-integration should be gone:
ls src/modules/identity/sumsub-integration/ 2>&1
```
Expected: `No such file or directory`

---

## Self-Review

**Spec coverage:**
- [x] audit-logs moved to standalone module — Task 1
- [x] RiskDecisionOrchestratorService deleted — Task 2
- [x] compliance-alerts directory deleted — Task 7
- [x] compliance-incidents directory deleted — Task 7
- [x] All 5 services cleaned of compliance injection — Tasks 2–6
- [x] Prisma Wave 2 tables removed — Task 8
- [x] SumsubWebhookDispatcher merged into SumsubIngestionService — Task 9
- [x] Legacy /onboarding/sumsub/webhook endpoint removed — Task 9
- [x] sumsub-integration module deleted — Task 9
- [x] AGENTS.md corrected — Task 10

**Intentional gaps (by user design):**
- Periodic review RESTRICT path: removed, not replaced (will reconnect via Sumsub)
- Transaction compliance alert creation: removed (will reconnect via Sumsub in Wave 5/7 sprint)

**No placeholders:** Every step contains exact commands, exact file paths, or exact code blocks.
