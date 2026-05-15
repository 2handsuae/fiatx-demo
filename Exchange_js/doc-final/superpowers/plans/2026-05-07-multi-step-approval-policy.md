# Multi-Step Approval Policy Configuration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure approval policies from flat `checkerRoles` to explicit step-based configuration where each step supports multiple roles (OR relationship).

**Architecture:** Add `stepsConfig` JSON column to `ApprovalActionPolicy` as single source of truth. Keep `checkerRoles` as a derived flat CSV. Fix 5 engine-level BLOCKERs in `approvals.service.ts` (step-skipping, hardcoded stepNo: 1, etc.). Update admin-web with step-based editor.

**Tech Stack:** NestJS, Prisma (SQLite), React, Tailwind CSS (`adm-*` tokens)

**Spec:** `docs/superpowers/specs/2026-05-07-multi-step-approval-policy-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify (lines 793-803, 815-837) | Add `stepsConfig`, `currentStepsConfig`, `proposedStepsConfig` columns |
| `src/modules/governance/approvals/constants/approval.constants.ts` | Modify | Add `PolicyStepConfig` type, utility functions, convert `DEFAULT_APPROVAL_POLICIES` |
| `src/modules/governance/approvals/approval-policy.service.ts` | Modify | `getPolicy()`, `listV1Policies()`, rename `upsertCheckerRoles` → `upsertStepsConfig` |
| `src/modules/governance/approvals/approvals.service.ts` | Modify (lines 621-667, 724-766, 887-978, 980-1063, 1065-1135, 1276-1325) | Step creation, BLOCKER fixes |
| `src/modules/governance/approvals/approval-policy-change-workflow.service.ts` | Modify | `requestChange()`, `executePolicyChange()` |
| `src/modules/governance/approvals/approval-policy.controller.ts` | Modify (line 58) | Change POST body type |
| `admin-web/src/pages/ApprovalPoliciesPage.tsx` | Modify | Step-based table + edit modal |
| `admin-web/src/pages/PolicyChangeRequestDetailPage.tsx` | Modify | Step comparison view |
| `admin-web/src/pages/PolicyChangeRequestsPage.tsx` | Modify | Step summary column |

---

### Task 1: Prisma Schema Migration

**Files:**
- Modify: `prisma/schema.prisma:793-803` (ApprovalActionPolicy)
- Modify: `prisma/schema.prisma:815-837` (ApprovalPolicyChangeRequest)

- [ ] **Step 1: Add `stepsConfig` column to `ApprovalActionPolicy`**

In `prisma/schema.prisma`, find the `ApprovalActionPolicy` model (line 793) and add `stepsConfig` after `checkerRoles`:

```prisma
model ApprovalActionPolicy {
  actionType   String   @id
  riskLevel    String   @default("HIGH")
  checkerRoles String
  stepsConfig  String?
  timeoutHours Int      @default(24)
  allowCancel  Boolean  @default(true)
  allowRetry   Boolean  @default(true)
  updatedAt    DateTime @updatedAt

  @@map("approval_action_policies")
}
```

- [ ] **Step 2: Add JSON columns to `ApprovalPolicyChangeRequest`**

Find `ApprovalPolicyChangeRequest` (line 815) and add `currentStepsConfig` and `proposedStepsConfig` after `proposedCheckerRoles`:

```prisma
model ApprovalPolicyChangeRequest {
  id                   String    @id @default(uuid())
  requestNo            String    @unique @default("TEMP")
  targetActionType     String
  currentCheckerRoles  String
  proposedCheckerRoles String
  currentStepsConfig   String?
  proposedStepsConfig  String?
  changeReason         String
  status               String    @default("PENDING_APPROVAL")
  approvalCaseId       String?
  approvalCaseNo       String?
  requestedByUserId    String
  executedAt           DateTime?
  failureReason        String?
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt
  deletedAt            DateTime?

  @@index([targetActionType, status])
  @@index([approvalCaseId])
  @@index([status])
  @@index([requestedByUserId])
  @@map("approval_policy_change_requests")
}
```

- [ ] **Step 3: Generate and apply migration**

```bash
cd Exchange_js
npx prisma migrate dev --name add_steps_config_columns
```

Expected: Migration creates 3 new nullable columns. No data loss.

- [ ] **Step 4: Verify migration applied**

```bash
npx prisma migrate status
```

Expected: All migrations applied, no pending.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add stepsConfig columns for multi-step approval policies"
```

---

### Task 2: Constants — Types, Utilities, and Default Policies

**Files:**
- Modify: `src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add `PolicyStepConfig` interface and utility functions**

After the existing `ApprovalDecisionEvent` interface (line 113), before `DEFAULT_APPROVAL_POLICIES` (line 115), add:

```typescript
// ─── Multi-Step Policy Configuration ───────────────

export interface PolicyStepConfig {
  stepNo: number;   // 1-based, sequential, no gaps
  roles: string[];  // OR: any of these roles can approve this step
}

/** Derive flat unique roles from steps array */
export function deriveCheckerRoles(steps: PolicyStepConfig[]): string[] {
  return [...new Set(steps.flatMap((s) => s.roles))];
}

/** Parse JSON string into PolicyStepConfig[], validate structure */
export function parseAndValidateStepsConfig(json: string): PolicyStepConfig[] {
  let arr: any[];
  try {
    arr = JSON.parse(json);
  } catch {
    throw new BadRequestException('Invalid stepsConfig JSON');
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new BadRequestException('stepsConfig must be a non-empty array');
  }
  for (let i = 0; i < arr.length; i++) {
    const step = arr[i];
    if (step.stepNo !== i + 1) {
      throw new BadRequestException(
        `stepsConfig[${i}].stepNo must be ${i + 1}, got ${step.stepNo}`,
      );
    }
    if (!Array.isArray(step.roles) || step.roles.length === 0) {
      throw new BadRequestException(
        `stepsConfig[${i}].roles must be a non-empty array`,
      );
    }
    for (const role of step.roles) {
      if (typeof role !== 'string' || !role.trim()) {
        throw new BadRequestException(
          `stepsConfig[${i}].roles contains invalid value: ${role}`,
        );
      }
    }
  }
  return arr as PolicyStepConfig[];
}

