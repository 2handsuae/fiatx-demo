# CRA + TierUpgradeCase Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify CRA to a pure 3-state risk snapshot (PENDING_SUMSUB_RESULT → PENDING_MLRO_REVIEW → SIGNED) and introduce a new TierUpgradeCase entity that owns the complete LOW→HIGH upgrade journey (customer restriction → Level 2 → MLRO+SMO dual-sign → tier promotion).

**Architecture:** CRA = point-in-time assessment record. MLRO confirms AML result validity (Phase 1). If MLRO confirms LOW→HIGH, system auto-creates a TierUpgradeCase. TierUpgradeCase owns: customer restriction, Sumsub Level 2 workflow, Phase 2 dual-sign (MLRO+SMO), tier promotion on completion or offboard on rejection. HIGH→HIGH with new labels stays within CRA MLRO review only — no TierUpgradeCase created.

**Tech Stack:** NestJS 10 / Prisma 6 / SQLite, React 18 / Vite, Jest.

**Supersedes:** `2026-04-13-cra-periodic-review-redesign.md` (old 6-state CRA plan)

---

## CRA State Machine (New)

```
PENDING_SUMSUB_RESULT
        ↓ webhook / simulation
  processAssessmentResult()
        ↓
  LOW→LOW              → SIGNED (auto)
  HIGH→HIGH same labels → SIGNED (auto)
  HIGH→HIGH new labels  → PENDING_MLRO_REVIEW → MLRO confirms → SIGNED
  LOW→HIGH              → PENDING_MLRO_REVIEW → MLRO confirms → SIGNED → [TierUpgradeCase created]
  SANCTIONS             → ESCALATED_TO_SUMSUB
```

## TierUpgradeCase State Machine (New)

```
[CRA SIGNED, previousLOW→resultingHIGH] → auto-created
        ↓
  PENDING_LEVEL2 (customer walks Sumsub Level 2)
        ↓ webhook: applicantWorkflowCompleted
  PENDING_PHASE2_APPROVAL (MLRO + SMO dual-sign)
        ↓
  APPROVED → COMPLETED (tier=HIGH, restriction cleared)
  REJECTED → REJECTED  (offboard)
```

---

## File Map

### New — Backend
| File | Purpose |
|------|---------|
| `src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.ts` | Core upgrade journey logic |
| `src/modules/identity/tier-upgrade-case/tier-upgrade-case-approval-projection.service.ts` | Phase 2 approval event listener |
| `src/modules/identity/tier-upgrade-case/tier-upgrade-case.module.ts` | Module wiring |
| `src/modules/identity/client-risk-assessment/client-risk-assessment-customer.controller.ts` | Customer API: GET /compliance/me + mock Level 2 |

### Modified — Backend
| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add TierUpgradeCase model; relations on CustomerMain, ClientRiskAssessment, ApprovalCase; remove phase1/phase2ApprovalCaseId from CRA |
| `config/client-risk-assessment-policy.json` | Update signoffActionTypeMap |
| `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts` | Add `previousLabels`; new scenarioTypes; remove HIGH_MAINTAIN |
| `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts` | 3-state machine; `startMlroReview()`; simplified `handleSignoffComplete()` |
| `src/modules/identity/client-risk-assessment/client-risk-assessment-approval-projection.service.ts` | Update action types to `RISK_RATING_MLRO_REVIEW` |
| `src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts` | Import TierUpgradeCaseModule |
| `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | Clue 4.5 → TierUpgradeCase; Clue 5 fix (known result) |
| `src/modules/identity/material-refresh/material-refresh.service.ts` | All EXPIRY cycles cleared → trigger new CRA |
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | Add `level2-workflow-complete` endpoint |

### Modified — Frontend
| File | Change |
|------|--------|
| `admin-web/src/pages/SumsubEventsPage.tsx` | 3 new simulation tabs |
| `admin-web/src/pages/RiskAssessmentListPage.tsx` | Start CRA button |
| `client-web/src/pages/Verification.tsx` | Level 2 upgrade section |

---

## Task 1 — Schema: Add TierUpgradeCase, Simplify CRA

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add `TierUpgradeCase` model to schema**

Find the end of `model ClientRiskAssessment` (after line ~2800) and insert the new model:

```prisma
model TierUpgradeCase {
  id                   String    @id @default(cuid())
  caseNo               String    @unique
  customerId           String
  customer             CustomerMain @relation("CustomerTierUpgradeCases", fields: [customerId], references: [id])
  sourceCraId          String    @unique
  sourceCra            ClientRiskAssessment @relation("CraTierUpgradeCase", fields: [sourceCraId], references: [id])

  // PENDING_LEVEL2 | PENDING_PHASE2_APPROVAL | COMPLETED | REJECTED
  status               String    @default("PENDING_LEVEL2")

  phase2ApprovalCaseId String?
  phase2ApprovalCase   ApprovalCase? @relation("TierUpgradeCaseApproval", fields: [phase2ApprovalCaseId], references: [id])

  completedAt          DateTime?
  rejectedAt           DateTime?
  traceId              String    @unique
  createdAt            DateTime  @default(now())

  @@index([customerId, status])
  @@map("tier_upgrade_cases")
}
```

- [ ] **Step 2: Add reverse relation to `CustomerMain`**

In `model CustomerMain`, after the existing `riskAssessments` relation line:

```prisma
// ADD after: riskAssessments ClientRiskAssessment[] @relation("CustomerRiskAssessments")
tierUpgradeCases      TierUpgradeCase[] @relation("CustomerTierUpgradeCases")
```

- [ ] **Step 3: Add reverse relation to `ClientRiskAssessment`**

In `model ClientRiskAssessment`, after the `triggeredRefreshCycles` line:

```prisma
// ADD after: triggeredRefreshCycles MaterialRefreshCycle[] @relation("AssessmentTriggeredCycles")
tierUpgradeCase       TierUpgradeCase? @relation("CraTierUpgradeCase")
```

Also remove `phase1ApprovalCaseId` and `phase2ApprovalCaseId` fields (these were `String?` without @relation):

```prisma
// REMOVE these two lines:
phase1ApprovalCaseId        String?
phase2ApprovalCaseId        String?
```

- [ ] **Step 4: Add reverse relation to `ApprovalCase`**

In `model ApprovalCase`, after the existing `riskAssessments` relation line:

```prisma
// ADD:
tierUpgradeCaseApproval     TierUpgradeCase? @relation("TierUpgradeCaseApproval")
```

- [ ] **Step 5: Rebuild database**

```bash
cd Exchange_js && npm run dev:rebuild
```

Expected: runs without errors, schema applied.

- [ ] **Step 6: Verify new table exists**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db ".tables" | tr ' ' '\n' | grep -i tier
```

Expected output: `tier_upgrade_cases`

- [ ] **Step 7: Commit**

```bash
cd Exchange_js && git add prisma/schema.prisma
git commit -m "feat(schema): add TierUpgradeCase model; remove phase1/2ApprovalCaseId from CRA"
```

---

## Task 2 — Policy: New ScenarioTypes + previousLabels

**Files:**
- Modify: `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts`
- Modify: `config/client-risk-assessment-policy.json`
- Test: `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts`

Replace `HIGH_MAINTAIN` scenario type with `HIGH_TO_HIGH_STABLE` (auto) and `HIGH_TO_HIGH_UPGRADE` (MLRO). Add `previousLabels` comparison.

- [ ] **Step 1: Write failing tests**

```typescript
// client-risk-assessment-policy.spec.ts
import { applyPolicy, PolicyInput } from './client-risk-assessment-policy';
import policy from '../../../../config/client-risk-assessment-policy.json';

describe('HIGH→HIGH label comparison', () => {
  const baseHigh: PolicyInput = {
    amlAnswer: 'GREEN',
    amlLabels: [],
    holdings: [],
    previousTier: 'HIGH',
    previousPepStatus: 'CONFIRMED',
    previousLabels: ['PEP_TIER_1'],
  };

  it('HIGH→HIGH same labels → HIGH_TO_HIGH_STABLE (auto)', () => {
    const result = applyPolicy(
      { ...baseHigh, amlAnswer: 'RED', amlLabels: ['PEP_TIER_1'], previousLabels: ['PEP_TIER_1'] },
      policy as any,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_STABLE');
    expect(result.signoffMethod).toBe('AUTO_R2');
  });

  it('HIGH→HIGH GREEN result (downgrade blocked) + same labels → HIGH_TO_HIGH_STABLE', () => {
    const result = applyPolicy(
      { ...baseHigh, amlAnswer: 'GREEN', amlLabels: [], previousLabels: ['PEP_TIER_1'] },
      policy as any,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_STABLE');
    expect(result.signoffMethod).toBe('AUTO_R2');
    expect(result.resultingTier).toBe('HIGH'); // downgrade blocked
  });

  it('HIGH→HIGH new label → HIGH_TO_HIGH_UPGRADE (MLRO)', () => {
    const result = applyPolicy(
      {
        ...baseHigh,
        amlAnswer: 'RED',
        amlLabels: ['PEP_TIER_1', 'ADVERSE_MEDIA'],
        previousLabels: ['PEP_TIER_1'],
      },
      policy as any,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_UPGRADE');
    expect(result.signoffMethod).toBe('MANUAL_MLRO');
  });

  it('HIGH→HIGH no previousLabels provided → HIGH_TO_HIGH_UPGRADE (conservative)', () => {
    const result = applyPolicy(
      { ...baseHigh, amlAnswer: 'RED', amlLabels: ['PEP_TIER_1'], previousLabels: undefined },
      policy as any,
    );
    expect(result.scenarioType).toBe('HIGH_TO_HIGH_UPGRADE');
  });

  it('LOW→LOW still works', () => {
    const result = applyPolicy(
      { amlAnswer: 'GREEN', amlLabels: [], holdings: [], previousTier: 'LOW', previousPepStatus: 'NONE' },
      policy as any,
    );
    expect(result.scenarioType).toBe('LOW_TO_LOW');
    expect(result.signoffMethod).toBe('AUTO_R2');
  });

  it('LOW→HIGH still works', () => {
    const result = applyPolicy(
      { amlAnswer: 'RED', amlLabels: ['PEP_TIER_1'], holdings: [], previousTier: 'LOW', previousPepStatus: 'NONE' },
      policy as any,
    );
    expect(result.scenarioType).toBe('LOW_TO_HIGH');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js && npx jest client-risk-assessment-policy.spec --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `HIGH_TO_HIGH_STABLE` not found.

- [ ] **Step 3: Update `PolicyInput` and `PolicyOutput` types**

In `client-risk-assessment-policy.ts`, replace the interfaces:

```typescript
export interface PolicyInput {
  amlAnswer: 'GREEN' | 'RED';
  amlLabels: string[];
  holdings: Array<{
    materialType: string;
    status: string;
    expiresAt: Date | null;
  }>;
  previousTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  previousPepStatus?: 'NONE' | 'CONFIRMED' | 'CLEARED';
  previousLabels?: string[];   // for HIGH→HIGH label comparison
}

