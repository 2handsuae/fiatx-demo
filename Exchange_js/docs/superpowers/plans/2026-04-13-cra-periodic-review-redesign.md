# CRA Periodic Review Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Client Risk Assessment (CRA) periodic review system so all three trigger paths (scheduled cron, material refresh, ongoing monitoring) have clean end-to-end flows, the LOW→HIGH upgrade uses Sumsub Level 2 workflow (not Applicant Actions), and the tier-change matrix is correctly enforced.

**Architecture:** CRA service is the single source of truth for risk tier state-machine transitions. Sumsub ingestion service routes webhooks via 5+1 Clues. Admin web gains 3 simulation tabs (CRA result, ongoing monitoring, Level 2 completion). Client web gains a Level 2 upgrade flow triggered when customer is RESTRICTED post Phase-1 approval.

**Tech Stack:** NestJS 10 / Prisma 6 / SQLite (backend), React 18 / Vite (admin-web + client-web). All tests via Jest. Mock-mode Sumsub throughout.

---

## File Map

### Modified — Backend
| File | Change |
|------|--------|
| `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts` | Idempotency fix, Phase-1-rejected fix, add `handleLevel2WorkflowComplete()`, Phase-1-approved handler, label comparison wiring |
| `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts` | Add `previousLabels` to `PolicyInput`; HIGH→HIGH same-labels → AUTO_R2 |
| `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | Fix Clue 5 (known result), add Clue 4.5 (L2 workflow complete) |
| `src/modules/identity/material-refresh/material-refresh.service.ts` | After all EXPIRY cycles CLEARED → trigger new CRA |
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | Add `level2-workflow-complete` endpoint |

### New — Backend
| File | Purpose |
|------|---------|
| `src/modules/identity/client-risk-assessment/client-risk-assessment-customer.controller.ts` | Customer-facing: GET compliance status + POST mock-complete-level2 |

### Modified — Admin Web
| File | Change |
|------|--------|
| `admin-web/src/pages/SumsubEventsPage.tsx` | Replace `riskAssessment` tab with `craSimulation` + `ongoingMonitoring` + `level2Simulation` |
| `admin-web/src/pages/RiskAssessmentListPage.tsx` | Add "Start CRA" trigger button per customer row |

### Modified — Client Web
| File | Change |
|------|--------|
| `client-web/src/pages/Verification.tsx` | Add Level-2 upgrade section for RESTRICTED customers |

---

## Task 1 — Fix `startAssessment()` Idempotency

**Files:**
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts` ~line 40
- Test: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

Currently idempotency only blocks on `PENDING_SUMSUB_RESULT`. A customer with a `PENDING_PHASE1_APPROVAL` assessment can get a second assessment created, causing split state.

- [ ] **Step 1: Write failing test**

```typescript
// client-risk-assessment.service.spec.ts
it('returns existing assessment when one is already PENDING_PHASE1_APPROVAL', async () => {
  const existing = { id: 'cra-1', status: 'PENDING_PHASE1_APPROVAL', customerId: 'cust-1' };
  prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(existing);

  const result = await service.startAssessment({
    customerId: 'cust-1',
    triggerType: 'SCHEDULED_QUARTERLY',
  });

  expect(result).toEqual(existing);
  expect(prisma.clientRiskAssessment.create).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --testNamePattern="PENDING_PHASE1_APPROVAL" --no-coverage
```
Expected: FAIL — existing test hits wrong findFirst stub.

- [ ] **Step 3: Update idempotency check**

In `startAssessment()`, replace the `findFirst` where clause:

```typescript
// Before:
const existing = await this.prisma.clientRiskAssessment.findFirst({
  where: { customerId: input.customerId, status: 'PENDING_SUMSUB_RESULT' },
});

// After:
const ACTIVE_STATUSES = [
  'PENDING_SUMSUB_RESULT',
  'PENDING_PHASE1_APPROVAL',
  'PENDING_MATERIAL_SUBMISSION',
  'PENDING_PHASE2_APPROVAL',
  'PENDING_SIGNATURE',
  'ESCALATED_TO_SUMSUB',
];
const existing = await this.prisma.clientRiskAssessment.findFirst({
  where: { customerId: input.customerId, status: { in: ACTIVE_STATUSES } },
});
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --testNamePattern="PENDING_PHASE1_APPROVAL" --no-coverage
```
Expected: PASS

- [ ] **Step 5: Run full CRA service test suite**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --no-coverage
```
Expected: all pass

- [ ] **Step 6: Commit**
```bash
git add src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts
git commit -m "fix(cra): expand startAssessment idempotency to all active statuses"
```

---

## Task 2 — Fix Phase-1 REJECTED: Maintain LOW, Not Offboard

**Files:**
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts` ~line 228
- Test: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

Currently ALL rejections call offboard (set `onboardingStatus: 'REJECTED'`). Phase-1 rejection means MLRO confirmed the PEP hit was a false positive — customer stays LOW.

- [ ] **Step 1: Write failing test**

