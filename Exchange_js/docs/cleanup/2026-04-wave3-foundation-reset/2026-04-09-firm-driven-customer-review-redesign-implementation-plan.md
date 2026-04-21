# Wave 3 Firm-Driven Customer Review Implementation Plan (Slim / Demo Version)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Wave 3 firm-driven customer review (Layer 2 ClientRiskAssessment + Layer 3 MaterialRefreshCycle) as a **demo with mock Sumsub integration**. No production operational concerns.

**Architecture:** Two-layer firm-driven pipeline over mocked Sumsub. All Sumsub HTTP calls are stubbed via `SUMSUB_MOCK_MODE=true`. Webhook events are synthesized by the existing admin simulation controller. Business logic, state machines, and signoff flow are real; external integration is entirely mocked.

**Tech Stack:** NestJS 11 / Prisma 5 (SQLite) / Jest / React 19 + Vite / qrcode.react (already installed) / Wave 1 ApprovalCase kernel

**Design Doc:** `docs/cleanup/2026-04-wave3-foundation-reset/2026-04-09-firm-driven-customer-review-redesign-design.md`

**Scope discipline (what this plan does NOT do):**
- ❌ Real Sumsub HTTP integration (all calls return hardcoded mocks)
- ❌ Sumsub Dashboard configuration (no real account)
- ❌ Feature flags / gradual rollout / staging-production separation
- ❌ Prometheus metrics / PagerDuty alerts / monitoring runbooks
- ❌ Exhaustive edge-case tests (retry, signature verify, dedup, rate limit) — skipped in demo
- ❌ Full spec documentation overhaul (only minimal `periodic-review-module.md` update)
- ❌ Per-task 5-step TDD ceremony for mechanical CRUD (reserved for pure policy functions)

---

## Phase Roadmap

| Phase | Scope | Tasks | Days |
|---|---|---|---|
| **Phase 1** | Schema + Approval catalog + multi-step extension | 4 | 1.0 |
| **Phase 2** | Layer 2 Client Risk Assessment | 3 | 1.0 |
| **Phase 3** | Layer 3 Material Refresh | 3 | 1.0 |
| **Phase 4** | Webhook Dispatcher + Simulation controller extension | 2 | 0.5 |
| **Phase 5** | Frontend (ProfileBanner + /verification + AuthGuard) + backend trading guards | 3 | 1.0 |
| **Phase 6** | Seed + manual acceptance via simulation controller | 1 | 0.5 |

**Total: 16 tasks, ~5 person-days**

Each phase ends with a commit and a verification step. Phase boundaries are natural checkpoint locations for subagent-driven execution.

---

## Mock-First Principle

All new Sumsub client methods follow this pattern:

```typescript
async runAmlCheck(applicantId: string): Promise<{ ok: number; inspectionId: string }> {
  if (process.env.SUMSUB_MOCK_MODE === 'true') {
    // Return a mock inspectionId; the admin simulation controller will
    // later fire an applicantReviewed event with this same id
    return { ok: 1, inspectionId: `mock-insp-${randomUUID()}` };
  }
  return this.post(`/resources/applicants/${applicantId}/aml/check`, {});
}
```

Set `SUMSUB_MOCK_MODE=true` in `.env` for local development. The code path for real Sumsub is kept but never exercised in this plan.

---

## Phase 1: Schema + Approval Catalog + Multi-Step Extension

**Goal:** Schema changes + new approval action types + multi-step approval capability (for PEP dual-sign).

### Task 1.1: Prisma schema + migration (one pass)

**Files:**
- Modify: `Exchange_js/prisma/schema.prisma`
- Create: `Exchange_js/prisma/migrations/20260409120000_wave3_firm_driven_review/migration.sql`

- [ ] **Step 1: Read current CustomerMain model**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
awk '/^model CustomerMain /,/^\}/' prisma/schema.prisma
```

Identify the `latestFinalApproval*` fields that will be renamed.

- [ ] **Step 2: Rename customer_main fields and add Wave 3 fields**

In `CustomerMain` model, replace:
```prisma
  latestFinalApprovalId           String?   @unique
  latestFinalApprovalStatus       String?
  latestFinalApproval             ApprovalCase? @relation("CustomerLatestFinalApproval", ...)
```
with:
```prisma
  // ─── renamed 2026-04-09 Wave 3 ─────────────────
  latestRiskApprovalId            String?   @unique
  latestRiskApprovalStatus        String?
  latestRiskApproval              ApprovalCase? @relation(
    "CustomerLatestRiskApproval",
    fields: [latestRiskApprovalId], references: [id], onDelete: SetNull
  )
  
  // ─── Wave 3 new ──────────────────────────────
  riskTier                        String    @default("LOW")
  riskTierUpdatedAt               DateTime?
  pepStatus                       String    @default("NONE")
  pepConfirmedAt                  DateTime?
  latestRiskAssessmentId          String?
  
  materialHoldings                CustomerMaterialHolding[]  @relation("CustomerMaterialHoldings")
  materialRefreshCycles           MaterialRefreshCycle[]     @relation("CustomerMaterialRefreshCycles")
  riskAssessments                 ClientRiskAssessment[]     @relation("CustomerRiskAssessments")
```

Also rename any `@@index([latestFinalApprovalStatus])` → `@@index([latestRiskApprovalStatus])`.

- [ ] **Step 3: Update ApprovalCase relation back-ref**

In `ApprovalCase` model, replace:
```prisma
  latestForCustomerFinalApproval CustomerMain? @relation("CustomerLatestFinalApproval")
```
with:
```prisma
  latestForCustomerRiskApproval  CustomerMain?                  @relation("CustomerLatestRiskApproval")
  riskAssessments                ClientRiskAssessment[]         @relation("ClientRiskAssessmentApprovalCase")
```

- [ ] **Step 4: Append 3 new Wave 3 models at end of schema.prisma**

```prisma
// ═══════════════════════════════════════════════════════════════
// Wave 3 Firm-Driven Customer Review (2026-04-09)
// ═══════════════════════════════════════════════════════════════

model CustomerMaterialHolding {
  id                   String   @id @default(cuid())
  customerId           String
  customer             CustomerMain @relation("CustomerMaterialHoldings", fields: [customerId], references: [id])
  
  materialType         String
  managementMode       String
  
  verifiedAt           DateTime
  expiresAt            DateTime?
  status               String   @default("FRESH")
  
  sumsubIdDocSetType   String?
  sumsubDocId          String?
  
  activeRefreshCycleId String?  @unique
  activeRefreshCycle   MaterialRefreshCycle? @relation("ActiveRefreshCycle", fields: [activeRefreshCycleId], references: [id])
  
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
  
  refreshCycles        MaterialRefreshCycle[] @relation("HoldingRefreshCycles")
  
  @@unique([customerId, materialType])
  @@index([expiresAt, status])
  @@index([customerId])
  @@map("customer_material_holdings")
}

model MaterialRefreshCycle {
  id                       String   @id @default(cuid())
  cycleNo                  String   @unique
  customerId               String
  customer                 CustomerMain @relation("CustomerMaterialRefreshCycles", fields: [customerId], references: [id])
  
  holdingId                String
  holding                  CustomerMaterialHolding @relation("HoldingRefreshCycles", fields: [holdingId], references: [id])
  
  materialType             String
  
  status                   String   @default("PENDING_CUSTOMER_EVIDENCE")
  stage                    String   @default("NUDGE_ONLY")
  triggerType              String
  
  createdAt                DateTime @default(now())
  stageNudgeAt             DateTime?
  stageUrgentAt            DateTime?
  stageBlockingAt          DateTime?
  clearedAt                DateTime?
  rejectedAt               DateTime?
  graceExpiresAt           DateTime?
  resolutionReason         String?
  
  sumsubActionId           String?
  sumsubActionLevelName    String?
  sumsubActionCreatedAt    DateTime?
  
  triggeredByAssessmentId  String?
  triggeredByAssessment    ClientRiskAssessment? @relation("AssessmentTriggeredCycles", fields: [triggeredByAssessmentId], references: [id])
  
  traceId                  String   @unique
  
  activeForHolding         CustomerMaterialHolding? @relation("ActiveRefreshCycle")
  
  @@index([customerId, status])
  @@index([status, graceExpiresAt])
  @@index([sumsubActionId])
  @@map("material_refresh_cycles")
}

model ClientRiskAssessment {
  id                          String   @id @default(cuid())
  assessmentNo                String   @unique
  customerId                  String
  customer                    CustomerMain @relation("CustomerRiskAssessments", fields: [customerId], references: [id])
  
  triggerType                 String
  triggeredAt                 DateTime @default(now())
  
  sumsubAmlCheckRequestedAt   DateTime?
  sumsubAmlCheckInspectionId  String?
  sumsubAmlReviewAnswer       String?
  sumsubAmlLabels             String?  // JSON string
  sumsubAmlRejectType         String?
  sumsubSnapshotAt            DateTime?
  sumsubRiskScore             Int?
  sumsubTags                  String?  // JSON string
  
  policyVersion               String
  resultingRiskTier           String?
  previousRiskTier            String?
  scoreSuggestedTier          String?
  recommendedAction           String?
  reasoning                   String?  // JSON string
  
  status                      String   @default("PENDING_SUMSUB_RESULT")
  signoffMethod               String?
  approvalCaseId              String?
  approvalCase                ApprovalCase? @relation("ClientRiskAssessmentApprovalCase", fields: [approvalCaseId], references: [id])
  signedBy                    String?
  signedAt                    DateTime?
  signedUnderPolicyVersion    String?
  
  sumsubInternalCaseRef       String?
  sumsubCaseFinalDecision     String?
  sumsubCaseDecidedAt         DateTime?
  
  triggeredRefreshCycles      MaterialRefreshCycle[] @relation("AssessmentTriggeredCycles")
  
  traceId                     String   @unique
  createdAt                   DateTime @default(now())
  
  @@index([customerId, status])
  @@index([customerId, triggeredAt])
  @@index([sumsubAmlCheckInspectionId])
  @@index([status, triggeredAt])
  @@map("client_risk_assessments")
}
```

- [ ] **Step 5: Validate schema + generate migration**

```bash
npx prisma validate
npx prisma migrate dev --name wave3_firm_driven_review --create-only
```

Review the generated `migration.sql`. If Prisma uses table-recreate for the rename (which risks losing FK constraints — see `docs/cleanup/deferred-refactors.md` gotcha #1), manually rewrite the migration to use native `ALTER TABLE RENAME COLUMN` + `ALTER TABLE ADD COLUMN` (SQLite 3.25+ supports both).

Minimal manual override (if needed):
```sql
ALTER TABLE "customer_main" RENAME COLUMN "latestFinalApprovalId" TO "latestRiskApprovalId";
ALTER TABLE "customer_main" RENAME COLUMN "latestFinalApprovalStatus" TO "latestRiskApprovalStatus";
ALTER TABLE "customer_main" ADD COLUMN "riskTier" TEXT NOT NULL DEFAULT 'LOW';
ALTER TABLE "customer_main" ADD COLUMN "riskTierUpdatedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "pepStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "customer_main" ADD COLUMN "pepConfirmedAt" DATETIME;
ALTER TABLE "customer_main" ADD COLUMN "latestRiskAssessmentId" TEXT;

-- (CREATE TABLE for 3 new tables: customer_material_holdings, material_refresh_cycles, client_risk_assessments)
-- (See Prisma-generated version, but ensure create order: client_risk_assessments first, then customer_material_holdings, then material_refresh_cycles to avoid FK forward-ref issues)
```

- [ ] **Step 6: Apply + regenerate client**

```bash
npx prisma migrate dev
```

- [ ] **Step 7: Sed the cascade rename in TypeScript sources**

```bash
find src -name "*.ts" -exec sed -i '' \
  -e 's/latestFinalApprovalId/latestRiskApprovalId/g' \
  -e 's/latestFinalApprovalStatus/latestRiskApprovalStatus/g' \
  -e 's/latestFinalApproval\b/latestRiskApproval/g' \
  {} +

find admin-web/src -name "*.tsx" -o -name "*.ts" | xargs sed -i '' \
  -e 's/latestFinalApprovalId/latestRiskApprovalId/g' \
  -e 's/latestFinalApprovalStatus/latestRiskApprovalStatus/g' \
  -e 's/latestFinalApproval\b/latestRiskApproval/g' \
  -e 's/FinalApprovalSummary/RiskApprovalSummary/g'
```

- [ ] **Step 8: Build + test**

```bash
npm run build 2>&1 | tail -20
npm test -- src/modules/identity/onboarding --runInBand 2>&1 | tail -20
(cd admin-web && npm run build 2>&1 | tail -10)
```

Expected: all builds succeed, existing onboarding tests pass.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma \
        prisma/migrations/20260409120000_wave3_firm_driven_review/ \
        src/modules/identity/onboarding/ \
        admin-web/src/
git commit -m "feat(schema): Wave 3 — 3 new tables + customer_main rename to latestRiskApproval"
```

### Task 1.2: Approval action type catalog additions

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/constants/approval.constants.ts`

- [ ] **Step 1: Add 3 new action type keys and default policies**

In `ApprovalActionTypes` const, add:
```typescript
  // ─── Wave 3 (2026-04-09) ─────────────────────
  RISK_RATING_MEDIUM_APPROVAL: 'RISK_RATING_MEDIUM_APPROVAL',
  RISK_RATING_HIGH_APPROVAL: 'RISK_RATING_HIGH_APPROVAL',
  PEP_RELATIONSHIP_APPROVAL: 'PEP_RELATIONSHIP_APPROVAL',
```

In `DEFAULT_APPROVAL_POLICIES`, add 3 new entries at the end:
```typescript
  [ApprovalActionTypes.RISK_RATING_MEDIUM_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['COMPLIANCE_OFFICER'],
    timeoutHours: 168,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.RISK_RATING_HIGH_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['MLRO'],
    timeoutHours: 168,
    allowCancel: true,
    allowRetry: true,
  },
  [ApprovalActionTypes.PEP_RELATIONSHIP_APPROVAL]: {
    riskLevel: ApprovalRiskLevels.HIGH,
    checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
    timeoutHours: 240,
    allowCancel: true,
    allowRetry: true,
  },