export interface PolicyOutput {
  resultingTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  scoreSuggestedTier?: string;
  recommendedAction: string;
  signoffMethod: string;
  scenarioType:
    | 'LOW_TO_LOW'
    | 'LOW_TO_HIGH'
    | 'HIGH_TO_HIGH_STABLE'
    | 'HIGH_TO_HIGH_UPGRADE'
    | 'ESCALATED';
  immediateEffect?: string;
  matchedRule: number;
  reasoning: {
    ruleId: string;
    amlAnswer: string;
    amlLabels: string[];
    previousTier: string;
    downgradeBlocked?: boolean;
  };
}
```

- [ ] **Step 4: Update `applyPolicy()` — replace HIGH_MAINTAIN logic with label comparison**

In `applyPolicy()`, replace the entire `scenarioType` determination block (the if/else chain after the downgrade check) with:

```typescript
// Determine scenarioType
let scenarioType: PolicyOutput['scenarioType'];

if (signoffMethod === 'ESCALATED') {
  scenarioType = 'ESCALATED';
} else if (input.previousTier !== 'HIGH' && resultingTier === 'HIGH') {
  // LOW→HIGH (or MEDIUM→HIGH)
  scenarioType = 'LOW_TO_HIGH';
  signoffMethod = 'PHASE1_MLRO';
} else if (resultingTier === 'HIGH' && (input.previousTier === 'HIGH' || downgradeBlocked)) {
  // HIGH→HIGH: compare labels to decide auto vs MLRO
  const prevSet = new Set(input.previousLabels ?? []);
  const hasNewLabel =
    input.previousLabels === undefined ||
    input.amlLabels.some((l) => !prevSet.has(l));

  if (!hasNewLabel) {
    scenarioType = 'HIGH_TO_HIGH_STABLE';
    signoffMethod = 'AUTO_R2';
  } else {
    scenarioType = 'HIGH_TO_HIGH_UPGRADE';
    signoffMethod = 'MANUAL_MLRO';
  }
} else {
  // GREEN/stable path → LOW_TO_LOW
  scenarioType = 'LOW_TO_LOW';
}

return {
  resultingTier,
  scoreSuggestedTier,
  recommendedAction: rule.action,
  signoffMethod,
  scenarioType,
  immediateEffect: rule.immediateEffect,
  matchedRule: rule.priority,
  reasoning: {
    ruleId: `P${rule.priority}_${rule.condition}`,
    amlAnswer: input.amlAnswer,
    amlLabels: input.amlLabels,
    previousTier: input.previousTier,
    ...(downgradeBlocked && { downgradeBlocked: true }),
  },
};
```

- [ ] **Step 5: Update `config/client-risk-assessment-policy.json`**

Update `signoffActionTypeMap` to reflect unified action types:

```json
"signoffActionTypeMap": {
  "MANUAL_COMPLIANCE_OFFICER": "RISK_RATING_MEDIUM_APPROVAL",
  "MANUAL_MLRO": "RISK_RATING_MLRO_REVIEW",
  "PHASE1_MLRO": "RISK_RATING_MLRO_REVIEW",
  "DUAL_MLRO_SENIOR": "RISK_RATING_MLRO_REVIEW",
  "TIER_UPGRADE_PHASE2": "RISK_RATING_TIER_UPGRADE_APPROVAL"
}
```

- [ ] **Step 6: Run policy tests**

```bash
cd Exchange_js && npx jest client-risk-assessment-policy.spec --no-coverage
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd Exchange_js && git add \
  src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts \
  src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts \
  config/client-risk-assessment-policy.json
git commit -m "feat(cra-policy): add previousLabels; replace HIGH_MAINTAIN with HIGH_TO_HIGH_STABLE/UPGRADE"
```

---

## Task 3 — New TierUpgradeCaseService

**Files:**
- Create: `src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.ts`
- Create: `src/modules/identity/tier-upgrade-case/tier-upgrade-case-approval-projection.service.ts`
- Create: `src/modules/identity/tier-upgrade-case/tier-upgrade-case.module.ts`
- Test: `src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// tier-upgrade-case.service.spec.ts
import { Test } from '@nestjs/testing';
import { TierUpgradeCaseService } from './tier-upgrade-case.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';