```typescript
it('Phase-1 rejection maintains LOW tier and clears restriction', async () => {
  const assessment = {
    id: 'cra-1', status: 'PENDING_PHASE1_APPROVAL',
    customerId: 'cust-1', resultingRiskTier: 'HIGH',
  };
  const customer = {
    id: 'cust-1', riskTier: 'LOW',
    restrictionStatus: 'RESTRICTED', restrictionReason: 'tier_upgrade_pending_materials',
    pepStatus: 'CONFIRMED',
  };
  prisma.clientRiskAssessment.findUnique.mockResolvedValueOnce(assessment);
  prisma.customerMain.findUnique.mockResolvedValueOnce(customer);

  await service.handleSignoffComplete('cra-1', { status: 'REJECTED', actionType: 'RISK_RATING_UPGRADE_PHASE1' });

  expect(prisma.customerMain.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({
      restrictionStatus: 'CLEAR',
      restrictionReason: null,
      pepStatus: 'CLEARED',
    }),
  }));
  // Must NOT set onboardingStatus: 'REJECTED'
  expect(prisma.customerMain.update).not.toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ onboardingStatus: 'REJECTED' }),
  }));
  expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'SIGNED' }),
  }));
});
```

- [ ] **Step 2: Run test to verify it fails**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --testNamePattern="Phase-1 rejection" --no-coverage
```
Expected: FAIL

- [ ] **Step 3: Update `handleSignoffComplete` REJECTED branch**

Replace the single `REJECTED` handler with per-phase logic:

```typescript
} else if (approvalCase.status === 'REJECTED') {
  const customer = await this.prisma.customerMain.findUnique({ where: { id: assessment.customerId } });
  if (!customer) return;

  if (assessment.status === 'PENDING_PHASE1_APPROVAL') {
    // Phase 1 rejected = false positive confirmed; keep LOW, lift restriction
    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: {
        restrictionStatus: 'CLEAR',
        restrictionReason: null,
        pepStatus: customer.pepStatus === 'CONFIRMED' ? 'CLEARED' : customer.pepStatus,
      },
    });
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessmentId },
      data: { status: 'SIGNED', signedAt: new Date(), signedBy: 'MLRO_REJECTED_PHASE1' },
    });
  } else {
    // Phase 2 / maintenance rejection = cannot manage risk → offboard (V2: governance flow)
    await this.prisma.customerMain.update({
      where: { id: customer.id },
      data: {
        onboardingStatus: 'REJECTED',
        operatingStatus: 'INACTIVE',
        pepStatus: customer.pepStatus === 'CONFIRMED' ? 'CLEARED' : customer.pepStatus,
      },
    });
    await this.prisma.clientRiskAssessment.update({
      where: { id: assessmentId },
      data: { status: 'SIGNED', signedAt: new Date(), signedBy: 'REJECTION_OFFBOARD' },
    });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --testNamePattern="Phase-1 rejection" --no-coverage
```

- [ ] **Step 5: Run full suite**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --no-coverage
```

- [ ] **Step 6: Commit**
```bash
git add src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts
git commit -m "fix(cra): phase-1 rejected clears restriction and keeps LOW tier instead of offboarding"
```

---

## Task 3 — HIGH→HIGH Label Comparison in Policy

**Files:**
- Modify: `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts`
- Test: `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts`

When a HIGH customer's new AML labels are a subset of (or equal to) the previous assessment labels, auto-sign. When there are new labels, require MLRO maintenance approval.

- [ ] **Step 1: Write failing tests**

```typescript
// client-risk-assessment-policy.spec.ts
describe('HIGH→HIGH label comparison', () => {
  it('auto-signs when new labels are same as previous', () => {
    const result = applyPolicy(
      {
        amlAnswer: 'RED',
        amlLabels: ['PEP_TIER_1'],
        holdings: [],
        previousTier: 'HIGH',
        previousLabels: ['PEP_TIER_1'],
      },
      policy,
    );
    expect(result.signoffMethod).toBe('AUTO_R2');
    expect(result.resultingTier).toBe('HIGH');
  });

  it('auto-signs when new labels are subset of previous', () => {
    const result = applyPolicy(
      {
        amlAnswer: 'GREEN',
        amlLabels: [],
        holdings: [],
        previousTier: 'HIGH',
        previousLabels: ['PEP_TIER_1'],
      },
      policy,
    );
    expect(result.signoffMethod).toBe('AUTO_R2');
    expect(result.resultingTier).toBe('HIGH');
  });

  it('requires MLRO when there are new labels not in previous', () => {
    const result = applyPolicy(
      {
        amlAnswer: 'RED',
        amlLabels: ['PEP_TIER_1', 'ADVERSE_MEDIA'],
        holdings: [],
        previousTier: 'HIGH',
        previousLabels: ['PEP_TIER_1'],
      },
      policy,
    );
    expect(result.signoffMethod).toBe('MANUAL_MLRO');
    expect(result.resultingTier).toBe('HIGH');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**
```bash
cd Exchange_js && npx jest client-risk-assessment-policy.spec --no-coverage
```

- [ ] **Step 3: Add `previousLabels` to PolicyInput and update `applyPolicy`**

In `policy/client-risk-assessment-policy.ts`:

```typescript
export interface PolicyInput {
  amlAnswer: 'GREEN' | 'RED';
  amlLabels: string[];
  holdings: Array<{ materialType: string; status: string; expiresAt: Date | null }>;
  previousTier: string;
  previousPepStatus?: string;
  previousLabels?: string[];          // ← ADD THIS
}
```

At the END of `applyPolicy()`, before returning, add HIGH→HIGH label comparison override:

```typescript
// HIGH→HIGH: if no new labels beyond previous, auto-sign
if (
  output.resultingTier === 'HIGH' &&
  input.previousTier === 'HIGH' &&
  (output.signoffMethod === 'MANUAL_MLRO' || output.signoffMethod === 'DUAL_MLRO_SENIOR') &&
  input.previousLabels !== undefined
) {
  const prevSet = new Set(input.previousLabels);
  const hasNewLabel = input.amlLabels.some((l) => !prevSet.has(l));
  if (!hasNewLabel) {
    output.signoffMethod = 'AUTO_R2';
    output.recommendedAction = 'REAFFIRM';
    output.scenarioType = 'HIGH_STABLE';
  }
}
return output;
```

- [ ] **Step 4: Wire `previousLabels` into `processAssessmentResult`**

In `client-risk-assessment.service.ts`, inside `processAssessmentResult()`, before calling `applyPolicy()`:

```typescript
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

const output = applyPolicy(
  {
    amlAnswer: reviewResult.reviewAnswer,
    amlLabels: labels,
    holdings: holdingsForPolicy,
    previousTier: customer.riskTier || 'LOW',
    previousPepStatus: customer.pepStatus || 'NONE',
    previousLabels,                              // ← PASS IN
  },
  policy,
);
```

- [ ] **Step 5: Run all policy tests**
```bash
cd Exchange_js && npx jest client-risk-assessment-policy.spec --no-coverage
```
Expected: all pass

- [ ] **Step 6: Run CRA service tests**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --no-coverage
```

- [ ] **Step 7: Commit**
```bash
git add src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts \
        src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts
git commit -m "feat(cra): HIGH→HIGH same-labels auto-signs, new labels require MLRO review"
```

---

## Task 4 — Add `handleLevel2WorkflowComplete()` to CRA Service

**Files:**
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`
- Test: `src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts`

This is called by Clue 4.5 when an APPROVED+RESTRICTED customer finishes the Sumsub Level 2 workflow. It seeds material holdings as FRESH and advances the CRA to Phase 2.

- [ ] **Step 1: Write failing test**

```typescript
it('handleLevel2WorkflowComplete advances CRA to PENDING_PHASE2_APPROVAL', async () => {
  const assessment = {
    id: 'cra-1', status: 'PENDING_MATERIAL_SUBMISSION',
    customerId: 'cust-1', assessmentNo: 'CRA-001',
    resultingRiskTier: 'HIGH', traceId: 'CRA:trace-1',
  };
  const customer = { id: 'cust-1', sumsubApplicantId: 'sumsub-1' };
  prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(assessment);
  prisma.customerMain.findUnique.mockResolvedValueOnce(customer);
  prisma.approvalCase.create.mockResolvedValueOnce({ id: 'ap-1' });

  await service.handleLevel2WorkflowComplete('cust-1');

  expect(prisma.clientRiskAssessment.update).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ status: 'PENDING_PHASE2_APPROVAL', phase2ApprovalCaseId: 'ap-1' }),
  }));
});

