# Simulation Event Records — Route KYT/TR/CaseDecision Through Ingest Pipeline

> **Scope:** Backend only — `admin-sumsub-simulation.controller.ts` + `sumsub-ingestion.service.ts`
> **Goal:** Make KYT, Travel Rule, and CaseDecision simulations produce `SumsubWebhookEvent` records by routing them through the existing `ingest()` → `dispatch()` pipeline, so all simulations are visible in the Sumsub Events list.

---

## 1. Problem

Three simulation methods bypass the `ingest()` → `dispatch()` pipeline:

| Method | Current behavior | Record created? |
|--------|-----------------|----------------|
| `simulateKytCheck` | Controller calls `depositTransactionsService.updateKytStatus()` directly | ❌ |
| `simulateTrCheck` | Controller calls `depositTransactionsService.updateTravelRuleStatus()` directly | ❌ |
| `simulateSumsubCaseDecision` | Controller does raw prisma writes on `customerMain` + `clientRiskAssessment` | ❌ |

All other simulation methods (AML, Material, CRA, Level2, Ongoing) go through `ingestionService.ingest()`, which creates a `SumsubWebhookEvent` record and dispatches to a domain handler. The three methods above skip this, leaving no audit trail.

---

## 2. Solution

Refactor all three methods to follow the same pattern as the others:

```
Controller: validate params + enrich payload → ingestionService.ingest(payload, { isSimulated: true, context })
                                                        │
                                                        ├── createEventRecord() → PENDING
                                                        │
                                                        └── dispatch() → routes to new handler → PROCESSED
```

### 2.1 New Event Types

| Simulation | `eventType` | `context` | `dispatchedTo` |
|-----------|-------------|-----------|----------------|
| KYT Check | `kytCheckSimulated` | `KYT_CHECK` | `KYT_CHECK` |
| Travel Rule | `travelRuleCheckSimulated` | `TRAVEL_RULE_CHECK` | `TRAVEL_RULE_CHECK` |
| Case Decision | `caseDecisionSimulated` | `CASE_DECISION` | `CASE_DECISION` |

### 2.2 Payload Shapes

**KYT Check:**
```typescript
{
  type: 'kytCheckSimulated',
  externalUserId: string,  // depositNo — shown in events list
  depositId: string,
  depositNo: string,
  result: 'PASS' | 'FAIL',
  riskScore?: number | null,
}
```

**Travel Rule:**
```typescript
{
  type: 'travelRuleCheckSimulated',
  externalUserId: string,  // depositNo — shown in events list
  depositId: string,
  depositNo: string,
  result: 'PASS' | 'FAIL',
}
```

**Case Decision:**
```typescript
{
  type: 'caseDecisionSimulated',
  applicantId: string,     // customer.sumsubApplicantId
  externalUserId: string,  // customerId
  assessmentId: string,
  customerId: string,
  decision: 'APPROVE' | 'REJECT',
  reason?: string,
}
```

---

## 3. Controller Changes

**File:** `admin-sumsub-simulation.controller.ts`

### 3.1 `simulateKytCheck`

Keep existing validation (param checks, deposit lookup). Replace direct service calls with:

```typescript
return this.ingestionService.ingest(
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
```

### 3.2 `simulateTrCheck`

Same pattern — keep validation, replace direct calls with `ingest()`:

```typescript
return this.ingestionService.ingest(
  {
    type: 'travelRuleCheckSimulated',
    externalUserId: deposit.depositNo,
    depositId: deposit.id,
    depositNo: deposit.depositNo,
    result: body.result,
  },
  { isSimulated: true, simulatedByUserId: 'ADMIN_SIMULATION', context: 'TRAVEL_RULE_CHECK' },
);
```

### 3.3 `simulateSumsubCaseDecision`

Keep existing validation (assessment lookup, status check, customer lookup). Replace direct prisma writes with `ingest()`:

```typescript
return this.ingestionService.ingest(
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
```

### 3.4 DI Cleanup

Remove `DepositTransactionsService` and `DepositWorkflowService` from controller constructor — they move to `SumsubIngestionService`.

---

## 4. Ingestion Service Changes

**File:** `sumsub-ingestion.service.ts`

### 4.1 New DI

Inject `DepositTransactionsService` and `DepositWorkflowService`. Module wiring already exists — `SumsubIngestionModule` imports `DepositTransactionsModule` and the deposit module exports both services.

### 4.2 `ingest()` — Accept `context` Option

Add optional `context` parameter to ingest options:

```typescript
async ingest(
  rawPayload: Record<string, unknown>,
  options: {
    isSimulated?: boolean;
    simulatedByUserId?: string;
    context?: string;  // NEW
  } = {},
)
```

