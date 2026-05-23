# Simulation Event Records — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route KYT/TR/CaseDecision simulations through the existing `ingest()` → `dispatch()` pipeline so they produce `SumsubWebhookEvent` records visible in the Sumsub Events list.

**Architecture:** The ingestion service gains a `context` parameter, two new DI injections (deposit services), and three new dispatch branches. The simulation controller's three methods are refactored from direct service calls to `ingest()` calls with response re-mapping for backward compatibility.

**Tech Stack:** NestJS (backend controller + service)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts` | Modify | Add `context` param, inject deposit services, add 3 dispatch branches |
| `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts` | Modify | Refactor 3 methods to use `ingest()`, remove unused DI |

---

### Task 1: Ingestion Service — Context Parameter, Deposit DI, Dispatch Handlers

**Files:**
- Modify: `src/modules/sumsub-ingestion/sumsub-ingestion.service.ts`

- [ ] **Step 1: Add DepositTransactionsService and DepositWorkflowService imports and DI**

At the top of `sumsub-ingestion.service.ts`, add two imports after the existing service imports (after line 12):

```typescript
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
```

In the constructor (line 24–29), add two new parameters after the last existing one (`tierUpgradeCaseService`):

Replace:
```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
  ) {}
```

With:
```typescript
  constructor(
    private readonly prisma: PrismaService,
    private readonly onboardingService: OnboardingService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly materialRefreshService: MaterialRefreshService,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
    private readonly depositTransactionsService: DepositTransactionsService,
    private readonly depositWorkflowService: DepositWorkflowService,
  ) {}
```

- [ ] **Step 2: Add `context` option to `ingest()` method**

Replace the `ingest()` method signature and the `createEventRecord` call (lines 34–68) with:

```typescript
  async ingest(
    rawPayload: Record<string, unknown>,
    options: {
      isSimulated?: boolean;
      simulatedByUserId?: string;
      context?: string;
    } = {},
  ): Promise<{ event: SumsubWebhookEvent; dispatchResult?: unknown }> {
    const eventType = String(rawPayload.type ?? 'unknown');
    const applicantId = String(rawPayload.applicantId ?? '');
    const externalUserId = String(rawPayload.externalUserId ?? '');

    // Deduplication: if an identical event (same type+applicantId+reviewId) was
    // already PROCESSED, return it without dispatching again.
    // Simulated events skip dedup so admins can re-run scenarios freely.
    const dedupeKey = !options.isSimulated ? this.buildDedupeKey(rawPayload) : null;
    if (dedupeKey) {
      const existing = await this.prisma.sumsubWebhookEvent.findFirst({
        where: { eventType, applicantId, status: 'PROCESSED' },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        const existingPayload = this.parseRawPayload(existing.rawPayload);
        if (this.extractDedupeKey(existingPayload) === dedupeKey) {
          this.logger.warn(`Duplicate event skipped: ${dedupeKey}`);
          return { event: existing };
        }
      }
    }

    // Persist event record
    const event = await this.createEventRecord({
      eventType,
      applicantId,
      externalUserId,
      rawPayload,
      isSimulated: options.isSimulated ?? false,
      simulatedByUserId: options.simulatedByUserId ?? null,
      context: options.context ?? 'ONBOARDING',
    });

    if (options.isSimulated) {
      // Synchronous dispatch for simulation — caller wants to see the result immediately
      const dispatchResult = await this.dispatch(event);
      return { event: await this.refresh(event.id), dispatchResult };
    } else {
      // Fire-and-forget for real webhooks — return 200 to Sumsub quickly
      this.dispatch(event).catch((err) =>
        this.logger.error(`Dispatch failed for event ${event.id}: ${String(err)}`),
      );
      return { event };
    }
  }
```

- [ ] **Step 3: Update `createEventRecord()` to use `context` parameter**

Replace the `createEventRecord` method (lines 384–419) with:

```typescript
  private async createEventRecord(data: {
    eventType: string;
    applicantId: string;
    externalUserId: string;
    rawPayload: Record<string, unknown>;
    isSimulated: boolean;
    simulatedByUserId: string | null;
    context: string;
  }): Promise<SumsubWebhookEvent> {
    for (let i = 0; i < MAX_NO_RETRIES; i++) {
      try {
        return await this.prisma.sumsubWebhookEvent.create({
          data: {
            eventNo: generateReferenceNo('SWH'),
            eventType: data.eventType,
            applicantId: data.applicantId,
            externalUserId: data.externalUserId,
            context: data.context,
            rawPayload: JSON.stringify(data.rawPayload),
            receivedAt: new Date(),
            status: 'PENDING',
            isSimulated: data.isSimulated,
            simulatedByUserId: data.simulatedByUserId,
          },
        });
      } catch (err: unknown) {
        const isUnique =
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: string }).code === 'P2002';
        if (isUnique) continue;
        throw err;
      }
    }
    throw new Error('Failed to generate unique eventNo after max retries');
  }