/** Convert flat role array to steps (each role = 1 step). Backward compat. */
export function checkerRolesToSteps(roles: string[]): PolicyStepConfig[] {
  return roles.map((role, idx) => ({ stepNo: idx + 1, roles: [role] }));
}
```

Note: `BadRequestException` is already available via NestJS. Add import at the top of the file if not present:

```typescript
import { BadRequestException } from '@nestjs/common';
```

- [ ] **Step 2: Convert `DEFAULT_APPROVAL_POLICIES` from `checkerRoles` to `steps`**

Replace the entire `DEFAULT_APPROVAL_POLICIES` block (lines 115-262) with:

```typescript
export const DEFAULT_APPROVAL_POLICIES: Record<
  string,
  {
    riskLevel: string;
    steps: PolicyStepConfig[];
    timeoutHours: number;
    allowCancel: boolean;
    allowRetry: boolean;
  }
> = {
  [ApprovalActionTypes.AUDIT_EVIDENCE_EXPORT_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.CASE_EVIDENCE_EXPORT_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['DPO'] }, { stepNo: 2, roles: ['MLRO'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.CHANGE_TICKET_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.DELETE_REQUEST_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.ONBOARDING_FINAL_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.POOL_SETTLEMENT_BATCH_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }, { stepNo: 2, roles: ['TECH_OFFICER'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.TREASURY_CROSS_POOL_TRANSFER_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }, { stepNo: 2, roles: ['TECH_OFFICER'] }],
    timeoutHours: 24,
    allowCancel: true,
    allowRetry: true,
  },
  // ─── Wave 3 (2026-04-09) ─────────────────────
  [ApprovalActionTypes.RISK_RATING_MEDIUM_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['COMPLIANCE_OFFICER'] }],
    timeoutHours: 168,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.RISK_RATING_UPGRADE_PHASE1]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 168,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.RISK_RATING_MAINTENANCE_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 168,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.PEP_RELATIONSHIP_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.RISK_RATING_MLRO_REVIEW]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }],
    timeoutHours: 168,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.RISK_RATING_TIER_UPGRADE_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['MLRO'] }, { stepNo: 2, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 240,
    allowCancel: true,
    allowRetry: true,
  },
  // ─── Wave 1 Governance Redesign (2026-04-30) ─
  [ApprovalActionTypes.ADMIN_INVITE_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
  [ApprovalActionTypes.ADMIN_ROLE_BINDING_CHANGE_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
  // ─── Wave 1 Governance Redesign — C4 (2026-05-05) ─
  [ApprovalActionTypes.ADMIN_SUSPENSION_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
  [ApprovalActionTypes.ADMIN_REACTIVATION_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['SENIOR_MANAGEMENT_OFFICER'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
  // ─── Approval Policy Governance (2026-05-06) ────
  [ApprovalActionTypes.APPROVAL_POLICY_CHANGE]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    steps: [{ stepNo: 1, roles: ['CISO'] }],
    timeoutHours: 48,
    allowCancel: true,
    allowRetry: false,
  },
};
```

- [ ] **Step 3: Build to verify TypeScript compilation**

```bash
cd Exchange_js && npx nest build
```

Expected: Compilation errors in files that reference `DEFAULT_APPROVAL_POLICIES[x].checkerRoles` — this is expected and will be fixed in Tasks 3-4. If errors are only in those expected files, proceed.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(approvals): add PolicyStepConfig type, utilities, convert DEFAULT_APPROVAL_POLICIES to steps"
```

---

### Task 3: Update `approval-policy.service.ts`

**Files:**
- Modify: `src/modules/governance/approvals/approval-policy.service.ts`

- [ ] **Step 1: Update imports**

At the top of the file, update the import from constants to include the new types:

```typescript
import {
  ApprovalActionTypes,
  DEFAULT_APPROVAL_POLICIES,
  ApprovalSoDRuleCodes,
  splitRoleCsv,
  PolicyStepConfig,
  deriveCheckerRoles,
  parseAndValidateStepsConfig,
  checkerRolesToSteps,
} from './constants/approval.constants';
```

- [ ] **Step 2: Update `ResolvedApprovalPolicy` interface**

Find the `ResolvedApprovalPolicy` interface (around line 11) and add `steps`:

```typescript
export interface ResolvedApprovalPolicy {
  actionType: string;
  riskLevel: string;
  steps: PolicyStepConfig[];
  checkerRoles: string[];
  timeoutHours: number;
  allowCancel: boolean;
  allowRetry: boolean;
}
```

- [ ] **Step 3: Rewrite `getPolicy()`**

Replace the `getPolicy` method (lines 24-58) with:

```typescript
  async getPolicy(actionType: string): Promise<ResolvedApprovalPolicy> {
    const normalizedActionType = String(actionType || '').trim().toUpperCase();
    const fallback = DEFAULT_APPROVAL_POLICIES[normalizedActionType];

    const policy = await this.prisma.approvalActionPolicy.findUnique({
      where: { actionType: normalizedActionType },
    });

    let steps: PolicyStepConfig[];

    if (policy?.stepsConfig) {
      steps = parseAndValidateStepsConfig(policy.stepsConfig);
    } else if (policy?.checkerRoles) {
      // Legacy: flat CSV → each role = 1 step
      steps = checkerRolesToSteps(splitRoleCsv(policy.checkerRoles));
    } else if (fallback) {
      steps = fallback.steps;
    } else {
      steps = [];
    }

    return {
      actionType: normalizedActionType,
      riskLevel: policy?.riskLevel ?? fallback?.riskLevel ?? 'HIGH',
      steps,
      checkerRoles: deriveCheckerRoles(steps),
      timeoutHours: policy?.timeoutHours ?? fallback?.timeoutHours ?? 24,
      allowCancel: policy?.allowCancel ?? fallback?.allowCancel ?? true,
      allowRetry: policy?.allowRetry ?? fallback?.allowRetry ?? true,
    };
  }
```

- [ ] **Step 4: Update `listV1Policies()` to include `steps`**

Replace the `listV1Policies` method (lines 60-86) with:

```typescript
  async listV1Policies(): Promise<
    (ResolvedApprovalPolicy & { source: 'DEFAULT' | 'CUSTOMIZED'; editable: boolean })[]
  > {
    const dbOverrides = await this.prisma.approvalActionPolicy.findMany({
      where: { actionType: { in: [...V1_APPROVAL_ACTION_TYPES] } },
    });
    const dbMap = new Map(dbOverrides.map((o) => [o.actionType, o]));

    return V1_APPROVAL_ACTION_TYPES.map((actionType) => {
      const dbRow = dbMap.get(actionType);
      const defaultPolicy = DEFAULT_APPROVAL_POLICIES[actionType];
      if (!defaultPolicy) {
        throw new Error(`V1 whitelist references unknown actionType: ${actionType}`);
      }
      const hasOverride = !!dbRow;

      let steps: PolicyStepConfig[];
      if (dbRow?.stepsConfig) {
        steps = parseAndValidateStepsConfig(dbRow.stepsConfig);
      } else if (dbRow?.checkerRoles) {
        steps = checkerRolesToSteps(splitRoleCsv(dbRow.checkerRoles));
      } else {
        steps = defaultPolicy.steps;
      }

      return {
        actionType,
        riskLevel: dbRow?.riskLevel ?? defaultPolicy.riskLevel,
        steps,
        checkerRoles: deriveCheckerRoles(steps),
        timeoutHours: dbRow?.timeoutHours ?? defaultPolicy.timeoutHours,
        allowCancel: dbRow?.allowCancel ?? defaultPolicy.allowCancel,
        allowRetry: dbRow?.allowRetry ?? defaultPolicy.allowRetry,
        source: hasOverride ? ('CUSTOMIZED' as const) : ('DEFAULT' as const),
        editable: actionType !== ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
      };
    });
  }
```

- [ ] **Step 5: Replace `upsertCheckerRoles()` with `upsertStepsConfig()`**

Replace the `upsertCheckerRoles` method (lines 88-116) with:

```typescript
  async upsertStepsConfig(
    actionType: string,
    steps: PolicyStepConfig[],
    tx?: any,
  ): Promise<void> {
    if (actionType === ApprovalActionTypes.APPROVAL_POLICY_CHANGE) {
      throw new BadRequestException({
        code: 'SELF_POLICY_IMMUTABLE',
        message: 'APPROVAL_POLICY_CHANGE policy cannot be modified through the platform',
      });
    }
    const defaultPolicy = DEFAULT_APPROVAL_POLICIES[actionType];
    if (!defaultPolicy) {
      throw new BadRequestException(`Unknown actionType: ${actionType}`);
    }
    // Validate step structure
    parseAndValidateStepsConfig(JSON.stringify(steps));

    const stepsConfig = JSON.stringify(steps);
    const checkerRoles = deriveCheckerRoles(steps).join(',');

    const db = tx || this.prisma;
    await db.approvalActionPolicy.upsert({
      where: { actionType },
      update: { stepsConfig, checkerRoles },
      create: {
        actionType,
        riskLevel: defaultPolicy.riskLevel,
        stepsConfig,
        checkerRoles,
        timeoutHours: defaultPolicy.timeoutHours,
        allowCancel: defaultPolicy.allowCancel,
        allowRetry: defaultPolicy.allowRetry,
      },
    });
  }
```

Also add `BadRequestException` import at the top if not already present:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
```

- [ ] **Step 6: Build to verify**

```bash
cd Exchange_js && npx nest build
```

Expected: May still have errors in `approvals.service.ts` and `approval-policy-change-workflow.service.ts` referencing old `upsertCheckerRoles` — fixed in next tasks.

- [ ] **Step 7: Commit**

```bash
git add src/modules/governance/approvals/approval-policy.service.ts
git commit -m "feat(approval-policy): rewrite getPolicy/listV1Policies/upsertStepsConfig for step-based config"
```

---

### Task 4: Update `approvals.service.ts` — Step Creation

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts` (lines 724-766)

- [ ] **Step 1: Update validation in `createDraftCase()` to use `steps`**

Find lines 724-735 in `createDraftCase()`:

```typescript
    const policy = await this.approvalPolicyService.getPolicy(actionType);
    if (!policy.checkerRoles.length) {
      throw new BadRequestException(`No checker roles configured for actionType ${actionType}`);
    }

    const selectedCheckerRole =
      this.normalizeOptionalString(dto.checkerRole) || policy.checkerRoles[0];
    if (!policy.checkerRoles.includes(selectedCheckerRole)) {
      throw new BadRequestException(
        `checkerRole ${selectedCheckerRole} is not allowed by policy ${actionType}`,
      );
    }
```

Replace with:

```typescript
    const policy = await this.approvalPolicyService.getPolicy(actionType);
    if (!policy.steps.length) {
      throw new BadRequestException(`No steps configured for actionType ${actionType}`);
    }

    const selectedCheckerRole =
      this.normalizeOptionalString(dto.checkerRole) || policy.steps[0]?.roles[0];
    if (!policy.steps[0]?.roles.includes(selectedCheckerRole)) {
      throw new BadRequestException(
        `checkerRole ${selectedCheckerRole} is not allowed by step 1 of policy ${actionType}`,
      );
    }
```

- [ ] **Step 2: Update step creation to use `policy.steps`**

Find lines 760-766:

```typescript
        steps: {
          create: policy.checkerRoles.map((role, idx) => ({
            stepNo: idx + 1,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: role,
          })),
        },
```

Replace with:

```typescript
        steps: {
          create: policy.steps.map((step) => ({
            stepNo: step.stepNo,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: step.roles.join(','),
          })),
        },
```

- [ ] **Step 3: Build to verify this change compiles**

```bash
cd Exchange_js && npx nest build
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "feat(approvals): update createDraftCase to use policy.steps for step creation"
```

---

### Task 5: BLOCKER Fixes in `approvals.service.ts`

**Files:**
- Modify: `src/modules/governance/approvals/approvals.service.ts` (lines 621-667, 887-1000, 1065-1135, 1276-1325)

- [ ] **Step 1: Update `resolveDecisionRole()` to accept step-level candidates**

Find lines 621-667. Change the method signature to accept an optional `stepCandidateRoles` parameter, and use it as `allowedRoles` when provided:

```typescript
  private async resolveDecisionRole(
    approval: ApprovalCaseRow,
    actor: ApprovalActorContext,
    requestedRole?: string,
    stepCandidateRoles?: string[],
  ): Promise<string> {
    const normalizedRequestedRole = this.normalizeOptionalString(requestedRole);
    const allowedRoles = stepCandidateRoles || splitRoleCsv(approval.checkerRoles);
    const actorRoles = Array.from(new Set(actor.roleCodes.map((item) => String(item).trim())));
    const superAdminBypass = this.isSuperAdmin(actor);
    const intersection = superAdminBypass
      ? allowedRoles
      : allowedRoles.filter((role) => actorRoles.includes(role));

    if (!intersection.length) {
      throw new ForbiddenException('Current admin roles are not allowed to decide this approval');
    }

    if (
      !superAdminBypass &&
      actor.userId === approval.createdByUserId &&
      (await this.approvalPolicyService.isSameUserMakerCheckerDenied())
    ) {
      throw new ForbiddenException('Maker and checker must be different users');
    }

    if (normalizedRequestedRole) {
      if (!intersection.includes(normalizedRequestedRole)) {
        throw new ForbiddenException(
          `checkerRole ${normalizedRequestedRole} is not available for the current admin`,
        );
      }
      return normalizedRequestedRole;
    }

    if (intersection.length === 1) {
      return intersection[0];
    }

    const currentPrimaryRole = this.normalizeOptionalString(actor.role);
    if (currentPrimaryRole && intersection.includes(currentPrimaryRole)) {
      return currentPrimaryRole;
    }

    throw new BadRequestException(
      `Multiple checker roles are available (${intersection.join(', ')}). Provide checkerRole explicitly.`,
    );
  }
```

- [ ] **Step 2: Fix `approve()` — enforce sequential step ordering**

Find lines 896-910 in `approve()`:

```typescript
      // Find the current pending step the actor is authorized for
      const currentStep = (approval.steps || []).find(
        (s: any) =>
          s.status === ApprovalStepStatuses.PENDING &&
          (splitRoleCsv(s.checkerRoleCandidates).some((candidate: string) =>
            (actor.roleCodes || []).includes(candidate),
          ) || this.isSuperAdmin(actor)),
      );
      if (!currentStep) {
        throw new ForbiddenException(
          `Actor role ${(actor.roleCodes || []).join(',')} cannot sign any pending step`,
        );
      }

      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole);
```

Replace with:

```typescript
      // Find the FIRST pending step (enforce sequential ordering — no step skipping)
      const firstPendingStep = (approval.steps || []).find(
        (s: any) => s.status === ApprovalStepStatuses.PENDING,
      );
      if (!firstPendingStep) {
        throw new ForbiddenException('No pending steps available');
      }
      const canAct =
        splitRoleCsv(firstPendingStep.checkerRoleCandidates).some((candidate: string) =>
          (actor.roleCodes || []).includes(candidate),
        ) || this.isSuperAdmin(actor);
      if (!canAct) {
        throw new ForbiddenException(
          `Actor role ${(actor.roleCodes || []).join(',')} cannot sign the current pending step (step ${firstPendingStep.stepNo})`,
        );
      }
      const currentStep = firstPendingStep;

      const stepCandidateRoles = splitRoleCsv(currentStep.checkerRoleCandidates);
      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole, stepCandidateRoles);
```

- [ ] **Step 3: Fix `reject()` — same sequential enforcement**

Find lines 989-1002 in `reject()`:

```typescript
      const currentStep = (approval.steps || []).find(
        (s: any) =>
          s.status === ApprovalStepStatuses.PENDING &&
          (splitRoleCsv(s.checkerRoleCandidates).some((candidate: string) =>
            (actor.roleCodes || []).includes(candidate),
          ) || this.isSuperAdmin(actor)),
      );
      if (!currentStep) {
        throw new ForbiddenException(
          `Actor role ${(actor.roleCodes || []).join(',')} cannot reject any pending step`,
        );
      }

      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole);
```

Replace with:

```typescript
      // Find the FIRST pending step (enforce sequential ordering)
      const firstPendingStep = (approval.steps || []).find(
        (s: any) => s.status === ApprovalStepStatuses.PENDING,
      );
      if (!firstPendingStep) {
        throw new ForbiddenException('No pending steps available');
      }
      const canAct =
        splitRoleCsv(firstPendingStep.checkerRoleCandidates).some((candidate: string) =>
          (actor.roleCodes || []).includes(candidate),
        ) || this.isSuperAdmin(actor);
      if (!canAct) {
        throw new ForbiddenException(
          `Actor role ${(actor.roleCodes || []).join(',')} cannot reject the current pending step (step ${firstPendingStep.stepNo})`,
        );
      }
      const currentStep = firstPendingStep;

      const stepCandidateRoles = splitRoleCsv(currentStep.checkerRoleCandidates);
      const decisionRole = await this.resolveDecisionRole(approval, actor, dto.checkerRole, stepCandidateRoles);
```

- [ ] **Step 4: Fix `cancel()` — replace hardcoded `stepNo: 1` with `updateMany`**

Find lines 1088-1102 in `cancel()`:

```typescript
      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: 1,
          },
        },
        data: {
          status: ApprovalStepStatuses.CANCELLED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });
```

Replace with:

```typescript
      // Cancel ALL remaining PENDING steps (preserves already-APPROVED steps)
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: {
          status: ApprovalStepStatuses.CANCELLED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });
```

- [ ] **Step 5: Fix `expirePendingApprovalCase()` — replace hardcoded `stepNo: 1` with `updateMany`**

Find lines 1284-1296 in `expirePendingApprovalCase()`:

```typescript
      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: 1,
          },
        },
        data: {
          status: ApprovalStepStatuses.EXPIRED,
          reason: 'Approval expired after timeout',
          decidedAt,
        },
      });
```

Replace with:

```typescript
      // Expire ALL remaining PENDING steps (preserves already-APPROVED steps)
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: {
          status: ApprovalStepStatuses.EXPIRED,
          reason: 'Approval expired after timeout',
          decidedAt,
        },
      });
```

- [ ] **Step 6: Add intentional comment to `submitCase()` `stepNo: 1`**

Find line 794-804 in `submitCase()` and add a comment above the `await tx.approvalStep.update`:

```typescript
    // NOTE: stepNo: 1 is intentional — submit always activates the first step.
    // Do not change to dynamic lookup.
    await db.approvalStep.update({
      where: {
        approvalCaseId_stepNo: {
          approvalCaseId: approval.id,
          stepNo: 1,
        },
      },
      data: {
        status: ApprovalStepStatuses.PENDING,
      },
    });
```

- [ ] **Step 7: Build to verify**

```bash
cd Exchange_js && npx nest build
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "fix(approvals): enforce sequential step ordering, fix hardcoded stepNo:1 in cancel/expire"
```

---

### Task 6: Update Change Workflow Service

**Files:**
- Modify: `src/modules/governance/approvals/approval-policy-change-workflow.service.ts`

- [ ] **Step 1: Update imports**

Add new imports at the top:

```typescript
import {
  ApprovalActionTypes,
  ApprovalActorContext,
  V1_APPROVAL_ACTION_TYPES,
  PolicyStepConfig,
  deriveCheckerRoles,
  parseAndValidateStepsConfig,
  checkerRolesToSteps,
} from './constants/approval.constants';
```

- [ ] **Step 2: Rewrite `requestChange()` method signature and body**

Replace the `requestChange` method (lines 51-168). The new method accepts `proposedSteps: PolicyStepConfig[]` instead of `proposedCheckerRoles: string[]`:

```typescript
  async requestChange(
    targetActionType: string,
    proposedSteps: PolicyStepConfig[],
    changeReason: string,
    actor: ApprovalActorContext,
  ): Promise<{ id: string; requestNo: string; approvalNo: string; approvalCaseId: string; status: string }> {
    // 1. Validate targetActionType in V1 whitelist
    if (!V1_APPROVAL_ACTION_TYPES.includes(targetActionType)) {
      throw new BadRequestException({
        code: 'INVALID_ACTION_TYPE',
        message: `Action type '${targetActionType}' is not a valid V1 approval type`,
      });
    }

    // 2. Self-protection
    if (targetActionType === ApprovalActionTypes.APPROVAL_POLICY_CHANGE) {
      throw new BadRequestException({
        code: 'SELF_POLICY_IMMUTABLE',
        message: 'APPROVAL_POLICY_CHANGE policy cannot be modified through the platform',
      });
    }

    // 3. Validate proposedSteps structure
    if (!proposedSteps || proposedSteps.length === 0) {
      throw new BadRequestException('proposedSteps must not be empty');
    }
    parseAndValidateStepsConfig(JSON.stringify(proposedSteps));

    // 4. Snapshot current policy
    const currentPolicy = await this.policyService.getPolicy(targetActionType);

    // 5. No-change guard (structural comparison with role normalization)
    const normalize = (steps: PolicyStepConfig[]) =>
      JSON.stringify(steps.map((s) => ({ ...s, roles: [...s.roles].sort() })));
    if (normalize(currentPolicy.steps) === normalize(proposedSteps)) {
      throw new ConflictException({
        code: 'NO_CHANGE',
        message: 'Proposed step configuration is identical to current configuration',
      });
    }

    // 6. Concurrent request guard
    const pendingExists = await this.prisma.approvalPolicyChangeRequest.findFirst({
      where: { targetActionType, status: 'PENDING_APPROVAL', deletedAt: null },
    });
    if (pendingExists) {
      throw new ConflictException({
        code: 'PENDING_REQUEST_EXISTS',
        message: `A pending change request already exists for ${targetActionType} (${pendingExists.requestNo})`,
      });
    }

    const traceId = randomUUID();
    const requestNo = generateReferenceNo('APC');

    // 7. Create request (both JSON and CSV fields)
    const proposedCheckerRoles = deriveCheckerRoles(proposedSteps);
    const request = await this.prisma.approvalPolicyChangeRequest.create({
      data: {
        requestNo,
        targetActionType,
        currentCheckerRoles: currentPolicy.checkerRoles.join(','),
        proposedCheckerRoles: proposedCheckerRoles.join(','),
        currentStepsConfig: JSON.stringify(currentPolicy.steps),
        proposedStepsConfig: JSON.stringify(proposedSteps),
        changeReason,
        status: 'PENDING_APPROVAL',
        requestedByUserId: actor.userId,
      },
    });

    // 8. Create and submit approval case
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: ApprovalActionTypes.APPROVAL_POLICY_CHANGE,
        entityRef: request.id,
        workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
        workflowId: request.id,
        workflowNo: requestNo,
        traceId,
        metadata: {
          requestNo,
          targetActionType,
          currentStepsConfig: currentPolicy.steps,
          proposedStepsConfig: proposedSteps,
          currentCheckerRoles: currentPolicy.checkerRoles,
          proposedCheckerRoles,
          changeReason,
        },
      },
      { reason: changeReason, traceId },
      actor,
    );

    // 9. Link approval case to request
    await this.prisma.approvalPolicyChangeRequest.update({
      where: { id: request.id },
      data: {
        approvalCaseId: approvalCase.id,
        approvalCaseNo: approvalCase.approvalNo,
      },
    });

    // 10. Audit: MODIFICATION_REQUESTED
    await this.auditLogsService.recordByActor(
      {
        action: AuditGovernanceActions.APPROVAL_POLICY.MODIFICATION_REQUESTED,
        entityType: AuditEntityTypes.APPROVAL_POLICY,
        entityId: request.id,
        entityNo: requestNo,
        workflowType: AuditBusinessWorkflowTypes.APPROVAL_POLICY,
        traceId,
        result: AuditResult.SUCCESS,
        metadata: {
          targetActionType,
          currentStepsConfig: currentPolicy.steps,
          proposedStepsConfig: proposedSteps,
          currentCheckerRoles: currentPolicy.checkerRoles,
          proposedCheckerRoles,
          changeReason,
          approvalNo: approvalCase.approvalNo,
        },
        requestId: `APPROVAL_POLICY_CHANGE_REQUESTED_${requestNo}`,
        sourcePlatform: 'ADMIN_API',
      },
      this.toAuditActor(actor),
    );

    return {
      id: request.id,
      requestNo,
      approvalNo: approvalCase.approvalNo,
      approvalCaseId: approvalCase.id,
      status: 'PENDING_APPROVAL',
    };
  }
```

- [ ] **Step 3: Update `executePolicyChange()` to use steps**

Find the `executePolicyChange` method (line 188). Replace the part that reads proposed roles and calls upsertCheckerRoles.

Find these lines (around 195-202):

```typescript
    const proposedRoles = request.proposedCheckerRoles.split(',').filter(Boolean);

    try {
      await this.prisma.$transaction(async (tx: any) => {
        await this.policyService.upsertCheckerRoles(
          request.targetActionType,
          proposedRoles,
          tx,
        );
```

Replace with:

```typescript
    // Parse proposed steps — fallback to flat CSV for old records
    let proposedSteps: PolicyStepConfig[];
    if (request.proposedStepsConfig) {
      proposedSteps = parseAndValidateStepsConfig(request.proposedStepsConfig);
    } else {
      proposedSteps = checkerRolesToSteps(
        request.proposedCheckerRoles.split(',').filter(Boolean),
      );
    }

    try {
      await this.prisma.$transaction(async (tx: any) => {
        await this.policyService.upsertStepsConfig(
          request.targetActionType,
          proposedSteps,
          tx,
        );
```

Also update the audit metadata in the success case (around line 220) — change `appliedCheckerRoles: proposedRoles` to:

```typescript
            appliedStepsConfig: proposedSteps,
            appliedCheckerRoles: deriveCheckerRoles(proposedSteps),
```

- [ ] **Step 4: Build to verify**

```bash
cd Exchange_js && npx nest build
```

Expected: Should compile without errors now.

- [ ] **Step 5: Commit**

```bash
git add src/modules/governance/approvals/approval-policy-change-workflow.service.ts
git commit -m "feat(approval-policy-change): update workflow to use step-based config"
```

---

### Task 7: Update Controller

**Files:**
- Modify: `src/modules/governance/approvals/approval-policy.controller.ts`

- [ ] **Step 1: Update import for `PolicyStepConfig`**

Add to imports:

```typescript
import { PolicyStepConfig } from './constants/approval.constants';
```

- [ ] **Step 2: Update `createChangeRequest()` method body**

Find lines 55-72. Change the `@Body()` type and the method call:

```typescript
  @Post(':actionType/change-requests')
  @RequirePermissions(buildPermissionCode('POST', '/admin/governance/approval-policies/:actionType/change-requests'))
  @ApiOperation({ summary: 'Create approval policy change request' })
  createChangeRequest(
    @Param('actionType') actionType: string,
    @Body() body: { proposedSteps: PolicyStepConfig[]; changeReason: string },
    @Req() req: any,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.workflowService.requestChange(
      actionType,
      body.proposedSteps,
      body.changeReason,
      this.buildAdminActor(req),
    );
  }
```

- [ ] **Step 3: Build and run full stack test**

```bash
cd Exchange_js && npx nest build
```

Expected: Clean compilation. Full backend is now multi-step-aware.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approval-policy.controller.ts
git commit -m "feat(approval-policy-controller): change POST body to accept proposedSteps"
```

---

### Task 8: Data Migration Script

**Files:**
- Create: `src/modules/governance/approvals/scripts/migrate-policy-steps-config.ts`

- [ ] **Step 1: Create migration script**

```typescript
/**
 * Data migration: Backfill stepsConfig JSON for existing ApprovalActionPolicy rows.
 * Each existing checkerRoles CSV entry becomes a single-role step.
 *
 * Run: npx ts-node -r tsconfig-paths/register src/modules/governance/approvals/scripts/migrate-policy-steps-config.ts
 *
 * Safe to run multiple times (skips rows that already have stepsConfig).
 */
import { PrismaClient } from '@prisma/client';

async function main() {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.approvalActionPolicy.findMany();
    let migrated = 0;
    let skipped = 0;

    for (const row of rows) {
      if (row.stepsConfig) {
        skipped++;
        continue;
      }
      const roles = row.checkerRoles
        .split(',')
        .map((r: string) => r.trim())
        .filter(Boolean);
      const steps = roles.map((role: string, idx: number) => ({
        stepNo: idx + 1,
        roles: [role],
      }));
      await prisma.approvalActionPolicy.update({
        where: { actionType: row.actionType },
        data: { stepsConfig: JSON.stringify(steps) },
      });
      migrated++;
      console.log(`  Migrated: ${row.actionType} → ${JSON.stringify(steps)}`);
    }

    console.log(`\nDone. Migrated: ${migrated}, Skipped (already has stepsConfig): ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the migration**

```bash
cd Exchange_js && npx ts-node -r tsconfig-paths/register src/modules/governance/approvals/scripts/migrate-policy-steps-config.ts
```

Expected: Migrates any existing rows. Outputs count. If no custom policies in DB, outputs "Migrated: 0, Skipped: 0".

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/scripts/migrate-policy-steps-config.ts
git commit -m "feat(migration): add stepsConfig backfill script for existing policy rows"
```

---

### Task 9: Frontend — ApprovalPoliciesPage Rewrite

**Files:**
- Modify: `admin-web/src/pages/ApprovalPoliciesPage.tsx`

- [ ] **Step 1: Add `PolicyStepConfig` type and update `PolicyView` interface**

At the top of the file, after the imports, replace the `PolicyView` interface:

```typescript
interface PolicyStepConfig {
  stepNo: number;
  roles: string[];
}

interface PolicyView {
  actionType: string;
  steps: PolicyStepConfig[];
  checkerRoles: string[];
  timeoutHours: number;
  source: 'DEFAULT' | 'CUSTOMIZED';
  editable: boolean;
}
```

- [ ] **Step 2: Update modal state from flat roles to steps**

Replace the modal state declarations (around lines 50-54):

```typescript
  // Modal state
  const [editTarget, setEditTarget] = useState<PolicyView | null>(null);
  const [proposedSteps, setProposedSteps] = useState<PolicyStepConfig[]>([]);
  const [changeReason, setChangeReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
```

- [ ] **Step 3: Rewrite `openEdit` and `closeEdit`**

```typescript
  const openEdit = (policy: PolicyView) => {
    setEditTarget(policy);
    setProposedSteps(policy.steps.map((s) => ({ stepNo: s.stepNo, roles: [...s.roles] })));
    setChangeReason('');
    setSubmitError('');
  };

  const closeEdit = () => {
    setEditTarget(null);
    setProposedSteps([]);
    setChangeReason('');
    setSubmitError('');
  };
```

- [ ] **Step 4: Add step manipulation helpers**

Replace the `toggleRole` function with step-based helpers:

```typescript
  const toggleStepRole = (stepIdx: number, role: string) => {
    setProposedSteps((prev) =>
      prev.map((step, idx) => {
        if (idx !== stepIdx) return step;
        const roles = step.roles.includes(role)
          ? step.roles.filter((r) => r !== role)
          : [...step.roles, role];
        return { ...step, roles };
      }),
    );
  };

  const addStep = () => {
    setProposedSteps((prev) => [...prev, { stepNo: prev.length + 1, roles: [] }]);
  };

  const removeStep = (stepIdx: number) => {
    setProposedSteps((prev) =>
      prev
        .filter((_, idx) => idx !== stepIdx)
        .map((step, idx) => ({ ...step, stepNo: idx + 1 })),
    );
  };

  const isStepsValid = proposedSteps.length > 0 && proposedSteps.every((s) => s.roles.length > 0);
```

- [ ] **Step 5: Update `handleSubmit` to send `proposedSteps`**

Replace the `handleSubmit` function:

```typescript
  const handleSubmit = async () => {
    if (!editTarget || !isStepsValid || !changeReason.trim()) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await adminFetch(
        `${import.meta.env.VITE_API_URL}/admin/governance/approval-policies/${editTarget.actionType}/change-requests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            proposedSteps,
            changeReason: changeReason.trim(),
          }),
        },
      );
      if (!res.ok) throw new Error(await getApiErrorMessage(res, 'Submit failed.'));
      const data = await res.json();
      closeEdit();
      navigate(`/dashboard/governance/policy-change-requests/${data.id}`);
    } catch (err) {
      if (err instanceof AdminSessionError) return;
      setSubmitError(err instanceof Error ? err.message : 'Submit failed.');
    } finally {
      setSubmitting(false);
    }
  };