it('handleLevel2WorkflowComplete is no-op when no PENDING_MATERIAL_SUBMISSION assessment', async () => {
  prisma.clientRiskAssessment.findFirst.mockResolvedValueOnce(null);
  await service.handleLevel2WorkflowComplete('cust-1');
  expect(prisma.clientRiskAssessment.update).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --testNamePattern="handleLevel2WorkflowComplete" --no-coverage
```

- [ ] **Step 3: Add method to CRA service**

```typescript
/** Called when APPROVED+RESTRICTED customer completes Sumsub Level 2 workflow */
async handleLevel2WorkflowComplete(customerId: string): Promise<void> {
  const assessment = await this.prisma.clientRiskAssessment.findFirst({
    where: { customerId, status: 'PENDING_MATERIAL_SUBMISSION' },
    orderBy: { triggeredAt: 'desc' },
  });
  if (!assessment) return;

  await this.startPhase2Approval(assessment);
}
```

- [ ] **Step 4: Update Phase-1 APPROVED handler to use Level 2 workflow (not Applicant Actions)**

In `handleSignoffComplete`, the `PENDING_PHASE1_APPROVAL` + APPROVED branch currently calls `recomputeHoldingsForCustomer` which creates `MaterialRefreshCycle` entries. Replace that call:

```typescript
// BEFORE (remove this):
if (this.materialRefreshService) {
  try {
    await this.materialRefreshService.recomputeHoldingsForCustomer(customer.id, 'wave3-level-2');
  } catch (err) { ... }
}
await this.prisma.clientRiskAssessment.update({
  where: { id: assessmentId },
  data: { status: 'PENDING_MATERIAL_SUBMISSION' },
});

// AFTER (Level 2 workflow — customer completes it in Sumsub SDK; Clue 4.5 will advance CRA):
await this.prisma.clientRiskAssessment.update({
  where: { id: assessmentId },
  data: { status: 'PENDING_MATERIAL_SUBMISSION' },
});
// Note: no Applicant Actions created here. The Level 2 workflow in Sumsub SDK
// is the mechanism. Clue 4.5 in ingestion service handles applicantWorkflowCompleted
// for APPROVED+RESTRICTED customers and calls handleLevel2WorkflowComplete().
```

- [ ] **Step 5: Run tests**
```bash
cd Exchange_js && npx jest client-risk-assessment.service.spec --no-coverage
```

- [ ] **Step 6: Commit**
```bash
git add src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.service.spec.ts
git commit -m "feat(cra): add handleLevel2WorkflowComplete; phase-1 approved uses L2 workflow instead of applicant actions"
```

---

## Task 5 — Fix Clue 5 + Add Clue 4.5 in Ingestion Service

**Files:**
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`
- Test: (manual via API — ingestion has no dedicated unit test file; verify via DB after simulation)

**Clue 5 fix:** Ongoing monitoring pushes a RED webhook with the result already in the payload. Currently the code calls `startAssessment()` which wastes an API round-trip to Sumsub. Use `recordAssessmentFromKnownAmlResult()` with the known result directly.

**Clue 4.5 (new):** When an APPROVED+RESTRICTED customer's Sumsub Level 2 workflow completes (`applicantWorkflowCompleted`), advance the CRA from `PENDING_MATERIAL_SUBMISSION` to Phase 2.

- [ ] **Step 1: Fix `recordAssessmentFromKnownAmlResult` signature to accept triggerType**

In `client-risk-assessment.service.ts`, update `recordAssessmentFromKnownAmlResult`:

```typescript
async recordAssessmentFromKnownAmlResult(input: {
  customerId: string;
  triggerType?: string;                         // ← ADD (defaults to INITIAL_ONBOARDING)
  knownAmlResult: { reviewAnswer: 'GREEN' | 'RED'; rejectLabels?: string[]; inspectionId?: string };
  snapshot: any;
}): Promise<any> {
  // ...
  const assessment = await this.prisma.clientRiskAssessment.create({
    data: {
      assessmentNo,
      customerId: input.customerId,
      triggerType: input.triggerType || 'INITIAL_ONBOARDING',   // ← USE INPUT
      policyVersion: policy.version,
      previousRiskTier: customer.riskTier,
      status: 'PENDING_SUMSUB_RESULT',
      sumsubSnapshotAt: new Date(),
      sumsubAmlReviewAnswer: input.knownAmlResult.reviewAnswer,
      sumsubAmlLabels: JSON.stringify(input.knownAmlResult.rejectLabels || []),
      sumsubAmlCheckInspectionId: input.knownAmlResult.inspectionId || null,  // ← STORE
      traceId,
    },
  });
  // ...
}
```

- [ ] **Step 2: Update Clue 5 in `sumsub-ingestion.service.ts`**

```typescript
// Clue 5: APPROVED + spontaneous AML RED → start new assessment with known result
else if (
  customer.onboardingStatus === 'APPROVED' &&
  event.eventType === 'applicantReviewed' &&
  reviewResult?.reviewAnswer === 'RED'
) {
  // BEFORE: startAssessment() which called runAmlCheck() again — wasteful
  // AFTER: use the result we already have in this webhook
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

- [ ] **Step 3: Add Clue 4.5 between Clue 4 and Clue 5**

Insert after the Clue 4 block (PENDING_VERIFICATION check), before the Clue 5 block:

```typescript
// Clue 4.5: APPROVED + RESTRICTED + applicantWorkflowCompleted → Level 2 upgrade complete
else if (
  customer.onboardingStatus === 'APPROVED' &&
  customer.restrictionStatus === 'RESTRICTED' &&
  event.eventType === 'applicantWorkflowCompleted'
) {
  const pendingUpgrade = await this.prisma.clientRiskAssessment.findFirst({
    where: { customerId: customer.id, status: 'PENDING_MATERIAL_SUBMISSION' },
  });
  if (pendingUpgrade) {
    await this.clientRiskAssessmentService.handleLevel2WorkflowComplete(customer.id);
    result = { handled: 'level2_workflow_complete' };
    dispatchedContext = 'AML_ASSESSMENT';
  }
}
```

- [ ] **Step 4: Smoke test via API**

Start services and run:
```bash
# 1. Login admin
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@fiatx.com","password":"123456"}' | jq -r .access_token)

# 2. Get a LOW customer's ID (use an existing APPROVED LOW customer)
CUST_ID=$(sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT id FROM customer_main WHERE riskTier='LOW' AND onboardingStatus='APPROVED' LIMIT 1;")
echo "Customer: $CUST_ID"

# 3. Trigger a CRA
curl -s -X POST "http://localhost:3000/admin/compliance/customers/$CUST_ID/risk-assessment/trigger" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"reason":"test"}' | jq .assessmentNo

# 4. Get the CRANo back
CRA_NO=$(sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT assessmentNo FROM client_risk_assessments WHERE customerId='$CUST_ID' AND status='PENDING_SUMSUB_RESULT' ORDER BY triggeredAt DESC LIMIT 1;")
echo "CRA: $CRA_NO"

# 5. Simulate AML result via aml-check-result
CUST_NO=$(sqlite3 /tmp/exchange_js_main/dev.db "SELECT customerNo FROM customer_main WHERE id='$CUST_ID';")
curl -s -X POST http://localhost:3000/admin/sumsub/simulate/aml-check-result \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"customerNo\":\"$CUST_NO\",\"reviewAnswer\":\"GREEN\"}" | jq .

# 6. Check CRA is now SIGNED
sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT status FROM client_risk_assessments WHERE assessmentNo='$CRA_NO';"
# Expected: SIGNED
```

- [ ] **Step 5: Commit**
```bash
git add src/modules/sumsub-ingestion/sumsub-ingestion.service.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts
git commit -m "feat(cra): fix clue-5 uses known result; add clue-4.5 for L2 workflow completion"
```

---

## Task 6 — Material Refresh Completion → Trigger New CRA

**Files:**
- Modify: `src/modules/identity/material-refresh/material-refresh.service.ts` ~line 236
- Test: manual DB check

After ALL periodic material refresh cycles (triggerType `EXPIRY`) for a customer are CLEARED, and there is NO pending LOW→HIGH upgrade assessment (`PENDING_MATERIAL_SUBMISSION`), trigger a new CRA for the customer.

- [ ] **Step 1: Locate the "all cycles cleared" bridge in `handleSumsubActionResult`**

Find the section (around line 236):
```typescript
const pendingAssessment = await this.prisma.clientRiskAssessment.findFirst({
  where: { customerId: customer.id, status: 'PENDING_MATERIAL_SUBMISSION' },
});
if (pendingAssessment) {
  const pendingCycles = await this.prisma.materialRefreshCycle.count({ ... });
  if (pendingCycles === 0) {
    await this.clientRiskAssessmentService.handleMaterialSubmissionComplete(customer.id, 'GREEN');
  }
}
```

- [ ] **Step 2: Add periodic refresh → new CRA trigger after the existing bridge**

```typescript
// Existing bridge (Phase 2 for LOW→HIGH upgrade — keep as-is)
if (pendingAssessment) {
  const pendingCycles = await this.prisma.materialRefreshCycle.count({
    where: { customerId: customer.id, status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] } },
  });
  if (pendingCycles === 0) {
    await this.clientRiskAssessmentService.handleMaterialSubmissionComplete(customer.id, 'GREEN');
  }
}

// NEW: periodic material refresh fully cleared → kick off a new CRA
if (!pendingAssessment) {
  const anyPendingCycle = await this.prisma.materialRefreshCycle.count({
    where: {
      customerId: customer.id,
      status: { in: ['PENDING_CUSTOMER_EVIDENCE', 'PENDING_SUMSUB_REVIEW'] },
      triggerType: 'EXPIRY',
    },
  });
  if (anyPendingCycle === 0) {
    // All EXPIRY-type refresh cycles cleared — time for a fresh CRA
    if (this.clientRiskAssessmentService) {
      try {
        await this.clientRiskAssessmentService.startAssessment({
          customerId: customer.id,
          triggerType: 'SCHEDULED_QUARTERLY',
          triggeredContext: { reason: 'material_refresh_complete' },
        });
      } catch (err) {
        this.logger.error(`material-refresh→CRA trigger failed for ${customer.id}:`, err);
      }
    }
  }
}
```

- [ ] **Step 3: Smoke test**

```bash
# Check: after all cycles for a customer clear, a new CRA is created
# (Manual verification via DB after simulating cycle completion)
sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT assessmentNo, status, triggerType FROM client_risk_assessments ORDER BY triggeredAt DESC LIMIT 5;"
```

- [ ] **Step 4: Commit**
```bash
git add src/modules/identity/material-refresh/material-refresh.service.ts
git commit -m "feat(material-refresh): all EXPIRY cycles cleared triggers new CRA"
```

---

## Task 7 — Add Level 2 Simulation Endpoint (Backend)

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`

Admin needs to simulate an `applicantWorkflowCompleted` event for a specific customer (identified by CRANo) to test the LOW→HIGH Level 2 upgrade path.

- [ ] **Step 1: Add the endpoint**

```typescript
@Post('level2-workflow-complete')
@ApiOperation({ summary: 'Simulate Sumsub Level 2 workflow completion for LOW→HIGH CRA upgrade' })
async simulateLevel2WorkflowComplete(
  @Req() req: any,
  @Body() body: { craNo: string },
) {
  this.ensureAdmin(req);

  const assessment = await this.prisma.clientRiskAssessment.findFirst({
    where: { assessmentNo: body.craNo, status: 'PENDING_MATERIAL_SUBMISSION' },
  });
  if (!assessment) {
    throw new ForbiddenException(
      `No PENDING_MATERIAL_SUBMISSION assessment found for CRA ${body.craNo}`,
    );
  }

  const customer = await this.prisma.customerMain.findUnique({
    where: { id: assessment.customerId },
  });
  if (!customer?.sumsubApplicantId) {
    throw new ForbiddenException('Customer has no Sumsub applicant ID');
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

# Get a CRA that's PENDING_MATERIAL_SUBMISSION
CRA_NO=$(sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT assessmentNo FROM client_risk_assessments WHERE status='PENDING_MATERIAL_SUBMISSION' LIMIT 1;")

curl -s -X POST http://localhost:3000/admin/sumsub/simulate/level2-workflow-complete \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"craNo\":\"$CRA_NO\"}" | jq .

# Check CRA advanced
sqlite3 /tmp/exchange_js_main/dev.db \
  "SELECT status FROM client_risk_assessments WHERE assessmentNo='$CRA_NO';"
# Expected: PENDING_PHASE2_APPROVAL
```

- [ ] **Step 3: Commit**
```bash
git add src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts
git commit -m "feat(simulation): add level2-workflow-complete endpoint for LOW→HIGH CRA demo"
```

---

## Task 8 — Customer-Facing Compliance API

**Files:**
- Create: `src/modules/identity/client-risk-assessment/client-risk-assessment-customer.controller.ts`
- Modify: `src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`

Client-web needs to know when a customer is RESTRICTED and needs Level 2 verification. Mock-mode needs a way to simulate Level 2 completion without a real Sumsub SDK.

- [ ] **Step 1: Create the customer controller**

```typescript
// client-risk-assessment-customer.controller.ts
import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
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
    private readonly prisma: PrismaService,
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

    const pendingCra = await this.prisma.clientRiskAssessment.findFirst({
      where: {
        customerId,
        status: { in: ['PENDING_MATERIAL_SUBMISSION', 'PENDING_PHASE1_APPROVAL', 'PENDING_PHASE2_APPROVAL'] },
      },
      orderBy: { triggeredAt: 'desc' },
      select: { assessmentNo: true, status: true },
    });

    return {
      riskTier: customer.riskTier,
      operatingStatus: customer.operatingStatus,
      restrictionStatus: customer.restrictionStatus,
      restrictionReason: customer.restrictionReason,
      complianceHoldStatus: customer.complianceHoldStatus,
      sumsubLevel: customer.sumsubCurrentLevelName,
      pendingCra: pendingCra
        ? { assessmentNo: pendingCra.assessmentNo, status: pendingCra.status }
        : null,
      requiresLevel2:
        customer.restrictionStatus === 'RESTRICTED' &&
        pendingCra?.status === 'PENDING_MATERIAL_SUBMISSION',
    };
  }

  /** Mock-mode only: simulate customer completing Level 2 SDK workflow */
  @Post('verification/mock-complete-level2')
  async mockCompleteLevel2(@Req() req: any) {
    const customerId = req.user?.sub;
    if (req.user?.type !== 'CUSTOMER') {
      return { ok: false, error: 'Customer token required' };
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
      select: { sumsubApplicantId: true, restrictionStatus: true },
    });
    if (!customer?.sumsubApplicantId) {
      return { ok: false, error: 'No Sumsub applicant' };
    }
    if (customer.restrictionStatus !== 'RESTRICTED') {
      return { ok: false, error: 'Customer is not RESTRICTED — Level 2 not required' };
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

In `client-risk-assessment.module.ts`, add to controllers array and import `SumsubIngestionModule` if needed:

```typescript
import { ClientRiskAssessmentCustomerController } from './client-risk-assessment-customer.controller';

@Module({
  controllers: [
    ClientRiskAssessmentAdminController,
    ClientRiskAssessmentCustomerController,   // ← ADD
  ],
  // ...
})
```

- [ ] **Step 3: Smoke test**
```bash
# Get customer token
CTOKEN=$(curl -s -X POST http://localhost:3000/auth/customer/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"123456"}' | jq -r .access_token)

curl -s http://localhost:3000/compliance/me \
  -H "Authorization: Bearer $CTOKEN" | jq .
# Expected: { riskTier, restrictionStatus, requiresLevel2: false/true, ... }
```

- [ ] **Step 4: Commit**
```bash
git add src/modules/identity/client-risk-assessment/client-risk-assessment-customer.controller.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts
git commit -m "feat(cra): customer compliance status endpoint + mock-complete-level2"
```

---

## Task 9 — Admin Web: Update SumsubEventsPage Simulation Tabs

**Files:**
- Modify: `admin-web/src/pages/SumsubEventsPage.tsx`

Replace the current `riskAssessment` tab (uses `risk-assessment-scenario`) with three focused tabs:
1. **`craSimulation`** — input CRANo + review answer → calls `aml-check-result`
2. **`ongoingMonitoring`** — input customerNo + RED labels → calls `risk-assessment-scenario` (creates new CRA from spontaneous hit)
3. **`level2Simulation`** — input CRANo → calls `level2-workflow-complete`

- [ ] **Step 1: Update `SimTab` type**

```typescript
type SimTab = 'onboarding' | 'material' | 'craSimulation' | 'ongoingMonitoring' | 'level2Simulation';
```

- [ ] **Step 2: Add tab header buttons**

Find where tab buttons are rendered and replace/extend the `riskAssessment` button:

```tsx
{/* Replace the old riskAssessment tab button with these three: */}
<button
  onClick={() => setSimTab('craSimulation')}
  className={simTab === 'craSimulation' ? 'tab-active' : 'tab'}
>
  CRA Result
</button>
<button
  onClick={() => setSimTab('ongoingMonitoring')}
  className={simTab === 'ongoingMonitoring' ? 'tab-active' : 'tab'}
>
  Ongoing Monitoring
</button>
<button
  onClick={() => setSimTab('level2Simulation')}
  className={simTab === 'level2Simulation' ? 'tab-active' : 'tab'}
>
  Level 2 Complete
</button>
```

- [ ] **Step 3: Add `craSimulation` tab content**

State needed: `craNo`, `craReviewAnswer`, `craLabels`

```tsx
{simTab === 'craSimulation' && (
  <div className="sim-panel">
    <p className="sim-description">
      Simulate Sumsub AML result for an existing <strong>PENDING_SUMSUB_RESULT</strong> assessment.
      Use after clicking "Start CRA" on the Risk Assessments page.
    </p>
    <label>CRA No</label>
    <input
      value={craNo}
      onChange={(e) => setCraNo(e.target.value)}
      placeholder="CRA2604130307"
    />
    <label>Review Answer</label>
    <select value={craReviewAnswer} onChange={(e) => setCraReviewAnswer(e.target.value)}>
      <option value="GREEN">GREEN — no new risk</option>
      <option value="RED_PEP">RED + PEP_TIER_1</option>
      <option value="RED_ADVERSE">RED + ADVERSE_MEDIA</option>
      <option value="RED_SANCTIONS">RED + SANCTIONS_LIST</option>
    </select>
    <button
      disabled={!craNo}
      onClick={async () => {
        const labelMap: Record<string, string[]> = {
          GREEN: [],
          RED_PEP: ['PEP_TIER_1'],
          RED_ADVERSE: ['ADVERSE_MEDIA'],
          RED_SANCTIONS: ['SANCTIONS_LIST'],
        };
        // Resolve customerNo from CRANo first
        const craRes = await adminFetch(
          `/admin/compliance/risk-assessments?assessmentNo=${craNo}`,
        );
        const craData = await craRes.json();
        const customerNo = craData.items?.[0]?.customerNo;
        if (!customerNo) { alert('CRA not found'); return; }

        const res = await adminFetch('/admin/sumsub/simulate/aml-check-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerNo,
            reviewAnswer: craReviewAnswer === 'GREEN' ? 'GREEN' : 'RED',
            rejectLabels: labelMap[craReviewAnswer] || [],
          }),
        });
        const data = await res.json();
        setSimResult(JSON.stringify(data, null, 2));
      }}
    >
      Simulate AML Result
    </button>
  </div>
)}
```

- [ ] **Step 4: Add `ongoingMonitoring` tab content**

State needed: `omCustomerNo`, `omLabels`

```tsx
{simTab === 'ongoingMonitoring' && (
  <div className="sim-panel">
    <p className="sim-description">
      Simulate Sumsub Ongoing Monitoring hit. Creates a new CRA directly from the RED result
      — no prior assessment needed.
    </p>
    <label>Customer No</label>
    <input
      value={omCustomerNo}
      onChange={(e) => setOmCustomerNo(e.target.value)}
      placeholder="CU2604133584"
    />
    <label>Hit Type</label>
    <select value={omLabels} onChange={(e) => setOmLabels(e.target.value)}>
      <option value="PEP_TIER_1">PEP (Tier 1)</option>
      <option value="ADVERSE_MEDIA">Adverse Media</option>
      <option value="SANCTIONS_LIST">Sanctions</option>
    </select>
    <button
      disabled={!omCustomerNo}
      onClick={async () => {
        const res = await adminFetch('/admin/sumsub/simulate/risk-assessment-scenario', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerNo: omCustomerNo,
            reviewAnswer: 'RED',
            rejectLabels: [omLabels],
          }),
        });
        const data = await res.json();
        setSimResult(JSON.stringify(data, null, 2));
      }}
    >
      Simulate Monitoring Hit
    </button>
  </div>
)}
```

- [ ] **Step 5: Add `level2Simulation` tab content**

State needed: `l2CraNo`

```tsx
{simTab === 'level2Simulation' && (
  <div className="sim-panel">
    <p className="sim-description">
      Simulate customer completing the Sumsub Level 2 workflow.
      Use when a CRA is in <strong>PENDING_MATERIAL_SUBMISSION</strong> (after Phase 1 approval).
    </p>
    <label>CRA No</label>
    <input
      value={l2CraNo}
      onChange={(e) => setL2CraNo(e.target.value)}
      placeholder="CRA2604130307"
    />
    <button
      disabled={!l2CraNo}
      onClick={async () => {
        const res = await adminFetch('/admin/sumsub/simulate/level2-workflow-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ craNo: l2CraNo }),
        });
        const data = await res.json();
        setSimResult(JSON.stringify(data, null, 2));
      }}
    >
      Simulate Level 2 Complete
    </button>
  </div>
)}
```

- [ ] **Step 6: Add all required state variables at top of component**

```typescript
const [craNo, setCraNo] = useState('');
const [craReviewAnswer, setCraReviewAnswer] = useState('GREEN');
const [omCustomerNo, setOmCustomerNo] = useState('');
const [omLabels, setOmLabels] = useState('PEP_TIER_1');
const [l2CraNo, setL2CraNo] = useState('');
const [simResult, setSimResult] = useState('');
```

- [ ] **Step 7: Add result display panel below all tabs**

```tsx
{simResult && (
  <pre className="sim-result">{simResult}</pre>
)}
```

- [ ] **Step 8: Verify in browser**
Open http://localhost:3001 → Compliance → Sumsub Events → check all 3 new tabs render without errors.

- [ ] **Step 9: Commit**
```bash
git add admin-web/src/pages/SumsubEventsPage.tsx
git commit -m "feat(admin-web): replace risk-assessment tab with craSimulation + ongoingMonitoring + level2Simulation tabs"
```

---

## Task 10 — Admin Web: "Start CRA" Button on Risk Assessment List

**Files:**
- Modify: `admin-web/src/pages/RiskAssessmentListPage.tsx`

The admin needs to manually trigger a CRA for a specific customer during demo. Add a "Start CRA" button that opens a mini-modal to pick a customer, then calls the trigger endpoint.

- [ ] **Step 1: Add trigger state and handler**

```typescript
const [triggerModalOpen, setTriggerModalOpen] = useState(false);
const [triggerCustomerNo, setTriggerCustomerNo] = useState('');
const [triggerLoading, setTriggerLoading] = useState(false);
const [triggerError, setTriggerError] = useState('');