Pass through to `createEventRecord`:

```typescript
const event = await this.createEventRecord({
  eventType,
  applicantId,
  externalUserId,
  rawPayload,
  isSimulated: options.isSimulated ?? false,
  simulatedByUserId: options.simulatedByUserId ?? null,
  context: options.context ?? 'ONBOARDING',  // NEW — default preserves existing behavior
});
```

### 4.3 `createEventRecord()` — Use `context` Parameter

Replace hardcoded `context: 'ONBOARDING'` with `data.context`:

```typescript
private async createEventRecord(data: {
  eventType: string;
  applicantId: string;
  externalUserId: string;
  rawPayload: Record<string, unknown>;
  isSimulated: boolean;
  simulatedByUserId: string | null;
  context: string;  // NEW
}): Promise<SumsubWebhookEvent> {
  // ...
  return await this.prisma.sumsubWebhookEvent.create({
    data: {
      // ...
      context: data.context,  // was hardcoded 'ONBOARDING'
      // ...
    },
  });
}
```

### 4.4 `dispatch()` — New Routing Branches

Add three new branches at the **top** of dispatch (before existing clue-based routing), keyed by exact `eventType` match:

```typescript
// ── Synthetic simulation event types (exact match, highest priority) ──
if (event.eventType === 'kytCheckSimulated') {
  const depositId = String(payload.depositId ?? '');
  const kytStatus = payload.result === 'PASS' ? 'PASSED' : 'FAILED';
  const riskScore = payload.riskScore ?? null;
  await this.depositTransactionsService.updateKytStatus(depositId, kytStatus, riskScore);
  await this.depositWorkflowService.checkAutoApproval(depositId);
  result = { depositId, kytStatus, riskScore };
  dispatchedContext = 'KYT_CHECK';
}
else if (event.eventType === 'travelRuleCheckSimulated') {
  const depositId = String(payload.depositId ?? '');
  const trStatus = payload.result === 'PASS' ? 'PASSED' : 'FAILED';
  await this.depositTransactionsService.updateTravelRuleStatus(depositId, trStatus);
  await this.depositWorkflowService.checkAutoApproval(depositId);
  result = { depositId, trStatus };
  dispatchedContext = 'TRAVEL_RULE_CHECK';
}
else if (event.eventType === 'caseDecisionSimulated') {
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
        status: 'SIGNED', signedBy: 'SUMSUB_MLRO', signedAt: new Date(),
        sumsubCaseFinalDecision: 'APPROVE', sumsubCaseDecidedAt: new Date(),
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
        status: 'SIGNED', signedBy: 'SUMSUB_MLRO', signedAt: new Date(),
        sumsubCaseFinalDecision: 'REJECT', sumsubCaseDecidedAt: new Date(),
      },
    });
  }
  result = { assessmentId, decision };
  dispatchedContext = 'CASE_DECISION';
}
// ── Existing clue-based routing below ──
```

---

## 5. Return Value Change

Currently the three controller methods return custom response objects. After routing through `ingest()`, they return `{ event, dispatchResult }` — the standard ingest response.

The frontend (`handleSimulate` in `SumsubEventsPage.tsx`) checks `response.ok` and reads the JSON for a success message. The response shape changes:

- **Before:** `{ depositId, depositNo, kytStatus, message }` or `{ ok: true }`
- **After:** `{ event: { id, eventNo, ... }, dispatchResult: { depositId, kytStatus, ... } }`

The frontend currently uses `res.depositNo` for the success message. This needs a minor frontend update to read from the new shape, or the controller can re-map the response to maintain backward compatibility.

**Decision:** Controller re-maps the ingest response to preserve the existing API contract. This avoids frontend changes.

```typescript
// In simulateKytCheck, after ingest:
const { event, dispatchResult } = await this.ingestionService.ingest(...);
const dr = dispatchResult as any;
return {
  depositId: dr?.depositId,
  depositNo: deposit.depositNo,
  kytStatus: dr?.kytStatus,
  riskScore: dr?.riskScore ?? null,
  message: `KYT check simulated: ${dr?.kytStatus}`,
  eventNo: event.eventNo,  // NEW — reference to the event record
};
```

Same pattern for TR and CaseDecision.

---

## 6. Non-Goals

- No new Prisma migration — `SumsubWebhookEvent` schema is unchanged
- No frontend changes — events automatically appear in the existing list via the same `GET /admin/sumsub-events` endpoint
- No refactoring of CaseDecision's raw prisma writes to use domain service methods (pre-existing pattern, separate concern)
- No changes to `ingest()` deduplication logic — simulated events already skip dedup