```

Update the top-of-file comment to note these are Wave 3 additions. Keep `ONBOARDING_FINAL_APPROVAL` in place (deprecation planned for later, not this plan).

- [ ] **Step 2: Run existing approval tests (non-regression)**

```bash
npm test -- src/modules/governance/approvals --runInBand
```

Expected: all existing tests pass (additive change).

- [ ] **Step 3: Commit**

```bash
git add src/modules/governance/approvals/constants/approval.constants.ts
git commit -m "feat(approvals): add 3 Wave 3 action types (RISK_RATING_MEDIUM/HIGH, PEP_RELATIONSHIP)"
```

### Task 1.3: Multi-step approval support in createCase/approve/reject

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.ts`

- [ ] **Step 1: Read current single-step implementation**

```bash
awk '/async createDraftCase/,/^  }/' src/modules/governance/approvals/approvals.service.ts | head -80
awk '/async approve/,/^  }/' src/modules/governance/approvals/approvals.service.ts | head -80
```

Note that `createDraftCase` currently creates a single step with all checker roles CSV-joined into one `checkerRoleCandidates`. `approve` hardcodes `stepNo: 1`.

- [ ] **Step 2: Change createDraftCase to emit one step per checker role**

Locate the `steps.create` object literal inside `createDraftCase` (around line 764). Replace:
```typescript
        steps: {
          create: {
            stepNo: 1,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: joinRoleCsv(policy.checkerRoles),
          },
        },
```
with:
```typescript
        steps: {
          create: policy.checkerRoles.map((role, idx) => ({
            stepNo: idx + 1,
            status: ApprovalStepStatuses.PENDING,
            checkerRoleCandidates: role,
          })),
        },
```

For single-role action types (CHANGE_TICKET_APPROVAL, etc.), `.map` produces a 1-element array identical to before — backward compatible.

- [ ] **Step 3: Rewrite approve() to advance through steps**

Replace the entire `async approve(...)` method with:

```typescript
  async approve(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.status !== ApprovalStatuses.PENDING) {
        throw new BadRequestException('Only PENDING approvals can be approved');
      }
      this.assertTraceConsistency(approval.traceId, dto.traceId);
      this.assertWorkflowContextConsistency(approval, dto);

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
      const now = new Date();

      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: currentStep.stepNo,
          },
        },
        data: {
          status: ApprovalStepStatuses.APPROVED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          decidedByRole: decisionRole,
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      // Check for any remaining pending steps with higher stepNo
      const hasNextPending = (approval.steps || []).some(
        (s: any) =>
          s.stepNo > currentStep.stepNo &&
          s.status === ApprovalStepStatuses.PENDING,
      );

      if (hasNextPending) {
        // Mid-flow: case stays PENDING, reload to get updated steps
        return tx.approvalCase.findUnique({
          where: { id: approval.id },
          include: this.approvalInclude(),
        }) as Promise<ApprovalCaseRow>;
      }

      // Last step: case APPROVED
      return tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.APPROVED,
          selectedCheckerRole: decisionRole,
          decisionByUserId: actor.userId,
          decisionByUserNo: this.normalizeOptionalString(actor.userNo),
          decisionByRole: decisionRole,
          decisionReason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
        include: this.approvalInclude(),
      }) as Promise<ApprovalCaseRow>;
    });

    await this.recordAudit(
      AuditActions.APPROVAL_APPROVED,
      updated,
      actor,
      AuditResult.SUCCESS,
      dto.reason || 'Approval approved',
      ApprovalStatuses.PENDING,
      updated.status === ApprovalStatuses.APPROVED
        ? ApprovalStatuses.APPROVED
        : ApprovalStatuses.PENDING,
    );
    if (updated.status === ApprovalStatuses.APPROVED) {
      await this.projectGovernanceApprovalDecision(updated);
      await this.emitApprovalEvent(ApprovalEvents.APPROVED, this.buildEventPayload(updated));
    }
    return this.mapApproval(updated, actor);
  }
```

- [ ] **Step 4: Rewrite reject() — any step rejection terminates the case**

Replace `async reject(...)` body with:

```typescript
  async reject(id: string, dto: DecisionApprovalDto, actor: ApprovalActorContext) {
    const updated = await this.prisma.$transaction(async (tx: any) => {
      const approval = await this.findCaseOrThrow(id, tx);
      if (approval.status !== ApprovalStatuses.PENDING) {
        throw new BadRequestException('Only PENDING approvals can be rejected');
      }
      this.assertTraceConsistency(approval.traceId, dto.traceId);
      this.assertWorkflowContextConsistency(approval, dto);

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
      const now = new Date();

      // Reject the current step
      await tx.approvalStep.update({
        where: {
          approvalCaseId_stepNo: {
            approvalCaseId: approval.id,
            stepNo: currentStep.stepNo,
          },
        },
        data: {
          status: ApprovalStepStatuses.REJECTED,
          decidedByUserId: actor.userId,
          decidedByUserNo: this.normalizeOptionalString(actor.userNo),
          decidedByRole: decisionRole,
          reason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
      });

      // Cancel any remaining pending steps
      await tx.approvalStep.updateMany({
        where: {
          approvalCaseId: approval.id,
          status: ApprovalStepStatuses.PENDING,
        },
        data: { status: ApprovalStepStatuses.CANCELLED },
      });

      // Case REJECTED immediately
      return tx.approvalCase.update({
        where: { id: approval.id },
        data: {
          status: ApprovalStatuses.REJECTED,
          selectedCheckerRole: decisionRole,
          decisionByUserId: actor.userId,
          decisionByUserNo: this.normalizeOptionalString(actor.userNo),
          decisionByRole: decisionRole,
          decisionReason: this.normalizeOptionalString(dto.reason),
          decidedAt: now,
        },
        include: this.approvalInclude(),
      }) as Promise<ApprovalCaseRow>;
    });

    await this.recordAudit(
      AuditActions.APPROVAL_REJECTED,
      updated,
      actor,
      AuditResult.SUCCESS,
      dto.reason || 'Approval rejected',
      ApprovalStatuses.PENDING,
      ApprovalStatuses.REJECTED,
    );
    await this.projectGovernanceApprovalDecision(updated);
    await this.emitApprovalEvent(ApprovalEvents.REJECTED, this.buildEventPayload(updated));
    return this.mapApproval(updated, actor);
  }
```

- [ ] **Step 5: Run existing approval tests**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts --runInBand
```

Existing single-step tests should still pass because the logic is equivalent for 1-step cases.

- [ ] **Step 6: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.ts
git commit -m "feat(approvals): multi-step createCase + approve + reject for PEP dual-sign"
```

### Task 1.4: Two multi-step integration tests

**Files:**
- Modify: `Exchange_js/src/modules/governance/approvals/approvals.service.spec.ts`

- [ ] **Step 1: Add 2 integration tests at the end of the root describe**

```typescript
describe('multi-step approval', () => {
  it('full 2-step dual-sign: MLRO approves step 1 → case PENDING, SENIOR approves step 2 → APPROVED', async () => {
    // Mock policy for PEP_RELATIONSHIP_APPROVAL
    (service as any).approvalPolicyService.getPolicy = jest.fn().mockResolvedValue({
      riskLevel: 'HIGH',
      checkerRoles: ['MLRO', 'SENIOR_MANAGEMENT_OFFICER'],
      timeoutHours: 240,
      allowCancel: true,
      allowRetry: true,
    });

    let caseRecord: any = {
      id: 'pep-case-1',
      actionType: 'PEP_RELATIONSHIP_APPROVAL',
      entityRef: 'client_risk_assessment:a1',
      status: 'PENDING',
      traceId: 'trace-pep-1',
      selectedCheckerRole: 'MLRO',
      createdByUserId: 'system',
      steps: [
        { id: 's1', stepNo: 1, status: 'PENDING', checkerRoleCandidates: 'MLRO' },
        { id: 's2', stepNo: 2, status: 'PENDING', checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER' },
      ],
    };

    prismaMock.approvalCase.findUnique = jest.fn().mockResolvedValue(caseRecord);
    prismaMock.approvalStep.update = jest.fn().mockImplementation(async ({ where, data }) => {
      const step = caseRecord.steps.find((s: any) => s.stepNo === where.approvalCaseId_stepNo.stepNo);
      if (step) Object.assign(step, data);
      return step;
    });
    prismaMock.approvalCase.update = jest.fn().mockImplementation(async ({ data }) => {
      Object.assign(caseRecord, data);
      return caseRecord;
    });

    // MLRO approves step 1
    const mlroActor = {
      actorType: 'ADMIN' as const, userId: 'mlro-1', userNo: 'M1',
      role: 'MLRO', roleCodes: ['MLRO'],
    };
    await service.approve('pep-case-1', { reason: 'mlro ok' } as any, mlroActor);

    expect(caseRecord.steps[0].status).toBe('APPROVED');
    expect(caseRecord.steps[1].status).toBe('PENDING');
    expect(caseRecord.status).toBe('PENDING'); // still mid-flow

    // SENIOR approves step 2 → case APPROVED
    const seniorActor = {
      actorType: 'ADMIN' as const, userId: 'senior-1', userNo: 'S1',
      role: 'SENIOR_MANAGEMENT_OFFICER', roleCodes: ['SENIOR_MANAGEMENT_OFFICER'],
    };
    await service.approve('pep-case-1', { reason: 'senior ok' } as any, seniorActor);

    expect(caseRecord.steps[1].status).toBe('APPROVED');
    expect(caseRecord.status).toBe('APPROVED');
  });

  it('reject on step 1 terminates the whole case and cancels remaining steps', async () => {
    let caseRecord: any = {
      id: 'pep-case-2',
      actionType: 'PEP_RELATIONSHIP_APPROVAL',
      entityRef: 'x',
      status: 'PENDING',
      traceId: 'trace-pep-2',
      selectedCheckerRole: 'MLRO',
      createdByUserId: 'system',
      steps: [
        { id: 's1', stepNo: 1, status: 'PENDING', checkerRoleCandidates: 'MLRO' },
        { id: 's2', stepNo: 2, status: 'PENDING', checkerRoleCandidates: 'SENIOR_MANAGEMENT_OFFICER' },
      ],
    };
    prismaMock.approvalCase.findUnique = jest.fn().mockResolvedValue(caseRecord);
    prismaMock.approvalStep.update = jest.fn().mockImplementation(async ({ where, data }) => {
      const step = caseRecord.steps.find((s: any) => s.stepNo === where.approvalCaseId_stepNo.stepNo);
      if (step) Object.assign(step, data);
      return step;
    });
    prismaMock.approvalStep.updateMany = jest.fn().mockImplementation(async ({ data }) => {
      caseRecord.steps.forEach((s: any) => {
        if (s.status === 'PENDING') Object.assign(s, data);
      });
      return { count: caseRecord.steps.length };
    });
    prismaMock.approvalCase.update = jest.fn().mockImplementation(async ({ data }) => {
      Object.assign(caseRecord, data);
      return caseRecord;
    });

    const mlroActor = {
      actorType: 'ADMIN' as const, userId: 'mlro-1', userNo: 'M1',
      role: 'MLRO', roleCodes: ['MLRO'],
    };

    await service.reject('pep-case-2', { reason: 'not acceptable' } as any, mlroActor);

    expect(caseRecord.steps[0].status).toBe('REJECTED');
    expect(caseRecord.steps[1].status).toBe('CANCELLED');
    expect(caseRecord.status).toBe('REJECTED');
  });
});
```

- [ ] **Step 2: Run new tests**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts -t "multi-step approval" --runInBand
```

Both tests must pass.

- [ ] **Step 3: Run full approvals test suite**

```bash
npm test -- src/modules/governance/approvals/approvals.service.spec.ts --runInBand
```

All existing tests must still pass.

- [ ] **Step 4: Commit**

```bash
git add src/modules/governance/approvals/approvals.service.spec.ts
git commit -m "test(approvals): add 2-step dual-sign integration tests"
```

**Phase 1 Complete.** Schema migrated, Wave 3 action types registered, approval kernel supports multi-step signoff.

---

## Phase 2: Layer 2 Client Risk Assessment

**Goal:** Policy JSON + pure `applyPolicy` function + `ClientRiskAssessmentService` with mock-first Sumsub calls + quarterly cron.

### Task 2.1: Policy JSON + `applyPolicy` pure function with exhaustive tests

**Files:**
- Create: `Exchange_js/config/client-risk-assessment-policy.json`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/policy/policy-loader.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts`

- [ ] **Step 1: Create the policy JSON file**

```bash
mkdir -p config
```

Write `config/client-risk-assessment-policy.json`:

```json
{
  "version": "1.0.0",
  "effectiveFrom": "2026-04-09",
  "assessmentFrequencyDays": {
    "LOW": 90,
    "MEDIUM": 90,
    "HIGH": 90
  },
  "tierMappingRules": [
    { "priority": 1, "condition": "labels_contains_SANCTIONS", "tier": "HIGH", "action": "ESCALATE_TO_SUMSUB_CASE", "immediateEffect": "FREEZE", "signoffMethod": "ESCALATED" },
    { "priority": 2, "condition": "labels_contains_PEP", "tier": "HIGH", "action": "PEP_REVIEW", "immediateEffect": "RESTRICT", "signoffMethod": "DUAL_MLRO_SENIOR" },
    { "priority": 3, "condition": "labels_contains_ADVERSE_MEDIA", "tier": "HIGH", "action": "MANUAL_REVIEW", "signoffMethod": "MANUAL_MLRO" },
    { "priority": 4, "condition": "red_other", "tier": "KEEP_PREVIOUS", "action": "MANUAL_REVIEW", "signoffMethod": "MANUAL_MLRO" },
    { "priority": 5, "condition": "any_required_material_stale", "tier": "UNKNOWN", "action": "REQUEST_REFRESH", "signoffMethod": "MANUAL_MLRO" },
    { "priority": 6, "condition": "green_stable", "tier": "LOW", "action": "REAFFIRM", "signoffMethod": "AUTO_R2" }
  ],
  "signoffActionTypeMap": {
    "MANUAL_COMPLIANCE_OFFICER": "RISK_RATING_MEDIUM_APPROVAL",
    "MANUAL_MLRO": "RISK_RATING_HIGH_APPROVAL",
    "DUAL_MLRO_SENIOR": "PEP_RELATIONSHIP_APPROVAL"
  },
  "tierLevelConstraint": {
    "LOW": ["wave3-level-1"],
    "MEDIUM": ["wave3-level-1", "wave3-level-2"],
    "HIGH": ["wave3-level-2"]
  },
  "frozenCustomersSkipLevelSync": true,
  "downgradeForbidden": true
}
```

- [ ] **Step 2: Create policy-loader.ts**

Create `src/modules/identity/client-risk-assessment/policy/policy-loader.ts`:

```typescript
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface PolicyRule {
  priority: number;
  condition: string;
  tier: string;
  action: string;
  immediateEffect?: string;
  signoffMethod: string;
}

export interface ClientRiskAssessmentPolicy {
  version: string;
  effectiveFrom: string;
  assessmentFrequencyDays: Record<string, number>;
  tierMappingRules: PolicyRule[];
  signoffActionTypeMap: Record<string, string>;
  tierLevelConstraint: Record<string, string[]>;
  frozenCustomersSkipLevelSync: boolean;
  downgradeForbidden: boolean;
}

@Injectable()
export class ClientRiskAssessmentPolicyLoader {
  private cachedPolicy: ClientRiskAssessmentPolicy | null = null;

  getPolicy(): ClientRiskAssessmentPolicy {
    if (this.cachedPolicy) return this.cachedPolicy;
    const configPath = path.resolve(process.cwd(), 'config/client-risk-assessment-policy.json');
    const raw = fs.readFileSync(configPath, 'utf8');
    this.cachedPolicy = JSON.parse(raw) as ClientRiskAssessmentPolicy;
    return this.cachedPolicy;
  }

  reload(): void {
    this.cachedPolicy = null;
  }
}
```

- [ ] **Step 3: Write the failing spec for applyPolicy**

Create `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts`:

```typescript
import { applyPolicy, PolicyInput } from './client-risk-assessment-policy';
import { ClientRiskAssessmentPolicyLoader } from './policy-loader';

describe('applyPolicy', () => {
  const policy = new ClientRiskAssessmentPolicyLoader().getPolicy();

  function makeInput(overrides: Partial<PolicyInput> = {}): PolicyInput {
    return {
      amlAnswer: 'GREEN',
      amlLabels: [],
      holdings: [],
      previousTier: 'LOW',
      previousPepStatus: 'NONE',
      ...overrides,
    };
  }

  it('P1 sanctions: → HIGH + FREEZE + ESCALATED', () => {
    const r = applyPolicy(makeInput({ amlAnswer: 'RED', amlLabels: ['SANCTIONS_UN'] }), policy);
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('ESCALATED');
    expect(r.immediateEffect).toBe('FREEZE');
    expect(r.matchedRule).toBe(1);
  });

  it('P1 > P2: sanctions + PEP both present → sanctions wins', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['SANCTIONS_UN', 'PEP_CLASS_1'] }),
      policy,
    );
    expect(r.matchedRule).toBe(1);
  });

  it('P2 PEP: → HIGH + RESTRICT + DUAL_MLRO_SENIOR', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['PEP_CLASS_1_DOMESTIC'] }),
      policy,
    );
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('DUAL_MLRO_SENIOR');
    expect(r.immediateEffect).toBe('RESTRICT');
    expect(r.matchedRule).toBe(2);
  });

  it('P3 adverse media: → HIGH + MANUAL_MLRO', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['ADVERSE_MEDIA_FRAUD'] }),
      policy,
    );
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('MANUAL_MLRO');
    expect(r.matchedRule).toBe(3);
  });

  it('P4 red_other: keeps previous tier + MANUAL_MLRO', () => {
    const r = applyPolicy(
      makeInput({ amlAnswer: 'RED', amlLabels: ['OTHER_FLAG'], previousTier: 'MEDIUM' }),
      policy,
    );
    expect(r.resultingTier).toBe('MEDIUM');
    expect(r.signoffMethod).toBe('MANUAL_MLRO');
    expect(r.matchedRule).toBe(4);
  });

  it('P5 stale material: → UNKNOWN + REQUEST_REFRESH', () => {
    const r = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [{ materialType: 'PROOF_OF_ADDRESS', status: 'EXPIRED', expiresAt: new Date(2026, 0, 1) }],
      }),
      policy,
    );
    expect(r.resultingTier).toBe('UNKNOWN');
    expect(r.recommendedAction).toBe('REQUEST_REFRESH');
    expect(r.matchedRule).toBe(5);
  });

  it('P6 green stable LOW → LOW AUTO_R2', () => {
    const r = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [{ materialType: 'PROOF_OF_ADDRESS', status: 'FRESH', expiresAt: new Date(2099, 0, 1) }],
        previousTier: 'LOW',
      }),
      policy,
    );
    expect(r.resultingTier).toBe('LOW');
    expect(r.signoffMethod).toBe('AUTO_R2');
    expect(r.matchedRule).toBe(6);
  });

  it('downgradeForbidden: HIGH previous + green stable → keep HIGH + MANUAL_MLRO', () => {
    const r = applyPolicy(
      makeInput({
        amlAnswer: 'GREEN',
        holdings: [{ materialType: 'PROOF_OF_ADDRESS', status: 'FRESH', expiresAt: new Date(2099, 0, 1) }],
        previousTier: 'HIGH',
      }),
      policy,
    );
    expect(r.resultingTier).toBe('HIGH');
    expect(r.signoffMethod).toBe('MANUAL_MLRO');
    expect(r.scoreSuggestedTier).toBe('LOW');
  });
});
```

- [ ] **Step 4: Run (should fail — module not created)**

```bash
mkdir -p src/modules/identity/client-risk-assessment/policy
npm test -- src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts --runInBand
```

Expected: FAIL with "Cannot find module './client-risk-assessment-policy'"

- [ ] **Step 5: Implement applyPolicy**

Create `src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.ts`:

```typescript
import { ClientRiskAssessmentPolicy } from './policy-loader';

export interface PolicyInput {
  amlAnswer: 'GREEN' | 'RED';
  amlLabels: string[];
  holdings: Array<{
    materialType: string;
    status: string;
    expiresAt: Date | null;
  }>;
  previousTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  previousPepStatus: 'NONE' | 'CONFIRMED' | 'CLEARED';
}

export interface PolicyOutput {
  resultingTier: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
  scoreSuggestedTier?: string;
  recommendedAction: string;
  signoffMethod: string;
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

export function applyPolicy(
  input: PolicyInput,
  policy: ClientRiskAssessmentPolicy,
): PolicyOutput {
  const sorted = [...policy.tierMappingRules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (!matchesCondition(rule.condition, input)) continue;

    let resultingTier = rule.tier as PolicyOutput['resultingTier'];
    let scoreSuggestedTier: string | undefined;
    let downgradeBlocked = false;

    if (rule.tier === 'KEEP_PREVIOUS') {
      resultingTier = input.previousTier;
    }

    if (
      policy.downgradeForbidden &&
      input.previousTier === 'HIGH' &&
      resultingTier !== 'HIGH' &&
      resultingTier !== 'UNKNOWN'
    ) {
      scoreSuggestedTier = resultingTier;
      resultingTier = 'HIGH';
      downgradeBlocked = true;
    }

    let signoffMethod = rule.signoffMethod;
    if (downgradeBlocked && signoffMethod === 'AUTO_R2') {
      signoffMethod = 'MANUAL_MLRO';
    }

    return {
      resultingTier,
      scoreSuggestedTier,
      recommendedAction: rule.action,
      signoffMethod,
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
  }

  throw new Error('No policy rule matched — this should be impossible with priority 6 fallback');
}

function matchesCondition(condition: string, input: PolicyInput): boolean {
  switch (condition) {
    case 'labels_contains_SANCTIONS':
      return input.amlLabels.some((l) => l.startsWith('SANCTIONS_'));
    case 'labels_contains_PEP':
      return input.amlLabels.some((l) => l.startsWith('PEP_'));
    case 'labels_contains_ADVERSE_MEDIA':
      return input.amlLabels.some((l) => l.startsWith('ADVERSE_MEDIA'));
    case 'red_other':
      return input.amlAnswer === 'RED';
    case 'any_required_material_stale':
      return input.holdings.some(
        (h) => h.status === 'EXPIRED' || h.status === 'MISSING',
      );
    case 'green_stable':
      return input.amlAnswer === 'GREEN';
    default:
      return false;
  }
}
```

- [ ] **Step 6: Run tests — all 8 should pass**

```bash
npm test -- src/modules/identity/client-risk-assessment/policy/client-risk-assessment-policy.spec.ts --runInBand
```

Expected: 8 PASS.

- [ ] **Step 7: Commit**

```bash
git add config/client-risk-assessment-policy.json \
        src/modules/identity/client-risk-assessment/policy/
git commit -m "feat(client-risk-assessment): policy JSON + applyPolicy pure function with full test coverage"
```

### Task 2.2: ClientRiskAssessmentService + mock-first SumsubClient methods

**Files:**
- Modify: `Exchange_js/src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`

- [ ] **Step 1: Extend SumsubClient with mock-first methods**

In `sumsub.client.ts`, add these methods to the `SumsubClient` class:

```typescript
  async runAmlCheck(applicantId: string): Promise<{ ok: number; inspectionId: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      const { randomUUID } = await import('crypto');
      return { ok: 1, inspectionId: `mock-insp-${randomUUID()}` };
    }
    return this.post(`/resources/applicants/${applicantId}/aml/check`, {});
  }

  async getApplicant(applicantId: string): Promise<any> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      return {
        id: applicantId,
        info: { idDocs: [] },
        riskLabels: [],
        tags: [],
        totalScore: null,
      };
    }
    return this.get(`/resources/applicants/${applicantId}/one`);
  }

  async createApplicantAction(input: {
    applicantId: string;
    levelName: string;
  }): Promise<{ id: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      const { randomUUID } = await import('crypto');
      return { id: `mock-action-${randomUUID()}` };
    }
    return this.post(
      `/resources/applicantActions/-/forApplicant/${input.applicantId}?levelName=${encodeURIComponent(input.levelName)}`,
      {},
    );
  }

  async createActionSdkToken(input: {
    applicantId: string;
    levelName: string;
    ttlInSecs?: number;
  }): Promise<{ token: string }> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      return { token: `mock-sdk-token-${input.applicantId}-${Date.now()}` };
    }
    return this.post('/resources/accessTokens/sdk', {
      userId: input.applicantId,
      levelName: input.levelName,
      ttlInSecs: input.ttlInSecs ?? 600,
    });
  }

  async moveToLevel(
    applicantId: string,
    levelName: string,
    docSets?: any[],
  ): Promise<any> {
    if (process.env.SUMSUB_MOCK_MODE === 'true') {
      return { ok: 1, levelName };
    }
    return this.post(
      `/resources/applicants/${applicantId}/moveToLevel?name=${encodeURIComponent(levelName)}`,
      docSets ? { docSets } : {},
    );
  }
```

- [ ] **Step 2: Create the service file**

Create `src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts`:

```typescript
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { ApprovalsService } from '../../governance/approvals/approvals.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { applyPolicy, PolicyInput, PolicyOutput } from './policy/client-risk-assessment-policy';

export type AssessmentTriggerType =
  | 'INITIAL_ONBOARDING'
  | 'SCHEDULED_QUARTERLY'
  | 'SUMSUB_AML_HIT'
  | 'MLRO_MANUAL';

@Injectable()
export class ClientRiskAssessmentService {
  /** Property-injected in module to avoid circular deps */
  materialRefreshService?: { recomputeHoldingsForCustomer: (id: string, tier: string) => Promise<any> };

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly approvalsService: ApprovalsService,
    private readonly policyLoader: ClientRiskAssessmentPolicyLoader,
  ) {}

  /** Main entry — triggers fresh /aml/check and creates pending assessment */
  async startAssessment(input: {
    customerId: string;
    triggerType: Exclude<AssessmentTriggerType, 'INITIAL_ONBOARDING'>;
    triggeredBy?: string;
    triggeredContext?: Record<string, any>;
  }): Promise<any> {
    // Idempotency
    const existing = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: input.customerId, status: 'PENDING_SUMSUB_RESULT' },
    });
    if (existing) return existing;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = await this.generateAssessmentNo();
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

  /** For onboarding completion: uses known AML result, no /aml/check call */
  async recordAssessmentFromKnownAmlResult(input: {
    customerId: string;
    knownAmlResult: { reviewAnswer: 'GREEN' | 'RED'; rejectLabels?: string[] };
    snapshot: any;
  }): Promise<any> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) throw new Error(`Customer ${input.customerId} not found`);

    const policy = this.policyLoader.getPolicy();
    const assessmentNo = await this.generateAssessmentNo();
    const traceId = `CLIENT_RISK_ASSESSMENT:${randomUUID()}`;

    const assessment = await this.prisma.clientRiskAssessment.create({
      data: {
        assessmentNo,
        customerId: input.customerId,
        triggerType: 'INITIAL_ONBOARDING',
        policyVersion: policy.version,
        previousRiskTier: customer.riskTier,
        status: 'PENDING_SUMSUB_RESULT',
        sumsubSnapshotAt: new Date(),
        sumsubAmlReviewAnswer: input.knownAmlResult.reviewAnswer,
        sumsubAmlLabels: JSON.stringify(input.knownAmlResult.rejectLabels || []),
        traceId,
      },
    });

    // Directly advance through the same pipeline as webhook handler
    return this.processAssessmentResult(assessment.id, {
      reviewAnswer: input.knownAmlResult.reviewAnswer,
      rejectLabels: input.knownAmlResult.rejectLabels || [],
    });
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

  /** Shared post-AML processing — applies policy, routes signoff */
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

    // Fetch snapshot
    const snapshot = customer.sumsubApplicantId
      ? await this.sumsubClient.getApplicant(customer.sumsubApplicantId)
      : { tags: [], totalScore: null };

    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId: customer.id },
    });

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

  private async routeSignoff(
    assessmentId: string,
    customer: any,
    output: PolicyOutput,
  ): Promise<void> {
    const policy = this.policyLoader.getPolicy();

    if (output.signoffMethod === 'AUTO_R2') {
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

    // Apply immediate effects (RESTRICT for PEP)
    if (output.immediateEffect === 'RESTRICT') {
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: {
          restrictionStatus: 'RESTRICTED',
          restrictionReason: 'pep_review_pending',
          pepStatus: 'CONFIRMED',
          pepConfirmedAt: new Date(),
        },
      });
    }

    const actionType = policy.signoffActionTypeMap[output.signoffMethod];
    if (!actionType) {
      console.error(`No action type mapping for signoff method ${output.signoffMethod}`);
      return;
    }

    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: assessmentId },
    });
    const approvalCase = await this.approvalsService.create(
      {
        actionType,
        entityRef: `client_risk_assessment:${assessmentId}`,
        traceId: assessment!.traceId,
        metadata: {
          assessmentId,
          resultingTier: output.resultingTier,
          reasoning: output.reasoning,
        },
      } as any,
      { actorType: 'ADMIN', userId: 'SYSTEM', roleCodes: ['SUPER_ADMIN'] } as any,
    );

    await this.prisma.clientRiskAssessment.update({
      where: { id: assessmentId },
      data: { status: 'PENDING_SIGNATURE', approvalCaseId: approvalCase.id },
    });
  }

  async handleSignoffComplete(
    assessmentId: string,
    approvalCase: { status: string },
  ): Promise<void> {
    if (approvalCase.status === 'APPROVED') {
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: {
          status: 'SIGNED',
          signedAt: new Date(),
        },
      });
      await this.postSignoffCascade(assessmentId);
    } else if (approvalCase.status === 'REJECTED') {
      const assessment = await this.prisma.clientRiskAssessment.findUnique({
        where: { id: assessmentId },
      });
      if (!assessment) return;

      // For PEP rejection: offboard the customer
      await this.prisma.customerMain.update({
        where: { id: assessment.customerId },
        data: {
          onboardingStatus: 'REJECTED',
          operatingStatus: 'INACTIVE',
          pepStatus: 'CLEARED',
        },
      });
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessmentId },
        data: { status: 'SIGNED', signedAt: new Date() },
      });
    }
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
    const tierChanged = assessment.resultingRiskTier && assessment.resultingRiskTier !== customer.riskTier;

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

    // Trigger Layer 3 recompute
    if (tierChanged && this.materialRefreshService) {
      try {
        await this.materialRefreshService.recomputeHoldingsForCustomer(
          customer.id,
          assessment.resultingRiskTier!,
        );
      } catch (err) {
        console.error(`Layer 3 recompute failed for ${customer.id}:`, err);
      }
    }
  }

  private async generateAssessmentNo(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.clientRiskAssessment.count({
      where: { assessmentNo: { startsWith: `CRA-${year}-` } },
    });
    return `CRA-${year}-${String(count + 1).padStart(5, '0')}`;
  }
}
```