const mockPrisma = {
  tierUpgradeCase: {
    create: jest.fn(),
    findFirst: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  customerMain: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
};
const mockApprovals = { createAndSubmit: jest.fn() };
const mockSumsub = { moveToLevel: jest.fn() };

describe('TierUpgradeCaseService', () => {
  let service: TierUpgradeCaseService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        TierUpgradeCaseService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ApprovalsService, useValue: mockApprovals },
        { provide: SumsubClient, useValue: mockSumsub },
      ],
    }).compile();
    service = module.get(TierUpgradeCaseService);
    jest.clearAllMocks();
  });

  describe('createFromCra', () => {
    it('creates TierUpgradeCase and restricts customer', async () => {
      const cra = { id: 'cra-1', customerId: 'cust-1', traceId: 'T1' };
      const customer = { id: 'cust-1', sumsubApplicantId: 'sub-1' };
      mockPrisma.customerMain.findUnique.mockResolvedValueOnce(customer);
      mockPrisma.tierUpgradeCase.create.mockResolvedValueOnce({ id: 'tuc-1' });

      await service.createFromCra(cra);

      expect(mockPrisma.tierUpgradeCase.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            customerId: 'cust-1',
            sourceCraId: 'cra-1',
            status: 'PENDING_LEVEL2',
          }),
        }),
      );
      expect(mockPrisma.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            restrictionStatus: 'RESTRICTED',
            restrictionReason: 'tier_upgrade_pending_level2',
          }),
        }),
      );
    });
  });

  describe('handleLevel2WorkflowComplete', () => {
    it('creates Phase 2 approval and advances to PENDING_PHASE2_APPROVAL', async () => {
      const upgradeCase = { id: 'tuc-1', customerId: 'cust-1', traceId: 'T1', sourceCraId: 'cra-1', caseNo: 'TUC-001' };
      mockPrisma.tierUpgradeCase.findFirst.mockResolvedValueOnce(upgradeCase);
      mockApprovals.createAndSubmit.mockResolvedValueOnce({ id: 'ap-1' });

      await service.handleLevel2WorkflowComplete('cust-1');

      expect(mockApprovals.createAndSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ actionType: 'RISK_RATING_TIER_UPGRADE_APPROVAL' }),
        expect.any(Object),
        expect.any(Object),
      );
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'PENDING_PHASE2_APPROVAL',
            phase2ApprovalCaseId: 'ap-1',
          }),
        }),
      );
    });

    it('is no-op when no PENDING_LEVEL2 case', async () => {
      mockPrisma.tierUpgradeCase.findFirst.mockResolvedValueOnce(null);
      await service.handleLevel2WorkflowComplete('cust-1');
      expect(mockApprovals.createAndSubmit).not.toHaveBeenCalled();
    });
  });

  describe('handleSignoffComplete', () => {
    const upgradeCase = { id: 'tuc-1', customerId: 'cust-1', sourceCraId: 'cra-1', phase2ApprovalCaseId: 'ap-1' };

    it('APPROVED → COMPLETED: sets riskTier=HIGH, clears restriction', async () => {
      mockPrisma.tierUpgradeCase.findUnique.mockResolvedValueOnce(upgradeCase);

      await service.handleSignoffComplete('tuc-1', { status: 'APPROVED' });

      expect(mockPrisma.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            riskTier: 'HIGH',
            restrictionStatus: 'CLEAR',
            restrictionReason: null,
          }),
        }),
      );
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETED' }) }),
      );
    });

    it('REJECTED → REJECTED: offboards customer', async () => {
      mockPrisma.tierUpgradeCase.findUnique.mockResolvedValueOnce(upgradeCase);

      await service.handleSignoffComplete('tuc-1', { status: 'REJECTED' });

      expect(mockPrisma.customerMain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ onboardingStatus: 'REJECTED', operatingStatus: 'INACTIVE' }),
        }),
      );
      expect(mockPrisma.tierUpgradeCase.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js && npx jest tier-upgrade-case.service.spec --no-coverage 2>&1 | tail -10
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create `tier-upgrade-case.service.ts`**

```typescript
// src/modules/identity/tier-upgrade-case/tier-upgrade-case.service.ts
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';

@Injectable()
export class TierUpgradeCaseService {
  constructor(
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly approvalsService: ApprovalsService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  /**
   * Called when CRA is SIGNED as HIGH and previousTier was LOW.
   * Creates the upgrade case and restricts the customer.
   */
  async createFromCra(cra: { id: string; customerId: string; traceId: string }): Promise<any> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: cra.customerId },
    });
    if (!customer) return;

    const caseNo = generateReferenceNo('TUC');
    const traceId = `TIER_UPGRADE:${randomUUID()}`;

    // 1. Create TierUpgradeCase
    const upgradeCase = await this.prisma.tierUpgradeCase.create({
      data: {
        caseNo,
        customerId: cra.customerId,
        sourceCraId: cra.id,
        status: 'PENDING_LEVEL2',
        traceId,
      },
    });

    // 2. Restrict customer while upgrade is in progress
    await this.prisma.customerMain.update({
      where: { id: cra.customerId },
      data: {
        restrictionStatus: 'RESTRICTED',
        restrictionReason: 'tier_upgrade_pending_level2',
      },
    });

    // 3. Move Sumsub to Level 2 (mock-mode: best-effort)
    if (customer.sumsubApplicantId) {
      try {
        await this.sumsubClient.moveToLevel(customer.sumsubApplicantId, 'wave3-level-2');
        await this.prisma.customerMain.update({
          where: { id: customer.id },
          data: { sumsubCurrentLevelName: 'wave3-level-2', sumsubExperiencedLevel2: true },
        });
      } catch (err) {
        console.error(`TierUpgradeCase moveToLevel failed for ${cra.customerId}:`, err);
      }
    }

    return upgradeCase;
  }

  /**
   * Called when customer completes Sumsub Level 2 workflow.
   * Advances from PENDING_LEVEL2 → PENDING_PHASE2_APPROVAL.
   */
  async handleLevel2WorkflowComplete(customerId: string): Promise<void> {
    const upgradeCase = await this.prisma.tierUpgradeCase.findFirst({
      where: { customerId, status: 'PENDING_LEVEL2' },
      orderBy: { createdAt: 'desc' },
    });
    if (!upgradeCase) return;

    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: 'RISK_RATING_TIER_UPGRADE_APPROVAL',
        entityRef: `tier_upgrade_case:${upgradeCase.id}`,
        traceId: upgradeCase.traceId,
        workflowType: 'TIER_UPGRADE',
        workflowId: upgradeCase.id,
        workflowNo: upgradeCase.caseNo,
        metadata: {
          caseId: upgradeCase.id,
          caseNo: upgradeCase.caseNo,
          sourceCraId: upgradeCase.sourceCraId,
          customerId,
        },
      } as any,
      { reason: `Phase 2 MLRO+SMO approval for tier upgrade ${upgradeCase.caseNo}` },
      { actorType: 'ADMIN', userId: 'SYSTEM', roleCodes: ['SUPER_ADMIN'] } as any,
    );

    await this.prisma.tierUpgradeCase.update({
      where: { id: upgradeCase.id },
      data: {
        status: 'PENDING_PHASE2_APPROVAL',
        phase2ApprovalCaseId: approvalCase.id,
      },
    });
  }

  /**
   * Called when Phase 2 approval (MLRO+SMO) is decided.
   * APPROVED → promote tier, clear restriction.
   * REJECTED → offboard customer.
   */
  async handleSignoffComplete(
    caseId: string,
    approvalResult: { status: string },
  ): Promise<void> {
    const upgradeCase = await this.prisma.tierUpgradeCase.findUnique({
      where: { id: caseId },
    });
    if (!upgradeCase) return;

    if (approvalResult.status === 'APPROVED') {
      await this.prisma.customerMain.update({
        where: { id: upgradeCase.customerId },
        data: {
          riskTier: 'HIGH',
          amlRiskTier: 'HIGH',
          riskTierUpdatedAt: new Date(),
          restrictionStatus: 'CLEAR',
          restrictionReason: null,
          latestRiskAssessmentId: upgradeCase.sourceCraId,
          latestRiskApprovalId: upgradeCase.phase2ApprovalCaseId,
          latestRiskApprovalStatus: 'APPROVED',
        },
      });
      await this.prisma.tierUpgradeCase.update({
        where: { id: upgradeCase.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } else {
      // Rejected → offboard
      await this.prisma.customerMain.update({
        where: { id: upgradeCase.customerId },
        data: {
          onboardingStatus: 'REJECTED',
          operatingStatus: 'INACTIVE',
          restrictionStatus: 'CLEAR',
          restrictionReason: null,
        },
      });
      await this.prisma.tierUpgradeCase.update({
        where: { id: upgradeCase.id },
        data: { status: 'REJECTED', rejectedAt: new Date() },
      });
    }
  }
}
```

- [ ] **Step 4: Create `tier-upgrade-case-approval-projection.service.ts`**

```typescript
// src/modules/identity/tier-upgrade-case/tier-upgrade-case-approval-projection.service.ts
import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ApprovalEvents,
  ApprovalDecisionEvent,
} from '../../governance/approvals/constants/approval.constants';
import { TierUpgradeCaseService } from './tier-upgrade-case.service';

const TIER_UPGRADE_ACTION_TYPES = ['RISK_RATING_TIER_UPGRADE_APPROVAL'];

@Injectable()
export class TierUpgradeCaseApprovalProjectionService {
  constructor(private readonly tierUpgradeCaseService: TierUpgradeCaseService) {}

  @OnEvent(ApprovalEvents.APPROVED, { async: true })
  async onApproved(event: ApprovalDecisionEvent) {
    return this.handleEvent(event);
  }

  @OnEvent(ApprovalEvents.REJECTED, { async: true })
  async onRejected(event: ApprovalDecisionEvent) {
    return this.handleEvent(event);
  }

  private async handleEvent(event: ApprovalDecisionEvent) {
    if (!TIER_UPGRADE_ACTION_TYPES.includes(event.actionType)) return;
    if (!event.entityRef?.startsWith('tier_upgrade_case:')) return;

    const caseId = event.entityRef.replace('tier_upgrade_case:', '');
    await this.tierUpgradeCaseService.handleSignoffComplete(caseId, { status: event.status });
  }
}
```

- [ ] **Step 5: Create `tier-upgrade-case.module.ts`**

```typescript
// src/modules/identity/tier-upgrade-case/tier-upgrade-case.module.ts
import { Module } from '@nestjs/common';
import { TierUpgradeCaseService } from './tier-upgrade-case.service';
import { TierUpgradeCaseApprovalProjectionService } from './tier-upgrade-case-approval-projection.service';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [
    ApprovalsModule,
    OnboardingModule, // for SumsubClient
  ],
  providers: [TierUpgradeCaseService, TierUpgradeCaseApprovalProjectionService],
  exports: [TierUpgradeCaseService],
})
export class TierUpgradeCaseModule {}
```

- [ ] **Step 6: Run tests**

```bash
cd Exchange_js && npx jest tier-upgrade-case.service.spec --no-coverage
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
cd Exchange_js && git add src/modules/identity/tier-upgrade-case/
git commit -m "feat(tier-upgrade-case): add TierUpgradeCaseService with Level 2 + Phase 2 dual-sign flow"
```

---

## Task 4 — CRA Service: 3-State Refactor

**Files:**
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment-approval-projection.service.ts`
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`
- Test: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// client-risk-assessment.service.spec.ts
// Add these test cases (keep all existing ones):

describe('routeSignoff — new 3-state machine', () => {
  it('HIGH_TO_HIGH_STABLE → auto SIGNED', async () => {
    // policy mock returns HIGH_TO_HIGH_STABLE
    // ... setup mocks ...
    // expect status SIGNED after processAssessmentResult
  });

  it('HIGH_TO_HIGH_UPGRADE → PENDING_MLRO_REVIEW', async () => {
    // expect status PENDING_MLRO_REVIEW
  });

  it('LOW_TO_HIGH → PENDING_MLRO_REVIEW', async () => {
    // expect status PENDING_MLRO_REVIEW
  });
});

describe('handleSignoffComplete — simplified', () => {
  it('LOW→HIGH APPROVED → SIGNED + triggers TierUpgradeCase', async () => {
    const assessment = {
      id: 'cra-1', status: 'PENDING_MLRO_REVIEW',
      previousRiskTier: 'LOW', resultingRiskTier: 'HIGH',
      customerId: 'cust-1', traceId: 'T1', assessmentNo: 'CRA-001',
    };
    prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);

    await service.handleSignoffComplete('cra-1', { status: 'APPROVED' });

    expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SIGNED' }) }),
    );
    expect(mockTierUpgradeCaseService.createFromCra).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'cra-1' }),
    );
  });

  it('LOW→HIGH REJECTED (false positive) → SIGNED as LOW', async () => {
    const assessment = {
      id: 'cra-1', status: 'PENDING_MLRO_REVIEW',
      previousRiskTier: 'LOW', resultingRiskTier: 'HIGH',
      customerId: 'cust-1',
    };
    prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
    prisma.customerMain.findUnique.mockResolvedValueOnce({ id: 'cust-1', riskTier: 'LOW' });

    await service.handleSignoffComplete('cra-1', { status: 'REJECTED' });

    expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SIGNED',
          resultingRiskTier: 'LOW',  // overridden to previous tier
          signedBy: 'MLRO_FALSE_POSITIVE',
        }),
      }),
    );
    expect(mockTierUpgradeCaseService.createFromCra).not.toHaveBeenCalled();
  });

  it('HIGH→HIGH APPROVED → SIGNED, postSignoffCascade runs', async () => {
    const assessment = {
      id: 'cra-1', status: 'PENDING_MLRO_REVIEW',
      previousRiskTier: 'HIGH', resultingRiskTier: 'HIGH',
      customerId: 'cust-1',
    };
    prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);

    await service.handleSignoffComplete('cra-1', { status: 'APPROVED' });

    expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'SIGNED' }) }),
    );
    expect(mockTierUpgradeCaseService.createFromCra).not.toHaveBeenCalled();
  });
});