const handleTriggerCra = async () => {
  setTriggerLoading(true);
  setTriggerError('');
  try {
    // Resolve customerNo → customerId
    const res = await adminFetch(`/admin/customers?customerNo=${triggerCustomerNo}`);
    const data = await res.json();
    const customerId = data.items?.[0]?.id;
    if (!customerId) { setTriggerError('Customer not found'); return; }

    const trigRes = await adminFetch(
      `/admin/compliance/customers/${customerId}/risk-assessment/trigger`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Manual trigger from admin' }),
      },
    );
    if (!trigRes.ok) { setTriggerError('Trigger failed'); return; }
    setTriggerModalOpen(false);
    setTriggerCustomerNo('');
    refetch(); // reload the list
  } finally {
    setTriggerLoading(false);
  }
};
```

- [ ] **Step 2: Add button and modal to JSX**

```tsx
{/* Add next to existing page header */}
<button onClick={() => setTriggerModalOpen(true)} className="btn-primary">
  + Start CRA
</button>

{triggerModalOpen && (
  <div className="modal-overlay">
    <div className="modal">
      <h3>Start CRA</h3>
      <label>Customer No</label>
      <input
        value={triggerCustomerNo}
        onChange={(e) => setTriggerCustomerNo(e.target.value)}
        placeholder="CU2604133584"
      />
      {triggerError && <p className="error">{triggerError}</p>}
      <div className="modal-actions">
        <button onClick={() => setTriggerModalOpen(false)}>Cancel</button>
        <button onClick={handleTriggerCra} disabled={triggerLoading || !triggerCustomerNo}>
          {triggerLoading ? 'Creating…' : 'Start CRA'}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 3: Verify in browser**
Open http://localhost:3001 → Compliance → Risk Assessments → click "+ Start CRA" → enter a customerNo → submit → new row appears with PENDING_SUMSUB_RESULT.

- [ ] **Step 4: Commit**
```bash
git add admin-web/src/pages/RiskAssessmentListPage.tsx
git commit -m "feat(admin-web): add Start CRA trigger button to risk assessment list"
```

---

## Task 11 — Client Web: Level 2 Upgrade Flow

**Files:**
- Modify: `client-web/src/pages/Verification.tsx`

When a customer is RESTRICTED with `requiresLevel2: true` (from `GET /compliance/me`), show a Level 2 verification section so they can complete the upgrade. In mock mode, a "Mock Complete" button simulates SDK completion.

- [ ] **Step 1: Add compliance status fetch to Verification page**

At the top of `Verification.tsx`, add a `complianceStatus` state and fetch on mount:

```typescript
const [complianceStatus, setComplianceStatus] = useState<{
  requiresLevel2: boolean;
  restrictionReason: string | null;
  pendingCra: { assessmentNo: string; status: string } | null;
} | null>(null);

useEffect(() => {
  customerFetch('/compliance/me')
    .then((r) => r.json())
    .then(setComplianceStatus)
    .catch(() => {});
}, []);
```

- [ ] **Step 2: Add Level 2 upgrade section to JSX**

Insert before the existing verification sections (so it appears prominently when active):

```tsx
{complianceStatus?.requiresLevel2 && (
  <div className="verification-section level2-upgrade">
    <div className="section-header">
      <span className="badge badge-warning">Enhanced Verification Required</span>
    </div>
    <p>
      Your account has been flagged for enhanced due diligence. Please complete the
      Level 2 verification to restore full account access.
    </p>
    <p className="hint">
      CRA Reference: <strong>{complianceStatus.pendingCra?.assessmentNo}</strong>
    </p>

    {/* Production: SDK would open here via sumsubClient.launchWebSdk() */}
    {/* Mock mode: simulate completion directly */}
    <button
      className="btn-primary"
      onClick={async () => {
        const res = await customerFetch('/compliance/verification/mock-complete-level2', {
          method: 'POST',
        });
        if (res.ok) {
          alert('Level 2 verification submitted. Awaiting final compliance approval.');
          // Refresh page state
          const updated = await customerFetch('/compliance/me');
          setComplianceStatus(await updated.json());
        } else {
          alert('Submission failed — check console');
        }
      }}
    >
      Mock Complete Level 2 Verification
    </button>
  </div>
)}
```

- [ ] **Step 3: Verify in browser**

1. Create a test customer
2. Trigger a CRA → simulate RED+PEP → Phase-1 approval via admin
3. Open client web at http://localhost:3002 → login as that customer
4. Navigate to Verification page
5. "Enhanced Verification Required" section should appear with CRA reference
6. Click "Mock Complete" → compliance/me should update to `requiresLevel2: false`
7. Admin web → Compliance → Risk Assessments → CRA should be PENDING_PHASE2_APPROVAL

- [ ] **Step 4: Commit**
```bash
git add client-web/src/pages/Verification.tsx
git commit -m "feat(client-web): add Level 2 upgrade section for RESTRICTED customers"
```

---

## Self-Review Checklist

### Spec Coverage

| Requirement | Task |
|---|---|
| 1. No auto-CRA after onboarding | Verified: current code does not auto-create. Task 1 ensures idempotency won't create duplicates if cron or manual trigger is called |
| 2. Two simulation tabs (CRANo + customerNo) | Task 9: `craSimulation` + `ongoingMonitoring` tabs |
| 3. Scheduled CRA: Start button + CRANo simulation | Task 10 (Start button) + Task 9 (CRA Result tab) |
| 4. Material refresh → auto-create CRA | Task 6 |
| 5. Ongoing monitoring: customerNo tab | Task 9: `ongoingMonitoring` tab |
| 6. LOW→LOW auto-signed | Already works; Task 3 ensures HIGH→HIGH label check doesn't break LOW→LOW path |
| 7. HIGH→HIGH: MLRO if new labels, auto if same | Task 3 (policy) |
| 8. LOW→HIGH: Phase1 + Level2 workflow + Phase2 + Level2 tab + client flow | Tasks 4 (Phase1 rejected fix), 5 (Clue 4.5), 7 (Level2 endpoint), 8 (customer API), 9 (Level2 tab), 11 (client-web) |
| 9. HIGH→LOW: maintain HIGH | Already works via `downgradeForbidden: true` in policy |

### Type Consistency
- `handleLevel2WorkflowComplete(customerId: string)` — defined Task 4, used in Task 5 (Clue 4.5)
- `recordAssessmentFromKnownAmlResult({ triggerType? })` — updated signature in Task 5 Step 1, used in Task 5 Step 2
- `PolicyInput.previousLabels?: string[]` — added Task 3 Step 3, wired Task 3 Step 4
- `SimTab` — updated Task 9 Step 1, used in all subsequent tab steps

### Placeholder Scan
All code blocks are complete. All API paths are exact. No "TBD" or "TODO" markers.