- [ ] **Step 3: Build to verify TypeScript compiles**

```bash
npm run build 2>&1 | tail -20
```

Expected: success. If the service compiles cleanly we skip unit tests here — the service will be exercised end-to-end via the simulation controller in Phase 6.

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/onboarding/providers/sumsub/sumsub.client.ts \
        src/modules/identity/client-risk-assessment/client-risk-assessment.service.ts
git commit -m "feat(client-risk-assessment): service with mock-first Sumsub integration"
```

### Task 2.3: Quarterly cron + admin trigger controller + module

**Files:**
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment-cron.service.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.controller.ts`
- Create: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`
- Modify: `Exchange_js/src/app.module.ts`

- [ ] **Step 1: Create cron service**

```typescript
// client-risk-assessment-cron.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';

@Injectable()
export class ClientRiskAssessmentCronService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly assessmentService: ClientRiskAssessmentService,
    private readonly policyLoader: ClientRiskAssessmentPolicyLoader,
  ) {}

  @Cron('7 3 1 * *')  // 1st of every month, 03:07 UTC
  async runQuarterlyAssessment(): Promise<void> {
    const policy = this.policyLoader.getPolicy();
    const frequencyDays = policy.assessmentFrequencyDays.LOW || 90;
    const cutoff = new Date(Date.now() - frequencyDays * 24 * 60 * 60 * 1000);

    const dueCustomers = await this.prisma.customerMain.findMany({
      where: {
        onboardingStatus: 'APPROVED',
        OR: [
          { latestRiskAssessmentId: null },
          {
            riskAssessments: {
              some: { status: 'SIGNED', signedAt: { lt: cutoff } },
            },
          },
        ],
      },
      select: { id: true },
      take: 500,
    });

    for (const customer of dueCustomers) {
      try {
        await this.assessmentService.startAssessment({
          customerId: customer.id,
          triggerType: 'SCHEDULED_QUARTERLY',
        });
      } catch (err) {
        console.error(`Failed quarterly assessment for ${customer.id}:`, err);
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
```

- [ ] **Step 2: Create admin controller**

```typescript
// client-risk-assessment.controller.ts
import { Controller, Post, Param, Body, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';

@ApiTags('Admin - Client Risk Assessment')
@Controller('admin/compliance/customers/:customerId/risk-assessment')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ClientRiskAssessmentController {
  constructor(private readonly service: ClientRiskAssessmentService) {}

  @Post('trigger')
  async triggerManual(
    @Param('customerId') customerId: string,
    @Body() body: { reason?: string },
    @Req() req: any,
  ) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
    return this.service.startAssessment({
      customerId,
      triggerType: 'MLRO_MANUAL',
      triggeredBy: req.user.userId,
      triggeredContext: { reason: body.reason },
    });
  }
}
```

- [ ] **Step 3: Create module**

```typescript
// client-risk-assessment.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentCronService } from './client-risk-assessment-cron.service';
import { ClientRiskAssessmentController } from './client-risk-assessment.controller';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    ApprovalsModule,
  ],
  providers: [
    ClientRiskAssessmentService,
    ClientRiskAssessmentCronService,
    ClientRiskAssessmentPolicyLoader,
  ],
  controllers: [ClientRiskAssessmentController],
  exports: [ClientRiskAssessmentService],
})
export class ClientRiskAssessmentModule {}
```

- [ ] **Step 4: Register in app.module.ts**

Add to `src/app.module.ts` imports array:
```typescript
import { ClientRiskAssessmentModule } from './modules/identity/client-risk-assessment/client-risk-assessment.module';
// ... in imports: [..., ClientRiskAssessmentModule],
```

- [ ] **Step 5: Build**

```bash
npm run build 2>&1 | tail -20
```

Expected: success.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/client-risk-assessment/ src/app.module.ts
git commit -m "feat(client-risk-assessment): quarterly cron + admin trigger + module wiring"
```

**Phase 2 Complete.** Layer 2 backend fully wired with mock Sumsub.

---

## Phase 3: Layer 3 Material Refresh

**Goal:** Policy JSON + pure functions + `MaterialRefreshService` + daily cron + customer SDK token endpoint.

### Task 3.1: Policy JSON + pure functions

**Files:**
- Create: `Exchange_js/config/material-refresh-policy.json`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/material-refresh-policy.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/compute-stage.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/compute-stage.spec.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/policy/get-required-materials.ts`

- [ ] **Step 1: Create policy JSON**

Write `config/material-refresh-policy.json`:

```json
{
  "version": "1.0.0",
  "effectiveFrom": "2026-04-09",
  "stages": [
    { "daysFromExpiry": -30, "action": "CREATE_CYCLE_NUDGE_ONLY" },
    { "daysFromExpiry": -7, "action": "ESCALATE_URGENT" },
    { "daysFromExpiry": 0, "action": "ENFORCE_RESTRICTION" },
    { "daysFromExpiry": 30, "action": "TERMINATE_CYCLE_OFFBOARD" }
  ],
  "materials": {
    "EMIRATES_ID": {
      "managementMode": "SUMSUB_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubIdDocSetType": "IDENTITY",
      "sumsubActionLevelName": "wave3-action-id-refresh",
      "enforceRestriction": true
    },
    "PASSPORT": {
      "managementMode": "SUMSUB_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubIdDocSetType": "IDENTITY",
      "sumsubActionLevelName": "wave3-action-id-refresh",
      "enforceRestriction": true,
      "alternativeOf": "EMIRATES_ID"
    },
    "PROOF_OF_ADDRESS": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["LOW", "MEDIUM", "HIGH"],
      "sumsubActionLevelName": "wave3-action-poa-refresh",
      "windowDays": { "LOW": 365, "MEDIUM": 270, "HIGH": 180 },
      "initialCollectionWindowDays": { "MEDIUM": 21, "HIGH": 14 },
      "enforceRestriction": true
    },
    "SOURCE_OF_FUNDS": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["MEDIUM", "HIGH"],
      "sumsubActionLevelName": "wave3-action-sof-refresh",
      "windowDays": { "MEDIUM": 540, "HIGH": 365 },
      "initialCollectionWindowDays": { "MEDIUM": 21, "HIGH": 14 },
      "enforceRestriction": true
    },
    "SOURCE_OF_WEALTH": {
      "managementMode": "SELF_MANAGED",
      "requiredForTiers": ["HIGH"],
      "sumsubActionLevelName": "wave3-action-sow-refresh",
      "windowDays": { "HIGH": 730 },
      "initialCollectionWindowDays": { "HIGH": 14 },
      "enforceRestriction": true
    }
  }
}
```

- [ ] **Step 2: Create policy loader**

```typescript
// material-refresh-policy.ts
import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface MaterialConfig {
  managementMode: 'SUMSUB_MANAGED' | 'SELF_MANAGED';
  requiredForTiers: string[];
  sumsubIdDocSetType?: string;
  sumsubActionLevelName: string;
  windowDays?: Record<string, number>;
  initialCollectionWindowDays?: Record<string, number>;
  enforceRestriction: boolean;
  alternativeOf?: string;
}

export interface MaterialRefreshPolicy {
  version: string;
  effectiveFrom: string;
  stages: Array<{ daysFromExpiry: number; action: string }>;
  materials: Record<string, MaterialConfig>;
}

@Injectable()
export class MaterialRefreshPolicyLoader {
  private cached: MaterialRefreshPolicy | null = null;

  getPolicy(): MaterialRefreshPolicy {
    if (this.cached) return this.cached;
    const configPath = path.resolve(process.cwd(), 'config/material-refresh-policy.json');
    this.cached = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return this.cached!;
  }

  getMaterialConfig(materialType: string): MaterialConfig | null {
    return this.getPolicy().materials[materialType] || null;
  }

  reload(): void {
    this.cached = null;
  }
}
```

- [ ] **Step 3: Write failing spec for computeStage**

```typescript
// compute-stage.spec.ts
import { computeStage } from './compute-stage';

describe('computeStage', () => {
  it('FRESH when > 30 days before expiry', () => {
    expect(computeStage(60)).toBe('FRESH');
    expect(computeStage(31)).toBe('FRESH');
  });

  it('NOTIFIED when 7 < days <= 30', () => {
    expect(computeStage(30)).toBe('NOTIFIED');
    expect(computeStage(8)).toBe('NOTIFIED');
  });

  it('URGENT when 0 < days <= 7', () => {
    expect(computeStage(7)).toBe('URGENT');
    expect(computeStage(1)).toBe('URGENT');
  });

  it('BLOCKING when -30 < days <= 0', () => {
    expect(computeStage(0)).toBe('BLOCKING');
    expect(computeStage(-10)).toBe('BLOCKING');
    expect(computeStage(-29)).toBe('BLOCKING');
  });

  it('GRACE_EXPIRED when days <= -30', () => {
    expect(computeStage(-30)).toBe('GRACE_EXPIRED');
    expect(computeStage(-100)).toBe('GRACE_EXPIRED');
  });
});
```

- [ ] **Step 4: Run (should fail)**

```bash
mkdir -p src/modules/identity/material-refresh/policy
npm test -- src/modules/identity/material-refresh/policy/compute-stage.spec.ts --runInBand
```

Expected: FAIL — module doesn't exist.

- [ ] **Step 5: Implement computeStage**

```typescript
// compute-stage.ts
export type Stage = 'FRESH' | 'NOTIFIED' | 'URGENT' | 'BLOCKING' | 'GRACE_EXPIRED';

export function computeStage(daysFromExpiry: number): Stage {
  if (daysFromExpiry > 30) return 'FRESH';
  if (daysFromExpiry > 7) return 'NOTIFIED';
  if (daysFromExpiry > 0) return 'URGENT';
  if (daysFromExpiry > -30) return 'BLOCKING';
  return 'GRACE_EXPIRED';
}
```

- [ ] **Step 6: Implement getRequiredMaterialsForTier**

```typescript
// get-required-materials.ts
import { MaterialRefreshPolicy } from './material-refresh-policy';

export function getRequiredMaterialsForTier(
  tier: string,
  policy: MaterialRefreshPolicy,
): string[] {
  const required: string[] = [];
  for (const [materialType, config] of Object.entries(policy.materials)) {
    if (config.alternativeOf) continue;  // skip alternatives (PASSPORT is alt of EMIRATES_ID)
    if (config.requiredForTiers.includes(tier)) {
      required.push(materialType);
    }
  }
  return required;
}
```

- [ ] **Step 7: Run tests**

```bash
npm test -- src/modules/identity/material-refresh/policy --runInBand
```

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add config/material-refresh-policy.json src/modules/identity/material-refresh/policy/
git commit -m "feat(material-refresh): policy JSON + computeStage + getRequiredMaterialsForTier"
```

### Task 3.2: MaterialRefreshService core methods

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/material-refresh.service.ts`

- [ ] **Step 1: Implement the full service in one pass**

```typescript
// material-refresh.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { getRequiredMaterialsForTier } from './policy/get-required-materials';

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