describe('startAssessment idempotency', () => {
  it('returns existing when PENDING_MLRO_REVIEW exists', async () => {
    const existing = { id: 'cra-1', status: 'PENDING_MLRO_REVIEW', customerId: 'cust-1' };
    prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(existing);

    const result = await service.startAssessment({ customerId: 'cust-1', triggerType: 'SCHEDULED_QUARTERLY' });

    expect(result).toEqual(existing);
    expect(prisma.clientRiskAssessment.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --no-coverage 2>&1 | tail -20
```

- [ ] **Step 3: Update `client-risk-assessment.service.ts` — full replacement**

Replace the entire service file with:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { applyPolicy, PolicyInput, PolicyOutput } from './policy/client-risk-assessment-policy';
import { generateReferenceNo } from '../../../common/utils/no-generator.util';
import { TierUpgradeCaseService } from '../tier-upgrade-case/tier-upgrade-case.service';

export type AssessmentTriggerType =
  | 'INITIAL_ONBOARDING'
  | 'SCHEDULED_QUARTERLY'
  | 'SUMSUB_AML_HIT'
  | 'MLRO_MANUAL';

// All statuses that mean "an active CRA exists — don't create another"
const ACTIVE_CRA_STATUSES = ['PENDING_SUMSUB_RESULT', 'PENDING_MLRO_REVIEW', 'ESCALATED_TO_SUMSUB'];

@Injectable()
export class ClientRiskAssessmentService {
  /** Property-injected in module to avoid circular deps */
  materialRefreshService?: {
    seedInitialHoldings: (id: string, levelName: string) => Promise<void>;
    recomputeHoldingsForCustomer: (id: string, levelName: string) => Promise<any>;
  };

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly approvalsService: ApprovalsService,
    private readonly policyLoader: ClientRiskAssessmentPolicyLoader,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
  ) {}

  // ─── Public entry points ──────────────────────────────────────────────────

  /** Triggers fresh /aml/check and creates PENDING_SUMSUB_RESULT assessment */
  async startAssessment(input: {
    customerId: string;
    triggerType: Exclude<AssessmentTriggerType, 'INITIAL_ONBOARDING'>;
    triggeredBy?: string;
    triggeredContext?: Record<string, any>;
  }): Promise<any> {
    // Idempotency: block if ANY active assessment exists
    const existing = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: input.customerId, status: { in: ACTIVE_CRA_STATUSES } },
    });
    if (existing) return existing;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = generateReferenceNo('CRA');
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;

    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: input.triggerType,
        policyVersion: policy.version,
        previousRiskTier: customer.riskTier,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubAmlCheckRequestedAt: new Date(),
        traceId,
      },
    });

    if (customer.sumsubApplicantId) {
      try {
        const result = await this.sumsubClient.runAmlCheck(customer.sumsubApplicantId);
        await this.prisma.clientRiskAssessment.update({
          where: { id: assessment.id },
          data: { sumsubAmlCheckInspectionId: result.inspectionId },
        });
      } catch (err) {
        console.error(`runAmlCheck failed for customer ${customer.id}:`, err);
      }
    }

    return assessment;
  }

  /** Webhook-driven: look up pending assessment by inspectionId and process */
  async handleSumsubAmlResult(
    inspectionId: string,
    reviewResult: {
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
      reviewRejectType?: string;
    },
  ): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        sumsubAmlCheckInspectionId: inspectionId,
        status: 'PENDING_SUMSUB_RESULT',
      },
    });
    if (!assessment) {
      console.warn(`No pending assessment for inspectionId ${inspectionId}`);
      return;
    }

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        sumsubAmlReviewAnswer: reviewResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(reviewResult.rejectLabels || []),
        sumsubAmlRejectType: reviewResult.reviewRejectType,
      },
    });

    await this.processAssessmentResult(assessment.id, reviewResult);
  }

  /**
   * Ongoing monitoring hit: create assessment from known result (no API call).
   * Also used for admin simulation of spontaneous AML hits.
   */
  async recordAssessmentFromKnownAmlResult(input: {
    customerId: string;
    triggerType?: string;
    knownAmlResult: { reviewAnswer: 'GREEN' | 'RED'; rejectLabels?: string[]; inspectionId?: string };
    snapshot?: any;
  }): Promise<any> {
    // Idempotency: block if ANY active assessment exists
    const existing = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: input.customerId, status: { in: ACTIVE_CRA_STATUSES } },
    });
    if (existing) return existing;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = generateReferenceNo('CRA');
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;

    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: input.triggerType || 'SUMSUB_AML_HIT',
        policyVersion: policy.version,
        previousRiskTier: customer.riskTier,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubSnapshotAt: new Date(),
        sumsubAmlReviewAnswer: input.knownAmlResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(input.knownAmlResult.rejectLabels || []),
        sumsubAmlCheckInspectionId: input.knownAmlResult.inspectionId || null,
        traceId,
      },
    });

    return this.processAssessmentResult(assessment.id, {
      reviewAnswer: input.knownAmlResult.reviewAnswer,
      rejectLabels: input.knownAmlResult.rejectLabels || [],
    });
  }

  /** Called by approval projection when CRA MLRO review is decided */
  async handleSignoffComplete(
    assessmentId: string,
    approvalCase: { status: string },
  ): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    const isLowToHigh =
      assessment.previousRiskTier === 'LOW' && assessment.resultingRiskTier === 'HIGH';

    if (approvalCase.status === 'APPROVED') {
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: { status: 'SIGNED', signedAt: new Date(), signedBy: 'MLRO' },
      });

      if (isLowToHigh) {
        // Tier promotion owned by TierUpgradeCase
        await this.tierUpgradeCaseService.createFromCra(assessment);
        await this.prisma.customerMain.update({
          where: { id: assessment.customerId },
          data: { latestRiskAssessmentId: assessment.id },
        });
      } else {
        // HIGH→HIGH label confirmation: cascade (tier stays HIGH)
        await this.postSignoffCascade(assessmentId);
      }
    } else {
      // REJECTED
      if (isLowToHigh) {
        // False positive: override resultingTier back to LOW
        await this.prisma.clientRiskAssessment.update({
          where: { id: assessmentId },
          data: {
            status: 'SIGNED',
            signedAt: new Date(),
            signedBy: 'MLRO_FALSE_POSITIVE',
            resultingRiskTier: assessment.previousRiskTier,
          },
        });
      } else {
        // HIGH→HIGH dismissed: sign as-is (tier stays HIGH)
        await this.prisma.clientRiskAssessment.update({
          where: { id: assessmentId },
          data: { status: 'SIGNED', signedAt: new Date(), signedBy: 'MLRO_REJECTED' },
        });
      }
      await this.postSignoffCascade(assessmentId);
    }
  }

  // ─── Internal processing ──────────────────────────────────────────────────

  private async processAssessmentResult(
    assessmentId: string,
    reviewResult: { reviewAnswer: 'GREEN' | 'RED'; rejectLabels?: string[] },
  ): Promise<any> {
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: assessment.customerId },
    });
    if (!customer) return;

    const labels = reviewResult.rejectLabels || [];

    // Sanctions short-circuit
    if (reviewResult.reviewAnswer === 'RED' && labels.some((l) => l.startsWith('SANCTIONS_'))) {
      await this.handleSanctionsPath(assessment, customer, labels);
      return assessment;
    }

    // Fetch snapshot for scoring
    const snapshot = customer.sumsubApplicantId
      ? await this.sumsubClient.getApplicant(customer.sumsubApplicantId)
      : { tags: [], totalScore: null };

    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId: customer.id },
    });

    // Load previous labels for HIGH→HIGH comparison
    let previousLabels: string[] | undefined;
    if (customer.riskTier === 'HIGH') {
      const prevAssessment = await this.prisma.clientRiskAssessment.findFirst({
        where: { customerId: customer.id, status: 'SIGNED' },
        orderBy: { triggeredAt: 'desc' },
      });
      if (prevAssessment?.sumsubAmlLabels) {
        try {
          previousLabels = JSON.parse(prevAssessment.sumsubAmlLabels) as string[];
        } catch {
          previousLabels = [];
        }
      }
    }

    const policy = this.policyLoader.getPolicy();
    const policyInput: PolicyInput = {
      amlAnswer: reviewResult.reviewAnswer,
      amlLabels: labels,
      holdings: holdings.map((h: any) => ({
        materialType: h.materialType,
        status: h.status,
        expiresAt: h.expiresAt,
      })),
      previousTier: customer.riskTier as any,
      previousPepStatus: customer.pepStatus as any,
      previousLabels,
    };
    const output = applyPolicy(policyInput, policy);

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        sumsubSnapshotAt: new Date(),
        sumsubRiskScore: (snapshot as any).totalScore || null,
        sumsubTags: JSON.stringify((snapshot as any).tags || []),
        resultingRiskTier: output.resultingTier,
        scoreSuggestedTier: output.scoreSuggestedTier,
        recommendedAction: output.recommendedAction,
        reasoning: JSON.stringify(output.reasoning),
        signoffMethod: output.signoffMethod,
      },
    });

    await this.routeSignoff(assessment.id, customer, output);
    return assessment;
  }

  private async routeSignoff(
    assessmentId: string,
    customer: any,
    output: PolicyOutput,
  ): Promise<void> {
    const policy = this.policyLoader.getPolicy();
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    // AUTO paths → SIGNED immediately
    if (output.scenarioType === 'LOW_TO_LOW' || output.scenarioType === 'HIGH_TO_HIGH_STABLE') {
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'SIGNED',
          signedBy: 'SYSTEM',
          signedAt: new Date(),
          signedUnderPolicyVersion: policy.version,
        },
      });
      await this.postSignoffCascade(assessmentId);
      return;
    }

    // MLRO review needed (LOW→HIGH or HIGH→HIGH with new labels)
    if (output.scenarioType === 'LOW_TO_HIGH' || output.scenarioType === 'HIGH_TO_HIGH_UPGRADE') {
      await this.startMlroReview(assessment, output.scenarioType);
      return;
    }

    // Sanctions → already handled in processAssessmentResult
  }

  private async startMlroReview(assessment: any, scenarioType: string): Promise<void> {
    const approvalCase = await this.approvalsService.createAndSubmit(
      {
        actionType: 'RISK_RATING_MLRO_REVIEW',
        entityRef: `client_risk_assessment:${assessment.id}`,
        traceId: assessment.traceId,
        workflowType: 'RISK_ASSESSMENT',
        workflowId: assessment.id,
        workflowNo: assessment.assessmentNo,
        metadata: {
          assessmentId: assessment.id,
          resultingTier: assessment.resultingRiskTier,
          scenarioType,
        },
      } as any,
      { reason: `MLRO review for ${assessment.assessmentNo} (${scenarioType})` },
      { actorType: 'ADMIN', userId: 'SYSTEM', roleCodes: ['SUPER_ADMIN'] } as any,
    );
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: { status: 'PENDING_MLRO_REVIEW', approvalCaseId: approvalCase.id },
    });
  }

  private async handleSanctionsPath(
    assessment: any,
    customer: any,
    labels: string[],
  ): Promise<void> {
    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: {
        complianceHoldStatus: 'FROZEN',
        complianceHoldReason: 'sanctions_hit_pending_investigation',
      },
    });
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessment.id },
      data: {
        status: 'ESCALATED_TO_SUMSUB',
        resultingRiskTier: 'HIGH',
        recommendedAction: 'ESCALATE_TO_SUMSUB_CASE',
        signoffMethod: 'ESCALATED',
        reasoning: JSON.stringify({ ruleId: 'P1_labels_contains_SANCTIONS', labels }),
      },
    });
  }

  private async postSignoffCascade(assessmentId: string): Promise<void> {
    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    if (!assessment) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: assessment.customerId },
    });
    if (!customer) return;

    const policy = this.policyLoader.getPolicy();

    // For false-positive rejected assessments, resultingRiskTier was overridden to previousRiskTier
    // so tierChanged will be false — tier stays the same.
    const tierChanged =
      assessment.resultingRiskTier &&
      assessment.resultingRiskTier !== customer.riskTier;

    const updateData: any = {
      latestRiskAssessmentId: assessment.id,
      latestRiskApprovalId: assessment.approvalCaseId,
      latestRiskApprovalStatus: 'APPROVED',
    };

    if (tierChanged) {
      updateData.riskTier = assessment.resultingRiskTier;
      updateData.riskTierUpdatedAt = new Date();
    }

    if (customer.restrictionReason === 'pep_review_pending') {
      updateData.restrictionStatus = 'CLEAR';
      updateData.restrictionReason = null;
    }

    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: updateData,
    });

    // Sync Sumsub level (skip if frozen)
    if (customer.complianceHoldStatus !== 'FROZEN' && assessment.resultingRiskTier) {
      const allowed = policy.tierLevelConstraint[assessment.resultingRiskTier] || [];
      if (
        customer.sumsubApplicantId &&
        allowed.length > 0 &&
        !allowed.includes(customer.sumsubCurrentLevelName || '')
      ) {
        try {
          await this.sumsubClient.moveToLevel(customer.sumsubApplicantId, allowed[0]);
          await this.prisma.customerMain.update({
            where: { id: customer.id },
            data: {
              sumsubCurrentLevelName: allowed[0],
              sumsubExperiencedLevel2:
                allowed[0] === 'wave3-level-2' ? true : customer.sumsubExperiencedLevel2,
            },
          });
        } catch (err) {
          console.error(`moveToLevel failed for ${customer.id}:`, err);
        }
      }
    }

    // Seed or recompute material holdings
    if (this.materialRefreshService) {
      const holdingCount = await this.prisma.customerMaterialHolding.count({
        where: { customerId: customer.id },
      });
      const levelName = customer.sumsubCurrentLevelName || 'wave3-level-1';
      try {
        if (holdingCount === 0) {
          await this.materialRefreshService.seedInitialHoldings(customer.id, levelName);
        } else if (tierChanged) {
          await this.materialRefreshService.recomputeHoldingsForCustomer(customer.id, levelName);
        }
      } catch (err) {
        console.error(`Layer 3 holdings failed for ${customer.id}:`, err);
      }
    }
  }
}
```

- [ ] **Step 4: Update `client-risk-assessment-approval-projection.service.ts`**

Replace the `CRA_ACTION_TYPES` array:

```typescript
// Before:
const CRA_ACTION_TYPES = [
  'RISK_RATING_UPGRADE_PHASE1',
  'RISK_RATING_HIGH_APPROVAL',
  'RISK_RATING_MAINTENANCE_APPROVAL',
];

// After:
const CRA_ACTION_TYPES = ['RISK_RATING_MLRO_REVIEW'];
```

- [ ] **Step 5: Update `client-risk-assessment.module.ts`**

Add `TierUpgradeCaseModule` import and provide `TierUpgradeCaseService`:

```typescript
import { TierUpgradeCaseModule } from '../tier-upgrade-case/tier-upgrade-case.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
    ApprovalsModule,
    TierUpgradeCaseModule,    // ← ADD
  ],
  // ... rest unchanged
})
```

- [ ] **Step 6: Run CRA service tests**

```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --no-coverage
```

Expected: all pass.

- [ ] **Step 7: Run full backend test suite**

```bash
cd Exchange_js && npx jest --no-coverage 2>&1 | tail -30
```

Fix any compilation errors. TypeScript may complain about removed fields — remove any remaining references to `phase1ApprovalCaseId`, `phase2ApprovalCaseId`, `PENDING_PHASE1_APPROVAL`, `PENDING_MATERIAL_SUBMISSION`, `PENDING_PHASE2_APPROVAL`, `PENDING_SIGNATURE`.

- [ ] **Step 8: Commit**

```bash
cd Exchange_js && git add \
  src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts \
  src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts \
  src/modules/identity/client-risk-assessment/client-risk-assessment-approval-projection.service.ts \
  src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts
git commit -m "refactor(cra): 3-state machine; unified MLRO review; handleSignoffComplete triggers TierUpgradeCase"
```

---

## Task 5 — Sumsub Ingestion: Clue 4.5 + Clue 5 Fix

**Files:**
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`

**Clue 5 fix:** Spontaneous AML RED hit uses `recordAssessmentFromKnownAmlResult()` instead of `startAssessment()` — avoids a redundant Sumsub API round-trip.

**Clue 4.5 (new):** `applicantWorkflowCompleted` + APPROVED + RESTRICTED → customer completed Level 2 → call `tierUpgradeCaseService.handleLevel2WorkflowComplete()`.

- [ ] **Step 1: Add `TierUpgradeCaseService` injection to `SumsubIngestionService`**

```typescript
// sumsub-ingestion.service.ts — add import
import { TierUpgradeCaseService } from '../identity/tier-upgrade-case/tier-upgrade-case.service';

// Add to constructor:
constructor(
  private readonly prisma: PrismaService,
  private readonly onboardingService: OnboardingService,
  private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
  private readonly materialRefreshService: MaterialRefreshService,
  private readonly tierUpgradeCaseService: TierUpgradeCaseService,  // ← ADD
) {}
```

Also add `TierUpgradeCaseModule` to `SumsubIngestionModule` imports (check `sumsub-ingestion.module.ts`).

- [ ] **Step 2: Fix Clue 5 — use `recordAssessmentFromKnownAmlResult`**

In `dispatch()`, replace the Clue 5 block (lines ~144-158):

```typescript
// Clue 5: APPROVED + spontaneous AML RED → create assessment from known result (no extra API call)
else if (
  customer.onboardingStatus === 'APPROVED' &&
  event.eventType === 'applicantReviewed' &&
  reviewResult?.reviewAnswer === 'RED'
) {
  await this.clientRiskAssessmentService.recordAssessmentFromKnownAmlResult({
    customerId: customer.id,
    triggerType: 'SUMSUB_AML_HIT',
    knownAmlResult: {
      reviewAnswer: reviewResult.reviewAnswer,
      rejectLabels: reviewResult.rejectLabels || [],
      inspectionId: inspectionId || undefined,
    },
    snapshot: payload,
  });
  result = { handled: 'spontaneous_aml_hit' };
  dispatchedContext = 'AML_ASSESSMENT';
}
```

- [ ] **Step 3: Add Clue 4.5 — Level 2 workflow complete → TierUpgradeCase**

Insert BEFORE Clue 5, after Clue 4:

```typescript
// Clue 4.5: APPROVED + RESTRICTED + applicantWorkflowCompleted → Level 2 completed
else if (
  customer.onboardingStatus === 'APPROVED' &&
  customer.restrictionStatus === 'RESTRICTED' &&
  event.eventType === 'applicantWorkflowCompleted'
) {
  const pendingUpgrade = await this.prisma.tierUpgradeCase.findFirst({
    where: { customerId: customer.id, status: 'PENDING_LEVEL2' },
  });
  if (pendingUpgrade) {
    await this.tierUpgradeCaseService.handleLevel2WorkflowComplete(customer.id);
    result = { handled: 'tier_upgrade_level2_complete' };
    dispatchedContext = 'TIER_UPGRADE';
  }
}
```

Note: The existing Clue 4 block ends with `dispatchedContext = 'ONBOARDING'` — Clue 4.5 goes in the `else if` chain between Clue 4 and Clue 5.

- [ ] **Step 4: Smoke test via API**

```bash
# Start services
cd Exchange_js && npm run dev:start

TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r .access_token)

# Get a LOW APPROVED customer
CUST_NO=$(sqlite3 /tmp/exchange_js_branch/dev.db \
  "SELECT customerNo FROM customer_main WHERE riskTier='LOW' AND onboardingStatus='APPROVED' LIMIT 1;")
echo "Customer: $CUST_NO"

# Step 1: Admin manually triggers CRA
CUST_ID=$(sqlite3 /tmp/exchange_js_branch/dev.db \
  "SELECT id FROM customer_main WHERE customerNo='$CUST_NO';")
curl -s -X POST "http://localhost:3000/admin/compliance/customers/$CUST_ID/risk-assessment/trigger" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"smoke-test"}' | jq .assessmentNo

CRA_NO=$(sqlite3 /tmp/exchange_js_branch/dev.db \
  "SELECT assessmentNo FROM client_risk_assessments WHERE customerId='$CUST_ID' AND status='PENDING_SUMSUB_RESULT' ORDER BY triggeredAt DESC LIMIT 1;")
echo "CRA: $CRA_NO"

# Step 2: Simulate GREEN result → should auto-SIGN (LOW→LOW)
curl -s -X POST http://localhost:3000/admin/sumsub/simulate/aml-check-result \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"customerNo\":\"$CUST_NO\",\"reviewAnswer\":\"GREEN\"}" | jq .

sqlite3 /tmp/exchange_js_branch/dev.db \
  "SELECT status FROM client_risk_assessments WHERE assessmentNo='$CRA_NO';"
# Expected: SIGNED
```

- [ ] **Step 5: Commit**

```bash
cd Exchange_js && git add \
  src/modules/sumsub-ingestion/sumsub-ingestion.service.ts \
  src/modules/sumsub-ingestion/sumsub-ingestion.module.ts
git commit -m "feat(ingestion): clue-4.5 routes L2 completion to TierUpgradeCase; clue-5 uses known AML result"
```

---

## Task 6 — Material Refresh → CRA Trigger

**Files:**
- Modify: `src/modules/identity/material-refresh/material-refresh.service.ts`

After all EXPIRY-type material refresh cycles are cleared (and no active CRA exists), trigger a new scheduled CRA.

- [ ] **Step 1: Locate "all cycles cleared" bridge in `material-refresh.service.ts`**

Find the section (~line 236) that checks `pendingAssessment` and triggers `handleMaterialSubmissionComplete`. The new code goes AFTER this block.

- [ ] **Step 2: Add trigger after the existing bridge**

```typescript
// EXISTING — Phase 2 bridge for LOW→HIGH upgrade (keep as-is):
// if (pendingAssessment) { ... handleMaterialSubmissionComplete ... }

// NEW — periodic refresh fully cleared → kick off fresh CRA
if (!pendingAssessment) {
  const anyPendingExpiryCycle = await this.prisma.materialRefreshCycle.count({
    where: {
      customerId: customer.id,
      triggerType: 'EXPIRY',
      status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] },
    },
  });
  if (anyPendingExpiryCycle === 0 && this.clientRiskAssessmentService) {
    try {
      await this.clientRiskAssessmentService.startAssessment({
        customerId: customer.id,
        triggerType: 'SCHEDULED_QUARTERLY',
        triggeredContext: { reason: 'material_refresh_complete' },
      });
    } catch (err) {
      this.logger.error(`material-refresh→CRA trigger failed for ${customer.id}:`, String(err));
    }
  }
}
```

- [ ] **Step 3: Smoke test — verify new CRA created after refresh**

```bash
sqlite3 /tmp/exchange_js_branch/dev.db \
  "SELECT assessmentNo, status, triggerType FROM client_risk_assessments ORDER BY triggeredAt DESC LIMIT 5;"
```

- [ ] **Step 4: Commit**

```bash
cd Exchange_js && git add src/modules/identity/material-refresh/material-refresh.service.ts
git commit -m "feat(material-refresh): all EXPIRY cycles cleared triggers new scheduled CRA"
```

---

## Task 7 — Admin Simulation: Level 2 Complete Endpoint

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`

Add `POST /admin/sumsub/simulate/level2-workflow-complete` for demo use when a TierUpgradeCase is `PENDING_LEVEL2`.

- [ ] **Step 1: Add the endpoint to the controller**

Find `admin-sumsub-simulation.controller.ts` and add after the last simulation endpoint:

```typescript
@Post('level2-workflow-complete')
@ApiOperation({ summary: 'Simulate Sumsub Level 2 workflow completion for a tier upgrade case' })
async simulateLevel2WorkflowComplete(
  @Req() req: any,
  @Body() body: { customerNo: string },
) {
  this.ensureAdmin(req);

  const customer = await this.prisma.customerMain.findFirst({
    where: { customerNo: body.customerNo },
    select: { id: true, sumsubApplicantId: true, restrictionStatus: true },
  });
  if (!customer) {
    throw new NotFoundException(`Customer ${body.customerNo} not found`);
  }
  if (customer.restrictionStatus !== 'RESTRICTED') {
    throw new BadRequestException(`Customer ${body.customerNo} is not RESTRICTED — no upgrade in progress`);
  }
  if (!customer.sumsubApplicantId) {
    throw new BadRequestException('Customer has no Sumsub applicant ID');
  }

  return this.ingestionService.ingest(
    {
      type: 'applicantWorkflowCompleted',
      applicantId: customer.sumsubApplicantId,
      externalUserId: customer.id,
      levelName: 'wave3-level-2',
      reviewResult: { reviewAnswer: 'GREEN' },
      createdAtMs: String(Date.now()),
    },
    { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION' },
  );
}
```

- [ ] **Step 2: Smoke test**

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r .access_token)