```

- [ ] **Step 4: Add three new dispatch branches**

In the `dispatch()` method (line 85), insert three new branches at the very top of the try block, **before** the existing `const reviewMode = ...` line (line 92). The new code goes right after `let dispatchedContext = event.context;` (line 91):

After `let dispatchedContext = event.context;`, insert:

```typescript
      // ── Synthetic simulation event types (exact eventType match, highest priority) ──
      if (event.eventType === 'kytCheckSimulated') {
        const depositId = String(payload.depositId ?? '');
        const kytStatus = String(payload.result) === 'PASS' ? 'PASSED' : 'FAILED';
        const riskScore = (payload.riskScore as number | null) ?? null;
        await this.depositTransactionsService.updateKytStatus(depositId, kytStatus, riskScore);
        await this.depositWorkflowService.checkAutoApproval(depositId);
        result = { depositId, kytStatus, riskScore };
        dispatchedContext = 'KYT_CHECK';
      } else if (event.eventType === 'travelRuleCheckSimulated') {
        const depositId = String(payload.depositId ?? '');
        const trStatus = String(payload.result) === 'PASS' ? 'PASSED' : 'FAILED';
        await this.depositTransactionsService.updateTravelRuleStatus(depositId, trStatus);
        await this.depositWorkflowService.checkAutoApproval(depositId);
        result = { depositId, trStatus };
        dispatchedContext = 'TRAVEL_RULE_CHECK';
      } else if (event.eventType === 'caseDecisionSimulated') {
        const assessmentId = String(payload.assessmentId ?? '');
        const customerId = String(payload.customerId ?? '');
        const decision = String(payload.decision ?? '');
        if (decision === 'APPROVE') {
          await this.prisma.customerMain.update({
            where: { id: customerId },
            data: { complianceStatus: 'CLEAR', complianceFreezeReason: null },
          });
          await this.prisma.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: {
              status: 'SIGNED',
              signedBy: 'SUMSUB_MLRO',
              signedAt: new Date(),
              sumsubCaseFinalDecision: 'APPROVE',
              sumsubCaseDecidedAt: new Date(),
            },
          });
        } else {
          await this.prisma.customerMain.update({
            where: { id: customerId },
            data: { onboardingStatus: 'REJECTED', adminStatus: 'INACTIVE', complianceStatus: 'FROZEN' },
          });
          await this.prisma.clientRiskAssessment.update({
            where: { id: assessmentId },
            data: {
              status: 'SIGNED',
              signedBy: 'SUMSUB_MLRO',
              signedAt: new Date(),
              sumsubCaseFinalDecision: 'REJECT',
              sumsubCaseDecidedAt: new Date(),
            },
          });
        }
        result = { assessmentId, decision };
        dispatchedContext = 'CASE_DECISION';
      }