@Injectable()
export class MaterialRefreshService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
    private readonly policyLoader: MaterialRefreshPolicyLoader,
  ) {}

  async enterNotifiedStage(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding || holding.activeRefreshCycleId) return;

    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (!materialConfig) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: holding.customerId },
    });
    if (!customer?.sumsubApplicantId) return;

    const cycleNo = await this.generateCycleNo();
    const cycle = await this.prisma.materialRefreshCycle.create({
      data: {
        cycleNo,
        customerId: holding.customerId,
        holdingId: holding.id,
        materialType: holding.materialType,
        status: 'PENDING_CUSTOMER_EVIDENCE',
        stage: 'NUDGE_ONLY',
        triggerType: 'SCHEDULED_EXPIRY',
        stageNudgeAt: new Date(),
        graceExpiresAt: addDays(holding.expiresAt || new Date(), 30),
        traceId: `MATERIAL_REFRESH:${randomUUID()}`,
      },
    });

    try {
      const action = await this.sumsubClient.createApplicantAction({
        applicantId: customer.sumsubApplicantId,
        levelName: materialConfig.sumsubActionLevelName,
      });
      await this.prisma.materialRefreshCycle.update({
        where: { id: cycle.id },
        data: {
          sumsubActionId: action.id,
          sumsubActionLevelName: materialConfig.sumsubActionLevelName,
          sumsubActionCreatedAt: new Date(),
        },
      });
    } catch (err) {
      console.error(`Failed to create Sumsub action for cycle ${cycle.id}:`, err);
    }

    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: { activeRefreshCycleId: cycle.id, status: 'REFRESH_IN_PROGRESS' },
    });
  }

  async escalateToUrgent(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding?.activeRefreshCycleId) {
      return this.enterNotifiedStage(holdingId);
    }
    await this.prisma.materialRefreshCycle.update({
      where: { id: holding.activeRefreshCycleId },
      data: { stage: 'URGENT', stageUrgentAt: new Date() },
    });
  }

  async enterBlockingStage(holdingId: string): Promise<void> {
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: holdingId },
    });
    if (!holding) return;
    if (!holding.activeRefreshCycleId) {
      await this.enterNotifiedStage(holdingId);
      return this.enterBlockingStage(holdingId);
    }

    await this.prisma.materialRefreshCycle.update({
      where: { id: holding.activeRefreshCycleId },
      data: { stage: 'BLOCKING', stageBlockingAt: new Date() },
    });

    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    if (materialConfig?.enforceRestriction) {
      await this.prisma.customerMain.update({
        where: { id: holding.customerId },
        data: {
          restrictionStatus: 'RESTRICTED',
          restrictionReason: `material_expired:${holding.materialType}`,
        },
      });
    }

    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: { status: 'EXPIRED' },
    });
  }

  async terminateCycle(cycleId: string, reason: string): Promise<void> {
    const cycle = await this.prisma.materialRefreshCycle.findFirst({
      where: { id: cycleId, status: 'PENDING_CUSTOMER_EVIDENCE' },
    });
    if (!cycle) return;

    await this.prisma.materialRefreshCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        resolutionReason: reason,
      },
    });

    await this.prisma.customerMain.update({
      where: { id: cycle.customerId },
      data: {
        onboardingStatus: 'WITHDRAWN',
        operatingStatus: 'INACTIVE',
      },
    });

    await this.prisma.customerMaterialHolding.updateMany({
      where: { activeRefreshCycleId: cycle.id },
      data: { activeRefreshCycleId: null, status: 'EXPIRED' },
    });
  }

  async handleSumsubActionResult(event: {
    actionId: string;
    reviewResult: { reviewAnswer: 'GREEN' | 'RED'; reviewRejectType?: string };
  }): Promise<void> {
    const cycle = await this.prisma.materialRefreshCycle.findFirst({
      where: { sumsubActionId: event.actionId, status: 'PENDING_CUSTOMER_EVIDENCE' },
    });
    if (!cycle) return;

    // RED leaves cycle pending for retry
    if (event.reviewResult.reviewAnswer === 'RED') return;

    // GREEN: close cycle and refresh holding
    const holding = await this.prisma.customerMaterialHolding.findUnique({
      where: { id: cycle.holdingId },
    });
    if (!holding) return;

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: holding.customerId },
    });
    if (!customer) return;

    const materialConfig = this.policyLoader.getMaterialConfig(holding.materialType);
    let newExpiresAt: Date | null = null;

    if (holding.managementMode === 'SUMSUB_MANAGED' && customer.sumsubApplicantId) {
      const snapshot = await this.sumsubClient.getApplicant(customer.sumsubApplicantId);
      const idDoc = (snapshot as any).info?.idDocs?.find(
        (d: any) => this.mapSumsubDocToMaterialType(d) === holding.materialType,
      );
      if (idDoc?.validUntil) newExpiresAt = new Date(idDoc.validUntil);
    } else if (holding.managementMode === 'SELF_MANAGED' && materialConfig?.windowDays) {
      const days = materialConfig.windowDays[customer.riskTier as string];
      if (days) newExpiresAt = addDays(new Date(), days);
    }

    await this.prisma.customerMaterialHolding.update({
      where: { id: holding.id },
      data: {
        verifiedAt: new Date(),
        expiresAt: newExpiresAt,
        status: 'FRESH',
        activeRefreshCycleId: null,
      },
    });

    await this.prisma.materialRefreshCycle.update({
      where: { id: cycle.id },
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
        resolutionReason: 'customer_refreshed',
      },
    });

    // Release restriction if this cycle caused it
    if (
      customer.restrictionStatus === 'RESTRICTED' &&
      customer.restrictionReason === `material_expired:${holding.materialType}`
    ) {
      await this.prisma.customerMain.update({
        where: { id: customer.id },
        data: { restrictionStatus: 'CLEAR', restrictionReason: null },
      });
    }
  }

  async handleSumsubDocMonitoringFire(event: { applicantId: string }): Promise<void> {
    const customer = await this.prisma.customerMain.findFirst({
      where: { sumsubApplicantId: event.applicantId },
    });
    if (!customer?.sumsubApplicantId) return;

    const snapshot = await this.sumsubClient.getApplicant(customer.sumsubApplicantId);
    const expiredDocs = ((snapshot as any).info?.idDocs || []).filter(
      (d: any) => d.validUntil && new Date(d.validUntil) <= new Date(),
    );

    for (const idDoc of expiredDocs) {
      const materialType = this.mapSumsubDocToMaterialType(idDoc);
      if (!materialType) continue;

      const holding = await this.prisma.customerMaterialHolding.findUnique({
        where: { customerId_materialType: { customerId: customer.id, materialType } },
      });
      if (!holding || holding.activeRefreshCycleId) continue;

      await this.enterBlockingStage(holding.id);
    }
  }

  async recomputeHoldingsForCustomer(
    customerId: string,
    newRiskTier: string,
  ): Promise<any[]> {
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: { customerId },
    });
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const policy = this.policyLoader.getPolicy();
    const createdCycles: any[] = [];

    // Recompute expiresAt for SELF_MANAGED holdings
    for (const holding of holdings) {
      if (holding.managementMode !== 'SELF_MANAGED') continue;
      const config = policy.materials[holding.materialType];
      if (!config?.windowDays) continue;
      const newWindow = config.windowDays[newRiskTier];
      if (!newWindow) continue;

      const newExpiresAt = addDays(holding.verifiedAt, newWindow);
      if (!holding.expiresAt || newExpiresAt.getTime() !== holding.expiresAt.getTime()) {
        await this.prisma.customerMaterialHolding.update({
          where: { id: holding.id },
          data: { expiresAt: newExpiresAt },
        });
      }
    }

    // Check for missing required materials
    const required = getRequiredMaterialsForTier(newRiskTier, policy);
    const existingTypes = new Set(holdings.map((h: any) => h.materialType));
    for (const h of holdings) {
      const cfg = policy.materials[h.materialType];
      if (cfg?.alternativeOf) existingTypes.add(cfg.alternativeOf);
    }

    for (const materialType of required) {
      if (existingTypes.has(materialType)) continue;

      const newHolding = await this.prisma.customerMaterialHolding.create({
        data: {
          customerId,
          materialType,
          managementMode: policy.materials[materialType].managementMode,
          verifiedAt: new Date(),
          expiresAt: null,
          status: 'MISSING',
        },
      });

      const materialConfig = policy.materials[materialType];
      const gracePeriodDays = materialConfig.initialCollectionWindowDays?.[newRiskTier] || 14;

      if (!customer.sumsubApplicantId) continue;

      const cycleNo = await this.generateCycleNo();
      const cycle = await this.prisma.materialRefreshCycle.create({
        data: {
          cycleNo,
          customerId,
          holdingId: newHolding.id,
          materialType,
          status: 'PENDING_CUSTOMER_EVIDENCE',
          stage: 'NUDGE_ONLY',
          triggerType: 'INITIAL_COLLECTION',
          stageNudgeAt: new Date(),
          graceExpiresAt: addDays(new Date(), gracePeriodDays),
          traceId: `MATERIAL_REFRESH:${randomUUID()}`,
        },
      });

      try {
        const action = await this.sumsubClient.createApplicantAction({
          applicantId: customer.sumsubApplicantId,
          levelName: materialConfig.sumsubActionLevelName,
        });
        await this.prisma.materialRefreshCycle.update({
          where: { id: cycle.id },
          data: {
            sumsubActionId: action.id,
            sumsubActionLevelName: materialConfig.sumsubActionLevelName,
            sumsubActionCreatedAt: new Date(),
          },
        });
      } catch (err) {
        console.error(`Failed to create initial action for ${cycle.id}:`, err);
      }

      await this.prisma.customerMaterialHolding.update({
        where: { id: newHolding.id },
        data: { activeRefreshCycleId: cycle.id, status: 'REFRESH_IN_PROGRESS' },
      });

      createdCycles.push(cycle);
    }

    return createdCycles;
  }

  private async generateCycleNo(): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.materialRefreshCycle.count({
      where: { cycleNo: { startsWith: `MRC-${year}-` } },
    });
    return `MRC-${year}-${String(count + 1).padStart(5, '0')}`;
  }

  private mapSumsubDocToMaterialType(idDoc: any): string | null {
    if (idDoc.idDocType === 'ID_CARD' && idDoc.country === 'ARE') return 'EMIRATES_ID';
    if (idDoc.idDocType === 'PASSPORT') return 'PASSPORT';
    return null;
  }
}
```

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 3: Commit**

```bash
git add src/modules/identity/material-refresh/material-refresh.service.ts
git commit -m "feat(material-refresh): service with stage transitions + cascade + webhook handlers"
```

### Task 3.3: Daily cron + customer SDK endpoint + module

**Files:**
- Create: `Exchange_js/src/modules/identity/material-refresh/material-freshness-cron.service.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/material-refresh-cycles.controller.ts`
- Create: `Exchange_js/src/modules/identity/material-refresh/material-refresh.module.ts`
- Modify: `Exchange_js/src/app.module.ts`
- Modify: `Exchange_js/src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts` (wire Layer 2↔3)

- [ ] **Step 1: Create daily cron service**

```typescript
// material-freshness-cron.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { MaterialRefreshService } from './material-refresh.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';
import { computeStage } from './policy/compute-stage';

@Injectable()
export class MaterialFreshnessCronService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly service: MaterialRefreshService,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Cron('0 2 * * *')  // Daily 02:00 UTC
  async runDailyCheck(): Promise<void> {
    console.log('[MaterialFreshnessCron] Daily check starting');

    await this.scanHoldingsForStageTransitions();
    await this.scanGraceExpiredCycles();

    console.log('[MaterialFreshnessCron] Daily check complete');
  }

  private async scanHoldingsForStageTransitions(): Promise<void> {
    const holdings = await this.prisma.customerMaterialHolding.findMany({
      where: {
        status: { in: ['FRESH', 'NOTIFIED', 'URGENT', 'BLOCKING'] },
        expiresAt: { not: null },
      },
      take: 5000,
    });

    const now = Date.now();
    for (const holding of holdings) {
      if (!holding.expiresAt) continue;
      const daysFromExpiry = Math.floor(
        (holding.expiresAt.getTime() - now) / (24 * 60 * 60 * 1000),
      );
      const targetStage = computeStage(daysFromExpiry);
      if (targetStage === 'FRESH' || targetStage === holding.status) continue;

      try {
        if (targetStage === 'NOTIFIED') {
          await this.service.enterNotifiedStage(holding.id);
        } else if (targetStage === 'URGENT') {
          await this.service.escalateToUrgent(holding.id);
        } else if (targetStage === 'BLOCKING') {
          await this.service.enterBlockingStage(holding.id);
        }
      } catch (err) {
        console.error(`Stage transition failed for holding ${holding.id}:`, err);
      }
    }
  }

  private async scanGraceExpiredCycles(): Promise<void> {
    const expired = await this.prisma.materialRefreshCycle.findMany({
      where: {
        status: 'PENDING_CUSTOMER_EVIDENCE',
        graceExpiresAt: { lt: new Date() },
      },
    });

    for (const cycle of expired) {
      try {
        await this.service.terminateCycle(cycle.id, 'grace_expired');
      } catch (err) {
        console.error(`Failed to terminate cycle ${cycle.id}:`, err);
      }
    }
  }
}
```

- [ ] **Step 2: Create customer-facing controller**

```typescript
// material-refresh-cycles.controller.ts
import { Controller, Get, Post, Param, Req, UseGuards, ForbiddenException, NotFoundException, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SumsubClient } from '../onboarding/providers/sumsub/sumsub.client';

@ApiTags('Customer - Material Refresh')
@Controller('onboarding/refresh-cycles')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class MaterialRefreshCyclesController {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly sumsubClient: SumsubClient,
  ) {}

  @Get(':cycleId')
  async getCycle(@Param('cycleId') cycleId: string, @Req() req: any) {
    const customerId = this.ensureCustomer(req);
    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (cycle.customerId !== customerId) {
      throw new ForbiddenException('Not your cycle');
    }
    return {
      id: cycle.id,
      cycleNo: cycle.cycleNo,
      materialType: cycle.materialType,
      status: cycle.status,
      stage: cycle.stage,
      graceExpiresAt: cycle.graceExpiresAt,
      sumsubActionLevelName: cycle.sumsubActionLevelName,
      sumsubActionId: cycle.sumsubActionId,
    };
  }

  @Post(':cycleId/sdk-token')
  async getSdkToken(@Param('cycleId') cycleId: string, @Req() req: any) {
    const customerId = this.ensureCustomer(req);
    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: cycleId },
    });
    if (!cycle) throw new NotFoundException('Cycle not found');
    if (cycle.customerId !== customerId) {
      throw new ForbiddenException('Not your cycle');
    }
    if (cycle.status !== 'PENDING_CUSTOMER_EVIDENCE') {
      throw new ForbiddenException(`Cycle is ${cycle.status}`);
    }
    if (!cycle.sumsubActionLevelName) {
      throw new ForbiddenException('Sumsub action not yet created');
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer?.sumsubApplicantId) {
      throw new ForbiddenException('No Sumsub applicant');
    }
    if (customer.complianceHoldStatus === 'FROZEN') {
      throw new ForbiddenException('Account is frozen');
    }

    const result = await this.sumsubClient.createActionSdkToken({
      applicantId: customer.sumsubApplicantId,
      levelName: cycle.sumsubActionLevelName,
      ttlInSecs: 600,
    });

    return {
      token: result.token,
      ttlSeconds: 600,
      levelName: cycle.sumsubActionLevelName,
      // For demo: include the mock actionId so frontend can show it in the QR / simulation UI
      mockActionId: cycle.sumsubActionId,
    };
  }

  private ensureCustomer(req: any): string {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    return req.user.userId as string;
  }
}
```

- [ ] **Step 3: Create module**

```typescript
// material-refresh.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { MaterialRefreshService } from './material-refresh.service';
import { MaterialFreshnessCronService } from './material-freshness-cron.service';
import { MaterialRefreshCyclesController } from './material-refresh-cycles.controller';
import { MaterialRefreshPolicyLoader } from './policy/material-refresh-policy';
import { OnboardingModule } from '../onboarding/onboarding.module';