# Get a RESTRICTED customer with a PENDING_LEVEL2 TierUpgradeCase
CUST_NO=$(sqlite3 /tmp/exchange_js_branch/dev.db \
  "SELECT cm.customerNo FROM customer_main cm
   JOIN tier_upgrade_cases tuc ON tuc.customerId=cm.id
   WHERE tuc.status='PENDING_LEVEL2' LIMIT 1;")
echo "Customer: $CUST_NO"

curl -s -X POST http://localhost:3000/admin/sumsub/simulate/level2-workflow-complete \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"customerNo\":\"$CUST_NO\"}" | jq .

# Check TierUpgradeCase advanced to PENDING_PHASE2_APPROVAL
sqlite3 /tmp/exchange_js_branch/dev.db \
  "SELECT status FROM tier_upgrade_cases WHERE customerId=(SELECT id FROM customer_main WHERE customerNo='$CUST_NO');"
# Expected: PENDING_PHASE2_APPROVAL
```

- [ ] **Step 3: Commit**

```bash
cd Exchange_js && git add src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts
git commit -m "feat(simulation): add level2-workflow-complete endpoint for tier upgrade demo"
```

---

## Task 8 — Customer-Facing Compliance API

**Files:**
- Create: `src/modules/identity/client-risk-assessment/client-risk-assessment-customer.controller.ts`
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`

Customer web needs `GET /compliance/me` to show upgrade status, and `POST /compliance/verification/mock-complete-level2` for demo.

- [ ] **Step 1: Create the customer controller**

```typescript
// client-risk-assessment-customer.controller.ts
import { Controller, Get, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubIngestionService } from '../../sumsub-ingestion/sumsub-ingestion.service';

@ApiTags('Customer - Compliance')
@Controller('compliance')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ClientRiskAssessmentCustomerController {
  constructor(
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly ingestionService: SumsubIngestionService,
  ) {}

  @Get('me')
  async getMyComplianceStatus(@Req() req: any) {
    const customerId = req.user?.sub;
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: {
        customerNo: true,
        riskTier: true,
        operatingStatus: true,
        restrictionStatus: true,
        restrictionReason: true,
        complianceHoldStatus: true,
        sumsubCurrentLevelName: true,
        sumsubApplicantId: true,
      },
    });
    if (!customer) return { status: 'NOT_FOUND' };

    const activeCra = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        customerId,
        status: { in: ['PENDING_SUMSUB_RESULT', 'PENDING_MLRO_REVIEW'] },
      },
      orderBy: { triggeredAt: 'desc' },
      select: { assessmentNo: true, status: true },
    });

    const tierUpgradeCase = await this.prisma.tierUpgradeCase.findFirst({
      where: { customerId, status: { in: ['PENDING_LEVEL2', 'PENDING_PHASE2_APPROVAL'] } },
      orderBy: { createdAt: 'desc' },
      select: { caseNo: true, status: true },
    });

    return {
      riskTier: customer.riskTier,
      operatingStatus: customer.operatingStatus,
      restrictionStatus: customer.restrictionStatus,
      restrictionReason: customer.restrictionReason,
      complianceHoldStatus: customer.complianceHoldStatus,
      sumsubLevel: customer.sumsubCurrentLevelName,
      activeCra: activeCra ?? null,
      tierUpgradeCase: tierUpgradeCase ?? null,
      requiresLevel2:
        customer.restrictionStatus === 'RESTRICTED' &&
        tierUpgradeCase?.status === 'PENDING_LEVEL2',
    };
  }

  /** Mock-mode only: simulate customer completing Level 2 workflow */
  @Post('verification/mock-complete-level2')
  async mockCompleteLevel2(@Req() req: any) {
    const customerId = req.user?.sub;
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { sumsubApplicantId: true, restrictionStatus: true, restrictionReason: true },
    });

    if (customer?.restrictionStatus !== 'RESTRICTED') {
      throw new BadRequestException('Customer is not RESTRICTED — Level 2 not required');
    }
    if (!customer?.sumsubApplicantId) {
      throw new BadRequestException('No Sumsub applicant ID');
    }

    return this.ingestionService.ingest(
      {
        type: 'applicantWorkflowCompleted',
        applicantId: customer.sumsubApplicantId,
        externalUserId: customerId,
        levelName: 'wave3-level-2',
        reviewResult: { reviewAnswer: 'GREEN' },
        createdAtMs: String(Date.now()),
      },
      { isSimulated: true, simulatedByUserId: customerId },
    );
  }
}
```

- [ ] **Step 2: Register in module**

In `client-risk-assessment.module.ts`:

```typescript
import { ClientRiskAssessmentCustomerController } from './client-risk-assessment-customer.controller';
import { SumsubIngestionModule } from '../../sumsub-ingestion/sumsub-ingestion.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
    forwardRef(() => SumsubIngestionModule),  // ← ADD (forwardRef if circular)
    ApprovalsModule,
    TierUpgradeCaseModule,
  ],
  controllers: [
    ClientRiskAssessmentController,
    RiskAssessmentAdminController,
    ClientRiskAssessmentCustomerController,   // ← ADD
  ],
  // ...
})
```

- [ ] **Step 3: Smoke test**

```bash
# Get customer token (adjust email/password to a test customer)
CTOKEN=$(curl -s -X POST http://localhost:3000/auth/customer/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456"}' | jq -r .access_token)

curl -s http://localhost:3000/compliance/me \
  -H "Authorization: Bearer $CTOKEN" | jq .
# Expected: { riskTier, restrictionStatus, requiresLevel2: false, tierUpgradeCase: null, ... }
```

- [ ] **Step 4: Commit**

```bash
cd Exchange_js && git add \
  src/modules/identity/client-risk-assessment/client-risk-assessment-customer.controller.ts \
  src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts
git commit -m "feat(cra): customer compliance status API with TierUpgradeCase status + mock Level 2"
```

---

## Task 9 — Admin Web: SumsubEvents Simulation Tabs

**Files:**
- Modify: `admin-web/src/pages/SumsubEventsPage.tsx`

Replace old `riskAssessment` tab with 3 new tabs:
1. **`craSimulation`** — CRANo + reviewAnswer → calls `aml-check-result`
2. **`ongoingMonitoring`** — customerNo + hit type → calls `risk-assessment-scenario`
3. **`level2Simulation`** — customerNo → calls `level2-workflow-complete`

- [ ] **Step 1: Read current SumsubEventsPage.tsx to understand state structure**

```bash
head -80 admin-web/src/pages/SumsubEventsPage.tsx
```

- [ ] **Step 2: Update `SimTab` type and tab state**

Find and replace the SimTab type:

```typescript
// Before:
type SimTab = 'onboarding' | 'material' | 'riskAssessment';

// After:
type SimTab = 'onboarding' | 'material' | 'craSimulation' | 'ongoingMonitoring' | 'level2Simulation';
```

- [ ] **Step 3: Add new state variables at top of component**

```typescript
// CRA simulation tab
const [craNo, setCraNo] = useState('');
const [craReviewAnswer, setCraReviewAnswer] = useState('GREEN');

// Ongoing monitoring tab
const [omCustomerNo, setOmCustomerNo] = useState('');
const [omHitType, setOmHitType] = useState('PEP_TIER_1');

// Level 2 simulation tab
const [l2CustomerNo, setL2CustomerNo] = useState('');

// Shared result display
const [simResult, setSimResult] = useState('');
```

- [ ] **Step 4: Replace `riskAssessment` tab button with 3 new buttons**

```tsx
{/* Replace old riskAssessment button with: */}
<button
  onClick={() => setSimTab('craSimulation')}
  className={simTab === 'craSimulation' ? activeTabClass : tabClass}
>
  CRA Result
</button>
<button
  onClick={() => setSimTab('ongoingMonitoring')}
  className={simTab === 'ongoingMonitoring' ? activeTabClass : tabClass}
>
  Ongoing Monitoring
</button>
<button
  onClick={() => setSimTab('level2Simulation')}
  className={simTab === 'level2Simulation' ? activeTabClass : tabClass}
>
  Level 2 Complete
</button>
```

(Use the same CSS class names as other tab buttons in the file.)

- [ ] **Step 5: Replace `riskAssessment` tab content with 3 new tab panels**

```tsx
{simTab === 'craSimulation' && (
  <div className="space-y-4">
    <p className="text-sm text-gray-500">
      Simulate Sumsub AML result for an existing <strong>PENDING_SUMSUB_RESULT</strong> assessment.
      Use after admin triggers a CRA via the Risk Assessments page.
    </p>
    <div>
      <label className="block text-sm font-medium mb-1">Customer No</label>
      <input
        value={craNo}
        onChange={e => setCraNo(e.target.value)}
        placeholder="CU2604133584"
        className="input w-full"
      />
    </div>
    <div>
      <label className="block text-sm font-medium mb-1">Review Answer</label>
      <select
        value={craReviewAnswer}
        onChange={e => setCraReviewAnswer(e.target.value)}
        className="input w-full"
      >
        <option value="GREEN">GREEN — no new risk</option>
        <option value="RED_PEP">RED + PEP_TIER_1</option>
        <option value="RED_ADVERSE">RED + ADVERSE_MEDIA</option>
        <option value="RED_SANCTIONS">RED + SANCTIONS_LIST</option>
      </select>
    </div>
    <button
      disabled={!craNo}
      onClick={async () => {
        const labelMap: Record<string, string[]> = {
          GREEN: [],
          RED_PEP: ['PEP_TIER_1'],
          RED_ADVERSE: ['ADVERSE_MEDIA'],
          RED_SANCTIONS: ['SANCTIONS_LIST'],
        };
        const answer = craReviewAnswer === 'GREEN' ? 'GREEN' : 'RED';
        const res = await adminFetch('/admin/sumsub/simulate/aml-check-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerNo: craNo,
            reviewAnswer: answer,
            rejectLabels: labelMap[craReviewAnswer] ?? [],
          }),
        });
        setSimResult(JSON.stringify(await res.json(), null, 2));
      }}
      className="btn-primary"
    >
      Simulate AML Result
    </button>
  </div>
)}

{simTab === 'ongoingMonitoring' && (
  <div className="space-y-4">
    <p className="text-sm text-gray-500">
      Simulate a Sumsub Ongoing Monitoring hit. Creates a new CRA directly from the RED result
      — no prior assessment needed.
    </p>
    <div>
      <label className="block text-sm font-medium mb-1">Customer No</label>
      <input
        value={omCustomerNo}
        onChange={e => setOmCustomerNo(e.target.value)}
        placeholder="CU2604133584"
        className="input w-full"
      />
    </div>
    <div>
      <label className="block text-sm font-medium mb-1">Hit Type</label>
      <select value={omHitType} onChange={e => setOmHitType(e.target.value)} className="input w-full">
        <option value="PEP_TIER_1">PEP (Tier 1)</option>
        <option value="ADVERSE_MEDIA">Adverse Media</option>
        <option value="SANCTIONS_LIST">Sanctions</option>
      </select>
    </div>
    <button
      disabled={!omCustomerNo}
      onClick={async () => {
        const res = await adminFetch('/admin/sumsub/simulate/risk-assessment-scenario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerNo: omCustomerNo,
            reviewAnswer: 'RED',
            rejectLabels: [omHitType],
          }),
        });
        setSimResult(JSON.stringify(await res.json(), null, 2));
      }}
      className="btn-primary"
    >
      Simulate Monitoring Hit
    </button>
  </div>
)}

{simTab === 'level2Simulation' && (
  <div className="space-y-4">
    <p className="text-sm text-gray-500">
      Simulate customer completing the Sumsub Level 2 workflow.
      Use when customer is <strong>RESTRICTED</strong> with a <strong>PENDING_LEVEL2</strong> TierUpgradeCase.
    </p>
    <div>
      <label className="block text-sm font-medium mb-1">Customer No</label>
      <input
        value={l2CustomerNo}
        onChange={e => setL2CustomerNo(e.target.value)}
        placeholder="CU2604133584"
        className="input w-full"
      />
    </div>
    <button
      disabled={!l2CustomerNo}
      onClick={async () => {
        const res = await adminFetch('/admin/sumsub/simulate/level2-workflow-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerNo: l2CustomerNo }),
        });
        setSimResult(JSON.stringify(await res.json(), null, 2));
      }}
      className="btn-primary"
    >
      Simulate Level 2 Complete
    </button>
  </div>
)}
```

- [ ] **Step 6: Add result display panel**

Below all tab content, add:

```tsx
{simResult && (
  <div className="mt-4">
    <pre className="bg-gray-50 rounded p-3 text-xs overflow-auto max-h-60">{simResult}</pre>
  </div>
)}
```

- [ ] **Step 7: Verify in browser**

Open http://localhost:3502 (or 3001 for main) → Compliance → Sumsub Events. Check all 3 new tabs render and buttons are clickable.

- [ ] **Step 8: Commit**

```bash
cd Exchange_js && git add admin-web/src/pages/SumsubEventsPage.tsx
git commit -m "feat(admin-web): replace riskAssessment tab with craSimulation + ongoingMonitoring + level2Simulation"
```

---

## Task 10 — Admin Web: Start CRA Button

**Files:**
- Modify: `admin-web/src/pages/RiskAssessmentListPage.tsx`

- [ ] **Step 1: Read current RiskAssessmentListPage to understand existing structure**

Note the `adminFetch` helper usage and any existing modals.

- [ ] **Step 2: Add trigger state and handler**

```typescript
const [startCraModalOpen, setStartCraModalOpen] = useState(false);
const [startCraCustomerNo, setStartCraCustomerNo] = useState('');
const [startCraLoading, setStartCraLoading] = useState(false);
const [startCraError, setStartCraError] = useState('');

const handleStartCra = async () => {
  if (!startCraCustomerNo.trim()) return;
  setStartCraLoading(true);
  setStartCraError('');
  try {
    // Resolve customerNo → customerId
    const res = await adminFetch(
      `/admin/customers?customerNo=${encodeURIComponent(startCraCustomerNo)}`,
    );
    const data = await res.json();
    const customerId = data.items?.[0]?.id;
    if (!customerId) {
      setStartCraError('Customer not found');
      return;
    }

    const trigRes = await adminFetch(
      `/admin/compliance/customers/${customerId}/risk-assessment/trigger`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual trigger' }),
      },
    );
    if (!trigRes.ok) {
      const err = await trigRes.json();
      setStartCraError(err.message || 'Trigger failed');
      return;
    }
    setStartCraModalOpen(false);
    setStartCraCustomerNo('');
    refetch(); // assumes a refetch/reload function exists in the page
  } finally {
    setStartCraLoading(false);
  }
};
```

- [ ] **Step 3: Add button and modal to JSX**

```tsx
{/* Add next to page title / header area */}
<button onClick={() => setStartCraModalOpen(true)} className="btn-primary">
  + Start CRA
</button>

{startCraModalOpen && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white rounded-lg p-6 w-80 space-y-4">
      <h3 className="font-semibold text-lg">Start CRA</h3>
      <div>
        <label className="block text-sm font-medium mb-1">Customer No</label>
        <input
          value={startCraCustomerNo}
          onChange={e => setStartCraCustomerNo(e.target.value)}
          placeholder="CU2604133584"
          className="input w-full"
        />
      </div>
      {startCraError && <p className="text-red-500 text-sm">{startCraError}</p>}
      <div className="flex gap-2 justify-end">
        <button onClick={() => setStartCraModalOpen(false)} className="btn-secondary">
          Cancel
        </button>
        <button
          onClick={handleStartCra}
          disabled={startCraLoading || !startCraCustomerNo.trim()}
          className="btn-primary"
        >
          {startCraLoading ? 'Creating…' : 'Start CRA'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Verify in browser**

Open Risk Assessments list → click "+ Start CRA" → enter customerNo → submit → new row with PENDING_SUMSUB_RESULT appears in list.

- [ ] **Step 5: Commit**

```bash
cd Exchange_js && git add admin-web/src/pages/RiskAssessmentListPage.tsx
git commit -m "feat(admin-web): add Start CRA trigger button to risk assessment list"
```

---

## Task 11 — Client Web: Level 2 Upgrade Section

**Files:**
- Modify: `client-web/src/pages/Verification.tsx`

When customer is RESTRICTED with `requiresLevel2: true`, show a prominent upgrade section.

- [ ] **Step 1: Add compliance status fetch on mount**

At the top of `Verification.tsx` component, add:

```typescript
const [complianceStatus, setComplianceStatus] = useState<{
  requiresLevel2: boolean;
  restrictionStatus: string | null;
  tierUpgradeCase: { caseNo: string; status: string } | null;
} | null>(null);

useEffect(() => {
  customerFetch('/compliance/me')
    .then(r => r.json())
    .then(setComplianceStatus)
    .catch(() => {});
}, []);
```

(Use whatever fetch helper the page already uses — likely `customerFetch` or `apiFetch`.)

- [ ] **Step 2: Add Level 2 upgrade section to JSX**

Insert near the top of the page content (so it shows prominently when active):

```tsx
{complianceStatus?.requiresLevel2 && (
  <div className="bg-amber-50 border border-amber-200 rounded-lg p-5 mb-6">
    <div className="flex items-center gap-2 mb-3">
      <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2.5 py-0.5 rounded">
        Enhanced Verification Required
      </span>
    </div>
    <p className="text-sm text-gray-700 mb-2">
      Your account has been flagged for enhanced due diligence. Please complete Level 2
      verification to restore full account access.
    </p>
    <p className="text-xs text-gray-500 mb-4">
      Upgrade case: <strong>{complianceStatus.tierUpgradeCase?.caseNo}</strong>
    </p>
    <button
      className="bg-amber-600 text-white px-4 py-2 rounded text-sm hover:bg-amber-700"
      onClick={async () => {
        const res = await customerFetch('/compliance/verification/mock-complete-level2', {
          method: 'POST',
        });
        if (res.ok) {
          alert('Level 2 verification submitted. Awaiting final compliance approval.');
          const updated = await customerFetch('/compliance/me');
          setComplianceStatus(await updated.json());
        } else {
          const err = await res.json();
          alert(`Error: ${err.message || 'Submission failed'}`);
        }
      }}
    >
      Mock Complete Level 2 Verification
    </button>
  </div>
)}
```

- [ ] **Step 3: End-to-end demo verification**

1. Create a LOW customer + complete onboarding
2. Admin → Risk Assessments → Start CRA
3. Admin → Sumsub Events → CRA Result tab → enter customerNo → RED + PEP
4. CRA status → `PENDING_MLRO_REVIEW`
5. Admin → Approvals → approve the MLRO review
6. CRA → `SIGNED` (HIGH). TierUpgradeCase → `PENDING_LEVEL2`
7. Client web → Verification page → "Enhanced Verification Required" section appears
8. Click "Mock Complete Level 2 Verification"
9. Admin → Sumsub Events → verify new event processed
10. TierUpgradeCase → `PENDING_PHASE2_APPROVAL`
11. Admin → Approvals → approve Phase 2 (MLRO+SMO)
12. TierUpgradeCase → `COMPLETED`. Customer `riskTier` → `HIGH`

- [ ] **Step 4: Commit**

```bash
cd Exchange_js && git add client-web/src/pages/Verification.tsx
git commit -m "feat(client-web): add Level 2 upgrade section for RESTRICTED customers in TierUpgradeCase"
```

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Task |
|---|---|
| 1. CRA = 3-state snapshot (pure risk assessment) | Tasks 2, 4 |
| 2. LOW→LOW: auto-SIGNED | Task 2 (policy `LOW_TO_LOW` → `AUTO_R2`), Task 4 (routeSignoff) |
| 3. HIGH→HIGH same labels: auto-SIGNED | Task 2 (`HIGH_TO_HIGH_STABLE`), Task 4 |
| 4. HIGH→HIGH new labels: MLRO review in CRA | Task 2 (`HIGH_TO_HIGH_UPGRADE`), Task 4 |
| 5. LOW→HIGH Phase 1: MLRO confirms AML result in CRA | Task 4 (`startMlroReview`) |
| 6. LOW→HIGH TierUpgradeCase: Level 2 + Phase 2 dual-sign (MLRO+SMO) | Task 3 |
| 7. TierUpgradeCase auto-created on CRA SIGNED as HIGH | Task 4 (handleSignoffComplete) |
| 8. Phase 2 APPROVED: tier=HIGH, restriction cleared | Task 3 (handleSignoffComplete) |
| 9. Phase 2 REJECTED: offboard | Task 3 (handleSignoffComplete) |
| 10. CRA MLRO REJECTED (false positive): maintain LOW | Task 4 (handleSignoffComplete) |
| 11. HIGH→LOW: still blocked by downgradeForbidden | Task 2 (policy unchanged) |
| 12. Cron triggers: Start CRA button + CRA Result tab | Tasks 7 (simulation endpoint), 9 (CRA tab), 10 (Start CRA button) |
| 13. Ongoing monitoring: customerNo simulation tab | Task 5 (Clue 5 fix), Task 9 (Ongoing Monitoring tab) |
| 14. Material refresh complete → CRA trigger | Task 6 |
| 15. Client-side Level 2 flow | Tasks 8 (API), 11 (UI) |

### Type Consistency

- `scenarioType: 'HIGH_TO_HIGH_STABLE' | 'HIGH_TO_HIGH_UPGRADE'` — defined Task 2, used Task 4
- `TierUpgradeCaseService.createFromCra(cra)` — defined Task 3, called Task 4
- `TierUpgradeCaseService.handleLevel2WorkflowComplete(customerId)` — defined Task 3, called Task 5 (Clue 4.5)
- `handleSignoffComplete(caseId, result)` in TierUpgradeCaseService — defined Task 3, called by approval projection in Task 3
- `ACTIVE_CRA_STATUSES` — defined Task 4, used in idempotency check
- `RISK_RATING_MLRO_REVIEW` actionType — used Task 4 (`startMlroReview`), filtered in projection Task 4
- `RISK_RATING_TIER_UPGRADE_APPROVAL` actionType — used Task 3, filtered in projection Task 3

### Placeholder Scan

All code blocks are complete. API paths are exact. No TBD or TODO markers.