```

Then change the first existing clue from `if` to `else if` — the line that currently reads:

```typescript
      // Clue 1: explicit reviewMode → ongoing doc monitoring
      if (reviewMode === 'ongoingDocExpired') {
```

Must become:

```typescript
      // Clue 1: explicit reviewMode → ongoing doc monitoring
      else if (reviewMode === 'ongoingDocExpired') {
```

This chains all routing into a single if/else-if block.

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: no errors (the controller still compiles because it still imports the deposit services — we haven't removed them yet)

- [ ] **Step 6: Commit**

```bash
git add src/modules/sumsub-ingestion/sumsub-ingestion.service.ts
git commit -m "feat(sumsub): add context param, deposit DI, and KYT/TR/CaseDecision dispatch handlers"
```

---

### Task 2: Controller — Refactor KYT/TR/CaseDecision to Use ingest()

**Files:**
- Modify: `src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts`

- [ ] **Step 1: Remove unused deposit service imports and DI**

Remove these two import lines (lines 9–10):

```typescript
import { DepositWorkflowService } from '../trading/deposit-transactions/deposit-workflow.service';
import { DepositTransactionsService } from '../trading/deposit-transactions/deposit-transactions.service';
```

In the constructor, remove the last two parameters. Replace:

```typescript
  constructor(
    private readonly ingestionService: SumsubIngestionService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
    private readonly depositWorkflowService: DepositWorkflowService,
    private readonly depositTransactionsService: DepositTransactionsService,
  ) {}
```

With:

```typescript
  constructor(
    private readonly ingestionService: SumsubIngestionService,
    private readonly clientRiskAssessmentService: ClientRiskAssessmentService,
    private readonly tierUpgradeCaseService: TierUpgradeCaseService,
    @Inject(PrismaService)
    private readonly prisma: PrismaService & Record<string, any>,
  ) {}
```

Also remove the `Inject` import if no other usage remains — but `Inject` is still used for `@Inject(PrismaService)`, so keep it.

- [ ] **Step 2: Refactor `simulateKytCheck` to use ingest()**

Replace the `simulateKytCheck` method (lines 349–392) with:

```typescript
  @Post('kyt-check')
  @ApiOperation({ summary: 'Simulate KYT (Know Your Transaction) check result' })
  async simulateKytCheck(
    @Req() req: any,
    @Body() body: { depositNo?: string; txHash?: string; result: 'PASS' | 'FAIL'; riskScore?: number },
  ) {
    this.ensureAdmin(req);

    if (!body.depositNo && !body.txHash) {
      throw new BadRequestException('depositNo or txHash is required');
    }
    if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const where = body.depositNo
      ? { depositNo: body.depositNo }
      : { txHash: body.txHash };
    const deposit = await (this.prisma as any).depositTransaction.findFirst({ where });
    if (!deposit) {
      throw new NotFoundException(
        body.depositNo
          ? `No deposit found with depositNo: ${body.depositNo}`
          : `No deposit found with txHash: ${body.txHash}`,
      );
    }

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'kytCheckSimulated',
        externalUserId: deposit.depositNo,
        depositId: deposit.id,
        depositNo: deposit.depositNo,
        result: body.result,
        riskScore: body.riskScore ?? null,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'KYT_CHECK' },
    );
    const dr = dispatchResult as any;
    return {
      depositId: dr?.depositId,
      depositNo: deposit.depositNo,
      kytStatus: dr?.kytStatus,
      riskScore: dr?.riskScore ?? null,
      message: `KYT check simulated: ${dr?.kytStatus}`,
      eventNo: event.eventNo,
    };
  }
```

- [ ] **Step 3: Refactor `simulateTrCheck` to use ingest()**

Replace the `simulateTrCheck` method (lines 394–435) with:

```typescript
  @Post('tr-check')
  @ApiOperation({ summary: 'Simulate Travel Rule (TR) check result' })
  async simulateTrCheck(
    @Req() req: any,
    @Body() body: { depositNo?: string; txHash?: string; result: 'PASS' | 'FAIL' },
  ) {
    this.ensureAdmin(req);

    if (!body.depositNo && !body.txHash) {
      throw new BadRequestException('depositNo or txHash is required');
    }
    if (!body.result || !['PASS', 'FAIL'].includes(body.result)) {
      throw new BadRequestException('result must be PASS or FAIL');
    }

    const where = body.depositNo
      ? { depositNo: body.depositNo }
      : { txHash: body.txHash };
    const deposit = await (this.prisma as any).depositTransaction.findFirst({ where });
    if (!deposit) {
      throw new NotFoundException(
        body.depositNo
          ? `No deposit found with depositNo: ${body.depositNo}`
          : `No deposit found with txHash: ${body.txHash}`,
      );
    }

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'travelRuleCheckSimulated',
        externalUserId: deposit.depositNo,
        depositId: deposit.id,
        depositNo: deposit.depositNo,
        result: body.result,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'TRAVEL_RULE_CHECK' },
    );
    const dr = dispatchResult as any;
    return {
      depositId: dr?.depositId,
      depositNo: deposit.depositNo,
      travelRuleStatus: dr?.trStatus,
      message: `Travel Rule check simulated: ${dr?.trStatus}`,
      eventNo: event.eventNo,
    };
  }
```

- [ ] **Step 4: Refactor `simulateSumsubCaseDecision` to use ingest()**

Replace the `simulateSumsubCaseDecision` method (lines 131–194) with:

```typescript
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

    const { event, dispatchResult } = await this.ingestionService.ingest(
      {
        type: 'caseDecisionSimulated',
        applicantId: customer!.sumsubApplicantId ?? '',
        externalUserId: customer!.id,
        assessmentId: assessment.id,
        customerId: customer!.id,
        decision: body.decision,
        reason: body.reason,
      },
      { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'CASE_DECISION' },
    );
    const dr = dispatchResult as any;
    return {
      ok: true,
      assessmentId: dr?.assessmentId,
      decision: dr?.decision,
      eventNo: event.eventNo,
    };
  }
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd Exchange_js && npx tsc --noEmit --pretty 2>&1 | head -30`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add src/modules/sumsub-ingestion/admin-sumsub-simulation.controller.ts
git commit -m "refactor(sumsub): route KYT/TR/CaseDecision simulations through ingest pipeline"
```