@Module({
  imports: [forwardRef(() => OnboardingModule)],
  providers: [
    MaterialRefreshService,
    MaterialFreshnessCronService,
    MaterialRefreshPolicyLoader,
  ],
  controllers: [MaterialRefreshCyclesController],
  exports: [MaterialRefreshService],
})
export class MaterialRefreshModule {}
```

- [ ] **Step 4: Wire Layer 2 ↔ Layer 3 via ClientRiskAssessmentModule onModuleInit**

Edit `src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts`:

```typescript
import { Module, forwardRef, OnModuleInit } from '@nestjs/common';
import { ClientRiskAssessmentService } from './client-risk-assessment.service';
import { ClientRiskAssessmentCronService } from './client-risk-assessment-cron.service';
import { ClientRiskAssessmentController } from './client-risk-assessment.controller';
import { ClientRiskAssessmentPolicyLoader } from './policy/policy-loader';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ApprovalsModule } from '../../governance/approvals/approvals.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => MaterialRefreshModule),
    ApprovalsModule,
  ],
  providers: [
    ClientRiskAssessmentService,
    ClientRiskAssessmentCronService,
    ClientRiskAssessmentPolicyLoader,
  ],
  controllers: [ClientRiskAssessmentController],
  exports: [ClientRiskAssessmentService],
})
export class ClientRiskAssessmentModule implements OnModuleInit {
  constructor(
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  onModuleInit() {
    this.clientRiskAssessmentService.materialRefreshService = this.materialRefreshService;
  }
}
```

- [ ] **Step 5: Register MaterialRefreshModule in app.module.ts**

Add to imports:
```typescript
import { MaterialRefreshModule } from './modules/identity/material-refresh/material-refresh.module';
// ... in imports: [..., MaterialRefreshModule],
```

- [ ] **Step 6: Build**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/identity/material-refresh/ \
        src/modules/identity/client-risk-assessment/client-risk-assessment.module.ts \
        src/app.module.ts
git commit -m "feat(material-refresh): daily cron + customer SDK controller + module wiring"
```

**Phase 3 Complete.** Layer 3 wired with Layer 2.

---

## Phase 4: Webhook Dispatcher + Simulation Controller Extension

**Goal:** Unified routing of Sumsub webhooks + extend existing simulation controller for admin-side Layer 2/3 event simulation.

### Task 4.1: SumsubWebhookDispatcher

**Files:**
- Create: `Exchange_js/src/modules/identity/sumsub-integration/sumsub-webhook-dispatcher.service.ts`
- Create: `Exchange_js/src/modules/identity/sumsub-integration/sumsub-integration.module.ts`
- Modify: `Exchange_js/src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts`
- Modify: `Exchange_js/src/app.module.ts`

- [ ] **Step 1: Create dispatcher**

```typescript
// sumsub-webhook-dispatcher.service.ts
import { Injectable, Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { OnboardingService } from '../onboarding/onboarding.service';
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';
import { MaterialRefreshService } from '../material-refresh/material-refresh.service';

export interface SumsubWebhookEvent {
  type: string;
  applicantId?: string;
  inspectionId?: string;
  actionId?: string;
  reviewMode?: string;
  reviewResult?: {
    reviewAnswer: 'GREEN' | 'RED';
    rejectLabels?: string[];
    reviewRejectType?: string;
  };
  createdAtMs?: string;
  [key: string]: any;
}

export interface DispatchContext {
  rawBody?: Buffer;
  signature?: string;
  simulated: boolean;
  actorId?: string;
}

@Injectable()
export class SumsubWebhookDispatcher {
  private readonly logger = new Logger(SumsubWebhookDispatcher.name);

  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly onboardingService: OnboardingService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
  ) {}

  async dispatch(event: SumsubWebhookEvent, context: DispatchContext): Promise<void> {
    // Clue 1: explicit reviewMode tells us this is doc monitoring
    if (event.reviewMode === 'ongoingDocExpired') {
      return this.materialRefreshService.handleSumsubDocMonitoringFire({
        applicantId: event.applicantId || '',
      });
    }

    // Clue 2: matching pending ClientRiskAssessment by inspectionId
    if (event.inspectionId && event.reviewResult) {
      const pending = await this.prisma.clientRiskAssessment.findFirst({
        where: {
          sumsubAmlCheckInspectionId: event.inspectionId,
          status: 'PENDING_SUMSUB_RESULT',
        },
      });
      if (pending) {
        return this.clientRiskAssessmentService.handleSumsubAmlResult(
          event.inspectionId,
          event.reviewResult,
        );
      }
    }

    // Clue 3: matching pending MaterialRefreshCycle by actionId
    if (event.actionId && event.reviewResult) {
      const pending = await this.prisma.materialRefreshCycle.findFirst({
        where: {
          sumsubActionId: event.actionId,
          status: 'PENDING_CUSTOMER_EVIDENCE',
        },
      });
      if (pending) {
        return this.materialRefreshService.handleSumsubActionResult({
          actionId: event.actionId,
          reviewResult: event.reviewResult,
        });
      }
    }

    // Clues 4/5: look up customer by applicantId
    if (!event.applicantId) {
      this.logger.warn('unrouted_webhook_no_applicant_id', { event });
      return;
    }

    const customer = await this.prisma.customerMain.findFirst({
      where: { sumsubApplicantId: event.applicantId },
    });
    if (!customer) {
      this.logger.warn('unrouted_webhook_no_customer', { applicantId: event.applicantId });
      return;
    }

    // Clue 4: customer still in onboarding — delegate to onboarding service
    if (customer.onboardingStatus === 'PENDING_VERIFICATION') {
      return this.onboardingService.handleSumsubVerificationEvent(event as any, context as any);
    }

    // Clue 5: APPROVED + spontaneous AML RED → start new Layer 2 assessment
    if (
      customer.onboardingStatus === 'APPROVED' &&
      event.type === 'applicantReviewed' &&
      event.reviewResult?.reviewAnswer === 'RED'
    ) {
      await this.clientRiskAssessmentService.startAssessment({
        customerId: customer.id,
        triggerType: 'SUMSUB_AML_HIT',
        triggeredContext: {
          spontaneousEvent: event,
          labels: event.reviewResult.rejectLabels || [],
        },
      });
      return;
    }

    this.logger.warn('unrouted_sumsub_webhook', {
      applicantId: event.applicantId,
      type: event.type,
      customerStatus: customer.onboardingStatus,
    });
  }
}
```

- [ ] **Step 2: Create module**

```typescript
// sumsub-integration.module.ts
import { Module, forwardRef } from '@nestjs/common';
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { ClientRiskAssessmentModule } from '../client-risk-assessment/client-risk-assessment.module';
import { MaterialRefreshModule } from '../material-refresh/material-refresh.module';

@Module({
  imports: [
    forwardRef(() => OnboardingModule),
    forwardRef(() => ClientRiskAssessmentModule),
    forwardRef(() => MaterialRefreshModule),
  ],
  providers: [SumsubWebhookDispatcher],
  exports: [SumsubWebhookDispatcher],
})
export class SumsubIntegrationModule {}
```

- [ ] **Step 3: Update onboarding-sumsub-webhook.controller.ts to delegate via dispatcher**

Read the current controller:
```bash
cat src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts
```

Add the `SumsubWebhookDispatcher` injection and change the `handleWebhook` method to call dispatcher instead of onboardingService directly. Existing onboarding path is preserved because dispatcher Clue 4 routes to onboarding service.

- [ ] **Step 4: Register SumsubIntegrationModule in app.module.ts**

Add to imports:
```typescript
import { SumsubIntegrationModule } from './modules/identity/sumsub-integration/sumsub-integration.module';
// ... in imports: [..., SumsubIntegrationModule],
```

- [ ] **Step 5: Build + run existing onboarding tests as regression check**

```bash
npm run build 2>&1 | tail -20
npm test -- src/modules/identity/onboarding --runInBand 2>&1 | tail -20
```

Expected: build success, existing onboarding tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/identity/sumsub-integration/ \
        src/modules/identity/onboarding/onboarding-sumsub-webhook.controller.ts \
        src/app.module.ts
git commit -m "feat(sumsub-integration): unified webhook dispatcher for onboarding + Layer 2/3"
```

### Task 4.2: Admin simulation controller extension

**Files:**
- Create: `Exchange_js/src/modules/identity/sumsub-integration/admin-sumsub-simulation.controller.ts`
- Modify: `Exchange_js/src/modules/identity/sumsub-integration/sumsub-integration.module.ts`

- [ ] **Step 1: Implement admin simulation controller**

```typescript
// admin-sumsub-simulation.controller.ts
import { Controller, Post, Body, ForbiddenException, UseGuards, Req, Inject } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SumsubWebhookDispatcher } from './sumsub-webhook-dispatcher.service';
import { ClientRiskAssessmentService } from '../client-risk-assessment/client-risk-assessment.service';
import { PrismaService } from '../../../core/prisma/prisma.service';

@ApiTags('Admin - Sumsub Simulation')
@Controller('admin/sumsub/simulate')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class AdminSumsubSimulationController {
  constructor(
    private readonly dispatcher: SumsubWebhookDispatcher,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}

  private ensureAdmin(req: any) {
    if (req.user?.type !== 'ADMIN') {
      throw new ForbiddenException('Admin token required');
    }
  }

  @Post('aml-check-result')
  @ApiOperation({ summary: 'Simulate applicantReviewed webhook for a pending ClientRiskAssessment' })
  async simulateAmlCheckResult(
    @Req() req: any,
    @Body() body: {
      customerId: string;
      reviewAnswer: 'GREEN' | 'RED';
      rejectLabels?: string[];
      reviewRejectType?: string;
    },
  ) {
    this.ensureAdmin(req);

    // Find the pending assessment for this customer
    const assessment = await this.prisma.clientRiskAssessment.findFirst({
      where: { customerId: body.customerId, status: 'PENDING_SUMSUB_RESULT' },
      orderBy: { triggeredAt: 'desc' },
    });
    if (!assessment) {
      throw new ForbiddenException('No pending assessment to simulate against');
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: body.customerId },
    });

    return this.dispatcher.dispatch(
      {
        type: 'applicantReviewed',
        applicantId: customer?.sumsubApplicantId,
        inspectionId: assessment.sumsubAmlCheckInspectionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          rejectLabels: body.rejectLabels,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      } as any,
      { simulated: true, actorId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('applicant-action-result')
  @ApiOperation({ summary: 'Simulate applicantActionReviewed webhook for a pending cycle' })
  async simulateApplicantActionResult(
    @Req() req: any,
    @Body() body: {
      cycleId: string;
      reviewAnswer: 'GREEN' | 'RED';
      reviewRejectType?: string;
    },
  ) {
    this.ensureAdmin(req);

    const cycle = await this.prisma.materialRefreshCycle.findUnique({
      where: { id: body.cycleId },
    });
    if (!cycle) throw new ForbiddenException('Cycle not found');
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: cycle.customerId },
    });

    return this.dispatcher.dispatch(
      {
        type: 'applicantActionReviewed',
        applicantId: customer?.sumsubApplicantId,
        actionId: cycle.sumsubActionId,
        reviewResult: {
          reviewAnswer: body.reviewAnswer,
          reviewRejectType: body.reviewRejectType,
        },
        createdAtMs: String(Date.now()),
      } as any,
      { simulated: true, actorId: 'ADMIN_SIMULATION' },
    );
  }

  @Post('sumsub-case-decision')
  @ApiOperation({ summary: 'Simulate Sumsub internal case final decision (after sanctions escalation)' })
  async simulateSumsubCaseDecision(
    @Req() req: any,
    @Body() body: {
      assessmentId: string;
      decision: 'APPROVE' | 'REJECT';
      reason?: string;
    },
  ) {
    this.ensureAdmin(req);

    const assessment = await this.prisma.clientRiskAssessment.findUnique({
      where: { id: body.assessmentId },
    });
    if (!assessment) throw new ForbiddenException('Assessment not found');
    if (assessment.status !== 'ESCALATED_TO_SUMSUB') {
      throw new ForbiddenException(`Assessment is ${assessment.status}, not ESCALATED_TO_SUMSUB`);
    }

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: assessment.customerId },
    });

    if (body.decision === 'APPROVE') {
      // False positive: clear freeze
      await this.prisma.customerMain.update({
        where: { id: customer!.id },
        data: { complianceHoldStatus: 'CLEAR', complianceHoldReason: null },
      });
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessment.id },
        data: {
          status: 'SIGNED',
          signedBy: 'SUMSUB_MLRO',
          signedAt: new Date(),
          sumsubCaseFinalDecision: 'APPROVE',
          sumsubCaseDecidedAt: new Date(),
        },
      });
    } else {
      // True match: offboard
      await this.prisma.customerMain.update({
        where: { id: customer!.id },
        data: {
          onboardingStatus: 'REJECTED',
          operatingStatus: 'INACTIVE',
          complianceHoldStatus: 'FROZEN',
        },
      });
      await this.prisma.clientRiskAssessment.update({
        where: { id: assessment.id },
        data: {
          status: 'SIGNED',
          signedBy: 'SUMSUB_MLRO',
          signedAt: new Date(),
          sumsubCaseFinalDecision: 'REJECT',
          sumsubCaseDecidedAt: new Date(),
        },
      });
    }

    return { ok: true };
  }

  @Post('ongoing-doc-monitoring-fire')
  @ApiOperation({ summary: 'Simulate Sumsub Ongoing Document Monitoring fire' })
  async simulateOngoingDocMonitoring(
    @Req() req: any,
    @Body() body: { customerId: string },
  ) {
    this.ensureAdmin(req);

    const customer = await this.prisma.customerMain.findUnique({
      where: { id: body.customerId },
    });
    if (!customer?.sumsubApplicantId) {
      throw new ForbiddenException('Customer has no Sumsub applicant');
    }

    return this.dispatcher.dispatch(
      {
        type: 'applicantReviewed',
        reviewMode: 'ongoingDocExpired',
        applicantId: customer.sumsubApplicantId,
        createdAtMs: String(Date.now()),
      } as any,
      { simulated: true, actorId: 'ADMIN_SIMULATION' },
    );
  }
}
```

- [ ] **Step 2: Register controller in sumsub-integration.module.ts**

Update the module:
```typescript
import { AdminSumsubSimulationController } from './admin-sumsub-simulation.controller';