```

- [ ] **Step 6: Update table body — replace "Checker Roles" column with "Steps" column**

In the table header, change `'Checker Roles'` to `'Steps'`.

Replace the Checker Roles `<td>` cell (the one with `p.checkerRoles.map`) with:

```tsx
                <td className="px-4 py-2.5">
                  <div className="space-y-1">
                    {p.steps.map((step) => (
                      <div key={step.stepNo} className="flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-adm-t3 shrink-0">
                          S{step.stepNo}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {step.roles.map((r) => (
                            <span
                              key={r}
                              className="inline-flex rounded border border-adm-amber/25 bg-adm-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-adm-amber"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </td>
```

- [ ] **Step 7: Rewrite the edit modal content**

Replace everything inside `{editTarget && ( ... )}` with the step-based editor. The full modal:

```tsx
      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 rounded-lg border border-adm-border bg-adm-bg shadow-2xl max-h-[85vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-adm-border px-5 py-4 shrink-0">
              <h3 className="font-mono text-sm font-semibold text-adm-t1">
                Modify: {label(editTarget.actionType)}
              </h3>
              <button onClick={closeEdit} className="text-adm-t3 hover:text-adm-t1 transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-5 px-5 py-5">
              {/* Current Configuration */}
              <div>
                <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                  Current Configuration
                </p>
                <div className="space-y-1">
                  {editTarget.steps.map((step) => (
                    <div key={step.stepNo} className="flex items-center gap-1.5">
                      <span className="font-mono text-[9px] text-adm-t3 shrink-0">
                        Step {step.stepNo}:
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {step.roles.map((r) => (
                          <span
                            key={r}
                            className="inline-flex rounded border border-adm-amber/25 bg-adm-amber/10 px-2 py-1 font-mono text-[10px] text-adm-amber"
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Proposed Configuration */}
              <div>
                <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                  Proposed Configuration
                </p>
                <div className="space-y-4">
                  {proposedSteps.map((step, stepIdx) => (
                    <div key={stepIdx} className="rounded border border-adm-border bg-adm-panel p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-[10px] font-semibold text-adm-t2">
                          Step {step.stepNo}
                        </span>
                        {proposedSteps.length > 1 && (
                          <button
                            onClick={() => removeStep(stepIdx)}
                            className="text-adm-t3 hover:text-adm-red transition-colors"
                            title="Remove step"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {AVAILABLE_ROLES.map((role) => (
                          <button
                            key={role}
                            onClick={() => toggleStepRole(stepIdx, role)}
                            className={`rounded border px-3 py-1.5 font-mono text-[10px] transition-colors ${
                              step.roles.includes(role)
                                ? 'border-adm-amber/50 bg-adm-amber/20 text-adm-amber'
                                : 'border-adm-border bg-adm-bg text-adm-t3 hover:border-adm-t3'
                            }`}
                          >
                            {role}
                          </button>
                        ))}
                      </div>
                      {step.roles.length === 0 && (
                        <p className="mt-2 font-mono text-[10px] text-adm-red">Select at least one role</p>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={addStep}
                    className="w-full rounded border border-dashed border-adm-border px-3 py-2 font-mono text-[10px] text-adm-t3 transition-colors hover:border-adm-amber hover:text-adm-amber"
                  >
                    + Add Step
                  </button>
                </div>
              </div>

              {/* Change reason */}
              <div>
                <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                  Change Reason
                </p>
                <textarea
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Explain why this change is needed…"
                  rows={3}
                  className="w-full resize-none rounded border border-adm-border bg-adm-panel px-3 py-2 font-mono text-xs text-adm-t1 placeholder:text-adm-t3 outline-none focus:border-adm-amber"
                />
              </div>

              {submitError && (
                <div className="rounded border border-adm-red/30 bg-adm-red/10 px-3 py-2 font-mono text-[10px] text-adm-red">
                  {submitError}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 border-t border-adm-border px-5 py-4 shrink-0">
              <button
                onClick={closeEdit}
                className="rounded px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-adm-t3 transition-colors hover:text-adm-t1"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting || !isStepsValid || !changeReason.trim()}
                className="rounded bg-adm-amber px-4 py-2 font-mono text-[10px] font-bold uppercase tracking-wider text-adm-bg transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {submitting ? 'Submitting…' : 'Submit for Approval'}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 8: Verify frontend compiles**

```bash
cd Exchange_js/admin-web && npx tsc --noEmit
```

- [ ] **Step 9: Commit**

```bash
git add admin-web/src/pages/ApprovalPoliciesPage.tsx
git commit -m "feat(admin-web): rewrite ApprovalPoliciesPage with step-based editor"
```

---

### Task 10: Frontend — Policy Change Request Pages

**Files:**
- Modify: `admin-web/src/pages/PolicyChangeRequestDetailPage.tsx`
- Modify: `admin-web/src/pages/PolicyChangeRequestsPage.tsx`

- [ ] **Step 1: Add helper to parse steps from API response in both files**

Add this shared helper at the top of each file (after imports):

```typescript
interface PolicyStepConfig {
  stepNo: number;
  roles: string[];
}

function parseSteps(stepsJson?: string | null, rolesCsv?: string | null): PolicyStepConfig[] {
  if (stepsJson) {
    try {
      return JSON.parse(stepsJson);
    } catch {
      /* fallback */
    }
  }
  if (rolesCsv) {
    return rolesCsv
      .split(',')
      .filter(Boolean)
      .map((r, i) => ({ stepNo: i + 1, roles: [r.trim()] }));
  }
  return [];
}
```

- [ ] **Step 2: Update `PolicyChangeRequestDetailPage.tsx` — replace role comparison with step comparison**

Find the section that shows "Current Roles" and "Proposed Roles" (around lines 195-233). Replace with step-based comparison.

In the detail data section, replace the role badge display for current and proposed with:

```tsx
              {/* Step Configuration Comparison */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                    Current Configuration
                  </p>
                  <div className="space-y-1">
                    {parseSteps(detail.currentStepsConfig, detail.currentCheckerRoles).map((step) => (
                      <div key={step.stepNo} className="flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-adm-t3 shrink-0">S{step.stepNo}</span>
                        <div className="flex flex-wrap gap-1">
                          {step.roles.map((r) => (
                            <span key={r} className="inline-flex rounded border border-adm-border bg-adm-panel px-1.5 py-0.5 font-mono text-[9px] text-adm-t2">
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 font-mono text-[8.5px] font-semibold uppercase tracking-[0.14em] text-adm-t3">
                    Proposed Configuration
                  </p>
                  <div className="space-y-1">
                    {parseSteps(detail.proposedStepsConfig, detail.proposedCheckerRoles).map((step) => (
                      <div key={step.stepNo} className="flex items-center gap-1.5">
                        <span className="font-mono text-[9px] text-adm-amber shrink-0">S{step.stepNo}</span>
                        <div className="flex flex-wrap gap-1">
                          {step.roles.map((r) => (
                            <span key={r} className="inline-flex rounded border border-adm-amber/25 bg-adm-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-adm-amber">
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
```

- [ ] **Step 3: Update `PolicyChangeRequestsPage.tsx` — add step summary column**

In the table, replace the "Current Roles" and "Change To" columns with a summary. Replace the two `<td>` cells that display role badges with a single column:

```tsx
                <td className="px-4 py-2.5 font-mono text-[10px] text-adm-t2">
                  {(() => {
                    const current = parseSteps(item.currentStepsConfig, item.currentCheckerRoles);
                    const proposed = parseSteps(item.proposedStepsConfig, item.proposedCheckerRoles);
                    const cRoles = new Set(current.flatMap((s) => s.roles)).size;
                    const pRoles = new Set(proposed.flatMap((s) => s.roles)).size;
                    return `${current.length}s·${cRoles}r → ${proposed.length}s·${pRoles}r`;
                  })()}
                </td>
```

Update the table header column accordingly: change "Current Roles" + "Change To" to a single "Change" column.

- [ ] **Step 4: Verify frontend compiles**

```bash
cd Exchange_js/admin-web && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add admin-web/src/pages/PolicyChangeRequestDetailPage.tsx admin-web/src/pages/PolicyChangeRequestsPage.tsx
git commit -m "feat(admin-web): update PolicyChangeRequest pages with step comparison view"
```

---

### Task 11: End-to-End Verification

- [ ] **Step 1: Rebuild and restart the full stack**

```bash
cd Exchange_js && npx nest build && bash scripts/stack.sh down branch; bash scripts/stack.sh up branch
```

- [ ] **Step 2: Verify backend compiles and starts**

Check that port 3500 responds:

```bash
curl -s http://localhost:3500/health | head -1
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Verify GET approval policies returns `steps` field**

```bash
curl -s http://localhost:3500/admin/governance/approval-policies -H "Authorization: Bearer <token>" | python3 -m json.tool | head -20
```

Expected: Each policy has `steps: [{ stepNo: 1, roles: [...] }]` in the response.

- [ ] **Step 4: Verify admin-web shows step-based table**

Open `http://localhost:3501` in browser, navigate to Control Gates > Approval Policies. Verify:
- Table shows "Steps" column with S1, S2 labels and amber role badges
- Edit button opens modal with step-based editor
- Add Step / Remove Step buttons work
- Submit sends correct payload

- [ ] **Step 5: Run data migration script if needed**

```bash
cd Exchange_js && npx ts-node -r tsconfig-paths/register src/modules/governance/approvals/scripts/migrate-policy-steps-config.ts
```

- [ ] **Step 6: Final commit (if any cleanup needed)**

```bash
git add -A && git commit -m "chore: multi-step approval policy — final cleanup"
```