@Module({
  imports: [...],
  providers: [SumsubWebhookDispatcher],
  controllers: [AdminSumsubSimulationController],
  exports: [SumsubWebhookDispatcher],
})
export class SumsubIntegrationModule {}
```

- [ ] **Step 3: Build**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/modules/identity/sumsub-integration/
git commit -m "feat(sumsub-integration): admin simulation controller for Layer 2/3 demo scenarios"
```

**Phase 4 Complete.** Webhook dispatcher + simulation controller ready.

---

## Phase 5: Frontend + Trading Guards

**Goal:** Backend ProfileBannerService + API + trading guards; frontend ProfileBanner components + /verification multi-mode + AuthGuard refinement.

### Task 5.1: Backend ProfileBannerService + API + trading guards

**Files:**
- Create: `Exchange_js/src/modules/identity/profile-banners/profile-banners.service.ts`
- Create: `Exchange_js/src/modules/identity/profile-banners/profile-banners.controller.ts`
- Create: `Exchange_js/src/modules/identity/profile-banners/profile-banners.module.ts`
- Create: `Exchange_js/src/modules/trading/shared/customer-transaction-guard.ts`
- Modify: `Exchange_js/src/app.module.ts`
- Locate and modify trading services (deposit/withdraw/swap) to call the guard

- [ ] **Step 1: ProfileBannerService**

```typescript
// profile-banners.service.ts
import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';

export interface ProfileBanner {
  id: string;
  type: 'MATERIAL_REFRESH' | 'COMPLIANCE_HOLD' | 'PEP_REVIEW_PENDING';
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  title: string;
  description: string;
  cycleId?: string;
  materialType?: string;
  expiresAt?: string;
  daysFromExpiry?: number;
  ctaLabel?: string | null;
  ctaPath?: string | null;
  dismissible: boolean;
}

function formatMaterialName(m: string): string {
  const map: Record<string, string> = {
    EMIRATES_ID: 'Emirates ID',
    PASSPORT: 'Passport',
    PROOF_OF_ADDRESS: 'Proof of Address',
    SOURCE_OF_FUNDS: 'Source of Funds',
    SOURCE_OF_WEALTH: 'Source of Wealth',
  };
  return map[m] || m;
}

@Injectable()
export class ProfileBannerService {
  constructor(
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}

  async getBannersFor(customerId: string): Promise<ProfileBanner[]> {
    const customer = await this.prisma.customerMain.findUnique({
      where: { id: customerId },
    });
    if (!customer) return [];

    const banners: ProfileBanner[] = [];

    if (customer.complianceHoldStatus === 'FROZEN') {
      banners.push({
        id: `banner-hold-${customer.id}`,
        type: 'COMPLIANCE_HOLD',
        severity: 'BLOCKING',
        title: 'Your account is frozen',
        description: 'Please contact our compliance team.',
        ctaLabel: 'Contact compliance',
        ctaPath: '/support/compliance',
        dismissible: false,
      });
    }

    if (customer.restrictionReason === 'pep_review_pending') {
      banners.push({
        id: `banner-pep-${customer.id}`,
        type: 'PEP_REVIEW_PENDING',
        severity: 'WARNING',
        title: 'Compliance review in progress',
        description: 'Your account is temporarily limited while we verify additional information.',
        ctaLabel: null,
        ctaPath: null,
        dismissible: false,
      });
    }

    const cycles = await this.prisma.materialRefreshCycle.findMany({
      where: { customerId, status: 'PENDING_CUSTOMER_EVIDENCE' },
      include: { holding: true },
      orderBy: { graceExpiresAt: 'asc' },
    });

    for (const cycle of cycles) {
      const holding = cycle.holding;
      const daysFromExpiry = holding?.expiresAt
        ? Math.floor((holding.expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null;

      const severity =
        cycle.stage === 'BLOCKING'
          ? 'BLOCKING'
          : cycle.stage === 'URGENT'
          ? 'WARNING'
          : 'INFO';

      const materialDisplay = formatMaterialName(cycle.materialType);
      const title =
        severity === 'BLOCKING'
          ? `Your ${materialDisplay} has expired`
          : `Your ${materialDisplay} expires in ${daysFromExpiry} days`;

      banners.push({
        id: `banner-mrc-${cycle.id}`,
        type: 'MATERIAL_REFRESH',
        severity,
        title,
        description:
          severity === 'BLOCKING'
            ? 'Refresh it now to restore your account.'
            : severity === 'WARNING'
            ? 'Refresh soon to avoid service interruption.'
            : 'You can refresh it at any time.',
        cycleId: cycle.id,
        materialType: cycle.materialType,
        expiresAt: holding?.expiresAt?.toISOString(),
        daysFromExpiry: daysFromExpiry ?? undefined,
        ctaLabel: `Refresh ${materialDisplay}`,
        ctaPath: `/verification?cycleId=${cycle.id}`,
        dismissible: severity === 'INFO',
      });
    }

    return banners.sort((a, b) => {
      const order = { BLOCKING: 0, WARNING: 1, INFO: 2 };
      return order[a.severity] - order[b.severity];
    });
  }
}
```

- [ ] **Step 2: Controller**

```typescript
// profile-banners.controller.ts
import { Controller, Get, Req, UseGuards, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProfileBannerService } from './profile-banners.service';

@ApiTags('Customer - Profile Banners')
@Controller('customers/me/profile-banners')
@UseGuards(AuthGuard('jwt'))
@ApiBearerAuth()
export class ProfileBannerController {
  constructor(private readonly service: ProfileBannerService) {}

  @Get()
  async getBanners(@Req() req: any) {
    if (req.user?.type !== 'CUSTOMER') {
      throw new ForbiddenException('Customer token required');
    }
    const banners = await this.service.getBannersFor(req.user.userId);
    return { banners };
  }
}
```

- [ ] **Step 3: Module**

```typescript
// profile-banners.module.ts
import { Module } from '@nestjs/common';
import { ProfileBannerService } from './profile-banners.service';
import { ProfileBannerController } from './profile-banners.controller';

@Module({
  providers: [ProfileBannerService],
  controllers: [ProfileBannerController],
  exports: [ProfileBannerService],
})
export class ProfileBannersModule {}
```

- [ ] **Step 4: Trading guard helper**

```typescript
// src/modules/trading/shared/customer-transaction-guard.ts
import { ForbiddenException } from '@nestjs/common';

export function ensureCustomerCanTransact(customer: any): void {
  if (!customer) {
    throw new ForbiddenException('Customer not found');
  }
  if (customer.complianceHoldStatus === 'FROZEN') {
    throw new ForbiddenException('Account is frozen');
  }
  if (customer.restrictionStatus === 'RESTRICTED') {
    throw new ForbiddenException(
      `Account restricted: ${customer.restrictionReason || 'unspecified'}`,
    );
  }
  if (customer.operatingStatus !== 'ACTIVE') {
    throw new ForbiddenException('Account is not active');
  }
}
```

- [ ] **Step 5: Find trading service entry points and add guard calls**

```bash
grep -rn "createDeposit\|createWithdraw\|initiateSwap\|initiateDeposit\|initiateWithdraw" src/modules/trading/ 2>/dev/null | head
```

For each entry point in deposit / withdraw / swap services, at the start of the method, after loading the customer, add:
```typescript
import { ensureCustomerCanTransact } from '../shared/customer-transaction-guard';
// ...
const customer = await this.prisma.customerMain.findUnique({
  where: { id: customerId },
});
ensureCustomerCanTransact(customer);
```

If the entry points already load the customer, just add the `ensureCustomerCanTransact(customer)` call after the load.

- [ ] **Step 6: Register ProfileBannersModule in app.module.ts**

```typescript
import { ProfileBannersModule } from './modules/identity/profile-banners/profile-banners.module';
// ... in imports: [..., ProfileBannersModule],
```

- [ ] **Step 7: Build**

```bash
npm run build 2>&1 | tail -20
```

- [ ] **Step 8: Commit**

```bash
git add src/modules/identity/profile-banners/ \
        src/modules/trading/shared/customer-transaction-guard.ts \
        src/modules/trading/deposit/ src/modules/trading/withdraw/ src/modules/trading/swap/ \
        src/app.module.ts
git commit -m "feat(profile-banners): backend service + controller + trading guards"
```

### Task 5.2: Frontend ProfileBanner + Stack + Profile page integration

**Files:**
- Create: `Exchange_js/client-web/src/components/ProfileBanner.tsx`
- Create: `Exchange_js/client-web/src/components/ProfileBannerStack.tsx`
- Modify: `Exchange_js/client-web/src/pages/CustomerProfile.tsx`

- [ ] **Step 1: ProfileBanner component**

```tsx
// ProfileBanner.tsx
import { AlertTriangle, AlertCircle, Info, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export interface ProfileBannerData {
  id: string;
  type: string;
  severity: 'INFO' | 'WARNING' | 'BLOCKING';
  title: string;
  description: string;
  ctaLabel?: string | null;
  ctaPath?: string | null;
  dismissible: boolean;
}

export function ProfileBanner({ banner }: { banner: ProfileBannerData }) {
  const navigate = useNavigate();

  const styles = {
    BLOCKING: {
      container: 'border-fx-rust bg-fx-rust/5',
      icon: 'text-fx-rust',
      Icon: AlertTriangle,
      title: 'text-fx-rust',
    },
    WARNING: {
      container: 'border-fx-copper bg-fx-copper/5',
      icon: 'text-fx-copper',
      Icon: AlertCircle,
      title: 'text-fx-copper',
    },
    INFO: {
      container: 'border-fx-brass/40 bg-fx-brass/5',
      icon: 'text-fx-brass',
      Icon: Info,
      title: 'text-fx-brass',
    },
  }[banner.severity];

  const { Icon } = styles;

  return (
    <div className={`border-l-4 ${styles.container} px-5 py-4 mb-3`}>
      <div className="flex items-start gap-4">
        <Icon className={`mt-1 shrink-0 ${styles.icon}`} size={18} />
        <div className="flex-1">
          <div className={`font-mono text-[10px] uppercase tracking-[0.18em] mb-1 ${styles.title}`}>
            {banner.title}
          </div>
          <p className="text-[13px] text-fx-dune leading-relaxed">{banner.description}</p>
        </div>
        {banner.ctaLabel && banner.ctaPath && (
          <button
            onClick={() => navigate(banner.ctaPath!)}
            className="shrink-0 font-mono text-[10px] uppercase tracking-[0.18em] text-fx-sand hover:text-fx-brass transition-colors flex items-center gap-1"
          >
            {banner.ctaLabel}
            <ExternalLink size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: ProfileBannerStack**

```tsx
// ProfileBannerStack.tsx
import { useEffect, useState } from 'react';
import { ProfileBanner, ProfileBannerData } from './ProfileBanner';
import { customerFetch } from '../utils/customerFetch';

export function ProfileBannerStack() {
  const [banners, setBanners] = useState<ProfileBannerData[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await customerFetch(
          `${import.meta.env.VITE_API_URL}/customers/me/profile-banners`,
        );
        if (response.ok) {
          const data = await response.json();
          setBanners(data.banners || []);
        }
      } catch (err) {
        console.error('Failed to load banners:', err);
      }
    };

    load();

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  if (banners.length === 0) return null;

  return (
    <div className="mb-6">
      {banners.map((b) => (
        <ProfileBanner key={b.id} banner={b} />
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Insert into CustomerProfile.tsx**

Find the top of the profile page content (the first JSX element returned after loading). Add at the very top of that content area:
```tsx
import { ProfileBannerStack } from '../components/ProfileBannerStack';

// In the returned JSX, as the first element inside the main content wrapper:
<ProfileBannerStack />
```

- [ ] **Step 4: Build client-web**

```bash
cd client-web && npm run build 2>&1 | tail -10 && cd ..
```

- [ ] **Step 5: Commit**

```bash
git add client-web/src/components/ProfileBanner.tsx \
        client-web/src/components/ProfileBannerStack.tsx \
        client-web/src/pages/CustomerProfile.tsx
git commit -m "feat(client-web): profile banner stack with severity-based rendering"
```

### Task 5.3: /verification multi-mode + AuthGuard refinement

**Files:**
- Modify: `Exchange_js/client-web/src/pages/Verification.tsx`
- Modify: `Exchange_js/client-web/src/components/AuthGuard.tsx`

- [ ] **Step 1: Verification page — add multi-mode wrapper**

At the top of `Verification.tsx`, add a mode selector. Rename the existing body to `OnboardingVerificationMode`, then add a new `MaterialRefreshVerificationMode`:

```tsx
// At the top of Verification.tsx
import { useSearchParams, Navigate } from 'react-router-dom';
// ... existing imports

const Verification = () => {
  const { profile } = useCustomerProfile();
  const [searchParams] = useSearchParams();
  const cycleId = searchParams.get('cycleId');

  // Mode A: onboarding not complete → existing flow
  if (!profile || profile.onboardingStatus !== 'APPROVED') {
    return <OnboardingVerificationMode profile={profile} />;
  }

  // Mode B: refresh cycle
  if (cycleId) {
    return <MaterialRefreshVerificationMode cycleId={cycleId} />;
  }

  // Mode C: invalid — redirect
  return <Navigate to="/profile" replace />;
};

// Rename the previous Verification function body to:
const OnboardingVerificationMode = ({ profile }: { profile: any }) => {
  // ... paste the existing Verification body here
};

// New mode:
const MaterialRefreshVerificationMode = ({ cycleId }: { cycleId: string }) => {
  const [cycle, setCycle] = useState<any>(null);
  const [sdkInfo, setSdkInfo] = useState<{ token: string; mockActionId?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const cycleRes = await customerFetch(
          `${import.meta.env.VITE_API_URL}/onboarding/refresh-cycles/${cycleId}`,
        );
        if (!cycleRes.ok) {
          setError('Cycle not found or access denied');
          return;
        }
        const cycleData = await cycleRes.json();
        setCycle(cycleData);

        const tokenRes = await customerFetch(
          `${import.meta.env.VITE_API_URL}/onboarding/refresh-cycles/${cycleId}/sdk-token`,
          { method: 'POST' },
        );
        if (!tokenRes.ok) {
          setError('Failed to get SDK token');
          return;
        }
        const tokenData = await tokenRes.json();
        setSdkInfo(tokenData);
      } catch (err: any) {
        setError(err.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [cycleId]);

  // Demo-mode "simulated submit" button — hits the admin simulation endpoint
  // through the customer's session... actually no, simulation is admin-only.
  // For the customer-side demo flow, we just show the QR code and instruct
  // "Scan to complete on mobile". The actual cycle closure is triggered
  // manually from an admin tool.
  // 
  // An alternative is to expose a customer-facing demo endpoint that calls
  // handleSumsubActionResult directly. For simplicity, we keep the admin
  // simulation as the only trigger in Phase 5 and add a customer demo
  // button in Phase 6 if needed.

  if (loading) return <div className="text-fx-dune font-mono text-[11px]">Loading…</div>;
  if (error) return <div className="text-fx-rust font-mono text-[11px]">{error}</div>;
  if (!cycle || !sdkInfo) return null;

  const qrValue = `sumsub://action/${sdkInfo.mockActionId || sdkInfo.token}`;

  return (
    <div className="min-h-[calc(100vh-4rem)] px-6 py-12 max-w-[800px] mx-auto">
      <div className="flex items-center gap-3 mb-10">
        <span className="h-[1px] w-8 bg-fx-brass" />
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-fx-dust">
          § Material Refresh · {cycle.materialType}
        </span>
      </div>

      <h1 className="fx-display font-light text-[40px] leading-[1.05] text-fx-sand mb-6">
        Refresh your
        <br />
        <span className="fx-serif italic text-fx-brass">document</span>
      </h1>

      <p className="fx-serif text-[15px] leading-[1.7] text-fx-dune max-w-[500px] mb-10">
        Your document needs an update. Scan the QR code with your mobile device and upload a fresh
        copy using the secure Sumsub widget.
      </p>

      <div className="border border-fx-rule p-8 mb-6 flex justify-center">
        <QRCodeSVG value={qrValue} size={240} />
      </div>

      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust mb-3">
        Cycle: {cycle.cycleNo}
      </div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-fx-dust">
        Action ID (demo): {sdkInfo.mockActionId}
      </div>
    </div>
  );
};
```

Note: `QRCodeSVG` is imported from the existing `qrcode.react` package (already a dependency per the earlier session).

- [ ] **Step 2: Refine AuthGuard with FROZEN/RESTRICTED route-level gating**

In `AuthGuard.tsx`, after the existing "not authenticated" and "loading" checks and before returning children, add:

```tsx
import { useLocation, Navigate } from 'react-router-dom';
// ... in the component:
const location = useLocation();

// ... after loading/auth checks, before existing "not approved" handling:

// FROZEN: allow only /profile
if (customer?.complianceHoldStatus === 'FROZEN') {
  if (location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }
  return <>{children}</>;
}

// RESTRICTED: block trading routes only
if (customer?.restrictionStatus === 'RESTRICTED') {
  const blockedPaths = ['/deposit', '/withdraw', '/swap', '/wallet/send'];
  if (blockedPaths.some((p) => location.pathname.startsWith(p))) {
    return <Navigate to="/profile" replace />;
  }
  return <>{children}</>;
}
```

- [ ] **Step 3: Build client-web**

```bash
cd client-web && npm run build 2>&1 | tail -10 && cd ..
```

- [ ] **Step 4: Commit**

```bash
git add client-web/src/pages/Verification.tsx \
        client-web/src/components/AuthGuard.tsx
git commit -m "feat(client-web): /verification multi-mode + AuthGuard FROZEN/RESTRICTED gating"
```

**Phase 5 Complete.** Frontend wired for banner + material refresh UX.

---

## Phase 6: Seed + Manual Acceptance

**Goal:** Give existing demo customers initial holdings so Layer 3 can run against them; manually exercise all 6 scenarios via the simulation controller.

### Task 6.1: Demo seed script + manual acceptance walkthrough

**Files:**
- Create: `Exchange_js/scripts/wave3-demo-seed.ts`
- Create: `Exchange_js/docs/acceptance/wave3-firm-driven-review-manual-acceptance.md`

- [ ] **Step 1: Seed script**

```typescript
// scripts/wave3-demo-seed.ts
import { PrismaClient } from '@prisma/client';

async function seed() {
  const prisma = new PrismaClient();

  const customers = await prisma.customerMain.findMany({
    where: {
      onboardingStatus: 'APPROVED',
      sumsubApplicantId: { not: null },
    },
  });

  console.log(`Seeding ${customers.length} existing customers with Wave 3 holdings`);

  for (const customer of customers) {
    try {
      // Ensure default riskTier + pepStatus
      await prisma.customerMain.update({
        where: { id: customer.id },
        data: {
          riskTier: customer.riskTier || 'LOW',
          pepStatus: customer.pepStatus || 'NONE',
        },
      });

      // Create LOW tier required holdings if missing
      const requiredMaterials: Array<{
        type: string;
        mode: 'SUMSUB_MANAGED' | 'SELF_MANAGED';
        docSet?: string;
        expiresIn?: number;  // days
      }> = [
        { type: 'EMIRATES_ID', mode: 'SUMSUB_MANAGED', docSet: 'IDENTITY', expiresIn: 365 * 5 },
        { type: 'PROOF_OF_ADDRESS', mode: 'SELF_MANAGED', expiresIn: 365 },
      ];

      for (const mat of requiredMaterials) {
        const existing = await prisma.customerMaterialHolding.findUnique({
          where: {
            customerId_materialType: {
              customerId: customer.id,
              materialType: mat.type,
            },
          },
        });
        if (existing) continue;

        const verifiedAt = customer.updatedAt || customer.createdAt;
        const expiresAt = mat.expiresIn
          ? new Date(verifiedAt.getTime() + mat.expiresIn * 24 * 60 * 60 * 1000)
          : null;

        await prisma.customerMaterialHolding.create({
          data: {
            customerId: customer.id,
            materialType: mat.type,
            managementMode: mat.mode,
            sumsubIdDocSetType: mat.docSet,
            verifiedAt,
            expiresAt,
            status: 'FRESH',
          },
        });
      }

      console.log(`  ✓ ${customer.customerNo || customer.id}`);
    } catch (err: any) {
      console.error(`  ✗ ${customer.customerNo || customer.id}: ${err.message}`);
    }
  }

  await prisma.$disconnect();
  console.log('Done.');
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`, add to `scripts`:
```json
  "wave3:seed": "ts-node scripts/wave3-demo-seed.ts"
```

- [ ] **Step 3: Write the manual acceptance doc**

Create `docs/acceptance/wave3-firm-driven-review-manual-acceptance.md`:

```markdown
# Wave 3 Firm-Driven Customer Review — Manual Acceptance

This document walks a reviewer through the 6 demo acceptance scenarios using
the admin simulation controller. Requires `SUMSUB_MOCK_MODE=true` in `.env`.

## Prerequisites

1. Database migrated (Phase 1 complete)
2. Backend running with `SUMSUB_MOCK_MODE=true npm run start`
3. `npm run wave3:seed` executed (Phase 6 task)
4. At least one APPROVED customer in the database
5. Admin credentials for calling simulation endpoints

## Scenario 1: LOW→LOW Quarterly Reaffirm (Auto-Sign)

**Setup:**
- Customer with `riskTier = 'LOW'`, `onboardingStatus = 'APPROVED'`
- No pending ClientRiskAssessment

**Steps:**
1. As admin, trigger manual assessment:
   ```
   POST /admin/compliance/customers/{customerId}/risk-assessment/trigger
   { "reason": "scenario 1 test" }
   ```
2. Simulate GREEN AML result:
   ```
   POST /admin/sumsub/simulate/aml-check-result
   { "customerId": "...", "reviewAnswer": "GREEN", "rejectLabels": [] }
   ```

**Expected:**
- `client_risk_assessments` has a new row with `status = 'SIGNED'`, `signedBy = 'SYSTEM'`, `signoffMethod = 'AUTO_R2'`
- Customer unchanged

## Scenario 2: SANCTIONS Hit → FROZEN

**Setup:** APPROVED customer as above.

**Steps:**
1. Trigger assessment (same as Scenario 1 step 1)
2. Simulate RED SANCTIONS:
   ```
   POST /admin/sumsub/simulate/aml-check-result
   { "customerId": "...", "reviewAnswer": "RED", "rejectLabels": ["SANCTIONS_UN"] }
   ```

**Expected:**
- Customer `complianceHoldStatus = 'FROZEN'`, `complianceHoldReason = 'sanctions_hit_pending_investigation'`
- Assessment `status = 'ESCALATED_TO_SUMSUB'`, `resultingRiskTier = 'HIGH'`
- Customer's login → blocked from /deposit, /withdraw, /swap (AuthGuard redirects to /profile)
- Profile banner shows "Your account is frozen"

3. Simulate Sumsub case decision (false positive):
   ```
   POST /admin/sumsub/simulate/sumsub-case-decision
   { "assessmentId": "...", "decision": "APPROVE" }
   ```

**Expected:**
- Customer `complianceHoldStatus = 'CLEAR'`
- Banner disappears

## Scenario 3: PoA Expired → Customer Refreshes

**Setup:**
- Customer with `riskTier = 'LOW'` and a `PROOF_OF_ADDRESS` holding where `expiresAt < now + 25 days`
- (Directly edit the DB to set expiresAt to trigger the NOTIFIED stage)

**Steps:**
1. Trigger Layer 3 daily cron manually or wait for 02:00 UTC
2. Observe: `MaterialRefreshCycle` created with `stage = 'NUDGE_ONLY'`
3. Customer logs in, visits `/profile` → sees banner
4. Clicks "Refresh Proof of Address" → navigates to `/verification?cycleId=...`
5. Page shows QR code and mock actionId
6. Admin simulates applicant action:
   ```
   POST /admin/sumsub/simulate/applicant-action-result
   { "cycleId": "...", "reviewAnswer": "GREEN" }
   ```

**Expected:**
- Cycle `status = 'CLEARED'`
- Holding `verifiedAt` updated, `status = 'FRESH'`, `expiresAt` recomputed
- Banner disappears

## Scenario 4: Tier Upgrade LOW→MEDIUM → SoF Initial Collection

**Setup:**
- Customer with `riskTier = 'LOW'`, no `SOURCE_OF_FUNDS` holding
- Directly trigger a MEDIUM assessment signoff (or use Task 4.1 admin trigger with a simulated GREEN result then modify the assessment to resultingRiskTier='MEDIUM' and signoff via Wave 1 ApprovalCase)

**Steps (simplified):**
1. Trigger assessment, simulate GREEN
2. Admin updates the pending assessment to `resultingRiskTier = 'MEDIUM'`, `signoffMethod = 'MANUAL_COMPLIANCE_OFFICER'`, creates a RISK_RATING_MEDIUM_APPROVAL case
3. Compliance officer approves the case in admin UI
4. Observe `postSignoffCascade` triggers `recomputeHoldingsForCustomer(id, 'MEDIUM')`

**Expected:**
- Customer `riskTier = 'MEDIUM'`
- New `CustomerMaterialHolding` row for `SOURCE_OF_FUNDS` with `status = 'MISSING'`
- New `MaterialRefreshCycle` with `triggerType = 'INITIAL_COLLECTION'`, pointing at the new holding
- Profile banner for SoF appears

## Scenario 5: PEP Detected → Dual Sign

**Setup:** APPROVED customer.

**Steps:**
1. Trigger assessment (manual admin trigger)
2. Simulate PEP:
   ```
   POST /admin/sumsub/simulate/aml-check-result
   { "customerId": "...", "reviewAnswer": "RED", "rejectLabels": ["PEP_CLASS_1_DOMESTIC"] }
   ```

**Expected:**
- Customer `restrictionStatus = 'RESTRICTED'`, `pepStatus = 'CONFIRMED'`
- New `PEP_RELATIONSHIP_APPROVAL` case with 2 pending steps
- Profile banner "Compliance review in progress"

3. MLRO approves step 1 via admin UI
4. SENIOR_MANAGEMENT_OFFICER approves step 2

**Expected:**
- Case `status = 'APPROVED'`
- Assessment `status = 'SIGNED'`
- Customer `riskTier = 'HIGH'`, `restrictionStatus = 'CLEAR'`, Sumsub level moved to `wave3-level-2`
- Banner disappears

## Scenario 6: Grace Period Expired → Customer Offboard

**Setup:**
- Customer with an active refresh cycle
- Directly edit DB: `graceExpiresAt = now - 1 day`

**Steps:**
1. Trigger Layer 3 daily cron
2. Observe cycle terminated

**Expected:**
- Cycle `status = 'REJECTED'`, `rejectedAt` set
- Customer `onboardingStatus = 'WITHDRAWN'`, `operatingStatus = 'INACTIVE'`
- AuthGuard redirects customer to simplified pending page on next login

## Verification

After all 6 scenarios:
- Inspect `audit_log_events` for trace continuity
- Verify DB state matches expected for each scenario
- Check there are no stuck `PENDING_SUMSUB_RESULT` assessments
```

- [ ] **Step 4: Run the seed script on dev database**

```bash
cd /Users/songshengwei/Documents/codex/projects/重做版/.wt/branch/Exchange_js
SUMSUB_MOCK_MODE=true npm run wave3:seed
```

- [ ] **Step 5: Run the full test suite as final regression check**

```bash
npm test --runInBand 2>&1 | tail -30
npm run build 2>&1 | tail -10
(cd client-web && npm run build 2>&1 | tail -10)
```

All builds and tests must pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/wave3-demo-seed.ts package.json \
        docs/acceptance/wave3-firm-driven-review-manual-acceptance.md
git commit -m "feat(wave3): demo seed script + manual acceptance walkthrough"
```

**Phase 6 Complete.** Wave 3 firm-driven customer review is functionally complete in demo form. Manual acceptance doc enables end-to-end walkthrough via simulation controller.

---

## Final Verification

- [ ] Backend build: `npm run build`
- [ ] Frontend build: `(cd client-web && npm run build)`
- [ ] Backend tests: `npm test --runInBand`
- [ ] Walk through all 6 scenarios from the manual acceptance doc
- [ ] Confirm git log shows clean per-task commits across 6 phases

---

## Summary

- **16 tasks across 6 phases, ~5 person-days**
- All Sumsub HTTP integration stubbed via `SUMSUB_MOCK_MODE=true`
- All webhook events fired manually through admin simulation controller
- Frontend demonstrates banner + material refresh UX end-to-end with QR display
- Wave 1 ApprovalCase kernel extended with multi-step support (PEP dual-sign)
- Manual acceptance via 6 scenarios is the primary verification mechanism

**Deferred (not in this plan):** `docs/cleanup/deferred-refactors.md` items #6 (policy markdown docs) and #7 (Sumsub event mirror pipeline).
